use base64::Engine;
use chrono::{DateTime, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{State, WebviewWindow, Window};
use tauri_plugin_dialog::DialogExt;

use crate::computer::ComputerState;

const CONTRACT_VERSION: u8 = 2;
const CONTRACT_AMENDMENT: &str = "2.1";
const MAX_LIVE_VIEW_FPS: u8 = 2;
const MAX_LIVE_VIEW_WIDTH: u32 = 1920;
const MAX_LIVE_VIEW_HEIGHT: u32 = 1080;
const MAX_LIVE_VIEW_TTL_MS: u64 = 5 * 60_000;
const MAX_TRANSFER_BYTES: u64 = 25 * 1024 * 1024;
const MAX_CHUNK_BYTES: usize = 256 * 1024;
const HANDLE_TTL_MS: u64 = 60 * 60_000;
const RETENTION_MS: u64 = 24 * 60 * 60_000;
const PRODUCER_SESSION_MAX_TTL_MS: u64 = 15 * 60_000;
const MAX_PRODUCER_PAYLOAD_BYTES: usize = 256 * 1024;
const OWNER_SESSION_COOKIE: &str = "edith_owner_session";

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CrossDeviceLineage {
    pub contract_version: u8,
    pub amendment: String,
    pub owner_session_binding_id: String,
    pub workspace_id: String,
    pub session_id: String,
    pub source_device_id: String,
    pub target_device_id: String,
}

impl CrossDeviceLineage {
    fn validate(&self) -> Result<(), String> {
        if self.contract_version != CONTRACT_VERSION || self.amendment != CONTRACT_AMENDMENT {
            return Err("CROSS_DEVICE_CONTRACT_VERSION_INVALID".into());
        }
        for value in [
            &self.owner_session_binding_id,
            &self.workspace_id,
            &self.session_id,
            &self.source_device_id,
            &self.target_device_id,
        ] {
            validate_safe_id(value)?;
        }
        if self.source_device_id == self.target_device_id {
            return Err("CROSS_DEVICE_LINEAGE_TARGET_INVALID".into());
        }
        Ok(())
    }
}

#[derive(Clone)]
struct LiveViewLease {
    lineage: CrossDeviceLineage,
    live_view_id: String,
    expires_at_ms: u64,
    max_fps: u8,
    max_width: u32,
    max_height: u32,
    sequence: u64,
    last_frame_at_ms: u64,
    started_at_ms: u64,
}

#[derive(Clone)]
struct AudioLease {
    lineage: CrossDeviceLineage,
    handoff_id: String,
    lease_id: String,
    epoch: u64,
    expires_at_ms: u64,
    requested_at_ms: u64,
}

struct SourceRecord {
    owner_session_binding_id: String,
    path: PathBuf,
    size_bytes: u64,
    sha256: String,
    expires_at_ms: u64,
}

struct DestinationRecord {
    owner_session_binding_id: String,
    path: PathBuf,
    kind: String,
    display_summary: String,
    expires_at_ms: u64,
}

struct InboundTransfer {
    lineage: CrossDeviceLineage,
    transfer_id: String,
    file_name: String,
    media_type: String,
    expected_size: u64,
    expected_sha256: String,
    destination_handle: String,
    final_path: PathBuf,
    partial_path: PathBuf,
    acknowledged_bytes: u64,
    completed_chunks: Vec<u32>,
    created_at_ms: u64,
    updated_at_ms: u64,
    expires_at_ms: u64,
}

struct RetainedArtifact {
    owner_session_binding_id: String,
    path: PathBuf,
    completed_at_ms: u64,
    active: bool,
}

#[derive(Clone)]
struct ProducerBridge {
    token: String,
    port: u16,
}

#[derive(Clone)]
struct NativeProducerSession {
    token: String,
    session: DesktopProducerSession,
    next_sequence: u64,
    successful_ingests: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct TrustedDesktopBinding {
    pub(crate) owner_session_binding_id: String,
    pub(crate) workspace_id: String,
    pub(crate) session_id: String,
    pub(crate) device_id: String,
}

impl TrustedDesktopBinding {
    pub(crate) fn clear_sensitive(&mut self) {
        for value in [
            &mut self.owner_session_binding_id,
            &mut self.workspace_id,
            &mut self.session_id,
            &mut self.device_id,
        ] {
            unsafe {
                value.as_bytes_mut().fill(0);
            }
            value.clear();
        }
    }
}

impl Drop for TrustedDesktopBinding {
    fn drop(&mut self) {
        self.clear_sensitive();
    }
}

#[derive(Default)]
struct CrossDeviceInner {
    live_view: Option<LiveViewLease>,
    audio_lease: Option<AudioLease>,
    sources: HashMap<String, SourceRecord>,
    destinations: HashMap<String, DestinationRecord>,
    inbound: HashMap<String, InboundTransfer>,
    retained: HashMap<String, RetainedArtifact>,
    producer: Option<NativeProducerSession>,
}

pub struct CrossDeviceState {
    inner: Mutex<CrossDeviceInner>,
    bridge: Mutex<Option<ProducerBridge>>,
}

impl Default for CrossDeviceState {
    fn default() -> Self {
        let token = std::env::var("EDITH_DESKTOP_BRIDGE_TOKEN")
            .ok()
            .filter(|value| value.len() >= 32);
        let port = std::env::var("PORT")
            .ok()
            .and_then(|value| value.parse::<u16>().ok())
            .unwrap_or(3000);
        Self {
            inner: Mutex::new(CrossDeviceInner::default()),
            bridge: Mutex::new(token.map(|token| ProducerBridge { token, port })),
        }
    }
}

impl CrossDeviceState {
    #[cfg_attr(debug_assertions, allow(dead_code))]
    pub fn configure_bridge(&self, token: String, port: u16) {
        if token.len() < 32 || port == 0 {
            return;
        }
        if let Ok(mut bridge) = self.bridge.lock() {
            *bridge = Some(ProducerBridge { token, port });
        }
    }

    pub fn clear_bridge(&self) {
        if let Ok(mut bridge) = self.bridge.lock() {
            bridge.take();
        }
        self.revoke_all("BRIDGE_CLEARED");
    }

    pub fn revoke_all(&self, _reason_code: &str) {
        if let Ok(mut inner) = self.inner.lock() {
            inner.live_view.take();
            inner.audio_lease.take();
            inner.sources.clear();
            inner.destinations.clear();
            for transfer in inner.inbound.values() {
                let _ = fs::remove_file(&transfer.partial_path);
            }
            inner.inbound.clear();
            inner.producer.take();
        }
    }

    pub(crate) fn trusted_desktop_binding(&self) -> Result<TrustedDesktopBinding, String> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "DESKTOP_PRODUCER_STATE_UNAVAILABLE".to_string())?;
        revoke_expired_locked(&mut inner, now_ms());
        let producer = inner
            .producer
            .as_ref()
            .filter(|producer| producer.successful_ingests > 0)
            .ok_or_else(|| "OBSIDIAN_NATIVE_TRUSTED_SESSION_REQUIRED".to_string())?;
        Ok(TrustedDesktopBinding {
            owner_session_binding_id: producer.session.owner_session_binding_id.clone(),
            workspace_id: producer.session.workspace_id.clone(),
            session_id: producer.session.session_id.clone(),
            device_id: producer.session.target_device_id.clone(),
        })
    }

    fn revoke_owner(&self, owner_binding: &str) -> Result<(), String> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "CROSS_DEVICE_STATE_UNAVAILABLE".to_string())?;
        if inner
            .live_view
            .as_ref()
            .is_some_and(|lease| lease.lineage.owner_session_binding_id == owner_binding)
        {
            inner.live_view.take();
        }
        if inner
            .audio_lease
            .as_ref()
            .is_some_and(|lease| lease.lineage.owner_session_binding_id == owner_binding)
        {
            inner.audio_lease.take();
        }
        inner
            .sources
            .retain(|_, record| record.owner_session_binding_id != owner_binding);
        inner
            .destinations
            .retain(|_, record| record.owner_session_binding_id != owner_binding);
        let revoked_transfers: Vec<String> = inner
            .inbound
            .iter()
            .filter(|(_, transfer)| transfer.lineage.owner_session_binding_id == owner_binding)
            .map(|(transfer_id, _)| transfer_id.clone())
            .collect();
        for transfer_id in revoked_transfers {
            if let Some(transfer) = inner.inbound.remove(&transfer_id) {
                let _ = fs::remove_file(transfer.partial_path);
            }
        }
        if inner
            .producer
            .as_ref()
            .is_some_and(|producer| producer.session.owner_session_binding_id == owner_binding)
        {
            inner.producer.take();
        }
        Ok(())
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeCapabilityStatus {
    runtime: &'static str,
    live_view: &'static str,
    native_capture_adapter: &'static str,
    pc_status: &'static str,
    pc_to_mobile_transfer: &'static str,
    mobile_to_pc_inbox: &'static str,
    wake_on_lan: &'static str,
    audio_handoff: &'static str,
    control_plane_connected: bool,
    continuous_auto_stream: bool,
    remote_control: bool,
    max_frames_per_second: u8,
    safe_message: &'static str,
}

#[tauri::command]
pub fn cross_device_native_status(state: State<'_, CrossDeviceState>) -> NativeCapabilityStatus {
    native_capability_status(&state)
}

fn native_capability_status(state: &CrossDeviceState) -> NativeCapabilityStatus {
    let connected = state
        .inner
        .lock()
        .map(|mut inner| {
            revoke_expired_locked(&mut inner, now_ms());
            inner
                .producer
                .as_ref()
                .is_some_and(|producer| producer.successful_ingests > 0)
        })
        .unwrap_or(false);
    NativeCapabilityStatus {
        runtime: if cfg!(windows) {
            "windows"
        } else {
            "unsupported"
        },
        live_view: if connected {
            "available"
        } else {
            "configuration_required"
        },
        native_capture_adapter: if cfg!(windows) {
            "compiled_unverified"
        } else {
            "unsupported"
        },
        pc_status: if cfg!(windows) {
            "runtime_verified"
        } else {
            "unsupported"
        },
        pc_to_mobile_transfer: if connected {
            "available"
        } else {
            "fixture_verified"
        },
        mobile_to_pc_inbox: if connected {
            "available"
        } else {
            "fixture_verified"
        },
        wake_on_lan: "configuration_required",
        audio_handoff: if connected {
            "available"
        } else {
            "fixture_verified"
        },
        control_plane_connected: connected,
        continuous_auto_stream: false,
        remote_control: false,
        max_frames_per_second: MAX_LIVE_VIEW_FPS,
        safe_message: if connected {
            "Trusted loopback producer session is active. Remote control remains disabled."
        } else {
            "Native adapters are installed, but the trusted producer session is not active."
        },
    }
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopProducerSession {
    owner_session_binding_id: String,
    workspace_id: String,
    session_id: String,
    source_device_id: String,
    target_device_id: String,
    expires_at: String,
}

#[derive(Deserialize)]
#[serde(tag = "operation", rename_all = "snake_case", deny_unknown_fields)]
pub enum ProducerCommandRequest {
    Bootstrap {
        device_id: String,
        csrf_token: String,
    },
    Ingest {
        kind: ProducerIngestKind,
        payload: Value,
    },
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProducerIngestKind {
    PcStatus,
    LiveViewFrameMetadata,
    WakeResult,
    Transfer,
    AudioHandoff,
    RetentionReceipt,
    Observation,
    ErrorReceipt,
    AdvancedPowerPresence,
    AdvancedDownloads,
    AdvancedBookmarks,
    AdvancedSnapshots,
    AdvancedScenes,
    AdvancedWatchers,
    AdvancedShadow,
    AdvancedRetries,
}

impl ProducerIngestKind {
    fn endpoint(self) -> &'static str {
        match self {
            Self::PcStatus => "/api/edith/mobile/desktop-producer/pc-status",
            Self::LiveViewFrameMetadata => {
                "/api/edith/mobile/desktop-producer/live-view/frame-metadata"
            }
            Self::WakeResult => "/api/edith/mobile/desktop-producer/wake-result",
            Self::Transfer => "/api/edith/mobile/desktop-producer/transfer",
            Self::AudioHandoff => "/api/edith/mobile/desktop-producer/audio-handoff",
            Self::RetentionReceipt => "/api/edith/mobile/desktop-producer/retention-receipt",
            Self::Observation => "/api/edith/mobile/desktop-producer/observation",
            Self::ErrorReceipt => "/api/edith/mobile/desktop-producer/error-receipt",
            Self::AdvancedPowerPresence => {
                "/api/edith/mobile/desktop-producer/advanced/power-presence"
            }
            Self::AdvancedDownloads => "/api/edith/mobile/desktop-producer/advanced/downloads",
            Self::AdvancedBookmarks => "/api/edith/mobile/desktop-producer/advanced/bookmarks",
            Self::AdvancedSnapshots => "/api/edith/mobile/desktop-producer/advanced/snapshots",
            Self::AdvancedScenes => "/api/edith/mobile/desktop-producer/advanced/scenes",
            Self::AdvancedWatchers => "/api/edith/mobile/desktop-producer/advanced/watchers",
            Self::AdvancedShadow => "/api/edith/mobile/desktop-producer/advanced/shadow",
            Self::AdvancedRetries => "/api/edith/mobile/desktop-producer/advanced/retries",
        }
    }

    fn advanced_native_only(self) -> bool {
        matches!(
            self,
            Self::AdvancedPowerPresence
                | Self::AdvancedDownloads
                | Self::AdvancedBookmarks
                | Self::AdvancedSnapshots
                | Self::AdvancedScenes
                | Self::AdvancedWatchers
                | Self::AdvancedShadow
                | Self::AdvancedRetries
        )
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProducerCommandResult {
    status: u16,
    body: Value,
}

fn producer_bridge(state: &CrossDeviceState) -> Result<ProducerBridge, String> {
    state
        .bridge
        .lock()
        .map_err(|_| "DESKTOP_PRODUCER_STATE_UNAVAILABLE".to_string())?
        .clone()
        .ok_or_else(|| "DESKTOP_BRIDGE_CONFIGURATION_REQUIRED".to_string())
}

fn producer_http_client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(5))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "DESKTOP_PRODUCER_HTTP_UNAVAILABLE".to_string())
}

