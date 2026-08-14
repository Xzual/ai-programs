use tauri::Manager;

// ── Tauri komutları ────────────────────────────────────────────────────────────

/// AURA versiyon bilgisi
#[tauri::command]
fn get_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Pencereyi tam ekran yap
#[tauri::command]
fn toggle_fullscreen(window: tauri::Window) {
    let is_fullscreen = window.is_fullscreen().unwrap_or(false);
    window.set_fullscreen(!is_fullscreen).unwrap_or(());
}

/// Pencereyi minimize et
#[tauri::command]
fn minimize_window(window: tauri::Window) {
    window.minimize().unwrap_or(());
}

/// Pencereyi kapat
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
            toggle_fullscreen,
            minimize_window,
            close_window,
        ])
        .run(tauri::generate_context!())
        .expect("AURA başlatılamadı");
}
