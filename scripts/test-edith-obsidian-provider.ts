import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  EDITH_CONTRACT_AMENDMENT,
  TASK_CONTRACT_VERSION,
  parseObsidianProviderLocalConfigV1,
  parseObsidianProviderPublicStatusV1,
  parseTrustedNativeVaultSelectionV1,
  type TrustedNativeVaultSelectionV1,
} from '../src/edith/contracts';
import {
  ObsidianProviderConfigService,
  SandboxVaultProvider,
  UserVaultProvider,
  validateProductionVaultRoot,
  validateSandboxVaultRoot,
  type TrustedNativeVaultSelectionVerifier,
} from '../src/edith/obsidianProviderService';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edith-obsidian-provider-'));
const appRoot = path.join(root, 'application');
const configFile = path.join(root, 'local-config', 'obsidian-provider.json');
const userVault = path.join(root, 'Kullanıcı Profili', 'Belgelerim', 'Bilgi Kasası EDİTH');
const changedVault = path.join(root, 'Başka Profil', 'Yeni Kasa');
const fixedNow = new Date('2026-09-29T10:00:00.000Z');

function treeSnapshot(target: string): string[] {
  return fs.readdirSync(target, { recursive: true, withFileTypes: true })
    .map((entry) => `${entry.isDirectory() ? 'd' : 'f'}:${entry.parentPath}:${entry.name}`)
    .sort();
}

function selection(selectedPath: string, selectionId: string): TrustedNativeVaultSelectionV1 {
  return {
    contractVersion: TASK_CONTRACT_VERSION,
    amendment: EDITH_CONTRACT_AMENDMENT,
    selectionId,
    deviceId: 'device-local-windows',
    source: 'trusted_native_picker',
    selectedPath,
    userConfirmed: true,
    selectedAt: fixedNow.toISOString(),
    expiresAt: new Date(fixedNow.getTime() + 60_000).toISOString(),
  };
}

