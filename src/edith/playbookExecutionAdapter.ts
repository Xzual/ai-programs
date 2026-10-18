import type { PlaybookStepV2 } from './contracts';
import type { PlaybookApprovalEvaluator, PlaybookExecutionAdapter, PlaybookStepExecutionResult } from './playbookService';
import { edithToolRegistry, executeEdithTool } from './serverRegistry';
import { permissionService } from './permissionService';
import { killSwitchService } from './killSwitch';
import { getEdithPersistenceStore } from './persistence';
import { ownerSessionBindingActive } from '../../server/security/ownerSession';
import { readRecentAuditEvents } from './audit';
import os from 'node:os';
import { createHash } from 'node:crypto';
import type { EdithToolResult } from './core';

/** Registered by server composition only. Client criteria never become code or file paths. */
export interface PlaybookPostconditionVerifier {
  readonly verifierId: string;
  supports(step: PlaybookStepV2): boolean;
  verify(step: PlaybookStepV2, results: ReadonlyArray<EdithToolResult>): Promise<{ passed: boolean; evidenceIds: string[] }>;
}

export const SYSTEM_MONITOR_VERIFIER_ID = 'canonical-system-monitor-v1';
export const SYSTEM_MONITOR_VERIFICATION_OBJECTIVE = 'Verify the local system monitor snapshot';
export const SYSTEM_MONITOR_VERIFICATION_CRITERIA = [
  'system.hostname_matches_local', 'system.platform_matches_local', 'system.memory_total_matches_local',
] as const;

const systemMonitorVerifier: PlaybookPostconditionVerifier = {
  verifierId: SYSTEM_MONITOR_VERIFIER_ID,
  supports: (step) => step.tools.length === 1 && step.tools[0] === 'system_monitor'
    && step.objective === SYSTEM_MONITOR_VERIFICATION_OBJECTIVE
    && step.verification.criteria.length > 0
    && step.verification.criteria.every((criterion) => SYSTEM_MONITOR_VERIFICATION_CRITERIA.some((supported) => supported === criterion)),
  async verify(step, results) {
    // A second operating-system observation establishes the declared postconditions.
    // Tool success and its audit record remain execution evidence only.
    const observed = { hostname: os.hostname(), platform: os.platform(), total: `${(os.totalmem() / 1024 ** 3).toFixed(1)} GB` };
    const output = results[0]?.structuredOutput;
    const checks: Record<string, boolean> = {
      'system.hostname_matches_local': output?.hostname === observed.hostname,
      'system.platform_matches_local': output?.platform === observed.platform,
      'system.memory_total_matches_local': (output?.memory as { total?: unknown } | undefined)?.total === observed.total,
    };
    const passed = step.verification.criteria.every((criterion) => checks[criterion] === true);
    const digest = createHash('sha256').update(JSON.stringify({ observed, checks, criteria: step.verification.criteria })).digest('hex');
    return { passed, evidenceIds: [`postcondition:${SYSTEM_MONITOR_VERIFIER_ID}:${digest}`] };
  },
};

export class RegistryPlaybookExecutionAdapter implements PlaybookExecutionAdapter, PlaybookApprovalEvaluator {
  readonly adapterId = 'canonical-registry-playbook-v1';
  readonly available = true;
  private readonly verifiers: ReadonlyMap<string, PlaybookPostconditionVerifier>;
  constructor(private readonly ownerActive = ownerSessionBindingActive, trustedVerifiers: ReadonlyArray<PlaybookPostconditionVerifier> = []) {
    const verifiers = new Map([[systemMonitorVerifier.verifierId, systemMonitorVerifier]]);
    for (const verifier of trustedVerifiers) {
      if (!verifier.verifierId || verifiers.has(verifier.verifierId)) throw new Error('DUPLICATE_POSTCONDITION_VERIFIER');
      verifiers.set(verifier.verifierId, verifier);
    }
    this.verifiers = verifiers;
  }

  private verifier(step: PlaybookStepV2): PlaybookPostconditionVerifier | undefined {
    const verifier = step.verification.verifierId && this.verifiers.get(step.verification.verifierId);
    return verifier && step.verification.criteria.length > 0 && verifier.supports(step) ? verifier : undefined;
  }

