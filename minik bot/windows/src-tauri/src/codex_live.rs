//! Read-only fallback for chats already running before hooks were installed.
//! No session resume, model calls, command execution or permission decisions.
//! Rollout contents stay local; only allowlisted lifecycle metadata reaches UI.
use std::{collections::HashMap, fs::{self, File}, io::{Read, Seek, SeekFrom}, path::{Path, PathBuf}, sync::Mutex, time::{Duration, SystemTime}};
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};

const TAIL: u64 = 2 * 1024 * 1024;
const LINE_LIMIT: usize = 4 * 1024 * 1024;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveUpdate {
    pub session_id: String,
    pub cwd: String,
    pub state: String,
    pub step: String,
    pub timestamp: String,
}
#[derive(Default)]
pub struct LiveState(pub Mutex<Option<LiveUpdate>>);

#[derive(Default)]
struct Cursor {
    offset: u64,
    pending: Vec<u8>,
    skipping: bool,
    id: String,
    cwd: String,
    active: bool,
    update: Option<LiveUpdate>,
}

fn safe_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 128 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

impl Cursor {
    fn event(&mut self, line: &[u8]) {
        let Ok(v) = serde_json::from_slice::<Value>(line) else { return };
        let p = &v["payload"];
        let kind = p["type"].as_str().unwrap_or("");
        if v["type"] == "session_meta" {
            // Exclude background subagents from the single user-facing pill.
            if p["source"].is_object() { return; }
            let id = p["id"].as_str().unwrap_or("");
            if safe_id(id) { self.id = id.into(); self.cwd = p["cwd"].as_str().unwrap_or("").into(); }
            return;
        }
        if self.id.is_empty() { return; }
        let transition = match (v["type"].as_str().unwrap_or(""), kind) {
            ("event_msg", "task_started") => { self.active = true; Some(("thinking", "Thinking")) }
            ("event_msg", "task_complete") => { self.active = false; Some(("finished", "Completed")) }
            ("event_msg", "turn_aborted") => { self.active = false; Some(("idle", "Interrupted")) }
            ("response_item", "function_call" | "custom_tool_call") if self.active => Some(("working", "Using a tool")),
            ("response_item", "function_call_output" | "custom_tool_call_output") if self.active => Some(("thinking", "Tool completed · thinking")),
            ("response_item", "reasoning") if self.active => Some(("thinking", "Thinking")),
            ("event_msg", "item_completed") if self.active => match p["item"]["type"].as_str().unwrap_or("") {
                "CommandExecution" => Some(("thinking", "Command completed · thinking")),
                "FileChange" => Some(("thinking", "File update completed")),
                "McpToolCall" | "Extension" => Some(("thinking", "Tool completed · thinking")),
                _ => None,
            },
            _ => None,
        };
        if let Some((state, step)) = transition {
            let timestamp = v["timestamp"].as_str().unwrap_or("");
            if timestamp.is_empty() { return; }
            self.update = Some(LiveUpdate { session_id: self.id.clone(), cwd: self.cwd.clone(), state: state.into(), step: step.into(), timestamp: timestamp.into() });
        }
    }

    fn chunks(&mut self, bytes: &[u8]) {
        for part in bytes.split_inclusive(|b| *b == b'\n') {
            let complete = part.last() == Some(&b'\n');
            if !self.skipping {
                if self.pending.len() + part.len() > LINE_LIMIT { self.pending.clear(); self.skipping = true; }
                else { self.pending.extend_from_slice(part); }
            }
            if complete {
                if !self.skipping { let line = std::mem::take(&mut self.pending); self.event(&line); }
                self.pending.clear(); self.skipping = false;
            }
        }
    }

    fn read(&mut self, path: &Path) -> std::io::Result<()> {
        let mut file = File::open(path)?;
        let size = file.metadata()?.len();
        if size < self.offset { *self = Self::default(); }
        if self.offset == 0 {
            // Metadata only, bounded; don't read a multi-day chat into memory.
            let mut head = Vec::new();
            (&mut file).take(256 * 1024).read_to_end(&mut head)?;
            if let Some(end) = head.iter().position(|b| *b == b'\n') { self.event(&head[..end]); }
            self.offset = size.saturating_sub(TAIL);
            self.skipping = self.offset > 0;
        }
        file.seek(SeekFrom::Start(self.offset))?;
        // Bound work per poll even if a tool appends a very large output.
        let mut bytes = Vec::new();
        (&mut file).take(TAIL).read_to_end(&mut bytes)?;
        self.offset += bytes.len() as u64;
        self.chunks(&bytes);
        Ok(())
    }
}

