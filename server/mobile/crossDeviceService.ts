import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  EDITH_CONTRACT_AMENDMENT,
  TASK_CONTRACT_VERSION,
  parseCrossDeviceAudioHandoffV2,
  parseCrossDeviceClipboardMetadataV2,
  parseCrossDeviceClipboardRequestV2,
  parseCrossDeviceHandoffIntentV2,
  parseCrossDeviceLiveViewSessionV2,
  parseCrossDeviceOfflineQueueItemV2,
  parseCrossDevicePcStatusV2,
  parseCrossDeviceQuietHoursV2,
  parseCrossDeviceTransferV2,
  parseCrossDeviceWakeReadyV2,
  parseMobileRemoteCommandResultV2,
  parseMobileRemoteCommandV2,
  parseSharedResultCardV2,
  type CrossDeviceAudioHandoffV2,
  type CrossDeviceClipboardMetadataV2,
  type CrossDeviceClipboardRequestV2,
  type CrossDeviceHandoffIntentV2,
  type CrossDeviceLiveViewSessionV2,
  type CrossDeviceLiveViewFrameMetadataV2,
  type CrossDeviceOfflineQueueItemV2,
  type CrossDevicePcStatusV2,
  type CrossDeviceQuietHoursV2,
  type CrossDeviceTransferV2,
  type CrossDeviceWakeReadyV2,
  type FileTransferDescriptorV2,
  type MobileRemoteCommandResultV2,
  type MobileRemoteCommandV2,
  type SharedResultCardV2,
} from '../../src/edith/contracts';
import type { MobileSessionContext } from './types';
import { sha256 } from './crypto';

const MAX_RECORDS = 1_000;
const CLIPBOARD_TTL_MS = 5 * 60_000;
const LIVE_VIEW_TTL_MS = 15 * 60_000;
const HANDOFF_TTL_MS = 15 * 60_000;
const AUDIO_TTL_MS = 15 * 60_000;
const STATUS_FRESHNESS_MS = 60_000;

interface EncryptedMemoryValue {
  nonce: Buffer;
  ciphertext: Buffer;
  tag: Buffer;
}

interface ClipboardRecord { metadata: CrossDeviceClipboardMetadataV2; encrypted: EncryptedMemoryValue }
interface QueueRecord { view: CrossDeviceOfflineQueueItemV2; encrypted: EncryptedMemoryValue; idempotencyFingerprint: string }

function commandFingerprint(command: MobileRemoteCommandV2): string {
  return createHash('sha256').update(JSON.stringify({ ...command, sequence: undefined })).digest('hex');
}

function containsSensitiveClipboardValue(value: string): boolean {
  const patterns = [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
    /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|client[_-]?secret)\s*[:=]/i,
    /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
    /\bAIza[0-9A-Za-z_-]{30,}\b/,
    /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
    /https?:\/\/[^\s/@:]+:[^\s/@]+@/i,
  ];
  return patterns.some((pattern) => pattern.test(value));
}

function boundedSet<K, V>(map: Map<K, V>, key: K, value: V): void {
  map.set(key, value);
  while (map.size > MAX_RECORDS) map.delete(map.keys().next().value!);
}

export class CrossDeviceService {
  private readonly memoryKey = randomBytes(32);
  private readonly clipboards = new Map<string, ClipboardRecord>();
  private readonly transfers = new Map<string, CrossDeviceTransferV2>();
  private readonly liveViews = new Map<string, CrossDeviceLiveViewSessionV2>();
  private readonly wakeRequests = new Map<string, CrossDeviceWakeReadyV2>();
  private readonly queue = new Map<string, QueueRecord>();
  private readonly queueIdempotency = new Map<string, string>();
  private readonly handoffs = new Map<string, CrossDeviceHandoffIntentV2>();
  private readonly resultCards = new Map<string, SharedResultCardV2>();
  private readonly audioLeases = new Map<string, CrossDeviceAudioHandoffV2>();
  private readonly pcStatuses = new Map<string, CrossDevicePcStatusV2>();
  private readonly quietHours = new Map<string, CrossDeviceQuietHoursV2>();
  private readonly liveViewFrameSequence = new Map<string, number>();

  constructor(private readonly serverId: string) {}

