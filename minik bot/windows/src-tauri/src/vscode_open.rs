//! Launch Microsoft's editor directly; `code` on PATH may belong to Cursor.
use std::{path::{Path, PathBuf}, process::Command, os::windows::process::CommandExt};

fn candidates(local: Option<PathBuf>, system: Option<PathBuf>, x86: Option<PathBuf>) -> Vec<PathBuf> {
    local.into_iter().map(|root| root.join("Programs").join("Microsoft VS Code").join("Code.exe"))
        .chain(system.into_iter().chain(x86).map(|root| root.join("Microsoft VS Code").join("Code.exe"))).collect()
}

pub fn executable() -> Option<PathBuf> {
    candidates(std::env::var_os("LOCALAPPDATA").map(PathBuf::from), std::env::var_os("ProgramFiles").map(PathBuf::from), std::env::var_os("ProgramFiles(x86)").map(PathBuf::from))
        .into_iter().find(|path| path.is_file())
}

pub fn open(folder: Option<&str>) -> Result<(), String> {
    let executable = executable().ok_or("Microsoft VS Code bulunamadı. Cursor yerine VS Code kurulumu gerekiyor.")?;
    let mut command = Command::new(executable);
    if let Some(folder) = folder.filter(|p| !p.is_empty()) {
        if folder.contains('\0') || !Path::new(folder).is_absolute() { return Err("Geçersiz proje klasörü.".into()); }
        command.arg(folder);
    }
    command.creation_flags(0x0800_0000).spawn().map(|_| ())
        .map_err(|_| "Microsoft VS Code açılamadı.".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn resolves_microsoft_installations_not_cursor_path_shims() {
        let paths = candidates(Some(PathBuf::from("C:/User/Local")), Some(PathBuf::from("C:/Program Files")), Some(PathBuf::from("C:/Program Files (x86)")));
        assert_eq!(paths.len(), 3);
        assert!(paths.iter().all(|path| path.file_name().unwrap() == "Code.exe"));
        assert!(paths.iter().all(|path| path.parent().unwrap().file_name().unwrap() == "Microsoft VS Code"));
        assert!(candidates(None, None, None).is_empty());
    }
}
