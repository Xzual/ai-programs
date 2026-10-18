/** Simulated Node protocol + actual headed DOM-source acquisition; no native input/physical PASS. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import { randomUUID, createHash } from 'node:crypto';
import type { BrowserOwnerCap, BrowserParentExecutionCap, BrowserParentStepCap } from '../server/browser/browserPrivateContract';
import type { AttemptRef, RetainedBrowserRequestRef, NativeBootRef, NativeAuthorityPort, NativeAuthorityIdentityPort,
 NativeDomPairCap, NativeParentAggregateCap, BrowserNativeSourceHandle, BindingRef } from '../server/browser/browserNativePrivateContract';

const reports = process.env.W5_NATIVE_SOURCE_REPORT_DIR;
const rows: Array<Record<string, unknown>> = [];
const trace: string[] = [];
const opaque = <T>(): T => Object.freeze(Object.create(null)) as T; // SIMULATED fixture symbols, never measured authority.
const deny = (): never => { throw new Error('NATIVE_BINDING_UNAVAILABLE'); };
const hash = (text: string) => createHash('sha256').update(text).digest('hex');

async function main() {
 assert.equal(process.env.EDITH_TEST_MODE, 'true');
 assert.ok(process.env.EDITH_TEST_DATA_DIR, 'Runner MUST isolate persistence before importing service');
 assert.ok(reports, 'Runner MUST provide dedicated W5_NATIVE_SOURCE_REPORT_DIR');
 const reportRoot = path.resolve(reports!);
 const allowedRoots = [path.resolve('artifacts/repair-20261006/chat5/w5-observed-outcome-source')];
 assert.ok(allowedRoots.some(root => { const relative = path.relative(root, reportRoot); return !relative.startsWith('..') && !path.isAbsolute(relative); }), 'Reports stay in the observed-outcome branch');
 fs.mkdirSync(reportRoot, { recursive: true });
 const { BrowserWorkflowService, browserWorkflowService: service } = await import('../src/edith/browserWorkflowService');
 const { taskService } = await import('../src/edith/taskService');
 const { plannerService } = await import('../src/edith/planner');
 const { getBrowserOperatorAdapter, setBrowserOperatorTestOptions } = await import('../src/edith/browserOperatorAdapter');
 let adapter = getBrowserOperatorAdapter(); let originalExecute = adapter.execute; let forbiddenDomCalls = 0;
 adapter.execute = async () => { forbiddenDomCalls++; throw new Error('SIMULATED_NATIVE_TEST_DOM_FALLBACK_FORBIDDEN'); };
 const { readRecentAuditEvents } = await import('../src/edith/audit');
 const { createOwnerSessionRouter, requireProtectedMutation, getSoleActiveOwnerSession } = await import('../server/security/ownerSession');
 const { createPermissionsRouter } = await import('../server/routes/permissions');
 const missing = new BrowserWorkflowService();
 let boot: NativeBootRef | undefined = opaque<NativeBootRef>();
 const port: NativeAuthorityPort & NativeAuthorityIdentityPort = {
  evidenceKind: 'simulated-native-producer', currentBoot: () => boot,
  supportsStrategy: action => ['search', 'fill_form', 'scroll'].includes(action),
  inspectIssuedDispatch: () => undefined, verifyIssuedBinding: () => false, verifyIssuedDispatch: () => false,
  awaitCompletion: async () => { trace.push('simulated_completion_rejected'); return deny(); },
  registerBoot: deny, prepareEnrollmentSource: deny, recheckEnrollmentSource: deny, associateMeasuredConsent: deny,
  issueMapChallenge: deny, acceptMeasuredMap: deny, claimStep: async () => deny(), consumeForDispatch: deny,
  recordMeasuredDispatch: deny, verifyAndFinishStep: async () => deny(), revoke: () => { trace.push('revoke'); },
  readOriginalNativeNext: async () => deny(), resolveOriginalNativeInput: deny, armOriginalNativeInput: deny,
  prepareOriginalFocusSource: deny, recordOriginalNativeFocus: deny,
 };
 const runtimePort: import('../server/browser/browserNativePrivateContract').NativeSourceRuntimePort = service;
 assert.equal(runtimePort.inspectNativeBackendBoot().backendBoot, service.inspectNativeBackendBoot().backendBoot);
 service.configureNativeAuthority(port);
 assert.throws(() => service.configureNativeAuthority(port), 'Authority installation must be one-use');
 let cookie = '', csrf = '', origin = ''; const token = randomUUID();
 process.env.EDITH_OWNER_TOKEN = token; process.env.EDITH_OWNER_TOKEN_ONE_TIME = 'false';
 const owners = new Map<string, BrowserOwnerCap>(); const retained = new Map<string, RetainedBrowserRequestRef>();
 const attempts: AttemptRef[] = []; const executions: BrowserParentExecutionCap[] = [];
 let targetService = service; let nextKey = ''; let nextParentTask = '';
 const app = express(); app.use(express.json({ limit: '8kb' })); app.use(createOwnerSessionRouter()); app.use(createPermissionsRouter());
 const html = fs.readFileSync(path.resolve('artifacts/repair-20261006/chat5/w5-native-source-producer/tests-source/fixture.html'));
 app.get('/results', (_req, res) => { res.type('html').set('cache-control', 'no-store').send(html); });
 app.post('/fixture/retain', ...requireProtectedMutation, (req, res) => {
  try {
   const owner = targetService.captureOwner(req); owners.set(nextKey, owner);
   const request = targetService.retainNativeWorkflowRequest(req, owner); retained.set(nextKey, request);
   res.json({ success: true });
  } catch { res.status(400).json({ success: false }); }
 });
 app.post('/fixture/parent', ...requireProtectedMutation, (req, res) => {
  try { const owner = service.captureOwner(req); owners.set(nextKey, owner);
   executions.push(service.openParentExecution(owner, nextParentTask)); res.json({ success: true });
  } catch { res.status(400).json({ success: false }); }
 });
 const server = http.createServer(app);
 await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
 const address = server.address(); assert.ok(address && typeof address !== 'string'); origin = `http://127.0.0.1:${address.port}`;
 const api = async (endpoint: string, method: string, body?: unknown, headers?: Record<string, string>) => {
  const response = await fetch(origin + endpoint, { method, headers: headers ?? { origin, cookie, 'x-edith-csrf-token': csrf, 'content-type': 'application/json' },
   body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(5000) });
  return { status: response.status, body: await response.json() as Record<string, any> };
 };
 const login = async () => {
  const response = await fetch(origin + '/api/security/session', { method: 'POST', headers: { origin, authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) });
  assert.equal(response.status, 201); const body = await response.json() as any;
  cookie = response.headers.get('set-cookie')!.split(';')[0]; csrf = body.session.csrfToken;
 };
 const grant = async () => {
  const response = await api('/api/edith/permissions/grants', 'POST', { permissions: ['network:read', 'browser:control', 'computer:control'],
   toolIds: ['browser_search', 'playwright_browser_agent', 'computer_action'], ttlMs: 600000, reason: 'Simulated native source protocol only' });
  assert.equal(response.status, 200); return response.body.grant.id as string;
 };
 const body = () => ({ action: 'search', query: 'Bounded owned protocol intent', verificationGoal: 'Observe the original bounded results predicate.' });
 const keep = async (request: unknown = body(), use = service) => {
  targetService = use; nextKey = randomUUID(); const result = await api('/fixture/retain', 'POST', request);
  assert.equal(result.status, 200); assert.deepEqual(result.body, { success: true });
  return { owner: owners.get(nextKey)!, request: retained.get(nextKey)! };
 };
 const check = async (name: string, work: () => unknown | Promise<unknown>) => {
  await work(); rows.push({ name, passed: true, evidenceKind: 'simulated-native-producer', physicalAcceptance: false });
 };
 const rejection = async (name: string, work: () => unknown | Promise<unknown>) => {
  const before = taskService.listTasks().length; await assert.rejects(async () => work(), name);
  assert.equal(taskService.listTasks().length, before, `${name}: no new Task`);
  rows.push({ name, passed: true, zeroNewTasks: true, evidenceKind: 'simulated-native-producer' });
 };
 const assertNoPass = () => {
  for (const task of taskService.listTasks()) {
   assert.notEqual(task.verification?.status, 'PASS', 'Simulated producer must NEVER verify a Task');
   assert.notEqual(task.status, 'COMPLETED', 'Simulated source protocol must NEVER complete a Task');
  }
 };
 try {
  await check('protected_missing_owner', async () => {
   const before = taskService.listTasks().length;
   assert.equal((await api('/fixture/retain', 'POST', body(), { origin, 'content-type': 'application/json' })).status, 401);
   assert.equal(taskService.listTasks().length, before);
  });
  await login();
  await check('protected_csrf_and_cross_origin', async () => {
   for (const headers of [{ origin, cookie, 'content-type': 'application/json' }, { origin: 'https://foreign.invalid', cookie, 'x-edith-csrf-token': csrf, 'content-type': 'application/json' }])
    assert.equal((await api('/fixture/retain', 'POST', body(), headers)).status, 403);
  });
  const grantId = await grant();
  await check('body_actor_strategy_unknown_fields', async () => {
   const before = taskService.listTasks().length;
   for (const extra of [{ actor: 'owner' }, { strategy: 'native' }, { taskId: 'adopt-me' }, { nativePhysicalProof: true }, { authorizedPermissions: ['*'] }])
    assert.equal((await api('/fixture/retain', 'POST', { ...body(), ...extra })).status, 400);
   assert.equal(taskService.listTasks().length, before);
  });
  const noPort = await keep(body(), missing);
  await check('missing_authority_unavailable_zero_task', () => assert.notEqual(missing.selectOriginalBrowserExecution(noPort.request), 'native-candidate'));
  await rejection('missing_authority_cannot_admit', () => missing.openNativeOriginal(noPort.owner, noPort.request));
  const owned = await keep();
  await check('global_boot_without_native_profile_preserves_dom_before_admission', () => {
   assert.equal(service.selectOriginalBrowserExecution(owned.request), 'existing-dom');
   const before = taskService.listTasks().length;
   assert.throws(() => service.openNativeOriginal(owned.owner, owned.request));
   assert.equal(taskService.listTasks().length, before);
  });
  adapter.execute = originalExecute;
  await setBrowserOperatorTestOptions({ fixtureOrigins: [origin], searchUrl: query => `${origin}/results?q=${encodeURIComponent(query)}` });
  adapter = getBrowserOperatorAdapter(); originalExecute = adapter.execute;
  adapter.execute = async () => { forbiddenDomCalls++; throw new Error('SIMULATED_NATIVE_TEST_DOM_FALLBACK_FORBIDDEN'); };
  await check('unavailable_owned_constructor_cannot_native_admit_from_boot', () => {
   const availability = adapter.availability.bind(adapter), before = taskService.listTasks().length;
   adapter.availability = () => ({ available: false, status: 'configuration_required', reasonCode: 'CONFIGURATION_REQUIRED', backend: 'owned_headed_playwright' });
   try {
    assert.equal(service.selectOriginalBrowserExecution(owned.request), 'existing-dom');
    assert.throws(() => service.openNativeOriginal(owned.owner, owned.request)); assert.equal(taskService.listTasks().length, before);
   } finally { adapter.availability = availability; }
  });
  await check('actual_ordinary_context_preserves_dom_before_native_admission', async () => {
   const actualOwner = getSoleActiveOwnerSession(); assert.ok(actualOwner);
   const guard = () => assert.equal(getSoleActiveOwnerSession()?.bindingId, actualOwner.bindingId);
   const receipt = await originalExecute.call(adapter, { action: 'navigate', url: `${origin}/results`, verificationGoal: 'Observe owned ordinary constructor fixture.' },
    { actor: actualOwner.bindingId, taskId: 'fixture-ordinary-constructor', authorizedPermissions: ['network:read', 'browser:control'] }, guard, guard);
   assert.equal(receipt.status, 'verified'); assert.equal(receipt.nativePhysicalProof, false); assert.ok(receipt.sessionId && receipt.pageId);
   const session = adapter.sessions.get(receipt.sessionId, actualOwner.bindingId);
   assert.throws(() => adapter.sessions.inspectNativeContext(session));
   const capture = await keep({ ...body(), sessionId: receipt.sessionId, pageId: receipt.pageId });
   const before = taskService.listTasks().length;
   assert.equal(service.selectOriginalBrowserExecution(capture.request), 'existing-dom');
   assert.throws(() => service.openNativeOriginal(capture.owner, capture.request)); assert.equal(taskService.listTasks().length, before);
   await service.closeSession(receipt.sessionId, actualOwner.bindingId);
  });
  await rejection('forged_owner_cap', () => service.openNativeOriginal(opaque<BrowserOwnerCap>(), owned.request));
  await rejection('cloned_owner_cap', () => service.openNativeOriginal({ ...owned.owner } as BrowserOwnerCap, owned.request));
  await rejection('json_retained_cap', () => service.openNativeOriginal(owned.owner, JSON.parse(JSON.stringify(owned.request)) as RetainedBrowserRequestRef));
  boot = undefined;
  await check('missing_current_boot_unavailable', () => assert.notEqual(service.selectOriginalBrowserExecution(owned.request), 'native-candidate'));
  await rejection('missing_boot_cannot_admit', () => service.openNativeOriginal(owned.owner, owned.request));
  boot = opaque<NativeBootRef>();
  await check('single_original_pending_task', () => {
   const before = taskService.listTasks().length; const attempt = service.openNativeOriginal(owned.owner, owned.request); attempts.push(attempt);
   const info = service.inspectNativeAttempt(attempt);
   assert.equal(info.originalTaskRef, info.taskId, 'Correlation must retain exact canonical Task.id');
   assert.equal(service.resolveIssuedOperationLookup(info.operationLookupRef), service.resolveIssuedOperationLookup(info.operationLookupRef), 'Readonly operation lookup never mints a replacement capability');
   assert.equal(service.resolveIssuedOperationAttempt(service.resolveIssuedOperationLookup(info.operationLookupRef)), attempt);
   const ticket = service.startNativeOriginal(attempt); assert.equal(ticket.pending, true); assert.equal(ticket.success, true); assert.equal(ticket.version, 1);
   assert.equal(ticket.status, 'awaiting-native-confirmation'); assert.equal('browser' in ticket, false);
   assert.equal(taskService.listTasks().length, before + 1); assert.equal(taskService.getTask(ticket.taskId)?.status, 'RUNNING');
   assert.notEqual(taskService.getTask(ticket.taskId)?.verification?.status, 'PASS');
   assert.deepEqual(service.readNativeAttemptTicket(attempt), ticket);
   const lookup = service.resolveNativeAttemptLookup(owned.owner, ticket.attemptLookupRef);
   assert.deepEqual(service.readNativeWorkflowResult(owned.owner, lookup), ticket);
   assert.throws(() => service.resolveNativeAttemptLookup(opaque<BrowserOwnerCap>(), ticket.attemptLookupRef));
   assert.throws(() => service.readNativeWorkflowResult(owned.owner, { ...lookup }));
   assert.throws(() => service.startNativeOriginal(attempt), 'Second start must not launch another canonical leaf');
   assert.equal(taskService.listTasks().length, before + 1);
  });
  await rejection('reused_original_retained_request', () => service.openNativeOriginal(owned.owner, owned.request));
  await check('actual_standalone_query_only_source_keeps_same_original_task', async () => {
   const attempt = attempts[0], info = service.inspectNativeAttempt(attempt), before = taskService.listTasks().length;
   const source = await service.captureNativeAttemptSource(attempt), facts = adapter.nativeSources.inspectSource(source);
   assert.equal(facts.context.taskId, info.taskId); assert.equal(facts.context.actor, info.originalOwnerBinding);
   assert.equal(facts.requestHash, info.requestHash); assert.equal(facts.request.sessionId, undefined); assert.equal(facts.request.pageId, undefined);
   const session = adapter.sessions.get(facts.sessionId, info.originalOwnerBinding);
   assert.equal(adapter.sessions.inspectNativeContext(session).javaScriptEnabled, false);
   assert.equal(taskService.listTasks().length, before); assert.equal(taskService.getTask(info.taskId)?.verification, undefined);
   await assert.rejects(() => service.captureNativeAttemptSource(attempt), 'Original capture cannot mint another source');
   await check('retained_native_scroll_actual_producer_candidate_simulation_only', async () => {
    const scroll = { action: 'scroll', sessionId: facts.sessionId, pageId: facts.pageId, scrollDeltaY: 120, verificationGoal: 'Observe original retained native CSS scroll intent' };
    const retainedScroll = await keep(scroll), beforeScrollTasks = taskService.listTasks().length;
    assert.equal(adapter.canSelectNativeRequest(scroll as any, info.originalOwnerBinding), true);
    assert.equal(service.selectOriginalBrowserExecution(retainedScroll.request), 'native-candidate');
    assert.equal(taskService.listTasks().length, beforeScrollTasks, 'Readonly native selection cannot mint a Task');
    assert.throws(() => service.openNativeOriginal({ ...retainedScroll.owner }, retainedScroll.request), 'Cloned owner cannot admit retained scroll');
    assert.equal(taskService.listTasks().length, beforeScrollTasks);
    const scrollAttempt = service.openNativeOriginal(retainedScroll.owner, retainedScroll.request); attempts.push(scrollAttempt);
    const scrollInfo = service.inspectNativeAttempt(scrollAttempt), ticket = service.startNativeOriginal(scrollAttempt);
    assert.equal(scrollInfo.request.action, 'scroll'); assert.equal(scrollInfo.request.scrollDeltaY, 120);
    assert.equal(scrollInfo.request.sessionId, facts.sessionId); assert.equal(scrollInfo.request.pageId, facts.pageId);
    assert.equal(scrollInfo.originalOwnerBinding, info.originalOwnerBinding); assert.equal(scrollInfo.nativeBoot, info.nativeBoot);
    const parsedScroll = (await import('../src/edith/browserOperatorContract')).parseBrowserWorkflowRequest(scroll); assert.equal(parsedScroll.success, true);
    if (!parsedScroll.success) throw new Error('Strict original scroll request required');
    assert.equal(scrollInfo.requestHash, hash(JSON.stringify(parsedScroll.value)));
    assert.equal(ticket.taskId, scrollInfo.taskId); assert.equal(taskService.listTasks().length, beforeScrollTasks + 1);
    assert.equal(taskService.getTask(ticket.taskId)?.status, 'RUNNING'); assert.equal(taskService.getTask(ticket.taskId)?.verification, undefined);
    assert.deepEqual(service.readNativeAttemptTicket(scrollAttempt), ticket);
    assert.throws(() => service.openNativeOriginal(retainedScroll.owner, retainedScroll.request), 'One retained scroll request cannot create another Task');
    assert.equal(taskService.listTasks().length, beforeScrollTasks + 1);
    taskService.updateStatus(ticket.taskId, 'CANCELLED');
    assert.notEqual(taskService.getTask(ticket.taskId)?.verification?.status, 'PASS');
    rows.push({ name: 'retained_native_scroll_original_pending_task', taskId: ticket.taskId, sourceBootstrapTaskId: info.taskId,
     originalScrollRequestHash: scrollInfo.requestHash, actualProducerSelection: true, evidenceKind: port.evidenceKind,
     simulatedAuthorityOnly: true, physicalNativeActions: 0, nativePhysicalProof: false });
   });
   await adapter.nativeSources.disposeSource(source); await service.closeSession(facts.sessionId, info.originalOwnerBinding);
   assert.equal(adapter.sessions.closureEvidence(facts.sessionId, info.originalOwnerBinding)?.processExited, true);
  });
  await rejection('forged_attempt_prepare', () => service.prepareNativeAttemptBatches(opaque<AttemptRef>()));
  await rejection('forged_attempt_pair', () => service.verifyNativeAttemptPair(opaque<AttemptRef>()));
  await rejection('forged_attach_source_and_binding', () => service.attachNativeBinding(attempts[0], port, opaque<BindingRef>(), opaque<BrowserNativeSourceHandle>()));
  await check('cancelled_task_no_success_reread', () => {
   const ticket = service.readNativeAttemptTicket(attempts[0]); taskService.updateStatus(ticket.taskId, 'CANCELLED');
   assert.throws(() => service.readNativeAttemptTicket(attempts[0]));
  });
  await check('request_input_mutation_does_not_replace_retained_intent', async () => {
   const mutable = body(); const capture = await keep(mutable); mutable.query = 'Changed caller intent';
   const attempt = service.openNativeOriginal(capture.owner, capture.request); attempts.push(attempt);
   const info = service.inspectNativeAttempt(attempt); assert.equal(info.request.query, 'Bounded owned protocol intent');
   assert.throws(() => { (info.request as { query: string }).query = 'Mutated through inspector'; });
   assert.equal(service.inspectNativeAttempt(attempt).request.query, 'Bounded owned protocol intent');
  });
  await check('nested_field_input_is_retained_without_native_promotion', async () => {
   const mutable = { action: 'fill_form', url: 'http://127.0.0.1:1/never-contacted', selectors: { display: '#display' },
    fieldValues: { display: 'Original display' }, verificationGoal: 'Observe exact original display value without submission.' };
   const capture = await keep(mutable); mutable.fieldValues.display = 'Changed caller display'; mutable.selectors.display = '#other';
   assert.equal(service.selectOriginalBrowserExecution(capture.request), 'existing-dom', 'No actual native context may be inferred from URL or boot');
   const before = taskService.listTasks().length; assert.throws(() => service.openNativeOriginal(capture.owner, capture.request));
   assert.equal(taskService.listTasks().length, before);
  });
  await check('pause_invalidates_pending_original', async () => {
   const capture = await keep(); const attempt = service.openNativeOriginal(capture.owner, capture.request); attempts.push(attempt);
   const ticket = service.startNativeOriginal(attempt); taskService.updateStatus(ticket.taskId, 'WAITING_FOR_APPROVAL');
   assert.throws(() => service.readNativeAttemptTicket(attempt));
  });
  await check('replan_required_rules_invalidates_original', async () => {
   const capture = await keep(); const attempt = service.openNativeOriginal(capture.owner, capture.request); attempts.push(attempt);
   const ticket = service.startNativeOriginal(attempt); const plan = plannerService.planTask(ticket.taskId); assert.ok(plan.plan);
   taskService.attachPlan(ticket.taskId, { ...structuredClone(plan.plan), validationCriteria: [...plan.plan.validationCriteria, 'Changed source-required criterion'] });
   assert.throws(() => service.readNativeAttemptTicket(attempt));
  });
  await check('expired_original_deadline_no_ticket_renewal', async () => {
   const capture = await keep(); const attempt = service.openNativeOriginal(capture.owner, capture.request); attempts.push(attempt);
   const info = service.inspectNativeAttempt(attempt); service.startNativeOriginal(attempt);
   const realNow = Date.now;
   try { Date.now = () => info.operationDeadlineMs + 1; assert.throws(() => service.readNativeAttemptTicket(attempt)); }
   finally { Date.now = realNow; }
   assert.throws(() => service.readNativeAttemptTicket(attempt), 'Expired scope cannot reopen after clock fixture reset');
  });
  const parent = taskService.createTask({ title: 'Original simulated native parent', objective: 'Original owned planned search intent', originalUserRequest: 'Original owned planned search intent',
   toolsRequired: ['browser_search'], permissionsRequired: ['network:read', 'browser:control'], riskLevel: 4 });
  const planned = plannerService.planTask(parent.id); assert.equal(planned.success, true);
  targetService = service; nextKey = randomUUID(); nextParentTask = parent.id;
  assert.equal((await api('/fixture/parent', 'POST', {})).status, 200);
  const execution = executions.at(-1)!;
  await rejection('cloned_parent_execution_strategy', () => service.freezeNativeParentStrategies({ ...execution }));
  await check('parent_preserves_original_required_rules', () => {
   const before = [...taskService.getTask(parent.id)!.validationRules];
   service.freezeNativeParentStrategies(execution); assert.ok(before.every(rule => taskService.getTask(parent.id)!.validationRules.includes(rule)));
  });
  await rejection('foreign_parent_step_cannot_adopt', () => service.openNativeParentStep(execution, opaque<BrowserParentStepCap>()));
  await rejection('fake_pair_cannot_publish_parent', () => service.publishNativeParentPair(execution, opaque<BrowserParentStepCap>(), opaque<NativeDomPairCap>()));
  await rejection('fake_aggregate_cannot_reserve', () => service.consumeNativeParentAggregate(opaque<NativeParentAggregateCap>(), '0'.repeat(64)));
  await check('actual_original_parent_query_only_source_acquisition', async () => {
   await setBrowserOperatorTestOptions({ fixtureOrigins: [origin], searchUrl: query => `${origin}/results?q=${encodeURIComponent(query)}` });
   adapter = getBrowserOperatorAdapter(); originalExecute = adapter.execute;
   adapter.execute = async () => { forbiddenDomCalls++; throw new Error('SIMULATED_NATIVE_TEST_DOM_FALLBACK_FORBIDDEN'); };
   assert.equal(adapter.availability().available, true, 'Actual existing headed Chromium required for source acquisition');
   const beforeTasks = taskService.listTasks().length, original = taskService.getTask(parent.id)!;
   const browserStep = original.plan!.steps.find(step => step.suggestedTools.includes('browser_search')); assert.ok(browserStep);
   const stepCap = service.associatePlannedSearch(execution, browserStep.id);
   for (const dependency of browserStep.dependsOn) taskService.updatePlanStepStatus(parent.id, dependency, 'COMPLETED');
   taskService.updateStatus(parent.id, 'RUNNING'); taskService.updatePlanStepStatus(parent.id, browserStep.id, 'RUNNING');
   assert.equal(service.readNativeParentAggregate(execution), undefined, 'Running parent without genuine completed pairs cannot aggregate');
   assert.equal(service.resolveParentStep(execution, browserStep.id), stepCap);
   const attempt = service.openNativeParentStep(execution, stepCap); attempts.push(attempt);
   const info = service.inspectNativeAttempt(attempt); assert.equal(info.taskId, parent.id); assert.equal(info.stepId, browserStep.id);
   assert.equal(info.request.sessionId, undefined); assert.equal(info.request.pageId, undefined); assert.equal(info.request.action, 'search');
   const leaf = service.startNativeParentLeaf(attempt); void leaf.catch(() => {});
   const pending = service.readNativeAttemptTicket(attempt); assert.equal(pending.taskId, parent.id);
   const source = await service.captureNativeAttemptSource(attempt), engine = adapter.nativeSources;
   const facts = engine.inspectSource(source), identity = engine.inspectSourceIdentity(source), held = engine.inspectHeldSource(source);
   assert.equal(taskService.listTasks().length, beforeTasks); assert.equal(taskService.getTask(parent.id)?.status, 'RUNNING');
   assert.equal(taskService.getTask(parent.id)?.verification, undefined); assert.equal(facts.context.taskId, parent.id);
   assert.equal(facts.context.actor, info.originalOwnerBinding); assert.equal(facts.requestHash, info.requestHash);
   assert.deepEqual(facts.request, info.request); assert.equal('sessionId' in facts.request, false); assert.equal('pageId' in facts.request, false);
   assert.equal(identity.attemptRef, attempt); assert.equal(identity.nativeBootRef, info.nativeBoot);
   assert.equal(held.launch.page, adapter.sessions.get(facts.sessionId, info.originalOwnerBinding).pages.get(facts.pageId));
   const nativeSession = adapter.sessions.get(facts.sessionId, info.originalOwnerBinding);
   const nativePolicy = adapter.sessions.inspectNativeContext(nativeSession);
   assert.equal(nativePolicy.javaScriptEnabled, false); assert.equal(nativePolicy.serviceWorkers, 'block'); assert.equal(nativePolicy.acceptDownloads, false);
   assert.equal(nativePolicy.context, held.launch.context); assert.equal(nativePolicy.process, held.launch.process);
   assert.throws(() => adapter.sessions.inspectNativeContext({ ...nativeSession }), 'Cloned session cannot acquire native constructor membership');
   assert.equal(new URL(held.launch.page.url()).searchParams.get('q'), info.request.query);
   await assert.rejects(() => service.captureNativeAttemptSource({ ...attempt }), 'Cloned original attempt cannot create a second Page');
   assert.equal(taskService.listTasks().length, beforeTasks);
   const target = await engine.prepareNativeSearchTarget(source); await engine.snapshot(source, target);
   taskService.updateStatus(parent.id, 'CANCELLED'); await assert.rejects(() => engine.snapshot(source, target));
   await engine.disposeSource(source); await service.closeSession(facts.sessionId, info.originalOwnerBinding).catch(() => {});
   const result = await leaf; assert.equal(result.success, false); assert.notEqual(taskService.getTask(parent.id)?.verification?.status, 'PASS');
   rows.push({ name: 'actual_original_parent_owned_headed_source', taskId: parent.id, originalRequestHash: facts.requestHash,
    zeroNewTask: true, sourceOnlyActualHeaded: true, canonicalLeafSuccess: false, nativePhysicalProof: false, evidenceKind: port.evidenceKind });
  });
  await check('p1_dom_guard_kept_on_original_service', () => {
   const source = fs.readFileSync(path.resolve('src/edith/browserWorkflowService.ts'), 'utf8');
   assert.match(source, /executeParentDom\(/); assert.match(source, /receipt\.nativePhysicalProof/);
   assert.match(source, /browser-step:\$\{step\.stepId\}:no-native-proof/);
   rows.push({ name: 'p1_guard_source_record', sourceSha256: hash(source), behavioralDomAcceptance: false });
  });
  await check('grant_revocation_denies_original_retained_admission', async () => {
   const request = await keep(); assert.equal((await api(`/api/edith/permissions/grants/${grantId}`, 'DELETE')).status, 200);
   await rejection('actual_grant_revoked', () => service.openNativeOriginal(request.owner, request.request));
  });
  await grant();
  const rotation = await keep(); const rotationAttempt = service.openNativeOriginal(rotation.owner, rotation.request); attempts.push(rotationAttempt);
  boot = opaque<NativeBootRef>(); await rejection('boot_rotation_denies_ticket', () => service.readNativeAttemptTicket(rotationAttempt));
  await check('actual_logout_invalidates_captured_owner', async () => {
   const request = await keep(); assert.equal((await api('/api/security/session', 'DELETE')).status, 200);
   await rejection('logged_out_owner_admission', () => service.openNativeOriginal(request.owner, request.request));
  });
  await new Promise<void>(resolve => setTimeout(resolve, 50)); assertNoPass();
  assert.equal(forbiddenDomCalls, 0, 'Native protocol must never fall through to actual DOM/browser dispatch');
  const audits = readRecentAuditEvents(1000);
  assert.ok(!audits.some(event => event.action === 'tool.execute' && event.result === 'success'), 'No simulated native successful audit');
  const result = { status: 'SOURCE_TEST_SIMULATION_ONLY', checks: rows.length, rows, trace, nativePhysicalProof: false,
   taskPass: false, nativeInputEffects: 0, browserInputEffects: 0, ownedLocalSourceNavigationOnly: true, actualProtectedOwnerAndGrants: true };
  fs.writeFileSync(path.join(reportRoot, 'native-parent-source-results.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, rows: undefined, trace: undefined }));
 } finally {
  for (const attempt of attempts) { try { const info = service.inspectNativeAttempt(attempt); if (taskService.getTask(info.taskId)?.status === 'RUNNING') taskService.updateStatus(info.taskId, 'CANCELLED'); } catch {} }
  adapter.execute = originalExecute; await adapter.closeAll(); server.closeAllConnections(); if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
 }
}
main().catch(error => {
 const root = path.resolve('artifacts/repair-20261006/chat5/w5-observed-outcome-source');
 const relative = reports ? path.relative(root, path.resolve(reports)) : '..';
 if (reports && !relative.startsWith('..') && !path.isAbsolute(relative)) {
  fs.mkdirSync(reports, { recursive: true }); fs.writeFileSync(path.join(reports, 'failure.json'), JSON.stringify({ status: 'FAIL', error: String(error), rows, nativePhysicalProof: false }, null, 2));
 }
 console.error(error); process.exitCode = 1;
});
