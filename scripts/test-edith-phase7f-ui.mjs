import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const baseUrl = process.env.EDITH_UI_URL ?? 'http://127.0.0.1:4173';
const outputDir = 'artifacts/phase7f-advanced-ui';
await mkdir(outputDir, { recursive: true });

const workspaceId = 'workspace-phase7f';
const emptyState = {
  priority: [], shadow: [], ghosts: [], 'mission-memories': [], bookmarks: [],
  'recent-context': [], snapshots: [], 'restore-plans': [], scenes: [], watchers: [],
  comparisons: [], communication: [], orchestration: [], retries: [], downloads: [],
  'power-presence': [], 'history-policy': [], 'capsule-selection': [],
};
const capabilityStatus = {
  persistence: 'memory_only', restartRecovery: 'partial', nativeExecution: 'configuration_required',
  scheduler: 'configuration_required', watcherObservation: 'configuration_required',
  watcherDelivery: 'configuration_required', mobileRead: 'available', secretsStored: false,
};

const browser = await chromium.launch({ headless: true, args: ['--no-proxy-server'] });
const viewports = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'laptop', width: 1366, height: 768 },
  { name: 'desktop', width: 1920, height: 1080 },
];
const results = [];

for (const viewport of viewports) {
  const page = await browser.newPage({ viewport });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/workspace/status') {
      return route.fulfill({ json: { success: true, config: { workspaceId } } });
    }
    if (url.pathname === '/api/edith/advanced/state') {
      return route.fulfill({ json: { success: true, status: capabilityStatus, state: emptyState } });
    }
    return route.fulfill({ status: 503, json: { success: false, errorCode: 'FIXTURE_OFFLINE', safeMessage: 'Not configured in Phase 7F browser fixture.' } });
  });

  await page.goto(baseUrl, { waitUntil: 'commit', timeout: 15_000 });
  const nameInput = page.getByPlaceholder('Can İpkin veya Arda Yorulmazel');
  await nameInput.waitFor({ timeout: 30_000 });
  await nameInput.fill('ARDA YORULMAZEL');
  await page.getByTitle('Etkinleştir').click();
  await page.getByLabel('Return to command center').click();
  await page.getByTitle('Görevler').click();

  const workspace = page.getByTestId('advanced-experience-workspace');
  await workspace.waitFor({ timeout: 15_000 });
  await workspace.getByText('memory only', { exact: true }).waitFor();
  await workspace.getByText('restart partial', { exact: true }).waitFor();
  assert.equal(await workspace.getByText('native configuration required', { exact: true }).count(), 1);
  assert.equal(await workspace.getByText('No raw screen archive', { exact: false }).count(), 1);
  assert.equal(await workspace.getByPlaceholder('Private history excluded').count(), 1);
  assert.equal(await workspace.getByRole('button', { name: 'Enable with explicit consent' }).isDisabled(), true);
  assert.equal(await workspace.getByRole('button', { name: 'Game unavailable' }).isDisabled(), true);
  assert.equal(await workspace.getByRole('button', { name: 'Presentation unavailable' }).isDisabled(), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
  await page.screenshot({ path: `${outputDir}/advanced-${viewport.name}.png`, fullPage: true });

  results.push({ viewport, consoleErrors, pageErrors });
  await page.close();
}

await browser.close();
const majorConsoleErrors = results.flatMap((result) => result.consoleErrors).filter((message) => !message.includes('Failed to load resource'));
assert.deepEqual(majorConsoleErrors, []);
assert.deepEqual(results.flatMap((result) => result.pageErrors), []);
console.log(JSON.stringify({ success: true, baseUrl, results, screenshots: viewports.length }, null, 2));
