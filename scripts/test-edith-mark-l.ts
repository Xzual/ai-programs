import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const projectRoot = process.cwd();
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'edith-mark-l-test-'));
process.chdir(tempRoot);
process.env.EDITH_MARK_L_ROOT = path.join(projectRoot, 'Mark-L-main');
process.env.EDITH_PERSISTENCE = 'json';
delete process.env.EDITH_ENABLE_HIGH_RISK_TOOLS;

try {

const { markLAdapterService } = await import('../src/edith/markLAdapter');
const { executeEdithTool } = await import('../src/edith/serverRegistry');
const { taskService } = await import('../src/edith/taskService');
const { plannerService } = await import('../src/edith/planner');
const { getEdithPersistenceStore } = await import('../src/edith/persistence');

const snapshot = markLAdapterService.snapshot();

assert.equal(snapshot.exists, true);
assert.equal(snapshot.readmeExists, true);
assert.equal(snapshot.requirementsExists, true);
assert.equal(snapshot.configured, false);
assert.equal(snapshot.executionEnabled, false);
assert.equal(snapshot.status, 'CONFIGURATION_REQUIRED');
assert.equal(snapshot.availableCount, 0);
assert.equal(snapshot.capabilityCount >= 8, true);
assert.equal(snapshot.highRiskCount >= 5, true);
assert.equal(snapshot.capabilities.some((capability) => capability.id === 'mark_l_system_monitor'), true);
assert.equal(snapshot.capabilities.find((capability) => capability.id === 'mark_l_computer_control')?.riskLevel, 5);
assert.equal(snapshot.capabilities.every((capability) => capability.enabledByDefault === false), true);
assert.equal(
  snapshot.capabilities.every((capability) => capability.status === 'CONFIGURATION_REQUIRED' || capability.status === 'MISSING'),
  true,
);

const adapterSource = await import('node:fs/promises').then((module) =>
  module.readFile(new URL('../src/edith/markLAdapter.ts', import.meta.url), 'utf8'),
);
const registrySource = await import('node:fs/promises').then((module) =>
  module.readFile(new URL('../src/edith/serverRegistry.ts', import.meta.url), 'utf8'),
);
assert.doesNotMatch(adapterSource, /(?:child_process|execFile|spawn|python-shell)/);
assert.doesNotMatch(adapterSource, /import\s*\([^)]*Mark-L-main/i);
assert.doesNotMatch(registrySource, /steam-game-manager\.py/i);
assert.doesNotMatch(registrySource, /Mark-L-main\/actions\/game_updater\.py/i);

const result = await executeEdithTool('mark_l_capabilities', {}, {
  actor: 'edith-mark-l-test',
});
const blockedSearch = await executeEdithTool('steam_game_search', { query: 'synthetic-test' }, {
  actor: 'edith-mark-l-test',
  authorizedPermissions: ['system:read', 'system:exec'],
});
const blockedInstall = await executeEdithTool('steam_game_install', { gameName: 'synthetic-test' }, {
  actor: 'edith-mark-l-test',
  authorizedPermissions: ['computer:control', 'system:exec'],
});
const toolRuns = getEdithPersistenceStore().listToolRuns?.(10) ?? [];

assert.equal(result.success, true);
assert.equal(result.toolId, 'mark_l_capabilities');
assert.equal((result.structuredOutput?.capabilityCount as number) >= 8, true);
assert.equal(blockedSearch.success, false);
assert.equal(blockedSearch.errorCode, 'PERMISSION_DENIED');
assert.equal(blockedInstall.success, false);
assert.equal(blockedInstall.errorCode, 'PERMISSION_DENIED');
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
  scenarios: ['snapshot', 'configuration_required', 'metadata_only_source_discovery', 'risk_manifest', 'registry_tool', 'tool_run_persistence', 'planner_selection', 'unsandboxed_runtime_blocked'],
}, null, 2));
} finally {
  process.chdir(projectRoot);
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
