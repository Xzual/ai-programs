import {randomUUID} from 'node:crypto';
import type {EdithExecutionIdentity,EdithTask} from './core';
import {createReaIntegrationService,ReaIntegrationError,reaPlannedInputCommitment,type ReaIntegrationDependencies,type ReaCanonicalExecutionRecord,type ReaPreparedExecution} from './reaIntegrationService';
import {parseReaPlannedCall,parseReaExecutionReceipt,reaProjectionDigest,type ReaExecutionCapabilityV1,type ReaReceiptCorrelationV1,type ReaExecutionReceiptV1} from './reaIntegrationContract';
import {snapshotReaJson} from './reaContract';
import {taskService,type TaskService} from './taskService';
import {plannerService,type PlannerService} from './planner';
import {executorService,type ExecutorService,type ExecuteTaskResult} from './executor';
import {createReaRegistryExecution,type ReaReceiptLocator} from './serverRegistry';
import {createReaTaskMetricSource} from './reaTaskMetricSource';
import {getEdithPersistenceStore} from './persistence';
import {hudUtc} from './taskHudContracts';
import type {ReaAnalysisResult} from './reaAnalysisService';

const admissionPrefix='rea-admission-v1:',receiptPrefix='rea-receipt-v1:';
const opaque=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v);
type Admission={identity:EdithExecutionIdentity;ownerSessionBindingId:string;ownerId:string;workspaceId:string;serverBootId:string;
  providerTaskSessionId:string;expiresAt:number;selectionRef:string;selectionRevision:number};
type Live={admission:Admission;checkpoint:string;prepared?:ReaPreparedExecution;cap?:ReaExecutionCapabilityV1;locator?:ReaReceiptLocator;receiptCheckpoint?:string};
export interface ReaCanonicalBridgeOptions extends Omit<ReaIntegrationDependencies,'readExecutionRecord'> {
  readonly tasks?:TaskService; readonly planner?:PlannerService; readonly executor?:ExecutorService;
}