try {
  fs.mkdirSync(appRoot, { recursive: true });
  fs.mkdirSync(path.join(userVault, '.obsidian'), { recursive: true });
  fs.writeFileSync(path.join(userVault, 'Kullanıcı Notu.md'), '# Kullanıcı notu\nDeğişmemeli.\n', 'utf8');
  fs.mkdirSync(path.join(changedVault, '.obsidian'), { recursive: true });
  fs.writeFileSync(path.join(changedVault, 'Başlangıç.md'), '# Yeni kasa\n', 'utf8');

  const productionEnv = { NODE_ENV: 'production' } as NodeJS.ProcessEnv;
  const trustedVerifier: TrustedNativeVaultSelectionVerifier = { verify: () => ({ trusted: true }) };
  const fresh = new ObsidianProviderConfigService({ appRoot, configFile, env: productionEnv, verifier: trustedVerifier, now: () => fixedNow });
  assert.deepEqual(fresh.status(), {
    contractVersion: 2,
    amendment: '2.1',
    state: 'FIRST_RUN_REQUIRED',
    reasonCode: 'VAULT_SELECTION_REQUIRED',
    provider: 'none',
    configured: false,
    available: false,
    readable: false,
    writable: false,
    selectionAction: 'show_first_run',
    promptPolicy: 'user_initiated_only',
    configRevision: 0,
    executionAuthority: false,
    knowledgeOnly: true,
    checkedAt: fixedNow.toISOString(),
  });
  assert.equal(fs.existsSync(configFile), false, 'Fresh status reads must not create configuration or a vault.');

  const candidate = selection(userVault, 'selection-first');
  assert.equal(parseTrustedNativeVaultSelectionV1(candidate).success, true);
  const beforeSelection = treeSnapshot(userVault);
  const ready = fresh.activateTrustedSelection(candidate);
  assert.equal(ready.state, 'READY');
  assert.equal(ready.provider, 'user_vault');
  assert.equal(ready.executionAuthority, false);
  assert.deepEqual(treeSnapshot(userVault), beforeSelection, 'Selection validation must not modify the user-owned vault fixture.');
  assert.equal(fs.readFileSync(path.join(userVault, 'Kullanıcı Notu.md'), 'utf8'), '# Kullanıcı notu\nDeğişmemeli.\n');
  assert.equal(fs.readdirSync(path.dirname(configFile)).some((name) => /\.tmp$|\.bak$/.test(name)), false);

  const stored = JSON.parse(fs.readFileSync(configFile, 'utf8')) as Record<string, unknown>;
  assert.equal(parseObsidianProviderLocalConfigV1(stored).success, true);
  assert.equal(stored.selectedPath, fs.realpathSync(userVault));
  assert.equal(stored.schemaVersion, 1);
  assert.equal(stored.revision, 1);
  assert.equal(JSON.stringify(ready).includes(userVault), false);
  assert.equal('selectedPath' in ready, false);
  assert.equal(parseObsidianProviderPublicStatusV1(ready).success, true);
  assert.equal(parseObsidianProviderPublicStatusV1({ ...ready, vaultPath: userVault }).success, false);

  const restart = new ObsidianProviderConfigService({ appRoot, configFile, env: productionEnv, now: () => fixedNow });
  assert.equal(restart.status().state, 'READY');
  assert.equal(restart.status().selectionAction, 'none', 'Restart must reuse approved local config without reopening the picker.');
  assert.equal(restart.localConfigFingerprint()?.length, 64);

  assert.throws(() => new ObsidianProviderConfigService({ appRoot, configFile: path.join(root, 'untrusted.json'), env: productionEnv, now: () => fixedNow })
    .activateTrustedSelection(candidate), /NATIVE_PICKER_ATTESTATION_REQUIRED/);
  assert.throws(() => fresh.activateTrustedSelection({ ...candidate, expiresAt: fixedNow.toISOString() }), /OBSIDIAN_NATIVE_SELECTION/);
  assert.throws(() => fresh.activateTrustedSelection({ ...candidate, source: 'browser_picker' }), /OBSIDIAN_NATIVE_SELECTION_INVALID/);

  const changed = fresh.activateTrustedSelection(selection(changedVault, 'selection-change'));
  assert.equal(changed.state, 'READY');
  assert.equal(changed.configRevision, 2);
  const unavailablePath = `${changedVault}-offline`;
  fs.renameSync(changedVault, unavailablePath);
  const unavailable = fresh.status();
  assert.equal(unavailable.state, 'DEGRADED');
  assert.equal(unavailable.reasonCode, 'VAULT_UNAVAILABLE');
  assert.equal(unavailable.selectionAction, 'none', 'Unavailable configured vault must not create popup spam.');
  assert.equal(unavailable.configured, true);
  fs.renameSync(unavailablePath, changedVault);

  const revoked = fresh.revoke();
  assert.equal(revoked.state, 'FIRST_RUN_REQUIRED');
  assert.equal(revoked.reasonCode, 'VAULT_SELECTION_REVOKED');
  const revokedConfig = JSON.parse(fs.readFileSync(configFile, 'utf8')) as Record<string, unknown>;
  assert.equal(revokedConfig.provider, 'revoked');
  assert.equal('selectedPath' in revokedConfig, false);
  assert.equal(revokedConfig.revision, 3);

  const sandboxRoot = path.join(root, 'sandbox vault Türkçe');
  fs.mkdirSync(sandboxRoot, { recursive: true });
  const testEnv = { NODE_ENV: 'test', EDITH_TEST_MODE: 'true', EDITH_TEST_OBSIDIAN_SANDBOX_ROOT: sandboxRoot } as NodeJS.ProcessEnv;
  const testService = new ObsidianProviderConfigService({ appRoot, configFile: path.join(root, 'must-not-write.json'), env: testEnv, now: () => fixedNow });
  assert.equal(testService.status().state, 'READY');
  assert.equal(testService.status().provider, 'sandbox_vault');
  assert.equal(fs.existsSync(path.join(root, 'must-not-write.json')), false);
  assert.throws(() => testService.activateTrustedSelection(candidate), /OBSIDIAN_USER_PROVIDER_FORBIDDEN_IN_TEST/);
  assert.throws(() => new UserVaultProvider(userVault, { appRoot, env: testEnv }), /OBSIDIAN_USER_PROVIDER_FORBIDDEN_IN_TEST/);

  const sandbox = new SandboxVaultProvider(sandboxRoot, { appRoot, env: testEnv });
  sandbox.write('E.D.I.T.H/Research Journal/özet.md', '# güvenli\n');
  assert.equal(sandbox.read('E.D.I.T.H/Research Journal/özet.md'), '# güvenli\n');
  assert.equal(sandbox.executionAuthority, false);
  assert.throws(() => sandbox.write('../escape.md', 'no'), /TRAVERSAL|ESCAPE|RELATIVE/);
  assert.throws(() => validateSandboxVaultRoot(appRoot, { appRoot, env: testEnv }), /PROJECT_OR_PROFILE/);
  assert.throws(() => validateProductionVaultRoot(appRoot, appRoot), /SENSITIVE_ROOT/);

  const outside = path.join(root, 'outside');
  const link = path.join(sandboxRoot, 'linked-outside');
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => sandbox.exists('linked-outside/secret.md'), /LINK_ESCAPE/);

  const missingSandbox = new ObsidianProviderConfigService({ appRoot, env: { EDITH_TEST_MODE: 'true' }, now: () => fixedNow });
  assert.equal(missingSandbox.status().state, 'FIRST_RUN_REQUIRED');
  assert.equal(missingSandbox.status().reasonCode, 'TEST_SANDBOX_REQUIRED');

  const invalidConfigFile = path.join(root, 'invalid-config.json');
  fs.writeFileSync(invalidConfigFile, JSON.stringify({ schemaVersion: 999, selectedPath: userVault }), 'utf8');
  const invalid = new ObsidianProviderConfigService({ appRoot, configFile: invalidConfigFile, env: productionEnv, now: () => fixedNow });
  assert.equal(invalid.status().state, 'DEGRADED');
  assert.equal(invalid.status().reasonCode, 'CONFIG_INVALID');
  assert.equal(JSON.stringify(invalid.status()).includes(userVault), false);

  console.log(JSON.stringify({
    success: true,
    checks: [
      'fresh_first_run_required_no_fallback',
      'trusted_native_selection_only',
      'unicode_spaces_user_fixture_non_mutation',
      'atomic_versioned_local_config',
      'public_status_path_redaction',
      'restart_without_reprompt',
      'change_and_revoke',
      'unavailable_degraded_without_popup',
      'test_sandbox_only',
      'traversal_symlink_sensitive_root_guards',
      'knowledge_only_no_execution_authority',
    ],
  }, null, 2));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
