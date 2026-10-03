//! Independent, owner-operated app launcher. No AI execution or shell input.
use std::{fs, io::Read, path::{Path, PathBuf}, os::windows::process::CommandExt, process::{Command, Stdio}, sync::{Mutex, atomic::{AtomicBool, Ordering}}, time::{Duration, Instant}};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};
use windows::{core::PCWSTR, Win32::{Foundation::HWND, UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL}}};

#[derive(Clone, Default, Serialize, Deserialize)]
pub struct Catalog { pub groups: Vec<Group> }
#[derive(Clone, Serialize, Deserialize)]
pub struct Group { pub id: String, pub name: String, pub apps: Vec<App> }
#[derive(Clone, Serialize, Deserialize)]
pub struct App { pub id: String, pub name: String, pub path: String, pub icon: Option<String> }
pub struct Store { catalog: Mutex<Result<Catalog, String>>, launching: AtomicBool }
#[derive(Serialize)]
pub struct LaunchResult { pub name: String, pub opened: bool, pub error: Option<String> }

fn store_path() -> PathBuf { crate::settings::config_dir().join("shortcuts.json") }
fn name(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.chars().count() > 40 || trimmed.chars().any(char::is_control) { return Err("İsim 1–40 karakter olmalı.".into()); }
    Ok(trimmed.into())
}
fn exe(path: &Path) -> Result<PathBuf, String> {
    if !path.is_absolute() || !path.extension().is_some_and(|v| v.eq_ignore_ascii_case("exe")) { return Err("Yerel bir .exe uygulaması seç.".into()); }
    let canonical = fs::canonicalize(path).map_err(|_| "Uygulama bulunamadı; taşınmış veya silinmiş olabilir.")?;
    if !canonical.is_file() { return Err("Uygulama dosyası bulunamadı.".into()); }
    Ok(canonical)
}
fn read(path: &Path) -> Result<Catalog, String> {
    let mut file = match fs::File::open(path) { Ok(f) => f, Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Catalog::default()), Err(_) => return Err("Kısayol ayarları okunamadı.".into()) };
    let mut bytes = Vec::new(); (&mut file).take(8 * 1024 * 1024 + 1).read_to_end(&mut bytes).map_err(|_| "Kısayol ayarları okunamadı.")?;
    if bytes.len() > 8 * 1024 * 1024 { return Err("Kısayol ayarları boyut sınırını aşıyor.".into()); }
    let catalog: Catalog = serde_json::from_slice(&bytes).map_err(|_| "Kısayol ayarları bozuk; dosyanın üzerine yazılmadı.")?;
    if catalog.groups.len() > 10 || catalog.groups.iter().any(|g| name(&g.name).is_err() || g.apps.len() > 12) { return Err("Kısayol ayarları geçersiz.".into()); }
    Ok(catalog)
}
fn write(path: &Path, catalog: &Catalog) -> Result<(), String> {
    fs::create_dir_all(path.parent().ok_or("Ayar klasörü bulunamadı.")?).map_err(|_| "Ayar klasörü oluşturulamadı.")?;
    let bytes = serde_json::to_vec_pretty(catalog).map_err(|_| "Ayarlar hazırlanamadı.")?;
    let temp = path.with_extension("json.tmp");
    fs::write(&temp, bytes).map_err(|_| "Kısayollar kaydedilemedi.")?;
    fs::rename(&temp, path).map_err(|_| "Kısayollar kaydedilemedi.".to_string())
}
impl Store {
    pub fn load() -> Self { Self { catalog: Mutex::new(read(&store_path())), launching: AtomicBool::new(false) } }
    fn edit(&self, change: impl FnOnce(&mut Catalog) -> Result<(), String>) -> Result<Catalog, String> {
        let mut stored = self.catalog.lock().unwrap();
        let mut next = stored.as_ref().map_err(Clone::clone)?.clone();
        change(&mut next)?; write(&store_path(), &next)?; *stored = Ok(next.clone()); Ok(next)
    }
}
fn group_mut<'a>(catalog: &'a mut Catalog, id: &str) -> Result<&'a mut Group, String> {
    catalog.groups.iter_mut().find(|g| g.id == id).ok_or("Grup bulunamadı.".into())
}

