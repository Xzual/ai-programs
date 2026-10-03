import {
  adaptSharedResultCardToLegacyV2,
  parseSharedResultCardV2,
  type CrossDeviceLineageV2,
  type CrossDeviceLiveViewFrameMetadataV2,
  type CrossDeviceLiveViewSessionV2,
  type CrossDevicePcStatusV2,
  type ResultCardV2,
  type SharedResultCardV2,
} from './contracts';
import { invokeDesktopCommand, isTauriShell } from './desktopShell';
import { ownerMutationFetch, primeOwnerSession } from './ownerMutationClient';

export type CrossDeviceCapabilityState = 'available' | 'configuration_required' | 'unsupported' | 'unverified';

export interface CrossDeviceNativeStatus {
  runtime: string;
  liveView: string;
  nativeCaptureAdapter: string;
  pcStatus: string;
  pcToMobileTransfer: string;
  mobileToPcInbox: string;
  wakeOnLan: string;
  audioHandoff: string;
  controlPlaneConnected: boolean;
  continuousAutoStream: false;
  remoteControl: false;
  maxFramesPerSecond: number;
  safeMessage: string;
}

export interface CrossDeviceDeviceSummary {
  deviceId: string;
  displayName: string;
  platform: string;
  trustStatus: string;
  workspaceId?: string;
  ownerSessionBindingId?: string;
  ownerBindingExpiresAt?: string;
}

export interface CrossDeviceBridgeSnapshot {
  checkedAt: string;
  tauriAvailable: boolean;
  backendAvailable: boolean;
  ownerAuthorized: boolean;
  killSwitchActive: boolean | null;
  native: CrossDeviceNativeStatus | null;
  devices: CrossDeviceDeviceSummary[];
  counts: {
    liveViews: number;
    transferIntents: number;
    resultCards: number;
    audioLeases: number;
  };
  producer: {
    configured: boolean;
    activeSessions: number;
    retainedFrameMetadata: number;
    localSessionActive: boolean;
  };
  capabilities: {
    liveView: CrossDeviceCapabilityState;
    pcStatus: CrossDeviceCapabilityState;
    pcToMobileTransfer: CrossDeviceCapabilityState;
    mobileToPcInbox: CrossDeviceCapabilityState;
    wakeOnLan: CrossDeviceCapabilityState;
    audioHandoff: CrossDeviceCapabilityState;
    resultCards: CrossDeviceCapabilityState;
    retentionCleanup: CrossDeviceCapabilityState;
  };
  safeMessage: string;
}

export interface CrossDeviceFrame {
  metadata: CrossDeviceLiveViewFrameMetadataV2;
  transport: {
    mimeType: string;
    bytesBase64: string;
    sizeBytes: number;
    sha256: string;
    monitorId?: string;
    dpiScale?: number;
  };
}

export interface TransferChunk {
  chunkIndex: number;
  offsetBytes: number;
  bytesRead: number;
  bytesBase64: string;
  chunkSha256: string;
  sourceSha256: string;
  nextOffsetBytes: number;
  complete: boolean;
}

type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T | undefined>;
type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface CrossDeviceBridgeDependencies {
  invoke?: Invoke;
  fetcher?: Fetcher;
  ownerFetch?: Fetcher;
  tauriAvailable?: () => boolean;
  now?: () => number;
  ownerSession?: () => Promise<{ csrfToken: string } | null>;
}

export interface DesktopProducerSession {
  ownerSessionBindingId: string;
  workspaceId: string;
  sessionId: string;
  sourceDeviceId: string;
  targetDeviceId: string;
  expiresAt: string;
}

export interface ResultCardSourceReference {
  cardId: string;
  source: { type: 'task' | 'research' | 'knowledge' | 'transfer' | 'screenshot' | 'error'; id: string };
}

interface LocalProducerSession {
  session: DesktopProducerSession;
}

interface NativeProducerIngestResult {
  status: number;
  body: Record<string, unknown>;
}

export class CrossDeviceBridgeError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'CrossDeviceBridgeError';
  }
}

