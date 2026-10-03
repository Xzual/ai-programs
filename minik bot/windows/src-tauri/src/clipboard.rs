//! Opt-in, memory-only text history. Never logged, persisted or sent to models.
use std::{sync::{Mutex, Condvar}, time::{Duration, SystemTime, UNIX_EPOCH}};
use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use windows::{core::w, Win32::{Foundation::{HGLOBAL, HANDLE, GlobalFree}, System::{DataExchange::*, Memory::*}}};
#[derive(Clone, Serialize)] pub struct Entry { id: u64, text: String, timestamp: u64 }
#[derive(Clone, Serialize)] pub struct Snapshot { enabled: bool, entries: Vec<Entry> }
#[derive(Default)] pub struct History(Mutex<Inner>, Condvar);
#[derive(Default)] struct Inner { enabled: bool, entries: Vec<Entry>, sequence: u32, next: u64 }
struct Open;
impl Drop for Open { fn drop(&mut self) { unsafe { let _ = CloseClipboard(); } } }
fn sensitive(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    ["-----begin", "authorization:", "bearer ", "api_key", "apikey", "api-key", "password=", "password:", "secret=", "token=", "sk-", "AIza"].iter().any(|v| lower.contains(&v.to_ascii_lowercase()))
        || (text.len() == 6 && text.bytes().all(|c| c.is_ascii_digit()))
}
fn read_text() -> Result<Option<String>, ()> { unsafe {
    OpenClipboard(None).map_err(|_| ())?;
    let _open = Open;
    Ok(read_open_text())
} }
fn read_open_text() -> Option<String> { unsafe {
    let exclude = RegisterClipboardFormatW(w!("ExcludeClipboardContentFromMonitorProcessing"));
    let history = RegisterClipboardFormatW(w!("CanIncludeInClipboardHistory"));
    if exclude == 0 || history == 0 || IsClipboardFormatAvailable(exclude).is_ok() { return None; }
    if IsClipboardFormatAvailable(history).is_ok() {
        let handle = HGLOBAL(GetClipboardData(history).ok()?.0);
        if GlobalSize(handle) < 4 { return None; }
        let ptr = GlobalLock(handle) as *const u32; if ptr.is_null() { return None; }
        let allowed = ptr.read_unaligned() != 0; let _ = GlobalUnlock(handle); if !allowed { return None; }
    }
    if IsClipboardFormatAvailable(13).is_err() { return None; }
    let handle = HGLOBAL(GetClipboardData(13).ok()?.0);
    let size = GlobalSize(handle); if size < 2 || size > 32 * 1024 { return None; }
    let ptr = GlobalLock(handle) as *const u16; if ptr.is_null() { return None; }
    let raw = std::slice::from_raw_parts(ptr, size / 2);
    let end = raw.iter().position(|v| *v == 0).unwrap_or(raw.len());
    let text = String::from_utf16(&raw[..end]).ok(); let _ = GlobalUnlock(handle);
    text.filter(|s| !s.trim().is_empty() && !sensitive(s))
} }
fn insert(inner: &mut Inner, text: String) {
    inner.entries.retain(|e| e.text != text);
    inner.next += 1; inner.entries.insert(0, Entry { id:inner.next, text, timestamp:SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs() });
    inner.entries.truncate(50);
}
pub fn start(app: AppHandle) {
    std::thread::spawn(move || loop {
        let state = app.state::<History>();
        {
            let mut inner = state.0.lock().unwrap();
            while !inner.enabled { inner = state.1.wait(inner).unwrap(); }
        }
        std::thread::sleep(Duration::from_millis(500));
        let sequence = unsafe { GetClipboardSequenceNumber() };
        let previous = {
            let mut inner = state.0.lock().unwrap();
            if !inner.enabled || crate::integrations::PAUSED.load(std::sync::atomic::Ordering::Relaxed) {
                inner.sequence = sequence; continue;
            }
            if sequence == inner.sequence { continue; }
            inner.sequence
        };
        // A busy clipboard is retried; it must not silently lose the new entry.
        // Delayed rendering never holds our history mutex or blocks UI commands.
        let Ok(text) = read_text() else { continue; };
        if unsafe { GetClipboardSequenceNumber() } != sequence { continue; }
        let mut inner = state.0.lock().unwrap();
        if !inner.enabled || inner.sequence != previous || crate::integrations::PAUSED.load(std::sync::atomic::Ordering::Relaxed) { continue; }
        inner.sequence = sequence;
        if let Some(text) = text { insert(&mut inner, text); }
    });
}
#[tauri::command] pub fn clipboard_snapshot(state: State<History>) -> Snapshot { let inner = state.0.lock().unwrap(); Snapshot { enabled:inner.enabled, entries:inner.entries.clone() } }
#[tauri::command] pub fn clipboard_enabled(enabled: bool, state: State<History>) { let mut inner = state.0.lock().unwrap(); inner.enabled = enabled; inner.sequence = unsafe { GetClipboardSequenceNumber() }; state.1.notify_all(); }
#[tauri::command] pub fn clipboard_remove(id: Option<u64>, state: State<History>) { let mut inner = state.0.lock().unwrap(); if let Some(id) = id { inner.entries.retain(|e| e.id != id); } else { inner.entries.clear(); } }
#[tauri::command] pub fn clipboard_copy(id: u64, app: AppHandle, state: State<History>) -> Result<(), String> {
    let mut inner = state.0.lock().unwrap();
    let text = &inner.entries.iter().find(|e| e.id == id).ok_or("Pano kaydı bulunamadı.")?.text;
    let chars: Vec<u16> = text.encode_utf16().chain(Some(0)).collect();
    let hwnd = app.get_webview_window("island").ok_or("Bot penceresi yok.")?.hwnd().map_err(|_| "Bot penceresi bulunamadı.")?;
    unsafe {
        OpenClipboard(Some(windows::Win32::Foundation::HWND(hwnd.0))).map_err(|_| "Pano başka bir uygulama tarafından kullanılıyor; tekrar dene.")?; let _open = Open;
        let mem = GlobalAlloc(GMEM_MOVEABLE, chars.len()*2).map_err(|_| "Pano belleği ayrılamadı.")?;
        let ptr = GlobalLock(mem) as *mut u16;
        if ptr.is_null() { let _ = GlobalFree(Some(mem)); return Err("Pano belleği açılamadı.".into()); }
        std::ptr::copy_nonoverlapping(chars.as_ptr(), ptr, chars.len()); let _ = GlobalUnlock(mem);
        if EmptyClipboard().is_err() || SetClipboardData(13, Some(HANDLE(mem.0))).is_err() { let _ = GlobalFree(Some(mem)); return Err("Panoya kopyalanamadı.".into()); }
        inner.sequence = GetClipboardSequenceNumber();
    }
    Ok(())
}
#[cfg(test)] mod tests { use super::*;
    #[test] fn history_is_bounded_and_deduplicated() { let mut inner=Inner::default(); for n in 0..60 { insert(&mut inner, format!("entry {n}")); } assert_eq!(inner.entries.len(),50); insert(&mut inner,"entry 42".into()); assert_eq!(inner.entries.len(),50); assert_eq!(inner.entries[0].text,"entry 42"); }
    #[test] fn obvious_secrets_are_filtered() { for s in ["123456","Bearer abcd","API_KEY=abcd","-----BEGIN PRIVATE KEY-----","password=hello"] { assert!(sensitive(s)); } assert!(!sensitive("Çalışma notlarım")); }
}
