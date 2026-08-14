import { appendAuditEvent, createAuditEvent } from './audit';
import {
  createTask,
  type EdithPlan,
  type EdithPlanStepStatus,
  type EdithRiskLevel,
  type EdithTask,
  type EdithTaskStatus,
  type EdithVerificationResult,
} from './core';
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
    const task = createTask(input);
    const enriched: EdithTask = {
      ...task,
      normalizedIntent: input.normalizedIntent,
      validationRules: input.validationRules ?? task.validationRules,
    };
    const stored = getEdithPersistenceStore().createTask(enriched);
    this.auditTaskMutation(stored, 'task.create', `Task created: ${stored.title}`);
    return stored;
  }

  updateStatus(id: string, status: EdithTaskStatus, result?: string): EdithTask | undefined {
    const task = getEdithPersistenceStore().updateTaskStatus(id, status, result);
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
      status: task.status === 'CREATED' ? 'PLANNING' : task.status,
      plan,
      subtasks: plan.steps.map((step) => step.id),
      toolsRequired: Array.from(new Set([...task.toolsRequired, ...plan.requiredTools])),
      permissionsRequired: Array.from(new Set([...task.permissionsRequired, ...plan.requiredPermissions])),
      candidateAgents: Array.from(new Set([...task.candidateAgents, ...plan.requiredAgents])),
      validationRules: Array.from(new Set([...task.validationRules, ...plan.validationCriteria])),
      checkpoints: [...task.checkpoints, `Plan ${plan.id} attached at ${new Date().toISOString()}`],
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
      PARTIAL: 'PAUSED',
      RETRYABLE: 'RETRYING',
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

  private mutateTask(
    id: string,
    action: string,
    auditMessage: string,
    mutator: (task: EdithTask) => EdithTask
  ): EdithTask | undefined {
    const task = this.getTask(id);
    if (!task) return undefined;
    const updated = getEdithPersistenceStore().updateTask(mutator(task));
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
  }
}

export const taskService = new TaskService();
