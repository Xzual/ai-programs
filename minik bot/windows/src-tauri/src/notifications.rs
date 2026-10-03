//! Opt-in notification previews. No notification deletion, fabricated reply API or persistent content.
use serde::Serialize;
use tauri::{Emitter,Manager};
use std::collections::HashSet;
use std::sync::{Arc, Mutex, atomic::{AtomicBool, Ordering}};
use windows::{ApplicationModel::Package, Foundation::Size, Storage::Streams::DataReader,
    UI::Notifications::{KnownNotificationBindings, NotificationKinds},
    UI::Notifications::Management::{UserNotificationListener, UserNotificationListenerAccessStatus as Access},
    Win32::System::WinRT::{RoInitialize, RoUninitialize, RO_INIT_MULTITHREADED},
    Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL}, core::PCWSTR};

#[derive(Clone, Serialize)]
#[serde(rename_all="camelCase")]
pub struct Item { pub id:u32, pub app:String, pub title:String, pub body:String, pub icon:Option<String>, pub created_at:i64, #[serde(skip)] aumid:String }
#[derive(Clone, Serialize)]
#[serde(rename_all="camelCase")]
pub struct Snapshot { pub enabled:bool, pub access:String, pub reason:String, pub items:Vec<Item>, pub inline_reply:bool }
impl Default for Snapshot { fn default()->Self {Self {enabled:false,access:"disabled".into(),reason:"Bildirim önizlemesi kapalı. İçerik yalnız bellekte tutulur.".into(),items:vec![],inline_reply:false}} }
pub struct Store { data:Mutex<Snapshot>, busy:Arc<AtomicBool>, private:AtomicBool }
impl Default for Store {fn default()->Self {Self{data:Mutex::new(Snapshot::default()),busy:Arc::new(AtomicBool::new(false)),private:AtomicBool::new(true)}}}
struct Apartment;
impl Apartment { fn new()->Result<Self,String>{unsafe{RoInitialize(RO_INIT_MULTITHREADED)}.map_err(|_|"Windows bildirim servisi başlatılamadı.")?;Ok(Self)} }
impl Drop for Apartment {fn drop(&mut self){unsafe{RoUninitialize()}}}
struct Busy(Arc<AtomicBool>);
impl Drop for Busy {fn drop(&mut self){self.0.store(false,Ordering::Release)}}
fn blocked(reason:&str)->Snapshot {Snapshot {access:"capability_required".into(),reason:reason.into(),..Default::default()}}
fn package_ready()->bool {Package::Current().is_ok()}
fn truncate(value:String,max:usize)->String {value.chars().filter(|c|!c.is_control()||*c=='\n').take(max).collect()}
fn read()->Result<Snapshot,String> {
    let _apartment=Apartment::new()?;
    if !package_ready(){return Ok(blocked("Windows bildirim erişimi için paket kimliği ve userNotificationListener capability gerekir. Bu geliştirme sürümünde bildirim okuma bağlı değil."));}
    let listener=UserNotificationListener::Current().map_err(|_|"Windows bildirim dinleyicisi kullanılamıyor.")?;
    if listener.GetAccessStatus().ok()!=Some(Access::Allowed){return Ok(Snapshot{access:"denied".into(),reason:"Windows bildirim izni yok veya kaldırıldı.".into(),..Default::default()});}
    let rows=listener.GetNotificationsAsync(NotificationKinds::Toast).and_then(|op|op.get()).map_err(|_|"Bildirim listesi okunamadı.")?;
    let mut items=vec![];
    let count=rows.Size().unwrap_or(0);
    for index in (count.saturating_sub(30)..count).rev() {
        let item=(||->windows::core::Result<Item>{
            let notification=rows.GetAt(index)?; let info=notification.AppInfo()?; let display=info.DisplayInfo()?;
            let aumid=info.AppUserModelId()?.to_string();
            let binding=notification.Notification()?.Visual()?.GetBinding(&KnownNotificationBindings::ToastGeneric()?)?;
            let texts=binding.GetTextElements()?; let mut lines=vec![];
            for i in 0..texts.Size()?.min(10){lines.push(truncate(texts.GetAt(i)?.Text()?.to_string(),1000));}
            let title=lines.first().cloned().unwrap_or_default(); let body=truncate(lines.into_iter().skip(1).collect::<Vec<_>>().join("\n"),2000);
            let icon=(||->windows::core::Result<Option<String>>{
                let stream=display.GetLogo(Size{Width:32.,Height:32.})?.OpenReadAsync()?.get()?;
                let size=stream.Size()?; if size==0||size>128*1024{return Ok(None)}
                let reader=DataReader::CreateDataReader(&stream.GetInputStreamAt(0)?)?;
                let loaded=reader.LoadAsync(size as u32)?.get()?;let mut bytes=vec![0;loaded as usize];reader.ReadBytes(&mut bytes)?;
                if !bytes.starts_with(b"\x89PNG\r\n\x1a\n"){return Ok(None)}
                Ok(Some(format!("data:image/png;base64,{}",crate::gemini::base64_for(&bytes))))
            })().ok().flatten();
            Ok(Item{id:notification.Id()?,app:truncate(display.DisplayName()?.to_string(),120),title,body,icon,aumid,created_at:notification.CreationTime()?.UniversalTime})
        })();
        if let Ok(item)=item{items.push(item)}
    }
    Ok(Snapshot{enabled:true,access:"allowed".into(),reason:"Yalnız Windows'un sunduğu bildirimler. Tıklama uygulamayı açar; tam konuşmaya geçiş veya doğrudan yanıt desteklenmez.".into(),items,inline_reply:false})
}

#[tauri::command]
pub async fn notifications_snapshot(state:tauri::State<'_,Store>)->Result<Snapshot,String>{
    let before=state.data.lock().map_err(|_|"Bildirim durumu okunamadı.")?.clone();if !before.enabled{return Ok(before)}
    if state.busy.swap(true,Ordering::AcqRel){return Ok(before)}
    let busy=state.busy.clone();let work=tauri::async_runtime::spawn_blocking(move||{let _busy=Busy(busy);read()});
    let result=tokio::time::timeout(std::time::Duration::from_secs(8),work).await.map_err(|_|"Windows bildirim yanıtı gecikti; tekrar dene.")?.map_err(|_|"Bildirim işlemi tamamlanamadı.")??;
    let mut current=state.data.lock().map_err(|_|"Bildirim durumu güncellenemedi.")?;
    // Do not restore previews after user disabled access while a read was in flight.
    if current.enabled{*current=result;}Ok(current.clone())
}
#[tauri::command]
pub async fn notifications_enable(enabled:bool,app:tauri::AppHandle,state:tauri::State<'_,Store>)->Result<Snapshot,String>{
    if !enabled{let mut data=state.data.lock().map_err(|_|"Bildirim durumu değiştirilemedi.")?;*data=Snapshot::default();let _=app.emit("notifications-preview",Option::<Item>::None);return Ok(data.clone())}
    let (tx,rx)=tokio::sync::oneshot::channel();
    app.run_on_main_thread(move||{
        // RequestAccessAsync is started on the UI thread, and never without this explicit click.
        let operation=if package_ready(){UserNotificationListener::Current().and_then(|l|l.RequestAccessAsync()).map(Some)}else{Ok(None)};
        let _=tx.send(operation);
    }).map_err(|_|"Windows izin ekranı açılamadı.")?;
    let operation=tokio::time::timeout(std::time::Duration::from_secs(5),rx).await.map_err(|_|"Windows izin ekranı yanıt vermedi.")?.map_err(|_|"Windows izin isteği tamamlanamadı.")?.map_err(|_|"Windows paket capability veya izin isteği kullanılamıyor.")?;
    let result=if let Some(operation)=operation{
        let access=tokio::time::timeout(std::time::Duration::from_secs(90),tauri::async_runtime::spawn_blocking(move||operation.get())).await.map_err(|_|"Bildirim izni bekleme süresi doldu.")?.map_err(|_|"İzin sonucu alınamadı.")?.map_err(|_|"Bildirim izni kullanılamıyor.")?;
        Snapshot{enabled:access==Access::Allowed,access:if access==Access::Allowed{"allowed"}else{"denied"}.into(),reason:if access==Access::Allowed{"İzin verildi; Yenile ile bildirimleri getir."}else{"Windows izin vermedi. Windows ayarlarından bildirim erişimini açabilirsin."}.into(),..Default::default()}
    }else{blocked("Bu sürüm paketlenmemiş. Windows userNotificationListener capability sağlanmadan bildirimler okunamaz.")};
    *state.data.lock().map_err(|_|"Bildirim durumu kaydedilemedi.")?=result.clone();Ok(result)
}
#[tauri::command]
pub fn notifications_privacy(hidden:bool,app:tauri::AppHandle,state:tauri::State<'_,Store>){state.private.store(hidden,Ordering::Release);let _=app.emit("notifications-preview",Option::<Item>::None);}
pub fn start(app:tauri::AppHandle){std::thread::spawn(move||{
    let mut seen:Option<HashSet<(u32,i64)>>=None;
    loop {
        std::thread::sleep(std::time::Duration::from_secs(2));
        let store=app.state::<Store>();
        if crate::integrations::PAUSED.load(Ordering::Acquire)||!store.data.lock().map(|s|s.enabled).unwrap_or(false){seen=None;continue}
        if store.busy.swap(true,Ordering::AcqRel){continue}
        let _busy=Busy(store.busy.clone());
        match read(){
            Ok(snapshot)=>{
                let current_ids=snapshot.items.iter().map(|item|(item.id,item.created_at)).collect::<HashSet<_>>();
                let newest=seen.as_ref().and_then(|previous|snapshot.items.iter().find(|item|!previous.contains(&(item.id,item.created_at)))).cloned();
                seen=Some(current_ids);
                if let Ok(mut current)=store.data.lock(){
                    if current.enabled{
                        *current=snapshot;
                        if let Some(mut item)=newest{
                            if store.private.load(Ordering::Acquire){item.title="Yeni bildirim".into();item.body.clear();}
                            let _=app.emit("notifications-preview",Some(item));
                        }
                        if !current.enabled{let _=app.emit("notifications-preview",Option::<Item>::None);}
                    }
                }
            }
            Err(_)=>{seen=None;}
        }
    }
});}
fn launchable(id:&str)->bool {!id.is_empty()&&id.len()<=300&&!id.chars().any(|c|c.is_control()||matches!(c,'/'|'\\'|':'|'"'|';'))}
#[tauri::command]
pub async fn notifications_open(id:u32,state:tauri::State<'_,Store>)->Result<(),String>{
    let target={let data=state.data.lock().map_err(|_|"Bildirim okunamadı.")?;if !data.enabled{return Err("Bildirim erişimi kapalı.".into())}data.items.iter().find(|item|item.id==id).map(|item|item.aumid.clone()).ok_or("Bildirim artık mevcut değil.")?};
    if !launchable(&target){return Err("Uygulama kimliği güvenli biçimde açılamıyor.".into())}
    tauri::async_runtime::spawn_blocking(move||{
        let destination=format!("shell:AppsFolder\\{target}").encode_utf16().chain(Some(0)).collect::<Vec<_>>();let verb="open".encode_utf16().chain(Some(0)).collect::<Vec<_>>();
        let result=unsafe{ShellExecuteW(None,PCWSTR(verb.as_ptr()),PCWSTR(destination.as_ptr()),None,None,SW_SHOWNORMAL)};
        if result.0 as isize>32{Ok(())}else{Err("Uygulama açma isteği reddedildi.".into())}
    }).await.map_err(|_|"Uygulama açma sonucu alınamadı.")?
}
#[cfg(test)]mod tests{use super::*;#[test]fn no_arbitrary_launch_targets(){assert!(launchable("5319275A.WhatsAppDesktop_cv1g1gvanyjgm!App"));for value in ["","C:/Windows/cmd.exe","x\\payload","x\nargs","http:evil"]{assert!(!launchable(value));}}#[test]fn bounded_preview(){assert_eq!(truncate("a\u{0000}b".into(),2),"ab");assert_eq!(truncate("🙂🙂🙂".into(),2),"🙂🙂");}
#[test]#[ignore="Read-only Windows package identity probe; never requests permission or reads messages"]
fn native_unpackaged_capability_gate(){let _apartment=Apartment::new().unwrap();assert!(!package_ready(),"This probe targets the current unpackaged debug build");let result=read().unwrap();assert_eq!(result.access,"capability_required");assert!(!result.enabled);assert!(result.items.is_empty());}
}
