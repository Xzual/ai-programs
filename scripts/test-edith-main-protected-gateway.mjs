import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import http from 'node:http';
import net from 'node:net';
import { once } from 'node:events';
import { randomBytes, createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

// Source-only import: no app, credential file, environment or listener access.
let subject;
try { subject = await import('./edith-main-protected-gateway.mjs'); }
catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }
assert.equal(typeof subject?.createMainGateway, 'function', 'protected main gateway factory must exist');
const { createMainGateway, GATEWAY_COOKIE_NAME } = subject;
assert.equal(typeof subject.loadApprovedStaticSite, 'function', 'approved static loader must exist before frozen frontend consumption');
const { loadApprovedStaticSite } = subject;
assert.equal(GATEWAY_COOKIE_NAME === '__Host-edith_gateway_session', true, 'reserved host-only session cookie contract');
const origin = 'https://fixed.example';
const host = 'fixed.example';
// Never persist/hash/print credentials or use raw response values in assertion diffs.
const credential = Object.freeze({ username: 'demo', password: randomBytes(32).toString('base64url') });
const basic = 'Basic ' + Buffer.from(credential.username + ':' + credential.password).toString('base64');
const equal = (actual, expected, label = 'gateway boundary matches contract') => assert.equal(isDeepStrictEqual(actual, expected), true, label);
const json = text => { try { return JSON.parse(text); } catch { throw Error('FIXTURE_JSON_INVALID'); } };
const html = '<!doctype html><title>Owned main fixture</title><script src="/src/main.tsx?v=fixture"></script>';

