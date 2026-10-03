use chrono::{DateTime, Duration as ChronoDuration, SecondsFormat, Utc};
use serde::Serialize;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

use crate::computer::ComputerState;
use crate::cross_device::{
    ensure_obsidian_trusted_binding, publish_obsidian_selection, CrossDeviceState,
    TrustedDesktopBinding,
};

const CONTRACT_VERSION: u8 = 2;
const CONTRACT_AMENDMENT: &str = "2.1";
const SELECTION_TTL_SECONDS: i64 = 5 * 60;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TrustedNativeVaultSelectionV1 {
    contract_version: u8,
    amendment: String,
    selection_id: String,
    device_id: String,
    source: &'static str,
    selected_path: String,
    user_confirmed: bool,
    selected_at: String,
    expires_at: String,
}

impl Drop for TrustedNativeVaultSelectionV1 {
    fn drop(&mut self) {
        zero_string(&mut self.selection_id);
        zero_string(&mut self.device_id);
        zero_string(&mut self.selected_path);
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeVaultSelectionPublication {
    contract_version: u8,
    amendment: String,
    owner_session_binding_id: String,
    workspace_id: String,
    session_id: String,
    selection: TrustedNativeVaultSelectionV1,
}

impl Drop for NativeVaultSelectionPublication {
    fn drop(&mut self) {
        zero_string(&mut self.owner_session_binding_id);
        zero_string(&mut self.workspace_id);
        zero_string(&mut self.session_id);
    }
}

struct PendingVaultSelection {
    response_handle: String,
    binding: TrustedDesktopBinding,
    publication: NativeVaultSelectionPublication,
    next_sequence: u64,
    expires_at: DateTime<Utc>,
}

impl PendingVaultSelection {
    fn clear_sensitive(&mut self) {
        zero_string(&mut self.response_handle);
        self.binding.clear_sensitive();
        zero_string(&mut self.publication.owner_session_binding_id);
        zero_string(&mut self.publication.workspace_id);
        zero_string(&mut self.publication.session_id);
        zero_string(&mut self.publication.selection.selection_id);
        zero_string(&mut self.publication.selection.device_id);
        zero_string(&mut self.publication.selection.selected_path);
    }
}

impl Drop for PendingVaultSelection {
    fn drop(&mut self) {
        self.clear_sensitive();
    }
}

#[derive(Clone, Default)]
pub struct ObsidianVaultPickerState {
    pending: Arc<Mutex<Option<PendingVaultSelection>>>,
}

impl ObsidianVaultPickerState {
    pub fn revoke_all(&self, _reason_code: &str) {
        if let Ok(mut pending) = self.pending.lock() {
            pending.take();
        }
    }

    pub fn revoke_owner(&self, owner_session_binding_id: &str) {
        if let Ok(mut pending) = self.pending.lock() {
            let should_revoke = pending.as_ref().is_some_and(|selection| {
                selection.binding.owner_session_binding_id == owner_session_binding_id
            });
            if should_revoke {
                pending.take();
            }
        }
    }

    fn replace(&self, selection: PendingVaultSelection) -> Result<(), String> {
        let mut pending = self
            .pending
            .lock()
            .map_err(|_| "OBSIDIAN_NATIVE_SELECTION_STATE_UNAVAILABLE".to_string())?;
        pending.take();
        *pending = Some(selection);
        Ok(())
    }

    fn schedule_expiry(&self, response_handle: String) {
        let pending = Arc::clone(&self.pending);
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_secs(SELECTION_TTL_SECONDS as u64));
            if let Ok(mut pending) = pending.lock() {
                let expired_selection = pending
                    .as_ref()
                    .is_some_and(|selection| selection.response_handle == response_handle);
                if expired_selection {
                    pending.take();
                }
            }
        });
    }

    fn redeem(
        &self,
        expected_binding: &TrustedDesktopBinding,
        expected_sequence: u64,
        now: DateTime<Utc>,
    ) -> Result<NativeVaultSelectionPublication, String> {
        let mut pending = self
            .pending
            .lock()
            .map_err(|_| "OBSIDIAN_NATIVE_SELECTION_STATE_UNAVAILABLE".to_string())?;
        let selection = pending
            .as_ref()
            .ok_or_else(|| "OBSIDIAN_NATIVE_SELECTION_NOT_PENDING".to_string())?;
        if now >= selection.expires_at {
            pending.take();
            return Err("OBSIDIAN_NATIVE_SELECTION_EXPIRED".into());
        }
        if &selection.binding != expected_binding {
            return Err("OBSIDIAN_NATIVE_SELECTION_BINDING_MISMATCH".into());
        }
        if selection.next_sequence != expected_sequence {
            return Err("OBSIDIAN_NATIVE_SELECTION_SEQUENCE_INVALID".into());
        }
        Ok(selection.publication.clone())
    }

    fn consume(
        &self,
        expected_binding: &TrustedDesktopBinding,
        expected_sequence: u64,
    ) -> Result<(), String> {
        let mut pending = self
            .pending
            .lock()
            .map_err(|_| "OBSIDIAN_NATIVE_SELECTION_STATE_UNAVAILABLE".to_string())?;
        let selection = pending
            .as_ref()
            .ok_or_else(|| "OBSIDIAN_NATIVE_SELECTION_NOT_PENDING".to_string())?;
        if &selection.binding != expected_binding || selection.next_sequence != expected_sequence {
            return Err("OBSIDIAN_NATIVE_SELECTION_BINDING_MISMATCH".into());
        }
        pending.take();
        Ok(())
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultPickerResult {
    status: &'static str,
    selection_handle: Option<String>,
    publication: &'static str,
    safe_message: &'static str,
}

#[tauri::command]
pub fn obsidian_request_vault_folder(
    window: WebviewWindow,
    state: State<'_, ObsidianVaultPickerState>,
    cross_device: State<'_, CrossDeviceState>,
    computer: State<'_, ComputerState>,
) -> Result<VaultPickerResult, String> {
    if window.label() != "main" {
        return Err("OBSIDIAN_NATIVE_PICKER_MAIN_WINDOW_REQUIRED".into());
    }
    if let Err(error) = computer.ensure_kill_switch_inactive() {
        state.revoke_all("KILL_SWITCH_ACTIVE");
        return Err(error);
    }
    state.revoke_all("NEW_PICKER_REQUEST");

    let selected = window
        .dialog()
        .file()
        .set_title("Select an existing Obsidian vault folder")
        .blocking_pick_folder();
    let Some(selected) = selected else {
        return Ok(cancelled_result());
    };
    let binding = ensure_obsidian_trusted_binding(&cross_device, &computer)?;
    let path = selected
        .into_path()
        .map_err(|_| "OBSIDIAN_NATIVE_SELECTION_LOCAL_PATH_REQUIRED".to_string())?;
    let pending = build_pending_selection(&path, binding.clone(), Utc::now())?;
    let response_handle = pending.response_handle.clone();
    state.replace(pending)?;
    state.schedule_expiry(response_handle.clone());

    let sequence = 1;
    let publication = state.redeem(&binding, sequence, Utc::now())?;
    match publish_obsidian_selection(&cross_device, sequence, &publication) {
        Ok(()) => {
            state.consume(&binding, sequence)?;
            Ok(VaultPickerResult {
                status: "selected",
                selection_handle: Some(response_handle),
                publication: "submitted",
                safe_message: "The native vault selection was submitted for backend verification.",
            })
        }
        Err(_) => Ok(VaultPickerResult {
            status: "selected_pending_verifier",
            selection_handle: Some(response_handle),
            publication: "configuration_required",
            safe_message:
                "The folder remains pending in native memory; the backend verifier is unavailable.",
        }),
    }
}

fn cancelled_result() -> VaultPickerResult {
    VaultPickerResult {
        status: "cancelled",
        selection_handle: None,
        publication: "none",
        safe_message: "Folder selection was cancelled. No vault configuration changed.",
    }
}

fn build_pending_selection(
    path: &Path,
    binding: TrustedDesktopBinding,
    selected_at: DateTime<Utc>,
) -> Result<PendingVaultSelection, String> {
    validate_selected_directory(path)?;
    let selected_path = path
        .to_str()
        .ok_or_else(|| "OBSIDIAN_NATIVE_SELECTION_PATH_ENCODING_UNSUPPORTED".to_string())?
        .to_string();
    let expires_at = selected_at + ChronoDuration::seconds(SELECTION_TTL_SECONDS);
    let selection_id = random_hex(24)?;
    let response_handle = random_hex(24)?;
    let selection = TrustedNativeVaultSelectionV1 {
        contract_version: CONTRACT_VERSION,
        amendment: CONTRACT_AMENDMENT.to_string(),
        selection_id,
        device_id: binding.device_id.clone(),
        source: "trusted_native_picker",
        selected_path,
        user_confirmed: true,
        selected_at: selected_at.to_rfc3339_opts(SecondsFormat::Millis, true),
        expires_at: expires_at.to_rfc3339_opts(SecondsFormat::Millis, true),
    };
    Ok(PendingVaultSelection {
        response_handle,
        publication: NativeVaultSelectionPublication {
            contract_version: CONTRACT_VERSION,
            amendment: CONTRACT_AMENDMENT.to_string(),
            owner_session_binding_id: binding.owner_session_binding_id.clone(),
            workspace_id: binding.workspace_id.clone(),
            session_id: binding.session_id.clone(),
            selection,
        },
        binding,
        next_sequence: 1,
        expires_at,
    })
}

fn validate_selected_directory(path: &Path) -> Result<(), String> {
    if !path.is_absolute() || path.parent().is_none() {
        return Err("OBSIDIAN_NATIVE_SELECTION_LOCAL_DIRECTORY_REQUIRED".into());
    }
    let metadata = std::fs::symlink_metadata(path)
        .map_err(|_| "OBSIDIAN_NATIVE_SELECTION_DIRECTORY_UNAVAILABLE".to_string())?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err("OBSIDIAN_NATIVE_SELECTION_LOCAL_DIRECTORY_REQUIRED".into());
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0400;
        if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return Err("OBSIDIAN_NATIVE_SELECTION_REPARSE_POINT_BLOCKED".into());
        }
    }
    Ok(())
}

