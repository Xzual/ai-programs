import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'edith-task-queue-test-'));
const originalCwd = process.cwd();
let closePersistence: (() => void) | undefined;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function removeTempRoot(): Promise<void> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EBUSY') throw error;
      if (attempt === 5) {
        console.warn(`Temp cleanup skipped because Windows still holds a handle: ${tempRoot}`);
        return;
      }
      await sleep(150 * (attempt + 1));
    }
  }
}

try {
  process.chdir(tempRoot);
  process.env.EDITH_PERSISTENCE = 'json';

  const { taskService } = await import('../src/edith/taskService');
  const { plannerService } = await import('../src/edith/planner');
  const { taskQueueService } = await import('../src/edith/taskQueueService');
  const { getEdithPersistenceStore } = await import('../src/edith/persistence');
  const { readRecentAuditEvents } = await import('../src/edith/audit');
  closePersistence = () => { getEdithPersistenceStore().close?.(); };

  const created = taskService.createTask({
    title: 'Persistent queue regression',
    objective: 'Create a system report and verify queue resume checkpoints',
    originalUserRequest: 'queue this EDITH task',
  });
  const planned = plannerService.planTask(created.id);
  assert.ok(planned.plan?.steps[0]?.id);

  const firstStepId = planned.plan.steps[0].id;
  const secondStepId = planned.plan.steps[1].id;
  taskService.updatePlanStepStatus(created.id, firstStepId, 'COMPLETED', 'First step completed before pause.');

  const queued = taskQueueService.enqueue(created.id);
  assert.equal(queued?.status, 'QUEUED');
  assert.equal(queued?.queue?.state, 'queued');
  assert.equal(queued?.queue?.resumeFromStepId, secondStepId);

  const running = taskQueueService.markRunning(created.id);
  assert.equal(running?.queue?.state, 'running');

  const paused = taskQueueService.pause(created.id, 'Waiting for user review.');
  assert.equal(paused?.status, 'BLOCKED');
  assert.equal(paused?.queue?.state, 'resumable');
  assert.equal(paused?.queue?.resumeFromStepId, secondStepId);
  assert.equal(paused?.timeline.at(-1)?.status, 'BLOCKED');
  assert.equal(taskQueueService.snapshot().resumable.some((task) => task.id === created.id), true);

  const taskFile = getEdithPersistenceStore().getPaths().legacyTaskFile;
  const persistedPaused = JSON.parse(fs.readFileSync(taskFile, 'utf8'));
  const pausedTask = persistedPaused.find((task: { id: string }) => task.id === created.id);
  assert.equal(pausedTask.status, 'BLOCKED');
  assert.equal(pausedTask.queue.state, 'resumable');
  assert.equal(pausedTask.queue.resumeFromStepId, secondStepId);

  const resumed = taskQueueService.resume(created.id);
  assert.equal(resumed?.status, 'QUEUED');
  assert.equal(resumed?.queue?.state, 'queued');
  assert.equal(resumed?.plan?.steps.find((step) => step.id === firstStepId)?.status, 'COMPLETED');
  assert.equal(resumed?.queue?.resumeFromStepId, secondStepId);
  assert.equal(taskQueueService.next()?.id, created.id);

  const persisted = JSON.parse(fs.readFileSync(taskFile, 'utf8'));
  const persistedTask = persisted.find((task: { id: string }) => task.id === created.id);
  assert.equal(persistedTask.queue.state, 'queued');
  assert.equal(persistedTask.queue.resumeFromStepId, secondStepId);
  assert.equal(persistedTask.checkpoints.some((checkpoint: string) => checkpoint.includes('Resumed from checkpoint')), true);

  const cancelled = taskQueueService.cancel(created.id, 'iptal et', 'queue-test');
  assert.equal(cancelled?.status, 'CANCELLED');
  assert.equal(cancelled?.queue?.state, 'interrupted');

  const snapshot = taskQueueService.snapshot();
  assert.equal(snapshot.interrupted.some((task) => task.id === created.id), true);

  const audits = readRecentAuditEvents(1000);
  assert.equal(audits.some((event) => event.action === 'task.queue.enqueue'), true);
  assert.equal(audits.some((event) => event.action === 'task.queue.pause'), true);
  assert.equal(audits.some((event) => event.action === 'task.queue.resume'), true);
  assert.equal(audits.some((event) => event.action === 'task.queue.cancel'), true);
  assert.equal(audits.some((event) => event.action === 'interrupt.request'), true);

  console.log(JSON.stringify({
    success: true,
    taskId: created.id,
    resumeFromStepId: secondStepId,
    scenarios: [
      'enqueue_persists_queue_metadata',
      'mark_running',
      'pause_sets_resumable_checkpoint',
      'resume_from_next_pending_step',
      'cancel_uses_interrupt',
      'queue_snapshot',
      'audit',
    ],
  }, null, 2));
} finally {
  closePersistence?.();
  process.chdir(originalCwd);
  await removeTempRoot();
}
