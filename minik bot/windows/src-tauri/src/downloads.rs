//! Read-only Steam manifests and an opt-in Zen native-messaging snapshot.
//! No guessed progress, browser history access, network listeners or download controls.
use serde::{Deserialize, Serialize};
use std::{collections::{HashMap, HashSet}, fs, io::{Read,Seek,SeekFrom}, path::{Path, PathBuf}, sync::{Arc, Mutex}, time::{Instant, SystemTime, UNIX_EPOCH}};

const MAX_FILE: u64 = 512 * 1024;
#[path="zen_download_protocol.rs"] mod protocol;
use protocol::{ZenEnvelope,validate_zen,zen_path};
#[cfg(test)] use protocol::ZenItem;
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Download {
    pub id: String, pub source: String, pub name: String, pub state: String,
    pub received_bytes: Option<u64>, pub total_bytes: Option<u64>,
    pub bytes_per_second: Option<f64>, pub eta_seconds: Option<f64>,
    pub completion_id: Option<String>,
    #[serde(default)] pub artwork: Option<String>,
}
#[derive(Clone, Debug, Serialize)]
pub struct SourceStatus { pub source: String, pub state: String, pub detail: String }
#[derive(Clone, Debug, Serialize)]
pub struct Snapshot { pub items: Vec<Download>, pub sources: Vec<SourceStatus> }
#[derive(Default)] struct Sample { bytes: u64, total: u64, at: Option<Instant>, active: bool, network_active:bool, transfer_seen:bool }
#[derive(Default)] pub struct Store { cache: Arc<Mutex<Cache>> }
#[derive(Default)] struct Cache { steam: HashMap<String, Sample>, completed: HashMap<String, (Download, Instant)> }

