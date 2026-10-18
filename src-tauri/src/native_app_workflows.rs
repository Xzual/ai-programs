//! Installed-app opening and semantic UIA helpers. Receipts describe observed state only.
use serde::{Deserialize, Serialize};
use crate::native_app_operators::{self, AllowedApp};
use crate::native_uia::{self, ControlState};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppOpenReceipt {
    pub app: String,
    pub window_id: String,
    pub process_id: u32,
    pub launch_requested: bool,
    pub started_process_id: Option<u32>,
    pub source: &'static str,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VolumeReceipt {
    pub target_id: String,
    pub requested_volume: u8,
    pub observed_value: f64,
    pub minimum: f64,
    pub maximum: f64,
    pub matched: bool,
    pub source: &'static str,
}

pub fn open(app: &str, guard: &dyn Fn() -> Result<(), String>) -> Result<AppOpenReceipt, String> {
    guard()?;
    let allowed = match app {
        "spotify" => AllowedApp::Spotify, "steam" => AllowedApp::Steam, "explorer" => AllowedApp::Explorer,
        _ => return Err("app is outside the installed-app opening allowlist".into()),
    };
    let result = native_app_operators::ensure_open(allowed, guard);
    guard()?;
    let opened = result?;
    Ok(AppOpenReceipt { app: app.into(), window_id: format!("hwnd:{:x}", opened.window.handle),
        process_id: opened.window.process_id, launch_requested: opened.launch_requested,
        started_process_id: opened.started_process_id, source: "installed_app_operator" })
}

pub fn snapshot(hwnd: isize, pid: u32, guard: &dyn Fn() -> Result<(), String>) -> Result<Vec<ControlState>, String> {
    guard()?;
    if hwnd == 0 || pid == 0 { return Err("semantic snapshot requires an owned native window and PID".into()); }
    let result = native_uia::snapshot(hwnd, pid);
    guard()?;
    result
}

fn range(control: &ControlState) -> Result<(f64, f64, f64), String> {
    let value = control.range_value.ok_or("target has no observed UIA RangeValue")?;
    let min = control.range_min.ok_or("target has no observed UIA range minimum")?;
    let max = control.range_max.ok_or("target has no observed UIA range maximum")?;
    if !value.is_finite() || !min.is_finite() || !max.is_finite() || max <= min
        || !(max-min).is_finite() || value < min || value > max {
        return Err("target has invalid observed UIA range provenance".into());
    }
    Ok((value, min, max))
}

pub fn set_volume(hwnd: isize, pid: u32, target_id: &str, volume: u8,
    guard: &dyn Fn() -> Result<(), String>) -> Result<VolumeReceipt, String> {
    guard()?;
    if volume > 100 || target_id.is_empty() || target_id.len() > 1024 {
        return Err("volume requires 0..100 and one bounded semantic target ID".into());
    }
    let controls = snapshot(hwnd, pid, guard)?;
    let mut matching = controls.iter().filter(|control| volume_slider(control));
    let control = matching.next().ok_or("volume target was not observed in the owned window")?;
    if matching.next().is_some() { return Err("volume target is ambiguous".into()); }
    if control.target_id != target_id { return Err("target is not the unique named volume slider".into()); }
    let (_, min, max) = range(control)?;
    let span = max-min;
    let tolerance = (span * 1e-6).max(f64::EPSILON * min.abs().max(max.abs()).max(span) * 4.0);
    if tolerance == 0.0 || tolerance > span * 1e-3 {
        return Err("UIA range has insufficient numeric resolution for volume verification".into());
    }
    let desired = match volume { 0 => min, 100 => max, _ => min + span * (volume as f64 / 100.0) };
    guard()?;
    let result = native_uia::set_range(hwnd, pid, target_id, desired, guard);
    guard()?;
    let changed = result?;
    if changed.target_id != target_id || !volume_slider(&changed) { return Err("range mutation readback target changed".into()); }
    let (_, changed_min, changed_max) = range(&changed)?;
    if (changed_min-min).abs() > tolerance || (changed_max-max).abs() > tolerance {
        return Err("UIA range bounds changed during volume mutation".into());
    }
    // Independent fresh observation proves the requested state persisted on this target.
    let readback = snapshot(hwnd, pid, guard)?;
    let mut matching = readback.iter().filter(|state| volume_slider(state));
    let actual = matching.next().ok_or("volume target disappeared after mutation")?;
    if matching.next().is_some() { return Err("volume readback target is ambiguous".into()); }
    if actual.target_id != target_id { return Err("volume readback target changed".into()); }
    let (value, actual_min, actual_max) = range(actual)?;
    if (actual_min-min).abs() > tolerance || (actual_max-max).abs() > tolerance || (value-desired).abs() > tolerance {
        return Err("UIA volume range postcondition was not observed".into());
    }
    guard()?;
    Ok(VolumeReceipt { target_id: target_id.into(), requested_volume: volume,
        observed_value: value, minimum: min, maximum: max, matched: true, source: "semantic_range_pattern" })
}

fn volume_slider(control: &ControlState) -> bool {
    control.control_type == 50015 && matches!(control.name.trim().to_lowercase().as_str(), "volume" | "ses düzeyi" | "ses seviyesi")
}

// Provider-derived proof only: matching an unselected or duplicate name is insufficient.
pub(crate) fn explorer_selection_proof(controls: &[ControlState], approved_path: &str) -> Result<(), String> {
    let (directory, filename) = approved_path.rsplit_once(['\\', '/']).ok_or("Approved Explorer path has no parent")?;
    let normalize = |value: &str| value.replace('/', "\\").trim_end_matches('\\').to_lowercase();
    let addresses = controls.iter().filter(|c| c.control_type == 50004
        && matches!(c.name.trim().to_lowercase().as_str(), "address" | "adres" | "address bar" | "adres çubuğu")
        && c.value.as_ref().is_some_and(|v| normalize(v) == normalize(directory))).count();
    let entries: Vec<_> = controls.iter().filter(|c| matches!(c.control_type, 50007 | 50029)).collect();
    let named: Vec<_> = entries.iter().filter(|c| c.name == filename).collect();
    let selected: Vec<_> = entries.iter().filter(|c| c.selected == Some(true)).collect();
    if addresses != 1 || named.len() != 1 || selected.len() != 1 || named[0].target_id != selected[0].target_id {
        return Err("Actual Explorer state does not prove exact approved folder and one uniquely selected item".into());
    }
    Ok(())
}

fn explorer_folder_proof(controls: &[ControlState], path: &str) -> Result<(), String> {
    let (directory, _) = path.rsplit_once(['\\', '/']).ok_or("Approved Explorer path has no parent")?;
    let normalize = |v: &str| v.replace('/', "\\").trim_end_matches('\\').to_lowercase();
    if controls.iter().filter(|c| c.control_type == 50004
        && matches!(c.name.trim().to_lowercase().as_str(), "address" | "adres" | "address bar" | "adres çubuğu")
        && c.value.as_ref().is_some_and(|v| normalize(v) == normalize(directory))).count() != 1 {
        return Err("Actual Explorer address does not uniquely match approved destination parent".into());
    }
    Ok(())
}

// Private transport and independent provider-derived task proof. The command
// layer supplies session/epoch/kill/reservation guards. These helpers dispatch
// no filesystem mutations and accept no frontend proof or private context.
use std::{collections::HashMap, io::Read, sync::{Mutex, OnceLock}, time::{Duration, SystemTime, UNIX_EPOCH}};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

#[derive(Clone, Debug, Deserialize,Serialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct TaskIntent { pub app:String, pub workflow:String, pub query:Option<String>, pub volume:Option<u8>, pub game_name:Option<String> }
impl TaskIntent {
    pub(crate) fn validate(&self)->Result<(),String>{
        let supported=match self.app.as_str(){
            "spotify"=>matches!(self.workflow.as_str(),"open"|"focus"|"play"|"pause"|"next"|"previous"|"library"|"search"|"volume"),
            "steam"=>matches!(self.workflow.as_str(),"open"|"focus"|"library"|"downloads"|"search"|"game_detail"),_=>false};
        if !supported || (self.workflow=="search")!=self.query.is_some() || (self.workflow=="volume")!=self.volume.is_some() || (self.workflow=="game_detail")!=self.game_name.is_some() || self.game_name.as_ref().is_some_and(|v|!valid_game_name(v))
            ||self.query.as_ref().is_some_and(|q|q.trim().is_empty()||q.chars().count()>160||q.chars().any(|c|c.is_control()))||self.volume.is_some_and(|v|v>100){
            return Err("Native task intent is outside bounded app workflow allowlist".into());
        }Ok(())
    }
}

#[derive(Clone)]
struct TaskTarget {window_id:String,pid:u32,image:String,hwnd:isize}
#[derive(Clone)]
struct RequestedSkip{canonical_action:String,target_id:String,name_fingerprint:String}
#[derive(Clone)]
struct RequestedGameNavigation{canonical_action:String,target_id:String,control_type:i32,name_fingerprint:String,entry_fingerprint:String}
#[derive(Clone,Debug)]
pub(crate) struct SteamOriginalScope {
    pub session_id:String,pub safety_session_ref:String,pub original_epoch:u64,pub native_expires_at_ms:u64,
}
#[derive(Clone,Debug,PartialEq,Eq)]
pub(crate) struct SteamInputCounts {
    pub requested_primary:u32,pub returned_primary:u32,pub cleanup_requested:u32,pub cleanup_returned:u32,
    pub release_confirmed:bool,pub completed_at_ms:u64,
}
fn steam_counts_complete(counts:&SteamInputCounts,deadline:u64)->bool {
    counts.requested_primary==2&&counts.returned_primary==2&&counts.cleanup_requested<=1
        &&counts.cleanup_returned==counts.cleanup_requested&&counts.release_confirmed
        &&counts.completed_at_ms>0&&counts.completed_at_ms<deadline
}
#[derive(Debug)]
struct HeldSteamRoot {
    identity:crate::native_calculator_identity::NativeWindowIdentity,
    physical_rect:[i32;4],
    #[cfg(windows)] process:std::os::windows::io::OwnedHandle,
}
#[cfg(windows)]
fn steam_physical_root_rect(hwnd:isize)->Result<[i32;4],String>{
    use windows_sys::Win32::{Foundation::RECT,UI::{HiDpi::{SetThreadDpiAwarenessContext,GetThreadDpiAwarenessContext,AreDpiAwarenessContextsEqual,DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2},WindowsAndMessaging::GetWindowRect}};
    let previous=unsafe{SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2)};
    if previous.is_null(){return Err("Steam physical DPI context unavailable".into());}
    let mut rect=RECT::default();
    let measured=unsafe{AreDpiAwarenessContextsEqual(GetThreadDpiAwarenessContext(),DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2)}!=0
        &&unsafe{GetWindowRect(hwnd as windows_sys::Win32::Foundation::HWND,&mut rect)}!=0;
    let restored=unsafe{SetThreadDpiAwarenessContext(previous)};
    if !measured||restored.is_null()||rect.right<=rect.left||rect.bottom<=rect.top{return Err("Steam physical root geometry unavailable".into());}
    Ok([rect.left,rect.top,rect.right,rect.bottom])
}
fn steam_geometry_same(retained:[i32;4],current:[i32;4])->bool{
    retained[2]>retained[0]&&retained[3]>retained[1]&&retained==current
}
impl HeldSteamRoot {
    fn capture(target:&TaskTarget)->Result<std::sync::Arc<Self>,String>{
        #[cfg(not(windows))]{let _=target;Err("Steam held root unavailable on this platform".into())}
        #[cfg(windows)]{
            use std::os::windows::io::FromRawHandle;
            use windows_sys::Win32::System::Threading::{OpenProcess,PROCESS_QUERY_LIMITED_INFORMATION,PROCESS_SYNCHRONIZE};
            let before=crate::native_calculator_identity::observe(target.hwnd,target.pid)?;
            if before.content.is_some()||text_hash(&before.root_image)!=target.image{return Err("Steam original root image mismatch".into());}
            let raw=unsafe{OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION|PROCESS_SYNCHRONIZE,0,target.pid)};
            if raw.is_null(){return Err("Steam original process cannot be held".into());}
            // Own the handle before the fallible geometry read, so every error
            // releases it normally instead of leaking original process ownership.
            let process=unsafe{std::os::windows::io::OwnedHandle::from_raw_handle(raw)};
            let physical_rect=steam_physical_root_rect(target.hwnd)?;
            let root=std::sync::Arc::new(Self{identity:before,physical_rect,process});
            root.revalidate(target)?;Ok(root)
        }
    }
    fn revalidate(&self,target:&TaskTarget)->Result<(),String>{
        if target.hwnd!=self.identity.root_hwnd||target.pid!=self.identity.root_pid||text_hash(&self.identity.root_image)!=target.image{
            return Err("Steam retained original root changed".into());
        }
        #[cfg(not(windows))] return Err("Steam held root unavailable on this platform".into());
        #[cfg(windows)]{
            use std::os::windows::io::AsRawHandle;
            use windows_sys::Win32::{Foundation::{FILETIME,WAIT_TIMEOUT},System::Threading::{GetProcessTimes,QueryFullProcessImageNameW,WaitForSingleObject},UI::WindowsAndMessaging::{GetForegroundWindow,GetAncestor,GetWindowThreadProcessId,IsWindow,GA_ROOT}};
            let handle=self.process.as_raw_handle();
            let mut creation=FILETIME::default();let mut exit=FILETIME::default();let mut kernel=FILETIME::default();let mut user=FILETIME::default();
            let mut image=vec![0u16;32768];let mut length=image.len() as u32;
            if unsafe{WaitForSingleObject(handle,0)}!=WAIT_TIMEOUT
                ||unsafe{GetProcessTimes(handle,&mut creation,&mut exit,&mut kernel,&mut user)}==0
                ||unsafe{QueryFullProcessImageNameW(handle,0,image.as_mut_ptr(),&mut length)}==0
                ||length==0||length as usize>=image.len(){return Err("Steam held original process unavailable or exited".into());}
            let created=((creation.dwHighDateTime as u64)<<32)|creation.dwLowDateTime as u64;
            let path=std::path::PathBuf::from(String::from_utf16(&image[..length as usize]).map_err(|_|"Steam held image encoding invalid")?)
                .canonicalize().map_err(|_|"Steam held image unavailable")?;
            if created!=self.identity.root_created||text_hash(&path.to_string_lossy())!=target.image{return Err("Steam original process lifetime changed".into());}
            let hwnd=target.hwnd as windows_sys::Win32::Foundation::HWND;let mut pid=0;
            unsafe{GetWindowThreadProcessId(hwnd,&mut pid);}
            if unsafe{IsWindow(hwnd)}==0||pid!=target.pid||unsafe{GetAncestor(hwnd,GA_ROOT)}!=hwnd||unsafe{GetForegroundWindow()}!=hwnd{
                return Err("Steam original root/foreground changed".into());
            }
            if !steam_geometry_same(self.physical_rect,steam_physical_root_rect(target.hwnd)?){return Err("Steam original physical root geometry changed".into());}
            crate::native_calculator_identity::revalidate(&self.identity)
        }
    }
}
#[derive(Clone)]
struct TaskBinding {source:Value,bridge:String,app:String,query:Option<String>,target:Option<TaskTarget>,
    pending:Option<(String,String)>,mapped:HashMap<String,String>,last_post:Option<Value>,blocked:bool,expires_at:u64,
    requested_dispatch:bool,pending_requested:bool,pending_skip:Option<RequestedSkip>,pending_pre:Option<Value>,
    game_name:Option<String>,game_entry:Option<native_uia::SteamEntryObservation>,steam_library:Option<native_uia::SteamApprovedLibraryEntry>,steam_ledger_revision:u64,pending_game:Option<RequestedGameNavigation>,last_game:bool,
    steam_scope:Option<SteamOriginalScope>,steam_root:Option<std::sync::Arc<HeldSteamRoot>>,steam_counts:Option<(String,SteamInputCounts)>,steam_effective_expiry:Option<u64>}
static TASK_BINDINGS:OnceLock<Mutex<HashMap<(String,String),TaskBinding>>>=OnceLock::new();
static TASK_TOMBSTONES:OnceLock<Mutex<HashMap<(String,String),u64>>>=OnceLock::new();
fn tombstones()->&'static Mutex<HashMap<(String,String),u64>>{TASK_TOMBSTONES.get_or_init(||Mutex::new(HashMap::new()))}
fn task_not_tombstoned(session:&str,workflow:&str)->Result<(),String>{let mut rows=tombstones().lock().map_err(|_|"Native task tombstone ledger unavailable")?;rows.retain(|_,expiry|*expiry>now_ms().unwrap_or(u64::MAX));if rows.len()>=64||rows.contains_key(&(session.into(),workflow.into())){return Err("Native task workflow permanently blocked for this approval lifetime".into());}Ok(())}
#[derive(Clone)]
struct TaskRegistration{owner:String,intent:TaskIntent,target:Option<TaskTarget>,bridge:String,expires:u64,steam_scope:Option<SteamOriginalScope>,steam_root:Option<std::sync::Arc<HeldSteamRoot>>}
static TASK_REGISTRATIONS:OnceLock<Mutex<HashMap<(String,String),TaskRegistration>>>=OnceLock::new();
fn registrations()->&'static Mutex<HashMap<(String,String),TaskRegistration>>{TASK_REGISTRATIONS.get_or_init(||Mutex::new(HashMap::new()))}
static TASK_OBSERVATION:std::sync::atomic::AtomicU64=std::sync::atomic::AtomicU64::new(1);
fn task_bindings()->&'static Mutex<HashMap<(String,String),TaskBinding>>{TASK_BINDINGS.get_or_init(||Mutex::new(HashMap::new()))}
pub(crate) fn task_is_bound(session:&str,workflow:Option<&str>)->Result<bool,String>{let Some(workflow)=workflow else{return Ok(false)};task_not_tombstoned(session,workflow)?;Ok(task_bindings().lock().map_err(|_|"Native task ledger unavailable")?.contains_key(&(session.into(),workflow.into())))}
fn task_id(value:&str)->bool{!value.is_empty()&&value.len()<=160&&value.bytes().all(|b|b.is_ascii_alphanumeric()||matches!(b,b':'|b'-'|b'_'))}
fn text_hash(value:&str)->String{format!("{:x}",Sha256::digest(value.as_bytes()))}
fn ecma_trim(value:&str)->&str{value.trim_matches(|c:char|matches!(c,'\u{0009}'..='\u{000d}'|'\u{0020}'|'\u{00a0}'|'\u{1680}'|'\u{2000}'..='\u{200a}'|'\u{2028}'|'\u{2029}'|'\u{202f}'|'\u{205f}'|'\u{3000}'|'\u{feff}'))}
fn valid_game_name(value:&str)->bool{!ecma_trim(value).is_empty()&&value.chars().count()<=160&&value.len()<=640&&!value.chars().any(|c|matches!(c,'\u{0000}'..='\u{001f}'|'\u{007f}'..='\u{009f}'))}
fn game_request_digest(value:&str,workflow:&str)->String{
    // Match the producer's exact JSON.stringify order and raw (untrimmed) name.
    text_hash(&format!("{{\"request\":{{\"app\":\"steam\",\"workflow\":\"game_detail\",\"gameName\":{}}},\"workflowId\":{}}}",serde_json::to_string(value).unwrap(),serde_json::to_string(workflow).unwrap()))
}
fn steam_path(path:&[native_uia::SteamPathNode])->Value{json!(path.iter().map(|n|json!([n.runtime_id,n.control_type])).collect::<Vec<_>>())}
fn steam_entry_hash(row:&TaskBinding,target:&TaskTarget,entry:&native_uia::SteamEntryObservation)->String{
    text_hash(&json!(["steam-entry-v1",row.source["requestDigest"],target.window_id,target.pid,target.image,entry.runtime_id,ecma_trim(&entry.name),steam_path(&entry.ancestry)]).to_string())
}
fn steam_scope_current(row:&TaskBinding,target:&TaskTarget,guard:&dyn Fn()->Result<(),String>)->Result<(),String>{
    guard()?;let scope=row.steam_scope.as_ref().ok_or("Steam original scope missing")?;
    if scope.session_id!=row.source["sessionId"].as_str().unwrap_or("")||scope.safety_session_ref.is_empty()
        ||now_ms()?>=row.expires_at.min(scope.native_expires_at_ms).min(row.steam_effective_expiry.unwrap_or(u64::MAX)){
        return Err("Steam original scope/deadline changed or expired".into());
    }
    row.steam_root.as_ref().ok_or("Steam original held root missing")?.revalidate(target)?;guard()
}

// Private checkout identity: never a safety epoch, observation generation or wire authority.
fn steam_marked(row:&TaskBinding)->bool{row.app=="steam"&&row.source["request"]["workflow"]==json!("game_detail")}
fn steam_revision_next(revision:u64)->Result<u64,String>{revision.checked_add(1).ok_or("Steam private checkout revision exhausted".into())}
fn steam_entry_same(a:&native_uia::SteamEntryObservation,b:&native_uia::SteamEntryObservation)->bool{
    a.runtime_id==b.runtime_id&&a.name==b.name&&a.ancestry==b.ancestry
        &&a.target.target_id==b.target.target_id&&a.target.name==b.target.name&&a.target.control_type==b.target.control_type
        &&(a.target.x,a.target.y,a.target.width,a.target.height,a.target.process_id,a.target.hwnd)
            ==(b.target.x,b.target.y,b.target.width,b.target.height,b.target.process_id,b.target.hwnd)
}
fn steam_profile_same(a:(&str,i32,&str,&str,i32),b:(&str,i32,&str,&str,i32))->bool{a==b}
fn steam_library_same(a:&native_uia::SteamApprovedLibraryEntry,b:&native_uia::SteamApprovedLibraryEntry)->bool{
    steam_entry_same(&a.entry,&b.entry)&&a.same_pre_context(b)&&steam_profile_same(
        (&a.profile_fingerprint,a.profile_version,&a.provider_identity,&a.evidence_set_digest,a.registry_revision),
        (&b.profile_fingerprint,b.profile_version,&b.provider_identity,&b.evidence_set_digest,b.registry_revision))
}
fn steam_original_same(a:&TaskBinding,b:&TaskBinding)->bool{
    let target=|r:&TaskBinding|r.target.as_ref().map(|t|(t.hwnd,t.pid,t.window_id.clone(),t.image.clone()));
    let scope=|r:&TaskBinding|r.steam_scope.as_ref().map(|s|(s.session_id.clone(),s.safety_session_ref.clone(),s.original_epoch,s.native_expires_at_ms));
    a.source==b.source&&a.bridge==b.bridge&&a.app==b.app&&a.game_name==b.game_name&&a.expires_at==b.expires_at
        &&target(a)==target(b)&&scope(a)==scope(b)
        &&match(&a.steam_root,&b.steam_root){(Some(x),Some(y))=>std::sync::Arc::ptr_eq(x,y),(None,None)=>true,_=>false}
}
fn steam_checkout_identity(current:Option<&TaskBinding>,expected:&TaskBinding)->bool{
    current.is_some_and(|row|steam_original_same(row,expected)&&row.steam_ledger_revision==expected.steam_ledger_revision&&row.blocked==expected.blocked)
}
fn steam_live_checkpoint(row:&TaskBinding)->Result<TaskBinding,String>{
    let session=row.source["sessionId"].as_str().ok_or("Steam original session missing")?;
    let workflow=row.source["reservationId"].as_str().ok_or("Steam original reservation missing")?;
    let current=steam_diagnostic_live_row(session,workflow)?;
    if !steam_checkout_identity(Some(&current),row){
        return Err("Steam original checkout changed".into());
    }
    Ok(current)
}
fn steam_checkout_current(row:&TaskBinding,checkpoint:&TaskBinding)->Result<(),String>{
    let current=steam_live_checkpoint(checkpoint)?;
    if !steam_diagnostic_same_state(&current,checkpoint)||!steam_original_same(row,checkpoint)
        ||row.target.is_some()!=row.steam_root.is_some()||now_ms()?>=steam_capture_deadline(row)?{return Err("Steam original checkout no longer current".into());}
    let scope=row.steam_scope.as_ref().ok_or("Steam original safety scope missing")?;
    if scope.session_id!=row.source["sessionId"].as_str().unwrap_or("")||scope.safety_session_ref.is_empty(){return Err("Steam original safety scope changed".into());}
    Ok(())
}
fn steam_checkout_guard(row:&TaskBinding,checkpoint:&TaskBinding,guard:&dyn Fn()->Result<(),String>)->Result<(),String>{
    guard()?;steam_checkout_current(row,checkpoint)
}
fn steam_final_capture<T,F>(full_guard:&dyn Fn()->Result<(),String>,local_guard:&dyn Fn()->Result<(),String>,capture:F)->Result<T,String>
where F:FnOnce()->Result<T,String>{
    full_guard()?;local_guard()?;
    let work=capture();
    let post=local_guard();
    task_preserve_work(work,post)
}
fn steam_checkpoint_guard_local(row:&TaskBinding,checkpoint:&TaskBinding,target:&TaskTarget)->Result<(),String>{
    // No external guard / HTTP here. Actual local authority and held OS identity are still mandatory.
    steam_checkout_current(row,checkpoint)?;
    let current=steam_live_checkpoint(checkpoint)?;
    if !steam_diagnostic_same_row(&current,checkpoint){return Err("Steam original local task state changed".into());}
    row.steam_root.as_ref().ok_or("Steam original local held root missing")?.revalidate(target)?;
    steam_checkout_current(row,checkpoint)?;
    let current=steam_live_checkpoint(checkpoint)?;
    if !steam_diagnostic_same_row(&current,checkpoint){return Err("Steam original local task changed after root check".into());}
    Ok(())
}
fn steam_checkpoint_guard(row:&TaskBinding,checkpoint:&TaskBinding,target:&TaskTarget,guard:&dyn Fn()->Result<(),String>)->Result<(),String>{
    steam_checkout_guard(row,checkpoint,guard)?;
    let current=steam_live_checkpoint(checkpoint)?;
    if !steam_diagnostic_same_row(&current,checkpoint){return Err("Steam retained task state changed during capture".into());}
    steam_scope_current(row,target,guard)?;
    // The external guard can block on safety HTTP. Recheck after it without a ledger lock held.
    let current=steam_live_checkpoint(checkpoint)?;
    if !steam_diagnostic_same_row(&current,checkpoint){return Err("Steam retained task state changed after guard".into());}
    Ok(())
}
fn steam_capture_deadline(row:&TaskBinding)->Result<u64,String>{
    Ok(steam_diagnostic_deadline(row.expires_at,row.source["expiresAt"].as_u64().ok_or("Steam original source expiry missing")?,
        row.steam_scope.as_ref().ok_or("Steam original scope missing")?.native_expires_at_ms,row.steam_effective_expiry))
}
fn steam_selective_revalidate(row:&TaskBinding,target:&TaskTarget,guard:&dyn Fn()->Result<(),String>)->Result<native_uia::SteamApprovedLibraryEntry,String>{
    let checkpoint=steam_live_checkpoint(row)?;
    let scoped=||steam_checkpoint_guard(row,&checkpoint,target,guard);
    scoped()?;
    let retained=row.steam_library.as_ref().ok_or("NATIVE_STEAM_PROFILE_PIN_REQUIRED")?;
    let held:std::sync::Arc<dyn Send+Sync>=row.steam_root.as_ref().ok_or("Steam original held root missing")?.clone();
    let captured=native_uia::steam_revalidate_library_entry(target.hwnd,target.pid,retained,steam_capture_deadline(row)?,held,&scoped);
    let post=scoped();let captured=task_preserve_work(captured,post)?;
    if !steam_library_same(retained,&captured){return Err("NATIVE_STEAM_PROFILE_CHANGED".into());}
    Ok(captured)
}

