import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'edith-sensitive-integrations-test-'));
const originalCwd = process.cwd();

try {
  process.chdir(tempRoot);
  process.env.EDITH_PERSISTENCE = 'json';
  delete process.env.EDITH_ENABLE_HIGH_RISK_TOOLS;

  const { sensitiveIntegrationService } = await import('../src/edith/sensitiveIntegrationService');
  const { executeEdithTool, edithToolRegistry } = await import('../src/edith/serverRegistry');
  const { permissionService } = await import('../src/edith/permissionService');
  const { killSwitchService } = await import('../src/edith/killSwitch');
  const { taskService } = await import('../src/edith/taskService');
  const { plannerService } = await import('../src/edith/planner');
  const { readRecentAuditEvents } = await import('../src/edith/audit');

  killSwitchService.deactivate('sensitive-test-setup');

  const capabilities = sensitiveIntegrationService.capabilities();
  assert.equal(capabilities.length, 2);
  assert.equal(capabilities.every((capability) => capability.status === 'configuration_required'), true);
  assert.ok(edithToolRegistry.get('iot_feedback_stub'));
  assert.ok(edithToolRegistry.get('finance_trading_guard'));

  const deniedIot = await executeEdithTool('iot_feedback_stub', {
    action: 'light_feedback',
    target: 'desk',
    dryRun: true,
  }, { actor: 'sensitive-test' });
  assert.equal(deniedIot.success, false);
  assert.equal(deniedIot.errorCode, 'PERMISSION_DENIED');

  const deniedFinance = await executeEdithTool('finance_trading_guard', {
    action: 'live_order',
    target: 'BTC',
    dryRun: true,
  }, { actor: 'sensitive-test' });
  assert.equal(deniedFinance.success, false);
  assert.equal(deniedFinance.errorCode, 'PERMISSION_DENIED');

  const directDeniedIot = sensitiveIntegrationService.run('iot', {
    action: 'notify',
    target: 'desk',
    dryRun: true,
  }, 'direct-sensitive-test');
  assert.equal(directDeniedIot.errorCode, 'PERMISSION_DENIED');

  const grant = permissionService.createGrant({
    actor: 'sensitive-test',
    permissions: ['iot:control'],
    toolIds: ['iot_feedback_stub'],
    reason: 'Regression scoped IoT grant.',
    grantedBy: 'test',
    ttlMs: 60_000,
  });
  const configuredRequiredIot = await executeEdithTool('iot_feedback_stub', {
    action: 'light_feedback',
    target: 'desk',
    dryRun: true,
  }, { actor: 'sensitive-test' });
  assert.equal(configuredRequiredIot.success, false);
  assert.equal(configuredRequiredIot.errorCode, 'TOOL_ERROR');
  assert.equal(configuredRequiredIot.structuredOutput?.honestStatus, 'No IoT, broker, exchange, bank, or trading action was executed.');
  assert.equal(
    ((configuredRequiredIot.structuredOutput?.capability as { id?: string })?.id),
    'iot_feedback_stub'
  );
  assert.ok(grant.id);

  killSwitchService.activate('Block trading regression.', 'sensitive-test');
  const blockedFinance = sensitiveIntegrationService.run('finance', {
    action: 'paper_order',
    target: 'ETH',
    dryRun: true,
  }, 'sensitive-test');
  assert.equal(blockedFinance.errorCode, 'PERMISSION_DENIED');
  assert.equal(blockedFinance.structuredOutput?.disabledCapability, 'trading_execution');
  killSwitchService.deactivate('sensitive-test');

  const task = taskService.createTask({
    title: 'Sensitive planner regression',
    objective: 'IoT akıllı ev ışık feedback ve finance trading order guard planla',
    originalUserRequest: 'Akıllı ev ve trading entegrasyonlarını güvenli planla.',
    riskLevel: 5,
  });
  const planned = plannerService.planTask(task.id);
  assert.equal(planned.plan?.requiredTools.includes('iot_feedback_stub'), true);
  assert.equal(planned.plan?.requiredTools.includes('finance_trading_guard'), true);
  assert.equal(planned.plan?.requiredPermissions.includes('iot:control'), true);
  assert.equal(planned.plan?.requiredPermissions.includes('trading:execute'), true);

  const audits = readRecentAuditEvents(1000);
  assert.equal(audits.some((event) => event.action === 'sensitive_integration.permission_denied'), true);
  assert.equal(audits.some((event) => event.action === 'sensitive_integration.dry_run'), true);
  assert.equal(audits.some((event) => event.action === 'sensitive_integration.blocked_by_kill_switch'), true);

  console.log(JSON.stringify({
    success: true,
    scenarios: [
      'capability_catalog',
      'registry_tools',
      'default_iot_denied',
      'default_finance_denied',
      'scoped_iot_grant_reaches_configuration_required',
      'kill_switch_blocks_trading',
      'planner_selects_sensitive_tools',
      'audit',
    ],
  }, null, 2));
} finally {
  process.chdir(originalCwd);
  try {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  } catch {
    // Cleanup is best-effort on Windows.
  }
}
