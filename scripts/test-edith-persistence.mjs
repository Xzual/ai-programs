import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const repoRoot = process.cwd();
const scriptPath = path.join(repoRoot, 'scripts', 'migrate-edith-persistence.mjs');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'edith-persistence-test-'));

function runMigration() {
  const output = execFileSync(process.execPath, [scriptPath], {
    cwd: tempRoot,
    encoding: 'utf8',
  });
  return JSON.parse(output.match(/\{[\s\S]*\}/)?.[0] ?? '{}');
}

try {
  const edithDir = path.join(tempRoot, '.edith');
  fs.mkdirSync(edithDir, { recursive: true });

  fs.writeFileSync(
    path.join(edithDir, 'tasks.json'),
    JSON.stringify([
      {
        id: 'task-test-1',
        title: 'Test task',
        objective: 'Verify migration',
        originalUserRequest: 'test',
        priority: 'normal',
        status: 'CREATED',
        createdAt: '2026-08-14T00:00:00.000Z',
        dependencies: [],
        subtasks: [],
        candidateAgents: [],
        toolsRequired: [],
        permissionsRequired: [],
        riskLevel: 1,
        checkpoints: [],
        artifacts: [],
        observations: [],
        validationRules: [],
        memoryReferences: [],
        auditEvents: [],
      },
    ]),
    'utf8'
  );

  fs.writeFileSync(
    path.join(edithDir, 'audit.log.jsonl'),
    `${JSON.stringify({
      id: 'audit-test-1',
      actor: 'test',
      action: 'tool.execute',
      toolId: 'system_monitor',
      timestamp: '2026-08-14T00:01:00.000Z',
      authorization: 'allowed',
      riskLevel: 1,
      result: 'success',
    })}\n`,
    'utf8'
  );

  const first = runMigration();
  assert.equal(first.success, true);
  assert.equal(first.tasksImported, 1);
  assert.equal(first.auditEventsImported, 1);

  const second = runMigration();
  assert.equal(second.success, true);
  assert.equal(second.tasksImported, 0);
  assert.equal(second.auditEventsImported, 0);

  const db = new DatabaseSync(path.join(edithDir, 'edith.db'));
  const taskCount = db.prepare('SELECT COUNT(*) AS count FROM tasks').get().count;
  const auditCount = db.prepare('SELECT COUNT(*) AS count FROM audit_events').get().count;

  assert.equal(taskCount, 1);
  assert.equal(auditCount, 1);
  db.close();

  console.log(JSON.stringify({
    success: true,
    taskCount,
    auditCount,
    idempotent: true,
  }, null, 2));
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
