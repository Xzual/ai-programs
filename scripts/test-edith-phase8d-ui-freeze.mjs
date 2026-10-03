import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const baseUrl = process.env.EDITH_UI_URL ?? 'http://127.0.0.1:4173';
const outputDir = 'artifacts/phase8d-ui-freeze';
await mkdir(outputDir, { recursive: true });

const now = '2026-09-28T12:00:00.000Z';
const workspaceId = 'workspace-phase8d';
const progress = {
  contractVersion: 2, taskId: 'task-phase8d', revision: 4, status: 'RUNNING', percent: 40,
  completedSteps: 1, totalSteps: 3, failedSteps: 0, recoveryAttempts: 0, terminal: false,
  sources: ['task_status', 'plan_steps'],
};
const task = {
  id: 'task-phase8d', title: 'Phase 8 consumer freeze', objective: 'Verify canonical consumer truth without inferred readiness',
  originalUserRequest: 'Audit Phase 1-7 consumer integration', priority: 'high', status: 'RUNNING', createdAt: now, updatedAt: now,
  dependencies: [], subtasks: [], candidateAgents: [], toolsRequired: [], permissionsRequired: [], riskLevel: 1,
  checkpoints: [], artifacts: [], observations: [], validationRules: [], recoveryEvents: [], timeline: [], agentActivity: [],
  memoryReferences: [], auditEvents: [], contractVersion: 2, revision: 4, eventSequence: 8,
  plan: {
    id: 'plan-phase8d', taskId: 'task-phase8d', objective: 'Consumer freeze', createdAt: now, planner: 'fixture', status: 'READY',
    steps: [
      { id: 'step-contract', title: 'Read canonical state', objective: 'Read', status: 'COMPLETED', dependsOn: [], suggestedTools: [], requiredPermissions: [], validationCriteria: [], riskLevel: 1 },
      { id: 'step-ui', title: 'Render without inference', objective: 'Render', status: 'RUNNING', dependsOn: ['step-contract'], suggestedTools: [], requiredPermissions: [], validationCriteria: [], riskLevel: 1 },
      { id: 'step-qa', title: 'Verify responsive states', objective: 'Verify', status: 'PENDING', dependsOn: ['step-ui'], suggestedTools: [], requiredPermissions: [], validationCriteria: [], riskLevel: 1 },
    ],
    requiredTools: [], requiredPermissions: [], requiredAgents: [], validationCriteria: [], stopConditions: [], maxIterations: 1, maxRetries: 0, maxToolCalls: 0, taskTimeoutMs: 30_000,
  },
  progress,
};
const events = [{
  contractVersion: 2, taskId: task.id, eventId: 'event-phase8d', sequence: 8, revision: 4,
  type: 'task.step_updated', occurredAt: now, payload: { stepId: 'step-ui', status: 'RUNNING', attempt: 1 },
  context: { correlationId: 'corr-phase8d', idempotencyKey: 'idem-phase8d' },
}];
const envelope = (data) => ({ success: true, contract: { schema: 'edith.shared', version: 2 }, data });
const advancedState = {
  priority: [], shadow: [], ghosts: [], 'mission-memories': [], bookmarks: [], 'recent-context': [], snapshots: [],
  'restore-plans': [], scenes: [], watchers: [], comparisons: [], communication: [], orchestration: [], retries: [],
  downloads: [], 'power-presence': [], 'history-policy': [], 'capsule-selection': [],
};
const advancedStatus = {
  persistence: 'memory_only', restartRecovery: 'partial', nativeExecution: 'configuration_required',
  scheduler: 'configuration_required', watcherObservation: 'configuration_required', watcherDelivery: 'configuration_required',
  mobileRead: 'available', secretsStored: false,
};

