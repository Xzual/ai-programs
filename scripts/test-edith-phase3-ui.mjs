import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const baseUrl = process.env.EDITH_UI_URL ?? 'http://127.0.0.1:4173';
const outputDir = 'artifacts/phase3-desktop-ui';
await mkdir(outputDir, { recursive: true });

const now = '2026-09-28T12:00:00.000Z';
const progress = {
  contractVersion: 2, taskId: 'task-phase3', revision: 4, status: 'RUNNING', percent: 40,
  completedSteps: 1, totalSteps: 3, failedSteps: 0, recoveryAttempts: 0, terminal: false,
  sources: ['task_status', 'plan_steps'],
};
const task = {
  id: 'task-phase3', title: 'Phase 3 desktop integration', objective: 'Render canonical task state without invented runtime claims',
  originalUserRequest: 'Integrate Dynamic Capsule and Mission View', priority: 'high', status: 'RUNNING', createdAt: now, updatedAt: now,
  dependencies: [], subtasks: [], candidateAgents: [], toolsRequired: [], permissionsRequired: [], riskLevel: 1,
  checkpoints: [], artifacts: [], observations: [], validationRules: [], recoveryEvents: [], timeline: [], agentActivity: [],
  memoryReferences: [], auditEvents: [], contractVersion: 2, revision: 4, eventSequence: 8,
  plan: { id: 'plan-phase3', taskId: 'task-phase3', objective: 'Phase 3 UI', createdAt: now, planner: 'heuristic-v1', status: 'READY',
    steps: [
      { id: 'step-contract', title: 'Validate V2 envelope', objective: 'Validate', status: 'COMPLETED', dependsOn: [], suggestedTools: [], requiredPermissions: [], validationCriteria: [], riskLevel: 1 },
      { id: 'step-ui', title: 'Render Dynamic Capsule', objective: 'Render', status: 'RUNNING', dependsOn: ['step-contract'], suggestedTools: [], requiredPermissions: [], validationCriteria: [], riskLevel: 1 },
      { id: 'step-qa', title: 'Verify responsive states', objective: 'Verify', status: 'PENDING', dependsOn: ['step-ui'], suggestedTools: [], requiredPermissions: [], validationCriteria: [], riskLevel: 1 },
    ], requiredTools: [], requiredPermissions: [], requiredAgents: [], validationCriteria: [], stopConditions: [], maxIterations: 1, maxRetries: 0, maxToolCalls: 0, taskTimeoutMs: 30_000 },
  progress,
};
const events = [{
  contractVersion: 2, taskId: task.id, eventId: 'event-phase3', sequence: 8, revision: 4,
  type: 'task.step_updated', occurredAt: now, payload: { stepId: 'step-ui', status: 'RUNNING', attempt: 1 },
  context: { correlationId: 'corr-phase3', idempotencyKey: 'idem-phase3' },
}];
const envelope = (data) => ({ success: true, contract: { schema: 'edith.shared', version: 2 }, data });

const browser = await chromium.launch({ headless: true, args: ['--no-proxy-server'] });
const results = [];
for (const viewport of [{ name: 'desktop', width: 1440, height: 900 }, { name: 'mobile', width: 390, height: 844 }]) {
  const page = await browser.newPage({ viewport });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/edith/tasks') return route.fulfill({ json: envelope({ tasks: [task] }) });
    if (path === `/api/edith/tasks/${task.id}/activity`) return route.fulfill({ json: envelope({ task, progress, events }) });
    return route.fulfill({ status: 503, json: { success: false, error: 'Not configured in Phase 3 UI fixture.' } });
  });
  await page.goto(baseUrl, { waitUntil: 'commit', timeout: 15_000 });
  await page.getByPlaceholder('Can İpkin veya Arda Yorulmazel').waitFor({ timeout: 30_000 });
  await page.getByPlaceholder('Can İpkin veya Arda Yorulmazel').fill('ARDA YORULMAZEL');
  await page.getByTitle('Etkinleştir').click();
  await page.getByLabel('Return to command center').click();
  const capsule = page.getByTestId('dynamic-task-capsule');
  await capsule.getByText('Phase 3 desktop integration').waitFor();
  await capsule.getByLabel('Görev kapsülünü genişlet').click();
  await capsule.getByText('Eylemler capability bekliyor').waitFor();
  assert.equal(await capsule.getByRole('button', { name: 'Duraklat' }).isDisabled(), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
  await page.screenshot({ path: `${outputDir}/capsule-${viewport.name}.png`, fullPage: true });
  await capsule.getByLabel('Mission View aç').click();
  await page.getByRole('dialog').getByText('Mission View · In-app').waitFor();
  assert.equal(await page.getByRole('dialog').getByText(/Native always-on-top overlay mevcut değil/).count(), 1);
  assert.equal(await page.getByRole('dialog').getByText('Render Dynamic Capsule').count(), 1);
  await page.screenshot({ path: `${outputDir}/mission-${viewport.name}.png`, fullPage: true });
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  assert.equal(await capsule.getByLabel('Mission View aç').evaluate((element) => element === document.activeElement), true);
  results.push({ viewport, consoleErrors, pageErrors });
  await page.close();
}

const offlinePage = await browser.newPage({ viewport: { width: 768, height: 1024 } });
await offlinePage.route('**/api/**', (route) => route.fulfill({ status: 503, json: { success: false, error: 'Fixture offline.' } }));
await offlinePage.goto(baseUrl, { waitUntil: 'commit', timeout: 15_000 });
await offlinePage.getByPlaceholder('Can İpkin veya Arda Yorulmazel').waitFor({ timeout: 30_000 });
await offlinePage.getByPlaceholder('Can İpkin veya Arda Yorulmazel').fill('ARDA YORULMAZEL');
await offlinePage.getByTitle('Etkinleştir').click();
await offlinePage.getByLabel('Return to command center').click();
await offlinePage.getByText('Görev servisi çevrimdışı').waitFor();
await offlinePage.screenshot({ path: `${outputDir}/capsule-offline-tablet.png`, fullPage: true });
await offlinePage.close();
await browser.close();

const majorErrors = results.flatMap((result) => result.consoleErrors).filter((message) => !message.includes('Failed to load resource'));
assert.deepEqual(majorErrors, []);
assert.deepEqual(results.flatMap((result) => result.pageErrors), []);
console.log(JSON.stringify({ success: true, baseUrl, results, offlineState: true, screenshots: 5 }, null, 2));
