#[cfg(not(debug_assertions))]
use std::net::TcpListener;
#[cfg(all(windows, any(not(debug_assertions), test)))]
use std::path::Prefix;
#[cfg(any(not(debug_assertions), test))]
use std::path::{Component, Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, AtomicU16, AtomicU64, AtomicUsize, Ordering},
    Arc, Mutex,
};
use std::{thread, time::Duration};
use tauri::{Manager, State};
use tauri_plugin_shell::process::CommandChild;
#[cfg(not(debug_assertions))]
use tauri_plugin_shell::ShellExt;

mod advanced;
mod computer;
mod cross_device;
mod obsidian_picker;

const MAX_SIDECAR_RESTARTS: usize = 3;
#[cfg(any(not(debug_assertions), test))]
const PACKAGED_E2E_MARKER: &str = "EDITH_PHASE11E_ISOLATED_RUNTIME_V1\n";
#[cfg(not(debug_assertions))]
const RESTART_BACKOFF_MS: [u64; MAX_SIDECAR_RESTARTS] = [500, 1_500, 3_500];

#[derive(Clone)]
struct BackendRuntime {
    port: Arc<AtomicU16>,
    status: Arc<Mutex<String>>,
    child: Arc<Mutex<Option<CommandChild>>>,
    generation: Arc<AtomicU64>,
    restart_attempts: Arc<AtomicUsize>,
    shutting_down: Arc<AtomicBool>,
    owner_bootstrap: Arc<Mutex<Option<String>>>,
    desktop_bridge: Arc<Mutex<Option<String>>>,
}

impl Default for BackendRuntime {
    fn default() -> Self {
        Self {
            port: Arc::new(AtomicU16::new(0)),
            status: Arc::new(Mutex::new("not_started".to_string())),
            child: Arc::new(Mutex::new(None)),
            generation: Arc::new(AtomicU64::new(0)),
            restart_attempts: Arc::new(AtomicUsize::new(0)),
            shutting_down: Arc::new(AtomicBool::new(false)),
            owner_bootstrap: Arc::new(Mutex::new(None)),
            desktop_bridge: Arc::new(Mutex::new(None)),
        }
    }
}

#[cfg(any(not(debug_assertions), test))]
fn new_owner_token() -> Result<String, String> {
    let mut bytes = [0_u8; 32];
    getrandom::fill(&mut bytes)
        .map_err(|error| format!("OS random source unavailable: {error}"))?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

#[tauri::command]
fn desktop_owner_bootstrap_token(
    window: tauri::WebviewWindow,
    state: State<'_, BackendRuntime>,
) -> Result<String, String> {
    if window.label() != "main" {
        return Err("Owner bootstrap is restricted to the main WebView".to_string());
    }
    state
        .owner_bootstrap
        .lock()
        .map_err(|_| "Owner bootstrap state unavailable".to_string())?
        .take()
        .ok_or_else(|| "Owner bootstrap is unavailable or already consumed".to_string())
}

impl BackendRuntime {
    fn set_status(&self, value: &str) {
        if let Ok(mut status) = self.status.lock() {
            *status = value.to_string();
        }
    }
}

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
fn backend_runtime_status(state: State<'_, BackendRuntime>) -> serde_json::Value {
    let port = state.port.load(Ordering::Acquire);
    let status = state
        .status
        .lock()
        .map(|value| value.clone())
        .unwrap_or_else(|_| "unknown".to_string());
    serde_json::json!({
        "status": status,
        "managed": port > 0,
        "port": (port > 0).then_some(port),
        "baseUrl": (port > 0).then(|| format!("http://127.0.0.1:{port}")),
        "restartAttempt": state.restart_attempts.load(Ordering::Acquire),
        "maxRestarts": MAX_SIDECAR_RESTARTS,
        "shuttingDown": state.shutting_down.load(Ordering::Acquire),
    })
}

#[tauri::command]
fn toggle_fullscreen(window: tauri::Window) {
    let _ = window.set_fullscreen(!window.is_fullscreen().unwrap_or(false));
}

#[tauri::command]
fn toggle_maximize(window: tauri::Window) {
    if window.is_maximized().unwrap_or(false) {
        let _ = window.unmaximize();
    } else {
        let _ = window.maximize();
    }
}

#[tauri::command]
fn start_window_drag(window: tauri::Window) {
    let _ = window.start_dragging();
}

#[tauri::command]
fn minimize_window(window: tauri::Window) {
    let _ = window.minimize();
}

#[tauri::command]
fn close_window(app: tauri::AppHandle, state: State<'_, BackendRuntime>) {
    begin_shutdown(app, state.inner().clone(), 0);
}

#[cfg(not(debug_assertions))]
fn available_loopback_port() -> Result<u16, Box<dyn std::error::Error>> {
    let listener = TcpListener::bind(("127.0.0.1", 0))?;
    Ok(listener.local_addr()?.port())
}

#[cfg(any(not(debug_assertions), test))]
fn is_local_absolute_path(path: &Path) -> bool {
    if !path.is_absolute() {
        return false;
    }
    #[cfg(windows)]
    {
        matches!(
            path.components().next(),
            Some(Component::Prefix(prefix))
                if matches!(prefix.kind(), Prefix::Disk(_) | Prefix::VerbatimDisk(_))
        )
    }
    #[cfg(not(windows))]
    true
}

#[cfg(any(not(debug_assertions), test))]
fn reject_reparse_components(path: &Path) -> Result<(), String> {
    if path
        .components()
        .any(|component| matches!(component, Component::CurDir | Component::ParentDir))
    {
        return Err("Packaged E2E paths must not contain relative components".to_string());
    }

    for component in path.ancestors().collect::<Vec<_>>().into_iter().rev() {
        if component.as_os_str().is_empty() {
            continue;
        }
        let metadata = match std::fs::symlink_metadata(component) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(_) => {
                return Err("Packaged E2E path metadata is unavailable".to_string());
            }
        };
        if metadata.file_type().is_symlink() {
            return Err("Packaged E2E paths must not contain symbolic links".to_string());
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0400;
            if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
                return Err(
                    "Packaged E2E paths must not contain junctions or reparse points".to_string(),
                );
            }
        }
    }
    Ok(())
}

