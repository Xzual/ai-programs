import type { EdithPlanStep, EdithTask, EdithToolResult } from './core';
import { capabilityService } from './capabilityService';
import { KillSwitchActiveError, killSwitchService } from './killSwitch';
import { executeEdithTool } from './serverRegistry';
import { taskService } from './taskService';
import { interruptService } from './interruptService';
import { verificationService } from './verifier';
import { recoveryService } from './recovery';
import type {BrowserWorkflowService} from './browserWorkflowService';
import {BROWSER_TOOL_IDS,BROWSER_TOOL_POLICY} from './browserOperatorContract';
import {permissionService} from './permissionService';
import type {BrowserParentExecutionCap} from '../../server/browser/browserPrivateContract';
import {registerBrowserParentVerifier} from './verifier';
import type {NativeParentStrategySetCap,NativeWorkflowPendingV1} from '../../server/browser/browserNativePrivateContract';
import type {ReaExecutionCapabilityV1} from './reaIntegrationContract';
import {reaProjectionDigest,parseReaPlannedCall} from './reaIntegrationContract';
import type {ReaRegistryExecution} from './serverRegistry';
import type {TaskService} from './taskService';
import type {ReaAnalysisResult} from './reaAnalysisService';
export interface BrowserExecuteContext {browserExecution?:BrowserParentExecutionCap;nativeStrategies?:NativeParentStrategySetCap;onNativePending?:(ticket:NativeWorkflowPendingV1)=>void;reaExecution?:ReaExecutionCapabilityV1}

export interface ExecutionStepReport {
  stepId: string;
  status: 'COMPLETED' | 'FAILED' | 'SKIPPED';
  toolResults: EdithToolResult[];
  toolCalls: number;
  message: string;
}

export interface ExecuteTaskResult {
  success: boolean;
  taskId: string;
  status: 'COMPLETED' | 'WAITING_FOR_APPROVAL' | 'BLOCKED' | 'FAILED' | 'CANCELLED' | 'NOOP';
  iterations: number;
  toolCalls: number;
  reports: ExecutionStepReport[];
  task?: EdithTask;
  error?: string;
  reaOutcome?:ReaAnalysisResult['outcome'];
}

function toolArgsForStep(task: EdithTask, toolId: string): Record<string, unknown> {
  if (toolId === 'browser_search') return { query: task.objective };
  if (toolId === 'brave_news_search' || toolId === 'brave_web_search') return { query: task.objective, count: 5 };
  if (toolId === 'binance_market_price' || toolId === 'binance_market_24hr') {
    const pair = /\b([A-Z]{2,10}USDT)\b/i.exec(task.objective)?.[1]?.toUpperCase() ?? 'BTCUSDT';
    return { symbol: pair };
  }
  if (toolId === 'coinbase_ticker_lookup') {
    const product = /\b([A-Z]{2,10}-USD)\b/i.exec(task.objective)?.[1]?.toUpperCase() ?? 'BTC-USD';
    return { product };
  }
  if (toolId === 'binance_trade_signal_guard') return { symbol: 'BTCUSDT', timeframe: '1d' };
  if (toolId === 'binance_spot_trade_guard') return { intent: task.objective, symbol: 'BTCUSDT' };
  if (toolId === 'whatsapp_integrate_guard') return { action: 'health_check' };
  if (toolId === 'whatsapp_automation_guard') return { workflow: task.objective };
  if (toolId === 'whatsapp_observe_health') return { messageId: 'dry-run' };
  if (toolId === 'computer_use_guard') return { instruction: task.objective };
  return {};
}

function dependenciesComplete(task: EdithTask, step: EdithPlanStep): boolean {
  if (!task.plan) return false;
  const byId = new Map(task.plan.steps.map((candidate) => [candidate.id, candidate]));
  return step.dependsOn.every((dependency) => {
    const dependencyStep = byId.get(dependency);
    return dependencyStep?.status === 'COMPLETED' || dependencyStep?.status === 'SKIPPED';
  });
}

