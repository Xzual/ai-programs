import type { EdithPlanStep, EdithTask, EdithToolResult } from './core';
import { capabilityService } from './capabilityService';
import { KillSwitchActiveError, killSwitchService } from './killSwitch';
import { executeEdithTool } from './serverRegistry';
import { taskService } from './taskService';
import { interruptService } from './interruptService';
import { verificationService } from './verifier';
import { recoveryService } from './recovery';

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
