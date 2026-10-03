use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::State;

const SESSION_TTL: Duration = Duration::from_secs(300);
const OBSERVATION_TTL: Duration = Duration::from_secs(15);

#[derive(Clone)]
struct SafetyBridge {
    token: String,
    port: u16,
}

pub struct ComputerState {
    session: Mutex<Option<ComputerSession>>,
    stopped: Arc<AtomicBool>,
    bridge: Mutex<Option<SafetyBridge>>,
    observation_generation: AtomicU64,
    last_observation: Mutex<Option<ObservationContext>>,
}

impl Default for ComputerState {
    fn default() -> Self {
        let bridge = std::env::var("EDITH_DESKTOP_BRIDGE_TOKEN")
            .ok()
            .filter(|value| value.len() >= 32)
            .map(|token| SafetyBridge { token, port: 3000 });
        Self {
            session: Mutex::new(None),
            stopped: Arc::new(AtomicBool::new(false)),
            bridge: Mutex::new(bridge),
            observation_generation: AtomicU64::new(0),
            last_observation: Mutex::new(None),
        }
    }
}

impl ComputerState {
    #[cfg(not(debug_assertions))]
    pub fn configure_bridge(&self, token: String, port: u16) {
        if token.len() >= 32 && port > 0 {
            if let Ok(mut bridge) = self.bridge.lock() {
                *bridge = Some(SafetyBridge { token, port });
            }
        }
    }

    pub fn clear_bridge(&self) {
        if let Ok(mut bridge) = self.bridge.lock() {
            bridge.take();
        }
        self.stopped.store(true, Ordering::SeqCst);
        if let Ok(mut session) = self.session.lock() {
            session.take();
        }
        if let Ok(mut observation) = self.last_observation.lock() {
            observation.take();
        }
    }

    pub(crate) fn ensure_kill_switch_inactive(&self) -> Result<(), String> {
        check_kill_switch(self)
    }

    pub(crate) fn session_active(&self) -> bool {
        !self.stopped.load(Ordering::SeqCst)
            && self
                .session
                .lock()
                .ok()
                .and_then(|guard| {
                    guard
                        .as_ref()
                        .map(|session| SystemTime::now() < session.expires_at)
                })
                .unwrap_or(false)
    }
}

struct ComputerSession {
    id: String,
    expires_at: SystemTime,
}