export class ExecutorService {
  private reaProducer?:ReaRegistryExecution;
  private reaTasks:TaskService=taskService;
  bindReaProducer(producer:ReaRegistryExecution,tasks:TaskService=taskService):void {
    if(this.reaProducer&&this.reaProducer!==producer)throw Error('REA_PRODUCER_ALREADY_CONFIGURED');
    this.reaProducer=producer;this.reaTasks=tasks;
  }
  private browserProducer?:BrowserWorkflowService;
  /** Reviewed backend wiring only; no new capability or caller-owned registration data. */
  bindBrowserProducer(producer:BrowserWorkflowService):void {
    if(this.browserProducer&&this.browserProducer!==producer)throw Error('BROWSER_PRODUCER_ALREADY_CONFIGURED');
    this.browserProducer=producer;registerBrowserParentVerifier(producer);
  }
  async executeTask(taskId: string, context: BrowserExecuteContext = {}): Promise<ExecuteTaskResult> {
    let task = taskService.getTask(taskId);
    if (!task) return { success: false, taskId, status: 'FAILED', iterations: 0, toolCalls: 0, reports: [], error: 'Task not found.' };
    if(context.reaExecution||task.toolsRequired.includes('rea_analysis')||task.plan?.steps.some(step=>step.reaCall||step.suggestedTools.includes('rea_analysis')))return this.executeRea(taskId,context.reaExecution);
    if(context.browserExecution||task.toolsRequired.some(tool=>(BROWSER_TOOL_IDS as readonly string[]).includes(tool))||task.plan?.steps.some(step=>step.suggestedTools.some(tool=>(BROWSER_TOOL_IDS as readonly string[]).includes(tool))))return this.executeBrowserParent(task,context.browserExecution,context);
    if (!task.plan || task.plan.status !== 'READY') {
      return { success: false, taskId, status: 'NOOP', iterations: 0, toolCalls: 0, reports: [], task, error: 'Task has no READY plan.' };
    }

    try {
      killSwitchService.assertAllowed('tool_execution', 'edith-executor');
    } catch (error) {
      if (!(error instanceof KillSwitchActiveError)) throw error;
      const paused = taskService.updateStatus(taskId, 'BLOCKED', error.message);
      return {
        success: false,
        taskId,
        status: 'BLOCKED',
        iterations: 0,
        toolCalls: 0,
        reports: [],
        task: paused ?? task,
        error: error.message,
      };
    }

    taskService.updateStatus(taskId, 'RUNNING');
    taskService.recordActivity({
      taskId,
      agentId: 'executor',
      role: 'executor',
      status: 'RUNNING',
      message: 'Executor started planned task execution.',
      tools: task.toolsRequired,
    });
    task = taskService.getTask(taskId) ?? task;

    const reports: ExecutionStepReport[] = [];
    let iterations = 0;
    let toolCalls = 0;
    const startedAt = Date.now();

    while (iterations < task.plan.maxIterations && toolCalls < task.plan.maxToolCalls) {
      iterations += 1;
      const interrupt = interruptService.current(taskId);
      if (interrupt) {
        const cancelled = taskService.updateStatus(taskId, 'CANCELLED', interrupt.reason);
        return {
          success: false,
          taskId,
          status: 'CANCELLED',
          iterations,
          toolCalls,
          reports,
          task: cancelled ?? task,
          error: interrupt.reason,
        };
      }
      if (Date.now() - startedAt > task.plan.taskTimeoutMs) {
        const failed = taskService.updateStatus(taskId, 'BLOCKED', 'Execution timed out before verification.');
        recoveryService.recoverTask(taskId);
        return { success: false, taskId, status: 'BLOCKED', iterations, toolCalls, reports, task: taskService.getTask(taskId) ?? failed, error: 'Execution timed out.' };
      }

      const nextStep = task.plan.steps.find((step) =>
        (step.status === 'READY' || step.status === 'PENDING') && dependenciesComplete(task, step)
      );
      if (!nextStep) break;

      const report = await this.executeStep(task, nextStep, task.plan.maxToolCalls - toolCalls);
      reports.push(report);
      toolCalls += report.toolCalls;

      task = taskService.getTask(taskId) ?? task;
      if (report.status === 'FAILED') {
        const denied = report.toolResults.some((result) => result.errorCode === 'PERMISSION_DENIED');
        const status = denied ? 'WAITING_FOR_APPROVAL' : 'FAILED';
        const failed = taskService.updateStatus(taskId, status, report.message);
        taskService.recordActivity({
          taskId,
          agentId: 'executor',
          role: 'executor',
          status: denied ? 'WAITING_FOR_APPROVAL' : 'FAILED',
          message: report.message,
          tools: stepToolIds(report),
        });
        if (!denied) recoveryService.recoverTask(taskId);
        return {
          success: false,
          taskId,
          status,
          iterations,
          toolCalls,
          reports,
          task: failed,
          error: report.message,
        };
      }
    }

    task = taskService.getTask(taskId) ?? task;
    const allStepsTerminal = task.plan.steps.every((step) =>
      step.status === 'COMPLETED' || step.status === 'SKIPPED'
    );
    if (!allStepsTerminal) {
      const paused = taskService.updateStatus(taskId, 'BLOCKED', 'Execution budget exhausted before all steps completed.');
      recoveryService.recoverTask(taskId);
      return {
        success: false,
        taskId,
        status: 'BLOCKED',
        iterations,
        toolCalls,
        reports,
        task: paused,
        error: 'Execution budget exhausted before all steps completed.',
      };
    }

    taskService.addCheckpoint(taskId, `Executor reached verification boundary at ${new Date().toISOString()}`);
    taskService.recordActivity({
      taskId,
      agentId: 'verifier',
      role: 'verifier',
      status: 'RUNNING',
      message: 'Verifier started after executor completed planned steps.',
      planningOnly: false,
    });
    const verified = verificationService.verifyTask(taskId);
    const finalTask = taskService.getTask(taskId) ?? verified.task;
    if (!verified.success) {
      const recovered = recoveryService.recoverTask(taskId);
      taskService.recordActivity({
        taskId,
        agentId: 'verifier',
        role: 'verifier',
        status: 'FAILED',
        message: verified.error ?? 'Verification did not pass.',
      });
      return {
        success: false,
        taskId,
        status: recovered.task?.status === 'WAITING_FOR_APPROVAL' ? 'WAITING_FOR_APPROVAL' : 'BLOCKED',
        iterations,
        toolCalls,
        reports,
        task: recovered.task ?? finalTask,
        error: verified.error,
      };
    }
    taskService.recordActivity({
      taskId,
      agentId: 'executor',
      role: 'executor',
      status: 'COMPLETED',
      message: 'Executor completed and verifier passed.',
      tools: task.toolsRequired,
    });
    taskService.recordActivity({
      taskId,
      agentId: 'verifier',
      role: 'verifier',
      status: 'COMPLETED',
      message: verified.verification?.summary ?? 'Verification passed.',
    });
    return {
      success: true,
      taskId,
      status: 'COMPLETED',
      iterations,
      toolCalls,
      reports,
      task: taskService.getTask(taskId) ?? finalTask,
    };
  }