const EMPTY_COUNTS = { liveViews: 0, transferIntents: 0, resultCards: 0, audioLeases: 0 };
const MIN_FRAME_INTERVAL_MS = 500;
const SAFE_REFERENCE_ID = /^[A-Za-z0-9._-]{1,256}$/;
const PRODUCER_KINDS = {
  '/api/edith/mobile/desktop-producer/pc-status': 'pc_status',
  '/api/edith/mobile/desktop-producer/live-view/frame-metadata': 'live_view_frame_metadata',
  '/api/edith/mobile/desktop-producer/wake-result': 'wake_result',
  '/api/edith/mobile/desktop-producer/transfer': 'transfer',
  '/api/edith/mobile/desktop-producer/audio-handoff': 'audio_handoff',
  '/api/edith/mobile/desktop-producer/retention-receipt': 'retention_receipt',
  '/api/edith/mobile/desktop-producer/observation': 'observation',
  '/api/edith/mobile/desktop-producer/error-receipt': 'error_receipt',
} as const;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function safeErrorCode(value: unknown, fallback = 'CROSS_DEVICE_REQUEST_FAILED'): string {
  const raw = value instanceof Error ? value.message : String(value ?? '');
  const match = raw.match(/[A-Z][A-Z0-9_]{2,80}/);
  return match?.[0] ?? fallback;
}

async function jsonBody(response: Response): Promise<Record<string, unknown>> {
  return asRecord(await response.json().catch(() => ({})));
}

function capability(native: CrossDeviceNativeStatus | null, key: keyof CrossDeviceNativeStatus): CrossDeviceCapabilityState {
  if (!native) return 'unverified';
  const value = String(native[key]);
  if (value === 'available' || value === 'runtime_verified') return 'available';
  if (value === 'unsupported' || native.runtime === 'unsupported') return 'unsupported';
  return 'configuration_required';
}

function decodeBase64Length(value: string): number {
  const normalized = value.replace(/\s/g, '');
  if (!normalized || normalized.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) return -1;
  const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0;
  return normalized.length / 4 * 3 - padding;
}

export function verifyTransferChunk(chunk: TransferChunk, expectedSourceSha256: string): boolean {
  return Number.isInteger(chunk.chunkIndex)
    && chunk.chunkIndex >= 0
    && Number.isInteger(chunk.offsetBytes)
    && chunk.offsetBytes >= 0
    && chunk.bytesRead > 0
    && chunk.bytesRead <= 256 * 1024
    && decodeBase64Length(chunk.bytesBase64) === chunk.bytesRead
    && /^[a-f0-9]{64}$/i.test(chunk.chunkSha256)
    && chunk.sourceSha256.toLowerCase() === expectedSourceSha256.toLowerCase()
    && chunk.nextOffsetBytes === chunk.offsetBytes + chunk.bytesRead;
}

export function pcTelemetryState(status: CrossDevicePcStatusV2 | null, now = Date.now()): 'fresh' | 'stale' | 'unavailable' {
  if (!status) return 'unavailable';
  return Date.parse(status.expiresAt) > now && Date.parse(status.observedAt) <= now + 5_000 ? 'fresh' : 'stale';
}

export class CrossDeviceDesktopBridge {
  private readonly invoke: Invoke;
  private readonly fetcher: Fetcher;
  private readonly ownerFetch: Fetcher;
  private readonly tauriAvailable: () => boolean;
  private readonly now: () => number;
  private readonly ownerSession: () => Promise<{ csrfToken: string } | null>;
  private snapshot: CrossDeviceBridgeSnapshot | null = null;
  private liveView: CrossDeviceLiveViewSessionV2 | null = null;
  private lastFrameAt = 0;
  private producerSession: LocalProducerSession | null = null;
  private liveViewEvidenceAccepted = false;

  constructor(dependencies: CrossDeviceBridgeDependencies = {}) {
    this.invoke = dependencies.invoke ?? invokeDesktopCommand;
    this.fetcher = dependencies.fetcher ?? ((input, init) => fetch(input, init));
    this.ownerFetch = dependencies.ownerFetch ?? ownerMutationFetch;
    this.tauriAvailable = dependencies.tauriAvailable ?? isTauriShell;
    this.now = dependencies.now ?? Date.now;
    this.ownerSession = dependencies.ownerSession ?? primeOwnerSession;
  }

  get activeLiveView(): CrossDeviceLiveViewSessionV2 | null {
    return this.liveView;
  }

  get producerSessionActive(): boolean {
    return Boolean(this.producerSession && Date.parse(this.producerSession.session.expiresAt) > this.now());
  }

