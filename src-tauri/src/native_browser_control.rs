//! Private original-owned browser controller and counted native foundation.
//! Native input-desktop/effective-token queries require the authorized features.
//! This source has not been physically executed or accepted.
use std::collections::{BTreeSet, HashMap};
use std::fmt;
use std::sync::{atomic::{AtomicBool, AtomicU64, Ordering}, Mutex};

pub(crate) use controller::{BrowserDispatchGuard, BrowserHost, BrowserLocalFacts, Controller, ControllerError, PrivateBridge, SafeStatus};

mod controller {
    use super::*;
    use serde::{Deserialize, Serialize};
    use std::io::Read;
    use std::collections::BTreeMap;
    use std::sync::Arc;
    use std::time::Duration;

    const MAX_SAFE: u64 = 9_007_199_254_740_991;
    fn wire(value: &str) -> bool { (32..=160).contains(&value.len()) && value.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b,b'-'|b'_'|b':')) }
    fn retained_identifier(value:&str)->bool { !value.is_empty()&&value.len()<=160&&value.bytes().all(|b|(0x20..=0x7e).contains(&b)) }
    fn digest(value: &str) -> bool { value.len()==64 && value.bytes().all(|b|b.is_ascii_hexdigit()) }
    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub(crate) enum ControllerError { HostUnavailable, InvalidLookup, LocalScopeChanged, TransportUnavailable, InvalidPrivateReply, InternalSourceContractPending, NativeMeasurementUnavailable, QuotaExceeded }
    impl fmt::Display for ControllerError { fn fmt(&self,f:&mut fmt::Formatter<'_>)->fmt::Result { write!(f,"NATIVE_BROWSER_{self:?}") } }
    impl std::error::Error for ControllerError {}

    #[derive(Clone, PartialEq, Eq)]
    pub(crate) struct BrowserLocalFacts {
        boot_epoch:u64, scope_epoch:u64, session_generation:u64, reservation_incarnation:u64,
        session_id:String, reservation_id:Option<String>, session_expires_at_ms:u64,
        reservation_expires_at_ms:Option<u64>, stopped:bool,
    }
    impl BrowserLocalFacts {
        #[allow(clippy::too_many_arguments)]
        pub(crate) fn new(boot_epoch:u64,scope_epoch:u64,session_generation:u64,reservation_incarnation:u64,
            session_id:String,reservation_id:Option<String>,session_expires_at_ms:u64,reservation_expires_at_ms:Option<u64>,stopped:bool)->Result<Self,ControllerError> {
            if boot_epoch==0 || scope_epoch==0 || session_generation==0 || session_generation>MAX_SAFE || reservation_incarnation>MAX_SAFE || !retained_identifier(&session_id)
                || session_expires_at_ms==0 || session_expires_at_ms>MAX_SAFE
                || reservation_id.is_some()!=reservation_expires_at_ms.is_some()
                || reservation_id.as_ref().is_some_and(|s|!retained_identifier(s))
                || reservation_expires_at_ms.is_some_and(|t|t==0||t>MAX_SAFE)
                || (reservation_id.is_some() && reservation_incarnation==0) { return Err(ControllerError::LocalScopeChanged); }
            Ok(Self{boot_epoch,scope_epoch,session_generation,reservation_incarnation,session_id,reservation_id,
                session_expires_at_ms,reservation_expires_at_ms,stopped})
        }
        fn deadline(&self)->u64 { self.reservation_expires_at_ms.unwrap_or(self.session_expires_at_ms).min(self.session_expires_at_ms) }
    }
    #[derive(Clone, PartialEq, Eq)]
    pub(crate) struct PrivateBridge { token:String, port:u16 }
    impl PrivateBridge {
        pub(crate) fn new(token:String,port:u16)->Result<Self,ControllerError> {
            if token.len()<32 || token.len()>4096 || !token.bytes().all(|b|b.is_ascii_graphic()) || port==0 { return Err(ControllerError::TransportUnavailable); }
            Ok(Self{token,port})
        }
    }
    pub(crate) trait BrowserDispatchGuard {}
    impl BrowserDispatchGuard for std::sync::MutexGuard<'_, ()> {}
    pub(crate) trait BrowserHost: Send + Sync {
        fn check_managed(&self)->Result<(),ControllerError>;
        fn dispatch_lock(&self)->Result<Box<dyn BrowserDispatchGuard + '_>,ControllerError>;
        fn local_facts(&self,session:&str,operation:Option<&str>)->Result<BrowserLocalFacts,ControllerError>;
        fn managed_root(&self)->Result<isize,ControllerError>;
        fn private_bridge(&self)->Result<PrivateBridge,ControllerError>;
        fn confirm_scoped(&self,description:&str)->Result<bool,ControllerError>;
        fn now_ms(&self)->u64;
    }
    #[derive(Clone, Serialize)]
    #[serde(rename_all="camelCase")]
    pub(crate) struct SafeStatus {
        status:&'static str,reason_code:String,logical_batches:u32,requested_event_count:u64,sent_event_count:u64,
        cleanup_requested_count:u64,cleanup_sent_count:u64,possible_effect:bool,
    }
    impl SafeStatus {
        fn unavailable()->Self { Self{status:"unavailable",reason_code:"CONFIGURATION_REQUIRED".into(),logical_batches:0,
            requested_event_count:0,sent_event_count:0,cleanup_requested_count:0,cleanup_sent_count:0,possible_effect:false} }
    }
    #[derive(Deserialize)]
    #[serde(rename_all="camelCase",deny_unknown_fields)]
    struct BootView { backend_boot_ref:String,native_boot_ref:String }
    #[derive(Deserialize)]
    #[serde(rename_all="camelCase",deny_unknown_fields)]
    struct EnrollmentSourceView {
        version:u8,backend_boot_ref:String,native_boot_ref:String,enrollment_source_ref:String,enrollment_challenge_ref:String,
        original_owner_ref:String,original_task_ref:String,attempt_ref:String,operation_ref:String,
        request_scope_digest:String,source_epoch_digest:String,confirmation_description:String,
        issued_at_ms:u64,operation_deadline_ms:u64,expires_at_ms:u64,
    }
    #[derive(Deserialize)]#[serde(rename_all="camelCase",deny_unknown_fields)]
    struct EnrollmentRecheckView {version:u8,backend_boot_ref:String,native_boot_ref:String,enrollment_source_ref:String,enrollment_challenge_ref:String,enrollment_recheck_ref:String,source_epoch_digest:String,expires_at_ms:u64}
    #[derive(Deserialize)]#[serde(rename_all="camelCase",deny_unknown_fields)]
    struct AssociatedView {version:u8,phase:String,binding_ref:String,attempt_ref:String,operation_ref:String,backend_boot_ref:String,native_boot_ref:String,native_session_ref:String,source_epoch_digest:String,expires_at_ms:u64}
    // Only the local scoped MessageBox observation constructs this record.
    // Deserializing the wire views above cannot manufacture it.
    struct NativeOwnerConsent {view:serde_json::Value,approved_at:u64,expires:u64}
    #[derive(Clone,Deserialize,Serialize)]#[serde(rename_all="camelCase",deny_unknown_fields)]
    struct Launch {process_launch_ref:String,pid:u32,canonical_executable_path:String,executable_sha256:String,launch_epoch:String,child_process_alive:bool}
    #[derive(Clone,Deserialize,Serialize)]#[serde(rename_all="camelCase",deny_unknown_fields)]
    struct Inventory {inventory_epoch:String,observed_at_ms:u64,complete:bool,dirty:bool,context_count:u32,page_count:u32,frame_count:u32,target_id:String,frame_id:String,loader_id:String,target_types:Vec<String>}
    #[derive(Clone,Deserialize,Serialize)]#[serde(rename_all="camelCase",deny_unknown_fields)]
    struct CssViewport {width_css:f64,height_css:f64,scroll_x:f64,scroll_y:f64,dpr:f64,visual_scale:f64,visual_offset_x:f64,visual_offset_y:f64}
    #[derive(Clone,Deserialize,Serialize)]#[serde(deny_unknown_fields)]
    struct CssRect {x:f64,y:f64,width:f64,height:f64}
    #[derive(Clone,Deserialize,Serialize)]#[serde(deny_unknown_fields)]
    struct CssPoint {x:f64,y:f64}
    #[derive(Clone,Deserialize,Serialize)]#[serde(rename_all="camelCase",deny_unknown_fields)]
    struct Target {target_ref:String,semantic_digest:String,tag:String,r#type:String,writable:bool,rect_css:CssRect,intended_point_css:CssPoint,
        isolated_hit_target_ref:String,isolated_hit_proof_digest:String,logical_document_ref:String,logical_root_ref:String,logical_ancestry_digest:String,engine_target_identity_digest:String}
    #[derive(Clone,Deserialize,Serialize)]#[serde(rename_all="camelCase",deny_unknown_fields)]
    struct BudgetBatch {batch_ref:String,sequence:u32,kind:String,primary_event_count:u32,cleanup_event_budget:u32,utf16_units:u32}
    #[derive(Clone,Deserialize,Serialize)]#[serde(rename_all="camelCase",deny_unknown_fields)]
    struct Budget {logical_batches:u32,primary_event_count:u32,cleanup_event_budget:u32,utf16_units:u32,record_slots:u32,whole_resolution_limit:u32,batches:Vec<BudgetBatch>}
    #[derive(Clone,Deserialize,Serialize)]#[serde(rename_all="camelCase",deny_unknown_fields)]
    struct BoundSource {version:u8,phase:String,backend_boot_ref:String,native_boot_ref:String,attempt_ref:String,operation_ref:String,binding_ref:String,original_task_ref:String,original_owner_ref:String,
        source_epoch_digest:String,request_scope_digest:String,process_launch_ref:String,original_root_window_ref:String,issued_at_ms:u64,operation_deadline_ms:u64,expires_at_ms:u64,
        launch:Launch,inventory:Inventory,viewport:CssViewport,target:Option<Target>,budget:Budget,snapshot_ref:Option<String>,batch_ref:Option<String>,map_challenge_ref:Option<String>}
    #[derive(Clone,Deserialize)]#[serde(rename_all="camelCase",deny_unknown_fields)]
    struct FocusSource {version:u8,operation_ref:String,binding_ref:String,focus_source_ref:String,source_epoch_digest:String,original_root_window_ref:String,allowed_foreground:String,expires_at_ms:u64}
    #[derive(Deserialize)]#[serde(rename_all="camelCase",deny_unknown_fields)]
    struct FocusAck {version:u8,operation_ref:String,focus_source_ref:String,focus_action_ref:String,outcome:String,possible_effect:bool}
    #[derive(Clone,Deserialize)]#[serde(rename_all="camelCase",deny_unknown_fields)]
    struct MapAck {version:u8,phase:String,binding_ref:String,operation_ref:String,snapshot_ref:String,map_ref:String,map_challenge_ref:String,source_epoch_digest:String,expires_at_ms:u64}
    #[derive(Clone,Deserialize)]#[serde(rename_all="camelCase",deny_unknown_fields)]
    struct PermitAck {version:u8,phase:String,binding_ref:String,operation_ref:String,batch_ref:String,snapshot_ref:String,map_ref:String,permit_ref:String,dispatch_challenge_ref:String,source_epoch_digest:String,expires_at_ms:u64}
    #[derive(Deserialize)]#[serde(rename_all="camelCase",deny_unknown_fields)]
    struct Command {command_ref:String,permit_ref:String,operation_ref:String,action_batch_ref:String,target_ref:String,approved_input_ref:String,expires_at_ms:u64,source_epoch_digest:String}
    #[derive(Deserialize)]#[serde(rename_all="camelCase",deny_unknown_fields)]
    struct ConsumedView {version:u8,phase:String,dispatch_challenge_ref:String,command:Command}
    #[derive(Deserialize)]#[serde(rename_all="camelCase",deny_unknown_fields)]
    struct DispatchAck {version:u8,phase:String,operation_ref:String,permit_ref:String,dispatch_challenge_ref:String,dispatch_ref:String,ledger_ref:String,sequence:u32,safe_status:WireStatus}
    #[derive(Deserialize)]#[serde(rename_all="camelCase",deny_unknown_fields)]
    struct VerifyAck {version:u8,phase:String,operation_ref:String,permit_ref:String,dispatch_ref:String,step_evidence_ref:String,safe_status:WireStatus}
    #[derive(Deserialize)]#[serde(rename_all="camelCase",deny_unknown_fields)]
    struct WireStatus {status:String,reason_code:String,logical_batches:u32,requested_event_count:u64,sent_event_count:u64,cleanup_requested_count:u64,cleanup_sent_count:u64,possible_effect:bool}
    #[derive(Deserialize)]#[serde(tag="phase",rename_all="camelCase",deny_unknown_fields)]
    enum Next {
        #[serde(rename="enrollment",rename_all="camelCase")] Enrollment{version:u8,operation_ref:String,attempt_ref:String},
        #[serde(rename="focus",rename_all="camelCase")] Focus{version:u8,operation_ref:String,binding_ref:String,focus_source_ref:String},
        #[serde(rename="measure",rename_all="camelCase")] Measure{version:u8,operation_ref:String,binding_ref:String,batch_ref:String,snapshot_ref:String,map_challenge_ref:String},
        #[serde(rename="dispatch",rename_all="camelCase")] Dispatch{version:u8,operation_ref:String,batch_ref:String,permit_ref:String},
        #[serde(rename="idle",rename_all="camelCase")] Idle{version:u8,operation_ref:String,reason_code:String},
        #[serde(rename="terminal",rename_all="camelCase")] Terminal{version:u8,operation_ref:String,safe_status:WireStatus},
    }
    impl Budget {
        fn plan(&self)->Result<OperationPlan,ControllerError>{
            if self.logical_batches as usize!=self.batches.len()||self.whole_resolution_limit!=2||self.batches.is_empty()||self.batches.len()>MAX_BATCHES
                ||self.record_slots as usize>MAX_RECORDS||(self.record_slots as usize)<self.batches.len()*2{return Err(ControllerError::InvalidPrivateReply);}
            let mut refs=BTreeSet::new();let mut primary=0u32;let mut cleanup=0u32;let mut units=0u32;let mut batches=Vec::new();
            for (index,batch) in self.batches.iter().enumerate(){
                if !wire(&batch.batch_ref)||!refs.insert(&batch.batch_ref)||batch.sequence as usize!=index+1
                    ||!matches!(batch.kind.as_str(),"replace-field"|"fixed-return"|"click-approved-href"|"scroll-profile-wheel"){return Err(ControllerError::InvalidPrivateReply);}
                primary=primary.checked_add(batch.primary_event_count).ok_or(ControllerError::QuotaExceeded)?;
                cleanup=cleanup.checked_add(batch.cleanup_event_budget).ok_or(ControllerError::QuotaExceeded)?;units=units.checked_add(batch.utf16_units).ok_or(ControllerError::QuotaExceeded)?;
                batches.push(BatchBudget{primary_events:batch.primary_event_count,cleanup_events:batch.cleanup_event_budget,record_slots:2,utf16_units:batch.utf16_units});
            }
            if primary!=self.primary_event_count||cleanup!=self.cleanup_event_budget||units!=self.utf16_units{return Err(ControllerError::InvalidPrivateReply);}
            batches[0].record_slots+=self.record_slots as usize-self.batches.len()*2;
            let plan=OperationPlan{batches};plan.validate().map_err(|_|ControllerError::QuotaExceeded)?;Ok(plan)
        }
    }
    // This is transport data only. It cannot instantiate NativeOwnerConsent,
    // HeldLaunch, NativeMap, focus or dispatch authority.
    struct PendingEnrollment { facts:BrowserLocalFacts,source:EnrollmentSourceView,status:SafeStatus,consent:Option<NativeOwnerConsent>,binding:Option<AssociatedView>,
        in_flight:bool,lost:bool,bound:Option<BoundSource>,permit:Option<PermitAck>,map_view:Option<serde_json::Value>,focus_action:Option<serde_json::Value>,host_snapshot:Option<HostSnapshot>,paired:bool,effects:Option<Arc<EffectFlags>>,
        #[cfg(all(windows,not(test)))] native:Option<Arc<super::native_measurements::NativeSession>>,
        #[cfg(all(windows,not(test)))] native_map:Option<Arc<super::native_measurements::MeasuredMap>>,
        #[cfg(all(windows,not(test)))] observed_document:Option<Arc<super::native_measurements::SuccessorObservation>> }
    #[derive(Deserialize)]
    #[serde(tag="kind",deny_unknown_fields)]
    enum ApprovedInputWire {
        #[serde(rename="replace-field",rename_all="camelCase")]
        Replace{version:u8,command_ref:String,approved_input_ref:String,target_ref:String,text:String,utf16_units:u32,clear_plan:String,expected_primary_event_count:u32,expires_at_ms:u64},
        #[serde(rename="fixed-return",rename_all="camelCase")]
        Return{version:u8,command_ref:String,approved_input_ref:String,target_ref:String,search_submit_admission_ref:String,causal_successor_ref:String,expected_primary_event_count:u32,expires_at_ms:u64},
        #[serde(rename="click-approved-href",rename_all="camelCase")]
        Href{version:u8,command_ref:String,approved_input_ref:String,target_ref:String,causal_successor_ref:String,expected_primary_event_count:u32,expires_at_ms:u64},
        #[serde(rename="scroll-profile-wheel",rename_all="camelCase")]
        Wheel{version:u8,command_ref:String,approved_input_ref:String,surface_ref:String,direction:String,wheel_delta:i32,expected_primary_event_count:u32,expires_at_ms:u64},
    }
    fn pair(key:OwnedKey)->Vec<InputEvent>{vec![InputEvent{key,up:false},InputEvent{key,up:true}]}
    // Exact original private input may produce an event plan, never a permit or
    // measured ledger. The backend command/source/map/arm joins remain separate.
    fn plan_input(input:ApprovedInputWire,command:&str,approved:&str,now:u64)->Result<(Vec<Vec<InputEvent>>,u32),ControllerError>{
        let invalid=||ControllerError::InvalidPrivateReply;
        let common=|version:u8,c:&str,a:&str,target:&str,expires:u64|->Result<(),ControllerError>{
            if version!=1||c!=command||a!=approved||!wire(c)||!wire(a)||!wire(target)||expires<=now||expires>MAX_SAFE{return Err(invalid());}Ok(())};
        match input {
            ApprovedInputWire::Replace{version,command_ref,approved_input_ref,target_ref,text,utf16_units,clear_plan,expected_primary_event_count,expires_at_ms}=>{
                common(version,&command_ref,&approved_input_ref,&target_ref,expires_at_ms)?;
                if text.chars().any(char::is_control)||text.encode_utf16().count()!=utf16_units as usize||utf16_units>MAX_UTF16
                    ||!matches!(clear_plan.as_str(),"none"|"ctrl-a-backspace"){return Err(invalid());}
                let mut chunks=vec![pair(OwnedKey::LeftButton)];
                if clear_plan=="ctrl-a-backspace"{chunks.push(vec![InputEvent{key:OwnedKey::Virtual(0x11),up:false},InputEvent{key:OwnedKey::Virtual(0x41),up:false},
                    InputEvent{key:OwnedKey::Virtual(0x41),up:true},InputEvent{key:OwnedKey::Virtual(0x11),up:true},InputEvent{key:OwnedKey::Virtual(0x08),up:false},InputEvent{key:OwnedKey::Virtual(0x08),up:true}]);}
                chunks.extend(text.encode_utf16().map(|unit|pair(OwnedKey::Unicode(unit))));
                let actual:usize=chunks.iter().map(Vec::len).sum();if actual!=expected_primary_event_count as usize||actual>MAX_EVENTS as usize{return Err(invalid());}
                Ok((chunks,utf16_units))
            }
            ApprovedInputWire::Return{version,command_ref,approved_input_ref,target_ref,search_submit_admission_ref,causal_successor_ref,expected_primary_event_count,expires_at_ms}=>{
                common(version,&command_ref,&approved_input_ref,&target_ref,expires_at_ms)?;
                if expected_primary_event_count!=2||!wire(&search_submit_admission_ref)||!wire(&causal_successor_ref){return Err(invalid());}Ok((vec![pair(OwnedKey::Virtual(0x0D))],0))
            }
            ApprovedInputWire::Href{version,command_ref,approved_input_ref,target_ref,causal_successor_ref,expected_primary_event_count,expires_at_ms}=>{
                common(version,&command_ref,&approved_input_ref,&target_ref,expires_at_ms)?;
                if expected_primary_event_count!=2||!wire(&causal_successor_ref){return Err(invalid());}Ok((vec![pair(OwnedKey::LeftButton)],0))
            }
            ApprovedInputWire::Wheel{version,command_ref,approved_input_ref,surface_ref,direction,wheel_delta,expected_primary_event_count,expires_at_ms}=>{
                common(version,&command_ref,&approved_input_ref,&surface_ref,expires_at_ms)?;
                if expected_primary_event_count!=1||!matches!((direction.as_str(),wheel_delta),("up",120)|("down",-120)){return Err(invalid());}
                Ok((vec![vec![InputEvent{key:OwnedKey::Wheel(wheel_delta),up:false}]],0))
            }
        }
    }
    #[derive(Default)]
    struct State { boot_epoch:u64,boot_attempted:bool,boot:Option<BootView>,attempts:HashMap<String,PendingEnrollment> }
    pub(crate) struct Controller { foundation:Arc<Foundation>,state:Mutex<State>,history:Mutex<Vec<(u64,String,NativeDispatchRecord)>>,focus_history:Mutex<HashMap<(u64,String),serde_json::Value>>,history_slots:AtomicU64 }
    impl Controller {
        pub(crate) fn new(foundation:Arc<Foundation>)->Self { Self{foundation,state:Mutex::new(State::default()),history:Mutex::new(Vec::new()),focus_history:Mutex::new(HashMap::new()),history_slots:AtomicU64::new(0)} }
        pub(crate) fn register_boot(&self,host:&dyn BrowserHost)->Result<(),ControllerError>{
            host.check_managed()?;let bridge=host.private_bridge()?;
            let boot_epoch=self.foundation.boot_epoch();let scope_epoch=self.foundation.scope_epoch();
            let guard=||->Result<(),ControllerError>{host.check_managed()?;
                if !self.foundation.enabled.load(Ordering::SeqCst)||boot_epoch==0||boot_epoch!=self.foundation.boot_epoch()
                    ||scope_epoch!=self.foundation.scope_epoch()||host.private_bridge()?!=bridge{return Err(ControllerError::LocalScopeChanged);}host.check_managed()};
            guard()?;
            {let mut state=self.state.lock().map_err(|_|ControllerError::LocalScopeChanged)?;
                if state.boot_epoch!=boot_epoch{*state=State{boot_epoch,..State::default()};}
                if state.boot.is_some(){return Ok(());}if state.boot_attempted{return Err(ControllerError::TransportUnavailable);}state.boot_attempted=true;}
            let nonce={let registry=self.foundation.registry.lock().map_err(|_|ControllerError::LocalScopeChanged)?;
                registry.nonce.ok_or(ControllerError::LocalScopeChanged)?.iter().map(|byte|format!("{byte:02x}")).collect::<String>()};
            let deadline=host.now_ms().checked_add(1000).ok_or(ControllerError::LocalScopeChanged)?;
            let boot:BootView=self.request(&bridge,"/boot",serde_json::json!({"version":1,"nativeBootNonce":nonce}),deadline,host,&guard)?;
            if !wire(&boot.backend_boot_ref)||!wire(&boot.native_boot_ref){return Err(ControllerError::InvalidPrivateReply);}guard()?;
            let mut state=self.state.lock().map_err(|_|ControllerError::LocalScopeChanged)?;
            if state.boot_epoch!=boot_epoch{return Err(ControllerError::LocalScopeChanged);}state.boot=Some(boot);Ok(())
        }
        fn guard(&self,host:&dyn BrowserHost,facts:&BrowserLocalFacts,bridge:&PrivateBridge,operation:Option<&str>)->Result<(),ControllerError> {
            host.check_managed()?;
            if !self.foundation.enabled.load(Ordering::SeqCst) || facts.stopped || host.now_ms()>=facts.deadline()
                || facts.boot_epoch!=self.foundation.boot_epoch() || facts.scope_epoch!=self.foundation.scope_epoch()
                || host.local_facts(&facts.session_id,operation)?!=*facts || host.private_bridge()?!=*bridge { return Err(ControllerError::LocalScopeChanged); }
            host.check_managed()?;
            Ok(())
        }
        fn post<T:serde::de::DeserializeOwned>(&self,host:&dyn BrowserHost,facts:&BrowserLocalFacts,bridge:&PrivateBridge,
            path:&str,body:serde_json::Value,deadline:u64)->Result<T,ControllerError> {
            self.request(bridge,path,body,deadline.min(facts.deadline()),host,&||self.guard(host,facts,bridge,None))
        }
        fn request<T:serde::de::DeserializeOwned>(&self,bridge:&PrivateBridge,path:&str,body:serde_json::Value,deadline:u64,
            host:&dyn BrowserHost,guard:&dyn Fn()->Result<(),ControllerError>)->Result<T,ControllerError>{
            // No caller-controlled URL/path/headers. No redirect, proxy or retry.
            if !matches!(path,"/boot"|"/source"|"/associate"|"/driver/next"|"/focus/source"|"/focus/record"|"/map"|"/check"|"/consume"|"/input/arm"|"/input"|"/dispatch"|"/verify"|"/cancel") { return Err(ControllerError::InternalSourceContractPending); }
            guard()?;
            let remaining=deadline.checked_sub(host.now_ms()).filter(|v|*v>0).ok_or(ControllerError::LocalScopeChanged)?;
            let client=reqwest::blocking::Client::builder().no_proxy().redirect(reqwest::redirect::Policy::none())
                .timeout(Duration::from_millis(remaining.min(1000))).build().map_err(|_|ControllerError::TransportUnavailable)?;
            guard()?;
            let response=client.post(format!("http://127.0.0.1:{}/api/edith/computer/native-browser{path}",bridge.port))
                .bearer_auth(&bridge.token).json(&body).send().map_err(|_|ControllerError::TransportUnavailable)?;
            guard()?;
            if response.status()!=reqwest::StatusCode::OK || response.content_length().is_some_and(|n|n>65536)
                ||response.headers().get(reqwest::header::CONTENT_TYPE).and_then(|v|v.to_str().ok()).and_then(|v|v.split(';').next()).map(str::trim)!=Some("application/json") { return Err(ControllerError::InvalidPrivateReply); }
            let mut bytes=Vec::new();response.take(65537).read_to_end(&mut bytes).map_err(|_|ControllerError::TransportUnavailable)?;
            guard()?;
            if bytes.len()>65536 { return Err(ControllerError::InvalidPrivateReply); }
            let mut envelope:serde_json::Value=serde_json::from_slice(&bytes).map_err(|_|ControllerError::InvalidPrivateReply)?;
            let object=envelope.as_object_mut().ok_or(ControllerError::InvalidPrivateReply)?;
            if object.len()!=2||object.get("success")!=Some(&serde_json::Value::Bool(true))||!object.contains_key("result"){return Err(ControllerError::InvalidPrivateReply);}
            serde_json::from_value(object.remove("result").ok_or(ControllerError::InvalidPrivateReply)?).map_err(|_|ControllerError::InvalidPrivateReply)
        }
        pub(crate) fn resolve(&self,host:&dyn BrowserHost,attempt_wire_ref:&str,local_session_ref:&str)->Result<SafeStatus,ControllerError> {
            if !wire(attempt_wire_ref) || local_session_ref.is_empty() || local_session_ref.len()>160 { return Err(ControllerError::InvalidLookup); }
            let facts=host.local_facts(local_session_ref,None)?;let bridge=host.private_bridge()?;
            self.guard(host,&facts,&bridge,None)?;
            self.register_boot(host)?;
            let boot_known={
                let mut state=self.state.lock().map_err(|_|ControllerError::LocalScopeChanged)?;
                if state.boot_epoch!=facts.boot_epoch { *state=State{boot_epoch:facts.boot_epoch,..State::default()}; }
                if let Some(previous)=state.attempts.get(attempt_wire_ref) {
                    if previous.facts!=facts { return Err(ControllerError::LocalScopeChanged); }
                    return Ok(previous.status.clone());
                }
                if state.attempts.len()>=MAX_OPERATIONS { return Err(ControllerError::QuotaExceeded); }
                state.boot.is_some()
            };
            if !boot_known{return Err(ControllerError::TransportUnavailable);}
            let source:EnrollmentSourceView=self.post(host,&facts,&bridge,"/source",serde_json::json!({"version":1,"phase":"enrollment","attemptRef":attempt_wire_ref}),facts.deadline())?;
            let now=host.now_ms();
            let refs=[&source.backend_boot_ref,&source.native_boot_ref,&source.enrollment_source_ref,&source.enrollment_challenge_ref,
                &source.original_owner_ref,&source.attempt_ref,&source.operation_ref];
            if source.version!=1 || refs.iter().any(|r|!wire(r)) || !retained_identifier(&source.original_task_ref) || !digest(&source.request_scope_digest)||!digest(&source.source_epoch_digest)
                || source.confirmation_description.is_empty() || source.confirmation_description.len()>4096 || source.confirmation_description.chars().any(|c|c=='\0')
                || source.issued_at_ms>now || source.expires_at_ms<=now || source.expires_at_ms>source.operation_deadline_ms
                || source.operation_deadline_ms>source.issued_at_ms.checked_add(OPERATION_MS).ok_or(ControllerError::InvalidPrivateReply)?
                || source.operation_deadline_ms>MAX_SAFE { return Err(ControllerError::InvalidPrivateReply); }
            self.guard(host,&facts,&bridge,None)?;
            {let state=self.state.lock().map_err(|_|ControllerError::LocalScopeChanged)?;
                let boot=state.boot.as_ref().ok_or(ControllerError::LocalScopeChanged)?;
                if boot.backend_boot_ref!=source.backend_boot_ref||boot.native_boot_ref!=source.native_boot_ref { return Err(ControllerError::LocalScopeChanged); }
                if state.attempts.contains_key(attempt_wire_ref)||state.attempts.len()>=MAX_OPERATIONS{return Err(ControllerError::QuotaExceeded);}}
            if facts.reservation_id.as_deref()!=Some(&source.original_task_ref)||facts.reservation_expires_at_ms.is_none(){return Err(ControllerError::LocalScopeChanged);}
            if facts.scope_epoch>MAX_SAFE{return Err(ControllerError::LocalScopeChanged);}
            let native_session=nonce()?;let consent_ref=nonce()?;let confirmation_ref=nonce()?;let reservation_ref=nonce()?;
            let task=source.original_task_ref.clone();let operation=source.operation_ref.clone();
            {let mut state=self.state.lock().map_err(|_|ControllerError::LocalScopeChanged)?;
                // Tombstone BEFORE dialog: repeated/lost resolve never repeats it.
                if state.attempts.values().any(|old|old.facts.session_id==facts.session_id&&old.facts.reservation_incarnation==facts.reservation_incarnation){return Err(ControllerError::LocalScopeChanged);}
                state.attempts.insert(attempt_wire_ref.to_owned(),PendingEnrollment{facts:facts.clone(),source,status:SafeStatus::unavailable(),consent:None,binding:None,in_flight:true,lost:false,bound:None,permit:None,map_view:None,focus_action:None,host_snapshot:None,paired:false,effects:None,
                    #[cfg(all(windows,not(test)))] native:None,#[cfg(all(windows,not(test)))] native_map:None,#[cfg(all(windows,not(test)))] observed_document:None});}
            self.guard(host,&facts,&bridge,Some(&task))?;
            // No registry/session/reservation mutex or HTTP is held through the
            // scoped native dialog. Parent owns its exact managed owner HWND.
            let description={let state=self.state.lock().map_err(|_|ControllerError::LocalScopeChanged)?;state.attempts[attempt_wire_ref].source.confirmation_description.clone()};
            if !host.confirm_scoped(&description)?{return Ok(self.set_status(&operation,"denied",false)?);}
            self.guard(host,&facts,&bridge,Some(&task))?;
            let approved_at=host.now_ms();
            let (source_ref,challenge,source_epoch,request_digest,owner,attempt,backend_boot,native_boot,source_deadline)={
                let state=self.state.lock().map_err(|_|ControllerError::LocalScopeChanged)?;let s=&state.attempts[attempt_wire_ref].source;
                if approved_at>=s.expires_at_ms{return Err(ControllerError::LocalScopeChanged);}
                (s.enrollment_source_ref.clone(),s.enrollment_challenge_ref.clone(),s.source_epoch_digest.clone(),s.request_scope_digest.clone(),s.original_owner_ref.clone(),s.attempt_ref.clone(),s.backend_boot_ref.clone(),s.native_boot_ref.clone(),s.operation_deadline_ms)};
            let recheck:EnrollmentRecheckView=self.post(host,&facts,&bridge,"/source",serde_json::json!({"version":1,"phase":"enrollment_recheck","enrollmentSourceRef":source_ref,"enrollmentChallengeRef":challenge}),source_deadline)?;
            if recheck.version!=1||recheck.backend_boot_ref!=backend_boot||recheck.native_boot_ref!=native_boot||recheck.enrollment_source_ref!=source_ref
                ||recheck.enrollment_challenge_ref!=challenge||recheck.source_epoch_digest!=source_epoch||!wire(&recheck.enrollment_recheck_ref)
                ||recheck.expires_at_ms<=host.now_ms()||recheck.expires_at_ms>source_deadline{return Err(ControllerError::InvalidPrivateReply);}
            self.guard(host,&facts,&bridge,Some(&task))?;
            let expires=facts.deadline().min(source_deadline).min(approved_at.checked_add(OPERATION_MS).ok_or(ControllerError::LocalScopeChanged)?);
            let consent=NativeOwnerConsent{view:serde_json::json!({"version":1,"backendBootRef":backend_boot,"nativeBootRef":native_boot,
                "enrollmentSourceRef":source_ref,"enrollmentChallengeRef":challenge,"enrollmentRecheckRef":recheck.enrollment_recheck_ref,
                "consentRef":consent_ref,"nativeSessionRef":native_session,"originalOwnerRef":owner,"originalTaskRef":task,"attemptRef":attempt,"operationRef":operation,
                "requestScopeDigest":request_digest,"sourceEpochDigest":source_epoch,"computerSessionGeneration":facts.session_generation,
                "localSessionExpiresAtMs":facts.session_expires_at_ms,"reservationRef":reservation_ref,"reservationGeneration":facts.reservation_incarnation,
                "reservationExpiresAtMs":facts.reservation_expires_at_ms,"nativeStopEpoch":facts.scope_epoch,"confirmationRef":confirmation_ref,
                "confirmationMethod":"win32-scoped-messagebox-yes","approvedAtMs":approved_at,"expiresAtMs":expires}),approved_at,expires};
            let association:AssociatedView=self.post(host,&facts,&bridge,"/associate",serde_json::json!({"version":1,"attemptRef":attempt,"nativeSessionRef":native_session,
                "enrollmentSourceRef":source_ref,"enrollmentChallengeRef":challenge,"enrollmentRecheckRef":recheck.enrollment_recheck_ref,"consentView":consent.view}),expires.min(recheck.expires_at_ms))?;
            if association.version!=1||association.phase!="associated"||!wire(&association.binding_ref)||association.attempt_ref!=attempt||association.operation_ref!=operation
                ||association.backend_boot_ref!=backend_boot||association.native_boot_ref!=native_boot||association.native_session_ref!=native_session
                ||association.source_epoch_digest!=source_epoch||association.expires_at_ms<=host.now_ms()||association.expires_at_ms>expires{return Err(ControllerError::InvalidPrivateReply);}
            self.guard(host,&facts,&bridge,Some(&task))?;
            {let mut state=self.state.lock().map_err(|_|ControllerError::LocalScopeChanged)?;let row=state.attempts.get_mut(attempt_wire_ref).ok_or(ControllerError::LocalScopeChanged)?;
                row.consent=Some(consent);row.binding=Some(association);}
            // The association is genuine but is not a map/permit. Dispatch owns
            // the next issuer-selected phase; no renderer input facts are used.
            self.prepare_owned(host,&operation)
        }
        pub(crate) fn dispatch(&self,host:&dyn BrowserHost,operation_wire_ref:&str)->Result<SafeStatus,ControllerError> {
            if !wire(operation_wire_ref){return Err(ControllerError::InvalidLookup);}
            {let mut state=self.state.lock().map_err(|_|ControllerError::LocalScopeChanged)?;
                let row=state.attempts.values_mut().find(|r|r.source.operation_ref==operation_wire_ref).ok_or(ControllerError::InvalidLookup)?;
                if row.in_flight||row.lost||row.status.status!="ready"{return Ok(row.status.clone());}row.in_flight=true;row.status.status="unavailable";}
            let result=self.dispatch_owned(host,operation_wire_ref);
            if result.is_err(){self.fail_owned(operation_wire_ref);
                if let Some(status)=self.historical_status(operation_wire_ref){return Ok(status);}
                if let Ok(state)=self.state.lock(){if let Some(row)=state.attempts.values().find(|r|r.source.operation_ref==operation_wire_ref&&r.status.possible_effect){return Ok(row.status.clone());}}
            }
            result
        }
        pub(crate) fn read_status(&self,host:&dyn BrowserHost,operation_wire_ref:&str)->Result<SafeStatus,ControllerError> {
            if !wire(operation_wire_ref) { return Err(ControllerError::InvalidLookup); }
            host.check_managed()?;
            let (facts,mut status,deadline,task)={let state=self.state.lock().map_err(|_|ControllerError::LocalScopeChanged)?;
                let Some(row)=state.attempts.values().find(|row|row.source.operation_ref==operation_wire_ref)else{return self.historical_status(operation_wire_ref).ok_or(ControllerError::InvalidLookup);};
                let mut status=row.status.clone();status.possible_effect|=row.effects.as_ref().is_some_and(|e|e.possible.load(Ordering::SeqCst));
                if row.in_flight&&status.status=="ready"{status.status="unavailable";}
                (row.facts.clone(),status,row.source.operation_deadline_ms,row.source.original_task_ref.clone())};
            let bridge=host.private_bridge()?;
            if self.guard(host,&facts,&bridge,Some(&task)).is_err()||host.now_ms()>=deadline{
                if let Some(history)=self.historical_status(operation_wire_ref){return Ok(history);}
                if status.possible_effect{status.status="unknown";status.reason_code="NATIVE_SCOPE_STALE".into();return Ok(status);}return Err(ControllerError::LocalScopeChanged);
            }
            // A readonly backend reader can observe later canonical settlement
            // of our already paired dispatch. It never prepares a phase, map,
            // permit or another input batch.
            let paired={let state=self.state.lock().map_err(|_|ControllerError::LocalScopeChanged)?;
                state.attempts.values().find(|r|r.source.operation_ref==operation_wire_ref).is_some_and(|r|r.paired&&!r.in_flight&&!r.lost)};
            if paired||status.status=="complete"{
                if let Err(error)=self.validate_observed(host,operation_wire_ref){self.fail_owned(operation_wire_ref);return self.historical_status(operation_wire_ref).ok_or(error);}
            }
            if paired&&status.status!="complete"{
                let next:Next=match self.request(&bridge,"/driver/next",serde_json::json!({"version":1,"operationRef":operation_wire_ref}),deadline,host,&||{self.guard(host,&facts,&bridge,Some(&task))?;self.validate_observed(host,operation_wire_ref)}){
                    Ok(value)=>value,Err(error)=>return self.historical_status(operation_wire_ref).ok_or(error)};
                if let Next::Terminal{version,operation_ref,safe_status}=next{
                    if version!=1||operation_ref!=operation_wire_ref{return Err(ControllerError::InvalidPrivateReply);}return self.accept_status(host,operation_wire_ref,safe_status,true);
                }
            }
            if status.status=="ready"{
                #[cfg(all(windows,not(test)))] {
                    let (native,map,expires)={let state=self.state.lock().map_err(|_|ControllerError::LocalScopeChanged)?;
                        let row=state.attempts.values().find(|r|r.source.operation_ref==operation_wire_ref).ok_or(ControllerError::InvalidLookup)?;
                        (row.native.clone(),row.native_map.clone(),row.permit.as_ref().map(|p|p.expires_at_ms).unwrap_or(0))};
                    if host.now_ms()>=expires||native.zip(map).is_none_or(|(n,m)|n.validate_map(&m,false,&||self.guard(host,&facts,&bridge,Some(&task))).is_err()){
                        status.status=if status.possible_effect{"partial"}else{"denied"};status.reason_code="NATIVE_SCOPE_STALE".into();
                    }
                }
                #[cfg(not(all(windows,not(test))))]{status.status="unavailable";status.reason_code="CONFIGURATION_REQUIRED".into();}
            }
            Ok(status)
        }
        fn historical_status(&self,operation:&str)->Option<SafeStatus>{
            let history=self.history.lock().unwrap_or_else(|poisoned|poisoned.into_inner());
            let mut result=SafeStatus::unavailable();result.status="unknown";result.reason_code="NATIVE_SCOPE_STALE".into();
            for (_,key,record) in history.iter().filter(|(_,key,_)|key==operation){
                let _=key;let counts=summarize(record);result.logical_batches+=1;result.requested_event_count+=counts.requested;result.sent_event_count+=counts.sent;
                result.cleanup_requested_count+=counts.cleanup_requested;result.cleanup_sent_count+=counts.cleanup_sent;result.possible_effect|=counts.possible;
            }
            drop(history);
            let focus=self.focus_history.lock().unwrap_or_else(|poisoned|poisoned.into_inner());
            let focus_effect=focus.iter().any(|((_,key),record)|key==operation&&record["possibleEffect"]==true);
            result.possible_effect|=focus_effect;(result.logical_batches>0||focus_effect).then_some(result)
        }
        fn set_status(&self,operation:&str,status:&'static str,possible:bool)->Result<SafeStatus,ControllerError>{
            let mut state=self.state.lock().map_err(|_|ControllerError::LocalScopeChanged)?;
            let row=state.attempts.values_mut().find(|row|row.source.operation_ref==operation).ok_or(ControllerError::InvalidLookup)?;
            row.status.status=status;row.status.possible_effect|=possible;Ok(row.status.clone())
        }
        fn fail_owned(&self,operation:&str){
            if let Ok(mut state)=self.state.lock(){if let Some(row)=state.attempts.values_mut().find(|r|r.source.operation_ref==operation){
                row.lost=true;row.in_flight=false;row.status.possible_effect|=row.effects.as_ref().is_some_and(|e|e.possible.load(Ordering::SeqCst));row.status.status=if row.status.possible_effect{"unknown"}else{"denied"};
                #[cfg(all(windows,not(test)))] if row.native.as_ref().is_some_and(|n|n.possible_focus()){row.status.possible_effect=true;row.status.status="unknown";}
            }}
            if let Ok(mut registry)=self.foundation.registry.try_lock(){if let Some(row)=registry.operations.get_mut(operation){row.revoked=true;row.pending=None;}}
        }
        fn host_snapshot(&self,facts:&BrowserLocalFacts,operation:&str,expires:u64)->Result<HostSnapshot,ControllerError>{
            HostSnapshot::new(facts.boot_epoch,facts.scope_epoch,facts.session_generation,facts.reservation_incarnation,
                facts.session_id.clone(),operation.to_owned(),expires.min(facts.deadline()),facts.stopped).map_err(|_|ControllerError::LocalScopeChanged)
        }
        fn context(&self,operation:&str)->Result<(BrowserLocalFacts,String,String,u64),ControllerError>{
            let state=self.state.lock().map_err(|_|ControllerError::LocalScopeChanged)?;
            let row=state.attempts.values().find(|r|r.source.operation_ref==operation).ok_or(ControllerError::InvalidLookup)?;
            let binding=row.binding.as_ref().ok_or(ControllerError::LocalScopeChanged)?;
            let consent=row.consent.as_ref().ok_or(ControllerError::LocalScopeChanged)?;
            if row.lost{return Err(ControllerError::LocalScopeChanged);}
            Ok((row.facts.clone(),row.source.original_task_ref.clone(),binding.binding_ref.clone(),consent.expires.min(row.source.operation_deadline_ms)))
        }
        fn bound_source(&self,host:&dyn BrowserHost,operation:&str)->Result<BoundSource,ControllerError>{
            let (facts,task,binding,deadline)=self.context(operation)?;let bridge=host.private_bridge()?;
            let source:BoundSource=self.request(&bridge,"/source",serde_json::json!({"bindingRef":binding}),deadline,host,&||self.guard(host,&facts,&bridge,Some(&task)))?;
            let now=host.now_ms();let state=self.state.lock().map_err(|_|ControllerError::LocalScopeChanged)?;
            let row=state.attempts.values().find(|r|r.source.operation_ref==operation).ok_or(ControllerError::InvalidLookup)?;
            let original=&row.source;
            let aliases=[&source.backend_boot_ref,&source.native_boot_ref,&source.attempt_ref,&source.operation_ref,&source.binding_ref,&source.original_owner_ref,&source.process_launch_ref,&source.original_root_window_ref,&source.launch.launch_epoch,&source.inventory.inventory_epoch];
            if source.version!=1||source.phase!="bound-source"||aliases.iter().any(|s|!wire(s))||source.operation_ref!=operation||source.binding_ref!=binding
                ||source.original_task_ref!=task||source.original_owner_ref!=original.original_owner_ref||source.attempt_ref!=original.attempt_ref
                ||source.backend_boot_ref!=original.backend_boot_ref||source.native_boot_ref!=original.native_boot_ref||source.source_epoch_digest!=original.source_epoch_digest
                ||source.request_scope_digest!=original.request_scope_digest||source.operation_deadline_ms!=original.operation_deadline_ms
                ||source.issued_at_ms<original.issued_at_ms||!bounded_native_source_ttl(source.issued_at_ms,source.expires_at_ms,now,deadline)
                ||source.launch.pid==0||!source.launch.child_process_alive
                ||source.launch.process_launch_ref!=source.process_launch_ref||!digest(&source.launch.executable_sha256)||source.launch.canonical_executable_path.is_empty()
                ||!source.inventory.complete||source.inventory.dirty||source.inventory.context_count!=1||source.inventory.page_count!=1||source.inventory.frame_count!=1
                ||source.inventory.observed_at_ms>now||source.inventory.observed_at_ms>MAX_SAFE||source.inventory.target_id.is_empty()||source.inventory.frame_id.is_empty()||source.inventory.loader_id.is_empty()
                ||source.inventory.target_types.iter().filter(|s|s.as_str()=="page").count()!=1||source.inventory.target_types.iter().any(|s|!matches!(s.as_str(),"browser"|"page"))
                ||source.viewport.dpr!=1.0||source.viewport.visual_scale!=1.0||source.viewport.visual_offset_x!=0.0||source.viewport.visual_offset_y!=0.0
                ||[source.viewport.width_css,source.viewport.height_css].iter().any(|n|!n.is_finite()||*n<=0.0||*n>32767.0||n.fract()!=0.0)
                ||[source.viewport.scroll_x,source.viewport.scroll_y].iter().any(|n|!n.is_finite()) {return Err(ControllerError::InvalidPrivateReply);}
            source.budget.plan()?;
            match (&source.target,&source.snapshot_ref,&source.batch_ref,&source.map_challenge_ref){
                (None,None,None,None)=>{},
                (Some(target),Some(snapshot),Some(batch),Some(challenge))=>{
                    let refs=[&target.target_ref,&target.isolated_hit_target_ref,&target.logical_document_ref,&target.logical_root_ref,snapshot,batch,challenge];
                    if refs.iter().any(|s|!wire(s))||[&target.semantic_digest,&target.isolated_hit_proof_digest,&target.logical_ancestry_digest,&target.engine_target_identity_digest].iter().any(|s|!digest(s))
                        ||!source.budget.batches.iter().any(|b|&b.batch_ref==batch)||[target.rect_css.x,target.rect_css.y,target.rect_css.width,target.rect_css.height,target.intended_point_css.x,target.intended_point_css.y].iter().any(|n|!n.is_finite()) {return Err(ControllerError::InvalidPrivateReply);}
                },_=>return Err(ControllerError::InvalidPrivateReply)
            }
            Ok(source)
        }
        fn same_source(a:&BoundSource,b:&BoundSource)->bool{
            // Source aliases belong to the engine. This comparison never turns
            // engine document aliases or digests into native UIA identities.
            a.source_epoch_digest==b.source_epoch_digest&&a.process_launch_ref==b.process_launch_ref&&a.original_root_window_ref==b.original_root_window_ref
                &&serde_json::to_value(&a.launch).ok()==serde_json::to_value(&b.launch).ok()
                &&serde_json::to_value(&a.inventory).ok()==serde_json::to_value(&b.inventory).ok()
                &&serde_json::to_value(&a.viewport).ok()==serde_json::to_value(&b.viewport).ok()
                &&serde_json::to_value(&a.budget).ok()==serde_json::to_value(&b.budget).ok()
                &&a.snapshot_ref==b.snapshot_ref&&a.batch_ref==b.batch_ref&&a.map_challenge_ref==b.map_challenge_ref
                &&serde_json::to_value(&a.target).ok()==serde_json::to_value(&b.target).ok()
        }
        #[cfg(not(all(windows,not(test))))]
        fn prepare_owned(&self,_host:&dyn BrowserHost,operation:&str)->Result<SafeStatus,ControllerError>{self.fail_owned(operation);Err(ControllerError::NativeMeasurementUnavailable)}
        #[cfg(not(all(windows,not(test))))]
        fn dispatch_owned(&self,_host:&dyn BrowserHost,_operation:&str)->Result<SafeStatus,ControllerError>{Err(ControllerError::NativeMeasurementUnavailable)}
        #[cfg(all(windows,not(test)))]
        fn prepare_owned(&self,host:&dyn BrowserHost,operation:&str)->Result<SafeStatus,ControllerError>{
            let result=self.prepare_windows(host,operation);
            if result.is_err(){self.fail_owned(operation);
                if let Some(status)=self.historical_status(operation){return Ok(status);}
                if let Ok(state)=self.state.lock(){if let Some(row)=state.attempts.values().find(|r|r.source.operation_ref==operation&&r.status.possible_effect){return Ok(row.status.clone());}}
            }result
        }
        #[cfg(all(windows,not(test)))]
        fn prepare_windows(&self,host:&dyn BrowserHost,operation:&str)->Result<SafeStatus,ControllerError>{
            use super::native_measurements::NativeSession;
            let (facts,task,binding,deadline)=self.context(operation)?;let bridge=host.private_bridge()?;
            let guard=||self.guard(host,&facts,&bridge,Some(&task));guard()?;
            // Bounded non-input preparation only. No status reader calls this.
            for _ in 0..3 {
                let next:Next=self.request(&bridge,"/driver/next",serde_json::json!({"version":1,"operationRef":operation}),deadline,host,&guard)?;
                match next {
                    Next::Focus{version,operation_ref,binding_ref,focus_source_ref}=>{
                        if version!=1||operation_ref!=operation||binding_ref!=binding||!wire(&focus_source_ref){return Err(ControllerError::InvalidPrivateReply);}
                        let source=self.bound_source(host,operation)?;
                        if source.target.is_some(){return Err(ControllerError::InvalidPrivateReply);}
                        // FocusSource has no issuedAtMs field. Retain our
                        // pre-request timestamp; reception cannot renew its
                        // one-second window or the accepted source deadline.
                        let focus_requested_at=host.now_ms();
                        let focus:FocusSource=self.request(&bridge,"/focus/source",serde_json::json!({"version":1,"operationRef":operation,"bindingRef":binding}),deadline.min(source.expires_at_ms),host,&guard)?;
                        if focus.version!=1||focus.operation_ref!=operation||focus.binding_ref!=binding||focus.focus_source_ref!=focus_source_ref
                            ||focus.source_epoch_digest!=source.source_epoch_digest||focus.original_root_window_ref!=source.original_root_window_ref
                            ||focus.allowed_foreground!="managed-edith-or-original-chrome"
                            ||!bounded_native_source_ttl(focus_requested_at,focus.expires_at_ms,host.now_ms(),deadline.min(source.expires_at_ms)){return Err(ControllerError::InvalidPrivateReply);}
                        let snapshot=self.host_snapshot(&facts,operation,deadline)?;
                        // Retain measured history across concurrent boot resets.
                        // This additional lifetime cap never evicts consumed
                        // measurements to make room for another operation.
                        self.history_slots.fetch_update(Ordering::SeqCst,Ordering::SeqCst,|slots|slots.checked_add(source.budget.record_slots as u64).filter(|n|*n<=MAX_BOOT_SLOTS as u64)).map_err(|_|ControllerError::QuotaExceeded)?;
                        self.foundation.reserve_operation(snapshot.clone(),source.budget.plan()?,host.now_ms()).map_err(|_|ControllerError::QuotaExceeded)?;
                        let reread=||{let fresh=self.bound_source(host,operation)?;if !Self::same_source(&source,&fresh){return Err(ControllerError::LocalScopeChanged);}Ok(())};
                        let native=Arc::new(NativeSession::capture(source.launch.pid,source.launch.canonical_executable_path.clone(),source.launch.executable_sha256.clone(),
                            source.viewport.width_css as u32,source.viewport.height_css as u32,source.viewport.dpr,source.viewport.visual_scale,focus.expires_at_ms.min(source.expires_at_ms),&guard,&reread)?);
                        // Retain kernel/process/window facts before any possible
                        // focus effect. No COM object crosses the registry.
                        {let mut state=self.state.lock().map_err(|_|ControllerError::LocalScopeChanged)?;let row=state.attempts.values_mut().find(|r|r.source.operation_ref==operation).ok_or(ControllerError::InvalidLookup)?;
                            row.native=Some(native.clone());row.host_snapshot=Some(snapshot);row.bound=Some(source.clone());}
                        reread()?;guard()?;
                        let managed=host.managed_root()?;
                        let action_ref=nonce()?;
                        let action={let _dispatch=host.dispatch_lock()?;native.focus(managed,&guard,&||host.now_ms())};
                        // The private focus primitive retains possibleEffect
                        // before its syscall, including a lost caller return.
                        let mut action=action?;
                        self.focus_history.lock().unwrap_or_else(|poisoned|poisoned.into_inner()).insert((facts.boot_epoch,operation.to_owned()),action.clone());
                        let consent={let state=self.state.lock().map_err(|_|ControllerError::LocalScopeChanged)?;state.attempts.values().find(|r|r.source.operation_ref==operation).and_then(|r|r.consent.as_ref()).ok_or(ControllerError::LocalScopeChanged)?.view.clone()};
                        let object=action.as_object_mut().ok_or(ControllerError::NativeMeasurementUnavailable)?;
                        if object.get("kind").and_then(|s|s.as_str())==Some("already-foreground"){object.remove("apiBool");}
                        for (key,value) in [("version",serde_json::json!(1)),("focusActionRef",serde_json::json!(action_ref)),("sourceEpochDigest",serde_json::json!(source.source_epoch_digest)),
                            ("originalRootWindowRef",serde_json::json!(source.original_root_window_ref)),("expiresAtMs",serde_json::json!(focus.expires_at_ms)),("beforeGuardsCurrent",serde_json::json!(true))]{object.insert(key.into(),value);}
                        for key in ["nativeBootRef","nativeSessionRef","computerSessionGeneration","reservationRef","reservationGeneration","nativeStopEpoch"]{object.insert(key.into(),consent[key].clone());}
                        {let mut state=self.state.lock().map_err(|_|ControllerError::LocalScopeChanged)?;let row=state.attempts.values_mut().find(|r|r.source.operation_ref==operation).ok_or(ControllerError::InvalidLookup)?;
                            row.status.possible_effect|=native.possible_focus();row.focus_action=Some(action.clone());}
                        let ack:FocusAck=self.request(&bridge,"/focus/record",serde_json::json!({"version":1,"operationRef":operation,"bindingRef":binding,"focusSourceRef":focus_source_ref,"focusRecord":action}),deadline,host,&guard)?;
                        if ack.version!=1||ack.operation_ref!=operation||ack.focus_source_ref!=focus_source_ref||ack.focus_action_ref!=action_ref
                            ||ack.possible_effect!=native.possible_focus()||!matches!(ack.outcome.as_str(),"focused"|"already-foreground")
                            ||action["afterGuardsCurrent"]!=true||action["rootAssociationCurrent"]!=true||action["afterForeground"]!="original-chrome"{return Err(ControllerError::NativeMeasurementUnavailable);}
                    }
                    Next::Measure{version,operation_ref,binding_ref,batch_ref,snapshot_ref,map_challenge_ref}=>{
                        if version!=1||operation_ref!=operation||binding_ref!=binding||[&batch_ref,&snapshot_ref,&map_challenge_ref].iter().any(|r|!wire(r)){return Err(ControllerError::InvalidPrivateReply);}
                        let source=self.bound_source(host,operation)?;
                        if source.batch_ref.as_deref()!=Some(&batch_ref)||source.snapshot_ref.as_deref()!=Some(&snapshot_ref)||source.map_challenge_ref.as_deref()!=Some(&map_challenge_ref){return Err(ControllerError::InvalidPrivateReply);}
                        let target=source.target.as_ref().ok_or(ControllerError::InvalidPrivateReply)?;
                        let (native,consent)={let state=self.state.lock().map_err(|_|ControllerError::LocalScopeChanged)?;let row=state.attempts.values().find(|r|r.source.operation_ref==operation).ok_or(ControllerError::InvalidLookup)?;
                            let previous=row.bound.as_ref().ok_or(ControllerError::LocalScopeChanged)?;
                            if previous.launch.process_launch_ref!=source.launch.process_launch_ref||previous.original_root_window_ref!=source.original_root_window_ref
                                ||serde_json::to_value(&previous.launch).ok()!=serde_json::to_value(&source.launch).ok()
                                ||serde_json::to_value(&previous.inventory).ok()!=serde_json::to_value(&source.inventory).ok()
                                ||serde_json::to_value(&previous.budget).ok()!=serde_json::to_value(&source.budget).ok(){return Err(ControllerError::LocalScopeChanged);}
                            (row.native.clone().ok_or(ControllerError::NativeMeasurementUnavailable)?,row.consent.as_ref().ok_or(ControllerError::LocalScopeChanged)?.view.clone())};
                        native.revalidate(&guard)?;
                        let measured=Arc::new(native.measure((target.intended_point_css.x,target.intended_point_css.y),(target.rect_css.x,target.rect_css.y,target.rect_css.width,target.rect_css.height),&target.tag,&target.r#type,target.writable,&guard)?);
                        let fresh=self.bound_source(host,operation)?;if !Self::same_source(&source,&fresh){return Err(ControllerError::LocalScopeChanged);}native.validate_map(&measured,false,&guard)?;
                        let map_ref=nonce()?;let measured_at=host.now_ms();let expires=deadline.min(source.expires_at_ms).min(measured_at.checked_add(PERMIT_MS).ok_or(ControllerError::LocalScopeChanged)?);
                        let mut view=measured.parts();let object=view.as_object_mut().ok_or(ControllerError::NativeMeasurementUnavailable)?;
                        for (key,value) in [("version",serde_json::json!(1)),("backendBootRef",serde_json::json!(source.backend_boot_ref)),("nativeBootRef",serde_json::json!(source.native_boot_ref)),
                            ("challengeRef",serde_json::json!(map_challenge_ref)),("mapRef",serde_json::json!(map_ref)),("originalTaskRef",serde_json::json!(task)),("operationRef",serde_json::json!(operation)),
                            ("actionBatchRef",serde_json::json!(batch_ref)),("snapshotRef",serde_json::json!(snapshot_ref)),("processLaunchRef",serde_json::json!(source.process_launch_ref)),
                            ("engineInventoryDigest",serde_json::json!(hash_json(&serde_json::to_value(&source.inventory).map_err(|_|ControllerError::InvalidPrivateReply)?)?)),("sourceEpochDigest",serde_json::json!(source.source_epoch_digest)),
                            ("nativeSessionGeneration",serde_json::json!(facts.session_generation)),("profile",serde_json::json!("exclusive-mainpage-dpi96-v1")),("measuredAtMs",serde_json::json!(measured_at)),("expiresAtMs",serde_json::json!(expires))]{object.insert(key.into(),value);}
                        for (key,from) in [("nativeSessionRef","nativeSessionRef"),("localConsentRef","consentRef"),("reservationRef","reservationRef"),("reservationGeneration","reservationGeneration"),("nativeStopEpoch","nativeStopEpoch")]{object.insert(key.into(),consent[from].clone());}
                        let ack:MapAck=self.request(&bridge,"/map",serde_json::json!({"challengeRef":map_challenge_ref,"mapRef":map_ref,"mapView":view}),expires,host,&guard)?;
                        if ack.version!=1||ack.phase!="map-accepted"||ack.binding_ref!=binding||ack.operation_ref!=operation||ack.snapshot_ref!=snapshot_ref||ack.map_ref!=map_ref||ack.map_challenge_ref!=map_challenge_ref
                            ||ack.source_epoch_digest!=source.source_epoch_digest||ack.expires_at_ms<=host.now_ms()||ack.expires_at_ms>expires{return Err(ControllerError::InvalidPrivateReply);}
                        let permit:PermitAck=self.request(&bridge,"/check",serde_json::json!({"bindingRef":binding,"snapshotRef":snapshot_ref,"mapRef":map_ref}),ack.expires_at_ms,host,&guard)?;
                        if permit.version!=1||permit.phase!="permit-issued"||permit.binding_ref!=binding||permit.operation_ref!=operation||permit.batch_ref!=batch_ref||permit.snapshot_ref!=snapshot_ref||permit.map_ref!=map_ref
                            ||permit.source_epoch_digest!=source.source_epoch_digest||!wire(&permit.permit_ref)||!wire(&permit.dispatch_challenge_ref)||permit.expires_at_ms<=host.now_ms()||permit.expires_at_ms>ack.expires_at_ms{return Err(ControllerError::InvalidPrivateReply);}
                        native.validate_map(&measured,false,&guard)?;
                        let mut state=self.state.lock().map_err(|_|ControllerError::LocalScopeChanged)?;let row=state.attempts.values_mut().find(|r|r.source.operation_ref==operation).ok_or(ControllerError::InvalidLookup)?;
                        row.bound=Some(source);row.native_map=Some(measured);row.map_view=Some(view);row.permit=Some(permit);row.in_flight=false;row.status.status="ready";row.status.reason_code="READY".into();return Ok(row.status.clone());
                    }
                    Next::Terminal{version,operation_ref,safe_status}=>{
                        if version!=1||operation_ref!=operation{return Err(ControllerError::InvalidPrivateReply);}return self.accept_status(host,operation,safe_status,true);
                    }
                    Next::Idle{version,operation_ref,reason_code}=>{
                        if version!=1||operation_ref!=operation||reason_code.is_empty()||reason_code.len()>160{return Err(ControllerError::InvalidPrivateReply);}return Err(ControllerError::NativeMeasurementUnavailable);
                    }
                    _=>return Err(ControllerError::InvalidPrivateReply)
                }
            }
            Err(ControllerError::InvalidPrivateReply)
        }
        fn accept_status(&self,host:&dyn BrowserHost,operation:&str,wire:WireStatus,terminal:bool)->Result<SafeStatus,ControllerError>{
            if wire.status=="complete"{self.validate_observed(host,operation)?;}
            let mut state=self.state.lock().map_err(|_|ControllerError::LocalScopeChanged)?;
            let row=state.attempts.values_mut().find(|r|r.source.operation_ref==operation).ok_or(ControllerError::InvalidLookup)?;
            if wire.reason_code.is_empty()||wire.reason_code.len()>160||!wire.reason_code.bytes().all(|b|b.is_ascii_graphic())
                ||[wire.requested_event_count,wire.sent_event_count,wire.cleanup_requested_count,wire.cleanup_sent_count].iter().any(|n|*n>MAX_SAFE)
                ||wire.logical_batches!=row.status.logical_batches||wire.requested_event_count!=row.status.requested_event_count||wire.sent_event_count!=row.status.sent_event_count
                ||wire.cleanup_requested_count!=row.status.cleanup_requested_count||wire.cleanup_sent_count!=row.status.cleanup_sent_count
                ||(row.status.possible_effect&&!wire.possible_effect){return Err(ControllerError::InvalidPrivateReply);}
            let status=match wire.status.as_str(){"unavailable"=>"unavailable","denied"=>"denied","partial"=>"partial","unknown"=>"unknown",
                "ready" if !terminal&&row.permit.is_some()=>"ready",
                "complete" if terminal&&row.paired&&row.bound.as_ref().is_some_and(|s|s.budget.logical_batches==row.status.logical_batches)=>"complete",
                _=>return Err(ControllerError::InvalidPrivateReply)};
            row.status.status=status;row.status.reason_code=wire.reason_code;row.status.possible_effect|=wire.possible_effect;row.in_flight=false;Ok(row.status.clone())
        }
        fn validate_observed(&self,host:&dyn BrowserHost,operation:&str)->Result<(),ControllerError>{
            let (facts,task,_,deadline)=self.context(operation)?;let bridge=host.private_bridge()?;
            let guard=||self.guard(host,&facts,&bridge,Some(&task));guard()?;
            if host.now_ms()>=deadline{return Err(ControllerError::LocalScopeChanged);}
            #[cfg(all(windows,not(test)))] {
                let (native,observed)={let state=self.state.lock().map_err(|_|ControllerError::LocalScopeChanged)?;
                    let row=state.attempts.values().find(|r|r.source.operation_ref==operation).ok_or(ControllerError::InvalidLookup)?;
                    (row.native.clone().ok_or(ControllerError::NativeMeasurementUnavailable)?,row.observed_document.clone().ok_or(ControllerError::NativeMeasurementUnavailable)?)};
                observed.revalidate(&native,&guard)?;native.effect_environment(&guard)?;guard()
            }
            #[cfg(not(all(windows,not(test))))] {Err(ControllerError::NativeMeasurementUnavailable)}
        }
        #[cfg(all(windows,not(test)))]
        fn dispatch_owned(&self,host:&dyn BrowserHost,operation:&str)->Result<SafeStatus,ControllerError>{
            let (facts,task,binding,deadline)=self.context(operation)?;let bridge=host.private_bridge()?;
            let guard=||self.guard(host,&facts,&bridge,Some(&task));guard()?;
            let (source,permit,view,native,map,snapshot)={let state=self.state.lock().map_err(|_|ControllerError::LocalScopeChanged)?;
                let row=state.attempts.values().find(|r|r.source.operation_ref==operation).ok_or(ControllerError::InvalidLookup)?;
                (row.bound.clone().ok_or(ControllerError::LocalScopeChanged)?,row.permit.clone().ok_or(ControllerError::LocalScopeChanged)?,row.map_view.clone().ok_or(ControllerError::LocalScopeChanged)?,
                    row.native.clone().ok_or(ControllerError::NativeMeasurementUnavailable)?,row.native_map.clone().ok_or(ControllerError::NativeMeasurementUnavailable)?,row.host_snapshot.clone().ok_or(ControllerError::LocalScopeChanged)?)};
            let target=source.target.as_ref().ok_or(ControllerError::InvalidPrivateReply)?;
            let batch_index=source.budget.batches.iter().position(|b|b.batch_ref==permit.batch_ref).ok_or(ControllerError::InvalidPrivateReply)?;
            let batch=&source.budget.batches[batch_index];
            let navigation=matches!(batch.kind.as_str(),"fixed-return"|"click-approved-href");
            if navigation&&batch_index+1!=source.budget.batches.len(){return Err(ControllerError::InvalidPrivateReply);}
            let next:Next=self.request(&bridge,"/driver/next",serde_json::json!({"version":1,"operationRef":operation}),deadline,host,&guard)?;
            match next {Next::Dispatch{version,operation_ref,batch_ref,permit_ref} if version==1&&operation_ref==operation&&batch_ref==permit.batch_ref&&permit_ref==permit.permit_ref=>{},_=>return Err(ControllerError::InvalidPrivateReply)}
            let fresh=self.bound_source(host,operation)?;if !Self::same_source(&source,&fresh){return Err(ControllerError::LocalScopeChanged);}native.validate_map(&map,false,&guard)?;
            let consumed:ConsumedView=self.request(&bridge,"/consume",serde_json::json!({"permitRef":permit.permit_ref}),permit.expires_at_ms,host,&guard)?;
            let command=&consumed.command;
            if consumed.version!=1||consumed.phase!="command-consumed"||consumed.dispatch_challenge_ref!=permit.dispatch_challenge_ref
                ||command.permit_ref!=permit.permit_ref||command.operation_ref!=operation||command.action_batch_ref!=permit.batch_ref||command.target_ref!=target.target_ref
                ||command.source_epoch_digest!=source.source_epoch_digest||!wire(&command.command_ref)||!wire(&command.approved_input_ref)
                ||command.expires_at_ms<=host.now_ms()||command.expires_at_ms>permit.expires_at_ms{return Err(ControllerError::InvalidPrivateReply);}
            let mut fixed_deadline=deadline.min(source.expires_at_ms).min(fresh.expires_at_ms).min(permit.expires_at_ms).min(command.expires_at_ms)
                .min(view["expiresAtMs"].as_u64().ok_or(ControllerError::InvalidPrivateReply)?);
            let body=serde_json::json!({"version":1,"commandRef":command.command_ref,"approvedInputRef":command.approved_input_ref});
            let mut armed=None;
            if batch.kind=="fixed-return"{
                #[derive(Deserialize)]#[serde(rename_all="camelCase",deny_unknown_fields)]
                struct Arm {version:u8,command_ref:String,approved_input_ref:String,search_submit_admission_ref:String,causal_successor_ref:String,expires_at_ms:u64}
                let arm:Arm=self.request(&bridge,"/input/arm",body.clone(),fixed_deadline,host,&guard)?;
                if arm.version!=1||arm.command_ref!=command.command_ref||arm.approved_input_ref!=command.approved_input_ref||!wire(&arm.search_submit_admission_ref)||!wire(&arm.causal_successor_ref)
                    ||arm.expires_at_ms<=host.now_ms()||arm.expires_at_ms>fixed_deadline{return Err(ControllerError::InvalidPrivateReply);}fixed_deadline=fixed_deadline.min(arm.expires_at_ms);
                armed=Some((arm.search_submit_admission_ref,arm.causal_successor_ref));
            }
            let input_value:serde_json::Value=self.request(&bridge,"/input",body,fixed_deadline,host,&guard)?;
            let input_expires=input_value["expiresAtMs"].as_u64().ok_or(ControllerError::InvalidPrivateReply)?;
            if input_expires<=host.now_ms()||input_expires>fixed_deadline||input_value["kind"].as_str()!=Some(&batch.kind)
                ||input_value[if batch.kind=="scroll-profile-wheel"{"surfaceRef"}else{"targetRef"}].as_str()!=Some(&target.target_ref){return Err(ControllerError::InvalidPrivateReply);}
            fixed_deadline=fixed_deadline.min(input_expires);
            if let Some((admission,successor))=&armed{if input_value["searchSubmitAdmissionRef"].as_str()!=Some(admission.as_str())||input_value["causalSuccessorRef"].as_str()!=Some(successor.as_str()){return Err(ControllerError::InvalidPrivateReply);}}
            let input:ApprovedInputWire=serde_json::from_value(input_value).map_err(|_|ControllerError::InvalidPrivateReply)?;
            let (chunks,units)=plan_input(input,&command.command_ref,&command.approved_input_ref,host.now_ms())?;
            if chunks.iter().map(Vec::len).sum::<usize>()!=batch.primary_event_count as usize||units!=batch.utf16_units{return Err(ControllerError::InvalidPrivateReply);}
            let fresh=self.bound_source(host,operation)?;if !Self::same_source(&source,&fresh){return Err(ControllerError::LocalScopeChanged);}fixed_deadline=fixed_deadline.min(fresh.expires_at_ms);
            // LAST remote read precedes the final consume. Every closure below
            // is local: host epochs/session/reservation + genuine Win32/UIA.
            let focus_required=AtomicBool::new(batch.kind=="fixed-return");
            let capture=||->Result<HostSnapshot,FoundationError>{guard().map_err(|_|FoundationError::IncarnationChanged)?;
                if host.now_ms()>=fixed_deadline{return Err(FoundationError::Expired);}
                if map.retired(){native.validate_root(&guard).map_err(|_|FoundationError::IncarnationChanged)?;}
                else{native.validate_map(&map,focus_required.load(Ordering::SeqCst),&guard).map_err(|_|FoundationError::IncarnationChanged)?;}
                native.effect_environment(&guard).map_err(|_|FoundationError::UnsafePressedState)?;
                Ok(snapshot.clone())};
            capture().map_err(|_|ControllerError::NativeMeasurementUnavailable)?;
            let ledger_ref=nonce()?;
            let (mut record,claimed,completed)={let _lock=host.dispatch_lock()?;
                capture().map_err(|_|ControllerError::NativeMeasurementUnavailable)?;
                let local=self.foundation.issue_permit_until(&snapshot,batch_index,host.now_ms(),fixed_deadline).map_err(|_|ControllerError::LocalScopeChanged)?;
                let claimed=host.now_ms();let token=self.foundation.consume(&local,claimed).map_err(|_|ControllerError::LocalScopeChanged)?;
                {let mut state=self.state.lock().map_err(|_|ControllerError::LocalScopeChanged)?;
                    let row=state.attempts.values_mut().find(|r|r.source.operation_ref==operation).ok_or(ControllerError::InvalidLookup)?;row.effects=Some(token.effects.clone());}
                let mut api=ControllerWindowsApi{api:WindowsApi,focus_required:&focus_required,map:&map,navigation_or_scroll:navigation||batch.kind=="scroll-profile-wheel",primary_chunks_left:chunks.len()};
                let mut record=dispatch_counted(&self.foundation,&token,&chunks,if batch.kind=="fixed-return"{None}else{Some(map.point())},&mut api,&capture,&||host.now_ms()).map_err(|_|ControllerError::NativeMeasurementUnavailable)?;
                record.focus_effect|=native.possible_focus();record.possible_effect|=native.possible_focus();
                let completed=host.now_ms();let publication=summarize(&record);
                // Resettable authority and immutable measured history have
                // independent storage. No fallible publication can erase a
                // short/zero/late actual DWORD after input has occurred.
                self.history.lock().unwrap_or_else(|poisoned|poisoned.into_inner()).push((facts.boot_epoch,operation.to_owned(),record.clone()));
                map.retire(); // No outcome can restore input authority.
                let mut state=self.state.lock().unwrap_or_else(|poisoned|poisoned.into_inner());
                if let Some(row)=state.attempts.values_mut().find(|r|r.source.operation_ref==operation){
                    row.status.logical_batches+=1;row.status.requested_event_count+=publication.requested;row.status.sent_event_count+=publication.sent;
                    row.status.cleanup_requested_count+=publication.cleanup_requested;row.status.cleanup_sent_count+=publication.cleanup_sent;row.status.possible_effect|=publication.possible;
                    row.status.status=match publication.outcome{NativeOutcome::Sent=>"partial",NativeOutcome::ZeroEffectDenied=>"denied",NativeOutcome::Partial=>"partial",NativeOutcome::Unknown=>"unknown"};
                    row.permit=None;row.paired=false;
                }
                drop(state);
                let retained=self.foundation.retain_dispatch(token,record,true);
                if retained.is_err(){
                    self.fail_owned(operation);
                    if let Ok(state)=self.state.lock(){if let Some(row)=state.attempts.values().find(|r|r.source.operation_ref==operation){return Ok(row.status.clone());}}
                    return Ok(SafeStatus{status:"unknown",reason_code:"NATIVE_SCOPE_STALE".into(),logical_batches:1,requested_event_count:publication.requested,sent_event_count:publication.sent,
                        cleanup_requested_count:publication.cleanup_requested,cleanup_sent_count:publication.cleanup_sent,possible_effect:publication.possible});
                }
                (publication,claimed,completed)};
            let mut completed=completed;
            if record.outcome==NativeOutcome::Sent{
                // The authentic issuer must expose the approved observed
                // successor view before publication/verify. Current old target
                // is historical and can never be revived by this read.
                let successor_result=(||->Result<(),ControllerError>{
                let observed=self.bound_source(host,operation)?;
                if observed.expires_at_ms>fixed_deadline||observed.launch.pid!=source.launch.pid
                    ||serde_json::to_value(&observed.launch).ok()!=serde_json::to_value(&source.launch).ok()
                    ||serde_json::to_value(&observed.budget).ok()!=serde_json::to_value(&source.budget).ok()
                    ||observed.original_root_window_ref!=source.original_root_window_ref||observed.inventory.target_id!=source.inventory.target_id
                    ||observed.inventory.frame_id!=source.inventory.frame_id
                    ||(navigation&&(observed.target.is_some()||observed.snapshot_ref.is_some()||observed.batch_ref.is_some()||observed.map_challenge_ref.is_some()||observed.inventory.loader_id==source.inventory.loader_id))
                    ||(!navigation&&(observed.inventory.inventory_epoch!=source.inventory.inventory_epoch||observed.inventory.loader_id!=source.inventory.loader_id)){
                    return Err(ControllerError::InvalidPrivateReply);
                }
                let native_observed=Arc::new(native.observe_successor(observed.viewport.width_css as u32,observed.viewport.height_css as u32,observed.viewport.dpr,observed.viewport.visual_scale,&map,&guard)?);
                native_observed.revalidate(&native,&guard)?;native.effect_environment(&guard)?;
                completed=host.now_ms();if completed>=fixed_deadline{return Err(ControllerError::LocalScopeChanged);}
                {let mut state=self.state.lock().map_err(|_|ControllerError::LocalScopeChanged)?;let row=state.attempts.values_mut().find(|r|r.source.operation_ref==operation).ok_or(ControllerError::InvalidLookup)?;
                    row.observed_document=Some(native_observed);}
                Ok(())})();
                if successor_result.is_err(){record.outcome=NativeOutcome::Partial;completed=host.now_ms();self.fail_owned(operation);}
            }
            if !record.known{record.outcome=NativeOutcome::Unknown;}
            let ledger=serde_json::json!({"version":1,"backendBootRef":source.backend_boot_ref,"nativeBootRef":source.native_boot_ref,"challengeRef":permit.dispatch_challenge_ref,
                "ledgerRef":ledger_ref,"permitRef":permit.permit_ref,"operationRef":operation,"actionBatchRef":permit.batch_ref,"processLaunchRef":source.process_launch_ref,
                "kernelIdentityRef":view["kernelIdentityRef"],"viewportMapRef":permit.map_ref,"nativeSessionRef":view["nativeSessionRef"],"nativeSessionGeneration":facts.session_generation,
                "localConsentRef":view["localConsentRef"],"reservationRef":view["reservationRef"],"reservationGeneration":facts.reservation_incarnation,"nativeStopEpoch":facts.scope_epoch,
                "sequence":batch.sequence,"claimedAtMs":claimed,"completedAtMs":completed,"requestedEventCount":record.requested,"sentEventCount":record.sent,
                "cleanupRequestedCount":record.cleanup_requested,"cleanupSentCount":record.cleanup_sent,"cursorEffect":record.cursor,"focusEffect":record.focus,"possibleEffect":record.possible,
                "result":match record.outcome{NativeOutcome::Sent=>"sent",NativeOutcome::ZeroEffectDenied=>"zero_effect_denied",NativeOutcome::Partial=>"partial",NativeOutcome::Unknown=>"unknown"}});
            // Historical counts have already been retained. A late/lost remote
            // publication yields sticky unknown, never input replay.
            let ack:DispatchAck=self.request(&bridge,"/dispatch",serde_json::json!({"challengeRef":permit.dispatch_challenge_ref,"permitRef":permit.permit_ref,"ledgerRef":ledger_ref,"ledgerView":ledger}),deadline,host,&guard)?;
            if ack.version!=1||ack.phase!="dispatch-recorded"||ack.operation_ref!=operation||ack.permit_ref!=permit.permit_ref||ack.dispatch_challenge_ref!=permit.dispatch_challenge_ref
                ||ack.ledger_ref!=ledger_ref||ack.sequence!=batch.sequence||!wire(&ack.dispatch_ref){return Err(ControllerError::InvalidPrivateReply);}
            self.check_counts(operation,&ack.safe_status)?;
            if record.outcome!=NativeOutcome::Sent{return self.accept_status(host,operation,ack.safe_status,false);}
            // /dispatch is blocking: inspect current native facts again BEFORE
            // the single canonical verifier. Counts remain immutable history.
            self.validate_observed(host,operation)?;
            let verify_guard=||{guard()?;if host.now_ms()>=fixed_deadline{return Err(ControllerError::LocalScopeChanged);}self.validate_observed(host,operation)};
            let verified:VerifyAck=self.request(&bridge,"/verify",serde_json::json!({"permitRef":permit.permit_ref,"dispatchRef":ack.dispatch_ref}),fixed_deadline,host,&verify_guard)?;
            verify_guard()?;
            if verified.version!=1||verified.phase!="step-verified"||verified.operation_ref!=operation||verified.permit_ref!=permit.permit_ref||verified.dispatch_ref!=ack.dispatch_ref||!wire(&verified.step_evidence_ref){return Err(ControllerError::InvalidPrivateReply);}
            self.check_counts(operation,&verified.safe_status)?;
            {let mut state=self.state.lock().map_err(|_|ControllerError::LocalScopeChanged)?;let row=state.attempts.values_mut().find(|r|r.source.operation_ref==operation).ok_or(ControllerError::InvalidLookup)?;row.paired=true;}
            // One dispatch has exactly one primary logical batch. Preparing the
            // next issuer-selected map cannot send its input.
            self.prepare_owned(host,operation)
        }
        fn check_counts(&self,operation:&str,wire:&WireStatus)->Result<(),ControllerError>{
            let state=self.state.lock().map_err(|_|ControllerError::LocalScopeChanged)?;let row=state.attempts.values().find(|r|r.source.operation_ref==operation).ok_or(ControllerError::InvalidLookup)?;
            if wire.logical_batches!=row.status.logical_batches||wire.requested_event_count!=row.status.requested_event_count||wire.sent_event_count!=row.status.sent_event_count
                ||wire.cleanup_requested_count!=row.status.cleanup_requested_count||wire.cleanup_sent_count!=row.status.cleanup_sent_count||(row.status.possible_effect&&!wire.possible_effect){return Err(ControllerError::InvalidPrivateReply);}Ok(())
        }
    }
    struct CountSummary {requested:u64,sent:u64,cleanup_requested:u64,cleanup_sent:u64,cursor:bool,focus:bool,possible:bool,outcome:NativeOutcome,known:bool}
    fn summarize(record:&NativeDispatchRecord)->CountSummary{
        CountSummary{requested:record.primary.iter().map(|r|u64::from(r.requested)).sum(),sent:record.primary.iter().filter_map(|r|r.sent.map(u64::from)).sum(),
            cleanup_requested:record.cleanup.iter().map(|r|u64::from(r.requested)).sum(),cleanup_sent:record.cleanup.iter().filter_map(|r|r.sent.map(u64::from)).sum(),
            cursor:record.cursor.as_ref().is_some_and(|r|r.possible_effect),focus:record.focus_effect,possible:record.possible_effect,outcome:record.outcome,
            known:record.primary.iter().chain(&record.cleanup).all(|r|r.sent.is_some())}
    }
    fn hash_json(value:&serde_json::Value)->Result<String,ControllerError>{use sha2::{Digest,Sha256};
        Ok(format!("{:x}",Sha256::digest(serde_json::to_vec(value).map_err(|_|ControllerError::InvalidPrivateReply)?)))}
    #[cfg(all(windows,not(test)))]
    struct ControllerWindowsApi<'a>{api:WindowsApi,focus_required:&'a AtomicBool,map:&'a super::native_measurements::MeasuredMap,navigation_or_scroll:bool,primary_chunks_left:usize}
    #[cfg(all(windows,not(test)))]
    impl NativeApi for ControllerWindowsApi<'_>{
        fn send(&mut self,events:&[InputEvent])->Option<u32>{let count=self.api.send(events);
            if self.primary_chunks_left>0{self.primary_chunks_left-=1;
                if native_retirement_can_follow_exact_input(self.navigation_or_scroll,events.len() as u32,count,self.primary_chunks_left){self.map.retire();}}
            if events.iter().any(|e|matches!(e.key,OwnedKey::LeftButton)){self.focus_required.store(true,Ordering::SeqCst);}count}
        fn move_cursor(&mut self,point:(i32,i32))->Option<bool>{self.api.move_cursor(point)}
        fn cursor(&mut self)->Option<(i32,i32)>{self.api.cursor()}
        fn physically_down(&mut self,key:OwnedKey)->Option<bool>{self.api.physically_down(key)}
    }
    fn nonce()->Result<String,ControllerError>{let mut bytes=[0u8;32];getrandom::fill(&mut bytes).map_err(|_|ControllerError::HostUnavailable)?;Ok(bytes.iter().map(|b|format!("{b:02x}")).collect())}
}

// These constructors measure genuine OS/provider facts. They deliberately do
// not accept serialized proof, expose constructors to the renderer, or bind DOM
// selectors to UIA elements. The controller's authentic frozen private source
// join constructs TrustedLaunch; the independent native census retains its own
// kernel/window/document facts and never adopts source DOM identities as UIA.
#[cfg(all(windows,not(test)))]
mod native_measurements {
    use super::*;
    use sha2::{Digest,Sha256};
    use std::io::Read;
    use std::collections::BTreeMap;
    use std::sync::Arc;
    use windows_sys::Win32::{Foundation::{CloseHandle,HANDLE,HWND,FILETIME,RECT,POINT,INVALID_HANDLE_VALUE,WAIT_TIMEOUT},
        Storage::FileSystem::SYNCHRONIZE,
        System::{Threading::{OpenProcess,GetProcessTimes,QueryFullProcessImageNameW,WaitForSingleObject,PROCESS_QUERY_LIMITED_INFORMATION},
            Diagnostics::ToolHelp::{CreateToolhelp32Snapshot,Process32FirstW,Process32NextW,PROCESSENTRY32W,TH32CS_SNAPPROCESS}},
        UI::{WindowsAndMessaging::{EnumWindows,EnumChildWindows,GetWindowThreadProcessId,IsWindow,IsWindowVisible,GetWindow,GetAncestor,
            GetClientRect,GetWindowRect,GetForegroundWindow,SetForegroundWindow,GetSystemMetrics,GW_OWNER,GA_ROOT,SM_CMONITORS},
            HiDpi::{GetDpiForWindow,GetThreadDpiAwarenessContext,GetAwarenessFromDpiAwarenessContext,DPI_AWARENESS_PER_MONITOR_AWARE}},
        Graphics::Gdi::{ClientToScreen,MonitorFromWindow,GetMonitorInfoW,MONITORINFO,MONITOR_DEFAULTTONULL}};
    use windows::Win32::{Foundation::{HWND as ComHwnd,POINT as ComPoint},System::{Com::{CoCreateInstance,CoInitializeEx,CoUninitialize,CLSCTX_INPROC_SERVER,COINIT_MULTITHREADED,SAFEARRAY},
        Ole::{SafeArrayDestroy,SafeArrayGetDim,SafeArrayGetElemsize,SafeArrayGetLBound,SafeArrayGetUBound,SafeArrayGetElement}},
        UI::Accessibility::{CUIAutomation,IUIAutomation,IUIAutomationElement}};
    type Error=controller::ControllerError;
    fn unavailable()->Error { Error::NativeMeasurementUnavailable }
    fn api<T>(value:windows::core::Result<T>)->Result<T,Error>{value.map_err(|_|unavailable())}
    struct Handle(HANDLE);
    impl Drop for Handle {fn drop(&mut self){unsafe{CloseHandle(self.0);}}}
    // Windows kernel handles may be queried/closed on a different native worker.
    unsafe impl Send for Handle {}
    unsafe impl Sync for Handle {}
    struct InputDesktop(windows_sys::Win32::System::StationsAndDesktops::HDESK);
    impl Drop for InputDesktop{fn drop(&mut self){unsafe{windows_sys::Win32::System::StationsAndDesktops::CloseDesktop(self.0);}}}
    fn desktop_name(handle:HANDLE,guard:&dyn Fn()->Result<(),Error>)->Result<String,Error>{
        use windows_sys::Win32::System::StationsAndDesktops::{GetUserObjectInformationW,UOI_NAME};
        if handle.is_null(){return Err(unavailable());}guard()?;
        let mut buffer=[0u16;256];let mut needed=0;
        let ok=unsafe{GetUserObjectInformationW(handle,UOI_NAME,buffer.as_mut_ptr().cast(),512,&mut needed)};guard()?;
        if ok==0{return Err(unavailable());}decode_native_object_name(&buffer,needed as usize).ok_or_else(unavailable)
    }
    fn token_buffer(handle:HANDLE,class:i32,guard:&dyn Fn()->Result<(),Error>)->Result<(Vec<u64>,usize),Error>{
        use windows_sys::Win32::{Security::GetTokenInformation,Foundation::{GetLastError,ERROR_INSUFFICIENT_BUFFER}};
        let mut needed=0;guard()?;let ok=unsafe{GetTokenInformation(handle,class,std::ptr::null_mut(),0,&mut needed)};
        let error=unsafe{GetLastError()};guard()?;
        if ok!=0||error!=ERROR_INSUFFICIENT_BUFFER||needed==0||needed>4096{return Err(unavailable());}
        let capacity=needed;let mut buffer=vec![0u64;(needed as usize+7)/8];
        let ok=unsafe{GetTokenInformation(handle,class,buffer.as_mut_ptr().cast(),capacity,&mut needed)};guard()?;
        if ok==0||needed==0||needed>capacity{return Err(unavailable());}Ok((buffer,needed as usize))
    }
    fn token_facts(handle:HANDLE,guard:&dyn Fn()->Result<(),Error>)->Result<NativeTokenFacts,Error>{
        use windows_sys::Win32::Security::{TokenIntegrityLevel,TokenUIAccess,TokenStatistics,TOKEN_MANDATORY_LABEL,TOKEN_STATISTICS};
        let (buffer,length)=token_buffer(handle,TokenIntegrityLevel,guard)?;
        if length<std::mem::size_of::<TOKEN_MANDATORY_LABEL>(){return Err(unavailable());}
        let label=unsafe{&*buffer.as_ptr().cast::<TOKEN_MANDATORY_LABEL>()};
        let bytes=unsafe{std::slice::from_raw_parts(buffer.as_ptr().cast::<u8>(),length)};
        let start=buffer.as_ptr() as usize;let pointer=label.Label.Sid as usize;
        let offset=pointer.checked_sub(start).ok_or_else(unavailable)?;
        if offset<std::mem::size_of::<TOKEN_MANDATORY_LABEL>(){return Err(unavailable());}
        let integrity=decode_native_integrity_sid(bytes,offset,label.Label.Attributes).ok_or_else(unavailable)?;
        let (ui,ui_length)=token_buffer(handle,TokenUIAccess,guard)?;
        if ui_length!=4{return Err(unavailable());}let ui_access=unsafe{std::ptr::read_unaligned(ui.as_ptr().cast::<u32>())};
        if ui_access>1{return Err(unavailable());}
        let (stats,stats_length)=token_buffer(handle,TokenStatistics,guard)?;
        if stats_length!=std::mem::size_of::<TOKEN_STATISTICS>(){return Err(unavailable());}
        let stats=unsafe{&*stats.as_ptr().cast::<TOKEN_STATISTICS>()};guard()?;
        Ok(NativeTokenFacts{integrity,ui_access:ui_access!=0,token_id:(stats.TokenId.LowPart,stats.TokenId.HighPart)})
    }
    fn process_token(handle:HANDLE,guard:&dyn Fn()->Result<(),Error>)->Result<Handle,Error>{
        use windows_sys::Win32::{Security::TOKEN_QUERY,System::Threading::OpenProcessToken};
        let mut token=std::ptr::null_mut();guard()?;
        if unsafe{OpenProcessToken(handle,TOKEN_QUERY,&mut token)}==0||token.is_null(){return Err(unavailable());}let token=Handle(token);guard()?;Ok(token)
    }
    fn environment(root:&HeldProcess,root_hwnd:isize,allowed_foreground:isize,guard:&dyn Fn()->Result<(),Error>)->Result<NativeEnvironmentFacts,Error>{
        use windows_sys::Win32::{System::{StationsAndDesktops::{OpenInputDesktop,GetThreadDesktop,GetProcessWindowStation,DESKTOP_READOBJECTS,DESKTOP_HOOKCONTROL},
            Threading::{GetCurrentThreadId,GetCurrentThread,GetCurrentProcess,OpenThreadToken}},Security::TOKEN_QUERY,Foundation::{GetLastError,ERROR_NO_TOKEN}};
        guard()?;
        let input=unsafe{OpenInputDesktop(0,0,DESKTOP_READOBJECTS|DESKTOP_HOOKCONTROL)};
        if input.is_null(){return Err(unavailable());}let input=InputDesktop(input);guard()?;
        let station_handle=unsafe{GetProcessWindowStation()};if station_handle.is_null(){return Err(unavailable());}
        let station=desktop_name(station_handle,guard)?;
        use windows_sys::Win32::System::StationsAndDesktops::{GetUserObjectInformationW,UOI_FLAGS,UOI_IO,USEROBJECTFLAGS};
        let mut flags=USEROBJECTFLAGS::default();let mut flag_bytes=0;guard()?;
        let flags_ok=unsafe{GetUserObjectInformationW(station_handle,UOI_FLAGS,(&mut flags as *mut USEROBJECTFLAGS).cast(),std::mem::size_of::<USEROBJECTFLAGS>() as u32,&mut flag_bytes)};guard()?;
        if flags_ok==0||flag_bytes as usize!=std::mem::size_of::<USEROBJECTFLAGS>()||flags.fReserved!=0||!matches!(flags.fInherit,0|1){return Err(unavailable());}
        let mut receives_input=0i32;let mut input_bytes=0;guard()?;
        let input_ok=unsafe{GetUserObjectInformationW(input.0,UOI_IO,(&mut receives_input as *mut i32).cast(),4,&mut input_bytes)};guard()?;
        if input_ok==0||input_bytes!=4||!matches!(receives_input,0|1){return Err(unavailable());}
        let caller_desktop=desktop_name(unsafe{GetThreadDesktop(GetCurrentThreadId())},guard)?;
        let input_name=desktop_name(input.0,guard)?;
        let mut pid=0;let target_thread=unsafe{GetWindowThreadProcessId(root_hwnd as HWND,&mut pid)};guard()?;
        if target_thread==0||pid!=root.pid{return Err(unavailable());}
        let target_desktop=desktop_name(unsafe{GetThreadDesktop(target_thread)},guard)?;
        let own=process_token(unsafe{GetCurrentProcess()},guard)?;let caller=token_facts(own.0,guard)?;
        let mut effective=std::ptr::null_mut();guard()?;let opened=unsafe{OpenThreadToken(GetCurrentThread(),TOKEN_QUERY,1,&mut effective)};
        let error=unsafe{GetLastError()};
        let effective=if opened!=0{if effective.is_null(){return Err(unavailable());}let handle=Handle(effective);guard()?;token_facts(handle.0,guard)?}
            else{guard()?;if error!=ERROR_NO_TOKEN{return Err(unavailable());}caller.clone()};
        let target=process_token(root.handle.0,guard)?;let target=token_facts(target.0,guard)?;
        let foreground=unsafe{GetForegroundWindow()} as isize;guard()?;
        let facts=NativeEnvironmentFacts{station,station_visible:flags.dwFlags&1!=0,input_receives:receives_input==1,caller_desktop,input_desktop:input_name,target_desktop,caller,effective,target,
            foreground_is_original_or_managed:foreground==root_hwnd||foreground==allowed_foreground};
        if !native_environment_eligible(&facts){return Err(unavailable());}Ok(facts)
    }
    // Only actual retained ChildProcess PID + executable metadata come from the
    // private source. Kernel creation and descendants are native measurements.
    struct TrustedLaunch {root_pid:u32,path:String,fingerprint:String,css_width:u32,css_height:u32,dpr:f64,visual_scale:f64}
    struct HeldProcess {handle:Handle,pid:u32,creation:u64,path:String,fingerprint:String}
    #[derive(Clone,PartialEq,Eq)]
    struct WindowFact {hwnd:isize,pid:u32,parent:isize}
    #[derive(Clone,PartialEq,Eq)]
    struct Viewport {root:isize,origin:(i32,i32),size:(u32,u32),dpi:u32,monitor:(i32,i32,i32,i32),document:DocumentGeometry}
    struct HeldLaunch {processes:Vec<Arc<HeldProcess>>,parents:BTreeMap<u32,u32>,root:isize,windows:Vec<WindowFact>,viewport:Viewport}
    struct RootAnchor{process:Arc<HeldProcess>,identity:NativeRootIdentity}
    fn root_runtime(hwnd:isize,pid:u32,guard:&dyn Fn()->Result<(),Error>)->Result<Vec<i32>,Error>{
        let _apartment=Apartment::new()?;guard()?;
        let automation:IUIAutomation=api(unsafe{CoCreateInstance(&CUIAutomation,None,CLSCTX_INPROC_SERVER)})?;guard()?;
        let root=api(unsafe{automation.ElementFromHandle(ComHwnd(hwnd as *mut core::ffi::c_void))})?;guard()?;
        if api(unsafe{root.CurrentProcessId()})?!=pid as i32||api(unsafe{root.CurrentNativeWindowHandle()})?.0 as isize!=hwnd{return Err(unavailable());}guard()?;
        let value=runtime(&root)?;guard()?;Ok(value)
    }
    impl RootAnchor{
        fn capture(held:&HeldLaunch,pid:u32,guard:&dyn Fn()->Result<(),Error>)->Result<Self,Error>{
            let process=held.processes.iter().find(|p|p.pid==pid).ok_or_else(unavailable)?.clone();
            let identity=NativeRootIdentity{pid,creation:process.creation,hwnd:held.root,runtime:root_runtime(held.root,pid,guard)?,path:process.path.clone(),fingerprint:process.fingerprint.clone()};
            let anchor=Self{process,identity};anchor.revalidate(guard)?;Ok(anchor)
        }
        fn revalidate(&self,guard:&dyn Fn()->Result<(),Error>)->Result<(),Error>{
            self.process.revalidate(guard)?;
            let hwnd=self.identity.hwnd as HWND;let mut pid=0;guard()?;
            if unsafe{IsWindow(hwnd)}==0||unsafe{GetAncestor(hwnd,GA_ROOT)} as isize!=self.identity.hwnd{return Err(unavailable());}
            unsafe{GetWindowThreadProcessId(hwnd,&mut pid);}guard()?;
            let current=NativeRootIdentity{pid,creation:creation(self.process.handle.0)?,hwnd:self.identity.hwnd,runtime:root_runtime(self.identity.hwnd,pid,guard)?,
                path:process_path(self.process.handle.0)?,fingerprint:image_fingerprint(&self.process.path,guard)?};
            if !native_root_identity_matches(&self.identity,&current){return Err(unavailable());}guard()
        }
        fn current_document(&self,source:&TrustedLaunch,guard:&dyn Fn()->Result<(),Error>)->Result<HeldLaunch,Error>{
            self.revalidate(guard)?;
            if source.root_pid!=self.identity.pid{return Err(unavailable());}
            let census=process_inventory(self.identity.pid,guard)?;let mut processes=vec![self.process.clone()];
            for pid in &census.owned{if *pid!=self.identity.pid{processes.push(Arc::new(HeldProcess::open(*pid,&self.process.path,&self.process.fingerprint,guard)?));}}
            let creations:BTreeMap<_,_>=processes.iter().map(|p|(p.pid,p.creation)).collect();
            for (&pid,&parent) in &census.parents{if pid!=self.identity.pid&&creations.get(&pid).ok_or_else(unavailable)?<creations.get(&parent).ok_or_else(unavailable)?{return Err(unavailable());}}
            let (root,windows)=windows(self.identity.pid,&census.owned,guard)?;
            if root!=self.identity.hwnd{return Err(unavailable());}
            let viewport=viewport(root,source,guard)?;
            let current=HeldLaunch{processes,parents:census.parents,root,windows,viewport};current.revalidate(source,guard)?;self.revalidate(guard)?;Ok(current)
        }
    }
    fn creation(handle:HANDLE)->Result<u64,Error>{
        let mut created=FILETIME::default();let mut exited=FILETIME::default();let mut kernel=FILETIME::default();let mut user=FILETIME::default();
        if unsafe{GetProcessTimes(handle,&mut created,&mut exited,&mut kernel,&mut user)}==0{return Err(unavailable());}
        Ok((u64::from(created.dwHighDateTime)<<32)|u64::from(created.dwLowDateTime))
    }
    fn process_path(handle:HANDLE)->Result<String,Error>{
        let mut buffer=vec![0u16;32768];let mut len=buffer.len() as u32;
        if unsafe{QueryFullProcessImageNameW(handle,0,buffer.as_mut_ptr(),&mut len)}==0 || len==0 || len as usize>=buffer.len(){return Err(unavailable());}
        let path=String::from_utf16(&buffer[..len as usize]).map_err(|_|unavailable())?;
        let canonical=std::fs::canonicalize(&path).map_err(|_|unavailable())?;
        canonical.to_str().map(str::to_owned).ok_or_else(unavailable)
    }
    fn image_fingerprint(path:&str,guard:&dyn Fn()->Result<(),Error>)->Result<String,Error>{
        guard()?;let mut file=std::fs::File::open(path).map_err(|_|unavailable())?;guard()?;
        if file.metadata().map_err(|_|unavailable())?.len()>256*1024*1024{return Err(unavailable());}
        let mut hash=Sha256::new();let mut buffer=[0u8;65536];let mut total=0u64;
        loop{let read=file.read(&mut buffer).map_err(|_|unavailable())?;guard()?;if read==0{break;}
            total=total.checked_add(read as u64).ok_or_else(unavailable)?;if total>256*1024*1024{return Err(unavailable());}hash.update(&buffer[..read]);}
        Ok(format!("{:x}",hash.finalize()))
    }
    impl HeldProcess {
        fn open(pid:u32,expected_path:&str,expected_fingerprint:&str,guard:&dyn Fn()->Result<(),Error>)->Result<Self,Error>{
            if pid==0||expected_fingerprint.len()!=64{return Err(unavailable());}
            guard()?;let handle=unsafe{OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION|SYNCHRONIZE,0,pid)};
            if handle.is_null(){return Err(unavailable());}let handle=Handle(handle);guard()?;
            if unsafe{WaitForSingleObject(handle.0,0)}!=WAIT_TIMEOUT{return Err(unavailable());}
            let observed_creation=creation(handle.0)?;guard()?;let path=process_path(handle.0)?;guard()?;
            let expected_canonical=std::fs::canonicalize(expected_path).map_err(|_|unavailable())?;guard()?;
            if observed_creation==0 || !expected_canonical.to_str().is_some_and(|expected|path.eq_ignore_ascii_case(expected))
                || !std::path::Path::new(&path).file_name().and_then(|s|s.to_str()).is_some_and(|s|s.eq_ignore_ascii_case("chrome.exe")){return Err(unavailable());}
            let fingerprint=image_fingerprint(&path,guard)?;
            if !fingerprint.eq_ignore_ascii_case(expected_fingerprint){return Err(unavailable());}
            let held=Self{handle,pid,creation:observed_creation,path,fingerprint};held.revalidate(guard)?;Ok(held)
        }
        fn revalidate(&self,guard:&dyn Fn()->Result<(),Error>)->Result<(),Error>{
            guard()?;if unsafe{WaitForSingleObject(self.handle.0,0)}!=WAIT_TIMEOUT{return Err(unavailable());}
            if creation(self.handle.0)?!=self.creation{return Err(unavailable());}guard()?;
            if !process_path(self.handle.0)?.eq_ignore_ascii_case(&self.path){return Err(unavailable());}guard()?;
            // Retain the actual held kernel incarnation AND exact executable bytes.
            if image_fingerprint(&self.path,guard)?!=self.fingerprint{return Err(unavailable());}guard()
        }
    }
    struct ProcessCensus {owned:BTreeSet<u32>,parents:BTreeMap<u32,u32>}
    fn process_inventory(root:u32,guard:&dyn Fn()->Result<(),Error>)->Result<ProcessCensus,Error>{
        guard()?;let raw=unsafe{CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS,0)};
        if raw==INVALID_HANDLE_VALUE{return Err(unavailable());}let snapshot=Handle(raw);guard()?;
        let mut entry=PROCESSENTRY32W::default();entry.dwSize=std::mem::size_of::<PROCESSENTRY32W>() as u32;
        let mut rows=Vec::new();let mut success=unsafe{Process32FirstW(snapshot.0,&mut entry)};let mut terminal_error=0;
        if success==0{return Err(unavailable());}
        while success!=0{if rows.len()>=4096{return Err(unavailable());}rows.push((entry.th32ProcessID,entry.th32ParentProcessID));
            success=unsafe{Process32NextW(snapshot.0,&mut entry)};
            if success==0{terminal_error=unsafe{windows_sys::Win32::Foundation::GetLastError()};}guard()?;}
        if terminal_error!=windows_sys::Win32::Foundation::ERROR_NO_MORE_FILES{return Err(unavailable());}
        let mut owned=BTreeSet::from([root]);loop{let before=owned.len();for &(pid,parent) in &rows{if owned.contains(&parent){owned.insert(pid);}}
            if owned.len()>32{return Err(unavailable());}if before==owned.len(){break;}}
        if !rows.iter().any(|row|row.0==root){return Err(unavailable());}
        let parents:BTreeMap<_,_>=rows.iter().filter(|(pid,_)|owned.contains(pid)).copied().collect();
        if parents.len()!=owned.len(){return Err(unavailable());}guard()?;Ok(ProcessCensus{owned,parents})
    }
    struct WindowCensus {root_pid:u32,roots:Vec<isize>,nodes:Vec<WindowFact>,allowed:BTreeSet<u32>,root:isize,failed:bool}
    unsafe extern "system" fn roots(hwnd:HWND,data:isize)->i32{
        let state=unsafe{&mut *(data as *mut WindowCensus)};let mut pid=0;unsafe{GetWindowThreadProcessId(hwnd,&mut pid);}
        if state.allowed.contains(&pid) && unsafe{IsWindowVisible(hwnd)}!=0 {
            if pid!=state.root_pid || !unsafe{GetWindow(hwnd,GW_OWNER)}.is_null(){state.failed=true;return 0;}
            if state.roots.len()>=2{state.failed=true;return 0;}state.roots.push(hwnd as isize);}
        1
    }
    unsafe extern "system" fn children(hwnd:HWND,data:isize)->i32{
        let state=unsafe{&mut *(data as *mut WindowCensus)};let mut pid=0;unsafe{GetWindowThreadProcessId(hwnd,&mut pid);}
        if state.nodes.len()>=32||!state.allowed.contains(&pid)||unsafe{GetAncestor(hwnd,GA_ROOT)} as isize!=state.root{state.failed=true;return 0;}
        let parent=unsafe{windows_sys::Win32::UI::WindowsAndMessaging::GetParent(hwnd)} as isize;
        state.nodes.push(WindowFact{hwnd:hwnd as isize,pid,parent});1
    }
    fn windows(root_pid:u32,allowed:&BTreeSet<u32>,guard:&dyn Fn()->Result<(),Error>)->Result<(isize,Vec<WindowFact>),Error>{
        let mut state=WindowCensus{root_pid,roots:Vec::new(),nodes:Vec::new(),allowed:allowed.clone(),root:0,failed:false};
        guard()?;if unsafe{EnumWindows(Some(roots),&mut state as *mut _ as isize)}==0||state.failed||state.roots.len()!=1{return Err(unavailable());}guard()?;
        state.root=state.roots[0];state.nodes.push(WindowFact{hwnd:state.root,pid:root_pid,parent:0});
        // EnumChildWindows ignores the callback return as its BOOL result. The
        // callback's explicit failure latch and completed bounded inventory rule.
        unsafe{EnumChildWindows(state.root as HWND,Some(children),&mut state as *mut _ as isize);}
        guard()?;if state.failed{return Err(unavailable());}state.nodes.sort_by_key(|n|n.hwnd);Ok((state.root,state.nodes))
    }
    fn viewport(root:isize,source:&TrustedLaunch,guard:&dyn Fn()->Result<(),Error>)->Result<Viewport,Error>{
        guard()?;if source.dpr!=1.0||source.visual_scale!=1.0||source.css_width==0||source.css_height==0
            ||unsafe{GetSystemMetrics(SM_CMONITORS)}!=1||unsafe{GetAwarenessFromDpiAwarenessContext(GetThreadDpiAwarenessContext())}!=DPI_AWARENESS_PER_MONITOR_AWARE{return Err(unavailable());}
        let hwnd=root as HWND;let dpi=unsafe{GetDpiForWindow(hwnd)};guard()?;if dpi!=96{return Err(unavailable());}
        let mut client=RECT::default();if unsafe{GetClientRect(hwnd,&mut client)}==0{return Err(unavailable());}guard()?;
        let mut origin=POINT{x:client.left,y:client.top};let mut end=POINT{x:client.right,y:client.bottom};
        if unsafe{ClientToScreen(hwnd,&mut origin)}==0||unsafe{ClientToScreen(hwnd,&mut end)}==0{return Err(unavailable());}guard()?;
        let allowed=process_inventory(source.root_pid,guard)?.owned;
        let document=document_geometry(root,&allowed,guard)?;
        let (left,top,right,bottom)=document.bounds;
        if left<origin.x||top<origin.y||right>end.x||bottom>end.y{return Err(unavailable());}
        let width=right.checked_sub(left).filter(|v|*v>0).ok_or_else(unavailable)? as u32;
        let height=bottom.checked_sub(top).filter(|v|*v>0).ok_or_else(unavailable)? as u32;
        // Geometry comes from the unique native Document under held HWND/UIA
        // ancestry, never a guessed browser chrome height or a DOM-to-UIA cast.
        if width!=source.css_width||height!=source.css_height{return Err(unavailable());}
        let monitor=unsafe{MonitorFromWindow(hwnd,MONITOR_DEFAULTTONULL)};if monitor.is_null(){return Err(unavailable());}
        let mut info=MONITORINFO::default();info.cbSize=std::mem::size_of::<MONITORINFO>() as u32;
        if unsafe{GetMonitorInfoW(monitor,&mut info)}==0{return Err(unavailable());}guard()?;
        let mut frame=RECT::default();if unsafe{GetWindowRect(hwnd,&mut frame)}==0{return Err(unavailable());}guard()?;
        let m=info.rcMonitor;if frame.left<m.left||frame.top<m.top||frame.right>m.right||frame.bottom>m.bottom{return Err(unavailable());}
        Ok(Viewport{root,origin:(left,top),size:(width,height),dpi,monitor:(m.left,m.top,m.right,m.bottom),document})
    }
    impl HeldLaunch {
        fn open(source:&TrustedLaunch,guard:&dyn Fn()->Result<(),Error>,recheck_original_source:&dyn Fn()->Result<(),Error>)->Result<Self,Error>{
            let census=process_inventory(source.root_pid,guard)?;let expected=census.owned;
            if expected.is_empty()||expected.len()>32{return Err(unavailable());}
            let mut processes=vec![Arc::new(HeldProcess::open(source.root_pid,&source.path,&source.fingerprint,guard)?)];
            for pid in &expected{if *pid!=source.root_pid{processes.push(Arc::new(HeldProcess::open(*pid,&source.path,&source.fingerprint,guard)?));}}
            let creations:BTreeMap<_,_>=processes.iter().map(|p|(p.pid,p.creation)).collect();
            for (&pid,&parent) in &census.parents{if pid!=source.root_pid{
                let parent_creation=creations.get(&parent).ok_or_else(unavailable)?;
                if creations.get(&pid).ok_or_else(unavailable)?<parent_creation{return Err(unavailable());}
            }}
            let (root,windows)=windows(source.root_pid,&expected,guard)?;let viewport=viewport(root,source,guard)?;
            let held=Self{processes,parents:census.parents,root,windows,viewport};held.revalidate(source,guard)?;
            // This callback must finish a genuine source-issuer reread proving
            // the same live held ChildProcess/launch epoch, not a DTO boolean.
            // Controller admission requires the frozen authentic source join.
            recheck_original_source()?;held.revalidate(source,guard)?;Ok(held)
        }
        fn revalidate(&self,source:&TrustedLaunch,guard:&dyn Fn()->Result<(),Error>)->Result<(),Error>{
            for p in &self.processes{p.revalidate(guard)?;}
            let expected:BTreeSet<_>=self.processes.iter().map(|p|p.pid).collect();
            let census=process_inventory(source.root_pid,guard)?;
            if census.owned!=expected||census.parents!=self.parents{return Err(unavailable());}
            let (root,windows)=windows(source.root_pid,&expected,guard)?;
            if root!=self.root||windows!=self.windows||viewport(root,source,guard)?!=self.viewport{return Err(unavailable());}guard()
        }
    }
    struct Apartment;
    impl Apartment {fn new()->Result<Self,Error>{unsafe{CoInitializeEx(None,COINIT_MULTITHREADED).ok().map_err(|_|unavailable())?;}Ok(Self)}}
    impl Drop for Apartment {fn drop(&mut self){unsafe{CoUninitialize();}}}
    struct Runtime(*mut SAFEARRAY);
    impl Drop for Runtime {fn drop(&mut self){unsafe{let _=SafeArrayDestroy(self.0);}}}
    fn runtime(element:&IUIAutomationElement)->Result<Vec<i32>,Error>{unsafe{
        let runtime=Runtime(api(element.GetRuntimeId())?);if runtime.0.is_null()||SafeArrayGetDim(runtime.0)!=1||SafeArrayGetElemsize(runtime.0)!=4{return Err(unavailable());}
        let low=api(SafeArrayGetLBound(runtime.0,1))?;let high=api(SafeArrayGetUBound(runtime.0,1))?;
        if high<low||i64::from(high)-i64::from(low)>=32{return Err(unavailable());}let mut values=Vec::new();
        for i in low..=high{let mut value=0i32;api(SafeArrayGetElement(runtime.0,&i,&mut value as *mut _ as *mut core::ffi::c_void))?;values.push(value);}Ok(values)
    }}
    fn optional(value:windows::core::Result<IUIAutomationElement>)->Result<Option<IUIAutomationElement>,Error>{match value{
        Ok(e)=>Ok(Some(e)),Err(e) if e.code()==windows::core::Error::empty().code()=>Ok(None),Err(_)=>Err(unavailable())}}
    #[derive(Clone,PartialEq,Eq)]
    struct DocumentGeometry {bounds:(i32,i32,i32,i32),runtime:Vec<i32>,ancestry:Vec<Vec<i32>>,content_hwnd:isize,content_pid:u32}
    fn document_geometry(root_hwnd:isize,allowed:&BTreeSet<u32>,guard:&dyn Fn()->Result<(),Error>)->Result<DocumentGeometry,Error>{
        let _apartment=Apartment::new()?;guard()?;
        let automation:IUIAutomation=api(unsafe{CoCreateInstance(&CUIAutomation,None,CLSCTX_INPROC_SERVER)})?;
        let root=api(unsafe{automation.ElementFromHandle(ComHwnd(root_hwnd as *mut core::ffi::c_void))})?;guard()?;
        let walker=api(unsafe{automation.RawViewWalker()})?;let mut all=vec![root.clone()];let mut docs=Vec::new();let mut index=0;
        while index<all.len(){let parent=all[index].clone();index+=1;
            let pid=api(unsafe{parent.CurrentProcessId()})?;if pid<=0||!allowed.contains(&(pid as u32)){return Err(unavailable());}
            if api(unsafe{parent.CurrentControlType()})?.0==50030{docs.push(parent.clone());}
            let mut child=optional(unsafe{walker.GetFirstChildElement(&parent)})?;guard()?;
            while let Some(element)=child{if all.len()>=512{return Err(unavailable());}
                child=optional(unsafe{walker.GetNextSiblingElement(&element)})?;guard()?;all.push(element);}
        }
        if docs.len()!=1||api(unsafe{docs[0].CurrentIsOffscreen()})?.as_bool(){return Err(unavailable());}
        let rect=api(unsafe{docs[0].CurrentBoundingRectangle()})?;guard()?;
        let mut ancestor=docs[0].clone();let mut ancestry=Vec::new();let mut content=None;let mut reached=false;
        for _ in 0..32{let pid=api(unsafe{ancestor.CurrentProcessId()})?;
            if pid<=0||!allowed.contains(&(pid as u32)){return Err(unavailable());}ancestry.push(runtime(&ancestor)?);guard()?;
            let hwnd=api(unsafe{ancestor.CurrentNativeWindowHandle()})?.0 as isize;guard()?;
            if hwnd!=0&&hwnd!=root_hwnd&&content.is_none(){
                let mut actual_pid=0;unsafe{GetWindowThreadProcessId(hwnd as HWND,&mut actual_pid);}
                if actual_pid!=pid as u32||unsafe{IsWindow(hwnd as HWND)}==0||unsafe{GetAncestor(hwnd as HWND,GA_ROOT)} as isize!=root_hwnd{return Err(unavailable());}
                content=Some((hwnd,actual_pid));guard()?;}
            if api(unsafe{automation.CompareElements(&ancestor,&root)})?.as_bool(){reached=true;break;}
            ancestor=optional(unsafe{walker.GetParentElement(&ancestor)})?.ok_or_else(unavailable)?;guard()?;
        }
        let (content_hwnd,content_pid)=content.ok_or_else(unavailable)?;
        if !reached{return Err(unavailable());}
        Ok(DocumentGeometry{bounds:(rect.left,rect.top,rect.right,rect.bottom),runtime:runtime(&docs[0])?,ancestry,content_hwnd,content_pid})
    }
    struct NativeHit {thread_bound:std::marker::PhantomData<std::rc::Rc<()>>,element:IUIAutomationElement,
        candidates:Vec<IUIAutomationElement>,runtime:Vec<i32>,ancestry:Vec<Vec<i32>>,document:Vec<i32>,point:(i32,i32),apartment:Apartment}
    struct PhysicalPoint {x:i32,y:i32}
    fn css_point(viewport:&Viewport,css:(f64,f64),rect:(f64,f64,f64,f64),profile:NativeTargetProfile)->Result<PhysicalPoint,Error>{
        let (x,y)=css;let (left,top,width,height)=rect;
        if !native_css_point_allowed(viewport.size.0,viewport.size.1,css,rect,profile==NativeTargetProfile::Scroll){return Err(unavailable());}
        let px=f64::from(viewport.origin.0)+x;let py=f64::from(viewport.origin.1)+y;
        if px<f64::from(i32::MIN)||px>f64::from(i32::MAX)||py<f64::from(i32::MIN)||py>f64::from(i32::MAX){return Err(unavailable());}
        Ok(PhysicalPoint{x:px.floor() as i32,y:py.floor() as i32})
    }
    fn inspect_hit(held:&HeldLaunch,point:(i32,i32),guard:&dyn Fn()->Result<(),Error>)->Result<NativeHit,Error>{
        let apartment=Apartment::new()?;guard()?;
        let automation:IUIAutomation=api(unsafe{CoCreateInstance(&CUIAutomation,None,CLSCTX_INPROC_SERVER)})?;
        let root=api(unsafe{automation.ElementFromHandle(ComHwnd(held.root as *mut core::ffi::c_void))})?;guard()?;
        let walker=api(unsafe{automation.RawViewWalker()})?;
        let allowed:BTreeSet<_>=held.processes.iter().map(|p|p.pid).collect();let mut all=vec![root.clone()];let mut docs=Vec::new();let mut index=0;
        while index<all.len(){let parent=all[index].clone();index+=1;
            if api(unsafe{parent.CurrentControlType()})?.0==50030{docs.push(parent.clone());}
            let mut child=optional(unsafe{walker.GetFirstChildElement(&parent)})?;guard()?;
            while let Some(element)=child{let pid=api(unsafe{element.CurrentProcessId()})?;
                if pid<=0||!allowed.contains(&(pid as u32))||all.len()>=512{return Err(unavailable());}
                child=optional(unsafe{walker.GetNextSiblingElement(&element)})?;guard()?;all.push(element);}
        }
        if docs.len()!=1{return Err(unavailable());}
        let hit=api(unsafe{automation.ElementFromPoint(ComPoint{x:point.0,y:point.1})})?;guard()?;
        let mut ancestor=hit.clone();let mut ancestry=Vec::new();let mut in_document=false;let mut reached_root=false;
        for _ in 0..32{let pid=api(unsafe{ancestor.CurrentProcessId()})?;guard()?;
            if pid<=0||!allowed.contains(&(pid as u32)){return Err(unavailable());}ancestry.push(runtime(&ancestor)?);guard()?;
            if api(unsafe{automation.CompareElements(&ancestor,&docs[0])})?.as_bool(){in_document=true;}
            if api(unsafe{automation.CompareElements(&ancestor,&root)})?.as_bool(){reached_root=true;break;}
            ancestor=optional(unsafe{walker.GetParentElement(&ancestor)})?.ok_or_else(unavailable)?;guard()?;
        }
        if !in_document||!reached_root{return Err(unavailable());}
        let mut candidates=Vec::new();
        for element in &all {if !matches!(api(unsafe{element.CurrentControlType()})?.0,50004|50005|50026|50033){guard()?;continue;}guard()?;
            let mut ancestor=element.clone();let mut within=false;
            for _ in 0..32 {if api(unsafe{automation.CompareElements(&ancestor,&docs[0])})?.as_bool(){within=true;guard()?;break;}guard()?;
                if api(unsafe{automation.CompareElements(&ancestor,&root)})?.as_bool(){guard()?;break;}guard()?;
                let Some(parent)=optional(unsafe{walker.GetParentElement(&ancestor)})?else{break;};ancestor=parent;guard()?;}
            if within{if candidates.len()>=32{return Err(unavailable());}candidates.push(element.clone());}
        }
        let record=NativeHit{apartment,thread_bound:std::marker::PhantomData,runtime:runtime(&hit)?,element:hit,candidates,ancestry,document:runtime(&docs[0])?,point};guard()?;Ok(record)
    }
    // A hit alone is not a DOM/native target binding. No control name, nearby
    // label, equal rectangle, document ancestor or DOM node ID issues that proof.
    fn bind_dom_target(hit:&NativeHit,rect:(i32,i32,i32,i32),tag:&str,kind:&str,writable:bool,guard:&dyn Fn()->Result<(),Error>)->Result<(),Error>{
        use windows::Win32::UI::Accessibility::{IUIAutomationValuePattern,IUIAutomationInvokePattern,IUIAutomationScrollPattern,UIA_ValuePatternId,UIA_InvokePatternId,UIA_ScrollPatternId};
        // Explicit Edit/Hyperlink/Scroll provider profiles. Source DOM aliases are not compared
        // to UIA IDs. The native control must independently expose exact edit
        // semantics and exact physical rectangle at the source-proved point.
        let profile=native_target_profile(tag,kind,writable).ok_or_else(unavailable)?;
        let control=api(unsafe{hit.element.CurrentControlType()})?.0;guard()?;
        if !native_profile_control(profile,control){return Err(unavailable());}
        let bounds=api(unsafe{hit.element.CurrentBoundingRectangle()})?;guard()?;
        if (bounds.left,bounds.top,bounds.right,bounds.bottom)!=rect||api(unsafe{hit.element.CurrentIsPassword()})?.as_bool()
            ||!api(unsafe{hit.element.CurrentIsEnabled()})?.as_bool(){return Err(unavailable());}guard()?;
        match profile{
            NativeTargetProfile::Edit=>{if !api(unsafe{hit.element.CurrentIsKeyboardFocusable()})?.as_bool(){return Err(unavailable());}guard()?;
                let value:IUIAutomationValuePattern=api(unsafe{hit.element.GetCurrentPatternAs(UIA_ValuePatternId)})?;guard()?;
                if api(unsafe{value.CurrentIsReadOnly()})?.as_bool(){return Err(unavailable());}guard()?;},
            NativeTargetProfile::Anchor=>{let _:IUIAutomationInvokePattern=api(unsafe{hit.element.GetCurrentPatternAs(UIA_InvokePatternId)})?;guard()?;},
            NativeTargetProfile::Scroll=>{let scroll:IUIAutomationScrollPattern=api(unsafe{hit.element.GetCurrentPatternAs(UIA_ScrollPatternId)})?;guard()?;
                if !api(unsafe{scroll.CurrentVerticallyScrollable()})?.as_bool(){return Err(unavailable());}guard()?;
                let automation:IUIAutomation=api(unsafe{CoCreateInstance(&CUIAutomation,None,CLSCTX_INPROC_SERVER)})?;guard()?;
                let walker=api(unsafe{automation.RawViewWalker()})?;guard()?;
                let mut ancestor=hit.element.clone();let mut scroll_ancestors=0;let mut reached_document=false;
                for _ in 0..32{
                    let pattern=unsafe{ancestor.GetCurrentPatternAs::<IUIAutomationScrollPattern>(UIA_ScrollPatternId)};guard()?;
                    match pattern{Ok(pattern)=>{if api(unsafe{pattern.CurrentVerticallyScrollable()})?.as_bool(){scroll_ancestors+=1;}guard()?;},
                        Err(error) if matches!(error.code().0 as u32,0x80004002|0x80040204)=>{},Err(_)=>return Err(unavailable())}
                    if runtime(&ancestor)?==hit.document{reached_document=true;break;}guard()?;
                    ancestor=optional(unsafe{walker.GetParentElement(&ancestor)})?.ok_or_else(unavailable)?;guard()?;
                }
                if !native_scroll_ancestry_unique(scroll_ancestors,reached_document){return Err(unavailable());}
            },
        }
        let automation:IUIAutomation=api(unsafe{CoCreateInstance(&CUIAutomation,None,CLSCTX_INPROC_SERVER)})?;
        let mut matched=0;let mut same=false;
        for candidate in &hit.candidates {let candidate_control=api(unsafe{candidate.CurrentControlType()})?.0;guard()?;
            if if profile==NativeTargetProfile::Scroll{!native_profile_control(profile,candidate_control)}else{candidate_control!=control}{continue;}
            let bounds=api(unsafe{candidate.CurrentBoundingRectangle()})?;guard()?;
            if (bounds.left,bounds.top,bounds.right,bounds.bottom)==rect{
                matched+=1;same|=api(unsafe{automation.CompareElements(candidate,&hit.element)})?.as_bool();guard()?;
            }}
        if !native_exact_hit_cardinality(matched,same){return Err(unavailable());}guard()
    }
    fn validate_hit(held:&HeldLaunch,source:&TrustedLaunch,retained:&NativeHit,require_focus:bool,
        guard:&dyn Fn()->Result<(),Error>)->Result<(),Error>{
        held.revalidate(source,guard)?;guard()?;
        if unsafe{GetForegroundWindow()} as isize!=held.root{return Err(unavailable());}guard()?;
        let point=POINT{x:retained.point.0,y:retained.point.1};
        let hit_hwnd=unsafe{windows_sys::Win32::UI::WindowsAndMessaging::WindowFromPoint(point)};
        if hit_hwnd.is_null()||unsafe{GetAncestor(hit_hwnd,GA_ROOT)} as isize!=held.root
            ||!held.windows.iter().any(|fact|fact.hwnd==hit_hwnd as isize){return Err(unavailable());}guard()?;
        let fresh=inspect_hit(held,retained.point,guard)?;
        if fresh.runtime!=retained.runtime||fresh.ancestry!=retained.ancestry||fresh.document!=retained.document{return Err(unavailable());}
        let automation:IUIAutomation=api(unsafe{CoCreateInstance(&CUIAutomation,None,CLSCTX_INPROC_SERVER)})?;guard()?;
        if !api(unsafe{automation.CompareElements(&fresh.element,&retained.element)})?.as_bool(){return Err(unavailable());}guard()?;
        if require_focus {
            let focused=api(unsafe{automation.GetFocusedElement()})?;guard()?;
            if !api(unsafe{automation.CompareElements(&focused,&retained.element)})?.as_bool()
                ||!api(unsafe{retained.element.CurrentHasKeyboardFocus()})?.as_bool(){return Err(unavailable());}guard()?;
        }
        held.revalidate(source,guard)?;guard()
    }
    struct FocusAction {before:isize,after:isize,api_bool:Option<i32>,possible_effect:bool,after_current:bool,before_at:u64,after_at:u64}
    struct FocusLease {consumed:AtomicBool,possible_effect:AtomicBool,expires:u64}
    fn focus_once(lease:&FocusLease,held:&HeldLaunch,source:&TrustedLaunch,managed:isize,guard:&dyn Fn()->Result<(),Error>,now:&dyn Fn()->u64)->Result<FocusAction,Error>{
        if lease.consumed.load(Ordering::SeqCst)||now()>=lease.expires{return Err(unavailable());}
        held.revalidate(source,guard)?;guard()?;let before=unsafe{GetForegroundWindow()} as isize;guard()?;
        let before_at=now();
        if before!=held.root&&before!=managed{return Err(unavailable());}
        // This private primitive has no issuer/caller until the one-use source
        // challenge is locally retained/consumed and all HTTP has completed.
        if before==held.root{
            let current=held.revalidate(source,guard).is_ok()&&guard().is_ok()&&now()<lease.expires;
            if !current||lease.consumed.compare_exchange(false,true,Ordering::SeqCst,Ordering::SeqCst).is_err(){return Err(unavailable());}
            let after=unsafe{GetForegroundWindow()} as isize;
            let after_guard=guard();let after_at=now();
            return Ok(FocusAction{before,after,api_bool:None,possible_effect:false,after_current:current&&after==held.root&&after_guard.is_ok()&&after_at>=before_at&&after_at<lease.expires,before_at,after_at});}
        guard()?;if now()>=lease.expires{return Err(unavailable());}let mut action=FocusAction{before,after:0,api_bool:None,possible_effect:true,after_current:false,before_at,after_at:0};
        if lease.consumed.compare_exchange(false,true,Ordering::SeqCst,Ordering::SeqCst).is_err(){return Err(unavailable());}
        lease.possible_effect.store(true,Ordering::SeqCst);
        action.api_bool=Some(unsafe{SetForegroundWindow(held.root as HWND)});
        let after_guard=guard();action.after=unsafe{GetForegroundWindow()} as isize;
        let current=action.api_bool.is_some_and(|value|value!=0)&&action.after==held.root&&after_guard.is_ok()&&held.revalidate(source,guard).is_ok()&&guard().is_ok();
        action.after_at=now();
        action.after_current=current&&action.after_at>=action.before_at&&action.after_at<lease.expires;
        Ok(action) // Actual BOOL retained; caller must reject false/late/mismatch.
    }
    pub(super) struct NativeSession {held:HeldLaunch,anchor:RootAnchor,source:TrustedLaunch,focus:FocusLease,kernel_ref:String,root_ref:String,content_ref:String,document_ref:String}
    pub(super) struct MeasuredMap {point:(i32,i32),rect:(i32,i32,i32,i32),runtime:Vec<i32>,ancestry:Vec<Vec<i32>>,document:Vec<i32>,tag:String,kind:String,writable:bool,parts:serde_json::Value,retired:AtomicBool}
    pub(super) struct SuccessorObservation{held:HeldLaunch,source:TrustedLaunch,document_ref:String,content_ref:String}
    fn nonce()->Result<String,Error>{let mut bytes=[0u8;32];getrandom::fill(&mut bytes).map_err(|_|unavailable())?;Ok(bytes.iter().map(|b|format!("{b:02x}")).collect())}
    fn hash(value:&serde_json::Value)->Result<String,Error>{Ok(format!("{:x}",Sha256::digest(serde_json::to_vec(value).map_err(|_|unavailable())?)))}
    impl NativeSession {
        #[allow(clippy::too_many_arguments)]
        pub(super) fn capture(pid:u32,path:String,fingerprint:String,width:u32,height:u32,dpr:f64,scale:f64,focus_expires:u64,
            guard:&dyn Fn()->Result<(),Error>,recheck:&dyn Fn()->Result<(),Error>)->Result<Self,Error>{
            let source=TrustedLaunch{root_pid:pid,path,fingerprint,css_width:width,css_height:height,dpr,visual_scale:scale};
            let held=HeldLaunch::open(&source,guard,recheck)?;
            let anchor=RootAnchor::capture(&held,pid,guard)?;
            Ok(Self{held,anchor,source,focus:FocusLease{consumed:AtomicBool::new(false),possible_effect:AtomicBool::new(false),expires:focus_expires},
                kernel_ref:nonce()?,root_ref:nonce()?,content_ref:nonce()?,document_ref:nonce()?})
        }
        pub(super) fn revalidate(&self,guard:&dyn Fn()->Result<(),Error>)->Result<(),Error>{self.held.revalidate(&self.source,guard)}
        pub(super) fn validate_root(&self,guard:&dyn Fn()->Result<(),Error>)->Result<(),Error>{self.anchor.revalidate(guard)}
        pub(super) fn observe_successor(&self,width:u32,height:u32,dpr:f64,scale:f64,map:&MeasuredMap,guard:&dyn Fn()->Result<(),Error>)->Result<SuccessorObservation,Error>{
            if !map.retired.load(Ordering::SeqCst){return Err(unavailable());}
            let source=TrustedLaunch{root_pid:self.source.root_pid,path:self.source.path.clone(),fingerprint:self.source.fingerprint.clone(),css_width:width,css_height:height,dpr,visual_scale:scale};
            let held=self.anchor.current_document(&source,guard)?;
            // A provider may retain its UIA Document object across navigation.
            // This is a NEW measured observation/private alias under the same
            // root, never the retired target/map. The authenticated source's
            // original-frame/new-loader relation independently owns DOM life.
            Ok(SuccessorObservation{held,source,document_ref:nonce()?,content_ref:nonce()?})
        }
        pub(super) fn focus(&self,managed:isize,guard:&dyn Fn()->Result<(),Error>,now:&dyn Fn()->u64)->Result<serde_json::Value,Error>{
            let root=self.held.processes.iter().find(|p|p.pid==self.source.root_pid).ok_or_else(unavailable)?;
            let initial=environment(root,self.held.root,managed,guard)?;
            let focused_guard=||{guard()?;let fresh=environment(root,self.held.root,managed,guard)?;if fresh!=initial{return Err(unavailable());}guard()};
            let record=focus_once(&self.focus,&self.held,&self.source,managed,&focused_guard,now)?;
            Ok(serde_json::json!({"kind":if record.possible_effect{"set-original-foreground"}else{"already-foreground"},
                "beforeForeground":if record.before==self.held.root{"original-chrome"}else{"managed-edith"},
                "afterForeground":if record.after==self.held.root{"original-chrome"}else if record.after==0{"unknown"}else{"other"},
                "measuredBeforeAtMs":record.before_at,"measuredAfterAtMs":record.after_at,"possibleEffect":record.possible_effect,
                "afterGuardsCurrent":record.after_current,"rootAssociationCurrent":record.after_current,"apiBool":record.api_bool}))
        }
        pub(super) fn possible_focus(&self)->bool{self.focus.possible_effect.load(Ordering::SeqCst)}
        pub(super) fn effect_environment(&self,guard:&dyn Fn()->Result<(),Error>)->Result<(),Error>{
            let root=self.held.processes.iter().find(|p|p.pid==self.source.root_pid).ok_or_else(unavailable)?;
            let before=environment(root,self.held.root,self.held.root,guard)?;
            root.revalidate(guard)?;
            let after=environment(root,self.held.root,self.held.root,guard)?;
            if !native_environment_stable(&before,&after){return Err(unavailable());}guard()
        }
        pub(super) fn measure(&self,point:(f64,f64),rect:(f64,f64,f64,f64),tag:&str,kind:&str,writable:bool,
            guard:&dyn Fn()->Result<(),Error>)->Result<MeasuredMap,Error>{
            self.revalidate(guard)?;if [rect.0,rect.1,rect.2,rect.3].iter().any(|n|n.fract()!=0.0){return Err(unavailable());}
            let profile=native_target_profile(tag,kind,writable).ok_or_else(unavailable)?;
            let physical=css_point(&self.held.viewport,point,rect,profile)?;
            let left=self.held.viewport.origin.0.checked_add(rect.0 as i32).ok_or_else(unavailable)?;
            let top=self.held.viewport.origin.1.checked_add(rect.1 as i32).ok_or_else(unavailable)?;
            let bounds=(left,top,left.checked_add(rect.2 as i32).ok_or_else(unavailable)?,top.checked_add(rect.3 as i32).ok_or_else(unavailable)?);
            let hit=inspect_hit(&self.held,(physical.x,physical.y),guard)?;bind_dom_target(&hit,bounds,tag,kind,writable,guard)?;
            // Require exactly one native eligible edit at these exact bounds in
            // the complete document inventory; a hit or nearest rectangle alone
            // does not establish a unique target.
            let geometry=document_geometry(self.held.root,&self.held.processes.iter().map(|p|p.pid).collect(),guard)?;
            if geometry!=self.held.viewport.document{return Err(unavailable());}
            let root=self.held.processes.iter().find(|p|p.pid==self.source.root_pid).ok_or_else(unavailable)?;
            let inventory=serde_json::json!({"processes":self.held.processes.iter().map(|p|serde_json::json!({"pid":p.pid,"creation":p.creation.to_string(),"path":p.path,"sha256":p.fingerprint})).collect::<Vec<_>>(),
                "parents":self.held.parents,"windows":self.held.windows.iter().map(|w|serde_json::json!([w.hwnd,w.pid,w.parent])).collect::<Vec<_>>(),"documentRuntime":geometry.runtime,"documentAncestry":geometry.ancestry});
            let parts=serde_json::json!({"kernelCreation":root.creation.to_string(),"executableFingerprint":root.fingerprint,"kernelIdentityRef":self.kernel_ref,
                "rootIdentityRef":self.root_ref,"contentIdentityRef":self.content_ref,"logicalDocumentRef":self.document_ref,
                "logicalAncestryDigest":hash(&serde_json::json!(hit.ancestry))?,"logicalRuntimeIdDigest":hash(&serde_json::json!(hit.runtime))?,
                "nativeInventoryDigest":hash(&inventory)?,"transform":{"originPhysicalX":self.held.viewport.origin.0,"originPhysicalY":self.held.viewport.origin.1,
                    "widthPhysical":self.held.viewport.size.0,"heightPhysical":self.held.viewport.size.1,"dpi":96,"dpr":1,"visualScale":1},
                "nativeHitTargetRef":nonce()?,"nativeHitProofDigest":hash(&serde_json::json!({"runtime":hit.runtime,"ancestry":hit.ancestry,"point":[physical.x,physical.y],"bounds":[bounds.0,bounds.1,bounds.2,bounds.3]}))?});
            let record=MeasuredMap{point:(physical.x,physical.y),rect:bounds,runtime:hit.runtime.clone(),ancestry:hit.ancestry.clone(),document:hit.document.clone(),tag:tag.into(),kind:kind.into(),writable,parts,retired:AtomicBool::new(false)};
            self.validate_map(&record,false,guard)?;Ok(record)
        }
        pub(super) fn validate_map(&self,record:&MeasuredMap,focus:bool,guard:&dyn Fn()->Result<(),Error>)->Result<(),Error>{
            if record.retired.load(Ordering::SeqCst){return Err(unavailable());}
            let hit=inspect_hit(&self.held,record.point,guard)?;
            if hit.runtime!=record.runtime||hit.ancestry!=record.ancestry||hit.document!=record.document{return Err(unavailable());}
            bind_dom_target(&hit,record.rect,&record.tag,&record.kind,record.writable,guard)?;
            validate_hit(&self.held,&self.source,&hit,focus,guard)
        }
    }
    impl MeasuredMap {pub(super) fn parts(&self)->serde_json::Value{self.parts.clone()}pub(super) fn point(&self)->(i32,i32){self.point}
        pub(super) fn retire(&self){self.retired.store(true,Ordering::SeqCst);}pub(super) fn retired(&self)->bool{self.retired.load(Ordering::SeqCst)}}
    impl SuccessorObservation{pub(super) fn revalidate(&self,original:&NativeSession,guard:&dyn Fn()->Result<(),Error>)->Result<(),Error>{
        original.validate_root(guard)?;self.held.revalidate(&self.source,guard)?;guard()}
        pub(super) fn private_native_refs(&self)->(&str,&str){(&self.document_ref,&self.content_ref)}}
}

const MAX_OPERATIONS: usize = 256;
const MAX_BOOT_SLOTS: usize = 8192;
const MAX_RECORDS: usize = 32;
const MAX_BATCHES: usize = 10;
const MAX_EVENTS: u32 = 20_400;
const MAX_UTF16: u32 = 10_000;
const MAX_CLEANUP: usize = 40;
const OPERATION_MS: u64 = 30_000;
const PERMIT_MS: u64 = 1_000;

#[derive(Clone,PartialEq,Eq)]
struct NativeRootIdentity{pid:u32,creation:u64,hwnd:isize,runtime:Vec<i32>,path:String,fingerprint:String}
fn native_root_identity_matches(retained:&NativeRootIdentity,current:&NativeRootIdentity)->bool{
    retained.pid!=0&&retained.creation!=0&&retained.hwnd!=0&&!retained.runtime.is_empty()&&retained.pid==current.pid&&retained.creation==current.creation
        &&retained.hwnd==current.hwnd&&retained.runtime==current.runtime&&retained.path.eq_ignore_ascii_case(&current.path)&&retained.fingerprint==current.fingerprint
}
fn native_retirement_can_follow_exact_input(navigation:bool,requested:u32,returned:Option<u32>,chunks_remaining:usize)->bool{
    navigation&&requested>0&&returned==Some(requested)&&chunks_remaining==0
}

#[derive(Clone,Copy,PartialEq,Eq)]
enum NativeTargetProfile{Edit,Anchor,Scroll}
fn native_target_profile(tag:&str,kind:&str,writable:bool)->Option<NativeTargetProfile>{
    if tag.eq_ignore_ascii_case("input")&&matches!(kind,"text"|"search")&&writable{Some(NativeTargetProfile::Edit)}
    else if tag.eq_ignore_ascii_case("a")&&kind=="a"&&!writable{Some(NativeTargetProfile::Anchor)}
    else if kind=="scroll-surface"&&!writable&&!tag.is_empty()&&tag.bytes().all(|b|b.is_ascii_alphabetic()||b==b'-'){Some(NativeTargetProfile::Scroll)}else{None}
}
fn native_profile_control(profile:NativeTargetProfile,control:i32)->bool{match profile{
    NativeTargetProfile::Edit=>control==50004,NativeTargetProfile::Anchor=>control==50005,
    NativeTargetProfile::Scroll=>matches!(control,50026|50033)}}
fn native_exact_hit_cardinality(count:usize,actual_same:bool)->bool{count==1&&actual_same}
fn native_scroll_ancestry_unique(vertical_scroll_ancestors:usize,reached_original_document:bool)->bool{vertical_scroll_ancestors==1&&reached_original_document}
fn native_css_point_allowed(width:u32,height:u32,point:(f64,f64),rect:(f64,f64,f64,f64),full_rect_can_extend:bool)->bool{
    let (x,y)=point;let (left,top,w,h)=rect;
    [x,y,left,top,w,h].iter().all(|v|v.is_finite())&&w>0.0&&h>0.0
        &&[left,top,left+w,top+h].iter().all(|v|*v>=f64::from(i32::MIN)/2.0&&*v<=f64::from(i32::MAX)/2.0)
        &&x>=0.0&&y>=0.0&&x<f64::from(width)&&y<f64::from(height)
        &&x>=left&&y>=top&&x<left+w&&y<top+h
        &&(full_rect_can_extend||(left>=0.0&&top>=0.0&&left+w<=f64::from(width)&&top+h<=f64::from(height)))
}

#[derive(Clone,PartialEq,Eq)]
struct NativeTokenFacts{integrity:u32,ui_access:bool,token_id:(u32,i32)}
#[derive(Clone,PartialEq,Eq)]
struct NativeEnvironmentFacts{station:String,station_visible:bool,input_receives:bool,caller_desktop:String,input_desktop:String,target_desktop:String,
    caller:NativeTokenFacts,effective:NativeTokenFacts,target:NativeTokenFacts,foreground_is_original_or_managed:bool}
fn native_environment_eligible(facts:&NativeEnvironmentFacts)->bool{
    facts.station=="WinSta0"&&facts.station_visible&&facts.input_receives&&!facts.input_desktop.is_empty()&&facts.caller_desktop==facts.input_desktop&&facts.target_desktop==facts.input_desktop
        &&facts.foreground_is_original_or_managed&&!facts.caller.ui_access&&!facts.effective.ui_access&&!facts.target.ui_access
        &&facts.caller.integrity>=facts.target.integrity&&facts.effective.integrity>=facts.target.integrity
}
fn native_environment_stable(before:&NativeEnvironmentFacts,after:&NativeEnvironmentFacts)->bool{
    native_environment_eligible(before)&&native_environment_eligible(after)&&before==after
}
fn decode_native_object_name(buffer:&[u16],byte_length:usize)->Option<String>{
    if byte_length<4||byte_length%2!=0||byte_length>buffer.len().checked_mul(2)?{return None;}
    let units=&buffer[..byte_length/2];if units.last()!=Some(&0)||units[..units.len()-1].contains(&0){return None;}
    String::from_utf16(&units[..units.len()-1]).ok().filter(|name|!name.is_empty())
}
fn decode_native_integrity_sid(buffer:&[u8],offset:usize,attributes:u32)->Option<u32>{
    // Fixed Windows integrity SID ABI: revision1, one RID, mandatory authority16,
    // SE_GROUP_INTEGRITY0x20. Validate the pointer-derived range BEFORE reading.
    let sid=buffer.get(offset..offset.checked_add(12)?)?;
    if attributes&0x20==0||sid[0]!=1||sid[1]!=1||sid[2..8]!=[0,0,0,0,0,16]{return None;}
    Some(u32::from_le_bytes(sid[8..12].try_into().ok()?))
}

// Actual controller admission uses this pure predicate. For a source, `issued`
// is the authenticated issuedAtMs; for the stamp-less FocusSource it is the
// trusted local time retained BEFORE HTTP. Never derive a renewed deadline
// from response receipt or from native capture completion.
fn bounded_native_source_ttl(issued:u64,expires:u64,now:u64,parent_deadline:u64)->bool{
    const MAX_SAFE_MS:u64=9_007_199_254_740_991;
    issued>0&&issued<=now&&now<=MAX_SAFE_MS&&parent_deadline<=MAX_SAFE_MS
        &&expires>now&&expires<=parent_deadline&&expires<=MAX_SAFE_MS
        &&issued.checked_add(PERMIT_MS).is_some_and(|limit|expires<=limit)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum FoundationError {
    EntropyUnavailable, RegistryUnavailable, EpochExhausted, Disabled,
    InvalidSnapshot, Stopped, Expired, IncarnationChanged, QuotaExceeded,
    ControllerAdmissionPending, AlreadyConsumed, UnknownPermit, InvalidPlan,
    OutstandingPermit, OperationRevoked, UnsafePressedState,
}
impl fmt::Display for FoundationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "NATIVE_BROWSER_FOUNDATION_{self:?}")
    }
}
impl std::error::Error for FoundationError {}