fn read_bounded(path: &Path) -> Result<String, String> {
    let file = fs::File::open(path).map_err(|_| "Kaynak dosyası okunamıyor.".to_string())?;
    if file.metadata().map_err(|_| "Kaynak boyutu okunamıyor.")?.len() > MAX_FILE { return Err("Kaynak dosyası boyut sınırını aşıyor.".into()); }
    let mut value = String::new(); file.take(MAX_FILE + 1).read_to_string(&mut value).map_err(|_| "Kaynak UTF-8 değil.")?;
    if value.len() as u64 > MAX_FILE { return Err("Kaynak boyut sınırını aşıyor.".into()); }
    Ok(value)
}
// Valve KeyValues uses quoted strings and braces. Only requested fields are retained.
fn tokens(text: &str) -> Result<Vec<String>, String> {
    let mut out = Vec::new(); let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if c.is_whitespace() { continue; }
        if c == '/' && chars.peek() == Some(&'/') { while chars.next().is_some_and(|v| v != '\n') {} continue; }
        if c == '{' || c == '}' { out.push(c.to_string()); continue; }
        if c != '"' { return Err("Geçersiz Steam manifest biçimi.".into()); }
        let mut token = String::new(); let mut closed = false;
        while let Some(v) = chars.next() {
            if v == '"' { closed = true; break; }
            if v == '\\' { match chars.next() { Some('\\') => token.push('\\'), Some('"') => token.push('"'), Some(v) => { token.push('\\'); token.push(v); }, None => return Err("Eksik kaçış.".into()) } }
            else { token.push(v); }
        }
        if !closed { return Err("Eksik Steam manifest dizesi.".into()); }
        out.push(token);
    }
    Ok(out)
}
fn fields(text: &str, depth_wanted: usize) -> Result<HashMap<String,String>, String> {
    let t = tokens(text)?; let mut out = HashMap::new(); let mut depth = 0usize; let mut i = 0;
    while i < t.len() {
        match t[i].as_str() {
            "{" => { depth += 1; if depth > 16 { return Err("Manifest çok derin.".into()); } i+=1; },
            "}" => { depth = depth.checked_sub(1).ok_or("Manifest parantez hatası.")?; i+=1; },
            _ => { let value = t.get(i+1).ok_or("Manifest değeri eksik.")?; if value == "{" { i+=1; } else if value == "}" { return Err("Manifest değeri eksik.".into()); } else { if depth == depth_wanted { out.insert(t[i].clone(),value.clone()); } i+=2; } }
        }
    }
    if depth != 0 { return Err("Manifest kapanmadı.".into()); } Ok(out)
}
#[derive(Debug)] struct Manifest { id:String, name:String, flags:u64, bytes:Option<u64>, total:Option<u64>, build:String }
fn manifest(text: &str) -> Result<Manifest, String> {
    let f = fields(text,1)?;
    let id = f.get("appid").filter(|v| !v.is_empty() && v.bytes().all(|c| c.is_ascii_digit())).ok_or("Steam appid eksik.")?.clone();
    let name = f.get("name").filter(|v| !v.is_empty() && v.len() <= 512).ok_or("Steam adı eksik.")?.clone();
    let num = |key| f.get(key).and_then(|v| v.parse::<u64>().ok());
    let bytes = num("BytesDownloaded"); let total = num("BytesToDownload").filter(|v| *v>0);
    if bytes.zip(total).is_some_and(|(b,t)| b>t) { return Err("Tutarsız Steam byte sayaçları.".into()); }
    Ok(Manifest { id,name, flags:num("StateFlags").ok_or("Steam state eksik.")?, bytes,total,build:f.get("TargetBuildID").or_else(||f.get("buildid")).cloned().unwrap_or_default() })
}
fn steam_root() -> Option<PathBuf> {
    // Actual registry installation path before conventional fallback; no registry writes.
    #[cfg(windows)] {
        use std::os::windows::process::CommandExt;
        let output = std::process::Command::new(std::env::var_os("SystemRoot").map(PathBuf::from).unwrap_or_else(||PathBuf::from("C:\\Windows")).join("System32/reg.exe"))
            .args(["query", "HKCU\\Software\\Valve\\Steam", "/v", "SteamPath"]).creation_flags(0x08000000).output();
        if let Ok(output) = output { if output.status.success() { for line in String::from_utf8_lossy(&output.stdout).lines() { if let Some((_,path)) = line.split_once("REG_SZ") { let path = PathBuf::from(path.trim()); if path.join("steamapps").is_dir() { return Some(path); } } } } }
    }
    std::env::var_os("ProgramFiles(x86)").map(PathBuf::from).map(|p|p.join("Steam")).filter(|p|p.join("steamapps").is_dir())
}
fn libraries(root: &Path) -> Vec<PathBuf> {
    let mut out=vec![root.join("steamapps")];
    if let Ok(text)=read_bounded(&root.join("steamapps/libraryfolders.vdf")) { if let Ok(t)=tokens(&text) { for pair in t.windows(2) { if pair[0]=="path" { let path=PathBuf::from(&pair[1]); if path.is_absolute() { out.push(path.join("steamapps")); } } } } }
    out.sort(); out.dedup(); out.truncate(32); out
}
fn steam_artwork(root: &Path, appid: &str) -> Option<String> {
    if appid.is_empty() || !appid.bytes().all(|b|b.is_ascii_digit()) { return None; }
    let cache = root.join("appcache/librarycache");
    let folder = cache.join(appid);
    let mut candidates = vec![folder.join("library_600x900.jpg"),folder.join("library_capsule.jpg"),folder.join("library_header.jpg"),cache.join(format!("{appid}_library_600x900.jpg")), cache.join(format!("{appid}_header.jpg"))];
    if let Ok(entries) = fs::read_dir(&folder) {
        for entry in entries.take(32).flatten().filter(|e|e.path().is_dir()) {
            candidates.push(entry.path().join("library_600x900.jpg"));
            candidates.push(entry.path().join("library_capsule.jpg"));
            candidates.push(entry.path().join("library_header.jpg"));
        }
    }
    let safe_root = cache.canonicalize().ok()?;
    for path in candidates {
        let Ok(path) = path.canonicalize() else { continue; };
        if !path.starts_with(&safe_root) { continue; }
        let Ok(file) = fs::File::open(path) else { continue; };
        let Ok(meta) = file.metadata() else { continue; };
        if meta.len() > 1024*1024 { continue; }
        let mut bytes = Vec::new();
        if file.take(1024*1024+1).read_to_end(&mut bytes).is_ok() && bytes.len() <= 1024*1024 && bytes.starts_with(&[0xff,0xd8,0xff]) {
            return Some(format!("data:image/jpeg;base64,{}",crate::gemini::base64_for(&bytes)));
        }
    }
    None
}
fn logged_rate(text: &str, date: &str, seconds: i32) -> Option<(String,f64)> {
    let mut downloading = HashSet::new();
    let mut rate = None;
    for line in text.lines() {
        if let Some(rest)=line.split("AppID ").nth(1) {
            if let Some((id,state))=rest.split_once(" App update changed : ") {
                if id.bytes().all(|b|b.is_ascii_digit()) {
                    if state.split(',').any(|part|part.trim()=="Downloading") { downloading.insert(id.to_string()); }
                    else { downloading.remove(id); }
                }
            }
        }
        if let Some(raw)=line.split("Current download rate: ").nth(1).and_then(|s|s.strip_suffix(" Mbps")) {
            rate=None;
            let stamp=line.strip_prefix('[')?.split(']').next()?;
            let Some((day,time))=stamp.split_once(' ') else { continue; };
            let values=time.split(':').map(str::parse::<i32>).collect::<std::result::Result<Vec<_>,_>>().ok()?;
            if values.len()!=3 { continue; }
            let age=seconds-(values[0]*3600+values[1]*60+values[2]);
            if day==date && (0..=90).contains(&age) {
                if let Ok(value)=raw.parse::<f64>() { if value.is_finite()&&value>0. { rate=Some(value*1_000_000./8.); } }
            }
        }
    }
    // Steam reports an aggregate rate: attribute it only to ONE known active transfer.
    if downloading.len()!=1{return None;}Some((downloading.into_iter().next()?,rate?))
}
fn live_logged_rate(root:&Path)->Option<(String,f64)> {
    let mut file=fs::File::open(root.join("logs/content_log.txt")).ok()?;
    let size=file.metadata().ok()?.len();file.seek(SeekFrom::Start(size.saturating_sub(128*1024))).ok()?;
    let mut text=String::new();file.take(128*1024).read_to_string(&mut text).ok()?;
    let now=unsafe{windows::Win32::System::SystemInformation::GetLocalTime()};
    logged_rate(&text,&format!("{:04}-{:02}-{:02}",now.wYear,now.wMonth,now.wDay),i32::from(now.wHour)*3600+i32::from(now.wMinute)*60+i32::from(now.wSecond))
}
fn steam_snapshot(cache: &mut Cache, root: Option<PathBuf>, now: Instant) -> (Vec<Download>,SourceStatus) {
    let Some(root)=root else { return (vec![],SourceStatus {source:"steam".into(),state:"unavailable".into(),detail:"Steam kurulumu bulunamadı.".into()}); };
    let mut items=Vec::new(); let mut seen=HashSet::new(); let mut read_count=0; let mut unreadable=0;
    for lib in libraries(&root) {
        let Ok(entries)=fs::read_dir(lib) else { unreadable+=1; continue; };
        for entry in entries.take(2048).flatten() {
            let name=entry.file_name().to_string_lossy().to_string();
            if !(name.starts_with("appmanifest_") && name.ends_with(".acf")) { continue; }
            read_count+=1;
            let Ok(m)=read_bounded(&entry.path()).and_then(|t|manifest(&t)) else { unreadable+=1; continue; };
            let id=format!("steam:{}",m.id); if !seen.insert(id.clone()) { continue; }
            // StateFlags is source evidence, not a percentage. Installed historical rows are omitted.
            let active=m.flags & (2|256|512|1024|65536|131072|262144|524288|2097152|4194304|8388608) != 0;
            let state=if m.flags & 512 !=0 { "paused" } else if m.flags & 1024 !=0 { "downloading" } else if m.flags & (256|131072|262144|524288|2097152|4194304)!=0 { "installing" } else if active { "queued" } else { "idle" };
            let previous=cache.steam.get(&id);
            let speed=if active && state=="downloading" { previous.and_then(|p|{
                let elapsed=now.duration_since(p.at?).as_secs_f64();
                let current=m.bytes?; let total=m.total?;
                if p.active && p.network_active && p.total==total && current>p.bytes && elapsed>=0.5 && elapsed<=30. { Some((current-p.bytes) as f64/elapsed) } else { None }
            }) } else { None };
            let eta=speed.and_then(|s|m.bytes.zip(m.total).map(|(b,t)|(t-b) as f64/s));
            let complete=previous.is_some_and(|p|p.active && p.transfer_seen) && !active && m.flags & 4 !=0 && m.total.zip(m.bytes).is_some_and(|(t,b)|b==t);
            let artwork=if active || complete { steam_artwork(&root,&m.id) } else { None };
            let item=Download { id:id.clone(),source:"steam".into(),name:m.name,state:if complete {"complete".into()} else {state.into()},received_bytes:m.bytes,total_bytes:m.total,bytes_per_second:speed,eta_seconds:eta,artwork,completion_id:complete.then(||format!("steam:{}:{}:{}",m.id,m.build,m.total.unwrap_or(0))) };
            if complete { cache.completed.insert(id.clone(),(item.clone(),now)); }
            // ACF is flushed intermittently: measure elapsed time since the last byte change,
            // not since the last UI poll (which would inflate speeds after a delayed flush).
            let network_active=state=="downloading";
            let at=previous.filter(|p|p.bytes==m.bytes.unwrap_or(0) && p.total==m.total.unwrap_or(0) && p.active==active && p.network_active==network_active).and_then(|p|p.at).unwrap_or(now);
            let transfer_seen=active && (m.flags & (1024|131072|262144|2097152|4194304)!=0 || previous.is_some_and(|p|p.active && p.transfer_seen && Some(p.total)==m.total));
            cache.steam.insert(id.clone(), Sample{bytes:m.bytes.unwrap_or(0),total:m.total.unwrap_or(0),at:Some(at),active,network_active,transfer_seen});
            if active { items.push(item); }
        }
    }
    cache.steam.retain(|id,_|seen.contains(id)); cache.completed.retain(|_,(_,at)|now.duration_since(*at).as_secs()<120);
    items.extend(cache.completed.values().map(|(d,_)|d.clone())); items.sort_by(|a,b|a.id.cmp(&b.id)); items.truncate(128);
    if items.iter().filter(|item|item.state=="downloading").count()==1 {
        if let Some((appid,speed))=live_logged_rate(&root) {
            if let Some(item)=items.iter_mut().find(|item|item.id==format!("steam:{appid}")&&item.state=="downloading") {
                item.bytes_per_second=Some(speed);
                item.eta_seconds=item.received_bytes.zip(item.total_bytes).filter(|(b,t)|b<=t).map(|(b,t)|(t-b)as f64/speed);
            }
        }
    }
    (items,SourceStatus{source:"steam".into(),state:if read_count==0 || unreadable>0 {"degraded".into()} else {"connected".into()},detail:if unreadable>0 {format!("{read_count} manifest; {unreadable} kaynak okunamadı. Atölye indirmeleri bu adaptöre dahil değil.")} else {format!("{read_count} oyun manifesti okundu. Hız/ETA yalnız gerçek byte artışından; atölye hariç.")}})
}
fn zen_snapshot() -> (Vec<Download>,SourceStatus) {
    let mut status=SourceStatus{source:"zen".into(),state:"bridge_required".into(),detail:"Zen indirmeleri için izinli Coucou Downloads uzantısı ve native host kurulmalı. Tarayıcı geçmişi okunmaz.".into()};
    let Some(path)=zen_path().filter(|p|p.is_file()) else { return (vec![],status); };
    let now=SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64;
    let data=read_bounded(&path).and_then(|s|serde_json::from_str::<ZenEnvelope>(&s).map_err(|_|"Zen köprü verisi okunamadı.".to_string())).and_then(|v|validate_zen(&v,now).map(|_|v));
    let Ok(data)=data else { status.state="disconnected".into(); status.detail="Zen köprüsü bağlı değil veya verisi eski; son değerler canlı gösterilmez.".into(); return(vec![],status); };
    status.state="connected".into(); status.detail="Zen downloads API · yerel native messaging · yalnız dosya adı ve indirme sayaçları.".into();
    (data.items.into_iter().map(|i|Download{id:format!("zen:{}",i.id),source:"zen".into(),name:i.name,state:i.state,received_bytes:Some(i.received_bytes),total_bytes:i.total_bytes,bytes_per_second:i.bytes_per_second,eta_seconds:i.eta_seconds,artwork:None,completion_id:i.completion_id}).collect(),status)
}
#[tauri::command]
pub async fn downloads_snapshot(store:tauri::State<'_,Store>) -> Result<Snapshot,String> {
    // Small bounded local reads on a background worker; cache lock is held only during snapshot.
    let cache=store.cache.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let root=steam_root(); let mut cache=cache.lock().map_err(|_|"İndirme önbelleği kilitli.")?;
        let (mut items,steam)=steam_snapshot(&mut cache,root,Instant::now()); let (zen_items,zen)=zen_snapshot(); items.extend(zen_items);
        Ok(Snapshot{items,sources:vec![steam,zen]})
    }).await.map_err(|_|"İndirme bilgisi alınamadı.")?
}
#[derive(Clone,Debug,Serialize)] pub struct Completion { pub id:String, pub name:String, pub source:String }
#[derive(Default)] struct CompletionWatch { active:HashSet<String>, emitted:std::collections::VecDeque<String> }
impl CompletionWatch {
    fn observe(&mut self,items:&[Download])->Vec<Completion>{
        let mut events=Vec::new();
        for item in items {
            if item.state=="complete" {
                if let Some(id)=&item.completion_id {
                    if self.active.remove(&item.id) && !self.emitted.contains(id) {
                        self.emitted.push_back(id.clone()); events.push(Completion{id:id.clone(),name:item.name.clone(),source:item.source.clone()});
                        while self.emitted.len()>256 {self.emitted.pop_front();}
                    }
                }
            } else if matches!(item.state.as_str(),"downloading"|"installing"|"queued"|"paused") { self.active.insert(item.id.clone()); }
        }
        // The source snapshots are bounded to 256 rows. Remove disappeared rows rather than
        // treating an old download with a reused ID as a newly observed transfer.
        self.active.retain(|id|items.iter().any(|i|&i.id==id && i.state!="complete"));
        events
    }
}
pub fn start(app:tauri::AppHandle){
    use tauri::{Emitter,Manager};
    std::thread::spawn(move||{
        let mut watch=CompletionWatch::default(); let mut root:Option<PathBuf>=None; let mut root_checked:Option<Instant>=None;
        loop {
            std::thread::sleep(std::time::Duration::from_secs(2));
            let enabled=app.state::<crate::Shared>().settings.lock().map(|s|s.bar.download_notifications).unwrap_or(false);
            if !enabled || crate::integrations::PAUSED.load(std::sync::atomic::Ordering::Relaxed) { watch=CompletionWatch::default(); continue; }
            let now=Instant::now();
            if root_checked.is_none_or(|at|now.duration_since(at).as_secs()>=60){root=steam_root();root_checked=Some(now);}
            let state=app.state::<Store>();
            let Ok(mut cache)=state.cache.lock()else{continue};
            let (mut items,_)=steam_snapshot(&mut cache,root.clone(),now); drop(cache);
            let (zen,_)=zen_snapshot();items.extend(zen);
            let events=watch.observe(&items);
            // Preferences may have changed during IO. Never emit while pause/disable is active.
            if crate::integrations::PAUSED.load(std::sync::atomic::Ordering::Relaxed) || !app.state::<crate::Shared>().settings.lock().map(|s|s.bar.download_notifications).unwrap_or(false) {watch=CompletionWatch::default();continue;}
            for event in events {let _=app.emit("download-complete",event);}
        }
    });
}
#[cfg(test)] mod tests {
    use super::*;
    #[test]fn art_accepts_direct_and_hashed_cache_but_not_non_images(){
        let root=std::env::temp_dir().join(format!("coucou-art-test-{}",SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
        let direct=root.join("appcache/librarycache/730");let hashed=root.join("appcache/librarycache/1857950/hash");
        fs::create_dir_all(&direct).unwrap();fs::create_dir_all(&hashed).unwrap();
        let a=direct.join("library_600x900.jpg");let b=hashed.join("library_capsule.jpg");
        fs::write(&a,[0xff,0xd8,0xff,0x00]).unwrap();fs::write(&b,[0xff,0xd8,0xff,0x00]).unwrap();
        assert!(steam_artwork(&root,"730").is_some());assert!(steam_artwork(&root,"1857950").is_some());assert!(steam_artwork(&root,"../secret").is_none());
        fs::write(&a,b"not an image").unwrap();assert!(steam_artwork(&root,"730").is_none());
        fs::remove_file(a).unwrap();fs::remove_file(b).unwrap();fs::remove_dir(hashed).unwrap();fs::remove_dir(direct).unwrap();
        fs::remove_dir(root.join("appcache/librarycache/1857950")).unwrap();fs::remove_dir(root.join("appcache/librarycache")).unwrap();fs::remove_dir(root.join("appcache")).unwrap();fs::remove_dir(root).unwrap();
    }
    #[test] fn logged_rate_is_real_fresh_and_unambiguous() {
        let text="[2026-10-02 00:02:00] AppID 1857950 App update changed : Running Update,Downloading,Staging,\n[2026-10-02 00:02:10] Current download rate: 11.416 Mbps";
        let (id,bytes)=logged_rate(text,"2026-10-02",140).unwrap();
        assert_eq!(id,"1857950");assert_eq!(bytes,1_427_000.);
        assert!(logged_rate(text,"2026-10-02",230).is_none());
        assert!(logged_rate(text,"2026-10-03",140).is_none());
        assert!(logged_rate(&format!("{text}\n[2026-10-02 00:02:11] AppID 1857950 App update changed : None"),"2026-10-02",140).is_none());
        assert!(logged_rate(&format!("{text}\n[2026-10-02 00:02:11] AppID 730 App update changed : Downloading,"),"2026-10-02",140).is_none());
    }
    #[test] fn manifest_parsing_and_bad_boundaries() {
        let source=r#""AppState" { "appid" "730" "name" "Türkçe Oyun" "StateFlags" "1024" "BytesToDownload" "100" "BytesDownloaded" "40" "InstalledDepots" { "1" { "name" "wrong" } } }"#;
        let m=manifest(source).unwrap(); assert_eq!(m.name,"Türkçe Oyun"); assert_eq!(m.bytes,Some(40)); assert_eq!(m.total,Some(100));
        assert!(manifest(&source.replace("\"40\"","\"101\"")).is_err()); assert!(manifest(&source.replace("\"730\"","\"bad\"")).is_err()); assert!(tokens("\"broken").is_err()); assert!(fields("\"x\" {",1).is_err());
    }
    #[test] fn library_windows_paths() { let t=tokens(r#""libraryfolders" { "0" { "path" "D:\\SteamLibrary" } }"#).unwrap(); assert!(t.contains(&"D:\\SteamLibrary".to_string())); }
    #[test] fn zen_requires_fresh_real_consistent_samples() {
        let mut z=ZenEnvelope{version:1,sampled_at_ms:10000,items:vec![ZenItem{id:1,name:"test.zip".into(),state:"downloading".into(),received_bytes:50,total_bytes:Some(100),bytes_per_second:None,eta_seconds:None,completion_id:None}]};
        assert!(validate_zen(&z,10000).is_ok()); assert!(validate_zen(&z,30000).is_err()); z.items[0].received_bytes=101; assert!(validate_zen(&z,10000).is_err()); z.items[0].received_bytes=50; z.items[0].bytes_per_second=Some(f64::NAN); assert!(validate_zen(&z,10000).is_err());
    }
    #[test] fn real_steam_read_only_smoke() { let Some(root)=steam_root() else {return;}; let count=libraries(&root).len(); let (items,status)=steam_snapshot(&mut Cache::default(),Some(root),Instant::now()); eprintln!("Steam read-only evidence: {count} library paths; {}; {} active/recent rows; {} cached covers; state={}",status.detail,items.len(),items.iter().filter(|i|i.artwork.is_some()).count(),status.state); assert_ne!(status.state,"unavailable"); assert!(items.iter().all(|i|i.bytes_per_second.is_none_or(|s|s.is_finite()&&s>0.&&i.state=="downloading"))); }
    #[test] fn sampled_speed_completion_and_historical_rows() {
        let root=std::env::temp_dir().join(format!("coucou-download-test-{}-{}",std::process::id(),SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
        let dir=root.join("steamapps"); fs::create_dir_all(&dir).unwrap(); let path=dir.join("appmanifest_730.acf");
        let write=|flags,bytes|fs::write(&path,format!("\"AppState\" {{ \"appid\" \"730\" \"name\" \"Test\" \"StateFlags\" \"{flags}\" \"BytesToDownload\" \"100\" \"BytesDownloaded\" \"{bytes}\" \"TargetBuildID\" \"200\" }}")).unwrap();
        let start=Instant::now(); let mut cache=Cache::default();
        write(1024,0); let (items,_)=steam_snapshot(&mut cache,Some(root.clone()),start); assert_eq!(items.len(),1); assert_eq!(items[0].bytes_per_second,None);
        // A poll without a byte increase must not reset the averaging baseline.
        steam_snapshot(&mut cache,Some(root.clone()),start+std::time::Duration::from_secs(4));
        write(1024,50); let (items,_)=steam_snapshot(&mut cache,Some(root.clone()),start+std::time::Duration::from_secs(5)); assert_eq!(items[0].bytes_per_second,Some(10.)); assert_eq!(items[0].eta_seconds,Some(5.));
        write(4,100); let (items,_)=steam_snapshot(&mut cache,Some(root.clone()),start+std::time::Duration::from_secs(10)); assert_eq!(items[0].state,"complete"); assert_eq!(items[0].completion_id.as_deref(),Some("steam:730:200:100"));
        assert!(steam_snapshot(&mut Cache::default(),Some(root.clone()),start).0.is_empty(),"Historical installed games are not fresh completions");
        assert!(steam_snapshot(&mut cache,Some(root.clone()),start+std::time::Duration::from_secs(140)).0.is_empty());
        fs::remove_file(path).unwrap(); fs::remove_dir(dir).unwrap(); fs::remove_dir(root).unwrap();
    }
    #[test] fn completion_notifications_are_observed_deduplicated_not_backlog(){
        let mut watch=CompletionWatch::default();let mut item=Download{id:"zen:1".into(),source:"zen".into(),name:"test.zip".into(),state:"complete".into(),received_bytes:Some(100),total_bytes:Some(100),bytes_per_second:None,eta_seconds:None,artwork:None,completion_id:Some("zen:1:cycle-a".into())};
        assert!(watch.observe(&[item.clone()]).is_empty());
        item.state="downloading".into();item.completion_id=None;assert!(watch.observe(&[item.clone()]).is_empty());
        item.state="complete".into();item.completion_id=Some("zen:1:cycle-a".into());assert_eq!(watch.observe(&[item.clone()]).len(),1);assert!(watch.observe(&[item.clone()]).is_empty());
        item.state="downloading".into();item.completion_id=None;watch.observe(&[item.clone()]);item.state="complete".into();item.completion_id=Some("zen:1:cycle-a".into());assert!(watch.observe(&[item.clone()]).is_empty());
        assert!(CompletionWatch::default().observe(&[item]).is_empty(),"Startup/resume never replays completion backlog");
    }
}
