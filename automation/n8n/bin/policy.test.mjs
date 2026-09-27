import test from 'node:test';
import assert from 'node:assert/strict';
import { approvalGranted, approvalRequest, resourcesOverlap } from './policy.mjs';

const task = {
  task_id: 'RISK-001', title: 'Sensitive change', owner_chat: '4', risk_level: 'MANUAL_APPROVAL',
  manual_approval_reason: 'Permission model change', notes: 'Review access rules',
  expected_files: ['server/routes/permissions.ts'], protected_files: ['server.ts'],
  tests: ['npm run lint'],
};

test('manual approval is tied to the exact task and a recorded approval time', () => {
  const request = approvalRequest(task);
  assert.deepEqual(request.risks, ['Permission model change', 'Review access rules']);
  assert.deepEqual(request.planned_commands, ['npm run lint']);
  assert.equal(approvalGranted(task, { approved: true, task_sha256: request.task_sha256, approved_at: '2026-09-23T18:00:00Z' }), true);
  assert.equal(approvalGranted({ ...task, tests: ['npm run build'] }, { approved: true, task_sha256: request.task_sha256, approved_at: '2026-09-23T18:00:00Z' }), false);
  assert.equal(approvalGranted(task, { approved: true, task_sha256: request.task_sha256 }), false);
});

test('file and directory locks overlap only on path boundaries', () => {
  assert.equal(resourcesOverlap('src/', 'src/App.tsx'), true);
  assert.equal(resourcesOverlap('src/App.tsx', 'src/App.tsx'), true);
  assert.equal(resourcesOverlap('src/App.tsx', 'src/App.tsx.bak'), false);
  assert.equal(resourcesOverlap('server/', 'src/App.tsx'), false);
});
