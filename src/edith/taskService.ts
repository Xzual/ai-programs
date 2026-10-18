import {hudSafeId,hudPositiveInteger,hudUtc,isTaskObservedMetricsV1,withoutTaskObservedMetrics,type MetricRule,type TaskObservedMetricsV1} from './taskHudContracts';
import { appendAuditEvent, createAuditEvent, readRecentAuditEvents } from './audit';
import {
  createTask,
  type EdithAgentActivity,
  type EdithPlan,
  type EdithPlanStepStatus,
  type EdithRecoveryEvent,
  type EdithRiskLevel,
  type EdithTask,
  type EdithTaskStatus,
  type EdithTaskTimelineEvent,
  type EdithTaskTimelineEventType,
  type EdithVerificationResult,
} from './core';
import { killSwitchService } from './killSwitch';
import { getEdithPersistenceStore } from './persistence';
import type { ResultCardProductionOptions, SharedResultCardProducerService } from './sharedResultCardProducer';
import type { SharedResultCardV2 } from './contracts';
import {parseTaskEventV2,projectTaskEventsV2,type TypedTaskEventV2,type TaskEventTypeV2} from './contracts';
import {randomUUID} from 'node:crypto';

export const isNativeBoundTask=(task:EdithTask|undefined)=>!!task?.normalizedIntent?.startsWith('native-bound:');
let nativeControl:((id:string,action:'cancel'|'pause',reason:string)=>EdithTask|undefined)|undefined;
let nativePublisher:((event:TypedTaskEventV2)=>void)|undefined;
export function registerNativeTaskHooks(control:typeof nativeControl,publisher:typeof nativePublisher){nativeControl=control;nativePublisher=publisher;}
let genericPublisher: ((event: TypedTaskEventV2) => void) | undefined;
/** Backend composition only. Native publication keeps its separate authority path. */
export function registerGenericTaskPublisher(publisher: typeof genericPublisher): void { genericPublisher = publisher; }
export function controlNativeTask(id:string,action:'cancel'|'pause',reason:string){
  if(nativeControl)return nativeControl(id,action,reason);
  return taskService.nativeTransition(id,action==='cancel'?'CANCELLED':'BLOCKED',action==='cancel'?'task.cancelled':'task.status_changed',action==='cancel'?{reasonCode:'NATIVE_AUTHORITY_UNAVAILABLE'}:undefined);
}

export interface CreateTaskInput {
  title: string;
  objective: string;
  originalUserRequest: string;
  normalizedIntent?: string;
  toolsRequired?: string[];
  permissionsRequired?: string[];
  riskLevel?: EdithRiskLevel;
  validationRules?: string[];
}

/** Server composition only. Implementations read persisted producer receipts/evidence, never request DTOs.
 * No production metric mappings are registered by default (including REA). */
