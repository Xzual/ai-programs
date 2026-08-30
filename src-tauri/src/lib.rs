use tauri::Manager;

// ── Tauri komutları ────────────────────────────────────────────────────────────

/// E.D.I.T.H. version info
#[tauri::command]
fn get_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
fn desktop_shell_status(window: tauri::Window) -> serde_json::Value {
    serde_json::json!({
        "tauri": true,
        "version": env!("CARGO_PKG_VERSION"),
        "fullscreen": window.is_fullscreen().unwrap_or(false),
        "maximized": window.is_maximized().unwrap_or(false),
        "decorations": false,
        "trayConfigured": false,
        "unsafeComputerControl": false
    })
}

#[tauri::command]
fn toggle_fullscreen(window: tauri::Window) {
    let is_fullscreen = window.is_fullscreen().unwrap_or(false);
    window.set_fullscreen(!is_fullscreen).unwrap_or(());
}

#[tauri::command]
fn toggle_maximize(window: tauri::Window) {
    let is_maximized = window.is_maximized().unwrap_or(false);
    if is_maximized {
        window.unmaximize().unwrap_or(());
    } else {
        window.maximize().unwrap_or(());
    }
}

#[tauri::command]
fn start_window_drag(window: tauri::Window) {
    window.start_dragging().unwrap_or(());
}

#[tauri::command]
fn minimize_window(window: tauri::Window) {
    window.minimize().unwrap_or(());
}

#[tauri::command]
fn close_window(window: tauri::Window) {
    window.close().unwrap_or(());
}

// ── Uygulama başlangıcı ────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_http::init())
        .setup(|app| {
            // Dev modunda devtools aç
            #[cfg(debug_assertions)]
            {
                let window = app.get_webview_window("main").unwrap();
                window.open_devtools();
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_version,
            desktop_shell_status,
            toggle_fullscreen,
            toggle_maximize,
            start_window_drag,
            minimize_window,
            close_window,
        ])
        .run(tauri::generate_context!())
        .expect("E.D.I.T.H. could not start");
}
