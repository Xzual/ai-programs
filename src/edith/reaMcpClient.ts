import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { TextDecoder } from 'node:util';

/** Trusted server composition supplies the complete launch; never accept it from a tool payload. */
export interface ReaMcpLaunch {
  command: string;
  args: readonly string[];
  cwd: string;
  env: Readonly<Record<string, string>>;
  expectedServerName: string;
  expectedServerVersion: string;
  protocolVersion: string;
  timeoutMs?: number;
  maxFrameBytes?: number;
  maxTotalBytes?: number;
}
export interface ReaMcpCloseReceipt { closed: boolean; unknownEffect: boolean }
export interface ReaMcpProgress { sequence: number; message?: string }
export interface ReaMcpTool { name: string; inputSchema: unknown }
export interface ReaMcpCallOptions {
  signal?: AbortSignal;
  onProgress?: (event: ReaMcpProgress) => void;
}
export class ReaMcpError extends Error {
  constructor(code: string, readonly closed: boolean, readonly unknownEffect: boolean) {
    super(code); this.name = 'ReaMcpError';
  }
}
type Pending = {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
  cleanup(): void;
  progressToken?: string;
  sequence: number;
  onProgress?: (event: ReaMcpProgress) => void;
};
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, limit: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= limit && !value.includes('\0');
const limit = (value: number | undefined, fallback: number, maximum: number) => {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 1 || result > maximum) throw new Error('REA_MCP_INVALID_LIMIT');
  return result;
};

/** Bounded MCP 2025-11-25 JSON-RPC over LF-delimited stdio; no inherited environment. */
export class ReaMcpClient {
  private readonly launch: ReaMcpLaunch;
  private readonly timeoutMs: number;
  private readonly maxFrameBytes: number;
  private readonly maxTotalBytes: number;
  private child?: ChildProcessWithoutNullStreams;
  private state: 'new' | 'connecting' | 'ready' | 'closing' | 'closed' = 'new';
  private connectPromise?: Promise<{ serverInfo: { name: string; version: string }; tools: readonly ReaMcpTool[] }>;
  private closePromise?: Promise<ReaMcpCloseReceipt>;
  private readonly pending = new Map<number, Pending>();
  private readonly tools = new Set<string>();
  private buffer: Buffer = Buffer.alloc(0);
  private totalBytes = 0;
  private outgoingBytes = 0;
  private requestId = 0;
  private closeSeen = false;
  private spawnFailed = false;
  private failure?: string;
  private effectsPending = false;
  private unknownEffect = false;

  constructor(launch: ReaMcpLaunch) {
    if (!isAbsolute(launch.command) || !isAbsolute(launch.cwd)
      || !text(launch.command, 4096) || !text(launch.cwd, 4096)
      || !Array.isArray(launch.args) || launch.args.length > 128 || launch.args.some(arg => typeof arg !== 'string' || arg.length > 8192 || arg.includes('\0'))
      || !record(launch.env) || Object.keys(launch.env).length > 128
      || Object.entries(launch.env).some(([key, value]) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || typeof value !== 'string' || value.length > 32768 || value.includes('\0'))
      || !text(launch.expectedServerName, 160) || !text(launch.expectedServerVersion, 80)
      || launch.protocolVersion !== '2025-11-25') throw new Error('REA_MCP_INVALID_LAUNCH');
    this.timeoutMs = limit(launch.timeoutMs, 30000, 120000);
    this.maxFrameBytes = limit(launch.maxFrameBytes, 1024 * 1024, 10 * 1024 * 1024);
    this.maxTotalBytes = limit(launch.maxTotalBytes, 10 * 1024 * 1024, 100 * 1024 * 1024);
    this.launch = { ...launch, args: Object.freeze([...launch.args]), env: Object.freeze({ ...launch.env }) };
  }

  connect(): Promise<{ serverInfo: { name: string; version: string }; tools: readonly ReaMcpTool[] }> {
    if (this.connectPromise) return this.connectPromise;
    if (this.state !== 'new') return Promise.reject(new ReaMcpError('REA_MCP_CLOSED', this.closeSeen, this.unknownEffect));
    this.state = 'connecting';
    this.connectPromise = this.admit();
    return this.connectPromise;
  }

