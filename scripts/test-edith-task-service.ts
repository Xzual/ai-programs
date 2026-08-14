import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'edith-task-service-test-'));
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

  const { taskService } = await import('../src/edith/taskService');
  const { readRecentAuditEvents } = await import('../src/edith/audit');
  const { getEdithPersistenceStore } = await import('../src/edith/persistence');

  const created = taskService.createTask({
    title: 'TaskService regression',
    objective: 'Verify durable task mutation',
    originalUserRequest: 'create a test task',
    normalizedIntent: 'verify durable task mutation',
    riskLevel: 1,
    validationRules: ['task has observation', 'task has checkpoint', 'task has artifact'],
  });

  const withObservation = taskService.addObservation(created.id, 'system_monitor selected as candidate tool');
  const withCheckpoint = taskService.addCheckpoint(created.id, 'task created and observable');
  const withArtifact = taskService.addArtifact(created.id, 'artifact://local/test-report.md');
  const completed = taskService.updateStatus(created.id, 'COMPLETED', 'TaskService regression completed.');
  const reloaded = taskService.getTask(created.id);
  const auditEvents = readRecentAuditEvents(10);

  assert.equal(withObservation?.observations.includes('system_monitor selected as candidate tool'), true);
  assert.equal(withCheckpoint?.checkpoints.includes('task created and observable'), true);
  assert.equal(withArtifact?.artifacts.includes('artifact://local/test-report.md'), true);
  assert.equal(completed?.status, 'COMPLETED');
  assert.equal(completed?.result, 'TaskService regression completed.');
  assert.equal(reloaded?.id, created.id);
  assert.equal(reloaded?.status, 'COMPLETED');
  assert.equal(reloaded?.validationRules.length, 3);
  assert.equal(auditEvents.some((event) => event.action === 'task.create'), true);
  assert.equal(auditEvents.some((event) => event.action === 'task.observation'), true);
  assert.equal(auditEvents.some((event) => event.action === 'task.checkpoint'), true);
  assert.equal(auditEvents.some((event) => event.action === 'task.artifact'), true);
  assert.equal(auditEvents.some((event) => event.action === 'task.status'), true);

  getEdithPersistenceStore().close?.();

  console.log(JSON.stringify({
    success: true,
    taskId: created.id,
    status: completed?.status,
    auditEvents: auditEvents.length,
    scenarios: ['create', 'observation', 'checkpoint', 'artifact', 'status', 'audit'],
  }, null, 2));
} finally {
  process.chdir(originalCwd);
  await removeTempRoot();
}
