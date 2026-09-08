import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const cryptoDir = path.join(root, 'crypto');
const pythonPath = process.env.EDITH_CRYPTO_PYTHON_PATH || path.join(cryptoDir, '.venv', 'Scripts', 'python.exe');
const scriptPath = path.join(cryptoDir, 'run_agent.py');
const vaultPath = process.env.EDITH_OBSIDIAN_VAULT_PATH || process.env.OBSIDIAN_VAULT_PATH || 'D:\\EDİTH\\EDİTH';

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
    CRYPTO_OBSIDIAN_ENABLED: process.env.CRYPTO_OBSIDIAN_ENABLED || 'true',
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