pub(crate) fn task_steam_navigation_pending(session:&str,workflow:Option<&str>,canonical_action:&str)->Result<bool,String>{
    let Some(workflow)=workflow else{return Ok(false)};
    task_not_tombstoned(session,workflow)?;
    let rows=task_bindings().lock().map_err(|_|"Native task ledger unavailable")?;
    let Some(row)=rows.get(&(session.into(),workflow.into()))else{return Ok(false)};
    let Some(nav)=&row.pending_game else{return Ok(false)};
    if row.blocked||nav.canonical_action!=canonical_action||row.pending.as_ref().is_none_or(|p|row.mapped.get(canonical_action)!=Some(&p.0))
        ||row.steam_counts.is_some()||row.steam_effective_expiry.is_none_or(|t|t<=now_ms().unwrap_or(u64::MAX)){
        return Err("Steam issued navigation count authority unavailable".into());
    }
    Ok(true)
}
pub(crate) fn task_record_steam_dispatch(session:&str,workflow:Option<&str>,canonical_action:&str,counts:SteamInputCounts)->Result<(),String>{
    let workflow=workflow.ok_or("Steam count workflow missing")?;
    let mut rows=task_bindings().lock().map_err(|_|"Native task count ledger unavailable")?;
    let row=rows.get_mut(&(session.into(),workflow.into())).ok_or("Steam count binding missing")?;
    // Historical raw counts survive a STOP/expiry after input. This records no
    // renewed authority; all post/finish paths still require live original scope.
    if row.pending_game.as_ref().is_none_or(|n|n.canonical_action!=canonical_action)
        ||row.pending.as_ref().is_none_or(|p|row.mapped.get(canonical_action)!=Some(&p.0))||row.steam_counts.is_some(){
        row.blocked=true;return Err("Steam native count identity changed or replayed".into());
    }
    steam_store_dispatch_counts(row,canonical_action,counts)
}
fn steam_store_dispatch_counts(row:&mut TaskBinding,canonical_action:&str,counts:SteamInputCounts)->Result<(),String>{
    if row.steam_counts.is_some(){row.blocked=true;return Err("Steam actual count record cannot be replaced".into());}
    let complete=row.steam_effective_expiry.is_some_and(|t|steam_counts_complete(&counts,t));
    // Preserve historical actual counts even when the private replay counter can no longer advance.
    row.steam_counts=Some((canonical_action.into(),counts));
    match steam_revision_next(row.steam_ledger_revision){Ok(next)=>row.steam_ledger_revision=next,Err(error)=>{row.blocked=true;return Err(error);}}
    if !complete{row.blocked=true;return Err("Steam native raw input/cleanup incomplete".into());}Ok(())
}
fn steam_v2_tuple(prefix:[Value;13],evidence:[Value;10])->Value{
    Value::Array(prefix.into_iter().chain(evidence).collect())
}
fn steam_v2_context(row:&TaskBinding,target:&TaskTarget,entry_hash:&str,detail:&native_uia::SteamMainDetailObservation)->Result<String,String>{
    let scope=row.steam_scope.as_ref().ok_or("Steam original scope missing")?;
    let root=row.steam_root.as_ref().ok_or("Steam original held root missing")?;
    let expiry=row.steam_effective_expiry.ok_or("Steam original input deadline missing")?;
    let main=&detail.main;
    let title_hash=text_hash(ecma_trim(&main.title));
    if !identity(&detail.profile_fingerprint)||title_hash!=text_hash(ecma_trim(row.game_name.as_deref().ok_or("Steam immutable requested name missing")?)){
        return Err("Steam provider/title witness invalid".into());
    }
    let tuple=steam_v2_tuple([
        json!("steam-main-detail-v2"),row.source["requestDigest"].clone(),row.source["sessionId"].clone(),row.source["workflowId"].clone(),row.source["ownerBindingId"].clone(),
        json!(target.window_id),json!(target.pid),json!(target.image),json!(root.identity.root_created.to_string()),json!(scope.original_epoch.to_string()),json!(expiry.to_string()),json!(entry_hash),json!(detail.profile_fingerprint)
    ],[
        json!(main.document_runtime_id),json!(main.main_runtime_id),json!(main.title_runtime_id),steam_path(&main.main_ancestry),steam_path(&main.title_ancestry),
        json!(main.main_rect),json!(main.title_rect),main.main_semantic_facts.clone(),main.title_semantic_facts.clone(),
        json!(["provider-detail-state-v1",detail.profile_fingerprint,"library_game_detail",detail.observed_properties,detail.exclusion_properties])
    ]);
    Ok(text_hash(&tuple.to_string()))
}

#[cfg(test)]
mod steam_v2_workflow_fixtures{
    use super::*;
    #[test]
    fn genuine_count_record_rejects_partial_unknown_cleanup_and_expired(){
        let good=SteamInputCounts{requested_primary:2,returned_primary:2,cleanup_requested:0,cleanup_returned:0,release_confirmed:true,completed_at_ms:99};
        assert!(steam_counts_complete(&good,100));
        assert!(steam_counts_complete(&SteamInputCounts{cleanup_requested:1,cleanup_returned:1,..good.clone()},100));
        for invalid in [
            SteamInputCounts{returned_primary:1,..good.clone()},SteamInputCounts{requested_primary:1,..good.clone()},
            SteamInputCounts{cleanup_requested:1,..good.clone()},SteamInputCounts{cleanup_requested:2,cleanup_returned:2,..good.clone()},
            SteamInputCounts{release_confirmed:false,..good.clone()},SteamInputCounts{completed_at_ms:0,..good.clone()},
            SteamInputCounts{completed_at_ms:100,..good.clone()},SteamInputCounts{completed_at_ms:101,..good.clone()},
        ]{assert!(!steam_counts_complete(&invalid,100));}
    }
    #[test]
    fn canonical_tuple_keeps_order_raw_filetime_zero_epoch_and_decimal_expiry(){
        let prefix=[json!("steam-main-detail-v2"),json!("digest"),json!("session"),json!("workflow"),json!("owner"),json!("hwnd:1"),json!(42),json!("image"),json!(u64::MAX.to_string()),json!(0u64.to_string()),json!(9007199254740993u64.to_string()),json!("entry"),json!("profile")];
        let evidence=[json!([1]),json!([2]),json!([3]),json!([[[1],50032]]),json!([[[2],50033]]),json!([0,0,100,100]),json!([1,1,99,20]),json!(["uia-main-v1",80002,"main",false,false,false,[3]]),json!(["uia-primary-heading-v1","heading",1,"title"]),json!(["provider-detail-state-v1","profile","library_game_detail",[],[]])];
        let tuple=steam_v2_tuple(prefix,evidence);
        assert_eq!(tuple.as_array().unwrap().len(),23);
        assert_eq!(tuple.to_string(),r#"["steam-main-detail-v2","digest","session","workflow","owner","hwnd:1",42,"image","18446744073709551615","0","9007199254740993","entry","profile",[1],[2],[3],[[[1],50032]],[[[2],50033]],[0,0,100,100],[1,1,99,20],["uia-main-v1",80002,"main",false,false,false,[3]],["uia-primary-heading-v1","heading",1,"title"],["provider-detail-state-v1","profile","library_game_detail",[],[]]]"#);
        assert_ne!(game_request_digest(" Game ","workflow"),game_request_digest("Game","workflow"));
        assert_eq!(ecma_trim("\u{feff}Game\u{00a0}"),"Game");
        assert_ne!(ecma_trim("\u{0085}Game"),"Game");
    }
}
// Collection authority never enters the mutation/profile approval ledger. The
// sticky marker survives read-end and failures for the original session lifetime.
static STEAM_READ_ONLY:OnceLock<Mutex<HashMap<(String,String),u64>>>=OnceLock::new();
fn steam_read_only()->&'static Mutex<HashMap<(String,String),u64>>{STEAM_READ_ONLY.get_or_init(||Mutex::new(HashMap::new()))}
fn steam_read_marked(session:&str,workflow:&str)->Result<bool,String>{
    let mut rows=steam_read_only().lock().map_err(|_|"Steam read authority unavailable")?;
    let now=now_ms()?;rows.retain(|_,expiry|*expiry>now);
    Ok(rows.contains_key(&(session.into(),workflow.into())))
}
fn steam_read_deny_mutation(session:&str,workflow:Option<&str>)->Result<(),String>{
    let _=workflow;
    let mut rows=steam_read_only().lock().map_err(|_|"Steam read authority unavailable")?;
    let now=now_ms()?;rows.retain(|_,expiry|*expiry>now);
    // Missing/alternate workflow must not turn a collection session into input.
    if rows.keys().any(|(id,_)|id==session){return Err("CONFIGURATION_REQUIRED".into());}Ok(())
}
#[derive(Clone,Default)]
struct SteamReadProgress{used:u8,in_flight:bool,failed:bool,ended:bool,generation:u64,finalized_generation:u64}
const STEAM_READ_STATES:[&str;7]=["Library MAIN pre","DETAIL MAIN positive","same-root sidebar","same-root Properties","same-root settings","same-root overlay","same-root other panel"];
impl SteamReadProgress{
    fn reserve(&mut self,state:&str)->Result<u64,String>{
        let index=STEAM_READ_STATES.iter().position(|v|*v==state).ok_or("STEAM_READ_INVALID_REQUEST")?;
        if self.failed{return Err("STEAM_READ_SCOPE_CHANGED".into());}
        if self.ended{return Err("STEAM_READ_ENDED".into());}
        if self.in_flight{return Err("STEAM_READ_BUSY".into());}
        if self.used&(1<<index)!=0{return Err("STEAM_READ_REPLAY".into());}
        let generation=self.generation.checked_add(1).ok_or("STEAM_READ_CAPACITY")?;
        self.used|=1<<index;self.in_flight=true;self.generation=generation;Ok(generation)
    }
    fn complete(&mut self,generation:u64,success:bool)->Result<(),String>{
        let matched=self.in_flight&&self.generation==generation;
        // This is sample-call bookkeeping, never a provider-quiescence claim.
        // Actual worker lifetime remains enforced by the native UIA worker gate.
        if matched{self.in_flight=false;}
        if !matched||self.failed||self.ended{self.failed=true;return Err("STEAM_READ_SCOPE_CHANGED".into());}
        if !success{self.failed=true;}Ok(())
    }
}
#[derive(Clone)]
struct SteamReadGrant{reference:String,original:TaskBinding,root:std::sync::Weak<HeldSteamRoot>,owner:String,deadline:u64,replay_until:u64,progress:SteamReadProgress}
static STEAM_READ_GRANTS:OnceLock<Mutex<HashMap<(String,String),SteamReadGrant>>>=OnceLock::new();
fn steam_read_grants()->&'static Mutex<HashMap<(String,String),SteamReadGrant>>{STEAM_READ_GRANTS.get_or_init(||Mutex::new(HashMap::new()))}
fn steam_read_live_row(session:&str,workflow:&str)->Result<TaskBinding,String>{
    task_not_tombstoned(session,workflow)?;
    task_bindings().lock().map_err(|_|"Steam read task unavailable")?.get(&(session.into(),workflow.into())).cloned().ok_or("CONFIGURATION_REQUIRED".into())
}
fn steam_read_deadline(row:&TaskBinding,session:&str,workflow:&str,scope:&SteamOriginalScope,owner:&str,now:u64)->Result<u64,String>{
    if row.blocked||row.source["ownerBindingId"]!=json!(owner)||!row.steam_scope.as_ref().is_some_and(|s|steam_diagnostic_scope_matches(s,scope,session)){return Err("STEAM_READ_SCOPE_CHANGED".into());}
    let raw=steam_diagnostic_deadline(row.expires_at,row.source["expiresAt"].as_u64().ok_or("STEAM_READ_SCOPE_CHANGED")?,scope.native_expires_at_ms,row.steam_effective_expiry);
    if now>=raw{return Err("STEAM_READ_SCOPE_EXPIRED".into());}
    let target=row.target.as_ref().ok_or("STEAM_READ_SCOPE_UNAVAILABLE")?;
    let expiry=steam_diagnostic_authority(row,session,workflow,target.hwnd,target.pid,scope,owner,now).map_err(|_|"STEAM_READ_SCOPE_CHANGED")?;
    let deadline=steam_read_min_deadline(expiry,native_uia::steam_read_policy_deadline(now)?,now)?;
    if row.pending.is_some()||!row.mapped.is_empty()||row.requested_dispatch||row.pending_requested||row.last_post.is_some()||row.steam_counts.is_some(){
        return Err("STEAM_READ_SCOPE_CHANGED".into());
    }Ok(deadline)
}
fn steam_read_min_deadline(authority:u64,policy:u64,now:u64)->Result<u64,String>{
    let deadline=authority.min(policy);if now>=deadline{return Err("STEAM_READ_SCOPE_EXPIRED".into());}Ok(deadline)
}
fn steam_read_guarded<T>(guard:&dyn Fn()->Result<(),String>,work:&dyn Fn()->Result<T,String>)->Result<T,String>{
    guard()?;let result=work();let post=guard();
    if post.as_ref().err().is_some_and(|e|matches!(e.as_str(),"STEAM_READ_SCOPE_CHANGED"|"STEAM_READ_SCOPE_EXPIRED"|"STEAM_READ_ENDED")){return Err(post.unwrap_err());}
    task_preserve_work(result,post)
}
const STEAM_READ_ERRORS:[&str;11]=["STEAM_READ_INVALID_REQUEST","STEAM_READ_POLICY_UNAVAILABLE","STEAM_READ_SCOPE_UNAVAILABLE","STEAM_READ_SCOPE_EXPIRED","STEAM_READ_SCOPE_CHANGED","STEAM_READ_BUSY","STEAM_READ_REPLAY","STEAM_READ_UNSUPPORTED","STEAM_READ_TIMEOUT","STEAM_READ_ENDED","STEAM_READ_CAPACITY"];
fn steam_read_error(error:String)->String{if STEAM_READ_ERRORS.contains(&error.as_str()){error}else{"STEAM_READ_UNSUPPORTED".into()}}
fn steam_read_guard(guard:&dyn Fn()->Result<(),String>)->Result<(),String>{
    guard().map_err(|error|if STEAM_READ_ERRORS.contains(&error.as_str()){error}else{"STEAM_READ_SCOPE_CHANGED".into()})
}
fn steam_read_ref_valid(value:&str)->bool{value.strip_prefix("steam-read:").is_some_and(|v|v.len()==64&&v.bytes().all(|b|b.is_ascii_digit()||matches!(b,b'a'..=b'f')))}
fn steam_read_build_pin_valid(value:Option<&str>)->bool{value.is_some_and(|v|v.len()==64&&v.bytes().all(|b|b.is_ascii_digit()||matches!(b,b'a'..=b'f')))}
fn steam_read_policy_ready()->Result<u64,String>{
    if !steam_read_build_pin_valid(option_env!("EDITH_NATIVE_BUILD_ID")){return Err("STEAM_READ_POLICY_UNAVAILABLE".into());}
    native_uia::steam_read_policy_deadline(now_ms().map_err(|_|"STEAM_READ_POLICY_UNAVAILABLE")?).map_err(|_|"STEAM_READ_POLICY_UNAVAILABLE".into())
}
fn steam_read_binding_matches(source:&Value,binding:&str)->bool{task_id(binding)&&source["bindingId"].as_str()==Some(binding)}
fn steam_read_priority(changed:bool,expired:bool,ended:bool)->Option<&'static str>{
    if changed{Some("STEAM_READ_SCOPE_CHANGED")}else if expired{Some("STEAM_READ_SCOPE_EXPIRED")}else if ended{Some("STEAM_READ_ENDED")}else{None}
}
fn steam_read_begin_result(reference:&str,deadline:u64)->Value{
    json!({"schema":"edith.steam.read-session/1","status":"ready","readRef":reference,"expiresAt":deadline,"allowedStates":STEAM_READ_STATES,"candidateOnly":true,"profileApproved":false})
}
fn steam_read_end_result(reference:&str,in_flight:bool,worker_quiescent:bool)->Value{
    json!({"schema":"edith.steam.read-session/1","status":"ended","readRef":reference,"quiescent":!in_flight&&worker_quiescent,"candidateOnly":true,"profileApproved":false})
}
fn steam_read_end_progress(progress:&mut SteamReadProgress){progress.ended=true;}
fn steam_read_fail(session:&str,workflow:&str){
    if let Ok(mut rows)=steam_read_grants().lock(){if let Some(row)=rows.get_mut(&(session.into(),workflow.into())){row.progress.failed=true;row.original.steam_root=None;}}
}
fn steam_read_current(session:&str,workflow:&str,reference:&str,scope:&SteamOriginalScope,owner:&str,guard:&dyn Fn()->Result<(),String>)->Result<SteamReadGrant,String>{
    steam_read_guard(guard)?;
    let grant=steam_read_grants().lock().map_err(|_|"STEAM_READ_UNSUPPORTED")?.get(&(session.into(),workflow.into())).cloned().ok_or("STEAM_READ_SCOPE_UNAVAILABLE")?;
    if grant.reference!=reference{return Err("STEAM_READ_SCOPE_UNAVAILABLE".into());}
    let current=steam_read_live_row(session,workflow).map_err(|_|"STEAM_READ_SCOPE_CHANGED")?;
    let root=grant.root.upgrade().ok_or("STEAM_READ_SCOPE_CHANGED")?;
    let target=current.target.as_ref().ok_or("STEAM_READ_SCOPE_CHANGED")?;
    let same_root=current.steam_root.as_ref().is_some_and(|r|std::sync::Arc::ptr_eq(r,&root));
    let changed=grant.progress.failed||grant.owner!=owner
        ||!grant.original.steam_scope.as_ref().is_some_and(|s|steam_diagnostic_scope_matches(s,scope,session))
        ||!steam_diagnostic_same_state(&grant.original,&current)||!same_root;
    if changed{return Err("STEAM_READ_SCOPE_CHANGED".into());}
    root.revalidate(target).map_err(|_|"STEAM_READ_SCOPE_CHANGED")?;
    if let Some(error)=steam_read_priority(false,now_ms().map_err(|_|"STEAM_READ_UNSUPPORTED")?>=grant.deadline,grant.progress.ended){return Err(error.into());}
    if !steam_read_marked(session,workflow).map_err(steam_read_error)?{return Err("STEAM_READ_SCOPE_CHANGED".into());}
    if steam_read_deadline(&current,session,workflow,scope,owner,now_ms()?).map_err(steam_read_error)?!=grant.deadline{return Err("STEAM_READ_SCOPE_CHANGED".into());}
    steam_read_guard(guard)?;
    if !steam_diagnostic_same_state(&current,&steam_read_live_row(session,workflow).map_err(|_|"STEAM_READ_SCOPE_CHANGED")?){return Err("STEAM_READ_SCOPE_CHANGED".into());}
    Ok(grant)
}
pub(crate) fn task_steam_read_lookup(read_ref:&str)->Result<(String,String),String>{
    if !steam_read_ref_valid(read_ref){return Err("STEAM_READ_INVALID_REQUEST".into());}
    let rows=steam_read_grants().lock().map_err(|_|"STEAM_READ_UNSUPPORTED")?;
    rows.iter().find(|(_,r)|r.reference==read_ref).map(|(key,_)|key.clone()).ok_or("STEAM_READ_SCOPE_UNAVAILABLE".into())
}
pub(crate) fn task_steam_read_begin(session:&str,workflow:&str,binding_id:&str,original_scope:&SteamOriginalScope,original_owner:&str,guard:&dyn Fn()->Result<(),String>)->Result<Value,String>{
    let result=(||{
        if !task_id(session)||!task_id(workflow)||!task_id(binding_id){return Err("STEAM_READ_INVALID_REQUEST".into());}
        steam_read_policy_ready()?;steam_read_guard(guard)?;
        if !steam_read_marked(session,workflow).map_err(steam_read_error)?{return Err("STEAM_READ_SCOPE_UNAVAILABLE".into());}
        let original=steam_read_live_row(session,workflow).map_err(|_|"STEAM_READ_SCOPE_UNAVAILABLE")?;
        if !steam_read_binding_matches(&original.source,binding_id){return Err("STEAM_READ_SCOPE_UNAVAILABLE".into());}
        let deadline=steam_read_deadline(&original,session,workflow,original_scope,original_owner,now_ms()?).map_err(steam_read_error)?;
        original.steam_root.as_ref().ok_or("STEAM_READ_SCOPE_UNAVAILABLE")?.revalidate(original.target.as_ref().ok_or("STEAM_READ_SCOPE_UNAVAILABLE")?).map_err(|_|"STEAM_READ_SCOPE_CHANGED")?;
        let mut entropy=[0u8;32];getrandom::fill(&mut entropy).map_err(|_|"STEAM_READ_UNSUPPORTED")?;
        let reference=format!("steam-read:{}",entropy.iter().map(|b|format!("{b:02x}")).collect::<String>());entropy.fill(0);
        steam_read_guard(guard)?;if !steam_diagnostic_same_row(&original,&steam_read_live_row(session,workflow).map_err(|_|"STEAM_READ_SCOPE_CHANGED")?){return Err("STEAM_READ_SCOPE_CHANGED".into());}
        let root=std::sync::Arc::downgrade(original.steam_root.as_ref().ok_or("STEAM_READ_SCOPE_UNAVAILABLE")?);
        {
            let mut rows=steam_read_grants().lock().map_err(|_|"STEAM_READ_UNSUPPORTED")?;
            // Retain ended/blocked refs through the entire original replay lifetime.
            let now=now_ms()?;let quiet=native_uia::steam_main_worker_quiescent();
            rows.retain(|_,row|row.replay_until>now||row.progress.in_flight||!quiet);
            if rows.contains_key(&(session.into(),workflow.into())){return Err("STEAM_READ_REPLAY".into());}
            if rows.len()>=16{return Err("STEAM_READ_CAPACITY".into());}
            if !quiet{return Err("STEAM_READ_BUSY".into());}
            if rows.values().any(|r|r.reference==reference){return Err("STEAM_READ_UNSUPPORTED".into());}
            rows.insert((session.into(),workflow.into()),SteamReadGrant{reference:reference.clone(),original,root,owner:original_owner.into(),deadline,replay_until:original_scope.native_expires_at_ms,progress:SteamReadProgress::default()});
        }
        if let Err(error)=steam_read_current(session,workflow,&reference,original_scope,original_owner,guard){
            steam_read_fail(session,workflow);return Err(error);
        }
        Ok(steam_read_begin_result(&reference,deadline))
    })();result.map_err(steam_read_error)
}
pub(crate) fn task_steam_read_sample(session:&str,workflow:&str,read_ref:&str,state:&str,original_scope:&SteamOriginalScope,original_owner:&str,guard:&dyn Fn()->Result<(),String>)->Result<Value,String>{
    if !steam_read_ref_valid(read_ref)||!STEAM_READ_STATES.contains(&state){return Err("STEAM_READ_INVALID_REQUEST".into());}
    steam_read_policy_ready()?;
    let grant=match steam_read_current(session,workflow,read_ref,original_scope,original_owner,guard){Ok(grant)=>grant,Err(error)=>{if error=="STEAM_READ_SCOPE_CHANGED"{steam_read_fail(session,workflow);}return Err(steam_read_error(error));}};
    let generation={
        let mut rows=steam_read_grants().lock().map_err(|_|"STEAM_READ_UNSUPPORTED")?;
        let current=rows.get_mut(&(session.into(),workflow.into())).ok_or("STEAM_READ_SCOPE_UNAVAILABLE")?;
        if current.reference!=read_ref{return Err("STEAM_READ_SCOPE_UNAVAILABLE".into());}
        if !native_uia::steam_main_worker_quiescent(){return Err("STEAM_READ_BUSY".into());}
        current.progress.reserve(state)?
    };
    let scoped=||steam_read_current(session,workflow,read_ref,original_scope,original_owner,guard).map(|_|());
    let result=steam_read_guarded(&scoped,&||{
        scoped()?;
        let target=grant.original.target.as_ref().ok_or("STEAM_READ_SCOPE_CHANGED")?;
        let root=grant.root.upgrade().ok_or("STEAM_READ_SCOPE_CHANGED")?;
        let held:std::sync::Arc<dyn Send+Sync>=root;
        let capture=native_uia::steam_read_candidate_capture(target.hwnd,target.pid,grant.deadline,held,&scoped).map_err(steam_read_error)?;
        scoped()?;let observed_at=now_ms()?;
        let value=capture.project(read_ref,generation,state,observed_at,&scoped).map_err(steam_read_error)?;
        scoped()?;if serde_json::to_vec(&value).map_err(|_|"STEAM_READ_UNSUPPORTED")?.len()>65536{return Err("STEAM_READ_UNSUPPORTED".into());}
        Ok(value)
    }).map_err(steam_read_error);
    let mut rows=steam_read_grants().lock().map_err(|_|"STEAM_READ_UNSUPPORTED")?;
    let current=rows.get_mut(&(session.into(),workflow.into())).ok_or("STEAM_READ_SCOPE_CHANGED")?;
    current.progress.complete(generation,result.is_ok())?;
    result
}
pub(crate) fn task_steam_read_end(session:&str,workflow:&str,read_ref:&str)->Result<Value,String>{
    if !steam_read_ref_valid(read_ref){return Err("STEAM_READ_INVALID_REQUEST".into());}
    let mut rows=steam_read_grants().lock().map_err(|_|"STEAM_READ_UNSUPPORTED")?;
    let grant=rows.get_mut(&(session.into(),workflow.into())).ok_or("STEAM_READ_SCOPE_UNAVAILABLE")?;
    if grant.reference!=read_ref{return Err("STEAM_READ_SCOPE_UNAVAILABLE".into());}
    steam_read_end_progress(&mut grant.progress);grant.original.steam_root=None;
    Ok(steam_read_end_result(read_ref,grant.progress.in_flight,native_uia::steam_main_worker_quiescent()))
}
impl SteamReadGrant{
    fn finalize(&mut self,read_ref:&str,candidate:&Value,now:u64,tombstone_clear:bool)->Result<(),String>{
        if self.reference!=read_ref{return Err("STEAM_READ_SCOPE_UNAVAILABLE".into());}
        let generation=candidate["sampleGeneration"].as_u64().filter(|n|(1..=7).contains(n));
        let changed=!tombstone_clear||self.progress.failed
            ||candidate["readRef"].as_str()!=Some(self.reference.as_str())
            ||candidate["expiresAt"].as_u64()!=Some(self.deadline)
            ||generation!=Some(self.progress.generation);
        if let Some(error)=steam_read_priority(changed,now>=self.deadline,self.progress.ended){return Err(error.into());}
        if self.progress.in_flight{return Err("STEAM_READ_BUSY".into());}
        let generation=generation.ok_or("STEAM_READ_SCOPE_CHANGED")?;
        if generation<=self.progress.finalized_generation{return Err("STEAM_READ_REPLAY".into());}
        self.progress.finalized_generation=generation;Ok(())
    }
}
// LAST native success gate, after root's final HTTP and local authority checks.
// Lock order is tombstone -> grant. task_block releases grant before acquiring
// tombstone, and end takes only grant. No provider/HTTP/callback runs here.
// Success linearizes at finalized_generation under the same mutex as end:
// prior end denies; later end is subsequent revocation, not reordered delivery.
pub(crate) fn task_steam_read_finalize(session:&str,workflow:&str,read_ref:&str,candidate:&Value)->Result<(),String>{
    if !task_id(session)||!task_id(workflow)||!steam_read_ref_valid(read_ref){return Err("STEAM_READ_INVALID_REQUEST".into());}
    let dead=tombstones().lock().map_err(|_|"STEAM_READ_UNSUPPORTED")?;
    let mut rows=steam_read_grants().lock().map_err(|_|"STEAM_READ_UNSUPPORTED")?;
    let now=now_ms().map_err(|_|"STEAM_READ_UNSUPPORTED")?;
    let grant=rows.get_mut(&(session.into(),workflow.into())).ok_or("STEAM_READ_SCOPE_UNAVAILABLE")?;
    grant.finalize(read_ref,candidate,now,steam_diagnostic_tombstones_clear(&dead,session,workflow,now))
}
// Existing immutable task rows supply the original deadline to a later root
// context. No new reservation, epoch or TTL is manufactured by this query.
pub(crate) fn task_steam_read_original_deadline(session:&str,workflow:&str)->Result<Option<u64>,String>{
    let key=(session.to_owned(),workflow.to_owned());
    let dead=tombstones().lock().map_err(|_|"STEAM_READ_UNSUPPORTED")?;
    let now=now_ms().map_err(|_|"STEAM_READ_UNSUPPORTED")?;
    if !steam_diagnostic_tombstones_clear(&dead,session,workflow,now){return Err("STEAM_READ_SCOPE_CHANGED".into());}
    let marker=steam_read_only().lock().map_err(|_|"STEAM_READ_UNSUPPORTED")?.get(&key).copied();
    if marker.is_none(){
        if steam_read_grants().lock().map_err(|_|"STEAM_READ_UNSUPPORTED")?.contains_key(&key){return Err("STEAM_READ_SCOPE_CHANGED".into());}
        return Ok(None);
    }
    let registration=registrations().lock().map_err(|_|"STEAM_READ_UNSUPPORTED")?.get(&key).map(|r|r.expires);
    let binding=task_bindings().lock().map_err(|_|"STEAM_READ_UNSUPPORTED")?.get(&key).map(|r|r.expires_at);
    let grants=steam_read_grants().lock().map_err(|_|"STEAM_READ_UNSUPPORTED")?;
    let grant=grants.get(&key);
    let deadline=[registration,binding,grant.map(|g|g.deadline)].into_iter().flatten().min().ok_or("STEAM_READ_SCOPE_UNAVAILABLE")?;
    if let Some(error)=steam_read_priority(grant.is_some_and(|g|g.progress.failed),now>=deadline,grant.is_some_and(|g|g.progress.ended)){return Err(error.into());}
    Ok(Some(deadline))
}
// Root calls only after taking the actually matching reservation and releasing
// its reservation mutex. Ordinary unmarked tasks keep their existing release.
pub(crate) fn task_steam_read_release(session:&str,workflow:&str)->Result<(),String>{
    let key=(session.to_owned(),workflow.to_owned());
    let marked=steam_read_only().lock().map_err(|_|"STEAM_READ_UNSUPPORTED")?.contains_key(&key);
    let known=steam_read_grants().lock().map_err(|_|"STEAM_READ_UNSUPPORTED")?.contains_key(&key);
    if marked||known{task_block(session,Some(workflow));}Ok(())
}
pub(crate) fn task_steam_read_invalidate_session(session:&str,epoch:u64){
    if let Ok(mut rows)=steam_read_grants().lock(){for((id,_),grant)in rows.iter_mut(){
        if id==session&&grant.original.steam_scope.as_ref().is_some_and(|s|s.original_epoch==epoch){grant.progress.failed=true;grant.progress.ended=true;grant.original.steam_root=None;}
    }}
}
fn steam_read_revoke_workflow(session:&str,workflow:&str){
    if let Ok(mut rows)=steam_read_grants().lock(){if let Some(grant)=rows.get_mut(&(session.into(),workflow.into())){
        grant.progress.failed=true;grant.progress.ended=true;grant.original.steam_root=None;
    }}
}

