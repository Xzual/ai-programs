import assert from 'node:assert/strict';
import { adaptLegacyResultCardToSharedV2, type CrossDeviceLiveViewSessionV2 } from '../src/edith/contracts';
import {
  CrossDeviceBridgeError,
  CrossDeviceDesktopBridge,
  pcTelemetryState,
  verifyTransferChunk,
  type CrossDeviceNativeStatus,
} from '../src/edith/crossDeviceDesktopBridge';

const startNow = Date.parse('2026-09-28T12:00:00.000Z');
let now = startNow;
const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
const ownerCalls: string[] = [];
const ownerBodies: unknown[] = [];
const producerSequences: number[] = [];
let nativeFrameSequence = 0;

const nativeStatus: CrossDeviceNativeStatus = {
  runtime: 'windows',
  liveView: 'available',
  nativeCaptureAdapter: 'runtime_verified',
  pcStatus: 'runtime_verified',
  pcToMobileTransfer: 'available',
  mobileToPcInbox: 'available',
  wakeOnLan: 'configuration_required',
  audioHandoff: 'available',
  controlPlaneConnected: true,
  continuousAutoStream: false,
  remoteControl: false,
  maxFramesPerSecond: 2,
  safeMessage: 'Connected for test.',
};

const lineage = {
  contractVersion: 2 as const,
  amendment: '2.1' as const,
  ownerSessionBindingId: 'owner-session-phase6f',
  workspaceId: 'workspace-phase6f',
  sessionId: 'mobile-session-phase6f',
  sourceDeviceId: 'mobile-phase6f',
  targetDeviceId: 'desktop-phase6f',
};

function liveSession(status: CrossDeviceLiveViewSessionV2['status'], expiresAt = new Date(now + 60_000).toISOString()): CrossDeviceLiveViewSessionV2 {
  return {
    ...lineage,
    liveViewId: 'live-phase6f',
    status,
    ownerApproved: status !== 'requested',
    continuousAutoStream: false,
    controlAuthority: false,
    framePolicy: { maxFramesPerSecond: 2, maxWidth: 1280, maxHeight: 720 },
    overlayCapabilities: { cursor: true, click: false, target: false, operatorState: true },
    expiresAt,
  };
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}

function fetcher(options: { ownerOk?: boolean; killActive?: boolean } = {}) {
  return async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (url.endsWith('/api/edith/kill-switch')) return json({ state: { active: options.killActive ?? false } });
    if (url.endsWith('/api/edith/mobile/desktop-producer/status')) return options.ownerOk === false
      ? json({ errorCode: 'OWNER_SESSION_REQUIRED' }, 401)
      : json({ success: true, data: { persistence: 'memory_only', configured: true, activeSessions: 0, retainedFrameMetadata: 0 } });
    if (url.endsWith('/api/edith/mobile/devices')) return options.ownerOk === false
      ? json({ errorCode: 'OWNER_SESSION_REQUIRED' }, 401)
      : json({ success: true, data: { devices: [{
        device: { deviceId: 'mobile-phase6f', displayName: 'Owner phone', platform: 'android' },
        trust: { status: 'trusted' },
        ownerBinding: { ownerSessionId: lineage.ownerSessionBindingId, workspaceId: lineage.workspaceId, expiresAt: new Date(now + 60_000).toISOString() },
      }] } });
    if (url.endsWith('/api/edith/mobile/cross-device/status')) return options.ownerOk === false
      ? json({ errorCode: 'OWNER_SESSION_REQUIRED' }, 401)
      : json({ success: true, data: { liveViews: 0, transferIntents: 0, resultCards: 1, audioLeases: 0 } });
    throw new Error(`Unexpected read URL: ${url}`);
  };
}

function ownerFetcher(): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
  return async (input, init): Promise<Response> => {
    const url = String(input);
    ownerCalls.push(url);
    if (init?.body) ownerBodies.push(JSON.parse(String(init.body)));
    if (url.includes('/desktop-producer/session/')) return json({ success: true, data: {
      producerSessionToken: 'producer-session-token-phase6f',
      session: { ...lineage, sourceDeviceId: lineage.targetDeviceId, targetDeviceId: lineage.sourceDeviceId, expiresAt: new Date(now + 60_000).toISOString() },
    } }, 201);
    if (url.endsWith('/request')) return json({ success: true, data: { liveView: liveSession('requested') } }, 201);
    if (url.endsWith('/approve')) return json({ success: true, data: { liveView: liveSession('approved') } });
    if (url.endsWith('/stop')) return json({ success: true, data: { liveView: liveSession('stopped') } });
    if (url.includes('/result-cards/')) return json({ success: true, data: { card } }, 201);
    if (url.includes('/wake/')) return json({ success: false, errorCode: 'WAKE_ON_LAN_CONFIGURATION_REQUIRED' }, 428);
    throw new Error(`Unexpected owner URL: ${url}`);
  };
}