fn random_hex(byte_count: usize) -> Result<String, String> {
    let mut bytes = vec![0_u8; byte_count];
    getrandom::fill(&mut bytes)
        .map_err(|_| "OBSIDIAN_NATIVE_SELECTION_RANDOM_UNAVAILABLE".to_string())?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn zero_string(value: &mut String) {
    // Zero bytes before releasing native-only paths and binding identifiers.
    unsafe {
        value.as_bytes_mut().fill(0);
    }
    value.clear();
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};
    use std::fs;
    use std::path::PathBuf;

    fn binding(owner: &str, session: &str, device: &str) -> TrustedDesktopBinding {
        TrustedDesktopBinding {
            owner_session_binding_id: owner.into(),
            workspace_id: "workspace-native-test".into(),
            session_id: session.into(),
            device_id: device.into(),
        }
    }

    fn fixture_hash(root: &Path) -> String {
        let note = fs::read(root.join("Görev Notu.md")).expect("fixture note");
        let marker = fs::read(root.join(".obsidian").join("app.json")).expect("fixture marker");
        let mut digest = Sha256::new();
        digest.update(note);
        digest.update(marker);
        format!("{:x}", digest.finalize())
    }

    fn fixture() -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "edith-native-vault-{}-Türkçe Alan",
            random_hex(8).expect("fixture id")
        ));
        fs::create_dir_all(root.join(".obsidian")).expect("fixture directories");
        fs::write(root.join("Görev Notu.md"), "İçerik değişmemeli").expect("fixture note");
        fs::write(root.join(".obsidian").join("app.json"), "{}").expect("fixture marker");
        root
    }

    #[test]
    fn selection_preserves_path_and_does_not_mutate_tree() {
        let root = fixture();
        let before = fixture_hash(&root);
        let now = Utc::now();
        let pending =
            build_pending_selection(&root, binding("owner-a", "session-a", "device-a"), now)
                .expect("selection");
        assert_eq!(
            pending.publication.selection.selected_path,
            root.to_str().unwrap()
        );
        assert_eq!(
            pending.publication.selection.source,
            "trusted_native_picker"
        );
        assert!(pending.publication.selection.user_confirmed);
        assert_eq!(pending.expires_at, now + ChronoDuration::minutes(5));
        assert_eq!(fixture_hash(&root), before);
        drop(pending);
        fs::remove_dir_all(root).expect("fixture cleanup");
    }

    #[test]
    fn redemption_is_single_use_expiring_and_binding_scoped() {
        let root = fixture();
        let state = ObsidianVaultPickerState::default();
        let expected = binding("owner-a", "session-a", "device-a");
        let now = Utc::now();
        state
            .replace(build_pending_selection(&root, expected.clone(), now).expect("selection"))
            .expect("pending");
        assert_eq!(
            state
                .redeem(&binding("owner-b", "session-a", "device-a"), 1, now)
                .unwrap_err(),
            "OBSIDIAN_NATIVE_SELECTION_BINDING_MISMATCH"
        );
        assert_eq!(
            state
                .redeem(&binding("owner-a", "session-b", "device-a"), 1, now)
                .unwrap_err(),
            "OBSIDIAN_NATIVE_SELECTION_BINDING_MISMATCH"
        );
        assert_eq!(
            state
                .redeem(&binding("owner-a", "session-a", "device-b"), 1, now)
                .unwrap_err(),
            "OBSIDIAN_NATIVE_SELECTION_BINDING_MISMATCH"
        );
        let mut wrong_workspace = expected.clone();
        wrong_workspace.workspace_id = "workspace-other".into();
        assert_eq!(
            state.redeem(&wrong_workspace, 1, now).unwrap_err(),
            "OBSIDIAN_NATIVE_SELECTION_BINDING_MISMATCH"
        );
        assert_eq!(
            state.redeem(&expected, 2, now).unwrap_err(),
            "OBSIDIAN_NATIVE_SELECTION_SEQUENCE_INVALID"
        );
        state.redeem(&expected, 1, now).expect("valid redemption");
        state.consume(&expected, 1).expect("consume");
        assert_eq!(
            state.redeem(&expected, 1, now).unwrap_err(),
            "OBSIDIAN_NATIVE_SELECTION_NOT_PENDING"
        );

        state
            .replace(build_pending_selection(&root, expected.clone(), now).expect("selection"))
            .expect("pending");
        assert_eq!(
            state
                .redeem(&expected, 1, now + ChronoDuration::minutes(5))
                .unwrap_err(),
            "OBSIDIAN_NATIVE_SELECTION_EXPIRED"
        );
        fs::remove_dir_all(root).expect("fixture cleanup");
    }

    #[test]
    fn webview_result_is_path_and_identity_free_and_cancel_is_harmless() {
        let cancelled = serde_json::to_string(&cancelled_result()).expect("cancel result");
        assert!(!cancelled.contains("selectedPath"));
        assert!(!cancelled.contains("deviceId"));
        assert!(!cancelled.contains("ownerSessionBindingId"));
        assert!(cancelled.contains("cancelled"));

        let selected = VaultPickerResult {
            status: "selected_pending_verifier",
            selection_handle: Some("opaque-handle".into()),
            publication: "configuration_required",
            safe_message: "Verifier unavailable.",
        };
        let encoded = serde_json::to_string(&selected).expect("selected result");
        assert!(!encoded.contains("selectedPath"));
        assert!(!encoded.contains("deviceId"));
        assert!(!encoded.contains("ownerSessionBindingId"));
        assert!(!encoded.contains("workspaceId"));
    }

    #[test]
    fn owner_revoke_removes_only_the_bound_pending_selection() {
        let root = fixture();
        let state = ObsidianVaultPickerState::default();
        let now = Utc::now();
        let expected = binding("owner-a", "session-a", "device-a");
        state
            .replace(build_pending_selection(&root, expected.clone(), now).expect("selection"))
            .expect("pending");
        state.revoke_owner("owner-b");
        state.redeem(&expected, 1, now).expect("still pending");
        state.revoke_owner("owner-a");
        assert_eq!(
            state.redeem(&expected, 1, now).unwrap_err(),
            "OBSIDIAN_NATIVE_SELECTION_NOT_PENDING"
        );
        fs::remove_dir_all(root).expect("fixture cleanup");
    }

    #[test]
    fn filesystem_root_is_rejected() {
        let current = std::env::current_dir().expect("current directory");
        let root = current.ancestors().last().expect("filesystem root");
        assert_eq!(
            validate_selected_directory(root).unwrap_err(),
            "OBSIDIAN_NATIVE_SELECTION_LOCAL_DIRECTORY_REQUIRED"
        );
    }
}
