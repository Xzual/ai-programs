import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import express from 'express';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// All mutation traffic terminates in fixtures. No Python service, provider or account is used.
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const storageKey = 'edith.crypto.pendingOperation.v1';
const paths = ['demo/buy', 'demo/sell', 'demo/hold', 'demo/reset', 'decision/run'];
const buttons = ['DEMO AL', 'DEMO SAT', 'DEMO BEKLE / HOLD', 'Demo Hesabı Sıfırla', 'Run Jev Decision', "Jev'i Çalıştır"];
const envelope = (data) => ({ ok: true, data, meta: { requestId: randomUUID(), timestamp: new Date().toISOString() } });
const failure = (code, requestId, data = {}) => ({
  ok: false, data, ...data, error: { code, message: 'Fixture rejection.' }, errorCode: code, safeMessage: 'Fixture rejection.',
  meta: { requestId, timestamp: new Date().toISOString() },
});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function eventually(check, label) {
  let last;
  for (let i = 0; i < 140; i++) {
    try { await check(); return; } catch (error) { last = error; }
    await sleep(50);
  }
  throw new Error(`${label}: ${last?.message}`);
}
const listen = (app) => new Promise((resolve) => {
  const server = app.listen(0, '127.0.0.1', () => resolve(server));
});
const close = (server) => new Promise((resolve, reject) => {
  server.close((error) => error ? reject(error) : resolve());
  server.closeAllConnections();
});

