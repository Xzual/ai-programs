//! Native facts for the single fixed Calculator ApplicationFrameHost delegation.
//! These private facts are never accepted from IPC or used as an OCR fallback error.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct CalculatorContentIdentity {
    pub hwnd: isize,
    pub pid: u32,
    pub image: String,
    pub created: u64,
    pub ancestry: Vec<isize>,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct NativeWindowIdentity {
    pub root_hwnd: isize,
    pub root_pid: u32,
    pub root_image: String,
    pub root_created: u64,
    pub content: Option<CalculatorContentIdentity>,
}
pub(crate) fn revalidate(identity: &NativeWindowIdentity) -> Result<(), String> {
    require_same_identity(identity, &observe(identity.root_hwnd, identity.root_pid)?)
}
pub(crate) fn require_same_identity(retained: &NativeWindowIdentity, current: &NativeWindowIdentity) -> Result<(), String> {
    if retained != current {
        return Err("Native window/content identity changed".into());
    }
    Ok(())
}
/// Pure predicate over native-observed UIA ancestors, ordered element-to-root.
/// This is private Rust logic, never an IPC constructor or caller proof.
pub(crate) fn delegated_element_allowed(identity: &NativeWindowIdentity, element_pid: u32,
    ancestors: &[(isize, u32)]) -> bool {
    let Some(content) = identity.content.as_ref() else { return false; };
    if element_pid != content.pid || ancestors.is_empty() || ancestors.len() > 32 { return false; }
    let content_index = ancestors.iter().position(|row| *row == (content.hwnd, content.pid));
    let root_index = ancestors.iter().position(|row| *row == (identity.root_hwnd, identity.root_pid));
    matches!((content_index, root_index), (Some(content), Some(root)) if content < root && root == ancestors.len() - 1)
}
pub(crate) fn calculator_package_relative(relative: &std::path::Path) -> bool {
    let parts: Vec<_> = relative.components().collect();
    if parts.len() != 2 { return false; }
    let package = parts[0].as_os_str().to_string_lossy().to_ascii_lowercase();
    let executable = parts[1].as_os_str().to_string_lossy().to_ascii_lowercase();
    let Some(version) = package.strip_prefix("microsoft.windowscalculator_").and_then(|s| s.strip_suffix("_8wekyb3d8bbwe")) else { return false; };
    !version.is_empty() && executable == "calculatorapp.exe"
}
#[cfg(not(windows))]
pub(crate) fn observe(_: isize, _: u32) -> Result<NativeWindowIdentity, String> {
    Err("Native window identity unavailable on this platform".into())
}
#[cfg(windows)]
pub(crate) fn observe(hwnd: isize, pid: u32) -> Result<NativeWindowIdentity, String> {
    use windows_sys::Win32::{Foundation::{CloseHandle, FILETIME, HWND}, System::{SystemInformation::GetWindowsDirectoryW, Threading::{OpenProcess, QueryFullProcessImageNameW, GetProcessTimes, PROCESS_QUERY_LIMITED_INFORMATION}}, UI::WindowsAndMessaging::{EnumChildWindows, GetAncestor, GA_ROOT, GetParent, GetWindowThreadProcessId, IsWindow, IsChild}};
    fn facts(pid: u32) -> Result<(std::path::PathBuf, u64), String> {
        let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
        if process.is_null() { return Err("Native process identity unavailable".into()); }
        let mut path = vec![0u16; 32768]; let mut len = path.len() as u32;
        let mut creation = FILETIME::default(); let mut exit = FILETIME::default();
        let mut kernel = FILETIME::default(); let mut user = FILETIME::default();
        let image_ok = unsafe { QueryFullProcessImageNameW(process, 0, path.as_mut_ptr(), &mut len) };
        let time_ok = unsafe { GetProcessTimes(process, &mut creation, &mut exit, &mut kernel, &mut user) };
        unsafe { CloseHandle(process); }
        if image_ok == 0 || time_ok == 0 || len == 0 || len as usize >= path.len() { return Err("Native process facts unavailable".into()); }
        let image = std::path::PathBuf::from(String::from_utf16(&path[..len as usize]).map_err(|_| "Native image encoding invalid")?).canonicalize().map_err(|_| "Native canonical image unavailable")?;
        Ok((image, ((creation.dwHighDateTime as u64) << 32) | creation.dwLowDateTime as u64))
    }
    fn window_pid(hwnd: HWND) -> Result<u32, String> {
        let mut pid = 0;
        if unsafe { IsWindow(hwnd) } == 0 { return Err("Native window no longer exists".into()); }
        unsafe { GetWindowThreadProcessId(hwnd, &mut pid); }
        if pid == 0 { return Err("Native window process unavailable".into()); } Ok(pid)
    }
    if hwnd == 0 || pid == 0 || window_pid(hwnd as HWND)? != pid { return Err("Native root identity mismatch".into()); }
    if unsafe { GetAncestor(hwnd as HWND, GA_ROOT) } as isize != hwnd { return Err("Native owned window is not the actual root".into()); }
    let (image, created) = facts(pid)?;
    let mut result = NativeWindowIdentity { root_hwnd: hwnd, root_pid: pid, root_image: image.to_string_lossy().into_owned(), root_created: created, content: None };
    // Ordinary applications need no hosted-package exception or package scan.
    if !image.file_name().is_some_and(|name| name.to_string_lossy().eq_ignore_ascii_case("ApplicationFrameHost.exe")) { return Ok(result); }
    let mut directory = vec![0u16; 32768];
    let len = unsafe { GetWindowsDirectoryW(directory.as_mut_ptr(), directory.len() as u32) };
    if len == 0 || len as usize >= directory.len() { return Err("Native system identity unavailable".into()); }
    let windows = std::path::PathBuf::from(String::from_utf16(&directory[..len as usize]).map_err(|_| "Native system identity invalid")?);
    let host = windows.join("System32").join("ApplicationFrameHost.exe").canonicalize().map_err(|_| "Native frame host identity unavailable")?;
    if image != host { return Ok(result); }
    let protected = windows.parent().ok_or("Native system root unavailable")?.join("Program Files").join("WindowsApps").canonicalize().map_err(|_| "Native protected package root unavailable")?;
    struct Children { hwnds: Vec<isize>, overflow: bool }
    unsafe extern "system" fn collect(hwnd: HWND, data: isize) -> i32 {
        let children = &mut *(data as *mut Children);
        if children.hwnds.len() >= 512 { children.overflow = true; return 0; }
        children.hwnds.push(hwnd as isize); 1
    }
    let mut children = Children { hwnds: Vec::new(), overflow: false };
    unsafe { EnumChildWindows(hwnd as HWND, Some(collect), &mut children as *mut Children as isize); }
    if children.overflow { return Err("Native content identity exceeds window budget".into()); }
    let mut candidates = Vec::new();
    let mut processes = std::collections::BTreeMap::new();
    for child in children.hwnds {
        let child_pid = window_pid(child as HWND)?;
        if child_pid == pid { continue; }
        if !processes.contains_key(&child_pid) { processes.insert(child_pid, facts(child_pid)?); }
        let (child_image, child_created) = processes.get(&child_pid).ok_or("Native content process unavailable")?;
        if !child_image.strip_prefix(&protected).is_ok_and(calculator_package_relative) { continue; }
        // Only the outermost actual package HWND can define content ownership.
        let mut ancestor = child as HWND; let mut path = vec![child]; let mut nested = false; let mut reached = false;
        for _ in 0..31 {
            ancestor = unsafe { GetParent(ancestor) };
            if ancestor.is_null() { break; }
            path.push(ancestor as isize);
            if ancestor as isize == hwnd { reached = true; break; }
            if window_pid(ancestor)? == child_pid { nested = true; }
        }
        if !reached || unsafe { IsChild(hwnd as HWND, child as HWND) } == 0 { return Err("Native Calculator content ancestry invalid".into()); }
        if !nested { path.reverse(); candidates.push(CalculatorContentIdentity { hwnd: child, pid: child_pid, image: child_image.to_string_lossy().into_owned(), created: *child_created, ancestry: path }); }
    }
    if candidates.len() > 1 { return Err("Native Calculator content identity ambiguous".into()); }
    result.content = candidates.pop();
    if window_pid(hwnd as HWND)? != pid || facts(pid)? != (image, created) { return Err("Native root changed during identity capture".into()); }
    if let Some(content) = result.content.as_ref() {
        if window_pid(content.hwnd as HWND)? != content.pid || facts(content.pid)? != (std::path::PathBuf::from(&content.image), content.created) { return Err("Native content changed during identity capture".into()); }
    }
    Ok(result)
}
