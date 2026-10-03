import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import express from 'express';
import {
  EDITH_CONTRACT_AMENDMENT,
  EDITH_CONTRACT_SCHEMA,
  EDITH_CONTRACT_VERSION,
  REALTIME_EVENT_NAMES,
  TASK_CONTRACT_VERSION,
  adaptLegacyResultCardToSharedV2,
  adaptSharedResultCardToLegacyV2,
  parseCrossDeviceClipboardRequestV2,
  parseCrossDeviceHandoffIntentV2,
  parseCrossDeviceLiveViewSessionV2,
  parseCrossDeviceLiveViewFrameMetadataV2,
  parseCrossDeviceOfflineQueueItemV2,
  parseCrossDevicePcStatusV2,
  parseCrossDeviceTransferV2,
  parseCrossDeviceWakeReadyV2,
  parseRealtimeEnvelopeV2_1,
  parseSharedResultCardV2,
  type CrossDeviceAudioHandoffV2,
  type CrossDeviceClipboardRequestV2,
  type CrossDeviceHandoffIntentV2,
  type CrossDevicePcStatusV2,
  type CrossDeviceTransferV2,
  type MobileRemoteCommandV2,
  type SharedResultCardV2,
} from '../src/edith/contracts';
import { CrossDeviceService } from '../server/mobile/crossDeviceService';
import type { MobileSessionContext } from '../server/mobile/types';
import { createOwnerSessionRouter, getOwnerSession, onOwnerSessionInvalidated, requireOwnerSession } from '../server/security/ownerSession';
import { sha256 } from '../server/mobile/crypto';

const v21 = { contractVersion: TASK_CONTRACT_VERSION, amendment: EDITH_CONTRACT_AMENDMENT };
const serverId = 'edith-server-phase6';

function expectCode(operation: () => unknown, code: string): void {
  assert.throws(operation, (error: unknown) => error instanceof Error && error.message === code, code);
}

function context(ownerSessionBindingId = 'owner-phase6', deviceId = 'android-phase6'): MobileSessionContext {
  const now = Date.now();
  return {
    credential: { credentialId: 'cred-phase6', credentialHash: sha256('secret'), credentialFingerprint: sha256('credential'), deviceId, sessionId: 'session-phase6', workspaceId: 'workspace-phase6', issuedAt: new Date(now - 1_000).toISOString(), expiresAt: new Date(now + 60 * 60_000).toISOString(), lastCommandSequence: 0 },
    device: {
      device: { deviceId, displayName: 'Phase 6 Android', platform: 'android', capabilities: { ...v21, realtime: true, fileTransfer: true, fileTransferEncryption: true, notifications: false, camera: false, microphone: false, computerControl: false, browserControl: false } },
      trust: { ...v21, deviceId, workspaceId: 'workspace-phase6', status: 'trusted', fingerprint: sha256('device'), trustedAt: new Date(now - 1_000).toISOString(), expiresAt: new Date(now + 60 * 60_000).toISOString() },
      ownerBinding: { ...v21, bindingId: `binding-${deviceId}`, ownerSessionId: ownerSessionBindingId, deviceId, workspaceId: 'workspace-phase6', deviceFingerprint: sha256('device'), createdAt: new Date(now - 1_000).toISOString(), expiresAt: new Date(now + 60 * 60_000).toISOString(), status: 'active' },
      allowedCommands: ['task.list', 'file.upload', 'clipboard.publish', 'clipboard.consume', 'offline_queue.manage', 'handoff.manage', 'result_card.read', 'audio_handoff.manage'],
      createdAt: new Date(now - 1_000).toISOString(), updatedAt: new Date(now - 1_000).toISOString(),
    },
  };
}

function lineage(ctx: MobileSessionContext, sourceDeviceId = ctx.credential.deviceId, targetDeviceId = serverId) {
  return { ...v21, ownerSessionBindingId: ctx.device.ownerBinding.ownerSessionId, workspaceId: ctx.credential.workspaceId, sessionId: ctx.credential.sessionId, sourceDeviceId, targetDeviceId };
}

