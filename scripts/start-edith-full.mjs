import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const EDITH_URL = process.env.EDITH_SERVICE_URL || 'http://localhost:3000';
const CRYPTO_URL = process.env.EDITH_CRYPTO_SERVICE_URL || process.env.EDITH_CRYPTO_DASHBOARD_URL || 'http://localhost:5000';
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const OBSIDIAN_VAULT_PATH = process.env.OBSIDIAN_VAULT_PATH || process.env.EDITH_OBSIDIAN_VAULT_PATH || 'D:\\EDİTH\\EDİTH';
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

let mainChild;
let cryptoChild;
let cryptoStartedByManager = false;
let shuttingDown = false;

function printHeader() {
  console.log('');
  console.log('E.D.I.T.H. Startup Manager');
  console.log('==========================');
  console.log('Safety: OBSERVER_ONLY crypto mode, trading disabled, live execution locked.');
  console.log('');
}

function printLine(scope, message) {
  console.log(`${scope.padEnd(17)} ${message}`);
}

function childEnv(extraEnv = {}) {
  return Object.fromEntries(
    Object.entries({ ...process.env, ...extraEnv })
      .filter(([key, value]) => key && !key.startsWith('=') && value !== undefined)
      .map(([key, value]) => [key, String(value)]),
  );
}

async function fetchJson(url, timeoutMs = 2500) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const text = await response.text();
    let body;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      body = text;
    }
    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    return {
      ok: false,
      status: error instanceof DOMException && error.name === 'AbortError' ? 'timeout' : 'offline',
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function cryptoHealth() {
  const primary = await fetchJson(`${CRYPTO_URL}/api/health`);
  if (primary.ok) return primary;
  const fallback = await fetchJson(`${CRYPTO_URL}/health`);
  return fallback.ok ? fallback : primary;
}

async function waitFor(name, check, timeoutMs = 30000, intervalMs = 750) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await check();
    if (last.ok) return last;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return last ?? { ok: false, status: 'timeout' };
}

function executableCandidates() {
  return [
    path.join(ROOT, 'crypto', '.venv', 'Scripts', 'python.exe'),
    path.join(ROOT, '.venv', 'Scripts', 'python.exe'),
    'python',
    'py',
  ];
}

function resolvePythonExecutable() {
  for (const candidate of executableCandidates()) {
    if (path.isAbsolute(candidate)) {
      if (fs.existsSync(candidate)) return candidate;
      continue;
    }
    return candidate;
  }
  return 'python';
}

function startMainApp() {
  printLine('Main app:', `starting ${EDITH_URL}`);
  mainChild = spawn(npmCommand, ['run', 'dev'], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: false,
    env: childEnv({
      PORT: '3000',
      EDITH_CRYPTO_AUTOSTART: 'false',
    }),
  });
  mainChild.on('exit', (code, signal) => {
    if (shuttingDown) return;
    console.log(`[E.D.I.T.H. Startup Manager] Main app exited: code=${code} signal=${signal ?? 'none'}`);
    shutdown(code && code !== 0 ? code : 0);
  });
}