fn steam_read_identity_allowed(actual:&std::path::Path,allowed:&[std::path::PathBuf])->bool{
    allowed.iter().any(|path|path==actual)
}
// Foreground-only native selector: no window caption/UIA Name, enumeration,
// caller HWND, focus change or process-name-only identity acceptance.
fn steam_read_foreground_target(guard:&dyn Fn()->Result<(),String>)->Result<TaskTarget,String>{
    guard()?;
    #[cfg(not(windows))]{Err("CONFIGURATION_REQUIRED".into())}
    #[cfg(windows)]{
        use windows_sys::Win32::UI::WindowsAndMessaging::{GetForegroundWindow,GetWindowThreadProcessId,GetAncestor,IsWindowVisible,GA_ROOT};
        let hwnd=unsafe{GetForegroundWindow()};let mut pid=0;
        if hwnd.is_null()||unsafe{GetAncestor(hwnd,GA_ROOT)}!=hwnd||unsafe{IsWindowVisible(hwnd)}==0{return Err("CONFIGURATION_REQUIRED".into());}
        unsafe{GetWindowThreadProcessId(hwnd,&mut pid);}if pid==0{return Err("CONFIGURATION_REQUIRED".into());}
        let identity=crate::native_calculator_identity::observe(hwnd as isize,pid)?;
        if identity.content.is_some(){return Err("CONFIGURATION_REQUIRED".into());}
        let actual=std::path::PathBuf::from(&identity.root_image);
        let allowed:Vec<_>=["ProgramFiles(x86)","ProgramFiles"].iter().filter_map(std::env::var_os).flat_map(|base|{
            ["Steam\\steam.exe","Steam\\bin\\cef\\cef.win64\\steamwebhelper.exe"].map(|suffix|std::path::PathBuf::from(&base).join(suffix))
        }).filter_map(|p|p.canonicalize().ok()).collect();
        if !steam_read_identity_allowed(&actual,&allowed){return Err("CONFIGURATION_REQUIRED".into());}guard()?;
        crate::native_calculator_identity::revalidate(&identity)?;
        if unsafe{GetForegroundWindow()}!=hwnd{return Err("CONFIGURATION_REQUIRED".into());}
        Ok(TaskTarget{window_id:format!("hwnd:{}",hwnd as usize),pid,image:text_hash(&identity.root_image),hwnd:hwnd as isize})
    }
}
#[cfg(test)]
mod steam_read_authority_tests{
    use super::*;
    use std::cell::Cell;
    #[test] fn actual_progress_accepts_seven_once_without_renewal(){
        let mut progress=SteamReadProgress::default();
        for(index,state)in STEAM_READ_STATES.iter().enumerate(){
            let generation=progress.reserve(state).unwrap();assert_eq!(generation,index as u64+1);
            progress.complete(generation,true).unwrap();assert!(progress.reserve(state).is_err());
        }
        assert_eq!(progress.used,127);assert_eq!(progress.generation,7);
    }
    #[test] fn actual_inflight_refuses_other_state_without_consuming_it(){
        let mut progress=SteamReadProgress::default();let generation=progress.reserve(STEAM_READ_STATES[0]).unwrap();
        assert!(progress.reserve(STEAM_READ_STATES[1]).is_err());assert_eq!(progress.used,1);
        progress.complete(generation,true).unwrap();assert_eq!(progress.reserve(STEAM_READ_STATES[1]).unwrap(),2);
    }
    #[test] fn actual_provider_failure_latches_even_after_worker_returns(){
        let mut progress=SteamReadProgress::default();let generation=progress.reserve(STEAM_READ_STATES[0]).unwrap();
        progress.complete(generation,false).unwrap();assert!(progress.failed);assert!(!progress.in_flight);
        for state in STEAM_READ_STATES{assert!(progress.reserve(state).is_err());}
    }
    #[test] fn actual_end_denies_all_late_completion_and_reentry(){
        let mut progress=SteamReadProgress::default();let generation=progress.reserve(STEAM_READ_STATES[0]).unwrap();
        progress.ended=true;assert!(progress.complete(generation,true).is_err());assert!(progress.failed);
        assert!(!progress.in_flight);
        assert!(progress.reserve(STEAM_READ_STATES[1]).is_err());
    }
    #[test] fn actual_wrong_generation_completion_fails_closed(){
        let mut progress=SteamReadProgress::default();let generation=progress.reserve(STEAM_READ_STATES[0]).unwrap();
        assert!(progress.complete(generation+1,true).is_err());assert!(progress.failed);
    }
    #[test] fn actual_generation_overflow_never_consumes_sample(){
        let mut progress=SteamReadProgress{generation:u64::MAX,..Default::default()};
        assert!(progress.reserve(STEAM_READ_STATES[0]).is_err());assert_eq!(progress.used,0);assert!(!progress.in_flight);
    }
    #[test] fn actual_state_allowlist_is_exact_without_normalization(){
        for state in ["","library MAIN pre","Library MAIN pre ","Library MAIN pre\n","unknown","game_detail"]{
            let mut progress=SteamReadProgress::default();assert!(progress.reserve(state).is_err());assert_eq!(progress.used,0);
        }
    }
    #[test] fn actual_minimum_deadline_never_renews_or_accepts_expiry(){
        assert_eq!(steam_read_min_deadline(80,90,0).unwrap(),80);
        assert_eq!(steam_read_min_deadline(90,80,79).unwrap(),80);
        for now in [80,81,u64::MAX]{assert!(steam_read_min_deadline(90,80,now).is_err());}
        assert!(steam_read_min_deadline(0,90,0).is_err());
    }
    #[test] fn actual_guard_runs_after_failed_work_and_first_error_survives(){
        let calls=Cell::new(0);let work=Cell::new(0);
        let guard=||{calls.set(calls.get()+1);if calls.get()==2{Err("SIM_STOP".into())}else{Ok(())}};
        let error=steam_read_guarded::<()>(&guard,&||{work.set(work.get()+1);Err("SIM_PROVIDER".into())}).unwrap_err();
        assert_eq!(error,"SIM_PROVIDER");assert_eq!(calls.get(),2);assert_eq!(work.get(),1);
    }
    #[test] fn actual_successful_work_is_denied_by_post_guard(){
        let calls=Cell::new(0);let guard=||{calls.set(calls.get()+1);if calls.get()==2{Err("SIM_STOP".into())}else{Ok(())}};
        assert_eq!(steam_read_guarded(&guard,&||Ok(1)).unwrap_err(),"SIM_STOP");
    }
    #[test] fn actual_pre_guard_denial_executes_zero_work(){
        let work=Cell::new(0);let error=steam_read_guarded(&||Err("SIM_STOP".into()),&||{work.set(1);Ok(())}).unwrap_err();
        assert_eq!(error,"SIM_STOP");assert_eq!(work.get(),0);
    }
    #[test] fn actual_native_scope_requires_exact_original_reference_and_zero_epoch(){
        let scope=SteamOriginalScope{session_id:"session".into(),safety_session_ref:"original".into(),original_epoch:0,native_expires_at_ms:80};
        assert!(steam_diagnostic_scope_matches(&scope,&scope,"session"));
        let changes:[fn(&mut SteamOriginalScope);4]=[|s|s.session_id.push('x'),|s|s.safety_session_ref.push('x'),|s|s.original_epoch=1,|s|s.native_expires_at_ms+=1];
        for change in changes{let mut other=scope.clone();change(&mut other);assert!(!steam_diagnostic_scope_matches(&scope,&other,"session"));}
    }
    #[test] fn actual_exact_path_identity_rejects_basename_and_other_install(){
        let allowed=vec![std::path::PathBuf::from("fixed/Steam/steam.exe")];
        assert!(steam_read_identity_allowed(std::path::Path::new("fixed/Steam/steam.exe"),&allowed));
        for value in ["steam.exe","other/Steam/steam.exe","fixed/Steam/steam.exe.extra","fixed/Steam/steamwebhelper.exe"]{
            assert!(!steam_read_identity_allowed(std::path::Path::new(value),&allowed));
        }
    }
    #[test] fn wire_read_reference_has_exact_cryptographic_shape(){
        assert!(steam_read_ref_valid(&format!("steam-read:{}","a".repeat(64))));
        for value in ["steam-read:","steam-read:abc","steam-read:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","steam-read:gggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggg"," steam-read:abc"]{assert!(!steam_read_ref_valid(value));}
        assert!(!steam_read_ref_valid(&format!("steam-read:{}","a".repeat(65))));
    }
    #[test] fn wire_build_identity_requires_exact_lowercase_pin(){
        assert!(steam_read_build_pin_valid(Some(&"b".repeat(64))));
        for value in [None,Some(""),Some("b"),Some("ABC")]{assert!(!steam_read_build_pin_valid(value));}
        assert!(!steam_read_build_pin_valid(Some(&"B".repeat(64))));
    }
    #[test] fn wire_begin_result_exact_keys_and_state_order(){
        let value=steam_read_begin_result(&format!("steam-read:{}","a".repeat(64)),80);
        exact_keys(&value,&["schema","status","readRef","expiresAt","allowedStates","candidateOnly","profileApproved"],&[]).unwrap();
        assert_eq!(value["schema"],"edith.steam.read-session/1");assert_eq!(value["status"],"ready");
        assert_eq!(value["allowedStates"],json!(STEAM_READ_STATES));assert_eq!(value["candidateOnly"],true);assert_eq!(value["profileApproved"],false);
    }
    #[test] fn wire_end_result_exact_keys_and_actual_worker_conjunction(){
        for(in_flight,quiet,expected)in[(false,false,false),(true,false,false),(true,true,false),(false,true,true)]{
            let value=steam_read_end_result(&format!("steam-read:{}","a".repeat(64)),in_flight,quiet);
            exact_keys(&value,&["schema","status","readRef","quiescent","candidateOnly","profileApproved"],&[]).unwrap();
            assert_eq!(value["status"],"ended");assert_eq!(value["quiescent"],expected);
        }
    }
    #[test] fn wire_end_flags_idempotent_without_live_policy_or_scope(){
        let mut progress=SteamReadProgress{failed:true,generation:7,used:127,..Default::default()};
        steam_read_end_progress(&mut progress);steam_read_end_progress(&mut progress);
        assert!(progress.ended&&progress.failed);assert_eq!(progress.generation,7);assert_eq!(progress.used,127);
    }
    #[test] fn wire_binding_id_must_match_actual_source(){
        let source=json!({"bindingId":"actual-binding"});
        assert!(steam_read_binding_matches(&source,"actual-binding"));
        for value in ["","other-binding","actual-binding "] {assert!(!steam_read_binding_matches(&source,value));}
        assert!(!steam_read_binding_matches(&json!({}),"actual-binding"));
    }
    #[test] fn wire_error_priority_stop_before_expiry_before_end(){
        assert_eq!(steam_read_priority(true,true,true),Some("STEAM_READ_SCOPE_CHANGED"));
        assert_eq!(steam_read_priority(false,true,true),Some("STEAM_READ_SCOPE_EXPIRED"));
        assert_eq!(steam_read_priority(false,false,true),Some("STEAM_READ_ENDED"));
        assert_eq!(steam_read_priority(false,false,false),None);
    }
    #[test] fn wire_closed_errors_never_echo_provider_detail(){
        for value in STEAM_READ_ERRORS{assert_eq!(steam_read_error(value.into()),value);}
        for value in ["private unknown", "KILL_SWITCH_ACTIVE private", "STEAM_READ_TIMEOUT private", ""]{assert_eq!(steam_read_error(value.into()),"STEAM_READ_UNSUPPORTED");}
    }
    #[test] fn wire_post_stop_wins_provider_error_without_skipping_work(){
        let calls=Cell::new(0);let guard=||{calls.set(calls.get()+1);if calls.get()==2{Err("STEAM_READ_SCOPE_CHANGED".into())}else{Ok(())}};
        assert_eq!(steam_read_guarded::<()>(&guard,&||Err("STEAM_READ_UNSUPPORTED".into())).unwrap_err(),"STEAM_READ_SCOPE_CHANGED");
        assert_eq!(calls.get(),2);
    }
    #[test] fn wire_progress_errors_do_not_consume_rejected_admission(){
        let mut progress=SteamReadProgress::default();let generation=progress.reserve(STEAM_READ_STATES[0]).unwrap();
        assert_eq!(progress.reserve(STEAM_READ_STATES[0]).unwrap_err(),"STEAM_READ_BUSY");
        assert_eq!(progress.generation,1);assert_eq!(progress.used,1);progress.complete(generation,true).unwrap();
        assert_eq!(progress.reserve(STEAM_READ_STATES[0]).unwrap_err(),"STEAM_READ_REPLAY");
        steam_read_end_progress(&mut progress);assert_eq!(progress.reserve(STEAM_READ_STATES[1]).unwrap_err(),"STEAM_READ_ENDED");
        progress.failed=true;assert_eq!(progress.reserve(STEAM_READ_STATES[1]).unwrap_err(),"STEAM_READ_SCOPE_CHANGED");
        assert_eq!(progress.generation,1);assert_eq!(progress.used,1);
    }
    struct FinalizationFixture{session:String,workflow:String,reference:String,deadline:u64}
    impl FinalizationFixture{
        fn new()->Self{
            static ID:std::sync::atomic::AtomicU64=std::sync::atomic::AtomicU64::new(1);
            let id=ID.fetch_add(1,std::sync::atomic::Ordering::SeqCst);
            let fixture=Self{session:format!("sim-final-session:{id}"),workflow:format!("sim-final-workflow:{id}"),reference:format!("steam-read:{id:064x}"),deadline:now_ms().unwrap()+60_000};
            // Private SIM lifecycle fixture only. It supplies no held OS root,
            // capture, profile, policy or publicly installable authority.
            let row=TaskBinding{source:json!({"sessionId":fixture.session,"reservationId":fixture.workflow}),bridge:"sim-bridge".into(),app:"steam".into(),query:None,target:None,
                pending:None,mapped:HashMap::new(),last_post:None,blocked:false,expires_at:fixture.deadline,requested_dispatch:false,pending_requested:false,
                pending_skip:None,pending_pre:None,game_name:None,game_entry:None,steam_library:None,steam_ledger_revision:0,pending_game:None,last_game:false,
                steam_scope:Some(SteamOriginalScope{session_id:fixture.session.clone(),safety_session_ref:"sim-safety".into(),original_epoch:0,native_expires_at_ms:fixture.deadline}),
                steam_root:None,steam_counts:None,steam_effective_expiry:None};
            steam_read_grants().lock().unwrap().insert((fixture.session.clone(),fixture.workflow.clone()),SteamReadGrant{reference:fixture.reference.clone(),original:row,root:std::sync::Weak::new(),owner:"sim-owner".into(),deadline:fixture.deadline,replay_until:fixture.deadline,progress:SteamReadProgress::default()});
            fixture
        }
        fn complete_sample(&self)->Value{
            let mut rows=steam_read_grants().lock().unwrap();let row=rows.get_mut(&(self.session.clone(),self.workflow.clone())).unwrap();
            let generation=row.progress.reserve(STEAM_READ_STATES[0]).unwrap();row.progress.complete(generation,true).unwrap();
            assert!(!row.progress.in_flight);
            json!({"readRef":self.reference,"sampleGeneration":generation,"expiresAt":self.deadline})
        }
    }
    impl Drop for FinalizationFixture{
        fn drop(&mut self){
            let key=(self.session.clone(),self.workflow.clone());
            if let Ok(mut rows)=steam_read_grants().lock(){rows.remove(&key);}
            if let Ok(mut rows)=tombstones().lock(){rows.remove(&key);}
            if let Ok(mut rows)=steam_read_only().lock(){rows.remove(&key);}
            if let Ok(mut rows)=registrations().lock(){rows.remove(&key);}
            if let Ok(mut rows)=task_bindings().lock(){rows.remove(&key);}
        }
    }
    #[test] fn completed_sample_end_before_public_finalize_is_denied(){
        let fixture=FinalizationFixture::new();
        let candidate=fixture.complete_sample();
        // The old earlier in-flight race is deliberately not under test here.
        // End completes after progress.complete, inside the outer HTTP interval.
        let ended=task_steam_read_end(&fixture.session,&fixture.workflow,&fixture.reference).unwrap();
        assert_eq!(ended["status"],"ended");
        assert_eq!(task_steam_read_finalize(&fixture.session,&fixture.workflow,&fixture.reference,&candidate),Err("STEAM_READ_ENDED".into()));
    }
    #[test] fn completed_sample_finalizes_once_and_end_after_commit_is_later_revocation(){
        let fixture=FinalizationFixture::new();let candidate=fixture.complete_sample();
        assert_eq!(task_steam_read_finalize(&fixture.session,&fixture.workflow,&fixture.reference,&candidate),Ok(()));
        assert_eq!(task_steam_read_finalize(&fixture.session,&fixture.workflow,&fixture.reference,&candidate),Err("STEAM_READ_REPLAY".into()));
        task_steam_read_end(&fixture.session,&fixture.workflow,&fixture.reference).unwrap();
        assert_eq!(task_steam_read_finalize(&fixture.session,&fixture.workflow,&fixture.reference,&candidate),Err("STEAM_READ_ENDED".into()));
    }
    #[test] fn completed_sample_tombstone_before_finalization_denies(){
        let fixture=FinalizationFixture::new();let candidate=fixture.complete_sample();
        tombstones().lock().unwrap().insert((fixture.session.clone(),fixture.workflow.clone()),fixture.deadline);
        assert_eq!(task_steam_read_finalize(&fixture.session,&fixture.workflow,&fixture.reference,&candidate),Err("STEAM_READ_SCOPE_CHANGED".into()));
    }
    #[test] fn completed_sample_wrong_reference_generation_and_deadline_deny(){
        let fixture=FinalizationFixture::new();let candidate=fixture.complete_sample();
        for(field,value)in[("readRef",json!(format!("steam-read:{}","f".repeat(64)))),("sampleGeneration",json!(2)),("expiresAt",json!(fixture.deadline+1))]{
            let mut changed=candidate.clone();changed[field]=value;
            assert_eq!(task_steam_read_finalize(&fixture.session,&fixture.workflow,&fixture.reference,&changed),Err("STEAM_READ_SCOPE_CHANGED".into()));
        }
    }
    #[test] fn completed_sample_expiry_and_stop_priority_are_checked_at_final_gate(){
        let fixture=FinalizationFixture::new();let mut candidate=fixture.complete_sample();candidate["expiresAt"]=json!(0);
        {let mut rows=steam_read_grants().lock().unwrap();rows.get_mut(&(fixture.session.clone(),fixture.workflow.clone())).unwrap().deadline=0;}
        assert_eq!(task_steam_read_finalize(&fixture.session,&fixture.workflow,&fixture.reference,&candidate),Err("STEAM_READ_SCOPE_EXPIRED".into()));
        {let mut rows=steam_read_grants().lock().unwrap();let grant=rows.get_mut(&(fixture.session.clone(),fixture.workflow.clone())).unwrap();grant.progress.failed=true;grant.progress.ended=true;}
        assert_eq!(task_steam_read_finalize(&fixture.session,&fixture.workflow,&fixture.reference,&candidate),Err("STEAM_READ_SCOPE_CHANGED".into()));
    }
    #[test] fn original_registration_ten_second_deadline_clamps_later_sixty_second_rows(){
        let fixture=FinalizationFixture::new();let key=(fixture.session.clone(),fixture.workflow.clone());let shorter=fixture.deadline-50_000;
        let row=steam_read_grants().lock().unwrap().get(&key).unwrap().original.clone();
        steam_read_only().lock().unwrap().insert(key.clone(),fixture.deadline);
        task_bindings().lock().unwrap().insert(key.clone(),row);
        registrations().lock().unwrap().insert(key,TaskRegistration{owner:"sim-owner".into(),intent:TaskIntent{app:"steam".into(),workflow:"game_detail".into(),query:None,volume:None,game_name:Some("SIM".into())},target:None,bridge:"sim-bridge".into(),expires:shorter,steam_scope:None,steam_root:None});
        assert_eq!(task_steam_read_original_deadline(&fixture.session,&fixture.workflow),Ok(Some(shorter)));
    }
    #[test] fn release_marks_collection_tombstone_and_cannot_adopt_new_reservation(){
        let fixture=FinalizationFixture::new();let candidate=fixture.complete_sample();let key=(fixture.session.clone(),fixture.workflow.clone());
        steam_read_only().lock().unwrap().insert(key.clone(),fixture.deadline);
        task_steam_read_release(&fixture.session,&fixture.workflow).unwrap();
        assert!(tombstones().lock().unwrap().contains_key(&key));
        assert_eq!(task_steam_read_finalize(&fixture.session,&fixture.workflow,&fixture.reference,&candidate),Err("STEAM_READ_SCOPE_CHANGED".into()));
        assert_eq!(task_steam_read_original_deadline(&fixture.session,&fixture.workflow),Err("STEAM_READ_SCOPE_CHANGED".into()));
    }
    #[test] fn unmarked_tombstoned_deadline_query_is_not_bootstrap(){
        let fixture=FinalizationFixture::new();let key=(fixture.session.clone(),fixture.workflow.clone());
        steam_read_grants().lock().unwrap().remove(&key);
        tombstones().lock().unwrap().insert(key,fixture.deadline);
        assert_eq!(task_steam_read_original_deadline(&fixture.session,&fixture.workflow),Err("STEAM_READ_SCOPE_CHANGED".into()));
    }
    #[test] fn ordinary_unmarked_release_and_deadline_query_are_unchanged(){
        let session="sim-unmarked-release-only";let workflow="sim-unmarked-workflow-only";
        assert_eq!(task_steam_read_original_deadline(session,workflow),Ok(None));
        assert_eq!(task_steam_read_release(session,workflow),Ok(()));
        assert!(!tombstones().lock().unwrap().contains_key(&(session.into(),workflow.into())));
    }
}
// Passive diagnostics use the original live binding, never task_take/commit or
// the action/observation ledger. All comparisons remain private native memory.
static STEAM_DIAGNOSTIC_ID:std::sync::atomic::AtomicU64=std::sync::atomic::AtomicU64::new(1);
fn steam_diagnostic_deadline(binding:u64,source:u64,native:u64,effective:Option<u64>)->u64{
    binding.min(source).min(native).min(effective.unwrap_or(u64::MAX))
}
fn steam_diagnostic_scope_matches(actual:&SteamOriginalScope,expected:&SteamOriginalScope,session:&str)->bool{
    actual.session_id==session&&actual.session_id==expected.session_id&&!actual.safety_session_ref.is_empty()
        &&actual.safety_session_ref==expected.safety_session_ref&&actual.original_epoch==expected.original_epoch
        &&actual.native_expires_at_ms==expected.native_expires_at_ms
}
fn steam_diagnostic_same_state(a:&TaskBinding,b:&TaskBinding)->bool{
    let target=|r:&TaskBinding|r.target.as_ref().map(|t|(t.hwnd,t.pid,t.window_id.clone(),t.image.clone()));
    let scope=|r:&TaskBinding|r.steam_scope.as_ref().map(|s|(s.session_id.clone(),s.safety_session_ref.clone(),s.original_epoch,s.native_expires_at_ms));
    let skip=|r:&TaskBinding|r.pending_skip.as_ref().map(|s|(s.canonical_action.clone(),s.target_id.clone(),s.name_fingerprint.clone()));
    let navigation=|r:&TaskBinding|r.pending_game.as_ref().map(|n|(n.canonical_action.clone(),n.target_id.clone(),n.control_type,n.name_fingerprint.clone(),n.entry_fingerprint.clone()));
    let entry=|r:&TaskBinding|r.game_entry.as_ref().map(|e|(
        e.runtime_id.clone(),e.name.clone(),e.ancestry.clone(),e.target.target_id.clone(),e.target.name.clone(),
        e.target.control_type,e.target.x,e.target.y,e.target.width,e.target.height,e.target.process_id,e.target.hwnd));
    a.source==b.source&&a.bridge==b.bridge&&a.app==b.app&&a.query==b.query&&target(a)==target(b)
        &&a.pending==b.pending&&a.mapped==b.mapped&&a.last_post==b.last_post&&a.blocked==b.blocked
        &&a.expires_at==b.expires_at&&a.requested_dispatch==b.requested_dispatch&&a.pending_requested==b.pending_requested
        &&skip(a)==skip(b)&&a.pending_pre==b.pending_pre&&a.game_name==b.game_name&&entry(a)==entry(b)
        &&navigation(a)==navigation(b)&&a.last_game==b.last_game&&scope(a)==scope(b)
        &&a.steam_counts==b.steam_counts&&a.steam_effective_expiry==b.steam_effective_expiry
        &&a.steam_ledger_revision==b.steam_ledger_revision
        &&match(&a.steam_library,&b.steam_library){(Some(x),Some(y))=>steam_library_same(x,y),(None,None)=>true,_=>false}
}
fn steam_diagnostic_same_row(a:&TaskBinding,b:&TaskBinding)->bool{
    steam_diagnostic_same_state(a,b)
        &&match(&a.steam_root,&b.steam_root){(Some(x),Some(y))=>std::sync::Arc::ptr_eq(x,y),_=>false}
}
fn steam_diagnostic_authority(row:&TaskBinding,session:&str,workflow:&str,hwnd:isize,pid:u32,original_scope:&SteamOriginalScope,original_owner:&str,now:u64)->Result<u64,String>{
    if !task_id(original_owner){return Err("Steam diagnostic original owner missing".into());}
    validate_task_source(&row.source,session,workflow,original_owner,"steam",None)?;
    exact_keys(&row.source["request"],&["app","workflow","gameNameFingerprint"],&[])?;
    let name=row.game_name.as_deref().filter(|s|valid_game_name(s)).ok_or("Steam diagnostic retained request missing")?;
    let target=row.target.as_ref().ok_or("Steam diagnostic original target missing")?;
    let scope=row.steam_scope.as_ref().ok_or("Steam diagnostic original scope missing")?;
    let deadline=steam_diagnostic_deadline(row.expires_at,row.source["expiresAt"].as_u64().ok_or("Steam diagnostic source expiry missing")?,scope.native_expires_at_ms,row.steam_effective_expiry);
    if !opaque(session)||!task_id(workflow)||row.blocked||row.app!="steam"||!identity(&row.bridge)
        ||row.source["workflowId"]!=json!(workflow)||row.source.get("operationId").is_some()
        ||row.source["request"]["workflow"]!=json!("game_detail")
        ||row.source["request"]["gameNameFingerprint"]!=json!(text_hash(ecma_trim(name)))
        ||row.source["requestDigest"]!=json!(game_request_digest(name,workflow))
        ||!steam_diagnostic_scope_matches(scope,original_scope,session)
        ||hwnd==0||pid==0||target.hwnd!=hwnd||target.pid!=pid||row.steam_root.is_none()||now>=deadline{
        return Err("Steam diagnostic original binding changed or expired".into());
    }
    Ok(deadline)
}
fn steam_diagnostic_tombstones_clear(rows:&HashMap<(String,String),u64>,session:&str,workflow:&str,now:u64)->bool{
    rows.values().filter(|expiry|**expiry>now).count()<64
        &&rows.get(&(session.into(),workflow.into())).is_none_or(|expiry|*expiry<=now)
}
fn steam_diagnostic_live_row(session:&str,workflow:&str)->Result<TaskBinding,String>{
    {
        let rows=tombstones().lock().map_err(|_|"Native task tombstone ledger unavailable")?;
        if !steam_diagnostic_tombstones_clear(&rows,session,workflow,now_ms()?){
            return Err("Native task workflow permanently blocked for this approval lifetime".into());
        }
    }
    // The mutex is released before guards, held-root checks or provider work.
    task_bindings().lock().map_err(|_|"Native task ledger unavailable")?
        .get(&(session.into(),workflow.into())).cloned().ok_or("Steam diagnostic live binding missing".into())
}
pub(crate) fn task_steam_diagnostic_capture(session:&str,workflow:&str,expected_hwnd:isize,expected_pid:u32,generation:u64,original_scope:&SteamOriginalScope,original_owner:&str,guard:&dyn Fn()->Result<(),String>)->Result<Value,String>{
    steam_read_deny_mutation(session,Some(workflow))?;
    guard()?;
    let retained=steam_diagnostic_live_row(session,workflow)?;
    let deadline=steam_diagnostic_authority(&retained,session,workflow,expected_hwnd,expected_pid,original_scope,original_owner,now_ms()?)?;
    let target=retained.target.as_ref().ok_or("Steam diagnostic original target missing")?;
    let root=retained.steam_root.as_ref().ok_or("Steam diagnostic retained root missing")?;
    let scoped_guard=||{
        guard()?;
        let current=steam_diagnostic_live_row(session,workflow)?;
        if !steam_diagnostic_same_row(&current,&retained)
            ||steam_diagnostic_authority(&current,session,workflow,expected_hwnd,expected_pid,original_scope,original_owner,now_ms()?)?!=deadline{
            return Err("Steam diagnostic live binding changed".into());
        }
        root.revalidate(target)?;
        guard()?;
        let final_row=steam_diagnostic_live_row(session,workflow)?;
        if !steam_diagnostic_same_row(&final_row,&retained)
            ||steam_diagnostic_authority(&final_row,session,workflow,expected_hwnd,expected_pid,original_scope,original_owner,now_ms()?)?!=deadline{
            return Err("Steam diagnostic binding changed during scope check".into());
        }
        Ok(())
    };
    scoped_guard()?;
    let held:std::sync::Arc<dyn Send+Sync>=root.clone();
    let capture=native_uia::steam_diagnostic_capture(expected_hwnd,expected_pid,deadline,held,&scoped_guard)?;
    scoped_guard()?;
    let observed_at=now_ms()?;
    let serial=STEAM_DIAGNOSTIC_ID.fetch_update(std::sync::atomic::Ordering::AcqRel,std::sync::atomic::Ordering::Acquire,|n|n.checked_add(1))
        .map_err(|_|"Steam diagnostic identity exhausted")?;
    let capture_id=format!("steam-diagnostic:{serial}");
    let task=retained.source["taskId"].as_str().ok_or("Steam diagnostic original task missing")?;
    scoped_guard()?;
    let projected=capture.project(&capture_id,task,generation,observed_at,&scoped_guard)?;
    scoped_guard()?;
    Ok(projected)
}

