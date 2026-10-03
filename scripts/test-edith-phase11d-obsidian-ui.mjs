import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const baseUrl = process.env.EDITH_UI_URL ?? 'http://127.0.0.1:4173';
const outputDir = 'artifacts/phase11d-obsidian-ui';
await mkdir(outputDir, { recursive: true });

const checkedAt = '2026-09-29T12:00:00.000Z';
const firstRun = {
  contractVersion: 2, amendment: '2.1', state: 'FIRST_RUN_REQUIRED', reasonCode: 'VAULT_SELECTION_REQUIRED',
  provider: 'none', configured: false, available: false, readable: false, writable: false,
  selectionAction: 'show_first_run', promptPolicy: 'user_initiated_only', configRevision: 0,
  executionAuthority: false, knowledgeOnly: true, checkedAt,
};
const ready = {
  ...firstRun, state: 'READY', reasonCode: 'VAULT_READY', provider: 'user_vault', configured: true,
  available: true, readable: true, writable: true, selectionAction: 'none', configRevision: 1,
};
const revoked = { ...firstRun, reasonCode: 'VAULT_SELECTION_REVOKED', configRevision: 2 };
const session = { actor: 'owner', csrfToken: 'phase11d-csrf', createdAt: checkedAt, expiresAt: '2026-09-29T14:00:00.000Z' };
const canaries = ['C:\\PHASE11D_SECRET\\vault', 'HANDLE_PHASE11D_SECRET', 'TOKEN_PHASE11D_SECRET', 'DEVICE_PHASE11D_SECRET'];

async function installRoutes(page, mode = 'submitted') {
  let status = firstRun;
  const mutations = [];
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/security/session') return route.fulfill({ json: { success: true, session } });
    if (path === '/api/edith/obsidian/provider/status') return route.fulfill({ json: { success: true, status } });
    if (path === '/api/edith/obsidian/provider/activate' || path === '/api/edith/obsidian/provider/change') {
      mutations.push({ path, body: request.postData(), headers: request.headers() });
      if (mode === 'submitted') status = ready;
      return route.fulfill({ status: 428, json: { success: false, code: 'NATIVE_SELECTION_REQUIRED', safeMessage: 'Native selection is required.' } });
    }
    if (path === '/api/edith/obsidian/provider/revoke') {
      mutations.push({ path, body: request.postData(), headers: request.headers() });
      status = revoked;
      return route.fulfill({ json: { success: true } });
    }
    if (path === '/api/workspace/status') return route.fulfill({ json: {
      success: true,
      status: {
        configured: false, state: 'configuration_required', readable: false, writable: false,
        portableMode: false, persistenceRestartRequired: false, limitations: [],
        safeMessage: `UNSAFE ${canaries.join(' ')}`,
        workspaceRoot: canaries[0], obsidianVaultPath: canaries[0],
      },
    } });
    if (path === '/api/edith/skills/status') return route.fulfill({ json: { success: true, checkedAt, statuses: [] } });
    return route.fulfill({ status: 503, json: { success: false, errorCode: 'FIXTURE_OFFLINE', safeMessage: 'Not configured in this UI fixture.' } });
  });
  return { mutations };
}

async function installNative(page, outcome) {
  await page.addInitScript(({ outcome, canaries }) => {
    Object.defineProperty(window, '__TAURI__', {
      configurable: true,
      value: {
        core: {
          invoke: async (command, args) => {
            window.__phase11dInvocations = [...(window.__phase11dInvocations ?? []), { command, args }];
            if (command === 'obsidian_request_vault_folder') return {
              ...outcome,
              selectionHandle: canaries[1],
              absolutePath: canaries[0],
              token: canaries[2],
              deviceId: canaries[3],
            };
            return undefined;
          },
        },
      },
    });
  }, { outcome, canaries });
}

async function enterWorkspace(page) {
  await page.goto(baseUrl, { waitUntil: 'commit', timeout: 15_000 });
  const nameInput = page.getByPlaceholder('Can İpkin veya Arda Yorulmazel');
  await nameInput.waitFor({ timeout: 30_000 });
  await nameInput.fill('ARDA YORULMAZEL');
  await page.getByTitle('Etkinleştir').click();
  await page.getByLabel('Return to command center').click();
  await page.getByRole('button', { name: 'Ayarlar', exact: true }).click();
  await page.getByRole('button', { name: 'Workspace', exact: true }).click();
  await page.getByTestId('obsidian-provider-panel').waitFor();
}

function observeErrors(page) {
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  return { consoleErrors, pageErrors };
}

