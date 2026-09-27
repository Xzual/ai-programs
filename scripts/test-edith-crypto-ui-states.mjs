import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

// TEST ONLY: synthetic API data is fulfilled inside isolated browser contexts.
// No fixture is installed in the app/server and no write request reaches the network.
const baseUrl = process.env.EDITH_UI_URL || 'http://127.0.0.1:3000';
const outputDir = path.resolve('artifacts', 'crypto-terminal', 'fixture-states');
const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT'];
const safetyLabels = ['DEMO ONLY', 'NO REAL MONEY', 'NO REAL ORDERS', 'SIMULATION ONLY', 'LIVE TRADING DISABLED'];
const btcPrice = 98123.45;
const ethPrice = 2042.75;
fs.mkdirSync(outputDir, { recursive: true });

async function eventually(check, description, timeout = 10000) {
  const deadline = Date.now() + timeout;
  let lastError;
  do {
    try { await check(); return; } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 75));
  } while (Date.now() < deadline);
  throw new Error(`${description}: ${lastError?.message}`);
}

function fixtures(url, state) {
  const now = new Date().toISOString();
  const symbol = url.searchParams.get('symbol') || 'BTCUSDT';
  const last = symbol === 'BTCUSDT' ? btcPrice : symbol === 'ETHUSDT' ? ethPrice : 123.45;
  const start = Math.floor(Date.now() / 60000) * 60 - 60 * 30;
  const market = {
    testOnly: true, symbol, timeframe: url.searchParams.get('timeframe') || '1m',
    status: 'online', fresh: true, realData: true, updatedAt: now,
    ticker: { last, change24h: 1.25, high24h: last + 50, low24h: last - 50, volume24h: 321, spreadPct: 0.01 },
    candles: Array.from({ length: 30 }, (_, index) => ({
      time: start + index * 60, open: last - 10 + index % 3, high: last + 12,
      low: last - 12, close: last + index % 5, volume: 10 + index,
    })),
    orderBook: { asks: [{ price: last + 1, amount: 2 }], bids: [{ price: last - 1, amount: 3 }] },
  };
  const portfolio = {
    initialBalance: 10000, currentEquity: 12345.67, currentCash: 11000,
    unrealizedPnl: 45.67, realizedPnl: 2300, totalPnl: 2345.67,
    currentExposurePct: 10, numberOfTrades: 4, winRate: 75, maxDrawdown: 2,
    feeRate: 0.001, updatedAt: now,
    openPositions: [{ symbol: 'BTCUSDT', entryPrice: 98000, markPrice: btcPrice, amount: 0.01, unrealizedPnl: 45.67, source: 'TEST_ONLY_FIXTURE' }],
  };
  if (state.missing) {
    const missing = state.missing === 'null' ? null : state.missing === 'empty' ? '' : undefined;
    for (const key of Object.keys(market.ticker)) market.ticker[key] = missing;
    for (const key of Object.keys(portfolio)) {
      if (!['initialBalance', 'updatedAt', 'openPositions'].includes(key)) portfolio[key] = missing;
    }
    portfolio.openPositions = [];
    market.candles = [];
    market.orderBook = { asks: [], bids: [] };
  }
  const responses = {
    '/api/crypto/status': { running: true, demoMode: true, demoTradingEnabled: true, liveExecutionEnabled: false, realMoneyUsed: false },
    '/api/crypto/symbols': { symbols: symbols.map((symbol) => ({ symbol, mode: 'DEMO_TRADE_ALLOWED' })) },
    '/api/crypto/market': market,
    '/api/crypto/portfolio': { portfolio },
    '/api/crypto/trades': { trades: [] },
    '/api/crypto/decision/latest': { decision: state.decision },
    '/api/crypto/jev/status': { configured: true, available: true, status: 'ready', model: 'TEST_ONLY_FIXTURE_MODEL', secretExposed: false },
    '/api/crypto/jev/loop': state.malformedLoop ? {} : { state: 'STOPPED', running: false, symbolCount: 8, minimumIntervalSeconds: 10, cycles: 0, decisionCount: 0, elapsedSeconds: 0 },
    '/api/edith/crypto/status': { success: true, status: { healthy: !state.offline, managedProcessRunning: !state.offline } },
  };
  if (state.offline || (state.marketFailure && url.pathname === '/api/crypto/market') || (state.decisionFailure && url.pathname === '/api/crypto/decision/latest')) {
    return { status: 503, json: { error: 'TEST_ONLY_FIXTURE_UNAVAILABLE', testOnly: true } };
  }
  if (!(url.pathname in responses)) return null;
  return { status: 200, json: { ...responses[url.pathname], testOnly: true } };
}

