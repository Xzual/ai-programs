//! Windows UI Automation source proposal. Integration requires the cached `windows`
//! crate and a successful Windows build/runtime check; this module is not a readiness claim.
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::sync::{atomic::{AtomicU64, Ordering}, Mutex};
use std::time::{Duration, Instant};

/// Native-only measured facts; rectangles are physical screen edges, not caller
/// attestation. The caller must hold/recheck its original approved capture scope.
#[derive(Clone, Debug)]
pub(crate) struct PrivacyInventory {
    pub password_rects: Vec<[i32;4]>,
    pub inventory_digest: String,
    pub node_count: usize,
    pub root_runtime_id: Vec<i32>,
}
pub(crate) fn privacy_inventory(root: &crate::native_calculator_identity::NativeWindowIdentity,
    client_rect: [i32;4], public_rect: [i32;4], guard: &dyn Fn()->Result<(),String>) -> Result<PrivacyInventory,String> {
    #[cfg(windows)] { platform::privacy_inventory(root,client_rect,public_rect,guard) }
    #[cfg(not(windows))] { let _=(root,client_rect,public_rect,guard); Err("Privacy native provider unavailable".into()) }
}
fn privacy_contains(outer:[i32;4],inner:[i32;4])->bool {
    outer[0]<outer[2] && outer[1]<outer[3] && inner[0]<inner[2] && inner[1]<inner[3]
        && inner[0]>=outer[0] && inner[1]>=outer[1] && inner[2]<=outer[2] && inner[3]<=outer[3]
}
fn privacy_intersects(a:[i32;4],b:[i32;4])->bool { a[0]<b[2] && b[0]<a[2] && a[1]<b[3] && b[1]<a[3] }
fn privacy_class_supported(class:&str,style:u32,root:bool)->bool {
    if root { return class=="#32770"; }
    match class {
        "Static"=>matches!(style & 0x1f,0|1|2|11|12),
        // Owner-draw, bitmap/icon and custom controls cannot establish coverage.
        "Button"=>style & 0x0f <= 9 && style & (0x40|0x80) == 0,
        "Edit"=>true,
        _=>false,
    }
}
fn privacy_control_supported(class:&str,control:i32)->bool {
    match class { "#32770"=>control==50032,"Static"=>control==50020,
        "Button"=>matches!(control,50000|50002|50003|50013|50026),"Edit"=>control==50004,_=>false }
}