  invalidateOwnerBinding(bindingId: string): void {
    for (const [id, value] of this.transfers) if (value.ownerSessionBindingId === bindingId && ['pending', 'transferring'].includes(value.status)) this.transfers.set(id, { ...value, status: 'cancelled', updatedAt: new Date().toISOString(), errorCode: 'OWNER_SESSION_REVOKED' });
    for (const [id, record] of this.clipboards) if (record.metadata.ownerSessionBindingId === bindingId) this.clipboards.delete(id);
    for (const [id, value] of this.liveViews) if (value.ownerSessionBindingId === bindingId) this.liveViews.set(id, { ...value, status: 'stopped', stoppedAt: new Date().toISOString(), errorCode: 'OWNER_SESSION_REVOKED' });
    for (const [id, value] of this.wakeRequests) if (value.ownerSessionBindingId === bindingId) this.wakeRequests.delete(id);
    for (const [id, record] of this.queue) if (record.view.ownerSessionBindingId === bindingId && record.view.status === 'pending') this.queue.set(id, { ...record, view: { ...record.view, status: 'cancelled', cancelledAt: new Date().toISOString(), errorCode: 'OWNER_SESSION_REVOKED' } });
    for (const [id, value] of this.handoffs) if (value.ownerSessionBindingId === bindingId && value.status === 'requested') this.handoffs.set(id, { ...value, status: 'rejected' });
    for (const [workspaceId, value] of this.audioLeases) if (value.ownerSessionBindingId === bindingId && ['requested', 'acknowledged', 'active'].includes(value.status)) this.audioLeases.set(workspaceId, { ...value, status: 'released' });
    for (const [id, value] of this.pcStatuses) if (value.ownerSessionBindingId === bindingId) this.pcStatuses.delete(id);
    for (const [id, value] of this.resultCards) if (value.ownerSessionBindingId === bindingId) this.resultCards.delete(id);
    for (const [id, value] of this.liveViews) if (value.ownerSessionBindingId === bindingId) this.liveViewFrameSequence.delete(id);
  }

  emergencyStop(): void {
    const bindings = new Set<string>();
    for (const value of this.transfers.values()) bindings.add(value.ownerSessionBindingId);
    for (const value of this.liveViews.values()) bindings.add(value.ownerSessionBindingId);
    for (const value of this.audioLeases.values()) bindings.add(value.ownerSessionBindingId);
    for (const value of this.pcStatuses.values()) bindings.add(value.ownerSessionBindingId);
    for (const bindingId of bindings) this.invalidateOwnerBinding(bindingId);
  }

  putTransfer(context: MobileSessionContext, transfer: CrossDeviceTransferV2): CrossDeviceTransferV2 {
    this.cleanup();
    const parsed = parseCrossDeviceTransferV2(transfer);
    if (parsed.success === false) throw new Error(parsed.errorCode);
    this.assertLineage(context, parsed.value);
    if (parsed.value.direction === 'mobile_to_pc' && (parsed.value.sourceDeviceId !== context.credential.deviceId || parsed.value.targetDeviceId !== this.serverId) || parsed.value.direction === 'pc_to_mobile' && (parsed.value.sourceDeviceId !== this.serverId || parsed.value.targetDeviceId !== context.credential.deviceId)) throw new Error('CROSS_DEVICE_TRANSFER_DIRECTION_MISMATCH');
    const prior = this.transfers.get(parsed.value.transferId);
    if (prior && prior.sha256 !== parsed.value.sha256) throw new Error('TRANSFER_IDEMPOTENCY_CONFLICT');
    if (prior && (parsed.value.progress.bytesTransferred < prior.progress.bytesTransferred || prior.status === 'completed' && parsed.value.status !== 'completed')) throw new Error('TRANSFER_PROGRESS_ROLLBACK');
    const honest = parsed.value.direction === 'pc_to_mobile'
      ? { ...parsed.value, status: 'configuration_required' as const, capabilities: { open: false, export: false, share: false, openLocation: false }, errorCode: 'NATIVE_PC_TO_MOBILE_TRANSFER_ADAPTER_CONFIGURATION_REQUIRED' }
      : parsed.value;
    boundedSet(this.transfers, honest.transferId, honest);
    return honest;
  }

  getTransfer(context: MobileSessionContext, transferId: string): CrossDeviceTransferV2 {
    const value = this.transfers.get(transferId);
    if (!value) throw new Error('CROSS_DEVICE_TRANSFER_NOT_FOUND');
    this.assertLineage(context, value);
    return value;
  }