  private async admit() {
    const deadline = Date.now() + this.timeoutMs;
    try {
      this.child = spawn(this.launch.command, [...this.launch.args], {
        cwd: this.launch.cwd, env: { ...this.launch.env }, windowsHide: true, shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      this.child.on('error', () => { this.spawnFailed = !this.child?.pid; void this.stop('REA_MCP_SPAWN_FAILED'); });
      this.child.stdin.on('error', () => { void this.stop('REA_MCP_STDIN_FAILED'); });
      this.child.stdout.on('error', () => { void this.stop('REA_MCP_STDOUT_FAILED'); });
      this.child.stderr.on('error', () => { void this.stop('REA_MCP_STDERR_FAILED'); });
      this.child.stdout.on('data', (chunk: Buffer) => this.receive(chunk));
      this.child.stderr.on('data', (chunk: Buffer) => {
        // Count and discard diagnostics: no raw process output or command lines escape this client.
        this.totalBytes += chunk.length;
        if (this.totalBytes > this.maxTotalBytes) void this.stop('REA_MCP_TOTAL_BYTES_EXCEEDED');
      });
      this.child.on('close', () => {
        this.closeSeen = true;
        if (this.state !== 'closing' && this.state !== 'closed') void this.stop('REA_MCP_PEER_CLOSED');
      });
      const initialized = await this.request('initialize', {
        protocolVersion: this.launch.protocolVersion, capabilities: {},
        clientInfo: { name: 'edith-rea', version: '1.0.0' },
      }, deadline);
      if (!record(initialized) || initialized.protocolVersion !== this.launch.protocolVersion
        || !record(initialized.serverInfo) || initialized.serverInfo.name !== this.launch.expectedServerName
        || initialized.serverInfo.version !== this.launch.expectedServerVersion
        || !record(initialized.capabilities) || !record(initialized.capabilities.tools)) throw new Error('REA_MCP_IDENTITY_OR_CAPABILITIES');
      this.write({ jsonrpc: '2.0', method: 'notifications/initialized' });
      const tools: ReaMcpTool[] = [];
      const cursors = new Set<string>();
      let cursor: string | undefined;
      for (let page = 0; page < 16; page++) {
        const listed = await this.request('tools/list', cursor ? { cursor } : {}, deadline);
        if (!record(listed) || !Array.isArray(listed.tools) || listed.tools.length > 256) throw new Error('REA_MCP_CATALOG_INVALID');
        for (const tool of listed.tools) {
          if (!record(tool) || !text(tool.name, 160) || !record(tool.inputSchema) || tool.inputSchema.type !== 'object' || this.tools.has(tool.name) || tools.length >= 256) throw new Error('REA_MCP_CATALOG_INVALID');
          this.tools.add(tool.name);
          tools.push({ name: tool.name, inputSchema: structuredClone(tool.inputSchema) });
        }
        if (listed.nextCursor === undefined) {
          if (!tools.length || this.state !== 'connecting') throw new Error('REA_MCP_CATALOG_EMPTY_OR_CLOSED');
          this.state = 'ready';
          return { serverInfo: { name: this.launch.expectedServerName, version: this.launch.expectedServerVersion }, tools: Object.freeze(tools) };
        }
        if (!text(listed.nextCursor, 1024) || cursors.has(listed.nextCursor)) throw new Error('REA_MCP_CATALOG_CURSOR');
        cursor = listed.nextCursor; cursors.add(cursor);
      }
      throw new Error('REA_MCP_CATALOG_PAGE_LIMIT');
    } catch (error) {
      const receipt = await this.stop(error instanceof Error && error.message.startsWith('REA_MCP_') ? error.message : 'REA_MCP_ADMISSION_FAILED');
      throw new ReaMcpError(this.failure ?? 'REA_MCP_ADMISSION_FAILED', receipt.closed, receipt.unknownEffect);
    }
  }

  async callTool(name: string, args: Readonly<Record<string, unknown>>, options: ReaMcpCallOptions = {}): Promise<unknown> {
    if (this.state !== 'ready') throw new ReaMcpError(this.failure ?? 'REA_MCP_NOT_READY', this.closeSeen, this.unknownEffect);
    if (!this.tools.has(name)) throw new ReaMcpError('REA_MCP_TOOL_NOT_LISTED', false, false);
    if (!record(args) || this.pending.size) throw new ReaMcpError('REA_MCP_INVALID_ARGS_OR_BUSY', false, false);
    if (options.signal?.aborted) throw new ReaMcpError('REA_MCP_CANCELLED_BEFORE_DISPATCH', false, false);
    const result = await this.request('tools/call', { name, arguments: structuredClone(args) }, Date.now() + this.timeoutMs, options);
    if (this.state !== 'ready' || !record(result) || !Array.isArray(result.content) || result.content.length > 1024
      || result.content.some(item => !record(item) || !text(item.type, 80))
      || (result.isError !== undefined && typeof result.isError !== 'boolean')
      || (result.structuredContent !== undefined && !record(result.structuredContent))) {
      const receipt = await this.stop('REA_MCP_RESULT_INVALID');
      throw new ReaMcpError(this.failure ?? 'REA_MCP_RESULT_INVALID', receipt.closed, receipt.unknownEffect);
    }
    this.effectsPending = false;
    return result;
  }

  private request(method: string, params: Record<string, unknown>, deadline: number, options: ReaMcpCallOptions = {}): Promise<unknown> {
    if (deadline <= Date.now()) return this.stop('REA_MCP_TIMEOUT').then(receipt => { throw new ReaMcpError('REA_MCP_TIMEOUT', receipt.closed, receipt.unknownEffect); });
    const id = ++this.requestId;
    const progressToken = method === 'tools/call' ? `edith-rea-${id}` : undefined;
    return new Promise((resolve, reject) => {
      const abort = () => {
        try { this.write({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: id, reason: 'EDITH request cancelled' } }); } catch { /* Teardown remains mandatory if notification cannot be written. */ }
        void this.stop('REA_MCP_CANCELLED');
      };
      const timer = setTimeout(() => {
        if (method === 'tools/call') {
          try { this.write({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: id, reason: 'EDITH request deadline' } }); } catch { /* Teardown below. */ }
        }
        void this.stop('REA_MCP_TIMEOUT');
      }, Math.max(1, deadline - Date.now()));
      this.pending.set(id, { resolve, reject, timer, cleanup: () => options.signal?.removeEventListener('abort', abort),
        progressToken, sequence: 0, onProgress: options.onProgress });
      options.signal?.addEventListener('abort', abort, { once: true });
      try {
        this.write({ jsonrpc: '2.0', id, method, params: progressToken ? { ...params, _meta: { progressToken } } : params });
        if (method === 'tools/call') this.effectsPending = true;
        if (options.signal?.aborted) abort();
      } catch { void this.stop('REA_MCP_WRITE_FAILED'); }
    });
  }