/// Trusted host facts, not owner consent or a map/dispatch permit. Only the
/// existing native host may capture these after its actual local slot checks.
#[derive(Clone, PartialEq, Eq)]
pub(crate) struct HostSnapshot {
    boot_epoch: u64, scope_epoch: u64, session_generation: u64,
    reservation_incarnation: u64, session_id: String, operation_ref: String,
    expires_at_ms: u64, stopped: bool,
}
impl HostSnapshot {
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn new(boot_epoch: u64, scope_epoch: u64, session_generation: u64,
        reservation_incarnation: u64, session_id: String, operation_ref: String,
        expires_at_ms: u64, stopped: bool) -> Result<Self, FoundationError> {
        let opaque = |s: &str| !s.is_empty() && s.len() <= 160
            && s.bytes().all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_' | b':'));
        if boot_epoch == 0 || scope_epoch == 0 || session_generation == 0
            || reservation_incarnation == 0 || expires_at_ms == 0
            || !opaque(&session_id) || !opaque(&operation_ref) {
            return Err(FoundationError::InvalidSnapshot);
        }
        Ok(Self { boot_epoch, scope_epoch, session_generation, reservation_incarnation,
            session_id, operation_ref, expires_at_ms, stopped })
    }
}

pub(crate) struct Foundation {
    boot_epoch: AtomicU64, scope_epoch: AtomicU64, enabled: AtomicBool,
    registry: Mutex<Registry>,
}
impl Default for Foundation {
    fn default() -> Self {
        Self { boot_epoch: AtomicU64::new(0), scope_epoch: AtomicU64::new(0),
            enabled: AtomicBool::new(false), registry: Mutex::new(Registry::default()) }
    }
}
impl Foundation {
    pub(crate) fn boot_epoch(&self) -> u64 { self.boot_epoch.load(Ordering::SeqCst) }
    pub(crate) fn scope_epoch(&self) -> u64 { self.scope_epoch.load(Ordering::SeqCst) }
    fn advance(epoch: &AtomicU64) -> Result<u64, FoundationError> {
        epoch.fetch_update(Ordering::SeqCst, Ordering::SeqCst, |value| value.checked_add(1))
            .map(|value| value + 1).map_err(|_| FoundationError::EpochExhausted)
    }
    /// Immediate atomic denial does not wait for the dispatcher, entropy, HTTP
    /// or a registry holder. Consumed tombstones remain until legitimate reset.
    pub(crate) fn disable_boot(&self) -> Result<(), FoundationError> {
        self.enabled.store(false, Ordering::SeqCst);
        Self::advance(&self.boot_epoch)?;
        self.invalidate_scope()
    }
    pub(crate) fn invalidate_scope(&self) -> Result<(), FoundationError> {
        if let Err(error) = Self::advance(&self.scope_epoch) {
            self.enabled.store(false, Ordering::SeqCst);
            return Err(error);
        }
        let mut registry = self.registry.try_lock().map_err(|_| FoundationError::RegistryUnavailable)?;
        for operation in registry.operations.values_mut() {
            operation.revoked = true;
            operation.pending = None;
        }
        Ok(())
    }
    pub(crate) fn reset_boot(&self) -> Result<(), FoundationError> {
        // Revoke BEFORE entropy, including failure paths. No fallback RNG.
        self.disable_boot()?;
        let expected_boot = self.boot_epoch(); let expected_scope = self.scope_epoch();
        // Standalone pure tests have no OS entropy dependency. Tests explicitly
        // install fixture entropy; reset itself fails rather than substituting it.
        #[cfg(test)]
        { let _ = (expected_boot, expected_scope); return Err(FoundationError::EntropyUnavailable); }
        #[cfg(not(test))]
        {
        let mut nonce = [0u8; 32];
        getrandom::fill(&mut nonce).map_err(|_| FoundationError::EntropyUnavailable)?;
        self.install_boot(expected_boot, expected_scope, nonce)
        }
    }
    fn install_boot(&self, boot: u64, scope: u64, nonce: [u8; 32]) -> Result<(), FoundationError> {
        let mut registry = self.registry.lock().map_err(|_| FoundationError::RegistryUnavailable)?;
        if self.boot_epoch() != boot || self.scope_epoch() != scope { return Err(FoundationError::IncarnationChanged); }
        *registry = Registry { nonce: Some(nonce), ..Registry::default() };
        self.enabled.store(true, Ordering::SeqCst);
        // A racing STOP/reset must not be hidden by the enabled store.
        if self.boot_epoch() != boot || self.scope_epoch() != scope {
            self.enabled.store(false, Ordering::SeqCst);
            return Err(FoundationError::IncarnationChanged);
        }
        Ok(())
    }
    fn validate_epochs(&self, host: &HostSnapshot, now: u64) -> Result<(), FoundationError> {
        if !self.enabled.load(Ordering::SeqCst) { return Err(FoundationError::Disabled); }
        if host.stopped { return Err(FoundationError::Stopped); }
        if host.expires_at_ms <= now { return Err(FoundationError::Expired); }
        if host.boot_epoch != self.boot_epoch() || host.scope_epoch != self.scope_epoch() {
            return Err(FoundationError::IncarnationChanged);
        }
        Ok(())
    }
    /// Local freshness check ONLY. A valid host does not mint browser authority.
    /// Absent privately admitted operations remain an explicit pending gate.
    pub(crate) fn validate_host(&self, host: &HostSnapshot, now: u64) -> Result<(), FoundationError> {
        self.validate_epochs(host, now)?;
        let registry = self.registry.lock().map_err(|_| FoundationError::RegistryUnavailable)?;
        let operation = registry.operations.get(&host.operation_ref).ok_or(FoundationError::ControllerAdmissionPending)?;
        if operation.revoked { return Err(FoundationError::OperationRevoked); }
        if operation.host != *host { return Err(FoundationError::IncarnationChanged); }
        if operation.deadline <= now { return Err(FoundationError::Expired); }
        self.validate_epochs(host, now)
    }