const button = (terminal, name) => terminal.getByRole('button', { name, exact: true });
const panel = (terminal, name) => terminal.locator('section').filter({ has: terminal.page().getByRole('heading', { name, exact: true }) });
const metric = (scope, label) => scope.getByText(label, { exact: true }).locator('..').locator(':scope > div').last();
const header = (terminal) => terminal.locator('header').first();
const badge = (terminal) => panel(terminal, 'Jev Kararı').locator('.crypto-terminal-decision-badge');

async function disabled(terminal, names, expected = true) {
  for (const name of names) {
    const control = button(terminal, name);
    assert.equal(await control.count(), 1, `${name} must remain present`);
    assert.equal(await control.isVisible(), true, `${name} must remain visible`);
    assert.equal(await control.isDisabled(), expected, `${name} disabled state`);
  }
}

async function safety(terminal) {
  for (const label of safetyLabels) assert.equal(await terminal.getByText(label, { exact: true }).first().isVisible(), true, label);
}

async function refresh(terminal) {
  const control = button(terminal, 'Verileri yenile');
  await eventually(async () => assert.equal(await control.isEnabled(), true), 'refresh ready');
  await control.click();
  await eventually(async () => assert.equal(await control.isEnabled(), true), 'refresh completed');
}

async function healthy(terminal) {
  await eventually(async () => {
    assert.equal(await metric(header(terminal), 'Demo Equity').innerText(), '12.345,67 CR');
    await disabled(terminal, ['DEMO AL', 'DEMO SAT', 'DEMO BEKLE / HOLD', 'Run Jev Decision', 'Demo Hesabı Sıfırla'], false);
    assert.match(await header(terminal).innerText(), /BINANCE online/i);
  }, 'healthy fixture prerequisite');
}

