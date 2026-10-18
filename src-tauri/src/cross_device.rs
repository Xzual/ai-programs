use base64::Engine;
use chrono::{DateTime, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{State, WebviewWindow, Window};
use tauri_plugin_dialog::DialogExt;

use crate::computer::ComputerState;

const CONTRACT_VERSION: u8 = 2;
const CONTRACT_AMENDMENT: &str = "2.1";
const MAX_LIVE_VIEW_FPS: u8 = 2;
const MAX_LIVE_VIEW_WIDTH: u32 = 1280;
const MAX_LIVE_VIEW_HEIGHT: u32 = 720;
const MAX_LIVE_VIEW_TTL_MS: u64 = 5 * 60_000;
const MAX_TRANSFER_BYTES: u64 = 25 * 1024 * 1024;
const MAX_CHUNK_BYTES: usize = 52 * 1024;
const HANDLE_TTL_MS: u64 = 60 * 60_000;
const RETENTION_MS: u64 = 24 * 60 * 60_000;
const PRODUCER_SESSION_MAX_TTL_MS: u64 = 15 * 60_000;
const MAX_PRODUCER_PAYLOAD_BYTES: usize = 256 * 1024;
const OWNER_SESSION_COOKIE: &str = "edith_owner_session";
static CARRIER_WORKERS: std::sync::atomic::AtomicU64=std::sync::atomic::AtomicU64::new(0);
struct CarrierWorker;
impl CarrierWorker {fn admitted()->Self{CARRIER_WORKERS.fetch_add(1,std::sync::atomic::Ordering::SeqCst);Self}}
impl Drop for CarrierWorker {fn drop(&mut self){CARRIER_WORKERS.fetch_sub(1,std::sync::atomic::Ordering::SeqCst);}}
pub(crate) fn native_carrier_quiescent()->bool {CARRIER_WORKERS.load(std::sync::atomic::Ordering::SeqCst)==0&&!CAPTURE_WORKER.load(std::sync::atomic::Ordering::SeqCst)}

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
    privacy: Option<PrivacyScope>,
}

#[derive(Clone)]
struct PrivacyScope {
    candidate: crate::computer::RetainedCaptureCandidate,
    client: [i32;4], region:[i32;4], exclusions:Vec<[i32;4]>,
    inventory_digest:String, scope_ref:String, scope_digest:String, generation:u64,
    dpi:u32,
    memory:Arc<PrivacyMemory>,
}
struct PrivateFrame { scope_ref:String, frame_ref:String, memory:Arc<PrivacyMemory>, observed_at_ms:u64, sequence:u64, width:u32, height:u32 }
impl Drop for PrivateFrame {fn drop(&mut self){self.memory.clear_frame(&self.frame_ref);}}
struct RetainedPixels {frame_ref:String,bytes:Vec<u8>}
fn clear_owned_bytes(bytes:&mut [u8]) {
    for byte in bytes {unsafe{std::ptr::write_volatile(byte,0);}}
    std::sync::atomic::compiler_fence(std::sync::atomic::Ordering::SeqCst);
}
impl Drop for RetainedPixels {fn drop(&mut self){clear_owned_bytes(&mut self.bytes);}}
struct PrivacyMemory {
    epoch:u64,
    active:std::sync::atomic::AtomicBool,
    pixels:Mutex<Option<RetainedPixels>>,
}
impl PrivacyMemory {
    fn new(epoch:u64)->Self {Self{epoch,active:std::sync::atomic::AtomicBool::new(true),pixels:Mutex::new(None)}}
    fn require_active(&self)->Result<(),String>{if !self.active.load(std::sync::atomic::Ordering::SeqCst){Err("LIVE_VIEW_SCOPE_REVOKED".into())}else{Ok(())}}
    // Called with no ComputerState, CrossDeviceInner or native OS resource lock.
    fn stop_epoch(&self,epoch:u64){
        if epoch!=self.epoch{return;}
        self.active.store(false,std::sync::atomic::Ordering::SeqCst);
        let mut pixels=self.pixels.lock().unwrap_or_else(|poisoned|poisoned.into_inner());
        pixels.take();
    }
    fn clear_frame(&self,frame_ref:&str){
        let mut pixels=self.pixels.lock().unwrap_or_else(|poisoned|poisoned.into_inner());
        if pixels.as_ref().is_some_and(|p|p.frame_ref==frame_ref){pixels.take();}
    }
    fn install(&self,frame_ref:String,bytes:Vec<u8>)->Result<(),String>{
        let pixels=RetainedPixels{frame_ref,bytes};
        self.require_active()?;
        let mut current=self.pixels.lock().map_err(|_|"LIVE_VIEW_PIXEL_STATE_UNAVAILABLE")?;
        self.require_active()?;
        *current=Some(pixels);Ok(())
    }
    fn encoded(&self,frame_ref:&str)->Result<(usize,String,String),String>{
        self.require_active()?;
        let current=self.pixels.lock().map_err(|_|"LIVE_VIEW_PIXEL_STATE_UNAVAILABLE")?;
        let frame=current.as_ref().filter(|p|p.frame_ref==frame_ref).ok_or("LIVE_VIEW_FRESH_FRAME_REQUIRED")?;
        self.require_active()?;
        let size=frame.bytes.len();let digest=sha256_bytes(&frame.bytes);
        let mut encoded=base64::engine::general_purpose::STANDARD.encode(&frame.bytes);
        if self.require_active().is_err(){unsafe{clear_owned_bytes(encoded.as_bytes_mut());}return Err("LIVE_VIEW_SCOPE_REVOKED".into());}
        Ok((size,digest,encoded))
    }
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
    held: Arc<Mutex<File>>,
    identity: String,
    native_generation: Option<u64>,
}

#[derive(Clone)]
struct NativeTransferPin {
    lineage: CrossDeviceLineage, transfer_id: String, source_handle: String,
    manifest: Value, manifest_digest: String, source_identity_digest: String,
    generation: u64, expires_at_ms: u64, checkpoint_id: String, file_name: String, media_type: String,
}

struct DestinationRecord {
    owner_session_binding_id: String,
    path: PathBuf,
    kind: String,
    display_summary: String,
    expires_at_ms: u64,
    held_directory: Option<Arc<File>>,
    identity: String,
    native_generation: u64,
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
    held_staging: Option<Arc<Mutex<File>>>,
    native_receiver: Option<ReceiverBinding>,
}
#[derive(Clone)]
struct ReceiverBinding {manifest_digest:String,checkpoint_id:String,generation:u64}

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
    native_pins: HashMap<String, NativeTransferPin>,
    filtered_frame: Option<PrivateFrame>,
    native_commits: HashMap<String,(Value,u64,u64)>,
}

#[derive(Clone)]
pub struct CrossDeviceState {
    inner: Arc<Mutex<CrossDeviceInner>>,
    bridge: Arc<Mutex<Option<ProducerBridge>>>,
    producer_transport:Arc<Mutex<()>>,
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
            inner: Arc::new(Mutex::new(CrossDeviceInner::default())),
            bridge: Arc::new(Mutex::new(token.map(|token| ProducerBridge { token, port }))),
            producer_transport:Arc::new(Mutex::new(())),
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
            if let Some(lease)=inner.live_view.take(){if let Some(scope)=lease.privacy{scope.memory.stop_epoch(scope.candidate.session_generation);}}
            inner.filtered_frame.take();
            inner.audio_lease.take();
            inner.sources.clear();
            inner.native_pins.clear();
            inner.native_commits.clear();
            inner.destinations.clear();
            for (_,mut transfer) in inner.inbound.drain() {
                transfer.held_staging.take();
                let _ = fs::remove_file(&transfer.partial_path);
            }
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
            if let Some(lease)=inner.live_view.take(){if let Some(scope)=lease.privacy{scope.memory.stop_epoch(scope.candidate.session_generation);}}
            inner.filtered_frame.take();
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
            if let Some(mut transfer) = inner.inbound.remove(&transfer_id) {
                transfer.held_staging.take();
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
        inner.native_pins.retain(|_,pin|pin.lineage.owner_session_binding_id!=owner_binding);
        inner.native_commits.retain(|_,(commit,_,_)|commit["lineage"]["ownerSessionBindingId"]!=owner_binding);
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
    #[serde(rename_all = "camelCase")]
    Bootstrap {
        device_id: String,
        csrf_token: String,
    },
    Ingest {
        kind: ProducerIngestKind,
        payload: Value,
    },
    #[serde(rename_all = "camelCase")]
    PinSource { lineage: CrossDeviceLineage, source_handle: String, idempotency_key: String, expires_at: String },
    #[serde(rename_all = "camelCase")]
    SendSourceChunk { transfer_id: String, index: u32, checkpoint_id: String },
    #[serde(rename_all = "camelCase")]
    TransferCheckpoint { transfer_id: String },
    #[serde(rename_all = "camelCase")]
    CancelTransfer { transfer_id: String },
    #[serde(rename_all = "camelCase")]
    ReapproveSource { transfer_id: String, checkpoint_id: String },
    #[serde(rename_all = "camelCase")]
    PublishFrame { live_view_id:String, frame_ref:String },
    #[serde(rename_all = "camelCase")]
    RegisterReceiver {transfer_id:String,manifest_digest:String,checkpoint_id:String},
    #[serde(rename_all = "camelCase")]
    ReceiveChunk {transfer_id:String,index:u32},
    #[serde(rename_all = "camelCase")]
    CommitReceiver {transfer_id:String},
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
        .no_proxy()
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
    let _transport=state.producer_transport.try_lock().map_err(|_|"DESKTOP_PRODUCER_BUSY")?;
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
    let _worker=CarrierWorker::admitted();
    let _transport=state.producer_transport.try_lock().map_err(|_|"DESKTOP_PRODUCER_BUSY")?;
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
    let _worker=CarrierWorker::admitted();
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
            if kind.advanced_native_only() || matches!(kind, ProducerIngestKind::Transfer | ProducerIngestKind::LiveViewFrameMetadata) {
                return Err("ADVANCED_NATIVE_PUBLICATION_RUST_ONLY".into());
            }
            ingest_producer(&state, kind, payload)
        }
        ProducerCommandRequest::PinSource { lineage, source_handle, idempotency_key, expires_at } => {
            validate_safe_id(&idempotency_key)?;
            let intent = native_http(&state,&computer,"/transfer/intent",json!({"idempotencyKey":idempotency_key}))?;
            let data = &intent.body["data"];
            let id = data["transferId"].as_str().ok_or("TRANSFER_INTENT_INVALID")?;
            let requested = parse_expiry(&expires_at,now_ms(),PRODUCER_SESSION_MAX_TTL_MS)?;
            let reserved = parse_expiry(data["expiresAt"].as_str().ok_or("TRANSFER_INTENT_INVALID")?,now_ms(),PRODUCER_SESSION_MAX_TTL_MS)?;
            pin_source(&state,&computer,&source_handle,lineage,id,requested.min(reserved),None)
        }
        ProducerCommandRequest::SendSourceChunk { transfer_id,index,checkpoint_id } => send_native_chunk(&state,&computer,&transfer_id,index,&checkpoint_id),
        ProducerCommandRequest::TransferCheckpoint { transfer_id } => native_transfer_control(&state,&computer,&transfer_id,false),
        ProducerCommandRequest::CancelTransfer { transfer_id } => native_transfer_control(&state,&computer,&transfer_id,true),
        ProducerCommandRequest::ReapproveSource { transfer_id,checkpoint_id } => {
            if !owner_confirms_reapproval(&window)? {return Err("TRANSFER_NATIVE_REAPPROVAL_REQUIRED".into());}
            reapprove_native_source(&state,&computer,&transfer_id,&checkpoint_id)
        },
        ProducerCommandRequest::PublishFrame {live_view_id,frame_ref} => publish_filtered_frame(&state,&computer,&live_view_id,&frame_ref),
        ProducerCommandRequest::RegisterReceiver{transfer_id,manifest_digest,checkpoint_id} => {
            if !owner_confirms_reapproval(&window)? {return Err("TRANSFER_NATIVE_REAPPROVAL_REQUIRED".into());}
            register_receiver(&state,&computer,&transfer_id,&manifest_digest,&checkpoint_id)
        },
        ProducerCommandRequest::ReceiveChunk{transfer_id,index} => receive_native_chunk(&state,&computer,&transfer_id,index),
        ProducerCommandRequest::CommitReceiver{transfer_id} => publish_receiver_commit(&state,&computer,&transfer_id),
    }
}

