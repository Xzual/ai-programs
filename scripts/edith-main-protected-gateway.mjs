import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { Transform, Readable } from 'node:stream';
import { TextDecoder } from 'node:util';

export const GATEWAY_COOKIE_NAME = '__Host-edith_gateway_session';
const MAX_BODY = 4 * 1024 * 1024;
const MAX_RESPONSE = 64 * 1024 * 1024;
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']);
const CRITICAL = new Set(['host', 'authorization', 'cookie', 'origin', 'referer', 'content-length', 'set-cookie', 'location',
  'sec-websocket-key', 'sec-websocket-accept', 'sec-websocket-protocol', 'sec-websocket-version']);
const SECURITY = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin', 'x-frame-options': 'DENY' };
const fault = status => Object.assign(Error('GATEWAY_BOUNDARY_DENIED'), { status });
const uniqueHeaders = ['host', 'authorization', 'cookie', 'origin', 'referer', 'content-length', 'transfer-encoding',
  'forwarded', 'x-forwarded-host', 'x-forwarded-proto', 'sec-websocket-key', 'sec-websocket-version', 'sec-websocket-protocol'];
function count(req, name) { return req.rawHeaders.filter((key, i) => i % 2 === 0 && key.toLowerCase() === name).length; }
function canonicalOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || value !== url.origin || url.username || url.password
    || !/^[a-z0-9.-]{1,253}$/.test(url.hostname) || url.hostname.includes('..')) throw Error('INVALID_PUBLIC_ORIGIN');
  return url;
}
function targetValid(target) {
  if (typeof target !== 'string' || Buffer.byteLength(target) > 8192 || !target.startsWith('/') || target.startsWith('//')
    || /[\\#\x00-\x20\x7f]/.test(target)) return false;
  const [rawPath] = target.split('?');
  if (/%(?:2f|5c|3f|23|00|25)/i.test(rawPath)) return false;
  try {
    const decoded = decodeURIComponent(rawPath);
    const query = target.includes('?') ? decodeURIComponent(target.slice(target.indexOf('?') + 1)) : '';
    return !/[\x00-\x1f\x7f]/.test(decoded + query) && !decoded.split('/').some(part => part === '.' || part === '..');
  } catch { return false; }
}
function connectionTokens(headers) {
  const value = headers.connection ?? '';
  if (typeof value !== 'string') throw fault(400);
  const tokens = value.split(',').map(item => item.trim().toLowerCase()).filter(Boolean);
  if (tokens.some(item => !/^[a-z0-9!#$%&'*+.^_`|~-]+$/.test(item) || CRITICAL.has(item))) throw fault(400);
  return tokens;
}
function stripHop(headers) {
  const denied = new Set([...HOP, ...connectionTokens(headers)]);
  return Object.fromEntries(Object.entries(headers).filter(([name]) => !denied.has(name.toLowerCase())
    && name !== 'forwarded' && !name.startsWith('x-forwarded-') && !['x-original-url', 'x-rewrite-url'].includes(name)));
}
function sizeLimiter(maximum) {
  let used = 0;
  return new Transform({ transform(chunk, _encoding, callback) {
    used += chunk.length;
    if (used > maximum) callback(fault(413)); else callback(null, chunk);
  } });
}

const staticSites = new WeakMap();
const STATIC_MIME = Object.freeze({ '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf' });
const staticError = () => Error('APPROVED_STATIC_SITE_UNAVAILABLE');
const publicHash = bytes => createHash('sha256').update(bytes).digest('hex');
const identity = stat => [stat.dev, stat.ino, stat.mode, stat.nlink, stat.size, stat.mtimeNs, stat.ctimeNs].join(':');
async function checkedAncestors(absolute) {
  const snapshots = [];
  let current = path.parse(absolute).root;
  for (const segment of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const stat = await fs.lstat(current, { bigint: true });
    if (stat.isSymbolicLink() || (!stat.isDirectory() && current !== absolute)) throw staticError();
    snapshots.push([current, identity(stat)]);
  }
  if (path.resolve(await fs.realpath(absolute)).toLowerCase() !== absolute.toLowerCase()) throw staticError();
  return snapshots;
}
async function readPublicFile(absolute, maximum, expectedSize) {
  const ancestors = await checkedAncestors(absolute);
  const handle = await fs.open(absolute, 'r');
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.size > BigInt(maximum)
      || (expectedSize !== undefined && before.size !== BigInt(expectedSize))) throw staticError();
    const bytes = Buffer.alloc(Number(before.size) + 1);
    let length = 0;
    while (length < bytes.length) {
      const read = await handle.read(bytes, length, bytes.length - length, length);
      if (!read.bytesRead) break;
      length += read.bytesRead;
    }
    if (length !== Number(before.size) || identity(before) !== identity(await handle.stat({ bigint: true }))) throw staticError();
    for (const [name, snapshot] of ancestors) if (identity(await fs.lstat(name, { bigint: true })) !== snapshot) throw staticError();
    if (identity(await fs.lstat(absolute, { bigint: true })) !== identity(before)) throw staticError();
    return bytes.subarray(0, length);
  } finally { await handle.close(); }
}
export async function loadApprovedStaticSite({ manifestPath, expectedSha256 } = {}) {
  try {
    if (typeof manifestPath !== 'string' || !path.isAbsolute(manifestPath) || !/^[a-f0-9]{64}$/i.test(expectedSha256 ?? '')) throw staticError();
    const manifestBytes = await readPublicFile(path.resolve(manifestPath), 1024 * 1024);
    const manifestSha256 = publicHash(manifestBytes);
    if (manifestSha256 !== expectedSha256.toLowerCase()) throw staticError();
    const manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes));
    if (manifest.schemaVersion !== 1 || manifest.status !== 'STATIC_DIST_READY' || manifest.freshFromCurrentMainUi !== true
      || manifest.oldDistUsed !== false || manifest.sourceUnchanged !== true || manifest.envFileObservedFalse !== true
      || manifest.sourceMaps !== false || typeof manifest.staticRoot !== 'string' || !path.isAbsolute(manifest.staticRoot)
      || manifest.entry !== 'index.html' || manifest.viteManifest !== '.vite/manifest.json'
      || !Array.isArray(manifest.outputs) || !Array.isArray(manifest.assets) || manifest.outputs.length < 2
      || manifest.outputs.length > 2048 || manifest.outputFiles !== manifest.outputs.length) throw staticError();
    const root = path.resolve(manifest.staticRoot);
    if (!(await fs.lstat(root)).isDirectory()) throw staticError();
    await checkedAncestors(root);
    const records = new Map(), folded = new Set();
    let total = 0;
    function record(value) {
      if (!value || Object.keys(value).sort().join(',') !== 'path,sha256,size' || typeof value.path !== 'string'
        || !Number.isSafeInteger(value.size) || value.size < 0 || value.size > MAX_RESPONSE || !/^[a-f0-9]{64}$/i.test(value.sha256 ?? '')) throw staticError();
      const relative = value.path;
      if (relative !== 'index.html' && relative !== '.vite/manifest.json'
        && (!/^assets\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(relative)
          || !Object.hasOwn(STATIC_MIME, path.posix.extname(relative)) || relative.split('/').some(part => part.endsWith('.') || part.includes('..')))) throw staticError();
      return { path: relative, size: value.size, sha256: value.sha256.toLowerCase() };
    }
    for (const output of manifest.outputs) {
      const row = record(output), foldedPath = row.path.toLowerCase();
      if (folded.has(foldedPath)) throw staticError();
      folded.add(foldedPath); records.set(row.path, row); total += row.size;
      if (total > MAX_RESPONSE) throw staticError();
    }
    if (manifest.outputBytes !== total || records.size !== manifest.assets.length + 2) throw staticError();
    const declared = [manifest.index, ...manifest.assets, manifest.viteManifestOutput].map(record);
    if (declared[0].path !== 'index.html' || declared.at(-1).path !== '.vite/manifest.json'
      || manifest.assets.some(row => !row.path.startsWith('assets/')) || new Set(declared.map(row => row.path)).size !== records.size) throw staticError();
    for (const row of declared) {
      const other = records.get(row.path);
      if (!other || other.size !== row.size || other.sha256 !== row.sha256) throw staticError();
    }
    const cached = new Map();
    for (const row of records.values()) {
      const absolute = path.resolve(root, ...row.path.split('/'));
      const relative = path.relative(root, absolute);
      if (relative.startsWith('..') || path.isAbsolute(relative)) throw staticError();
      const bytes = await readPublicFile(absolute, row.size, row.size);
      if (publicHash(bytes) !== row.sha256) throw staticError();
      if (row.path !== '.vite/manifest.json') cached.set('/' + row.path, { bytes,
        type: row.path === 'index.html' ? 'text/html; charset=utf-8' : STATIC_MIME[path.posix.extname(row.path)] });
    }
    const site = Object.freeze({ schemaVersion: 1, outputFiles: records.size, publicFiles: cached.size,
      outputBytes: total, manifestSha256, entrySha256: records.get('index.html').sha256 });
    staticSites.set(site, cached);
    return site;
  } catch { throw staticError(); }
}
function staticEntry(cached, req) {
  const pathname = decodeURIComponent(req.url.split('?')[0]);
  if (pathname === '/') return cached.get('/index.html');
  const exact = cached.get(pathname);
  if (exact) return exact;
  const parts = pathname.split('/').filter(Boolean);
  const reserved = new Set(['assets', 'api', 'src', 'server', 'scripts', 'node_modules', 'artifacts', '@vite']);
  if (!parts.length || reserved.has(parts[0].toLowerCase()) || parts.some(part => part.startsWith('.') || part.startsWith('__')
    || !/^[A-Za-z0-9_-]+$/.test(part)) || pathname.includes('//')) return;
  const acceptsHtml = String(req.headers.accept ?? '').split(',').some(item => {
    const [type, ...parameters] = item.trim().toLowerCase().split(';');
    return type.trim() === 'text/html' && parameters.every(parameter => !/^\s*q\s*=/.test(parameter) || Number(parameter.split('=')[1]) > 0);
  });
  if (acceptsHtml) return cached.get('/index.html');
}

export function createMainGateway({ credential, publicOrigin, upstreamPort = 3000, sessionTtlMs = 3600000,
  now = () => Date.now(), upstreamTimeoutMs = 15000, staticSite } = {}) {
  if (staticSite !== undefined && !staticSites.has(staticSite)) throw Error('INVALID_STATIC_SITE');
  const cached = staticSite === undefined ? undefined : staticSites.get(staticSite);
  const external = canonicalOrigin(publicOrigin);
  if (credential?.username !== 'demo' || !/^[A-Za-z0-9_-]{43}$/.test(credential?.password ?? '')
    || !Number.isInteger(upstreamPort) || upstreamPort < 1 || upstreamPort > 65535
    || !Number.isInteger(sessionTtlMs) || sessionTtlMs < 1000 || sessionTtlMs > 28800000
    || !Number.isInteger(upstreamTimeoutMs) || upstreamTimeoutMs < 1 || upstreamTimeoutMs > 60000
    || typeof now !== 'function') throw Error('INVALID_GATEWAY_CONFIGURATION');
  const internal = `http://127.0.0.1:${upstreamPort}`;
  const expectedBasic = Buffer.from(`${credential.username}:${credential.password}`);
  const sessions = new Map();
  const sockets = new Set();
  const websockets = new Set();
  let reservations = 0;
  function own(socket) { sockets.add(socket); socket.on('error', () => {}); socket.once('close', () => sockets.delete(socket)); return socket; }
  function expire(token, session) {
    sessions.delete(token);
    for (const socket of session?.sockets ?? []) socket.destroy();
  }
  function prune() {
    const time = now();
    if (!Number.isFinite(time)) throw fault(503);
    for (const [token, session] of sessions) if (session.expiresAt <= time) expire(token, session);
  }
  function validBasic(value) {
    if (!/^Basic [A-Za-z0-9+/]+={0,2}$/.test(value) || value.length > 256) return false;
    const encoded = value.slice(6), candidate = Buffer.from(encoded, 'base64');
    const sameLength = candidate.length === expectedBasic.length;
    return timingSafeEqual(sameLength ? candidate : Buffer.alloc(expectedBasic.length), expectedBasic)
      && sameLength && candidate.toString('base64') === encoded;
  }
  function authenticate(req, ws = false) {
    if (req.rawHeaders.length > 128) throw fault(431);
    prune();
    if (uniqueHeaders.some(name => count(req, name) > 1)) throw fault(401);
    const cookies = [];
    let session;
    let token;
    for (const part of (req.headers.cookie ?? '').split(';').filter(item => item.trim())) {
      const text = part.trim(), split = text.indexOf('=');
      if (split < 1 || /[\x00-\x20\x7f]/.test(text)) throw fault(401);
      if (text.slice(0, split) === GATEWAY_COOKIE_NAME) {
        if (token !== undefined) throw fault(401);
        token = text.slice(split + 1);
      } else cookies.push(text);
    }
    if (token !== undefined) {
      if (!/^[A-Za-z0-9_-]{43}$/.test(token) || !sessions.has(token)) throw fault(401);
      session = sessions.get(token);
    }
    const authorization = req.headers.authorization;
    let basic = false;
    if (authorization !== undefined) {
      if (typeof authorization !== 'string') throw fault(401);
      if (authorization.startsWith('Basic ')) { if (!validBasic(authorization)) throw fault(401); basic = true; }
      else if (!/^Bearer [\x21-\x7e]{1,4096}$/i.test(authorization)) throw fault(401);
    }
    if (!session && (ws || !basic || req.method !== 'GET' || req.url !== '/')) throw fault(401);
    return { session, token, bootstrap: !session, basic, appCookie: cookies.join('; ') };
  }
  function boundary(req, ws = false) {
    if (count(req, 'host') !== 1 || req.headers.host !== external.host) throw fault(403);
    const origin = req.headers.origin;
    if (origin !== undefined && origin !== publicOrigin) throw fault(403);
    if ((ws || !['GET', 'HEAD'].includes(req.method)) && origin !== publicOrigin) throw fault(403);
    const fetchSite = req.headers['sec-fetch-site'];
    if (fetchSite !== undefined && !['same-origin', 'none'].includes(fetchSite)) throw fault(403);
    let referer;
    if (req.headers.referer !== undefined) {
      try {
        referer = new URL(req.headers.referer);
        if (referer.origin !== publicOrigin || referer.username || referer.password) throw fault(403);
      } catch { throw fault(403); }
    }
    for (const [name, value] of Object.entries(req.headers)) {
      if (name === 'forwarded' || name === 'x-original-url' || name === 'x-rewrite-url') throw fault(403);
      if (name.startsWith('x-forwarded-') && !['x-forwarded-host', 'x-forwarded-proto', 'x-forwarded-for'].includes(name)) throw fault(403);
      if (name === 'x-forwarded-host' && value !== external.host) throw fault(403);
      if (name === 'x-forwarded-proto' && value !== 'https') throw fault(403);
    }
    if (!targetValid(req.url)) throw fault(400);
    if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(req.method)) throw fault(405);
    if (req.headers['content-length'] !== undefined && (!/^\d+$/.test(req.headers['content-length'])
      || Number(req.headers['content-length']) > MAX_BODY)) throw fault(413);
    connectionTokens(req.headers);
    return referer;
  }
  function upstreamHeaders(req, auth, referer, ws = false) {
    const headers = stripHop(req.headers);
    delete headers.cookie;
    if (auth.appCookie) headers.cookie = auth.appCookie;
    if (auth.basic) delete headers.authorization;
    headers.host = `127.0.0.1:${upstreamPort}`;
    if (req.headers.origin !== undefined) headers.origin = internal;
    if (referer) headers.referer = internal + referer.pathname + referer.search;
    headers.connection = ws ? 'Upgrade' : 'close';
    if (ws) headers.upgrade = 'websocket';
    return headers;
  }
  function responseHeaders(source) {
    const headers = stripHop(source);
    delete headers['access-control-allow-origin'];
    delete headers['access-control-allow-credentials'];
    const supplied = source['set-cookie'];
    if (supplied) {
      const cookies = Array.isArray(supplied) ? supplied : [supplied];
      if (cookies.some(value => value.split('=', 1)[0].trim() === GATEWAY_COOKIE_NAME)) throw fault(502);
      headers['set-cookie'] = cookies.map(value => /;\s*Secure(?:;|$)/i.test(value) ? value : value + '; Secure');
    }
    if (source.location !== undefined) {
      const location = source.location;
      if (typeof location !== 'string' || /[\\\x00-\x20\x7f]/.test(location)) throw fault(502);
      if (location.startsWith('/') && !location.startsWith('//')) {
        if (!targetValid(location)) throw fault(502);
        headers.location = location;
      } else {
        let url;
        try { url = new URL(location); } catch { throw fault(502); }
        if (url.username || url.password || ![internal, publicOrigin].includes(url.origin) || url.hash) throw fault(502);
        headers.location = publicOrigin + url.pathname + url.search;
      }
    }
    if (Number(source['content-length'] ?? 0) > MAX_RESPONSE) throw fault(502);
    return { ...headers, ...SECURITY };
  }
  function send(req, res, status) {
    const body = JSON.stringify({ error: status === 401 ? 'GATEWAY_AUTH_REQUIRED' : status === 504 ? 'UPSTREAM_DEADLINE' : 'GATEWAY_REQUEST_FAILED' });
    if (res.headersSent) { res.destroy(); return; }
    res.writeHead(status, { ...SECURITY, 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body),
      connection: 'close', ...(status === 401 ? { 'www-authenticate': 'Basic realm="EDITH main gateway", charset="UTF-8"' } : {}) });
    res.end(req.method === 'HEAD' ? undefined : body);
  }
  const server = http.createServer({ maxHeaderSize: 16384, headersTimeout: 10000, requestTimeout: 30000, connectionsCheckingInterval: 1000 }, (req, res) => {
    let auth, referer;
    try {
      auth = authenticate(req);
      referer = boundary(req);
      if (auth.bootstrap && sessions.size + reservations >= 128) throw fault(503);
    } catch (error) { send(req, res, error.status ?? 400); return; }
    let reserved = auth.bootstrap;
    if (reserved) reservations++;
    const release = () => { if (reserved) { reservations--; reserved = false; } };
    let done = false;
    let createdToken;
    let proxy;
    const headerDeadline = setTimeout(() => failed(504), upstreamTimeoutMs);
    function grant(headers) {
      if (!auth.bootstrap) return;
      const token = randomBytes(32).toString('base64url');
      const session = { expiresAt: now() + sessionTtlMs, sockets: new Set() };
      sessions.set(token, session);
      createdToken = token;
      const cookie = `${GATEWAY_COOKIE_NAME}=${token}; Path=/; Max-Age=${Math.floor(sessionTtlMs / 1000)}; Secure; HttpOnly; SameSite=Strict`;
      headers['set-cookie'] = [...(headers['set-cookie'] ?? []), cookie];
    }
    function failed(status) {
      if (done) return;
      done = true; release(); clearTimeout(headerDeadline);
      if (createdToken && !res.writableFinished) expire(createdToken, sessions.get(createdToken));
      proxy?.destroy(); send(req, res, status);
    }
    req.on('aborted', () => failed(502));
    res.on('close', () => {
      if (!res.writableFinished && createdToken && sessions.has(createdToken)) expire(createdToken, sessions.get(createdToken));
      if (!res.writableEnded) { done = true; release(); clearTimeout(headerDeadline); proxy?.destroy(); }
    });
    if (cached && !req.url.startsWith('/api')) {
      clearTimeout(headerDeadline);
      try {
        if (!['GET', 'HEAD'].includes(req.method)) throw fault(405);
        if (req.headers['transfer-encoding'] !== undefined || Number(req.headers['content-length'] ?? 0) !== 0) throw fault(400);
        const entry = staticEntry(cached, req);
        if (!entry) throw fault(404);
        // Bound delivery as well as request receipt, including stalled readers.
        const deliveryDeadline = setTimeout(() => { failed(504); res.destroy(); }, 60000);
        deliveryDeadline.unref();
        const clearDeliveryDeadline = () => clearTimeout(deliveryDeadline);
        res.once('finish', clearDeliveryDeadline); res.once('close', clearDeliveryDeadline);
        const headers = { ...SECURITY, 'content-type': entry.type, 'content-length': entry.bytes.length };
        grant(headers); release(); res.writeHead(200, headers);
        if (req.method === 'HEAD') { done = true; res.end(); }
        else {
          const stream = Readable.from((function* () {
            for (let offset = 0; offset < entry.bytes.length; offset += 65536) yield entry.bytes.subarray(offset, offset + 65536);
          })());
          res.once('close', () => stream.destroy());
          stream.once('error', () => failed(502));
          stream.once('end', () => { done = true; });
          stream.pipe(res);
        }
      } catch (error) { failed(error.status ?? 502); }
      return;
    }
    try {
      proxy = http.request({ hostname: '127.0.0.1', port: upstreamPort, method: req.method, path: req.url,
        headers: upstreamHeaders(req, auth, referer), agent: false, maxHeaderSize: 16384 }, response => {
        clearTimeout(headerDeadline);
        if (done || res.destroyed) { release(); response.destroy(); return; }
        let headers;
        try {
          headers = responseHeaders(response.headers);
          if (auth.bootstrap && response.statusCode >= 200 && response.statusCode < 300) {
            grant(headers);
          }
        } catch { response.destroy(); failed(502); return; }
        release();
        res.writeHead(response.statusCode, headers);
        const limiter = sizeLimiter(MAX_RESPONSE);
        limiter.on('error', () => failed(502));
        response.on('error', () => failed(502));
        response.on('aborted', () => failed(502));
        response.on('end', () => { done = true; });
        response.pipe(limiter).pipe(res);
      });
      proxy.on('socket', socket => { own(socket); socket.setTimeout(60000, () => failed(504)); });
      proxy.on('error', () => failed(502));
      const limiter = sizeLimiter(MAX_BODY);
      limiter.on('error', () => failed(413));
      req.pipe(limiter).pipe(proxy);
    } catch { failed(502); }
  });
  server.maxHeadersCount = 64;
  server.maxConnections = 128;
  server.on('connection', own);
  function rejectSocket(req, socket, status) {
    const headers = { ...SECURITY, 'content-length': 0, connection: 'close',
      ...(status === 401 ? { 'www-authenticate': 'Basic realm="EDITH main gateway"' } : {}) };
    socket.setTimeout(1000, () => socket.destroy());
    socket.end(`HTTP/1.1 ${status} Rejected\r\n${Object.entries(headers).map(([key, value]) => `${key}: ${value}`).join('\r\n')}\r\n\r\n`, () => socket.destroy());
  }
  server.on('upgrade', (req, socket, head) => {
    let auth, referer;
    try {
      auth = authenticate(req, true); referer = boundary(req, true);
      const key = req.headers['sec-websocket-key'];
      if (req.method !== 'GET' || req.headers.upgrade?.toLowerCase() !== 'websocket'
        || !connectionTokens(req.headers).includes('upgrade') || req.headers['sec-websocket-version'] !== '13'
        || typeof key !== 'string' || !/^[A-Za-z0-9+/]{22}==$/.test(key) || Buffer.from(key, 'base64').length !== 16
        || Buffer.from(key, 'base64').toString('base64') !== key || req.headers['transfer-encoding'] !== undefined
        || Number(req.headers['content-length'] ?? 0) !== 0 || head.length > 65536) throw fault(400);
      if (websockets.size >= 32) throw fault(503);
    } catch (error) { rejectSocket(req, socket, error.status ?? 400); return; }
    const offered = String(req.headers['sec-websocket-protocol'] ?? '').split(',').map(value => value.trim()).filter(Boolean);
    if (offered.length > 16 || offered.some(value => !/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(value))) { rejectSocket(req, socket, 400); return; }
    let upstream;
    let finished = false;
    let connected;
    let expiry;
    websockets.add(socket);
    auth.session.sockets.add(socket);
    const headerDeadline = setTimeout(() => reject(504), upstreamTimeoutMs);
    function cleanup() {
      clearTimeout(headerDeadline); clearTimeout(expiry); websockets.delete(socket);
      auth.session.sockets.delete(socket); auth.session.sockets.delete(connected);
    }
    function reject(status) {
      if (finished) return;
      finished = true; cleanup(); upstream?.destroy(); connected?.destroy(); rejectSocket(req, socket, status);
    }
    try {
      upstream = http.request({ hostname: '127.0.0.1', port: upstreamPort, method: 'GET', path: req.url,
        headers: upstreamHeaders(req, auth, referer, true), agent: false, maxHeaderSize: 16384 });
      upstream.on('socket', pendingSocket => {
        own(pendingSocket); auth.session.sockets.add(pendingSocket);
        pendingSocket.once('close', () => auth.session.sockets.delete(pendingSocket));
      });
      upstream.once('error', () => reject(502));
      upstream.once('response', response => {
        try { responseHeaders(response.headers); } catch { response.destroy(); reject(502); return; }
        const status = [400, 401, 403, 404, 405, 426].includes(response.statusCode) ? response.statusCode : 502;
        response.destroy(); reject(status);
      });
      upstream.once('upgrade', (response, upstreamSocket, upstreamHead) => {
        if (finished || socket.destroyed) { upstreamSocket.destroy(); return; }
        connected = own(upstreamSocket);
        let headers;
        try {
          headers = responseHeaders(response.headers);
          // This SHA1 is the standard public WS handshake, never a credential/session hash.
          const accept = createHash('sha1').update(req.headers['sec-websocket-key'] + WS_GUID).digest('base64');
          const selected = response.headers['sec-websocket-protocol'];
          if (response.statusCode !== 101 || response.headers.upgrade?.toLowerCase() !== 'websocket'
            || !connectionTokens(response.headers).includes('upgrade') || response.headers['sec-websocket-accept'] !== accept
            || (selected !== undefined && !offered.includes(selected)) || upstreamHead.length > 65536
            || auth.session.expiresAt <= now()) throw fault(502);
        } catch { reject(502); return; }
        finished = true; clearTimeout(headerDeadline);
        headers.connection = 'Upgrade'; headers.upgrade = 'websocket';
        const pairs = [];
        for (const [name, value] of Object.entries(headers)) for (const item of Array.isArray(value) ? value : [value]) pairs.push(`${name}: ${item}`);
        socket.write(`HTTP/1.1 101 Switching Protocols\r\n${pairs.join('\r\n')}\r\n\r\n`);
        auth.session.sockets.add(connected);
        const terminate = () => { cleanup(); socket.destroy(); connected.destroy(); };
        socket.once('close', terminate); connected.once('close', terminate);
        socket.once('end', terminate); connected.once('end', terminate);
        socket.on('error', terminate); connected.on('error', terminate);
        socket.setTimeout(120000, terminate); connected.setTimeout(120000, terminate);
        clearTimeout(expiry);
        expiry = setTimeout(terminate, Math.max(1, auth.session.expiresAt - now())); expiry.unref();
        if (upstreamHead.length) socket.write(upstreamHead);
        if (head.length) connected.write(head);
        socket.pipe(connected); connected.pipe(socket);
      });
      const pendingAborted = () => { if (!finished) { finished = true; cleanup(); upstream.destroy(); connected?.destroy(); socket.destroy(); } };
      socket.once('close', pendingAborted); socket.once('end', pendingAborted);
      expiry = setTimeout(() => reject(401), Math.max(1, auth.session.expiresAt - now())); expiry.unref();
      upstream.end();
    } catch { reject(502); }
  });
  server.on('connect', (req, socket) => {
    try { authenticate(req, true); rejectSocket(req, socket, 405); }
    catch (error) { rejectSocket(req, socket, error.status ?? 400); }
  });
  const expectation = (req, res) => { try { authenticate(req); boundary(req); send(req, res, 400); } catch (error) { send(req, res, error.status ?? 400); } };
  server.on('checkContinue', expectation); server.on('checkExpectation', expectation);
  server.on('clientError', (_error, socket) => { if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); });
  const originalClose = server.close.bind(server);
  server.close = callback => {
    for (const socket of sockets) socket.destroy();
    sessions.clear();
    return originalClose(callback);
  };
  return server;
}