  syncMobileTransfer(context: MobileSessionContext, descriptor: FileTransferDescriptorV2): CrossDeviceTransferV2 {
    const createdAt = descriptor.createdAt ?? new Date().toISOString();
    const bytesTransferred = descriptor.resume?.acknowledgedBytes ?? 0;
    const status = descriptor.status;
    const category: CrossDeviceTransferV2['category'] = descriptor.mediaType === 'application/pdf' ? 'pdf' : descriptor.mediaType.startsWith('image/') ? 'image' : descriptor.mediaType.startsWith('text/') || descriptor.mediaType === 'application/json' ? 'document' : 'other';
    return this.putTransfer(context, {
      ...this.lineage(context, context.credential.deviceId, this.serverId), transferId: descriptor.transferId, direction: 'mobile_to_pc', category,
      fileName: descriptor.fileName, mediaType: descriptor.mediaType, sourceComputerLabel: context.device.device.displayName,
      sizeBytes: descriptor.sizeBytes, sha256: descriptor.sha256, status,
      progress: { bytesTransferred, totalBytes: descriptor.sizeBytes, percent: Number(((bytesTransferred / descriptor.sizeBytes) * 100).toFixed(2)), integrity: status === 'completed' ? 'verified' : status === 'failed' ? 'failed' : 'pending' },
      destination: { kind: 'approved_folder', opaqueHandle: descriptor.destination?.handle ?? `transfer-${descriptor.transferId}`, displaySummary: 'E.D.I.T.H. mobile inbox', conflictPolicy: 'reject', collisionDetected: false },
      resume: descriptor.resume ?? { contractVersion: TASK_CONTRACT_VERSION, amendment: EDITH_CONTRACT_AMENDMENT, resumable: true, nextChunkIndex: 0, completedChunkIndexes: [], retryCount: 0, maxRetries: 5, acknowledgedBytes: bytesTransferred },
      capabilities: { open: false, export: false, share: false, openLocation: false },
      candidateEvidence: { candidateId: `candidate-${descriptor.transferId}`, source: 'explicit_selection', verified: true, evidenceSummary: 'Authenticated mobile upload descriptor and chunk manifest.' },
      createdAt, updatedAt: descriptor.updatedAt ?? createdAt, expiresAt: new Date(Date.parse(createdAt) + 23 * 60 * 60_000).toISOString(),
    });
  }

  cancelTransfer(context: MobileSessionContext, transferId: string): CrossDeviceTransferV2 {
    const value = this.transfers.get(transferId);
    if (!value) throw new Error('CROSS_DEVICE_TRANSFER_NOT_FOUND');
    this.assertLineage(context, value);
    if (!['pending', 'transferring', 'configuration_required'].includes(value.status)) throw new Error('CROSS_DEVICE_TRANSFER_NOT_CANCELLABLE');
    const next = { ...value, status: 'cancelled' as const, updatedAt: new Date().toISOString() };
    this.transfers.set(transferId, next);
    return next;
  }

  offerClipboard(context: MobileSessionContext, request: CrossDeviceClipboardRequestV2): CrossDeviceClipboardMetadataV2 {
    this.cleanup();
    const parsed = parseCrossDeviceClipboardRequestV2(request);
    if (parsed.success === false) throw new Error(parsed.errorCode);
    this.assertLineage(context, parsed.value);
    if (parsed.value.direction !== 'mobile_to_pc' || parsed.value.targetDeviceId !== this.serverId) throw new Error('CLIPBOARD_DIRECTION_NOT_SUPPORTED');
    if (containsSensitiveClipboardValue(parsed.value.content)) throw new Error('CLIPBOARD_SENSITIVE_CONTENT_REJECTED');
    const bytes = Buffer.from(parsed.value.content, 'utf8');
    const { content: _content, ...publicRequest } = parsed.value;
    const metadata: CrossDeviceClipboardMetadataV2 = {
      ...publicRequest,
      contentBytes: bytes.length,
      contentFingerprint: sha256(bytes),
      status: 'available',
      sensitive: false,
    };
    const checked = parseCrossDeviceClipboardMetadataV2(metadata);
    if (checked.success === false) throw new Error(checked.errorCode);
    boundedSet(this.clipboards, metadata.clipboardId, { metadata: checked.value, encrypted: this.encryptMemory(parsed.value.content) });
    return checked.value;
  }

