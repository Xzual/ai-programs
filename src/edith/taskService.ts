import { appendAuditEvent, createAuditEvent } from './audit';
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

export class TaskService {
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
      timeline: [
        ...this.existingTimeline(task),
        this.createTimelineEvent(task.id, {
          type: 'status',
          actor: 'edith-task-service',
          message: `Task created and queued: ${task.title}`,
          status: 'QUEUED',
          riskLevel: task.riskLevel,
        }),
      ],
      agentActivity: this.existingAgentActivity(task),
    };
    const stored = getEdithPersistenceStore().createTask(enriched);
    this.auditTaskMutation(stored, 'task.create', `Task created: ${stored.title}`);
    return stored;
  }

  updateStatus(id: string, status: EdithTaskStatus, result?: string): EdithTask | undefined {
    const existing = this.getTask(id);
    const task = existing
      ? getEdithPersistenceStore().updateTask(this.withTimeline({
          ...existing,
          status,
          updatedAt: new Date().toISOString(),
          result: result ?? existing.result,
          observations: [
            ...existing.observations,
            `Status changed to ${status} at ${new Date().toISOString()}`,
          ],
        }, 'status', 'edith-task-service', `Task status changed to ${status}`, { status, riskLevel: existing.riskLevel }))
      : undefined;
    if (task) this.auditTaskMutation(task, 'task.status', `Task status changed to ${status}`);
    return task;
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
    const mutated = mutator(this.normalizeTask(task));
    const updated = getEdithPersistenceStore().updateTask(
      this.withTimeline(
        mutated,
        timelineType ?? this.timelineTypeForAction(action),
        timelineActor ?? 'edith-task-service',
        timelineMessage ?? auditMessage,
        timelineMetadata
      )
    );
    this.auditTaskMutation(updated, action, auditMessage);
    return updated;
  }

  private auditTaskMutation(task: EdithTask, action: string, message: string): void {
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
    if (!current) return;
    getEdithPersistenceStore().updateTask(this.withTimeline({
      ...this.normalizeTask(current),
      auditEvents: Array.from(new Set([...current.auditEvents, event.id])),
    }, 'audit', 'edith-task-service', message, { auditEventId: event.id, riskLevel: task.riskLevel }));
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

  private timelineTypeForAction(action: string): EdithTaskTimelineEventType {
    if (action.includes('plan')) return 'plan';
    if (action.includes('verify')) return 'verification';
    if (action.includes('recover')) return 'recovery';
    if (action.includes('checkpoint')) return 'checkpoint';
    if (action.includes('artifact')) return 'artifact';
    if (action.includes('observation')) return 'observation';
    if (action.includes('permission')) return 'permission';
    if (action.includes('agent')) return 'agent';
    return 'status';
  }

  private createTimelineEvent(
    taskId: string,
    input: Omit<EdithTaskTimelineEvent, 'id' | 'taskId' | 'createdAt'>
  ): EdithTaskTimelineEvent {
    return {
      ...input,
      id: `timeline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      taskId,
      createdAt: new Date().toISOString(),
    };
  }

  private withTimeline(
    task: EdithTask,
    type: EdithTaskTimelineEventType,
    actor: string,
    message: string,
    metadata: Partial<EdithTaskTimelineEvent> = {}
  ): EdithTask {
    return {
      ...task,
      updatedAt: new Date().toISOString(),
      timeline: [
        ...this.existingTimeline(task),
        this.createTimelineEvent(task.id, {
          type,
          actor,
          message,
          status: metadata.status ?? task.status,
          toolId: metadata.toolId,
          agentId: metadata.agentId,
          riskLevel: metadata.riskLevel ?? task.riskLevel,
          auditEventId: metadata.auditEventId,
          metadata: metadata.metadata,
        }),
      ],
      agentActivity: this.existingAgentActivity(task),
    };
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
