import { randomUUID,createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { FileService, FileServiceError, fileService, type ExplorerDirectoryHandle, type ExplorerFileSnapshot, type ExplorerFilePin } from './fileService';
import { ownerSessionBindingActive, onOwnerSessionInvalidated } from '../security/ownerSession';
import { killSwitchService, onKillSwitchActivated } from '../../src/edith/killSwitch';

export type ExplorerOperation = 'copy' | 'move' | 'undo';
export type ExplorerPlanInput = { operation: 'copy' | 'move'; sourceFileId: string; destinationDirectoryId: string } | { operation: 'undo'; undoReceiptId: string };
/** Private in-process consumer contract. Never deserialize this from an HTTP body. */
export interface ExplorerNativeRequest {
  operationId: string; nonce: string; operation: ExplorerOperation; reverseOf?: 'copy' | 'move';
  ownerBindingId: string; rootId: 'workspace' | 'artifacts'; rootIdentity: string;
  sourceDirectoryIdentity: string; destinationDirectoryIdentity: string;
  sourcePath: string; destinationPath: string; sourceIdentity: string; contentSha256: string;
  expiresAt: number; overwriteAllowed: false;
  signal: AbortSignal;
  /** Call immediately before GUI action; also reject every overwrite confirmation in the consumer. */
  revalidate: () => void;
  /** Current authority and exact paths checked after a GUI effect, without requiring destination absence. */
  readback?: () => { source: ExplorerFileSnapshot|null; destination: ExplorerFileSnapshot|null };
  quarantine?: {directoryPath:string;directoryName:string;parentDirectoryIdentity:string};
  registerQuarantine?: () => {directoryPath:string;destinationPath:string;identity:string};
}
export interface ExplorerNativeConsumer {
  health?: () => {nativeConsumerBound:boolean;consumerState:string;adapterRegistered?:boolean;heartbeatExpiresAt?:number|null};
  execute(request: ExplorerNativeRequest): Promise<{ operationId: string; nonce: string; destinationIdentity?: string; actionId: string }>;
}
type State = 'proposed' | 'dispatched' | 'verified' | 'unverified' | 'cancelled' | 'expired';
// A plan, its undo receipt and its final callback borrow the same bounded authority pins.
// Close is idempotent; revocation of any consuming operation invalidates those shared pins.
type Pins = {originalPin?:ExplorerFilePin|null;generatedPin?:ExplorerFilePin|null};
type Effect = Pins & { owner: string; operation: 'copy' | 'move'; original: ExplorerDirectoryHandle; destination: ExplorerDirectoryHandle; name: string; baseline: ExplorerFileSnapshot; generated: ExplorerFileSnapshot; expiresAt: number; used: boolean };
type Plan = Pins & { id: string; nonce: string; owner: string; input: ExplorerPlanInput; key: string; state: State; expiresAt: number; original: ExplorerDirectoryHandle; destination: ExplorerDirectoryHandle; name: string; baseline: ExplorerFileSnapshot; reverse?: Effect; undoReceiptId?: string; errorCode?: string; controller?: AbortController; quarantine?:ExplorerDirectoryHandle };
export class ExplorerEffectService {
  private taskLifecycle?:{before:(id:string)=>void;check:(id:string)=>void;verified:(id:string,folder:string,name:string,validate:()=>void)=>void;cancelled:(id:string)=>void;failed:(id:string)=>void};
  bindTaskLifecycle(observer:NonNullable<ExplorerEffectService['taskLifecycle']>){this.taskLifecycle=observer;}
  private plans = new Map<string,Plan>();
  private receipts = new Map<string,Effect>();
  private unsub: (()=>void)[];
  private closed = false;
  constructor(readonly files: FileService = fileService, private readonly consumer?: ExplorerNativeConsumer, private readonly now = Date.now) {
    this.unsub = [onOwnerSessionInvalidated(e=>this.cancelOwner(e.bindingId)),onKillSwitchActivated(()=>{for(const p of this.plans.values()){this.closePins(p);if(p.state==='proposed'||p.state==='dispatched')this.revoke(p,'KILL_SWITCH_ACTIVE',423);}this.receipts.clear();})];
  }
  close() { this.closed=true;this.unsub.forEach(fn=>fn());this.unsub=[];for(const p of this.plans.values()){this.closePins(p);if(p.state==='proposed'||p.state==='dispatched')this.revoke(p,'EXPLORER_SERVICE_CLOSED',503);}this.receipts.clear(); }
  status() { return { nativeConsumerBound: !!this.consumer, consumerState: this.consumer ? 'internal_consumer_bound' : 'configuration_required',...this.consumer?.health?.(),...(this.closed?{nativeConsumerBound:false,consumerState:'service_closed'}:killSwitchService.status().active?{nativeConsumerBound:false,consumerState:'blocked'}:{}), physicalAcceptance: false, overwriteAllowed: false, limits: {plans:128,ttlMs:120000} }; }
  private authority(owner: string) { if(this.closed)throw new FileServiceError('EXPLORER_SERVICE_CLOSED',503);if(!ownerSessionBindingActive(owner))throw new FileServiceError('OWNER_SESSION_REQUIRED',401);if(killSwitchService.status().active)throw new FileServiceError('KILL_SWITCH_ACTIVE',423); }
  private closePins(p:Pins) {p.originalPin?.close();if(p.generatedPin!==p.originalPin)p.generatedPin?.close();}
  private revoke(p:Plan,code:string,status:number,state:State='cancelled') {this.closePins(p);p.state=state;p.controller?.abort(new FileServiceError(code,status));this.taskLifecycle?.cancelled(p.id);}
  private cancelOwner(owner: string) { for(const p of this.plans.values())if(p.owner===owner){this.closePins(p);if(p.state==='proposed'||p.state==='dispatched')this.revoke(p,'OWNER_SESSION_REQUIRED',401);}for(const [id,r] of this.receipts)if(r.owner===owner)this.receipts.delete(id); }
  private sweep() { for(const p of this.plans.values())if(p.expiresAt<=this.now()){this.closePins(p);if(p.state==='proposed'||p.state==='dispatched')this.revoke(p,'EXPLORER_PLAN_EXPIRED',410,'expired');}for(const [id,r] of this.receipts)if(r.expiresAt<=this.now())this.receipts.delete(id); }
  private view(p: Plan) { return { operationId:p.id,operation:p.input.operation,...(p.input.operation==='undo'?{reversesUndoReceiptId:p.input.undoReceiptId}:{sourceFileId:p.input.sourceFileId,destinationDirectoryId:p.input.destinationDirectoryId}),state:p.state,expiresAt:p.expiresAt,completed:p.state==='verified',verification:p.state==='verified'?'independent_filesystem_readback':null,undoReceiptId:p.undoReceiptId,errorCode:p.errorCode,...this.status() }; }
  private get(id: string,owner: string) { this.authority(owner);this.sweep();const p=this.plans.get(id);if(!p||p.owner!==owner)throw new FileServiceError('EXPLORER_PLAN_NOT_FOUND',404);return p; }
  read(id: string,owner: string) { return this.view(this.get(id,owner)); }
  cancel(id: string,owner: string) { const p=this.get(id,owner);this.closePins(p);if(p.state==='proposed'||p.state==='dispatched')this.revoke(p,'EXPLORER_PLAN_REVOKED',409);return this.view(p); }
  propose(input: ExplorerPlanInput, owner: string, ownerExpiresAt: number, key: string) {
    this.authority(owner);this.sweep();
    if(!key||! /^[A-Za-z0-9_-]{8,100}$/.test(key))throw new FileServiceError('EXPLORER_IDEMPOTENCY_REQUIRED');
    if(!input||typeof input!=='object'||Array.isArray(input))throw new FileServiceError('EXPLORER_INPUT_INVALID');
    const allowed=input.operation==='undo'?['operation','undoReceiptId']:['operation','sourceFileId','destinationDirectoryId'];
    if(Object.keys(input).some(k=>!allowed.includes(k))||!['copy','move','undo'].includes(input.operation)||allowed.some(k=>typeof (input as unknown as Record<string,unknown>)[k]!=='string'))throw new FileServiceError('EXPLORER_INPUT_INVALID');
    input=input.operation==='undo'?{operation:'undo',undoReceiptId:input.undoReceiptId}:{operation:input.operation,sourceFileId:input.sourceFileId,destinationDirectoryId:input.destinationDirectoryId};
    const old=[...this.plans.values()].find(p=>p.owner===owner&&p.key===key);
    if(old){if(JSON.stringify(old.input)!==JSON.stringify(input))throw new FileServiceError('EXPLORER_IDEMPOTENCY_CONFLICT',409);return this.view(old);}
    if(this.plans.size>=128)throw new FileServiceError('EXPLORER_PLAN_LIMIT',429);
    let original:ExplorerDirectoryHandle,destination:ExplorerDirectoryHandle,baseline:ExplorerFileSnapshot,name:string,reverse:Effect|undefined;
    if(input.operation==='undo') {
      reverse=this.receipts.get(input.undoReceiptId);
      if(!reverse||reverse.owner!==owner||reverse.used||reverse.expiresAt<=this.now())throw new FileServiceError('EXPLORER_UNDO_UNAVAILABLE',409);
      ({original,destination,name,baseline}=reverse);
    } else {
      const source=this.files.resolveExplorerFile(input.sourceFileId);original=source.directory;baseline=source.file;name=source.name;
      destination=this.files.resolveExplorerDirectory(input.destinationDirectoryId);
      if(original.rootId!==destination.rootId||original.realRoot!==destination.realRoot||original.rootIdentity!==destination.rootIdentity)throw new FileServiceError('EXPLORER_ROOT_MISMATCH',403);
      if(input.operation==='move'&&baseline.device!==destination.device)throw new FileServiceError('EXPLORER_CROSS_VOLUME_UNSUPPORTED',501);
    }
    const p:Plan={id:randomUUID(),nonce:randomUUID(),owner,input:{...input},key,state:'proposed',expiresAt:Math.min(ownerExpiresAt,this.now()+120000),original,destination,name,baseline,reverse};
    try {
      if(reverse){p.originalPin=reverse.originalPin;p.generatedPin=reverse.generatedPin;}
      else p.originalPin=this.files.pinExplorerEntry(original,name,baseline,p.expiresAt);
      this.preflight(p);if(reverse)reverse.used=true;this.plans.set(p.id,p);return this.view(p);
    }catch(error){this.closePins(p);throw error;}
  }
  private same(actual: ExplorerFileSnapshot|null, expected: ExplorerFileSnapshot) { return !!actual&&actual.identity===expected.identity&&actual.contentSha256===expected.contentSha256&&actual.sizeBytes===expected.sizeBytes&&actual.device===expected.device&&this.files.sameExplorerFileKey(actual,expected); }
  private renamed(actual:ExplorerFileSnapshot|null,expected:ExplorerFileSnapshot,pin?:ExplorerFilePin|null) {
    if(!pin)return this.same(actual,expected);
    return !!actual&&actual.contentSha256===expected.contentSha256&&actual.sizeBytes===expected.sizeBytes&&actual.device===expected.device&&pin.matches(actual);
  }
  private preflight(p:Plan) {
    this.taskLifecycle?.check(p.id);
    this.authority(p.owner);if(p.expiresAt<=this.now())throw new FileServiceError('EXPLORER_PLAN_EXPIRED',410);
    if(p.state!=='proposed'&&p.state!=='dispatched')throw new FileServiceError('EXPLORER_PLAN_REVOKED',409);
    const source=this.files.inspectExplorerEntry(p.original,p.name),target=this.files.inspectExplorerEntry(p.destination,p.name);
    if(p.reverse){if(!this.same(target,p.reverse.generated)||(p.reverse.operation==='move'?source!==null:!this.same(source,p.baseline)))throw new FileServiceError('EXPLORER_UNDO_TARGET_CHANGED',409);}
    else {if(!this.same(source,p.baseline))throw new FileServiceError('EXPLORER_SOURCE_CHANGED',409);if(target)throw new FileServiceError('EXPLORER_DESTINATION_EXISTS',409);}
    if(p.originalPin&&!(p.reverse?.operation==='move'?p.originalPin.matches(target!):p.originalPin.matches(source!)))throw new FileServiceError('EXPLORER_SOURCE_CHANGED',409);
    if(p.reverse&&p.generatedPin&&!p.generatedPin.matches(target!))throw new FileServiceError('EXPLORER_UNDO_TARGET_CHANGED',409);
    if(p.reverse?.operation==='copy'){
      if(p.quarantine){if(this.files.inspectExplorerEntry(p.quarantine,p.name))throw new FileServiceError('EXPLORER_QUARANTINE_DESTINATION_EXISTS',409);quarantineContents(p.quarantine.absolutePath);}
      else {try{fs.lstatSync(quarantinePath(p));throw new FileServiceError('EXPLORER_QUARANTINE_DIRECTORY_EXISTS',409);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}
    }
  }
  private registerQuarantine(p:Plan) {
    this.authority(p.owner);if(p.state!=='dispatched'||p.expiresAt<=this.now()||p.reverse?.operation!=='copy'||p.quarantine)throw new FileServiceError('EXPLORER_QUARANTINE_REGISTRATION_INVALID',409);
    // Check the unchanged original/generated file and parent/root before binding
    // the exact directory created by the trusted GUI under its checked permit.
    const original=this.files.inspectExplorerEntry(p.original,p.name),generated=this.files.inspectExplorerEntry(p.destination,p.name);
    if(!this.same(original,p.baseline)||!this.same(generated,p.reverse.generated))throw new FileServiceError('EXPLORER_UNDO_TARGET_CHANGED',409);
    const directoryPath=quarantinePath(p),stat=fs.lstatSync(directoryPath);
    if(!stat.isDirectory()||stat.isSymbolicLink()||String(stat.dev)!==p.reverse.generated.device||fs.realpathSync(directoryPath)!==directoryPath)throw new FileServiceError('EXPLORER_QUARANTINE_SCOPE_DENIED',403);
    const handle:ExplorerDirectoryHandle={...p.destination,id:p.id,absolutePath:directoryPath,identity:createHash('sha256').update(JSON.stringify([stat.dev,stat.ino,stat.birthtimeMs])).digest('hex'),device:String(stat.dev)};
    this.files.inspectExplorerEntry(handle,p.name);quarantineContents(directoryPath);
    p.quarantine=handle;try{this.preflight(p);}catch(error){p.quarantine=undefined;throw error;}return {directoryPath,destinationPath:path.join(directoryPath,p.name),identity:handle.identity};
  }
  async execute(id:string,owner:string) {
    const p=this.get(id,owner);if(p.state!=='proposed')throw new FileServiceError('EXPLORER_PLAN_REPLAY',409);
    try {
      if(!this.consumer||(this.consumer.health&&!this.consumer.health().nativeConsumerBound))throw new FileServiceError('EXPLORER_NATIVE_CONSUMER_CONFIGURATION_REQUIRED',501);
      this.taskLifecycle?.before(p.id);
      this.preflight(p);await Promise.resolve();if(p.state!=='proposed')throw new FileServiceError('EXPLORER_PLAN_REPLAY',409);this.preflight(p);p.state='dispatched';
    }catch(error){this.closePins(p);if(p.state==='proposed'){p.state='unverified';p.errorCode=error instanceof FileServiceError?error.code:'EXPLORER_NATIVE_EFFECT_UNVERIFIED';this.taskLifecycle?.failed(p.id);}throw error;}
    p.controller=new AbortController();const signal=p.controller.signal;
    let rejectCancellation:(reason:unknown)=>void;
    const cancellation=new Promise<never>((_resolve,reject)=>{rejectCancellation=reject;});
    const abort=()=>rejectCancellation(signal.reason);signal.addEventListener('abort',abort,{once:true});
    const timeout=setTimeout(()=>this.revoke(p,'EXPLORER_PLAN_EXPIRED',410,'expired'),Math.max(1,p.expiresAt-this.now()));timeout.unref();
    try {
      const quarantinedUndo=p.reverse?.operation==='copy';
      const receipt=await Promise.race([cancellation,this.consumer.execute({operationId:p.id,nonce:p.nonce,operation:p.input.operation,reverseOf:p.reverse?.operation,ownerBindingId:p.owner,rootId:p.original.rootId,rootIdentity:p.original.rootIdentity,sourceDirectoryIdentity:p.reverse?p.destination.identity:p.original.identity,destinationDirectoryIdentity:quarantinedUndo?p.destination.identity:p.reverse?p.original.identity:p.destination.identity,sourcePath:p.reverse?p.reverse.generated.absolutePath:p.baseline.absolutePath,destinationPath:quarantinedUndo?path.join(quarantinePath(p),p.name):p.reverse?p.baseline.absolutePath:requireDestination(p),sourceIdentity:p.reverse?p.reverse.generated.identity:p.baseline.identity,contentSha256:p.baseline.contentSha256,expiresAt:p.expiresAt,overwriteAllowed:false,signal,revalidate:()=>this.preflight(p),...(quarantinedUndo?{quarantine:{directoryPath:quarantinePath(p),directoryName:path.basename(quarantinePath(p)),parentDirectoryIdentity:p.destination.identity},registerQuarantine:()=>this.registerQuarantine(p)}:{}),readback:()=>{this.authority(p.owner);if(p.state!=='dispatched'||p.expiresAt<=this.now())throw new FileServiceError('EXPLORER_PLAN_REVOKED',409);const original=this.files.inspectExplorerEntry(p.original,p.name),destination=this.files.inspectExplorerEntry(p.destination,p.name);if(quarantinedUndo)return {source:destination,destination:p.quarantine?this.files.inspectExplorerEntry(p.quarantine,p.name):null};return p.reverse?{source:destination,destination:original}:{source:original,destination};}})]);
      this.authority(owner);if(p.state!=='dispatched'||p.expiresAt<=this.now())throw new FileServiceError('EXPLORER_PLAN_REVOKED',409);
      if(receipt.operationId!==p.id||receipt.nonce!==p.nonce||typeof receipt.actionId!=='string'||!receipt.actionId)throw new FileServiceError('EXPLORER_NATIVE_RECEIPT_INVALID',409);
      const source=this.files.inspectExplorerEntry(p.original,p.name),target=this.files.inspectExplorerEntry(p.destination,p.name);
      if(p.reverse) {
        if(target!==null||!(p.reverse.operation==='move'?this.renamed(source,p.baseline,p.originalPin):this.same(source,p.baseline)))throw new FileServiceError('EXPLORER_UNDO_READBACK_FAILED',409);
        const quarantined=p.quarantine?this.files.inspectExplorerEntry(p.quarantine,p.name):null;
        if(p.reverse.operation==='copy'&&(!quarantined||!this.renamed(quarantined,p.reverse.generated,p.generatedPin)||receipt.destinationIdentity!==quarantined.identity))throw new FileServiceError('EXPLORER_QUARANTINE_READBACK_FAILED',409);
        if(p.reverse.operation==='copy')quarantineContents(p.quarantine!.absolutePath,p.name);
        if(p.reverse.operation==='move'&&receipt.destinationIdentity!==source?.identity)throw new FileServiceError('EXPLORER_NATIVE_RECEIPT_INVALID',409);
      } else {
        if(!target||target.contentSha256!==p.baseline.contentSha256||target.sizeBytes!==p.baseline.sizeBytes||target.identity!==receipt.destinationIdentity||(p.input.operation==='copy'?!this.same(source,p.baseline)||target.identity===p.baseline.identity||this.files.sameExplorerFileKey(target,p.baseline):source!==null||!this.renamed(target,p.baseline,p.originalPin)))throw new FileServiceError('EXPLORER_EFFECT_READBACK_FAILED',409);
        if(p.input.operation==='copy'){
          p.generatedPin=this.files.pinExplorerEntry(p.destination,p.name,target,p.expiresAt);
          if(p.originalPin&&!p.generatedPin)throw new FileServiceError('EXPLORER_PIN_UNAVAILABLE',409);
        }else p.generatedPin=p.originalPin;
        const receiptId=randomUUID();this.receipts.set(receiptId,{owner,operation:p.input.operation as 'copy'|'move',original:p.original,destination:p.destination,name:p.name,baseline:p.baseline,generated:target,expiresAt:p.expiresAt,used:false,originalPin:p.originalPin,generatedPin:p.generatedPin});p.undoReceiptId=receiptId;
      }
      this.authority(owner);p.state='verified';const final=p.reverse?.operation==='copy'?p.quarantine!:p.reverse?p.original:p.destination,retained=p.quarantine?this.files.inspectExplorerEntry(p.quarantine,p.name):null;
      this.taskLifecycle?.verified(p.id,final.absolutePath,p.name,()=>{
        try {
          this.authority(owner);if(p.state!=='verified'||p.expiresAt<=this.now())throw new FileServiceError('EXPLORER_FINAL_PROOF_REVOKED',409);
          const currentSource=this.files.inspectExplorerEntry(p.original,p.name),currentTarget=this.files.inspectExplorerEntry(p.destination,p.name),currentRetained=p.quarantine?this.files.inspectExplorerEntry(p.quarantine,p.name):null;
          const equal=(actual:ExplorerFileSnapshot|null,expected:ExplorerFileSnapshot|null)=>expected?this.same(actual,expected):actual===null;
          if(!equal(currentSource,source)||!equal(currentTarget,target)||p.quarantine&&!equal(currentRetained,retained)
            ||p.originalPin&&!p.originalPin.matches((p.reverse||p.input.operation==='copy'?currentSource:currentTarget)!)
            ||p.generatedPin&&!p.generatedPin.matches((p.reverse?.operation==='copy'?currentRetained:p.reverse?currentSource:currentTarget)!))throw new FileServiceError('EXPLORER_FINAL_PROOF_CHANGED',409);
          // An undo consumes the receipt; keep its pins until this later native proof callback.
          if(p.reverse)this.closePins(p);
        }catch(error){this.closePins(p);p.state='unverified';this.taskLifecycle?.failed(p.id);throw error;}
      });return this.view(p);
    } catch(error) {
      this.closePins(p);
      if(p.undoReceiptId){this.receipts.delete(p.undoReceiptId);p.undoReceiptId=undefined;}
      if(p.state==='dispatched')p.state='unverified';this.taskLifecycle?.failed(p.id);p.errorCode=error instanceof FileServiceError?error.code:'EXPLORER_NATIVE_EFFECT_UNVERIFIED';throw error instanceof FileServiceError?error:new FileServiceError(p.errorCode,503);
    } finally {clearTimeout(timeout);signal.removeEventListener('abort',abort);}
  }
}
function requireDestination(p:Plan) { return path.join(p.destination.absolutePath,p.name); }
function quarantinePath(p:Plan) { return path.join(p.destination.absolutePath,'.edith-undo-'+p.id); }
function quarantineContents(directory:string,onlyName?:string) {const handle=fs.opendirSync(directory);try{const first=handle.readSync();if(onlyName?first?.name!==onlyName||!!handle.readSync():!!first)throw new FileServiceError('EXPLORER_QUARANTINE_NOT_EMPTY',409);}finally{handle.closeSync();}}