export interface TaskMetricSource {
 readonly toolId:string;
 readonly rules:readonly MetricRule[];
 assertAuthority(taskId:string,runId:string,scope?:{stepId?:string;targetRefId?:string}):void;
 readReceipt(taskId:string,runId:string):Readonly<{
  taskId:string;runId:string;toolId:string;attempt:number;finishedAt:string;success:boolean;observedMetrics:unknown;
 }> | undefined;
 readEvidence(ref:string):Readonly<{taskId:string;runId:string;toolId:string;attempt:number;stepId?:string;targetRefId?:string}> | undefined;
}
export class TaskService {
  private readonly metricSources:TaskMetricSource[];
  constructor(metricSources:readonly TaskMetricSource[] = []) { this.metricSources=[...metricSources]; }
  /** Backend singleton composition only; duplicate tool mappings are never ambiguous. */
  registerMetricSource(source:TaskMetricSource):void {
    const prior=this.metricSources.find(s=>s.toolId===source.toolId);
    if(prior&&prior!==source)throw Error('TASK_METRIC_SOURCE_ALREADY_REGISTERED');
    if(!prior)this.metricSources.push(source);
  }
  /** Input is a locator only. All facts come from an accepted persisted source, matched to the actual tool audit.
   * Call before the executor's ordinary recordTimeline; it deduplicates this same audit run. */
  recordToolObservation(taskId:string,runId:string):EdithTask {
    if(!hudSafeId(taskId)||!hudSafeId(runId))throw new Error('TASK_HUD_PROVENANCE_REQUIRED');
    killSwitchService.assertAllowed('tool_execution','task-metric-receipt');
    const task=this.getTask(taskId);
    if(!task||isNativeBoundTask(task))throw new Error('TASK_HUD_BINDING_REQUIRED');
    const audit=readRecentAuditEvents(100).find(a=>a.id===runId&&a.taskId===taskId&&a.action==='tool.execute'&&a.authorization==='allowed'&&['success','error'].includes(a.result));
    if(!audit||!hudUtc(audit.timestamp))throw new Error('TASK_HUD_PROVENANCE_REQUIRED');
    const sources=this.metricSources.filter(s=>s.toolId===audit.toolId);
    if(sources.length!==1)throw new Error('TASK_HUD_METRIC_UNSUPPORTED');
    const source=sources[0]; source.assertAuthority(taskId,runId);
    const receipt=source.readReceipt(taskId,runId);
    if(!receipt||receipt.taskId!==taskId||receipt.runId!==runId||receipt.toolId!==audit.toolId||!hudPositiveInteger(receipt.attempt)
      ||typeof receipt.success!=='boolean'||receipt.success!==(audit.result==='success')||!hudUtc(receipt.finishedAt)||Date.parse(receipt.finishedAt)>Date.parse(audit.timestamp))throw new Error('TASK_HUD_PROVENANCE_REQUIRED');
    const candidate=receipt.observedMetrics;
    if(!isTaskObservedMetricsV1(candidate,source.rules))throw new Error('TASK_HUD_METRIC_INVALID');
    const metrics=JSON.parse(JSON.stringify(candidate)) as typeof candidate;
    if(metrics.attempt!==receipt.attempt||audit.result==='error'&&metrics.coverage!=='partial'||Date.parse(metrics.observedAt)>Date.now()
      ||metrics.clock==='adapter_receipt'&&Date.parse(metrics.observedAt)<Date.parse(receipt.finishedAt)
      ||metrics.scope.stepId&&!task.plan?.steps.some(s=>s.id===metrics.scope.stepId))throw new Error('TASK_HUD_PROVENANCE_REQUIRED');
    for(const ref of metrics.evidenceRefs){
      const evidence=source.readEvidence(ref);
      if(!evidence||evidence.taskId!==taskId||evidence.runId!==runId||evidence.toolId!==audit.toolId||evidence.attempt!==receipt.attempt
       ||evidence.stepId!==metrics.scope.stepId||evidence.targetRefId!==metrics.scope.targetRefId)throw new Error('TASK_HUD_PROVENANCE_REQUIRED');
    }
    source.assertAuthority(taskId,runId,metrics.scope);
    const prior=projectTaskEventsV2(task).events.find(e=>e.type==='task.tool_completed'&&e.payload.runId===runId);
    if(prior){
      if(prior.type==='task.tool_completed'&&JSON.stringify(prior.payload.observedMetrics)===JSON.stringify(metrics))return task;
      throw new Error('TASK_HUD_ADMISSION_CONFLICT');
    }
    // Source reads may revoke policy; check again immediately before persistence.
    source.assertAuthority(taskId,runId,metrics.scope);killSwitchService.assertAllowed('tool_execution','task-metric-receipt');
    const current=this.getTask(taskId);
    if(!current||current.revision!==task.revision)throw new Error('TASK_HUD_STALE');
    const next=this.withGenericEvents(current,current,'tool',{toolId:audit.toolId,auditEventId:runId},metrics);
    const appended=next.timeline.at(-1) as unknown as TypedTaskEventV2|undefined;
    if(next.timeline.length!==current.timeline.length+1||appended?.type!=='task.tool_completed'||appended.payload.runId!==runId||!appended.payload.observedMetrics)throw new Error('TASK_HUD_PROVENANCE_REQUIRED');
    const stored=getEdithPersistenceStore().updateTask(next);
    this.publishGeneric(stored,current.eventSequence??0);return stored;
  }