async function proxyTests() {
  const bundle = await build({
    entryPoints: ['server/routes/crypto.ts'], bundle: true, platform: 'node', format: 'cjs', write: false,
    packages: 'external', plugins: [{ name: 'isolated-service', setup(builder) {
      builder.onResolve({ filter: /edith\/cryptoService$/ }, () => ({ path: 'service-fixture', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const cryptoService = {};' }));
    } }],
  });
  const forwarded = [];
  let bodyAborted = false;
  let responder = () => new Response(JSON.stringify(envelope({ healthy: true })));
  const module = { exports: {} };
  vm.runInNewContext(bundle.outputFiles[0].text, {
    module, exports: module.exports, require: createRequire(import.meta.url),
    process: { env: { EDITH_CRYPTO_SERVICE_URL: 'http://fixture.invalid:5555' } },
    AbortController, URL, setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 120)), clearTimeout,
    fetch: async (url, init) => { forwarded.push({ url, init }); return responder(url, init); },
  });
  const app = express();
  app.use(express.json());
  app.use(module.exports.createCryptoRouter());
  const server = await listen(app);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const route of paths) {
      for (const clientRequestId of [undefined, 'short', 'bad id value', 'a'.repeat(129)]) {
        const response = await fetch(`${base}/api/crypto/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientRequestId }) });
        assert.equal(response.status, 400);
        assert.equal((await response.json()).error.code, 'invalid_request');
      }
    }
    assert.equal(forwarded.length, 0, 'invalid writes never reach the backend');
    console.log('PASS proxy validates request identity for all five mutations');

    for (const route of paths) {
      for (const identity of [
        { idempotencyKey: 'custom_request_123' }, { clientRequestId: 'custom_request_123' },
        { clientRequestId: 'custom_request_123', idempotencyKey: 'custom_request_123' },
        { idempotencyKey: 'a'.repeat(8) }, { clientRequestId: 'a'.repeat(128) },
      ]) {
        const body = { ...identity, symbol: 'BTCUSDT' };
        const response = await fetch(`${base}/api/crypto/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        assert.equal(response.status, 200, `${route}: accepted request identity`);
        assert.deepEqual(JSON.parse(forwarded.at(-1).init.body), body, 'proxy preserves backend normalization input');
      }
      const count = forwarded.length;
      const response = await fetch(`${base}/api/crypto/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientRequestId: 'custom_request_123', idempotencyKey: 'different_request_456' }) });
      assert.equal(response.status, 400);
      assert.equal(forwarded.length, count, 'conflicting identities never reach the backend');
    }
    console.log('PASS idempotencyKey alias, custom IDs, equal aliases and conflict rejection');

    const id = randomUUID();
    for (const route of [
      'portfolio', 'session', 'sessions', 'decisions', 'decisions/latest',
      'decisions/jev_decision_fixture', 'trades/demo_trade_fixture', `operations/${id}`,
      'operations/loop_internal_12345678', `operations/${'a'.repeat(8)}`, `operations/${'a'.repeat(128)}`,
    ]) {
      const query = '?symbol=BTCUSDT&source=jev&limit=12';
      const response = await fetch(`${base}/api/crypto/${route}${query}`);
      assert.equal(response.status, 200, route);
      const actual = new URL(forwarded.at(-1).url);
      assert.equal(actual.pathname, `/api/crypto/${route}`);
      assert.equal(actual.search, query);
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }
    const before = forwarded.length;
    for (const route of ['orders', 'live/buy', 'trades/a%2Fb', 'operations/recent', `operations/${'a'.repeat(129)}`]) {
      const response = await fetch(`${base}/api/crypto/${route}`, { method: route === 'live/buy' ? 'POST' : 'GET' });
      assert.ok([400, 404].includes(response.status), route);
    }
    assert.equal(forwarded.length, before, 'non-allowlisted and unsafe paths are not forwarded');
    console.log('PASS recovery/history routes, filters and execution allowlist');

    const original = { ...envelope({ clientRequestId: id, operationId: 'crypto_op_fixture', tradeId: 'demo_trade_fixture', execution: { executed: true, blocked: false, reason: null } }), clientRequestId: id, tradeId: 'demo_trade_fixture' };
    responder = () => new Response(JSON.stringify(original));
    for (const route of paths) {
      const response = await fetch(`${base}/api/crypto/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientRequestId: id, symbol: 'BTCUSDT' }) });
      assert.deepEqual(await response.json(), original);
      assert.equal(JSON.parse(forwarded.at(-1).init.body).clientRequestId, id);
    }
    console.log('PASS new envelope and legacy root aliases preserved');

    const canonical = failure('jev_unavailable', id, { clientRequestId: id, operationId: 'crypto_op_fixture', decisionId: 'jev_decision_failed', decision: { decisionId: 'jev_decision_failed', valid: false, executed: false }, status: 'failed' });
    responder = () => new Response(JSON.stringify(canonical), { status: 503 });
    for (let replay = 0; replay < 2; replay++) {
      const response = await fetch(`${base}/api/crypto/decision/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientRequestId: id }) });
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), canonical, 'canonical error replay preserves original meta, data, IDs and failed decision');
    }
    const validation = failure('invalid_request', id);
    responder = () => new Response(JSON.stringify(validation), { status: 400 });
    assert.deepEqual(await (await fetch(`${base}/api/crypto/demo/buy`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientRequestId: id }) })).json(), validation);
    console.log('PASS canonical error replay and validation correlation preserved exactly');

    responder = (_url, init) => new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode('{"ok":true,"data":'));
      init.signal.addEventListener('abort', () => {
        bodyAborted = true;
        controller.error(new Error('http://private.example/?token=TEST_SECRET'));
      }, { once: true });
    } }), { headers: { 'Content-Type': 'application/json' } });
    const count = forwarded.length;
    const response = await fetch(`${base}/api/crypto/demo/buy`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientRequestId: id }) });
    const error = await response.json();
    assert.equal(response.status, 503);
    assert.equal(bodyAborted, true, 'timeout aborts the response body after headers');
    assert.equal(forwarded.length, count + 1, 'the proxy never retries');
    assert.equal(error.clientRequestId, id);
    assert.equal(error.recovery.required, true);
    assert.equal(error.recovery.path, `/api/crypto/operations/${id}`);
    assert.match(error.meta.requestId, uuid);
    assert.doesNotMatch(JSON.stringify(error), /http|TEST_SECRET|failed|serviceUrl/);

    responder = () => new Response(JSON.stringify(envelope({ clientRequestId: id, status: 'completed', operationId: 'crypto_op_fixture', tradeId: 'demo_trade_fixture', result: original })));
    const recovered = await (await fetch(`${base}${error.recovery.path}`)).json();
    assert.deepEqual(recovered.data.result, original);
    responder = () => new Response(JSON.stringify({ ok: false, error: { code: 'jev_timeout', message: 'http://secret/TEST_SECRET' }, safeMessage: 'TEST_SECRET', operationId: 'crypto_op_fixture' }), { status: 504 });
    const rejected = await (await fetch(`${base}/api/crypto/decision/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientRequestId: id }) })).json();
    assert.equal(rejected.errorCode, 'jev_timeout');
    assert.equal(rejected.operationId, undefined, 'unrecognized envelopes cannot leak arbitrary ID fields');
    assert.doesNotMatch(JSON.stringify(rejected), /http|TEST_SECRET|serviceUrl/);
    responder = () => new Response(JSON.stringify({ ok: false, data: {}, meta: { requestId: id, timestamp: new Date().toISOString() }, operationId: 'TEST_SECRET', tradeId: 'TEST_SECRET', error: { code: 'unknown_code', message: 'http://secret/TEST_SECRET' }, errorCode: 'unknown_code', safeMessage: 'http://secret/TEST_SECRET' }), { status: 500 });
    const unknown = await (await fetch(`${base}/api/crypto/demo/buy`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientRequestId: id }) })).json();
    assert.equal(unknown.errorCode, 'crypto_response_unconfirmed');
    assert.doesNotMatch(JSON.stringify(unknown), /http|TEST_SECRET|serviceUrl/);
    console.log('PASS body timeout, no retry, recovery ID and sanitized errors');
  } finally { await close(server); }
}