#[tauri::command]
pub fn shortcuts_list(store: State<Store>) -> Result<Catalog, String> { store.catalog.lock().unwrap().clone() }
#[tauri::command]
pub fn shortcuts_create_group(id: String, label: String, store: State<Store>) -> Result<Catalog, String> {
    if id.is_empty() || id.len() > 64 || !id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-') { return Err("Geçersiz grup kimliği.".into()); }
    let label = name(&label)?;
    store.edit(|c| {
        if c.groups.len() >= 10 { return Err("En fazla 10 grup oluşturabilirsin.".into()); }
        if c.groups.iter().any(|g| g.id == id) { return Err("Grup zaten var.".into()); }
        c.groups.push(Group { id, name: label, apps: Vec::new() }); Ok(())
    })
}
#[tauri::command]
pub fn shortcuts_rename_group(id: String, label: String, store: State<Store>) -> Result<Catalog, String> {
    let label = name(&label)?;
    store.edit(|c| { group_mut(c, &id)?.name = label; Ok(()) })
}
#[tauri::command]
pub fn shortcuts_remove_group(id: String, store: State<Store>) -> Result<Catalog, String> {
    store.edit(|c| { if !c.groups.iter().any(|g| g.id == id) { return Err("Grup bulunamadı.".into()); } c.groups.retain(|g| g.id != id); Ok(()) })
}
#[tauri::command]
pub fn shortcuts_remove_app(group_id: String, app_id: String, store: State<Store>) -> Result<Catalog, String> {
    store.edit(|c| { let group = group_mut(c, &group_id)?; group.apps.retain(|a| a.id != app_id); Ok(()) })
}

// Fixed Windows system code. File names never become PowerShell source.
// The native file picker and associated icons require no extra dependency.
const PICKER: &str = r#"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$picker = New-Object System.Windows.Forms.OpenFileDialog
$picker.Title = 'Gruba uygulama ekle'
$picker.Filter = 'Uygulama veya kısayol (*.exe;*.lnk)|*.exe;*.lnk'
$picker.CheckFileExists = $true
try {
 if ($env:COUCOU_SHORTCUT_PATH) { $target = $env:COUCOU_SHORTCUT_PATH }
 else { if ($picker.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { 'null'; exit }; $target = $picker.FileName }
 if ([IO.Path]::GetExtension($target) -ieq '.lnk') {
   $shell = New-Object -ComObject WScript.Shell
   $link = $shell.CreateShortcut($target)
   if ($link.Arguments) { throw 'Parametreli kısayol yerine uygulamanın .exe dosyasını seç.' }
   $target = [Environment]::ExpandEnvironmentVariables($link.TargetPath)
 }
 if ([IO.Path]::GetExtension($target) -ine '.exe' -or !(Test-Path -LiteralPath $target -PathType Leaf)) { throw 'Bir .exe uygulaması seç.' }
 $iconData = $null
 $icon = $null; $bitmap = $null; $small = $null; $stream = $null
 try {
   $icon = [Drawing.Icon]::ExtractAssociatedIcon($target)
   if ($icon) {
     $bitmap = $icon.ToBitmap(); $small = [Drawing.Bitmap]::new($bitmap,32,32)
     $stream = New-Object IO.MemoryStream
     $small.Save($stream,[Drawing.Imaging.ImageFormat]::Png)
     $iconData = 'data:image/png;base64,' + [Convert]::ToBase64String($stream.ToArray())
   }
 } catch {} finally { if ($stream) {$stream.Dispose()}; if ($small) {$small.Dispose()}; if ($bitmap) {$bitmap.Dispose()}; if ($icon) {$icon.Dispose()} }
 @{ id=[guid]::NewGuid().ToString(); name=[IO.Path]::GetFileNameWithoutExtension($target); path=$target; icon=$iconData } | ConvertTo-Json -Compress
} catch { @{error=$_.Exception.Message} | ConvertTo-Json -Compress } finally { $picker.Dispose() }
"#;

fn powershell() -> PathBuf {
    std::env::var_os("SystemRoot").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("C:/Windows")).join("System32/WindowsPowerShell/v1.0/powershell.exe")
}
fn pick_path(path: Option<&str>) -> Result<Option<App>, String> {
    if let Some(path) = path {
        let path = Path::new(path);
        if !path.is_absolute() || !path.is_file() || !path.extension().is_some_and(|e| e.eq_ignore_ascii_case("exe") || e.eq_ignore_ascii_case("lnk")) { return Err("Yalnız .exe veya Windows .lnk kısayolu bırakabilirsin.".into()); }
    }
    // Encoding the fixed script avoids command-line codepage loss (Turkish).
    let encoded: Vec<u8> = PICKER.encode_utf16().flat_map(u16::to_le_bytes).collect();
    let mut child = Command::new(powershell()).args(["-NoProfile", "-STA", "-EncodedCommand", &crate::gemini::base64_for(&encoded)])
        .env("COUCOU_SHORTCUT_PATH", path.unwrap_or(""))
        .creation_flags(0x0800_0000).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null())
        .spawn().map_err(|_| "Windows uygulama seçicisi açılamadı.")?;
    // Drain stdout concurrently; a large icon must not deadlock the picker.
    let stdout = child.stdout.take().ok_or("Seçici çıktısı alınamadı.")?;
    let reader = std::thread::spawn(move || { let mut bytes = Vec::new(); stdout.take(128 * 1024).read_to_end(&mut bytes).map(|_| bytes) });
    let deadline = Instant::now() + Duration::from_secs(180);
    loop {
        match child.try_wait() {
            Ok(Some(status)) => { if !status.success() { return Err("Windows seçicisi başarısız oldu.".into()); } break; }
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(100)),
            _ => { let _ = child.kill(); let _ = child.wait(); return Err("Uygulama seçimi iptal edildi veya zaman aşımına uğradı.".into()); }
        }
    }
    let bytes = reader.join().map_err(|_| "Seçici çıktısı alınamadı.")?.map_err(|_| "Seçici çıktısı okunamadı.")?;
    // Windows PowerShell writes stdout in the console codepage by default.
    let value: serde_json::Value = serde_json::from_slice(&bytes).map_err(|_| "Seçici yanıtı okunamadı.")?;
    if value.is_null() { return Ok(None); }
    if let Some(error) = value["error"].as_str() { return Err(error.into()); }
    let mut app: App = serde_json::from_value(value).map_err(|_| "Uygulama bilgisi alınamadı.")?;
    exe(Path::new(&app.path))?; app.name = name(&app.name)?;
    if app.icon.as_ref().is_some_and(|v| !v.starts_with("data:image/png;base64,") || v.len() > 64 * 1024) { app.icon = None; }
    Ok(Some(app))
}
#[tauri::command]
pub async fn shortcuts_pick_app(group_id: String, app: AppHandle) -> Result<Catalog, String> {
    {
        let store = app.state::<Store>(); let mut catalog = store.catalog.lock().unwrap();
        let group = group_mut(catalog.as_mut().map_err(|e| e.clone())?, &group_id)?;
        if group.apps.len() >= 12 { return Err("Bir gruba en fazla 12 uygulama ekleyebilirsin.".into()); }
    }
    let picked = tauri::async_runtime::spawn_blocking(|| pick_path(None)).await.map_err(|_| "Seçici açılamadı.")??;
    let store = app.state::<Store>();
    if let Some(picked) = picked {
        store.edit(|c| {
            let group = group_mut(c, &group_id)?;
            if group.apps.len() >= 12 { return Err("Grup dolu.".into()); }
            if group.apps.iter().any(|a| a.path.eq_ignore_ascii_case(&picked.path)) { return Err("Bu uygulama zaten grupta.".into()); }
            group.apps.push(picked); Ok(())
        })
    } else { store.catalog.lock().unwrap().clone() }
}

