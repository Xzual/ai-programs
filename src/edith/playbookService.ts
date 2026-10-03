import { randomUUID } from 'node:crypto';
import {
  EDITH_CONTRACT_AMENDMENT,
  TASK_CONTRACT_VERSION,
  parsePlaybookDefinitionV2,
  parsePlaybookRunV2,
  type PlaybookDefinitionV2,
  type PlaybookRunV2,
  type PlaybookStepV2,
} from './contracts';
import type { Phase4Persistence } from './phase4Persistence';

export interface PlaybookStepExecutionResult {
  success: boolean;
  artifactIds?: string[];
  errorCode?: string;
  retryable?: boolean;
  verificationStatus?: 'PASS' | 'FAIL' | 'PARTIAL' | 'RETRYABLE';
}

export interface PlaybookExecutionAdapter {
  readonly adapterId: string;
  readonly available: boolean;
  execute(step: PlaybookStepV2, input: Record<string, unknown>, context: { runId: string; attempt: number }): Promise<PlaybookStepExecutionResult>;
  undo?(step: PlaybookStepV2, run: PlaybookRunV2): Promise<{ success: boolean; errorCode?: string }>;
}

export interface PlaybookApprovalEvaluator {
  evaluate(step: PlaybookStepV2): 'approved' | 'denied' | 'configuration_required';
}

export interface PlaybookDryRunStep {
  stepId: string;
  status: 'ready' | 'waiting_for_approval' | 'configuration_required';
  reasonCodes: string[];
  maxAttempts: number;
}

export interface PlaybookDryRunResult {
  valid: boolean;
  outcome: 'ready' | 'waiting_for_approval' | 'configuration_required' | 'invalid';
  steps: PlaybookDryRunStep[];
  errors: string[];
}

export interface PlaybookRunResult {
  outcome: 'completed' | 'failed' | 'waiting_for_approval' | 'configuration_required';
  run: PlaybookRunV2;
  reasonCodes: string[];
}

const MAX_ATTEMPTS = 3;
const MAX_TIMEOUT_MS = 120_000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('PLAYBOOK_STEP_TIMEOUT')), Math.min(timeoutMs, MAX_TIMEOUT_MS));
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}

export class PlaybookService {
  constructor(
    private readonly persistence: Phase4Persistence,
    private readonly adapter?: PlaybookExecutionAdapter,
    private readonly approvalEvaluator?: PlaybookApprovalEvaluator,
  ) {}

  register(definition: PlaybookDefinitionV2): PlaybookDefinitionV2 {
    const parsed = parsePlaybookDefinitionV2(definition);
    if (parsed.success === false) throw new Error(`${parsed.errorCode}: ${parsed.message}`);
    if (!parsed.value.steps?.length) throw new Error('PLAYBOOK_STEPS_REQUIRED: Operational playbooks require concrete V2.1 steps.');
    this.persistence.savePlaybookDefinition(parsed.value);
    return parsed.value;
  }

  dryRun(definition: PlaybookDefinitionV2, approvals: ReadonlySet<string> = new Set()): PlaybookDryRunResult {
    const parsed = parsePlaybookDefinitionV2(definition);
    if (parsed.success === false) return { valid: false, outcome: 'invalid', steps: [], errors: [parsed.errorCode] };
    if (!parsed.value.steps?.length) return { valid: false, outcome: 'invalid', steps: [], errors: ['PLAYBOOK_STEPS_REQUIRED'] };
    const steps = parsed.value.steps.map((step): PlaybookDryRunStep => {
      const reasons: string[] = [];
      if (step.approval === 'owner' && !approvals.has(step.stepId)) reasons.push('APPROVAL_REQUIRED');
      if (step.approval === 'policy') {
        const decision = this.approvalEvaluator?.evaluate(step) ?? 'configuration_required';
        if (decision === 'denied') reasons.push('POLICY_APPROVAL_DENIED');
        if (decision === 'configuration_required') reasons.push('POLICY_APPROVAL_CONFIGURATION_REQUIRED');
      }
      if (step.tools.length && !this.adapter?.available) reasons.push('EXECUTION_ADAPTER_CONFIGURATION_REQUIRED');
      if (step.verification.required && !this.adapter?.available) reasons.push('VERIFIER_CONFIGURATION_REQUIRED');
      return {
        stepId: step.stepId,
        status: reasons.includes('APPROVAL_REQUIRED') ? 'waiting_for_approval' : reasons.length ? 'configuration_required' : 'ready',
        reasonCodes: reasons,
        maxAttempts: Math.min(MAX_ATTEMPTS, step.retry.maxAttempts),
      };
    });
    const outcome = steps.some((step) => step.status === 'waiting_for_approval')
      ? 'waiting_for_approval'
      : steps.some((step) => step.status === 'configuration_required') ? 'configuration_required' : 'ready';
    return { valid: true, outcome, steps, errors: [] };
  }