  get liveViewVerifiedByBackend(): boolean {
    return this.liveViewEvidenceAccepted;
  }

  async refresh(): Promise<CrossDeviceBridgeSnapshot> {
    const tauriAvailable = this.tauriAvailable();
    let native: CrossDeviceNativeStatus | null = null;
    let backendAvailable = false;
    let ownerAuthorized = false;
    let killSwitchActive: boolean | null = null;
    let devices: CrossDeviceDeviceSummary[] = [];
    let counts = { ...EMPTY_COUNTS };
    let producer = { configured: false, activeSessions: 0, retainedFrameMetadata: 0, localSessionActive: this.producerSessionActive };

    if (tauriAvailable) {
      try {
        native = await this.invoke<CrossDeviceNativeStatus>('cross_device_native_status') ?? null;
      } catch {
        native = null;
      }
    }

    const [controlResult, devicesResult, killResult, producerResult] = await Promise.allSettled([
      this.fetcher('/api/edith/mobile/cross-device/status', { credentials: 'include' }),
      this.fetcher('/api/edith/mobile/devices', { credentials: 'include' }),
      this.fetcher('/api/edith/kill-switch', { credentials: 'include' }),
      this.fetcher('/api/edith/mobile/desktop-producer/status', { credentials: 'include' }),
    ]);

    if (controlResult.status === 'fulfilled') {
      backendAvailable = controlResult.value.status < 500;
      ownerAuthorized = controlResult.value.ok;
      if (controlResult.value.ok) {
        const payload = await jsonBody(controlResult.value);
        const data = asRecord(payload.data);
        counts = {
          liveViews: numberOrZero(data.liveViews),
          transferIntents: numberOrZero(data.transferIntents),
          resultCards: numberOrZero(data.resultCards),
          audioLeases: numberOrZero(data.audioLeases),
        };
      }
    }
    if (devicesResult.status === 'fulfilled' && devicesResult.value.ok) {
      const payload = await jsonBody(devicesResult.value);
      const list = asRecord(payload.data).devices;
      devices = Array.isArray(list) ? list.map((entry) => {
        const row = asRecord(entry);
        const device = asRecord(row.device);
        const trust = asRecord(row.trust);
        const ownerBinding = asRecord(row.ownerBinding);
        return {
          deviceId: String(device.deviceId ?? ''),
          displayName: String(device.displayName ?? 'Unnamed device'),
          platform: String(device.platform ?? 'unknown'),
          trustStatus: String(trust.status ?? 'unknown'),
          workspaceId: typeof ownerBinding.workspaceId === 'string' ? ownerBinding.workspaceId : undefined,
          ownerSessionBindingId: typeof ownerBinding.ownerSessionId === 'string' ? ownerBinding.ownerSessionId : undefined,
          ownerBindingExpiresAt: typeof ownerBinding.expiresAt === 'string' ? ownerBinding.expiresAt : undefined,
        };
      }).filter((device) => Boolean(device.deviceId)) : [];
    }
    if (killResult.status === 'fulfilled' && killResult.value.ok) {
      const payload = await jsonBody(killResult.value);
      killSwitchActive = Boolean(asRecord(payload.state).active);
    }

    if (producerResult.status === 'fulfilled' && producerResult.value.ok) {
      const payload = await jsonBody(producerResult.value);
      const data = asRecord(payload.data);
      producer = {
        configured: data.configured === true,
        activeSessions: numberOrZero(data.activeSessions),
        retainedFrameMetadata: numberOrZero(data.retainedFrameMetadata),
        localSessionActive: this.producerSessionActive,
      };
    }

    if (this.producerSession && Date.parse(this.producerSession.session.expiresAt) <= this.now()) this.clearProducerSession();

    if (tauriAvailable && backendAvailable && ownerAuthorized && producer.configured && killSwitchActive === false
      && !native?.controlPlaneConnected && devices.length > 0) {
      try {
        await this.bootstrapNativeProducer(devices[0].deviceId);
        native = await this.invoke<CrossDeviceNativeStatus>('cross_device_native_status') ?? native;
        producer.localSessionActive = this.producerSessionActive;
      } catch {
        // Status remains configuration_required until an authenticated native bootstrap succeeds.
      }
    }

    const controlPlaneReady = Boolean(native?.controlPlaneConnected && backendAvailable && ownerAuthorized);
    const nativeCapability = (key: keyof CrossDeviceNativeStatus): CrossDeviceCapabilityState => {
      const state = capability(native, key);
      return controlPlaneReady && state === 'available' ? 'available' : state === 'unsupported' ? 'unsupported' : 'configuration_required';
    };
    this.snapshot = {
      checkedAt: new Date(this.now()).toISOString(),
      tauriAvailable,
      backendAvailable,
      ownerAuthorized,
      killSwitchActive,
      native,
      devices,
      counts,
      producer,
      capabilities: {
        liveView: producer.configured ? nativeCapability('liveView') : 'configuration_required',
        pcStatus: producer.configured && controlPlaneReady && capability(native, 'pcStatus') === 'available' ? 'available' : 'configuration_required',
        pcToMobileTransfer: nativeCapability('pcToMobileTransfer'),
        mobileToPcInbox: nativeCapability('mobileToPcInbox'),
        wakeOnLan: nativeCapability('wakeOnLan'),
        audioHandoff: nativeCapability('audioHandoff'),
        resultCards: backendAvailable && ownerAuthorized ? 'available' : 'configuration_required',
        retentionCleanup: 'configuration_required',
      },
      safeMessage: killSwitchActive
        ? 'Emergency Stop is active. Cross-device operations are blocked and active leases are cleared.'
        : native?.safeMessage ?? (tauriAvailable ? 'Native cross-device capability status is unavailable.' : 'Desktop bridge requires the E.D.I.T.H. Tauri shell.'),
    };
    if (killSwitchActive) await this.emergencyStop('KILL_SWITCH_ACTIVE');
    return this.snapshot;
  }

