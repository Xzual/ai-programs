import {
  adaptSharedResultCardToLegacyV2,
  parseSharedResultCardV2,
  type FileTransferDescriptorV2,
  type CrossDeviceLineageV2,
  type CrossDeviceLiveViewFrameMetadataV2,
  type CrossDeviceLiveViewSessionV2,
  type CrossDevicePcStatusV2,
  type ResultCardV2,
  type SharedResultCardV2,
} from './contracts';
import { invokeDesktopCommand, isTauriShell } from './desktopShell';
import { ownerMutationFetch, primeOwnerSession } from './ownerMutationClient';
import { stopComputer } from './computerDesktopClient';
import { parseFileSendDescriptor } from './filesClient';

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
  frameRef: string;
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
  sourceHandle?: string;
  totalBytes?: number;
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
  stopComputer?: typeof stopComputer;
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
export interface FileSendTarget { readonly deviceId: string; readonly generation: number; readonly sessionId: string; readonly expiresAt: string }
export interface FileSendCheckpoint {
  schema: 'edith.native-mobile/1'; transferId: string; manifestDigest: string; checkpointId: string;
  completedChunkIndexes: number[]; acknowledgedBytes: number; nextChunkIndex: number; expiresAt: string;
  status: 'pending' | 'transferring' | 'completed' | 'cancelled' | 'failed';
  durableReceiverCommit: boolean;
}

export interface NativePublicRegionSelection {
  observationId:string; observationGeneration:number;
  publicRegion:[number,number,number,number]; exclusions:Array<[number,number,number,number]>;
  leaseGeneration:number;
}
export type NativeProducerIntent =
  | {operation:'pin_source';lineage:CrossDeviceLineageV2;sourceHandle:string;idempotencyKey:string;expiresAt:string}
  | {operation:'send_source_chunk';transferId:string;index:number;checkpointId:string}
  | {operation:'transfer_checkpoint'|'cancel_transfer';transferId:string}
  | {operation:'reapprove_source';transferId:string;checkpointId:string}
  | {operation:'register_receiver';transferId:string;manifestDigest:string;checkpointId:string}
  | {operation:'receive_chunk';transferId:string;index:number}
  | {operation:'commit_receiver';transferId:string};