function track(server) {
  const sockets = new Set();
  server.on('connection', socket => { sockets.add(socket); socket.on('error', () => {}); socket.on('close', () => sockets.delete(socket)); });
  return sockets;
}
async function close(server, sockets) {
  const done = new Promise(resolve => server.close(() => resolve()));
  for (const socket of sockets) socket.destroy();
  server.closeAllConnections?.();
  await done;
}
function clientFrame(text) {
  const payload = Buffer.from(text), mask = Buffer.from([11, 22, 33, 44]);
  const result = Buffer.alloc(6 + payload.length);
  result[0] = 0x81; result[1] = 0x80 | payload.length; mask.copy(result, 2);
  for (let i = 0; i < payload.length; i++) result[6 + i] = payload[i] ^ mask[i % 4];
  return result;
}
async function fixture(options, body) {
  const requests = [], upgrades = [];
  const timers = new Set();
  const pendingUpstream = new Set();
  const pendingHttp = new Set();
  let connections = 0, bytes = 0;
  const upstream = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const entry = { method: req.method, target: req.url, headers: { ...req.headers }, body: Buffer.concat(chunks).toString('utf8') };
      requests.push(entry);
      if (req.url === '/fixture/error') { req.socket.destroy(); return; }
      if (req.url === '/fixture/slow') {
        const socket = req.socket;
        pendingHttp.add(socket); socket.once('close', () => pendingHttp.delete(socket)); return;
      }
      if (req.url === '/fixture/sse') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write('data: first\n\n');
        const timer = setTimeout(() => { timers.delete(timer); res.end('data: last\n\n'); }, 100);
        timers.add(timer); return;
      }
      if (req.url === '/fixture/reserved') { res.setHeader('Set-Cookie', `${GATEWAY_COOKIE_NAME}=fixture-forgery; Path=/`); res.end('blocked'); return; }
      if (req.url.startsWith('/fixture/redirect')) {
        res.statusCode = 302;
        res.setHeader('Location', req.url === '/fixture/redirect-internal' ? `http://127.0.0.1:${upstream.address().port}/app?x=1`
          : req.url === '/fixture/redirect-relative' ? '/app?x=1' : 'https://outside.invalid/path');
        res.end(); return;
      }
      if (req.url === '/fixture/app-cookie') { res.setHeader('Set-Cookie', 'edith_owner_session=fixture-app-cookie; HttpOnly; Path=/; SameSite=Strict'); res.end('app-cookie'); return; }
      if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); res.end(html); return; }
      if (req.url.startsWith('/src/main.tsx')) { res.setHeader('Content-Type', 'application/javascript'); res.end('export const fixture = 1;'); return; }
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(entry));
    });
  });
  upstream.on('connection', socket => { connections++; socket.on('data', chunk => { bytes += chunk.length; }); });
  upstream.on('upgrade', (req, socket, head) => {
    upgrades.push({ target: req.url, headers: { ...req.headers } });
    if (req.url === '/fixture/ws-pending') {
      pendingUpstream.add(socket); socket.once('close', () => pendingUpstream.delete(socket));
      // Upgrade sockets begin paused. Consume peer FIN and close this owned mock
      // half normally so its close event measures gateway cancellation honestly.
      socket.once('end', () => socket.destroy()); socket.resume(); return;
    }
    if (req.url === '/fixture/ws-denied') { socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n'); return; }
    // Only the public fixed WS handshake key is hashed, never any credential.
    const accept = createHash('sha1').update(String(req.headers['sec-websocket-key']) + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    const actualAccept = req.url === '/fixture/ws-bad-accept' ? 'invalid-accept' : accept;
    const selected = req.url === '/fixture/ws-unoffered' ? 'not-offered' : 'edith.voice.v1';
    const reserved = req.url === '/fixture/ws-reserved' ? `Set-Cookie: ${GATEWAY_COOKIE_NAME}=fixture-forgery; Path=/\r\n` : '';
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${actualAccept}\r\nSec-WebSocket-Protocol: ${selected}\r\n${reserved}\r\n`);
    let pending = Buffer.alloc(0);
    const echo = chunk => {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= 6) {
        const length = pending[1] & 127;
        if (length > 125 || pending.length < 6 + length) return;
        const payload = Buffer.alloc(length);
        for (let i = 0; i < length; i++) payload[i] = pending[6 + i] ^ pending[2 + i % 4];
        socket.write(Buffer.concat([Buffer.from([0x81, length]), payload]));
        pending = pending.subarray(6 + length);
      }
    };
    socket.on('data', echo); if (head.length) echo(head);
  });
  const upstreamSockets = track(upstream);
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  const gateway = createMainGateway({ credential, publicOrigin: origin, upstreamPort: upstream.address().port,
    upstreamTimeoutMs: 250, ...options });
  equal(gateway.listening, false, 'factory must not start a listener');
  const gatewaySockets = track(gateway);
  gateway.listen(0, '127.0.0.1'); await once(gateway, 'listening');
  const port = gateway.address().port;
  try { await body({ port, requests, upgrades, upstreamPort: upstream.address().port, counts: () => ({ connections, bytes }), gateway,
    pendingSocketCount: () => pendingUpstream.size, pendingHttpCount: () => pendingHttp.size,
    hasGatewayPeer: clientPort => [...gatewaySockets].some(socket => socket.remotePort === clientPort) }); }
  finally { for (const timer of timers) clearTimeout(timer); await close(gateway, gatewaySockets); await close(upstream, upstreamSockets); }
}
function request(port, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method: options.method ?? 'GET', path: options.target ?? '/',
      headers: { Host: host, ...options.headers } }, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk));
      res.on('aborted', () => reject(Error('FIXTURE_HTTP_RESPONSE_ABORTED')));
      res.on('error', () => reject(Error('FIXTURE_HTTP_RESPONSE_FAILED')));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', () => reject(Error('FIXTURE_HTTP_FAILED')));
    req.setTimeout(1800, () => req.destroy(Error('FIXTURE_HTTP_TIMEOUT')));
    req.end(options.body);
  });
}
async function bootstrap(port, maxAge = 3600) {
  const response = await request(port, { headers: { Authorization: basic } });
  equal(response.status, 200, 'valid root Basic bootstrap succeeds');
  const cookies = response.headers['set-cookie'];
  assert.equal(Array.isArray(cookies), true, 'bootstrap sets a cookie');
  const line = cookies?.find(value => value.startsWith(GATEWAY_COOKIE_NAME + '='));
  assert.equal(typeof line === 'string', true, 'bootstrap sets the reserved gateway cookie');
  assert.equal(/;\s*Secure(?:;|$)/i.test(line ?? ''), true);
  assert.equal(/;\s*HttpOnly(?:;|$)/i.test(line ?? ''), true);
  assert.equal(/;\s*SameSite=Strict(?:;|$)/i.test(line ?? ''), true);
  assert.equal(/;\s*Path=\/(?:;|$)/i.test(line ?? ''), true);
  assert.equal(/;\s*Domain=/i.test(line ?? ''), false);
  assert.equal(new RegExp(`;\\s*Max-Age=${maxAge}(?:;|$)`, 'i').test(line ?? ''), true, 'cookie has the configured finite lifetime');
  return line.split(';')[0];
}
function raw(port, wire) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: '127.0.0.1', port }); let response = '';
    socket.on('connect', () => socket.write(wire)); socket.on('data', chunk => { response += chunk.toString('latin1'); });
    socket.on('error', () => reject(Error('FIXTURE_RAW_FAILED'))); socket.on('close', () => resolve(response));
    socket.setTimeout(1800, () => socket.destroy(Error('FIXTURE_RAW_TIMEOUT')));
  });
}
const wire = (target, headers, method = 'GET', body = '') => `${method} ${target} HTTP/1.1\r\n${headers.join('\r\n')}\r\nConnection: close\r\n\r\n${body}`;

test('missing, wrong and non-root Basic authentication never opens an upstream connection', async () => {
  await fixture({}, async f => {
    // Constructed wrong Basic credentials; accepted credentials are generated by this test.
    for (const headers of [{}, { Authorization: 'Basic ' + Buffer.from(['synthetic-wrong-user', 'synthetic-wrong-password'].join(':')).toString('base64') }, { Authorization: 'Bearer fixture-app' }]) {
      equal((await request(f.port, { headers })).status, 401);
    }
    for (const target of ['/api/status', '/src/main.tsx?v=1', '/?bootstrap=1']) {
      equal((await request(f.port, { target, headers: { Authorization: basic } })).status, 401);
    }
    equal((await request(f.port, { method: 'POST', headers: { Authorization: basic, Origin: origin } })).status, 401);
    equal(f.counts(), { connections: 0, bytes: 0 });
  });
});

test('root bootstrap and cookie preserve full HTML, static queries and API request bytes', async () => {
  await fixture({}, async f => {
    const cookie = await bootstrap(f.port);
    equal(f.requests[0].headers.authorization, undefined, 'gateway Basic must not reach EDITH');
    const page = await request(f.port, { headers: { Cookie: cookie } }); equal(page.text, html);
    const asset = await request(f.port, { target: '/src/main.tsx?v=123&import', headers: { Cookie: cookie } });
    equal(asset.text, 'export const fixture = 1;');
    const body = '{"message":"owned fixture bytes","number":1.23456789}';
    const response = await request(f.port, { method: 'POST', target: '/api/chat?mode=manual', body,
      headers: { Cookie: cookie + '; edith_owner_session=fixture-app', Authorization: 'Bearer fixture-app-token', Origin: origin,
        Referer: origin + '/chat?view=main', 'X-CSRF-Token': 'fixture-csrf', 'x-edith-csrf-token': 'fixture-edith-csrf',
        'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } });
    const actual = json(response.text);
    equal(actual.target, '/api/chat?mode=manual'); equal(actual.body, body); equal(actual.method, 'POST');
    equal(actual.headers.authorization, 'Bearer fixture-app-token'); equal(actual.headers['x-csrf-token'], 'fixture-csrf');
    equal(actual.headers['x-edith-csrf-token'], 'fixture-edith-csrf');
    equal(actual.headers.cookie, 'edith_owner_session=fixture-app');
    equal(actual.headers.host, `127.0.0.1:${f.upstreamPort}`);
    equal(actual.headers.origin, `http://127.0.0.1:${f.upstreamPort}`);
    equal(actual.headers.referer, `http://127.0.0.1:${f.upstreamPort}/chat?view=main`);
    equal(page.headers['cache-control'], 'no-store'); equal(page.headers['x-content-type-options'], 'nosniff');
    equal(page.headers['access-control-allow-origin'], undefined);
  });
});

