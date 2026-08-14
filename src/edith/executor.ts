import type { EdithPlanStep, EdithTask, EdithToolResult } from './core';
import { capabilityService } from './capabilityService';
import { KillSwitchActiveError, killSwitchService } from './killSwitch';
import { executeEdithTool } from './serverRegistry';
import { taskService } from './taskService';

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
  status: 'VERIFYING' | 'WAITING_PERMISSION' | 'FAILED' | 'PAUSED' | 'NOOP';
  iterations: number;
  toolCalls: number;
  reports: ExecutionStepReport[];
  task?: EdithTask;
  error?: string;
}

function toolArgsForStep(task: EdithTask, toolId: string): Record<string, unknown> {
  if (toolId === 'browser_search') return { query: task.objective };
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
  async executeTask(taskId: string): Promise<ExecuteTaskResult> {
    let task = taskService.getTask(taskId);
    if (!task) return { success: false, taskId, status: 'FAILED', iterations: 0, toolCalls: 0, reports: [], error: 'Task not found.' };
    if (!task.plan || task.plan.status !== 'READY') {
      return { success: false, taskId, status: 'NOOP', iterations: 0, toolCalls: 0, reports: [], task, error: 'Task has no READY plan.' };
    }

    try {
      killSwitchService.assertAllowed('tool_execution', 'edith-executor');
    } catch (error) {
      if (!(error instanceof KillSwitchActiveError)) throw error;
      const paused = taskService.updateStatus(taskId, 'PAUSED', error.message);
      return {
        success: false,
        taskId,
        status: 'PAUSED',
        iterations: 0,
        toolCalls: 0,
        reports: [],
        task: paused ?? task,
        error: error.message,
      };
    }

    taskService.updateStatus(taskId, 'RUNNING');
    task = taskService.getTask(taskId) ?? task;

    const reports: ExecutionStepReport[] = [];
    let iterations = 0;
    let toolCalls = 0;
    const startedAt = Date.now();

    while (iterations < task.plan.maxIterations && toolCalls < task.plan.maxToolCalls) {
      iterations += 1;
      if (Date.now() - startedAt > task.plan.taskTimeoutMs) {
        const failed = taskService.updateStatus(taskId, 'FAILED', 'Execution timed out before verification.');
        return { success: false, taskId, status: 'FAILED', iterations, toolCalls, reports, task: failed, error: 'Execution timed out.' };
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
        const status = denied ? 'WAITING_PERMISSION' : 'FAILED';
        const failed = taskService.updateStatus(taskId, status, report.message);
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
      const paused = taskService.updateStatus(taskId, 'PAUSED', 'Execution budget exhausted before all steps completed.');
      return {
        success: false,
        taskId,
        status: 'PAUSED',
        iterations,
        toolCalls,
        reports,
        task: paused,
        error: 'Execution budget exhausted before all steps completed.',
      };
    }

    const verifying = taskService.updateStatus(taskId, 'VERIFYING', 'Execution finished; verifier must validate completion.');
    taskService.addCheckpoint(taskId, `Executor reached verification boundary at ${new Date().toISOString()}`);
    return {
      success: true,
      taskId,
      status: 'VERIFYING',
      iterations,
      toolCalls,
      reports,
      task: taskService.getTask(taskId) ?? verifying,
    };
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
