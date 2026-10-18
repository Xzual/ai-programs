import {randomUUID} from 'node:crypto';
import {snapshotReaJson} from './reaContract';
import {parseReaPlannedCall,reaProjectionDigest} from './reaIntegrationContract';
import {createReaKnowledgeReceiptConsumer} from './reaKnowledgeReceipt';
import type {ReaCanonicalTaskBridge} from './reaCanonicalTaskBridge';
import type {TaskService} from './taskService';
import type {EdithPersistenceStore} from './persistence/types';
import type {ReaKnowledgeReceiptOptions,ReaKnowledgeReadScope,ReaKnowledgeCanonicalBinding} from './reaKnowledgeReceipt';

export interface ReaKnowledgeCanonicalAdapterOptions {
 readonly bridge:ReaCanonicalTaskBridge;
 readonly tasks:Pick<TaskService,'getTask'>;
 readonly store:Pick<EdithPersistenceStore,'listToolRuns'|'readRecentAuditEvents'>;
 readonly writeAuthority?:Pick<ReaKnowledgeReceiptOptions['authority'],'resolveWrite'|'assertWriteCurrent'>;
 readonly exporter?:ReaKnowledgeReceiptOptions['exporter'];
 readonly persistExportReceipt?:ReaKnowledgeReceiptOptions['persistExportReceipt'];
 readonly waitTimeoutMs?:number;
}
const safeId=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v);
const stop:()=>never=()=>{throw new Error('REA_KNOWLEDGE_CANONICAL_AUTHORITY_REQUIRED');};
function immutable<T>(value:T):T{if(value&&typeof value==='object'){Object.values(value).forEach(immutable);Object.freeze(value);}return value;}

/** Trusted server composition only: inject the actual boot-owned bridge/tasks/store, never a request
 * DTO or an asserted TS brand. The live bridge's private capability checks supply authority. This
 * factory imports no bridge/service/store singleton, invokes no task, and cannot restore authority. */
export function createReaKnowledgeCanonicalAdapter(options:ReaKnowledgeCanonicalAdapterOptions){
 const bridge=options.bridge;
 if(!bridge||['readExpected','readCommitment','readExecutionRecord','assertReceiptAuthority','readReceipt'].some(k=>typeof (bridge as any)[k]!=='function')||typeof options.tasks?.getTask!=='function'||typeof options.store?.listToolRuns!=='function'||typeof options.store?.readRecentAuditEvents!=='function')stop();
 const readExpected=bridge.readExpected.bind(bridge),readCommitment=bridge.readCommitment.bind(bridge),readExecutionRecord=bridge.readExecutionRecord.bind(bridge),assertAuthority=bridge.assertReceiptAuthority.bind(bridge),readReceipt=bridge.readReceipt.bind(bridge);
 const getTask=options.tasks.getTask.bind(options.tasks),listToolRuns=options.store.listToolRuns!.bind(options.store),readAudits=options.store.readRecentAuditEvents.bind(options.store);
 const origin=Object.freeze({}),write=options.writeAuthority?Object.freeze({...options.writeAuthority}):undefined;
 function source(owner:string,taskId:string,auditId:string){
  const expected=readExpected(taskId,auditId);if(!expected)stop();
  assertAuthority(taskId,auditId,{stepId:expected.identity.stepId,targetRefId:expected.selectionRef});
  const record=readExecutionRecord(expected.identity),commitment=readCommitment(taskId,auditId);
  if(!record?.call||!commitment||record.ownerSessionBindingId!==owner||record.identity.taskId!==taskId||record.expiresAt<=Date.now()||!safeId(record.ownerId)||!safeId(record.workspaceId)||!safeId(record.serverBootId))stop();
  const call=parseReaPlannedCall(record.call);if(reaProjectionDigest(call)!==expected.inputDigest)stop();
  const scope:ReaKnowledgeReadScope={ownerId:record.ownerId,workspaceId:record.workspaceId,taskId,selectionRef:expected.selectionRef,selectionRevision:expected.selectionRevision,expiresAt:record.expiresAt};
  const binding:ReaKnowledgeCanonicalBinding={schemaVersion:1,plannedSelectionRef:call.args.selectionRef,...commitment};
  return immutable({expected:snapshotReaJson(expected) as typeof expected,scope,binding,fingerprint:reaProjectionDigest({expected,record,commitment})});
 }
 type Grant={reference:string;owner:string;taskId:string;auditId:string;state:ReturnType<typeof source>};
 const grants=new WeakMap<object,Grant>(),references=new Map<string,Grant>();
 function current(g:Grant){
  if(references.get(g.reference)!==g)stop();const next=source(g.owner,g.taskId,g.auditId);
  if(next.fingerprint!==g.state.fingerprint)stop();
  return next;
 }
 function grantFor(token:unknown,reference?:string){if(!token||typeof token!=='object')stop();const grant=grants.get(token);if(!grant||reference!==undefined&&grant.reference!==reference)stop();current(grant);return grant;}
 const consumer=createReaKnowledgeReceiptConsumer({
  ...(options.waitTimeoutMs===undefined?{}:{waitTimeoutMs:options.waitTimeoutMs}),
  authority:{resolveRead(token,reference){return current(grantFor(token,reference)).scope;},assertReadCurrent(scope,token){const g=grantFor(token);if(reaProjectionDigest(scope)!==reaProjectionDigest(current(g).scope))stop();},
   resolveWrite(token,scope,reportRef){if(!write)stop();return write.resolveWrite(token,scope,reportRef);},assertWriteCurrent(intent,scope,token){if(!write)stop();write.assertWriteCurrent(intent,scope,token);}},
  reader:{origin,getTask,listToolRuns,readRecentAuditEvents:readAudits,
   locateCanonical(scope,reference){const g=references.get(reference);if(!g)stop();const state=current(g);if(reaProjectionDigest(scope)!==reaProjectionDigest(state.scope))stop();return{origin,reference,expected:state.expected,binding:state.binding};},
   readCanonicalReceipt(log,reference){const g=references.get(reference);if(!g||g.state.expected.toolRunId!==log.id)stop();const state=current(g);
    const value=readReceipt(g.owner,g.taskId,g.auditId);current(g);
    if(typeof log.result!=='string'||Buffer.byteLength(log.result)>98304||reaProjectionDigest(JSON.parse(log.result))!==state.binding.receiptDigest||reaProjectionDigest(value)!==state.binding.receiptDigest)stop();
    return{origin,value};}},
  ...(options.exporter?{exporter:options.exporter}:{}),...(options.persistExportReceipt?{persistExportReceipt:options.persistExportReceipt}:{}),
 });
 return Object.freeze({consumer,
  authorizeRead(owner:string,taskId:string,auditId:string){
   if(!safeId(owner)||!safeId(taskId)||!safeId(auditId)||references.size>=256)stop();
   const state=source(owner,taskId,auditId),receipt=readReceipt(owner,taskId,auditId);
   if(reaProjectionDigest(receipt)!==state.binding.receiptDigest||source(owner,taskId,auditId).fingerprint!==state.fingerprint)stop();
   const reference='rea_knowledge_'+randomUUID(),readAuthority=Object.freeze({}),g:Grant={reference,owner,taskId,auditId,state};
   references.set(reference,g);grants.set(readAuthority,g);current(g);return Object.freeze({reference,readAuthority});
  },
  revokeRead(token:unknown){if(token&&typeof token==='object'){const g=grants.get(token);if(g){references.delete(g.reference);grants.delete(token);}}},
 });
}