#[cfg(test)]
mod steam_diagnostic_binding_tests{
    use super::*;
    fn row()->TaskBinding{
        TaskBinding{source:json!({"ownerBindingId":"owner","nonce":"nonce","state":"QUEUED"}),bridge:"bridge".into(),app:"steam".into(),query:None,
            target:Some(TaskTarget{window_id:"window".into(),pid:7,image:"image".into(),hwnd:9}),pending:None,mapped:HashMap::new(),last_post:None,blocked:false,expires_at:100,
            requested_dispatch:false,pending_requested:false,pending_skip:None,pending_pre:None,game_name:Some("Game".into()),game_entry:None,steam_library:None,steam_ledger_revision:0,pending_game:None,last_game:false,
            steam_scope:Some(SteamOriginalScope{session_id:"session".into(),safety_session_ref:"safety".into(),original_epoch:0,native_expires_at_ms:90}),steam_root:None,steam_counts:None,steam_effective_expiry:None}
    }
    #[test]fn diagnostic_deadline_never_renews_original_authority(){
        assert_eq!(steam_diagnostic_deadline(100,95,90,None),90);
        assert_eq!(steam_diagnostic_deadline(100,95,90,Some(80)),80);
        assert_eq!(steam_diagnostic_deadline(100,75,90,Some(80)),75);
        assert_eq!(steam_diagnostic_deadline(70,75,90,Some(80)),70);
        assert_eq!(steam_diagnostic_deadline(u64::MAX,u64::MAX,0,None),0);
    }
    #[test]fn diagnostic_scope_uses_session_epoch_and_all_original_fields(){
        let original=SteamOriginalScope{session_id:"session".into(),safety_session_ref:"safety".into(),original_epoch:0,native_expires_at_ms:90};
        assert!(steam_diagnostic_scope_matches(&original,&original,"session"));
        assert!(!steam_diagnostic_scope_matches(&original,&original,"other"));
        let changes:[fn(&mut SteamOriginalScope);5]=[
            |s|s.session_id.push('x'),|s|s.safety_session_ref.push('x'),|s|s.safety_session_ref.clear(),
            |s|s.original_epoch+=1,|s|s.native_expires_at_ms-=1];
        for change in changes{let mut changed=original.clone();change(&mut changed);assert!(!steam_diagnostic_scope_matches(&changed,&original,"session"));}
    }
    #[test]fn diagnostic_tombstone_checks_are_read_only_and_count_only_live_rows(){
        let mut rows=HashMap::new();rows.insert(("session".into(),"workflow".into()),10);
        let original=rows.clone();assert!(steam_diagnostic_tombstones_clear(&rows,"session","workflow",10));assert_eq!(rows,original);
        assert!(!steam_diagnostic_tombstones_clear(&rows,"session","workflow",9));assert_eq!(rows,original);
        for n in 0..63{rows.insert(("other".into(),n.to_string()),20);}
        assert!(steam_diagnostic_tombstones_clear(&rows,"session","workflow",10));
        rows.insert(("other".into(),"63".into()),20);let original=rows.clone();
        assert!(!steam_diagnostic_tombstones_clear(&rows,"session","workflow",10));assert_eq!(rows,original);
        assert!(steam_diagnostic_tombstones_clear(&rows,"session","workflow",20));assert_eq!(rows,original);
    }
    #[test]fn diagnostic_cloned_state_is_equal_without_navigation_and_has_no_root_authority(){
        let original=row();assert!(steam_diagnostic_same_state(&original,&original.clone()));
        assert!(original.game_entry.is_none()&&original.pending_game.is_none()&&original.steam_counts.is_none());
        assert!(!steam_diagnostic_same_row(&original,&original.clone()));
    }
    #[test]fn diagnostic_rejects_source_nonce_owner_state_and_expiry_changes(){
        let original=row();
        for key in ["ownerBindingId","nonce","state"]{
            let mut changed=original.clone();changed.source[key]=json!("changed");assert!(!steam_diagnostic_same_state(&original,&changed));
        }
        let mut changed=original.clone();changed.expires_at-=1;assert!(!steam_diagnostic_same_state(&original,&changed));
        changed=original.clone();changed.steam_effective_expiry=Some(80);assert!(!steam_diagnostic_same_state(&original,&changed));
    }
    #[test]fn diagnostic_rejects_target_epoch_scope_and_blocked_changes(){
        let original=row();
        let changes:[fn(&mut TaskBinding);8]=[
            |r|r.target.as_mut().unwrap().hwnd+=1,|r|r.target.as_mut().unwrap().pid+=1,
            |r|r.target.as_mut().unwrap().image.push('x'),|r|r.blocked=true,
            |r|r.steam_scope.as_mut().unwrap().original_epoch+=1,|r|r.steam_scope.as_mut().unwrap().native_expires_at_ms-=1,
            |r|r.steam_scope.as_mut().unwrap().safety_session_ref.push('x'),|r|r.steam_scope.as_mut().unwrap().session_id.push('x')];
        for change in changes{let mut changed=original.clone();change(&mut changed);assert!(!steam_diagnostic_same_state(&original,&changed));}
    }
    #[test]fn diagnostic_rejects_concurrent_action_state_changes(){
        let original=row();
        let changes:[fn(&mut TaskBinding);10]=[
            |r|r.pending=Some(("action".into(),"permit".into())),|r|{r.mapped.insert("action".into(),"id".into());},
            |r|r.last_post=Some(json!({"observationId":"changed"})),|r|r.pending_pre=Some(json!({})),
            |r|r.requested_dispatch=true,|r|r.pending_requested=true,|r|r.last_game=true,
            |r|r.game_name=Some("Other".into()),|r|r.bridge.push('x'),|r|r.app="other".into()];
        for change in changes{let mut changed=original.clone();change(&mut changed);assert!(!steam_diagnostic_same_state(&original,&changed));}
    }
}