  private async assertOperational(required: keyof CrossDeviceBridgeSnapshot['capabilities']): Promise<CrossDeviceBridgeSnapshot> {
    const snapshot = await this.refresh();
    if (snapshot.killSwitchActive) throw new CrossDeviceBridgeError('KILL_SWITCH_ACTIVE', 'Emergency Stop is active.');
    if (snapshot.killSwitchActive === null) throw new CrossDeviceBridgeError('KILL_SWITCH_STATUS_UNAVAILABLE', 'Emergency Stop state could not be verified.');
    if (!snapshot.tauriAvailable) throw new CrossDeviceBridgeError('TAURI_INVOKE_UNAVAILABLE', 'The native desktop bridge is unavailable.');
    if (!snapshot.ownerAuthorized) throw new CrossDeviceBridgeError('OWNER_SESSION_REQUIRED', 'An active owner session is required.');
    if (snapshot.capabilities[required] !== 'available') throw new CrossDeviceBridgeError('CONFIGURATION_REQUIRED', `${required} is not connected end to end.`);
    return snapshot;
  }

  async openProducerSession(deviceId: string): Promise<DesktopProducerSession> {
    const snapshot = await this.refresh();
    if (snapshot.killSwitchActive) throw new CrossDeviceBridgeError('KILL_SWITCH_ACTIVE', 'Emergency Stop is active.');
    if (snapshot.killSwitchActive === null) throw new CrossDeviceBridgeError('KILL_SWITCH_STATUS_UNAVAILABLE', 'Emergency Stop state could not be verified.');
    if (!snapshot.tauriAvailable || !snapshot.producer.configured) {
      throw new CrossDeviceBridgeError('DESKTOP_PRODUCER_CONFIGURATION_REQUIRED', 'Trusted native producer wiring is unavailable.');
    }
    if (!snapshot.ownerAuthorized) throw new CrossDeviceBridgeError('OWNER_SESSION_REQUIRED', 'An active owner session is required.');
    return this.bootstrapNativeProducer(deviceId);
  }

  private async bootstrapNativeProducer(deviceId: string): Promise<DesktopProducerSession> {
    const ownerSession = await this.ownerSession();
    if (!ownerSession?.csrfToken) throw new CrossDeviceBridgeError('OWNER_SESSION_REQUIRED', 'An active owner session is required.');
    const result = await this.invoke<NativeProducerIngestResult>('cross_device_producer_ingest', {
      request: { operation: 'bootstrap', deviceId, csrfToken: ownerSession.csrfToken },
    });
    const session = asRecord(asRecord(result?.body).data).session as DesktopProducerSession | undefined;
    if (!result || ![200, 201].includes(result.status) || asRecord(result.body).success !== true
      || !session?.ownerSessionBindingId || session.targetDeviceId !== deviceId || Date.parse(session.expiresAt) <= this.now()) {
      throw new CrossDeviceBridgeError('DESKTOP_PRODUCER_SESSION_INVALID', 'Desktop producer session response was invalid.');
    }
    this.producerSession = { session };
    return session;
  }

