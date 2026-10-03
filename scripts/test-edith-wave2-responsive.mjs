import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const baseUrl = process.env.EDITH_UI_URL || 'http://127.0.0.1:4173';
const outputDir = path.resolve('artifacts', 'wave2-frontend');
fs.mkdirSync(outputDir, { recursive: true });

const viewports = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'laptop', width: 1366, height: 768 },
  { name: 'desktop', width: 1920, height: 1080 },
];
const screens = [
  { name: 'settings', title: 'Ayarlar', mobileName: /^Settings$/ },
  { name: 'tools', title: 'Araçlar / MCP', minWidth: 768 },
  { name: 'system', title: 'Sistem', minWidth: 768 },
  { name: 'crypto', title: 'Crypto Demo', mobileName: /^Crypto$/ },
];

const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const viewport of viewports) {
    const page = await browser.newPage({ viewport });
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto(baseUrl, { waitUntil: 'commit', timeout: 30_000 });
    await page.waitForTimeout(2_000);
    const login = page.getByPlaceholder('Can İpkin veya Arda Yorulmazel');
    if (await login.count()) {
      await login.waitFor({ state: 'visible', timeout: 10_000 });
      await login.fill('Arda Yorulmazel');
      await login.press('Enter');
      await page.waitForTimeout(1_000);
    }

    for (const screen of screens) {
      if (screen.minWidth && viewport.width < screen.minWidth) continue;
      let button = page.locator(`button[title="${screen.title}"]`).first();
      if (!await button.count() && screen.mobileName) button = page.getByRole('button', { name: screen.mobileName }).first();
      if (!await button.count()) {
        const advanced = page.locator('nav button[aria-expanded]').first();
        if (await advanced.count()) {
          await advanced.click();
          button = page.locator(`button[title="${screen.title}"]`).first();
        }
      }
      await button.waitFor({ state: 'visible', timeout: 15_000 });
      await button.click();
      await page.waitForTimeout(screen.name === 'tools' ? 1_500 : 700);
      const layout = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        bodyText: document.body.innerText.slice(0, 6_000),
      }));
      if (layout.scrollWidth > layout.clientWidth + 2) {
        throw new Error(`${viewport.name}/${screen.name}: horizontal overflow ${layout.scrollWidth} > ${layout.clientWidth}`);
      }
      if (screen.name === 'tools' && !/(yükleniyor|erişilemiyor|registry boş|CANONICAL)/i.test(layout.bodyText)) {
        throw new Error(`${viewport.name}/tools: finite loading, empty, error, or loaded state is not visible`);
      }
      if (screen.name === 'crypto' && !/DEMO MODE/.test(layout.bodyText)) {
        throw new Error(`${viewport.name}/crypto: DEMO MODE safety label is missing`);
      }
      await page.screenshot({ path: path.join(outputDir, `${viewport.name}-${screen.name}.png`), fullPage: false });
      results.push({ viewport: viewport.name, screen: screen.name, width: layout.clientWidth, overflow: false });
    }
    if (pageErrors.length) throw new Error(`${viewport.name}: page errors: ${pageErrors.join(' | ')}`);
    await page.close();
  }
  fs.writeFileSync(path.join(outputDir, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ success: true, checks: results.length, outputDir }, null, 2));
} finally {
  await browser.close();
}