async function readCredential(file) {
  const absolute = path.resolve(file), root = path.parse(absolute).root;
  let current = root;
  for (const segment of absolute.slice(root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if ((await fs.lstat(current)).isSymbolicLink()) throw Error('CREDENTIAL_UNAVAILABLE');
  }
  const handle = await fs.open(absolute, 'r');
  try {
    const stat = await handle.stat(), buffer = Buffer.alloc(1025);
    if (!stat.isFile() || stat.size > 1024) throw Error('CREDENTIAL_UNAVAILABLE');
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead !== stat.size || bytesRead > 1024) throw Error('CREDENTIAL_UNAVAILABLE');
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytesRead)));
    if (!value || Object.keys(value).sort().join(',') !== 'password,username') throw Error('CREDENTIAL_UNAVAILABLE');
    return value;
  } finally { await handle.close(); }
}
async function main() {
  const args = process.argv.slice(2), values = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--public-origin', '--credential-file', '--static-manifest', '--static-manifest-sha256'].includes(args[i]) || !args[i + 1] || values[args[i]] !== undefined) throw Error('INVALID_ARGUMENTS');
    values[args[i]] = args[i + 1];
  }
  const file = values['--credential-file'] ?? path.join(os.homedir(), 'AppData/Local/EDITH-TestDemo/ngrok-demo-20261018/gateway-credential.json');
  if (!path.isAbsolute(file)) throw Error('INVALID_ARGUMENTS');
  if ((values['--static-manifest'] === undefined) !== (values['--static-manifest-sha256'] === undefined)) throw Error('INVALID_ARGUMENTS');
  const staticSite = values['--static-manifest'] === undefined ? undefined : await loadApprovedStaticSite({
    manifestPath: values['--static-manifest'], expectedSha256: values['--static-manifest-sha256'] });
  const server = createMainGateway({ credential: await readCredential(file), publicOrigin: values['--public-origin'], staticSite });
  server.once('error', () => { process.stdout.write('{"status":"MAIN_GATEWAY_START_FAILED"}\n'); process.exitCode = 1; });
  process.once('SIGINT', () => server.close()); process.once('SIGTERM', () => server.close());
  server.listen(3108, '127.0.0.1', () => process.stdout.write('{"status":"MAIN_GATEWAY_READY","host":"127.0.0.1","port":3108,"upstreamPort":3000}\n'));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { process.stdout.write('{"status":"MAIN_GATEWAY_START_FAILED"}\n'); process.exitCode = 1; });
}
