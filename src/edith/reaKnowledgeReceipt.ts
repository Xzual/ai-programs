import {types} from 'node:util';
import {snapshotReaJson} from './reaContract';
import {hudUtc} from './taskHudContracts';
import {parseReaExecutionReceipt,parseReaPlannedCall,reaProjectionDigest,type ReaReceiptCorrelationV1,type ReaExecutionReceiptV1} from './reaIntegrationContract';
import type {ReaSafeTechnicalFactV1,ReaSafeStructuralRelationshipV1,ReaSafeTechnicalOmissionV1} from './reaIntegrationContract';
import type {TaskService} from './taskService';
import type {EdithPersistenceStore} from './persistence/types';
import type {EdithAuditEvent} from './core';
import type {ToolExecutionLog} from '../types';
import type {ObsidianVaultService,ObsidianExportStatus} from './obsidianVaultService';

type Awaitable<T>=T|Promise<T>;
export interface ReaKnowledgeReadScope {readonly ownerId:string;readonly workspaceId:string;readonly taskId:string;readonly selectionRef:string;readonly selectionRevision:number;readonly expiresAt:number}
export interface ReaKnowledgeWriteIntent {readonly ownerId:string;readonly workspaceId:string;readonly taskId:string;readonly reportRef:string;readonly destinationRef:string;readonly intentId:string;readonly expiresAt:number}
export interface ReaKnowledgeCanonicalBinding {readonly schemaVersion:1;readonly plannedSelectionRef:string;readonly receiptDigest:string;readonly finishedAt:string;readonly receiptObservedAt:string}
export interface ReaKnowledgeReader {
 readonly origin:object;
 getTask(id:string):Awaitable<ReturnType<TaskService['getTask']>>;
 listToolRuns(limit?:number):Awaitable<ReturnType<NonNullable<EdithPersistenceStore['listToolRuns']>>>;
 readRecentAuditEvents(limit?:number):Awaitable<EdithAuditEvent[]>;
 /** Must read independent canonical stored correlation, never derive expected fields from receipt/request. */
 locateCanonical(scope:ReaKnowledgeReadScope,reference:string):Awaitable<{origin:object;reference:string;expected:ReaReceiptCorrelationV1;binding:ReaKnowledgeCanonicalBinding}|undefined>;
 /** Future released carrier decoder over the actual persisted log. No client receipt is accepted. */
 readCanonicalReceipt(log:Readonly<ToolExecutionLog>,reference:string):Awaitable<{origin:object;value:unknown}>;
}
export interface ReaKnowledgeProjection {
 readonly schemaVersion:1;readonly reportRef:string;readonly taskReportRef:string;readonly profile:string;
 readonly outcome:ReaExecutionReceiptV1['outcome'];readonly cleanup:Readonly<{closed:boolean;unknownEffect:boolean}>;
 readonly coverage:'unverified';readonly summary:string;readonly spokenSummary:string;readonly uncertainty:string;
 readonly facts:readonly Readonly<{key:string;value:string|number|boolean}>[];
 readonly knowledgeMarkdown:string;readonly technicalContent:'typed_supported'|'limited_metadata';
 readonly technicalFacts:readonly ReaSafeTechnicalFactV1[];
 readonly structuralRelationships:readonly ReaSafeStructuralRelationshipV1[];
 readonly technicalLimitations:readonly ReaSafeTechnicalOmissionV1[];
 readonly producerFreeText:'withheld';readonly receiptObservedAt:string;
}
export type ReaKnowledgeReadResult={readonly status:'available';readonly projection:ReaKnowledgeProjection}|{readonly status:'configuration_required'|'blocked'|'error';readonly code:string};
export interface ReaKnowledgeExportReceipt {
 readonly status:'not_requested'|'configuration_required'|'blocked'|'unknown_effect'|'exported'|'skipped'|'disabled'|'error';
 readonly code:string;readonly unknownEffect:boolean;readonly reportRef?:string;readonly exportReceiptRef?:string;
 readonly writerAction?:ObsidianExportStatus['action'];readonly writerCode?:ObsidianExportStatus['errorCode'];readonly redacted?:boolean;
 readonly stored?:boolean;readonly persistence?:'not_configured'|'stored'|'failed';
}
export interface ReaKnowledgeReceiptOptions {
 readonly reader?:ReaKnowledgeReader;
 readonly authority:{
  resolveRead(authority:unknown,reference:string):Awaitable<ReaKnowledgeReadScope>;
  assertReadCurrent(scope:ReaKnowledgeReadScope,authority:unknown):void;
  resolveWrite(authority:unknown,scope:ReaKnowledgeReadScope,reportRef:string):Awaitable<ReaKnowledgeWriteIntent>;
  assertWriteCurrent(intent:ReaKnowledgeWriteIntent,scope:ReaKnowledgeReadScope,authority:unknown):void;
 };
 readonly exporter?:{
  readDestination(intent:ReaKnowledgeWriteIntent):Awaitable<{destinationRef:string;configured:boolean;enabled:boolean;writable:boolean;mode:'read_only'|'write_safe'|'read_write_safe'}>;
  writeResearchNote(input:Parameters<ObsidianVaultService['writeResearchNote']>[0]):Awaitable<ReturnType<ObsidianVaultService['writeResearchNote']>>;
 };
 readonly persistExportReceipt?:(receipt:Readonly<ReaKnowledgeExportReceipt>)=>Awaitable<void>;
 readonly waitTimeoutMs?:number;
}
class KnowledgeError extends Error{constructor(readonly code:string){super(code);}}
function fail(code:string):never{throw new KnowledgeError(code);}
const safeId=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v);
function row(v:unknown):Record<string,any>{if(!v||typeof v!=='object'||Array.isArray(v))fail('REA_KNOWLEDGE_RECORD_INVALID');return v as Record<string,any>;}
function frozen<T>(v:T):T{if(v&&typeof v==='object'){Object.values(v).forEach(frozen);Object.freeze(v);}return v;}
function closed(v:unknown,keys:string[]):Record<string,any>{const r=row(snapshotReaJson(v));if(Object.keys(r).length!==keys.length||keys.some(k=>!Object.hasOwn(r,k)))fail('REA_KNOWLEDGE_RECORD_INVALID');return r;}
function originData(v:unknown,origin:object,keys:string[]):Record<string,any>{
 if(!v||typeof v!=='object'||types.isProxy(v)||Array.isArray(v))fail('REA_KNOWLEDGE_ORIGIN_INVALID');
 const descriptors=Object.getOwnPropertyDescriptors(v);if(Object.keys(descriptors).length!==keys.length||keys.some(k=>!descriptors[k]||!Object.hasOwn(descriptors[k],'value')))fail('REA_KNOWLEDGE_ORIGIN_INVALID');
 if(descriptors.origin.value!==origin)fail('REA_KNOWLEDGE_ORIGIN_INVALID');
 return Object.fromEntries(keys.filter(k=>k!=='origin').map(k=>[k,descriptors[k].value]));
}
const readFailure=(e:unknown):Exclude<ReaKnowledgeReadResult,{status:'available'}>=>({status:e instanceof KnowledgeError&&e.code==='REA_KNOWLEDGE_NOT_CONFIGURED'?'configuration_required':e instanceof KnowledgeError&&/SCOPE|ORIGIN/.test(e.code)?'blocked':'error',code:e instanceof KnowledgeError?e.code:'REA_KNOWLEDGE_RECORD_INVALID'});

