import fs from 'fs';
import path from 'path';
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { appendAuditEvent, createAuditEvent } from './audit';

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
  overview?: unknown;
  error?: string;
}

const DASHBOARD_URL = process.env.EDITH_CRYPTO_DASHBOARD_URL || 'http://localhost:5000';
const PROJECT_PATH = process.env.EDITH_CRYPTO_PROJECT_PATH || path.join(process.cwd(), 'crypto');
const PYTHON_PATH = process.env.EDITH_CRYPTO_PYTHON_PATH || path.join(PROJECT_PATH, '.venv', 'Scripts', 'python.exe');
const SCRIPT_PATH = path.join(PROJECT_PATH, 'run_agent.py');
const LOG_PATH = path.join(PROJECT_PATH, 'logs', 'edith-autostart.log');

export class CryptoService {
  private child?: ChildProcessWithoutNullStreams;
  private startedAt?: string;
  private lastExit?: CryptoAgentStatus['lastExit'];
  private shutdownHooksRegistered = false;

  async status(): Promise<CryptoAgentStatus> {
    const base = this.baseStatus();
    try {
      const [healthResponse, overviewResponse] = await Promise.all([
        this.fetchWithTimeout(`${DASHBOARD_URL}/health`),
        this.fetchWithTimeout(`${DASHBOARD_URL}/api/overview`),
      ]);
      return {
        ...base,
        healthy: healthResponse.ok,
        overview: overviewResponse.ok ? await overviewResponse.json() : undefined,
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
    if (!fs.existsSync(PROJECT_PATH)) {
      return { ...current, error: `Crypto project path not found: ${PROJECT_PATH}` };
    }
    if (!fs.existsSync(PYTHON_PATH)) {
      return { ...current, error: `Crypto Python runtime not found: ${PYTHON_PATH}` };
    }
    if (!fs.existsSync(SCRIPT_PATH)) {
      return { ...current, error: `Crypto agent script not found: ${SCRIPT_PATH}` };
    }

    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    const out = fs.createWriteStream(LOG_PATH, { flags: 'a' });
    out.write(`\n[${new Date().toISOString()}] Starting crypto agent: ${reason}\n`);

    this.child = spawn(PYTHON_PATH, [SCRIPT_PATH], {
      cwd: PROJECT_PATH,
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
      },
    });
    this.startedAt = new Date().toISOString();
    this.child.stdout.pipe(out);
    this.child.stderr.pipe(out);
    this.child.on('exit', (code, signal) => {
      this.lastExit = { code, signal, at: new Date().toISOString() };
      this.child = undefined;
      out.write(`\n[${this.lastExit.at}] Crypto agent exited: code=${code} signal=${signal}\n`);
      out.end();
    });
    this.registerShutdownHooks();
    this.audit('crypto.autostart', reason, 'success');

    return {
      ...this.baseStatus(),
      healthy: false,
      managedProcessRunning: true,
      startedAt: this.startedAt,
    };
  }

  stop(reason = 'EDITH server shutdown'): CryptoAgentStatus {
    if (this.child) {
      this.child.kill();
      this.audit('crypto.stop', reason, 'success');
    }
    return this.baseStatus();
  }

  private baseStatus(): CryptoAgentStatus {
    return {
      dashboardUrl: DASHBOARD_URL,
      projectPath: PROJECT_PATH,
      healthy: false,
      managedProcessRunning: Boolean(this.child),
      autoStartEnabled: process.env.EDITH_CRYPTO_AUTOSTART !== 'false',
      pythonPath: PYTHON_PATH,
      scriptPath: SCRIPT_PATH,
      logPath: LOG_PATH,
      startedAt: this.startedAt,
      lastExit: this.lastExit,
    };
  }

  private registerShutdownHooks(): void {
    if (this.shutdownHooksRegistered) return;
    this.shutdownHooksRegistered = true;
    const stop = () => {
      if (this.child) this.child.kill();
    };
    process.once('exit', stop);
    process.once('SIGINT', () => {
      stop();
      process.exit(130);
    });
    process.once('SIGTERM', () => {
      stop();
      process.exit(143);
    });
  }

  private async fetchWithTimeout(url: string): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1200);
    try {
      return await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timeoutId);
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
