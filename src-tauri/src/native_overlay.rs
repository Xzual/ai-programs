//! Event-driven, click-through overlay. Coordinates are physical desktop pixels.
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc};
use std::thread::JoinHandle;

#[derive(Clone, Copy, Debug)]
pub struct OverlayBounds {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

enum Command {
    Update(String, i32, i32),
    Close,
}

pub struct OverlayHandle {
    sender: mpsc::SyncSender<Command>,
    thread: Option<JoinHandle<()>>,
    stopped: Arc<AtomicBool>,
    closing: Arc<AtomicBool>,
}

impl OverlayHandle {
    /// Accepts observed events only; does not synthesize task progress.
    pub fn update(&self, state: &str, x: i32, y: i32) -> Result<(), String> {
        if !matches!(state, "idle" | "target" | "cursor" | "click" | "stopped") {
            return Err("unknown overlay event".into());
        }
        if state == "stopped" {
            self.stopped.store(true, Ordering::SeqCst);
            return Ok(());
        }
        self.sender
            .try_send(Command::Update(state.into(), x, y))
            .map_err(|e| format!("overlay update unavailable: {e}"))
    }

    pub fn close(&mut self) {
        // Independent close flag avoids blocking on a full event queue.
        self.closing.store(true, Ordering::SeqCst);
        let _ = self.sender.try_send(Command::Close);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

impl Drop for OverlayHandle {
    fn drop(&mut self) {
        self.close();
    }
}

pub fn show(bounds: OverlayBounds, stopped: Arc<AtomicBool>) -> Result<OverlayHandle, String> {
    if bounds.width <= 0 || bounds.height <= 0 || bounds.width > 32768 || bounds.height > 32768
        || bounds.x.checked_add(bounds.width).is_none()
        || bounds.y.checked_add(bounds.height).is_none()
    {
        return Err("invalid physical overlay bounds".into());
    }
    if stopped.load(Ordering::SeqCst) {
        return Err("emergency stop is active".into());
    }
    #[cfg(windows)]
    {
        let (sender, receiver) = mpsc::sync_channel(32);
        let (ready_tx, ready_rx) = mpsc::sync_channel(1);
        let thread_stopped = stopped.clone();
        let closing = Arc::new(AtomicBool::new(false));
        let thread_closing = closing.clone();
        let thread = std::thread::Builder::new()
            .name("edith-native-overlay".into())
            .spawn(move || unsafe { win::run(bounds, thread_stopped, thread_closing, receiver, ready_tx) })
            .map_err(|e| e.to_string())?;
        match ready_rx.recv() {
            Ok(Ok(())) => Ok(OverlayHandle { sender, thread: Some(thread), stopped, closing }),
            result => {
                let _ = thread.join();
                Err(match result { Ok(Err(e)) => e, _ => "overlay startup failed".into() })
            }
        }
    }
    #[cfg(not(windows))]
    Err("native overlay requires Windows".into())
}

#[cfg(windows)]
mod win {
    use super::*;
    use std::time::{Duration, Instant};
    use windows_sys::Win32::Foundation::*;
    use windows_sys::Win32::Graphics::Gdi::*;
    use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows_sys::Win32::UI::HiDpi::*;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::*;
    use windows_sys::Win32::UI::WindowsAndMessaging::*;

    struct PaintState {
        bounds: OverlayBounds,
        event: String,
        x: i32,
        y: i32,
        click: Option<Instant>,
    }

    unsafe extern "system" fn proc(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
        if msg == WM_NCHITTEST { return HTTRANSPARENT as LRESULT; }
        if msg == WM_MOUSEACTIVATE { return MA_NOACTIVATE as LRESULT; }
        if msg == WM_PAINT {
            let mut ps = PAINTSTRUCT::default();
            let dc = BeginPaint(hwnd, &mut ps);
            let state = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut PaintState;
            if !state.is_null() {
                let s = &*state;
                let rect = RECT { left: 0, top: 0, right: s.bounds.width, bottom: s.bounds.height };
                let black = CreateSolidBrush(0);
                FillRect(dc, &rect, black);
                DeleteObject(black);
                let pen = CreatePen(PS_SOLID, 3, 0x00e5d522);
                let old_pen = SelectObject(dc, pen);
                let old_brush = SelectObject(dc, GetStockObject(NULL_BRUSH));
                // Subtraction in i64 avoids overflow from externally supplied coordinates.
                let x = (s.x as i64 - s.bounds.x as i64).clamp(0, s.bounds.width as i64 - 1) as i32;
                let y = (s.y as i64 - s.bounds.y as i64).clamp(0, s.bounds.height as i64 - 1) as i32;
                if s.event == "target" { Rectangle(dc, x - 24, y - 24, x + 25, y + 25); }
                if matches!(s.event.as_str(), "cursor" | "click") {
                    MoveToEx(dc, x - 10, y, std::ptr::null_mut()); LineTo(dc, x + 11, y);
                    MoveToEx(dc, x, y - 10, std::ptr::null_mut()); LineTo(dc, x, y + 11);
                }
                if let Some(click) = s.click {
                    let age = click.elapsed().as_millis();
                    if age < 450 { let r = 8 + (age / 15) as i32; Ellipse(dc, x-r, y-r, x+r, y+r); }
                }
                SetBkMode(dc, TRANSPARENT as i32);
                SetTextColor(dc, 0x00ffffff);
                let label: Vec<u16> = format!("E.D.I.T.H. {} | Ctrl+Shift+F12: stop", s.event).encode_utf16().collect();
                TextOutW(dc, 18, 18, label.as_ptr(), label.len() as i32);
                SelectObject(dc, old_brush); SelectObject(dc, old_pen); DeleteObject(pen);
            }
            EndPaint(hwnd, &ps);
            return 0;
        }
        DefWindowProcW(hwnd, msg, wp, lp)
    }

    pub(super) unsafe fn run(bounds: OverlayBounds, stopped: Arc<AtomicBool>, close_requested: Arc<AtomicBool>, rx: mpsc::Receiver<Command>, ready: mpsc::SyncSender<Result<(), String>>) {
        // Per-thread DPI context preserves physical coordinates across monitors, including negative origins.
        let previous_dpi = SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
        if previous_dpi.is_null() { let _ = ready.send(Err("overlay DPI context unavailable".into())); return; }
        let class: Vec<u16> = format!("EdithOverlay-{:?}\0", std::thread::current().id()).encode_utf16().collect();
        let instance = GetModuleHandleW(std::ptr::null());
        let wc = WNDCLASSW { hInstance: instance, lpfnWndProc: Some(proc), lpszClassName: class.as_ptr(), ..Default::default() };
        if RegisterClassW(&wc) == 0 {
            let _ = ready.send(Err(format!("overlay class failed: {}", GetLastError())));
            SetThreadDpiAwarenessContext(previous_dpi); return;
        }
        let hwnd = CreateWindowExW(WS_EX_TOPMOST | WS_EX_NOACTIVATE | WS_EX_TRANSPARENT | WS_EX_LAYERED | WS_EX_TOOLWINDOW,
            class.as_ptr(), class.as_ptr(), WS_POPUP, bounds.x, bounds.y, bounds.width, bounds.height,
            std::ptr::null_mut(), std::ptr::null_mut(), instance, std::ptr::null());
        if hwnd.is_null() {
            let _ = ready.send(Err(format!("overlay window failed: {}", GetLastError())));
            UnregisterClassW(class.as_ptr(), instance); SetThreadDpiAwarenessContext(previous_dpi); return;
        }
        let mut paint = Box::new(PaintState { bounds, event: "idle".into(), x: bounds.x, y: bounds.y, click: None });
        SetWindowLongPtrW(hwnd, GWLP_USERDATA, &mut *paint as *mut PaintState as isize);
        if SetLayeredWindowAttributes(hwnd, 0, 255, LWA_COLORKEY) == 0
            || RegisterHotKey(hwnd, 1, MOD_CONTROL | MOD_SHIFT | MOD_NOREPEAT, VK_F12 as u32) == 0 {
            let _ = ready.send(Err(format!("overlay transparency or emergency hotkey failed: {}", GetLastError())));
            UnregisterHotKey(hwnd, 1); DestroyWindow(hwnd); UnregisterClassW(class.as_ptr(), instance);
            SetThreadDpiAwarenessContext(previous_dpi); return;
        }
        ShowWindow(hwnd, SW_SHOWNOACTIVATE);
        let _ = ready.send(Ok(()));
        let mut closing = false;
        while !closing && !close_requested.load(Ordering::SeqCst) && !stopped.load(Ordering::SeqCst) {
            let mut msg = MSG::default();
            for _ in 0..64 {
                if PeekMessageW(&mut msg, std::ptr::null_mut(), 0, 0, PM_REMOVE) == 0 { break; }
                if msg.message == WM_HOTKEY && msg.wParam == 1 { stopped.store(true, Ordering::SeqCst); }
                if msg.message == WM_QUIT { closing = true; }
                TranslateMessage(&msg); DispatchMessageW(&msg);
            }
            // Bounded drain prevents event producers from starving emergency message handling.
            for _ in 0..32 {
                match rx.try_recv() {
                    Ok(Command::Close) | Err(mpsc::TryRecvError::Disconnected) => { closing = true; break; }
                    Ok(Command::Update(event, x, y)) => {
                        if event == "stopped" { stopped.store(true, Ordering::SeqCst); }
                        paint.click = if event == "click" { Some(Instant::now()) } else { None };
                        paint.event = event; paint.x = x; paint.y = y;
                        InvalidateRect(hwnd, std::ptr::null(), 0);
                    }
                    Err(mpsc::TryRecvError::Empty) => break,
                }
            }
            if paint.click.is_some() {
                InvalidateRect(hwnd, std::ptr::null(), 0);
                if paint.click.is_some_and(|t| t.elapsed() >= Duration::from_millis(450)) { paint.click = None; }
            }
            std::thread::sleep(Duration::from_millis(16));
        }
        UnregisterHotKey(hwnd, 1);
        SetWindowLongPtrW(hwnd, GWLP_USERDATA, 0);
        DestroyWindow(hwnd);
        UnregisterClassW(class.as_ptr(), instance);
        SetThreadDpiAwarenessContext(previous_dpi);
    }
}