#[cfg(any(not(debug_assertions), test))]
fn prepare_packaged_e2e_directory(root: &Path, name: &str) -> Result<PathBuf, String> {
    let directory = root.join(name);
    reject_reparse_components(&directory)?;
    std::fs::create_dir_all(&directory)
        .map_err(|_| format!("Packaged E2E {name} directory could not be created"))?;
    reject_reparse_components(&directory)?;
    let metadata = std::fs::symlink_metadata(&directory)
        .map_err(|_| format!("Packaged E2E {name} directory is unavailable"))?;
    if !metadata.file_type().is_dir() {
        return Err(format!("Packaged E2E {name} path is not a directory"));
    }
    let resolved = directory
        .canonicalize()
        .map_err(|_| format!("Packaged E2E {name} directory is unavailable"))?;
    if resolved == root || !resolved.starts_with(root) {
        return Err(format!("Packaged E2E {name} directory escaped its root"));
    }
    Ok(resolved)
}

#[cfg(any(not(debug_assertions), test))]
fn resolve_packaged_e2e_root(
    enabled: Option<&str>,
    configured: Option<PathBuf>,
    temp_root: &Path,
) -> Result<Option<PathBuf>, String> {
    if enabled != Some("true") {
        if configured.is_some() {
            return Err("Packaged E2E root requires EDITH_PACKAGED_E2E=true".to_string());
        }
        return Ok(None);
    }
    let candidate = configured
        .ok_or_else(|| "EDITH_PACKAGED_E2E_ROOT is required for packaged E2E".to_string())?;
    if !is_local_absolute_path(&candidate) {
        return Err("Packaged E2E root must be a local absolute path".to_string());
    }
    if !is_local_absolute_path(temp_root) {
        return Err("OS temp root must be a local absolute path".to_string());
    }
    reject_reparse_components(temp_root)?;
    reject_reparse_components(&candidate)?;
    let candidate_metadata = std::fs::symlink_metadata(&candidate)
        .map_err(|_| "Packaged E2E root is unavailable".to_string())?;
    if !candidate_metadata.file_type().is_dir() {
        return Err("Packaged E2E root is not a directory".to_string());
    }
    let resolved = candidate
        .canonicalize()
        .map_err(|_| "Packaged E2E root is unavailable".to_string())?;
    let resolved_temp = temp_root
        .canonicalize()
        .map_err(|_| "OS temp root is unavailable".to_string())?;
    if resolved == resolved_temp || !resolved.starts_with(&resolved_temp) || !resolved.is_dir() {
        return Err("Packaged E2E root must be a dedicated directory below OS temp".to_string());
    }
    let marker_path = resolved.join(".edith-phase11e-root");
    reject_reparse_components(&marker_path)?;
    let marker_metadata = std::fs::symlink_metadata(&marker_path)
        .map_err(|_| "Packaged E2E root marker is missing".to_string())?;
    if !marker_metadata.file_type().is_file() {
        return Err("Packaged E2E root marker is not a regular file".to_string());
    }
    let marker = std::fs::read_to_string(marker_path)
        .map_err(|_| "Packaged E2E root marker is missing".to_string())?;
    if marker != PACKAGED_E2E_MARKER {
        return Err("Packaged E2E root marker is invalid".to_string());
    }
    Ok(Some(resolved))
}

