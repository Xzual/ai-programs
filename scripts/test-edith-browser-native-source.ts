import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import { createHash, randomUUID } from 'node:crypto';
import type { Page } from 'playwright';
import { parseBrowserOperatorReceipt, parseBrowserWorkflowRequest, type ParsedBrowserWorkflowRequest } from '../src/edith/browserOperatorContract';
import type { BrowserOwnerCap } from '../server/browser/browserPrivateContract';
import type { NativeBootRef, AttemptRef, BrowserNativeSourceHandle, NativeSourceTargetCap, BackendConsumedEnterCommandRef, BackendConsumedCommandRef, DispatchRef } from '../server/browser/browserNativePrivateContract';
import type { OwnedBrowserLaunchCap, OwnedEngineInventoryCap } from '../server/browser/browserSessionStore';

const fixtureDirectory = path.resolve('artifacts/repair-20261006/chat5/w5-native-source-producer/tests-source');
const repairDirectory = path.resolve('artifacts/repair-20261006/chat5/w5-observed-outcome-source');
const reports = process.env.W5_NATIVE_SOURCE_REPORT_DIR ?? path.join(repairDirectory, 'tests', 'runtime');
const evidence: Array<Record<string, unknown>> = [];
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const proofScope = 'simulatednativeproducer / DOM_ONLY_NOT_PHYSICAL';
async function listen(server: http.Server) {
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address(); assert.ok(address && typeof address === 'object'); return `http://127.0.0.1:${address.port}`;
}
async function close(server: http.Server | undefined) {
  if (!server?.listening) return;
  server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
function strict(request: unknown): Readonly<ParsedBrowserWorkflowRequest> {
  const parsed = parseBrowserWorkflowRequest(request); assert.equal(parsed.success, true);
  if (!parsed.success) throw new Error('Fixture request must use strict B0 syntax');
  if (parsed.value.selectors) Object.freeze(parsed.value.selectors);
  if (parsed.value.fieldValues) Object.freeze(parsed.value.fieldValues);
  return Object.freeze(parsed.value);
}

async function main() {
  assert.equal(process.env.EDITH_TEST_MODE, 'true'); assert.ok(process.env.EDITH_TEST_DATA_DIR);
  assert.notEqual(path.resolve(process.env.EDITH_TEST_DATA_DIR), path.resolve('.edith'), 'Use only isolated persistence');
  assert.ok([repairDirectory].some(root => { const relative = path.relative(root, path.resolve(reports)); return !relative.startsWith('..') && !path.isAbsolute(relative); }), 'Reports must remain in the observed-outcome branch');
  fs.mkdirSync(reports, { recursive: true });
  const { browserWorkflowService: service } = await import('../src/edith/browserWorkflowService');
  const { BrowserOperatorAdapter, getBrowserOperatorAdapter, setBrowserOperatorTestOptions } = await import('../src/edith/browserOperatorAdapter');
  const { createOwnerSessionRouter, getSoleActiveOwnerSession, requireProtectedMutation } = await import('../server/security/ownerSession');
  const { createPermissionsRouter } = await import('../server/routes/permissions');
  const { taskService } = await import('../src/edith/taskService');
  const { readRecentAuditEvents } = await import('../src/edith/audit');
  let apiServer: http.Server | undefined, fixtureServer: http.Server | undefined;
  let cookie = '', csrf = '', binding = '', ownerCap: BrowserOwnerCap | undefined, hits = 0;
  const contacts: Array<{ method: string; path: string }> = [];
  const credential = randomUUID(); process.env.EDITH_OWNER_TOKEN = credential; process.env.EDITH_OWNER_TOKEN_ONE_TIME = 'false';
  const app = express(); app.use(express.json({ limit: '8kb' })); app.use(createOwnerSessionRouter()); app.use(createPermissionsRouter());
  app.post('/test/source/owner', ...requireProtectedMutation, (req, res) => {
    ownerCap = service.captureOwner(req); res.json({ success: true });
  });
  const inventories: OwnedEngineInventoryCap[] = [];
  const sessions: Array<{ id: string; owner: string; pid: number }> = [];
  let adapter: ReturnType<typeof getBrowserOperatorAdapter> | undefined; let queryForeignTarget: NativeSourceTargetCap | undefined;
  const nativeConstructorAcks: Array<{ sessionId: string; acknowledgedAtMs: number; pageCountAtCreation: number; pid: number }> = [];
  try {
    const html = fs.readFileSync(path.join(fixtureDirectory, 'fixture.html'));
    fixtureServer = http.createServer((req, res) => {
      hits++; const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      contacts.push({ method: req.method ?? '', path: url.pathname });
      if (!['/fixture', '/results', '/result'].includes(url.pathname)) { res.writeHead(404).end(); return; }
      let content = html.toString(); const variant = url.searchParams.get('q');
      const unsafeMarkup: Record<string, string> = {
        'profile-inline-script': '<script>window.__profileScriptExecuted=true;fetch("/forbidden-script",{method:"POST"});document.querySelector("form").submit()</script>',
        'profile-button-handler': '<button onclick="fetch(\'/forbidden-handler\',{method:\'POST\'})">Other submitter</button>',
        'profile-worker': '<script>new Worker("/forbidden-worker");navigator.serviceWorker.register("/forbidden-service-worker")</script>',
        'profile-frame': '<iframe src="/forbidden-frame"></iframe>',
        'profile-meta-refresh': '<meta http-equiv="refresh" content="0;url=/forbidden-refresh">',
        'profile-submit-override': '<button formaction="/forbidden-override" formmethod="post">Override</button>',
        'profile-extra-control': '<input name="unexpected" value="extra">',
        'profile-hidden-control': '<input name="unexpected" type="hidden" value="extra">',
      };
      if (variant && unsafeMarkup[variant]) content = content.replace('</form>', `${unsafeMarkup[variant]}</form>`);
      if (variant === 'profile-post') content = content.replace('method="get"', 'method="post"');
      if (variant === 'profile-ping') content = content.replace('href="/result"', 'href="/result" ping="/forbidden-ping"');
      if (variant === 'profile-download') content = content.replace('href="/result"', 'href="/result" download');
      if (variant === 'profile-base-target') content = content.replace('</head>', '<base target="_blank"></head>');
      if (variant === 'profile-blank-target') content = content.replace('method="get"', 'method="get" target="_blank"');
      if (variant === 'profile-input-override') content = content.replace('autocomplete="off"', 'autocomplete="off" formaction="/forbidden-override" formmethod="post" formtarget="_blank" formnovalidate');
      if (variant === 'profile-autofocus') content = content.replace('autocomplete="off"', 'autocomplete="off" autofocus');
      if (variant === 'profile-dirname') content = content.replace('autocomplete="off"', 'autocomplete="off" dirname="direction"');
      if (variant === 'profile-maxlength') content = content.replace('autocomplete="off"', 'autocomplete="off" maxlength="2"');
      if (variant === 'profile-minlength') content = content.replace('autocomplete="off"', 'autocomplete="off" minlength="300"');
      if (variant === 'profile-pattern') content = content.replace('autocomplete="off"', 'autocomplete="off" pattern="[0-9]+"');
      if (variant === 'profile-accept-charset') content = content.replace('method="get"', 'method="get" accept-charset="windows-1254"');
      const headers: Record<string, string> = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' };
      if (variant === 'profile-http-refresh') headers.refresh = '0;url=/forbidden-refresh';
      res.writeHead(200, headers); res.end(content);
    });
    const origin = await listen(fixtureServer); apiServer = http.createServer(app); const apiOrigin = await listen(apiServer);
    async function api(endpoint: string, method: string, body?: unknown) {
      const response = await fetch(`${apiOrigin}${endpoint}`, { method, headers: { origin: apiOrigin, cookie, 'x-edith-csrf-token': csrf,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
      return { status: response.status, body: await response.json() as any };
    }
    const login = await fetch(`${apiOrigin}/api/security/session`, { method: 'POST', headers: { origin: apiOrigin, authorization: `Bearer ${credential}` }, signal: AbortSignal.timeout(10_000) });
    assert.equal(login.status, 201); const loginBody = await login.json() as any;
    cookie = login.headers.get('set-cookie')!.split(';')[0]; csrf = loginBody.session.csrfToken;
    const actualOwner = getSoleActiveOwnerSession(); assert.ok(actualOwner); binding = actualOwner.bindingId;
    const ownerResponse = await api('/test/source/owner', 'POST'); assert.equal(ownerResponse.status, 200); assert.ok(ownerCap);
    const grant = await api('/api/edith/permissions/grants', 'POST', { permissions: ['network:read', 'browser:control'],
      toolIds: ['browser_workflow', 'browser_open', 'browser_search', 'playwright_browser_agent'], ttlMs: 600_000, reason: 'Owned isolated DOM source fixture' });
    assert.equal(grant.status, 200);
    await setBrowserOperatorTestOptions({ fixtureOrigins: [origin], searchUrl: (query) => `${origin}/results?q=${encodeURIComponent(query)}` });
    adapter = getBrowserOperatorAdapter(); assert.equal(adapter.availability().available, true);
    const actualNativeCreate = adapter.sessions.createNative.bind(adapter.sessions);
    adapter.sessions.createNative = async (...args) => {
      const session = await actualNativeCreate(...args), policy = adapter!.sessions.inspectNativeContext(session);
      assert.equal(policy.javaScriptEnabled, false); assert.equal(policy.serviceWorkers, 'block'); assert.equal(policy.acceptDownloads, false);
      assert.equal(policy.context, session.context); assert.equal(policy.process, session.browserServer.process());
      assert.equal(session.context.pages().length, 0, 'Native policy acknowledgement precedes even the first owned Page');
      assert.ok(policy.acknowledgedAtMs <= Date.now());
      assert.ok(policy.process.pid);
      nativeConstructorAcks.push({ sessionId: session.id, acknowledgedAtMs: policy.acknowledgedAtMs, pageCountAtCreation: 0, pid: policy.process.pid });
      return session;
    };
    const engine = adapter.nativeSources;
    assert.equal(typeof adapter.captureNativeRetainedSource, 'function', 'Actual source engine must be integrated; no fake fallback');
    async function fresh() {
      const result = await service.run({ action: 'navigate', url: `${origin}/fixture`, verificationGoal: 'Verify owned local source fixture' }, binding);
      assert.equal(result.success, true); const parsed = parseBrowserOperatorReceipt(result.structuredOutput?.browser); assert.equal(parsed.success, true);
      if (!parsed.success) throw new Error('Actual DOM bootstrap receipt required');
      assert.equal(parsed.value.status, 'verified'); assert.equal(parsed.value.nativePhysicalProof, false);
      const session = adapter!.sessions.get(parsed.value.sessionId!, binding), page = session.pages.get(parsed.value.pageId!); assert.ok(page);
      const metadata = adapter!.sessions.inspectOwned(session.id, binding); sessions.push({ id: session.id, owner: binding, pid: metadata.pid });
      // Native-source assertions never publish a native Task or settle this bootstrap DOM Task again.
      const taskId = result.structuredOutput?.taskId; assert.equal(typeof taskId, 'string');
      return { session, page, pageId: parsed.value.pageId!, taskId: taskId as string };
    }
    function readonlyState() { return { tasks: JSON.stringify(taskService.listTasks()), audits: readRecentAuditEvents(200).map((event) => event.id), hits }; }
    async function denied(work: () => unknown | Promise<unknown>, scenario: string) {
      const before = readonlyState(); let rejected = false;
      try { const result = await work(); rejected = result === false; } catch { rejected = true; }
      assert.equal(rejected, true, scenario); assert.deepEqual(readonlyState(), before, `${scenario}: no Task/audit/HTTP effects`);
      evidence.push({ scenario, denied: true, noTaskAuditOrHttpEffect: true, proofScope, nativePhysicalProof: false });
    }
    function requestFor(current: Awaited<ReturnType<typeof fresh>>, action: string, extra: Record<string, unknown> = {}) {
      return strict({ action, sessionId: current.session.id, pageId: current.pageId, verificationGoal: `Verify owned ${action} DOM predicate`, ...extra });
    }
    async function capture(current: Awaited<ReturnType<typeof fresh>>, request: Readonly<ParsedBrowserWorkflowRequest>, deadline = Date.now() + 20_000) {
      let currentGuard = true;
      // Server-only opaque fixtures exercise source lifecycle. They are not native issuer membership or physical proof.
      const boot = Object.freeze(Object.create(null)) as NativeBootRef, attempt = Object.freeze(Object.create(null)) as AttemptRef;
      const source = await adapter!.captureNativeRetainedSource(Object.freeze(Object.assign(Object.create(null), { owner: ownerCap!, sessionId: current.session.id, pageId: current.pageId,
        context: Object.freeze(Object.assign(Object.create(null), { actor: binding, taskId: current.taskId })), request, deadline, nativeBootRef: boot, attemptRef: attempt,
        guard: () => { if (!currentGuard) throw new Error('PERMISSION_DENIED'); } })));
      return { source, loseGuard: () => { currentGuard = false; } };
    }
    async function cleanup(current: Awaited<ReturnType<typeof fresh>>) { await service.closeSession(current.session.id, binding).catch(() => {}); }

    for (const options of [{}, { fixtureOrigins: [origin], searchUrl: (_query: string) => 'https://unsupported.invalid/results' }]) {
      const blocked = new BrowserOperatorAdapter(options); let createCalls = 0; const originalCreate = blocked.sessions.create;
      const originalNativeCreate = blocked.sessions.createNative;
      blocked.sessions.create = async () => { createCalls++; throw new Error('SOURCE_TEST_UNSUPPORTED_CREATE_FORBIDDEN'); };
      blocked.sessions.createNative = async () => { createCalls++; throw new Error('SOURCE_TEST_UNSUPPORTED_NATIVE_CREATE_FORBIDDEN'); };
      try {
        await denied(() => blocked.captureNativeOriginalSource({ owner: ownerCap!, context: { actor: binding, taskId: 'fixture-unsupported-query' },
          request: strict({ action: 'search', query: 'Original unsupported source', verificationGoal: 'Observe original source' }),
          deadline: Date.now() + 10000, nativeBootRef: Object.freeze(Object.create(null)) as NativeBootRef,
          attemptRef: Object.freeze(Object.create(null)) as AttemptRef, guard: () => {} }), 'unsupported_query_source_denied_before_create');
        assert.equal(createCalls, 0, 'Missing fixture profile or foreign landing cannot launch/create a browser');
      } finally { blocked.sessions.create = originalCreate; blocked.sessions.createNative = originalNativeCreate; await blocked.closeAll(); }
    }
    // Actual hostile HTML reaches only its approved initial GET. Disabled page scripts and
    // the pre-transmission fence must prevent every attempted extra effect from first navigation.
    for (const query of ['profile-inline-script', 'profile-button-handler', 'profile-worker', 'profile-frame',
      'profile-meta-refresh', 'profile-http-refresh', 'profile-submit-override', 'profile-extra-control', 'profile-hidden-control',
      'profile-post', 'profile-base-target', 'profile-blank-target', 'profile-input-override', 'profile-autofocus', 'profile-ping', 'profile-download',
      'profile-dirname', 'profile-maxlength', 'profile-minlength', 'profile-pattern', 'profile-accept-charset']) {
      const request = strict({ action: 'search', query, verificationGoal: 'Observe original bounded static GET profile' });
      const priorContacts = contacts.length, beforeTasks = taskService.listTasks().length;
      let rejected = false;
      try {
        const source = await adapter.captureNativeOriginalSource({ owner: ownerCap!, context: { actor: binding, taskId: `fixture-${query}` }, request,
          deadline: Date.now() + 10000, nativeBootRef: Object.freeze(Object.create(null)) as NativeBootRef,
          attemptRef: Object.freeze(Object.create(null)) as AttemptRef, guard: () => {} });
        await engine.disposeSource(source);
      } catch { rejected = true; }
      await delay(30); const actual = contacts.slice(priorContacts);
      evidence.push({ scenario: `first_navigation_${query}_attempt`, rejected, actualContacts: actual, sourceProfileOnly: true,
        trustedFactoryFixtureNotOwnerAuthentication: true, proofScope, nativePhysicalProof: false });
      assert.equal(rejected, true, `${query}: unsafe native profile must be denied`);
      assert.ok(actual.every(contact => contact.method === 'GET' && contact.path === '/results'), `${query}: no extra requests may reach fixture`);
      assert.equal(taskService.listTasks().length, beforeTasks);
    }
    // Query-only acquisition navigates a NEW owned Page, preserves original B0 intent and creates no Task/audit.
    {
      const original = taskService.createTask({ title: 'Original query-only source fixture', objective: 'Original owned query only',
        originalUserRequest: 'Original owned query only', toolsRequired: ['browser_search'], permissionsRequired: ['network:read', 'browser:control'], riskLevel: 4 });
      taskService.updateStatus(original.id, 'RUNNING');
      const request = strict({ action: 'search', query: 'Original query-only source intent', verificationGoal: 'Observe the original owned local results predicate' });
      const nativeBootRef = Object.freeze(Object.create(null)) as NativeBootRef, attemptRef = Object.freeze(Object.create(null)) as AttemptRef;
      let valid = true; const guard = () => { assert.equal(valid, true); assert.equal(taskService.getTask(original.id)?.status, 'RUNNING'); };
      const args = Object.freeze({ owner: ownerCap!, context: Object.freeze({ actor: binding, taskId: original.id }), request,
        deadline: Date.now() + 20000, nativeBootRef, attemptRef, guard });
      const taskCount = taskService.listTasks().length, auditIds = readRecentAuditEvents(200).map(event => event.id), priorHits = hits;
      const source = await adapter.captureNativeOriginalSource(args);
      const facts = engine.inspectSource(source), identity = engine.inspectSourceIdentity(source), held = engine.inspectHeldSource(source);
      assert.equal(taskService.listTasks().length, taskCount); assert.deepEqual(readRecentAuditEvents(200).map(event => event.id), auditIds);
      assert.deepEqual(facts.request, request); assert.equal(facts.requestHash, sha(JSON.stringify(request)));
      assert.equal('sessionId' in facts.request, false); assert.equal('pageId' in facts.request, false);
      assert.equal(facts.context.taskId, original.id); assert.equal(facts.context.actor, binding);
      assert.equal(identity.owner, ownerCap); assert.equal(identity.attemptRef, attemptRef); assert.equal(identity.nativeBootRef, nativeBootRef);
      assert.equal(held.launch.page, adapter.sessions.get(facts.sessionId, binding).pages.get(facts.pageId));
      assert.equal(held.launch.page.context(), held.launch.context); assert.equal(new URL(held.launch.page.url()).searchParams.get('q'), request.query);
      const nativeSession = adapter.sessions.get(facts.sessionId, binding);
      assert.doesNotThrow(() => adapter.sessions.inspectNativeContext(nativeSession));
      assert.ok(nativeConstructorAcks.some(ack => ack.sessionId === nativeSession.id && ack.pageCountAtCreation === 0));
      await denied(() => adapter.sessions.inspectNativeContext({ ...nativeSession }), 'cloned_native_session_cannot_recover_constructor_ack');
      assert.ok(hits > priorHits, 'Owned local query navigation must actually occur');
      const metadata = adapter.sessions.inspectOwned(facts.sessionId, binding); sessions.push({ id: facts.sessionId, owner: binding, pid: metadata.pid });
      const target = await engine.prepareNativeSearchTarget(source), snapshot = await engine.snapshot(source, target); queryForeignTarget = target;
      assert.equal(engine.inspectSnapshot(snapshot).target.writable, true);
      await denied(() => engine.guardSource({ ...source }), 'query_only_cloned_source_denied');
      await denied(() => engine.snapshot(source, { ...target }), 'query_only_cloned_target_denied');
      assert.equal(taskService.getTask(original.id)?.verification, undefined); assert.notEqual(taskService.getTask(original.id)?.status, 'COMPLETED');
      valid = false; await denied(() => engine.snapshot(source, target), 'query_only_original_guard_loss_denied');
      await engine.disposeSource(source); await service.closeSession(facts.sessionId, binding).catch(() => {});
      evidence.push({ scenario: 'actual_query_only_original_owned_page', originalTaskId: original.id, requestHash: facts.requestHash,
        originalRequestWithoutIds: true, sameOwnerAttemptBoot: true, zeroExtraTasksAudits: true, proofScope, nativePhysicalProof: false });
      taskService.updateStatus(original.id, 'CANCELLED');
    }
    for (const mode of ['cancel', 'replan', 'iframe', 'popup', 'viewport', 'root_replacement', 'target_replacement'] as const) {
      const original = taskService.createTask({ title: 'Original query-only negative fixture', objective: 'Owned query guard negative',
        originalUserRequest: 'Owned query guard negative', toolsRequired: ['browser_search'], permissionsRequired: ['network:read', 'browser:control'], riskLevel: 4 });
      taskService.updateStatus(original.id, 'RUNNING'); const originalRules = JSON.stringify(taskService.getTask(original.id)!.validationRules);
      const request = strict({ action: 'search', query: 'Owned query guard negative', verificationGoal: 'Observe original local query guard' });
      const source = await adapter.captureNativeOriginalSource({ owner: ownerCap!, context: { actor: binding, taskId: original.id }, request,
        deadline: Date.now() + 20000, nativeBootRef: Object.freeze(Object.create(null)) as NativeBootRef, attemptRef: Object.freeze(Object.create(null)) as AttemptRef,
        guard: () => { assert.equal(taskService.getTask(original.id)?.status, 'RUNNING'); assert.equal(JSON.stringify(taskService.getTask(original.id)?.validationRules), originalRules); } });
      const facts = engine.inspectSource(source), held = engine.inspectHeldSource(source), target = await engine.prepareNativeSearchTarget(source);
      const metadata = adapter.sessions.inspectOwned(facts.sessionId, binding); sessions.push({ id: facts.sessionId, owner: binding, pid: metadata.pid });
      await engine.snapshot(source, target);
      if (queryForeignTarget) await denied(() => engine.snapshot(source, queryForeignTarget!), 'foreign_query_target_cannot_join_original_source');
      if (mode === 'cancel') taskService.updateStatus(original.id, 'CANCELLED');
      if (mode === 'replan') taskService.updateGenericTask(original.id, 'fixture.replan', task => ({ ...task, validationRules: [...task.validationRules, 'Changed original criterion'] }));
      if (mode === 'iframe') await held.launch.page.evaluate(() => { const frame = document.createElement('iframe'); frame.srcdoc = '<p>Additional owned child</p>'; document.body.append(frame); });
      if (mode === 'popup') { const popup = held.launch.page.waitForEvent('popup'); await held.launch.page.evaluate(() => { window.open('about:blank'); }); await popup; }
      if (mode === 'viewport') await held.launch.page.setViewportSize({ width: 1000, height: 600 });
      if (mode === 'root_replacement') await held.launch.page.setContent(html.toString());
      if (mode === 'target_replacement') await held.launch.page.evaluate(() => { const q = document.querySelector('#q')!; q.replaceWith(q.cloneNode(true)); });
      await delay(30); await denied(() => engine.snapshot(source, target), `query_only_${mode}_cannot_reacquire`);
      await engine.disposeSource(source); await service.closeSession(facts.sessionId, binding).catch(() => {});
      if (taskService.getTask(original.id)?.status === 'RUNNING') taskService.updateStatus(original.id, 'CANCELLED');
    }
    // Exact issuer objects are required. JSON/clone/PID metadata cannot recover an authentic launch or inventory.
    {
      const current = await fresh(); const launch = adapter.sessions.retainOwnedLaunch(current.session, current.pageId, current.page);
      await denied(() => adapter.sessions.inspectNativeContext(current.session), 'ordinary_dom_context_never_upgrades_native_constructor_ack');
      const view = adapter.sessions.inspectRetainedLaunch(launch);
      assert.equal(view.process, current.session.browserServer.process()); assert.equal(view.page, current.page); assert.equal(view.context, current.session.context);
      await denied(() => adapter!.sessions.assertOwnedLaunch({} as OwnedBrowserLaunchCap), 'forged_launch_denied');
      await denied(() => adapter!.sessions.assertOwnedLaunch({ ...launch } as OwnedBrowserLaunchCap), 'cloned_launch_denied');
      await denied(() => adapter!.sessions.assertOwnedLaunch(JSON.parse(JSON.stringify(launch))), 'json_launch_denied');
      let losses = 0; const inventory = await adapter.sessions.captureExclusiveEngineInventory(launch, () => { losses++; }); inventories.push(inventory);
      const measured = adapter.sessions.inspectExclusiveEngineInventory(inventory);
      assert.equal(measured.contextCount, 1); assert.equal(measured.pageCount, 1); assert.equal(measured.frameCount, 1); assert.equal(measured.nativePhysicalProof, false);
      assert.equal(measured.nativeBindingStatus, 'unavailable'); assert.ok(measured.targetId && measured.frameId && measured.loaderId);
      await denied(() => adapter!.sessions.assertExclusiveEngineInventory({ ...inventory } as OwnedEngineInventoryCap), 'cloned_inventory_denied');
      await denied(() => adapter!.sessions.captureExclusiveEngineInventory(launch), 'same_launch_inventory_reissue_denied');
      await current.page.evaluate(() => { const item = document.createElement('aside'); item.textContent = 'Safe same-root DOM addition'; document.body.append(item); });
      adapter.sessions.assertExclusiveEngineInventory(inventory); assert.equal(losses, 0);
      evidence.push({ scenario: 'authentic_retained_launch_inventory', measured, proofScope, nativePhysicalProof: false });
      await adapter.sessions.disposeExclusiveEngineInventory(inventory); assert.equal(losses, 1);
      await denied(() => adapter!.sessions.assertExclusiveEngineInventory(inventory), 'disposed_inventory_denied');
      await cleanup(current);
    }
    for (const mode of ['iframe', 'popup', 'second_context', 'page_close', 'process_close'] as const) {
      const current = await fresh(), launch = adapter.sessions.retainOwnedLaunch(current.session, current.pageId, current.page);
      let losses = 0; const inventory = await adapter.sessions.captureExclusiveEngineInventory(launch, () => { losses++; }); inventories.push(inventory);
      if (mode === 'iframe') await current.page.evaluate(() => { const frame = document.createElement('iframe'); frame.srcdoc = '<p>Actual additional child frame</p>'; document.body.append(frame); });
      if (mode === 'popup') {
        const actualPopup = current.page.waitForEvent('popup');
        await current.page.evaluate(() => { window.open('about:blank', '_blank'); });
        await actualPopup;
      }
      if (mode === 'second_context') { const extra = await current.session.browser.newContext(); await extra.close(); }
      if (mode === 'page_close') await current.page.close();
      if (mode === 'process_close') await service.closeSession(current.session.id, binding);
      await delay(30); assert.equal(losses, 1, `${mode}: invalidation latches exactly once`);
      await denied(() => adapter!.sessions.assertExclusiveEngineInventory(inventory), `${mode}_inventory_lost`);
      await adapter.sessions.disposeExclusiveEngineInventory(inventory);
      if (mode === 'process_close') assert.equal(adapter.sessions.closureEvidence(current.session.id, binding)?.processExited, true);
      evidence.push({ scenario: `actual_${mode}_inventory_change`, losses, proofScope, nativePhysicalProof: false }); await cleanup(current);
    }

    // Source predicate scenarios are filled against the actual source port, never a substitute engine.
    {
      const current = await fresh(), request = requestFor(current, 'fill_form', { selectors: { query: '#q' }, fieldValues: { query: 'Owned \u{1f680} field' } }), { source } = await capture(current, request);
      const target = await engine.prepareTarget(source, 'fill_form'), snapshot = await engine.snapshot(source, target);
      const snapshotView = engine.inspectSnapshot(snapshot); assert.equal(snapshotView.before.title, 'Owned native source DOM fixture');
      assert.equal(snapshotView.target.writable, true);
      const launchDescriptor = engine.inspectNativeLaunchDescriptor(source), held = engine.inspectHeldSource(source);
      assert.equal(launchDescriptor.pid, held.launch.process.pid);
      assert.equal(launchDescriptor.canonicalExecutablePath, fs.realpathSync.native(held.launch.process.spawnfile));
      assert.equal(launchDescriptor.executableSha256, createHash('sha256').update(fs.readFileSync(launchDescriptor.canonicalExecutablePath)).digest('hex'));
      assert.equal(launchDescriptor.childProcessAlive, true);
      assert.deepEqual(engine.inspectNativeLaunchDescriptor(source), launchDescriptor, 'Readonly inspection preserves original launch descriptor');
      const targetDescriptor = engine.inspectNativeTargetDescriptor(source, target, snapshot);
      assert.equal(targetDescriptor.targetRef, snapshotView.target.targetId);
      assert.equal(targetDescriptor.isolatedHitTargetRef, targetDescriptor.targetRef);
      assert.equal(targetDescriptor.logicalDocumentRef, held.documentId);
      assert.equal(targetDescriptor.intendedPointCss.x, snapshotView.target.rect[0] + snapshotView.target.rect[2] / 2);
      assert.match(targetDescriptor.logicalAncestryDigest, /^[a-f0-9]{64}$/);
      assert.match(targetDescriptor.engineTargetIdentityDigest, /^[a-f0-9]{64}$/);
      assert.notEqual(targetDescriptor.engineTargetIdentityDigest, targetDescriptor.logicalAncestryDigest);
      evidence.push({ scenario: 'actual_spawnfile_and_isolated_same_node_descriptor', launchDescriptor, targetDescriptor, proofScope, nativePhysicalProof: false });
      await denied(() => engine.inspectNativeLaunchDescriptor({ ...source }), 'cloned_source_launch_descriptor_denied');
      await denied(() => engine.inspectNativeTargetDescriptor(source, { ...target }, snapshot), 'cloned_target_descriptor_denied');
      await denied(() => engine.inspectNativeTargetDescriptor(source, target, { ...snapshot }), 'cloned_snapshot_descriptor_denied');
      const input = await engine.planInput(source, target), inputView = engine.inspectInput(input);
      assert.equal(inputView.kind, 'replace-text'); assert.equal(inputView.text, request.fieldValues!.query);
      assert.equal(inputView.clearPlan, 'ctrl-a-backspace');
      await denied(() => engine.verifyPostcondition(source, target, request), 'unchanged_native_field_cannot_verify');
      const beforeSimulation = readonlyState();
      await current.page.locator('#q').fill(request.fieldValues!.query);
      assert.deepEqual(readonlyState(), beforeSimulation, 'Simulated native producer changes only actual DOM, never Task/audit/HTTP');
      const post = await engine.verifyPostcondition(source, target, request); assert.equal(engine.verifyIssuedPostcondition(post, source, target), true);
      const postView = engine.inspectPostcondition(post); assert.equal(postView.postconditions[0].matched, true);
      assert.equal(postView.postconditions[0].observedFingerprint, sha(request.fieldValues!.query));
      await denied(() => engine.guardSource({} as BrowserNativeSourceHandle), 'forged_source_denied');
      await denied(() => engine.guardSource({ ...source } as BrowserNativeSourceHandle), 'object_cloned_source_denied');
      await denied(() => engine.guardSource(JSON.parse(JSON.stringify(source))), 'json_cloned_source_denied');
      await denied(() => engine.snapshot(source, {} as NativeSourceTargetCap), 'forged_target_denied');
      await denied(() => engine.verifyIssuedPostcondition({ ...post }, source, target), 'cloned_postcondition_denied');
      await denied(() => engine.inspectInput({ ...input }), 'cloned_input_denied');
      await denied(() => engine.inspectSnapshot({ ...snapshot }), 'cloned_snapshot_denied');
      await denied(() => engine.verifyPostcondition(source, target, strict({ ...request, fieldValues: { query: 'Different retained request' } })), 'different_request_postcondition_denied');
      const detachedInput = engine.inspectInput(input); assert.equal(Object.isFrozen(detachedInput), true);
      assert.throws(() => { (detachedInput as { text: string }).text = 'Caller altered input'; });
      assert.equal(engine.inspectInput(input).text, request.fieldValues!.query);
      await current.page.locator('#q').fill('Actual wrong value');
      await denied(() => engine.verifyPostcondition(source, target, request), 'actual_wrong_field_value_denied');
      evidence.push({ scenario: 'actual_title_and_field_source_predicate', titleSha256: sha(snapshotView.before.title), inputTextSha256: sha(inputView.text!),
        expectedPrimaryEventCount: inputView.expectedPrimaryEventCount, postconditions: postView.postconditions, proofScope, nativePhysicalProof: false });
      await engine.disposeSource(source); await cleanup(current);
    }
    {
      const current = await fresh(), request = requestFor(current, 'navigate', { url: `${origin}/result` }), { source } = await capture(current, request);
      const target = await engine.prepareTarget(source, 'navigate'), snapshot = engine.inspectSnapshot(await engine.snapshot(source, target));
      assert.equal(snapshot.target.href, request.url); assert.equal(engine.inspectInput(await engine.planInput(source, target)).expectedPrimaryEventCount, 2);
      await denied(() => engine.verifyPostcondition(source, target, request), 'href_without_causal_successor_never_verifies');
      await current.page.evaluate(() => { const original = document.querySelector('#approved-href')!; original.after(original.cloneNode(true)); });
      await denied(() => engine.prepareTarget(source, 'navigate'), 'duplicate_approved_href_denied');
      evidence.push({ scenario: 'actual_unique_approved_href_target', hrefSha256: sha(snapshot.target.href!), proofScope, nativePhysicalProof: false });
      await engine.disposeSource(source); await cleanup(current);
    }
    {
      const current = await fresh();
      const mutableRequest = structuredClone(requestFor(current, 'fill_form', { selectors: { query: '#q' }, fieldValues: { query: 'Original immutable intent' } }));
      const { source } = await capture(current, mutableRequest);
      mutableRequest.fieldValues!.query = 'Caller mutation after capture'; mutableRequest.selectors!.query = '#unrelated';
      const target = await engine.prepareTarget(source, 'fill_form'), input = engine.inspectInput(await engine.planInput(source, target));
      assert.equal(input.text, 'Original immutable intent');
      assert.equal(engine.inspectSource(source).request.selectors!.query, '#q');
      await denied(() => engine.verifyPostcondition(source, target, mutableRequest), 'mutated_caller_request_cannot_verify_retained_source');
      evidence.push({ scenario: 'captured_request_survives_caller_input_mutation', originalTextSha256: sha(input.text!), proofScope, nativePhysicalProof: false });
      await engine.disposeSource(source); await cleanup(current);
    }
    {
      const current = await fresh(), request = requestFor(current, 'fill_form', { selectors: { query: '#q' }, fieldValues: { query: 'Owned value' } }), { source } = await capture(current, request);
      const target = await engine.prepareTarget(source, 'fill_form');
      await current.page.evaluate(() => { const original = document.querySelector('#q')!; original.replaceWith(original.cloneNode(true)); });
      await denied(() => engine.snapshot(source, target), 'removed_original_target_cannot_rebind_clone');
      await denied(() => engine.planInput(source, target), 'removed_original_target_cannot_plan_input');
      await engine.disposeSource(source); await cleanup(current);
    }
    {
      const current = await fresh();
      await current.page.evaluate(() => {
        const container = document.createElement('div'); container.style.cssText = 'position:fixed;inset:0;overflow:auto;background:white;z-index:10';
        const content = document.createElement('div'); content.style.height = '4000px'; content.textContent = 'Actual nested scrolling surface'; container.append(content); document.body.append(container);
      });
      const request = requestFor(current, 'scroll', { scrollDeltaY: 120 }), { source } = await capture(current, request);
      await denied(() => engine.prepareTarget(source, 'scroll'), 'nested_scroll_container_cannot_map_document_scroll');
      await engine.disposeSource(source); await cleanup(current);
    }
    // Real retained native constructor and Page membership; CSS mutation is explicitly
    // simulated observation, never a physical wheel/SendInput or canonical native PASS.
    for (const mode of ['bounded', 'clamp_top', 'clamp_bottom', 'noop_top', 'noop_bottom', 'stale_coordinates', 'stale_viewport', 'stale_scope'] as const) {
      const original = taskService.createTask({ title: 'Retained native scroll source fixture', objective: 'Observe original retained bounded CSS scroll',
        originalUserRequest: 'Observe original retained bounded CSS scroll', toolsRequired: ['playwright_browser_agent'], permissionsRequired: ['network:read', 'browser:control'], riskLevel: 4 });
      taskService.updateStatus(original.id, 'RUNNING'); let scopeCurrent = true;
      const scope = { owner: ownerCap!, context: { actor: binding, taskId: original.id }, deadline: Date.now() + 20000,
        nativeBootRef: Object.freeze(Object.create(null)) as NativeBootRef, attemptRef: Object.freeze(Object.create(null)) as AttemptRef,
        guard: () => { assert.equal(scopeCurrent, true); assert.equal(taskService.getTask(original.id)?.status, 'RUNNING'); } };
      const oldNewPage = adapter.sessions.newPage.bind(adapter.sessions); let activeDenied = false;
      if (mode === 'bounded') adapter.sessions.newPage = async session => {
        const created = await oldNewPage(session);
        const activeRequest = strict({ action: 'scroll', sessionId: session.id, pageId: created.id, scrollDeltaY: 120, verificationGoal: 'Observe retained bounded scroll' });
        try { activeDenied = !adapter!.canSelectNativeRequest(activeRequest, binding); } catch { activeDenied = true; }
        return created;
      };
      let bootstrap: BrowserNativeSourceHandle | undefined, scrollSource: BrowserNativeSourceHandle | undefined, ownedId: string | undefined;
      try {
        try { bootstrap = await adapter.captureNativeOriginalSource({ ...scope,
          request: strict({ action: 'search', query: 'Retained native scroll bootstrap', verificationGoal: 'Observe original owned source acquisition' }) }); }
        finally { adapter.sessions.newPage = oldNewPage; }
        const nativeFacts = engine.inspectSource(bootstrap), held = engine.inspectHeldSource(bootstrap); ownedId = nativeFacts.sessionId;
        const session = adapter.sessions.get(nativeFacts.sessionId, binding), page = held.launch.page;
        const metadata = adapter.sessions.inspectOwned(session.id, binding); sessions.push({ id: session.id, owner: binding, pid: metadata.pid });
        assert.equal(adapter.sessions.inspectNativeContext(session).javaScriptEnabled, false);
        assert.equal(session.pages.get(nativeFacts.pageId), page);
        assert.equal((adapter as unknown as { nativeOriginalSessions: Set<string> }).nativeOriginalSessions.has(session.id), true, 'Actual bootstrap must retain original native session membership');
        const maxY = await page.evaluate(() => Math.max(0, document.scrollingElement!.scrollHeight - innerHeight)); assert.ok(maxY > 200);
        const startY = mode === 'clamp_top' ? 40 : mode === 'clamp_bottom' ? maxY - 40 : mode === 'noop_bottom' ? maxY : 0;
        await page.evaluate(y => scrollTo(0, y), startY);
        const delta = mode === 'clamp_top' || mode === 'noop_top' ? -120 : 120;
        const request = strict({ action: 'scroll', sessionId: session.id, pageId: nativeFacts.pageId, scrollDeltaY: delta, verificationGoal: 'Observe original retained bounded CSS offset' });
        assert.equal(adapter.canSelectNativeRequest(request, binding), true, `${mode}: genuine native retained Page must be selectable`);
        if (mode === 'bounded') {
          assert.equal(activeDenied, true, 'An actually active native bootstrap cannot be reentered for scroll');
          const selectionDenied = (candidate: ParsedBrowserWorkflowRequest, actor = binding) => {
            let deniedSelection = false; try { deniedSelection = !adapter!.canSelectNativeRequest(candidate, actor); } catch { deniedSelection = true; }
            assert.equal(deniedSelection, true);
          };
          const selectionBefore = readonlyState();
          selectionDenied({ action: 'scroll', scrollDeltaY: 120, verificationGoal: 'Cold scroll cannot create native context' } as ParsedBrowserWorkflowRequest);
          selectionDenied(request, 'foreign-owned-binding');
          selectionDenied({ ...request, sessionId: 'foreign-session' }); selectionDenied({ ...request, pageId: 'foreign-page' });
          selectionDenied({ ...request, scrollDeltaY: 0 }); selectionDenied({ ...request, dryRun: true });
          const testMode = process.env.EDITH_TEST_MODE; try { process.env.EDITH_TEST_MODE = 'false'; selectionDenied(request); }
          finally { process.env.EDITH_TEST_MODE = testMode; }
          const options = (adapter as unknown as { options: { fixtureOrigins?: string[]; searchUrl?: (query: string) => string } }).options;
          const origins = options.fixtureOrigins, searchUrl = options.searchUrl;
          try { options.fixtureOrigins = []; selectionDenied(request); options.fixtureOrigins = ['http://127.0.0.1:1']; selectionDenied(request);
            options.fixtureOrigins = origins; options.searchUrl = undefined; selectionDenied(request); }
          finally { options.fixtureOrigins = origins; options.searchUrl = searchUrl; }
          assert.deepEqual(readonlyState(), selectionBefore, 'Readonly selection denials have no Task/audit/network effects');
          assert.equal(adapter.canSelectNativeRequest(request, binding), true, 'Configuration restoration preserves the same original native source');
        }
        scrollSource = await adapter.captureNativeRetainedSource({ ...scope, sessionId: session.id, pageId: nativeFacts.pageId, request });
        assert.equal(engine.inspectSource(scrollSource).requestHash, sha(JSON.stringify(request)));
        if (mode === 'noop_top' || mode === 'noop_bottom') {
          await denied(() => engine.prepareTarget(scrollSource!, 'scroll'), `native_retained_${mode}_boundary_no_input`);
        } else {
          const target = await engine.prepareTarget(scrollSource, 'scroll'), snapshotCap = await engine.snapshot(scrollSource, target);
          const before = engine.inspectSnapshot(snapshotCap).before, descriptor = engine.inspectNativeTargetDescriptor(scrollSource, target, snapshotCap);
          const input = engine.inspectInput(await engine.planInput(scrollSource, target));
          assert.equal(input.kind, 'scroll-profile-wheel'); assert.equal(input.expectedPrimaryEventCount, 1);
          assert.equal(descriptor.isolatedHitTargetRef, descriptor.targetRef);
          assert.equal(descriptor.intendedPointCss.x, before.viewport.width / 2); assert.equal(descriptor.intendedPointCss.y, before.viewport.height / 2);
          assert.ok(descriptor.intendedPointCss.x >= descriptor.rectCss.x && descriptor.intendedPointCss.x <= descriptor.rectCss.x + descriptor.rectCss.width);
          assert.ok(descriptor.intendedPointCss.y >= descriptor.rectCss.y && descriptor.intendedPointCss.y <= descriptor.rectCss.y + descriptor.rectCss.height);
          const desiredY = Math.max(0, Math.min(maxY, before.viewport.scrollY + delta));
          if (mode === 'stale_scope') {
            scopeCurrent = false;
            let deniedSelection = false; try { deniedSelection = !adapter.canSelectNativeRequest(request, binding); } catch { deniedSelection = true; }
            assert.equal(deniedSelection, true, 'Retained original guard loss cannot be bypassed by valid native metadata');
            await denied(() => engine.snapshot(scrollSource!, target), 'native_retained_scroll_scope_loss_no_input');
            scopeCurrent = true;
            let restoredDenied = false; try { restoredDenied = !adapter.canSelectNativeRequest(request, binding); } catch { restoredDenied = true; }
            assert.equal(restoredDenied, true, 'Restoring a fixture scope flag cannot resurrect lost native source authority');
            await denied(() => engine.planInput(scrollSource!, target), 'native_retained_scroll_restored_flag_no_reacquisition');
          } else if (mode === 'stale_viewport') {
            await page.setViewportSize({ width: 1000, height: 600 });
            await denied(() => engine.planInput(scrollSource!, target), 'native_retained_scroll_old_viewport_no_input');
          } else if (mode === 'stale_coordinates') {
            await page.evaluate(() => scrollBy(0, 40));
            await denied(() => engine.snapshot(scrollSource!, target), 'native_retained_scroll_old_coordinates_no_input');
            await denied(() => engine.planInput(scrollSource!, target), 'native_retained_scroll_old_coordinates_cannot_plan');
            await denied(() => engine.verifyPostcondition(scrollSource!, target, request), 'native_retained_scroll_wrong_goal_no_proof');
          } else {
            const beforeEffect = readonlyState(); await page.evaluate(y => scrollBy(0, y), delta); await delay(30); assert.deepEqual(readonlyState(), beforeEffect);
            const post = await engine.verifyPostcondition(scrollSource, target, request), observed = engine.inspectPostcondition(post);
            assert.equal(engine.verifyIssuedPostcondition(post, scrollSource, target), true);
            assert.ok(Math.abs(observed.after.viewport.scrollY - desiredY) <= 1); assert.notEqual(observed.after.viewport.scrollY, before.viewport.scrollY);
            assert.equal(observed.after.viewport.scrollX, before.viewport.scrollX);
            if (mode === 'clamp_top') assert.equal(desiredY, 0); if (mode === 'clamp_bottom') assert.equal(desiredY, maxY);
          }
        }
        if (mode === 'bounded') {
          const ordinary = await fresh(), ordinaryRequest = requestFor(ordinary, 'scroll', { scrollDeltaY: 120 });
          assert.equal(adapter.canSelectNativeRequest(ordinaryRequest, binding), false, 'Ordinary JS-enabled Page cannot select native scroll');
          const nativeContext = session.context;
          try { session.context = ordinary.session.context; assert.equal(adapter.canSelectNativeRequest(request, binding), false, 'Wrong actual context cannot inherit native constructor identity'); }
          finally { session.context = nativeContext; await cleanup(ordinary); }
        }
        assert.equal(taskService.getTask(original.id)?.verification, undefined); assert.equal(taskService.getTask(original.id)?.status, 'RUNNING');
        evidence.push({ scenario: `actual_native_retained_scroll_${mode}`, actualNativeConstructor: true, originalTaskId: original.id,
          simulatedInput: 'Trusted fixture CSS scrollBy only; no native wheel/SendInput/ledger', sourceOnlyNotPhysical: true, proofScope, nativePhysicalProof: false });
      } finally {
        adapter.sessions.newPage = oldNewPage;
        if (scrollSource) await engine.disposeSource(scrollSource).catch(() => {});
        if (bootstrap) await engine.disposeSource(bootstrap).catch(() => {});
        if (ownedId) await service.closeSession(ownedId, binding).catch(() => {});
        taskService.updateStatus(original.id, 'CANCELLED');
      }
    }
    for (const mismatch of [false, true]) {
      const current = await fresh(), request = requestFor(current, 'scroll', { scrollDeltaY: 120 }), { source } = await capture(current, request);
      const target = await engine.prepareTarget(source, 'scroll'), snapshotCap = await engine.snapshot(source, target), snapshot = engine.inspectSnapshot(snapshotCap);
      const descriptor = engine.inspectNativeTargetDescriptor(source, target, snapshotCap), held = engine.inspectHeldSource(source);
      assert.equal(descriptor.isolatedHitTargetRef, descriptor.targetRef); assert.equal(descriptor.logicalDocumentRef, held.documentId);
      assert.match(descriptor.logicalAncestryDigest, /^[a-f0-9]{64}$/); assert.match(descriptor.isolatedHitProofDigest, /^[a-f0-9]{64}$/);
      assert.ok(descriptor.rectCss.width > 0 && descriptor.rectCss.height > 0);
      assert.equal(descriptor.intendedPointCss.x, snapshot.before.viewport.width / 2); assert.equal(descriptor.intendedPointCss.y, snapshot.before.viewport.height / 2);
      const maxY = await current.page.evaluate(() => Math.max(0, document.scrollingElement!.scrollHeight - innerHeight));
      const desiredY = Math.max(0, Math.min(maxY, snapshot.before.viewport.scrollY + request.scrollDeltaY!));
      assert.ok(descriptor.intendedPointCss.x >= descriptor.rectCss.x && descriptor.intendedPointCss.x <= descriptor.rectCss.x + descriptor.rectCss.width);
      assert.ok(descriptor.intendedPointCss.y >= descriptor.rectCss.y && descriptor.intendedPointCss.y <= descriptor.rectCss.y + descriptor.rectCss.height);
      assert.equal(Object.isFrozen(descriptor), true); assert.equal(Object.isFrozen(descriptor.rectCss), true);
      assert.throws(() => { (descriptor.rectCss as { width: number }).width = 0; });
      assert.deepEqual(engine.inspectNativeTargetDescriptor(source, target, snapshotCap), descriptor);
      await denied(() => engine.inspectNativeTargetDescriptor(source, { ...target }, snapshotCap), 'scroll_cloned_surface_descriptor_denied');
      const beforeSimulation = readonlyState();
      await current.page.evaluate((delta) => window.scrollBy(0, delta), mismatch ? 30 : 120);
      assert.deepEqual(readonlyState(), beforeSimulation); await delay(30);
      if (mismatch) await denied(() => engine.verifyPostcondition(source, target, request), 'scroll_wrong_css_offset_denied');
      else {
        const post = await engine.verifyPostcondition(source, target, request); assert.equal(engine.verifyIssuedPostcondition(post, source, target), true);
        const observed = engine.inspectPostcondition(post); assert.ok(Math.abs(observed.after.viewport.scrollY - desiredY) <= 1); assert.notEqual(observed.after.viewport.scrollY, snapshot.before.viewport.scrollY); assert.ok(Math.abs(observed.after.viewport.scrollX - snapshot.before.viewport.scrollX) <= 1);
        evidence.push({ scenario: 'actual_original_css_scroll_predicate', beforeY: snapshot.before.viewport.scrollY, desiredY, afterY: observed.after.viewport.scrollY,
          simulatedInput: 'window.scrollBy; no wheel/SendInput claim', proofScope, nativePhysicalProof: false });
      }
      await engine.disposeSource(source); await cleanup(current);
    }
    {
      const current = await fresh();
      await current.page.evaluate(() => { document.body.style.width = '2400px'; });
      const request = requestFor(current, 'scroll', { scrollDeltaY: 120 }), { source } = await capture(current, request);
      const target = await engine.prepareTarget(source, 'scroll'), snapshot = engine.inspectSnapshot(await engine.snapshot(source, target));
      await current.page.evaluate(() => { window.scrollBy(40, 120); }); await delay(30);
      assert.ok((await current.page.evaluate(() => scrollX)) > snapshot.before.viewport.scrollX, 'Actual horizontal displacement is required');
      await denied(() => engine.verifyPostcondition(source, target, request), 'scroll_horizontal_drift_denied');
      evidence.push({ scenario: 'actual_scroll_x_drift_denied', simulatedInput: 'window.scrollBy; no native event claim', proofScope, nativePhysicalProof: false });
      await engine.disposeSource(source); await cleanup(current);
    }
    for (const mode of ['extra_control', 'duplicate_search', 'script_present', 'post_form', 'new_window_form'] as const) {
      const current = await fresh(), request = requestFor(current, 'search', { query: 'Owned profile query' }), { source } = await capture(current, request);
      await current.page.evaluate((mutation) => {
        const form = document.querySelector('#search-form') as HTMLFormElement;
        if (mutation === 'extra_control') { const extra = document.createElement('input'); extra.name = 'other'; form.append(extra); }
        if (mutation === 'duplicate_search') form.append(document.querySelector('#q')!.cloneNode(true));
        if (mutation === 'script_present') document.head.append(document.createElement('script'));
        if (mutation === 'post_form') form.method = 'post';
        if (mutation === 'new_window_form') form.target = '_blank';
      }, mode);
      await denied(() => engine.prepareNativeSearchTarget(source), `${mode}_native_search_profile_denied`);
      await engine.disposeSource(source); await cleanup(current);
    }
    for (const mode of ['root_replacement', 'body_remove_reinsert', 'guard_loss', 'deadline', 'disconnect'] as const) {
      const current = await fresh(), request = requestFor(current, 'fill_form', { selectors: { query: '#q' }, fieldValues: { query: 'Owned value' } });
      const captured = await capture(current, request, mode === 'deadline' ? Date.now() + 3000 : Date.now() + 20_000);
      const target = await engine.prepareTarget(captured.source, 'fill_form'); await engine.snapshot(captured.source, target);
      if (mode === 'root_replacement') await current.page.setContent(html.toString());
      if (mode === 'body_remove_reinsert') await current.page.evaluate(() => { const root = document.documentElement, body = document.body; body.remove(); root.append(body); });
      if (mode === 'guard_loss') captured.loseGuard();
      if (mode === 'deadline') await delay(3050);
      if (mode === 'disconnect') await service.closeSession(current.session.id, binding);
      await delay(30);
      await denied(() => engine.guardSource(captured.source), `${mode}_source_lost`);
      await denied(() => engine.snapshot(captured.source, target), `${mode}_cannot_reacquire_target`);
      await engine.disposeSource(captured.source); await cleanup(current);
    }
    {
      const current = await fresh(), request = requestFor(current, 'search', { query: 'Owned source query' }), { source } = await capture(current, request);
      await denied(() => engine.guardNativeObservedProfile(source), 'ordinary_js_context_cannot_claim_native_profile');
      await denied(() => engine.prepareNativeSearchTarget(source), 'ordinary_js_context_cannot_prepare_native_search');
      evidence.push({ scenario: 'ordinary_dom_search_cannot_upgrade_native_context', querySha256: sha(request.query!),
        noNativeContextUpgrade: true, proofScope, nativePhysicalProof: false });
      await engine.disposeSource(source); await cleanup(current);
    }
    // Root-authorized TEST-ONLY engine Enter: real observed transition, simulated issuer.
    // This fixture never calls authority.recordMeasuredDispatch or publishes a native pair/PASS.
    {
      const original = taskService.createTask({ title: 'Simulated observed successor source fixture', objective: 'Observe original exact source transition',
        originalUserRequest: 'Observe original exact source transition', toolsRequired: ['browser_search'], permissionsRequired: ['network:read', 'browser:control'], riskLevel: 4 });
      taskService.updateStatus(original.id, 'RUNNING');
      const request = strict({ action: 'search', query: 'Exact original observed successor', verificationGoal: 'Observe original results query and eligible result' });
      const boot = Object.freeze(Object.create(null)) as NativeBootRef, attempt = Object.freeze(Object.create(null)) as AttemptRef;
      const source = await adapter.captureNativeOriginalSource({ owner: ownerCap!, context: { actor: binding, taskId: original.id }, request,
        deadline: Date.now() + 20000, nativeBootRef: boot, attemptRef: attempt, guard: () => assert.equal(taskService.getTask(original.id)?.status, 'RUNNING') });
      const originFacts = engine.inspectSource(source), originalHeld = engine.inspectHeldSource(source), target = await engine.prepareNativeSearchTarget(source);
      const before = engine.inspectSnapshot(await engine.snapshot(source, target)).before;
      const metadata = adapter.sessions.inspectOwned(originFacts.sessionId, binding); sessions.push({ id: originFacts.sessionId, owner: binding, pid: metadata.pid });
      await engine.planInput(source, target);
      const edge = await engine.prepareSearchSubmitSuccessor(source, target);
      const preparedDeadline = engine.inspectDormantArm(edge).expiresAtMs;
      assert.ok(preparedDeadline > Date.now() + 1000, 'Preparation retains the original operation lifetime');
      await delay(1050); assert.equal(engine.inspectDormantArm(edge).expiresAtMs, preparedDeadline, 'Preparation lookup cannot renew its original deadline');
      await originalHeld.launch.page.locator('#q').fill(request.query!);
      assert.equal(engine.verifyIssuedPostcondition(await engine.verifyReplacement(source, target), source, target), true);
      const command = Object.freeze(Object.create(null)) as BackendConsumedCommandRef, dispatch = Object.freeze(Object.create(null)) as DispatchRef;
      const simulatedScope = (args: Parameters<Parameters<typeof engine.armPreparedObservedTransition>[2]>[1]) => {
        assert.equal(args.owner, ownerCap); assert.equal(args.nativeBootRef, boot); assert.equal(args.attemptRef, attempt);
        assert.equal(args.context.taskId, original.id); assert.equal(sha(JSON.stringify(args.request)), originFacts.requestHash);
        assert.equal(taskService.getTask(original.id)?.status, 'RUNNING');
      };
      const armStartedAt = Date.now();
      engine.armPreparedObservedTransition(edge, command, (actual, args) => { assert.equal(actual, command); simulatedScope(args); });
      const armCompletedAt = Date.now(), armedDeadline = engine.inspectDormantArm(edge).expiresAtMs;
      assert.ok(armedDeadline > armStartedAt && armedDeadline <= Math.min(preparedDeadline, armCompletedAt + 1000), 'Actual synchronous arm is bounded separately from preparation');
      const beforeRead = readonlyState(), beforeReadContacts = contacts.length;
      for (let read = 0; read < 2; read++) {
        await assert.rejects(() => engine.captureObservedSuccessor(edge), error => error instanceof Error && error.message === 'NATIVE_SUCCESSOR_NOT_STARTED');
        assert.equal(engine.inspectDormantArm(edge).expiresAtMs, armedDeadline, 'Preinput source read cannot renew arm or reserve successor capture');
      }
      assert.deepEqual(readonlyState(), beforeRead); assert.equal(contacts.length, beforeReadContacts);
      evidence.push({ scenario: 'preinput_observed_read_exact_not_started_no_claim_no_renewal', sourceOnlyNotNativeIssuer: true, proofScope, nativePhysicalProof: false });
      // Explicitly authorized DOM simulation; this is NOT Windows/native counted dispatch.
      await originalHeld.launch.page.keyboard.press('Enter');
      for (let count = 0; count < 24 && !engine.inspectCausalSuccessor(edge).terminal; count++) await delay(20);
      const transition = engine.inspectCausalSuccessor(edge);
      evidence.push({ scenario: 'observed_transition_measured_attempt', transition, sourceOnlyNotNativeIssuer: true, proofScope, nativePhysicalProof: false });
      assert.equal(transition.reason, 'formSubmissionGet'); assert.equal(transition.requested, true); assert.equal(transition.documentGet, true);
      assert.equal(transition.responseObserved, true); assert.equal(transition.loaderChanged, true);
      assert.ok(transition.requestId); assert.ok(transition.requestLoaderId); assert.equal(transition.requestLoaderId, transition.frameLoaderId);
      assert.equal(transition.redirected, false); assert.equal(transition.competingEdge, false);
      const observedSource = await engine.captureObservedSuccessor(edge);
      assert.equal(await engine.captureObservedSuccessor(edge), observedSource, 'Preledger lookup returns the original source cap without remint');
      assert.equal(engine.inspectObservedSuccessor(edge).source, observedSource);
      assert.equal(taskService.getTask(original.id)?.verification, undefined); assert.equal(taskService.getTask(original.id)?.status, 'RUNNING');
      evidence.push({ scenario: 'observed_source_before_ledger_no_native_completion', genuineDomSourceCapOnly: true, simulatedIssuerCallback: true, proofScope, nativePhysicalProof: false });
      let ledgerChecks = 0;
      const successor = await engine.sealObservedSuccessor(edge, dispatch, (actual, args, epoch, actualCommand) => {
        assert.equal(actual, dispatch); assert.equal(actualCommand, command); assert.equal(epoch, originFacts.sourceEpochDigest);
        simulatedScope(args); ledgerChecks++;
      });
      assert.equal(successor, observedSource, 'Ledger join retains the exact preledger source cap');
      const sealed = engine.inspectObservedSuccessor(edge); assert.equal(sealed.source, successor);
      const after = engine.inspectPostcondition(sealed.postcondition).after, freshHeld = engine.inspectHeldSource(successor);
      assert.notEqual(after.documentId, before.documentId); assert.equal(after.url, transition.expectedUrl);
      assert.equal(freshHeld.launch.page, originalHeld.launch.page); assert.equal(freshHeld.launch.context, originalHeld.launch.context);
      assert.equal(freshHeld.launch.process, originalHeld.launch.process); assert.equal(freshHeld.launch.mainFrame, originalHeld.launch.mainFrame);
      assert.equal(engine.inspectSource(successor).requestHash, originFacts.requestHash); assert.ok(ledgerChecks >= 1);
      assert.ok(engine.inspectPostcondition(sealed.postcondition).postconditions.every(condition => condition.matched));
      await denied(() => engine.snapshot(source, target), 'observed_transition_old_map_and_target_retired');
      await denied(() => engine.sealObservedSuccessor(edge, dispatch, () => {}), 'observed_transition_one_use_seal');
      await denied(() => engine.inspectObservedSuccessor({ ...edge }), 'observed_transition_cloned_edge_denied');
      assert.equal(taskService.getTask(original.id)?.verification, undefined); assert.notEqual(taskService.getTask(original.id)?.status, 'COMPLETED');
      evidence.push({ scenario: 'actual_observed_successor_source_only_simulation', requestId: transition.requestId,
        requestLoaderId: transition.requestLoaderId, frameLoaderId: transition.frameLoaderId, independentGoalMatched: true,
        sourceOnlyNotNativeIssuer: true, simulatedInput: 'Playwright engine Enter authorized test fixture', ledgerChecks, proofScope, nativePhysicalProof: false });
      await engine.disposeSource(successor); await service.closeSession(originFacts.sessionId, binding).catch(() => {});
      taskService.updateStatus(original.id, 'CANCELLED');
    }
    // These are real native-profile sources with simulated issuer callbacks. No input is
    // sent in these negative cases, and no dispatch ledger or physical pair is constructed.
    for (const mode of ['late_arm', 'root_loss', 'viewport_loss', 'cancel_scope', 'boot_scope', 'lost_ack', 'competing_navigation'] as const) {
      const original = taskService.createTask({ title: 'Observed native source guard fixture', objective: 'Original guarded observed source',
        originalUserRequest: 'Original guarded observed source', toolsRequired: ['browser_search'], permissionsRequired: ['network:read', 'browser:control'], riskLevel: 4 });
      taskService.updateStatus(original.id, 'RUNNING');
      const request = strict({ action: 'search', query: 'Original observed guard fixture', verificationGoal: 'Observe original bounded results' });
      const boot = Object.freeze(Object.create(null)) as NativeBootRef; let currentBoot = boot, commandCurrent = true;
      const source = await adapter.captureNativeOriginalSource({ owner: ownerCap!, context: { actor: binding, taskId: original.id }, request,
        deadline: Date.now() + 20000, nativeBootRef: boot, attemptRef: Object.freeze(Object.create(null)) as AttemptRef,
        guard: () => { assert.equal(taskService.getTask(original.id)?.status, 'RUNNING'); assert.equal(currentBoot, boot); } });
      const facts = engine.inspectSource(source), held = engine.inspectHeldSource(source), target = await engine.prepareNativeSearchTarget(source);
      const metadata = adapter.sessions.inspectOwned(facts.sessionId, binding); sessions.push({ id: facts.sessionId, owner: binding, pid: metadata.pid });
      await engine.snapshot(source, target); await engine.planInput(source, target);
      // Trusted test-only replacement happens before observation is armed; this is DOM simulation.
      await held.launch.page.locator('#q').fill(request.query!); const replacement = await engine.verifyReplacement(source, target);
      const command = Object.freeze(Object.create(null)) as BackendConsumedEnterCommandRef;
      const issuerGuard = (candidate: BackendConsumedEnterCommandRef) => { assert.equal(candidate, command); assert.equal(commandCurrent, true); };
      const arm = await engine.armExactSearchSubmit(source, target, replacement, command, issuerGuard);
      const initial = engine.inspectDormantArm(arm); assert.equal(initial.state, 'dormant');
      assert.equal(await engine.armExactSearchSubmit(source, target, replacement, command, issuerGuard), arm);
      assert.equal(engine.inspectDormantArm(arm).expiresAtMs, initial.expiresAtMs, 'Readonly repeated lookup cannot renew arm');
      await denied(() => engine.armExactSearchSubmit(source, target, replacement, Object.freeze(Object.create(null)) as BackendConsumedEnterCommandRef, issuerGuard), `${mode}_wrong_command_no_second_arm`);
      if (mode === 'late_arm') await delay(Math.max(1, initial.expiresAtMs - Date.now() + 15));
      if (mode === 'root_loss') await held.launch.page.setContent(html.toString());
      if (mode === 'viewport_loss') await held.launch.page.setViewportSize({ width: 1000, height: 600 });
      if (mode === 'competing_navigation') await held.launch.page.goto(`${origin}/result`, { timeout: 2000 }).catch(() => {});
      if (mode === 'cancel_scope') taskService.updateStatus(original.id, 'CANCELLED');
      if (mode === 'boot_scope') currentBoot = Object.freeze(Object.create(null)) as NativeBootRef;
      if (mode === 'lost_ack') commandCurrent = false;
      await delay(30);
      await assert.rejects(() => engine.captureObservedSuccessor(arm), error => error instanceof Error && error.message !== 'NATIVE_SUCCESSOR_NOT_STARTED', `${mode}: loss cannot return the preinput discriminator`);
      if (mode !== 'lost_ack') {
        let lost = false; try { lost = engine.inspectDormantArm(arm).state === 'denied'; } catch { lost = true; }
        assert.equal(lost, true, `${mode}: observation cannot revive`);
      }
      await denied(() => engine.armExactSearchSubmit(source, target, replacement, command, issuerGuard), `${mode}_no_retry_after_uncertainty_or_loss`);
      const unissuedDispatch = Object.freeze(Object.create(null)) as DispatchRef;
      const missingLedger = () => { throw new Error('SIMULATED_FIXTURE_NO_GENUINE_LEDGER'); };
      await denied(() => engine.sealObservedSuccessor(arm, unissuedDispatch, missingLedger), `${mode}_no_unmeasured_observed_completion`);
      await denied(() => engine.sealObservedSuccessor(arm, unissuedDispatch, missingLedger), `${mode}_observed_seal_no_replay`);
      evidence.push({ scenario: `native_profile_${mode}_terminal_denial`, simulatedIssuerCallback: true, actualInputEvents: 0, proofScope, nativePhysicalProof: false });
      await engine.disposeSource(source); await service.closeSession(facts.sessionId, binding).catch(() => {});
      if (taskService.getTask(original.id)?.status === 'RUNNING') taskService.updateStatus(original.id, 'CANCELLED');
    }
    fs.writeFileSync(path.join(reports, 'evidence.json'), JSON.stringify({ success: true, actualHeaded: true, proofScope, nativePhysicalProof: false, nativeConstructorAcks, evidence }, null, 2));
    console.log(JSON.stringify({ success: true, checks: evidence.length, proofScope, nativePhysicalProof: false }));
  } finally {
    fs.writeFileSync(path.join(reports, 'attempt-evidence.json'), JSON.stringify({ actualHeaded: true, proofScope, nativePhysicalProof: false, evidence, hits }, null, 2));
    try {
      if (adapter) {
        for (const inventory of inventories) await adapter.sessions.disposeExclusiveEngineInventory(inventory).catch(() => {});
        await adapter.closeAll();
        for (const session of sessions) assert.equal(adapter.sessions.closureEvidence(session.id, session.owner)?.processExited, true, 'Every owned launch must actually exit');
        for (const ack of nativeConstructorAcks) assert.equal(adapter.sessions.closureEvidence(ack.sessionId, binding)?.processExited, true, 'Rejected initial profiles must also close their actual owned launch');
        assert.equal(adapter.diagnostics().lifecycleFailures, 0, 'Owned cleanup cannot hide a failed process close');
      }
    } finally {
      await close(apiServer); await close(fixtureServer); delete process.env.EDITH_OWNER_TOKEN; delete process.env.EDITH_OWNER_TOKEN_ONE_TIME;
      fs.writeFileSync(path.join(reports, 'cleanup.json'), JSON.stringify({ ownServersClosed: !apiServer?.listening && !fixtureServer?.listening,
        sessions: sessions.map(session => ({ ...session, processExited: adapter?.sessions.closureEvidence(session.id, session.owner)?.processExited ?? false })), nativePhysicalProof: false }, null, 2));
      fs.writeFileSync(path.join(reports, 'native-constructor-cleanup.json'), JSON.stringify({ ownServersClosed: !apiServer?.listening && !fixtureServer?.listening,
        constructors: nativeConstructorAcks.map(ack => ({ ...ack, processExited: adapter?.sessions.closureEvidence(ack.sessionId, binding)?.processExited ?? false })),
        lifecycleFailures: adapter?.diagnostics().lifecycleFailures, nativePhysicalProof: false }, null, 2));
    }
  }
}
main().catch((error) => {
  const relative = path.relative(repairDirectory, path.resolve(reports));
  if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
    fs.mkdirSync(reports, { recursive: true });
    fs.writeFileSync(path.join(reports, 'failure.json'), JSON.stringify({ status: 'FAIL', error: String(error), evidence, proofScope, nativePhysicalProof: false }, null, 2));
  }
  console.error(error); process.exitCode = 1;
});