  private clearProducerSession(): void {
    this.producerSession = null;
    this.liveViewEvidenceAccepted = false;
  }

  private producerLineage(): CrossDeviceLineageV2 {
    const session = this.producerSession?.session;
    if (!session) throw new CrossDeviceBridgeError('DESKTOP_PRODUCER_SESSION_INVALID', 'Desktop producer session is missing.');
    return {
      contractVersion: 2,
      amendment: '2.1',
      ownerSessionBindingId: session.ownerSessionBindingId,
      workspaceId: session.workspaceId,
      sessionId: session.sessionId,
      sourceDeviceId: session.sourceDeviceId,
      targetDeviceId: session.targetDeviceId,
    };
  }

  private async ingestNativeEvidence(endpoint: string, payload: unknown): Promise<Record<string, unknown>> {
    const kind = PRODUCER_KINDS[endpoint as keyof typeof PRODUCER_KINDS];
    if (!kind) throw new CrossDeviceBridgeError('DESKTOP_PRODUCER_ENDPOINT_INVALID', 'Producer endpoint is not allowed.');
    const producer = this.producerSession;
    if (!producer || Date.parse(producer.session.expiresAt) <= this.now()) {
      this.clearProducerSession();
      throw new CrossDeviceBridgeError('DESKTOP_PRODUCER_SESSION_INVALID', 'Desktop producer session is missing or expired.');
    }
    try {
      const result = await this.invoke<NativeProducerIngestResult>('cross_device_producer_ingest', {
        request: { operation: 'ingest', kind, payload },
      });
      if (!result || result.status !== 202 || asRecord(result.body).success !== true) {
        this.clearProducerSession();
        throw new CrossDeviceBridgeError(safeErrorCode(asRecord(result?.body).errorCode, 'DESKTOP_PRODUCER_INGEST_REJECTED'), 'Trusted desktop evidence was not accepted.');
      }
      return asRecord(result.body).data ? asRecord(asRecord(result.body).data) : {};
    } catch (error) {
      this.clearProducerSession();
      throw error instanceof CrossDeviceBridgeError
        ? error
        : new CrossDeviceBridgeError(safeErrorCode(error, 'DESKTOP_PRODUCER_CONFIGURATION_REQUIRED'), 'Trusted native producer ingest is unavailable.');
    }
  }

