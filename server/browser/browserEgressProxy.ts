import http from 'node:http';
import https from 'node:https';
import net, { type Socket } from 'node:net';
import { lookup } from 'node:dns/promises';
import { timingSafeEqual } from 'node:crypto';
import { ResearchSsrfPolicy } from '../../src/edith/researchSsrfPolicy';

export interface BrowserProxyCredentials { username: string; password: string; }
interface ProxyOptions {
  fixtureOrigins?: string[];
  resolver?: (host: string) => Promise<string[]>;
  credentials?: BrowserProxyCredentials;
  beforeConnect?: (url: string) => void;
}
const DEADLINE_MS = 20_000;
const BODY_LIMIT = 8 * 1024 * 1024;
const TUNNEL_LIMIT = 16 * 1024 * 1024;
const MAX_CONNECTIONS = 32;
const SECRET_QUERY = /^(?:token|access_token|refresh_token|api[_-]?key|apikey|key|signature|secret|password|credential|authorization|auth)$/i;
const failure = () => new Error('BROWSER_EGRESS_BLOCKED');

function bounded<T>(operation: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(failure()), DEADLINE_MS);
    operation.then(result => { clearTimeout(timer); resolve(result); }, () => { clearTimeout(timer); reject(failure()); });
  });
}

/** The browser retains URL authority/Host and TLS SNI; sockets use only the validated IP. */
export class BrowserEgressProxy {
  private readonly fixtureOrigins = new Set<string>();
  private readonly resolver: (host: string) => Promise<string[]>;
  private readonly sockets = new Set<Socket>();
  private readonly policy = new ResearchSsrfPolicy();
  private readonly counts = { allowed: 0, blocked: 0, connections: 0 };
  private server?: http.Server;
  private starting?: Promise<string>;
  private running = false;
  private readonly expectedAuthorization?: Buffer;
  private readonly beforeConnect?: (url: string) => void;