  /** Only trusted backend native binding uses this validated storage adapter.
   * Canonical rows retain id=eventId for existing persistence mutation matching.
   * The legacy core timeline type is crossed only after runtime schema validation. */
  createNativeTask(bindingId:string,digest:string,title:string):EdithTask {
    killSwitchService.assertAllowed('task_creation','native-task-binding');
    const task=createTask({title,objective:title,originalUserRequest:title,toolsRequired:['native_app_workflow'],permissionsRequired:['computer:control'],riskLevel:2});
    task.normalizedIntent='native-bound:'+bindingId+':'+digest;
    task.timeline=[this.nativeRow(task,'task.created',{title,status:task.status},1,1)] as unknown as EdithTask['timeline'];
    const stored=getEdithPersistenceStore().createTask(task);this.publishNative(stored);return stored;
  }
  nativeTransition(id:string,status:EdithTaskStatus,type:TaskEventTypeV2,payload?:Record<string,unknown>,verification?:EdithVerificationResult):EdithTask|undefined {
    const task=this.getTask(id);if(!isNativeBoundTask(task))return undefined;
    if(['COMPLETED','CANCELLED','FAILED'].includes(task!.status))return task;
    const revision=(task!.revision??1)+1,sequence=(task!.eventSequence??0)+1;
    const body=payload??{fromStatus:task!.status,toStatus:status};
    const row=this.nativeRow(task!,type,body,sequence,revision,status);
    const next={...task!,status,updatedAt:new Date().toISOString(),verification:verification??task!.verification,timeline:[...task!.timeline,row] as unknown as EdithTask['timeline'],queue:{state:(status==='COMPLETED'?'done':status==='RUNNING'||status==='VERIFYING'?'running':'interrupted') as NonNullable<EdithTask['queue']>['state']}};
    const stored=getEdithPersistenceStore().updateTask(next);this.publishNative(stored,sequence);return stored;
  }
  private nativeRow(task:EdithTask,type:TaskEventTypeV2,payload:Record<string,unknown>,sequence:number,revision:number,status=task.status){
    const eventId=randomUUID(),row={contractVersion:2,taskId:task.id,eventId,id:eventId,sequence,revision,type,occurredAt:new Date().toISOString(),payload,context:{correlationId:task.id,idempotencyKey:task.id+'-'+sequence,...(type==='task.status_changed'?{fromStatus:task.status,toStatus:status}:{})}};
    const parsed=parseTaskEventV2(row);if(!parsed.success)throw new Error('NATIVE_TASK_EVENT_INVALID');return parsed.value;
  }
  private publishNative(task:EdithTask,from=1){
    const projection=projectTaskEventsV2(task);if(projection.diagnostics.quarantinedEventCount)throw new Error('NATIVE_TASK_EVENT_INVALID');
    for(const event of projection.events)if(event.sequence>=from)nativePublisher?.(event);
  }
  listTasks(): EdithTask[] {
    return getEdithPersistenceStore().listTasks();
  }

  getTask(id: string): EdithTask | undefined {
    return this.listTasks().find((task) => task.id === id);
  }

  createTask(input: CreateTaskInput): EdithTask {
    killSwitchService.assertAllowed('task_creation', 'edith-task-service');
    const task = createTask(input);
    const enriched: EdithTask = {
      ...task,
      normalizedIntent: input.normalizedIntent,
      validationRules: input.validationRules ?? task.validationRules,
      timeline: [this.genericRow(task, 'task.created', { status: task.status }, 1, 1)] as unknown as EdithTask['timeline'],
      agentActivity: this.existingAgentActivity(task),
    };
    const stored = getEdithPersistenceStore().createTask(enriched);
    this.publishGeneric(stored, 0);
    return this.auditTaskMutation(stored, 'task.create', `Task created: ${stored.title}`);
  }