#[cfg(not(debug_assertions))]
fn packaged_e2e_root_from_env() -> Result<Option<PathBuf>, String> {
    resolve_packaged_e2e_root(
        std::env::var("EDITH_PACKAGED_E2E").ok().as_deref(),
        std::env::var_os("EDITH_PACKAGED_E2E_ROOT").map(PathBuf::from),
        &std::env::temp_dir(),
    )
}

#[cfg(not(debug_assertions))]
fn resolve_crypto_python(resource_dir: &Path) -> Result<PathBuf, String> {
    let candidate = std::env::var_os("EDITH_CRYPTO_PYTHON_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|| resource_dir.join("python").join("python.exe"));
    if !is_local_absolute_path(&candidate) {
        return Err("Crypto Python path must be a local absolute path".to_string());
    }
    let resolved = candidate
        .canonicalize()
        .map_err(|error| format!("Crypto Python runtime is unavailable: {error}"))?;
    if !is_local_absolute_path(&resolved) || !resolved.is_file() {
        return Err("Crypto Python runtime is not a file".to_string());
    }
    Ok(resolved)
}

#[cfg(not(debug_assertions))]
fn start_release_backend(
    app: tauri::AppHandle,
    runtime: BackendRuntime,
) -> Result<(), Box<dyn std::error::Error>> {
    if runtime.shutting_down.load(Ordering::Acquire) {
        return Ok(());
    }
    let existing_port = runtime.port.load(Ordering::Acquire);
    let port = if existing_port == 0 {
        let selected = available_loopback_port()?;
        runtime.port.store(selected, Ordering::Release);
        selected
    } else {
        existing_port
    };
    let app_data = match packaged_e2e_root_from_env()? {
        Some(root) => prepare_packaged_e2e_directory(&root, "app-data")?,
        None => app.path().app_local_data_dir()?,
    };
    let resource_dir = app.path().resource_dir()?;
    let crypto_resource_dir = resource_dir.join("crypto");
    if !crypto_resource_dir.join("run_agent.py").is_file()
        || !crypto_resource_dir.join("src").is_dir()
        || !crypto_resource_dir.join("templates").is_dir()
    {
        return Err("packaged Crypto resources are incomplete".into());
    }
    let crypto_python = resolve_crypto_python(&resource_dir)?;
    let crypto_runtime_dir = app_data.join("crypto-runtime");
    let crypto_data_dir = crypto_runtime_dir.join("data");
    let crypto_log_dir = crypto_runtime_dir.join("logs");
    std::fs::create_dir_all(&app_data)?;
    std::fs::create_dir_all(&crypto_data_dir)?;
    std::fs::create_dir_all(&crypto_log_dir)?;

    let generation = runtime.generation.fetch_add(1, Ordering::AcqRel) + 1;
    let owner_token = new_owner_token()?;
    let desktop_bridge_token = new_owner_token()?;
    *runtime
        .owner_bootstrap
        .lock()
        .map_err(|_| "owner bootstrap lock poisoned")? = Some(owner_token.clone());
    *runtime
        .desktop_bridge
        .lock()
        .map_err(|_| "desktop bridge lock poisoned")? = Some(desktop_bridge_token.clone());
    app.state::<computer::ComputerState>()
        .configure_bridge(desktop_bridge_token.clone(), port);
    app.state::<cross_device::CrossDeviceState>()
        .configure_bridge(desktop_bridge_token.clone(), port);
    runtime.set_status("starting");
    let (mut events, child) = app
        .shell()
        .sidecar("edith-backend")?
        .current_dir(&app_data)
        .env("NODE_ENV", "production")
        .env("PORT", port.to_string())
        .env("EDITH_HOST", "127.0.0.1")
        .env("EDITH_STATIC_DIR", resource_dir.join("dist"))
        .env(
            "EDITH_WORKSPACE_CONFIG_PATH",
            app_data.join(".edith").join("workspace.json"),
        )
        .env("EDITH_PERSISTENCE", "json")
        .env("EDITH_CRYPTO_AUTOSTART", "false")
        .env("EDITH_OWNER_TOKEN", owner_token)
        .env("EDITH_OWNER_TOKEN_ONE_TIME", "true")
        .env("EDITH_DESKTOP_BRIDGE_TOKEN", desktop_bridge_token)
        .env("EDITH_PACKAGED", "true")
        .env("EDITH_APP_RESOURCE_DIR", &resource_dir)
        .env("EDITH_CRYPTO_RESOURCE_DIR", &crypto_resource_dir)
        .env("EDITH_CRYPTO_PROJECT_PATH", &crypto_resource_dir)
        .env("EDITH_CRYPTO_RUNTIME_DATA_DIR", &crypto_runtime_dir)
        .env("EDITH_CRYPTO_PYTHON_PATH", &crypto_python)
        .env("CRYPTO_DATA_DIR", &crypto_data_dir)
        .env("CRYPTO_LOG_DIR", &crypto_log_dir)
        .env("CRYPTO_DB_PATH", crypto_data_dir.join("agent_memory.db"))
        .spawn()?;
    *runtime
        .child
        .lock()
        .map_err(|_| "backend child lock poisoned")? = Some(child);

    let event_app = app.clone();
    let event_runtime = runtime.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = events.recv().await {
            if let tauri_plugin_shell::process::CommandEvent::Terminated(_) = event {
                if event_runtime.generation.load(Ordering::Acquire) != generation {
                    if event_runtime.shutting_down.load(Ordering::Acquire) {
                        if let Ok(mut child) = event_runtime.child.lock() {
                            child.take();
                        }
                        event_runtime.set_status("stopped");
                    }
                    break;
                }
                if let Ok(mut child) = event_runtime.child.lock() {
                    child.take();
                }
                if event_runtime.shutting_down.load(Ordering::Acquire) {
                    event_runtime.set_status("stopped");
                    break;
                }
                let attempt = event_runtime
                    .restart_attempts
                    .fetch_add(1, Ordering::AcqRel);
                if attempt >= MAX_SIDECAR_RESTARTS {
                    event_runtime.set_status("restart_exhausted");
                    break;
                }
                event_runtime.set_status("restart_backoff");
                let restart_runtime = event_runtime.clone();
                let restart_app = event_app.clone();
                thread::spawn(move || {
                    thread::sleep(Duration::from_millis(RESTART_BACKOFF_MS[attempt]));
                    if restart_runtime.shutting_down.load(Ordering::Acquire)
                        || restart_runtime.generation.load(Ordering::Acquire) != generation
                    {
                        return;
                    }
                    if let Err(error) = start_release_backend(restart_app, restart_runtime.clone())
                    {
                        restart_runtime.set_status(&format!("restart_failed: {error}"));
                    }
                });
                break;
            }
        }
    });

    let health_runtime = runtime.clone();
    thread::spawn(move || {
        let health_url = format!("http://127.0.0.1:{port}/api/health");
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_millis(800))
            .build();
        let ready = client.map(|client| {
            (0..40).any(|_| {
                if health_runtime.shutting_down.load(Ordering::Acquire)
                    || health_runtime.generation.load(Ordering::Acquire) != generation
                {
                    return false;
                }
                let healthy = client
                    .get(&health_url)
                    .send()
                    .map(|response| response.status().is_success())
                    .unwrap_or(false);
                if !healthy {
                    thread::sleep(Duration::from_millis(250));
                }
                healthy
            })
        });
        if matches!(ready, Ok(true))
            && health_runtime.generation.load(Ordering::Acquire) == generation
            && !health_runtime.shutting_down.load(Ordering::Acquire)
        {
            health_runtime.set_status("ready");
            let stable_runtime = health_runtime.clone();
            thread::spawn(move || {
                thread::sleep(Duration::from_secs(60));
                if stable_runtime.generation.load(Ordering::Acquire) == generation
                    && !stable_runtime.shutting_down.load(Ordering::Acquire)
                {
                    stable_runtime.restart_attempts.store(0, Ordering::Release);
                }
            });
            if let Some(window) = app.get_webview_window("main") {
                if let Ok(url) = format!("http://127.0.0.1:{port}").parse() {
                    let _ = window.navigate(url);
                }
            }
        } else if health_runtime.generation.load(Ordering::Acquire) == generation
            && !health_runtime.shutting_down.load(Ordering::Acquire)
        {
            health_runtime.set_status("healthcheck_failed");
            if let Ok(mut child) = health_runtime.child.lock() {
                if let Some(process) = child.take() {
                    let _ = process.kill();
                }
            }
        }
    });
    Ok(())
}

