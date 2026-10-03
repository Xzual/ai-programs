import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { EdithTask } from '../src/edith/core';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'edith-phase7a-'));
const originalCwd = process.cwd();
process.chdir(tempRoot);
process.env.EDITH_PERSISTENCE = 'json';

try {
  const { AdvancedExperienceRuntime } = await import('../server/advanced/runtime');
  const { setAdvancedPriorityPolicy, clearAdvancedPriorityPolicies } = await import('../server/advanced/priorityRegistry');
  const { taskService } = await import('../src/edith/taskService');
  const { taskQueueService } = await import('../src/edith/taskQueueService');
  const { getEdithPersistenceStore } = await import('../src/edith/persistence');

  const fakeTask = { id: 'verified-task', status: 'COMPLETED', verification: { status: 'PASS' } } as EdithTask;
  const runtime = new AdvancedExperienceRuntime((id) => id === fakeTask.id ? fakeTask : undefined);
  const now = new Date().toISOString();
  const later = new Date(Date.now() + 60_000).toISOString();
  const base = { contractVersion: 2 as const, amendment: '2.1' as const, ownerSessionBindingId: 'owner-1', workspaceId: 'workspace-1', revision: 1, createdAt: now, updatedAt: now };

  runtime.put('mission-memories', { ...base, memoryId: 'memory-1', sourceTaskId: 'verified-task', verificationStatus: 'verified', routeSummary: 'Verified execution route.', avoidRouteCodes: [], currentStateReverificationRequired: true });
  assert.equal(runtime.list('mission-memories', 'owner-1', 'workspace-1').length, 1);
  assert.equal(runtime.list('mission-memories', 'owner-2', 'workspace-1').length, 0);
  assert.throws(() => runtime.put('mission-memories', { ...base, revision: 3, updatedAt: later, memoryId: 'memory-1', sourceTaskId: 'verified-task', verificationStatus: 'verified', routeSummary: 'Updated route.', avoidRouteCodes: [], currentStateReverificationRequired: true }), /REVISION_CONFLICT/);
  assert.throws(() => runtime.put('restore-plans', { ...base, planId: 'restore-1', snapshotId: 'snapshot-1', steps: [], requiresVerification: true, secretsExcluded: true, dangerousTransactionsExcluded: true, status: 'planned' }), /CONFIGURATION_REQUIRED/);
  assert.throws(() => runtime.put('orchestration', { ...base, planId: 'plan-1', kind: 'outcome_mode', objective: 'Verified outcome', references: [], steps: [{ stepId: 'step-1', referenceId: 'verified-task', status: 'verified' }], arbitraryShell: false, status: 'completed', verifiedDownstreamResultIds: ['result-1'] }), /SERVER_VERIFIED_COMPLETION_REQUIRED/);

  runtime.put('watchers', { ...base, expiresAt: new Date(Date.now() - 1).toISOString(), watcherId: 'watcher-1', kind: 'task', sourceRef: 'verified-task', trigger: 'completed', delivery: 'desktop', observationPolicy: 'event_based', status: 'active' });
  const expired = runtime.list('watchers', 'owner-1', 'workspace-1')[0];
  assert.equal(expired.status, 'expired');
  runtime.invalidateOwner('owner-1');
  assert.equal(runtime.list('mission-memories', 'owner-1', 'workspace-1').length, 0);
  assert.equal(runtime.capabilityStatus().restartRecovery, 'partial');
  assert.equal(runtime.capabilityStatus().mobileRead, 'available');

  const low = taskService.createTask({ title: 'Low', objective: 'Low priority task', originalUserRequest: 'low' });
  const high = taskService.createTask({ title: 'High', objective: 'High priority task', originalUserRequest: 'high' });
  const dependency = taskService.createTask({ title: 'Dependency', objective: 'Dependency task', originalUserRequest: 'dependency' });
  taskService.updateStatus(dependency.id, 'RUNNING');
  taskQueueService.enqueue(low.id);
  taskQueueService.enqueue(high.id);
  setAdvancedPriorityPolicy({ ...base, taskId: low.id, priority: 'LOW', dependencyTaskIds: [], atomicOperation: false, securityCritical: false, derivedFromUrgentLanguage: false, blockedByDependencies: false });
  setAdvancedPriorityPolicy({ ...base, taskId: high.id, priority: 'HIGH', dependencyTaskIds: [dependency.id], atomicOperation: false, securityCritical: false, derivedFromUrgentLanguage: false, blockedByDependencies: true });
  assert.equal(taskQueueService.next()?.id, low.id, 'Blocked HIGH task must not jump an incomplete dependency.');
  taskService.updateStatus(dependency.id, 'COMPLETED', 'Dependency completed.');
  assert.equal(taskQueueService.next()?.id, high.id, 'Eligible HIGH task must be selected before LOW.');

  clearAdvancedPriorityPolicies();
  getEdithPersistenceStore().close?.();
  console.log(JSON.stringify({ success: true, scenarios: ['owner_workspace_isolation', 'revision_conflict', 'verified_mission_memory', 'native_configuration_required', 'watcher_expiry', 'owner_revocation', 'dependency_aware_priority_queue', 'memory_only_truth', 'mobile_read_capability_truth'] }, null, 2));
} finally {
  process.chdir(originalCwd);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EBUSY' || attempt === 5) {
        console.warn(`Phase 7A temp cleanup deferred: ${tempRoot}`);
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
    }
  }
}