    // These constructors are deliberately private, not exported to the host or
    // renderer. Only the measured private controller supplies admission.
    fn reserve_operation(&self, host: HostSnapshot, plan: OperationPlan, now: u64) -> Result<(), FoundationError> {
        self.validate_epochs(&host, now)?; plan.validate()?;
        let deadline = host.expires_at_ms.min(now.checked_add(OPERATION_MS).ok_or(FoundationError::InvalidPlan)?);
        let slots: usize = plan.batches.iter().map(|batch| batch.record_slots).sum();
        let mut registry = self.registry.lock().map_err(|_| FoundationError::RegistryUnavailable)?;
        self.validate_epochs(&host, now)?;
        if registry.nonce.is_none() { return Err(FoundationError::Disabled); }
        if registry.operations.contains_key(&host.operation_ref) { return Err(FoundationError::AlreadyConsumed); }
        if registry.operations.len() >= MAX_OPERATIONS || registry.reserved_slots.checked_add(slots).is_none_or(|v| v > MAX_BOOT_SLOTS) {
            return Err(FoundationError::QuotaExceeded);
        }
        registry.reserved_slots += slots;
        registry.operations.insert(host.operation_ref.clone(), Operation { host, deadline, plan,
            next_batch: 0, pending: None, consumed: BTreeSet::new(), started: BTreeSet::new(), records: Vec::new(), revoked: false,
            effects:std::sync::Arc::new(EffectFlags::default()) });
        Ok(())
    }
    fn issue_permit(&self, host: &HostSnapshot, batch: usize, now: u64) -> Result<LocalPermit, FoundationError> {
        self.issue_permit_until(host,batch,now,u64::MAX)
    }
    fn issue_permit_until(&self, host: &HostSnapshot, batch: usize, now: u64, fixed_deadline:u64) -> Result<LocalPermit, FoundationError> {
        if fixed_deadline<=now{return Err(FoundationError::Expired);}
        self.validate_host(host, now)?;
        let mut registry = self.registry.lock().map_err(|_| FoundationError::RegistryUnavailable)?;
        if registry.operations.values().any(|op| !op.revoked && (op.pending.is_some() || op.consumed.len() > op.records.len())
            && (op.host.session_id == host.session_id || op.host.reservation_incarnation == host.reservation_incarnation)) {
            return Err(FoundationError::OutstandingPermit);
        }
        let nonce = registry.next_nonce.checked_add(1).ok_or(FoundationError::QuotaExceeded)?;
        registry.next_nonce = nonce;
        let operation = registry.operations.get_mut(&host.operation_ref).ok_or(FoundationError::ControllerAdmissionPending)?;
        if operation.revoked || operation.host != *host { return Err(FoundationError::IncarnationChanged); }
        if batch != operation.next_batch || batch >= operation.plan.batches.len() { return Err(FoundationError::InvalidPlan); }
        let permit = LocalPermit { host: host.clone(), batch, nonce,
            expires: operation.deadline.min(fixed_deadline).min(now.checked_add(PERMIT_MS).ok_or(FoundationError::InvalidPlan)?) };
        operation.pending = Some(permit.clone());
        Ok(permit)
    }
    fn consume(&self, permit: &LocalPermit, now: u64) -> Result<ConsumedPermit, FoundationError> {
        self.validate_host(&permit.host, now)?;
        let mut registry = self.registry.lock().map_err(|_| FoundationError::RegistryUnavailable)?;
        let operation = registry.operations.get_mut(&permit.host.operation_ref).ok_or(FoundationError::UnknownPermit)?;
        if operation.consumed.contains(&permit.nonce) { return Err(FoundationError::AlreadyConsumed); }
        if operation.pending.as_ref() != Some(permit) { return Err(FoundationError::UnknownPermit); }
        // Expired/cancelled attempts consume identity too; no renewal/replay.
        operation.pending = None;
        operation.consumed.insert(permit.nonce);
        if permit.expires <= now || operation.deadline <= now { operation.revoked = true; return Err(FoundationError::Expired); }
        if self.validate_epochs(&permit.host, now).is_err() { operation.revoked = true; return Err(FoundationError::IncarnationChanged); }
        Ok(ConsumedPermit { permit: permit.clone(), budget: operation.plan.batches[permit.batch].clone(),effects:std::sync::Arc::clone(&operation.effects) })
    }
    fn retain_dispatch(&self, consumed: ConsumedPermit, mut record: NativeDispatchRecord, acknowledged: bool) -> Result<(), FoundationError> {
        let mut registry = self.registry.lock().map_err(|_| FoundationError::RegistryUnavailable)?;
        let operation = registry.operations.get_mut(&consumed.permit.host.operation_ref).ok_or(FoundationError::UnknownPermit)?;
        if record.permit_nonce != consumed.permit.nonce || !operation.started.contains(&consumed.permit.nonce)
            || !operation.consumed.contains(&consumed.permit.nonce)
            || operation.records.iter().any(|row| row.permit_nonce == consumed.permit.nonce) { return Err(FoundationError::AlreadyConsumed); }
        if operation.records.len() >= MAX_RECORDS { operation.revoked = true; return Err(FoundationError::QuotaExceeded); }
        if !acknowledged { record.outcome = NativeOutcome::Unknown; }
        let successful = record.outcome == NativeOutcome::Sent && acknowledged;
        operation.records.push(record);
        if successful && !operation.revoked { operation.next_batch += 1; } else { operation.revoked = true; }
        Ok(())
    }
    // This gate is latched before any callback or syscall. Borrowing the private
    // consumed token twice cannot dispatch twice, even when the ack is lost.
    fn start_dispatch(&self, consumed: &ConsumedPermit) -> Result<(), FoundationError> {
        let mut registry = self.registry.lock().map_err(|_| FoundationError::RegistryUnavailable)?;
        let operation = registry.operations.get_mut(&consumed.permit.host.operation_ref).ok_or(FoundationError::UnknownPermit)?;
        if operation.host != consumed.permit.host || !operation.consumed.contains(&consumed.permit.nonce) {
            return Err(FoundationError::UnknownPermit);
        }
        if !operation.started.insert(consumed.permit.nonce) { return Err(FoundationError::AlreadyConsumed); }
        Ok(())
    }
}

