//! Firefox/Zen native messaging host. stdin/stdout contain length-prefixed JSON only.
//! No shell, network server or browser DB access. Browser restricts host to one addon ID.
#[path="../zen_download_protocol.rs"] mod downloads;
use std::{fs, io::{self, Read, Write}, time::{SystemTime, UNIX_EPOCH}};
fn run() -> Result<(),String> {
    let args:Vec<_>=std::env::args().collect();
    // Firefox passes native-host manifest path then addon ID. Reject direct arbitrary callers.
    if args.get(2).map(String::as_str)!=Some(downloads::ZEN_EXTENSION_ID) { return Err("Invalid addon origin".into()); }
    let path=downloads::zen_path().ok_or("Local app data unavailable")?;
    fs::create_dir_all(path.parent().ok_or("Invalid snapshot path")?).map_err(|_|"Snapshot directory unavailable")?;
    let mut input=io::stdin().lock(); let mut output=io::stdout().lock();
    loop {
        let mut length=[0u8;4]; match input.read_exact(&mut length) { Ok(())=>{},Err(e) if e.kind()==io::ErrorKind::UnexpectedEof=>return Ok(()),Err(_)=>return Err("Native input failed".into()) }
        let length=u32::from_le_bytes(length) as usize; if length==0 || length>128*1024 { return Err("Invalid native message size".into()); }
        let mut bytes=vec![0;length]; input.read_exact(&mut bytes).map_err(|_|"Incomplete native message")?;
        let sample:downloads::ZenEnvelope=serde_json::from_slice(&bytes).map_err(|_|"Invalid snapshot JSON")?;
        let now=SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_|"Clock unavailable")?.as_millis() as u64;
        downloads::validate_zen(&sample,now)?;
        let temp=path.with_extension("json.tmp"); fs::write(&temp,&bytes).map_err(|_|"Snapshot write failed")?;
        fs::rename(&temp,&path).map_err(|_|"Snapshot replace failed")?;
        let response=b"{\"accepted\":true}"; output.write_all(&(response.len() as u32).to_le_bytes()).and_then(|_|output.write_all(response)).and_then(|_|output.flush()).map_err(|_|"Native response failed")?;
    }
}
fn main() { if run().is_err() { std::process::exit(1); } }