  consumeClipboard(context: MobileSessionContext, clipboardId: string): { metadata: CrossDeviceClipboardMetadataV2; content: string } {
    this.cleanup();
    const record = this.clipboards.get(clipboardId);
    if (!record) throw new Error('CLIPBOARD_NOT_FOUND');
    this.assertLineage(context, record.metadata);
    if (record.metadata.status !== 'available') throw new Error('CLIPBOARD_ALREADY_CONSUMED');
    const content = this.decryptMemory(record.encrypted);
    const metadata = { ...record.metadata, status: 'consumed' as const };
    this.clipboards.delete(clipboardId);
    return { metadata, content };
  }

  requestLiveView(context: MobileSessionContext, input: { liveViewId?: string; expiresAt?: string }): CrossDeviceLiveViewSessionV2 {
    this.cleanup();
    const now = new Date();
    const value: CrossDeviceLiveViewSessionV2 = {
      ...this.lineage(context, context.credential.deviceId, this.serverId),
      liveViewId: input.liveViewId ?? `live-view-${randomUUID()}`,
      status: 'requested', ownerApproved: false, continuousAutoStream: false, controlAuthority: false,
      framePolicy: { maxFramesPerSecond: 2, maxWidth: 1280, maxHeight: 720 },
      overlayCapabilities: { cursor: true, click: true, target: true, operatorState: true },
      expiresAt: input.expiresAt ?? new Date(now.getTime() + LIVE_VIEW_TTL_MS).toISOString(),
    };
    const parsed = parseCrossDeviceLiveViewSessionV2(value);
    if (parsed.success === false) throw new Error(parsed.errorCode);
    boundedSet(this.liveViews, value.liveViewId, parsed.value);
    return parsed.value;
  }

  approveLiveView(bindingId: string, liveViewId: string): CrossDeviceLiveViewSessionV2 {
    this.cleanup();
    const value = this.liveViews.get(liveViewId);
    if (!value || value.ownerSessionBindingId !== bindingId) throw new Error('LIVE_VIEW_NOT_FOUND');
    if (value.status !== 'requested' || Date.parse(value.expiresAt) <= Date.now()) throw new Error('LIVE_VIEW_NOT_ACTIVE');
    const next: CrossDeviceLiveViewSessionV2 = { ...value, ownerApproved: true, status: 'configuration_required', errorCode: 'NATIVE_LIVE_VIEW_ADAPTER_CONFIGURATION_REQUIRED' };
    this.liveViews.set(liveViewId, next);
    return next;
  }

  stopLiveView(context: MobileSessionContext, liveViewId: string): CrossDeviceLiveViewSessionV2 {
    const value = this.liveViews.get(liveViewId);
    if (!value) throw new Error('LIVE_VIEW_NOT_FOUND');
    this.assertLineage(context, value);
    const next: CrossDeviceLiveViewSessionV2 = { ...value, status: 'stopped', stoppedAt: new Date().toISOString() };
    this.liveViews.set(liveViewId, next);
    return next;
  }

  stopLiveViewByOwner(bindingId: string, liveViewId: string): CrossDeviceLiveViewSessionV2 {
    const value = this.liveViews.get(liveViewId);
    if (!value || value.ownerSessionBindingId !== bindingId) throw new Error('LIVE_VIEW_NOT_FOUND');
    const next: CrossDeviceLiveViewSessionV2 = { ...value, status: 'stopped', stoppedAt: new Date().toISOString() };
    this.liveViews.set(liveViewId, next);
    return next;
  }

  ingestLiveViewFrame(context: MobileSessionContext, frame: CrossDeviceLiveViewFrameMetadataV2): CrossDeviceLiveViewSessionV2 {
    this.cleanup();
    this.assertLineage(context, frame);
    const liveView = this.liveViews.get(frame.liveViewId);
    if (!liveView || liveView.ownerSessionBindingId !== frame.ownerSessionBindingId || liveView.workspaceId !== frame.workspaceId || liveView.sessionId !== frame.sessionId) throw new Error('LIVE_VIEW_NOT_FOUND');
    if (!liveView.ownerApproved || !['approved', 'configuration_required', 'streaming'].includes(liveView.status) || Date.parse(liveView.expiresAt) <= Date.now()) throw new Error('LIVE_VIEW_NOT_ACTIVE');
    const previous = this.liveViewFrameSequence.get(frame.liveViewId) ?? 0;
    if (frame.sequence !== previous + 1) throw new Error('LIVE_VIEW_FRAME_SEQUENCE_INVALID');
    this.liveViewFrameSequence.set(frame.liveViewId, frame.sequence);
    const next: CrossDeviceLiveViewSessionV2 = { ...liveView, status: 'streaming', startedAt: liveView.startedAt ?? frame.observedAt, errorCode: undefined };
    this.liveViews.set(frame.liveViewId, next);
    return next;
  }