function clipboard(ctx: MobileSessionContext, content: string, clipboardId = 'clipboard-phase6'): CrossDeviceClipboardRequestV2 {
  const now = Date.now();
  return { ...lineage(ctx), clipboardId, direction: 'mobile_to_pc', mimeType: 'text/plain', content, explicitConsent: true, persistHistory: false, issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + 60_000).toISOString() };
}

async function listen(server: ReturnType<typeof createServer>): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('TEST_SERVER_ADDRESS_INVALID');
  return address.port;
}

const service = new CrossDeviceService(serverId);
const ctx = context();
const now = Date.now();

assert.equal(parseCrossDeviceClipboardRequestV2({ ...clipboard(ctx, 'safe'), unexpected: true }).success, false);
assert.equal(parseCrossDeviceClipboardRequestV2({ ...clipboard(ctx, 'safe'), apiKey: 'forbidden' }).success, false);
expectCode(() => service.offerClipboard(ctx, clipboard(ctx, 'api_key=AIzaabcdefghijklmnopqrstuvwxyz123456')), 'CLIPBOARD_SENSITIVE_CONTENT_REJECTED');
const offered = service.offerClipboard(ctx, clipboard(ctx, 'explicit clipboard text'));
assert.equal('content' in offered, false);
assert.equal(JSON.stringify(service.status()).includes('explicit clipboard text'), false);
assert.equal(service.consumeClipboard(ctx, offered.clipboardId).content, 'explicit clipboard text');
expectCode(() => service.consumeClipboard(ctx, offered.clipboardId), 'CLIPBOARD_NOT_FOUND');

const transfer: CrossDeviceTransferV2 = {
  ...lineage(ctx), transferId: 'transfer-phase6', direction: 'mobile_to_pc', category: 'document', fileName: 'report.txt', mediaType: 'text/plain', sizeBytes: 4, sha256: sha256('test'), status: 'pending',
  progress: { bytesTransferred: 0, totalBytes: 4, percent: 0, integrity: 'pending' },
  destination: { kind: 'downloads', opaqueHandle: 'download-handle-phase6', displaySummary: 'Downloads', conflictPolicy: 'collision_safe_rename', collisionDetected: true },
  resume: { ...v21, resumable: true, nextChunkIndex: 0, completedChunkIndexes: [], retryCount: 0, maxRetries: 3, acknowledgedBytes: 0 },
  capabilities: { open: false, export: false, share: false, openLocation: false }, createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(), expiresAt: new Date(now + 60_000).toISOString(),
};
assert.equal(parseCrossDeviceTransferV2(transfer).success, true);
assert.equal(parseCrossDeviceTransferV2({ ...transfer, fileName: '../escape.txt' }).success, false);
assert.equal(parseCrossDeviceTransferV2({ ...transfer, destination: { ...transfer.destination, opaqueHandle: 'C:\\private' } }).success, false);
assert.equal(parseCrossDeviceTransferV2({ ...transfer, destination: { ...transfer.destination, conflictPolicy: 'reject' }, status: 'pending' }).success, false);
assert.equal(service.putTransfer(ctx, transfer).status, 'pending');
const pcToMobile = { ...transfer, transferId: 'transfer-pc-mobile', direction: 'pc_to_mobile' as const, sourceDeviceId: serverId, targetDeviceId: ctx.credential.deviceId, destination: { ...transfer.destination, kind: 'mobile_inbox' as const, collisionDetected: false } };
assert.equal(service.putTransfer(ctx, pcToMobile).status, 'configuration_required');