#[tauri::command]
pub async fn shortcuts_add_paths(group_id: String, paths: Vec<String>, app: AppHandle) -> Result<Catalog, String> {
    if paths.is_empty() || paths.len() > 12 { return Err("Bir seferde 1–12 uygulama bırak.".into()); }
    let picked = tauri::async_runtime::spawn_blocking(move || paths.iter().map(|p| pick_path(Some(p)).and_then(|a| a.ok_or("Uygulama bilgisi alınamadı.".into()))).collect::<Result<Vec<_>, String>>()).await.map_err(|_| "Uygulamalar okunamadı.")??;
    app.state::<Store>().edit(|c| {
        let group = group_mut(c, &group_id)?;
        let mut next = group.apps.clone();
        for item in picked { if !next.iter().any(|a| a.path.eq_ignore_ascii_case(&item.path)) { next.push(item); } }
        if next.len() > 12 { return Err("Bir grupta en fazla 12 uygulama olabilir.".into()); }
        group.apps = next; Ok(())
    })
}

fn reorder(group: &mut Group, app_id: &str, before_id: &str) -> Result<(), String> {
    if app_id == before_id { return Ok(()); }
    let from = group.apps.iter().position(|a| a.id == app_id).ok_or("Uygulama bulunamadı.")?;
    if !group.apps.iter().any(|a| a.id == before_id) { return Err("Hedef bulunamadı.".into()); }
    let item = group.apps.remove(from);
    let to = group.apps.iter().position(|a| a.id == before_id).unwrap();
    group.apps.insert(to, item); Ok(())
}
#[tauri::command]
pub fn shortcuts_reorder(group_id: String, app_id: String, before_id: String, store: State<Store>) -> Result<Catalog, String> {
    store.edit(|c| reorder(group_mut(c, &group_id)?, &app_id, &before_id))
}

