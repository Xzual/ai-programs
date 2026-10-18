import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { DurableStateStore } from '../server/advanced/durableStateStore';
import { AdvancedExperienceRuntime } from '../server/advanced/runtime';
import { taskService } from '../src/edith/taskService';
import { plannerService } from '../src/edith/planner';
import { executorService } from '../src/edith/executor';
import { Phase4IdempotencyStore } from '../server/routes/phase4IdempotencyStore';
const file = fileURLToPath(import.meta.url);
const cli = path.resolve('node_modules/tsx/dist/cli.mjs');
function task() {
  const task = taskService.listTasks().find((task) => task.title === 'Durable canonical fixture');
  assert(task?.verification?.status === 'PASS');
  return task;
}
const [mode, target] = process.argv.slice(2);
if (mode === 'idempotent-first' || mode === 'idempotent-replay') {
  const pending = new Phase4IdempotencyStore(target).execute('owner:fixture', 'restart-request', { fixture: true }, async () => {
    const countFile = `${target}.count`;
    const count = fs.existsSync(countFile) ? Number(fs.readFileSync(countFile, 'utf8')) : 0;
    fs.writeFileSync(countFile, String(count + 1));
    return { status: 200, body: { artifactId: 'actual-fixture-count', modelCalls: 0 } };
  });
  assert(pending); assert.equal(pending.replayed, mode === 'idempotent-replay');
  assert.equal((await pending.result).body.artifactId, 'actual-fixture-count');
  assert.equal(fs.readFileSync(`${target}.count`, 'utf8'), '1');
  console.log('IDEMPOTENT_PROCESS_REPLAY_NO_EFFECT');
} else if (mode === 'crash-writer') {
  const db = new DatabaseSync(target);
  db.exec('PRAGMA synchronous=FULL; BEGIN IMMEDIATE;');
  db.prepare('INSERT INTO entries(key,value) VALUES(?,?)').run('uncommitted', JSON.stringify('must-roll-back'));
  console.log('WRITER_READY');
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
} else if (mode === 'put') {
  new DurableStateStore(target).update((entries) => entries.set('second-process', { value: 42 }));
} else if (mode === 'mission-put') {
  const created = taskService.createTask({ title: 'Durable canonical fixture', objective: 'Read system health status and verify the report.', originalUserRequest: 'Read system health status and verify the report.', toolsRequired: ['system_monitor'], permissionsRequired: ['system:read'] });
  plannerService.planTask(created.id);
  const executed = await executorService.executeTask(created.id);
  assert.equal(executed.task?.verification?.status, 'PASS');
  const runtime = new AdvancedExperienceRuntime(() => task(), { missionMemoryPath: target, ownerActive: () => true });
  const now = new Date().toISOString();
  runtime.put('mission-memories', { contractVersion: 2, amendment: '2.1', ownerSessionBindingId: 'owner-fixture', workspaceId: 'workspace-fixture', revision: 1, createdAt: now, updatedAt: now, memoryId: 'memory-fixture', sourceTaskId: task().id, verificationStatus: 'verified', routeSummary: 'Readback route', avoidRouteCodes: [], currentStateReverificationRequired: true });
} else if (mode === 'mission-get') {
  const runtime = new AdvancedExperienceRuntime(() => task(), { missionMemoryPath: target, ownerActive: (id) => id === 'fresh-owner' });
  assert.equal(runtime.list('mission-memories', 'owner-fixture', 'workspace-fixture').length, 0);
  runtime.rebindMissionMemory('memory-fixture', 'fresh-owner', 'workspace-fixture');
  assert.equal(runtime.list('mission-memories', 'fresh-owner', 'workspace-fixture').length, 1);
  console.log('MISSION_RESTORED_REVERIFIED');
} else {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edith-durable-fixture-'));
  try {
    const storePath = path.join(root, 'metadata.sqlite');
    for (const mode of ['idempotent-first', 'idempotent-replay']) {
      const child = spawnSync(process.execPath, [cli, file, mode, path.join(root, 'idempotency.sqlite')], { encoding: 'utf8', env: process.env, timeout: 10_000 });
      assert.equal(child.status, 0, child.stderr);
      assert(child.stdout.includes('IDEMPOTENT_PROCESS_REPLAY_NO_EFFECT'));
    }
    const store = new DurableStateStore(storePath);
    store.update((entries) => entries.set('committed', 'preserve'));
    const second = spawnSync(process.execPath, [cli, file, 'put', storePath], { encoding: 'utf8', env: process.env });
    assert.equal(second.status, 0, second.stderr);
    assert.deepEqual(store.get('second-process'), { value: 42 });
    const child = spawn(process.execPath, [cli, file, 'crash-writer', storePath], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { child.kill(); reject(new Error('CRASH_WRITER_TIMEOUT')); }, 10000);
      child.stdout.on('data', (data) => { if (String(data).includes('WRITER_READY')) { clearTimeout(timer); resolve(); } });
      child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`CRASH_WRITER_EXIT_${code}`)); });
    });
    assert.throws(() => store.update((entries) => entries.set('steal', true)), /locked|busy/i);
    const exited = new Promise<void>((resolve) => child.on('exit', () => resolve()));
    child.kill('SIGKILL'); await exited;
    assert.equal(store.get('committed'), 'preserve');
    assert.equal(store.get('uncommitted'), undefined);
    store.update((entries) => entries.set('after-crash', true));
    assert.equal(store.get('after-crash'), true);
    const bounded = new DurableStateStore(path.join(root, 'bounded.sqlite'), 1);
    bounded.update((entries) => entries.set('one', 1));
    assert.throws(() => bounded.update((entries) => entries.set('two', 2)), /DURABLE_STORE_FULL/);
    assert.deepEqual(bounded.entries(), [['one', 1]]);
    assert.throws(() => bounded.update((entries) => entries.set('one', 'x'.repeat(8 * 1024 * 1024))), /DURABLE_STORE_TOO_LARGE/);
    const corrupt = path.join(root, 'corrupt.sqlite'); fs.writeFileSync(corrupt, '{broken');
    assert.throws(() => new DurableStateStore(corrupt).entries());
    assert.throws(() => new DurableStateStore(corrupt).update(() => {}));
    assert.equal(fs.readFileSync(corrupt, 'utf8'), '{broken');
    const mission = path.join(root, 'missions.sqlite');
    for (const action of ['mission-put', 'mission-get']) {
      const result = spawnSync(process.execPath, [cli, file, action, mission], { encoding: 'utf8', env: process.env });
      assert.equal(result.status, 0, result.stderr);
    }
    const active = new AdvancedExperienceRuntime(() => task(), { missionMemoryPath: mission, ownerActive: () => true });
    assert.equal(active.list('mission-memories', 'fresh-owner', 'workspace-fixture').length, 1);
    const racing = new AdvancedExperienceRuntime(() => task(), { missionMemoryPath: mission, ownerActive: () => true });
    const original = active.list('mission-memories', 'fresh-owner', 'workspace-fixture')[0];
    const revision2 = { ...original, revision: original.revision + 1, updatedAt: new Date(Date.parse(original.updatedAt) + 1000).toISOString(), routeSummary: 'Updated readback route' };
    assert.throws(() => active.put('mission-memories', { ...revision2, routeSummary: 'password=fixture-secret' }), /MISSION_MEMORY_INVALID/);
    active.put('mission-memories', revision2);
    assert.throws(() => racing.put('mission-memories', revision2), /REVISION_CONFLICT/);
    assert.equal((new DurableStateStore(mission).get('memory-fixture') as { routeSummary: string }).routeSummary, 'Updated readback route');
    const staleOwner = new AdvancedExperienceRuntime(() => task(), { missionMemoryPath: mission, ownerActive: () => false });
    assert.equal(staleOwner.list('mission-memories', 'fresh-owner', 'workspace-fixture').length, 0);
    const failedTask = task(); failedTask.verification!.status = 'FAIL';
    const staleEvidence = new AdvancedExperienceRuntime(() => failedTask, { missionMemoryPath: mission, ownerActive: () => true });
    assert.equal(staleEvidence.list('mission-memories', 'fresh-owner', 'workspace-fixture').length, 0);
    active.invalidateOwner('fresh-owner');
    assert.equal(new DurableStateStore(mission).entries().length, 0);
    console.log(JSON.stringify({ test: 'producer-runtime-durability', process2: 'PASS', crashRollback: 'PASS', activeWriterNotStolen: 'PASS', fullCorruptFailClosed: 'PASS', missionReverification: 'PASS', ownerAuthorityNotRestored: 'PASS' }));
  } finally { fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
}