const live = service.requestLiveView(ctx, {});
assert.equal(live.continuousAutoStream, false);
assert.equal(live.controlAuthority, false);
assert.equal(service.approveLiveView(ctx.device.ownerBinding.ownerSessionId, live.liveViewId).status, 'configuration_required');
assert.equal(service.stopLiveView(ctx, live.liveViewId).status, 'stopped');
assert.equal(parseCrossDeviceLiveViewSessionV2({ ...live, status: 'streaming', ownerApproved: false }).success, false);
const liveFrame = { ...lineage(ctx, serverId, ctx.credential.deviceId), liveViewId: live.liveViewId, frameId: 'frame-phase6', sequence: 1, observedAt: new Date().toISOString(), width: 1280, height: 720, cursor: { x: 0.5, y: 0.25 }, target: { targetId: 'target-phase6', label: 'Safe target', x: 0.1, y: 0.1, width: 0.2, height: 0.1 }, operatorState: 'observing' as const, containsPixels: false as const };
assert.equal(parseCrossDeviceLiveViewFrameMetadataV2(liveFrame).success, true);
assert.equal(parseCrossDeviceLiveViewFrameMetadataV2({ ...liveFrame, pixels: 'forbidden' }).success, false);
const wake = service.requestWake(ctx);
assert.equal(wake.attempted, false);
assert.equal(wake.runtimeReady, false);
assert.equal(parseCrossDeviceWakeReadyV2({ ...wake, status: 'ready', runtimeReady: true }).success, false);

const command: MobileRemoteCommandV2 = { ...v21, commandId: 'queued-command', command: 'task.list', deviceId: ctx.credential.deviceId, workspaceId: ctx.credential.workspaceId, sessionId: ctx.credential.sessionId, sequence: 1, idempotencyKey: 'phase6-queue-idempotency', riskLevel: 0, issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + 60_000).toISOString(), payload: { scope: 'summary' } };
const queued = service.enqueue(ctx, command);
assert.equal(queued.encryptedAtRest, true);
assert.equal('payload' in queued.command, false);
assert.equal(service.enqueue(ctx, { ...command, sequence: 2 }).queueItemId, queued.queueItemId);
expectCode(() => service.enqueue(ctx, { ...command, sequence: 2, payload: { scope: 'different' } }), 'DEVICE_IDEMPOTENCY_CONFLICT');
expectCode(() => service.enqueue(ctx, { ...command, commandId: 'stop', idempotencyKey: 'stop-idempotency', command: 'emergency_stop' }), 'EMERGENCY_STOP_QUEUE_FORBIDDEN');
assert.equal(service.cancelQueue(ctx, queued.queueItemId).status, 'cancelled');
assert.equal(service.dispatchPending(ctx).length, 0);
assert.equal(parseCrossDeviceOfflineQueueItemV2({ ...queued, ownerSessionBindingId: 'wrong-owner' }).success, true);
expectCode(() => service.cancelQueue(context('wrong-owner'), queued.queueItemId), 'CROSS_DEVICE_LINEAGE_MISMATCH');
const reconnectQueued = service.enqueue(ctx, { ...command, commandId: 'queued-reconnect', idempotencyKey: 'phase6-reconnect-idempotency' });
const reconnectDispatch = service.dispatchPending(ctx);
assert.equal(reconnectDispatch.length, 1);
assert.equal(reconnectDispatch[0].command.sequence, ctx.credential.lastCommandSequence + 1);
expectCode(() => service.completeQueue(ctx, reconnectQueued.queueItemId, { ...v21, commandId: 'wrong-command', deviceId: ctx.credential.deviceId, workspaceId: ctx.credential.workspaceId, sessionId: ctx.credential.sessionId, status: 'completed', completedAt: new Date().toISOString() }), 'OFFLINE_QUEUE_RESULT_BINDING_INVALID');
assert.equal(service.completeQueue(ctx, reconnectQueued.queueItemId, { ...v21, commandId: reconnectQueued.command.commandId, deviceId: ctx.credential.deviceId, workspaceId: ctx.credential.workspaceId, sessionId: ctx.credential.sessionId, status: 'completed', completedAt: new Date().toISOString() }).status, 'completed');

