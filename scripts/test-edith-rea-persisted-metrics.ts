import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { ReaSafeReport } from '../src/edith/reaAnalysisService';
import type { ReaReceiptCorrelationV1 } from '../src/edith/reaIntegrationContract';
import type { ReaTaskMetricSourceDependencies } from '../src/edith/reaTaskMetricSource';
import type { ToolExecutionLog } from '../src/types';

// Run only through run-edith-isolated-test.mjs, before singleton-bearing imports.
assert.equal(process.env.EDITH_TEST_MODE, 'true');
const tools = await import('../src/edith/reaTools');
assert.equal(typeof tools.createReaReceiptObservedMetrics, 'function', 'receipt-clock metric helper must exist');
const { createReaTaskMetricSource } = await import('../src/edith/reaTaskMetricSource');
const { TaskService } = await import('../src/edith/taskService');
const { getEdithPersistenceStore } = await import('../src/edith/persistence');
const { createAuditEvent } = await import('../src/edith/audit');
const { reaProjectionDigest } = await import('../src/edith/reaIntegrationContract');
const { projectTaskEventsV2 } = await import('../src/edith/contracts');

let cases = 0;
function test(name: string, work: () => void) { work(); cases++; console.log('PASS ' + name); }
const store = getEdithPersistenceStore();
assert.equal(store.kind, 'json');
assert.equal(path.resolve(store.getPaths().dataDir), path.resolve(process.env.EDITH_TEST_DATA_DIR!));
const service = new TaskService();
const task = service.createTask({ title: 'Synthetic persisted REA metrics', objective: 'Validate persisted metric provenance', originalUserRequest: 'fixture', toolsRequired: ['rea_analysis'] });
const identity = { taskId: task.id, planId: 'metric_plan', stepId: 'metric_step', runId: 'logical_metric_run', attempt: 2 };
const call = { toolId: 'rea_analysis' as const, args: { schemaVersion: 1 as const, selectionRef: 'service_selection', profile: 'static-managed' as const, objective: 'Inspect fixture' } };
service.attachPlan(task.id, { id: identity.planId, taskId: task.id, objective: task.objective, createdAt: new Date().toISOString(), planner: 'heuristic-v1', status: 'READY',
  steps: [{ id: identity.stepId, title: 'Inspect fixture', objective: task.objective, status: 'RUNNING', dependsOn: [], suggestedTools: ['rea_analysis'], requiredPermissions: [], validationCriteria: [], riskLevel: 0, reaCall: call }],
  requiredTools: ['rea_analysis'], requiredPermissions: [], requiredAgents: [], validationCriteria: [], stopConditions: [], maxIterations: 1, maxRetries: 0, maxToolCalls: 1, taskTimeoutMs: 1000 });
const finishedAt = new Date(Date.now() - 20).toISOString(), receiptObservedAt = new Date(Date.now() - 10).toISOString();
const audit = createAuditEvent({ actor: 'metric_fixture', taskId: task.id, toolId: 'rea_analysis', action: 'tool.execute', authorization: 'allowed', riskLevel: 0, result: 'error' });
const expected: ReaReceiptCorrelationV1 = { identity, toolRunId: 'toolrun_metric_fixture', auditEventId: audit.id, selectionRef: 'public_selection', selectionRevision: 1, inputDigest: reaProjectionDigest(call) };
const evidenceId = 'ev_' + 'a'.repeat(64);
const report = { profile: 'static-managed', sourceProjectionDigest: 'b'.repeat(64), coverage: 'unverified', summary: 'Fixture', spokenSummary: 'Fixture', knowledgeMarkdown: 'Fixture' };
const receipt = { schemaVersion: 1, toolId: 'rea_analysis', ...expected, finishedAt, receiptObservedAt, outcome: 'partial', reasonCode: 'REA_EVIDENCE_VERIFIED', cleanup: { closed: true, unknownEffect: false },
  evidenceIndex: [{ ref: 'evidence_1', originalEvidenceId: evidenceId }], report, reportDigest: reaProjectionDigest(report),
  observedMetrics: { schemaVersion: 1, attempt: 2, observedAt: receiptObservedAt, clock: 'adapter_receipt', source: 'tool_result', coverage: 'partial', scope: { kind: 'tool_run', stepId: identity.stepId, targetRefId: expected.selectionRef }, evidenceRefs: ['evidence_1'], values: [{ name: 'rea.verified_evidence_records', unit: 'count', value: 1 }] } };