async function startCryptoIfNeeded() {
  const existing = await cryptoHealth();
  if (existing.ok) {
    printLine('Crypto:', `already_running ${CRYPTO_URL}`);
    return { status: 'already_running', health: existing };
  }

  const scriptPath = path.join(ROOT, 'crypto', 'run_agent.py');
  if (!fs.existsSync(scriptPath)) {
    printLine('Crypto:', `offline run_agent.py not found at ${scriptPath}`);
    return { status: 'offline', error: 'run_agent.py not found' };
  }

  const python = resolvePythonExecutable();
  printLine('Crypto:', `starting ${CRYPTO_URL}`);
  printLine('Python:', python);
  cryptoStartedByManager = true;
  cryptoChild = spawn(python, [scriptPath], {
    cwd: ROOT,
    stdio: ['ignore', 'inherit', 'inherit'],
    shell: false,
    windowsHide: true,
    env: childEnv({
      PYTHONUNBUFFERED: '1',
      EDITH_CRYPTO_AUTOSTART: 'true',
      EDITH_CRYPTO_SERVICE_URL: CRYPTO_URL,
      EDITH_CRYPTO_DASHBOARD_URL: CRYPTO_URL,
      CRYPTO_MODE: 'OBSERVER_ONLY',
      TRADING_MODE: 'OBSERVER_ONLY',
      CRYPTO_TRADING_ENABLED: 'false',
      CRYPTO_PAPER_TRADING_ENABLED: 'false',
      CRYPTO_LIVE_TRADING_ENABLED: 'false',
      ENABLE_LIVE_TRADING: 'false',
      BINANCE_TRADING_ENABLED: 'false',
      CRYPTO_OBSIDIAN_ENABLED: process.env.CRYPTO_OBSIDIAN_ENABLED || 'true',
      EDITH_OBSIDIAN_VAULT_PATH: OBSIDIAN_VAULT_PATH,
      OBSIDIAN_VAULT_PATH,
      OLLAMA_HOST,
    }),
  });

  cryptoChild.on('exit', (code, signal) => {
    if (shuttingDown) return;
    printLine('Crypto:', `exited code=${code} signal=${signal ?? 'none'}`);
  });

  const health = await waitFor('crypto', cryptoHealth, 30000, 1000);
  if (!health.ok) {
    printLine('Crypto:', `degraded (${health.status})`);
    return { status: 'degraded', health };
  }
  printLine('Crypto:', `online mode=${health.body?.mode ?? 'unknown'} trading=${Boolean(health.body?.tradingEnabled)} paper=${Boolean(health.body?.paperTradingEnabled)} live=${Boolean(health.body?.liveTradingEnabled)}`);
  return { status: 'online', health };
}

async function printServiceSummary() {
  const [mainHealth, providers, obsidian, ollama] = await Promise.all([
    fetchJson(`${EDITH_URL}/api/health`),
    fetchJson(`${EDITH_URL}/api/providers/health`),
    fetchJson(`${EDITH_URL}/api/edith/obsidian/status`),
    fetchJson(`${OLLAMA_HOST}/api/tags`),
  ]);

  printLine('Main app:', mainHealth.ok ? 'online' : `${mainHealth.status}`);
  printLine('Providers:', providers.ok && Array.isArray(providers.body?.providers)
    ? providers.body.providers.map((provider) => `${provider.id}=${provider.status}`).join(', ')
    : `${providers.status}`);
  const obsidianStatus = obsidian.body?.status;
  printLine('Obsidian:', obsidian.ok
    ? `${obsidianStatus?.connectionStatus ?? 'unknown'} ${obsidianStatus?.settings?.vaultPath ?? OBSIDIAN_VAULT_PATH}`
    : `${obsidian.status}`);
  const modelCount = Array.isArray(ollama.body?.models) ? ollama.body.models.length : 0;
  printLine('Ollama:', ollama.ok ? `available ${modelCount} model(s)` : `${ollama.status}`);
  printLine('Safety:', 'kill switch ready, high-risk actions blocked by existing policy');
}

function stopChild(child, label) {
  if (!child || child.killed) return;
  printLine(label, 'stopping');
  child.kill();
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('');
  console.log('E.D.I.T.H. Startup Manager shutting down...');
  if (cryptoStartedByManager) {
    stopChild(cryptoChild, 'Crypto:');
  } else {
    printLine('Crypto:', 'left running if it was already running before startup');
  }
  stopChild(mainChild, 'Main app:');
  setTimeout(() => process.exit(exitCode), 500);
}

process.on('SIGINT', () => shutdown(130));
process.on('SIGTERM', () => shutdown(143));

printHeader();
startMainApp();

const mainReady = await waitFor('main app', () => fetchJson(`${EDITH_URL}/api/health`), 30000, 750);
printLine('Main app:', mainReady.ok ? 'online' : `degraded (${mainReady.status})`);

await startCryptoIfNeeded();
await printServiceSummary();

console.log('');
console.log('Startup manager is running. Press Ctrl+C to stop EDITH-managed child processes.');
console.log('');

setInterval(() => {}, 60_000);