fn discover(root: &Path, depth: usize, out: &mut Vec<(PathBuf, SystemTime)>) {
    if depth > 4 { return; }
    let Ok(entries) = fs::read_dir(root) else { return };
    for entry in entries.flatten() {
        let Ok(kind) = entry.file_type() else { continue };
        if kind.is_symlink() { continue; }
        let path = entry.path();
        if kind.is_dir() { discover(&path, depth + 1, out); }
        else if path.extension().is_some_and(|v| v == "jsonl") {
            if let Ok(modified) = entry.metadata().and_then(|m| m.modified()) { out.push((path, modified)); }
        }
    }
}

pub fn start(app: AppHandle) {
    std::thread::spawn(move || {
        let root = crate::codex::settings_path().with_file_name("sessions");
        let mut cursors: HashMap<PathBuf, Cursor> = HashMap::new();
        let mut files = Vec::new();
        let mut tick = 0;
        loop {
            if tick % 5 == 0 {
                files.clear(); discover(&root, 0, &mut files);
                files.sort_by(|a, b| b.1.cmp(&a.1)); files.truncate(32);
                cursors.retain(|path, _| files.iter().any(|(p, _)| p == path));
            }
            let mut candidates = Vec::new();
            for (path, _) in &files {
                let Ok(meta) = fs::metadata(path) else { continue };
                let recent = meta.modified().ok().and_then(|m| m.elapsed().ok()).is_some_and(|d| d < Duration::from_secs(90));
                if !recent && !cursors.contains_key(path) { continue; }
                let cursor = cursors.entry(path.clone()).or_default();
                let first = cursor.offset == 0;
                if cursor.read(path).is_err() { continue; }
                if let Some(mut update) = cursor.update.clone() {
                    if first && !cursor.active { update.state = "idle".into(); update.step = "Session idle".into(); cursor.update = Some(update.clone()); }
                    if cursor.active && !recent { update.state = "unknown".into(); update.step = "Live status unavailable".into(); }
                    candidates.push((cursor.active && recent, update));
                }
            }
            candidates.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| b.1.timestamp.cmp(&a.1.timestamp)));
            let next = candidates.into_iter().next().map(|(_, update)| update).or_else(|| {
                // Removed/archived/unreadable rollout is not proof of completion.
                app.state::<LiveState>().0.lock().unwrap().clone().map(|mut update| {
                    update.state = "unknown".into(); update.step = "Live status unavailable".into(); update
                })
            });
            if let Some(update) = next {
                let state = app.state::<LiveState>();
                let mut previous = state.0.lock().unwrap();
                if previous.as_ref() != Some(&update) {
                    crate::log::line(format!("codex live {}", update.state));
                    let _ = app.emit_to(crate::island::WINDOW_LABEL, "codex-live", &update);
                    *previous = Some(update);
                }
            }
            tick += 1;
            std::thread::sleep(Duration::from_secs(1));
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    fn cursor() -> Cursor { Cursor { id: "test-session".into(), ..Default::default() } }
    fn line(kind: &str) -> Vec<u8> { format!("{{\"timestamp\":\"2026-10-01T17:00:00Z\",\"type\":\"event_msg\",\"payload\":{{\"type\":\"{kind}\"}}}}\n").into_bytes() }
    #[test] fn lifecycle_and_partial_lines() {
        let mut c = cursor(); let bytes = line("task_started");
        c.chunks(&bytes[..15]); assert!(c.update.is_none()); c.chunks(&bytes[15..]);
        assert!(c.active); assert_eq!(c.update.as_ref().unwrap().state, "thinking");
        c.chunks(&line("task_complete")); assert!(!c.active); assert_eq!(c.update.as_ref().unwrap().state, "finished");
        c.chunks(&line("task_started")); c.chunks(&line("turn_aborted")); assert!(!c.active);
    }
    #[test] fn no_permissions_or_sensitive_content() {
        let mut c = cursor(); c.chunks(&line("task_started"));
        c.event(br#"{"timestamp":"next","type":"response_item","payload":{"type":"custom_tool_call","name":"exec","input":"SECRET"}}"#);
        assert_eq!(c.update.as_ref().unwrap().state, "working");
        assert!(!serde_json::to_string(&c.update).unwrap().contains("SECRET"));
        c.chunks(&line("PermissionRequest")); assert_eq!(c.update.as_ref().unwrap().state, "working");
    }
    #[test] fn truncated_line_and_oversized_record_recovery() {
        let mut c = cursor(); c.skipping = true; c.chunks(b"partial\n"); c.chunks(&line("task_started")); assert!(c.active);
        c.chunks(&vec![b'x'; LINE_LIMIT + 1]); c.chunks(b"\n"); c.chunks(&line("task_complete")); assert!(!c.active); assert!(c.pending.is_empty());
    }
    #[test] fn historical_tools_do_not_imply_active_work() {
        let mut c = cursor(); c.event(br#"{"timestamp":"old","type":"response_item","payload":{"type":"function_call"}}"#); assert!(c.update.is_none());
        assert!(!safe_id("../secret"));
    }
}
