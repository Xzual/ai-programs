import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  parseDownloadButlerStatusV2,
  parsePowerPresenceSnapshotV2,
  parseSceneProfileV2,
  parseShadowModeV2,
  parseSmartRetryPlanV2,
  parseVisualBookmarkV2,
  parseWatcherV2,
  parseWorkspaceSnapshotV2,
} from '../src/edith/contracts';

const crossDevice = await readFile(new URL('../src-tauri/src/cross_device.rs', import.meta.url), 'utf8');
const advanced = await readFile(new URL('../src-tauri/src/advanced.rs', import.meta.url), 'utf8');

const now = new Date().toISOString();
const later = new Date(Date.now() + 60_000).toISOString();
const lineage = {
  contractVersion: 2 as const,
  amendment: '2.1' as const,
  ownerSessionBindingId: 'owner-phase7e',
  workspaceId: 'workspace-phase7e',
  revision: 1,
  createdAt: now,
  updatedAt: now,
};

const fixtures = [
  [parsePowerPresenceSnapshotV2, { ...lineage, expiresAt: later, snapshotId: 'power-phase7e', source: 'trusted_native', powerSource: 'ac', batteryPercent: 90, lowPower: false, userPresence: 'active', cameraUsed: false, observedAt: now }],
  [parseDownloadButlerStatusV2, { ...lineage, downloadId: 'download-phase7e', source: 'supported_app', displayName: 'fixture.bin', bytesTransferred: 25, bytesTotal: 100, remainingBytes: 75, etaTrustworthy: false, status: 'downloading', observedAt: now }],
  [parseVisualBookmarkV2, { ...lineage, bookmarkId: 'bookmark-phase7e', capturedAt: now, appId: 'app-phase7e', screenshotPolicy: 'metadata_only', sensitiveAppBlocked: false }],
  [parseWorkspaceSnapshotV2, { ...lineage, snapshotId: 'snapshot-phase7e', label: 'Workspace', items: [{ kind: 'task', refId: 'task-phase7e', displayLabel: 'Task' }], forbiddenStateExcluded: true, dangerousTransactionsExcluded: true, captureStatus: 'metadata_only' }],
  [parseSceneProfileV2, { ...lineage, sceneId: 'scene-phase7e', profile: 'FOCUS', changes: [{ setting: 'capsule', from: 'default', to: 'focus', reversible: true }], securityNotificationsImmutable: true, status: 'active' }],
  [parseWatcherV2, { ...lineage, expiresAt: later, watcherId: 'watcher-phase7e', kind: 'file', sourceRef: 'note-phase7e', trigger: 'changed', delivery: 'desktop', observationPolicy: 'event_based', status: 'configuration_required' }],
  [parseShadowModeV2, { ...lineage, enabled: true, consent: 'explicit', observationLevel: 'metadata_only', capturedFields: ['app_identity', 'timestamps'], rawScreenArchive: false, secretCapture: false, suggestionOnly: true }],
  [parseSmartRetryPlanV2, { ...lineage, retryId: 'retry-phase7e', taskId: 'task-phase7e', failureClass: 'stale_target', strategy: 'reobserve', attempts: 1, maxAttempts: 2, staleTargetReobserve: true, permissionDeniedStop: false, status: 'retrying' }],
] as const;

for (const [parser, fixture] of fixtures) assert.equal(parser(fixture).success, true);

const mappings = [
  ['AdvancedPowerPresence', 'advanced_power_presence', 'power-presence'],
  ['AdvancedDownloads', 'advanced_downloads', 'downloads'],
  ['AdvancedBookmarks', 'advanced_bookmarks', 'bookmarks'],
  ['AdvancedSnapshots', 'advanced_snapshots', 'snapshots'],
  ['AdvancedScenes', 'advanced_scenes', 'scenes'],
  ['AdvancedWatchers', 'advanced_watchers', 'watchers'],
  ['AdvancedShadow', 'advanced_shadow', 'shadow'],
  ['AdvancedRetries', 'advanced_retries', 'retries'],
] as const;

for (const [variant, _wire, route] of mappings) {
  assert.match(crossDevice, new RegExp(`\\b${variant}\\b`));
  assert.match(crossDevice, new RegExp(`desktop-producer/advanced/${route}`));
  assert.match(advanced, new RegExp(`ProducerIngestKind::${variant}`));
}
assert.match(crossDevice, /serde\(rename_all = "snake_case"\)/);

assert.match(crossDevice, /successful_ingests > 0/);
assert.match(crossDevice, /ADVANCED_NATIVE_PUBLICATION_RUST_ONLY/);
assert.match(crossDevice, /status != 202 \|\| body\.get\("success"\) != Some\(&Value::Bool\(true\)\)/);
assert.match(crossDevice, /state\.revoke_all\("PRODUCER_INGEST_REJECTED"\)/);
assert.match(crossDevice, /state\.revoke_all\("PRODUCER_NETWORK_FAILURE"\)/);
assert.match(crossDevice, /Some\("configuration_required"\)/);
assert.match(crossDevice, /!object\.contains_key\("triggeredAt"\)/);
assert.match(crossDevice, /"apiKey"/);
assert.match(crossDevice, /"pixels"/);
assert.match(crossDevice, /"audio"/);
assert.match(crossDevice, /"clipboard"/);
assert.match(crossDevice, /"path"/);
assert.match(advanced, /publication: "published"/);
assert.match(advanced, /state\.revoke_all\("ADVANCED_PUBLICATION_FAILED"\)/);
assert.doesNotMatch(advanced, /ADVANCED_NATIVE_PRODUCER_KIND_UNAVAILABLE/);
assert.doesNotMatch(crossDevice, /println!|eprintln!|dbg!/);

console.log(JSON.stringify({
  success: true,
  checks: [
    'eight_frozen_contract_fixtures',
    'eight_exact_native_enum_wire_endpoint_mappings',
    'advanced_commands_publish_from_rust',
    'advanced_kinds_blocked_from_generic_webview_ingest',
    'control_plane_requires_successful_ingest',
    'http_202_and_success_only',
    'network_and_backend_rejection_revoke',
    'watcher_configuration_required_truth',
    'private_data_key_denylist',
    'advanced_lifecycle_revoke_on_publish_failure',
    'no_native_secret_logging',
  ],
}, null, 2));
