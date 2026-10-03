import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requested = process.argv[2];
if (!requested || !/^scripts[\\/]test-edith-[A-Za-z0-9._-]+\.ts$/.test(requested)) {
  console.error('Usage: node scripts/run-edith-isolated-test.mjs scripts/test-edith-<name>.ts');
  process.exit(2);
}
const testFile = path.resolve(projectRoot, requested);
const scriptsRoot = path.resolve(projectRoot, 'scripts');
if (!testFile.startsWith(`${scriptsRoot}${path.sep}`) || !fs.existsSync(testFile)) {
  console.error('EDITH_TEST_TARGET_INVALID');
  process.exit(2);
}

const runtimeDb = path.join(projectRoot, '.edith', 'edith.db');
function runtimeSnapshot() {
  if (!fs.existsSync(runtimeDb)) return { exists: false };
  const stat = fs.statSync(runtimeDb);
  return {
    exists: true,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    sha256: createHash('sha256').update(fs.readFileSync(runtimeDb)).digest('hex'),
  };
}

const before = runtimeSnapshot();
const isolatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'edith-isolated-test-'));
const dataDir = path.join(isolatedRoot, 'Data');
const paths = {
  chatHistoryPath: path.join(isolatedRoot, 'Conversations'),
  logsPath: path.join(isolatedRoot, 'Logs'),
  dataPath: dataDir,
  backupPath: path.join(isolatedRoot, 'Backups'),
  exportsPath: path.join(isolatedRoot, 'Exports'),
};
for (const directory of Object.values(paths)) fs.mkdirSync(directory, { recursive: true });
const timestamp = new Date().toISOString();
const configPath = path.join(isolatedRoot, 'workspace.json');
fs.writeFileSync(configPath, `${JSON.stringify({
  schemaVersion: 1,
  workspaceId: 'edith-isolated-test',
  deviceId: 'edith-isolated-test-device',
  workspaceRoot: isolatedRoot,
  obsidianVaultPath: '',
  ...paths,
  portableMode: false,
  createdAt: timestamp,
  updatedAt: timestamp,
}, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });

let status = 1;
try {
  const tsxCli = path.join(projectRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const result = spawnSync(process.execPath, [tsxCli, testFile], {
    cwd: projectRoot,
    env: {
      ...process.env,
      EDITH_TEST_MODE: 'true',
      EDITH_TEST_DATA_DIR: dataDir,
      EDITH_WORKSPACE_CONFIG_PATH: configPath,
      EDITH_WORKSPACE_ROOT: isolatedRoot,
    },
    stdio: 'inherit',
  });
  status = result.status ?? 1;
} finally {
  const after = runtimeSnapshot();
  const sourceUnchanged = JSON.stringify(before) === JSON.stringify(after);
  console.log(JSON.stringify({
    isolation: 'os_temp_workspace',
    test: path.basename(testFile),
    sourceRuntimeDatabaseUnchanged: sourceUnchanged,
  }));
  if (!sourceUnchanged) {
    console.error('EDITH_TEST_RUNTIME_DB_MUTATION_DETECTED');
    status = 1;
  }
  try { fs.rmSync(isolatedRoot, { recursive: true, force: true }); } catch { /* best-effort temp cleanup */ }
}

process.exit(status);
