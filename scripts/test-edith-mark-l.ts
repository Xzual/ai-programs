import assert from 'node:assert/strict';

process.env.EDITH_PERSISTENCE = 'sqlite';
delete process.env.EDITH_ENABLE_HIGH_RISK_TOOLS;

const { markLAdapterService } = await import('../src/edith/markLAdapter');
const { executeEdithTool } = await import('../src/edith/serverRegistry');
const { taskService } = await import('../src/edith/taskService');
const { plannerService } = await import('../src/edith/planner');
const { getEdithPersistenceStore } = await import('../src/edith/persistence');

const snapshot = markLAdapterService.snapshot();

assert.equal(snapshot.exists, true);
assert.equal(snapshot.readmeExists, true);
assert.equal(snapshot.requirementsExists, true);
assert.equal(snapshot.capabilityCount >= 8, true);
assert.equal(snapshot.highRiskCount >= 5, true);
assert.equal(snapshot.capabilities.some((capability) => capability.id === 'mark_l_system_monitor'), true);
assert.equal(snapshot.capabilities.find((capability) => capability.id === 'mark_l_computer_control')?.riskLevel, 5);
assert.equal(snapshot.capabilities.every((capability) => capability.enabledByDefault === false), true);

const result = await executeEdithTool('mark_l_capabilities', {}, {
  actor: 'edith-mark-l-test',
});
const toolRuns = getEdithPersistenceStore().listToolRuns?.(10) ?? [];

assert.equal(result.success, true);
assert.equal(result.toolId, 'mark_l_capabilities');
assert.equal((result.structuredOutput?.capabilityCount as number) >= 8, true);
assert.equal(toolRuns.some((run) => run.toolId === 'mark_l_capabilities' && run.status === 'success'), true);

const task = taskService.createTask({
  title: 'Mark-L adapter regression',
  objective: 'Inspect Mark-L adapter capability provider status',
  originalUserRequest: 'Mark-L adapter entegrasyon durumunu kontrol et.',
  riskLevel: 1,
});
const planned = plannerService.planTask(task.id);

assert.equal(planned.success, true);
assert.equal(planned.plan?.requiredTools.includes('mark_l_capabilities'), true);
assert.equal(planned.plan?.requiredPermissions.includes('system:read'), true);
assert.equal(planned.plan?.requiredAgents.includes('orchestrator'), true);
assert.equal(planned.task?.toolsRequired.includes('mark_l_capabilities'), true);

getEdithPersistenceStore().close?.();

console.log(JSON.stringify({
  success: true,
  root: snapshot.root,
  capabilities: snapshot.capabilityCount,
  highRisk: snapshot.highRiskCount,
  plannedTools: planned.plan?.requiredTools,
  scenarios: ['snapshot', 'risk_manifest', 'registry_tool', 'tool_run_persistence', 'planner_selection'],
}, null, 2));