const browser = await chromium.launch({ headless: true, args: ['--no-proxy-server'] });
const results = [];
for (const viewport of [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'laptop', width: 1366, height: 768 },
  { name: 'desktop', width: 1920, height: 1080 },
]) {
  const page = await browser.newPage({ viewport });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/edith/tasks') return route.fulfill({ json: envelope({ tasks: [task] }) });
    if (path === `/api/edith/tasks/${task.id}/activity`) return route.fulfill({ json: envelope({ task, progress, events }) });
    if (path === '/api/workspace/status') return route.fulfill({ json: { success: true, config: { workspaceId } } });
    if (path === '/api/edith/advanced/state') return route.fulfill({ json: { success: true, status: advancedStatus, state: advancedState } });
    return route.fulfill({ status: 503, json: { success: false, errorCode: 'FIXTURE_OFFLINE', safeMessage: 'Not configured in the Phase 8D fixture.' } });
  });

  await page.goto(baseUrl, { waitUntil: 'commit', timeout: 15_000 });
  const nameInput = page.getByPlaceholder('Can İpkin veya Arda Yorulmazel');
  await nameInput.waitFor({ timeout: 30_000 });
  await nameInput.fill('ARDA YORULMAZEL');
  await page.getByTitle('Etkinleştir').click();
  await page.getByLabel('Return to command center').click();

  const capsule = page.getByTestId('dynamic-task-capsule');
  await capsule.getByText(task.title).waitFor();
  assert.equal(await capsule.getByText('40%', { exact: true }).count(), 1);
  await capsule.getByLabel('Mission View aç').click();
  const mission = page.getByRole('dialog');
  await mission.getByText('Mission View · In-app').waitFor();
  assert.equal(await mission.getByText(/Native always-on-top overlay mevcut değil/).count(), 1);
  assert.equal(await mission.getByRole('button', { name: 'Duraklat' }).isDisabled(), true);
  await page.keyboard.press('Escape');
  await mission.waitFor({ state: 'detached' });

  await page.getByRole('button', { name: 'Computer Use', exact: true }).click();
  await page.getByRole('heading', { name: 'Computer Use' }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Start approved session' }).isDisabled(), true);
  await page.getByText('Desktop Computer Use requires the Tauri application.', { exact: true }).waitFor();

  await page.getByRole('button', { name: 'Tarayıcı', exact: true }).click();
  await page.getByText('Browser Agent bağlı değil', { exact: true }).waitFor();
  assert.equal(await page.getByText('Browser Agent hazır', { exact: true }).count(), 0);

  await page.getByRole('button', { name: 'Görevler', exact: true }).click();
  const advanced = page.getByTestId('advanced-experience-workspace');
  await advanced.getByText('memory only', { exact: true }).waitFor();
  assert.equal(await advanced.getByText('native configuration required', { exact: true }).count(), 1);
  assert.equal(await advanced.getByRole('button', { name: 'Enable with explicit consent' }).isDisabled(), true);
  await page.screenshot({ path: `${outputDir}/tasks-${viewport.name}.png`, fullPage: true });

  await page.getByRole('button', { name: 'Dosyalar', exact: true }).click();
  await page.getByText('Dosya oturumu bekleniyor', { exact: true }).waitFor();

  await page.getByRole('button', { name: 'Sistem', exact: true }).click();
  await page.getByText('Cross-Device Desktop Bridge', { exact: true }).waitFor();
  await page.getByText('Native invoke unavailable', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Start Live View' }).isDisabled(), true);
  assert.equal(await page.getByText('Kill switch', { exact: true }).locator('..').locator('..').getByText('UNVERIFIED', { exact: true }).count(), 1);
  assert.equal(await page.getByText('Permissions', { exact: true }).locator('..').locator('..').getByText('UNVERIFIED', { exact: true }).count(), 1);
  assert.equal(await page.getByText('Browser Use mode', { exact: true }).locator('..').locator('..').getByText('BLOCKED', { exact: true }).count(), 1);
  assert.equal(await page.getByText('Browser Agent hazır', { exact: true }).count(), 0);
  assert.equal(await page.locator('body').innerText().then((text) => /[A-Z]:\\Users\\/i.test(text)), false);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
  await page.screenshot({ path: `${outputDir}/system-${viewport.name}.png`, fullPage: true });

  results.push({ viewport, consoleErrors, pageErrors });
  await page.close();
}

const authPage = await browser.newPage({ viewport: { width: 1366, height: 768 } });
const authPageErrors = [];
authPage.on('pageerror', (error) => authPageErrors.push(error.message));
await authPage.route('**/api/**', async (route) => {
  const path = new URL(route.request().url()).pathname;
  if (path === '/api/edith/tasks') return route.fulfill({ json: envelope({ tasks: [task] }) });
  if (path === `/api/edith/tasks/${task.id}/activity`) return route.fulfill({ json: envelope({ task, progress, events }) });
  if (path === '/api/workspace/status') return route.fulfill({ json: { success: true, config: { workspaceId } } });
  if (path === '/api/edith/advanced/state') return route.fulfill({ status: 401, json: { success: false, error: 'owner_session_required', safeMessage: 'A valid owner session is required.' } });
  return route.fulfill({ status: 503, json: { success: false, errorCode: 'FIXTURE_OFFLINE', safeMessage: 'Not configured in the Phase 8D fixture.' } });
});
await authPage.goto(baseUrl, { waitUntil: 'commit', timeout: 15_000 });
const authNameInput = authPage.getByPlaceholder('Can İpkin veya Arda Yorulmazel');
await authNameInput.waitFor({ timeout: 30_000 });
await authNameInput.fill('ARDA YORULMAZEL');
await authPage.getByTitle('Etkinleştir').click();
await authPage.getByLabel('Return to command center').click();
await authPage.getByRole('button', { name: 'Görevler', exact: true }).click();
await authPage.getByText('Advanced state unavailable. OWNER_SESSION_REQUIRED', { exact: true }).waitFor();
assert.deepEqual(authPageErrors, []);
await authPage.close();

await browser.close();
const majorConsoleErrors = results.flatMap((result) => result.consoleErrors).filter((message) => !message.includes('Failed to load resource'));
assert.deepEqual(majorConsoleErrors, []);
assert.deepEqual(results.flatMap((result) => result.pageErrors), []);
console.log(JSON.stringify({ success: true, baseUrl, viewports: results.map(({ viewport }) => viewport), ownerSessionRequiredState: true, screenshots: results.length * 2 }, null, 2));
