import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AdvancedProducerComposition } from '../server/advanced/producerComposition';
import { AdvancedExperienceRuntime, type AdvancedPublishTrust, type AdvancedResource, type AdvancedResourceKind } from '../server/advanced/runtime';
import { createTask, type EdithTask } from '../src/edith/core';
import { JsonEdithPersistenceStore } from '../src/edith/persistence/jsonStore';
import { MemoryPhase4Persistence } from '../src/edith/phase4Persistence';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edith-phase7d-producer-'));
const local = new JsonEdithPersistenceStore(root);
local.initialize();
const phase4 = new MemoryPhase4Persistence();
const now = new Date().toISOString();

function verifiedTask(): EdithTask {
  const task = createTask({ title: 'Verified workspace task', objective: 'Produce verified output', originalUserRequest: 'Produce output' });
  task.status = 'COMPLETED';
  task.updatedAt = now;
  task.verification = {
    id: 'verification-phase7d', taskId: task.id, verifier: 'heuristic-v1', status: 'PASS', checkedAt: now,
    summary: 'Persisted task output verified.', retryable: false,
    checks: [{ id: 'check-phase7d', label: 'Output', status: 'PASS', evidence: 'Persisted fixture.', required: true }],
  };
  return local.createTask(task);
}

const task = verifiedTask();
local.upsertKnowledgeNode?.({ id: 'generated-journal', title: 'Generated journal', type: 'Note', aliases: [], tags: ['journal'], source: 'obsidian', importance: 0.7, recentActivityAt: now, properties: { edith_generated: 'research_journal' } });
local.upsertKnowledgeNode?.({ id: 'user-note', title: 'User note', type: 'Note', aliases: [], tags: [], source: 'obsidian', importance: 0.5, recentActivityAt: now, properties: {} });

const runtime = new AdvancedExperienceRuntime((id) => local.listTasks().find((candidate) => candidate.id === id));
const composition = new AdvancedProducerComposition(local, phase4, runtime);
const owner = 'owner-phase7d';
const workspace = 'workspace-phase7d';

const mission = await composition.invoke(owner, workspace, 'mission-memory', { sourceTaskId: task.id });
assert.equal(mission.status, 'published');
assert.equal(runtime.list('mission-memories', owner, workspace).length, 1);

const outcome = await composition.invoke(owner, workspace, 'outcome', { taskIds: [task.id], generatedKnowledgeNodeIds: ['generated-journal'] });
assert.equal(outcome.status, 'published');
const storedOutcome = runtime.list('orchestration', owner, workspace)[0];
assert.equal(storedOutcome.status, 'completed');
assert.throws(() => runtime.put('orchestration', { ...storedOutcome, planId: 'forged-plan', revision: 1 }), /SERVER_VERIFIED_COMPLETION_REQUIRED/);

const unverifiedJournal = await composition.invoke(owner, workspace, 'outcome', { taskIds: [task.id], generatedKnowledgeNodeIds: ['user-note'] });
assert.equal(unverifiedJournal.status, 'unverified');

const workspaceResult = await composition.invoke(owner, workspace, 'workspace', { taskIds: [task.id], skillIds: [] });
assert.equal(workspaceResult.status, 'published');
assert.equal(runtime.list('snapshots', owner, workspace).length, 1);
assert.equal(runtime.list('orchestration', owner, workspace).some((record) => record.kind === 'one_command_workspace' && record.status === 'configuration_required'), true);

class FailingPlanRuntime extends AdvancedExperienceRuntime {
  override putTrusted(kind: AdvancedResourceKind, record: AdvancedResource, trust: AdvancedPublishTrust): AdvancedResource {
    if (kind === 'orchestration') throw new Error('SYNTHETIC_PLAN_FAILURE');
    return super.putTrusted(kind, record, trust);
  }
}
const partialRuntime = new FailingPlanRuntime((id) => local.listTasks().find((candidate) => candidate.id === id));
const partialComposition = new AdvancedProducerComposition(local, phase4, partialRuntime);
const partial = await partialComposition.invoke(owner, 'workspace-partial', 'workspace', { taskIds: [task.id], skillIds: [] });
assert.equal(partial.status, 'partial');
assert.equal(partialRuntime.list('snapshots', owner, 'workspace-partial').length, 1);
assert.equal(partialRuntime.list('orchestration', owner, 'workspace-partial').length, 0);
if (partial.status === 'partial') assert.equal(partial.restoreReady, false);

const restarted = new AdvancedExperienceRuntime((id) => local.listTasks().find((candidate) => candidate.id === id));
assert.equal(restarted.list('mission-memories', owner, workspace).length, 0);
assert.equal(restarted.capabilityStatus().persistence, 'memory_only');
assert.equal(restarted.capabilityStatus().restartRecovery, 'partial');

console.log(JSON.stringify({ success: true, checks: ['persisted_task_to_internal_publish', 'owner_state_contains_publish', 'completed_outcome_server_reread', 'forged_completed_outcome_rejected', 'generated_obsidian_marker_reread', 'workspace_snapshot_before_plan', 'workspace_partial_not_restore_ready', 'restart_memory_only_truth'] }, null, 2));

local.close?.();
for (let attempt = 0; attempt < 6; attempt += 1) {
  try { fs.rmSync(root, { recursive: true, force: true }); break; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EBUSY' || attempt === 5) break;
    await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
  }
}