const invoke = async <T>(command: string, args?: Record<string, unknown>): Promise<T | undefined> => {
  calls.push({ command, args });
  if (command === 'cross_device_native_status') return nativeStatus as T;
  if (command === 'cross_device_live_view_start') return liveSession('streaming') as T;
  if (command === 'cross_device_live_view_stop' || command === 'cross_device_revoke_owner') return undefined;
  if (command === 'cross_device_live_view_frame') return {
    metadata: { ...lineage, liveViewId: 'live-phase6f', frameId: `frame-phase6f-${nativeFrameSequence + 1}`, sequence: ++nativeFrameSequence, observedAt: new Date(now).toISOString(), width: 2, height: 2, operatorState: 'observing', containsPixels: false },
    transport: { mimeType: 'image/png', bytesBase64: 'YWJj', sizeBytes: 3, sha256: 'a'.repeat(64) },
  } as T;
  if (command === 'cross_device_producer_ingest') {
    const request = args?.request as { operation: string; deviceId?: string; csrfToken?: string; kind?: string; payload?: unknown };
    if (request.operation === 'bootstrap') {
      assert.equal(request.deviceId, 'mobile-phase6f');
      assert.equal(request.csrfToken, 'csrf-phase6f');
      return { status: 201, body: { success: true, data: { session: { ...lineage, sourceDeviceId: lineage.targetDeviceId, targetDeviceId: lineage.sourceDeviceId, expiresAt: new Date(now + 60_000).toISOString() } } } } as T;
    }
    assert.equal(request.operation, 'ingest');
    assert.equal(request.kind, 'live_view_frame_metadata');
    assert.equal('producerSessionToken' in request, false);
    assert.equal('sequence' in request, false);
    assert.equal('transport' in (request.payload as Record<string, unknown>), false);
    assert.equal('bytesBase64' in (request.payload as Record<string, unknown>), false);
    producerSequences.push(producerSequences.length + 1);
    return { status: 202, body: { success: true, data: { status: 'streaming' } } } as T;
  }
  if (command === 'cross_device_cleanup_inbox') return { removedArtifacts: 1, preservedActiveOrPending: 2, retentionMilliseconds: 86_400_000 } as T;
  return undefined;
};

async function expectCode(action: () => Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(action, (error: unknown) => error instanceof CrossDeviceBridgeError && error.code === code);
}

// Invoke absence is fail-closed even when the backend is reachable.
const browserBridge = new CrossDeviceDesktopBridge({ fetcher: fetcher(), ownerFetch: ownerFetcher(), tauriAvailable: () => false, now: () => now });
const browserSnapshot = await browserBridge.refresh();
assert.equal(browserSnapshot.tauriAvailable, false);
assert.equal(browserSnapshot.capabilities.liveView, 'configuration_required');
await expectCode(() => browserBridge.startLiveView('mobile-phase6f'), 'TAURI_INVOKE_UNAVAILABLE');

// Owner denial cannot be upgraded by native capability claims.
const deniedBridge = new CrossDeviceDesktopBridge({ invoke, fetcher: fetcher({ ownerOk: false }), ownerFetch: ownerFetcher(), tauriAvailable: () => true, now: () => now });
const denied = await deniedBridge.refresh();
assert.equal(denied.ownerAuthorized, false);
assert.equal(denied.capabilities.liveView, 'configuration_required');
await expectCode(() => deniedBridge.startLiveView('mobile-phase6f'), 'OWNER_SESSION_REQUIRED');

// Emergency Stop dominates before any owner mutation or native capture.
const killBridge = new CrossDeviceDesktopBridge({ invoke, fetcher: fetcher({ killActive: true }), ownerFetch: ownerFetcher(), tauriAvailable: () => true, now: () => now });
const ownerCallCount = ownerCalls.length;
await expectCode(() => killBridge.startLiveView('mobile-phase6f'), 'KILL_SWITCH_ACTIVE');
assert.equal(ownerCalls.length, ownerCallCount);
assert.equal(killBridge.activeLiveView, null);

// Lifecycle, explicit pull cadence and expiry are bounded.
const bridge = new CrossDeviceDesktopBridge({ invoke, fetcher: fetcher(), ownerFetch: ownerFetcher(), ownerSession: async () => ({ csrfToken: 'csrf-phase6f' }), tauriAvailable: () => true, now: () => now });
const started = await bridge.startLiveView('mobile-phase6f');
assert.equal(started.status, 'streaming');
const frame = await bridge.pullLiveViewFrame();
assert.equal(frame.metadata.containsPixels, false);
assert.equal(bridge.liveViewVerifiedByBackend, true);
assert.deepEqual(producerSequences, [1]);
await expectCode(() => bridge.pullLiveViewFrame(), 'LIVE_VIEW_FRAME_RATE_LIMITED');
now += 500;
await bridge.pullLiveViewFrame();
assert.deepEqual(producerSequences, [1, 2]);
now += 59_501;
await expectCode(() => bridge.pullLiveViewFrame(), 'LIVE_VIEW_EXPIRED');
assert.equal(bridge.activeLiveView, null);
assert.equal(bridge.producerSessionActive, false);
assert.ok(calls.some((entry) => entry.command === 'cross_device_live_view_stop'));

