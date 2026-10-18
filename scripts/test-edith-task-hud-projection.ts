import assert from 'node:assert/strict';
import type { EdithPlanStep } from '../src/edith/core';
import type { TaskActivityV2View, TaskV2View } from '../src/edith/taskActivityClient';

// Removing selection correlation, privacy filtering, count checks or the running-row
// priority must break these independent fixture expectations.
const imported = await import('../src/components/tasks/taskHudProjection').catch((error: NodeJS.ErrnoException) => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return undefined;
  throw error;
});
assert.equal(typeof imported?.projectTaskHud, 'function', 'pure HUD projection must exist');
assert.equal(typeof imported?.safeTaskHudTitle, 'function', 'bounded title policy must exist');
const { projectTaskHud, safeTaskHudTitle } = imported!;

function step(id: string, status: EdithPlanStep['status']): EdithPlanStep {
  return { id, title: `Adım ${id}`, status, objective: 'Never display this', dependsOn: [], suggestedTools: [], requiredPermissions: [], validationCriteria: [], riskLevel: 0 };
}
function task(id = 'fixture-one', status: TaskV2View['status'] = 'RUNNING', steps?: EdithPlanStep[]): TaskV2View {
  return {
    id, title: 'Yerel görev', objective: 'PRIVATE OBJECTIVE', originalUserRequest: 'PRIVATE REQUEST',
    priority: 'normal', status, createdAt: '2026-10-17T00:00:00Z', dependencies: [], subtasks: [],
    candidateAgents: [], toolsRequired: [], permissionsRequired: [], riskLevel: 0, checkpoints: [], artifacts: [],
    observations: [], validationRules: [], timeline: [], agentActivity: [], memoryReferences: [], auditEvents: [],
    contractVersion: 2, revision: 3, eventSequence: 0,
    ...(steps ? { plan: { id: 'fixture-plan', taskId: id, objective: 'PRIVATE PLAN', createdAt: '2026-10-17T00:00:00Z', planner: 'heuristic-v1' as const, status: 'READY' as const, steps, requiredTools: [], requiredPermissions: [], requiredAgents: [], validationCriteria: [], stopConditions: [], maxIterations: 1, maxRetries: 0, maxToolCalls: 1, taskTimeoutMs: 1000 } } : {}),
    progress: { contractVersion: 2, taskId: id, revision: 3, status, percent: 90, completedSteps: steps?.filter(s => s.status === 'COMPLETED' || s.status === 'SKIPPED').length ?? 0, totalSteps: steps?.length ?? 0, failedSteps: steps?.filter(s => s.status === 'FAILED').length ?? 0, recoveryAttempts: 0, terminal: ['COMPLETED', 'FAILED', 'CANCELLED', 'ROLLED_BACK'].includes(status), sources: ['task_status', 'plan_steps'] },
  };
}
function activity(value: TaskV2View): TaskActivityV2View {
  return { task: value, progress: value.progress, events: [], history: { state: 'empty', missingSequences: [], quarantinedEvents: 0 } };
}
function project(value: TaskV2View) {
  return projectTaskHud({ state: 'ready', tasks: [value], activity: activity(value), selection: { kind: 'automatic' }, lastSuccessfulReadAt: 1000, now: 1001 });
}

