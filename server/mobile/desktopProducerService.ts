import { createHash, randomBytes } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import type {
  CrossDeviceLiveViewFrameMetadataV2,
  DesktopObservationV2,
} from '../../src/edith/contracts';
import type { ArtifactEvidenceV2, ErrorAttentionEvidenceV2 } from '../../src/edith/sharedResultCardProducer';
import type { MobileSessionContext } from './types';
import { FILTERED_FRAME_BYTES, NATIVE_PLAINTEXT_BYTES, decodeNativeBytes, nativeDigest, parseFilteredFrame, parseFilteredScope, type FilteredScopeRegistration, type FilteredFrameUpload, type FilteredFramePayload } from './nativeProducerContract';

const DEFAULT_TTL_MS = 15 * 60_000;
const MAX_RECORDS = 500;

function pngCrc(bytes:Buffer):number {let value=0xffffffff;for(const byte of bytes){value^=byte;for(let bit=0;bit<8;bit++)value=(value>>>1)^((value&1)?0xedb88320:0);}return (value^0xffffffff)>>>0;}
/** Bounded encoded-image validation; privacy comes from the retained native scope constructor. */
function validateFilteredPng(bytes:Buffer,width:number,height:number):void {
  if(!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('LIVE_VIEW_PNG_INVALID');
  let offset=8,bpp=0,ended=false;const compressed:Buffer[]=[];
  while(offset+12<=bytes.length){
    const length=bytes.readUInt32BE(offset),kind=bytes.toString('ascii',offset+4,offset+8);
    if(length>FILTERED_FRAME_BYTES||offset+12+length>bytes.length||pngCrc(bytes.subarray(offset+4,offset+8+length))!==bytes.readUInt32BE(offset+8+length))throw Error('LIVE_VIEW_PNG_INVALID');
    const data=bytes.subarray(offset+8,offset+8+length);
    if(offset===8){if(kind!=='IHDR'||length!==13||data.readUInt32BE(0)!==width||data.readUInt32BE(4)!==height||data[8]!==8||![2,6].includes(data[9])||data[10]!==0||data[11]!==0||data[12]!==0)throw Error('LIVE_VIEW_PNG_PROFILE_INVALID');bpp=data[9]===6?4:3;}
    else if(kind==='IHDR')throw Error('LIVE_VIEW_PNG_INVALID');
    else if(kind==='IDAT')compressed.push(data);
    else if(kind==='IEND'){if(length!==0||offset+12!==bytes.length)throw Error('LIVE_VIEW_PNG_INVALID');ended=true;break;}
    else if(kind[0]===kind[0].toUpperCase())throw Error('LIVE_VIEW_PNG_PROFILE_INVALID');
    offset+=length+12;
  }
  if(!ended||!compressed.length)throw Error('LIVE_VIEW_PNG_INVALID');
  const size=(width*bpp+1)*height;let decoded:Buffer;
  try{decoded=inflateSync(Buffer.concat(compressed),{maxOutputLength:size});}catch{throw Error('LIVE_VIEW_PNG_INVALID');}
  try{if(decoded.length!==size)throw Error('LIVE_VIEW_PNG_INVALID');for(let y=0;y<height;y++)if(decoded[y*(width*bpp+1)]>4)throw Error('LIVE_VIEW_PNG_INVALID');}finally{decoded.fill(0);}
}

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
  private readonly filteredScopes = new Map<string, { session: StoredSession; registration: FilteredScopeRegistration; sequence: number; observedAt: number; bytes?: Buffer; payload?: Omit<FilteredFramePayload,'bytesBase64'>; timer?:ReturnType<typeof setTimeout> }>();
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
    const expiresAt = new Date(Math.min(Date.now() + this.ttlMs(), Date.parse(context.credential.expiresAt), Date.parse(context.device.ownerBinding.expiresAt), Date.parse(context.device.trust.expiresAt!))).toISOString();
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

  registerFilteredScope(session: StoredSession, input: FilteredScopeRegistration): FilteredScopeRegistration {
    this.cleanup();
    const parsed = parseFilteredScope(input); if(parsed.success===false)throw Error(parsed.errorCode);
    this.assertRetainedSession(session); this.assertLineage(session,input.producerLineage);
    const now=Date.now();
    if(Date.parse(input.approvedAt)>now||Date.parse(input.approvedAt)<now-30_000||Date.parse(input.expiresAt)<=now||Date.parse(input.expiresAt)>Math.min(Date.parse(session.expiresAt),Date.parse(input.approvedAt)+300_000))throw Error('LIVE_VIEW_PRIVACY_SCOPE_EXPIRED');
    const prior=this.filteredScopes.get(input.liveViewId);
    if(prior){if(prior.session!==session||JSON.stringify(prior.registration)!==JSON.stringify(input))throw Error('LIVE_VIEW_PRIVACY_SCOPE_CONFLICT');return structuredClone(prior.registration);}
    if(this.filteredScopes.size>=4)throw Error('LIVE_VIEW_FRAME_CAPACITY');
    this.filteredScopes.set(input.liveViewId,{session,registration:structuredClone(input),sequence:0,observedAt:0});
    return structuredClone(input);
  }

  putFilteredFrame(session:StoredSession,input:FilteredFrameUpload, authorize:()=>void):FilteredFramePayload {
    this.cleanup();authorize();this.assertRetainedSession(session);
    const parsed=parseFilteredFrame(input);if(parsed.success===false)throw Error(parsed.errorCode);
    this.assertLineage(session,input.producerLineage);
    const slot=this.filteredScopes.get(input.liveViewId);if(!slot||slot.session!==session)throw Error('LIVE_VIEW_PRIVACY_FILTER_REQUIRED');
    const scope=slot.registration,now=Date.now(),observed=Date.parse(input.observedAt);
    if(scope.scopeRef!==input.scopeRef||scope.scopeDigest!==input.scopeDigest||scope.leaseGeneration!==input.leaseGeneration)throw Error('LIVE_VIEW_SCOPE_GENERATION_INVALID');
    if(Date.parse(scope.expiresAt)<=now||observed>now||now-observed>2000||observed<Date.parse(scope.approvedAt))throw Error('LIVE_VIEW_FRAME_EXPIRED');
    if(input.sequence!==slot.sequence+1||observed-slot.observedAt<500)throw Error('LIVE_VIEW_FRAME_SEQUENCE_INVALID');
    const bytes=decodeNativeBytes(input.bytesBase64,FILTERED_FRAME_BYTES);
    try {
      if(bytes.length!==input.sizeBytes||createHash('sha256').update(bytes).digest('hex')!==input.sha256)throw Error('LIVE_VIEW_FRAME_DIGEST_INVALID');
      validateFilteredPng(bytes,input.width,input.height);
      authorize();this.assertRetainedSession(session);
      if(this.filteredScopes.get(input.liveViewId)!==slot||Date.parse(scope.expiresAt)<=Date.now()||Date.now()-observed>2000)throw Error('LIVE_VIEW_FRAME_EXPIRED');
      const payload:Omit<FilteredFramePayload,'bytesBase64'>={liveViewId:input.liveViewId,leaseGeneration:input.leaseGeneration,frameId:input.frameId,sequence:input.sequence,observedAt:input.observedAt,expiresAt:new Date(Math.min(observed+2000,Date.parse(scope.expiresAt))).toISOString(),width:input.width,height:input.height,mediaType:'image/png',sizeBytes:input.sizeBytes,sha256:input.sha256};
      if(Buffer.byteLength(JSON.stringify({...payload,bytesBase64:input.bytesBase64}))>NATIVE_PLAINTEXT_BYTES)throw Error('LIVE_VIEW_FRAME_TRANSPORT_LIMIT');
      slot.bytes?.fill(0);slot.bytes=bytes;slot.payload=payload;slot.sequence=input.sequence;slot.observedAt=observed;
      if(slot.timer)clearTimeout(slot.timer);
      slot.timer=setTimeout(()=>{if(slot.bytes===bytes){slot.bytes.fill(0);slot.bytes=undefined;slot.payload=undefined;}},Math.max(0,Date.parse(payload.expiresAt)-Date.now()));slot.timer.unref?.();
      return {...payload,bytesBase64:input.bytesBase64};
    } catch(error){bytes.fill(0);throw error;}
  }

  getFilteredFrame(context:MobileSessionContext,id:string,generation:number,authorize:()=>void):FilteredFramePayload|undefined {
    this.cleanup();authorize();const slot=this.filteredScopes.get(id);
    if(!slot)return undefined;
    const session=slot.session;
    this.assertRetainedSession(session);
    if(context.credential.sessionId!==session.sessionId||context.credential.deviceId!==session.targetDeviceId||context.credential.workspaceId!==session.workspaceId||context.device.ownerBinding.ownerSessionId!==session.ownerSessionBindingId||generation!==slot.registration.leaseGeneration)throw Error('LIVE_VIEW_SCOPE_GENERATION_INVALID');
    if(!slot.bytes||!slot.payload)return undefined;
    if(Date.parse(slot.payload.expiresAt)<=Date.now()){slot.bytes.fill(0);slot.bytes=undefined;slot.payload=undefined;return undefined;}
    const payload={...slot.payload,bytesBase64:slot.bytes.toString('base64')};authorize();this.assertRetainedSession(session);
    if(this.filteredScopes.get(id)!==slot||Date.parse(payload.expiresAt)<=Date.now())throw Error('LIVE_VIEW_FRAME_EXPIRED');
    return payload;
  }

  clearFilteredFrame(id:string):void {const slot=this.filteredScopes.get(id);slot?.bytes?.fill(0);if(slot?.timer)clearTimeout(slot.timer);this.filteredScopes.delete(id);}
  revokeSession(deviceId:string,sessionId:string):void {for(const[key,session]of this.sessions)if(session.targetDeviceId===deviceId&&session.sessionId===sessionId)this.sessions.delete(key);this.cleanup();}
  private assertRetainedSession(session:StoredSession):void {if(this.sessions.get(session.tokenHash)!==session||Date.parse(session.expiresAt)<=Date.now())throw Error('DESKTOP_PRODUCER_SESSION_INVALID');}

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
    for(const [id,slot]of this.filteredScopes)if(slot.session.ownerSessionBindingId===bindingId)this.clearFilteredFrame(id);
    for (const [key, session] of this.sessions) if (session.ownerSessionBindingId === bindingId) this.sessions.delete(key);
    for (const [key, frame] of this.frames) if (frame.ownerSessionBindingId === bindingId) this.frames.delete(key);
    for (const [key, value] of this.receipts) if (value.ownerSessionBindingId === bindingId) this.receipts.delete(key);
    for (const [key, value] of this.observations) if (value.ownerSessionBindingId === bindingId) this.observations.delete(key);
    for (const [key, value] of this.errors) if (value.ownerSessionBindingId === bindingId) this.errors.delete(key);
  }

  revokeAll(): void {
    for(const id of this.filteredScopes.keys())this.clearFilteredFrame(id);
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
      filteredFrameScopes: [...this.filteredScopes.values()].filter(item=>item.session.ownerSessionBindingId===bindingId).length,
    };
  }

  private ttlMs(): number {
    const value = Number(process.env.EDITH_DESKTOP_PRODUCER_SESSION_TTL_MS ?? DEFAULT_TTL_MS);
    return Number.isFinite(value) ? Math.min(Math.max(value, 60_000), 60 * 60_000) : DEFAULT_TTL_MS;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, value] of this.sessions) if (Date.parse(value.expiresAt) <= now) this.sessions.delete(key);
    for(const [id,slot]of this.filteredScopes)if(Date.parse(slot.registration.expiresAt)<=now||this.sessions.get(slot.session.tokenHash)!==slot.session)this.clearFilteredFrame(id);
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

export const sharedDesktopProducerService=new DesktopProducerService();