#[cfg(test)]
mod privacy_predicate_tests {
    use super::*;
    #[test] fn negative_coordinates_remain_real_screen_edges() {
        assert!(privacy_contains([-500,-200,100,300],[-450,-150,-50,200]));
        assert!(!privacy_contains([0,0,100,100],[-1,0,50,50]));
    }
    #[test] fn bounds_never_clip_or_accept_zero_reversed() {
        for rect in [[0,0,0,5],[5,0,4,5],[0,0,101,50],[0,-1,50,50]] {
            assert!(!privacy_contains([0,0,100,100],rect));
        }
    }
    #[test] fn opaque_owner_draw_and_image_classes_are_rejected() {
        assert!(privacy_class_supported("#32770",0,true));
        for class in ["Chrome_WidgetWin_1","ApplicationFrameWindow","Custom","Edit"] {
            assert!(!privacy_class_supported(class,0,true));
        }
        for style in [3,13,14] { assert!(!privacy_class_supported("Static",style,false)); }
        for style in [11,0x40,0x80] { assert!(!privacy_class_supported("Button",style,false)); }
        assert!(privacy_class_supported("Edit",0x20,false)); // disabled status does not filter passwords
    }
    #[test] fn class_control_mismatch_and_touching_edge_are_not_masks() {
        assert!(!privacy_control_supported("Edit",50020));
        assert!(privacy_control_supported("Edit",50004));
        assert!(!privacy_intersects([0,0,10,10],[10,0,20,10]));
        assert!(privacy_intersects([0,0,11,10],[10,0,20,10]));
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocatedTarget {
    pub target_id: String,
    pub name: String,
    pub control_type: i32,
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
    pub process_id: u32,
    pub hwnd: isize,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ControlState {
    pub target_id: String,
    pub name: String,
    pub automation_id: String,
    pub control_type: i32,
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
    pub value: Option<String>,
    pub toggle: Option<i32>,
    pub range_value: Option<f64>,
    pub range_min: Option<f64>,
    pub range_max: Option<f64>,
    pub selected: Option<bool>,
}

// Native-only Steam facts. Raw labels stay in private Rust memory; the owner
// computes the frozen ordered tuples rather than accepting caller proof.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct SteamPathNode { pub runtime_id: Vec<i32>, pub control_type: i32 }
#[derive(Clone, Debug)]
pub(crate) struct SteamEntryObservation {
    pub target: LocatedTarget,
    pub runtime_id: Vec<i32>,
    pub name: String,
    pub ancestry: Vec<SteamPathNode>,
}
#[derive(Clone, Debug)]
pub(crate) struct SteamDetailObservation {
    pub entry: SteamEntryObservation,
    pub detail_container_runtime_id: Vec<i32>,
    pub title_runtime_id: Vec<i32>,
    pub title: String,
    pub detail_ancestry: Vec<SteamPathNode>,
    pub labeled_by_subject_runtime_id: Vec<i32>,
}
pub(crate) fn ecma_trim(value: &str) -> &str {
    value.trim_matches(|ch: char| matches!(ch, '\u{0009}'..='\u{000D}' | '\u{0020}' | '\u{00A0}' | '\u{1680}' | '\u{2000}'..='\u{200A}' | '\u{2028}' | '\u{2029}' | '\u{202F}' | '\u{205F}' | '\u{3000}' | '\u{FEFF}'))
}
fn steam_name(value: &str) -> Result<&str, String> {
    let trimmed = ecma_trim(value);
    if value.chars().count() > 160 || value.len() > 640 || trimmed.is_empty()
        || value.chars().any(|ch| matches!(ch, '\u{0000}'..='\u{001F}' | '\u{007F}'..='\u{009F}')) {
        return Err("Steam game name is outside the frozen scalar/byte/control budget".into());
    }
    Ok(trimmed)
}
pub(crate) fn steam_game_entry(hwnd: isize, pid: u32, game_name: &str) -> Result<SteamEntryObservation, String> {
    let expected = steam_name(game_name)?;
    let generation = GENERATION.load(Ordering::SeqCst);
    let identity = crate::native_calculator_identity::observe(hwnd, pid)?;
    let (mut entry, fingerprint) = platform::steam_entry(hwnd, pid, expected)?;
    crate::native_calculator_identity::revalidate(&identity)?;
    entry.target.target_id = format!("uia:{generation}:{fingerprint}");
    let mut targets = TARGETS.lock().map_err(|_| "UIA target state unavailable")?;
    if GENERATION.load(Ordering::SeqCst) != generation { return Err("UIA observation changed".into()); }
    targets.retain(|lease| lease.generation == generation && lease.issued.elapsed() <= TARGET_TTL && lease.target.target_id != entry.target.target_id);
    if targets.len() >= MAX_LEASES { targets.remove(0); }
    targets.push(Lease { target: entry.target.clone(), fingerprint, issued: Instant::now(), generation, identity });
    Ok(entry)
}
pub(crate) fn steam_validate_entry(hwnd: isize, pid: u32, retained: &SteamEntryObservation) -> Result<SteamEntryObservation, String> {
    let validated = validate_target(&retained.target.target_id, hwnd, pid)?;
    let (mut current, _) = platform::steam_entry(hwnd, pid, &retained.name)?;
    if current.runtime_id != retained.runtime_id || current.name != retained.name || current.ancestry != retained.ancestry
        || validated.name != current.target.name || validated.control_type != current.target.control_type
        || (validated.x, validated.y, validated.width, validated.height) != (current.target.x, current.target.y, current.target.width, current.target.height) {
        return Err("Steam retained entry identity or ancestry changed".into());
    }
    current.target.target_id = retained.target.target_id.clone();
    validate_target(&retained.target.target_id, hwnd, pid)?;
    Ok(current)
}
pub(crate) fn steam_game_detail(hwnd: isize, pid: u32, retained: &SteamEntryObservation) -> Result<SteamDetailObservation, String> {
    let entry = steam_validate_entry(hwnd, pid, retained)?;
    let identity = crate::native_calculator_identity::observe(hwnd, pid)?;
    let detail = platform::steam_detail(hwnd, pid, &entry)?;
    crate::native_calculator_identity::revalidate(&identity)?;
    validate_target(&retained.target.target_id, hwnd, pid)?;
    Ok(detail)
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct SteamRelationNode {
    pub runtime_id: Vec<i32>, pub control_type: i32, pub name: String,
    pub ancestry: Vec<SteamPathNode>, pub selected: Option<bool>,
    pub eligible: bool, pub labeled_by: Option<Vec<i32>>,
}
fn steam_tree_valid(nodes: &[SteamRelationNode]) -> bool {
    if nodes.is_empty() || nodes.len() > 512 { return false; }
    let root = nodes[0].ancestry.first();
    let mut seen = std::collections::BTreeSet::new();
    nodes.iter().all(|node| !node.runtime_id.is_empty() && node.runtime_id.len() <= 32
        && seen.insert(node.runtime_id.clone()) && !node.ancestry.is_empty() && node.ancestry.len() <= 32
        && node.ancestry.first() == root
        && node.ancestry.last() == Some(&SteamPathNode { runtime_id: node.runtime_id.clone(), control_type: node.control_type })
        && node.ancestry.iter().all(|part| !part.runtime_id.is_empty() && part.runtime_id.len() <= 32)
        && node.labeled_by.as_ref().is_none_or(|runtime| !runtime.is_empty() && runtime.len() <= 32))
}
pub(crate) fn steam_relationship(nodes: &[SteamRelationNode], entry: &SteamEntryObservation) -> Result<SteamDetailObservation, String> {
    if !steam_tree_valid(nodes) { return Err("Steam current tree metadata is invalid or ambiguous".into()); }
    let selected: Vec<_> = nodes.iter().filter(|node| matches!(node.control_type, 50007 | 50029) && node.selected == Some(true)).collect();
    if selected.len() != 1 || !selected[0].eligible || selected[0].runtime_id != entry.runtime_id || ecma_trim(&selected[0].name) != entry.name || selected[0].ancestry != entry.ancestry {
        return Err("Steam detail requires the unique current selected retained entry".into());
    }
    let mut matches = Vec::new();
    for container in nodes.iter().filter(|node| node.eligible && matches!(node.control_type, 50033 | 50026)) {
        if container.runtime_id == entry.runtime_id || container.ancestry.iter().any(|part| part.runtime_id == entry.runtime_id) { continue; }
        for title in nodes.iter().filter(|node| node.eligible && matches!(node.control_type, 50020 | 50034) && ecma_trim(&node.name) == entry.name) {
            if title.ancestry.len() <= container.ancestry.len() || !title.ancestry.starts_with(&container.ancestry)
                || title.ancestry.iter().any(|part| part.runtime_id == entry.runtime_id) { continue; }
            let subject = if title.labeled_by.as_ref() == Some(&entry.runtime_id) { Some(title) }
                else if container.labeled_by.as_ref() == Some(&entry.runtime_id) { Some(container) } else { None };
            if let Some(subject) = subject {
                matches.push(SteamDetailObservation { entry: entry.clone(), detail_container_runtime_id: container.runtime_id.clone(), title_runtime_id: title.runtime_id.clone(), title: ecma_trim(&title.name).to_owned(), detail_ancestry: title.ancestry.clone(), labeled_by_subject_runtime_id: subject.runtime_id.clone() });
            }
        }
    }
    if matches.is_empty() { return Err("CONFIGURATION_REQUIRED: Steam detail relationship unsupported".into()); }
    if matches.len() != 1 { return Err("Steam detail relationship ambiguous".into()); }
    Ok(matches.pop().unwrap())
}

struct Lease { target: LocatedTarget, fingerprint: String, issued: Instant, generation: u64, identity: crate::native_calculator_identity::NativeWindowIdentity }
static GENERATION: AtomicU64 = AtomicU64::new(0);
static TARGETS: Mutex<Vec<Lease>> = Mutex::new(Vec::new());
const MAX_ELEMENTS: usize = 512;
const MAX_LEASES: usize = 64;
const TARGET_TTL: Duration = Duration::from_secs(15);

/// The owner must call this on observation replacement, session stop, or window change.
pub fn invalidate_targets() {
    GENERATION.fetch_add(1, Ordering::SeqCst);
    if let Ok(mut targets) = TARGETS.lock() { targets.clear(); }
    steam_main_v2::clear_selective_targets();
}

pub fn locate(hwnd: isize, process_id: u32, query: &str) -> Result<LocatedTarget, String> {
    if query.trim().is_empty() || query.chars().count() > 160 {
        return Err("UIA query must contain 1..160 characters".into());
    }
    let generation = GENERATION.load(Ordering::SeqCst);
    let identity = crate::native_calculator_identity::observe(hwnd, process_id)?;
    let (mut target, fingerprint) = platform::find(hwnd, process_id, query)?;
    crate::native_calculator_identity::revalidate(&identity)?;
    target.target_id = format!("uia:{generation}:{fingerprint}");
    let mut targets = TARGETS.lock().map_err(|_| "UIA target state unavailable")?;
    if GENERATION.load(Ordering::SeqCst) != generation { return Err("UIA observation changed".into()); }
    targets.retain(|lease|lease.generation==generation && lease.issued.elapsed()<=TARGET_TTL && lease.target.target_id!=target.target_id);
    if targets.len()>=MAX_LEASES {targets.remove(0);}
    targets.push(Lease { target: target.clone(), fingerprint, issued: Instant::now(), generation, identity });
    Ok(target)
}

/// Re-resolves the element immediately before acting. Returned coordinates are valid
/// only for the current lease; the caller still enforces session and observation TTLs.
pub fn validate_target(target_id: &str, hwnd: isize, process_id: u32) -> Result<LocatedTarget, String> {
    if target_id.starts_with("steam-uia:"){return steam_main_v2::validate_selective_target(target_id,hwnd,process_id);}
    let (target, fingerprint, generation) = leased_target(target_id, hwnd, process_id)?;
    let (_, current) = platform::find_identity(hwnd, process_id, &fingerprint)?;
    ensure_lease(target_id, hwnd, process_id, generation)?;
    if current != fingerprint {
        return Err("UIA target changed; obtain a fresh observation".into());
    }
    Ok(target)
}

fn leased_target(target_id: &str, hwnd: isize, process_id: u32) -> Result<(LocatedTarget, String, u64), String> {
        let targets = TARGETS.lock().map_err(|_| "UIA target state unavailable")?;
        let lease = targets.iter().find(|lease|lease.target.target_id==target_id).ok_or("UIA target is stale")?;
        if lease.target.target_id != target_id || lease.target.hwnd != hwnd
            || lease.target.process_id != process_id || lease.issued.elapsed() > TARGET_TTL
            || lease.generation != GENERATION.load(Ordering::SeqCst) {
            return Err("UIA target is stale, expired, or belongs to another window".into());
        }
        crate::native_calculator_identity::revalidate(&lease.identity)?;
        Ok((lease.target.clone(), lease.fingerprint.clone(), lease.generation))
}

fn ensure_lease(target_id: &str, hwnd: isize, process_id: u32, generation: u64) -> Result<(), String> {
    let (_, _, current) = leased_target(target_id, hwnd, process_id)?;
    if current != generation { return Err("UIA observation changed".into()); }
    Ok(())
}

/// All returned IDs are actionable leases. More than 64 eligible controls fails
/// explicitly rather than returning IDs evicted from the bounded cache.
pub fn snapshot(hwnd: isize, pid: u32) -> Result<Vec<ControlState>, String> {
    let generation = GENERATION.load(Ordering::SeqCst);
    let identity = crate::native_calculator_identity::observe(hwnd, pid)?;
    let entries = platform::snapshot(hwnd, pid)?;
    crate::native_calculator_identity::revalidate(&identity)?;
    if entries.len() > MAX_LEASES { return Err("UIA snapshot exceeds 64 leased-control budget".into()); }
    let issued = Instant::now();
    let mut new_leases = Vec::new();
    let mut states = Vec::new();
    for (mut state, mut target, fingerprint) in entries {
        let id = format!("uia:{generation}:{fingerprint}");
        if states.iter().any(|prior: &ControlState| prior.target_id == id) {
            return Err("UIA runtime identity is ambiguous".into());
        }
        state.target_id = id.clone();
        target.target_id = id;
        new_leases.push(Lease { target, fingerprint, issued, generation, identity: identity.clone() });
        states.push(state);
    }
    let mut targets = TARGETS.lock().map_err(|_| "UIA target state unavailable")?;
    if GENERATION.load(Ordering::SeqCst) != generation { return Err("UIA observation changed".into()); }
    // Replace atomically only after the full bounded snapshot succeeds.
    *targets = new_leases;
    Ok(states)
}

/// Actual keyboard focus from the owned UIA subtree, never a caller-supplied target.
pub(crate) fn focused_control(hwnd:isize,pid:u32)->Result<ControlState,String>{
    let identity = crate::native_calculator_identity::observe(hwnd, pid)?;
    let state = platform::focused_control(hwnd, pid)?;
    crate::native_calculator_identity::revalidate(&identity)?;
    Ok(state)
}

pub fn set_range(hwnd: isize, pid: u32, target_id: &str, value: f64,
    guard: &dyn Fn() -> Result<(), String>) -> Result<ControlState, String> {
    if !value.is_finite() { return Err("UIA range value must be finite".into()); }
    guard()?;
    let (_, fingerprint, generation) = leased_target(target_id, hwnd, pid)?;
    platform::set_range(hwnd, pid, target_id, &fingerprint, generation, value, guard)
}

pub fn read_text(hwnd: isize, process_id: u32) -> Result<String, String> {
    let identity = crate::native_calculator_identity::observe(hwnd, process_id)?;
    let text = platform::read_text(hwnd, process_id)?;
    crate::native_calculator_identity::revalidate(&identity)?;
    Ok(text)
}

#[cfg(not(windows))]
mod platform {
    use super::*;
    pub fn find(_: isize, _: u32, _: &str) -> Result<(LocatedTarget, String), String> { Err("UIA_PROVIDER_UNAVAILABLE".into()) }
    pub fn find_identity(_: isize, _: u32, _: &str) -> Result<(LocatedTarget, String), String> { Err("Windows UIA unavailable on this platform".into()) }
    pub fn snapshot(_: isize, _: u32) -> Result<Vec<(ControlState, LocatedTarget, String)>, String> { Err("Windows UIA unavailable on this platform".into()) }
    pub fn focused_control(_:isize,_:u32)->Result<ControlState,String>{Err("Windows UIA keyboard focus unavailable".into())}
    pub fn set_range(_: isize, _: u32, _: &str, _: &str, _: u64, _: f64, _: &dyn Fn() -> Result<(), String>) -> Result<ControlState, String> { Err("Windows UIA range control unavailable on this platform".into()) }
    pub fn read_text(_: isize, _: u32) -> Result<String, String> { Err("Windows UIA text readback unavailable on this platform".into()) }
    pub fn steam_entry(_: isize, _: u32, _: &str) -> Result<(SteamEntryObservation, String), String> { Err("Windows UIA Steam entry unavailable".into()) }
    pub fn steam_detail(_: isize, _: u32, _: &SteamEntryObservation) -> Result<SteamDetailObservation, String> { Err("Windows UIA Steam detail unavailable".into()) }
}

#[cfg(windows)]
mod platform {
    use super::*;
    use windows::Win32::UI::Accessibility::{IUIAutomationRangeValuePattern, IUIAutomationValuePattern,
        IUIAutomationTogglePattern, IUIAutomationSelectionItemPattern, UIA_RangeValuePatternId,
        UIA_ValuePatternId, UIA_TogglePatternId, UIA_SelectionItemPatternId, UIA_PATTERN_ID, UIA_E_NOTSUPPORTED};
    use windows::Win32::{Foundation::HWND, System::{Com::{CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED, SAFEARRAY}, Ole::{SafeArrayDestroy, SafeArrayGetDim, SafeArrayGetElement, SafeArrayGetElemsize, SafeArrayGetLBound, SafeArrayGetUBound}}, UI::{Accessibility::{CUIAutomation, IUIAutomation, IUIAutomationElement, IUIAutomationTextPattern, UIA_DocumentControlTypeId, UIA_EditControlTypeId, UIA_TextPatternId}, WindowsAndMessaging::{GetWindowRect, GetWindowThreadProcessId, IsChild, IsWindow}}};

    fn api_error(error: windows::core::Error) -> String { format!("UIA API failed ({:#x})", error.code().0) }
    struct Apartment;
    impl Apartment {
        fn new() -> Result<Self, String> {
            // A dedicated blocking worker must call this API; an incompatible STA is rejected.
            unsafe { CoInitializeEx(None, COINIT_MULTITHREADED).ok().map_err(api_error)?; }
            Ok(Self)
        }
    }
    impl Drop for Apartment { fn drop(&mut self) { unsafe { CoUninitialize(); } } }
    struct RuntimeId(*mut SAFEARRAY);
    impl Drop for RuntimeId { fn drop(&mut self) { unsafe { let _ = SafeArrayDestroy(self.0); } } }

    // Passive, independent RawView inventory. It deliberately does not call
    // eligible/describe/snapshot, read names/values, or register input targets.
    pub(super) fn privacy_inventory(root: &crate::native_calculator_identity::NativeWindowIdentity,
        client: [i32; 4], public: [i32; 4], guard: &dyn Fn() -> Result<(), String>) -> Result<PrivacyInventory, String> {
        use windows_sys::Win32::{Foundation::{HWND as SysHwnd, LPARAM, SetLastError, GetLastError},
            UI::WindowsAndMessaging::{EnumChildWindows, GetClassNameW, GetWindowLongPtrW, GWL_STYLE,
                IsWindowVisible, GetWindowRect as NativeRect, GetParent}};
        #[derive(Clone, Debug, PartialEq, Eq)]
        struct NativeFact { hwnd: isize, class: String, style: u32, visible: bool, rect: [i32;4] }
        unsafe extern "system" fn collect(hwnd: SysHwnd, param: LPARAM) -> i32 {
            let rows = unsafe { &mut *(param as *mut Vec<isize>) };
            if rows.len() >= 513 { return 0; }
            rows.push(hwnd as isize); if rows.len() > 512 { 0 } else { 1 }
        }
        let started = Instant::now();
        let check = || -> Result<(), String> {
            guard()?;
            if started.elapsed() > Duration::from_secs(2) { return Err("Privacy inventory deadline exceeded".into()); }
            crate::native_calculator_identity::revalidate(root)
        };
        let native = || -> Result<Vec<NativeFact>, String> {
            check()?;
            let mut handles = Vec::<isize>::new();
            unsafe { let _ = EnumChildWindows(root.root_hwnd as SysHwnd, Some(collect), &mut handles as *mut _ as LPARAM); }
            check()?;
            if handles.len() > 512 { return Err("Privacy native inventory overflow".into()); }
            handles.insert(0, root.root_hwnd);
            let mut seen = std::collections::BTreeSet::new(); let mut result = Vec::new();
            for hwnd in handles {
                check()?; bind(hwnd, root.root_pid)?;
                if !seen.insert(hwnd) { return Err("Privacy native inventory ambiguous".into()); }
                let mut text = [0u16;64];
                let size = unsafe { GetClassNameW(hwnd as SysHwnd, text.as_mut_ptr(), text.len() as i32) };
                if size <= 0 || size as usize >= text.len()-1 { return Err("Privacy class unavailable".into()); }
                let class = String::from_utf16(&text[..size as usize]).map_err(|_| "Privacy class encoding invalid")?;
                unsafe { SetLastError(0); }
                let style = unsafe { GetWindowLongPtrW(hwnd as SysHwnd, GWL_STYLE) } as u32;
                if style == 0 && unsafe { GetLastError() } != 0 { return Err("Privacy style unavailable".into()); }
                let is_root = hwnd == root.root_hwnd;
                if !privacy_class_supported(&class, style, is_root) { return Err("Privacy opaque/unsupported native class".into()); }
                if !is_root {
                    let mut ancestor = hwnd as SysHwnd; let mut reached = false;
                    for _ in 0..32 { ancestor = unsafe { GetParent(ancestor) }; if ancestor.is_null() { break; }
                        if ancestor as isize == root.root_hwnd { reached = true; break; }
                        bind(ancestor as isize, root.root_pid)?;
                    }
                    if !reached { return Err("Privacy native ancestry unsupported".into()); }
                }
                let visible = unsafe { IsWindowVisible(hwnd as SysHwnd) } != 0;
                let mut rect = windows_sys::Win32::Foundation::RECT::default();
                if unsafe { NativeRect(hwnd as SysHwnd, &mut rect) } == 0 { return Err("Privacy native bounds unavailable".into()); }
                let bounds = [rect.left,rect.top,rect.right,rect.bottom];
                if visible && !is_root && !privacy_contains(client,bounds) { return Err("Privacy child outside client".into()); }
                result.push(NativeFact {hwnd,class,style,visible,rect:bounds});
            }
            result.sort_by_key(|fact|fact.hwnd); Ok(result)
        };
        if root.content.is_some() || !privacy_contains(client, public) { return Err("Privacy original client/public scope unsupported".into()); }
        check()?; let _apartment = Apartment::new()?; let before = native()?;
        let automation: IUIAutomation = unsafe { CoCreateInstance(&CUIAutomation,None,CLSCTX_INPROC_SERVER).map_err(api_error)? };
        let element = unsafe { automation.ElementFromHandle(bind(root.root_hwnd,root.root_pid)?).map_err(api_error)? };
        let walker = unsafe { automation.RawViewWalker().map_err(api_error)? };
        let mut queue = vec![(element,0usize)]; let mut index = 0; let mut ids = std::collections::BTreeSet::new();
        let mut native_seen = std::collections::BTreeSet::new(); let mut masks = Vec::new(); let mut hash = Sha256::new();
        hash.update(root.root_hwnd.to_le_bytes()); hash.update(root.root_pid.to_le_bytes());
        hash.update(root.root_created.to_le_bytes()); hash.update(root.root_image.as_bytes());
        let mut root_runtime_id = Vec::new();
        while index < queue.len() {
            check()?; let (element,depth) = queue[index].clone(); index += 1;
            if depth >= 32 || index > 512 { return Err("Privacy RawView budget exceeded".into()); }
            let runtime = steam_runtime(&element)?;
            if !ids.insert(runtime.clone()) { return Err("Privacy RawView runtime ambiguous".into()); }
            let (pid, hwnd, password, offscreen, bounds, control) = unsafe {
                let r = element.CurrentBoundingRectangle().map_err(api_error)?;
                (element.CurrentProcessId().map_err(api_error)?, element.CurrentNativeWindowHandle().map_err(api_error)?.0 as isize,
                 element.CurrentIsPassword().map_err(api_error)?.as_bool(), element.CurrentIsOffscreen().map_err(api_error)?.as_bool(),
                 [r.left,r.top,r.right,r.bottom],element.CurrentControlType().map_err(api_error)?.0)
            }; check()?;
            let fact = before.iter().find(|row|row.hwnd==hwnd).ok_or("Privacy RawView contains an opaque/non-native surface")?;
            if pid != root.root_pid as i32 || !native_seen.insert(hwnd)
                || (index==1 && hwnd!=root.root_hwnd) || (index!=1 && hwnd==root.root_hwnd)
                || !privacy_control_supported(&fact.class,control)
                || password != (fact.class=="Edit" && fact.style & 0x20 != 0)
                || (fact.visible && offscreen) || (!fact.visible && !offscreen)
                || (fact.visible && bounds != fact.rect) {
                return Err("Privacy RawView/native facts disagree".into());
            }
            if index==1 { root_runtime_id=runtime.clone(); }
            if fact.visible && password {
                if !privacy_contains(client,bounds) { return Err("Privacy password bounds unavailable".into()); }
                if privacy_intersects(bounds,public) { masks.push(bounds); }
            }
            hash.update(hwnd.to_le_bytes());hash.update(depth.to_le_bytes());hash.update(control.to_le_bytes());
            hash.update(runtime.len().to_le_bytes());
            hash.update(fact.style.to_le_bytes());hash.update([password as u8,offscreen as u8]);
            for value in runtime { hash.update(value.to_le_bytes()); }
            for value in bounds { hash.update(value.to_le_bytes()); }
            let mut next = optional_element(unsafe { walker.GetFirstChildElement(&element) })?; check()?;
            while let Some(child)=next {
                if queue.len()>=512 { return Err("Privacy RawView inventory overflow".into()); }
                check()?; next=optional_element(unsafe { walker.GetNextSiblingElement(&child) })?; check()?;
                queue.push((child,depth+1));
            }
        }
        // Visible native descendants absent from RawView are unknown coverage,
        // including disabled password HWNDs: never silently omit them.
        if before.iter().any(|fact|fact.visible && !native_seen.contains(&fact.hwnd)) || native()? != before {
            return Err("Privacy native inventory incomplete or changed".into());
        }
        for value in client.into_iter().chain(public) { hash.update(value.to_le_bytes()); }
        masks.sort(); masks.dedup(); check()?;
        Ok(PrivacyInventory {password_rects:masks,inventory_digest:format!("{:x}",hash.finalize()),node_count:index,root_runtime_id})
    }

    fn bind(hwnd: isize, process_id: u32) -> Result<HWND, String> {
        if hwnd == 0 || process_id == 0 { return Err("UIA requires an owned window and process".into()); }
        let handle = HWND(hwnd as *mut core::ffi::c_void);
        let mut actual = 0;
        unsafe {
            if !IsWindow(Some(handle)).as_bool() { return Err("UIA window no longer exists".into()); }
            GetWindowThreadProcessId(handle, Some(&mut actual));
        }
        if actual != process_id { return Err("UIA window process changed".into()); }
        Ok(handle)
    }

    fn elements(hwnd: isize, process_id: u32) -> Result<Vec<IUIAutomationElement>, String> {
        elements_for_query(hwnd, process_id, false)
    }

    fn elements_for_query(hwnd: isize, process_id: u32, locate: bool) -> Result<Vec<IUIAutomationElement>, String> {
        let handle = bind(hwnd, process_id)?;
        let identity = crate::native_calculator_identity::observe(hwnd, process_id)?;
        let automation: IUIAutomation = unsafe { CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER).map_err(|error: windows::core::Error| {
            // Only known provider-creation absence is eligible. Permission,
            // timeout, identity and unknown COM failures retain their error.
            if locate && matches!(error.code().0 as u32, 0x80040154 | 0x80004002 | 0x800706ba) {
                "UIA_PROVIDER_UNAVAILABLE".into()
            } else { api_error(error) }
        })? };
        let root = unsafe { automation.ElementFromHandle(handle).map_err(api_error)? };
        if unsafe { root.CurrentProcessId().map_err(api_error)? } != process_id as i32
            || unsafe { root.CurrentNativeWindowHandle().map_err(api_error)? } != handle {
            return Err("UIA root provenance mismatch".into());
        }
        let walker = unsafe { automation.ControlViewWalker().map_err(api_error)? };
        let mut all = vec![root];
        let mut index = 0;
        let start = Instant::now();
        while index < all.len() {
            if start.elapsed() > Duration::from_secs(2) { return Err("UIA traversal time budget exceeded".into()); }
            let parent = all[index].clone();
            index += 1;
            let mut next = optional_element(unsafe { walker.GetFirstChildElement(&parent) })?;
            while let Some(child) = next {
                if all.len() >= MAX_ELEMENTS { return Err("UIA element budget exceeded".into()); }
                if start.elapsed() > Duration::from_secs(2) { return Err("UIA traversal time budget exceeded".into()); }
                next = optional_element(unsafe { walker.GetNextSiblingElement(&child) })?;
                // Only the native-verified, fixed Calculator content subtree may
                // cross the root PID. Other applications retain the same-PID rule.
                if unsafe { child.CurrentProcessId().map_err(api_error)? } == process_id as i32 {
                    all.push(child);
                } else if owned_element(&child, hwnd, process_id, &identity)? {
                    all.push(child);
                } else { return Err("UIA subtree crosses process boundary".into()); }
            }
        }
        bind(hwnd, process_id)?;
        crate::native_calculator_identity::revalidate(&identity)?;
        Ok(all)
    }

    fn owned_element(element: &IUIAutomationElement, hwnd: isize, pid: u32,
        identity: &crate::native_calculator_identity::NativeWindowIdentity) -> Result<bool, String> {
        let actual_pid = unsafe { element.CurrentProcessId().map_err(api_error)? };
        if actual_pid == pid as i32 { return Ok(true); }
        let Some(content) = identity.content.as_ref() else { return Ok(false); };
        if actual_pid != content.pid as i32 { return Ok(false); }
        let automation: IUIAutomation = unsafe { CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER).map_err(api_error)? };
        let walker = unsafe { automation.ControlViewWalker().map_err(api_error)? };
        let mut ancestor = element.clone(); let mut ancestors = Vec::new();
        for _ in 0..32 {
            let native = unsafe { ancestor.CurrentNativeWindowHandle().map_err(api_error)? };
            let ancestor_pid = unsafe { ancestor.CurrentProcessId().map_err(api_error)? };
            if ancestor_pid <= 0 { return Ok(false); }
            ancestors.push((native.0 as isize, ancestor_pid as u32));
            if native.0 as isize == hwnd {
                return Ok(crate::native_calculator_identity::delegated_element_allowed(identity, actual_pid as u32, &ancestors));
            }
            let Some(parent) = optional_element(unsafe { walker.GetParentElement(&ancestor) })? else { break; };
            ancestor = parent;
        }
        Ok(false)
    }

    fn optional_element(result: windows::core::Result<IUIAutomationElement>) -> Result<Option<IUIAutomationElement>, String> {
        match result {
            Ok(element) => Ok(Some(element)),
            // The cached windows-core binding maps a successful null COM pointer to
            // Error::empty(). Other provider failures must not truncate traversal silently.
            Err(error) if error.code() == windows::core::Error::empty().code() => Ok(None),
            Err(error) => Err(api_error(error)),
        }
    }

    fn steam_runtime(element: &IUIAutomationElement) -> Result<Vec<i32>, String> {
        unsafe {
            let runtime = RuntimeId(element.GetRuntimeId().map_err(api_error)?);
            if runtime.0.is_null() || SafeArrayGetDim(runtime.0) != 1 || SafeArrayGetElemsize(runtime.0) != 4 { return Err("Steam UIA runtime identity unavailable".into()); }
            let low = SafeArrayGetLBound(runtime.0, 1).map_err(api_error)?;
            let high = SafeArrayGetUBound(runtime.0, 1).map_err(api_error)?;
            if high < low || i64::from(high) - i64::from(low) >= 32 { return Err("Steam runtime identity exceeds 32-component budget".into()); }
            let mut values = Vec::new();
            for index in low..=high {
                let mut value: i32 = 0;
                SafeArrayGetElement(runtime.0, &index, &mut value as *mut i32 as *mut core::ffi::c_void).map_err(api_error)?;
                values.push(value);
            }
            Ok(values)
        }
    }
    fn steam_path(automation: &IUIAutomation, element: &IUIAutomationElement,
        root: &IUIAutomationElement, pid: u32) -> Result<Vec<SteamPathNode>, String> {
        let walker = unsafe { automation.ControlViewWalker().map_err(api_error)? };
        let mut ancestor = element.clone(); let mut path = Vec::new();
        for _ in 0..32 {
            if unsafe { ancestor.CurrentProcessId().map_err(api_error)? } != pid as i32 { return Err("Steam actual ancestor crosses process boundary".into()); }
            path.push(SteamPathNode { runtime_id: steam_runtime(&ancestor)?, control_type: unsafe { ancestor.CurrentControlType().map_err(api_error)? }.0 });
            if unsafe { automation.CompareElements(&ancestor, root).map_err(api_error)?.as_bool() } { path.reverse(); return Ok(path); }
            let Some(parent) = optional_element(unsafe { walker.GetParentElement(&ancestor) })? else { break; };
            ancestor = parent;
        }
        Err("Steam actual ancestor does not reach owned root within 32 nodes".into())
    }
    fn steam_nodes(hwnd: isize, pid: u32) -> Result<(Vec<SteamRelationNode>, Vec<IUIAutomationElement>), String> {
        let start = Instant::now();
        let handle = bind(hwnd, pid)?;
        let all = elements(hwnd, pid)?;
        let root = all.first().ok_or("Steam UIA root unavailable")?;
        if unsafe { root.CurrentNativeWindowHandle().map_err(api_error)? } != handle { return Err("Steam root HWND changed".into()); }
        let automation: IUIAutomation = unsafe { CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER).map_err(api_error)? };
        let mut nodes = Vec::new();
        for element in &all {
            if start.elapsed() > Duration::from_secs(2) { return Err("Steam observation time budget exceeded".into()); }
            if unsafe { element.CurrentProcessId().map_err(api_error)? } != pid as i32 { return Err("Steam subtree crosses process boundary".into()); }
            let runtime_id = steam_runtime(element)?;
            let control_type = unsafe { element.CurrentControlType().map_err(api_error)? }.0;
            let name = bounded_string(unsafe { element.CurrentName().map_err(api_error)? }.to_string())?;
            let selected = if matches!(control_type, 50007 | 50029) {
                optional_pattern::<IUIAutomationSelectionItemPattern>(element, UIA_SelectionItemPatternId)?
                    .map(|pattern| unsafe { pattern.CurrentIsSelected().map(|value| value.as_bool()).map_err(api_error) }).transpose()?
            } else { None };
            let labeled_by = if matches!(control_type, 50033 | 50026 | 50020 | 50034) {
                // Genuine current property, not text, AutomationId or proximity.
                let reference = match unsafe { element.CurrentLabeledBy() } {
                    Err(error) if error.code().0 as u32 == UIA_E_NOTSUPPORTED => None,
                    result => optional_element(result)?,
                };
                if let Some(reference) = reference {
                    let mut observed = None;
                    for candidate in &all {
                        if start.elapsed() > Duration::from_secs(2) { return Err("Steam relationship time budget exceeded".into()); }
                        if unsafe { automation.CompareElements(&reference, candidate).map_err(api_error)?.as_bool() } {
                            if observed.is_some() { return Err("Steam LabeledBy reference identity ambiguous".into()); }
                            observed = Some(steam_runtime(candidate)?);
                        }
                    }
                    if observed.is_none() { return Err("Steam LabeledBy reference lies outside current owned tree".into()); }
                    observed
                } else { None }
            } else { None };
            nodes.push(SteamRelationNode { runtime_id, control_type, name, ancestry: steam_path(&automation, element, root, pid)?, selected, eligible: eligible(element, hwnd, pid)?, labeled_by });
        }
        if !steam_tree_valid(&nodes) { return Err("Steam current tree identities invalid or ambiguous".into()); }
        bind(hwnd, pid)?;
        Ok((nodes, all))
    }
    pub fn steam_entry(hwnd: isize, pid: u32, expected: &str) -> Result<(SteamEntryObservation, String), String> {
        let _apartment = Apartment::new()?;
        let (nodes, all) = steam_nodes(hwnd, pid)?;
        let matching: Vec<_> = nodes.iter().enumerate().filter(|(_, node)| node.eligible && matches!(node.control_type, 50007 | 50029) && ecma_trim(&node.name) == expected).collect();
        if matching.len() != 1 { return Err("Steam game entry absent or ambiguous".into()); }
        let (index, node) = matching[0];
        steam_name(&node.name)?;
        let (target, fingerprint) = describe(&all[index], hwnd, pid)?;
        if steam_runtime(&all[index])? != node.runtime_id || ecma_trim(&target.name) != expected { return Err("Steam game entry changed during capture".into()); }
        let (after, _) = steam_nodes(hwnd, pid)?;
        if after != nodes { return Err("Steam current tree changed during entry capture".into()); }
        Ok((SteamEntryObservation { target, runtime_id: node.runtime_id.clone(), name: expected.to_owned(), ancestry: node.ancestry.clone() }, fingerprint))
    }
    pub fn steam_detail(hwnd: isize, pid: u32, entry: &SteamEntryObservation) -> Result<SteamDetailObservation, String> {
        let _apartment = Apartment::new()?;
        let (nodes, _) = steam_nodes(hwnd, pid)?;
        let detail = steam_relationship(&nodes, entry)?;
        let (after, _) = steam_nodes(hwnd, pid)?;
        if after != nodes { return Err("Steam current tree changed during detail capture".into()); }
        bind(hwnd, pid)?;
        Ok(detail)
    }

    fn eligible(element: &IUIAutomationElement, hwnd: isize, process_id: u32) -> Result<bool, String> {
        let handle = bind(hwnd, process_id)?;
        let identity = crate::native_calculator_identity::observe(hwnd, process_id)?;
        unsafe {
            if !owned_element(element, hwnd, process_id, &identity)?
                || element.CurrentIsPassword().map_err(api_error)?.as_bool()
                || !element.CurrentIsEnabled().map_err(api_error)?.as_bool()
                || element.CurrentIsOffscreen().map_err(api_error)?.as_bool() { return Ok(false); }
            let native = element.CurrentNativeWindowHandle().map_err(api_error)?;
            if !native.0.is_null() && native != handle && !IsChild(handle, native).as_bool() { return Ok(false); }
            let rect = element.CurrentBoundingRectangle().map_err(api_error)?;
            let mut window = windows::Win32::Foundation::RECT::default();
            GetWindowRect(handle, &mut window).map_err(api_error)?;
            Ok(rect.right > rect.left && rect.bottom > rect.top && rect.left >= window.left
                && rect.top >= window.top && rect.right <= window.right && rect.bottom <= window.bottom)
        }
    }

    fn optional_pattern<T: windows::core::Interface>(element: &IUIAutomationElement, id: UIA_PATTERN_ID) -> Result<Option<T>, String> {
        match unsafe { element.GetCurrentPatternAs::<T>(id) } {
            Ok(pattern) => Ok(Some(pattern)),
            Err(error) if error.code().0 as u32 == UIA_E_NOTSUPPORTED || error.code() == windows::core::Error::empty().code() => Ok(None),
            Err(error) => Err(api_error(error)),
        }
    }

    fn bounded_string(value: String) -> Result<String, String> {
        if value.len() > 4096 { Err("UIA control string exceeds 4096-byte budget".into()) } else { Ok(value) }
    }

    fn control_state(element: &IUIAutomationElement, target: &LocatedTarget) -> Result<ControlState, String> {
        unsafe {
            // Password/eligibility is checked again immediately before accessing values.
            if !eligible(element, target.hwnd, target.process_id)? { return Err("UIA control is no longer eligible".into()); }
            let automation_id = bounded_string(element.CurrentAutomationId().map_err(api_error)?.to_string())?;
            let value = optional_pattern::<IUIAutomationValuePattern>(element, UIA_ValuePatternId)?
                .map(|pattern| bounded_string(pattern.CurrentValue().map_err(api_error)?.to_string())).transpose()?;
            let toggle = optional_pattern::<IUIAutomationTogglePattern>(element, UIA_TogglePatternId)?
                .map(|pattern| pattern.CurrentToggleState().map(|state| state.0).map_err(api_error)).transpose()?;
            if toggle.is_some_and(|state| !(0..=2).contains(&state)) { return Err("UIA toggle state is invalid".into()); }
            let selected = optional_pattern::<IUIAutomationSelectionItemPattern>(element, UIA_SelectionItemPatternId)?
                .map(|pattern| pattern.CurrentIsSelected().map(|state| state.as_bool()).map_err(api_error)).transpose()?;
            let (range_value, range_min, range_max) = if let Some(pattern) = optional_pattern::<IUIAutomationRangeValuePattern>(element, UIA_RangeValuePatternId)? {
                let current = pattern.CurrentValue().map_err(api_error)?;
                let min = pattern.CurrentMinimum().map_err(api_error)?;
                let max = pattern.CurrentMaximum().map_err(api_error)?;
                if ![current, min, max].iter().all(|value| value.is_finite()) || min > max || current < min || current > max {
                    return Err("UIA range metadata is invalid".into());
                }
                (Some(current), Some(min), Some(max))
            } else { (None, None, None) };
            Ok(ControlState { target_id: target.target_id.clone(), name: target.name.clone(), automation_id,
                control_type: target.control_type, x: target.x, y: target.y, width: target.width, height: target.height,
                value, toggle, range_value, range_min, range_max, selected })
        }
    }

    pub fn focused_control(hwnd:isize,pid:u32)->Result<ControlState,String>{
        let _apartment=Apartment::new()?;let handle=bind(hwnd,pid)?;
        let automation:IUIAutomation=unsafe{CoCreateInstance(&CUIAutomation,None,CLSCTX_INPROC_SERVER).map_err(api_error)?};
        let focused=unsafe{automation.GetFocusedElement().map_err(api_error)?};
        if !unsafe{focused.CurrentHasKeyboardFocus().map_err(api_error)?.as_bool()}||!eligible(&focused,hwnd,pid)?{return Err("Actual UIA focus is not eligible for owned window".into());}
        let root=unsafe{automation.ElementFromHandle(handle).map_err(api_error)?};
        let walker=unsafe{automation.ControlViewWalker().map_err(api_error)?};let mut ancestor=focused.clone();let mut owned=false;
        for _ in 0..32{
            if unsafe{automation.CompareElements(&ancestor,&root).map_err(api_error)?.as_bool()}{owned=true;break;}
            let Some(parent)=optional_element(unsafe{walker.GetParentElement(&ancestor)})?else{break};ancestor=parent;
        }
        if !owned{return Err("Actual UIA focused control is outside the owned root subtree".into());}
        let(mut target,fingerprint)=describe(&focused,hwnd,pid)?;
        target.target_id=format!("uia:{}:{fingerprint}",GENERATION.load(Ordering::SeqCst));
        let state=control_state(&focused,&target)?;
        bind(hwnd,pid)?;Ok(state)
    }

    // Unlike locate's human-name query, identity resolution supports unnamed or
    // duplicate-name controls and rejects duplicate runtime fingerprints.
    fn identity_element(hwnd: isize, process_id: u32, fingerprint: &str) -> Result<(IUIAutomationElement, LocatedTarget, String), String> {
        let start = Instant::now();
        let mut found = None;
        for element in elements(hwnd, process_id)? {
            if start.elapsed() > Duration::from_secs(2) { return Err("UIA identity resolution time budget exceeded".into()); }
            if !eligible(&element, hwnd, process_id)? { continue; }
            let (target, current) = describe(&element, hwnd, process_id)?;
            if current == fingerprint {
                if found.is_some() { return Err("UIA runtime identity is ambiguous".into()); }
                found = Some((element, target, current));
            }
        }
        bind(hwnd, process_id)?;
        found.ok_or_else(|| "UIA runtime identity is stale or unavailable".into())
    }

    pub fn find_identity(hwnd: isize, process_id: u32, fingerprint: &str) -> Result<(LocatedTarget, String), String> {
        let _apartment = Apartment::new()?;
        let (_, target, current) = identity_element(hwnd, process_id, fingerprint)?;
        Ok((target, current))
    }

    pub fn snapshot(hwnd: isize, process_id: u32) -> Result<Vec<(ControlState, LocatedTarget, String)>, String> {
        let _apartment = Apartment::new()?;
        let start = Instant::now();
        let mut states = Vec::new();
        for element in elements(hwnd, process_id)? {
            if start.elapsed() > Duration::from_secs(2) { return Err("UIA snapshot time budget exceeded".into()); }
            if !eligible(&element, hwnd, process_id)? { continue; }
            if states.len() >= MAX_LEASES { return Err("UIA snapshot exceeds 64 leased-control budget".into()); }
            let (target, fingerprint) = describe(&element, hwnd, process_id)?;
            let state = control_state(&element, &target)?;
            // Reject properties captured while the target identity changed.
            let (_, after) = describe(&element, hwnd, process_id)?;
            if after != fingerprint { return Err("UIA control changed during snapshot".into()); }
            states.push((state, target, fingerprint));
        }
        bind(hwnd, process_id)?;
        Ok(states)
    }

    pub fn set_range(hwnd: isize, process_id: u32, target_id: &str, fingerprint: &str,
        generation: u64, value: f64, guard: &dyn Fn() -> Result<(), String>) -> Result<ControlState, String> {
        let _apartment = Apartment::new()?;
        let (element, _, _) = identity_element(hwnd, process_id, fingerprint)?;
        ensure_lease(target_id, hwnd, process_id, generation)?;
        let pattern = optional_pattern::<IUIAutomationRangeValuePattern>(&element, UIA_RangeValuePatternId)?
            .ok_or("UIA control has no RangeValuePattern")?;
        unsafe {
            if pattern.CurrentIsReadOnly().map_err(api_error)?.as_bool() { return Err("UIA range is read-only".into()); }
            let min = pattern.CurrentMinimum().map_err(api_error)?;
            let max = pattern.CurrentMaximum().map_err(api_error)?;
            if !value.is_finite() || !min.is_finite() || !max.is_finite() || min > max || value < min || value > max {
                return Err("UIA requested range value lies outside declared finite bounds".into());
            }
            guard()?;
            ensure_lease(target_id, hwnd, process_id, generation)?;
            let (_, current) = describe(&element, hwnd, process_id)?;
            if current != fingerprint { return Err("UIA target changed before range update".into()); }
            // Re-read writable bounds after the guard and immediately before SetValue.
            if pattern.CurrentIsReadOnly().map_err(api_error)?.as_bool()
                || pattern.CurrentMinimum().map_err(api_error)? != min
                || pattern.CurrentMaximum().map_err(api_error)? != max { return Err("UIA range metadata changed before update".into()); }
            ensure_lease(target_id, hwnd, process_id, generation)?;
            let write_result = pattern.SetValue(value);
            // An error here may follow a real provider mutation; callers must not claim zero mutation.
            guard()?;
            write_result.map_err(api_error)?;
        }
        ensure_lease(target_id, hwnd, process_id, generation)?;
        let (fresh, mut target, _) = identity_element(hwnd, process_id, fingerprint)?;
        target.target_id = target_id.to_owned();
        let state = control_state(&fresh, &target)?;
        if state.range_value != Some(value) { return Err("UIA range update readback does not match requested value".into()); }
        let (_, after) = describe(&fresh, hwnd, process_id)?;
        if after != fingerprint { return Err("UIA target changed during range readback".into()); }
        guard()?;
        ensure_lease(target_id, hwnd, process_id, generation)?;
        Ok(state)
    }

    fn describe(element: &IUIAutomationElement, hwnd: isize, process_id: u32) -> Result<(LocatedTarget, String), String> {
        let handle = bind(hwnd, process_id)?;
        let identity = crate::native_calculator_identity::observe(hwnd, process_id)?;
        unsafe {
            if !owned_element(element, hwnd, process_id, &identity)?
                || element.CurrentIsPassword().map_err(api_error)?.as_bool()
                || !element.CurrentIsEnabled().map_err(api_error)?.as_bool()
                || element.CurrentIsOffscreen().map_err(api_error)?.as_bool() { return Err("UIA element is not an eligible owned target".into()); }
            let native = element.CurrentNativeWindowHandle().map_err(api_error)?;
            if !native.0.is_null() && native != handle && !IsChild(handle, native).as_bool() { return Err("UIA element window provenance mismatch".into()); }
            let name = element.CurrentName().map_err(api_error)?.to_string();
            if name.len() > 4096 { return Err("UIA element name budget exceeded".into()); }
            let control_type = element.CurrentControlType().map_err(api_error)?.0;
            let rect = element.CurrentBoundingRectangle().map_err(api_error)?;
            let mut window = windows::Win32::Foundation::RECT::default();
            GetWindowRect(handle, &mut window).map_err(api_error)?;
            let width = rect.right.checked_sub(rect.left).ok_or("UIA invalid bounds")?;
            let height = rect.bottom.checked_sub(rect.top).ok_or("UIA invalid bounds")?;
            if width <= 0 || height <= 0 || rect.left < window.left || rect.top < window.top
                || rect.right > window.right || rect.bottom > window.bottom { return Err("UIA target bounds lie outside owned window".into()); }
            let runtime = RuntimeId(element.GetRuntimeId().map_err(api_error)?);
            if runtime.0.is_null() || SafeArrayGetDim(runtime.0) != 1 || SafeArrayGetElemsize(runtime.0) != 4 { return Err("UIA runtime identity unavailable".into()); }
            let low = SafeArrayGetLBound(runtime.0, 1).map_err(api_error)?;
            let high = SafeArrayGetUBound(runtime.0, 1).map_err(api_error)?;
            if high < low || i64::from(high) - i64::from(low) >= 64 { return Err("UIA runtime identity budget exceeded".into()); }
            let mut hash = Sha256::new();
            hash.update(hwnd.to_le_bytes()); hash.update(process_id.to_le_bytes());
            for index in low..=high {
                let mut value: i32 = 0;
                SafeArrayGetElement(runtime.0, &index, &mut value as *mut i32 as *mut core::ffi::c_void).map_err(api_error)?;
                hash.update(value.to_le_bytes());
            }
            hash.update(name.as_bytes()); hash.update(control_type.to_le_bytes());
            for value in [rect.left, rect.top, width, height] { hash.update(value.to_le_bytes()); }
            let fingerprint = format!("{:x}", hash.finalize());
            Ok((LocatedTarget { target_id: String::new(), name, control_type, x: rect.left, y: rect.top, width, height, process_id, hwnd }, fingerprint))
        }
    }

    pub fn find(hwnd: isize, process_id: u32, query: &str) -> Result<(LocatedTarget, String), String> {
        let _apartment = Apartment::new()?;
        let query = query.trim().to_lowercase();
        let mut found = None;
        for element in elements_for_query(hwnd, process_id, true)? {
            let name = unsafe { element.CurrentName().map_err(api_error)? }.to_string();
            if name.len() > 4096 { return Err("UIA element name budget exceeded".into()); }
            if name.trim().to_lowercase() == query {
                let target = describe(&element, hwnd, process_id)?;
                if found.is_some() { return Err("UIA query is ambiguous; require a unique target name".into()); }
                found = Some(target);
            }
        }
        bind(hwnd, process_id)?;
        found.ok_or_else(|| "UIA_TARGET_NOT_FOUND".into())
    }

    pub fn read_text(hwnd: isize, process_id: u32) -> Result<String, String> {
        let _apartment = Apartment::new()?;
        let mut text = None;
        for element in elements(hwnd, process_id)? {
            unsafe {
                if !eligible(&element, hwnd, process_id)? { continue; }
                let kind = element.CurrentControlType().map_err(api_error)?;
                if kind != UIA_DocumentControlTypeId && kind != UIA_EditControlTypeId { continue; }
                let Ok(pattern) = element.GetCurrentPatternAs::<IUIAutomationTextPattern>(UIA_TextPatternId) else { continue; };
                let value = pattern.DocumentRange().map_err(api_error)?.GetText(65537).map_err(api_error)?.to_string();
                if value.len() > 65536 { return Err("UIA text exceeds 64 KiB readback budget".into()); }
                if text.is_some() { return Err("UIA document readback is ambiguous".into()); }
                text = Some(value);
            }
        }
        bind(hwnd, process_id)?;
        text.ok_or_else(|| "Owned document has no UIA TextPattern; readback unavailable".into())
    }
}

// Additive Steam MAIN v2 observer. No production page-kind profile is approved.
pub(crate) use steam_main_v2::{steam_main_detail, steam_selected_game_entry, steam_main_worker_quiescent, SteamMainDetailObservation, SteamMainObservation, steam_diagnostic_capture, SteamDiagnosticCapture,
    SteamApprovedLibraryEntry,steam_approved_library_context,steam_approved_library_entry,steam_revalidate_library_entry,steam_approved_main_detail,
    steam_read_policy_deadline,steam_read_candidate_capture,SteamReadCandidate};