  requestWake(context: MobileSessionContext): CrossDeviceWakeReadyV2 {
    const now = new Date().toISOString();
    const value: CrossDeviceWakeReadyV2 = {
      ...this.lineage(context, context.credential.deviceId, this.serverId),
      requestId: `wake-${randomUUID()}`, capability: 'wake_on_lan', capabilityStatus: 'configuration_required',
      status: 'configuration_required', attempted: false, runtimeReady: false, requestedAt: now, completedAt: now,
      errorCode: 'WAKE_ON_LAN_CONFIGURATION_REQUIRED',
    };
    const parsed = parseCrossDeviceWakeReadyV2(value);
    if (parsed.success === false) throw new Error(parsed.errorCode);
    boundedSet(this.wakeRequests, value.requestId, parsed.value);
    return parsed.value;
  }

  putWakeResult(context: MobileSessionContext, result: CrossDeviceWakeReadyV2): CrossDeviceWakeReadyV2 {
    const parsed = parseCrossDeviceWakeReadyV2(result);
    if (parsed.success === false) throw new Error(parsed.errorCode);
    this.assertLineage(context, parsed.value);
    boundedSet(this.wakeRequests, parsed.value.requestId, parsed.value);
    return parsed.value;
  }

  enqueue(context: MobileSessionContext, command: MobileRemoteCommandV2): CrossDeviceOfflineQueueItemV2 {
    this.cleanup();
    const parsed = parseMobileRemoteCommandV2(command);
    if (parsed.success === false) throw new Error(parsed.errorCode);
    if (parsed.value.command === 'emergency_stop') throw new Error('EMERGENCY_STOP_QUEUE_FORBIDDEN');
    this.assertCommandLineage(context, parsed.value);
    if (!context.device.allowedCommands.includes(parsed.value.command)) throw new Error('DEVICE_COMMAND_NOT_ALLOWED');
    const fingerprint = commandFingerprint(parsed.value);
    const idempotencyScope = `${parsed.value.deviceId}:${parsed.value.idempotencyKey}`;
    const priorId = this.queueIdempotency.get(idempotencyScope);
    if (priorId) {
      const prior = this.queue.get(priorId);
      if (!prior || prior.idempotencyFingerprint !== fingerprint) throw new Error('DEVICE_IDEMPOTENCY_CONFLICT');
      return prior.view;
    }
    const queuedAt = new Date().toISOString();
    const view: CrossDeviceOfflineQueueItemV2 = {
      ...this.lineage(context, parsed.value.deviceId, this.serverId), queueItemId: `queue-${randomUUID()}`,
      command: {
        commandId: parsed.value.commandId, command: parsed.value.command as Exclude<typeof parsed.value.command, 'emergency_stop'>,
        deviceId: parsed.value.deviceId, workspaceId: parsed.value.workspaceId, sessionId: parsed.value.sessionId,
        idempotencyKey: parsed.value.idempotencyKey, riskLevel: parsed.value.riskLevel, issuedAt: parsed.value.issuedAt,
        expiresAt: parsed.value.expiresAt, payloadFingerprint: sha256(JSON.stringify(parsed.value.payload ?? {})),
      },
      status: 'pending', encryptedAtRest: true, queuedAt, expiresAt: parsed.value.expiresAt,
    };
    const checked = parseCrossDeviceOfflineQueueItemV2(view);
    if (checked.success === false) throw new Error(checked.errorCode);
    boundedSet(this.queue, view.queueItemId, { view: checked.value, encrypted: this.encryptMemory(JSON.stringify(parsed.value)), idempotencyFingerprint: fingerprint });
    boundedSet(this.queueIdempotency, idempotencyScope, view.queueItemId);
    return checked.value;
  }

  cancelQueue(context: MobileSessionContext, queueItemId: string): CrossDeviceOfflineQueueItemV2 {
    const record = this.queue.get(queueItemId);
    if (!record) throw new Error('OFFLINE_QUEUE_NOT_FOUND');
    this.assertLineage(context, record.view);
    if (record.view.status !== 'pending') throw new Error('OFFLINE_QUEUE_NOT_CANCELLABLE');
    record.view = { ...record.view, status: 'cancelled', cancelledAt: new Date().toISOString() };
    return record.view;
  }

