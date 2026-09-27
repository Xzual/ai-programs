import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceBin = path.dirname(fileURLToPath(import.meta.url));
const taskId = 'RISK-001';

test('manual approval pauses, invalidates on task change, and still respects SAFE dispatch boundary', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'edith-approval-'));
  const base = path.join(root, 'automation', 'n8n');
  const bin = path.join(base, 'bin');
  let child;
  try {
    await mkdir(bin, { recursive: true });
    await mkdir(path.join(base, 'tasks'), { recursive: true });
    await mkdir(path.join(base, 'state'), { recursive: true });
    for (const name of ['bridge.mjs', 'policy.mjs', 'safety-scan.mjs', 'report-gate.mjs', 'report-parser.mjs', 'qa-policy.mjs']) await copyFile(path.join(sourceBin, name), path.join(bin, name));
    const init = spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: root, windowsHide: true });
    assert.equal(init.status, 0);
    const commit = spawnSync('git', ['-c', 'user.name=EDITH Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-q', '-m', 'baseline'], { cwd: root, windowsHide: true });
    assert.equal(commit.status, 0);
    const task = {
      task_id: taskId, title: 'Permission change', owner_chat: '4', prompt_file: `automation/n8n/prompts/chat4/${taskId}.txt`,
      dependencies: [], priority: 'high', risk_level: 'MANUAL_APPROVAL', expected_files: ['server/routes/permissions.ts'],
      protected_files: ['server.ts'], tests: ['npm run lint'], success_conditions: ['QA accepted'],
      qa_required: true, git_commit: true, git_push: true, timeout_minutes: 90, retry_limit: 1, status: 'queued',
      manual_approval_reason: 'Permission model change',
    };
    const queuePath = path.join(base, 'tasks', 'tasks.json');
    const statePath = path.join(base, 'state', 'orchestrator-state.json');
    await writeFile(queuePath, JSON.stringify({ run_id: 'RUN-APPROVAL-001', tasks: [task] }));
    await writeFile(path.join(base, 'state', 'locks.json'), JSON.stringify({ locks: [] }));
    child = spawn(process.execPath, [path.join(bin, 'bridge.mjs')], { cwd: root, env: { ...process.env, EDITH_N8N_BRIDGE_PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const port = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Fixture bridge start timed out')), 5000);
      let output = '';
      child.stdout.on('data', chunk => {
        output += chunk.toString();
        const match = output.match(/bridge ready on 127\.0\.0\.1:(\d+)/);
        if (match) { clearTimeout(timeout); resolve(Number(match[1])); }
      });
      child.on('error', error => { clearTimeout(timeout); reject(error); });
      child.on('exit', code => { clearTimeout(timeout); reject(new Error(`Fixture bridge exited: ${code}`)); });
    });
    const prepare = async () => (await fetch(`http://127.0.0.1:${port}/prepare`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json();
    const first = await prepare();
    assert.equal(first.action, 'approval_required');
    assert.equal(first.reason, 'Permission model change');
    assert.deepEqual(first.planned_commands, ['npm run lint']);
    assert.deepEqual(first.expected_files, ['server/routes/permissions.ts']);
    const summaryResponse = await (await fetch(`http://127.0.0.1:${port}/summarize`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json();
    assert.equal(summaryResponse.overall_status, 'approval_required');
    assert.equal(summaryResponse.manual_approvals_pending[0].task_id, taskId);
    const summaryFile = JSON.parse(await readFile(path.join(base, 'reports', 'RUN-APPROVAL-001', 'summary.json'), 'utf8'));
    assert.equal(summaryFile.manual_approvals_pending[0].task_sha256, first.task_sha256);
    const summaryText = await readFile(path.join(base, 'reports', 'RUN-APPROVAL-001', 'summary.md'), 'utf8');
    assert.match(summaryText, /Permission model change/);
    assert.match(summaryText, /npm run lint/);
    let state = JSON.parse(await readFile(statePath, 'utf8'));
    state.approvals[taskId] = { approved: true, task_sha256: first.task_sha256, approved_at: new Date().toISOString() };
    await writeFile(statePath, JSON.stringify(state));
    task.title = 'Changed permission plan';
    await writeFile(queuePath, JSON.stringify({ run_id: 'RUN-APPROVAL-001', tasks: [task] }));
    const changed = await prepare();
    assert.equal(changed.action, 'approval_required');
    assert.notEqual(changed.task_sha256, first.task_sha256);
    state = JSON.parse(await readFile(statePath, 'utf8'));
    state.approvals[taskId] = { approved: true, task_sha256: changed.task_sha256, approved_at: new Date().toISOString() };
    await writeFile(statePath, JSON.stringify(state));
    const approved = await prepare();
    assert.equal(approved.action, 'summarize');
    state = JSON.parse(await readFile(statePath, 'utf8'));
    assert.equal(state.tasks[taskId].status, 'blocked');
    assert.match(state.tasks[taskId].reason, /Code-changing dispatch disabled/);
    assert.deepEqual(JSON.parse(await readFile(path.join(base, 'state', 'locks.json'), 'utf8')).locks, []);
  } finally {
    if (child && child.exitCode === null) { child.kill(); await once(child, 'exit'); }
    const tempRoot = path.resolve(tmpdir()) + path.sep;
    if (!path.resolve(root).startsWith(tempRoot)) throw new Error('Unsafe fixture cleanup path');
    await rm(root, { recursive: true, force: true });
  }
});