assert.equal(safeTaskHudTitle('Türkçe görev'), 'Türkçe görev');
for (const title of ['', 'https://example.invalid/x', 'example.com/private', 'C:\\private\\file', '/home/private', '../private', '\\\\server\\share', 'file:///private', 'Bearer abcdefghijklmnop', 'password=fixture', 'api_key: fixture', 'token fixture', 'sk-proj-fixturecredential', 'user:pass@example.invalid', 'bad\nlabel', 'bad\u202elabel', 'bad\u0000label']) {
  assert.equal(safeTaskHudTitle(title), 'Görev ayrıntıları', `unsafe title suppressed: ${JSON.stringify(title)}`);
}
assert.ok(safeTaskHudTitle('a'.repeat(500)).length <= 120);
for (const title of ['access_token=fixture', 'client_secret: fixture', 'private_key: fixture', 'C:private']) {
  assert.equal(safeTaskHudTitle(title), 'Görev ayrıntıları', 'credential aliases and drive-relative paths stay private');
}
const original = task();
const before = JSON.stringify(original);
const initial = project(original);
assert.equal(JSON.stringify(original), before, 'projection never mutates its DTO');
assert.equal(initial.selected?.safeTitle, 'Yerel görev');
assert.equal(initial.selected?.verification, 'unverified');
assert.equal(initial.selected?.stepCounts, undefined, 'no plan means no ratio');
assert.deepEqual(initial.metrics, []);
assert.equal('percent' in initial.selected!, false);
assert.equal(JSON.stringify(initial).includes('PRIVATE'), false);

const rows = [step('a', 'COMPLETED'), step('skip', 'SKIPPED'), step('b', 'COMPLETED'), step('c', 'COMPLETED'), step('run1', 'RUNNING'), step('run2', 'RUNNING'), step('fail', 'FAILED'), step('wait', 'READY')];
const planned = project(task('fixture-one', 'RUNNING', rows));
assert.deepEqual(planned.selected?.stepCounts, { completed: 3, skipped: 1, failed: 1, total: 8 });
assert.deepEqual(planned.selected?.steps.map(s => s.id), ['b', 'c', 'run1', 'run2']);
assert.equal(planned.selected?.omittedStepCount, 4);
const parallel = project(task('fixture-one', 'RUNNING', [step('old', 'COMPLETED'), ...Array.from({ length: 7 }, (_, i) => step(`run${i}`, 'RUNNING'))]));
assert.deepEqual(parallel.selected?.steps.map(s => s.id), ['run0', 'run1', 'run2', 'run3', 'run4']);
assert.equal(parallel.selected?.omittedStepCount, 3);
assert.deepEqual(project(task('fixture-one', 'PLANNING', [step('ready', 'READY'), step('pending', 'PENDING')])).selected?.steps, []);
const inconsistent = task('fixture-one', 'RUNNING', rows);
inconsistent.progress.completedSteps = 3;
assert.equal(project(inconsistent).selected?.stepCounts, undefined);
assert.equal(project(inconsistent).selected?.integrity, 'snapshot-conflict');
const duplicateSteps = task('duplicates', 'RUNNING', [step('same', 'COMPLETED'), step('same', 'RUNNING')]);
assert.equal(project(duplicateSteps).selected?.stepCounts, undefined, 'duplicate plan identities cannot establish coherent counts');
assert.equal(project(duplicateSteps).selected?.integrity, 'snapshot-conflict');
assert.deepEqual(project(duplicateSteps).selected?.steps, [], 'conflicting step identities must not render ambiguous rows');
assert.equal(project(duplicateSteps).selected?.omittedStepCount, 2);
for (const changed of ['totalSteps', 'failedSteps'] as const) {
  const conflict = task('incoherent-counts', 'RUNNING', rows);
  conflict.progress[changed] += 1;
  assert.equal(project(conflict).selected?.stepCounts, undefined);
  assert.equal(project(conflict).selected?.integrity, 'snapshot-conflict');
}