test('valid cookie strips cached Basic and forwarding metadata but preserves absent origin', async () => {
  await fixture({}, async f => {
    const cookie = await bootstrap(f.port);
    const response = await request(f.port, { target: '/api/status?fixture=1', headers: { Cookie: cookie, Authorization: basic,
      'X-Forwarded-Host': host, 'X-Forwarded-Proto': 'https', 'X-Forwarded-For': '192.0.2.1', 'Proxy-Authorization': 'fixture-proxy' } });
    const entry = json(response.text);
    for (const field of ['authorization', 'cookie', 'origin', 'referer', 'x-forwarded-host', 'x-forwarded-proto', 'x-forwarded-for', 'proxy-authorization']) equal(entry.headers[field], undefined);
  });
});

test('host, origin, referer, fetch and forwarding boundaries reject before upstream bytes', async () => {
  await fixture({}, async f => {
    const cookie = await bootstrap(f.port), before = f.counts();
    const scenarios = [
      { Host: 'attacker.invalid' }, { Origin: 'https://attacker.invalid' }, { Origin: 'http://fixed.example' },
      { Referer: 'https://attacker.invalid/path' }, { Referer: 'https://user:pass@fixed.example/path' },
      { 'Sec-Fetch-Site': 'cross-site' }, { Forwarded: 'for=192.0.2.1' }, { 'X-Forwarded-Host': 'attacker.invalid' },
      { 'X-Forwarded-Proto': 'http' }, { 'X-Original-URL': '/api/tools/execute' }, { 'X-Rewrite-URL': '/api/chat' },
    ];
    for (const headers of scenarios) assert.equal([400, 403].includes((await request(f.port, { target: '/api/status', headers: { Cookie: cookie, ...headers } })).status), true);
    equal((await request(f.port, { target: '/api/chat', method: 'POST', headers: { Cookie: cookie } })).status, 403);
    equal(f.counts(), before, 'rejected edge metadata must not contact upstream');
  });
});

test('malformed targets, duplicate headers, oversized bodies and CONNECT never reach upstream', async () => {
  await fixture({}, async f => {
    const cookie = await bootstrap(f.port), before = f.counts();
    for (const target of ['http://attacker.invalid/api', '//api/status', '/a\\b', '/a/../api/status', '/%2e%2e/api/status', '/api%2fstatus', '/api%3fstatus', '/api%00status', '/api%252fstatus', '/api%ZZ', '/api/status#fragment']) {
      const response = await raw(f.port, wire(target, [`Host: ${host}`, `Cookie: ${cookie}`]));
      assert.equal(/^HTTP\/1\.1 (?:400|403|404) /.test(response), true, 'noncanonical request target rejected');
    }
    for (const extra of [`Host: ${host}`, `Cookie: ${cookie}`, 'Origin: https://fixed.example\r\nOrigin: https://fixed.example', 'Authorization: Bearer fixture\r\nAuthorization: Bearer fixture', 'X-Forwarded-Host: fixed.example\r\nX-Forwarded-Host: fixed.example']) {
      const response = await raw(f.port, wire('/api/status', [`Host: ${host}`, `Cookie: ${cookie}`, extra]));
      assert.equal(/^HTTP\/1\.1 (?:400|401|403) /.test(response), true, 'duplicate edge headers rejected');
    }
    const oversized = await raw(f.port, wire('/api/chat', [`Host: ${host}`, `Cookie: ${cookie}`, `Origin: ${origin}`, 'Content-Length: 4194305'], 'POST'));
    assert.equal(/^HTTP\/1\.1 413 /.test(oversized), true);
    const connect = await raw(f.port, wire('outside.invalid:443', [`Host: ${host}`, `Cookie: ${cookie}`], 'CONNECT'));
    assert.equal(/^HTTP\/1\.1 (?:400|403|405) /.test(connect), true);
    const trace = await request(f.port, { method: 'TRACE', headers: { Cookie: cookie, Origin: origin } }); equal(trace.status, 405);
    equal(f.counts(), before, 'malformed requests cannot open upstream sockets');
  });
});

test('expired, forged, duplicate session cookies and unknown authorization deny before forwarding', async () => {
  let clock = 100000;
  await fixture({ now: () => clock }, async f => {
    const cookie = await bootstrap(f.port), before = f.counts();
    for (const headers of [{ Cookie: `${GATEWAY_COOKIE_NAME}=forged` }, { Cookie: cookie + '; ' + cookie }, { Cookie: cookie, Authorization: 'Unknown fixture' }]) {
      equal((await request(f.port, { target: '/api/status', headers })).status, 401);
    }
    clock += 3600001;
    equal((await request(f.port, { target: '/api/status', headers: { Cookie: cookie } })).status, 401);
    equal(f.counts(), before);
  });
});