#[cfg(windows)]
fn request_graceful_stop(pid: u32) -> bool {
    use windows_sys::Win32::System::Console::{
        AttachConsole, FreeConsole, GenerateConsoleCtrlEvent, SetConsoleCtrlHandler, CTRL_C_EVENT,
    };
    unsafe {
        if AttachConsole(pid) == 0 {
            return false;
        }
        let _ = SetConsoleCtrlHandler(None, 1);
        let sent = GenerateConsoleCtrlEvent(CTRL_C_EVENT, 0) != 0;
        let _ = FreeConsole();
        let _ = SetConsoleCtrlHandler(None, 0);
        sent
    }
}

#[cfg(not(windows))]
fn request_graceful_stop(_pid: u32) -> bool {
    false
}

fn begin_shutdown(app: tauri::AppHandle, runtime: BackendRuntime, exit_code: i32) {
    if runtime.shutting_down.swap(true, Ordering::AcqRel) {
        return;
    }
    runtime.set_status("stopping");
    runtime.generation.fetch_add(1, Ordering::AcqRel);
    if let Ok(mut bootstrap) = runtime.owner_bootstrap.lock() {
        bootstrap.take();
    }
    if let Ok(mut bridge) = runtime.desktop_bridge.lock() {
        bridge.take();
    }
    app.state::<computer::ComputerState>().clear_bridge();
    app.state::<cross_device::CrossDeviceState>().clear_bridge();
    app.state::<obsidian_picker::ObsidianVaultPickerState>()
        .revoke_all("APP_SHUTDOWN");
    app.state::<advanced::AdvancedNativeState>()
        .revoke_all("APP_SHUTDOWN");
    let graceful_requested = runtime
        .child
        .lock()
        .ok()
        .and_then(|child| child.as_ref().map(CommandChild::pid))
        .map(request_graceful_stop)
        .unwrap_or(true);
    thread::spawn(move || {
        let attempts = if graceful_requested { 50 } else { 1 };
        for _ in 0..attempts {
            if runtime
                .child
                .lock()
                .map(|child| child.is_none())
                .unwrap_or(true)
            {
                runtime.set_status("stopped");
                app.exit(exit_code);
                return;
            }
            thread::sleep(Duration::from_millis(100));
        }
        if let Ok(mut child) = runtime.child.lock() {
            if let Some(process) = child.take() {
                let _ = process.kill();
            }
        }
        runtime.set_status("stopped_forced");
        app.exit(exit_code);
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(not(debug_assertions))]
    if let Some(root) = packaged_e2e_root_from_env().expect("invalid packaged E2E isolation root") {
        let webview_data = prepare_packaged_e2e_directory(&root, "webview-data")
            .expect("packaged E2E WebView root unavailable");
        std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", webview_data);
    }
    let app = tauri::Builder::default()
        .manage(advanced::AdvancedNativeState::default())
        .manage(computer::ComputerState::default())
        .manage(cross_device::CrossDeviceState::default())
        .manage(obsidian_picker::ObsidianVaultPickerState::default())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let backend_runtime = BackendRuntime::default();
            #[cfg(debug_assertions)]
            backend_runtime.set_status("development_external");
            app.manage(backend_runtime.clone());
            #[cfg(not(debug_assertions))]
            start_release_backend(app.handle().clone(), backend_runtime)?;
            #[cfg(debug_assertions)]
            if let Some(window) = app.get_webview_window("main") {
                window.open_devtools();
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_version,
            desktop_shell_status,
            backend_runtime_status,
            desktop_owner_bootstrap_token,
            toggle_fullscreen,
            toggle_maximize,
            start_window_drag,
            minimize_window,
            close_window,
            computer::computer_status,
            computer::computer_begin,
            computer::computer_observe,
            computer::computer_screenshot,
            computer::computer_action,
            computer::computer_stop,
            cross_device::cross_device_native_status,
            cross_device::cross_device_live_view_start,
            cross_device::cross_device_live_view_frame,
            cross_device::cross_device_live_view_stop,
            cross_device::cross_device_pc_status,
            cross_device::cross_device_wake_request,
            cross_device::cross_device_select_source,
            cross_device::cross_device_approve_destination,
            cross_device::cross_device_read_source_chunk,
            cross_device::cross_device_begin_inbox_transfer,
            cross_device::cross_device_write_inbox_chunk,
            cross_device::cross_device_cleanup_inbox,
            cross_device::cross_device_audio_lease_start,
            cross_device::cross_device_audio_lease_release,
            cross_device::cross_device_revoke_owner,
            cross_device::cross_device_producer_ingest,
            obsidian_picker::obsidian_request_vault_folder,
            advanced::advanced_native_status,
            advanced::advanced_power_presence,
            advanced::advanced_current_app,
            advanced::advanced_visual_bookmark_capture,
            advanced::advanced_workspace_snapshot,
            advanced::advanced_workspace_restore,
            advanced::advanced_workspace_restore_stop,
            advanced::advanced_scene_activate,
            advanced::advanced_scene_revert,
            advanced::advanced_watcher_register,
            advanced::advanced_download_select,
            advanced::advanced_download_sample,
            advanced::advanced_shadow_set,
            advanced::advanced_shadow_observe,
            advanced::advanced_smart_retry,
        ])
        .build(tauri::generate_context!())
        .expect("E.D.I.T.H. could not start");

    app.run(|app_handle, event| match event {
        tauri::RunEvent::ExitRequested { api, code, .. } => {
            let runtime = app_handle.state::<BackendRuntime>().inner().clone();
            if !runtime.shutting_down.load(Ordering::Acquire) {
                api.prevent_exit();
                begin_shutdown(app_handle.clone(), runtime, code.unwrap_or(0));
            }
        }
        tauri::RunEvent::Exit => {
            let runtime = app_handle.state::<BackendRuntime>();
            runtime.shutting_down.store(true, Ordering::Release);
            runtime.generation.fetch_add(1, Ordering::AcqRel);
            if let Ok(mut bootstrap) = runtime.owner_bootstrap.lock() {
                bootstrap.take();
            }
            if let Ok(mut bridge) = runtime.desktop_bridge.lock() {
                bridge.take();
            }
            app_handle.state::<computer::ComputerState>().clear_bridge();
            app_handle
                .state::<cross_device::CrossDeviceState>()
                .clear_bridge();
            app_handle
                .state::<obsidian_picker::ObsidianVaultPickerState>()
                .revoke_all("APP_EXIT");
            app_handle
                .state::<advanced::AdvancedNativeState>()
                .revoke_all("APP_EXIT");
            if let Ok(mut child) = runtime.child.lock() {
                if let Some(process) = child.take() {
                    let _ = process.kill();
                }
            };
        }
        _ => {}
    });
}

