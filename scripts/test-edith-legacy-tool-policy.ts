import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'edith-legacy-tool-policy-test-'));
const originalCwd = process.cwd();

try {
  process.chdir(tempRoot);
  process.env.EDITH_PERSISTENCE = 'json';
  delete process.env.EDITH_ENABLE_HIGH_RISK_TOOLS;

  const { legacyToolForPermission } = await import('../src/edith/legacyToolPolicy');
  const { permissionService } = await import('../src/edith/permissionService');

  const systemMonitor = legacyToolForPermission('system_monitor');
  const browserControl = legacyToolForPermission('browser_control', { action: 'open' });
  const codeRun = legacyToolForPermission('code_helper', { action: 'run' });
  const codeReview = legacyToolForPermission('code_helper', { action: 'review' });
  const devAgent = legacyToolForPermission('dev_agent');
  const monitorWrite = legacyToolForPermission('background_monitor', { action: 'add' });
  const monitorRead = legacyToolForPermission('background_monitor', { action: 'list' });

  assert.ok(systemMonitor);
  assert.ok(browserControl);
  assert.ok(codeRun);
  assert.ok(codeReview);
  assert.ok(devAgent);
  assert.ok(monitorWrite);
  assert.ok(monitorRead);

  assert.equal(permissionService.decideToolExecution({ tool: systemMonitor, actor: 'legacy-test' }).status, 'ALLOW');
  assert.equal(permissionService.decideToolExecution({ tool: codeReview, actor: 'legacy-test' }).status, 'ALLOW');
  assert.equal(permissionService.decideToolExecution({ tool: monitorRead, actor: 'legacy-test' }).status, 'ALLOW');

  const browserDenied = permissionService.decideToolExecution({ tool: browserControl, actor: 'legacy-test' });
  const codeRunDenied = permissionService.decideToolExecution({ tool: codeRun, actor: 'legacy-test' });
  const devDenied = permissionService.decideToolExecution({ tool: devAgent, actor: 'legacy-test' });
  const monitorWriteDenied = permissionService.decideToolExecution({ tool: monitorWrite, actor: 'legacy-test' });
  assert.equal(browserDenied.status, 'DENY');
  assert.deepEqual(browserDenied.missingPermissions, ['browser:control']);
  assert.equal(codeRunDenied.status, 'DENY');
  assert.deepEqual(codeRunDenied.missingPermissions, ['system:exec']);
  assert.equal(devDenied.status, 'DENY');
  assert.deepEqual(devDenied.missingPermissions, ['file:write']);
  assert.equal(monitorWriteDenied.status, 'DENY');
  assert.deepEqual(monitorWriteDenied.missingPermissions, ['file:write']);

  const grant = permissionService.createGrant({
    actor: 'legacy-test',
    permissions: ['network:read', 'browser:control'],
    toolIds: ['browser_control'],
    reason: 'Scoped browser legacy regression grant.',
    grantedBy: 'test',
    ttlMs: 60_000,
  });
  const browserGranted = permissionService.decideToolExecution({ tool: browserControl, actor: 'legacy-test' });
  const codeStillDenied = permissionService.decideToolExecution({ tool: codeRun, actor: 'legacy-test' });
  assert.equal(browserGranted.status, 'ALLOW');
  assert.deepEqual(browserGranted.activeGrantIds, [grant.id]);
  assert.equal(codeStillDenied.status, 'DENY');

  console.log(JSON.stringify({
    success: true,
    scenarios: [
      'legacy_low_risk_allowed',
      'legacy_browser_control_denied',
      'legacy_exec_denied',
      'legacy_file_write_denied',
      'scoped_grant_allows_only_target_tool',
    ],
  }, null, 2));
} finally {
  process.chdir(originalCwd);
  try {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  } catch {
    // Cleanup is best-effort on Windows.
  }
}
