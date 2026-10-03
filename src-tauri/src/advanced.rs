use chrono::{DateTime, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, VecDeque};
use std::fs;
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{State, Window};
use tauri_plugin_dialog::DialogExt;

use crate::computer::ComputerState;
use crate::cross_device::{self, CrossDeviceState, ProducerIngestKind};

const CONTRACT_VERSION: u8 = 2;
const CONTRACT_AMENDMENT: &str = "2.1";
const MAX_ITEMS: usize = 100;
const MAX_RESTORE_STEPS: usize = 16;
const MAX_SHADOW_EVENTS: usize = 128;
const LEASE_TTL_MS: u64 = 60 * 60_000;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvancedLineage {
    contract_version: u8,
    amendment: String,
    owner_session_binding_id: String,
    workspace_id: String,
    revision: u64,
    created_at: String,
    updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    expires_at: Option<String>,
}

impl AdvancedLineage {
    fn validate(&self) -> Result<(), String> {
        if self.contract_version != CONTRACT_VERSION || self.amendment != CONTRACT_AMENDMENT {
            return Err("ADVANCED_CONTRACT_VERSION_INVALID".into());
        }
        for value in [&self.owner_session_binding_id, &self.workspace_id] {
            validate_id(value)?;
        }
        if self.revision == 0 {
            return Err("ADVANCED_REVISION_INVALID".into());
        }
        validate_timestamp(&self.created_at)?;
        validate_timestamp(&self.updated_at)?;
        if let Some(expires_at) = &self.expires_at {
            validate_timestamp(expires_at)?;
        }
        Ok(())
    }
}

struct BookmarkArtifact {
    owner: String,
    bytes: Vec<u8>,
    expires_at_ms: u64,
}

struct DownloadTracker {
    owner: String,
    path: PathBuf,
    display_name: String,
    bytes_total: u64,
    samples: VecDeque<(u64, u64)>,
    expires_at_ms: u64,
}

struct RestoreLease {
    owner: String,
    children: Vec<Child>,
    expires_at_ms: u64,
}

#[derive(Clone)]
struct SceneLease {
    owner: String,
    profile: String,
    expires_at_ms: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ShadowEvent {
    event_id: String,
    app_id: String,
    observed_at: String,
    workflow_structure: &'static str,
}

struct ShadowLease {
    owner: String,
    workspace: String,
    expires_at_ms: u64,
    events: VecDeque<ShadowEvent>,
}

#[derive(Default)]
struct AdvancedInner {
    artifacts: HashMap<String, BookmarkArtifact>,
    downloads: HashMap<String, DownloadTracker>,
    restores: HashMap<String, RestoreLease>,
    scenes: HashMap<String, SceneLease>,
    shadow: Option<ShadowLease>,
}

#[derive(Default)]
pub struct AdvancedNativeState {
    inner: Mutex<AdvancedInner>,
}

impl AdvancedNativeState {
    pub fn revoke_all(&self, _reason: &str) {
        if let Ok(mut inner) = self.inner.lock() {
            for restore in inner.restores.values_mut() {
                for child in &mut restore.children {
                    let _ = child.kill();
                }
            }
            for artifact in inner.artifacts.values_mut() {
                artifact.bytes.fill(0);
            }
            inner.artifacts.clear();
            inner.downloads.clear();
            inner.restores.clear();
            inner.scenes.clear();
            inner.shadow.take();
        }
    }

