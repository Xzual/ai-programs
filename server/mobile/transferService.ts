import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  EDITH_CONTRACT_AMENDMENT,
  TASK_CONTRACT_VERSION,
  isSafeTransferFileNameV2,
  parseFileTransferDescriptorV2,
  type FileChunkManifestV2,
  type FileTransferDescriptorV2,
} from '../../src/edith/contracts';
import { sha256 } from './crypto';
import { MobileRegistryStore } from './registryStore';
import type { MobileSessionContext, MobileTransferRecord } from './types';
import type { DesktopProducerSession } from './desktopProducerService';
import { NATIVE_MOBILE_SCHEMA, canonicalNative, nativeManifestDigest, parseSourcePinManifest, parseOutboundChunk, parseTransferChunkRead, parseTransferChunkAck, parseReceiverCommit, parseTransferControl, parseTransferResume,
  type SourcePinManifest, type OutboundChunk, type TransferChunkRead, type TransferChunkAck, type ReceiverCommit, type TransferControl, type TransferResume, type TransferCheckpoint, type NativeLineage, type ReceiverPinRegistration,parseReceiverPinRegistration,parseSourcePinReapproval } from './nativeProducerContract';

const MAX_FILE_BYTES = 25 * 1024 * 1024;
// One canonical base64 byte field fits the existing encrypted plaintext ceiling.
const MAX_CHUNK_BYTES = 52 * 1024;
const MAX_CHUNKS = 512;
const ALLOWED_MEDIA = new Set(['text/plain', 'application/json', 'image/png', 'image/jpeg', 'application/pdf']);
function verifyMedia(buffer: Buffer, mediaType: string): boolean {
  if (mediaType === 'image/png') return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mediaType === 'image/jpeg') return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer.at(-2) === 0xff && buffer.at(-1) === 0xd9;
  if (mediaType === 'application/pdf') return buffer.subarray(0, 5).toString('ascii') === '%PDF-';
  if (mediaType === 'application/json') {
    try { JSON.parse(buffer.toString('utf8')); return true; } catch { return false; }
  }
  return !buffer.includes(0);
}

export class MobileTransferService {
  readonly inboxRoot: string;
  readAuthorityRecord(transferId:string):MobileTransferRecord|undefined{return this.store.getTransfer(transferId);}
  private readonly intents=new Map<string,{transferId:string;context:MobileSessionContext;expiresAt:string;sourceFileId?:string}>();

  constructor(private readonly store: MobileRegistryStore, dataDir: string,private readonly keyFingerprint?:(sessionId:string)=>string|undefined,private readonly authority?:(context:MobileSessionContext)=>void) {
    this.inboxRoot = path.resolve(dataDir, 'mobile-inbox');
    fs.mkdirSync(this.inboxRoot, { recursive: true });
  }

