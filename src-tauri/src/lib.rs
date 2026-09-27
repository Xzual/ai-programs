#[cfg(not(debug_assertions))]
use std::net::TcpListener;
#[cfg(not(debug_assertions))]
use std::path::{Path, PathBuf};
#[cfg(all(windows, not(debug_assertions)))]
use std::path::{Component, Prefix};
use std::sync::{
    atomic::{AtomicBool, AtomicU16, AtomicU64, AtomicUsize, Ordering},
    Arc, Mutex,
};
use std::{thread, time::Duration};
use tauri::{Manager, State};
use tauri_plugin_shell::process::CommandChild;
#[cfg(not(debug_assertions))]
use tauri_plugin_shell::ShellExt;

mod computer;

const MAX_SIDECAR_RESTARTS: usize = 3;
const RESTART_BACKOFF_MS: [u64; MAX_SIDECAR_RESTARTS] = [500, 1_500, 3_500];

#[derive(Clone)]
struct BackendRuntime {
    port: Arc<AtomicU16>,
    status: Arc<Mutex<String>>,
    child: Arc<Mutex<Option<CommandChild>>>,
    generation: Arc<AtomicU64>,
    restart_attempts: Arc<AtomicUsize>,
    shutting_down: Arc<AtomicBool>,
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
        }
    }
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

#[cfg(not(debug_assertions))]
fn is_local_absolute_path(path: &Path) -> bool {
    if !path.is_absolute() {
        return false;
    }
    #[cfg(windows)]
    {
        return matches!(
            path.components().next(),
            Some(Component::Prefix(prefix))
                if matches!(prefix.kind(), Prefix::Disk(_) | Prefix::VerbatimDisk(_))
        );
    }
    #[cfg(not(windows))]
    true
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
    let app_data = app.path().app_local_data_dir()?;
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
    let app = tauri::Builder::default()
        .manage(computer::ComputerState::default())
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
            if let Ok(mut child) = runtime.child.lock() {
                if let Some(process) = child.take() {
                    let _ = process.kill();
                }
            };
        }
        _ => {}
    });
}