/** Private backend composition. Existing task checkpoints/logs carry correlation data, never authority. */
export function createReaCanonicalTaskBridge(options:ReaCanonicalBridgeOptions) {
  const tasks=options.tasks??taskService,planner=options.planner??plannerService,executor=options.executor??executorService;
  const now=options.now??Date.now,live=new Map<string,Live>();
  const winners=new Map<string,{fingerprint:string;taskId?:string;promise:Promise<ExecuteTaskResult>}>();
  function scope(owner:string){
    const actual=options.readOwner(owner),workspace=options.currentWorkspace();
    if(!opaque(owner)||!actual||!opaque(actual.ownerId)||!workspace)throw new ReaIntegrationError('REA_OWNER_REQUIRED',401);
    if(options.isKillSwitchActive())throw new ReaIntegrationError('REA_KILL_SWITCH_ACTIVE',423);
    return {actual,workspace};
  }
  function stored(l:Live):EdithTask {
    const a=l.admission,current=scope(a.ownerSessionBindingId),task=tasks.getTask(a.identity.taskId);
    if(!task||!task.checkpoints.includes(l.checkpoint)||task.checkpoints.filter(c=>c.startsWith(admissionPrefix)).length!==1
      ||current.actual.ownerId!==a.ownerId||current.workspace.workspaceId!==a.workspaceId||a.serverBootId!==options.serverBootId
      ||a.expiresAt<=now()||task.plan?.id!==a.identity.planId||task.plan.steps.length!==1
      ||task.plan.steps[0].id!==a.identity.stepId||task.toolsRequired.join(',')!=='rea_analysis'
      ||task.plan.steps[0].suggestedTools.join(',')!=='rea_analysis')throw new ReaIntegrationError('REA_CANONICAL_EXECUTION_MISMATCH');
    if(l.prepared&&(!task.plan.steps[0].reaCall||reaPlannedInputCommitment(task.plan.steps[0].reaCall)!==l.prepared.inputDigest))throw new ReaIntegrationError('REA_CANONICAL_PLAN_MISMATCH');
    return task;
  }
  function readExecutionRecord(identity:EdithExecutionIdentity):ReaCanonicalExecutionRecord|undefined {
    const l=live.get(identity.taskId);if(!l||reaProjectionDigest(identity)!==reaProjectionDigest(l.admission.identity))return undefined;
    const task=stored(l),a=l.admission,call=task.plan!.steps[0].reaCall;
    return {identity:a.identity,ownerSessionBindingId:a.ownerSessionBindingId,ownerId:a.ownerId,workspaceId:a.workspaceId,
      serverBootId:a.serverBootId,providerTaskSessionId:a.providerTaskSessionId,expiresAt:a.expiresAt,taskStatus:task.status,...(call?{call:parseReaPlannedCall(call)}:{})};
  }
  const integration=createReaIntegrationService({...options,readExecutionRecord});
  function readExpected(taskId:string,auditEventId:string):ReaReceiptCorrelationV1|undefined {
    const l=live.get(taskId);if(!l?.cap||!l.prepared||!l.locator||l.locator.auditEventId!==auditEventId)return undefined;
    integration.assertCapability(l.cap);const task=stored(l);
    if(!l.receiptCheckpoint||!task.checkpoints.includes(l.receiptCheckpoint)
      ||task.checkpoints.filter(c=>c.startsWith(receiptPrefix)).length!==1
      ||!task.artifacts.includes(`rea_receipt:${l.locator.toolRunId}:${auditEventId}`))throw new ReaIntegrationError('REA_RECEIPT_CORRELATION_REQUIRED');
    return Object.freeze({identity:l.admission.identity,toolRunId:l.locator.toolRunId,auditEventId,selectionRef:l.admission.selectionRef,
      selectionRevision:l.admission.selectionRevision,inputDigest:l.prepared.inputDigest});
  }
  function assertReceiptAuthority(taskId:string,auditEventId:string,metricScope?:{stepId?:string;targetRefId?:string}):void {
    const expected=readExpected(taskId,auditEventId);
    if(!expected||metricScope&&(metricScope.stepId!==expected.identity.stepId||metricScope.targetRefId!==expected.selectionRef))throw new ReaIntegrationError('REA_RECEIPT_AUTHORITY_REQUIRED',403);
  }
  function bindReceipt(cap:ReaExecutionCapabilityV1,locator:ReaReceiptLocator):void {
    integration.assertCapability(cap);const preparation=integration.readCapabilityBinding(cap),l=live.get(preparation.identity.taskId);
    if(!l||l.cap!==cap||l.prepared!==preparation||l.locator)throw new ReaIntegrationError('REA_RECEIPT_BINDING_CONFLICT');
    stored(l);
    const checkpoint=receiptPrefix+JSON.stringify({...locator,identity:l.admission.identity,selectionRef:l.admission.selectionRef,
      selectionRevision:l.admission.selectionRevision,inputDigest:preparation.inputDigest});
    tasks.addCheckpoint(l.admission.identity.taskId,checkpoint);integration.assertCapability(cap);
    tasks.addArtifact(l.admission.identity.taskId,`rea_receipt:${locator.toolRunId}:${locator.auditEventId}`);integration.assertCapability(cap);
    l.locator=Object.freeze({...locator});l.receiptCheckpoint=checkpoint;
  }
  const registry=createReaRegistryExecution({integration,bindReceipt,readExpected});
  function readCommitment(taskId:string,auditEventId:string) {
    if(!readExpected(taskId,auditEventId))return undefined;
    const locator=live.get(taskId)!.locator!;
    return {receiptDigest:locator.receiptDigest,finishedAt:locator.finishedAt,receiptObservedAt:locator.receiptObservedAt};
  }
  const metricSource=createReaTaskMetricSource({readExpected,readCommitment,assertAuthority:assertReceiptAuthority});
  tasks.registerMetricSource(metricSource);executor.bindReaProducer(registry,tasks);

  function invoke(owner:string,value:unknown):Promise<ExecuteTaskResult> {
    const copied=snapshotReaJson(value);
    if(!copied||typeof copied!=='object'||Array.isArray(copied))return Promise.reject(new ReaIntegrationError('REA_INPUT_INVALID',400));
    const obj=copied as Record<string,unknown>;
    if(Object.keys(obj).some(k=>!['requestId','selectionRef','intent'].includes(k))||!opaque(obj.requestId))return Promise.reject(new ReaIntegrationError('REA_INPUT_INVALID',400));
    const current=scope(owner),selected=integration.currentSelection(owner);
    const stopped=(reason:string,outcome:ReaAnalysisResult['outcome']='blocked'):ExecuteTaskResult=>({success:false,taskId:'',status:'BLOCKED',iterations:0,toolCalls:0,reports:[],error:reason,reaOutcome:outcome});
    if(!selected||obj.selectionRef!==undefined&&obj.selectionRef!==selected.selectionRef)return Promise.resolve(stopped('REA_SELECTION_REQUIRED'));
    const intent=obj.intent;
    if(!intent||typeof intent!=='object'||Array.isArray(intent))return Promise.reject(new ReaIntegrationError('REA_INPUT_INVALID',400));
    const raw=intent as Record<string,unknown>;
    if(Object.keys(raw).some(k=>!['profile','objective','profileOptions','featureQuery'].includes(k)))return Promise.reject(new ReaIntegrationError('REA_INPUT_INVALID',400));
    const validated=parseReaPlannedCall({toolId:'rea_analysis',args:{schemaVersion:1,selectionRef:selected.selectionRef,...raw}});
    // Mirror the original producer's pre-dispatch clarification; never allocate a task to guess a seed.
    if(['static-javascript','static-managed'].includes(validated.args.profile)&&!validated.args.featureQuery
      &&/(?:nasıl|özellik|\bhow\b|\bfeature\b|\btrace\b|\bflow\b|akış)/iu.test(validated.args.objective))return Promise.resolve(stopped('REA_FEATURE_QUERY_REQUIRED','clarification_required'));
    if(validated.args.profile==='native-binary'&&!validated.args.profileOptions?.procedure&&validated.args.profileOptions?.includeLayout!==true)return Promise.resolve(stopped('REA_SELECTOR_REQUIRED','clarification_required'));
    const preflight=integration.preflight(owner,{selectionRef:selected.selectionRef,profile:validated.args.profile});
    if(!('runtimeReady'in preflight)||!preflight.runtimeReady)return Promise.resolve(stopped(preflight.outcome==='configuration_required'?'REA_RUNTIME_NOT_QUALIFIED':'REA_SELECTION_REQUIRED',preflight.outcome==='configuration_required'?'configuration_required':'clarification_required'));
    const requestKey=owner+':'+current.workspace.workspaceId+':'+obj.requestId;
    const fingerprint=reaProjectionDigest({call:validated,selection:selected});
    const prior=winners.get(requestKey);
    if(prior){
      if(prior.fingerprint!==fingerprint)return Promise.reject(new ReaIntegrationError('REA_BINDING_CONFLICT'));
      if(prior.taskId){const l=live.get(prior.taskId);if(!l)return Promise.reject(new ReaIntegrationError('REA_REPLAY_NOT_READY'));if(l.cap)integration.assertCapability(l.cap);stored(l);}
      return prior.promise;
    }
    if(winners.size>=256)return Promise.reject(new ReaIntegrationError('REA_EXECUTION_LIMIT'));
    const winner:{fingerprint:string;taskId?:string;promise:Promise<ExecuteTaskResult>}={fingerprint,promise:Promise.resolve(stopped('REA_NOT_STARTED'))};
    winner.promise=Promise.resolve().then(async()=>{
      let task:EdithTask|undefined,l:Live|undefined;
      const guardAdmission=()=>{
        const ownerScope=scope(owner),selection=integration.currentSelection(owner);
        if(ownerScope.actual.ownerId!==current.actual.ownerId||ownerScope.workspace.workspaceId!==current.workspace.workspaceId
          ||!selection||reaProjectionDigest(selection)!==reaProjectionDigest(selected))throw new ReaIntegrationError('REA_SELECTION_CHANGED');
        const again=integration.preflight(owner,{selectionRef:selected.selectionRef,profile:validated.args.profile});
        if(!('runtimeReady'in again)||!again.runtimeReady)throw new ReaIntegrationError('REA_RUNTIME_NOT_QUALIFIED');
      };
      try {
        guardAdmission();
        task=tasks.createTask({title:'REA selected artifact analysis',objective:'Inspect the explicitly selected artifact',originalUserRequest:'Canonical selected-artifact REA request',
          normalizedIntent:'rea-bound:'+randomUUID(),toolsRequired:['rea_analysis'],permissionsRequired:['file:read','rea:analyze'],riskLevel:4});
        guardAdmission();
        const draft=planner.createReaPlan(task);guardAdmission();tasks.attachPlan(task.id,draft);guardAdmission();tasks.updateStatus(task.id,'QUEUED');guardAdmission();
        const identity=Object.freeze({taskId:task.id,planId:draft.id,stepId:draft.steps[0].id,runId:'rea_run_'+randomUUID(),attempt:1});
        const admission:Admission=Object.freeze({identity,ownerSessionBindingId:owner,ownerId:current.actual.ownerId,workspaceId:current.workspace.workspaceId,
          serverBootId:options.serverBootId,providerTaskSessionId:'rea_task_session_'+randomUUID(),expiresAt:Math.min(selected.expiresAt,now()+draft.taskTimeoutMs),
          selectionRef:selected.selectionRef,selectionRevision:selected.revision});
        const checkpoint=admissionPrefix+JSON.stringify(admission);l={admission,checkpoint};
        live.set(task.id,l);tasks.addCheckpoint(task.id,checkpoint);guardAdmission();stored(l);winner.taskId=task.id;
        const prepared=await integration.prepare(owner,selected.selectionRef,identity,raw);
        guardAdmission();stored(l);
        const plan=planner.createReaPlan(tasks.getTask(task.id)!,draft,prepared.call);tasks.attachPlan(task.id,plan);guardAdmission();stored(l);tasks.updateStatus(task.id,'QUEUED');guardAdmission();
        l.prepared=prepared;l.cap=integration.issue(prepared);integration.assertCapability(l.cap);
        const result=await executor.executeTask(task.id,{reaExecution:l.cap});
        if(result.success)integration.assertCapability(l.cap);
        return result;
      }catch(error){
        if(l?.cap)integration.revokeCapability(l.cap);
        const currentTask=task?tasks.getTask(task.id):undefined;
        if(currentTask&&!['CANCELLED','FAILED','COMPLETED'].includes(currentTask.status))tasks.updateStatus(currentTask.id,'BLOCKED','REA_CANONICAL_EXECUTION_STOPPED');
        return {success:false,taskId:task?.id??'',status:'BLOCKED',iterations:0,toolCalls:0,reports:[],...(task?{task:tasks.getTask(task.id)}:{}),error:error instanceof ReaIntegrationError?error.code:'REA_CANONICAL_EXECUTION_STOPPED'};
      }
    });
    winners.set(requestKey,winner);return winner.promise;
  }
  function readReceipt(owner:string,taskId:string,auditEventId:string):ReaExecutionReceiptV1 {
    const s=scope(owner),l=live.get(taskId);
    if(!l||l.admission.ownerSessionBindingId!==owner||l.admission.workspaceId!==s.workspace.workspaceId)throw new ReaIntegrationError('REA_RECEIPT_AUTHORITY_REQUIRED',403);
    assertReceiptAuthority(taskId,auditEventId);const expected=readExpected(taskId,auditEventId)!;
    const store=getEdithPersistenceStore(),logs=store.listToolRuns?.(256).filter(row=>row.id===expected.toolRunId)??[];
    const audits=store.readRecentAuditEvents(256).filter(row=>row.id===auditEventId);
    if(logs.length!==1||audits.length!==1)throw new ReaIntegrationError('REA_RECEIPT_NOT_COMMITTED');
    const log=logs[0],audit=audits[0];
    if(log.toolId!=='rea_analysis'||audit.taskId!==taskId||audit.toolId!=='rea_analysis'||audit.action!=='tool.execute'||audit.authorization!=='allowed'
      ||!hudUtc(audit.timestamp)||Date.parse(audit.timestamp)>Date.now()||Buffer.byteLength(log.result,'utf8')>98304)throw new ReaIntegrationError('REA_RECEIPT_NOT_COMMITTED');
    const receipt=parseReaExecutionReceipt(JSON.parse(log.result),expected);
    const commitment=readCommitment(taskId,auditEventId);
    if(!commitment||reaProjectionDigest(receipt)!==commitment.receiptDigest||receipt.finishedAt!==commitment.finishedAt
      ||receipt.receiptObservedAt!==commitment.receiptObservedAt||log.timestamp!==Date.parse(receipt.finishedAt)
      ||Date.parse(receipt.receiptObservedAt)>Date.now())throw new ReaIntegrationError('REA_RECEIPT_NOT_COMMITTED');
    const success=receipt.outcome==='completed';
    if(log.status!==(success?'success':'error')||audit.result!==(success?'success':'error')||Date.parse(audit.timestamp)<Date.parse(receipt.receiptObservedAt))throw new ReaIntegrationError('REA_RECEIPT_NOT_COMMITTED');
    assertReceiptAuthority(taskId,auditEventId);return receipt;
  }
  return Object.freeze({integration,registry,metricSource,invoke,readExecutionRecord,readExpected,readCommitment,assertReceiptAuthority,readReceipt});
}
export type ReaCanonicalTaskBridge=ReturnType<typeof createReaCanonicalTaskBridge>;