// Private payloads and paths are never reflected in public errors.
const privacyBridge = new CrossDeviceDesktopBridge({
  invoke: async <T>(command: string, args?: Record<string, unknown>) => {
    if (command === 'cross_device_native_status') return nativeStatus as T;
    if (command === 'cross_device_producer_ingest' && (args?.request as { operation?: string })?.operation === 'bootstrap') {
      return { status: 201, body: { success: true, data: { session: { ...lineage, sourceDeviceId: lineage.targetDeviceId, targetDeviceId: lineage.sourceDeviceId, expiresAt: new Date(now + 60_000).toISOString() } } } } as T;
    }
    if (command === 'cross_device_live_view_start') throw new Error('CROSS_DEVICE_CAPTURE_FAILED C:\\Users\\owner\\private.png YWJjYWJjYWJj');
    return undefined;
  },
  fetcher: fetcher(), ownerFetch: ownerFetcher(), ownerSession: async () => ({ csrfToken: 'csrf-phase6f' }), tauriAvailable: () => true, now: () => now,
});
await assert.rejects(() => privacyBridge.startLiveView('mobile-phase6f'), (error: unknown) => {
  assert.ok(error instanceof CrossDeviceBridgeError);
  assert.equal(error.code, 'CROSS_DEVICE_CAPTURE_FAILED');
  assert.equal(error.message.includes('private.png'), false);
  assert.equal(error.message.includes('YWJj'), false);
  return true;
});

// Transfer transport requires bounded byte counts and source integrity.
const validChunk = { chunkIndex: 0, offsetBytes: 0, bytesRead: 3, bytesBase64: 'YWJj', chunkSha256: 'b'.repeat(64), sourceSha256: 'c'.repeat(64), nextOffsetBytes: 3, complete: true };
assert.equal(verifyTransferChunk(validChunk, 'c'.repeat(64)), true);
assert.equal(verifyTransferChunk({ ...validChunk, bytesRead: 4 }, 'c'.repeat(64)), false);
assert.equal(verifyTransferChunk({ ...validChunk, sourceSha256: 'd'.repeat(64) }, 'c'.repeat(64)), false);

// Stale telemetry is never upgraded to live status, and unknown metrics remain absent.
const telemetry = { ...lineage, snapshotId: 'status-phase6f', runtime: 'ready' as const, observedAt: new Date(now - 35_000).toISOString(), expiresAt: new Date(now - 5_000).toISOString(), metrics: { networkState: 'unknown' as const }, source: 'native_adapter' as const };
assert.equal(pcTelemetryState(telemetry, now), 'stale');
assert.equal('gpuPercent' in telemetry.metrics, false);

// Canonical shared cards are validated and keep the legacy display contract.
const legacy = { title: 'Task complete', summary: 'Redacted desktop result', outcome: 'success' as const, artifactIds: ['artifact-phase6f'], completedAt: new Date(now).toISOString() };
const card = adaptLegacyResultCardToSharedV2(legacy, { ...lineage, cardId: 'card-phase6f', kind: 'task', now: new Date(now).toISOString() });
const result = await bridge.publishResultCard('mobile-phase6f', { cardId: card.cardId, source: { type: 'task', id: 'task-phase6f' } });
assert.deepEqual(result.legacy.artifactIds, legacy.artifactIds);
assert.equal(result.shared.preview.redacted, true);
assert.deepEqual(ownerBodies.at(-1), { cardId: card.cardId, source: { type: 'task', id: 'task-phase6f' } });
assert.equal(JSON.stringify(ownerBodies.at(-1)).includes('preview'), false);

// Native fixture/compiled labels must not be presented as end-to-end availability.
const honestStatus = { ...nativeStatus, controlPlaneConnected: false, liveView: 'configuration_required', pcToMobileTransfer: 'fixture_verified' };
const honestBridge = new CrossDeviceDesktopBridge({ invoke: async <T>(command: string) => command === 'cross_device_native_status' ? honestStatus as T : undefined, fetcher: fetcher(), ownerFetch: ownerFetcher(), ownerSession: async () => ({ csrfToken: 'csrf-phase6f' }), tauriAvailable: () => true, now: () => now });
const honest = await honestBridge.refresh();
assert.equal(honest.capabilities.liveView, 'configuration_required');
assert.equal(honest.capabilities.pcToMobileTransfer, 'configuration_required');
assert.equal(honest.native?.remoteControl, false);

console.log('Phase 6F desktop bridge tests passed.');
