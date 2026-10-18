//! Bounded native operators: observe allowlisted running apps and verify focus.
//! Launch is restricted to canonical installed main executables; no arbitrary commands.
use std::path::PathBuf;
use std::collections::VecDeque;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FocusTarget {
    pub window_id: String,
    pub process_id: u32,
    pub image_path_fingerprint: String,
    pub observation_id: String,
    pub observation_generation: u64,
}

#[derive(Clone)]
struct FocusLease {
    session_id: String,
    target: FocusTarget,
    window: AppWindow,
    issued: Instant,
}

const FOCUS_TTL: Duration = Duration::from_secs(15);
const MAX_FOCUS_LEASES: usize = 16;
static FOCUS_LEASES: OnceLock<Mutex<VecDeque<FocusLease>>> = OnceLock::new();

fn leases() -> &'static Mutex<VecDeque<FocusLease>> {
    FOCUS_LEASES.get_or_init(|| Mutex::new(VecDeque::new()))
}

fn fingerprint(path: &std::path::Path) -> String {
    let mut digest = Sha256::new();
    digest.update(b"edith-native-focus-path-v1\0");
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        for unit in path.as_os_str().encode_wide() { digest.update(unit.to_le_bytes()); }
    }
    #[cfg(not(windows))]
    digest.update(path.as_os_str().as_encoded_bytes());
    format!("{:x}", digest.finalize())
}

fn issued_window(session_id: &str, app: AllowedApp, target: &FocusTarget) -> Result<AppWindow, String> {
    let mut cache = leases().lock().map_err(|_| "focus lease cache unavailable".to_string())?;
    cache.retain(|lease| lease.issued.elapsed() < FOCUS_TTL);
    cache.iter().find(|lease| lease.session_id == session_id && lease.window.app == app && lease.target == *target)
        .map(|lease| lease.window.clone()).ok_or_else(|| "focus target was not issued for this session, app, and observation, or has expired".into())
}

pub fn invalidate_focus_targets() {
    // Recover a poisoned cache only to revoke all leases; issuance/validation fail closed.
    match leases().lock() { Ok(mut cache) => cache.clear(), Err(poisoned) => poisoned.into_inner().clear() }
}

pub fn issue_focus(session_id: &str, observation_id: &str, generation: u64, app: AllowedApp) -> Result<FocusTarget, String> {
    if session_id.is_empty() || session_id.len() > 1024 || observation_id.is_empty() || observation_id.len() > 1024 || generation == 0 {
        return Err("focus issuance requires bounded session and observation identities".into());
    }
    let mut candidates = locate(app)?;
    #[cfg(windows)]
    candidates.retain(|window| unsafe { win::eligible(window.handle) });
    if candidates.len() != 1 { return Err("focus issuance requires exactly one eligible installed-app window".into()); }
    let window = candidates.remove(0);
    #[cfg(windows)]
    win::verify(&window, &|| Ok(()))?;
    let target = FocusTarget { window_id: format!("hwnd:{:x}", window.handle), process_id: window.process_id,
        image_path_fingerprint: fingerprint(&window.image_path), observation_id: observation_id.into(), observation_generation: generation };
    let mut cache = leases().lock().map_err(|_| "focus lease cache unavailable".to_string())?;
    cache.retain(|lease| lease.issued.elapsed() < FOCUS_TTL);
    while cache.len() >= MAX_FOCUS_LEASES { cache.pop_front(); }
    cache.push_back(FocusLease { session_id: session_id.into(), target: target.clone(), window, issued: Instant::now() });
    Ok(target)
}

pub fn validate_focus(session_id: &str, app: AllowedApp, target: &FocusTarget) -> Result<AppWindow, String> {
    let window = issued_window(session_id, app, target)?;
    if target.window_id != format!("hwnd:{:x}", window.handle) || target.process_id != window.process_id
        || target.image_path_fingerprint != fingerprint(&window.image_path) {
        return Err("focus target identity does not match its native lease".into());
    }
    #[cfg(windows)]
    { win::verify(&window, &|| Ok(()))?; issued_window(session_id, app, target)?; Ok(window) }
    #[cfg(not(windows))]
    Err("native app operators require Windows".into())
}