#[derive(Default)]
struct Registry { nonce: Option<[u8; 32]>, next_nonce: u64, reserved_slots: usize, operations: HashMap<String, Operation> }
struct Operation { host: HostSnapshot, deadline: u64, plan: OperationPlan, next_batch: usize,
    pending: Option<LocalPermit>, consumed: BTreeSet<u64>, started: BTreeSet<u64>, records: Vec<NativeDispatchRecord>, revoked: bool,
    effects:std::sync::Arc<EffectFlags> }
#[derive(Default)]
struct EffectFlags {possible:AtomicBool,cursor:AtomicBool,focus:AtomicBool}
#[derive(Clone)]
struct BatchBudget { primary_events: u32, cleanup_events: u32, record_slots: usize, utf16_units: u32 }
struct OperationPlan { batches: Vec<BatchBudget> }
impl OperationPlan {
    fn validate(&self) -> Result<(), FoundationError> {
        if self.batches.is_empty() || self.batches.len() > MAX_BATCHES { return Err(FoundationError::QuotaExceeded); }
        let mut events = 0u32; let mut units = 0u32; let mut slots = 0usize;
        for batch in &self.batches {
            // One consumed tombstone plus one immutable measured ledger record.
            if batch.primary_events == 0 || batch.cleanup_events as usize > MAX_CLEANUP || batch.record_slots < 2 { return Err(FoundationError::InvalidPlan); }
            events = events.checked_add(batch.primary_events).and_then(|v| v.checked_add(batch.cleanup_events)).ok_or(FoundationError::QuotaExceeded)?;
            units = units.checked_add(batch.utf16_units).ok_or(FoundationError::QuotaExceeded)?;
            slots = slots.checked_add(batch.record_slots).ok_or(FoundationError::QuotaExceeded)?;
        }
        if events > MAX_EVENTS || units > MAX_UTF16 || slots > MAX_RECORDS { return Err(FoundationError::QuotaExceeded); }
        Ok(())
    }
}
#[derive(Clone, PartialEq, Eq)]
struct LocalPermit { host: HostSnapshot, batch: usize, nonce: u64, expires: u64 }
struct ConsumedPermit { permit: LocalPermit, budget: BatchBudget, effects:std::sync::Arc<EffectFlags> }

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
enum OwnedKey { LeftButton, Virtual(u16), Unicode(u16), Wheel(i32) }
#[derive(Clone, Copy)]
struct InputEvent { key: OwnedKey, up: bool }
#[derive(Clone, Debug, PartialEq, Eq)]
struct CountedApiResult { requested: u32, sent: Option<u32>, possible_effect: bool }
#[derive(Clone, Debug, PartialEq, Eq)]
struct CursorApiResult { requested: (i32, i32), returned: Option<bool>, observed: Option<(i32, i32)>, possible_effect: bool }
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum NativeOutcome { Sent, ZeroEffectDenied, Partial, Unknown }
#[derive(Clone)]
struct NativeDispatchRecord { permit_nonce: u64, primary: Vec<CountedApiResult>, cleanup: Vec<CountedApiResult>,
    cursor: Option<CursorApiResult>, possible_effect: bool, focus_effect: bool, outcome: NativeOutcome }

