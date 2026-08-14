import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'edith-kill-switch-test-'));
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

  const { KillSwitchActiveError, killSwitchService } = await import('../src/edith/killSwitch');
  const { taskService } = await import('../src/edith/taskService');
  const { plannerService } = await import('../src/edith/planner');
  const { executorService } = await import('../src/edith/executor');
  const { executeEdithTool } = await import('../src/edith/serverRegistry');
  const { readRecentAuditEvents } = await import('../src/edith/audit');
  const { getEdithPersistenceStore } = await import('../src/edith/persistence');

  killSwitchService.deactivate('test-setup');

  const task = taskService.createTask({
    title: 'Kill switch regression',
    objective: 'Create a local system health report with CPU and RAM status',
    originalUserRequest: 'Create a local system health report.',
    riskLevel: 1,
  });
  const planned = plannerService.planTask(task.id);

  const active = killSwitchService.activate('Regression emergency stop.', 'test');
  let blockedCreate: unknown;
  try {
    taskService.createTask({
      title: 'Blocked task',
      objective: 'This task should not be created while stopped.',
      originalUserRequest: 'Create blocked task.',
    });
  } catch (error) {
    blockedCreate = error;
  }

  const blockedTool = await executeEdithTool('system_monitor', {}, {
    actor: 'edith-kill-switch-test',
    taskId: task.id,
  });
  const blockedExecution = await executorService.executeTask(task.id);
  const afterBlockTasks = taskService.listTasks();

  const inactive = killSwitchService.deactivate('test');
  const allowedTool = await executeEdithTool('system_monitor', {}, {
    actor: 'edith-kill-switch-test',
  });
  const allowedTask = taskService.createTask({
    title: 'Allowed after kill switch',
    objective: 'Task creation is allowed after kill switch is deactivated.',
    originalUserRequest: 'Create allowed task.',
  });
  const auditEvents = readRecentAuditEvents(1000);

  assert.equal(planned.success, true);
  assert.equal(active.active, true);
  assert.equal(blockedCreate instanceof KillSwitchActiveError, true);
  assert.equal(blockedTool.success, false);
  assert.equal(blockedTool.errorCode, 'PERMISSION_DENIED');
  assert.equal(blockedTool.structuredOutput?.disabledCapability, 'tool_execution');
  assert.equal(blockedExecution.success, false);
  assert.equal(blockedExecution.status, 'PAUSED');
  assert.equal(afterBlockTasks.some((candidate) => candidate.id === task.id), true);
  assert.equal(afterBlockTasks.some((candidate) => candidate.title === 'Blocked task'), false);
  assert.equal(inactive.active, false);
  assert.equal(allowedTool.success, true);
  assert.equal(Boolean(allowedTask.id), true);
  assert.equal(auditEvents.some((event) => event.action === 'kill_switch.activate'), true);
  assert.equal(auditEvents.some((event) => event.action === 'kill_switch.deactivate'), true);
  assert.equal(auditEvents.some((event) => event.action === 'kill_switch.block'), true);
  assert.equal(auditEvents.some((event) => event.action === 'tool.blocked_by_kill_switch'), true);

  const taskCount = taskService.listTasks().length;
  getEdithPersistenceStore().close?.();

  console.log(JSON.stringify({
    success: true,
    activeCapabilities: active.disabledCapabilities,
    blockedTool: blockedTool.errorCode,
    executorStatus: blockedExecution.status,
    taskCount,
    scenarios: [
      'activate',
      'block_task_creation',
      'block_tool_execution',
      'pause_executor_without_deleting_task',
      'deactivate',
      'audit',
    ],
  }, null, 2));
} finally {
  process.chdir(originalCwd);
  await removeTempRoot();
}