fn native_lineage_from_producer(state:&CrossDeviceState) -> Result<CrossDeviceLineage,String> {
    let inner=state.inner.lock().map_err(|_| "CROSS_DEVICE_STATE_UNAVAILABLE")?;
    let s=&inner.producer.as_ref().ok_or("DESKTOP_PRODUCER_SESSION_INVALID")?.session;
    if parse_expiry(&s.expires_at,now_ms(),PRODUCER_SESSION_MAX_TTL_MS).is_err() { return Err("DESKTOP_PRODUCER_SESSION_EXPIRED".into()); }
    Ok(CrossDeviceLineage {contract_version:2,amendment:"2.1".into(),owner_session_binding_id:s.owner_session_binding_id.clone(),workspace_id:s.workspace_id.clone(),session_id:s.session_id.clone(),source_device_id:s.source_device_id.clone(),target_device_id:s.target_device_id.clone()})
}

/// Only private constructors call this carrier. A renderer cannot supply native receipt bytes.
fn native_http(state:&CrossDeviceState,computer:&ComputerState,path:&str,payload:Value)->Result<ProducerCommandResult,String>{
    let _worker=CarrierWorker::admitted();
    let _transport=state.producer_transport.try_lock().map_err(|_|"DESKTOP_PRODUCER_BUSY")?;
    ensure_operational(state,computer)?;
    let carrier_epoch=computer.carrier_generation()?;
    let source_epoch=if let Some(handle)=payload["sourceHandle"].as_str(){
        let inner=state.inner.lock().map_err(|_|"CROSS_DEVICE_STATE_UNAVAILABLE")?;
        inner.sources.get(handle).ok_or("TRANSFER_SOURCE_HANDLE_INVALID")?.native_generation
    }else{None};
    if let Some(epoch)=source_epoch{computer.ensure_carrier_generation(epoch)?;}
    let frame_memory=if path=="/live-view/frame-bytes" {
        let inner=state.inner.lock().map_err(|_|"CROSS_DEVICE_STATE_UNAVAILABLE")?;
        let lease=inner.live_view.as_ref().ok_or("LIVE_VIEW_NOT_ACTIVE")?;
        let scope=lease.privacy.as_ref().ok_or("LIVE_VIEW_PRIVACY_SCOPE_REQUIRED")?;
        let frame=inner.filtered_frame.as_ref().ok_or("LIVE_VIEW_FRESH_FRAME_REQUIRED")?;
        if payload["liveViewId"].as_str()!=Some(lease.live_view_id.as_str())||payload["scopeRef"].as_str()!=Some(scope.scope_ref.as_str())||payload["frameId"].as_str()!=Some(frame.frame_ref.as_str())||frame.scope_ref!=scope.scope_ref||now_ms().saturating_sub(frame.observed_at_ms)>=2000||lease.expires_at_ms<=now_ms(){return Err("LIVE_VIEW_FRAME_STALE".into());}
        scope.memory.require_active()?;Some(scope.memory.clone())
    }else{None};
    if serde_json::to_vec(&payload).map_err(|_| "NATIVE_PAYLOAD_INVALID")?.len()>75_000 { return Err("NATIVE_PAYLOAD_LIMIT".into()); }
    let bridge=producer_bridge(state)?;
    let producer={let mut inner=state.inner.lock().map_err(|_| "CROSS_DEVICE_STATE_UNAVAILABLE")?;
        revoke_expired_locked(&mut inner,now_ms()); let p=inner.producer.as_mut().ok_or("DESKTOP_PRODUCER_SESSION_INVALID")?;
        let copy=p.clone(); p.next_sequence=p.next_sequence.checked_add(1).ok_or("DESKTOP_PRODUCER_SEQUENCE_INVALID")?;copy};
    let request=producer_http_client()?.post(format!("http://127.0.0.1:{}/api/edith/mobile/desktop-producer{}",bridge.port,path))
        .bearer_auth(&bridge.token).header("X-Edith-Producer-Session",&producer.token)
        .header("X-Edith-Producer-Sequence",producer.next_sequence.to_string()).json(&payload);
    computer.ensure_carrier_generation(carrier_epoch)?;
    if let Some(memory)=&frame_memory{memory.require_active()?;}
    let response=request.send()
        .map_err(|_| "DESKTOP_PRODUCER_BACKEND_UNAVAILABLE")?;
    let status=response.status().as_u16();let mut response_bytes=Vec::new();response.take(96*1024+1).read_to_end(&mut response_bytes).map_err(|_|"NATIVE_RESPONSE_INVALID")?;
    if response_bytes.len()>96*1024{return Err("NATIVE_RESPONSE_LIMIT".into());}
    let body:Value=serde_json::from_slice(&response_bytes).map_err(|_| "NATIVE_RESPONSE_INVALID")?;
    ensure_operational(state,computer)?;
    computer.ensure_carrier_generation(carrier_epoch)?;
    if let Some(epoch)=source_epoch{computer.ensure_carrier_generation(epoch)?;}
    if let Some(memory)=&frame_memory{memory.require_active()?;}
    let inner=state.inner.lock().map_err(|_| "CROSS_DEVICE_STATE_UNAVAILABLE")?;
    if !inner.producer.as_ref().is_some_and(|p|p.token==producer.token && p.session.expires_at==producer.session.expires_at) {return Err("DESKTOP_PRODUCER_SCOPE_STALE".into());}
    if !(200..300).contains(&status) || body["success"]!=true { return Err(safe_backend_error(&body,"NATIVE_PRODUCER_REJECTED")); }
    Ok(ProducerCommandResult{status,body})
}

fn canonical_value(value:&Value)->Value { match value {Value::Object(m)=>{let mut keys:Vec<_>=m.keys().collect();keys.sort();let mut out=Map::new();for k in keys{out.insert(k.clone(),canonical_value(&m[k]));}Value::Object(out)},Value::Array(a)=>Value::Array(a.iter().map(canonical_value).collect()),v=>v.clone()} }

