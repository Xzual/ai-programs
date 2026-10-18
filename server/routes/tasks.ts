import {getTaskContinuationAdapter} from '../../src/edith/taskContinuationAdapter';
import {workspaceManager} from '../../src/edith/workspaceManager';
import {hudSafeId,withoutTaskObservedMetrics,type TaskHudScopeV1} from '../../src/edith/taskHudContracts';
import { Router, type RequestHandler } from "express";
import { requireProtectedMutation,getOwnerSession } from "../security/ownerSession";
import {
  EDITH_CONTRACT,
  deriveTaskProgress,
  normalizeLegacyTask,
  parseTaskStatus,
  projectTaskEventsV2,
} from "../../src/edith/contracts";
import type { EdithTask } from "../../src/edith/core";
import { KillSwitchActiveError } from "../../src/edith/killSwitch";
import { obsidianVaultService } from "../../src/edith/obsidianVaultService";
import { executorService } from "../../src/edith/executor";
import { plannerService } from "../../src/edith/planner";
import { recoveryService } from "../../src/edith/recovery";
import { taskQueueService } from "../../src/edith/taskQueueService";
import { taskService } from "../../src/edith/taskService";
import { createStoredTask, listTasks, updateTaskStatus } from "../../src/edith/taskStore";
import { verificationService } from "../../src/edith/verifier";
import {isNativeBoundTask} from '../../src/edith/taskService';
import {getNativeTaskBinding} from '../computer/nativeTaskBinding';
import {registerGenericTaskPublisher} from '../../src/edith/taskService';
import {getMobileRuntime} from '../mobile/runtime';
import {browserWorkflowService} from '../../src/edith/browserWorkflowService';
import {BROWSER_TOOL_IDS} from '../../src/edith/browserOperatorContract';
import {browserNativeAuthority} from '../browser/browserNativeAuthority';
import {configureNativeBrowserBackend} from './browserWorkflows';
import type {BrowserParentExecutionCap} from '../browser/browserPrivateContract';
import type {ExecuteTaskResult} from '../../src/edith/executor';
import type {NativeWorkflowPendingV1} from '../browser/browserNativePrivateContract';

function plannedBrowserTask(task:EdithTask|undefined):boolean {
  return Boolean(task&&(task.toolsRequired.some(tool=>(BROWSER_TOOL_IDS as readonly string[]).includes(tool))||task.plan?.steps.some(step=>step.suggestedTools.some(tool=>(BROWSER_TOOL_IDS as readonly string[]).includes(tool)))));
}

function taskView(task: EdithTask) {
  const normalized = normalizeLegacyTask(task) as EdithTask;
  return { ...normalized, progress: deriveTaskProgress(normalized) };
}

