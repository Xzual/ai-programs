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

  assert.equal(agents.length >= 10, true);
  assert.deepEqual(
    [
      'orchestrator',
      'planning',
      'research',
      'browser-computer',
      'browser-workflow',
      'coding',
      'vision',
      'proactive-monitoring',
      'design3d-orchestrator',
      'sensitive-integration-guard',
      'security',
    ].every((id) => agentIds.includes(id)),
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

  const phase2Routes = agentRegistryService.routeTask({
    objective: 'Ekranı oku, browser workflow planla ve 3D CAD temelini hazırla',
    riskLevel: 2,
    toolsRequired: ['vision_observe', 'browser_workflow', 'design3d_cad_foundation'],
    permissionsRequired: ['system:read', 'network:read'],
  });
  assert.equal(phase2Routes.some((route) => route.agentId === 'vision'), true);
  assert.equal(phase2Routes.some((route) => route.agentId === 'browser-workflow'), true);
  assert.equal(phase2Routes.some((route) => route.agentId === 'design3d-orchestrator'), true);

  const sensitiveRoutes = agentRegistryService.routeTask({
    objective: 'IoT ışık feedback ve crypto trading order güvenlik kontrolü yap',
    riskLevel: 5,
    toolsRequired: ['iot_feedback_stub', 'finance_trading_guard'],
    permissionsRequired: ['system:read'],
  });
  assert.equal(sensitiveRoutes.some((route) => route.agentId === 'sensitive-integration-guard'), true);
  assert.equal(sensitiveRoutes.some((route) => route.agentId === 'security'), true);

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
    phase2Routes: phase2Routes.map((route) => route.agentId),
    sensitiveRoutes: sensitiveRoutes.map((route) => route.agentId),
    scenarios: ['agent_registry', 'route_research', 'route_high_risk_security', 'route_phase2_foundations', 'route_sensitive_integrations', 'planner_uses_agents'],
  }, null, 2));
} finally {
  process.chdir(originalCwd);
  await removeTempRoot();
}