  async startLiveView(deviceId: string): Promise<CrossDeviceLiveViewSessionV2> {
    await this.assertOperational('liveView');
    await this.openProducerSession(deviceId);
    const requestedResponse = await this.ownerFetch(`/api/edith/mobile/cross-device/live-view/${encodeURIComponent(deviceId)}/request`, { method: 'POST' });
    const requestedPayload = await jsonBody(requestedResponse);
    if (!requestedResponse.ok) {
      this.clearProducerSession();
      throw new CrossDeviceBridgeError(safeErrorCode(requestedPayload.errorCode), 'Live View request was rejected.');
    }
    const requested = asRecord(asRecord(requestedPayload.data).liveView) as unknown as CrossDeviceLiveViewSessionV2;
    if (!requested.liveViewId || Date.parse(requested.expiresAt) <= this.now()) {
      this.clearProducerSession();
      throw new CrossDeviceBridgeError('LIVE_VIEW_EXPIRED', 'Live View approval expired.');
    }
    const approvedResponse = await this.ownerFetch(`/api/edith/mobile/cross-device/live-view/${encodeURIComponent(requested.liveViewId)}/approve`, { method: 'POST' });
    const approvedPayload = await jsonBody(approvedResponse);
    if (!approvedResponse.ok) {
      this.clearProducerSession();
      throw new CrossDeviceBridgeError(safeErrorCode(approvedPayload.errorCode), 'Live View approval was rejected.');
    }
    const approved = asRecord(asRecord(approvedPayload.data).liveView) as unknown as CrossDeviceLiveViewSessionV2;
    if (approved.status === 'configuration_required') {
      this.clearProducerSession();
      return approved;
    }
    if (!approved.ownerApproved) {
      this.clearProducerSession();
      throw new CrossDeviceBridgeError('LIVE_VIEW_OWNER_APPROVAL_REQUIRED', 'Owner approval is required.');
    }
    const producerLineage = this.producerLineage();
    if (approved.ownerSessionBindingId !== producerLineage.ownerSessionBindingId
      || approved.workspaceId !== producerLineage.workspaceId
      || approved.sessionId !== producerLineage.sessionId
      || approved.sourceDeviceId !== producerLineage.targetDeviceId
      || approved.targetDeviceId !== producerLineage.sourceDeviceId) {
      this.clearProducerSession();
      await this.stopBackendLiveView(approved.liveViewId);
      throw new CrossDeviceBridgeError('DESKTOP_PRODUCER_LINEAGE_MISMATCH', 'Live View and producer lineage did not match.');
    }
    try {
      const nativeSession = await this.invoke<CrossDeviceLiveViewSessionV2>('cross_device_live_view_start', {
        request: {
          lineage: {
            contractVersion: approved.contractVersion,
            amendment: approved.amendment,
            ownerSessionBindingId: approved.ownerSessionBindingId,
            workspaceId: approved.workspaceId,
            sessionId: approved.sessionId,
            sourceDeviceId: approved.sourceDeviceId,
            targetDeviceId: approved.targetDeviceId,
          },
          liveViewId: approved.liveViewId,
          expiresAt: approved.expiresAt,
          maxFramesPerSecond: Math.min(2, approved.framePolicy.maxFramesPerSecond),
          maxWidth: approved.framePolicy.maxWidth,
          maxHeight: approved.framePolicy.maxHeight,
        },
      });
      if (!nativeSession) throw new CrossDeviceBridgeError('TAURI_INVOKE_UNAVAILABLE', 'The native Live View adapter did not respond.');
      this.liveView = nativeSession;
      this.lastFrameAt = 0;
      this.liveViewEvidenceAccepted = false;
      return nativeSession;
    } catch (error) {
      this.clearProducerSession();
      await this.stopBackendLiveView(approved.liveViewId);
      throw error instanceof CrossDeviceBridgeError ? error : new CrossDeviceBridgeError(safeErrorCode(error), 'Native Live View start was denied.');
    }
  }

  async pullLiveViewFrame(): Promise<CrossDeviceFrame> {
    const liveView = this.liveView;
    if (!liveView) throw new CrossDeviceBridgeError('LIVE_VIEW_NOT_ACTIVE', 'Live View is not active.');
    if (Date.parse(liveView.expiresAt) <= this.now()) {
      await this.stopLiveView();
      throw new CrossDeviceBridgeError('LIVE_VIEW_EXPIRED', 'Live View expired.');
    }
    const elapsed = this.now() - this.lastFrameAt;
    if (this.lastFrameAt && elapsed < MIN_FRAME_INTERVAL_MS) throw new CrossDeviceBridgeError('LIVE_VIEW_FRAME_RATE_LIMITED', 'Frame pull is limited to 2 FPS.');
    await this.assertOperational('liveView');
    try {
      const frame = await this.invoke<CrossDeviceFrame>('cross_device_live_view_frame', {
        ownerSessionBindingId: liveView.ownerSessionBindingId,
        liveViewId: liveView.liveViewId,
      });
      if (!frame || frame.metadata.liveViewId !== liveView.liveViewId || frame.metadata.ownerSessionBindingId !== liveView.ownerSessionBindingId) {
        throw new CrossDeviceBridgeError('LIVE_VIEW_FRAME_BINDING_INVALID', 'Frame lineage did not match the active lease.');
      }
      if (decodeBase64Length(frame.transport.bytesBase64) !== frame.transport.sizeBytes || !/^image\/(png|jpeg)$/.test(frame.transport.mimeType)) {
        throw new CrossDeviceBridgeError('LIVE_VIEW_FRAME_INTEGRITY_INVALID', 'Frame transport failed integrity checks.');
      }
      const authenticatedMetadata = { ...frame.metadata, ...this.producerLineage() };
      await this.ingestNativeEvidence('/api/edith/mobile/desktop-producer/live-view/frame-metadata', authenticatedMetadata);
      this.liveViewEvidenceAccepted = true;
      this.lastFrameAt = this.now();
      const postCheck = await this.refresh();
      if (postCheck.killSwitchActive) throw new CrossDeviceBridgeError('KILL_SWITCH_ACTIVE', 'Emergency Stop interrupted Live View.');
      return { ...frame, metadata: authenticatedMetadata };
    } catch (error) {
      if (error instanceof CrossDeviceBridgeError && error.code === 'LIVE_VIEW_FRAME_RATE_LIMITED') throw error;
      await this.stopLiveView();
      throw error instanceof CrossDeviceBridgeError ? error : new CrossDeviceBridgeError(safeErrorCode(error), 'Live View frame could not be read.');
    }
  }