export function createTasksRouter(options: { protectedMutation?: RequestHandler[]; hudRead?: {
    workspaceId:()=>string|undefined;
    assertTaskRead:(taskId:string,ownerBindingId:string,workspaceId:string)=>void;
  } } = {}): Router {
  const router = Router();
  const protectedMutation = options.protectedMutation ?? requireProtectedMutation;
  const hudRead=options.hudRead??{workspaceId:()=>workspaceManager.getConfig()?.workspaceId,assertTaskRead:(id:string,owner:string,workspace:string)=>getTaskContinuationAdapter().assertHudRead(id,owner,workspace)};
  // Legacy and mutation responses include duplicate raw task/event representations.
  router.use('/api/edith/tasks',(_req,res,next)=>{
    const json=res.json.bind(res);
    res.json=(body:unknown)=>json(res.locals.taskHudScope?body:withoutTaskObservedMetrics(body));
    next();
  });
  const hudScope=(req:Parameters<typeof getOwnerSession>[0],res:import('express').Response):{owner:string;scope:TaskHudScopeV1}|undefined=>{
    if(req.query.view!=='hud-v1')return undefined;
    res.setHeader('Cache-Control','no-store');
    const owner=getOwnerSession(req);
    if(!owner)throw new Error('OWNER_SESSION_REQUIRED');
    const workspaceId=hudRead.workspaceId();
    if(!hudSafeId(workspaceId))throw new Error('TASK_HUD_BINDING_REQUIRED');
    return {owner:owner.bindingId,scope:{schemaVersion:1,view:'hud-v1',workspaceId}};
  };
  const hudError=(res:import('express').Response,error:unknown)=>{
    const code=error instanceof Error?error.message:'TASK_HUD_FORBIDDEN';
    return res.status(code==='OWNER_SESSION_REQUIRED'?401:403).json({success:false,errorCode:['OWNER_SESSION_REQUIRED','TASK_HUD_BINDING_REQUIRED','TASK_HUD_FORBIDDEN'].includes(code)?code:'TASK_HUD_FORBIDDEN'});
  };
  executorService.bindBrowserProducer(browserWorkflowService);
  configureNativeBrowserBackend();
  // Retain only this original execution's waiter and authenticated request session;
  // the producer remains the sole owner/evidence issuer and rechecks current policy.
  const nativeWaiters=new Map<string,{execution:BrowserParentExecutionCap;bindingId:string;work:Promise<ExecuteTaskResult>;pending:Promise<NativeWorkflowPendingV1>;result?:ExecuteTaskResult}>();
  registerGenericTaskPublisher(event => getMobileRuntime().realtime.publishPersistedTaskEvent(event));
  getNativeTaskBinding().recover();
  router.use('/api/edith/tasks/:id',(req,res,next)=>{
    if(req.method!=='GET'&&isNativeBoundTask(taskService.getTask(req.params.id))){
      const owner=getOwnerSession(req);if(!owner)return res.status(401).json({success:false,errorCode:'OWNER_SESSION_REQUIRED'});
      try{getNativeTaskBinding().assertTaskOwner(req.params.id,owner.bindingId);}catch{return res.status(403).json({success:false,errorCode:'NATIVE_TASK_OWNER_REQUIRED'});}
      if(!['/cancel','/pause','/verify'].includes(req.path))return res.status(409).json({success:false,errorCode:'NATIVE_TASK_AUTHORITY_REQUIRED'});
    }
    next();
  });

  router.get("/api/edith/tasks", (req, res) => {
    let scoped:ReturnType<typeof hudScope>;
    try{scoped=hudScope(req,res);}catch(error){return hudError(res,error);}
    const tasks = listTasks().filter(task=>{
      if(!scoped)return true;
      try{hudRead.assertTaskRead(task.id,scoped.owner,scoped.scope.workspaceId);return true;}catch{return false;}
    }).map(taskView);
    if(scoped)res.locals.taskHudScope=scoped.scope;
    res.json({
      success: true,
      tasks,
      contract: EDITH_CONTRACT,
      data: { tasks },
      ...(scoped?{hud:scoped.scope}:{}),
    });
  });

  router.get("/api/edith/tasks/queue", (_req, res) => {
    res.json({ success: true, queue: taskQueueService.snapshot(), next: taskQueueService.next() });
  });

  router.get("/api/edith/tasks/:id/activity", (req, res) => {
    let scoped:ReturnType<typeof hudScope>;
    try{scoped=hudScope(req,res);if(scoped)hudRead.assertTaskRead(req.params.id,scoped.owner,scoped.scope.workspaceId);}catch(error){return hudError(res,error);}
    if(scoped)res.locals.taskHudScope=scoped.scope;
    const task = taskService.getTask(req.params.id);
    if (!task) return res.status(404).json({ success: false, error: "Task not found." });
    const normalized = normalizeLegacyTask(task) as EdithTask;
    const progress = deriveTaskProgress(normalized);
    const projection = projectTaskEventsV2(normalized);
    const events = projection.events;
    res.json({
      success: true,
      ...(scoped?{hud:scoped.scope}:{}),
      taskId: normalized.id,
      status: normalized.status,
      timeline: normalized.timeline ?? [],
      agentActivity: normalized.agentActivity ?? [],
      recoveryEvents: normalized.recoveryEvents ?? [],
      verification: normalized.verification,
      revision: normalized.revision,
      eventSequence: normalized.eventSequence,
      progress,
      events,
      eventDiagnostics: projection.diagnostics,
      contract: EDITH_CONTRACT,
      data: { task: normalized, progress, events, eventDiagnostics: projection.diagnostics },
    });
  });

  router.post("/api/edith/tasks", ...protectedMutation, (req, res) => {
    const {
      title = "EDITH Task",
      objective,
      originalUserRequest,
      toolsRequired = [],
      permissionsRequired = [],
      riskLevel = 1,
    } = req.body ?? {};
    if (!objective || !originalUserRequest) {
      return res.status(400).json({ success: false, error: "objective and originalUserRequest are required." });
    }
    try {
      const task = createStoredTask({
        title,
        objective,
        originalUserRequest,
        toolsRequired,
        permissionsRequired,
        riskLevel,
      });
      obsidianVaultService.writeTaskNoteResult(task);
      res.json({ success: true, task });
    } catch (error) {
      if (error instanceof KillSwitchActiveError) {
        return res.status(423).json({ success: false, error: error.message, killSwitch: error.state });
      }
      throw error;
    }
  });

  router.patch("/api/edith/tasks/:id/status", ...protectedMutation, (req, res) => {
    const parsedStatus = parseTaskStatus(req.body?.status);
    if (parsedStatus.success === false) {
      return res.status(400).json({ success: false, errorCode: parsedStatus.errorCode, error: parsedStatus.message });
    }
    const task = updateTaskStatus(req.params.id, parsedStatus.value, req.body?.result);
    if (!task) return res.status(404).json({ success: false, error: "Task not found." });
    obsidianVaultService.writeTaskNoteResult(task);
    res.json({ success: true, task });
  });

  router.post("/api/edith/tasks/:id/queue", ...protectedMutation, (req, res) => {
    const queued = taskQueueService.enqueue(req.params.id);
    if (!queued) return res.status(404).json({ success: false, error: "Task not found." });
    res.json({ success: true, task: queued });
  });

  router.post("/api/edith/tasks/:id/pause", ...protectedMutation, (req, res) => {
    const task = taskQueueService.pause(req.params.id, String(req.body?.reason ?? "Task paused."));
    if (!task) return res.status(404).json({ success: false, error: "Task not found." });
    res.json({ success: true, task });
  });

  router.post("/api/edith/tasks/:id/resume", ...protectedMutation, (req, res) => {
    const task = taskQueueService.resume(req.params.id);
    if (!task) return res.status(404).json({ success: false, error: "Task not found." });
    res.json({ success: true, task });
  });

  router.post("/api/edith/tasks/:id/cancel", ...protectedMutation, (req, res) => {
    const task = taskQueueService.cancel(req.params.id, String(req.body?.reason ?? "Task cancelled by user."), "edith-api");
    if (!task) return res.status(404).json({ success: false, error: "Task not found." });
    res.json({ success: true, task });
  });

  router.post("/api/edith/tasks/:id/observations", ...protectedMutation, (req, res) => {
    const observation = String(req.body?.observation ?? "").trim();
    if (!observation) return res.status(400).json({ success: false, error: "observation is required." });
    const task = taskService.addObservation(req.params.id, observation);
    if (!task) return res.status(404).json({ success: false, error: "Task not found." });
    res.json({ success: true, task });
  });

  router.post("/api/edith/tasks/:id/checkpoints", ...protectedMutation, (req, res) => {
    const checkpoint = String(req.body?.checkpoint ?? "").trim();
    if (!checkpoint) return res.status(400).json({ success: false, error: "checkpoint is required." });
    const task = taskService.addCheckpoint(req.params.id, checkpoint);
    if (!task) return res.status(404).json({ success: false, error: "Task not found." });
    res.json({ success: true, task });
  });

  router.post("/api/edith/tasks/:id/artifacts", ...protectedMutation, (req, res) => {
    const artifact = String(req.body?.artifact ?? "").trim();
    if (!artifact) return res.status(400).json({ success: false, error: "artifact is required." });
    const task = taskService.addArtifact(req.params.id, artifact);
    if (!task) return res.status(404).json({ success: false, error: "Task not found." });
    res.json({ success: true, task });
  });

  router.post("/api/edith/tasks/:id/plan", ...protectedMutation, (req, res) => {
    const current=taskService.getTask(req.params.id);
    if(plannedBrowserTask(current)){
      browserWorkflowService.revokeParentExecution(req.params.id,'plan_changed');
      if(!['QUEUED','PLANNING'].includes(current!.status))return res.status(409).json({success:false,errorCode:'BROWSER_PARENT_REPLAN_DENIED'});
    }
    const result = plannerService.planTask(req.params.id);
    if (!result.success) {
      return res.status(404).json({ success: false, error: result.error ?? "Task not found." });
    }
    res.json({ success: true, plan: result.plan, task: result.task });
  });

  router.post("/api/edith/tasks/:id/execute", ...protectedMutation, async (req, res) => {
    let result;
    if(plannedBrowserTask(taskService.getTask(req.params.id))){
      try{
        const existing=nativeWaiters.get(req.params.id);
        if(existing){
          if(getOwnerSession(req)?.bindingId!==existing.bindingId)return res.status(403).json({success:false,errorCode:'OWNER_SESSION_REQUIRED'});
          browserWorkflowService.captureOwner(req);
          if(existing.result){
            if(existing.result.success)browserWorkflowService.readNativeParentContinuation(existing.execution);
            return res.status(existing.result.success?200:400).set('Cache-Control','no-store').json(existing.result);
          }
          const continuation=browserWorkflowService.readNativeParentContinuation(existing.execution);
          return res.status('pending' in continuation?202:200).set('Cache-Control','no-store').json(continuation);
        }
        const owner=browserWorkflowService.captureOwner(req);
        const browserExecution=browserWorkflowService.openParentExecution(owner,req.params.id);
        if(browserNativeAuthority.currentBoot()&&browserNativeAuthority.supportsStrategy('search')){
          if(nativeWaiters.size>=256)throw Error('NATIVE_PARENT_CAPACITY');
          const nativeStrategies=browserWorkflowService.freezeNativeParentStrategies(browserExecution);
          let notify!:(ticket:NativeWorkflowPendingV1)=>void;
          const pending=new Promise<NativeWorkflowPendingV1>(resolve=>{notify=resolve;});
          const work=executorService.executeTask(req.params.id,{browserExecution,nativeStrategies,onNativePending:notify});
          const retained={execution:browserExecution,bindingId:getOwnerSession(req)!.bindingId,work,pending,result:undefined as ExecuteTaskResult|undefined};
          nativeWaiters.set(req.params.id,retained);
          void work.then(completed=>{retained.result=completed;});
          const first=await Promise.race([pending,work]);
          return res.status('pending' in first?202:first.success?200:400).set('Cache-Control','no-store').json(first);
        }
        result=await executorService.executeTask(req.params.id,{browserExecution});
      }catch{return res.status(400).json({success:false,errorCode:'BROWSER_PARENT_ADMISSION_DENIED',taskId:req.params.id,task:taskService.getTask(req.params.id)});}
    }else result = await executorService.executeTask(req.params.id);
    res.status(result.success ? 200 : 400).json(result);
  });

  router.post("/api/edith/tasks/:id/verify", ...protectedMutation, (req, res) => {
    const result = verificationService.verifyTask(req.params.id);
    res.status(result.success ? 200 : 400).json(result);
  });

  router.post("/api/edith/tasks/:id/recover", ...protectedMutation, (req, res) => {
    if(plannedBrowserTask(taskService.getTask(req.params.id))){
      browserWorkflowService.revokeParentExecution(req.params.id,'explicit_revoke');
      return res.status(409).json({success:false,errorCode:'BROWSER_PARENT_NO_AUTO_RECOVERY'});
    }
    const result = recoveryService.recoverTask(req.params.id);
    res.status(result.success ? 200 : 400).json(result);
  });

  return router;
}