fn pin_source(state:&CrossDeviceState,computer:&ComputerState,handle:&str,lineage:CrossDeviceLineage,id:&str,deadline:u64,backend_identity:Option<&str>)->Result<ProducerCommandResult,String>{
    lineage.validate()?;validate_safe_id(id)?;
    if native_lineage_from_producer(state)?!=lineage {return Err("TRANSFER_LINEAGE_MISMATCH".into());}
    let pin={let inner=state.inner.lock().map_err(|_| "CROSS_DEVICE_STATE_UNAVAILABLE")?;
        if inner.native_pins.len()>=4 {return Err("TRANSFER_PIN_LIMIT".into());}
        let s=inner.sources.get(handle).ok_or("TRANSFER_SOURCE_HANDLE_INVALID")?;
        if let Some(epoch)=s.native_generation{computer.ensure_carrier_generation(epoch)?;}
        if s.owner_session_binding_id!=lineage.owner_session_binding_id || deadline> s.expires_at_ms || deadline<=now_ms() {return Err("TRANSFER_SOURCE_SCOPE_INVALID".into());}
        let manifest=source_manifest(s,id)?;let manifest_digest=sha256_bytes(serde_json::to_vec(&canonical_value(&manifest)).map_err(|_| "TRANSFER_MANIFEST_INVALID")?.as_slice());
        let name=s.path.file_name().and_then(|s|s.to_str()).ok_or("TRANSFER_FILE_NAME_INVALID")?.to_string();
        let media=match s.path.extension().and_then(|s|s.to_str()).unwrap_or("").to_ascii_lowercase().as_str(){"txt"|"md"|"csv"=>"text/plain","json"=>"application/json","png"=>"image/png","jpg"|"jpeg"=>"image/jpeg","pdf"=>"application/pdf",_=>return Err("TRANSFER_MEDIA_TYPE_INVALID".into())};
        NativeTransferPin{lineage,transfer_id:id.into(),source_handle:handle.into(),manifest,manifest_digest,source_identity_digest:backend_identity.unwrap_or(&s.identity).into(),generation:1,expires_at_ms:deadline,checkpoint_id:String::new(),file_name:name,media_type:media.into()}};
    let response=native_http(state,computer,"/transfer/source",pin_payload(&pin))?;
    let checkpoint=response.body["data"]["checkpoint"]["checkpointId"].as_str().ok_or("TRANSFER_CHECKPOINT_INVALID")?;
    validate_safe_id(checkpoint)?;let mut pin=pin;pin.checkpoint_id=checkpoint.into();
    let mut inner=state.inner.lock().map_err(|_| "CROSS_DEVICE_STATE_UNAVAILABLE")?;
    let source=inner.sources.get(handle).ok_or("TRANSFER_SOURCE_HANDLE_INVALID")?;
    if let Some(epoch)=source.native_generation{computer.ensure_carrier_generation(epoch)?;}
    if deadline<=now_ms(){return Err("TRANSFER_EXPIRED".into());}
    inner.native_pins.insert(id.into(),pin);
    Ok(response)
}
fn pin_payload(pin:&NativeTransferPin)->Value {json!({"schema":"edith.native-mobile/1","lineage":pin.lineage,"transferId":pin.transfer_id,"sourceHandle":pin.source_handle,"manifest":pin.manifest,"manifestDigest":pin.manifest_digest,"sourceIdentityDigest":pin.source_identity_digest,"sourceGeneration":pin.generation,"fileName":pin.file_name,"mediaType":pin.media_type,"expiresAt":iso_ms(pin.expires_at_ms)})}
fn receiver_control(t:&InboundTransfer,b:&ReceiverBinding)->Value{json!({"schema":"edith.native-mobile/1","lineage":t.lineage,"transferId":t.transfer_id,"manifestDigest":b.manifest_digest,"checkpointId":b.checkpoint_id})}
fn register_receiver(state:&CrossDeviceState,computer:&ComputerState,id:&str,digest:&str,checkpoint:&str)->Result<ProducerCommandResult,String>{
    if !is_sha256(digest){return Err("TRANSFER_MANIFEST_INVALID".into());}validate_safe_id(checkpoint)?;
    let epoch=computer.carrier_generation()?;let mut lineage=native_lineage_from_producer(state)?;std::mem::swap(&mut lineage.source_device_id,&mut lineage.target_device_id);
    let (body,binding)={let inner=state.inner.lock().map_err(|_|"CROSS_DEVICE_STATE_UNAVAILABLE")?;let t=inner.inbound.get(id).ok_or("TRANSFER_NOT_FOUND")?;
        let d=inner.destinations.get(&t.destination_handle).ok_or("TRANSFER_DESTINATION_HANDLE_INVALID")?;
        if d.held_directory.is_none()||destination_open(&d.path)?.1!=d.identity{return Err("TRANSFER_DESTINATION_CHANGED".into());}
        if t.expires_at_ms<=now_ms()||d.expires_at_ms<t.expires_at_ms||d.owner_session_binding_id!=t.lineage.owner_session_binding_id{return Err("TRANSFER_DESTINATION_SCOPE_INVALID".into());}
        if t.lineage.owner_session_binding_id!=lineage.owner_session_binding_id||t.lineage.workspace_id!=lineage.workspace_id||t.lineage.source_device_id!=lineage.source_device_id||t.lineage.target_device_id!=lineage.target_device_id{return Err("TRANSFER_RECEIVER_LINEAGE_MISMATCH".into());}
        if let Some(old)=&t.native_receiver{if old.manifest_digest!=digest||old.checkpoint_id!=checkpoint{return Err("TRANSFER_RECEIVER_REAPPROVAL_MISMATCH".into());}}
        let generation=t.native_receiver.as_ref().map(|b|b.generation+1).unwrap_or(1);
        let binding=ReceiverBinding{manifest_digest:digest.into(),checkpoint_id:checkpoint.into(),generation};
        let mut body=receiver_control(t,&binding);body["lineage"]=json!(lineage);body["destinationHandle"]=json!(t.destination_handle);body["receiverGeneration"]=json!(generation);body["expiresAt"]=json!(iso_ms(t.expires_at_ms));(body,binding)};
    let result=native_http(state,computer,&format!("/transfer/{id}/receiver-pin"),body)?;
    computer.ensure_carrier_generation(epoch)?;
    let mut inner=state.inner.lock().map_err(|_|"CROSS_DEVICE_STATE_UNAVAILABLE")?;
    let t=inner.inbound.get_mut(id).ok_or("TRANSFER_NOT_FOUND")?;t.native_receiver=Some(binding);t.lineage=lineage;let destination=t.destination_handle.clone();
    inner.destinations.get_mut(&destination).ok_or("TRANSFER_DESTINATION_HANDLE_INVALID")?.native_generation=epoch;Ok(result)
}
fn receive_native_chunk(state:&CrossDeviceState,computer:&ComputerState,id:&str,index:u32)->Result<ProducerCommandResult,String>{
    let (mut body,expected_size,expected_sha,destination,lineage,checkpoint,original_expiry,original_epoch)={let inner=state.inner.lock().map_err(|_|"CROSS_DEVICE_STATE_UNAVAILABLE")?;let t=inner.inbound.get(id).ok_or("TRANSFER_NOT_FOUND")?;let b=t.native_receiver.as_ref().ok_or("TRANSFER_RECEIVER_PIN_REQUIRED")?;
        if t.expires_at_ms<=now_ms()||index as usize!=t.completed_chunks.len(){return Err("TRANSFER_RESUME_OFFSET_INVALID".into());}
        let epoch=inner.destinations.get(&t.destination_handle).ok_or("TRANSFER_DESTINATION_HANDLE_INVALID")?.native_generation;computer.ensure_carrier_generation(epoch)?;
        (receiver_control(t,b),t.expected_size,t.expected_sha256.clone(),t.destination_handle.clone(),t.lineage.clone(),b.clone(),t.expires_at_ms,epoch)};
    body["index"]=json!(index);body["offsetBytes"]=json!(index as u64*MAX_CHUNK_BYTES as u64);
    let response=native_http(state,computer,&format!("/transfer/{id}/read"),body.clone())?;
    let chunk=&response.body["data"];let c=chunk.as_object().ok_or("TRANSFER_SOURCE_CHUNK_INVALID")?;
    if !exact_keys(c,&["schema","lineage","transferId","manifestDigest","checkpointId","index","offsetBytes","sourceHandle","sizeBytes","chunkSha256","fileSha256","bytesBase64"],&[])
        ||chunk["schema"]!="edith.native-mobile/1"||chunk["lineage"]!=json!(lineage)||chunk["transferId"]!=id||chunk["manifestDigest"]!=checkpoint.manifest_digest||chunk["checkpointId"]!=checkpoint.checkpoint_id||chunk["index"]!=index||chunk["offsetBytes"]!=index as u64*MAX_CHUNK_BYTES as u64||chunk["fileSha256"]!=expected_sha{return Err("TRANSFER_SOURCE_CHUNK_INVALID".into());}
    let encoded=chunk["bytesBase64"].as_str().ok_or("TRANSFER_CHUNK_ENCODING_INVALID")?;
    if encoded.len()>MAX_CHUNK_BYTES.div_ceil(3)*4{return Err("TRANSFER_CHUNK_SIZE_INVALID".into());}
    let bytes=ClearingBytes(base64::engine::general_purpose::STANDARD.decode(encoded).map_err(|_|"TRANSFER_CHUNK_ENCODING_INVALID")?);
    let offset=index as u64*MAX_CHUNK_BYTES as u64;
    if bytes.0.len()!=MAX_CHUNK_BYTES.min(expected_size.saturating_sub(offset) as usize)||bytes.0.is_empty()||chunk["sizeBytes"]!=bytes.0.len()||chunk["chunkSha256"]!=sha256_bytes(&bytes.0)||base64::engine::general_purpose::STANDARD.encode(&bytes.0)!=encoded{return Err("TRANSFER_CHUNK_CHECKSUM_INVALID".into());}
    ensure_operational(state,computer)?;
    let request=InboxChunkRequest{owner_session_binding_id:lineage.owner_session_binding_id.clone(),transfer_id:id.into(),chunk_index:index,offset_bytes:offset,chunk_sha256:sha256_bytes(&bytes.0),bytes_base64:String::new()};
    let snapshot={let mut inner=state.inner.lock().map_err(|_|"CROSS_DEVICE_STATE_UNAVAILABLE")?;let t=inner.inbound.get(id).ok_or("TRANSFER_NOT_FOUND")?;
        if t.expires_at_ms<=now_ms()||!t.native_receiver.as_ref().is_some_and(|b|b.manifest_digest==checkpoint.manifest_digest&&b.generation==checkpoint.generation){return Err("TRANSFER_RECEIVER_SCOPE_STALE".into());}
        let d=inner.destinations.get(&t.destination_handle).ok_or("TRANSFER_DESTINATION_HANDLE_INVALID")?;let epoch=d.native_generation;
        computer.ensure_carrier_generation(epoch)?;
        write_inbox_chunk_locked(&mut inner,&request,&bytes.0,&||computer.ensure_carrier_generation(epoch))?};
    if snapshot.status!="completed"{return Ok(ProducerCommandResult{status:202,body:json!({"success":true,"data":{"nativeStaged":true,"completed":false,"bytesTransferred":snapshot.progress.bytes_transferred}})});}
    ensure_operational(state,computer)?;
    let commit=json!({"schema":"edith.native-mobile/1","lineage":lineage,"transferId":id,"manifestDigest":checkpoint.manifest_digest,"checkpointId":checkpoint.checkpoint_id,"sizeBytes":expected_size,"sha256":expected_sha,"destinationHandle":destination,"commitId":format!("commit-{}",random_hex(16)?),"committedAt":iso_ms(now_ms())});
    computer.ensure_carrier_generation(original_epoch)?;
    state.inner.lock().map_err(|_|"CROSS_DEVICE_STATE_UNAVAILABLE")?.native_commits.insert(id.into(),(commit,original_expiry,original_epoch));
    publish_receiver_commit(state,computer,id)
}
fn publish_receiver_commit(state:&CrossDeviceState,computer:&ComputerState,id:&str)->Result<ProducerCommandResult,String>{
    let commit={let inner=state.inner.lock().map_err(|_|"CROSS_DEVICE_STATE_UNAVAILABLE")?;let (c,expiry,epoch)=inner.native_commits.get(id).ok_or("TRANSFER_NATIVE_COMMIT_REQUIRED")?;if *expiry<=now_ms(){return Err("TRANSFER_NATIVE_COMMIT_EXPIRED".into());}computer.ensure_carrier_generation(*epoch)?;c.clone()};
    native_http(state,computer,"/transfer/receiver-commit",commit)
}
fn pin_control(pin:&NativeTransferPin)->Value{json!({"schema":"edith.native-mobile/1","lineage":pin.lineage,"transferId":pin.transfer_id,"manifestDigest":pin.manifest_digest,"checkpointId":pin.checkpoint_id})}
fn current_pin(state:&CrossDeviceState,id:&str)->Result<NativeTransferPin,String>{let inner=state.inner.lock().map_err(|_| "CROSS_DEVICE_STATE_UNAVAILABLE")?;let p=inner.native_pins.get(id).ok_or("TRANSFER_PIN_REQUIRED")?;if p.expires_at_ms<=now_ms(){return Err("TRANSFER_EXPIRED".into());}Ok(p.clone())}
fn native_transfer_control(state:&CrossDeviceState,computer:&ComputerState,id:&str,cancel:bool)->Result<ProducerCommandResult,String>{
    validate_safe_id(id)?;
    let pin=current_pin(state,id).ok();
    let mut body=if let Some(p)=&pin{pin_control(p)}else{let inner=state.inner.lock().map_err(|_|"CROSS_DEVICE_STATE_UNAVAILABLE")?;let t=inner.inbound.get(id).ok_or("TRANSFER_NOT_FOUND")?;receiver_control(t,t.native_receiver.as_ref().ok_or("TRANSFER_RECEIVER_PIN_REQUIRED")?)};
    if !cancel {body.as_object_mut().ok_or("TRANSFER_CONTROL_INVALID")?.remove("transferId");body.as_object_mut().ok_or("TRANSFER_CONTROL_INVALID")?.remove("checkpointId");}
    let result=native_http(state,computer,&format!("/transfer/{}/{}",id,if cancel{"cancel"}else{"checkpoint"}),body)?;
    let mut inner=state.inner.lock().map_err(|_| "CROSS_DEVICE_STATE_UNAVAILABLE")?;
    if cancel{inner.native_pins.remove(id);if let Some(p)=pin{inner.sources.remove(&p.source_handle);}if let Some(mut t)=inner.inbound.remove(id){t.held_staging.take();let _=fs::remove_file(&t.partial_path);}}
    else{let cp=result.body["data"]["checkpointId"].as_str().ok_or("TRANSFER_CHECKPOINT_INVALID")?;validate_safe_id(cp)?;if let Some(p)=inner.native_pins.get_mut(id){p.checkpoint_id=cp.into();}if let Some(t)=inner.inbound.get_mut(id){if let Some(b)=t.native_receiver.as_mut(){b.checkpoint_id=cp.into();}}}Ok(result)
}
fn send_native_chunk(state:&CrossDeviceState,computer:&ComputerState,id:&str,index:u32,checkpoint:&str)->Result<ProducerCommandResult,String>{
    let pin=current_pin(state,id)?;if pin.checkpoint_id!=checkpoint{return Err("TRANSFER_CHECKPOINT_STALE".into());}
    let mut bytes={let inner=state.inner.lock().map_err(|_| "CROSS_DEVICE_STATE_UNAVAILABLE")?;let s=inner.sources.get(&pin.source_handle).ok_or("TRANSFER_SOURCE_HANDLE_INVALID")?;
        let c=pin.manifest["chunks"].get(index as usize).ok_or("TRANSFER_CHUNK_INDEX_INVALID")?;
        if let Some(epoch)=s.native_generation{computer.ensure_carrier_generation(epoch)?;}
        let offset=c["offsetBytes"].as_u64().ok_or("TRANSFER_MANIFEST_INVALID")?;let size=c["sizeBytes"].as_u64().ok_or("TRANSFER_MANIFEST_INVALID")? as usize;
        let mut f=s.held.lock().map_err(|_| "TRANSFER_SOURCE_UNAVAILABLE")?;
        if held_file_identity(&f)?!=s.identity || held_hash(&mut f)?!=s.sha256{return Err("TRANSFER_SOURCE_CHANGED".into());}
        f.seek(SeekFrom::Start(offset)).map_err(|_| "TRANSFER_SOURCE_READ_FAILED")?;let mut bytes=vec![0;size];f.read_exact(&mut bytes).map_err(|_| "TRANSFER_SOURCE_READ_FAILED")?;
        if sha256_bytes(&bytes)!=c["sha256"].as_str().ok_or("TRANSFER_MANIFEST_INVALID")?{bytes.fill(0);return Err("TRANSFER_SOURCE_CHANGED".into());}bytes};
    let mut payload=pin_control(&pin);let m=payload.as_object_mut().ok_or("TRANSFER_MANIFEST_INVALID")?;
    m.insert("index".into(),json!(index));m.insert("offsetBytes".into(),json!(index as u64*MAX_CHUNK_BYTES as u64));m.insert("sourceHandle".into(),json!(pin.source_handle));
    m.insert("sizeBytes".into(),json!(bytes.len()));m.insert("chunkSha256".into(),json!(sha256_bytes(&bytes)));m.insert("fileSha256".into(),pin.manifest["fileSha256"].clone());m.insert("bytesBase64".into(),json!(base64::engine::general_purpose::STANDARD.encode(&bytes)));bytes.fill(0);
    let result=native_http(state,computer,"/transfer/chunk",payload)?;let cp=result.body["data"]["checkpointId"].as_str().ok_or("TRANSFER_CHECKPOINT_INVALID")?;
    if let Some(p)=state.inner.lock().map_err(|_| "CROSS_DEVICE_STATE_UNAVAILABLE")?.native_pins.get_mut(id){p.checkpoint_id=cp.into();}Ok(result)
}
fn reapprove_native_source(state:&CrossDeviceState,computer:&ComputerState,id:&str,checkpoint:&str)->Result<ProducerCommandResult,String>{
    let mut pin=current_pin(state,id)?;if pin.checkpoint_id!=checkpoint{return Err("TRANSFER_CHECKPOINT_STALE".into());}
    {let inner=state.inner.lock().map_err(|_| "CROSS_DEVICE_STATE_UNAVAILABLE")?;let s=inner.sources.get(&pin.source_handle).ok_or("TRANSFER_SOURCE_HANDLE_INVALID")?;if source_manifest(s,id)?!=pin.manifest{return Err("TRANSFER_SOURCE_CHANGED".into());}}
    let lineage=native_lineage_from_producer(state)?;
    if lineage.owner_session_binding_id!=pin.lineage.owner_session_binding_id||lineage.workspace_id!=pin.lineage.workspace_id||lineage.source_device_id!=pin.lineage.source_device_id||lineage.target_device_id!=pin.lineage.target_device_id||lineage.session_id==pin.lineage.session_id{return Err("TRANSFER_REAPPROVAL_SCOPE_INVALID".into());}
    pin.lineage=lineage;pin.generation=pin.generation.checked_add(1).ok_or("TRANSFER_GENERATION_INVALID")?;
    let epoch=computer.carrier_generation()?;
    state.inner.lock().map_err(|_|"CROSS_DEVICE_STATE_UNAVAILABLE")?.sources.get_mut(&pin.source_handle).ok_or("TRANSFER_SOURCE_HANDLE_INVALID")?.native_generation=Some(epoch);
    let mut body=pin_payload(&pin);body["checkpointId"]=json!(checkpoint);let response=native_http(state,computer,&format!("/transfer/{id}/reapprove"),body)?;
    state.inner.lock().map_err(|_| "CROSS_DEVICE_STATE_UNAVAILABLE")?.native_pins.insert(id.into(),pin);Ok(response)
}
#[cfg(windows)]
fn owner_confirms_reapproval(window:&WebviewWindow)->Result<bool,String>{
    use windows_sys::Win32::UI::WindowsAndMessaging::{MessageBoxW,IDYES,MB_DEFBUTTON2,MB_ICONWARNING,MB_YESNO};
    let hwnd=window.hwnd().map_err(|_|"TRANSFER_APPROVAL_UNAVAILABLE")?.0;
    let message:Vec<u16>="Approve this previously selected source/destination for the current paired session, retaining its original deadline? No overwrite or new destination is allowed.\0".encode_utf16().collect();let title:Vec<u16>="E.D.I.T.H. native transfer approval\0".encode_utf16().collect();
    Ok(unsafe{MessageBoxW(hwnd,message.as_ptr(),title.as_ptr(),MB_YESNO|MB_DEFBUTTON2|MB_ICONWARNING)}==IDYES)
}
#[cfg(not(windows))]
fn owner_confirms_reapproval(_:&WebviewWindow)->Result<bool,String>{Err("TRANSFER_NATIVE_PLATFORM_UNSUPPORTED".into())}