  private async executeRea(taskId:string,cap:ReaExecutionCapabilityV1|undefined):Promise<ExecuteTaskResult> {
    const tasks=this.reaTasks,producer=this.reaProducer,reports:ExecutionStepReport[]=[];
    let toolCalls=0,timer:ReturnType<typeof setTimeout>|undefined,timedOut=false,admitted=false;
    const stopped=(error:string):ExecuteTaskResult=>({success:false,taskId,status:tasks.getTask(taskId)?.status==='CANCELLED'?'CANCELLED':'BLOCKED',iterations:0,toolCalls,reports,task:tasks.getTask(taskId),error,reaOutcome:toolCalls?'unknown_effect':'blocked'});
    if(!producer||!cap)return stopped('REA_CAPABILITY_REQUIRED');
    const guard=()=>{
      producer.assertCurrent(cap);killSwitchService.assertAllowed('tool_execution','rea-executor');
      const task=tasks.getTask(taskId),identity=cap.identity,plan=task?.plan,step=plan?.steps[0];
      if(timedOut||interruptService.current(taskId)||!task||identity.taskId!==taskId||plan?.id!==identity.planId||plan.status!=='READY'
        ||plan.steps.length!==1||step?.id!==identity.stepId||!step.reaCall||plan.requiredTools.join(',')!=='rea_analysis'
        ||reaProjectionDigest(parseReaPlannedCall(step.reaCall))!==reaProjectionDigest(cap.call))throw Error('REA_CANONICAL_EXECUTION_STOPPED');
      return task;
    };
    try{
      const task=guard(),stepId=cap.identity.stepId;admitted=true;
      if(['COMPLETED','FAILED','CANCELLED','BLOCKED'].includes(task.status))return stopped('REA_EXECUTION_TERMINAL');
      timer=setTimeout(()=>{timedOut=true;producer.revoke(cap);},task.plan!.taskTimeoutMs);timer.unref();
      guard();tasks.updateStatus(taskId,'RUNNING');guard();
      tasks.updatePlanStepStatus(taskId,stepId,'RUNNING');guard();
      toolCalls=1;
      const issued=await producer.execute(cap);guard();
      const receipt=issued.receipt,completed=receipt.outcome==='completed'&&receipt.cleanup.closed&&!receipt.cleanup.unknownEffect;
      if(receipt.observedMetrics){guard();tasks.recordToolObservation(taskId,receipt.auditEventId);guard();}
      tasks.recordTimeline({taskId,type:'tool',actor:'rea-executor',toolId:'rea_analysis',auditEventId:receipt.auditEventId,message:'Canonical REA receipt persisted.'});guard();
      tasks.updatePlanStepStatus(taskId,stepId,completed?'COMPLETED':'FAILED');guard();
      const checkStatus=completed?'PASS':'PARTIAL';
      tasks.recordVerification(taskId,{id:'rea_verification_'+receipt.auditEventId,taskId,verifier:'heuristic-v1',status:checkStatus,
        checkedAt:new Date().toISOString(),summary:'REA outcome: '+receipt.outcome+'; '+receipt.reasonCode,checks:[{id:'rea_receipt',label:'Canonical REA outcome and cleanup',status:checkStatus,
          evidence:'rea_receipt:'+receipt.toolRunId+':'+receipt.auditEventId,required:true}],retryable:false});guard();
      reports.push({stepId,status:completed?'COMPLETED':'FAILED',toolResults:[issued.toolResult],toolCalls:1,message:'REA outcome: '+receipt.outcome});
      return {success:completed,taskId,status:completed?'COMPLETED':'BLOCKED',iterations:1,toolCalls,reports,task:tasks.getTask(taskId),reaOutcome:receipt.outcome};
    }catch{
      if(!admitted)return stopped('REA_CAPABILITY_REQUIRED');
      if(admitted)producer.revoke(cap);
      const current=tasks.getTask(taskId);
      if(current&&!['COMPLETED','CANCELLED','FAILED','BLOCKED'].includes(current.status))tasks.updateStatus(taskId,'BLOCKED','REA_EXECUTION_STOPPED');
      return stopped(timedOut?'REA_TIMEOUT_UNKNOWN_EFFECT':'REA_EXECUTION_STOPPED');
    }finally{if(timer)clearTimeout(timer);}
  }

