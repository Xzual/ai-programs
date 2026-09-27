import test from 'node:test';
import assert from 'node:assert/strict';
import { draftFixTask, parseQaDecision } from './qa-policy.mjs';

const task = {
  task_id: 'VOICE-004', title: 'Voice hardening', owner_chat: '6', priority: 'high', risk_level: 'REVIEW',
  expected_files: ['src/edith/voiceLiveClient.ts'], protected_files: [], tests: ['npm run lint'],
  success_conditions: ['No regression'], qa_required: true, git_commit: true, git_push: true,
  timeout_minutes: 90, retry_limit: 1,
};

test('a QA rejection creates one review-required draft for the original owner', () => {
  const decision = parseQaDecision('```json\n{"qa_status":"needs_fix","findings":["Voice buffer regression"],"next_step":"Add coverage"}\n```');
  const draft = draftFixTask(task, 1, decision);
  assert.equal(draft.task.owner_chat, '6');
  assert.equal(draft.task.qa_required, true);
  assert.equal(draft.task.retry_limit, 0);
  assert.equal(draft.status, 'review_required');
  assert.match(draft.prompt, /Voice buffer regression/);
  assert.match(draft.prompt, /Add coverage/);
  assert.equal(draftFixTask(task, 2, decision), null);
});

test('QA accepts only structured, actionable, secret-free decisions', () => {
  assert.throws(() => parseQaDecision('No JSON report'), /missing/);
  assert.throws(() => parseQaDecision('```json\n{"qa_status":"needs_fix","findings":[],"next_step":"try"}\n```'), /findings missing/);
  assert.throws(() => parseQaDecision('```json\n{"qa_status":"accepted","findings":[],"next_step":"done","extra":1}\n```'), /Invalid QA decision/);
  const token = 'ghp_' + 'A'.repeat(30);
  assert.throws(() => parseQaDecision('```json\n{"qa_status":"accepted","findings":[],"next_step":"' + token + '"}\n```'), /Secret-like content/);
});