pub fn focus_issued(session_id: &str, app: AllowedApp, target: &FocusTarget, guard: &dyn Fn() -> Result<(), String>) -> Result<FocusReceipt, String> {
    let checked_guard = || { guard()?; issued_window(session_id, app, target)?; Ok(()) };
    checked_guard()?;
    // Cache lookup has no native readback; focus_guarded supplies the caller's
    // guard around each fresh identity operation instead of using a no-op guard.
    let window = issued_window(session_id, app, target)?;
    checked_guard()?;
    #[cfg(windows)]
    { win::focus_guarded(&window, &checked_guard) }
    #[cfg(not(windows))]
    { let _ = window; Err("native app operators require Windows".into()) }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AllowedApp { Spotify, Steam, Explorer }

#[derive(Clone, Debug)]
pub struct AppWindow {
    pub app: AllowedApp,
    pub handle: usize,
    pub process_id: u32,
    pub image_path: PathBuf,
    pub title: String,
}

#[derive(Clone, Debug)]
pub struct OpenedApp {
    pub window: AppWindow,
    pub launch_requested: bool,
    /// PID of the requested main process; may delegate to a different existing process.
    pub started_process_id: Option<u32>,
}

static OPEN_GATE: Mutex<()> = Mutex::new(());

pub fn ensure_open(app: AllowedApp, guard: &dyn Fn() -> Result<(), String>) -> Result<OpenedApp, String> {
    guard()?;
    let _gate = OPEN_GATE.try_lock().map_err(|_| "another installed-app open is active".to_string())?;
    guard()?;
    #[cfg(windows)]
    {
        let candidates = eligible_windows(app, guard)?;
        if candidates.len() > 1 { return Err("installed-app window selection is ambiguous".into()); }
        if let Some(window) = candidates.into_iter().next() {
            win::verify(&window, guard)?;
            guard()?;
            return Ok(OpenedApp { window, launch_requested: false, started_process_id: None });
        }
        guard()?;
        let name = match app { AllowedApp::Spotify => "Spotify.exe", AllowedApp::Steam => "steam.exe", AllowedApp::Explorer => "explorer.exe" };
        let mut paths: Vec<PathBuf> = expected_paths(app).into_iter().filter(|path| {
            path.file_name().is_some_and(|file| file.to_string_lossy().eq_ignore_ascii_case(name))
        }).collect();
        paths.sort(); paths.dedup();
        guard()?;
        if paths.len() != 1 { return Err("exactly one canonical installed main executable is required".into()); }
        let executable = paths.remove(0);
        guard()?;
        let canonical_result = executable.canonicalize();
        guard()?;
        let canonical = canonical_result.map_err(|_| "installed main executable disappeared".to_string())?;
        guard()?;
        let is_file = canonical.is_file();
        guard()?;
        if canonical != executable || !is_file { return Err("installed main executable identity changed".into()); }
        use std::os::windows::process::CommandExt;
        guard()?;
        let spawn_result = std::process::Command::new(&executable)
            .stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null())
            .creation_flags(0x08000000) // CREATE_NO_WINDOW; GUI app still owns its actual app window.
            .spawn();
        // A cancellation here cannot undo a process request already accepted by Windows.
        let spawn_guard = guard();
        let child = match spawn_result {
            Ok(child) => child,
            Err(error) => { spawn_guard?; return Err(format!("installed main executable launch failed: {error}")); }
        };
        let started_pid = child.id();
        spawn_guard.map_err(|error| format!("{error}; installed-app launch requested (started PID {started_pid})"))?;
        drop(child); // Release our process handles, never terminate an app or delegated process.
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            guard()?;
            if Instant::now() >= deadline { return Err("installed-app window observation deadline expired after launch request".into()); }
            let candidates = eligible_windows(app, guard)?;
            if Instant::now() >= deadline { return Err("installed-app window observation exceeded five-second polling deadline".into()); }
            if candidates.len() > 1 { return Err("installed-app launch produced ambiguous eligible windows".into()); }
            if let Some(window) = candidates.into_iter().next() {
                win::verify(&window, guard)?;
                guard()?;
                return Ok(OpenedApp { window, launch_requested: true, started_process_id: Some(started_pid) });
            }
            if Instant::now() >= deadline { return Err("installed-app launch requested but no unique eligible window was observed within five seconds".into()); }
            guard()?;
            std::thread::sleep(Duration::from_millis(50).min(deadline.saturating_duration_since(Instant::now())));
            guard()?;
        }
    }
    #[cfg(not(windows))]
    { let _ = app; Err("native installed-app opening requires Windows".into()) }
}