function readFixture(url, state) {
  const now = new Date().toISOString();
  const symbol = url.searchParams.get('symbol') || 'BTCUSDT';
  const stale = state.stale;
  const stamp = stale ? new Date(Date.now() - 90000).toISOString() : now;
  const portfolio = {
    initialBalance: 10000, currentCash: 9000, currentEquity: 10000, feeRate: 0.001,
    portfolioSessionId: 'session_fixture', updatedAt: now, portfolioValuationTimestamp: stamp,
    valuationStatus: stale ? 'stale' : 'fresh', oldestPriceAgeMs: stale ? 90000 : 0,
    openPositions: [{ symbol: 'BTCUSDT', entryPrice: 50000, currentPrice: 50001, amount: 0.02, unrealizedPnl: 1, source: 'manual', currentPriceTimestamp: stamp, marketDataAgeMs: stale ? 90000 : 0, marketDataStatus: stale ? 'stale' : 'fresh' }],
  };
  const data = {
    '/api/crypto/status': { running: true, demoMode: true, demoTradingEnabled: true, liveExecutionEnabled: false, realMoneyUsed: false, maxMarketDataAgeMs: 15000 },
    '/api/crypto/symbols': { symbols: ['BTCUSDT', 'ETHUSDT'].map((symbol) => ({ symbol, mode: 'DEMO_TRADE_ALLOWED' })) },
    '/api/crypto/market': {
      symbol, timeframe: url.searchParams.get('timeframe') || '1m', status: 'online', fresh: !stale, updatedAt: stamp, realData: true,
      ticker: { last: 50001, change24h: 1, high24h: 51000, low24h: 49000, volume24h: 100, spreadPct: 0.01 },
      candles: Array.from({ length: 20 }, (_, i) => ({ time: Math.floor(Date.now() / 60000) * 60 - (20 - i) * 60, open: 50000 + i, high: 50030 + i, low: 49900 - i, close: 50020 - i, volume: 5 + i })),
      orderBook: { asks: [{ price: 50002, amount: 1 }], bids: [{ price: 50000, amount: 2 }] },
    },
    '/api/crypto/portfolio': { portfolio },
    '/api/crypto/trades': { trades: state.trades },
    '/api/crypto/decision/latest': { decision: state.decision },
    '/api/crypto/jev/status': { configured: true, available: true, status: 'ready', model: 'fixture-active' },
    '/api/crypto/jev/loop': { state: 'STOPPED', running: false, lastDecisions: [] },
  }[url.pathname];
  assert.ok(data, `Unexpected fixture read ${url.pathname}`);
  return state.legacy ? data : envelope(data);
}