// Adapter is private. Production calls the actual APIs; cfg(test) fakes only
// exercise bookkeeping and never establish measured/physical acceptance.
trait NativeApi {
    fn send(&mut self, events: &[InputEvent]) -> Option<u32>;
    fn move_cursor(&mut self, point: (i32, i32)) -> Option<bool>;
    fn cursor(&mut self) -> Option<(i32, i32)>;
    fn physically_down(&mut self, key: OwnedKey) -> Option<bool>;
}
fn count_send(api: &mut dyn NativeApi, events: &[InputEvent]) -> CountedApiResult {
    let mut record = CountedApiResult { requested: events.len() as u32, sent: None, possible_effect: true };
    // possible_effect is latched BEFORE the syscall, even if returned DWORD=0.
    record.sent = api.send(events);
    record
}
fn same_live_host(foundation: &Foundation, expected: &HostSnapshot,
    capture: &dyn Fn() -> Result<HostSnapshot, FoundationError>, now: &dyn Fn() -> u64) -> Result<(), FoundationError> {
    let current = capture()?;
    foundation.validate_host(&current, now())?;
    if current != *expected { return Err(FoundationError::IncarnationChanged); }
    Ok(())
}

/// Private measured path; no production controller constructs ConsumedPermit.
/// Chunks are preplanned primary API batches, not retries. Any short/unknown
/// count stops remaining chunks. Only currently attempted owned downs can be
/// cleaned up, once, within the pre-reserved cleanup count. No focus shortcut.
fn dispatch_counted(foundation: &Foundation, consumed: &ConsumedPermit,
    chunks: &[Vec<InputEvent>], point: Option<(i32, i32)>, api: &mut dyn NativeApi,
    capture: &dyn Fn() -> Result<HostSnapshot, FoundationError>, now: &dyn Fn() -> u64) -> Result<NativeDispatchRecord, FoundationError> {
    let total = chunks.iter().try_fold(0u32, |sum, chunk| u32::try_from(chunk.len()).ok().and_then(|n|sum.checked_add(n))).ok_or(FoundationError::QuotaExceeded)?;
    if chunks.is_empty() || chunks.len() > MAX_EVENTS as usize || total != consumed.budget.primary_events {
        return Err(FoundationError::InvalidPlan);
    }
    let unicode_units = chunks.iter().flatten().filter(|event| !event.up && matches!(event.key, OwnedKey::Unicode(_))).count();
    if unicode_units != consumed.budget.utf16_units as usize { return Err(FoundationError::InvalidPlan); }
    for chunk in chunks {
        if chunk.is_empty() || chunk.len() > MAX_EVENTS as usize { return Err(FoundationError::InvalidPlan); }
        let downs: BTreeSet<_> = chunk.iter().filter(|event| !event.up && !matches!(event.key, OwnedKey::Wheel(_))).map(|event| event.key).collect();
        if downs.len() > consumed.budget.cleanup_events as usize { return Err(FoundationError::InvalidPlan); }
        let mut pressed = BTreeSet::new();
        for event in chunk {
            if let OwnedKey::Wheel(delta) = event.key {
                if event.up || !matches!(delta, -120 | 120) { return Err(FoundationError::InvalidPlan); }
                continue;
            }
            if matches!(event.key, OwnedKey::Virtual(vk) if vk == 0 || vk > 255) { return Err(FoundationError::InvalidPlan); }
            let matched = if event.up { pressed.remove(&event.key) } else { pressed.insert(event.key) };
            if !matched { return Err(FoundationError::InvalidPlan); }
        }
        if !pressed.is_empty() { return Err(FoundationError::InvalidPlan); }
    }
    let mut record = NativeDispatchRecord { permit_nonce: consumed.permit.nonce, primary: Vec::new(), cleanup: Vec::new(),
        cursor: None, possible_effect: false, focus_effect: false, outcome: NativeOutcome::ZeroEffectDenied };
    foundation.start_dispatch(consumed)?;
    if same_live_host(foundation, &consumed.permit.host, capture, now).is_err() || now() >= consumed.permit.expires { return Ok(record); }
    // Reject physical keys before any cursor/input effect. Query errors deny.
    let mut all_keys: BTreeSet<_> = chunks.iter().flatten().filter(|event| !event.up && !matches!(event.key, OwnedKey::Wheel(_))).map(|event| event.key).collect();
    // Unicode packets do not represent physical modifier state. Always require
    // known released modifiers and mouse button, even for an all-Unicode plan.
    all_keys.insert(OwnedKey::LeftButton);
    all_keys.extend([0xA0,0xA1,0xA2,0xA3,0xA4,0xA5,0x5B,0x5C,0x02,0x04,0x05,0x06].map(OwnedKey::Virtual));
    for key in all_keys {
        if api.physically_down(key) != Some(false) || same_live_host(foundation, &consumed.permit.host, capture, now).is_err() { return Ok(record); }
    }
    if let Some(point) = point {
        if same_live_host(foundation, &consumed.permit.host, capture, now).is_err() || now() >= consumed.permit.expires { return Ok(record); }
        record.possible_effect = true;
        consumed.effects.possible.store(true,Ordering::SeqCst);
        consumed.effects.cursor.store(true,Ordering::SeqCst);
        let mut cursor = CursorApiResult { requested: point, returned: None, observed: None, possible_effect: true };
        cursor.returned = api.move_cursor(point);
        let move_guard = same_live_host(foundation, &consumed.permit.host, capture, now).is_ok() && now() < consumed.permit.expires;
        cursor.observed = api.cursor();
        let observed_guard = same_live_host(foundation, &consumed.permit.host, capture, now).is_ok() && now() < consumed.permit.expires;
        let matched = cursor.returned == Some(true) && cursor.observed == Some(point);
        let unknown = cursor.returned.is_none() || cursor.observed.is_none();
        record.cursor = Some(cursor);
        if !matched || !move_guard || !observed_guard { record.outcome = if unknown { NativeOutcome::Unknown } else { NativeOutcome::Partial }; return Ok(record); }
    }
    for chunk in chunks {
        if same_live_host(foundation, &consumed.permit.host, capture, now).is_err() || now() >= consumed.permit.expires {
            record.outcome = if record.possible_effect { NativeOutcome::Partial } else { NativeOutcome::ZeroEffectDenied }; return Ok(record);
        }
        record.possible_effect = true;
        // No focus proof is frozen. An attempted mouse/key syscall may affect
        // focus, even when its count is zero/unknown; retain that uncertainty.
        record.focus_effect = true;
        consumed.effects.possible.store(true,Ordering::SeqCst);
        consumed.effects.focus.store(true,Ordering::SeqCst);
        let result = count_send(api, chunk);
        let exact = result.sent == Some(result.requested);
        let unknown = result.sent.is_none() || result.sent.is_some_and(|sent| sent > result.requested);
        let mut pressed = BTreeSet::new();
        if let Some(sent) = result.sent.filter(|sent| *sent <= result.requested) {
            for event in chunk.iter().take(sent as usize) {
                if matches!(event.key, OwnedKey::Wheel(_)) { continue; }
                if event.up { pressed.remove(&event.key); } else { pressed.insert(event.key); }
            }
        } else { pressed.extend(chunk.iter().filter(|event| !event.up && !matches!(event.key, OwnedKey::Wheel(_))).map(|event| event.key)); }
        record.primary.push(result); // Preserve the actual DWORD on every branch.
        let guarded = same_live_host(foundation, &consumed.permit.host, capture, now).is_ok() && now() < consumed.permit.expires;
        if !exact || !guarded {
            if !pressed.is_empty() {
                let cleanup: Vec<_> = pressed.into_iter().map(|key| InputEvent { key, up: true }).collect();
                if cleanup.len() > consumed.budget.cleanup_events as usize { record.outcome = NativeOutcome::Unknown; return Ok(record); }
                record.cleanup.push(count_send(api, &cleanup));
                // Cleanup must release only our owned inputs even during STOP.
                let _ = same_live_host(foundation, &consumed.permit.host, capture, now);
            }
            record.outcome = if unknown || record.cleanup.iter().any(|row| row.sent != Some(row.requested)) { NativeOutcome::Unknown } else { NativeOutcome::Partial };
            return Ok(record);
        }
    }
    record.outcome = NativeOutcome::Sent;
    Ok(record)
}

