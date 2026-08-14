import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type {
  EdithTask,
  EdithVerificationCheck,
  EdithVerificationResult,
  EdithVerificationStatus,
} from './core';
import { readRecentAuditEvents } from './audit';
import { taskService } from './taskService';

export interface VerifyTaskResult {
  success: boolean;
  taskId: string;
  status?: EdithVerificationStatus;
  verification?: EdithVerificationResult;
  task?: EdithTask;
  error?: string;
}

const OBJECTIVE_STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'bir',
  'bu',
  'create',
  'durum',
  'for',
  'hazirla',
  'ile',
  'icin',
  'local',
  'rapor',
  'status',
  'task',
  'the',
  've',
  'with',
]);

function verificationId(taskId: string): string {
  return `verify-${taskId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function check(
  id: string,
  label: string,
  status: EdithVerificationStatus,
  evidence: string,
  required = true
): EdithVerificationCheck {
  return { id, label, status, evidence, required };
}

function isTerminalStepStatus(status: string): boolean {
  return status === 'COMPLETED' || status === 'SKIPPED';
}

function objectiveKeywords(task: EdithTask): string[] {
  return Array.from(
    new Set(
      `${task.objective} ${task.originalUserRequest}`
        .toLocaleLowerCase('tr-TR')
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .split(/\s+/)
        .map((word) => word.trim())
        .filter((word) => word.length >= 3 && !OBJECTIVE_STOP_WORDS.has(word))
    )
  ).slice(0, 8);
}

function localArtifactPath(artifact: string): string | undefined {
  if (artifact.startsWith('artifact://')) return undefined;
  if (artifact.startsWith('file://')) {
    try {
      return fileURLToPath(artifact);
    } catch {
      return undefined;
    }
  }
  return path.isAbsolute(artifact) ? artifact : undefined;
}

function artifactEvidence(task: EdithTask): EdithVerificationCheck[] {
  return task.artifacts
    .map((artifact) => {
      const filePath = localArtifactPath(artifact);
      if (!filePath) {
        return check(
          `artifact-${artifact}`,
          `Artifact reference: ${artifact}`,
          'PASS',
          'Non-file artifact reference is recorded.',
          false
        );
      }
      if (!fs.existsSync(filePath)) {
        return check(`artifact-${artifact}`, `Artifact exists: ${artifact}`, 'FAIL', 'File artifact does not exist.');
      }
      const stats = fs.statSync(filePath);
      if (!stats.isFile() || stats.size <= 0) {
        return check(`artifact-${artifact}`, `Artifact non-empty: ${artifact}`, 'FAIL', `Invalid file artifact size: ${stats.size}.`);
      }
      return check(`artifact-${artifact}`, `Artifact valid: ${artifact}`, 'PASS', `File exists and is ${stats.size} bytes.`);
    });
}

function finalStatus(checks: EdithVerificationCheck[]): EdithVerificationStatus {
  const required = checks.filter((candidate) => candidate.required);
  if (required.some((candidate) => candidate.status === 'RETRYABLE')) return 'RETRYABLE';
  if (required.some((candidate) => candidate.status === 'FAIL')) return 'FAIL';
  if (checks.some((candidate) => candidate.status === 'PARTIAL' || candidate.status === 'FAIL')) return 'PARTIAL';
  return 'PASS';
}

export class VerificationService {
  verifyTask(taskId: string): VerifyTaskResult {
    const task = taskService.getTask(taskId);
    if (!task) return { success: false, taskId, error: 'Task not found.' };
    if (task.status !== 'VERIFYING') {
      return {
        success: false,
        taskId,
        status: 'RETRYABLE',
        task,
        error: `Task must be VERIFYING before verification. Current status: ${task.status}.`,
      };
    }

    const verification = this.evaluate(task);
    const updated = taskService.recordVerification(taskId, verification);
    return {
      success: verification.status === 'PASS',
      taskId,
      status: verification.status,
      verification,
      task: updated,
      error: verification.status === 'PASS' ? undefined : verification.summary,
    };
  }

  evaluate(task: EdithTask): EdithVerificationResult {
    const checks = this.buildChecks(task);
    const status = finalStatus(checks);
    const failed = checks.filter((candidate) => candidate.required && candidate.status !== 'PASS');
    const checkedAt = new Date().toISOString();
    const summary = status === 'PASS'
      ? `Verification passed for task ${task.id}. Objective has execution evidence.`
      : `Verification ${status}: ${failed.map((candidate) => candidate.label).join('; ')}`;

    return {
      id: verificationId(task.id),
      taskId: task.id,
      verifier: 'heuristic-v1',
      status,
      checkedAt,
      summary,
      checks,
      retryable: status === 'RETRYABLE',
    };
  }

  private buildChecks(task: EdithTask): EdithVerificationCheck[] {
    const checks: EdithVerificationCheck[] = [];
    const plan = task.plan;
    const auditEvents = readRecentAuditEvents(1000).filter((event) => event.taskId === task.id);
    const evidenceText = [
      task.result ?? '',
      ...task.observations,
      ...task.artifacts,
    ].join('\n').toLocaleLowerCase('tr-TR');

    checks.push(check(
      'task-status',
      'Task reached verification boundary',
      task.status === 'VERIFYING' ? 'PASS' : 'RETRYABLE',
      `Current task status: ${task.status}.`
    ));

    checks.push(check(
      'plan-exists',
      'Structured plan exists',
      plan ? 'PASS' : 'RETRYABLE',
      plan ? `Plan ${plan.id} is attached.` : 'No structured plan is attached.'
    ));

    if (plan) {
      const nonTerminal = plan.steps.filter((step) => !isTerminalStepStatus(step.status));
      const failedSteps = plan.steps.filter((step) => step.status === 'FAILED');
      checks.push(check(
        'plan-steps-terminal',
        'All planned steps are terminal',
        nonTerminal.length === 0 ? 'PASS' : 'RETRYABLE',
        nonTerminal.length === 0
          ? `${plan.steps.length} steps are completed or skipped.`
          : `Non-terminal steps: ${nonTerminal.map((step) => `${step.id}:${step.status}`).join(', ')}.`
      ));
      checks.push(check(
        'plan-steps-not-failed',
        'No planned step failed',
        failedSteps.length === 0 ? 'PASS' : 'RETRYABLE',
        failedSteps.length === 0
          ? 'No failed plan steps.'
          : `Failed steps: ${failedSteps.map((step) => step.id).join(', ')}.`
      ));

      for (const toolId of plan.requiredTools) {
        const hasObservation = task.observations.some((observation) =>
          observation.includes(`Executor tool ${toolId} succeeded`)
        );
        const hasAudit = auditEvents.some((event) =>
          event.toolId === toolId &&
          event.action === 'tool.execute' &&
          event.result === 'success'
        );
        checks.push(check(
          `tool-observation-${toolId}`,
          `Observation exists for tool ${toolId}`,
          hasObservation ? 'PASS' : 'RETRYABLE',
          hasObservation ? `Task observations include successful ${toolId} execution.` : `No successful ${toolId} observation found.`
        ));
        checks.push(check(
          `tool-audit-${toolId}`,
          `Audit exists for tool ${toolId}`,
          hasAudit ? 'PASS' : 'RETRYABLE',
          hasAudit ? `Audit log includes successful ${toolId} execution.` : `No successful ${toolId} audit event found.`
        ));
      }
    }

    const hasExecutionEvidence = task.observations.length > 0 || task.artifacts.length > 0 || Boolean(task.result);
    checks.push(check(
      'execution-evidence',
      'Execution produced evidence',
      hasExecutionEvidence ? 'PASS' : 'RETRYABLE',
      hasExecutionEvidence
        ? `${task.observations.length} observations, ${task.artifacts.length} artifacts, result=${Boolean(task.result)}.`
        : 'No observations, artifacts, or result are recorded.'
    ));

    const keywords = objectiveKeywords(task);
    const matchedKeywords = keywords.filter((keyword) => evidenceText.includes(keyword));
    checks.push(check(
      'objective-evidence',
      'Evidence overlaps with objective',
      keywords.length === 0 || matchedKeywords.length >= Math.min(2, keywords.length) ? 'PASS' : 'PARTIAL',
      keywords.length === 0
        ? 'No objective keywords were required.'
        : `Matched objective keywords: ${matchedKeywords.join(', ') || 'none'} of ${keywords.join(', ')}.`,
      false
    ));

    checks.push(...artifactEvidence(task));

    return checks;
  }
}

export const verificationService = new VerificationService();