  private async executeBrowserParent(original:EdithTask, execution:BrowserParentExecutionCap|undefined,context:BrowserExecuteContext={}):Promise<ExecuteTaskResult> {
    const taskId=original.id,reports:ExecutionStepReport[]=[];
    let iterations=0,toolCalls=0;
    const stopped=(error:string):ExecuteTaskResult=>{const task=taskService.getTask(taskId);return {success:false,taskId,status:task?.status==='CANCELLED'?'CANCELLED':task?.status==='FAILED'?'FAILED':task?.status==='WAITING_FOR_APPROVAL'?'WAITING_FOR_APPROVAL':'BLOCKED',iterations,toolCalls,reports,task,error};};
    if(!execution||execution.taskId!==taskId||execution.planId!==original.plan?.id)return stopped('BROWSER_PARENT_EXECUTION_REQUIRED');
    const browserWorkflowService=this.browserProducer;
    if(!browserWorkflowService)return stopped('BROWSER_PARENT_PRODUCER_REQUIRED');
    const startedAt=Date.now(),plan=original.plan!;
    const guard=(phase:'before-running'|'running'='running')=>{
      browserWorkflowService.assertParentExecution(execution,phase);
      const current=taskService.getTask(taskId);
      if(!current||current.plan?.id!==plan.id||interruptService.current(taskId)||iterations>plan.maxIterations||toolCalls>plan.maxToolCalls||Date.now()-startedAt>plan.taskTimeoutMs)throw Error('BROWSER_PARENT_EXECUTION_STOPPED');
      return current;
    };
    try{
      guard('before-running');
      for(const step of plan.steps)if(step.suggestedTools.some(tool=>(BROWSER_TOOL_IDS as readonly string[]).includes(tool)))browserWorkflowService.associatePlannedSearch(execution,step.id);
      guard('before-running');taskService.updateStatus(taskId,'RUNNING');guard();
      taskService.recordActivity({taskId,agentId:'executor',role:'executor',status:'RUNNING',message:'Executor started original browser parent execution.',tools:original.toolsRequired});guard();
      while(true){
        const current=guard();
        if(current.plan!.steps.every(step=>step.status==='COMPLETED'||step.status==='SKIPPED'))break;
        if(iterations>=plan.maxIterations)throw Error('BROWSER_PARENT_ITERATION_BUDGET');
        const step=current.plan!.steps.find(candidate=>(candidate.status==='READY'||candidate.status==='PENDING')&&candidate.dependsOn.every(id=>current.plan!.steps.find(item=>item.id===id)?.status==='COMPLETED'));
        if(!step)throw Error('BROWSER_PARENT_DEPENDENCY_INCOMPLETE');
        if(toolCalls+step.suggestedTools.length>plan.maxToolCalls)throw Error('BROWSER_PARENT_TOOL_BUDGET');
        iterations++;
        const browser=step.suggestedTools.filter(tool=>(BROWSER_TOOL_IDS as readonly string[]).includes(tool));
        const denied=step.suggestedTools.some(tool=>!capabilityService.assessTool(tool,(BROWSER_TOOL_IDS as readonly string[]).includes(tool)?'owner':'edith-executor')?.runnable);
        const extra=step.requiredPermissions.filter(permission=>!browser.length||!(BROWSER_TOOL_POLICY.requiredPermissions as readonly string[]).includes(permission));
        if(denied||extra.some(permission=>!permissionService.defaultAuthorizedPermissions().includes(permission)))throw Error('BROWSER_PARENT_STEP_PERMISSION_DENIED');
        guard();taskService.updatePlanStepStatus(taskId,step.id,'RUNNING');guard();
        const results:EdithToolResult[]=[];let calls=0;
        for(const toolId of step.suggestedTools){
          guard();
          let result:EdithToolResult;
          if((BROWSER_TOOL_IDS as readonly string[]).includes(toolId)){
            const source=browserWorkflowService.resolveParentStep(execution,step.id);
            let issued;
            if(context.nativeStrategies){
              const attempt=browserWorkflowService.openNativeParentStep(execution,source);
              const waiter=browserWorkflowService.startNativeParentLeaf(attempt);
              context.onNativePending?.(browserWorkflowService.readNativeAttemptTicket(attempt));
              issued=await waiter;
            }else issued=await browserWorkflowService.executeParentDom(source);
            toolCalls++;calls++;guard();
            result={success:issued.success&&issued.outcome==='verified'&&Boolean(issued.evidence),toolId,auditEventId:issued.auditEventId,
              ...(issued.success?{result:context.nativeStrategies?'Original native ledger and independent planned predicate verified.':'Original finite planned search predicate verified; native physical proof is absent.'}:{errorCode:'TOOL_ERROR' as const,error:issued.reasonCode??'BROWSER_PARENT_PARTIAL'}),structuredOutput:{browser:issued.receipt,taskId,scope:'parent-step'}};
          }else{
            result=await executeEdithTool(toolId,toolArgsForStep(current,toolId),{actor:'edith-executor',taskId});
            toolCalls++;calls++;guard();
          }
          results.push(result);
          taskService.addObservation(taskId,`Executor tool ${toolId} ${result.success?'succeeded':'failed'} for ${step.id}: ${(result.error??result.result??'').slice(0,500)}`);guard();
          taskService.recordTimeline({taskId,type:'tool',actor:'edith-executor',toolId,riskLevel:step.riskLevel,message:`Tool ${toolId} ${result.success?'succeeded':'failed'} for ${step.id}.`,auditEventId:result.auditEventId,metadata:{errorCode:result.errorCode,durationMs:result.durationMs}});guard();
          if(!result.success){
            reports.push({stepId:step.id,status:'FAILED',toolResults:results,toolCalls:calls,message:'Original planned tool did not verify.'});
            taskService.updatePlanStepStatus(taskId,step.id,'FAILED');
            browserWorkflowService.revokeParentExecution(taskId,'unknown_effect');return stopped('BROWSER_PARENT_TOOL_NOT_VERIFIED');
          }
        }
        guard();taskService.updatePlanStepStatus(taskId,step.id,'COMPLETED',`Step ${step.id} completed.`);guard();
        reports.push({stepId:step.id,status:'COMPLETED',toolResults:results,toolCalls:calls,message:'Original planned step completed.'});
      }
      guard();taskService.addCheckpoint(taskId,`Executor reached verification boundary at ${new Date().toISOString()}`);guard();
      const verified=verificationService.verifyTask(taskId,context.nativeStrategies?{nativeBrowserExecution:execution}:{}),persisted=taskService.getTask(taskId);
      if(!verified.success||persisted?.status!=='COMPLETED'||persisted.verification?.status!=='PASS')return stopped(verified.error??'BROWSER_PARENT_VERIFICATION_REQUIRED');
      return {success:true,taskId,status:'COMPLETED',iterations,toolCalls,reports,task:persisted};
    }catch{
      browserWorkflowService.revokeParentExecution(taskId,'task_stopped');
      return stopped('BROWSER_PARENT_EXECUTION_STOPPED');
    }
  }

