import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [picker, crossDevice, computer, lib, capability, contracts] = await Promise.all([
  readFile(new URL('../src-tauri/src/obsidian_picker.rs', import.meta.url), 'utf8'),
  readFile(new URL('../src-tauri/src/cross_device.rs', import.meta.url), 'utf8'),
  readFile(new URL('../src-tauri/src/computer.rs', import.meta.url), 'utf8'),
  readFile(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8'),
  readFile(new URL('../src-tauri/capabilities/default.json', import.meta.url), 'utf8'),
  readFile(new URL('../src/edith/contracts.ts', import.meta.url), 'utf8'),
]);

const commandStart = picker.indexOf('pub fn obsidian_request_vault_folder(');
const commandEnd = picker.indexOf(') -> Result<VaultPickerResult, String>', commandStart);
assert.ok(commandStart >= 0 && commandEnd > commandStart);
const commandSignature = picker.slice(commandStart, commandEnd);
assert.doesNotMatch(commandSignature, /path|selection|attestation|device_id|owner_session/i);
assert.match(commandSignature, /window: WebviewWindow/);
assert.match(commandSignature, /State<'_, ObsidianVaultPickerState>/);

const webviewResultStart = picker.indexOf('pub struct VaultPickerResult');
const webviewResultEnd = picker.indexOf('#[tauri::command]', webviewResultStart);
const webviewResult = picker.slice(webviewResultStart, webviewResultEnd);
assert.doesNotMatch(webviewResult, /selected_path|device_id|owner_session|workspace_id|session_id|token/i);
assert.match(webviewResult, /selection_handle: Option<String>/);

assert.match(picker, /blocking_pick_folder\(\)/);
assert.match(picker, /source: "trusted_native_picker"/);
assert.match(picker, /user_confirmed: true/);
assert.match(picker, /SELECTION_TTL_SECONDS: i64 = 5 \* 60/);
assert.match(picker, /schedule_expiry\(response_handle\.clone\(\)\)/);
assert.match(picker, /std::thread::sleep\(Duration::from_secs\(SELECTION_TTL_SECONDS as u64\)\)/);
assert.match(picker, /symlink_metadata\(path\)/);
assert.match(picker, /FILE_ATTRIBUTE_REPARSE_POINT/);
assert.match(picker, /state\.revoke_all\("NEW_PICKER_REQUEST"\)/);
assert.match(picker, /status: "cancelled"/);
assert.match(picker, /publication: "none"/);
assert.match(picker, /fn drop\(&mut self\)/);
assert.match(picker, /value\.as_bytes_mut\(\)\.fill\(0\)/);

assert.match(crossDevice, /\/api\/edith\/obsidian\/native-selection/);
assert.match(crossDevice, /X-Edith-Producer-Session/);
assert.match(crossDevice, /X-Edith-Native-Selection-Sequence/);
assert.match(crossDevice, /X-Edith-Owner-Session-Binding/);
assert.match(crossDevice, /X-Edith-Device-Session/);
assert.match(crossDevice, /status != 202/);
assert.match(crossDevice, /producer\.successful_ingests > 0/);
assert.match(crossDevice, /obsidian_picker\.revoke_owner/);

assert.match(computer, /obsidian_picker\.revoke_all\("KILL_SWITCH_OR_SAFETY_UNAVAILABLE"\)/);
assert.match(lib, /manage\(obsidian_picker::ObsidianVaultPickerState::default\(\)\)/);
assert.match(lib, /obsidian_picker::obsidian_request_vault_folder/);
assert.match(lib, /revoke_all\("APP_SHUTDOWN"\)/);
assert.match(lib, /revoke_all\("APP_EXIT"\)/);
assert.doesNotMatch(capability, /dialog:allow-open/);

assert.match(contracts, /export interface TrustedNativeVaultSelectionV1/);
assert.match(contracts, /source: 'trusted_native_picker'/);
assert.match(contracts, /userConfirmed: true/);
assert.match(contracts, /parseTrustedNativeVaultSelectionV1/);

for (const source of [picker, crossDevice]) {
  assert.doesNotMatch(source, /\b(?:println|eprintln|dbg)!/);
}

console.log(JSON.stringify({
  success: true,
  checks: [
    'argument_free_native_picker_command',
    'directory_only_native_dialog',
    'path_free_webview_result',
    'trusted_contract_v2_1_mapping',
    'five_minute_max_expiry',
    'native_dual_auth_publication',
    'exact_first_sequence',
    'owner_session_device_binding',
    'cancel_is_harmless',
    'reparse_and_root_defense',
    'logout_kill_shutdown_revocation',
    'webview_dialog_permission_removed',
    'no_native_secret_debug_logging',
  ],
}, null, 2));
