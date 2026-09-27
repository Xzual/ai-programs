import test from 'node:test';
import assert from 'node:assert/strict';
import { scanChangeMetadata, secretTypes } from './safety-scan.mjs';

const task = { expected_files: ['src/ordinary.ts', 'src/edith/killSwitch.ts'], protected_files: ['src/edith/killSwitch.ts'], risk_level: 'REVIEW' };

test('detects scope, user data, critical controls, missing lock, and deletions', () => {
  const warnings = scanChangeMetadata({
    changedPaths: ['src/ordinary.ts', 'src/edith/killSwitch.ts', 'data/user.db'],
    stagedPaths: ['.env'],
    deletedPaths: ['data/user.db'],
    deletionCounts: { 'data/user.db': 150 },
    task,
    heldLocks: [],
  });
  assert.ok(warnings.some(x => x.includes('Unexpected modified file: data/user.db')));
  assert.ok(warnings.some(x => x.includes('Protected runtime or user-data path changed: data/user.db')));
  assert.ok(warnings.some(x => x.includes('Sensitive control requires manual approval: src/edith/killSwitch.ts')));
  assert.ok(warnings.some(x => x.includes('Protected file changed without lock: src/edith/killSwitch.ts')));
  assert.ok(warnings.some(x => x.includes('Protected runtime or credential path staged: .env')));
  assert.ok(warnings.some(x => x.includes('Unexpected deletion: data/user.db')));
  assert.ok(warnings.some(x => x.includes('Large deletion (150 lines): data/user.db')));
});

test('allows an in-scope ordinary edit and redacts secret values from labels', () => {
  assert.deepEqual(scanChangeMetadata({ changedPaths: ['src/ordinary.ts'], stagedPaths: [], deletedPaths: [], deletionCounts: {}, task, heldLocks: [] }), []);
  const token = 'ghp_' + 'A'.repeat(30);
  const labels = secretTypes(`token = "${token}"`);
  assert.ok(labels.includes('GitHub token'));
  assert.ok(labels.every(x => !x.includes(token)));
  assert.ok(secretTypes('GEMINI_API_KEY=abcdefghijklmnop123456').includes('Named API credential'));
  assert.equal(secretTypes('const key = process.env.GEMINI_API_KEY').includes('Named API credential'), false);
});