  private async executeStep(
    task: EdithTask,
    step: EdithPlanStep,
    remainingToolBudget: number
  ): Promise<ExecutionStepReport> {
    taskService.updatePlanStepStatus(task.id, step.id, 'RUNNING');

    if (step.suggestedTools.length === 0) {
      taskService.updatePlanStepStatus(
        task.id,
        step.id,
        'COMPLETED',
        `Step ${step.id} completed without tools: ${step.title}`
      );
      return {
        stepId: step.id,
        status: 'COMPLETED',
        toolResults: [],
        toolCalls: 0,
        message: `Step completed without tools: ${step.title}`,
      };
    }

    const capabilityAssessment = capabilityService.assess({
      objective: `${task.objective} ${step.objective}`,
      actor: 'edith-executor',
      toolsRequired: step.suggestedTools,
      permissionsRequired: step.requiredPermissions,
      riskLevel: step.riskLevel,
    });
    taskService.addObservation(task.id, `Executor preflight ${capabilityAssessment.status} for ${step.id}: ${capabilityAssessment.summary}`);
    if (capabilityAssessment.status === 'WAITING_PERMISSION') {
      const missing = capabilityAssessment.missingPermissions.join(', ');
      taskService.updatePlanStepStatus(task.id, step.id, 'FAILED', `Step ${step.id} is waiting for permissions: ${missing}.`);
      return {
        stepId: step.id,
        status: 'FAILED',
        toolResults: [{
          success: false,
          toolId: capabilityAssessment.blockedTools[0] ?? step.suggestedTools[0] ?? 'capability_preflight',
          error: `Capability preflight denied execution before tool call. Missing permissions: ${missing}.`,
          errorCode: 'PERMISSION_DENIED',
          structuredOutput: { capabilityAssessment },
        }],
        toolCalls: 0,
        message: `Capability preflight is waiting for permissions: ${missing}.`,
      };
    }

    const toolResults: EdithToolResult[] = [];
    let toolCalls = 0;
    for (const toolId of step.suggestedTools.slice(0, remainingToolBudget)) {
      const interrupt = interruptService.current(task.id);
      if (interrupt) {
        taskService.updatePlanStepStatus(task.id, step.id, 'FAILED', `Step ${step.id} interrupted: ${interrupt.reason}`);
        return {
          stepId: step.id,
          status: 'FAILED',
          toolResults,
          toolCalls,
          message: interrupt.reason,
        };
      }
      const result = await executeEdithTool(toolId, toolArgsForStep(task, toolId), {
        actor: 'edith-executor',
        taskId: task.id,
      });
      toolCalls += 1;
      toolResults.push(result);
      taskService.addObservation(
        task.id,
        `Executor tool ${toolId} ${result.success ? 'succeeded' : 'failed'} for ${step.id}: ${(result.error ?? result.result ?? '').slice(0, 500)}`
      );
      taskService.recordTimeline({
        taskId: task.id,
        type: 'tool',
        actor: 'edith-executor',
        toolId,
        riskLevel: step.riskLevel,
        message: `Tool ${toolId} ${result.success ? 'succeeded' : 'failed'} for ${step.id}.`,
        auditEventId: result.auditEventId,
        metadata: { errorCode: result.errorCode, durationMs: result.durationMs },
      });
      if (!result.success) {
        taskService.updatePlanStepStatus(task.id, step.id, 'FAILED', `Step ${step.id} failed on tool ${toolId}.`);
        return {
          stepId: step.id,
          status: 'FAILED',
          toolResults,
          toolCalls,
          message: result.error ?? `Tool failed: ${toolId}`,
        };
      }
    }

    taskService.updatePlanStepStatus(task.id, step.id, 'COMPLETED', `Step ${step.id} completed.`);
    return {
      stepId: step.id,
      status: 'COMPLETED',
      toolResults,
      toolCalls,
      message: `Step completed: ${step.title}`,
    };
  }
}

export const executorService = new ExecutorService();

function stepToolIds(report: ExecutionStepReport): string[] {
  return Array.from(new Set(report.toolResults.map((result) => result.toolId)));
}