const browser = await chromium.launch({ headless: true, args: ['--no-proxy-server'] });
const results = [];
for (const viewport of [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'laptop', width: 1366, height: 768 },
  { name: 'desktop', width: 1920, height: 1080 },
]) {
  const page = await browser.newPage({ viewport });
  const errors = observeErrors(page);
  await installNative(page, { status: 'selected', publication: 'submitted' });
  const fixture = await installRoutes(page, 'submitted');
  await enterWorkspace(page);

  const panel = page.getByTestId('obsidian-provider-panel');
  try {
    await panel.getByText('FIRST_RUN_REQUIRED', { exact: true }).waitFor();
  } catch (error) {
    throw new Error(`Obsidian panel did not reach first-run state: ${await panel.innerText()}`, { cause: error });
  }
  await panel.getByText('VAULT_SELECTION_REQUIRED', { exact: true }).waitFor();
  assert.equal(await panel.getByRole('button', { name: 'Obsidian klasörü seç', exact: true }).count(), 1);
  assert.equal(await page.locator('input[type="file"]').count(), 0);
  await panel.getByRole('button', { name: 'Obsidian klasörü seç', exact: true }).click();
  await panel.getByText('READY', { exact: true }).waitFor();
  await panel.getByText('VAULT_READY', { exact: true }).waitFor();

  const pickerInvocations = await page.evaluate(() => (window.__phase11dInvocations ?? []).filter((entry) => entry.command === 'obsidian_request_vault_folder'));
  assert.equal(pickerInvocations.length, 1);
  assert.equal(pickerInvocations[0].args, undefined);
  assert.equal(fixture.mutations[0]?.body, '{}');
  assert.equal(fixture.mutations[0]?.headers['x-edith-csrf-token'], session.csrfToken);
  assert.match(fixture.mutations[0]?.headers['x-idempotency-key'] ?? '', /^obsidian\.activate\.[a-f0-9-]+$/i);
  const body = await page.locator('body').innerText();
  for (const canary of canaries) assert.equal(body.includes(canary), false);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
  await page.screenshot({ path: `${outputDir}/settings-${viewport.name}.png`, fullPage: true });

  if (viewport.name === 'desktop') {
    await panel.getByRole('button', { name: 'Revoke access', exact: true }).click();
    const confirm = panel.getByRole('button', { name: 'Confirm revoke', exact: true });
    await confirm.waitFor();
    assert.equal(await confirm.evaluate((element) => element === document.activeElement), true);
    await confirm.click();
    await panel.getByText('FIRST_RUN_REQUIRED', { exact: true }).waitFor();
    await panel.getByText('VAULT_SELECTION_REVOKED', { exact: true }).waitFor();
    const revoke = fixture.mutations.find((mutation) => mutation.path.endsWith('/revoke'));
    assert.equal(revoke?.body, '{}');
    assert.match(revoke?.headers['x-idempotency-key'] ?? '', /^obsidian\.revoke\.[a-f0-9-]+$/i);
    await page.screenshot({ path: `${outputDir}/settings-desktop-revoked.png`, fullPage: true });
  }

  results.push({ viewport, ...errors });
  await page.close();
}

const cancelPage = await browser.newPage({ viewport: { width: 1366, height: 768 } });
const cancelErrors = observeErrors(cancelPage);
await installNative(cancelPage, { status: 'cancelled', publication: 'none' });
await installRoutes(cancelPage, 'cancelled');
await enterWorkspace(cancelPage);
await cancelPage.getByRole('button', { name: 'Obsidian klasörü seç', exact: true }).click();
await cancelPage.getByText('Folder selection cancelled. No Obsidian configuration changed.', { exact: true }).waitFor();
assert.equal(await cancelPage.getByTestId('obsidian-provider-panel').getByText('FIRST_RUN_REQUIRED', { exact: true }).count(), 1);
assert.equal(await cancelPage.getByTestId('obsidian-provider-panel').getByText('READY', { exact: true }).count(), 0);
await cancelPage.close();

const browserPage = await browser.newPage({ viewport: { width: 1366, height: 768 } });
const browserErrors = observeErrors(browserPage);
await installRoutes(browserPage, 'cancelled');
await enterWorkspace(browserPage);
await browserPage.getByRole('button', { name: 'Obsidian klasörü seç', exact: true }).click();
await browserPage.getByText('Desktop native picker required. Open E.D.I.T.H. in the desktop application.', { exact: true }).waitFor();
assert.equal(await browserPage.getByTestId('obsidian-provider-panel').getByText('FIRST_RUN_REQUIRED', { exact: true }).count(), 1);
await browserPage.close();

await browser.close();
const allErrors = [...results, cancelErrors, browserErrors];
const majorConsoleErrors = allErrors.flatMap((result) => result.consoleErrors).filter((message) => !message.includes('Failed to load resource'));
assert.deepEqual(majorConsoleErrors, []);
assert.deepEqual(allErrors.flatMap((result) => result.pageErrors), []);

const report = {
  success: true,
  baseUrl,
  viewports: results.map(({ viewport }) => viewport),
  explicitPickerOnly: true,
  cancelHarmless: true,
  revokeRefetched: true,
  browserFailClosed: true,
  sensitiveCanariesAbsent: true,
  screenshots: 5,
};
await writeFile(`${outputDir}/results.json`, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