#[derive(Clone, Debug)]
struct ObservationContext {
    observation_id: String,
    generation: u64,
    expires_at: u64,
    window_id: String,
    monitor_id: String,
    window_bounds: PhysicalBounds,
    virtual_bounds: PhysicalBounds,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhysicalBounds {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerStatus {
    pub runtime: &'static str,
    pub mode: &'static str,
    pub available: bool,
    pub screen_capture: &'static str,
    pub mouse_control: &'static str,
    pub keyboard_control: &'static str,
    pub owner_command_mode: bool,
    pub kill_switch: &'static str,
    pub overlay: &'static str,
    pub targeting: &'static str,
    pub uia: &'static str,
    pub ocr: &'static str,
    pub multi_monitor: &'static str,
    pub verification: &'static str,
    pub session_expires_at: Option<u64>,
    pub safe_message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Observation {
    pub observation_id: String,
    pub generation: u64,
    pub image_data_url: String,
    pub origin_x: i32,
    pub origin_y: i32,
    pub width: i32,
    pub height: i32,
    pub cursor_x: i32,
    pub cursor_y: i32,
    pub captured_at: u64,
    pub expires_at: u64,
    pub source: &'static str,
    pub confidence: f64,
    pub window_id: String,
    pub window_process_id: u32,
    pub window_bounds: PhysicalBounds,
    pub monitor_id: String,
    pub monitor_bounds: PhysicalBounds,
    pub scale_factor: f64,
    pub coordinate_space: &'static str,
    pub uia_available: bool,
    pub ocr_available: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionRequest {
    pub action_id: String,
    pub plan_id: String,
    pub step_id: String,
    pub observation_id: String,
    pub observation_generation: u64,
    pub expected_effect: String,
    pub max_attempts: u8,
    pub action: String,
    pub x: Option<i32>,
    pub y: Option<i32>,
    pub button: Option<String>,
    pub text: Option<String>,
    pub key: Option<String>,
    pub keys: Option<Vec<String>>,
    pub delta: Option<i32>,
    pub app: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionResult {
    pub action_id: String,
    pub plan_id: String,
    pub step_id: String,
    pub action: String,
    pub injected: bool,
    pub dispatch_status: &'static str,
    pub cursor_x: i32,
    pub cursor_y: i32,
    pub verification: &'static str,
    pub verification_status: &'static str,
    pub pre_observation_id: String,
    pub attempts: u8,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn safety_bridge(state: &ComputerState) -> Result<SafetyBridge, String> {
    state
        .bridge
        .lock()
        .map_err(|_| "Native safety bridge state unavailable.")?
        .clone()
        .ok_or("Native safety bridge is not configured; Computer Use is blocked.".into())
}

fn check_kill_switch(state: &ComputerState) -> Result<(), String> {
    check_kill_switch_bridge(&safety_bridge(state)?)
}

fn check_kill_switch_bridge(bridge: &SafetyBridge) -> Result<(), String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .map_err(|_| "Could not initialize the local safety check.")?;
    let response = client
        .get(format!(
            "http://127.0.0.1:{}/api/computer-use/native-safety",
            bridge.port
        ))
        .bearer_auth(&bridge.token)
        .send()
        .map_err(|_| "Local backend unavailable; Computer Use is blocked.")?;
    if !response.status().is_success() {
        return Err("Could not verify the emergency stop state.".into());
    }
    let payload: serde_json::Value = response
        .json()
        .map_err(|_| "Invalid emergency stop response.")?;
    match payload
        .get("killSwitchActive")
        .and_then(|active| active.as_bool())
    {
        Some(false) => Ok(()),
        Some(true) => Err("Emergency stop is active. Computer Use is blocked.".into()),
        None => Err("Emergency stop state is missing; Computer Use is blocked.".into()),
    }
}

fn require_session(state: &ComputerState, session_id: &str) -> Result<(), String> {
    if state.stopped.load(Ordering::SeqCst) {
        return Err("Computer Use was stopped. Start a new approved session.".into());
    }
    let guard = state
        .session
        .lock()
        .map_err(|_| "Computer Use state unavailable.")?;
    match guard.as_ref() {
        Some(session) if session.id == session_id && SystemTime::now() < session.expires_at => {
            Ok(())
        }
        _ => Err("Computer Use session missing or expired. Owner approval is required.".into()),
    }
}

#[tauri::command]
pub fn computer_status(
    state: State<'_, ComputerState>,
    obsidian_picker: State<'_, crate::obsidian_picker::ObsidianVaultPickerState>,
) -> ComputerStatus {
    let safety = check_kill_switch(&state);
    if safety.is_err() {
        obsidian_picker.revoke_all("KILL_SWITCH_OR_SAFETY_UNAVAILABLE");
    }
    let expires = state.session.lock().ok().and_then(|guard| {
        guard.as_ref().and_then(|session| {
            session
                .expires_at
                .duration_since(UNIX_EPOCH)
                .ok()
                .map(|value| value.as_millis() as u64)
        })
    });
    let active = safety.is_ok()
        && expires.is_some_and(|time| time > now_ms())
        && !state.stopped.load(Ordering::SeqCst);
    let safety_ready = safety.is_ok();
    let kill_switch = match &safety {
        Ok(()) => "inactive",
        Err(message) if message.contains("Emergency stop is active") => "active",
        Err(_) => "unknown",
    };
    ComputerStatus {
        runtime: if cfg!(windows) { "tauri" } else { "unbound" },
        mode: if kill_switch == "active" {
            "disabled"
        } else if !safety_ready {
            "error"
        } else if active {
            "owner_command"
        } else {
            "read_only"
        },
        available: cfg!(windows) && safety_ready,
        screen_capture: if !cfg!(windows) {
            "missing"
        } else if !safety_ready {
            "error"
        } else if active {
            "ready"
        } else {
            "permission_required"
        },
        mouse_control: if !cfg!(windows) {
            "missing"
        } else if !safety_ready {
            "error"
        } else if active {
            "ready"
        } else {
            "permission_required"
        },
        keyboard_control: if !cfg!(windows) {
            "missing"
        } else if !safety_ready {
            "error"
        } else if active {
            "ready"
        } else {
            "permission_required"
        },
        owner_command_mode: active,
        kill_switch,
        overlay: "missing",
        targeting: "window_relative_fallback",
        uia: "missing",
        ocr: "missing",
        multi_monitor: if cfg!(windows) {
            "virtual_desktop"
        } else {
            "missing"
        },
        verification: "post_observation_required",
        session_expires_at: if active { expires } else { None },
        safe_message: match safety {
            Err(message) => message,
            Ok(()) if active => "Owner-approved local session is active.".into(),
            Ok(()) => "Desktop controls require a local approval session.".into(),
        },
    }
}

#[tauri::command]
pub fn computer_begin(
    window: tauri::Window,
    state: State<'_, ComputerState>,
) -> Result<String, String> {
    #[cfg(not(windows))]
    return Err("Computer Use native bridge is currently available on Windows only.".into());

    #[cfg(windows)]
    {
        check_kill_switch(&state)?;
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            MessageBoxW, IDYES, MB_DEFBUTTON2, MB_ICONWARNING, MB_SETFOREGROUND, MB_TOPMOST,
            MB_YESNO,
        };
        let owner = window
            .hwnd()
            .map_err(|_| "Could not bind the owner approval dialog to the E.D.I.T.H. window.")?
            .0;
        let message: Vec<u16> = "Allow E.D.I.T.H. to observe and control this computer for up to 5 minutes?\n\nOnly actions you start in Computer Use will run. Stop or Esc ends the session. Screen images stay in this desktop window.\0".encode_utf16().collect();
        let title: Vec<u16> = "E.D.I.T.H. Computer Use approval\0"
            .encode_utf16()
            .collect();
        let approved = unsafe {
            MessageBoxW(
                owner,
                message.as_ptr(),
                title.as_ptr(),
                MB_YESNO | MB_ICONWARNING | MB_DEFBUTTON2 | MB_SETFOREGROUND | MB_TOPMOST,
            ) == IDYES
        };
        if !approved {
            return Err("Owner did not approve Computer Use.".into());
        }
        check_kill_switch(&state)?;
        let id = format!("computer-{}", now_ms());
        let session = ComputerSession {
            id: id.clone(),
            expires_at: SystemTime::now() + SESSION_TTL,
        };
        *state
            .session
            .lock()
            .map_err(|_| "Computer Use state unavailable.")? = Some(session);
        state.stopped.store(false, Ordering::SeqCst);
        Ok(id)
    }
}

#[tauri::command]
pub fn computer_stop(state: State<'_, ComputerState>) -> Result<(), String> {
    state.stopped.store(true, Ordering::SeqCst);
    *state
        .session
        .lock()
        .map_err(|_| "Computer Use state unavailable.")? = None;
    Ok(())
}

#[tauri::command]
pub fn computer_observe(
    state: State<'_, ComputerState>,
    session_id: String,
) -> Result<Observation, String> {
    require_session(&state, &session_id)?;
    check_kill_switch(&state)?;
    observe_and_remember(&state)
}

#[tauri::command]
pub fn computer_screenshot(
    state: State<'_, ComputerState>,
    session_id: String,
) -> Result<Observation, String> {
    require_session(&state, &session_id)?;
    check_kill_switch(&state)?;
    observe_and_remember(&state)
}

#[tauri::command]
pub async fn computer_action(
    state: State<'_, ComputerState>,
    session_id: String,
    request: ActionRequest,
) -> Result<ActionResult, String> {
    require_session(&state, &session_id)?;
    check_kill_switch(&state)?;
    let observation = validate_action_context(&state, &request)?;
    let bridge = safety_bridge(&state)?;
    let stopped = Arc::clone(&state.stopped);
    tauri::async_runtime::spawn_blocking(move || {
        check_kill_switch_bridge(&bridge)?;
        platform::validate_foreground(&observation)?;
        platform::act(stopped.as_ref(), request, observation)
    })
    .await
    .map_err(|_| "Computer Use action worker failed.".to_string())?
}

fn observe_and_remember(state: &ComputerState) -> Result<Observation, String> {
    let generation = state.observation_generation.fetch_add(1, Ordering::SeqCst) + 1;
    let observation = platform::observe(generation)?;
    let context = ObservationContext {
        observation_id: observation.observation_id.clone(),
        generation: observation.generation,
        expires_at: observation.expires_at,
        window_id: observation.window_id.clone(),
        monitor_id: observation.monitor_id.clone(),
        window_bounds: observation.window_bounds.clone(),
        virtual_bounds: PhysicalBounds {
            x: observation.origin_x,
            y: observation.origin_y,
            width: observation.width,
            height: observation.height,
        },
    };
    *state
        .last_observation
        .lock()
        .map_err(|_| "Observation state unavailable.")? = Some(context);
    Ok(observation)
}

fn validate_action_context(
    state: &ComputerState,
    request: &ActionRequest,
) -> Result<ObservationContext, String> {
    if request.action_id.trim().is_empty()
        || request.plan_id.trim().is_empty()
        || request.step_id.trim().is_empty()
        || request.expected_effect.trim().is_empty()
    {
        return Err(
            "action_context_missing: action, plan, step and expected effect are required.".into(),
        );
    }
    if request.max_attempts == 0 || request.max_attempts > 2 {
        return Err("retry_budget_invalid: maxAttempts must be 1 or 2.".into());
    }
    let observation = state
        .last_observation
        .lock()
        .map_err(|_| "Observation state unavailable.")?
        .clone()
        .ok_or("observation_required: observe immediately before acting.")?;
    if observation.observation_id != request.observation_id
        || observation.generation != request.observation_generation
    {
        return Err(
            "stale_observation: action is not tied to the latest observation generation.".into(),
        );
    }
    if observation.expires_at <= now_ms() {
        return Err("stale_observation: approved observation expired.".into());
    }
    if matches!(request.action.as_str(), "moveMouse" | "clickMouse") {
        let x = request.x.ok_or("coordinate_mismatch: x is required.")?;
        let y = request.y.ok_or("coordinate_mismatch: y is required.")?;
        if !contains(&observation.virtual_bounds, x, y)
            || !contains(&observation.window_bounds, x, y)
        {
            return Err(
                "coordinate_mismatch: target is outside the observed foreground window.".into(),
            );
        }
    }
    Ok(observation)
}

fn contains(bounds: &PhysicalBounds, x: i32, y: i32) -> bool {
    x >= bounds.x
        && y >= bounds.y
        && x < bounds.x.saturating_add(bounds.width)
        && y < bounds.y.saturating_add(bounds.height)
}

#[cfg(not(windows))]
mod platform {
    use super::*;
    pub fn observe(_: u64) -> Result<Observation, String> {
        Err("Windows native bridge unavailable.".into())
    }
    pub fn validate_foreground(_: &ObservationContext) -> Result<(), String> {
        Err("Windows native bridge unavailable.".into())
    }
    pub fn act(
        _: &AtomicBool,
        _: ActionRequest,
        _: ObservationContext,
    ) -> Result<ActionResult, String> {
        Err("Windows native bridge unavailable.".into())
    }
}

#[cfg(windows)]
mod platform {
    use super::*;
    use base64::Engine;
    use std::process::Command;
    use windows_sys::Win32::Foundation::{POINT, RECT};
    use windows_sys::Win32::Graphics::Gdi::{
        BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC,
        GetDIBits, GetMonitorInfoW, MonitorFromWindow, ReleaseDC, SelectObject, BITMAPINFO, BI_RGB,
        DIB_RGB_COLORS, MONITORINFO, MONITOR_DEFAULTTONEAREST, SRCCOPY,
    };
    use windows_sys::Win32::UI::HiDpi::GetDpiForWindow;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, INPUT_MOUSE, KEYBDINPUT, KEYEVENTF_KEYUP,
        KEYEVENTF_UNICODE, MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP, MOUSEEVENTF_RIGHTDOWN,
        MOUSEEVENTF_RIGHTUP, MOUSEEVENTF_WHEEL, MOUSEINPUT,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetCursorPos, GetForegroundWindow, GetSystemMetrics, GetWindowRect,
        GetWindowThreadProcessId, SetCursorPos, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN,
        SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN,
    };

    fn virtual_bounds() -> Result<PhysicalBounds, String> {
        let bounds = PhysicalBounds {
            x: unsafe { GetSystemMetrics(SM_XVIRTUALSCREEN) },
            y: unsafe { GetSystemMetrics(SM_YVIRTUALSCREEN) },
            width: unsafe { GetSystemMetrics(SM_CXVIRTUALSCREEN) },
            height: unsafe { GetSystemMetrics(SM_CYVIRTUALSCREEN) },
        };
        if bounds.width <= 0 || bounds.height <= 0 || bounds.width > 32768 || bounds.height > 32768
        {
            return Err("Virtual desktop dimensions are unavailable.".into());
        }
        Ok(bounds)
    }

    fn rect_bounds(rect: RECT) -> PhysicalBounds {
        PhysicalBounds {
            x: rect.left,
            y: rect.top,
            width: rect.right.saturating_sub(rect.left),
            height: rect.bottom.saturating_sub(rect.top),
        }
    }

    fn foreground_context(
    ) -> Result<(String, u32, PhysicalBounds, String, PhysicalBounds, f64), String> {
        let window = unsafe { GetForegroundWindow() };
        if window.is_null() {
            return Err("foreground_mismatch: no foreground window is available.".into());
        }
        let mut process_id = 0_u32;
        unsafe { GetWindowThreadProcessId(window, &mut process_id) };
        let mut window_rect = RECT::default();
        if unsafe { GetWindowRect(window, &mut window_rect) } == 0 {
            return Err("foreground_mismatch: foreground window bounds are unavailable.".into());
        }
        let monitor = unsafe { MonitorFromWindow(window, MONITOR_DEFAULTTONEAREST) };
        if monitor.is_null() {
            return Err("monitor_unavailable: foreground monitor is unavailable.".into());
        }
        let mut monitor_info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if unsafe { GetMonitorInfoW(monitor, &mut monitor_info) } == 0 {
            return Err("monitor_unavailable: monitor geometry is unavailable.".into());
        }
        let dpi = unsafe { GetDpiForWindow(window) };
        let monitor_bounds = rect_bounds(monitor_info.rcMonitor);
        Ok((
            format!("hwnd:{:x}", window as usize),
            process_id,
            rect_bounds(window_rect),
            format!(
                "monitor:{}:{}:{}:{}",
                monitor_bounds.x, monitor_bounds.y, monitor_bounds.width, monitor_bounds.height
            ),
            monitor_bounds,
            if dpi == 0 { 1.0 } else { dpi as f64 / 96.0 },
        ))
    }

    fn cursor() -> Result<(i32, i32), String> {
        let mut point = POINT::default();
        if unsafe { GetCursorPos(&mut point) } == 0 {
            return Err("Could not read cursor position.".into());
        }
        Ok((point.x, point.y))
    }

    pub fn observe(generation: u64) -> Result<Observation, String> {
        let bounds = virtual_bounds()?;
        let width = bounds.width;
        let height = bounds.height;
        let (window_id, window_process_id, window_bounds, monitor_id, monitor_bounds, scale_factor) =
            foreground_context()?;
        let screen = unsafe { GetDC(std::ptr::null_mut()) };
        if screen.is_null() {
            return Err("Screen capture device context unavailable.".into());
        }
        let memory = unsafe { CreateCompatibleDC(screen) };
        let bitmap = unsafe { CreateCompatibleBitmap(screen, width, height) };
        if memory.is_null() || bitmap.is_null() {
            unsafe {
                if !bitmap.is_null() {
                    DeleteObject(bitmap);
                }
                if !memory.is_null() {
                    DeleteDC(memory);
                }
                ReleaseDC(std::ptr::null_mut(), screen);
            }
            return Err("Screen capture bitmap unavailable.".into());
        }

        let old = unsafe { SelectObject(memory, bitmap) };
        let copied = unsafe {
            BitBlt(
                memory, 0, 0, width, height, screen, bounds.x, bounds.y, SRCCOPY,
            )
        };
        unsafe {
            SelectObject(memory, old);
        }
        let mut info = BITMAPINFO::default();
        info.bmiHeader.biSize = std::mem::size_of_val(&info.bmiHeader) as u32;
        info.bmiHeader.biWidth = width;
        info.bmiHeader.biHeight = -height;
        info.bmiHeader.biPlanes = 1;
        info.bmiHeader.biBitCount = 32;
        info.bmiHeader.biCompression = BI_RGB;
        let mut bgra = vec![0u8; width as usize * height as usize * 4];
        let lines = if copied != 0 {
            unsafe {
                GetDIBits(
                    screen,
                    bitmap,
                    0,
                    height as u32,
                    bgra.as_mut_ptr().cast(),
                    &mut info,
                    DIB_RGB_COLORS,
                )
            }
        } else {
            0
        };
        unsafe {
            DeleteObject(bitmap);
            DeleteDC(memory);
            ReleaseDC(std::ptr::null_mut(), screen);
        }
        if lines != height {
            return Err("Windows screen capture failed.".into());
        }

        let mut rgb = Vec::with_capacity(width as usize * height as usize * 3);
        for pixel in bgra.as_chunks::<4>().0 {
            rgb.extend_from_slice(&[pixel[2], pixel[1], pixel[0]]);
        }
        let mut png_bytes = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut png_bytes, width as u32, height as u32);
            encoder.set_color(png::ColorType::Rgb);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder.write_header().map_err(|_| "PNG encoder failed.")?;
            writer
                .write_image_data(&rgb)
                .map_err(|_| "PNG image encoding failed.")?;
        }
        let (cursor_x, cursor_y) = cursor()?;
        let captured_at = now_ms();
        Ok(Observation {
            observation_id: format!("observation-{captured_at}-{generation}"),
            generation,
            image_data_url: format!(
                "data:image/png;base64,{}",
                base64::engine::general_purpose::STANDARD.encode(png_bytes)
            ),
            origin_x: bounds.x,
            origin_y: bounds.y,
            width,
            height,
            cursor_x,
            cursor_y,
            captured_at,
            expires_at: captured_at + OBSERVATION_TTL.as_millis() as u64,
            source: "windows_gdi_virtual_desktop",
            confidence: 1.0,
            window_id,
            window_process_id,
            window_bounds,
            monitor_id,
            monitor_bounds,
            scale_factor,
            coordinate_space: "physical_virtual_desktop",
            uia_available: false,
            ocr_available: false,
        })
    }

    pub fn validate_foreground(observation: &ObservationContext) -> Result<(), String> {
        let (window_id, _, window_bounds, monitor_id, _, _) = foreground_context()?;
        if window_id != observation.window_id {
            return Err("foreground_mismatch: foreground window changed after observation.".into());
        }
        if monitor_id != observation.monitor_id {
            return Err("coordinate_mismatch: foreground window moved to another monitor.".into());
        }
        if window_bounds.x != observation.window_bounds.x
            || window_bounds.y != observation.window_bounds.y
            || window_bounds.width != observation.window_bounds.width
            || window_bounds.height != observation.window_bounds.height
        {
            return Err("target_moved: foreground window bounds changed after observation.".into());
        }
        Ok(())
    }

    fn send(inputs: &[INPUT]) -> Result<(), String> {
        let sent = unsafe {
            SendInput(
                inputs.len() as u32,
                inputs.as_ptr(),
                std::mem::size_of::<INPUT>() as i32,
            )
        };
        if sent != inputs.len() as u32 {
            return Err("Windows refused the input action.".into());
        }
        Ok(())
    }

    fn mouse_input(flags: u32, data: u32) -> INPUT {
        INPUT {
            r#type: INPUT_MOUSE,
            Anonymous: INPUT_0 {
                mi: MOUSEINPUT {
                    mouseData: data,
                    dwFlags: flags,
                    ..Default::default()
                },
            },
        }
    }

    fn key_input(key: u16, flags: u32, unicode: bool) -> INPUT {
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: if unicode { 0 } else { key },
                    wScan: if unicode { key } else { 0 },
                    dwFlags: flags | if unicode { KEYEVENTF_UNICODE } else { 0 },
                    ..Default::default()
                },
            },
        }
    }

    fn virtual_key(key: &str) -> Result<u16, String> {
        match key.to_ascii_uppercase().as_str() {
            "CTRL" => Ok(0x11),
            "SHIFT" => Ok(0x10),
            "ALT" => Ok(0x12),
            "ESC" => Ok(0x1b),
            "TAB" => Ok(0x09),
            "ENTER" => Ok(0x0d),
            "LEFT" => Ok(0x25),
            "UP" => Ok(0x26),
            "RIGHT" => Ok(0x27),
            "DOWN" => Ok(0x28),
            "F5" => Ok(0x74),
            letter if letter.len() == 1 && letter.as_bytes()[0].is_ascii_alphabetic() => {
                Ok(letter.as_bytes()[0] as u16)
            }
            _ => Err("Keyboard key is outside the approved allowlist.".into()),
        }
    }

    fn approved_app_executable(app: &str) -> Result<&'static str, String> {
        match app {
            "notepad" => Ok("notepad.exe"),
            "calculator" => Ok("calc.exe"),
            _ => Err("Application is outside the approved local allowlist.".into()),
        }
    }

    fn approved_hotkey(keys: &[String]) -> Result<Vec<u16>, String> {
        if keys.len() < 2 || keys.len() > 3 {
            return Err("Hotkey requires 2 or 3 keys.".into());
        }
        let normalized: Vec<String> = keys.iter().map(|key| key.to_ascii_uppercase()).collect();
        if !matches!(normalized[0].as_str(), "CTRL" | "SHIFT") {
            return Err("Hotkey must begin with Ctrl or Shift.".into());
        }
        if normalized
            .iter()
            .any(|key| matches!(key.as_str(), "ALT" | "ESC"))
        {
            return Err("Hotkey cannot include Alt or Escape.".into());
        }
        normalized.iter().map(|key| virtual_key(key)).collect()
    }

    pub fn act(
        stopped: &AtomicBool,
        request: ActionRequest,
        observation: ObservationContext,
    ) -> Result<ActionResult, String> {
        if stopped.load(Ordering::SeqCst) {
            return Err("action_blocked: Computer Use was interrupted before dispatch.".into());
        }
        let bounds = virtual_bounds()?;
        match request.action.as_str() {
            "moveMouse" | "clickMouse" => {
                let (x, y) = (
                    request.x.ok_or("x is required.")?,
                    request.y.ok_or("y is required.")?,
                );
                if !contains(&bounds, x, y) {
                    return Err(
                        "coordinate_mismatch: target is outside the virtual desktop.".into(),
                    );
                }
                if unsafe { SetCursorPos(x, y) } == 0 {
                    return Err("Could not move cursor.".into());
                }
                if request.action == "clickMouse" {
                    if stopped.load(Ordering::SeqCst) {
                        return Err(
                            "action_blocked: Computer Use was interrupted before click dispatch."
                                .into(),
                        );
                    }
                    let flags = match request.button.as_deref().unwrap_or("left") {
                        "left" => (MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP),
                        "right" => (MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP),
                        _ => return Err("Mouse button must be left or right.".into()),
                    };
                    send(&[mouse_input(flags.0, 0), mouse_input(flags.1, 0)])?;
                }
            }
            "typeText" => {
                let text = request.text.as_deref().ok_or("text is required.")?;
                if text.is_empty()
                    || text.chars().count() > 200
                    || text.chars().any(char::is_control)
                {
                    return Err("Type text must contain 1 to 200 printable characters.".into());
                }
                for unit in text.encode_utf16() {
                    if stopped.load(Ordering::SeqCst) {
                        return Err("Computer Use was interrupted.".into());
                    }
                    send(&[
                        key_input(unit, 0, true),
                        key_input(unit, KEYEVENTF_KEYUP, true),
                    ])?;
                    std::thread::sleep(Duration::from_millis(5));
                }
            }
            "pressKey" => {
                let key = virtual_key(request.key.as_deref().ok_or("key is required.")?)?;
                send(&[
                    key_input(key, 0, false),
                    key_input(key, KEYEVENTF_KEYUP, false),
                ])?;
            }
            "hotkey" => {
                let keys = request.keys.as_deref().ok_or("keys are required.")?;
                let codes = approved_hotkey(keys)?;
                let mut inputs: Vec<INPUT> = codes
                    .iter()
                    .map(|code| key_input(*code, 0, false))
                    .collect();
                inputs.extend(
                    codes
                        .iter()
                        .rev()
                        .map(|code| key_input(*code, KEYEVENTF_KEYUP, false)),
                );
                send(&inputs)?;
            }
            "scroll" => {
                let delta = request.delta.ok_or("delta is required.")?;
                if delta == 0 || delta.abs() > 1200 {
                    return Err("Scroll delta must be between -1200 and 1200.".into());
                }
                send(&[mouse_input(MOUSEEVENTF_WHEEL, delta as u32)])?;
            }
            "launchApp" => {
                let executable =
                    approved_app_executable(request.app.as_deref().ok_or("app is required.")?)?;
                Command::new(executable)
                    .spawn()
                    .map_err(|_| "Approved application could not be started.")?;
            }
            _ => return Err("Computer action is not supported.".into()),
        }
        let (cursor_x, cursor_y) = cursor()?;
        let verification = if request.action == "moveMouse"
            && request.x == Some(cursor_x)
            && request.y == Some(cursor_y)
        {
            "cursor_position_confirmed"
        } else if request.action == "launchApp" {
            "process_started"
        } else {
            "input_injected_outcome_unverified"
        };
        Ok(ActionResult {
            action_id: request.action_id,
            plan_id: request.plan_id,
            step_id: request.step_id,
            action: request.action,
            injected: true,
            dispatch_status: "dispatched",
            cursor_x,
            cursor_y,
            verification,
            verification_status: "pending_post_observation",
            pre_observation_id: observation.observation_id,
            attempts: 1,
        })
    }

    #[cfg(test)]
    mod tests {
        use super::{approved_app_executable, approved_hotkey, virtual_key};

        #[test]
        fn dangerous_key_names_are_not_in_the_allowlist() {
            assert!(virtual_key("WIN").is_err());
            assert!(virtual_key("F4").is_err());
            assert!(virtual_key("DELETE").is_err());
            assert!(virtual_key("ESC").is_ok());
        }

        #[test]
        fn application_launch_is_hardcoded_to_safe_local_apps() {
            assert_eq!(approved_app_executable("notepad").unwrap(), "notepad.exe");
            assert_eq!(approved_app_executable("calculator").unwrap(), "calc.exe");
            assert!(approved_app_executable("powershell").is_err());
            assert!(approved_app_executable("cmd").is_err());
        }

        #[test]
        fn system_level_hotkeys_are_blocked() {
            assert!(approved_hotkey(&["CTRL".into(), "A".into()]).is_ok());
            assert!(approved_hotkey(&["CTRL".into(), "SHIFT".into(), "ESC".into()]).is_err());
            assert!(approved_hotkey(&["CTRL".into(), "ALT".into(), "A".into()]).is_err());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn observation(id: &str, generation: u64, expires_at: u64) -> ObservationContext {
        ObservationContext {
            observation_id: id.into(),
            generation,
            expires_at,
            window_id: "hwnd:test".into(),
            monitor_id: "monitor:-1920:0:1920:1080".into(),
            window_bounds: PhysicalBounds {
                x: -1800,
                y: 100,
                width: 800,
                height: 600,
            },
            virtual_bounds: PhysicalBounds {
                x: -1920,
                y: 0,
                width: 3840,
                height: 1080,
            },
        }
    }

    fn action(observation_id: &str, generation: u64, x: i32, y: i32) -> ActionRequest {
        ActionRequest {
            action_id: "action-test".into(),
            plan_id: "plan-test".into(),
            step_id: "step-test".into(),
            observation_id: observation_id.into(),
            observation_generation: generation,
            expected_effect: "cursor_moved".into(),
            max_attempts: 1,
            action: "moveMouse".into(),
            x: Some(x),
            y: Some(y),
            button: None,
            text: None,
            key: None,
            keys: None,
            delta: None,
            app: None,
        }
    }

    #[test]
    fn native_actions_require_a_live_session_and_stop_revokes_it() {
        let state = ComputerState::default();
        assert!(require_session(&state, "missing").is_err());
        let id = "approved-test".to_string();
        *state.session.lock().unwrap() = Some(ComputerSession {
            id: id.clone(),
            expires_at: SystemTime::now() + Duration::from_secs(5),
        });
        assert!(require_session(&state, &id).is_ok());
        assert!(require_session(&state, "other").is_err());
        state.stopped.store(true, Ordering::SeqCst);
        assert!(require_session(&state, &id).is_err());
    }

    #[test]
    fn action_context_rejects_stale_generation_and_outside_window_coordinates() {
        let state = ComputerState::default();
        *state.last_observation.lock().unwrap() = Some(observation("obs-2", 2, now_ms() + 5_000));
        assert!(
            validate_action_context(&state, &action("obs-1", 1, -1500, 300))
                .unwrap_err()
                .contains("stale_observation")
        );
        assert!(
            validate_action_context(&state, &action("obs-2", 2, 200, 300))
                .unwrap_err()
                .contains("coordinate_mismatch")
        );
        assert!(validate_action_context(&state, &action("obs-2", 2, -1500, 300)).is_ok());
    }

    #[test]
    fn expired_observation_and_unbounded_retry_fail_closed() {
        let state = ComputerState::default();
        *state.last_observation.lock().unwrap() =
            Some(observation("obs-expired", 4, now_ms().saturating_sub(1)));
        assert!(
            validate_action_context(&state, &action("obs-expired", 4, -1500, 300))
                .unwrap_err()
                .contains("stale_observation")
        );
        *state.last_observation.lock().unwrap() =
            Some(observation("obs-live", 5, now_ms() + 5_000));
        let mut request = action("obs-live", 5, -1500, 300);
        request.max_attempts = 3;
        assert!(validate_action_context(&state, &request)
            .unwrap_err()
            .contains("retry_budget_invalid"));
    }
}
