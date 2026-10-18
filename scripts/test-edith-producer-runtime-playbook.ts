import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { TASK_CONTRACT_VERSION, EDITH_CONTRACT_AMENDMENT, type PlaybookStepV2 } from '../src/edith/contracts';
import { edithToolRegistry } from '../src/edith/serverRegistry';
import { permissionService } from '../src/edith/permissionService';
import { killSwitchService } from '../src/edith/killSwitch';
import { RegistryPlaybookExecutionAdapter, SYSTEM_MONITOR_VERIFIER_ID, SYSTEM_MONITOR_VERIFICATION_OBJECTIVE, SYSTEM_MONITOR_VERIFICATION_CRITERIA, type PlaybookPostconditionVerifier } from '../src/edith/playbookExecutionAdapter';

async function main() {
  assert.equal(process.env.EDITH_TEST_MODE, 'true');
  assert.ok(process.env.EDITH_TEST_DATA_DIR);
  const effectPath = path.join(process.env.EDITH_TEST_DATA_DIR!, 'playbook-effect.txt');
  let toolCalls = 0;
  let readbacks = 0;
  edithToolRegistry.register({
    id: 'producer-fixture-effect',
    metadata: { name: 'Bounded fixture effect', version: '1', description: 'Writes one isolated test file', category: 'file',
      inputSchema: { value: { type: 'string', required: true } }, outputSchema: {}, requiredPermissions: ['file:write'],
      riskLevel: 3, timeoutMs: 1000, retryLimit: 0, supportsDryRun: false, supportsRollback: false, platforms: [], dependencies: [] },
    handler(args) {
      toolCalls++;
      fs.writeFileSync(effectPath, String(args.value), 'utf8');
      // Deliberately successful even when the actual effect violates the goal.
      return { success: true, toolId: 'producer-fixture-effect', result: 'helper.log.success' };
    },
  });
  const verifier: PlaybookPostconditionVerifier = {
    verifierId: 'fixture-file-readback-v1',
    supports: (step) => step.tools.length === 1 && step.tools[0] === 'producer-fixture-effect'
      && step.objective === 'Write exactly expected bytes' && step.verification.criteria.length === 1
      && step.verification.criteria[0] === 'isolated-file-content-equals-expected',
    async verify() {
      readbacks++;
      const bytes = fs.readFileSync(effectPath);
      return { passed: bytes.toString('utf8') === 'expected', evidenceIds: [`postcondition:fixture-file-readback-v1:${createHash('sha256').update(bytes).digest('hex')}`] };
    },
  };
  let active = true;
  const adapter = new RegistryPlaybookExecutionAdapter((binding) => active && binding === 'fixture-owner', [verifier]);
  const step: PlaybookStepV2 = {
    contractVersion: TASK_CONTRACT_VERSION, amendment: EDITH_CONTRACT_AMENDMENT,
    stepId: 'effect', title: 'Write and verify', objective: 'Write exactly expected bytes', dependsOn: [], inputSchema: {}, outputSchema: {}, skills: [],
    tools: ['producer-fixture-effect'], permissions: ['file:write'], riskLevel: 3, approval: 'owner', timeoutMs: 2000,
    retry: { maxAttempts: 1, backoffMs: 0, retryableErrorCodes: [] },
    verification: { required: true, criteria: ['isolated-file-content-equals-expected'], verifierId: verifier.verifierId }, undo: { supported: false },
  };
  const context = { runId: 'fixture-run', attempt: 1, ownerSessionBindingId: 'fixture-owner' };
  permissionService.updatePolicy({ mode: 'full_access', updatedBy: 'fixture' });
  assert.ok(adapter.preflight(step).includes('APPROVAL_REQUIRED'), 'High-risk full access still requires an active server grant');
  const grant = permissionService.createGrant({ actor: 'owner', permissions: ['file:write'], toolIds: step.tools, reason: 'Isolated bounded fixture', grantedBy: 'fixture' });
  assert.deepEqual(adapter.preflight(step), []);
  const passed = await adapter.execute(step, { value: 'expected' }, context);
  assert.equal(passed.verificationStatus, 'PASS');
  assert.equal(passed.success, true);
  assert.ok(passed.artifactIds?.some((id) => id.startsWith('postcondition:fixture-file-readback-v1:')));
  assert.equal(fs.readFileSync(effectPath, 'utf8'), 'expected');
  const failed = await adapter.execute(step, { value: 'wrong' }, context);
  assert.equal(failed.success, false);
  assert.equal(failed.verificationStatus, 'FAIL');
  assert.equal(failed.errorCode, 'POSTCONDITION_VERIFICATION_FAILED');
  assert.equal(toolCalls, 2);
  assert.equal(readbacks, 2);
  const unknownGoal = { ...step, objective: 'An arbitrary client goal' };
  assert.ok(adapter.preflight(unknownGoal).includes('VERIFIER_CONFIGURATION_REQUIRED'));
  await assert.rejects(adapter.execute(unknownGoal, { value: 'expected' }, context), /VERIFIER_CONFIGURATION_REQUIRED/);
  assert.equal(toolCalls, 2, 'Unsupported verifier fails before effects');
  assert.ok(adapter.preflight({ ...step, tools: ['unregistered'] }).includes('UNKNOWN_CANONICAL_TOOL'));
  await assert.rejects(adapter.execute(step, {}, { ...context, ownerSessionBindingId: undefined }), /OWNER_SESSION_REQUIRED/);
  active = false;
  await assert.rejects(adapter.execute(step, {}, context), /OWNER_SESSION_REQUIRED/);
  active = true;
  permissionService.revokeGrant(grant.id, 'fixture');
  await assert.rejects(adapter.execute(step, {}, context), /APPROVAL_REQUIRED/);
  permissionService.updatePolicy({ mode: 'deny', updatedBy: 'fixture' });
  await assert.rejects(adapter.execute(step, {}, context), /PERMISSION_DENIED/);
  const systemStep = { ...step, objective: SYSTEM_MONITOR_VERIFICATION_OBJECTIVE, tools: ['system_monitor'], riskLevel: 0 as const, approval: 'none' as const, permissions: ['system:read'],
    verification: { required: true, verifierId: SYSTEM_MONITOR_VERIFIER_ID, criteria: [...SYSTEM_MONITOR_VERIFICATION_CRITERIA] } };
  const system = await adapter.execute(systemStep, {}, context);
  assert.equal(system.verificationStatus, 'PASS');
  assert.ok(system.artifactIds?.some((id) => id.startsWith(`postcondition:${SYSTEM_MONITOR_VERIFIER_ID}:`)));
  killSwitchService.activate('Isolated fixture stop', 'fixture');
  await assert.rejects(adapter.execute(systemStep, {}, context), /kill switch is active/);
  killSwitchService.deactivate('fixture');
  assert.equal(toolCalls, 2);
  console.log(JSON.stringify({ checks: ['actual_file_effect_and_independent_readback', 'successful_tool_wrong_postcondition_fails', 'unsupported_goal_before_effect', 'unknown_tool', 'owner_revoked_missing', 'grant_and_policy_denial', 'canonical_system_os_readback', 'kill_switch'], toolCalls, independentReadbacks: readbacks, modelCalls: 0 }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
