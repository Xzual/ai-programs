import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import 'dotenv/config';

const baseUrl = process.env.EDITH_UI_URL || 'http://127.0.0.1:3000';
const outputDir = path.resolve('artifacts', 'crypto-terminal');
fs.mkdirSync(outputDir, { recursive: true });

async function ensureCryptoService() {
  const statusResponse = await fetch(`${baseUrl}/api/edith/crypto/status`);
  const statusBody = await statusResponse.json();
  if (statusResponse.ok && statusBody.status?.healthy) return;
  throw new Error(`Crypto service must already be running; QA will not start it: ${statusBody.error || statusBody.status?.error || statusResponse.status}`);
}

async function openCryptoTerminal(page, viewportName) {
  const terminal = page.getByTestId('crypto-terminal');
  if (await terminal.isVisible().catch(() => false)) return terminal;
  const tradingButton = page.getByRole('button', { name: /^(Crypto Demo|Alım Satım|Crypto)$/ });
  try {
    await tradingButton.waitFor({ state: 'visible', timeout: 15000 });
  } catch {
    const body = (await page.locator('body').innerText()).slice(0, 1200);
    throw new Error(`${viewportName}: Crypto Demo navigation missing. Visible page: ${body}`);
  }
  await tradingButton.click();
  await terminal.waitFor({ state: 'visible', timeout: 30000 });
  return terminal;
}

