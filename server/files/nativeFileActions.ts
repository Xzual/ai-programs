import { randomUUID, createHash } from 'node:crypto';
import { FileService, FileServiceError } from './fileService';

export interface NativeFileOpenReceipt {
  operationId: string;
  fileId: string;
  ownerBindingId: string;
  source: 'native_operator';
  openedProcessId: number;
  verifiedProcessId: number;
  contentSha256: string;
  postcondition: 'same_file_opened';
}

/** This is an internal authenticated native transport, never a caller receipt. */
export interface NativeFileOpenAdapter {
  open(request: { operationId: string; fileId: string; ownerBindingId: string; contentSha256: string },
    authorize: () => void): Promise<NativeFileOpenReceipt>;
}

type OpenRequest = Parameters<NativeFileOpenAdapter['open']>[0];
type PendingOpen = { request: OpenRequest; service: FileService; authorize: () => void;
  expiresAt: number; claimed: boolean; resolve: (receipt: NativeFileOpenReceipt) => void;
  reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
export interface NativeTransferPinRequest {
  operation: 'transfer_pin'; operationId: string; fileId: string; ownerBindingId: string;
  transferId: string; targetDeviceId: string; expiresAt: string; claimNonce: string;
  sourceIdentityDigest: string; contentSha256: string;
}
export interface NativeTransferPinReceipt {
  operation: 'transfer_pin'; operationId: string; fileId: string; ownerBindingId: string;
  transferId: string; targetDeviceId: string; claimNonce: string; sourceIdentityDigest: string;
  source: 'native_operator'; sourceHandle: string; contentSha256: string;
  sourceManifest: unknown;
}
type PendingPin = Omit<PendingOpen,'request'|'resolve'> & {
  request: NativeTransferPinRequest; resolve: (receipt: NativeTransferPinReceipt) => void;
};
const pending = new Map<string, PendingOpen | PendingPin>();
let nativePollAt = 0;
const TRANSPORT_TTL = 15_000;
export function nativeFileOpenAvailable(){return nativePollAt>0 && Date.now()-nativePollAt<=TRANSPORT_TTL;}

function jobFor(operationId: string): PendingOpen | PendingPin {
  const job = pending.get(operationId);
  if (!job || job.expiresAt <= Date.now()) throw new FileServiceError('FILES_NATIVE_JOB_EXPIRED',409);
  job.authorize();
  if ('operation' in job.request) {
    const snapshot = job.service.resolveExplorerFile(job.request.fileId).file;
    const identity = createHash('sha256').update(snapshot.identity).update('\0').update(snapshot.contentSha256).digest('hex');
    if(snapshot.contentSha256 !== job.request.contentSha256 || identity !== job.request.sourceIdentityDigest)throw new FileServiceError('FILE_CHANGED',409);
  } else {
    const source = job.service.resolveNativeFile(job.request.fileId);
    if (source.contentSha256 !== job.request.contentSha256) throw new FileServiceError('FILE_CHANGED',409);
  }
  return job;
}

/** Enqueues an exact safe Files ID in the existing private native-files poller. */
export function requestNativeTransferPin(service: FileService, request: Omit<NativeTransferPinRequest,'operationId'|'operation'|'claimNonce'|'sourceIdentityDigest'|'contentSha256'>,
  authorize: () => void): Promise<NativeTransferPinReceipt> {
  authorize();
  if(!nativeFileOpenAvailable())throw new FileServiceError('FILES_PC_TO_MOBILE_BYTE_ADAPTER_UNAVAILABLE',501);
  if(pending.size>=8)throw new FileServiceError('FILES_NATIVE_QUEUE_FULL',429);
  const snapshot=service.resolveExplorerFile(request.fileId).file;
  const deadline=Math.min(Date.parse(request.expiresAt),Date.now()+20_000);
  if(!Number.isFinite(deadline)||deadline<=Date.now())throw new FileServiceError('FILES_NATIVE_JOB_EXPIRED',409);
  const full:NativeTransferPinRequest={...request,operation:'transfer_pin',operationId:randomUUID(),claimNonce:randomUUID(),
    sourceIdentityDigest:createHash('sha256').update(snapshot.identity).update('\0').update(snapshot.contentSha256).digest('hex'),contentSha256:snapshot.contentSha256};
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{pending.delete(full.operationId);reject(new FileServiceError('FILES_NATIVE_TRANSFER_PIN_UNVERIFIED',504));},deadline-Date.now());timer.unref?.();
    pending.set(full.operationId,{request:full,service,authorize,expiresAt:deadline,claimed:false,resolve,reject,timer});
  });
}

/** Default production adapter: native polls authenticate with the private bridge token. */
export function defaultNativeFileOpenAdapter(service: FileService): NativeFileOpenAdapter {
  return { open: async (request, authorize) => {
    authorize();
    if (!nativeFileOpenAvailable()) throw new FileServiceError('FILES_NATIVE_OPEN_ADAPTER_UNAVAILABLE',501);
    if (pending.size >= 8) throw new FileServiceError('FILES_NATIVE_QUEUE_FULL',429);
    const source = service.resolveNativeFile(request.fileId);
    if (source.contentSha256 !== request.contentSha256) throw new FileServiceError('FILE_CHANGED',409);
    return new Promise<NativeFileOpenReceipt>((resolve,reject) => {
      const timer = setTimeout(() => { pending.delete(request.operationId); reject(new FileServiceError('FILES_NATIVE_OPEN_UNVERIFIED',504)); },20_000);
      timer.unref?.();
      pending.set(request.operationId,{request,service,authorize,expiresAt:Date.now()+20_000,claimed:false,resolve,reject,timer});
    });
  }};
}