pub(crate) fn pin_native_files_source(state:&CrossDeviceState,computer:&ComputerState,source:&Value,native_generation:u64,guard:&dyn Fn()->Result<(),String>)->Result<Value,String>{
    let _worker=CarrierWorker::admitted();
    guard()?;ensure_operational(state,computer)?;
    computer.ensure_carrier_generation(native_generation)?;
    let path=PathBuf::from(source["canonicalPath"].as_str().ok_or("TRANSFER_NATIVE_PATH_REQUIRED")?).canonicalize().map_err(|_|"TRANSFER_SOURCE_UNAVAILABLE")?;
    if PathBuf::from(source["absolutePath"].as_str().ok_or("TRANSFER_NATIVE_PATH_REQUIRED")?).canonicalize().map_err(|_|"TRANSFER_SOURCE_UNAVAILABLE")?!=path {return Err("TRANSFER_SOURCE_CHANGED".into());}
    let expected=source["contentSha256"].as_str().ok_or("TRANSFER_NATIVE_HASH_REQUIRED")?;
    let backend_identity=source["sourceIdentityDigest"].as_str().ok_or("TRANSFER_NATIVE_IDENTITY_REQUIRED")?;
    if !is_sha256(expected)||!is_sha256(backend_identity){return Err("TRANSFER_NATIVE_DESCRIPTOR_INVALID".into());}
    let lineage=native_lineage_from_producer(state)?;
    if source["ownerBindingId"]!=lineage.owner_session_binding_id || source["targetDeviceId"]!=lineage.target_device_id{return Err("TRANSFER_NATIVE_OWNER_MISMATCH".into());}
    let id=source["transferId"].as_str().ok_or("TRANSFER_NATIVE_ID_REQUIRED")?;
    let expiry=source["expiresAt"].as_str().ok_or("TRANSFER_NATIVE_EXPIRY_REQUIRED")?;
    let deadline=parse_expiry(expiry,now_ms(),PRODUCER_SESSION_MAX_TTL_MS)?;
    let (mut file,identity)=source_open(Path::new(source["absolutePath"].as_str().ok_or("TRANSFER_NATIVE_PATH_REQUIRED")?))?;let size=file.metadata().map_err(|_|"TRANSFER_SOURCE_UNAVAILABLE")?.len();
    if size==0||size>MAX_TRANSFER_BYTES{return Err("TRANSFER_SOURCE_SIZE_INVALID".into());}
    let sha=held_hash(&mut file)?;if sha!=expected{return Err("TRANSFER_SOURCE_CHANGED".into());}
    guard()?;let handle=format!("source-{}",random_hex(16)?);
    state.inner.lock().map_err(|_|"CROSS_DEVICE_STATE_UNAVAILABLE")?.sources.insert(handle.clone(),SourceRecord{
        owner_session_binding_id:lineage.owner_session_binding_id.clone(),path,size_bytes:size,sha256:sha.clone(),expires_at_ms:deadline,held:Arc::new(Mutex::new(file)),identity,native_generation:Some(native_generation)});
    let result=pin_source(state,computer,&handle,lineage,id,deadline,Some(backend_identity));
    guard()?;result?;
    let pin=current_pin(state,id)?;
    Ok(json!({"sourceHandle":handle,"contentSha256":sha,"sourceManifest":pin.manifest}))
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
    observation_id:String,
    observation_generation:u64,
    public_region:[i32;4],
    exclusions:Vec<[i32;4]>,
    lease_generation:u64,
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
    let _worker=CarrierWorker::admitted();
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
    let candidate=computer.retained_capture_candidate(&request.observation_id,request.observation_generation)?;
    if candidate.owner_binding_id!=request.lineage.owner_session_binding_id||native_lineage_from_producer(&state)?!=request.lineage{return Err("LIVE_VIEW_OWNER_LINEAGE_MISMATCH".into());}
    let client=privacy_client_rect(&candidate.identity)?;
    let privacy=build_privacy_scope(&computer,candidate,client,request.public_region,&request.exclusions,request.lease_generation)?;
    if !owner_approves_privacy(&window,&privacy)? {
        return Err("LIVE_VIEW_OWNER_APPROVAL_REQUIRED".into());
    }
    let weak=Arc::downgrade(&privacy.memory);
    computer.register_carrier_stop_hook(privacy.candidate.session_generation,Arc::new(move|epoch|{
        if let Some(memory)=weak.upgrade(){memory.stop_epoch(epoch);}
    }))?;
    privacy.memory.require_active()?;
    ensure_operational(&state, &computer)?;
    let lease = LiveViewLease {
        lineage: request.lineage,
        live_view_id: request.live_view_id,
        expires_at_ms: expires_at_ms.min(privacy.candidate.expires_at_ms),
        max_fps: request.max_frames_per_second,
        max_width: request.max_width,
        max_height: request.max_height,
        sequence: 0,
        last_frame_at_ms: 0,
        started_at_ms: now_ms(),
        privacy: Some(privacy.clone()),
    };
    let mut inner = state
        .inner
        .lock()
        .map_err(|_| "CROSS_DEVICE_STATE_UNAVAILABLE".to_string())?;
    revoke_expired_locked(&mut inner, now_ms());
    ensure_capture_slot_available(&inner)?;
    computer.validate_capture_candidate(&privacy.candidate)?;
    privacy.memory.require_active()?;
    drop(inner);
    native_http(&state,&computer,"/live-view/scope",json!({"schema":"edith.native-mobile/1","producerLineage":lease.lineage,"liveViewId":lease.live_view_id,"leaseGeneration":privacy.generation,"scopeRef":privacy.scope_ref,"privacyProfile":"window-public-region-v1","scopeDigest":privacy.scope_digest,"approvedAt":iso_ms(lease.started_at_ms),"expiresAt":iso_ms(lease.expires_at_ms)}))?;
    computer.validate_capture_candidate(&privacy.candidate)?;
    privacy.memory.require_active()?;
    let mut inner=state.inner.lock().map_err(|_|"CROSS_DEVICE_STATE_UNAVAILABLE")?;
    ensure_capture_slot_available(&inner)?;
    let response = session_from_lease(&lease, "configuration_required", None);
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

#[derive(Clone,Serialize)]
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
    frame_ref: String,
}