pub(crate) fn task_game_target(session:&str,workflow:&str,hwnd:isize,pid:u32,guard:&dyn Fn()->Result<(),String>)->Result<native_uia::LocatedTarget,String>{
    guard()?;let mut row=task_take(session,workflow)?;
    if !steam_marked(&row)||row.pending.is_some()||row.game_entry.is_some()||row.steam_library.is_some(){return Err("Native Steam entry intent unavailable or already issued".into());}
    let target=foreground_target("steam",guard)?.ok_or("Native Steam foreground missing")?;
    let expected=row.target.as_ref().ok_or("Native Steam target not established")?;
    if target.hwnd!=hwnd||target.pid!=pid||target.window_id!=expected.window_id||target.pid!=expected.pid||target.image!=expected.image{return Err("Native Steam entry window differs from retained task".into());}
    let checkpoint=steam_live_checkpoint(&row)?;
    let scoped=||steam_checkpoint_guard(&row,&checkpoint,&target,guard);
    scoped()?;
    let held:std::sync::Arc<dyn Send+Sync>=row.steam_root.as_ref().ok_or("Steam original held root missing")?.clone();
    let library=native_uia::steam_approved_library_entry(hwnd,pid,row.game_name.as_deref().ok_or("Native Steam name missing")?,steam_capture_deadline(&row)?,held,&scoped);
    let post=scoped();let library=task_preserve_work(library,post)?;
    let result=library.entry.target.clone();row.game_entry=Some(library.entry.clone());row.steam_library=Some(library);
    task_commit(session,workflow,row,guard)?;Ok(result)
}
pub(crate) fn task_game_input_context(session:&str,workflow:&str,target_id:Option<&str>,guard:&dyn Fn()->Result<(),String>)->Result<(),String>{
    let row=steam_diagnostic_live_row(session,workflow)?;
    if let Some(nav)=&row.pending_game{
        if row.blocked||row.pending.is_none()||target_id!=Some(nav.target_id.as_str()){return Err("Native game dispatch marker changed".into());}
        let target=foreground_target("steam",guard)?.ok_or("Native Steam foreground missing")?;
        let expected=row.target.as_ref().ok_or("Native Steam target missing")?;
        if target.window_id!=expected.window_id||target.pid!=expected.pid||target.image!=expected.image{return Err("Native Steam immediate input identity changed".into());}
        let checkpoint=steam_live_checkpoint(&row)?;
        // Finish all blocking safety HTTP before the last genuine semantic acquisition.
        let full=||steam_checkpoint_guard(&row,&checkpoint,&target,guard);
        let local=||steam_checkpoint_guard_local(&row,&checkpoint,&target);
        let retained=row.steam_library.as_ref().ok_or("NATIVE_STEAM_PROFILE_PIN_REQUIRED")?;
        let held:std::sync::Arc<dyn Send+Sync>=row.steam_root.as_ref().ok_or("Steam original held root missing")?.clone();
        let deadline=steam_capture_deadline(&row)?;
        let library=steam_final_capture(&full,&local,||native_uia::steam_revalidate_library_entry(target.hwnd,target.pid,retained,deadline,held,&local))?;
        if !steam_library_same(retained,&library)||steam_entry_hash(&row,&target,&library.entry)!=nav.entry_fingerprint{
            return Err("Native Steam entry/profile changed before input".into());
        }
        // Only genuine local checks remain here; computer input_guard performs its volatile checks after return.
        local()?;
    }Ok(())
}
fn path_hash(value:&str)->String{text_hash(&value.replace('/',"\\").trim_end_matches('\\').to_lowercase())}
#[derive(Clone,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
struct FindSource{operation_id:String,nonce:String,owner_binding_id:String,source_file_id:String,source_path:String,parent_path:String,root_id:String,root_identity:String,parent_identity:String,source_identity:String,content_sha256:String,expires_at:u64}
struct FindJob{source:FindSource,claim:String,bridge:String,workflow:String,permit:Option<String>,issued_text:Option<(String,String)>,expires:u64}
static FIND_JOBS:OnceLock<Mutex<HashMap<(String,String),FindJob>>>=OnceLock::new();
fn find_jobs()->&'static Mutex<HashMap<(String,String),FindJob>>{FIND_JOBS.get_or_init(||Mutex::new(HashMap::new()))}
fn find_request(token:&str,port:u16,operation:Option<&str>,action:&str,claim:Option<&str>,body:Option<&Value>,guard:&dyn Fn()->Result<(),String>)->Result<Value,String>{
    guard()?;let suffix=match(operation,action){(None,"next")=>"next".into(),(Some(id),"source"|"check"|"finish"|"cancel")if task_id(id)=>format!("{id}/{action}"),_=>return Err("Native FIND route denied".into())};
    let client=reqwest::blocking::Client::builder().no_proxy().redirect(reqwest::redirect::Policy::none()).timeout(Duration::from_secs(2)).build().map_err(|_|"Native FIND client unavailable")?;
    let url=format!("http://127.0.0.1:{port}/api/computer-use/native-explorer-find/{suffix}");
    let mut request=if matches!(action,"next"|"source"){client.get(url)}else{client.post(url).json(body.ok_or("Native FIND context missing")?)};
    if let Some(claim)=claim{if !task_id(claim){return Err("Native FIND claim invalid".into());}request=request.header("x-edith-find-claim",claim);}
    guard()?;let response=request.bearer_auth(token).send().map_err(|_|"Native FIND backend unavailable")?;guard()?;
    if !response.status().is_success(){return Err("Native FIND backend denied source or proof".into());}
    let mut bytes=Vec::new();response.take(65537).read_to_end(&mut bytes).map_err(|_|"Native FIND response unreadable")?;guard()?;
    if bytes.len()>65536{return Err("Native FIND response budget exceeded".into());}
    let value:Value=serde_json::from_slice(&bytes).map_err(|_|"Native FIND response invalid")?;if value["success"]!=json!(true){return Err("Native FIND response failed".into());}Ok(value)
}
fn claim_find(token:&str,port:u16,session:&str,workflow:&str,deadline:u64,guard:&dyn Fn()->Result<(),String>)->Result<Option<ExplorerClaimDescriptor>,String>{
    {let mut rows=find_jobs().lock().map_err(|_|"Native FIND state unavailable")?;rows.retain(|_,job|job.expires>now_ms().unwrap_or(u64::MAX));if rows.len()>=8{return Err("Native FIND queue full".into());}}
    let poll=find_request(token,port,None,"next",None,None,guard)?;exact_keys(&poll,&["success","job"],&[])?;if poll["job"].is_null(){return Ok(None)}
    let claim:ExplorerPoll=serde_json::from_value(poll["job"].clone()).map_err(|_|"Native FIND claim schema invalid")?;
    if !task_id(&claim.operation_id)||!task_id(&claim.claim_nonce){return Err("Native FIND claim invalid".into());}
    let response=find_request(token,port,Some(&claim.operation_id),"source",Some(&claim.claim_nonce),None,guard)?;exact_keys(&response,&["success","source"],&[])?;
    let source:FindSource=serde_json::from_value(response["source"].clone()).map_err(|_|"Native FIND source schema invalid")?;
    let now=now_ms()?;
    if source.operation_id!=claim.operation_id||source.expires_at!=claim.expires_at||source.expires_at<=now||source.expires_at>now.saturating_add(120000)
        ||![&source.nonce,&source.owner_binding_id,&source.source_file_id].iter().all(|s|task_id(s))
        ||![&source.root_identity,&source.parent_identity,&source.source_identity,&source.content_sha256].iter().all(|s|identity(s))
        ||!matches!(source.root_id.as_str(),"workspace"|"artifacts")||!approved_path(&source.source_path)||!approved_path(&source.parent_path){return Err("Native FIND source provenance invalid".into());}
    let(parent,name)=source.source_path.rsplit_once(['\\','/']).ok_or("Native FIND source parent missing")?;
    if path_hash(parent)!=path_hash(&source.parent_path)||name.is_empty(){return Err("Native FIND parent/name mismatch".into());}
    let expires=source.expires_at.min(now.saturating_add(20000)).min(deadline);if expires<=now{return Err("Native FIND reservation expired".into());}
    let task=associate_explorer(token,port,session,workflow,&source.operation_id,&source.owner_binding_id,expires,guard)?;
    let descriptor=ExplorerClaimDescriptor{operation_id:source.operation_id.clone(),operation:"find".into(),reverse_of:None,source_name:name.into(),source_parent_fingerprint:path_hash(parent),destination_parent_fingerprint:path_hash(parent),expires_at:expires,quarantine:false,
        task_id:task["taskId"].as_str().ok_or("FIND taskId missing")?.into(),binding_id:task["bindingId"].as_str().ok_or("FIND bindingId missing")?.into(),task_state:task["state"].as_str().ok_or("FIND task state missing")?.into()};
    guard()?;let mut rows=find_jobs().lock().map_err(|_|"Native FIND state unavailable")?;
    if rows.len()>=8||rows.contains_key(&(session.into(),source.operation_id.clone())){return Err("Native FIND claim replay or capacity exceeded".into());}
    rows.insert((session.into(),source.operation_id.clone()),FindJob{source,claim:claim.claim_nonce,bridge:bridge_binding(token,port,session)?,workflow:workflow.into(),permit:None,issued_text:None,expires});Ok(Some(descriptor))
}
fn find_context(job:&FindJob)->Value{let s=&job.source;json!({"claimNonce":job.claim,"nonce":s.nonce,"ownerBindingId":s.owner_binding_id,"sourceFileId":s.source_file_id,"rootIdentity":s.root_identity,"parentIdentity":s.parent_identity,"sourceIdentity":s.source_identity,"contentSha256":s.content_sha256})}
fn find_exchange(token:&str,port:u16,session:&str,operation:&str,action:&str,guard:&dyn Fn()->Result<(),String>)->Result<Value,String>{
    if !matches!(action,"check"|"finish"|"cancel"){return Err("Native FIND exchange action denied".into());}
    guard()?;let key=(session.into(),operation.into());let mut job=find_jobs().lock().map_err(|_|"Native FIND state unavailable")?.remove(&key).ok_or("Native FIND claim consumed")?;
    if job.bridge!=bridge_binding(token,port,session)?||job.expires<=now_ms()?{return Err("Native FIND claim expired or bridge changed".into());}
    let mut body=find_context(&job);
    if action=="finish"{
        body["permitNonce"]=json!(job.permit.as_ref().ok_or("Native FIND permit missing")?);
        let rows=task_bindings().lock().map_err(|_|"Native FIND task ledger unavailable")?;let row=rows.get(&(session.into(),job.workflow.clone())).ok_or("Native FIND task binding missing")?;
        let post=row.last_post.as_ref().ok_or("Native FIND actual post missing")?;
        if row.blocked||row.pending.is_some()||post["folderFingerprint"]!=json!(path_hash(&job.source.parent_path))||post["selectedNameFingerprint"]!=json!(text_hash(job.source.source_path.rsplit_once(['\\','/']).ok_or("FIND filename missing")?.1))||post["selectedCount"]!=json!(1)
            ||post["observedAt"].as_u64().is_none_or(|t|now_ms().unwrap_or(u64::MAX).saturating_sub(t)>5000){return Err("Native FIND exact fresh folder/selection task proof missing".into());}
        body["postObservationId"]=post["observationId"].clone();
    }
    let response=find_request(token,port,Some(operation),action,None,Some(&body),guard)?;
    if action=="check"{let p=&response["permit"];exact_keys(p,&["permitNonce","expiresAt"],&[])?;let permit=p["permitNonce"].as_str().filter(|s|task_id(s)).ok_or("Native FIND permit invalid")?;if p["expiresAt"]!=json!(job.source.expires_at){return Err("Native FIND permit expiry mismatch".into());}job.permit=Some(permit.into());}
    guard()?;if action=="check"{find_jobs().lock().map_err(|_|"Native FIND state unavailable")?.insert(key,job);}else{task_block(session,Some(&job.workflow));}Ok(response)
}
fn task_observation()->Result<(String,u64),String>{let now=now_ms()?;let id=TASK_OBSERVATION.fetch_add(1,std::sync::atomic::Ordering::SeqCst);Ok((format!("native-task-{now}-{id}"),now))}
const PRIVATE_TASK_RESPONSE_LIMIT:usize=65536;
const PRIVATE_TASK_CODE_LIMIT:usize=96;
const PRIVATE_TASK_REJECTED:&str="Private task backend rejected authority or postcondition";
// Source-frozen finite transport catalog, CANONICAL_ERROR_CONTRACT.json v1.
// These labels carry failures only: no status-based authority inference.
const TASK_CANONICAL_CODES:&[&str]=&[
    "APP_FOCUS_UNVERIFIED",
    "APP_GAME_TARGET_UNSUPPORTED",
    "APP_INPUT_PARTIAL",
    "APP_PLAYBACK_STATE_UNSUPPORTED",
    "APP_PLAYBACK_UNVERIFIED",
    "APP_SEARCH_RESULTS_UNVERIFIED",
    "APP_SEARCH_VALUE_UNVERIFIED",
    "APP_TARGET_AMBIGUOUS",
    "APP_TARGET_UNSUPPORTED",
    "APP_TASK_BINDING_INVALID",
    "APP_TASK_CREATE_REJECTED",
    "APP_TASK_NOT_COMPLETED",
    "APP_TASK_PROOF_UNAVAILABLE",
    "APP_TASK_READBACK_REJECTED",
    "APP_TASK_REQUIRED_PROOF_UNVERIFIED",
    "APP_TASK_SESSION_INVALID",
    "APP_VOLUME_UNVERIFIED",
    "APP_WINDOW_CHANGED",
    "APP_WORKFLOW_EXPIRED",
    "APP_WORKFLOW_IDEMPOTENCY_CONFLICT",
    "APP_WORKFLOW_IDENTITY_INVALID",
    "APP_WORKFLOW_INVALID",
    "APP_WORKFLOW_LEDGER_FULL",
    "APP_WORKFLOW_RESERVATION_INVALID",
    "APP_WORKFLOW_RESOURCE_BUSY",
    "APP_WORKFLOW_UNVERIFIED",
    "EXPLORER_APPROVED_TEXT_CHANGED",
    "EXPLORER_APPROVED_TEXT_INVALID",
    "EXPLORER_CLAIM_INVALID",
    "EXPLORER_DESTINATION_CONFLICT",
    "EXPLORER_DESTINATION_INVALID",
    "EXPLORER_EFFECT_UNVERIFIED",
    "EXPLORER_FINAL_PROOF_CHANGED",
    "EXPLORER_OVERWRITE_BLOCKED",
    "EXPLORER_PLAN_INVALID",
    "EXPLORER_PLAN_REJECTED",
    "EXPLORER_POLL_BUDGET_EXHAUSTED",
    "EXPLORER_PRIOR_EFFECT_UNVERIFIED",
    "EXPLORER_QUARANTINE_CONFLICT",
    "EXPLORER_QUARANTINE_REQUIRED",
    "EXPLORER_SELECTION_AMBIGUOUS",
    "EXPLORER_SOURCE_INVALID",
    "FILES_NATIVE_UNAVAILABLE",
    "KILL_SWITCH_ACTIVE",
    "NATIVE_ACTION_RECEIPT_INVALID",
    "NATIVE_ACTION_REPLAY_OR_LIMIT",
    "NATIVE_BINDING_CLOSED",
    "NATIVE_BINDING_EXPIRED",
    "NATIVE_BINDING_INPUT_INVALID",
    "NATIVE_BINDING_LIMIT",
    "NATIVE_BINDING_NOT_FOUND",
    "NATIVE_BINDING_REVOKED",
    "NATIVE_CONTEXT_EXPIRED",
    "NATIVE_CONTEXT_INVALID",
    "NATIVE_DISPATCH_FAILED",
    "NATIVE_DISPATCH_INCOMPLETE",
    "NATIVE_EXPLORER_PLAN_REQUIRED",
    "NATIVE_FIND_LEDGER_REQUIRED",
    "NATIVE_GAME_NAVIGATION_ACTION_INVALID",
    "NATIVE_GAME_NAVIGATION_DISPATCH_MISMATCH",
    "NATIVE_IDEMPOTENCY_CONFLICT",
    "NATIVE_IDEMPOTENCY_REQUIRED",
    "NATIVE_LEDGER_INCOMPLETE",
    "NATIVE_OBSERVATION_REPLAY",
    "NATIVE_OPERATION_ASSOCIATION_INVALID",
    "NATIVE_OPERATION_ASSOCIATION_REPLAY",
    "NATIVE_OPERATION_BINDING_REQUIRED",
    "NATIVE_OPERATION_CONFLICT",
    "NATIVE_OPERATION_UNVERIFIED",
    "NATIVE_OWNER_EXPIRED",
    "NATIVE_OWNER_INVALID",
    "NATIVE_POSTSTATE_INVALID",
    "NATIVE_POSTSTATE_STALE",
    "NATIVE_REQUIRED_POSTCONDITION_FAILED",
    "NATIVE_RESERVATION_ALREADY_BOUND",
    "NATIVE_RESERVATION_PRESTATE_INVALID",
    "NATIVE_SAFETY_AUTHORITY_UNAVAILABLE",
    "NATIVE_SAFETY_MEMBERSHIP_CHANGED",
    "NATIVE_SAFETY_MEMBERSHIP_INVALID",
    "NATIVE_SAFETY_MEMBERSHIP_LOST",
    "NATIVE_SAFETY_OWNER_INVALID",
    "NATIVE_SAFETY_SESSION_AMBIGUOUS",
    "NATIVE_SAFETY_SESSION_UNAVAILABLE",
    "NATIVE_SAFETY_TRANSPORT_UNKNOWN",
    "NATIVE_SESSION_APPLICATION_MISMATCH",
    "NATIVE_SESSION_CONCURRENT_RESERVATION",
    "NATIVE_SESSION_CONFIGURATION_REQUIRED",
    "NATIVE_SESSION_CONFLICT",
    "NATIVE_SESSION_EXPIRED",
    "NATIVE_SESSION_INVALID",
    "NATIVE_SESSION_LIMIT",
    "NATIVE_SKIP_ACTION_INVALID",
    "NATIVE_SKIP_DISPATCH_MISMATCH",
    "NATIVE_STEAM_FINAL_PROFILE_INVALID",
    "NATIVE_STEAM_PROFILE_APPROVAL_LOST",
    "NATIVE_STEAM_PROFILE_CHANGED",
    "NATIVE_STEAM_PROFILE_PIN_REQUIRED",
    "NATIVE_STEAM_PROFILE_UNAPPROVED",
    "NATIVE_STOP_CAPACITY",
    "NATIVE_STOP_EXPIRED",
    "NATIVE_STOP_IDEMPOTENCY_CONFLICT",
    "NATIVE_STOP_INPUT_INVALID",
    "NATIVE_STOP_NOT_FOUND",
    "NATIVE_STOP_OWNER_INVALID",
    "NATIVE_STOP_OWNER_UNAVAILABLE",
    "NATIVE_STOP_PHASE_INVALID",
    "NATIVE_STOP_PHASE_REGRESSION",
    "NATIVE_STOP_RECEIPT_CONFLICT",
    "NATIVE_STOP_REQUEST_UNAVAILABLE",
    "NATIVE_STOP_SCOPE_INVALID",
    "NATIVE_STOP_SCOPE_UNAVAILABLE",
    "NATIVE_STOP_SESSION_ALREADY_ACTIVE",
    "NATIVE_STOP_SESSION_ALREADY_REGISTERED",
    "NATIVE_STOP_TIME_INVALID",
    "NATIVE_TARGET_BINDING_INVALID",
    "NATIVE_WORKFLOW_INVALID",
    "OWNER_REVOKED",
    "OWNER_SESSION_REQUIRED",
];
#[derive(Deserialize)]
struct TaskErrorEnvelope {
    #[serde(rename="errorCode")]
    error_code:Option<String>,
}
fn task_canonical_error(status:u16,bytes:&[u8])->Option<&'static str>{
    if (200..300).contains(&status)||bytes.len()>PRIVATE_TASK_RESPONSE_LIMIT{return None;}
    // Struct deserialization rejects duplicate errorCode fields and wrong
    // types. Unknown fields (including message) are ignored, never forwarded.
    let envelope:TaskErrorEnvelope=serde_json::from_slice(bytes).ok()?;
    let code=envelope.error_code?;
    if code.len()>PRIVATE_TASK_CODE_LIMIT{return None;}
    TASK_CANONICAL_CODES.binary_search(&code.as_str()).ok().map(|index|TASK_CANONICAL_CODES[index])
}
fn task_decode_response(status:u16,bytes:&[u8])->Result<Value,String>{
    if bytes.len()>PRIVATE_TASK_RESPONSE_LIMIT{return Err("Private task response budget exceeded".into());}
    if !(200..300).contains(&status){return Err(task_canonical_error(status,bytes).unwrap_or(PRIVATE_TASK_REJECTED).into());}
    let value:Value=serde_json::from_slice(bytes).map_err(|_|"Private task response invalid")?;
    if value["success"]!=json!(true){return Err("Private task response failed".into());}Ok(value)
}
fn task_preserve_work<T>(work:Result<T,String>,post_guard:Result<(),String>)->Result<T,String>{
    match (work,post_guard){(Err(first),_)=>Err(first),(Ok(value),Ok(()))=>Ok(value),(Ok(_),Err(error))=>Err(error)}
}
fn task_after_send<T>(sent:Result<T,String>,guard:&dyn Fn()->Result<(),String>)->Result<(T,Result<(),String>),String>{
    // Do not short-circuit the safety effects when transport has failed.
    let post_guard=guard();sent.map(|response|(response,post_guard))
}
fn task_response_after_send<F>(status:u16,read:F,post_send_guard:Result<(),String>,guard:&dyn Fn()->Result<(),String>)->Result<Value,String>
where F:FnOnce()->Result<Vec<u8>,String>{
    if (200..300).contains(&status){post_send_guard?;}
    // An already observed non2xx is a work failure. Its bounded passive body
    // may recover only a finite failure label after the immediate guard has
    // executed, even if that guard denied. No request/action follows; this
    // branch always returns Err. Successful responses never bypass a denial.
    let work=read().and_then(|bytes|task_decode_response(status,&bytes));
    let post_read_guard=guard();
    task_preserve_work(work,post_read_guard)
}
fn task_finish_post_freshness(observed_at:Option<u64>,now:u64)->Result<(),String>{
    let observed_at=observed_at.ok_or("Native task actual post-observation invalid")?;
    if now.saturating_sub(observed_at)>5000{return Err("NATIVE_POSTSTATE_STALE".into());}Ok(())
}
fn task_request(token:&str,port:u16,binding:Option<&str>,action:&str,body:Option<&Value>,guard:&dyn Fn()->Result<(),String>)->Result<Value,String>{
    guard()?;
    let suffix=match(binding,action){
        (None,"session"|"associate"|"owner-context")=>action.to_owned(),
        (Some(id),"source"|"target"|"check"|"step"|"finish"|"cancel")if task_id(id)=>format!("{id}/{action}"),
        _=>return Err("Private task route denied".into())};
    let client=reqwest::blocking::Client::builder().no_proxy().redirect(reqwest::redirect::Policy::none()).timeout(Duration::from_secs(2)).build().map_err(|_|"Private task client unavailable")?;
    let url=format!("http://127.0.0.1:{port}/api/computer-use/native-workflows/{suffix}");
    let request=if matches!(action,"source"|"owner-context"){client.get(url)}else{client.post(url).json(body.ok_or("Private task body unavailable")?)};
    guard()?;
    let sent=request.bearer_auth(token).send().map_err(|_|"Private task backend unavailable".to_owned());
    let(response,post_send_guard)=task_after_send(sent,guard)?;
    let status=response.status().as_u16();
    task_response_after_send(status,||{
        let mut bytes=Vec::new();response.take((PRIVATE_TASK_RESPONSE_LIMIT+1) as u64).read_to_end(&mut bytes).map_err(|_|"Private task response unreadable")?;Ok(bytes)
    },post_send_guard,guard)
}
#[cfg(test)]
mod task_canonical_error_tests {
    use super::*;
    use std::cell::Cell;
    fn encoded(code:&str)->Vec<u8>{serde_json::to_vec(&json!({"errorCode":code,"message":"SIM_PRIVATE_MESSAGE_NOT_FOR_TRANSPORT"})).unwrap()}
    #[test] fn canonical_whitelist_exact_frozen_array_parity(){
        assert_eq!(TASK_CANONICAL_CODES.len(),118);assert!(TASK_CANONICAL_CODES.windows(2).all(|p|p[0]<p[1]));
        let bytes=serde_json::to_vec(TASK_CANONICAL_CODES).unwrap();
        assert_eq!(format!("{:x}",Sha256::digest(bytes)).to_uppercase(),"9D47F33FFD15FFB4EBC351FF785068466C31ACEF678D8C2288A327B4A1F029F2");
        assert!(TASK_CANONICAL_CODES.iter().all(|c|c.len()<=PRIVATE_TASK_CODE_LIMIT));
    }
    #[test] fn every_frozen_code_survives_non2xx_without_status_inference(){
        for code in TASK_CANONICAL_CODES {for status in [100,199,300,399,400,401,403,404,409,410,422,429,500,503,599] {
            assert_eq!(task_canonical_error(status,&encoded(code)),Some(*code));assert_eq!(task_decode_response(status,&encoded(code)).unwrap_err(),*code);
        }}
    }
    #[test] fn exact_match_rejects_prefix_case_whitespace_unicode_and_overlong(){
        for code in ["APP_FAKE","APP_TASK_BINDING_INVALID: private detail","APP_TASK_BINDING_INVALID_EXTRA","app_task_binding_invalid"," APP_TASK_BINDING_INVALID","APP_TASK_BINDING_INVALID ","APP_TASK_BINDING_INVALID\n","KILL_SWITCH_ACTIVE_extra","OWNER_REVOKED\u{200b}"]{
            assert_eq!(task_canonical_error(409,&encoded(code)),None);assert_eq!(task_decode_response(409,&encoded(code)).unwrap_err(),PRIVATE_TASK_REJECTED);
        }
        assert_eq!(task_canonical_error(409,&encoded(&"A".repeat(PRIVATE_TASK_CODE_LIMIT+1))),None);
    }
    #[test] fn unknown_fields_and_messages_never_become_codes(){
        for bytes in [br#"{"message":"OWNER_REVOKED"}"#.as_slice(),br#"{"error":{"errorCode":"OWNER_REVOKED"}}"#,br#"{"errorCode":null}"#,br#"{"errorCode":true}"#,br#"{"errorCode":3}"#,br#"{"errorCode":["OWNER_REVOKED"]}"#,br#"{"errorCode":{"value":"OWNER_REVOKED"}}"#,br#""OWNER_REVOKED""#,b"[]",b"null",b"3"] {
            assert_eq!(task_canonical_error(401,bytes),None);assert_eq!(task_decode_response(401,bytes).unwrap_err(),PRIVATE_TASK_REJECTED);
        }
        assert_eq!(task_decode_response(403,b"{}").unwrap_err(),PRIVATE_TASK_REJECTED);
    }
    #[test] fn malformed_duplicate_and_wrong_encoding_fail_closed(){
        for bytes in [b"{".as_slice(),b"",br#"{"errorCode":"OWNER_REVOKED"} trailing"#,br#"{"errorCode":"OWNER_REVOKED","errorCode":"OWNER_REVOKED"}"#,br#"{"errorCode":null,"errorCode":"OWNER_REVOKED"}"#,b"\xff"] {
            assert_eq!(task_canonical_error(409,bytes),None);assert_eq!(task_decode_response(409,bytes).unwrap_err(),PRIVATE_TASK_REJECTED);
        }
    }
    #[test] fn response_budget_exact_boundary_and_overflow(){
        let mut bytes=encoded("OWNER_REVOKED");bytes.resize(PRIVATE_TASK_RESPONSE_LIMIT,b' ');
        assert_eq!(task_canonical_error(409,&bytes),Some("OWNER_REVOKED"));
        bytes.push(b' ');assert_eq!(task_canonical_error(409,&bytes),None);
        assert_eq!(task_decode_response(409,&bytes).unwrap_err(),"Private task response budget exceeded");
        assert_eq!(task_decode_response(200,&bytes).unwrap_err(),"Private task response budget exceeded");
    }
    #[test] fn success_status_cannot_transport_failure_label(){
        for status in [200,201,204,299]{assert_eq!(task_canonical_error(status,&encoded("OWNER_REVOKED")),None);assert_eq!(task_decode_response(status,&encoded("OWNER_REVOKED")).unwrap_err(),"Private task response failed");}
        assert_eq!(task_decode_response(200,br#"{"success":true,"result":{"state":"SIM"}}"#).unwrap()["result"]["state"],"SIM");
        assert_eq!(task_decode_response(409,br#"{"success":true,"errorCode":"OWNER_REVOKED"}"#).unwrap_err(),"OWNER_REVOKED");
    }
    #[test] fn known_non2xx_preserves_first_error_after_failed_guards(){
        let calls=Cell::new(0);let guard=||{calls.set(calls.get()+1);Err("KILL_SWITCH_ACTIVE".into())};
        let(_,post_send)=task_after_send(Ok(()),&guard).unwrap();
        let error=task_response_after_send(409,||Ok(encoded("NATIVE_POSTSTATE_STALE")),post_send,&guard).unwrap_err();
        assert_eq!(error,"NATIVE_POSTSTATE_STALE");assert_eq!(calls.get(),2);
    }
    #[test] fn unknown_non2xx_is_safe_after_failed_guards(){
        let calls=Cell::new(0);let guard=||{calls.set(calls.get()+1);Err("KILL_SWITCH_ACTIVE".into())};
        let(_,post_send)=task_after_send(Ok(()),&guard).unwrap();
        let error=task_response_after_send(503,||Ok(encoded("SIM_UNKNOWN_PRIVATE_MESSAGE")),post_send,&guard).unwrap_err();
        assert_eq!(error,PRIVATE_TASK_REJECTED);assert!(!error.contains("SIM_"));assert_eq!(calls.get(),2);
    }
    #[test] fn successful_status_failed_post_send_guard_never_reads_or_returns_ok(){
        let calls=Cell::new(0);let reads=Cell::new(0);let guard=||{calls.set(calls.get()+1);Err("KILL_SWITCH_ACTIVE".into())};
        let(_,post_send)=task_after_send(Ok(()),&guard).unwrap();
        let error=task_response_after_send(200,||{reads.set(reads.get()+1);Ok(br#"{"success":true}"#.to_vec())},post_send,&guard).unwrap_err();
        assert_eq!(error,"KILL_SWITCH_ACTIVE");assert_eq!(calls.get(),1);assert_eq!(reads.get(),0);
    }
    #[test] fn transport_failure_wins_and_post_send_guard_still_executes(){
        let calls=Cell::new(0);let guard=||{calls.set(calls.get()+1);Err("KILL_SWITCH_ACTIVE".into())};
        let error=task_after_send::<()>(Err("Private task backend unavailable".into()),&guard).unwrap_err();
        assert_eq!(error,"Private task backend unavailable");assert_eq!(calls.get(),1);
    }
    #[test] fn unreadable_response_wins_and_post_read_guard_executes(){
        let calls=Cell::new(0);let guard=||{calls.set(calls.get()+1);Err("KILL_SWITCH_ACTIVE".into())};
        let error=task_response_after_send(200,||Err("Private task response unreadable".into()),Ok(()),&guard).unwrap_err();
        assert_eq!(error,"Private task response unreadable");assert_eq!(calls.get(),1);
    }
    #[test] fn malformed_success_failure_wins_over_post_read_guard(){
        let calls=Cell::new(0);let guard=||{calls.set(calls.get()+1);Err("KILL_SWITCH_ACTIVE".into())};
        assert_eq!(task_response_after_send(200,||Ok(b"{".to_vec()),Ok(()),&guard).unwrap_err(),"Private task response invalid");assert_eq!(calls.get(),1);
    }
    #[test] fn valid_success_is_denied_by_post_read_guard(){
        let calls=Cell::new(0);let guard=||{calls.set(calls.get()+1);Err("KILL_SWITCH_ACTIVE".into())};
        assert_eq!(task_response_after_send(200,||Ok(br#"{"success":true}"#.to_vec()),Ok(()),&guard).unwrap_err(),"KILL_SWITCH_ACTIVE");assert_eq!(calls.get(),1);
    }
    #[test] fn first_work_error_generic_join_is_not_replaced(){
        assert_eq!(task_preserve_work::<()>(Err("NATIVE_BINDING_REVOKED".into()),Err("KILL_SWITCH_ACTIVE".into())).unwrap_err(),"NATIVE_BINDING_REVOKED");
        assert_eq!(task_preserve_work(Ok(3),Err("KILL_SWITCH_ACTIVE".into())).unwrap_err(),"KILL_SWITCH_ACTIVE");
        assert_eq!(task_preserve_work(Ok(3),Ok(())).unwrap(),3);
    }
    #[test] fn only_actual_finish_age_maps_to_stale_canonical_code(){
        assert!(task_finish_post_freshness(Some(1000),6000).is_ok());
        assert_eq!(task_finish_post_freshness(Some(1000),6001).unwrap_err(),"NATIVE_POSTSTATE_STALE");
        assert_eq!(task_finish_post_freshness(None,6001).unwrap_err(),"Native task actual post-observation invalid");
        assert!(task_finish_post_freshness(Some(7000),6001).is_ok()); // Existing saturating-age policy, no new inference.
    }
}
fn task_context(row:&TaskBinding)->Value{let s=&row.source;json!({"nonce":s["nonce"],"taskId":s["taskId"],"ownerBindingId":s["ownerBindingId"],"sessionId":s["sessionId"],"reservationId":s["reservationId"],"requestDigest":s["requestDigest"]})}
fn foreground_target(app:&str,guard:&dyn Fn()->Result<(),String>)->Result<Option<TaskTarget>,String>{
    guard()?;let app=match app{"spotify"=>AllowedApp::Spotify,"steam"=>AllowedApp::Steam,"explorer"=>AllowedApp::Explorer,_=>return Err("Native task app denied".into())};
    let windows=native_app_operators::locate(app)?;guard()?;
    #[cfg(windows)]let foreground=unsafe{windows_sys::Win32::UI::WindowsAndMessaging::GetForegroundWindow()} as usize;
    #[cfg(not(windows))]let foreground=0usize;
    let eligible:Vec<_>=windows.iter().filter(|w|w.handle==foreground).collect();
    if eligible.len()>1{return Err("Native task foreground identity ambiguous".into());}
    let Some(window)=eligible.first()else{return Ok(None)};
    let image=window.image_path.to_str().ok_or("Native task image path encoding unavailable")?;
    Ok(Some(TaskTarget{window_id:format!("hwnd:{:x}",window.handle),pid:window.process_id,image:text_hash(image),hwnd:window.handle as isize}))
}
fn steam_detail_state_same(current:&Value,recorded:&Value)->bool{
    ["view","selectedCount","selectedGameFingerprint","gameTitleFingerprint","gameDetailContextFingerprint","gameDetailWitnessVersion","gameDetailProviderProfileFingerprint"]
        .iter().all(|field|current.get(*field).is_some()&&recorded.get(*field).is_some()&&current[*field]==recorded[*field])
}
fn steam_snapshot_state_same(current:&Value,recorded:&Value,detail:bool)->bool{
    if detail{return steam_detail_state_same(current,recorded);}
    current["view"]==json!("library")&&recorded["view"]==json!("library")
        &&current["gameEntryFingerprint"].as_str().is_some_and(identity)
        &&current["gameEntryFingerprint"]==recorded["gameEntryFingerprint"]
}
fn task_snapshot(row:&TaskBinding,guard:&dyn Fn()->Result<(),String>)->Result<Value,String>{
    let target=foreground_target(&row.app,guard)?.ok_or("Actual task app is not foreground")?;
    if let Some(expected)=&row.target{if expected.window_id!=target.window_id||expected.pid!=target.pid||expected.image!=target.image{return Err("Actual task foreground identity changed".into());}}
    if row.steam_scope.is_some(){steam_scope_current(row,&target,guard)?;}
    if row.pending_game.is_some()||row.last_game{
        steam_scope_current(row,&target,guard)?;
        let deadline=row.steam_effective_expiry.ok_or("Steam original navigation deadline missing")?;
        let (count_action,counts)=row.steam_counts.as_ref().ok_or("Steam genuine input count record missing")?;
        if !steam_counts_complete(counts,deadline)||counts.completed_at_ms>now_ms()?
            ||row.pending_game.as_ref().is_some_and(|n|n.canonical_action!=*count_action){return Err("Steam raw input count record invalid".into());}
        let checkpoint=steam_live_checkpoint(row)?;
        let scoped_guard=||steam_checkpoint_guard(row,&checkpoint,&target,guard);
        scoped_guard()?;
        let retained=row.steam_library.as_ref().ok_or("NATIVE_STEAM_PROFILE_PIN_REQUIRED")?;
        let held:std::sync::Arc<dyn Send+Sync>=row.steam_root.as_ref().ok_or("Steam held original root missing")?.clone();
        let captured=native_uia::steam_approved_main_detail(target.hwnd,target.pid,retained,deadline,held,&scoped_guard);
        let post=scoped_guard();let detail=task_preserve_work(captured,post)?;
        if !steam_profile_same(
            (&detail.profile_fingerprint,detail.profile_version,&detail.provider_identity,&detail.evidence_set_digest,detail.registry_revision),
            (&retained.profile_fingerprint,retained.profile_version,&retained.provider_identity,&retained.evidence_set_digest,retained.registry_revision)){
            return Err("NATIVE_STEAM_PROFILE_CHANGED".into());
        }
        let entry_hash=steam_entry_hash(row,&target,&retained.entry);
        let context=steam_v2_context(row,&target,&entry_hash,&detail)?;
        let fresh=foreground_target("steam",guard)?.ok_or("Native Steam detail foreground disappeared")?;
        if fresh.window_id!=target.window_id||fresh.pid!=target.pid||fresh.image!=target.image{return Err("Native Steam detail identity changed".into());}
        let(id,time)=task_observation()?;
        if time<counts.completed_at_ms{return Err("Steam observation predates actual input completion".into());}
        return Ok(json!({"source":"native_uia_state","observationId":id,"observedAt":time,"applicationId":"steam","windowId":target.window_id,"processId":target.pid,"imagePathFingerprint":target.image,"foreground":true,"view":"game_detail","selectedCount":1,"selectedGameFingerprint":entry_hash,"gameTitleFingerprint":text_hash(ecma_trim(&detail.main.title)),"gameDetailContextFingerprint":context,"gameDetailWitnessVersion":2,"gameDetailProviderProfileFingerprint":detail.profile_fingerprint}));
    }
    if steam_marked(row){
        // Focus/open receipt can precede locate. Even then admit context via the real evaluator.
        let checkpoint=steam_live_checkpoint(row)?;
        let scoped=||steam_checkpoint_guard(row,&checkpoint,&target,guard);
        scoped()?;
        let library=if row.steam_library.is_some(){steam_selective_revalidate(row,&target,guard)?}else{
            let held:std::sync::Arc<dyn Send+Sync>=row.steam_root.as_ref().ok_or("Steam held original root missing")?.clone();
            let result=native_uia::steam_approved_library_context(target.hwnd,target.pid,row.game_name.as_deref().ok_or("Steam immutable name missing")?,steam_capture_deadline(row)?,held,&scoped);
            let post=scoped();task_preserve_work(result,post)?
        };
        scoped()?;let(id,time)=task_observation()?;
        return Ok(json!({"source":"native_uia_state","observationId":id,"observedAt":time,"applicationId":"steam",
            "windowId":target.window_id,"processId":target.pid,"imagePathFingerprint":target.image,"foreground":true,
            "view":"library","gameEntryFingerprint":steam_entry_hash(row,&target,&library.entry)}));
    }
    let controls=snapshot(target.hwnd,target.pid,guard)?;
    let (id,time)=task_observation()?;
    let mut value=json!({"source":"native_uia_state","observationId":id,"observedAt":time,"applicationId":row.app,
        "windowId":target.window_id,"processId":target.pid,"imagePathFingerprint":target.image,"foreground":true});
    let named=|names:&[&str],kind:i32|controls.iter().filter(|c|c.control_type==kind&&names.contains(&c.name.trim().to_lowercase().as_str())).count();
    let play=named(&["play","oynat"],50000);let pause=named(&["pause","duraklat"],50000);
    if play==1&&pause==0{value["playback"]=json!("paused");}else if pause==1&&play==0{value["playback"]=json!("playing");}
    let tracks:Vec<_>=controls.iter().filter(|c|c.control_type==50020&&["now-playing-title","track-title","song-title"].contains(&c.automation_id.as_str())&&!c.name.trim().is_empty()).collect();
    if tracks.len()==1{value["trackFingerprint"]=json!(text_hash(&tracks[0].name));}
    let mut observed_views=Vec::new();
    for (view,ids) in [("search",&["search-view","search-results"][..]),("library",&["library-view","library-list","games-list"][..]),("downloads",&["downloads-view","downloads-list"][..])]{
        let views=controls.iter().filter(|c|matches!(c.control_type,50008|50026|50033)&&ids.contains(&c.automation_id.as_str())).count();
        if views==1{observed_views.push(view);}
    }
    if observed_views.len()==1{value["view"]=json!(observed_views[0]);value["itemCount"]=json!(controls.iter().filter(|c|matches!(c.control_type,50007|50029)).count());}
    if let Some(entry)=&row.game_entry{guard()?;let current=native_uia::steam_validate_entry(target.hwnd,target.pid,entry)?;guard()?;value["gameEntryFingerprint"]=json!(steam_entry_hash(row,&target,&current));}
    if let Some(query)=&row.query{let matches=controls.iter().filter(|c|c.control_type==50004&&["search","ara"].contains(&c.name.trim().to_lowercase().as_str())&&c.value.as_deref()==Some(query.as_str())).count();if matches==1{value["queryFingerprint"]=json!(text_hash(query));}}
    let volumes:Vec<_>=controls.iter().filter(|c|volume_slider(c)).collect();if volumes.len()==1{if let Ok((v,min,max))=range(volumes[0]){value["volume"]=json!((v-min)/(max-min)*100.0);}}
    if row.app=="explorer"{
        let addresses:Vec<_>=controls.iter().filter(|c|c.control_type==50004&&matches!(c.name.trim().to_lowercase().as_str(),"address"|"adres"|"address bar"|"adres çubuğu")&&c.value.as_ref().is_some_and(|v|approved_path(v))).collect();
        if addresses.len()==1{value["folderFingerprint"]=json!(path_hash(addresses[0].value.as_deref().ok_or("Explorer address missing")?));}
        let selected:Vec<_>=controls.iter().filter(|c|matches!(c.control_type,50007|50029)&&c.selected==Some(true)).collect();value["selectedCount"]=json!(selected.len());
        if selected.len()==1&&!selected[0].name.is_empty(){value["selectedNameFingerprint"]=json!(text_hash(&selected[0].name));}
    }
    guard()?;let fresh=foreground_target(&row.app,guard)?.ok_or("Native task foreground disappeared after UIA")?;
    if fresh.window_id!=target.window_id||fresh.pid!=target.pid||fresh.image!=target.image{return Err("Native task identity changed during UIA observation".into());}Ok(value)
}
fn task_take(session:&str,workflow:&str)->Result<TaskBinding,String>{
    steam_read_deny_mutation(session,Some(workflow))?;
    let mut rows=task_bindings().lock().map_err(|_|"Native task ledger unavailable")?;
    rows.retain(|_,row|row.expires_at>now_ms().unwrap_or(u64::MAX));
    let row=rows.get_mut(&(session.into(),workflow.into())).ok_or("Native task binding missing")?;
    if row.blocked||row.expires_at<=now_ms()?{return Err("Native task binding blocked or expired".into());}
    if steam_marked(row){row.steam_ledger_revision=steam_revision_next(row.steam_ledger_revision)?;}
    row.blocked=true;Ok(row.clone())
}
fn task_commit(session:&str,workflow:&str,mut row:TaskBinding,guard:&dyn Fn()->Result<(),String>)->Result<(),String>{
    guard()?;
    if steam_marked(&row){
        if let(Some(root),Some(target))=(&row.steam_root,&row.target){root.revalidate(target)?;}
        // Tombstones lock precedes the task lock; neither is held over guard/HTTP/UIA.
        let dead=tombstones().lock().map_err(|_|"Native task tombstone ledger unavailable")?;
        if !steam_diagnostic_tombstones_clear(&dead,session,workflow,now_ms()?){return Err("Steam checkout revoked before commit".into());}
        let mut rows=task_bindings().lock().map_err(|_|"Native task ledger unavailable")?;
        let current=rows.get(&(session.into(),workflow.into())).ok_or("Steam checkout removed before commit")?;
        if !steam_commit_allowed(current,&row,now_ms()?){return Err("Steam checkout changed before commit".into());}
        row.steam_ledger_revision=steam_revision_next(row.steam_ledger_revision)?;
        row.blocked=false;rows.insert((session.into(),workflow.into()),row);return Ok(());
    }
    row.blocked=false;task_bindings().lock().map_err(|_|"Native task ledger unavailable")?.insert((session.into(),workflow.into()),row);Ok(())
}
fn steam_commit_allowed(current:&TaskBinding,checkout:&TaskBinding,now:u64)->bool{
    steam_original_same(current,checkout)&&current.blocked&&checkout.blocked
        &&current.target.is_some()==current.steam_root.is_some()&&checkout.target.is_some()==checkout.steam_root.is_some()
        &&current.steam_ledger_revision==checkout.steam_ledger_revision
        &&steam_capture_deadline(checkout).is_ok_and(|expiry|now<expiry)
}

fn steam_first_target_shape(old_target:bool,old_root:bool,new_target:bool,new_root:bool)->bool{
    !old_target&&!old_root&&new_target&&new_root
}
fn steam_establish_target(session:&str,workflow:&str,checkpoint:&TaskBinding,row:&mut TaskBinding,guard:&dyn Fn()->Result<(),String>)->Result<(),String>{
    steam_checkout_guard(checkpoint,checkpoint,guard)?;
    if !steam_first_target_shape(checkpoint.target.is_some(),checkpoint.steam_root.is_some(),row.target.is_some(),row.steam_root.is_some()){
        return Err("Steam first target cannot replace original root".into());
    }
    // Capture constructor holds actual process lifetime and exact physical geometry; recheck before publication.
    row.steam_root.as_ref().ok_or("Steam first held root missing")?.revalidate(row.target.as_ref().ok_or("Steam first target missing")?)?;
    steam_checkout_guard(checkpoint,checkpoint,guard)?;
    let dead=tombstones().lock().map_err(|_|"Native task tombstone ledger unavailable")?;
    if !steam_diagnostic_tombstones_clear(&dead,session,workflow,now_ms()?){return Err("Steam first target revoked".into());}
    let mut rows=task_bindings().lock().map_err(|_|"Native task ledger unavailable")?;
    let current=rows.get_mut(&(session.into(),workflow.into())).ok_or("Steam first target checkout removed")?;
    if !steam_diagnostic_same_state(current,checkpoint)||!steam_commit_allowed(current,checkpoint,now_ms()?){return Err("Steam first target checkout changed".into());}
    let next=steam_revision_next(current.steam_ledger_revision)?;
    current.target=row.target.clone();current.steam_root=row.steam_root.clone();current.steam_ledger_revision=next;
    row.steam_ledger_revision=next;Ok(())
}