  private write(message: Record<string, unknown>): void {
    if (!this.child || this.state === 'closing' || this.state === 'closed' || this.child.stdin.destroyed) throw new Error('REA_MCP_CLOSED');
    const bytes = Buffer.from(JSON.stringify(message) + '\n', 'utf8');
    this.outgoingBytes += bytes.length;
    if (bytes.length > this.maxFrameBytes || this.outgoingBytes > this.maxTotalBytes) throw new Error('REA_MCP_OUTGOING_LIMIT');
    this.child.stdin.write(bytes);
  }

  private receive(chunk: Buffer): void {
    if (this.state === 'closing' || this.state === 'closed') return;
    this.totalBytes += chunk.length;
    if (this.totalBytes > this.maxTotalBytes) { void this.stop('REA_MCP_TOTAL_BYTES_EXCEEDED'); return; }
    this.buffer = Buffer.concat([this.buffer, chunk]);
    try {
      let newline: number;
      while ((newline = this.buffer.indexOf(10)) !== -1) {
        if (newline > this.maxFrameBytes) throw new Error('REA_MCP_FRAME_LIMIT');
        const line = this.buffer.subarray(0, newline);
        this.buffer = this.buffer.subarray(newline + 1);
        const message: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(line));
        this.message(message);
        if (this.closePromise) return;
      }
      if (this.buffer.length > this.maxFrameBytes) throw new Error('REA_MCP_FRAME_LIMIT');
    } catch (error) { void this.stop(error instanceof Error && error.message.startsWith('REA_MCP_') ? error.message : 'REA_MCP_MALFORMED_FRAME'); }
  }

  private message(message: unknown): void {
    if (!record(message) || message.jsonrpc !== '2.0') throw new Error('REA_MCP_INVALID_ENVELOPE');
    if (message.method !== undefined) {
      if (message.method !== 'notifications/progress' || message.id !== undefined || !record(message.params)) throw new Error('REA_MCP_UNEXPECTED_MESSAGE');
      const params = message.params;
      const pending = [...this.pending.values()].find(item => item.progressToken !== undefined && item.progressToken === params.progressToken);
      if (!pending || typeof params.progress !== 'number' || !Number.isSafeInteger(params.progress) || params.progress <= pending.sequence
        || (params.message !== undefined && (typeof params.message !== 'string' || params.message.length > 1000))) throw new Error('REA_MCP_INVALID_PROGRESS');
      pending.sequence = params.progress;
      pending.onProgress?.({ sequence: pending.sequence, ...(typeof params.message === 'string' ? { message: params.message } : {}) });
      return;
    }
    if (!Number.isSafeInteger(message.id) || typeof message.id !== 'number' || !this.pending.has(message.id)
      || (Object.hasOwn(message, 'result') === Object.hasOwn(message, 'error'))) throw new Error('REA_MCP_UNEXPECTED_REPLY');
    const pending = this.pending.get(message.id)!;
    if (message.error !== undefined) {
      if (!record(message.error) || !Number.isSafeInteger(message.error.code) || typeof message.error.message !== 'string') throw new Error('REA_MCP_INVALID_ERROR');
      // Never forward untrusted diagnostic/error text to callers or evidence.
      throw new Error('REA_MCP_REMOTE_ERROR');
    }
    if (!record(message.result)) throw new Error('REA_MCP_INVALID_RESULT');
    this.pending.delete(message.id); clearTimeout(pending.timer); pending.cleanup(); pending.resolve(message.result);
  }

  close(): Promise<ReaMcpCloseReceipt> { return this.stop(); }

  private stop(code?: string): Promise<ReaMcpCloseReceipt> {
    if (code && !this.failure) this.failure = code;
    if (this.closePromise) return this.closePromise;
    this.unknownEffect ||= this.effectsPending;
    this.state = 'closing';
    this.closePromise = this.closeOwnedChild().then(receipt => {
      this.state = 'closed'; this.buffer = Buffer.alloc(0);
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer); pending.cleanup();
        pending.reject(new ReaMcpError(this.failure ?? 'REA_MCP_CLOSED', receipt.closed, receipt.unknownEffect));
      }
      this.pending.clear();
      return receipt;
    });
    return this.closePromise;
  }

  private async closeOwnedChild(): Promise<ReaMcpCloseReceipt> {
    const child = this.child;
    if (!child) return { closed: true, unknownEffect: this.unknownEffect };
    const wait = () => new Promise<void>(resolve => {
      if (this.closeSeen || this.spawnFailed) { resolve(); return; }
      const done = () => { clearTimeout(timer); child.removeListener('close', done); resolve(); };
      const timer = setTimeout(done, 200);
      child.once('close', done);
    });
    child.stdin.end();
    await wait();
    for (const signal of ['SIGTERM', 'SIGKILL'] as const) {
      if (this.closeSeen || this.spawnFailed) break;
      try { child.kill(signal); } catch { /* Original handle only; unknown closure is reported below. */ }
      await wait();
    }
    const closed = this.closeSeen || this.spawnFailed;
    this.unknownEffect ||= !closed;
    child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy();
    if (!closed) child.unref();
    return { closed, unknownEffect: this.unknownEffect };
  }
}
