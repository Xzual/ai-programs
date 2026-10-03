import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  parseDownloadButlerStatusV2,
  parsePowerPresenceSnapshotV2,
  parseVisualBookmarkV2,
  parseWorkspaceSnapshotV2,
} from '../src/edith/contracts';

const native = await readFile(new URL('../src-tauri/src/advanced.rs', import.meta.url), 'utf8');
const crossDevice = await readFile(new URL('../src-tauri/src/cross_device.rs', import.meta.url), 'utf8');
const tauri = await readFile(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
const producerRoute = await readFile(new URL('../server/routes/desktopProducer.ts', import.meta.url), 'utf8');

const now = new Date().toISOString();
const later = new Date(Date.now() + 60_000).toISOString();
const lineage = {
  contractVersion: 2 as const,
  amendment: '2.1' as const,
  ownerSessionBindingId: 'owner-phase7c',
  workspaceId: 'workspace-phase7c',
  revision: 1,
  createdAt: now,
  updatedAt: now,
};

assert.equal(parsePowerPresenceSnapshotV2({
  ...lineage,
  expiresAt: later,
  snapshotId: 'power-phase7c',
  source: 'trusted_native',
  powerSource: 'ac',
  batteryPercent: 80,
  lowPower: false,
  userPresence: 'active',
  cameraUsed: false,
  observedAt: now,
}).success, true);

assert.equal(parseVisualBookmarkV2({
  ...lineage,
  bookmarkId: 'bookmark-phase7c',
  capturedAt: now,
  appId: 'app-phase7c',
  windowTitlePreview: 'Safe window title',
  screenshotArtifactHandle: 'artifact-phase7c',
  screenshotPolicy: 'opaque_handle',
  sensitiveAppBlocked: false,
}).success, true);

assert.equal(parseWorkspaceSnapshotV2({
  ...lineage,
  snapshotId: 'snapshot-phase7c',
  label: 'Safe workspace',
  items: [{ kind: 'app', refId: 'notepad', displayLabel: 'Notepad' }],
  forbiddenStateExcluded: true,
  dangerousTransactionsExcluded: true,
  captureStatus: 'metadata_only',
}).success, true);

assert.equal(parseDownloadButlerStatusV2({
  ...lineage,
  downloadId: 'download-phase7c',
  source: 'supported_app',
  displayName: 'fixture.bin',
  bytesTransferred: 25,
  bytesTotal: 100,
  remainingBytes: 75,
  etaTrustworthy: false,
  status: 'downloading',
  observedAt: now,
}).success, true);

for (const command of [
  'advanced_native_status',
  'advanced_power_presence',
  'advanced_current_app',
  'advanced_visual_bookmark_capture',
  'advanced_workspace_snapshot',
  'advanced_workspace_restore',
  'advanced_workspace_restore_stop',
  'advanced_scene_activate',
  'advanced_scene_revert',
  'advanced_watcher_register',
  'advanced_download_select',
  'advanced_download_sample',
  'advanced_shadow_set',
  'advanced_shadow_observe',
  'advanced_smart_retry',
]) assert.match(tauri, new RegExp(`advanced::${command}`));

assert.match(native, /window\.label\(\) == "main"/);
assert.match(native, /NATIVE_EVENT_WATCHER_DEPENDENCY_REQUIRED/);
assert.match(native, /publication: "published"/);
assert.doesNotMatch(native, /ADVANCED_NATIVE_PRODUCER_KIND_UNAVAILABLE/);
assert.match(native, /WORKSPACE_APP_NOT_ALLOWLISTED/);
assert.match(native, /"notepad" => "notepad\.exe"/);
assert.match(native, /action_dispatched: false/);
assert.match(native, /max_attempts: 2/);
assert.match(native, /raw_screen_archive: false/);
assert.match(native, /camera_used: false/);
assert.match(native, /security_notifications_immutable: true/);
assert.match(native, /no_cheating_no_memory_access_no_anticheat_interaction/);
assert.match(crossDevice, /advanced\.revoke_owner\(&owner_session_binding_id\)/);
assert.doesNotMatch(native, /\b(?:println|eprintln|dbg)!/);
assert.doesNotMatch(native, /powershell\.exe|cmd\.exe|wscript\.exe|cscript\.exe/);
for (const route of ['power-presence', 'downloads', 'bookmarks', 'snapshots', 'scenes', 'watchers', 'shadow', 'retries']) {
  assert.match(producerRoute, new RegExp(`desktop-producer/advanced/${route}`));
}

console.log(JSON.stringify({
  success: true,
  checks: [
    'canonical_power_presence',
    'canonical_visual_bookmark',
    'canonical_workspace_snapshot',
    'canonical_download_truth',
    'tauri_command_registration',
    'main_webview_boundary',
    'event_watcher_honest_blocker',
    'advanced_producer_native_publication_ready',
    'allowlisted_app_launch_only',
    'retry_metadata_no_click',
    'shadow_no_raw_archive',
    'presence_no_camera',
    'scene_security_and_game_policy',
    'owner_lifecycle_revocation',
    'no_native_debug_logging',
    'backend_phase7_fixed_producer_routes_available',
  ],
}, null, 2));