  constructor(options: ProxyOptions = {}) {
    this.beforeConnect = options.beforeConnect;
    if (options.credentials) {
      const { username, password } = options.credentials;
      if (typeof username !== 'string' || typeof password !== 'string'
        || !/^[\x21-\x7e]{1,128}$/.test(username) || username.includes(':') || !/^[\x20-\x7e]{1,128}$/.test(password)) throw failure();
      this.expectedAuthorization = Buffer.from(`Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`);
    }
    if (options.fixtureOrigins?.length && process.env.EDITH_TEST_MODE !== 'true') throw failure();
    if ((options.fixtureOrigins?.length ?? 0) > 16) throw failure();
    for (const raw of options.fixtureOrigins ?? []) {
      let url: URL;
      try { url = new URL(raw); } catch { throw failure(); }
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port === '5186'
        || url.pathname !== '/' || url.search || url.hash || raw.includes('\\')) throw failure();
      this.fixtureOrigins.add(url.origin);
    }
    this.resolver = options.resolver ?? (async host => (await lookup(host, { all: true, verbatim: true })).map(result => result.address));
  }

  get diagnostics(): { allowed: number; blocked: number; connections: number } { return { ...this.counts }; }

  async assertAllowedUrl(url: string): Promise<void> { await this.target(url); }

  private authenticated(req: http.IncomingMessage): boolean {
    const header = req.headers['proxy-authorization'];
    if (!this.expectedAuthorization) return !header;
    if (typeof header !== 'string' || header.length > 512) return false;
    const supplied = Buffer.from(header);
    return supplied.length === this.expectedAuthorization.length && timingSafeEqual(supplied, this.expectedAuthorization);
  }

  private async target(raw: string): Promise<{ url: URL; address: string; port: number }> {
    try {
      if (raw.length > 4096 || /[\s\\]/.test(raw)) throw failure();
      const url = new URL(raw);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
        || [...url.searchParams.keys()].some(key => SECRET_QUERY.test(key))) throw failure();
      const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
      if (!Number.isInteger(port) || port < 1 || port > 65535 || port === 5186) throw failure();
      const host = url.hostname.replace(/^\[|\]$/g, '');
      let addresses: string[];
      if (this.fixtureOrigins.has(url.origin)) {
        if (process.env.EDITH_TEST_MODE !== 'true') throw failure();
        addresses = net.isIP(host) ? [host] : await bounded(this.resolver(host));
        // Exact test origin still requires exclusively controlled loopback destinations.
        if (!addresses.length || addresses.some(address => address !== '127.0.0.1' && address !== '::1')) throw failure();
      } else {
        const result = await bounded(this.policy.validate(url.toString(), { resolverId: 'browser-egress-pinned-v1', resolve: this.resolver }));
        if (result.decision !== 'allowed') throw failure();
        addresses = result.resolvedAddresses;
      }
      if (addresses.length > 32 || !addresses[0] || !net.isIP(addresses[0])) throw failure();
      this.counts.allowed++;
      return { url, address: addresses[0], port };
    } catch { this.counts.blocked++; throw failure(); }
  }

  async start(): Promise<string> {
    if (this.starting) return this.starting;
    if (this.server) throw failure();
    this.starting = new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => { void this.forward(req, res); });
      this.server = server;
      server.maxHeadersCount = 64;
      server.headersTimeout = DEADLINE_MS;
      server.requestTimeout = DEADLINE_MS;
      server.on('connection', socket => {
        if (this.sockets.size >= MAX_CONNECTIONS * 2) { this.counts.blocked++; socket.destroy(); return; }
        this.track(socket);
      });
      server.on('connect', (req, socket, head) => { void this.tunnel(req, socket as Socket, head); });
      server.on('upgrade', (_req, socket) => { this.counts.blocked++; socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 22\r\n\r\nBROWSER_EGRESS_BLOCKED\n'); });
      server.on('clientError', (_error, socket) => socket.destroy());
      server.once('error', () => { this.running = false; this.server = undefined; reject(failure()); });
      server.listen(0, '127.0.0.1', () => {
        this.running = true;
        const address = server.address();
        if (!address || typeof address === 'string') return reject(failure());
        resolve(`http://127.0.0.1:${address.port}`);
      });
    });
    try { return await this.starting; } catch { this.starting = undefined; throw failure(); }
  }

  private track(socket: Socket): void {
    this.sockets.add(socket);
    socket.once('close', () => this.sockets.delete(socket));
    socket.on('error', () => { /* Safe failure is emitted at the request boundary. */ });
  }

  private async forward(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (!this.authenticated(req)) {
      this.counts.blocked++;
      res.writeHead(407, { 'proxy-authenticate': 'Basic realm="EDITH browser"', 'content-type': 'text/plain', connection: 'close' });
      res.end('BROWSER_PROXY_AUTH_REQUIRED\n');
      return;
    }
    let upstream: http.ClientRequest | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deny = () => {
      upstream?.destroy();
      if (!res.headersSent) { res.writeHead(403, { 'content-type': 'text/plain', connection: 'close' }); res.end('BROWSER_EGRESS_BLOCKED\n'); }
      else res.destroy();
    };
    try {
      if (!this.running || !req.url || !/^(?:GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)$/.test(req.method ?? '') || req.headers.authorization) throw failure();
      this.beforeConnect?.(req.url);
      const target = await this.target(req.url);
      if (!this.running || this.sockets.size > MAX_CONNECTIONS * 2) throw failure();
      const length = Number(req.headers['content-length'] ?? 0);
      if (!Number.isFinite(length) || length > BODY_LIMIT || length < 0) throw failure();
      const headers = { ...req.headers, host: target.url.host };
      const hopHeaders = ['connection', 'proxy-connection', 'proxy-authenticate', 'proxy-authorization', 'keep-alive', 'te', 'trailer', 'transfer-encoding', 'upgrade', ...(String(req.headers.connection ?? '').split(',').map(value => value.trim().toLowerCase()))];
      for (const key of hopHeaders) delete headers[key];
      headers.host = target.url.host;
      this.beforeConnect?.(target.url.toString());
      upstream = (target.url.protocol === 'https:' ? https : http).request({
        protocol: target.url.protocol, hostname: target.address, port: target.port,
        servername: target.url.hostname.replace(/^\[|\]$/g, ''), path: `${target.url.pathname}${target.url.search}`,
        method: req.method, headers, agent: false,
      }, response => {
        const responseHeaders = { ...response.headers };
        for (const key of hopHeaders) delete responseHeaders[key];
        res.writeHead(response.statusCode ?? 502, responseHeaders);
        let responseBytes = 0;
        response.on('data', (chunk: Buffer) => { responseBytes += chunk.length; if (responseBytes > BODY_LIMIT) { this.counts.blocked++; response.destroy(); deny(); } });
        response.on('error', deny);
        response.pipe(res);
      });
      this.counts.connections++;
      upstream.on('socket', socket => this.track(socket));
      upstream.on('error', deny);
      timer = setTimeout(() => { this.counts.blocked++; deny(); }, DEADLINE_MS);
      res.once('close', () => { if (timer) clearTimeout(timer); upstream?.destroy(); });
      req.once('aborted', deny);
      let requestBytes = 0;
      req.on('data', (chunk: Buffer) => { requestBytes += chunk.length; if (requestBytes > BODY_LIMIT) { this.counts.blocked++; deny(); req.destroy(); } });
      req.pipe(upstream);
    } catch { this.counts.blocked++; if (timer) clearTimeout(timer); deny(); }
  }

  private async tunnel(req: http.IncomingMessage, client: Socket, head: Buffer): Promise<void> {
    if (!this.authenticated(req)) {
      this.counts.blocked++;
      const body = 'BROWSER_PROXY_AUTH_REQUIRED\n';
      client.end(`HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="EDITH browser"\r\nConnection: close\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
      return;
    }
    let upstream: Socket | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let established = false;
    const deny = () => { upstream?.destroy(); if (established) client.destroy(); else if (!client.destroyed) client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 22\r\n\r\nBROWSER_EGRESS_BLOCKED\n'); };
    try {
      if (!this.running || !req.url || head.length > 16 * 1024 || req.headers.authorization
        || !/^(?:\[[0-9a-fA-F:]+\]|[A-Za-z0-9.-]+):[0-9]{1,5}$/.test(req.url)) throw failure();
      const url = `https://${req.url}/`;
      this.beforeConnect?.(url);
      const target = await this.target(url);
      if (!this.running) throw failure();
      this.beforeConnect?.(target.url.toString());
      upstream = net.connect({ host: target.address, port: target.port });
      this.track(upstream);
      this.counts.connections++;
      const socket = upstream;
      timer = setTimeout(() => { this.counts.blocked++; socket.destroy(); client.destroy(); }, DEADLINE_MS);
      client.once('close', () => { if (timer) clearTimeout(timer); socket.destroy(); });
      socket.once('close', () => { if (timer) clearTimeout(timer); client.destroy(); });
      socket.once('error', deny);
      let transferred = head.length;
      const count = (chunk: Buffer) => { transferred += chunk.length; if (transferred > TUNNEL_LIMIT) { this.counts.blocked++; socket.destroy(); client.destroy(); } };
      client.on('data', count); socket.on('data', count);
      socket.once('connect', () => {
        if (!this.running || client.destroyed) return socket.destroy();
        established = true;
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length) socket.write(head);
        client.pipe(socket); socket.pipe(client);
      });
    } catch { this.counts.blocked++; deny(); }
  }

  async close(): Promise<void> {
    if (this.starting) await this.starting.catch(() => undefined);
    this.running = false;
    const server = this.server;
    for (const socket of this.sockets) socket.destroy();
    if (server) await new Promise<void>(resolve => server.close(() => resolve()));
    this.server = undefined;
    this.starting = undefined;
  }
}
