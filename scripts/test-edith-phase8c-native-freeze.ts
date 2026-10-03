import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(process.cwd());
const read = (relative: string) => readFile(path.join(root, relative), 'utf8');
const [crossDevice, advanced, computer, lib, capabilityRaw, tauriRaw, desktopBridge, releaseTest] = await Promise.all([
  read('src-tauri/src/cross_device.rs'),
  read('src-tauri/src/advanced.rs'),
  read('src-tauri/src/computer.rs'),
  read('src-tauri/src/lib.rs'),
  read('src-tauri/capabilities/default.json'),
  read('src-tauri/tauri.conf.json'),
  read('src/edith/crossDeviceDesktopBridge.ts'),
  read('scripts/test-edith-desktop-release.mjs'),
]);
const capability = JSON.parse(capabilityRaw) as { windows?: string[]; permissions?: string[] };
const tauri = JSON.parse(tauriRaw) as { app?: { security?: { csp?: string } } };

assert.match(crossDevice, /ADVANCED_NATIVE_PUBLICATION_RUST_ONLY/);
assert.match(crossDevice, /kind\.advanced_native_only\(\)/);
assert.match(crossDevice, /publish_native_record\(state, ProducerIngestKind::PcStatus, &initial_status\)/);
assert.match(crossDevice, /build_pc_status\(state, computer, lineage\)/);
assert.match(crossDevice, /status != 202 \|\| body\.get\("success"\) != Some\(&Value::Bool\(true\)\)/);
assert.match(crossDevice, /current\.next_sequence == producer\.next_sequence/);
assert.match(crossDevice, /successful_ingests > 0/);
assert.match(crossDevice, /state\.revoke_all\("PRODUCER_INITIAL_EVIDENCE_REJECTED"\)/);
assert.match(crossDevice, /state\.revoke_all\("PRODUCER_INGEST_REJECTED"\)/);
assert.match(crossDevice, /state\.revoke_owner\(&owner_session_binding_id\)/);
assert.match(crossDevice, /advanced\.revoke_owner\(&owner_session_binding_id\)/);
assert.match(advanced, /state\.revoke_all\("ADVANCED_PUBLICATION_FAILED"\)/);
assert.match(advanced, /cross_device\.revoke_all\("KILL_SWITCH_ACTIVE"\)/);
for (const sensitive of ['password', 'bitwarden', '1password', 'keepass', 'authenticator', 'banking', 'wallet', 'login']) {
  assert.match(advanced.toLowerCase(), new RegExp(`"${sensitive}"`));
}
assert.match(advanced, /foreground\.app_id/);
assert.match(advanced, /VISUAL_BOOKMARK_FOREGROUND_CHANGED/);
assert.match(advanced, /children: Vec<Child>/);
assert.match(advanced, /for child in &mut restore\.children/);
assert.match(lib, /begin_shutdown/);
assert.match(lib, /RunEvent::Exit/);
assert.match(lib, /clear_bridge\(\)/);
assert.match(lib, /revoke_all\("APP_EXIT"\)/);
assert.match(lib, /\.env\("EDITH_DESKTOP_BRIDGE_TOKEN", desktop_bridge_token\)/);
assert.doesNotMatch(desktopBridge, /EDITH_DESKTOP_BRIDGE_TOKEN|producerSessionToken|nextSequence/);
assert.deepEqual(capability.windows, ['main']);
assert.equal((capability.permissions ?? []).some((permission) => /shell|http|fs:|global-shortcut|clipboard|process/i.test(permission)), false);
assert.match(tauri.app?.security?.csp ?? '', /default-src 'self'/);
assert.doesNotMatch(tauri.app?.security?.csp ?? '', /unsafe-eval/);
for (const input of ['rustSources', "build.rs", "Cargo.lock", "capabilities', 'default.json"]) assert.match(releaseTest, new RegExp(input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

const rustFiles = (await readdir(path.join(root, 'src-tauri', 'src'))).filter((name) => name.endsWith('.rs'));
for (const file of rustFiles) {
  const source = await read(`src-tauri/src/${file}`);
  assert.doesNotMatch(source, /\b(?:println|eprintln|dbg)!/);
  assert.doesNotMatch(source, /AIza[0-9A-Za-z_-]{20,}/);
}

console.log(JSON.stringify({
  success: true,
  checks: [
    'generic_webview_trusted_native_spoof_rejected',
    'bootstrap_requires_real_initial_pc_status_ingest',
    'http_202_success_and_exact_next_sequence',
    'producer_readiness_after_accepted_ingest_only',
    'lifecycle_owner_kill_and_exit_revocation',
    'sensitive_app_and_foreground_race_denial',
    'restore_child_process_ownership',
    'bridge_token_native_only',
    'minimal_tauri_capabilities_and_csp',
    'release_freshness_tracks_all_native_sources',
    'native_secret_and_debug_log_scan',
  ],
}, null, 2));