  updateStatus(id: string, status: EdithTaskStatus, result?: string): EdithTask | undefined {
    const existing = this.getTask(id);
    if(isNativeBoundTask(existing))throw new Error('NATIVE_TASK_AUTHORITY_REQUIRED');
    const task = existing
      ? this.persistGeneric(existing, {
          ...existing,
          status,
          updatedAt: new Date().toISOString(),
          result: result ?? existing.result,
          observations: [
            ...existing.observations,
            `Status changed to ${status} at ${new Date().toISOString()}`,
          ],
        })
      : undefined;
    return task ? this.auditTaskMutation(task, 'task.status', `Task status changed to ${status}`) : undefined;
  }

  addObservation(id: string, observation: string): EdithTask | undefined {
    return this.mutateTask(id, 'task.observation', `Observation added to task ${id}`, (task) => ({
      ...task,
      observations: [...task.observations, observation],
    }));
  }

  addCheckpoint(id: string, checkpoint: string): EdithTask | undefined {
    return this.mutateTask(id, 'task.checkpoint', `Checkpoint added to task ${id}`, (task) => ({
      ...task,
      checkpoints: [...task.checkpoints, checkpoint],
    }));
  }

  addArtifact(id: string, artifact: string): EdithTask | undefined {
    return this.mutateTask(id, 'task.artifact', `Artifact added to task ${id}`, (task) => ({
      ...task,
      artifacts: [...task.artifacts, artifact],
    }));
  }

  createSharedResultCard(
    id: string,
    producer: SharedResultCardProducerService,
    options: ResultCardProductionOptions,
  ): SharedResultCardV2 | undefined {
    const task = this.getTask(id);
    return task ? producer.fromTask(task, options) : undefined;
  }

  attachPlan(id: string, plan: EdithPlan): EdithTask | undefined {
    return this.mutateTask(id, 'task.plan', `Plan attached to task ${id}: ${plan.id}`, (task) => ({
      ...task,
        status: task.status === 'QUEUED' ? 'PLANNING' : task.status,
        plan,
      subtasks: plan.steps.map((step) => step.id),
      toolsRequired: Array.from(new Set([...task.toolsRequired, ...plan.requiredTools])),
      permissionsRequired: Array.from(new Set([...task.permissionsRequired, ...plan.requiredPermissions])),
      candidateAgents: Array.from(new Set([...task.candidateAgents, ...plan.requiredAgents])),
      validationRules: Array.from(new Set([...task.validationRules, ...plan.validationCriteria])),
      memoryReferences: Array.from(new Set([
        ...task.memoryReferences,
        ...(plan.contextSnapshot?.memoryReferences.map((reference) => reference.id) ?? []),
      ])),
        checkpoints: [...task.checkpoints, `Plan ${plan.id} attached at ${new Date().toISOString()}`],
        agentActivity: this.mergeAgentActivity(task, plan.requiredAgents.map((agentId) => ({
          agentId,
          role: agentId === 'orchestrator' ? 'orchestrator' : agentId === 'planning' ? 'planner' : agentId === 'security' ? 'security' : 'abstraction',
          status: 'SELECTED',
          message: `Selected during planning for task ${task.id}.`,
          tools: [],
          planningOnly: true,
        }))),
      }));
  }

  updatePlanStepStatus(
    id: string,
    stepId: string,
    status: EdithPlanStepStatus,
    observation?: string
  ): EdithTask | undefined {
    return this.mutateTask(id, 'task.plan_step', `Plan step ${stepId} changed to ${status}`, (task) => {
      if (!task.plan) return task;
      return {
        ...task,
        observations: observation ? [...task.observations, observation] : task.observations,
        plan: {
          ...task.plan,
          steps: task.plan.steps.map((step) =>
            step.id === stepId ? { ...step, status } : step
          ),
        },
      };
    });
  }

