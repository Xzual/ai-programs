import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { EdithPlan, EdithTaskStatus, EdithVerificationResult } from '../src/edith/core';

assert.equal(process.env.EDITH_TEST_MODE, 'true');
assert.ok(process.env.EDITH_TEST_DATA_DIR);
process.env.EDITH_PERSISTENCE = 'sqlite';
const { taskService } = await import('../src/edith/taskService');
const { verificationService, registerNativeTaskVerifier } = await import('../src/edith/verifier');
const { getEdithPersistenceStore } = await import('../src/edith/persistence');
const { BROWSER_TOOL_IDS } = await import('../src/edith/browserOperatorContract');
const store = getEdithPersistenceStore();
const dataDir = path.resolve(process.env.EDITH_TEST_DATA_DIR!);

function diskSnapshot(): Record<string, string> {
  const entries: Record<string, string> = {};
  const walk = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(target);
      else if (entry.isFile()) entries[path.relative(dataDir, target)] = createHash('sha256').update(fs.readFileSync(target)).digest('hex');
    }
  };
  walk(dataDir);
  return entries;
}

const plan = (taskId: string): EdithPlan => ({
  id: `plan-${taskId}`, taskId, objective: 'Health report', createdAt: new Date().toISOString(),
  planner: 'heuristic-v1', status: 'READY', steps: [], requiredTools: [], requiredPermissions: [],
  requiredAgents: [], validationCriteria: [], stopConditions: [], maxIterations: 1,
  maxRetries: 0, maxToolCalls: 1, taskTimeoutMs: 1000,
});
const producerLikeVerification = (taskId: string, status: 'PASS' | 'PARTIAL'): EdithVerificationResult => ({
  id: `fixture-verification-${taskId}`, taskId, verifier: 'heuristic-v1', status,
  checkedAt: new Date().toISOString(), summary: 'Fixture receipt evidence; no real browser issuer claimed.', retryable: false,
  checks: [{ id: 'actual-owned-browser-postcondition', label: 'Retain original producer-required check',
    status, required: true, evidence: 'fixture-operation-and-observation-reference' }],
});

let scenarios = 0;
try {
  assert.ok(store.getPaths().sqliteFile && fs.existsSync(store.getPaths().sqliteFile!), 'Real isolated SQLite, no fallback');
  const cases: Array<{ name: string; status: EdithTaskStatus; marker?: boolean; tool?: string; prior?: 'PASS' | 'PARTIAL' }> = [
    { name: 'partial BLOCKED', status: 'BLOCKED', marker: true, prior: 'PARTIAL' },
    { name: 'cancelled with prior partial checks', status: 'CANCELLED', marker: true, prior: 'PARTIAL' },
    { name: 'RUNNING terminal plan and heuristic-positive text', status: 'RUNNING', marker: true },
    { name: 'BLOCKED without checks', status: 'BLOCKED', marker: true },
    { name: 'historical completed producer-like PASS', status: 'COMPLETED', marker: true, prior: 'PASS' },
    { name: 'PAUSED', status: 'PAUSED', marker: true },
    { name: 'RECOVERING', status: 'RECOVERING', marker: true },
    { name: 'FAILED', status: 'FAILED', marker: true },
    ...BROWSER_TOOL_IDS.map(tool => ({ name: `forged toolsRequired ${tool}`, status: 'BLOCKED' as const, tool })),
    { name: 'forged marker plus stored PASS', status: 'BLOCKED', marker: true, prior: 'PASS' },
  ];
  for (const test of cases) {
    const created = taskService.createTask({ title: test.name, objective: 'Health report', originalUserRequest: 'Health report',
      toolsRequired: test.tool ? [test.tool] : [], validationRules: test.marker ? ['actual-owned-browser-postcondition'] : [] });
    taskService.updateGenericTask(created.id, 'fixture.setup', task => ({ ...task, status: test.status,
      plan: plan(task.id), result: 'Health report', observations: ['Health report succeeded'],
      verification: test.prior ? producerLikeVerification(task.id, test.prior) : undefined }));
    const before = JSON.stringify(taskService.getTask(created.id));
    const beforeDisk = diskSnapshot();
    for (let repeat = 0; repeat < 2; repeat++) {
      const result = verificationService.verifyTask(created.id);
      assert.equal(result.success, false, test.name);
      assert.equal(result.status, 'RETRYABLE', test.name);
      assert.deepEqual(result.task, JSON.parse(before), test.name);
      assert.equal(result.verification?.checks[0].id, 'trusted-browser-evidence');
      assert.equal(result.verification?.checks[0].required, true);
      assert.equal(result.verification?.checks[0].status, 'RETRYABLE');
      assert.ok(result.verification?.checks[0].evidence.trim());
      const input = taskService.getTask(created.id)!;
      const inputBefore = JSON.stringify(input);
      assert.equal(verificationService.evaluate(input).status, 'RETRYABLE', test.name);
      assert.equal(JSON.stringify(input), inputBefore, 'evaluate cannot mutate caller task');
      assert.equal(JSON.stringify(taskService.getTask(created.id)), before, 'All persisted status/revision/timeline/verification/checks remain exact');
      assert.deepEqual(diskSnapshot(), beforeDisk, 'All isolated DB/WAL/audit files byte-equivalent; no verifier writes');
    }
    scenarios++;
  }

  const ordinary = taskService.createTask({ title: 'Ordinary positive', objective: 'Health report', originalUserRequest: 'Health report' });
  taskService.updateGenericTask(ordinary.id, 'fixture.setup', task => ({ ...task, status: 'RUNNING', plan: plan(task.id), result: 'Health report' }));
  assert.equal(verificationService.verifyTask(ordinary.id).status, 'PASS');
  assert.equal(taskService.getTask(ordinary.id)?.status, 'COMPLETED', 'Existing nonbrowser writer remains functional');
  const premature = taskService.createTask({ title: 'Ordinary premature', objective: 'Health report', originalUserRequest: 'Health report' });
  const prematureBefore = JSON.stringify(taskService.getTask(premature.id));
  assert.equal(verificationService.verifyTask(premature.id).status, 'RETRYABLE');
  assert.equal(JSON.stringify(taskService.getTask(premature.id)), prematureBefore);

  const native = taskService.createNativeTask('fixture-native-binding', 'a'.repeat(64), 'Native guard fixture');
  const nativeBefore = JSON.stringify(taskService.getTask(native.id)), nativeDisk = diskSnapshot();
  assert.equal(verificationService.verifyTask(native.id).status, 'RETRYABLE', 'Existing missing native authority fallback');
  registerNativeTaskVerifier(task => ({ ...producerLikeVerification(task.id, 'PASS'), summary: 'Existing native hook fixture, not physical proof.' }));
  assert.equal(verificationService.verifyTask(native.id).status, 'PASS', 'Existing native hook takes its original branch');
  assert.equal(JSON.stringify(taskService.getTask(native.id)), nativeBefore);
  assert.deepEqual(diskSnapshot(), nativeDisk);
  registerNativeTaskVerifier(undefined);
  console.log(JSON.stringify({ pass: true, browserScenarios: scenarios, repeatedVerifyAndEvaluate: true,
    realSqlite: true, isolatedDiskByteEquivalent: true, genericPositiveAndNegative: true,
    existingNativeBranch: true, actualBrowserProducerAcceptance: false }));
} finally {
  registerNativeTaskVerifier(undefined);
  store.close?.();
}
