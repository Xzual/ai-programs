import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { createReaAnalysisService } from './reaAnalysisService';
import type { ReaAnalysisOptions, ReaAnalysisResult, ReaAuthority } from './reaAnalysisService';
import { REA_PROFILES, snapshotReaJson } from './reaContract';
import type { ReaProfile } from './reaContract';
import { parseReaCompositionStatus, parseReaExecutionIdentity, parseReaPlannedCall, parseReaSelectionProjection, reaProjectionDigest } from './reaIntegrationContract';
import type { ReaCompositionStatusV1, ReaConstraintKind, ReaExecutionCapabilityV1, ReaExecutionIssuerV1, ReaSelectionProjectionV1 } from './reaIntegrationContract';
import type { EdithExecutionIdentity, EdithReaPlannedCall, EdithTaskStatus } from './core';
import type { FileService, ReaIndexedTargetSnapshot } from '../../server/files/fileService';

type Reason = Readonly<{kind: ReaConstraintKind; code: string}>;
export interface ReaCanonicalExecutionRecord {
  readonly identity: EdithExecutionIdentity;
  readonly ownerSessionBindingId: string; readonly ownerId: string; readonly workspaceId: string;
  readonly serverBootId: string; readonly providerTaskSessionId: string;
  readonly expiresAt: number; readonly taskStatus: EdithTaskStatus;
  readonly call?: EdithReaPlannedCall;
}
type RuntimeOptions = Omit<ReaAnalysisOptions,'serverBootId'|'isOwnerActive'|'isKillSwitchActive'|'isProfileReady'>;
/** Private backend dependencies, never a request DTO. readExecutionRecord must read the actual
 * canonical admission/plan/run/attempt source; its absence deliberately disables production execution. */
export interface ReaIntegrationDependencies {
  readonly files: Pick<FileService,'resolveReaTarget'|'assertReaTargetCurrent'>;
  readonly serverBootId: string;
  readonly now?: () => number;
  readonly readOwner: (bindingId: string) => Readonly<{ownerId: string}> | undefined;
  readonly currentWorkspace: () => Readonly<{workspaceId: string; workspaceRoot: string}> | undefined;
  readonly isKillSwitchActive: () => boolean;
  readonly readExecutionRecord?: (identity: EdithExecutionIdentity) => ReaCanonicalExecutionRecord | undefined;
  readonly readQualification: (profile: ReaProfile) => Readonly<{ready: false; reasons: readonly Reason[]} | {ready: true; qualificationRef: string}>;
  readonly runtimeOptions?: RuntimeOptions;
  /** Source-bound runtime port for isolated fixtures or the actual service factory; never client supplied. */
  readonly runtimeFactory?: typeof createReaAnalysisService;
}
export type ReaIntegrationStatus = ReaCompositionStatusV1 | Readonly<{schemaVersion:1;runtimeReady:true;outcome:'ready';profile:ReaProfile}>;
export type ReaSelectionResult = Readonly<{outcome:'selected';selection:ReaSelectionProjectionV1}> | ReaCompositionStatusV1;
export type ReaPreflight = ReaIntegrationStatus | Readonly<{outcome:'clarification_required';reasonCode:'REA_SELECTION_REQUIRED';taskCreated:false}>;
export interface ReaPreparedExecution {
  readonly identity: EdithExecutionIdentity; readonly call: EdithReaPlannedCall; readonly selection: ReaSelectionProjectionV1;
  readonly inputDigest: string;
}
/** Frozen producer convention: commit the strict normalized {toolId,args} wrapper, not args alone. */
export function reaPlannedInputCommitment(value:unknown):string {
  return reaProjectionDigest(parseReaPlannedCall(value));
}
export class ReaIntegrationError extends Error {
  constructor(readonly code:string, readonly status=409, readonly outcome:'blocked'|'unknown_effect'='blocked') {super(code);}
}
function fail(code:string,status=409):never {throw new ReaIntegrationError(code,status);}
const opaque = (value:unknown):value is string => typeof value==='string'&&/^[A-Za-z0-9_-]{1,256}$/.test(value);
const localProfiles = ['static-javascript','static-managed','app-package','native-binary','static-apk','apk-resources'] as const;
const extensions: Partial<Record<ReaProfile,readonly string[]>> = {
  'static-javascript':['.asar'],'static-managed':['.dll','.exe'],'app-package':['.zip','.ipa','.apk','.msix','.appx','.hap','.hsp','.app-pack','.asar','.dmg','.pkg'],
  'native-binary':['.exe','.dll','.elf','.so','.dylib','.macho','.bin'],'static-apk':['.apk'],'apk-resources':['.apk'],
};
function object(value:unknown,required:readonly string[],optional:readonly string[]=[]):Record<string,unknown> {
  const copy=snapshotReaJson(value);
  if(!copy||typeof copy!=='object'||Array.isArray(copy))fail('REA_INPUT_INVALID',400);
  const obj=copy as Record<string,unknown>;
  if(required.some(k=>!Object.hasOwn(obj,k))||Object.keys(obj).some(k=>!required.includes(k)&&!optional.includes(k)))fail('REA_INPUT_INVALID',400);
  return obj;
}
function profile(value:unknown):ReaProfile {if(typeof value!=='string'||!REA_PROFILES.includes(value as ReaProfile))fail('REA_INPUT_INVALID',400);return value as ReaProfile;}
function unavailable(reasons:readonly Reason[]):ReaCompositionStatusV1 {
  return parseReaCompositionStatus({schemaVersion:1,runtimeReady:false,outcome:'configuration_required',reasons});
}
type Selection = {projection:ReaSelectionProjectionV1;owner:string;ownerId:string;workspaceId:string;workspaceRoot:string;locator:Readonly<{id:string;kind:'file'|'directory'}>;target:ReaIndexedTargetSnapshot;revoked:boolean};
type Prepared = {public:ReaPreparedExecution;selection:Selection;record:ReaCanonicalExecutionRecord;fingerprint:string;
  qualificationRef:string;serviceRef:string;authority?:ReaAuthority;controller:AbortController;revoked:boolean;started:boolean;
  cap?:ReaExecutionCapabilityV1;promise?:Promise<ReaAnalysisResult>;settled?:ReaAnalysisResult;timer?:ReturnType<typeof setInterval>};