export function validateNativeProducerIntent(value:unknown, now=Date.now()):asserts value is NativeProducerIntent {
  const request=asRecord(value);
  const keysets:Record<string,string[]>={pin_source:['operation','lineage','sourceHandle','idempotencyKey','expiresAt'],send_source_chunk:['operation','transferId','index','checkpointId'],transfer_checkpoint:['operation','transferId'],cancel_transfer:['operation','transferId'],reapprove_source:['operation','transferId','checkpointId'],register_receiver:['operation','transferId','manifestDigest','checkpointId'],receive_chunk:['operation','transferId','index'],commit_receiver:['operation','transferId']};
  const keys=keysets[String(request.operation)], id=(v:unknown)=>typeof v==='string'&&/^[A-Za-z0-9._:-]{1,160}$/.test(v);
  if(!keys||Object.keys(request).length!==keys.length||keys.some(k=>!Object.hasOwn(request,k))
    ||keys.filter(k=>['transferId','sourceHandle','idempotencyKey','checkpointId'].includes(k)).some(k=>!id(request[k]))
    ||(Object.hasOwn(request,'index')&&(!Number.isSafeInteger(request.index)||Number(request.index)<0||Number(request.index)>511))
    ||(Object.hasOwn(request,'manifestDigest')&&(typeof request.manifestDigest!=='string'||!/^[a-f0-9]{64}$/.test(request.manifestDigest))))
    throw new CrossDeviceBridgeError('NATIVE_PRODUCER_INTENT_INVALID','Invalid native intent fields.');
  if(request.operation==='pin_source') {
    const lineage=asRecord(request.lineage), fields=['contractVersion','amendment','ownerSessionBindingId','workspaceId','sessionId','sourceDeviceId','targetDeviceId'];
    if(Object.keys(lineage).length!==7||fields.some(k=>!Object.hasOwn(lineage,k))||lineage.contractVersion!==2||lineage.amendment!=='2.1'||fields.slice(2).some(k=>!id(lineage[k]))
      ||typeof request.expiresAt!=='string'||!Number.isFinite(Date.parse(request.expiresAt))||new Date(request.expiresAt).toISOString()!==request.expiresAt||Date.parse(request.expiresAt)<=now)
      throw new CrossDeviceBridgeError('NATIVE_PRODUCER_INTENT_INVALID','Invalid native source intent scope.');
  }
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
export const NATIVE_SOURCE_CHUNK_BYTES = 53_248;
export const NATIVE_FILTERED_FRAME_BYTES = 49_152;
const SAFE_REFERENCE_ID = /^[A-Za-z0-9._-]{1,256}$/;
const PRODUCER_KINDS = {
  '/api/edith/mobile/desktop-producer/pc-status': 'pc_status',
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
    && chunk.bytesRead <= NATIVE_SOURCE_CHUNK_BYTES
    && decodeBase64Length(chunk.bytesBase64) === chunk.bytesRead
    && /^[a-f0-9]{64}$/i.test(chunk.chunkSha256)
    && chunk.sourceSha256.toLowerCase() === expectedSourceSha256.toLowerCase()
    && chunk.nextOffsetBytes === chunk.offsetBytes + chunk.bytesRead;
}

/** Raw native SourceChunk, deliberately distinct from the legacy UI projection. */
export interface NativeSourceChunk {
  sourceHandle:string; chunkIndex:number; offsetBytes:number; chunkBytes:number;
  bytesTransferred:number; totalBytes:number; percent:number; chunkSha256:string;
  fileSha256:string; bytesBase64:string; completed:boolean;
}
export async function decodedBytesSha256(value:string, maximum:number):Promise<string> {
  if(!value || value.length>Math.ceil(maximum/3)*4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))
    throw new CrossDeviceBridgeError('TRANSFER_CHUNK_INTEGRITY_FAILED','Noncanonical bytes.');
  const binary=atob(value), bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
  try {
    if(!bytes.length || bytes.length>maximum || btoa(binary)!==value) throw Error('TRANSFER_CHUNK_INTEGRITY_FAILED');
    const digest=await crypto.subtle.digest('SHA-256',bytes);
    return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
  } finally {bytes.fill(0);}
}
export async function normalizeNativeSourceChunk(value:unknown, expected:{sourceHandle:string;chunkIndex:number;offsetBytes:number;maximumBytes:number;expectedSourceSha256:string;expectedChunkSha256?:string;expectedSizeBytes?:number}):Promise<TransferChunk> {
  const r=asRecord(value), keys=['sourceHandle','chunkIndex','offsetBytes','chunkBytes','bytesTransferred','totalBytes','percent','chunkSha256','fileSha256','bytesBase64','completed'];
  if(Object.keys(r).length!==keys.length || keys.some(k=>!Object.hasOwn(r,k)) || r.sourceHandle!==expected.sourceHandle || r.chunkIndex!==expected.chunkIndex || r.offsetBytes!==expected.offsetBytes
    || ![r.chunkIndex,r.offsetBytes,r.chunkBytes,r.bytesTransferred,r.totalBytes].every(v=>Number.isSafeInteger(v)&&Number(v)>=0)
    || Number(r.chunkBytes)<1 || Number(r.chunkBytes)>Math.min(expected.maximumBytes,NATIVE_SOURCE_CHUNK_BYTES)
    || r.offsetBytes!==Number(r.chunkIndex)*NATIVE_SOURCE_CHUNK_BYTES || r.bytesTransferred!==Number(r.offsetBytes)+Number(r.chunkBytes)
    || Number(r.totalBytes)>25*1024*1024 || Number(r.totalBytes)<Number(r.bytesTransferred)
    || r.chunkBytes!==Math.min(NATIVE_SOURCE_CHUNK_BYTES,Number(r.totalBytes)-Number(r.offsetBytes))
    || r.completed!==(r.bytesTransferred===r.totalBytes) || typeof r.percent!=='number' || !Number.isFinite(r.percent)
    || r.percent!==Math.round(Number(r.bytesTransferred)/Number(r.totalBytes)*10_000)/100
    || r.fileSha256!==expected.expectedSourceSha256 || typeof r.chunkSha256!=='string' || !/^[a-f0-9]{64}$/.test(r.chunkSha256)
    || typeof r.bytesBase64!=='string' || decodeBase64Length(r.bytesBase64)!==r.chunkBytes
    || (expected.expectedChunkSha256!==undefined&&r.chunkSha256!==expected.expectedChunkSha256)
    || (expected.expectedSizeBytes!==undefined&&r.chunkBytes!==expected.expectedSizeBytes))
    throw new CrossDeviceBridgeError('TRANSFER_CHUNK_INTEGRITY_FAILED','Native chunk binding failed.');
  if(await decodedBytesSha256(r.bytesBase64,NATIVE_SOURCE_CHUNK_BYTES)!==r.chunkSha256) throw new CrossDeviceBridgeError('TRANSFER_CHUNK_INTEGRITY_FAILED','Decoded bytes failed SHA256.');
  return {sourceHandle:r.sourceHandle as string,totalBytes:r.totalBytes as number,chunkIndex:r.chunkIndex as number,offsetBytes:r.offsetBytes as number,bytesRead:r.chunkBytes as number,bytesBase64:r.bytesBase64,chunkSha256:r.chunkSha256,sourceSha256:r.fileSha256 as string,nextOffsetBytes:r.bytesTransferred as number,complete:r.completed as boolean};
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
  private readonly stopNativeComputer: typeof stopComputer;
  private generation = 0;
  private snapshot: CrossDeviceBridgeSnapshot | null = null;
  private liveView: CrossDeviceLiveViewSessionV2 | null = null;
  private lastFrameAt = 0;
  private producerSession: LocalProducerSession | null = null;
  private liveViewEvidenceAccepted = false;
  private fileSendPreparation = 0;
  private readonly fileSendTargets = new WeakMap<FileSendTarget,{producer:LocalProducerSession;preparation:number}>();

  constructor(dependencies: CrossDeviceBridgeDependencies = {}) {
    this.invoke = dependencies.invoke ?? invokeDesktopCommand;
    this.fetcher = dependencies.fetcher ?? ((input, init) => fetch(input, init));
    this.ownerFetch = dependencies.ownerFetch ?? ownerMutationFetch;
    this.tauriAvailable = dependencies.tauriAvailable ?? isTauriShell;
    this.now = dependencies.now ?? Date.now;
    this.ownerSession = dependencies.ownerSession ?? primeOwnerSession;
    this.stopNativeComputer = dependencies.stopComputer ?? stopComputer;
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

  async refresh(options: {autoBootstrap?: boolean; signal?: AbortSignal} = {}): Promise<CrossDeviceBridgeSnapshot> {
    if(options.signal?.aborted) throw new DOMException('Local view was cancelled.','AbortError');
    const generation=this.generation;
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
      this.fetcher('/api/edith/mobile/cross-device/status', { credentials: 'include', signal:options.signal }),
      this.fetcher('/api/edith/mobile/devices', { credentials: 'include', signal:options.signal }),
      this.fetcher('/api/edith/kill-switch', { credentials: 'include', signal:options.signal }),
      this.fetcher('/api/edith/mobile/desktop-producer/status', { credentials: 'include', signal:options.signal }),
    ]);

    if (controlResult.status === 'fulfilled') {
      backendAvailable = controlResult.value.status < 500;
      ownerAuthorized = controlResult.value.ok;
      if (controlResult.value.ok) {
        const payload = await jsonBody(controlResult.value);
        ownerAuthorized = payload.success === true;
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
      const active=asRecord(payload.state).active;
      killSwitchActive = typeof active==='boolean' ? active : null;
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

    this.requireGeneration(generation);
    if (this.producerSession && Date.parse(this.producerSession.session.expiresAt) <= this.now()) this.clearProducerSession();

    if (options.autoBootstrap !== false && tauriAvailable && backendAvailable && ownerAuthorized && producer.configured && killSwitchActive === false
      && !native?.controlPlaneConnected && devices.length > 0) {
      try {
        await this.bootstrapNativeProducer(devices[0].deviceId);
        native = await this.invoke<CrossDeviceNativeStatus>('cross_device_native_status') ?? native;
        producer.localSessionActive = this.producerSessionActive;
      } catch {
        // Status remains configuration_required until an authenticated native bootstrap succeeds.
      }
    }

    this.requireGeneration(generation);
    if(options.signal?.aborted) throw new DOMException('Local view was cancelled.','AbortError');
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

  /** Candidate listing is read-only; a device appearing here does not authorize sending. */
  async refreshFileSendCandidates(signal?: AbortSignal): Promise<CrossDeviceBridgeSnapshot> {
    return this.refresh({autoBootstrap:false,signal});
  }

  clearFileSendTarget(): void { this.fileSendPreparation += 1; }

  private requireFileSendTarget(target: FileSendTarget, signal?: AbortSignal): LocalProducerSession {
    if(signal?.aborted) throw new DOMException('Local view was cancelled.','AbortError');
    const retained=this.fileSendTargets.get(target);
    if(!retained || retained.preparation!==this.fileSendPreparation || target.generation!==this.generation || this.producerSession!==retained.producer
      || !this.tauriAvailable() || retained.producer.session.targetDeviceId!==target.deviceId || retained.producer.session.sessionId!==target.sessionId
      || Date.parse(target.expiresAt)<=this.now()) throw new CrossDeviceBridgeError('FILES_SEND_SCOPE_STALE','Prepare the explicit current target again.');
    return retained.producer;
  }

  private requireFileSendReadiness(snapshot: CrossDeviceBridgeSnapshot, deviceId: string): void {
    if(!/^[A-Za-z0-9._:-]{1,160}$/.test(deviceId) || snapshot.devices.filter(device=>device.deviceId===deviceId).length!==1)
      throw new CrossDeviceBridgeError('FILES_SEND_TARGET_REQUIRED','Select one actual device candidate.');
    const candidate=snapshot.devices.find(device=>device.deviceId===deviceId)!;
    if(!snapshot.tauriAvailable || !snapshot.ownerAuthorized || !snapshot.backendAvailable || snapshot.killSwitchActive!==false || !snapshot.producer.configured
      || candidate.trustStatus!=='trusted' || !Number.isFinite(Date.parse(candidate.ownerBindingExpiresAt??'')) || Date.parse(candidate.ownerBindingExpiresAt!)<=this.now())
      throw new CrossDeviceBridgeError('FILES_SEND_CONFIGURATION_REQUIRED','A current owner and native paired target are required.');
  }

  async prepareFileSendTarget(deviceId: string, signal?: AbortSignal): Promise<FileSendTarget> {
    const preparation=++this.fileSendPreparation, generation=this.generation;
    const before=await this.refreshFileSendCandidates(signal);
    this.requireGeneration(generation);this.requireFileSendReadiness(before,deviceId);
    if(preparation!==this.fileSendPreparation || signal?.aborted) throw new CrossDeviceBridgeError('FILES_SEND_SCOPE_STALE','Target selection changed.');
    await this.bootstrapNativeProducer(deviceId,signal,()=>preparation===this.fileSendPreparation);
    this.requireGeneration(generation);
    const producer=this.producerSession;
    if(!producer || ['ownerSessionBindingId','workspaceId','sessionId','sourceDeviceId','targetDeviceId'].some(key=>typeof producer.session[key as keyof DesktopProducerSession]!=='string'||!/^[A-Za-z0-9._:-]{1,160}$/.test(producer.session[key as keyof DesktopProducerSession]))
      || !Number.isFinite(Date.parse(producer.session.expiresAt)) || new Date(producer.session.expiresAt).toISOString()!==producer.session.expiresAt)
      throw new CrossDeviceBridgeError('DESKTOP_PRODUCER_SESSION_INVALID','Current native producer required.');
    const target=Object.freeze({deviceId,generation,sessionId:producer.session.sessionId,expiresAt:producer.session.expiresAt});
    this.fileSendTargets.set(target,{producer,preparation});
    await this.recheckFileSendTarget(target,signal);
    return target;
  }

  async recheckFileSendTarget(target: FileSendTarget, signal?: AbortSignal): Promise<void> {
    const producer=this.requireFileSendTarget(target,signal);
    const snapshot=await this.refreshFileSendCandidates(signal);
    this.requireFileSendTarget(target,signal);this.requireFileSendReadiness(snapshot,target.deviceId);
    const candidate=snapshot.devices.find(device=>device.deviceId===target.deviceId)!;
    if(snapshot.capabilities.pcToMobileTransfer!=='available' || snapshot.native?.pcToMobileTransfer!=='available' || snapshot.native.controlPlaneConnected!==true
      || candidate.workspaceId!==producer.session.workspaceId || candidate.ownerSessionBindingId!==producer.session.ownerSessionBindingId
      || Date.parse(target.expiresAt)>Date.parse(candidate.ownerBindingExpiresAt!)) throw new CrossDeviceBridgeError('FILES_SEND_CONFIGURATION_REQUIRED','Native transfer capability is unavailable for the selected scope.');
  }

  /** Backend-derived completion is meaningful only in the retained native target scope. */
  async readFileSendCheckpoint(target: FileSendTarget, value: FileTransferDescriptorV2, signal?: AbortSignal): Promise<FileSendCheckpoint> {
    const descriptor=parseFileSendDescriptor(value,target.deviceId);
    const producer=this.requireFileSendTarget(target,signal), session=producer.session;
    if(descriptor.sourceDeviceId!==session.sourceDeviceId || descriptor.encryption?.keyId!==session.sessionId)
      throw new CrossDeviceBridgeError('FILES_SEND_LINEAGE_MISMATCH','Transfer does not match the current producer lineage.');
    await this.recheckFileSendTarget(target,signal);
    const result=await this.invoke<NativeProducerIngestResult>('cross_device_producer_ingest',{request:{operation:'transfer_checkpoint',transferId:descriptor.transferId}});
    this.requireFileSendTarget(target,signal);
    if(result?.status!==200 || asRecord(result.body).success!==true) throw new CrossDeviceBridgeError(safeErrorCode(asRecord(result?.body).errorCode,'FILES_SEND_CHECKPOINT_UNAVAILABLE'),'Checkpoint was not available.');
    const checkpoint=asRecord(asRecord(result.body).data), manifest=descriptor.chunkManifest!;
    const canonical=(input:unknown):string=>Array.isArray(input)?`[${input.map(canonical).join(',')}]`:input&&typeof input==='object'?`{${Object.entries(input).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,item])=>`${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`:JSON.stringify(input);
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(manifest)));
    this.requireFileSendTarget(target,signal);
    const expectedDigest=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
    const fields=['schema','transferId','manifestDigest','checkpointId','completedChunkIndexes','acknowledgedBytes','nextChunkIndex','expiresAt','status'];
    const indexes=checkpoint.completedChunkIndexes;
    if(Object.keys(checkpoint).length!==fields.length || fields.some(key=>!Object.hasOwn(checkpoint,key)) || checkpoint.schema!=='edith.native-mobile/1'
      || checkpoint.transferId!==descriptor.transferId || checkpoint.manifestDigest!==expectedDigest || typeof checkpoint.checkpointId!=='string' || !/^[A-Za-z0-9._:-]{1,160}$/.test(checkpoint.checkpointId)
      || !Array.isArray(indexes) || indexes.length>manifest.totalChunks || new Set(indexes).size!==indexes.length || indexes.some(index=>!Number.isSafeInteger(index)||Number(index)<0||Number(index)>=manifest.totalChunks)
      || !Number.isSafeInteger(checkpoint.acknowledgedBytes) || checkpoint.acknowledgedBytes!==indexes.reduce((sum,index)=>sum+manifest.chunks[Number(index)].sizeBytes,0)
      || checkpoint.nextChunkIndex!==(Array.from({length:manifest.totalChunks},(_,index)=>index).find(index=>!indexes.includes(index))??manifest.totalChunks)
      || typeof checkpoint.expiresAt!=='string' || !Number.isFinite(Date.parse(checkpoint.expiresAt)) || new Date(checkpoint.expiresAt).toISOString()!==checkpoint.expiresAt
      || Date.parse(checkpoint.expiresAt)<=this.now() || Date.parse(checkpoint.expiresAt)>Date.parse(target.expiresAt)
      || !['pending','transferring','completed','cancelled','failed'].includes(String(checkpoint.status))
      || checkpoint.status==='completed' && (checkpoint.acknowledgedBytes!==descriptor.sizeBytes || indexes.length!==manifest.totalChunks))
      throw new CrossDeviceBridgeError('FILES_SEND_CHECKPOINT_INVALID','Checkpoint failed transfer, manifest, progress or original-scope checks.');
    await this.recheckFileSendTarget(target,signal);
    return {...checkpoint,durableReceiverCommit:checkpoint.status==='completed'} as unknown as FileSendCheckpoint;
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

  private async bootstrapNativeProducer(deviceId: string, signal?: AbortSignal, isCurrent:()=>boolean=()=>true): Promise<DesktopProducerSession> {
    const generation=this.generation;
    const ownerSession = await this.ownerSession();
    this.requireGeneration(generation);
    if(signal?.aborted) throw new DOMException('Local view was cancelled.','AbortError');
    if(!isCurrent()) throw new CrossDeviceBridgeError('FILES_SEND_SCOPE_STALE','Target selection changed.');
    if (!ownerSession?.csrfToken) throw new CrossDeviceBridgeError('OWNER_SESSION_REQUIRED', 'An active owner session is required.');
    const result = await this.invoke<NativeProducerIngestResult>('cross_device_producer_ingest', {
      request: { operation: 'bootstrap', deviceId, csrfToken: ownerSession.csrfToken },
    });
    const session = asRecord(asRecord(result?.body).data).session as DesktopProducerSession | undefined;
    this.requireGeneration(generation);
    if(signal?.aborted) throw new DOMException('Local view was cancelled.','AbortError');
    if(!isCurrent()) throw new CrossDeviceBridgeError('FILES_SEND_SCOPE_STALE','Target selection changed.');
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

  private requireGeneration(generation:number):void {
    if(generation!==this.generation) throw new CrossDeviceBridgeError('NATIVE_SCOPE_REVOKED','Native scope was revoked during an await.');
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

  async startLiveView(deviceId: string, selection?:NativePublicRegionSelection): Promise<CrossDeviceLiveViewSessionV2> {
    const rectangle=(r:unknown):r is [number,number,number,number]=>Array.isArray(r)&&r.length===4&&r.every(Number.isSafeInteger)&&r[2]>r[0]&&r[3]>r[1];
    if(!selection||Object.keys(selection).length!==5||typeof selection.observationId!=='string'||!/^[A-Za-z0-9._:-]{1,160}$/.test(selection.observationId)
      ||!Number.isSafeInteger(selection.observationGeneration)||selection.observationGeneration<1||!Number.isSafeInteger(selection.leaseGeneration)||selection.leaseGeneration<1
      ||!rectangle(selection.publicRegion)||!Array.isArray(selection.exclusions)||selection.exclusions.length>32||!selection.exclusions.every(rectangle))
      throw new CrossDeviceBridgeError('LIVE_VIEW_NATIVE_SELECTION_REQUIRED','Select an observed native window public region and exclusions.');
    selection=structuredClone(selection);
    const generation=this.generation;
    await this.assertOperational('liveView');
    this.requireGeneration(generation);
    await this.openProducerSession(deviceId);
    const requestedResponse = await this.ownerFetch(`/api/edith/mobile/cross-device/live-view/${encodeURIComponent(deviceId)}/request`, { method: 'POST' });
    const requestedPayload = await jsonBody(requestedResponse);
    this.requireGeneration(generation);
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
    this.requireGeneration(generation);
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
          ...selection,
        },
      });
      this.requireGeneration(generation);
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
    const generation=this.generation;
    const liveView = this.liveView;
    if (!liveView) throw new CrossDeviceBridgeError('LIVE_VIEW_NOT_ACTIVE', 'Live View is not active.');
    if (Date.parse(liveView.expiresAt) <= this.now()) {
      await this.stopLiveView();
      throw new CrossDeviceBridgeError('LIVE_VIEW_EXPIRED', 'Live View expired.');
    }
    const elapsed = this.now() - this.lastFrameAt;
    if (this.lastFrameAt && elapsed < MIN_FRAME_INTERVAL_MS) throw new CrossDeviceBridgeError('LIVE_VIEW_FRAME_RATE_LIMITED', 'Frame pull is limited to 2 FPS.');
    await this.assertOperational('liveView');
    this.requireGeneration(generation);
    try {
      const frame = await this.invoke<CrossDeviceFrame>('cross_device_live_view_frame', {
        ownerSessionBindingId: liveView.ownerSessionBindingId,
        liveViewId: liveView.liveViewId,
      });
      this.requireGeneration(generation);
      if (!frame || frame.metadata.liveViewId !== liveView.liveViewId || frame.metadata.ownerSessionBindingId !== liveView.ownerSessionBindingId) {
        throw new CrossDeviceBridgeError('LIVE_VIEW_FRAME_BINDING_INVALID', 'Frame lineage did not match the active lease.');
      }
      if (decodeBase64Length(frame.transport.bytesBase64) !== frame.transport.sizeBytes || frame.transport.mimeType!=='image/png'
        ||frame.transport.sizeBytes>NATIVE_FILTERED_FRAME_BYTES||!/^[A-Za-z0-9._:-]{1,160}$/.test(frame.frameRef)
        ||Date.parse(frame.metadata.observedAt)>this.now()||this.now()-Date.parse(frame.metadata.observedAt)>2000
        ||await decodedBytesSha256(frame.transport.bytesBase64,NATIVE_FILTERED_FRAME_BYTES)!==frame.transport.sha256) {
        throw new CrossDeviceBridgeError('LIVE_VIEW_FRAME_INTEGRITY_INVALID', 'Frame transport failed integrity checks.');
      }
      this.requireGeneration(generation);
      const authenticatedMetadata = { ...frame.metadata, ...this.producerLineage() };
      const publication=await this.invoke<NativeProducerIngestResult>('cross_device_producer_ingest',{request:{operation:'publish_frame',liveViewId:liveView.liveViewId,frameRef:frame.frameRef}});
      this.requireGeneration(generation);
      const published=asRecord(asRecord(publication?.body).data);
      if(publication?.status!==202||asRecord(publication.body).success!==true||published.frameId!==frame.metadata.frameId||published.sequence!==frame.metadata.sequence||Date.parse(String(published.expiresAt))<=this.now())throw new CrossDeviceBridgeError('LIVE_VIEW_PUBLICATION_REJECTED','Native filtered frame publication failed.');
      this.liveViewEvidenceAccepted = true;
      this.lastFrameAt = this.now();
      const postCheck = await this.refresh();
      this.requireGeneration(generation);
      if (postCheck.killSwitchActive) throw new CrossDeviceBridgeError('KILL_SWITCH_ACTIVE', 'Emergency Stop interrupted Live View.');
      return { ...frame, metadata: authenticatedMetadata };
    } catch (error) {
      if (error instanceof CrossDeviceBridgeError && error.code === 'LIVE_VIEW_FRAME_RATE_LIMITED') throw error;
      await this.stopLiveView();
      throw error instanceof CrossDeviceBridgeError ? error : new CrossDeviceBridgeError(safeErrorCode(error), 'Live View frame could not be read.');
    }
  }

  async stopLiveView(): Promise<void> {
    this.generation+=1;
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

  async readSourceChunk(request: { ownerSessionBindingId: string; sourceHandle: string; chunkIndex: number; offsetBytes: number; maximumBytes: number; expectedSourceSha256: string; expectedChunkSha256?:string; expectedSizeBytes?:number }): Promise<TransferChunk> {
    request=structuredClone(request);
    const generation=this.generation;
    await this.assertOperational('pcToMobileTransfer');
    this.requireGeneration(generation);
    if(!Number.isSafeInteger(request.maximumBytes)||request.maximumBytes<1||request.maximumBytes>NATIVE_SOURCE_CHUNK_BYTES) throw new CrossDeviceBridgeError('TRANSFER_CHUNK_SIZE_INVALID','Chunk exceeds native budget.');
    const producer=this.producerSession;
    if(!producer || producer.session.ownerSessionBindingId!==request.ownerSessionBindingId) throw new CrossDeviceBridgeError('TRANSFER_SOURCE_OWNER_MISMATCH','Current native producer owner required.');
    const raw = await this.invoke<NativeSourceChunk>('cross_device_read_source_chunk', { request: {
      ownerSessionBindingId: request.ownerSessionBindingId,
      sourceHandle: request.sourceHandle,
      chunkIndex: request.chunkIndex,
      offsetBytes: request.offsetBytes,
      maximumBytes: request.maximumBytes,
    } });
    this.requireGeneration(generation);
    const chunk=await normalizeNativeSourceChunk(raw,request);
    this.requireGeneration(generation);
    if(this.producerSession!==producer||Date.parse(producer.session.expiresAt)<=this.now())throw new CrossDeviceBridgeError('NATIVE_SCOPE_REVOKED','Source scope expired.');
    return chunk;
  }

  /** Relay intentions only. Source/commit/privacy facts and credentials stay native. */
  async relayNativeProducerIntent(request:NativeProducerIntent):Promise<{status:number;data:Record<string,unknown>}> {
    validateNativeProducerIntent(request,this.now());
    request=structuredClone(request);
    const generation=this.generation;
    await this.assertOperational(['register_receiver','receive_chunk','commit_receiver'].includes(request.operation)?'mobileToPcInbox':'pcToMobileTransfer');this.requireGeneration(generation);
    const producer=this.producerSession;
    if(!producer||Date.parse(producer.session.expiresAt)<=this.now())throw new CrossDeviceBridgeError('DESKTOP_PRODUCER_SESSION_INVALID','Current producer required.');
    validateNativeProducerIntent(request,this.now());
    if(request.operation==='pin_source') {
      const actual=this.producerLineage();
      if(Object.keys(request.lineage).length!==7||Object.entries(actual).some(([k,v])=>request.lineage[k as keyof CrossDeviceLineageV2]!==v))throw new CrossDeviceBridgeError('DESKTOP_PRODUCER_LINEAGE_MISMATCH','Source lineage must match current producer.');
      if(Date.parse(request.expiresAt)>Date.parse(producer.session.expiresAt))throw new CrossDeviceBridgeError('NATIVE_PRODUCER_INTENT_INVALID','Source deadline exceeds original producer scope.');
    }
    const result=await this.invoke<NativeProducerIngestResult>('cross_device_producer_ingest',{request});
    this.requireGeneration(generation);
    if(this.producerSession!==producer||Date.parse(producer.session.expiresAt)<=this.now())throw new CrossDeviceBridgeError('NATIVE_SCOPE_REVOKED','Producer scope expired.');
    if(!result||![200,201,202].includes(result.status)||asRecord(result.body).success!==true)throw new CrossDeviceBridgeError(safeErrorCode(asRecord(result?.body).errorCode,'NATIVE_PRODUCER_REJECTED'),'Native producer rejected intent.');
    // 202 acknowledges staging, never receiver delivery.
    return {status:result.status,data:asRecord(asRecord(result.body).data)};
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
    const generation=this.generation;
    reference=structuredClone(reference);
    if (!SAFE_REFERENCE_ID.test(reference.cardId)
      || !SAFE_REFERENCE_ID.test(reference.source.id)
      || !['task', 'research', 'knowledge', 'transfer', 'screenshot', 'error'].includes(reference.source.type)) {
      throw new CrossDeviceBridgeError('RESULT_CARD_SOURCE_INVALID', 'Result card source reference is invalid.');
    }
    const snapshot = await this.refresh();
    this.requireGeneration(generation);
    if (snapshot.killSwitchActive) throw new CrossDeviceBridgeError('KILL_SWITCH_ACTIVE', 'Emergency Stop is active.');
    if (snapshot.killSwitchActive === null) throw new CrossDeviceBridgeError('KILL_SWITCH_STATUS_UNAVAILABLE', 'Emergency Stop state could not be verified.');
    if (!snapshot.ownerAuthorized) throw new CrossDeviceBridgeError('OWNER_SESSION_REQUIRED', 'An active owner session is required.');
    const response = await this.ownerFetch(`/api/edith/mobile/cross-device/result-cards/${encodeURIComponent(deviceId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reference),
    });
    const payload = await jsonBody(response);
    this.requireGeneration(generation);
    if (response.status !== 201 || payload.success !== true) throw new CrossDeviceBridgeError(safeErrorCode(payload.errorCode), 'Result card publication was rejected.');
    const returned = asRecord(asRecord(payload.data).card);
    const checked = parseSharedResultCardV2(returned);
    if (checked.success === false) throw new CrossDeviceBridgeError(checked.errorCode, 'Published result card response was malformed.');
    if(checked.value.cardId!==reference.cardId || checked.value.targetDeviceId!==deviceId || checked.value.provenance.sourceType!==reference.source.type || checked.value.provenance.sourceId!==reference.source.id)
      throw new CrossDeviceBridgeError('RESULT_CARD_REQUEST_MISMATCH','Published result card did not match the requested source and target.');
    return { shared: checked.value, legacy: adaptSharedResultCardToLegacyV2(checked.value) };
  }

  async emergencyStop(reasonCode = 'KILL_SWITCH_ACTIVE'): Promise<void> {
    this.generation+=1;
    // Issue the immediate native latch before any owner/transfer/frame cleanup awaits.
    const nativeStop=this.stopNativeComputer();
    const liveView = this.liveView;
    const binding = liveView?.ownerSessionBindingId
      ?? this.snapshot?.devices.find((device) => device.ownerSessionBindingId)?.ownerSessionBindingId;
    this.liveView = null;
    this.lastFrameAt = 0;
    this.clearProducerSession();
    await Promise.allSettled([
      nativeStop,
      binding && this.tauriAvailable()
        ? this.invoke('cross_device_revoke_owner', { ownerSessionBindingId: binding, reasonCode: reasonCode === 'OWNER_SESSION_EXPIRED' ? reasonCode : 'OWNER_SESSION_ROTATED' })
        : Promise.resolve(),
      liveView ? this.stopBackendLiveView(liveView.liveViewId) : Promise.resolve(),
    ]);
  }

  async revokeOwner(ownerSessionBindingId: string, reasonCode: 'LOGOUT' | 'OWNER_SESSION_EXPIRED' | 'OWNER_SESSION_ROTATED' = 'LOGOUT'): Promise<void> {
    this.generation+=1;
    this.liveView = null;
    this.lastFrameAt = 0;
    this.clearProducerSession();
    if (this.tauriAvailable()) await this.invoke('cross_device_revoke_owner', { ownerSessionBindingId, reasonCode }).catch(() => undefined);
  }

  async revokeCurrentOwner(reasonCode: 'LOGOUT' | 'OWNER_SESSION_EXPIRED' | 'OWNER_SESSION_ROTATED' = 'LOGOUT'): Promise<void> {
    this.generation+=1;
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