test('upstream cookies and safe redirects are translated while reserved cookies and external redirects are rejected', async () => {
  await fixture({}, async f => {
    const cookie = await bootstrap(f.port), headers = { Cookie: cookie };
    const app = await request(f.port, { target: '/fixture/app-cookie', headers });
    const cookies = app.headers['set-cookie'];
    assert.equal(Array.isArray(cookies) && cookies.some(value => value.startsWith('edith_owner_session=fixture-app-cookie;') && /;\s*Secure(?:;|$)/i.test(value)), true);
    const internal = await request(f.port, { target: '/fixture/redirect-internal', headers });
    equal(internal.status, 302); equal(internal.headers.location, origin + '/app?x=1');
    const relative = await request(f.port, { target: '/fixture/redirect-relative', headers });
    equal(relative.status, 302); equal(relative.headers.location, '/app?x=1');
    for (const target of ['/fixture/redirect-outside', '/fixture/reserved']) {
      const response = await request(f.port, { target, headers }); equal(response.status, 502);
      equal(response.headers.location, undefined);
      assert.equal(!(response.headers['set-cookie'] ?? []).some(value => value.startsWith(GATEWAY_COOKIE_NAME + '=')), true);
    }
  });
});

test('upstream errors and deadlines return bounded fixed failure bodies', async () => {
  await fixture({ upstreamTimeoutMs: 40 }, async f => {
    const cookie = await bootstrap(f.port);
    for (const [target, status] of [['/fixture/error', 502], ['/fixture/slow', 504]]) {
      const response = await request(f.port, { target, headers: { Cookie: cookie } });
      equal(response.status, status); assert.equal(response.text.length < 1024, true);
      assert.equal(!response.text.includes('127.0.0.1') && !response.text.includes('ECONN') && !response.text.includes('fixture/'), true);
    }
  });
});

function websocket(port, cookie, { target = '/fixture/ws?channel=voice', suppliedOrigin = origin, initialFrame = true } = {}) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: '127.0.0.1', port }); let buffer = Buffer.alloc(0), handshake = false;
    socket.on('error', () => reject(Error('FIXTURE_WS_FAILED')));
    socket.setTimeout(1800, () => { socket.destroy(); reject(Error('FIXTURE_WS_TIMEOUT')); });
    const closed = new Promise(done => socket.once('close', done));
    socket.once('connect', () => {
      const headers = [`GET ${target} HTTP/1.1`, `Host: ${host}`, ...(cookie ? [`Cookie: ${cookie}; edith_owner_session=fixture-app`] : []),
        ...(suppliedOrigin ? [`Origin: ${suppliedOrigin}`] : []), 'Authorization: Bearer fixture-app-token', 'Upgrade: websocket', 'Connection: Upgrade',
        'Sec-WebSocket-Version: 13', 'Sec-WebSocket-Key: Zml4dHVyZV9tYWluX3dzIQ==', 'Sec-WebSocket-Protocol: edith.voice.v1, csrf.fixture-csrf'];
      const head = Buffer.from(headers.join('\r\n') + '\r\n\r\n');
      socket.write(initialFrame ? Buffer.concat([head, clientFrame('owned-echo')]) : head);
    });
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      if (!handshake) {
        const at = buffer.indexOf('\r\n\r\n'); if (at < 0) return;
        const header = buffer.subarray(0, at).toString('latin1'); buffer = buffer.subarray(at + 4);
        if (!header.startsWith('HTTP/1.1 101 ')) { socket.destroy(); resolve({ accepted: false, header, socket, closed }); return; }
        handshake = true;
        if (!initialFrame) socket.write(clientFrame('owned-echo'));
        // Resolve on a proper unmasked server echo, preserving selected protocol.
        socket.fixtureHeader = header;
      }
      if (buffer.length >= 2 && buffer.length >= 2 + (buffer[1] & 127)) {
        const payload = buffer.subarray(2, 2 + (buffer[1] & 127)).toString('utf8');
        socket.setTimeout(0); resolve({ accepted: true, header: socket.fixtureHeader, payload, socket, closed });
      }
    });
  });
}

test('authenticated WS preserves protocols, application auth and initial-head echo; rejected WS opens no upstream connection', async () => {
  await fixture({}, async f => {
    const cookie = await bootstrap(f.port), before = f.counts();
    for (const [candidate, suppliedOrigin] of [[undefined, origin], [cookie, 'https://attacker.invalid'], [cookie, undefined]]) {
      const rejected = await websocket(f.port, candidate, { suppliedOrigin: suppliedOrigin ?? '', initialFrame: false });
      equal(rejected.accepted, false);
    }
    equal(f.counts(), before);
    const accepted = await websocket(f.port, cookie);
    try {
      equal(accepted.accepted, true); equal(accepted.payload, 'owned-echo');
      assert.equal(/Sec-WebSocket-Protocol: edith.voice.v1/i.test(accepted.header), true);
      equal(f.upgrades[0].target, '/fixture/ws?channel=voice');
      equal(f.upgrades[0].headers['sec-websocket-protocol'], 'edith.voice.v1, csrf.fixture-csrf');
      equal(f.upgrades[0].headers.authorization, 'Bearer fixture-app-token');
      equal(f.upgrades[0].headers.cookie, 'edith_owner_session=fixture-app');
      equal(f.upgrades[0].headers.origin, `http://127.0.0.1:${f.upstreamPort}`);
    } finally { accepted.socket.destroy(); await accepted.closed; }
  });
});