/** Called only after server-side private native-bridge authentication. */
export function claimNativeFileOpen() {
  nativePollAt = Date.now();
  for (const [operationId,job] of pending) {
    if(job.claimed)continue;
    try { jobFor(operationId); job.claimed=true; return 'operation' in job.request ? {operationId,operation:'transfer_pin',claimNonce:job.request.claimNonce} : {operationId}; }
    catch(error){clearTimeout(job.timer);pending.delete(operationId);job.reject(error as Error);}
  }
  return null;
}
export function nativeFileOpenSource(operationId: string) {
  const job = jobFor(operationId);
  if(!job.claimed)throw new FileServiceError('FILES_NATIVE_JOB_NOT_CLAIMED',409);
  if('operation' in job.request){
    const source=job.service.resolveNativeFile(job.request.fileId);
    const snapshot=job.service.resolveExplorerFile(job.request.fileId).file;
    const identity=createHash('sha256').update(snapshot.identity).update('\0').update(snapshot.contentSha256).digest('hex');
    if(source.absolutePath!==snapshot.absolutePath||snapshot.contentSha256!==job.request.contentSha256||identity!==job.request.sourceIdentityDigest)throw new FileServiceError('FILE_CHANGED',409);
    // The safe internal path still comes from Files discovery. Transfer pins hash
    // raw bytes; normalized text hashing belongs only to ordinary open receipts.
    return {...source,...job.request};
  }
  return {...job.request,...job.service.resolveNativeFile(job.request.fileId)};
}
export function finishNativeFileOpen(operationId: string, receipt?: NativeFileOpenReceipt | NativeTransferPinReceipt) {
  const job = pending.get(operationId);
  if(!job)throw new FileServiceError('FILES_NATIVE_JOB_EXPIRED',409);
  try {
    jobFor(operationId);
    if(!job.claimed || !receipt)throw new FileServiceError('FILES_NATIVE_OPEN_UNVERIFIED',502);
    // openNativeFile also validates the identity/PID/digest after this private receipt.
    if('operation' in job.request){
      const expected=job.request, pin=receipt as NativeTransferPinReceipt;
      const keys=['operation','operationId','fileId','ownerBindingId','transferId','targetDeviceId','claimNonce','sourceIdentityDigest','source','sourceHandle','contentSha256','sourceManifest'];
      if(pin.operation!=='transfer_pin'||pin.operationId!==operationId||pin.fileId!==expected.fileId||pin.ownerBindingId!==expected.ownerBindingId
        ||pin.transferId!==expected.transferId||pin.targetDeviceId!==expected.targetDeviceId||pin.claimNonce!==expected.claimNonce
        ||pin.sourceIdentityDigest!==expected.sourceIdentityDigest||pin.contentSha256!==expected.contentSha256||pin.source!=='native_operator'
        ||typeof pin.sourceHandle!=='string'||!pin.sourceHandle||!pin.sourceManifest||Object.keys(pin).some(key=>!keys.includes(key)))throw new FileServiceError('FILES_NATIVE_TRANSFER_PIN_UNVERIFIED',502);
      (job as PendingPin).resolve(pin);
    }else (job as PendingOpen).resolve(receipt as NativeFileOpenReceipt);
  } catch(error) {job.reject(error as Error);throw error;}
  finally {clearTimeout(job.timer);pending.delete(operationId);}
}

export async function openNativeFile(service: FileService, fileId: string,
  ownerBindingId: string, authorize: () => void, adapter?: NativeFileOpenAdapter) {
  authorize();
  const file = service.read(fileId);
  if (!adapter) throw new FileServiceError('FILES_NATIVE_OPEN_ADAPTER_UNAVAILABLE', 501);
  const operationId = randomUUID();
  const contentSha256 = createHash('sha256').update(file.text, 'utf8').digest('hex');
  authorize();
  // Only opaque identity crosses the transport; neither a caller path nor a
  // shell command is accepted. Native must re-resolve and authorize at dispatch.
  const receipt = await adapter.open({ operationId, fileId, ownerBindingId, contentSha256 }, authorize);
  authorize();
  const current = service.read(fileId);
  if (createHash('sha256').update(current.text, 'utf8').digest('hex') !== contentSha256
    || current.relativePath !== file.relativePath || current.root !== file.root) {
    throw new FileServiceError('FILE_CHANGED', 409);
  }
  if (!receipt || receipt.operationId !== operationId || receipt.fileId !== fileId
    || receipt.ownerBindingId !== ownerBindingId || receipt.source !== 'native_operator'
    || receipt.contentSha256 !== contentSha256 || receipt.postcondition !== 'same_file_opened'
    || !Number.isSafeInteger(receipt.openedProcessId) || receipt.openedProcessId <= 0
    || receipt.verifiedProcessId !== receipt.openedProcessId
    || Object.keys(receipt).some(key=>!['operationId','fileId','ownerBindingId','source','openedProcessId','verifiedProcessId','contentSha256','postcondition'].includes(key))) {
    throw new FileServiceError('FILES_NATIVE_OPEN_UNVERIFIED', 502);
  }
  authorize();
  return { success: true, fileId, completed: true, receipt };
}