const selected = task();
const input = { state: 'ready' as const, tasks: [task('done', 'COMPLETED'), task('new', 'CREATED'), selected], activity: activity(selected), selection: { kind: 'explicit' as const, taskId: selected.id }, now: 2000, lastSuccessfulReadAt: 1000 };
assert.deepEqual(projectTaskHud(input).fetchedListCounts, { nonterminal: 2, running: 1, scope: 'fetched-list' });
for (const state of ['error', 'offline', 'loading', 'reconnecting'] as const) {
  assert.equal(projectTaskHud({ ...input, state, tasks: [] }).fetchedListCounts, undefined, 'failed/unfinished empty reads cannot fabricate a fetched-list zero');
}
for (const state of ['error', 'offline', 'loading'] as const) {
  assert.equal(projectTaskHud({ ...input, state }).fetchedListCounts, undefined, 'only usable list snapshots produce counts');
}
assert.deepEqual(projectTaskHud({ ...input, state: 'reconnecting' }).fetchedListCounts, { nonterminal: 2, running: 1, scope: 'fetched-list' });
assert.equal(projectTaskHud({ ...input, state: 'reconnecting', lastSuccessfulReadAt: undefined }).fetchedListCounts, undefined);
assert.deepEqual(projectTaskHud({ ...input, state: 'empty', tasks: [] }).fetchedListCounts, { nonterminal: 0, running: 0, scope: 'fetched-list' }, 'successful empty lists establish an observed zero');
assert.equal(projectTaskHud({ ...input, selection: { kind: 'awaiting-task-link' } }).selected, undefined);
assert.equal(projectTaskHud({ ...input, selection: { kind: 'awaiting-task-link' } }).selectionState, 'awaiting-link');
assert.equal(projectTaskHud({ ...input, selection: { kind: 'explicit', taskId: 'missing' } }).selectionState, 'unavailable');
assert.equal(projectTaskHud({ ...input, selection: { kind: 'automatic' } }).selected, undefined, 'mismatching automatic activity is not adopted');
assert.equal(projectTaskHud({ ...input, tasks: [selected], selection: { kind: 'automatic' } }).selectionState, 'selected');
assert.equal(project(task('old', 'COMPLETED')).selected?.historical, true);
assert.equal(projectTaskHud({ state: 'empty', tasks: [], selection: { kind: 'automatic' }, now: 1 }).selectionState, 'unselected');
assert.equal(projectTaskHud({ state: 'loading', tasks: [], selection: { kind: 'automatic' }, now: 1 }).fetchedListCounts, undefined);
assert.equal(projectTaskHud({ ...input, now: 25000 }).freshness, 'stale');
assert.equal(projectTaskHud({ ...input, now: 24999 }).freshness, 'snapshot');
for (const state of ['offline', 'error'] as const) assert.equal(projectTaskHud({ ...input, state }).freshness, 'stale');
for (const state of ['loading', 'reconnecting'] as const) assert.equal(projectTaskHud({ ...input, state }).freshness, 'refreshing');
assert.equal(projectTaskHud({ ...input, lastSuccessfulReadAt: undefined }).freshness, 'unchecked');
assert.equal(projectTaskHud({ ...input, lastSuccessfulReadAt: 3000 }).freshness, 'stale', 'clock rollback cannot freshen a snapshot');
const gap = activity(selected); gap.history = { state: 'contiguous', missingSequences: [1], quarantinedEvents: 0 };
assert.equal(projectTaskHud({ ...input, activity: gap }).selected?.integrity, 'gap');
gap.history = { state: 'contiguous', missingSequences: [], quarantinedEvents: 1 };
assert.equal(projectTaskHud({ ...input, activity: gap }).selected?.integrity, 'gap');
const completed = task('verified', 'COMPLETED');
completed.progress.verificationStatus = 'PASS';
assert.equal(project(completed).selected?.verification, 'unverified');
completed.verification = { id: 'verification', taskId: completed.id, verifier: 'heuristic-v1', status: 'PASS', checkedAt: '2026-10-17T00:00:00Z', summary: 'Checked', retryable: false, checks: [{ id: 'required', label: 'Required', status: 'PASS', evidence: 'Synthetic evidence', required: true }] };
assert.equal(project(completed).selected?.verification, 'verified-success');
completed.verification.checks[0].evidence = '';
assert.equal(project(completed).selected?.verification, 'unverified');
const unsafe = task('unsafe', 'RUNNING', [step('safe', 'RUNNING')]);
unsafe.title = 'C:\\private\\file'; unsafe.plan!.steps[0].title = 'token fixture';
assert.equal(project(unsafe).choices[0].safeTitle, 'Görev ayrıntıları');
assert.equal(project(unsafe).selected?.steps[0].safeTitle, 'Görev ayrıntıları');
console.log('Task HUD projection: pure synthetic assertions passed');