#[cfg(test)]
mod steam_workflow_guard_tests{
    use super::*;
    fn row()->TaskBinding{
        TaskBinding{source:json!({"sessionId":"session","reservationId":"workflow","workflowId":"workflow","taskId":"task","ownerBindingId":"owner","nonce":"nonce","requestDigest":"digest","expiresAt":90,"request":{"workflow":"game_detail"}}),
            bridge:"bridge".into(),app:"steam".into(),query:None,target:None,pending:None,mapped:HashMap::new(),last_post:None,blocked:true,expires_at:100,
            requested_dispatch:false,pending_requested:false,pending_skip:None,pending_pre:None,game_name:Some("Game".into()),game_entry:None,
            steam_library:None,steam_ledger_revision:1,pending_game:None,last_game:false,
            steam_scope:Some(SteamOriginalScope{session_id:"session".into(),safety_session_ref:"safety".into(),original_epoch:0,native_expires_at_ms:80}),
            steam_root:None,steam_counts:None,steam_effective_expiry:None}
    }
    #[test] fn original_checkout_zero_epoch_is_valid_without_renewal(){
        let original=row();assert!(steam_checkout_identity(Some(&original),&original));assert!(steam_commit_allowed(&original,&original,79));
        assert_eq!(original.steam_scope.as_ref().unwrap().original_epoch,0);assert_eq!(steam_capture_deadline(&original).unwrap(),80);
    }
    #[test] fn private_revision_is_monotonic_and_overflow_denies(){
        assert_eq!(steam_revision_next(0).unwrap(),1);assert_eq!(steam_revision_next(u64::MAX-1).unwrap(),u64::MAX);
        assert!(steam_revision_next(u64::MAX).is_err());
    }
    #[test] fn concurrent_checkout_revision_and_removed_row_deny(){
        let original=row();let mut changed=original.clone();changed.steam_ledger_revision+=1;
        assert!(!steam_checkout_identity(Some(&changed),&original));assert!(!steam_commit_allowed(&changed,&original,1));
        assert!(!steam_checkout_identity(None,&original));
    }
    #[test] fn own_blocked_checkout_is_not_any_stopped_or_released_row(){
        let original=row();let mut changed=original.clone();changed.blocked=false;
        assert!(!steam_checkout_identity(Some(&changed),&original));assert!(!steam_commit_allowed(&changed,&original,1));
        changed=original.clone();changed.steam_ledger_revision=steam_revision_next(changed.steam_ledger_revision).unwrap();
        assert!(!steam_commit_allowed(&changed,&original,1)); // Actual STOP/invalidation increments this exact field even when blocked already.
    }
    #[test] fn source_owner_session_nonce_task_request_reservation_forgery_denies(){
        let original=row();for field in ["sessionId","reservationId","workflowId","taskId","ownerBindingId","nonce","requestDigest"]{
            let mut changed=original.clone();changed.source[field]=json!("forged");assert!(!steam_original_same(&changed,&original));
            assert!(!steam_commit_allowed(&changed,&original,1));
        }
        let mut changed=original.clone();changed.source["request"]["workflow"]=json!("library");assert!(!steam_original_same(&changed,&original));
    }
    #[test] fn original_epoch_reference_and_native_expiry_changes_deny(){
        let original=row();let changes:[fn(&mut SteamOriginalScope);4]=[|s|s.original_epoch=1,|s|s.session_id.push('x'),|s|s.safety_session_ref.push('x'),|s|s.native_expires_at_ms+=1];
        for change in changes{let mut changed=original.clone();change(changed.steam_scope.as_mut().unwrap());assert!(!steam_original_same(&changed,&original));}
    }
    #[test] fn deadline_uses_every_original_minimum_and_boundary(){
        let mut original=row();assert_eq!(steam_capture_deadline(&original).unwrap(),80);assert!(!steam_commit_allowed(&original,&original,80));
        original.steam_effective_expiry=Some(70);assert_eq!(steam_capture_deadline(&original).unwrap(),70);
        original.source["expiresAt"]=json!(60);assert_eq!(steam_capture_deadline(&original).unwrap(),60);
        original.expires_at=50;assert_eq!(steam_capture_deadline(&original).unwrap(),50);
        original.source["expiresAt"]=Value::Null;assert!(steam_capture_deadline(&original).is_err());
    }
    #[test] fn first_target_shape_allows_only_complete_none_to_some(){
        for old_target in [false,true]{for old_root in [false,true]{for new_target in [false,true]{for new_root in [false,true]{
            assert_eq!(steam_first_target_shape(old_target,old_root,new_target,new_root),!old_target&&!old_root&&new_target&&new_root);
        }}}}
        let original=row();let mut concurrent=original.clone();concurrent.steam_ledger_revision+=1;assert!(!steam_commit_allowed(&concurrent,&original,1));
    }
    #[test] fn exact_physical_geometry_movement_resize_and_empty_deny(){
        let rect=[-100,-50,100,80];assert!(steam_geometry_same(rect,rect));
        for changed in [[-99,-50,101,80],[-100,-50,101,80],[-100,-49,100,81],[-100,-50,100,81]]{assert!(!steam_geometry_same(rect,changed));}
        assert!(!steam_geometry_same([0,0,0,1],[0,0,0,1]));assert!(!steam_geometry_same([0,0,1,0],[0,0,1,0]));
    }
    #[test] fn every_profile_pin_component_is_retained(){
        let pin=("fingerprint",1,"provider","evidence",1);assert!(steam_profile_same(pin,pin));
        for changed in [("other",1,"provider","evidence",1),("fingerprint",2,"provider","evidence",1),("fingerprint",1,"other","evidence",1),("fingerprint",1,"provider","other",1),("fingerprint",1,"provider","evidence",2)]{assert!(!steam_profile_same(pin,changed));}
    }
    #[test] fn real_entry_identity_bounds_and_ancestry_are_exact(){
        let entry=native_uia::SteamEntryObservation{target:native_uia::LocatedTarget{target_id:"target".into(),name:"Game".into(),control_type:50007,x:1,y:2,width:3,height:4,process_id:5,hwnd:6},runtime_id:vec![1,2],name:"Game".into(),ancestry:vec![native_uia::SteamPathNode{runtime_id:vec![1],control_type:50033}]};
        assert!(steam_entry_same(&entry,&entry.clone()));
        let changes:[fn(&mut native_uia::SteamEntryObservation);9]=[|e|e.runtime_id.push(3),|e|e.name.push('x'),|e|e.ancestry.clear(),|e|e.target.target_id.push('x'),|e|e.target.x+=1,|e|e.target.width+=1,|e|e.target.process_id+=1,|e|e.target.hwnd+=1,|e|e.target.control_type=50029];
        for change in changes{let mut changed=entry.clone();change(&mut changed);assert!(!steam_entry_same(&entry,&changed));}
    }
    #[test] fn tombstone_blocks_own_checkout_and_overflow_saturation(){
        let mut dead=HashMap::new();dead.insert(("session".into(),"workflow".into()),100);
        assert!(!steam_diagnostic_tombstones_clear(&dead,"session","workflow",99));
        assert!(steam_diagnostic_tombstones_clear(&dead,"session","workflow",100));
        for i in 0..64{dead.insert(("other".into(),format!("{i}")),100);}assert!(!steam_diagnostic_tombstones_clear(&dead,"session","workflow",99));
    }
    #[test] fn changed_or_missing_detail_transition_never_matches(){
        let detail=json!({"view":"game_detail","selectedCount":1,"selectedGameFingerprint":"entry","gameTitleFingerprint":"title","gameDetailContextFingerprint":"context","gameDetailWitnessVersion":2,"gameDetailProviderProfileFingerprint":"profile"});
        assert!(steam_detail_state_same(&detail,&detail));assert!(!steam_detail_state_same(&json!({}),&json!({})));
        for field in ["view","selectedCount","selectedGameFingerprint","gameTitleFingerprint","gameDetailContextFingerprint","gameDetailWitnessVersion","gameDetailProviderProfileFingerprint"]{
            let mut changed=detail.clone();changed[field]=Value::Null;assert!(!steam_detail_state_same(&changed,&detail));
            changed.as_object_mut().unwrap().remove(field);assert!(!steam_detail_state_same(&changed,&detail));
        }
    }
    #[test] fn initial_focus_library_transition_does_not_require_detail_witness(){
        let library=json!({"view":"library","gameEntryFingerprint":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"});
        assert!(steam_snapshot_state_same(&library,&library,false));assert!(!steam_snapshot_state_same(&library,&library,true));
        let missing=json!({"view":"library"});assert!(!steam_snapshot_state_same(&missing,&missing,false));
        let mut changed=library.clone();changed["gameEntryFingerprint"]=json!("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
        assert!(!steam_snapshot_state_same(&changed,&library,false));
    }
    #[test] fn marked_target_missing_workflow_removed_binding_and_forged_prefix_deny(){
        assert!(steam_marked_target_route(None,None,"clickMouse",Some("steam-uia:1:forged")).is_err());
        assert!(steam_marked_target_route(Some("workflow"),None,"clickMouse",Some("steam-uia:1:forged")).is_err());
        let mut original=row();original.blocked=false;
        for target in ["steam-uia:1:forged","steam-uia-forged","steam-uia"]{assert!(steam_marked_target_route(Some("workflow"),Some(&original),"clickMouse",Some(target)).is_err());}
        for action in ["focusApp","typeText","pressKey","hotkey"]{assert!(steam_marked_target_route(Some("workflow"),Some(&original),action,Some("steam-uia:1:forged")).is_err());}
        original.app="spotify".into();assert!(steam_marked_target_route(Some("workflow"),Some(&original),"clickMouse",Some("steam-uia:1:forged")).is_err());
        original.app="steam".into();original.source["request"]["workflow"]=json!("library");assert!(steam_marked_target_route(Some("workflow"),Some(&original),"clickMouse",Some("steam-uia:1:forged")).is_err());
        assert!(steam_marked_target_route(None,None,"clickMouse",Some("ordinary-uia-target")).is_ok());
    }
    #[test] fn actual_final_capture_helper_never_calls_full_guard_after_capture(){
        use std::cell::RefCell;let events=RefCell::new(Vec::new());
        let full=||{events.borrow_mut().push("full");Ok(())};let local=||{events.borrow_mut().push("local");Ok(())};
        assert_eq!(steam_final_capture(&full,&local,||{events.borrow_mut().push("capture");Ok(7)}).unwrap(),7);
        assert_eq!(*events.borrow(),vec!["full","local","capture","local"]);
    }
    #[test] fn final_capture_failure_preserves_first_cause_and_runs_local_cleanup_check(){
        use std::cell::Cell;let calls=Cell::new(0);let full=||Ok(());let local=||{calls.set(calls.get()+1);if calls.get()==2{Err("stopped".into())}else{Ok(())}};
        let result:Result<(),String>=steam_final_capture(&full,&local,||Err("NATIVE_STEAM_PROFILE_CHANGED".into()));
        assert_eq!(result.unwrap_err(),"NATIVE_STEAM_PROFILE_CHANGED");assert_eq!(calls.get(),2);
    }
    #[test] fn denied_full_guard_prevents_final_capture_entirely(){
        use std::cell::Cell;let capture_calls=Cell::new(0);let local_calls=Cell::new(0);
        let result:Result<(),String>=steam_final_capture(&||Err("owner revoked".into()),&||{local_calls.set(local_calls.get()+1);Ok(())},||{capture_calls.set(capture_calls.get()+1);Ok(())});
        assert_eq!(result.unwrap_err(),"owner revoked");assert_eq!(local_calls.get(),0);assert_eq!(capture_calls.get(),0);
    }
    #[test] fn target_identity_drift_and_partial_held_root_shape_deny(){
        let mut original=row();original.target=Some(TaskTarget{window_id:"hwnd:1".into(),pid:2,image:"image".into(),hwnd:1});
        assert!(!steam_commit_allowed(&original,&original,1)); // A target without its held root is never an admissible checkout.
        let changes:[fn(&mut TaskTarget);4]=[|t|t.hwnd+=1,|t|t.pid+=1,|t|t.window_id.push('x'),|t|t.image.push('x')];
        for change in changes{let mut changed=original.clone();change(changed.target.as_mut().unwrap());assert!(!steam_original_same(&changed,&original));}
    }
    #[test] fn actual_raw_counts_survive_revision_overflow_without_authority(){
        let mut original=row();original.blocked=false;original.steam_effective_expiry=Some(80);original.steam_ledger_revision=u64::MAX;
        let counts=SteamInputCounts{requested_primary:2,returned_primary:1,cleanup_requested:1,cleanup_returned:1,release_confirmed:true,completed_at_ms:50};
        assert!(steam_store_dispatch_counts(&mut original,"action",counts.clone()).is_err());assert!(original.blocked);
        assert_eq!(original.steam_counts,Some(("action".into(),counts)));assert_eq!(original.steam_ledger_revision,u64::MAX);
    }
    #[test] fn actual_count_storage_preserves_partial_and_complete_facts(){
        let mut original=row();original.blocked=false;original.steam_effective_expiry=Some(80);
        let counts=SteamInputCounts{requested_primary:2,returned_primary:2,cleanup_requested:0,cleanup_returned:0,release_confirmed:true,completed_at_ms:50};
        assert!(steam_store_dispatch_counts(&mut original,"action",counts.clone()).is_ok());assert!(!original.blocked);assert_eq!(original.steam_counts,Some(("action".into(),counts.clone())));
        let mut replay=counts.clone();replay.returned_primary=0;
        assert!(steam_store_dispatch_counts(&mut original,"replay",replay).is_err());assert!(original.blocked);assert_eq!(original.steam_counts,Some(("action".into(),counts.clone())));
        let mut fresh=row();fresh.blocked=false;fresh.steam_effective_expiry=Some(80);
        let mut partial=counts;partial.returned_primary=0;
        assert!(steam_store_dispatch_counts(&mut fresh,"partial",partial.clone()).is_err());assert!(fresh.blocked);assert_eq!(fresh.steam_counts,Some(("partial".into(),partial)));
    }
    #[test] fn unchanged_nonsteam_is_not_marked(){let mut other=row();other.app="spotify".into();assert!(!steam_marked(&other));other.app="steam".into();other.source["request"]["workflow"]=json!("downloads");assert!(!steam_marked(&other));}
}

fn validate_task_source(source:&Value,session:&str,workflow:&str,owner:&str,app:&str,operation:Option<&str>)->Result<(),String>{
    exact_keys(source,&["bindingId","taskId","workflowId","state","expiresAt","taskBinding","physicalAcceptance","nonce","ownerBindingId","requestDigest","sessionId","reservationId","request"],&["operationId"])?;
    if source["sessionId"]!=json!(session)||source["reservationId"]!=json!(workflow)||source["ownerBindingId"]!=json!(owner)
        ||source["request"]["app"]!=json!(app)||source["taskBinding"]!=json!("registered")||source["physicalAcceptance"]!=json!(false)
        ||!matches!(source["state"].as_str(),Some("QUEUED"|"RUNNING"))
        ||["bindingId","taskId","workflowId","nonce"].iter().any(|k|source[*k].as_str().is_none_or(|s|!task_id(s)))
        ||source["requestDigest"].as_str().is_none_or(|s|!identity(s))
        ||source["expiresAt"].as_u64().is_none_or(|t|t<=now_ms().unwrap_or(u64::MAX))
        ||operation.is_some_and(|op|source["operationId"]!=json!(op)){return Err("Private native task source authority mismatch".into());}Ok(())
}

pub(crate) fn task_register_read(token:&str,port:u16,session:&str,workflow:&str,intent:TaskIntent,deadline:u64,steam_scope:Option<SteamOriginalScope>,guard:&dyn Fn()->Result<(),String>)->Result<Value,String>{
    if !task_id(session)||!task_id(workflow)||intent.validate().is_err()||intent.app!="steam"||intent.workflow!="game_detail"{return Err("STEAM_READ_INVALID_REQUEST".into());}
    task_register_read_inner(token,port,session,workflow,intent,deadline,steam_scope,guard).map_err(steam_read_error)
}
fn task_register_read_inner(token:&str,port:u16,session:&str,workflow:&str,intent:TaskIntent,deadline:u64,steam_scope:Option<SteamOriginalScope>,guard:&dyn Fn()->Result<(),String>)->Result<Value,String>{
    steam_read_policy_ready()?;steam_read_guard(guard)?;task_not_tombstoned(session,workflow).map_err(|_|"STEAM_READ_SCOPE_CHANGED")?;intent.validate()?;
    if intent.app!="steam"||intent.workflow!="game_detail"{return Err("CONFIGURATION_REQUIRED".into());}
    steam_read_policy_ready()?;
    if !native_uia::steam_main_worker_quiescent(){return Err("STEAM_READ_BUSY".into());}
    let steam_detail=intent.app=="steam"&&intent.workflow=="game_detail";
    if steam_detail!=steam_scope.is_some()||steam_scope.as_ref().is_some_and(|s|s.session_id!=session||s.safety_session_ref.is_empty()||s.native_expires_at_ms<=now_ms().unwrap_or(u64::MAX)){
        return Err("STEAM_READ_SCOPE_UNAVAILABLE".into());
    }
    let bridge=bridge_binding(token,port,session)?;if !task_id(workflow){return Err("Native task reservation invalid".into());}
    {let mut rows=registrations().lock().map_err(|_|"STEAM_READ_UNSUPPORTED")?;rows.retain(|_,r|r.expires>now_ms().unwrap_or(u64::MAX));if rows.contains_key(&(session.into(),workflow.into())){return Err("STEAM_READ_REPLAY".into());}if rows.len()>=16{return Err("STEAM_READ_CAPACITY".into());}}
    {
        // Original native lifetime remains read-only even if registration fails.
        let scope=steam_scope.as_ref().ok_or("CONFIGURATION_REQUIRED")?;
        let mut rows=steam_read_only().lock().map_err(|_|"Steam read authority unavailable")?;
        rows.retain(|_,expiry|*expiry>now_ms().unwrap_or(u64::MAX));
        if rows.keys().any(|(id,_)|id==session){return Err("STEAM_READ_REPLAY".into());}
        if rows.len()>=16{return Err("STEAM_READ_CAPACITY".into());}
        rows.insert((session.into(),workflow.into()),scope.native_expires_at_ms);
    }

    let response=task_request(token,port,None,"owner-context",None,guard)?;exact_keys(&response,&["success","context"],&[])?;exact_keys(&response["context"],&["ownerBindingId","ownerExpiresAt"],&[])?;
    let owner=response["context"]["ownerBindingId"].as_str().filter(|s|task_id(s)).ok_or("STEAM_READ_SCOPE_UNAVAILABLE")?.to_owned();
    let owner_expiry=response["context"]["ownerExpiresAt"].as_u64().ok_or("STEAM_READ_SCOPE_UNAVAILABLE")?;
    let now=now_ms()?;let expires=deadline.min(owner_expiry).min(now.saturating_add(30000)).min(steam_scope.as_ref().map_or(u64::MAX,|s|s.native_expires_at_ms));if expires<=now{return Err("STEAM_READ_SCOPE_EXPIRED".into());}
    let target=Some(steam_read_foreground_target(guard).map_err(|_|"STEAM_READ_SCOPE_UNAVAILABLE")?);let mut body=json!({"source":"native_operator","ownerBindingId":owner,"sessionId":session,"reservationId":workflow,"applicationId":intent.app,"expiresAt":expires});
    let steam_root=if steam_detail{target.as_ref().map(HeldSteamRoot::capture).transpose().map_err(|_|"STEAM_READ_SCOPE_UNAVAILABLE")?}else{None};
    if let Some(t)=&target{body["windowId"]=json!(t.window_id);body["processId"]=json!(t.pid);body["imagePathFingerprint"]=json!(t.image);}
    let result=task_request(token,port,None,"session",Some(&body),guard)?;
    if result["registered"]!=json!(true)||result["expiresAt"]!=json!(expires){return Err("Backend native owner session registration did not match".into());}
    guard()?;if let(Some(root),Some(target))=(&steam_root,&target){root.revalidate(target)?;}
    registrations().lock().map_err(|_|"Native registration ledger unavailable")?.insert((session.into(),workflow.into()),TaskRegistration{owner,intent,target,bridge,expires,steam_scope,steam_root});
    Ok(json!({"registered":true,"reservationId":workflow,"expiresAt":expires}))
}
pub(crate) fn task_register(token:&str,port:u16,session:&str,workflow:&str,intent:TaskIntent,deadline:u64,steam_scope:Option<SteamOriginalScope>,guard:&dyn Fn()->Result<(),String>)->Result<Value,String>{
    steam_read_deny_mutation(session,Some(workflow))?;
    guard()?;task_not_tombstoned(session,workflow)?;intent.validate()?;
    let steam_detail=intent.app=="steam"&&intent.workflow=="game_detail";
    if steam_detail!=steam_scope.is_some()||steam_scope.as_ref().is_some_and(|s|s.session_id!=session||s.safety_session_ref.is_empty()||s.native_expires_at_ms<=now_ms().unwrap_or(u64::MAX)){
        return Err("Steam original native safety scope unavailable".into());
    }
    let bridge=bridge_binding(token,port,session)?;if !task_id(workflow){return Err("Native task reservation invalid".into());}
    {let mut rows=registrations().lock().map_err(|_|"Native registration ledger unavailable")?;rows.retain(|_,r|r.expires>now_ms().unwrap_or(u64::MAX));if rows.len()>=16||rows.contains_key(&(session.into(),workflow.into())){return Err("Native task registration replay or capacity exceeded".into());}}
    let response=task_request(token,port,None,"owner-context",None,guard)?;exact_keys(&response,&["success","context"],&[])?;exact_keys(&response["context"],&["ownerBindingId","ownerExpiresAt"],&[])?;
    let owner=response["context"]["ownerBindingId"].as_str().filter(|s|task_id(s)).ok_or("Factual active owner binding unavailable")?.to_owned();
    let owner_expiry=response["context"]["ownerExpiresAt"].as_u64().ok_or("Factual owner expiry unavailable")?;
    let now=now_ms()?;let expires=deadline.min(owner_expiry).min(now.saturating_add(30000)).min(steam_scope.as_ref().map_or(u64::MAX,|s|s.native_expires_at_ms));if expires<=now{return Err("Native owner/reservation already expired".into());}
    let target=foreground_target(&intent.app,guard)?;let mut body=json!({"source":"native_operator","ownerBindingId":owner,"sessionId":session,"reservationId":workflow,"applicationId":intent.app,"expiresAt":expires});
    let steam_root=if steam_detail{target.as_ref().map(HeldSteamRoot::capture).transpose()?}else{None};
    if let Some(t)=&target{body["windowId"]=json!(t.window_id);body["processId"]=json!(t.pid);body["imagePathFingerprint"]=json!(t.image);}
    let result=task_request(token,port,None,"session",Some(&body),guard)?;
    if result["registered"]!=json!(true)||result["expiresAt"]!=json!(expires){return Err("Backend native owner session registration did not match".into());}
    guard()?;if let(Some(root),Some(target))=(&steam_root,&target){root.revalidate(target)?;}
    registrations().lock().map_err(|_|"Native registration ledger unavailable")?.insert((session.into(),workflow.into()),TaskRegistration{owner,intent,target,bridge,expires,steam_scope,steam_root});
    Ok(json!({"registered":true,"reservationId":workflow,"expiresAt":expires}))
}
pub(crate) fn task_bind(token:&str,port:u16,session:&str,workflow:&str,binding:&str,guard:&dyn Fn()->Result<(),String>)->Result<Value,String>{
    if steam_read_marked(session,workflow)?&&!native_uia::steam_main_worker_quiescent(){return Err("STEAM_READ_BUSY".into());}
    guard()?;let registration=registrations().lock().map_err(|_|"Native registration ledger unavailable")?.remove(&(session.into(),workflow.into())).ok_or("Native app registration missing or consumed")?;
    if registration.bridge!=bridge_binding(token,port,session)?||registration.expires<=now_ms()?{return Err("Native app registration changed or expired".into());}
    let response=task_request(token,port,Some(binding),"source",None,guard)?;let source=response["source"].clone();validate_task_source(&source,session,workflow,&registration.owner,&registration.intent.app,None)?;
    let request=&source["request"];exact_keys(request,&["app","workflow"],&["queryFingerprint","volume","gameNameFingerprint"])?;
    if source["bindingId"]!=json!(binding)||source["workflowId"]!=json!(workflow)||source.get("operationId").is_some()
        ||request["workflow"]!=json!(registration.intent.workflow)
        ||request.get("queryFingerprint")!=registration.intent.query.as_ref().map(|q|json!(text_hash(q))).as_ref()
        ||request.get("volume")!=registration.intent.volume.map(|v|json!(v)).as_ref() ||request.get("gameNameFingerprint")!=registration.intent.game_name.as_ref().map(|v|json!(text_hash(ecma_trim(v)))).as_ref() ||registration.intent.game_name.as_ref().is_some_and(|v|source["requestDigest"]!=json!(game_request_digest(v,workflow))){return Err("Native source does not match actual retained bounded app intent".into());}
    let expires=registration.expires.min(source["expiresAt"].as_u64().ok_or("Native task expiry missing")?);
    if let(Some(root),Some(target))=(&registration.steam_root,&registration.target){root.revalidate(target)?;}
    let result=json!({"bindingId":source["bindingId"],"taskId":source["taskId"],"state":source["state"]});guard()?;
    let mut rows=task_bindings().lock().map_err(|_|"Native task ledger unavailable")?;
    rows.retain(|_,row|row.expires_at>now_ms().unwrap_or(u64::MAX));
    if rows.len()>=16||rows.contains_key(&(session.into(),workflow.into())){return Err("Native task binding replay or capacity exceeded".into());}
    rows.insert((session.into(),workflow.into()),TaskBinding{source,bridge:registration.bridge,app:registration.intent.app,query:registration.intent.query,target:registration.target,pending:None,mapped:HashMap::new(),last_post:None,blocked:false,expires_at:expires,requested_dispatch:false,pending_requested:false,pending_skip:None,pending_pre:None,game_name:registration.intent.game_name,game_entry:None,steam_library:None,steam_ledger_revision:0,pending_game:None,last_game:false,steam_scope:registration.steam_scope,steam_root:registration.steam_root,steam_counts:None,steam_effective_expiry:None});Ok(result)
}

fn associate_explorer(token:&str,port:u16,session:&str,workflow:&str,operation:&str,owner:&str,expires:u64,guard:&dyn Fn()->Result<(),String>)->Result<Value,String>{
    guard()?;task_not_tombstoned(session,workflow)?;if !task_id(workflow)||!task_id(owner){return Err("Explorer task association identity invalid".into());}
    let bridge=bridge_binding(token,port,session)?;
    {let mut rows=task_bindings().lock().map_err(|_|"Native task ledger unavailable")?;rows.retain(|_,r|r.expires_at>now_ms().unwrap_or(u64::MAX));if rows.len()>=16||rows.contains_key(&(session.into(),workflow.into())){return Err("Native task reservation is already bound or ledger full".into());}}
    let target=foreground_target("explorer",guard)?;
    let mut body=json!({"source":"native_operator","ownerBindingId":owner,"sessionId":session,"reservationId":workflow,"applicationId":"explorer","expiresAt":expires});
    if let Some(t)=&target{body["windowId"]=json!(t.window_id);body["processId"]=json!(t.pid);body["imagePathFingerprint"]=json!(t.image);}
    let registration=task_request(token,port,None,"session",Some(&body),guard)?;
    if registration["registered"]!=json!(true)||registration["expiresAt"]!=json!(expires){return Err("Explorer task native session was not registered".into());}
    let response=task_request(token,port,None,"associate",Some(&json!({"operationId":operation,"ownerBindingId":owner,"sessionId":session,"reservationId":workflow})),guard)?;
    let source=response["source"].clone();validate_task_source(&source,session,workflow,owner,"explorer",Some(operation))?;
    let expiry=source["expiresAt"].as_u64().ok_or("Native task expiry missing")?.min(expires);
    guard()?;
    task_bindings().lock().map_err(|_|"Native task ledger unavailable")?.insert((session.into(),workflow.into()),TaskBinding{source:source.clone(),bridge,app:"explorer".into(),query:None,target,pending:None,mapped:HashMap::new(),last_post:None,blocked:false,expires_at:expiry,requested_dispatch:false,pending_requested:false,pending_skip:None,pending_pre:None,game_name:None,game_entry:None,steam_library:None,steam_ledger_revision:0,pending_game:None,last_game:false,steam_scope:None,steam_root:None,steam_counts:None,steam_effective_expiry:None});
    Ok(source)
}

