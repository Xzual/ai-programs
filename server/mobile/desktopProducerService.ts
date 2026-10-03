import { createHash, randomBytes } from 'node:crypto';
import type {
  CrossDeviceLiveViewFrameMetadataV2,
  DesktopObservationV2,
} from '../../src/edith/contracts';
import type { ArtifactEvidenceV2, ErrorAttentionEvidenceV2 } from '../../src/edith/sharedResultCardProducer';
import type { MobileSessionContext } from './types';

const DEFAULT_TTL_MS = 15 * 60_000;
const MAX_RECORDS = 500;

export interface DesktopProducerSession {
  ownerSessionBindingId: string;
  workspaceId: string;
  sessionId: string;
  sourceDeviceId: string;
  targetDeviceId: string;
  expiresAt: string;
}

interface StoredSession extends DesktopProducerSession {
  tokenHash: string;
  sequence: number;
  nativeSelectionPublished: boolean;
  context?: MobileSessionContext;
  nativeSelectionOnly: boolean;
}

export interface RetentionReceipt {
  receiptId: string;
  transferId: string;
  opaqueHandle: string;
  status: 'cleaned' | 'retained' | 'not_found' | 'failed';
  observedAt: string;
  expiresAt?: string;
  checksumSha256?: string;
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function boundedSet<K, V>(map: Map<K, V>, key: K, value: V): void {
  map.set(key, value);
  while (map.size > MAX_RECORDS) map.delete(map.keys().next().value!);
}

export class DesktopProducerService {
  private readonly sessions = new Map<string, StoredSession>();
  private readonly frames = new Map<string, CrossDeviceLiveViewFrameMetadataV2>();
  private readonly receipts = new Map<string, { ownerSessionBindingId: string; receipt: RetentionReceipt }>();
  private readonly observations = new Map<string, { ownerSessionBindingId: string; observation: DesktopObservationV2; artifact: ArtifactEvidenceV2 }>();
  private readonly errors = new Map<string, { ownerSessionBindingId: string; evidence: ErrorAttentionEvidenceV2 }>();

  create(context: MobileSessionContext, serverId: string): { token: string; session: DesktopProducerSession } {
    this.cleanup();
    for (const [key, current] of this.sessions) {
      if (current.ownerSessionBindingId === context.device.ownerBinding.ownerSessionId
        && current.targetDeviceId === context.credential.deviceId) this.sessions.delete(key);
    }
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + this.ttlMs()).toISOString();
    const session: StoredSession = {
      tokenHash: hash(token),
      sequence: 0,
      nativeSelectionPublished: false,
      nativeSelectionOnly: false,
      context,
      ownerSessionBindingId: context.device.ownerBinding.ownerSessionId,
      workspaceId: context.credential.workspaceId,
      sessionId: context.credential.sessionId,
      sourceDeviceId: serverId,
      targetDeviceId: context.credential.deviceId,
      expiresAt,
    };
    boundedSet(this.sessions, session.tokenHash, session);
    return { token, session: this.publicSession(session) };
  }

  createNativeSelection(ownerSessionBindingId: string, serverId: string): { token: string; session: DesktopProducerSession } {
    this.cleanup();
    for (const [key, current] of this.sessions) {
      if (current.ownerSessionBindingId === ownerSessionBindingId && current.nativeSelectionOnly) this.sessions.delete(key);
    }
    const token = randomBytes(32).toString('base64url');
    const session: StoredSession = {
      tokenHash: hash(token),
      sequence: 0,
      nativeSelectionPublished: false,
      nativeSelectionOnly: true,
      ownerSessionBindingId,
      workspaceId: 'workspace-local-desktop',
      sessionId: `native-selection-${randomBytes(16).toString('hex')}`,
      sourceDeviceId: serverId,
      targetDeviceId: 'desktop-native',
      expiresAt: new Date(Date.now() + Math.min(this.ttlMs(), 5 * 60_000)).toISOString(),
    };
    boundedSet(this.sessions, session.tokenHash, session);
    return { token, session: this.publicSession(session) };
  }

  authorize(token: string | undefined, sequence: number): StoredSession {
    this.cleanup();
    if (!token) throw new Error('DESKTOP_PRODUCER_SESSION_REQUIRED');
    const session = this.sessions.get(hash(token));
    if (!session || Date.parse(session.expiresAt) <= Date.now()) throw new Error('DESKTOP_PRODUCER_SESSION_INVALID');
    if (session.nativeSelectionOnly) throw new Error('DESKTOP_PRODUCER_SESSION_INVALID');
    if (!Number.isSafeInteger(sequence) || sequence !== session.sequence + 1) throw new Error('DESKTOP_PRODUCER_SEQUENCE_INVALID');
    session.sequence = sequence;
    return session;
  }

