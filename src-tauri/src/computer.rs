use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::State;

const SESSION_TTL: Duration = Duration::from_secs(300);
const OBSERVATION_TTL: Duration = Duration::from_secs(15);
type CarrierStopHook=Arc<dyn Fn(u64)+Send+Sync>;
struct CarrierStopHookRegistry{entries:Mutex<Vec<(u64,CarrierStopHook)>>,active_cleanup:AtomicU64,
    lifecycle:Mutex<Option<NativeTermination>>,safety:Arc<Mutex<Option<NativeSafetySession>>>,cleanup_fault:AtomicBool}
struct NativeTermination{original:NativeSafetySession,complete:bool,fault:bool,busy:bool}
type CarrierStopHooks=Arc<CarrierStopHookRegistry>;
struct NativeCleanupPending<'a>(&'a AtomicU64);
impl<'a> NativeCleanupPending<'a>{fn new(counter:&'a AtomicU64)->Self{counter.fetch_add(1,Ordering::SeqCst);Self(counter)}}
impl Drop for NativeCleanupPending<'_>{fn drop(&mut self){self.0.fetch_sub(1,Ordering::SeqCst);}}
fn native_cleanup_epoch(hooks:&CarrierStopHooks,epoch:u64){
    let admission=(||{
        let mut life=hooks.lifecycle.lock().ok()?;
        let scope=hooks.safety.lock().ok()?;
        let scope=scope.as_ref().filter(|s|s.original_generation==epoch)?;
        if life.as_ref().is_some_and(|t|!same_safety_scope(&t.original,scope)){return None;}
        let mut entries=match hooks.entries.lock(){Ok(entries)=>entries,Err(_)=>{
            if let Some(t)=life.as_mut(){t.fault=true;t.complete=false;}return None;
        }};let mut callbacks=Vec::new();
        entries.retain(|(original,hook)|{if *original==epoch{callbacks.push(Arc::clone(hook));false}else{true}});
        if callbacks.is_empty(){return None;}
        let pending=NativeCleanupPending::new(&hooks.active_cleanup);
        Some((pending,callbacks))
    })();
    let Some((_pending,callbacks))=admission else{return;};
    for callback in callbacks{
        if std::panic::catch_unwind(std::panic::AssertUnwindSafe(||callback(epoch))).is_err(){
            if let Ok(mut life)=hooks.lifecycle.lock(){if let Some(t)=life.as_mut().filter(|t|t.original.original_generation==epoch){t.fault=true;t.complete=false;}}
            // A failed hook remains retryable; counter zero alone never clears its fence.
            if let Ok(mut entries)=hooks.entries.lock(){entries.push((epoch,callback));}
        }
    }
}

#[derive(Clone)]
struct SafetyBridge {
    token: String,
    port: u16,
    safety: Arc<Mutex<Option<NativeSafetySession>>>,
    stop_hooks:CarrierStopHooks,
}

#[derive(Clone)]
struct NativeSafetySession {
    safety_session_ref: String, native_session_id: String, owner_binding_id: String,
    original_generation: u64, expires_at_ms: u64, stop_request: Option<serde_json::Value>,
    latch: Option<NativeStopFact>,
    native_boot_nonce:String, retired:bool, quiescent_at:Option<String>,
}
#[derive(Clone)]
struct NativeStopFact { original_generation:u64, latched_generation:u64, observed_at:String }
fn advance_stop_generation(generation:&AtomicU64)->Option<u64>{generation.fetch_update(Ordering::SeqCst,Ordering::SeqCst,|g|g.checked_add(1)).ok()}

#[derive(Clone)]
pub(crate) struct RetainedCaptureCandidate {
    pub identity: crate::native_calculator_identity::NativeWindowIdentity,
    pub observation_id:String, pub observation_generation:u64, pub session_id:String,
    pub session_generation:u64, pub expires_at_ms:u64, pub window_bounds:PhysicalBounds,
    pub owner_binding_id:String,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeFileSource {
    operation_id: String,
    file_id: String,
    owner_binding_id: String,
    absolute_path: String,
    canonical_path: String,
    content_sha256: String,
}
fn native_file_response(response:reqwest::blocking::Response)->Result<serde_json::Value,String>{
    use std::io::Read;
    let mut bytes=Vec::new();response.take(75001).read_to_end(&mut bytes).map_err(|_|"Native file response unreadable")?;
    if bytes.len()>75000{return Err("Native file response oversized".into());}
    serde_json::from_slice(&bytes).map_err(|_|"Native file response invalid".into())
}

#[tauri::command]
pub async fn computer_file_open_pending(state: State<'_, ComputerState>, app:tauri::AppHandle, session_id: String) -> Result<bool, String> {
    if workflow_context(&state,&session_id,None).is_err(){return Ok(false);}
    require_session(&state, &session_id)?;
    check_kill_switch(&state)?;
    let bridge = safety_bridge(&state)?;
    let epoch = state.session_generation.load(Ordering::SeqCst);
    let expires = state.session.lock().map_err(|_| "Computer state unavailable")?.as_ref().ok_or("Session missing")?.expires_at;
    let stopped = Arc::clone(&state.stopped);
    let generation = Arc::clone(&state.session_generation);
    let reservations=Arc::clone(&state.workflow_reservation);
    let dispatch=Arc::clone(&state.action_dispatch);
    tauri::async_runtime::spawn_blocking(move || {
        let Ok(_dispatch)=dispatch.try_lock()else{return Ok(false);};
        let client = reqwest::blocking::Client::builder().no_proxy().redirect(reqwest::redirect::Policy::none()).timeout(Duration::from_secs(3)).build().map_err(|_| "Native transport unavailable")?;
        let base = format!("http://127.0.0.1:{}/api/computer-use/native-files", bridge.port);
        let guard = || -> Result<(),String> {
            workflow_access(&reservations,epoch,&session_id,None)?;
            if stopped.load(Ordering::SeqCst) || generation.load(Ordering::SeqCst)!=epoch || SystemTime::now()>=expires { return Err("Native file operation cancelled".into()); }
            check_kill_switch_bridge(&bridge)?;
            if stopped.load(Ordering::SeqCst) || generation.load(Ordering::SeqCst)!=epoch { return Err("Native file operation cancelled".into()); }
            workflow_access(&reservations,epoch,&session_id,None)?;
            Ok(())
        };
        guard()?;
        let next=native_file_response(client.get(format!("{base}/next")).bearer_auth(&bridge.token).send().and_then(|r|r.error_for_status()).map_err(|_| "Native file poll failed")?)?;
        let Some(operation) = next.get("job").and_then(|job|job.get("operationId")).and_then(|id|id.as_str()) else { return Ok(false); };
        if operation.len()>80 || !operation.chars().all(|ch|ch.is_ascii_hexdigit()||ch=='-') { return Err("Invalid native operation identity".into()); }
        let result = (|| -> Result<serde_json::Value,String> {
            guard()?;
            let response=native_file_response(client.get(format!("{base}/{operation}/source")).bearer_auth(&bridge.token).send().and_then(|r|r.error_for_status()).map_err(|_| "Native source authorization failed")?)?;
            guard()?;
            if next["job"]["operation"]==serde_json::json!("transfer_pin"){
                use tauri::Manager;
                let source=response.get("source").ok_or("Native pin source missing")?;
                if source["operation"]!="transfer_pin"||source["operationId"]!=operation
                    ||source["claimNonce"]!=next["job"]["claimNonce"]||source["claimNonce"].as_str().is_none_or(|s|s.is_empty()){
                    return Err("Native transfer pin claim mismatch".into());
                }
                let computer=app.state::<ComputerState>();
                let carrier=app.state::<crate::cross_device::CrossDeviceState>();
                let pin=crate::cross_device::pin_native_files_source(&carrier,&computer,source,epoch,&guard)?;
                guard()?;
                if pin["contentSha256"]!=source["contentSha256"]{return Err("Native pinned file SHA changed".into());}
                return Ok(serde_json::json!({"operation":"transfer_pin","operationId":source["operationId"],
                    "fileId":source["fileId"],"ownerBindingId":source["ownerBindingId"],"transferId":source["transferId"],
                    "targetDeviceId":source["targetDeviceId"],"claimNonce":source["claimNonce"],
                    "sourceIdentityDigest":source["sourceIdentityDigest"],"source":"native_operator",
                    "sourceHandle":pin["sourceHandle"],"contentSha256":pin["contentSha256"],"sourceManifest":pin["sourceManifest"]}));
            }
            if next["job"].get("operation").is_some(){return Err("Unknown native file job denied".into());}
            let source: NativeFileSource = serde_json::from_value(response.get("source").cloned().ok_or("Native source missing")?).map_err(|_| "Native source descriptor invalid")?;
            if source.operation_id!=operation { return Err("Native source identity mismatch".into()); }
            guard()?;
            let pid = platform::open_file_verified(&source,&guard)?;
            guard()?;
            // Backend performs another owner/kill/containment/source check before
            // settling the public request. Neither paths nor caller receipts enter it.
            Ok(serde_json::json!({"operationId":source.operation_id,"fileId":source.file_id,"ownerBindingId":source.owner_binding_id,"source":"native_operator","openedProcessId":pid,"verifiedProcessId":pid,"contentSha256":source.content_sha256,"postcondition":"same_file_opened"}))
        })();
        let body = match &result { Ok(receipt)=>serde_json::json!({"receipt":receipt}),Err(_)=>serde_json::json!({"receipt":null}) };
        let posted = client.post(format!("{base}/{operation}/receipt")).bearer_auth(&bridge.token).json(&body).send().and_then(|r|r.error_for_status());
        result?;
        posted.map_err(|_| "Native file receipt rejected")?;
        Ok(true)
    }).await.map_err(|_| "Native file worker failed".to_string())?
}

pub struct ComputerState {
    session: Mutex<Option<ComputerSession>>,
    stopped: Arc<AtomicBool>,
    bridge: Mutex<Option<SafetyBridge>>,
    native_safety: Arc<Mutex<Option<NativeSafetySession>>>,
    native_boot_nonce: String,
    carrier_stop_hooks:CarrierStopHooks,
    observation_generation: Arc<AtomicU64>,
    session_generation: Arc<AtomicU64>,
    last_observation: Mutex<Option<ObservationContext>>,
    overlay: Mutex<Option<crate::native_overlay::OverlayHandle>>,
    last_image: Mutex<Option<(u64,String)>>,
    uia_ready: AtomicBool,
    ocr_ready: AtomicBool,
    ocr_targets: Arc<Mutex<crate::native_ocr_targets::Registry>>,
    action_ledger: Arc<Mutex<Vec<NativeActionEntry>>>,
    action_dispatch:Arc<Mutex<()>>,
    workflow_ledger: Arc<Mutex<Vec<NativeWorkflowEntry>>>,
    explorer_claims: Arc<Mutex<Vec<NativeExplorerClaim>>>,
    workflow_reservation: Arc<Mutex<Option<NativeWorkflowReservation>>>,
    // N1-private only. No renderer command or generic input path reads this registry.
    browser_foundation: Arc<crate::native_browser_control::Foundation>,
    browser_controller: Arc<crate::native_browser_control::Controller>,
    browser_reservation_incarnation: AtomicU64,
}

struct NativeActionEntry {key:String,binding:String,expires_at:SystemTime,result:Option<Result<ActionResult,String>>,
    session_id:String,explorer_operation_id:Option<String>,workflow_id:Option<String>,issued_at:SystemTime,action_id:String,action:String,keys:Option<Vec<String>>}
struct NativeWorkflowEntry { key:String, binding:String, expires_at:SystemTime, result:Option<Result<serde_json::Value,String>> }
#[derive(Clone)]
struct NativeExplorerClaim {session_id:String,operation_id:String,operation:String,reverse_of:Option<String>,
    destination_path:String,workflow_id:String,epoch:u64,claimed_at:SystemTime,expires_at:u64}
struct NativeWorkflowReservation {session_id:String,workflow_id:String,epoch:u64,expires_at:u64,requested_deadline:u64,browser_incarnation:u64}

impl Default for ComputerState {
    fn default() -> Self {
        let browser_foundation = Arc::new(crate::native_browser_control::Foundation::default());
        let browser_controller = Arc::new(crate::native_browser_control::Controller::new(Arc::clone(&browser_foundation)));
        let native_safety=Arc::new(Mutex::new(None));
        let carrier_stop_hooks=Arc::new(CarrierStopHookRegistry{entries:Mutex::new(Vec::new()),active_cleanup:AtomicU64::new(0),lifecycle:Mutex::new(None),cleanup_fault:AtomicBool::new(false),safety:Arc::clone(&native_safety)});
        let bridge = std::env::var("EDITH_DESKTOP_BRIDGE_TOKEN")
            .ok()
            .filter(|value| value.len() >= 32)
            .map(|token| SafetyBridge { token, port: 3000, safety:Arc::clone(&native_safety),stop_hooks:Arc::clone(&carrier_stop_hooks) });
        Self {
            session: Mutex::new(None),
            stopped: Arc::new(AtomicBool::new(false)),
            bridge: Mutex::new(bridge),
            native_safety,
            carrier_stop_hooks,
            native_boot_nonce:{let mut bytes=[0u8;16];if getrandom::fill(&mut bytes).is_ok(){format!("native-boot-{:032x}",u128::from_le_bytes(bytes))}else{String::new()}},
            observation_generation: Arc::new(AtomicU64::new(0)),
            session_generation: Arc::new(AtomicU64::new(0)),
            last_observation: Mutex::new(None),
            overlay: Mutex::new(None),
            last_image: Mutex::new(None),
            uia_ready: AtomicBool::new(false),
            ocr_ready: AtomicBool::new(false),
            ocr_targets: Arc::new(Mutex::new(crate::native_ocr_targets::Registry::default())),
            action_ledger: Arc::new(Mutex::new(Vec::new())),
            action_dispatch:Arc::new(Mutex::new(())),
            workflow_ledger: Arc::new(Mutex::new(Vec::new())),
            explorer_claims: Arc::new(Mutex::new(Vec::new())),
            workflow_reservation: Arc::new(Mutex::new(None)),
            browser_foundation,
            browser_controller,
            browser_reservation_incarnation: AtomicU64::new(0),
        }
    }
}

impl ComputerState {
    pub(crate) fn register_carrier_stop_hook(&self,epoch:u64,hook:CarrierStopHook)->Result<(),String>{
        let _life=self.carrier_stop_hooks.lifecycle.lock().map_err(|_|"NATIVE_STOP_HOOK_UNAVAILABLE")?;
        let scope=self.native_safety.lock().map_err(|_|"NATIVE_STOP_HOOK_UNAVAILABLE")?;
        if scope.as_ref().is_none_or(|s|s.original_generation!=epoch||s.latch.is_some()||s.retired){return Err("NATIVE_STOP_HOOK_STALE".into());}
        let mut entries=self.carrier_stop_hooks.entries.lock().map_err(|_|"NATIVE_STOP_HOOK_UNAVAILABLE")?;
        if self.stopped.load(Ordering::SeqCst)||self.session_generation.load(Ordering::SeqCst)!=epoch{return Err("NATIVE_STOP_HOOK_STALE".into());}
        if entries.len()>=4{return Err("NATIVE_STOP_HOOK_LIMIT".into());}
        entries.push((epoch,hook));Ok(())
    }
    pub(crate) fn retained_capture_candidate(&self, observation_id:&str, observation_generation:u64)->Result<RetainedCaptureCandidate,String>{
        check_kill_switch(self)?;
        let epoch=self.session_generation.load(Ordering::SeqCst);
        let (session_id,session_expiry)={let session=self.session.lock().map_err(|_|"CAPTURE_SESSION_UNAVAILABLE")?;
            let session=session.as_ref().ok_or("CAPTURE_SESSION_REQUIRED")?;
            (session.id.clone(),session.expires_at.duration_since(UNIX_EPOCH).map_err(|_|"CAPTURE_EXPIRY_INVALID")?.as_millis() as u64)};
        let observation=self.last_observation.lock().map_err(|_|"CAPTURE_OBSERVATION_UNAVAILABLE")?.clone().ok_or("CAPTURE_OBSERVATION_REQUIRED")?;
        if self.stopped.load(Ordering::SeqCst)||self.observation_generation.load(Ordering::SeqCst)!=observation_generation
            ||observation.generation!=observation_generation||observation.observation_id!=observation_id
            ||now_ms()>=observation.expires_at.min(session_expiry){return Err("CAPTURE_SCOPE_STALE".into());}
        platform::validate_foreground(&observation)?;
        let identity=observation.native_identity.as_ref().ok_or("CAPTURE_ROOT_IDENTITY_REQUIRED")?.clone();
        crate::native_calculator_identity::revalidate(&identity)?;
        if identity.content.is_some(){return Err("CAPTURE_SINGLE_ROOT_REQUIRED".into());}
        let (owner_binding_id,safety_expiry)={let scope=self.native_safety.lock().map_err(|_|"CAPTURE_SAFETY_UNAVAILABLE")?;
            let scope=scope.as_ref().ok_or("CAPTURE_SAFETY_REQUIRED")?;
            if scope.native_session_id!=session_id||scope.original_generation!=epoch||scope.latch.is_some()||now_ms()>=scope.expires_at_ms{return Err("CAPTURE_SAFETY_CHANGED".into());}
            (scope.owner_binding_id.clone(),scope.expires_at_ms)};
        let result=RetainedCaptureCandidate{identity,observation_id:observation_id.into(),observation_generation,
            session_id,session_generation:epoch,expires_at_ms:observation.expires_at.min(session_expiry).min(safety_expiry),window_bounds:observation.window_bounds,owner_binding_id};
        self.validate_capture_candidate(&result)?;Ok(result)
    }
    pub(crate) fn validate_capture_candidate(&self,candidate:&RetainedCaptureCandidate)->Result<(),String>{
        if self.stopped.load(Ordering::SeqCst)||self.session_generation.load(Ordering::SeqCst)!=candidate.session_generation
            ||self.observation_generation.load(Ordering::SeqCst)!=candidate.observation_generation||now_ms()>=candidate.expires_at_ms{return Err("CAPTURE_SCOPE_REVOKED".into());}
        let session=self.session.lock().map_err(|_|"CAPTURE_SESSION_UNAVAILABLE")?;
        if session.as_ref().is_none_or(|s|s.id!=candidate.session_id||SystemTime::now()>=s.expires_at){return Err("CAPTURE_SESSION_CHANGED".into());}
        drop(session);
        {let scope=self.native_safety.lock().map_err(|_|"CAPTURE_SAFETY_UNAVAILABLE")?;
            if scope.as_ref().is_none_or(|s|s.native_session_id!=candidate.session_id||s.original_generation!=candidate.session_generation
                ||s.owner_binding_id!=candidate.owner_binding_id||s.latch.is_some()||now_ms()>=s.expires_at_ms){return Err("CAPTURE_SAFETY_CHANGED".into());}}
        let observation=self.last_observation.lock().map_err(|_|"CAPTURE_OBSERVATION_UNAVAILABLE")?.clone().ok_or("CAPTURE_OBSERVATION_REQUIRED")?;
        if observation.observation_id!=candidate.observation_id||observation.generation!=candidate.observation_generation
            ||observation.native_identity.as_ref()!=Some(&candidate.identity){return Err("CAPTURE_ROOT_CHANGED".into());}
        platform::validate_foreground(&observation)?;
        crate::native_calculator_identity::revalidate(&candidate.identity)?;
        if self.stopped.load(Ordering::SeqCst)||self.session_generation.load(Ordering::SeqCst)!=candidate.session_generation{return Err("CAPTURE_SCOPE_REVOKED".into());}
        Ok(())
    }
    #[cfg(not(debug_assertions))]
    pub fn configure_bridge(&self, token: String, port: u16) {
        // Reset BEFORE replacement, even an invalid replacement. Entropy failure
        // disables only N1; it does not change existing generic bridge behavior.
        let _ = self.browser_foundation.reset_boot();
        if token.len() >= 32 && port > 0 {
            if let Ok(mut bridge) = self.bridge.lock() {
                *bridge = Some(SafetyBridge { token, port, safety:Arc::clone(&self.native_safety),stop_hooks:Arc::clone(&self.carrier_stop_hooks) });
            } else {
                let _ = self.browser_foundation.disable_boot();
            }
        } else {
            let _ = self.browser_foundation.disable_boot();
        }
    }

    pub fn clear_bridge(&self) {
        // This outer fence spans transport reset as well as global local cleanup.
        let _cleanup=NativeCleanupPending::new(&self.carrier_stop_hooks.active_cleanup);
        let mut failed=computer_stop_legacy(self).is_err();
        failed|=self.browser_foundation.reset_boot().is_err();failed|=self.browser_foundation.disable_boot().is_err();
        match self.bridge.lock(){Ok(mut bridge)=>{bridge.take();},Err(_)=>failed=true}
        if failed{self.carrier_stop_hooks.cleanup_fault.store(true,Ordering::SeqCst);}
    }
    pub(crate) fn ensure_kill_switch_inactive(&self) -> Result<(), String> {
        if self.stopped.load(Ordering::SeqCst)||self.carrier_stop_hooks.active_cleanup.load(Ordering::SeqCst)!=0{return Err("NATIVE_CARRIER_STOPPED".into());}
        check_kill_switch(self)?;
        if self.stopped.load(Ordering::SeqCst)||self.carrier_stop_hooks.active_cleanup.load(Ordering::SeqCst)!=0{return Err("NATIVE_CARRIER_STOPPED".into());}
        Ok(())
    }
    pub(crate) fn ensure_carrier_generation(&self,epoch:u64)->Result<(),String>{
        if self.session_generation.load(Ordering::SeqCst)!=epoch{return Err("NATIVE_CARRIER_GENERATION_CHANGED".into());}
        self.ensure_kill_switch_inactive()?;
        if self.session_generation.load(Ordering::SeqCst)!=epoch{return Err("NATIVE_CARRIER_GENERATION_CHANGED".into());}
        Ok(())
    }
    pub(crate) fn carrier_generation(&self)->Result<u64,String>{
        let epoch=self.session_generation.load(Ordering::SeqCst);
        self.ensure_carrier_generation(epoch)?;
        Ok(epoch)
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

    // Local facts only: NOT an original owner consent, map or dispatch issuer.
    // The future private driver must resolve the actual original source first.
    pub(crate) fn browser_host_snapshot(&self, session_id: &str, original_task_ref: &str, operation_ref: &str)
        -> Result<crate::native_browser_control::HostSnapshot, String>
    {
        let boot = self.browser_foundation.boot_epoch();
        let _bridge = safety_bridge(self)?;
        let scope = self.browser_foundation.scope_epoch();
        let epoch = self.session_generation.load(Ordering::SeqCst);
        require_session(self, session_id)?;
        let session_expiry = {
            let session = self.session.lock().map_err(|_| "N1 local session unavailable")?;
            let session = session.as_ref().ok_or("N1 local session missing")?;
            if session.id != session_id { return Err("N1 local session mismatch".into()); }
            session.expires_at.duration_since(UNIX_EPOCH)
                .map_err(|_| "N1 local expiry invalid")?.as_millis() as u64
        };
        let (incarnation, reservation_expiry) = {
            let slot = self.workflow_reservation.lock().map_err(|_| "N1 reservation unavailable")?;
            let row = slot.as_ref().ok_or("N1 reservation missing")?;
            if row.session_id != session_id || row.workflow_id != original_task_ref || row.epoch != epoch {
                return Err("N1 reservation identity mismatch".into());
            }
            (row.browser_incarnation, row.expires_at)
        };
        let now = now_ms();
        if self.stopped.load(Ordering::SeqCst) || self.session_generation.load(Ordering::SeqCst) != epoch
            || self.browser_reservation_incarnation.load(Ordering::SeqCst) != incarnation
            || self.browser_foundation.boot_epoch() != boot || self.browser_foundation.scope_epoch() != scope
            || now >= session_expiry.min(reservation_expiry)
        { return Err("N1 local scope cancelled or expired".into()); }
        let snapshot = crate::native_browser_control::HostSnapshot::new(
            boot, scope, epoch, incarnation, session_id.to_string(), operation_ref.to_string(),
            session_expiry.min(reservation_expiry), false,
        ).map_err(|_| "N1 host snapshot unavailable")?;
        self.browser_foundation.validate_host(&snapshot, now)
            .map_err(|_| "N1 private controller admission pending or stale")?;
        Ok(snapshot)
    }

    pub(crate) fn browser_dispatch_lock(&self) -> Result<std::sync::MutexGuard<'_, ()>, String> {
        self.action_dispatch.try_lock().map_err(|_| "N1 native dispatcher busy".into())
    }

    pub(crate) fn browser_controller(&self) -> Arc<crate::native_browser_control::Controller> {
        Arc::clone(&self.browser_controller)
    }

    pub(crate) fn browser_private_bridge(&self, managed_port: u16) -> Result<crate::native_browser_control::PrivateBridge, crate::native_browser_control::ControllerError> {
        let bridge = safety_bridge(self).map_err(|_| crate::native_browser_control::ControllerError::HostUnavailable)?;
        if managed_port == 0 || bridge.port != managed_port { return Err(crate::native_browser_control::ControllerError::HostUnavailable); }
        crate::native_browser_control::PrivateBridge::new(bridge.token, bridge.port)
    }

    // Captures existing local facts only. The private controller must join the
    // captured reservation to the authentic original source, never a lookup alias.
    pub(crate) fn browser_local_facts(&self, session_id: &str, _operation_ref: Option<&str>)
        -> Result<crate::native_browser_control::BrowserLocalFacts, crate::native_browser_control::ControllerError>
    {
        use crate::native_browser_control::{BrowserLocalFacts, ControllerError};
        let boot = self.browser_foundation.boot_epoch();
        let scope = self.browser_foundation.scope_epoch();
        let generation = self.session_generation.load(Ordering::SeqCst);
        require_session(self, session_id).map_err(|_| ControllerError::HostUnavailable)?;
        let expiry = {
            let slot = self.session.lock().map_err(|_| ControllerError::HostUnavailable)?;
            let session = slot.as_ref().ok_or(ControllerError::HostUnavailable)?;
            if session.id != session_id { return Err(ControllerError::HostUnavailable); }
            session.expires_at.duration_since(UNIX_EPOCH).map_err(|_| ControllerError::HostUnavailable)?.as_millis() as u64
        };
        let (reservation_id, incarnation, reservation_expiry) = {
            let slot = self.workflow_reservation.lock().map_err(|_| ControllerError::HostUnavailable)?;
            let reservation = slot.as_ref().ok_or(ControllerError::HostUnavailable)?;
            if reservation.session_id != session_id || reservation.epoch != generation {
                return Err(ControllerError::HostUnavailable);
            }
            (reservation.workflow_id.clone(), reservation.browser_incarnation, reservation.expires_at)
        };
        if self.stopped.load(Ordering::SeqCst) || self.session_generation.load(Ordering::SeqCst) != generation
            || self.browser_reservation_incarnation.load(Ordering::SeqCst) != incarnation
            || self.browser_foundation.boot_epoch() != boot || self.browser_foundation.scope_epoch() != scope
            || now_ms() >= expiry.min(reservation_expiry)
        { return Err(ControllerError::HostUnavailable); }
        BrowserLocalFacts::new(boot, scope, generation, incarnation, session_id.to_owned(),
            Some(reservation_id), expiry, Some(reservation_expiry), false)
    }

    fn browser_reservation_changed(&self) -> u64 {
        let next = self.browser_reservation_incarnation.fetch_update(
            Ordering::SeqCst, Ordering::SeqCst, |value| value.checked_add(1),
        );
        let _ = self.browser_foundation.invalidate_scope();
        match next {
            Ok(previous) => previous + 1,
            Err(_) => {
                // Never wrap an incarnation back into an old native capability.
                let _ = self.browser_foundation.reset_boot();
                u64::MAX
            }
        }
    }
}

struct ComputerSession {
    id: String,
    expires_at: SystemTime,
}

#[derive(Clone, Debug)]
struct ObservationContext {
    native_identity: Option<crate::native_calculator_identity::NativeWindowIdentity>,
    observation_id: String,
    generation: u64,
    captured_at: u64,
    expires_at: u64,
    window_id: String,
    window_process_id: u32,
    monitor_id: String,
    scale_factor: f64,
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
pub struct ComputerMonitor {
    pub id: String,
    pub bounds: PhysicalBounds,
    pub primary: bool,
    pub active: bool,
    // Only the active HWND supplies measured DPI. Other monitors are unknown,
    // rather than being assigned its DPI or an invented 1.0 scale.
    pub dpi_scale: Option<f64>,
}

#[tauri::command]
pub fn computer_monitors(state: State<'_, ComputerState>, session_id: String) -> Result<Vec<ComputerMonitor>, String> {
    require_session(&state, &session_id)?;
    check_kill_switch(&state)?;
    platform::monitors()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeAppWindow {
    pub app: String,
    pub window_id: String,
    pub process_id: u32,
    pub title: String,
}

#[tauri::command]
pub fn computer_app_windows(state: State<'_, ComputerState>, session_id: String, app: String) -> Result<Vec<NativeAppWindow>, String> {
    require_session(&state, &session_id)?;
    check_kill_switch(&state)?;
    use crate::native_app_operators::{AllowedApp, locate};
    let allowed = match app.as_str() {
        "spotify" => AllowedApp::Spotify,
        "steam" => AllowedApp::Steam,
        "explorer" => AllowedApp::Explorer,
        _ => return Err("app_outside_inspection_allowlist".into()),
    };
    let windows = locate(allowed)?;
    require_session(&state, &session_id)?;
    check_kill_switch(&state)?;
    Ok(windows.into_iter().map(|window| NativeAppWindow {
        app: app.clone(), window_id: format!("{}", window.handle),
        process_id: window.process_id, title: window.title,
    }).collect())
}

fn focus_app(app:&str)->Result<crate::native_app_operators::AllowedApp,String>{
    use crate::native_app_operators::AllowedApp;
    match app{"spotify"=>Ok(AllowedApp::Spotify),"steam"=>Ok(AllowedApp::Steam),"explorer"=>Ok(AllowedApp::Explorer),_=>Err("App outside native focus allowlist".into())}
}

fn workflow_access(reservations:&Mutex<Option<NativeWorkflowReservation>>,epoch:u64,session_id:&str,workflow_id:Option<&str>)->Result<(),String>{
    let mut slot=reservations.lock().map_err(|_|"Native workflow reservation unavailable")?;
    // An old guard must not prune a replacement's reservation, even when expired.
    if slot.as_ref().is_some_and(|r|r.epoch!=epoch||r.session_id!=session_id||workflow_id!=Some(r.workflow_id.as_str())){return Err("Native input is reserved by another whole workflow".into());}
    if slot.as_ref().is_some_and(|reservation|reservation.expires_at<=now_ms()){slot.take();}
    match(slot.as_ref(),workflow_id){
        (Some(reservation),Some(id))if reservation.session_id==session_id&&reservation.workflow_id==id=>Ok(()),
        (None,None)=>Ok(()),
        (None,Some(_))=>Err("Native workflow reservation missing or expired".into()),
        _=>Err("Native input is reserved by another whole workflow".into()),
    }
}

fn workflow_context(state:&ComputerState,session_id:&str,workflow_id:Option<&str>)->Result<(),String>{
    workflow_access(&state.workflow_reservation,state.session_generation.load(Ordering::SeqCst),session_id,workflow_id)
}

#[tauri::command]
pub fn computer_workflow_reserve(state:State<'_,ComputerState>,session_id:String,workflow_id:String,deadline_at:String)->Result<serde_json::Value,String>{
    if workflow_id.is_empty()||workflow_id.len()>160{return Err("Native workflow identity must contain 1..160 bytes".into());}
    let epoch=state.session_generation.load(Ordering::SeqCst);
    require_session(&state,&session_id)?;check_kill_switch(&state)?;
    let _dispatch=state.action_dispatch.try_lock().map_err(|_|"Native input primitive is busy; workflow was not reserved")?;
    require_session(&state,&session_id)?;
    let requested=chrono::DateTime::parse_from_rfc3339(&deadline_at).map_err(|_|"Workflow reservation deadline invalid")?.timestamp_millis();
    if requested<=0||requested as u64<=now_ms(){return Err("Workflow reservation deadline expired".into());}
    let approval=state.session.lock().map_err(|_|"Owner approval unavailable")?.as_ref().ok_or("Owner approval missing")?.expires_at
        .duration_since(UNIX_EPOCH).map_err(|_|"Owner approval time invalid")?.as_millis() as u64;
    if requested as u64>approval{return Err("Workflow reservation exceeds owner approval".into());}
    native_reserve_commit(&state,session_id,workflow_id,epoch,requested as u64)
}
fn native_reserve_commit(state:&ComputerState,session_id:String,workflow_id:String,epoch:u64,requested:u64)->Result<serde_json::Value,String>{
    let life=state.carrier_stop_hooks.lifecycle.lock().map_err(|_|"Workflow reservation unavailable")?;
    let session=state.session.lock().map_err(|_|"Owner approval unavailable")?;
    let scope=state.native_safety.lock().map_err(|_|"NATIVE_SAFETY_STATE_UNAVAILABLE")?;
    let current=session.as_ref().filter(|s|s.id==session_id&&SystemTime::now()<s.expires_at).ok_or("Workflow reservation cancelled")?;
    let scope=scope.as_ref().filter(|s|s.native_session_id==session_id&&s.original_generation==epoch&&!s.retired&&s.latch.is_none()
        &&!s.owner_binding_id.is_empty()&&!s.safety_session_ref.is_empty()&&!s.native_boot_nonce.is_empty()&&now_ms()<s.expires_at_ms).ok_or("Workflow reservation cancelled")?;
    if !native_activation_ready(&life,&state.carrier_stop_hooks)||state.stopped.load(Ordering::SeqCst)||state.session_generation.load(Ordering::SeqCst)!=epoch{return Err("Workflow reservation cancelled".into());}
    let approval=current.expires_at.duration_since(UNIX_EPOCH).map_err(|_|"Owner approval time invalid")?.as_millis() as u64;
    if requested<=now_ms()||requested>approval{return Err("Workflow reservation exceeds owner approval".into());}
    let mut slot=state.workflow_reservation.lock().map_err(|_|"Workflow reservation unavailable")?;
    // No foreign row is pruned, including after a delayed owner HTTP response.
    if slot.as_ref().is_some_and(|r|r.epoch!=epoch||r.session_id!=session_id||r.workflow_id!=workflow_id){return Err("Native input is reserved by another whole workflow".into());}
    if slot.as_ref().is_some_and(|r|r.expires_at<=now_ms()){slot.take();}
    if let Some(row)=slot.as_ref(){
        if row.workflow_id==workflow_id&&row.requested_deadline==requested{return Ok(serde_json::json!({"workflowId":row.workflow_id,"expiresAt":row.expires_at}));}
        return Err("Native input is reserved by another whole workflow".into());
    }
    let expires_at=requested.min(now_ms().saturating_add(30_000)).min(scope.expires_at_ms);
    let browser_incarnation=state.browser_reservation_changed();
    *slot=Some(NativeWorkflowReservation{session_id,workflow_id:workflow_id.clone(),epoch,expires_at,requested_deadline:requested,browser_incarnation});drop(slot);
    if let Ok(mut targets)=state.ocr_targets.lock(){targets.invalidate_all();}Ok(serde_json::json!({"workflowId":workflow_id,"expiresAt":expires_at}))
}
#[tauri::command]
pub fn computer_workflow_release(state:State<'_,ComputerState>,session_id:String,workflow_id:String)->Result<bool,String>{
    native_release_commit(&state,&session_id,&workflow_id)
}
fn native_release_commit(state:&ComputerState,session_id:&str,workflow_id:&str)->Result<bool,String>{
    let _life=state.carrier_stop_hooks.lifecycle.lock().map_err(|_|"Workflow reservation unavailable")?;
    let session=state.session.lock().map_err(|_|"Owner approval unavailable")?;
    let scope=state.native_safety.lock().map_err(|_|"NATIVE_SAFETY_STATE_UNAVAILABLE")?;
    let mut slot=state.workflow_reservation.lock().map_err(|_|"Workflow reservation unavailable")?;
    let Some(row)=slot.as_ref()else{return Ok(true);}; // Missing cleanup has zero effects.
    if row.session_id!=session_id||row.workflow_id!=workflow_id{return Err("Workflow release identity does not own native reservation".into());}
    let actual=scope.as_ref().filter(|s|s.native_session_id==session_id&&s.original_generation==row.epoch
        &&!s.owner_binding_id.is_empty()&&!s.safety_session_ref.is_empty()&&!s.native_boot_nonce.is_empty()).ok_or("Workflow release original scope changed")?;
    if session.as_ref().is_some_and(|s|s.id!=session_id){return Err("Workflow release original scope changed".into());}
    let generation=state.session_generation.load(Ordering::SeqCst);
    let retained=actual.latch.as_ref().is_some_and(|f|f.original_generation==row.epoch&&row.epoch.checked_add(1)==Some(f.latched_generation)&&state.stopped.load(Ordering::SeqCst)&&generation>=f.latched_generation);
    if generation!=row.epoch&&!retained{return Err("Workflow release original scope changed".into());}
    // Genuine matching expired reservations still revoke their read tombstones.
    slot.take();drop(slot);drop(scope);drop(session);
    crate::native_app_workflows::task_steam_read_release(session_id,workflow_id)?;
    if let Ok(mut targets)=state.ocr_targets.lock(){targets.invalidate_all();}
    state.browser_reservation_changed();Ok(true)
}
#[tauri::command]
pub async fn computer_focus_target(state:State<'_,ComputerState>,session_id:String,observation_id:String,generation:u64,app:String,workflow_id:Option<String>)->Result<crate::native_app_operators::FocusTarget,String>{
    workflow_context(&state,&session_id,workflow_id.as_deref())?;
    let observation=semantic_context(&state,&session_id,&observation_id,generation)?;
    let guard=app_worker_guard(&state,&session_id,None,Some(observation),workflow_id.as_deref())?;
    let post_guard=guard.clone();let dispatch=Arc::clone(&state.action_dispatch);
    let worker_session=session_id.clone();let worker_workflow=workflow_id.clone();
    let allowed=focus_app(&app)?;
    let worker_session=session_id.clone();let worker_observation=observation_id.clone();
    let worker_session=session_id.clone();let worker_workflow=workflow_id.clone();
    let target=tauri::async_runtime::spawn_blocking(move||{
        let _dispatch=dispatch.lock().map_err(|_|"Native focus dispatcher unavailable")?;
        guard.check()?;let result=crate::native_app_operators::issue_focus(&worker_session,&worker_observation,generation,allowed);app_result_after(result,||guard.check())
    }).await.unwrap_or_else(|_|Err("Native focus issuance worker failed".into()));
    // Any stop/new observation during issuance makes its result unusable.
    app_result_after(target,||app_result_after(semantic_context(&state,&session_id,&observation_id,generation).map(|_|()),||post_guard.check()))
}

#[derive(Clone)]
struct AppWorkerGuard {
    stopped: Arc<AtomicBool>, session_generation: Arc<AtomicU64>, observation_generation: Arc<AtomicU64>,
    epoch:u64, observed_generation:u64, expires:SystemTime, deadline:u64,
    bridge:SafetyBridge, observation:Option<ObservationContext>,
    reservation:Arc<Mutex<Option<NativeWorkflowReservation>>>,session_id:String,workflow_id:Option<String>,
    ocr_targets:Arc<Mutex<crate::native_ocr_targets::Registry>>,
}

impl AppWorkerGuard {
    fn check_local(&self)->Result<(),String>{
        workflow_access(&self.reservation,self.epoch,&self.session_id,self.workflow_id.as_deref())?;
        let valid=|| !self.stopped.load(Ordering::SeqCst) && self.session_generation.load(Ordering::SeqCst)==self.epoch
            && self.observation_generation.load(Ordering::SeqCst)==self.observed_generation
            && SystemTime::now()<self.expires && now_ms()<self.deadline
            && self.observation.as_ref().is_none_or(|observation|observation.expires_at>now_ms());
        if !valid(){return Err("Native app workflow stale, cancelled, or expired".into());}
        if let Some(observation)=self.observation.as_ref(){platform::validate_foreground(observation)?;}
        if !valid(){return Err("Native app workflow invalidated during foreground check".into());}
        workflow_access(&self.reservation,self.epoch,&self.session_id,self.workflow_id.as_deref())?;
        Ok(())
    }
    fn check(&self)->Result<(),String>{
        self.check_local()?;
        if let Err(error)=check_kill_switch_bridge(&self.bridge){
            let _life=self.bridge.stop_hooks.lifecycle.lock().map_err(|_|"Native lifecycle unavailable")?;
            if self.session_generation.load(Ordering::SeqCst)==self.epoch{
                if let Ok(mut targets)=self.ocr_targets.lock(){targets.invalidate_all();}
            }
            return Err(error);
        }
        self.check_local()
    }
}

fn app_worker_guard(state:&ComputerState,session_id:&str,deadline_at:Option<&str>,observation:Option<ObservationContext>,workflow_id:Option<&str>)->Result<AppWorkerGuard,String>{
    let epoch=state.session_generation.load(Ordering::SeqCst);
    require_session(state,session_id)?;check_kill_switch(state)?;
    let expires=state.session.lock().map_err(|_|"Computer session unavailable")?.as_ref().ok_or("Computer session missing")?.expires_at;
    let approval_deadline=expires.duration_since(UNIX_EPOCH).map_err(|_|"Computer approval time invalid")?.as_millis() as u64;
    let deadline=if let Some(value)=deadline_at{
        let timestamp=chrono::DateTime::parse_from_rfc3339(value).map_err(|_|"Native workflow deadline invalid")?.timestamp_millis();
        if timestamp<=0{return Err("Native workflow deadline invalid".into());}
        let timestamp=timestamp as u64;
        if timestamp>approval_deadline{return Err("Native workflow deadline exceeds owner approval".into());}
        timestamp
    }else{observation.as_ref().map_or(approval_deadline,|obs|approval_deadline.min(obs.expires_at))};
    let observed_generation=state.observation_generation.load(Ordering::SeqCst);
    if observation.as_ref().is_some_and(|obs|obs.generation!=observed_generation){return Err("Native workflow observation changed".into());}
    let guard=AppWorkerGuard {stopped:Arc::clone(&state.stopped),session_generation:Arc::clone(&state.session_generation),
        observation_generation:Arc::clone(&state.observation_generation),epoch,observed_generation,expires,deadline,
        bridge:safety_bridge(state)?,observation,reservation:Arc::clone(&state.workflow_reservation),session_id:session_id.into(),workflow_id:workflow_id.map(str::to_string),ocr_targets:Arc::clone(&state.ocr_targets)};
    guard.check()?;require_session(state,session_id)?;
    Ok(guard)
}

// Post-work safety/cleanup must execute even when work failed. Its failure can
// deny a successful result, but cannot erase the first factual work failure.
fn app_result_after<T>(work:Result<T,String>,after:impl FnOnce()->Result<(),String>)->Result<T,String>{
    let post=after();
    match work {Err(first)=>Err(first),Ok(value)=>post.map(|_|value)}
}

async fn app_mutation<F>(state:&ComputerState,session_id:&str,operation_id:&str,idempotency_key:&str,parameters:serde_json::Value,
    guard:AppWorkerGuard,work:F)->Result<serde_json::Value,String>
where F:FnOnce(&dyn Fn()->Result<(),String>)->Result<serde_json::Value,String>+Send+'static {
    if operation_id.is_empty()||operation_id.len()>160||idempotency_key.is_empty()||idempotency_key.len()>160{
        return Err("Native workflow operation and idempotency identities must contain 1..160 bytes".into());
    }
    guard.check()?;
    use sha2::{Digest,Sha256};
    let key=format!("{session_id}:{idempotency_key}");
    let binding=format!("{:x}",Sha256::digest(serde_json::to_vec(&parameters).map_err(|_|"Native workflow parameter binding invalid")?));
    let ledger=Arc::clone(&state.workflow_ledger);
    {
        let mut rows=ledger.lock().map_err(|_|"Native workflow ledger unavailable")?;
        rows.retain(|row|row.expires_at>SystemTime::now());
        if let Some(row)=rows.iter().find(|row|row.key==key){
            if row.binding!=binding{return Err("IDEMPOTENCY_KEY_CONFLICT".into());}
            return row.result.clone().unwrap_or_else(||Err("Native workflow already in flight; replay blocked".into()));
        }
        if rows.len()>=64{return Err("Native workflow approval ledger full".into());}
        rows.push(NativeWorkflowEntry {key:key.clone(),binding,expires_at:guard.expires+Duration::from_secs(10),result:None});
    }
    let post_guard=guard.clone();let dispatch=Arc::clone(&state.action_dispatch);
    let mut result=tauri::async_runtime::spawn_blocking(move||{
        let _dispatch=dispatch.lock().map_err(|_|"Native mutation dispatcher unavailable")?;
        guard.check()?;
        let result=work(&||guard.check());
        app_result_after(result,||guard.check())
    }).await.unwrap_or_else(|_|Err("Native workflow worker failed; replay remains blocked".into()));
    result=app_result_after(result,||app_result_after(post_guard.check(),||require_session(state,session_id)));
    if result.is_err(){crate::native_app_workflows::task_block(session_id,post_guard.workflow_id.as_deref());}
    if let Ok(mut rows)=ledger.lock(){if let Some(row)=rows.iter_mut().find(|row|row.key==key){row.result=Some(result.clone());}}
    // Terminal errors remain recorded for the complete approval lifetime.
    result
}

#[tauri::command]
pub async fn computer_app_open(state:State<'_,ComputerState>,session_id:String,app:String,operation_id:String,idempotency_key:String,deadline_at:String,workflow_id:Option<String>)->Result<serde_json::Value,String>{
    focus_app(&app)?;
    let guard=app_worker_guard(&state,&session_id,Some(&deadline_at),None,workflow_id.as_deref())?;
    let parameters=serde_json::json!({"command":"computer_app_open","sessionId":session_id,"app":app,"operationId":operation_id,"idempotencyKey":idempotency_key,"deadlineAt":deadline_at,"workflowId":workflow_id});
    let token=guard.bridge.token.clone();let port=guard.bridge.port;let worker_session=session_id.clone();let worker_action=operation_id.clone();
    app_mutation(&state,&session_id,&operation_id,&idempotency_key,parameters,guard,move|guard|{
        let receipt=crate::native_app_workflows::task_open(&token,port,&worker_session,workflow_id.as_deref(),&worker_action,&app,guard)?;
        serde_json::to_value(receipt).map_err(|_|"Native app open receipt serialization failed".into())
    }).await
}

#[tauri::command]
pub async fn computer_task_register(state:State<'_,ComputerState>,request:tauri::ipc::Request<'_>)->Result<serde_json::Value,String>{
    let value=steam_read_json_body(&request)?;
    if value.get("evidencePolicyId").is_some(){
        let args=steam_read_register_args(value)?;
        return steam_read_registration(&state,&args.session_id,&args.workflow_id,args.intent.into_intent()).await.map_err(steam_read_public_error);
    }
    let session_id=steam_read_legacy_arg(value,"computer_task_register","sessionId")?;
    let workflow_id=steam_read_legacy_arg(value,"computer_task_register","workflowId")?;
    let intent=steam_read_legacy_arg(value,"computer_task_register","intent")?;
    computer_task_register_legacy(state,session_id,workflow_id,intent).await
}

async fn computer_task_register_legacy(state:State<'_,ComputerState>,session_id:String,workflow_id:String,intent:crate::native_app_workflows::TaskIntent)->Result<serde_json::Value,String>{
    intent.validate()?;let guard=app_worker_guard(&state,&session_id,None,None,Some(&workflow_id))?;
    let steam_scope=if intent.app=="steam"&&intent.workflow=="game_detail" {
        guard.check()?;require_session(&state,&session_id)?;
        let original={let retained=state.native_safety.lock().map_err(|_|"NATIVE_SAFETY_STATE_UNAVAILABLE")?;
            let original=retained.as_ref().ok_or("NATIVE_SESSION_SCOPE_CHANGED")?;
            if original.native_session_id!=session_id||original.original_generation!=guard.epoch||original.safety_session_ref.is_empty()
                ||original.retired||original.latch.is_some()||original.expires_at_ms<=now_ms(){return Err("NATIVE_SESSION_SCOPE_CHANGED".into());}
            original.clone()};
        guard.check()?;require_session(&state,&session_id)?;
        {let retained=state.native_safety.lock().map_err(|_|"NATIVE_SAFETY_STATE_UNAVAILABLE")?;
            if retained.as_ref().is_none_or(|current|current.native_session_id!=original.native_session_id||current.safety_session_ref!=original.safety_session_ref
                ||current.original_generation!=original.original_generation||current.expires_at_ms!=original.expires_at_ms||current.owner_binding_id!=original.owner_binding_id
                ||current.native_boot_nonce!=original.native_boot_nonce||current.retired||current.latch.is_some()||current.expires_at_ms<=now_ms()){
                return Err("NATIVE_SESSION_SCOPE_CHANGED".into());}}
        Some(crate::native_app_workflows::SteamOriginalScope{session_id:original.native_session_id,safety_session_ref:original.safety_session_ref,
            original_epoch:original.original_generation,native_expires_at_ms:original.expires_at_ms})
    }else{None};
    let parameters=serde_json::json!({"command":"computer_task_register","sessionId":session_id,"workflowId":workflow_id,"intent":intent});
    let token=guard.bridge.token.clone();let port=guard.bridge.port;let deadline=guard.deadline;let worker_session=session_id.clone();let worker_workflow=workflow_id.clone();let key=format!("task-register-{workflow_id}");
    app_mutation(&state,&session_id,&workflow_id,&key,parameters,guard,move|guard|crate::native_app_workflows::task_register(&token,port,&worker_session,&worker_workflow,intent,deadline,steam_scope,guard)).await
}
#[tauri::command]
pub async fn computer_task_bind(state:State<'_,ComputerState>,session_id:String,workflow_id:String,binding_id:String)->Result<serde_json::Value,String>{
    let guard=app_worker_guard(&state,&session_id,None,None,Some(&workflow_id))?;
    let parameters=serde_json::json!({"command":"computer_task_bind","sessionId":session_id,"workflowId":workflow_id,"bindingId":binding_id});
    let token=guard.bridge.token.clone();let port=guard.bridge.port;let worker_session=session_id.clone();let worker_workflow=workflow_id.clone();let key=format!("task-bind-{workflow_id}");
    app_mutation(&state,&session_id,&workflow_id,&key,parameters,guard,move|guard|crate::native_app_workflows::task_bind(&token,port,&worker_session,&worker_workflow,&binding_id,guard)).await
}
#[tauri::command]
pub async fn computer_task_finish(state:State<'_,ComputerState>,session_id:String,workflow_id:String,binding_id:String)->Result<serde_json::Value,String>{
    let guard=app_worker_guard(&state,&session_id,None,None,Some(&workflow_id))?;
    let parameters=serde_json::json!({"command":"computer_task_finish","sessionId":session_id,"workflowId":workflow_id,"bindingId":binding_id});
    let token=guard.bridge.token.clone();let port=guard.bridge.port;let worker_session=session_id.clone();let worker_workflow=workflow_id.clone();let key=format!("task-finish-{workflow_id}");
    app_mutation(&state,&session_id,&workflow_id,&key,parameters,guard,move|guard|crate::native_app_workflows::task_finish(&token,port,&worker_session,&worker_workflow,&binding_id,guard)).await
}
#[tauri::command]
pub async fn computer_task_cancel(state:State<'_,ComputerState>,session_id:String,workflow_id:String,binding_id:String)->Result<serde_json::Value,String>{
    let guard=app_worker_guard(&state,&session_id,None,None,Some(&workflow_id))?;
    let parameters=serde_json::json!({"command":"computer_task_cancel","sessionId":session_id,"workflowId":workflow_id,"bindingId":binding_id});
    let token=guard.bridge.token.clone();let port=guard.bridge.port;let worker_session=session_id.clone();let worker_workflow=workflow_id.clone();let key=format!("task-cancel-{workflow_id}");
    app_mutation(&state,&session_id,&workflow_id,&key,parameters,guard,move|guard|crate::native_app_workflows::task_cancel(&token,port,&worker_session,&worker_workflow,&binding_id,guard)).await
}

// Passive collection keeps its native safety context separate from screenshot
// observations. The public wire branch is defined independently before exposure.
const STEAM_READ_POLICY_ID:&str="steam-noncontent-read-20261016-v1";
const STEAM_READ_ERRORS:[&str;11]=["STEAM_READ_INVALID_REQUEST","STEAM_READ_POLICY_UNAVAILABLE","STEAM_READ_SCOPE_UNAVAILABLE","STEAM_READ_SCOPE_EXPIRED","STEAM_READ_SCOPE_CHANGED","STEAM_READ_BUSY","STEAM_READ_REPLAY","STEAM_READ_UNSUPPORTED","STEAM_READ_TIMEOUT","STEAM_READ_ENDED","STEAM_READ_CAPACITY"];
fn steam_read_public_error(error:String)->String{
    if STEAM_READ_ERRORS.contains(&error.as_str()){error}
    else if error=="unsupported_policy"{"STEAM_READ_UNSUPPORTED".into()}
    else{"STEAM_READ_SCOPE_CHANGED".into()}
}
fn steam_read_json_body<'a>(request:&'a tauri::ipc::Request<'_>)->Result<&'a serde_json::Value,String>{
    match request.body(){tauri::ipc::InvokeBody::Json(value)=>Ok(value),_=>Err("STEAM_READ_INVALID_REQUEST".into())}
}
fn steam_read_legacy_arg<T:serde::de::DeserializeOwned>(value:&serde_json::Value,command:&'static str,key:&'static str)->Result<T,String>{
    // Same delivered-Value deserializer and InvalidArgs wrapper used by Tauri's
    // original individual CommandArg extraction. Legacy unknown fields stay ignored.
    let parsed=match value.get(key){Some(value)=>T::deserialize(value),None=>Err(<serde_json::Error as serde::de::Error>::custom(format!("command {command} missing required key {key}")))};
    parsed.map_err(|error|tauri::Error::InvalidArgs(command,key,error).to_string())
}
fn steam_read_id(value:&str)->bool{!value.is_empty()&&value.len()<=160&&value.bytes().all(|b|b.is_ascii_alphanumeric()||matches!(b,b':'|b'_'|b'-'))}
fn steam_read_ref(value:&str)->bool{value.strip_prefix("steam-read:").is_some_and(|v|v.len()==64&&v.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b)))}
fn steam_read_state(value:&str)->bool{matches!(value,"Library MAIN pre"|"DETAIL MAIN positive"|"same-root sidebar"|"same-root Properties"|"same-root settings"|"same-root overlay"|"same-root other panel")}
fn steam_read_request_size(value:&serde_json::Value,cap:usize)->Result<(),String>{
    if serde_json::to_vec(value).map_err(|_|"STEAM_READ_INVALID_REQUEST")?.len()>cap{return Err("STEAM_READ_INVALID_REQUEST".into());}Ok(())
}
#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
struct SteamReadRegisterIntent{app:String,workflow:String,game_name:String}
impl SteamReadRegisterIntent{
    fn into_intent(self)->crate::native_app_workflows::TaskIntent{crate::native_app_workflows::TaskIntent{app:self.app,workflow:self.workflow,query:None,volume:None,game_name:Some(self.game_name)}}
}
#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
struct SteamReadRegisterArgs{session_id:String,workflow_id:String,intent:SteamReadRegisterIntent,evidence_policy_id:String}
fn steam_read_register_args(value:&serde_json::Value)->Result<SteamReadRegisterArgs,String>{
    steam_read_request_size(value,4096)?;
    if !value.is_object()||!value.get("intent").is_some_and(serde_json::Value::is_object){return Err("STEAM_READ_INVALID_REQUEST".into());}
    let args:SteamReadRegisterArgs=serde_json::from_value(value.clone()).map_err(|_|"STEAM_READ_INVALID_REQUEST")?;
    if !steam_read_id(&args.session_id)||!steam_read_id(&args.workflow_id)||args.evidence_policy_id!=STEAM_READ_POLICY_ID
        ||args.intent.app!="steam"||args.intent.workflow!="game_detail"{return Err("STEAM_READ_INVALID_REQUEST".into());}
    let intent=crate::native_app_workflows::TaskIntent{app:args.intent.app.clone(),workflow:args.intent.workflow.clone(),query:None,volume:None,game_name:Some(args.intent.game_name.clone())};
    intent.validate().map_err(|_|"STEAM_READ_INVALID_REQUEST")?;
    Ok(args)
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SteamReadEnvelope{evidence:SteamReadEvidence}
#[derive(Deserialize)]
#[serde(tag="op",rename_all="lowercase",deny_unknown_fields)]
enum SteamReadEvidence{
    Begin{version:u8,#[serde(rename="sessionId")]session_id:String,#[serde(rename="workflowId")]workflow_id:String,#[serde(rename="bindingId")]binding_id:String,#[serde(rename="policyId")]policy_id:String},
    Sample{version:u8,#[serde(rename="readRef")]read_ref:String,state:String},
    End{version:u8,#[serde(rename="readRef")]read_ref:String},
}
fn steam_read_evidence(value:&serde_json::Value)->Result<SteamReadEvidence,String>{
    steam_read_request_size(value,2048)?;
    let envelope:SteamReadEnvelope=serde_json::from_value(value.clone()).map_err(|_|"STEAM_READ_INVALID_REQUEST")?;
    let valid=match &envelope.evidence{
        SteamReadEvidence::Begin{version,session_id,workflow_id,binding_id,policy_id}=>*version==1&&steam_read_id(session_id)&&steam_read_id(workflow_id)&&steam_read_id(binding_id)&&policy_id==STEAM_READ_POLICY_ID,
        SteamReadEvidence::Sample{version,read_ref,state}=>*version==1&&steam_read_ref(read_ref)&&steam_read_state(state),
        SteamReadEvidence::End{version,read_ref}=>*version==1&&steam_read_ref(read_ref),
    };
    if !valid{return Err("STEAM_READ_INVALID_REQUEST".into());}Ok(envelope.evidence)
}
fn steam_read_policy_gate()->Result<u64,String>{
    let expiry=crate::native_uia::steam_read_policy_deadline(now_ms()).map_err(|_|"STEAM_READ_POLICY_UNAVAILABLE")?;
    if !option_env!("EDITH_NATIVE_BUILD_ID").is_some_and(|id|id.len()==64&&id.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b))){return Err("STEAM_READ_POLICY_UNAVAILABLE".into());}Ok(expiry)
}
#[derive(Clone)]
struct SteamReadNativeContext {
    original: NativeSafetySession,
    guard: AppWorkerGuard,
    reservation: SteamReadReservation,
}

#[derive(Clone,PartialEq,Eq)]
struct SteamReadReservation {expires_at:u64,requested_deadline:u64,browser_incarnation:u64}
fn steam_read_reservation_snapshot(row:&NativeWorkflowReservation,session:&str,workflow:&str,epoch:u64,now:u64)->Result<SteamReadReservation,String>{
    if row.session_id!=session||row.workflow_id!=workflow||row.epoch!=epoch{return Err("STEAM_READ_SCOPE_CHANGED".into());}
    if now>=row.expires_at{return Err("STEAM_READ_SCOPE_EXPIRED".into());}
    Ok(SteamReadReservation{expires_at:row.expires_at,requested_deadline:row.requested_deadline,browser_incarnation:row.browser_incarnation})
}
fn steam_read_reservation_current(row:&NativeWorkflowReservation,original:&SteamReadReservation,session:&str,workflow:&str,epoch:u64,now:u64)->Result<(),String>{
    if row.session_id!=session||row.workflow_id!=workflow||row.epoch!=epoch||row.expires_at!=original.expires_at
        ||row.requested_deadline!=original.requested_deadline||row.browser_incarnation!=original.browser_incarnation{
        return Err("STEAM_READ_SCOPE_CHANGED".into());
    }
    if now>=original.expires_at{return Err("STEAM_READ_SCOPE_EXPIRED".into());}Ok(())
}

fn steam_read_original_scope(original:&NativeSafetySession,epoch:u64,session:&str,now:u64)->Result<crate::native_app_workflows::SteamOriginalScope,String>{
    if original.native_session_id!=session || original.original_generation!=epoch
        || original.safety_session_ref.is_empty() || original.owner_binding_id.is_empty()
        || original.native_boot_nonce.is_empty() || original.retired || original.latch.is_some() || original.stop_request.is_some() {
        return Err("STEAM_READ_SCOPE_CHANGED".into());
    }
    if now>=original.expires_at_ms{return Err("STEAM_READ_SCOPE_EXPIRED".into());}
    Ok(crate::native_app_workflows::SteamOriginalScope{
        session_id:original.native_session_id.clone(),safety_session_ref:original.safety_session_ref.clone(),
        original_epoch:original.original_generation,native_expires_at_ms:original.expires_at_ms,
    })
}

fn steam_read_original_deadline(native:u64,guard:u64,policy:u64,reservation:u64,now:u64)->Result<u64,String>{
    let deadline=native.min(guard).min(policy).min(reservation);
    if now>=deadline { return Err("STEAM_READ_SCOPE_EXPIRED".into()); }
    Ok(deadline)
}

impl SteamReadNativeContext {
    fn check_local(&self)->Result<(),String>{
        // Classify original scope changes before expiry; legacy guards still
        // execute afterwards, but cannot erase an expired original lifetime.
        if self.guard.stopped.load(Ordering::SeqCst)||self.guard.session_generation.load(Ordering::SeqCst)!=self.guard.epoch
            ||self.guard.observation_generation.load(Ordering::SeqCst)!=self.guard.observed_generation{
            return Err("STEAM_READ_SCOPE_CHANGED".into());
        }
        {let rows=self.guard.bridge.safety.lock().map_err(|_|"STEAM_READ_SCOPE_UNAVAILABLE")?;
            let current=rows.as_ref().ok_or("STEAM_READ_SCOPE_CHANGED")?;
            if !same_safety_scope(current,&self.original)||current.owner_binding_id!=self.original.owner_binding_id
                ||current.retired||current.latch.is_some()||current.stop_request.is_some(){return Err("STEAM_READ_SCOPE_CHANGED".into());}}
        {let rows=self.guard.reservation.lock().map_err(|_|"STEAM_READ_SCOPE_UNAVAILABLE")?;
            let row=rows.as_ref().ok_or("STEAM_READ_SCOPE_CHANGED")?;
            steam_read_reservation_current(row,&self.reservation,&self.guard.session_id,self.guard.workflow_id.as_deref().ok_or("STEAM_READ_SCOPE_CHANGED")?,self.guard.epoch,now_ms())?;}
        steam_read_original_scope(&self.original,self.guard.epoch,&self.guard.session_id,now_ms())?;
        let policy=steam_read_policy_gate()?;
        steam_read_original_deadline(self.original.expires_at_ms,self.guard.deadline,policy,self.reservation.expires_at,now_ms())?;
        steam_diagnostic_safety_current(&self.guard.bridge.safety,&self.original,self.guard.epoch,&self.guard.session_id)?;
        self.guard.check_local()
    }
    fn check(&self)->Result<(),String>{
        self.check_local()?;
        self.guard.check()?;
        self.check_local()
    }
    fn check_task(&self,workflow:&str)->Result<(),String>{
        self.check()?;
        crate::native_app_workflows::task_authority_live(&self.guard.bridge.token,self.guard.bridge.port,
            &self.guard.session_id,workflow,&||self.check_local())?;
        self.check()
    }
}

fn steam_read_native_context(state:&ComputerState,session:&str,workflow:&str)->Result<SteamReadNativeContext,String>{
    // Class-policy expiry is checked before any native root/provider discovery.
    let policy=steam_read_policy_gate()?;
    let epoch=state.session_generation.load(Ordering::SeqCst);
    if state.stopped.load(Ordering::SeqCst)||state.carrier_stop_hooks.active_cleanup.load(Ordering::SeqCst)!=0{return Err("STEAM_READ_SCOPE_CHANGED".into());}
    let original=state.native_safety.lock().map_err(|_|"STEAM_READ_SCOPE_UNAVAILABLE")?
        .as_ref().ok_or("STEAM_READ_SCOPE_UNAVAILABLE")?.clone();
    steam_read_original_scope(&original,epoch,session,now_ms())?;
    let reservation={let rows=state.workflow_reservation.lock().map_err(|_|"STEAM_READ_SCOPE_UNAVAILABLE")?;
        let row=rows.as_ref().ok_or("STEAM_READ_SCOPE_UNAVAILABLE")?;
        steam_read_reservation_snapshot(row,session,workflow,epoch,now_ms())?};
    let retained=crate::native_app_workflows::task_steam_read_original_deadline(session,workflow)?;
    let owner_expiry={let rows=state.session.lock().map_err(|_|"STEAM_READ_SCOPE_UNAVAILABLE")?;
        let owner=rows.as_ref().ok_or("STEAM_READ_SCOPE_UNAVAILABLE")?;
        if owner.id!=session{return Err("STEAM_READ_SCOPE_CHANGED".into());}
        owner.expires_at.duration_since(UNIX_EPOCH).map_err(|_|"STEAM_READ_SCOPE_EXPIRED")?.as_millis() as u64};
    let deadline=steam_read_original_deadline(original.expires_at_ms,owner_expiry,policy,reservation.expires_at.min(retained.unwrap_or(u64::MAX)),now_ms())?;
    let deadline_at=chrono::DateTime::<chrono::Utc>::from_timestamp_millis(i64::try_from(deadline).map_err(|_|"STEAM_READ_SCOPE_EXPIRED")?)
        .ok_or("STEAM_READ_SCOPE_EXPIRED")?.to_rfc3339();
    workflow_context(state,session,Some(workflow))?;
    let mut guard=app_worker_guard(state,session,Some(&deadline_at),None,Some(workflow))?;
    steam_read_original_scope(&original,guard.epoch,session,now_ms())?;
    guard.deadline=steam_read_original_deadline(original.expires_at_ms,guard.deadline,policy,reservation.expires_at.min(retained.unwrap_or(u64::MAX)),now_ms())?;
    let context=SteamReadNativeContext{original,guard,reservation};
    context.check()?;
    Ok(context)
}

// Private operations only. The defining wire DTO must be frozen before these
// operations are reachable through the registered diagnostic command.
enum SteamReadOperation {
    Begin { binding:String },
    Sample { reference:String, state:String },
}

fn steam_read_after<T>(work:Result<T,String>,after:impl FnOnce()->Result<(),String>)->Result<T,String>{
    after()?;work
}

async fn steam_read_operation(state:&ComputerState,session:&str,workflow:&str,operation:SteamReadOperation)->Result<serde_json::Value,String>{
    let beginning=matches!(&operation,SteamReadOperation::Begin{..});
    let sample_reference=match &operation{SteamReadOperation::Sample{reference,..}=>Some(reference.clone()),_=>None};
    let context=steam_read_native_context(state,session,workflow)?;
    let original_scope=steam_read_original_scope(&context.original,context.guard.epoch,session,now_ms())?;
    let owner=context.original.owner_binding_id.clone();
    let post=context.clone();let dispatch=Arc::clone(&state.action_dispatch);
    let worker_session=session.to_owned();let worker_workflow=workflow.to_owned();
    let epoch=context.guard.epoch;
    let result=tauri::async_runtime::spawn_blocking(move||{
        let _dispatch=dispatch.lock().map_err(|_|"Native read dispatcher unavailable")?;
        // Blocking authority checks bracket the bounded provider work. Inside
        // the worker, local native scope/STOP/root and ledger checks repeat;
        // no recursive authority request is hidden in a property read.
        context.check_task(&worker_workflow)?;
        let local=||context.check_local();
        let work=match operation {
            SteamReadOperation::Begin{binding}=>crate::native_app_workflows::task_steam_read_begin(
                &worker_session,&worker_workflow,&binding,&original_scope,&owner,&local),
            SteamReadOperation::Sample{reference,state}=>crate::native_app_workflows::task_steam_read_sample(
                &worker_session,&worker_workflow,&reference,&state,&original_scope,&owner,&local),
        };
        let result=steam_read_after(work,||context.check_task(&worker_workflow));
        if result.is_err(){crate::native_app_workflows::task_steam_read_invalidate_session(&worker_session,epoch);}
        result
    }).await.unwrap_or_else(|_|Err("Native read worker unavailable".into()));
    let result=steam_read_after(result,||post.check());
    if result.is_ok(){
        let hook_session=session.to_owned();
        if beginning {
            if let Err(error)=state.register_carrier_stop_hook(epoch,Arc::new(move|stopped_epoch|{
                crate::native_app_workflows::task_steam_read_invalidate_session(&hook_session,stopped_epoch);
            })) {
                crate::native_app_workflows::task_steam_read_invalidate_session(session,epoch);return Err(error);
            }
        }
        if let Err(error)=post.check_local(){
            crate::native_app_workflows::task_steam_read_invalidate_session(session,epoch);return Err(error);
        }
    } else {crate::native_app_workflows::task_steam_read_invalidate_session(session,epoch);}
    if let (Ok(candidate),Some(reference))=(&result,sample_reference.as_deref()){
        if let Err(error)=crate::native_app_workflows::task_steam_read_finalize(session,workflow,reference,candidate){
            crate::native_app_workflows::task_steam_read_invalidate_session(session,epoch);return Err(error);
        }
    }
    result
}

async fn steam_read_registration(state:&ComputerState,session:&str,workflow:&str,intent:crate::native_app_workflows::TaskIntent)->Result<serde_json::Value,String>{
    let context=steam_read_native_context(state,session,workflow)?;
    let scope=steam_read_original_scope(&context.original,context.guard.epoch,session,now_ms())?;
    let token=context.guard.bridge.token.clone();let port=context.guard.bridge.port;let deadline=context.guard.deadline;
    let worker_session=session.to_owned();let worker_workflow=workflow.to_owned();let retained=context.clone();let post=context.clone();
    let parameters=serde_json::json!({"command":"computer_task_register","sessionId":session,"workflowId":workflow,"intent":intent,"evidencePolicyId":STEAM_READ_POLICY_ID});
    use sha2::{Digest,Sha256};
    let key=format!("read-register-{:x}",Sha256::digest(workflow.as_bytes()));
    let result=app_mutation(state,session,workflow,&key,parameters,context.guard,move|guard|{
        retained.check()?;
        let result=crate::native_app_workflows::task_register_read(&token,port,&worker_session,&worker_workflow,intent,deadline,Some(scope),guard);
        steam_read_after(result,||retained.check())
    }).await;
    steam_read_after(result,||post.check())
}

#[tauri::command]
pub async fn computer_steam_diagnostic_capture(state:State<'_,ComputerState>,request:tauri::ipc::Request<'_>)->Result<serde_json::Value,String>{
    let value=steam_read_json_body(&request)?;
    if value.get("evidence").is_some(){
        let evidence=steam_read_evidence(value)?;
        let result=match evidence{
            SteamReadEvidence::End{read_ref,..}=>{
                // Revocation remains reachable after policy/native STOP/expiry.
                let(session,workflow)=crate::native_app_workflows::task_steam_read_lookup(&read_ref).map_err(steam_read_public_error)?;
                crate::native_app_workflows::task_steam_read_end(&session,&workflow,&read_ref)
            },
            SteamReadEvidence::Begin{session_id,workflow_id,binding_id,..}=>steam_read_operation(&state,&session_id,&workflow_id,SteamReadOperation::Begin{binding:binding_id}).await,
            SteamReadEvidence::Sample{read_ref,state:slot,..}=>{
                steam_read_policy_gate()?;
                let(session,workflow)=crate::native_app_workflows::task_steam_read_lookup(&read_ref).map_err(steam_read_public_error)?;
                steam_read_operation(&state,&session,&workflow,SteamReadOperation::Sample{reference:read_ref,state:slot}).await
            },
        };
        return result.map_err(steam_read_public_error);
    }
    let session_id=steam_read_legacy_arg(value,"computer_steam_diagnostic_capture","sessionId")?;
    let observation_id=steam_read_legacy_arg(value,"computer_steam_diagnostic_capture","observationId")?;
    let generation=steam_read_legacy_arg(value,"computer_steam_diagnostic_capture","generation")?;
    let workflow_id=steam_read_legacy_arg(value,"computer_steam_diagnostic_capture","workflowId")?;
    computer_steam_diagnostic_capture_legacy(state,session_id,observation_id,generation,workflow_id).await
}

async fn computer_steam_diagnostic_capture_legacy(state:State<'_,ComputerState>,session_id:String,observation_id:String,generation:u64,workflow_id:String)->Result<serde_json::Value,String>{
    workflow_context(&state,&session_id,Some(&workflow_id))?;
    let observation=semantic_context(&state,&session_id,&observation_id,generation)?;
    let hwnd=observation_hwnd(&observation)?;let pid=observation.window_process_id;
    let guard=app_worker_guard(&state,&session_id,None,Some(observation),Some(&workflow_id))?;
    let safety=Arc::clone(&state.native_safety);
    let original=safety.lock().map_err(|_|"NATIVE_SAFETY_STATE_UNAVAILABLE")?.as_ref()
        .ok_or("NATIVE_SESSION_SCOPE_CHANGED")?.clone();
    steam_diagnostic_safety_current(&safety,&original,guard.epoch,&session_id)?;
    let post_safety=Arc::clone(&safety);let post_original=original.clone();
    let post_guard=guard.clone();let dispatch=Arc::clone(&state.action_dispatch);
    let worker_session=session_id.clone();let worker_workflow=workflow_id.clone();
    let result=tauri::async_runtime::spawn_blocking(move||{
        let _dispatch=dispatch.lock().map_err(|_|"Native semantic dispatcher unavailable")?;
        let current_guard=||{
            guard.check()?;
            steam_diagnostic_safety_current(&safety,&original,guard.epoch,&worker_session)
        };
        current_guard()?;
        let original_scope=crate::native_app_workflows::SteamOriginalScope{
            session_id:original.native_session_id.clone(),safety_session_ref:original.safety_session_ref.clone(),
            original_epoch:original.original_generation,native_expires_at_ms:original.expires_at_ms};
        // Passive diagnostic has no mutation ledger, action, or snapshot authority.
        let result=crate::native_app_workflows::task_steam_diagnostic_capture(
            &worker_session,&worker_workflow,hwnd,pid,generation,&original_scope,&original.owner_binding_id,&current_guard);
        current_guard()?;result
    }).await.map_err(|_|"Native Steam diagnostic worker failed")?;
    post_guard.check()?;
    semantic_context(&state,&session_id,&observation_id,generation)?;
    workflow_context(&state,&session_id,Some(&workflow_id))?;
    post_guard.check()?;
    steam_diagnostic_safety_current(&post_safety,&post_original,post_guard.epoch,&session_id)?;
    result
}

fn steam_diagnostic_safety_current(safety:&Mutex<Option<NativeSafetySession>>,original:&NativeSafetySession,epoch:u64,session:&str)->Result<(),String>{
    let rows=safety.lock().map_err(|_|"NATIVE_SAFETY_STATE_UNAVAILABLE")?;
    let current=rows.as_ref().ok_or("NATIVE_SESSION_SCOPE_CHANGED")?;
    if original.native_session_id!=session||original.original_generation!=epoch||original.safety_session_ref.is_empty()
        ||original.owner_binding_id.is_empty()||original.native_boot_nonce.is_empty()
        ||original.retired||original.latch.is_some()||original.stop_request.is_some()||original.expires_at_ms<=now_ms()
        ||!same_safety_scope(current,original)||current.owner_binding_id!=original.owner_binding_id
        ||current.retired||current.latch.is_some()||current.stop_request.is_some()||current.expires_at_ms<=now_ms(){
        return Err("NATIVE_SESSION_SCOPE_CHANGED".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn computer_app_snapshot(state:State<'_,ComputerState>,session_id:String,observation_id:String,generation:u64,workflow_id:Option<String>)->Result<Vec<crate::native_uia::ControlState>,String>{
    workflow_context(&state,&session_id,workflow_id.as_deref())?;
    let observation=semantic_context(&state,&session_id,&observation_id,generation)?;
    let hwnd=observation_hwnd(&observation)?;let pid=observation.window_process_id;
    let guard=app_worker_guard(&state,&session_id,None,Some(observation),workflow_id.as_deref())?;
    let post_guard=guard.clone();let dispatch=Arc::clone(&state.action_dispatch);
    let result=tauri::async_runtime::spawn_blocking(move||{
        let _dispatch=dispatch.lock().map_err(|_|"Native semantic dispatcher unavailable")?;
        guard.check()?;
        let result=crate::native_app_workflows::snapshot(hwnd,pid,&||guard.check());
        app_result_after(result,||guard.check())
    }).await.unwrap_or_else(|_|Err("Native app snapshot worker failed".into()));
    let controls=app_result_after(result,||app_result_after(post_guard.check(),||semantic_context(&state,&session_id,&observation_id,generation).map(|_|())))?;
    if controls.len()>64{return Err("Native app control budget exceeded".into());}
    Ok(controls)
}

#[tauri::command]
pub async fn computer_app_volume(state:State<'_,ComputerState>,session_id:String,observation_id:String,generation:u64,target_id:String,volume:u8,operation_id:String,idempotency_key:String,deadline_at:String,workflow_id:Option<String>)->Result<serde_json::Value,String>{
    workflow_context(&state,&session_id,workflow_id.as_deref())?;
    if volume>100{return Err("Native volume must be 0..100".into());}
    let observation=semantic_context(&state,&session_id,&observation_id,generation)?;
    let hwnd=observation_hwnd(&observation)?;let pid=observation.window_process_id;
    let guard=app_worker_guard(&state,&session_id,Some(&deadline_at),Some(observation),workflow_id.as_deref())?;
    let parameters=serde_json::json!({"command":"computer_app_volume","sessionId":session_id,"observationId":observation_id,"generation":generation,"targetId":target_id,"volume":volume,"operationId":operation_id,"idempotencyKey":idempotency_key,"deadlineAt":deadline_at,"workflowId":workflow_id});
    let token=guard.bridge.token.clone();let port=guard.bridge.port;let worker_session=session_id.clone();let worker_action=operation_id.clone();
    app_mutation(&state,&session_id,&operation_id,&idempotency_key,parameters,guard,move|guard|{
        crate::native_app_workflows::task_validate_volume(&worker_session,workflow_id.as_deref(),volume)?;
        let controls=crate::native_app_workflows::snapshot(hwnd,pid,guard)?;
        let sliders:Vec<_>=controls.iter().filter(|control|control.control_type==50015
            && matches!(control.name.trim().to_lowercase().as_str(),"volume"|"ses düzeyi"|"ses seviyesi")
            && control.range_value.is_some() && control.range_min.is_some() && control.range_max.is_some()).collect();
        if sliders.len()!=1||sliders[0].target_id!=target_id{return Err("Requested target is not the unique observed volume slider".into());}
        guard()?;
        let task_bound=crate::native_app_workflows::task_before(&token,port,&worker_session,workflow_id.as_deref(),&worker_action,false,guard)?;
        let input_guard=||{guard()?;if task_bound{crate::native_app_workflows::task_authority_live(&token,port,&worker_session,workflow_id.as_deref().ok_or("Task volume reservation missing")?,guard)?;}Ok(())};
        let result=crate::native_app_workflows::set_volume(hwnd,pid,&target_id,volume,&input_guard);
        let (succeeded,failed)=(result.is_ok(),result.is_err());
        let result=app_result_after(result,||{
            if task_bound{crate::native_app_workflows::task_after(&token,port,&worker_session,workflow_id.as_deref().ok_or("Task volume reservation missing")?,&worker_action,succeeded,failed,false,guard)}else{Ok(())}
        });
        let receipt=result?;
        serde_json::to_value(receipt).map_err(|_|"Native volume receipt serialization failed".into())
    }).await
}

#[tauri::command]
pub async fn computer_explorer_claim(state:State<'_,ComputerState>,session_id:String,workflow_id:Option<String>)->Result<Option<crate::native_app_workflows::ExplorerClaimDescriptor>,String>{
    let workflow_id=workflow_id.ok_or("Explorer claim requires a pre-acquired whole-workflow reservation")?;
    let guard=app_worker_guard(&state,&session_id,None,None,Some(&workflow_id))?;
    let post_guard=guard.clone();let worker_session=session_id.clone();let worker_workflow=workflow_id.clone();let claimed_at=SystemTime::now();
    let dispatch=Arc::clone(&state.action_dispatch);
    let result=tauri::async_runtime::spawn_blocking(move||{
        // The caller must own the whole-workflow reservation before any backend claim.
        guard.check()?;
        let _dispatch=dispatch.lock().map_err(|_|"Native Explorer claim dispatcher unavailable")?;
        guard.check()?;
        let result=(||{
            let claim=crate::native_app_workflows::explorer_claim(&guard.bridge.token,guard.bridge.port,&worker_session,&worker_workflow,guard.deadline,&||guard.check())?;
            let destination=claim.as_ref().map(|c|crate::native_app_workflows::explorer_destination(&worker_session,&c.operation_id)).transpose()?;
            Ok::<_,String>((claim,destination))
        })();
        app_result_after(result,||guard.check())
    }).await.unwrap_or_else(|_|Err("Native Explorer claim worker failed".into()));
    let (claim,destination)=app_result_after(result,||app_result_after(post_guard.check(),||require_session(&state,&session_id)))?;
    if let Some(claim)=claim.as_ref(){
        let mut rows=state.explorer_claims.lock().map_err(|_|"Native Explorer claim bindings unavailable")?;
        rows.retain(|row|row.epoch==post_guard.epoch && row.expires_at>now_ms());
        if rows.iter().any(|row|row.session_id==session_id && row.operation_id==claim.operation_id){return Err("Native Explorer operation was already claimed".into());}
        if rows.len()>=8{return Err("Native Explorer claim binding budget exceeded".into());}
        rows.push(NativeExplorerClaim {session_id,operation_id:claim.operation_id.clone(),operation:claim.operation.clone(),
            reverse_of:claim.reverse_of.clone(),destination_path:destination.ok_or("Native Explorer destination authority missing")?,workflow_id:workflow_id.clone(),
            epoch:post_guard.epoch,claimed_at,expires_at:claim.expires_at});
    }
    Ok(claim)
}

fn explorer_gui_proof(ledger:&Mutex<Vec<NativeActionEntry>>,claim:&NativeExplorerClaim)->Result<(),String>{
    let rows=ledger.lock().map_err(|_|"Native Explorer action ledger unavailable")?;
    let successful:Vec<_>=rows.iter().filter(|row|row.session_id==claim.session_id
        && row.workflow_id.as_deref()==Some(claim.workflow_id.as_str())
        && row.explorer_operation_id.as_deref()==Some(claim.operation_id.as_str()) && row.issued_at>=claim.claimed_at
        && row.action_id.starts_with(&format!("explorer-{}-",claim.operation_id))
        && row.result.as_ref().is_some_and(|result|result.as_ref().is_ok_and(|receipt|receipt.injected&&receipt.dispatch_status=="dispatched"))).collect();
    let chord=|row:&&NativeActionEntry,key:&str|row.action=="hotkey"&&row.keys.as_ref().is_some_and(|keys|keys.len()==2
        && keys.iter().any(|token|token.eq_ignore_ascii_case("ctrl")||token.eq_ignore_ascii_case("control"))
        && keys.iter().any(|token|token.eq_ignore_ascii_case(key)));
    match claim.operation.as_str(){
        "copy"|"move"|"undo"=>{
            if claim.operation=="undo"&&!matches!(claim.reverse_of.as_deref(),Some("copy"|"move")){
                return Err("Explorer undo lacks authoritative reverse-operation binding".into());
            }
            let source_key=if claim.operation=="copy"{"c"}else{"x"};
            let source=successful.iter().filter(|row|chord(row,source_key)).map(|row|row.issued_at).max();
            let paste=successful.iter().filter(|row|chord(row,"v")).map(|row|row.issued_at).max();
            if source.is_none()||paste.is_none()||paste<=source{return Err("Explorer transfer lacks ordered native source and paste dispatch evidence".into());}
        }
        "find"=>{if !successful.iter().any(|row|row.action=="clickMouse"){return Err("Native FIND lacks actual bounded source-item click dispatch".into());}}
        _=>return Err("Explorer claim operation is outside native GUI proof allowlist".into()),
    }
    Ok(())
}

fn explorer_destination_proof(claim:&NativeExplorerClaim,controls:&[crate::native_uia::ControlState])->Result<(),String>{
    crate::native_app_workflows::explorer_selection_proof(controls,&claim.destination_path)
}

#[tauri::command]
pub async fn computer_explorer_text(state:State<'_,ComputerState>,session_id:String,workflow_id:String,operation_id:String,intent:String)->Result<String,String>{
    let guard=app_worker_guard(&state,&session_id,None,None,Some(&workflow_id))?;
    let epoch=guard.epoch;
    if !state.explorer_claims.lock().map_err(|_|"Native Explorer claim bindings unavailable")?.iter().any(|c|
        c.session_id==session_id&&c.operation_id==operation_id&&c.workflow_id==workflow_id&&c.epoch==epoch&&c.expires_at>now_ms()){
        return Err("Explorer text requires the current native claim and reservation".into());
    }
    let post=guard.clone();let dispatch=Arc::clone(&state.action_dispatch);
    let text=tauri::async_runtime::spawn_blocking(move||{
        guard.check()?;let _dispatch=dispatch.lock().map_err(|_|"Explorer text dispatcher unavailable")?;guard.check()?;
        let text=crate::native_app_workflows::explorer_text(&guard.bridge.token,guard.bridge.port,&session_id,&operation_id,&intent,&||guard.check());
        app_result_after(text,||guard.check())
    }).await.unwrap_or_else(|_|Err("Explorer text worker failed".into()));
    app_result_after(text,||post.check())
}

#[tauri::command]
pub async fn computer_explorer_exchange(state:State<'_,ComputerState>,session_id:String,operation_id:String,action:String,workflow_id:Option<String>)->Result<serde_json::Value,String>{
    if !matches!(action.as_str(),"check"|"readback"|"quarantine"|"finish"|"cancel"){return Err("Explorer exchange action is outside the native allowlist".into());}
    let epoch=state.session_generation.load(Ordering::SeqCst);
    let claim=state.explorer_claims.lock().map_err(|_|"Native Explorer claim bindings unavailable")?.iter()
        .find(|claim|claim.session_id==session_id&&claim.operation_id==operation_id&&claim.epoch==epoch&&claim.expires_at>now_ms()&&Some(claim.workflow_id.as_str())==workflow_id.as_deref()).cloned()
        .ok_or("Native Explorer operation is not claimed for the current owner session")?;
    let semantic=matches!(action.as_str(),"readback"|"finish");
    let observation=if semantic{Some(state.last_observation.lock().map_err(|_|"Native Explorer observation unavailable")?.clone().ok_or("Native Explorer observation missing")?)}else{None};
    let mut guard=app_worker_guard(&state,&session_id,None,observation,workflow_id.as_deref())?;
    guard.deadline=guard.deadline.min(claim.expires_at);guard.check()?;
    let dispatch_guard=guard.clone();
    let action_ledger=Arc::clone(&state.action_ledger);let worker_session=session_id.clone();let worker_operation=operation_id.clone();let worker_action=action.clone();
    let worker=move|guard_fn:&dyn Fn()->Result<(),String>|{
        guard_fn()?;
        if semantic{
            let observation=guard.observation.as_ref().ok_or("Explorer foreground observation missing")?;
            let hwnd=observation_hwnd(observation)?;
            let query=crate::native_app_operators::locate(crate::native_app_operators::AllowedApp::Explorer);
            guard_fn()?;
            if !query?.iter().any(|window|window.handle==hwnd as usize&&window.process_id==observation.window_process_id){return Err("Explorer readback requires an actual installed Explorer foreground window".into());}
            explorer_gui_proof(&action_ledger,&claim)?;
            let controls=crate::native_app_workflows::snapshot(hwnd,observation.window_process_id,guard_fn)?;
            explorer_destination_proof(&claim,&controls)?;
            let focused=crate::native_uia::focused_control(hwnd,observation.window_process_id)?;guard_fn()?;
            let filename=claim.destination_path.rsplit_once(['\\','/']).ok_or("Approved Explorer destination name missing")?.1;
            if !matches!(focused.control_type,50007|50029)||focused.selected!=Some(true)||focused.name!=filename{
                return Err("Explorer completion requires actual keyboard focus on the uniquely selected approved item".into());
            }
            guard_fn()?;
        }
        let result=crate::native_app_workflows::explorer_exchange(&guard.bridge.token,guard.bridge.port,&worker_session,&worker_operation,&worker_action,None,guard_fn)?;
        guard_fn()?;
        // Only public receipt fields cross into JS. Private authority and paths stay native.
        let mut public=serde_json::json!({"success":true});
        if worker_action=="finish"{
            let task=crate::native_app_workflows::explorer_complete(&guard.bridge.token,guard.bridge.port,&worker_session,&claim.workflow_id,&worker_operation,claim.operation=="find",guard_fn)?;
            public["bindingId"]=task["bindingId"].clone();public["taskId"]=task["taskId"].clone();
            if let Some(state)=task.get("taskState"){public["taskState"]=state.clone();}
        }
        if worker_action=="readback"{
            for field in ["source","destination"]{
                let file=&result["readback"][field];public["readback"][field]=if file.is_null(){serde_json::Value::Null}else if field=="source"{serde_json::json!({"contentSha256":file["contentSha256"]})}else{serde_json::json!({"identity":file["identity"],"contentSha256":file["contentSha256"]})};
            }
        }
        Ok(public)
    };
    if matches!(action.as_str(),"quarantine"|"finish"|"cancel"){
        let key=format!("explorer-{operation_id}-{action}");
        let parameters=serde_json::json!({"command":"computer_explorer_exchange","sessionId":session_id,"operationId":operation_id,"action":action,"workflowId":workflow_id});
        app_mutation(&state,&session_id,&operation_id,&key,parameters,dispatch_guard,worker).await
    }else{
        let post_guard=dispatch_guard.clone();let dispatch=Arc::clone(&state.action_dispatch);
        let mut result=tauri::async_runtime::spawn_blocking(move||{
            let _dispatch=dispatch.lock().map_err(|_|"Native Explorer dispatcher unavailable")?;
            dispatch_guard.check()?;let result=worker(&||dispatch_guard.check());app_result_after(result,||dispatch_guard.check())
        }).await.unwrap_or_else(|_|Err("Native Explorer exchange worker failed".into()));
        result=app_result_after(result,||app_result_after(post_guard.check(),||require_session(&state,&session_id)));
        if result.is_err(){crate::native_app_workflows::task_block(&session_id,workflow_id.as_deref());}result
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerStatus {
    pub runtime: &'static str,
    #[serde(skip_serializing_if="Option::is_none")]
    pub scoped_stop_contract:Option<&'static str>,
    pub mode: &'static str,
    pub available: bool,
    pub screen_capture: &'static str,
    pub mouse_control: &'static str,
    pub keyboard_control: &'static str,
    pub owner_command_mode: bool,
    pub kill_switch: &'static str,
    pub overlay: &'static str,
    pub native_overlay_ready: bool,
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
    #[serde(skip)]
    native_identity: Option<crate::native_calculator_identity::NativeWindowIdentity>,
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

#[derive(Clone,Deserialize,Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeSemanticTarget {pub target_id:String,#[serde(flatten)]pub metadata:serde_json::Map<String,serde_json::Value>}

#[derive(Clone,Deserialize,Serialize)]
#[serde(deny_unknown_fields)]
pub struct NativePoint {pub x:i32,pub y:i32}

#[derive(Clone,Deserialize,Serialize)]
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
    pub application_id:Option<String>,
    pub approval_id:Option<String>,
    pub focus_target:Option<crate::native_app_operators::FocusTarget>,
    pub target: Option<NativeSemanticTarget>,
    pub deadline_at: String,
    pub drag_start:Option<NativePoint>,
    pub drag_end:Option<NativePoint>,
    pub drag_duration_ms:Option<u64>,
    pub destination_target:Option<NativeSemanticTarget>,
    pub attempt:Option<u8>,
    pub idempotency_key:Option<String>,
    #[serde(flatten)]
    pub extra:serde_json::Map<String,serde_json::Value>,
}

#[derive(Clone,Serialize)]
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
    pub launched_process_id: Option<u32>,
    #[serde(skip_serializing_if="Option::is_none")]
    pub partial_input_injected:Option<bool>,
    #[serde(skip_serializing_if="Option::is_none")]
    pub release_confirmed:Option<bool>,
    #[serde(skip_serializing_if="Option::is_none")]
    pub error_code:Option<&'static str>,
    #[serde(skip_serializing_if="Option::is_none")]
    pub focus_readback:Option<NativeFocusReadback>,
}

#[derive(Clone,Serialize)]
#[serde(rename_all="camelCase")]
pub struct NativeFocusReadback {source:&'static str,application_id:String,window_id:String,window_process_id:u32,image_path_fingerprint:String,matched:bool}

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
    let epoch=state.session_generation.load(Ordering::SeqCst);
    let bridge=safety_bridge(state);
    let original=state.native_safety.lock().map_err(|_|"NATIVE_SAFETY_STATE_UNAVAILABLE")?.clone();
    let result=bridge.as_ref().map_err(Clone::clone).and_then(check_kill_switch_bridge);
    if result.is_err(){
        if let(Ok(bridge),Some(original))=(&bridge,&original){safety_latch_original(bridge,&state.stopped,&state.session_generation,original);}
        let _life=state.carrier_stop_hooks.lifecycle.lock().map_err(|_|"NATIVE_SAFETY_STATE_UNAVAILABLE")?;
        let current=state.native_safety.lock().map_err(|_|"NATIVE_SAFETY_STATE_UNAVAILABLE")?;
        let same=match(&original,current.as_ref()){(Some(a),Some(b))=>same_safety_scope(a,b),(None,None)=>true,_=>false};
        if same&&(state.session_generation.load(Ordering::SeqCst)==epoch||original.as_ref().is_some_and(|s|current.as_ref().is_some_and(|c|same_safety_scope(s,c)&&c.latch.is_some()))){
            state.stopped.store(true,Ordering::SeqCst);if let Ok(mut targets)=state.ocr_targets.lock(){targets.invalidate_all();}
        }
    }result
}

fn check_kill_switch_bridge(bridge: &SafetyBridge) -> Result<(), String> {
    safety_poll_denial(safety_poll_facts(bridge)?)
}
fn safety_poll_denial((blocked,kill_active):(bool,bool))->Result<(),String>{
    if kill_active{Err("KILL_SWITCH_ACTIVE".into())}
    else if blocked{Err("Emergency stop is active. Computer Use is blocked.".into())}else{Ok(())}
}
fn native_safety_json(bridge:&SafetyBridge,route:&str,body:Option<&serde_json::Value>,scope:Option<&str>)->Result<serde_json::Value,String>{
    use std::io::Read;
    let client=reqwest::blocking::Client::builder().no_proxy().redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(2)).build().map_err(|_|"NATIVE_SAFETY_CLIENT_UNAVAILABLE")?;
    let url=format!("http://127.0.0.1:{}/api/computer-use/{route}",bridge.port);
    let mut request=match body{Some(body)=>client.post(url).json(body),None=>client.get(url)};
    request=request.bearer_auth(&bridge.token);
    if let Some(scope)=scope{request=request.header("x-edith-safety-session",scope);}
    let response=request.send().map_err(|_|"NATIVE_SAFETY_TRANSPORT_UNKNOWN")?;
    if !response.status().is_success(){return Err("NATIVE_SAFETY_AUTHORITY_UNAVAILABLE".into());}
    let mut bytes=Vec::new();response.take(16385).read_to_end(&mut bytes).map_err(|_|"NATIVE_SAFETY_RESPONSE_UNREADABLE")?;
    if bytes.len()>16384{return Err("NATIVE_SAFETY_RESPONSE_OVERSIZED".into());}
    let value:serde_json::Value=serde_json::from_slice(&bytes).map_err(|_|"NATIVE_SAFETY_RESPONSE_INVALID")?;
    if value["success"]!=serde_json::json!(true){return Err("NATIVE_SAFETY_RESPONSE_DENIED".into());}
    Ok(value)
}
fn native_iso(ms:u64)->Result<String,String>{
    chrono::DateTime::<chrono::Utc>::from_timestamp_millis(ms.try_into().map_err(|_|"NATIVE_TIME_INVALID")?)
        .map(|t|t.to_rfc3339_opts(chrono::SecondsFormat::Millis,true)).ok_or("NATIVE_TIME_INVALID".into())
}
fn native_time(value:&serde_json::Value)->Result<u64,String>{
    let text=value.as_str().ok_or("NATIVE_TIME_INVALID")?;
    let ms=chrono::DateTime::parse_from_rfc3339(text).map_err(|_|"NATIVE_TIME_INVALID")?.timestamp_millis();
    let ms:u64=ms.try_into().map_err(|_|"NATIVE_TIME_INVALID")?;
    if native_iso(ms)?!=text{return Err("NATIVE_TIME_NONCANONICAL".into());}Ok(ms)
}
fn safety_owner(bridge:&SafetyBridge)->Result<(String,u64),String>{
    let value=native_safety_json(bridge,"native-workflows/owner-context",None,None)?;
    let owner=value["context"]["ownerBindingId"].as_str().filter(|s|!s.is_empty()&&s.len()<=160&&s.bytes().all(|b|b.is_ascii_alphanumeric()||b"._:-".contains(&b))).ok_or("NATIVE_OWNER_INVALID")?;
    let expiry=value["context"]["ownerExpiresAt"].as_u64().filter(|t|*t>now_ms()).ok_or("NATIVE_OWNER_EXPIRED")?;
    Ok((owner.into(),expiry))
}
fn safety_enroll(bridge:&SafetyBridge,session_id:&str,epoch:u64,expiry:u64,boot_nonce:&str)->Result<NativeSafetySession,String>{
    if boot_nonce.is_empty(){return Err("NATIVE_BOOT_ENTROPY_UNAVAILABLE".into());}
    let(owner,owner_expiry)=safety_owner(bridge)?;
    let expiry=expiry.min(owner_expiry);
    let body=serde_json::json!({"schema":"edith.native-mobile/1","nativeSessionId":session_id,"ownerBindingId":owner,
        "originalGeneration":epoch,"sessionExpiresAt":native_iso(expiry)?,"nativeBootNonce":boot_nonce});
    let value=native_safety_json(bridge,"native-safety/session",Some(&body),None)?;
    let safety_session_ref=value["safetySessionRef"].as_str().filter(|s|!s.is_empty()&&s.len()<=160&&s.bytes().all(|b|b.is_ascii_alphanumeric()||b"._:-".contains(&b))).ok_or("NATIVE_SAFETY_SESSION_INVALID")?.to_owned();
    let expires_at_ms=native_time(&value["expiresAt"])?;
    if expires_at_ms<=now_ms()||expires_at_ms>expiry{return Err("NATIVE_SAFETY_EXPIRY_INVALID".into());}
    Ok(NativeSafetySession{safety_session_ref,native_session_id:session_id.into(),owner_binding_id:owner,
        original_generation:epoch,expires_at_ms,stop_request:None,latch:None,native_boot_nonce:boot_nonce.into(),retired:false,quiescent_at:None})
}
fn safety_poll(bridge:&SafetyBridge)->Result<bool,String>{
    safety_poll_facts(bridge).map(|(blocked,_)|blocked)
}
fn safety_poll_facts(bridge:&SafetyBridge)->Result<(bool,bool),String>{
    let retained=bridge.safety.lock().map_err(|_|"NATIVE_SAFETY_STATE_UNAVAILABLE")?.clone();
    let Some(session)=retained else{return safety_owner(bridge).map(|_|(false,false))};
    if session.retired{return safety_owner(bridge).map(|_|(false,false));}
    if session.latch.is_some(){return Err("NATIVE_SAFETY_LATCHED".into());}
    safety_poll_session_facts(bridge,&session)
}
fn safety_poll_session(bridge:&SafetyBridge,session:&NativeSafetySession)->Result<bool,String>{
    safety_poll_session_facts(bridge,session).map(|(blocked,_)|blocked)
}
fn safety_poll_session_facts(bridge:&SafetyBridge,session:&NativeSafetySession)->Result<(bool,bool),String>{
    if now_ms()>=session.expires_at_ms{return Err("NATIVE_SAFETY_EXPIRED".into());}
    let value=native_safety_json(bridge,"native-safety",None,Some(&session.safety_session_ref))?;
    safety_poll_response_facts(bridge,session,&value)
}
// Same production response path is callable by pure fixtures without transport.
// The factual kill flag is returned only after stop scope checks and retention.
fn safety_poll_response_facts(bridge:&SafetyBridge,session:&NativeSafetySession,value:&serde_json::Value)->Result<(bool,bool),String>{
    let kill=value["killSwitchActive"].as_bool().ok_or("NATIVE_SAFETY_KILL_UNKNOWN")?;
    let request=value.get("stopRequest").filter(|v|!v.is_null());
    if let Some(request)=request{
        let expires=native_time(&request["expiresAt"])?;
        let accepted=native_time(&request["acceptedAt"])?;
        if request["scope"]!="global"||request["state"]!="backend_accepted"
            ||request["safetySessionRef"]!=session.safety_session_ref||request["nativeSessionId"]!=session.native_session_id
            ||request["originalGeneration"].as_u64()!=Some(session.original_generation)
            ||request["stopRequestId"].as_str().is_none_or(|s|s.is_empty()||s.len()>160||!s.bytes().all(|b|b.is_ascii_alphanumeric()||b"._:-".contains(&b)))
            ||expires>session.expires_at_ms||expires>accepted.saturating_add(30000)||accepted>now_ms()||expires<=now_ms(){
            return Err("NATIVE_STOP_REQUEST_SCOPE_INVALID".into());
        }
        let mut current=bridge.safety.lock().map_err(|_|"NATIVE_SAFETY_STATE_UNAVAILABLE")?;
        let current=current.as_mut().filter(|s|s.safety_session_ref==session.safety_session_ref&&s.original_generation==session.original_generation).ok_or("NATIVE_SAFETY_SCOPE_CHANGED")?;
        if current.stop_request.as_ref().is_some_and(|old|old!=request){return Err("NATIVE_STOP_REQUEST_CHANGED".into());}
        current.stop_request=Some(request.clone());
    }
    Ok((kill||request.is_some(),kill))
}
fn termination_admit(life:&mut Option<NativeTermination>,scope:&NativeSafetySession){
    if life.as_ref().is_none_or(|t|!same_safety_scope(&t.original,scope)){
        *life=Some(NativeTermination{original:scope.clone(),complete:false,fault:false,busy:false});
    }
}
fn safety_latch_original(bridge:&SafetyBridge,stopped:&AtomicBool,generation:&AtomicU64,original:&NativeSafetySession)->Option<NativeStopFact>{
    let fact={
        let mut life=bridge.stop_hooks.lifecycle.lock().ok()?;
        let mut scope=bridge.safety.lock().ok()?;
        let scope=scope.as_mut().filter(|s|same_safety_scope(s,original)&&!s.retired)?;
        if let Some(fact)=&scope.latch{return Some(fact.clone());}
        let next=original.original_generation.checked_add(1)?;let observed=native_iso(now_ms()).ok()?;
        if generation.compare_exchange(original.original_generation,next,Ordering::SeqCst,Ordering::SeqCst).is_err(){return None;}
        stopped.store(true,Ordering::SeqCst);
        let fact=NativeStopFact{original_generation:original.original_generation,latched_generation:next,observed_at:observed};
        scope.latch=Some(fact.clone());termination_admit(&mut life,scope);fact
    };
    native_cleanup_epoch(&bridge.stop_hooks,original.original_generation);Some(fact)
}
fn publish_stop_phase(bridge:&SafetyBridge,scope:&NativeSafetySession,phase:&str)->Result<(),String>{
    let request=scope.stop_request.as_ref().ok_or("NATIVE_STOP_REQUEST_UNKNOWN")?;
    let latch=scope.latch.as_ref().ok_or("NATIVE_STOP_NOT_LATCHED")?;
    if now_ms()>=scope.expires_at_ms.min(native_time(&request["expiresAt"])?){return Err("NATIVE_STOP_RECEIPT_EXPIRED".into());}
    let mut body=serde_json::json!({"schema":"edith.native-mobile/1","stopRequestId":request["stopRequestId"],
        "safetySessionRef":scope.safety_session_ref,"nativeSessionId":scope.native_session_id,
        "originalGeneration":latch.original_generation,"latchedGeneration":latch.latched_generation,
        "observedAt":latch.observed_at,"phase":phase});
    if phase=="quiescent"{body["quiescentAt"]=serde_json::json!(scope.quiescent_at.as_ref().ok_or("NATIVE_QUIESCENCE_NOT_OBSERVED")?);}
    let response=native_safety_json(bridge,"native-safety/stop-receipt",Some(&body),Some(&scope.safety_session_ref))?;
    if response["accepted"]!=true||response["phase"]!=phase{return Err("NATIVE_STOP_RECEIPT_UNKNOWN".into());}Ok(())
}
fn native_retirement_body(scope:&NativeSafetySession)->serde_json::Value{
    serde_json::json!({"schema":"edith.native-mobile/1","safetySessionRef":scope.safety_session_ref,
        "nativeSessionId":scope.native_session_id,"nativeBootNonce":scope.native_boot_nonce,"originalGeneration":scope.original_generation})
}
fn same_safety_scope(a:&NativeSafetySession,b:&NativeSafetySession)->bool{
    a.safety_session_ref==b.safety_session_ref&&a.native_session_id==b.native_session_id
        &&a.owner_binding_id==b.owner_binding_id
        &&a.native_boot_nonce==b.native_boot_nonce&&a.original_generation==b.original_generation&&a.expires_at_ms==b.expires_at_ms
}
fn retire_native_session(bridge:&SafetyBridge,original:&NativeSafetySession)->Result<(),String>{
    let body=native_retirement_body(original);
    for attempt in 0..3{
        if now_ms()>=original.expires_at_ms{return Err("NATIVE_RETIREMENT_EXPIRED".into());}
        let result=native_safety_json(bridge,"native-safety/session/retire",Some(&body),Some(&original.safety_session_ref));
        if let Ok(response)=result{
            if response.as_object().is_some_and(|v|v.len()==4&&["success","retired","safetySessionRef","expiresAt"].iter().all(|k|v.contains_key(*k)))
                &&response["retired"]==true&&response["safetySessionRef"]==original.safety_session_ref
                &&native_time(&response["expiresAt"])?==original.expires_at_ms{
                let _life=bridge.stop_hooks.lifecycle.lock().map_err(|_|"NATIVE_SAFETY_STATE_UNAVAILABLE")?;
                let mut current=bridge.safety.lock().map_err(|_|"NATIVE_SAFETY_STATE_UNAVAILABLE")?;
                if let Some(current)=current.as_mut().filter(|s|same_safety_scope(s,original)){current.retired=true;}
                return Ok(());
            }
            return Err("NATIVE_RETIREMENT_ACK_INVALID".into());
        }
        if attempt<2{std::thread::sleep(Duration::from_millis(100));}
    }
    Err("NATIVE_RETIREMENT_ACK_UNKNOWN".into())
}
fn publish_stop_phase_retry(bridge:&SafetyBridge,scope:&NativeSafetySession,phase:&str)->bool{
    for attempt in 0..3{if publish_stop_phase(bridge,scope,phase).is_ok(){return true;}if attempt<2{std::thread::sleep(Duration::from_millis(100));}}
    false
}
fn finish_native_termination(bridge:&SafetyBridge,original:&NativeSafetySession,dispatch:&Arc<Mutex<()>>,correlate:bool){
    native_cleanup_epoch(&bridge.stop_hooks,original.original_generation);
    if correlate&&now_ms()<original.expires_at_ms{
        let needs=bridge.safety.lock().ok().is_some_and(|s|s.as_ref().is_some_and(|s|same_safety_scope(s,original)&&s.latch.is_some()&&s.stop_request.is_none()&&!s.retired));
        if needs{let _=safety_poll_session(bridge,original);}
    }
    let mut scope=bridge.safety.lock().ok().and_then(|s|s.as_ref().filter(|s|same_safety_scope(s,original)).cloned()).unwrap_or_else(||original.clone());
    let mut latched_ack=scope.latch.is_some()&&scope.stop_request.is_some()&&publish_stop_phase_retry(bridge,&scope,"latched");
    while now_ms()<original.expires_at_ms{
        let closed=(||{
            let life=bridge.stop_hooks.lifecycle.lock().ok()?;
            if bridge.stop_hooks.cleanup_fault.load(Ordering::SeqCst)||!life.as_ref().is_some_and(|t|same_safety_scope(&t.original,original)&&t.complete&&!t.fault&&!t.busy){return None;}
            let _witness=dispatch.try_lock().ok()?;
            if !crate::cross_device::native_carrier_quiescent()||!crate::native_uia::steam_main_worker_quiescent()
                ||bridge.stop_hooks.active_cleanup.load(Ordering::SeqCst)!=0{return None;}
            let mut current=bridge.safety.lock().ok()?;
            let current=current.as_mut().filter(|s|same_safety_scope(s,original)&&s.latch.is_some())?;
            if current.quiescent_at.is_none(){current.quiescent_at=native_iso(now_ms()).ok();}
            Some(current.clone()) // Held witness through the actual closure fact commit.
        })();
        if let Some(closed)=closed{
            scope=closed; // All state locks and dispatch witness released before HTTP.
            if !latched_ack&&scope.latch.is_some()&&scope.stop_request.is_some(){latched_ack=publish_stop_phase_retry(bridge,&scope,"latched");}
            if latched_ack{let _=publish_stop_phase_retry(bridge,&scope,"quiescent");}
            let _=retire_native_session(bridge,&scope);return;
        }        std::thread::sleep(Duration::from_millis(10));
    }
}
fn retire_abandoned_registration(bridge:SafetyBridge,original:NativeSafetySession,_dispatch:Arc<Mutex<()>>){
    // Never adopt an unactivated enrollment into the current session's authority.
    std::thread::spawn(move||{let _=retire_native_session(&bridge,&original);});
}
fn native_stop_monitor(bridge:SafetyBridge,stopped:Arc<AtomicBool>,generation:Arc<AtomicU64>,original:NativeSafetySession){
    // Hotkey/clear flag observation never waits for the blocking safety GET.
    while generation.load(Ordering::SeqCst)==original.original_generation&&!stopped.load(Ordering::SeqCst)&&now_ms()<original.expires_at_ms{
        std::thread::sleep(Duration::from_millis(5));
    }
    if generation.load(Ordering::SeqCst)==original.original_generation{
        safety_latch_original(&bridge,&stopped,&generation,&original);
    }else{native_cleanup_epoch(&bridge.stop_hooks,original.original_generation);}
}
fn safety_watchdog(bridge:SafetyBridge,stopped:Arc<AtomicBool>,generation:Arc<AtomicU64>,dispatch:Arc<Mutex<()>>,epoch:u64,original:NativeSafetySession){
    while generation.load(Ordering::SeqCst)==epoch&&!stopped.load(Ordering::SeqCst){
        if now_ms()>=original.expires_at_ms||safety_poll_session(&bridge,&original).unwrap_or(true){
            safety_latch_original(&bridge,&stopped,&generation,&original);break;
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    if generation.load(Ordering::SeqCst)==epoch&&stopped.load(Ordering::SeqCst){safety_latch_original(&bridge,&stopped,&generation,&original);}
    finish_native_termination(&bridge,&original,&dispatch,true);
}

fn require_session(state: &ComputerState, session_id: &str) -> Result<(), String> {
    if state.stopped.load(Ordering::SeqCst)||state.carrier_stop_hooks.active_cleanup.load(Ordering::SeqCst)!=0 {
        return Err("Computer Use was stopped. Start a new approved session.".into());
    }
    {let scope=state.native_safety.lock().map_err(|_|"NATIVE_SAFETY_STATE_UNAVAILABLE")?;
        if scope.as_ref().is_none_or(|s|s.native_session_id!=session_id||s.original_generation!=state.session_generation.load(Ordering::SeqCst)
            ||s.latch.is_some()||now_ms()>=s.expires_at_ms){return Err("NATIVE_SESSION_SCOPE_CHANGED".into());}}
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

fn semantic_context(state:&ComputerState,session_id:&str,observation_id:&str,generation:u64)->Result<ObservationContext,String>{
    require_session(state,session_id)?;check_kill_switch(state)?;
    let observation=state.last_observation.lock().map_err(|_|"Observation state unavailable")?.clone().ok_or("Observation missing")?;
    if observation.observation_id!=observation_id || observation.generation!=generation || observation.expires_at<=now_ms() || state.observation_generation.load(Ordering::SeqCst)!=generation {return Err("Semantic observation stale".into());}
    platform::validate_foreground(&observation)?;
    Ok(observation)
}
fn observation_hwnd(observation:&ObservationContext)->Result<isize,String>{
    isize::from_str_radix(observation.window_id.strip_prefix("hwnd:").ok_or("Invalid window identity")?,16).map_err(|_|"Invalid window identity".into())
}

#[tauri::command]
pub async fn computer_locate(state:State<'_,ComputerState>,session_id:String,observation_id:String,generation:u64,query:String,workflow_id:Option<String>)->Result<crate::native_uia::LocatedTarget,String>{
    workflow_context(&state,&session_id,workflow_id.as_deref())?;
    let observation=semantic_context(&state,&session_id,&observation_id,generation)?;
    let hwnd=observation_hwnd(&observation)?;
    let pid=observation.window_process_id;
    let guard=app_worker_guard(&state,&session_id,None,Some(observation),workflow_id.as_deref())?;
    let post_guard=guard.clone();let dispatch=Arc::clone(&state.action_dispatch);
    let worker_session=session_id.clone();let worker_workflow=workflow_id.clone();
    let target=tauri::async_runtime::spawn_blocking(move||{
        let _dispatch=dispatch.lock().map_err(|_|"Native locate dispatcher unavailable")?;
        guard.check()?;let result=if query=="__native_steam_game_entry__"{crate::native_app_workflows::task_game_target(&worker_session,worker_workflow.as_deref().ok_or("Native Steam reservation required")?,hwnd,pid,&||guard.check())}else{crate::native_uia::locate(hwnd,pid,&query)};guard.check()?;result
    }).await.map_err(|_|"UIA worker failed")??;
    semantic_context(&state,&session_id,&observation_id,generation)?;
    post_guard.check()?;
    state.uia_ready.store(true,Ordering::SeqCst);
    if let Ok(overlay)=state.overlay.lock(){if let Some(overlay)=overlay.as_ref(){let _=overlay.update("target",target.x+target.width/2,target.y+target.height/2);}}
    Ok(target)
}

#[tauri::command]
pub async fn computer_read_text(state:State<'_,ComputerState>,session_id:String,observation_id:String,generation:u64,workflow_id:Option<String>)->Result<String,String>{
    workflow_context(&state,&session_id,workflow_id.as_deref())?;
    let observation=semantic_context(&state,&session_id,&observation_id,generation)?;
    let hwnd=observation_hwnd(&observation)?;
    let pid=observation.window_process_id;
    let guard=app_worker_guard(&state,&session_id,None,Some(observation),workflow_id.as_deref())?;
    let post_guard=guard.clone();let dispatch=Arc::clone(&state.action_dispatch);
    let text=tauri::async_runtime::spawn_blocking(move||{
        let _dispatch=dispatch.lock().map_err(|_|"Native text dispatcher unavailable")?;
        guard.check()?;let result=crate::native_uia::read_text(hwnd,pid);guard.check()?;result
    }).await.map_err(|_|"UIA worker failed")??;
    semantic_context(&state,&session_id,&observation_id,generation)?;
    post_guard.check()?;
    state.uia_ready.store(true,Ordering::SeqCst);
    Ok(text)
}

#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct BoundOcrResult {observation_id:String,generation:u64,origin_x:i32,origin_y:i32,result:crate::native_ocr::OcrResult}

// Only cached native observations enter OCR. No command accepts caller pixels,
// geometry, executable claims, fingerprints, or verification receipts.
fn recognize_cached_ocr(image:&str,guard:&dyn Fn()->Result<(),String>)->Result<crate::native_ocr::OcrResult,String>{
    guard()?;
    use base64::Engine;
    if image.len()>90*1024*1024{return Err("OCR image budget exceeded".into());}
    let bytes=base64::engine::general_purpose::STANDARD.decode(image.strip_prefix("data:image/png;base64,").ok_or("Observation format invalid")?).map_err(|_|"Observation format invalid")?;
    let mut reader=png::Decoder::new(std::io::Cursor::new(bytes)).read_info().map_err(|_|"Observation PNG invalid")?;
    let info=reader.info();
    if info.width==0||info.height==0||info.width>4096||info.height>4096||reader.output_buffer_size()>64*1024*1024{return Err("OCR image budget exceeded".into());}
    let mut pixels=vec![0;reader.output_buffer_size()];let frame=reader.next_frame(&mut pixels).map_err(|_|"Observation PNG invalid")?;
    if frame.color_type!=png::ColorType::Rgb||frame.bit_depth!=png::BitDepth::Eight{return Err("Observation pixel format invalid".into());}
    let mut rgba=Vec::with_capacity(frame.width as usize*frame.height as usize*4);
    for pixel in pixels[..frame.buffer_size()].chunks_exact(3){rgba.extend_from_slice(pixel);rgba.push(255);}
    guard()?;
    let result=crate::native_ocr::recognize_rgba_guarded(frame.width,frame.height,&rgba,guard)?;
    guard()?;Ok(result)
}

fn ocr_identity_fingerprint(observation:&ObservationContext)->Result<String,String>{
    use sha2::{Digest,Sha256};
    let approved=platform::approved_ocr_image(observation)?;
    let identity=observation.native_identity.as_ref().ok_or("OCR retained native process identity missing")?;
    crate::native_calculator_identity::revalidate(identity)?;
    Ok(format!("{:x}",Sha256::digest(format!("ocr-native-identity-v1|{approved}|{identity:?}").as_bytes())))
}
fn ocr_frame_context(observation:&ObservationContext,session_id:&str,incarnation:u64,workflow_id:Option<&str>,authority_expiry:u64)->Result<crate::native_ocr_targets::FrameContext,String>{
    if !observation.scale_factor.is_finite()||observation.scale_factor<=0.0||observation.scale_factor>8.0{return Err("OCR physical frame DPI invalid".into());}
    let image_path_fingerprint=ocr_identity_fingerprint(observation)?;
    let bounds=&observation.window_bounds;
    Ok(crate::native_ocr_targets::FrameContext{
        session_id:session_id.into(),incarnation,workflow_id:workflow_id.map(str::to_string),
        observation_id:observation.observation_id.clone(),generation:observation.generation,
        window_id:observation.window_id.clone(),pid:observation.window_process_id,image_path_fingerprint,
        origin:[observation.virtual_bounds.x,observation.virtual_bounds.y],width:observation.virtual_bounds.width.try_into().map_err(|_|"OCR frame width invalid")?,
        height:observation.virtual_bounds.height.try_into().map_err(|_|"OCR frame height invalid")?,
        window_bounds:[bounds.x,bounds.y,bounds.x.checked_add(bounds.width).ok_or("OCR window overflow")?,bounds.y.checked_add(bounds.height).ok_or("OCR window overflow")?],
        captured_at:observation.captured_at,expires_at:authority_expiry.min(observation.expires_at),
    })
}

fn fresh_ocr_frame(context:&crate::native_ocr_targets::FrameContext,observation:&ObservationContext,guard:&dyn Fn()->Result<(),String>,poll_guard:&dyn Fn()->Result<(),String>)->Result<crate::native_ocr_targets::Frame,String>{
    guard()?;platform::validate_foreground(observation)?;
    let image_fingerprint=ocr_identity_fingerprint(observation)?;
    if image_fingerprint!=context.image_path_fingerprint{return Err("OCR process identity changed".into());}
    let fresh=platform::observe(observation.generation)?;
    guard()?;
    if fresh.window_id!=context.window_id||fresh.window_process_id!=context.pid
        ||fresh.native_identity!=observation.native_identity
        ||fresh.monitor_id!=observation.monitor_id||fresh.scale_factor!=observation.scale_factor
        ||fresh.origin_x!=context.origin[0]||fresh.origin_y!=context.origin[1]||fresh.width!=context.width as i32||fresh.height!=context.height as i32
        ||[fresh.window_bounds.x,fresh.window_bounds.y,fresh.window_bounds.x.saturating_add(fresh.window_bounds.width),fresh.window_bounds.y.saturating_add(fresh.window_bounds.height)]!=context.window_bounds{
        return Err("OCR actual capture frame changed".into());
    }
    let ocr=recognize_cached_ocr(&fresh.image_data_url,poll_guard)?;
    guard()?;
    if ocr_identity_fingerprint(observation)?!=context.image_path_fingerprint{return Err("OCR process identity changed after provider await".into());}
    platform::validate_foreground(observation)?;
    let mut current=context.clone();current.captured_at=fresh.captured_at;
    Ok(crate::native_ocr_targets::Frame{context:current,ocr})
}

#[tauri::command]
pub async fn computer_locate_ocr(state:State<'_,ComputerState>,session_id:String,observation_id:String,generation:u64,query:String,postcondition:crate::native_ocr_targets::Postcondition,workflow_id:Option<String>)->Result<crate::native_ocr_targets::IssuedTarget,String>{
    if postcondition.kind!="unique_text_transition"||[query.as_str(),postcondition.before_text.as_str(),postcondition.after_text.as_str()].iter().any(|value|{
        let value=value.trim();value.is_empty()||value.chars().count()>160||value.chars().any(char::is_control)
    }){return Err("OCR owner intent requires a bounded semantic transition".into());}
    workflow_context(&state,&session_id,workflow_id.as_deref())?;
    let observation=semantic_context(&state,&session_id,&observation_id,generation)?;
    let image=state.last_image.lock().map_err(|_|"Observation image unavailable")?.clone().filter(|(stored,_)|*stored==generation).ok_or("Observation image stale")?.1;
    let mut guard=app_worker_guard(&state,&session_id,None,Some(observation.clone()),workflow_id.as_deref())?;
    guard.deadline=guard.deadline.min(observation.captured_at.saturating_add(5000));guard.check()?;
    let post_guard=guard.clone();let dispatch=Arc::clone(&state.action_dispatch);let registry=Arc::clone(&state.ocr_targets);
    let expiry=guard.reservation.lock().map_err(|_|"OCR reservation unavailable")?.as_ref().map_or(guard.deadline,|r|guard.deadline.min(r.expires_at));
    let context=ocr_frame_context(&observation,&session_id,guard.epoch,workflow_id.as_deref(),expiry)?;
    let worker_session=session_id.clone();let worker_workflow=workflow_id.clone();
    let target=tauri::async_runtime::spawn_blocking(move||{
        let _dispatch=dispatch.lock().map_err(|_|"Native OCR locate dispatcher unavailable")?;
        guard.check()?;
        // The native boundary independently establishes fallback eligibility;
        // no frontend error string or caller assertion supplies authority.
        let eligibility=crate::native_uia::locate(observation_hwnd(&observation)?,observation.window_process_id,query.trim());
        guard.check()?;
        match eligibility{
            Err(code)if code=="UIA_TARGET_NOT_FOUND"||code=="UIA_PROVIDER_UNAVAILABLE"=>{},
            Err(code)=>return Err(code),
            Ok(_)=>return Err("OCR fallback is unavailable when native UIA has a target".into()),
        }
        let ocr=recognize_cached_ocr(&image,&||guard.check_local())?;
        guard.check()?;
        if platform::approved_ocr_image(&observation)?!=context.image_path_fingerprint{return Err("OCR process identity changed".into());}
        registry.lock().map_err(|_|"OCR registry unavailable")?.issue(&crate::native_ocr_targets::Frame{context,ocr},&query,&postcondition,true,now_ms())
    }).await.map_err(|_|"OCR locate worker failed")??;
    semantic_context(&state,&session_id,&observation_id,generation)?;post_guard.check()?;
    state.ocr_ready.store(true,Ordering::SeqCst);Ok(target)
}

#[tauri::command]
pub async fn computer_ocr_readback(state:State<'_,ComputerState>,session_id:String,target_id:String,canonical_action_id:String,post_observation_id:String,generation:u64,workflow_id:Option<String>)->Result<crate::native_ocr_targets::ReadbackReceipt,String>{
    workflow_context(&state,&session_id,workflow_id.as_deref())?;
    let observation=semantic_context(&state,&session_id,&post_observation_id,generation)?;
    let image=state.last_image.lock().map_err(|_|"Observation image unavailable")?.clone().filter(|(stored,_)|*stored==generation).ok_or("Observation image stale")?.1;
    let mut guard=app_worker_guard(&state,&session_id,None,Some(observation.clone()),workflow_id.as_deref())?;
    guard.deadline=guard.deadline.min(state.ocr_targets.lock().map_err(|_|"OCR registry unavailable")?.expires_at(&target_id,now_ms())?);guard.check()?;
    let post_guard=guard.clone();let dispatch=Arc::clone(&state.action_dispatch);let registry=Arc::clone(&state.ocr_targets);
    let expiry=guard.reservation.lock().map_err(|_|"OCR reservation unavailable")?.as_ref().map_or(guard.deadline,|r|guard.deadline.min(r.expires_at));
    let context=ocr_frame_context(&observation,&session_id,guard.epoch,workflow_id.as_deref(),expiry)?;
    let receipt=tauri::async_runtime::spawn_blocking(move||{
        let _dispatch=dispatch.lock().map_err(|_|"Native OCR readback dispatcher unavailable")?;
        guard.check()?;let ocr=recognize_cached_ocr(&image,&||guard.check_local())?;guard.check()?;
        if platform::approved_ocr_image(&observation)?!=context.image_path_fingerprint{return Err("OCR process identity changed after readback".into());}
        registry.lock().map_err(|_|"OCR registry unavailable")?.readback(&target_id,&canonical_action_id,&crate::native_ocr_targets::Frame{context,ocr},true,now_ms())
    }).await.map_err(|_|"OCR readback worker failed")??;
    semantic_context(&state,&session_id,&post_observation_id,generation)?;post_guard.check()?;Ok(receipt)
}

#[tauri::command]
pub async fn computer_ocr(state:State<'_,ComputerState>,session_id:String,observation_id:String,generation:u64,workflow_id:Option<String>)->Result<BoundOcrResult,String>{
    workflow_context(&state,&session_id,workflow_id.as_deref())?;
    let observation=semantic_context(&state,&session_id,&observation_id,generation)?;
    let image=state.last_image.lock().map_err(|_|"Observation image unavailable")?.clone().filter(|(stored,_)|*stored==generation).ok_or("Observation image stale")?.1;
    let guard=app_worker_guard(&state,&session_id,None,Some(observation.clone()),workflow_id.as_deref())?;
    let post_guard=guard.clone();let dispatch=Arc::clone(&state.action_dispatch);
    let result=tauri::async_runtime::spawn_blocking(move||->Result<crate::native_ocr::OcrResult,String>{
        let _dispatch=dispatch.lock().map_err(|_|"Native OCR dispatcher unavailable")?;
        guard.check()?;let result=recognize_cached_ocr(&image,&||guard.check_local());guard.check()?;result
    }).await.map_err(|_|"OCR worker failed")??;
    semantic_context(&state,&session_id,&observation_id,generation)?;
    post_guard.check()?;
    state.ocr_ready.store(true,Ordering::SeqCst);
    Ok(BoundOcrResult{observation_id,generation,origin_x:observation.virtual_bounds.x,origin_y:observation.virtual_bounds.y,result})
}

fn native_scoped_stop_contract()->Option<&'static str>{
    if cfg!(windows){Some("edith.computer.expected-session-stop/1")}else{None}
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
        Err(message) if message=="KILL_SWITCH_ACTIVE"||message.contains("Emergency stop is active") => "active",
        Err(_) => "unknown",
    };
    ComputerStatus {
        runtime: if cfg!(windows) { "tauri" } else { "unbound" },
        scoped_stop_contract:native_scoped_stop_contract(),
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
        native_overlay_ready: active && state.overlay.lock().map(|overlay| overlay.is_some()).unwrap_or(false),
        targeting: if active && state.uia_ready.load(Ordering::SeqCst) {"uia_first"} else {"window_relative_fallback"},
        uia: if active && state.uia_ready.load(Ordering::SeqCst) {"ready"} else {"missing"},
        ocr: if active && state.ocr_ready.load(Ordering::SeqCst) {"ready"} else {"missing"},
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

fn native_activation_ready(life:&Option<NativeTermination>,hooks:&CarrierStopHooks)->bool{
    !hooks.cleanup_fault.load(Ordering::SeqCst)&&hooks.active_cleanup.load(Ordering::SeqCst)==0&&life.as_ref().is_none_or(|t|t.complete&&!t.fault&&!t.busy)
}
fn native_activate(state:&ComputerState,session:ComputerSession,enrollment:&NativeSafetySession,approval_generation:u64,previous:Option<&NativeSafetySession>)->Result<(),String>{
    let mut life=state.carrier_stop_hooks.lifecycle.lock().map_err(|_|"NATIVE_PREVIOUS_SCOPE_NOT_QUIESCENT")?;
    let mut current=state.session.lock().map_err(|_|"Computer Use state unavailable.")?;
    let mut scope=state.native_safety.lock().map_err(|_|"NATIVE_SAFETY_STATE_UNAVAILABLE")?;
    if !native_activation_ready(&life,&state.carrier_stop_hooks)||state.session_generation.load(Ordering::SeqCst)!=approval_generation{
        return Err("approval_cancelled: Computer Use was stopped during owner approval.".into());
    }
    let unchanged=match(scope.as_ref(),previous){(Some(a),Some(b))=>same_safety_scope(a,b),(None,None)=>true,_=>false};
    if !unchanged||current.as_ref().is_some_and(|s|scope.as_ref().is_none_or(|n|n.native_session_id!=s.id))
        ||(current.is_none()&&scope.as_ref().is_some_and(|s|s.latch.is_none()&&!s.retired)){return Err("NATIVE_SAFETY_SCOPE_CHANGED".into());}
    if state.overlay.lock().map_err(|_|"Overlay state unavailable.")?.is_some(){return Err("NATIVE_PREVIOUS_SCOPE_NOT_QUIESCENT".into());}
    let epoch=approval_generation.checked_add(1).ok_or("NATIVE_GENERATION_EXHAUSTED")?;
    if enrollment.original_generation!=epoch||enrollment.native_session_id!=session.id||enrollment.retired||enrollment.latch.is_some(){return Err("NATIVE_SAFETY_SCOPE_CHANGED".into());}
    let mut observation=state.last_observation.lock().map_err(|_|"Observation state unavailable.")?;
    let mut image=state.last_image.lock().map_err(|_|"Observation image state unavailable")?;
    // Gate serializes every generation/latch commit; raw input failure writers
    // cannot race begin because the caller retains the dedicated dispatcher.
    state.stopped.store(false,Ordering::SeqCst);
    if state.session_generation.compare_exchange(approval_generation,epoch,Ordering::SeqCst,Ordering::SeqCst).is_err(){state.stopped.store(true,Ordering::SeqCst);return Err("Native approval cancelled by STOP".into());}
    *current=Some(session);*scope=Some(enrollment.clone());*life=None;
    // Cached old observations may have completed before this activation only.
    observation.take();image.take();
    let _=state.browser_foundation.invalidate_scope();Ok(())
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
        let _dispatch=state.action_dispatch.try_lock().map_err(|_|"Native owner approval dispatcher busy")?;
        {
            let life=state.carrier_stop_hooks.lifecycle.lock().map_err(|_|"NATIVE_PREVIOUS_SCOPE_NOT_QUIESCENT")?;
            if !native_activation_ready(&life,&state.carrier_stop_hooks){return Err("NATIVE_PREVIOUS_SCOPE_NOT_QUIESCENT".into());}
        }
        workflow_context(&state,"",None)?;
        let expired=state.native_safety.lock().map_err(|_|"NATIVE_SAFETY_STATE_UNAVAILABLE")?.as_ref().filter(|s|now_ms()>=s.expires_at_ms).cloned();
        if let Some(expired)=expired{
            if expired.latch.is_none(){
                let bridge=safety_bridge(&state)?;safety_latch_original(&bridge,&state.stopped,&state.session_generation,&expired);
                return Err("NATIVE_PREVIOUS_SCOPE_NOT_QUIESCENT".into());
            }
            let life=state.carrier_stop_hooks.lifecycle.lock().map_err(|_|"NATIVE_PREVIOUS_SCOPE_NOT_QUIESCENT")?;
            if !native_activation_ready(&life,&state.carrier_stop_hooks)
                ||!life.as_ref().is_some_and(|t|same_safety_scope(&t.original,&expired)&&t.complete&&!t.fault)
                ||!crate::cross_device::native_carrier_quiescent()||!crate::native_uia::steam_main_worker_quiescent(){return Err("NATIVE_PREVIOUS_SCOPE_NOT_QUIESCENT".into());}
            let mut current=state.session.lock().map_err(|_|"Computer Use state unavailable.")?;
            let mut scope=state.native_safety.lock().map_err(|_|"NATIVE_SAFETY_STATE_UNAVAILABLE")?;
            if scope.as_ref().is_some_and(|s|same_safety_scope(s,&expired)&&now_ms()>=s.expires_at_ms){scope.take();current.take();}
        }        let(approval_generation,previous_scope)={
            let life=state.carrier_stop_hooks.lifecycle.lock().map_err(|_|"NATIVE_PREVIOUS_SCOPE_NOT_QUIESCENT")?;
            if !native_activation_ready(&life,&state.carrier_stop_hooks){return Err("NATIVE_PREVIOUS_SCOPE_NOT_QUIESCENT".into());}
            let current=state.session.lock().map_err(|_|"Computer Use state unavailable.")?;
            let scope=state.native_safety.lock().map_err(|_|"NATIVE_SAFETY_STATE_UNAVAILABLE")?;
            if current.as_ref().is_some_and(|s|scope.as_ref().is_none_or(|n|n.native_session_id!=s.id)){return Err("NATIVE_SAFETY_SCOPE_CHANGED".into());}
            (state.session_generation.load(Ordering::SeqCst),scope.clone())
        };
        check_kill_switch(&state)?;
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            MessageBoxW, IDYES, MB_DEFBUTTON2, MB_ICONWARNING, MB_SETFOREGROUND, MB_TOPMOST,
            MB_YESNO,
        };
        let owner = window
            .hwnd()
            .map_err(|_| "Could not bind the owner approval dialog to the E.D.I.T.H. window.")?
            .0;
        let message: Vec<u16> = "Allow E.D.I.T.H. to observe and control this computer for up to 5 minutes?\n\nOnly actions you start in Computer Use will run. Stop ends the session; Ctrl+Shift+F12 also stops input while the native overlay is active. Screen images stay in this desktop window.\0".encode_utf16().collect();
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
        if state.session_generation.load(Ordering::SeqCst) != approval_generation||state.carrier_stop_hooks.active_cleanup.load(Ordering::SeqCst)!=0 {
            return Err("approval_cancelled: Computer Use was stopped during owner approval.".into());
        }
        let mut session_nonce=[0u8;16];getrandom::fill(&mut session_nonce).map_err(|_|"NATIVE_SESSION_ENTROPY_UNAVAILABLE")?;
        let id = format!("computer-{}-{:032x}", now_ms(),u128::from_le_bytes(session_nonce));
        let session = ComputerSession {
            id: id.clone(),
            expires_at: SystemTime::now() + SESSION_TTL,
        };
        let bridge=safety_bridge(&state)?;
        let epoch=approval_generation.checked_add(1).ok_or("NATIVE_GENERATION_EXHAUSTED")?;
        let expiry=session.expires_at.duration_since(UNIX_EPOCH).map_err(|_|"NATIVE_SESSION_TIME_INVALID")?.as_millis() as u64;
        let enrollment=safety_enroll(&bridge,&id,epoch,expiry,&state.native_boot_nonce)?;
        if let Err(error)=native_activate(&state,session,&enrollment,approval_generation,previous_scope.as_ref()){
            retire_abandoned_registration(bridge.clone(),enrollment.clone(),Arc::clone(&state.action_dispatch));return Err(error);
        }
        let monitor_bridge=bridge.clone();let monitor_original=enrollment.clone();
        let monitor_stopped=Arc::clone(&state.stopped);let monitor_generation=Arc::clone(&state.session_generation);
        std::thread::spawn(move||native_stop_monitor(monitor_bridge,monitor_stopped,monitor_generation,monitor_original));
        let stopped=Arc::clone(&state.stopped);
        let generation=Arc::clone(&state.session_generation);
        let browser_foundation=Arc::clone(&state.browser_foundation);
        let dispatch=Arc::clone(&state.action_dispatch);
        let watch_bridge=bridge.clone();let watch_original=enrollment.clone();let watch_hooks=Arc::clone(&state.carrier_stop_hooks);
        std::thread::spawn(move||{
            safety_watchdog(watch_bridge,stopped,Arc::clone(&generation),Arc::clone(&dispatch),epoch,watch_original);
            if let Ok(_quiet)=dispatch.try_lock(){
                let Ok(_life)=watch_hooks.lifecycle.lock()else{return;};
                let admitted=watch_hooks.safety.lock().ok().is_some_and(|s|s.as_ref().is_some_and(|s|s.original_generation==epoch));
                if admitted&&(generation.load(Ordering::SeqCst)==epoch||epoch.checked_add(1)==Some(generation.load(Ordering::SeqCst))){
                    let _=browser_foundation.invalidate_scope();
                }
            }
        });
        // Show only after approval. Failure remains visible in status, never a
        // fabricated ready claim. Coordinates come from native monitor geometry.
        let monitors = platform::monitors().unwrap_or_default();
        if !monitors.is_empty() {
            let x=monitors.iter().map(|m|m.bounds.x).min().unwrap();
            let y=monitors.iter().map(|m|m.bounds.y).min().unwrap();
            let right=monitors.iter().map(|m|m.bounds.x.saturating_add(m.bounds.width)).max().unwrap();
            let bottom=monitors.iter().map(|m|m.bounds.y.saturating_add(m.bounds.height)).max().unwrap();
            let overlay = crate::native_overlay::show(crate::native_overlay::OverlayBounds {
                x, y, width:right.saturating_sub(x),height:bottom.saturating_sub(y),
            }, Arc::clone(&state.stopped));
            let mut overlay=overlay.ok();
            let published=(||{
                let life=state.carrier_stop_hooks.lifecycle.lock().map_err(|_|"Overlay state unavailable.")?;
                if !native_activation_ready(&life,&state.carrier_stop_hooks)||state.stopped.load(Ordering::SeqCst)||state.session_generation.load(Ordering::SeqCst)!=epoch{return Err("Native approval cancelled by STOP");}
                let active=state.session.lock().map_err(|_|"Overlay state unavailable.")?;
                let scope=state.native_safety.lock().map_err(|_|"Overlay state unavailable.")?;
                if active.as_ref().is_none_or(|s|s.id!=id)||scope.as_ref().is_none_or(|s|!same_safety_scope(s,&enrollment)){return Err("Native approval cancelled by STOP");}
                let mut current=state.overlay.lock().map_err(|_|"Overlay state unavailable.")?;
                if current.is_some(){return Err("Overlay state unavailable.");}*current=overlay.take();Ok(())
            })();
            drop(overlay); // A stale local startup is joined outside all locks.
            if let Err(error)=published{safety_latch_original(&bridge,&state.stopped,&state.session_generation,&enrollment);return Err(error.into());}
        }
        require_session(&state,&id)?;
        if state.session_generation.load(Ordering::SeqCst)!=epoch||state.stopped.load(Ordering::SeqCst)||state.carrier_stop_hooks.active_cleanup.load(Ordering::SeqCst)!=0{return Err("Native approval cancelled by STOP".into());}
        Ok(id)
    }
}

fn native_stop_unknown()->serde_json::Value{serde_json::json!({"nativeSessionId":null,"originalGeneration":null,"latchedGeneration":null,"observedAt":null,"state":"unknown"})}
fn native_stop_selector(value:&serde_json::Value)->Result<Option<&str>,String>{
    let Some(expected)=value.get("expectedSessionId")else{return Ok(None);};
    if value.as_object().is_none_or(|o|o.len()!=1)||serde_json::to_vec(value).map_err(|_|"NATIVE_STOP_INVALID_REQUEST")?.len()>1024{return Err("NATIVE_STOP_INVALID_REQUEST".into());}
    expected.as_str().filter(|s|steam_read_id(s)).map(Some).ok_or_else(||"NATIVE_STOP_INVALID_REQUEST".into())
}
fn native_stop_request(body:&tauri::ipc::InvokeBody)->Result<Option<&str>,String>{
    match body{tauri::ipc::InvokeBody::Json(value)=>native_stop_selector(value),_=>Err("NATIVE_STOP_INVALID_REQUEST".into())}
}
fn native_stop_timestamp(value:&str)->bool{
    value.len()==24&&value.bytes().enumerate().all(|(i,b)|match i{4|7=>b==b'-',10=>b==b'T',13|16=>b==b':',19=>b==b'.',23=>b==b'Z',_=>b.is_ascii_digit()})
        &&native_time(&serde_json::json!(value)).is_ok()
}
fn native_stop_proof(scope:&NativeSafetySession,generation:u64,stopped:bool,active:Option<&ComputerSession>,expected:&str)->Result<Option<NativeStopFact>,String>{
    if active.is_some_and(|s|s.id!=expected)||scope.native_session_id!=expected{return Err("NATIVE_STOP_SCOPE_MISMATCH".into());}
    if scope.retired||scope.owner_binding_id.is_empty()||scope.safety_session_ref.is_empty()||scope.native_boot_nonce.is_empty()
        ||scope.original_generation>=9_007_199_254_740_991{return Err("NATIVE_STOP_SCOPE_UNAVAILABLE".into());}
    let next=scope.original_generation.checked_add(1).ok_or("NATIVE_STOP_SCOPE_UNAVAILABLE")?;
    if let Some(fact)=&scope.latch{
        if !stopped||generation<next||fact.original_generation!=scope.original_generation||fact.latched_generation!=next
            ||!native_stop_timestamp(&fact.observed_at){return Err("NATIVE_STOP_SCOPE_UNAVAILABLE".into());}
        return Ok(Some(fact.clone()));
    }
    if active.is_none()||generation!=scope.original_generation{return Err("NATIVE_STOP_SCOPE_UNAVAILABLE".into());}
    Ok(None)
}
struct NativeStopCleanup<'a>{hooks:&'a CarrierStopHooks,original:NativeSafetySession,pending:Option<NativeCleanupPending<'a>>,finished:bool}
impl Drop for NativeStopCleanup<'_>{fn drop(&mut self){
    if let Ok(mut life)=self.hooks.lifecycle.lock(){if let Some(t)=life.as_mut().filter(|t|same_safety_scope(&t.original,&self.original)){
        t.busy=false;if !self.finished{t.fault=true;t.complete=false;}
    }self.pending.take();}
}}
fn native_stop_cleanup(state:&ComputerState,original:&NativeSafetySession)->Result<(),String>{
    native_cleanup_epoch(&state.carrier_stop_hooks,original.original_generation);
    state.browser_foundation.invalidate_scope().map_err(|_|"cleanup")?;
    state.ocr_targets.lock().map_err(|_|"cleanup")?.invalidate_all();
    state.workflow_reservation.lock().map_err(|_|"cleanup")?.take();
    state.explorer_claims.lock().map_err(|_|"cleanup")?.clear();
    crate::native_app_workflows::invalidate_task_authority();
    crate::native_app_operators::invalidate_focus_targets();crate::native_uia::invalidate_targets();
    state.last_image.lock().map_err(|_|"cleanup")?.take();
    state.last_observation.lock().map_err(|_|"cleanup")?.take();
    let overlay=state.overlay.lock().map_err(|_|"cleanup")?.take();
    drop(overlay); // Join only this detached original overlay, outside every mutex.
    Ok(())
}
fn native_with_dispatch_witness<T>(dispatch:&Mutex<()>,work:impl FnOnce(bool)->T)->T{
    let witness=dispatch.try_lock().ok();work(witness.is_some())
}
fn native_stop_receipt(state:&ComputerState,original:&NativeSafetySession,fact:&NativeStopFact,scoped:bool)->serde_json::Value{
    native_stop_receipt_core(state,original,fact,scoped,&crate::cross_device::native_carrier_quiescent,&crate::native_uia::steam_main_worker_quiescent)
}
fn native_stop_receipt_core(state:&ComputerState,original:&NativeSafetySession,fact:&NativeStopFact,scoped:bool,carrier:&dyn Fn()->bool,uia:&dyn Fn()->bool)->serde_json::Value{
    let Ok(life)=state.carrier_stop_hooks.lifecycle.lock()else{return native_stop_unknown();};
    let Ok(session)=state.session.lock()else{return native_stop_unknown();};
    let Ok(scope)=state.native_safety.lock()else{return native_stop_unknown();};
    let Some(scope)=scope.as_ref().filter(|s|same_safety_scope(s,original))else{return native_stop_unknown();};
    if (scoped&&native_stop_proof(scope,state.session_generation.load(Ordering::SeqCst),state.stopped.load(Ordering::SeqCst),session.as_ref(),&original.native_session_id).is_err())||scope.original_generation!=fact.original_generation
        ||scope.latch.as_ref().is_none_or(|f|f.original_generation!=fact.original_generation||f.latched_generation!=fact.latched_generation||f.observed_at!=fact.observed_at){return native_stop_unknown();}
    if state.carrier_stop_hooks.cleanup_fault.load(Ordering::SeqCst)||life.as_ref().is_some_and(|t|same_safety_scope(&t.original,original)&&t.fault){return native_stop_unknown();}
    let complete=life.as_ref().is_some_and(|t|same_safety_scope(&t.original,original)&&t.complete&&!t.fault&&!t.busy);
    native_with_dispatch_witness(&state.action_dispatch,|witness|{
    let quiet=witness&&complete&&!state.carrier_stop_hooks.cleanup_fault.load(Ordering::SeqCst)&&state.carrier_stop_hooks.active_cleanup.load(Ordering::SeqCst)==0
        &&carrier()&&uia();
    // witness and lifecycle exclusion remain held through receipt construction.
    serde_json::json!({"nativeSessionId":scope.native_session_id,"originalGeneration":fact.original_generation,
        "latchedGeneration":fact.latched_generation,"observedAt":fact.observed_at,"state":if quiet{"native_quiescent"}else{"native_latched"}})
    })
}
fn native_scoped_stop(state:&ComputerState,expected:&str)->Result<serde_json::Value,String>{
    let (original,fact,mut cleanup)={
        let mut life=state.carrier_stop_hooks.lifecycle.lock().map_err(|_|"NATIVE_STOP_SCOPE_UNAVAILABLE")?;
        let mut session=state.session.lock().map_err(|_|"NATIVE_STOP_SCOPE_UNAVAILABLE")?;
        if session.as_ref().is_some_and(|s|s.id!=expected){return Err("NATIVE_STOP_SCOPE_MISMATCH".into());}
        let mut safety=state.native_safety.lock().map_err(|_|"NATIVE_STOP_SCOPE_UNAVAILABLE")?;
        let scope=safety.as_mut().ok_or("NATIVE_STOP_SCOPE_UNAVAILABLE")?;
        let retained=native_stop_proof(scope,state.session_generation.load(Ordering::SeqCst),state.stopped.load(Ordering::SeqCst),session.as_ref(),expected)?;
        if life.as_ref().is_some_and(|t|!same_safety_scope(&t.original,scope)){
            return Err("NATIVE_STOP_SCOPE_UNAVAILABLE".into());
        }
        if life.as_ref().is_some_and(|t|same_safety_scope(&t.original,scope)&&t.busy)&&scope.latch.is_none(){return Err("NATIVE_STOP_SCOPE_UNAVAILABLE".into());}
        let fact=match retained{Some(fact)=>fact,None=>{
            let observed_at=native_iso(now_ms()).map_err(|_|"NATIVE_STOP_SCOPE_UNAVAILABLE")?;
            if !native_stop_timestamp(&observed_at){return Err("NATIVE_STOP_SCOPE_UNAVAILABLE".into());}
            NativeStopFact{original_generation:scope.original_generation,latched_generation:scope.original_generation+1,observed_at}
        }};
        if life.as_ref().is_some_and(|t|same_safety_scope(&t.original,scope)&&t.busy){
            return Ok(serde_json::json!({"nativeSessionId":scope.native_session_id,"originalGeneration":fact.original_generation,
                "latchedGeneration":fact.latched_generation,"observedAt":fact.observed_at,"state":"native_latched"}));
        }
        // First effect only after complete original identity/receipt validation.
        let pending=NativeCleanupPending::new(&state.carrier_stop_hooks.active_cleanup);
        if scope.latch.is_none(){
            if state.session_generation.compare_exchange(fact.original_generation,fact.latched_generation,Ordering::SeqCst,Ordering::SeqCst).is_err(){drop(pending);return Ok(native_stop_unknown());}
            state.stopped.store(true,Ordering::SeqCst);scope.latch=Some(fact.clone());
        }
        session.take();termination_admit(&mut life,scope);
        let Some(term)=life.as_mut()else{drop(pending);return Ok(native_stop_unknown());};term.busy=true;term.complete=false;term.fault=false;
        let original=scope.clone();let cleanup=NativeStopCleanup{hooks:&state.carrier_stop_hooks,original:original.clone(),pending:Some(pending),finished:false};
        (original,fact,cleanup)
    };
    let work=std::panic::catch_unwind(std::panic::AssertUnwindSafe(||native_stop_cleanup(state,&original)));
    let mut completed=false;
    if let Ok(mut life)=state.carrier_stop_hooks.lifecycle.lock(){if let Some(t)=life.as_mut().filter(|t|same_safety_scope(&t.original,&original)){
        completed=matches!(work,Ok(Ok(())))&&!t.fault;t.complete=completed;t.fault=!completed;t.busy=false;
    }cleanup.finished=completed;cleanup.pending.take();}
    if !completed{drop(cleanup);return Ok(native_stop_unknown());}
    drop(cleanup);Ok(native_stop_receipt(state,&original,&fact,true))
}
#[tauri::command]
pub fn computer_stop(state:State<'_,ComputerState>,request:tauri::ipc::Request<'_>)->Result<serde_json::Value,String>{
    if let Some(expected)=native_stop_request(request.body())?{return native_scoped_stop(&state,expected);}
    computer_stop_legacy(&state)
}
fn computer_stop_legacy(state:&ComputerState)->Result<serde_json::Value,String>{
    // Explicit global STOP remains global, including when no private scope exists.
    let bridge_present=safety_bridge(state).is_ok();
    let mut poison_error:Option<&str>=None;
    let original={
        let mut life=match state.carrier_stop_hooks.lifecycle.lock(){Ok(g)=>g,Err(p)=>{poison_error=Some("Computer Use state unavailable.");p.into_inner()}};
        // Unlike scoped preflight, an explicit global STOP always revokes, even
        // when a state mutex is poisoned. Poison remains a permanent fence.
        state.stopped.store(true,Ordering::SeqCst);let epoch=advance_stop_generation(&state.session_generation);
        let mut session=match state.session.lock(){Ok(g)=>g,Err(p)=>{poison_error=Some("Computer Use state unavailable.");p.into_inner()}};
        let mut safety=match state.native_safety.lock(){Ok(g)=>g,Err(p)=>{if poison_error.is_none(){poison_error=Some("NATIVE_SAFETY_STATE_UNAVAILABLE");}p.into_inner()}};
        let pending=NativeCleanupPending::new(&state.carrier_stop_hooks.active_cleanup);
        session.take();
        if let Some(scope)=safety.as_mut(){
            if scope.latch.is_none(){if let(Some(epoch),Ok(observed))=(epoch,native_iso(now_ms())){if epoch==scope.original_generation{
                scope.latch=epoch.checked_add(1).map(|next|NativeStopFact{original_generation:epoch,latched_generation:next,observed_at:observed});
            }}}
            termination_admit(&mut life,scope);if let Some(t)=life.as_mut(){t.complete=false;t.busy=true;t.fault=poison_error.is_some();}
        }
        (safety.clone(),pending)
    };
    let(scope,pending)=original;
    let work=std::panic::catch_unwind(std::panic::AssertUnwindSafe(||{
        if let Some(scope)=&scope{native_stop_cleanup(state,scope)}else{
            state.browser_foundation.invalidate_scope().map_err(|_|"cleanup")?;
            state.workflow_reservation.lock().map_err(|_|"cleanup")?.take();
            state.explorer_claims.lock().map_err(|_|"cleanup")?.clear();
            crate::native_app_workflows::invalidate_task_authority();crate::native_uia::invalidate_targets();
            crate::native_app_operators::invalidate_focus_targets();state.ocr_targets.lock().map_err(|_|"cleanup")?.invalidate_all();
            state.last_image.lock().map_err(|_|"cleanup")?.take();state.last_observation.lock().map_err(|_|"cleanup")?.take();
            let overlay=state.overlay.lock().map_err(|_|"cleanup")?.take();drop(overlay);Ok(())
        }
    }));
    {let mut life=state.carrier_stop_hooks.lifecycle.lock().map_err(|_|"Computer Use state unavailable.")?;
        if let Some(t)=life.as_mut().filter(|t|scope.as_ref().is_some_and(|s|same_safety_scope(&t.original,s))){
            t.busy=false;t.complete=matches!(work,Ok(Ok(())))&&!t.fault;t.fault=!t.complete;
        }
        let complete=matches!(work,Ok(Ok(())))&&poison_error.is_none()&&life.as_ref().is_none_or(|t|t.complete&&!t.fault);
        state.carrier_stop_hooks.cleanup_fault.store(!complete,Ordering::SeqCst);
        drop(pending);
    }
    if let Some(error)=poison_error{return Err(error.into());}
    if !bridge_present||state.carrier_stop_hooks.cleanup_fault.load(Ordering::SeqCst){return Ok(native_stop_unknown());}
    Ok(match scope{Some(scope)=>match scope.latch.as_ref(){Some(fact)=>native_stop_receipt(state,&scope,fact,false),None=>native_stop_unknown()},None=>native_stop_unknown()})
}
#[tauri::command]
pub fn computer_observe(
    state: State<'_, ComputerState>,
    session_id: String,
    workflow_id: Option<String>,
) -> Result<Observation, String> {
    let _dispatch=state.action_dispatch.try_lock().map_err(|_|"Native observation dispatcher busy")?;
    workflow_context(&state,&session_id,workflow_id.as_deref())?;
    require_session(&state, &session_id)?;
    check_kill_switch(&state)?;
    let observation=observe_and_remember(&state)?;
    require_session(&state,&session_id)?;check_kill_switch(&state)?;workflow_context(&state,&session_id,workflow_id.as_deref())?;
    Ok(observation)
}

#[tauri::command]
pub fn computer_screenshot(
    state: State<'_, ComputerState>,
    session_id: String,
    workflow_id: Option<String>,
) -> Result<Observation, String> {
    let _dispatch=state.action_dispatch.try_lock().map_err(|_|"Native observation dispatcher busy")?;
    workflow_context(&state,&session_id,workflow_id.as_deref())?;
    require_session(&state, &session_id)?;
    check_kill_switch(&state)?;
    let observation=observe_and_remember(&state)?;
    require_session(&state,&session_id)?;check_kill_switch(&state)?;workflow_context(&state,&session_id,workflow_id.as_deref())?;
    Ok(observation)
}

#[tauri::command]
pub async fn computer_action(
    state: State<'_, ComputerState>,
    session_id: String,
    request: ActionRequest,
    explorer_operation_id: Option<String>,
    workflow_id: Option<String>,
) -> Result<ActionResult, String> {
    let expected_session_generation = state.session_generation.load(Ordering::SeqCst);
    require_session(&state, &session_id)?;
    workflow_context(&state,&session_id,workflow_id.as_deref())?;
    let session_expires_at = state.session.lock()
        .map_err(|_| "Computer Use state unavailable.")?
        .as_ref().map(|session| session.expires_at)
        .ok_or("Computer Use session missing.")?;
    check_kill_switch(&state)?;
    let observation = validate_action_context(&state, &request)?;
    if request.action=="focusApp"&&request.approval_id.as_deref()!=Some(format!("approval-{session_id}").as_str()){return Err("Focus approval is not bound to the local owner session".into());}
    let deadline = chrono::DateTime::parse_from_rfc3339(&request.deadline_at).map_err(|_|"Action deadline invalid")?.timestamp_millis();
    if deadline<=0 || deadline as u64<=now_ms(){return Err("Action deadline expired".into());}
    let ocr_target=request.target.as_ref().filter(|t|t.target_id.starts_with("ocr-"));
    if request.target.as_ref().is_some_and(|t|t.metadata.get("provenance").and_then(|v|v.as_str())==Some("ocr")&&!t.target_id.starts_with("ocr-"))
        ||request.destination_target.as_ref().is_some_and(|t|t.target_id.starts_with("ocr-")||t.metadata.get("provenance").and_then(|v|v.as_str())==Some("ocr")){
        return Err("OCR target namespace mismatch".into());
    }
    let ocr_context=if let Some(target)=ocr_target{
        if request.action!="clickMouse"||request.button.as_deref().unwrap_or("left")!="left"||request.attempt!=Some(1)||request.max_attempts!=1
            ||request.expected_effect!="visual_change"||request.approval_id.as_deref()!=Some(format!("approval-{session_id}").as_str())
            ||request.text.is_some()||request.key.is_some()||request.keys.is_some()||request.delta.is_some()||request.app.is_some()||!request.extra.is_empty()
            ||crate::native_app_workflows::task_is_bound(&session_id,workflow_id.as_deref())?{
            return Err("OCR requires a native-approved single left click; task UIA proof cannot be replaced".into());
        }
        let expiry=session_expires_at.duration_since(UNIX_EPOCH).map_err(|_|"OCR session expiry invalid")?.as_millis() as u64;
        let expiry=state.workflow_reservation.lock().map_err(|_|"OCR reservation unavailable")?.as_ref().map_or(expiry,|r|expiry.min(r.expires_at));
        let context=ocr_frame_context(&observation,&session_id,expected_session_generation,workflow_id.as_deref(),expiry.min(deadline as u64))?;
        state.ocr_targets.lock().map_err(|_|"OCR registry unavailable")?.validate_metadata(&target.target_id,&target.metadata,&context,now_ms())?;
        Some(context)
    }else{None};
    let bridge = safety_bridge(&state)?;
    let stopped = Arc::clone(&state.stopped);
    let session_generation = Arc::clone(&state.session_generation);
    let observation_generation = Arc::clone(&state.observation_generation);
    let target_id=request.target.as_ref().map(|target|target.target_id.clone());
    let destination_target_id=request.destination_target.as_ref().map(|target|target.target_id.clone());
    let is_focus=request.action=="focusApp";
    if let Some(operation)=explorer_operation_id.as_ref(){
        if operation.is_empty()||operation.len()>160||!request.action_id.starts_with(&format!("explorer-{operation}-")){
            return Err("Explorer action identity is not bound to its claimed operation".into());
        }
    }
    {
        let claims=state.explorer_claims.lock().map_err(|_|"Native Explorer operation bindings unavailable")?;
        if let Some(claim)=claims.iter().find(|claim|claim.session_id==session_id&&Some(claim.workflow_id.as_str())==workflow_id.as_deref()
            && claim.epoch==expected_session_generation&&claim.expires_at>now_ms()){
            if explorer_operation_id.as_deref()!=Some(claim.operation_id.as_str()){
                return Err("GUI action omitted or changed its active native Explorer operation binding".into());
            }
        }
    }
    // Reserve before entering the worker. Terminal failures (including partial
    // injection) stay reserved for the entire approval lifetime: no automatic replay.
    use sha2::{Digest,Sha256};
    let key=format!("{}:{}",session_id,request.idempotency_key.as_deref().unwrap_or(&request.action_id));
    let binding=format!("{:x}",Sha256::digest(serde_json::to_vec(&serde_json::json!({"request":request,"explorerOperationId":explorer_operation_id,"workflowId":workflow_id})).map_err(|_|"Action binding invalid")?));
    let ledger=Arc::clone(&state.action_ledger);
    let action_dispatch=Arc::clone(&state.action_dispatch);
    let ocr_registry=Arc::clone(&state.ocr_targets);
    let post_ocr_target=ocr_target.map(|t|t.target_id.clone());let post_action_id=request.action_id.clone();
    // Preserve first work failures only for an already bound App task. General
    // actions and the mutually exclusive OCR path retain their existing policy.
    let retain_app_failure=crate::native_app_workflows::task_is_bound(&session_id,workflow_id.as_deref())?;
    {
        let mut rows=ledger.lock().map_err(|_|"Action ledger unavailable")?;
        rows.retain(|row|row.expires_at>SystemTime::now());
        if let Some(row)=rows.iter().find(|row|row.key==key){
            if row.binding!=binding{return Err("IDEMPOTENCY_KEY_CONFLICT".into());}
            return row.result.clone().unwrap_or_else(||Err("Action is already in flight; replay blocked".into()));
        }
        if rows.len()>=64{return Err("Action ledger full; start a fresh approval after expiry".into());}
        rows.push(NativeActionEntry{key:key.clone(),binding,expires_at:session_expires_at+Duration::from_secs(10),result:None,
            session_id:session_id.clone(),explorer_operation_id:explorer_operation_id.clone(),workflow_id:workflow_id.clone(),issued_at:SystemTime::now(),
            action_id:request.action_id.clone(),action:request.action.clone(),keys:request.keys.clone()});
    }
    let reservations=Arc::clone(&state.workflow_reservation);
    let post_session_id=session_id.clone();let post_workflow_id=workflow_id.clone();let post_observation=observation.clone();
    let mut result = tauri::async_runtime::spawn_blocking(move || {
        // Distinct requests must not interleave held buttons or text units.
        // Waiting workers revalidate all provenance after acquiring this lock.
        let _dispatch=action_dispatch.lock().map_err(|_|"Native input dispatcher unavailable")?;
        if let (Some(context),Some(target))=(&ocr_context,request.target.as_ref()){
            let mut registry=ocr_registry.lock().map_err(|_|"OCR registry unavailable")?;
            registry.validate_metadata(&target.target_id,&target.metadata,context,now_ms())?;
            registry.begin_dispatch(&target.target_id,&request.action_id,context,now_ms())?;
        }
        let local_guard = || {
            workflow_access(&reservations,expected_session_generation,&session_id,workflow_id.as_deref())?;
            let valid = || !stopped.load(Ordering::SeqCst)
                && session_generation.load(Ordering::SeqCst) == expected_session_generation
                && observation_generation.load(Ordering::SeqCst) == observation.generation
                && SystemTime::now() < session_expires_at
                && observation.expires_at > now_ms()
                && ocr_context.as_ref().is_none_or(|context|now_ms()<context.expires_at.min(context.captured_at.saturating_add(5000)))
                && now_ms()<deadline as u64;
            if now_ms()>=deadline as u64 {return Err("Action deadline expired".into());}
            if !valid() { return Err("stale_or_cancelled: action invalidated.".into()); }
            if !valid() { return Err("stale_or_cancelled: action invalidated during safety await.".into()); }
            workflow_access(&reservations,expected_session_generation,&session_id,workflow_id.as_deref())?;
            if is_focus {Ok(())}else{platform::validate_foreground(&observation)}
        };
        let base_guard=||{
            local_guard()?;
            if let Err(error)=check_kill_switch_bridge(&bridge){
                if let Ok(mut targets)=ocr_registry.lock(){targets.invalidate_all();}
                return Err(error);
            }
            local_guard()
        };
        let guard=||{
            base_guard()?;
            if let (Some(context),Some(target))=(&ocr_context,request.target.as_ref()){
                let frame=fresh_ocr_frame(context,&observation,&base_guard,&local_guard)?;
                let rect=ocr_registry.lock().map_err(|_|"OCR registry unavailable")?.validate_live(&target.target_id,&request.action_id,&frame,true,now_ms())?;
                let (x,y)=(request.x.ok_or("OCR x required")?,request.y.ok_or("OCR y required")?);
                if x<rect[0]||y<rect[1]||x>=rect[2]||y>=rect[3]{return Err("OCR coordinates lie outside native lease".into());}
                // No network/provider wait after this final volatile check.
                workflow_access(&reservations,expected_session_generation,&session_id,workflow_id.as_deref())?;
                if stopped.load(Ordering::SeqCst)||session_generation.load(Ordering::SeqCst)!=expected_session_generation
                    ||observation_generation.load(Ordering::SeqCst)!=observation.generation||SystemTime::now()>=session_expires_at||now_ms()>=deadline as u64||now_ms()>=context.captured_at.saturating_add(5000){
                    return Err("OCR input invalidated after provider await".into());
                }
                platform::validate_foreground(&observation)?;
            }else if let Some(target_id)=target_id.as_ref(){
                crate::native_uia::validate_target(target_id,observation_hwnd(&observation)?,observation.window_process_id)?;
                base_guard()?;
            }
            if let Some(target_id)=destination_target_id.as_ref(){
                crate::native_uia::validate_target(target_id,observation_hwnd(&observation)?,observation.window_process_id)?;
                base_guard()?;
            }
            Ok(())
        };
        guard()?;
        platform::validate_foreground(&observation)?;
        if request.action=="clickMouse"&&crate::native_app_workflows::task_is_bound(&session_id,workflow_id.as_deref())?
            &&request.button.as_deref().is_some_and(|button|button!="left"){
            return Err("Bounded task UIA controls require the actual left-button click primitive".into());
        }
        crate::native_app_workflows::task_validate_action(&session_id,workflow_id.as_deref(),&request.action_id,&request.action,request.application_id.as_deref().or(request.app.as_deref()),
            request.target.as_ref().map(|t|t.target_id.as_str()),request.text.as_deref(),request.key.as_deref(),request.keys.as_deref(),request.button.as_deref(),request.attempt,&guard)?;
        let retained_focus=if matches!(request.action.as_str(),"typeText"|"pressKey"|"hotkey")
            &&crate::native_app_workflows::task_is_bound(&session_id,workflow_id.as_deref())?{
            let focused=crate::native_uia::focused_control(observation_hwnd(&observation)?,observation.window_process_id)?;guard()?;Some(focused)
        }else{None};
        let task_bound=crate::native_app_workflows::task_before(&bridge.token,bridge.port,&session_id,workflow_id.as_deref(),&request.action_id,is_focus,&guard)?;
        if let Some(operation)=explorer_operation_id.as_ref(){
            let hwnd=observation_hwnd(&observation)?;
            let controls=if is_focus{None}else{
                let windows=crate::native_app_operators::locate(crate::native_app_operators::AllowedApp::Explorer)?;
                guard()?;
                if !windows.iter().any(|window|window.handle==hwnd as usize&&window.process_id==observation.window_process_id){return Err("Explorer task input requires actual installed Explorer foreground identity".into());}
                Some(crate::native_app_workflows::snapshot(hwnd,observation.window_process_id,&guard)?)
            };
            let focused=if matches!(request.action.as_str(),"typeText"|"pressKey"|"hotkey"){
                let focus=crate::native_uia::focused_control(hwnd,observation.window_process_id)?;guard()?;Some(focus)
            }else{None};
            if retained_focus.as_ref().is_some_and(|before|focused.as_ref().is_none_or(|after|before.target_id!=after.target_id||before.control_type!=after.control_type||before.name!=after.name)){
                return Err("Native Explorer keyboard focus changed during private task preflight".into());
            }
            crate::native_app_workflows::explorer_validate_input(&bridge.token,bridge.port,&session_id,operation,
                &request.action,request.text.as_deref(),request.key.as_deref(),request.keys.as_deref(),controls.as_deref(),focused.as_ref(),request.target.as_ref().map(|t|t.target_id.as_str()))?;
            crate::native_app_workflows::explorer_exchange(&bridge.token,bridge.port,&session_id,operation,"check",None,&guard)?;
            // Never repeat the server preflight after the real GUI effect: an
            // accepted copy/move can legitimately change the source precondition.
            guard()?;
        }
        let action_id=request.action_id.clone();
        let readonly_keys=request.keys.clone();let keyboard_action=request.action=="hotkey";
        let input_guard=||{
            guard()?;
            if task_bound{let workflow=workflow_id.as_deref().ok_or("Native task reservation missing")?;crate::native_app_workflows::task_authority_live(&bridge.token,bridge.port,&session_id,workflow,&guard)?;crate::native_app_workflows::task_game_input_context(&session_id,workflow,request.target.as_ref().map(|t|t.target_id.as_str()),&guard)?;}
            if let Some(expected)=&retained_focus{
                let actual=crate::native_uia::focused_control(observation_hwnd(&observation)?,observation.window_process_id)?;
                if actual.target_id!=expected.target_id||actual.control_type!=expected.control_type||actual.name!=expected.name||actual.automation_id!=expected.automation_id
                    ||expected.selected.is_some()&&actual.selected!=expected.selected{
                    return Err("Actual native focused input control changed after blocking preflight; input denied".into());
                }
                if keyboard_action{if let Some(operation)=explorer_operation_id.as_ref(){
                    let controls=crate::native_uia::snapshot(observation_hwnd(&observation)?,observation.window_process_id)?;
                    let focused=crate::native_uia::focused_control(observation_hwnd(&observation)?,observation.window_process_id)?;
                    crate::native_app_workflows::explorer_readonly_input_context(&session_id,operation,readonly_keys.as_deref(),&controls,&focused)?;
                }}
            }
            workflow_access(&reservations,expected_session_generation,&session_id,workflow_id.as_deref())?;
            if stopped.load(Ordering::SeqCst)||session_generation.load(Ordering::SeqCst)!=expected_session_generation
                ||observation_generation.load(Ordering::SeqCst)!=observation.generation||SystemTime::now()>=session_expires_at
                ||observation.expires_at<=now_ms()||now_ms()>=deadline as u64{
                return Err("Native input invalidated during focused provider readback".into());
            }
            if !is_focus{platform::validate_foreground(&observation)?;}
            Ok(())
        };
        let steam_navigation=crate::native_app_workflows::task_steam_navigation_pending(&session_id,workflow_id.as_deref(),&action_id)?;
        let mut steam_counts=None;
        let result=if steam_navigation {
            platform::act_counted(stopped.as_ref(),request.clone(),observation.clone(),&session_id,&input_guard,&mut steam_counts)
        }else{platform::act(stopped.as_ref(), request.clone(), observation.clone(), &session_id,&input_guard)};
        // Preserve raw dispatch facts before any post-guard, provider or network failure.
        if let Some(counts)=steam_counts {
            crate::native_app_workflows::task_record_steam_dispatch(&session_id,workflow_id.as_deref(),&action_id,counts)?;
        }
        if let Some(target)=request.target.as_ref().filter(|t|t.target_id.starts_with("ocr-")){
            let succeeded=result.as_ref().is_ok_and(|r|r.injected&&r.dispatch_status=="dispatched"&&!r.partial_input_injected.unwrap_or(false));
            ocr_registry.lock().map_err(|_|"OCR registry unavailable")?.finish_dispatch(&target.target_id,&action_id,succeeded,now_ms())?;
        }
        if task_bound{
            // A post-observation uses fresh provider state: pre-action target labels
            // may legitimately change after the dispatched input.
            let post_guard=||{
                workflow_access(&reservations,expected_session_generation,&session_id,workflow_id.as_deref())?;
                let live=||!stopped.load(Ordering::SeqCst)&&session_generation.load(Ordering::SeqCst)==expected_session_generation
                    &&SystemTime::now()<session_expires_at&&now_ms()<deadline as u64;
                if !live(){return Err("Native task invalidated after actual dispatch".into());}
                check_kill_switch_bridge(&bridge)?;
                if !live(){return Err("Native task invalidated during post safety await".into());}
                workflow_access(&reservations,expected_session_generation,&session_id,workflow_id.as_deref())
            };
            let dispatched=result.as_ref().is_ok_and(|r|r.dispatch_status=="dispatched"&&(r.injected
                ||is_focus&&r.focus_readback.as_ref().is_some_and(|f|f.matched&&f.source=="native_operator")));
            let partial=result.as_ref().map_or(true,|r|r.partial_input_injected.unwrap_or(false));
            return app_result_after(result,||crate::native_app_workflows::task_after(&bridge.token,bridge.port,&session_id,workflow_id.as_deref().ok_or("Native task reservation missing")?,&action_id,dispatched,partial,false,&post_guard));
        }
        result
    })
    .await
    .unwrap_or_else(|_|Err("Computer Use action worker failed; replay remains blocked.".into()));
    let post=(||->Result<(),String>{
        require_session(&state,&post_session_id)?;
        workflow_context(&state,&post_session_id,post_workflow_id.as_deref())?;
        if state.session_generation.load(Ordering::SeqCst)!=expected_session_generation
            ||state.observation_generation.load(Ordering::SeqCst)!=post_observation.generation
            ||post_observation.expires_at<=now_ms()||now_ms()>=deadline as u64{return Err("Native action invalidated after dispatch; effect may already have occurred".into());}
        check_kill_switch(&state)?;
        require_session(&state,&post_session_id)?;
        workflow_context(&state,&post_session_id,post_workflow_id.as_deref())?;
        if state.session_generation.load(Ordering::SeqCst)!=expected_session_generation{return Err("Native action epoch changed after dispatch".into());}
        if !is_focus{platform::validate_foreground(&post_observation)?;}
        Ok(())
    })();
    if retain_app_failure{result=app_result_after(result,||post);}
    else if let Err(error)=post{result=Err(error);}
    if result.is_err(){if let Some(target)=post_ocr_target.as_ref(){
        // Any preflight error/panic/partial dispatch permanently removes input
        // authority. A failed finish cannot resurrect a previously consumed row.
        if let Ok(mut registry)=state.ocr_targets.lock(){let _=registry.finish_dispatch(target,&post_action_id,false,now_ms());}
    }}
    if result.is_err(){crate::native_app_workflows::task_block(&post_session_id,post_workflow_id.as_deref());}
    if let Ok(mut rows)=ledger.lock(){if let Some(row)=rows.iter_mut().find(|row|row.key==key){row.result=Some(result.clone());}}
    if let Ok(ref receipt) = result {
        if let Ok(overlay) = state.overlay.lock() {
            if let Some(overlay) = overlay.as_ref() {
                let event = if matches!(receipt.action.as_str(),"clickMouse"|"doubleClickMouse") && receipt.injected { "click" } else { "cursor" };
                let _ = overlay.update(event, receipt.cursor_x, receipt.cursor_y);
            }
        }
    }
    result
}

fn observe_and_remember(state: &ComputerState) -> Result<Observation, String> {
    if let Ok(mut targets)=state.ocr_targets.lock(){targets.invalidate_unused();}
    crate::native_uia::invalidate_targets();
    crate::native_app_operators::invalidate_focus_targets();
    let generation = state.observation_generation.fetch_add(1, Ordering::SeqCst) + 1;
    let observation = platform::observe(generation)?;
    let context = ObservationContext {
        native_identity: observation.native_identity.clone(),
        observation_id: observation.observation_id.clone(),
        generation: observation.generation,
        captured_at: observation.captured_at,
        expires_at: observation.expires_at,
        window_id: observation.window_id.clone(),
        window_process_id: observation.window_process_id,
        monitor_id: observation.monitor_id.clone(),
        scale_factor: observation.scale_factor,
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
    *state.last_image.lock().map_err(|_| "Observation image state unavailable")?=Some((generation,observation.image_data_url.clone()));
    if let Ok(overlay) = state.overlay.lock() {
        if let Some(overlay) = overlay.as_ref() {
            let _ = overlay.update("cursor", observation.cursor_x, observation.cursor_y);
        }
    }
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
    let atomic=matches!(request.action.as_str(),"dragMouse"|"doubleClickMouse");
    if request.action=="focusApp"{
        let focus=request.focus_target.as_ref().ok_or("Focus target required")?;
        focus_app(request.application_id.as_deref().ok_or("Focus app required")?)?;
        if focus.observation_id!=request.observation_id||focus.observation_generation!=request.observation_generation{return Err("Focus target binds another observation".into());}
        if request.expected_effect!="foreground_window_focused"||request.max_attempts!=1||request.attempt!=Some(1)||request.idempotency_key.as_ref().is_none_or(|key|key.is_empty()||key.len()>160)||!request.extra.is_empty()
            ||request.x.is_some()||request.y.is_some()||request.button.is_some()||request.text.is_some()||request.key.is_some()||request.keys.is_some()||request.delta.is_some()||request.app.is_some()||request.target.is_some()||request.destination_target.is_some()||request.drag_start.is_some()||request.drag_end.is_some()||request.drag_duration_ms.is_some(){return Err("Focus requires exact strict parameters and single attempt".into());}
    }else if request.focus_target.is_some()||request.application_id.is_some()||request.expected_effect=="foreground_window_focused"{return Err("Focus parameters require focusApp".into());}
    if atomic {
        if request.max_attempts!=1 || request.attempt!=Some(1) || request.idempotency_key.as_ref().is_none_or(|key|key.is_empty()||key.len()>160)
            || request.expected_effect!="visual_change"
            || !request.extra.is_empty() || request.text.is_some()||request.key.is_some()||request.keys.is_some()||request.delta.is_some()||request.app.is_some()
            || !matches!(request.button.as_deref().unwrap_or("left"),"left"|"right") {return Err("Atomic action requires strict parameters and a single attempt".into());}
        if request.action=="doubleClickMouse" && (request.drag_start.is_some()||request.drag_end.is_some()||request.drag_duration_ms.is_some()||request.destination_target.is_some()){return Err("Double click cannot include drag parameters".into());}
        if request.action=="dragMouse" {
            if request.x.is_some()||request.y.is_some()||!request.drag_duration_ms.is_some_and(|value|(100..=1500).contains(&value)){return Err("Drag duration/coordinates invalid".into());}
            for point in [request.drag_start.as_ref(),request.drag_end.as_ref()] {
                let point=point.ok_or("Drag endpoints required")?;
                if !contains(&observation.virtual_bounds,point.x,point.y)||!contains(&observation.window_bounds,point.x,point.y){return Err("Drag endpoints lie outside observed foreground".into());}
            }
        }
    }else if request.drag_start.is_some()||request.drag_end.is_some()||request.drag_duration_ms.is_some()||request.destination_target.is_some(){return Err("Drag fields require a drag action".into());}
    if request.action=="typeText" && request.expected_effect=="text_inserted" && (request.max_attempts!=1||request.attempt!=Some(1)){return Err("Verified text insertion is single attempt only".into());}
    if matches!(request.action.as_str(), "moveMouse" | "clickMouse"|"doubleClickMouse") {
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
    pub(super) fn open_file_verified(_: &NativeFileSource,_:&dyn Fn()->Result<(),String>)->Result<u32,String>{Err("Windows native file open unavailable".into())}
    pub fn monitors() -> Result<Vec<ComputerMonitor>, String> {
        Err("Windows native bridge unavailable.".into())
    }
    pub fn observe(_: u64) -> Result<Observation, String> {
        Err("Windows native bridge unavailable.".into())
    }
    pub fn validate_foreground(_: &ObservationContext) -> Result<(), String> {
        Err("Windows native bridge unavailable.".into())
    }
    pub fn approved_ocr_image(_: &ObservationContext)->Result<String,String>{Err("OCR supported process identity unavailable".into())}
    pub fn act(
        _: &AtomicBool,
        _: ActionRequest,
        _: ObservationContext,
        _: &str,
        _: &dyn Fn() -> Result<(), String>,
    ) -> Result<ActionResult, String> {
        Err("Windows native bridge unavailable.".into())
    }
    pub(super) fn act_counted(_: &AtomicBool,_:ActionRequest,_:ObservationContext,_:&str,
        _:&dyn Fn()->Result<(),String>,_:&mut Option<crate::native_app_workflows::SteamInputCounts>)->Result<ActionResult,String>{
        Err("Windows native bridge unavailable.".into())
    }

}

#[cfg(windows)]
mod platform {
    use super::*;
    use base64::Engine;
    use std::process::Command;
    pub fn approved_ocr_image(observation:&ObservationContext)->Result<String,String>{
        use windows_sys::Win32::System::Threading::{OpenProcess,QueryFullProcessImageNameW,PROCESS_QUERY_LIMITED_INFORMATION};
        use windows_sys::Win32::Foundation::CloseHandle;
        use sha2::{Digest,Sha256};
        fn process_image(pid:u32)->Result<std::path::PathBuf,String>{
            let process=unsafe{OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION,0,pid)};
            if process.is_null(){return Err("OCR process identity unavailable".into());}
            let mut path=vec![0u16;32768];let mut len=path.len() as u32;
            let success=unsafe{QueryFullProcessImageNameW(process,0,path.as_mut_ptr(),&mut len)};
            unsafe{CloseHandle(process)};
            if success==0||len==0||len as usize>=path.len(){return Err("OCR process image unavailable".into());}
            std::path::PathBuf::from(String::from_utf16(&path[..len as usize]).map_err(|_|"OCR process image encoding invalid")?).canonicalize().map_err(|_|"OCR process image canonical identity unavailable".into())
        }
        validate_foreground(observation)?;
        let actual=process_image(observation.window_process_id)?;
        let mut identity_material=actual.to_string_lossy().to_ascii_lowercase();
        let mut approved=false;
        for app in ["notepad","calculator"]{
            if let Ok(candidate)=approved_app_executable(app){if let Ok(candidate)=candidate.canonicalize(){if actual==candidate{approved=true;}}}
        }
        // Protected installed-package root plus fixed Microsoft publisher/package
        // identity permits the built-in packaged Calculator/Notepad variants.
        if !approved{
            let mut folder=vec![0u16;32768];
            let length=unsafe{windows_sys::Win32::System::SystemInformation::GetWindowsDirectoryW(folder.as_mut_ptr(),folder.len() as u32)};
            if length==0||length as usize>=folder.len(){return Err("OCR system identity unavailable".into());}
            let windows=std::path::PathBuf::from(String::from_utf16(&folder[..length as usize]).map_err(|_|"OCR system identity invalid")?);
            let drive=windows.parent().ok_or("OCR system root unavailable")?;
            let root=drive.join("Program Files").join("WindowsApps").canonicalize().map_err(|_|"OCR protected package root unavailable")?;
            let is_package=|image:&std::path::Path|{
            if let Ok(relative)=image.strip_prefix(&root){
                let parts:Vec<_>=relative.components().collect();
                if parts.len()==2{
                    let package=parts[0].as_os_str().to_string_lossy().to_ascii_lowercase();
                    let exe=parts[1].as_os_str().to_string_lossy().to_ascii_lowercase();
                    return package.ends_with("_8wekyb3d8bbwe")
                        &&(package.starts_with("microsoft.windowscalculator_")&&exe=="calculatorapp.exe"
                            ||package.starts_with("microsoft.windowsnotepad_")&&exe=="notepad.exe");
                }
            }
            false};
            approved=is_package(&actual);
            let system_host=windows.join("System32").join("ApplicationFrameHost.exe").canonicalize().map_err(|_|"OCR frame host identity unavailable")?;
            if !approved&&actual==system_host{
                // UWP Calculator has a system frame HWND/PID and a separate
                // installed-package child HWND/PID. Both are native-observed.
                struct Children{pids:std::collections::BTreeSet<u32>,visited:usize,overflow:bool}
                unsafe extern "system" fn child(hwnd:windows_sys::Win32::Foundation::HWND,data:isize)->i32{
                    let rows=&mut *(data as *mut Children);rows.visited+=1;
                    if rows.visited>64{rows.overflow=true;return 0;}
                    let mut pid=0;GetWindowThreadProcessId(hwnd,&mut pid);
                    if pid!=0{rows.pids.insert(pid);}1
                }
                let mut rows=Children{pids:Default::default(),visited:0,overflow:false};
                unsafe{windows_sys::Win32::UI::WindowsAndMessaging::EnumChildWindows(observation_hwnd(observation)? as _,Some(child),&mut rows as *mut Children as isize)};
                if rows.overflow{return Err("OCR hosted child identity ambiguous or over budget".into());}
                let mut supported=Vec::new();
                for pid in rows.pids{if pid!=observation.window_process_id{if let Ok(image)=process_image(pid){if is_package(&image){supported.push((pid,image));}}}}
                if supported.len()!=1{return Err("OCR hosted application identity is absent or ambiguous".into());}
                let (pid,image)=supported.pop().unwrap();
                identity_material=format!("{}|{}|{}",identity_material,pid,image.to_string_lossy().to_ascii_lowercase());
                approved=true;
            }
        }
        if !approved{return Err("OCR process identity is outside fixed Notepad/Calculator scope".into());}
        validate_foreground(observation)?;
        Ok(format!("{:x}",Sha256::digest(identity_material.as_bytes())))
    }
    use windows_sys::Win32::Foundation::{POINT, RECT};
    use windows_sys::Win32::Graphics::Gdi::{
        BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC,
        GetDIBits, GetMonitorInfoW, MonitorFromWindow, ReleaseDC, SelectObject, BITMAPINFO, BI_RGB,
        DIB_RGB_COLORS, MONITORINFO, MONITOR_DEFAULTTONEAREST, SRCCOPY, EnumDisplayMonitors, HMONITOR, HDC,
    };
    use windows_sys::Win32::UI::HiDpi::GetDpiForWindow;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, GetAsyncKeyState, GetDoubleClickTime, VK_LBUTTON,VK_RBUTTON, INPUT, INPUT_0, INPUT_KEYBOARD, INPUT_MOUSE, KEYBDINPUT, KEYEVENTF_KEYUP,
        KEYEVENTF_UNICODE, MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP, MOUSEEVENTF_RIGHTDOWN,
        MOUSEEVENTF_RIGHTUP, MOUSEEVENTF_WHEEL, MOUSEINPUT,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetCursorPos, GetForegroundWindow, GetSystemMetrics, GetWindowRect,
        GetWindowThreadProcessId, SetCursorPos, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN,
        SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN,
    };

    pub fn monitors() -> Result<Vec<ComputerMonitor>, String> {
        struct Enumeration { rows: Vec<ComputerMonitor>, active: HMONITOR, dpi: u32, failed: bool }
        unsafe extern "system" fn collect(monitor: HMONITOR, _: HDC, _: *mut RECT, data: isize) -> i32 {
            let enumeration = &mut *(data as *mut Enumeration);
            if enumeration.rows.len() >= 32 { enumeration.failed = true; return 0; }
            let mut info = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
            if GetMonitorInfoW(monitor, &mut info) == 0 { enumeration.failed = true; return 0; }
            let bounds = rect_bounds(info.rcMonitor);
            let active = monitor == enumeration.active;
            enumeration.rows.push(ComputerMonitor {
                id: format!("monitor:{}:{}:{}:{}", bounds.x, bounds.y, bounds.width, bounds.height),
                bounds, primary: info.dwFlags & 1 != 0, active,
                dpi_scale: (active && enumeration.dpi > 0).then_some(enumeration.dpi as f64 / 96.0),
            });
            1
        }
        let foreground = unsafe { GetForegroundWindow() };
        let mut enumeration = Enumeration { rows: Vec::new(), active: unsafe { MonitorFromWindow(foreground, MONITOR_DEFAULTTONEAREST) }, dpi: unsafe { GetDpiForWindow(foreground) }, failed: false };
        let result = unsafe { EnumDisplayMonitors(std::ptr::null_mut(), std::ptr::null(), Some(collect), &mut enumeration as *mut Enumeration as isize) };
        if result == 0 || enumeration.failed || enumeration.rows.is_empty() { return Err("monitor_enumeration_unavailable".into()); }
        Ok(enumeration.rows)
    }

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
        let identity=crate::native_calculator_identity::observe(isize::from_str_radix(window_id.strip_prefix("hwnd:").ok_or("Invalid native capture HWND")?,16).map_err(|_|"Invalid native capture HWND")?,window_process_id)?;
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
        crate::native_calculator_identity::revalidate(&identity)?;
        Ok(Observation {
            native_identity: Some(identity),
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
        if let Some(identity)=&observation.native_identity{crate::native_calculator_identity::revalidate(identity)?;}
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

    fn steam_send_raw(inputs:&[INPUT])->u32 {
        unsafe{SendInput(inputs.len() as u32,inputs.as_ptr(),std::mem::size_of::<INPUT>() as i32)}
    }
    fn steam_single_click(stopped:&AtomicBool)->crate::native_app_workflows::SteamInputCounts {
        let requested_primary=2;
        let returned_primary=steam_send_raw(&[mouse_input(MOUSEEVENTF_LEFTDOWN,0),mouse_input(MOUSEEVENTF_LEFTUP,0)]);
        let mut cleanup_requested=0;let mut cleanup_returned=0;
        if returned_primary!=requested_primary||unsafe{GetAsyncKeyState(VK_LBUTTON as i32)}<0 {
            // One owned-button release only; never retry the primary click.
            cleanup_requested=1;cleanup_returned=steam_send_raw(&[mouse_input(MOUSEEVENTF_LEFTUP,0)]);
        }
        let started=std::time::Instant::now();
        let release_confirmed=loop {
            if unsafe{GetAsyncKeyState(VK_LBUTTON as i32)}>=0{break true;}
            if started.elapsed()>=Duration::from_millis(100){stopped.store(true,Ordering::SeqCst);break false;}
            std::thread::sleep(Duration::from_millis(5));
        };
        crate::native_app_workflows::SteamInputCounts{requested_primary,returned_primary,cleanup_requested,cleanup_returned,release_confirmed,completed_at_ms:now_ms()}
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

    // Cleanup owns only the button it injected. UP dispatch alone is insufficient
    // evidence: confirm the asynchronous key state and latch stop if it stays down.
    struct MouseRelease<'a>{up:u32,vk:i32,armed:bool,confirmed:bool,stopped:&'a AtomicBool}
    impl<'a> MouseRelease<'a>{
        fn new(button:&str,stopped:&'a AtomicBool)->Result<(Self,u32),String>{
            let (down,up,vk)=match button {"left"=>(MOUSEEVENTF_LEFTDOWN,MOUSEEVENTF_LEFTUP,VK_LBUTTON as i32),"right"=>(MOUSEEVENTF_RIGHTDOWN,MOUSEEVENTF_RIGHTUP,VK_RBUTTON as i32),_=>return Err("Mouse button invalid".into())};
            if unsafe{GetAsyncKeyState(vk)}<0{return Err("Physical mouse button is already held; dispatch refused".into());}
            Ok((Self{up,vk,armed:false,confirmed:true,stopped},down))
        }
        fn release(&mut self)->bool{
            if !self.armed{return self.confirmed;}
            self.armed=false;
            let _=send(&[mouse_input(self.up,0)]);
            let start=std::time::Instant::now();
            loop {
                if unsafe{GetAsyncKeyState(self.vk)}>=0{self.confirmed=true;return true;}
                if start.elapsed()>=Duration::from_millis(100){self.stopped.store(true,Ordering::SeqCst);return false;}
                std::thread::sleep(Duration::from_millis(5));
            }
        }
    }
    impl Drop for MouseRelease<'_>{fn drop(&mut self){if self.armed&&!self.release(){self.stopped.store(true,Ordering::SeqCst);}}}

    fn atomic_mouse(stopped:&AtomicBool,request:&ActionRequest,guard:&dyn Fn()->Result<(),String>)->Result<(bool,bool,bool),String>{
        let (mut release,down)=MouseRelease::new(request.button.as_deref().unwrap_or("left"),stopped)?;
        let mut may_have_injected=false;
        let performed=(||->Result<(),String>{
            guard()?;
            let start=if request.action=="dragMouse"{request.drag_start.as_ref().ok_or("Drag start missing")?.clone()}else{NativePoint{x:request.x.ok_or("x required")?,y:request.y.ok_or("y required")?}};
            if unsafe{SetCursorPos(start.x,start.y)}==0{return Err("Cursor positioning failed".into());}
            guard()?;
            release.armed=true;release.confirmed=false;may_have_injected=true;
            let first_down=std::time::Instant::now();
            send(&[mouse_input(down,0)])?;
            if request.action=="dragMouse"{
                let end=request.drag_end.as_ref().ok_or("Drag end missing")?;
                let duration=request.drag_duration_ms.ok_or("Drag duration missing")?;
                let steps=(duration/50).clamp(2,30);
                let started=std::time::Instant::now();
                for step in 1..=steps {
                    let due=Duration::from_millis(duration*step/steps);
                    while started.elapsed()<due{
                        if stopped.load(Ordering::SeqCst){return Err("Drag interrupted".into());}
                        std::thread::sleep(due.saturating_sub(started.elapsed()).min(Duration::from_millis(10)));
                    }
                    guard()?;
                    if started.elapsed()>Duration::from_millis(1500){return Err("Drag safety checks exceeded maximum timing budget".into());}
                    // i64 interpolation avoids overflow even on a negative monitor origin.
                    let x=(i64::from(start.x)+(i64::from(end.x)-i64::from(start.x))*step as i64/steps as i64) as i32;
                    let y=(i64::from(start.y)+(i64::from(end.y)-i64::from(start.y))*step as i64/steps as i64) as i32;
                    if unsafe{SetCursorPos(x,y)}==0{return Err("Drag movement failed".into());}
                }
                guard()?;
            }else{
                let double_window=Duration::from_millis(u64::from(unsafe{GetDoubleClickTime()}).max(1));
                if !release.release(){return Err("First click release not confirmed".into());}
                std::thread::sleep((double_window/4).min(Duration::from_millis(50)));
                guard()?;
                if first_down.elapsed()>=double_window{return Err("Fresh safety checks exceeded OS double-click window".into());}
                if unsafe{GetAsyncKeyState(release.vk)}<0{return Err("Physical button changed between clicks".into());}
                release.armed=true;release.confirmed=false;
                send(&[mouse_input(down,0)])?;
                guard()?;
            }
            Ok(())
        })();
        let released=release.release();
        Ok((performed.is_ok()&&released,may_have_injected,released))
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

    fn approved_app_executable(app: &str) -> Result<std::path::PathBuf, String> {
        let name = match app { "notepad"=>"notepad.exe", "calculator"=>"calc.exe", _=>return Err("Application is outside the approved local allowlist.".into()) };
        let mut directory=[0u16;32768];
        let len=unsafe { windows_sys::Win32::System::SystemInformation::GetSystemDirectoryW(directory.as_mut_ptr(),directory.len() as u32) };
        if len==0 || len as usize>=directory.len() {return Err("Windows system directory unavailable".into());}
        use std::os::windows::ffi::OsStringExt;
        Ok(std::path::PathBuf::from(std::ffi::OsString::from_wide(&directory[..len as usize])).join(name))
    }

    pub(super) fn open_file_verified(source:&NativeFileSource,guard:&dyn Fn()->Result<(),String>)->Result<u32,String> {
        use sha2::{Digest,Sha256};
        use windows_sys::Win32::UI::WindowsAndMessaging::{EnumWindows,IsWindowVisible};
        use std::os::windows::fs::MetadataExt;
        let path=std::path::PathBuf::from(&source.absolute_path);
        if !path.is_absolute() {return Err("Native file path is not absolute".into());}
        let canonical=path.canonicalize().map_err(|_|"Native file unavailable")?;
        if !canonical.to_string_lossy().trim_start_matches("\\\\?\\").eq_ignore_ascii_case(source.canonical_path.trim_start_matches("\\\\?\\")) {return Err("Native source containment identity changed".into());}
        let check_source=||->Result<(),String>{
            let metadata=std::fs::symlink_metadata(&path).map_err(|_|"Native file unavailable")?;
            if !metadata.is_file() || metadata.len()>262144 || metadata.file_attributes()&0x400!=0 || path.canonicalize().map_err(|_|"Native file unavailable")?!=canonical {return Err("Native file identity changed".into());}
            use std::os::windows::io::AsRawHandle;
            use std::io::Read;
            use windows_sys::Win32::Storage::FileSystem::{GetFileInformationByHandle,BY_HANDLE_FILE_INFORMATION};
            let file=std::fs::File::open(&canonical).map_err(|_|"Native file unavailable")?;
            let mut identity=BY_HANDLE_FILE_INFORMATION::default();
            if unsafe {GetFileInformationByHandle(file.as_raw_handle(),&mut identity)}==0 || identity.nNumberOfLinks!=1 || identity.dwFileAttributes&0x400!=0 {return Err("Native file scope denied".into());}
            let mut bytes=Vec::new();file.take(262145).read_to_end(&mut bytes).map_err(|_|"Native file unavailable")?;
            if bytes.len()>262144 {return Err("Native file size changed".into());}
            let text=std::str::from_utf8(&bytes).map_err(|_|"Native file encoding invalid")?.trim_start_matches('\u{feff}');
            if format!("{:x}",Sha256::digest(text.as_bytes()))!=source.content_sha256 {return Err("Native file content changed".into());}
            Ok(())
        };
        guard()?;check_source()?;
        let child=Command::new(approved_app_executable("notepad")?).arg(&canonical).spawn().map_err(|_|"Native file app launch failed")?;
        let pid=child.id();
        struct Search {pid:u32,windows:Vec<isize>,visited:usize}
        unsafe extern "system" fn collect(hwnd:windows_sys::Win32::Foundation::HWND,data:isize)->i32{
            let search=&mut *(data as *mut Search);search.visited+=1;
            if search.visited>512{return 0;}
            let mut pid=0;GetWindowThreadProcessId(hwnd,&mut pid);
            if pid==search.pid && IsWindowVisible(hwnd)!=0 {search.windows.push(hwnd as isize);}
            1
        }
        let deadline=std::time::Instant::now()+Duration::from_secs(3);
        loop {
            guard()?;check_source()?;
            let mut search=Search{pid,windows:Vec::new(),visited:0};
            unsafe {EnumWindows(Some(collect),&mut search as *mut Search as isize);}
            if search.visited>512 {return Err("Native window enumeration budget exceeded".into());}
            let mut matched=None;
            for hwnd in search.windows {
                if let Ok(text)=crate::native_uia::read_text(hwnd,pid) {
                    if format!("{:x}",Sha256::digest(text.as_bytes()))==source.content_sha256 {
                        if matched.is_some(){return Err("Native document readback ambiguous".into());}
                        matched=Some(hwnd);
                    }
                }
            }
            if matched.is_some(){guard()?;check_source()?;return Ok(pid);}
            if std::time::Instant::now()>=deadline{return Err("Native same-file UIA postcondition unverified".into());}
            std::thread::sleep(Duration::from_millis(50));
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
        session_id:&str,
        guard: &dyn Fn() -> Result<(), String>,
    ) -> Result<ActionResult, String> {
        act_impl(stopped,request,observation,session_id,guard,None)
    }
    pub(super) fn act_counted(stopped:&AtomicBool,request:ActionRequest,observation:ObservationContext,session_id:&str,
        guard:&dyn Fn()->Result<(),String>,counts:&mut Option<crate::native_app_workflows::SteamInputCounts>)->Result<ActionResult,String>{
        act_impl(stopped,request,observation,session_id,guard,Some(counts))
    }
    fn act_impl(stopped:&AtomicBool,request:ActionRequest,observation:ObservationContext,session_id:&str,
        guard:&dyn Fn()->Result<(),String>,mut steam_counts:Option<&mut Option<crate::native_app_workflows::SteamInputCounts>>)->Result<ActionResult,String>{
        if steam_counts.is_some()&&(request.action!="clickMouse"||request.button.as_deref().unwrap_or("left")!="left"
            ||request.target.as_ref().is_none_or(|target|target.target_id.starts_with("ocr-"))){return Err("Steam navigation requires one native UIA left click".into());}
        if stopped.load(Ordering::SeqCst) {
            return Err("action_blocked: Computer Use was interrupted before dispatch.".into());
        }
        let bounds = virtual_bounds()?;
        let mut launched_process_id = None;
        let mut partial_input_injected=None;
        let mut release_confirmed=None;
        let mut dispatch_status="dispatched";
        let mut error_code=None;
        let mut injected=true;
        let mut focus_readback=None;
        guard()?;
        if let Some(target)=request.target.as_ref() {
            if target.target_id.starts_with("ocr-"){
                // Native registry metadata, fresh OCR geometry and coordinates
                // were checked by the guarded dispatch, including this boundary.
                if request.action!="clickMouse"||request.button.as_deref().unwrap_or("left")!="left"{return Err("OCR primitive mismatch".into());}
                guard()?;
            }else{
            let resolved=crate::native_uia::validate_target(&target.target_id,observation_hwnd(&observation)?,observation.window_process_id)?;
            if let (Some(x),Some(y))=(request.x,request.y){
                if !contains(&PhysicalBounds{x:resolved.x,y:resolved.y,width:resolved.width,height:resolved.height},x,y){return Err("UIA coordinates lie outside leased target".into());}
            }
            if let Some(point)=request.drag_start.as_ref(){if !contains(&PhysicalBounds{x:resolved.x,y:resolved.y,width:resolved.width,height:resolved.height},point.x,point.y){return Err("Drag start lies outside UIA target".into());}}
            guard()?;
            }
        }
        if let Some(target)=request.destination_target.as_ref(){
            let resolved=crate::native_uia::validate_target(&target.target_id,observation_hwnd(&observation)?,observation.window_process_id)?;
            let point=request.drag_end.as_ref().ok_or("Destination requires drag end")?;
            if !contains(&PhysicalBounds{x:resolved.x,y:resolved.y,width:resolved.width,height:resolved.height},point.x,point.y){return Err("Drag end lies outside UIA target".into());}
            guard()?;
        }
        match request.action.as_str() {
            "focusApp"=>{
                let app=request.application_id.as_deref().ok_or("Focus app missing")?;
                let target=request.focus_target.as_ref().ok_or("Focus target missing")?;
                let allowed=focus_app(app)?;
                match crate::native_app_operators::focus_issued(session_id,allowed,target,guard){
                    Ok(receipt) if receipt.foreground_verified=>{
                        injected=receipt.activation_requested;
                        focus_readback=Some(NativeFocusReadback{source:"native_operator",application_id:app.into(),window_id:format!("hwnd:{:x}",receipt.handle),window_process_id:receipt.process_id,image_path_fingerprint:target.image_path_fingerprint.clone(),matched:true});
                    }
                    _=>{dispatch_status="failed";partial_input_injected=Some(true);error_code=Some("NATIVE_FOCUS_NOT_VERIFIED");}
                }
            }
            "dragMouse"|"doubleClickMouse"=>{
                let (completed,may_have_injected,released)=atomic_mouse(stopped,&request,guard)?;
                injected=may_have_injected;
                release_confirmed=Some(released);
                partial_input_injected=Some(!completed&&may_have_injected);
                if !completed{dispatch_status="failed";error_code=Some("NATIVE_DISPATCH_INTERRUPTED");}
            }
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
                    guard()?;
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
                    if let Some(counts)=steam_counts.as_deref_mut(){
                        if unsafe{GetAsyncKeyState(VK_LBUTTON as i32)}<0{return Err("Physical left button held; Steam navigation refused".into());}
                        if stopped.load(Ordering::SeqCst){return Err("Steam navigation stopped before actual input".into());}
                        let actual=steam_single_click(stopped);
                        let complete=actual.requested_primary==2&&actual.returned_primary==2
                            &&actual.cleanup_requested==actual.cleanup_returned&&actual.release_confirmed;
                        injected=actual.returned_primary>0;
                        release_confirmed=Some(actual.release_confirmed);partial_input_injected=Some(!complete);
                        *counts=Some(actual);
                        if !complete{dispatch_status="failed";error_code=Some("STEAM_NATIVE_DISPATCH_PARTIAL");}
                    }else if request.target.as_ref().is_some_and(|target|target.target_id.starts_with("ocr-")){
                        // One attempt only. A short SendInput count can leave DOWN
                        // injected, so cleanup releases only our approved button.
                        let (mut release,_)=MouseRelease::new("left",stopped)?;
                        guard()?;
                        if stopped.load(Ordering::SeqCst)||unsafe{GetAsyncKeyState(VK_LBUTTON as i32)}<0{return Err("OCR dispatch interrupted or physical left button held".into());}
                        release.armed=true;release.confirmed=false;
                        let sent=send(&[mouse_input(flags.0,0),mouse_input(flags.1,0)]);
                        let released=release.release();release_confirmed=Some(released);
                        if sent.is_err()||!released{
                            dispatch_status="failed";partial_input_injected=Some(true);error_code=Some("OCR_NATIVE_DISPATCH_PARTIAL");
                        }
                    }else{
                        send(&[mouse_input(flags.0, 0), mouse_input(flags.1, 0)])?;
                    }
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
                let mut emitted=false;
                for unit in text.encode_utf16() {
                    if guard().is_err(){dispatch_status="failed";partial_input_injected=Some(emitted);error_code=Some("NATIVE_DISPATCH_INTERRUPTED");break;}
                    if stopped.load(Ordering::SeqCst) {
                        dispatch_status="failed";partial_input_injected=Some(emitted);error_code=Some("NATIVE_DISPATCH_INTERRUPTED");break;
                    }
                    emitted=true;
                    if send(&[
                        key_input(unit, 0, true),
                        key_input(unit, KEYEVENTF_KEYUP, true),
                    ]).is_err(){
                        let _=send(&[key_input(unit,KEYEVENTF_KEYUP,true)]);
                        dispatch_status="failed";partial_input_injected=Some(true);error_code=Some("NATIVE_DISPATCH_INTERRUPTED");break;
                    }
                    std::thread::sleep(Duration::from_millis(5));
                }
                injected=emitted;
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
                let child = Command::new(executable)
                    .spawn()
                    .map_err(|_| "Approved application could not be started.")?;
                launched_process_id = Some(child.id());
            }
            _ => return Err("Computer action is not supported.".into()),
        }
        let (cursor_x, cursor_y) = cursor().unwrap_or((0,0));
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
            injected,
            dispatch_status,
            cursor_x,
            cursor_y,
            verification,
            verification_status: "pending_post_observation",
            pre_observation_id: observation.observation_id,
            attempts: 1,
            launched_process_id,
            partial_input_injected,
            release_confirmed,
            error_code,
            focus_readback,
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
            assert_eq!(approved_app_executable("notepad").unwrap().file_name().unwrap(), "notepad.exe");
            assert_eq!(approved_app_executable("calculator").unwrap().file_name().unwrap(), "calc.exe");
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

    #[test]
    fn app_first_work_error_survives_guard_error_with_effect(){
        let calls=std::cell::Cell::new(0);
        let result=app_result_after::<()>(Err("NATIVE_BINDING_EXPIRED".into()),||{calls.set(calls.get()+1);Err("NATIVE_SAFETY_TRANSPORT_UNKNOWN".into())});
        assert_eq!(calls.get(),1);assert_eq!(result,Err("NATIVE_BINDING_EXPIRED".into()));
    }
    #[test]
    fn app_failed_work_still_runs_successful_postguard(){
        let called=std::cell::Cell::new(false);
        assert_eq!(app_result_after::<()>(Err("APP_TASK_NOT_COMPLETED".into()),||{called.set(true);Ok(())}),Err("APP_TASK_NOT_COMPLETED".into()));assert!(called.get());
    }
    #[test]
    fn app_successful_work_is_denied_by_postguard(){
        let blocked=std::cell::Cell::new(false);
        assert_eq!(app_result_after(Ok(7),||{blocked.set(true);Err("KILL_SWITCH_ACTIVE".into())}),Err("KILL_SWITCH_ACTIVE".into()));assert!(blocked.get());
    }
    #[test]
    fn app_success_requires_successful_postguard(){assert_eq!(app_result_after(Ok(7),||Ok(())),Ok(7));}
    #[test]
    fn app_nested_postguards_execute_all_effects_and_keep_first(){
        let calls=std::cell::Cell::new(0);
        let result=app_result_after::<()>(Err("EXPLORER_FINAL_PROOF_CHANGED".into()),||app_result_after({calls.set(1);Err("owner guard".into())},||{calls.set(2);Err("session guard".into())}));
        assert_eq!(calls.get(),2);assert_eq!(result,Err("EXPLORER_FINAL_PROOF_CHANGED".into()));
    }
    #[test]
    fn app_first_postguard_failure_blocks_success_even_when_later_guard_fails(){
        let calls=std::cell::Cell::new(0);
        let result=app_result_after(Ok(7),||app_result_after({calls.set(1);Err("KILL_SWITCH_ACTIVE".into())},||{calls.set(2);Err("session expired".into())}));
        assert_eq!(calls.get(),2);assert_eq!(result,Err("KILL_SWITCH_ACTIVE".into()));
    }
    fn scoped_stop_fixture()->(ComputerState,NativeSafetySession){
        let state=ComputerState::default();let(_,scope,_)=canonical_safety_fixture();
        state.session_generation.store(1,Ordering::SeqCst);state.stopped.store(false,Ordering::SeqCst);
        *state.session.lock().unwrap()=Some(ComputerSession{id:scope.native_session_id.clone(),expires_at:SystemTime::now()+Duration::from_secs(60)});
        *state.native_safety.lock().unwrap()=Some(scope.clone());
        *state.bridge.lock().unwrap()=Some(SafetyBridge{token:"unused-local-no-http".into(),port:0,safety:Arc::clone(&state.native_safety),stop_hooks:Arc::clone(&state.carrier_stop_hooks)});(state,scope)
    }
    #[test] fn scoped_stop_parser_closed_present_branch_and_legacy_absence(){
        assert_eq!(native_stop_request(&tauri::ipc::InvokeBody::Raw(vec![0,1,2])).unwrap_err(),"NATIVE_STOP_INVALID_REQUEST");
        let large=serde_json::json!({"expectedSessionId":"x","owner":"界".repeat(1100)});
        assert_eq!(native_stop_selector(&large).unwrap_err(),"NATIVE_STOP_INVALID_REQUEST");
        for value in [serde_json::json!(null),serde_json::json!([]),serde_json::json!({"unknown":1})]{assert_eq!(native_stop_selector(&value).unwrap(),None);}
        for value in [serde_json::json!({"expectedSessionId":null}),serde_json::json!({"expectedSessionId":1}),serde_json::json!({"expectedSessionId":""}),
            serde_json::json!({"expectedSessionId":"own","force":true}),serde_json::json!({"expectedSessionId":"a b"}),serde_json::json!({"expectedSessionId":"x".repeat(161)})]{
            assert_eq!(native_stop_selector(&value).unwrap_err(),"NATIVE_STOP_INVALID_REQUEST");
        }
        let value=serde_json::json!({"expectedSessionId":"computer:actual_1-2"});assert_eq!(native_stop_selector(&value).unwrap(),Some("computer:actual_1-2"));
    }
    #[test] fn scoped_stop_foreign_active_and_partial_state_are_effect_free(){
        let(state,scope)=scoped_stop_fixture();
        let browser_epoch=state.browser_foundation.scope_epoch();let calls=Arc::new(AtomicU64::new(0));let seen=Arc::clone(&calls);
        state.carrier_stop_hooks.entries.lock().unwrap().push((1,Arc::new(move|_|{seen.fetch_add(1,Ordering::SeqCst);}))); 
        *state.workflow_reservation.lock().unwrap()=Some(NativeWorkflowReservation{session_id:scope.native_session_id.clone(),workflow_id:"own-flow".into(),epoch:1,expires_at:now_ms()+60000,requested_deadline:now_ms()+60000,browser_incarnation:1});
        state.explorer_claims.lock().unwrap().push(NativeExplorerClaim{session_id:scope.native_session_id.clone(),operation_id:"own-op".into(),operation:"copy".into(),reverse_of:None,destination_path:"unused-synthetic".into(),workflow_id:"own-flow".into(),epoch:1,claimed_at:SystemTime::now(),expires_at:now_ms()+60000});
        assert_eq!(native_scoped_stop(&state,"foreign").unwrap_err(),"NATIVE_STOP_SCOPE_MISMATCH");
        let mut foreign=scope.clone();foreign.native_session_id="other".into();
        *state.carrier_stop_hooks.lifecycle.lock().unwrap()=Some(NativeTermination{original:foreign,complete:false,fault:true,busy:false});
        assert_eq!(native_scoped_stop(&state,&scope.native_session_id).unwrap_err(),"NATIVE_STOP_SCOPE_UNAVAILABLE");
        assert!(!state.stopped.load(Ordering::SeqCst));assert_eq!(state.session_generation.load(Ordering::SeqCst),1);
        assert_eq!(state.carrier_stop_hooks.active_cleanup.load(Ordering::SeqCst),0);
        assert!(state.session.lock().unwrap().is_some());assert!(state.native_safety.lock().unwrap().as_ref().unwrap().latch.is_none());
        assert!(state.workflow_reservation.lock().unwrap().as_ref().is_some_and(|r|r.workflow_id=="own-flow"));assert_eq!(state.explorer_claims.lock().unwrap().len(),1);
        assert_eq!(state.browser_foundation.scope_epoch(),browser_epoch);assert_eq!(calls.load(Ordering::SeqCst),0);assert_eq!(state.carrier_stop_hooks.entries.lock().unwrap().len(),1);
    }
    #[test] fn scoped_stop_missing_retired_and_unsafe_original_are_effect_free(){
        let(state,scope)=scoped_stop_fixture();
        for change in [(|s:&mut NativeSafetySession|s.retired=true) as fn(&mut NativeSafetySession),|s|s.owner_binding_id.clear(),|s|s.native_boot_nonce.clear(),|s|s.original_generation=9_007_199_254_740_991]{
            let mut bad=scope.clone();change(&mut bad);*state.native_safety.lock().unwrap()=Some(bad);
            assert_eq!(native_scoped_stop(&state,&scope.native_session_id).unwrap_err(),"NATIVE_STOP_SCOPE_UNAVAILABLE");
            assert!(!state.stopped.load(Ordering::SeqCst));assert_eq!(state.session_generation.load(Ordering::SeqCst),1);
            assert_eq!(state.carrier_stop_hooks.active_cleanup.load(Ordering::SeqCst),0);
        }
        *state.native_safety.lock().unwrap()=None;assert_eq!(native_scoped_stop(&state,&scope.native_session_id).unwrap_err(),"NATIVE_STOP_SCOPE_UNAVAILABLE");
    }
    #[test] fn scoped_stop_retained_retry_without_session_preserves_latch_and_later_global_epoch(){
        let(state,scope)=scoped_stop_fixture();let first=native_scoped_stop(&state,&scope.native_session_id).unwrap();
        assert!(state.session.lock().unwrap().is_none());assert_eq!(first["originalGeneration"],1);assert_eq!(first["latchedGeneration"],2);
        let second=native_scoped_stop(&state,&scope.native_session_id).unwrap();assert_eq!(second["observedAt"],first["observedAt"]);assert_eq!(state.session_generation.load(Ordering::SeqCst),2);
        let global=computer_stop_legacy(&state).unwrap();assert_eq!(state.session_generation.load(Ordering::SeqCst),3);assert_eq!(global["observedAt"],first["observedAt"]);
        let retry=native_scoped_stop(&state,&scope.native_session_id).unwrap();assert_eq!(retry["observedAt"],first["observedAt"]);assert_eq!(retry["latchedGeneration"],2);
    }
    #[test] fn scoped_stop_activation_wins_protects_replacement_and_stop_wins_fences_approval(){
        let(state,scope)=scoped_stop_fixture();let mut replacement=scope.clone();replacement.native_session_id="replacement".into();replacement.safety_session_ref="new-ref".into();replacement.original_generation=2;
        native_activate(&state,ComputerSession{id:"replacement".into(),expires_at:SystemTime::now()+Duration::from_secs(60)},&replacement,1,Some(&scope)).unwrap();
        assert_eq!(native_scoped_stop(&state,&scope.native_session_id).unwrap_err(),"NATIVE_STOP_SCOPE_MISMATCH");
        assert_eq!(state.session_generation.load(Ordering::SeqCst),2);assert!(!state.stopped.load(Ordering::SeqCst));assert_eq!(state.session.lock().unwrap().as_ref().unwrap().id,"replacement");
        let(state,scope)=scoped_stop_fixture();native_scoped_stop(&state,&scope.native_session_id).unwrap();
        assert!(native_activate(&state,ComputerSession{id:"replacement".into(),expires_at:SystemTime::now()+Duration::from_secs(60)},&replacement,1,Some(&scope)).is_err());
        assert_eq!(state.session_generation.load(Ordering::SeqCst),2);assert!(state.stopped.load(Ordering::SeqCst));assert!(state.session.lock().unwrap().is_none());
    }
    #[test] fn scoped_stop_counter_zero_incomplete_and_fault_never_admit_activation(){
        let(state,scope)=scoped_stop_fixture();let mut replacement=scope.clone();replacement.original_generation=2;
        for fault in [false,true]{*state.carrier_stop_hooks.lifecycle.lock().unwrap()=Some(NativeTermination{original:scope.clone(),complete:false,fault,busy:false});
            assert_eq!(state.carrier_stop_hooks.active_cleanup.load(Ordering::SeqCst),0);
            assert!(native_activate(&state,ComputerSession{id:scope.native_session_id.clone(),expires_at:SystemTime::now()+Duration::from_secs(60)},&replacement,1,Some(&scope)).is_err());
            assert_eq!(state.session_generation.load(Ordering::SeqCst),1);
        }
    }
    #[test] fn scoped_stop_blocked_dispatch_returns_latched_without_waiting(){
        let(state,scope)=scoped_stop_fixture();let witness=state.action_dispatch.lock().unwrap();
        let result=native_scoped_stop(&state,&scope.native_session_id).unwrap();assert_eq!(result["state"],"native_latched");assert_eq!(result["nativeSessionId"],scope.native_session_id);
        drop(witness);assert_eq!(native_scoped_stop(&state,&scope.native_session_id).unwrap()["state"],"native_quiescent");
    }
    #[test] fn scoped_stop_witness_is_held_through_real_receipt_work(){
        let dispatch=Mutex::new(());
        let result=native_with_dispatch_witness(&dispatch,|held|{assert!(held);assert!(dispatch.try_lock().is_err());17});
        assert_eq!(result,17);assert!(dispatch.try_lock().is_ok());
    }
    #[test] fn scoped_stop_callback_fault_is_unknown_and_remains_fenced_at_zero_count(){
        let(state,scope)=scoped_stop_fixture();state.carrier_stop_hooks.entries.lock().unwrap().push((1,Arc::new(|_|panic!("controlled cleanup fault"))));
        assert_eq!(native_scoped_stop(&state,&scope.native_session_id).unwrap(),native_stop_unknown());
        assert_eq!(state.carrier_stop_hooks.active_cleanup.load(Ordering::SeqCst),0);
        let life=state.carrier_stop_hooks.lifecycle.lock().unwrap();assert!(life.as_ref().is_some_and(|t|t.fault&&!t.complete&&!t.busy));
        assert!(!native_activation_ready(&life,&state.carrier_stop_hooks));
    }
    #[test] fn scoped_stop_old_callbacks_and_denials_cannot_change_replacement(){
        let(state,scope)=scoped_stop_fixture();let mut replacement=scope.clone();replacement.native_session_id="replacement".into();replacement.safety_session_ref="new-ref".into();replacement.original_generation=2;
        native_activate(&state,ComputerSession{id:"replacement".into(),expires_at:SystemTime::now()+Duration::from_secs(60)},&replacement,1,Some(&scope)).unwrap();
        let calls=Arc::new(AtomicU64::new(0));let seen=Arc::clone(&calls);state.carrier_stop_hooks.entries.lock().unwrap().push((1,Arc::new(move|_|{seen.fetch_add(1,Ordering::SeqCst);}))); 
        native_cleanup_epoch(&state.carrier_stop_hooks,1);
        let bridge=SafetyBridge{token:"unused".into(),port:0,safety:Arc::clone(&state.native_safety),stop_hooks:Arc::clone(&state.carrier_stop_hooks)};
        assert!(safety_latch_original(&bridge,&state.stopped,&state.session_generation,&scope).is_none());
        assert_eq!(calls.load(Ordering::SeqCst),0);assert_eq!(state.carrier_stop_hooks.active_cleanup.load(Ordering::SeqCst),0);assert!(!state.stopped.load(Ordering::SeqCst));assert_eq!(state.session_generation.load(Ordering::SeqCst),2);
    }
    #[test] fn scoped_stop_legacy_retired_receipt_remains_known(){
        let(state,scope)=scoped_stop_fixture();let first=computer_stop_legacy(&state).unwrap();state.native_safety.lock().unwrap().as_mut().unwrap().retired=true;
        let second=computer_stop_legacy(&state).unwrap();assert_eq!(second["nativeSessionId"],scope.native_session_id);assert_eq!(second["observedAt"],first["observedAt"]);
        assert_eq!(native_scoped_stop(&state,&scope.native_session_id).unwrap_err(),"NATIVE_STOP_SCOPE_UNAVAILABLE");
    }
    #[test] fn scoped_stop_global_without_safety_keeps_browser_and_claim_cleanup(){
        let state=ComputerState::default();let before=state.browser_foundation.scope_epoch();
        state.explorer_claims.lock().unwrap().push(NativeExplorerClaim{session_id:"old".into(),operation_id:"op".into(),operation:"copy".into(),reverse_of:None,destination_path:"synthetic-unused".into(),workflow_id:String::new(),epoch:0,claimed_at:SystemTime::now(),expires_at:now_ms()+1000});
        assert_eq!(computer_stop_legacy(&state).unwrap(),native_stop_unknown());assert!(state.explorer_claims.lock().unwrap().is_empty());assert!(state.browser_foundation.scope_epoch()>before);assert!(state.stopped.load(Ordering::SeqCst));
    }
    #[test] fn scoped_stop_bad_retained_latch_and_foreign_active_never_relatched(){
        assert!(native_stop_timestamp("2026-10-16T19:00:00.123Z"));
        for invalid in ["2026-10-16T19:00:00Z","2026-10-16T19:00:00.123+00:00","+12026-10-16T19:00:00.123Z","2026-02-31T19:00:00.123Z"]{assert!(!native_stop_timestamp(invalid));}
        let(state,scope)=scoped_stop_fixture();native_scoped_stop(&state,&scope.native_session_id).unwrap();
        state.native_safety.lock().unwrap().as_mut().unwrap().latch.as_mut().unwrap().observed_at="not-a-time".into();
        assert_eq!(native_scoped_stop(&state,&scope.native_session_id).unwrap_err(),"NATIVE_STOP_SCOPE_UNAVAILABLE");assert_eq!(state.session_generation.load(Ordering::SeqCst),2);
        *state.session.lock().unwrap()=Some(ComputerSession{id:"foreign".into(),expires_at:SystemTime::now()+Duration::from_secs(60)});
        assert_eq!(native_scoped_stop(&state,&scope.native_session_id).unwrap_err(),"NATIVE_STOP_SCOPE_MISMATCH");
    }
    #[test] fn scoped_stop_status_contract_is_compiled_and_serialization_omits_unsupported(){
        let mut status=ComputerStatus{runtime:"tauri",scoped_stop_contract:native_scoped_stop_contract(),mode:"disabled",available:false,screen_capture:"unknown",mouse_control:"unknown",keyboard_control:"unknown",owner_command_mode:false,kill_switch:"active",overlay:"unknown",native_overlay_ready:false,targeting:"unknown",uia:"unknown",ocr:"unknown",multi_monitor:"unknown",verification:"unknown",session_expires_at:None,safe_message:"synthetic inactive".into()};
        let json=serde_json::to_value(&status).unwrap();
        if cfg!(windows){assert_eq!(json["scopedStopContract"],"edith.computer.expected-session-stop/1");}else{assert!(json.get("scopedStopContract").is_none());}
        status.scoped_stop_contract=None;assert!(serde_json::to_value(&status).unwrap().get("scopedStopContract").is_none());
    }
    #[test] fn scoped_stop_cleanup_callback_fence_blocks_activation_without_holding_gate(){
        let(state,scope)=scoped_stop_fixture();let state=Arc::new(state);
        let release=Arc::new((Mutex::new(false),std::sync::Condvar::new()));let callback_release=Arc::clone(&release);
        let(tx,rx)=std::sync::mpsc::channel();
        state.carrier_stop_hooks.entries.lock().unwrap().push((1,Arc::new(move|_|{
            let _=tx.send(());let(lock,wake)=&*callback_release;
            let guard=lock.lock().unwrap();let _released=wake.wait_timeout_while(guard,Duration::from_secs(5),|done|!*done).unwrap();
        })));
        let worker_state=Arc::clone(&state);let id=scope.native_session_id.clone();let worker=std::thread::spawn(move||native_scoped_stop(&worker_state,&id));
        let entered=rx.recv_timeout(Duration::from_secs(5)).is_ok();
        let mut next=scope.clone();next.original_generation=3;next.native_session_id="replacement".into();next.safety_session_ref="next-safety".into();
        let attempt=native_activate(&state,ComputerSession{id:"replacement".into(),expires_at:SystemTime::now()+Duration::from_secs(60)},&next,2,Some(&scope));
        let count=state.carrier_stop_hooks.active_cleanup.load(Ordering::SeqCst);
        {let(lock,wake)=&*release;*lock.lock().unwrap()=true;wake.notify_all();}
        let stopped=worker.join().unwrap().unwrap();
        assert!(entered);assert!(attempt.is_err());assert!(count>0);assert_eq!(stopped["nativeSessionId"],scope.native_session_id);
        native_activate(&state,ComputerSession{id:"replacement".into(),expires_at:SystemTime::now()+Duration::from_secs(60)},&next,2,Some(&scope)).unwrap();
        native_cleanup_epoch(&state.carrier_stop_hooks,1);assert_eq!(state.session.lock().unwrap().as_ref().unwrap().id,"replacement");assert!(!state.stopped.load(Ordering::SeqCst));
    }
    #[test] fn scoped_stop_hook_poison_fences_counter_zero_and_global_poison_still_revokes(){
        let(state,scope)=scoped_stop_fixture();let hooks=Arc::clone(&state.carrier_stop_hooks);
        let _=std::thread::spawn(move||{let _guard=hooks.entries.lock().unwrap();panic!("controlled hook poison");}).join();
        assert_eq!(native_scoped_stop(&state,&scope.native_session_id).unwrap(),native_stop_unknown());
        assert_eq!(state.carrier_stop_hooks.active_cleanup.load(Ordering::SeqCst),0);
        assert!(state.carrier_stop_hooks.lifecycle.lock().unwrap().as_ref().is_some_and(|t|t.fault&&!t.complete));
        let(state,_)=scoped_stop_fixture();let state=Arc::new(state);let poisoned=Arc::clone(&state);
        let _=std::thread::spawn(move||{let _guard=poisoned.session.lock().unwrap();panic!("controlled session poison");}).join();
        assert!(computer_stop_legacy(&state).is_err());assert!(state.stopped.load(Ordering::SeqCst));assert_eq!(state.session_generation.load(Ordering::SeqCst),2);
    }
    #[test] fn scoped_stop_cleanup_lease_unwind_never_turns_count_zero_into_completion(){
        let(state,scope)=scoped_stop_fixture();
        *state.carrier_stop_hooks.lifecycle.lock().unwrap()=Some(NativeTermination{original:scope.clone(),complete:false,fault:false,busy:true});
        let lease=NativeStopCleanup{hooks:&state.carrier_stop_hooks,original:scope,pending:Some(NativeCleanupPending::new(&state.carrier_stop_hooks.active_cleanup)),finished:false};
        drop(lease);
        let life=state.carrier_stop_hooks.lifecycle.lock().unwrap();assert!(life.as_ref().is_some_and(|t|t.fault&&!t.complete&&!t.busy));
        assert_eq!(state.carrier_stop_hooks.active_cleanup.load(Ordering::SeqCst),0);assert!(!native_activation_ready(&life,&state.carrier_stop_hooks));
    }
    #[test] fn scoped_stop_delayed_reserve_commit_does_not_prune_replacement(){
        let(state,original)=scoped_stop_fixture();let mut replacement=original.clone();
        replacement.native_session_id="replacement".into();replacement.safety_session_ref="replacement-ref".into();replacement.owner_binding_id="replacement-owner".into();replacement.original_generation=2;
        let expires=SystemTime::now()+Duration::from_secs(60);
        native_activate(&state,ComputerSession{id:replacement.native_session_id.clone(),expires_at:expires},&replacement,1,Some(&original)).unwrap();
        *state.workflow_reservation.lock().unwrap()=Some(NativeWorkflowReservation{session_id:replacement.native_session_id.clone(),workflow_id:"new-flow".into(),epoch:2,expires_at:0,requested_deadline:1,browser_incarnation:9});
        let browser=state.browser_foundation.scope_epoch();let incarnation=state.browser_reservation_incarnation.load(Ordering::SeqCst);
        assert!(native_reserve_commit(&state,original.native_session_id.clone(),"old-flow".into(),1,now_ms()+1000).is_err());
        assert!(state.workflow_reservation.lock().unwrap().as_ref().is_some_and(|r|r.session_id=="replacement"&&r.workflow_id=="new-flow"&&r.epoch==2&&r.expires_at==0&&r.requested_deadline==1&&r.browser_incarnation==9));
        assert!(state.session.lock().unwrap().as_ref().is_some_and(|s|s.id=="replacement"&&s.expires_at==expires));
        assert!(state.native_safety.lock().unwrap().as_ref().is_some_and(|s|same_safety_scope(s,&replacement)&&s.latch.is_none()&&!s.retired));
        assert_eq!(state.browser_foundation.scope_epoch(),browser);assert_eq!(state.browser_reservation_incarnation.load(Ordering::SeqCst),incarnation);
        assert_eq!(state.session_generation.load(Ordering::SeqCst),2);assert!(!state.stopped.load(Ordering::SeqCst));assert_eq!(state.carrier_stop_hooks.active_cleanup.load(Ordering::SeqCst),0);
    }
    #[test] fn scoped_stop_delayed_release_commit_does_not_prune_or_invalidate_replacement(){
        let(state,original)=scoped_stop_fixture();let mut replacement=original.clone();
        replacement.native_session_id="replacement".into();replacement.safety_session_ref="replacement-ref".into();replacement.owner_binding_id="replacement-owner".into();replacement.original_generation=2;
        let expires=SystemTime::now()+Duration::from_secs(60);
        native_activate(&state,ComputerSession{id:replacement.native_session_id.clone(),expires_at:expires},&replacement,1,Some(&original)).unwrap();
        *state.workflow_reservation.lock().unwrap()=Some(NativeWorkflowReservation{session_id:replacement.native_session_id.clone(),workflow_id:"new-flow".into(),epoch:2,expires_at:0,requested_deadline:1,browser_incarnation:9});
        let browser=state.browser_foundation.scope_epoch();let incarnation=state.browser_reservation_incarnation.load(Ordering::SeqCst);
        assert!(native_release_commit(&state,&original.native_session_id,"old-flow").is_err());
        assert!(state.workflow_reservation.lock().unwrap().as_ref().is_some_and(|r|r.session_id=="replacement"&&r.workflow_id=="new-flow"&&r.epoch==2&&r.expires_at==0&&r.requested_deadline==1&&r.browser_incarnation==9));
        assert!(state.session.lock().unwrap().as_ref().is_some_and(|s|s.id=="replacement"&&s.expires_at==expires));
        assert!(state.native_safety.lock().unwrap().as_ref().is_some_and(|s|same_safety_scope(s,&replacement)&&s.latch.is_none()&&!s.retired));
        assert_eq!(state.browser_foundation.scope_epoch(),browser);assert_eq!(state.browser_reservation_incarnation.load(Ordering::SeqCst),incarnation);
        assert_eq!(state.session_generation.load(Ordering::SeqCst),2);assert!(!state.stopped.load(Ordering::SeqCst));assert_eq!(state.carrier_stop_hooks.active_cleanup.load(Ordering::SeqCst),0);
    }    #[test] fn scoped_stop_actual_receipt_requires_each_work_witness_and_complete_nonbusy_state(){
        let(state,scope)=scoped_stop_fixture();native_scoped_stop(&state,&scope.native_session_id).unwrap();
        let original=state.native_safety.lock().unwrap().as_ref().unwrap().clone();let fact=original.latch.as_ref().unwrap();
        assert_eq!(native_stop_receipt_core(&state,&original,fact,true,&||false,&||true)["state"],"native_latched");
        assert_eq!(native_stop_receipt_core(&state,&original,fact,true,&||true,&||false)["state"],"native_latched");
        let carrier=||{assert!(state.action_dispatch.try_lock().is_err());true};
        assert_eq!(native_stop_receipt_core(&state,&original,fact,true,&carrier,&||true)["state"],"native_quiescent");
        for(complete,busy)in[(false,false),(true,true)]{
            {let mut life=state.carrier_stop_hooks.lifecycle.lock().unwrap();let t=life.as_mut().unwrap();t.complete=complete;t.busy=busy;}
            assert_ne!(native_stop_receipt_core(&state,&original,fact,true,&||true,&||true)["state"],"native_quiescent");
        }
        {let mut life=state.carrier_stop_hooks.lifecycle.lock().unwrap();let t=life.as_mut().unwrap();t.complete=true;t.busy=false;t.fault=true;}
        assert_eq!(native_stop_receipt_core(&state,&original,fact,true,&||true,&||true),native_stop_unknown());
    }
    #[test] fn scoped_stop_busy_partial_state_cannot_invent_an_uncommitted_latch(){
        let(state,scope)=scoped_stop_fixture();
        *state.carrier_stop_hooks.lifecycle.lock().unwrap()=Some(NativeTermination{original:scope.clone(),complete:false,fault:false,busy:true});
        assert_eq!(native_scoped_stop(&state,&scope.native_session_id).unwrap_err(),"NATIVE_STOP_SCOPE_UNAVAILABLE");
        assert!(!state.stopped.load(Ordering::SeqCst));assert_eq!(state.session_generation.load(Ordering::SeqCst),1);assert_eq!(state.carrier_stop_hooks.active_cleanup.load(Ordering::SeqCst),0);
        assert!(state.native_safety.lock().unwrap().as_ref().unwrap().latch.is_none());
        *state.carrier_stop_hooks.lifecycle.lock().unwrap()=None;native_scoped_stop(&state,&scope.native_session_id).unwrap();
        state.carrier_stop_hooks.lifecycle.lock().unwrap().as_mut().unwrap().busy=true;
        assert_eq!(native_scoped_stop(&state,&scope.native_session_id).unwrap()["state"],"native_latched");assert_eq!(state.session_generation.load(Ordering::SeqCst),2);
    }
    #[test] fn scoped_stop_unscoped_fault_fences_activation_and_legacy_missing_bridge_is_unknown(){
        let(state,scope)=scoped_stop_fixture();state.carrier_stop_hooks.cleanup_fault.store(true,Ordering::SeqCst);
        let life=state.carrier_stop_hooks.lifecycle.lock().unwrap();assert!(!native_activation_ready(&life,&state.carrier_stop_hooks));drop(life);
        *state.bridge.lock().unwrap()=None;assert_eq!(computer_stop_legacy(&state).unwrap(),native_stop_unknown());
        assert!(!state.carrier_stop_hooks.cleanup_fault.load(Ordering::SeqCst));
        assert_eq!(native_scoped_stop(&state,&scope.native_session_id).unwrap()["nativeSessionId"],scope.native_session_id);
    }
    #[test] fn scoped_stop_legacy_native_safety_poison_preserves_error_and_revocation(){
        let(state,_)=scoped_stop_fixture();let safety=Arc::clone(&state.native_safety);
        let _=std::thread::spawn(move||{let _guard=safety.lock().unwrap();panic!("controlled safety poison");}).join();
        assert_eq!(computer_stop_legacy(&state).unwrap_err(),"NATIVE_SAFETY_STATE_UNAVAILABLE");assert!(state.stopped.load(Ordering::SeqCst));assert_eq!(state.session_generation.load(Ordering::SeqCst),2);
    }
    #[test] fn scoped_stop_matching_expired_reservation_still_releases_and_missing_release_is_noop(){
        let(state,scope)=scoped_stop_fixture();
        *state.workflow_reservation.lock().unwrap()=Some(NativeWorkflowReservation{session_id:scope.native_session_id.clone(),workflow_id:"own-flow".into(),epoch:1,expires_at:0,requested_deadline:1,browser_incarnation:2});
        let before=state.browser_reservation_incarnation.load(Ordering::SeqCst);
        assert!(native_release_commit(&state,&scope.native_session_id,"own-flow").unwrap());assert!(state.workflow_reservation.lock().unwrap().is_none());
        let after=state.browser_reservation_incarnation.load(Ordering::SeqCst);assert!(after>before);
        assert!(native_release_commit(&state,"foreign","foreign-flow").unwrap());assert_eq!(state.browser_reservation_incarnation.load(Ordering::SeqCst),after);
    }
    #[test] fn scoped_stop_reserve_commit_uses_actual_owner_and_rejects_foreign_expired_workflow(){
        let(state,scope)=scoped_stop_fixture();let requested=now_ms()+1000;
        let result=native_reserve_commit(&state,scope.native_session_id.clone(),"own-flow".into(),1,requested).unwrap();assert!(result["expiresAt"].as_u64().unwrap()<=requested);
        state.workflow_reservation.lock().unwrap().as_mut().unwrap().expires_at=0;
        assert!(native_reserve_commit(&state,scope.native_session_id.clone(),"foreign-flow".into(),1,requested).is_err());
        assert!(state.workflow_reservation.lock().unwrap().as_ref().is_some_and(|r|r.workflow_id=="own-flow"));
        native_release_commit(&state,&scope.native_session_id,"own-flow").unwrap();
        state.native_safety.lock().unwrap().as_mut().unwrap().owner_binding_id.clear();
        assert!(native_reserve_commit(&state,scope.native_session_id.clone(),"own-flow".into(),1,requested).is_err());assert!(state.workflow_reservation.lock().unwrap().is_none());
    }
    #[test] fn scoped_stop_activation_rejects_changed_original_and_partial_private_session(){
        let(state,scope)=scoped_stop_fixture();let mut enrollment=scope.clone();enrollment.original_generation=2;enrollment.native_session_id="replacement".into();
        state.native_safety.lock().unwrap().as_mut().unwrap().owner_binding_id="changed-owner".into();
        assert!(native_activate(&state,ComputerSession{id:"replacement".into(),expires_at:SystemTime::now()+Duration::from_secs(60)},&enrollment,1,Some(&scope)).is_err());
        *state.native_safety.lock().unwrap()=Some(scope.clone());state.session.lock().unwrap().as_mut().unwrap().id="foreign-partial".into();
        assert!(native_activate(&state,ComputerSession{id:"replacement".into(),expires_at:SystemTime::now()+Duration::from_secs(60)},&enrollment,1,Some(&scope)).is_err());
        assert_eq!(state.session_generation.load(Ordering::SeqCst),1);assert!(!state.stopped.load(Ordering::SeqCst));assert_eq!(state.session.lock().unwrap().as_ref().unwrap().id,"foreign-partial");
    }
    #[test] fn scoped_stop_largest_safe_original_has_exact_safe_successor(){
        let(state,scope)=scoped_stop_fixture();let original=9_007_199_254_740_990;
        state.native_safety.lock().unwrap().as_mut().unwrap().original_generation=original;state.session_generation.store(original,Ordering::SeqCst);
        let value=native_scoped_stop(&state,&scope.native_session_id).unwrap();assert_eq!(value["originalGeneration"].as_u64(),Some(9_007_199_254_740_990));assert_eq!(value["latchedGeneration"].as_u64(),Some(9_007_199_254_740_991));
    }    fn canonical_safety_fixture()->(SafetyBridge,NativeSafetySession,serde_json::Value){
        let now=now_ms();
        let session=NativeSafetySession{safety_session_ref:"SIM-safety".into(),native_session_id:"SIM-session".into(),owner_binding_id:"SIM-owner".into(),original_generation:1,expires_at_ms:now+60_000,stop_request:None,latch:None,native_boot_nonce:"SIM-boot".into(),retired:false,quiescent_at:None};
        let safety=Arc::new(Mutex::new(Some(session.clone())));
        let bridge=SafetyBridge{token:"SIM-unused-no-transport".into(),port:0,safety:Arc::clone(&safety),stop_hooks:Arc::new(CarrierStopHookRegistry{entries:Mutex::new(Vec::new()),active_cleanup:AtomicU64::new(0),lifecycle:Mutex::new(None),cleanup_fault:AtomicBool::new(false),safety})};
        let request=serde_json::json!({"scope":"global","state":"backend_accepted","safetySessionRef":session.safety_session_ref,"nativeSessionId":session.native_session_id,"originalGeneration":1,"stopRequestId":"SIM-stop","acceptedAt":native_iso(now).unwrap(),"expiresAt":native_iso(now+20_000).unwrap()});
        (bridge,session,request)
    }
    #[test]
    fn scoped_stop_wrong_original_reference_has_zero_effects(){
        let(bridge,_,_)=canonical_safety_fixture();
        let stopped=AtomicBool::new(false);let generation=AtomicU64::new(1);
        let calls=Arc::new(AtomicU64::new(0));let seen=Arc::clone(&calls);
        bridge.stop_hooks.entries.lock().unwrap().push((1,Arc::new(move|_|{seen.fetch_add(1,Ordering::SeqCst);})));
        let mut foreign=bridge.safety.lock().unwrap().as_ref().unwrap().clone();foreign.safety_session_ref="foreign-safety".into();
        assert!(safety_latch_original(&bridge,&stopped,&generation,&foreign).is_none());
        assert!(!stopped.load(Ordering::SeqCst));
        assert_eq!(generation.load(Ordering::SeqCst),1);
        assert_eq!(calls.load(Ordering::SeqCst),0);
        assert!(bridge.safety.lock().unwrap().as_ref().unwrap().latch.is_none());
    }
    #[test]
    fn scoped_stop_stale_workflow_guard_does_not_remove_replacement(){
        let rows=Mutex::new(Some(NativeWorkflowReservation{session_id:"replacement".into(),workflow_id:"replacement-flow".into(),epoch:3,
            expires_at:now_ms()+60_000,requested_deadline:now_ms()+60_000,browser_incarnation:4}));
        assert!(workflow_access(&rows,1,"old",Some("old-flow")).is_err());
        let current=rows.lock().unwrap();
        assert!(current.as_ref().is_some_and(|r|r.session_id=="replacement"&&r.epoch==3));
    }
    #[test] fn scoped_stop_same_epoch_foreign_workflow_cannot_prune_expired_replacement(){
        let rows=Mutex::new(Some(NativeWorkflowReservation{session_id:"same".into(),workflow_id:"new-flow".into(),epoch:3,
            expires_at:0,requested_deadline:1,browser_incarnation:4}));
        assert!(workflow_access(&rows,3,"same",Some("old-flow")).is_err());
        assert!(workflow_access(&rows,3,"same",None).is_err());
        assert!(rows.lock().unwrap().as_ref().is_some_and(|r|r.workflow_id=="new-flow"));
        assert!(workflow_access(&rows,3,"same",Some("new-flow")).is_err());assert!(rows.lock().unwrap().is_none());
    }
    #[test]
    fn canonical_kill_still_validates_and_retains_stop_request(){
        let(bridge,session,request)=canonical_safety_fixture();
        let facts=safety_poll_response_facts(&bridge,&session,&serde_json::json!({"killSwitchActive":true,"stopRequest":request})).unwrap();
        assert_eq!(facts,(true,true));assert_eq!(safety_poll_denial(facts),Err("KILL_SWITCH_ACTIVE".into()));
        assert_eq!(bridge.safety.lock().unwrap().as_ref().unwrap().stop_request,Some(request));
    }
    #[test]
    fn stop_request_without_kill_retains_generic_denial(){
        let(bridge,session,request)=canonical_safety_fixture();
        let facts=safety_poll_response_facts(&bridge,&session,&serde_json::json!({"killSwitchActive":false,"stopRequest":request})).unwrap();
        assert_eq!(facts,(true,false));assert_eq!(safety_poll_denial(facts),Err("Emergency stop is active. Computer Use is blocked.".into()));
        assert!(bridge.safety.lock().unwrap().as_ref().unwrap().stop_request.is_some());
    }
    #[test]
    fn active_kill_cannot_skip_invalid_stop_scope(){
        let(bridge,session,mut request)=canonical_safety_fixture();request["nativeSessionId"]=serde_json::json!("other");
        assert_eq!(safety_poll_response_facts(&bridge,&session,&serde_json::json!({"killSwitchActive":true,"stopRequest":request})),Err("NATIVE_STOP_REQUEST_SCOPE_INVALID".into()));
        assert!(bridge.safety.lock().unwrap().as_ref().unwrap().stop_request.is_none());
    }
    #[test]
    fn unknown_kill_is_not_canonical_active(){
        let(bridge,session,_)=canonical_safety_fixture();
        assert_eq!(safety_poll_response_facts(&bridge,&session,&serde_json::json!({"killSwitchActive":"true"})),Err("NATIVE_SAFETY_KILL_UNKNOWN".into()));
        assert_eq!(safety_poll_denial((false,false)),Ok(()));
    }

    #[test]
    fn steam_diagnostic_safety_keeps_session_epoch_separate_from_observation_generation(){
        let original=NativeSafetySession{safety_session_ref:"safety-original".into(),native_session_id:"session-original".into(),owner_binding_id:"owner-original".into(),
            original_generation:7,expires_at_ms:now_ms()+60_000,stop_request:None,latch:None,native_boot_nonce:"boot-original".into(),retired:false,quiescent_at:None};
        let safety=Mutex::new(Some(original.clone()));
        assert!(steam_diagnostic_safety_current(&safety,&original,7,"session-original").is_ok());
        assert!(steam_diagnostic_safety_current(&safety,&original,8,"session-original").is_err());
        assert!(steam_diagnostic_safety_current(&safety,&original,7,"other-session").is_err());
        let changes:[fn(&mut NativeSafetySession);8]=[
            |s|s.owner_binding_id.push('x'),|s|s.native_boot_nonce.push('x'),|s|s.safety_session_ref.push('x'),
            |s|s.original_generation+=1,|s|s.expires_at_ms+=1,|s|s.retired=true,
            |s|s.stop_request=Some(serde_json::json!({})),
            |s|s.latch=Some(NativeStopFact{original_generation:7,latched_generation:8,observed_at:"fixture".into()})];
        for change in changes{
            let mut current=original.clone();change(&mut current);*safety.lock().unwrap()=Some(current);
            assert!(steam_diagnostic_safety_current(&safety,&original,7,"session-original").is_err());
        }
        *safety.lock().unwrap()=None;
        assert!(steam_diagnostic_safety_current(&safety,&original,7,"session-original").is_err());
    }

    #[test]
    fn steam_read_native_scope_uses_actual_original_safety_without_observation(){
        let (_,mut original,_)=canonical_safety_fixture();
        let now=now_ms();
        original.expires_at_ms=now+10_000;
        let before=(original.native_session_id.clone(),original.safety_session_ref.clone(),original.original_generation,original.expires_at_ms);
        let scope=steam_read_original_scope(&original,original.original_generation,&original.native_session_id,now).unwrap();
        assert_eq!((scope.session_id,scope.safety_session_ref,scope.original_epoch,scope.native_expires_at_ms),before);
        assert_eq!(original.expires_at_ms,now+10_000);
    }

    #[test]
    fn steam_read_native_scope_rejects_missing_changed_latched_and_expired_authority(){
        let (_,original,_)=canonical_safety_fixture();let now=now_ms();
        for change in [
            (|s:&mut NativeSafetySession|s.native_session_id="other".into()) as fn(&mut NativeSafetySession),
            |s|s.original_generation+=1,|s|s.safety_session_ref.clear(),|s|s.owner_binding_id.clear(),
            |s|s.native_boot_nonce.clear(),|s|s.retired=true,
            |s|s.latch=Some(NativeStopFact{original_generation:1,latched_generation:2,observed_at:"fixture".into()}),
            |s|s.expires_at_ms=0,
        ] {
            let mut changed=original.clone();change(&mut changed);
            assert!(steam_read_original_scope(&changed,original.original_generation,&original.native_session_id,now).is_err());
        }
    }

    #[test]
    fn steam_read_deadline_never_renews_or_crosses_original_minimum(){
        assert_eq!(steam_read_original_deadline(100,80,90,u64::MAX,10).unwrap(),80);
        assert_eq!(steam_read_original_deadline(100,80,90,u64::MAX,79).unwrap(),80);
        assert!(steam_read_original_deadline(100,80,90,u64::MAX,80).is_err());
        assert_eq!(steam_read_original_deadline(100,110,90,u64::MAX,10).unwrap(),90);
        assert!(steam_read_original_deadline(0,u64::MAX,u64::MAX,u64::MAX,0).is_err());
    }

    #[test]
    fn steam_read_lifecycle_reservation_10s_clamps_original_minimum(){
        let now=1_000;
        let reservation=NativeWorkflowReservation{session_id:"session".into(),workflow_id:"workflow".into(),epoch:7,
            expires_at:now+10_000,requested_deadline:now+60_000,browser_incarnation:3};
        let deadline=steam_read_original_deadline(now+60_000,now+60_000,now+60_000,reservation.expires_at,now).unwrap();
        assert_eq!(deadline,reservation.expires_at);
    }

    #[test]
    fn steam_read_lifecycle_reservation_snapshot_rejects_replacement_and_expiry(){
        let mut row=NativeWorkflowReservation{session_id:"session".into(),workflow_id:"workflow".into(),epoch:7,
            expires_at:11_000,requested_deadline:61_000,browser_incarnation:3};
        let original=steam_read_reservation_snapshot(&row,"session","workflow",7,1_000).unwrap();
        assert!(steam_read_reservation_current(&row,&original,"session","workflow",7,10_999).is_ok());
        assert_eq!(steam_read_reservation_current(&row,&original,"session","workflow",7,11_000).err().unwrap(),"STEAM_READ_SCOPE_EXPIRED");
        row.expires_at=61_000;
        assert_eq!(steam_read_reservation_current(&row,&original,"session","workflow",7,1_000).err().unwrap(),"STEAM_READ_SCOPE_CHANGED");
        row.expires_at=11_000;row.browser_incarnation+=1;
        assert!(steam_read_reservation_current(&row,&original,"session","workflow",7,1_000).is_err());
        row.browser_incarnation=3;row.requested_deadline+=1;
        assert!(steam_read_reservation_current(&row,&original,"session","workflow",7,1_000).is_err());
        assert_eq!(steam_read_original_deadline(61_000,61_000,61_000,original.expires_at,1_000).unwrap(),11_000);
        assert!(steam_read_original_deadline(61_000,61_000,61_000,original.expires_at,11_000).is_err());
        for(native,owner,policy,expected)in[(6_000,61_000,61_000,6_000),(61_000,7_000,61_000,7_000),(61_000,61_000,8_000,8_000)]{
            assert_eq!(steam_read_original_deadline(native,owner,policy,original.expires_at,1_000).unwrap(),expected);
        }
    }

    #[test]
    fn steam_read_wire_capture_accepts_only_closed_operation_fields(){
        let reference=format!("steam-read:{}","a".repeat(64));
        let begin=serde_json::json!({"evidence":{"version":1,"op":"begin","sessionId":"session-1","workflowId":"workflow-1","bindingId":"binding-1","policyId":STEAM_READ_POLICY_ID}});
        assert!(matches!(steam_read_evidence(&begin).unwrap(),SteamReadEvidence::Begin{..}));
        let sample=serde_json::json!({"evidence":{"version":1,"op":"sample","readRef":reference,"state":"Library MAIN pre"}});
        assert!(matches!(steam_read_evidence(&sample).unwrap(),SteamReadEvidence::Sample{..}));
        let end=serde_json::json!({"evidence":{"version":1,"op":"end","readRef":reference}});
        assert!(matches!(steam_read_evidence(&end).unwrap(),SteamReadEvidence::End{..}));
        for mut value in [begin.clone(),sample.clone(),end.clone()]{
            value["evidence"]["extra"]=serde_json::json!(false);
            assert_eq!(steam_read_evidence(&value).err().unwrap(),"STEAM_READ_INVALID_REQUEST");
        }
        for field in ["sessionId","observationId","generation","workflowId","policy"]{
            let mut value=sample.clone();value[field]=serde_json::json!("caller");assert!(steam_read_evidence(&value).is_err());
        }
    }

    #[test]
    fn steam_read_wire_capture_rejects_null_wrong_types_versions_refs_and_states(){
        for value in [serde_json::json!({"evidence":null}),serde_json::json!({"evidence":[]}),serde_json::json!({"evidence":{}}),serde_json::json!([])]{assert!(steam_read_evidence(&value).is_err());}
        let reference=format!("steam-read:{}","a".repeat(64));
        let sample=serde_json::json!({"evidence":{"version":1,"op":"sample","readRef":reference,"state":"Library MAIN pre"}});
        for version in [serde_json::json!(0),serde_json::json!(2),serde_json::json!(1.0),serde_json::json!("1"),serde_json::json!(true),serde_json::Value::Null]{let mut v=sample.clone();v["evidence"]["version"]=version;assert!(steam_read_evidence(&v).is_err());}
        for reference in ["steam-read:a".into(),format!("steam-read:{}","A".repeat(64)),format!("steam-read:{} ","a".repeat(64)),"PRIVATE_FIXTURE_ONLY".into()]{let mut v=sample.clone();v["evidence"]["readRef"]=serde_json::json!(reference);assert_eq!(steam_read_evidence(&v).err().unwrap(),"STEAM_READ_INVALID_REQUEST");}
        for state in ["", "library MAIN pre", "Library MAIN pre ", "unknown"]{let mut v=sample.clone();v["evidence"]["state"]=serde_json::json!(state);assert!(steam_read_evidence(&v).is_err());}
        let mut oversized=sample;oversized["evidence"]["state"]=serde_json::json!("x".repeat(2049));assert!(steam_read_evidence(&oversized).is_err());
    }

    #[test]
    fn steam_read_wire_registration_is_closed_and_uses_actual_legacy_intent_rules(){
        let base=serde_json::json!({"sessionId":"session-1","workflowId":"workflow-1","intent":{"app":"steam","workflow":"game_detail","gameName":"Fixture Game"},"evidencePolicyId":STEAM_READ_POLICY_ID});
        assert!(steam_read_register_args(&base).is_ok());
        let mut sequence=base.clone();sequence["intent"]=serde_json::json!(["steam","game_detail","Fixture Game"]);assert!(steam_read_register_args(&sequence).is_err());
        assert!(steam_read_register_args(&serde_json::json!(["session-1","workflow-1",{"app":"steam","workflow":"game_detail","gameName":"Fixture Game"},STEAM_READ_POLICY_ID])).is_err());
        for field in ["observationId","generation","ownerBindingId","hwnd","policy"]{let mut v=base.clone();v[field]=serde_json::json!("caller");assert!(steam_read_register_args(&v).is_err());}
        for field in ["query","volume","extra"]{let mut v=base.clone();v["intent"][field]=serde_json::Value::Null;assert!(steam_read_register_args(&v).is_err());}
        for policy in [serde_json::Value::Null,serde_json::json!(1),serde_json::json!("other")]{let mut v=base.clone();v["evidencePolicyId"]=policy;assert!(steam_read_register_args(&v).is_err());}
        for name in ["".into()," ".into(),"\u{0000}".into(),"x".repeat(161)]{let mut v=base.clone();v["intent"]["gameName"]=serde_json::json!(name);assert!(steam_read_register_args(&v).is_err());}
        let mut v=base;v["sessionId"]=serde_json::json!("not.a.task.id");assert!(steam_read_register_args(&v).is_err());
    }

    #[test]
    fn steam_read_wire_legacy_arg_errors_and_unknown_fields_preserve_tauri_behavior(){
        let v=serde_json::json!({"sessionId":"session-1","ignored":"legacy-unknown"});
        assert_eq!(steam_read_legacy_arg::<String>(&v,"computer_task_register","sessionId").unwrap(),"session-1");
        let error=steam_read_legacy_arg::<String>(&v,"computer_task_register","workflowId").err().unwrap();
        let expected=tauri::Error::InvalidArgs("computer_task_register","workflowId",<serde_json::Error as serde::de::Error>::custom("command computer_task_register missing required key workflowId")).to_string();
        assert_eq!(error,expected);
        let v=serde_json::json!({"generation":"bad"});
        let original=<u64 as serde::Deserialize>::deserialize(&v["generation"]).unwrap_err();
        assert_eq!(steam_read_legacy_arg::<u64>(&v,"computer_steam_diagnostic_capture","generation").err().unwrap(),tauri::Error::InvalidArgs("computer_steam_diagnostic_capture","generation",original).to_string());
    }

    #[test]
    fn steam_read_wire_errors_never_echo_untrusted_details(){
        for error in STEAM_READ_ERRORS{assert_eq!(steam_read_public_error(error.into()),error);}
        assert_eq!(steam_read_public_error("PRIVATE_FIXTURE_ONLY".into()),"STEAM_READ_SCOPE_CHANGED");
        assert_eq!(steam_read_public_error("unsupported_policy".into()),"STEAM_READ_UNSUPPORTED");
    }

    #[test]
    fn steam_read_post_scope_failure_wins_provider_error_and_always_runs(){
        let ran=std::cell::Cell::new(false);
        let result:Result<(),String>=steam_read_after(Err("STEAM_READ_UNSUPPORTED".into()),||{ran.set(true);Err("STEAM_READ_SCOPE_CHANGED".into())});
        assert!(ran.get());assert_eq!(result.err().unwrap(),"STEAM_READ_SCOPE_CHANGED");
        assert_eq!(steam_read_after::<()>(Err("STEAM_READ_TIMEOUT".into()),||Ok(())).err().unwrap(),"STEAM_READ_TIMEOUT");
    }

    fn observation(id: &str, generation: u64, expires_at: u64) -> ObservationContext {
        ObservationContext {
            native_identity: None,
            observation_id: id.into(),
            generation,
            captured_at: expires_at.saturating_sub(15000),
            expires_at,
            window_id: "hwnd:test".into(),
            window_process_id: 1,
            monitor_id: "monitor:-1920:0:1920:1080".into(),
            scale_factor: 1.0,
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
            target:None,
            deadline_at:chrono::Utc::now().checked_add_signed(chrono::Duration::seconds(5)).unwrap().to_rfc3339(),
            x: Some(x),
            y: Some(y),
            button: None,
            text: None,
            key: None,
            keys: None,
            delta: None,
            app: None,
            application_id:None,
            approval_id:None,
            focus_target:None,
            drag_start:None,
            drag_end:None,
            drag_duration_ms:None,
            destination_target:None,
            attempt:Some(1),
            idempotency_key:None,
            extra:serde_json::Map::new(),
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
        assert!(require_session(&state, &id).is_err());
        let (_, mut safety, _) = canonical_safety_fixture();
        safety.native_session_id = id.clone();
        safety.original_generation = state.session_generation.load(Ordering::SeqCst);
        *state.native_safety.lock().unwrap() = Some(safety);
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

    #[test]
    fn atomic_native_endpoints_parameters_and_single_attempt_are_required(){
        let state=ComputerState::default();
        *state.last_observation.lock().unwrap()=Some(observation("atomic-obs",6,now_ms()+5000));
        let mut request=action("atomic-obs",6,-1500,300);
        request.action="dragMouse".into();request.expected_effect="visual_change".into();
        request.idempotency_key=Some("native-atomic-test".into());request.x=None;request.y=None;
        request.drag_start=Some(NativePoint{x:-1500,y:300});request.drag_end=Some(NativePoint{x:-1400,y:350});request.drag_duration_ms=Some(300);
        assert!(validate_action_context(&state,&request).is_ok());
        request.max_attempts=2;assert!(validate_action_context(&state,&request).is_err());request.max_attempts=1;
        request.drag_end=Some(NativePoint{x:200,y:350});assert!(validate_action_context(&state,&request).is_err());request.drag_end=Some(NativePoint{x:-1400,y:350});
        request.drag_duration_ms=Some(1501);assert!(validate_action_context(&state,&request).is_err());request.drag_duration_ms=Some(300);
        request.extra.insert("unknown".into(),serde_json::json!(true));assert!(validate_action_context(&state,&request).is_err());
        assert!(serde_json::from_value::<NativePoint>(serde_json::json!({"x":1,"y":1,"unknown":true})).is_err());
    }
}
