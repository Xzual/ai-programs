//! Run from the unpackaged Windows desktop to install the approved local bridge.
//! Packaged editors can redirect AppData writes; the browser must see the real files.
use std::{env, fs, path::PathBuf, process::Command};
use std::os::windows::process::CommandExt;

fn install() -> Result<(), String> {
    let source = env::current_exe().map_err(|_| "Installer location unavailable")?
        .parent().ok_or("Installer directory unavailable")?.join("zen-download-host.exe");
    if !source.is_file() { return Err("Build zen-download-host beside this installer first".into()); }
    let local = PathBuf::from(env::var_os("LOCALAPPDATA").ok_or("Local app data unavailable")?).join("Coucou");
    let destination = local.join("bin/zen-download-host.exe");
    fs::create_dir_all(destination.parent().ok_or("Invalid destination")?).map_err(|_| "Cannot create bridge directory")?;
    // Replace only this integration's executable, never other application data.
    fs::copy(&source, &destination).map_err(|_| "Cannot install bridge executable")?;
    let manifest_path = local.join("zen-native-host.json");
    let manifest = serde_json::json!({
        "name": "fr.louisraille.coucou.downloads",
        "description": "Coucou local-only Zen download metadata receiver",
        "path": destination,
        "type": "stdio",
        "allowed_extensions": ["downloads@coucou.local"]
    });
    fs::write(&manifest_path, serde_json::to_vec_pretty(&manifest).map_err(|_| "Cannot encode manifest")?)
        .map_err(|_| "Cannot install bridge manifest")?;
    let reg = PathBuf::from(env::var_os("SystemRoot").ok_or("Windows directory unavailable")?).join("System32/reg.exe");
    let result = Command::new(reg).args([
        "add", "HKCU\\Software\\Mozilla\\NativeMessagingHosts\\fr.louisraille.coucou.downloads",
        "/ve", "/t", "REG_SZ", "/d"
    ]).arg(&manifest_path).args(["/f", "/reg:64"]).creation_flags(0x08000000)
        .status().map_err(|_| "Cannot register bridge")?;
    if !result.success() { return Err("Bridge registration failed".into()); }
    Ok(())
}
fn main() {
    if let Err(error) = install() { eprintln!("Coucou bridge installation: {error}"); std::process::exit(1); }
}