test('gateway session expiry closes an already-established WebSocket', async () => {
  // Default bootstrap cookie assertions stay one-hour; advance the injectable
  // clock and make a request to trigger required expiry pruning of owned WS.
  let clock = 100000;
  await fixture({ now: () => clock }, async f => {
    const cookie = await bootstrap(f.port);
    const accepted = await websocket(f.port, cookie);
    try {
      equal(accepted.accepted, true);
      clock += 3600001;
      equal((await request(f.port, { target: '/api/status', headers: { Cookie: cookie } })).status, 401);
      await Promise.race([accepted.closed, new Promise((_, reject) => { const timer = setTimeout(() => reject(Error('FIXTURE_EXPIRED_WS_NOT_CLOSED')), 1000); timer.unref(); })]);
    } finally { accepted.socket.destroy(); await accepted.closed; }
  });
});

test('more than 64 raw headers cannot hide a foreign origin beyond parsed-header limits', async () => {
  await fixture({}, async f => {
    const cookie = await bootstrap(f.port), before = f.counts();
    const response = await raw(f.port, wire('/api/status', [`Host: ${host}`, `Cookie: ${cookie}`,
      ...Array.from({ length: 65 }, (_, i) => `X-Fixture-${i}: value`), 'Origin: https://attacker.invalid']));
    assert.equal(/^HTTP\/1\.1 (?:400|431) /.test(response), true, 'excess raw header count is rejected, never truncated into trusted request');
    equal(f.counts(), before, 'over-cap headers must not open upstream TCP');
  });
});

test('SSE remains streaming beyond the upstream header deadline after headers arrive', async () => {
  await fixture({ upstreamTimeoutMs: 40 }, async f => {
    const cookie = await bootstrap(f.port);
    const response = await request(f.port, { target: '/fixture/sse', headers: { Cookie: cookie } });
    equal(response.status, 200); equal(response.text, 'data: first\n\ndata: last\n\n');
  });
});

test('invalid WS accept, unoffered protocol and reserved gateway cookie reject while upstream403 remains denied', async () => {
  await fixture({}, async f => {
    const cookie = await bootstrap(f.port);
    for (const target of ['/fixture/ws-bad-accept', '/fixture/ws-unoffered', '/fixture/ws-reserved']) {
      const result = await websocket(f.port, cookie, { target });
      try { equal(result.accepted, false, 'upstream handshake cannot manufacture a trusted session or protocol'); }
      finally { result.socket.destroy(); await result.closed; }
    }
    const denied = await websocket(f.port, cookie, { target: '/fixture/ws-denied', initialFrame: false });
    equal(denied.accepted, false);
    assert.equal(/^HTTP\/1\.1 (?:403|502) /.test(denied.header), true, 'non-upgrade response stays a finite denial');
  });
});

test('one-second configured lifetime closes an idle WS without any follow-up HTTP request', async () => {
  await fixture({ sessionTtlMs: 1000 }, async f => {
    const cookie = await bootstrap(f.port, 1);
    const result = await websocket(f.port, cookie);
    try {
      equal(result.accepted, true);
      await Promise.race([result.closed, new Promise((_, reject) => {
        const timer = setTimeout(() => reject(Error('FIXTURE_IDLE_SESSION_EXPIRY_NOT_ENFORCED')), 1600); timer.unref();
      })]);
    } finally { result.socket.destroy(); await result.closed; }
  });
});

function waitFor(condition, timeoutMs = 1200) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { clearInterval(poll); reject(Error('FIXTURE_CONDITION_TIMEOUT')); }, timeoutMs);
    const poll = setInterval(() => { if (condition()) { clearInterval(poll); clearTimeout(timer); resolve(); } }, 5);
  });
}
function pendingWs(port, cookie) {
  const socket = net.connect({ host: '127.0.0.1', port });
  const state = { socket, reply: '', failed: false };
  socket.on('error', () => { state.failed = true; });
  socket.on('data', chunk => { state.reply += chunk.toString('latin1'); });
  socket.on('connect', () => socket.write([
    'GET /fixture/ws-pending HTTP/1.1', `Host: ${host}`, `Cookie: ${cookie}`, `Origin: ${origin}`,
    'Upgrade: websocket', 'Connection: Upgrade', 'Sec-WebSocket-Version: 13',
    'Sec-WebSocket-Key: Zml4dHVyZV9tYWluX3dzIQ==', 'Sec-WebSocket-Protocol: edith.voice.v1', '', '',
  ].join('\r\n')));
  return state;
}

test('32 pending WS handshakes reserve capacity and client abort closes owned upstream sockets', async () => {
  await fixture({ upstreamTimeoutMs: 5000 }, async f => {
    const cookie = await bootstrap(f.port), clients = [];
    try {
      for (let i = 0; i < 32; i++) clients.push(pendingWs(f.port, cookie));
      await waitFor(() => f.upgrades.length >= 32);
      equal(f.upgrades.length, 32);
      const extra = pendingWs(f.port, cookie); clients.push(extra);
      await waitFor(() => f.upgrades.length > 32 || extra.reply.includes('\r\n\r\n'));
      equal(f.upgrades.length, 32, '33rd pending handshake must be denied before upstream dispatch');
      assert.equal(/^HTTP\/1\.1 (?:429|503) /.test(extra.reply), true, 'pending-capacity denial is finite');
      // The accepted-pending sockets have no 101 yet. Aborting their downstreams
      // must tear down those exact upstream sockets rather than waiting five seconds.
      for (const client of clients) client.socket.destroy();
      await waitFor(() => f.pendingSocketCount() === 0);
    } finally { for (const client of clients) client.socket.destroy(); }
  });
});

test('client half-close during pending WS handshake closes both exact owned socket halves', async () => {
  await fixture({ upstreamTimeoutMs: 5000 }, async f => {
    const cookie = await bootstrap(f.port);
    const pending = pendingWs(f.port, cookie);
    try {
      await waitFor(() => f.pendingSocketCount() === 1);
      const clientPort = pending.socket.localPort;
      assert.equal(f.hasGatewayPeer(clientPort), true, 'the exact inbound socket exists before half-close');
      pending.socket.end();
      await waitFor(() => !f.hasGatewayPeer(clientPort) && f.pendingSocketCount() === 0);
    } finally { pending.socket.destroy(); }
  });
});