  async stopLiveView(): Promise<void> {
    const liveView = this.liveView;
    this.liveView = null;
    this.lastFrameAt = 0;
    this.liveViewEvidenceAccepted = false;
    this.clearProducerSession();
    if (!liveView) return;
    await Promise.allSettled([
      this.invoke('cross_device_live_view_stop', { ownerSessionBindingId: liveView.ownerSessionBindingId, liveViewId: liveView.liveViewId }),
      this.stopBackendLiveView(liveView.liveViewId),
    ]);
  }

  private async stopBackendLiveView(liveViewId: string): Promise<void> {
    await this.ownerFetch(`/api/edith/mobile/cross-device/live-view/${encodeURIComponent(liveViewId)}/stop`, { method: 'POST' }).catch(() => undefined);
  }

  async requestWake(deviceId: string): Promise<{ status: string; attempted: false; errorCode: string }> {
    const snapshot = await this.refresh();
    if (snapshot.killSwitchActive) throw new CrossDeviceBridgeError('KILL_SWITCH_ACTIVE', 'Emergency Stop is active.');
    if (snapshot.killSwitchActive === null) throw new CrossDeviceBridgeError('KILL_SWITCH_STATUS_UNAVAILABLE', 'Emergency Stop state could not be verified.');
    const response = await this.ownerFetch(`/api/edith/mobile/cross-device/wake/${encodeURIComponent(deviceId)}`, { method: 'POST' });
    const payload = await jsonBody(response);
    return { status: 'configuration_required', attempted: false, errorCode: safeErrorCode(payload.errorCode, 'WAKE_ON_LAN_CONFIGURATION_REQUIRED') };
  }

  async samplePcStatus(lineage: CrossDeviceLineageV2): Promise<{ status: CrossDevicePcStatusV2; publication: 'accepted' }> {
    await this.assertOperational('pcStatus');
    if (!this.producerSessionActive) await this.openProducerSession(lineage.targetDeviceId);
    const authenticatedLineage = this.producerLineage();
    const status = await this.invoke<CrossDevicePcStatusV2>('cross_device_pc_status', { lineage: authenticatedLineage });
    if (!status || pcTelemetryState(status, this.now()) !== 'fresh') throw new CrossDeviceBridgeError('PC_STATUS_STALE', 'PC telemetry is stale or unavailable.');
    await this.ingestNativeEvidence('/api/edith/mobile/desktop-producer/pc-status', status);
    return { status, publication: 'accepted' };
  }

  async readSourceChunk(request: { ownerSessionBindingId: string; sourceHandle: string; chunkIndex: number; offsetBytes: number; maximumBytes: number; expectedSourceSha256: string }): Promise<TransferChunk> {
    await this.assertOperational('pcToMobileTransfer');
    const chunk = await this.invoke<TransferChunk>('cross_device_read_source_chunk', { request: {
      ownerSessionBindingId: request.ownerSessionBindingId,
      sourceHandle: request.sourceHandle,
      chunkIndex: request.chunkIndex,
      offsetBytes: request.offsetBytes,
      maximumBytes: Math.min(request.maximumBytes, 256 * 1024),
    } });
    if (!chunk || !verifyTransferChunk(chunk, request.expectedSourceSha256)) throw new CrossDeviceBridgeError('TRANSFER_CHUNK_INTEGRITY_FAILED', 'Transfer chunk failed integrity validation.');
    return chunk;
  }

