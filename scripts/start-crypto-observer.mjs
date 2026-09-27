import 'dotenv/config';
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import fs from 'node:fs';

const root = process.cwd();
const cryptoDir = path.join(root, 'crypto');
const pythonPath = process.env.EDITH_CRYPTO_PYTHON_PATH || path.join(cryptoDir, '.venv', 'Scripts', 'python.exe');
const scriptPath = path.join(cryptoDir, 'run_agent.py');
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

const child = spawn(pythonPath, [scriptPath], {
  cwd: cryptoDir,
  stdio: 'inherit',
  windowsHide: false,
  env: {
    ...process.env,
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