  dispatchPending(context: MobileSessionContext): Array<{ item: CrossDeviceOfflineQueueItemV2; command: MobileRemoteCommandV2 }> {
    this.cleanup();
    const dispatched: Array<{ item: CrossDeviceOfflineQueueItemV2; command: MobileRemoteCommandV2 }> = [];
    let nextSequence = context.credential.lastCommandSequence + 1;
    for (const record of this.queue.values()) {
      if (record.view.status !== 'pending' || record.view.sourceDeviceId !== context.credential.deviceId || record.view.sessionId !== context.credential.sessionId) continue;
      const command = { ...(JSON.parse(this.decryptMemory(record.encrypted)) as MobileRemoteCommandV2), sequence: nextSequence, issuedAt: new Date().toISOString() };
      this.assertCommandLineage(context, command);
      record.view = { ...record.view, status: 'dispatching', dispatchedAt: new Date().toISOString() };
      dispatched.push({ item: record.view, command });
      nextSequence += 1;
    }
    return dispatched;
  }

  completeQueue(context: MobileSessionContext, queueItemId: string, result: MobileRemoteCommandResultV2): CrossDeviceOfflineQueueItemV2 {
    const record = this.queue.get(queueItemId);
    if (!record) throw new Error('OFFLINE_QUEUE_NOT_FOUND');
    this.assertLineage(context, record.view);
    const parsed = parseMobileRemoteCommandResultV2(result);
    if (parsed.success === false || parsed.value.commandId !== record.view.command.commandId || parsed.value.deviceId !== context.credential.deviceId || parsed.value.workspaceId !== context.credential.workspaceId || parsed.value.sessionId !== context.credential.sessionId) throw new Error('OFFLINE_QUEUE_RESULT_BINDING_INVALID');
    record.view = { ...record.view, status: parsed.value.status === 'completed' ? 'completed' : 'failed', completedAt: parsed.value.completedAt, result: parsed.value, errorCode: parsed.value.errorCode };
    return record.view;
  }

  createHandoff(context: MobileSessionContext, input: CrossDeviceHandoffIntentV2): CrossDeviceHandoffIntentV2 {
    this.cleanup();
    const parsed = parseCrossDeviceHandoffIntentV2(input);
    if (parsed.success === false) throw new Error(parsed.errorCode);
    this.assertLineage(context, parsed.value);
    if (parsed.value.direction === 'mobile_to_desktop' && (parsed.value.sourceDeviceId !== context.credential.deviceId || parsed.value.targetDeviceId !== this.serverId) || parsed.value.direction === 'desktop_to_mobile' && (parsed.value.sourceDeviceId !== this.serverId || parsed.value.targetDeviceId !== context.credential.deviceId)) throw new Error('HANDOFF_DIRECTION_MISMATCH');
    boundedSet(this.handoffs, parsed.value.handoffId, parsed.value);
    return parsed.value;
  }

  acknowledgeHandoff(context: MobileSessionContext, handoffId: string): CrossDeviceHandoffIntentV2 {
    const value = this.handoffs.get(handoffId);
    if (!value || value.targetDeviceId !== context.credential.deviceId || value.workspaceId !== context.credential.workspaceId) throw new Error('HANDOFF_TARGET_MISMATCH');
    if (value.status !== 'requested' || Date.parse(value.expiresAt) <= Date.now()) throw new Error('HANDOFF_NOT_ACTIVE');
    const next = { ...value, status: 'acknowledged' as const, acknowledgedAt: new Date().toISOString() };
    this.handoffs.set(handoffId, next);
    return next;
  }

  putResultCard(context: MobileSessionContext, card: SharedResultCardV2): SharedResultCardV2 {
    const parsed = parseSharedResultCardV2(card);
    if (parsed.success === false) throw new Error(parsed.errorCode);
    this.assertLineage(context, parsed.value);
    const prior = this.resultCards.get(parsed.value.cardId);
    if (parsed.value.revision !== (prior?.revision ?? 0) + 1) throw new Error('RESULT_CARD_REVISION_CONFLICT');
    if (prior && (parsed.value.createdAt !== prior.createdAt || Date.parse(parsed.value.updatedAt) <= Date.parse(prior.updatedAt))) throw new Error('RESULT_CARD_TIMESTAMP_CONFLICT');
    boundedSet(this.resultCards, parsed.value.cardId, parsed.value);
    return parsed.value;
  }

