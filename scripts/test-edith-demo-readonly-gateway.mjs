import assert from 'node:assert/strict';
import { test } from 'node:test';
import http from 'node:http';
import net from 'node:net';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

// Import only the standalone source under review. Importing must not start a listener,
// load credential files, discover a workspace, or import an EDITH application module.
let subject;
try { subject = await import('./edith-demo-readonly-gateway.mjs'); }
catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }
assert.equal(typeof subject?.createDemoGateway, 'function', 'standalone gateway factory must exist before it can protect a viewer');
assert.equal(typeof subject?.parseDemoSnapshot, 'function', 'closed producer snapshot parser must exist');
assert.equal(typeof subject?.readDemoSnapshot, 'function', 'bounded snapshot reader must exist');
const { createDemoGateway, parseDemoSnapshot, readDemoSnapshot } = subject;

const now = Date.parse('2026-10-18T10:00:00.000Z');
const expectedHost = '127.0.0.1:3107';
// Fresh test-only credential stays in memory. Never assert, print, hash or persist it.
const credential = Object.freeze({ username: 'demo', password: randomBytes(32).toString('base64url') });
const authorization = 'Basic ' + Buffer.from(credential.username + ':' + credential.password).toString('base64');
const fixtureRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../artifacts/ngrok-demo-20261018/chat4/demo-gateway/tests');
const clone = value => JSON.parse(JSON.stringify(value));
// Boolean comparisons prevent a failing assertion from printing an unexpected
// response that could contain a reflected Authorization header or credential.
const safeEqual = (actual, expected, message = 'public response matches contract') => assert.equal(isDeepStrictEqual(actual, expected), true, message);
function snapshot() {
  return {
    schemaVersion: 1, observedAt: new Date(now - 1000).toISOString(), sessionId: 'demo_fixture_1',
    currency: 'VIRTUAL_USD', initialBalance: 1, decisionSource: 'scripted_fixture', marketSource: 'synthetic_fixture',
    state: 'running', currentCash: 0.99999999, currentEquity: 1, fees: 0.00000001, realizedPnl: 0,
    decisions: [{ id: 'decision_1', action: 'HOLD', executed: false, reason: 'none' }],
    trades: [{ id: 'trade_1', side: 'BUY', quoteAmount: 0.00000001, quantity: 0.00000001, price: 1, fee: 0, pnl: 0 }],
    stop: { requested: false, reason: 'none', loopStopped: false, ownedProcessClosed: false },
    realMoneyUsed: false, realOrderSent: false, liveExecutionEnabled: false, actualJevObservation: 'UNRUN',
  };
}
async function withGateway(options, body) {
  const server = createDemoGateway({ credential, snapshotPath: path.join(fixtureRoot, 'must-not-read.json'),
    host: '127.0.0.1', port: 0, now: () => now, ...options });
  assert.equal(server.listening, false, 'factory must not implicitly start its server');
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.equal(address.address, '127.0.0.1');
  try { await body(address.port); }
  finally {
    server.closeAllConnections?.();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}
function request(port, options = {}) {
  const { target = '/api/demo/status', method = 'GET', host = expectedHost, headers = {} } = options;
  const auth = Object.hasOwn(options, 'auth') ? options.auth : authorization;
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: target, method,
      headers: { Host: host, ...(auth === undefined ? {} : { Authorization: auth }), ...headers } }, res => {
      const chunks = [];
      res.on('data', value => chunks.push(value));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.setTimeout(2000, () => req.destroy(new Error('FIXTURE_HTTP_TIMEOUT')));
    req.on('error', () => reject(new Error('FIXTURE_HTTP_FAILED')));
    req.end();
  });
}
function rawRequest(port, text) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    let response = '';
    socket.setTimeout(2000, () => socket.destroy(new Error('FIXTURE_SOCKET_TIMEOUT')));
    socket.on('connect', () => socket.write(text));
    socket.on('data', chunk => { response += chunk.toString('utf8'); });
    socket.on('error', () => reject(new Error('FIXTURE_SOCKET_FAILED')));
    socket.on('close', () => resolve(response));
  });
}
function checkSecurityHeaders(response) {
  assert.equal(/no-store/i.test(response.headers['cache-control'] ?? ''), true);
  safeEqual(response.headers['x-content-type-options'], 'nosniff');
  safeEqual(response.headers['access-control-allow-origin'], undefined);
}