  recordVerification(id: string, verification: EdithVerificationResult): EdithTask | undefined {
    const statusByVerification: Record<EdithVerificationResult['status'], EdithTaskStatus> = {
      PASS: 'COMPLETED',
      FAIL: 'FAILED',
      PARTIAL: 'BLOCKED',
      RETRYABLE: 'BLOCKED',
    };
    return this.mutateTask(
      id,
      'task.verify',
      `Verification ${verification.status} for task ${id}`,
      (task) => ({
        ...task,
        status: statusByVerification[verification.status],
        verification,
        result: verification.status === 'PASS' ? verification.summary : task.result,
        failureReason: verification.status === 'FAIL' ? verification.summary : task.failureReason,
        observations: [
          ...task.observations,
          `Verifier ${verification.status}: ${verification.summary}`,
        ],
        checkpoints: [
          ...task.checkpoints,
          `Verification ${verification.id} recorded at ${verification.checkedAt}`,
        ],
      })
    );
  }

  recordRecovery(
    id: string,
    recovery: EdithRecoveryEvent,
    plan?: EdithPlan
  ): EdithTask | undefined {
    return this.mutateTask(
      id,
      'task.recover',
      `Recovery ${recovery.action} for task ${id}: ${recovery.classification}`,
      (task) => ({
        ...task,
        status: recovery.newStatus,
        plan: plan ?? task.plan,
        verification: plan ? undefined : task.verification,
        subtasks: plan ? plan.steps.map((step) => step.id) : task.subtasks,
        toolsRequired: plan ? Array.from(new Set([...task.toolsRequired, ...plan.requiredTools])) : task.toolsRequired,
        permissionsRequired: plan ? Array.from(new Set([...task.permissionsRequired, ...plan.requiredPermissions])) : task.permissionsRequired,
        candidateAgents: plan ? Array.from(new Set([...task.candidateAgents, ...plan.requiredAgents])) : task.candidateAgents,
        validationRules: plan ? Array.from(new Set([...task.validationRules, ...plan.validationCriteria])) : task.validationRules,
        recoveryEvents: [...(task.recoveryEvents ?? []), recovery],
        observations: [
          ...task.observations,
          `Recovery ${recovery.action}: ${recovery.reason}`,
        ],
        checkpoints: [
          ...task.checkpoints,
          `Recovery ${recovery.id} recorded at ${recovery.createdAt}`,
          ...(plan ? [`Recovery attached plan ${plan.id}`] : []),
        ],
        result: recovery.action === 'STOP' ? recovery.reason : task.result,
        failureReason: recovery.action === 'STOP' ? recovery.reason : task.failureReason,
      })
    );
  }

  recordActivity(input: {
    taskId: string;
    agentId: string;
    agentName?: string;
    role: EdithAgentActivity['role'];
    status: EdithAgentActivity['status'];
    message: string;
    tools?: string[];
    planningOnly?: boolean;
  }): EdithTask | undefined {
    return this.mutateTask(
      input.taskId,
      'task.agent_activity',
      `Agent activity ${input.agentId} ${input.status}`,
      (task) => ({
        ...task,
        agentActivity: this.mergeAgentActivity(task, [input]),
      }),
      'agent',
      input.agentId,
      input.message
    );
  }

  recordTimeline(input: {
    taskId: string;
    type: EdithTaskTimelineEventType;
    actor: string;
    message: string;
    status?: EdithTaskStatus;
    toolId?: string;
    agentId?: string;
    riskLevel?: EdithRiskLevel;
    auditEventId?: string;
    metadata?: Record<string, unknown>;
  }): EdithTask | undefined {
    return this.mutateTask(
      input.taskId,
      `task.timeline.${input.type}`,
      input.message,
      (task) => task,
      input.type,
      input.actor,
      input.message,
      input
    );
  }