test('client HTTP abort while response headers are pending closes its owned upstream socket', async () => {
  await fixture({ upstreamTimeoutMs: 5000 }, async f => {
    const cookie = await bootstrap(f.port);
    const client = http.request({ host: '127.0.0.1', port: f.port, method: 'GET', path: '/fixture/slow',
      headers: { Host: host, Cookie: cookie, Connection: 'close' } });
    client.on('error', () => {});
    client.on('response', response => response.resume());
    client.setTimeout(1800, () => client.destroy());
    try {
      client.end();
      await waitFor(() => f.pendingHttpCount() === 1);
      const clientPort = client.socket.localPort;
      client.destroy();
      await waitFor(() => f.pendingHttpCount() === 0 && !f.hasGatewayPeer(clientPort));
    } finally { client.destroy(); }
  });
});

// A fresh synthetic root belongs only to this invocation, never historical evidence.
const staticFixtureParent = path.resolve(process.env.EDITH_GATEWAY_TEST_FIXTURE_ROOT ?? tmpdir());
await noFixtureLinks(staticFixtureParent);
assert.equal((await fs.lstat(staticFixtureParent)).isDirectory(), true, 'fixture parent is an existing ordinary directory');
assert.equal((await fs.realpath(staticFixtureParent)).toLowerCase(), staticFixtureParent.toLowerCase(), 'fixture parent resolves to its own ordinary path');
const staticFixtureBase = await fs.mkdtemp(path.join(staticFixtureParent, 'edith-gateway-synthetic-'));
const staticFixtureBaseIdentity = await fs.lstat(staticFixtureBase);
after(async () => {
  await noFixtureLinks(staticFixtureBase);
  const current = await fs.lstat(staticFixtureBase);
  assert.equal(current.dev === staticFixtureBaseIdentity.dev && current.ino === staticFixtureBaseIdentity.ino, true, 'owned fixture base identity remains current');
  await fs.rmdir(staticFixtureBase); // Nonrecursive: refuse if any owned fixture failed to close/clean.
});
const frozenHtml = '<!doctype html><title>Owned frozen main</title><script type="module" src="/assets/main.js"></script><link rel="stylesheet" href="/assets/main.css">';
const publicAssetBodies = { 'assets/main.js': 'export const ownedMain = true;', 'assets/main.css': 'body{color:#123456}', 'assets/lazy.js': 'export const ownedLazy = true;' };
// Hash only the synthetic public fixture bytes or manifest, never any auth data.
const publicDigest = value => createHash('sha256').update(value).digest('hex').toUpperCase();
async function noFixtureLinks(target) {
  const absolute = path.resolve(target); let current = path.parse(absolute).root;
  for (const part of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try { assert.equal(!(await fs.lstat(current)).isSymbolicLink(), true, 'owned fixture ancestor cannot be a link'); }
    catch (error) { if (error.code === 'ENOENT') break; throw error; }
  }
}
async function staticFixture(body) {
  await noFixtureLinks(staticFixtureBase); await fs.mkdir(staticFixtureBase, { recursive: true });
  const owned = await fs.mkdtemp(path.join(staticFixtureBase, 'owned-'));
  const ownedIdentity = await fs.lstat(owned);
  const root = path.join(owned, 'dist'), manifestPath = path.join(owned, 'STATIC_DIST_MANIFEST.json');
  const expectedRelative = path.relative(staticFixtureBase, owned);
  assert.equal(path.dirname(owned) === staticFixtureBase && expectedRelative.startsWith('owned-'), true, 'new owned fixture stays inside its lease');
  try {
    await fs.mkdir(path.join(root, 'assets'), { recursive: true }); await fs.mkdir(path.join(root, '.vite'));
    const viteBody = JSON.stringify({ 'index.html': { file: 'assets/main.js', css: ['assets/main.css'], isEntry: true }, 'lazy': { file: 'assets/lazy.js' } });
    const bodies = { 'index.html': frozenHtml, ...publicAssetBodies, '.vite/manifest.json': viteBody };
    const record = (relative, contents) => ({ path: relative, size: Buffer.byteLength(contents), sha256: publicDigest(contents) });
    for (const [relative, contents] of Object.entries(bodies)) await fs.writeFile(path.join(root, relative), contents);
    const index = record('index.html', frozenHtml), assets = Object.entries(publicAssetBodies).map(([relative, contents]) => record(relative, contents));
    const viteManifestOutput = record('.vite/manifest.json', viteBody), outputs = [viteManifestOutput, ...assets, index];
    const manifest = {
      schemaVersion: 1, task: 'OWNED_SYNTHETIC_STATIC_CONSUMER_FIXTURE', status: 'STATIC_DIST_READY',
      validatedAtUtc: '2026-10-18T00:00:02.000Z', buildStartedAtUtc: '2026-10-18T00:00:00.000Z', buildFinishedAtUtc: '2026-10-18T00:00:01.000Z',
      staticRoot: root, entry: 'index.html', viteManifest: '.vite/manifest.json', index, assets, viteManifestOutput,
      freshFromCurrentMainUi: true, oldDistUsed: false, sourcePinCount: 1, sourceUnchanged: true,
      outputFiles: outputs.length, outputBytes: outputs.reduce((total, row) => total + row.size, 0), outputs,
      localReferences: [{ from: 'index.html', to: 'assets/main.js' }, { from: 'index.html', to: 'assets/main.css' },
        { from: '.vite/manifest.json', to: 'assets/main.js' }, { from: '.vite/manifest.json', to: 'assets/main.css' }, { from: '.vite/manifest.json', to: 'assets/lazy.js' }],
      bootstrapScripts: ['assets/main.js'], bootstrapLinks: ['assets/main.css'], mainUiSourceModules: 1,
      envFileObservedFalse: true, sourceMaps: false, browserOrHttpExecution: false,
      limitations: ['Owned synthetic public fixture only; no actual main application execution'],
    };
    const writeManifest = async value => {
      const bytes = Buffer.from(JSON.stringify(value)); await fs.writeFile(manifestPath, bytes);
      return { manifestPath, expectedSha256: publicDigest(bytes) };
    };
    const config = await writeManifest(manifest);
    await body({ owned, root, manifestPath, manifest, config, writeManifest });
  } finally {
    // Tests below remove their deliberate links in nested finally blocks. Refuse
    // recursive cleanup if a link remains or the unique root changed identity.
    await noFixtureLinks(owned);
    const baseReal = await fs.realpath(staticFixtureBase), ownedReal = await fs.realpath(owned);
    const currentIdentity = await fs.lstat(owned);
    assert.equal(currentIdentity.dev === ownedIdentity.dev && currentIdentity.ino === ownedIdentity.ino, true, 'owned fixture identity remains current');
    assert.equal(path.dirname(ownedReal) === baseReal && path.basename(ownedReal).startsWith('owned-'), true, 'cleanup remains inside owned fixture');
    let count = 0, bytes = 0;
    const inspect = async directory => {
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        assert.equal(!entry.isSymbolicLink(), true, 'no links may remain before recursive fixture cleanup');
        const item = path.join(directory, entry.name);
        if (entry.isDirectory()) await inspect(item);
        else { assert.equal(entry.isFile(), true); count++; bytes += (await fs.lstat(item)).size; }
        assert.equal(count <= 32 && bytes <= 262144, true, 'fixture remains small and bounded');
      }
    };
    await inspect(owned); await fs.rm(owned, { recursive: true, force: true });
  }
}

