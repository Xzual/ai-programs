import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edith-workspace-test-'));
const previousCwd = process.cwd();

try {
  process.chdir(root);
  process.env.EDITH_PERSISTENCE = 'json';
  process.env.EDITH_TEST_DATA_DIR = path.join(root, 'test-data');
  process.env.EDITH_OBSIDIAN_PROVIDER_APP_ROOT = previousCwd;
  delete process.env.EDITH_WORKSPACE_ROOT;
  delete process.env.EDITH_WORKSPACE_CONFIG_PATH;
  delete process.env.EDITH_OBSIDIAN_VAULT_PATH;
  delete process.env.OBSIDIAN_VAULT_PATH;

  const { WorkspaceManager, workspaceManager } = await import('../src/edith/workspaceManager');

  const existingVault = path.join(root, 'Kullanıcı Kasası EDİTH');
  fs.mkdirSync(path.join(existingVault, '.obsidian'), { recursive: true });
  const marker = path.join(existingVault, 'Benim Notum.md');
  fs.writeFileSync(marker, '# Kullanıcı notu\n\nSilinmemeli veya taşınmamalı.\n', 'utf8');

  const unicodeWorkspace = path.join(root, 'Başka Windows Konumu', 'EDİTH Workspace');
  const created = workspaceManager.createWorkspace({
    workspaceRoot: unicodeWorkspace,
    obsidianVaultPath: existingVault,
    portableMode: false,
  });
  assert.equal(created.workspaceRoot, unicodeWorkspace);
  assert.equal(fs.readdirSync(path.dirname(workspaceManager.configFile)).some((name) => /workspace\.json\..*\.(?:tmp|bak)$/.test(name)), false);
  assert.equal(workspaceManager.status().state, 'ready');
  const resolved = workspaceManager.getResolvedPaths();
  assert.ok(resolved);
  for (const directory of ['Conversations', 'Memory', 'Projects', 'Research', 'Tasks', 'Trading', 'Logs', 'Data', 'Backups', 'Exports', 'Config']) {
    assert.equal(fs.statSync(path.join(unicodeWorkspace, directory)).isDirectory(), true, directory);
  }
  assert.equal(fs.readFileSync(marker, 'utf8'), '# Kullanıcı notu\n\nSilinmemeli veya taşınmamalı.\n');
  assert.equal(fs.existsSync(path.join(existingVault, 'Memory')), false, 'Existing vault must not be restructured during selection.');

  const portableRoot = path.join(root, 'portable-app');
  fs.mkdirSync(portableRoot, { recursive: true });
  const portable = new WorkspaceManager({
    appRoot: portableRoot,
    configFile: path.join(portableRoot, '.edith', 'workspace.json'),
    autoMigrate: false,
  });
  const portableConfig = portable.createWorkspace({
    workspaceRoot: './data',
    portableMode: true,
    createLocalObsidianVault: true,
  });
  assert.equal(portableConfig.workspaceRoot, './data');
  assert.equal(portableConfig.obsidianVaultPath, 'Obsidian');
  assert.equal(portable.getResolvedPaths()?.workspaceRoot, path.join(portableRoot, 'data'));
  assert.equal(portable.status().state, 'ready');
  assert.throws(() => portable.configure({
    workspaceRoot: './data',
    portableMode: true,
    dataPath: path.join(root, 'escape'),
  }), /dataPath must be relative in portable mode/);

  const missing = new WorkspaceManager({
    appRoot: root,
    configFile: path.join(root, 'missing-config.json'),
    autoMigrate: false,
  });
  assert.throws(() => missing.validate({ workspaceRoot: path.join(root, 'missing') }), /does not exist/);

  const readOnlyRoot = path.join(root, 'read-only-workspace');
  fs.mkdirSync(readOnlyRoot);
  const readOnly = new WorkspaceManager({
    appRoot: root,
    configFile: path.join(root, 'read-only-config.json'),
    autoMigrate: false,
  });
  const originalWriteFileSync = fs.writeFileSync;
  (fs as any).writeFileSync = (file: fs.PathOrFileDescriptor, ...args: unknown[]) => {
    if (typeof file === 'string' && file.startsWith(readOnlyRoot) && file.includes('.edith-write-probe-')) {
      const error = new Error('EACCES: simulated read-only workspace');
      (error as NodeJS.ErrnoException).code = 'EACCES';
      throw error;
    }
    return (originalWriteFileSync as (...callArgs: unknown[]) => unknown)(file, ...args);
  };
  try {
    assert.throws(() => readOnly.validate({ workspaceRoot: readOnlyRoot }), /not writable/);
  } finally {
    (fs as any).writeFileSync = originalWriteFileSync;
  }

  const migrationRoot = path.join(root, 'legacy-install');
  const legacyData = path.join(migrationRoot, '.edith');
  const legacyVault = path.join(root, 'legacy-vault');
  fs.mkdirSync(legacyData, { recursive: true });
  fs.mkdirSync(legacyVault, { recursive: true });
  const legacyMarker = path.join(legacyData, 'tasks.json');
  fs.writeFileSync(legacyMarker, '[{"id":"keep-me"}]', 'utf8');
  fs.writeFileSync(path.join(legacyData, 'obsidian-settings.json'), JSON.stringify({ vaultPath: legacyVault }), 'utf8');
  const migrated = new WorkspaceManager({ appRoot: migrationRoot, env: {} });
  assert.equal(migrated.getResolvedPaths()?.obsidianVaultPath, legacyVault);
  assert.equal(migrated.getResolvedPaths()?.dataPath, legacyData);
  assert.equal(migrated.getConfig()?.migration?.movedFiles, false);
  assert.equal(fs.readFileSync(legacyMarker, 'utf8'), '[{"id":"keep-me"}]');

  const invalidLegacyRoot = path.join(root, 'invalid-legacy');
  fs.mkdirSync(path.join(invalidLegacyRoot, '.edith'), { recursive: true });
  const invalidVault = path.join(root, 'does-not-exist-vault');
  const invalidLegacy = new WorkspaceManager({
    appRoot: invalidLegacyRoot,
    env: { EDITH_OBSIDIAN_VAULT_PATH: invalidVault },
  });
  assert.equal(invalidLegacy.status().state, 'configuration_required');
  assert.equal(invalidLegacy.getResolvedPaths()?.obsidianVaultPath, invalidVault);
  assert.equal(fs.existsSync(invalidVault), false, 'Invalid legacy vault must not be invented.');

  const metadata = workspaceManager.getCloudMetadata();
  assert.ok(metadata);
  assert.equal(metadata.syncMode, 'metadata_only');
  assert.equal(metadata.localPath, unicodeWorkspace);
  assert.equal(metadata.vaultPath, existingVault);
  assert.equal(/note|content|secret|token/i.test(Object.keys(metadata).join(',')), false);

  process.env.EDITH_TEST_MODE = 'true';
  process.env.EDITH_TEST_OBSIDIAN_SANDBOX_ROOT = existingVault;

  const { obsidianVaultService } = await import('../src/edith/obsidianVaultService');
  const reindex = obsidianVaultService.reindex();
  assert.equal(reindex.success, true);
  assert.equal(fs.readFileSync(marker, 'utf8'), '# Kullanıcı notu\n\nSilinmemeli veya taşınmamalı.\n');
  assert.equal(fs.existsSync(path.join(existingVault, 'E.D.I.T.H. Index.md')), false);
  assert.equal(fs.existsSync(path.join(existingVault, 'Memory')), false);

  const { createWorkspaceRouter } = await import('../server/routes/workspace');
  const app = express();
  app.use(express.json());
  app.use(createWorkspaceRouter({ protectedMutation: [] }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    const statusResponse = await fetch(`${base}/api/workspace/status`);
    assert.equal(statusResponse.ok, true);
    const statusBody = await statusResponse.json() as Record<string, unknown>;
    assert.equal(statusBody.configured, true);
    assert.equal(statusBody.workspaceRoot, unicodeWorkspace);
    assert.equal(statusBody.obsidianVaultPath, existingVault);
    assert.equal(statusBody.readable, true);
    assert.equal(statusBody.writable, true);
    assert.equal(typeof statusBody.lastValidated, 'string');

    const validateResponse = await fetch(`${base}/api/workspace/validate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspaceRoot: path.join(root, 'missing-api-workspace') }),
    });
    assert.equal(validateResponse.status, 400);

    const updateResponse = await fetch(`${base}/api/workspace/config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspaceRoot: unicodeWorkspace, obsidianVaultPath: existingVault }),
    });
    assert.equal(updateResponse.ok, true);
    assert.equal(fs.readFileSync(marker, 'utf8'), '# Kullanıcı notu\n\nSilinmemeli veya taşınmamalı.\n');
    assert.equal(fs.existsSync(path.join(existingVault, 'Memory')), false);

    const apiCreatedRoot = path.join(root, 'api-created-workspace');
    const createResponse = await fetch(`${base}/api/workspace/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workspaceRoot: apiCreatedRoot,
        portableMode: false,
        createLocalObsidianVault: true,
      }),
    });
    assert.equal(createResponse.status, 201);
    const createBody = await createResponse.json() as Record<string, unknown>;
    assert.equal(createBody.workspaceRoot, apiCreatedRoot);
    assert.equal(fs.statSync(path.join(apiCreatedRoot, 'Data')).isDirectory(), true);
    assert.equal(fs.statSync(path.join(apiCreatedRoot, 'Obsidian', '.obsidian')).isDirectory(), true);
    const localMetadata = fs.readFileSync(path.join(apiCreatedRoot, 'Config', 'workspace-metadata.json'), 'utf8');
    assert.equal(localMetadata.includes('Silinmemeli veya taşınmamalı'), false);
    assert.equal(/apiKey|secret|token/i.test(localMetadata), false);
    assert.equal((JSON.parse(localMetadata) as Record<string, unknown>).syncMode, 'metadata_only');

    const configResponse = await fetch(`${base}/api/workspace/config`);
    assert.equal(configResponse.ok, true);
    const configText = await configResponse.text();
    assert.equal(/noteContent|apiKey|secret|token/i.test(configText), false);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }

  const { createKnowledgeRouter } = await import('../server/routes/knowledge');
  const auditApp = express();
  auditApp.use(express.json());
  auditApp.use(createKnowledgeRouter({ protectedMutation: [] }));
  const auditServer = auditApp.listen(0, '127.0.0.1');
  await once(auditServer, 'listening');
  try {
    const address = auditServer.address();
    assert.ok(address && typeof address !== 'string');
    const response = await fetch(`http://127.0.0.1:${address.port}/api/edith/obsidian/settings`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ watchEnabled: false }),
    });
    assert.equal(response.ok, true);
    const { readRecentAuditEvents } = await import('../src/edith/audit');
    const event = readRecentAuditEvents(20).find((entry) => entry.action === 'obsidian.settings_update');
    assert.equal(event?.actor, 'owner');
    assert.equal(event?.target, 'configured_obsidian_vault');
    assert.equal(JSON.stringify(event).includes(existingVault), false, 'Owner audit must not expose the local vault path.');
  } finally {
    await new Promise<void>((resolve, reject) => auditServer.close((error) => error ? reject(error) : resolve()));
  }

  const securedApp = express();
  securedApp.use(express.json());
  securedApp.use(createWorkspaceRouter());
  securedApp.use(createKnowledgeRouter());
  const securedServer = securedApp.listen(0, '127.0.0.1');
  await once(securedServer, 'listening');
  try {
    const address = securedServer.address();
    assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    for (const request of [
      { path: '/api/workspace/config', method: 'PUT' },
      { path: '/api/edith/obsidian/settings', method: 'PATCH' },
      { path: '/api/knowledge/write-note', method: 'POST' },
    ]) {
      const response = await fetch(`${base}${request.path}`, {
        method: request.method,
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      assert.equal(response.status, 401, `${request.method} ${request.path} must require owner session`);
    }
  } finally {
    await new Promise<void>((resolve, reject) => securedServer.close((error) => error ? reject(error) : resolve()));
  }

  const runtimeFiles = [
    'src/edith/workspaceManager.ts',
    'src/edith/obsidianVaultService.ts',
    'src/edith/cryptoService.ts',
    'crypto/src/obsidian_path.py',
    'crypto/src/config.py',
    'crypto/run_agent.py',
    'crypto/start_agent.bat',
    'scripts/start-crypto-observer.mjs',
    'scripts/start-edith-full.mjs',
    'src/components/views/KnowledgeMapView.tsx',
    'src/components/views/CryptoView.tsx',
    'src/components/ui/edithOS.tsx',
  ];
  const projectRoot = path.resolve(previousCwd);
  for (const relativePath of runtimeFiles) {
    const content = fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
    assert.equal(/D:\\+ED(?:İ|I)TH/i.test(content), false, `${relativePath} contains a fixed D: vault path.`);
  }

  console.log(JSON.stringify({
    success: true,
    workspaceRoot: unicodeWorkspace,
    portableRoot: portable.getResolvedPaths()?.workspaceRoot,
    tests: [
      'windows_temp_path', 'unicode_path', 'missing_path', 'read_only_path', 'portable_relative_path',
      'directory_structure', 'legacy_migration_without_move', 'invalid_legacy_config_required',
      'existing_vault_preserved', 'metadata_only_contract', 'workspace_api', 'no_fixed_drive_runtime',
      'atomic_workspace_config',
      'owner_session_required_for_workspace_and_obsidian_mutations',
      'owner_audit_without_vault_path_leakage',
    ],
  }));
} finally {
  try {
    const { obsidianVaultService } = await import('../src/edith/obsidianVaultService');
    obsidianVaultService.stopWatcher();
    await new Promise((resolve) => setTimeout(resolve, 500));
  } catch {
    // Cleanup remains best-effort if imports fail before the service is created.
  }
  process.chdir(previousCwd);
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      fs.rmSync(root, { recursive: true, force: true });
      break;
    } catch (error) {
      if (attempt === 5) console.warn('Temporary workspace retained:', error);
      else await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
    }
  }
}
