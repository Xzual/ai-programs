import test from 'node:test';
import assert from 'node:assert/strict';
import { reportWarnings } from './report-gate.mjs';

const task = { tests: ['npm run lint', 'npm run build'] };
const report = {
  status: 'completed', tests_run: ['npm run lint', 'npm run build'],
  tests_passed: ['npm run lint completed with exit code 0', 'npm run build completed with exit code 0'],
  tests_failed: [], blockers: [],
};

test('accepts explicit passing evidence for every required test', () => {
  assert.deepEqual(reportWarnings(task, report), []);
});

test('blocks omitted, failed, and unverified tests', () => {
  const warnings = reportWarnings(task, {
    ...report, tests_run: ['npm run lint'],
    tests_passed: ['npm run lint not tested', 'npm run build skipped'],
    tests_failed: ['build failed'], blockers: ['manual inspection needed'],
  });
  assert.ok(warnings.includes('Specialist reported failed tests'));
  assert.ok(warnings.includes('Specialist reported blockers'));
  assert.ok(warnings.includes('Required test not run: npm run build'));
  assert.ok(warnings.includes('Required test has no passing evidence: npm run lint'));
  assert.ok(warnings.includes('Required test has no passing evidence: npm run build'));
});
