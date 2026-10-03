//! Spotify-only Windows media sessions. Never fall back to the current player.
use serde::Serialize;
use windows::{core::{Interface, PWSTR}, Win32::{Foundation::CloseHandle, Media::Audio::{IMMDeviceEnumerator, MMDeviceEnumerator, IAudioSessionManager2, IAudioSessionControl2, ISimpleAudioVolume, eRender, DEVICE_STATE_ACTIVE}, System::{Com::{CoCreateInstance, CLSCTX_ALL}, Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_NAME_WIN32}}}};
use windows::{Media::Control::{GlobalSystemMediaTransportControlsSession as Session, GlobalSystemMediaTransportControlsSessionManager as Manager, GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status}, Storage::Streams::{DataReader, InputStreamOptions}, Win32::System::WinRT::{RoInitialize, RoUninitialize, RO_INIT_MULTITHREADED}};

struct Apartment;
impl Apartment { fn new() -> Result<Self, String> { unsafe { RoInitialize(RO_INIT_MULTITHREADED) }.map_err(|_| "Windows medya servisi başlatılamadı.")?; Ok(Self) } }
impl Drop for Apartment { fn drop(&mut self) { unsafe { RoUninitialize(); } } }
fn spotify_id(id: &str) -> bool {
    let id = id.to_ascii_lowercase();
    id == "spotify.exe" || id == "spotify" || id.starts_with("spotifyab.spotifymusic_") && id.ends_with("!spotify")
}
fn session() -> Result<Option<Session>, String> {
    let manager = Manager::RequestAsync().and_then(|v| v.get()).map_err(|_| "Windows medya oturumları okunamadı.")?;
    let sessions = manager.GetSessions().map_err(|_| "Windows medya oturumları okunamadı.")?;
    for s in sessions { if s.SourceAppUserModelId().is_ok_and(|id| spotify_id(&id.to_string())) { return Ok(Some(s)); } }
    Ok(None)
}
#[derive(Serialize, Default)]
#[serde(rename_all="camelCase")]
pub struct Snapshot { connected: bool, title: String, artist: String, album: String, playing: bool, position: f64, duration: f64, can_play: bool, can_pause: bool, can_next: bool, can_previous: bool, can_seek: bool, volume: Option<f32>, can_volume: bool, artwork: Option<String> }
// The Windows per-process mixer only. Never IAudioEndpointVolume/global volume.
fn spotify_process(pid:u32) -> bool {
    unsafe {
        let Ok(handle)=OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION,false,pid) else{return false};
        let mut path=vec![0u16;32768]; let mut length=path.len() as u32;
        let ok=QueryFullProcessImageNameW(handle,PROCESS_NAME_WIN32,PWSTR(path.as_mut_ptr()),&mut length).is_ok();
        let _=CloseHandle(handle);
        ok && String::from_utf16_lossy(&path[..length as usize]).rsplit('\\').next().is_some_and(|name|name.eq_ignore_ascii_case("spotify.exe"))
    }
}
fn volume_sessions() -> windows::core::Result<Vec<ISimpleAudioVolume>> {
    unsafe {
        let enumerator:IMMDeviceEnumerator=CoCreateInstance(&MMDeviceEnumerator,None,CLSCTX_ALL)?;
        let endpoints=enumerator.EnumAudioEndpoints(eRender,DEVICE_STATE_ACTIVE)?;
        let mut result=vec![];
        for index in 0..endpoints.GetCount()? {
            let Ok(device)=endpoints.Item(index) else{continue};
            let Ok(manager)=device.Activate::<IAudioSessionManager2>(CLSCTX_ALL,None) else{continue};
            let Ok(sessions)=manager.GetSessionEnumerator() else{continue};
            for j in 0..sessions.GetCount()? {
                let Ok(control)=sessions.GetSession(j) else{continue};
                let Ok(process)=control.cast::<IAudioSessionControl2>() else{continue};
                if process.GetProcessId().is_ok_and(spotify_process) {
                    if let Ok(volume)=control.cast::<ISimpleAudioVolume>() {result.push(volume);}
                }
            }
        }
        Ok(result)
    }
}
fn bounded(value:f64,min:f64,max:f64)->Result<f64,String>{
    if !value.is_finite() || !min.is_finite() || !max.is_finite() || min>max || value<min || value>max {Err("Spotify değeri geçerli aralığın dışında.".into())}else{Ok(value)}
}
fn snapshot() -> Result<Snapshot, String> {
    let _apartment = Apartment::new()?;
    let Some(s) = session()? else { return Ok(Snapshot::default()); };
    let props = s.TryGetMediaPropertiesAsync().and_then(|v| v.get()).map_err(|_| "Spotify parça bilgisi okunamadı.")?;
    let info = s.GetPlaybackInfo().map_err(|_| "Spotify oynatma bilgisi okunamadı.")?;
    let controls = info.Controls().map_err(|_| "Spotify kontrolleri okunamadı.")?;
    let timeline = s.GetTimelineProperties().ok();
    let position = timeline.as_ref().and_then(|t| t.Position().ok()).map_or(0., |v| v.Duration as f64 / 10_000_000.);
    let duration = timeline.as_ref().and_then(|t| t.EndTime().ok()).map_or(0., |v| v.Duration as f64 / 10_000_000.);
    let seek_range=timeline.as_ref().and_then(|t|Some((t.MinSeekTime().ok()?.Duration,t.MaxSeekTime().ok()?.Duration)));
    let volume=volume_sessions().ok().and_then(|sessions|sessions.into_iter().find_map(|v|unsafe{v.GetMasterVolume().ok()}));
    let artwork = (|| -> windows::core::Result<Option<String>> {
        let thumb = props.Thumbnail()?;
        let stream = thumb.OpenReadAsync()?.get()?;
        if stream.Size()? > 256 * 1024 { return Ok(None); }
        let mime = stream.ContentType()?.to_string();
        if !matches!(mime.as_str(), "image/png" | "image/jpeg") { return Ok(None); }
        let reader = DataReader::CreateDataReader(&stream.GetInputStreamAt(0)?)?;
        reader.SetInputStreamOptions(InputStreamOptions::None)?;
        let count = reader.LoadAsync(stream.Size()? as u32)?.get()?;
        if count as u64 != stream.Size()? { return Ok(None); }
        let mut bytes = vec![0; count as usize]; reader.ReadBytes(&mut bytes)?;
        Ok(Some(format!("data:{mime};base64,{}", crate::gemini::base64_for(&bytes))))
    })().ok().flatten();
    Ok(Snapshot { connected:true, title: props.Title().unwrap_or_default().to_string(), artist:props.Artist().unwrap_or_default().to_string(), album:props.AlbumTitle().unwrap_or_default().to_string(), playing:info.PlaybackStatus().is_ok_and(|v| v==Status::Playing), position, duration, can_play:controls.IsPlayEnabled().unwrap_or(false), can_pause:controls.IsPauseEnabled().unwrap_or(false), can_next:controls.IsNextEnabled().unwrap_or(false), can_previous:controls.IsPreviousEnabled().unwrap_or(false), can_seek:duration>0. && seek_range.is_some_and(|(min,max)|max>min) && controls.IsPlaybackPositionEnabled().unwrap_or(false), volume, can_volume:volume.is_some(), artwork })
}
#[tauri::command]
pub async fn spotify_seek(position:f64)->Result<Snapshot,String>{
    tauri::async_runtime::spawn_blocking(move||seek(position)).await.map_err(|_|"Spotify zaman konumu değiştirilemedi.")?
}
fn seek(position:f64)->Result<Snapshot,String>{
    {let _apartment=Apartment::new()?;
    let s=session()?.ok_or("Spotify medya oturumu yok.")?;
    let controls=s.GetPlaybackInfo().and_then(|v|v.Controls()).map_err(|_|"Spotify kontrolleri okunamadı.")?;
    if !controls.IsPlaybackPositionEnabled().unwrap_or(false){return Err("Bu Spotify parçası zaman değiştirmeyi desteklemiyor.".into());}
    let timeline=s.GetTimelineProperties().map_err(|_|"Spotify zaman bilgisi okunamadı.")?;
    let min=timeline.MinSeekTime().map_err(|_|"Spotify zaman aralığı okunamadı.")?.Duration as f64/10_000_000.;
    let max=timeline.MaxSeekTime().map_err(|_|"Spotify zaman aralığı okunamadı.")?.Duration as f64/10_000_000.;
    let position=bounded(position,min,max)?;
    if !s.TryChangePlaybackPositionAsync((position*10_000_000.).round() as i64).and_then(|v|v.get()).map_err(|_|"Spotify zaman konumu değiştirilemedi.")?{return Err("Spotify zaman değiştirme isteğini reddetti.".into());}}
    snapshot()
}
#[tauri::command]
pub async fn spotify_volume(volume:f64)->Result<Snapshot,String>{
    tauri::async_runtime::spawn_blocking(move||set_volume(volume)).await.map_err(|_|"Spotify sesi değiştirilemedi.")?
}
fn set_volume(volume:f64)->Result<Snapshot,String>{
    let volume=bounded(volume,0.,1.)? as f32;
    {let _apartment=Apartment::new()?;
    let sessions=volume_sessions().map_err(|_|"Spotify ses oturumları okunamadı.")?;
    if sessions.is_empty(){return Err("Spotify ses oturumu yok; Spotify'da bir parça aç.".into());}
    let originals:Vec<_>=sessions.into_iter().map(|s|unsafe{s.GetMasterVolume().map(|v|(s,v))}).collect::<windows::core::Result<_>>().map_err(|_|"Spotify ses düzeyi okunamadı.")?;
    for(s,_)in &originals{if unsafe{s.SetMasterVolume(volume,std::ptr::null())}.is_err(){
        for(s,original)in &originals{let _=unsafe{s.SetMasterVolume(*original,std::ptr::null())};}
        return Err("Spotify sesi değiştirilemedi; önceki düzeyler geri yüklenmeye çalışıldı.".into());
    }}}
    snapshot()
}
#[tauri::command]
pub async fn spotify_snapshot() -> Result<Snapshot, String> { tauri::async_runtime::spawn_blocking(snapshot).await.map_err(|_| "Spotify bilgisi alınamadı.")? }
#[tauri::command]
pub async fn spotify_action(action: String) -> Result<Snapshot, String> {
    tauri::async_runtime::spawn_blocking(move || act(&action)).await.map_err(|_| "Spotify komutu tamamlanamadı.")?
}
fn act(action: &str) -> Result<Snapshot, String> {
        { let _apartment = Apartment::new()?;
          let s = session()?.ok_or("Spotify'da bir parça aç; medya oturumu henüz yok.")?;
          let accepted = match action { "play" => s.TryPlayAsync(), "pause" => s.TryPauseAsync(), "next" => s.TrySkipNextAsync(), "previous" => s.TrySkipPreviousAsync(), _ => return Err("Geçersiz Spotify komutu.".into()) }.and_then(|v| v.get()).map_err(|_| "Spotify komutu başarısız oldu.")?;
          if !accepted { return Err("Spotify bu komutu kabul etmedi.".into()); }
        }
        snapshot()
}
#[cfg(test)] mod tests { use super::*;
    #[test] fn volume_and_seek_boundaries(){for v in [f64::NAN,f64::INFINITY,-0.1,1.1]{assert!(bounded(v,0.,1.).is_err());}assert_eq!(bounded(0.,0.,1.).unwrap(),0.);assert_eq!(bounded(1.,0.,1.).unwrap(),1.);assert!(bounded(10.,0.,9.).is_err());}
    #[test] #[ignore="Changes only Spotify mixer levels briefly and restores every original session level"]
    fn live_spotify_volume_roundtrip(){
        let _apartment=Apartment::new().unwrap();
        let sessions=volume_sessions().unwrap();assert!(!sessions.is_empty(),"Open a Spotify track");
        let original:Vec<_>=sessions.into_iter().map(|s|{let v=unsafe{s.GetMasterVolume().unwrap()};(s,v)}).collect();
        struct Restore(Vec<(ISimpleAudioVolume,f32)>);
        impl Drop for Restore{fn drop(&mut self){for(s,v)in &self.0{let _=unsafe{s.SetMasterVolume(*v,std::ptr::null())};}}}
        let restore=Restore(original);
        let target=if restore.0[0].1>0.05{restore.0[0].1-0.02}else{0.02};
        set_volume(target as f64).unwrap();
        for(s,_)in &restore.0{assert!((unsafe{s.GetMasterVolume().unwrap()}-target).abs()<0.005);}
        let originals:Vec<_>=restore.0.iter().map(|(s,v)|(s.clone(),*v)).collect();drop(restore);
        for(s,v)in originals{assert!((unsafe{s.GetMasterVolume().unwrap()}-v).abs()<0.005);}
        println!("PASS: Spotify-only audio sessions changed and original per-session levels restored");
    }
    #[test] #[ignore="Pauses Spotify briefly, seeks, then restores original position and playback state"]
    fn live_spotify_seek_roundtrip(){
        let _apartment=Apartment::new().unwrap();let source=session().unwrap().expect("Open Spotify");let original=snapshot().unwrap();assert!(original.can_seek);
        struct Restore{source:Session,original:Snapshot}
        impl Drop for Restore{fn drop(&mut self){
            let current=self.source.TryGetMediaPropertiesAsync().and_then(|v|v.get()).and_then(|v|v.Title());
            if current.is_ok_and(|v|v.to_string()==self.original.title){let _=self.source.TryChangePlaybackPositionAsync((self.original.position*10_000_000.) as i64).and_then(|v|v.get());}
            let _=if self.original.playing{self.source.TryPlayAsync()}else{self.source.TryPauseAsync()}.and_then(|v|v.get());
        }}
        let restore=Restore{source,original};
        act("pause").unwrap();
        let target=if restore.original.position>3.{restore.original.position-2.}else{(restore.original.position+2.).min(restore.original.duration-1.)};
        seek(target).unwrap();let mut changed=false;
        for _ in 0..20{let current=snapshot().unwrap();if(current.position-target).abs()<0.75{changed=true;break;}std::thread::sleep(std::time::Duration::from_millis(100));}
        let original_position=restore.original.position;let original_playing=restore.original.playing;drop(restore);
        assert!(changed,"Accepted seek must change actual timeline");
        let mut restored=false;for _ in 0..20{let current=snapshot().unwrap();if(current.position-original_position).abs()<2. && current.playing==original_playing{restored=true;break;}std::thread::sleep(std::time::Duration::from_millis(100));}
        assert!(restored,"Original timeline and playback must restore");println!("PASS: Spotify seek changed actual timeline and restored position/playback");
    }
    #[test] fn only_spotify_sources() { assert!(spotify_id("Spotify.exe")); assert!(spotify_id("SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify")); for id in ["chrome.exe", "msedge.exe", "notspotify.exe", "SpotifyAB.Fake_123!Spotify"] { assert!(!spotify_id(id)); } }
    #[test] #[ignore="Read-only native Windows Spotify session acceptance check"] fn live_spotify_snapshot() {
        let value=snapshot().unwrap();
        println!("Spotify connected={}, playing={}, title_present={}, artwork_present={}",value.connected,value.playing,!value.title.is_empty(),value.artwork.is_some());
        assert!(value.connected,"Open a Spotify track for acceptance testing"); assert!(!value.title.is_empty()); assert!(value.duration>=0.); assert!(value.position>=0.);
    }
    #[test] #[ignore="Briefly toggles Spotify play/pause and restores original state"]
    fn live_spotify_transport_roundtrip() {
        let _apartment = Apartment::new().unwrap();
        let source = session().unwrap().expect("Open Spotify for this acceptance test");
        let original = snapshot().unwrap();
        struct Restore { source: Session, playing: bool }
        impl Drop for Restore { fn drop(&mut self) { let op=if self.playing {self.source.TryPlayAsync()} else {self.source.TryPauseAsync()}; if let Ok(op)=op { let _=op.get(); } } }
        let restore = Restore {source, playing:original.playing};
        act(if original.playing {"pause"} else {"play"}).unwrap();
        let mut changed=false;
        for _ in 0..20 { let state=snapshot().unwrap(); if state.playing!=original.playing {changed=true;break;} std::thread::sleep(std::time::Duration::from_millis(100)); }
        drop(restore);
        assert!(changed,"Spotify accepted the command but its playback state did not change");
        let mut restored=false;
        for _ in 0..20 { if snapshot().unwrap().playing==original.playing {restored=true;break;} std::thread::sleep(std::time::Duration::from_millis(100)); }
        assert!(restored,"Original playback state was not restored");
        println!("PASS: Spotify transport changed playback and restored its original state");
    }
}