fn owner_cookie(window: &WebviewWindow) -> Result<String, String> {
    window
        .cookies()
        .map_err(|_| "OWNER_SESSION_COOKIE_UNAVAILABLE".to_string())?
        .into_iter()
        .find(|cookie| cookie.name() == OWNER_SESSION_COOKIE)
        .map(|cookie| cookie.value().to_string())
        .filter(|value| !value.is_empty() && !value.contains(['\r', '\n', ';']))
        .ok_or_else(|| "OWNER_SESSION_REQUIRED".to_string())
}

fn safe_csrf(value: &str) -> bool {
    (20..=512).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
}

fn exact_keys(object: &Map<String, Value>, required: &[&str], optional: &[&str]) -> bool {
    required.iter().all(|key| object.contains_key(*key))
        && object
            .keys()
            .all(|key| required.contains(&key.as_str()) || optional.contains(&key.as_str()))
}

fn contains_forbidden_producer_data(value: &Value) -> bool {
    match value {
        Value::Array(values) => values.iter().any(contains_forbidden_producer_data),
        Value::Object(object) => object.iter().any(|(key, child)| {
            matches!(
                key.as_str(),
                "pixels"
                    | "pixelData"
                    | "bytesBase64"
                    | "imageDataUrl"
                    | "transport"
                    | "audio"
                    | "audioData"
                    | "audioBase64"
                    | "path"
                    | "filePath"
                    | "absolutePath"
                    | "clipboard"
                    | "clipboardText"
                    | "content"
                    | "url"
                    | "endpoint"
                    | "body"
                    | "authorization"
                    | "cookie"
                    | "csrfToken"
                    | "producerSessionToken"
                    | "apiKey"
                    | "password"
                    | "secret"
                    | "token"
            ) || contains_forbidden_producer_data(child)
        }),
        _ => false,
    }
}

fn validate_producer_payload(kind: ProducerIngestKind, payload: &Value) -> Result<(), String> {
    let encoded =
        serde_json::to_vec(payload).map_err(|_| "DESKTOP_PRODUCER_PAYLOAD_INVALID".to_string())?;
    if encoded.len() > MAX_PRODUCER_PAYLOAD_BYTES || contains_forbidden_producer_data(payload) {
        return Err("DESKTOP_PRODUCER_PRIVATE_DATA_FORBIDDEN".into());
    }
    let object = payload
        .as_object()
        .ok_or_else(|| "DESKTOP_PRODUCER_PAYLOAD_INVALID".to_string())?;
    let lineage = [
        "contractVersion",
        "amendment",
        "ownerSessionBindingId",
        "workspaceId",
        "sessionId",
        "sourceDeviceId",
        "targetDeviceId",
    ];
    let advanced_lineage = [
        "contractVersion",
        "amendment",
        "ownerSessionBindingId",
        "workspaceId",
        "revision",
        "createdAt",
        "updatedAt",
    ];
    let valid = match kind {
        ProducerIngestKind::PcStatus => exact_keys(
            object,
            &[
                &lineage[..],
                &[
                    "snapshotId",
                    "runtime",
                    "observedAt",
                    "expiresAt",
                    "metrics",
                    "source",
                ],
            ]
            .concat(),
            &[],
        ),
        ProducerIngestKind::LiveViewFrameMetadata => exact_keys(
            object,
            &[
                &lineage[..],
                &[
                    "liveViewId",
                    "frameId",
                    "sequence",
                    "observedAt",
                    "width",
                    "height",
                    "operatorState",
                    "containsPixels",
                ],
            ]
            .concat(),
            &["cursor", "click", "target"],
        ),
        ProducerIngestKind::WakeResult => exact_keys(
            object,
            &[
                &lineage[..],
                &[
                    "requestId",
                    "capability",
                    "capabilityStatus",
                    "status",
                    "attempted",
                    "runtimeReady",
                    "requestedAt",
                ],
            ]
            .concat(),
            &["completedAt", "errorCode"],
        ),
        ProducerIngestKind::Transfer => exact_keys(
            object,
            &[
                &lineage[..],
                &[
                    "transferId",
                    "direction",
                    "category",
                    "fileName",
                    "mediaType",
                    "sizeBytes",
                    "sha256",
                    "status",
                    "progress",
                    "destination",
                    "resume",
                    "capabilities",
                    "createdAt",
                    "updatedAt",
                    "expiresAt",
                ],
            ]
            .concat(),
            &["sourceComputerLabel", "candidateEvidence", "errorCode"],
        ),
        ProducerIngestKind::AudioHandoff => exact_keys(
            object,
            &[
                &lineage[..],
                &[
                    "handoffId",
                    "leaseId",
                    "epoch",
                    "sourceCaptureDeviceId",
                    "targetCaptureDeviceId",
                    "status",
                    "simultaneousCaptureAllowed",
                    "requestedAt",
                    "expiresAt",
                ],
            ]
            .concat(),
            &["quietHoursRevision", "acknowledgedAt"],
        ),
        ProducerIngestKind::RetentionReceipt => exact_keys(
            object,
            &[
                "receiptId",
                "transferId",
                "opaqueHandle",
                "status",
                "observedAt",
            ],
            &["expiresAt", "checksumSha256"],
        ),
        ProducerIngestKind::Observation => exact_keys(object, &["observation", "artifact"], &[]),
        ProducerIngestKind::ErrorReceipt => exact_keys(
            object,
            &[
                "receiptId",
                "errorCode",
                "safeMessage",
                "sourceType",
                "sourceId",
                "observedAt",
                "retryAvailable",
            ],
            &[],
        ),
        ProducerIngestKind::AdvancedPowerPresence => {
            exact_keys(
                object,
                &[
                    &advanced_lineage[..],
                    &[
                        "expiresAt",
                        "snapshotId",
                        "source",
                        "powerSource",
                        "lowPower",
                        "userPresence",
                        "cameraUsed",
                        "observedAt",
                    ],
                ]
                .concat(),
                &["batteryPercent"],
            ) && object.get("source").and_then(Value::as_str) == Some("trusted_native")
                && object.get("cameraUsed").and_then(Value::as_bool) == Some(false)
        }
        ProducerIngestKind::AdvancedDownloads => exact_keys(
            object,
            &[
                &advanced_lineage[..],
                &[
                    "downloadId",
                    "source",
                    "displayName",
                    "bytesTransferred",
                    "bytesTotal",
                    "remainingBytes",
                    "etaTrustworthy",
                    "status",
                    "observedAt",
                ],
            ]
            .concat(),
            &["expiresAt", "speedBytesPerSecond", "etaSeconds"],
        ),
        ProducerIngestKind::AdvancedBookmarks => exact_keys(
            object,
            &[
                &advanced_lineage[..],
                &[
                    "bookmarkId",
                    "capturedAt",
                    "appId",
                    "screenshotPolicy",
                    "sensitiveAppBlocked",
                ],
            ]
            .concat(),
            &[
                "expiresAt",
                "windowTitlePreview",
                "fileRef",
                "tabRef",
                "taskId",
                "userNote",
                "screenshotArtifactHandle",
            ],
        ),
        ProducerIngestKind::AdvancedSnapshots => exact_keys(
            object,
            &[
                &advanced_lineage[..],
                &[
                    "snapshotId",
                    "label",
                    "items",
                    "forbiddenStateExcluded",
                    "dangerousTransactionsExcluded",
                    "captureStatus",
                ],
            ]
            .concat(),
            &["expiresAt"],
        ),
        ProducerIngestKind::AdvancedScenes => exact_keys(
            object,
            &[
                &advanced_lineage[..],
                &[
                    "sceneId",
                    "profile",
                    "changes",
                    "securityNotificationsImmutable",
                    "status",
                ],
            ]
            .concat(),
            &["expiresAt"],
        ),
        ProducerIngestKind::AdvancedWatchers => {
            exact_keys(
                object,
                &[
                    &advanced_lineage[..],
                    &[
                        "expiresAt",
                        "watcherId",
                        "kind",
                        "sourceRef",
                        "trigger",
                        "delivery",
                        "observationPolicy",
                        "status",
                    ],
                ]
                .concat(),
                &["cancelledAt", "triggeredAt"],
            ) && object.get("observationPolicy").and_then(Value::as_str) == Some("event_based")
                && object.get("status").and_then(Value::as_str) == Some("configuration_required")
                && !object.contains_key("triggeredAt")
        }
        ProducerIngestKind::AdvancedShadow => {
            exact_keys(
                object,
                &[
                    &advanced_lineage[..],
                    &[
                        "enabled",
                        "consent",
                        "observationLevel",
                        "capturedFields",
                        "rawScreenArchive",
                        "secretCapture",
                        "suggestionOnly",
                    ],
                ]
                .concat(),
                &["expiresAt", "disabledAt"],
            ) && object.get("consent").and_then(Value::as_str) == Some("explicit")
                && object.get("observationLevel").and_then(Value::as_str) == Some("metadata_only")
                && object.get("rawScreenArchive").and_then(Value::as_bool) == Some(false)
                && object.get("secretCapture").and_then(Value::as_bool) == Some(false)
                && object.get("suggestionOnly").and_then(Value::as_bool) == Some(true)
        }
        ProducerIngestKind::AdvancedRetries => exact_keys(
            object,
            &[
                &advanced_lineage[..],
                &[
                    "retryId",
                    "taskId",
                    "failureClass",
                    "strategy",
                    "attempts",
                    "maxAttempts",
                    "staleTargetReobserve",
                    "permissionDeniedStop",
                    "status",
                ],
            ]
            .concat(),
            &["expiresAt"],
        ),
    };
    if !valid {
        return Err("DESKTOP_PRODUCER_PAYLOAD_INVALID".into());
    }
    Ok(())
}

fn safe_backend_error(response: &Value, fallback: &str) -> String {
    response
        .get("errorCode")
        .and_then(Value::as_str)
        .filter(|code| {
            (3..=80).contains(&code.len())
                && code
                    .bytes()
                    .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit() || byte == b'_')
        })
        .unwrap_or(fallback)
        .to_string()
}

fn request_producer_bootstrap(
    bridge: &ProducerBridge,
    device_id: &str,
    csrf_token: &str,
    cookie: &str,
) -> Result<(u16, Value), String> {
    let base = format!("http://127.0.0.1:{}", bridge.port);
    let response = producer_http_client()?
        .post(format!(
            "{base}/api/edith/mobile/desktop-producer/session/{device_id}"
        ))
        .bearer_auth(&bridge.token)
        .header("Origin", &base)
        .header("X-EDITH-CSRF-Token", csrf_token)
        .header("Cookie", format!("{OWNER_SESSION_COOKIE}={cookie}"))
        .header("Content-Type", "application/json")
        .body("{}")
        .send()
        .map_err(|_| "DESKTOP_PRODUCER_BACKEND_UNAVAILABLE".to_string())?;
    let status = response.status().as_u16();
    let body = response
        .json()
        .map_err(|_| "DESKTOP_PRODUCER_RESPONSE_INVALID".to_string())?;
    Ok((status, body))
}

fn bootstrap_producer(
    window: &WebviewWindow,
    state: &CrossDeviceState,
    computer: &ComputerState,
    device_id: &str,
    csrf_token: &str,
) -> Result<ProducerCommandResult, String> {
    validate_safe_id(device_id)?;
    if !safe_csrf(csrf_token) {
        return Err("CSRF_TOKEN_INVALID".into());
    }
    let now = now_ms();
    {
        let mut inner = state
            .inner
            .lock()
            .map_err(|_| "DESKTOP_PRODUCER_STATE_UNAVAILABLE".to_string())?;
        revoke_expired_locked(&mut inner, now);
        inner.producer.take();
    }

    let bridge = producer_bridge(state)?;
    let cookie = owner_cookie(window)?;
    let (status, body) = request_producer_bootstrap(&bridge, device_id, csrf_token, &cookie)?;
    if status != 201 || body.get("success") != Some(&Value::Bool(true)) {
        return Err(safe_backend_error(
            &body,
            "DESKTOP_PRODUCER_SESSION_REJECTED",
        ));
    }
    let data = body
        .get("data")
        .and_then(Value::as_object)
        .ok_or("DESKTOP_PRODUCER_RESPONSE_INVALID")?;
    let token = data
        .get("producerSessionToken")
        .and_then(Value::as_str)
        .filter(|value| value.len() >= 20)
        .ok_or("DESKTOP_PRODUCER_RESPONSE_INVALID")?
        .to_string();
    let session: DesktopProducerSession = serde_json::from_value(
        data.get("session")
            .cloned()
            .ok_or("DESKTOP_PRODUCER_RESPONSE_INVALID")?,
    )
    .map_err(|_| "DESKTOP_PRODUCER_RESPONSE_INVALID".to_string())?;
    for value in [
        &session.owner_session_binding_id,
        &session.workspace_id,
        &session.session_id,
        &session.source_device_id,
        &session.target_device_id,
    ] {
        validate_safe_id(value)?;
    }
    let expires_at_ms = parse_expiry(&session.expires_at, now, PRODUCER_SESSION_MAX_TTL_MS)?;
    if session.target_device_id != device_id || expires_at_ms <= now {
        return Err("DESKTOP_PRODUCER_SESSION_INVALID".into());
    }
    state
        .inner
        .lock()
        .map_err(|_| "DESKTOP_PRODUCER_STATE_UNAVAILABLE".to_string())?
        .producer = Some(NativeProducerSession {
        token,
        session: session.clone(),
        next_sequence: 1,
        successful_ingests: 0,
    });
    let lineage = CrossDeviceLineage {
        contract_version: CONTRACT_VERSION,
        amendment: CONTRACT_AMENDMENT.to_string(),
        owner_session_binding_id: session.owner_session_binding_id.clone(),
        workspace_id: session.workspace_id.clone(),
        session_id: session.session_id.clone(),
        source_device_id: session.source_device_id.clone(),
        target_device_id: session.target_device_id.clone(),
    };
    let initial_status = build_pc_status(state, computer, lineage).inspect_err(|_| {
        state.revoke_all("PRODUCER_INITIAL_EVIDENCE_FAILED");
    })?;
    if let Err(error) = publish_native_record(state, ProducerIngestKind::PcStatus, &initial_status)
    {
        state.revoke_all("PRODUCER_INITIAL_EVIDENCE_REJECTED");
        return Err(error);
    }
    Ok(ProducerCommandResult {
        status,
        body: json!({ "success": true, "data": { "session": session } }),
    })
}