mod steam_main_v2 {
    use super::{SteamPathNode,SteamEntryObservation,ecma_trim};
    use std::sync::{Arc,atomic::{AtomicBool,Ordering}};
    use std::time::{Instant,Duration,SystemTime,UNIX_EPOCH};
    use serde_json::{Value,json};
    const UNSUPPORTED:&str="CONFIGURATION_REQUIRED: Steam MAIN/detail provider profile unsupported";
    const READ_UNSUPPORTED:&str="STEAM_READ_UNSUPPORTED";
    const READ_TIMEOUT:&str="STEAM_READ_TIMEOUT";
    const READ_POLICY_UNAVAILABLE:&str="STEAM_READ_POLICY_UNAVAILABLE";
    const READ_POLICY_HASH:&str="FC4CD1597B941E10E00B6FA6EA70211E5FE4D013DCD5636456B7439C100C6699";
    const READ_CONTRACT_HASH:&str="D977C0D12AC0508B07DA80F6CA7852F502D18212F934C0EA973FF2E2C75095EA";
    const READ_ISSUED:u64=1792173791413;
    const READ_EXPIRES:u64=1792180991413;
    const READ_FRAMEWORKS:&[&str]=&["Chrome","Win32","WPF","XAML","WinForm","WinForms"];
    const READ_PROVIDER_WORDS:&[&str]=&["Microsoft","Windows","UI","UIA","UIAutomation","Automation","Provider","Proxy","MSAA","Chrome","Chromium","Valve","Steam","Win32","WPF","XAML","WinForm","WinForms","Core","Native","Client","Accessibility","Legacy","Universal"];
    const READ_IDENTITIES:&[&str]=&["Microsoft","Windows","Chrome","Chromium","Valve","Steam","Win32","WPF","XAML","WinForm","WinForms"];
    const READ_ROLES:&[&str]=&["window","document","main","heading","list","listbox","listitem","tree","treeitem","navigation","search","complementary","menu","menubar","menuitem","tabpanel","dialog","alertdialog","tooltip","button","tab","group","pane","text","link","status","separator","toolbar","img","presentation","none"];
    const READ_BSTR_IDS:&[i32]=&[30024,30107,30101,30102];
    pub(crate) fn steam_read_policy_deadline(now:u64)->Result<u64,String>{
        if !(READ_ISSUED..READ_EXPIRES).contains(&now){return Err(READ_POLICY_UNAVAILABLE.into());}Ok(READ_EXPIRES)
    }
    fn read_bstr_allowed(id:i32,value:&str)->bool{
        if value.len()>160||!value.bytes().all(|b|(0x20..=0x7e).contains(&b)){return false;}
        match id{
            30024=>READ_FRAMEWORKS.contains(&value),
            30107=>{let words:Vec<_>=value.split(' ').collect();(2..=12).contains(&words.len())&&words.iter().all(|w|READ_PROVIDER_WORDS.contains(w))
                &&words.iter().any(|w|matches!(*w,"Provider"|"Proxy"))&&words.iter().any(|w|READ_IDENTITIES.contains(w))},
            30101=>READ_ROLES.contains(&value),
            30102=>{
                if value.is_empty(){return true;}
                let text=value.strip_suffix(';').unwrap_or(value);let parts:Vec<_>=text.split(';').collect();if parts.len()>15{return false;}
                let mut seen=std::collections::BTreeSet::new();
                parts.into_iter().all(|part|{let Some((key,val))=part.split_once('=')else{return false};if !seen.insert(key){return false;}
                    match key{
                        "modal"|"busy"|"readonly"|"expanded"|"selected"|"disabled"|"multiselectable"|"required"|"atomic"|"hidden"=>matches!(val,"false"|"true"),
                        "orientation"=>matches!(val,"horizontal"|"vertical"),"live"=>matches!(val,"off"|"polite"|"assertive"),
                        "current"=>matches!(val,"false"|"true"|"page"|"step"|"location"|"date"|"time"),
                        "haspopup"=>matches!(val,"false"|"true"|"menu"|"listbox"|"tree"|"grid"|"dialog"),
                        "level"=>matches!(val,"1"|"2"|"3"|"4"|"5"|"6"|"7"|"8"|"9"),_=>false}})
            },_=>false
        }
    }
    fn read_build_identity()->Result<&'static str,String>{
        let identity=option_env!("EDITH_NATIVE_BUILD_ID").ok_or(READ_POLICY_UNAVAILABLE)?;
        if !read_build_id_valid(identity){return Err(READ_POLICY_UNAVAILABLE.into());}Ok(identity)
    }
    fn read_build_id_valid(identity:&str)->bool{identity.len()==64&&identity.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b))}
    fn read_output_budget(value:&Value)->Result<(),String>{if serde_json::to_vec(value).map_err(|_|READ_UNSUPPORTED)?.len()>65536{Err(READ_UNSUPPORTED.into())}else{Ok(())}}
    fn read_closed_error(error:&str)->String{match error{
        "STEAM_READ_INVALID_REQUEST"|"STEAM_READ_POLICY_UNAVAILABLE"|"STEAM_READ_SCOPE_UNAVAILABLE"|"STEAM_READ_SCOPE_EXPIRED"|"STEAM_READ_SCOPE_CHANGED"|"STEAM_READ_BUSY"|"STEAM_READ_REPLAY"|"STEAM_READ_UNSUPPORTED"|"STEAM_READ_TIMEOUT"|"STEAM_READ_ENDED"|"STEAM_READ_CAPACITY"=>error.to_owned(),_=>READ_UNSUPPORTED.into()}}
    fn read_guard(guard:&dyn Fn()->Result<(),String>)->Result<(),String>{guard().map_err(|error|read_closed_error(&error))}
    #[derive(Clone,Debug)]
    pub(crate) struct SteamMainObservation {
        pub document_runtime_id:Vec<i32>, pub main_runtime_id:Vec<i32>,pub title_runtime_id:Vec<i32>,
        pub main_ancestry:Vec<SteamPathNode>,pub title_ancestry:Vec<SteamPathNode>,
        pub main_rect:[i32;4],pub title_rect:[i32;4],pub title:String,
        pub main_semantic_facts:Value,pub title_semantic_facts:Value,
    }
    #[derive(Clone,Debug)]
    pub(crate) struct SteamMainDetailObservation {
        pub main:SteamMainObservation,pub profile_fingerprint:String,
        pub profile_version:i32,pub provider_identity:String,pub evidence_set_digest:String,pub registry_revision:i32,
        pub observed_properties:Value,pub exclusion_properties:Value,
        _seal:(),
    }
    #[derive(Clone)]
    pub(crate) struct SteamApprovedLibraryEntry {
        pub entry:SteamEntryObservation,pub profile_fingerprint:String,pub profile_version:i32,
        pub provider_identity:String,pub evidence_set_digest:String,pub registry_revision:i32,
        pub observed_properties:Value,pub exclusion_properties:Value,
        context_identity:Value,
        _seal:(),
    }
    impl SteamApprovedLibraryEntry {
        pub(crate) fn same_profile(&self,other:&Self)->bool{self.profile_fingerprint==other.profile_fingerprint&&self.profile_version==other.profile_version
            &&self.provider_identity==other.provider_identity&&self.evidence_set_digest==other.evidence_set_digest&&self.registry_revision==other.registry_revision}
        pub(crate) fn same_pre_context(&self,other:&Self)->bool{self.same_profile(other)&&self.context_identity==other.context_identity&&self.observed_properties==other.observed_properties&&self.exclusion_properties==other.exclusion_properties}
    }
    const PROFILE_SOURCE:&str=include_str!("../../server/computer/steamDetailProfiles.json");
    const PROFILE_DOMAIN:&str="edith.steam.detail-profile/1";
    const PHASES:[&str;2]=["pre_library","post_detail"];
    const ANCHORS:[&str;9]=["document","main","title","entry","entry_ancestors","main_ancestors","title_ancestors","every_visible","every_visible_intersecting_main"];
    #[derive(Clone)] struct ProfileCatalog{id:String,id_property:i32,tag:String,values:Vec<Value>,anchor:String,proof:bool}
    #[derive(Clone)] struct ProfileIdentity{id:String,framework:String,provider:String}
    #[derive(Clone)] struct ProfilePredicate{id:i32,tag:String,value:Value}
    #[derive(Clone)] struct ProfileSelector{phase:usize,anchor:usize,every:bool,predicates:Vec<ProfilePredicate>}
    #[derive(Clone)] struct ApprovedProfile{fingerprint:String,version:i32,provider:String,evidence:String,revision:i32,revoked:bool,positive:Vec<ProfileSelector>,exclusions:Vec<ProfileSelector>}
    struct ProfileRegistry{revision:i32,catalog:Vec<ProfileCatalog>,identities:Vec<ProfileIdentity>,profiles:Vec<ApprovedProfile>}
    fn profile_error<T>()->Result<T,String>{Err(UNSUPPORTED.into())}
    fn profile_id(s:&str)->bool{!s.is_empty()&&s.len()<=80&&s.as_bytes()[0].is_ascii_lowercase()&&s.bytes().all(|b|b.is_ascii_lowercase()||b.is_ascii_digit()||b"._-".contains(&b))}
    fn profile_hash(s:&str)->bool{s.len()==64&&s.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b))}
    fn profile_digest(v:&Value)->Result<String,String>{use sha2::{Digest,Sha256};Ok(format!("{:x}",Sha256::digest(serde_json::to_vec(v).map_err(|_|UNSUPPORTED)?)))}
    fn profile_keys<'a>(v:&'a Value,names:&[&str])->Result<&'a serde_json::Map<String,Value>,String>{let m=v.as_object().ok_or(UNSUPPORTED)?;if m.len()!=names.len()||m.keys().any(|k|!names.contains(&k.as_str())){return profile_error();}Ok(m)}
    fn profile_array(v:&Value,min:usize,max:usize)->Result<&Vec<Value>,String>{let a=v.as_array().ok_or(UNSUPPORTED)?;if a.len()<min||a.len()>max{return profile_error();}Ok(a)}
    fn profile_i4(v:&Value)->Result<i32,String>{v.as_i64().and_then(|n|i32::try_from(n).ok()).ok_or_else(||UNSUPPORTED.into())}
    fn profile_positive(v:&Value)->Result<i32,String>{let n=profile_i4(v)?;if n<=0{return profile_error();}Ok(n)}
    fn profile_string(v:&Value)->Result<String,String>{Ok(v.as_str().ok_or(UNSUPPORTED)?.to_owned())}
    fn profile_typed(tag:&str,v:&Value)->bool{match tag{"BOOL"=>v.is_boolean(),"I4"=>profile_i4(v).is_ok(),"BSTR"=>v.as_str().is_some_and(|s|s.len()<=4096&&s.bytes().all(|b|(32..=126).contains(&b))),_=>false}}
    fn profile_tag(id:i32)->Option<&'static str>{match PropertyRecord::expected(id)?{3=>Some("I4"),11=>Some("BOOL"),8 if id!=30005=>Some("BSTR"),_=>None}}
    // Deserialize only source policy, never evidence. This visitor rejects raw
    // duplicate/escaped duplicate keys before serde_json could erase them.
    struct StrictProfileJson(Value);
    impl<'de> serde::Deserialize<'de> for StrictProfileJson {
        fn deserialize<D:serde::Deserializer<'de>>(d:D)->Result<Self,D::Error>{
            struct Visitor;
            impl<'de> serde::de::Visitor<'de> for Visitor {
                type Value=StrictProfileJson;
                fn expecting(&self,f:&mut std::fmt::Formatter)->std::fmt::Result{f.write_str("closed source policy JSON")}
                fn visit_bool<E:serde::de::Error>(self,v:bool)->Result<Self::Value,E>{Ok(StrictProfileJson(json!(v)))}
                fn visit_i64<E:serde::de::Error>(self,v:i64)->Result<Self::Value,E>{Ok(StrictProfileJson(json!(v)))}
                fn visit_u64<E:serde::de::Error>(self,v:u64)->Result<Self::Value,E>{Ok(StrictProfileJson(json!(v)))}
                fn visit_str<E:serde::de::Error>(self,v:&str)->Result<Self::Value,E>{Ok(StrictProfileJson(json!(v)))}
                fn visit_string<E:serde::de::Error>(self,v:String)->Result<Self::Value,E>{Ok(StrictProfileJson(json!(v)))}
                fn visit_unit<E:serde::de::Error>(self)->Result<Self::Value,E>{Ok(StrictProfileJson(Value::Null))}
                fn visit_seq<A:serde::de::SeqAccess<'de>>(self,mut a:A)->Result<Self::Value,A::Error>{let mut v=Vec::new();while let Some(StrictProfileJson(x))=a.next_element()?{v.push(x);}Ok(StrictProfileJson(Value::Array(v)))}
                fn visit_map<A:serde::de::MapAccess<'de>>(self,mut a:A)->Result<Self::Value,A::Error>{let mut m=serde_json::Map::new();while let Some(k)=a.next_key::<String>()?{if m.contains_key(&k){return Err(serde::de::Error::custom("duplicate source key"));}let StrictProfileJson(v)=a.next_value()?;m.insert(k,v);}Ok(StrictProfileJson(Value::Object(m)))}
            }d.deserialize_any(Visitor)
        }
    }
    fn profile_json(text:&str)->Result<Value,String>{
        if text.len()>262144{return profile_error();}
        fn space(b:&[u8],i:&mut usize){while *i<b.len()&&b" \t\r\n".contains(&b[*i]){*i+=1;}}
        fn string(b:&[u8],i:&mut usize)->Result<(),String>{if b.get(*i)!=Some(&b'"'){return profile_error();}*i+=1;while *i<b.len(){let c=b[*i];*i+=1;if c==b'"'{return Ok(());}if c==b'\\'{*i=i.checked_add(1).ok_or(UNSUPPORTED)?;}}profile_error()}
        fn read(b:&[u8],i:&mut usize,depth:usize,tokens:&mut usize)->Result<(),String>{
            *tokens+=1;if depth>20||*tokens>40000{return profile_error();}space(b,i);
            match b.get(*i).copied(){
                Some(b'"')=>string(b,i),
                Some(open @ (b'['|b'{'))=>{*i+=1;space(b,i);let close=if open==b'['{b']'}else{b'}'};
                    if b.get(*i)==Some(&close){*i+=1;return Ok(());}loop{
                        if open==b'{'{space(b,i);string(b,i)?;space(b,i);if b.get(*i)!=Some(&b':'){return profile_error();}*i+=1;}
                        read(b,i,depth+1,tokens)?;space(b,i);if b.get(*i)==Some(&close){*i+=1;return Ok(());}if b.get(*i)!=Some(&b','){return profile_error();}*i+=1;
                    }
                },
                Some(_)=>{let start=*i;while *i<b.len()&&!b" \t\r\n,]}".contains(&b[*i]){*i+=1;}let token=&b[start..*i];
                    if token==b"true"||token==b"false"||token==b"null"{return Ok(());}
                    let digits=if token.first()==Some(&b'-'){&token[1..]}else{token};
                    if digits.is_empty()||digits.iter().any(|c|!c.is_ascii_digit())||(digits.len()>1&&digits[0]==b'0')||token==b"-0"{return profile_error();}Ok(())
                },None=>profile_error()
            }
        }
        let(mut at,mut tokens)=(0,0);read(text.as_bytes(),&mut at,0,&mut tokens)?;space(text.as_bytes(),&mut at);if at!=text.len(){return profile_error();}
        use serde::Deserialize;let mut decoder=serde_json::Deserializer::from_str(text);let StrictProfileJson(v)=StrictProfileJson::deserialize(&mut decoder).map_err(|_|UNSUPPORTED)?;decoder.end().map_err(|_|UNSUPPORTED)?;Ok(v)
    }
    fn profile_selectors(v:&Value)->Result<Vec<ProfileSelector>,String>{let mut out=Vec::new();let mut last=None;let mut counts=[0usize;2];
        for x in profile_array(v,2,64)?{let a=profile_array(x,4,4)?;let phase=PHASES.iter().position(|s|Some(*s)==a[0].as_str()).ok_or(UNSUPPORTED)?;let anchor=ANCHORS.iter().position(|s|Some(*s)==a[1].as_str()).ok_or(UNSUPPORTED)?;
            if phase==0&&matches!(anchor,2|6){return profile_error();}let every=match a[2].as_str(){Some("every")=>true,Some("exactly_one")=>false,_=>return profile_error()};let order=phase*9+anchor;if last.is_some_and(|p|p>=order){return profile_error();}last=Some(order);counts[phase]+=1;if counts[phase]>32{return profile_error();}
            let mut predicates=Vec::new();let mut id_last=0;for p in profile_array(&a[3],1,14)?{let p=profile_array(p,4,4)?;let id=profile_i4(&p[0])?;let tag=profile_string(&p[1])?;if id<=id_last||profile_tag(id)!=Some(tag.as_str())||p[2]!="eq"||!profile_typed(&tag,&p[3]){return profile_error();}id_last=id;predicates.push(ProfilePredicate{id,tag,value:p[3].clone()});}out.push(ProfileSelector{phase,anchor,every,predicates});
        }if counts.contains(&0){return profile_error();}Ok(out)
    }
    fn profile_definition(v:&Value)->Result<(i32,String,Vec<ProfileSelector>,Vec<ProfileSelector>,String),String>{let a=profile_array(v,6,6)?;let version=profile_positive(&a[1])?;let provider=profile_string(&a[2])?;let evidence=profile_string(&a[5])?;if a[0]!=PROFILE_DOMAIN||!profile_id(&provider)||!profile_hash(&evidence){return profile_error();}let positive=profile_selectors(&a[3])?;let exclusions=profile_selectors(&a[4])?;
        for phase in 0..2{if !positive.iter().any(|s|s.phase==phase&&matches!(s.anchor,0|1|5|7)&&s.predicates.iter().any(|p|!matches!(p.id,30002|30003|30101|30157))){return profile_error();}}
        if serde_json::to_vec(v).map_err(|_|UNSUPPORTED)?.len()>65536{return profile_error();}Ok((version,provider,positive,exclusions,evidence))
    }
    fn parse_profile_registry(text:&str)->Result<ProfileRegistry,String>{let top=profile_json(text)?;profile_keys(&top,&["schema","revision","privacyCatalog","providerIdentities","profiles"])?;if top["schema"]!="edith.steam.detail-profile-registry/1"{return profile_error();}let revision=profile_positive(&top["revision"])?;let mut catalog=Vec::<ProfileCatalog>::new();let mut pairs=std::collections::BTreeSet::new();
        for c in profile_array(&top["privacyCatalog"],0,64)?{profile_keys(c,&["id","propertyId","variant","allowedValues","anchor","proofAllowed"])?;let id=profile_string(&c["id"])?;let id_property=profile_i4(&c["propertyId"])?;let tag=profile_string(&c["variant"])?;let anchor=profile_string(&c["anchor"])?;let proof=c["proofAllowed"].as_bool().ok_or(UNSUPPORTED)?;let values=profile_array(&c["allowedValues"],1,32)?.clone();
            if !profile_id(&id)||catalog.last().is_some_and(|p|p.id>=id)||profile_tag(id_property)!=Some(tag.as_str())||!ANCHORS.contains(&anchor.as_str())||!pairs.insert((id_property,tag.clone(),anchor.clone()))||values.iter().any(|v|!profile_typed(&tag,v)){return profile_error();}
            let enc:Vec<_>=values.iter().map(|v|serde_json::to_string(&json!([tag,v])).map_err(|_|UNSUPPORTED)).collect::<Result<_,_>>()?;if enc.windows(2).any(|w|w[0]>=w[1]){return profile_error();}catalog.push(ProfileCatalog{id,id_property,tag,values,anchor,proof});
        }let mut identities=Vec::<ProfileIdentity>::new();let mut identity_pairs=std::collections::BTreeSet::new();
        for g in profile_array(&top["providerIdentities"],0,16)?{profile_keys(g,&["id","anchor","frameworkCatalogId","providerCatalogId"])?;let id=profile_string(&g["id"])?;let framework=profile_string(&g["frameworkCatalogId"])?;let provider=profile_string(&g["providerCatalogId"])?;
            if !profile_id(&id)||!profile_id(&framework)||!profile_id(&provider)||framework==provider||g["anchor"]!="main"||identities.last().is_some_and(|p|p.id>=id){return profile_error();}let refs=[(&framework,30024),(&provider,30107)];let mut vals=Vec::new();for(id,property)in refs{let c=catalog.iter().find(|c|c.id==*id).ok_or(UNSUPPORTED)?;if c.id_property!=property||c.tag!="BSTR"||c.anchor!="main"||c.values.len()!=1||c.proof{return profile_error();}vals.push(c.values[0].as_str().ok_or(UNSUPPORTED)?.to_owned());}if !identity_pairs.insert(vals){return profile_error();}identities.push(ProfileIdentity{id,framework,provider});
        }let mut profiles=Vec::<ApprovedProfile>::new();let mut versions=std::collections::BTreeSet::new();let mut active=std::collections::BTreeSet::new();
        for p in profile_array(&top["profiles"],0,16)?{profile_keys(p,&["approval","canonicalDefinition"])?;let a=&p["approval"];profile_keys(a,&["domain","fingerprint","version","providerIdentity","evidenceSetDigest","approvedRevision","revoked"])?;let fingerprint=profile_string(&a["fingerprint"])?;let av=profile_positive(&a["version"])?;let ap=profile_string(&a["providerIdentity"])?;let ae=profile_string(&a["evidenceSetDigest"])?;let ar=profile_positive(&a["approvedRevision"])?;let revoked=a["revoked"].as_bool().ok_or(UNSUPPORTED)?;let(version,provider,positive,exclusions,evidence)=profile_definition(&p["canonicalDefinition"])?;
            if a["domain"]!=PROFILE_DOMAIN||!profile_hash(&fingerprint)||!profile_id(&ap)||!profile_hash(&ae)||ar>revision||av!=version||ap!=provider||ae!=evidence||!identities.iter().any(|i|i.id==provider)||profile_digest(&p["canonicalDefinition"])?!=fingerprint||profiles.last().is_some_and(|p|p.fingerprint>=fingerprint)||!versions.insert((provider.clone(),version))||!revoked&&!active.insert(provider.clone()){return profile_error();}
            for s in positive.iter().chain(&exclusions){for p in &s.predicates{let found:Vec<_>=catalog.iter().filter(|c|c.id_property==p.id&&c.tag==p.tag&&c.anchor==ANCHORS[s.anchor]&&c.values.contains(&p.value)).collect();if found.len()!=1||!found[0].proof{return profile_error();}}}profiles.push(ApprovedProfile{fingerprint,version,provider,evidence,revision:ar,revoked,positive,exclusions});
        }Ok(ProfileRegistry{revision,catalog,identities,profiles})
    }
    fn compiled_profiles()->Result<&'static ProfileRegistry,String>{static REGISTRY:std::sync::OnceLock<Result<ProfileRegistry,String>>=std::sync::OnceLock::new();REGISTRY.get_or_init(||parse_profile_registry(PROFILE_SOURCE)).as_ref().map_err(|_|UNSUPPORTED.into())}
    #[derive(Clone,PartialEq,Eq)]
    struct Node {
        runtime:Vec<i32>,ancestry:Vec<SteamPathNode>,kind:i32,rect:[i32;4],visible:Option<bool>,password:Option<bool>,
        role:Option<String>,landmark:Option<i32>,heading:Option<i32>,dialog:Option<bool>,
        modal:Option<bool>,busy:Option<bool>,label:Option<Vec<i32>>,name:Option<String>,
        framework:Option<String>,provider:Option<String>,enabled:Option<bool>,selected:Option<bool>,
        control_ancestry:Option<Vec<SteamPathNode>>,
        properties:Vec<PropertyRecord>,aria:Option<Vec<(String,String)>>,
    }
    #[derive(Clone)]
    struct RawMain {
        document_runtime_id:Vec<i32>,main_runtime_id:Vec<i32>,title_runtime_id:Vec<i32>,
        main_ancestry:Vec<SteamPathNode>,title_ancestry:Vec<SteamPathNode>,
        main_rect:[i32;4],title_rect:[i32;4],title:String,
        capture:CurrentCapture,
    }
    // Private support/type/value packet. It has no Debug/Serialize/Deserialize
    // implementation and no public constructor. Unknown text is never hashed.
    #[derive(Clone,Copy,PartialEq,Eq)]
    enum Support { Supported,NotSupported,UnsupportedType,Error }
    impl Support {
        fn label(self)->&'static str { match self {Self::Supported=>"supported",Self::NotSupported=>"not_supported",Self::UnsupportedType=>"unsupported_type",Self::Error=>"error"} }
    }
    #[derive(Clone,PartialEq,Eq)]
    enum PropertyValue { Empty,Bool(bool),I4(i32),Bstr(String) }
    #[derive(Clone,PartialEq,Eq)]
    struct PropertyRecord { id:i32,support:Support,tag:Option<u16>,value:Option<PropertyValue> }
    impl PropertyRecord {
        fn variant(&self)->&'static str {match self.tag {Some(0)=>"EMPTY",Some(11)=>"BOOL",Some(3)=>"I4",Some(8)=>"BSTR",_=>"OTHER"}}
        fn expected(id:i32)->Option<u16> {match id {30002|30003|30173|30157=>Some(3),30022|30019|30010|30079|30174=>Some(11),30101|30102|30005|30024|30107=>Some(8),_=>None}}
        fn validate(&self)->bool {
            let Some(expected)=Self::expected(self.id) else {return false;};
            match self.support {
                Support::NotSupported=>self.tag==Some(13)&&self.value.is_none(),
                // Provider errors or unrepresentable variants cannot prove a
                // complete stable value scan. They are not default values.
                Support::Error=>false,
                Support::Supported|Support::UnsupportedType=>{
                    let matches=match (&self.value,self.tag) {(Some(PropertyValue::Empty),Some(0))|(Some(PropertyValue::Bool(_)),Some(11))|(Some(PropertyValue::I4(_)),Some(3))=>true,
                        (Some(PropertyValue::Bstr(text)),Some(8))=>text.len()<=4096,_=>false};
                    matches&&match self.support {Support::Supported=>self.tag==Some(0)||self.tag==Some(expected),Support::UnsupportedType=>self.tag!=Some(0)&&self.tag!=Some(expected),_=>false}
                }
            }
        }
        fn boolean(&self)->Result<Option<bool>,String>{match (&self.support,&self.value){(Support::NotSupported,_)=>Ok(None),(Support::Supported,Some(PropertyValue::Bool(v)))=>Ok(Some(*v)),_=>Err(UNSUPPORTED.into())}}
        fn integer(&self)->Result<Option<i32>,String>{match (&self.support,&self.value){(Support::NotSupported,_)=>Ok(None),(Support::Supported,Some(PropertyValue::I4(v)))=>Ok(Some(*v)),_=>Err(UNSUPPORTED.into())}}
        fn text(&self)->Result<Option<String>,String>{match (&self.support,&self.value){(Support::NotSupported,_)=>Ok(None),(Support::Supported,Some(PropertyValue::Bstr(v)))=>Ok(Some(v.clone())),_=>Err(UNSUPPORTED.into())}}
    }
    #[derive(Clone,PartialEq,Eq)]
    struct CurrentCapture {nodes:Vec<Node>,client:[i32;4]}
    impl CurrentCapture {
        fn validate(&self)->Result<(),String>{
            if !valid_tree(&self.nodes)||!contains(self.client,self.client){return Err(UNSUPPORTED.into());}
            let mut bytes=0usize;
            for node in &self.nodes {
                if node.properties.is_empty()||node.properties.len()>14 {return Err(UNSUPPORTED.into());}
                let mut previous=0;
                for property in &node.properties {
                    if property.id<=previous||!property.validate(){return Err(UNSUPPORTED.into());}previous=property.id;
                    if let Some(PropertyValue::Bstr(text))=&property.value {bytes=bytes.checked_add(text.len()).ok_or(UNSUPPORTED)?;}
                }
                // Fixed mandatory reads must occur once, regardless of support.
                for id in [30002,30003,30010,30019,30022,30024,30101,30102,30107,30157,30173,30174] {
                    if !node.properties.iter().any(|p|p.id==id){return Err(UNSUPPORTED.into());}
                }
                let flags=node.properties.iter().find(|p|p.id==30102).ok_or(UNSUPPORTED)?;
                match &flags.value {Some(PropertyValue::Bstr(text)) if flags.support==Support::Supported=>{
                    if node.aria.as_ref()!=Some(&aria_properties(text)?){return Err(UNSUPPORTED.into());}
                },_=>if node.aria.is_some(){return Err(UNSUPPORTED.into());}}
            }
            if bytes>262144{return Err(UNSUPPORTED.into());}Ok(())
        }
    }
    struct MaterializedMain {main:SteamMainObservation,capture:CurrentCapture}
    struct ProfileContext{main:usize,document:usize,title:Option<usize>,entry:Option<usize>}
    fn actual_profile_value(property:&PropertyRecord)->Result<Value,String>{
        if property.support!=Support::Supported{return profile_error();}
        match &property.value{Some(PropertyValue::Bool(v))=>Ok(json!(v)),Some(PropertyValue::I4(v))=>Ok(json!(v)),Some(PropertyValue::Bstr(v))=>Ok(json!(v)),_=>profile_error()}
    }
    fn current_property(node:&Node,id:i32)->Result<&PropertyRecord,String>{node.properties.iter().find(|p|p.id==id).ok_or_else(||UNSUPPORTED.into())}
    fn semantic_context(capture:&CurrentCapture)->Result<ProfileContext,String>{
        capture.validate()?;
        if !contains(capture.nodes[0].rect,capture.client){return profile_error();}
        for n in &capture.nodes {
            if n.visible.is_none(){return profile_error();}
            if n.visible==Some(true){
                if n.password!=Some(false)||n.dialog!=Some(false)||n.modal!=Some(false)||n.busy!=Some(false)||n.enabled!=Some(true)||!contains(capture.nodes[0].rect,n.rect)
                    ||n.role.as_deref().is_none_or(|r|matches!(r,"dialog"|"alertdialog"|"tooltip")){return profile_error();}
            }
            // The semantic model and the support-aware packet must agree; no
            // cached/expected field can substitute for the collected property.
            for(id,value)in [(30003,json!(n.kind)),(30010,json!(n.enabled)),(30019,json!(n.password)),(30022,json!(n.visible.map(|v|!v))),
                (30024,json!(n.framework)),(30101,json!(n.role)),(30107,json!(n.provider)),(30157,json!(n.landmark)),(30173,json!(n.heading)),(30174,json!(n.dialog)),(30079,json!(if matches!(n.kind,50007|50029){n.selected}else{None})),(30005,json!(n.name))]{
                if !value.is_null()&&actual_profile_value(current_property(n,id)?)?!=value{return profile_error();}
            }
            if let Some(PropertyValue::Bstr(flags))=&current_property(n,30102)?.value{if aria_flags(flags)?!=(n.modal,n.busy){return profile_error();}}
        }
        let mains:Vec<_>=capture.nodes.iter().enumerate().filter(|(_,n)|n.visible==Some(true)&&(n.role.as_deref()==Some("main")||n.landmark==Some(80002))).collect();
        if mains.len()!=1{return profile_error();}let(main_idx,main)=mains[0];
        if main.role.as_deref()!=Some("main")||main.landmark!=Some(80002)||!contains(capture.client,main.rect){return profile_error();}
        for path in &main.ancestry {let ancestor=capture.nodes.iter().find(|n|n.runtime==path.runtime_id).ok_or(UNSUPPORTED)?;
            if matches!(ancestor.role.as_deref(),Some("navigation"|"search"|"complementary"|"list"|"listbox"|"tree"|"menu"|"tabpanel"))||matches!(ancestor.kind,50007|50008|50023|50029|50018|50019)||ancestor.ancestry.len()>1&&ancestor.kind==50032{return profile_error();}}
        let docs:Vec<_>=main.ancestry.iter().filter(|p|p.control_type==50030).collect();if docs.len()!=1{return profile_error();}
        let document=capture.nodes.iter().position(|n|n.runtime==docs[0].runtime_id).ok_or(UNSUPPORTED)?;
        Ok(ProfileContext{main:main_idx,document,title:None,entry:None})
    }
    fn anchor_candidates<'a>(capture:&'a CurrentCapture,context:&ProfileContext,anchor:usize)->Result<Vec<&'a Node>,String>{
        let nodes=&capture.nodes;let main=&nodes[context.main];
        let strict=|index:usize|->Vec<&Node>{let node=&nodes[index];nodes.iter().filter(|n|n.ancestry.len()<node.ancestry.len()&&node.ancestry.starts_with(&n.ancestry)).collect()};
        let result=match anchor{0=>vec![&nodes[context.document]],1=>vec![main],2=>vec![&nodes[context.title.ok_or(UNSUPPORTED)?]],3=>vec![&nodes[context.entry.ok_or(UNSUPPORTED)?]],
            4=>strict(context.entry.ok_or(UNSUPPORTED)?),5=>strict(context.main),6=>strict(context.title.ok_or(UNSUPPORTED)?),7=>nodes.iter().filter(|n|n.visible==Some(true)).collect(),
            8=>nodes.iter().filter(|n|n.visible==Some(true)&&super::privacy_intersects(n.rect,main.rect)).collect(),_=>return profile_error()};
        if result.is_empty(){return profile_error();}Ok(result)
    }
    fn provider_matches(registry:&ProfileRegistry,profile:&ApprovedProfile,main:&Node)->Result<(),String>{
        if profile.revoked||profile.revision>registry.revision{return profile_error();}let group=registry.identities.iter().find(|g|g.id==profile.provider).ok_or(UNSUPPORTED)?;
        for (id,property)in [(&group.framework,30024),(&group.provider,30107)]{let catalog=registry.catalog.iter().find(|c|c.id==*id).ok_or(UNSUPPORTED)?;let observed=current_property(main,property)?;
            if observed.variant()!="BSTR"||actual_profile_value(observed)?!=catalog.values[0]{return profile_error();}}
        Ok(())
    }
    fn evaluate_profile(registry:&ProfileRegistry,profile:&ApprovedProfile,capture:&CurrentCapture,context:&ProfileContext,phase:usize,context_only:bool)->Result<(Value,Value),String>{
        provider_matches(registry,profile,&capture.nodes[context.main])?;
        let mut seen=std::collections::BTreeMap::<(Vec<i32>,i32),Value>::new();
        let mut evaluate=|selectors:&[ProfileSelector]|->Result<Value,String>{
            let mut rows=std::collections::BTreeMap::<(Vec<i32>,i32),Value>::new();let mut count=0;
            for s in selectors.iter().filter(|s|s.phase==phase){
                if context_only&&matches!(s.anchor,2|3|4|6){continue;}count+=1;
                let candidates=anchor_candidates(capture,context,s.anchor)?;if !s.every&&candidates.len()!=1{return profile_error();}
                for node in candidates {for predicate in &s.predicates {
                    let catalog:Vec<_>=registry.catalog.iter().filter(|c|c.proof&&c.id_property==predicate.id&&c.tag==predicate.tag&&c.anchor==ANCHORS[s.anchor]&&c.values.contains(&predicate.value)).collect();if catalog.len()!=1{return profile_error();}
                    let property=current_property(node,predicate.id)?;if property.variant()!=predicate.tag{return profile_error();}let actual=actual_profile_value(property)?;
                    if actual!=predicate.value{return profile_error();}let key=(node.runtime.clone(),predicate.id);
                    if seen.get(&key).is_some_and(|v|v!=&actual){return profile_error();}seen.insert(key.clone(),actual.clone());
                    let row=json!([node.runtime,predicate.id,property.variant(),profile_digest(&json!([property.variant(),actual]))?]);
                    if rows.insert(key,row).is_none()&&rows.len()>512{return profile_error();}
                }}
            }if count==0{return profile_error();}Ok(Value::Array(rows.into_values().collect()))
        };
        let positive=evaluate(&profile.positive)?;let exclusion=evaluate(&profile.exclusions)?;Ok((positive,exclusion))
    }
    fn admitted_profile<'a>(registry:&'a ProfileRegistry,capture:&CurrentCapture,context:&ProfileContext,phase:usize,context_only:bool)->Result<(&'a ApprovedProfile,Value,Value),String>{
        let mut admitted=None;
        for profile in &registry.profiles {if let Ok((positive,exclusion))=evaluate_profile(registry,profile,capture,context,phase,context_only){if admitted.is_some(){return profile_error();}admitted=Some((profile,positive,exclusion));}}
        admitted.ok_or_else(||UNSUPPORTED.into())
    }
    // Only metadata crosses the diagnostic worker boundary. All raw values are
    // dropped before returning this sealed packet to the binding owner.
    pub(crate) struct SteamDiagnosticCapture {records:Vec<DiagnosticRecord>,node_count:usize,max_depth:usize,document_count:usize}
    struct DiagnosticRecord {path:Vec<Vec<i32>>,id:i32,support:Support,variant:&'static str}
    impl SteamDiagnosticCapture {
        fn from_current(capture:CurrentCapture)->Result<Self,String>{
            capture.validate()?;
            let mut records=Vec::new();
            for node in &capture.nodes {for property in &node.properties {
                if property.id==30005 {return Err(UNSUPPORTED.into());}
                records.push(DiagnosticRecord{path:node.ancestry.iter().map(|p|p.runtime_id.clone()).collect(),id:property.id,support:property.support,variant:property.variant()});
            }}
            records.sort_by(|a,b|a.path.cmp(&b.path).then(a.id.cmp(&b.id)));
            if records.windows(2).any(|p|p[0].path==p[1].path&&p[0].id==p[1].id){return Err(UNSUPPORTED.into());}
            Ok(Self{records,node_count:capture.nodes.len(),max_depth:capture.nodes.iter().map(|n|n.ancestry.len()).max().unwrap_or(0),document_count:capture.nodes.iter().filter(|n|n.kind==50030).count()})
        }
        pub(crate) fn project(self,capture_id:&str,task_id:&str,generation:u64,observed_at:u64,guard:&dyn Fn()->Result<(),String>)->Result<Value,String>{
            guard()?;
            let valid_id=|id:&str|!id.is_empty()&&id.len()<=160&&id.bytes().all(|b|b.is_ascii_alphanumeric()||matches!(b,b'-'|b'_'|b'.'|b':'));
            if !valid_id(capture_id)||!valid_id(task_id){return Err(UNSUPPORTED.into());}
            let summary=|id:i32|{let mut counts=[0usize;4];for r in self.records.iter().filter(|r|r.id==id){counts[match r.support{Support::Supported=>0,Support::NotSupported=>1,Support::UnsupportedType=>2,Support::Error=>3}]+=1;}
                json!({"supported":counts[0],"notSupported":counts[1],"unsupportedType":counts[2],"error":counts[3]})};
            let value=json!({"schema":"edith.steam.diagnostic/1","captureId":capture_id,"taskId":task_id,"generation":generation,"observedAt":observed_at,"stable":true,
                "coverage":{"view":"raw","complete":true,"nodeCount":self.node_count,"maxDepth":self.max_depth,"documentCount":self.document_count},
                "providerSupport":{"framework":summary(30024),"provider":summary(30107)},
                "records":self.records.iter().map(|r|json!({"runtimePath":r.path,"propertyId":r.id,"support":r.support.label(),"variant":r.variant})).collect::<Vec<_>>(),"approvalState":"unsupported"});
            guard()?;Ok(value)
        }
    }
    fn now_ms()->u64 { SystemTime::now().duration_since(UNIX_EPOCH).map(|d|d.as_millis() as u64).unwrap_or(u64::MAX) }
    fn contains(a:[i32;4],b:[i32;4])->bool {
        a[0]<a[2]&&a[1]<a[3]&&b[0]<b[2]&&b[1]<b[3]&&b[0]>=a[0]&&b[1]>=a[1]&&b[2]<=a[2]&&b[3]<=a[3]
    }
    // Documented ARIA escaped key=value; grammar; no coercion or substring search.
    fn aria_properties(text:&str)->Result<Vec<(String,String)>,String> {
        if text.len()>4096 {return Err(UNSUPPORTED.into());}
        let mut pairs=Vec::new(); let mut key=String::new();let mut value=String::new();let mut in_value=false;let mut escape=false;
        for ch in text.chars().chain(std::iter::once(';')) {
            if escape {if !in_value||!matches!(ch,'\\'|'='|';'){return Err(UNSUPPORTED.into());}value.push(ch);escape=false;continue;}
            if ch=='\\' {if !in_value{return Err(UNSUPPORTED.into());}escape=true;continue;}
            if ch=='='&&!in_value {in_value=true;continue;}
            if ch==';' {
                if key.is_empty()&&value.is_empty()&&!in_value {continue;}
                if !in_value||key.is_empty()||pairs.len()>=64||pairs.iter().any(|(k,_)|k==&key){return Err(UNSUPPORTED.into());}
                pairs.push((std::mem::take(&mut key),std::mem::take(&mut value)));in_value=false;continue;
            }
            if ch=='='&&!escape {return Err(UNSUPPORTED.into());}
            if in_value {value.push(ch);}else{if !ch.is_ascii_lowercase()&&ch!='-'{return Err(UNSUPPORTED.into());}key.push(ch);}
        }
        if escape||in_value {return Err(UNSUPPORTED.into());}
        pairs.sort_by(|a,b|a.0.cmp(&b.0));Ok(pairs)
    }
    fn aria_flags(text:&str)->Result<(Option<bool>,Option<bool>),String> {
        let pairs=aria_properties(text)?;
        let flag=|wanted:&str|->Result<Option<bool>,String>{match pairs.iter().find(|(k,_)|k==wanted).map(|(_,v)|v.as_str()){
            None=>Ok(None),Some("true")=>Ok(Some(true)),Some("false")=>Ok(Some(false)),_=>Err(UNSUPPORTED.into())}};
        Ok((flag("modal")?,flag("busy")?))
    }
    fn valid_tree(nodes:&[Node])->bool {
        if nodes.is_empty()||nodes.len()>512{return false;}
        let mut seen=std::collections::BTreeSet::new();let root=&nodes[0].runtime;
        nodes.iter().all(|n|!n.runtime.is_empty()&&n.runtime.len()<=32&&seen.insert(n.runtime.clone())
            &&!n.ancestry.is_empty()&&n.ancestry.len()<=32&&n.ancestry[0].runtime_id==*root
            &&n.ancestry.last()==Some(&SteamPathNode{runtime_id:n.runtime.clone(),control_type:n.kind})
            &&n.ancestry.iter().enumerate().all(|(i,p)|!p.runtime_id.is_empty()&&p.runtime_id.len()<=32
                &&nodes.iter().any(|ancestor|ancestor.runtime==p.runtime_id&&ancestor.kind==p.control_type&&ancestor.ancestry==n.ancestry[..=i]))
            &&n.label.as_ref().is_none_or(|id|!id.is_empty()&&id.len()<=32))
    }
    fn classify(nodes:&[Node],requested:&str,client:[i32;4])->Result<RawMain,String> {
        if !valid_tree(nodes)||super::steam_name(requested)?!=requested{return Err(UNSUPPORTED.into());}
        // All visible raw nodes are coverage, including disabled/password/dialog
        // nodes excluded by public target eligibility. Unknowns never mean false.
        for n in nodes.iter().filter(|n|n.visible==Some(true)) {
            let role=n.role.as_deref().ok_or(UNSUPPORTED)?;
            if n.password!=Some(false)||n.dialog!=Some(false)||n.modal!=Some(false)||n.busy!=Some(false)
                ||matches!(role,"dialog"|"alertdialog"|"tooltip") {return Err(UNSUPPORTED.into());}
            if n.framework.as_ref().is_none_or(|s|s.is_empty())||n.provider.as_ref().is_none_or(|s|s.is_empty()) {return Err(UNSUPPORTED.into());}
            if role=="heading"&&n.heading.is_none_or(|level|!(80051..=80059).contains(&level)){return Err(UNSUPPORTED.into());}
        }
        let mains:Vec<_>=nodes.iter().filter(|n|n.visible==Some(true)&&(n.landmark==Some(80002)||n.role.as_deref()==Some("main"))).collect();
        if mains.len()!=1{return Err(UNSUPPORTED.into());}
        let main=mains[0];
        if main.landmark!=Some(80002)||main.role.as_deref()!=Some("main")||!contains(client,main.rect){return Err(UNSUPPORTED.into());}
        for (depth,path) in main.ancestry.iter().enumerate() {
            let ancestor=nodes.iter().find(|n|n.runtime==path.runtime_id).ok_or(UNSUPPORTED)?;
            if matches!(ancestor.role.as_deref(),Some("navigation"|"search"|"complementary"|"list"|"listbox"|"tree"|"menu"|"tabpanel"))
                ||matches!(ancestor.kind,50007|50008|50023|50029|50018|50019)||depth>0&&ancestor.kind==50032{return Err(UNSUPPORTED.into());}
        }
        let headings:Vec<_>=nodes.iter().filter(|n|n.visible==Some(true)&&n.ancestry.len()>main.ancestry.len()&&n.ancestry.starts_with(&main.ancestry)
            &&(n.heading==Some(80051)||n.role.as_deref()==Some("heading"))).collect();
        // A second subsection heading is allowed; only unique level1 is primary.
        let primary:Vec<_>=headings.into_iter().filter(|n|n.heading==Some(80051)).collect();
        if primary.len()!=1{return Err(UNSUPPORTED.into());}
        let title=primary[0];
        if title.role.as_deref()!=Some("heading")||main.label.as_ref()!=Some(&title.runtime)||!contains(main.rect,title.rect)
            ||title.name.as_ref().is_none_or(|s|super::steam_name(s).is_err()||ecma_trim(s)!=requested){return Err(UNSUPPORTED.into());}
        for (depth,path) in title.ancestry.iter().enumerate(){
            let ancestor=nodes.iter().find(|n|n.runtime==path.runtime_id).ok_or(UNSUPPORTED)?;
            if matches!(ancestor.role.as_deref(),Some("navigation"|"search"|"complementary"|"list"|"listbox"|"tree"|"menu"|"tabpanel"))
                ||matches!(ancestor.kind,50007|50008|50023|50029|50018|50019)||depth>0&&ancestor.kind==50032{return Err(UNSUPPORTED.into());}
        }
        let docs:Vec<_>=main.ancestry.iter().filter(|p|p.control_type==50030).collect();
        if docs.len()!=1{return Err(UNSUPPORTED.into());}
        let text=ecma_trim(title.name.as_ref().ok_or(UNSUPPORTED)?).to_owned();
        Ok(RawMain{document_runtime_id:docs[0].runtime_id.clone(),main_runtime_id:main.runtime.clone(),title_runtime_id:title.runtime.clone(),
            main_ancestry:main.ancestry.clone(),title_ancestry:title.ancestry.clone(),main_rect:main.rect,title_rect:title.rect,title:text,capture:CurrentCapture{nodes:nodes.to_vec(),client}})
    }
    fn materialize(raw:RawMain)->MaterializedMain {
        use sha2::{Digest,Sha256};let title_hash=format!("{:x}",Sha256::digest(raw.title.as_bytes()));
        let main_semantic_facts=json!(["uia-main-v1",80002,"main",false,false,false,raw.title_runtime_id]);
        let title_semantic_facts=json!(["uia-primary-heading-v1","heading",1,title_hash]);
        MaterializedMain{main:SteamMainObservation{document_runtime_id:raw.document_runtime_id,main_runtime_id:raw.main_runtime_id,title_runtime_id:raw.title_runtime_id,
            main_ancestry:raw.main_ancestry,title_ancestry:raw.title_ancestry,main_rect:raw.main_rect,title_rect:raw.title_rect,title:raw.title,
            main_semantic_facts,title_semantic_facts},capture:raw.capture}
    }
    fn approved_detail(current:MaterializedMain)->Result<SteamMainDetailObservation,String> {
        current.capture.validate()?;
        approved_detail_with_registry(current,compiled_profiles()?,None)
    }
    fn profile_is_retained(profile:&ApprovedProfile,registry:&ProfileRegistry,retained:&SteamApprovedLibraryEntry)->bool{
        profile.fingerprint==retained.profile_fingerprint&&profile.version==retained.profile_version&&profile.provider==retained.provider_identity
            &&profile.evidence==retained.evidence_set_digest&&registry.revision==retained.registry_revision
    }
    fn eligible_entry(n:&Node)->bool{n.visible==Some(true)&&n.enabled==Some(true)&&n.password==Some(false)&&matches!(n.kind,50007|50029)}
    fn approved_title_candidate(capture:&CurrentCapture,context:&ProfileContext)->Result<usize,String>{
        let main=&capture.nodes[context.main];
        let candidates:Vec<_>=capture.nodes.iter().enumerate().filter(|(_,n)|n.visible==Some(true)&&n.ancestry.len()>main.ancestry.len()&&n.ancestry.starts_with(&main.ancestry)&&n.heading==Some(80051)).collect();
        if candidates.len()!=1{return profile_error();}let(index,title)=candidates[0];
        if title.role.as_deref()!=Some("heading")||title.enabled!=Some(true)||title.password!=Some(false)||main.label.as_ref()!=Some(&title.runtime)||!contains(main.rect,title.rect){return profile_error();}
        for path in &title.ancestry{let ancestor=capture.nodes.iter().find(|n|n.runtime==path.runtime_id).ok_or(UNSUPPORTED)?;
            if matches!(ancestor.role.as_deref(),Some("navigation"|"search"|"complementary"|"list"|"listbox"|"tree"|"menu"|"tabpanel"))||matches!(ancestor.kind,50007|50008|50023|50029|50018|50019)||ancestor.ancestry.len()>1&&ancestor.kind==50032{return profile_error();}}
        Ok(index)
    }
    fn matched_entry(capture:&CurrentCapture,requested:&str,selected:bool,retained:Option<&SteamApprovedLibraryEntry>)->Result<usize,String>{
        let candidates:Vec<_>=capture.nodes.iter().enumerate().filter(|(_,n)|eligible_entry(n)).collect();
        if candidates.iter().any(|(_,n)|n.selected.is_none()||n.name.is_none()||n.control_ancestry.is_none()){return profile_error();}
        let matched:Vec<_>=candidates.iter().filter(|(_,n)|n.name.as_deref().is_some_and(|s|super::steam_name(s).is_ok()&&ecma_trim(s)==requested)).collect();
        if matched.len()!=1{return profile_error();}let(index,node)=*matched[0];
        if selected&&(node.selected!=Some(true)||candidates.iter().filter(|(_,n)|n.selected==Some(true)).count()!=1){return profile_error();}
        if let Some(r)=retained{if node.runtime!=r.entry.runtime_id||node.kind!=r.entry.target.control_type||node.control_ancestry.as_ref()!=Some(&r.entry.ancestry)
            ||[r.entry.target.x,r.entry.target.y,r.entry.target.x.checked_add(r.entry.target.width).ok_or(UNSUPPORTED)?,r.entry.target.y.checked_add(r.entry.target.height).ok_or(UNSUPPORTED)?]!=node.rect{return profile_error();}}
        Ok(index)
    }
    fn approved_detail_with_registry(current:MaterializedMain,registry:&ProfileRegistry,retained:Option<&SteamApprovedLibraryEntry>)->Result<SteamMainDetailObservation,String>{
        let mut context=semantic_context(&current.capture)?;
        context.title=current.capture.nodes.iter().position(|n|n.runtime==current.main.title_runtime_id);
        context.entry=Some(matched_entry(&current.capture,&current.main.title,true,retained)?);
        let(profile,observed_properties,exclusion_properties)=admitted_profile(registry,&current.capture,&context,1,false)?;
        if retained.is_some_and(|r|!profile_is_retained(profile,registry,r)){return profile_error();}
        Ok(SteamMainDetailObservation{main:current.main,profile_fingerprint:profile.fingerprint.clone(),profile_version:profile.version,provider_identity:profile.provider.clone(),evidence_set_digest:profile.evidence.clone(),registry_revision:registry.revision,observed_properties,exclusion_properties,_seal:()})
    }
    fn approved_library_with_registry(capture:CurrentCapture,registry:&ProfileRegistry,requested:&str,hwnd:isize,pid:u32,retained:Option<&SteamApprovedLibraryEntry>)->Result<SteamApprovedLibraryEntry,String>{
        let mut context=semantic_context(&capture)?;let(entry_index,node)= {let index=matched_entry(&capture,requested,false,retained)?;(index,&capture.nodes[index])};context.entry=Some(entry_index);
        let(profile,observed_properties,exclusion_properties)=admitted_profile(registry,&capture,&context,0,false)?;
        if retained.is_some_and(|r|!profile_is_retained(profile,registry,r)){return profile_error();}
        let target=super::LocatedTarget{target_id:retained.map_or_else(String::new,|r|r.entry.target.target_id.clone()),name:requested.to_owned(),control_type:node.kind,x:node.rect[0],y:node.rect[1],width:node.rect[2].checked_sub(node.rect[0]).ok_or(UNSUPPORTED)?,height:node.rect[3].checked_sub(node.rect[1]).ok_or(UNSUPPORTED)?,process_id:pid,hwnd};
        let document=&capture.nodes[context.document];let main=&capture.nodes[context.main];
        let path=|n:&Node|->Vec<Value>{n.ancestry.iter().map(|p|json!([p.runtime_id,p.control_type])).collect()};
        let context_identity=json!([document.runtime,path(document),document.rect,main.runtime,path(main),main.rect,capture.client,node.selected]);
        let approved=SteamApprovedLibraryEntry{entry:SteamEntryObservation{target,runtime_id:node.runtime.clone(),name:requested.to_owned(),ancestry:node.control_ancestry.clone().ok_or(UNSUPPORTED)?},profile_fingerprint:profile.fingerprint.clone(),profile_version:profile.version,provider_identity:profile.provider.clone(),evidence_set_digest:profile.evidence.clone(),registry_revision:registry.revision,observed_properties,exclusion_properties,context_identity,_seal:()};
        if retained.is_some_and(|r|!r.same_pre_context(&approved)){return profile_error();}Ok(approved)
    }
    fn selected_node<'a>(nodes:&'a [Node],runtime:&[i32],kind:i32,name:&str,path:&[SteamPathNode])->Result<&'a Node,String>{
        if !valid_tree(nodes){return Err(UNSUPPORTED.into());}
        let eligible:Vec<_>=nodes.iter().filter(|n|n.visible==Some(true)&&n.enabled==Some(true)&&n.password==Some(false)&&matches!(n.kind,50007|50029)).collect();
        if eligible.iter().any(|n|n.selected.is_none()){return Err(UNSUPPORTED.into());}
        let selected:Vec<_>=eligible.into_iter().filter(|n|n.selected==Some(true)).collect();
        if selected.len()!=1{return Err(UNSUPPORTED.into());}let node=selected[0];
        if node.runtime!=runtime||node.kind!=kind||node.name.as_ref().is_none_or(|s|super::steam_name(s).is_err()||ecma_trim(s)!=name)
            ||node.control_ancestry.as_deref()!=Some(path)||!contains(nodes[0].rect,node.rect){return Err(UNSUPPORTED.into());}
        Ok(node)
    }
    fn classify_selected(nodes:&[Node],retained:&SteamEntryObservation)->Result<SteamEntryObservation,String>{
        let node=selected_node(nodes,&retained.runtime_id,retained.target.control_type,&retained.name,&retained.ancestry)?;
        let mut current=retained.clone();current.target.name=retained.name.clone();current.target.x=node.rect[0];current.target.y=node.rect[1];
        current.target.width=node.rect[2].checked_sub(node.rect[0]).ok_or(UNSUPPORTED)?;current.target.height=node.rect[3].checked_sub(node.rect[1]).ok_or(UNSUPPORTED)?;
        Ok(current)
    }
    // Separate no-Name read packet. Never an approved profile/target constructor.
    #[derive(Clone,PartialEq,Eq)]
    struct ReadNode {runtime:Vec<i32>,path:Vec<SteamPathNode>,rect:[i32;4],properties:Vec<PropertyRecord>}
    #[derive(Clone,PartialEq,Eq)]
    struct ReadPacket {nodes:Vec<ReadNode>,client:[i32;4]}
    fn read_property(node:&ReadNode,id:i32)->Result<&PropertyRecord,String>{
        let mut values=node.properties.iter().filter(|p|p.id==id);let result=values.next().ok_or(READ_UNSUPPORTED)?;
        if values.next().is_some()||result.support!=Support::Supported||PropertyRecord::expected(id)!=result.tag||result.value.is_none(){return Err(READ_UNSUPPORTED.into());}Ok(result)
    }
    fn read_i4(node:&ReadNode,id:i32)->Result<i32,String>{match &read_property(node,id)?.value{Some(PropertyValue::I4(v))=>Ok(*v),_=>Err(READ_UNSUPPORTED.into())}}
    fn read_bool(node:&ReadNode,id:i32)->Result<bool,String>{match &read_property(node,id)?.value{Some(PropertyValue::Bool(v))=>Ok(*v),_=>Err(READ_UNSUPPORTED.into())}}
    fn read_structural_ids(kind:i32)->Vec<i32>{
        let mut ids=vec![30002,30003,30010,30019,30022,30157,30173,30174];
        if matches!(kind,50007|50029){ids.push(30079);}ids.sort_unstable();ids
    }
    fn read_bstr_ids(index:usize,main:usize)->&'static [i32]{if index==main{READ_BSTR_IDS}else{&[]}}
    fn read_main(packet:&ReadPacket)->Result<usize,String>{
        if packet.nodes.is_empty()||packet.nodes.len()>512||!contains(packet.nodes[0].rect,packet.client){return Err(READ_UNSUPPORTED.into());}
        let root=&packet.nodes[0].runtime;let pid=read_i4(&packet.nodes[0],30002)?;
        if pid<=0||read_i4(&packet.nodes[0],30003)?!=50032{return Err(READ_UNSUPPORTED.into());}
        let mut seen=std::collections::BTreeSet::new();let mut mains=Vec::new();
        for(index,node)in packet.nodes.iter().enumerate(){
            let kind=read_i4(node,30003)?;let landmark=read_i4(node,30157)?;let heading=read_i4(node,30173)?;
            if read_i4(node,30002)?!=pid||!(50000..=50040).contains(&kind)||!matches!(landmark,0|80000..=80004)||!matches!(heading,0|80050..=80059)
                ||node.runtime.is_empty()||node.runtime.len()>32||!seen.insert(node.runtime.clone())||node.path.is_empty()||node.path.len()>32
                ||node.path[0].runtime_id!=*root||node.path.last()!=Some(&SteamPathNode{runtime_id:node.runtime.clone(),control_type:kind}){return Err(READ_UNSUPPORTED.into());}
            for(depth,path)in node.path.iter().enumerate(){if !packet.nodes.iter().any(|p|p.runtime==path.runtime_id&&read_i4(p,30003)==Ok(path.control_type)&&p.path==node.path[..=depth]){return Err(READ_UNSUPPORTED.into());}}
            read_bool(node,30010)?;read_bool(node,30174)?;
            if read_bool(node,30019)?{return Err(READ_UNSUPPORTED.into());}
            let offscreen=read_bool(node,30022)?;
            if !offscreen&&!contains(packet.nodes[0].rect,node.rect){return Err(READ_UNSUPPORTED.into());}
            if matches!(kind,50007|50029){read_bool(node,30079)?;}
            if landmark==80002&&!offscreen{if kind!=50033||!contains(packet.client,node.rect){return Err(READ_UNSUPPORTED.into());}mains.push(index);}
            let actual:Vec<_>=node.properties.iter().filter(|p|!matches!(p.id,30024|30107|30101|30102)).map(|p|p.id).collect();
            if actual!=read_structural_ids(kind){return Err(READ_UNSUPPORTED.into());}
        }
        if mains.len()!=1{return Err(READ_UNSUPPORTED.into());}let main=mains[0];
        if packet.nodes[main].path.iter().filter(|p|p.control_type==50030).count()!=1
            ||packet.nodes[main].path.iter().skip(1).any(|p|matches!(p.control_type,50032|50007|50008|50023|50029|50018|50019)){return Err(READ_UNSUPPORTED.into());}
        Ok(main)
    }
    fn read_packet_ready(packet:&ReadPacket)->Result<usize,String>{
        let main=read_main(packet)?;
        for(index,node)in packet.nodes.iter().enumerate(){
            let extras:Vec<_>=node.properties.iter().filter(|p|matches!(p.id,30024|30107|30101|30102)).collect();
            if index!=main{if !extras.is_empty(){return Err(READ_UNSUPPORTED.into());}continue;}
            if extras.len()!=4{return Err(READ_UNSUPPORTED.into());}
            for id in [30024,30107,30101,30102]{match &read_property(node,id)?.value{Some(PropertyValue::Bstr(text))if read_bstr_allowed(id,text)=>{},_=>return Err(READ_UNSUPPORTED.into())}}
            if read_property(node,30101)?.value!=Some(PropertyValue::Bstr("main".into())){return Err(READ_UNSUPPORTED.into());}
        }Ok(main)
    }
    pub(crate) struct SteamReadCandidate {packet:ReadPacket,deadline:u64,observed_at:u64}
    fn read_local_nodes(packet:&ReadPacket)->Result<Vec<(usize,Vec<usize>)>,String>{
        read_packet_ready(packet)?;
        let mut children=vec![Vec::new();packet.nodes.len()];
        for(index,node)in packet.nodes.iter().enumerate().skip(1){
            let parent=node.path.get(node.path.len().checked_sub(2).ok_or(READ_UNSUPPORTED)?).ok_or(READ_UNSUPPORTED)?;
            let parent=packet.nodes.iter().position(|n|n.runtime==parent.runtime_id).ok_or(READ_UNSUPPORTED)?;
            children[parent].push(index);
        }
        let mut stack=vec![0usize];let mut local=vec![None;packet.nodes.len()];let mut result=Vec::new();
        while let Some(index)=stack.pop(){
            if local[index].is_some(){return Err(READ_UNSUPPORTED.into());}
            let id=result.len();local[index]=Some(id);let mut ancestry=Vec::new();
            for path in &packet.nodes[index].path{let raw=packet.nodes.iter().position(|n|n.runtime==path.runtime_id).ok_or(READ_UNSUPPORTED)?;ancestry.push(local[raw].ok_or(READ_UNSUPPORTED)?);}
            if ancestry.first()!=Some(&0)||ancestry.last()!=Some(&id)||!ancestry.windows(2).all(|p|p[0]<p[1]){return Err(READ_UNSUPPORTED.into());}
            result.push((index,ancestry));for child in children[index].iter().rev(){stack.push(*child);}
        }
        if result.len()!=packet.nodes.len(){return Err(READ_UNSUPPORTED.into());}Ok(result)
    }
    struct ReadProjection<'a>{read_ref:&'a str,generation:u64,state:&'a str,observed_at:u64,deadline:u64,build:&'a str}
    fn read_project_value(packet:&ReadPacket,meta:ReadProjection<'_>)->Result<Value,String>{
        let ReadProjection{read_ref,generation,state,observed_at,deadline,build}=meta;
        let reference=read_ref.strip_prefix("steam-read:").ok_or(READ_UNSUPPORTED)?;
        if !read_build_id_valid(reference)||!read_build_id_valid(build)||!(1..=7).contains(&generation)
            ||!matches!(state,"Library MAIN pre"|"DETAIL MAIN positive"|"same-root sidebar"|"same-root Properties"|"same-root settings"|"same-root overlay"|"same-root other panel")
            ||observed_at>9007199254740991||deadline>9007199254740991||observed_at<READ_ISSUED||observed_at>=deadline||deadline>READ_EXPIRES{return Err(READ_UNSUPPORTED.into());}
        let main=read_packet_ready(packet)?;let order=read_local_nodes(packet)?;let mut rows=Vec::new();
        for(node_id,(index,ancestors))in order.iter().enumerate(){for property in &packet.nodes[*index].properties{
            if property.id==30002{continue;}
            let value=match &property.value{Some(PropertyValue::Bool(v))=>json!(v),Some(PropertyValue::I4(v))=>json!(v),Some(PropertyValue::Bstr(v))if *index==main&&read_bstr_allowed(property.id,v)=>json!(v),_=>return Err(READ_UNSUPPORTED.into())};
            rows.push((node_id,property.id,json!({"nodeId":node_id,"ancestorIds":ancestors,"propertyId":property.id,"variant":property.variant(),"value":value})));
        }}
        rows.sort_by_key(|row|(row.0,row.1));let records:Vec<_>=rows.into_iter().map(|row|row.2).collect();
        let output=json!({"schema":"edith.steam.read-candidate/1","status":"candidate","readRef":read_ref,"sampleGeneration":generation,"state":state,"observedAt":observed_at,"expiresAt":deadline,
            "candidateOnly":true,"profileApproved":false,"sourcePolicySha256":READ_POLICY_HASH,"sourceContractSha256":READ_CONTRACT_HASH,"nativeBuildId":build,
            "policyId":"steam-noncontent-read-20261016-v1","policyVersion":1,"producer":"native_uia","coverage":{"complete":true,"view":"raw","nodeCount":packet.nodes.len()},"records":records});
        read_output_budget(&output)?;Ok(output)
    }
    fn read_candidate_from_scans<F:FnOnce()->u64>(first:ReadPacket,second:ReadPacket,deadline:u64,completed:F)->Result<SteamReadCandidate,String>{
        read_packet_ready(&first)?;read_packet_ready(&second)?;
        if first!=second{return Err(READ_UNSUPPORTED.into());}
        let observed_at=completed();if observed_at<READ_ISSUED||observed_at>=deadline{return Err(READ_UNSUPPORTED.into());}
        Ok(SteamReadCandidate{packet:second,deadline,observed_at})
    }
    fn read_retained_projection(candidate:&SteamReadCandidate,read_ref:&str,sample_generation:u64,state:&str,_caller_observed_at:u64,build:&str)->Result<Value,String>{
        read_project_value(&candidate.packet,ReadProjection{read_ref,generation:sample_generation,state,observed_at:candidate.observed_at,deadline:candidate.deadline,build})
    }
    impl SteamReadCandidate {
        pub(crate) fn project(self,read_ref:&str,sample_generation:u64,state:&str,observed_at:u64,guard:&dyn Fn()->Result<(),String>)->Result<Value,String>{
            read_guard(guard)?;
            let work=(||{
                let now=now_ms();steam_read_policy_deadline(now)?;let build=read_build_identity()?;
                if self.observed_at>now||now>=self.deadline{return Err(READ_UNSUPPORTED.into());}
                read_retained_projection(&self,read_ref,sample_generation,state,observed_at,build)
            })();
            let post=read_guard(guard);let output=task_read_after(work,post)?;
            let now=now_ms();steam_read_policy_deadline(now)?;if now>=self.deadline{return Err("STEAM_READ_SCOPE_EXPIRED".into());}Ok(output)
        }
    }
    pub(crate) fn steam_read_candidate_capture(hwnd:isize,pid:u32,deadline:u64,held:Arc<dyn Send+Sync>,guard:&dyn Fn()->Result<(),String>)->Result<SteamReadCandidate,String>{
        read_guard(guard)?;read_build_identity()?;let policy=steam_read_policy_deadline(now_ms())?;
        if deadline>policy||deadline<=now_ms(){return Err(READ_UNSUPPORTED.into());}
        let checked=||read_guard(guard);let started=Instant::now();
        let work=bounded_acquire(hwnd,pid,Mode::ReadCandidate(deadline),deadline,held,&checked).map_err(|error|{
            if error=="Steam MAIN worker returned no current facts"&&(now_ms()>=deadline||started.elapsed()>Duration::from_secs(2)){READ_TIMEOUT.into()}else{read_capture_error(&error)}
        });
        let post=read_guard(guard);let result=task_read_after(work,post)?;
        match result{Acquired::ReadCandidate(candidate)=>Ok(candidate),_=>Err(READ_UNSUPPORTED.into())}
    }
    fn read_capture_error(error:&str)->String{match error{"Steam MAIN original observation deadline expired"|"Steam MAIN observation cancelled or expired"=>READ_TIMEOUT.into(),"Steam MAIN original deadline expired"=>"STEAM_READ_SCOPE_EXPIRED".into(),"Steam MAIN provider worker busy"=>"STEAM_READ_BUSY".into(),_=>read_closed_error(error)}}
    fn task_read_after<T>(work:Result<T,String>,post:Result<(),String>)->Result<T,String>{
        if let Err(error)=&post{if matches!(error.as_str(),"STEAM_READ_SCOPE_CHANGED"|"STEAM_READ_SCOPE_EXPIRED"|"STEAM_READ_ENDED"){return Err(error.clone());}}
        match work{Err(error)=>Err(read_closed_error(&error)),Ok(value)=>{post.map_err(|error|read_closed_error(&error))?;Ok(value)}}
    }
    #[cfg(test)]
    mod read_candidate_tests {
        use super::*;
        fn primitive(id:i32,value:PropertyValue)->PropertyRecord{PropertyRecord{id,support:Support::Supported,tag:PropertyRecord::expected(id),value:Some(value)}}
        fn packet()->ReadPacket{
            let mut nodes:Vec<ReadNode>=Vec::new();
            for(index,kind)in [50032,50030,50033].into_iter().enumerate(){
                let runtime=vec![index as i32+1];let mut path=nodes.last().map_or_else(Vec::new,|n|n.path.clone());
                path.push(SteamPathNode{runtime_id:runtime.clone(),control_type:kind});
                let properties=read_structural_ids(kind).into_iter().map(|id|primitive(id,match id{
                    30002=>PropertyValue::I4(42),30003=>PropertyValue::I4(kind),30157=>PropertyValue::I4(if index==2{80002}else{80000}),30173=>PropertyValue::I4(80050),
                    30010=>PropertyValue::Bool(true),_=>PropertyValue::Bool(false)})).collect();
                nodes.push(ReadNode{runtime,path,rect:[0,0,1000,800],properties});
            }
            for(id,text)in [(30024,"Chrome"),(30107,"Chrome Automation Provider"),(30101,"main"),(30102,"modal=false;busy=false")]{nodes[2].properties.push(primitive(id,PropertyValue::Bstr(text.into())));}
            nodes[2].properties.sort_by_key(|p|p.id);ReadPacket{nodes,client:[0,0,1000,800]}
        }
        #[test] fn finite_policy_all_js_positive_vectors_unchanged(){
            for(id,text)in [(30024,"Chrome"),(30024,"Win32"),(30107,"Chrome Automation Provider"),(30107,"Microsoft UIA Proxy"),(30107,"Valve Steam Native Provider"),(30101,"main"),(30101,"dialog"),(30102,"modal=false;busy=false"),(30102,"busy=true;modal=false;"),(30102,"current=page;level=1;"),(30102,"")]{assert!(read_bstr_allowed(id,text));}
        }
        #[test] fn finite_policy_all_js_negative_vectors_refused(){
            for(id,text)in [(30024,"Custom user text"),(30024," chrome"),(30024,"Chrome\n"),(30107,"Chrome Provider pid 1234"),(30107,"[pid:1234,providerId:0x123] Chrome Provider"),(30107,"Chrome Provider C:/Users/example"),(30107,"Chrome Provider user@example.invalid"),(30107,"Chrome Provider v1.2"),(30107,"Chrome  Provider"),(30107,"Chrome Provider "),(30107,"Provider Proxy"),(30107,"Chrome Automation"),(30107,"Chrome Provider Unknown"),(30101,"main account"),(30102,"modal=false;account=PRIVATE_SYNTHETIC"),(30102,"modal=false;busy=false;role-description=secret"),(30102,"busy=false;busy=true"),(30102,"busy=False"),(30102,"label=PRIVATE_SYNTHETIC"),(30102,"current=custom"),(30102,"busy=false;;"),(30102,"busy=false;modal=false\\;"),(30005,"Known Public Name")]{assert!(!read_bstr_allowed(id,text));}
        }
        #[test] fn finite_classes_cover_all_frozen_words_and_aria_values(){
            for value in READ_FRAMEWORKS{assert!(read_bstr_allowed(30024,value));}
            for value in READ_ROLES{assert!(read_bstr_allowed(30101,value));}
            for word in READ_PROVIDER_WORDS{assert!(read_bstr_allowed(30107,&format!("Chrome Provider {word}")));}
            for key in ["modal","busy","readonly","expanded","selected","disabled","multiselectable","required","atomic","hidden"]{for value in ["false","true"]{assert!(read_bstr_allowed(30102,&format!("{key}={value}")));}}
            for(key,values)in [("orientation",&["horizontal","vertical"][..]),("live",&["off","polite","assertive"][..]),("current",&["false","true","page","step","location","date","time"][..]),("haspopup",&["false","true","menu","listbox","tree","grid","dialog"][..]),("level",&["1","2","3","4","5","6","7","8","9"][..])]{for value in values{assert!(read_bstr_allowed(30102,&format!("{key}={value}")));}}
            assert!(!read_bstr_allowed(30107,&"Chrome Provider ".repeat(20)));assert!(!read_bstr_allowed(30102,"modal=false; busy=false"));
        }
        #[test] fn actual_request_plan_has_no_name_and_only_main_bstr(){
            for kind in 50000..=50040{let ids=read_structural_ids(kind);assert!(!ids.contains(&30005));assert!(!ids.iter().any(|id|PropertyRecord::expected(*id)==Some(8)));assert_eq!(ids.contains(&30079),matches!(kind,50007|50029));}
            assert!(read_bstr_ids(0,2).is_empty());assert!(read_bstr_ids(1,2).is_empty());assert_eq!(read_bstr_ids(2,2),&[30024,30107,30101,30102]);
        }
        #[test] fn actual_private_packet_accepts_complete_unique_structural_main(){assert_eq!(read_packet_ready(&packet()).unwrap(),2);}
        #[test] fn actual_constructor_denies_missing_duplicate_wrong_support_type(){
            for variant in 0..5{let mut p=packet();match variant{
                0=>{p.nodes[2].properties.retain(|v|v.id!=30024);},1=>{let x=p.nodes[2].properties[0].clone();p.nodes[2].properties.push(x);},
                2=>p.nodes[2].properties[0].support=Support::NotSupported,3=>p.nodes[2].properties[0].tag=Some(8),_=>p.nodes[2].properties[0].value=Some(PropertyValue::Empty)}assert!(read_packet_ready(&p).is_err());}
        }
        #[test] fn actual_constructor_denies_extra_nonmain_text_name_and_unknown(){
            for id in [30024,30107,30101,30102,30005,99999]{let mut p=packet();p.nodes[0].properties.push(primitive(id,PropertyValue::Bstr("main".into())));p.nodes[0].properties.sort_by_key(|p|p.id);assert!(read_packet_ready(&p).is_err());}
            let mut p=packet();let v=p.nodes[2].properties.iter_mut().find(|p|p.id==30107).unwrap();v.value=Some(PropertyValue::Bstr("Chrome Provider PRIVATE_UNKNOWN".into()));assert!(read_packet_ready(&p).is_err());
        }
        #[test] fn structural_ambiguity_bounds_path_password_and_unknown_enums_deny(){
            for variant in 0..7{let mut p=packet();match variant{
                0=>p.nodes[2].rect=[-1,0,1000,800],1=>p.nodes[2].path[0].runtime_id=vec![99],2=>p.nodes[2].runtime=p.nodes[1].runtime.clone(),
                3=>p.nodes[1].properties.iter_mut().find(|v|v.id==30157).unwrap().value=Some(PropertyValue::I4(80002)),
                4=>p.nodes[1].properties.iter_mut().find(|v|v.id==30019).unwrap().value=Some(PropertyValue::Bool(true)),
                5=>p.nodes[1].properties.iter_mut().find(|v|v.id==30173).unwrap().value=Some(PropertyValue::I4(99999)),_=>p.nodes[2].path.clear()}assert!(read_packet_ready(&p).is_err());}
        }
        #[test] fn frozen_wire_explicit_zero_structural_enums_are_supported(){let mut p=packet();for node in &mut p.nodes[..2]{for property in &mut node.properties{if matches!(property.id,30157|30173){property.value=Some(PropertyValue::I4(0));}}}assert!(read_packet_ready(&p).is_ok());}
        #[test] fn actual_two_scan_constructor_observes_full_safe_aria_and_identity_drift(){
            let p=packet();assert!(read_candidate_from_scans(p.clone(),p.clone(),READ_EXPIRES,||READ_ISSUED).is_ok());
            for variant in 0..3{let mut second=p.clone();match variant{
                0=>second.nodes[2].properties.iter_mut().find(|r|r.id==30102).unwrap().value=Some(PropertyValue::Bstr("modal=false;busy=false;readonly=true".into())),
                1=>second.nodes[2].properties.iter_mut().find(|r|r.id==30107).unwrap().value=Some(PropertyValue::Bstr("Microsoft UIA Provider".into())),_=>second.nodes[2].rect[0]+=1}assert!(read_candidate_from_scans(p.clone(),second,READ_EXPIRES,||READ_ISSUED).is_err());}
        }
        #[test] fn approved_policy_original_window_and_build_identity_fail_closed(){
            assert!(steam_read_policy_deadline(READ_ISSUED-1).is_err());assert_eq!(steam_read_policy_deadline(READ_ISSUED).unwrap(),READ_EXPIRES);
            assert!(steam_read_policy_deadline(READ_EXPIRES).is_err());assert!(read_build_id_valid(&"a".repeat(64)));assert!(!read_build_id_valid(&"A".repeat(64)));assert!(!read_build_id_valid("unknown"));
        }
        #[test] fn actual_serialized_budget_exact_boundary(){assert!(read_output_budget(&json!("x".repeat(65534))).is_ok());assert!(read_output_budget(&json!("x".repeat(65535))).is_err());}
        #[test] fn failed_projection_guard_precedes_any_build_clock_or_output(){
            let candidate=SteamReadCandidate{packet:packet(),deadline:READ_EXPIRES,observed_at:READ_ISSUED};let calls=std::cell::Cell::new(0);
            let result=candidate.project("read",1,"Library MAIN pre",READ_ISSUED,&||{calls.set(calls.get()+1);Err("PRIVATE_UNKNOWN_ERROR".into())});assert_eq!(calls.get(),1);assert_eq!(result.unwrap_err(),READ_UNSUPPORTED);
        }
        #[test] fn capture_errors_and_post_denial_are_static_not_provider_text(){
            assert_eq!(task_read_after::<()>(Err("PRIVATE_PROVIDER_HRESULT".into()),Err("PRIVATE_GUARD".into())).unwrap_err(),READ_UNSUPPORTED);
            assert_eq!(task_read_after(Ok(7),Err("PRIVATE_GUARD".into())).unwrap_err(),READ_UNSUPPORTED);
            assert_eq!(task_read_after(Ok(7),Ok(())).unwrap(),7);
            assert_eq!(read_capture_error("Steam MAIN provider worker busy"),"STEAM_READ_BUSY");
            assert_eq!(read_capture_error("Steam MAIN original observation deadline expired"),READ_TIMEOUT);
            assert_eq!(task_read_after::<()>(Err(READ_TIMEOUT.into()),Ok(())).unwrap_err(),READ_TIMEOUT);
            assert_eq!(read_closed_error("PRIVATE_PROVIDER_ERROR"),READ_UNSUPPORTED);
            assert_eq!(read_closed_error("STEAM_READ_SCOPE_CHANGED"),"STEAM_READ_SCOPE_CHANGED");
            assert_eq!(task_read_after::<()>(Err(READ_TIMEOUT.into()),Err("STEAM_READ_SCOPE_CHANGED".into())).unwrap_err(),"STEAM_READ_SCOPE_CHANGED");
        }
        fn projected(packet:&ReadPacket)->Value{
            read_project_value(packet,ReadProjection{read_ref:&format!("steam-read:{}","b".repeat(64)),generation:1,state:"Library MAIN pre",observed_at:READ_ISSUED,deadline:READ_EXPIRES,build:&"a".repeat(64)}).unwrap()
        }
        #[test] fn actual_projector_exact_frozen_wire_topkeys_and_records(){
            let value=projected(&packet());let expected=["schema","status","readRef","sampleGeneration","state","observedAt","expiresAt","candidateOnly","profileApproved","sourcePolicySha256","sourceContractSha256","nativeBuildId","policyId","policyVersion","producer","coverage","records"];
            let object=value.as_object().unwrap();assert_eq!(object.len(),expected.len());assert!(expected.iter().all(|key|object.contains_key(*key)));
            assert_eq!(value["status"],"candidate");assert_eq!(value["expiresAt"],READ_EXPIRES);assert_eq!(value["candidateOnly"],true);assert_eq!(value["profileApproved"],false);
            assert_eq!(value["coverage"].as_object().unwrap().len(),3);
            let mut previous=None;
            for row in value["records"].as_array().unwrap(){let object=row.as_object().unwrap();assert_eq!(object.len(),5);assert!(["nodeId","ancestorIds","propertyId","variant","value"].iter().all(|key|object.contains_key(*key)));
                let key=(row["nodeId"].as_u64().unwrap(),row["propertyId"].as_u64().unwrap());assert!(previous.is_none_or(|old|old<key));previous=Some(key);
                assert_ne!(key.1,30002);if row["variant"]=="BSTR"{assert_eq!(key.0,2);}
            }
        }
        #[test] fn actual_local_mapping_is_dense_preorder_not_raw_breadth_first(){
            let mut p=packet();let mut sibling=p.nodes[2].clone();sibling.runtime=vec![44];sibling.path=vec![p.nodes[0].path[0].clone(),SteamPathNode{runtime_id:vec![44],control_type:50020}];
            sibling.properties.retain(|r|!matches!(r.id,30024|30107|30101|30102));
            sibling.properties.iter_mut().find(|r|r.id==30003).unwrap().value=Some(PropertyValue::I4(50020));sibling.properties.iter_mut().find(|r|r.id==30157).unwrap().value=Some(PropertyValue::I4(80000));
            p.nodes.insert(2,sibling);let order=read_local_nodes(&p).unwrap();assert_eq!(order,vec![(0,vec![0]),(1,vec![0,1]),(3,vec![0,1,2]),(2,vec![0,3])]);
            let value=projected(&p);assert_eq!(value["coverage"]["nodeCount"],4);
        }
        #[test] fn actual_projector_omits_runtime_process_geometry_and_scope_bindings(){
            let original=packet();let first=projected(&original);let mut changed=original.clone();
            for node in &mut changed.nodes{node.runtime.iter_mut().for_each(|id|*id+=7000);for path in &mut node.path{path.runtime_id.iter_mut().for_each(|id|*id+=7000);}}
            assert_eq!(first,projected(&changed));let encoded=serde_json::to_string(&first).unwrap();
            for key in ["runtimePath","runtimeId","processId","hwnd","rect","owner","sessionId","safetySessionRef","imagePath","generationEpoch"]{assert!(!encoded.contains(&format!("\"{key}\"")));}
        }
        #[test] fn actual_projector_rejects_nonclosed_ref_generation_state_and_time(){
            for variant in 0..5{let reference=format!("steam-read:{}","b".repeat(64));let mut meta=ReadProjection{read_ref:&reference,generation:1,state:"Library MAIN pre",observed_at:READ_ISSUED,deadline:READ_EXPIRES,build:&"a".repeat(64)};
                match variant{0=>meta.read_ref="steam-read:FORGED",1=>meta.generation=8,2=>meta.state="PRIVATE_UNKNOWN",3=>meta.observed_at=READ_EXPIRES,_=>meta.deadline=9007199254740992};assert!(read_project_value(&packet(),meta).is_err());}
        }
        #[test] fn actual_native_completion_time_cannot_be_replaced_by_caller(){
            let calls=std::cell::Cell::new(0);let p=packet();
            let candidate=read_candidate_from_scans(p.clone(),p,READ_EXPIRES,||{calls.set(calls.get()+1);READ_ISSUED+1}).unwrap();assert_eq!(calls.get(),1);
            let reference=format!("steam-read:{}","b".repeat(64));let build="a".repeat(64);
            let first=read_retained_projection(&candidate,&reference,1,"Library MAIN pre",0,&build).unwrap();
            let second=read_retained_projection(&candidate,&reference,1,"Library MAIN pre",u64::MAX,&build).unwrap();
            assert_eq!(first,second);assert_eq!(first["observedAt"],READ_ISSUED+1);
            let mut changed=packet();changed.nodes[2].rect[0]+=1;
            assert!(read_candidate_from_scans(packet(),changed,READ_EXPIRES,||{calls.set(calls.get()+1);READ_ISSUED}).is_err());assert_eq!(calls.get(),1);
        }
    }
    enum Mode { Main(String),Selected(SteamEntryObservation),Diagnostic,Library(String),LibraryRevalidate(SteamApprovedLibraryEntry),ApprovedDetail(SteamApprovedLibraryEntry),ReadCandidate(u64) }
    enum Acquired { Main(MaterializedMain),Selected(SteamEntryObservation),Diagnostic(SteamDiagnosticCapture),Library(SteamApprovedLibraryEntry),ApprovedDetail(SteamMainDetailObservation),ReadCandidate(SteamReadCandidate) }
    struct SelectiveLease{entry:SteamApprovedLibraryEntry,identity:crate::native_calculator_identity::NativeWindowIdentity,deadline:u64,generation:u64,held:Arc<dyn Send+Sync>}
    static SELECTIVE_LEASES:std::sync::Mutex<Vec<SelectiveLease>>=std::sync::Mutex::new(Vec::new());
    pub(super) fn clear_selective_targets(){if let Ok(mut leases)=SELECTIVE_LEASES.lock(){leases.clear();}}
    pub(crate) fn steam_approved_library_context(hwnd:isize,pid:u32,requested:&str,deadline:u64,held:Arc<dyn Send+Sync>,guard:&dyn Fn()->Result<(),String>)->Result<SteamApprovedLibraryEntry,String>{
        let requested=super::steam_name(requested)?.to_owned();match bounded_acquire(hwnd,pid,Mode::Library(requested),deadline,held,guard)?{Acquired::Library(entry)=>Ok(entry),_=>profile_error()}
    }
    pub(crate) fn steam_approved_library_entry(hwnd:isize,pid:u32,requested:&str,deadline:u64,held:Arc<dyn Send+Sync>,guard:&dyn Fn()->Result<(),String>)->Result<SteamApprovedLibraryEntry,String>{
        let requested=super::steam_name(requested)?.to_owned();let generation=super::GENERATION.load(Ordering::SeqCst);
        let identity=crate::native_calculator_identity::observe(hwnd,pid)?;guard()?;
        let result=bounded_acquire(hwnd,pid,Mode::Library(requested),deadline,Arc::clone(&held),guard)?;guard()?;
        let Acquired::Library(mut entry)=result else{return profile_error();};crate::native_calculator_identity::revalidate(&identity)?;
        let path:Vec<Value>=entry.entry.ancestry.iter().map(|p|json!([p.runtime_id,p.control_type])).collect();
        let digest=profile_digest(&json!([entry.entry.runtime_id,entry.entry.name,path,entry.entry.target.x,entry.entry.target.y,entry.entry.target.width,entry.entry.target.height,entry.profile_fingerprint]))?;
        entry.entry.target.target_id=format!("steam-uia:{generation}:{digest}");
        let mut leases=SELECTIVE_LEASES.lock().map_err(|_|UNSUPPORTED)?;if generation!=super::GENERATION.load(Ordering::SeqCst){return profile_error();}
        leases.retain(|r|r.deadline>now_ms()&&r.generation==generation);if leases.len()>=64||leases.iter().any(|r|r.entry.entry.target.target_id==entry.entry.target.target_id){return profile_error();}
        leases.push(SelectiveLease{entry:entry.clone(),identity,deadline:deadline.min(now_ms().saturating_add(15000)),generation,held});drop(leases);guard()?;Ok(entry)
    }
    pub(crate) fn steam_revalidate_library_entry(hwnd:isize,pid:u32,retained:&SteamApprovedLibraryEntry,deadline:u64,held:Arc<dyn Send+Sync>,guard:&dyn Fn()->Result<(),String>)->Result<SteamApprovedLibraryEntry,String>{
        if retained.entry.target.hwnd!=hwnd||retained.entry.target.process_id!=pid{return profile_error();}
        validate_retained_selective(retained)?;
        validate_selective_target(&retained.entry.target.target_id,hwnd,pid)?;
        let checked=||{guard()?;validate_selective_target(&retained.entry.target.target_id,hwnd,pid).map(|_|())};
        let result=bounded_acquire(hwnd,pid,Mode::LibraryRevalidate(retained.clone()),deadline,held,&checked)?;
        checked()?;match result{Acquired::Library(entry)=>Ok(entry),_=>profile_error()}
    }
    pub(crate) fn steam_approved_main_detail(hwnd:isize,pid:u32,retained:&SteamApprovedLibraryEntry,deadline:u64,held:Arc<dyn Send+Sync>,guard:&dyn Fn()->Result<(),String>)->Result<SteamMainDetailObservation,String>{
        if retained.entry.target.hwnd!=hwnd||retained.entry.target.process_id!=pid{return profile_error();}
        validate_retained_selective(retained)?;
        validate_selective_target(&retained.entry.target.target_id,hwnd,pid)?;
        let checked=||{guard()?;validate_selective_target(&retained.entry.target.target_id,hwnd,pid).map(|_|())};
        let result=bounded_acquire(hwnd,pid,Mode::ApprovedDetail(retained.clone()),deadline,held,&checked)?;
        checked()?;match result{Acquired::ApprovedDetail(detail)=>Ok(detail),_=>profile_error()}
    }
    fn validate_retained_selective(retained:&SteamApprovedLibraryEntry)->Result<(),String>{
        let leases=SELECTIVE_LEASES.lock().map_err(|_|UNSUPPORTED)?;
        let original=&leases.iter().find(|r|r.entry.entry.target.target_id==retained.entry.target.target_id).ok_or(UNSUPPORTED)?.entry;
        if !original.same_pre_context(retained)||original.entry.runtime_id!=retained.entry.runtime_id||original.entry.name!=retained.entry.name||original.entry.ancestry!=retained.entry.ancestry
            ||original.observed_properties!=retained.observed_properties||original.exclusion_properties!=retained.exclusion_properties
            ||serde_json::to_value(&original.entry.target).map_err(|_|UNSUPPORTED)?!=serde_json::to_value(&retained.entry.target).map_err(|_|UNSUPPORTED)?{return profile_error();}Ok(())
    }
    pub(super) fn validate_selective_target(id:&str,hwnd:isize,pid:u32)->Result<super::LocatedTarget,String>{
        let(entry,identity,deadline,generation,_held)={let leases=SELECTIVE_LEASES.lock().map_err(|_|UNSUPPORTED)?;let r=leases.iter().find(|r|r.entry.entry.target.target_id==id).ok_or(UNSUPPORTED)?;(r.entry.clone(),r.identity.clone(),r.deadline,r.generation,Arc::clone(&r.held))};
        // This is only the private issued-lease check. The workflow performs
        // fresh semantic revalidation after authority HTTP and before input.
        if entry.entry.target.hwnd!=hwnd||entry.entry.target.process_id!=pid||now_ms()>=deadline||super::GENERATION.load(Ordering::SeqCst)!=generation{return profile_error();}
        crate::native_calculator_identity::revalidate(&identity)?;Ok(entry.entry.target)
    }
    static WORKER_ACTIVE:AtomicBool=AtomicBool::new(false);
    pub(crate) fn steam_main_worker_quiescent()->bool { !WORKER_ACTIVE.load(Ordering::SeqCst) }
    pub(crate) fn steam_main_detail(hwnd:isize,pid:u32,requested_name:&str,original_deadline_ms:u64,
        keep_alive:Arc<dyn Send+Sync>,guard:&dyn Fn()->Result<(),String>)->Result<SteamMainDetailObservation,String> {
        let name=super::steam_name(requested_name)?.to_owned();
        match bounded_acquire(hwnd,pid,Mode::Main(name),original_deadline_ms,keep_alive,guard)?{
            Acquired::Main(main)=>approved_detail(main),_=>Err(UNSUPPORTED.into())}
    }
    pub(crate) fn steam_diagnostic_capture(hwnd:isize,pid:u32,original_deadline_ms:u64,
        keep_alive:Arc<dyn Send+Sync>,guard:&dyn Fn()->Result<(),String>)->Result<SteamDiagnosticCapture,String>{
        match bounded_acquire(hwnd,pid,Mode::Diagnostic,original_deadline_ms,keep_alive,guard)? {
            Acquired::Diagnostic(capture)=>Ok(capture),_=>Err(UNSUPPORTED.into())}
    }
    pub(crate) fn steam_selected_game_entry(hwnd:isize,pid:u32,retained:&SteamEntryObservation,original_deadline_ms:u64,
        keep_alive:Arc<dyn Send+Sync>,guard:&dyn Fn()->Result<(),String>)->Result<SteamEntryObservation,String>{
        if retained.target.hwnd!=hwnd||retained.target.process_id!=pid{return Err(UNSUPPORTED.into());}
        match bounded_acquire(hwnd,pid,Mode::Selected(retained.clone()),original_deadline_ms,keep_alive,guard)?{
            Acquired::Selected(entry)=>Ok(entry),_=>Err(UNSUPPORTED.into())}
    }
    trait LifecycleClock:Clone+Send+Sync+'static {
        fn now_ms(&self)->u64;
        fn start(self)->Self;
        fn elapsed(&self)->Duration;
    }
    #[derive(Clone)]
    struct RealLifecycleClock(Option<Instant>);
    impl LifecycleClock for RealLifecycleClock {
        fn now_ms(&self)->u64{now_ms()}
        fn start(self)->Self{Self(Some(Instant::now()))}
        fn elapsed(&self)->Duration{self.0.as_ref().map_or(Duration::ZERO,Instant::elapsed)}
    }
    fn bounded_acquire(hwnd:isize,pid:u32,mode:Mode,original_deadline_ms:u64,
        keep_alive:Arc<dyn Send+Sync>,guard:&dyn Fn()->Result<(),String>)->Result<Acquired,String> {
        let generation=super::GENERATION.load(Ordering::SeqCst);
        worker_lifecycle(original_deadline_ms,keep_alive,guard,RealLifecycleClock(None),move|budget|{
            budget()?;let identity=crate::native_calculator_identity::observe(hwnd,pid)?;budget()?;
            if identity.content.is_some(){return Err(UNSUPPORTED.into());}
            let check=||->Result<(),String>{budget()?;if generation!=super::GENERATION.load(Ordering::SeqCst){return profile_error();}crate::native_calculator_identity::revalidate(&identity)};
            check()?;let facts=acquire(&identity,&mode,&check)?;check()?;Ok(facts)
        })
    }
    // The production provider and controlled fixtures use this exact lifecycle.
    // Clock injection changes neither the captured deadline nor worker ownership.
    fn worker_lifecycle<T,C,F>(original_deadline_ms:u64,keep_alive:Arc<dyn Send+Sync>,
        guard:&dyn Fn()->Result<(),String>,clock:C,provider:F)->Result<T,String>
    where T:Send+'static,C:LifecycleClock,F:FnOnce(&dyn Fn()->Result<(),String>)->Result<T,String>+Send+'static {
        guard()?;
        if clock.now_ms()>=original_deadline_ms{return Err("Steam MAIN original deadline expired".into());}
        if WORKER_ACTIVE.compare_exchange(false,true,Ordering::SeqCst,Ordering::SeqCst).is_err(){return Err("Steam MAIN provider worker busy".into());}
        let cancellation=Arc::new(AtomicBool::new(false));let worker_cancel=Arc::clone(&cancellation);
        let (sender,receiver)=std::sync::mpsc::sync_channel(1);let clock=clock.start();
        let worker_clock=clock.clone();
        let worker=std::thread::Builder::new().name("edith-steam-main".into()).spawn(move||{
            struct Slot;impl Drop for Slot{fn drop(&mut self){WORKER_ACTIVE.store(false,Ordering::SeqCst);}}
            let _slot=Slot;let _held_root=keep_alive;let clock=worker_clock;
            let budget=||->Result<(),String>{if worker_cancel.load(Ordering::SeqCst)||clock.now_ms()>=original_deadline_ms||clock.elapsed()>Duration::from_secs(2){Err("Steam MAIN observation cancelled or expired".into())}else{Ok(())}};
            let result=provider(&budget);
            if budget().is_ok(){let _=sender.send(result);}
        });
        let worker=match worker{Ok(worker)=>worker,Err(_)=>{WORKER_ACTIVE.store(false,Ordering::SeqCst);return Err("Steam MAIN worker unavailable".into());}};
        loop {
            if let Err(error)=guard(){cancellation.store(true,Ordering::SeqCst);return Err(error);}
            if clock.now_ms()>=original_deadline_ms||clock.elapsed()>Duration::from_secs(2){cancellation.store(true,Ordering::SeqCst);return Err("Steam MAIN original observation deadline expired".into());}
            match receiver.recv_timeout(Duration::from_millis(10)) {
                Ok(value)=>{
                    // Provider work has returned before send. Join its finite
                    // cleanup so sequential same-scope scans don't race Slot Drop.
                    worker.join().map_err(|_|"Steam MAIN worker failed")?;
                    guard()?;if clock.now_ms()>=original_deadline_ms||clock.elapsed()>Duration::from_secs(2){return Err("Steam MAIN original observation deadline expired".into());}
                    return value;
                },
                Err(std::sync::mpsc::RecvTimeoutError::Timeout)=>{},
                Err(_)=>{cancellation.store(true,Ordering::SeqCst);return Err("Steam MAIN worker returned no current facts".into());}
            }
        }
    }
    #[cfg(test)]
    mod lifecycle_tests {
        use super::*;
        use std::sync::{Mutex,mpsc::{self,Sender,Receiver},atomic::AtomicU64};
        static SERIAL:Mutex<()>=Mutex::new(());
        #[derive(Clone)]
        struct Clock {wall:Arc<AtomicU64>,elapsed:Arc<AtomicU64>}
        impl Clock {fn new()->Self{Self{wall:Arc::new(AtomicU64::new(100)),elapsed:Arc::new(AtomicU64::new(0))}}}
        impl LifecycleClock for Clock {
            fn now_ms(&self)->u64{self.wall.load(Ordering::SeqCst)}
            fn start(self)->Self{self}
            fn elapsed(&self)->Duration{Duration::from_millis(self.elapsed.load(Ordering::SeqCst))}
        }
        struct Record {name:&'static str,events:Arc<Mutex<Vec<(&'static str,bool)>>>}
        impl Drop for Record {fn drop(&mut self){self.events.lock().unwrap().push((self.name,!steam_main_worker_quiescent()));}}
        fn quiet(){let began=Instant::now();while !steam_main_worker_quiescent(){assert!(began.elapsed()<Duration::from_secs(3),"controlled provider did not clean up");std::thread::yield_now();}}
        struct Running {
            release:Option<Sender<()>>,result:Receiver<Result<u32,String>>,caller:Option<std::thread::JoinHandle<()>>,
            events:Arc<Mutex<Vec<(&'static str,bool)>>>,completed:Arc<AtomicBool>,
        }
        impl Running {
            fn start(clock:Clock,stop:Arc<AtomicBool>,panic_provider:bool)->Self{
                let (entered_send,entered)=mpsc::sync_channel(1);let (release,gate)=mpsc::channel();let (send,result)=mpsc::sync_channel(1);
                let events=Arc::new(Mutex::new(Vec::new()));let held=Arc::new(Record{name:"held",events:events.clone()});let provider_events=events.clone();
                let completed=Arc::new(AtomicBool::new(false));let provider_completed=completed.clone();
                let caller=std::thread::spawn(move||{
                    let result=worker_lifecycle(1000,held,&||if stop.load(Ordering::SeqCst){Err("controlled STOP".into())}else{Ok(())},clock,move|_budget|{
                        let _resource=Record{name:"provider",events:provider_events};
                        entered_send.send(()).unwrap();
                        gate.recv_timeout(Duration::from_secs(2)).expect("controlled provider release gate");
                        provider_completed.store(true,Ordering::SeqCst);
                        if panic_provider{panic!("controlled provider panic");}
                        Ok(41)
                    });let _=send.send(result);
                });
                let mut running=Self{release:Some(release),result,caller:Some(caller),events,completed};
                if entered.recv_timeout(Duration::from_secs(2)).is_err(){running.release();panic!("controlled provider never entered");}
                running
            }
            fn release(&mut self){if let Some(release)=self.release.take(){let _=release.send(());}}
            fn result(&self)->Result<u32,String>{self.result.recv_timeout(Duration::from_secs(2)).expect("bounded controlled caller result")}
            fn assert_retained(&self){assert!(!steam_main_worker_quiescent());assert!(!self.completed.load(Ordering::SeqCst));assert!(self.events.lock().unwrap().is_empty());}
            fn finish(&mut self){self.release();if let Some(caller)=self.caller.take(){caller.join().unwrap();}quiet();assert!(self.completed.load(Ordering::SeqCst));assert_eq!(*self.events.lock().unwrap(),vec![("provider",true),("held",true)]);}
        }
        // Unwinding a failed fixture always releases the provider gate and waits
        // for bounded cleanup before releasing SERIAL to another actual-slot test.
        impl Drop for Running {fn drop(&mut self){self.release();if let Some(caller)=self.caller.take(){let _=caller.join();}quiet();}}
        #[test] fn lifecycle_concurrent_rejection_uses_actual_global_slot(){
            let _serial=SERIAL.lock().unwrap_or_else(|e|e.into_inner());quiet();
            let mut running=Running::start(Clock::new(),Arc::new(AtomicBool::new(false)),false);running.assert_retained();
            let calls=Arc::new(AtomicU64::new(0));let provider_calls=calls.clone();
            let rejected=worker_lifecycle(1000,Arc::new(()),&||Ok(()),Clock::new(),move|_|{provider_calls.fetch_add(1,Ordering::SeqCst);Ok(9)});
            assert!(rejected.unwrap_err().contains("busy"));assert_eq!(calls.load(Ordering::SeqCst),0);
            running.release();assert_eq!(running.result().unwrap(),41);running.finish();
        }
        #[test] fn lifecycle_stop_cancels_caller_retains_worker_and_denies_late_facts(){
            let _serial=SERIAL.lock().unwrap_or_else(|e|e.into_inner());quiet();let stop=Arc::new(AtomicBool::new(false));
            let mut running=Running::start(Clock::new(),stop.clone(),false);running.assert_retained();stop.store(true,Ordering::SeqCst);
            assert_eq!(running.result().unwrap_err(),"controlled STOP");running.assert_retained();running.finish();
        }
        #[test] fn lifecycle_monotonic_timeout_retains_until_actual_return(){
            let _serial=SERIAL.lock().unwrap_or_else(|e|e.into_inner());quiet();let clock=Clock::new();
            let mut running=Running::start(clock.clone(),Arc::new(AtomicBool::new(false)),false);running.assert_retained();
            clock.elapsed.store(2001,Ordering::SeqCst);assert!(running.result().unwrap_err().contains("deadline expired"));
            running.assert_retained();running.finish();
        }
        #[test] fn lifecycle_captured_wall_deadline_cannot_be_extended(){
            let _serial=SERIAL.lock().unwrap_or_else(|e|e.into_inner());quiet();let clock=Clock::new();
            let mut running=Running::start(clock.clone(),Arc::new(AtomicBool::new(false)),false);
            clock.wall.store(1000,Ordering::SeqCst);assert!(running.result().unwrap_err().contains("deadline expired"));running.assert_retained();
            // A later clock reset cannot reopen the consumed original caller/channel.
            clock.wall.store(100,Ordering::SeqCst);running.finish();
        }
        #[test] fn lifecycle_success_drops_provider_and_held_before_slot_release(){
            let _serial=SERIAL.lock().unwrap_or_else(|e|e.into_inner());quiet();
            let mut running=Running::start(Clock::new(),Arc::new(AtomicBool::new(false)),false);running.assert_retained();
            running.release();assert_eq!(running.result().unwrap(),41);assert!(steam_main_worker_quiescent());running.finish();
        }
        #[test] fn lifecycle_panic_drops_provider_and_held_before_slot_release(){
            let _serial=SERIAL.lock().unwrap_or_else(|e|e.into_inner());quiet();
            let mut running=Running::start(Clock::new(),Arc::new(AtomicBool::new(false)),true);running.assert_retained();
            running.release();assert!(running.result().is_err());running.finish();
        }
        #[test] fn lifecycle_sequential_success_has_no_false_busy(){
            let _serial=SERIAL.lock().unwrap_or_else(|e|e.into_inner());quiet();
            for expected in 0..3{assert_eq!(worker_lifecycle(1000,Arc::new(()),&||Ok(()),Clock::new(),move|budget|{budget()?;Ok(expected)}).unwrap(),expected);assert!(steam_main_worker_quiescent());}
        }
        #[test] fn lifecycle_expired_admission_never_starts_provider(){
            let _serial=SERIAL.lock().unwrap_or_else(|e|e.into_inner());quiet();let clock=Clock::new();clock.wall.store(1000,Ordering::SeqCst);
            let called=Arc::new(AtomicBool::new(false));let provider_called=called.clone();
            assert!(worker_lifecycle(1000,Arc::new(()),&||Ok(()),clock,move|_|{provider_called.store(true,Ordering::SeqCst);Ok(1)}).unwrap_err().contains("deadline expired"));
            assert!(!called.load(Ordering::SeqCst));assert!(steam_main_worker_quiescent());
        }
    }
    #[cfg(not(windows))]
    fn acquire(_: &crate::native_calculator_identity::NativeWindowIdentity,_:&Mode,_:&dyn Fn()->Result<(),String>)->Result<Acquired,String>{Err(UNSUPPORTED.into())}
    #[cfg(windows)]
    fn acquire(identity:&crate::native_calculator_identity::NativeWindowIdentity,mode:&Mode,guard:&dyn Fn()->Result<(),String>)->Result<Acquired,String> {
        use windows::Win32::{UI::Accessibility::*,Foundation::HWND,System::{Com::{CoInitializeEx,CoUninitialize,CoCreateInstance,CLSCTX_INPROC_SERVER,COINIT_MULTITHREADED,SAFEARRAY},
            Ole::{SafeArrayDestroy,SafeArrayGetDim,SafeArrayGetElemsize,SafeArrayGetLBound,SafeArrayGetUBound,SafeArrayGetElement},Variant::{VARIANT,VT_BSTR,VT_BOOL,VT_I4}}};
        use windows_sys::Win32::{Foundation::{RECT,POINT,HWND as SysHwnd},Graphics::Gdi::ClientToScreen,
            UI::{WindowsAndMessaging::GetClientRect,HiDpi::{GetThreadDpiAwarenessContext,GetAwarenessFromDpiAwarenessContext,DPI_AWARENESS_PER_MONITOR_AWARE}}};
        fn api(_:windows::core::Error)->String { "Steam MAIN native provider unavailable".into() }
        struct Apartment;impl Drop for Apartment{fn drop(&mut self){unsafe{CoUninitialize();}}}
        struct Runtime(*mut SAFEARRAY);impl Drop for Runtime{fn drop(&mut self){unsafe{let _=SafeArrayDestroy(self.0);}}}
        fn runtime(element:&IUIAutomationElement)->Result<Vec<i32>,String>{unsafe{
            let array=Runtime(element.GetRuntimeId().map_err(api)?);
            if array.0.is_null()||SafeArrayGetDim(array.0)!=1||SafeArrayGetElemsize(array.0)!=4{return Err(UNSUPPORTED.into());}
            let lo=SafeArrayGetLBound(array.0,1).map_err(api)?;let hi=SafeArrayGetUBound(array.0,1).map_err(api)?;
            if hi<lo||i64::from(hi)-i64::from(lo)>=32{return Err(UNSUPPORTED.into());}
            let mut values=Vec::new();for i in lo..=hi{let mut v=0i32;SafeArrayGetElement(array.0,&i,&mut v as *mut _ as *mut core::ffi::c_void).map_err(api)?;values.push(v);}Ok(values)
        }}
        fn optional(value:windows::core::Result<IUIAutomationElement>)->Result<Option<IUIAutomationElement>,String>{match value{
            Ok(value)=>Ok(Some(value)),Err(error)if error.code()==windows::core::Error::empty().code()=>Ok(None),Err(error)=>Err(api(error))}}
        // All reads are support-aware; exact variant tags exclude BYREF, default
        // substitutions, coercions and malformed provider values.
        fn prop(a:&IUIAutomation,e:&IUIAutomationElement,id:UIA_PROPERTY_ID,guard:&dyn Fn()->Result<(),String>)->Result<Option<VARIANT>,String>{
            guard()?;let v=unsafe{e.GetCurrentPropertyValueEx(id,true).map_err(api)?};guard()?;
            let unsupported=unsafe{a.CheckNotSupported(&v).map_err(api)?};guard()?;
            if unsupported.as_bool(){Ok(None)}else{Ok(Some(v))}
        }
        fn text(a:&IUIAutomation,e:&IUIAutomationElement,id:UIA_PROPERTY_ID,guard:&dyn Fn()->Result<(),String>)->Result<Option<String>,String>{
            let Some(v)=prop(a,e,id,guard)?else{return Ok(None)};
            if v.vt()!=VT_BSTR{return Err(UNSUPPORTED.into());}
            // Exact VT_BSTR was checked above. Borrow its owned BSTR without
            // coercion or an extra StructuredStorage dependency; VARIANT Drop
            // retains sole ownership and clears it on every return.
            let bstr: &windows::core::BSTR=unsafe{&*v.Anonymous.Anonymous.Anonymous.bstrVal};
            if bstr.len()>4096{return Err(UNSUPPORTED.into());}
            let string=String::from_utf16(bstr).map_err(|_|UNSUPPORTED)?;
            if string.len()>4096{return Err(UNSUPPORTED.into());}Ok(Some(string))
        }
        fn boolean(a:&IUIAutomation,e:&IUIAutomationElement,id:UIA_PROPERTY_ID,guard:&dyn Fn()->Result<(),String>)->Result<Option<bool>,String>{
            let Some(v)=prop(a,e,id,guard)?else{return Ok(None)};
            if v.vt()!=VT_BOOL{return Err(UNSUPPORTED.into());}
            let raw=unsafe{v.Anonymous.Anonymous.Anonymous.boolVal.0};
            match raw {0=>Ok(Some(false)),-1=>Ok(Some(true)),_=>Err(UNSUPPORTED.into())}
        }
        fn integer(a:&IUIAutomation,e:&IUIAutomationElement,id:UIA_PROPERTY_ID,guard:&dyn Fn()->Result<(),String>)->Result<Option<i32>,String>{
            let Some(v)=prop(a,e,id,guard)?else{return Ok(None)};
            if v.vt()!=VT_I4{return Err(UNSUPPORTED.into());}Ok(Some(i32::try_from(&v).map_err(api)?))
        }
        fn captured(a:&IUIAutomation,e:&IUIAutomationElement,id:UIA_PROPERTY_ID,guard:&dyn Fn()->Result<(),String>)->Result<PropertyRecord,String>{
            guard()?;
            let v=unsafe{e.GetCurrentPropertyValueEx(id,true).map_err(api)?};guard()?;
            let tag=v.vt().0;
            let not_supported=unsafe{a.CheckNotSupported(&v).map_err(api)?.as_bool()};guard()?;
            if not_supported {return Ok(PropertyRecord{id:id.0,support:Support::NotSupported,tag:Some(tag),value:None});}
            let value=match tag {
                0=>Some(PropertyValue::Empty),
                11=>{let raw=unsafe{v.Anonymous.Anonymous.Anonymous.boolVal.0};match raw{0=>Some(PropertyValue::Bool(false)),-1=>Some(PropertyValue::Bool(true)),_=>return Err(UNSUPPORTED.into())}},
                3=>Some(PropertyValue::I4(i32::try_from(&v).map_err(api)?)),
                8=>{
                    let bstr:&windows::core::BSTR=unsafe{&*v.Anonymous.Anonymous.Anonymous.bstrVal};
                    if bstr.len()>4096{return Err(UNSUPPORTED.into());}
                    let text=String::from_utf16(bstr).map_err(|_|UNSUPPORTED)?;
                    if text.len()>4096{return Err(UNSUPPORTED.into());}Some(PropertyValue::Bstr(text))
                },
                // No unsafe coercion/comparison of opaque COM values. This
                // cannot establish a complete two-scan value packet.
                _=>None,
            };
            let support=if tag==0||PropertyRecord::expected(id.0)==Some(tag){Support::Supported}else{Support::UnsupportedType};
            let record=PropertyRecord{id:id.0,support,tag:Some(tag),value};
            if !record.validate(){return Err(UNSUPPORTED.into());}Ok(record)
        }
        fn client(hwnd:isize,guard:&dyn Fn()->Result<(),String>)->Result<[i32;4],String>{
            guard()?;
            if unsafe{GetAwarenessFromDpiAwarenessContext(GetThreadDpiAwarenessContext())}!=DPI_AWARENESS_PER_MONITOR_AWARE{return Err(UNSUPPORTED.into());}
            let mut r=RECT::default();if unsafe{GetClientRect(hwnd as SysHwnd,&mut r)}==0{return Err(UNSUPPORTED.into());}
            let mut first=POINT{x:r.left,y:r.top};let mut last=POINT{x:r.right,y:r.bottom};
            if unsafe{ClientToScreen(hwnd as SysHwnd,&mut first)}==0||unsafe{ClientToScreen(hwnd as SysHwnd,&mut last)}==0{return Err(UNSUPPORTED.into());}
            guard()?;let result=[first.x,first.y,last.x,last.y];if !contains(result,result){return Err(UNSUPPORTED.into());}Ok(result)
        }
        guard()?;unsafe{CoInitializeEx(None,COINIT_MULTITHREADED).ok().map_err(api)?;}let _apartment=Apartment;
        let automation:IUIAutomation=unsafe{CoCreateInstance(&CUIAutomation,None,CLSCTX_INPROC_SERVER).map_err(api)?};guard()?;
        let handle=HWND(identity.root_hwnd as *mut core::ffi::c_void);
        let walker=unsafe{automation.RawViewWalker().map_err(api)?};guard()?;
        if let Mode::ReadCandidate(deadline)=mode {
            // This branch never executes the general scanner's text requests.
            // Inventory structural primitives first; no UIA Name/Value/Text,
            // caption, or non-MAIN BSTR is requested, even transiently.
            let primitive=|element:&IUIAutomationElement,id:i32|->Result<PropertyRecord,String>{
                let value=match PropertyRecord::expected(id){
                    Some(3)=>PropertyValue::I4(integer(&automation,element,UIA_PROPERTY_ID(id),guard)?.ok_or(READ_UNSUPPORTED)?),
                    Some(11)=>PropertyValue::Bool(boolean(&automation,element,UIA_PROPERTY_ID(id),guard)?.ok_or(READ_UNSUPPORTED)?),
                    _=>return Err(READ_UNSUPPORTED.into())};
                Ok(PropertyRecord{id,support:Support::Supported,tag:PropertyRecord::expected(id),value:Some(value)})
            };
            let scan_read=||->Result<ReadPacket,String>{
                guard()?;steam_read_policy_deadline(now_ms())?;
                let actual_client=client(identity.root_hwnd,guard)?;
                let root=unsafe{automation.ElementFromHandle(handle).map_err(api)?};guard()?;
                if unsafe{root.CurrentNativeWindowHandle().map_err(api)?}!=handle{return Err(READ_UNSUPPORTED.into());}
                let mut pending=vec![(root,Vec::<SteamPathNode>::new())];let mut nodes:Vec<ReadNode>=Vec::new();let mut index=0;
                while index<pending.len(){
                    guard()?;let(element,mut path)=pending[index].clone();index+=1;
                    if nodes.len()>=512||path.len()>=32{return Err(READ_UNSUPPORTED.into());}
                    let process=primitive(&element,30002)?;
                    if process.value!=Some(PropertyValue::I4(identity.root_pid as i32)){return Err(READ_UNSUPPORTED.into());}
                    let runtime=runtime(&element)?;guard()?;
                    let kind=integer(&automation,&element,UIA_ControlTypePropertyId,guard)?.ok_or(READ_UNSUPPORTED)?;
                    if nodes.iter().any(|n|n.runtime==runtime){return Err(READ_UNSUPPORTED.into());}
                    path.push(SteamPathNode{runtime_id:runtime.clone(),control_type:kind});
                    let rect=unsafe{element.CurrentBoundingRectangle().map_err(api)?};guard()?;
                    let mut properties=vec![process,PropertyRecord{id:30003,support:Support::Supported,tag:Some(3),value:Some(PropertyValue::I4(kind))}];
                    for id in read_structural_ids(kind).into_iter().filter(|id|!matches!(*id,30002|30003)){properties.push(primitive(&element,id)?);}
                    properties.sort_by_key(|p|p.id);
                    nodes.push(ReadNode{runtime,path:path.clone(),rect:[rect.left,rect.top,rect.right,rect.bottom],properties});
                    let mut child=optional(unsafe{walker.GetFirstChildElement(&element)})?;guard()?;
                    while let Some(current)=child{
                        if pending.len()>=512{return Err(READ_UNSUPPORTED.into());}
                        child=optional(unsafe{walker.GetNextSiblingElement(&current)})?;guard()?;
                        pending.push((current,path.clone()));
                    }
                }
                let mut packet=ReadPacket{nodes,client:actual_client};
                let main=read_main(&packet)?;
                let element=&pending[main].0;
                for &id in read_bstr_ids(main,main){
                    guard()?;let value=text(&automation,element,UIA_PROPERTY_ID(id),guard)?.ok_or(READ_UNSUPPORTED)?;
                    if !read_bstr_allowed(id,&value){return Err(READ_UNSUPPORTED.into());}
                    packet.nodes[main].properties.push(PropertyRecord{id,support:Support::Supported,tag:Some(8),value:Some(PropertyValue::Bstr(value))});
                }
                packet.nodes[main].properties.sort_by_key(|p|p.id);
                // Recheck original structural facts after the permitted text reads.
                for(index,node)in packet.nodes.iter().enumerate(){
                    let element=&pending[index].0;guard()?;
                    if runtime(element)?!=node.runtime{return Err(READ_UNSUPPORTED.into());}guard()?;
                    let rect=unsafe{element.CurrentBoundingRectangle().map_err(api)?};guard()?;
                    if [rect.left,rect.top,rect.right,rect.bottom]!=node.rect{return Err(READ_UNSUPPORTED.into());}
                    for property in node.properties.iter().filter(|p|!matches!(p.id,30024|30107|30101|30102)){
                        if primitive(element,property.id)?!=*property{return Err(READ_UNSUPPORTED.into());}
                    }
                }
                if client(identity.root_hwnd,guard)?!=packet.client{return Err(READ_UNSUPPORTED.into());}
                read_packet_ready(&packet)?;guard()?;Ok(packet)
            };
            let first=scan_read()?;let second=scan_read()?;guard()?;
            let candidate=read_candidate_from_scans(first,second,*deadline,now_ms)?;
            steam_read_policy_deadline(now_ms())?;if now_ms()>=*deadline{return Err(READ_UNSUPPORTED.into());}
            return Ok(Acquired::ReadCandidate(candidate));
        }
        let control=unsafe{automation.ControlViewWalker().map_err(api)?};guard()?;
        let scan=||->Result<(Vec<Node>,[i32;4]),String>{
            let actual_client=client(identity.root_hwnd,guard)?;
            let root=unsafe{automation.ElementFromHandle(handle).map_err(api)?};guard()?;
            if unsafe{root.CurrentNativeWindowHandle().map_err(api)?}!=handle{return Err(UNSUPPORTED.into());}
            let mut pending=vec![(root.clone(),Vec::<SteamPathNode>::new())];let mut nodes=Vec::new();let mut index=0;let mut strings=0usize;
            let mut references:Vec<(Vec<i32>,IUIAutomationElement)>=Vec::new();
            while index<pending.len(){
                guard()?;let(e,mut ancestry)=pending[index].clone();index+=1;
                if ancestry.len()>=32||nodes.len()>=512{return Err(UNSUPPORTED.into());}
                let mut properties=Vec::new();
                macro_rules! read {($id:expr,$method:ident)=>{{
                    let property=captured(&automation,&e,$id,guard)?;
                    let value=property.$method();properties.push(property);
                    if matches!(mode,Mode::Diagnostic){value.unwrap_or(None)}else{value?}
                }}}
                if read!(UIA_ProcessIdPropertyId,integer)!=Some(identity.root_pid as i32){return Err(UNSUPPORTED.into());}
                let rt=runtime(&e)?;guard()?;if nodes.iter().any(|n:&Node|n.runtime==rt){return Err(UNSUPPORTED.into());}
                let kind=read!(UIA_ControlTypePropertyId,integer).ok_or(UNSUPPORTED)?;
                ancestry.push(SteamPathNode{runtime_id:rt.clone(),control_type:kind});
                let r=unsafe{e.CurrentBoundingRectangle().map_err(api)?};guard()?;
                let visible=read!(UIA_IsOffscreenPropertyId,boolean).map(|v|!v);
                let password=read!(UIA_IsPasswordPropertyId,boolean);
                let role=read!(UIA_AriaRolePropertyId,text);
                let flags=read!(UIA_AriaPropertiesPropertyId,text);
                let aria=flags.as_deref().map(aria_properties).transpose()?;
                let(modal,busy)=match flags.as_ref(){Some(v)=>if matches!(mode,Mode::Diagnostic){aria_flags(v).unwrap_or((None,None))}else{aria_flags(v)?},None=>(None,None)};
                let heading=read!(UIA_HeadingLevelPropertyId,integer);
                // Only relevant header names are read; whole Steam/account labels
                // or Value/Text patterns never enter this observer.
                let enabled=read!(UIA_IsEnabledPropertyId,boolean);
                if !matches!(mode,Mode::Diagnostic)&&(visible.is_none()||password.is_none()||enabled.is_none()){return Err(UNSUPPORTED.into());}
                let selected=if matches!(kind,50007|50029)||matches!(mode,Mode::Library(_)|Mode::LibraryRevalidate(_)|Mode::ApprovedDetail(_)){read!(UIA_SelectionItemIsSelectedPropertyId,boolean)}else{None};
                let name=if visible==Some(true)&&password==Some(false)&&(matches!(mode,Mode::Main(_))&&(role.as_deref()==Some("heading")||heading==Some(80051))
                    ||matches!(mode,Mode::Selected(_))&&selected==Some(true)&&matches!(kind,50007|50029))
                    {read!(UIA_NamePropertyId,text)}else{None};
                // Retained entry paths came from ControlView. Walk that actual
                // view only for selected entries; RawView remains inventory.
                let control_ancestry=if matches!(mode,Mode::Selected(_))&&selected==Some(true)&&matches!(kind,50007|50029){
                    let mut path=Vec::new();let mut current=e.clone();
                    loop {
                        guard()?;if path.len()>=32{return Err(UNSUPPORTED.into());}
                        if integer(&automation,&current,UIA_ProcessIdPropertyId,guard)?!=Some(identity.root_pid as i32){return Err(UNSUPPORTED.into());}
                        let id=runtime(&current)?;guard()?;
                        if path.iter().any(|p:&SteamPathNode|p.runtime_id==id){return Err(UNSUPPORTED.into());}
                        let control_type=integer(&automation,&current,UIA_ControlTypePropertyId,guard)?.ok_or(UNSUPPORTED)?;
                        path.push(SteamPathNode{runtime_id:id,control_type});
                        let at_root=unsafe{automation.CompareElements(&current,&root).map_err(api)?.as_bool()};guard()?;
                        if at_root{break;}
                        current=optional(unsafe{control.GetParentElement(&current)})?.ok_or(UNSUPPORTED)?;guard()?;
                    }
                    path.reverse();Some(path)
                }else{None};
                let framework=read!(UIA_FrameworkIdPropertyId,text);
                let provider=read!(UIA_ProviderDescriptionPropertyId,text);
                for s in [&role,&flags,&name,&framework,&provider].into_iter().flatten(){strings=strings.checked_add(s.len()).ok_or(UNSUPPORTED)?;}
                if strings>262144{return Err(UNSUPPORTED.into());}
                let label=if role.as_deref()==Some("main") {
                    let label=optional(unsafe{e.CurrentLabeledBy()})?;guard()?;
                    if let Some(reference)=label {let id=runtime(&reference)?;guard()?;references.push((rt.clone(),reference));Some(id)}else{None}
                }else{None};
                let landmark=read!(UIA_LandmarkTypePropertyId,integer);
                let dialog=read!(UIA_IsDialogPropertyId,boolean);
                properties.sort_by_key(|property|property.id);
                nodes.push(Node{runtime:rt,ancestry:ancestry.clone(),kind,rect:[r.left,r.top,r.right,r.bottom],visible,password,
                    role,landmark,heading,dialog,modal,busy,label,name,framework,provider,enabled,selected,control_ancestry,properties,aria});
                let mut child=optional(unsafe{walker.GetFirstChildElement(&e)})?;guard()?;
                while let Some(current)=child{
                    guard()?;if pending.len()>=512{return Err(UNSUPPORTED.into());}
                    child=optional(unsafe{walker.GetNextSiblingElement(&current)})?;guard()?;
                    pending.push((current,ancestry.clone()));
                }
            }
            for (main_id,reference) in references {
                let mut matched=None;
                for (i,(candidate,_)) in pending.iter().enumerate() {
                    guard()?;let equal=unsafe{automation.CompareElements(&reference,candidate).map_err(api)?.as_bool()};guard()?;
                    if equal {if matched.is_some(){return Err(UNSUPPORTED.into());}matched=Some(nodes[i].runtime.clone());}
                }
                if matched.is_none()||nodes.iter().find(|n|n.runtime==main_id).and_then(|n|n.label.as_ref())!=matched.as_ref(){return Err(UNSUPPORTED.into());}
            }
            CurrentCapture{nodes:nodes.clone(),client:actual_client}.validate()?;
            let selective=match mode{Mode::Library(_)=>Some((0,None)),Mode::LibraryRevalidate(r)=>Some((0,Some(r))),Mode::ApprovedDetail(r)=>Some((1,Some(r))),_=>None};
            if let Some((phase,retained))=selective{
                // No Name has been read in these modes. Admit the complete
                // context and exclusions before granting the narrow capability.
                let registry=compiled_profiles()?;
                let before=CurrentCapture{nodes:nodes.clone(),client:actual_client};
                let context=semantic_context(&before)?;
                let(profile,_,_)=admitted_profile(registry,&before,&context,phase,true)?;
                if retained.is_some_and(|r|!profile_is_retained(profile,registry,r)){return profile_error();}
                let title_index=if phase==1{Some(approved_title_candidate(&before,&context)?)}else{None};
                let admitted=profile.fingerprint.clone();guard()?;
                let recheck_context=|nodes:&[Node]|->Result<(),String>{
                    for (index,node) in nodes.iter().enumerate(){
                        guard()?;let element=&pending[index].0;
                        if runtime(element)?!=node.runtime{return profile_error();}
                        let rect=unsafe{element.CurrentBoundingRectangle().map_err(api)?};guard()?;
                        if [rect.left,rect.top,rect.right,rect.bottom]!=node.rect{return profile_error();}
                        for record in node.properties.iter().filter(|p|p.id!=30005){if captured(&automation,element,UIA_PROPERTY_ID(record.id),guard)?!=*record{return profile_error();}}
                        if node.role.as_deref()==Some("main"){
                            let reference=optional(unsafe{element.CurrentLabeledBy()})?;guard()?;
                            let current=reference.as_ref().map(runtime).transpose()?;guard()?;
                            if current!=node.label{return profile_error();}
                            if let(Some(reference),Some(id))=(reference.as_ref(),current.as_ref()){
                                let label_index=nodes.iter().position(|n|&n.runtime==id).ok_or(UNSUPPORTED)?;
                                if !unsafe{automation.CompareElements(reference,&pending[label_index].0).map_err(api)?.as_bool()}{return profile_error();}guard()?;
                            }
                        }
                    }
                    if client(identity.root_hwnd,guard)?!=actual_client{return profile_error();}guard()
                };
                for i in 0..nodes.len(){
                    let entry=eligible_entry(&nodes[i]);
                    let title=title_index==Some(i);
                    if !entry&&!title{continue;}
                    recheck_context(&nodes)?;guard()?;let e=&pending[i].0;
                    let name=captured(&automation,e,UIA_NamePropertyId,guard)?;
                    nodes[i].name=name.text()?;nodes[i].properties.push(name);
                    if entry{
                        let mut path=Vec::new();let mut current=e.clone();
                        loop{
                            guard()?;if path.len()>=32{return profile_error();}
                            let rt=runtime(&current)?;guard()?;
                            if path.iter().any(|p:&SteamPathNode|p.runtime_id==rt){return profile_error();}
                            let process=captured(&automation,&current,UIA_ProcessIdPropertyId,guard)?;
                            let kind=captured(&automation,&current,UIA_ControlTypePropertyId,guard)?;
                            if process.integer()?!=Some(identity.root_pid as i32){return profile_error();}
                            // ControlView nodes must correlate to this complete
                            // RawView packet, including repeated typed reads.
                            let raw=nodes.iter().find(|n|n.runtime==rt).ok_or(UNSUPPORTED)?;
                            if current_property(raw,30002)?!=&process||current_property(raw,30003)?!=&kind{return profile_error();}
                            let control_type=kind.integer()?.ok_or(UNSUPPORTED)?;
                            path.push(SteamPathNode{runtime_id:rt,control_type});
                            let root_match=unsafe{automation.CompareElements(&current,&root).map_err(api)?.as_bool()};guard()?;
                            if root_match{break;}
                            current=optional(unsafe{control.GetParentElement(&current)})?.ok_or(UNSUPPORTED)?;guard()?;
                        }
                        path.reverse();nodes[i].control_ancestry=Some(path);
                    }
                    nodes[i].properties.sort_by_key(|p|p.id);recheck_context(&nodes)?;guard()?;
                }
                // Recheck actual context records after all permitted Name reads;
                // the second complete scan independently repeats the capability.
                recheck_context(&nodes)?;
                let after=CurrentCapture{nodes:nodes.clone(),client:actual_client};after.validate()?;
                let context=semantic_context(&after)?;let(profile,_,_)=admitted_profile(registry,&after,&context,phase,true)?;
                if profile.fingerprint!=admitted||retained.is_some_and(|r|!profile_is_retained(profile,registry,r)){return profile_error();}guard()?;
            }
            guard()?;Ok((nodes,actual_client))
        };
        let first=scan()?;let second=scan()?;guard()?;
        if first!=second{return Err("Steam MAIN provider facts changed during acquisition".into());}
        match mode {Mode::Main(name)=>classify(&second.0,name,second.1).map(materialize).map(Acquired::Main),
            Mode::Selected(retained)=>classify_selected(&second.0,retained).map(Acquired::Selected),
            Mode::Diagnostic=>SteamDiagnosticCapture::from_current(CurrentCapture{nodes:second.0,client:second.1}).map(Acquired::Diagnostic),
            Mode::Library(name)=>approved_library_with_registry(CurrentCapture{nodes:second.0,client:second.1},compiled_profiles()?,name,identity.root_hwnd,identity.root_pid,None).map(Acquired::Library),
            Mode::LibraryRevalidate(r)=>approved_library_with_registry(CurrentCapture{nodes:second.0,client:second.1},compiled_profiles()?,&r.entry.name,identity.root_hwnd,identity.root_pid,Some(r)).map(Acquired::Library),
            Mode::ApprovedDetail(r)=>{let raw=classify(&second.0,&r.entry.name,second.1)?;approved_detail_with_registry(materialize(raw),compiled_profiles()?,Some(r)).map(Acquired::ApprovedDetail)},
            Mode::ReadCandidate(_)=>Err(READ_UNSUPPORTED.into())}
    }
    #[cfg(test)]
    mod profile_construction_tests {
        use super::*;
        const GOLDEN:&str=r#"["edith.steam.detail-profile/1",1,"sim-provider",[["pre_library","main","exactly_one",[[30102,"BSTR","eq","sim-library"]]],["post_detail","main","exactly_one",[[30102,"BSTR","eq","sim-game-detail"]]]],[["pre_library","every_visible","every",[[30019,"BOOL","eq",false],[30022,"BOOL","eq",false]]],["post_detail","every_visible","every",[[30019,"BOOL","eq",false],[30022,"BOOL","eq",false]]]],"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]"#;
        const LIBRARY:&str="busy=false;modal=false;page=library";
        const DETAIL:&str="busy=false;modal=false;page=detail";
        fn definition()->Value{let mut d=profile_json(GOLDEN).unwrap();d[3][0][3][0][3]=json!(LIBRARY);d[3][1][3][0][3]=json!(DETAIL);d}
        fn registry_value()->Value{
            let definition=definition();let fingerprint=profile_digest(&definition).unwrap();
            json!({"schema":"edith.steam.detail-profile-registry/1","revision":1,
                "privacyCatalog":[
                    {"id":"framework","propertyId":30024,"variant":"BSTR","allowedValues":["SIM_FRAMEWORK_PRIVATE"],"anchor":"main","proofAllowed":false},
                    {"id":"offscreen","propertyId":30022,"variant":"BOOL","allowedValues":[false],"anchor":"every_visible","proofAllowed":true},
                    {"id":"page","propertyId":30102,"variant":"BSTR","allowedValues":[DETAIL,LIBRARY],"anchor":"main","proofAllowed":true},
                    {"id":"password","propertyId":30019,"variant":"BOOL","allowedValues":[false],"anchor":"every_visible","proofAllowed":true},
                    {"id":"provider","propertyId":30107,"variant":"BSTR","allowedValues":["SIM_PROVIDER_PRIVATE"],"anchor":"main","proofAllowed":false}],
                "providerIdentities":[{"id":"sim-provider","anchor":"main","frameworkCatalogId":"framework","providerCatalogId":"provider"}],
                "profiles":[{"approval":{"domain":PROFILE_DOMAIN,"fingerprint":fingerprint,"version":1,"providerIdentity":"sim-provider","evidenceSetDigest":"a".repeat(64),"approvedRevision":1,"revoked":false},"canonicalDefinition":definition}]})
        }
        fn registry()->ProfileRegistry{parse_profile_registry(&registry_value().to_string()).unwrap()}
        fn set_property(node:&mut Node,id:i32,value:PropertyValue){
            let tag=match &value{PropertyValue::Bool(_)=>11,PropertyValue::I4(_)=>3,PropertyValue::Bstr(_)=>8,PropertyValue::Empty=>0};
            let record=PropertyRecord{id,support:Support::Supported,tag:Some(tag),value:Some(value)};
            if let Some(p)=node.properties.iter_mut().find(|p|p.id==id){*p=record;}else{node.properties.push(record);node.properties.sort_by_key(|p|p.id);}
        }
        fn packet(page:&str,names:bool,selected:bool)->CurrentCapture{
            let mut capture=capture_tests::fixture_packet();
            for node in &mut capture.nodes{
                node.framework=Some("SIM_FRAMEWORK_PRIVATE".into());node.provider=Some("SIM_PROVIDER_PRIVATE".into());
                node.name=None;node.aria=Some(aria_properties(page).unwrap());set_property(node,30102,PropertyValue::Bstr(page.into()));
                if matches!(node.kind,50007|50029){node.selected=Some(selected);set_property(node,30079,PropertyValue::Bool(selected));}
            }
            if names{
                let indices=if page==LIBRARY{vec![4usize]}else{vec![3usize,4]};
                for index in indices{capture.nodes[index].name=Some("A".into());set_property(&mut capture.nodes[index],30005,PropertyValue::Bstr("A".into()));}
                capture.nodes[4].control_ancestry=Some(vec![capture.nodes[0].ancestry[0].clone(),capture.nodes[4].ancestry.last().unwrap().clone()]);
            }
            capture
        }
        fn library(capture:CurrentCapture,r:&ProfileRegistry)->Result<SteamApprovedLibraryEntry,String>{approved_library_with_registry(capture,r,"A",1,1,None)}
        fn detail(capture:CurrentCapture,r:&ProfileRegistry,pre:Option<&SteamApprovedLibraryEntry>)->Result<SteamMainDetailObservation,String>{
            let raw=classify(&capture.nodes,"A",capture.client)?;approved_detail_with_registry(materialize(raw),r,pre)
        }
        fn reject_registry(mut edit:impl FnMut(&mut Value)){let mut v=registry_value();edit(&mut v);assert!(parse_profile_registry(&v.to_string()).is_err());}
        #[test] fn canonical_golden_458_bytes_exact_sha(){let value=profile_json(GOLDEN).unwrap();assert_eq!(serde_json::to_vec(&value).unwrap().len(),458);assert_eq!(profile_digest(&value).unwrap(),"4104f491096837e53d1a722a8381cad22cb4a05bd2b46b2bf3a4067978a47b4c");assert!(profile_definition(&value).is_ok());}
        #[test] fn strict_raw_duplicates_escaped_aliases_and_numeric_spellings(){for text in [r#"{"a":1,"a":2}"#,r#"{"a":1,"\u0061":2}"#,"-0","1.0","1e0","1E1","2147483648.0"]{assert!(profile_json(text).is_err());}assert!(profile_json("-2147483648").is_ok());assert!(profile_i4(&json!(2147483648i64)).is_err());}
        #[test] fn raw_value_token_and_depth_budget_matches_shared_parser(){let within=format!("[{}]",vec!["true";39999].join(","));assert!(profile_json(&within).is_ok());let over=format!("[{}]",vec!["true";40000].join(","));assert!(profile_json(&over).is_err());assert!(profile_json(&format!("{}{}","[".repeat(21),"]".repeat(21))).is_ok());assert!(profile_json(&format!("{}{}","[".repeat(22),"]".repeat(22))).is_err());}
        #[test] fn closed_schema_and_bounds(){reject_registry(|v|v["extra"]=json!(false));reject_registry(|v|v["schema"]=json!("other"));reject_registry(|v|v["revision"]=json!(0));reject_registry(|v|v["profiles"][0]["approval"]["extra"]=json!(0));assert!(profile_json(&"[".repeat(21)).is_err());assert!(profile_json(&" ".repeat(262145)).is_err());}
        #[test] fn strict_catalog_order_types_and_aliases(){reject_registry(|v|v["privacyCatalog"].as_array_mut().unwrap().swap(0,1));reject_registry(|v|v["privacyCatalog"][1]["allowedValues"]=json!(["false"]));reject_registry(|v|v["privacyCatalog"][2]["allowedValues"]=json!([LIBRARY,DETAIL]));reject_registry(|v|v["privacyCatalog"][2]["allowedValues"]=json!(["é"]));reject_registry(|v|v["privacyCatalog"][2]["propertyId"]=json!(30005));reject_registry(|v|v["privacyCatalog"][2]["proofAllowed"]=json!(false));}
        #[test] fn provider_identity_exact_singleton_not_proof_or_alias(){reject_registry(|v|v["privacyCatalog"][0]["proofAllowed"]=json!(true));reject_registry(|v|v["privacyCatalog"][0]["allowedValues"]=json!(["A","B"]));reject_registry(|v|v["providerIdentities"][0]["providerCatalogId"]=json!("framework"));reject_registry(|v|{let mut g=v["providerIdentities"][0].clone();g["id"]=json!("sim-provider-z");v["providerIdentities"].as_array_mut().unwrap().push(g);});}
        #[test] fn canonical_approval_digest_revision_and_type_mismatch(){reject_registry(|v|v["profiles"][0]["approval"]["fingerprint"]=json!("0".repeat(64)));reject_registry(|v|v["profiles"][0]["approval"]["version"]=json!(2));reject_registry(|v|v["profiles"][0]["approval"]["approvedRevision"]=json!(2));reject_registry(|v|v["profiles"][0]["approval"]["revoked"]=json!("false"));reject_registry(|v|v["profiles"][0]["canonicalDefinition"][3][0][3][0][1]=json!("BOOL"));}
        #[test] fn selector_order_phase_and_structural_only_context_refused(){let mut d=definition();d[3].as_array_mut().unwrap().swap(0,1);assert!(profile_definition(&d).is_err());let mut d=definition();d[3][0][1]=json!("title");assert!(profile_definition(&d).is_err());let mut d=definition();d[3][0][3]=json!([[30003,"I4","eq",50033]]);assert!(profile_definition(&d).is_err());}
        #[test] fn context_admission_without_any_name_and_unselected_entry(){let r=registry();let capture=packet(LIBRARY,false,false);assert!(capture.nodes.iter().all(|n|n.name.is_none()&&n.properties.iter().all(|p|p.id!=30005)));let context=semantic_context(&capture).unwrap();assert!(admitted_profile(&r,&capture,&context,0,true).is_ok());assert!(library(packet(LIBRARY,true,false),&r).is_ok());}
        #[test] fn real_sealed_pre_post_same_profile_and_actual_proofs(){let r=registry();let pre=library(packet(LIBRARY,true,false),&r).unwrap();let post=detail(packet(DETAIL,true,true),&r,Some(&pre)).unwrap();assert_eq!(pre.profile_fingerprint,post.profile_fingerprint);assert_eq!(post.profile_version,1);let row=&pre.observed_properties[0];assert_eq!(row[0],json!([3]));assert_eq!(row[1],30102);assert_eq!(row[3],profile_digest(&json!(["BSTR",LIBRARY])).unwrap());assert_eq!(pre.exclusion_properties.as_array().unwrap().len(),10);}
        #[test] fn properties_same_title_and_structure_reaches_evaluator_and_denies(){let r=registry();let capture=packet("busy=false;modal=false;page=properties",true,true);assert!(classify(&capture.nodes,"A",capture.client).is_ok());assert!(detail(capture,&r,None).is_err());}
        #[test] fn settings_store_overlay_sidebar_other_panel_same_title_denied_by_evaluator(){let r=registry();for page in ["settings","store","overlay","sidebar","other-panel"]{let flags=format!("busy=false;modal=false;page={page}");let capture=packet(&flags,true,true);assert!(classify(&capture.nodes,"A",capture.client).is_ok());let mut context=semantic_context(&capture).unwrap();context.title=Some(3);context.entry=Some(4);assert!(evaluate_profile(&r,&r.profiles[0],&capture,&context,1,false).is_err());assert!(detail(capture,&r,None).is_err());}}
        #[test] fn compiled_empty_registry_never_issues_approved_capture(){let r=compiled_profiles().unwrap();assert!(r.profiles.is_empty());assert!(library(packet(LIBRARY,true,false),r).is_err());assert!(detail(packet(DETAIL,true,true),r,None).is_err());}
        #[test] fn full_provider_and_framework_value_mismatch_deny(){for id in [30024,30107]{let mut p=packet(LIBRARY,true,false);let n=&mut p.nodes[2];set_property(n,id,PropertyValue::Bstr("SIM_OTHER".into()));if id==30024{n.framework=Some("SIM_OTHER".into())}else{n.provider=Some("SIM_OTHER".into())}assert!(library(p,&registry()).is_err());}}
        #[test] fn support_empty_wrongtype_never_default_or_hash(){for support in [Support::NotSupported,Support::UnsupportedType,Support::Error]{let mut p=packet(LIBRARY,true,false);let record=p.nodes[2].properties.iter_mut().find(|p|p.id==30102).unwrap();record.support=support;assert!(library(p,&registry()).is_err());}let mut p=packet(LIBRARY,true,false);set_property(&mut p.nodes[2],30102,PropertyValue::Empty);p.nodes[2].aria=None;assert!(library(p,&registry()).is_err());}
        #[test] fn structural_visible_coverage_independent_of_profile_predicates(){for index in 0..5{for flag in 0..5{let mut p=packet(LIBRARY,true,false);match flag{0=>p.nodes[index].enabled=Some(false),1=>p.nodes[index].password=Some(true),2=>p.nodes[index].dialog=Some(true),3=>p.nodes[index].modal=Some(true),_=>p.nodes[index].busy=Some(true)}assert!(library(p,&registry()).is_err());}}}
        #[test] fn unknown_coverage_duplicate_runtime_and_main_deny(){let mut p=packet(LIBRARY,true,false);p.nodes[0].visible=None;assert!(library(p,&registry()).is_err());let mut p=packet(LIBRARY,true,false);p.nodes.push(p.nodes[2].clone());assert!(library(p,&registry()).is_err());let mut p=packet(LIBRARY,true,false);p.nodes[4].role=Some("main".into());set_property(&mut p.nodes[4],30101,PropertyValue::Bstr("main".into()));assert!(library(p,&registry()).is_err());}
        #[test] fn selection_original_entry_path_rect_and_profile_pins(){let r=registry();let pre=library(packet(LIBRARY,true,false),&r).unwrap();assert!(detail(packet(DETAIL,true,false),&r,Some(&pre)).is_err());let mut p=packet(DETAIL,true,true);p.nodes[4].rect[0]+=1;assert!(detail(p,&r,Some(&pre)).is_err());let mut p=packet(DETAIL,true,true);p.nodes[4].control_ancestry=None;assert!(detail(p,&r,Some(&pre)).is_err());let mut changed=registry();changed.revision=2;assert!(detail(packet(DETAIL,true,true),&changed,Some(&pre)).is_err());}
        #[test] fn revived_or_ambiguous_approval_never_admits(){let mut r=registry();r.profiles[0].revoked=true;assert!(library(packet(LIBRARY,true,false),&r).is_err());let mut r=registry();r.profiles.push(r.profiles[0].clone());assert!(library(packet(LIBRARY,true,false),&r).is_err());}
        #[test] fn candidate_resolution_nonempty_before_filter_and_exactly_one(){let r=registry();let capture=packet(LIBRARY,true,false);let mut context=semantic_context(&capture).unwrap();context.entry=None;assert!(anchor_candidates(&capture,&context,3).is_err());let mut r=registry();r.profiles[0].positive[0].anchor=7;assert!(evaluate_profile(&r,&r.profiles[0],&capture,&context,0,false).is_err());}
        #[test] fn full_capture_equality_includes_unselected_and_nonpredicate_values(){let first=packet(LIBRARY,true,false);let mut second=first.clone();second.nodes[4].selected=Some(true);set_property(&mut second.nodes[4],30079,PropertyValue::Bool(true));assert!(first!=second);let mut second=first.clone();second.nodes[0].aria=Some(aria_properties("busy=false;modal=false;page=library;extra=x").unwrap());set_property(&mut second.nodes[0],30102,PropertyValue::Bstr("busy=false;modal=false;page=library;extra=x".into()));assert!(first!=second);}
        #[test] fn out_of_root_geometry_and_unsupported_selection_deny(){let mut p=packet(LIBRARY,true,false);p.nodes[4].rect[0]=-1;assert!(library(p,&registry()).is_err());let mut p=packet(LIBRARY,true,false);p.nodes[4].selected=None;assert!(library(p,&registry()).is_err());}
        #[test] fn preselection_and_actual_context_proof_drift_denied(){let r=registry();let pre=library(packet(LIBRARY,true,false),&r).unwrap();let p=packet(LIBRARY,true,true);assert!(approved_library_with_registry(p,&r,"A",1,1,Some(&pre)).is_err());let mut p=packet(LIBRARY,true,false);p.nodes[2].rect[0]+=1;assert!(approved_library_with_registry(p,&r,"A",1,1,Some(&pre)).is_err());let mut p=packet(LIBRARY,true,false);for node in &mut p.nodes{if node.runtime==vec![3]{node.runtime=vec![33];}for path in &mut node.ancestry{if path.runtime_id==vec![3]{path.runtime_id=vec![33];}}}assert!(approved_library_with_registry(p,&r,"A",1,1,Some(&pre)).is_err());let mut p=packet(LIBRARY,true,false);for node in &mut p.nodes{if node.runtime==vec![2]{node.runtime=vec![22];}for path in &mut node.ancestry{if path.runtime_id==vec![2]{path.runtime_id=vec![22];}}}assert!(approved_library_with_registry(p,&r,"A",1,1,Some(&pre)).is_err());}
        #[test] fn title_capability_unrelated_heading_never_selected_and_ambiguity_denies(){let mut p=packet(DETAIL,false,true);let mut unrelated=p.nodes[3].clone();unrelated.runtime=vec![6];unrelated.ancestry=p.nodes[1].ancestry.clone();unrelated.ancestry.push(SteamPathNode{runtime_id:vec![6],control_type:unrelated.kind});unrelated.rect=[20,100,200,130];p.nodes.push(unrelated);let context=semantic_context(&p).unwrap();let chosen=approved_title_candidate(&p,&context).unwrap();assert_eq!(chosen,3);assert!(p.nodes.iter().all(|n|n.name.is_none()));let mut duplicate=p.nodes[3].clone();duplicate.runtime=vec![7];duplicate.ancestry.last_mut().unwrap().runtime_id=vec![7];p.nodes.push(duplicate);assert!(approved_title_candidate(&p,&semantic_context(&p).unwrap()).is_err());}
        #[test] fn password_candidate_never_gets_name_capability(){let mut p=packet(LIBRARY,false,false);p.nodes[4].password=Some(true);set_property(&mut p.nodes[4],30019,PropertyValue::Bool(true));assert!(!eligible_entry(&p.nodes[4]));assert!(semantic_context(&p).is_err());assert!(p.nodes.iter().all(|n|n.name.is_none()));}
        #[test] fn actual_proof_rows_signed_runtime_order_and_union(){let mut p=packet(LIBRARY,true,false);for node in &mut p.nodes{if node.runtime==vec![5]{node.runtime=vec![-5];}for path in &mut node.ancestry{if path.runtime_id==vec![5]{path.runtime_id=vec![-5];}}}let r=registry();let context=semantic_context(&p).unwrap();let(_,rows)=evaluate_profile(&r,&r.profiles[0],&p,&context,0,true).unwrap();assert_eq!(rows[0][0],json!([-5]));assert_eq!(rows[0][1],30019);assert_eq!(rows[1][1],30022);assert_eq!(rows[0][3],profile_digest(&json!(["BOOL",false])).unwrap());}
    }
    #[cfg(test)]
    mod std_tests {
        use super::*;
        fn child(id:i32,parent:&Node,kind:i32,role:&str,rect:[i32;4])->Node {
            let mut ancestry=parent.ancestry.clone();ancestry.push(SteamPathNode{runtime_id:vec![id],control_type:kind});
            Node{runtime:vec![id],ancestry,kind,rect,visible:Some(true),password:Some(false),role:Some(role.into()),landmark:None,heading:None,
                dialog:Some(false),modal:Some(false),busy:Some(false),label:None,name:None,framework:Some("SIM".into()),provider:Some("SIM_ONLY".into()),enabled:Some(true),selected:Some(false),control_ancestry:None,properties:Vec::new(),aria:None}
        }
        pub(super) fn healthy()->Vec<Node>{
            let root=Node{runtime:vec![1],ancestry:vec![SteamPathNode{runtime_id:vec![1],control_type:50032}],kind:50032,rect:[0,0,1000,800],
                visible:Some(true),password:Some(false),role:Some("window".into()),landmark:None,heading:None,dialog:Some(false),modal:Some(false),busy:Some(false),label:None,name:None,
                framework:Some("SIM".into()),provider:Some("SIM_ONLY".into()),enabled:Some(true),selected:Some(false),control_ancestry:None,properties:Vec::new(),aria:None};
            let doc=child(2,&root,50030,"document",[0,0,1000,800]);
            let mut main=child(3,&doc,50033,"main",[300,0,1000,800]);main.landmark=Some(80002);main.label=Some(vec![4]);
            let mut heading=child(4,&main,50020,"heading",[320,20,800,70]);heading.heading=Some(80051);heading.name=Some("A".into());
            let sidebar=child(5,&doc,50007,"listitem",[0,0,250,40]);
            vec![root,doc,main,heading,sidebar]
        }
        fn observe(nodes:&[Node])->Result<RawMain,String>{classify(nodes,"A",[0,0,1000,800])}
        fn denied(mut change:impl FnMut(&mut Vec<Node>)){let mut n=healthy();change(&mut n);assert!(observe(&n).is_err());}
        #[test] fn healthy_structural_main_title(){let main=observe(&healthy()).unwrap();assert_eq!(main.title,"A");assert_eq!(main.document_runtime_id,vec![2]);assert_eq!(main.title_runtime_id,vec![4]);}
        #[test] fn sidebar_a_main_b(){denied(|n|n[3].name=Some("B".into()));}
        #[test] fn sidebar_only_is_not_heading(){denied(|n|{n[3].heading=None;n[3].role=Some("text".into());n[4].name=Some("A".into());});}
        #[test] fn separate_properties_root(){denied(|n|n[3].ancestry[0].runtime_id=vec![99]);}
        #[test] fn in_root_properties_dialog(){denied(|n|{n[2].dialog=Some(true);n[2].role=Some("dialog".into());});}
        #[test] fn properties_legitimate_main_can_have_same_structural_facts(){let n=healthy();let main=observe(&n).unwrap();assert_eq!(main.title,"A");}
        #[test] fn modal_overlay_anywhere_denies(){denied(|n|{let mut overlay=child(6,&n[0],50033,"dialog",[200,200,800,600]);overlay.modal=Some(true);n.push(overlay);});}
        #[test] fn unknown_overlay_coverage_denies(){denied(|n|{let mut overlay=child(6,&n[0],50033,"",[200,200,800,600]);overlay.dialog=None;n.push(overlay);});}
        #[test] fn ambiguous_main_even_same_subject(){denied(|n|{let mut second=n[2].clone();second.runtime=vec![6];second.ancestry.last_mut().unwrap().runtime_id=vec![6];n.push(second);});}
        #[test] fn ambiguous_primary_heading(){denied(|n|{let mut second=n[3].clone();second.runtime=vec![6];second.ancestry.last_mut().unwrap().runtime_id=vec![6];n.push(second);});}
        #[test] fn generic_level_one_no_heading_semantics(){denied(|n|{n[3].heading=None;n[3].role=Some("treeitem".into());});}
        #[test] fn unsupported_dialog_is_not_false(){denied(|n|n[2].dialog=None);}
        #[test] fn label_sidebar_is_not_main_title(){denied(|n|n[2].label=Some(vec![5]));}
        #[test] fn stale_title_runtime_reference(){denied(|n|{n[3].runtime=vec![6];n[3].ancestry.last_mut().unwrap().runtime_id=vec![6];});}
        #[test] fn duplicate_runtime_rejected(){denied(|n|n.push(n[4].clone()));}
        #[test] fn clipped_or_empty_title_rect(){denied(|n|n[3].rect=[250,20,800,70]);denied(|n|n[3].rect=[320,20,320,70]);}
        #[test] fn disabled_password_not_eligibility_filtered(){denied(|n|{let mut password=child(6,&n[2],50004,"textbox",[400,100,600,150]);password.password=Some(true);n.push(password);});}
        #[test] fn busy_or_unknown_required_flag_denies(){denied(|n|n[2].busy=Some(true));denied(|n|n[2].modal=None);}
        #[test] fn no_document_context_denies(){denied(|n|{n[1].kind=50033;for node in n.iter_mut(){for p in &mut node.ancestry{if p.runtime_id==vec![2]{p.control_type=50033;}}}});}
        #[test] fn malformed_and_duplicate_aria(){for s in ["busy=true;busy=false","busy=TRUE","modal=yes","bad","busy=false\\","busy=false=oops"]{assert!(aria_flags(s).is_err(),"{s}");}}
        #[test] fn supported_aria_escape_and_false_flags(){assert_eq!(aria_flags("modal=false;busy=false;description=a\\;b\\=c\\\\d").unwrap(),(Some(false),Some(false)));assert_eq!(aria_flags("").unwrap(),(None,None));}
        #[test] fn rawview_overflow_and_depth_reject(){let mut n=healthy();for id in 6..=518{n.push(child(id,&n[1],50020,"text",[400,100,500,150]));}assert!(observe(&n).is_err());denied(|n|{for _ in 0..33{n[3].ancestry.push(SteamPathNode{runtime_id:vec![9],control_type:50033});}});}
        #[test] fn nonexact_unicode_subject_never_normalized(){denied(|n|n[3].name=Some("a".into()));denied(|n|n[3].name=Some("AA".into()));let mut n=healthy();n[3].name=Some("\u{00A0}A\u{FEFF}".into());assert!(observe(&n).is_ok());}
        #[test] fn title_nested_blocker_ancestry_denies(){for (kind,role) in [(50032,"window"),(50033,"navigation"),(50018,"tab"),(50019,"tabitem"),(50008,"list")]{let mut n=healthy();let nested=child(6,&n[2],kind,role,[310,0,900,400]);n[3].ancestry=nested.ancestry.clone();n[3].ancestry.push(SteamPathNode{runtime_id:vec![4],control_type:50020});n.push(nested);assert!(observe(&n).is_err());}}
        fn selected_fixture()->Vec<Node>{let mut n=healthy();n[4].selected=Some(true);n[4].name=Some("A".into());n[4].control_ancestry=Some(vec![n[0].ancestry[0].clone(),n[4].ancestry.last().unwrap().clone()]);n}
        fn selected(n:&[Node])->Result<&Node,String>{let path=vec![n[0].ancestry[0].clone(),SteamPathNode{runtime_id:vec![5],control_type:50007}];selected_node(n,&[5],50007,"A",&path)}
        #[test] fn selected_actual_control_path_distinct_from_raw(){assert!(selected(&selected_fixture()).is_ok());}
        #[test] fn selected_none_denies(){let mut n=selected_fixture();n[4].selected=Some(false);assert!(selected(&n).is_err());}
        #[test] fn selected_unknown_not_false(){let mut n=selected_fixture();n[4].selected=None;assert!(selected(&n).is_err());}
        #[test] fn selected_ambiguity_denies(){let mut n=selected_fixture();let mut other=child(6,&n[1],50029,"treeitem",[0,50,250,90]);other.selected=Some(true);n.push(other);assert!(selected(&n).is_err());}
        #[test] fn selected_stale_control_path_denies(){let mut n=selected_fixture();n[4].control_ancestry=Some(n[4].ancestry.clone());assert!(selected(&n).is_err());}
        #[test] fn selected_renamed_or_disabled_denies(){let mut n=selected_fixture();n[4].name=Some("B".into());assert!(selected(&n).is_err());n[4].name=Some("A".into());n[4].enabled=Some(false);assert!(selected(&n).is_err());}

    }
    #[cfg(test)]
    mod capture_tests {
        use super::*;
        fn property(id:i32,value:PropertyValue)->PropertyRecord {
            let tag=match &value {PropertyValue::Empty=>0,PropertyValue::Bool(_)=>11,PropertyValue::I4(_)=>3,PropertyValue::Bstr(_)=>8};
            PropertyRecord{id,support:if tag==0||PropertyRecord::expected(id)==Some(tag){Support::Supported}else{Support::UnsupportedType},tag:Some(tag),value:Some(value)}
        }
        pub(super) fn fixture_packet()->CurrentCapture {
            let mut nodes=std_tests::healthy();
            for node in &mut nodes {
                node.aria=Some(aria_properties("busy=false;modal=false;sim-state=detail").unwrap());
                node.properties=vec![property(30002,PropertyValue::I4(1)),property(30003,PropertyValue::I4(node.kind)),
                    property(30010,PropertyValue::Bool(true)),property(30019,PropertyValue::Bool(false)),property(30022,PropertyValue::Bool(false)),
                    property(30024,PropertyValue::Bstr("SIM_FRAMEWORK_PRIVATE".into())),property(30101,PropertyValue::Bstr(node.role.clone().unwrap())),
                    property(30102,PropertyValue::Bstr("busy=false;modal=false;sim-state=detail".into())),property(30107,PropertyValue::Bstr("SIM_PROVIDER_PRIVATE".into())),
                    property(30157,PropertyValue::I4(node.landmark.unwrap_or(0))),property(30173,PropertyValue::I4(node.heading.unwrap_or(0))),property(30174,PropertyValue::Bool(false))];
            }
            CurrentCapture{nodes,client:[0,0,1000,800]}
        }
        #[test] fn support_empty_and_not_supported_are_distinct() {
            let empty=property(30101,PropertyValue::Empty);assert!(empty.validate());assert_eq!(empty.variant(),"EMPTY");assert_eq!(empty.support.label(),"supported");
            let unsupported=PropertyRecord{id:30101,support:Support::NotSupported,tag:Some(13),value:None};assert!(unsupported.validate());assert_eq!(unsupported.variant(),"OTHER");assert!(empty!=unsupported);
        }
        #[test] fn actual_type_mismatch_retains_typed_value_not_coercion() {
            let wrong=property(30101,PropertyValue::Bool(false));assert!(wrong.validate());assert_eq!(wrong.support.label(),"unsupported_type");assert_eq!(wrong.variant(),"BOOL");assert!(wrong.text().is_err());
        }
        #[test] fn malformed_support_type_value_and_opaque_values_deny() {
            for record in [PropertyRecord{id:30101,support:Support::Supported,tag:Some(8),value:Some(PropertyValue::Bool(true))},
                PropertyRecord{id:30101,support:Support::NotSupported,tag:Some(13),value:Some(PropertyValue::Empty)},
                PropertyRecord{id:30101,support:Support::Error,tag:None,value:None},
                PropertyRecord{id:30101,support:Support::UnsupportedType,tag:Some(9),value:None},property(1,PropertyValue::Bool(false))] {assert!(!record.validate());}
        }
        #[test] fn real_private_constructor_rejects_duplicate_unsorted_missing_properties() {
            let good=fixture_packet();assert!(good.validate().is_ok());
            let mut bad=good.clone();let duplicate=bad.nodes[0].properties[0].clone();bad.nodes[0].properties.push(duplicate);assert!(bad.validate().is_err());
            let mut bad=good.clone();bad.nodes[0].properties.swap(0,1);assert!(bad.validate().is_err());
            let mut bad=good;bad.nodes[0].properties.remove(5);assert!(bad.validate().is_err());
        }
        #[test] fn full_nonmodal_aria_changes_remain_visible_to_actual_equality() {
            let first=fixture_packet();let mut second=first.clone();
            let replacement="busy=false;modal=false;sim-state=properties";
            assert_eq!(aria_flags(replacement).unwrap(),aria_flags("busy=false;modal=false;sim-state=detail").unwrap());
            second.nodes[2].aria=Some(aria_properties(replacement).unwrap());
            second.nodes[2].properties.iter_mut().find(|p|p.id==30102).unwrap().value=Some(PropertyValue::Bstr(replacement.into()));
            assert!(first.validate().is_ok()&&second.validate().is_ok());assert!(first!=second);
        }
        #[test] fn framework_provider_survive_materialize_private_until_refusal() {
            let packet=fixture_packet();let result=materialize(classify(&packet.nodes,"A",packet.client).unwrap());
            assert!(result.capture==packet);assert!(approved_detail(result).is_err());
        }
        #[test] fn diagnostic_metadata_omits_all_values_and_digests() {
            let value=SteamDiagnosticCapture::from_current(fixture_packet()).unwrap().project("capture-1","task-1",0,1,&||Ok(())).unwrap();
            assert_eq!(value.as_object().unwrap().len(),10);assert_eq!(value["schema"],"edith.steam.diagnostic/1");assert_eq!(value["approvalState"],"unsupported");
            assert_eq!(value["coverage"]["nodeCount"],5);assert_eq!(value["coverage"]["documentCount"],1);
            let encoded=value.to_string();assert!(!encoded.contains("SIM_"));assert!(!encoded.contains("semanticValue"));assert!(!encoded.contains("valueDigest"));
            for row in value["records"].as_array().unwrap(){assert_eq!(row.as_object().unwrap().len(),4);}
        }
        #[test] fn diagnostic_no_main_required_and_signed_runtime_sort() {
            let mut packet=fixture_packet();for node in &mut packet.nodes {node.role=Some("window".into());node.landmark=None;node.heading=None;node.label=None;node.name=None;}
            let value=SteamDiagnosticCapture::from_current(packet).unwrap().project("capture","task",1,1,&||Ok(())).unwrap();assert_eq!(value["stable"],true);
            let mut packet=fixture_packet();packet.nodes[0].runtime=vec![-1];for node in &mut packet.nodes {node.ancestry[0].runtime_id=vec![-1];}
            let value=SteamDiagnosticCapture::from_current(packet).unwrap().project("capture","task",1,1,&||Ok(())).unwrap();assert_eq!(value["records"][0]["runtimePath"],json!([[-1]]));
        }
        #[test] fn diagnostic_names_and_projection_guard_denied() {
            let mut bad=fixture_packet();bad.nodes[0].properties.push(property(30005,PropertyValue::Bstr("SIM_NAME".into())));bad.nodes[0].properties.sort_by_key(|p|p.id);
            assert!(SteamDiagnosticCapture::from_current(bad).is_err());
            let capture=SteamDiagnosticCapture::from_current(fixture_packet()).unwrap();assert!(capture.project("capture","task",1,1,&||Err("STOPPED".into())).is_err());
            let capture=SteamDiagnosticCapture::from_current(fixture_packet()).unwrap();assert!(capture.project("bad id","task",1,1,&||Ok(())).is_err());
        }
        #[test] fn full_aria_pairs_bounded_duplicates_and_parse_consistency() {
            let parsed=aria_properties("busy=false;modal=false;sim-state=x\\;y").unwrap();assert!(parsed.iter().any(|(k,v)|k=="sim-state"&&v=="x;y"));
            assert!(aria_properties("sim-state=a;sim-state=b").is_err());assert!(aria_properties(&"x".repeat(4097)).is_err());
            let mut packet=fixture_packet();packet.nodes[0].aria=Some(Vec::new());assert!(packet.validate().is_err());
        }
    }
    #[cfg(test)]
    mod profile_tests {
        use super::*;
        fn observed()->SteamMainObservation{materialize(classify(&std_tests::healthy(),"A",[0,0,1000,800]).unwrap()).main}
        // Typed synthetic properties only; these do not register a provider profile.
        enum TypedValue { Bstr(String),Bool(bool),I4(i32) }
        fn typed_rows(mut rows:Vec<(Vec<i32>,i32,TypedValue)>)->Result<Value,String>{
            use sha2::{Digest,Sha256};
            if rows.len()>512||rows.iter().any(|(runtime,id,_)|runtime.is_empty()||runtime.len()>32||*id<=0){return Err(UNSUPPORTED.into());}
            rows.sort_by(|a,b|a.0.cmp(&b.0).then(a.1.cmp(&b.1)));
            if rows.windows(2).any(|pair|pair[0].0==pair[1].0&&pair[0].1==pair[1].1){return Err(UNSUPPORTED.into());}
            let mut result=Vec::new();
            for (runtime,id,typed) in rows {
                let (tag,value)=match typed {TypedValue::Bstr(value)=>{if value.len()>4096{return Err(UNSUPPORTED.into());}("BSTR",json!(value))},
                    TypedValue::Bool(value)=>("BOOL",json!(value)),TypedValue::I4(value)=>("I4",json!(value))};
                let bytes=serde_json::to_vec(&json!([tag,value])).map_err(|_|UNSUPPORTED)?;
                result.push(json!([runtime,id,tag,format!("{:x}",Sha256::digest(bytes))]));
            }
            Ok(Value::Array(result))
        }
        // Sole full witness constructor is test-only and privately sealed.
        fn sim_detail(main:SteamMainObservation)->SteamMainDetailObservation {
            SteamMainDetailObservation{main,profile_fingerprint:"a".repeat(64),
                profile_version:1,provider_identity:"sim-provider".into(),
                evidence_set_digest:"a".repeat(64),registry_revision:1,
                observed_properties:typed_rows(vec![(vec![3],30102,TypedValue::Bstr("sim-state=detail".into()))]).unwrap(),
                exclusion_properties:typed_rows(vec![(vec![4],30174,TypedValue::Bool(false))]).unwrap(),_seal:()}
        }
        #[test] fn healthy_detail_seal_is_sim_only(){let d=sim_detail(observed());assert_eq!(d.main.title,"A");assert_eq!(d.profile_fingerprint.len(),64);assert!(d.observed_properties.is_array());assert!(d.exclusion_properties.is_array());}
        #[test] fn no_production_profile_always_unavailable(){assert!(approved_detail(materialize(classify(&capture_tests::fixture_packet().nodes,"A",[0,0,1000,800]).unwrap())).unwrap_err().starts_with("CONFIGURATION_REQUIRED"));}
        #[test] fn exact_frozen_main_semantic_values(){assert_eq!(observed().main_semantic_facts,json!(["uia-main-v1",80002,"main",false,false,false,[4]]));}
        #[test] fn synthetic_property_rows_exact_runtime_id_tag_and_hash(){
            let detail=sim_detail(observed());
            assert_eq!(detail.observed_properties,json!([[[3],30102,"BSTR","fc13ccf1f36b4e291f83258d63cc92ed75ddb7ad481bfac91d2afdd1dc71e6f4"]]));
            assert_eq!(detail.exclusion_properties,json!([[[4],30174,"BOOL","b8b75bd4b3e466cf33a4b46306d24686cf1e90b2594c0df90e4f3e8d52fa2f39"]]));
            assert_eq!(typed_rows(vec![(vec![-1],30173,TypedValue::I4(-2147483648))]).unwrap(),json!([[[-1],30173,"I4","3114a9207735c4f36f7127426d56132975211aa32b9dc2fbb9d643d869ce5891"]]));
        }
        #[test] fn typed_rows_sort_signed_runtime_then_property(){
            let rows=typed_rows(vec![(vec![3],30174,TypedValue::Bool(false)),(vec![-1,2],30174,TypedValue::Bool(false)),
                (vec![-1],30174,TypedValue::Bool(false)),(vec![3],30102,TypedValue::Bstr("sim-state=detail".into()))]).unwrap();
            let keys:Vec<_>=rows.as_array().unwrap().iter().map(|row|(row[0].clone(),row[1].clone())).collect();
            assert_eq!(keys,vec![(json!([-1]),json!(30174)),(json!([-1,2]),json!(30174)),(json!([3]),json!(30102)),(json!([3]),json!(30174))]);
        }
        #[test] fn typed_rows_duplicate_runtime_property_denies_even_different_type(){assert!(typed_rows(vec![(vec![3],30102,TypedValue::Bstr("sim-state=detail".into())),(vec![3],30102,TypedValue::Bool(false))]).is_err());}
        #[test] fn typed_rows_invalid_identity_and_string_budget_denies(){assert!(typed_rows(vec![(vec![],30102,TypedValue::Bool(false))]).is_err());assert!(typed_rows(vec![(vec![3],0,TypedValue::Bool(false))]).is_err());assert!(typed_rows(vec![(vec![3],30102,TypedValue::Bstr("x".repeat(4097)))]).is_err());}

    }
}
