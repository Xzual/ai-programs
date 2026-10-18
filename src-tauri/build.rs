// This check binds the selector to the real effective RFC7396 configuration.
// Fixed errors deliberately do not print environment/configuration contents.
fn assert_candidate_config(manifest_dir: &std::path::Path, id: &str) {
    use std::io::Read;
    const MAX_CONFIG_BYTES: usize = 1024 * 1024;
    let overlay_os = std::env::var_os("TAURI_CONFIG").expect("candidate configuration required");
    let overlay_text = overlay_os.to_str().expect("candidate configuration invalid");
    assert!(overlay_text.len() <= MAX_CONFIG_BYTES, "candidate configuration invalid");
    let overlay: serde_json::Value = serde_json::from_slice(overlay_text.as_bytes())
        .unwrap_or_else(|_| panic!("candidate configuration JSON invalid"));
    assert!(overlay.is_object(), "candidate configuration invalid");
    for name in ["tauri.windows.conf.json", "tauri.windows.conf.json5", "Tauri.windows.toml",
                 "tauri.conf.json5", "Tauri.toml"] {
        match std::fs::symlink_metadata(manifest_dir.join(name)) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
            _ => panic!("unsupported candidate configuration"),
        }
    }
    let file = std::fs::File::open(manifest_dir.join("tauri.conf.json"))
        .unwrap_or_else(|_| panic!("public base configuration unavailable"));
    let mut bytes = Vec::new();
    file.take((MAX_CONFIG_BYTES + 1) as u64).read_to_end(&mut bytes)
        .unwrap_or_else(|_| panic!("public base configuration unavailable"));
    assert!(bytes.len() <= MAX_CONFIG_BYTES, "public base configuration invalid");
    let base: serde_json::Value = serde_json::from_slice(&bytes)
        .unwrap_or_else(|_| panic!("public base configuration JSON invalid"));
    assert!(base.is_object() && base["build"].is_object() && base["bundle"].is_object()
        && base["bundle"]["resources"].is_object()
        && base["build"]["beforeBuildCommand"].is_string()
        && base["build"]["frontendDist"].is_string()
        && base["bundle"]["externalBin"].is_array(), "public base configuration invalid");
    let prefix = format!("../artifacts/desktop/candidates/{id}");
    let mut expected = base.clone();
    expected["build"]["beforeBuildCommand"] = serde_json::json!("");
    expected["build"]["frontendDist"] = serde_json::json!(format!("{prefix}/frontend"));
    expected["bundle"]["externalBin"] = serde_json::json!([format!("{prefix}/binaries/edith-backend")]);
    let mut resources = serde_json::Map::new();
    resources.insert(format!("{prefix}/frontend/"), serde_json::json!("dist/"));
    for name in ["crypto", "python", "third-party"] {
        resources.insert(format!("{prefix}/stage/resources/{name}/"), serde_json::json!(format!("{name}/")));
    }
    expected["bundle"]["resources"] = serde_json::Value::Object(resources);
    let mut effective = base;
    json_patch::merge(&mut effective, &overlay);
    assert!(effective == expected, "candidate effective configuration mismatch");
}

fn main() {
    println!("cargo:rerun-if-env-changed=EDITH_DESKTOP_CANDIDATE_ID");
    println!("cargo:rerun-if-env-changed=TAURI_CONFIG");
    println!("cargo:rerun-if-changed=tauri.conf.json");
    let manifest_dir = std::path::PathBuf::from(
        std::env::var_os("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"),
    );
    if let Some(selector) = std::env::var_os("EDITH_DESKTOP_CANDIDATE_ID") {
        let id = selector.to_str().expect("candidate ID must be UTF-8");
        assert!(id.len() == 64 && id.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)), "invalid candidate ID");
        assert!(std::env::var("PROFILE").as_deref() == Ok("release"), "candidate requires release profile");
        assert_candidate_config(&manifest_dir, id);
        let resources = manifest_dir.parent().expect("project root")
            .join("artifacts").join("desktop").join("candidates").join(id).join("stage").join("resources");
        for name in ["crypto", "python", "third-party"] {
            let resource = resources.join(name);
            let metadata = std::fs::symlink_metadata(&resource).expect("prepared candidate resource root");
            assert!(metadata.is_dir() && !metadata.file_type().is_symlink(), "ordinary candidate resource directory required");
            for ancestor in resource.ancestors() {
                let meta = std::fs::symlink_metadata(ancestor).expect("candidate ancestor");
                assert!(!meta.file_type().is_symlink(), "candidate ancestor link");
                #[cfg(windows)]
                {
                    use std::os::windows::fs::MetadataExt;
                    assert_eq!(meta.file_attributes() & 0x400, 0, "candidate ancestor reparse point");
                }
            }
        }
        tauri_build::build();
        return;
    }
    let staged = manifest_dir
        .parent()
        .expect("project root")
        .join(".edith-build")
        .join("desktop")
        .join("resources");
    std::fs::create_dir_all(staged.join("crypto")).expect("create staged Crypto resource root");
    std::fs::create_dir_all(staged.join("python")).expect("create staged Python resource root");
    // Development runs source-backed services and need only a resource root here.
    // Release packaging must still supply the validated third-party payload.
    if std::env::var("PROFILE").as_deref() == Ok("debug") {
        std::fs::create_dir_all(staged.join("third-party"))
            .expect("create development third-party resource root");
    }
    tauri_build::build()
}
