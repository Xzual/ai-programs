import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'edith-agents-test-'));
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

  const { agentRegistryService } = await import('../src/edith/agentRegistry');
  const { taskService } = await import('../src/edith/taskService');
  const { plannerService } = await import('../src/edith/planner');
  const { getEdithPersistenceStore } = await import('../src/edith/persistence');

  const agents = agentRegistryService.listAgents();
  const agentIds = agents.map((agent) => agent.id);

  assert.equal(agents.length, 7);
  assert.deepEqual(
    ['orchestrator', 'planning', 'research', 'browser-computer', 'coding', 'vision', 'security'].every((id) => agentIds.includes(id)),
    true
  );
  assert.equal(agents.every((agent) => agent.responsibility && agent.timeoutMs > 0), true);
  assert.equal(agentRegistryService.getAgent('browser-computer')?.health, 'UNAVAILABLE');

  const researchRoutes = agentRegistryService.routeTask({
    objective: 'Web araştırması yap ve kaynakları özetle',
    riskLevel: 1,
    toolsRequired: ['browser_search'],
    permissionsRequired: ['network:read'],
  });
  assert.equal(researchRoutes.some((route) => route.agentId === 'research'), true);

  const highRiskRoutes = agentRegistryService.routeTask({
    objective: 'Use browser control to inspect a page',
    riskLevel: 4,
    toolsRequired: ['playwright_browser_agent'],
    permissionsRequired: ['network:read', 'browser:control'],
  });
  assert.equal(highRiskRoutes.some((route) => route.agentId === 'browser-computer'), true);
  assert.equal(highRiskRoutes.some((route) => route.agentId === 'security'), true);
  assert.equal(highRiskRoutes.find((route) => route.agentId === 'browser-computer')?.missingPermissions.includes('computer:control'), true);

  const task = taskService.createTask({
    title: 'Agent planner regression',
    objective: 'Create a local system health report with CPU and RAM status',
    originalUserRequest: 'Create a task to prepare a local system health report.',
    riskLevel: 1,
  });
  const planned = plannerService.planTask(task.id);

  assert.equal(planned.success, true);
  assert.equal(planned.plan?.requiredAgents.includes('orchestrator'), true);
  assert.equal(planned.plan?.requiredAgents.includes('planning'), true);
  assert.equal(planned.task?.candidateAgents.includes('orchestrator'), true);
  assert.equal(planned.task?.candidateAgents.includes('planning'), true);

  getEdithPersistenceStore().close?.();

  console.log(JSON.stringify({
    success: true,
    agents: agents.length,
    plannerAgents: planned.plan?.requiredAgents,
    researchRoutes: researchRoutes.map((route) => route.agentId),
    highRiskRoutes: highRiskRoutes.map((route) => route.agentId),
    scenarios: ['agent_registry', 'route_research', 'route_high_risk_security', 'planner_uses_agents'],
  }, null, 2));
} finally {
  process.chdir(originalCwd);
  await removeTempRoot();
}
