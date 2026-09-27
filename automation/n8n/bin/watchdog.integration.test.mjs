import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceBin = path.dirname(fileURLToPath(import.meta.url));
const taskId = 'QA-DRYRUN-001';

test('watchdog blocks a missing completed report and an expired running task', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'edith-watchdog-'));
  const base = path.join(root, 'automation', 'n8n');
  const bin = path.join(base, 'bin');
  let child;
  try {
    await mkdir(bin, { recursive: true });
    await mkdir(path.join(base, 'tasks'), { recursive: true });
    await mkdir(path.join(base, 'state'), { recursive: true });
    for (const name of ['bridge.mjs', 'policy.mjs', 'safety-scan.mjs', 'report-gate.mjs', 'report-parser.mjs', 'qa-policy.mjs']) await copyFile(path.join(sourceBin, name), path.join(bin, name));
    const queue = {
      run_id: 'RUN-FIXTURE-001', tasks: [{ task_id: taskId, title: 'Fixture audit', owner_chat: '8',
        prompt_file: `automation/n8n/prompts/chat8/${taskId}.txt`, dependencies: [], priority: 'normal',
        risk_level: 'SAFE', expected_files: [], protected_files: [], tests: [], success_conditions: ['report'],
        qa_required: false, git_commit: false, git_push: false, timeout_minutes: 1, retry_limit: 0, status: 'queued' }],
    };
    const statePath = path.join(base, 'state', 'orchestrator-state.json');
    await writeFile(path.join(base, 'tasks', 'tasks.json'), JSON.stringify(queue));
    await writeFile(path.join(base, 'state', 'locks.json'), JSON.stringify({ locks: [] }));
    await writeFile(statePath, JSON.stringify({ run_id: queue.run_id, tasks: { [taskId]: { status: 'completed', report: 'automation/n8n/reports/RUN-FIXTURE-001/missing.json' } }, approvals: {}, incidents: [], errors: {} }));
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
    const url = `http://127.0.0.1:${port}/watchdog`;
    const first = await (await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json();
    assert.deepEqual(first.blocked_tasks, [taskId]);
    let saved = JSON.parse(await readFile(statePath, 'utf8'));
    assert.equal(saved.tasks[taskId].reason, 'Completed task report missing');
    await writeFile(statePath, JSON.stringify({ run_id: queue.run_id, tasks: { [taskId]: { status: 'running', started_at: '2020-01-01T00:00:00Z' } }, approvals: {}, incidents: [], errors: {} }));
    const second = await (await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json();
    assert.deepEqual(second.blocked_tasks, [taskId]);
    saved = JSON.parse(await readFile(statePath, 'utf8'));
    assert.equal(saved.tasks[taskId].reason, 'Watchdog timeout');
  } finally {
    if (child && child.exitCode === null) { child.kill(); await once(child, 'exit'); }
    const tempRoot = path.resolve(tmpdir()) + path.sep;
    if (!path.resolve(root).startsWith(tempRoot)) throw new Error('Unsafe fixture cleanup path');
    await rm(root, { recursive: true, force: true });
  }
});
