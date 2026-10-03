import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'edith-verifier-test-'));
const originalCwd = process.cwd();
let closePersistence: (() => void) | undefined;

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
  const { executorService } = await import('../src/edith/executor');
  const { verificationService } = await import('../src/edith/verifier');
  const { getEdithPersistenceStore } = await import('../src/edith/persistence');
  const { readRecentAuditEvents } = await import('../src/edith/audit');
  closePersistence = () => { getEdithPersistenceStore().close?.(); };

  const task = taskService.createTask({
    title: 'Verifier regression',
    objective: 'Create a local system health report with CPU and RAM status',
    originalUserRequest: 'Create a task to prepare a local system health report.',
    riskLevel: 1,
  });
  const planned = plannerService.planTask(task.id);
  assert.equal(planned.success, true);

  const prematureVerification = verificationService.verifyTask(task.id);
  const prematureReloaded = taskService.getTask(task.id);
  const prematureAudits = readRecentAuditEvents(1000).filter((event) => event.taskId === task.id && event.action === 'task.verify');
  assert.equal(prematureVerification.success, false);
  assert.equal(prematureVerification.status, 'RETRYABLE');
  assert.equal(prematureReloaded?.status, 'PLANNING');
  assert.equal(prematureReloaded?.verification, undefined);
  assert.equal(prematureAudits.length, 0);

  const executed = await executorService.executeTask(task.id);
  const reloaded = taskService.getTask(task.id);
  const auditEvents = readRecentAuditEvents(1000);
  const verificationAudits = auditEvents.filter((event) => event.taskId === task.id && event.action === 'task.verify');

  assert.equal(executed.success, true);
  assert.equal(executed.status, 'COMPLETED');
  assert.equal(reloaded?.status, 'COMPLETED');
  assert.equal(reloaded?.verification?.status, 'PASS');
  assert.equal(reloaded?.verification?.checks.every((check) => !check.required || check.status === 'PASS'), true);
  assert.equal(reloaded?.observations.some((observation) => observation.includes('Verifier PASS')), true);
  assert.equal(reloaded?.checkpoints.some((checkpoint) => checkpoint.includes('Verification')), true);
  assert.equal(reloaded?.timeline.some((event) => event.type === 'verification'), true);
  assert.equal(reloaded?.auditEvents.some((auditId) => verificationAudits.some((event) => event.id === auditId)), true);
  assert.equal(verificationAudits.length, 1);
  const repeated = verificationService.verifyTask(task.id);
  assert.equal(repeated.success, false);
  assert.equal(taskService.getTask(task.id)?.verification?.id, reloaded?.verification?.id);
  assert.equal(readRecentAuditEvents(1000).filter((event) => event.taskId === task.id && event.action === 'task.verify').length, 1);

  console.log(JSON.stringify({
    success: true,
    taskId: task.id,
    status: reloaded?.status,
    verification: reloaded?.verification?.status,
    checks: reloaded?.verification?.checks.length,
    scenarios: ['premature_reject_without_persistence', 'executor_integrated_verification', 'complete_only_on_pass', 'persist_verification', 'single_verification_audit'],
  }, null, 2));
} finally {
  closePersistence?.();
  process.chdir(originalCwd);
  await removeTempRoot();
}