  async cleanupRetention(ownerSessionBindingId: string): Promise<{ removedArtifacts: number; preservedActiveOrPending: number; retentionMilliseconds: number }> {
    await this.assertOperational('retentionCleanup');
    const result = await this.invoke<{ removedArtifacts: number; preservedActiveOrPending: number; retentionMilliseconds: number }>('cross_device_cleanup_inbox', { ownerSessionBindingId });
    if (!result || result.removedArtifacts < 0 || result.preservedActiveOrPending < 0 || result.retentionMilliseconds !== 86_400_000) {
      throw new CrossDeviceBridgeError('RETENTION_RESULT_INVALID', 'Retention cleanup returned an invalid result.');
    }
    return result;
  }

  async publishResultCard(deviceId: string, reference: ResultCardSourceReference): Promise<{ shared: SharedResultCardV2; legacy: ResultCardV2 }> {
    if (!SAFE_REFERENCE_ID.test(reference.cardId)
      || !SAFE_REFERENCE_ID.test(reference.source.id)
      || !['task', 'research', 'knowledge', 'transfer', 'screenshot', 'error'].includes(reference.source.type)) {
      throw new CrossDeviceBridgeError('RESULT_CARD_SOURCE_INVALID', 'Result card source reference is invalid.');
    }
    const snapshot = await this.refresh();
    if (snapshot.killSwitchActive) throw new CrossDeviceBridgeError('KILL_SWITCH_ACTIVE', 'Emergency Stop is active.');
    if (snapshot.killSwitchActive === null) throw new CrossDeviceBridgeError('KILL_SWITCH_STATUS_UNAVAILABLE', 'Emergency Stop state could not be verified.');
    if (!snapshot.ownerAuthorized) throw new CrossDeviceBridgeError('OWNER_SESSION_REQUIRED', 'An active owner session is required.');
    const response = await this.ownerFetch(`/api/edith/mobile/cross-device/result-cards/${encodeURIComponent(deviceId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reference),
    });
    const payload = await jsonBody(response);
    if (!response.ok) throw new CrossDeviceBridgeError(safeErrorCode(payload.errorCode), 'Result card publication was rejected.');
    const returned = asRecord(asRecord(payload.data).card);
    const checked = parseSharedResultCardV2(returned);
    if (checked.success === false) throw new CrossDeviceBridgeError(checked.errorCode, 'Published result card response was malformed.');
    return { shared: checked.value, legacy: adaptSharedResultCardToLegacyV2(checked.value) };
  }

  async emergencyStop(reasonCode = 'KILL_SWITCH_ACTIVE'): Promise<void> {
    const liveView = this.liveView;
    const binding = liveView?.ownerSessionBindingId
      ?? this.snapshot?.devices.find((device) => device.ownerSessionBindingId)?.ownerSessionBindingId;
    this.liveView = null;
    this.lastFrameAt = 0;
    this.clearProducerSession();
    await Promise.allSettled([
      binding && this.tauriAvailable()
        ? this.invoke('cross_device_revoke_owner', { ownerSessionBindingId: binding, reasonCode: reasonCode === 'OWNER_SESSION_EXPIRED' ? reasonCode : 'OWNER_SESSION_ROTATED' })
        : Promise.resolve(),
      liveView ? this.stopBackendLiveView(liveView.liveViewId) : Promise.resolve(),
    ]);
  }

  async revokeOwner(ownerSessionBindingId: string, reasonCode: 'LOGOUT' | 'OWNER_SESSION_EXPIRED' | 'OWNER_SESSION_ROTATED' = 'LOGOUT'): Promise<void> {
    this.liveView = null;
    this.lastFrameAt = 0;
    this.clearProducerSession();
    if (this.tauriAvailable()) await this.invoke('cross_device_revoke_owner', { ownerSessionBindingId, reasonCode }).catch(() => undefined);
  }

  async revokeCurrentOwner(reasonCode: 'LOGOUT' | 'OWNER_SESSION_EXPIRED' | 'OWNER_SESSION_ROTATED' = 'LOGOUT'): Promise<void> {
    const liveView = this.liveView;
    const binding = liveView?.ownerSessionBindingId
      ?? this.snapshot?.devices.find((device) => device.ownerSessionBindingId)?.ownerSessionBindingId;
    this.liveView = null;
    this.lastFrameAt = 0;
    this.clearProducerSession();
    await Promise.allSettled([
      binding ? this.revokeOwner(binding, reasonCode) : Promise.resolve(),
      liveView ? this.stopBackendLiveView(liveView.liveViewId) : Promise.resolve(),
    ]);
  }
}

export const crossDeviceDesktopBridge = new CrossDeviceDesktopBridge();