const cases = [
  { name: 'whole-offline', run: async ({ state, terminal }) => {
    state.offline = true;
    await refresh(terminal);
    await eventually(async () => {
      assert.equal(await terminal.getByText('Crypto servisi çevrimdışı', { exact: true }).isVisible(), true);
      await safety(terminal);
      await disabled(terminal, ['DEMO AL', 'DEMO SAT', 'DEMO BEKLE / HOLD', 'Run Jev Decision', "Jev'i Çalıştır", 'Demo Hesabı Sıfırla']);
      assert.doesNotMatch(await header(terminal).innerText(), /BINANCE online/i);
      assert.equal(await metric(header(terminal), 'Demo Equity').innerText(), '-');
      assert.equal(await terminal.locator('canvas').count(), 0);
    }, 'offline clears stale data and locks trades');
    return panel(terminal, 'Demo Emir');
  } },
  { name: 'market-only-failure', run: async ({ state, terminal }) => {
    state.marketFailure = true;
    await refresh(terminal);
    await eventually(async () => {
      assert.match(await terminal.locator('[role="status"]').innerText(), /Veri alınamadı: Binance/);
      assert.equal(await metric(header(terminal), 'Demo Equity').innerText(), '12.345,67 CR');
      assert.equal(await panel(terminal, 'Demo Portföy').locator('.crypto-terminal-portfolio-value').innerText(), '12.345,67 CR');
      assert.equal(await terminal.getByText('Crypto servisi çevrimdışı', { exact: true }).count(), 0);
      assert.doesNotMatch(await header(terminal).innerText(), /BINANCE online/i);
      assert.equal(await metric(header(terminal), 'Son Fiyat').innerText(), '-');
      assert.equal(await terminal.locator('canvas').count(), 0);
      await disabled(terminal, ['DEMO AL', 'DEMO SAT', 'Run Jev Decision']);
    }, 'market failure is isolated from portfolio');
    return panel(terminal, 'Demo Portföy');
  } },
  { name: 'malformed-loop', run: async ({ state, terminal }) => {
    state.malformedLoop = true;
    await refresh(terminal);
    await eventually(async () => {
      assert.match(await terminal.locator('[role="status"]').innerText(), /Jev döngüsü/);
      assert.equal(await panel(terminal, 'Jev Kararı').getByText('UNKNOWN', { exact: true }).isVisible(), true);
      await disabled(terminal, ['Demo Hesabı Sıfırla', 'Run Jev Decision', "Jev'i Çalıştır"]);
      await disabled(terminal, ['Durdur'], false);
    }, 'unknown loop fails closed while Stop remains available');
    return panel(terminal, 'Jev Kararı');
  } },
  { name: 'reversed-market-responses', run: async ({ state, terminal, page, pending, audit }) => {
    await eventually(async () => assert.equal(new Set(audit.fixtures.filter((entry) => entry.pathname === '/api/crypto/market').map((entry) => entry.symbol)).size, 8), 'watchlist fixtures settled');
    state.holdBtc = true;
    await button(terminal, 'Verileri yenile').click();
    await eventually(async () => assert.ok(pending.length > 0), 'BTC response is held');
    await terminal.getByRole('combobox', { name: 'Aktif parite', exact: true }).selectOption('ETHUSDT');
    const assertEth = async () => {
      assert.equal(await metric(header(terminal), 'Aktif Parite').innerText(), 'ETHUSDT');
      assert.equal(await metric(header(terminal), 'Son Fiyat').innerText(), '2,042.75');
      assert.equal(await terminal.locator('main .crypto-terminal-tick-price').first().innerText(), '2,042.75');
      assert.equal(await terminal.getByLabel('ETHUSDT 1m mum grafiği', { exact: true }).count(), 1);
      assert.doesNotMatch(await terminal.locator('main').innerText(), /98,123\.45/);
    };
    await eventually(assertEth, 'ETH renders before old BTC is delivered');
    await page.evaluate(() => {
      window.__cryptoFixtureWrongMarket = [];
      const root = document.querySelector('[data-testid="crypto-terminal"]');
      window.__cryptoFixtureObserver = new MutationObserver(() => {
        const selected = root.querySelector('select[aria-label="Aktif parite"]')?.value;
        const price = root.querySelector('main .crypto-terminal-tick-price')?.textContent;
        if (selected === 'ETHUSDT' && price?.includes('98,123.45')) window.__cryptoFixtureWrongMarket.push(price);
      });
      window.__cryptoFixtureObserver.observe(root, { subtree: true, childList: true, characterData: true });
    });
    state.holdBtc = false;
    for (const response of pending.splice(0)) await response.release();
    // Observe beyond the numeric animation duration after explicitly releasing the stale response.
    await page.waitForTimeout(700);
    await assertEth();
    assert.deepEqual(await page.evaluate(() => window.__cryptoFixtureWrongMarket), []);
    await page.evaluate(() => window.__cryptoFixtureObserver.disconnect());
    assert.ok(audit.fixtures.findIndex((entry) => entry.symbol === 'ETHUSDT' && entry.selectedAfterHold) < audit.fixtures.findIndex((entry) => entry.releasedLate), 'ETH must complete before delayed BTC');
    return terminal.locator('main');
  } },
  ...['null', 'omitted', 'empty'].map((missing) => ({ name: `missing-numbers-${missing}`, run: async ({ state, terminal }) => {
    state.missing = missing;
    await refresh(terminal);
    await eventually(async () => {
      const mismatches = [];
      const expectDash = async (locator, label) => {
        const actual = await locator.innerText();
        if (actual !== '-') mismatches.push({ label, expected: '-', actual });
      };
      for (const label of ['Son Fiyat', '24s Değişim', 'Demo Equity', 'Kullanılabilir', 'Açık K/Z', 'Gerçekleşen K/Z', 'Exposure']) {
        await expectDash(metric(header(terminal), label), `header ${label}`);
      }
      for (const label of ['24s En Yüksek', '24s En Düşük', '24s Hacim', 'Spread']) await expectDash(metric(terminal.locator('main'), label), label);
      const portfolio = panel(terminal, 'Demo Portföy');
      for (const label of ['Nakit', 'Toplam K/Z', 'Exposure', 'Demo işlem sayısı', 'Kazanma oranı', 'Maksimum düşüş']) await expectDash(metric(portfolio, label), `portfolio ${label}`);
      await expectDash(portfolio.locator('.crypto-terminal-portfolio-value'), 'portfolio equity');
      assert.deepEqual(mismatches, []);
    }, 'missing numbers remain unavailable, never fabricated zeroes');
    return panel(terminal, 'Demo Portföy');
  } })),
  ...['BUY', 'SELL', 'HOLD', 'ERROR'].map((action) => ({ name: `decision-${action.toLowerCase()}`, run: async ({ state, terminal }) => {
    state.decision = {
      id: `TEST_ONLY_${action}`, symbol: 'BTCUSDT', decision: action, source: 'TEST_ONLY_FIXTURE',
      timestamp: new Date().toISOString(), confidence: 0.8, latency_ms: 17,
      valid: action !== 'ERROR', trade_executed: false,
      risk_status: action === 'ERROR' ? 'VETOED' : 'PASSED',
      ...(action === 'ERROR' ? { execution_error: 'TEST_ONLY_INVALID_OUTPUT' } : {}),
    };
    await refresh(terminal);
    await eventually(async () => {
      assert.equal(await badge(terminal).innerText(), action === 'ERROR' ? '-' : action);
      assert.equal(await badge(terminal).getAttribute('data-decision'), action === 'ERROR' ? null : action);
      const text = await panel(terminal, 'Jev Kararı').innerText();
      assert.match(text, /TEST_ONLY_FIXTURE/);
      if (action === 'HOLD') assert.match(text, /Geçerli bekleme kararı/);
      if (action === 'ERROR') assert.match(text, /INVALID OUTPUT/);
      assert.doesNotMatch(text, /Karar demo portföyde uygulandı/);
      assert.equal(await panel(terminal, 'Demo İşlem Geçmişi').locator('tbody tr').count(), 0);
    }, `${action} fixture badge and execution status`);
    return panel(terminal, 'Jev Kararı');
  } })),
  { name: 'decision-feed-error', run: async ({ state, terminal }) => {
    state.decision = { id: 'TEST_ONLY_PREVIOUS_BUY', decision: 'BUY', symbol: 'BTCUSDT' };
    await refresh(terminal);
    await eventually(async () => assert.equal(await badge(terminal).innerText(), 'BUY'), 'previous BUY fixture loaded');
    state.decisionFailure = true;
    await refresh(terminal);
    await eventually(async () => {
      assert.equal(await badge(terminal).innerText(), '-');
      assert.equal(await badge(terminal).getAttribute('data-decision'), null);
      assert.match(await terminal.locator('[role="status"]').innerText(), /Karar/);
    }, 'decision feed failure clears stale BUY');
    return panel(terminal, 'Jev Kararı');
  } },
];

