//! A bounded references-only shelf. Original files are never moved or deleted.
use std::{fs,io::Read,path::{Path,PathBuf},sync::Mutex,time::{SystemTime,UNIX_EPOCH}};
use serde::{Serialize,Deserialize};
use tauri::{AppHandle,State};
use windows::{core::PCWSTR,Win32::{Foundation::HWND,System::{Com::IDataObject,Ole::{OleInitialize,OleUninitialize,DROPEFFECT_COPY}},UI::{Shell::{ShellExecuteW,ILCreateFromPathW,ILFree,SHBindToParent,IShellFolder,SHDoDragDrop,SHOpenFolderAndSelectItems},WindowsAndMessaging::SW_SHOWNORMAL}}};
const LIMIT:usize=32;
#[derive(Clone,Serialize,Deserialize)]
pub struct Item{pub id:String,pub name:String,pub path:String,pub kind:String,pub size:Option<u64>,pub exists:bool}
#[derive(Clone,Default,Serialize,Deserialize)]
pub struct Catalog{pub items:Vec<Item>}
pub struct Store{catalog:Mutex<Result<Catalog,String>>}
fn location()->PathBuf{crate::settings::config_dir().join("shelf.json")}
fn normalize(path:&str)->Result<PathBuf,String>{
    if path.len()>32768 || path.contains('\0') || !Path::new(path).is_absolute(){return Err("Yerel ve tam bir dosya yolu bırak.".into());}
    let canonical=fs::canonicalize(path).map_err(|_|"Dosya bulunamadı veya erişilemiyor.")?;
    if !(canonical.is_file()||canonical.is_dir()){return Err("Yalnız dosya veya klasör eklenebilir.".into());}
    Ok(canonical)
}
fn shell_path(path:&Path)->String{let value=path.to_string_lossy();if let Some(rest)=value.strip_prefix(r"\\?\UNC\"){format!(r"\\{rest}")}else{value.strip_prefix(r"\\?\").unwrap_or(&value).to_string()}}
fn read(path:&Path)->Result<Catalog,String>{
    let file=match fs::File::open(path){Ok(file)=>file,Err(e)if e.kind()==std::io::ErrorKind::NotFound=>return Ok(Catalog::default()),Err(_)=>return Err("Dosya rafı okunamadı.".into())};
    let mut bytes=vec![];file.take(1024*1024+1).read_to_end(&mut bytes).map_err(|_|"Dosya rafı okunamadı.")?;
    if bytes.len()>1024*1024{return Err("Dosya rafı boyut sınırını aşıyor.".into());}
    let data:Catalog=serde_json::from_slice(&bytes).map_err(|_|"Dosya rafı bozuk; üzerine yazılmadı.")?;
    if data.items.len()>LIMIT || data.items.iter().any(|i|i.id.is_empty()||i.id.len()>100||!Path::new(&i.path).is_absolute()||i.path.contains('\0')||i.path.len()>32768||!matches!(i.kind.as_str(),"file"|"folder")){return Err("Dosya rafı kayıtları geçersiz.".into());}
    Ok(data)
}
fn write(path:&Path,data:&Catalog)->Result<(),String>{
    fs::create_dir_all(path.parent().ok_or("Ayar klasörü yok.")?).map_err(|_|"Raf klasörü oluşturulamadı.")?;
    let bytes=serde_json::to_vec_pretty(data).map_err(|_|"Dosya rafı hazırlanamadı.")?;
    let temp=path.with_extension("json.tmp");fs::write(&temp,bytes).map_err(|_|"Dosya rafı kaydedilemedi.")?;
    fs::rename(temp,path).map_err(|_|"Dosya rafı kaydedilemedi.".into())
}
fn add(data:&mut Catalog,paths:Vec<String>)->Result<(),String>{
    if paths.is_empty()||paths.len()>LIMIT{return Err("Tek seferde 1–32 dosya bırak.".into());}
    let mut next=data.clone();
    for path in paths{
        let path=normalize(&path)?;let display=shell_path(&path);
        if next.items.iter().any(|i|i.path.eq_ignore_ascii_case(&display)){continue;}
        if next.items.len()>=LIMIT{return Err("Dosya rafı dolu: en fazla 32 öğe. Bir referansı raftan kaldır.".into());}
        let metadata=fs::metadata(&path).map_err(|_|"Dosya bilgisi okunamadı.")?;
        let id=format!("shelf-{}-{}",SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos(),next.items.len());
        next.items.push(Item{id,name:path.file_name().unwrap_or(path.as_os_str()).to_string_lossy().into(),path:display,kind:if metadata.is_dir(){"folder"}else{"file"}.into(),size:if metadata.is_file(){Some(metadata.len())}else{None},exists:true});
    }
    *data=next;Ok(())
}
impl Store{
    pub fn load()->Self{Self{catalog:Mutex::new(read(&location()))}}
    fn edit(&self,action:impl FnOnce(&mut Catalog)->Result<(),String>)->Result<Catalog,String>{let mut stored=self.catalog.lock().map_err(|_|"Dosya rafı meşgul.")?;let mut next=stored.as_ref().map_err(Clone::clone)?.clone();action(&mut next)?;write(&location(),&next)?;*stored=Ok(next.clone());Ok(next)}
    fn item(&self,id:&str)->Result<Item,String>{self.catalog.lock().map_err(|_|"Dosya rafı meşgul.")?.as_ref().map_err(Clone::clone)?.items.iter().find(|i|i.id==id).cloned().ok_or("Raf öğesi bulunamadı.".into())}
}
#[tauri::command]pub fn shelf_list(store:State<Store>)->Result<Catalog,String>{let mut data=store.catalog.lock().map_err(|_|"Dosya rafı meşgul.")?.clone()?;for item in &mut data.items{let metadata=fs::metadata(&item.path).ok();item.exists=metadata.is_some();item.size=metadata.filter(|m|m.is_file()).map(|m|m.len());}Ok(data)}
#[tauri::command]pub fn shelf_add(paths:Vec<String>,store:State<Store>)->Result<Catalog,String>{store.edit(|data|add(data,paths))}
#[tauri::command]pub fn shelf_remove(id:String,store:State<Store>)->Result<Catalog,String>{store.edit(|data|{if !data.items.iter().any(|i|i.id==id){return Err("Raf öğesi bulunamadı.".into());}data.items.retain(|i|i.id!=id);Ok(())})}
fn wide(value:&str)->Vec<u16>{value.encode_utf16().chain(Some(0)).collect()}
#[tauri::command]pub fn shelf_open(id:String,store:State<Store>)->Result<(),String>{let item=store.item(&id)?;let path=normalize(&item.path)?;let target=wide(&shell_path(&path));let operation=wide("open");let result=unsafe{ShellExecuteW(None,PCWSTR(operation.as_ptr()),PCWSTR(target.as_ptr()),None,None,SW_SHOWNORMAL)};if result.0 as isize<=32{Err("Dosya açılamadı; varsayılan uygulamayı kontrol et.".into())}else{Ok(())}}
fn pidl(path:&str)->Result<Pidl,String>{let value=wide(path);let pointer=unsafe{ILCreateFromPathW(PCWSTR(value.as_ptr()))};if pointer.is_null(){Err("Windows dosya referansı oluşturulamadı.".into())}else{Ok(Pidl(pointer))}}
struct Pidl(*mut windows::Win32::UI::Shell::Common::ITEMIDLIST);impl Drop for Pidl{fn drop(&mut self){unsafe{ILFree(Some(self.0));}}}
struct OleApartment;impl OleApartment{fn new()->Result<Self,String>{unsafe{OleInitialize(None)}.map_err(|_|"Windows dosya servisi hazır değil.")?;Ok(Self)}}impl Drop for OleApartment{fn drop(&mut self){unsafe{OleUninitialize();}}}
#[tauri::command]pub fn shelf_reveal(id:String,store:State<Store>)->Result<(),String>{let item=store.item(&id)?;let path=normalize(&item.path)?;let _apartment=OleApartment::new()?;let item=pidl(&shell_path(&path))?;unsafe{SHOpenFolderAndSelectItems(item.0,None,0)}.map_err(|_|"Dosya konumu açılamadı.".into())}
fn drag(path:String)->Result<bool,String>{
    let _apartment=OleApartment::new()?;
    let object=data_object(&path)?;
    // COPY is the only offered effect: Shift cannot move/delete the source.
    let effect=unsafe{SHDoDragDrop(None,&object,None,DROPEFFECT_COPY)}.map_err(|_|"Dosya sürükleme başlatılamadı.")?;
    Ok(effect==DROPEFFECT_COPY)
}
fn data_object(path:&str)->Result<IDataObject,String>{
    let item=pidl(path)?;let mut child=std::ptr::null_mut();
    let parent:IShellFolder=unsafe{SHBindToParent(item.0,Some(&mut child))}.map_err(|_|"Windows klasör referansı okunamadı.")?;
    unsafe{parent.GetUIObjectOf(HWND::default(),&[child as *const _],None)}.map_err(|_|"Windows sürükleme verisi oluşturulamadı.".into())
}
#[tauri::command]pub async fn shelf_drag(id:String,store:State<'_,Store>,app:AppHandle)->Result<bool,String>{let item=store.item(&id)?;let path=shell_path(&normalize(&item.path)?);let(tx,rx)=tokio::sync::oneshot::channel();app.run_on_main_thread(move||{let _=tx.send(drag(path));}).map_err(|_|"Dosya sürükleme başlatılamadı.")?;rx.await.map_err(|_|"Dosya sürükleme tamamlanamadı.")?}
#[cfg(test)]mod tests{use super::*;
#[test]fn shelf_never_changes_originals_and_deduplicates(){let dir=std::env::temp_dir().join(format!("coucou-shelf-{}",SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));fs::create_dir(&dir).unwrap();let path=dir.join("Türkçe dosya.txt");fs::write(&path,b"original").unwrap();let mut catalog=Catalog::default();add(&mut catalog,vec![path.to_string_lossy().into(),path.to_string_lossy().into()]).unwrap();assert_eq!(catalog.items.len(),1);let config=dir.join("shelf.json");write(&config,&catalog).unwrap();assert_eq!(read(&config).unwrap().items.len(),1);catalog.items.clear();write(&config,&catalog).unwrap();assert_eq!(fs::read(&path).unwrap(),b"original");fs::remove_file(path).unwrap();fs::remove_file(config).unwrap();fs::remove_dir(dir).unwrap();}
#[test]fn unsafe_and_missing_paths_rejected(){assert!(normalize("relative.txt").is_err());assert!(normalize("https://example.com/a").is_err());assert!(normalize("C:\\missing\0file").is_err());assert!(add(&mut Catalog::default(),vec![]).is_err());}
#[test]fn native_shell_drag_data_contains_exact_original_path(){
    use windows::Win32::{System::{Com::{FORMATETC,DVASPECT_CONTENT,TYMED_HGLOBAL},Ole::ReleaseStgMedium},UI::Shell::{DragQueryFileW,HDROP}};
    unsafe{OleInitialize(None).unwrap();}
    struct Apartment;impl Drop for Apartment{fn drop(&mut self){unsafe{OleUninitialize();}}}let _apartment=Apartment;
    let file=std::env::temp_dir().join(format!("coucou-shelf-drag-{}.txt",SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));fs::write(&file,b"original").unwrap();
    let object=data_object(&shell_path(&file)).unwrap();
    let format=FORMATETC{cfFormat:15,ptd:std::ptr::null_mut(),dwAspect:DVASPECT_CONTENT.0,lindex:-1,tymed:TYMED_HGLOBAL.0 as u32};
    let mut medium=unsafe{object.GetData(&format).unwrap()};
    let drop=HDROP(unsafe{medium.u.hGlobal}.0);let count=unsafe{DragQueryFileW(drop,u32::MAX,None)};
    let mut path=vec![0u16;32768];let length=unsafe{DragQueryFileW(drop,0,Some(&mut path))};let result=String::from_utf16_lossy(&path[..length as usize]);
    unsafe{ReleaseStgMedium(&mut medium);}
    assert_eq!(count,1);assert_eq!(result,shell_path(&file));assert_eq!(fs::read(&file).unwrap(),b"original");fs::remove_file(file).unwrap();
}
}
