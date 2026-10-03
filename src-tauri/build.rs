fn main() {
    let manifest_dir = std::path::PathBuf::from(
        std::env::var_os("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"),
    );
    let staged = manifest_dir
        .parent()
        .expect("project root")
        .join(".edith-build")
        .join("desktop")
        .join("resources");
    std::fs::create_dir_all(staged.join("crypto")).expect("create staged Crypto resource root");
    std::fs::create_dir_all(staged.join("python")).expect("create staged Python resource root");
    tauri_build::build()
}