const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const test of cases) {
    const state = { decision: null };
    const audit = { fixtures: [], blockedWrites: [], unknownCryptoRoutes: [], forwarded: [], pageErrors: [], consoleErrors: [] };
    const pending = [];
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
    // A mock socket remains local; closing it during Vite's handshake raises a harness error.
    await context.routeWebSocket('**/*', () => {});
    await context.route('**/*', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (!['GET', 'HEAD'].includes(request.method())) {
        audit.blockedWrites.push({ method: request.method(), pathname: url.pathname });
        await route.fulfill({ status: 405, json: { error: 'TEST_ONLY_WRITES_BLOCKED' } });
        return;
      }
      if (/^\/api\/(?:edith\/)?crypto(?:\/|$)/.test(url.pathname)) {
        const response = fixtures(url, state);
        if (!response) audit.unknownCryptoRoutes.push(url.pathname);
        const entry = { pathname: url.pathname, symbol: url.searchParams.get('symbol'), status: response?.status ?? 501 };
        const fulfill = async () => {
          await route.fulfill({ ...(response || { status: 501, json: { error: 'TEST_ONLY_UNMAPPED_ENDPOINT' } }), headers: { 'x-crypto-qa-fixture': test.name } });
          audit.fixtures.push(entry);
        };
        if (state.holdBtc && url.pathname === '/api/crypto/market' && entry.symbol === 'BTCUSDT') {
          await new Promise((resolve) => pending.push({
            release: async () => { try { entry.releasedLate = true; await fulfill(); } finally { resolve(); } },
            abort: async () => { try { await route.abort(); } finally { resolve(); } },
          }));
        } else {
          if (state.holdBtc && entry.symbol === 'ETHUSDT') entry.selectedAfterHold = true;
          await fulfill();
        }
        return;
      }
      if (url.origin !== new URL(baseUrl).origin) { await route.abort(); return; }
      audit.forwarded.push({ method: request.method(), pathname: url.pathname });
      await route.continue();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    page.on('pageerror', (error) => audit.pageErrors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') audit.consoleErrors.push(message.text()); });
    const result = { name: test.name, testOnlyFixtures: true, passed: false, audit };
    results.push(result);
    try {
      await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
      const navigation = page.getByRole('button', { name: /^(Crypto Demo|Alım Satım|Crypto)$/ });
      const login = page.getByPlaceholder('Can İpkin veya Arda Yorulmazel');
      await eventually(async () => assert.ok(await navigation.isVisible() || await login.isVisible()), 'app navigation or login');
      if (await login.isVisible()) { await login.fill('Arda Yorulmazel'); await login.press('Enter'); }
      await navigation.click();
      const terminal = page.getByTestId('crypto-terminal');
      await terminal.waitFor({ state: 'visible' });
      await page.evaluate((name) => {
        const marker = document.createElement('div');
        marker.textContent = `TEST FIXTURES ONLY | ${name} | NO LIVE WRITES`;
        marker.style.cssText = 'position:fixed;bottom:0;right:0;z-index:2147483647;background:#fbbf24;color:#111;padding:6px 10px;font:12px monospace;pointer-events:none';
        document.body.append(marker);
      }, test.name);
      await healthy(terminal);
      await safety(terminal);
      const focus = await test.run({ state, terminal, page, pending, audit });
      result.reducedMotion = await terminal.evaluate((element) => ({
        requested: matchMedia('(prefers-reduced-motion: reduce)').matches,
        activeAnimations: element.getAnimations({ subtree: true }).filter((animation) => animation.playState === 'running').length,
      }));
      assert.deepEqual(result.reducedMotion, { requested: true, activeAnimations: 0 }, 'reduced motion suppresses terminal animations');
      await header(terminal).scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(outputDir, `${test.name}.png`), fullPage: true });
      await focus.scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(outputDir, `${test.name}-detail.png`), fullPage: true });
      assert.deepEqual(audit.pageErrors, [], 'no uncaught page errors');
      assert.deepEqual(audit.unknownCryptoRoutes, [], 'all crypto reads must have explicit fixtures');
      assert.deepEqual(audit.blockedWrites, [], 'tests must not attempt writes');
      assert.ok(audit.forwarded.every((request) => ['GET', 'HEAD'].includes(request.method) && !/^\/api\/(?:edith\/)?crypto(?:\/|$)/.test(request.pathname)));
      result.passed = true;
      console.log(`PASS ${test.name}`);
    } catch (error) {
      result.error = error.message;
      console.error(`FAIL ${test.name}: ${error.message}`);
      await page.screenshot({ path: path.join(outputDir, `${test.name}-failure.png`), fullPage: true }).catch(() => undefined);
    } finally {
      for (const response of pending.splice(0)) await response.abort().catch(() => undefined);
      await context.close();
    }
  }
} finally {
  await browser.close();
  fs.writeFileSync(path.join(outputDir, 'results.json'), JSON.stringify({ testOnlyFixtures: true, results }, null, 2));
}
const failed = results.filter((result) => !result.passed);
console.log(`${results.length - failed.length}/${results.length} fixture cases passed. Evidence: ${outputDir}`);
if (failed.length) process.exitCode = 1;