  listResultCards(context: MobileSessionContext): SharedResultCardV2[] {
    this.cleanup();
    return [...this.resultCards.values()].filter((card) => card.workspaceId === context.credential.workspaceId && (card.targetDeviceId === context.credential.deviceId || card.sourceDeviceId === context.credential.deviceId));
  }

  requestAudioHandoff(context: MobileSessionContext, input: CrossDeviceAudioHandoffV2): CrossDeviceAudioHandoffV2 {
    this.cleanup();
    const parsed = parseCrossDeviceAudioHandoffV2(input);
    if (parsed.success === false) throw new Error(parsed.errorCode);
    this.assertLineage(context, parsed.value);
    const quietHours = this.quietHours.get(parsed.value.workspaceId);
    if (quietHours && parsed.value.quietHoursRevision !== quietHours.revision) throw new Error('AUDIO_HANDOFF_QUIET_HOURS_STALE');
    const active = this.audioLeases.get(parsed.value.workspaceId);
    if (active && ['requested', 'acknowledged', 'active'].includes(active.status) && Date.parse(active.expiresAt) > Date.now()) throw new Error('AUDIO_CAPTURE_LEASE_CONFLICT');
    boundedSet(this.audioLeases, parsed.value.workspaceId, parsed.value);
    return parsed.value;
  }

  putAudioHandoffState(context: MobileSessionContext, input: CrossDeviceAudioHandoffV2): CrossDeviceAudioHandoffV2 {
    const parsed = parseCrossDeviceAudioHandoffV2(input);
    if (parsed.success === false) throw new Error(parsed.errorCode);
    this.assertLineage(context, parsed.value);
    const prior = this.audioLeases.get(parsed.value.workspaceId);
    if (prior && prior.handoffId === parsed.value.handoffId && parsed.value.epoch < prior.epoch) throw new Error('AUDIO_HANDOFF_EPOCH_ROLLBACK');
    boundedSet(this.audioLeases, parsed.value.workspaceId, parsed.value);
    return parsed.value;
  }

  acknowledgeAudioHandoff(context: MobileSessionContext, handoffId: string, epoch: number): CrossDeviceAudioHandoffV2 {
    const value = this.audioLeases.get(context.credential.workspaceId);
    if (!value || value.handoffId !== handoffId || value.epoch !== epoch || value.targetCaptureDeviceId !== context.credential.deviceId) throw new Error('AUDIO_HANDOFF_ACK_BINDING_INVALID');
    const next = { ...value, status: 'active' as const, acknowledgedAt: new Date().toISOString() };
    this.audioLeases.set(value.workspaceId, next);
    return next;
  }

  releaseAudioHandoff(context: MobileSessionContext, handoffId: string, epoch: number): CrossDeviceAudioHandoffV2 {
    const value = this.audioLeases.get(context.credential.workspaceId);
    if (!value || value.handoffId !== handoffId || value.epoch !== epoch) throw new Error('AUDIO_HANDOFF_RELEASE_BINDING_INVALID');
    this.assertLineage(context, value);
    const next = { ...value, status: 'released' as const };
    this.audioLeases.set(value.workspaceId, next);
    return next;
  }

  updatePcStatus(context: MobileSessionContext, status: CrossDevicePcStatusV2): CrossDevicePcStatusV2 {
    const parsed = parseCrossDevicePcStatusV2(status);
    if (parsed.success === false) throw new Error(parsed.errorCode);
    this.assertLineage(context, parsed.value);
    const observed = Date.parse(parsed.value.observedAt);
    if (observed < Date.now() - STATUS_FRESHNESS_MS || observed > Date.now() + 5_000) throw new Error('PC_STATUS_STALE');
    boundedSet(this.pcStatuses, parsed.value.targetDeviceId, parsed.value);
    return parsed.value;
  }

  getPcStatus(context: MobileSessionContext): CrossDevicePcStatusV2 {
    this.cleanup();
    const value = this.pcStatuses.get(context.credential.deviceId);
    if (!value || Date.parse(value.expiresAt) <= Date.now()) throw new Error('PC_STATUS_UNAVAILABLE');
    this.assertLineage(context, value);
    return value;
  }