  private mutateTask(
    id: string,
    action: string,
    auditMessage: string,
    mutator: (task: EdithTask) => EdithTask,
    timelineType?: EdithTaskTimelineEventType,
    timelineActor?: string,
    timelineMessage?: string,
    timelineMetadata?: Partial<EdithTaskTimelineEvent>
  ): EdithTask | undefined {
    const task = this.getTask(id);
    if (!task) return undefined;
    if(isNativeBoundTask(task))throw new Error('NATIVE_TASK_AUTHORITY_REQUIRED');
    const mutated = mutator(this.normalizeTask(task));
    const updated = getEdithPersistenceStore().updateTask(
      this.withGenericEvents(task, mutated, timelineType, timelineMetadata)
    );
    this.publishGeneric(updated, task.eventSequence ?? 0);
    return this.auditTaskMutation(updated, action, auditMessage);
  }

  /** Queue mutations share the real writer, without granting native authority. */
  updateGenericTask(id: string, action: string, mutator: (task: EdithTask) => EdithTask): EdithTask | undefined {
    const task = this.getTask(id);
    if (!task) return undefined;
    if (isNativeBoundTask(task)) throw new Error('NATIVE_TASK_AUTHORITY_REQUIRED');
    // Queue retains its existing audit owner; this adapter only stores/publishes its real transition.
    return this.persistGeneric(task, mutator(this.normalizeTask(task)));
  }

  private genericRow(task: EdithTask, type: TaskEventTypeV2, payload: Record<string, unknown>, sequence: number, revision: number) {
    const eventId = randomUUID();
    const row = { contractVersion: 2, taskId: task.id, eventId, id: eventId, sequence, revision, type,
      occurredAt: new Date().toISOString(), payload,
      context: { correlationId: task.id, idempotencyKey: `${task.id}-${sequence}`,
        ...(type === 'task.status_changed' ? { fromStatus: payload.fromStatus, toStatus: payload.toStatus } : {}) } };
    const parsed = parseTaskEventV2(row);
    if (!parsed.success) throw new Error('GENERIC_TASK_EVENT_INVALID');
    return parsed.value;
  }

  private withGenericEvents(previous: EdithTask, next: EdithTask, type?: EdithTaskTimelineEventType, metadata?: Partial<EdithTaskTimelineEvent>, observedMetrics?:TaskObservedMetricsV1): EdithTask {
    const rows: TypedTaskEventV2[] = [];
    const add = (eventType: TaskEventTypeV2, payload: Record<string, unknown>) => rows.push(this.genericRow(previous, eventType, payload,
      (previous.eventSequence ?? 0) + rows.length + 1, (previous.revision ?? 1) + 1));
    if (previous.status !== next.status) {
      add('task.status_changed', { fromStatus: previous.status, toStatus: next.status });
      if (next.status === 'CANCELLED') add('task.cancelled', {});
    }
    for (const step of next.plan?.steps ?? []) {
      const prior = previous.plan?.steps.find(candidate => candidate.id === step.id);
      if (!prior || prior.status !== step.status) add('task.step_updated', { stepId: step.id, status: step.status });
    }
    if (next.verification && next.verification !== previous.verification) {
      add('task.verification_completed', { verificationId: next.verification.id, status: next.verification.status });
      const required = next.verification.checks.filter(check => check.required);
      if (next.status === 'COMPLETED' && next.verification.status === 'PASS' && required.length && required.every(check => check.status === 'PASS')) {
        add('task.completed', {});
      }
    }
    for (const recovery of next.recoveryEvents ?? []) {
      if (!previous.recoveryEvents?.some(prior => prior.id === recovery.id)) add('task.recovery_started', {
        recoveryId: recovery.id, attempt: recovery.attempt, classification: recovery.classification,
      });
    }
    // The executor supplies an actual completed tool audit reference. Never infer outcome from display text.
    if (type === 'tool' && metadata?.toolId && metadata.auditEventId) {
      const audit = readRecentAuditEvents(100).find(event => event.id === metadata.auditEventId && event.taskId === previous.id
        && event.toolId === metadata.toolId && event.action === 'tool.execute');
      const alreadyRecorded = projectTaskEventsV2(previous).events.some(event => event.type === 'task.tool_completed' && event.payload.runId === metadata.auditEventId);
      if (audit && !alreadyRecorded && ['success', 'error', 'denied'].includes(audit.result)) add('task.tool_completed', {
        toolId: audit.toolId, runId: audit.id, outcome: audit.result === 'success' ? 'success' : 'failure',
        ...(observedMetrics?{observedMetrics}:{}),
      });
    }
    return { ...next, updatedAt: new Date().toISOString(),
      // Preserve all old rows exactly; never migrate a historical legacy row into a canonical event.
      timeline: [...this.existingTimeline(previous), ...rows] as unknown as EdithTask['timeline'] };
  }