test('closed parser preserves exact original observation and 8-decimal virtual amounts', () => {
  const input = snapshot();
  assert.deepEqual(parseDemoSnapshot(input, { now }), input);
  assert.equal(parseDemoSnapshot({ ...input, currentEquity: null }, { now }).currentEquity, null);
  const actual = { ...input, decisionSource: 'actual_decision', marketSource: 'public_market', actualJevObservation: 'OBSERVED' };
  assert.equal(parseDemoSnapshot(actual, { now }).actualJevObservation, 'OBSERVED');
});

test('parser rejects private/excess fields and schema, time, source, real-execution and finite-number violations', () => {
  const mutations = [
    row => { row.privateAccount = 'fixture-private'; }, row => { delete row.observedAt; }, row => { row.schemaVersion = 2; },
    row => { row.observedAt = '2026-10-18T10:00:00+00:00'; }, row => { row.observedAt = new Date(now + 1).toISOString(); },
    row => { row.observedAt = '2026-02-30T10:00:00.000Z'; }, row => { row.sessionId = 'C:/fixture/path'; },
    row => { row.currency = 'USD'; }, row => { row.initialBalance = 10000; }, row => { row.state = 'connected'; },
    row => { row.decisionSource = 'unknown'; }, row => { row.marketSource = 'unknown'; },
    row => { row.actualJevObservation = 'OBSERVED'; }, row => { row.realMoneyUsed = true; },
    row => { row.realOrderSent = true; }, row => { row.liveExecutionEnabled = true; },
    row => { row.currentCash = -1; }, row => { row.currentCash = Infinity; }, row => { row.currentEquity = -1; },
    row => { row.fees = -1; }, row => { row.realizedPnl = NaN; },
    row => { row.decisions[0].reason = 'arbitrary provider exception'; }, row => { row.decisions[0].raw = 'fixture'; },
    row => { row.decisions[0].executed = 'false'; }, row => { row.decisions[0].action = 'TRANSFER'; },
    row => { row.trades[0].price = Infinity; }, row => { row.trades[0].side = 'WITHDRAW'; },
    row => { row.trades[0].account = 'fixture'; }, row => { row.stop.reason = 'arbitrary failure'; },
    row => { row.stop.pid = 123; }, row => { row.stop.loopStopped = 'true'; },
    row => { row.decisions = Array.from({ length: 17 }, (_, i) => ({ id: `decision_${i}`, action: 'HOLD', executed: false, reason: 'none' })); },
    row => { row.trades = Array.from({ length: 9 }, (_, i) => ({ id: `trade_${i}`, side: 'BUY', quoteAmount: 0, quantity: 0, price: 1, fee: 0, pnl: 0 })); },
  ];
  for (const [index, mutate] of mutations.entries()) {
    const row = clone(snapshot()); mutate(row);
    assert.throws(() => parseDemoSnapshot(row, { now }), `invalid producer case ${index} must be rejected`);
  }
});

test('auth precedes snapshot access even for invalid paths and mutations; correct auth yields exact bounded status', async () => {
  let reads = 0;
  await withGateway({ readSnapshot: async () => { reads++; return snapshot(); } }, async port => {
    for (const auth of [undefined, 'Basic bm90LXRoaXM6bm90LXZhbGlk', 'Bearer fixture', 'Basic !!!']) {
      const denied = await request(port, { auth });
      assert.equal(denied.status, 401); checkSecurityHeaders(denied);
    }
    for (const target of ['/api/chat', '/api/tools/execute', '/api/demo/status?x=1']) {
      assert.equal((await request(port, { target, auth: '', method: 'POST' })).status, 401);
    }
    assert.equal(reads, 0, 'unauthorized traffic must not read a snapshot');
    const status = await request(port);
    assert.equal(status.status, 200); checkSecurityHeaders(status);
    const data = JSON.parse(status.text);
    safeEqual(Object.keys(data).sort(), ['display', 'fullEdithUi', 'readOnly', 'schemaVersion', 'snapshot', 'view']);
    safeEqual(data.schemaVersion, 1); safeEqual(data.view, 'isolated_crypto_demo');
    safeEqual(data.fullEdithUi, false); safeEqual(data.readOnly, true);
    safeEqual(data.snapshot, snapshot());
    safeEqual(data.display, { mode: 'live_fixture', ageMs: 1000, actualJevObservation: 'UNRUN' });
    assert.equal(reads, 1);
  });
});