pub(crate) fn task_before(token:&str,port:u16,session:&str,workflow:Option<&str>,canonical_action:&str,focus:bool,guard:&dyn Fn()->Result<(),String>)->Result<bool,String>{
    steam_read_deny_mutation(session,workflow)?;
    let Some(workflow)=workflow else{return Ok(false)};
    task_not_tombstoned(session,workflow)?;
    if !task_bindings().lock().map_err(|_|"Native task ledger unavailable")?.contains_key(&(session.into(),workflow.into())){
        if registrations().lock().map_err(|_|"Native registration ledger unavailable")?.contains_key(&(session.into(),workflow.into())){return Err("Task registration has not been bound to actual canonical backend task".into());}return Ok(false)
    }
    guard()?;let mut row=task_take(session,workflow)?;
    if row.bridge!=bridge_binding(token,port,session)?||!task_id(canonical_action){return Err("Native task action bridge or identity invalid".into());}
    if row.mapped.contains_key(canonical_action){return Err("Native task canonical action replay denied".into());}
    if let Some((action,_))=&row.pending{
        if !focus||row.target.is_some(){return Err("Native task has an unresolved issued action".into());}
        row.mapped.insert(canonical_action.into(),action.clone());task_commit(session,workflow,row,guard)?;return Ok(true)
    }
    let steam_checkpoint=if steam_marked(&row){Some(steam_live_checkpoint(&row)?)}else{None};
    let pending_game=row.pending_game.take();row.last_game=false;
    let pre=if row.target.is_none(){let(id,time)=task_observation()?;json!({"source":"native_reservation","observationId":id,"observedAt":time,"applicationId":row.app})}else{task_snapshot(&row,guard)?};
    row.pending_game=pending_game;
    let mut body=task_context(&row);body["pre"]=pre.clone();
    if let Some(skip)=&row.pending_skip{
        if skip.canonical_action!=canonical_action||pre["source"]!=json!("native_uia_state")||pre["trackFingerprint"].as_str().is_none_or(|s|!identity(s)){return Err("Native requested skip lacks actual paired foreground track baseline".into());}
        body["requestedSkip"]=json!({"source":"native_uia_action","canonicalActionId":skip.canonical_action,"kind":"clickMouse","targetId":skip.target_id,"controlType":50000,"nameFingerprint":skip.name_fingerprint});
    }
    if let Some(nav)=&row.pending_game{
        if nav.canonical_action!=canonical_action||pre["source"]!=json!("native_uia_state")||pre["view"]!=json!("library")||pre["gameEntryFingerprint"]!=json!(nav.entry_fingerprint){return Err("Native game navigation lacks paired actual library/search entry baseline".into());}
        body["requestedGameNavigation"]=json!({"source":"native_uia_action","canonicalActionId":nav.canonical_action,"kind":"clickMouse","targetId":nav.target_id,"controlType":nav.control_type,"nameFingerprint":nav.name_fingerprint,"entryFingerprint":nav.entry_fingerprint});
    }
    let response=task_request(token,port,row.source["bindingId"].as_str(),"check",Some(&body),guard)?;
    if let Some(checkpoint)=&steam_checkpoint{if let Some(target)=&row.target{steam_checkpoint_guard(&row,checkpoint,target,guard)?;}else{steam_checkout_guard(&row,checkpoint,guard)?;}}
    let action=response["result"]["actionId"].as_str().filter(|s|task_id(s)).ok_or("Native task issued action missing")?.to_owned();
    let permit=response["result"]["permitNonce"].as_str().filter(|s|task_id(s)).ok_or("Native task issued permit missing")?.to_owned();
    if response["result"]["expiresAt"].as_u64().is_none_or(|t|t<=now_ms().unwrap_or(u64::MAX)){return Err("Native task issued permit expired".into());}
    if row.pending_game.is_some(){
        if row.steam_counts.is_some()||row.steam_effective_expiry.is_some(){return Err("Steam navigation authority cannot be renewed or retried".into());}
        let original=row.steam_scope.as_ref().ok_or("Steam original safety scope missing")?;
        row.steam_effective_expiry=Some(row.expires_at.min(row.source["expiresAt"].as_u64().ok_or("Steam original source expiry missing")?).min(original.native_expires_at_ms).min(response["result"]["expiresAt"].as_u64().ok_or("Steam original permit deadline missing")?));
    }
    row.pending=Some((action.clone(),permit));row.pending_pre=Some(pre);row.mapped.insert(canonical_action.into(),action);task_commit(session,workflow,row,guard)?;Ok(true)
}

pub(crate) fn task_after(token:&str,port:u16,session:&str,workflow:&str,canonical_action:&str,dispatched:bool,partial:bool,defer_focus:bool,guard:&dyn Fn()->Result<(),String>)->Result<(),String>{
    guard()?;let mut row=task_take(session,workflow)?;
    if !dispatched||partial{return Err("Native task actual dispatch failed or injected partial input; permanently blocked".into());}
    let(action,permit)=row.pending.clone().ok_or("Native task issued action missing")?;
    if row.mapped.get(canonical_action)!=Some(&action){return Err("Native task canonical action is not mapped to its actual server-issued action".into());}
    if row.pending_game.is_some(){
        let (count_action,counts)=row.steam_counts.as_ref().ok_or("Steam actual input count record missing")?;
        if count_action!=canonical_action||!steam_counts_complete(counts,row.steam_effective_expiry.ok_or("Steam original input expiry missing")?){return Err("Steam actual input or cleanup incomplete".into());}
    }
    if defer_focus&&row.target.is_none(){task_commit(session,workflow,row,guard)?;return Ok(())}
    if row.target.is_none(){
        let establishing=if steam_marked(&row){Some(steam_live_checkpoint(&row)?)}else{None};
        let target=foreground_target(&row.app,guard)?.ok_or("Actual opened task app is not foreground-established")?;
        if row.steam_scope.is_some(){
            if row.steam_root.is_some(){return Err("Steam original root cannot be replaced".into());}
            row.steam_root=Some(HeldSteamRoot::capture(&target)?);
        }
        let mut body=task_context(&row);body["actionId"]=json!(action);body["permitNonce"]=json!(permit);
        body["windowId"]=json!(target.window_id);body["processId"]=json!(target.pid);body["imagePathFingerprint"]=json!(target.image);
        if let Some(checkpoint)=&establishing{steam_checkout_guard(checkpoint,checkpoint,guard)?;}
        task_request(token,port,row.source["bindingId"].as_str(),"target",Some(&body),guard)?;
        if let Some(checkpoint)=&establishing{steam_checkout_guard(checkpoint,checkpoint,guard)?;}
        row.target=Some(target);
        if let Some(checkpoint)=&establishing{steam_establish_target(session,workflow,checkpoint,&mut row,guard)?;}
    }
    if steam_marked(&row){let checkpoint=steam_live_checkpoint(&row)?;steam_checkpoint_guard(&row,&checkpoint,row.target.as_ref().ok_or("Steam target missing")?,guard)?;}
    // The new collector owns its bounded acquisition interval. A missing actual
    // provider profile is unsupported, never a reason to poll/replay input.
    let mut post=task_snapshot(&row,guard)?;
    if row.pending_requested{
        let started=std::time::Instant::now();
        let matched=|v:&Value|match row.source["request"]["workflow"].as_str(){
            Some("play")=>v["playback"]==json!("playing"),Some("pause")=>v["playback"]==json!("paused"),
            Some("search")=>v["view"]==json!("search")&&v["queryFingerprint"]==json!(text_hash(row.query.as_deref().unwrap_or("")))&&v["itemCount"].as_u64().is_some_and(|n|n>0),
            Some("library"|"downloads")=>v["view"]==row.source["request"]["workflow"]&&v["itemCount"].as_u64().is_some(),
            Some("next"|"previous")=>v["trackFingerprint"].as_str().is_some_and(|s|identity(s))&&row.pending_pre.as_ref().is_some_and(|p|p["trackFingerprint"]!=v["trackFingerprint"]),_=>true};
        while !matched(&post){guard()?;if started.elapsed()>=Duration::from_secs(2){return Err("Native actual requested UIA postcondition was not observed within bounded read-only wait".into());}std::thread::sleep(Duration::from_millis(20));guard()?;post=task_snapshot(&row,guard)?;}
    }
    let mut body=task_context(&row);body["actionId"]=json!(action);body["permitNonce"]=json!(permit);body["dispatch"]=json!("dispatched");body["partialInput"]=json!(false);body["post"]=post.clone();
    if let Some(skip)=&row.pending_skip{
        if skip.canonical_action!=canonical_action{return Err("Actual requested skip canonical dispatch changed".into());}
        body["nativeActionId"]=json!(canonical_action);body["nativeTargetId"]=json!(skip.target_id);
    }
    if let Some(nav)=&row.pending_game{if nav.canonical_action!=canonical_action{return Err("Native game canonical dispatch changed".into());}body["nativeActionId"]=json!(canonical_action);body["nativeTargetId"]=json!(nav.target_id);}
    let step_checkpoint=if steam_marked(&row){Some(steam_live_checkpoint(&row)?)}else{None};
    let step_guard=||{
        guard()?;
        if let Some(checkpoint)=&step_checkpoint{
            steam_checkpoint_guard(&row,checkpoint,row.target.as_ref().ok_or("Steam step target missing")?,guard)?;
            let target=row.target.as_ref().ok_or("Steam step target missing")?;
            let local=||steam_checkpoint_guard_local(&row,checkpoint,target);
            let full=||steam_checkpoint_guard(&row,checkpoint,target,guard);
            let fresh=steam_final_capture(&full,&local,||task_snapshot(&row,&local))?;
            local()?;
            if !steam_snapshot_state_same(&fresh,&post,row.pending_game.is_some()||row.last_game){return Err("NATIVE_POSTSTATE_INVALID".into());}
        }Ok(())
    };
    let response=task_request(token,port,row.source["bindingId"].as_str(),"step",Some(&body),&step_guard)?;
    if response["result"]["recorded"]!=json!(true){return Err("Native task step receipt was not recorded".into());}
    row.last_game=row.pending_game.is_some();row.pending_game=None;row.last_post=Some(post);row.pending=None;row.pending_pre=None;row.pending_skip=None;row.requested_dispatch|=row.pending_requested;row.pending_requested=false;task_commit(session,workflow,row,guard)
}

