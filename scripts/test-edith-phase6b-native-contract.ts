import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  parseCrossDeviceAudioHandoffV2,
  parseCrossDeviceLiveViewFrameMetadataV2,
  parseCrossDeviceLiveViewSessionV2,
  parseCrossDevicePcStatusV2,
  parseCrossDeviceTransferV2,
  parseCrossDeviceWakeReadyV2,
} from '../src/edith/contracts';

const now = Date.now();
const iso = (offset: number) => new Date(now + offset).toISOString();
const lineage = {
  contractVersion: 2 as const,
  amendment: '2.1' as const,
  ownerSessionBindingId: 'owner-phase6b-test',
  workspaceId: 'workspace-phase6b-test',
  sessionId: 'session-phase6b-test',
  sourceDeviceId: 'desktop-phase6b-test',
  targetDeviceId: 'mobile-phase6b-test',
};

const liveView = {
  ...lineage,
  liveViewId: 'live-view-phase6b-test',
  status: 'streaming' as const,
  ownerApproved: true,
  continuousAutoStream: false as const,
  controlAuthority: false as const,
  framePolicy: { maxFramesPerSecond: 2, maxWidth: 1280, maxHeight: 720 },
  overlayCapabilities: { cursor: true, click: false, target: false, operatorState: true },
  startedAt: iso(-100),
  expiresAt: iso(60_000),
};
assert.equal(parseCrossDeviceLiveViewSessionV2(liveView).success, true);

const frame = {
  ...lineage,
  liveViewId: liveView.liveViewId,
  frameId: 'frame-phase6b-test',
  sequence: 1,
  observedAt: iso(0),
  width: 1280,
  height: 720,
  cursor: { x: 0.5, y: 0.5 },
  operatorState: 'observing' as const,
  containsPixels: false as const,
};
assert.equal(parseCrossDeviceLiveViewFrameMetadataV2(frame).success, true);
assert.equal(JSON.stringify(frame).includes('bytesBase64'), false);
assert.equal(JSON.stringify(frame).includes('imageDataUrl'), false);

const wake = {
  ...lineage,
  requestId: 'wake-phase6b-test',
  capability: 'wake_on_lan' as const,
  capabilityStatus: 'configuration_required' as const,
  status: 'configuration_required' as const,
  attempted: false,
  runtimeReady: false,
  requestedAt: iso(0),
  completedAt: iso(0),
  errorCode: 'WAKE_ON_LAN_CONFIGURATION_REQUIRED',
};
assert.equal(parseCrossDeviceWakeReadyV2(wake).success, true);

const transfer = {
  ...lineage,
  transferId: 'transfer-phase6b-test',
  direction: 'mobile_to_pc' as const,
  category: 'document' as const,
  fileName: 'fixture.txt',
  mediaType: 'text/plain',
  sizeBytes: 12,
  sha256: 'a'.repeat(64),
  status: 'completed' as const,
  progress: { bytesTransferred: 12, totalBytes: 12, percent: 100, integrity: 'verified' as const },
  destination: {
    kind: 'approved_folder' as const,
    opaqueHandle: 'destination-phase6b-test',
    displaySummary: 'Owner-approved folder',
    conflictPolicy: 'reject' as const,
    collisionDetected: false,
  },
  resume: {
    contractVersion: 2 as const,
    amendment: '2.1' as const,
    resumable: false,
    nextChunkIndex: 1,
    completedChunkIndexes: [0],
    retryCount: 0,
    maxRetries: 2,
    lastAttemptAt: iso(0),
    acknowledgedBytes: 12,
    resumeCheckpointId: 'checkpoint-transfer-phase6b-test',
  },
  capabilities: { open: false, export: false, share: false, openLocation: false },
  createdAt: iso(-1_000),
  updatedAt: iso(0),
  expiresAt: iso(60_000),
};
const parsedTransfer = parseCrossDeviceTransferV2(transfer);
if (parsedTransfer.success === false) throw new Error(`${parsedTransfer.errorCode}: ${parsedTransfer.message}`);

const audio = {
  ...lineage,
  handoffId: 'handoff-phase6b-test',
  leaseId: 'lease-phase6b-test',
  epoch: 1,
  sourceCaptureDeviceId: lineage.sourceDeviceId,
  targetCaptureDeviceId: lineage.targetDeviceId,
  status: 'active' as const,
  simultaneousCaptureAllowed: false as const,
  requestedAt: iso(-100),
  acknowledgedAt: iso(-100),
  expiresAt: iso(60_000),
};
assert.equal(parseCrossDeviceAudioHandoffV2(audio).success, true);

const pcStatus = {
  ...lineage,
  snapshotId: 'pc-status-phase6b-test',
  runtime: 'ready' as const,
  observedAt: iso(0),
  expiresAt: iso(30_000),
  metrics: {
    cpuPercent: 15.69,
    ramPercent: 46,
    networkState: 'unknown' as const,
    activeDownloads: 0,
    voiceActive: false,
    computerUseActive: false,
  },
  source: 'native_adapter' as const,
};
assert.equal(parseCrossDevicePcStatusV2(pcStatus).success, true);

const nativeSource = await readFile(new URL('../src-tauri/src/cross_device.rs', import.meta.url), 'utf8');
assert.equal(/\b(?:println|eprintln|dbg)!/.test(nativeSource), false);
assert.match(nativeSource, /control_plane_connected: connected/);
assert.match(nativeSource, /continuous_auto_stream: false/);
assert.match(nativeSource, /remote_control: false/);
assert.match(nativeSource, /MAX_LIVE_VIEW_FPS: u8 = 2/);
assert.match(nativeSource, /create_new\(true\)/);
assert.match(nativeSource, /ensure_kill_switch_inactive/);

const tauriLib = await readFile(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
for (const command of [
  'cross_device_native_status',
  'cross_device_live_view_start',
  'cross_device_live_view_frame',
  'cross_device_live_view_stop',
  'cross_device_pc_status',
  'cross_device_read_source_chunk',
  'cross_device_write_inbox_chunk',
  'cross_device_audio_lease_start',
  'cross_device_revoke_owner',
  'cross_device_producer_ingest',
]) {
  assert.match(tauriLib, new RegExp(`cross_device::${command}`));
}

console.log(JSON.stringify({
  success: true,
  checks: [
    'canonical_live_view_session',
    'pixels_free_frame_metadata',
    'honest_wol_configuration_required',
    'canonical_real_byte_transfer_snapshot',
    'single_capture_audio_lease_contract',
    'fresh_native_pc_status_contract',
    'no_production_debug_logging',
    'no_overwrite_create_new',
    'kill_switch_hook_present',
    'tauri_command_surface_registered',
  ],
}, null, 2));