const mobileHandoff: CrossDeviceHandoffIntentV2 = { ...lineage(ctx), handoffId: 'handoff-mobile-pc', direction: 'mobile_to_desktop', intent: 'continue', taskId: 'task-phase6', artifactIds: ['artifact-phase6'], status: 'requested', requestedAt: new Date(now).toISOString(), expiresAt: new Date(now + 60_000).toISOString() };
assert.equal(service.createHandoff(ctx, mobileHandoff).taskId, 'task-phase6');
assert.equal(parseCrossDeviceHandoffIntentV2({ ...mobileHandoff, taskId: undefined, artifactIds: [] }).success, false);
const pcHandoff = { ...mobileHandoff, handoffId: 'handoff-pc-mobile', direction: 'desktop_to_mobile' as const, sourceDeviceId: serverId, targetDeviceId: ctx.credential.deviceId };
service.createHandoff(ctx, pcHandoff);
assert.equal(service.acknowledgeHandoff(ctx, pcHandoff.handoffId).status, 'acknowledged');

const legacy = { title: 'Completed', summary: 'Redacted result', outcome: 'success' as const, artifactIds: ['artifact-phase6'], completedAt: new Date(now).toISOString() };
const card = adaptLegacyResultCardToSharedV2(legacy, { ...lineage(ctx, serverId, ctx.credential.deviceId), cardId: 'card-phase6', kind: 'task', now: new Date(now).toISOString() });
assert.equal(parseSharedResultCardV2(card).success, true);
assert.deepEqual(adaptSharedResultCardToLegacyV2(card).artifactIds, legacy.artifactIds);
assert.equal(parseSharedResultCardV2({ ...card, preview: { safeText: 'raw', redacted: false } }).success, false);
assert.equal(parseSharedResultCardV2({ ...card, preview: { safeText: 'api_key=AIzaabcdefghijklmnopqrstuvwxyz123456', redacted: true } }).success, false);
service.putResultCard(ctx, card);
expectCode(() => service.putResultCard(ctx, card), 'RESULT_CARD_REVISION_CONFLICT');

const audio: CrossDeviceAudioHandoffV2 = { ...lineage(ctx, serverId, ctx.credential.deviceId), handoffId: 'audio-phase6', leaseId: 'lease-phase6', epoch: 1, sourceCaptureDeviceId: serverId, targetCaptureDeviceId: ctx.credential.deviceId, status: 'requested', simultaneousCaptureAllowed: false, requestedAt: new Date(now).toISOString(), expiresAt: new Date(now + 60_000).toISOString() };
service.requestAudioHandoff(ctx, audio);
expectCode(() => service.requestAudioHandoff(ctx, { ...audio, handoffId: 'audio-conflict', leaseId: 'lease-conflict', epoch: 2 }), 'AUDIO_CAPTURE_LEASE_CONFLICT');
assert.equal(service.acknowledgeAudioHandoff(ctx, audio.handoffId, 1).status, 'active');
assert.equal(service.releaseAudioHandoff(ctx, audio.handoffId, 1).status, 'released');

const status: CrossDevicePcStatusV2 = { ...lineage(ctx, serverId, ctx.credential.deviceId), snapshotId: 'status-phase6', runtime: 'ready', observedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 30_000).toISOString(), metrics: { cpuPercent: 20, ramPercent: 40, networkState: 'online', activeDownloads: 0, voiceActive: false, computerUseActive: false }, source: 'backend_runtime' };
assert.equal(service.updatePcStatus(ctx, status).snapshotId, status.snapshotId);
assert.equal(parseCrossDevicePcStatusV2({ ...status, metrics: { cpuPercent: 101 } }).success, false);
expectCode(() => service.updatePcStatus(ctx, { ...status, snapshotId: 'stale-status', observedAt: new Date(Date.now() - 120_000).toISOString(), expiresAt: new Date(Date.now() - 60_000).toISOString() }), 'PC_STATUS_STALE');

