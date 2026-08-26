import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'edith-capabilities-test-'));
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

  const { capabilityService } = await import('../src/edith/capabilityService');
  const { permissionService } = await import('../src/edith/permissionService');
  const { taskService } = await import('../src/edith/taskService');
  const { plannerService } = await import('../src/edith/planner');
  const { readRecentAuditEvents } = await import('../src/edith/audit');
  const { getEdithPersistenceStore } = await import('../src/edith/persistence');

  const healthAssessment = capabilityService.assess({
    objective: 'Create a local system health report with CPU and RAM status',
    actor: 'capability-test',
  });
  const blockedAssessment = capabilityService.assess({
    objective: 'Bilgisayarı kontrol et ve masaüstünde işlem yap',
    actor: 'capability-test',
    toolsRequired: ['computer_control_agent'],
    riskLevel: 5,
  });
  permissionService.createGrant({
    actor: 'capability-test',
    toolIds: ['computer_control_agent'],
    permissions: ['computer:control', 'system:exec'],
    reason: 'Regression test scoped high-risk grant.',
    grantedBy: 'test',
    ttlMs: 60_000,
  });
  const grantedAssessment = capabilityService.assess({
    objective: 'Bilgisayarı kontrol et ve masaüstünde işlem yap',
    actor: 'capability-test',
    toolsRequired: ['computer_control_agent'],
    riskLevel: 5,
  });
  const sensitiveAssessment = capabilityService.assess({
    objective: 'IoT akıllı ev ışık feedback ve finance trading order guard planla',
    actor: 'capability-test',
    riskLevel: 5,
  });

  const task = taskService.createTask({
    title: 'Capability-backed plan',
    objective: 'Create a local system health report with CPU and RAM status',
    originalUserRequest: 'Create a task to prepare a local system health report.',
    riskLevel: 1,
  });
  const planResult = plannerService.planTask(task.id);
  const auditEvents = readRecentAuditEvents(100);

  assert.equal(healthAssessment.status, 'READY');
  assert.equal(healthAssessment.runnableTools.includes('system_monitor'), true);
  assert.equal(healthAssessment.missingPermissions.length, 0);
  assert.equal(healthAssessment.agentRoutes.some((route) => route.agentId === 'orchestrator'), true);
  assert.equal(blockedAssessment.status, 'WAITING_PERMISSION');
  assert.equal(blockedAssessment.blockedTools.includes('computer_control_agent'), true);
  assert.equal(blockedAssessment.highRiskBlockedTools.includes('computer_control_agent'), true);
  assert.equal(blockedAssessment.missingPermissions.includes('computer:control'), true);
  assert.equal(grantedAssessment.status, 'DEGRADED');
  assert.equal(grantedAssessment.runnableTools.includes('computer_control_agent'), true);
  assert.equal(grantedAssessment.toolDecisions[0].activeGrantIds.length, 1);
  assert.equal(sensitiveAssessment.status, 'WAITING_PERMISSION');
  assert.equal(sensitiveAssessment.requestedTools.includes('iot_feedback_stub'), true);
  assert.equal(sensitiveAssessment.requestedTools.includes('finance_trading_guard'), true);
  assert.equal(sensitiveAssessment.missingPermissions.includes('iot:control'), true);
  assert.equal(sensitiveAssessment.missingPermissions.includes('trading:execute'), true);
  assert.equal(sensitiveAssessment.highRiskBlockedTools.includes('finance_trading_guard'), true);
  assert.equal(planResult.success, true);
  assert.equal(planResult.plan?.validationCriteria.some((rule) => rule.includes('Capability assessment')), true);
  assert.equal(auditEvents.some((event) => event.action === 'capability.assess'), true);

  getEdithPersistenceStore().close?.();

  console.log(JSON.stringify({
    success: true,
    assessments: {
      health: healthAssessment.status,
      blocked: blockedAssessment.status,
      granted: grantedAssessment.status,
      sensitive: sensitiveAssessment.status,
    },
    scenarios: ['low_risk_ready', 'high_risk_waiting_permission', 'scoped_grant_allows_tool', 'sensitive_integrations_waiting_permission', 'planner_uses_capability_assessment', 'audit'],
  }, null, 2));
} finally {
  process.chdir(originalCwd);
  await removeTempRoot();
}