test('only exact read routes are allowed; EDITH routes, encoded paths, queries, methods and hostile host/origin fail closed', async () => {
  let reads = 0;
  await withGateway({ readSnapshot: async () => { reads++; return snapshot(); } }, async port => {
    for (const target of ['/api/chat', '/api/tools/execute', '/api/mobile/pairing/request', '/api/security/session', '/@vite/client', '/src/main.tsx', '/unknown']) {
      assert.equal((await request(port, { target })).status, 404);
    }
    for (const target of ['/api/demo/status?x=1', '/api/demo/%73tatus', '/api/demo/status/', '/../api/demo/status', '/api/demo/../demo/status', '//api/demo/status']) {
      assert.ok([400, 404].includes((await request(port, { target })).status), 'raw noncanonical route must be rejected');
    }
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      assert.equal((await request(port, { method })).status, 405);
    }
    assert.ok([400, 403].includes((await request(port, { host: 'attacker.invalid', headers: { 'X-Forwarded-Host': expectedHost, 'X-Forwarded-Proto': 'https' } })).status));
    assert.ok([400, 403].includes((await request(port, { headers: { Origin: 'https://attacker.invalid' } })).status));
    assert.equal(reads, 0, 'blocked routes must not reach snapshot reader or an upstream');
    const health = await request(port, { target: '/healthz' });
    assert.equal(health.status, 200); checkSecurityHeaders(health);
    assert.equal(reads, 0, 'gateway health must be inert');
    const page = await request(port, { target: '/' });
    assert.equal(page.status, 200); checkSecurityHeaders(page);
    assert.equal(/VIRTUAL_USD/.test(page.text), true);
    const head = await request(port, { method: 'HEAD' });
    assert.equal(head.status, 200); safeEqual(head.text, '');
  });
});

test('WebSocket upgrade and CONNECT never become an EDITH tunnel', async () => {
  let reads = 0;
  await withGateway({ readSnapshot: async () => { reads++; return snapshot(); } }, async port => {
    const ws = await rawRequest(port, `GET /api/demo/status HTTP/1.1\r\nHost: ${expectedHost}\r\nAuthorization: ${authorization}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: Zml4dHVyZV9ub19yZW1vdGU=\r\n\r\n`);
    assert.equal(/^HTTP\/1\.[01] (?:400|403|404|405|426) /.test(ws), true);
    const connect = await rawRequest(port, `CONNECT example.invalid:443 HTTP/1.1\r\nHost: ${expectedHost}\r\nAuthorization: ${authorization}\r\n\r\n`);
    assert.equal(/^HTTP\/1\.[01] (?:400|403|404|405) /.test(connect), true);
    assert.equal(reads, 0);
  });
});

test('raw ambiguous headers, HTTPS origin, bodies and expectations cannot reach the snapshot reader', async () => {
  let reads = 0;
  await withGateway({ readSnapshot: async () => { reads++; return snapshot(); } }, async port => {
    const raw = (headers, body = '') => `GET /api/demo/status HTTP/1.1\r\n${headers.join('\r\n')}\r\nConnection: close\r\n\r\n${body}`;
    const cases = [
      { status: 403, headers: [`Host: ${expectedHost}`, 'Host: attacker.invalid', `Authorization: ${authorization}`] },
      { status: 400, headers: [`Authorization: ${authorization}`] },
      { status: 401, headers: [`Host: ${expectedHost}`, `Authorization: ${authorization}`, `Authorization: ${authorization}`] },
      { status: 403, headers: [`Host: ${expectedHost}`, `Authorization: ${authorization}`, `Origin: https://${expectedHost}`] },
      { status: 400, headers: [`Host: ${expectedHost}`, `Authorization: ${authorization}`, 'Content-Length: 1'], body: 'x' },
      { status: 401, headers: [`Host: ${expectedHost}`, 'Expect: 100-continue', 'Content-Length: 1'] },
      { status: 400, headers: [`Host: ${expectedHost}`, `Authorization: ${authorization}`, 'Expect: 100-continue', 'Content-Length: 1'] },
      { status: 400, headers: [`Host: ${expectedHost}`, `Authorization: ${authorization}`, `X-Fixture-Large: ${'x'.repeat(9000)}`] },
    ];
    for (const [index, scenario] of cases.entries()) {
      const response = await rawRequest(port, raw(scenario.headers, scenario.body));
      // Never pass raw responses or headers to assertion diagnostics.
      assert.equal(response.startsWith(`HTTP/1.1 ${scenario.status} `), true, `raw rejection case ${index}`);
      assert.equal(response.includes('HTTP/1.1 100 Continue'), false, `no interim acceptance for case ${index}`);
    }
    assert.equal(reads, 0, 'all malformed/bodied requests stop before snapshot access');
  });
});

