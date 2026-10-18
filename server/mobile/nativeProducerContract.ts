import { createHash } from 'node:crypto';
import { parseFileChunkManifestV2, isSafeTransferFileNameV2, type FileChunkManifestV2, type CrossDeviceLineageV2 } from '../../src/edith/contracts';

export const NATIVE_MOBILE_SCHEMA = 'edith.native-mobile/1' as const;
export const NATIVE_CHUNK_BYTES = 52 * 1024;
export const NATIVE_FILE_BYTES = 25 * 1024 * 1024;
export const FILTERED_FRAME_BYTES = 48 * 1024;
export const NATIVE_PLAINTEXT_BYTES = 75_000;
export const FRAME_UPLOAD_PATH = '/api/edith/mobile/desktop-producer/live-view/frame-bytes';
export type NativeLineage = CrossDeviceLineageV2;
export interface SourcePinManifest {
  schema: typeof NATIVE_MOBILE_SCHEMA; lineage: NativeLineage; transferId: string; sourceHandle: string;
  manifest: FileChunkManifestV2; manifestDigest: string; sourceIdentityDigest: string; sourceGeneration: number;
  fileName: string; mediaType: string; expiresAt: string;
}
export interface TransferChunkRead { schema: typeof NATIVE_MOBILE_SCHEMA; lineage: NativeLineage; transferId: string; manifestDigest: string; checkpointId: string; index: number; offsetBytes: number }
export interface OutboundChunk extends TransferChunkRead { sourceHandle: string; sizeBytes: number; chunkSha256: string; fileSha256: string; bytesBase64: string }
export interface TransferChunkAck { schema: typeof NATIVE_MOBILE_SCHEMA; lineage: NativeLineage; transferId: string; manifestDigest: string; checkpointId: string; index: number; chunkSha256: string; acknowledgedBytes: number }
export interface ReceiverCommit { schema: typeof NATIVE_MOBILE_SCHEMA; lineage: NativeLineage; transferId: string; manifestDigest: string; checkpointId: string; sizeBytes: number; sha256: string; destinationHandle: string; commitId: string; committedAt: string }
export interface TransferCheckpoint { schema: typeof NATIVE_MOBILE_SCHEMA; transferId: string; manifestDigest: string; checkpointId: string; completedChunkIndexes: number[]; acknowledgedBytes: number; nextChunkIndex: number; expiresAt: string; status: 'pending'|'transferring'|'completed'|'cancelled'|'failed' }
export interface TransferControl { schema: typeof NATIVE_MOBILE_SCHEMA; lineage: NativeLineage; transferId: string; manifestDigest: string; checkpointId: string }
export interface TransferResume extends TransferControl { completedChunkIndexes: number[]; acknowledgedBytes: number }
export interface NativeTransferState {
  schema: typeof NATIVE_MOBILE_SCHEMA; lineage: NativeLineage; originalSessionId: string; originalGeneration: number; boundGeneration?: number;
  manifestDigest: string; checkpointId: string; previousCheckpointId?: string; expiresAt: string;
  sourceHandle?: string; sourceIdentityDigest?: string; sourceGeneration?: number; stagedVerifiedAt?: string;
  receiverCommit?: ReceiverCommit; outboundAvailableIndexes: number[]; receiverAckIndexes: number[];
  destinationHandle?: string; receiverGeneration?: number; receiverPinnedAt?: string; sourceFileId?: string; cancelledAt?: string;
}
export type SourcePinReapproval = SourcePinManifest & { checkpointId: string };
export type InboundChunkUpload = Omit<OutboundChunk, 'sourceHandle'>;
export interface ReceiverPinRegistration extends TransferControl { destinationHandle: string; receiverGeneration: number; expiresAt: string }
export interface FilteredScopeRegistration {
  schema: typeof NATIVE_MOBILE_SCHEMA; producerLineage: NativeLineage; liveViewId: string; leaseGeneration: number;
  scopeRef: string; privacyProfile: 'window-public-region-v1'; scopeDigest: string; approvedAt: string; expiresAt: string;
}
export interface FilteredFrameUpload {
  schema: typeof NATIVE_MOBILE_SCHEMA; producerLineage: NativeLineage; liveViewId: string; leaseGeneration: number;
  scopeRef: string; scopeDigest: string; frameId: string; sequence: number; observedAt: string;
  width: number; height: number; mediaType: 'image/png'; sizeBytes: number; sha256: string; bytesBase64: string;
}
export interface FilteredFramePayload { liveViewId: string; leaseGeneration: number; frameId: string; sequence: number; observedAt: string; expiresAt: string; width: number; height: number; mediaType: 'image/png'; sizeBytes: number; sha256: string; bytesBase64: string }
export const nativeId = (value: unknown): value is string => typeof value==='string' && /^[A-Za-z0-9._:-]{1,160}$/.test(value);
export const nativeDigest = (value: unknown): value is string => typeof value==='string' && /^[a-f0-9]{64}$/.test(value);
export const nativeTime = (value: unknown): value is string => typeof value==='string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString()===value;
export const nativeInteger = (value: unknown, min=0): value is number => Number.isSafeInteger(value) && Number(value)>=min;
export function canonicalNative(value: unknown): string {
  if(Array.isArray(value))return `[${value.map(canonicalNative).join(',')}]`;
  if(value&&typeof value==='object')return `{${Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>`${JSON.stringify(k)}:${canonicalNative(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
export const nativeManifestDigest=(manifest:FileChunkManifestV2)=>createHash('sha256').update(canonicalNative(manifest)).digest('hex');
export function nativeObject(value:unknown,keys:string[],max=8192): value is Record<string,any> {
  const bounded=(v:any,depth=0):boolean=>depth<=8&&(Array.isArray(v)?v.every(x=>bounded(x,depth+1)):v&&typeof v==='object'?Object.values(v).every(x=>bounded(x,depth+1)):['string','boolean','number'].includes(typeof v)||v===null);
  try{return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key))&&bounded(value)&&Buffer.byteLength(JSON.stringify(value))<=max;}catch{return false;}
}
export function nativeLineage(value:unknown): value is NativeLineage {
  return nativeObject(value,['contractVersion','amendment','ownerSessionBindingId','workspaceId','sessionId','sourceDeviceId','targetDeviceId'])&&value.contractVersion===2&&value.amendment==='2.1'&&['ownerSessionBindingId','workspaceId','sessionId','sourceDeviceId','targetDeviceId'].every(k=>nativeId(value[k]));
}
export function decodeNativeBytes(value:unknown,max:number):Buffer {
  if(typeof value!=='string'||value.length>Math.ceil(max/3)*4||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))throw Error('NATIVE_BYTES_INVALID');
  const bytes=Buffer.from(value,'base64');if(!bytes.length||bytes.length>max||bytes.toString('base64')!==value)throw Error('NATIVE_BYTES_INVALID');return bytes;
}
type Parsed<T>={success:true;value:T}|{success:false;errorCode:string};
function parsed<T>(value:unknown,valid:boolean,code:string):Parsed<T>{return valid?{success:true,value:value as T}:{success:false,errorCode:code};}
const schema=(row:any)=>row.schema===NATIVE_MOBILE_SCHEMA;
const common=(row:any)=>schema(row)&&nativeLineage(row.lineage)&&nativeId(row.transferId)&&nativeDigest(row.manifestDigest);
export function parseSourcePinManifest(value:unknown):Parsed<SourcePinManifest>{
  const row=value as any;const keys=['schema','lineage','transferId','sourceHandle','manifest','manifestDigest','sourceIdentityDigest','sourceGeneration','fileName','mediaType','expiresAt'];
  let valid=nativeObject(value,keys,72*1024)&&common(row)&&nativeId(row.sourceHandle)&&nativeDigest(row.sourceIdentityDigest)&&nativeInteger(row.sourceGeneration,1)&&isSafeTransferFileNameV2(row.fileName)&&['text/plain','application/json','image/png','image/jpeg','application/pdf'].includes(row.mediaType)&&nativeTime(row.expiresAt)&&parseFileChunkManifestV2(row.manifest).success;
  if(valid){const m=row.manifest;valid=m.transferId===row.transferId&&nativeInteger(m.sizeBytes,1)&&m.sizeBytes<=NATIVE_FILE_BYTES&&m.chunkSizeBytes===NATIVE_CHUNK_BYTES&&m.totalChunks<=512&&m.totalChunks===Math.ceil(m.sizeBytes/NATIVE_CHUNK_BYTES)&&m.chunks.every((c:any,i:number)=>c.offsetBytes===i*NATIVE_CHUNK_BYTES&&c.sizeBytes===Math.min(NATIVE_CHUNK_BYTES,m.sizeBytes-c.offsetBytes))&&nativeManifestDigest(m)===row.manifestDigest;}
  return parsed(value,valid,'TRANSFER_SOURCE_MANIFEST_INVALID');
}
export function parseSourcePinReapproval(value:unknown):Parsed<SourcePinReapproval>{
  const row=value as any;
  if(!nativeObject(value,['schema','lineage','transferId','sourceHandle','manifest','manifestDigest','sourceIdentityDigest','sourceGeneration','fileName','mediaType','expiresAt','checkpointId'],72*1024)||!nativeId(row.checkpointId))return parsed(value,false,'TRANSFER_SOURCE_REAPPROVAL_INVALID');
  const {checkpointId,...source}=row;
  return parsed(value,parseSourcePinManifest(source).success,'TRANSFER_SOURCE_REAPPROVAL_INVALID');
}
export function parseReceiverPinRegistration(value:unknown):Parsed<ReceiverPinRegistration>{
  const row=value as any;return parsed(value,nativeObject(value,['schema','lineage','transferId','manifestDigest','checkpointId','destinationHandle','receiverGeneration','expiresAt'])&&common(row)&&nativeId(row.checkpointId)&&nativeId(row.destinationHandle)&&nativeInteger(row.receiverGeneration,1)&&nativeTime(row.expiresAt),'TRANSFER_RECEIVER_PIN_INVALID');
}
export function parseOutboundChunk(value:unknown):Parsed<OutboundChunk>{
  const row=value as any;let valid=nativeObject(value,['schema','lineage','transferId','manifestDigest','checkpointId','index','offsetBytes','sourceHandle','sizeBytes','chunkSha256','fileSha256','bytesBase64'],96*1024)&&common(row)&&nativeId(row.checkpointId)&&nativeId(row.sourceHandle)&&nativeInteger(row.index)&&nativeInteger(row.offsetBytes)&&nativeInteger(row.sizeBytes,1)&&row.sizeBytes<=NATIVE_CHUNK_BYTES&&nativeDigest(row.chunkSha256)&&nativeDigest(row.fileSha256);
  if(valid)try{const bytes=decodeNativeBytes(row.bytesBase64,NATIVE_CHUNK_BYTES);valid=bytes.length===row.sizeBytes&&createHash('sha256').update(bytes).digest('hex')===row.chunkSha256;}catch{valid=false;}
  return parsed(value,valid,'TRANSFER_SOURCE_CHUNK_INVALID');
}
export function parseTransferChunkRead(value:unknown):Parsed<TransferChunkRead>{const row=value as any;return parsed(value,nativeObject(value,['schema','lineage','transferId','manifestDigest','checkpointId','index','offsetBytes'])&&common(row)&&nativeId(row.checkpointId)&&nativeInteger(row.index)&&nativeInteger(row.offsetBytes),'TRANSFER_READ_INVALID');}
export function parseInboundChunkUpload(value:unknown):Parsed<InboundChunkUpload>{
  return parsed(value,nativeObject(value,['schema','lineage','transferId','manifestDigest','checkpointId','index','offsetBytes','sizeBytes','chunkSha256','fileSha256','bytesBase64'],96*1024)&&parseOutboundChunk({...value as object,sourceHandle:'mobile-original-source'}).success,'TRANSFER_INBOUND_CHUNK_INVALID');
}
export function parseTransferChunkAck(value:unknown):Parsed<TransferChunkAck>{const row=value as any;return parsed(value,nativeObject(value,['schema','lineage','transferId','manifestDigest','checkpointId','index','chunkSha256','acknowledgedBytes'])&&common(row)&&nativeId(row.checkpointId)&&nativeInteger(row.index)&&nativeDigest(row.chunkSha256)&&nativeInteger(row.acknowledgedBytes),'TRANSFER_ACK_INVALID');}
export function parseReceiverCommit(value:unknown):Parsed<ReceiverCommit>{const row=value as any;return parsed(value,nativeObject(value,['schema','lineage','transferId','manifestDigest','checkpointId','sizeBytes','sha256','destinationHandle','commitId','committedAt'])&&common(row)&&nativeId(row.checkpointId)&&nativeInteger(row.sizeBytes,1)&&row.sizeBytes<=NATIVE_FILE_BYTES&&nativeDigest(row.sha256)&&nativeId(row.destinationHandle)&&nativeId(row.commitId)&&nativeTime(row.committedAt),'TRANSFER_COMMIT_INVALID');}
export function parseTransferControl(value:unknown):Parsed<TransferControl>{const row=value as any;return parsed(value,nativeObject(value,['schema','lineage','transferId','manifestDigest','checkpointId'])&&common(row)&&nativeId(row.checkpointId),'TRANSFER_CONTROL_INVALID');}
export function parseTransferResume(value:unknown):Parsed<TransferResume>{const row=value as any;return parsed(value,nativeObject(value,['schema','lineage','transferId','manifestDigest','checkpointId','completedChunkIndexes','acknowledgedBytes'])&&common(row)&&nativeId(row.checkpointId)&&nativeInteger(row.acknowledgedBytes)&&Array.isArray(row.completedChunkIndexes)&&row.completedChunkIndexes.length<=512&&row.completedChunkIndexes.every((v:any)=>nativeInteger(v))&&new Set(row.completedChunkIndexes).size===row.completedChunkIndexes.length,'TRANSFER_RESUME_INVALID');}
export function parseFilteredScope(value:unknown):Parsed<FilteredScopeRegistration>{const row=value as any;return parsed(value,nativeObject(value,['schema','producerLineage','liveViewId','leaseGeneration','scopeRef','privacyProfile','scopeDigest','approvedAt','expiresAt'])&&schema(row)&&nativeLineage(row.producerLineage)&&nativeId(row.liveViewId)&&nativeInteger(row.leaseGeneration,1)&&nativeId(row.scopeRef)&&row.privacyProfile==='window-public-region-v1'&&nativeDigest(row.scopeDigest)&&nativeTime(row.approvedAt)&&nativeTime(row.expiresAt),'LIVE_VIEW_PRIVACY_SCOPE_INVALID');}
export function parseFilteredFrame(value:unknown):Parsed<FilteredFrameUpload>{const row=value as any;return parsed(value,nativeObject(value,['schema','producerLineage','liveViewId','leaseGeneration','scopeRef','scopeDigest','frameId','sequence','observedAt','width','height','mediaType','sizeBytes','sha256','bytesBase64'],72*1024)&&schema(row)&&nativeLineage(row.producerLineage)&&nativeId(row.liveViewId)&&nativeInteger(row.leaseGeneration,1)&&nativeId(row.scopeRef)&&nativeDigest(row.scopeDigest)&&nativeId(row.frameId)&&nativeInteger(row.sequence,1)&&nativeTime(row.observedAt)&&nativeInteger(row.width,1)&&row.width<=1280&&nativeInteger(row.height,1)&&row.height<=720&&row.mediaType==='image/png'&&nativeInteger(row.sizeBytes,1)&&row.sizeBytes<=FILTERED_FRAME_BYTES&&nativeDigest(row.sha256)&&typeof row.bytesBase64==='string','LIVE_VIEW_FRAME_INVALID');}