#[cfg(all(windows, not(test)))]
struct WindowsApi;
#[cfg(all(windows, not(test)))]
impl NativeApi for WindowsApi {
    fn send(&mut self, events: &[InputEvent]) -> Option<u32> {
        use windows_sys::Win32::UI::Input::KeyboardAndMouse::{SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, INPUT_MOUSE,
            KEYBDINPUT, MOUSEINPUT, KEYEVENTF_KEYUP, KEYEVENTF_UNICODE, MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP, MOUSEEVENTF_WHEEL};
        let inputs: Vec<_> = events.iter().map(|event| match event.key {
            OwnedKey::LeftButton => INPUT { r#type: INPUT_MOUSE, Anonymous: INPUT_0 { mi: MOUSEINPUT {
                dx: 0, dy: 0, mouseData: 0, dwFlags: if event.up { MOUSEEVENTF_LEFTUP } else { MOUSEEVENTF_LEFTDOWN }, time: 0, dwExtraInfo: 0 } } },
            OwnedKey::Wheel(delta) => INPUT { r#type: INPUT_MOUSE, Anonymous: INPUT_0 { mi: MOUSEINPUT {
                dx: 0, dy: 0, mouseData: delta as u32, dwFlags: MOUSEEVENTF_WHEEL, time: 0, dwExtraInfo: 0 } } },
            OwnedKey::Virtual(vk) | OwnedKey::Unicode(vk) => {
                let unicode = matches!(event.key, OwnedKey::Unicode(_));
                INPUT { r#type: INPUT_KEYBOARD, Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: if unicode { 0 } else { vk },
                    wScan: if unicode { vk } else { 0 }, dwFlags: (if unicode { KEYEVENTF_UNICODE } else { 0 }) | (if event.up { KEYEVENTF_KEYUP } else { 0 }), time: 0, dwExtraInfo: 0 } } }
            }
        }).collect();
        // Actual requested count is the exact inputs.len; returned DWORD is never
        // converted to an error that erases a short/zero count.
        Some(unsafe { SendInput(inputs.len() as u32, inputs.as_ptr(), std::mem::size_of::<INPUT>() as i32) })
    }
    fn move_cursor(&mut self, point: (i32, i32)) -> Option<bool> {
        Some(unsafe { windows_sys::Win32::UI::WindowsAndMessaging::SetCursorPos(point.0, point.1) } != 0)
    }
    fn cursor(&mut self) -> Option<(i32, i32)> {
        let mut point = windows_sys::Win32::Foundation::POINT::default();
        if unsafe { windows_sys::Win32::UI::WindowsAndMessaging::GetCursorPos(&mut point) } == 0 { None } else { Some((point.x, point.y)) }
    }
    fn physically_down(&mut self, key: OwnedKey) -> Option<bool> {
        use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON};
        let vk = match key { OwnedKey::LeftButton => VK_LBUTTON as i32, OwnedKey::Virtual(vk) => i32::from(vk), OwnedKey::Unicode(_) | OwnedKey::Wheel(_) => return Some(false) };
        Some(unsafe { GetAsyncKeyState(vk) } < 0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;
    fn foundation() -> Foundation {
        let f = Foundation::default(); f.disable_boot().unwrap();
        // Explicit fixture entropy; never a production entropy fallback.
        f.install_boot(f.boot_epoch(), f.scope_epoch(), [7; 32]).unwrap(); f
    }
    fn host(f: &Foundation, operation: &str) -> HostSnapshot {
        HostSnapshot::new(f.boot_epoch(), f.scope_epoch(), 1, 1, "computer-fixture".into(), operation.into(), 100_000, false).unwrap()
    }
    fn plan(batches: usize) -> OperationPlan { OperationPlan { batches: (0..batches).map(|_| BatchBudget { primary_events: 2, cleanup_events: 2, record_slots: 2, utf16_units: 0 }).collect() } }
    fn pair() -> Vec<InputEvent> { vec![InputEvent { key: OwnedKey::LeftButton, up: false }, InputEvent { key: OwnedKey::LeftButton, up: true }] }
    struct Fake { results: Vec<Option<u32>>, calls: usize, move_return: Option<bool>, observed: Option<(i32,i32)>, held: bool, held_key: Option<OwnedKey> }
    impl Fake { fn new(results: Vec<Option<u32>>) -> Self { Self { results, calls: 0, move_return: Some(true), observed: Some((10,20)), held: false, held_key: None } } }
    impl NativeApi for Fake {
        fn send(&mut self, _: &[InputEvent]) -> Option<u32> { let value = self.results.get(self.calls).copied().flatten(); self.calls += 1; value }
        fn move_cursor(&mut self, _: (i32,i32)) -> Option<bool> { self.move_return }
        fn cursor(&mut self) -> Option<(i32,i32)> { self.observed }
        fn physically_down(&mut self, key: OwnedKey) -> Option<bool> { Some(self.held || self.held_key == Some(key)) }
    }
    fn consumed(f: &Foundation, h: &HostSnapshot) -> ConsumedPermit { f.reserve_operation(h.clone(), plan(1), 10).unwrap(); let p=f.issue_permit(h,0,11).unwrap(); f.consume(&p,12).unwrap() }
    #[test] fn default_has_no_authority_and_unadmitted_host_is_pending() {
        let f=Foundation::default(); assert_eq!(f.boot_epoch(),0);
        assert!(HostSnapshot::new(0,0,1,1,"s".into(),"o".into(),10,false).is_err());
        let f=foundation(); let h=host(&f,"o"); assert_eq!(f.validate_host(&h,1),Err(FoundationError::ControllerAdmissionPending));
    }
    #[test] fn actual_counts_exact_short_zero_and_unknown_never_retry() {
        for (returned,cleanup,outcome) in [(Some(2),None,NativeOutcome::Sent),(Some(1),Some(1),NativeOutcome::Partial),(Some(0),None,NativeOutcome::Partial),(None,Some(1),NativeOutcome::Unknown)] {
            let f=foundation(); let h=host(&f,"o"); let c=consumed(&f,&h); let mut api=Fake::new(vec![returned,cleanup]);
            let record=dispatch_counted(&f,&c,&[pair()],None,&mut api,&||Ok(h.clone()),&||13).unwrap();
            assert_eq!(record.primary[0].requested,2); assert_eq!(record.primary[0].sent,returned); assert!(record.possible_effect); assert!(record.focus_effect);
            assert_eq!(record.outcome,outcome); assert_eq!(api.calls,if cleanup.is_some(){2}else{1});
            if cleanup.is_some(){assert_eq!(record.cleanup[0].requested,1);}
        }
    }
    #[test] fn short_cleanup_preserves_its_count_and_is_unknown() {
        let f=foundation();let h=host(&f,"o");let c=consumed(&f,&h);let mut api=Fake::new(vec![Some(1),Some(0)]);
        let r=dispatch_counted(&f,&c,&[pair()],None,&mut api,&||Ok(h.clone()),&||13).unwrap();
        assert_eq!(r.cleanup[0].sent,Some(0)); assert_eq!(r.outcome,NativeOutcome::Unknown); assert_eq!(api.calls,2);
    }
    #[test] fn cursor_effect_is_separate_and_mismatch_never_clicks() {
        let f=foundation();let h=host(&f,"o");let c=consumed(&f,&h);let mut api=Fake::new(vec![Some(2)]);api.move_return=Some(false);
        let r=dispatch_counted(&f,&c,&[pair()],Some((10,20)),&mut api,&||Ok(h.clone()),&||13).unwrap();
        assert!(r.cursor.unwrap().possible_effect);assert!(!r.focus_effect);assert_eq!(api.calls,0);assert_eq!(r.outcome,NativeOutcome::Partial);
    }
    #[test] fn stopped_before_effect_is_zero_but_consumed() {
        let f=foundation();let h=host(&f,"o");let c=consumed(&f,&h);let mut api=Fake::new(vec![Some(2)]);
        f.invalidate_scope().unwrap();
        let r=dispatch_counted(&f,&c,&[pair()],None,&mut api,&||Ok(h.clone()),&||13).unwrap();
        assert_eq!(r.outcome,NativeOutcome::ZeroEffectDenied);assert!(!r.possible_effect);assert_eq!(api.calls,0);
        assert!(f.registry.lock().unwrap().operations["o"].consumed.contains(&c.permit.nonce));
    }
    #[test] fn incarnation_expiry_and_one_outstanding_permit() {
        let f=foundation();let h=host(&f,"o");f.reserve_operation(h.clone(),plan(2),10).unwrap();let p=f.issue_permit(&h,0,11).unwrap();
        assert!(matches!(f.issue_permit(&h,0,12),Err(FoundationError::OutstandingPermit)));
        let mut changed=h.clone();changed.reservation_incarnation+=1;assert_eq!(f.validate_host(&changed,12),Err(FoundationError::IncarnationChanged));
        assert!(matches!(f.consume(&p,1011),Err(FoundationError::Expired)));assert!(f.registry.lock().unwrap().operations["o"].consumed.contains(&p.nonce));
    }
    #[test] fn lost_ack_keeps_once_only_identity_and_blocks_successor() {
        let f=foundation();let h=host(&f,"o");f.reserve_operation(h.clone(),plan(2),10).unwrap();let p=f.issue_permit(&h,0,11).unwrap();let c=f.consume(&p,12).unwrap();
        assert!(matches!(f.consume(&p,12),Err(FoundationError::AlreadyConsumed)));
        assert!(matches!(f.issue_permit(&h,0,12),Err(FoundationError::OutstandingPermit)));
        let mut api=Fake::new(vec![Some(2)]);let r=dispatch_counted(&f,&c,&[pair()],None,&mut api,&||Ok(h.clone()),&||13).unwrap();
        f.retain_dispatch(c,r,false).unwrap();assert_eq!(f.registry.lock().unwrap().operations["o"].records[0].outcome,NativeOutcome::Unknown);
        assert!(f.issue_permit(&h,1,14).is_err());
    }
    #[test] fn quotas_reserved_before_any_effect_and_not_evicted() {
        assert!(plan(11).validate().is_err());let mut p=plan(1);p.batches[0].primary_events=MAX_EVENTS;assert!(p.validate().is_err());
        let f=foundation();for i in 0..MAX_OPERATIONS{let h=host(&f,&format!("o-{i}"));f.reserve_operation(h,plan(1),10).unwrap();}
        assert_eq!(f.reserve_operation(host(&f,"extra"),plan(1),10),Err(FoundationError::QuotaExceeded));
        f.invalidate_scope().unwrap();assert_eq!(f.registry.lock().unwrap().operations.len(),MAX_OPERATIONS);
    }
    #[test] fn stop_during_primary_retains_dword_and_cleanup() {
        let f=foundation();let h=host(&f,"o");let c=consumed(&f,&h);let calls=Cell::new(0usize);let mut api=Fake::new(vec![Some(1),Some(1)]);
        let capture=||{let n=calls.get();calls.set(n+1);if n>=15{Err(FoundationError::Stopped)}else{Ok(h.clone())}};
        let r=dispatch_counted(&f,&c,&[pair()],None,&mut api,&capture,&||13).unwrap();assert_eq!(r.primary[0].sent,Some(1));assert_eq!(r.cleanup[0].sent,Some(1));
    }
    #[test] fn disable_retains_tombstones_and_legitimate_reset_changes_boot() {
        let f=foundation();let h=host(&f,"o");let c=consumed(&f,&h);let old=f.boot_epoch();f.disable_boot().unwrap();
        assert!(f.registry.lock().unwrap().operations["o"].consumed.contains(&c.permit.nonce));assert_eq!(f.validate_host(&h,13),Err(FoundationError::Disabled));
        f.install_boot(f.boot_epoch(),f.scope_epoch(),[8;32]).unwrap();assert!(f.boot_epoch()>old);assert!(f.registry.lock().unwrap().operations.is_empty());
    }
    #[test] fn repeated_dispatch_token_never_replays_and_cursor_unknown_never_clicks() {
        let f=foundation();let h=host(&f,"o");let c=consumed(&f,&h);let mut api=Fake::new(vec![Some(2)]);api.move_return=None;
        let r=dispatch_counted(&f,&c,&[pair()],Some((10,20)),&mut api,&||Ok(h.clone()),&||13).unwrap();
        assert_eq!(r.cursor.unwrap().returned,None);assert_eq!(r.outcome,NativeOutcome::Unknown);assert_eq!(api.calls,0);
        assert!(matches!(dispatch_counted(&f,&c,&[pair()],None,&mut api,&||Ok(h.clone()),&||13),Err(FoundationError::AlreadyConsumed)));
        assert_eq!(api.calls,0);
    }
    #[test] fn reacquired_same_ids_and_entropy_failure_do_not_restore_authority() {
        let f=foundation();let h=host(&f,"o");let _c=consumed(&f,&h);f.invalidate_scope().unwrap();
        let mut reacquired=h.clone();reacquired.scope_epoch=f.scope_epoch();reacquired.reservation_incarnation+=1;
        assert_eq!(f.validate_host(&reacquired,13),Err(FoundationError::OperationRevoked));
        assert_eq!(f.reset_boot(),Err(FoundationError::EntropyUnavailable));
        assert_eq!(f.validate_host(&h,13),Err(FoundationError::Disabled));
    }
    #[test] fn invalid_up_and_held_key_deny_before_effect() {
        let f=foundation();let h=host(&f,"o");let c=consumed(&f,&h);let mut api=Fake::new(vec![Some(2)]);
        let invalid=vec![InputEvent{key:OwnedKey::LeftButton,up:true},InputEvent{key:OwnedKey::LeftButton,up:true}];
        assert!(matches!(dispatch_counted(&f,&c,&[invalid],None,&mut api,&||Ok(h.clone()),&||13),Err(FoundationError::InvalidPlan)));
        api.held=true;
        let r=dispatch_counted(&f,&c,&[pair()],None,&mut api,&||Ok(h.clone()),&||13).unwrap();
        assert_eq!(r.outcome,NativeOutcome::ZeroEffectDenied);assert_eq!(api.calls,0);
    }
    #[test] fn unicode_plan_still_checks_physical_control_and_buttons() {
        for held_key in [OwnedKey::Virtual(0xA2),OwnedKey::Virtual(0x02)] {
            let f=foundation();let h=host(&f,"o");let mut p=plan(1);p.batches[0].utf16_units=1;
            f.reserve_operation(h.clone(),p,10).unwrap();let permit=f.issue_permit(&h,0,11).unwrap();let c=f.consume(&permit,12).unwrap();
            let mut api=Fake::new(vec![Some(2)]);api.held_key=Some(held_key);
            let unicode=vec![InputEvent{key:OwnedKey::Unicode(65),up:false},InputEvent{key:OwnedKey::Unicode(65),up:true}];
            let r=dispatch_counted(&f,&c,&[unicode],None,&mut api,&||Ok(h.clone()),&||13).unwrap();
            assert_eq!(r.outcome,NativeOutcome::ZeroEffectDenied);assert!(!r.focus_effect);assert_eq!(api.calls,0);
        }
    }
    #[test] fn physical_query_expiry_denies_cursor_before_any_effect() {
        struct Expiring<'a> { inner: Fake, clock: &'a Cell<u64>, deadline: u64, moves: usize }
        impl NativeApi for Expiring<'_> {
            fn send(&mut self, events: &[InputEvent]) -> Option<u32> { self.inner.send(events) }
            fn move_cursor(&mut self, point: (i32,i32)) -> Option<bool> { self.moves+=1;self.inner.move_cursor(point) }
            fn cursor(&mut self) -> Option<(i32,i32)> { self.inner.cursor() }
            fn physically_down(&mut self, key: OwnedKey) -> Option<bool> {
                self.clock.set(self.deadline);self.inner.physically_down(key)
            }
        }
        let f=foundation();let h=host(&f,"o");let c=consumed(&f,&h);let clock=Cell::new(13);
        let mut api=Expiring{inner:Fake::new(vec![Some(2)]),clock:&clock,deadline:c.permit.expires,moves:0};
        let r=dispatch_counted(&f,&c,&[pair()],Some((10,20)),&mut api,&||Ok(h.clone()),&||clock.get()).unwrap();
        assert_eq!(r.outcome,NativeOutcome::ZeroEffectDenied);assert!(!r.possible_effect);assert!(!r.focus_effect);
        assert!(r.cursor.is_none());assert!(r.primary.is_empty());assert_eq!(api.moves,0);assert_eq!(api.inner.calls,0);
    }
    #[test] fn blocking_cursor_or_exact_primary_crossing_ttl_retains_effect_as_partial() {
        struct Expiring<'a> { inner: Fake, clock: &'a Cell<u64>, deadline: u64, cursor_expires: bool }
        impl NativeApi for Expiring<'_> {
            fn send(&mut self, events: &[InputEvent]) -> Option<u32> {
                let count=self.inner.send(events);self.clock.set(self.deadline);count
            }
            fn move_cursor(&mut self, point: (i32,i32)) -> Option<bool> {
                let result=self.inner.move_cursor(point);if self.cursor_expires{self.clock.set(self.deadline);}result
            }
            fn cursor(&mut self) -> Option<(i32,i32)> { self.inner.cursor() }
            fn physically_down(&mut self, key: OwnedKey) -> Option<bool> { self.inner.physically_down(key) }
        }
        for cursor_expires in [false,true] {
            let f=foundation();let h=host(&f,"o");let c=consumed(&f,&h);let clock=Cell::new(13);
            let mut api=Expiring{inner:Fake::new(vec![Some(2)]),clock:&clock,deadline:c.permit.expires,cursor_expires};
            let point=if cursor_expires{Some((10,20))}else{None};
            let r=dispatch_counted(&f,&c,&[pair()],point,&mut api,&||Ok(h.clone()),&||clock.get()).unwrap();
            assert_eq!(r.outcome,NativeOutcome::Partial);assert!(r.possible_effect);assert!(r.cleanup.is_empty());
            if cursor_expires {
                let cursor=r.cursor.unwrap();assert_eq!(cursor.returned,Some(true));assert_eq!(cursor.observed,Some((10,20)));
                assert_eq!(api.inner.calls,0);assert!(!r.focus_effect);
            } else {
                assert_eq!(r.primary[0].requested,2);assert_eq!(r.primary[0].sent,Some(2));assert!(r.focus_effect);assert_eq!(api.inner.calls,1);
            }
        }
    }
    #[test] fn wheel_is_one_counted_event_with_no_owned_down_cleanup_or_retry() {
        for returned in [Some(1),Some(0),None] {
            let f=foundation();let h=host(&f,"o");let mut p=plan(1);p.batches[0].primary_events=1;p.batches[0].cleanup_events=0;
            f.reserve_operation(h.clone(),p,10).unwrap();let permit=f.issue_permit(&h,0,11).unwrap();let c=f.consume(&permit,12).unwrap();
            let mut api=Fake::new(vec![returned]);let chunk=vec![InputEvent{key:OwnedKey::Wheel(-120),up:false}];
            let r=dispatch_counted(&f,&c,&[chunk],None,&mut api,&||Ok(h.clone()),&||13).unwrap();
            assert_eq!(r.primary[0].requested,1);assert_eq!(r.primary[0].sent,returned);assert!(r.cleanup.is_empty());assert_eq!(api.calls,1);
            assert!(c.effects.possible.load(Ordering::SeqCst));assert!(c.effects.focus.load(Ordering::SeqCst));
            assert_eq!(r.outcome,if returned==Some(1){NativeOutcome::Sent}else if returned.is_none(){NativeOutcome::Unknown}else{NativeOutcome::Partial});
        }
    }
    #[test] fn remote_fixed_deadline_cannot_be_renewed_by_local_permit() {
        let f=foundation();let h=host(&f,"o");f.reserve_operation(h.clone(),plan(1),10).unwrap();
        let permit=f.issue_permit_until(&h,0,11,14).unwrap();assert_eq!(permit.expires,14);
        assert!(matches!(f.consume(&permit,14),Err(FoundationError::Expired)));
        assert!(matches!(f.consume(&permit,15),Err(FoundationError::OperationRevoked)));
        assert!(f.issue_permit_until(&h,0,15,16).is_err());
    }
    #[test] fn actual_count_copy_survives_reset_rejection_of_admission_retention() {
        let f=foundation();let h=host(&f,"o");let c=consumed(&f,&h);let mut api=Fake::new(vec![Some(1),Some(1)]);
        let record=dispatch_counted(&f,&c,&[pair()],None,&mut api,&||Ok(h.clone()),&||13).unwrap();
        let immutable=record.clone();f.disable_boot().unwrap();
        f.install_boot(f.boot_epoch(),f.scope_epoch(),[8;32]).unwrap();
        assert!(matches!(f.retain_dispatch(c,record,true),Err(FoundationError::UnknownPermit)));
        assert_eq!(immutable.primary[0].requested,2);assert_eq!(immutable.primary[0].sent,Some(1));
        assert_eq!(immutable.cleanup[0].requested,1);assert_eq!(immutable.cleanup[0].sent,Some(1));assert!(immutable.possible_effect);
    }
    #[test] fn authenticated_source_and_pre_request_focus_ttl_cannot_be_extended() {
        assert!(bounded_native_source_ttl(100,1100,101,30000));
        assert!(!bounded_native_source_ttl(100,1101,101,30000));
        assert!(!bounded_native_source_ttl(102,1100,101,30000));
        assert!(!bounded_native_source_ttl(0,1000,101,30000));
        assert!(!bounded_native_source_ttl(100,1100,1100,30000));
        assert!(!bounded_native_source_ttl(100,1100,101,1099));
        // HTTP returned at 1099: receipt+1000 is not the original cap.
        assert!(bounded_native_source_ttl(100,1100,1099,30000));
        assert!(!bounded_native_source_ttl(100,2099,1099,30000));
        assert!(!bounded_native_source_ttl(u64::MAX-1,u64::MAX,u64::MAX-1,u64::MAX));
        assert!(!bounded_native_source_ttl(9_007_199_254_740_000,9_007_199_254_741_000,9_007_199_254_740_001,9_007_199_254_741_000));
    }
    #[test] fn original_root_rejects_reused_pid_wrong_hwnd_and_changed_runtime() {
        let retained=NativeRootIdentity{pid:7,creation:11,hwnd:13,runtime:vec![1,2],path:"C:/browser.exe".into(),fingerprint:"actual-image-hash".into()};
        assert!(native_root_identity_matches(&retained,&retained));
        let mut wrong=retained.clone();wrong.creation+=1;assert!(!native_root_identity_matches(&retained,&wrong));
        wrong=retained.clone();wrong.hwnd+=1;assert!(!native_root_identity_matches(&retained,&wrong));
        wrong=retained.clone();wrong.pid+=1;assert!(!native_root_identity_matches(&retained,&wrong));
        wrong=retained.clone();wrong.runtime.push(3);assert!(!native_root_identity_matches(&retained,&wrong));
        wrong=retained.clone();wrong.fingerprint.push('x');assert!(!native_root_identity_matches(&retained,&wrong));
    }
    #[test] fn retirement_requires_last_exact_primary_not_short_unknown_or_cleanup() {
        assert!(native_retirement_can_follow_exact_input(true,2,Some(2),0));
        for count in [None,Some(0),Some(1),Some(3)]{assert!(!native_retirement_can_follow_exact_input(true,2,count,0));}
        assert!(!native_retirement_can_follow_exact_input(true,2,Some(2),1));
        assert!(!native_retirement_can_follow_exact_input(false,2,Some(2),0));
        assert!(!native_retirement_can_follow_exact_input(true,0,Some(0),0));
    }
    #[test] fn native_anchor_scroll_profiles_reject_wrong_control_and_competing_ancestry() {
        assert!(native_target_profile("INPUT","text",true)==Some(NativeTargetProfile::Edit));
        assert!(native_target_profile("A","a",false)==Some(NativeTargetProfile::Anchor));
        assert!(native_target_profile("DIV","scroll-surface",false)==Some(NativeTargetProfile::Scroll));
        assert!(native_target_profile("A","a",true).is_none());
        assert!(!native_profile_control(NativeTargetProfile::Anchor,50020));
        assert!(!native_profile_control(NativeTargetProfile::Scroll,50030));
        assert!(native_exact_hit_cardinality(1,true));
        assert!(!native_exact_hit_cardinality(2,true));assert!(!native_exact_hit_cardinality(1,false));
        assert!(native_scroll_ancestry_unique(1,true));
        assert!(!native_scroll_ancestry_unique(2,true));assert!(!native_scroll_ancestry_unique(1,false));
        let full=(0.0,-200.0,500.0,1500.0);
        assert!(native_css_point_allowed(800,600,(100.0,200.0),full,true));
        assert!(!native_css_point_allowed(800,600,(100.0,200.0),full,false));
        assert!(!native_css_point_allowed(800,600,(100.0,700.0),full,true));
        assert!(!native_css_point_allowed(800,600,(600.0,200.0),full,true));
    }
    #[test] fn native_desktop_and_sid_bytes_deny_malformed_unbounded_facts() {
        assert_eq!(decode_native_object_name(&[68,0],4),Some("D".into()));
        for (bytes,units) in [(3,vec![68,0]),(6,vec![68,0]),(4,vec![68,69]),(6,vec![68,0,0]),(4,vec![0xd800,0])]{assert!(decode_native_object_name(&units,bytes).is_none());}
        let sid=[1,1,0,0,0,0,0,16,0,32,0,0];assert_eq!(decode_native_integrity_sid(&sid,0,0x20),Some(8192));
        assert!(decode_native_integrity_sid(&sid,usize::MAX,0x20).is_none());
        assert!(decode_native_integrity_sid(&sid[..11],0,0x20).is_none());
        assert!(decode_native_integrity_sid(&sid,0,0).is_none());
        let mut malformed=sid;malformed[1]=2;assert!(decode_native_integrity_sid(&malformed,0,0x20).is_none());
        malformed=sid;malformed[7]=5;assert!(decode_native_integrity_sid(&malformed,0,0x20).is_none());
    }
    #[test] fn native_environment_requires_visible_input_and_stable_effective_token() {
        let token=NativeTokenFacts{integrity:8192,ui_access:false,token_id:(1,0)};
        let facts=NativeEnvironmentFacts{station:"WinSta0".into(),station_visible:true,input_receives:true,caller_desktop:"Default".into(),input_desktop:"Default".into(),target_desktop:"Default".into(),caller:token.clone(),effective:token.clone(),target:token,foreground_is_original_or_managed:true};
        assert!(native_environment_stable(&facts,&facts));
        let mut wrong=facts.clone();wrong.station_visible=false;assert!(!native_environment_eligible(&wrong));
        wrong=facts.clone();wrong.input_receives=false;assert!(!native_environment_eligible(&wrong));
        wrong=facts.clone();wrong.caller_desktop="Other".into();assert!(!native_environment_eligible(&wrong));
        wrong=facts.clone();wrong.effective.integrity=4096;assert!(!native_environment_eligible(&wrong));
        wrong=facts.clone();wrong.effective.ui_access=true;assert!(!native_environment_eligible(&wrong));
        wrong=facts.clone();wrong.effective.token_id=(2,0);assert!(native_environment_eligible(&wrong));assert!(!native_environment_stable(&facts,&wrong));
        wrong=facts.clone();wrong.foreground_is_original_or_managed=false;assert!(!native_environment_eligible(&wrong));
    }

}