/** One instance per backend boot. No launch, filesystem config discovery, global registration or store is created here. */
export function createReaIntegrationService(deps:ReaIntegrationDependencies) {
  if(!opaque(deps.serverBootId))fail('REA_BOOT_REQUIRED',400);
  const clock=deps.now??Date.now, selections=new Map<string,Selection>(), revisions=new Map<string,number>();
  const prepared=new Map<string,Prepared>(), publicPreparations=new WeakMap<object,Prepared>();
  const preparing=new Map<string,{fingerprint:string;promise:Promise<ReaPreparedExecution>}>();
  const capabilities=new WeakMap<object,Prepared>(); let runtime:ReturnType<typeof createReaAnalysisService>|undefined;
  const key=(identity:EdithExecutionIdentity)=>identity.taskId+':'+identity.runId;
  function base(owner:string) {
    const actualOwner=deps.readOwner(owner), workspace=deps.currentWorkspace();
    if(!actualOwner||!opaque(owner)||!opaque(actualOwner.ownerId))fail('REA_OWNER_REQUIRED',401);
    if(!workspace||!opaque(workspace.workspaceId)||!path.isAbsolute(workspace.workspaceRoot))fail('REA_WORKSPACE_REQUIRED');
    if(deps.isKillSwitchActive())fail('REA_KILL_SWITCH_ACTIVE',423);
    return {actualOwner,workspace};
  }
  function status(selectedProfile:ReaProfile):ReaIntegrationStatus {
    profile(selectedProfile);
    if(!(localProfiles as readonly string[]).includes(selectedProfile))return unavailable([{kind:'missing_code',code:'REA_REMOTE_SELECTION_PRODUCER_MISSING'}]);
    const qualification=deps.readQualification(selectedProfile), reasons:Reason[]=[];
    if(qualification.ready===false)reasons.push(...(qualification.reasons.length?qualification.reasons:[{kind:'qualification_failed' as const,code:'REA_QUALIFICATION_REQUIRED'}]));
    else if(!opaque(qualification.qualificationRef))reasons.push({kind:'qualification_failed',code:'REA_QUALIFICATION_REQUIRED'});
    if(!deps.runtimeOptions)reasons.push({kind:'missing_engine',code:'REA_RUNTIME_CONFIGURATION_MISSING'});
    const configurationKey=({'app-package':'appPackage','native-binary':'native','static-apk':'android','apk-resources':'apkResources'} as const)[selectedProfile as 'app-package'|'native-binary'|'static-apk'|'apk-resources'];
    if(deps.runtimeOptions&&configurationKey&&!deps.runtimeOptions.localConfiguration?.[configurationKey])reasons.push({kind:'missing_engine',code:'REA_PROFILE_CONFIGURATION_MISSING'});
    if(!deps.readExecutionRecord)reasons.push({kind:'missing_code',code:'REA_CANONICAL_EXECUTION_SOURCE_MISSING'});
    return reasons.length?unavailable(reasons):Object.freeze({schemaVersion:1,runtimeReady:true,outcome:'ready',profile:selectedProfile});
  }
  function stop(p:Prepared):void {
    p.revoked=true;p.controller.abort();if(p.timer){clearInterval(p.timer);p.timer=undefined;}
    runtime?.admission.revokeSelection(p.serviceRef);
  }
  function qualifiedRef(selectedProfile:ReaProfile):string {
    const q=deps.readQualification(selectedProfile);
    if(q.ready!==true||!opaque(q.qualificationRef))fail('REA_RUNTIME_NOT_QUALIFIED');return q.qualificationRef;
  }
  function selectionCurrent(s:Selection):void {
    const current=base(s.owner);
    if(s.revoked||selections.get(s.projection.selectionRef)!==s||s.projection.expiresAt<=clock()
      ||current.actualOwner.ownerId!==s.ownerId||current.workspace.workspaceId!==s.workspaceId
      ||path.resolve(current.workspace.workspaceRoot)!==s.workspaceRoot)fail('REA_SELECTION_REQUIRED');
    try{deps.files.assertReaTargetCurrent(s.target);}catch{fail('REA_SELECTION_CHANGED');}
  }
  function canonical(identity:EdithExecutionIdentity,s:Selection):ReaCanonicalExecutionRecord {
    const actual=deps.readExecutionRecord?.(identity);
    if(!actual)fail('REA_CANONICAL_EXECUTION_REQUIRED');
    const r=object(actual,['identity','ownerSessionBindingId','ownerId','workspaceId','serverBootId','providerTaskSessionId','expiresAt','taskStatus'],['call']);
    const captured=parseReaExecutionIdentity(r.identity);
    if(reaProjectionDigest(captured)!==reaProjectionDigest(identity)||r.ownerSessionBindingId!==s.owner||r.ownerId!==s.ownerId||r.workspaceId!==s.workspaceId
      ||r.serverBootId!==deps.serverBootId||!opaque(r.providerTaskSessionId)||typeof r.expiresAt!=='number'||!Number.isSafeInteger(r.expiresAt)||r.expiresAt<=clock()
      ||!['QUEUED','RUNNING','VERIFYING','COMPLETED','BLOCKED'].includes(String(r.taskStatus)))fail('REA_CANONICAL_EXECUTION_MISMATCH');
    return Object.freeze({identity:captured,ownerSessionBindingId:s.owner,ownerId:s.ownerId,workspaceId:s.workspaceId,serverBootId:deps.serverBootId,
      providerTaskSessionId:r.providerTaskSessionId,expiresAt:r.expiresAt,taskStatus:r.taskStatus as EdithTaskStatus,
      ...(r.call===undefined?{}:{call:parseReaPlannedCall(r.call)})});
  }
  function current(p:Prepared,requirePlan=true):void {
    try {
      if(p.revoked||p.controller.signal.aborted)fail('REA_AUTHORITY_REVOKED');
      selectionCurrent(p.selection);if(!status(p.public.call.args.profile).runtimeReady)fail('REA_RUNTIME_NOT_QUALIFIED');
      if(qualifiedRef(p.public.call.args.profile)!==p.qualificationRef)fail('REA_QUALIFICATION_CHANGED');
      const r=canonical(p.public.identity,p.selection);
      if(r.taskStatus==='BLOCKED'&&!p.settled)fail('REA_CANONICAL_EXECUTION_TERMINAL');
      if(r.taskStatus==='COMPLETED'&&!p.started)fail('REA_CANONICAL_EXECUTION_TERMINAL');
      if(r.providerTaskSessionId!==p.record.providerTaskSessionId||r.expiresAt!==p.record.expiresAt
        ||requirePlan&&(!r.call||reaPlannedInputCommitment(r.call)!==p.public.inputDigest))fail('REA_CANONICAL_PLAN_MISMATCH');
    } catch(error) {stop(p);if(p.started)throw new ReaIntegrationError(error instanceof ReaIntegrationError?error.code:'REA_AUTHORITY_REVOKED',409,'unknown_effect');throw error;}
  }
  function getRuntime():ReturnType<typeof createReaAnalysisService> {
    if(!runtime){
      if(!deps.runtimeOptions)fail('REA_RUNTIME_CONFIGURATION_MISSING');
      runtime=(deps.runtimeFactory??createReaAnalysisService)({...deps.runtimeOptions,serverBootId:deps.serverBootId,
        isKillSwitchActive:deps.isKillSwitchActive,
        isProfileReady:p=>status(p).runtimeReady,
        isOwnerActive:context=>{
          const p=prepared.get(context.taskId+':'+context.runId);if(!p)return false;
          try{current(p);return context.ownerId===p.record.ownerId&&context.workspaceId===p.record.workspaceId
            &&context.serverBootId===p.record.serverBootId&&context.sessionId===p.record.providerTaskSessionId;}catch{return false;}
        }});
    }
    return runtime;
  }
  async function select(owner:string,value:unknown):Promise<ReaSelectionResult> {
    const body=object(value,['locator','profile']),selectedProfile=profile(body.profile);
    const source=object(body.locator,['id','kind']);if(typeof source.id!=='string'||!/^[a-f0-9]{64}$/.test(source.id)||!['file','directory'].includes(String(source.kind)))fail('REA_INPUT_INVALID',400);
    const first=base(owner);
    if(!(localProfiles as readonly string[]).includes(selectedProfile))return unavailable([{kind:'missing_code',code:'REA_REMOTE_SELECTION_PRODUCER_MISSING'}]);
    const scope=owner+':'+first.workspace.workspaceId,revision=(revisions.get(scope)??0)+1;
    if(!revisions.has(scope)&&revisions.size>=256)fail('REA_SELECTION_LIMIT');revisions.set(scope,revision);
    const guard=()=>{const live=base(owner);if(live.workspace.workspaceId!==first.workspace.workspaceId
      ||path.resolve(live.workspace.workspaceRoot)!==path.resolve(first.workspace.workspaceRoot)||revisions.get(scope)!==revision)fail('REA_SELECTION_STALE');};
    const target=await deps.files.resolveReaTarget({id:source.id,kind:source.kind as 'file'|'directory'},guard);guard();
    const workspaceRoot=path.resolve(first.workspace.workspaceRoot),rel=path.relative(workspaceRoot,target.absolutePath);
    if(rel==='..'||rel.startsWith('..'+path.sep)||path.isAbsolute(rel))fail('REA_SELECTION_FOREIGN');
    if(target.kind==='directory'?selectedProfile!=='static-javascript':!extensions[selectedProfile]?.includes(path.extname(target.absolutePath).toLowerCase()))fail('REA_SELECTION_PROFILE_UNSUPPORTED',415);
    for(const s of selections.values())if(s.owner===owner&&s.workspaceId===first.workspace.workspaceId){s.revoked=true;for(const p of prepared.values())if(p.selection===s)stop(p);selections.delete(s.projection.selectionRef);}
    if(selections.size>=256)fail('REA_SELECTION_LIMIT');
    const projection=parseReaSelectionProjection({schemaVersion:1,selectionRef:'rea_selection_'+randomUUID(),profile:selectedProfile,revision,expiresAt:clock()+120000});
    selections.set(projection.selectionRef,{projection,owner,ownerId:first.actualOwner.ownerId,workspaceId:first.workspace.workspaceId,workspaceRoot,
      locator:Object.freeze({id:source.id,kind:source.kind as 'file'|'directory'}),target,revoked:false});
    return Object.freeze({outcome:'selected',selection:projection});
  }
  function preflight(owner:string,input:unknown):ReaPreflight {
    const clarification=Object.freeze({outcome:'clarification_required' as const,reasonCode:'REA_SELECTION_REQUIRED' as const,taskCreated:false as const});
    let body:Record<string,unknown>;try{body=object(input,[],['selectionRef','profile']);}catch{return clarification;}
    if(typeof body.selectionRef!=='string')return clarification;
    const s=selections.get(body.selectionRef);if(!s||s.owner!==owner||body.profile!==s.projection.profile)return clarification;
    try{selectionCurrent(s);}catch{return clarification;}
    return status(s.projection.profile);
  }
  /** Server-only lookup of the actual current owner/workspace selection; never a recent-path guess. */
  function currentSelection(owner:string,selectedProfile?:ReaProfile):ReaSelectionProjectionV1|undefined {
    base(owner);
    const matches=[...selections.values()].filter(s=>s.owner===owner&&(!selectedProfile||s.projection.profile===selectedProfile));
    if(matches.length!==1)return undefined;
    try{selectionCurrent(matches[0]);return matches[0].projection;}catch{return undefined;}
  }
  async function prepare(owner:string,selectionRef:string,identityValue:EdithExecutionIdentity,intent:unknown):Promise<ReaPreparedExecution> {
    const identity=parseReaExecutionIdentity(identityValue),s=selections.get(selectionRef);
    if(!s||s.owner!==owner)fail('REA_SELECTION_REQUIRED');selectionCurrent(s);
    if(!status(s.projection.profile).runtimeReady)fail('REA_RUNTIME_NOT_QUALIFIED');
    const qualificationRef=qualifiedRef(s.projection.profile);
    const body=object(intent,['profile','objective'],['profileOptions','featureQuery']);
    if(body.profile!==s.projection.profile)fail('REA_SELECTION_PROFILE_MISMATCH');
    // Validate the entire intent before registering any service admission.
    const intentCall=parseReaPlannedCall({toolId:'rea_analysis',args:{schemaVersion:1,selectionRef,...body}});
    const record=canonical(identity,s),fingerprint=reaProjectionDigest({identity,selection:s.projection,intent:intentCall,qualificationRef});
    const prior=prepared.get(key(identity));
    if(prior){if(prior.fingerprint!==fingerprint)fail('REA_BINDING_CONFLICT');current(prior,!!prior.cap);return prior.public;}
    if(['COMPLETED','BLOCKED'].includes(record.taskStatus))fail('REA_CANONICAL_EXECUTION_TERMINAL');
    const pending=preparing.get(key(identity));
    if(pending){if(pending.fingerprint!==fingerprint)fail('REA_BINDING_CONFLICT');const result=await pending.promise;current(publicPreparations.get(result)!,!!publicPreparations.get(result)!.cap);return result;}
    if(prepared.size+preparing.size>=256)fail('REA_EXECUTION_LIMIT');
    const promise=Promise.resolve().then(async()=>{
      const guard=()=>{selectionCurrent(s);canonical(identity,s);if(!status(s.projection.profile).runtimeReady||qualifiedRef(s.projection.profile)!==qualificationRef)fail('REA_RUNTIME_NOT_QUALIFIED');};
      const fresh=await deps.files.resolveReaTarget(s.locator,guard);guard();
      if(fresh.sha256!==s.target.sha256||fresh.identityDigest!==s.target.identityDigest)fail('REA_SELECTION_CHANGED');
      const currentRecord=canonical(identity,s);
      if(reaProjectionDigest(currentRecord)!==reaProjectionDigest(record))fail('REA_CANONICAL_EXECUTION_CHANGED');
      const rt=getRuntime();
      const serviceRef=rt.admission.registerSelection({kind:s.target.kind,ownerId:s.ownerId,workspaceId:s.workspaceId,workspaceRoot:s.workspaceRoot,absolutePath:s.target.absolutePath,sha256:s.target.sha256,expiresAt:Math.min(s.projection.expiresAt,record.expiresAt)});
      try {
        const call=parseReaPlannedCall({toolId:'rea_analysis',args:{...intentCall.args,selectionRef:serviceRef}});
        const result=Object.freeze({identity,call,selection:s.projection,inputDigest:reaPlannedInputCommitment(call)});
        const p:Prepared={public:result,selection:s,record,fingerprint,qualificationRef,serviceRef,controller:new AbortController(),revoked:false,started:false};
        prepared.set(key(identity),p);publicPreparations.set(result,p);current(p,false);return result;
      }catch(error){rt.admission.revokeSelection(serviceRef);throw error;}
    });
    preparing.set(key(identity),{fingerprint,promise});
    try{return await promise;}finally{preparing.delete(key(identity));}
  }
  function assertCapability(capability:ReaExecutionCapabilityV1):void {
    const p=capability&&typeof capability==='object'?capabilities.get(capability):undefined;
    if(!p||p.cap!==capability)fail('REA_CAPABILITY_REQUIRED',403);current(p);
  }
  /** Trusted registry correlation projection only. No log/audit IDs are fabricated or persisted here. */
  function readCapabilityBinding(capability:ReaExecutionCapabilityV1):ReaPreparedExecution {
    assertCapability(capability);return capabilities.get(capability)!.public;
  }
  async function consume(capability:ReaExecutionCapabilityV1):Promise<ReaAnalysisResult> {
    assertCapability(capability);const p=capabilities.get(capability)!;
    if(!p.promise){
      // Reserve the winner before the adapter can synchronously reenter this consumer.
      p.promise=Promise.resolve().then(async()=>{
        current(p);p.started=true;
        p.timer=setInterval(()=>{try{current(p);}catch{/* current aborts/revokes; awaited result is guarded below. */}},25);p.timer.unref();
        try {const result=await getRuntime().service.run(p.public.call.args,p.authority!);current(p);p.settled=result;return result;}
        finally {if(p.timer){clearInterval(p.timer);p.timer=undefined;}}
      });
    }
    const result=await p.promise;current(p);return result;
  }
  function issue(value:Parameters<ReaExecutionIssuerV1>[0]):ReaExecutionCapabilityV1 {
    const p=value&&typeof value==='object'?publicPreparations.get(value):undefined;
    if(!p||p.public!==value)fail('REA_PREPARATION_REQUIRED',403);
    current(p,false);
    // A preparation may legitimately await plan persistence. Absence is not a task revoke.
    if(!canonical(p.public.identity,p.selection).call)fail('REA_CANONICAL_PLAN_REQUIRED');
    current(p);
    if(p.cap)return p.cap;
    p.authority=getRuntime().admission.issueAuthority({ownerId:p.record.ownerId,workspaceId:p.record.workspaceId,taskId:p.public.identity.taskId,
      runId:p.public.identity.runId,serverBootId:deps.serverBootId,sessionId:p.record.providerTaskSessionId,
      expiresAt:Math.min(p.selection.projection.expiresAt,p.record.expiresAt),signal:p.controller.signal});
    // The cast supplies the erased TS brand only. The actual authority check is this factory's WeakMap.
    const cap=Object.freeze({identity:p.public.identity,call:p.public.call,assertTaskCurrent:()=>assertCapability(cap),execute:()=>consume(cap)}) as ReaExecutionCapabilityV1;
    p.cap=cap;capabilities.set(cap,p);current(p);return cap;
  }
  function revokeSelection(owner:string,ref:string):void {
    const s=selections.get(ref);if(!s||s.owner!==owner)fail('REA_SELECTION_REQUIRED');
    s.revoked=true;selections.delete(ref);for(const p of prepared.values())if(p.selection===s)stop(p);
  }
  function revokeCapability(capability:ReaExecutionCapabilityV1):void {
    const p=capability&&typeof capability==='object'?capabilities.get(capability):undefined;
    if(!p||p.cap!==capability)fail('REA_CAPABILITY_REQUIRED',403);
    stop(p);
  }
  return Object.freeze({status,select,preflight,currentSelection,prepare,issue,assertCapability,readCapabilityBinding,consume,revokeSelection,revokeCapability});
}
export type ReaIntegrationService = ReturnType<typeof createReaIntegrationService>;