fn launch(app: &App) -> LaunchResult {
    let result = exe(Path::new(&app.path)).and_then(|_| {
        let path: Vec<u16> = app.path.encode_utf16().chain(Some(0)).collect();
        let operation: Vec<u16> = "open".encode_utf16().chain(Some(0)).collect();
        let result = unsafe { ShellExecuteW(Some(HWND::default()), PCWSTR(operation.as_ptr()), PCWSTR(path.as_ptr()), PCWSTR::null(), PCWSTR::null(), SW_SHOWNORMAL) };
        if result.0 as usize > 32 { Ok(()) } else { Err("Windows uygulamayı açamadı.".into()) }
    });
    LaunchResult { name: app.name.clone(), opened: result.is_ok(), error: result.err() }
}
#[tauri::command]
pub async fn shortcuts_launch(group_id: String, app_id: Option<String>, app: AppHandle) -> Result<Vec<LaunchResult>, String> {
    let store = app.state::<Store>();
    let apps = {
        let catalog = store.catalog.lock().unwrap(); let catalog = catalog.as_ref().map_err(Clone::clone)?;
        let group = catalog.groups.iter().find(|g| g.id == group_id).ok_or("Grup bulunamadı.")?;
        let apps: Vec<_> = group.apps.iter().filter(|a| app_id.as_ref().is_none_or(|id| *id == a.id)).cloned().collect();
        if apps.is_empty() { return Err("Grupta açılacak uygulama yok.".into()); } apps
    };
    if store.launching.swap(true, Ordering::AcqRel) { return Err("Önceki uygulamalar açılıyor.".into()); }
    tauri::async_runtime::spawn_blocking(move || {
        struct Release(AppHandle);
        impl Drop for Release { fn drop(&mut self) { self.0.state::<Store>().launching.store(false, Ordering::Release); } }
        let _release = Release(app);
        apps.iter().map(launch).collect::<Vec<_>>()
    }).await.map_err(|_| "Uygulama başlatma sonucu alınamadı.".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn reorder_preserves_apps_and_rejects_unknown_target() {
        let mut group=Group {id:"group".into(),name:"Çalışma".into(),apps:["a","b","c"].iter().map(|id|App{id:(*id).into(),name:(*id).into(),path:format!("C:/{id}.exe"),icon:None}).collect()};
        reorder(&mut group,"c","a").unwrap();
        assert_eq!(group.apps.iter().map(|a|a.id.as_str()).collect::<Vec<_>>(),vec!["c","a","b"]);
        let before=serde_json::to_string(&group).unwrap();
        assert!(reorder(&mut group,"c","missing").is_err()); assert_eq!(serde_json::to_string(&group).unwrap(),before);
        reorder(&mut group,"a","a").unwrap(); assert_eq!(serde_json::to_string(&group).unwrap(),before);
    }
    #[test] #[ignore="Read-only native Windows icon extraction acceptance check"]
    fn live_dropped_executable_metadata() {
        let path=std::env::var("SystemRoot").unwrap()+"\\System32\\notepad.exe";
        let item=pick_path(Some(&path)).unwrap().unwrap();
        assert!(item.name.eq_ignore_ascii_case("notepad")); assert!(item.icon.unwrap().starts_with("data:image/png;base64,"));
        assert!(pick_path(Some("C:/missing.exe")).is_err()); assert!(pick_path(Some("C:/file.txt")).is_err());
    }
    #[test] fn names_and_executable_boundary() {
        assert_eq!(name("  İş / Oyun  ").unwrap(), "İş / Oyun");
        assert!(name("").is_err()); assert!(name("a\nb").is_err()); assert!(name(&"x".repeat(41)).is_err());
        assert!(exe(Path::new("relative.exe")).is_err()); assert!(exe(Path::new("C:/script.ps1")).is_err());
    }
    #[test] fn persistence_unicode_and_corruption_is_not_overwritten() {
        let root = std::env::temp_dir().join(format!("coucou-shortcuts-{}", std::process::id())); fs::create_dir_all(&root).unwrap(); let path = root.join("shortcuts.json");
        let c = Catalog { groups: vec![Group { id: "test".into(), name: "Çalışma".into(), apps: vec![] }] };
        write(&path, &c).unwrap(); assert_eq!(read(&path).unwrap().groups[0].name, "Çalışma");
        write(&path, &Catalog::default()).unwrap(); assert!(read(&path).unwrap().groups.is_empty());
        fs::write(&path, b"invalid").unwrap(); assert!(read(&path).is_err()); assert_eq!(fs::read(&path).unwrap(), b"invalid");
        fs::remove_file(path).unwrap(); fs::remove_dir(root).unwrap();
    }
}
