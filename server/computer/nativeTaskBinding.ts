import {createHash,randomUUID} from 'node:crypto';
import {taskService,isNativeBoundTask,registerNativeTaskHooks} from '../../src/edith/taskService';
import {registerNativeTaskVerifier} from '../../src/edith/verifier';
import type {EdithTask,EdithVerificationResult} from '../../src/edith/core';
import {ownerSessionBindingActive,onOwnerSessionInvalidated,type OwnerSessionContext} from '../security/ownerSession';
import {killSwitchService,onKillSwitchActivated} from '../../src/edith/killSwitch';
import {FileServiceError} from '../files/fileService';
import {getMobileRuntime} from '../mobile/runtime';
import {REALTIME_EVENT_NAMES,type TypedTaskEventV2} from '../../src/edith/contracts';
import {nativeStopReceipts,NativeStopReceiptError,type NativeSafetyMembership} from './nativeStopReceipts';
import {STEAM_DETAIL_PROFILE_REGISTRY,lookupSteamDetailProfile} from './steamDetailProfiles';

export const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
export const pathFingerprint=(value:string)=>digest(value.replace(/\//g,'\\').replace(/\\+$/,'').toLowerCase());
type Request={app:'spotify'|'steam'|'explorer';workflow:string;query?:string;volume?:number;gameName?:string;sourceFileId?:string;destinationDirectoryId?:string;undoReceiptId?:string};
type Session={safetyMembership:Readonly<NativeSafetyMembership>;ownerBindingId:string;sessionId:string;reservationId:string;applicationId:Request['app'];windowId?:string;processId?:number;imagePathFingerprint?:string;expiresAt:number};
export type NativeSnapshot={source:'native_uia_state';observationId:string;observedAt:number;applicationId:Request['app'];windowId:string;processId:number;imagePathFingerprint:string;foreground:boolean;playback?:'playing'|'paused';trackFingerprint?:string;queryFingerprint?:string;view?:'search'|'library'|'downloads'|'game_detail';gameEntryFingerprint?:string;selectedGameFingerprint?:string;gameTitleFingerprint?:string;gameDetailContextFingerprint?:string;gameDetailWitnessVersion?:2;gameDetailProviderProfileFingerprint?:string;itemCount?:number;volume?:number;folderFingerprint?:string;selectedNameFingerprint?:string;selectedCount?:number};
type RequestedSkip={source:'native_uia_action';canonicalActionId:string;kind:'clickMouse';targetId:string;controlType:50000;nameFingerprint:string};
type RequestedGameNavigation={source:'native_uia_action';canonicalActionId:string;kind:'clickMouse';targetId:string;controlType:50007|50029;nameFingerprint:string;entryFingerprint:string};
type SteamProfileApproval=Readonly<{domain:'edith.steam.detail-profile/1';fingerprint:string;version:number;providerIdentity:string;evidenceSetDigest:string;approvedRevision:number;revoked:boolean}>;
type SteamProfilePin=Readonly<{fingerprint:string;version:number;providerIdentity:string;evidenceSetDigest:string;registryRevision:number}>;
// Source-reviewed production approvals only. Native mapping/evidence is still UNKNOWN.
// No environment, caller, test, HTTP or runtime configuration can populate this registry.
const STEAM_PROFILE_REGISTRY=STEAM_DETAIL_PROFILE_REGISTRY;
type Binding={bindingId:string;taskId:string;owner:string;key:string;request:Request;requestDigest:string;workflowId:string;nonce:string;expiresAt:number;session?:Session;operationId?:string;abort?:()=>void;revoked:boolean;observations:Set<string>;timer:ReturnType<typeof setTimeout>;pending?:{actionId:string;permitNonce:string;pre:NativeSnapshot|ReservationSnapshot;requestedSkip?:RequestedSkip;requestedGameNavigation?:RequestedGameNavigation};steps:{actionId:string;pre:NativeSnapshot|ReservationSnapshot;post:NativeSnapshot;requestedSkip?:RequestedSkip;requestedGameNavigation?:RequestedGameNavigation}[];fs?:{folderFingerprint:string;selectedNameFingerprint:string;validate?:()=>void};firstFinishFailure?:string;proof?:EdithVerificationResult;steamProfile?:SteamProfilePin};
type ReservationSnapshot={source:'native_reservation';observationId:string;observedAt:number;applicationId:Request['app']};
const safeId=(v:unknown)=>typeof v==='string'&&/^[A-Za-z0-9:_-]{1,160}$/.test(v);
const hash=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const gameNameValid=(value:unknown):value is string=>typeof value==='string'&&value.trim().length>0&&[...value].length<=160&&Buffer.byteLength(value,'utf8')<=640&&!/[\u0000-\u001f\u007f-\u009f]/.test(value)&&![...value].some(c=>{const code=c.codePointAt(0)!;return code>=0xd800&&code<=0xdfff;});
function strict(value:unknown,keys:string[]):Record<string,any>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k)))throw new FileServiceError('NATIVE_BINDING_INPUT_INVALID');return value as Record<string,any>;}
const canonicalFinishFailureCodes:ReadonlySet<string>=new Set([
  'EXPLORER_FINAL_PROOF_CHANGED',
  'KILL_SWITCH_ACTIVE',
  'NATIVE_ACTION_RECEIPT_INVALID',
  'NATIVE_ACTION_REPLAY_OR_LIMIT',
  'NATIVE_BINDING_CLOSED',
  'NATIVE_BINDING_EXPIRED',
  'NATIVE_BINDING_INPUT_INVALID',
  'NATIVE_BINDING_LIMIT',
  'NATIVE_BINDING_NOT_FOUND',
  'NATIVE_BINDING_REVOKED',
  'NATIVE_CONTEXT_EXPIRED',
  'NATIVE_CONTEXT_INVALID',
  'NATIVE_DISPATCH_INCOMPLETE',
  'NATIVE_EXPLORER_PLAN_REQUIRED',
  'NATIVE_FIND_LEDGER_REQUIRED',
  'NATIVE_GAME_NAVIGATION_ACTION_INVALID',
  'NATIVE_GAME_NAVIGATION_DISPATCH_MISMATCH',
  'NATIVE_IDEMPOTENCY_CONFLICT',
  'NATIVE_IDEMPOTENCY_REQUIRED',
  'NATIVE_LEDGER_INCOMPLETE',
  'NATIVE_OBSERVATION_REPLAY',
  'NATIVE_OPERATION_ASSOCIATION_INVALID',
  'NATIVE_OPERATION_ASSOCIATION_REPLAY',
  'NATIVE_OPERATION_BINDING_REQUIRED',
  'NATIVE_OPERATION_CONFLICT',
  'NATIVE_OPERATION_UNVERIFIED',
  'NATIVE_POSTSTATE_INVALID',
  'NATIVE_POSTSTATE_STALE',
  'NATIVE_REQUIRED_POSTCONDITION_FAILED',
  'NATIVE_RESERVATION_ALREADY_BOUND',
  'NATIVE_RESERVATION_PRESTATE_INVALID',
  'NATIVE_SAFETY_MEMBERSHIP_CHANGED',
  'NATIVE_SAFETY_MEMBERSHIP_INVALID',
  'NATIVE_SAFETY_MEMBERSHIP_LOST',
  'NATIVE_SESSION_APPLICATION_MISMATCH',
  'NATIVE_SESSION_CONCURRENT_RESERVATION',
  'NATIVE_SESSION_CONFIGURATION_REQUIRED',
  'NATIVE_SESSION_CONFLICT',
  'NATIVE_SESSION_EXPIRED',
  'NATIVE_SESSION_INVALID',
  'NATIVE_SESSION_LIMIT',
  'NATIVE_SKIP_ACTION_INVALID',
  'NATIVE_SKIP_DISPATCH_MISMATCH',
  'NATIVE_STEAM_FINAL_PROFILE_INVALID',
  'NATIVE_STEAM_PROFILE_APPROVAL_LOST',
  'NATIVE_STEAM_PROFILE_CHANGED',
  'NATIVE_STEAM_PROFILE_PIN_REQUIRED',
  'NATIVE_STEAM_PROFILE_UNAPPROVED',
  'NATIVE_TARGET_BINDING_INVALID',
  'NATIVE_WORKFLOW_INVALID',
  'OWNER_REVOKED',
  'OWNER_SESSION_REQUIRED',
]);
export class NativeTaskBindingService {
  private rows=new Map<string,Binding>();private operations=new Map<string,Binding>();private sessions=new Map<string,Session>();private started=false;
  constructor(){registerNativeTaskHooks((id,action)=>this.cancelTask(id,action),event=>getMobileRuntime().realtime.publish(REALTIME_EVENT_NAMES.TASK_EVENT,event,event.context.correlationId));registerNativeTaskVerifier(task=>this.verification(task));onOwnerSessionInvalidated(e=>{for(const b of this.rows.values())if(b.owner===e.bindingId)this.revoke(b,'CANCELLED','OWNER_REVOKED');for(const [id,s]of this.sessions)if(s.ownerBindingId===e.bindingId)this.sessions.delete(id);});onKillSwitchActivated(()=>{for(const b of this.rows.values())this.revoke(b,'CANCELLED','KILL_SWITCH_ACTIVE');this.sessions.clear();});}
  recover(){if(this.started)return;this.started=true;for(const task of taskService.listTasks())if(isNativeBoundTask(task)&&!['COMPLETED','CANCELLED','FAILED'].includes(task.status))taskService.nativeTransition(task.id,'BLOCKED','task.status_changed',undefined);}
  private authority(owner:string){if(!ownerSessionBindingActive(owner))throw new FileServiceError('OWNER_SESSION_REQUIRED',401);if(killSwitchService.status().active)throw new FileServiceError('KILL_SWITCH_ACTIVE',423);}
  private requireSteamProfile(b:Binding,fingerprint:unknown,allowPin:boolean){
    const registry=STEAM_PROFILE_REGISTRY;
    const approved=lookupSteamDetailProfile(registry,fingerprint),matches=approved?[approved]:[];
    if(!Number.isSafeInteger(registry.revision)||registry.revision<1||matches.length!==1){if(b.steamProfile)this.revoke(b,'BLOCKED','NATIVE_STEAM_PROFILE_APPROVAL_LOST');throw new FileServiceError('NATIVE_STEAM_PROFILE_UNAPPROVED',409);}
    const row=matches[0],pin:SteamProfilePin={fingerprint:row.fingerprint,version:row.version,providerIdentity:row.providerIdentity,evidenceSetDigest:row.evidenceSetDigest,registryRevision:registry.revision};
    if(b.steamProfile){if(Object.keys(pin).some(key=>pin[key as keyof SteamProfilePin]!==b.steamProfile![key as keyof SteamProfilePin])){this.revoke(b,'BLOCKED','NATIVE_STEAM_PROFILE_CHANGED');throw new FileServiceError('NATIVE_STEAM_PROFILE_CHANGED',409);}}
    else if(allowPin)b.steamProfile=Object.freeze(pin);
    else throw new FileServiceError('NATIVE_STEAM_PROFILE_PIN_REQUIRED',409);
  }
  private finalSteamProfile(b:Binding,last:NativeSnapshot){
    if(b.request.app!=='steam'||b.request.workflow!=='game_detail')return;
    try{
      // Finish cannot establish a new approval pin from a retained/counterfeit ledger.
      this.snapshot(last,b.session!,b,false);
      this.requireSteamProfile(b,last.gameDetailProviderProfileFingerprint,false);
      const step=b.steps.at(-1)!;
      if(!step.requestedGameNavigation||step.pre.source!=='native_uia_state')throw new FileServiceError('NATIVE_REQUIRED_POSTCONDITION_FAILED',409);
      const marker=step.requestedGameNavigation;
      if(step.post!==last||marker.source!=='native_uia_action'||marker.kind!=='clickMouse'||!safeId(marker.canonicalActionId)||!safeId(marker.targetId)||![50007,50029].includes(marker.controlType)||marker.nameFingerprint!==digest(b.request.gameName!.trim())||!hash(marker.entryFingerprint)||b.steps.filter(row=>row.requestedGameNavigation?.canonicalActionId===marker.canonicalActionId).length!==1)throw new FileServiceError('NATIVE_REQUIRED_POSTCONDITION_FAILED',409);
      this.snapshot(step.pre,b.session!,b,false);
      if(last.observationId===step.pre.observationId||last.observedAt<step.pre.observedAt||!['search','library'].includes(step.pre.view??'')||step.pre.gameEntryFingerprint!==step.requestedGameNavigation.entryFingerprint||last.view!=='game_detail'||last.selectedCount!==1||last.selectedGameFingerprint!==step.requestedGameNavigation.entryFingerprint||last.gameTitleFingerprint!==digest(b.request.gameName!.trim()))throw new FileServiceError('NATIVE_REQUIRED_POSTCONDITION_FAILED',409);
    }catch(error){if(b.proof)this.revoke(b,'BLOCKED','NATIVE_STEAM_FINAL_PROFILE_INVALID');throw error;}
  }
  private safety(session:Session,binding?:Binding){
    try {nativeStopReceipts.assertActiveSession(session.safetyMembership);}
    catch(error){if(binding)this.revoke(binding,'BLOCKED','NATIVE_SAFETY_MEMBERSHIP_LOST');else for(const row of this.rows.values())if(row.session?.safetyMembership.safetySessionRef===session.safetyMembership.safetySessionRef)this.revoke(row,'BLOCKED','NATIVE_SAFETY_MEMBERSHIP_LOST');throw error instanceof NativeStopReceiptError?new FileServiceError(error.code,error.status):error;}
  }
  private sameMembership(a:NativeSafetyMembership,b:NativeSafetyMembership){return ['safetySessionRef','nativeSessionId','ownerBindingId','originalGeneration','nativeBootNonce','expiresAt'].every(key=>a[key as keyof NativeSafetyMembership]===b[key as keyof NativeSafetyMembership]);}
  private attachSession(b:Binding,session:Session){
    this.safety(session,b);
    if(b.session&&!this.sameMembership(b.session.safetyMembership,session.safetyMembership)){this.revoke(b,'BLOCKED','NATIVE_SAFETY_MEMBERSHIP_CHANGED');throw new FileServiceError('NATIVE_SAFETY_MEMBERSHIP_INVALID',409);}
    b.session={...session,expiresAt:Math.min(session.expiresAt,b.session?.expiresAt??Infinity)};
    const deadline=Math.min(b.expiresAt,session.expiresAt,session.safetyMembership.expiresAt);
    if(deadline<b.expiresAt){b.expiresAt=deadline;clearTimeout(b.timer);b.timer=setTimeout(()=>this.revoke(b,'BLOCKED','NATIVE_BINDING_EXPIRED'),Math.max(1,deadline-Date.now()));b.timer.unref();}
  }
  private current(id:string,owner?:string){
    this.recover();const b=this.rows.get(id);if(!b||owner&&b.owner!==owner)throw new FileServiceError('NATIVE_BINDING_NOT_FOUND',404);
    this.authority(b.owner);
    if(b.session){
      this.safety(b.session,b);
      const live=this.sessions.get(b.session.sessionId);
      if(!live||live.reservationId!==b.session.reservationId||live.ownerBindingId!==b.owner||live.expiresAt<=Date.now()||!this.sameMembership(live.safetyMembership,b.session.safetyMembership))this.revoke(b,'BLOCKED','NATIVE_SESSION_EXPIRED');
    }
    if(b.expiresAt<=Date.now())this.revoke(b,'BLOCKED','NATIVE_BINDING_EXPIRED');
    if(b.steamProfile)this.requireSteamProfile(b,b.steamProfile.fingerprint,false);
    if(b.revoked||b.expiresAt<=Date.now()||['CANCELLED','BLOCKED','FAILED','COMPLETED'].includes(taskService.getTask(b.taskId)?.status??''))throw new FileServiceError('NATIVE_BINDING_REVOKED',409);return b;
  }
  private view(b:Binding){return {bindingId:b.bindingId,taskId:b.taskId,workflowId:b.workflowId,operationId:b.operationId,state:taskService.getTask(b.taskId)?.status,expiresAt:b.expiresAt,taskBinding:'registered',physicalAcceptance:false};}
  read(id:string,owner:string){
    const b=this.rows.get(id);if(!b||b.owner!==owner)throw new FileServiceError('NATIVE_BINDING_NOT_FOUND',404);this.authority(owner);
    if(!['COMPLETED','CANCELLED','FAILED'].includes(taskService.getTask(b.taskId)?.status??'')){
      if(b.steamProfile)this.requireSteamProfile(b,b.steamProfile.fingerprint,false);
      if(b.session){this.safety(b.session,b);const live=this.sessions.get(b.session.sessionId);if(!live||live.reservationId!==b.session.reservationId||!this.sameMembership(live.safetyMembership,b.session.safetyMembership)||live.expiresAt<=Date.now()){this.revoke(b,'BLOCKED','NATIVE_SESSION_EXPIRED');throw new FileServiceError('NATIVE_BINDING_REVOKED',409);}}
      if(b.expiresAt<=Date.now()){this.revoke(b,'BLOCKED','NATIVE_BINDING_EXPIRED');throw new FileServiceError('NATIVE_BINDING_REVOKED',409);}
    }
    return this.view(b);
  }
  operationView(id:string,owner:string){const b=this.operations.get(id);return b?this.read(b.bindingId,owner):{};}
  assertTaskOwner(id:string,owner:string){const b=[...this.rows.values()].find(row=>row.taskId===id);this.authority(owner);if(b&&b.owner!==owner)throw new FileServiceError('NATIVE_BINDING_NOT_FOUND',404);}
  cancelPrivate(id:string,input:unknown){const {b}=this.context(id,input);return this.cancelTask(b.taskId,'cancel');}
  bindTarget(id:string,input:unknown){const {b,r,s}=this.context(id,input,['windowId','processId','imagePathFingerprint','actionId','permitNonce']);if(!b.pending||b.pending.actionId!==r.actionId||b.pending.permitNonce!==r.permitNonce||s.windowId||!safeId(r.windowId)||!Number.isSafeInteger(r.processId)||r.processId<=0||!hash(r.imagePathFingerprint))throw new FileServiceError('NATIVE_TARGET_BINDING_INVALID',409);this.current(b.bindingId);const target={...s,windowId:r.windowId,processId:r.processId,imagePathFingerprint:r.imagePathFingerprint};this.sessions.set(s.sessionId,target);b.session=target;return {bound:true,physicalAcceptance:false};}
  private reservationSnapshot(input:unknown,b:Binding):ReservationSnapshot {const r=strict(input,['source','observationId','observedAt','applicationId']);if(b.steps.length||r.source!=='native_reservation'||!safeId(r.observationId)||!Number.isSafeInteger(r.observedAt)||r.observedAt>Date.now()+1000||Date.now()-r.observedAt>5000||r.applicationId!==b.request.app)throw new FileServiceError('NATIVE_RESERVATION_PRESTATE_INVALID',409);return r as ReservationSnapshot;}
  registerSession(input:unknown){
    const s=strict(input,['ownerBindingId','sessionId','reservationId','applicationId','windowId','processId','imagePathFingerprint','expiresAt','source']);this.authority(s.ownerBindingId);
    if(s.source!=='native_operator'||!['spotify','steam','explorer'].includes(s.applicationId)||![s.sessionId,s.reservationId].every(safeId)||(['windowId','processId','imagePathFingerprint'].some(k=>s[k]!==undefined)&&(!safeId(s.windowId)||!hash(s.imagePathFingerprint)||!Number.isSafeInteger(s.processId)||s.processId<=0))||!Number.isSafeInteger(s.expiresAt)||s.expiresAt<=Date.now()||s.expiresAt>Date.now()+60000)throw new FileServiceError('NATIVE_SESSION_INVALID',409);
    let safetyMembership:Readonly<NativeSafetyMembership>;
    try{safetyMembership=nativeStopReceipts.requireActiveSession(s.ownerBindingId,s.sessionId);}catch(error){for(const row of this.rows.values())if(row.session?.sessionId===s.sessionId&&row.owner===s.ownerBindingId)this.revoke(row,'BLOCKED','NATIVE_SAFETY_MEMBERSHIP_LOST');throw error instanceof NativeStopReceiptError?new FileServiceError(error.code,error.status):error;}
    for(const [id,row]of this.sessions){try{nativeStopReceipts.assertActiveSession(row.safetyMembership);}catch{this.sessions.delete(id);for(const binding of this.rows.values())if(binding.session?.safetyMembership.safetySessionRef===row.safetyMembership.safetySessionRef)this.revoke(binding,'BLOCKED','NATIVE_SAFETY_MEMBERSHIP_LOST');}}
    if(this.sessions.size>=16&&!this.sessions.has(s.sessionId))throw new FileServiceError('NATIVE_SESSION_LIMIT',429);
    const old=this.sessions.get(s.sessionId);
    if(old){
      this.safety(old);
      if(!this.sameMembership(old.safetyMembership,safetyMembership))throw new FileServiceError('NATIVE_SAFETY_MEMBERSHIP_INVALID',409);
      if(old.reservationId!==s.reservationId){const bound=[...this.rows.values()].filter(b=>b.session?.sessionId===old.sessionId&&b.session?.reservationId===old.reservationId);if(!bound.length||bound.some(b=>!b.revoked&&!['COMPLETED','CANCELLED','FAILED'].includes(taskService.getTask(b.taskId)?.status??'')))throw new FileServiceError('NATIVE_SESSION_CONCURRENT_RESERVATION',409);}
      else if(['ownerBindingId','sessionId','reservationId','applicationId','windowId','processId','imagePathFingerprint'].some(k=>(old as any)[k]!==s[k]))throw new FileServiceError('NATIVE_SESSION_CONFLICT',409);
    }
    const originalBinding=[...this.rows.values()].find(row=>row.owner===s.ownerBindingId&&row.session?.sessionId===s.sessionId&&row.session.reservationId===s.reservationId);
    const original=originalBinding?.session;if(original){this.safety(original,originalBinding);if(!this.sameMembership(original.safetyMembership,safetyMembership))throw new FileServiceError('NATIVE_SAFETY_MEMBERSHIP_INVALID',409);}
    const expiresAt=Math.min(s.expiresAt,safetyMembership.expiresAt,old?.reservationId===s.reservationId?old.expiresAt:Infinity,original?.expiresAt??Infinity);
    if(expiresAt<=Date.now())throw new FileServiceError('NATIVE_SESSION_INVALID',410);
    const {source,...session}=s;this.safety({...session,safetyMembership,expiresAt} as Session);
    this.sessions.set(s.sessionId,{...session,safetyMembership,expiresAt} as Session);return {registered:true,expiresAt,physicalAcceptance:false};
  }
  private validateRequest(input:unknown):Request{const r=strict(input,['app','workflow','query','volume','gameName','sourceFileId','destinationDirectoryId','undoReceiptId']);const allowed=r.app==='spotify'?['open','focus','play','pause','next','previous','library','search','volume']:r.app==='steam'?['open','focus','library','downloads','search','game_detail']:r.app==='explorer'?['copy','move','undo','find']:[];if(!allowed.includes(r.workflow))throw new FileServiceError('NATIVE_WORKFLOW_INVALID');const extras=r.workflow==='game_detail'?['gameName']:r.workflow==='search'?['query']:r.workflow==='volume'?['volume']:r.app==='explorer'?r.workflow==='undo'?['undoReceiptId']:r.workflow==='find'?['sourceFileId']:['sourceFileId','destinationDirectoryId']:[];if(Object.keys(r).some(k=>!['app','workflow',...extras].includes(k))||extras.some(k=>r[k]===undefined)||r.workflow==='search'&&(typeof r.query!=='string'||!r.query.trim()||r.query.length>160||/[\x00-\x1f\x7f]/.test(r.query))||r.workflow==='game_detail'&&!gameNameValid(r.gameName)||r.workflow==='volume'&&(!Number.isSafeInteger(r.volume)||r.volume<0||r.volume>100)||r.app==='explorer'&&extras.some(k=>!safeId(r[k])))throw new FileServiceError('NATIVE_WORKFLOW_INVALID');return Object.fromEntries(['app','workflow',...extras].map(k=>[k,r[k]])) as Request;}
  create(owner:OwnerSessionContext,input:unknown,key:string){const body=strict(input,['workflowId','sessionId','request']);if(!safeId(body.workflowId)||!safeId(body.sessionId))throw new FileServiceError('NATIVE_WORKFLOW_INVALID');const session=this.sessions.get(body.sessionId);if(!session||session.ownerBindingId!==owner.bindingId||session.reservationId!==body.workflowId||session.expiresAt<=Date.now())throw new FileServiceError('NATIVE_SESSION_CONFIGURATION_REQUIRED',501);this.safety(session);const request=this.validateRequest(body.request);if(request.app==='explorer')throw new FileServiceError('NATIVE_EXPLORER_PLAN_REQUIRED',409);if(request.app!==session.applicationId)throw new FileServiceError('NATIVE_SESSION_APPLICATION_MISMATCH',409);const b=this.createRow(owner,request,key,body.workflowId);if(b.session&&['ownerBindingId','sessionId','reservationId','applicationId','windowId','processId','imagePathFingerprint'].some(k=>(b.session as any)[k]!== (session as any)[k]))throw new FileServiceError('NATIVE_SESSION_CONFLICT',409);this.attachSession(b,session);return this.view(b);}
  private createRow(owner:OwnerSessionContext,request:Request,key:string,workflowId:string){this.recover();this.authority(owner.bindingId);if(!/^[A-Za-z0-9_-]{8,100}$/.test(key))throw new FileServiceError('NATIVE_IDEMPOTENCY_REQUIRED');const requestDigest=digest(JSON.stringify({request,workflowId}));const prior=[...this.rows.values()].find(b=>b.owner===owner.bindingId&&b.key===key);if(prior){if(prior.requestDigest!==requestDigest)throw new FileServiceError('NATIVE_IDEMPOTENCY_CONFLICT',409);if(prior.session)this.safety(prior.session,prior);if(!['COMPLETED','CANCELLED','FAILED'].includes(taskService.getTask(prior.taskId)?.status??''))this.current(prior.bindingId);return prior;}if([...this.rows.values()].some(b=>b.owner===owner.bindingId&&b.workflowId===workflowId))throw new FileServiceError('NATIVE_RESERVATION_ALREADY_BOUND',409);if(this.rows.size>=128)throw new FileServiceError('NATIVE_BINDING_LIMIT',429);const bindingId=randomUUID(),expiresAt=Math.min(owner.expiresAt,Date.now()+120000);const task=taskService.createNativeTask(bindingId,requestDigest,request.app+' '+request.workflow);const b:Binding={bindingId,taskId:task.id,owner:owner.bindingId,key,request,requestDigest,workflowId,nonce:randomUUID(),expiresAt,revoked:false,observations:new Set(),steps:[],timer:setTimeout(()=>this.revoke(b,'BLOCKED','NATIVE_BINDING_EXPIRED'),Math.max(1,expiresAt-Date.now()))};b.timer.unref();this.rows.set(bindingId,b);return b;}
  external(owner:OwnerSessionContext,request:unknown,key:string,operationId:string,abort:()=>void){const b=this.createRow(owner,this.validateRequest(request),key,'operation-'+operationId);if(b.operationId&&b.operationId!==operationId)throw new FileServiceError('NATIVE_OPERATION_CONFLICT',409);b.operationId=operationId;b.abort=abort;this.operations.set(operationId,b);return this.view(b);}
  assertOperation(operationId:string){const b=this.operations.get(operationId);if(b)this.current(b.bindingId);}
  startOperation(operationId:string){const b=this.operations.get(operationId);if(!b)throw new FileServiceError('NATIVE_OPERATION_BINDING_REQUIRED',409);if(b){this.current(b.bindingId);taskService.nativeTransition(b.taskId,'RUNNING','task.status_changed');}}
  effect(operationId:string,proof:{folderFingerprint:string;selectedNameFingerprint:string;validate?:()=>void}){const b=this.operations.get(operationId);if(!b)return;this.current(b.bindingId);b.fs={...proof};}
  findSelected(operationId:string,proof:{folderFingerprint:string;selectedNameFingerprint:string},observationId:string){const b=this.operations.get(operationId);if(!b||b.request.workflow!=='find'||b.steps.at(-1)?.post.observationId!==observationId)throw new FileServiceError('NATIVE_FIND_LEDGER_REQUIRED',409);this.effect(operationId,proof);const s=b.session;if(!s)throw new FileServiceError('NATIVE_CONTEXT_INVALID',409);return this.finish(b.bindingId,{nonce:b.nonce,taskId:b.taskId,ownerBindingId:b.owner,sessionId:s.sessionId,reservationId:s.reservationId,requestDigest:b.requestDigest});}
  failOperation(operationId:string){const b=this.operations.get(operationId);if(b)this.revoke(b,'BLOCKED','NATIVE_OPERATION_UNVERIFIED');}
  revokeOperation(operationId:string){const b=this.operations.get(operationId);if(b)this.revoke(b,'CANCELLED','OPERATION_CANCELLED');}
  associate(input:unknown){const r=strict(input,['operationId','ownerBindingId','sessionId','reservationId']);const b=this.operations.get(r.operationId),s=this.sessions.get(r.sessionId);if(!b||!s||s.ownerBindingId!==r.ownerBindingId||b.owner!==r.ownerBindingId||s.reservationId!==r.reservationId||s.applicationId!=='explorer'||s.expiresAt<=Date.now())throw new FileServiceError('NATIVE_OPERATION_ASSOCIATION_INVALID',409);this.current(b.bindingId);if([...this.rows.values()].some(row=>row!==b&&row.session?.sessionId===s.sessionId&&!row.revoked&&!['COMPLETED','CANCELLED','FAILED'].includes(taskService.getTask(row.taskId)?.status??'')))throw new FileServiceError('NATIVE_RESERVATION_ALREADY_BOUND',409);if(b.session)throw new FileServiceError('NATIVE_OPERATION_ASSOCIATION_REPLAY',409);this.safety(s,b);this.attachSession(b,s);this.current(b.bindingId);return this.privateSource(b);}
  private privateSource(b:Binding){return {...this.view(b),nonce:b.nonce,ownerBindingId:b.owner,requestDigest:b.requestDigest,sessionId:b.session?.sessionId,reservationId:b.session?.reservationId,request:{app:b.request.app,workflow:b.request.workflow,...(b.request.query?{queryFingerprint:digest(b.request.query)}:{}),...(b.request.volume!==undefined?{volume:b.request.volume}:{}),...(b.request.gameName!==undefined?{gameNameFingerprint:digest(b.request.gameName.trim())}:{})}};}
  source(id:string){return this.privateSource(this.current(id));}
  private context(id:string,input:unknown,extra:string[]=[]){const r=strict(input,['nonce','taskId','ownerBindingId','sessionId','reservationId','requestDigest',...extra]),b=this.current(id),s=b.session;if(s&&s.expiresAt<=Date.now()){this.revoke(b,'BLOCKED','NATIVE_SESSION_EXPIRED');throw new FileServiceError('NATIVE_CONTEXT_EXPIRED',409);}if(!s||this.sessions.get(s.sessionId)?.reservationId!==s.reservationId||r.nonce!==b.nonce||r.taskId!==b.taskId||r.ownerBindingId!==b.owner||r.sessionId!==s.sessionId||r.reservationId!==s.reservationId||r.requestDigest!==b.requestDigest)throw new FileServiceError('NATIVE_CONTEXT_INVALID',409);return {b,r,s};}
  private snapshot(value:unknown,s:Session,b:Binding,allowProfilePin=true){const detail=b.request.app==='steam'&&b.request.workflow==='game_detail',v2=detail&&!!value&&typeof value==='object'&&(value as Record<string,unknown>).view==='game_detail';const p=strict(value,['source','observationId','observedAt','applicationId','windowId','processId','imagePathFingerprint','foreground','playback','trackFingerprint','queryFingerprint','view','itemCount','volume','folderFingerprint','selectedNameFingerprint','selectedCount','gameEntryFingerprint','selectedGameFingerprint','gameTitleFingerprint','gameDetailContextFingerprint',...(v2?['gameDetailWitnessVersion','gameDetailProviderProfileFingerprint']:[])]);if(!s.windowId||!s.processId||!s.imagePathFingerprint||p.source!=='native_uia_state'||!safeId(p.observationId)||!Number.isSafeInteger(p.observedAt)||p.observedAt>Date.now()+1000||Date.now()-p.observedAt>5000||p.applicationId!==s.applicationId||p.windowId!==s.windowId||p.processId!==s.processId||p.imagePathFingerprint!==s.imagePathFingerprint||p.foreground!==true||['trackFingerprint','queryFingerprint','folderFingerprint','selectedNameFingerprint'].some(k=>p[k]!==undefined&&!hash(p[k]))||p.playback!==undefined&&!['playing','paused'].includes(p.playback)||p.view!==undefined&&!['search','library','downloads','game_detail'].includes(p.view)||['itemCount','selectedCount'].some(k=>p[k]!==undefined&&(!Number.isSafeInteger(p[k])||p[k]<0||p[k]>10000))||p.volume!==undefined&&(!Number.isFinite(p.volume)||p.volume<0||p.volume>100))throw new FileServiceError('NATIVE_POSTSTATE_INVALID',409);const gameKeys=['gameEntryFingerprint','selectedGameFingerprint','gameTitleFingerprint','gameDetailContextFingerprint'];
    if((p.view==='game_detail'||gameKeys.some(k=>p[k]!==undefined))&&!detail||gameKeys.some(k=>p[k]!==undefined&&!hash(p[k]))||p.gameEntryFingerprint!==undefined&&!['search','library'].includes(p.view)||['selectedGameFingerprint','gameTitleFingerprint','gameDetailContextFingerprint'].some(k=>p[k]!==undefined)&&p.view!=='game_detail'||p.view==='game_detail'&&(!['selectedGameFingerprint','gameTitleFingerprint','gameDetailContextFingerprint'].every(k=>hash(p[k]))||p.selectedCount!==1||!Object.hasOwn(p,'gameDetailWitnessVersion')||p.gameDetailWitnessVersion!==2||!Object.hasOwn(p,'gameDetailProviderProfileFingerprint')||!hash(p.gameDetailProviderProfileFingerprint)))throw new FileServiceError('NATIVE_POSTSTATE_INVALID',409);
    if(v2)this.requireSteamProfile(b,p.gameDetailProviderProfileFingerprint,allowProfilePin);
    return {...p} as NativeSnapshot;}
  private requestedSkip(value:unknown,b:Binding,pre:NativeSnapshot|ReservationSnapshot):RequestedSkip {
    const r=strict(value,['source','canonicalActionId','kind','targetId','controlType','nameFingerprint']);
    const labels=b.request.workflow==='next'?['next','sonraki']:b.request.workflow==='previous'?['previous','önceki']:[];
    if(b.request.app!=='spotify'||!labels.length||pre.source!=='native_uia_state'||!hash(pre.trackFingerprint)||r.source!=='native_uia_action'||!safeId(r.canonicalActionId)||r.kind!=='clickMouse'||!safeId(r.targetId)||r.controlType!==50000||!labels.some(label=>digest(label)===r.nameFingerprint)||b.steps.some(step=>step.requestedSkip?.canonicalActionId===r.canonicalActionId))throw new FileServiceError('NATIVE_SKIP_ACTION_INVALID',409);
    return {...r} as RequestedSkip;
  }
  private requestedGameNavigation(value:unknown,b:Binding,pre:NativeSnapshot|ReservationSnapshot):RequestedGameNavigation {
    const r=strict(value,['source','canonicalActionId','kind','targetId','controlType','nameFingerprint','entryFingerprint']);
    if(b.request.app!=='steam'||b.request.workflow!=='game_detail'||pre.source!=='native_uia_state'||!['search','library'].includes(pre.view??'')||!hash(pre.gameEntryFingerprint)||r.source!=='native_uia_action'||!safeId(r.canonicalActionId)||r.kind!=='clickMouse'||!safeId(r.targetId)||![50007,50029].includes(r.controlType)||!hash(r.nameFingerprint)||r.nameFingerprint!==digest(b.request.gameName!.trim())||!hash(r.entryFingerprint)||r.entryFingerprint!==pre.gameEntryFingerprint||b.steps.some(step=>step.requestedGameNavigation?.canonicalActionId===r.canonicalActionId))throw new FileServiceError('NATIVE_GAME_NAVIGATION_ACTION_INVALID',409);
    return {...r} as RequestedGameNavigation;
  }
  check(id:string,input:unknown){const {b,r,s}=this.context(id,input,['pre','requestedSkip','requestedGameNavigation']);if(r.requestedSkip!==undefined&&r.requestedGameNavigation!==undefined)throw new FileServiceError('NATIVE_GAME_NAVIGATION_ACTION_INVALID',409);if(b.pending||b.steps.length>=32)throw new FileServiceError('NATIVE_ACTION_REPLAY_OR_LIMIT',409);const pre=s.windowId?this.snapshot(r.pre,s,b):this.reservationSnapshot(r.pre,b),requestedSkip=r.requestedSkip===undefined?undefined:this.requestedSkip(r.requestedSkip,b,pre),requestedGameNavigation=r.requestedGameNavigation===undefined?undefined:this.requestedGameNavigation(r.requestedGameNavigation,b,pre),actionId=randomUUID(),permitNonce=randomUUID();if(b.observations.has(pre.observationId))throw new FileServiceError('NATIVE_OBSERVATION_REPLAY',409);this.current(b.bindingId);b.observations.add(pre.observationId);b.pending={actionId,permitNonce,pre,...(requestedSkip?{requestedSkip}:{}),...(requestedGameNavigation?{requestedGameNavigation}:{})};if(taskService.getTask(b.taskId)?.status==='QUEUED')taskService.nativeTransition(b.taskId,'RUNNING','task.status_changed');this.current(b.bindingId);taskService.nativeTransition(b.taskId,'RUNNING','task.tool_started',{toolId:'native_app_workflow',runId:actionId,riskLevel:2});this.current(b.bindingId);return {actionId,permitNonce,expiresAt:Math.min(b.expiresAt,s.expiresAt)};}
  step(id:string,input:unknown){const {b,r,s}=this.context(id,input,['actionId','permitNonce','dispatch','partialInput','post','nativeActionId','nativeTargetId']);const pending=b.pending;if(!pending||pending.actionId!==r.actionId||pending.permitNonce!==r.permitNonce)throw new FileServiceError('NATIVE_ACTION_RECEIPT_INVALID',409);if(r.dispatch!=='dispatched'||r.partialInput!==false){this.revoke(b,'BLOCKED','NATIVE_DISPATCH_INCOMPLETE');throw new FileServiceError('NATIVE_DISPATCH_INCOMPLETE',409);}if(pending.requestedGameNavigation&&(r.nativeActionId!==pending.requestedGameNavigation.canonicalActionId||r.nativeTargetId!==pending.requestedGameNavigation.targetId)){this.revoke(b,'BLOCKED','NATIVE_GAME_NAVIGATION_DISPATCH_MISMATCH');throw new FileServiceError('NATIVE_GAME_NAVIGATION_DISPATCH_MISMATCH',409);}if(pending.requestedSkip?(r.nativeActionId!==pending.requestedSkip.canonicalActionId||r.nativeTargetId!==pending.requestedSkip.targetId):(!pending.requestedGameNavigation&&(r.nativeActionId!==undefined||r.nativeTargetId!==undefined))){this.revoke(b,'BLOCKED','NATIVE_SKIP_DISPATCH_MISMATCH');throw new FileServiceError('NATIVE_SKIP_DISPATCH_MISMATCH',409);}const post=this.snapshot(r.post,s,b);if(b.observations.has(post.observationId)||post.observationId===pending.pre.observationId||post.observedAt<pending.pre.observedAt)throw new FileServiceError('NATIVE_OBSERVATION_REPLAY',409);this.current(b.bindingId);b.observations.add(post.observationId);b.steps.push({actionId:pending.actionId,pre:pending.pre,post,...(pending.requestedSkip?{requestedSkip:pending.requestedSkip}:{}),...(pending.requestedGameNavigation?{requestedGameNavigation:pending.requestedGameNavigation}:{})});b.pending=undefined;taskService.nativeTransition(b.taskId,'RUNNING','task.tool_completed',{toolId:'native_app_workflow',runId:r.actionId,outcome:'success'});this.current(b.bindingId);return {recorded:true};}
  finish(id:string,input:unknown){const {b}=this.context(id,input);try{if(b.pending||!b.steps.length)throw new FileServiceError('NATIVE_LEDGER_INCOMPLETE',409);const finalStep=b.steps.at(-1)!,last=finalStep.post;if(Date.now()-last.observedAt>5000)throw new FileServiceError('NATIVE_POSTSTATE_STALE',409);b.fs?.validate?.();this.current(b.bindingId);this.finalSteamProfile(b,last);const w=b.request.workflow;let matched=w==='open'||w==='focus';if(w==='play'||w==='pause')matched=last.playback===(w==='play'?'playing':'paused');if(w==='next'||w==='previous')matched=!!finalStep.requestedSkip&&finalStep.pre.source==='native_uia_state'&&Date.now()-finalStep.pre.observedAt<=5000&&!!finalStep.pre.trackFingerprint&&!!last.trackFingerprint&&finalStep.pre.trackFingerprint!==last.trackFingerprint;if(w==='game_detail')matched=b.request.app==='steam'&&!!finalStep.requestedGameNavigation&&finalStep.pre.source==='native_uia_state'&&Date.now()-finalStep.pre.observedAt<=5000&&['search','library'].includes(finalStep.pre.view??'')&&finalStep.pre.gameEntryFingerprint===finalStep.requestedGameNavigation.entryFingerprint&&last.view==='game_detail'&&last.selectedCount===1&&last.selectedGameFingerprint===finalStep.requestedGameNavigation.entryFingerprint&&last.gameTitleFingerprint===digest(b.request.gameName!.trim())&&hash(last.gameDetailContextFingerprint)&&last.gameDetailWitnessVersion===2&&hash(last.gameDetailProviderProfileFingerprint);if(w==='search')matched=last.view==='search'&&last.queryFingerprint===digest(b.request.query!)&&Number(last.itemCount)>0;if(w==='library'||w==='downloads')matched=last.view===w&&Number.isSafeInteger(last.itemCount);if(w==='volume')matched=last.volume!==undefined&&Math.abs(last.volume-b.request.volume!)<=1;if(b.request.app==='explorer')matched=!!b.fs&&last.folderFingerprint===b.fs.folderFingerprint&&last.selectedNameFingerprint===b.fs.selectedNameFingerprint&&last.selectedCount===1;if(!matched)throw new FileServiceError('NATIVE_REQUIRED_POSTCONDITION_FAILED',409);const proof:EdithVerificationResult={id:randomUUID(),taskId:b.taskId,verifier:'heuristic-v1',status:'PASS',checkedAt:new Date().toISOString(),summary:'Trusted native ledger and independent required postconditions verified.',retryable:false,checks:[{id:'native-session-ledger',label:'Current native owner session and issued action ledger',status:'PASS',required:true,evidence:'Private native context, nonce, issued actions and fresh post-observation matched.'},{id:'native-required-postcondition',label:'Independent required app or filesystem postcondition',status:'PASS',required:true,evidence:b.fs?'Backend independent Files result plus exact native folder/unique selection matched.':'Fresh native UIA poststate matched the bound app request.'}]};this.current(b.bindingId);this.finalSteamProfile(b,last);b.proof=proof;taskService.nativeTransition(b.taskId,'VERIFYING','task.status_changed');this.current(b.bindingId);this.finalSteamProfile(b,last);taskService.nativeTransition(b.taskId,'VERIFYING','task.verification_completed',{verificationId:proof.id,status:'PASS'},proof);this.current(b.bindingId);this.finalSteamProfile(b,last);taskService.nativeTransition(b.taskId,'COMPLETED','task.completed',{},proof);clearTimeout(b.timer);return this.view(b);}catch(error){if(!b.firstFinishFailure&&error instanceof FileServiceError&&canonicalFinishFailureCodes.has(error.code))b.firstFinishFailure=error.code;throw error;}}
  private verification(task:EdithTask):EdithVerificationResult{const b=[...this.rows.values()].find(row=>row.taskId===task.id);if(b&&task.status!=='COMPLETED'){try{this.current(b.bindingId);if(b.proof)this.finalSteamProfile(b,b.steps.at(-1)!.post);}catch{/* Revocation clears pending proof; report truthful retryable below. */}}return b?.proof&&!b.revoked?b.proof:{id:randomUUID(),taskId:task.id,verifier:'heuristic-v1',status:'RETRYABLE',checkedAt:new Date().toISOString(),summary:'Current trusted native required proof is unavailable.',retryable:true,checks:[{id:'native-required-proof',label:'Backend-owned required postcondition',status:'RETRYABLE',required:true,evidence:'Missing, revoked or stale native authority cannot mint PASS.'}]};}
  cancelTask(id:string,action:'cancel'|'pause'){const b=[...this.rows.values()].find(row=>row.taskId===id);if(b)this.revoke(b,action==='cancel'?'CANCELLED':'BLOCKED',action==='cancel'&&b.firstFinishFailure?b.firstFinishFailure:'NATIVE_TASK_'+action.toUpperCase());else taskService.nativeTransition(id,action==='cancel'?'CANCELLED':'BLOCKED',action==='cancel'?'task.cancelled':'task.status_changed',action==='cancel'?{reasonCode:'STALE_NATIVE_TASK'}:undefined);return taskService.getTask(id);}
  private revoke(b:Binding,status:'CANCELLED'|'BLOCKED',reason:string){
    const task=taskService.getTask(b.taskId);if(b.revoked||task?.status==='COMPLETED')return;
    b.revoked=true;b.proof=undefined;b.pending=undefined;clearTimeout(b.timer);
    const invalidated:EdithVerificationResult|undefined=task?.verification?.status==='PASS'?{id:randomUUID(),taskId:b.taskId,verifier:'heuristic-v1',status:'RETRYABLE',checkedAt:new Date().toISOString(),summary:'Native authority was revoked before task completion.',retryable:true,checks:[{id:'native-required-proof',label:'Current original native authority',status:'RETRYABLE',required:true,evidence:'The original native scope is no longer active; prior incomplete proof cannot certify completion.'}]}:undefined;
    try{b.abort?.();}finally{const fromStatus=taskService.getTask(b.taskId)?.status??task?.status;taskService.nativeTransition(b.taskId,status,status==='CANCELLED'?'task.cancelled':'task.status_changed',status==='CANCELLED'?{reasonCode:reason}:{fromStatus,toStatus:status,reasonCode:reason},invalidated);}
  }
  close(){for(const b of this.rows.values())this.revoke(b,'BLOCKED','NATIVE_BINDING_CLOSED');this.sessions.clear();}
}
let service:NativeTaskBindingService|undefined;
export function getNativeTaskBinding(){return service??=new NativeTaskBindingService();}
