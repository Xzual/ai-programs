import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'edith-recovery-test-'));
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
  const { verificationService } = await import('../src/edith/verifier');
  const { recoveryService } = await import('../src/edith/recovery');
  const { getEdithPersistenceStore } = await import('../src/edith/persistence');
  const { readRecentAuditEvents } = await import('../src/edith/audit');

  const task = taskService.createTask({
    title: 'Recovery regression',
    objective: 'Create a local system health report with CPU and RAM status',
    originalUserRequest: 'Create a task to prepare a local system health report.',
    riskLevel: 1,
  });
  const planned = plannerService.planTask(task.id);
  assert.equal(planned.success, true);
  taskService.updateStatus(task.id, 'VERIFYING', 'Forced verifier boundary without execution evidence.');

  const verified = verificationService.verifyTask(task.id);
  assert.equal(verified.success, false);
  assert.equal(verified.status, 'RETRYABLE');
  assert.equal(taskService.getTask(task.id)?.status, 'RETRYING');

  const recovered = recoveryService.recoverTask(task.id);
  const reloaded = taskService.getTask(task.id);
  const auditEvents = readRecentAuditEvents(1000);

  assert.equal(recovered.success, true);
  assert.equal(recovered.action, 'REPLAN');
  assert.equal(recovered.classification, 'VERIFICATION_RETRYABLE');
  assert.equal(recovered.attempt, 1);
  assert.equal(reloaded?.status, 'QUEUED');
  assert.notEqual(reloaded?.plan?.id, planned.plan?.id);
  assert.equal(reloaded?.plan?.status, 'READY');
  assert.equal(reloaded?.plan?.steps[0]?.status, 'READY');
  assert.equal(reloaded?.verification, undefined);
  assert.equal(reloaded?.recoveryEvents?.length, 1);
  assert.equal(reloaded?.recoveryEvents?.[0]?.previousPlanId, planned.plan?.id);
  assert.equal(reloaded?.recoveryEvents?.[0]?.newPlanId, reloaded?.plan?.id);
  assert.equal(auditEvents.some((event) => event.taskId === task.id && event.action === 'task.recover'), true);

  const permissionTask = taskService.createTask({
    title: 'Permission recovery regression',
    objective: 'Open a high risk desktop controller',
    originalUserRequest: 'Use computer control.',
    toolsRequired: ['computer_control_agent'],
    riskLevel: 5,
  });
  taskService.updateStatus(permissionTask.id, 'WAITING_PERMISSION', 'Permission denied.');
  const permissionRecovery = recoveryService.recoverTask(permissionTask.id);
  const permissionReloaded = taskService.getTask(permissionTask.id);

  assert.equal(permissionRecovery.success, false);
  assert.equal(permissionRecovery.action, 'WAIT_PERMISSION');
  assert.equal(permissionRecovery.classification, 'PERMISSION_DENIED');
  assert.equal(permissionReloaded?.status, 'WAITING_PERMISSION');
  assert.equal(permissionReloaded?.recoveryEvents?.length, 1);

  getEdithPersistenceStore().close?.();

  console.log(JSON.stringify({
    success: true,
    taskId: task.id,
    status: reloaded?.status,
    action: recovered.action,
    classification: recovered.classification,
    recoveryEvents: reloaded?.recoveryEvents?.length,
    permissionAction: permissionRecovery.action,
    scenarios: ['retryable_verification', 'replan', 'persist_recovery', 'audit', 'permission_wait'],
  }, null, 2));
} finally {
  process.chdir(originalCwd);
  await removeTempRoot();
}
