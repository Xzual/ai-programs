import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSpecialistReport } from './report-parser.mjs';

const task = { task_id: 'QA-DRYRUN-001', owner_chat: '8' };
const report = {
  task_id: task.task_id, chat: task.owner_chat, status: 'passed', summary: 'Audit passed', files_changed: [],
  tests_run: [], tests_passed: [], tests_failed: [], known_risks: [], blockers: [], next_step: 'Review',
  commit_hash: null, push_status: 'skipped',
};
const raw = value => `Report\n\n\`\`\`json\n${JSON.stringify(value)}\n\`\`\``;

test('normalizes a read-only result while preserving explicit Git fields', () => {
  const parsed = parseSpecialistReport(raw(report), task);
  assert.equal(parsed.status, 'completed');
  assert.equal(parsed.commit_hash, null);
  assert.equal(parsed.push_status, 'skipped');
});

test('rejects a specialist commit or push instead of hiding it', () => {
  assert.throws(() => parseSpecialistReport(raw({ ...report, commit_hash: 'a'.repeat(40) }), task, { startingCommit: 'b'.repeat(40) }), /Unauthorized specialist commit/);
  assert.throws(() => parseSpecialistReport(raw({ ...report, push_status: 'pushed' }), task), /Unauthorized push/);
});

test('preserves the dry-run baseline reference without claiming a task commit', () => {
  const baseline = 'a'.repeat(40);
  const parsed = parseSpecialistReport(raw({ ...report, commit_hash: baseline }), task, { startingCommit: baseline });
  assert.equal(parsed.commit_hash, null);
  assert.equal(parsed.reported_commit_reference, baseline);
});