#[cfg(test)]
mod tests {
    use super::{
        new_owner_token, prepare_packaged_e2e_directory, resolve_packaged_e2e_root,
        PACKAGED_E2E_MARKER,
    };
    use std::fs;
    use std::path::{Path, PathBuf};

    fn fixture_root(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "edith-phase11g-{label}-{}",
            new_owner_token().expect("fixture token")
        ))
    }

    fn write_marker(root: &Path) {
        fs::write(root.join(".edith-phase11e-root"), PACKAGED_E2E_MARKER).expect("fixture marker");
    }

    #[test]
    fn owner_bootstrap_tokens_are_high_entropy_and_rotate() {
        let first = new_owner_token().expect("first token");
        let second = new_owner_token().expect("second token");
        assert_eq!(first.len(), 64);
        assert_eq!(second.len(), 64);
        assert_ne!(first, second);
        assert!(first.chars().all(|character| character.is_ascii_hexdigit()));
    }

    #[test]
    fn packaged_e2e_root_requires_explicit_gate_temp_containment_and_marker() {
        let root = fixture_root("valid");
        fs::create_dir_all(&root).expect("fixture root");
        write_marker(&root);

        assert!(
            resolve_packaged_e2e_root(Some("true"), Some(root.clone()), &std::env::temp_dir())
                .expect("valid root")
                .is_some()
        );
        assert!(
            resolve_packaged_e2e_root(None, Some(root.clone()), &std::env::temp_dir()).is_err()
        );
        assert!(resolve_packaged_e2e_root(
            Some("true"),
            Some(std::env::temp_dir()),
            &std::env::temp_dir()
        )
        .is_err());
        assert!(resolve_packaged_e2e_root(
            Some("true"),
            Some(PathBuf::from("relative-root")),
            &std::env::temp_dir()
        )
        .is_err());
        assert!(resolve_packaged_e2e_root(
            Some("true"),
            std::env::temp_dir().parent().map(Path::to_path_buf),
            &std::env::temp_dir()
        )
        .is_err());

        fs::remove_dir_all(root).expect("fixture cleanup");
    }

    #[test]
    fn packaged_e2e_root_rejects_missing_and_invalid_markers() {
        let missing = fixture_root("missing-marker");
        fs::create_dir_all(&missing).expect("missing marker root");
        assert!(resolve_packaged_e2e_root(
            Some("true"),
            Some(missing.clone()),
            &std::env::temp_dir()
        )
        .is_err());

        let invalid = fixture_root("invalid-marker");
        fs::create_dir_all(&invalid).expect("invalid marker root");
        fs::write(invalid.join(".edith-phase11e-root"), "invalid\n").expect("invalid marker");
        assert!(resolve_packaged_e2e_root(
            Some("true"),
            Some(invalid.clone()),
            &std::env::temp_dir()
        )
        .is_err());

        fs::remove_dir_all(missing).expect("missing marker cleanup");
        fs::remove_dir_all(invalid).expect("invalid marker cleanup");
    }

    #[cfg(windows)]
    fn create_junction(link: &Path, target: &Path) {
        let status = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(link)
            .arg(target)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .expect("junction command");
        assert!(status.success(), "junction fixture must be created");
    }

    #[cfg(windows)]
    #[test]
    fn packaged_e2e_root_rejects_junctions_and_reparse_children() {
        let base = fixture_root("junction");
        let target = base.join("target");
        let junction = base.join("junction-root");
        fs::create_dir_all(&target).expect("junction target");
        write_marker(&target);
        create_junction(&junction, &target);

        assert!(resolve_packaged_e2e_root(
            Some("true"),
            Some(junction.clone()),
            &std::env::temp_dir()
        )
        .is_err());

        fs::remove_dir(&junction).expect("junction cleanup");
        let safe = base.join("safe-root");
        let redirect_target = base.join("redirect-target");
        fs::create_dir_all(&safe).expect("safe root");
        fs::create_dir_all(&redirect_target).expect("redirect target");
        write_marker(&safe);
        let resolved =
            resolve_packaged_e2e_root(Some("true"), Some(safe.clone()), &std::env::temp_dir())
                .expect("safe root result")
                .expect("safe root");
        create_junction(&safe.join("webview-data"), &redirect_target);
        assert!(prepare_packaged_e2e_directory(&resolved, "webview-data").is_err());
        fs::remove_dir(safe.join("webview-data")).expect("redirect cleanup");
        create_junction(&safe.join("app-data"), &redirect_target);
        assert!(prepare_packaged_e2e_directory(&resolved, "app-data").is_err());
        fs::remove_dir(safe.join("app-data")).expect("app redirect cleanup");

        fs::remove_dir_all(base).expect("junction fixture cleanup");
    }

    #[cfg(windows)]
    #[test]
    fn packaged_e2e_root_rejects_directory_symlink_when_supported() {
        let base = fixture_root("symlink");
        let target = base.join("target");
        let symlink = base.join("symlink-root");
        fs::create_dir_all(&target).expect("symlink target");
        write_marker(&target);
        match std::os::windows::fs::symlink_dir(&target, &symlink) {
            Ok(()) => {
                assert!(resolve_packaged_e2e_root(
                    Some("true"),
                    Some(symlink.clone()),
                    &std::env::temp_dir()
                )
                .is_err());
                fs::remove_dir(&symlink).expect("symlink cleanup");
            }
            Err(error) if error.kind() == std::io::ErrorKind::PermissionDenied => {}
            Err(error) => panic!("unexpected symlink fixture error: {error}"),
        }
        fs::remove_dir_all(base).expect("symlink fixture cleanup");
    }
}