fn ingest_producer(
    state: &CrossDeviceState,
    kind: ProducerIngestKind,
    payload: Value,
) -> Result<ProducerCommandResult, String> {
    validate_producer_payload(kind, &payload)?;
    let bridge = producer_bridge(state)?;
    let producer = {
        let mut inner = state
            .inner
            .lock()
            .map_err(|_| "DESKTOP_PRODUCER_STATE_UNAVAILABLE".to_string())?;
        revoke_expired_locked(&mut inner, now_ms());
        inner
            .producer
            .clone()
            .ok_or("DESKTOP_PRODUCER_SESSION_INVALID")?
    };
    let response = producer_http_client()?
        .post(format!(
            "http://127.0.0.1:{}{}",
            bridge.port,
            kind.endpoint()
        ))
        .bearer_auth(&bridge.token)
        .header("X-Edith-Producer-Session", &producer.token)
        .header(
            "X-Edith-Producer-Sequence",
            producer.next_sequence.to_string(),
        )
        .json(&payload)
        .send();
    let response = match response {
        Ok(response) => response,
        Err(_) => {
            state.revoke_all("PRODUCER_NETWORK_FAILURE");
            return Err("DESKTOP_PRODUCER_BACKEND_UNAVAILABLE".into());
        }
    };
    let status = response.status().as_u16();
    let body: Value = response.json().unwrap_or_else(|_| json!({}));
    if status != 202 || body.get("success") != Some(&Value::Bool(true)) {
        state.revoke_all("PRODUCER_INGEST_REJECTED");
        return Err(safe_backend_error(
            &body,
            "DESKTOP_PRODUCER_INGEST_REJECTED",
        ));
    }
    let mut inner = state
        .inner
        .lock()
        .map_err(|_| "DESKTOP_PRODUCER_STATE_UNAVAILABLE".to_string())?;
    let current = inner
        .producer
        .as_mut()
        .filter(|current| {
            current.token == producer.token && current.next_sequence == producer.next_sequence
        })
        .ok_or("DESKTOP_PRODUCER_SEQUENCE_STALE")?;
    current.next_sequence = current
        .next_sequence
        .checked_add(1)
        .ok_or("DESKTOP_PRODUCER_SEQUENCE_INVALID")?;
    current.successful_ingests = current.successful_ingests.saturating_add(1);
    Ok(ProducerCommandResult {
        status,
        body: json!({ "success": true, "data": {} }),
    })
}

pub(crate) fn publish_native_record<T: Serialize>(
    state: &CrossDeviceState,
    kind: ProducerIngestKind,
    record: &T,
) -> Result<(), String> {
    let payload =
        serde_json::to_value(record).map_err(|_| "DESKTOP_PRODUCER_PAYLOAD_INVALID".to_string())?;
    ingest_producer(state, kind, payload).map(|_| ())
}

pub(crate) fn producer_publication_ready(state: &CrossDeviceState) -> bool {
    native_capability_status(state).control_plane_connected
}

pub(crate) fn ensure_obsidian_trusted_binding(
    state: &CrossDeviceState,
    computer: &ComputerState,
) -> Result<TrustedDesktopBinding, String> {
    computer.ensure_kill_switch_inactive()?;
    if let Ok(binding) = state.trusted_desktop_binding() {
        return Ok(binding);
    }

    let bridge = producer_bridge(state)?;
    let base = format!("http://127.0.0.1:{}", bridge.port);
    let response = producer_http_client()?
        .post(format!("{base}/api/edith/obsidian/native-session"))
        .bearer_auth(&bridge.token)
        .header("Content-Type", "application/json")
        .body("{}")
        .send()
        .map_err(|_| "OBSIDIAN_NATIVE_SESSION_BACKEND_UNAVAILABLE".to_string())?;
    let status = response.status().as_u16();
    let body: Value = response
        .json()
        .map_err(|_| "OBSIDIAN_NATIVE_SESSION_RESPONSE_INVALID".to_string())?;
    if status != 201 || body.get("success") != Some(&Value::Bool(true)) {
        return Err(safe_backend_error(
            &body,
            "OBSIDIAN_NATIVE_SESSION_REJECTED",
        ));
    }
    let data = body
        .get("data")
        .and_then(Value::as_object)
        .ok_or("OBSIDIAN_NATIVE_SESSION_RESPONSE_INVALID")?;
    let token = data
        .get("producerSessionToken")
        .and_then(Value::as_str)
        .filter(|value| value.len() >= 20)
        .ok_or("OBSIDIAN_NATIVE_SESSION_RESPONSE_INVALID")?
        .to_string();
    let session: DesktopProducerSession = serde_json::from_value(
        data.get("session")
            .cloned()
            .ok_or("OBSIDIAN_NATIVE_SESSION_RESPONSE_INVALID")?,
    )
    .map_err(|_| "OBSIDIAN_NATIVE_SESSION_RESPONSE_INVALID".to_string())?;
    for value in [
        &session.owner_session_binding_id,
        &session.workspace_id,
        &session.session_id,
        &session.source_device_id,
        &session.target_device_id,
    ] {
        validate_safe_id(value)?;
    }
    let expires_at_ms = parse_expiry(&session.expires_at, now_ms(), 5 * 60_000)?;
    if session.target_device_id != "desktop-native" || expires_at_ms <= now_ms() {
        return Err("OBSIDIAN_NATIVE_SESSION_RESPONSE_INVALID".into());
    }
    state
        .inner
        .lock()
        .map_err(|_| "DESKTOP_PRODUCER_STATE_UNAVAILABLE".to_string())?
        .producer = Some(NativeProducerSession {
        token,
        session,
        next_sequence: 1,
        successful_ingests: 1,
    });
    state.trusted_desktop_binding()
}

pub(crate) fn publish_obsidian_selection<T: Serialize>(
    state: &CrossDeviceState,
    sequence: u64,
    publication: &T,
) -> Result<(), String> {
    if sequence != 1 {
        return Err("OBSIDIAN_NATIVE_SELECTION_SEQUENCE_INVALID".into());
    }
    let bridge = producer_bridge(state)?;
    let producer = {
        let mut inner = state
            .inner
            .lock()
            .map_err(|_| "DESKTOP_PRODUCER_STATE_UNAVAILABLE".to_string())?;
        revoke_expired_locked(&mut inner, now_ms());
        inner
            .producer
            .as_ref()
            .filter(|producer| producer.successful_ingests > 0)
            .cloned()
            .ok_or_else(|| "OBSIDIAN_NATIVE_TRUSTED_SESSION_REQUIRED".to_string())?
    };
    let response = producer_http_client()?
        .post(format!(
            "http://127.0.0.1:{}/api/edith/obsidian/native-selection",
            bridge.port
        ))
        .bearer_auth(&bridge.token)
        .header("X-Edith-Producer-Session", &producer.token)
        .header("X-Edith-Native-Selection-Sequence", sequence.to_string())
        .header(
            "X-Edith-Owner-Session-Binding",
            &producer.session.owner_session_binding_id,
        )
        .header("X-Edith-Device-Session", &producer.session.session_id)
        .json(publication)
        .send()
        .map_err(|_| "OBSIDIAN_NATIVE_VERIFIER_UNAVAILABLE".to_string())?;
    let status = response.status().as_u16();
    let body: Value = response.json().unwrap_or_else(|_| json!({}));
    if status != 202 || body.get("success") != Some(&Value::Bool(true)) {
        return Err(safe_backend_error(
            &body,
            "OBSIDIAN_NATIVE_SELECTION_REJECTED",
        ));
    }
    Ok(())
}

