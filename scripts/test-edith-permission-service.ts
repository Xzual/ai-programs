import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'edith-permission-service-test-'));
const originalCwd = process.cwd();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function removeTempRoot(): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EBUSY') throw error;
      if (attempt === 4) {
        console.warn(`Temp cleanup skipped because Windows still holds a SQLite handle: ${tempRoot}`);
        return;
      }
      await sleep(200 * (attempt + 1));
    }
  }
}

try {
  process.chdir(tempRoot);
  process.env.EDITH_PERSISTENCE = 'sqlite';
  delete process.env.EDITH_ENABLE_HIGH_RISK_TOOLS;

  const { permissionService } = await import('../src/edith/permissionService');
  const { edithToolRegistry, executeEdithTool, getEdithToolHealth } = await import('../src/edith/serverRegistry');
  const { readRecentAuditEvents } = await import('../src/edith/audit');
  const { getEdithPersistenceStore } = await import('../src/edith/persistence');

  const systemTool = edithToolRegistry.get('system_monitor');
  const browserTool = edithToolRegistry.get('playwright_browser_agent');
  const computerTool = edithToolRegistry.get('computer_control_agent');
  assert.ok(systemTool);
  assert.ok(browserTool);
  assert.ok(computerTool);

  const localDecision = permissionService.decideToolExecution({
    tool: systemTool,
    actor: 'permission-test',
  });
  const deniedDecision = permissionService.decideToolExecution({
    tool: browserTool,
    actor: 'permission-test',
  });
  const deniedRun = await executeEdithTool('playwright_browser_agent', { url: 'https://example.com' }, {
    actor: 'permission-test',
  });
  const health = getEdithToolHealth();

  process.env.EDITH_ENABLE_HIGH_RISK_TOOLS = 'true';
  const elevatedDecision = permissionService.decideToolExecution({
    tool: browserTool,
    actor: 'permission-test',
  });
  const explicitDecision = permissionService.decideToolExecution({
    tool: browserTool,
    actor: 'permission-test',
    authorizedPermissions: ['network:read', 'browser:control'],
  });
  delete process.env.EDITH_ENABLE_HIGH_RISK_TOOLS;

  const grant = permissionService.createGrant({
    actor: 'permission-test',
    permissions: ['computer:control', 'system:exec'],
    toolIds: ['computer_control_agent'],
    reason: 'Regression scoped computer-control grant.',
    grantedBy: 'test',
    ttlMs: 60_000,
  });
  const grantDecision = permissionService.decideToolExecution({
    tool: computerTool,
    actor: 'permission-test',
  });
  const otherActorDecision = permissionService.decideToolExecution({
    tool: computerTool,
    actor: 'other-actor',
  });
  const grantedRun = await executeEdithTool('computer_control_agent', { instruction: 'inspect desktop status' }, {
    actor: 'permission-test',
  });
  const revokedGrant = permissionService.revokeGrant(grant.id, 'test');
  const revokedDecision = permissionService.decideToolExecution({
    tool: computerTool,
    actor: 'permission-test',
  });
  const allGrants = permissionService.listGrants({ includeRevoked: true, includeExpired: true });
  const denyPolicy = permissionService.updatePolicy({ mode: 'deny', updatedBy: 'test' });
  const denyReadDecision = permissionService.decideToolExecution({
    tool: systemTool,
    actor: 'permission-test',
  });
  const denyWriteDecision = permissionService.decideToolExecution({
    tool: computerTool,
    actor: 'permission-test',
  });
  const fullPolicy = permissionService.updatePolicy({ mode: 'full_access', updatedBy: 'test' });
  const fullComputerDecision = permissionService.decideToolExecution({
    tool: computerTool,
    actor: 'other-actor',
  });
  const askPolicy = permissionService.updatePolicy({ mode: 'ask', updatedBy: 'test' });
  const askComputerDecision = permissionService.decideToolExecution({
    tool: computerTool,
    actor: 'other-actor',
  });
  const auditEvents = readRecentAuditEvents(1000);

  assert.equal(localDecision.status, 'ALLOW');
  assert.equal(localDecision.highRisk, false);
  assert.equal(deniedDecision.status, 'DENY');
  assert.equal(deniedDecision.highRisk, true);
  assert.deepEqual(deniedDecision.missingPermissions, ['browser:control']);
  assert.equal(deniedRun.success, false);
  assert.equal(deniedRun.errorCode, 'PERMISSION_DENIED');
  assert.equal((deniedRun.structuredOutput?.permissionDecision as { status?: string } | undefined)?.status, 'DENY');
  assert.equal(health.find((item) => item.toolId === 'playwright_browser_agent')?.enabled, false);
  assert.equal(elevatedDecision.status, 'ALLOW');
  assert.equal(explicitDecision.status, 'ALLOW');
  assert.equal(grantDecision.status, 'ALLOW');
  assert.deepEqual(grantDecision.activeGrantIds, [grant.id]);
  assert.equal(otherActorDecision.status, 'DENY');
  assert.equal(grantedRun.errorCode, 'TOOL_ERROR');
  assert.equal(grantedRun.structuredOutput?.capability, 'CONFIGURATION_REQUIRED');
  assert.equal(revokedGrant?.revokedBy, 'test');
  assert.equal(revokedDecision.status, 'DENY');
  assert.equal(allGrants.some((candidate) => candidate.id === grant.id && candidate.revokedAt), true);
  assert.equal(denyPolicy.mode, 'deny');
  assert.equal(denyReadDecision.status, 'ALLOW');
  assert.equal(denyWriteDecision.status, 'DENY');
  assert.equal(fullPolicy.mode, 'full_access');
  assert.equal(fullComputerDecision.status, 'ALLOW');
  assert.equal(askPolicy.mode, 'ask');
  assert.equal(askComputerDecision.status, 'DENY');
  assert.equal(auditEvents.some((event) => event.action === 'permission.grant'), true);
  assert.equal(auditEvents.some((event) => event.action === 'permission.revoke'), true);
  assert.equal(auditEvents.some((event) => event.action === 'permission.policy.update'), true);

  getEdithPersistenceStore().close?.();

  console.log(JSON.stringify({
    success: true,
    scenarios: [
      'local_permission_allow',
      'high_risk_permission_deny',
      'denied_tool_includes_decision',
      'health_uses_permission_service',
      'env_high_risk_allow',
      'explicit_permission_allow',
      'scoped_permission_grant',
      'grant_revoke',
      'grant_audit',
      'policy_deny_read_only',
      'policy_full_access_allows_high_risk',
      'policy_ask_restores_grant_flow',
    ],
    deniedMissingPermissions: deniedDecision.missingPermissions,
  }, null, 2));
} finally {
  process.chdir(originalCwd);
  await removeTempRoot();
}
