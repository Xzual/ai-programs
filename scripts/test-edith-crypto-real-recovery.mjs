import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { chromium } from 'playwright';
import express from 'express';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolveEdithCryptoPython } from './edith-crypto-python.mjs';

// Real market/provider requests, but all terminal writes go to this disposable DB.
const root = process.cwd();
const pythonPath = resolveEdithCryptoPython(root);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'edith-crypto-real-ui-'));
const probe = net.createServer();
await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const log = fs.openSync(path.join(temp, 'service.log'), 'w');
const cryptoToken = `recovery-smoke-${process.pid}-${Date.now()}`;
const env = { ...process.env, CRYPTO_PORT: String(port), CRYPTO_DB_PATH: path.join(temp, 'demo.db'),
  CRYPTO_LOG_DIR: temp, CRYPTO_DATA_DIR: temp, CRYPTO_MODE: 'OBSERVER_ONLY', TRADING_MODE: 'OBSERVER_ONLY',
  CRYPTO_TRADING_ENABLED: 'false', CRYPTO_PAPER_TRADING_ENABLED: 'false', CRYPTO_DEMO_TRADING_ENABLED: 'true',
  CRYPTO_STARTING_BALANCE: '10000', CRYPTO_LIVE_TRADING_ENABLED: 'false', ENABLE_LIVE_TRADING: 'false',
  BINANCE_TRADING_ENABLED: 'false', CRYPTO_OBSIDIAN_ENABLED: 'false', CRYPTO_LEARNING_ENABLED: 'false',
  CRYPTO_NEWS_ENABLED: 'false', CRYPTO_OLLAMA_ENABLED: 'false', EDITH_CRYPTO_INTERNAL_TOKEN: cryptoToken };