test('approved opaque static site authenticates bootstrap and serves exact local HTML/assets/HEAD/query without upstream TCP', async () => {
  await staticFixture(async f => {
    const site = await loadApprovedStaticSite(f.config);
    equal(Object.isFrozen(site), true, 'loader handle is immutable');
    await fixture({ staticSite: site }, async g => {
      for (const target of ['/', '/index.html', '/assets/main.js?v=1']) equal((await request(g.port, { target })).status, 401);
      equal(g.counts(), { connections: 0, bytes: 0 });
      const cookie = await bootstrap(g.port);
      const headers = { Cookie: cookie };
      equal((await request(g.port, { target: '/', headers })).text, frozenHtml);
      equal((await request(g.port, { target: '/index.html', headers })).text, frozenHtml);
      for (const [target, expected] of Object.entries(publicAssetBodies)) {
        const asset = await request(g.port, { target: '/' + target + '?v=fixture&import', headers });
        equal(asset.status, 200); equal(asset.text, expected); equal(asset.headers['cache-control'], 'no-store');
        const head = await request(g.port, { method: 'HEAD', target: '/' + target, headers });
        equal(head.status, 200); equal(head.text, ''); equal(head.headers['content-length'], String(Buffer.byteLength(expected)));
      }
      equal(g.counts(), { connections: 0, bytes: 0 }, 'loaded frontend bytes never contact backend');
    });
  });
});

test('static navigation fallback is explicit HTML-only while missing assets/internal/source stay404 and API auth still proxies', async () => {
  await staticFixture(async f => {
    const site = await loadApprovedStaticSite(f.config);
    await fixture({ staticSite: site }, async g => {
      const cookie = await bootstrap(g.port), headers = { Cookie: cookie };
      equal((await request(g.port, { target: '/workspace/settings?tab=main', headers: { ...headers, Accept: 'text/html' } })).text, frozenHtml);
      equal((await request(g.port, { target: '/workspace/settings', headers })).status, 404, 'SPA navigation requires explicit HTML acceptance');
      for (const target of ['/assets/missing', '/assets/missing.js', '/missing.js', '/.vite/manifest.json', '/STATIC_DIST_MANIFEST.json', '/src/main.tsx', '/server/private', '/scripts/private', '/node_modules/x', '/artifacts/x', '/@vite/client', '/.git/config']) {
        equal((await request(g.port, { target, headers: { ...headers, Accept: 'text/html' } })).status, 404, 'reserved or missing frontend path cannot fall through');
      }
      for (const target of ['/%73rc', '/%2Evite/manifest.json']) assert.equal([400, 404].includes((await request(g.port,
        { target, headers: { ...headers, Accept: 'text/html' } })).status), true, 'encoded reserved namespace never becomes SPA HTML');
      equal((await request(g.port, { method: 'POST', target: '/index.html', headers: { ...headers, Origin: origin } })).status, 405);
      equal(g.counts(), { connections: 0, bytes: 0 }, 'frontend misses never become backend requests');
      const api = await request(g.port, { target: '/api/fixture?mode=read', method: 'POST', body: 'owned-api-body',
        headers: { Cookie: cookie + '; edith_owner_session=fixture-app', Authorization: 'Bearer fixture-app-token',
          Origin: origin, 'x-edith-csrf-token': 'fixture-edith-csrf', 'Content-Length': 14 } });
      const entry = json(api.text);
      equal(entry.target, '/api/fixture?mode=read'); equal(entry.body, 'owned-api-body');
      equal(entry.headers.authorization, 'Bearer fixture-app-token'); equal(entry.headers.cookie, 'edith_owner_session=fixture-app');
      equal(entry.headers['x-edith-csrf-token'], 'fixture-edith-csrf'); equal(g.requests.length, 1);
    });
  });
});

