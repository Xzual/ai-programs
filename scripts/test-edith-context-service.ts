import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'edith-context-service-test-'));
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

  const { memoryService } = await import('../src/edith/memoryService');
  const { taskService } = await import('../src/edith/taskService');
  const { contextService } = await import('../src/edith/contextService');
  const { plannerService } = await import('../src/edith/planner');
  const { executeEdithTool } = await import('../src/edith/serverRegistry');
  const { readRecentAuditEvents } = await import('../src/edith/audit');
  const { getEdithPersistenceStore } = await import('../src/edith/persistence');

  const projectMemory = memoryService.upsert({
    type: 'project',
    scope: 'project',
    key: 'edith.context.plan',
    content: 'System health plans should consider memory, tools, tasks, and audit evidence.',
    importance: 0.9,
    confidence: 0.95,
    sensitivity: 'internal',
  });
  const sensitiveMemory = memoryService.upsert({
    type: 'episodic',
    scope: 'user',
    key: 'private.system.health',
    content: 'Sensitive health note should not enter default context.',
    sensitivity: 'sensitive',
  });
  const excludedTask = taskService.createTask({
    title: 'Previous health report',
    objective: 'Review system health and report CPU memory status',
    originalUserRequest: 'Prepare a system health report.',
    riskLevel: 1,
  });
  const relatedTask = taskService.createTask({
    title: 'Related memory audit',
    objective: 'Audit memory and tool evidence for system health reports',
    originalUserRequest: 'Check context evidence before the next health report.',
    riskLevel: 1,
  });
  await executeEdithTool('system_monitor', {}, { actor: 'context-test' });

  const snapshot = contextService.build({
    query: 'system health memory report',
    taskId: excludedTask.id,
    actor: 'context-test',
  });

  const plannedTask = taskService.createTask({
    title: 'Context-backed health report',
    objective: 'Create a local system health report with memory context',
    originalUserRequest: 'Create a system health report and remember project context.',
    riskLevel: 1,
  });
  const planResult = plannerService.planTask(plannedTask.id);
  const reloaded = taskService.getTask(plannedTask.id);
  const auditEvents = readRecentAuditEvents(100);

  assert.equal(snapshot.memoryReferences.some((reference) => reference.id === projectMemory.id), true);
  assert.equal(snapshot.memoryReferences.some((reference) => reference.id === sensitiveMemory.id), false);
  assert.equal(snapshot.taskReferences.some((reference) => reference.id === relatedTask.id), true);
  assert.equal(snapshot.taskReferences.every((reference) => reference.id !== excludedTask.id), true);
  assert.equal(snapshot.toolReferences.some((reference) => reference.id === 'system_monitor'), true);
  assert.equal(snapshot.toolRunReferences.some((reference) => reference.id.includes('toolrun-system_monitor')), true);
  assert.equal(snapshot.redactions.length > 0, true);
  assert.equal(auditEvents.some((event) => event.action === 'context.build'), true);
  assert.equal(planResult.success, true);
  assert.equal(Boolean(planResult.plan?.contextSnapshot), true);
  assert.equal(planResult.plan?.contextSnapshot?.memoryReferences.some((reference) => reference.id === projectMemory.id), true);
  assert.equal(reloaded?.plan?.contextSnapshot?.id, planResult.plan?.contextSnapshot?.id);
  assert.equal(reloaded?.memoryReferences.includes(projectMemory.id), true);
  assert.equal(reloaded?.memoryReferences.includes(sensitiveMemory.id), false);

  getEdithPersistenceStore().close?.();

  console.log(JSON.stringify({
    success: true,
    snapshotId: snapshot.id,
    planContextId: planResult.plan?.contextSnapshot?.id,
    references: {
      memories: snapshot.memoryReferences.length,
      tasks: snapshot.taskReferences.length,
      tools: snapshot.toolReferences.length,
      toolRuns: snapshot.toolRunReferences.length,
      audits: snapshot.auditReferences.length,
    },
    scenarios: ['safe_memory_context', 'task_context', 'tool_context', 'tool_run_context', 'audit', 'planner_attachment'],
  }, null, 2));
} finally {
  process.chdir(originalCwd);
  await removeTempRoot();
}
