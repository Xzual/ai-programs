import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'edith-planner-test-'));
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

  const { taskService } = await import('../src/edith/taskService');
  const { plannerService } = await import('../src/edith/planner');
  const { readRecentAuditEvents } = await import('../src/edith/audit');
  const { getEdithPersistenceStore } = await import('../src/edith/persistence');

  const task = taskService.createTask({
    title: 'Local health report',
    objective: 'Create a local system health report with CPU and RAM status',
    originalUserRequest: 'Create a task to prepare a local system health report.',
    riskLevel: 1,
  });

  const result = plannerService.planTask(task.id);
  const reloaded = taskService.getTask(task.id);
  const auditEvents = readRecentAuditEvents(10);

  assert.equal(result.success, true);
  assert.equal(result.plan?.status, 'READY');
  assert.equal(result.plan?.requiredTools.includes('system_monitor'), true);
  assert.equal(result.plan?.requiredPermissions.includes('system:read'), true);
  assert.equal(result.plan?.requiredAgents.includes('orchestrator'), true);
  assert.equal(result.plan?.requiredAgents.includes('planning'), true);
  assert.equal(result.plan?.steps.length, 3);
  assert.equal(result.plan?.steps[0].status, 'READY');
  assert.equal(result.plan?.steps[1].dependsOn.includes(result.plan.steps[0].id), true);
  assert.equal(result.plan?.validationCriteria.some((rule) => rule.includes('original objective')), true);
  assert.equal(reloaded?.plan?.id, result.plan?.id);
  assert.equal(reloaded?.status, 'PLANNING');
  assert.equal(reloaded?.toolsRequired.includes('system_monitor'), true);
  assert.equal(reloaded?.permissionsRequired.includes('system:read'), true);
  assert.equal(reloaded?.subtasks.length, result.plan?.steps.length);
  assert.equal(auditEvents.some((event) => event.action === 'task.plan'), true);

  getEdithPersistenceStore().close?.();

  console.log(JSON.stringify({
    success: true,
    taskId: task.id,
    planId: result.plan?.id,
    steps: result.plan?.steps.length,
    requiredTools: result.plan?.requiredTools,
    scenarios: ['plan_task', 'tool_selection', 'dependencies', 'validation_criteria', 'persisted_plan', 'audit'],
  }, null, 2));
} finally {
  process.chdir(originalCwd);
  await removeTempRoot();
}