async function browserTests() {
  const app = express();
  const server = await listen(app);
  const evidence = await mkdtemp(path.join(os.tmpdir(), 'edith-crypto-recovery-'));
  const vite = await createServer({
    configFile: false, cacheDir: path.join(evidence, 'vite-cache'), plugins: [react(), tailwindcss()],
    optimizeDeps: { entries: ['src/components/crypto/CryptoExchangeTerminal.tsx'], include: ['react-dom/client'] },
    server: { middlewareMode: true, hmr: { server } }, appType: 'custom',
  });
  const escapedNetwork = [];
  app.use('/api', (req, res) => { escapedNetwork.push(req.url); res.status(500).json({ ok: false }); });
  app.use(vite.middlewares);
  app.get('/', async (_req, res) => res.type('html').send(await vite.transformIndexHtml('/', `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;overflow:auto"><div id="root"></div><script type="module">import React from 'react'; import {createRoot} from 'react-dom/client'; import {CryptoExchangeTerminal} from '/src/components/crypto/CryptoExchangeTerminal.tsx'; import '/src/index.css'; createRoot(document.getElementById('root')).render(React.createElement(CryptoExchangeTerminal));</script></body></html>`)));
  const browser = await chromium.launch({ headless: true });
  try {
    for (const legacy of [false, true]) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block', reducedMotion: 'reduce' });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      const writes = [];
      const lookups = [];
      const delayedReplies = [];
      const state = { legacy, stale: false, decision: null, trades: [], mode: 'timeout', status: 'pending', result: null, current: null, lookupMode: 'valid' };
      await context.route('**/api/**', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (request.method() === 'POST') {
          assert.ok(paths.some((entry) => url.pathname === `/api/crypto/${entry}`));
          const body = request.postDataJSON();
          assert.match(body.clientRequestId, uuid);
          if (url.pathname === '/api/crypto/decision/run') assert.deepEqual(Object.keys(body).sort(), ['clientRequestId', 'symbol'], 'decision payload matches backend normalization');
          writes.push({ path: url.pathname, body });
          state.current = body.clientRequestId;
          state.result = envelope({
            clientRequestId: body.clientRequestId, operationId: `crypto_op_${body.clientRequestId}`,
            tradeId: url.pathname.endsWith('/hold') || url.pathname.endsWith('/reset') ? null : `demo_trade_${body.clientRequestId}`,
            decisionId: `jev_decision_${body.clientRequestId}`,
            execution: { executed: url.pathname.endsWith('/buy') || url.pathname.endsWith('/sell'), blocked: false, reason: null },
            realOrderSent: false,
          });
          if (state.status === 'failed') state.result = failure('jev_timeout', state.current, { clientRequestId: state.current, status: 'failed', decisionId: 'jev_decision_failed', operationId: `crypto_op_${state.current}` });
          if (state.mode === 'veto' || state.mode === 'veto-timeout') {
            state.status = 'rejected';
            state.decision = {
              decisionId: `jev_decision_${state.current}`, clientRequestId: state.current, operationId: `crypto_op_${state.current}`,
              symbol: body.symbol, action: 'BUY', valid: true, source: 'jev', executed: false, tradeId: null,
              blockedReason: 'risk_rejected', riskResult: 'risk_rejected', model: 'fixture-veto', timestamp: new Date().toISOString(),
            };
            state.result = envelope({
              clientRequestId: state.current, operationId: `crypto_op_${state.current}`, decisionId: state.decision.decisionId,
              tradeId: null, status: 'rejected', execution: { blocked: true, executed: false, reason: 'risk_rejected' },
              decision: state.decision, riskResult: 'risk_rejected', realOrderSent: false,
            });
            if (state.mode === 'veto-timeout') return route.abort('timedout');
          }
          if (state.mode === 'validation' || state.mode === 'uncorrelated-validation') {
            state.result = failure('invalid_request', state.mode === 'validation' ? state.current : randomUUID());
            return route.fulfill({ status: 400, json: state.result });
          }
          if (state.mode === 'delayed') {
            const original = state.result;
            return new Promise((resolve) => delayedReplies.push(async () => { await route.fulfill({ json: original }); resolve(); }));
          }
          if (state.mode === 'timeout') return route.abort('timedout');
          if (state.mode === 'malformed') return route.fulfill({ status: 200, contentType: 'application/json', body: '{' });
          if (state.mode === 'accepted') return route.fulfill({ status: 202, json: state.result });
          if (state.mode === 'rejected') {
            state.status = 'rejected';
            state.result = failure('stale_market_data', state.current, { clientRequestId: state.current, status: 'rejected' });
            return route.fulfill({ status: 409, json: state.result });
          }
          return route.fulfill({ json: legacy ? { ...state.result.data, ok: true } : state.result });
        }
        assert.equal(request.method(), 'GET');
        if (url.pathname.startsWith('/api/crypto/operations/')) {
          const id = url.pathname.split('/').at(-1);
          lookups.push(id);
          if (state.lookupMode === 'missing') return route.fulfill({ status: 404, json: { ok: false, errorCode: 'operation_not_found' } });
          if (state.lookupMode === 'malformed') return route.fulfill({ json: envelope({ clientRequestId: id, status: 'completed', result: null }) });
          if (state.lookupMode.startsWith('empty-') || state.lookupMode.startsWith('uncorrelated-')) {
            const status = state.lookupMode.split('-').at(-1);
            return route.fulfill({ json: envelope({ clientRequestId: id, status, result: state.lookupMode.startsWith('empty-') ? {} : failure('jev_unavailable', randomUUID()) }) });
          }
          const data = { clientRequestId: state.lookupMode === 'mismatch' ? randomUUID() : id, status: state.status, operationId: `crypto_op_${id}`, result: state.result };
          return route.fulfill({ json: legacy ? { ...data, ok: true } : envelope(data) });
        }
        return route.fulfill({ json: readFixture(url, state) });
      });
      const base = `http://127.0.0.1:${server.address().port}`;
      const button = (name) => page.getByRole('button', { name, exact: true });
      const locked = async () => {
        for (const name of buttons) assert.equal(await button(name).isDisabled(), true, name);
        assert.equal(await page.getByText('İşlem sonucu doğrulanıyor.', { exact: true }).count(), 1);
      };
      const recheck = async () => {
        const count = lookups.length;
        await button('İşlem durumunu tekrar kontrol et').click();
        await eventually(async () => assert.ok(lookups.length > count), 'lookup sent');
      };
      await page.goto(base);
      await eventually(async () => assert.equal(await button('DEMO AL').isEnabled(), true), 'ready');
      await button('DEMO AL').dblclick();
      await eventually(locked, 'timeout locks every mutation');
      assert.equal(writes.length, 1, 'rapid clicks send one write');
      const id = writes[0].body.clientRequestId;
      assert.equal(await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key)).clientRequestId, storageKey), id);
      await page.reload();
      await eventually(locked, 'reload keeps pending lock');
      for (const mode of ['missing', 'malformed', 'mismatch', 'empty-rejected', 'empty-failed', 'uncorrelated-rejected', 'uncorrelated-failed']) {
        state.lookupMode = mode;
        await recheck();
        await locked();
        assert.equal(writes.length, 1);
      }
      state.lookupMode = 'valid';
      state.status = 'completed';
      await recheck();
      await eventually(async () => {
        assert.match(await page.getByTestId('crypto-operation-result').innerText(), new RegExp(id));
        assert.equal(await page.evaluate((key) => sessionStorage.getItem(key), storageKey), null);
      }, 'completed lookup restores original result and clears lock');
      assert.ok(lookups.every((entry) => entry === id), 'recovery always uses the original UUID');
      assert.equal(writes.length, 1);
      console.log(`PASS ${legacy ? 'legacy root' : 'data envelope'} timeout, reload, missing/malformed lookup and no duplicate`);

      for (const [name, expected, mode] of [
        ['DEMO SAT', 'demo/sell', 'complete'], ['DEMO BEKLE / HOLD', 'demo/hold', 'accepted'],
        ['Run Jev Decision', 'decision/run', 'malformed'], ['Demo Hesabı Sıfırla', 'demo/reset', 'complete'],
      ]) {
        state.mode = mode;
        state.status = 'pending';
        if (expected.endsWith('reset')) page.once('dialog', async (dialog) => {
          assert.match(dialog.message(), /arşivlenerek/);
          assert.doesNotMatch(dialog.message(), /silin/);
          await dialog.accept();
        });
        await eventually(async () => assert.equal(await button(name).isEnabled(), true), name);
        await button(name).click();
        await eventually(async () => assert.equal(writes.at(-1).path, `/api/crypto/${expected}`), expected);
        if (['accepted', 'malformed'].includes(mode)) {
          await eventually(locked, `${mode} stays pending`);
          state.status = 'completed';
          await recheck();
        }
        await eventually(async () => assert.equal(await page.getByTestId('crypto-pending-operation').count(), 0), 'resolved');
      }
      assert.equal(new Set(writes.map(({ body }) => body.clientRequestId)).size, 5);
      assert.equal(writes.length, 5);
      state.mode = 'rejected';
      await button('DEMO AL').click();
      await eventually(async () => assert.match(await page.getByTestId('crypto-operation-result').innerText(), /reddedildi/), 'rejected operation');
      state.mode = 'timeout';
      state.status = 'failed';
      await button('DEMO BEKLE / HOLD').click();
      await eventually(async () => assert.match(await page.getByTestId('crypto-operation-result').innerText(), /başarısız/), 'failed operation');
      console.log(`PASS ${legacy ? 'legacy root' : 'data envelope'} five POST paths, 202, malformed reply, terminal rejection/failure and reset archive confirmation`);

      state.mode = 'delayed';
      state.status = 'pending';
      await button('DEMO BEKLE / HOLD').click();
      await eventually(locked, 'in-flight POST is locked');
      await eventually(async () => assert.equal(delayedReplies.length, 1), 'POST reply held');
      await recheck();
      await locked();
      state.status = 'completed';
      await recheck();
      await eventually(async () => assert.equal(await page.getByTestId('crypto-pending-operation').count(), 0), 'lookup resolves before POST reply');
      state.mode = 'timeout';
      state.status = 'pending';
      await button('DEMO AL').click();
      await eventually(locked, 'next legitimate operation is pending');
      const nextId = writes.at(-1).body.clientRequestId;
      await delayedReplies.pop()();
      await locked();
      assert.equal(await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key)).clientRequestId, storageKey), nextId, 'late original reply cannot clear the next operation');
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: path.join(evidence, `${legacy ? 'legacy' : 'envelope'}-pending.png`), fullPage: true });
      assert.equal(await page.getByTestId('crypto-terminal').evaluate((el) => el.scrollWidth > el.clientWidth + 2), false);
      state.status = 'completed';
      await recheck();
      await eventually(async () => assert.equal(await page.getByTestId('crypto-pending-operation').count(), 0), 'next operation resolves');
      console.log(`PASS ${legacy ? 'legacy root' : 'data envelope'} recheck during POST and late response isolation`);

      state.mode = 'timeout';
      state.status = 'pending';
      state.lookupMode = 'missing';
      await page.getByLabel('Alım tutarı', { exact: true }).fill('1234');
      const beforeMissed = writes.length;
      await button('DEMO AL').click();
      await eventually(locked, 'missed request remains pending');
      const missed = writes.at(-1);
      await eventually(async () => assert.equal(await button('Aynı isteği yeniden gönder').isEnabled(), true), 'explicit 404 offers resubmission');
      await page.getByLabel('Alım tutarı', { exact: true }).fill('777');
      await page.getByLabel('Aktif parite', { exact: true }).selectOption('ETHUSDT');
      await page.reload();
      await eventually(async () => assert.equal(await button('Aynı isteği yeniden gönder').isEnabled(), true), 'resubmission survives reload');
      const saved = await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key)), storageKey);
      assert.deepEqual(saved.body, { symbol: 'BTCUSDT', quoteAmount: 1234, source: 'manual' });
      assert.equal(saved.action, 'buy');
      assert.equal(saved.clientRequestId, missed.body.clientRequestId);
      assert.equal(writes.length, beforeMissed + 1, '404, refresh and reload never automatically resend');
      state.mode = 'complete';
      state.lookupMode = 'valid';
      await button('Aynı isteği yeniden gönder').click();
      await eventually(async () => assert.equal(await page.getByTestId('crypto-pending-operation').count(), 0), 'explicit resend resolves');
      assert.equal(writes.length, beforeMissed + 2);
      assert.deepEqual(writes.at(-1), missed, 'resend uses exact original ID, payload and endpoint, not current inputs');

      state.mode = 'validation';
      state.lookupMode = 'missing';
      await button('DEMO AL').click();
      await eventually(async () => {
        assert.equal(await page.getByTestId('crypto-pending-operation').count(), 0);
        assert.match(await page.getByTestId('crypto-operation-result').innerText(), /invalid_request/);
      }, 'correlated input validation is terminal without an operation');
      state.mode = 'uncorrelated-validation';
      await button('DEMO AL').click();
      await eventually(locked, 'uncorrelated 400 cannot unlock the operation');
      const uncorrelated = writes.at(-1);
      await eventually(async () => assert.equal(await button('Aynı isteği yeniden gönder').isEnabled(), true), 'uncorrelated error requires explicit recovery');
      state.mode = 'complete';
      state.lookupMode = 'valid';
      await button('Aynı isteği yeniden gönder').click();
      await eventually(async () => assert.equal(await page.getByTestId('crypto-pending-operation').count(), 0), 'explicit recovery from unknown validation');
      assert.deepEqual(writes.at(-1), uncorrelated);
      console.log(`PASS ${legacy ? 'legacy root' : 'data envelope'} missed request, persisted original payload, explicit same-ID resend and correlated validation`);

      for (const mode of ['veto', 'veto-timeout']) {
        state.mode = mode;
        state.status = 'pending';
        await button('Run Jev Decision').click();
        await eventually(async () => {
          assert.equal(await page.getByTestId('crypto-pending-operation').count(), 0);
          const result = await page.getByTestId('crypto-operation-result').innerText();
          assert.match(result, /reddedildi/);
          assert.match(result, /risk_rejected/);
          assert.match(result, new RegExp(state.current));
          const decisionText = await page.locator('[data-panel="Jev Kararı"]').innerText();
          assert.match(decisionText, /Risk engeli: risk_rejected/);
          assert.match(decisionText, /fixture-veto/);
          assert.doesNotMatch(decisionText, /Karar demo portföyde uygulandı/);
          assert.equal(await button('Run Jev Decision').isEnabled(), true);
        }, `${mode} is a valid decision with terminal risk veto`);
      }
      console.log(`PASS ${legacy ? 'legacy root' : 'data envelope'} correlated ok:true risk veto resolves directly and after timeout`);

      state.stale = true;
      state.decision = { decisionId: 'jev_decision_linked', tradeId: 'demo_trade_linked', action: 'BUY', valid: true, source: 'jev', executed: true, timestamp: new Date().toISOString(), model: 'fixture', marketDataAgeMs: 31, inputMarketTimestamp: new Date().toISOString(), riskResult: { status: 'approved' } };
      state.trades = [{ tradeId: 'demo_trade_linked', decisionId: 'jev_decision_linked', clientRequestId: id, operationId: 'crypto_op_linked', source: 'jev', symbol: 'BTCUSDT', side: 'BUY', executedAt: new Date().toISOString(), executionPrice: 50000, executedQuantity: 0.01, requestedCredits: 500, fee: 0.5, status: 'executed' }];
      await button('Verileri yenile').click();
      await eventually(async () => {
        for (const name of ['DEMO AL', 'DEMO SAT', 'Run Jev Decision']) assert.equal(await button(name).isDisabled(), true);
        assert.match(await page.getByTestId('crypto-terminal').innerText(), /Eski fiyat/);
        assert.match(await page.locator('[data-panel="Jev Kararı"]').innerText(), /Karar demo portföyde uygulandı/);
        assert.match(await page.locator('[data-panel="Jev Kararı"]').innerText(), /demo_trade_linked/);
        assert.match(await page.locator('[data-panel="Jev Kararı"]').innerText(), /fixture-active/);
        assert.match(await page.locator('[data-panel="Jev Kararı"]').innerText(), /Karar modeli: fixture/);
        assert.equal(await page.locator('[data-trade-id="demo_trade_linked"]').count(), 1);
      }, 'freshness and decision-trade link');
      for (const width of [390, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.screenshot({ path: path.join(evidence, `${legacy ? 'legacy' : 'envelope'}-${width}.png`), fullPage: true });
        const overflow = await page.getByTestId('crypto-terminal').evaluate((el) => el.scrollWidth > el.clientWidth + 2);
        assert.equal(overflow, false, `${width}px terminal overflow`);
        const painted = await page.locator('canvas').evaluateAll((nodes) => nodes.some((canvas) => {
          if (canvas.width < 100 || canvas.height < 100) return false;
          const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
          let colorful = 0;
          for (let i = 0; i < pixels.length; i += 40) if (pixels[i + 3] > 100 && Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) - Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) > 45) colorful++;
          return colorful > 30;
        }));
        assert.equal(painted, true, `${width}px chart is painted`);
      }
      const beforeStorageError = writes.length;
      await page.evaluate((key) => {
        const setItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function (name, value) {
          if (name === key) throw new DOMException('Fixture quota failure', 'QuotaExceededError');
          return setItem.call(this, name, value);
        };
      }, storageKey);
      await button('DEMO BEKLE / HOLD').click();
      await eventually(async () => assert.match(await page.getByTestId('crypto-terminal').innerText(), /İstek gönderilmedi/), 'storage failure blocks before POST');
      assert.equal(writes.length, beforeStorageError);
      await page.reload();
      await page.evaluate((key) => sessionStorage.setItem(key, '{malformed'), storageKey);
      await page.reload();
      await eventually(async () => {
        assert.match(await page.getByTestId('crypto-terminal').innerText(), /Bekleyen işlem kaydı okunamadı/);
        for (const name of buttons) assert.equal(await button(name).isDisabled(), true);
      }, 'corrupt saved state fails closed');
      assert.equal(writes.length, beforeStorageError);
      assert.deepEqual(errors, []);
      await context.close();
      console.log(`PASS ${legacy ? 'legacy root' : 'data envelope'} stale lock, IDs, Jev trade link, storage failures and mobile/desktop rendering`);
    }
    assert.deepEqual(escapedNetwork, [], 'no API traffic escapes the fixture context');
    console.log(`Screenshots: ${evidence}`);
  } finally {
    await browser.close();
    await vite.close();
    await close(server);
  }
}

await proxyTests();
await browserTests();
console.log('PASS crypto frontend and Express recovery checks; no real account writes');
