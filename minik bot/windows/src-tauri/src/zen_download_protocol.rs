//! Native-messaging protocol shared by the desktop and minimal receiver executable.
use serde::Deserialize;
use std::{collections::HashSet,path::PathBuf};
#[allow(dead_code)] pub const ZEN_EXTENSION_ID:&str="downloads@coucou.local";
#[derive(Deserialize)] #[serde(deny_unknown_fields)] pub struct ZenEnvelope { pub version:u32, pub sampled_at_ms:u64, pub items:Vec<ZenItem> }
#[derive(Deserialize)] #[serde(deny_unknown_fields)] pub struct ZenItem { pub id:u64, pub name:String, pub state:String, pub received_bytes:u64, pub total_bytes:Option<u64>, pub bytes_per_second:Option<f64>, pub eta_seconds:Option<f64>, pub completion_id:Option<String> }
pub fn zen_path() -> Option<PathBuf> { std::env::var_os("LOCALAPPDATA").map(PathBuf::from).map(|p|p.join("Coucou/zen-downloads.json")) }
pub fn validate_zen(value:&ZenEnvelope, now_ms:u64) -> Result<(),String> {
    if value.version!=1 || value.items.len()>128 || value.sampled_at_ms>now_ms.saturating_add(5000) || now_ms.saturating_sub(value.sampled_at_ms)>15_000 { return Err("Zen köprüsü verisi eski veya geçersiz.".into()); }
    let mut ids=HashSet::new();
    for i in &value.items {
        if !ids.insert(i.id) || i.name.is_empty() || i.name.len()>512 || i.name.chars().any(char::is_control) || !matches!(i.state.as_str(),"downloading"|"paused"|"complete"|"interrupted") || i.total_bytes.is_some_and(|t|t<i.received_bytes) || i.bytes_per_second.is_some_and(|v|!v.is_finite()||v<0.||v>1e12) || i.eta_seconds.is_some_and(|v|!v.is_finite()||v<0.||v>31536000.) || i.completion_id.as_ref().is_some_and(|s|s.len()>160 || s.chars().any(char::is_control)) { return Err("Geçersiz Zen indirme verisi.".into()); }
        if i.state!="complete" && i.completion_id.is_some() { return Err("Erken tamamlanma kimliği.".into()); }
    } Ok(())
}
#[cfg(test)] mod tests {
    use super::*;
    #[test] fn rejects_other_metadata_stale_and_unknown_versions(){
        assert!(serde_json::from_str::<ZenEnvelope>(r#"{"version":1,"sampled_at_ms":1,"items":[],"url":"https://private.example"}"#).is_err());
        let mut sample=ZenEnvelope{version:1,sampled_at_ms:1000,items:vec![]}; assert!(validate_zen(&sample,1000).is_ok()); assert!(validate_zen(&sample,20000).is_err());sample.version=2;assert!(validate_zen(&sample,1000).is_err());
    }
}