const quiet = { ...v21, workspaceId: ctx.credential.workspaceId, ownerSessionBindingId: ctx.device.ownerBinding.ownerSessionId, revision: 1, enabled: true, startLocal: '22:00', endLocal: '07:00', timezone: 'Europe/Istanbul', suppressAudio: true, suppressNotifications: true, updatedAt: new Date().toISOString() };
assert.equal(service.setQuietHours(quiet, ctx.device.ownerBinding.ownerSessionId).revision, 1);
expectCode(() => service.setQuietHours(quiet, ctx.device.ownerBinding.ownerSessionId), 'CROSS_DEVICE_QUIET_HOURS_REVISION_CONFLICT');
expectCode(() => service.setQuietHours({ ...quiet, revision: 2, timezone: 'Invalid/Timezone' }, ctx.device.ownerBinding.ownerSessionId), 'CROSS_DEVICE_QUIET_HOURS_TIMEZONE_INVALID');
expectCode(() => service.requestAudioHandoff(ctx, { ...audio, handoffId: 'audio-quiet-stale', leaseId: 'lease-quiet-stale', epoch: 2 }), 'AUDIO_HANDOFF_QUIET_HOURS_STALE');
assert.equal(service.requestAudioHandoff(ctx, { ...audio, handoffId: 'audio-quiet-current', leaseId: 'lease-quiet-current', epoch: 2, quietHoursRevision: 1 }).quietHoursRevision, 1);

const realtimePayloads = [
  [REALTIME_EVENT_NAMES.CROSS_DEVICE_TRANSFER_STATUS, transfer],
  [REALTIME_EVENT_NAMES.CROSS_DEVICE_CLIPBOARD_STATUS, offered],
  [REALTIME_EVENT_NAMES.CROSS_DEVICE_LIVE_VIEW_STATUS, live],
  [REALTIME_EVENT_NAMES.CROSS_DEVICE_LIVE_VIEW_FRAME_METADATA, liveFrame],
  [REALTIME_EVENT_NAMES.CROSS_DEVICE_WAKE_READY_STATUS, wake],
  [REALTIME_EVENT_NAMES.CROSS_DEVICE_OFFLINE_QUEUE_STATUS, queued],
  [REALTIME_EVENT_NAMES.CROSS_DEVICE_HANDOFF_STATUS, mobileHandoff],
  [REALTIME_EVENT_NAMES.CROSS_DEVICE_RESULT_CARD_UPDATED, card],
  [REALTIME_EVENT_NAMES.CROSS_DEVICE_AUDIO_HANDOFF_STATUS, audio],
  [REALTIME_EVENT_NAMES.CROSS_DEVICE_PC_STATUS_UPDATED, status],
] as const;
for (const [event, payload] of realtimePayloads) {
  const envelope = { schema: EDITH_CONTRACT_SCHEMA, version: EDITH_CONTRACT_VERSION, event, eventId: `event-${event}`, occurredAt: new Date().toISOString(), sequence: 1, streamId: 'stream-phase6', cursor: 1, correlationId: 'correlation-phase6', replayed: false, payload };
  assert.equal(parseRealtimeEnvelopeV2_1(envelope).success, true, event);
  assert.equal(parseRealtimeEnvelopeV2_1({ ...envelope, payload: { garbage: true } }).success, false, `${event}:garbage`);
}