// Private formatter: only strict-parser output after trusted persisted-source correlation reaches here.
// Labels, values, scopes, limitations and schema pointers use the defining finite catalogue; never
// interpolate the producer's free-text summary, speech or Markdown, or infer names for opaque IDs.
function typedKnowledge(receipt:ReaExecutionReceiptV1,summary:string,uncertainty:string){
 const technicalFacts=receipt.report?.technicalFacts??[];
 const structuralRelationships=receipt.report?.structuralRelationships??[];
 const technicalLimitations=receipt.report?.technicalLimitations??[];
 const technicalContent=technicalFacts.length+structuralRelationships.length>0?'typed_supported' as const:'limited_metadata' as const;
 const lines=['# REA recorded technical observations','',summary,'',uncertainty,''];
 if(technicalContent==='limited_metadata')lines.push('No supported typed technical facts or relationships were recorded. This note contains receipt metadata only.','');
 lines.push('## Technical facts','');
 if(!technicalFacts.length)lines.push('No supported typed technical facts were recorded.','');
 for(const fact of technicalFacts){
  lines.push(`- ${fact.label}: ${String(fact.value)}`,
   `  Scope: ${fact.scope}; Confidence: ${fact.confidence}.`,
   `  Limitation: ${fact.limitation}`,
   `  Evidence: ${fact.provenance.evidenceRef}; original evidence ID: ${fact.provenance.originalEvidenceId}.`,
   `  Validated schema pointer: ${fact.provenance.validatedJSONPointer}`,
   `  Producer observed at: ${fact.provenance.observedAt}; producer version: ${fact.provenance.producerVersion}.`,'');
 }
 lines.push('## Structural relationships','',
  'Opaque node IDs have no supplied human meaning. Static containment and other returned relations do not establish a feature explanation or an executed call flow.','');
 if(!structuralRelationships.length)lines.push('No supported typed structural relationships were recorded.','');
 for(const relationship of structuralRelationships){
  lines.push(`- Relationship ID: ${relationship.id}`,
   `  Opaque source ID: ${relationship.sourceId}; Relation: ${relationship.relation}; opaque target ID: ${relationship.targetId}.`,
   `  Scope: ${relationship.scope}; Confidence: ${relationship.confidence}.`,
   `  Limitation: ${relationship.limitation}`,
   `  Evidence: ${relationship.provenance.evidenceRef}; original evidence ID: ${relationship.provenance.originalEvidenceId}.`,
   `  Validated schema pointer: ${relationship.provenance.validatedJSONPointer}`,'');
 }
 const omissionText:Record<ReaSafeTechnicalOmissionV1,string>={
  source_fact_omitted_unsafe_text:'Unsafe source fact text was omitted.',
  source_fact_omitted_unsupported_value:'An unsupported source fact value was omitted.',
  source_relationship_omitted_unsafe_text:'Unsafe source relationship text was omitted.',
 };
 if(technicalLimitations.length)lines.push('## Recorded omissions','',...technicalLimitations.map(code=>'- '+omissionText[code]),'');
 const knowledgeMarkdown=lines.join('\n');
 if(Buffer.byteLength(knowledgeMarkdown)>32768)fail('REA_KNOWLEDGE_PROJECTION_LIMIT');
 return{knowledgeMarkdown,technicalContent,technicalFacts,structuralRelationships,technicalLimitations};
}