#[tauri::command]
pub fn cross_device_producer_ingest(
    window: WebviewWindow,
    state: State<'_, CrossDeviceState>,
    computer: State<'_, ComputerState>,
    request: ProducerCommandRequest,
) -> Result<ProducerCommandResult, String> {
    if window.label() != "main" {
        return Err("CROSS_DEVICE_MAIN_WINDOW_REQUIRED".into());
    }
    ensure_operational(&state, &computer)?;
    match request {
        ProducerCommandRequest::Bootstrap {
            device_id,
            csrf_token,
        } => bootstrap_producer(&window, &state, &computer, &device_id, &csrf_token),
        ProducerCommandRequest::Ingest { kind, payload } => {
            if kind.advanced_native_only() {
                return Err("ADVANCED_NATIVE_PUBLICATION_RUST_ONLY".into());
            }
            ingest_producer(&state, kind, payload)
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveViewStartRequest {
    lineage: CrossDeviceLineage,
    live_view_id: String,
    expires_at: String,
    max_frames_per_second: u8,
    max_width: u32,
    max_height: u32,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FramePolicy {
    max_frames_per_second: u8,
    max_width: u32,
    max_height: u32,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayCapabilities {
    cursor: bool,
    click: bool,
    target: bool,
    operator_state: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveViewSession {
    #[serde(flatten)]
    lineage: CrossDeviceLineage,
    live_view_id: String,
    status: &'static str,
    owner_approved: bool,
    continuous_auto_stream: bool,
    control_authority: bool,
    frame_policy: FramePolicy,
    overlay_capabilities: OverlayCapabilities,
    started_at: Option<String>,
    stopped_at: Option<String>,
    expires_at: String,
    error_code: Option<&'static str>,
}

fn session_from_lease(
    lease: &LiveViewLease,
    status: &'static str,
    stopped_at: Option<u64>,
) -> LiveViewSession {
    LiveViewSession {
        lineage: lease.lineage.clone(),
        live_view_id: lease.live_view_id.clone(),
        status,
        owner_approved: true,
        continuous_auto_stream: false,
        control_authority: false,
        frame_policy: FramePolicy {
            max_frames_per_second: lease.max_fps,
            max_width: lease.max_width,
            max_height: lease.max_height,
        },
        overlay_capabilities: OverlayCapabilities {
            cursor: true,
            click: false,
            target: false,
            operator_state: true,
        },
        started_at: Some(iso_ms(lease.started_at_ms)),
        stopped_at: stopped_at.map(iso_ms),
        expires_at: iso_ms(lease.expires_at_ms),
        error_code: None,
    }
}

#[tauri::command]
pub fn cross_device_live_view_start(
    window: Window,
    state: State<'_, CrossDeviceState>,
    computer: State<'_, ComputerState>,
    request: LiveViewStartRequest,
) -> Result<LiveViewSession, String> {
    ensure_main_window(&window)?;
    ensure_operational(&state, &computer)?;
    request.lineage.validate()?;
    validate_safe_id(&request.live_view_id)?;
    let now = now_ms();
    let expires_at_ms = parse_expiry(&request.expires_at, now, MAX_LIVE_VIEW_TTL_MS)?;
    if request.max_frames_per_second == 0
        || request.max_frames_per_second > MAX_LIVE_VIEW_FPS
        || request.max_width == 0
        || request.max_width > MAX_LIVE_VIEW_WIDTH
        || request.max_height == 0
        || request.max_height > MAX_LIVE_VIEW_HEIGHT
    {
        return Err("LIVE_VIEW_FRAME_POLICY_INVALID".into());
    }
    if !owner_approves_live_view(&window)? {
        return Err("LIVE_VIEW_OWNER_APPROVAL_REQUIRED".into());
    }
    ensure_operational(&state, &computer)?;
    let lease = LiveViewLease {
        lineage: request.lineage,
        live_view_id: request.live_view_id,
        expires_at_ms,
        max_fps: request.max_frames_per_second,
        max_width: request.max_width,
        max_height: request.max_height,
        sequence: 0,
        last_frame_at_ms: 0,
        started_at_ms: now_ms(),
    };
    let mut inner = state
        .inner
        .lock()
        .map_err(|_| "CROSS_DEVICE_STATE_UNAVAILABLE".to_string())?;
    revoke_expired_locked(&mut inner, now_ms());
    ensure_capture_slot_available(&inner)?;
    let response = session_from_lease(&lease, "streaming", None);
    inner.live_view = Some(lease);
    Ok(response)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedPoint {
    x: f64,
    y: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveViewFrameMetadata {
    #[serde(flatten)]
    lineage: CrossDeviceLineage,
    live_view_id: String,
    frame_id: String,
    sequence: u64,
    observed_at: String,
    width: u32,
    height: u32,
    cursor: Option<NormalizedPoint>,
    operator_state: &'static str,
    contains_pixels: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhysicalFrameBounds {
    x: i32,
    y: i32,
    width: i32,
    height: i32,
    coordinate_space: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameTransport {
    mime_type: &'static str,
    bytes_base64: String,
    size_bytes: usize,
    sha256: String,
    source_bounds: PhysicalFrameBounds,
    monitor_id: String,
    dpi_scale: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveViewFrameResponse {
    metadata: LiveViewFrameMetadata,
    transport: FrameTransport,
}

#[tauri::command]
pub fn cross_device_live_view_frame(
    window: Window,
    state: State<'_, CrossDeviceState>,
    computer: State<'_, ComputerState>,
    owner_session_binding_id: String,
    live_view_id: String,
) -> Result<LiveViewFrameResponse, String> {
    ensure_main_window(&window)?;
    ensure_operational(&state, &computer)?;
    let now = now_ms();
    let lease = {
        let mut inner = state
            .inner
            .lock()
            .map_err(|_| "CROSS_DEVICE_STATE_UNAVAILABLE".to_string())?;
        revoke_expired_locked(&mut inner, now);
        let lease = inner.live_view.as_mut().ok_or("LIVE_VIEW_NOT_ACTIVE")?;
        if lease.live_view_id != live_view_id {
            return Err("LIVE_VIEW_ID_MISMATCH".into());
        }
        if lease.lineage.owner_session_binding_id != owner_session_binding_id {
            return Err("LIVE_VIEW_OWNER_MISMATCH".into());
        }
        let minimum_interval = 1_000_u64.div_ceil(lease.max_fps as u64);
        if lease.last_frame_at_ms > 0
            && now.saturating_sub(lease.last_frame_at_ms) < minimum_interval
        {
            return Err("LIVE_VIEW_FRAME_RATE_LIMITED".into());
        }
        lease.sequence = lease.sequence.saturating_add(1);
        lease.last_frame_at_ms = now;
        lease.clone()
    };
    let captured = platform::capture_current_screen(lease.max_width, lease.max_height)?;
    ensure_operational(&state, &computer)?;
    let observed_at = now_ms();
    let cursor = captured.cursor.map(|(x, y)| NormalizedPoint {
        x: ((x - captured.bounds.x) as f64 / captured.bounds.width as f64).clamp(0.0, 1.0),
        y: ((y - captured.bounds.y) as f64 / captured.bounds.height as f64).clamp(0.0, 1.0),
    });
    let frame_id = format!("frame-{}-{}", lease.sequence, random_hex(8)?);
    Ok(LiveViewFrameResponse {
        metadata: LiveViewFrameMetadata {
            lineage: lease.lineage,
            live_view_id: lease.live_view_id,
            frame_id,
            sequence: lease.sequence,
            observed_at: iso_ms(observed_at),
            width: captured.width,
            height: captured.height,
            cursor,
            operator_state: "observing",
            contains_pixels: false,
        },
        transport: FrameTransport {
            mime_type: "image/png",
            size_bytes: captured.bytes.len(),
            sha256: sha256_bytes(&captured.bytes),
            bytes_base64: base64::engine::general_purpose::STANDARD.encode(captured.bytes),
            source_bounds: captured.bounds,
            monitor_id: captured.monitor_id,
            dpi_scale: captured.dpi_scale,
        },
    })
}

#[tauri::command]
pub fn cross_device_live_view_stop(
    state: State<'_, CrossDeviceState>,
    owner_session_binding_id: String,
    live_view_id: String,
) -> Result<LiveViewSession, String> {
    let mut inner = state
        .inner
        .lock()
        .map_err(|_| "CROSS_DEVICE_STATE_UNAVAILABLE".to_string())?;
    let lease = inner.live_view.take().ok_or("LIVE_VIEW_NOT_ACTIVE")?;
    if lease.lineage.owner_session_binding_id != owner_session_binding_id
        || lease.live_view_id != live_view_id
    {
        inner.live_view = Some(lease);
        return Err("LIVE_VIEW_OWNER_OR_ID_MISMATCH".into());
    }
    Ok(session_from_lease(&lease, "stopped", Some(now_ms())))
}

fn ensure_operational(state: &CrossDeviceState, computer: &ComputerState) -> Result<(), String> {
    if let Err(error) = computer.ensure_kill_switch_inactive() {
        state.revoke_all("KILL_SWITCH_ACTIVE");
        return Err(format!("KILL_SWITCH_BLOCKED: {error}"));
    }
    Ok(())
}

fn ensure_main_window(window: &Window) -> Result<(), String> {
    if window.label() != "main" {
        Err("CROSS_DEVICE_MAIN_WINDOW_REQUIRED".into())
    } else {
        Ok(())
    }
}

fn revoke_expired_locked(inner: &mut CrossDeviceInner, now: u64) {
    if inner.producer.as_ref().is_some_and(|producer| {
        DateTime::parse_from_rfc3339(&producer.session.expires_at)
            .map(|expires| expires.timestamp_millis() <= now as i64)
            .unwrap_or(true)
    }) {
        inner.producer.take();
    }
    if inner
        .live_view
        .as_ref()
        .is_some_and(|lease| lease.expires_at_ms <= now)
    {
        inner.live_view.take();
    }
    if inner
        .audio_lease
        .as_ref()
        .is_some_and(|lease| lease.expires_at_ms <= now)
    {
        inner.audio_lease.take();
    }
    inner.sources.retain(|_, record| record.expires_at_ms > now);
    inner
        .destinations
        .retain(|_, record| record.expires_at_ms > now);
    let expired_transfers: Vec<String> = inner
        .inbound
        .iter()
        .filter(|(_, transfer)| transfer.expires_at_ms <= now)
        .map(|(transfer_id, _)| transfer_id.clone())
        .collect();
    for transfer_id in expired_transfers {
        if let Some(transfer) = inner.inbound.remove(&transfer_id) {
            let _ = fs::remove_file(transfer.partial_path);
        }
    }
}

fn ensure_capture_slot_available(inner: &CrossDeviceInner) -> Result<(), String> {
    if inner.live_view.is_some() || inner.audio_lease.is_some() {
        Err("CAPTURE_LEASE_ALREADY_ACTIVE".into())
    } else {
        Ok(())
    }
}

fn validate_safe_id(value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > 200
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
    {
        return Err("CROSS_DEVICE_SAFE_ID_INVALID".into());
    }
    Ok(())
}

fn validate_file_name(value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > 180
        || value == "."
        || value == ".."
        || value.contains(['/', '\\', ':'])
        || value.chars().any(char::is_control)
    {
        return Err("TRANSFER_FILE_NAME_INVALID".into());
    }
    Ok(())
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

fn parse_expiry(value: &str, now: u64, maximum_ms: u64) -> Result<u64, String> {
    let timestamp = DateTime::parse_from_rfc3339(value)
        .map_err(|_| "CROSS_DEVICE_EXPIRY_INVALID")?
        .timestamp_millis();
    if timestamp <= now as i64 || timestamp > now.saturating_add(maximum_ms) as i64 {
        return Err("CROSS_DEVICE_EXPIRY_INVALID".into());
    }
    Ok(timestamp as u64)
}

fn random_hex(bytes: usize) -> Result<String, String> {
    let mut buffer = vec![0_u8; bytes];
    getrandom::fill(&mut buffer).map_err(|_| "OS_RANDOM_UNAVAILABLE".to_string())?;
    Ok(buffer.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn sha256_bytes(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file = File::open(path).map_err(|_| "TRANSFER_SOURCE_UNAVAILABLE")?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|_| "TRANSFER_SOURCE_READ_FAILED")?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

#[cfg(windows)]
fn owner_approves_live_view(window: &Window) -> Result<bool, String> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        MessageBoxW, IDYES, MB_DEFBUTTON2, MB_ICONWARNING, MB_SETFOREGROUND, MB_TOPMOST, MB_YESNO,
    };
    let owner = window
        .hwnd()
        .map_err(|_| "LIVE_VIEW_APPROVAL_WINDOW_UNAVAILABLE")?
        .0;
    let message: Vec<u16> = "Allow E.D.I.T.H. to share the current screen at up to 2 frames per second for this approved session?\n\nNo mouse or keyboard control is granted. Stop, logout, expiry, or Emergency Stop ends capture.\0"
        .encode_utf16()
        .collect();
    let title: Vec<u16> = "E.D.I.T.H. Live View approval\0".encode_utf16().collect();
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
fn owner_approves_live_view(_: &Window) -> Result<bool, String> {
    Err("LIVE_VIEW_NATIVE_ADAPTER_UNSUPPORTED".into())
}

struct CapturedFrame {
    bytes: Vec<u8>,
    width: u32,
    height: u32,
    bounds: PhysicalFrameBounds,
    monitor_id: String,
    dpi_scale: f64,
    cursor: Option<(i32, i32)>,
}

pub(crate) fn capture_bookmark_frame() -> Result<Vec<u8>, String> {
    platform::capture_current_screen(MAX_LIVE_VIEW_WIDTH, MAX_LIVE_VIEW_HEIGHT)
        .map(|frame| frame.bytes)
}

#[cfg(not(windows))]
mod platform {
    use super::*;

    pub fn capture_current_screen(_: u32, _: u32) -> Result<CapturedFrame, String> {
        Err("LIVE_VIEW_NATIVE_ADAPTER_UNSUPPORTED".into())
    }

    pub fn pc_metrics() -> (Option<f64>, Option<f64>, &'static str) {
        (None, None, "unknown")
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PcMetrics {
    #[serde(skip_serializing_if = "Option::is_none")]
    cpu_percent: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    gpu_percent: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    ram_percent: Option<f64>,
    network_state: &'static str,
    active_downloads: u32,
    voice_active: bool,
    computer_use_active: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PcStatusSnapshot {
    #[serde(flatten)]
    lineage: CrossDeviceLineage,
    snapshot_id: String,
    runtime: &'static str,
    observed_at: String,
    expires_at: String,
    metrics: PcMetrics,
    source: &'static str,
}

#[tauri::command]
pub fn cross_device_pc_status(
    window: Window,
    state: State<'_, CrossDeviceState>,
    computer: State<'_, ComputerState>,
    lineage: CrossDeviceLineage,
) -> Result<PcStatusSnapshot, String> {
    ensure_main_window(&window)?;
    ensure_operational(&state, &computer)?;
    lineage.validate()?;
    build_pc_status(&state, &computer, lineage)
}

fn build_pc_status(
    state: &CrossDeviceState,
    computer: &ComputerState,
    lineage: CrossDeviceLineage,
) -> Result<PcStatusSnapshot, String> {
    let now = now_ms();
    let (voice_active, active_downloads) = {
        let mut inner = state
            .inner
            .lock()
            .map_err(|_| "CROSS_DEVICE_STATE_UNAVAILABLE".to_string())?;
        revoke_expired_locked(&mut inner, now);
        (
            inner.audio_lease.is_some(),
            inner
                .inbound
                .values()
                .filter(|transfer| transfer.expires_at_ms > now)
                .count() as u32,
        )
    };
    let (cpu_percent, ram_percent, network_state) = platform::pc_metrics();
    Ok(PcStatusSnapshot {
        lineage,
        snapshot_id: format!("pc-status-{}", random_hex(8)?),
        runtime: "ready",
        observed_at: iso_ms(now),
        expires_at: iso_ms(now + 30_000),
        metrics: PcMetrics {
            cpu_percent,
            gpu_percent: None,
            ram_percent,
            network_state,
            active_downloads,
            voice_active,
            computer_use_active: computer.session_active(),
        },
        source: "native_adapter",
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WakeRequest {
    lineage: CrossDeviceLineage,
    request_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WakeReadyResult {
    #[serde(flatten)]
    lineage: CrossDeviceLineage,
    request_id: String,
    capability: &'static str,
    capability_status: &'static str,
    status: &'static str,
    attempted: bool,
    runtime_ready: bool,
    requested_at: String,
    completed_at: String,
    error_code: &'static str,
}

#[tauri::command]
pub fn cross_device_wake_request(request: WakeRequest) -> Result<WakeReadyResult, String> {
    request.lineage.validate()?;
    validate_safe_id(&request.request_id)?;
    let now = now_ms();
    Ok(WakeReadyResult {
        lineage: request.lineage,
        request_id: request.request_id,
        capability: "wake_on_lan",
        capability_status: "configuration_required",
        status: "configuration_required",
        attempted: false,
        runtime_ready: false,
        requested_at: iso_ms(now),
        completed_at: iso_ms(now),
        error_code: "WAKE_ON_LAN_CONFIGURATION_REQUIRED",
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceDescriptor {
    source_handle: String,
    file_name: String,
    size_bytes: u64,
    sha256: String,
    expires_at: String,
}

#[tauri::command]
pub fn cross_device_select_source(
    window: Window,
    state: State<'_, CrossDeviceState>,
    computer: State<'_, ComputerState>,
    owner_session_binding_id: String,
) -> Result<SourceDescriptor, String> {
    ensure_main_window(&window)?;
    ensure_operational(&state, &computer)?;
    validate_safe_id(&owner_session_binding_id)?;
    let selected = window
        .dialog()
        .file()
        .set_title("Select a file to send to the approved mobile device")
        .blocking_pick_file()
        .ok_or("TRANSFER_SOURCE_SELECTION_CANCELLED")?
        .into_path()
        .map_err(|_| "TRANSFER_SOURCE_SELECTION_INVALID")?;
    let path = selected
        .canonicalize()
        .map_err(|_| "TRANSFER_SOURCE_UNAVAILABLE")?;
    let metadata = fs::metadata(&path).map_err(|_| "TRANSFER_SOURCE_UNAVAILABLE")?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > MAX_TRANSFER_BYTES {
        return Err("TRANSFER_SOURCE_SIZE_INVALID".into());
    }
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or("TRANSFER_FILE_NAME_INVALID")?
        .to_string();
    validate_file_name(&file_name)?;
    let sha256 = sha256_file(&path)?;
    let handle = format!("source-{}", random_hex(16)?);
    let expires_at_ms = now_ms() + HANDLE_TTL_MS;
    state
        .inner
        .lock()
        .map_err(|_| "CROSS_DEVICE_STATE_UNAVAILABLE".to_string())?
        .sources
        .insert(
            handle.clone(),
            SourceRecord {
                owner_session_binding_id,
                path,
                size_bytes: metadata.len(),
                sha256: sha256.clone(),
                expires_at_ms,
            },
        );
    Ok(SourceDescriptor {
        source_handle: handle,
        file_name,
        size_bytes: metadata.len(),
        sha256,
        expires_at: iso_ms(expires_at_ms),
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DestinationCapabilities {
    open: bool,
    export: bool,
    share: bool,
    open_location: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DestinationDescriptor {
    opaque_handle: String,
    kind: &'static str,
    display_summary: &'static str,
    conflict_policy: &'static str,
    capabilities: DestinationCapabilities,
    expires_at: String,
}

#[tauri::command]
pub fn cross_device_approve_destination(
    window: Window,
    state: State<'_, CrossDeviceState>,
    computer: State<'_, ComputerState>,
    owner_session_binding_id: String,
) -> Result<DestinationDescriptor, String> {
    ensure_main_window(&window)?;
    ensure_operational(&state, &computer)?;
    validate_safe_id(&owner_session_binding_id)?;
    let selected = window
        .dialog()
        .file()
        .set_title("Approve a folder for incoming E.D.I.T.H. files")
        .blocking_pick_folder()
        .ok_or("TRANSFER_DESTINATION_SELECTION_CANCELLED")?
        .into_path()
        .map_err(|_| "TRANSFER_DESTINATION_SELECTION_INVALID")?;
    let path = selected
        .canonicalize()
        .map_err(|_| "TRANSFER_DESTINATION_UNAVAILABLE")?;
    if !path.is_dir() {
        return Err("TRANSFER_DESTINATION_UNAVAILABLE".into());
    }
    let handle = format!("destination-{}", random_hex(16)?);
    let expires_at_ms = now_ms() + HANDLE_TTL_MS;
    state
        .inner
        .lock()
        .map_err(|_| "CROSS_DEVICE_STATE_UNAVAILABLE".to_string())?
        .destinations
        .insert(
            handle.clone(),
            DestinationRecord {
                owner_session_binding_id,
                path,
                kind: "approved_folder".into(),
                display_summary: "Owner-approved folder".into(),
                expires_at_ms,
            },
        );
    Ok(DestinationDescriptor {
        opaque_handle: handle,
        kind: "approved_folder",
        display_summary: "Owner-approved folder",
        conflict_policy: "reject",
        capabilities: DestinationCapabilities {
            open: false,
            export: false,
            share: false,
            open_location: false,
        },
        expires_at: iso_ms(expires_at_ms),
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceChunk {
    source_handle: String,
    chunk_index: u32,
    offset_bytes: u64,
    chunk_bytes: usize,
    bytes_transferred: u64,
    total_bytes: u64,
    percent: f64,
    chunk_sha256: String,
    file_sha256: String,
    bytes_base64: String,
    completed: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadSourceChunkRequest {
    owner_session_binding_id: String,
    source_handle: String,
    chunk_index: u32,
    offset_bytes: u64,
    maximum_bytes: usize,
}

#[tauri::command]
pub fn cross_device_read_source_chunk(
    window: Window,
    state: State<'_, CrossDeviceState>,
    computer: State<'_, ComputerState>,
    request: ReadSourceChunkRequest,
) -> Result<SourceChunk, String> {
    ensure_main_window(&window)?;
    ensure_operational(&state, &computer)?;
    if request.maximum_bytes == 0 || request.maximum_bytes > MAX_CHUNK_BYTES {
        return Err("TRANSFER_CHUNK_SIZE_INVALID".into());
    }
    let (path, size_bytes, file_sha256) = {
        let mut inner = state
            .inner
            .lock()
            .map_err(|_| "CROSS_DEVICE_STATE_UNAVAILABLE".to_string())?;
        revoke_expired_locked(&mut inner, now_ms());
        let source = inner
            .sources
            .get(&request.source_handle)
            .ok_or("TRANSFER_SOURCE_HANDLE_INVALID")?;
        if source.owner_session_binding_id != request.owner_session_binding_id {
            return Err("TRANSFER_SOURCE_OWNER_MISMATCH".into());
        }
        (
            source.path.clone(),
            source.size_bytes,
            source.sha256.clone(),
        )
    };
    if request.offset_bytes >= size_bytes {
        return Err("TRANSFER_RESUME_OFFSET_INVALID".into());
    }
    let current_size = fs::metadata(&path)
        .map_err(|_| "TRANSFER_SOURCE_UNAVAILABLE")?
        .len();
    if current_size != size_bytes {
        return Err("TRANSFER_SOURCE_CHANGED".into());
    }
    if sha256_file(&path)? != file_sha256 {
        return Err("TRANSFER_SOURCE_CHANGED".into());
    }
    let mut file = File::open(path).map_err(|_| "TRANSFER_SOURCE_UNAVAILABLE")?;
    file.seek(SeekFrom::Start(request.offset_bytes))
        .map_err(|_| "TRANSFER_SOURCE_READ_FAILED")?;
    let bounded = request
        .maximum_bytes
        .min(size_bytes.saturating_sub(request.offset_bytes) as usize);
    let mut bytes = vec![0_u8; bounded];
    file.read_exact(&mut bytes)
        .map_err(|_| "TRANSFER_SOURCE_READ_FAILED")?;
    let bytes_transferred = request.offset_bytes + bytes.len() as u64;
    Ok(SourceChunk {
        source_handle: request.source_handle,
        chunk_index: request.chunk_index,
        offset_bytes: request.offset_bytes,
        chunk_bytes: bytes.len(),
        bytes_transferred,
        total_bytes: size_bytes,
        percent: progress_percent(bytes_transferred, size_bytes),
        chunk_sha256: sha256_bytes(&bytes),
        file_sha256,
        bytes_base64: base64::engine::general_purpose::STANDARD.encode(bytes),
        completed: bytes_transferred == size_bytes,
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BeginInboxTransferRequest {
    lineage: CrossDeviceLineage,
    transfer_id: String,
    destination_handle: String,
    file_name: String,
    media_type: String,
    size_bytes: u64,
    sha256: String,
    expires_at: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferProgress {
    bytes_transferred: u64,
    total_bytes: u64,
    percent: f64,
    integrity: &'static str,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferDestination {
    kind: String,
    opaque_handle: String,
    display_summary: String,
    conflict_policy: &'static str,
    collision_detected: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferResume {
    contract_version: u8,
    amendment: &'static str,
    resumable: bool,
    next_chunk_index: u32,
    completed_chunk_indexes: Vec<u32>,
    retry_count: u8,
    max_retries: u8,
    last_attempt_at: String,
    acknowledged_bytes: u64,
    resume_checkpoint_id: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferCapabilities {
    open: bool,
    export: bool,
    share: bool,
    open_location: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CrossDeviceTransferSnapshot {
    #[serde(flatten)]
    lineage: CrossDeviceLineage,
    transfer_id: String,
    direction: &'static str,
    category: &'static str,
    file_name: String,
    media_type: String,
    size_bytes: u64,
    sha256: String,
    status: &'static str,
    progress: TransferProgress,
    destination: TransferDestination,
    resume: TransferResume,
    capabilities: TransferCapabilities,
    created_at: String,
    updated_at: String,
    expires_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    error_code: Option<&'static str>,
}

fn transfer_snapshot(
    transfer: &InboundTransfer,
    destination: &DestinationRecord,
    status: &'static str,
    integrity: &'static str,
) -> CrossDeviceTransferSnapshot {
    CrossDeviceTransferSnapshot {
        lineage: transfer.lineage.clone(),
        transfer_id: transfer.transfer_id.clone(),
        direction: "mobile_to_pc",
        category: category_for(&transfer.file_name),
        file_name: transfer.file_name.clone(),
        media_type: transfer.media_type.clone(),
        size_bytes: transfer.expected_size,
        sha256: transfer.expected_sha256.clone(),
        status,
        progress: TransferProgress {
            bytes_transferred: transfer.acknowledged_bytes,
            total_bytes: transfer.expected_size,
            percent: progress_percent(transfer.acknowledged_bytes, transfer.expected_size),
            integrity,
        },
        destination: TransferDestination {
            kind: destination.kind.clone(),
            opaque_handle: transfer.destination_handle.clone(),
            display_summary: destination.display_summary.clone(),
            conflict_policy: "reject",
            collision_detected: false,
        },
        resume: TransferResume {
            contract_version: CONTRACT_VERSION,
            amendment: CONTRACT_AMENDMENT,
            resumable: status != "completed",
            next_chunk_index: transfer.completed_chunks.len() as u32,
            completed_chunk_indexes: transfer.completed_chunks.clone(),
            retry_count: 0,
            max_retries: 2,
            last_attempt_at: iso_ms(transfer.updated_at_ms),
            acknowledged_bytes: transfer.acknowledged_bytes,
            resume_checkpoint_id: format!("checkpoint-{}", transfer.transfer_id),
        },
        capabilities: TransferCapabilities {
            open: false,
            export: false,
            share: false,
            open_location: false,
        },
        created_at: iso_ms(transfer.created_at_ms),
        updated_at: iso_ms(transfer.updated_at_ms),
        expires_at: iso_ms(transfer.expires_at_ms),
        error_code: None,
    }
}

#[tauri::command]
pub fn cross_device_begin_inbox_transfer(
    window: Window,
    state: State<'_, CrossDeviceState>,
    computer: State<'_, ComputerState>,
    request: BeginInboxTransferRequest,
) -> Result<CrossDeviceTransferSnapshot, String> {
    ensure_main_window(&window)?;
    ensure_operational(&state, &computer)?;
    request.lineage.validate()?;
    validate_safe_id(&request.transfer_id)?;
    validate_safe_id(&request.destination_handle)?;
    validate_media_type(&request.media_type)?;
    validate_file_name(&request.file_name)?;
    if request.size_bytes == 0
        || request.size_bytes > MAX_TRANSFER_BYTES
        || !is_sha256(&request.sha256)
    {
        return Err("TRANSFER_DESCRIPTOR_INVALID".into());
    }
    let expires_at_ms = parse_expiry(&request.expires_at, now_ms(), 24 * 60 * 60_000)?;
    let mut inner = state
        .inner
        .lock()
        .map_err(|_| "CROSS_DEVICE_STATE_UNAVAILABLE".to_string())?;
    revoke_expired_locked(&mut inner, now_ms());
    if inner.inbound.contains_key(&request.transfer_id) {
        return Err("TRANSFER_ID_ALREADY_EXISTS".into());
    }
    let destination = inner
        .destinations
        .get(&request.destination_handle)
        .ok_or("TRANSFER_DESTINATION_HANDLE_INVALID")?;
    if destination.owner_session_binding_id != request.lineage.owner_session_binding_id {
        return Err("TRANSFER_DESTINATION_OWNER_MISMATCH".into());
    }
    if expires_at_ms > destination.expires_at_ms {
        return Err("TRANSFER_DESTINATION_EXPIRES_TOO_SOON".into());
    }
    let final_path = destination.path.join(&request.file_name);
    if final_path.exists() {
        return Err("TRANSFER_DESTINATION_COLLISION".into());
    }
    let partial_path = destination
        .path
        .join(format!(".edith-{}.part", random_hex(12)?));
    let now = now_ms();
    let transfer = InboundTransfer {
        lineage: request.lineage,
        transfer_id: request.transfer_id.clone(),
        file_name: request.file_name,
        media_type: request.media_type,
        expected_size: request.size_bytes,
        expected_sha256: request.sha256.to_ascii_lowercase(),
        destination_handle: request.destination_handle.clone(),
        final_path,
        partial_path,
        acknowledged_bytes: 0,
        completed_chunks: Vec::new(),
        created_at_ms: now,
        updated_at_ms: now,
        expires_at_ms,
    };
    let snapshot = transfer_snapshot(&transfer, destination, "pending", "pending");
    inner.inbound.insert(request.transfer_id, transfer);
    Ok(snapshot)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InboxChunkRequest {
    owner_session_binding_id: String,
    transfer_id: String,
    chunk_index: u32,
    offset_bytes: u64,
    chunk_sha256: String,
    bytes_base64: String,
}

#[tauri::command]
pub fn cross_device_write_inbox_chunk(
    window: Window,
    state: State<'_, CrossDeviceState>,
    computer: State<'_, ComputerState>,
    request: InboxChunkRequest,
) -> Result<CrossDeviceTransferSnapshot, String> {
    ensure_main_window(&window)?;
    ensure_operational(&state, &computer)?;
    if !is_sha256(&request.chunk_sha256) {
        return Err("TRANSFER_CHUNK_CHECKSUM_INVALID".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(request.bytes_base64.as_bytes())
        .map_err(|_| "TRANSFER_CHUNK_ENCODING_INVALID")?;
    if bytes.is_empty()
        || bytes.len() > MAX_CHUNK_BYTES
        || sha256_bytes(&bytes) != request.chunk_sha256.to_ascii_lowercase()
    {
        return Err("TRANSFER_CHUNK_CHECKSUM_INVALID".into());
    }
    let mut inner = state
        .inner
        .lock()
        .map_err(|_| "CROSS_DEVICE_STATE_UNAVAILABLE".to_string())?;
    revoke_expired_locked(&mut inner, now_ms());
    write_inbox_chunk_locked(&mut inner, &request, &bytes)
}

fn write_inbox_chunk_locked(
    inner: &mut CrossDeviceInner,
    request: &InboxChunkRequest,
    bytes: &[u8],
) -> Result<CrossDeviceTransferSnapshot, String> {
    let destination_handle = {
        let transfer = inner
            .inbound
            .get(&request.transfer_id)
            .ok_or("TRANSFER_NOT_FOUND")?;
        transfer.destination_handle.clone()
    };
    let destination = inner
        .destinations
        .get(&destination_handle)
        .ok_or("TRANSFER_DESTINATION_HANDLE_INVALID")?;
    let destination_view = DestinationRecord {
        owner_session_binding_id: destination.owner_session_binding_id.clone(),
        path: destination.path.clone(),
        kind: destination.kind.clone(),
        display_summary: destination.display_summary.clone(),
        expires_at_ms: destination.expires_at_ms,
    };
    let transfer = inner
        .inbound
        .get_mut(&request.transfer_id)
        .ok_or("TRANSFER_NOT_FOUND")?;
    if transfer.lineage.owner_session_binding_id != request.owner_session_binding_id {
        return Err("TRANSFER_OWNER_MISMATCH".into());
    }
    if request.offset_bytes != transfer.acknowledged_bytes
        || request.chunk_index != transfer.completed_chunks.len() as u32
        || request.offset_bytes.saturating_add(bytes.len() as u64) > transfer.expected_size
    {
        return Err("TRANSFER_RESUME_OFFSET_INVALID".into());
    }
    let mut file = OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .read(true)
        .open(&transfer.partial_path)
        .map_err(|_| "TRANSFER_INBOX_WRITE_FAILED")?;
    file.seek(SeekFrom::Start(request.offset_bytes))
        .map_err(|_| "TRANSFER_INBOX_WRITE_FAILED")?;
    file.write_all(bytes)
        .and_then(|_| file.sync_data())
        .map_err(|_| "TRANSFER_INBOX_WRITE_FAILED")?;
    transfer.acknowledged_bytes += bytes.len() as u64;
    transfer.completed_chunks.push(request.chunk_index);
    transfer.updated_at_ms = now_ms();
    if transfer.acknowledged_bytes < transfer.expected_size {
        return Ok(transfer_snapshot(
            transfer,
            &destination_view,
            "transferring",
            "pending",
        ));
    }
    if sha256_file(&transfer.partial_path)? != transfer.expected_sha256 {
        let _ = fs::remove_file(&transfer.partial_path);
        transfer.expires_at_ms = 0;
        return Err("TRANSFER_INTEGRITY_FAILED".into());
    }
    if transfer.final_path.exists() {
        let _ = fs::remove_file(&transfer.partial_path);
        transfer.expires_at_ms = 0;
        return Err("TRANSFER_DESTINATION_COLLISION".into());
    }
    let mut source =
        File::open(&transfer.partial_path).map_err(|_| "TRANSFER_INBOX_FINALIZE_FAILED")?;
    let mut final_file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&transfer.final_path)
        .map_err(|_| "TRANSFER_DESTINATION_COLLISION")?;
    if std::io::copy(&mut source, &mut final_file).is_err() || final_file.sync_all().is_err() {
        let _ = fs::remove_file(&transfer.final_path);
        return Err("TRANSFER_INBOX_FINALIZE_FAILED".into());
    }
    let _ = fs::remove_file(&transfer.partial_path);
    let completed_at = now_ms();
    let artifact_handle = format!("artifact-{}", random_hex(16)?);
    let retained = RetainedArtifact {
        owner_session_binding_id: transfer.lineage.owner_session_binding_id.clone(),
        path: transfer.final_path.clone(),
        completed_at_ms: completed_at,
        active: false,
    };
    transfer.updated_at_ms = completed_at;
    let snapshot = transfer_snapshot(transfer, &destination_view, "completed", "verified");
    inner.retained.insert(artifact_handle, retained);
    inner.inbound.remove(&request.transfer_id);
    Ok(snapshot)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupResult {
    removed_artifacts: usize,
    preserved_active_or_pending: usize,
    retention_milliseconds: u64,
}

#[tauri::command]
pub fn cross_device_cleanup_inbox(
    window: Window,
    state: State<'_, CrossDeviceState>,
    computer: State<'_, ComputerState>,
    owner_session_binding_id: String,
) -> Result<CleanupResult, String> {
    ensure_main_window(&window)?;
    ensure_operational(&state, &computer)?;
    validate_safe_id(&owner_session_binding_id)?;
    let now = now_ms();
    let mut inner = state
        .inner
        .lock()
        .map_err(|_| "CROSS_DEVICE_STATE_UNAVAILABLE".to_string())?;
    Ok(cleanup_inbox_locked(
        &mut inner,
        &owner_session_binding_id,
        now,
    ))
}

fn cleanup_inbox_locked(
    inner: &mut CrossDeviceInner,
    owner_session_binding_id: &str,
    now: u64,
) -> CleanupResult {
    let pending = inner
        .inbound
        .values()
        .filter(|transfer| transfer.lineage.owner_session_binding_id == owner_session_binding_id)
        .count();
    let candidates: Vec<String> = inner
        .retained
        .iter()
        .filter(|(_, artifact)| {
            artifact.owner_session_binding_id == owner_session_binding_id
                && !artifact.active
                && now.saturating_sub(artifact.completed_at_ms) >= RETENTION_MS
        })
        .map(|(handle, _)| handle.clone())
        .collect();
    let mut removed = 0;
    for handle in candidates {
        if let Some(artifact) = inner.retained.get(&handle) {
            if fs::remove_file(&artifact.path).is_ok() || !artifact.path.exists() {
                inner.retained.remove(&handle);
                removed += 1;
            }
        }
    }
    let active = inner
        .retained
        .values()
        .filter(|artifact| {
            artifact.owner_session_binding_id == owner_session_binding_id && artifact.active
        })
        .count();
    CleanupResult {
        removed_artifacts: removed,
        preserved_active_or_pending: pending + active,
        retention_milliseconds: RETENTION_MS,
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioLeaseRequest {
    lineage: CrossDeviceLineage,
    handoff_id: String,
    lease_id: String,
    epoch: u64,
    expires_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioLeaseView {
    #[serde(flatten)]
    lineage: CrossDeviceLineage,
    handoff_id: String,
    lease_id: String,
    epoch: u64,
    source_capture_device_id: String,
    target_capture_device_id: String,
    status: &'static str,
    simultaneous_capture_allowed: bool,
    requested_at: String,
    acknowledged_at: Option<String>,
    expires_at: String,
}

fn audio_view(lease: &AudioLease, status: &'static str) -> AudioLeaseView {
    AudioLeaseView {
        lineage: lease.lineage.clone(),
        handoff_id: lease.handoff_id.clone(),
        lease_id: lease.lease_id.clone(),
        epoch: lease.epoch,
        source_capture_device_id: lease.lineage.source_device_id.clone(),
        target_capture_device_id: lease.lineage.target_device_id.clone(),
        status,
        simultaneous_capture_allowed: false,
        requested_at: iso_ms(lease.requested_at_ms),
        acknowledged_at: Some(iso_ms(lease.requested_at_ms)),
        expires_at: iso_ms(lease.expires_at_ms),
    }
}

#[tauri::command]
pub fn cross_device_audio_lease_start(
    window: Window,
    state: State<'_, CrossDeviceState>,
    computer: State<'_, ComputerState>,
    request: AudioLeaseRequest,
) -> Result<AudioLeaseView, String> {
    ensure_main_window(&window)?;
    ensure_operational(&state, &computer)?;
    request.lineage.validate()?;
    validate_safe_id(&request.handoff_id)?;
    validate_safe_id(&request.lease_id)?;
    if request.epoch == 0 {
        return Err("AUDIO_LEASE_EPOCH_INVALID".into());
    }
    let now = now_ms();
    let expires_at_ms = parse_expiry(&request.expires_at, now, 30 * 60_000)?;
    let lease = AudioLease {
        lineage: request.lineage,
        handoff_id: request.handoff_id,
        lease_id: request.lease_id,
        epoch: request.epoch,
        expires_at_ms,
        requested_at_ms: now,
    };
    let mut inner = state
        .inner
        .lock()
        .map_err(|_| "CROSS_DEVICE_STATE_UNAVAILABLE".to_string())?;
    revoke_expired_locked(&mut inner, now);
    ensure_capture_slot_available(&inner)?;
    let view = audio_view(&lease, "active");
    inner.audio_lease = Some(lease);
    Ok(view)
}

#[tauri::command]
pub fn cross_device_audio_lease_release(
    window: Window,
    state: State<'_, CrossDeviceState>,
    owner_session_binding_id: String,
    lease_id: String,
    epoch: u64,
) -> Result<AudioLeaseView, String> {
    ensure_main_window(&window)?;
    let mut inner = state
        .inner
        .lock()
        .map_err(|_| "CROSS_DEVICE_STATE_UNAVAILABLE".to_string())?;
    let lease = inner.audio_lease.take().ok_or("AUDIO_LEASE_NOT_ACTIVE")?;
    if lease.lineage.owner_session_binding_id != owner_session_binding_id
        || lease.lease_id != lease_id
        || lease.epoch != epoch
    {
        inner.audio_lease = Some(lease);
        return Err("AUDIO_LEASE_BINDING_MISMATCH".into());
    }
    Ok(audio_view(&lease, "released"))
}

#[tauri::command]
pub fn cross_device_revoke_owner(
    window: Window,
    state: State<'_, CrossDeviceState>,
    advanced: State<'_, crate::advanced::AdvancedNativeState>,
    obsidian_picker: State<'_, crate::obsidian_picker::ObsidianVaultPickerState>,
    owner_session_binding_id: String,
    reason_code: String,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("OWNER_REVOCATION_MAIN_WINDOW_REQUIRED".into());
    }
    validate_safe_id(&owner_session_binding_id)?;
    if !matches!(
        reason_code.as_str(),
        "LOGOUT" | "OWNER_SESSION_EXPIRED" | "OWNER_SESSION_ROTATED"
    ) {
        return Err("OWNER_REVOCATION_REASON_INVALID".into());
    }
    state.revoke_owner(&owner_session_binding_id)?;
    advanced.revoke_owner(&owner_session_binding_id);
    obsidian_picker.revoke_owner(&owner_session_binding_id);
    Ok(())
}

fn progress_percent(done: u64, total: u64) -> f64 {
    if total == 0 {
        0.0
    } else {
        ((done as f64 / total as f64) * 10_000.0).round() / 100.0
    }
}

fn is_sha256(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn validate_media_type(value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > 100
        || !value.contains('/')
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'/' | b'+' | b'-' | b'.'))
    {
        return Err("TRANSFER_MEDIA_TYPE_INVALID".into());
    }
    Ok(())
}

fn category_for(file_name: &str) -> &'static str {
    let extension = Path::new(file_name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    match extension.as_str() {
        "pdf" => "pdf",
        "png" | "jpg" | "jpeg" | "webp" => "image",
        "doc" | "docx" | "txt" | "md" | "rtf" => "document",
        _ => "other",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;
    use std::sync::mpsc;

    fn lineage(owner: &str) -> CrossDeviceLineage {
        CrossDeviceLineage {
            contract_version: 2,
            amendment: "2.1".into(),
            owner_session_binding_id: owner.into(),
            workspace_id: "workspace-test".into(),
            session_id: "session-test".into(),
            source_device_id: "desktop-test".into(),
            target_device_id: "mobile-test".into(),
        }
    }

    fn temp_dir(label: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "edith-cross-device-{label}-{}",
            random_hex(8).expect("random")
        ));
        fs::create_dir_all(&path).expect("temp directory");
        path
    }

    fn live_lease(owner: &str, expires_at_ms: u64) -> LiveViewLease {
        LiveViewLease {
            lineage: lineage(owner),
            live_view_id: "live-view-test".into(),
            expires_at_ms,
            max_fps: 2,
            max_width: 1280,
            max_height: 720,
            sequence: 0,
            last_frame_at_ms: 0,
            started_at_ms: now_ms(),
        }
    }

    fn producer_session() -> NativeProducerSession {
        NativeProducerSession {
            token: "producer-session-token-kept-native".into(),
            session: DesktopProducerSession {
                owner_session_binding_id: "owner-test".into(),
                workspace_id: "workspace-test".into(),
                session_id: "session-test".into(),
                source_device_id: "desktop-test".into(),
                target_device_id: "mobile-test".into(),
                expires_at: iso_ms(now_ms() + 60_000),
            },
            next_sequence: 1,
            successful_ingests: 0,
        }
    }

    fn producer_state(port: u16) -> CrossDeviceState {
        CrossDeviceState {
            inner: Mutex::new(CrossDeviceInner {
                producer: Some(producer_session()),
                ..CrossDeviceInner::default()
            }),
            bridge: Mutex::new(Some(ProducerBridge {
                token: "bridge-token-kept-native-and-never-returned".into(),
                port,
            })),
        }
    }

    fn pc_status_payload() -> Value {
        json!({
            "contractVersion": 2,
            "amendment": "2.1",
            "ownerSessionBindingId": "owner-test",
            "workspaceId": "workspace-test",
            "sessionId": "session-test",
            "sourceDeviceId": "desktop-test",
            "targetDeviceId": "mobile-test",
            "snapshotId": "snapshot-test",
            "runtime": "ready",
            "observedAt": iso_ms(now_ms()),
            "expiresAt": iso_ms(now_ms() + 30_000),
            "metrics": { "networkState": "unknown" },
            "source": "native_adapter"
        })
    }

    fn advanced_lineage() -> Value {
        json!({
            "contractVersion": 2,
            "amendment": "2.1",
            "ownerSessionBindingId": "owner-test",
            "workspaceId": "workspace-test",
            "revision": 1,
            "createdAt": iso_ms(now_ms()),
            "updatedAt": iso_ms(now_ms())
        })
    }

    fn advanced_payloads() -> Vec<(ProducerIngestKind, &'static str, Value)> {
        let base = advanced_lineage();
        let extend = |fields: Value| {
            let mut value = base.clone();
            value
                .as_object_mut()
                .expect("advanced lineage")
                .extend(fields.as_object().expect("advanced fields").clone());
            value
        };
        vec![
            (
                ProducerIngestKind::AdvancedPowerPresence,
                "/api/edith/mobile/desktop-producer/advanced/power-presence",
                extend(json!({
                    "expiresAt": iso_ms(now_ms() + 60_000),
                    "snapshotId": "power-test",
                    "source": "trusted_native",
                    "powerSource": "ac",
                    "batteryPercent": 90,
                    "lowPower": false,
                    "userPresence": "active",
                    "cameraUsed": false,
                    "observedAt": iso_ms(now_ms())
                })),
            ),
            (
                ProducerIngestKind::AdvancedDownloads,
                "/api/edith/mobile/desktop-producer/advanced/downloads",
                extend(json!({
                    "downloadId": "download-test",
                    "source": "supported_app",
                    "displayName": "fixture.bin",
                    "bytesTransferred": 25,
                    "bytesTotal": 100,
                    "remainingBytes": 75,
                    "etaTrustworthy": false,
                    "status": "downloading",
                    "observedAt": iso_ms(now_ms())
                })),
            ),
            (
                ProducerIngestKind::AdvancedBookmarks,
                "/api/edith/mobile/desktop-producer/advanced/bookmarks",
                extend(json!({
                    "bookmarkId": "bookmark-test",
                    "capturedAt": iso_ms(now_ms()),
                    "appId": "app-test",
                    "screenshotPolicy": "metadata_only",
                    "sensitiveAppBlocked": false
                })),
            ),
            (
                ProducerIngestKind::AdvancedSnapshots,
                "/api/edith/mobile/desktop-producer/advanced/snapshots",
                extend(json!({
                    "snapshotId": "snapshot-test",
                    "label": "Safe workspace",
                    "items": [{ "kind": "task", "refId": "task-test", "displayLabel": "Task" }],
                    "forbiddenStateExcluded": true,
                    "dangerousTransactionsExcluded": true,
                    "captureStatus": "metadata_only"
                })),
            ),
            (
                ProducerIngestKind::AdvancedScenes,
                "/api/edith/mobile/desktop-producer/advanced/scenes",
                extend(json!({
                    "sceneId": "scene-test",
                    "profile": "FOCUS",
                    "changes": [{ "setting": "capsule", "from": "default", "to": "focus", "reversible": true }],
                    "securityNotificationsImmutable": true,
                    "status": "active"
                })),
            ),
            (
                ProducerIngestKind::AdvancedWatchers,
                "/api/edith/mobile/desktop-producer/advanced/watchers",
                extend(json!({
                    "expiresAt": iso_ms(now_ms() + 60_000),
                    "watcherId": "watcher-test",
                    "kind": "file",
                    "sourceRef": "note-test",
                    "trigger": "changed",
                    "delivery": "desktop",
                    "observationPolicy": "event_based",
                    "status": "configuration_required"
                })),
            ),
            (
                ProducerIngestKind::AdvancedShadow,
                "/api/edith/mobile/desktop-producer/advanced/shadow",
                extend(json!({
                    "enabled": true,
                    "consent": "explicit",
                    "observationLevel": "metadata_only",
                    "capturedFields": ["app_identity", "timestamps"],
                    "rawScreenArchive": false,
                    "secretCapture": false,
                    "suggestionOnly": true
                })),
            ),
            (
                ProducerIngestKind::AdvancedRetries,
                "/api/edith/mobile/desktop-producer/advanced/retries",
                extend(json!({
                    "retryId": "retry-test",
                    "taskId": "task-test",
                    "failureClass": "stale_target",
                    "strategy": "reobserve",
                    "attempts": 1,
                    "maxAttempts": 2,
                    "staleTargetReobserve": true,
                    "permissionDeniedStop": false,
                    "status": "retrying"
                })),
            ),
        ]
    }

    fn test_server(statuses: Vec<u16>) -> (u16, mpsc::Receiver<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("test listener");
        let port = listener.local_addr().expect("test address").port();
        let (sender, receiver) = mpsc::channel();
        std::thread::spawn(move || {
            for status in statuses {
                let (mut stream, _) = listener.accept().expect("test connection");
                let mut bytes = [0_u8; 16 * 1024];
                let read = stream.read(&mut bytes).expect("test request");
                let _ = sender.send(String::from_utf8_lossy(&bytes[..read]).to_string());
                let reason = if status == 202 { "Accepted" } else { "OK" };
                let body = if status == 202 {
                    r#"{"success":true,"data":{}}"#
                } else {
                    r#"{"success":false,"errorCode":"DESKTOP_PRODUCER_SEQUENCE_INVALID"}"#
                };
                write!(
                    stream,
                    "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                )
                .expect("test response");
            }
        });
        (port, receiver)
    }

    fn bootstrap_test_server(expected_token: &'static str) -> (u16, mpsc::Receiver<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bootstrap test listener");
        let port = listener
            .local_addr()
            .expect("bootstrap test address")
            .port();
        let (sender, receiver) = mpsc::channel();
        std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("bootstrap test connection");
            let mut bytes = [0_u8; 16 * 1024];
            let read = stream.read(&mut bytes).expect("bootstrap test request");
            let request = String::from_utf8_lossy(&bytes[..read]).to_string();
            let expected = format!("authorization: Bearer {expected_token}");
            let authorized = request
                .lines()
                .any(|line| line.trim_end_matches('\r') == expected);
            let _ = sender.send(request);
            let (status, reason, body) = if authorized {
                (
                    201,
                    "Created",
                    format!(
                        "{{\"success\":true,\"data\":{{\"producerSessionToken\":\"{}\",\"session\":{{}}}}}}",
                        "native-session-secret"
                    ),
                )
            } else {
                (
                    403,
                    "Forbidden",
                    r#"{"success":false,"errorCode":"DESKTOP_PRODUCER_UNAUTHORIZED"}"#.to_string(),
                )
            };
            write!(
                stream,
                "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            )
            .expect("bootstrap test response");
        });
        (port, receiver)
    }

    #[test]
    fn capability_truth_does_not_enable_end_to_end_or_control() {
        let state = CrossDeviceState::default();
        let json = serde_json::to_value(native_capability_status(&state)).expect("status json");
        assert_eq!(json["liveView"], "configuration_required");
        assert_eq!(json["controlPlaneConnected"], false);
        assert_eq!(json["continuousAutoStream"], false);
        assert_eq!(json["remoteControl"], false);
        assert_eq!(json["maxFramesPerSecond"], 2);
    }

    #[test]
    fn producer_request_rejects_webview_secrets_urls_and_bodies() {
        let request = json!({
            "operation": "ingest",
            "kind": "pc_status",
            "payload": pc_status_payload(),
            "endpoint": "http://attacker.invalid/collect",
            "producerSessionToken": "must-not-enter-webview",
            "sequence": 1
        });
        assert!(serde_json::from_value::<ProducerCommandRequest>(request).is_err());
        let mut payload = pc_status_payload();
        payload["body"] = json!({ "arbitrary": true });
        assert_eq!(
            validate_producer_payload(ProducerIngestKind::PcStatus, &payload),
            Err("DESKTOP_PRODUCER_PRIVATE_DATA_FORBIDDEN".into())
        );
    }

    #[test]
    fn producer_payload_accepts_only_canonical_metadata_without_private_data() {
        assert!(
            validate_producer_payload(ProducerIngestKind::PcStatus, &pc_status_payload()).is_ok()
        );
        for forbidden in ["bytesBase64", "audioBase64", "clipboardText", "filePath"] {
            let mut payload = pc_status_payload();
            payload[forbidden] = Value::String("private".into());
            assert!(validate_producer_payload(ProducerIngestKind::PcStatus, &payload).is_err());
        }
    }

    #[test]
    fn advanced_native_kinds_use_fixed_routes_and_only_become_ready_after_202() {
        let payloads = advanced_payloads();
        let (port, requests) = test_server(vec![202; payloads.len()]);
        let state = producer_state(port);
        assert!(!producer_publication_ready(&state));

        for (index, (kind, endpoint, payload)) in payloads.into_iter().enumerate() {
            validate_producer_payload(kind, &payload).expect("canonical advanced payload");
            publish_native_record(&state, kind, &payload).expect("accepted advanced publication");
            let request = requests.recv().expect("advanced request");
            let first_line = request.lines().next().unwrap_or_default();
            assert!(
                first_line.contains(endpoint),
                "wrong endpoint for item {index}"
            );
            assert!(!request.contains("producerSessionToken"));
            assert!(!request.contains("bytesBase64"));
            assert!(!request.contains("filePath"));
        }

        assert!(producer_publication_ready(&state));
        let producer = state
            .inner
            .lock()
            .expect("state")
            .producer
            .clone()
            .expect("producer");
        assert_eq!(producer.next_sequence, 9);
        assert_eq!(producer.successful_ingests, 8);
    }

    #[test]
    fn advanced_native_payloads_reject_unknown_private_and_transport_fields() {
        for (kind, _, payload) in advanced_payloads() {
            for forbidden in [
                "apiKey",
                "pixels",
                "audio",
                "clipboard",
                "path",
                "authorization",
            ] {
                let mut unsafe_payload = payload.clone();
                unsafe_payload[forbidden] = Value::String("private".into());
                assert!(validate_producer_payload(kind, &unsafe_payload).is_err());
            }
            let mut unknown = payload;
            unknown["unexpected"] = Value::Bool(true);
            assert_eq!(
                validate_producer_payload(kind, &unknown),
                Err("DESKTOP_PRODUCER_PAYLOAD_INVALID".into())
            );
        }
    }

    #[test]
    fn advanced_native_kinds_are_not_available_to_generic_webview_ingest() {
        for (kind, _, _) in advanced_payloads() {
            assert!(kind.advanced_native_only());
        }
        assert!(!ProducerIngestKind::PcStatus.advanced_native_only());
    }

    #[test]
    fn producer_sequence_advances_only_after_backend_202() {
        let (port, requests) = test_server(vec![202, 202]);
        let state = producer_state(port);
        assert_eq!(
            ingest_producer(&state, ProducerIngestKind::PcStatus, pc_status_payload())
                .expect("first ingest")
                .status,
            202
        );
        assert_eq!(
            ingest_producer(&state, ProducerIngestKind::PcStatus, pc_status_payload())
                .expect("second ingest")
                .status,
            202
        );
        let first = requests.recv().expect("first request").to_ascii_lowercase();
        let second = requests
            .recv()
            .expect("second request")
            .to_ascii_lowercase();
        assert!(first.contains("x-edith-producer-sequence: 1"));
        assert!(second.contains("x-edith-producer-sequence: 2"));
    }

    #[test]
    fn producer_non_202_revokes_native_session_and_replay_state() {
        let (port, _) = test_server(vec![200]);
        let state = producer_state(port);
        assert_eq!(
            ingest_producer(&state, ProducerIngestKind::PcStatus, pc_status_payload())
                .err()
                .as_deref(),
            Some("DESKTOP_PRODUCER_SEQUENCE_INVALID")
        );
        assert!(state.inner.lock().expect("state").producer.is_none());
    }

    #[test]
    fn producer_missing_bridge_configuration_fails_closed() {
        let state = CrossDeviceState {
            inner: Mutex::new(CrossDeviceInner {
                producer: Some(producer_session()),
                ..CrossDeviceInner::default()
            }),
            bridge: Mutex::new(None),
        };
        assert_eq!(
            ingest_producer(&state, ProducerIngestKind::PcStatus, pc_status_payload())
                .err()
                .as_deref(),
            Some("DESKTOP_BRIDGE_CONFIGURATION_REQUIRED")
        );
    }

    #[test]
    fn producer_bootstrap_sends_exact_native_bearer_and_wrong_token_fails_closed() {
        const TOKEN: &str = "bootstrap-bridge-token-kept-native";
        let (port, requests) = bootstrap_test_server(TOKEN);
        let bridge = ProducerBridge {
            token: TOKEN.into(),
            port,
        };
        let (status, _) = request_producer_bootstrap(
            &bridge,
            "mobile-test",
            "csrf-token-valid-for-native-bootstrap",
            "owner-cookie-native-only",
        )
        .expect("authorized bootstrap request");
        assert_eq!(status, 201);
        let request = requests.recv().expect("authorized request");
        assert!(request
            .lines()
            .any(|line| line.trim_end_matches('\r') == format!("authorization: Bearer {TOKEN}")));

        let (port, _) = bootstrap_test_server(TOKEN);
        let wrong_bridge = ProducerBridge {
            token: "wrong-bootstrap-bridge-token".into(),
            port,
        };
        let (status, body) = request_producer_bootstrap(
            &wrong_bridge,
            "mobile-test",
            "csrf-token-valid-for-native-bootstrap",
            "owner-cookie-native-only",
        )
        .expect("rejected bootstrap response");
        assert_eq!(status, 403);
        assert_eq!(
            safe_backend_error(&body, "DESKTOP_PRODUCER_SESSION_REJECTED"),
            "DESKTOP_PRODUCER_UNAUTHORIZED"
        );
    }

    #[test]
    fn producer_expiry_and_owner_rotation_revoke_token_and_sequence() {
        let state = producer_state(3000);
        {
            let mut inner = state.inner.lock().expect("state");
            inner
                .producer
                .as_mut()
                .expect("producer")
                .session
                .expires_at = iso_ms(now_ms().saturating_sub(1));
            revoke_expired_locked(&mut inner, now_ms());
            assert!(inner.producer.is_none());
            inner.producer = Some(producer_session());
        }
        state.revoke_owner("owner-test").expect("owner revoke");
        assert!(state.inner.lock().expect("state").producer.is_none());
    }

    #[test]
    fn canonical_live_view_metadata_is_pixels_free_and_bounded() {
        let lease = live_lease("owner-test", now_ms() + 60_000);
        let session = session_from_lease(&lease, "streaming", None);
        let json = serde_json::to_string(&session).expect("session json");
        assert!(json.contains("\"continuousAutoStream\":false"));
        assert!(json.contains("\"controlAuthority\":false"));
        assert!(json.contains("\"maxFramesPerSecond\":2"));
        assert!(!json.contains("bytesBase64"));
        assert!(!json.contains("imageDataUrl"));
        assert!(!json.contains("C:\\"));
    }

    #[test]
    fn expiry_and_owner_revoke_release_capture_and_partial_files() {
        let directory = temp_dir("revoke");
        let partial = directory.join("partial.bin");
        fs::write(&partial, b"partial").expect("partial fixture");
        let state = CrossDeviceState::default();
        {
            let mut inner = state.inner.lock().expect("state");
            inner.live_view = Some(live_lease("owner-test", now_ms() - 1));
            inner.audio_lease = Some(AudioLease {
                lineage: lineage("owner-test"),
                handoff_id: "handoff-test".into(),
                lease_id: "lease-test".into(),
                epoch: 1,
                expires_at_ms: now_ms() - 1,
                requested_at_ms: now_ms() - 100,
            });
            inner.inbound.insert(
                "transfer-test".into(),
                InboundTransfer {
                    lineage: lineage("owner-test"),
                    transfer_id: "transfer-test".into(),
                    file_name: "fixture.bin".into(),
                    media_type: "application/octet-stream".into(),
                    expected_size: 7,
                    expected_sha256: sha256_bytes(b"partial"),
                    destination_handle: "destination-test".into(),
                    final_path: directory.join("fixture.bin"),
                    partial_path: partial.clone(),
                    acknowledged_bytes: 7,
                    completed_chunks: vec![0],
                    created_at_ms: now_ms() - 1_000,
                    updated_at_ms: now_ms() - 100,
                    expires_at_ms: now_ms() - 1,
                },
            );
            revoke_expired_locked(&mut inner, now_ms());
            assert!(inner.live_view.is_none());
            assert!(inner.audio_lease.is_none());
            assert!(inner.inbound.is_empty());
        }
        assert!(!partial.exists());
        state.revoke_owner("owner-test").expect("owner revoke");
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn one_capture_lease_blocks_live_view_and_audio_overlap() {
        let mut inner = CrossDeviceInner::default();
        assert!(ensure_capture_slot_available(&inner).is_ok());
        inner.live_view = Some(live_lease("owner-test", now_ms() + 60_000));
        assert_eq!(
            ensure_capture_slot_available(&inner).unwrap_err(),
            "CAPTURE_LEASE_ALREADY_ACTIVE"
        );
    }

    #[test]
    fn wake_on_lan_is_honestly_configuration_required() {
        let result = cross_device_wake_request(WakeRequest {
            lineage: lineage("owner-test"),
            request_id: "wake-test".into(),
        })
        .expect("wake result");
        let json = serde_json::to_value(result).expect("wake json");
        assert_eq!(json["status"], "configuration_required");
        assert_eq!(json["attempted"], false);
        assert_eq!(json["runtimeReady"], false);
    }

    #[test]
    fn inbound_transfer_uses_real_bytes_checksum_resume_and_no_paths() {
        let directory = temp_dir("transfer");
        let payload = b"EDITH_PHASE6_TRANSFER";
        let destination = DestinationRecord {
            owner_session_binding_id: "owner-test".into(),
            path: directory.clone(),
            kind: "approved_folder".into(),
            display_summary: "Owner-approved folder".into(),
            expires_at_ms: now_ms() + 60_000,
        };
        let transfer = InboundTransfer {
            lineage: lineage("owner-test"),
            transfer_id: "transfer-test".into(),
            file_name: "fixture.bin".into(),
            media_type: "application/octet-stream".into(),
            expected_size: payload.len() as u64,
            expected_sha256: sha256_bytes(payload),
            destination_handle: "destination-test".into(),
            final_path: directory.join("fixture.bin"),
            partial_path: directory.join("partial.bin"),
            acknowledged_bytes: 0,
            completed_chunks: Vec::new(),
            created_at_ms: now_ms(),
            updated_at_ms: now_ms(),
            expires_at_ms: now_ms() + 60_000,
        };
        let mut inner = CrossDeviceInner::default();
        inner
            .destinations
            .insert("destination-test".into(), destination);
        inner.inbound.insert("transfer-test".into(), transfer);
        let request = InboxChunkRequest {
            owner_session_binding_id: "owner-test".into(),
            transfer_id: "transfer-test".into(),
            chunk_index: 0,
            offset_bytes: 0,
            chunk_sha256: sha256_bytes(payload),
            bytes_base64: String::new(),
        };
        let snapshot = write_inbox_chunk_locked(&mut inner, &request, payload).expect("write");
        assert_eq!(snapshot.status, "completed");
        assert_eq!(snapshot.progress.bytes_transferred, payload.len() as u64);
        assert_eq!(snapshot.progress.percent, 100.0);
        assert_eq!(snapshot.progress.integrity, "verified");
        assert_eq!(
            fs::read(directory.join("fixture.bin")).expect("final bytes"),
            payload
        );
        let json = serde_json::to_string(&snapshot).expect("snapshot json");
        assert!(!json.contains(directory.to_string_lossy().as_ref()));
        assert!(!json.contains("bytesBase64"));

        let collision_partial = directory.join("collision.part");
        let collision = InboundTransfer {
            lineage: lineage("owner-test"),
            transfer_id: "transfer-collision".into(),
            file_name: "fixture.bin".into(),
            media_type: "application/octet-stream".into(),
            expected_size: payload.len() as u64,
            expected_sha256: sha256_bytes(payload),
            destination_handle: "destination-test".into(),
            final_path: directory.join("fixture.bin"),
            partial_path: collision_partial,
            acknowledged_bytes: 0,
            completed_chunks: Vec::new(),
            created_at_ms: now_ms(),
            updated_at_ms: now_ms(),
            expires_at_ms: now_ms() + 60_000,
        };
        inner.inbound.insert("transfer-collision".into(), collision);
        let collision_request = InboxChunkRequest {
            owner_session_binding_id: "owner-test".into(),
            transfer_id: "transfer-collision".into(),
            chunk_index: 0,
            offset_bytes: 0,
            chunk_sha256: sha256_bytes(payload),
            bytes_base64: String::new(),
        };
        let collision_error =
            match write_inbox_chunk_locked(&mut inner, &collision_request, payload) {
                Ok(_) => panic!("collision must fail closed"),
                Err(error) => error,
            };
        assert_eq!(collision_error, "TRANSFER_DESTINATION_COLLISION");
        assert_eq!(
            fs::read(directory.join("fixture.bin")).expect("original retained"),
            payload
        );
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn retention_cleanup_preserves_active_and_pending_artifacts() {
        let directory = temp_dir("cleanup");
        let old = directory.join("old.bin");
        let active = directory.join("active.bin");
        let partial = directory.join("pending.part");
        fs::write(&old, b"old").expect("old fixture");
        fs::write(&active, b"active").expect("active fixture");
        fs::write(&partial, b"pending").expect("pending fixture");
        let mut inner = CrossDeviceInner::default();
        inner.retained.insert(
            "artifact-old".into(),
            RetainedArtifact {
                owner_session_binding_id: "owner-test".into(),
                path: old.clone(),
                completed_at_ms: now_ms() - RETENTION_MS - 1,
                active: false,
            },
        );
        inner.retained.insert(
            "artifact-active".into(),
            RetainedArtifact {
                owner_session_binding_id: "owner-test".into(),
                path: active.clone(),
                completed_at_ms: now_ms() - RETENTION_MS - 1,
                active: true,
            },
        );
        inner.inbound.insert(
            "transfer-pending".into(),
            InboundTransfer {
                lineage: lineage("owner-test"),
                transfer_id: "transfer-pending".into(),
                file_name: "pending.bin".into(),
                media_type: "application/octet-stream".into(),
                expected_size: 7,
                expected_sha256: sha256_bytes(b"pending"),
                destination_handle: "destination-test".into(),
                final_path: directory.join("pending.bin"),
                partial_path: partial.clone(),
                acknowledged_bytes: 7,
                completed_chunks: vec![0],
                created_at_ms: now_ms(),
                updated_at_ms: now_ms(),
                expires_at_ms: now_ms() + 60_000,
            },
        );
        let result = cleanup_inbox_locked(&mut inner, "owner-test", now_ms());
        assert_eq!(result.removed_artifacts, 1);
        assert_eq!(result.preserved_active_or_pending, 2);
        assert!(!old.exists());
        assert!(active.exists());
        assert!(partial.exists());
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn measured_metrics_are_bounded_or_honestly_unavailable() {
        let (cpu, ram, network) = platform::pc_metrics();
        assert!(cpu.is_none_or(|value| (0.0..=100.0).contains(&value)));
        assert!(ram.is_none_or(|value| (0.0..=100.0).contains(&value)));
        assert_eq!(network, "unknown");
    }
}

#[cfg(windows)]
mod platform {
    use super::*;
    use windows_sys::Win32::Foundation::{FILETIME, POINT, RECT};
    use windows_sys::Win32::Graphics::Gdi::{
        BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC,
        GetDIBits, GetMonitorInfoW, MonitorFromPoint, ReleaseDC, SelectObject, BITMAPINFO, BI_RGB,
        DIB_RGB_COLORS, MONITORINFO, MONITOR_DEFAULTTONEAREST, SRCCOPY,
    };
    use windows_sys::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
    use windows_sys::Win32::System::Threading::GetSystemTimes;
    use windows_sys::Win32::UI::HiDpi::{GetDpiForMonitor, MDT_EFFECTIVE_DPI};
    use windows_sys::Win32::UI::WindowsAndMessaging::GetCursorPos;

    fn filetime(value: FILETIME) -> u64 {
        ((value.dwHighDateTime as u64) << 32) | value.dwLowDateTime as u64
    }

    pub fn pc_metrics() -> (Option<f64>, Option<f64>, &'static str) {
        let mut idle_a = FILETIME::default();
        let mut kernel_a = FILETIME::default();
        let mut user_a = FILETIME::default();
        let first = unsafe { GetSystemTimes(&mut idle_a, &mut kernel_a, &mut user_a) } != 0;
        std::thread::sleep(Duration::from_millis(50));
        let mut idle_b = FILETIME::default();
        let mut kernel_b = FILETIME::default();
        let mut user_b = FILETIME::default();
        let second = unsafe { GetSystemTimes(&mut idle_b, &mut kernel_b, &mut user_b) } != 0;
        let cpu = if first && second {
            let idle = filetime(idle_b).saturating_sub(filetime(idle_a));
            let kernel = filetime(kernel_b).saturating_sub(filetime(kernel_a));
            let user = filetime(user_b).saturating_sub(filetime(user_a));
            let total = kernel.saturating_add(user);
            (total > 0).then(|| {
                ((total.saturating_sub(idle)) as f64 / total as f64 * 100.0).clamp(0.0, 100.0)
            })
        } else {
            None
        };
        let mut memory = MEMORYSTATUSEX {
            dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32,
            ..Default::default()
        };
        let ram = (unsafe { GlobalMemoryStatusEx(&mut memory) } != 0)
            .then_some(memory.dwMemoryLoad as f64);
        (cpu, ram, "unknown")
    }

    pub fn capture_current_screen(
        max_width: u32,
        max_height: u32,
    ) -> Result<CapturedFrame, String> {
        let mut cursor = POINT::default();
        if unsafe { GetCursorPos(&mut cursor) } == 0 {
            return Err("LIVE_VIEW_CURSOR_UNAVAILABLE".into());
        }
        let monitor = unsafe { MonitorFromPoint(cursor, MONITOR_DEFAULTTONEAREST) };
        if monitor.is_null() {
            return Err("LIVE_VIEW_MONITOR_UNAVAILABLE".into());
        }
        let mut info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if unsafe { GetMonitorInfoW(monitor, &mut info) } == 0 {
            return Err("LIVE_VIEW_MONITOR_UNAVAILABLE".into());
        }
        let RECT {
            left,
            top,
            right,
            bottom,
        } = info.rcMonitor;
        let source_width = right.saturating_sub(left);
        let source_height = bottom.saturating_sub(top);
        if source_width <= 0
            || source_height <= 0
            || source_width > 16_384
            || source_height > 16_384
        {
            return Err("LIVE_VIEW_MONITOR_BOUNDS_INVALID".into());
        }
        let screen = unsafe { GetDC(std::ptr::null_mut()) };
        if screen.is_null() {
            return Err("LIVE_VIEW_CAPTURE_UNAVAILABLE".into());
        }
        let memory = unsafe { CreateCompatibleDC(screen) };
        let bitmap = unsafe { CreateCompatibleBitmap(screen, source_width, source_height) };
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
            return Err("LIVE_VIEW_CAPTURE_UNAVAILABLE".into());
        }
        let old = unsafe { SelectObject(memory, bitmap) };
        let copied = unsafe {
            BitBlt(
                memory,
                0,
                0,
                source_width,
                source_height,
                screen,
                left,
                top,
                SRCCOPY,
            )
        };
        unsafe {
            SelectObject(memory, old);
        }
        let mut bitmap_info = BITMAPINFO::default();
        bitmap_info.bmiHeader.biSize = std::mem::size_of_val(&bitmap_info.bmiHeader) as u32;
        bitmap_info.bmiHeader.biWidth = source_width;
        bitmap_info.bmiHeader.biHeight = -source_height;
        bitmap_info.bmiHeader.biPlanes = 1;
        bitmap_info.bmiHeader.biBitCount = 32;
        bitmap_info.bmiHeader.biCompression = BI_RGB;
        let mut bgra = vec![0_u8; source_width as usize * source_height as usize * 4];
        let lines = if copied != 0 {
            unsafe {
                GetDIBits(
                    screen,
                    bitmap,
                    0,
                    source_height as u32,
                    bgra.as_mut_ptr().cast(),
                    &mut bitmap_info,
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
        if lines != source_height {
            return Err("LIVE_VIEW_CAPTURE_FAILED".into());
        }
        let scale = (max_width as f64 / source_width as f64)
            .min(max_height as f64 / source_height as f64)
            .min(1.0);
        let width = (source_width as f64 * scale).round().max(1.0) as u32;
        let height = (source_height as f64 * scale).round().max(1.0) as u32;
        let mut rgb = Vec::with_capacity(width as usize * height as usize * 3);
        for y in 0..height {
            let source_y = (y as u64 * source_height as u64 / height as u64) as usize;
            for x in 0..width {
                let source_x = (x as u64 * source_width as u64 / width as u64) as usize;
                let offset = (source_y * source_width as usize + source_x) * 4;
                rgb.extend_from_slice(&[bgra[offset + 2], bgra[offset + 1], bgra[offset]]);
            }
        }
        let mut png_bytes = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut png_bytes, width, height);
            encoder.set_color(png::ColorType::Rgb);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder
                .write_header()
                .map_err(|_| "LIVE_VIEW_ENCODE_FAILED")?;
            writer
                .write_image_data(&rgb)
                .map_err(|_| "LIVE_VIEW_ENCODE_FAILED")?;
        }
        let mut dpi_x = 96_u32;
        let mut dpi_y = 96_u32;
        let dpi_result =
            unsafe { GetDpiForMonitor(monitor, MDT_EFFECTIVE_DPI, &mut dpi_x, &mut dpi_y) };
        Ok(CapturedFrame {
            bytes: png_bytes,
            width,
            height,
            bounds: PhysicalFrameBounds {
                x: left,
                y: top,
                width: source_width,
                height: source_height,
                coordinate_space: "physical_virtual_desktop",
            },
            monitor_id: format!("monitor:{left}:{top}:{source_width}:{source_height}"),
            dpi_scale: if dpi_result < 0 || dpi_x == 0 || dpi_y == 0 {
                1.0
            } else {
                ((dpi_x as f64 + dpi_y as f64) / 2.0) / 96.0
            },
            cursor: Some((cursor.x, cursor.y)),
        })
    }
}
