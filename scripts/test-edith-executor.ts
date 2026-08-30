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

  const blockedTask = taskService.createTask({
    title: 'Executor permission preflight',
    objective: 'Bilgisayarı kontrol et ve masaüstünde işlem yap',
    originalUserRequest: 'Bilgisayarı kontrol et.',
    toolsRequired: ['computer_control_agent'],
    riskLevel: 5,
  });
  const blockedPlanned = plannerService.planTask(blockedTask.id);
  assert.equal(blockedPlanned.success, true);
  const beforeBlockedRuns = getEdithPersistenceStore().listToolRuns?.(50) ?? [];
  const blockedExecuted = await executorService.executeTask(blockedTask.id);
  const blockedReloaded = taskService.getTask(blockedTask.id);
  const afterBlockedRuns = getEdithPersistenceStore().listToolRuns?.(50) ?? [];

  assert.equal(executed.success, true);
  assert.equal(executed.status, 'COMPLETED');
  assert.equal(executed.toolCalls, 1);
  assert.equal(executed.reports.length, 3);
  assert.equal(executed.reports.some((report) => report.message.includes('Step completed')), true);
  assert.equal(reloaded?.status, 'COMPLETED');
  assert.equal(reloaded?.plan?.steps.every((step) => step.status === 'COMPLETED'), true);
  assert.equal(reloaded?.verification?.status, 'PASS');
  assert.equal(reloaded?.timeline.some((event) => event.type === 'verification'), true);
  assert.equal(reloaded?.agentActivity.some((activity) => activity.agentId === 'executor' && activity.status === 'COMPLETED'), true);
  assert.equal(reloaded?.observations.some((observation) => observation.includes('Executor preflight READY')), true);
  assert.equal(reloaded?.observations.some((observation) => observation.includes('Executor tool system_monitor succeeded')), true);
  assert.equal(reloaded?.checkpoints.some((checkpoint) => checkpoint.includes('verification boundary')), true);
  assert.equal(toolRuns.some((run) => run.toolId === 'system_monitor' && run.status === 'success'), true);
  assert.equal(blockedExecuted.success, false);
  assert.equal(blockedExecuted.status, 'WAITING_FOR_APPROVAL');
  assert.equal(blockedExecuted.toolCalls, 0);
  assert.equal(blockedExecuted.reports.some((report) => report.message.includes('Capability preflight')), true);
  assert.equal(blockedReloaded?.status, 'WAITING_FOR_APPROVAL');
  assert.equal(blockedReloaded?.observations.some((observation) => observation.includes('Executor preflight WAITING_PERMISSION')), true);
  assert.equal(
    afterBlockedRuns.filter((run) => run.toolId === 'computer_control_agent').length,
    beforeBlockedRuns.filter((run) => run.toolId === 'computer_control_agent').length
  );

  getEdithPersistenceStore().close?.();

  console.log(JSON.stringify({
    success: true,
    taskId: task.id,
    status: reloaded?.status,
    toolCalls: executed.toolCalls,
    reports: executed.reports.length,
    permissionPreflight: blockedExecuted.status,
    scenarios: ['execute_plan', 'capability_preflight', 'run_tool', 'approval_wait_without_tool_call', 'store_observation', 'complete_steps', 'automatic_verification'],
  }, null, 2));
} finally {
  process.chdir(originalCwd);
  await removeTempRoot();
}
