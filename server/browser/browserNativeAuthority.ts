import crypto from 'node:crypto';
import type {Request,ErrorRequestHandler} from 'express';
import type * as N from './browserNativePrivateContract';

const BASE='/api/edith/computer/native-browser';
const REF=/^[A-Za-z0-9_-]{22,160}$/;
const DIGEST=/^[a-fA-F0-9]{64}$/;
const MAX_BODY=65536;
type Json=Record<string,unknown>;
export class BrowserNativeAuthorityError extends Error {
  constructor(readonly code:string,readonly status=400){super(code);}
}
const deny=(code='NATIVE_INPUT_INVALID',status=400):never=>{throw new BrowserNativeAuthorityError(code,status);};
function object(value:unknown):Json {
  if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))deny();
  return value as Json;
}
function exact(value:unknown,keys:readonly string[]):Json {
  const row=object(value),actual=Object.keys(row);
  if(actual.length!==keys.length||keys.some(key=>!Object.hasOwn(row,key)))deny();
  return row;
}
function integer(value:unknown,min=0,max=Number.MAX_SAFE_INTEGER):number {
  if(typeof value!=='number'||!Number.isSafeInteger(value)||value<min||value>max)deny();return value as number;
}
function reference(value:unknown):string {if(typeof value!=='string'||!REF.test(value))deny();return value as string;}
function correlation(value:unknown):string {if(typeof value!=='string'||!value.length||value.length>160||!/^[\x21-\x7e]+$/.test(value))deny();return value as string;}
function digest(value:unknown):string {if(typeof value!=='string'||!DIGEST.test(value))deny();return value as string;}
function enumeration(value:unknown,values:readonly unknown[]):void {if(!values.includes(value))deny();}
function bool(value:unknown):void {if(typeof value!=='boolean')deny();}
function fields(row:Json,refs:readonly string[]=[],digests:readonly string[]=[],numbers:readonly string[]=[],booleans:readonly string[]=[]):void {
  for(const key of refs)reference(row[key]);for(const key of digests)digest(row[key]);for(const key of numbers)integer(row[key]);for(const key of booleans)bool(row[key]);
}
const CONSENT=['version','backendBootRef','nativeBootRef','enrollmentSourceRef','enrollmentChallengeRef','enrollmentRecheckRef','consentRef','nativeSessionRef','originalOwnerRef','originalTaskRef','attemptRef','operationRef','requestScopeDigest','sourceEpochDigest','computerSessionGeneration','localSessionExpiresAtMs','reservationRef','reservationGeneration','reservationExpiresAtMs','nativeStopEpoch','confirmationRef','confirmationMethod','approvedAtMs','expiresAtMs'] as const;
const CONSENT_REFS=['backendBootRef','nativeBootRef','enrollmentSourceRef','enrollmentChallengeRef','enrollmentRecheckRef','consentRef','nativeSessionRef','originalOwnerRef','attemptRef','operationRef','reservationRef','confirmationRef'];
const CONSENT_NUMBERS=['computerSessionGeneration','localSessionExpiresAtMs','reservationGeneration','reservationExpiresAtMs','nativeStopEpoch','approvedAtMs','expiresAtMs'];
const MAP=['version','backendBootRef','nativeBootRef','challengeRef','mapRef','originalTaskRef','operationRef','actionBatchRef','snapshotRef','processLaunchRef','kernelCreation','executableFingerprint','kernelIdentityRef','rootIdentityRef','contentIdentityRef','logicalDocumentRef','logicalAncestryDigest','logicalRuntimeIdDigest','engineInventoryDigest','nativeInventoryDigest','sourceEpochDigest','nativeSessionRef','nativeSessionGeneration','localConsentRef','reservationRef','reservationGeneration','nativeStopEpoch','profile','transform','nativeHitTargetRef','nativeHitProofDigest','measuredAtMs','expiresAtMs'] as const;
const MAP_REFS=['backendBootRef','nativeBootRef','challengeRef','mapRef','operationRef','actionBatchRef','snapshotRef','processLaunchRef','kernelIdentityRef','rootIdentityRef','contentIdentityRef','logicalDocumentRef','nativeSessionRef','localConsentRef','reservationRef','nativeHitTargetRef'];
const MAP_DIGESTS=['executableFingerprint','logicalAncestryDigest','logicalRuntimeIdDigest','engineInventoryDigest','nativeInventoryDigest','sourceEpochDigest','nativeHitProofDigest'];
const LEDGER=['version','backendBootRef','nativeBootRef','challengeRef','ledgerRef','permitRef','operationRef','actionBatchRef','processLaunchRef','kernelIdentityRef','viewportMapRef','nativeSessionRef','nativeSessionGeneration','localConsentRef','reservationRef','reservationGeneration','nativeStopEpoch','sequence','claimedAtMs','completedAtMs','requestedEventCount','sentEventCount','cleanupRequestedCount','cleanupSentCount','cursorEffect','focusEffect','possibleEffect','result'] as const;
const LEDGER_REFS=['backendBootRef','nativeBootRef','challengeRef','ledgerRef','permitRef','operationRef','actionBatchRef','processLaunchRef','kernelIdentityRef','viewportMapRef','nativeSessionRef','localConsentRef','reservationRef'];
const FOCUS=['version','focusActionRef','sourceEpochDigest','nativeBootRef','nativeSessionRef','computerSessionGeneration','reservationRef','reservationGeneration','nativeStopEpoch','originalRootWindowRef','measuredBeforeAtMs','measuredAfterAtMs','expiresAtMs','beforeGuardsCurrent','afterGuardsCurrent','afterForeground','rootAssociationCurrent','kind','beforeForeground','possibleEffect'];
export type NativePrivateAction='boot'|'source'|'associate'|'map'|'check'|'consume'|'dispatch'|'verify'|'cancel'|'driver/next'|'input'|'input/arm'|'focus/source'|'focus/record';
export const NATIVE_PRIVATE_ACTIONS:readonly NativePrivateAction[]=Object.freeze(['boot','source','associate','map','check','consume','dispatch','verify','cancel','driver/next','input','input/arm','focus/source','focus/record']);
/** Validation has no issuer effects. Unknown/mixed/nested keys are rejected first. */
export function decodeNativePrivate(action:NativePrivateAction,value:unknown):Readonly<Json> {
  let row:Json;
  switch(action){
    case 'boot': row=exact(value,['version','nativeBootNonce']);reference(row.nativeBootNonce);break;
    case 'source': {
      const input=object(value);
      if(input.phase==='enrollment'){row=exact(value,['version','phase','attemptRef']);reference(row.attemptRef);}
      else if(input.phase==='enrollment_recheck'){row=exact(value,['version','phase','enrollmentSourceRef','enrollmentChallengeRef']);fields(row,['enrollmentSourceRef','enrollmentChallengeRef']);}
      else {row=exact(value,['bindingRef']);reference(row.bindingRef);}
      break;
    }
    case 'associate': {
      row=exact(value,['version','attemptRef','nativeSessionRef','enrollmentSourceRef','enrollmentChallengeRef','enrollmentRecheckRef','consentView']);fields(row,['attemptRef','nativeSessionRef','enrollmentSourceRef','enrollmentChallengeRef','enrollmentRecheckRef']);
      const c=exact(row.consentView,CONSENT);fields(c,CONSENT_REFS,['requestScopeDigest','sourceEpochDigest'],CONSENT_NUMBERS);correlation(c.originalTaskRef);enumeration(c.version,[1]);enumeration(c.confirmationMethod,['win32-scoped-messagebox-yes']);
      if(integer(c.approvedAtMs)>integer(c.expiresAtMs)||integer(c.expiresAtMs)>Math.min(integer(c.localSessionExpiresAtMs),integer(c.reservationExpiresAtMs),integer(c.approvedAtMs)+30000))deny();break;
    }
    case 'map': {
      row=exact(value,['challengeRef','mapRef','mapView']);fields(row,['challengeRef','mapRef']);
      const m=exact(row.mapView,MAP);fields(m,MAP_REFS,MAP_DIGESTS,['nativeSessionGeneration','reservationGeneration','nativeStopEpoch','measuredAtMs','expiresAtMs']);correlation(m.originalTaskRef);enumeration(m.version,[1]);enumeration(m.profile,['exclusive-mainpage-dpi96-v1']);
      if(typeof m.kernelCreation!=='string'||!/^\d{1,20}$/.test(m.kernelCreation)||BigInt(m.kernelCreation)>18446744073709551615n)deny();
      const t=exact(m.transform,['originPhysicalX','originPhysicalY','widthPhysical','heightPhysical','dpi','dpr','visualScale']);
      integer(t.originPhysicalX,-32768,32768);integer(t.originPhysicalY,-32768,32768);integer(t.widthPhysical,1,32768);integer(t.heightPhysical,1,32768);enumeration(t.dpi,[96]);enumeration(t.dpr,[1]);enumeration(t.visualScale,[1]);
      if(integer(m.expiresAtMs)<=integer(m.measuredAtMs)||integer(m.expiresAtMs)>integer(m.measuredAtMs)+1000)deny();break;
    }
    case 'check': row=exact(value,['bindingRef','snapshotRef','mapRef']);fields(row,['bindingRef','snapshotRef','mapRef']);break;
    case 'consume': row=exact(value,['permitRef']);reference(row.permitRef);break;
    case 'dispatch': {
      row=exact(value,['challengeRef','permitRef','ledgerRef','ledgerView']);fields(row,['challengeRef','permitRef','ledgerRef']);const l=exact(row.ledgerView,LEDGER);
      fields(l,LEDGER_REFS,[],['nativeSessionGeneration','reservationGeneration','nativeStopEpoch','sequence','claimedAtMs','completedAtMs'],['cursorEffect','focusEffect','possibleEffect']);enumeration(l.version,[1]);enumeration(l.result,['sent','zero_effect_denied','partial','unknown']);
      integer(l.requestedEventCount,0,20400);integer(l.sentEventCount,0,integer(l.requestedEventCount));integer(l.cleanupRequestedCount,0,400);integer(l.cleanupSentCount,0,integer(l.cleanupRequestedCount));
      if(integer(l.completedAtMs)<integer(l.claimedAtMs))deny();
      if(l.result==='sent'&&(l.sentEventCount!==l.requestedEventCount||l.cleanupSentCount!==l.cleanupRequestedCount||l.requestedEventCount===0||l.possibleEffect!==true))deny();
      if(l.result==='zero_effect_denied'&&(l.sentEventCount!==0||l.cleanupSentCount!==0||l.possibleEffect||l.cursorEffect||l.focusEffect))deny();
      if((l.cursorEffect||l.focusEffect||integer(l.sentEventCount)>0||integer(l.cleanupSentCount)>0)&&!l.possibleEffect)deny();break;
    }
    case 'verify':row=exact(value,['permitRef','dispatchRef']);fields(row,['permitRef','dispatchRef']);break;
    case 'cancel':row=exact(value,['bindingRef','reason']);reference(row.bindingRef);enumeration(row.reason,['owner_lost','permission_lost','task_stopped','plan_changed','expired','session_closed','unknown_effect','explicit_revoke']);break;
    case 'driver/next':row=exact(value,['version','operationRef']);reference(row.operationRef);break;
    case 'input':case 'input/arm':row=exact(value,['version','commandRef','approvedInputRef']);fields(row,['commandRef','approvedInputRef']);break;
    case 'focus/source':row=exact(value,['version','operationRef','bindingRef']);fields(row,['operationRef','bindingRef']);break;
    case 'focus/record': {
      row=exact(value,['version','operationRef','bindingRef','focusSourceRef','focusRecord']);fields(row,['operationRef','bindingRef','focusSourceRef']);const r=object(row.focusRecord);
      exact(r,r.kind==='set-original-foreground'?[...FOCUS,'apiBool']:FOCUS);fields(r,['focusActionRef','nativeBootRef','nativeSessionRef','reservationRef','originalRootWindowRef'],['sourceEpochDigest'],['computerSessionGeneration','reservationGeneration','nativeStopEpoch','measuredBeforeAtMs','measuredAfterAtMs','expiresAtMs'],['afterGuardsCurrent','rootAssociationCurrent','possibleEffect']);
      enumeration(r.version,[1]);enumeration(r.beforeGuardsCurrent,[true]);enumeration(r.afterForeground,['original-chrome','other','unknown']);
      if(r.kind==='already-foreground'){enumeration(r.beforeForeground,['original-chrome']);enumeration(r.possibleEffect,[false]);}
      else {enumeration(r.kind,['set-original-foreground']);enumeration(r.beforeForeground,['managed-edith']);enumeration(r.possibleEffect,[true]);if(r.apiBool!==null)integer(r.apiBool,-2147483648,2147483647);}
      if(integer(r.measuredBeforeAtMs)>integer(r.measuredAfterAtMs))deny();break;
    }
    default:deny();
  }
  if(Object.hasOwn(row!,'version'))enumeration(row!.version,[1]);
  return detached(row!);
}
type Peer={listener:string;credentialDigest:string;generation:number};
type Boot={cap:N.NativeBootRef;alias:string;nonce:string;generation:number};
const cap=<T>():T=>Object.freeze(Object.create(null)) as T;
const alias=()=>crypto.randomBytes(24).toString('base64url');
type RuntimeProducer=N.NativeSourceRuntimePort;
/** Trusted Node composition only. Inspection never admits a DTO or a caller Task. */
export interface BrowserNativeAuthoritySources {
  readonly producer:RuntimeProducer;
  readonly engine:N.NativeSourceEngineLookupPort&Pick<N.NativeSourceEnginePort,'verifyPostcondition'>;
}
type Phase='enrollment'|'focus'|'measure'|'dispatch'|'verifying'|'paired'|'terminal';
type AttemptMeta=ReturnType<RuntimeProducer['inspectNativeAttempt']>;
type BatchMeta=ReturnType<RuntimeProducer['inspectNativePlannedBatch']>;
type ARecord={attempt:N.AttemptRef;operation:N.OriginalOperationLookupRef;meta:AttemptMeta;source:N.BrowserNativeSourceHandle;timer?:NodeJS.Timeout;
 owner:N.BrowserOwnerCap;sourceFacts:ReturnType<N.NativeSourceEngineLookupPort['inspectSource']>;
 originalHeld:ReturnType<N.NativeSourceEngineLookupPort['inspectHeldSource']>;
 navigation?:PRecord;successor?:{source:N.BrowserNativeSourceHandle;postcondition:N.NativeSourcePostconditionCap;digest:string};
 successorView?:N.NativeBoundSourceView;successorBusy?:Promise<N.NativeBoundSourceView|undefined>;
 digest:string;deadline:number;phase:Phase;backendBoot:N.BackendBootRef;nativeBoot:N.NativeBootRef;generation:number;
 binding?:BRecord;enrollment?:ERecord;batches:BatchRecord[];next:number;effect:boolean;reason:string;
 completion:Promise<N.NativeCompletionRefs>;resolve:(refs:N.NativeCompletionRefs)=>void;reject:(error:Error)=>void;
 count:{logicalBatches:number;requestedEventCount:number;sentEventCount:number;cleanupRequestedCount:number;cleanupSentCount:number};};