async function waitForTerminalText(terminal, expectedText, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const visibleText = await terminal.innerText().catch(() => '');
    if (visibleText.toLocaleUpperCase('tr-TR').includes(expectedText)) return visibleText;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Terminal status text did not appear: ${expectedText}`);
}

async function checkControls(terminal) {
  const controls = terminal.locator('button, input:not([type="hidden"]), select, textarea, a[href], [role="button"]');
  const failures = [];
  let checked = 0;
  for (let index = 0; index < await controls.count(); index++) {
    const control = controls.nth(index);
    if (!await control.isVisible()) continue;
    // Below-the-fold controls are valid when scrolling can reveal them fully.
    await control.scrollIntoViewIfNeeded();
    const result = await control.evaluate((element) => {
      const tolerance = 2;
      const rect = element.getBoundingClientRect();
      const label = element.getAttribute('aria-label') || element.getAttribute('title') || element.textContent?.trim() || element.id || element.tagName;
      const problems = [];
      const outsideX = (box, left, right) => box.left < left - tolerance || box.right > right + tolerance;
      const outsideY = (box, top, bottom) => box.top < top - tolerance || box.bottom > bottom + tolerance;
      if (outsideX(rect, 0, innerWidth) || outsideY(rect, 0, innerHeight)) problems.push('outside viewport after scrolling');
      for (let ancestor = element.parentElement; ancestor && ancestor !== document.body && ancestor !== document.documentElement; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor);
        const bounds = ancestor.getBoundingClientRect();
        const left = bounds.left + ancestor.clientLeft;
        const top = bounds.top + ancestor.clientTop;
        if (/(auto|scroll|hidden|clip)/.test(style.overflowX) && outsideX(rect, left, left + ancestor.clientWidth)) {
          problems.push(`horizontal clipping by ${ancestor.tagName}.${ancestor.classList[0] || ''}`);
        }
        if (/(auto|scroll|hidden|clip)/.test(style.overflowY) && outsideY(rect, top, top + ancestor.clientHeight)) {
          problems.push(`vertical clipping by ${ancestor.tagName}.${ancestor.classList[0] || ''}`);
        }
      }
      // Native form controls manage their own text; inspect rendered button/link labels.
      if (!element.matches('input, select, textarea')) {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const node = walker.currentNode;
          if (!node.textContent.trim() || node.parentElement?.closest('.sr-only, [aria-hidden="true"]')) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          for (const textRect of range.getClientRects()) {
            if (textRect.width && textRect.height && (outsideX(textRect, rect.left, rect.right) || outsideY(textRect, rect.top, rect.bottom))) {
              problems.push('label extends outside control');
            }
          }
        }
        if (element.scrollWidth > element.clientWidth + tolerance || element.scrollHeight > element.clientHeight + tolerance) {
          problems.push('control content overflows');
        }
      }
      return { label: label.slice(0, 100), problems: [...new Set(problems)] };
    });
    checked++;
    if (result.problems.length) failures.push(result);
  }
  if (!checked) throw new Error('No visible terminal controls found');
  return { checked, failures };
}

async function checkCanvas(terminal) {
  // Lightweight Charts uses separate plot, axis, and transparent overlay canvases.
  return terminal.locator('canvas').evaluateAll((canvases) => canvases.map((canvas) => {
    const bounds = canvas.getBoundingClientRect();
    if (bounds.width < 100 || bounds.height < 100 || !canvas.width || !canvas.height) return null;
    const context = canvas.getContext('2d');
    if (!context) return null;
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    const colors = new Set();
    let opaque = 0;
    let colored = 0;
    let samples = 0;
    const stride = Math.max(1, Math.floor(Math.sqrt(canvas.width * canvas.height / 100000)));
    for (let y = 0; y < canvas.height; y += stride) {
      for (let x = 0; x < canvas.width; x += stride) {
        const offset = (y * canvas.width + x) * 4;
        const [red, green, blue, alpha] = data.subarray(offset, offset + 4);
        samples++;
        if (alpha < 128) continue;
        opaque++;
        colors.add(`${red >> 3},${green >> 3},${blue >> 3}`);
        if (Math.max(red, green, blue) - Math.min(red, green, blue) > 35 && Math.max(red, green, blue) > 80) colored++;
      }
    }
    return { width: bounds.width, height: bounds.height, colors: colors.size, opaque, colored, samples,
      nonblank: opaque > samples * 0.05 && colors.size >= 8 && colored >= 24 };
  }).filter(Boolean));
}

await ensureCryptoService();
let browser;
let page;
let currentViewport = 'startup';
const browserErrors = [];
const consoleErrors = [];
const httpResponses = [];
const expectedOwnerProbes = [];
const expectedAdvancedOwnerProbes = [];
const blockedWrites = [];
const viewportResults = [];
try {
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  page.on('pageerror', (error) => browserErrors.push({ viewport: currentViewport, type: 'pageerror', message: error.message }));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push({ viewport: currentViewport, type: 'console.error', message: message.text(), url: message.location().url || '' });
  });
  page.on('response', (response) => {
    if (response.status() < 400) return;
    const request = response.request();
    const url = new URL(response.url());
    const entry = { viewport: currentViewport, type: 'http', method: request.method(), status: response.status(), pathname: url.pathname, url: response.url() };
    httpResponses.push(entry);
    if (entry.method === 'GET' && entry.status === 401 && entry.pathname === '/api/security/session') {
      expectedOwnerProbes.push(entry);
      return;
    }
    if (entry.method === 'GET' && entry.status === 401 && entry.pathname === '/api/edith/advanced/state') {
      expectedAdvancedOwnerProbes.push(entry);
      return;
    }
    browserErrors.push(entry);
  });
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (/^\/api\/(?:edith\/)?crypto(?:\/|$)/.test(pathname) && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      blockedWrites.push({ viewport: currentViewport, method: request.method(), pathname });
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });
  for (const viewport of [
    { name: '390', width: 390, height: 844 },
    { name: '768', width: 768, height: 1024 },
    { name: '1366', width: 1366, height: 768 },
    { name: '1440', width: 1440, height: 900 },
    { name: '1920', width: 1920, height: 1080 },
    { name: '2560', width: 2560, height: 1440 },
  ]) {
    currentViewport = viewport.name;
    const result = { viewport: viewport.name, width: viewport.width, height: viewport.height };
    viewportResults.push(result);
    try {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto(baseUrl, { waitUntil: 'commit', timeout: 30000 });
    await page.waitForTimeout(3500);
    let tradingButton = page.getByRole('button', { name: /^(Crypto Demo|Alım Satım|Crypto)$/ });
    if (!(await tradingButton.isVisible())) {
      const nameInput = page.getByPlaceholder('Can İpkin veya Arda Yorulmazel');
      if (await nameInput.isVisible()) {
        await nameInput.fill('Arda Yorulmazel');
        await nameInput.press('Enter');
      }
    }
    let terminal = await openCryptoTerminal(page, viewport.name);
    result.layout = await terminal.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        terminalWidth: element.getBoundingClientRect().width,
        contentWidth: element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
        workspaceWidth: element.firstElementChild?.getBoundingClientRect().width,
      };
    });
    await page.screenshot({ path: path.join(outputDir, `crypto-${viewport.name}.png`), fullPage: true });
    await terminal.getByText('E.D.I.T.H. CRYPTO', { exact: true }).waitFor({ state: 'visible' });
    for (const label of ['İKİ AYRI HAT', 'DEMO: 10,000 CR', 'CANLI: LIMIT SPOT', 'HER EMİRDE TEK KULLANIMLIK ONAY', 'ÇEKİM / FUTURES / MARGIN YOK', 'DEMO HESABI AYRI']) {
      await terminal.getByText(label, { exact: true }).first().waitFor({ state: 'visible' });
    }
    const loopPanel = terminal.getByRole('heading', { name: 'Jev Sağlığı ve Karar Kaydı', exact: true }).locator('xpath=ancestor::section[1]');
    await loopPanel.getByRole('button', { name: "Jev'i Çalıştır" }).waitFor({ state: 'visible' });
    await loopPanel.getByRole('button', { name: 'Durdur', exact: true }).waitFor({ state: 'visible' });
    await loopPanel.getByLabel('Karar aralığı').waitFor({ state: 'visible' });
    // Assert availability without invoking decisions, loop actions, or demo trades.
    await terminal.getByRole('button', { name: 'Run Jev Decision', exact: true }).waitFor({ state: 'visible' });
    for (const name of ['DEMO AL', 'DEMO SAT', 'DEMO BEKLE / HOLD', 'Demo Hesabı Sıfırla']) {
      await terminal.getByRole('button', { name, exact: true }).waitFor({ state: 'visible' });
    }
    const chartCanvas = terminal.locator('canvas').first();
    await chartCanvas.waitFor({ state: 'visible', timeout: 20000 });
    const jevCheck = await page.evaluate(async () => {
      const [statusResponse, decisionResponse, symbolsResponse, loopResponse] = await Promise.all([
        fetch('/api/crypto/jev/status'),
        fetch('/api/crypto/decision/latest'),
        fetch('/api/crypto/symbols'),
        fetch('/api/crypto/jev/loop'),
      ]);
      for (const response of [statusResponse, decisionResponse, symbolsResponse, loopResponse]) {
        if (!response.ok) throw new Error(`Real endpoint failed: ${response.url} (${response.status})`);
      }
      return {
        status: await statusResponse.json(),
        latest: (await decisionResponse.json()).decision,
        symbols: (await symbolsResponse.json()).symbols,
        loop: await loopResponse.json(),
        text: document.body.innerText,
        html: document.documentElement.innerHTML,
      };
    });
    const jevKey = process.env.JEV_API_KEY?.trim();
    if (jevKey && (jevCheck.text.includes(jevKey) || jevCheck.html.includes(jevKey))) {
      throw new Error(`${viewport.name}: backend Jev secret leaked into the UI`);
    }
    if (jevCheck.status.secretExposed !== false) throw new Error(`${viewport.name}: Jev secretExposed invariant failed`);
    if (jevCheck.symbols.length !== 8 || jevCheck.symbols.some((item) => item.mode !== 'DEMO_TRADE_ALLOWED')) {
      throw new Error(`${viewport.name}: all eight symbols must be enabled for demo trading`);
    }
    if (jevCheck.loop.symbolCount !== 8 || jevCheck.loop.minimumIntervalSeconds > 10) {
      throw new Error(`${viewport.name}: Jev loop is not configured for eight symbols at the 10 second minimum`);
    }
    if (!jevCheck.text.includes('8 PARİTE')) throw new Error(`${viewport.name}: eight-symbol loop scope is missing from the UI`);
    if (jevCheck.status.configured) {
      const expectedStatus = jevCheck.status.available === true
        ? 'JEV HAZIR'
        : jevCheck.status.available === false
          ? 'JEV HATA'
          : 'JEV DOĞRULANMADI';
      const visibleText = await waitForTerminalText(terminal, expectedStatus);
      const upperText = visibleText.toLocaleUpperCase('tr-TR');
      if (jevCheck.status.available === true && !upperText.includes('JEV HAZIR')) {
        throw new Error(`${viewport.name}: available Jev is not shown as ready`);
      }
      if (jevCheck.status.available !== true && upperText.includes('JEV HAZIR')) {
        throw new Error(`${viewport.name}: unverified or unavailable Jev is shown as ready`);
      }
      if (jevCheck.status.available == null && !upperText.includes('JEV DOĞRULANMADI')) {
        throw new Error(`${viewport.name}: unverified Jev state is not shown conservatively`);
      }
      if (jevCheck.status.available === false && !upperText.includes('JEV HATA')) {
        throw new Error(`${viewport.name}: unavailable Jev state is not shown as failed`);
      }
      if (jevCheck.status.model && !visibleText.includes(String(jevCheck.status.model))) {
        throw new Error(`${viewport.name}: active Jev model is missing from the terminal`);
      }
      if (jevCheck.latest) {
        const panelText = await loopPanel.innerText();
        const action = String(jevCheck.latest.decision || jevCheck.latest.action || '');
        if (action && !panelText.includes(action)) throw new Error(`${viewport.name}: latest Jev decision is missing from the panel`);
        if (String(jevCheck.latest.source || '').toLowerCase() === 'jev' && !panelText.toLowerCase().includes('jev')) {
          throw new Error(`${viewport.name}: Jev decision source is missing from the panel`);
        }
      }
    }
    const checks = await terminal.evaluate((element) => {
      const canvas = element.querySelector('canvas');
      return {
        documentOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        canvasWidth: canvas?.getBoundingClientRect().width || 0,
        canvasHeight: canvas?.getBoundingClientRect().height || 0,
        terminalWidth: element.getBoundingClientRect().width,
        terminalOverflow: element.scrollWidth > element.clientWidth + 2,
      };
    });
    if (checks.documentOverflow) throw new Error(`${viewport.name}: document horizontal overflow`);
    if (checks.terminalOverflow) throw new Error(`${viewport.name}: terminal horizontal overflow`);
    if (checks.canvasWidth < 100 || checks.canvasHeight < 100) throw new Error(`${viewport.name}: chart canvas is blank or collapsed`);
    await chartCanvas.scrollIntoViewIfNeeded();
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const pixels = await checkCanvas(terminal);
    result.pixels = pixels;
    if (!pixels.some((canvas) => canvas.nonblank)) throw new Error(`${viewport.name}: no painted chart data: ${JSON.stringify(pixels)}`);
    await page.screenshot({ path: path.join(outputDir, `crypto-${viewport.name}-chart.png`), fullPage: true });
    terminal = await openCryptoTerminal(page, viewport.name);
    const controls = await checkControls(terminal);
    result.controls = controls;
    await loopPanel.getByRole('button', { name: 'Durdur', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(outputDir, `crypto-${viewport.name}-jev.png`), fullPage: true });
    await terminal.getByText('E.D.I.T.H. CRYPTO', { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(outputDir, `crypto-${viewport.name}.png`), fullPage: true });
    if (controls.failures.length) throw new Error(`${viewport.name}: clipped controls: ${JSON.stringify(controls.failures)}`);
    result.passed = true;
    console.log(`${viewport.name}: layout and endpoint checks passed`, { ...checks, controls: controls.checked, pixels, jev: jevCheck.status.status });
    } catch (error) {
      result.passed = false;
      result.error = error.message;
      console.error(`${viewport.name}: FAILED`, { ...result.layout, error: result.error });
      await page.screenshot({ path: path.join(outputDir, `crypto-${viewport.name}-failure.png`), fullPage: true }).catch(() => undefined);
    }
  }
  if (blockedWrites.length) throw new Error(`QA attempted crypto writes: ${JSON.stringify(blockedWrites)}`);
  const missingOwnerProbeViewports = viewportResults
    .map((result) => result.viewport)
    .filter((viewport) => !expectedOwnerProbes.some((probe) => probe.viewport === viewport));
  if (missingOwnerProbeViewports.length) {
    throw new Error(`Expected unauthenticated owner-session GET probe was not observed for: ${missingOwnerProbeViewports.join(', ')}`);
  }
  const expectedProbeConsoleErrors = [];
  for (const error of consoleErrors) {
    let errorPathname = '';
    try {
      errorPathname = error.url ? new URL(error.url).pathname : '';
    } catch { /* Invalid console location remains an ordinary error. */ }
    const matchingProbe = [...expectedOwnerProbes, ...expectedAdvancedOwnerProbes]
      .find((probe) => probe.viewport === error.viewport && probe.pathname === errorPathname);
    const expected401 = /Failed to load resource.*(?:status of )?401|server responded with a status of 401/i.test(error.message);
    if (matchingProbe && expected401 && !expectedProbeConsoleErrors.some((item) => item.viewport === error.viewport && item.pathname === errorPathname)) {
      expectedProbeConsoleErrors.push({ ...error, pathname: errorPathname, matchedProbe: matchingProbe.url });
    } else {
      browserErrors.push(error);
    }
  }
  if (browserErrors.length) throw new Error(`Browser errors: ${JSON.stringify(browserErrors)}`);
  const failedViewports = viewportResults.filter((result) => !result.passed);
  if (failedViewports.length) throw new Error(`Failed viewports: ${failedViewports.map((result) => result.viewport).join(', ')}. See viewport-results.json for details.`);
  console.log(`All six viewports passed; ${expectedOwnerProbes.length} session probes and ${expectedAdvancedOwnerProbes.length} advanced owner-auth negatives were observed without crypto write requests.`);
  await page.close();
} catch (error) {
  if (page && !page.isClosed()) {
    await page.screenshot({ path: path.join(outputDir, `crypto-${currentViewport}-failure.png`), fullPage: true }).catch(() => undefined);
  }
  throw error;
} finally {
  await browser?.close();
  fs.writeFileSync(path.join(outputDir, 'browser-errors.json'), JSON.stringify({ browserErrors, consoleErrors, httpResponses, expectedOwnerProbes, expectedAdvancedOwnerProbes, blockedWrites }, null, 2));
  fs.writeFileSync(path.join(outputDir, 'viewport-results.json'), JSON.stringify(viewportResults, null, 2));
}
