//! Own OLE targets on late-created WebView2 children; COPY-only, local files only.
use std::{cell::Cell,path::PathBuf};
use serde::Serialize;
use tauri::{AppHandle,Emitter,Manager};
use windows::{core::{implement,Ref,Result,BOOL},Win32::{Foundation::{HWND,LPARAM,POINTL},System::{Com::{IDataObject,FORMATETC,DVASPECT_CONTENT,TYMED_HGLOBAL},Ole::{IDropTarget,IDropTarget_Impl,RegisterDragDrop,RevokeDragDrop,ReleaseStgMedium,DROPEFFECT,DROPEFFECT_COPY,DROPEFFECT_NONE},SystemServices::MODIFIERKEYS_FLAGS},UI::{Shell::{DragQueryFileW,HDROP},WindowsAndMessaging::EnumChildWindows}}};
#[derive(Clone,Serialize)]pub struct Payload{#[serde(rename="type")]kind:&'static str,paths:Vec<String>}
fn paths(data:Ref<'_,IDataObject>)->Option<Vec<String>>{
    let data=data.as_ref()?;
    let format=FORMATETC{cfFormat:15,ptd:std::ptr::null_mut(),dwAspect:DVASPECT_CONTENT.0,lindex:-1,tymed:TYMED_HGLOBAL.0 as u32};
    let mut medium=unsafe{data.GetData(&format)}.ok()?;
    let result=(||{let drop=HDROP(unsafe{medium.u.hGlobal}.0);let count=unsafe{DragQueryFileW(drop,u32::MAX,None)};if count==0||count>32{return None;}
        let mut out=Vec::new();for index in 0..count{let len=unsafe{DragQueryFileW(drop,index,None)}as usize;if len==0||len>32767{return None;}let mut value=vec![0u16;len+1];let copied=unsafe{DragQueryFileW(drop,index,Some(&mut value))}as usize;let value=String::from_utf16(&value[..copied]).ok()?;let path=PathBuf::from(&value);if !path.is_absolute()||!path.exists(){return None;}out.push(value);}Some(out)})();
    unsafe{ReleaseStgMedium(&mut medium);}result
}
#[implement(IDropTarget)]struct Target{app:AppHandle,valid:Cell<bool>}
impl Target{fn emit(&self,kind:&'static str,paths:Vec<String>){let _=self.app.emit_to("island","native-file-drop",Payload{kind,paths});}}
#[allow(non_snake_case)]impl IDropTarget_Impl for Target_Impl{
    fn DragEnter(&self,data:Ref<'_,IDataObject>,_:MODIFIERKEYS_FLAGS,_:&POINTL,effect:*mut DROPEFFECT)->Result<()>{let files=paths(data);self.valid.set(files.is_some());unsafe{*effect=if self.valid.get(){DROPEFFECT_COPY}else{DROPEFFECT_NONE};}if let Some(files)=files{self.emit("enter",files);}Ok(())}
    fn DragOver(&self,_:MODIFIERKEYS_FLAGS,_:&POINTL,effect:*mut DROPEFFECT)->Result<()>{unsafe{*effect=if self.valid.get(){DROPEFFECT_COPY}else{DROPEFFECT_NONE};}if self.valid.get(){self.emit("over",vec![]);}Ok(())}
    fn DragLeave(&self)->Result<()>{if self.valid.replace(false){self.emit("leave",vec![]);}Ok(())}
    fn Drop(&self,data:Ref<'_,IDataObject>,_:MODIFIERKEYS_FLAGS,_:&POINTL,effect:*mut DROPEFFECT)->Result<()>{let files=paths(data);unsafe{*effect=if files.is_some(){DROPEFFECT_COPY}else{DROPEFFECT_NONE};}self.valid.set(false);if let Some(files)=files{self.emit("drop",files);}Ok(())}
}
fn register(hwnd:HWND,app:&AppHandle){let target:IDropTarget=Target{app:app.clone(),valid:Cell::new(false)}.into();unsafe{let _=RevokeDragDrop(hwnd);if let Err(error)=RegisterDragDrop(hwnd,&target){eprintln!("Coucou OLE drop target registration failed: {}",error.code());}}}
unsafe extern "system" fn child(hwnd:HWND,param:LPARAM)->BOOL{let app=unsafe{&*(param.0 as *const AppHandle)};register(hwnd,app);true.into()}
thread_local! { static OLE_READY: Cell<bool> = const { Cell::new(false) }; }
pub fn refresh(app:&AppHandle){
    // CoInitializeEx alone is insufficient for RegisterDragDrop. Initialize OLE
    // once on the owning UI thread; retain it for this thread's lifetime.
    let ready=OLE_READY.with(|ready| {
        if ready.get(){return true;}
        match unsafe{windows::Win32::System::Ole::OleInitialize(None)} {
            Ok(())=>{ready.set(true);true},
            Err(error)=>{eprintln!("Coucou OLE initialization failed: {}",error.code());false}
        }
    });
    if !ready{return;}
    let Some(win)=app.get_webview_window("island")else{return;};let Ok(raw)=win.hwnd()else{return;};let hwnd=HWND(raw.0);register(hwnd,app);unsafe{let _=EnumChildWindows(Some(hwnd),Some(child),LPARAM(app as *const _ as isize));}
}
#[cfg(test)]mod tests{
    use super::*;
    #[test]fn native_drop_extracts_unicode_original_without_consuming_source(){
        use windows::{core::PCWSTR,Win32::{System::Ole::{OleInitialize,OleUninitialize},UI::Shell::{ILCreateFromPathW,ILFree,SHBindToParent,IShellFolder}}};
        unsafe{OleInitialize(None).unwrap();}
        let file=std::env::temp_dir().join(format!("coucou-drop-{}-Türkçe.txt",std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        std::fs::write(&file,b"original").unwrap();
        let wide=file.to_string_lossy().encode_utf16().chain(Some(0)).collect::<Vec<_>>();
        let pidl=unsafe{ILCreateFromPathW(PCWSTR(wide.as_ptr()))};
        let mut child=std::ptr::null_mut();let parent:IShellFolder=unsafe{SHBindToParent(pidl,Some(&mut child))}.unwrap();
        let object:IDataObject=unsafe{parent.GetUIObjectOf(HWND::default(),&[child as *const _],None)}.unwrap();
        let optional=Some(object);let result=paths(Ref::from(&optional)).unwrap();
        assert_eq!(result,vec![file.to_string_lossy().to_string()]);assert_eq!(std::fs::read(&file).unwrap(),b"original");
        unsafe{ILFree(Some(pidl));OleUninitialize();}std::fs::remove_file(file).unwrap();
    }
}
