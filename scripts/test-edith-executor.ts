import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'edith-executor-test-'));
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
  const { executorService } = await import('../src/edith/executor');
  const { getEdithPersistenceStore } = await import('../src/edith/persistence');

  const task = taskService.createTask({
    title: 'Executor regression',
    objective: 'Create a local system health report with CPU and RAM status',
    originalUserRequest: 'Create a task to prepare a local system health report.',
    riskLevel: 1,
  });
  const planned = plannerService.planTask(task.id);
  assert.equal(planned.success, true);

  const executed = await executorService.executeTask(task.id);
  const reloaded = taskService.getTask(task.id);
  const toolRuns = getEdithPersistenceStore().listToolRuns?.(10) ?? [];

  assert.equal(executed.success, true);
  assert.equal(executed.status, 'VERIFYING');
  assert.equal(executed.toolCalls, 1);
  assert.equal(executed.reports.length, 3);
  assert.equal(reloaded?.status, 'VERIFYING');
  assert.equal(reloaded?.plan?.steps.every((step) => step.status === 'COMPLETED'), true);
  assert.equal(reloaded?.observations.some((observation) => observation.includes('Executor tool system_monitor succeeded')), true);
  assert.equal(reloaded?.checkpoints.some((checkpoint) => checkpoint.includes('verification boundary')), true);
  assert.equal(toolRuns.some((run) => run.toolId === 'system_monitor' && run.status === 'success'), true);

  getEdithPersistenceStore().close?.();

  console.log(JSON.stringify({
    success: true,
    taskId: task.id,
    status: reloaded?.status,
    toolCalls: executed.toolCalls,
    reports: executed.reports.length,
    scenarios: ['execute_plan', 'run_tool', 'store_observation', 'complete_steps', 'verification_boundary'],
  }, null, 2));
} finally {
  process.chdir(originalCwd);
  await removeTempRoot();
}
