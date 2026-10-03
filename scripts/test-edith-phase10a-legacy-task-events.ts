import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  deriveTaskProgress,
  normalizeLegacyTask,
  parseTaskEventV2,
  projectTaskEventsV2,
} from '../src/edith/contracts';
import { createTask, type EdithTask, type EdithTaskTimelineEvent } from '../src/edith/core';
import { SqliteEdithPersistenceStore } from '../src/edith/persistence/sqliteStore';
import { resolvePersistenceDataDir } from '../src/edith/persistence';
import { parseTaskActivityV2 } from '../src/edith/taskActivityClient';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'edith-phase10a-'));
const observedPrivatePath = 'C:\\Users\\owner\\private-task.txt';
const observedSecret = 'api_key=must-not-leak';
const now = '2026-09-28T12:00:00.000Z';

function auditRuntimeCopy(databasePath: string | undefined) {
  if (!databasePath || !fs.existsSync(databasePath)) return undefined;
  const db = new DatabaseSync(databasePath, { readOnly: true });
  db.exec('PRAGMA query_only=ON');
  const tasks = db.prepare('SELECT json FROM tasks').all().flatMap((row) => {
    try { return [JSON.parse(String(row.json)) as EdithTask]; } catch { return []; }
  });
  let sourceEventCount = 0;
  let canonicalEventCount = 0;
  let quarantinedEventCount = 0;
  let affectedTaskCount = 0;
  let clientReadableTaskCount = 0;
  const legacyTypes = new Set<string>();
  for (const raw of tasks) {
    const normalized = normalizeLegacyTask(raw) as EdithTask;
    const projection = projectTaskEventsV2(normalized);
    sourceEventCount += projection.diagnostics.sourceEventCount;
    canonicalEventCount += projection.diagnostics.canonicalEventCount;
    quarantinedEventCount += projection.diagnostics.quarantinedEventCount;
    if (!projection.diagnostics.quarantinedEventCount) continue;
    affectedTaskCount += 1;
    projection.diagnostics.entries.forEach((entry) => legacyTypes.add(entry.legacyType));
    const progress = deriveTaskProgress(normalized);
    parseTaskActivityV2({
      contract: { schema: 'edith.shared', version: 2 },
      data: { task: { ...normalized, progress: undefined }, progress, events: projection.events, eventDiagnostics: projection.diagnostics },
    });
    clientReadableTaskCount += 1;
  }
  db.close();
  return {
    isolatedCopy: true,
    taskCount: tasks.length,
    sourceEventCount,
    canonicalEventCount,
    quarantinedEventCount,
    affectedTaskCount,
    clientReadableTaskCount,
    legacyTypes: [...legacyTypes].sort(),
    sourceDatabaseMutated: false,
  };
}

function legacyEvent(taskId: string, type: string, index: number, actor = 'edith-task-service'): EdithTaskTimelineEvent {
  return {
    id: `legacy-${index}`,
    taskId,
    type: type as EdithTaskTimelineEvent['type'],
    actor,
    message: `${observedPrivatePath} ${observedSecret}`,
    createdAt: now,
    status: 'PLANNING',
  };
}

