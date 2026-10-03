import fs from 'fs';
import path from 'path';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'child_process';
import { randomBytes } from 'crypto';
import { appendAuditEvent, createAuditEvent } from './audit';
import { workspaceManager } from './workspaceManager';

export interface CryptoAgentStatus {
  dashboardUrl: string;
  projectPath: string;
  healthy: boolean;
  managedProcessRunning: boolean;
  autoStartEnabled: boolean;
  pythonPath: string;
  scriptPath: string;
  logPath: string;
  startedAt?: string;
  lastExit?: {
    code: number | null;
    signal: NodeJS.Signals | null;
    at: string;
  };
  health?: unknown;
  runtime?: unknown;
  obsidian?: unknown;
  error?: string;
  errorCode?: 'resource_missing' | 'runtime_missing' | 'dependency_missing' | 'service_unavailable';
}

const DASHBOARD_URL = process.env.EDITH_CRYPTO_SERVICE_URL || process.env.EDITH_CRYPTO_DASHBOARD_URL || 'http://localhost:5000';

const REQUIRED_CRYPTO_RESOURCES = [
  'run_agent.py',
  'src/config.py',
  'src/dashboard.py',
  'src/demo_portfolio.py',
  'src/jev_adapter.py',
  'src/market_service.py',
  'templates/dashboard.html',
  'config/coin_permissions.json',
  'config/demo_asset_modes.json',
  'config/observer_config.json',
] as const;

function hasCompleteCryptoManifest(candidate: string): boolean {
  return REQUIRED_CRYPTO_RESOURCES.every((relativePath) => {
    try {
      return fs.statSync(path.join(candidate, relativePath)).isFile();
    } catch {
      return false;
    }
  });
}

function resolveCryptoProjectPath(): string {
  const packagedResourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  const candidates = [
    process.env.EDITH_CRYPTO_RESOURCE_DIR,
    process.env.EDITH_CRYPTO_PROJECT_PATH,
    process.env.EDITH_APP_RESOURCE_DIR ? path.join(process.env.EDITH_APP_RESOURCE_DIR, 'crypto') : undefined,
    packagedResourcesPath ? path.join(packagedResourcesPath, 'crypto') : undefined,
    path.join(process.cwd(), 'resources', 'crypto'),
    path.join(process.cwd(), 'crypto'),
  ].filter((candidate): candidate is string => Boolean(candidate?.trim()))
    .map((candidate) => path.resolve(candidate));
  const uniqueCandidates = [...new Set(candidates)];
  return uniqueCandidates.find(hasCompleteCryptoManifest)
    ?? uniqueCandidates[0]
    ?? path.resolve(process.cwd(), 'crypto');
}

const PROJECT_PATH = resolveCryptoProjectPath();
const SCRIPT_PATH = path.join(PROJECT_PATH, 'run_agent.py');
const RUNTIME_DATA_PATH = path.resolve(process.env.EDITH_CRYPTO_RUNTIME_DATA_DIR
  || path.join(workspaceManager.getResolvedPaths()?.dataPath ?? path.join(process.cwd(), '.edith'), 'crypto'));
const LOG_PATH = process.env.EDITH_CRYPTO_LOG_PATH
  || path.join(workspaceManager.getResolvedPaths()?.logsPath ?? RUNTIME_DATA_PATH, 'crypto', 'edith-autostart.log');

function isPackagedRuntime(): boolean {
  return process.env.EDITH_PACKAGED === 'true'
    || Boolean(process.env.EDITH_APP_RESOURCE_DIR)
    || Boolean((process as NodeJS.Process & { resourcesPath?: string }).resourcesPath);
}

function existingAbsoluteFile(candidate: string | undefined): string | undefined {
  if (!candidate || !path.isAbsolute(candidate)) return undefined;
  try {
    return fs.statSync(candidate).isFile() ? path.resolve(candidate) : undefined;
  } catch {
    return undefined;
  }
}