  create(context: MobileSessionContext, input: { fileName: string; mediaType: string; sizeBytes: number; sha256: string; manifest: FileChunkManifestV2; keyFingerprint: string }): FileTransferDescriptorV2 {
    this.assertCurrent(context,'file.upload');
    if (!isSafeTransferFileNameV2(input.fileName)) throw new Error('TRANSFER_FILENAME_INVALID');
    if (!ALLOWED_MEDIA.has(input.mediaType)) throw new Error('TRANSFER_MEDIA_TYPE_BLOCKED');
    if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 1 || input.sizeBytes > MAX_FILE_BYTES) throw new Error('TRANSFER_SIZE_LIMIT');
    if (input.manifest.sizeBytes !== input.sizeBytes || input.manifest.chunkSizeBytes > MAX_CHUNK_BYTES || input.manifest.totalChunks > MAX_CHUNKS
      || input.manifest.chunks.some(chunk=>chunk.sizeBytes>MAX_CHUNK_BYTES) || input.manifest.fileSha256.toLowerCase()!==input.sha256.toLowerCase()) throw new Error('TRANSFER_MANIFEST_LIMIT');
    const transferId = `transfer-${randomUUID()}`;
    const destinationHandle = `inbox-${randomUUID()}`;
    const now = new Date().toISOString();
    const descriptor: FileTransferDescriptorV2 = {
      contractVersion: TASK_CONTRACT_VERSION,
      amendment: EDITH_CONTRACT_AMENDMENT,
      transferId,
      fileName: input.fileName,
      mediaType: input.mediaType,
      sizeBytes: input.sizeBytes,
      sha256: input.sha256,
      direction: 'upload',
      status: 'pending',
      sourceDeviceId: context.device.device.deviceId,
      targetDeviceId: this.store.serverId(),
      chunkManifest: { ...input.manifest, transferId },
      encryption: {
        contractVersion: TASK_CONTRACT_VERSION,
        amendment: EDITH_CONTRACT_AMENDMENT,
        algorithm: 'AES-256-GCM',
        keyId: context.credential.sessionId,
        keyFingerprint: input.keyFingerprint,
        nonceStrategy: 'per_chunk_random',
        authenticated: true,
        aadContext: `mobile-transfer:${transferId}:${context.device.device.deviceId}`,
      },
      resume: {
        contractVersion: TASK_CONTRACT_VERSION,
        amendment: EDITH_CONTRACT_AMENDMENT,
        resumable: true,
        nextChunkIndex: 0,
        completedChunkIndexes: [],
        retryCount: 0,
        maxRetries: 5,
        acknowledgedBytes: 0,
        resumeCheckpointId: `resume-${randomUUID()}`,
      },
      destination: {
        contractVersion: TASK_CONTRACT_VERSION,
        amendment: EDITH_CONTRACT_AMENDMENT,
        handle: destinationHandle,
        scope: 'workspace',
        displayName: input.fileName,
        overwritePolicy: 'reject',
        createdAt: now,
      },
      createdAt: now,
      updatedAt: now,
    };
    const parsed = parseFileTransferDescriptorV2(descriptor);
    if (parsed.success === false) throw new Error(parsed.errorCode);
    const internalDirectory = path.join(this.inboxRoot, destinationHandle);
    fs.mkdirSync(internalDirectory, { recursive: false });
    this.store.saveTransfer({ descriptor: parsed.value, deviceId: context.device.device.deviceId, sessionId: context.credential.sessionId, destinationHandle, completedChunkIndexes: [], createdAt: now, updatedAt: now,
      nativeTransfer:{schema:NATIVE_MOBILE_SCHEMA,lineage:this.lineage(context,false),originalSessionId:context.credential.sessionId,originalGeneration:context.device.sessionGeneration??0,
        manifestDigest:nativeManifestDigest(parsed.value.chunkManifest!),checkpointId:parsed.value.resume!.resumeCheckpointId!,expiresAt:this.deadline(context),outboundAvailableIndexes:[],receiverAckIndexes:[]} });
    return parsed.value;
  }

  acceptChunk(context: MobileSessionContext, transferId: string, index: number, dataBase64: string): FileTransferDescriptorV2 {
    const record = this.requireTransfer(context, transferId);
    if(record.descriptor.direction!=='upload')throw Error('TRANSFER_DIRECTION_MISMATCH');
    if(['cancelled','failed'].includes(record.descriptor.status))throw Error('TRANSFER_ALREADY_TERMINAL');
    if (record.descriptor.status === 'completed') throw new Error('TRANSFER_ALREADY_COMPLETED');
    const manifest = record.descriptor.chunkManifest!;
    const chunk = manifest.chunks.find((item) => item.index === index);
    if (!chunk) throw new Error('TRANSFER_CHUNK_INDEX_INVALID');
    if (record.completedChunkIndexes.includes(index)) throw new Error('TRANSFER_CHUNK_REPLAYED');
    if (typeof dataBase64!=='string'||dataBase64.length>Math.ceil(MAX_CHUNK_BYTES/3)*4||!/^[A-Za-z0-9+/]*={0,2}$/.test(dataBase64)) throw new Error('TRANSFER_CHUNK_ENCODING_INVALID');
    const data = Buffer.from(dataBase64, 'base64');
    if(data.toString('base64')!==dataBase64)throw new Error('TRANSFER_CHUNK_ENCODING_INVALID');
    if (data.length !== chunk.sizeBytes || data.length > MAX_CHUNK_BYTES || sha256(data) !== chunk.sha256.toLowerCase()) throw new Error('TRANSFER_CHUNK_CHECKSUM_MISMATCH');
    this.writeDurable(path.join(this.directory(record), `${index}.chunk`), data);
    record.completedChunkIndexes.push(index);
    record.completedChunkIndexes.sort((a, b) => a - b);
    record.updatedAt = new Date().toISOString();
    const acknowledgedBytes = record.completedChunkIndexes.reduce((sum, completed) => sum + manifest.chunks[completed].sizeBytes, 0);
    record.descriptor.status = 'transferring';
    record.descriptor.updatedAt = record.updatedAt;
    record.descriptor.resume = { ...record.descriptor.resume!, completedChunkIndexes: [...record.completedChunkIndexes], nextChunkIndex: this.firstMissing(manifest.totalChunks, record.completedChunkIndexes), acknowledgedBytes, lastAttemptAt: record.updatedAt };
    if(record.nativeTransfer)this.advance(record);
    // Persist the durable chunk before whole-file verification, so a failed final
    // flush/check remains resumable against the original manifest.
    this.store.saveTransfer(record);
    if (record.completedChunkIndexes.length === manifest.totalChunks) { this.finalize(record); this.store.saveTransfer(record); }
    return record.descriptor;
  }

  status(context: MobileSessionContext, transferId: string): FileTransferDescriptorV2 {
    return this.requireTransfer(context, transferId).descriptor;
  }

  private finalize(record: MobileTransferRecord): void {
    const manifest = record.descriptor.chunkManifest!;
    const directory = this.directory(record);
    const content = Buffer.concat(manifest.chunks.map((chunk) => fs.readFileSync(path.join(directory, `${chunk.index}.chunk`))));
    if (content.length !== record.descriptor.sizeBytes || sha256(content) !== record.descriptor.sha256.toLowerCase()) throw new Error('TRANSFER_FILE_CHECKSUM_MISMATCH');
    if (!verifyMedia(content, record.descriptor.mediaType)) throw new Error('TRANSFER_MEDIA_SIGNATURE_MISMATCH');
    const completed = path.join(directory, 'payload.bin');
    this.writeDurable(completed, content);
    // Backend bytes are staging only; approved native destination commit is separate.
    record.descriptor.status = 'transferring';
    record.descriptor.updatedAt = new Date().toISOString();
    if(record.nativeTransfer)record.nativeTransfer.stagedVerifiedAt=record.descriptor.updatedAt;
  }

  createOutboundIntent(context:MobileSessionContext,idempotencyKey:string,sourceFileId?:string):{transferId:string;expiresAt:string} {
    this.assertCurrent(context,'file.download');
    if(!/^[A-Za-z0-9._:-]{1,160}$/.test(idempotencyKey))throw Error('TRANSFER_IDEMPOTENCY_INVALID');
    const key=`${context.credential.deviceId}:${context.device.ownerBinding.ownerSessionId}:${idempotencyKey}`;
    const prior=this.intents.get(key);
    if(prior){if(prior.sourceFileId!==sourceFileId||prior.context.credential.sessionId!==context.credential.sessionId)throw Error('TRANSFER_IDEMPOTENCY_CONFLICT');if(Date.parse(prior.expiresAt)<=Date.now())throw Error('TRANSFER_EXPIRED');return {transferId:prior.transferId,expiresAt:prior.expiresAt};}
    if(this.intents.size>=512)throw Error('TRANSFER_INTENT_LIMIT');
    const intent={transferId:`transfer-${randomUUID()}`,context,expiresAt:this.deadline(context),sourceFileId};this.intents.set(key,intent);return {transferId:intent.transferId,expiresAt:intent.expiresAt};
  }

  bindNativeOutbound(session:DesktopProducerSession,input:SourcePinManifest):FileTransferDescriptorV2 {
    const parsed=parseSourcePinManifest(input);if(parsed.success===false)throw Error(parsed.errorCode);
    const intent=[...this.intents.values()].find(row=>row.transferId===input.transferId);
    const existing=this.store.getTransfer(input.transferId);
    if(existing){this.requireCarrier(session,existing);if(existing.nativeTransfer?.manifestDigest!==input.manifestDigest||existing.nativeTransfer.sourceHandle!==input.sourceHandle||existing.nativeTransfer.sourceIdentityDigest!==input.sourceIdentityDigest||existing.nativeTransfer.sourceGeneration!==input.sourceGeneration||existing.nativeTransfer.expiresAt!==input.expiresAt||existing.descriptor.fileName!==input.fileName||existing.descriptor.mediaType!==input.mediaType||canonicalNative(existing.nativeTransfer.lineage)!==canonicalNative(input.lineage))throw Error('TRANSFER_IDEMPOTENCY_CONFLICT');return existing.descriptor;}
    if(!intent)throw Error('TRANSFER_SOURCE_INTENT_REQUIRED');
    const context=intent.context;this.assertCurrent(context,'file.download');this.assertProducerContext(session,context);
    this.assertPinCapacity(session,input.transferId);
    if(canonicalNative(input.lineage)!==canonicalNative(this.lineage(context,true))||Date.parse(input.expiresAt)>Math.min(Date.parse(intent.expiresAt),Date.parse(session.expiresAt))||Date.parse(input.expiresAt)<=Date.now())throw Error('TRANSFER_SOURCE_SCOPE_MISMATCH');
    const now=new Date().toISOString(),handle=`inbox-${randomUUID()}`;
    const base=this.createDescriptor(context,input,handle,now);
    const record:MobileTransferRecord={descriptor:base,deviceId:context.credential.deviceId,sessionId:context.credential.sessionId,destinationHandle:handle,completedChunkIndexes:[],createdAt:now,updatedAt:now,nativeTransfer:{schema:NATIVE_MOBILE_SCHEMA,lineage:input.lineage,originalSessionId:context.credential.sessionId,originalGeneration:context.device.sessionGeneration??0,manifestDigest:input.manifestDigest,checkpointId:base.resume!.resumeCheckpointId!,expiresAt:input.expiresAt,sourceHandle:input.sourceHandle,sourceIdentityDigest:input.sourceIdentityDigest,sourceGeneration:input.sourceGeneration,outboundAvailableIndexes:[],receiverAckIndexes:[],sourceFileId:intent.sourceFileId}};
    fs.mkdirSync(this.directory(record),{recursive:false});this.store.saveTransfer(record);return base;
  }

  /** Only the existing authenticated native producer route may call this constructor. */
  reapproveNativePin(session:DesktopProducerSession,input:SourcePinManifest & {checkpointId:string}):TransferCheckpoint {
    const reapproval=parseSourcePinReapproval(input);if(reapproval.success===false)throw Error(reapproval.errorCode);
    const {checkpointId,...source}=input;
    const parsed=parseSourcePinManifest(source);if(parsed.success===false)throw Error(parsed.errorCode);
    const record=this.record(source.transferId),state=record.nativeTransfer!;
    if(record.descriptor.direction!=='download'||['completed','cancelled','failed'].includes(record.descriptor.status))throw Error('TRANSFER_ALREADY_TERMINAL');
    if(Date.parse(state.expiresAt)<=Date.now())throw Error('TRANSFER_EXPIRED');
    const device=this.store.getDevice(record.deviceId),credential=this.store.listCredentials().find(row=>row.deviceId===record.deviceId&&row.sessionId===session.sessionId&&!row.revokedAt&&Date.parse(row.expiresAt)>Date.now());
    if(!device||!credential)throw Error('TRANSFER_AUTHORITY_INVALID');
    const context={device,credential};this.assertCurrent(context,'file.download');this.assertProducerContext(session,context);
    this.assertPinCapacity(session,source.transferId);
    if(state.lineage.ownerSessionBindingId!==device.ownerBinding.ownerSessionId||state.lineage.workspaceId!==credential.workspaceId
      ||source.manifestDigest!==state.manifestDigest||checkpointId!==state.checkpointId||source.sourceIdentityDigest!==state.sourceIdentityDigest
      ||source.fileName!==record.descriptor.fileName||source.mediaType!==record.descriptor.mediaType||source.expiresAt!==state.expiresAt
      ||Date.parse(session.expiresAt)<Date.parse(source.expiresAt)||canonicalNative(source.lineage)!==canonicalNative(this.lineage(context,true)))throw Error('TRANSFER_REAPPROVAL_SCOPE_MISMATCH');
    const previousGeneration=state.boundGeneration??state.originalGeneration,currentGeneration=device.sessionGeneration??0;
    const exactReplay=record.sessionId===credential.sessionId&&state.sourceHandle===source.sourceHandle&&state.sourceGeneration===source.sourceGeneration;
    if(exactReplay){this.requireCarrier(session,record);return this.checkpointFor(record);}
    if(currentGeneration<previousGeneration||record.sessionId!==credential.sessionId&&currentGeneration<=previousGeneration
      ||source.sourceGeneration<=(state.sourceGeneration??0))throw Error('TRANSFER_REAPPROVAL_GENERATION_MISMATCH');
    // Repin never creates a second transfer/destination or trusts claimed progress.
    for(const index of state.outboundAvailableIndexes)this.readDiskChunk(record,index);
    const fingerprint=this.keyFingerprint?.(credential.sessionId);if(!fingerprint)throw Error('SESSION_CRYPTO_CONFIGURATION_REQUIRED');
    state.lineage=this.lineage(context,true);state.boundGeneration=currentGeneration;state.sourceHandle=source.sourceHandle;state.sourceGeneration=source.sourceGeneration;
    record.sessionId=credential.sessionId;record.descriptor.encryption={...record.descriptor.encryption!,keyId:credential.sessionId,keyFingerprint:fingerprint};
    record.updatedAt=new Date().toISOString();record.descriptor.updatedAt=record.updatedAt;
    this.assertCurrent(context,'file.download');this.store.saveTransfer(record);return this.checkpointFor(record);
  }

  registerReceiverPin(session:DesktopProducerSession,input:ReceiverPinRegistration):TransferCheckpoint {
    const parsed=parseReceiverPinRegistration(input);if(parsed.success===false)throw Error(parsed.errorCode);
    const record=this.record(input.transferId),state=record.nativeTransfer!;
    if(record.descriptor.direction!=='upload'||['completed','cancelled','failed'].includes(record.descriptor.status))throw Error('TRANSFER_ALREADY_TERMINAL');
    if(Date.parse(state.expiresAt)<=Date.now())throw Error('TRANSFER_EXPIRED');
    const device=this.store.getDevice(record.deviceId),credential=this.store.listCredentials().find(row=>row.deviceId===record.deviceId&&row.sessionId===session.sessionId&&!row.revokedAt&&Date.parse(row.expiresAt)>Date.now());
    if(!device||!credential)throw Error('TRANSFER_AUTHORITY_INVALID');
    const context={device,credential};this.assertCurrent(context,'file.upload');this.assertProducerContext(session,context);this.assertPinCapacity(session,input.transferId);
    if(state.lineage.ownerSessionBindingId!==device.ownerBinding.ownerSessionId||state.lineage.workspaceId!==credential.workspaceId
      ||input.manifestDigest!==state.manifestDigest||input.checkpointId!==state.checkpointId||input.expiresAt!==state.expiresAt||Date.parse(session.expiresAt)<Date.parse(state.expiresAt)
      ||state.destinationHandle!==undefined&&state.destinationHandle!==input.destinationHandle||canonicalNative(input.lineage)!==canonicalNative(this.lineage(context,false)))throw Error('TRANSFER_RECEIVER_PIN_SCOPE_MISMATCH');
    const previousGeneration=state.boundGeneration??state.originalGeneration,currentGeneration=device.sessionGeneration??0;
    const exactReplay=record.sessionId===credential.sessionId&&state.receiverGeneration===input.receiverGeneration&&state.destinationHandle===input.destinationHandle;
    if(exactReplay){this.requireCarrier(session,record);return this.checkpointFor(record);}
    if(currentGeneration<previousGeneration||record.sessionId!==credential.sessionId&&currentGeneration<=previousGeneration||input.receiverGeneration<=(state.receiverGeneration??0))throw Error('TRANSFER_RECEIVER_PIN_GENERATION_MISMATCH');
    for(const index of record.completedChunkIndexes)this.readDiskChunk(record,index);
    const fingerprint=this.keyFingerprint?.(credential.sessionId);if(!fingerprint)throw Error('SESSION_CRYPTO_CONFIGURATION_REQUIRED');
    state.lineage=this.lineage(context,false);state.boundGeneration=currentGeneration;state.receiverGeneration=input.receiverGeneration;state.destinationHandle=input.destinationHandle;state.receiverPinnedAt=new Date().toISOString();
    record.sessionId=credential.sessionId;record.descriptor.encryption={...record.descriptor.encryption!,keyId:credential.sessionId,keyFingerprint:fingerprint};record.updatedAt=new Date().toISOString();record.descriptor.updatedAt=record.updatedAt;
    this.assertCurrent(context,'file.upload');this.store.saveTransfer(record);return this.checkpointFor(record);
  }

  private assertPinCapacity(session:DesktopProducerSession,transferId:string):void {
    const active=this.store.listTransfers().filter(row=>row.descriptor.transferId!==transferId&&!['completed','cancelled','failed'].includes(row.descriptor.status)&&row.nativeTransfer&&Date.parse(row.nativeTransfer.expiresAt)>Date.now()&&(row.nativeTransfer.sourceHandle||row.nativeTransfer.receiverPinnedAt));
    if(active.length>=16||active.filter(row=>row.nativeTransfer!.lineage.ownerSessionBindingId===session.ownerSessionBindingId&&row.nativeTransfer!.lineage.workspaceId===session.workspaceId&&row.sessionId===session.sessionId).length>=4)throw Error('TRANSFER_NATIVE_PIN_LIMIT');
  }

  putOutboundChunk(session:DesktopProducerSession,input:OutboundChunk):TransferCheckpoint {
    const parsed=parseOutboundChunk(input);if(parsed.success===false)throw Error(parsed.errorCode);
    const record=this.record(input.transferId);this.requireCarrier(session,record);this.requireControl(record,input);
    if(record.descriptor.direction!=='download'||input.sourceHandle!==record.nativeTransfer!.sourceHandle)throw Error('TRANSFER_DIRECTION_MISMATCH');
    this.checkChunk(record,input);this.writeDurable(path.join(this.directory(record),`${input.index}.chunk`),Buffer.from(input.bytesBase64,'base64'));
    const available=record.nativeTransfer!.outboundAvailableIndexes;if(!available.includes(input.index)){available.push(input.index);available.sort((a,b)=>a-b);}
    if(available.length===record.descriptor.chunkManifest!.totalChunks)this.verifyWhole(record);
    this.store.saveTransfer(record);return this.checkpointFor(record);
  }

  readOutboundChunk(context:MobileSessionContext,transferId:string,input:TransferChunkRead):OutboundChunk {
    const record=this.record(transferId);this.requireCarrier(context,record);if(record.descriptor.direction!=='download')throw Error('TRANSFER_DIRECTION_MISMATCH');return this.readChunk(record,input,false);
  }

  readStagedInbound(session:DesktopProducerSession,transferId:string,input:TransferChunkRead):OutboundChunk {
    const record=this.record(transferId);this.requireCarrier(session,record);if(record.descriptor.direction!=='upload'||!record.nativeTransfer?.stagedVerifiedAt)throw Error('TRANSFER_STAGING_NOT_READY');if(!record.nativeTransfer.receiverPinnedAt)throw Error('TRANSFER_RECEIVER_PIN_REQUIRED');return this.readChunk(record,input,true);
  }

  ackReceiver(context:MobileSessionContext,input:TransferChunkAck):TransferCheckpoint {
    const parsed=parseTransferChunkAck(input);if(parsed.success===false)throw Error(parsed.errorCode);
    const record=this.record(input.transferId);this.requireCarrier(context,record);
    if(record.descriptor.direction!=='download')throw Error('TRANSFER_DIRECTION_MISMATCH');
    const state=record.nativeTransfer!,manifest=record.descriptor.chunkManifest!,chunk=manifest.chunks[input.index];
    const duplicate=state.receiverAckIndexes.includes(input.index);
    this.requireControl(record,input,duplicate);
    if(!chunk||chunk.sha256!==input.chunkSha256||!state.outboundAvailableIndexes.includes(input.index))throw Error('TRANSFER_ACK_MISMATCH');
    this.readDiskChunk(record,input.index);
    const next=duplicate?state.receiverAckIndexes:[...state.receiverAckIndexes,input.index].sort((a,b)=>a-b);
    const bytes=next.reduce((sum,index)=>sum+manifest.chunks[index].sizeBytes,0);
    if(input.acknowledgedBytes!==bytes)throw Error('TRANSFER_ACK_MISMATCH');
    if(!duplicate){state.receiverAckIndexes=next;this.advance(record);this.store.saveTransfer(record);}
    return this.checkpointFor(record);
  }

  commitReceiver(carrier:MobileSessionContext|DesktopProducerSession,transferId:string,input:ReceiverCommit):FileTransferDescriptorV2 {
    const parsed=parseReceiverCommit(input);if(parsed.success===false)throw Error(parsed.errorCode);
    const record=this.record(transferId);this.requireCarrier(carrier,record,true);
    const state=record.nativeTransfer!;
    if(('credential' in carrier)!==(record.descriptor.direction==='download'))throw Error('TRANSFER_DIRECTION_MISMATCH');
    if(state.receiverCommit){if(canonicalNative(state.receiverCommit)!==canonicalNative(input))throw Error('TRANSFER_COMMIT_CONFLICT');return record.descriptor;}
    if(['cancelled','failed'].includes(record.descriptor.status))throw Error('TRANSFER_ALREADY_TERMINAL');
    this.requireControl(record,input);
    if(record.descriptor.direction==='upload'&&(!state.receiverPinnedAt||input.destinationHandle!==state.destinationHandle))throw Error('TRANSFER_RECEIVER_PIN_REQUIRED');
    if(input.sizeBytes!==record.descriptor.sizeBytes||input.sha256!==record.descriptor.sha256||Date.parse(input.committedAt)>Date.now()+2000||Date.parse(input.committedAt)<Date.parse(record.createdAt))throw Error('TRANSFER_COMMIT_MISMATCH');
    if(record.descriptor.direction==='download'&&state.receiverAckIndexes.length!==record.descriptor.chunkManifest!.totalChunks||record.descriptor.direction==='upload'&&!state.stagedVerifiedAt)throw Error('TRANSFER_COMMIT_INCOMPLETE');
    this.verifyWhole(record);this.requireCarrier(carrier,record);
    state.receiverCommit=input;state.destinationHandle=input.destinationHandle;record.descriptor.status='completed';record.descriptor.updatedAt=new Date().toISOString();this.store.saveTransfer(record);return record.descriptor;
  }

  checkpoint(carrier:MobileSessionContext|DesktopProducerSession,id:string):TransferCheckpoint {const record=this.record(id);this.requireCarrier(carrier,record,true);return this.checkpointFor(record);}
  cancel(carrier:MobileSessionContext|DesktopProducerSession,id:string,input?:TransferControl):TransferCheckpoint {
    const record=this.record(id);this.requireCarrier(carrier,record,true);if(input){const p=parseTransferControl(input);if(p.success===false)throw Error(p.errorCode);this.requireControl(record,input);}
    if(record.descriptor.status==='completed')throw Error('TRANSFER_ALREADY_COMPLETED');
    record.descriptor.status='cancelled';record.nativeTransfer!.cancelledAt=new Date().toISOString();this.store.saveTransfer(record);return this.checkpointFor(record);
  }
  rebind(context:MobileSessionContext,id:string,input:TransferResume):TransferCheckpoint {
    const p=parseTransferResume(input);if(p.success===false)throw Error(p.errorCode);const record=this.record(id),state=record.nativeTransfer!;
    this.assertCurrent(context,record.descriptor.direction==='upload'?'file.upload':'file.download');
    if(record.deviceId!==context.credential.deviceId||state.lineage.workspaceId!==context.credential.workspaceId||state.lineage.ownerSessionBindingId!==context.device.ownerBinding.ownerSessionId||Date.parse(state.expiresAt)<=Date.now()||record.descriptor.status==='cancelled')throw Error('TRANSFER_RESUME_SCOPE_MISMATCH');
    if(record.sessionId!==context.credential.sessionId||(state.boundGeneration??state.originalGeneration)!==(context.device.sessionGeneration??0))throw Error('TRANSFER_RESUME_REAUTH_REQUIRED');
    this.requireControl(record,input);
    const indexes=record.descriptor.direction==='upload'?record.completedChunkIndexes:state.receiverAckIndexes;
    for(const index of indexes)this.readDiskChunk(record,index);
    if(record.descriptor.direction==='upload'&&indexes.length===record.descriptor.chunkManifest!.totalChunks&&!state.stagedVerifiedAt){this.finalize(record);this.store.saveTransfer(record);}
    return this.checkpointFor(record);
  }
  invalidateOwner(bindingId:string):void {for(const record of this.store.listTransfers())if(record.nativeTransfer?.lineage.ownerSessionBindingId===bindingId&&record.descriptor.status!=='completed'){record.descriptor.status='cancelled';record.nativeTransfer.cancelledAt=new Date().toISOString();this.store.saveTransfer(record);}for(const [key,row] of this.intents)if(row.context.device.ownerBinding.ownerSessionId===bindingId)this.intents.delete(key);}
  invalidateSession(deviceId:string,sessionId:string):void {for(const [key,row] of this.intents)if(row.context.credential.deviceId===deviceId&&row.context.credential.sessionId===sessionId)this.intents.delete(key);}

  private record(id:string):MobileTransferRecord {const row=this.store.getTransfer(id);if(!row?.nativeTransfer)throw Error('TRANSFER_NOT_FOUND');this.directory(row);return row;}
  private deadline(c:MobileSessionContext):string{return new Date(Math.min(Date.parse(c.credential.expiresAt),Date.parse(c.device.ownerBinding.expiresAt),Date.parse(c.device.trust.expiresAt??''),Date.now()+15*60_000)).toISOString();}
  private lineage(c:MobileSessionContext,outbound:boolean):NativeLineage{return {contractVersion:TASK_CONTRACT_VERSION,amendment:EDITH_CONTRACT_AMENDMENT,ownerSessionBindingId:c.device.ownerBinding.ownerSessionId,workspaceId:c.credential.workspaceId,sessionId:c.credential.sessionId,sourceDeviceId:outbound?this.store.serverId():c.credential.deviceId,targetDeviceId:outbound?c.credential.deviceId:this.store.serverId()};}
  private assertCurrent(c:MobileSessionContext,command:'file.upload'|'file.download'):void {
    this.authority?.(c);
    const credential=this.store.getCredential(c.credential.credentialId),device=this.store.getDevice(c.credential.deviceId);
    if(!credential||!device||![credential.expiresAt,device.ownerBinding.expiresAt,device.trust.expiresAt].every(value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&Date.parse(value)>Date.now())
      ||device.device.deviceId!==credential.deviceId||device.trust.deviceId!==credential.deviceId||device.ownerBinding.deviceId!==credential.deviceId
      ||device.trust.workspaceId!==credential.workspaceId||device.ownerBinding.workspaceId!==credential.workspaceId||device.trust.fingerprint!==device.device.fingerprint||device.ownerBinding.deviceFingerprint!==device.trust.fingerprint
      ||device.trust.reconnectCredentialId!==credential.credentialId||device.trust.reconnectCredentialFingerprint!==credential.credentialFingerprint)throw Error('TRANSFER_AUTHORITY_INVALID');
    if(!credential||credential.revokedAt||credential.sessionId!==c.credential.sessionId||Date.parse(credential.expiresAt)<=Date.now()||!device||device.trust.status!=='trusted'||device.ownerBinding.status!=='active'||Date.parse(device.ownerBinding.expiresAt)<=Date.now()||Date.parse(device.trust.expiresAt??'')<=Date.now()||device.ownerBinding.ownerSessionId!==c.device.ownerBinding.ownerSessionId||!device.allowedCommands.includes(command)||(device.sessionGeneration??0)!==(c.device.sessionGeneration??0)||credential.deviceId!==c.credential.deviceId||credential.workspaceId!==c.credential.workspaceId)throw Error('TRANSFER_AUTHORITY_INVALID');
  }
  private assertProducerContext(p:DesktopProducerSession,c:MobileSessionContext):void {if(p.ownerSessionBindingId!==c.device.ownerBinding.ownerSessionId||p.workspaceId!==c.credential.workspaceId||p.sessionId!==c.credential.sessionId||p.sourceDeviceId!==this.store.serverId()||p.targetDeviceId!==c.credential.deviceId||Date.parse(p.expiresAt)<=Date.now())throw Error('TRANSFER_PRODUCER_SCOPE_MISMATCH');}
  private requireCarrier(carrier:MobileSessionContext|DesktopProducerSession,record:MobileTransferRecord,terminal=false):void {
    const state=record.nativeTransfer!;
    if(!state||Date.parse(state.expiresAt)<=Date.now())throw Error('TRANSFER_EXPIRED');
    if(!terminal&&['cancelled','failed','completed'].includes(record.descriptor.status))throw Error('TRANSFER_ALREADY_TERMINAL');
    if('credential' in carrier){this.assertCurrent(carrier,record.descriptor.direction==='upload'?'file.upload':'file.download');if(carrier.credential.deviceId!==record.deviceId||carrier.credential.sessionId!==record.sessionId||carrier.credential.workspaceId!==state.lineage.workspaceId||carrier.device.ownerBinding.ownerSessionId!==state.lineage.ownerSessionBindingId||(carrier.device.sessionGeneration??0)!==(state.boundGeneration??state.originalGeneration))throw Error('TRANSFER_NOT_FOUND');}
    else {const device=this.store.getDevice(record.deviceId),credential=this.store.listCredentials().find(c=>c.deviceId===record.deviceId&&c.sessionId===record.sessionId&&!c.revokedAt&&Date.parse(c.expiresAt)>Date.now());if(!device||!credential)throw Error('TRANSFER_AUTHORITY_INVALID');this.assertCurrent({device,credential},record.descriptor.direction==='upload'?'file.upload':'file.download');this.assertProducerContext(carrier,{device,credential});if((device.sessionGeneration??0)!==(state.boundGeneration??state.originalGeneration))throw Error('TRANSFER_GENERATION_MISMATCH');}
  }
  private requireControl(record:MobileTransferRecord,input:TransferControl|TransferChunkRead|TransferChunkAck|ReceiverCommit,duplicate=false):void {const s=record.nativeTransfer!;if(input.transferId!==record.descriptor.transferId||input.manifestDigest!==s.manifestDigest||canonicalNative(input.lineage)!==canonicalNative(s.lineage)||input.checkpointId!==s.checkpointId&&(!duplicate||input.checkpointId!==s.previousCheckpointId))throw Error('TRANSFER_CHECKPOINT_MISMATCH');}
  private advance(record:MobileTransferRecord):void {const s=record.nativeTransfer!;s.previousCheckpointId=s.checkpointId;s.checkpointId=`resume-${randomUUID()}`;record.descriptor.status='transferring';const c=this.checkpointFor(record);record.descriptor.resume={...record.descriptor.resume!,completedChunkIndexes:c.completedChunkIndexes,nextChunkIndex:c.nextChunkIndex,acknowledgedBytes:c.acknowledgedBytes,resumeCheckpointId:c.checkpointId};}
  private checkpointFor(record:MobileTransferRecord):TransferCheckpoint {const s=record.nativeTransfer!,m=record.descriptor.chunkManifest!,indexes=record.descriptor.direction==='download'?s.receiverAckIndexes:record.completedChunkIndexes;return {schema:NATIVE_MOBILE_SCHEMA,transferId:record.descriptor.transferId,manifestDigest:s.manifestDigest,checkpointId:s.checkpointId,completedChunkIndexes:[...indexes],acknowledgedBytes:indexes.reduce((sum,index)=>sum+m.chunks[index].sizeBytes,0),nextChunkIndex:this.firstMissing(m.totalChunks,indexes),expiresAt:s.expiresAt,status:record.descriptor.status};}
  private checkChunk(record:MobileTransferRecord,input:OutboundChunk):void {const c=record.descriptor.chunkManifest!.chunks[input.index];if(!c||c.offsetBytes!==input.offsetBytes||c.sizeBytes!==input.sizeBytes||c.sha256!==input.chunkSha256||record.descriptor.sha256!==input.fileSha256)throw Error('TRANSFER_CHUNK_CHECKSUM_MISMATCH');}
  private readDiskChunk(record:MobileTransferRecord,index:number):Buffer {const c=record.descriptor.chunkManifest!.chunks[index];if(!c)throw Error('TRANSFER_CHUNK_INDEX_INVALID');const f=path.join(this.directory(record),`${index}.chunk`),stat=fs.lstatSync(f);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1)throw Error('TRANSFER_DURABLE_INVALID');const bytes=fs.readFileSync(f);if(bytes.length!==c.sizeBytes||sha256(bytes)!==c.sha256)throw Error('TRANSFER_CHUNK_CHECKSUM_MISMATCH');return bytes;}
  private verifyWhole(record:MobileTransferRecord):void {const bytes=Buffer.concat(record.descriptor.chunkManifest!.chunks.map(c=>this.readDiskChunk(record,c.index)));if(bytes.length!==record.descriptor.sizeBytes||sha256(bytes)!==record.descriptor.sha256)throw Error('TRANSFER_FILE_CHECKSUM_MISMATCH');if(!verifyMedia(bytes,record.descriptor.mediaType))throw Error('TRANSFER_MEDIA_SIGNATURE_MISMATCH');}
  private readChunk(record:MobileTransferRecord,input:TransferChunkRead,inbound:boolean):OutboundChunk {const p=parseTransferChunkRead(input);if(p.success===false)throw Error(p.errorCode);this.requireControl(record,input);const chunk=record.descriptor.chunkManifest!.chunks[input.index];if(!chunk||chunk.offsetBytes!==input.offsetBytes||!inbound&&!record.nativeTransfer!.outboundAvailableIndexes.includes(input.index))throw Error('TRANSFER_CHUNK_NOT_READY');const bytes=this.readDiskChunk(record,input.index);return {...input,sourceHandle:record.nativeTransfer!.sourceHandle??record.destinationHandle,sizeBytes:chunk.sizeBytes,chunkSha256:chunk.sha256,fileSha256:record.descriptor.sha256,bytesBase64:bytes.toString('base64')};}
  private createDescriptor(context:MobileSessionContext,input:SourcePinManifest,handle:string,now:string):FileTransferDescriptorV2 {const d:FileTransferDescriptorV2={contractVersion:TASK_CONTRACT_VERSION,amendment:EDITH_CONTRACT_AMENDMENT,transferId:input.transferId,fileName:input.fileName,mediaType:input.mediaType,sizeBytes:input.manifest.sizeBytes,sha256:input.manifest.fileSha256,direction:'download',status:'pending',sourceDeviceId:this.store.serverId(),targetDeviceId:context.credential.deviceId,chunkManifest:input.manifest,encryption:{contractVersion:TASK_CONTRACT_VERSION,amendment:EDITH_CONTRACT_AMENDMENT,algorithm:'AES-256-GCM',keyId:context.credential.sessionId,keyFingerprint:this.keyFingerprint?.(context.credential.sessionId)??(()=>{throw Error('SESSION_CRYPTO_CONFIGURATION_REQUIRED');})(),nonceStrategy:'per_chunk_random',authenticated:true,aadContext:`mobile-transfer:${input.transferId}:${context.credential.deviceId}`},resume:{contractVersion:TASK_CONTRACT_VERSION,amendment:EDITH_CONTRACT_AMENDMENT,resumable:true,nextChunkIndex:0,completedChunkIndexes:[],retryCount:0,maxRetries:5,acknowledgedBytes:0,resumeCheckpointId:`resume-${randomUUID()}`},destination:{contractVersion:TASK_CONTRACT_VERSION,amendment:EDITH_CONTRACT_AMENDMENT,handle,scope:'workspace',displayName:input.fileName,overwritePolicy:'reject',createdAt:now},createdAt:now,updatedAt:now};const p=parseFileTransferDescriptorV2(d);if(p.success===false)throw Error(p.errorCode);return p.value;}

  private writeDurable(file: string, bytes: Buffer): void {
    let fd: number;
    try { fd=fs.openSync(file,'wx',0o600); }
    catch(error){
      if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
      const stat=fs.lstatSync(file);
      if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||!fs.readFileSync(file).equals(bytes))throw new Error('TRANSFER_DURABLE_COLLISION');
      fd=fs.openSync(file,'r+');
    }
    try {
      if(fs.fstatSync(fd).size===0){let offset=0;while(offset<bytes.length){const written=fs.writeSync(fd,bytes,offset,bytes.length-offset,offset);if(written<=0)throw Error('TRANSFER_DURABLE_WRITE_FAILED');offset+=written;}}
      fs.fsyncSync(fd);
      if(fs.fstatSync(fd).size!==bytes.length)throw new Error('TRANSFER_DURABLE_SIZE_MISMATCH');
    }finally{fs.closeSync(fd);}
  }

  private firstMissing(total: number, completed: number[]): number {
    const set = new Set(completed);
    for (let index = 0; index < total; index += 1) if (!set.has(index)) return index;
    return total;
  }

  private requireTransfer(context: MobileSessionContext, transferId: string): MobileTransferRecord {
    const record = this.store.getTransfer(transferId);
    if (!record || record.deviceId !== context.device.device.deviceId || record.sessionId !== context.credential.sessionId) throw new Error('TRANSFER_NOT_FOUND');
    if(record.nativeTransfer)this.requireCarrier(context,record,true);
    this.directory(record);
    return record;
  }

  private directory(record: MobileTransferRecord): string {
    const resolved = path.resolve(this.inboxRoot, record.destinationHandle);
    if (path.dirname(resolved) !== this.inboxRoot || path.basename(resolved) !== record.destinationHandle) throw new Error('TRANSFER_DESTINATION_INVALID');
    return resolved;
  }
}