test('original clocks distinguish stale running captures, actual observations and recorded stopped results', async () => {
  let current = snapshot();
  await withGateway({ readSnapshot: async () => clone(current) }, async port => {
    current.observedAt = new Date(now - 31000).toISOString();
    let data = JSON.parse((await request(port)).text);
    safeEqual(data.display.mode, 'stale'); safeEqual(data.display.ageMs, 31000);
    safeEqual(data.snapshot.observedAt, current.observedAt);
    current = { ...snapshot(), decisionSource: 'actual_decision', marketSource: 'public_market', actualJevObservation: 'OBSERVED' };
    data = JSON.parse((await request(port)).text);
    safeEqual(data.display.mode, 'live_observation'); safeEqual(data.display.actualJevObservation, 'OBSERVED');
    for (const state of ['ready', 'stopped', 'blocked', 'failed']) {
      current = { ...snapshot(), state, stop: { requested: true, reason: 'scenario_complete', loopStopped: true, ownedProcessClosed: true } };
      data = JSON.parse((await request(port)).text);
      safeEqual(data.display.mode, 'recorded');
      safeEqual(data.snapshot.stop, current.stop);
      safeEqual(data.snapshot.observedAt, current.observedAt);
    }
  });
});

test('bounded real reader rejects missing, malformed, excess and oversized fixtures without inventing a funded status', async () => {
  await fs.mkdir(fixtureRoot, { recursive: true });
  const owned = await fs.mkdtemp(path.join(fixtureRoot, 'owned-'));
  const file = path.join(owned, 'snapshot.json');
  try {
    await fs.writeFile(file, JSON.stringify(snapshot()));
    assert.deepEqual(await readDemoSnapshot(file, { now }), snapshot());
    await withGateway({ snapshotPath: file }, async port => {
      assert.equal((await request(port)).status, 200);
      for (const body of ['{', JSON.stringify({ ...snapshot(), privateState: 'fixture' }), ' '.repeat(32769)]) {
        await fs.writeFile(file, body);
        await assert.rejects(readDemoSnapshot(file, { now }));
        const response = await request(port);
        assert.equal(response.status, 503); checkSecurityHeaders(response);
        assert.equal(response.text.includes(owned), false);
        assert.equal(response.text.includes('privateState'), false);
        assert.equal(response.text.includes('currentCash'), false, 'failure must not fabricate a balance');
      }
      await fs.unlink(file);
      const response = await request(port);
      assert.equal(response.status, 503);
      assert.equal(response.text.includes('currentCash'), false);
    });
  } finally { await fs.rm(owned, { recursive: true, force: true }); }
});

test('snapshot exceptions have a fixed bounded response without internal path or provider error text', async () => {
  await withGateway({ readSnapshot: async () => { throw Error('FIXTURE_INTERNAL_PATH_DO_NOT_ECHO'); } }, async port => {
    const response = await request(port);
    assert.equal(response.status, 503); checkSecurityHeaders(response);
    assert.equal(response.text.includes('FIXTURE_INTERNAL_PATH_DO_NOT_ECHO'), false);
    assert.equal(response.text.includes('currentCash'), false);
    assert.ok(Buffer.byteLength(response.text) < 1024);
  });
});