type ERecord={cap:N.EnrollmentSourceRef;wire:string;challenge:N.EnrollmentChallengeRef;challengeWire:string;view:N.EnrollmentSourceView;attempt:ARecord;
 recheck?:N.EnrollmentRecheckRef;recheckWire?:string;recheckView?:N.EnrollmentRecheckView;consumed:boolean;consentDigest?:string;binding?:BRecord};
type BRecord={cap:N.BindingRef;wire:string;attempt:ARecord;consent:Readonly<N.NativeConsentEnrollmentView>;deadline:number;focus?:FRecord;revoked:boolean};
type FRecord={cap:N.FocusSourceRef;wire:string;view:N.FocusSourceView;binding:BRecord;recordDigest?:string;ack?:N.FocusRecordAckView};
type BatchRecord={cap:N.PlannedNativeBatchRef;wire:string;attempt:ARecord;meta:BatchMeta;sequence:number;input:N.NativeSourceInputCap;
 targetWire:string;inputWire:string;expected:number;utf16:number;kind:'replace-field'|'fixed-return'|'click-approved-href'|'scroll-profile-wheel';
 snapshot?:N.SnapshotRef;snapshotWire?:string;sourceSnapshot?:N.NativeSourceSnapshotCap;expires:number;
 challenge?:N.MapChallengeRef;challengeWire?:string;map?:MRecord;permit?:PRecord;dispatch?:DRecord;postcondition?:N.NativeSourcePostconditionCap;evidence?:N.StepEvidenceRef;verifyBusy?:Promise<N.StepEvidenceRef>};
type MRecord={cap:N.NativeMapRef;wire:string;view:Readonly<N.NativeMapView>;batch:BatchRecord;digest:string};
type PRecord={cap:N.PermitRef;wire:string;batch:BatchRecord;challenge:N.DispatchChallengeRef;challengeWire:string;expires:number;consumed:boolean;
 commandCap?:N.BackendConsumedCommandRef|N.BackendConsumedEnterCommandRef;command?:N.NativeDispatchCommand;commandWire?:string;
 observed?:ReturnType<N.NativeObservedSourceRuntimePort['armNativeObservedCommand']>&{admissionWire?:string;successorWire:string;view?:N.DormantSearchSubmitAdmissionView};
 lateDigest?:string;lateLedger?:Readonly<N.NativeLedgerView>;dispatch?:DRecord};