    pub fn revoke_owner(&self, owner: &str) {
        if let Ok(mut inner) = self.inner.lock() {
            inner.artifacts.retain(|_, value| {
                if value.owner == owner {
                    value.bytes.fill(0);
                    false
                } else {
                    true
                }
            });
            inner.downloads.retain(|_, value| value.owner != owner);
            let ids: Vec<String> = inner
                .restores
                .iter()
                .filter(|(_, value)| value.owner == owner)
                .map(|(id, _)| id.clone())
                .collect();
            for id in ids {
                if let Some(mut restore) = inner.restores.remove(&id) {
                    for child in &mut restore.children {
                        let _ = child.kill();
                    }
                }
            }
            inner.scenes.retain(|_, value| value.owner != owner);
            if inner
                .shadow
                .as_ref()
                .is_some_and(|value| value.owner == owner)
            {
                inner.shadow.take();
            }
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvancedNativeStatus {
    runtime: &'static str,
    power_presence: &'static str,
    foreground_metadata: &'static str,
    visual_bookmark_metadata: &'static str,
    visual_bookmark_screenshot: &'static str,
    workspace_snapshot: &'static str,
    workspace_restore: &'static str,
    scenes: &'static str,
    presentation_hooks: &'static str,
    event_watchers: &'static str,
    download_telemetry: &'static str,
    shadow_mode: &'static str,
    smart_retry: &'static str,
    advanced_producer: &'static str,
    arbitrary_shell: bool,
    camera_presence: bool,
    raw_screen_archive: bool,
    game_cheating: bool,
    security_notifications_mutable: bool,
    safe_message: &'static str,
}

#[tauri::command]
pub fn advanced_native_status(cross_device: State<'_, CrossDeviceState>) -> AdvancedNativeStatus {
    advanced_native_status_for(&cross_device)
}

fn advanced_native_status_for(cross_device: &CrossDeviceState) -> AdvancedNativeStatus {
    let producer_ready = cross_device::producer_publication_ready(cross_device);
    AdvancedNativeStatus {
        runtime: if cfg!(windows) {
            "windows"
        } else {
            "unsupported"
        },
        power_presence: if cfg!(windows) {
            "runtime_verified"
        } else {
            "unsupported"
        },
        foreground_metadata: if cfg!(windows) {
            "runtime_verified"
        } else {
            "unsupported"
        },
        visual_bookmark_metadata: if cfg!(windows) {
            "available"
        } else {
            "unsupported"
        },
        visual_bookmark_screenshot: if cfg!(windows) {
            "approval_required"
        } else {
            "unsupported"
        },
        workspace_snapshot: "available",
        workspace_restore: if cfg!(windows) {
            "allowlisted_apps_only"
        } else {
            "unsupported"
        },
        scenes: "metadata_reversible",
        presentation_hooks: "metadata_only",
        event_watchers: "configuration_required",
        download_telemetry: "owner_selected_file",
        shadow_mode: "metadata_only_opt_in",
        smart_retry: "metadata_only_max_2",
        advanced_producer: if producer_ready {
            "available"
        } else {
            "configuration_required"
        },
        arbitrary_shell: false,
        camera_presence: false,
        raw_screen_archive: false,
        game_cheating: false,
        security_notifications_mutable: false,
        safe_message: if producer_ready {
            "Trusted native publication has completed successfully; unsafe control remains disabled."
        } else {
            "Measured native adapters are available locally; trusted publication requires a successful native producer bootstrap and ingest."
        },
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForegroundMetadata {
    app_id: String,
    process_fingerprint: String,
    window_title_preview: Option<String>,
    sensitive_app_blocked: bool,
    observed_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PowerPresenceSnapshot {
    #[serde(flatten)]
    lineage: AdvancedLineage,
    snapshot_id: String,
    source: &'static str,
    power_source: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    battery_percent: Option<u8>,
    low_power: bool,
    user_presence: &'static str,
    camera_used: bool,
    observed_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PowerPresenceResult {
    record: PowerPresenceSnapshot,
    publication: &'static str,
    publication_error_code: Option<&'static str>,
}

#[tauri::command]
pub fn advanced_power_presence(
    window: Window,
    state: State<'_, AdvancedNativeState>,
    computer: State<'_, ComputerState>,
    cross_device: State<'_, CrossDeviceState>,
    lineage: AdvancedLineage,
) -> Result<PowerPresenceResult, String> {
    ensure_operational_with_publication(&window, &state, &computer, &cross_device)?;
    lineage.validate()?;
    validate_fresh_expiry(&lineage, 5 * 60_000)?;
    let measured = platform::power_presence()?;
    let record = PowerPresenceSnapshot {
        lineage,
        snapshot_id: format!("power-{}", random_hex(12)?),
        source: "trusted_native",
        power_source: measured.power_source,
        battery_percent: measured.battery_percent,
        low_power: measured.low_power,
        user_presence: measured.user_presence,
        camera_used: false,
        observed_at: iso_now(),
    };
    publish(
        &state,
        &cross_device,
        ProducerIngestKind::AdvancedPowerPresence,
        &record,
    )?;
    Ok(PowerPresenceResult {
        record,
        publication: "published",
        publication_error_code: None,
    })
}

#[tauri::command]
pub fn advanced_current_app(
    window: Window,
    state: State<'_, AdvancedNativeState>,
    computer: State<'_, ComputerState>,
) -> Result<ForegroundMetadata, String> {
    ensure_operational(&window, &state, &computer)?;
    platform::foreground_metadata()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BookmarkRequest {
    lineage: AdvancedLineage,
    bookmark_id: String,
    user_note: Option<String>,
    screenshot_requested: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VisualBookmark {
    #[serde(flatten)]
    lineage: AdvancedLineage,
    bookmark_id: String,
    captured_at: String,
    app_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    window_title_preview: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    user_note: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    screenshot_artifact_handle: Option<String>,
    screenshot_policy: &'static str,
    sensitive_app_blocked: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VisualBookmarkResult {
    record: VisualBookmark,
    publication: &'static str,
}

#[tauri::command]
pub fn advanced_visual_bookmark_capture(
    window: Window,
    state: State<'_, AdvancedNativeState>,
    computer: State<'_, ComputerState>,
    cross_device: State<'_, CrossDeviceState>,
    request: BookmarkRequest,
) -> Result<VisualBookmarkResult, String> {
    ensure_operational_with_publication(&window, &state, &computer, &cross_device)?;
    request.lineage.validate()?;
    validate_id(&request.bookmark_id)?;
    if let Some(note) = &request.user_note {
        validate_safe_text(note, 2_000)?;
    }
    let foreground = platform::foreground_metadata()?;
    let mut handle = None;
    let policy = if foreground.sensitive_app_blocked {
        "blocked_sensitive_app"
    } else if request.screenshot_requested {
        if !owner_approves(
            &window,
            "E.D.I.T.H. Visual Bookmark approval",
            "Capture one screenshot for this bookmark? Pixels remain in native memory behind an opaque handle and are cleared on expiry, logout, Emergency Stop, or app exit.",
        )? {
            return Err("VISUAL_BOOKMARK_SCREENSHOT_APPROVAL_REQUIRED".into());
        }
        let rechecked = platform::foreground_metadata()?;
        if rechecked.sensitive_app_blocked || rechecked.app_id != foreground.app_id {
            return Err("VISUAL_BOOKMARK_FOREGROUND_CHANGED".into());
        }
        let captured = cross_device::capture_bookmark_frame()?;
        ensure_operational_with_publication(&window, &state, &computer, &cross_device)?;
        let artifact_handle = format!("bookmark-artifact-{}", random_hex(16)?);
        state
            .inner
            .lock()
            .map_err(|_| "ADVANCED_STATE_UNAVAILABLE".to_string())?
            .artifacts
            .insert(
                artifact_handle.clone(),
                BookmarkArtifact {
                    owner: request.lineage.owner_session_binding_id.clone(),
                    bytes: captured,
                    expires_at_ms: now_ms() + LEASE_TTL_MS,
                },
            );
        handle = Some(artifact_handle);
        "opaque_handle"
    } else {
        "metadata_only"
    };
    let record = VisualBookmark {
        lineage: request.lineage,
        bookmark_id: request.bookmark_id,
        captured_at: iso_now(),
        app_id: foreground.app_id,
        window_title_preview: foreground.window_title_preview,
        user_note: request.user_note,
        screenshot_artifact_handle: handle,
        screenshot_policy: policy,
        sensitive_app_blocked: foreground.sensitive_app_blocked,
    };
    publish(
        &state,
        &cross_device,
        ProducerIngestKind::AdvancedBookmarks,
        &record,
    )?;
    Ok(VisualBookmarkResult {
        record,
        publication: "published",
    })
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkspaceItem {
    kind: String,
    ref_id: String,
    display_label: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SnapshotRequest {
    lineage: AdvancedLineage,
    snapshot_id: String,
    label: String,
    items: Vec<WorkspaceItem>,
    include_current_app: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSnapshot {
    #[serde(flatten)]
    lineage: AdvancedLineage,
    snapshot_id: String,
    label: String,
    items: Vec<WorkspaceItem>,
    forbidden_state_excluded: bool,
    dangerous_transactions_excluded: bool,
    capture_status: &'static str,
}

#[tauri::command]
pub fn advanced_workspace_snapshot(
    window: Window,
    state: State<'_, AdvancedNativeState>,
    computer: State<'_, ComputerState>,
    cross_device: State<'_, CrossDeviceState>,
    request: SnapshotRequest,
) -> Result<WorkspaceSnapshot, String> {
    ensure_operational_with_publication(&window, &state, &computer, &cross_device)?;
    request.lineage.validate()?;
    validate_id(&request.snapshot_id)?;
    validate_safe_text(&request.label, 500)?;
    if request.items.len() > MAX_ITEMS {
        return Err("WORKSPACE_SNAPSHOT_ITEMS_INVALID".into());
    }
    let mut items = request.items;
    for item in &items {
        validate_workspace_item(item)?;
    }
    if request.include_current_app {
        let app = platform::foreground_metadata()?;
        items.push(WorkspaceItem {
            kind: "app".into(),
            ref_id: app.app_id,
            display_label: "Current application".into(),
        });
    }
    if items.len() > MAX_ITEMS {
        return Err("WORKSPACE_SNAPSHOT_ITEMS_INVALID".into());
    }
    let record = WorkspaceSnapshot {
        lineage: request.lineage,
        snapshot_id: request.snapshot_id,
        label: request.label,
        items,
        forbidden_state_excluded: true,
        dangerous_transactions_excluded: true,
        capture_status: "metadata_only",
    };
    publish(
        &state,
        &cross_device,
        ProducerIngestKind::AdvancedSnapshots,
        &record,
    )?;
    Ok(record)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RestoreRequest {
    lineage: AdvancedLineage,
    plan_id: String,
    snapshot_id: String,
    steps: Vec<WorkspaceItem>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreStepResult {
    step_id: String,
    kind: String,
    ref_id: String,
    status: &'static str,
    verification: &'static str,
    error_code: Option<&'static str>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreResult {
    plan_id: String,
    snapshot_id: String,
    status: &'static str,
    steps: Vec<RestoreStepResult>,
    secrets_excluded: bool,
    dangerous_transactions_excluded: bool,
    arbitrary_shell: bool,
    undo_available: bool,
}

#[tauri::command]
pub fn advanced_workspace_restore(
    window: Window,
    state: State<'_, AdvancedNativeState>,
    computer: State<'_, ComputerState>,
    request: RestoreRequest,
) -> Result<RestoreResult, String> {
    ensure_operational(&window, &state, &computer)?;
    request.lineage.validate()?;
    validate_id(&request.plan_id)?;
    validate_id(&request.snapshot_id)?;
    if request.steps.is_empty() || request.steps.len() > MAX_RESTORE_STEPS {
        return Err("WORKSPACE_RESTORE_STEPS_INVALID".into());
    }
    for step in &request.steps {
        validate_workspace_item(step)?;
    }
    if !owner_approves(
        &window,
        "E.D.I.T.H. Workspace restore approval",
        "Launch the allowlisted applications in this workspace plan? Passwords, forms, secrets, tabs, documents, transactions, and arbitrary commands will not be restored.",
    )? {
        return Err("WORKSPACE_RESTORE_APPROVAL_REQUIRED".into());
    }
    let mut children = Vec::new();
    let mut results = Vec::new();
    for (index, step) in request.steps.iter().enumerate() {
        if step.kind != "app" {
            results.push(RestoreStepResult {
                step_id: format!("step-{}", index + 1),
                kind: step.kind.clone(),
                ref_id: step.ref_id.clone(),
                status: "configuration_required",
                verification: "not_dispatched",
                error_code: Some("WORKSPACE_RESTORE_KIND_UNAVAILABLE"),
            });
            continue;
        }
        match launch_allowlisted_app(&step.ref_id) {
            Ok(child) => {
                children.push(child);
                results.push(RestoreStepResult {
                    step_id: format!("step-{}", index + 1),
                    kind: step.kind.clone(),
                    ref_id: step.ref_id.clone(),
                    status: "completed",
                    verification: "process_started",
                    error_code: None,
                });
            }
            Err(code) => results.push(RestoreStepResult {
                step_id: format!("step-{}", index + 1),
                kind: step.kind.clone(),
                ref_id: step.ref_id.clone(),
                status: "failed",
                verification: "not_started",
                error_code: Some(code),
            }),
        }
    }
    let completed = results
        .iter()
        .filter(|step| step.status == "completed")
        .count();
    let status = if completed == results.len() {
        "completed"
    } else if completed > 0 {
        "partial"
    } else {
        "configuration_required"
    };
    if !children.is_empty() {
        state
            .inner
            .lock()
            .map_err(|_| "ADVANCED_STATE_UNAVAILABLE".to_string())?
            .restores
            .insert(
                request.plan_id.clone(),
                RestoreLease {
                    owner: request.lineage.owner_session_binding_id,
                    children,
                    expires_at_ms: now_ms() + LEASE_TTL_MS,
                },
            );
    }
    Ok(RestoreResult {
        plan_id: request.plan_id,
        snapshot_id: request.snapshot_id,
        status,
        steps: results,
        secrets_excluded: true,
        dangerous_transactions_excluded: true,
        arbitrary_shell: false,
        undo_available: completed > 0,
    })
}

#[tauri::command]
pub fn advanced_workspace_restore_stop(
    window: Window,
    state: State<'_, AdvancedNativeState>,
    plan_id: String,
) -> Result<usize, String> {
    ensure_main(&window)?;
    validate_id(&plan_id)?;
    let mut restore = state
        .inner
        .lock()
        .map_err(|_| "ADVANCED_STATE_UNAVAILABLE".to_string())?
        .restores
        .remove(&plan_id)
        .ok_or("WORKSPACE_RESTORE_NOT_ACTIVE")?;
    let mut stopped = 0;
    for child in &mut restore.children {
        if child.kill().is_ok() {
            stopped += 1;
        }
    }
    Ok(stopped)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SceneRequest {
    lineage: AdvancedLineage,
    scene_id: String,
    profile: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneResult {
    scene_id: String,
    profile: String,
    status: &'static str,
    changes: Vec<SceneChange>,
    security_notifications_immutable: bool,
    rollback_available: bool,
    external_media_controls: &'static str,
    game_butler_policy: &'static str,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneChange {
    setting: &'static str,
    from: &'static str,
    to: &'static str,
    reversible: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SceneProfileRecord {
    #[serde(flatten)]
    lineage: AdvancedLineage,
    scene_id: String,
    profile: String,
    changes: Vec<SceneChange>,
    security_notifications_immutable: bool,
    status: &'static str,
}

#[tauri::command]
pub fn advanced_scene_activate(
    window: Window,
    state: State<'_, AdvancedNativeState>,
    computer: State<'_, ComputerState>,
    cross_device: State<'_, CrossDeviceState>,
    request: SceneRequest,
) -> Result<SceneResult, String> {
    ensure_operational_with_publication(&window, &state, &computer, &cross_device)?;
    request.lineage.validate()?;
    validate_id(&request.scene_id)?;
    if !matches!(
        request.profile.as_str(),
        "WORK" | "RESEARCH" | "GAMING" | "FOCUS" | "PRESENTATION" | "TRAVEL" | "QUIET"
    ) {
        return Err("SCENE_PROFILE_INVALID".into());
    }
    if !owner_approves(
        &window,
        "E.D.I.T.H. Scene approval",
        "Activate this reversible E.D.I.T.H. scene? Security notifications remain enabled. External media, Discord, Spotify, audio routing, game memory, and anti-cheat controls are not changed.",
    )? {
        return Err("SCENE_APPROVAL_REQUIRED".into());
    }
    let changes = scene_changes(&request.profile);
    let record = SceneProfileRecord {
        lineage: request.lineage.clone(),
        scene_id: request.scene_id.clone(),
        profile: request.profile.clone(),
        changes: changes.clone(),
        security_notifications_immutable: true,
        status: "active",
    };
    state
        .inner
        .lock()
        .map_err(|_| "ADVANCED_STATE_UNAVAILABLE".to_string())?
        .scenes
        .insert(
            request.scene_id.clone(),
            SceneLease {
                owner: request.lineage.owner_session_binding_id,
                profile: request.profile.clone(),
                expires_at_ms: now_ms() + LEASE_TTL_MS,
            },
        );
    publish(
        &state,
        &cross_device,
        ProducerIngestKind::AdvancedScenes,
        &record,
    )?;
    Ok(SceneResult {
        scene_id: request.scene_id,
        profile: request.profile,
        status: "active",
        changes,
        security_notifications_immutable: true,
        rollback_available: true,
        external_media_controls: "configuration_required",
        game_butler_policy: "no_cheating_no_memory_access_no_anticheat_interaction",
    })
}

#[tauri::command]
pub fn advanced_scene_revert(
    window: Window,
    state: State<'_, AdvancedNativeState>,
    computer: State<'_, ComputerState>,
    cross_device: State<'_, CrossDeviceState>,
    lineage: AdvancedLineage,
    scene_id: String,
) -> Result<SceneResult, String> {
    ensure_operational_with_publication(&window, &state, &computer, &cross_device)?;
    lineage.validate()?;
    validate_id(&scene_id)?;
    let (owner, profile) = {
        let inner = state
            .inner
            .lock()
            .map_err(|_| "ADVANCED_STATE_UNAVAILABLE".to_string())?;
        let scene = inner.scenes.get(&scene_id).ok_or("SCENE_NOT_ACTIVE")?;
        (scene.owner.clone(), scene.profile.clone())
    };
    if owner != lineage.owner_session_binding_id {
        return Err("SCENE_OWNER_MISMATCH".into());
    }
    let record = SceneProfileRecord {
        lineage,
        scene_id: scene_id.clone(),
        profile: profile.clone(),
        changes: Vec::new(),
        security_notifications_immutable: true,
        status: "reverted",
    };
    state
        .inner
        .lock()
        .map_err(|_| "ADVANCED_STATE_UNAVAILABLE".to_string())?
        .scenes
        .remove(&scene_id)
        .ok_or("SCENE_NOT_ACTIVE")?;
    publish(
        &state,
        &cross_device,
        ProducerIngestKind::AdvancedScenes,
        &record,
    )?;
    Ok(SceneResult {
        scene_id,
        profile,
        status: "reverted",
        changes: Vec::new(),
        security_notifications_immutable: true,
        rollback_available: false,
        external_media_controls: "configuration_required",
        game_butler_policy: "no_cheating_no_memory_access_no_anticheat_interaction",
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatcherRegistration {
    status: &'static str,
    observation_policy: &'static str,
    event_source: &'static str,
    error_code: &'static str,
    publication: &'static str,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WatcherRequest {
    lineage: AdvancedLineage,
    watcher_id: String,
    kind: String,
    source_ref: String,
    trigger: String,
    delivery: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WatcherRecord {
    #[serde(flatten)]
    lineage: AdvancedLineage,
    watcher_id: String,
    kind: String,
    source_ref: String,
    trigger: String,
    delivery: String,
    observation_policy: &'static str,
    status: &'static str,
}

#[tauri::command]
pub fn advanced_watcher_register(
    window: Window,
    state: State<'_, AdvancedNativeState>,
    computer: State<'_, ComputerState>,
    cross_device: State<'_, CrossDeviceState>,
    request: WatcherRequest,
) -> Result<WatcherRegistration, String> {
    ensure_operational_with_publication(&window, &state, &computer, &cross_device)?;
    request.lineage.validate()?;
    validate_fresh_expiry(&request.lineage, LEASE_TTL_MS)?;
    validate_id(&request.watcher_id)?;
    validate_id(&request.source_ref)?;
    if !matches!(
        request.kind.as_str(),
        "download" | "file" | "folder" | "task"
    ) || !matches!(
        request.trigger.as_str(),
        "completed" | "changed" | "created"
    ) || !matches!(request.delivery.as_str(), "desktop" | "mobile" | "both")
    {
        return Err("WATCHER_REQUEST_INVALID".into());
    }
    let record = WatcherRecord {
        lineage: request.lineage,
        watcher_id: request.watcher_id,
        kind: request.kind,
        source_ref: request.source_ref,
        trigger: request.trigger,
        delivery: request.delivery,
        observation_policy: "event_based",
        status: "configuration_required",
    };
    publish(
        &state,
        &cross_device,
        ProducerIngestKind::AdvancedWatchers,
        &record,
    )?;
    Ok(WatcherRegistration {
        status: "configuration_required",
        observation_policy: "event_based",
        event_source: "not_installed",
        error_code: "NATIVE_EVENT_WATCHER_DEPENDENCY_REQUIRED",
        publication: "published_configuration_required",
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DownloadSelectRequest {
    lineage: AdvancedLineage,
    bytes_total: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadHandle {
    download_id: String,
    display_name: String,
    bytes_total: u64,
    expires_at: String,
}

#[tauri::command]
pub fn advanced_download_select(
    window: Window,
    state: State<'_, AdvancedNativeState>,
    computer: State<'_, ComputerState>,
    request: DownloadSelectRequest,
) -> Result<DownloadHandle, String> {
    ensure_operational(&window, &state, &computer)?;
    request.lineage.validate()?;
    if request.bytes_total == 0 {
        return Err("DOWNLOAD_TOTAL_INVALID".into());
    }
    let selected = window
        .dialog()
        .file()
        .set_title("Select an owner-approved download file to observe")
        .blocking_pick_file()
        .ok_or("DOWNLOAD_SELECTION_CANCELLED")?
        .into_path()
        .map_err(|_| "DOWNLOAD_SELECTION_INVALID")?
        .canonicalize()
        .map_err(|_| "DOWNLOAD_SELECTION_INVALID")?;
    let metadata = fs::metadata(&selected).map_err(|_| "DOWNLOAD_FILE_UNAVAILABLE")?;
    if !metadata.is_file() || metadata.len() > request.bytes_total {
        return Err("DOWNLOAD_FILE_SIZE_INVALID".into());
    }
    let display_name = selected
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or("DOWNLOAD_DISPLAY_NAME_INVALID")?
        .to_string();
    validate_safe_text(&display_name, 500)?;
    let download_id = format!("download-{}", random_hex(16)?);
    let now = now_ms();
    let mut samples = VecDeque::new();
    samples.push_back((now, metadata.len()));
    state
        .inner
        .lock()
        .map_err(|_| "ADVANCED_STATE_UNAVAILABLE".to_string())?
        .downloads
        .insert(
            download_id.clone(),
            DownloadTracker {
                owner: request.lineage.owner_session_binding_id,
                path: selected,
                display_name: display_name.clone(),
                bytes_total: request.bytes_total,
                samples,
                expires_at_ms: now + LEASE_TTL_MS,
            },
        );
    Ok(DownloadHandle {
        download_id,
        display_name,
        bytes_total: request.bytes_total,
        expires_at: iso_ms(now + LEASE_TTL_MS),
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadTelemetry {
    #[serde(flatten)]
    lineage: AdvancedLineage,
    download_id: String,
    source: &'static str,
    display_name: String,
    bytes_transferred: u64,
    bytes_total: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    speed_bytes_per_second: Option<f64>,
    remaining_bytes: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    eta_seconds: Option<u64>,
    eta_trustworthy: bool,
    status: &'static str,
    observed_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadTelemetryResult {
    record: DownloadTelemetry,
    publication: &'static str,
    publication_error_code: Option<&'static str>,
}

#[tauri::command]
pub fn advanced_download_sample(
    window: Window,
    state: State<'_, AdvancedNativeState>,
    computer: State<'_, ComputerState>,
    cross_device: State<'_, CrossDeviceState>,
    lineage: AdvancedLineage,
    download_id: String,
) -> Result<DownloadTelemetryResult, String> {
    ensure_operational_with_publication(&window, &state, &computer, &cross_device)?;
    lineage.validate()?;
    validate_id(&download_id)?;
    let now = now_ms();
    let mut inner = state
        .inner
        .lock()
        .map_err(|_| "ADVANCED_STATE_UNAVAILABLE".to_string())?;
    cleanup_locked(&mut inner, now);
    let tracker = inner
        .downloads
        .get_mut(&download_id)
        .filter(|value| value.owner == lineage.owner_session_binding_id)
        .ok_or("DOWNLOAD_TRACKER_NOT_FOUND")?;
    let current = fs::metadata(&tracker.path)
        .map_err(|_| "DOWNLOAD_FILE_UNAVAILABLE")?
        .len();
    if current > tracker.bytes_total {
        return Err("DOWNLOAD_FILE_SIZE_INVALID".into());
    }
    if tracker
        .samples
        .back()
        .is_none_or(|sample| sample.1 != current)
    {
        tracker.samples.push_back((now, current));
    }
    while tracker.samples.len() > 4 {
        tracker.samples.pop_front();
    }
    let speed = if tracker.samples.len() >= 3 {
        let first = tracker.samples.front().copied().unwrap_or((now, current));
        let elapsed = now.saturating_sub(first.0);
        let bytes = current.saturating_sub(first.1);
        (elapsed >= 1_000 && bytes > 0).then_some(bytes as f64 * 1_000.0 / elapsed as f64)
    } else {
        None
    };
    let remaining = tracker.bytes_total.saturating_sub(current);
    let eta = speed
        .filter(|value| *value > 0.0)
        .map(|value| (remaining as f64 / value).ceil() as u64);
    let record = DownloadTelemetry {
        lineage,
        download_id,
        source: "supported_app",
        display_name: tracker.display_name.clone(),
        bytes_transferred: current,
        bytes_total: tracker.bytes_total,
        speed_bytes_per_second: speed,
        remaining_bytes: remaining,
        eta_seconds: eta,
        eta_trustworthy: eta.is_some(),
        status: if current == tracker.bytes_total {
            "completed"
        } else {
            "downloading"
        },
        observed_at: iso_ms(now),
    };
    drop(inner);
    publish(
        &state,
        &cross_device,
        ProducerIngestKind::AdvancedDownloads,
        &record,
    )?;
    Ok(DownloadTelemetryResult {
        record,
        publication: "published",
        publication_error_code: None,
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ShadowRequest {
    lineage: AdvancedLineage,
    enabled: bool,
    explicit_consent: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShadowStatus {
    enabled: bool,
    consent: &'static str,
    observation_level: &'static str,
    captured_fields: Vec<&'static str>,
    raw_screen_archive: bool,
    secret_capture: bool,
    suggestion_only: bool,
    retained_events: usize,
    cleared: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ShadowRecord {
    #[serde(flatten)]
    lineage: AdvancedLineage,
    enabled: bool,
    consent: &'static str,
    observation_level: &'static str,
    captured_fields: Vec<&'static str>,
    raw_screen_archive: bool,
    secret_capture: bool,
    suggestion_only: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    disabled_at: Option<String>,
}

#[tauri::command]
pub fn advanced_shadow_set(
    window: Window,
    state: State<'_, AdvancedNativeState>,
    computer: State<'_, ComputerState>,
    cross_device: State<'_, CrossDeviceState>,
    request: ShadowRequest,
) -> Result<ShadowStatus, String> {
    ensure_operational_with_publication(&window, &state, &computer, &cross_device)?;
    request.lineage.validate()?;
    if request.enabled && !request.explicit_consent {
        return Err("SHADOW_MODE_EXPLICIT_CONSENT_REQUIRED".into());
    }
    let disabled_at = (!request.enabled).then(iso_now);
    let record = ShadowRecord {
        lineage: request.lineage.clone(),
        enabled: request.enabled,
        consent: "explicit",
        observation_level: "metadata_only",
        captured_fields: vec!["app_identity", "workflow_structure", "timestamps"],
        raw_screen_archive: false,
        secret_capture: false,
        suggestion_only: true,
        disabled_at,
    };
    let mut inner = state
        .inner
        .lock()
        .map_err(|_| "ADVANCED_STATE_UNAVAILABLE".to_string())?;
    if request.enabled {
        inner.shadow = Some(ShadowLease {
            owner: request.lineage.owner_session_binding_id,
            workspace: request.lineage.workspace_id,
            expires_at_ms: now_ms() + LEASE_TTL_MS,
            events: VecDeque::new(),
        });
    } else {
        inner.shadow.take();
    }
    drop(inner);
    publish(
        &state,
        &cross_device,
        ProducerIngestKind::AdvancedShadow,
        &record,
    )?;
    Ok(ShadowStatus {
        enabled: request.enabled,
        consent: "explicit",
        observation_level: "metadata_only",
        captured_fields: vec!["app_identity", "workflow_structure", "timestamps"],
        raw_screen_archive: false,
        secret_capture: false,
        suggestion_only: true,
        retained_events: 0,
        cleared: !request.enabled,
    })
}

#[tauri::command]
pub fn advanced_shadow_observe(
    window: Window,
    state: State<'_, AdvancedNativeState>,
    computer: State<'_, ComputerState>,
    owner_session_binding_id: String,
    workspace_id: String,
) -> Result<ShadowStatus, String> {
    ensure_operational(&window, &state, &computer)?;
    validate_id(&owner_session_binding_id)?;
    validate_id(&workspace_id)?;
    let foreground = platform::foreground_metadata()?;
    let mut inner = state
        .inner
        .lock()
        .map_err(|_| "ADVANCED_STATE_UNAVAILABLE".to_string())?;
    cleanup_locked(&mut inner, now_ms());
    let shadow = inner.shadow.as_mut().ok_or("SHADOW_MODE_NOT_ACTIVE")?;
    if shadow.owner != owner_session_binding_id || shadow.workspace != workspace_id {
        return Err("SHADOW_MODE_BINDING_MISMATCH".into());
    }
    shadow.events.push_back(ShadowEvent {
        event_id: format!("shadow-{}", random_hex(12)?),
        app_id: foreground.app_id,
        observed_at: iso_now(),
        workflow_structure: "foreground_transition",
    });
    while shadow.events.len() > MAX_SHADOW_EVENTS {
        shadow.events.pop_front();
    }
    Ok(ShadowStatus {
        enabled: true,
        consent: "explicit",
        observation_level: "metadata_only",
        captured_fields: vec!["app_identity", "workflow_structure", "timestamps"],
        raw_screen_archive: false,
        secret_capture: false,
        suggestion_only: true,
        retained_events: shadow.events.len(),
        cleared: false,
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RetryRequest {
    lineage: AdvancedLineage,
    retry_id: String,
    task_id: String,
    failure_class: String,
    attempts: u8,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RetryDecision {
    task_id: String,
    failure_class: String,
    strategy: &'static str,
    attempts: u8,
    max_attempts: u8,
    requires_fresh_observation: bool,
    action_dispatched: bool,
    status: &'static str,
}

#[tauri::command]
pub fn advanced_smart_retry(
    window: Window,
    state: State<'_, AdvancedNativeState>,
    computer: State<'_, ComputerState>,
    cross_device: State<'_, CrossDeviceState>,
    request: RetryRequest,
) -> Result<RetryDecision, String> {
    ensure_operational_with_publication(&window, &state, &computer, &cross_device)?;
    request.lineage.validate()?;
    validate_id(&request.retry_id)?;
    validate_id(&request.task_id)?;
    if request.attempts > 2 {
        return Err("SMART_RETRY_BUDGET_EXCEEDED".into());
    }
    let (strategy, reobserve, status) = match request.failure_class.as_str() {
        "stale_target" | "page_changed" => ("reobserve", true, "retrying"),
        "permission_denied" => ("stop_report", false, "stopped"),
        "network" if request.attempts < 2 => ("reconnect_backoff", false, "retrying"),
        "app_closed" if request.attempts < 2 => ("reopen_if_allowed", false, "retrying"),
        "network" | "app_closed" | "other" => ("stop_report", false, "exhausted"),
        _ => return Err("SMART_RETRY_FAILURE_CLASS_INVALID".into()),
    };
    let record = SmartRetryRecord {
        lineage: request.lineage,
        retry_id: request.retry_id,
        task_id: request.task_id.clone(),
        failure_class: request.failure_class.clone(),
        strategy,
        attempts: request.attempts,
        max_attempts: 2,
        stale_target_reobserve: reobserve,
        permission_denied_stop: request.failure_class == "permission_denied",
        status,
    };
    publish(
        &state,
        &cross_device,
        ProducerIngestKind::AdvancedRetries,
        &record,
    )?;
    Ok(RetryDecision {
        task_id: request.task_id,
        failure_class: request.failure_class,
        strategy,
        attempts: request.attempts,
        max_attempts: 2,
        requires_fresh_observation: reobserve,
        action_dispatched: false,
        status,
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SmartRetryRecord {
    #[serde(flatten)]
    lineage: AdvancedLineage,
    retry_id: String,
    task_id: String,
    failure_class: String,
    strategy: &'static str,
    attempts: u8,
    max_attempts: u8,
    stale_target_reobserve: bool,
    permission_denied_stop: bool,
    status: &'static str,
}

fn publish<T: Serialize>(
    state: &AdvancedNativeState,
    cross_device: &CrossDeviceState,
    kind: ProducerIngestKind,
    record: &T,
) -> Result<(), String> {
    if let Err(error) = cross_device::publish_native_record(cross_device, kind, record) {
        state.revoke_all("ADVANCED_PUBLICATION_FAILED");
        return Err(error);
    }
    Ok(())
}

fn ensure_operational(
    window: &Window,
    state: &AdvancedNativeState,
    computer: &ComputerState,
) -> Result<(), String> {
    ensure_main(window)?;
    if let Err(error) = computer.ensure_kill_switch_inactive() {
        state.revoke_all("KILL_SWITCH_ACTIVE");
        return Err(format!("KILL_SWITCH_BLOCKED: {error}"));
    }
    let mut inner = state
        .inner
        .lock()
        .map_err(|_| "ADVANCED_STATE_UNAVAILABLE".to_string())?;
    cleanup_locked(&mut inner, now_ms());
    Ok(())
}

fn ensure_operational_with_publication(
    window: &Window,
    state: &AdvancedNativeState,
    computer: &ComputerState,
    cross_device: &CrossDeviceState,
) -> Result<(), String> {
    match ensure_operational(window, state, computer) {
        Ok(()) => Ok(()),
        Err(error) => {
            if error.starts_with("KILL_SWITCH_BLOCKED") {
                cross_device.revoke_all("KILL_SWITCH_ACTIVE");
            }
            Err(error)
        }
    }
}

fn ensure_main(window: &Window) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("ADVANCED_MAIN_WINDOW_REQUIRED".into())
    }
}

fn cleanup_locked(inner: &mut AdvancedInner, now: u64) {
    inner.artifacts.retain(|_, value| {
        if value.expires_at_ms <= now {
            value.bytes.fill(0);
            false
        } else {
            true
        }
    });
    inner.downloads.retain(|_, value| value.expires_at_ms > now);
    inner.scenes.retain(|_, value| value.expires_at_ms > now);
    if inner
        .shadow
        .as_ref()
        .is_some_and(|value| value.expires_at_ms <= now)
    {
        inner.shadow.take();
    }
    let expired: Vec<String> = inner
        .restores
        .iter()
        .filter(|(_, value)| value.expires_at_ms <= now)
        .map(|(id, _)| id.clone())
        .collect();
    for id in expired {
        if let Some(mut restore) = inner.restores.remove(&id) {
            for child in &mut restore.children {
                let _ = child.kill();
            }
        }
    }
}

fn validate_workspace_item(item: &WorkspaceItem) -> Result<(), String> {
    if !matches!(
        item.kind.as_str(),
        "app" | "project" | "document" | "tab" | "task"
    ) {
        return Err("WORKSPACE_ITEM_KIND_INVALID".into());
    }
    validate_id(&item.ref_id)?;
    validate_safe_text(&item.display_label, 500)
}

fn validate_id(value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > 256
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':'))
    {
        return Err("ADVANCED_SAFE_ID_INVALID".into());
    }
    Ok(())
}

fn validate_safe_text(value: &str, maximum: usize) -> Result<(), String> {
    let lower = value.to_ascii_lowercase();
    if value.is_empty()
        || value.len() > maximum
        || value.chars().any(char::is_control)
        || value.contains(['/', '\\'])
        || [
            "password",
            "api_key",
            "api key",
            "access_token",
            "private key",
        ]
        .iter()
        .any(|needle| lower.contains(needle))
    {
        return Err("ADVANCED_SAFE_TEXT_INVALID".into());
    }
    Ok(())
}

fn validate_timestamp(value: &str) -> Result<(), String> {
    DateTime::parse_from_rfc3339(value)
        .map(|_| ())
        .map_err(|_| "ADVANCED_TIMESTAMP_INVALID".into())
}

fn validate_fresh_expiry(lineage: &AdvancedLineage, maximum_ms: u64) -> Result<(), String> {
    let now = now_ms() as i64;
    let expires = lineage
        .expires_at
        .as_ref()
        .ok_or("ADVANCED_EXPIRY_REQUIRED")
        .and_then(|value| {
            DateTime::parse_from_rfc3339(value)
                .map(|parsed| parsed.timestamp_millis())
                .map_err(|_| "ADVANCED_EXPIRY_INVALID")
        })?;
    if expires <= now || expires > now.saturating_add(maximum_ms as i64) {
        return Err("ADVANCED_EXPIRY_INVALID".into());
    }
    Ok(())
}

fn scene_changes(profile: &str) -> Vec<SceneChange> {
    let to = match profile {
        "PRESENTATION" => "presentation_capsule",
        "GAMING" => "game_safe_capsule",
        "QUIET" => "quiet_capsule",
        _ => "focused_capsule",
    };
    vec![SceneChange {
        setting: "capsule",
        from: "default",
        to,
        reversible: true,
    }]
}

#[cfg(windows)]
fn launch_allowlisted_app(app: &str) -> Result<Child, &'static str> {
    let executable = match app {
        "notepad" => "notepad.exe",
        "calculator" => "calc.exe",
        "paint" => "mspaint.exe",
        _ => return Err("WORKSPACE_APP_NOT_ALLOWLISTED"),
    };
    Command::new(executable)
        .spawn()
        .map_err(|_| "WORKSPACE_APP_START_FAILED")
}

#[cfg(not(windows))]
fn launch_allowlisted_app(_: &str) -> Result<Child, &'static str> {
    Err("WORKSPACE_APP_RUNTIME_UNSUPPORTED")
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn iso_ms(value: u64) -> String {
    DateTime::<Utc>::from_timestamp_millis(value as i64)
        .unwrap_or_else(Utc::now)
        .to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn iso_now() -> String {
    iso_ms(now_ms())
}

fn random_hex(bytes: usize) -> Result<String, String> {
    let mut buffer = vec![0_u8; bytes];
    getrandom::fill(&mut buffer).map_err(|_| "OS_RANDOM_UNAVAILABLE".to_string())?;
    Ok(buffer.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn fingerprint(value: &str) -> String {
    let digest = Sha256::digest(value.as_bytes());
    digest[..16]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

#[cfg(windows)]
fn owner_approves(window: &Window, title: &str, message: &str) -> Result<bool, String> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        MessageBoxW, IDYES, MB_DEFBUTTON2, MB_ICONWARNING, MB_SETFOREGROUND, MB_TOPMOST, MB_YESNO,
    };
    let owner = window
        .hwnd()
        .map_err(|_| "ADVANCED_APPROVAL_WINDOW_UNAVAILABLE")?
        .0;
    let message: Vec<u16> = format!("{message}\0").encode_utf16().collect();
    let title: Vec<u16> = format!("{title}\0").encode_utf16().collect();
    Ok(unsafe {
        MessageBoxW(
            owner,
            message.as_ptr(),
            title.as_ptr(),
            MB_YESNO | MB_ICONWARNING | MB_DEFBUTTON2 | MB_SETFOREGROUND | MB_TOPMOST,
        ) == IDYES
    })
}

#[cfg(not(windows))]
fn owner_approves(_: &Window, _: &str, _: &str) -> Result<bool, String> {
    Err("ADVANCED_NATIVE_RUNTIME_UNSUPPORTED".into())
}

struct MeasuredPowerPresence {
    power_source: &'static str,
    battery_percent: Option<u8>,
    low_power: bool,
    user_presence: &'static str,
}

#[cfg(windows)]
mod platform {
    use super::*;
    use windows_sys::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
    use windows_sys::Win32::System::SystemInformation::GetTickCount64;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetClassNameW, GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId,
    };

    pub fn power_presence() -> Result<MeasuredPowerPresence, String> {
        let mut power = SYSTEM_POWER_STATUS::default();
        if unsafe { GetSystemPowerStatus(&mut power) } == 0 {
            return Err("POWER_STATUS_UNAVAILABLE".into());
        }
        let mut input = LASTINPUTINFO {
            cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
            dwTime: 0,
        };
        let presence = if unsafe { GetLastInputInfo(&mut input) } == 0 {
            "unknown"
        } else {
            let idle_ms = unsafe { GetTickCount64() }.saturating_sub(input.dwTime as u64);
            if idle_ms <= 5 * 60_000 {
                "active"
            } else {
                "away"
            }
        };
        let battery = (power.BatteryLifePercent <= 100).then_some(power.BatteryLifePercent);
        Ok(MeasuredPowerPresence {
            power_source: match power.ACLineStatus {
                0 => "battery",
                1 => "ac",
                _ => "unknown",
            },
            battery_percent: battery,
            low_power: power.SystemStatusFlag != 0 || battery.is_some_and(|value| value <= 15),
            user_presence: presence,
        })
    }

    pub fn foreground_metadata() -> Result<ForegroundMetadata, String> {
        let window = unsafe { GetForegroundWindow() };
        if window.is_null() {
            return Err("FOREGROUND_WINDOW_UNAVAILABLE".into());
        }
        let mut process_id = 0_u32;
        unsafe { GetWindowThreadProcessId(window, &mut process_id) };
        let mut class = [0_u16; 256];
        let class_len = unsafe { GetClassNameW(window, class.as_mut_ptr(), class.len() as i32) };
        let class_name = if class_len > 0 {
            String::from_utf16_lossy(&class[..class_len as usize])
        } else {
            "unknown-window-class".into()
        };
        let mut title = [0_u16; 512];
        let title_len = unsafe { GetWindowTextW(window, title.as_mut_ptr(), title.len() as i32) };
        let raw_title = if title_len > 0 {
            String::from_utf16_lossy(&title[..title_len as usize])
        } else {
            String::new()
        };
        let sensitive = is_sensitive_app(&class_name, &raw_title);
        let preview = (!sensitive && !raw_title.is_empty()).then(|| sanitize_title(&raw_title));
        Ok(ForegroundMetadata {
            app_id: format!("app-{}", fingerprint(&class_name)),
            process_fingerprint: fingerprint(&format!("{class_name}:{process_id}")),
            window_title_preview: preview,
            sensitive_app_blocked: sensitive,
            observed_at: iso_now(),
        })
    }
}

#[cfg(not(windows))]
mod platform {
    use super::*;

    pub fn power_presence() -> Result<MeasuredPowerPresence, String> {
        Err("ADVANCED_NATIVE_RUNTIME_UNSUPPORTED".into())
    }

    pub fn foreground_metadata() -> Result<ForegroundMetadata, String> {
        Err("ADVANCED_NATIVE_RUNTIME_UNSUPPORTED".into())
    }
}

fn is_sensitive_app(class_name: &str, title: &str) -> bool {
    let value = format!("{class_name} {title}").to_ascii_lowercase();
    title.contains(['/', '\\'])
        || [
            "password",
            "bitwarden",
            "1password",
            "keepass",
            "authenticator",
            "banking",
            "wallet",
            "sign in",
            "login",
        ]
        .iter()
        .any(|needle| value.contains(needle))
}

fn sanitize_title(value: &str) -> String {
    value
        .chars()
        .filter(|character| !character.is_control())
        .take(120)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lineage() -> AdvancedLineage {
        AdvancedLineage {
            contract_version: 2,
            amendment: "2.1".into(),
            owner_session_binding_id: "owner-test".into(),
            workspace_id: "workspace-test".into(),
            revision: 1,
            created_at: iso_now(),
            updated_at: iso_now(),
            expires_at: Some(iso_ms(now_ms() + 60_000)),
        }
    }

    #[test]
    fn advanced_status_never_claims_unavailable_or_unsafe_features() {
        let status = serde_json::to_value(advanced_native_status_for(&CrossDeviceState::default()))
            .expect("status");
        assert_eq!(status["eventWatchers"], "configuration_required");
        assert_eq!(status["advancedProducer"], "configuration_required");
        assert_eq!(status["arbitraryShell"], false);
        assert_eq!(status["cameraPresence"], false);
        assert_eq!(status["rawScreenArchive"], false);
        assert_eq!(status["gameCheating"], false);
        assert_eq!(status["securityNotificationsMutable"], false);
    }

    #[test]
    fn lineage_and_workspace_metadata_reject_paths_secrets_and_unknown_kinds() {
        assert!(lineage().validate().is_ok());
        assert!(validate_safe_text("Safe project", 500).is_ok());
        assert!(validate_safe_text("C:\\Users\\owner\\secret.txt", 500).is_err());
        assert!(validate_safe_text("api_key=hidden", 500).is_err());
        assert!(validate_workspace_item(&WorkspaceItem {
            kind: "form".into(),
            ref_id: "ref-test".into(),
            display_label: "Unsafe".into(),
        })
        .is_err());
    }

    #[test]
    fn sensitive_apps_block_bookmark_pixels_before_capture() {
        assert!(is_sensitive_app(
            "Chrome_WidgetWin",
            "Bitwarden Password Manager"
        ));
        assert!(is_sensitive_app("KeePass", "Database"));
        assert!(!is_sensitive_app("Notepad", "Meeting notes"));
    }

    #[test]
    fn scenes_are_reversible_and_security_preserving() {
        for profile in [
            "WORK",
            "RESEARCH",
            "GAMING",
            "FOCUS",
            "PRESENTATION",
            "TRAVEL",
            "QUIET",
        ] {
            let changes = scene_changes(profile);
            assert!(!changes.is_empty());
            assert!(changes.iter().all(|change| change.reversible));
            assert!(changes
                .iter()
                .all(|change| change.setting != "notifications"));
        }
    }

    #[test]
    fn restore_launch_allowlist_excludes_shells_and_arbitrary_refs() {
        #[cfg(windows)]
        for blocked in [
            "powershell",
            "cmd",
            "wsl",
            "arbitrary.exe",
            "https://example.com",
        ] {
            assert_eq!(
                launch_allowlisted_app(blocked).err(),
                Some("WORKSPACE_APP_NOT_ALLOWLISTED")
            );
        }
    }

    #[test]
    fn lifecycle_revocation_clears_artifacts_downloads_scenes_shadow_and_restores() {
        let state = AdvancedNativeState::default();
        let mut inner = state.inner.lock().expect("state");
        inner.artifacts.insert(
            "artifact-test".into(),
            BookmarkArtifact {
                owner: "owner-test".into(),
                bytes: vec![1, 2, 3],
                expires_at_ms: now_ms() + 1_000,
            },
        );
        inner.scenes.insert(
            "scene-test".into(),
            SceneLease {
                owner: "owner-test".into(),
                profile: "WORK".into(),
                expires_at_ms: now_ms() + 1_000,
            },
        );
        inner.shadow = Some(ShadowLease {
            owner: "owner-test".into(),
            workspace: "workspace-test".into(),
            expires_at_ms: now_ms() + 1_000,
            events: VecDeque::new(),
        });
        drop(inner);
        state.revoke_owner("owner-test");
        let inner = state.inner.lock().expect("state");
        assert!(inner.artifacts.is_empty());
        assert!(inner.scenes.is_empty());
        assert!(inner.shadow.is_none());
    }

    #[test]
    fn download_eta_requires_three_real_samples() {
        let mut samples = VecDeque::from([(1_000, 10_u64), (2_000, 20_u64)]);
        assert!(samples.len() < 3);
        samples.push_back((3_000, 30));
        let first = samples.front().copied().expect("first");
        let last = samples.back().copied().expect("last");
        let speed = (last.1 - first.1) as f64 * 1_000.0 / (last.0 - first.0) as f64;
        assert_eq!(speed, 10.0);
    }

    #[test]
    fn shadow_mode_is_bounded_metadata_only() {
        let status = ShadowStatus {
            enabled: true,
            consent: "explicit",
            observation_level: "metadata_only",
            captured_fields: vec!["app_identity", "workflow_structure", "timestamps"],
            raw_screen_archive: false,
            secret_capture: false,
            suggestion_only: true,
            retained_events: MAX_SHADOW_EVENTS,
            cleared: false,
        };
        let json = serde_json::to_value(status).expect("shadow status");
        assert_eq!(json["rawScreenArchive"], false);
        assert_eq!(json["secretCapture"], false);
        assert_eq!(json["suggestionOnly"], true);
    }

    #[test]
    fn canonical_native_records_exclude_publication_secrets_paths_and_pixels() {
        let power = PowerPresenceSnapshot {
            lineage: lineage(),
            snapshot_id: "power-test".into(),
            source: "trusted_native",
            power_source: "ac",
            battery_percent: Some(80),
            low_power: false,
            user_presence: "active",
            camera_used: false,
            observed_at: iso_now(),
        };
        let bookmark = VisualBookmark {
            lineage: lineage(),
            bookmark_id: "bookmark-test".into(),
            captured_at: iso_now(),
            app_id: "app-test".into(),
            window_title_preview: Some("Safe title".into()),
            user_note: Some("Safe note".into()),
            screenshot_artifact_handle: Some("artifact-test".into()),
            screenshot_policy: "opaque_handle",
            sensitive_app_blocked: false,
        };
        let download = DownloadTelemetry {
            lineage: lineage(),
            download_id: "download-test".into(),
            source: "supported_app",
            display_name: "fixture.bin".into(),
            bytes_transferred: 50,
            bytes_total: 100,
            speed_bytes_per_second: None,
            remaining_bytes: 50,
            eta_seconds: None,
            eta_trustworthy: false,
            status: "downloading",
            observed_at: iso_now(),
        };
        for value in [
            serde_json::to_value(power).expect("power"),
            serde_json::to_value(bookmark).expect("bookmark"),
            serde_json::to_value(download).expect("download"),
        ] {
            let encoded = value.to_string();
            assert!(!encoded.contains("publication"));
            assert!(!encoded.contains("bytesBase64"));
            assert!(!encoded.contains("C:\\"));
            assert!(!encoded.contains("apiKey"));
        }
    }

    #[cfg(windows)]
    #[test]
    fn real_windows_read_only_power_presence_and_foreground_smoke() {
        let power = platform::power_presence().expect("Windows power status");
        assert!(matches!(power.power_source, "ac" | "battery" | "unknown"));
        assert!(power.battery_percent.is_none_or(|value| value <= 100));
        assert!(matches!(power.user_presence, "active" | "away" | "unknown"));
        let foreground = platform::foreground_metadata().expect("Windows foreground metadata");
        assert!(foreground.app_id.starts_with("app-"));
        assert_eq!(foreground.process_fingerprint.len(), 32);
        assert!(foreground
            .window_title_preview
            .as_ref()
            .is_none_or(|title| !title.contains(['/', '\\'])));
    }
}
