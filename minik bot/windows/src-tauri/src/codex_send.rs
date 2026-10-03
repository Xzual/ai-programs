//! Owner-clicked messages only. Queue into the existing chat without resuming
//! its writer, creating a thread, changing model, or bypassing permissions.
use std::{os::windows::process::CommandExt, process::{Command, Stdio}, sync::{atomic::{AtomicBool, Ordering}, Arc}, time::{Duration, Instant}};
use serde::Serialize;

#[derive(Default)]
pub struct SendGate(pub Arc<AtomicBool>);
struct Release(Arc<AtomicBool>);
impl Drop for Release { fn drop(&mut self) { self.0.store(false, Ordering::Release); } }

#[derive(Serialize)]
pub struct Receipt { pub status: &'static str }

fn arguments(thread: &str, message: &str) -> Result<Vec<String>, String> {
    if thread.is_empty() || thread.len() > 128 || !thread.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_') {
        return Err("Önce bir Codex sohbetine bağlan.".into());
    }
    if message.trim().is_empty() || message.len() > 16_000 || message.contains('\0') {
        return Err("Mesaj boş olmamalı ve en fazla 16 KB olmalı.".into());
    }
    Ok(vec!["queue".into(), "--thread".into(), thread.into(), "--message".into(), message.into()])
}

pub async fn queue(thread: String, message: String, gate: Arc<AtomicBool>) -> Result<Receipt, String> {
    let args = arguments(&thread, &message)?;
    if gate.swap(true, Ordering::AcqRel) { return Err("Önceki mesaj hâlâ gönderiliyor.".into()); }
    let release = Release(gate);
    tauri::async_runtime::spawn_blocking(move || {
        let _release = release;
        // Pass text as an argument, never through cmd/PowerShell interpolation.
        // No prompt contents in logs, stdout or stderr.
        let mut child = Command::new("codex").args(args).creation_flags(0x0800_0000)
            .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn()
            .map_err(|_| "Codex komutu bulunamadı veya başlatılamadı.".to_string())?;
        let deadline = Instant::now() + Duration::from_secs(20);
        loop {
            match child.try_wait() {
                Ok(Some(status)) if status.success() => return Ok(Receipt { status: "queued" }),
                Ok(Some(_)) => return Err("Codex mesajı kuyruğa alamadı. Taslağın korundu.".into()),
                Err(_) => { let _ = child.kill(); let _ = child.wait(); return Err("Gönderim sonucu doğrulanamadı; tekrar göndermeden sohbeti kontrol et.".into()); }
                Ok(None) => {}
            }
            if Instant::now() >= deadline {
                let _ = child.kill(); let _ = child.wait();
                return Err("Gönderim zaman aşımı: sonuç belirsiz. Tekrar göndermeden sohbeti kontrol et.".into());
            }
            std::thread::sleep(Duration::from_millis(100));
        }
    }).await.map_err(|_| "Gönderim sonucu doğrulanamadı.".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn owner_text_is_data_not_shell_code() {
        let text = "Türkçe mesaj & $(echo sensitive) \"quoted\"";
        assert_eq!(arguments("thread-123", text).unwrap(), ["queue", "--thread", "thread-123", "--message", text]);
        assert!(arguments("../new", "hi").is_err()); assert!(arguments("", "hi").is_err());
        assert!(arguments("thread-123", "  ").is_err()); assert!(arguments("thread-123", &"x".repeat(16001)).is_err());
    }
    #[test] fn send_gate_releases_on_error_or_success() {
        let gate = Arc::new(AtomicBool::new(true)); { let _r = Release(gate.clone()); }
        assert!(!gate.load(Ordering::Acquire));
    }
}