type DRecord={cap:N.DispatchRef;wire:string;permit:PRecord;ledger:Readonly<N.NativeLedgerView>;digest:string;valid:boolean};
const hash=(value:unknown)=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function detached<T>(value:T):Readonly<T>{const cloned=structuredClone(value);const freeze=(v:any):any=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};return freeze(cloned);}
/** One server instance, one private listener and trusted peer boot. No DTO registers proof. */
export class BrowserNativeAuthority implements N.NativeAuthorityPort,N.NativeAuthorityIdentityPort,N.NativeObservedAuthorityInspectionPort {
  readonly evidenceKind:'genuine-native'|'simulated-native-producer';
  constructor(evidenceKind:'genuine-native'|'simulated-native-producer'='genuine-native'){
    if(evidenceKind==='simulated-native-producer'&&process.env.EDITH_TEST_MODE!=='true')deny('NATIVE_BROWSER_UNAVAILABLE',503);this.evidenceKind=evidenceKind;
  }
  private sources?:BrowserNativeAuthoritySources;
  private sourceBoot?:ReturnType<RuntimeProducer['inspectNativeBackendBoot']>;
  private readonly attempts=new WeakMap<N.AttemptRef,ARecord>();
  private readonly operations=new WeakMap<N.OriginalOperationLookupRef,ARecord>();
  private readonly activeAttempts=new Set<ARecord>();
  private readonly enrollments=new WeakMap<N.EnrollmentSourceRef,ERecord>();
  private readonly rechecks=new WeakMap<N.EnrollmentRecheckRef,ERecord>();
  private readonly bindings=new WeakMap<N.BindingRef,BRecord>();
  private readonly focuses=new WeakMap<N.FocusSourceRef,FRecord>();
  private readonly challenges=new WeakMap<N.MapChallengeRef,BatchRecord>();
  private readonly maps=new WeakMap<N.NativeMapRef,MRecord>();
  private readonly permits=new WeakMap<N.PermitRef,PRecord>();
  private readonly dispatches=new WeakMap<N.DispatchRef,DRecord>();
  private readonly dispatchChallenges=new WeakMap<N.DispatchChallengeRef,PRecord>();
  private readonly commands=new WeakMap<N.BackendConsumedCommandRef|N.BackendConsumedEnterCommandRef,PRecord>();
  private readonly completionPostconditions=new WeakMap<N.PostconditionRef,{attempt:ARecord;source:N.NativeSourcePostconditionCap}>();
  private readonly inputs=new WeakMap<N.ApprovedInputRef,BatchRecord>();
  private readonly snapshots=new WeakMap<N.SnapshotRef,BatchRecord>();
  private readonly wires=new Map<string,{kind:string;value:unknown}>();
  private readonly sourcePreparations=new WeakMap<N.AttemptRef,Promise<ARecord>>();
  private operationCount=0;
  private reservedSlots=0;
  private wire(kind:string,value:unknown,existing?:string):string{const id=existing??alias();const old=this.wires.get(id);if(old&&(old.kind!==kind||old.value!==value))deny('NATIVE_SCOPE_STALE',409);this.wires.set(id,{kind,value});return id;}
  private lookup<T>(wire:unknown,kind:string):T{reference(wire);const row=this.wires.get(wire as string);if(!row||row.kind!==kind)deny('NATIVE_SCOPE_STALE',409);return row!.value as T;}
  /** Called once by trusted backend composition; never reachable through HTTP. */
  bindSources(sources:BrowserNativeAuthoritySources):void {
    if(this.sources)deny('NATIVE_SCOPE_CONSUMED',409);
    for(const method of ['resolveIssuedAttemptLookup','resolveIssuedOperationLookup','resolveIssuedOperationAttempt','inspectNativeAttempt','guardOriginalAttempt','guardPreparedSnapshot','inspectNativeOperationState','inspectNativeBackendBoot','captureNativeAttemptSource','attachNativeBinding','prepareNativeAttemptBatches','prepareFreshNativeStep','inspectNativePlannedBatch','registerNativeDispatchScope','verifyNativeAttemptPair','inspectNativeLaunchDescriptor','inspectNativeTargetDescriptor','inspectNativeOperationBudget'] as const)if(typeof sources.producer[method]!=='function')deny('NATIVE_BROWSER_UNAVAILABLE',503);
    const boot=sources.producer.inspectNativeBackendBoot();reference(boot.backendBootLookupRef);
    if(!boot.backendBoot||typeof boot.backendBoot!=='object')deny('NATIVE_BROWSER_UNAVAILABLE',503);
    this.invalidateBoot();this.sources=Object.freeze({...sources});this.sourceBoot=boot;
  }
  private runtime():BrowserNativeAuthoritySources {if(!this.sources||!this.sourceBoot)deny('NATIVE_BROWSER_UNAVAILABLE',503);return this.sources!;}
  private observedRuntime():N.NativeObservedSourceRuntimePort {
    const producer=this.runtime().producer as Partial<N.NativeObservedSourceRuntimePort>;
    if(this.evidenceKind!=='genuine-native'||['supportsNativeObservedStrategy','guardNativeObservedProfile','armNativeObservedCommand','verifyNativeObservedOutcome','captureNativeObservedSuccessor'].some(method=>typeof producer[method as keyof N.NativeObservedSourceRuntimePort]!=='function'))deny('NATIVE_BROWSER_UNAVAILABLE',503);
    return producer as N.NativeObservedSourceRuntimePort;
  }
  private guard(a:ARecord,allowPaired=false):void {
    try {
      if(a.generation!==this.generation||a.nativeBoot!==this.currentBoot()||a.phase==='terminal'||a.phase==='paired'&&!allowPaired||Date.now()>=a.deadline)deny('NATIVE_SCOPE_STALE',409);
      const runtime=this.runtime();runtime.producer.guardOriginalAttempt(a.attempt);
      const now=runtime.producer.inspectNativeAttempt(a.attempt);
      if(now.backendBoot!==a.backendBoot||now.nativeBoot!==a.nativeBoot||now.taskId!==a.meta.taskId||now.requestHash!==a.meta.requestHash||now.originalOwnerBinding!==a.meta.originalOwnerBinding||now.operationLookupRef!==a.meta.operationLookupRef||now.attemptLookupRef!==a.meta.attemptLookupRef||now.operationDeadlineMs!==a.meta.operationDeadlineMs)deny('NATIVE_SCOPE_STALE',409);
      if(a.navigation?.observed&&!a.successor){
        if(!a.navigation.consumed||!a.navigation.commandCap||Date.now()>=a.navigation.observed.expiresAtMs)deny('NATIVE_SCOPE_STALE',409);
      }else{
        const current=a.successor?.source??a.source;runtime.engine.guardSource(current);
        const source=runtime.engine.inspectSource(current),identity=runtime.engine.inspectSourceIdentity(current);
        if(source.sourceEpochDigest!==(a.successor?.digest??a.digest)||source.requestHash!==a.meta.requestHash||source.context.taskId!==a.meta.taskId||source.context.actor!==a.meta.originalOwnerBinding||source.sessionId!==a.sourceFacts.sessionId||source.pageId!==a.sourceFacts.pageId||source.deadline!==a.sourceFacts.deadline||identity.attemptRef!==a.attempt||identity.nativeBootRef!==a.nativeBoot||identity.owner!==a.owner)deny('NATIVE_SCOPE_STALE',409);
      }
      if(a.binding&&(a.binding.revoked||Date.now()>=a.binding.deadline))deny('NATIVE_SCOPE_STALE',409);
    }catch{this.stop(a,'NATIVE_SCOPE_STALE');deny('NATIVE_SCOPE_STALE',409);}
  }
  private stop(a:ARecord,reason:string):void {if(a.phase==='terminal')return;if(a.timer)clearTimeout(a.timer);a.reason=reason;a.phase='terminal';if(a.binding)a.binding.revoked=true;a.reject(new BrowserNativeAuthorityError(reason,409));}
  private async prepareAttempt(peer:N.PrivateBridgeContext,attempt:N.AttemptRef,operation:N.OriginalOperationLookupRef):Promise<ARecord> {
    this.peer(peer);const old=this.attempts.get(attempt);if(old){this.guard(old);return old;}
    const pending=this.sourcePreparations.get(attempt);if(pending)return pending;
    const runtime=this.runtime(),nativeBoot=this.currentBoot();if(!nativeBoot)deny('NATIVE_BROWSER_UNAVAILABLE',503);
    if(this.operationCount>=256)deny('NATIVE_QUOTA_EXHAUSTED',409);this.operationCount++;
    const work=(async()=>{
      const meta=runtime.producer.inspectNativeAttempt(attempt);runtime.producer.guardOriginalAttempt(attempt);
      if(meta.attempt!==attempt||meta.backendBoot!==this.sourceBoot!.backendBoot||meta.nativeBoot!==nativeBoot||meta.operationDeadlineMs<=Date.now()||meta.operationDeadlineMs>meta.admittedAtMs+30000)deny('NATIVE_SCOPE_STALE',409);
      const source=await runtime.producer.captureNativeAttemptSource(attempt);this.peer(peer);runtime.producer.guardOriginalAttempt(attempt);runtime.engine.guardSource(source);
      const view=runtime.engine.inspectSource(source),identity=runtime.engine.inspectSourceIdentity(source);
      if(identity.attemptRef!==attempt||identity.nativeBootRef!==nativeBoot||view.context.taskId!==meta.taskId||view.context.actor!==meta.originalOwnerBinding||view.requestHash!==meta.requestHash||this.currentBoot()!==nativeBoot)deny('NATIVE_SCOPE_STALE',409);
      let resolve!:(value:N.NativeCompletionRefs)=>void,reject!:(error:Error)=>void;const completion=new Promise<N.NativeCompletionRefs>((yes,no)=>{resolve=yes;reject=no;});void completion.catch(()=>{});
      const a:ARecord={attempt,operation,meta,source,owner:identity.owner,sourceFacts:view,originalHeld:runtime.engine.inspectHeldSource(source),digest:view.sourceEpochDigest,deadline:Math.min(meta.operationDeadlineMs,view.deadline),phase:'enrollment',backendBoot:meta.backendBoot,nativeBoot,generation:this.generation,batches:[],next:0,effect:false,reason:'NATIVE_CONFIRMATION_REQUIRED',completion,resolve,reject,count:{logicalBatches:0,requestedEventCount:0,sentEventCount:0,cleanupRequestedCount:0,cleanupSentCount:0}};
      digest(a.digest);a.timer=setTimeout(()=>this.stop(a,'NATIVE_SCOPE_STALE'),Math.max(1,a.deadline-Date.now()));a.timer.unref();this.attempts.set(attempt,a);this.operations.set(operation,a);this.wire('operation',operation,meta.operationLookupRef);this.activeAttempts.add(a);return a;
    })();this.sourcePreparations.set(attempt,work);return work;
  }
  private readonly peers=new WeakMap<N.PrivateBridgeContext,Peer>();
  private readonly backendBoot=alias();
  private boot?:Boot;
  private listener?:string;
  private credentialDigest?:string;
  private generation=0;
  private checkCredentialIncarnation():void {
    const current=process.env.EDITH_DESKTOP_BRIDGE_TOKEN;
    const fingerprint=current?crypto.createHash('sha256').update(current).digest('hex'):undefined;
    if(this.credentialDigest&&fingerprint!==this.credentialDigest){this.invalidateBoot();this.listener=undefined;this.credentialDigest=undefined;}
  }
  currentBoot():N.NativeBootRef|undefined{this.checkCredentialIncarnation();return this.boot?.cap;}
  supportsStrategy(action:unknown):boolean{
    if(!this.sources||!this.currentBoot())return false;if(action==='fill_form')return true;
    if(!['search','navigate','scroll'].includes(String(action)))return false;
    try{return this.observedRuntime().supportsNativeObservedStrategy(action as 'search'|'navigate'|'scroll');}catch{return false;}
  }
  authenticatePrivateRequest(req:Request):N.PrivateBridgeContext {
    this.checkCredentialIncarnation();
    const remote=req.socket.remoteAddress??'',local=req.socket.localAddress??'',port=req.socket.localPort;
    const loopback=(v:string)=>['127.0.0.1','::1','::ffff:127.0.0.1'].includes(v);
    const host=local==='::1'?`[::1]:${port}`:`127.0.0.1:${port}`;
    if(!loopback(remote)||!loopback(local)||!port||req.get('host')!==host||req.get('origin')!==undefined
      ||Object.keys(req.headers).some(key=>key==='forwarded'||key.startsWith('x-forwarded-'))
      ||req.get('x-edith-desktop-runtime')!==undefined)deny('NATIVE_BRIDGE_UNAUTHORIZED',401);
    const configured=process.env.EDITH_DESKTOP_BRIDGE_TOKEN,supplied=/^Bearer ([^\s]+)$/.exec(req.get('authorization')??'')?.[1];
    if(!configured||!supplied)deny('NATIVE_BRIDGE_UNAUTHORIZED',401);
    const expected=Buffer.from(configured!),actual=Buffer.from(supplied!);
    if(expected.length!==actual.length||!crypto.timingSafeEqual(expected,actual))deny('NATIVE_BRIDGE_UNAUTHORIZED',401);
    const credentialDigest=crypto.createHash('sha256').update(expected).digest('hex');
    if(this.credentialDigest&&this.credentialDigest!==credentialDigest){this.invalidateBoot();this.listener=undefined;}
    if(this.listener&&this.listener!==host)deny('NATIVE_BRIDGE_UNAUTHORIZED',401);
    this.listener=host;this.credentialDigest=credentialDigest;
    const peer=cap<N.PrivateBridgeContext>();this.peers.set(peer,{listener:host,credentialDigest,generation:this.generation});return peer;
  }
  private peer(peer:N.PrivateBridgeContext):Peer {
    this.checkCredentialIncarnation();
    const row=this.peers.get(peer);if(!row||row.generation!==this.generation||row.listener!==this.listener||row.credentialDigest!==this.credentialDigest)deny('NATIVE_BRIDGE_UNAUTHORIZED',401);return row!;
  }
  private invalidateBoot():void {this.generation++;this.boot=undefined;for(const a of this.activeAttempts){if(a.batches.some(b=>b.permit?.consumed&&!b.dispatch))a.effect=true;this.stop(a,'NATIVE_SCOPE_STALE');}this.operationCount=0;}
  registerBoot(peer:N.PrivateBridgeContext,nativeBootNonce:string):N.NativeBootRef {
    this.peer(peer);reference(nativeBootNonce);
    if(this.boot?.nonce===nativeBootNonce)return this.boot.cap;
    this.invalidateBoot();const issued=cap<N.NativeBootRef>();this.boot={cap:issued,alias:alias(),nonce:nativeBootNonce,generation:this.generation};return issued;
  }
  private bootView():N.NativeBootView {if(!this.boot)deny('NATIVE_BROWSER_UNAVAILABLE',503);return Object.freeze({backendBootRef:this.sourceBoot?.backendBootLookupRef??this.backendBoot,nativeBootRef:this.boot!.alias});}
  prepareEnrollmentSource(peer:N.PrivateBridgeContext,attempt:N.AttemptRef):N.EnrollmentSourceRef {
    this.peer(peer);const a=this.attempts.get(attempt);if(!a)deny('NATIVE_BROWSER_UNAVAILABLE',503);this.guard(a!);
    if(a!.enrollment){if(a!.enrollment.consumed)deny('NATIVE_SCOPE_CONSUMED',409);return a!.enrollment.cap;}
    const issued=cap<N.EnrollmentSourceRef>(),challenge=cap<N.EnrollmentChallengeRef>(),wire=this.wire('enrollment',issued),challengeWire=this.wire('enrollment-challenge',challenge),boot=this.bootView();
    const view=detached<N.EnrollmentSourceView>({version:1,...boot,enrollmentSourceRef:wire,enrollmentChallengeRef:challengeWire,originalOwnerRef:a!.meta.originalOwnerRef,originalTaskRef:a!.meta.taskId,attemptRef:a!.meta.attemptLookupRef,operationRef:a!.meta.operationLookupRef,requestScopeDigest:a!.meta.requestHash,sourceEpochDigest:a!.digest,confirmationDescription:'Original browser '+a!.meta.request.action+' under the current owner and original Task.',issuedAtMs:Date.now(),operationDeadlineMs:a!.deadline,expiresAtMs:a!.deadline});
    const e:ERecord={cap:issued,wire,challenge,challengeWire,view,attempt:a!,consumed:false};this.enrollments.set(issued,e);a!.enrollment=e;return issued;
  }
  recheckEnrollmentSource(peer:N.PrivateBridgeContext,source:N.EnrollmentSourceRef,challenge:N.EnrollmentChallengeRef):N.EnrollmentRecheckRef {
    this.peer(peer);const e=this.enrollments.get(source);if(!e||e.challenge!==challenge)deny('NATIVE_SCOPE_STALE',409);this.guard(e!.attempt);if(e!.consumed)deny('NATIVE_SCOPE_CONSUMED',409);
    if(e!.recheck)return e!.recheck;
    const recheck=cap<N.EnrollmentRecheckRef>(),wire=this.wire('recheck',recheck);e!.recheck=recheck;e!.recheckWire=wire;this.rechecks.set(recheck,e!);
    e!.recheckView=detached({version:1,...this.bootView(),enrollmentSourceRef:e!.wire,enrollmentChallengeRef:e!.challengeWire,enrollmentRecheckRef:wire,sourceEpochDigest:e!.attempt.digest,expiresAtMs:e!.attempt.deadline});return recheck;
  }
  associateMeasuredConsent(peer:N.PrivateBridgeContext,source:N.EnrollmentSourceRef,recheck:N.EnrollmentRecheckRef,consent:N.MeasuredConsentTransfer):N.BindingRef {
    this.peer(peer);const e=this.enrollments.get(source);if(!e||this.rechecks.get(recheck)!==e||e.recheck!==recheck)deny('NATIVE_SCOPE_STALE',409);
    const a=e!.attempt,view=e!.view;this.guard(a);const c=detached(consent),valueHash=hash(c);
    if(e!.consumed){if(e!.consentDigest===valueHash&&e!.binding&&!e!.binding.revoked)return e!.binding.cap;deny('NATIVE_SCOPE_CONSUMED',409);}
    for(const key of ['backendBootRef','nativeBootRef','enrollmentSourceRef','enrollmentChallengeRef','originalOwnerRef','originalTaskRef','attemptRef','operationRef','requestScopeDigest','sourceEpochDigest'] as const)if(c[key]!==view[key])deny('NATIVE_SCOPE_STALE',409);
    if(c.enrollmentRecheckRef!==e!.recheckWire||c.approvedAtMs<view.issuedAtMs||c.approvedAtMs>Date.now()||c.expiresAtMs<=Date.now()||c.expiresAtMs>Math.min(a.deadline,c.localSessionExpiresAtMs,c.reservationExpiresAtMs,c.approvedAtMs+30000))deny('NATIVE_SCOPE_STALE',409);
    decodeNativePrivate('associate',{version:1,attemptRef:c.attemptRef,nativeSessionRef:c.nativeSessionRef,enrollmentSourceRef:c.enrollmentSourceRef,enrollmentChallengeRef:c.enrollmentChallengeRef,enrollmentRecheckRef:c.enrollmentRecheckRef,consentView:c});
    const binding=cap<N.BindingRef>(),b:BRecord={cap:binding,wire:this.wire('binding',binding),attempt:a,consent:c,deadline:c.expiresAtMs,revoked:false};
    e!.consumed=true;e!.consentDigest=valueHash;e!.binding=b;a.binding=b;this.bindings.set(binding,b);
    try{this.runtime().producer.attachNativeBinding(a.attempt,this,binding,a.source);this.guard(a);}catch(error){this.stop(a,'NATIVE_SCOPE_STALE');throw error;}
    return binding;
  }
  private async primeBinding(b:BRecord):Promise<void> {
    const a=b.attempt;if(a.batches.length)return;this.guard(a);const runtime=this.runtime();
    const batchCaps=await runtime.producer.prepareNativeAttemptBatches(a.attempt);this.guard(a);
    if(this.evidenceKind==='genuine-native'&&a.meta.request.action!=='fill_form')this.observedRuntime().guardNativeObservedProfile(a.attempt);
    if(!batchCaps.length||batchCaps.length>10)deny('NATIVE_QUOTA_EXHAUSTED',409);
    let primary=0,units=0;
    const batches=batchCaps.map((batch,sequence)=>{
      const meta=runtime.producer.inspectNativePlannedBatch(batch),input=runtime.engine.inspectInput(meta.sourceInput);
      if(meta.attempt!==a.attempt||meta.binding!==b.cap||meta.nativeBoot!==a.nativeBoot||meta.sourceEpochDigest!==a.digest||input.sourceEpochDigest!==a.digest)deny('NATIVE_SCOPE_STALE',409);
      const n=input.text?.length??0;primary+=input.expectedPrimaryEventCount;units+=n;
      let expected:number,kind:BatchRecord['kind'];
      if(input.kind==='replace-text'){
        if(!['fill_form','search'].includes(a.meta.request.action)||!input.text||/[\x00-\x1f\x7f]/.test(input.text)||/\p{Surrogate}/u.test(input.text))deny('NATIVE_BROWSER_UNAVAILABLE',503);
        expected=2+6+2*n;kind='replace-field';
      }else if(input.kind==='href-click'){
        if(a.meta.request.action!=='navigate'||sequence!==0||batchCaps.length!==1||input.text!==undefined)deny('NATIVE_BROWSER_UNAVAILABLE',503);
        expected=2;kind='click-approved-href';
      }else if(input.kind==='fixed-return'){
        if(a.meta.request.action!=='search'||sequence!==1||batchCaps.length!==2||input.text!==undefined||meta.sourceTarget!==runtime.producer.inspectNativePlannedBatch(batchCaps[0]).sourceTarget)deny('NATIVE_BROWSER_UNAVAILABLE',503);
        expected=2;kind='fixed-return';
      }else if(input.kind==='scroll-profile-wheel'){
        if(a.meta.request.action!=='scroll'||sequence!==0||batchCaps.length!==1||input.text!==undefined||!Number.isSafeInteger(a.meta.request.scrollDeltaY)||a.meta.request.scrollDeltaY===0)deny('NATIVE_BROWSER_UNAVAILABLE',503);
        expected=1;kind='scroll-profile-wheel';
      }else deny('NATIVE_BROWSER_UNAVAILABLE',503);
      if(meta.expectedPrimaryEventCount!==expected!||input.expectedPrimaryEventCount!==expected!)deny('NATIVE_SCOPE_STALE',409);
      const record:BatchRecord={cap:batch,wire:'',attempt:a,meta,sequence:sequence+1,input:meta.sourceInput,targetWire:'',inputWire:'',expected:expected!,utf16:n,kind:kind!,expires:a.deadline};
      record.wire=this.wire('batch',record);record.targetWire=this.wire('target',record);const inputCap=cap<N.ApprovedInputRef>();record.inputWire=this.wire('input',inputCap);this.inputs.set(inputCap,record);return record;
    });
    const slots=2+3*batches.length;
    if(primary+40*batches.length>20400||units>10000||slots>32||this.reservedSlots+slots>8192)deny('NATIVE_QUOTA_EXHAUSTED',409);
    const sourceBudget=runtime.producer.inspectNativeOperationBudget(a.attempt);this.guard(a);
    if(sourceBudget.logicalBatches!==batches.length||sourceBudget.primaryEventCount!==primary||sourceBudget.utf16Units!==units||sourceBudget.cleanupEventBudget>40*batches.length||sourceBudget.primaryEventCount+sourceBudget.cleanupEventBudget>20400||sourceBudget.recordSlots>32||sourceBudget.wholeResolutionLimit!==2||sourceBudget.batches.length!==batches.length||sourceBudget.batches.some((item,index)=>item.sequence!==index+1||item.kind!==batches[index].kind||item.primaryEventCount!==batches[index].expected||item.utf16Units!==batches[index].utf16||item.cleanupEventBudget>40))deny('NATIVE_SCOPE_STALE',409);
    this.reservedSlots+=slots;this.guard(a);a.batches=batches;a.phase='focus';a.reason='NATIVE_FOCUS_REQUIRED';
  }
  verifyIssuedBinding(binding:N.BindingRef,attempt:N.AttemptRef,backendBoot:N.BackendBootRef,nativeBoot:N.NativeBootRef):boolean {
    const b=this.bindings.get(binding);if(!b||b.attempt.attempt!==attempt||b.attempt.backendBoot!==backendBoot||b.attempt.nativeBoot!==nativeBoot)return false;
    try{this.guard(b.attempt,true);return true;}catch{return false;}
  }
  prepareOriginalFocusSource(peer:N.PrivateBridgeContext,operation:N.OriginalOperationLookupRef,binding:N.BindingRef):N.FocusSourceRef {
    this.peer(peer);const b=this.bindings.get(binding);if(!b||this.runtime().producer.resolveIssuedOperationAttempt(operation)!==b.attempt.attempt)deny('NATIVE_SCOPE_STALE',409);
    const a=b!.attempt;this.guard(a);if(a.phase!=='focus')deny('NATIVE_SCOPE_CONSUMED',409);
    if(b!.focus)return b!.focus.cap;
    const source=cap<N.FocusSourceRef>(),wire=this.wire('focus',source),root=this.wire('original-root',b!);
    const f:FRecord={cap:source,wire,binding:b!,view:detached({version:1,operationRef:a.meta.operationLookupRef,bindingRef:b!.wire,focusSourceRef:wire,sourceEpochDigest:a.digest,originalRootWindowRef:root,allowedForeground:'managed-edith-or-original-chrome',expiresAtMs:Math.min(Date.now()+1000,b!.deadline,a.deadline)})};
    b!.focus=f;this.focuses.set(source,f);return source;
  }
  recordOriginalNativeFocus(peer:N.PrivateBridgeContext,source:N.FocusSourceRef,measured:N.MeasuredOriginalFocusTransfer):N.FocusRecordAckView {
    this.peer(peer);const f=this.focuses.get(source);if(!f)deny('NATIVE_SCOPE_STALE',409);const b=f!.binding,a=b.attempt,m=detached(measured),recordHash=hash(m);
    if(f!.recordDigest){if(f!.recordDigest!==recordHash)deny('NATIVE_SCOPE_CONSUMED',409);return f!.ack!;}
    decodeNativePrivate('focus/record',{version:1,operationRef:a.meta.operationLookupRef,bindingRef:b.wire,focusSourceRef:f!.wire,focusRecord:m});
    if(m.sourceEpochDigest!==a.digest||m.nativeBootRef!==b.consent.nativeBootRef||m.nativeSessionRef!==b.consent.nativeSessionRef||m.computerSessionGeneration!==b.consent.computerSessionGeneration||m.reservationRef!==b.consent.reservationRef||m.reservationGeneration!==b.consent.reservationGeneration||m.nativeStopEpoch!==b.consent.nativeStopEpoch||m.originalRootWindowRef!==f!.view.originalRootWindowRef)deny('NATIVE_SCOPE_STALE',409);
    a.effect ||= m.possibleEffect;f!.recordDigest=recordHash;
    let current=true;try{this.guard(a);}catch{current=false;}
    const success=current&&Date.now()<f!.view.expiresAtMs&&m.expiresAtMs<=f!.view.expiresAtMs&&m.measuredAfterAtMs<=f!.view.expiresAtMs&&m.measuredAfterAtMs<=Date.now()&&m.afterGuardsCurrent&&m.rootAssociationCurrent&&m.afterForeground==='original-chrome'&&(m.kind==='already-foreground'||m.apiBool!==null&&m.apiBool!==0);
    f!.ack=detached({version:1,operationRef:a.meta.operationLookupRef,focusSourceRef:f!.wire,focusActionRef:m.focusActionRef,outcome:success?(m.kind==='already-foreground'?'already-foreground':'focused'):m.possibleEffect?'unknown':'denied',possibleEffect:m.possibleEffect});
    if(!success)this.stop(a,'NATIVE_FOCUS_FAILED');return f!.ack;
  }
  private async prepareNextSnapshot(a:ARecord):Promise<void> {
    this.guard(a);const batch=a.batches[a.next];if(!batch)deny('NATIVE_SCOPE_STALE',409);
    if(batch.snapshot)deny('NATIVE_SCOPE_CONSUMED',409);
    a.phase='verifying';const snapshot=await this.runtime().producer.prepareFreshNativeStep(a.binding!.cap,a.attempt,batch.cap);this.guard(a);
    const meta=this.runtime().producer.inspectNativePlannedBatch(batch.cap);
    if(meta.snapshot!==snapshot||!meta.sourceSnapshot||meta.attempt!==a.attempt||meta.binding!==a.binding!.cap)deny('NATIVE_SCOPE_STALE',409);
    this.runtime().producer.guardPreparedSnapshot(snapshot,a.binding!.cap,a.attempt,batch.cap);
    batch.meta=meta;batch.snapshot=snapshot;batch.sourceSnapshot=meta.sourceSnapshot;batch.snapshotWire=this.wire('snapshot',snapshot);batch.expires=Math.min(meta.expiresAtMs,a.binding!.deadline,a.deadline,Date.now()+1000);this.snapshots.set(snapshot,batch);
    this.issueMapChallenge(a.binding!.cap,snapshot);a.phase='measure';a.reason='NATIVE_MAP_REQUIRED';
  }
  issueMapChallenge(binding:N.BindingRef,snapshot:N.SnapshotRef):N.MapChallengeRef {
    const b=this.bindings.get(binding),batch=this.snapshots.get(snapshot);if(!b||!batch||batch.attempt!==b.attempt)deny('NATIVE_SCOPE_STALE',409);this.guard(b!.attempt);
    if(Date.now()>=batch!.expires||batch!.map||batch!.permit)deny('NATIVE_SCOPE_CONSUMED',409);
    if(batch!.challenge)return batch!.challenge;
    const challenge=cap<N.MapChallengeRef>();batch!.challenge=challenge;batch!.challengeWire=this.wire('map-challenge',challenge);this.challenges.set(challenge,batch!);return challenge;
  }
  acceptMeasuredMap(peer:N.PrivateBridgeContext,challenge:N.MapChallengeRef,mapWire:N.NativeMapView):N.NativeMapRef {
    this.peer(peer);const batch=this.challenges.get(challenge);if(!batch)deny('NATIVE_SCOPE_STALE',409);const a=batch!.attempt,b=a.binding!;this.guard(a);
    const m=detached(mapWire);decodeNativePrivate('map',{challengeRef:m.challengeRef,mapRef:m.mapRef,mapView:m});
    if(m.challengeRef!==batch!.challengeWire||m.backendBootRef!==this.bootView().backendBootRef||m.nativeBootRef!==b.consent.nativeBootRef||m.originalTaskRef!==a.meta.taskId||m.operationRef!==a.meta.operationLookupRef||m.actionBatchRef!==batch!.wire||m.snapshotRef!==batch!.snapshotWire||m.sourceEpochDigest!==a.digest||m.nativeSessionRef!==b.consent.nativeSessionRef||m.nativeSessionGeneration!==b.consent.computerSessionGeneration||m.localConsentRef!==b.consent.consentRef||m.reservationRef!==b.consent.reservationRef||m.reservationGeneration!==b.consent.reservationGeneration||m.nativeStopEpoch!==b.consent.nativeStopEpoch||m.measuredAtMs>Date.now()||m.expiresAtMs>Date.now()+1000||m.expiresAtMs>batch!.expires||m.expiresAtMs<=Date.now())deny('NATIVE_SCOPE_STALE',409);
    if(a.phase!=='measure'||batch!.permit)deny('NATIVE_SCOPE_CONSUMED',409);
    const launch=this.runtime().producer.inspectNativeLaunchDescriptor(a.source),target=this.runtime().producer.inspectNativeTargetDescriptor(a.source,batch!.meta.sourceTarget,batch!.sourceSnapshot!);
    // Source DOM and native UIA document/runtime aliases belong to distinct issuers.
    // The actual source snapshot/target join is authenticated separately; the private
    // native constructor measures its own root/content/UIA hit and target predicate.
    this.runtime().producer.guardPreparedSnapshot(batch!.snapshot!,b.cap,a.attempt,batch!.cap);
    const sourceSnapshot=this.runtime().engine.inspectSnapshot(batch!.sourceSnapshot!);
    this.guard(a);if(sourceSnapshot.sourceEpochDigest!==a.digest||!target.engineTargetIdentityDigest||m.processLaunchRef!==launch.processLaunchRef||m.executableFingerprint!==launch.executableSha256)deny('NATIVE_SCOPE_STALE',409);
    const mapDigest=hash(m);if(batch!.map){if(batch!.map.digest!==mapDigest)deny('NATIVE_SCOPE_CONSUMED',409);return batch!.map.cap;}
    const map=cap<N.NativeMapRef>(),record:MRecord={cap:map,wire:m.mapRef,view:m,batch:batch!,digest:mapDigest};this.wire('map',map,m.mapRef);this.maps.set(map,record);batch!.map=record;return map;
  }
  async claimStep(binding:N.BindingRef,snapshot:N.SnapshotRef,map:N.NativeMapRef):Promise<N.PermitRef> {
    const b=this.bindings.get(binding),m=this.maps.get(map),batch=this.snapshots.get(snapshot);
    if(!b||!m||!batch||m.batch!==batch||batch.attempt!==b.attempt||batch.snapshot!==snapshot)deny('NATIVE_SCOPE_STALE',409);
    const a=b!.attempt;this.guard(a);this.runtime().producer.guardPreparedSnapshot(snapshot,binding,a.attempt,batch!.cap);
    if(Date.now()>=m!.view.expiresAtMs||Date.now()>=batch!.expires)deny('NATIVE_SCOPE_STALE',409);
    if(batch!.permit){if(batch!.permit.consumed)deny('NATIVE_SCOPE_CONSUMED',409);return batch!.permit.cap;}
    const issued=cap<N.PermitRef>(),challenge=cap<N.DispatchChallengeRef>();
    const p:PRecord={cap:issued,wire:this.wire('permit',issued),batch:batch!,challenge,challengeWire:this.wire('dispatch-challenge',challenge),expires:Math.min(batch!.expires,m!.view.expiresAtMs,b!.deadline),consumed:false};
    this.permits.set(issued,p);this.dispatchChallenges.set(challenge,p);batch!.permit=p;
    try{this.runtime().producer.registerNativeDispatchScope(a.attempt,this,batch!.cap,snapshot,issued);this.guard(a);}catch(error){p.consumed=true;this.stop(a,'NATIVE_SCOPE_STALE');throw error;}
    a.phase='dispatch';a.reason='NATIVE_DISPATCH_READY';return issued;
  }
  consumeForDispatch(peer:N.PrivateBridgeContext,permit:N.PermitRef):N.NativeDispatchCommand {
    this.peer(peer);const p=this.permits.get(permit);if(!p)deny('NATIVE_SCOPE_STALE',409);const a=p!.batch.attempt;this.guard(a);
    if(p!.consumed)deny('NATIVE_SCOPE_CONSUMED',409);if(Date.now()>=p!.expires)deny('NATIVE_SCOPE_STALE',409);
    this.runtime().producer.guardPreparedSnapshot(p!.batch.snapshot!,a.binding!.cap,a.attempt,p!.batch.cap);
    p!.consumed=true;a.effect=true; // Lost acknowledgement is conservatively a possible effect.
    const commandCap=p!.batch.kind==='fixed-return'?cap<N.BackendConsumedEnterCommandRef>():cap<N.BackendConsumedCommandRef>(),wire=this.wire('command',commandCap);p!.commandCap=commandCap;p!.commandWire=wire;this.commands.set(commandCap,p!);
    p!.command=detached({commandRef:wire,permitRef:p!.wire,operationRef:a.meta.operationLookupRef,actionBatchRef:p!.batch.wire,targetRef:p!.batch.targetWire,approvedInputRef:p!.batch.inputWire,expiresAtMs:p!.expires,sourceEpochDigest:a.digest});return p!.command;
  }
  resolveOriginalNativeInput(peer:N.PrivateBridgeContext,command:N.BackendConsumedCommandRef,input:N.ApprovedInputRef):N.ResolvedNativeInputWireView {
    this.peer(peer);const p=this.commands.get(command),batch=this.inputs.get(input);if(!p||!batch||p.batch!==batch||!p.consumed||p.dispatch||Date.now()>=p.expires)deny('NATIVE_SCOPE_STALE',409);
    this.guard(batch!.attempt);const actual=this.runtime().engine.inspectInput(batch!.input);
    if(actual.expectedPrimaryEventCount!==batch!.expected||actual.sourceEpochDigest!==batch!.attempt.digest)deny('NATIVE_SCOPE_STALE',409);
    const common={version:1 as const,commandRef:p!.commandWire!,approvedInputRef:batch!.inputWire,expiresAtMs:p!.expires};
    if(batch!.kind==='replace-field'){
      if(actual.kind!=='replace-text'||actual.text===undefined||actual.text.length!==batch!.utf16)deny('NATIVE_SCOPE_STALE',409);
      return detached({...common,kind:'replace-field',targetRef:batch!.targetWire,text:actual.text!,utf16Units:batch!.utf16,clearPlan:'ctrl-a-backspace',expectedPrimaryEventCount:batch!.expected});
    }
    if(batch!.kind==='scroll-profile-wheel'){
      const delta=batch!.attempt.meta.request.scrollDeltaY;
      if(actual.kind!=='scroll-profile-wheel'||actual.text!==undefined||batch!.expected!==1||batch!.attempt.meta.request.action!=='scroll'||!Number.isSafeInteger(delta)||delta===0)deny('NATIVE_SCOPE_STALE',409);
      return detached({...common,kind:'scroll-profile-wheel',surfaceRef:batch!.targetWire,direction:delta!<0?'up' as const:'down' as const,wheelDelta:delta!<0?-120 as const:120 as const,expectedPrimaryEventCount:1 as const});
    }
    if(batch!.kind==='fixed-return'){
      if(actual.kind!=='fixed-return'||batch!.expected!==2)deny('NATIVE_SCOPE_STALE',409);
      const arm=this.armOriginalNativeInput(peer,command as unknown as N.BackendConsumedEnterCommandRef,input);
      return detached({...common,kind:'fixed-return',targetRef:batch!.targetWire,searchSubmitAdmissionRef:arm.searchSubmitAdmissionRef,causalSuccessorRef:arm.causalSuccessorRef,expectedPrimaryEventCount:2 as const});
    }
    if(batch!.kind==='click-approved-href'){
      if(actual.kind!=='href-click'||batch!.expected!==2)deny('NATIVE_SCOPE_STALE',409);
      const association=this.armObserved(p!);
      return detached({...common,kind:'click-approved-href',targetRef:batch!.targetWire,causalSuccessorRef:association.successorWire,expectedPrimaryEventCount:2 as const});
    }
    return deny('NATIVE_BROWSER_UNAVAILABLE',503);
  }
  armOriginalNativeInput(peer:N.PrivateBridgeContext,command:N.BackendConsumedEnterCommandRef,input:N.ApprovedInputRef):N.DormantSearchSubmitAdmissionView {
    this.peer(peer);const p=this.commands.get(command as unknown as N.BackendConsumedCommandRef),batch=this.inputs.get(input);
    if(!p||!batch||p.batch!==batch||!p.consumed||p.dispatch||Date.now()>=p.expires)deny('NATIVE_SCOPE_STALE',409);
    this.guard(batch!.attempt);
    if(batch!.kind!=='fixed-return')return deny('NATIVE_BROWSER_UNAVAILABLE',503);
    const association=this.armObserved(p!);if(!association.admissionWire)deny('NATIVE_BROWSER_UNAVAILABLE',503);
    return association.view??=detached({version:1,commandRef:p!.commandWire!,approvedInputRef:batch!.inputWire,searchSubmitAdmissionRef:association.admissionWire!,causalSuccessorRef:association.successorWire,expiresAtMs:association.expiresAtMs});
  }
  assertIssuedObservedCommand(scope:Parameters<N.NativeObservedAuthorityInspectionPort['assertIssuedObservedCommand']>[0]):void {
    const p=this.commands.get(scope.command);
    if(!p||!p.consumed||p.commandCap!==scope.command||p.batch.attempt.attempt!==scope.attempt||p.batch.cap!==scope.batch||!p.batch.snapshot||!p.batch.map||Date.now()>=p.expires)deny('NATIVE_SCOPE_STALE',409);
    this.guard(p.batch.attempt);
  }
  private armObserved(p:PRecord):NonNullable<PRecord['observed']> {
    this.assertIssuedObservedCommand({attempt:p.batch.attempt.attempt,batch:p.batch.cap,command:p.commandCap!});
    const a=p.batch.attempt;
    if(p.observed){if(Date.now()>=p.observed.expiresAtMs)deny('NATIVE_SCOPE_STALE',409);return p.observed;}
    if(p.dispatch||!['fixed-return','click-approved-href'].includes(p.batch.kind))deny('NATIVE_SCOPE_STALE',409);
    const runtime=this.observedRuntime();runtime.guardNativeObservedProfile(a.attempt);
    let replacement:{dispatch:N.DispatchRef;postcondition:N.NativeSourcePostconditionCap}|undefined;
    if(p.batch.kind==='fixed-return'){
      const first=a.batches[0];
      if(a.meta.request.action!=='search'||p.batch.sequence!==2||a.next!==1||!first?.dispatch?.valid||!first.evidence||!first.postcondition||first.meta.sourceTarget!==p.batch.meta.sourceTarget)deny('NATIVE_SCOPE_STALE',409);
      replacement={dispatch:first.dispatch!.cap,postcondition:first.postcondition!};
    }else if(a.meta.request.action!=='navigate'||p.batch.sequence!==1||a.batches.length!==1)deny('NATIVE_SCOPE_STALE',409);
    const issued=runtime.armNativeObservedCommand({attempt:a.attempt,batch:p.batch.cap,command:p.commandCap!,...(replacement&&{replacement})});
    this.guard(a);
    if(!issued.successor||typeof issued.successor!=='object'||!Number.isSafeInteger(issued.expiresAtMs)||issued.expiresAtMs<=Date.now()||issued.expiresAtMs>a.deadline||(p.batch.kind==='fixed-return')!==!!issued.admission)deny('NATIVE_SCOPE_STALE',409);
    p.observed={...issued,expiresAtMs:Math.min(issued.expiresAtMs,p.expires,a.binding!.deadline,a.deadline),...(issued.admission&&{admissionWire:this.wire('observed-admission',issued.admission)}),successorWire:this.wire('observed-successor',issued.successor)};
    a.navigation=p;return p.observed;
  }
  recordMeasuredDispatch(peer:N.PrivateBridgeContext,challenge:N.DispatchChallengeRef,ledger:N.NativeLedgerView):N.DispatchRef {
    if(!this.peers.has(peer))deny('NATIVE_BRIDGE_UNAUTHORIZED',401);
    const p=this.dispatchChallenges.get(challenge);if(!p||!p.consumed||!p.command||!p.batch.map)deny('NATIVE_SCOPE_STALE',409);
    const a=p!.batch.attempt,m=p!.batch.map!.view,l=detached(ledger);decodeNativePrivate('dispatch',{challengeRef:l.challengeRef,permitRef:l.permitRef,ledgerRef:l.ledgerRef,ledgerView:l});
    if(l.challengeRef!==p!.challengeWire||l.permitRef!==p!.wire||l.operationRef!==a.meta.operationLookupRef||l.actionBatchRef!==p!.batch.wire||l.sequence!==p!.batch.sequence||l.backendBootRef!==m.backendBootRef||l.nativeBootRef!==m.nativeBootRef||l.processLaunchRef!==m.processLaunchRef||l.kernelIdentityRef!==m.kernelIdentityRef||l.viewportMapRef!==m.mapRef||l.nativeSessionRef!==m.nativeSessionRef||l.nativeSessionGeneration!==m.nativeSessionGeneration||l.localConsentRef!==m.localConsentRef||l.reservationRef!==m.reservationRef||l.reservationGeneration!==m.reservationGeneration||l.nativeStopEpoch!==m.nativeStopEpoch)deny('NATIVE_SCOPE_STALE',409);
    const ledgerDigest=hash(l);if(p!.dispatch){if(p!.dispatch.digest!==ledgerDigest)deny('NATIVE_SCOPE_CONSUMED',409);return p!.dispatch.cap;}
    const effect=l.possibleEffect||l.cursorEffect||l.focusEffect||l.sentEventCount>0||l.cleanupSentCount>0;a.effect ||= effect;
    // Seal measured history BEFORE a current guard can reject late/lost authority.
    const issued=cap<N.DispatchRef>(),record:DRecord={cap:issued,wire:l.ledgerRef,permit:p!,ledger:l,digest:ledgerDigest,valid:false};
    this.wire('dispatch',issued,l.ledgerRef);this.dispatches.set(issued,record);p!.dispatch=record;p!.batch.dispatch=record;
    a.count.logicalBatches++;a.count.requestedEventCount+=l.requestedEventCount;a.count.sentEventCount+=l.sentEventCount;a.count.cleanupRequestedCount+=l.cleanupRequestedCount;a.count.cleanupSentCount+=l.cleanupSentCount;
    let current=true;try{this.peer(peer);this.guard(a);
      if(p!.observed){if(!a.successor||!a.successorView||Date.now()>=a.successorView.expiresAtMs)deny('NATIVE_SCOPE_STALE',409);}
      else this.runtime().producer.guardPreparedSnapshot(p!.batch.snapshot!,a.binding!.cap,a.attempt,p!.batch.cap);
    }catch{current=false;}
    record.valid=current&&this.evidenceKind==='genuine-native'&&l.result==='sent'&&l.requestedEventCount===p!.batch.expected&&l.sentEventCount===p!.batch.expected&&l.cleanupRequestedCount<=40&&l.cleanupRequestedCount===l.cleanupSentCount&&l.claimedAtMs>=a.meta.admittedAtMs&&l.claimedAtMs<=p!.expires&&l.completedAtMs<=p!.expires&&l.completedAtMs<=a.deadline&&l.completedAtMs<=Date.now();
    if(this.evidenceKind!=='genuine-native')this.stop(a,'NATIVE_SIMULATION_NO_PROOF');
    else if(!record.valid)this.stop(a,'NATIVE_EFFECT_OUTCOME_UNKNOWN');
    else if(!current||l.result!=='sent'||l.requestedEventCount!==p!.batch.expected||l.sentEventCount!==p!.batch.expected||l.completedAtMs>p!.expires)this.stop(a,'NATIVE_EFFECT_OUTCOME_UNKNOWN');
    return issued;
  }
  inspectIssuedDispatch(dispatch:N.DispatchRef,scope:Readonly<{attempt:N.AttemptRef;batch:N.PlannedNativeBatchRef;snapshot:N.SnapshotRef;sourceEpochDigest:string}>):Readonly<N.NativeLedgerView>|undefined {
    const record=this.dispatches.get(dispatch),batch=record?.permit.batch;if(!record?.valid||!batch||batch.attempt.attempt!==scope.attempt||batch.cap!==scope.batch||batch.snapshot!==scope.snapshot||batch.attempt.digest!==scope.sourceEpochDigest)return undefined;
    try{this.guard(batch.attempt,true);return record.ledger;}catch{return undefined;}
  }
  verifyIssuedDispatch(dispatch:N.DispatchRef,scope:N.NativeIssuedScope):boolean {
    return this.verifyIssuedBinding(scope.binding,scope.attempt,scope.backendBoot,scope.nativeBoot)&&!!this.inspectIssuedDispatch(dispatch,{attempt:scope.attempt,batch:scope.batch,snapshot:scope.snapshot,sourceEpochDigest:this.bindings.get(scope.binding)?.attempt.digest??''})&&this.dispatches.get(dispatch)?.permit.cap===scope.permit;
  }
  async verifyAndFinishStep(permit:N.PermitRef,dispatch:N.DispatchRef):Promise<N.StepEvidenceRef> {
    const p=this.permits.get(permit),d=this.dispatches.get(dispatch);if(!p||!d||d.permit!==p||!d.valid||this.evidenceKind!=='genuine-native')deny('NATIVE_BROWSER_UNAVAILABLE',503);
    const batch=p!.batch,a=batch.attempt;if(batch.evidence)return batch.evidence;this.guard(a,true);if(batch.verifyBusy)return batch.verifyBusy;
    const work=(async()=>{a.phase='verifying';const runtime=this.runtime();let post:N.NativeSourcePostconditionCap;
      if(p!.observed){
        if(!a.successor||!a.successorView||Date.now()>=a.successorView.expiresAtMs)deny('NATIVE_SCOPE_STALE',409);
        post=await this.observedRuntime().verifyNativeObservedOutcome({attempt:a.attempt,batch:batch.cap,command:p!.commandCap!,dispatch:d!.cap,...(p!.observed.admission&&{admission:p!.observed.admission}),successor:p!.observed.successor});
      }else post=await runtime.engine.verifyPostcondition(a.source,batch.meta.sourceTarget,a.meta.request);
      this.guard(a);
      if(!runtime.engine.verifyIssuedPostcondition(post,a.successor?.source??a.source,batch.meta.sourceTarget))deny('NATIVE_SCOPE_STALE',409);
      batch.postcondition=post;const evidence=cap<N.StepEvidenceRef>();batch.evidence=evidence;
      if(a.next!==batch.sequence-1)deny('NATIVE_SCOPE_STALE',409);a.next++;
      if(a.next===a.batches.length){const wrapper=cap<N.PostconditionRef>();this.completionPostconditions.set(wrapper,{attempt:a,source:post});if(a.timer)clearTimeout(a.timer);a.phase='paired';a.resolve(Object.freeze({dispatches:Object.freeze(a.batches.map(b=>b.dispatch!.cap)),postcondition:wrapper}));}
      else await this.prepareNextSnapshot(a);return evidence;
    })();batch.verifyBusy=work;try{return await work;}catch(error){this.stop(a,'NATIVE_POSTCONDITION_FAILED');throw error;}
  }
  awaitCompletion(attempt:N.AttemptRef,scope:N.NativeCompletionScope):Promise<N.NativeCompletionRefs> {
    const a=this.attempts.get(attempt);if(!a||scope.binding!==a.binding?.cap||scope.nativeBoot!==a.nativeBoot||scope.sourceEpochDigest!==a.digest||scope.deadline!==a.meta.operationDeadlineMs)deny('NATIVE_SCOPE_STALE',409);
    this.guard(a!,true);return a!.completion;
  }
  revoke(binding:N.BindingRef,_reason:N.StopReason):void {const b=this.bindings.get(binding);if(!b)deny('NATIVE_SCOPE_STALE',409);this.stop(b!.attempt,'NATIVE_SCOPE_STALE');}
  private status(a:ARecord):N.NativeBrowserSafeStatus {
    const state=this.sources?.producer.inspectNativeOperationState(a.attempt);
    const complete=this.evidenceKind==='genuine-native'&&a.phase==='paired'&&state?.phase!=='revoked'&&state?.paired&&state.canonicalLeafSettled&&state.taskStatus!=='CANCELLED'&&state.taskStatus!=='WAITING_FOR_APPROVAL';
    return detached({status:complete?'complete':a.phase==='terminal'?a.effect?'unknown':'denied':a.phase==='dispatch'&&!a.batches[a.next]?.permit?.consumed?'ready':'unavailable',reasonCode:complete?'NATIVE_PAIR_SETTLED':a.reason,...a.count,possibleEffect:a.effect});
  }
  async readOriginalNativeNext(peer:N.PrivateBridgeContext,operation:N.OriginalOperationLookupRef):Promise<N.NativeDriverNextView> {
    this.peer(peer);const a=this.operations.get(operation);
    if(!a)deny('NATIVE_BROWSER_UNAVAILABLE',503);
    // Readonly: no source preparation, phase admission, quota allocation or TTL extension.
    const op=a!.meta.operationLookupRef;
    if(a!.phase==='terminal'||a!.phase==='paired')return detached({version:1,phase:'terminal',operationRef:op,safeStatus:this.status(a!)});
    this.guard(a!);const batch=a!.batches[a!.next];
    if(a!.phase==='enrollment')return detached({version:1,phase:'enrollment',operationRef:op,attemptRef:a!.meta.attemptLookupRef});
    if(a!.phase==='focus'&&a!.binding?.focus)return detached({version:1,phase:'focus',operationRef:op,bindingRef:a!.binding.wire,focusSourceRef:a!.binding.focus.wire});
    if(a!.phase==='measure'&&batch?.snapshotWire&&batch.challengeWire)return detached({version:1,phase:'measure',operationRef:op,bindingRef:a!.binding!.wire,batchRef:batch.wire,snapshotRef:batch.snapshotWire,mapChallengeRef:batch.challengeWire});
    if(a!.phase==='dispatch'&&batch?.permit&&!batch.permit.consumed)return detached({version:1,phase:'dispatch',operationRef:op,batchRef:batch.wire,permitRef:batch.permit.wire});
    return detached({version:1,phase:'idle',operationRef:op,reasonCode:'NATIVE_PHASE_PENDING'});
  }
  private async boundSource(b:BRecord):Promise<N.NativeBoundSourceView> {
    const a=b.attempt;this.guard(a,true);if(!b.focus)deny('NATIVE_BROWSER_UNAVAILABLE',503);
    if(a.navigation?.observed){const successor=await this.boundSuccessor(b);if(successor)return successor;}
    const runtime=this.runtime(),held=runtime.engine.inspectHeldSource(a.source),launch=runtime.producer.inspectNativeLaunchDescriptor(a.source);this.guard(a,true);
    const inventory=held.inventory;
    if(inventory.dirty||inventory.contextCount!==1||inventory.pageCount!==1||inventory.frameCount!==1||inventory.targetTypes.some(type=>!['browser','page'].includes(type)))deny('NATIVE_BROWSER_UNAVAILABLE',503);
    const viewport=await held.launch.page.evaluate(()=>({widthCss:window.innerWidth,heightCss:window.innerHeight,scrollX:window.scrollX,scrollY:window.scrollY,dpr:window.devicePixelRatio,visualScale:window.visualViewport?.scale??1,visualOffsetX:window.visualViewport?.offsetLeft??0,visualOffsetY:window.visualViewport?.offsetTop??0}));this.guard(a,true);
    if(viewport.dpr!==1||viewport.visualScale!==1||viewport.visualOffsetX!==0||viewport.visualOffsetY!==0||!Number.isFinite(viewport.widthCss)||!Number.isFinite(viewport.heightCss))deny('NATIVE_BROWSER_UNAVAILABLE',503);
    const batch=a.batches[a.next],preFocus=a.phase==='focus';
    if(!preFocus&&(!batch?.sourceSnapshot||!batch.snapshotWire||!batch.challengeWire))deny('NATIVE_SCOPE_STALE',409);
    const target=preFocus?null:{...runtime.producer.inspectNativeTargetDescriptor(a.source,batch!.meta.sourceTarget,batch!.sourceSnapshot!),targetRef:batch!.targetWire};this.guard(a,true);
    const actualBudget=runtime.producer.inspectNativeOperationBudget(a.attempt);this.guard(a,true);
    if(actualBudget.logicalBatches!==a.batches.length||actualBudget.primaryEventCount!==a.batches.reduce((n,x)=>n+x.expected,0)||actualBudget.utf16Units!==a.batches.reduce((n,x)=>n+x.utf16,0)||actualBudget.batches.length!==a.batches.length||actualBudget.recordSlots>32||actualBudget.wholeResolutionLimit!==2)deny('NATIVE_SCOPE_STALE',409);
    const budget:N.NativeOperationBudgetDescriptor={...actualBudget,batches:actualBudget.batches.map((x,index)=>({...x,batchRef:a.batches[index].wire}))};
    const common={version:1 as const,phase:'bound-source' as const,...this.bootView(),attemptRef:a.meta.attemptLookupRef,operationRef:a.meta.operationLookupRef,bindingRef:b.wire,originalTaskRef:a.meta.taskId,originalOwnerRef:a.meta.originalOwnerRef,sourceEpochDigest:a.digest,requestScopeDigest:a.meta.requestHash,processLaunchRef:launch.processLaunchRef,originalRootWindowRef:b.focus.view.originalRootWindowRef,issuedAtMs:Date.now(),operationDeadlineMs:a.deadline,expiresAtMs:Math.min(Date.now()+1000,b.deadline,a.deadline,...(!preFocus?[batch!.expires,batch!.map?.view.expiresAtMs??Infinity,batch!.permit?.expires??Infinity,batch!.permit?.command?.expiresAtMs??Infinity,batch!.permit?.observed?.expiresAtMs??Infinity]:[])),launch,inventory:{inventoryEpoch:inventory.inventoryEpoch,observedAtMs:Date.parse(inventory.observedAt),complete:true as const,dirty:false as const,contextCount:1 as const,pageCount:1 as const,frameCount:1 as const,targetId:inventory.targetId,frameId:inventory.frameId,loaderId:inventory.loaderId,targetTypes:inventory.targetTypes.map(type=>type==='browser'?'browser' as const:'page' as const)},viewport:{...viewport,dpr:1 as const,visualScale:1 as const,visualOffsetX:0 as const,visualOffsetY:0 as const},budget};
    return preFocus?detached({...common,target:null,snapshotRef:null,batchRef:null,mapChallengeRef:null}):detached({...common,target:target!,snapshotRef:batch!.snapshotWire!,batchRef:batch!.wire,mapChallengeRef:batch!.challengeWire!});
  }
  private async boundSuccessor(b:BRecord):Promise<N.NativeBoundSourceView|undefined> {
    const a=b.attempt,p=a.navigation;
    if(!p?.observed||!p.commandCap||!p.consumed||Date.now()>=p.expires)deny('NATIVE_SCOPE_STALE',409);
    if(a.successorView){this.guard(a,true);if(Date.now()>=a.successorView.expiresAtMs)deny('NATIVE_SCOPE_STALE',409);return a.successorView;}
    if(p.dispatch)deny('NATIVE_SCOPE_STALE',409);
    if(a.successorBusy)return a.successorBusy;
    const work=(async()=>{
      let issued:Awaited<ReturnType<N.NativeObservedSourceRuntimePort['captureNativeObservedSuccessor']>>;
      try{issued=await this.observedRuntime().captureNativeObservedSuccessor(a.attempt);}
      catch(error){
        if(error instanceof Error&&error.message==='NATIVE_SUCCESSOR_NOT_STARTED'){
          // Only the actual registered source callback may report this exact state.
          // Independently recheck genuine original current target/snapshot before read.
          this.guard(a,true);this.runtime().engine.guardSource(a.source);
          this.runtime().producer.guardPreparedSnapshot(p.batch.snapshot!,b.cap,a.attempt,p.batch.cap);
          this.runtime().engine.inspectSnapshot(p.batch.sourceSnapshot!);
          this.runtime().producer.inspectNativeTargetDescriptor(a.source,p.batch.meta.sourceTarget,p.batch.sourceSnapshot!);
          return undefined;
        }
        this.stop(a,'NATIVE_SCOPE_STALE');throw error;
      }
      const runtime=this.runtime();runtime.producer.guardOriginalAttempt(a.attempt);
      if(!issued!.source||issued!.source===a.source||!issued!.postcondition)deny('NATIVE_SCOPE_STALE',409);
      const facts=runtime.engine.inspectSource(issued!.source),identity=runtime.engine.inspectSourceIdentity(issued!.source),held=runtime.engine.inspectHeldSource(issued!.source);
      if(identity.attemptRef!==a.attempt||identity.nativeBootRef!==a.nativeBoot||identity.owner!==a.owner||facts.requestHash!==a.meta.requestHash||facts.context.taskId!==a.meta.taskId||facts.context.actor!==a.meta.originalOwnerBinding||facts.sessionId!==a.sourceFacts.sessionId||facts.pageId!==a.sourceFacts.pageId||facts.deadline!==a.sourceFacts.deadline||held.launch.process!==a.originalHeld.launch.process||held.launch.page!==a.originalHeld.launch.page||held.documentId===a.originalHeld.documentId||!runtime.engine.verifyIssuedPostcondition(issued!.postcondition,issued!.source,p.batch.meta.sourceTarget))deny('NATIVE_SCOPE_STALE',409);
      digest(facts.sourceEpochDigest);a.successor={...issued!,digest:facts.sourceEpochDigest};this.guard(a,true);
      const launch=runtime.producer.inspectNativeLaunchDescriptor(issued!.source),inventory=held.inventory;
      if(launch.processLaunchRef!==p.batch.map!.view.processLaunchRef||launch.executableSha256!==p.batch.map!.view.executableFingerprint||inventory.dirty||inventory.contextCount!==1||inventory.pageCount!==1||inventory.frameCount!==1||inventory.targetTypes.some(type=>!['browser','page'].includes(type)))deny('NATIVE_SCOPE_STALE',409);
      const viewport=await held.launch.page.evaluate(()=>({widthCss:innerWidth,heightCss:innerHeight,scrollX,scrollY,dpr:devicePixelRatio,visualScale:visualViewport?.scale??1,visualOffsetX:visualViewport?.offsetLeft??0,visualOffsetY:visualViewport?.offsetTop??0}));this.guard(a,true);
      if(viewport.dpr!==1||viewport.visualScale!==1||viewport.visualOffsetX!==0||viewport.visualOffsetY!==0||!Number.isFinite(viewport.widthCss)||!Number.isFinite(viewport.heightCss))deny('NATIVE_SCOPE_STALE',409);
      const budget=runtime.producer.inspectNativeOperationBudget(a.attempt),issuedAtMs=Date.now(),expiresAtMs=Math.min(issuedAtMs+1000,p.expires,p.observed!.expiresAtMs,b.deadline,a.deadline);
      if(expiresAtMs<=issuedAtMs)deny('NATIVE_SCOPE_STALE',409);
      a.successorView=detached({version:1,phase:'bound-source',...this.bootView(),attemptRef:a.meta.attemptLookupRef,operationRef:a.meta.operationLookupRef,bindingRef:b.wire,originalTaskRef:a.meta.taskId,originalOwnerRef:a.meta.originalOwnerRef,sourceEpochDigest:a.digest,requestScopeDigest:a.meta.requestHash,processLaunchRef:launch.processLaunchRef,originalRootWindowRef:b.focus!.view.originalRootWindowRef,issuedAtMs,operationDeadlineMs:a.deadline,expiresAtMs,launch,inventory:{inventoryEpoch:inventory.inventoryEpoch,observedAtMs:Date.parse(inventory.observedAt),complete:true,dirty:false,contextCount:1,pageCount:1,frameCount:1,targetId:inventory.targetId,frameId:inventory.frameId,loaderId:inventory.loaderId,targetTypes:inventory.targetTypes.map(type=>type==='browser'?'browser' as const:'page' as const)},viewport:{...viewport,dpr:1 as const,visualScale:1 as const,visualOffsetX:0 as const,visualOffsetY:0 as const},budget:{...budget,batches:budget.batches.map((row,index)=>({...row,batchRef:a.batches[index].wire}))},target:null,snapshotRef:null,batchRef:null,mapChallengeRef:null});
      return a.successorView;
    })();a.successorBusy=work;
    try{return await work;}finally{a.successorBusy=undefined;}
  }
  async handlePrivate(req:Request,action:NativePrivateAction):Promise<N.NativeTransportResultByPath[keyof N.NativeTransportResultByPath]> {
    const peer=this.authenticatePrivateRequest(req);
    if(req.method!=='POST')deny('NATIVE_METHOD_INVALID',405);
    if(Object.keys(req.query).length||req.originalUrl.includes('?'))deny('NATIVE_QUERY_INVALID');
    if(req.get('content-type')?.split(';')[0].trim()!=='application/json')deny('NATIVE_CONTENT_TYPE_INVALID',415);
    let bytes:number;try{bytes=Buffer.byteLength(JSON.stringify(req.body),'utf8');}catch{deny();}
    if(bytes!>MAX_BODY||Number(req.get('content-length')??0)>MAX_BODY)deny('NATIVE_BODY_TOO_LARGE',413);
    const body=decodeNativePrivate(action,req.body);
    if(action==='boot'){this.registerBoot(peer,body.nativeBootNonce as string);return this.bootView();}
    this.peer(peer);if(!this.boot)deny('NATIVE_BROWSER_UNAVAILABLE',503);
    this.runtime();
    switch(action){
      case 'source': {
        if(body.phase==='enrollment'){
          const attempt=this.runtime().producer.resolveIssuedAttemptLookup(body.attemptRef as string),meta=this.runtime().producer.inspectNativeAttempt(attempt),operation=this.runtime().producer.resolveIssuedOperationLookup(meta.operationLookupRef);
          await this.prepareAttempt(peer,attempt,operation);this.peer(peer);
          const source=this.prepareEnrollmentSource(peer,attempt);return this.enrollments.get(source)!.view;
        }
        if(body.phase==='enrollment_recheck'){
          const source=this.lookup<N.EnrollmentSourceRef>(body.enrollmentSourceRef,'enrollment'),challenge=this.lookup<N.EnrollmentChallengeRef>(body.enrollmentChallengeRef,'enrollment-challenge');this.recheckEnrollmentSource(peer,source,challenge);return this.enrollments.get(source)!.recheckView;
        }
        const binding=this.lookup<N.BindingRef>(body.bindingRef,'binding');return this.boundSource(this.bindings.get(binding)!);
      }
      case 'associate': {
        const source=this.lookup<N.EnrollmentSourceRef>(body.enrollmentSourceRef,'enrollment'),recheck=this.lookup<N.EnrollmentRecheckRef>(body.enrollmentRecheckRef,'recheck'),e=this.enrollments.get(source)!;
        if(body.attemptRef!==e.attempt.meta.attemptLookupRef||body.enrollmentChallengeRef!==e.challengeWire||body.nativeSessionRef!==(body.consentView as any).nativeSessionRef)deny('NATIVE_SCOPE_STALE',409);
        const binding=this.associateMeasuredConsent(peer,source,recheck,body.consentView as N.NativeConsentEnrollmentView),b=this.bindings.get(binding)!;
        try{await this.primeBinding(b);this.guard(b.attempt);if(!b.focus){const operation=b.attempt.operation;this.prepareOriginalFocusSource(peer,operation,binding);}}catch(error){this.stop(b.attempt,'NATIVE_SOURCE_UNAVAILABLE');throw error;}
        return detached({version:1,phase:'associated',bindingRef:b.wire,attemptRef:b.attempt.meta.attemptLookupRef,operationRef:b.attempt.meta.operationLookupRef,...this.bootView(),nativeSessionRef:b.consent.nativeSessionRef,sourceEpochDigest:b.attempt.digest,expiresAtMs:b.deadline});
      }
      case 'focus/source': {
        const operation=this.lookup<N.OriginalOperationLookupRef>(body.operationRef,'operation'),binding=this.lookup<N.BindingRef>(body.bindingRef,'binding');const source=this.prepareOriginalFocusSource(peer,operation,binding);return this.focuses.get(source)!.view;
      }
      case 'focus/record': {
        const source=this.lookup<N.FocusSourceRef>(body.focusSourceRef,'focus'),f=this.focuses.get(source)!;
        if(body.operationRef!==f.binding.attempt.meta.operationLookupRef||body.bindingRef!==f.binding.wire)deny('NATIVE_SCOPE_STALE',409);
        const wasReported=!!f.ack,ack=this.recordOriginalNativeFocus(peer,source,body.focusRecord as N.MeasuredOriginalFocusTransfer);
        if(!wasReported&&['focused','already-foreground'].includes(ack.outcome)){try{await this.prepareNextSnapshot(f.binding.attempt);}catch(error){this.stop(f.binding.attempt,'NATIVE_SOURCE_UNAVAILABLE');throw error;}}return ack;
      }
      case 'map': {
        const challenge=this.lookup<N.MapChallengeRef>(body.challengeRef,'map-challenge');if(body.mapRef!==(body.mapView as N.NativeMapView).mapRef)deny('NATIVE_SCOPE_STALE',409);
        const map=this.acceptMeasuredMap(peer,challenge,body.mapView as N.NativeMapView),m=this.maps.get(map)!,batch=m.batch;
        return detached({version:1,phase:'map-accepted',bindingRef:batch.attempt.binding!.wire,operationRef:batch.attempt.meta.operationLookupRef,snapshotRef:batch.snapshotWire!,mapRef:m.wire,mapChallengeRef:batch.challengeWire!,sourceEpochDigest:batch.attempt.digest,expiresAtMs:m.view.expiresAtMs});
      }
      case 'check': {
        const binding=this.lookup<N.BindingRef>(body.bindingRef,'binding'),snapshot=this.lookup<N.SnapshotRef>(body.snapshotRef,'snapshot'),map=this.lookup<N.NativeMapRef>(body.mapRef,'map');
        const permit=await this.claimStep(binding,snapshot,map);this.peer(peer);const p=this.permits.get(permit)!,batch=p.batch;this.guard(batch.attempt);
        return detached({version:1,phase:'permit-issued',bindingRef:batch.attempt.binding!.wire,operationRef:batch.attempt.meta.operationLookupRef,batchRef:batch.wire,snapshotRef:batch.snapshotWire!,mapRef:batch.map!.wire,permitRef:p.wire,dispatchChallengeRef:p.challengeWire,sourceEpochDigest:batch.attempt.digest,expiresAtMs:p.expires});
      }
      case 'consume': {const permit=this.lookup<N.PermitRef>(body.permitRef,'permit'),command=this.consumeForDispatch(peer,permit);return detached({version:1,phase:'command-consumed',dispatchChallengeRef:this.permits.get(permit)!.challengeWire,command});}
      case 'input': {return this.resolveOriginalNativeInput(peer,this.lookup<N.BackendConsumedCommandRef>(body.commandRef,'command'),this.lookup<N.ApprovedInputRef>(body.approvedInputRef,'input'));}
      case 'input/arm': {return this.armOriginalNativeInput(peer,this.lookup<N.BackendConsumedEnterCommandRef>(body.commandRef,'command'),this.lookup<N.ApprovedInputRef>(body.approvedInputRef,'input'));}
      case 'dispatch': {
        const challenge=this.lookup<N.DispatchChallengeRef>(body.challengeRef,'dispatch-challenge'),p=this.dispatchChallenges.get(challenge)!;
        if(body.permitRef!==p.wire||body.ledgerRef!==(body.ledgerView as N.NativeLedgerView).ledgerRef)deny('NATIVE_SCOPE_STALE',409);
        const dispatch=this.recordMeasuredDispatch(peer,challenge,body.ledgerView as N.NativeLedgerView),record=this.dispatches.get(dispatch)!;
        return detached({version:1,phase:'dispatch-recorded',operationRef:p.batch.attempt.meta.operationLookupRef,permitRef:p.wire,dispatchChallengeRef:p.challengeWire,dispatchRef:record.wire,ledgerRef:record.ledger.ledgerRef,sequence:record.ledger.sequence,safeStatus:this.status(p.batch.attempt)});
      }
      case 'verify': {
        const permit=this.lookup<N.PermitRef>(body.permitRef,'permit'),dispatch=this.lookup<N.DispatchRef>(body.dispatchRef,'dispatch'),evidence=await this.verifyAndFinishStep(permit,dispatch);this.peer(peer);const p=this.permits.get(permit)!;
        return detached({version:1,phase:'step-verified',operationRef:p.batch.attempt.meta.operationLookupRef,permitRef:p.wire,dispatchRef:reference(body.dispatchRef),stepEvidenceRef:this.wire('step-evidence',evidence),safeStatus:this.status(p.batch.attempt)});
      }
      case 'cancel': {const binding=this.lookup<N.BindingRef>(body.bindingRef,'binding'),b=this.bindings.get(binding)!;this.revoke(binding,body.reason as N.StopReason);return detached({version:1,phase:'cancelled',bindingRef:b.wire,operationRef:b.attempt.meta.operationLookupRef,safeStatus:this.status(b.attempt)});}
      case 'driver/next': {return this.readOriginalNativeNext(peer,this.lookup<N.OriginalOperationLookupRef>(body.operationRef,'operation'));}
      default:deny();
    }
  }
}
export const browserNativeAuthority=new BrowserNativeAuthority();
export const NATIVE_BROWSER_PRIVATE_BASE=BASE;
/** Mount immediately after the app JSON parser. Nested Router cannot intercept its error. */
export const nativeBrowserBodyErrorHandler:ErrorRequestHandler=(error,req,res,next)=>{
  if(req.path!==BASE&&!req.path.startsWith(BASE+'/'))return next(error);
  const tooLarge=!!error&&typeof error==='object'&&error.type==='entity.too.large';
  res.setHeader('Cache-Control','no-store');
  return res.status(tooLarge?413:400).json({success:false,errorCode:tooLarge?'NATIVE_BODY_TOO_LARGE':'NATIVE_INPUT_INVALID'});
};