#[cfg(windows)]
fn eligible_windows(app: AllowedApp, guard: &dyn Fn() -> Result<(), String>) -> Result<Vec<AppWindow>, String> {
    guard()?;
    let result = locate(app);
    guard()?;
    let mut candidates = result?;
    candidates.retain(|window| unsafe { win::eligible(window.handle) });
    guard()?;
    for window in &candidates { win::verify(window, guard)?; }
    guard()?;
    Ok(candidates)
}

#[derive(Clone, Debug)]
pub struct FocusReceipt {
    pub app: AllowedApp,
    pub handle: usize,
    pub process_id: u32,
    pub image_path: PathBuf,
    /// True only after querying the foreground window and process again.
    pub foreground_verified: bool,
    pub activation_requested:bool,
}

fn expected_paths(app: AllowedApp) -> Vec<PathBuf> {
    let candidates: &[(&str, &str)] = match app {
        AllowedApp::Spotify => &[("LOCALAPPDATA", "Spotify\\Spotify.exe"), ("APPDATA", "Spotify\\Spotify.exe")],
        AllowedApp::Steam => &[("ProgramFiles(x86)", "Steam\\steam.exe"), ("ProgramFiles", "Steam\\steam.exe"), ("ProgramFiles(x86)", "Steam\\bin\\cef\\cef.win64\\steamwebhelper.exe"), ("ProgramFiles", "Steam\\bin\\cef\\cef.win64\\steamwebhelper.exe")],
        AllowedApp::Explorer => &[("SystemRoot", "explorer.exe")],
    };
    candidates.iter().filter_map(|(variable, suffix)| {
        std::env::var_os(variable).map(PathBuf::from).map(|p| p.join(suffix))
            .and_then(|p| p.canonicalize().ok())
    }).collect()
}

/// Reports eligible visible windows, not installation or workflow readiness.
pub fn locate(app: AllowedApp) -> Result<Vec<AppWindow>, String> {
    #[cfg(windows)]
    { win::locate(app) }
    #[cfg(not(windows))]
    { let _ = app; Err("native app operators require Windows".into()) }
}

/// Identity is revalidated before focusing. Windows may deny foreground activation.
/// The caller must treat an error as an unperformed action; presence is insufficient.
pub fn focus(window: &AppWindow) -> Result<FocusReceipt, String> {
    #[cfg(windows)]
    { win::focus(window) }
    #[cfg(not(windows))]
    { let _ = window; Err("native app operators require Windows".into()) }
}

#[cfg(windows)]
mod win {
    use super::*;
    use std::time::{Duration, Instant};
    use windows_sys::Win32::Foundation::*;
    use windows_sys::Win32::System::Threading::*;
    use windows_sys::Win32::UI::WindowsAndMessaging::*;

    unsafe fn identity(hwnd: HWND) -> Result<(u32, PathBuf), String> {
        if IsWindow(hwnd) == 0 { return Err("app window no longer exists".into()); }
        let mut pid = 0;
        GetWindowThreadProcessId(hwnd, &mut pid);
        if pid == 0 { return Err("app process unavailable".into()); }
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if process.is_null() { return Err("app process identity is inaccessible".into()); }
        let mut image = vec![0u16; 32768];
        let mut len = image.len() as u32;
        let ok = QueryFullProcessImageNameW(process, 0, image.as_mut_ptr(), &mut len);
        CloseHandle(process);
        if ok == 0 { return Err("app process path query failed".into()); }
        use std::os::windows::ffi::OsStringExt;
        let path = PathBuf::from(std::ffi::OsString::from_wide(&image[..len as usize]));
        let canonical = path.canonicalize().map_err(|_| "app process path cannot be verified".to_string())?;
        Ok((pid, canonical))
    }

    fn same_path(left: &std::path::Path, right: &std::path::Path) -> bool {
        // Canonical paths here originate from the Windows filesystem and process query.
        left.as_os_str().to_string_lossy().eq_ignore_ascii_case(&right.as_os_str().to_string_lossy())
    }

    pub(super) unsafe fn eligible(handle: usize) -> bool {
        let hwnd = handle as HWND;
        IsWindow(hwnd) != 0 && IsWindowVisible(hwnd) != 0 && IsIconic(hwnd) == 0 && GetWindow(hwnd, GW_OWNER).is_null()
    }