#[tauri::command]
pub fn cross_device_live_view_frame(
    window: Window,
    state: State<'_, CrossDeviceState>,
    computer: State<'_, ComputerState>,
    owner_session_binding_id: String,
    live_view_id: String,
) -> Result<LiveViewFrameResponse, String> {
    let _worker=CarrierWorker::admitted();
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
    let privacy=lease.privacy.as_ref().ok_or("LIVE_VIEW_PRIVACY_SCOPE_REQUIRED")?;
    privacy.memory.require_active()?;
    let mut captured = ClearingCapture(capture_private_window(&computer,privacy,lease.max_width,lease.max_height)?);
    ensure_operational(&state, &computer)?;
    let observed_at = now;
    let cursor = captured.cursor.map(|(x, y)| NormalizedPoint {
        x: ((x - captured.bounds.x) as f64 / captured.bounds.width as f64).clamp(0.0, 1.0),
        y: ((y - captured.bounds.y) as f64 / captured.bounds.height as f64).clamp(0.0, 1.0),
    });
    let frame_id = format!("frame-{}-{}", lease.sequence, random_hex(8)?);
    let frame_ref=frame_id.clone();
    {
        computer.validate_capture_candidate(&privacy.candidate)?;
        let mut inner=state.inner.lock().map_err(|_|"CROSS_DEVICE_STATE_UNAVAILABLE")?;
        if !inner.live_view.as_ref().is_some_and(|current|current.live_view_id==lease.live_view_id && current.sequence==lease.sequence && current.expires_at_ms>now_ms()) || now_ms().saturating_sub(observed_at)>2000 {
            captured.bytes.fill(0);return Err("LIVE_VIEW_SCOPE_STALE".into());
        }
        privacy.memory.install(frame_ref.clone(),std::mem::take(&mut captured.bytes))?;
        inner.filtered_frame=Some(PrivateFrame{scope_ref:privacy.scope_ref.clone(),frame_ref:frame_ref.clone(),memory:privacy.memory.clone(),observed_at_ms:observed_at,sequence:lease.sequence,width:captured.width,height:captured.height});
    }
    let expiry_state=state.inner().clone();let expiry_ref=frame_ref.clone();
    std::thread::spawn(move||{std::thread::sleep(Duration::from_millis(2000));if let Ok(mut inner)=expiry_state.inner.lock(){if let Some(frame)=inner.filtered_frame.as_ref().filter(|f|f.frame_ref==expiry_ref){frame.memory.clear_frame(&expiry_ref);inner.filtered_frame.take();}}});
    let (size_bytes,sha256,bytes_base64)=privacy.memory.encoded(&frame_ref)?;
    computer.validate_capture_candidate(&privacy.candidate)?;
    privacy.memory.require_active()?;
    Ok(LiveViewFrameResponse {
        frame_ref,
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
            size_bytes,
            sha256,
            bytes_base64,
            source_bounds: captured.bounds.clone(),
            monitor_id: captured.monitor_id.clone(),
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
    if let Some(scope)=&lease.privacy{scope.memory.stop_epoch(scope.candidate.session_generation);}
    inner.filtered_frame.take();
    Ok(session_from_lease(&lease, "stopped", Some(now_ms())))
}

fn ensure_operational(state: &CrossDeviceState, computer: &ComputerState) -> Result<(), String> {
    if let Err(error) = computer.ensure_kill_switch_inactive() {
        if error!="NATIVE_CARRIER_STOPPED" {state.revoke_all("KILL_SWITCH_ACTIVE");}
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
        if let Some(lease)=inner.live_view.take(){if let Some(scope)=lease.privacy{scope.memory.stop_epoch(scope.candidate.session_generation);}}
    }
    if inner
        .audio_lease
        .as_ref()
        .is_some_and(|lease| lease.expires_at_ms <= now)
    {
        inner.audio_lease.take();
    }
    inner.sources.retain(|_, record| record.expires_at_ms > now);
    inner.native_pins.retain(|_,pin|pin.expires_at_ms>now);
    inner.native_commits.retain(|_,(_,expiry,_)|*expiry>now);
    if inner.filtered_frame.as_ref().is_some_and(|f|now.saturating_sub(f.observed_at_ms)>=2000)||inner.live_view.is_none(){inner.filtered_frame.take();}
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
        if let Some(mut transfer) = inner.inbound.remove(&transfer_id) {
            transfer.held_staging.take();
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
        || value.len() > 160
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':'))
    {
        return Err("CROSS_DEVICE_SAFE_ID_INVALID".into());
    }
    Ok(())
}

fn validate_file_name(value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.chars().count() > 128
        || value.trim()!=value
        || value == "."
        || value == ".."
        || value.contains(['/', '\\', ':', '*', '?', '"', '<', '>', '|'])
        || value.contains("..") || value.to_ascii_lowercase().contains("%2f") || value.to_ascii_lowercase().contains("%5c")
        || value.chars().any(char::is_control)
    {
        return Err("TRANSFER_FILE_NAME_INVALID".into());
    }
    let base=value.split('.').next().unwrap_or("").to_ascii_lowercase();
    if ["con","prn","aux","nul"].contains(&base.as_str())||((base.starts_with("com")||base.starts_with("lpt"))&&base.len()==4&&matches!(base.as_bytes()[3],b'1'..=b'9')){return Err("TRANSFER_FILE_NAME_INVALID".into());}
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

fn source_open(path: &Path) -> Result<(File, String), String> {
    for ancestor in path.ancestors() {
        let meta = fs::symlink_metadata(ancestor).map_err(|_| "TRANSFER_SOURCE_UNAVAILABLE")?;
        if meta.file_type().is_symlink() { return Err("TRANSFER_SOURCE_REPARSE_DENIED".into()); }
        #[cfg(windows)] {
            use std::os::windows::fs::MetadataExt;
            if meta.file_attributes() & 0x400 != 0 { return Err("TRANSFER_SOURCE_REPARSE_DENIED".into()); }
        }
    }
    let mut options = OpenOptions::new(); options.read(true);
    #[cfg(windows)] { use std::os::windows::fs::OpenOptionsExt; options.share_mode(1).custom_flags(0x00200000); }
    let file = options.open(path).map_err(|_| "TRANSFER_SOURCE_UNAVAILABLE")?;
    let identity = held_file_identity(&file)?;
    Ok((file, identity))
}

#[cfg(windows)]
fn held_file_identity(file: &File) -> Result<String, String> {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Storage::FileSystem::{GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION};
    let mut info = BY_HANDLE_FILE_INFORMATION::default();
    if unsafe { GetFileInformationByHandle(file.as_raw_handle(), &mut info) } == 0
        || info.nNumberOfLinks != 1 || info.dwFileAttributes & (0x400 | 0x10) != 0 {
        return Err("TRANSFER_SOURCE_IDENTITY_UNAVAILABLE".into());
    }
    Ok(sha256_bytes(serde_json::to_string(&[
        info.dwVolumeSerialNumber as u64, info.nFileIndexHigh as u64, info.nFileIndexLow as u64,
        info.ftCreationTime.dwHighDateTime as u64, info.ftCreationTime.dwLowDateTime as u64,
        info.ftLastWriteTime.dwHighDateTime as u64, info.ftLastWriteTime.dwLowDateTime as u64,
        info.nFileSizeHigh as u64, info.nFileSizeLow as u64,
    ]).map_err(|_| "TRANSFER_SOURCE_IDENTITY_UNAVAILABLE")?.as_bytes()))
}
#[cfg(not(windows))]
fn held_file_identity(_: &File) -> Result<String, String> { Err("TRANSFER_SOURCE_PLATFORM_UNSUPPORTED".into()) }

fn held_hash(file: &mut File) -> Result<String, String> {
    file.seek(SeekFrom::Start(0)).map_err(|_| "TRANSFER_SOURCE_READ_FAILED")?;
    let mut hash = Sha256::new(); let mut scratch = [0u8; MAX_CHUNK_BYTES];
    loop { let count = file.read(&mut scratch).map_err(|_| "TRANSFER_SOURCE_READ_FAILED")?;
        if count == 0 { break; } hash.update(&scratch[..count]); scratch[..count].fill(0); }
    Ok(format!("{:x}", hash.finalize()))
}

fn source_manifest(source: &SourceRecord, transfer_id: &str) -> Result<Value, String> {
    if source_open(&source.path)?.1!=source.identity{return Err("TRANSFER_SOURCE_CHANGED".into());}
    let mut file = source.held.lock().map_err(|_| "TRANSFER_SOURCE_UNAVAILABLE")?;
    if held_file_identity(&file)? != source.identity { return Err("TRANSFER_SOURCE_CHANGED".into()); }
    file.seek(SeekFrom::Start(0)).map_err(|_| "TRANSFER_SOURCE_READ_FAILED")?;
    let mut full = Sha256::new(); let mut chunks = Vec::new(); let mut offset = 0u64;
    while offset < source.size_bytes {
        let mut bytes = vec![0; MAX_CHUNK_BYTES.min((source.size_bytes-offset) as usize)];
        file.read_exact(&mut bytes).map_err(|_| "TRANSFER_SOURCE_READ_FAILED")?;
        full.update(&bytes); chunks.push(json!({"index":chunks.len(),"offsetBytes":offset,"sizeBytes":bytes.len(),"sha256":sha256_bytes(&bytes)}));
        offset += bytes.len() as u64; bytes.fill(0);
    }
    if format!("{:x}", full.finalize()) != source.sha256 || held_file_identity(&file)? != source.identity {
        return Err("TRANSFER_SOURCE_CHANGED".into());
    }
    Ok(json!({"contractVersion":2,"amendment":"2.1","transferId":transfer_id,"sizeBytes":source.size_bytes,
        "chunkSizeBytes":MAX_CHUNK_BYTES,"totalChunks":chunks.len(),"fileSha256":source.sha256,"chunks":chunks}))
}

#[cfg(windows)]
fn destination_open(path:&Path)->Result<(File,String),String>{
    use std::os::windows::fs::{MetadataExt,OpenOptionsExt};use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Storage::FileSystem::{GetFileInformationByHandle,BY_HANDLE_FILE_INFORMATION};
    for a in path.ancestors(){let m=fs::symlink_metadata(a).map_err(|_|"TRANSFER_DESTINATION_UNAVAILABLE")?;if m.file_attributes()&0x400!=0{return Err("TRANSFER_DESTINATION_REPARSE_DENIED".into());}}
    let file=OpenOptions::new().read(true).share_mode(3).custom_flags(0x02200000).open(path).map_err(|_|"TRANSFER_DESTINATION_UNAVAILABLE")?;
    let mut i=BY_HANDLE_FILE_INFORMATION::default();if unsafe{GetFileInformationByHandle(file.as_raw_handle(),&mut i)}==0||i.dwFileAttributes&0x400!=0||i.dwFileAttributes&0x10==0{return Err("TRANSFER_DESTINATION_UNAVAILABLE".into());}
    let identity=sha256_bytes(serde_json::to_vec(&[i.dwVolumeSerialNumber,i.nFileIndexHigh,i.nFileIndexLow,i.ftCreationTime.dwHighDateTime,i.ftCreationTime.dwLowDateTime]).map_err(|_|"TRANSFER_DESTINATION_UNAVAILABLE")?.as_slice());Ok((file,identity))
}
#[cfg(not(windows))]
fn destination_open(_:&Path)->Result<(File,String),String>{Err("TRANSFER_NATIVE_PLATFORM_UNSUPPORTED".into())}

fn valid_region(client:[i32;4],r:[i32;4])->bool {r[0]>=client[0]&&r[1]>=client[1]&&r[2]<=client[2]&&r[3]<=client[3]&&r[0]<r[2]&&r[1]<r[3]}
#[cfg(windows)]
fn privacy_client_rect(identity:&crate::native_calculator_identity::NativeWindowIdentity)->Result<[i32;4],String>{
    use windows_sys::Win32::{Foundation::{POINT,RECT},Graphics::Gdi::ClientToScreen,UI::WindowsAndMessaging::GetClientRect};
    crate::native_calculator_identity::revalidate(identity)?;
    privacy_window_dpi(identity.root_hwnd)?;
    let mut r=RECT::default();let mut origin=POINT::default();let hwnd=identity.root_hwnd as *mut std::ffi::c_void;
    if unsafe{GetClientRect(hwnd,&mut r)}==0||unsafe{ClientToScreen(hwnd,&mut origin)}==0||r.left!=0||r.top!=0||r.right<=0||r.bottom<=0||r.right>4096||r.bottom>4096||r.right as i64*r.bottom as i64>4_194_304{return Err("LIVE_VIEW_CLIENT_UNSUPPORTED".into());}
    Ok([origin.x,origin.y,origin.x.checked_add(r.right).ok_or("LIVE_VIEW_CLIENT_UNSUPPORTED")?,origin.y.checked_add(r.bottom).ok_or("LIVE_VIEW_CLIENT_UNSUPPORTED")?])
}
#[cfg(not(windows))]
fn privacy_client_rect(_:&crate::native_calculator_identity::NativeWindowIdentity)->Result<[i32;4],String>{Err("LIVE_VIEW_NATIVE_UNSUPPORTED".into())}
#[cfg(windows)]
fn privacy_window_dpi(hwnd:isize)->Result<u32,String>{
    use windows_sys::Win32::UI::HiDpi::{GetThreadDpiAwarenessContext,AreDpiAwarenessContextsEqual,DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,GetDpiForWindow};
    if unsafe{AreDpiAwarenessContextsEqual(GetThreadDpiAwarenessContext(),DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2)}==0{return Err("LIVE_VIEW_PHYSICAL_DPI_CONTEXT_REQUIRED".into());}
    let dpi=unsafe{GetDpiForWindow(hwnd as *mut std::ffi::c_void)};if dpi==0{return Err("LIVE_VIEW_DPI_UNKNOWN".into());}Ok(dpi)
}
#[cfg(not(windows))]
fn privacy_window_dpi(_:isize)->Result<u32,String>{Err("LIVE_VIEW_NATIVE_UNSUPPORTED".into())}
fn build_privacy_scope(computer:&ComputerState,candidate:crate::computer::RetainedCaptureCandidate,client:[i32;4],region:[i32;4],exclusions:&[[i32;4]],generation:u64)->Result<PrivacyScope,String>{
    if generation==0||exclusions.len()>64||!valid_region(client,region)||exclusions.iter().any(|r|!valid_region(client,*r)){return Err("LIVE_VIEW_REGION_INVALID".into());}
    computer.validate_capture_candidate(&candidate)?;
    let inventory=crate::native_uia::privacy_inventory(&candidate.identity,client,region,&||computer.validate_capture_candidate(&candidate))?;
    let dpi=privacy_window_dpi(candidate.identity.root_hwnd)?;
    let digest=sha256_bytes(serde_json::to_vec(&json!({"observationId":candidate.observation_id,"observationGeneration":candidate.observation_generation,"sessionId":candidate.session_id,"sessionGeneration":candidate.session_generation,"ownerBindingId":candidate.owner_binding_id,"rootHwnd":candidate.identity.root_hwnd,"rootPid":candidate.identity.root_pid,"rootCreated":candidate.identity.root_created,"rootImageDigest":sha256_bytes(candidate.identity.root_image.as_bytes()),"rootRuntimeId":inventory.root_runtime_id,"client":client,"region":region,"exclusions":exclusions,"inventoryDigest":inventory.inventory_digest})).map_err(|_|"LIVE_VIEW_SCOPE_INVALID")?.as_slice());
    let memory=Arc::new(PrivacyMemory::new(candidate.session_generation));
    Ok(PrivacyScope{candidate,client,region,exclusions:exclusions.to_vec(),inventory_digest:inventory.inventory_digest,scope_ref:format!("scope-{}",random_hex(16)?),scope_digest:digest,generation,dpi,memory})
}
#[cfg(windows)]
fn owner_approves_privacy(window:&Window,scope:&PrivacyScope)->Result<bool,String>{
    use windows_sys::Win32::UI::WindowsAndMessaging::{MessageBoxW,IDYES,MB_DEFBUTTON2,MB_ICONWARNING,MB_YESNO};
    let hwnd=window.hwnd().map_err(|_|"LIVE_VIEW_APPROVAL_UNAVAILABLE")?.0;
    let text=format!("Share ONLY the selected ordinary native window public region {:?}?\nOriginal window process: {}\nExclusion rectangles: {:?}\nPassword fields are masked. Other text in this region is public by your confirmation. No automatic secret classifier. No desktop fallback. Approval ends with the original observation or STOP.\0",scope.region,scope.candidate.identity.root_pid,scope.exclusions);
    let message:Vec<u16>=text.encode_utf16().collect();let title:Vec<u16>="E.D.I.T.H. exact public region approval\0".encode_utf16().collect();
    Ok(unsafe{MessageBoxW(hwnd,message.as_ptr(),title.as_ptr(),MB_YESNO|MB_DEFBUTTON2|MB_ICONWARNING)}==IDYES)
}
#[cfg(not(windows))]
fn owner_approves_privacy(_:&Window,_:&PrivacyScope)->Result<bool,String>{Err("LIVE_VIEW_NATIVE_UNSUPPORTED".into())}

struct ClearingBytes(Vec<u8>);
impl Drop for ClearingBytes{fn drop(&mut self){clear_owned_bytes(&mut self.0);}}
static CAPTURE_WORKER:std::sync::atomic::AtomicBool=std::sync::atomic::AtomicBool::new(false);
fn capture_private_window(computer:&ComputerState,scope:&PrivacyScope,max_width:u32,max_height:u32)->Result<CapturedFrame,String>{
    let _worker=CarrierWorker::admitted();
    scope.memory.require_active()?;
    computer.validate_capture_candidate(&scope.candidate)?;
    if privacy_client_rect(&scope.candidate.identity)?!=scope.client||privacy_window_dpi(scope.candidate.identity.root_hwnd)?!=scope.dpi{return Err("LIVE_VIEW_GEOMETRY_CHANGED".into());}
    let before=crate::native_uia::privacy_inventory(&scope.candidate.identity,scope.client,scope.region,&||computer.validate_capture_candidate(&scope.candidate))?;
    if before.inventory_digest!=scope.inventory_digest{return Err("LIVE_VIEW_INVENTORY_CHANGED".into());}
    if CAPTURE_WORKER.compare_exchange(false,true,std::sync::atomic::Ordering::SeqCst,std::sync::atomic::Ordering::SeqCst).is_err(){return Err("LIVE_VIEW_CAPTURE_BUSY".into());}
    let (tx,rx)=std::sync::mpsc::sync_channel(1);let cancel=Arc::new(std::sync::atomic::AtomicBool::new(false));let worker_cancel=cancel.clone();let hwnd=scope.candidate.identity.root_hwnd;let client=scope.client;
    let worker_memory=Arc::downgrade(&scope.memory);
    std::thread::spawn(move||{struct Release;impl Drop for Release{fn drop(&mut self){CAPTURE_WORKER.store(false,std::sync::atomic::Ordering::SeqCst);}}let _release=Release;
        let result=render_own_window(hwnd,client);if worker_cancel.load(std::sync::atomic::Ordering::SeqCst)||worker_memory.upgrade().is_none_or(|m|m.require_active().is_err()){return;}let _=tx.send(result);});
    let result=rx.recv_timeout(Duration::from_millis(1000));cancel.store(true,std::sync::atomic::Ordering::SeqCst);
    let raw=result.map_err(|_|"LIVE_VIEW_RENDER_TIMEOUT")??;
    scope.memory.require_active()?;
    computer.validate_capture_candidate(&scope.candidate)?;
    scope.memory.require_active()?;
    let after=crate::native_uia::privacy_inventory(&scope.candidate.identity,scope.client,scope.region,&||computer.validate_capture_candidate(&scope.candidate))?;
    if after.inventory_digest!=before.inventory_digest||after.password_rects!=before.password_rects||after.root_runtime_id!=before.root_runtime_id||privacy_client_rect(&scope.candidate.identity)?!=scope.client{return Err("LIVE_VIEW_SCOPE_CHANGED".into());}
    let mut masks=scope.exclusions.clone();masks.extend(after.password_rects);
    let (rgb,width,height)=crop_mask_resize(&raw.0,scope.client,scope.region,&masks,max_width,max_height)?;
    let rgb=ClearingBytes(rgb);let mut png=ClearingBytes(Vec::new());
    {let mut encoder=png::Encoder::new(&mut png.0,width,height);encoder.set_color(png::ColorType::Rgb);encoder.set_depth(png::BitDepth::Eight);let mut writer=encoder.write_header().map_err(|_|"LIVE_VIEW_ENCODE_FAILED")?;writer.write_image_data(&rgb.0).map_err(|_|"LIVE_VIEW_ENCODE_FAILED")?;writer.finish().map_err(|_|"LIVE_VIEW_ENCODE_FAILED")?;}
    if png.0.len()>48*1024{return Err("LIVE_VIEW_FRAME_BYTES_LIMIT".into());}
    computer.validate_capture_candidate(&scope.candidate)?;
    scope.memory.require_active()?;
    Ok(CapturedFrame{bytes:std::mem::take(&mut png.0),width,height,bounds:PhysicalFrameBounds{x:scope.region[0],y:scope.region[1],width:scope.region[2]-scope.region[0],height:scope.region[3]-scope.region[1],coordinate_space:"physical_virtual_desktop"},monitor_id:"selected-native-client".into(),dpi_scale:scope.dpi as f64/96.0,cursor:None})
}
fn crop_mask_resize(bgra:&[u8],client:[i32;4],region:[i32;4],masks:&[[i32;4]],max_width:u32,max_height:u32)->Result<(Vec<u8>,u32,u32),String>{
    if !valid_region(client,region)||max_width==0||max_height==0{return Err("LIVE_VIEW_REGION_INVALID".into());}
    let cw=(client[2]-client[0]) as usize;let ch=(client[3]-client[1]) as usize;
    if bgra.len()!=cw*ch*4{return Err("LIVE_VIEW_RENDER_INVALID".into());}
    let rw=(region[2]-region[0]) as u32;let rh=(region[3]-region[1]) as u32;
    // Crop/mask on original pixels BEFORE any resampling or encoding.
    let mut cropped=ClearingBytes(vec![0;rw as usize*rh as usize*3]);
    for y in 0..rh{for x in 0..rw{let sx=region[0]+x as i32;let sy=region[1]+y as i32;let dst=(y as usize*rw as usize+x as usize)*3;
        if masks.iter().any(|m|sx>=m[0]&&sx<m[2]&&sy>=m[1]&&sy<m[3]){continue;}
        let src=((sy-client[1]) as usize*cw+(sx-client[0]) as usize)*4;cropped.0[dst..dst+3].copy_from_slice(&[bgra[src+2],bgra[src+1],bgra[src]]);
    }}
    let scale=(max_width.min(1280) as f64/rw as f64).min(max_height.min(720) as f64/rh as f64).min(1.0);let width=(rw as f64*scale).floor().max(1.0) as u32;let height=(rh as f64*scale).floor().max(1.0) as u32;
    let mut rgb=vec![0;width as usize*height as usize*3];for y in 0..height{for x in 0..width{let src=((y as u64*rh as u64/height as u64) as usize*rw as usize+(x as u64*rw as u64/width as u64) as usize)*3;let dst=(y as usize*width as usize+x as usize)*3;rgb[dst..dst+3].copy_from_slice(&cropped.0[src..src+3]);}}
    Ok((rgb,width,height))
}
#[cfg(not(windows))]
fn render_own_window(_:isize,_:[i32;4])->Result<ClearingBytes,String>{Err("LIVE_VIEW_NATIVE_UNSUPPORTED".into())}
#[cfg(windows)]
fn render_own_window(hwnd:isize,client:[i32;4])->Result<ClearingBytes,String>{
    use windows_sys::Win32::{Graphics::Gdi::{GetDC,ReleaseDC,CreateCompatibleDC,CreateCompatibleBitmap,SelectObject,DeleteObject,DeleteDC,GetDIBits,PatBlt,BLACKNESS,BITMAPINFO,BI_RGB,DIB_RGB_COLORS},Storage::Xps::{PrintWindow,PW_CLIENTONLY}};
    let hwnd=hwnd as *mut std::ffi::c_void;let w=client[2]-client[0];let h=client[3]-client[1];
    privacy_window_dpi(hwnd as isize)?;
    let dc=unsafe{GetDC(hwnd)};if dc.is_null(){return Err("LIVE_VIEW_RENDER_UNAVAILABLE".into());}
    let memory=unsafe{CreateCompatibleDC(dc)};let bitmap=unsafe{CreateCompatibleBitmap(dc,w,h)};
    if memory.is_null()||bitmap.is_null(){unsafe{if !bitmap.is_null(){DeleteObject(bitmap);}if !memory.is_null(){DeleteDC(memory);}ReleaseDC(hwnd,dc);}return Err("LIVE_VIEW_RENDER_UNAVAILABLE".into());}
    let old=unsafe{SelectObject(memory,bitmap)};let cleared=unsafe{PatBlt(memory,0,0,w,h,BLACKNESS)};
    let rendered=if cleared!=0{unsafe{PrintWindow(hwnd,memory,PW_CLIENTONLY)}}else{0};unsafe{SelectObject(memory,old);}
    let mut info=BITMAPINFO::default();info.bmiHeader.biSize=std::mem::size_of_val(&info.bmiHeader) as u32;info.bmiHeader.biWidth=w;info.bmiHeader.biHeight=-h;info.bmiHeader.biPlanes=1;info.bmiHeader.biBitCount=32;info.bmiHeader.biCompression=BI_RGB;
    let mut raw=ClearingBytes(vec![0;w as usize*h as usize*4]);let lines=if rendered!=0{unsafe{GetDIBits(dc,bitmap,0,h as u32,raw.0.as_mut_ptr().cast(),&mut info,DIB_RGB_COLORS)}}else{0};
    unsafe{DeleteObject(bitmap);DeleteDC(memory);ReleaseDC(hwnd,dc);}
    if lines!=h||raw.0.chunks_exact(4).all(|p|p[..3]==raw.0[..3]){return Err("LIVE_VIEW_RENDER_BLANK_OR_UNSUPPORTED".into());}Ok(raw)
}
fn publish_filtered_frame(state:&CrossDeviceState,computer:&ComputerState,id:&str,frame_ref:&str)->Result<ProducerCommandResult,String>{
    let (lease,mut payload)={let inner=state.inner.lock().map_err(|_|"CROSS_DEVICE_STATE_UNAVAILABLE")?;let lease=inner.live_view.as_ref().ok_or("LIVE_VIEW_NOT_ACTIVE")?;let scope=lease.privacy.as_ref().ok_or("LIVE_VIEW_PRIVACY_SCOPE_REQUIRED")?;
        let frame=inner.filtered_frame.as_ref().ok_or("LIVE_VIEW_FRESH_FRAME_REQUIRED")?;
        scope.memory.require_active()?;
        if lease.live_view_id!=id||frame.frame_ref!=frame_ref||frame.scope_ref!=scope.scope_ref||now_ms().saturating_sub(frame.observed_at_ms)>2000||lease.expires_at_ms<=now_ms(){return Err("LIVE_VIEW_FRAME_STALE".into());}
        computer.validate_capture_candidate(&scope.candidate)?;
        if privacy_client_rect(&scope.candidate.identity)?!=scope.client{return Err("LIVE_VIEW_GEOMETRY_CHANGED".into());}
        let inventory=crate::native_uia::privacy_inventory(&scope.candidate.identity,scope.client,scope.region,&||computer.validate_capture_candidate(&scope.candidate))?;
        if inventory.inventory_digest!=scope.inventory_digest{return Err("LIVE_VIEW_INVENTORY_CHANGED".into());}
        let (size,digest,encoded)=frame.memory.encoded(frame_ref)?;
        (lease.clone(),json!({"schema":"edith.native-mobile/1","producerLineage":lease.lineage,"liveViewId":id,"leaseGeneration":scope.generation,"scopeRef":scope.scope_ref,"scopeDigest":scope.scope_digest,"frameId":frame.frame_ref,"sequence":frame.sequence,"observedAt":iso_ms(frame.observed_at_ms),"width":frame.width,"height":frame.height,"mediaType":"image/png","sizeBytes":size,"sha256":digest,"bytesBase64":encoded}))};
    lease.privacy.as_ref().ok_or("LIVE_VIEW_PRIVACY_SCOPE_REQUIRED")?.memory.require_active()?;
    let result=native_http(state,computer,"/live-view/frame-bytes",payload.take())?;
    let scope=lease.privacy.as_ref().ok_or("LIVE_VIEW_PRIVACY_SCOPE_REQUIRED")?;computer.validate_capture_candidate(&scope.candidate)?;
    scope.memory.require_active()?;
    if privacy_client_rect(&scope.candidate.identity)?!=scope.client{return Err("LIVE_VIEW_GEOMETRY_CHANGED".into());}
    let mut inner=state.inner.lock().map_err(|_|"CROSS_DEVICE_STATE_UNAVAILABLE")?;if !inner.live_view.as_ref().is_some_and(|l|l.live_view_id==id&&l.expires_at_ms>now_ms()){return Err("LIVE_VIEW_SCOPE_STALE".into());}inner.filtered_frame.take();Ok(result)
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
struct ClearingCapture(CapturedFrame);
impl std::ops::Deref for ClearingCapture {type Target=CapturedFrame;fn deref(&self)->&CapturedFrame{&self.0}}
impl std::ops::DerefMut for ClearingCapture {fn deref_mut(&mut self)->&mut CapturedFrame{&mut self.0}}
impl Drop for ClearingCapture {fn drop(&mut self){clear_owned_bytes(&mut self.0.bytes);}}

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
    let native_generation=computer.carrier_generation()?;
    validate_safe_id(&owner_session_binding_id)?;
    if native_lineage_from_producer(&state)?.owner_session_binding_id!=owner_session_binding_id{return Err("TRANSFER_SOURCE_OWNER_MISMATCH".into());}
    if state.inner.lock().map_err(|_|"CROSS_DEVICE_STATE_UNAVAILABLE")?.sources.len()>=4{return Err("TRANSFER_SOURCE_PIN_LIMIT".into());}
    let selected = window
        .dialog()
        .file()
        .set_title("Select a file to send to the approved mobile device")
        .blocking_pick_file()
        .ok_or("TRANSFER_SOURCE_SELECTION_CANCELLED")?
        .into_path()
        .map_err(|_| "TRANSFER_SOURCE_SELECTION_INVALID")?;
    let (mut held, identity) = source_open(&selected)?;
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
    let sha256 = held_hash(&mut held)?;
    computer.ensure_carrier_generation(native_generation)?;
    ensure_operational(&state,&computer)?;
    if native_lineage_from_producer(&state)?.owner_session_binding_id!=owner_session_binding_id{return Err("TRANSFER_SOURCE_OWNER_MISMATCH".into());}
    let handle = format!("source-{}", random_hex(16)?);
    let expires_at_ms = now_ms() + HANDLE_TTL_MS;
    let mut inner=state.inner.lock().map_err(|_|"CROSS_DEVICE_STATE_UNAVAILABLE")?;
    revoke_expired_locked(&mut inner,now_ms());
    if inner.sources.len()>=4{return Err("TRANSFER_SOURCE_PIN_LIMIT".into());}
    inner.sources        .insert(
            handle.clone(),
            SourceRecord {
                owner_session_binding_id,
                path,
                held: Arc::new(Mutex::new(held)), identity,
                native_generation:Some(native_generation),
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
    let native_generation=computer.carrier_generation()?;
    validate_safe_id(&owner_session_binding_id)?;
    if native_lineage_from_producer(&state)?.owner_session_binding_id!=owner_session_binding_id{return Err("TRANSFER_DESTINATION_OWNER_MISMATCH".into());}
    if state.inner.lock().map_err(|_|"CROSS_DEVICE_STATE_UNAVAILABLE")?.destinations.len()>=4{return Err("TRANSFER_DESTINATION_PIN_LIMIT".into());}
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
    let (directory,identity)=destination_open(&selected)?;
    computer.ensure_carrier_generation(native_generation)?;
    ensure_operational(&state,&computer)?;
    if native_lineage_from_producer(&state)?.owner_session_binding_id!=owner_session_binding_id{return Err("TRANSFER_DESTINATION_OWNER_MISMATCH".into());}
    let handle = format!("destination-{}", random_hex(16)?);
    let expires_at_ms = now_ms() + HANDLE_TTL_MS;
    let mut inner=state.inner.lock().map_err(|_|"CROSS_DEVICE_STATE_UNAVAILABLE")?;
    revoke_expired_locked(&mut inner,now_ms());
    if inner.destinations.len()>=4{return Err("TRANSFER_DESTINATION_PIN_LIMIT".into());}
    inner.destinations        .insert(
            handle.clone(),
            DestinationRecord {
                owner_session_binding_id,
                path,
                held_directory:Some(Arc::new(directory)),identity,native_generation,
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
    let (held, identity, size_bytes, file_sha256) = {
        let mut inner = state.inner.lock().map_err(|_| "CROSS_DEVICE_STATE_UNAVAILABLE")?;
        revoke_expired_locked(&mut inner, now_ms());
        let source = inner.sources.get(&request.source_handle).ok_or("TRANSFER_SOURCE_HANDLE_INVALID")?;
        if source.owner_session_binding_id != request.owner_session_binding_id { return Err("TRANSFER_SOURCE_OWNER_MISMATCH".into()); }
        if let Some(epoch)=source.native_generation{computer.ensure_carrier_generation(epoch)?;}
        if source_open(&source.path)?.1!=source.identity{return Err("TRANSFER_SOURCE_CHANGED".into());}
        (source.held.clone(),source.identity.clone(),source.size_bytes,source.sha256.clone())
    };
    if request.offset_bytes >= size_bytes || request.offset_bytes != request.chunk_index as u64 * MAX_CHUNK_BYTES as u64 {
        return Err("TRANSFER_RESUME_OFFSET_INVALID".into());
    }
    let mut file = held.lock().map_err(|_| "TRANSFER_SOURCE_UNAVAILABLE")?;
    if held_file_identity(&file)? != identity || held_hash(&mut file)? != file_sha256 { return Err("TRANSFER_SOURCE_CHANGED".into()); }
    file.seek(SeekFrom::Start(request.offset_bytes)).map_err(|_| "TRANSFER_SOURCE_READ_FAILED")?;
    let bounded = request.maximum_bytes.min(size_bytes.saturating_sub(request.offset_bytes) as usize);
    let mut bytes = vec![0_u8; bounded];
    file.read_exact(&mut bytes).map_err(|_| "TRANSFER_SOURCE_READ_FAILED")?;
    if held_file_identity(&file)? != identity { bytes.fill(0); return Err("TRANSFER_SOURCE_CHANGED".into()); }
    ensure_operational(&state,&computer)?;
    {
        let inner = state.inner.lock().map_err(|_| "CROSS_DEVICE_STATE_UNAVAILABLE")?;
        if !inner.sources.get(&request.source_handle).is_some_and(|s| s.identity == identity && s.expires_at_ms > now_ms()) {
            bytes.fill(0); return Err("TRANSFER_SOURCE_HANDLE_INVALID".into());
        }
    }
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
    if inner.inbound.len()>=4{return Err("TRANSFER_RECEIVER_PIN_LIMIT".into());}
    let destination = inner
        .destinations
        .get(&request.destination_handle)
        .ok_or("TRANSFER_DESTINATION_HANDLE_INVALID")?;
    if destination.held_directory.is_some()&&destination_open(&destination.path)?.1!=destination.identity{return Err("TRANSFER_DESTINATION_CHANGED".into());}
    computer.ensure_carrier_generation(destination.native_generation)?;
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
        held_staging: None, native_receiver: None,
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
    if inner.inbound.get(&request.transfer_id).is_some_and(|t|t.native_receiver.is_some()) {return Err("TRANSFER_NATIVE_RECEIVER_ONLY".into());}
    let epoch=inner.destinations.get(&inner.inbound.get(&request.transfer_id).ok_or("TRANSFER_NOT_FOUND")?.destination_handle).ok_or("TRANSFER_DESTINATION_HANDLE_INVALID")?.native_generation;
    write_inbox_chunk_locked(&mut inner, &request, &bytes,&||computer.ensure_carrier_generation(epoch))
}

fn write_inbox_chunk_locked(
    inner: &mut CrossDeviceInner,
    request: &InboxChunkRequest,
    bytes: &[u8],
    guard:&dyn Fn()->Result<(),String>,
) -> Result<CrossDeviceTransferSnapshot, String> {
    let _worker=CarrierWorker::admitted();
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
    if destination.held_directory.is_some()&&destination_open(&destination.path)?.1!=destination.identity{return Err("TRANSFER_DESTINATION_CHANGED".into());}
    let destination_view = DestinationRecord {
        held_directory:destination.held_directory.clone(),identity:destination.identity.clone(),
        native_generation:destination.native_generation,
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
    if transfer.held_staging.is_none() {
        guard()?;
        let mut options=OpenOptions::new();options.create_new(true).read(true).write(true);
        #[cfg(windows)] {use std::os::windows::fs::OpenOptionsExt;options.share_mode(1);}
        let staging=options.open(&transfer.partial_path).map_err(|_| "TRANSFER_INBOX_WRITE_FAILED")?;
        transfer.held_staging=Some(Arc::new(Mutex::new(staging)));
    }
    let held=transfer.held_staging.as_ref().ok_or("TRANSFER_INBOX_WRITE_FAILED")?.clone();
    let mut file=held.lock().map_err(|_| "TRANSFER_INBOX_WRITE_FAILED")?;
    file.seek(SeekFrom::Start(request.offset_bytes))
        .map_err(|_| "TRANSFER_INBOX_WRITE_FAILED")?;
    guard()?;
    file.write_all(bytes)
        .and_then(|_| file.sync_data())
        .map_err(|_| "TRANSFER_INBOX_WRITE_FAILED")?;
    transfer.acknowledged_bytes += bytes.len() as u64;
    transfer.completed_chunks.push(request.chunk_index);
    transfer.updated_at_ms = now_ms();
    guard()?;
    if transfer.acknowledged_bytes < transfer.expected_size {
        return Ok(transfer_snapshot(
            transfer,
            &destination_view,
            "transferring",
            "pending",
        ));
    }
    if held_hash(&mut file)? != transfer.expected_sha256 {
        let _ = fs::remove_file(&transfer.partial_path);
        transfer.expires_at_ms = 0;
        return Err("TRANSFER_INTEGRITY_FAILED".into());
    }
    if transfer.final_path.exists() {
        let _ = fs::remove_file(&transfer.partial_path);
        transfer.expires_at_ms = 0;
        return Err("TRANSFER_DESTINATION_COLLISION".into());
    }
    file.seek(SeekFrom::Start(0)).map_err(|_|"TRANSFER_INBOX_FINALIZE_FAILED")?;
    guard()?;
    let mut final_file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .read(true)
        .open(&transfer.final_path)
        .map_err(|_| "TRANSFER_DESTINATION_COLLISION")?;
    if std::io::copy(&mut *file, &mut final_file).is_err() || final_file.sync_all().is_err() {
        let _ = fs::remove_file(&transfer.final_path);
        return Err("TRANSFER_INBOX_FINALIZE_FAILED".into());
    }
    guard()?;
    if held_hash(&mut final_file)?!=transfer.expected_sha256 {return Err("TRANSFER_INTEGRITY_FAILED".into());}
    drop(file);drop(held);transfer.held_staging.take();
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
            privacy: None,
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
            producer_transport:Arc::new(Mutex::new(())),
            inner: Arc::new(Mutex::new(CrossDeviceInner {
                producer: Some(producer_session()),
                ..CrossDeviceInner::default()
            })),
            bridge: Arc::new(Mutex::new(Some(ProducerBridge {
                token: "bridge-token-kept-native-and-never-returned".into(),
                port,
            }))),
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
            producer_transport:Arc::new(Mutex::new(())),
            inner: Arc::new(Mutex::new(CrossDeviceInner {
                producer: Some(producer_session()),
                ..CrossDeviceInner::default()
            })),
            bridge: Arc::new(Mutex::new(None)),
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
        held_staging: None, native_receiver: None,
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
            held_directory:None,identity:String::new(),native_generation:0,
            owner_session_binding_id: "owner-test".into(),
            path: directory.clone(),
            kind: "approved_folder".into(),
            display_summary: "Owner-approved folder".into(),
            expires_at_ms: now_ms() + 60_000,
        };
        let transfer = InboundTransfer {
        held_staging: None, native_receiver: None,
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
        let snapshot = write_inbox_chunk_locked(&mut inner, &request, payload,&||Ok(())).expect("write");
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
        held_staging: None, native_receiver: None,
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
            match write_inbox_chunk_locked(&mut inner, &collision_request, payload,&||Ok(())) {
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
        held_staging: None, native_receiver: None,
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
    fn native_public_region_crop_masks_before_downsample_and_excludes_exterior() {
        let mut pixels=vec![0u8;4*2*4];for (index,p) in pixels.chunks_exact_mut(4).enumerate(){p.copy_from_slice(&[index as u8,20,40,255]);}
        let (rgb,w,h)=crop_mask_resize(&pixels,[10,20,14,22],[11,20,13,22],&[[11,20,12,22]],2,2).unwrap();
        assert_eq!((w,h),(2,2));assert_eq!(&rgb[..3],&[0,0,0]);assert_eq!(&rgb[3..6],&[40,20,2]);assert_eq!(&rgb[6..9],&[0,0,0]);assert_eq!(&rgb[9..12],&[40,20,6]);
        let (scaled,w,h)=crop_mask_resize(&pixels,[10,20,14,22],[11,20,13,22],&[[11,20,12,22]],1,1).unwrap();assert_eq!((w,h),(1,1));assert_eq!(scaled,vec![0,0,0]);
    }
    #[test]
    fn native_public_region_wrong_size_or_outside_denies() {
        assert!(crop_mask_resize(&[0;16],[0,0,2,2],[-1,0,2,2],&[],2,2).is_err());
        assert!(crop_mask_resize(&[0;15],[0,0,2,2],[0,0,2,2],&[],2,2).is_err());
        assert!(crop_mask_resize(&[0;16],[0,0,2,2],[0,0,2,2],&[],0,2).is_err());
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

#[cfg(test)]
mod privacy_memory_tests {
    use super::{clear_owned_bytes,PrivacyMemory};
    use std::sync::{Arc,atomic::Ordering};
    #[test]
    fn original_epoch_stop_clears_and_denies_late_frame() {
        let memory=PrivacyMemory::new(0);
        memory.install("old".into(),vec![1,2,3]).unwrap();
        memory.stop_epoch(1);
        assert!(memory.require_active().is_ok());
        assert_eq!(memory.pixels.lock().unwrap().as_ref().unwrap().bytes,vec![1,2,3]);
        memory.stop_epoch(0);
        assert!(memory.pixels.lock().unwrap().is_none());
        assert!(memory.install("late".into(),vec![4,5,6]).is_err());
        assert!(memory.require_active().is_err());
    }
    #[test]
    fn original_callback_does_not_clear_new_epoch_or_replacement_frame() {
        let old=Arc::new(PrivacyMemory::new(4));let weak=Arc::downgrade(&old);
        let new=PrivacyMemory::new(5);new.install("new".into(),vec![9]).unwrap();
        weak.upgrade().unwrap().stop_epoch(4);new.stop_epoch(4);
        assert!(new.require_active().is_ok());
        new.clear_frame("old");assert!(new.pixels.lock().unwrap().is_some());
        new.install("replacement".into(),vec![8]).unwrap();new.clear_frame("new");
        assert_eq!(new.pixels.lock().unwrap().as_ref().unwrap().frame_ref,"replacement");
        drop(old);assert!(weak.upgrade().is_none());
    }
    #[test]
    fn latch_precedes_pixel_lock_and_clear_is_actual() {
        let memory=Arc::new(PrivacyMemory::new(7));memory.install("held".into(),vec![7]).unwrap();
        let pixels=memory.pixels.lock().unwrap();let worker=memory.clone();
        let join=std::thread::spawn(move||worker.stop_epoch(7));
        let deadline=std::time::Instant::now()+std::time::Duration::from_secs(1);
        while memory.active.load(Ordering::SeqCst)&&std::time::Instant::now()<deadline {std::thread::yield_now();}
        let latched=!memory.active.load(Ordering::SeqCst);drop(pixels);join.join().unwrap();
        assert!(latched);assert!(memory.pixels.lock().unwrap().is_none());
        let mut bytes=[1,2,3];clear_owned_bytes(&mut bytes);assert_eq!(bytes,[0,0,0]);
    }
}