const app = express();
app.use(express.json());
app.use(createOwnerSessionRouter());
app.get('/binding', requireOwnerSession, (req, res) => res.json({ bindingId: getOwnerSession(req)!.bindingId }));
const server = createServer(app);
const previousToken = process.env.EDITH_OWNER_TOKEN;
process.env.EDITH_OWNER_TOKEN = 'phase6-owner-token';
const port = await listen(server);
let invalidated = false;
const logoutService = new CrossDeviceService(serverId);
const unsubscribe = onOwnerSessionInvalidated((event) => { invalidated = event.reason === 'logout'; logoutService.invalidateOwnerBinding(event.bindingId); });
try {
  const origin = `http://127.0.0.1:${port}`;
  const login = await fetch(`${origin}/api/security/session`, { method: 'POST', headers: { origin, authorization: 'Bearer phase6-owner-token' } });
  assert.equal(login.status, 201);
  const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';
  const loginBody = await login.json() as { session: { csrfToken: string } };
  const bindingResponse = await fetch(`${origin}/binding`, { headers: { cookie } });
  const bindingId = ((await bindingResponse.json()) as { bindingId: string }).bindingId;
  const logoutContext = context(bindingId, 'android-logout');
  const logoutClipboard = logoutService.offerClipboard(logoutContext, clipboard(logoutContext, 'remove on logout', 'logout-clipboard'));
  const logoutLiveView = logoutService.requestLiveView(logoutContext, {});
  const logoutTransfer = logoutService.putTransfer(logoutContext, { ...transfer, ...lineage(logoutContext), transferId: 'logout-transfer' });
  const logoutCommand = { ...command, deviceId: logoutContext.credential.deviceId, workspaceId: logoutContext.credential.workspaceId, sessionId: logoutContext.credential.sessionId, commandId: 'logout-queue-command', idempotencyKey: 'logout-queue-idempotency' };
  logoutService.enqueue(logoutContext, logoutCommand);
  const logoutAudio = { ...audio, ...lineage(logoutContext, serverId, logoutContext.credential.deviceId), handoffId: 'logout-audio', leaseId: 'logout-audio-lease', epoch: 1, sourceCaptureDeviceId: serverId, targetCaptureDeviceId: logoutContext.credential.deviceId };
  logoutService.requestAudioHandoff(logoutContext, logoutAudio);
  const logout = await fetch(`${origin}/api/security/session`, { method: 'DELETE', headers: { origin, cookie, 'x-edith-csrf-token': loginBody.session.csrfToken, 'sec-fetch-site': 'same-origin' } });
  assert.equal(logout.status, 200);
  assert.equal(invalidated, true);
  expectCode(() => logoutService.consumeClipboard(logoutContext, logoutClipboard.clipboardId), 'CLIPBOARD_NOT_FOUND');
  assert.equal(logoutService.dispatchPending(logoutContext).length, 0);
  expectCode(() => logoutService.approveLiveView(bindingId, logoutLiveView.liveViewId), 'LIVE_VIEW_NOT_ACTIVE');
  expectCode(() => logoutService.cancelTransfer(logoutContext, logoutTransfer.transferId), 'CROSS_DEVICE_TRANSFER_NOT_CANCELLABLE');
  assert.equal(logoutService.requestAudioHandoff(logoutContext, { ...logoutAudio, handoffId: 'logout-audio-next', leaseId: 'logout-audio-lease-next', epoch: 2 }).status, 'requested');
} finally {
  unsubscribe();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (previousToken === undefined) delete process.env.EDITH_OWNER_TOKEN; else process.env.EDITH_OWNER_TOKEN = previousToken;
}

console.log(JSON.stringify({ success: true, checks: [
  'strict_unknown_and_secret_rejection', 'clipboard_consent_ttl_no_persistence_single_consume', 'transfer_direction_path_collision_no_overwrite',
  'live_view_no_auto_stream_configuration_required', 'wake_unsupported_honest', 'offline_queue_encrypted_idempotent_cancel_emergency_excluded',
  'handoff_identity_and_target_ack', 'result_card_canonical_adapter_redaction_revision', 'audio_single_capture_lease_epoch',
  'pc_status_metric_and_freshness', 'quiet_hours_owner_revision_timezone', 'strict_cross_device_realtime_payloads', 'owner_logout_cross_device_invalidation',
] }, null, 2));