    pub(super) fn verify(window: &AppWindow, guard: &dyn Fn() -> Result<(), String>) -> Result<(), String> {
        guard()?;
        let result = unsafe { identity(window.handle as HWND) };
        guard()?;
        let (pid, path) = result?;
        if pid != window.process_id || !same_path(&path, &window.image_path)
            || fingerprint(&path) != fingerprint(&window.image_path)
            || !expected_paths(window.app).iter().any(|expected| same_path(expected, &path)) {
            return Err("app process identity changed or is outside the allowlist".into());
        }
        guard()?;
        let eligible = unsafe { eligible(window.handle) };
        guard()?;
        if !eligible { return Err("focus requires an eligible visible non-minimized app window".into()); }
        Ok(())
    }

    struct Search { app: AllowedApp, expected: Vec<PathBuf>, windows: Vec<AppWindow>,visited:usize }
    unsafe extern "system" fn collect(hwnd: HWND, param: LPARAM) -> i32 {
        let search = &mut *(param as *mut Search);
        search.visited+=1;
        if search.visited>512{return 0;}
        if IsWindowVisible(hwnd) == 0 || GetWindow(hwnd, GW_OWNER) != std::ptr::null_mut() { return 1; }
        if let Ok((pid, path)) = identity(hwnd) {
            if search.expected.iter().any(|candidate| same_path(candidate, &path)) {
                let mut title = [0u16; 1024];
                let len = GetWindowTextW(hwnd, title.as_mut_ptr(), title.len() as i32).max(0) as usize;
                search.windows.push(AppWindow { app: search.app, handle: hwnd as usize, process_id: pid,
                    image_path: path, title: String::from_utf16_lossy(&title[..len]) });
            }
        }
        1
    }

    pub(super) fn locate(app: AllowedApp) -> Result<Vec<AppWindow>, String> {
        let expected = expected_paths(app);
        if expected.is_empty() { return Err("no allowlisted installed executable path was verified".into()); }
        let mut search = Search { app, expected, windows: Vec::new(),visited:0 };
        unsafe {
            if EnumWindows(Some(collect), &mut search as *mut Search as isize) == 0 {
                return Err(if search.visited>512 {"app window enumeration budget exceeded".into()} else {format!("app window enumeration failed: {}", GetLastError())});
            }
        }
        Ok(search.windows)
    }

    pub(super) fn focus(window: &AppWindow) -> Result<FocusReceipt, String> {
        focus_guarded(window, &|| Ok(()))
    }

    pub(super) fn focus_guarded(window: &AppWindow, guard: &dyn Fn() -> Result<(), String>) -> Result<FocusReceipt, String> {
        verify(window, guard)?;
        unsafe {
            let hwnd = window.handle as HWND;
            guard()?;
            let already_focused = GetForegroundWindow() == hwnd;
            guard()?;
            if !already_focused {
                verify(window, guard)?;
                guard()?;
                let activated = SetForegroundWindow(hwnd);
                guard()?;
                if activated == 0 { return Err("Windows denied foreground activation".into()); }
            }
            let deadline = Instant::now() + Duration::from_millis(350);
            loop {
                guard()?;
                let foreground = GetForegroundWindow();
                guard()?;
                if foreground == hwnd {
                    verify(window, guard)?;
                    guard()?;
                    let identity_result = identity(hwnd);
                    guard()?;
                    let (pid, path) = identity_result?;
                    if pid != window.process_id || !same_path(&path, &window.image_path)
                        || fingerprint(&path) != fingerprint(&window.image_path) {
                        return Err("app identity changed during focus verification".into());
                    }
                    guard()?;
                    let final_foreground = GetForegroundWindow();
                    guard()?;
                    if final_foreground != hwnd { return Err("foreground changed during focus verification".into()); }
                    return Ok(FocusReceipt { app: window.app, handle: window.handle, process_id: pid,
                        image_path: path, foreground_verified: true,activation_requested:!already_focused });
                }
                if Instant::now() >= deadline { return Err("foreground focus postcondition was not observed".into()); }
                guard()?;
                std::thread::sleep(Duration::from_millis(10).min(deadline.saturating_duration_since(Instant::now())));
                guard()?;
            }
        }
    }
}