  async run(playbookId: string, options: { version?: string; taskId?: string; input?: Record<string, unknown>; approvedStepIds?: string[] } = {}): Promise<PlaybookRunResult> {
    const definition = this.persistence.getPlaybookDefinition(playbookId, options.version);
    if (!definition) return this.missingDefinition(playbookId, options.version);
    const approvals = new Set(options.approvedStepIds ?? []);
    const dryRun = this.dryRun(definition, approvals);
    const run: PlaybookRunV2 = {
      contractVersion: TASK_CONTRACT_VERSION,
      amendment: EDITH_CONTRACT_AMENDMENT,
      runId: `playbook-run-${randomUUID()}`,
      playbook: { playbookId: definition.playbookId, version: definition.version },
      taskId: options.taskId,
      status: dryRun.outcome === 'ready' ? 'running' : 'failed',
      startedAt: new Date().toISOString(),
      stepRuns: [],
    };
    if (dryRun.outcome !== 'ready') {
      run.completedAt = new Date().toISOString();
      this.persistence.savePlaybookRun(run);
      return {
        outcome: dryRun.outcome === 'waiting_for_approval' ? 'waiting_for_approval' : 'configuration_required',
        run,
        reasonCodes: dryRun.steps.flatMap((step) => step.reasonCodes),
      };
    }
    if (!this.adapter?.available || !definition.steps) {
      run.status = 'failed';
      run.completedAt = new Date().toISOString();
      this.persistence.savePlaybookRun(run);
      return { outcome: 'configuration_required', run, reasonCodes: ['EXECUTION_ADAPTER_CONFIGURATION_REQUIRED'] };
    }

    const completed = new Set<string>();
    for (const step of definition.steps) {
      if (step.dependsOn.some((dependency) => !completed.has(dependency))) {
        run.stepRuns?.push({ stepId: step.stepId, status: 'skipped', attempt: 1, errorCode: 'DEPENDENCY_NOT_COMPLETED' });
        return this.failRun(run, definition, ['DEPENDENCY_NOT_COMPLETED']);
      }
      run.currentStepId = step.stepId;
      const maxAttempts = Math.min(MAX_ATTEMPTS, step.retry.maxAttempts);
      let finalResult: PlaybookStepExecutionResult | undefined;
      let attempt = 0;
      for (attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const startedAt = new Date().toISOString();
        try {
          finalResult = await withTimeout(this.adapter.execute(step, options.input ?? {}, { runId: run.runId, attempt }), step.timeoutMs);
        } catch (error) {
          finalResult = { success: false, retryable: true, errorCode: error instanceof Error ? error.message : 'PLAYBOOK_STEP_ERROR' };
        }
        const verified = !step.verification.required || finalResult.verificationStatus === 'PASS';
        if (finalResult.success && verified) {
          run.stepRuns?.push({
            stepId: step.stepId,
            status: 'completed',
            attempt,
            startedAt,
            completedAt: new Date().toISOString(),
            outputArtifactIds: finalResult.artifactIds ?? [],
            verificationStatus: finalResult.verificationStatus,
            undoStatus: step.undo.supported ? 'available' : 'not_required',
          });
          completed.add(step.stepId);
          break;
        }
        const errorCode = finalResult.errorCode ?? (verified ? 'PLAYBOOK_STEP_FAILED' : 'VERIFICATION_FAILED');
        const canRetry = attempt < maxAttempts && (finalResult.retryable || finalResult.verificationStatus === 'RETRYABLE')
          && (step.retry.retryableErrorCodes.length === 0 || step.retry.retryableErrorCodes.includes(errorCode));
        if (!canRetry) {
          run.stepRuns?.push({
            stepId: step.stepId,
            status: 'failed',
            attempt,
            startedAt,
            completedAt: new Date().toISOString(),
            errorCode,
            verificationStatus: finalResult.verificationStatus,
            undoStatus: step.undo.supported ? 'available' : 'not_required',
          });
          return this.failRun(run, definition, [errorCode]);
        }
        run.stepRuns?.push({
          stepId: step.stepId,
          status: 'failed',
          attempt,
          startedAt,
          completedAt: new Date().toISOString(),
          errorCode,
          verificationStatus: finalResult.verificationStatus,
          undoStatus: 'not_required',
        });
        if (step.retry.backoffMs > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(step.retry.backoffMs, 1_000)));
      }
    }
    run.status = 'completed';
    run.currentStepId = undefined;
    run.completedAt = new Date().toISOString();
    const parsed = parsePlaybookRunV2(run, definition);
    if (parsed.success === false) throw new Error(`${parsed.errorCode}: ${parsed.message}`);
    this.persistence.savePlaybookRun(parsed.value);
    return { outcome: 'completed', run: parsed.value, reasonCodes: [] };
  }

  async undo(runId: string): Promise<PlaybookRunResult> {
    const run = this.persistence.getPlaybookRun(runId);
    if (!run) return this.missingDefinition('unknown');
    const definition = this.persistence.getPlaybookDefinition(run.playbook.playbookId, run.playbook.version);
    if (!definition?.steps || !this.adapter?.available || !this.adapter.undo) {
      return { outcome: 'configuration_required', run, reasonCodes: ['UNDO_ADAPTER_CONFIGURATION_REQUIRED'] };
    }
    const byId = new Map(definition.steps.map((step) => [step.stepId, step]));
    for (const stepRun of [...(run.stepRuns ?? [])].reverse()) {
      if (stepRun.undoStatus !== 'available') continue;
      const step = byId.get(stepRun.stepId);
      if (!step?.undo.supported) continue;
      const result = await this.adapter.undo(step, run);
      stepRun.undoStatus = result.success ? 'completed' : 'failed';
      if (!result.success) {
        this.persistence.savePlaybookRun(run);
        return { outcome: 'failed', run, reasonCodes: [result.errorCode ?? 'UNDO_FAILED'] };
      }
    }
    this.persistence.savePlaybookRun(run);
    return { outcome: 'completed', run, reasonCodes: [] };
  }

  private failRun(run: PlaybookRunV2, definition: PlaybookDefinitionV2, reasonCodes: string[]): PlaybookRunResult {
    run.status = 'failed';
    run.completedAt = new Date().toISOString();
    const parsed = parsePlaybookRunV2(run, definition);
    if (parsed.success === false) throw new Error(`${parsed.errorCode}: ${parsed.message}`);
    this.persistence.savePlaybookRun(parsed.value);
    return { outcome: 'failed', run: parsed.value, reasonCodes };
  }

  private missingDefinition(playbookId: string, version?: string): PlaybookRunResult {
    const now = new Date().toISOString();
    return {
      outcome: 'configuration_required',
      run: {
        contractVersion: TASK_CONTRACT_VERSION,
        amendment: EDITH_CONTRACT_AMENDMENT,
        runId: `playbook-run-${randomUUID()}`,
        playbook: { playbookId, version: version ?? 'unconfigured' },
        status: 'failed',
        startedAt: now,
        completedAt: now,
        stepRuns: [],
      },
      reasonCodes: ['PLAYBOOK_DEFINITION_NOT_FOUND'],
    };
  }
}
