use windows::core::PCWSTR;
use windows::Win32::Foundation::HWND;
use windows::Win32::UI::Shell::ShellExecuteW;
use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

fn target(session_id: Option<&str>) -> Result<String, String> {
    if let Some(id) = session_id.filter(|id| !id.is_empty()) {
        // Hook IDs are data, never executable paths or arbitrary URL input.
        if id.len() > 128 || !id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_') {
            return Err("Invalid Codex session ID.".into());
        }
        return Ok(format!("codex://threads/{id}"));
    }
    // Version-independent app ID, verified against the installed Windows manifest.
    // Open the app, not a new chat, a terminal, VS Code, or an installer.
    Ok("shell:AppsFolder\\OpenAI.Codex_2p2nqsd0c76g0!App".into())
}

pub fn open(session_id: Option<&str>) -> Result<(), String> {
    let target: Vec<u16> = target(session_id)?.encode_utf16().chain(Some(0)).collect();
    let operation: Vec<u16> = "open".encode_utf16().chain(Some(0)).collect();
    let result = unsafe {
        ShellExecuteW(Some(HWND::default()), PCWSTR(operation.as_ptr()), PCWSTR(target.as_ptr()),
            PCWSTR::null(), PCWSTR::null(), SW_SHOWNORMAL)
    };
    if result.0 as usize <= 32 { return Err("Cannot open Codex. Check that the desktop app is installed.".into()); }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn opens_codex_not_vscode_or_new_chat() {
        assert_eq!(target(None).unwrap(), "shell:AppsFolder\\OpenAI.Codex_2p2nqsd0c76g0!App");
        assert_eq!(target(Some("thread-123")).unwrap(), "codex://threads/thread-123");
        assert!(target(Some("../new?prompt=execute")).is_err());
        assert!(target(Some("https://evil.test")).is_err());
    }
}