  private persistGeneric(previous: EdithTask, next: EdithTask): EdithTask {
    const stored = getEdithPersistenceStore().updateTask(this.withGenericEvents(previous, next));
    this.publishGeneric(stored, previous.eventSequence ?? 0);
    return stored;
  }

  private publishGeneric(task: EdithTask, afterSequence: number): void {
    for (const event of projectTaskEventsV2(task).events) if (event.sequence > afterSequence) genericPublisher?.(withoutTaskObservedMetrics(event));
  }

  private auditTaskMutation(task: EdithTask, action: string, message: string): EdithTask {
    const event = createAuditEvent({
      actor: 'edith-task-service',
      taskId: task.id,
      action,
      toolId: 'task_service',
      authorization: 'allowed',
      riskLevel: task.riskLevel,
      result: 'success',
      message,
    });
    appendAuditEvent(event);
    const current = this.getTask(task.id);
    if (!current) return task;
    return getEdithPersistenceStore().updateTask({
      ...this.normalizeTask(current),
      auditEvents: Array.from(new Set([...current.auditEvents, event.id])),
    });
  }

  private normalizeTask(task: EdithTask): EdithTask {
    return {
      ...task,
      timeline: this.existingTimeline(task),
      agentActivity: this.existingAgentActivity(task),
    };
  }

  private existingTimeline(task: Partial<EdithTask>): EdithTaskTimelineEvent[] {
    return Array.isArray(task.timeline) ? task.timeline : [];
  }

  private existingAgentActivity(task: Partial<EdithTask>): EdithAgentActivity[] {
    return Array.isArray(task.agentActivity) ? task.agentActivity : [];
  }

  private mergeAgentActivity(
    task: EdithTask,
    activities: Array<{
      agentId: string;
      agentName?: string;
      role: EdithAgentActivity['role'];
      status: EdithAgentActivity['status'];
      message: string;
      tools?: string[];
      planningOnly?: boolean;
    }>
  ): EdithAgentActivity[] {
    const now = new Date().toISOString();
    const existing = this.existingAgentActivity(task);
    const next = [...existing];
    for (const activity of activities) {
      const index = next.findIndex((candidate) => candidate.agentId === activity.agentId && !candidate.endedAt);
      const current = index >= 0 ? next[index] : undefined;
      const item: EdithAgentActivity = {
        id: current?.id ?? `agentrun-${activity.agentId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        taskId: task.id,
        agentId: activity.agentId,
        agentName: activity.agentName ?? current?.agentName,
        role: activity.role,
        status: activity.status,
        startedAt: current?.startedAt ?? now,
        endedAt: ['COMPLETED', 'FAILED', 'SKIPPED'].includes(activity.status) ? now : current?.endedAt,
        message: activity.message,
        tools: Array.from(new Set([...(current?.tools ?? []), ...(activity.tools ?? [])])),
        planningOnly: activity.planningOnly ?? current?.planningOnly ?? false,
      };
      if (index >= 0) next[index] = item;
      else next.push(item);
    }
    return next;
  }
}

export const taskService = new TaskService();