fn steam_marked_target_route(workflow:Option<&str>,row:Option<&TaskBinding>,action:&str,target:Option<&str>)->Result<(),String>{
    let Some(target)=target.filter(|id|id.starts_with("steam-uia"))else{return Ok(())};
    let row=row.ok_or("Steam marked target requires live original task binding")?;
    if workflow.is_none_or(|id|id.is_empty())||!steam_marked(row)||row.blocked||action!="clickMouse"
        ||row.game_entry.as_ref().is_none_or(|entry|entry.target.target_id!=target)
        ||row.steam_library.as_ref().is_none_or(|seal|seal.entry.target.target_id!=target){
        return Err("Steam marked target cannot escape original game navigation scope".into());
    }
    Ok(())
}
pub(crate) fn task_validate_action(session:&str,workflow:Option<&str>,canonical_action:&str,action:&str,app:Option<&str>,target_id:Option<&str>,text:Option<&str>,key:Option<&str>,keys:Option<&[String]>,button:Option<&str>,attempt:Option<u8>,guard:&dyn Fn()->Result<(),String>)->Result<(),String>{
    steam_read_deny_mutation(session,workflow)?;
    let row=if let Some(workflow)=workflow{task_bindings().lock().map_err(|_|"Native task ledger unavailable")?.get(&(session.into(),workflow.into())).cloned()}else{None};
    steam_marked_target_route(workflow,row.as_ref(),action,target_id)?;
    let Some(workflow)=workflow else{return Ok(())};
    let Some(row)=row else{return Ok(())};if row.blocked{return Err("Native task is permanently blocked".into());}
    if action=="focusApp"{if app!=Some(row.app.as_str()){return Err("Task focus app differs from bound intent".into());}return Ok(())}
    if row.app=="explorer"{return Ok(())} // The retained Explorer operation separately validates every input.
    let target=foreground_target(&row.app,guard)?.ok_or("Task action app is not actual foreground")?;
    if steam_marked(&row){
        let entry=row.game_entry.as_ref().ok_or("NATIVE_STEAM_PROFILE_PIN_REQUIRED")?;
        if action!="clickMouse"||target_id!=Some(entry.target.target_id.as_str())||button.unwrap_or("left")!="left"||attempt.unwrap_or(1)!=1{
            return Err("Native game navigation requires its single retained left click".into());
        }
        let expected=row.target.as_ref().ok_or("Native game target missing")?;
        if target.hwnd!=expected.hwnd||target.window_id!=expected.window_id||target.pid!=expected.pid||target.image!=expected.image{return Err("Native game target identity changed".into());}
        let checkpoint=steam_live_checkpoint(&row)?;
        let library=steam_selective_revalidate(&row,&target,guard)?;
        let entry=&library.entry;
        let nav=RequestedGameNavigation{canonical_action:canonical_action.into(),target_id:entry.target.target_id.clone(),control_type:entry.target.control_type,name_fingerprint:text_hash(ecma_trim(&entry.name)),entry_fingerprint:steam_entry_hash(&row,&target,entry)};
        steam_checkpoint_guard(&row,&checkpoint,&target,guard)?;
        let dead=tombstones().lock().map_err(|_|"Native task tombstone ledger unavailable")?;
        if !steam_diagnostic_tombstones_clear(&dead,session,workflow,now_ms()?){return Err("Steam navigation revoked".into());}
        let mut rows=task_bindings().lock().map_err(|_|"Native task ledger unavailable")?;
        let current=rows.get_mut(&(session.into(),workflow.into())).ok_or("Native task binding disappeared")?;
        if !steam_diagnostic_same_row(current,&checkpoint)||current.blocked||current.pending_game.is_some()||current.last_game||current.mapped.contains_key(canonical_action){return Err("Native game dispatch replay denied".into());}
        current.steam_ledger_revision=steam_revision_next(current.steam_ledger_revision)?;
        current.pending_game=Some(nav);current.pending_requested=true;return Ok(());
    }
    let controls=snapshot(target.hwnd,target.pid,guard)?;
    let workflow_kind=row.source["request"]["workflow"].as_str().ok_or("Native task workflow missing")?;
    let labels:&[&str]=match workflow_kind{"play"=>&["play","oynat"],"pause"=>&["pause","duraklat"],"next"=>&["next","sonraki"],"previous"=>&["previous","önceki"],"search"=>&["search","ara"],"library"|"game_detail"=>&["your library","library","kitaplığın","kitaplık","kütüphane"],"downloads"=>&["downloads","indirmeler"],_=>&[]};
    let named=|c:&ControlState|labels.contains(&c.name.trim().to_lowercase().as_str());
    let mut requested=false;
    let mut skip=None;
    match action{
        "clickMouse"=>{
            let matches:Vec<_>=controls.iter().filter(|c|named(c)&&(c.control_type==50000||workflow_kind=="search"&&c.control_type==50004||matches!(workflow_kind,"library"|"downloads"|"game_detail")&&matches!(c.control_type,50019|50005))).collect();
            if matches.len()!=1||target_id!=Some(matches[0].target_id.as_str()){return Err("Task click is not the unique actual requested app control".into());}
            requested=matches!(workflow_kind,"next"|"previous"|"play"|"pause"|"library"|"downloads");
            if matches!(workflow_kind,"next"|"previous"){
                guard()?;let actual=native_uia::validate_target(target_id.ok_or("Native skip target missing")?,target.hwnd,target.pid)?;guard()?;
                if actual.control_type!=50000||!labels.contains(&actual.name.trim().to_lowercase().as_str()){return Err("Actual native skip button does not match bound direction".into());}
                skip=Some(RequestedSkip{canonical_action:canonical_action.into(),target_id:actual.target_id,name_fingerprint:text_hash(&actual.name.trim().to_lowercase())});
            }
        }
        "typeText"|"hotkey"|"pressKey" if workflow_kind=="search"=>{
            let focused=native_uia::focused_control(target.hwnd,target.pid)?;guard()?;
            if focused.control_type!=50004||!named(&focused){return Err("Task search input lacks actual focused Search Edit".into());}
            match action{
                "typeText" if text==row.query.as_deref()=>{requested=true;},
                "pressKey" if key.is_some_and(|k|k.eq_ignore_ascii_case("enter"))=>{},
                "hotkey" if keys.is_some_and(|k|k.len()==2&&k.iter().any(|v|v.eq_ignore_ascii_case("ctrl")||v.eq_ignore_ascii_case("control"))&&k.iter().any(|v|v.eq_ignore_ascii_case("a")))=>{},
                _=>return Err("Task search input differs from exact bounded query or allowed keys".into()),
            }
        }
        _=>return Err("Task-bound app input is outside requested control allowlist".into()),
    }
    guard()?;if requested{let mut rows=task_bindings().lock().map_err(|_|"Native task ledger unavailable")?;let row=rows.get_mut(&(session.into(),workflow.into())).ok_or("Native task binding disappeared")?;row.pending_requested=true;row.pending_skip=skip;}Ok(())
}
pub(crate) fn task_block(session:&str,workflow:Option<&str>){if let Some(workflow)=workflow{
    steam_read_revoke_workflow(session,workflow);
    // Owner approval lasts at most five minutes. Keep error authority closed
    // longer than its entire remaining lifetime, independently of short job TTLs.
    if let Ok(mut rows)=tombstones().lock(){rows.retain(|_,expiry|*expiry>now_ms().unwrap_or(u64::MAX));if rows.len()<64||rows.contains_key(&(session.into(),workflow.into())){rows.insert((session.into(),workflow.into()),now_ms().unwrap_or(u64::MAX).saturating_add(310000));}}
    if let Ok(mut rows)=task_bindings().lock(){if let Some(row)=rows.get_mut(&(session.into(),workflow.into())){if steam_marked(row){row.steam_ledger_revision=row.steam_ledger_revision.saturating_add(1);}row.blocked=true;}}
}}
pub(crate) fn invalidate_task_authority(){
    if let Ok(mut rows)=steam_read_grants().lock(){for grant in rows.values_mut(){
        grant.progress.failed=true;grant.progress.ended=true;grant.original.steam_root=None;
    }}
    if let Ok(mut rows)=task_bindings().lock(){for row in rows.values_mut(){if steam_marked(row){row.steam_ledger_revision=row.steam_ledger_revision.saturating_add(1);}row.blocked=true;}}
    if let Ok(mut rows)=registrations().lock(){rows.clear();}
    if let Ok(mut rows)=jobs().lock(){rows.clear();}
    if let Ok(mut rows)=find_jobs().lock(){rows.clear();}
}
pub(crate) fn task_open(token:&str,port:u16,session:&str,workflow:Option<&str>,action:&str,app:&str,guard:&dyn Fn()->Result<(),String>)->Result<AppOpenReceipt,String>{
    if let Some(workflow)=workflow{if let Some(row)=task_bindings().lock().map_err(|_|"Native task ledger unavailable")?.get(&(session.into(),workflow.into())){if row.app!=app{return Err("Native task open app differs from bounded intent".into());}}}
    let bound=task_before(token,port,session,workflow,action,false,guard)?;
    if bound{let operation=task_bindings().lock().map_err(|_|"Native task ledger unavailable")?.get(&(session.into(),workflow.ok_or("Native open reservation missing")?.into())).and_then(|r|r.source["operationId"].as_str().map(str::to_owned));
        if let Some(operation)=operation{explorer_exchange(token,port,session,&operation,"check",None,guard)?;}
    }
    let input_guard=||{guard()?;if bound{task_authority_live(token,port,session,workflow.ok_or("Native open reservation missing")?,guard)?;}Ok(())};
    let result=open(app,&input_guard);
    if bound{
        task_after(token,port,session,workflow.ok_or("Native task reservation missing")?,action,result.is_ok(),result.is_err(),true,guard)?;
    }result
}
pub(crate) fn explorer_complete(token:&str,port:u16,session:&str,workflow:&str,operation:&str,find:bool,guard:&dyn Fn()->Result<(),String>)->Result<Value,String>{
    let row=task_bindings().lock().map_err(|_|"Native Explorer task ledger unavailable")?.get(&(session.into(),workflow.into())).cloned().ok_or("Native Explorer task binding missing")?;
    if row.source["operationId"]!=json!(operation){return Err("Native Explorer task operation mismatch".into());}
    let binding=row.source["bindingId"].as_str().ok_or("Native Explorer bindingId missing")?;
    if find{return Ok(json!({"bindingId":binding,"taskId":row.source["taskId"]}))}
    let view=task_finish(token,port,session,workflow,binding,guard)?;Ok(json!({"bindingId":view["bindingId"],"taskId":view["taskId"],"taskState":view["state"]}))
}
pub(crate) fn task_validate_volume(session:&str,workflow:Option<&str>,requested:u8)->Result<(),String>{
    if let Some(workflow)=workflow{if let Some(row)=task_bindings().lock().map_err(|_|"Native task ledger unavailable")?.get(&(session.into(),workflow.into())){
        if row.blocked||row.app!="spotify"||row.source["request"]["workflow"]!=json!("volume")||row.source["request"]["volume"]!=json!(requested){return Err("Native volume differs from current bounded task intent".into());}
    }}Ok(())
}
pub(crate) fn task_finish(token:&str,port:u16,session:&str,workflow:&str,binding:&str,guard:&dyn Fn()->Result<(),String>)->Result<Value,String>{
    steam_read_deny_mutation(session,Some(workflow))?;
    guard()?;let row=task_take(session,workflow)?;
    if row.bridge!=bridge_binding(token,port,session)?||row.source["bindingId"]!=json!(binding)||row.pending.is_some(){return Err("Native task finish binding or issued ledger incomplete".into());}
    let last=row.last_post.as_ref().ok_or("Native task has no actual post-observation")?;
    task_finish_post_freshness(last["observedAt"].as_u64(),now_ms()?)?;
    if matches!(row.source["request"]["workflow"].as_str(),Some("next"|"previous"))&&!row.requested_dispatch{return Err("Native skip task lacks actual validated requested control dispatch".into());}
    let actual=foreground_target(&row.app,guard)?.ok_or("Native task app no longer foreground")?;let expected=row.target.as_ref().ok_or("Native task actual target never established")?;
    if actual.window_id!=expected.window_id||actual.pid!=expected.pid||actual.image!=expected.image{return Err("Native task finish foreground identity changed".into());}
    if steam_marked(&row)&&(!row.last_game||row.steam_library.is_none()){return Err("Native game finish lacks last marked navigation".into());}
    let current=task_snapshot(&row,guard)?;
    // Recheck the genuine current predicate without minting a new task step.
    let fields:&[&str]=match row.source["request"]["workflow"].as_str(){
        Some("game_detail")=>&["view","selectedCount","selectedGameFingerprint","gameTitleFingerprint","gameDetailContextFingerprint","gameDetailWitnessVersion","gameDetailProviderProfileFingerprint"],Some("play"|"pause")=>&["playback"],Some("next"|"previous")=>&["trackFingerprint"],Some("search")=>&["view","queryFingerprint","itemCount"],
        Some("library"|"downloads")=>&["view","itemCount"],Some("volume")=>&["volume"],_ if row.app=="explorer"=>&["folderFingerprint","selectedNameFingerprint","selectedCount"],_=>&[]};
    if fields.iter().any(|field|current.get(*field).is_none()||current[*field]!=last[*field]){return Err("Native task requested state changed since actual recorded post-observation".into());}
    let finish_checkpoint=if steam_marked(&row){Some(steam_live_checkpoint(&row)?)}else{None};
    let finish_guard=||{
        guard()?;
        if let Some(checkpoint)=&finish_checkpoint{steam_checkpoint_guard(&row,checkpoint,expected,guard)?;}
        if row.source["request"]["workflow"]==json!("game_detail"){
            // Re-read after the last safety HTTP check, immediately before send.
            let checkpoint=finish_checkpoint.as_ref().ok_or("Steam finish checkout missing")?;
            let local=||steam_checkpoint_guard_local(&row,checkpoint,expected);
            let full=||steam_checkpoint_guard(&row,checkpoint,expected,guard);
            let fresh=steam_final_capture(&full,&local,||task_snapshot(&row,&local))?;
            local()?;
            if fields.iter().any(|field|fresh.get(*field).is_none()||fresh[*field]!=last[*field]){return Err("Native Steam detail changed immediately before finish".into());}
        }Ok(())
    };
    let response=task_request(token,port,Some(binding),"finish",Some(&task_context(&row)),&finish_guard)?;
    let result=response["result"].clone();if result["bindingId"]!=json!(binding)||result["taskId"]!=row.source["taskId"]||result["state"]!=json!("COMPLETED"){return Err("Native backend did not return actual completed task".into());}Ok(result)
}
pub(crate) fn task_cancel(token:&str,port:u16,session:&str,workflow:&str,binding:&str,guard:&dyn Fn()->Result<(),String>)->Result<Value,String>{
    guard()?;let row=task_bindings().lock().map_err(|_|"Native task ledger unavailable")?.get(&(session.into(),workflow.into())).cloned().ok_or("Native task binding missing")?;
    task_block(session,Some(workflow));if row.bridge!=bridge_binding(token,port,session)?||row.source["bindingId"]!=json!(binding){return Err("Native task cancel binding mismatch".into());}
    let response=task_request(token,port,Some(binding),"cancel",Some(&task_context(&row)),guard)?;
    let task=&response["result"];if task["id"]!=row.source["taskId"]||task["status"]!=json!("CANCELLED"){return Err("Native cancellation did not return actual cancelled task".into());}
    Ok(json!({"bindingId":binding,"taskId":task["id"],"state":task["status"]}))
}
pub(crate) fn task_authority_live(token:&str,port:u16,session:&str,workflow:&str,guard:&dyn Fn()->Result<(),String>)->Result<(),String>{
    let row=task_bindings().lock().map_err(|_|"Native task ledger unavailable")?.get(&(session.into(),workflow.into())).cloned().ok_or("Native task binding missing")?;
    if row.blocked||row.expires_at<=now_ms()?{return Err("Native task permanently blocked or expired".into());}
    let response=task_request(token,port,row.source["bindingId"].as_str(),"source",None,guard)?;
    let fresh=&response["source"];for field in ["bindingId","taskId","nonce","ownerBindingId","sessionId","reservationId","requestDigest"]{if fresh[field]!=row.source[field]{return Err("Native task authority changed before actual GUI input".into());}}
    if !matches!(fresh["state"].as_str(),Some("QUEUED"|"RUNNING")){return Err("Native task no longer permits input".into());}guard()
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExplorerQuarantine {
    pub directory_path: String,
    pub directory_name: String,
    pub parent_directory_identity: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExplorerClaimDescriptor {
    pub operation_id: String,
    pub operation: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reverse_of: Option<String>,
    pub source_name: String,
    pub source_parent_fingerprint:String,
    pub destination_parent_fingerprint:String,
    pub expires_at: u64,
    pub quarantine: bool,
    pub task_id:String,
    pub binding_id:String,
    pub task_state:String,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ExplorerSource {
    operation_id: String, operation_nonce: String, action_id: String, owner_binding_id: String,
    operation: String, reverse_of: Option<String>, root_id: String, root_identity: String,
    source_directory_identity: String, destination_directory_identity: String,
    source_path: String, destination_path: String, source_identity: String,
    content_sha256: String, quarantine: Option<ExplorerQuarantine>, expires_at: u64,
    overwrite_allowed: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ExplorerPoll { operation_id: String, claim_nonce: String, expires_at: u64 }
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ExplorerFileReadback { root_id: String, absolute_path: String, identity: String, device: String, content_sha256: String, size_bytes: u64 }
struct ExplorerJob {
    source: ExplorerSource, claim_nonce: String, bridge_binding: String,
    permit_nonce: Option<String>, quarantine_identity: Option<String>, destination_identity: Option<String>,
    issued_text: Option<(String,String)>,
    quarantine_edit_allowed:bool,
    quarantine_commit_allowed:bool,
}
static EXPLORER_JOBS: OnceLock<Mutex<HashMap<(String, String), ExplorerJob>>> = OnceLock::new();
fn jobs() -> &'static Mutex<HashMap<(String, String), ExplorerJob>> { EXPLORER_JOBS.get_or_init(|| Mutex::new(HashMap::new())) }
fn now_ms() -> Result<u64, String> {
    Ok(SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_| "Native clock unavailable")?.as_millis().try_into().map_err(|_| "Native clock overflow")?)
}
fn opaque(value: &str) -> bool { !value.is_empty() && value.len() <= 256 && value.bytes().all(|v| v.is_ascii_alphanumeric() || v == b'-' || v == b'_') }
fn identity(value: &str) -> bool { value.len() == 64 && value.bytes().all(|v| v.is_ascii_digit() || (b'a'..=b'f').contains(&v)) }
fn approved_path(value: &str) -> bool {
    value.len() <= 4096 && !value.chars().any(|v| v.is_control())
        && (value.starts_with("\\\\") || (value.len() >= 3 && value.as_bytes()[0].is_ascii_alphabetic() && value.as_bytes()[1] == b':' && matches!(value.as_bytes()[2], b'\\' | b'/')))
}
fn bridge_binding(token: &str, port: u16, session: &str) -> Result<String, String> {
    if token.len() < 32 || token.len() > 4096 || token.chars().any(|c| c.is_control()) || port == 0 || !opaque(session) {
        return Err("Private Explorer bridge/session configuration invalid".into());
    }
    let mut hash = Sha256::new(); hash.update(token.as_bytes()); hash.update(port.to_le_bytes());
    Ok(format!("{:x}", hash.finalize()))
}
fn fresh(expires_at: u64) -> Result<(), String> {
    let now = now_ms()?;
    if expires_at <= now || expires_at > now.saturating_add(20000) { return Err("Private Explorer claim expired or invalid".into()); }
    Ok(())
}
fn exact_keys(value: &Value, required: &[&str], optional: &[&str]) -> Result<(), String> {
    let object = value.as_object().ok_or("Private Explorer response is not an object")?;
    if required.iter().any(|key| !object.contains_key(*key)) || object.keys().any(|key| !required.contains(&key.as_str()) && !optional.contains(&key.as_str())) {
        return Err("Private Explorer response schema mismatch".into());
    }
    Ok(())
}
fn request(token: &str, port: u16, operation: Option<&str>, action: &str, claim: Option<&str>, body: Option<&Value>,
    guard: &dyn Fn() -> Result<(), String>) -> Result<Value, String> {
    guard()?;
    if !matches!(action, "next" | "source" | "check" | "readback" | "quarantine" | "finish" | "cancel") { return Err("Private Explorer route denied".into()); }
    let suffix = match operation { Some(id) if opaque(id) => format!("{id}/{action}"), None if action == "next" => "next".into(), _ => return Err("Private Explorer operation invalid".into()) };
    let client = reqwest::blocking::Client::builder().no_proxy().redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(2)).build().map_err(|_| "Private Explorer client unavailable")?;
    let url = format!("http://127.0.0.1:{port}/api/computer-use/native-explorer/{suffix}");
    let mut outgoing = if matches!(action, "next" | "source") { client.get(url) } else { client.post(url) };
    outgoing = outgoing.bearer_auth(token);
    if let Some(nonce) = claim { outgoing = outgoing.header("x-edith-explorer-claim", nonce); }
    if let Some(context) = body { outgoing = outgoing.json(context); }
    let result: Result<Value, String> = (|| {
        let response = outgoing.send().map_err(|_| "Private Explorer transport failed")?;
        if response.status() != reqwest::StatusCode::OK { return Err("Private Explorer authorization or operation rejected".into()); }
        let mut bytes = Vec::new();
        response.take(65537).read_to_end(&mut bytes).map_err(|_| "Private Explorer response unreadable")?;
        if bytes.len() > 65536 { return Err("Private Explorer response exceeds limit".into()); }
        let value: Value = serde_json::from_slice(&bytes).map_err(|_| "Private Explorer response invalid")?;
        if value.get("success") != Some(&Value::Bool(true)) { return Err("Private Explorer request rejected".into()); }
        Ok(value)
    })();
    guard()?;
    result
}

pub fn explorer_claim(token: &str, port: u16, session: &str, workflow:&str, deadline:u64,guard: &dyn Fn() -> Result<(), String>) -> Result<Option<ExplorerClaimDescriptor>, String> {
    guard()?;
    let binding = bridge_binding(token, port, session)?;
    {
        let mut map = jobs().lock().map_err(|_| "Private Explorer native state unavailable")?;
        let now = now_ms()?;
        map.retain(|_, job| job.source.expires_at > now);
        if map.len() >= 8 { return Err("Private Explorer native queue full".into()); }
    }
    let poll = request(token, port, None, "next", None, None, guard)?;
    exact_keys(&poll, &["success", "job"], &[])?;
    if poll["job"].is_null() { return claim_find(token,port,session,workflow,deadline,guard); }
    let claim: ExplorerPoll = serde_json::from_value(poll["job"].clone()).map_err(|_| "Private Explorer claim schema invalid")?;
    if !opaque(&claim.operation_id) || !opaque(&claim.claim_nonce) { return Err("Private Explorer claim context invalid".into()); }
    fresh(claim.expires_at)?;
    let response = request(token, port, Some(&claim.operation_id), "source", Some(&claim.claim_nonce), None, guard)?;
    exact_keys(&response, &["success", "source"], &[])?;
    let source: ExplorerSource = serde_json::from_value(response["source"].clone()).map_err(|_| "Private Explorer source schema invalid")?;
    fresh(source.expires_at)?;
    if source.operation_id != claim.operation_id || source.expires_at != claim.expires_at || source.overwrite_allowed
        || ![&source.operation_nonce, &source.action_id, &source.owner_binding_id].iter().all(|s| opaque(s))
        || ![&source.root_identity, &source.source_identity, &source.content_sha256, &source.source_directory_identity, &source.destination_directory_identity].iter().all(|s| identity(s))
        || !matches!(source.root_id.as_str(), "workspace" | "artifacts") || !approved_path(&source.source_path) || !approved_path(&source.destination_path) || source.source_path == source.destination_path
        || !matches!(source.operation.as_str(), "copy" | "move" | "undo")
        || (source.operation == "undo") != source.reverse_of.is_some()
        || source.reverse_of.as_ref().is_some_and(|r| !matches!(r.as_str(), "copy" | "move")) {
        return Err("Private Explorer source context invalid".into());
    }
    let needs_quarantine = source.operation == "undo" && source.reverse_of.as_deref() == Some("copy");
    if needs_quarantine != source.quarantine.is_some() { return Err("Private Explorer quarantine contract invalid".into()); }
    if let Some(q) = &source.quarantine {
        if !approved_path(&q.directory_path) || !identity(&q.parent_directory_identity) || q.directory_name.is_empty() || q.directory_name.len() > 256
            || q.directory_name.chars().any(|c| c.is_control() || matches!(c, '/' | '\\' | ':'))
            || q.parent_directory_identity != source.destination_directory_identity
            || q.directory_path.rsplit_once(|c| c == '\\' || c == '/').map(|(_, name)| name) != Some(q.directory_name.as_str())
            || source.destination_path.rsplit_once(|c| c == '\\' || c == '/').map(|(parent, _)| parent) != Some(q.directory_path.as_str()) { return Err("Private Explorer quarantine source invalid".into()); }
    }
    let (source_parent,source_name)=source.source_path.rsplit_once(['\\','/']).ok_or("Explorer source path missing parent")?;
    let (destination_parent,destination_name)=source.destination_path.rsplit_once(['\\','/']).ok_or("Explorer destination path missing parent")?;
    if source_name!=destination_name{return Err("Explorer safe same-name transfer contract mismatch".into());}
    let expires=source.expires_at.min(deadline).min(now_ms()?.saturating_add(20000));
    if expires<=now_ms()?{return Err("Explorer native reservation expired".into());}
    let task=associate_explorer(token,port,session,workflow,&source.operation_id,&source.owner_binding_id,expires,guard)?;
    let descriptor = ExplorerClaimDescriptor { operation_id: source.operation_id.clone(), operation: source.operation.clone(), reverse_of: source.reverse_of.clone(),
        source_name:source_name.into(),source_parent_fingerprint:path_hash(source_parent),destination_parent_fingerprint:path_hash(destination_parent),expires_at:expires,quarantine:source.quarantine.is_some(),
        task_id:task["taskId"].as_str().ok_or("Explorer taskId missing")?.into(),binding_id:task["bindingId"].as_str().ok_or("Explorer bindingId missing")?.into(),task_state:task["state"].as_str().ok_or("Explorer taskState missing")?.into() };
    guard()?;
    let mut map = jobs().lock().map_err(|_| "Private Explorer native state unavailable")?;
    if map.len() >= 8 || map.keys().any(|(_, operation)| operation == &source.operation_id) { return Err("Private Explorer native claim replay or capacity conflict".into()); }
    fresh(source.expires_at)?;
    map.insert((session.into(), source.operation_id.clone()), ExplorerJob { source, claim_nonce: claim.claim_nonce, bridge_binding: binding, permit_nonce: None, quarantine_identity: None, destination_identity: None, issued_text: None, quarantine_edit_allowed:false,quarantine_commit_allowed:false });
    Ok(Some(descriptor))
}

pub(crate) fn explorer_destination(session:&str,operation:&str)->Result<String,String>{
    let map=jobs().lock().map_err(|_|"Native Explorer authority unavailable")?;
    if let Some(job)=map.get(&(session.into(),operation.into())){fresh(job.source.expires_at)?;return Ok(job.source.destination_path.clone());}drop(map);
    let rows=find_jobs().lock().map_err(|_|"Native FIND authority unavailable")?;let job=rows.get(&(session.into(),operation.into())).ok_or("Native Explorer/FIND authority missing")?;if job.expires<=now_ms()?{return Err("Native FIND source expired".into());}Ok(job.source.source_path.clone())
}

pub(crate) fn explorer_text(token: &str, port: u16, session: &str, operation: &str, intent: &str,
    guard: &dyn Fn() -> Result<(), String>) -> Result<String, String> {
    guard()?;
    let binding = bridge_binding(token, port, session)?;
    let mut map = jobs().lock().map_err(|_| "Private Explorer native state unavailable")?;
    if !map.contains_key(&(session.into(),operation.into())){
        drop(map);let mut rows=find_jobs().lock().map_err(|_|"Native FIND state unavailable")?;let job=rows.get_mut(&(session.into(),operation.into())).ok_or("Native Explorer/FIND claim missing or consumed")?;
        if job.bridge!=binding||job.expires<=now_ms()?{return Err("Native FIND claim expired or changed bridge".into());}
        let text=match intent{"source_parent"=>job.source.parent_path.clone(),"source_name"=>job.source.source_path.rsplit_once(['\\','/']).ok_or("Native FIND name unavailable")?.1.into(),_=>return Err("Native FIND text intent denied".into())};
        job.issued_text=Some((intent.into(),text.clone()));drop(rows);guard()?;return Ok(text)
    }
    let job = map.get_mut(&(session.into(), operation.into())).ok_or("Private Explorer claim missing or consumed")?;
    fresh(job.source.expires_at)?;
    if job.bridge_binding != binding { return Err("Private Explorer bridge binding changed".into()); }
    let parent = |path: &str| path.rsplit_once(['\\', '/']).map(|(dir, _)| dir.to_owned()).ok_or("Approved Explorer path has no parent");
    let text = match intent {
        "source_parent" => parent(&job.source.source_path)?,
        "destination_parent" => parent(&job.source.destination_path)?,
        "source_name" => job.source.source_path.rsplit_once(['\\', '/']).map(|(_, name)| name.to_owned()).ok_or("Approved Explorer name unavailable")?,
        "quarantine_name" => job.source.quarantine.as_ref().ok_or("No approved quarantine")?.directory_name.clone(),
        "quarantine_parent" => parent(&job.source.quarantine.as_ref().ok_or("No approved quarantine")?.directory_path)?,
        _ => return Err("Explorer text intent denied".into()),
    };
    if text.is_empty() || text.len() > 4096 || text.chars().any(|c| c.is_control()) { return Err("Approved Explorer text invalid".into()); }
    job.issued_text = Some((intent.into(),text.clone()));
    drop(map);
    guard()?;
    Ok(text)
}

pub(crate) fn explorer_validate_input(token: &str, port: u16, session: &str, operation: &str,
    action: &str, text: Option<&str>, key: Option<&str>, keys: Option<&[String]>,
    controls: Option<&[ControlState]>,focused:Option<&ControlState>,target_id:Option<&str>) -> Result<(), String> {
    let binding = bridge_binding(token, port, session)?;
    let mut map = jobs().lock().map_err(|_| "Private Explorer native state unavailable")?;
    if !map.contains_key(&(session.into(),operation.into())){
        drop(map);let mut rows=find_jobs().lock().map_err(|_|"Native FIND state unavailable")?;let job=rows.get_mut(&(session.into(),operation.into())).ok_or("Native FIND claim missing or consumed")?;
        if job.bridge!=binding||job.expires<=now_ms()?{return Err("Native FIND authority expired or changed bridge".into());}
        return match action{
            "focusApp"=>Ok(()),
            "clickMouse"=>{let name=job.source.source_path.rsplit_once(['\\','/']).ok_or("FIND name unavailable")?.1;let matches:Vec<_>=controls.ok_or("FIND click requires actual UIA")?.iter().filter(|c|matches!(c.control_type,50007|50029)&&c.name==name).collect();if matches.len()!=1||target_id!=Some(matches[0].target_id.as_str()){Err("FIND click is not the unique exact actual source item".into())}else{Ok(())}},
            "typeText"=>{let(intent,issued)=job.issued_text.take().ok_or("FIND text was not natively issued")?;let focused=focused.ok_or("FIND text lacks actual keyboard focus")?;if intent!="source_parent"||text!=Some(issued.as_str())||focused.control_type!=50004||!matches!(focused.name.trim().to_lowercase().as_str(),"address"|"adres"|"address bar"|"adres çubuğu"){Err("FIND exact parent text lacks native address focus provenance".into())}else{Ok(())}},
            "pressKey" if key.is_some_and(|v|v.eq_ignore_ascii_case("enter"))=>{let focused=focused.ok_or("FIND Enter lacks actual address focus")?;if focused.control_type==50004&&matches!(focused.name.trim().to_lowercase().as_str(),"address"|"adres"|"address bar"|"adres çubuğu"){Ok(())}else{Err("FIND Enter denied outside native address Edit".into())}},
            "hotkey" if keys.is_some_and(|k|k.len()==2&&k.iter().any(|v|v.eq_ignore_ascii_case("ctrl")||v.eq_ignore_ascii_case("control"))&&k.iter().any(|v|v.eq_ignore_ascii_case("l")||v.eq_ignore_ascii_case("a")))=>{
                if keys.is_some_and(|k|k.iter().any(|v|v.eq_ignore_ascii_case("a"))){let f=focused.ok_or("FIND CtrlA lacks native address focus")?;if f.control_type!=50004||!matches!(f.name.trim().to_lowercase().as_str(),"address"|"adres"|"address bar"|"adres çubuğu"){return Err("FIND CtrlA denied outside actual address Edit".into());}}Ok(())},
            _=>Err("FIND input outside read-only bounded allowlist".into())
        }
    }
    let job = map.get_mut(&(session.into(), operation.into())).ok_or("Private Explorer claim missing or consumed")?;
    fresh(job.source.expires_at)?;
    if job.bridge_binding != binding { return Err("Private Explorer bridge binding changed".into()); }
    match action {
        "focusApp"=>Ok(()),
        "clickMouse"=>{let name=job.source.source_path.rsplit_once(['\\','/']).ok_or("Explorer source name unavailable")?.1;let matches:Vec<_>=controls.ok_or("Explorer click requires native UIA")?.iter().filter(|c|matches!(c.control_type,50007|50029)&&c.name==name).collect();if matches.len()!=1||target_id!=Some(matches[0].target_id.as_str()){Err("Explorer click does not match unique approved actual source item".into())}else{Ok(())}},
        "typeText" => {
            let (intent,issued) = job.issued_text.take().ok_or("Explorer text was not issued by native retained authority")?;
            if text != Some(issued.as_str()) { return Err("Explorer text differs from the exact issued intent".into()); }
            let focus=focused.ok_or("Explorer text requires actual native UIA keyboard focus")?;
            if focus.control_type!=50004{return Err("Explorer text requires an actual eligible Edit control".into());}
            let address=matches!(focus.name.trim().to_lowercase().as_str(),"address"|"adres"|"address bar"|"adres çubuğu");
            match intent.as_str(){
                "source_parent"|"destination_parent"|"quarantine_parent" if address=>{},
                "quarantine_name" if job.quarantine_edit_allowed&&!address&&matches!(focus.name.trim().to_lowercase().as_str(),"name"|"file name"|"filename"|"ad"|"dosya adı")=>{job.quarantine_edit_allowed=false;job.quarantine_commit_allowed=true;},
                _=>return Err("Issued Explorer text intent does not match actual focused control context".into()),
            }
            Ok(())
        }
        "pressKey" if key.is_some_and(|v| v.eq_ignore_ascii_case("enter")) => {
            let focus=focused.ok_or("Explorer Enter requires actual native UIA focus")?;
            if focus.control_type!=50004{return Err("Explorer Enter lacks actual Edit focus".into());}
            if matches!(focus.name.trim().to_lowercase().as_str(),"address"|"adres"|"address bar"|"adres çubuğu"){return Ok(())}
            if !job.quarantine_commit_allowed||!matches!(focus.name.trim().to_lowercase().as_str(),"name"|"file name"|"filename"|"ad"|"dosya adı"){return Err("Explorer Enter is outside approved native edit context".into());}job.quarantine_commit_allowed=false;Ok(())
        },
        "hotkey" => {
            let mut chord: Vec<_> = keys.ok_or("Explorer chord missing")?.iter().map(|v| v.to_ascii_lowercase()).collect();
            for v in &mut chord { if v == "control" { *v = "ctrl".into(); } }
            chord.sort();
            if chord == ["ctrl", "n", "shift"] {
                let q=job.source.quarantine.as_ref().ok_or("Explorer folder creation lacks quarantine authority")?;
                explorer_folder_proof(controls.ok_or("Quarantine creation requires actual parent folder")?,&q.directory_path)?;
                if focused.is_none_or(|f|!matches!(f.control_type,50007|50008|50026|50029|50033)){return Err("Quarantine creation lacks actual Explorer file view focus".into());}
                job.quarantine_edit_allowed=true;return Ok(());
            }
            let ordinary: Vec<_> = chord.iter().filter(|v| v.as_str() != "ctrl").collect();
            if chord.len() != 2 || !chord.iter().any(|v|v == "ctrl") || ordinary.len() != 1 || !matches!(ordinary[0].as_str(), "a" | "c" | "l" | "v" | "x") { return Err("Explorer hotkey outside bounded task allowlist".into()); }
            let letter = ordinary[0].as_str();
            if letter=="a"{let f=focused.ok_or("Explorer CtrlA requires actual address focus")?;if f.control_type!=50004||!matches!(f.name.trim().to_lowercase().as_str(),"address"|"adres"|"address bar"|"adres çubuğu"){return Err("Explorer CtrlA denied outside actual address Edit".into());}}
            if matches!(letter, "c" | "x") {
                let expected = if job.source.operation == "copy" { "c" } else { "x" };
                if letter != expected { return Err("Explorer source chord differs from approved operation".into()); }
                explorer_selection_proof(controls.ok_or("Explorer source selection requires fresh native UIA")?, &job.source.source_path)?;
                let f=focused.ok_or("Explorer source chord requires selected item focus")?;
                let name=job.source.source_path.rsplit_once(['\\','/']).ok_or("Explorer source basename missing")?.1;
                if !matches!(f.control_type,50007|50029)||f.selected!=Some(true)||f.name!=name{return Err("Explorer source chord focus does not match exact selected item".into());}
            }
            if letter == "v" { explorer_folder_proof(controls.ok_or("Explorer paste requires fresh native UIA")?, &job.source.destination_path)?;
                if focused.is_none_or(|f|!matches!(f.control_type,50007|50008|50026|50029|50033)){return Err("Explorer paste lacks committed file view focus".into());}
            }
            Ok(())
        }
        _ => Err("Explorer input outside bounded task allowlist".into()),
    }
}

// Safe to repeat after blocking authority checks: this never consumes issued
// text, creates permits, changes phase or dispatches input.
pub(crate) fn explorer_readonly_input_context(session:&str,operation:&str,keys:Option<&[String]>,controls:&[ControlState],focused:&ControlState)->Result<(),String>{
    let Some(keys)=keys else{return Ok(())};
    let ctrl=keys.iter().any(|k|k.eq_ignore_ascii_case("ctrl")||k.eq_ignore_ascii_case("control"));
    if !ctrl{return Ok(())}
    let letter=keys.iter().find(|k|matches!(k.to_ascii_lowercase().as_str(),"c"|"x"|"v")).map(|k|k.to_ascii_lowercase());
    let create=keys.iter().any(|k|k.eq_ignore_ascii_case("shift"))&&keys.iter().any(|k|k.eq_ignore_ascii_case("n"));
    if letter.is_none()&&!create{return Ok(())}
    let rows=jobs().lock().map_err(|_|"Native Explorer readonly authority unavailable")?;
    let job=rows.get(&(session.into(),operation.into())).ok_or("Native transfer authority missing")?;fresh(job.source.expires_at)?;
    match letter.as_deref(){
        Some("c"|"x")=>{
            explorer_selection_proof(controls,&job.source.source_path)?;
            let name=job.source.source_path.rsplit_once(['\\','/']).ok_or("Native source name missing")?.1;
            if !matches!(focused.control_type,50007|50029)||focused.selected!=Some(true)||focused.name!=name{return Err("Actual source selection changed during authority await".into());}
        }
        Some("v")=>{
            explorer_folder_proof(controls,&job.source.destination_path)?;
            let name=job.source.destination_path.rsplit_once(['\\','/']).ok_or("Native destination name missing")?.1;
            if controls.iter().any(|c|matches!(c.control_type,50007|50029)&&c.name==name){return Err("Approved destination basename appeared before paste; overwrite denied".into());}
            if !matches!(focused.control_type,50007|50008|50026|50029|50033){return Err("Actual committed destination focus changed during authority await".into());}
        }
        _ if create=>{
            let quarantine=job.source.quarantine.as_ref().ok_or("Quarantine creation lacks native authority")?;
            explorer_folder_proof(controls,&quarantine.directory_path)?;
            if controls.iter().any(|c|matches!(c.control_type,50007|50029)&&c.name==quarantine.directory_name){return Err("Approved quarantine basename already exists; creation denied".into());}
        }
        _=>{},
    }Ok(())
}

fn context(job: &ExplorerJob) -> Value {
    let s = &job.source;
    let mut body = json!({"claimNonce":job.claim_nonce,"operationNonce":s.operation_nonce,"ownerBindingId":s.owner_binding_id,
        "actionId":s.action_id,"operation":s.operation,"rootIdentity":s.root_identity,"sourceIdentity":s.source_identity,
        "contentSha256":s.content_sha256,"sourceDirectoryIdentity":s.source_directory_identity,"destinationDirectoryIdentity":s.destination_directory_identity});
    if let Some(identity) = &job.quarantine_identity { body["quarantineDirectoryIdentity"] = json!(identity); }
    body
}

pub fn explorer_exchange(token: &str, port: u16, session: &str, operation_id: &str, action: &str,
    destination_identity: Option<&str>, guard: &dyn Fn() -> Result<(), String>) -> Result<Value, String> {
    guard()?;
    if !opaque(operation_id) || !matches!(action, "check" | "readback" | "quarantine" | "finish" | "cancel")
        || (action != "finish" && destination_identity.is_some()) { return Err("Private Explorer exchange action invalid".into()); }
    let binding = bridge_binding(token, port, session)?;
    let key = (session.to_owned(), operation_id.to_owned());
    if !jobs().lock().map_err(|_|"Native Explorer state unavailable")?.contains_key(&key){return find_exchange(token,port,session,operation_id,action,guard);}
    // Remove before any network action. All errors consume local authority and forbid retries.
    let mut job = jobs().lock().map_err(|_| "Private Explorer native state unavailable")?.remove(&key).ok_or("Private Explorer claim missing or consumed")?;
    if job.bridge_binding != binding { return Err("Private Explorer bridge/session binding changed".into()); }
    fresh(job.source.expires_at)?;
    let mut body = context(&job);
    if matches!(action, "readback" | "quarantine" | "finish") {
        body["permitNonce"] = json!(job.permit_nonce.as_ref().ok_or("Private Explorer permit missing")?);
    }
    if action == "quarantine" && (job.source.quarantine.is_none() || job.quarantine_identity.is_some()) { return Err("Private Explorer quarantine registration denied".into()); }
    if action == "finish" {
        let observed = job.destination_identity.as_ref().ok_or("Private Explorer actual readback identity missing")?;
        if destination_identity.is_some_and(|supplied| supplied != observed) { return Err("Private Explorer caller identity differs from actual readback".into()); }
        body["destinationIdentity"] = json!(observed);
        body["source"] = json!("native_explorer"); body["postcondition"] = json!("gui_action_observed");
    }
    let response = request(token, port, Some(operation_id), action, None, Some(&body), guard)?;
    match action {
        "check" => {
            exact_keys(&response, &["success", "permit"], &[])?;
            let p = &response["permit"];
            exact_keys(p, &["operationId", "actionId", "permitNonce", "expiresAt", "overwriteAllowed"], &[])?;
            let nonce = p["permitNonce"].as_str().ok_or("Private Explorer permit invalid")?;
            if p["operationId"] != json!(operation_id) || p["actionId"] != json!(job.source.action_id) || p["expiresAt"] != json!(job.source.expires_at)
                || p["overwriteAllowed"] != json!(false) || !opaque(nonce) { return Err("Private Explorer permit context mismatch".into()); }
            job.permit_nonce = Some(nonce.into()); job.destination_identity = None;
        }
        "quarantine" => {
            exact_keys(&response, &["success", "quarantine"], &[])?;
            let q = &response["quarantine"];
            exact_keys(q, &["directoryPath", "destinationPath", "identity"], &[])?;
            let approved = job.source.quarantine.as_ref().ok_or("Private Explorer quarantine missing")?;
            let id = q["identity"].as_str().ok_or("Private Explorer quarantine identity invalid")?;
            if q["directoryPath"] != json!(approved.directory_path) || q["destinationPath"] != json!(job.source.destination_path) || !identity(id) { return Err("Private Explorer quarantine context mismatch".into()); }
            job.quarantine_identity = Some(id.into()); job.permit_nonce = None; job.destination_identity = None;
        }
        "readback" => {
            job.destination_identity = None;
            exact_keys(&response, &["success", "readback"], &[])?;
            let rb = &response["readback"]; exact_keys(rb, &["source", "destination"], &[])?;
            for field in ["source", "destination"] {
                if rb[field].is_null() { continue; }
                let file: ExplorerFileReadback = serde_json::from_value(rb[field].clone()).map_err(|_| "Private Explorer file readback schema invalid")?;
                let expected = if field == "source" { &job.source.source_path } else { &job.source.destination_path };
                if file.root_id != job.source.root_id || &file.absolute_path != expected || !identity(&file.identity) || !identity(&file.content_sha256)
                    || file.content_sha256 != job.source.content_sha256 || file.device.is_empty() || file.device.len() > 64 || !file.device.bytes().all(|c| c.is_ascii_digit())
                    || file.size_bytes > 64 * 1024 * 1024 { return Err("Private Explorer file readback provenance mismatch".into()); }
                if field == "source" && file.identity != job.source.source_identity { return Err("Private Explorer source readback identity changed".into()); }
                if field == "destination" { job.destination_identity = Some(file.identity); }
            }
        }
        "finish" | "cancel" => { exact_keys(&response, &["success"], &[])?; }
        _ => unreachable!(),
    }
    guard()?;
    fresh(job.source.expires_at)?;
    if !matches!(action, "finish" | "cancel") {
        let mut map = jobs().lock().map_err(|_| "Private Explorer native state unavailable")?;
        if map.len() >= 8 || map.contains_key(&key) { return Err("Private Explorer native exchange capacity conflict".into()); }
        map.insert(key, job);
    }
    Ok(response)
}