  preflight(step: PlaybookStepV2): string[] {
    const reasons: string[] = [];
    if (!step.tools.length) return ['EXECUTABLE_TOOL_REQUIRED'];
    if (!this.verifier(step)) reasons.push('VERIFIER_CONFIGURATION_REQUIRED');
    for (const id of step.tools) {
      const tool = edithToolRegistry.get(id);
      if (!tool) { reasons.push('UNKNOWN_CANONICAL_TOOL'); continue; }
      if (step.riskLevel < tool.metadata.riskLevel || tool.metadata.requiredPermissions.some((permission) => !step.permissions.includes(permission))) reasons.push('PLAYBOOK_TOOL_POLICY_UNDERSPECIFIED');
      const decision = permissionService.decideToolExecution({ tool: { ...tool, metadata: { ...tool.metadata, requiredPermissions: [...new Set([...tool.metadata.requiredPermissions, ...step.permissions])] } }, actor: 'owner' });
      if (decision.status !== 'ALLOW') reasons.push('PERMISSION_DENIED');
      if ((tool.metadata.riskLevel >= 3 || step.approval !== 'none') && !decision.activeGrantIds.length) reasons.push('APPROVAL_REQUIRED');
      if (step.undo.supported) reasons.push('UNDO_ADAPTER_CONFIGURATION_REQUIRED');
    }
    return [...new Set(reasons)];
  }

  evaluate(step: PlaybookStepV2): 'approved' | 'denied' | 'configuration_required' {
    const reasons = this.preflight(step);
    return reasons.length ? reasons.some((reason) => reason.includes('CONFIGURATION_REQUIRED') || reason === 'UNKNOWN_CANONICAL_TOOL') ? 'configuration_required' : 'denied' : 'approved';
  }

  async execute(step: PlaybookStepV2, input: Record<string, unknown>, context: { runId: string; attempt: number; ownerSessionBindingId?: string }): Promise<PlaybookStepExecutionResult> {
    const assert = () => {
      if (!context.ownerSessionBindingId || !this.ownerActive(context.ownerSessionBindingId)) throw new Error('OWNER_SESSION_REQUIRED');
      killSwitchService.assertAllowed('tool_execution', 'owner');
      const reasons = this.preflight(step);
      if (reasons.length) throw new Error(reasons.join(','));
    };
    assert();
    const artifacts: string[] = [];
    const results: EdithToolResult[] = [];
    for (const toolId of step.tools) {
      assert();
      const perStep = input[step.stepId];
      const args = perStep && typeof perStep === 'object' && !Array.isArray(perStep) ? perStep as Record<string, unknown> : input;
      const result = await executeEdithTool(toolId, args, { actor: 'owner' });
      assert();
      if (!result.success || !result.auditEventId) return { success: false, errorCode: result.errorCode ?? 'TOOL_EVIDENCE_REQUIRED', verificationStatus: 'FAIL' };
      const audit = readRecentAuditEvents(100).find((event) => event.id === result.auditEventId && event.toolId === toolId && event.result === 'success' && event.action === 'tool.execute');
      const run = getEdithPersistenceStore().listToolRuns?.(100)?.find((run) => run.toolId === toolId && run.timestamp === Date.parse(result.startedAt!) && run.status === 'success');
      if (!run || !audit) return { success: false, errorCode: 'TOOL_RUN_VERIFICATION_REQUIRED', verificationStatus: 'FAIL' };
      artifacts.push(`toolrun:${run.id}`, `audit:${result.auditEventId}`);
      results.push(result);
    }
    const verifier = this.verifier(step);
    if (!verifier) return { success: false, artifactIds: artifacts, errorCode: 'VERIFIER_CONFIGURATION_REQUIRED', verificationStatus: 'PARTIAL', retryable: false };
    const verification = await verifier.verify(step, results);
    assert();
    if (!verification.passed || !verification.evidenceIds.length || verification.evidenceIds.some((id) => !id || id.startsWith('audit:') || id.startsWith('toolrun:'))) {
      return { success: false, artifactIds: artifacts, errorCode: 'POSTCONDITION_VERIFICATION_FAILED', verificationStatus: 'FAIL', retryable: false };
    }
    return { success: true, artifactIds: [...artifacts, ...verification.evidenceIds], verificationStatus: 'PASS' };
  }
}
