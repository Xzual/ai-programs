import type {
  EdithRecoveryAction,
  EdithRecoveryClassification,
  EdithRecoveryEvent,
  EdithTask,
  EdithTaskStatus,
} from './core';
import { capabilityService, type CapabilityAssessment } from './capabilityService';
import { plannerService } from './planner';
import { taskService } from './taskService';

export interface RecoverTaskResult {
  success: boolean;
  taskId: string;
  action?: EdithRecoveryAction;
  classification?: EdithRecoveryClassification;
  attempt?: number;
  task?: EdithTask;
  recovery?: EdithRecoveryEvent;
  error?: string;
}

function recoveryId(taskId: string): string {
  return `recovery-${taskId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function classify(task: EdithTask): EdithRecoveryClassification {
  if (task.status === 'WAITING_FOR_APPROVAL') return 'PERMISSION_DENIED';
  if (task.status === 'FAILED') return 'EXECUTION_FAILED';
  if (task.verification?.status === 'RETRYABLE') return 'VERIFICATION_RETRYABLE';
  if (task.verification?.status === 'PARTIAL') return 'PARTIAL_RESULT';
  if (task.status === 'BLOCKED') return 'BUDGET_EXHAUSTED';
  return 'UNKNOWN';
}

function retryBudget(task: EdithTask): number {
  return Math.max(0, task.plan?.maxRetries ?? 2);
}

function recoveryAttempt(task: EdithTask): number {
  return (task.recoveryEvents ?? []).length + 1;
}

function recoveryReason(task: EdithTask, classification: EdithRecoveryClassification): string {
  if (task.verification && task.verification.status !== 'PASS') return task.verification.summary;
  if (task.failureReason) return task.failureReason;
  if (task.result) return task.result;
  return `Recovery classified task ${task.id} as ${classification}.`;
}

function permissionAssessmentFor(task: EdithTask): CapabilityAssessment {
  return capabilityService.assess({
    objective: task.objective,
    actor: 'edith-executor',
    toolsRequired: task.toolsRequired,
    permissionsRequired: task.permissionsRequired,
    riskLevel: task.riskLevel,
  });
}

function allowedForRecovery(status: EdithTaskStatus): boolean {
  return status === 'BLOCKED' ||
    status === 'FAILED' ||
    status === 'RECOVERING' ||
    status === 'WAITING_FOR_APPROVAL';
}

export class RecoveryService {
  recoverTask(taskId: string): RecoverTaskResult {
    const task = taskService.getTask(taskId);
    if (!task) return { success: false, taskId, error: 'Task not found.' };
    if (!allowedForRecovery(task.status)) {
      return {
        success: false,
        taskId,
        task,
        error: `Task is not in a recoverable state: ${task.status}.`,
      };
    }

    const classification = classify(task);
    const attempt = recoveryAttempt(task);
    const maxRetries = retryBudget(task);
    taskService.updateStatus(taskId, 'RECOVERING', `Recovery attempt ${attempt} classified as ${classification}.`);
    taskService.recordActivity({
      taskId,
      agentId: 'recovery',
      role: 'recovery',
      status: 'RUNNING',
      message: `Recovery attempt ${attempt}: ${classification}.`,
      planningOnly: false,
    });

    if (classification === 'PERMISSION_DENIED') {
      const assessment = permissionAssessmentFor(task);
      const recovery = this.createRecovery(task, attempt, classification, 'WAIT_PERMISSION', task.status, 'WAITING_FOR_APPROVAL', undefined, assessment);
      const updated = taskService.recordRecovery(taskId, recovery);
      taskService.recordActivity({
        taskId,
        agentId: 'recovery',
        role: 'recovery',
        status: 'WAITING_FOR_APPROVAL',
        message: recovery.reason,
      });
      return {
        success: false,
        taskId,
        action: recovery.action,
        classification,
        attempt,
        task: updated,
        recovery,
        error: recovery.reason,
      };
    }

    if (attempt > maxRetries) {
      const recovery = this.createRecovery(task, attempt, classification, 'STOP', task.status, 'FAILED');
      const updated = taskService.recordRecovery(taskId, recovery);
      taskService.recordActivity({
        taskId,
        agentId: 'recovery',
        role: 'recovery',
        status: 'FAILED',
        message: recovery.reason,
      });
      return {
        success: false,
        taskId,
        action: recovery.action,
        classification,
        attempt,
        task: updated,
        recovery,
        error: `Recovery stopped after ${maxRetries} retry attempts.`,
      };
    }

    const nextPlan = plannerService.createPlan(task);
    const recovery = this.createRecovery(task, attempt, classification, 'REPLAN', task.status, 'QUEUED', nextPlan.id);
    const updated = taskService.recordRecovery(taskId, recovery, nextPlan);
    taskService.recordActivity({
      taskId,
      agentId: 'recovery',
      role: 'recovery',
      status: 'COMPLETED',
      message: `Recovery replanned task with ${nextPlan.id}.`,
    });
    return {
      success: true,
      taskId,
      action: recovery.action,
      classification,
      attempt,
      task: updated,
      recovery,
    };
  }

  private createRecovery(
    task: EdithTask,
    attempt: number,
    classification: EdithRecoveryClassification,
    action: EdithRecoveryAction,
    previousStatus: EdithTaskStatus,
    newStatus: EdithTaskStatus,
    newPlanId?: string,
    capabilityAssessment?: CapabilityAssessment
  ): EdithRecoveryEvent {
    return {
      id: recoveryId(task.id),
      taskId: task.id,
      createdAt: new Date().toISOString(),
      attempt,
      classification,
      action,
      reason: recoveryReason(task, classification),
      previousStatus,
      newStatus,
      previousPlanId: task.plan?.id,
      newPlanId,
      capabilityAssessmentId: capabilityAssessment?.id,
      permissionRequest: capabilityAssessment && capabilityAssessment.missingPermissions.length > 0
        ? {
            actor: capabilityAssessment.actor,
            toolIds: capabilityAssessment.blockedTools,
            permissions: capabilityAssessment.missingPermissions,
            highRiskToolIds: capabilityAssessment.highRiskBlockedTools,
            rationale: capabilityAssessment.summary,
          }
        : undefined,
    };
  }
}

export const recoveryService = new RecoveryService();
