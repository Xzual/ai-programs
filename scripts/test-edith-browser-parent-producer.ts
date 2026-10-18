import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import { randomUUID, createHash } from 'node:crypto';
import type { EdithPlan } from '../src/edith/core';
import type { BrowserOwnerCap, BrowserParentExecutionCap, BrowserParentStepCap, BrowserParentAggregateCap, BrowserParentStepResult } from '../server/browser/browserPrivateContract';
import { parseBrowserOperatorReceipt, type BrowserOperatorReceipt } from '../src/edith/browserOperatorContract';
import { projectTaskEventsV2 } from '../src/edith/contracts';
import { normalizeRegisteredBrowserArgs } from '../server/browser/browserRegisteredArgs';

const root = path.resolve('artifacts/repair-20261006/chat5/w5-parent-producer/tests');
const reports = process.env.W5_PARENT_GUARD_REPORT_DIR ?? path.join(root, 'runtime');
const rows: Array<Record<string, unknown>> = [];
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const safeReceipt = (receipt: BrowserOperatorReceipt | undefined) => receipt && ({
  schema: receipt.schema, version: receipt.version, operationId: receipt.operationId, action: receipt.action,
  status: receipt.status, reasonCode: receipt.reasonCode, sessionId: receipt.sessionId, pageId: receipt.pageId,
  inputProvenance: receipt.inputProvenance, nativePhysicalProof: receipt.nativePhysicalProof,
  resolveAttempts: receipt.resolveAttempts, inputDispatches: receipt.inputDispatches, artifacts: receipt.artifacts,
  targetIds: receipt.targetIds, postconditions: receipt.postconditions,
  observations: [receipt.before, receipt.after].filter(Boolean).map((observation) => ({
    id: observation!.id, documentId: observation!.documentId, generation: observation!.generation,
    observedAt: observation!.observedAt, urlSha256: hash(observation!.url), titleSha256: hash(observation!.title),
  })),
});
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
async function listen(server: http.Server) {
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address(); assert.ok(address && typeof address === 'object'); return `http://127.0.0.1:${address.port}`;
}
async function close(server: http.Server | undefined) {
  if (!server?.listening) return;
  server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function main() {
  assert.equal(process.env.EDITH_TEST_MODE, 'true'); assert.ok(process.env.EDITH_TEST_DATA_DIR);
  fs.mkdirSync(reports, { recursive: true });
  const { browserWorkflowService: service } = await import('../src/edith/browserWorkflowService');
  const { getBrowserOperatorAdapter, setBrowserOperatorTestOptions } = await import('../src/edith/browserOperatorAdapter');
  const { createOwnerSessionRouter, getSoleActiveOwnerSession, requireProtectedMutation } = await import('../server/security/ownerSession');
  const { createPermissionsRouter } = await import('../server/routes/permissions');
  const { taskService } = await import('../src/edith/taskService');
  const { plannerService } = await import('../src/edith/planner');
  const { readRecentAuditEvents } = await import('../src/edith/audit');
  const { executeEdithTool } = await import('../src/edith/serverRegistry');
  const { getEdithPersistenceStore } = await import('../src/edith/persistence');
  let apiServer: http.Server | undefined, fixtureServer: http.Server | undefined;
  let cookie = '', csrf = '', binding = '', grantId = '', hits = 0;
  let holdNext = false;
  let omitResultsNext = false;
  let held: { release: () => void; observed: Promise<void> } | undefined;
  let notifyHeld: (() => void) | undefined;
  const credentials = randomUUID(); process.env.EDITH_OWNER_TOKEN = credentials; process.env.EDITH_OWNER_TOKEN_ONE_TIME = 'false';
  const captures = new Map<string, { owner: BrowserOwnerCap; execution: BrowserParentExecutionCap }>();
  const sessions: Array<{ id: string; owner: string; taskId: string }> = [];
  const app = express(); app.use(express.json({ limit: '8kb' })); app.use(createOwnerSessionRouter()); app.use(createPermissionsRouter());
  // Only this reviewed backend closure receives capabilities. HTTP returns no owner/execution/evidence objects.
  app.post('/test/parent/open', ...requireProtectedMutation, (req, res) => {
    try {
      assert.equal(typeof req.body?.taskId, 'string');
      const owner = service.captureOwner(req);
      const execution = service.openParentExecution(owner, req.body.taskId);
      captures.set(req.body.taskId, { owner, execution }); res.json({ success: true });
    } catch { res.status(400).json({ success: false }); }
  });
  try {
    const html = fs.readFileSync(path.join(root, 'fixture.html'));
    fixtureServer = http.createServer((req, res) => {
      hits++;
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (!['/search', '/result'].includes(url.pathname)) { res.writeHead(404).end(); return; }
      const respond = () => {
        const omitResults = omitResultsNext; omitResultsNext = false;
        if (!res.destroyed) {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
          res.end(omitResults ? '<!doctype html><title>Actual empty search fixture</title><main>No result links were returned.</main>' : html);
        }
      };
      if (holdNext && url.pathname === '/search') {
        holdNext = false; held!.release = respond; notifyHeld?.();
      } else respond();
    });
    const fixtureOrigin = await listen(fixtureServer);
    apiServer = http.createServer(app); const apiOrigin = await listen(apiServer);
    async function api(endpoint: string, method: string, body?: unknown) {
      const result = await fetch(`${apiOrigin}${endpoint}`, { method, headers: { origin: apiOrigin, cookie, 'x-edith-csrf-token': csrf,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
      return { status: result.status, body: await result.json() as any };
    }
    async function login() {
      const result = await fetch(`${apiOrigin}/api/security/session`, { method: 'POST', headers: { origin: apiOrigin, authorization: `Bearer ${credentials}` }, signal: AbortSignal.timeout(10_000) });
      assert.equal(result.status, 201); const body = await result.json() as any; cookie = result.headers.get('set-cookie')!.split(';')[0]; csrf = body.session.csrfToken;
      const actual = getSoleActiveOwnerSession(); assert.ok(actual); binding = actual.bindingId;
    }
    async function grant() {
      const result = await api('/api/edith/permissions/grants', 'POST', { permissions: ['network:read', 'browser:control'], toolIds: ['browser_search'], ttlMs: 600_000, reason: 'Actual original planned search fixture' });
      assert.equal(result.status, 200); assert.equal(result.body.grant.actor, 'owner'); grantId = result.body.grant.id;
    }
    await setBrowserOperatorTestOptions({ fixtureOrigins: [fixtureOrigin], searchUrl: (query) => `${fixtureOrigin}/search?q=${encodeURIComponent(query)}` });
    assert.equal(getBrowserOperatorAdapter().availability().available, true, 'Actual existing headed Chromium is required');
    await login(); await grant();

    function task(tools = ['browser_search'], mutate?: (plan: EdithPlan) => EdithPlan) {
      const original = taskService.createTask({ title: 'Original parent fixture', objective: 'Owned deterministic fixture intent', originalUserRequest: 'Owned deterministic fixture intent',
        toolsRequired: tools, permissionsRequired: ['network:read', 'browser:control'], riskLevel: 4 });
      const planned = plannerService.planTask(original.id); assert.equal(planned.success, true); assert.ok(planned.plan);
      if (mutate) taskService.attachPlan(original.id, mutate(structuredClone(planned.plan)));
      const actual = taskService.getTask(original.id)!; assert.ok(actual.plan);
      return { taskId: original.id, plan: actual.plan, browser: actual.plan.steps.filter((step) => step.suggestedTools.some((tool) => ['browser_search', 'browser_workflow', 'browser_open', 'playwright_browser_agent'].includes(tool))) };
    }
    async function open(taskId: string) {
      const response = await api('/test/parent/open', 'POST', { taskId }); assert.equal(response.status, 200);
      assert.deepEqual(response.body, { success: true }, 'Capabilities must stay in the protected backend closure');
      const cap = captures.get(taskId); assert.ok(cap); return cap;
    }
    function ready(taskId: string, stepId: string, dependencies = true) {
      const source = taskService.getTask(taskId)!;
      if (dependencies) for (const dependency of source.plan!.steps.find((step) => step.id === stepId)!.dependsOn) taskService.updatePlanStepStatus(taskId, dependency, 'COMPLETED');
      taskService.updateStatus(taskId, 'RUNNING'); taskService.updatePlanStepStatus(taskId, stepId, 'RUNNING');
    }
    async function noEffect(work: () => unknown | Promise<unknown>, label: string, taskId?: string) {
      const beforeHits = hits, beforeTasks = taskService.listTasks().length;
      let denied = false;
      try {
        const result = await work(); denied = result === undefined || (typeof result === 'object' && result !== null && (result as BrowserParentStepResult).success === false);
      } catch { denied = true; }
      assert.equal(denied, true, label); assert.equal(hits, beforeHits, `${label}: zero network contact`); assert.equal(taskService.listTasks().length, beforeTasks, `${label}: zero new Tasks`);
      rows.push({ scenario: label, taskId, zeroContact: true, zeroNewTasks: true });
    }
    function facadeSnapshot(taskId: string) {
      return { taskJSON: JSON.stringify(taskService.getTask(taskId)), taskCount: taskService.listTasks().length,
        auditIds: readRecentAuditEvents(200).map((event) => event.id), fixtureHits: hits };
    }
    function checkFacade(cap: BrowserParentExecutionCap, phase: 'before-running' | 'running', taskId: string, denied: boolean, label: string) {
      const before = facadeSnapshot(taskId);
      if (denied) assert.throws(() => service.assertParentExecution(cap, phase), label);
      else assert.doesNotThrow(() => service.assertParentExecution(cap, phase), label);
      assert.deepEqual(facadeSnapshot(taskId), before, `${label}: facade must not change Task, task count, audits, or HTTP contacts`);
      rows.push({ scenario: 'parent_execution_facade_readonly', label, taskId, phase, denied,
        taskUnchanged: true, zeroNewTasks: true, zeroNewAudits: true, zeroContact: true });
    }
    function checkStep(result: BrowserParentStepResult, taskId: string, stepId: string, beforeTasks: number) {
      assert.equal(result.success, true); assert.equal(result.outcome, 'verified'); assert.equal(result.scope, 'parent-step');
      assert.equal(result.taskId, taskId); assert.equal(result.stepId, stepId); assert.ok(result.evidence && result.auditEventId);
      const parsed = parseBrowserOperatorReceipt(result.receipt); assert.equal(parsed.success, true);
      if (!parsed.success) throw new Error('Invalid issued receipt');
      assert.equal(parsed.value.action, 'search'); assert.equal(parsed.value.status, 'verified'); assert.equal(parsed.value.nativePhysicalProof, false);
      assert.equal(taskService.listTasks().length, beforeTasks, 'Parent dispatch must create zero Tasks');
      const current = taskService.getTask(taskId)!; assert.equal(current.status, 'RUNNING'); assert.equal(current.verification, undefined, 'A leaf must not verify the whole parent');
      const audits = readRecentAuditEvents(200).filter((event) => event.taskId === taskId && event.id === result.auditEventId);
      assert.equal(audits.length, 1); assert.equal(audits[0].toolId, 'browser_search'); assert.equal(audits[0].action, 'tool.execute'); assert.equal(audits[0].result, 'success');
      const priorLeaves = rows.filter((row) => row.scenario === 'actual_original_parent_leaf' && row.taskId === taskId).length;
      assert.equal(readRecentAuditEvents(200).filter((event) => event.taskId === taskId && event.action === 'tool.execute').length, priorLeaves + 1, 'Each actual parent browser leaf must produce exactly one original-task audit');
      const projection = projectTaskEventsV2(current); assert.equal(projection.diagnostics.quarantinedEventCount, 0);
      sessions.push({ id: parsed.value.sessionId!, owner: binding, taskId });
      rows.push({ scenario: 'actual_original_parent_leaf', taskId, stepId, receipt: safeReceipt(parsed.value), auditEventId: result.auditEventId,
        noWholeParentVerification: true, zeroNewTasks: true, projection: { diagnostics: projection.diagnostics, types: projection.events.map((event) => event.type) } });
      taskService.recordTimeline({ taskId, type: 'tool', actor: 'owner', toolId: 'browser_search', auditEventId: result.auditEventId,
        message: 'Actual original planned browser step returned independent issued evidence.' });
      return parsed.value;
    }
    async function closeTaskSessions(taskId: string) {
      for (const session of sessions.filter((session) => session.taskId === taskId)) await service.closeSession(session.id, session.owner).catch(() => {});
    }
    function secondBrowser(plan: EdithPlan): EdithPlan {
      const source = plan.steps.find((step) => step.suggestedTools.includes('browser_search'))!;
      const next = { ...structuredClone(source), id: `${source.id}-successor`, dependsOn: [source.id], status: 'PENDING' as const };
      const verify = plan.steps.at(-1)!;
      plan.steps.splice(plan.steps.length - 1, 0, next); verify.dependsOn = [next.id]; plan.maxToolCalls = 6; return plan;
    }
    const preRunning = task(); const preRunningCap = await open(preRunning.taskId);
    checkFacade(preRunningCap.execution, 'before-running', preRunning.taskId, false, 'genuine_pre_running_execution');
    checkFacade(preRunningCap.execution, 'before-running', preRunning.taskId, false, 'same_pre_running_cap_reusable_readonly');
    checkFacade({} as BrowserParentExecutionCap, 'before-running', preRunning.taskId, true, 'forged_execution_facade');
    checkFacade({ ...preRunningCap.execution } as BrowserParentExecutionCap, 'before-running', preRunning.taskId, true, 'object_clone_execution_facade');
    checkFacade(JSON.parse(JSON.stringify(preRunningCap.execution)), 'before-running', preRunning.taskId, true, 'json_clone_execution_facade');
    checkFacade(preRunningCap.execution, 'invalid-phase' as 'running', preRunning.taskId, true, 'unknown_runtime_facade_phase');
    service.associatePlannedSearch(preRunningCap.execution, preRunning.browser[0].id);
    await noEffect(() => service.resolveParentStep(preRunningCap.execution, preRunning.browser[0].id), 'pre_running_step_lookup_denied', preRunning.taskId);
    const first = task(); const firstCount = taskService.listTasks().length; const firstCap = await open(first.taskId);
    assert.throws(() => service.captureOwner({} as any));
    await noEffect(() => service.openParentExecution({} as BrowserOwnerCap, first.taskId), 'forged_owner_cap', first.taskId);
    const firstStep = service.associatePlannedSearch(firstCap.execution, first.browser[0].id);
    await noEffect(() => service.associatePlannedSearch({ ...firstCap.execution } as BrowserParentExecutionCap, first.browser[0].id), 'object_clone_execution_cap', first.taskId);
    await noEffect(() => service.associatePlannedSearch(JSON.parse(JSON.stringify(firstCap.execution)), first.browser[0].id), 'json_clone_execution_cap', first.taskId);
    await noEffect(() => service.executeParentDom({} as BrowserParentStepCap), 'forged_step_cap', first.taskId);
    await noEffect(() => service.executeParentDom({ ...firstStep } as BrowserParentStepCap), 'object_clone_step_cap', first.taskId);
    await noEffect(() => service.executeParentDom(JSON.parse(JSON.stringify(firstStep))), 'json_clone_step_cap', first.taskId);
    ready(first.taskId, first.browser[0].id);
    checkFacade(firstCap.execution, 'before-running', first.taskId, true, 'before_running_phase_rejects_running_task');
    checkFacade(firstCap.execution, 'running', first.taskId, false, 'genuine_running_execution_before_leaf');
    assert.equal(service.resolveParentStep(firstCap.execution, first.browser[0].id), firstStep, 'Issuer lookup must return the exact capability');
    taskService.addObservation(first.taskId, 'Safe unrelated event revision before original leaf');
    assert.equal(service.resolveParentStep(firstCap.execution, first.browser[0].id), firstStep, 'Ordinary event revision must retain plan authority');
    const firstResult = await service.executeParentDom(firstStep);
    checkStep(firstResult, first.taskId, first.browser[0].id, firstCount);
    const normalized = normalizeRegisteredBrowserArgs('browser_search', { query: taskService.getTask(first.taskId)!.objective }, false);
    assert.equal(normalized.success, true); if (!normalized.success) throw new Error('Original planned request did not normalize');
    let invalidationCallbacks = 0;
    for (const [kind, detachedReceipt] of [
      ['returned_detached', firstResult.receipt!],
      ['object_clone', { ...firstResult.receipt! }],
      ['json_clone', JSON.parse(JSON.stringify(firstResult.receipt!)) as BrowserOperatorReceipt],
    ] as const) {
      const beforeAudits = JSON.stringify(readRecentAuditEvents(200).map((event) => event.id));
      await noEffect(() => getBrowserOperatorAdapter().watchIssuedSource(detachedReceipt, normalized.value,
        { actor: binding, taskId: first.taskId }, () => { invalidationCallbacks++; }), `${kind}_receipt_cannot_issue_source_watcher`, first.taskId);
      assert.equal(JSON.stringify(readRecentAuditEvents(200).map((event) => event.id)), beforeAudits, 'Denied watcher issuance must not create an audit');
      assert.equal(invalidationCallbacks, 0, 'Detached wire evidence must never acquire invalidation callback authority');
    }
    rows.push({ scenario: 'source_watcher_receipt_identity_denials', taskId: first.taskId, invalidationCallbacks,
      zeroNewAudits: true, zeroNewTasks: true, zeroContact: true });
    await noEffect(() => service.executeParentDom(firstStep), 'original_leaf_replay_denied', first.taskId);
    taskService.updatePlanStepStatus(first.taskId, first.browser[0].id, 'COMPLETED');
    assert.ok(service.readParentAggregate(first.taskId));
    const aggregate = service.readParentAggregate(first.taskId)!;
    const view = service.inspectParentAggregate(aggregate); assert.equal(view.taskId, first.taskId); assert.equal(view.steps.length, 1);
    assert.equal(view.expectedOccurrences.length, 1); assert.ok(view.requiredChecks.length && view.requiredChecks.every((check) => check.required && check.status === 'PASS'));
    assert.equal(view.commitState, 'available'); assert.match(view.verificationDigest, /^[a-f0-9]{64}$/);
    assert.throws(() => service.inspectParentAggregate({ ...aggregate } as BrowserParentAggregateCap));
    assert.throws(() => service.inspectParentAggregate(JSON.parse(JSON.stringify(aggregate))));
    assert.throws(() => service.consumeParentAggregate(aggregate, '0'.repeat(64)));
    service.consumeParentAggregate(aggregate, view.verificationDigest);
    assert.throws(() => { throw new Error('Isolated downstream writer failure after reservation'); });
    assert.throws(() => service.consumeParentAggregate(aggregate, view.verificationDigest), 'A writer failure cannot reopen the reservation');
    assert.equal(taskService.getTask(first.taskId)?.status, 'RUNNING'); assert.equal(taskService.getTask(first.taskId)?.verification, undefined);
    rows.push({ scenario: 'sealed_aggregate_one_use_writer_failure_fail_closed', taskId: first.taskId, view, verificationDigest: view.verificationDigest });
    service.revokeParentExecution(first.taskId, 'explicit_revoke'); await closeTaskSessions(first.taskId);

    for (const status of ['RUNNING', 'BLOCKED', 'CANCELLED', 'FAILED', 'COMPLETED', 'WAITING_FOR_APPROVAL', 'RECOVERING'] as const) {
      const original = task(); taskService.updateStatus(original.taskId, status); const before = JSON.stringify(taskService.getTask(original.taskId));
      const response = await api('/test/parent/open', 'POST', { taskId: original.taskId }); assert.equal(response.status, 400);
      assert.equal(JSON.stringify(taskService.getTask(original.taskId)), before, 'Admission must not revive/change the source Task');
      rows.push({ scenario: 'pre_running_admission_denial', status, taskId: original.taskId });
    }
    for (const toolId of ['browser_workflow', 'browser_open', 'playwright_browser_agent', 'duplicate_browser_search']) {
      const original = task(toolId === 'duplicate_browser_search' ? ['browser_search'] : [toolId], toolId === 'duplicate_browser_search'
        ? (plan) => { plan.steps.find((step) => step.suggestedTools.includes('browser_search'))!.suggestedTools.push('browser_search'); return plan; } : undefined);
      const beforeHits = hits;
      let denied = false;
      try { const cap = await open(original.taskId); service.associatePlannedSearch(cap.execution, original.browser[0].id); }
      catch { denied = true; }
      assert.equal(denied, true); assert.equal(hits, beforeHits); assert.equal(service.readParentAggregate(original.taskId), undefined);
      rows.push({ scenario: 'unsupported_or_duplicate_original_browser_occurrence', toolId, taskId: original.taskId });
    }
    for (const mode of ['deps', 'replan', 'budget', 'timeout', 'explicit_revoke', 'grant_revoke'] as const) {
      const original = task(mode === 'budget' ? ['browser_search', 'system_monitor'] : ['browser_search'], mode === 'budget'
        ? (plan) => ({ ...plan, maxToolCalls: 2 }) : mode === 'timeout'
        ? (plan) => ({ ...plan, taskTimeoutMs: 1000 }) : undefined);
      const cap = await open(original.taskId); const step = service.associatePlannedSearch(cap.execution, original.browser[0].id);
      ready(original.taskId, original.browser[0].id, mode !== 'deps');
      if (mode === 'replan') plannerService.planTask(original.taskId);
      if (mode === 'explicit_revoke') service.revokeParentExecution(original.taskId, 'explicit_revoke');
      if (mode === 'timeout') await sleep(1050);
      if (mode === 'grant_revoke') { const revoked = await api(`/api/edith/permissions/grants/${grantId}`, 'DELETE'); assert.equal(revoked.status, 200); }
      if (mode === 'budget') {
        // Exhaust a valid original two-tool budget using real canonical read-only calls and their real audits.
        for (let iteration = 0; iteration < 2; iteration++) {
          const result = await executeEdithTool('system_monitor', {}, { actor: 'edith-executor', taskId: original.taskId });
          assert.equal(result.success, true); assert.ok(result.auditEventId);
          taskService.recordTimeline({ taskId: original.taskId, type: 'tool', actor: 'edith-executor', toolId: 'system_monitor',
            auditEventId: result.auditEventId, message: 'Actual planned system observation consumed a bounded tool call.' });
        }
        await noEffect(() => service.executeParentDom(step), 'captured_tool_call_budget_denies_browser_after_actual_usage', original.taskId);
      } else await noEffect(() => service.executeParentDom(step), `current_${mode}_denied`, original.taskId);
      assert.equal(service.readParentAggregate(original.taskId), undefined);
      checkFacade(cap.execution, 'running', original.taskId, mode !== 'deps', `current_${mode}_facade_after_existing_checks`);
      service.revokeParentExecution(original.taskId, 'explicit_revoke');
      if (mode === 'grant_revoke') await grant();
    }

    for (const mode of ['missing', 'skipped', 'both'] as const) {
      const original = task(['browser_search'], secondBrowser); const cap = await open(original.taskId);
      const first = service.associatePlannedSearch(cap.execution, original.browser[0].id);
      const second = service.associatePlannedSearch(cap.execution, original.browser[1].id); const count = taskService.listTasks().length;
      ready(original.taskId, original.browser[0].id); checkStep(await service.executeParentDom(first), original.taskId, original.browser[0].id, count);
      taskService.updatePlanStepStatus(original.taskId, original.browser[0].id, 'COMPLETED');
      assert.equal(service.readParentAggregate(original.taskId), undefined, 'One proof cannot aggregate two required browser occurrences');
      if (mode === 'skipped') { taskService.updatePlanStepStatus(original.taskId, original.browser[1].id, 'SKIPPED'); assert.equal(service.readParentAggregate(original.taskId), undefined); }
      if (mode === 'both') {
        taskService.updatePlanStepStatus(original.taskId, original.browser[1].id, 'RUNNING');
        checkStep(await service.executeParentDom(second), original.taskId, original.browser[1].id, count);
        taskService.updatePlanStepStatus(original.taskId, original.browser[1].id, 'COMPLETED');
        const aggregate = service.readParentAggregate(original.taskId); assert.ok(aggregate); const view = service.inspectParentAggregate(aggregate);
        assert.equal(view.expectedOccurrences.length, 2); assert.equal(view.steps.length, 2);
        assert.deepEqual(view.steps.map((step) => step.stepId), original.browser.map((step) => step.id));
        rows.push({ scenario: 'two_required_original_browser_proofs_causal_aggregate', taskId: original.taskId, view });
      } else rows.push({ scenario: 'two_required_browser_occurrences_no_incomplete_aggregate', mode, taskId: original.taskId });
      service.revokeParentExecution(original.taskId, 'explicit_revoke'); await closeTaskSessions(original.taskId);
    }

    for (const mode of ['cancel', 'pause', 'revoke', 'mismatch', 'owner_logout'] as const) {
      const original = task(); const cap = await open(original.taskId); const step = service.associatePlannedSearch(cap.execution, original.browser[0].id);
      ready(original.taskId, original.browser[0].id); const count = taskService.listTasks().length;
      holdNext = true; let resolveObserved!: () => void;
      const observed = new Promise<void>((resolve) => { resolveObserved = resolve; }); held = { release: () => {}, observed }; notifyHeld = resolveObserved;
      const running = service.executeParentDom(step);
      let timer: NodeJS.Timeout | undefined;
      try { await Promise.race([observed, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Actual fixture search did not arrive')), 15_000); })]); }
      finally { if (timer) clearTimeout(timer); }
      if (mode === 'cancel') taskService.updateStatus(original.taskId, 'CANCELLED');
      if (mode === 'pause') taskService.updateStatus(original.taskId, 'BLOCKED');
      if (mode === 'revoke') service.revokeParentExecution(original.taskId, 'explicit_revoke');
      if (mode === 'mismatch') omitResultsNext = true;
      if (mode === 'owner_logout') { const response = await api('/api/security/session', 'DELETE'); assert.equal(response.status, 200); }
      held.release(); const result = await running; held = undefined; notifyHeld = undefined;
      assert.equal(result.success, false);
      if (mode === 'mismatch') { assert.equal(result.outcome, 'partial'); assert.equal(result.receipt?.reasonCode, 'READBACK_MISMATCH'); }
      if (result.receipt?.sessionId) sessions.push({ id: result.receipt.sessionId, owner: binding, taskId: original.taskId });
      assert.equal(taskService.listTasks().length, count); assert.equal(service.readParentAggregate(original.taskId), undefined);
      checkFacade(cap.execution, 'running', original.taskId, true, `late_${mode}_facade_denied`);
      if (mode === 'cancel') assert.equal(taskService.getTask(original.taskId)?.status, 'CANCELLED');
      if (mode === 'pause') assert.equal(taskService.getTask(original.taskId)?.status, 'BLOCKED');
      rows.push({ scenario: 'late_actual_search_authority_loss_or_partial_tombstone', mode, taskId: original.taskId,
        outcome: result.outcome, receipt: safeReceipt(result.receipt), nativePhysicalProof: result.receipt?.nativePhysicalProof ?? false });
      await noEffect(() => service.executeParentDom(step), `late_${mode}_replay_denied`, original.taskId);
      service.revokeParentExecution(original.taskId, 'unknown_effect');
      if (mode === 'owner_logout') { await login(); await grant(); }
      taskService.updateStatus(original.taskId, 'PLANNING'); plannerService.planTask(original.taskId);
      const retry = await api('/test/parent/open', 'POST', { taskId: original.taskId }); assert.equal(retry.status, 400, 'Replan cannot erase a possible-effect tombstone');
      await closeTaskSessions(original.taskId);
    }
    // Storage-only mutations below are explicitly negative isolated source fixtures, never fabricated positive evidence.
    for (const mode of ['expired_deadline', 'invalid_deadline', 'interrupted_queue', 'resumable_queue', 'quarantined_legacy_history'] as const) {
      const original = task(); const source = taskService.getTask(original.taskId)!;
      const next = structuredClone(source);
      if (mode === 'expired_deadline') next.deadline = new Date(Date.now() - 1000).toISOString();
      if (mode === 'invalid_deadline') next.deadline = 'invalid-fixture-deadline';
      if (mode === 'interrupted_queue') next.queue = { state: 'interrupted' };
      if (mode === 'resumable_queue') next.queue = { state: 'resumable' };
      if (mode === 'quarantined_legacy_history') next.timeline.push({ id: `negative-legacy-${randomUUID()}`, taskId: original.taskId, type: 'tool',
        createdAt: new Date().toISOString(), actor: 'negative-isolated-history-fixture', message: 'Legacy row must not authorize a parent attempt.' });
      getEdithPersistenceStore().updateTask(next);
      const actual = taskService.getTask(original.taskId)!; const projection = projectTaskEventsV2(actual);
      if (mode === 'quarantined_legacy_history') assert.ok(projection.diagnostics.quarantinedEventCount > 0, 'The negative persisted row must actually quarantine');
      const before = JSON.stringify(actual), beforeHits = hits, count = taskService.listTasks().length;
      const denied = await api('/test/parent/open', 'POST', { taskId: original.taskId }); assert.equal(denied.status, 400);
      assert.equal(JSON.stringify(taskService.getTask(original.taskId)), before); assert.equal(hits, beforeHits); assert.equal(taskService.listTasks().length, count);
      rows.push({ scenario: 'negative_actual_source_admission_fixture', mode, taskId: original.taskId,
        sourceMutation: 'isolated persistence metadata/negative legacy row only; no fabricated audit or receipt', diagnostics: projection.diagnostics, zeroContact: true });
    }
    for (const mode of ['finite_deadline_elapsed', 'deadline_shortened_after_issuance'] as const) {
      const original = task(); const source = taskService.getTask(original.taskId)!;
      getEdithPersistenceStore().updateTask({ ...source, deadline: new Date(Date.now() + (mode === 'finite_deadline_elapsed' ? 1000 : 60_000)).toISOString() });
      const cap = await open(original.taskId), step = service.associatePlannedSearch(cap.execution, original.browser[0].id);
      ready(original.taskId, original.browser[0].id);
      if (mode === 'finite_deadline_elapsed') await sleep(1050);
      else getEdithPersistenceStore().updateTask({ ...taskService.getTask(original.taskId)!, deadline: new Date(Date.now() - 1000).toISOString() });
      await noEffect(() => service.executeParentDom(step), mode, original.taskId);
      assert.equal(service.readParentAggregate(original.taskId), undefined); assert.equal(taskService.getTask(original.taskId)?.status, 'RUNNING');
      assert.equal(taskService.getTask(original.taskId)?.verification, undefined); service.revokeParentExecution(original.taskId, 'expired');
    }
    for (const mode of ['normal_same_root_mutation', 'same_url_set_content', 'same_url_document_open_write', 'same_turn_original_body_remove_reinsert'] as const) {
      const original = task(), cap = await open(original.taskId), step = service.associatePlannedSearch(cap.execution, original.browser[0].id);
      ready(original.taskId, original.browser[0].id); const count = taskService.listTasks().length;
      const result = await service.executeParentDom(step); const receipt = checkStep(result, original.taskId, original.browser[0].id, count);
      taskService.updatePlanStepStatus(original.taskId, original.browser[0].id, 'COMPLETED');
      assert.ok(service.readParentAggregate(original.taskId), 'Genuine proof must aggregate before unplanned source replacement');
      const actualPage = getBrowserOperatorAdapter().sessions.get(receipt.sessionId!, binding).pages.get(receipt.pageId!); assert.ok(actualPage);
      const oldRoot = await actualPage.$('html'), oldBody = await actualPage.$('body'); assert.ok(oldRoot && oldBody);
      const beforeUrl = actualPage.url();
      const cdp = await actualPage.context().newCDPSession(actualPage);
      const beforeFrame = (await cdp.send('Page.getFrameTree')).frameTree.frame;
      try {
        let sameTurnRetainedAtMutation: boolean | undefined;
        if (mode === 'normal_same_root_mutation') await actualPage.evaluate(() => {
          const addition = document.createElement('aside'); addition.textContent = 'An unrelated safe same-root mutation'; document.body.append(addition);
        });
        else if (mode === 'same_turn_original_body_remove_reinsert') sameTurnRetainedAtMutation = await actualPage.evaluate(() => {
          const body = document.body, root = document.documentElement;
          body.remove(); root.append(body);
          return body.isConnected && body === document.body && root === document.documentElement;
        });
        else {
          const replacement = '<!doctype html><html><head><title>Actual replacement source fixture</title></head><body><main data-search-results><a href="/result">Replacement result</a></main></body></html>';
          if (mode === 'same_url_set_content') await actualPage.setContent(replacement);
          else await actualPage.evaluate((content) => { document.open(); document.write(content); document.close(); }, replacement);
        }
        await sleep(50); const afterFrame = (await cdp.send('Page.getFrameTree').catch(() => undefined))?.frameTree.frame;
        let rootRetained = false, bodyRetained = false;
        try { rootRetained = await oldRoot.evaluate((node) => node.isConnected); } catch { /* Real source context destruction invalidates it. */ }
        try { bodyRetained = await oldBody.evaluate((node) => node.isConnected); } catch { /* Real source context destruction invalidates it. */ }
        assert.equal(actualPage.url(), beforeUrl, 'The source replacement must retain the genuine URL');
        const aggregate = service.readParentAggregate(original.taskId);
        rows.push({ scenario: 'actual_latest_issued_source_fence', mode, taskId: original.taskId,
          beforeUrlSha256: hash(beforeUrl), afterUrlSha256: hash(actualPage.url()), beforeLoaderId: beforeFrame.loaderId,
          afterLoaderId: afterFrame?.loaderId, frameId: afterFrame?.id, sourcePageClosed: actualPage.isClosed(), rootRetained, bodyRetained,
          aggregateAvailable: aggregate !== undefined, sameTurnRetainedAtMutation, nativePhysicalProof: false });
        if (mode === 'normal_same_root_mutation') { assert.equal(rootRetained, true); assert.equal(bodyRetained, true); assert.ok(aggregate, 'A safe mutation preserving retained roots must not fabricate source loss'); }
        else if (mode === 'same_turn_original_body_remove_reinsert') { assert.equal(sameTurnRetainedAtMutation, true); assert.equal(aggregate, undefined, 'Actual removal must latch source loss even when the original body reconnects in the same turn'); }
        else { assert.equal(rootRetained, false); assert.equal(bodyRetained, false); assert.equal(aggregate, undefined, 'Unplanned actual root/body replacement must destroy current aggregate authority'); }
        checkFacade(cap.execution, 'running', original.taskId, mode !== 'normal_same_root_mutation', `${mode}_source_facade`);
        assert.equal(taskService.getTask(original.taskId)?.status, 'RUNNING'); assert.equal(taskService.getTask(original.taskId)?.verification, undefined);
        await noEffect(() => service.executeParentDom(step), `${mode}_old_effect_replay_denied`, original.taskId);
      } finally { await oldRoot.dispose().catch(() => {}); await oldBody.dispose().catch(() => {}); await cdp.detach().catch(() => {}); }
      service.revokeParentExecution(original.taskId, 'explicit_revoke'); await closeTaskSessions(original.taskId);
    }
    // A claimed genuine browser occurrence does not make the whole execution unusable for an ordinary planned await.
    const mixed = task(['browser_search', 'system_monitor']), mixedCap = await open(mixed.taskId);
    const mixedStep = service.associatePlannedSearch(mixedCap.execution, mixed.browser[0].id);
    checkFacade(mixedCap.execution, 'before-running', mixed.taskId, false, 'mixed_original_pre_running');
    ready(mixed.taskId, mixed.browser[0].id);
    const mixedCount = taskService.listTasks().length;
    checkStep(await service.executeParentDom(mixedStep), mixed.taskId, mixed.browser[0].id, mixedCount);
    taskService.updatePlanStepStatus(mixed.taskId, mixed.browser[0].id, 'COMPLETED');
    checkFacade(mixedCap.execution, 'running', mixed.taskId, false, 'claimed_browser_execution_before_ordinary_await');
    const ordinary = await executeEdithTool('system_monitor', {}, { actor: 'edith-executor', taskId: mixed.taskId });
    assert.equal(ordinary.success, true); assert.ok(ordinary.auditEventId);
    const ordinaryAudits = readRecentAuditEvents(200).filter((event) => event.id === ordinary.auditEventId && event.taskId === mixed.taskId);
    assert.equal(ordinaryAudits.length, 1); assert.equal(ordinaryAudits[0].toolId, 'system_monitor'); assert.equal(ordinaryAudits[0].result, 'success');
    taskService.recordTimeline({ taskId: mixed.taskId, type: 'tool', actor: 'edith-executor', toolId: 'system_monitor',
      auditEventId: ordinary.auditEventId, message: 'Actual ordinary planned observation after the original browser proof.' });
    checkFacade(mixedCap.execution, 'running', mixed.taskId, false, 'claimed_browser_execution_after_ordinary_await');
    assert.equal(taskService.getTask(mixed.taskId)?.status, 'RUNNING'); assert.equal(taskService.getTask(mixed.taskId)?.verification, undefined);
    rows.push({ scenario: 'claimed_original_browser_then_real_ordinary_await', taskId: mixed.taskId, ordinaryAuditEventId: ordinary.auditEventId,
      zeroNewTasks: taskService.listTasks().length === mixedCount, noWholeParentVerification: true });
    assert.equal(taskService.listTasks().length, mixedCount);
    service.revokeParentExecution(mixed.taskId, 'explicit_revoke'); await closeTaskSessions(mixed.taskId);
    fs.writeFileSync(path.join(reports, 'evidence.json'), JSON.stringify({ success: true, actualHeaded: true, nativePhysicalProof: false, rows }, null, 2));
    console.log(JSON.stringify({ success: true, actualHeaded: true, producerOnly: true, nativePhysicalProof: false, checks: rows.length }));
  } finally {
    held?.release();
    fs.writeFileSync(path.join(reports, 'attempt-evidence.json'), JSON.stringify({ actualHeaded: true, nativePhysicalProof: false, rows, hits, recordedAt: new Date().toISOString() }, null, 2));
    try { await getBrowserOperatorAdapter().closeAll(); }
    finally {
      await close(apiServer); await close(fixtureServer); delete process.env.EDITH_OWNER_TOKEN; delete process.env.EDITH_OWNER_TOKEN_ONE_TIME;
      fs.writeFileSync(path.join(reports, 'cleanup.json'), JSON.stringify({ ownServersClosed: !apiServer?.listening && !fixtureServer?.listening, sessions, recordedAt: new Date().toISOString() }, null, 2));
    }
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