function resolvePythonPath(): string {
  const explicit = process.env.EDITH_CRYPTO_PYTHON_PATH?.trim();
  if (explicit) {
    const resolved = existingAbsoluteFile(explicit);
    if (!resolved) throw new Error('runtime_missing');
    return resolved;
  }
  const resourceRoot = process.env.EDITH_APP_RESOURCE_DIR
    || (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  const candidates = [
    resourceRoot ? path.join(resourceRoot, 'python', 'python.exe') : undefined,
    path.join(PROJECT_PATH, '..', 'python', 'python.exe'),
    path.join(PROJECT_PATH, '.venv', 'Scripts', 'python.exe'),
    path.join(process.cwd(), '.venv', 'Scripts', 'python.exe'),
  ].filter((candidate): candidate is string => Boolean(candidate));
  const existing = candidates.map(existingAbsoluteFile).find(Boolean);
  if (isPackagedRuntime() && !existing) throw new Error('runtime_missing');
  return existing ?? (process.platform === 'win32' ? 'py' : 'python');
}

export class CryptoService {
  private child?: ChildProcessWithoutNullStreams;
  private startedAt?: string;
  private lastExit?: CryptoAgentStatus['lastExit'];
  private shutdownHooksRegistered = false;
  private internalToken?: string;

  internalRequestHeaders(): Record<string, string> {
    return this.internalToken ? { 'X-EDITH-Internal-Token': this.internalToken } : {};
  }

  async status(): Promise<CryptoAgentStatus> {
    const base = this.baseStatus();
    try {
      const healthResponse = await this.fetchWithTimeout(`${DASHBOARD_URL}/api/health`);
      const health = healthResponse.ok ? await healthResponse.json() : undefined;
      const healthRecord = health && typeof health === 'object' ? health as Record<string, unknown> : {};
      return {
        ...base,
        healthy: healthResponse.ok,
        health,
        runtime: healthRecord.runtime,
        obsidian: healthRecord.obsidian,
        error: healthResponse.ok ? undefined : `Crypto health check failed: ${healthResponse.status}`,
      };
    } catch (error) {
      return {
        ...base,
        healthy: false,
        error: this.readableConnectionError(error),
      };
    }
  }

  async start(reason = 'EDITH server startup'): Promise<CryptoAgentStatus> {
    const current = await this.status();
    if (current.healthy || this.child) {
      return current;
    }
    if (!hasCompleteCryptoManifest(PROJECT_PATH)) {
      return { ...current, error: 'Crypto runtime resources are incomplete or unavailable.', errorCode: 'resource_missing' };
    }
    let pythonPath: string;
    try {
      pythonPath = resolvePythonPath();
    } catch {
      return { ...current, error: 'Packaged Crypto Python runtime is unavailable.', errorCode: 'runtime_missing' };
    }
    const dependencyProbe = spawnSync(pythonPath, [
      '-I', '-c', 'import flask, ccxt, pandas, requests, dotenv, feedparser',
    ], { cwd: PROJECT_PATH, windowsHide: true, stdio: 'ignore', timeout: 10_000 });
    if (dependencyProbe.error || dependencyProbe.status !== 0) {
      return { ...current, pythonPath, error: 'Crypto Python dependencies are unavailable.', errorCode: 'dependency_missing' };
    }
    const obsidianVaultPath = workspaceManager.getResolvedPaths()?.obsidianVaultPath
      || process.env.OBSIDIAN_VAULT_PATH
      || process.env.EDITH_OBSIDIAN_VAULT_PATH
      || '';

    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    const out = fs.createWriteStream(LOG_PATH, { flags: 'a' });
    out.write(`\n[${new Date().toISOString()}] Starting crypto agent: ${reason}\n`);

    const internalToken = randomBytes(32).toString('base64url');
    const child = spawn(pythonPath, [SCRIPT_PATH], {
      cwd: PROJECT_PATH,
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
        EDITH_CRYPTO_AUTOSTART: 'true',
        EDITH_CRYPTO_RESOURCE_DIR: PROJECT_PATH,
        EDITH_CRYPTO_PROJECT_PATH: PROJECT_PATH,
        EDITH_CRYPTO_RUNTIME_DATA_DIR: RUNTIME_DATA_PATH,
        CRYPTO_MODE: 'OBSERVER_ONLY',
        TRADING_MODE: 'OBSERVER_ONLY',
        CRYPTO_TRADING_ENABLED: 'false',
        CRYPTO_PAPER_TRADING_ENABLED: 'false',
        CRYPTO_LIVE_TRADING_ENABLED: 'false',
        ENABLE_LIVE_TRADING: 'false',
        BINANCE_TRADING_ENABLED: 'false',
        CRYPTO_DEMO_TRADING_ENABLED: 'true',
        CRYPTO_STARTING_BALANCE: '10000',
        CRYPTO_DECISION_MODEL: 'jev',
        CRYPTO_OBSIDIAN_ENABLED: 'false',
        CRYPTO_LEARNING_ENABLED: 'false',
        CRYPTO_NEWS_ENABLED: 'false',
        CRYPTO_OLLAMA_ENABLED: 'false',
        JEV_API_KEY: process.env.JEV_API_KEY || '',
        JEV_API_URL: process.env.JEV_API_URL || 'https://api.typesafe.ai',
        JEV_MODEL: process.env.JEV_MODEL || 'jev-1.13.0',
        JEV_API_STYLE: process.env.JEV_API_STYLE || 'typesafe',
        EDITH_CRYPTO_INTERNAL_TOKEN: internalToken,
        EDITH_OBSIDIAN_VAULT_PATH: obsidianVaultPath,
        OBSIDIAN_VAULT_PATH: obsidianVaultPath,
      },
    });
    this.internalToken = internalToken;
    this.child = child;
    this.startedAt = new Date().toISOString();
    child.stdout.pipe(out);
    child.stderr.pipe(out);
    child.on('error', () => {
      if (this.child === child) {
        this.child = undefined;
        this.internalToken = undefined;
      }
      this.lastExit = { code: null, signal: null, at: new Date().toISOString() };
      out.write(`\n[${this.lastExit.at}] Crypto agent failed to start.\n`);
      out.end();
    });
    child.on('exit', (code, signal) => {
      this.lastExit = { code, signal, at: new Date().toISOString() };
      if (this.child === child) {
        this.child = undefined;
        this.internalToken = undefined;
      }
      out.write(`\n[${this.lastExit.at}] Crypto agent exited: code=${code} signal=${signal}\n`);
      out.end();
    });
    this.registerShutdownHooks();
    this.audit('crypto.autostart', reason, 'success');

    await this.waitForServiceReady();
    const readyStatus = await this.status();

    return {
      ...readyStatus,
      managedProcessRunning: true,
      startedAt: this.startedAt,
      error: readyStatus.healthy ? readyStatus.error : readyStatus.error ?? 'Crypto service started but health endpoint did not become ready.',
    };
  }

  async startObserver(reason = 'Manual observer start from EDITH Crypto view'): Promise<CryptoAgentStatus> {
    let current = await this.status();
    if (!current.healthy) {
      current = await this.start(reason);
      await this.waitForServiceReady();
    }
    const response = await this.fetchWithTimeout(`${DASHBOARD_URL}/api/crypto/start-observer`, {
      method: 'POST',
    });
    if (!response.ok) {
      const body = await response.text();
      return { ...(await this.status()), error: body || `Observer start failed: ${response.status}` };
    }
    this.audit('crypto.observer_start', reason, 'success');
    return this.status();
  }

  async stopObserver(reason = 'Manual observer stop from EDITH Crypto view'): Promise<CryptoAgentStatus> {
    const current = await this.status();
    if (!current.healthy) return current;
    const response = await this.fetchWithTimeout(`${DASHBOARD_URL}/api/crypto/stop-observer`, {
      method: 'POST',
    });
    if (!response.ok) {
      const body = await response.text();
      return { ...(await this.status()), error: body || `Observer stop failed: ${response.status}` };
    }
    this.audit('crypto.observer_stop', reason, 'success');
    return this.status();
  }

  stop(reason = 'EDITH server shutdown'): CryptoAgentStatus {
    const child = this.child;
    this.child = undefined;
    this.internalToken = undefined;
    if (child) {
      child.kill();
      this.audit('crypto.stop', reason, 'success');
    }
    return this.baseStatus();
  }

  private baseStatus(): CryptoAgentStatus {
    let pythonPath = '';
    let runtimeError: CryptoAgentStatus['errorCode'];
    try {
      pythonPath = resolvePythonPath();
    } catch {
      runtimeError = 'runtime_missing';
    }
    return {
      dashboardUrl: DASHBOARD_URL,
      projectPath: PROJECT_PATH,
      healthy: false,
      managedProcessRunning: Boolean(this.child),
      autoStartEnabled: process.env.EDITH_CRYPTO_AUTOSTART === 'true',
      pythonPath,
      scriptPath: SCRIPT_PATH,
      logPath: LOG_PATH,
      startedAt: this.startedAt,
      lastExit: this.lastExit,
      ...(runtimeError ? { errorCode: runtimeError, error: 'Packaged Crypto Python runtime is unavailable.' } : {}),
    };
  }

  private registerShutdownHooks(): void {
    if (this.shutdownHooksRegistered) return;
    this.shutdownHooksRegistered = true;
    const stop = () => {
      if (this.child) this.child.kill();
    };
    process.once('exit', stop);
  }

  private async fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500);
    try {
      const headers = new Headers(init?.headers);
      if (init?.method && !['GET', 'HEAD', 'OPTIONS'].includes(init.method.toUpperCase())) {
        for (const [name, value] of Object.entries(this.internalRequestHeaders())) headers.set(name, value);
      }
      return await fetch(url, { ...init, headers, signal: controller.signal });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async waitForServiceReady(): Promise<void> {
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline) {
      try {
        const response = await this.fetchWithTimeout(`${DASHBOARD_URL}/api/health`);
        if (response.ok) return;
      } catch {
        // Service is still starting.
      }
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
  }

  private readableConnectionError(error: unknown): string {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return 'Crypto dashboard zaman aşımına uğradı; servis açılıyor olabilir.';
    }
    const message = error instanceof Error ? error.message : String(error);
    if (message === 'fetch failed' || /ECONNREFUSED|UND_ERR_SOCKET|ENOTFOUND/i.test(message)) {
      return 'Crypto dashboard henüz yanıt vermiyor; agent başlatılıyor olabilir.';
    }
    return message;
  }

  private audit(action: string, message: string, result: 'success' | 'error'): void {
    appendAuditEvent(createAuditEvent({
      actor: 'edith-crypto-service',
      action,
      toolId: 'crypto_agent',
      target: PROJECT_PATH,
      authorization: 'allowed',
      riskLevel: 2,
      result,
      message,
    }));
  }
}

export const cryptoService = new CryptoService();
