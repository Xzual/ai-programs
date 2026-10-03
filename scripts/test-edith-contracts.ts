import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  EDITH_CONTRACT_SCHEMA,
  EDITH_CONTRACT_VERSION,
  REALTIME_EVENT_NAMES,
  deriveTaskProgress,
  normalizeLegacyTask,
  parseRealtimeEnvelope,
  parseTaskStatus,
  prepareTaskMutation,
  projectTaskEventsV2,
  taskEventsV2,
  toPublicKnowledgeDto,
} from '../src/edith/contracts';
import { createTask, type EdithTask } from '../src/edith/core';
import { JsonEdithPersistenceStore } from '../src/edith/persistence/jsonStore';
import { SqliteEdithPersistenceStore } from '../src/edith/persistence/sqliteStore';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'edith-contracts-'));

function taskWithTimeline(): EdithTask {
  const task = createTask({
    title: 'Contract regression',
    objective: 'Verify canonical task contracts',
    originalUserRequest: 'run contract tests',
  });
  return {
    ...task,
    timeline: [{
      id: 'event-1',
      taskId: task.id,
      type: 'status',
      actor: 'contract-test',
      message: 'queued',
      createdAt: new Date(0).toISOString(),
      status: 'QUEUED',
    }],
  };
}

function verifyStore(store: JsonEdithPersistenceStore | SqliteEdithPersistenceStore): void {
  store.initialize();
  const created = store.createTask(taskWithTimeline());
  assert.equal(created.revision, 1);
  assert.equal(created.eventSequence, 1);
  assert.equal(created.timeline[0]?.sequence, 1);

  const updated = store.updateTask({
    ...created,
    status: 'RUNNING',
    timeline: [...created.timeline, {
      id: 'event-2',
      taskId: created.id,
      type: 'status',
      actor: 'contract-test',
      message: 'running',
      createdAt: new Date(1).toISOString(),
      status: 'RUNNING',
    }],
  });
  assert.equal(updated.revision, 2);
  assert.equal(updated.eventSequence, 2);
  assert.deepEqual(updated.timeline.map((event) => event.sequence), [1, 2]);

  const stale = store.updateTask({ ...created, status: 'VERIFYING' });
  assert.equal(stale.revision, 3);
  assert.equal(stale.eventSequence, 2);
  assert.deepEqual(stale.timeline.map((event) => event.id), ['event-1', 'event-2']);
  const duplicateCreate = store.createTask({ ...stale, status: 'COMPLETED' });
  assert.equal(duplicateCreate.revision, 4);
  assert.equal(store.listTasks()[0]?.revision, 4);
  store.close?.();
}

try {
  assert.equal(parseTaskStatus('RUNNING').success, true);
  const invalidStatus = parseTaskStatus('running');
  assert.equal(invalidStatus.success, false);
  if (invalidStatus.success === false) assert.equal(invalidStatus.errorCode, 'INVALID_TASK_STATUS');

  const realtime = parseRealtimeEnvelope({
    schema: EDITH_CONTRACT_SCHEMA,
    version: EDITH_CONTRACT_VERSION,
    event: REALTIME_EVENT_NAMES.TASK_PROGRESS,
    eventId: 'rt-1',
    occurredAt: new Date(0).toISOString(),
    sequence: 0,
    payload: {},
  });
  assert.equal(realtime.success, true);
  assert.equal(parseRealtimeEnvelope({ version: 1 }).success, false);

  const legacy = normalizeLegacyTask(taskWithTimeline());
  assert.equal(legacy.contractVersion, 2);
  assert.equal(legacy.revision, 1);
  assert.equal(legacy.eventSequence, 1);
  assert.equal(taskEventsV2(legacy).length, 0);
  const legacyProjection = projectTaskEventsV2(legacy);
  assert.equal(legacyProjection.diagnostics.quarantinedEventCount, 1);
  assert.equal(legacyProjection.diagnostics.entries[0]?.legacyType, 'status');
  const malformedLegacy = normalizeLegacyTask({ id: 'legacy-bad', status: 'UNKNOWN' });
  assert.equal(malformedLegacy.status, 'FAILED');
  assert.deepEqual((malformedLegacy as unknown as Record<string, unknown>).observations, []);

  const planned = {
    ...legacy,
    status: 'RUNNING' as const,
    objective: 'This text must not influence progress.',
    plan: {
      id: 'plan-1', taskId: legacy.id, objective: 'plan', createdAt: new Date(0).toISOString(),
      planner: 'heuristic-v1' as const, status: 'READY' as const,
      requiredTools: [], requiredPermissions: [], requiredAgents: [], validationCriteria: [], stopConditions: [],
      maxIterations: 1, maxRetries: 1, maxToolCalls: 1, taskTimeoutMs: 1000,
      steps: [
        { id: 'step-1', title: 'one', objective: 'one', status: 'COMPLETED' as const, dependsOn: [], suggestedTools: [], requiredPermissions: [], validationCriteria: [], riskLevel: 0 as const },
        { id: 'step-2', title: 'two', objective: 'two', status: 'RUNNING' as const, dependsOn: [], suggestedTools: [], requiredPermissions: [], validationCriteria: [], riskLevel: 0 as const },
      ],
    },
  };
  const progress = deriveTaskProgress(planned);
  const textChangedTask = { ...planned, objective: 'Completely different prose.' };
  const progressAfterTextChange = deriveTaskProgress(textChangedTask);
  assert.equal(progress.percent, 40);
  assert.deepEqual(progressAfterTextChange, progress);
  assert.deepEqual(progress.sources, ['task_status', 'plan_steps']);

  const mutation = prepareTaskMutation(legacy, {
    ...legacy,
    timeline: [...legacy.timeline, { ...legacy.timeline[0], id: 'event-2' }],
  });
  assert.equal(mutation.revision, 2);
  assert.equal(mutation.eventSequence, 2);

  const secretPath = path.join(tempRoot, 'EDITH Vault');
  const publicDto = toPublicKnowledgeDto({
    status: { settings: { vaultPath: secretPath }, vaultPathConfigured: true, error: `Vault unavailable: ${secretPath}` },
    export: { absolutePath: path.join(secretPath, 'note.md'), notePath: 'Notes/note.md' },
    nested: [{ properties: { absolutePath: path.join(secretPath, 'nested.md') } }],
  });
  const serialized = JSON.stringify(publicDto);
  assert.equal(serialized.includes(tempRoot), false);
  assert.equal(publicDto.export.notePath, 'Notes/note.md');
  assert.equal(publicDto.status.settings.vaultPath, '[REDACTED_LOCAL_PATH]');
  assert.equal(publicDto.status.error.includes(secretPath), false);

  verifyStore(new JsonEdithPersistenceStore(path.join(tempRoot, 'json')));
  verifyStore(new SqliteEdithPersistenceStore(path.join(tempRoot, 'sqlite')));

  console.log(JSON.stringify({
    success: true,
    checks: [
      'task_status_parser',
      'realtime_envelope_parser',
      'legacy_task_normalization',
      'legacy_task_event_quarantine',
      'deterministic_progress',
      'monotonic_revision_and_event_sequence_json',
      'monotonic_revision_and_event_sequence_sqlite',
      'public_knowledge_path_redaction',
    ],
  }, null, 2));
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
