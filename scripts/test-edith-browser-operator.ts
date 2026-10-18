import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { randomUUID, createHash } from 'node:crypto';
import express from 'express';
import type { Page } from 'playwright';
import type { BrowserWorkflowRequest, EdithToolResult } from '../src/edith/core';
import { parseBrowserOperatorReceipt, type BrowserOperatorReceipt } from '../src/edith/browserOperatorContract';
import { projectTaskEventsV2 } from '../src/edith/contracts';

const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const fixtureDirectory = path.resolve('artifacts/repair-20261006/chat5/w5-browser-producer/tests');
const reports = path.join(fixtureDirectory, 'runtime');
const evidence: Array<Record<string, unknown>> = [];
const owned: Array<{ sessionId: string; owner: string; pid: number }> = [];

async function listen(server: http.Server): Promise<string> {
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address(); assert.ok(address && typeof address === 'object');
  return `http://127.0.0.1:${address.port}`;
}
async function closeServer(server: http.Server | undefined) {
  if (!server?.listening) return;
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function main() {
  assert.equal(process.env.EDITH_TEST_MODE, 'true', 'Run only in the approved isolated harness');
  assert.ok(process.env.EDITH_TEST_DATA_DIR, 'A temporary persistence directory is required');
  fs.mkdirSync(reports, { recursive: true });
  const { createOwnerSessionRouter, getSoleActiveOwnerSession } = await import('../server/security/ownerSession');
  const { createPermissionsRouter } = await import('../server/routes/permissions');
  const { createBrowserWorkflowsRouter } = await import('../server/routes/browserWorkflows');
  const { browserWorkflowService } = await import('../src/edith/browserWorkflowService');
  const { getBrowserOperatorAdapter, setBrowserOperatorTestOptions } = await import('../src/edith/browserOperatorAdapter');
  const { executeEdithTool } = await import('../src/edith/serverRegistry');
  const { taskService } = await import('../src/edith/taskService');
  const { verificationService } = await import('../src/edith/verifier');
  const { killSwitchService } = await import('../src/edith/killSwitch');
  const { getEdithPersistenceStore } = await import('../src/edith/persistence');
  const { readRecentAuditEvents } = await import('../src/edith/audit');

  let fixtureServer: http.Server | undefined;
  let apiServer: http.Server | undefined;
  let fixtureHits = 0;
  let unsafeTargetHits = 0;
  let redirectHits = 0;
  let cookie = '', csrf = '', owner = '', grantId = '', expiresAt = 0;
  let hook: ((phase: 'located' | 'after_input', page: Page) => Promise<void>) | undefined;
  const credential = randomUUID();
  process.env.EDITH_OWNER_TOKEN = credential;
  process.env.EDITH_OWNER_TOKEN_ONE_TIME = 'false';
  const app = express(); app.use(express.json({ limit: '32kb' }));
  app.use(createOwnerSessionRouter()); app.use(createPermissionsRouter()); app.use(createBrowserWorkflowsRouter());
  try {
    const fixtureHtml = fs.readFileSync(path.join(fixtureDirectory, 'fixture.html'));
    fixtureServer = http.createServer((req, res) => {
      fixtureHits++;
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.searchParams.has('token')) unsafeTargetHits++;
      if (url.pathname === '/redirect') { redirectHits++; res.writeHead(302, { location: '/destination?token=private-value' }); res.end(); return; }
      if (!['/', '/search', '/destination'].includes(url.pathname)) { res.writeHead(404).end(); return; }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); res.end(fixtureHtml);
    });
    const fixtureOrigin = await listen(fixtureServer);
    apiServer = http.createServer(app);
    const apiOrigin = await listen(apiServer);
    async function api(url: string, method = 'POST', body?: unknown, authenticated = true) {
      const response = await fetch(`${apiOrigin}${url}`, { method,
        headers: { origin: apiOrigin, ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(authenticated ? { cookie, 'x-edith-csrf-token': csrf } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(45_000) });
      return { status: response.status, body: await response.json() as any };
    }
    async function login(ttl?: number) {
      if (ttl) process.env.EDITH_OWNER_SESSION_TTL_MS = String(ttl); else delete process.env.EDITH_OWNER_SESSION_TTL_MS;
      const response = await fetch(`${apiOrigin}/api/security/session`, { method: 'POST', headers: { origin: apiOrigin, authorization: `Bearer ${credential}` }, signal: AbortSignal.timeout(10_000) });
      assert.equal(response.status, 201); const result = await response.json() as any;
      cookie = response.headers.get('set-cookie')!.split(';')[0]; csrf = result.session.csrfToken;
      const actual = getSoleActiveOwnerSession(); assert.ok(actual); owner = actual.bindingId; expiresAt = actual.expiresAt;
    }
    const browserToolIds = ['browser_workflow', 'browser_search', 'browser_open', 'playwright_browser_agent'];
    async function grant(toolIds = browserToolIds) {
      const response = await api('/api/edith/permissions/grants', 'POST', {
        permissions: ['network:read', 'browser:control'], toolIds,
        ttlMs: 600_000, reason: 'Actual owned browser isolated fixture acceptance',
      });
      assert.equal(response.status, 200); assert.equal(response.body.grant.actor, 'owner'); grantId = response.body.grant.id;
    }
    const options = () => ({ fixtureOrigins: [fixtureOrigin], searchUrl: (query: string) => `${fixtureOrigin}/search?q=${encodeURIComponent(query)}`,
      beforeEffect: async (phase: 'located' | 'after_input', page: Page) => { await hook?.(phase, page); } });
    await setBrowserOperatorTestOptions(options());
    assert.equal(getBrowserOperatorAdapter().availability().available, true, 'Existing Chromium distribution must be available; no install fallback');
    await login();

    function receipt(result: EdithToolResult, expectedAction: BrowserWorkflowRequest['action']) {
      const parsed = parseBrowserOperatorReceipt(result.structuredOutput?.browser);
      assert.equal(parsed.success, true, `Receipt must parse: ${JSON.stringify(result)}`);
      if (!parsed.success) throw new Error('Receipt invalid');
      assert.equal(parsed.value.action, expectedAction); assert.equal(parsed.value.nativePhysicalProof, false);
      assert.equal(parsed.value.backend, 'owned_headed_playwright');
      return parsed.value;
    }
    function verified(result: EdithToolResult, action: BrowserWorkflowRequest['action']) {
      assert.equal(result.success, true, `${action}: ${JSON.stringify(result)}`);
      const actual = receipt(result, action); assert.equal(actual.status, 'verified');
      assert.ok(actual.postconditions.length && actual.postconditions.every((condition) => condition.matched));
      const taskId = result.structuredOutput?.taskId; assert.equal(typeof taskId, 'string');
      const task = taskService.getTask(taskId as string); assert.equal(task?.status, 'COMPLETED'); assert.equal(task?.verification?.status, 'PASS');
      assert.ok(task);
      const projection = projectTaskEventsV2(task);
      assert.equal(projection.diagnostics.quarantinedEventCount, 0, 'Real producer task events must all be canonical');
      assert.equal(projection.events.filter((event) => event.type === 'task.created').length, 1);
      assert.equal(projection.events.filter((event) => event.type === 'task.completed').length, 1);
      assert.deepEqual(projection.events.map((event) => event.sequence), projection.events.map((_, index) => index + 1), 'Real event sequence must be contiguous');
      assert.equal(new Set(projection.events.map((event) => event.eventId)).size, projection.events.length, 'Real event IDs must be unique');
      const requiredChecks = task.verification!.checks.filter((check) => check.required);
      assert.ok(requiredChecks.length && requiredChecks.every((check) => check.status === 'PASS'));
      evidence.push({ scenario: `actual_${action}`, taskId, receipt: actual,
        taskProjection: { diagnostics: projection.diagnostics, types: projection.events.map((event) => event.type),
          sequence: projection.events.map((event) => event.sequence), eventIds: projection.events.map((event) => event.eventId) }, requiredChecks });
      return actual;
    }
    const request = (action: BrowserWorkflowRequest['action'], extra: Partial<BrowserWorkflowRequest> = {}): BrowserWorkflowRequest => ({ action, verificationGoal: `Verify fixture ${action} postcondition`, ...extra });
    async function run(value: BrowserWorkflowRequest) {
      const response = await api('/api/edith/browser/workflows', 'POST', value);
      return response.body as EdithToolResult;
    }
    const beforeNoEffects = fixtureHits;
    const dry = receipt(await run(request('navigate', { url: fixtureOrigin, dryRun: true })), 'navigate');
    assert.equal(dry.status, 'schema_only'); assert.equal(dry.inputDispatches, 0);
    for (const action of ['download_pdf', 'read_pdf', 'upload_file'] as const) {
      const actual = receipt(await run(request(action, { url: `${fixtureOrigin}/fixture.pdf`, ...(action === 'upload_file' ? { filePath: path.join(process.env.EDITH_TEST_DATA_DIR!, 'fixture.txt') } : {}) })), action);
      assert.equal(actual.status, 'unsupported'); assert.equal(actual.inputDispatches, 0);
    }
    const unknown = await run(request('launch_app' as any)); assert.equal(unknown.errorCode, 'VALIDATION_ERROR');
    const noGrant = await run(request('navigate', { url: fixtureOrigin, approvalGranted: true })); assert.equal(noGrant.success, false); assert.equal(noGrant.errorCode, 'PERMISSION_DENIED');
    const credentials = await run(request('navigate', { url: fixtureOrigin.replace('http://', 'http://private:fixture@') }));
    assert.equal(credentials.success, false); assert.equal(credentials.errorCode, 'VALIDATION_ERROR');
    const unauthorized = await api('/api/edith/browser/workflows', 'POST', request('navigate', { url: fixtureOrigin }), false); assert.equal(unauthorized.status, 401);
    assert.equal(fixtureHits, beforeNoEffects, 'Denied/schema/unsupported requests must not touch the fixture');
    evidence.push({ scenario: 'deny_schema_unsupported_zero_network', fixtureHits });
    await grant();

    let current = verified(await run(request('search', { query: 'owned fixture query' })), 'search');
    assert.ok(current.sessionId && current.pageId);
    let sessionId = current.sessionId!, pageId = current.pageId!;
    const currentOwner = owner;
    const metadata = getBrowserOperatorAdapter().sessions.inspectOwned(sessionId, owner);
    owned.push({ sessionId, owner, pid: metadata.pid });
    assert.ok(metadata.pid > 0);
    const page = () => { const actual = getBrowserOperatorAdapter().sessions.get(sessionId, owner).pages.get(pageId); assert.ok(actual); return actual; };
    const identity = () => ({ sessionId, pageId });
    current = verified(await run(request('navigate', { ...identity(), url: `${fixtureOrigin}/` })), 'navigate');
    assert.equal(current.after?.url, `${fixtureOrigin}/`);
    current = verified(await run(request('title', identity())), 'title');
    assert.equal(current.after?.title, 'Owned browser producer fixture'); assert.equal(current.inputDispatches, 0);
    current = verified(await run(request('extract', { ...identity(), selectors: { text: '#content' } })), 'extract');
    const text = browserWorkflowService.readArtifact(current.artifacts[0].id, owner);
    assert.equal(text.bytes.toString('utf8'), 'Deterministic local text artifact from real Chromium DOM.');
    assert.equal(hash(text.bytes), current.artifacts[0].sha256); assert.equal(text.bytes.length, current.artifacts[0].bytes);
    current = verified(await run(request('screenshot', identity())), 'screenshot');
    const image = browserWorkflowService.readArtifact(current.artifacts[0].id, owner);
    assert.equal(image.mime, 'image/png'); assert.deepEqual([...image.bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(hash(image.bytes), current.artifacts[0].sha256); assert.equal(image.bytes.length, current.artifacts[0].bytes);
    fs.writeFileSync(path.join(reports, 'owned-dom-screenshot.png'), image.bytes);
    const privateValue = 'private-fixture-value-w5';
    current = verified(await run(request('fill_form', { ...identity(), selectors: { name: '#name', city: '#city' }, fieldValues: { name: privateValue, city: 'Istanbul' } })), 'fill_form');
    assert.equal(current.inputDispatches, 2); assert.equal(current.targetIds.length, 2);
    assert.deepEqual(await page().evaluate(() => [document.querySelector<HTMLInputElement>('#name')!.value, document.querySelector<HTMLInputElement>('#city')!.value]), [privateValue, 'Istanbul']);
    const storedText = JSON.stringify({ tasks: taskService.listTasks(), toolRuns: getEdithPersistenceStore().listToolRuns?.(200), timeline: taskService.getTask(String((evidence.at(-1) as any).taskId))?.timeline });
    assert.equal(storedText.includes(privateValue), false, 'Private field values must not enter task or tool-run persistence');
    current = verified(await run(request('scroll', { ...identity(), scrollDeltaY: 400 })), 'scroll');
    assert.equal(current.inputDispatches, 1); assert.ok(current.after!.viewport.scrollY > current.before!.viewport.scrollY);
    current = verified(await run(request('new_tab', { sessionId, url: `${fixtureOrigin}/destination` })), 'new_tab');
    assert.notEqual(current.pageId, pageId); assert.equal(getBrowserOperatorAdapter().sessions.inspectOwned(sessionId, owner).pageIds.length, 2);

    // Exercise all four default canonical handlers, rather than an injected engine.
    for (const [toolId, value] of [
      ['browser_workflow', request('title', identity())],
      ['browser_search', request('search', { ...identity(), query: 'registered fixture query' })],
      ['browser_open', request('navigate', { ...identity(), url: `${fixtureOrigin}/` })],
      ['playwright_browser_agent', request('title', identity())],
    ] as const) {
      const result = await executeEdithTool(toolId, value as unknown as Record<string, unknown>, { actor: owner });
      verified(result, value.action); assert.ok(result.auditEventId); evidence.push({ scenario: 'default_registered_handler', toolId });
    }
    const issuerRequest = request('title', identity());
    const issuerResult = await browserWorkflowService.run(issuerRequest, owner);
    verified(issuerResult, 'title');
    const originalIssuedReceipt = issuerResult.structuredOutput!.browser as BrowserOperatorReceipt;
    const issuerContext = { actor: owner, taskId: String(issuerResult.structuredOutput!.taskId) };
    const issuer = getBrowserOperatorAdapter();
    assert.equal(issuer.verifyIssued(JSON.parse(JSON.stringify(originalIssuedReceipt)), issuerRequest, issuerContext), false, 'JSON receipt copies have no private issuer identity');
    assert.equal(issuer.verifyIssued(originalIssuedReceipt, { ...issuerRequest, verificationGoal: 'A different request' }, issuerContext), false);
    assert.equal(issuer.verifyIssued(originalIssuedReceipt, issuerRequest, { ...issuerContext, actor: 'owner-session-wrong' }), false);
    assert.equal(issuer.verifyIssued(originalIssuedReceipt, issuerRequest, { ...issuerContext, taskId: 'task-wrong' }), false);
    assert.equal(issuer.verifyIssued(originalIssuedReceipt, issuerRequest, issuerContext), false, 'The service-consumed original receipt cannot be reused');
    evidence.push({ scenario: 'private_issuer_copy_mismatch_and_consumed_original_rejected' });

    const redirect = await run(request('navigate', { ...identity(), url: `${fixtureOrigin}/redirect` }));
    assert.equal(redirect.success, false); assert.equal(redirectHits, 1); assert.equal(unsafeTargetHits, 0, 'Redirect must be denied before following the sensitive Location');
    evidence.push({ scenario: 'actual_redirect_response_denied_before_follow', redirectHits, unsafeTargetHits });
    // Supply a real context cookie using a trusted fixture mutation. It must never reach the next endpoint.
    const hitsBeforeCookie = fixtureHits;
    await page().context().addCookies([{ name: 'fixture-session', value: 'private-cookie-value', url: fixtureOrigin }]);
    const cookieNavigate = await run(request('navigate', { ...identity(), url: `${fixtureOrigin}/destination` }));
    assert.equal(cookieNavigate.success, false); assert.equal(fixtureHits, hitsBeforeCookie, 'Cookie-bearing navigation must be stopped before contact');
    await page().context().clearCookies();
    evidence.push({ scenario: 'actual_cookie_context_navigation_zero_contact' });

    async function freshForm() {
      hook = undefined;
      verified(await run(request('navigate', { ...identity(), url: `${fixtureOrigin}/` })), 'navigate');
      assert.equal(await page().evaluate(() => (window as any).fixture.inputEvents), 0);
    }
    function once(phase: 'located' | 'after_input', operation: (actualPage: Page) => Promise<void>) {
      hook = async (at, actualPage) => { if (at !== phase) return; hook = undefined; await operation(actualPage); };
    }
    const form = () => request('fill_form', { ...identity(), selectors: { name: '#name', city: '#city' }, fieldValues: { name: 'fresh fixture value', city: 'second field must not repeat' } });
    for (const mode of ['removed', 'ambiguous', 'semantic', 'document', 'navigation', 'occluded'] as const) {
      await freshForm();
      let navigationFacts: Record<string, unknown> | undefined;
      once('located', async (actualPage) => {
        if (mode === 'document') { await actualPage.setContent(fixtureHtml.toString('utf8')); return; }
        if (mode === 'navigation') {
          const cdp = await actualPage.context().newCDPSession(actualPage);
          const oldHandle = await actualPage.$('#name'); assert.ok(oldHandle);
          try {
            const before = (await cdp.send('Page.getFrameTree')).frameTree.frame;
            await actualPage.goto(`${fixtureOrigin}/destination`, { waitUntil: 'domcontentloaded' });
            const after = (await cdp.send('Page.getFrameTree')).frameTree.frame;
            let oldHandleInvalidated = false;
            try { oldHandleInvalidated = !(await oldHandle.evaluate((node) => node.isConnected)); }
            catch { oldHandleInvalidated = true; }
            assert.notEqual(before.loaderId, after.loaderId, 'Real navigation must establish a new CDP loader');
            assert.equal(before.id, after.id, 'The same top-level frame changed its document');
            assert.equal(actualPage.url(), `${fixtureOrigin}/destination`);
            assert.equal(oldHandleInvalidated, true, 'Old actual ElementHandle must lose authority after navigation');
            navigationFacts = { beforeLoaderId: before.loaderId, afterLoaderId: after.loaderId, frameId: after.id,
              finalUrl: actualPage.url(), oldHandleInvalidated };
          } finally { await oldHandle.dispose().catch(() => {}); await cdp.detach(); }
          return;
        }
        await actualPage.evaluate((kind) => {
          const input = document.querySelector<HTMLInputElement>('#name')!;
          if (kind === 'removed') input.remove();
          if (kind === 'ambiguous') input.after(input.cloneNode(true));
          if (kind === 'semantic') input.setAttribute('aria-label', 'Different semantic target');
          if (kind === 'occluded') document.querySelector<HTMLElement>('#overlay')!.style.display = 'block';
        }, mode);
      });
      const result = await run(form()); assert.equal(result.success, false, mode);
      const actual = receipt(result, 'fill_form'); assert.equal(actual.inputDispatches, 0, mode);
      assert.equal(await page().evaluate(() => (window as any).fixture.inputEvents), 0, mode);
      if (mode === 'navigation') assert.ok(navigationFacts);
      evidence.push({ scenario: `stale_${mode}_zero_input`, receipt: actual, ...(navigationFacts ? { navigationFacts } : {}) });
    }
    await freshForm();
    once('located', async (actualPage) => actualPage.evaluate(() => {
      (window as any).__edithBrowser = { documentId: 'forged-page-global-document', version: 999, nextNode: 1, nodes: new WeakMap() };
    }));
    const markerResult = await run(form());
    const markerReceipt = receipt(markerResult, 'fill_form');
    assert.equal(markerReceipt.nativePhysicalProof, false);
    if (markerResult.success) {
      assert.equal(markerReceipt.status, 'verified'); assert.equal(markerReceipt.inputDispatches, 2);
      assert.equal(markerReceipt.before!.documentId, markerReceipt.after!.documentId);
      assert.notEqual(markerReceipt.after!.documentId, 'forged-page-global-document', 'Private real root identity must dominate page-global claims');
      assert.equal(await page().evaluate(() => (window as any).fixture.inputEvents), 2);
    } else {
      assert.equal(markerReceipt.inputDispatches, 0); assert.equal(await page().evaluate(() => (window as any).fixture.inputEvents), 0);
    }
    evidence.push({ scenario: 'forged_page_global_marker_is_not_root_authority', outcome: markerReceipt.status,
      sameActualRootAllowed: markerResult.success, receipt: markerReceipt });
    await freshForm();
    const realmRequest = form();
    once('located', async (actualPage) => actualPage.evaluate((expected) => {
      Object.defineProperty(HTMLInputElement.prototype, 'value', {
        configurable: true,
        get() { return this.id === 'name' ? expected.name : this.id === 'city' ? expected.city : ''; },
        set(_value) { /* Main-world adversary deliberately prevents the real value effect. */ },
      });
    }, realmRequest.fieldValues!));
    const realmResult = await run(realmRequest);
    const realmReceipt = receipt(realmResult, 'fill_form');
    const realNativeValues = await page().evaluate(() => ({
      name: (window as any).fixture.nativeValue('name') as string,
      city: (window as any).fixture.nativeValue('city') as string,
      inputEvents: (window as any).fixture.inputEvents as number,
    }));
    const realValuesMatched = realNativeValues.name === realmRequest.fieldValues!.name && realNativeValues.city === realmRequest.fieldValues!.city;
    evidence.push({ scenario: 'main_world_patched_value_accessors_real_native_readback', rootRealmPatching: true,
      producerStatus: realmReceipt.status, producerSuccess: realmResult.success, inputDispatches: realmReceipt.inputDispatches,
      inputEvents: realNativeValues.inputEvents, realValuesMatched,
      realNativeValueFingerprints: { name: hash(realNativeValues.name), city: hash(realNativeValues.city) },
      expectedValueFingerprints: { name: hash(realmRequest.fieldValues!.name), city: hash(realmRequest.fieldValues!.city) }, receipt: realmReceipt });
    if (realmResult.success) {
      assert.equal(realValuesMatched, true, 'A verified producer receipt must match retained real native getters, not patched main-world accessors');
      verified(realmResult, 'fill_form');
    } else {
      assert.notEqual(taskService.getTask(String(realmResult.structuredOutput?.taskId))?.verification?.status, 'PASS');
    }
    // A normal navigation creates a fresh realm before subsequent fixtures.
    for (const mode of ['replacement', 'layout'] as const) {
      await freshForm();
      once('located', async (actualPage) => actualPage.evaluate((kind) => {
        const input = document.querySelector<HTMLInputElement>('#name')!;
        if (kind === 'replacement') input.replaceWith(input.cloneNode(true));
        else input.style.marginLeft = '20px';
      }, mode));
      const actual = verified(await run(form()), 'fill_form'); assert.equal(actual.resolveAttempts, 2);
      assert.equal(actual.inputDispatches, 2); assert.equal(await page().evaluate(() => (window as any).fixture.inputEvents), 2);
      evidence.push({ scenario: `${mode}_one_fresh_resolve`, receipt: actual });
    }
    await freshForm();
    once('located', async (actualPage) => actualPage.evaluate(() => {
      document.querySelector('#city')!.addEventListener('input', () => {
        document.querySelector<HTMLInputElement>('#name')!.value = 'earlier-field-corrupted-by-second-input';
      });
    }));
    const laterCorruption = await run(form()); assert.equal(laterCorruption.success, false);
    const laterReceipt = receipt(laterCorruption, 'fill_form'); assert.equal(laterReceipt.status, 'partial');
    assert.equal(laterReceipt.reasonCode, 'READBACK_MISMATCH'); assert.equal(laterReceipt.inputDispatches, 2);
    assert.equal(await page().evaluate(() => (window as any).fixture.inputEvents), 2);
    assert.equal(await page().locator('#name').inputValue(), 'earlier-field-corrupted-by-second-input');
    assert.equal(taskService.getTask(String(laterCorruption.structuredOutput?.taskId))?.status, 'BLOCKED');
    assert.notEqual(taskService.getTask(String(laterCorruption.structuredOutput?.taskId))?.verification?.status, 'PASS');
    evidence.push({ scenario: 'second_input_corrupts_earlier_field_final_readback_partial_no_retry', receipt: laterReceipt });
    await freshForm();
    once('located', async (actualPage) => actualPage.evaluate(() => { (window as any).fixture.wrongReadback = true; }));
    const mismatch = await run(form()); assert.equal(mismatch.success, false);
    const mismatchReceipt = receipt(mismatch, 'fill_form'); assert.equal(mismatchReceipt.status, 'partial'); assert.equal(mismatchReceipt.reasonCode, 'READBACK_MISMATCH');
    assert.equal(mismatchReceipt.inputDispatches, 1); assert.equal(await page().evaluate(() => (window as any).fixture.inputEvents), 1);
    assert.equal(await page().locator('#city').inputValue(), '');
    evidence.push({ scenario: 'partial_mismatch_no_second_input_no_repeat', receipt: mismatchReceipt });
    const mismatchTaskId = String(mismatch.structuredOutput?.taskId);
    assert.equal(taskService.getTask(mismatchTaskId)?.status, 'BLOCKED');
    const mismatchTaskBefore = JSON.stringify(taskService.getTask(mismatchTaskId));
    const mismatchReverify = verificationService.verifyTask(mismatchTaskId);
    assert.equal(mismatchReverify.status, 'RETRYABLE'); assert.notEqual(mismatchReverify.verification?.status, 'PASS');
    assert.equal(JSON.stringify(taskService.getTask(mismatchTaskId)), mismatchTaskBefore, 'Generic verification must preserve the entire BLOCKED browser task, checks and timeline');
    const historicalTaskId = String(evidence.find((row) => row.scenario === 'actual_search')?.taskId);
    assert.equal(taskService.getTask(historicalTaskId)?.status, 'COMPLETED');
    const historicalTaskBefore = JSON.stringify(taskService.getTask(historicalTaskId));
    const historicalReverify = verificationService.verifyTask(historicalTaskId);
    assert.equal(historicalReverify.status, 'RETRYABLE'); assert.notEqual(historicalReverify.verification?.status, 'PASS');
    assert.equal(JSON.stringify(taskService.getTask(historicalTaskId)), historicalTaskBefore, 'Generic verification must preserve historical verified browser evidence without inventing a fresh PASS');
    evidence.push({ scenario: 'generic_verifier_browser_denial_readonly', mismatchTaskId, historicalTaskId,
      mismatchStatus: mismatchReverify.status, historicalStatus: historicalReverify.status, entirePersistedTasksUnchanged: true });

    await freshForm();
    const blockedTask = taskService.createTask({ title: 'Provided blocked browser task', objective: 'Keep blocked state', originalUserRequest: 'Keep blocked state', toolsRequired: ['playwright_browser_agent'], permissionsRequired: ['browser:control'], riskLevel: 4 });
    taskService.updateStatus(blockedTask.id, 'BLOCKED');
    const blocked = await browserWorkflowService.run(form(), owner, { taskId: blockedTask.id });
    assert.equal(blocked.success, false); assert.equal(taskService.getTask(blockedTask.id)?.status, 'BLOCKED');
    assert.equal(await page().evaluate(() => (window as any).fixture.inputEvents), 0);
    let cancelledTaskId: string | undefined;
    let cancellationSnapshot: { inputEvents: number; city: string } | undefined;
    once('after_input', async (actualPage) => {
      cancellationSnapshot = await actualPage.evaluate(() => ({ inputEvents: (window as any).fixture.inputEvents, city: document.querySelector<HTMLInputElement>('#city')!.value }));
      const actualTask = taskService.listTasks().find((task) => task.status === 'RUNNING' && task.title === 'Browser fill_form');
      assert.ok(actualTask, 'Cancellation must target the actual service-created RUNNING task');
      cancelledTaskId = actualTask.id; taskService.updateStatus(actualTask.id, 'CANCELLED');
    });
    const cancelled = await run(form());
    assert.ok(cancelledTaskId); assert.equal(cancelled.structuredOutput?.taskId, cancelledTaskId);
    assert.equal(cancelled.success, false); assert.equal(taskService.getTask(cancelledTaskId)?.status, 'CANCELLED');
    const cancellationReceipt = receipt(cancelled, 'fill_form'); assert.equal(cancellationReceipt.inputDispatches, 1);
    assert.deepEqual(cancellationSnapshot, { inputEvents: 1, city: '' });
    evidence.push({ scenario: 'real_task_cancelled_after_first_input', taskId: cancelledTaskId, receipt: cancellationReceipt });

    async function closedProcess(id: string, binding: string) {
      const started = Date.now();
      while (Date.now() - started < 15_000) {
        const actual = getBrowserOperatorAdapter().sessions.closureEvidence(id, binding);
        if (actual?.processExited) { evidence.push({ scenario: 'owned_pid_exited', closure: actual }); return; }
        await delay(50);
      }
      assert.fail(`Owned Chromium did not confirm process exit for session ${id}`);
    }
    // Cancellation may close the session as a safety response; use a fresh session for grant revocation.
    await browserWorkflowService.closeSession(sessionId, owner).catch(() => {}); await closedProcess(sessionId, owner);
    async function openFresh() {
      const actual = verified(await run(request('navigate', { url: `${fixtureOrigin}/` })), 'navigate'); sessionId = actual.sessionId!; pageId = actual.pageId!;
      const metadata = getBrowserOperatorAdapter().sessions.inspectOwned(sessionId, owner); owned.push({ sessionId, owner, pid: metadata.pid });
    }
    await openFresh();
    let pausedTaskId: string | undefined;
    let pauseSnapshot: { inputEvents: number; city: string } | undefined;
    once('after_input', async (actualPage) => {
      pauseSnapshot = await actualPage.evaluate(() => ({ inputEvents: (window as any).fixture.inputEvents, city: document.querySelector<HTMLInputElement>('#city')!.value }));
      const actualTask = taskService.listTasks().find((task) => task.status === 'RUNNING' && task.title === 'Browser fill_form');
      assert.ok(actualTask); pausedTaskId = actualTask.id; taskService.updateStatus(actualTask.id, 'BLOCKED');
    });
    const paused = await run(form()); assert.ok(pausedTaskId);
    assert.equal(paused.success, false); assert.equal(paused.structuredOutput?.taskId, pausedTaskId);
    assert.equal(taskService.getTask(pausedTaskId)?.status, 'BLOCKED');
    assert.equal(receipt(paused, 'fill_form').inputDispatches, 1); assert.deepEqual(pauseSnapshot, { inputEvents: 1, city: '' });
    evidence.push({ scenario: 'real_task_paused_after_first_input_no_second_input', taskId: pausedTaskId, receipt: receipt(paused, 'fill_form') });
    await browserWorkflowService.closeSession(sessionId, owner).catch(() => {}); await closedProcess(sessionId, owner);
    // Exact tool-scoped grants must survive the default registered route into its matching leaf.
    let response = await api(`/api/edith/permissions/grants/${grantId}`, 'DELETE'); assert.equal(response.status, 200);
    const scopedRequest = (toolId: string) => toolId === 'browser_search'
      ? request('search', { query: 'single tool scoped fixture query' })
      : request(toolId === 'browser_open' ? 'navigate' : 'title', { url: `${fixtureOrigin}/` });
    for (const [index, toolId] of browserToolIds.entries()) {
      await grant([toolId]);
      const value = scopedRequest(toolId);
      const scoped = await executeEdithTool(toolId, value as unknown as Record<string, unknown>, { actor: owner });
      const actual = verified(scoped, value.action);
      const actualTaskId = String(scoped.structuredOutput?.taskId);
      assert.deepEqual(taskService.getTask(actualTaskId)?.toolsRequired, [toolId], 'The producer task must bind the exact requested canonical tool ID');
      const audits = readRecentAuditEvents(200).filter((event) => event.taskId === actualTaskId && event.action === 'tool.execute');
      assert.equal(audits.length, 1, 'One default registered attempt must emit exactly one execution audit');
      assert.equal(audits[0].toolId, toolId); assert.equal(audits[0].result, 'success');
      const metadata = getBrowserOperatorAdapter().sessions.inspectOwned(actual.sessionId!, owner);
      owned.push({ sessionId: actual.sessionId!, owner, pid: metadata.pid });
      const otherToolId = browserToolIds[(index + 1) % browserToolIds.length];
      const beforeDeniedHits = fixtureHits;
      const otherRequest = scopedRequest(otherToolId);
      const denied = await executeEdithTool(otherToolId, otherRequest as unknown as Record<string, unknown>, { actor: owner });
      assert.equal(denied.success, false); assert.equal(denied.errorCode, 'PERMISSION_DENIED');
      assert.equal(fixtureHits, beforeDeniedHits, 'A grant for another tool ID must not permit any network contact');
      const actualPage = getBrowserOperatorAdapter().sessions.get(actual.sessionId!, owner).pages.get(actual.pageId!); assert.ok(actualPage);
      assert.equal(await actualPage.evaluate(() => (window as any).fixture.inputEvents), 0, 'Denied unmatched tool must not dispatch input');
      evidence.push({ scenario: 'default_registered_exact_tool_scoped_grant', toolId, deniedToolId: otherToolId, actualTaskId,
        auditCount: audits.length, auditToolId: audits[0].toolId, deniedContactDelta: fixtureHits - beforeDeniedHits });
      await browserWorkflowService.closeSession(actual.sessionId!, owner); await closedProcess(actual.sessionId!, owner);
      response = await api(`/api/edith/permissions/grants/${grantId}`, 'DELETE'); assert.equal(response.status, 200);
    }
    await grant(); await openFresh();
    once('located', async () => { const response = await api(`/api/edith/permissions/grants/${grantId}`, 'DELETE'); assert.equal(response.status, 200); });
    const revoked = await run(form()); assert.equal(revoked.success, false); assert.equal(receipt(revoked, 'fill_form').inputDispatches, 0);
    await closedProcess(sessionId, owner); evidence.push({ scenario: 'protected_grant_revoked_before_input' });
    await grant(); await openFresh();
    once('located', async () => { const response = await api('/api/security/session', 'DELETE'); assert.equal(response.status, 200); });
    const logout = await run(form()); assert.equal(logout.success, false);
    await closedProcess(sessionId, owner); evidence.push({ scenario: 'actual_owner_logout_closes_owned_pid' });
    await login(); await grant(); await openFresh();
    const killSession = sessionId, killOwner = owner;
    once('located', async () => { killSwitchService.activate('Owned browser fixture emergency stop', 'owner'); });
    const killed = await run(form()); assert.equal(killed.success, false);
    await closedProcess(killSession, killOwner); evidence.push({ scenario: 'actual_kill_closes_owned_pid' });
    killSwitchService.deactivate('owner');
    // Kill closes/disposes the adapter; reset only through the explicitly test-gated constructor config.
    await setBrowserOperatorTestOptions(options());
    await login(60_000); await grant(); await openFresh();
    const expirySession = sessionId, expiryOwner = owner;
    console.log('Browser acceptance: waiting for actual 60-second owner expiry; no clock substitution.');
    while (Date.now() <= expiresAt + 150) await delay(Math.min(20_000, Math.max(1, expiresAt + 151 - Date.now())));
    const expired = await browserWorkflowService.run(request('title', identity()), expiryOwner);
    assert.equal(expired.success, false); await closedProcess(expirySession, expiryOwner);
    evidence.push({ scenario: 'actual_owner_expiry_closes_owned_pid', expiresAt });
    assert.equal(currentOwner.startsWith('owner-session-'), true);
    fs.writeFileSync(path.join(reports, 'evidence.json'), JSON.stringify({ runtime: 'actual_owned_headed_chromium', nativePhysicalProof: false, fixtureHits, owned, evidence }, null, 2));
    console.log(JSON.stringify({ success: true, actualHeaded: true, nativePhysicalProof: false, checks: evidence.length, fixtureHits, report: path.join(reports, 'evidence.json') }));
  } finally {
    hook = undefined;
    fs.writeFileSync(path.join(reports, 'attempt-evidence.json'), JSON.stringify({ runtime: 'actual_owned_headed_chromium', nativePhysicalProof: false, fixtureHits, unsafeTargetHits, redirectHits, owned, evidence, recordedAt: new Date().toISOString() }, null, 2));
    try { await getBrowserOperatorAdapter().closeAll(); }
    finally {
      await closeServer(apiServer); await closeServer(fixtureServer);
      delete process.env.EDITH_OWNER_TOKEN; delete process.env.EDITH_OWNER_TOKEN_ONE_TIME; delete process.env.EDITH_OWNER_SESSION_TTL_MS;
      fs.writeFileSync(path.join(reports, 'cleanup.json'), JSON.stringify({ ownServerClosed: !apiServer?.listening && !fixtureServer?.listening, owned, completedAt: new Date().toISOString() }, null, 2));
    }
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