try {
  assert.throws(() => resolvePersistenceDataDir({ EDITH_TEST_MODE: 'true' }), /EDITH_TEST_DATA_DIR_REQUIRED/);
  assert.throws(() => resolvePersistenceDataDir({ EDITH_TEST_MODE: 'true', EDITH_TEST_DATA_DIR: path.join(process.cwd(), '.edith') }), /EDITH_TEST_DATA_DIR_UNSAFE/);
  assert.equal(resolvePersistenceDataDir({ EDITH_TEST_MODE: 'true', EDITH_TEST_DATA_DIR: path.join(tempRoot, 'guarded-data') }), path.join(tempRoot, 'guarded-data'));

  const created = createTask({
    title: 'Legacy event compatibility fixture',
    objective: 'Keep valid canonical events readable while quarantining legacy timeline rows.',
    originalUserRequest: 'reproduce UNKNOWN_TASK_EVENT_TYPE safely',
  });
  const canonical = {
    contractVersion: 2 as const,
    taskId: created.id,
    eventId: 'canonical-step-event',
    id: 'canonical-step-event',
    sequence: 4,
    revision: 1,
    type: 'task.step_updated' as const,
    occurredAt: now,
    createdAt: now,
    payload: { stepId: 'step-safe', status: 'RUNNING', attempt: 1 },
    context: { correlationId: 'corr-safe', idempotencyKey: 'idem-safe' },
  };
  const crossTaskCanonical = {
    ...canonical,
    taskId: 'different-task',
    eventId: 'cross-task-event',
    id: 'cross-task-event',
    sequence: 5,
    context: { correlationId: 'corr-cross-task', idempotencyKey: 'idem-cross-task' },
  };
  const boundedUnknowns = Array.from({ length: 101 }, (_, index) =>
    legacyEvent(created.id, index === 0 ? `${observedPrivatePath}:${observedSecret}` : 'permission', index + 4, index === 0 ? observedSecret : 'edith-task-service'));
  const task = {
    ...created,
    status: 'PLANNING' as const,
    timeline: [
      legacyEvent(created.id, 'status', 1),
      legacyEvent(created.id, 'audit', 2),
      legacyEvent(created.id, 'plan', 3),
      canonical as unknown as EdithTaskTimelineEvent,
      crossTaskCanonical as unknown as EdithTaskTimelineEvent,
      ...boundedUnknowns,
    ],
  };

  const first = projectTaskEventsV2(task);
  assert.equal(first.events.length, 1);
  assert.equal(first.events[0]?.type, 'task.step_updated');
  assert.equal(parseTaskEventV2(first.events[0]).success, true);
  assert.equal(first.diagnostics.scope, 'task');
  assert.equal(first.diagnostics.sourceEventCount, 106);
  assert.equal(first.diagnostics.canonicalEventCount, 1);
  assert.equal(first.diagnostics.quarantinedEventCount, 105);
  assert.equal(first.diagnostics.entries.length, 100);
  assert.equal(first.diagnostics.truncated, true);
  assert.deepEqual(first.diagnostics.entries.slice(0, 3).map((entry) => entry.legacyType), ['status', 'audit', 'plan']);
  assert.equal(first.diagnostics.entries.some((entry) => entry.reasonCode === 'LEGACY_TASK_EVENT_UNSUPPORTED'), true);
  assert.equal(first.diagnostics.entries.some((entry) => entry.reasonCode === 'INVALID_CANONICAL_TASK_EVENT'), true);
  assert.equal(first.diagnostics.entries.some((entry) => entry.reasonCode === 'TASK_EVENT_TASK_MISMATCH'), true);
  const serializedDiagnostics = JSON.stringify(first.diagnostics);
  assert.equal(serializedDiagnostics.includes(observedPrivatePath), false);
  assert.equal(serializedDiagnostics.includes(observedSecret), false);
  assert.equal(serializedDiagnostics.includes('message'), false);
  assert.deepEqual(projectTaskEventsV2(task), first, 'Projection must be idempotent and mutation-free.');

  const progress = deriveTaskProgress(task);
  assert.equal(progress.status, 'PLANNING');
  assert.equal(progress.terminal, false);
  assert.equal(progress.percent, 10);

  const storeRoot = path.join(tempRoot, 'sqlite-copy');
  let store = new SqliteEdithPersistenceStore(storeRoot);
  store.initialize();
  const persisted = store.createTask(task);
  const persistedProjection = projectTaskEventsV2(persisted);
  store.close?.();
  store = new SqliteEdithPersistenceStore(storeRoot);
  store.initialize();
  const restartedTask = store.listTasks().find((item) => item.id === task.id);
  assert.ok(restartedTask);
  assert.deepEqual(projectTaskEventsV2(restartedTask), persistedProjection, 'Restart must not change quarantine results.');
  store.close?.();

  console.log(JSON.stringify({
    success: true,
    runtimeAudit: auditRuntimeCopy(process.env.EDITH_PHASE10A_RUNTIME_COPY),
    observedLegacyShape: {
      types: ['status', 'audit', 'plan'],
      producer: 'edith-task-service',
      payloadPresent: false,
    },
    checks: [
      'strict_canonical_event_preserved',
      'legacy_events_quarantined_without_reinterpretation',
      'bounded_diagnostics',
      'secret_and_path_free_diagnostics',
      'task_scoped_projection',
      'no_fake_completion_or_progress',
      'restart_idempotence',
      'test_mode_persistence_fail_closed',
    ],
  }, null, 2));
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