/** Server-only composition. No defaults import a store/vault singleton or authenticate JSON as authority. */
export function createReaKnowledgeReceiptConsumer(options:ReaKnowledgeReceiptOptions){
 const timeout=options.waitTimeoutMs??5000;if(!Number.isSafeInteger(timeout)||timeout<1||timeout>5000)fail('REA_KNOWLEDGE_CONFIGURATION_INVALID');
 const authority=Object.freeze({...options.authority}),reader=options.reader?Object.freeze({...options.reader}):undefined,exporter=options.exporter?Object.freeze({...options.exporter}):undefined,persist=options.persistExportReceipt;
 if(!authority||['resolveRead','assertReadCurrent','resolveWrite','assertWriteCurrent'].some(k=>typeof (authority as any)[k]!=='function'))fail('REA_KNOWLEDGE_CONFIGURATION_INVALID');
 async function bounded<T>(value:Awaitable<T>):Promise<T>{let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([Promise.resolve(value),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new KnowledgeError('REA_KNOWLEDGE_WAIT_TIMEOUT')),timeout);})]);}finally{if(timer)clearTimeout(timer);}}
 function check(scope:ReaKnowledgeReadScope,token:unknown){if(scope.expiresAt<=Date.now())fail('REA_KNOWLEDGE_SCOPE_EXPIRED');try{authority.assertReadCurrent(scope,token);}catch{fail('REA_KNOWLEDGE_SCOPE_REVOKED');}}
 async function scopeFor(reference:string,token:unknown){if(!safeId(reference))fail('REA_KNOWLEDGE_REFERENCE_INVALID');let value:unknown;try{value=await bounded(authority.resolveRead(token,reference));}catch{fail('REA_KNOWLEDGE_SCOPE_REVOKED');}const s=closed(value,['ownerId','workspaceId','taskId','selectionRef','selectionRevision','expiresAt']);for(const k of ['ownerId','workspaceId','taskId','selectionRef'])if(!safeId(s[k]))fail('REA_KNOWLEDGE_SCOPE_REVOKED');if(!Number.isSafeInteger(s.selectionRevision)||s.selectionRevision<1||!Number.isSafeInteger(s.expiresAt))fail('REA_KNOWLEDGE_SCOPE_REVOKED');const scope=frozen(s) as ReaKnowledgeReadScope;check(scope,token);return scope;}
 async function current<T>(value:Awaitable<T>,scope:ReaKnowledgeReadScope,token:unknown){const r=await bounded(value);check(scope,token);return r;}
 async function load(reference:string,token:unknown){
  const scope=await scopeFor(reference,token);
  if(!reader||!reader.origin||['getTask','listToolRuns','readRecentAuditEvents','locateCanonical','readCanonicalReceipt'].some(k=>typeof (reader as any)[k]!=='function'))fail('REA_KNOWLEDGE_NOT_CONFIGURED');
  check(scope,token);const located=await current(reader.locateCanonical(scope,reference),scope,token);if(!located)fail('REA_KNOWLEDGE_NOT_CONFIGURED');
  const locatedData=originData(located,reader.origin,['origin','reference','expected','binding']);if(locatedData.reference!==reference)fail('REA_KNOWLEDGE_CROSSWALK_INVALID');
  const binding=closed(locatedData.binding,['schemaVersion','plannedSelectionRef','receiptDigest','finishedAt','receiptObservedAt']);
  if(binding.schemaVersion!==1||!safeId(binding.plannedSelectionRef)||typeof binding.receiptDigest!=='string'||!/^[a-f0-9]{64}$/.test(binding.receiptDigest)||!hudUtc(binding.finishedAt)||!hudUtc(binding.receiptObservedAt))fail('REA_KNOWLEDGE_CROSSWALK_INVALID');
  const expected=row(snapshotReaJson(locatedData.expected)) as unknown as ReaReceiptCorrelationV1;
  if(expected.identity?.taskId!==scope.taskId||expected.selectionRef!==scope.selectionRef||expected.selectionRevision!==scope.selectionRevision)fail('REA_KNOWLEDGE_CROSSWALK_INVALID');
  check(scope,token);const task=row(snapshotReaJson(await current(reader.getTask(scope.taskId),scope,token)));
  const plan=row(task.plan),steps=plan.steps;if(task.id!==scope.taskId||plan.taskId!==task.id||plan.id!==expected.identity.planId||!Array.isArray(steps)||steps.length>256)fail('REA_KNOWLEDGE_CROSSWALK_INVALID');
  const matches=steps.filter(step=>row(step).id===expected.identity.stepId);if(matches.length!==1)fail('REA_KNOWLEDGE_CROSSWALK_INVALID');
  const call=parseReaPlannedCall(matches[0].reaCall);if(call.args.selectionRef!==binding.plannedSelectionRef||reaProjectionDigest(call)!==expected.inputDigest)fail('REA_KNOWLEDGE_INPUT_COMMITMENT_INVALID');
  check(scope,token);const logs=await current(reader.listToolRuns(256),scope,token);if(!Array.isArray(logs)||logs.length>256)fail('REA_KNOWLEDGE_RECORD_INVALID');
  const safeLogs=logs.map(v=>row(snapshotReaJson(v))),foundLogs=safeLogs.filter(v=>v.id===expected.toolRunId);if(foundLogs.length!==1)fail('REA_KNOWLEDGE_CROSSWALK_INVALID');
  const log=foundLogs[0],metadata=closed(log.args,['schemaVersion','toolId']);if(log.toolId!=='rea_analysis'||metadata.schemaVersion!==1||metadata.toolId!=='rea_analysis'||!['success','error'].includes(log.status)||typeof log.result!=='string'||Buffer.byteLength(log.result)>98304||!Number.isFinite(log.timestamp)||log.timestamp>Date.now()||log.timestamp!==Date.parse(binding.finishedAt))fail('REA_KNOWLEDGE_INPUT_COMMITMENT_INVALID');
  check(scope,token);const audits=await current(reader.readRecentAuditEvents(256),scope,token);if(!Array.isArray(audits)||audits.length>256)fail('REA_KNOWLEDGE_RECORD_INVALID');
  const foundAudits=audits.map(v=>row(snapshotReaJson(v))).filter(v=>v.id===expected.auditEventId);if(foundAudits.length!==1)fail('REA_KNOWLEDGE_CROSSWALK_INVALID');
  const audit=foundAudits[0];if(audit.taskId!==task.id||audit.toolId!=='rea_analysis'||audit.action!=='tool.execute'||audit.authorization!=='allowed'||!['success','error'].includes(audit.result)||audit.result!==log.status||!hudUtc(audit.timestamp)||Date.parse(audit.timestamp)>Date.now()||Date.parse(audit.timestamp)<Date.parse(binding.receiptObservedAt)||!Array.isArray(task.timeline))fail('REA_KNOWLEDGE_CROSSWALK_INVALID');
  const events=task.timeline.filter((e:any)=>e?.type==='task.tool_completed'&&e.payload?.toolId==='rea_analysis'&&e.payload?.runId===audit.id);
  if(events.length!==1)fail('REA_KNOWLEDGE_CROSSWALK_INVALID');const event=events[0];
  if(event.contractVersion!==2||event.taskId!==task.id||!safeId(event.eventId)||event.id!==event.eventId||!Number.isSafeInteger(event.sequence)||event.sequence<1||!Number.isSafeInteger(event.revision)||event.revision<1||!hudUtc(event.occurredAt)||Date.parse(event.occurredAt)>Date.now()||Date.parse(event.occurredAt)<Date.parse(audit.timestamp)||event.payload.outcome!==(audit.result==='success'?'success':'failure'))fail('REA_KNOWLEDGE_CROSSWALK_INVALID');
  check(scope,token);const decoded=originData(await current(reader.readCanonicalReceipt(frozen(log) as unknown as Readonly<ToolExecutionLog>,reference),scope,token),reader.origin,['origin','value']);
  const receipt=parseReaExecutionReceipt(decoded.value,expected);if(Date.parse(receipt.receiptObservedAt)>Date.now()||Date.parse(receipt.finishedAt)>Date.now()||receipt.report&&receipt.report.profile!==call.args.profile||receipt.finishedAt!==binding.finishedAt||receipt.receiptObservedAt!==binding.receiptObservedAt||reaProjectionDigest(receipt)!==binding.receiptDigest||log.status!==(receipt.outcome==='completed'?'success':'error')||reaProjectionDigest(event.payload.observedMetrics??null)!==reaProjectionDigest(receipt.observedMetrics??null))fail('REA_KNOWLEDGE_CROSSWALK_INVALID');
  const reportRef='rea_report_'+reaProjectionDigest(expected).slice(0,40),taskReportRef='rea_task_'+reaProjectionDigest({taskId:task.id}).slice(0,40);
  const uncertainty='Stored producer receipt only; whole-target coverage and runtime readiness remain unverified.'+(receipt.cleanup.unknownEffect||!receipt.cleanup.closed?' Cleanup or external effects remain uncertain.':'')+' Task SUCCESS and transport status are not verification proof. Producer free text is withheld. Complete feature behavior and call flow remain unverified.';
  const summary=`Recorded REA ${call.args.profile} outcome: ${receipt.outcome}. ${receipt.evidenceIndex.length} recorded evidence entries. Cleanup closed: ${receipt.cleanup.closed}; unknown effects: ${receipt.cleanup.unknownEffect}.`;
  const projection:ReaKnowledgeProjection=frozen({schemaVersion:1,reportRef,taskReportRef,profile:call.args.profile,outcome:receipt.outcome,cleanup:{...receipt.cleanup},coverage:'unverified',summary,spokenSummary:summary,uncertainty,facts:[{key:'producer_outcome',value:receipt.outcome},{key:'recorded_evidence_entries',value:receipt.evidenceIndex.length},{key:'cleanup_closed',value:receipt.cleanup.closed},{key:'unknown_effect',value:receipt.cleanup.unknownEffect}],...typedKnowledge(receipt,summary,uncertainty),producerFreeText:'withheld',receiptObservedAt:receipt.receiptObservedAt});
  if(projection.spokenSummary.length>300||Buffer.byteLength(JSON.stringify(projection))>65536)fail('REA_KNOWLEDGE_PROJECTION_LIMIT');check(scope,token);return{scope,receipt,projection};
 }
 interface Entry{commitment:string;dispatched:boolean;promise:Promise<ReaKnowledgeExportReceipt>}
 const writes=new Map<string,Entry>();
 function checkWrite(intent:ReaKnowledgeWriteIntent,scope:ReaKnowledgeReadScope,readToken:unknown,writeToken:unknown){check(scope,readToken);if(intent.expiresAt<=Date.now())fail('REA_KNOWLEDGE_WRITE_SCOPE_REVOKED');try{authority.assertWriteCurrent(intent,scope,writeToken);}catch{fail('REA_KNOWLEDGE_WRITE_SCOPE_REVOKED');}}
 function exportStatus(value:unknown,reportRef:string,exportReceiptRef:string):ReaKnowledgeExportReceipt{
  const result=row(snapshotReaJson(value)),actions=['created','appended','updated','skipped'],codes=['OBSIDIAN_DISABLED','VAULT_PATH_MISSING','VAULT_NOT_FOUND','WRITE_FAILED','INVALID_NOTE_TYPE','SECRET_DETECTED','EXPORT_SUCCESS'];
  if(typeof result.enabled!=='boolean'||typeof result.exported!=='boolean'||typeof result.redacted!=='boolean'||!actions.includes(result.action)||!codes.includes(result.errorCode)||result.exported&&(!result.enabled||result.action==='skipped'||!['EXPORT_SUCCESS','SECRET_DETECTED'].includes(result.errorCode)))fail('REA_KNOWLEDGE_WRITER_RESULT_INVALID');
  if(!result.exported&&(result.action!=='skipped'||['EXPORT_SUCCESS','SECRET_DETECTED'].includes(result.errorCode)||result.errorCode==='OBSIDIAN_DISABLED'&&result.enabled))fail('REA_KNOWLEDGE_WRITER_RESULT_INVALID');
  const status=result.exported?'exported':!result.enabled&&result.errorCode==='OBSIDIAN_DISABLED'?'disabled':result.action==='skipped'&&['VAULT_PATH_MISSING','VAULT_NOT_FOUND','INVALID_NOTE_TYPE'].includes(result.errorCode)?'skipped':'error';
  return frozen({status,code:'REA_VAULT_WRITER_REPORTED',unknownEffect:status==='error',reportRef,exportReceiptRef,writerAction:result.action,writerCode:result.errorCode,redacted:result.redacted,stored:false,persistence:'not_configured'});
 }
 return Object.freeze({
  async read(reference:string,readAuthority:unknown):Promise<ReaKnowledgeReadResult>{try{const loaded=await load(reference,readAuthority);check(loaded.scope,readAuthority);return frozen({status:'available',projection:loaded.projection});}catch(error){return frozen(readFailure(error));}},
  async export(reference:string,readAuthority:unknown,writeAuthority?:unknown):Promise<ReaKnowledgeExportReceipt>{
   if(writeAuthority===undefined)return frozen({status:'not_requested',code:'REA_EXPORT_INTENT_REQUIRED',unknownEffect:false});
   let entry:Entry|undefined;
   try{
    const loaded=await load(reference,readAuthority);if(!exporter)fail('REA_KNOWLEDGE_NOT_CONFIGURED');
    check(loaded.scope,readAuthority);const raw=await current(authority.resolveWrite(writeAuthority,loaded.scope,loaded.projection.reportRef),loaded.scope,readAuthority),intent=closed(raw,['ownerId','workspaceId','taskId','reportRef','destinationRef','intentId','expiresAt']);
    if(['ownerId','workspaceId','taskId','reportRef','destinationRef','intentId'].some(k=>!safeId(intent[k]))||intent.ownerId!==loaded.scope.ownerId||intent.workspaceId!==loaded.scope.workspaceId||intent.taskId!==loaded.scope.taskId||intent.reportRef!==loaded.projection.reportRef||!Number.isSafeInteger(intent.expiresAt)||intent.expiresAt>loaded.scope.expiresAt)fail('REA_KNOWLEDGE_WRITE_SCOPE_REVOKED');
    const grant=frozen(intent) as ReaKnowledgeWriteIntent;checkWrite(grant,loaded.scope,readAuthority,writeAuthority);
    const commitment=reaProjectionDigest({ownerId:grant.ownerId,workspaceId:grant.workspaceId,reportRef:grant.reportRef,destinationRef:grant.destinationRef,receiptDigest:reaProjectionDigest(loaded.receipt)});
    const prior=writes.get(grant.intentId);if(prior&&prior.commitment!==commitment)fail('REA_KNOWLEDGE_EXPORT_CONFLICT');entry=prior;
    if(!entry){
     if(writes.size>=256)fail('REA_KNOWLEDGE_EXPORT_LIMIT');
     const created:Entry={commitment,dispatched:false,promise:Promise.resolve().then(async()=>{
      try{
       checkWrite(grant,loaded.scope,readAuthority,writeAuthority);const destination=closed(await bounded(exporter.readDestination(grant)),['destinationRef','configured','enabled','writable','mode']);checkWrite(grant,loaded.scope,readAuthority,writeAuthority);
       if(destination.destinationRef!==grant.destinationRef||destination.configured!==true||destination.enabled!==true||destination.writable!==true||!['write_safe','read_write_safe'].includes(destination.mode))return frozen({status:'configuration_required',code:'REA_VAULT_NOT_WRITABLE',unknownEffect:false});
       created.dispatched=true;
       const response=await bounded(exporter.writeResearchNote({topic:'REA recorded result',summary:loaded.projection.knowledgeMarkdown,uncertainty:loaded.projection.uncertainty}));checkWrite(grant,loaded.scope,readAuthority,writeAuthority);
       let receipt=exportStatus(response,loaded.projection.reportRef,'rea_export_'+reaProjectionDigest({intentId:grant.intentId,commitment}).slice(0,40));
       if(persist){try{checkWrite(grant,loaded.scope,readAuthority,writeAuthority);await bounded(persist(receipt));checkWrite(grant,loaded.scope,readAuthority,writeAuthority);receipt=frozen({...receipt,stored:true,persistence:'stored'});}catch{checkWrite(grant,loaded.scope,readAuthority,writeAuthority);receipt=frozen({...receipt,stored:false,persistence:'failed'});}}
       return receipt;
      }catch(error){return frozen({status:created.dispatched?'unknown_effect':'blocked',code:error instanceof KnowledgeError?error.code:'REA_VAULT_WRITER_FAILED',unknownEffect:created.dispatched});}
     })};writes.set(grant.intentId,created);entry=created;
    }
    const response=await entry.promise;checkWrite(grant,loaded.scope,readAuthority,writeAuthority);return response;
   }catch(error){return frozen({status:entry?.dispatched?'unknown_effect':error instanceof KnowledgeError&&error.code==='REA_KNOWLEDGE_NOT_CONFIGURED'?'configuration_required':'blocked',code:error instanceof KnowledgeError?error.code:'REA_KNOWLEDGE_WRITE_SCOPE_REVOKED',unknownEffect:entry?.dispatched??false});}
  },
 });
}
