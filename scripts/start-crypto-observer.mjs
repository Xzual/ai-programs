import 'dotenv/config';
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolveEdithCryptoPython } from './edith-crypto-python.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packaged = process.env.EDITH_PACKAGED === 'true';
const configuredResource = process.env.EDITH_CRYPTO_RESOURCE_DIR?.trim();
if (packaged && !configuredResource) {
  throw new Error('EDITH_CRYPTO_RESOURCE_DIR is required in packaged mode.');
}
const cryptoDir = configuredResource ? path.resolve(configuredResource) : path.join(root, 'crypto');
const pythonPath = resolveEdithCryptoPython(root);
const scriptPath = path.join(cryptoDir, 'run_agent.py');
if (!fs.statSync(scriptPath).isFile()) throw new Error(`Crypto entrypoint is missing: ${scriptPath}`);
function configuredVaultPath() {
  const environmentPath = process.env.EDITH_OBSIDIAN_VAULT_PATH || process.env.OBSIDIAN_VAULT_PATH;
  if (environmentPath) return environmentPath;
  const configFile = process.env.EDITH_WORKSPACE_CONFIG_PATH || path.join(root, '.edith', 'workspace.json');
  try {
    const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    if (!config.obsidianVaultPath) return '';
    const workspaceRoot = path.isAbsolute(config.workspaceRoot) ? config.workspaceRoot : path.resolve(root, config.workspaceRoot);
    return path.isAbsolute(config.obsidianVaultPath) ? config.obsidianVaultPath : path.resolve(workspaceRoot, config.obsidianVaultPath);
  } catch {
    return '';
  }
}

const vaultPath = configuredVaultPath();

function persistenceDataRoot() {
  if (process.env.EDITH_TEST_MODE === 'true' && process.env.EDITH_TEST_DATA_DIR) return path.resolve(process.env.EDITH_TEST_DATA_DIR);
  try {
    const config = JSON.parse(fs.readFileSync(process.env.EDITH_WORKSPACE_CONFIG_PATH || path.join(root, '.edith', 'workspace.json'), 'utf8'));
    const workspaceRoot = path.resolve(root, config.workspaceRoot);
    if (typeof config.dataPath !== 'string' || !config.dataPath) throw new Error('Missing persistence path');
    return path.resolve(workspaceRoot, config.dataPath);
  } catch { return path.join(root, '.edith'); }
}

const dataRoot = persistenceDataRoot();
const cryptoKillRoot = path.resolve(process.env.EDITH_CRYPTO_RUNTIME_DATA_DIR || path.join(dataRoot, 'crypto'));

const child = spawn(pythonPath, [scriptPath], {
  cwd: cryptoDir,
  stdio: 'inherit',
  windowsHide: true,
  env: {
    ...process.env,
    PYTHONDONTWRITEBYTECODE: '1',
    EDITH_CRYPTO_GLOBAL_KILL_SWITCH_PATH: path.join(dataRoot, 'kill-switch.json'),
    EDITH_CRYPTO_LOCAL_KILL_SWITCH_PATH: path.join(cryptoKillRoot, 'kill-switch.json'),
    PYTHONUTF8: '1',
    PYTHONIOENCODING: 'utf-8',
    CRYPTO_MODE: 'OBSERVER_ONLY',
    CRYPTO_TRADING_ENABLED: 'false',
    CRYPTO_PAPER_TRADING_ENABLED: 'false',
    CRYPTO_LIVE_TRADING_ENABLED: 'false',
    ENABLE_LIVE_TRADING: 'false',
    BINANCE_TRADING_ENABLED: 'false',
    CRYPTO_DEMO_TRADING_ENABLED: 'true',
    CRYPTO_STARTING_BALANCE: process.env.CRYPTO_STARTING_BALANCE || '10000',
    CRYPTO_DECISION_MODEL: 'jev',
    CRYPTO_OBSIDIAN_ENABLED: 'false',
    CRYPTO_LEARNING_ENABLED: 'false',
    CRYPTO_NEWS_ENABLED: 'false',
    CRYPTO_OLLAMA_ENABLED: 'false',
    EDITH_OBSIDIAN_VAULT_PATH: vaultPath,
    OBSIDIAN_VAULT_PATH: vaultPath,
  },
});

const forward = (signal) => {
  if (!child.killed) child.kill(signal);
};

process.once('SIGINT', () => forward('SIGINT'));
process.once('SIGTERM', () => forward('SIGTERM'));

child.on('exit', (code, signal) => {
  if (signal) {
    process.exit(signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1);
    return;
  }
  process.exit(code ?? 0);
});

child.on('error', (error) => {
  console.error(`Crypto observer failed to start: ${error.message}`);
  process.exit(1);
});
