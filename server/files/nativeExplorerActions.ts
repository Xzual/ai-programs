import { randomUUID } from 'node:crypto';
import { FileServiceError } from './fileService';
import type { ExplorerNativeConsumer, ExplorerNativeRequest } from './explorerEffectService';

const POLL_TTL_MS=15000, JOB_TTL_MS=20000, QUEUE_LIMIT=8;
type Receipt=Awaited<ReturnType<ExplorerNativeConsumer['execute']>>;
type Job={request:ExplorerNativeRequest;claimNonce?:string;permitNonce?:string;quarantineIdentity?:string;actionId:string;expiresAt:number;resolve:(receipt:Receipt)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>;abort:()=>void};
const pending=new Map<string,Job>();
let pollAt=0;
let closed=false;
export function nativeExplorerHealth() {
  const age=Date.now()-pollAt,fresh=!closed&&pollAt>0&&age>=0&&age<=POLL_TTL_MS;
  return {adapterRegistered:true,nativeConsumerBound:fresh,consumerState:closed?'bridge_closed':fresh?'authenticated_poll_fresh':'configuration_required',heartbeatExpiresAt:pollAt?pollAt+POLL_TTL_MS:null};
}
function settle(id:string,error?:Error,receipt?:Receipt) {
  const job=pending.get(id);if(!job)return;
  pending.delete(id);clearTimeout(job.timer);job.request.signal.removeEventListener('abort',job.abort);
  if(error)job.reject(error);else job.resolve(receipt!);
}
function current(id:string,claimNonce?:string,precondition=true) {
  const job=pending.get(id);if(!job)throw new FileServiceError('EXPLORER_NATIVE_JOB_EXPIRED',409);
  try {
    if(job.expiresAt<=Date.now())throw new FileServiceError('EXPLORER_NATIVE_JOB_EXPIRED',410);
    if(job.request.signal.aborted)throw job.request.signal.reason;
    if(claimNonce!==undefined&&(!job.claimNonce||claimNonce!==job.claimNonce))throw new FileServiceError('EXPLORER_NATIVE_CLAIM_INVALID',409);
    if(precondition)job.request.revalidate();else job.request.readback?.();
    return job;
  }catch(error){
    // A wrong claim does not give a caller authority to revoke another native claim.
    if(!(error instanceof FileServiceError&&error.code==='EXPLORER_NATIVE_CLAIM_INVALID'))settle(id,error as Error);
    throw error;
  }
}
export function defaultNativeExplorerConsumer():ExplorerNativeConsumer {
  return {health:nativeExplorerHealth,execute:async(request)=>{
    request.revalidate();
    if(!nativeExplorerHealth().nativeConsumerBound)throw new FileServiceError('EXPLORER_NATIVE_CONSUMER_CONFIGURATION_REQUIRED',501);
    if(request.signal.aborted)throw request.signal.reason;
    if(!request.readback)throw new FileServiceError('EXPLORER_NATIVE_READBACK_CONFIGURATION_REQUIRED',501);
    if(pending.has(request.operationId))throw new FileServiceError('EXPLORER_NATIVE_JOB_REPLAY',409);
    if(pending.size>=QUEUE_LIMIT)throw new FileServiceError('EXPLORER_NATIVE_QUEUE_FULL',429);
    const expiresAt=Math.min(request.expiresAt,Date.now()+JOB_TTL_MS);
    if(expiresAt<=Date.now())throw new FileServiceError('EXPLORER_NATIVE_JOB_EXPIRED',410);
    return new Promise<Receipt>((resolve,reject)=>{
      const abort=()=>settle(request.operationId,request.signal.reason instanceof Error?request.signal.reason:new FileServiceError('EXPLORER_NATIVE_JOB_REVOKED',409));
      const timer=setTimeout(()=>settle(request.operationId,new FileServiceError('EXPLORER_NATIVE_EFFECT_TIMEOUT',504)),expiresAt-Date.now());timer.unref();
      pending.set(request.operationId,{request,expiresAt,actionId:randomUUID(),resolve,reject,timer,abort});request.signal.addEventListener('abort',abort,{once:true});
      if(request.signal.aborted)abort();
    });
  }};
}
/** Only call from the existing loopback + constant-time private bearer guard. */
export function claimNativeExplorer() {
  if(closed)throw new FileServiceError('EXPLORER_NATIVE_BRIDGE_CLOSED',503);
  pollAt=Date.now();
  for(const [id,job] of pending){if(job.claimNonce)continue;try{current(id);job.claimNonce=randomUUID();return {operationId:id,claimNonce:job.claimNonce,expiresAt:job.expiresAt};}catch{/* Invalidated jobs have already been settled. */}}
  return null;
}
export function nativeExplorerSource(id:string,claimNonce:string) {
  const job=current(id,claimNonce);const r=job.request;
  return {operationId:r.operationId,operationNonce:r.nonce,actionId:job.actionId,ownerBindingId:r.ownerBindingId,operation:r.operation,reverseOf:r.reverseOf,rootId:r.rootId,rootIdentity:r.rootIdentity,sourceDirectoryIdentity:r.sourceDirectoryIdentity,destinationDirectoryIdentity:r.destinationDirectoryIdentity,sourcePath:r.sourcePath,destinationPath:r.destinationPath,sourceIdentity:r.sourceIdentity,contentSha256:r.contentSha256,quarantine:r.quarantine,expiresAt:job.expiresAt,overwriteAllowed:false};
}
const CONTEXT_KEYS=['claimNonce','operationNonce','ownerBindingId','actionId','operation','rootIdentity','sourceIdentity','contentSha256','sourceDirectoryIdentity','destinationDirectoryIdentity'];
function context(job:Job,input:unknown,extras:string[]=[]):Record<string,unknown> {
  if(!input||typeof input!=='object'||Array.isArray(input))throw new FileServiceError('EXPLORER_NATIVE_CONTEXT_INVALID',400);
  const b=input as Record<string,unknown>,r=job.request;
  if(Object.keys(b).some(k=>![...CONTEXT_KEYS,'quarantineDirectoryIdentity',...extras].includes(k))||b.quarantineDirectoryIdentity!==job.quarantineIdentity||CONTEXT_KEYS.some(k=>typeof b[k]!=='string')||b.claimNonce!==job.claimNonce||b.operationNonce!==r.nonce||b.ownerBindingId!==r.ownerBindingId||b.actionId!==job.actionId||b.operation!==r.operation||b.rootIdentity!==r.rootIdentity||b.sourceIdentity!==r.sourceIdentity||b.contentSha256!==r.contentSha256||b.sourceDirectoryIdentity!==r.sourceDirectoryIdentity||b.destinationDirectoryIdentity!==r.destinationDirectoryIdentity)throw new FileServiceError('EXPLORER_NATIVE_CONTEXT_INVALID',409);
  return b;
}
function claimed(id:string,input:unknown,precondition:boolean) {
  const claim=(input as Record<string,unknown>)?.claimNonce;
  if(typeof claim!=='string'||!claim)throw new FileServiceError('EXPLORER_NATIVE_CLAIM_INVALID',409);
  return current(id,claim,precondition);
}
export function checkNativeExplorer(id:string,input:unknown) {
  const job=claimed(id,input,true);context(job,input);job.permitNonce=randomUUID();
  return {operationId:id,actionId:job.actionId,permitNonce:job.permitNonce,expiresAt:job.expiresAt,overwriteAllowed:false};
}
function permitted(id:string,input:unknown,extras:string[]=[]) {
  const job=claimed(id,input,false);const b=context(job,input,['permitNonce',...extras]);
  if(!job.permitNonce||b.permitNonce!==job.permitNonce)throw new FileServiceError('EXPLORER_NATIVE_PERMIT_INVALID',409);
  return {job,b};
}
export function readbackNativeExplorer(id:string,input:unknown) {
  const {job}=permitted(id,input);return job.request.readback!();
}
export function registerNativeExplorerQuarantine(id:string,input:unknown) {
  // This registration occurs after native creates the empty folder, so the
  // ordinary absent-folder precondition no longer applies. No caller path used.
  const claim=(input as Record<string,unknown>)?.claimNonce;
  if(typeof claim!=='string'||!claim)throw new FileServiceError('EXPLORER_NATIVE_CLAIM_INVALID',409);
  const job=pending.get(id);if(!job||job.expiresAt<=Date.now()||job.request.signal.aborted)throw new FileServiceError('EXPLORER_NATIVE_JOB_EXPIRED',409);
  if(job.claimNonce!==claim)throw new FileServiceError('EXPLORER_NATIVE_CLAIM_INVALID',409);
  const b=context(job,input,['permitNonce']);if(!job.permitNonce||b.permitNonce!==job.permitNonce||!job.request.registerQuarantine||job.quarantineIdentity)throw new FileServiceError('EXPLORER_NATIVE_PERMIT_INVALID',409);
  try{const registered=job.request.registerQuarantine();job.quarantineIdentity=registered.identity;job.permitNonce=undefined;return registered;}catch(error){settle(id,error as Error);throw error;}
}
export function finishNativeExplorer(id:string,input:unknown) {
  const {job,b}=permitted(id,input,['destinationIdentity','source','postcondition']);
  try {
    if(b.source!=='native_explorer'||b.postcondition!=='gui_action_observed'||(b.destinationIdentity!==undefined&&(typeof b.destinationIdentity!=='string'||! /^[a-f0-9]{64}$/.test(b.destinationIdentity))))throw new FileServiceError('EXPLORER_NATIVE_RECEIPT_INVALID',409);
    // Never run the absent-destination precondition after the GUI effect. The
    // producer readback callback checks current authority/root/directory/files;
    // execute() independently verifies the exact resulting effect afterward.
    job.request.readback!();
    settle(id,undefined,{operationId:id,nonce:job.request.nonce,actionId:job.actionId,destinationIdentity:b.destinationIdentity as string|undefined});
  }catch(error){settle(id,error as Error);throw error;}
}
export function cancelNativeExplorer(id:string,input:unknown) {
  const job=claimed(id,input,false);context(job,input);settle(id,new FileServiceError('EXPLORER_NATIVE_JOB_CANCELLED',409));
}
export function closeNativeExplorerBridge() {closed=true;pollAt=0;for(const id of pending.keys())settle(id,new FileServiceError('EXPLORER_NATIVE_BRIDGE_CLOSED',503));}