  setQuietHours(value: CrossDeviceQuietHoursV2, ownerSessionBindingId: string): CrossDeviceQuietHoursV2 {
    const parsed = parseCrossDeviceQuietHoursV2(value);
    if (parsed.success === false) throw new Error(parsed.errorCode);
    if (parsed.value.ownerSessionBindingId !== ownerSessionBindingId) throw new Error('CROSS_DEVICE_QUIET_HOURS_OWNER_MISMATCH');
    try { new Intl.DateTimeFormat('en-US', { timeZone: parsed.value.timezone }).format(); } catch { throw new Error('CROSS_DEVICE_QUIET_HOURS_TIMEZONE_INVALID'); }
    const prior = this.quietHours.get(parsed.value.workspaceId);
    if (prior && parsed.value.revision <= prior.revision) throw new Error('CROSS_DEVICE_QUIET_HOURS_REVISION_CONFLICT');
    this.quietHours.set(parsed.value.workspaceId, parsed.value);
    return parsed.value;
  }

  getQuietHours(workspaceId: string): CrossDeviceQuietHoursV2 | undefined { return this.quietHours.get(workspaceId); }

  status(): Record<string, unknown> {
    this.cleanup();
    return { persistence: 'memory_only', restartSemantics: 'pending_payloads_and_active_leases_are_discarded', transferIntents: this.transfers.size, clipboardItems: this.clipboards.size, liveViews: this.liveViews.size, offlineQueueItems: this.queue.size, handoffs: this.handoffs.size, resultCards: this.resultCards.size, audioLeases: this.audioLeases.size };
  }

  private lineage(context: MobileSessionContext, sourceDeviceId: string, targetDeviceId: string) {
    return { contractVersion: TASK_CONTRACT_VERSION, amendment: EDITH_CONTRACT_AMENDMENT, ownerSessionBindingId: context.device.ownerBinding.ownerSessionId, workspaceId: context.credential.workspaceId, sessionId: context.credential.sessionId, sourceDeviceId, targetDeviceId };
  }

  private assertLineage(context: MobileSessionContext, value: { ownerSessionBindingId: string; workspaceId: string; sessionId: string; sourceDeviceId: string; targetDeviceId: string }): void {
    if (value.ownerSessionBindingId !== context.device.ownerBinding.ownerSessionId || value.workspaceId !== context.credential.workspaceId || value.sessionId !== context.credential.sessionId || ![value.sourceDeviceId, value.targetDeviceId].includes(context.credential.deviceId)) throw new Error('CROSS_DEVICE_LINEAGE_MISMATCH');
  }

  private assertCommandLineage(context: MobileSessionContext, command: MobileRemoteCommandV2): void {
    if (command.deviceId !== context.credential.deviceId || command.workspaceId !== context.credential.workspaceId || command.sessionId !== context.credential.sessionId || Date.parse(command.expiresAt) <= Date.now()) throw new Error('MOBILE_REMOTE_COMMAND_BINDING_INVALID');
  }

  private encryptMemory(plaintext: string): EncryptedMemoryValue {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.memoryKey, nonce);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return { nonce, ciphertext, tag: cipher.getAuthTag() };
  }

  private decryptMemory(value: EncryptedMemoryValue): string {
    const decipher = createDecipheriv('aes-256-gcm', this.memoryKey, value.nonce);
    decipher.setAuthTag(value.tag);
    return Buffer.concat([decipher.update(value.ciphertext), decipher.final()]).toString('utf8');
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [id, value] of this.clipboards) if (Date.parse(value.metadata.expiresAt) <= now) this.clipboards.delete(id);
    for (const [id, value] of this.liveViews) if (Date.parse(value.expiresAt) <= now && !['stopped', 'expired'].includes(value.status)) this.liveViews.set(id, { ...value, status: 'expired' });
    for (const [id, value] of this.handoffs) if (Date.parse(value.expiresAt) <= now && value.status === 'requested') this.handoffs.set(id, { ...value, status: 'expired' });
    for (const [id, record] of this.queue) if (Date.parse(record.view.expiresAt) <= now && ['pending', 'dispatching'].includes(record.view.status)) record.view = { ...record.view, status: 'expired', errorCode: 'OFFLINE_QUEUE_EXPIRED' };
    for (const [workspaceId, value] of this.audioLeases) if (Date.parse(value.expiresAt) <= now && !['released', 'expired', 'rejected'].includes(value.status)) this.audioLeases.set(workspaceId, { ...value, status: 'expired' });
    for (const [id, value] of this.resultCards) if (value.expiresAt && Date.parse(value.expiresAt) <= now) this.resultCards.delete(id);
    for (const [id, value] of this.pcStatuses) if (Date.parse(value.expiresAt) <= now) this.pcStatuses.delete(id);
  }
}