  authorizeNativeSelection(token: string | undefined, sequence: number): StoredSession {
    this.cleanup();
    if (!token) throw new Error('DESKTOP_PRODUCER_SESSION_REQUIRED');
    const session = this.sessions.get(hash(token));
    if (!session || Date.parse(session.expiresAt) <= Date.now()) throw new Error('DESKTOP_PRODUCER_SESSION_INVALID');
    if (session.nativeSelectionOnly !== true) throw new Error('OBSIDIAN_NATIVE_SELECTION_SESSION_REQUIRED');
    if (sequence !== 1 || session.nativeSelectionPublished) throw new Error('OBSIDIAN_NATIVE_SELECTION_SEQUENCE_INVALID');
    session.nativeSelectionPublished = true;
    return session;
  }

  sessionContext(session: StoredSession): MobileSessionContext {
    if (!session.context || session.nativeSelectionOnly) throw new Error('DESKTOP_PRODUCER_SESSION_INVALID');
    return session.context;
  }

  isNativeSelectionOnly(session: StoredSession): boolean {
    return session.nativeSelectionOnly;
  }

  assertLineage(session: StoredSession, value: {
    ownerSessionBindingId: string; workspaceId: string; sessionId: string; sourceDeviceId: string; targetDeviceId: string;
  }): void {
    if (value.ownerSessionBindingId !== session.ownerSessionBindingId
      || value.workspaceId !== session.workspaceId
      || value.sessionId !== session.sessionId
      || value.sourceDeviceId !== session.sourceDeviceId
      || value.targetDeviceId !== session.targetDeviceId) {
      throw new Error('DESKTOP_PRODUCER_LINEAGE_MISMATCH');
    }
  }

  putFrame(frame: CrossDeviceLiveViewFrameMetadataV2): void { boundedSet(this.frames, frame.liveViewId, frame); }
  getFrame(liveViewId: string): CrossDeviceLiveViewFrameMetadataV2 | undefined { return this.frames.get(liveViewId); }
  putReceipt(ownerSessionBindingId: string, receipt: RetentionReceipt): void { boundedSet(this.receipts, receipt.receiptId, { ownerSessionBindingId, receipt }); }
  putObservation(ownerSessionBindingId: string, observation: DesktopObservationV2, artifact: ArtifactEvidenceV2): void { boundedSet(this.observations, observation.observationId, { ownerSessionBindingId, observation, artifact }); }
  getObservation(id: string, ownerSessionBindingId: string) {
    const value = this.observations.get(id);
    return value?.ownerSessionBindingId === ownerSessionBindingId ? value : undefined;
  }
  putError(ownerSessionBindingId: string, id: string, evidence: ErrorAttentionEvidenceV2): void { boundedSet(this.errors, id, { ownerSessionBindingId, evidence }); }
  getError(id: string, ownerSessionBindingId: string): ErrorAttentionEvidenceV2 | undefined {
    const value = this.errors.get(id);
    return value?.ownerSessionBindingId === ownerSessionBindingId ? value.evidence : undefined;
  }

  revokeOwner(bindingId: string): void {
    for (const [key, session] of this.sessions) if (session.ownerSessionBindingId === bindingId) this.sessions.delete(key);
    for (const [key, frame] of this.frames) if (frame.ownerSessionBindingId === bindingId) this.frames.delete(key);
    for (const [key, value] of this.receipts) if (value.ownerSessionBindingId === bindingId) this.receipts.delete(key);
    for (const [key, value] of this.observations) if (value.ownerSessionBindingId === bindingId) this.observations.delete(key);
    for (const [key, value] of this.errors) if (value.ownerSessionBindingId === bindingId) this.errors.delete(key);
  }

  revokeAll(): void {
    this.sessions.clear();
    this.frames.clear();
    this.receipts.clear();
    this.observations.clear();
    this.errors.clear();
  }

  status(bindingId: string) {
    this.cleanup();
    return {
      persistence: 'memory_only',
      configured: Boolean(process.env.EDITH_DESKTOP_BRIDGE_TOKEN),
      activeSessions: [...this.sessions.values()].filter((item) => item.ownerSessionBindingId === bindingId).length,
      retainedFrameMetadata: [...this.frames.values()].filter((item) => item.ownerSessionBindingId === bindingId).length,
    };
  }

  private ttlMs(): number {
    const value = Number(process.env.EDITH_DESKTOP_PRODUCER_SESSION_TTL_MS ?? DEFAULT_TTL_MS);
    return Number.isFinite(value) ? Math.min(Math.max(value, 60_000), 60 * 60_000) : DEFAULT_TTL_MS;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, value] of this.sessions) if (Date.parse(value.expiresAt) <= now) this.sessions.delete(key);
  }

  private publicSession(session: StoredSession): DesktopProducerSession {
    return {
      ownerSessionBindingId: session.ownerSessionBindingId,
      workspaceId: session.workspaceId,
      sessionId: session.sessionId,
      sourceDeviceId: session.sourceDeviceId,
      targetDeviceId: session.targetDeviceId,
      expiresAt: session.expiresAt,
    };
  }
}