const log = { id: expected.toolRunId, toolId: 'rea_analysis', toolName: 'REA fixture', args: { schemaVersion: 1, toolId: 'rea_analysis' }, result: JSON.stringify(receipt), timestamp: Date.parse(finishedAt), status: 'error' as const };
store.appendAuditEvent(audit);
service.addArtifact(task.id, `rea_receipt:${expected.toolRunId}:${audit.id}`);
assert.ok(store.recordToolRun); store.recordToolRun(log);
// JSON recordToolRun appends; tamper exactly one owned persisted row instead of creating duplicate IDs.
const replaceLog = (value: ToolExecutionLog) => fs.writeFileSync(path.join(store.getPaths().dataDir, 'tool-runs.json'), JSON.stringify([value]));
let allowed = true;
let reenter: (() => void) | undefined;
const dependencies: ReaTaskMetricSourceDependencies = {
  store, readExpected: (id, run) => { const action = reenter; reenter = undefined; action?.(); return id === task.id && run === audit.id ? expected : undefined; },
  readCommitment: (id, run) => id === task.id && run === audit.id ? { receiptDigest: reaProjectionDigest(receipt), finishedAt, receiptObservedAt } : undefined,
  assertAuthority: (id, run, scope) => { if (!allowed || id !== task.id || run !== audit.id || scope && (scope.stepId !== identity.stepId || scope.targetRefId !== expected.selectionRef)) throw new Error('FIXTURE_AUTHORITY_REVOKED'); },
};
const source = createReaTaskMetricSource(dependencies);
test('copied JSON report never obtains the live metric brand', () => {
  const copied = JSON.parse(JSON.stringify({ ...report, evidenceRefs: [evidenceId], observedMetrics: [{ value: 1 }] })) as ReaSafeReport;
  assert.throws(() => tools.createReaReceiptObservedMetrics(copied, { attempt: 2, stepId: identity.stepId, targetRefId: expected.selectionRef, finishedAt, receiptObservedAt, evidenceIndex: receipt.evidenceIndex, assertCurrent() {} }), /REA_REPORT_UNTRUSTED/);
});
test('persisted source maps logical run and tool run to actual audit run', () => {
  source.assertAuthority(task.id, audit.id);
  const actual = source.readReceipt(task.id, audit.id)!;
  assert.equal(actual.runId, audit.id); assert.notEqual(actual.runId, identity.runId); assert.equal(actual.attempt, 2);
  assert.deepEqual(source.readEvidence('evidence_1'), { taskId: task.id, runId: audit.id, toolId: 'rea_analysis', attempt: 2, stepId: identity.stepId, targetRefId: expected.selectionRef });
});
test('actual TaskService publishes once and deduplicates the same persisted audit receipt', () => {
  const consumer = new TaskService([source]);
  const first = consumer.recordToolObservation(task.id, audit.id);
  const second = consumer.recordToolObservation(task.id, audit.id);
  const events = projectTaskEventsV2(second).events.filter(event => event.type === 'task.tool_completed' && event.payload.runId === audit.id);
  assert.equal(events.length, 1); assert.equal(first.eventSequence, second.eventSequence);
  assert.equal(events[0].type === 'task.tool_completed' && events[0].payload.observedMetrics?.values[0].value, 1);
});
test('receipt cursor cannot leak local evidence across failed or revoked reads', () => {
  source.readReceipt(task.id, audit.id); allowed = false;
  assert.throws(() => source.readEvidence('evidence_1'), /REVOKED|REA_/); allowed = true;
  assert.throws(() => source.readReceipt(task.id, identity.runId), /REA_|REVOKED/);
  assert.equal(source.readEvidence('evidence_1'), undefined);
});
test('tampered count clock digest and independent correlation are rejected', () => {
  for (const altered of [
    { ...receipt, observedMetrics: { ...receipt.observedMetrics, attempt: 3 } },
    { ...receipt, observedMetrics: { ...receipt.observedMetrics, values: [{ name: 'rea.verified_evidence_records', unit: 'count', value: 2 }] } },
    { ...receipt, receiptObservedAt: new Date(Date.parse(finishedAt) - 1).toISOString() },
    { ...receipt, inputDigest: 'd'.repeat(64) },
    { ...receipt, reportDigest: 'e'.repeat(64) },
  ]) {
    replaceLog({ ...log, result: JSON.stringify(altered) });
    assert.throws(() => source.readReceipt(task.id, audit.id), /REA_/);
  }
  replaceLog(log);
});
test('missing actual task artifact or changed stored plan is not provenance', () => {
  const actual = store.listTasks().find(candidate => candidate.id === task.id)!;
  store.updateTask({ ...actual, artifacts: [] }); assert.throws(() => source.readReceipt(task.id, audit.id), /REA_/);
  store.updateTask(actual);
  store.updateTask({ ...actual, plan: { ...actual.plan!, id: 'foreign_plan' } }); assert.throws(() => source.readReceipt(task.id, audit.id), /REA_/);
  store.updateTask(actual);
});
test('swallowed synchronous reentry invalidates the outer receipt read', () => {
  reenter = () => { try { source.readReceipt(task.id, audit.id); } catch { /* Hostile dependency swallows the denied recursive read. */ } };
  assert.throws(() => source.readReceipt(task.id, audit.id), /REA_/);
  assert.equal(source.readEvidence('evidence_1'), undefined);
  assert.ok(source.readReceipt(task.id, audit.id));
});
test('independent stored commitment rejects a self-consistent rewritten report or clock', () => {
  const rewritten = { ...report, summary: 'Different internally consistent report' };
  replaceLog({ ...log, result: JSON.stringify({ ...receipt, report: rewritten, reportDigest: reaProjectionDigest(rewritten) }) });
  assert.throws(() => source.readReceipt(task.id, audit.id), /REA_/);
  const changedClock = new Date(Date.parse(receiptObservedAt) - 1).toISOString();
  replaceLog({ ...log, result: JSON.stringify({ ...receipt, receiptObservedAt: changedClock, observedMetrics: { ...receipt.observedMetrics, observedAt: changedClock } }) });
  assert.throws(() => source.readReceipt(task.id, audit.id), /REA_/);
  replaceLog(log);
});
test('persisted carrier rejects arbitrary arguments and a receipt captured after its audit', () => {
  replaceLog({ ...log, args: { ...log.args, path: 'C:/untrusted' } });
  assert.throws(() => source.readReceipt(task.id, audit.id), /REA_/);
  const afterAudit = new Date(Date.parse(audit.timestamp) + 1).toISOString();
  replaceLog({ ...log, result: JSON.stringify({ ...receipt, receiptObservedAt: afterAudit, observedMetrics: { ...receipt.observedMetrics, observedAt: afterAudit } }) });
  assert.throws(() => source.readReceipt(task.id, audit.id), /REA_/);
  replaceLog(log);
});
console.log(JSON.stringify({ suite: 'rea-persisted-metrics', passed: cases, syntheticPersistence: true, runtimeReady: false, liveBrandPositive: 'parent canonical fixture required' }));