test('loader rejects changed digest, broken provenance, inconsistent counts/sizes and missing or changed outputs', async () => {
  await staticFixture(async f => {
    await assert.rejects(loadApprovedStaticSite({ ...f.config, expectedSha256: '0'.repeat(64) }));
    const mutations = [
      m => { m.schemaVersion = 2; }, m => { m.oldDistUsed = true; }, m => { m.freshFromCurrentMainUi = false; },
      m => { m.sourceUnchanged = false; }, m => { m.envFileObservedFalse = false; }, m => { m.sourceMaps = true; },
      m => { m.outputFiles++; }, m => { m.outputBytes++; }, m => { m.assets[0].size++; },
    ];
    for (const mutate of mutations) {
      const candidate = JSON.parse(JSON.stringify(f.manifest)); mutate(candidate);
      await assert.rejects(loadApprovedStaticSite(await f.writeManifest(candidate)));
    }
    const validConfig = await f.writeManifest(f.manifest);
    const asset = path.join(f.root, 'assets/main.js');
    await fs.writeFile(asset, 'changed-public-fixture'); await assert.rejects(loadApprovedStaticSite(validConfig));
    await fs.unlink(asset); await assert.rejects(loadApprovedStaticSite(validConfig));
    await fs.writeFile(asset, publicAssetBodies['assets/main.js']);
  });
});

test('loader rejects traversal, unsafe public extensions, junctions and hardlinked synthetic outputs', async () => {
  await staticFixture(async f => {
    for (const replacement of ['../escape.js', '/absolute.js', 'assets/../main.js', 'assets/main.js.map', 'assets/private.json']) {
      const candidate = JSON.parse(JSON.stringify(f.manifest));
      const output = candidate.outputs.find(row => row.path === candidate.assets[0].path);
      candidate.assets[0].path = replacement; output.path = replacement;
      await assert.rejects(loadApprovedStaticSite(await f.writeManifest(candidate)));
    }
    const upperPath = path.join(f.root, 'assets/MAIN.js'); let createdUpper = false;
    try {
      try { await fs.writeFile(upperPath, publicAssetBodies['assets/main.js'], { flag: 'wx' }); createdUpper = true; }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
      const candidate = JSON.parse(JSON.stringify(f.manifest)), duplicate = { ...candidate.assets[0], path: 'assets/MAIN.js' };
      candidate.assets.push(duplicate); candidate.outputs.push(duplicate); candidate.outputFiles++; candidate.outputBytes += duplicate.size;
      await assert.rejects(loadApprovedStaticSite(await f.writeManifest(candidate)));
    } finally { if (createdUpper) await fs.unlink(upperPath); }
    const validConfig = await f.writeManifest(f.manifest);
    const asset = path.join(f.root, 'assets/main.js'), linkTarget = path.join(f.owned, 'owned-hardlink-target.js');
    await fs.writeFile(linkTarget, publicAssetBodies['assets/main.js']); await fs.unlink(asset); await fs.link(linkTarget, asset);
    try { await assert.rejects(loadApprovedStaticSite(validConfig)); }
    finally { await fs.unlink(asset); await fs.writeFile(asset, publicAssetBodies['assets/main.js']); }
    const assets = path.join(f.root, 'assets'), actualAssets = path.join(f.owned, 'owned-assets-target');
    await fs.rename(assets, actualAssets);
    try {
      await fs.symlink(actualAssets, assets, 'junction');
      try { await assert.rejects(loadApprovedStaticSite(validConfig)); }
      finally {
        try { await fs.unlink(assets); }
        catch (error) { if (!['EPERM', 'EISDIR'].includes(error.code)) throw error; await fs.rmdir(assets); }
      }
    } finally { await fs.rename(actualAssets, assets); }
  });
});

test('loaded buffers stay approved after disk edits and forged static handles cannot be attached', async () => {
  assert.throws(() => createMainGateway({ credential, publicOrigin: origin, upstreamPort: 54321, staticSite: {} }));
  await staticFixture(async f => {
    const site = await loadApprovedStaticSite(f.config);
    await fs.writeFile(path.join(f.root, 'index.html'), '<!doctype html><p>Changed after loading</p>');
    await fs.writeFile(path.join(f.root, 'assets/main.js'), 'changed-after-loading');
    await fixture({ staticSite: site }, async g => {
      const cookie = await bootstrap(g.port);
      equal((await request(g.port, { headers: { Cookie: cookie } })).text, frozenHtml);
      equal((await request(g.port, { target: '/assets/main.js', headers: { Cookie: cookie } })).text, publicAssetBodies['assets/main.js']);
      equal(g.counts(), { connections: 0, bytes: 0 });
    });
  });
});

test('opaque static context preserves genuine fixture WS application credentials and protocol echo', async () => {
  await staticFixture(async f => {
    const site = await loadApprovedStaticSite(f.config);
    await fixture({ staticSite: site }, async g => {
      const cookie = await bootstrap(g.port);
      equal(g.counts(), { connections: 0, bytes: 0 });
      const connected = await websocket(g.port, cookie);
      try {
        equal(connected.accepted, true); equal(connected.payload, 'owned-echo');
        equal(g.upgrades[0].headers.authorization, 'Bearer fixture-app-token');
        equal(g.upgrades[0].headers.cookie, 'edith_owner_session=fixture-app');
        equal(g.upgrades[0].headers['sec-websocket-protocol'], 'edith.voice.v1, csrf.fixture-csrf');
      } finally { connected.socket.destroy(); await connected.closed; }
    });
  });
});