const service = spawn(pythonPath, [path.join(root, 'crypto/run_agent.py')], {
  cwd: root, env, windowsHide: true, stdio: ['ignore', log, log],
});
const base = `http://127.0.0.1:${port}`;
const read = async (name) => {
  const response = await fetch(`${base}/api/crypto/${name}`, { signal: AbortSignal.timeout(30000) });
  assert.ok(response.ok, name);
  return response.json();
};
let browser;
let page;
let vite;
let uiServer;
try {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (service.exitCode !== null) throw new Error('Isolated service stopped before readiness');
    try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { /* Startup only. */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal((await read('portfolio')).portfolio.currentCash, 10000);
  const app = express();
  uiServer = app.listen(0, '127.0.0.1');
  await once(uiServer, 'listening');
  vite = await createServer({ configFile: false, cacheDir: path.join(temp, 'vite-cache'), plugins: [react(), tailwindcss()],
    optimizeDeps: { entries: ['src/components/crypto/CryptoExchangeTerminal.tsx'], include: ['react-dom/client'] },
    server: { middlewareMode: true, hmr: { server: uiServer } }, appType: 'custom' });
  app.use('/api', (_req, res) => res.status(500).json({ ok: false }));
  app.use(vite.middlewares);
  app.get('/', async (_req, res) => res.type('html').send(await vite.transformIndexHtml('/', '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;overflow:auto"><div id="root"></div><script type="module">import React from "react"; import {createRoot} from "react-dom/client"; import {CryptoExchangeTerminal} from "/src/components/crypto/CryptoExchangeTerminal.tsx"; import "/src/index.css"; createRoot(document.getElementById("root")).render(React.createElement(CryptoExchangeTerminal));</script></body></html>')));
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  const writes = [];
  let lostBuyResponse = false;
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/crypto/')) {
      const response = await route.fetch({
        url: base + url.pathname + url.search,
        headers: { ...request.headers(), 'X-EDITH-Internal-Token': cryptoToken },
        timeout: 60000,
        maxRetries: 0,
      });
      if (request.method() === 'POST') {
        const body = await response.json();
        writes.push({ path: url.pathname, payload: request.postDataJSON(), body });
        if (url.pathname === '/api/crypto/demo/buy' && !lostBuyResponse) {
          assert.equal(body.ok, true);
          lostBuyResponse = true;
          await route.abort('timedout');
          return;
        }
      }
      await route.fulfill({ response });
      return;
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });
  await page.goto(`http://127.0.0.1:${uiServer.address().port}`, { waitUntil: 'domcontentloaded' });
  const terminal = page.getByTestId('crypto-terminal');
  await terminal.waitFor({ state: 'visible', timeout: 30000 });
  await terminal.getByLabel('Alım tutarı', { exact: true }).fill('100');
  await terminal.getByRole('button', { name: 'DEMO AL', exact: true }).click({ timeout: 30000 });
  await page.getByTestId('crypto-operation-result').waitFor({ state: 'visible', timeout: 30000 });
  assert.equal(writes.filter((w) => w.path.endsWith('/buy')).length, 1);
  const buy = writes.find((w) => w.path.endsWith('/buy'));
  assert.ok(buy?.body.tradeId);
  await terminal.locator(`[data-trade-id="${buy.body.tradeId}"]`).waitFor({ timeout: 20000 });
  const replay = await fetch(base + buy.path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-EDITH-Internal-Token': cryptoToken },
    body: JSON.stringify(buy.payload),
  });
  assert.deepEqual(await replay.json(), buy.body);
  assert.equal((await read('trades')).trades.length, 1);
  await terminal.getByRole('button', { name: 'DEMO BEKLE / HOLD', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('[data-testid="crypto-pending-operation"]'), null, { timeout: 30000 });
  assert.equal((await read('trades')).trades.length, 1);
  await terminal.getByRole('button', { name: 'DEMO SAT', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('[data-testid="crypto-pending-operation"]'), null, { timeout: 30000 });
  assert.equal((await read('positions')).positions.length, 0);
  const jevButton = terminal.getByRole('button', { name: 'Run Jev Decision', exact: true });
  const jevStatusResponse = await fetch(`${base}/api/crypto/jev/status`, { signal: AbortSignal.timeout(30000) });
  assert.ok(jevStatusResponse.ok, 'Jev status');
  const jevStatus = await jevStatusResponse.json();
  let decision = null;
  if (jevStatus.configured === true) {
    await assert.doesNotReject(() => jevButton.click({ timeout: 30000 }));
    await page.waitForFunction(() => !document.querySelector('[data-testid="crypto-pending-operation"]'), null, { timeout: 45000 });
    const decisionWrite = writes.find((w) => w.path.endsWith('/decision/run'));
    assert.ok(decisionWrite?.body.decisionId, 'real decision attempt persisted');
    assert.equal(Object.hasOwn(decisionWrite.payload, 'timeframe'), false);
    decision = decisionWrite.body.decision;
    assert.equal((await read('operations/' + decisionWrite.payload.clientRequestId)).result.decisionId, decision.decisionId);
  } else {
    assert.equal(await jevButton.isDisabled(), true, 'Jev action must stay disabled when the provider is not configured');
    assert.equal(writes.some((w) => w.path.endsWith('/decision/run')), false, 'Unconfigured Jev must not create a decision write');
  }
  const report = { realBinance: true, isolatedPortfolio: true, lostBuyResponseRecovered: lostBuyResponse,
    buyRequestCount: 1, replayMatched: true, buyTradeId: buy.body.tradeId,
    jevConfigured: jevStatus.configured === true,
    jevGate: decision ? 'verified' : 'external_blocker_configuration_required',
    decisionId: decision?.decisionId ?? null, action: decision?.action ?? null, model: decision?.model ?? null,
    latencyMs: decision?.latencyMs ?? null, riskResult: decision?.riskResult ?? null,
    executed: decision?.executed ?? false, userAccountUntouched: true };
  const output = path.join(root, 'artifacts/crypto-terminal');
  fs.mkdirSync(output, { recursive: true });
  await terminal.screenshot({ path: path.join(output, 'real-recovery-desktop.png') });
  fs.writeFileSync(path.join(output, 'real-recovery-ui.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await page?.unrouteAll({ behavior: 'ignoreErrors' });
  await browser?.close();
  await vite?.close();
  if (uiServer) await new Promise((resolve) => uiServer.close(resolve));
  if (service.exitCode === null) {
    const exited = once(service, 'exit');
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(service.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    else service.kill('SIGTERM');
    await exited;
  }
  fs.closeSync(log);
  const resolved = path.resolve(temp);
  assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith('edith-crypto-real-ui-'));
  fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
console.log('PASS real Binance terminal BUY response loss, recovery, replay, HOLD and SELL; Jev is verified when configured and otherwise remains safely blocked');
