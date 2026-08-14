import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'edith-knowledge-map-test-'));
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
  const { plannerService } = await import('../src/edith/planner');
  const { memoryService } = await import('../src/edith/memoryService');
  const { executeEdithTool } = await import('../src/edith/serverRegistry');
  const { knowledgeMapService } = await import('../src/edith/knowledgeMapService');
  const { getEdithPersistenceStore } = await import('../src/edith/persistence');

  const task = taskService.createTask({
    title: 'Knowledge map regression',
    objective: 'Create a local system health report with CPU and RAM status',
    originalUserRequest: 'Create a local system health report.',
    riskLevel: 1,
  });
  const planned = plannerService.planTask(task.id);
  const memory = memoryService.upsert({
    type: 'project',
    scope: 'task',
    key: 'knowledge.map.task.link',
    content: 'Knowledge Map should link this memory to a persisted task.',
    relatedEntityIds: [`task:${task.id}`],
  });
  const toolResult = await executeEdithTool('system_monitor', {}, {
    actor: 'edith-knowledge-map-test',
    taskId: task.id,
  });
  const snapshot = knowledgeMapService.snapshot();

  const nodeIds = new Set(snapshot.nodes.map((node) => node.id));
  const edgePairs = new Set(snapshot.edges.map((edge) => `${edge.from}->${edge.to}:${edge.label}`));

  assert.equal(planned.success, true);
  assert.equal(toolResult.success, true);
  assert.equal(nodeIds.has('edith-core'), true);
  assert.equal(nodeIds.has('agent-hub'), true);
  assert.equal(nodeIds.has('model-router'), true);
  assert.equal(nodeIds.has(`task-${task.id}`), true);
  assert.equal(nodeIds.has(`memory-${memory.id}`), true);
  assert.equal(snapshot.nodes.some((node) => node.id === 'tool-system_monitor'), true);
  assert.equal(snapshot.nodes.some((node) => node.type === 'audit'), true);
  assert.equal(edgePairs.has(`memory-${memory.id}->task-${task.id}:related`), true);
  assert.equal(snapshot.edges.some((edge) => edge.from === `task-${task.id}` && edge.to === 'tool-system_monitor'), true);
  assert.equal(snapshot.edges.some((edge) => edge.from === 'edith-core' && edge.to === 'agent-hub'), true);
  assert.equal(snapshot.metrics.some((metric) => metric.label === 'Agents' && metric.value >= 7), true);

  getEdithPersistenceStore().close?.();

  console.log(JSON.stringify({
    success: true,
    nodes: snapshot.nodes.length,
    edges: snapshot.edges.length,
    sources: snapshot.sources,
    scenarios: [
      'persisted_task_node',
      'memory_task_relation',
      'tool_registry_node',
      'audit_event_node',
      'agent_nodes',
      'model_router_node',
    ],
  }, null, 2));
} finally {
  process.chdir(originalCwd);
  await removeTempRoot();
}
