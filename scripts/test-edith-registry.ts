import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'edith-registry-test-'));
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
      if ((error as NodeJS.ErrnoException).code !== 'EBUSY' || attempt === 4) throw error;
      await sleep(100 * (attempt + 1));
    }
  }
}

try {
  process.chdir(tempRoot);
  process.env.EDITH_PERSISTENCE = 'sqlite';
  delete process.env.EDITH_ENABLE_HIGH_RISK_TOOLS;

  const { executeEdithTool, getEdithToolHealth } = await import('../src/edith/serverRegistry');
  const { getEdithPersistenceStore } = await import('../src/edith/persistence');

  const success = await executeEdithTool('system_monitor', {}, { actor: 'registry-test' });
  const validation = await executeEdithTool('task_create', {}, { actor: 'registry-test' });
  const denied = await executeEdithTool(
    'playwright_browser_agent',
    { url: 'https://example.com' },
    { actor: 'registry-test' }
  );
  const runs = getEdithPersistenceStore().listToolRuns?.(10) ?? [];
  const health = getEdithToolHealth();
  const playwrightHealth = health.find((item) => item.toolId === 'playwright_browser_agent');

  assert.equal(success.success, true);
  assert.equal(typeof success.durationMs, 'number');
  assert.equal(validation.success, false);
  assert.equal(validation.errorCode, 'VALIDATION_ERROR');
  assert.deepEqual(validation.structuredOutput?.validationErrors, [
    'title is required',
    'objective is required',
    'originalUserRequest is required',
  ]);
  assert.equal(denied.success, false);
  assert.equal(denied.errorCode, 'PERMISSION_DENIED');
  assert.deepEqual(denied.structuredOutput?.missingPermissions, ['browser:control']);
  assert.equal(runs.length, 3);
  assert.equal(runs.some((run) => run.status === 'denied'), true);
  assert.equal(runs.some((run) => run.status === 'error'), true);
  assert.equal(runs.some((run) => run.status === 'success'), true);
  assert.equal(playwrightHealth?.state, 'UNAVAILABLE');
  assert.equal(playwrightHealth?.enabled, false);
  assert.equal(playwrightHealth?.missingPermissions.includes('browser:control'), true);
  getEdithPersistenceStore().close?.();

  console.log(JSON.stringify({
    success: true,
    scenarios: ['success', 'validation_error', 'permission_denied', 'tool_run_persistence', 'health'],
    toolRuns: runs.length,
  }, null, 2));
} finally {
  process.chdir(originalCwd);
  await removeTempRoot();
}
