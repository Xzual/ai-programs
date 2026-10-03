import type { EdithTask } from '../../src/edith/core';
import type {
  AdvancedExperienceLineageV2,
  CapsuleContextCandidateV2,
  CapsuleContextSelectionV2,
  GhostTaskV2,
  MissionMemoryV2,
  PriorityTaskPolicyV2,
  RecentContextEventV2,
  WatcherV2,
} from '../../src/edith/contracts';
import { taskQueueService } from '../../src/edith/taskQueueService';
import { taskService } from '../../src/edith/taskService';
import { onKillSwitchActivated } from '../../src/edith/killSwitch';
import { onOwnerSessionInvalidated } from '../security/ownerSession';
import { getPhase4ApiRuntime } from '../routes/phase4Api';
import { removeAdvancedPriorityPoliciesForOwner, setAdvancedPriorityPolicy } from './priorityRegistry';

export type AdvancedResource = AdvancedExperienceLineageV2 & Record<string, unknown>;
export type AdvancedResourceKind =
  | 'priority' | 'shadow' | 'ghosts' | 'mission-memories' | 'bookmarks' | 'recent-context'
  | 'snapshots' | 'restore-plans' | 'scenes' | 'watchers' | 'comparisons' | 'communication'
  | 'orchestration' | 'retries' | 'downloads' | 'power-presence' | 'history-policy' | 'capsule-selection';
export type AdvancedPublishTrust = 'internal_producer' | 'trusted_native';

const MAX_PER_KIND = 256;
const CAPSULE_RANK: Record<CapsuleContextCandidateV2['kind'], number> = {
  attention_required: 1,
  critical_milestone: 2,
  progress: 3,
  media: 4,
  idle_voice: 5,
};

function keyOf(record: AdvancedResource): string {
  const keys = ['taskId', 'ghostTaskId', 'memoryId', 'bookmarkId', 'eventId', 'snapshotId', 'planId', 'sceneId', 'watcherId', 'comparisonId', 'retryId', 'downloadId', 'policyId', 'selectionId'];
  for (const key of keys) if (typeof record[key] === 'string') return String(record[key]);
  return `${record.ownerSessionBindingId}:${record.workspaceId}`;
}

function clone<T>(value: T): T { return structuredClone(value); }
function nextTimestamp(previous: string): string {
  return new Date(Math.max(Date.now(), Date.parse(previous) + 1)).toISOString();
}

export class AdvancedExperienceRuntime {
  private readonly records = new Map<AdvancedResourceKind, Map<string, AdvancedResource>>();

  constructor(private readonly getTask: (taskId: string) => EdithTask | undefined = (id) => taskService.getTask(id)) {}

  put(kind: AdvancedResourceKind, record: AdvancedResource): AdvancedResource {
    return this.putWithTrust(kind, record);
  }

  putTrusted(kind: AdvancedResourceKind, record: AdvancedResource, trust: AdvancedPublishTrust): AdvancedResource {
    return this.putWithTrust(kind, record, trust);
  }

  private putWithTrust(kind: AdvancedResourceKind, record: AdvancedResource, trust?: AdvancedPublishTrust): AdvancedResource {
    this.cleanup();
    this.assertEvidence(kind, record, trust);
    const bucket = this.records.get(kind) ?? new Map<string, AdvancedResource>();
    const key = keyOf(record);
    const current = bucket.get(key);
    if (current) {
      if (current.ownerSessionBindingId !== record.ownerSessionBindingId || current.workspaceId !== record.workspaceId) throw new Error('ADVANCED_RESOURCE_BINDING_CONFLICT');
      if (record.revision !== current.revision + 1) throw new Error('ADVANCED_RESOURCE_REVISION_CONFLICT');
      if (record.createdAt !== current.createdAt || Date.parse(record.updatedAt) <= Date.parse(current.updatedAt)) throw new Error('ADVANCED_RESOURCE_LINEAGE_CONFLICT');
    } else if (record.revision !== 1) {
      throw new Error('ADVANCED_RESOURCE_INITIAL_REVISION_INVALID');
    }
    bucket.set(key, clone(record));
    while (bucket.size > MAX_PER_KIND) bucket.delete(bucket.keys().next().value as string);
    this.records.set(kind, bucket);
    if (kind === 'priority') setAdvancedPriorityPolicy(record as unknown as PriorityTaskPolicyV2);
    return clone(record);
  }

  list(kind: AdvancedResourceKind, ownerSessionBindingId: string, workspaceId: string): AdvancedResource[] {
    this.cleanup();
    return [...(this.records.get(kind)?.values() ?? [])]
      .filter((item) => item.ownerSessionBindingId === ownerSessionBindingId && item.workspaceId === workspaceId)
      .map(clone);
  }

  state(ownerSessionBindingId: string, workspaceId: string): Record<AdvancedResourceKind, AdvancedResource[]> {
    return Object.fromEntries(ADVANCED_RESOURCE_KINDS.map((kind) => [kind, this.list(kind, ownerSessionBindingId, workspaceId)])) as Record<AdvancedResourceKind, AdvancedResource[]>;
  }

  pauseGhost(ownerSessionBindingId: string, workspaceId: string, ghostTaskId: string): GhostTaskV2 {
    return this.mutateGhost(ownerSessionBindingId, workspaceId, ghostTaskId, 'paused', () => taskQueueService.pause(this.ghost(ownerSessionBindingId, workspaceId, ghostTaskId).taskId, 'Ghost task paused by owner.'));
  }

  cancelGhost(ownerSessionBindingId: string, workspaceId: string, ghostTaskId: string): GhostTaskV2 {
    return this.mutateGhost(ownerSessionBindingId, workspaceId, ghostTaskId, 'cancelled', () => taskQueueService.cancel(this.ghost(ownerSessionBindingId, workspaceId, ghostTaskId).taskId, 'Ghost task cancelled by owner.', 'edith-advanced-runtime'));
  }

  cancelWatcher(ownerSessionBindingId: string, workspaceId: string, watcherId: string): WatcherV2 {
    const watcher = this.find('watchers', ownerSessionBindingId, workspaceId, 'watcherId', watcherId) as unknown as WatcherV2 | undefined;
    if (!watcher) throw new Error('WATCHER_NOT_FOUND');
    const now = nextTimestamp(watcher.updatedAt);
    return this.put('watchers', { ...watcher, revision: watcher.revision + 1, updatedAt: now, status: 'cancelled', cancelledAt: now }) as unknown as WatcherV2;
  }

  searchHistory(ownerSessionBindingId: string, workspaceId: string, query: string): RecentContextEventV2[] {
    const policy = this.list('history-policy', ownerSessionBindingId, workspaceId)[0];
    const retentionDays = Number(policy?.retentionDays ?? 7);
    const purgedBefore = policy?.purgedBefore ? Date.parse(String(policy.purgedBefore)) : 0;
    const cutoff = Math.max(Date.now() - retentionDays * 86_400_000, purgedBefore);
    const allowed = new Set(Array.isArray(policy?.searchableKinds) ? policy.searchableKinds.map(String) : ['task', 'app', 'window', 'bookmark', 'research', 'download']);
    const needle = query.trim().toLocaleLowerCase();
    return (this.list('recent-context', ownerSessionBindingId, workspaceId) as unknown as RecentContextEventV2[])
      .filter((event) => Date.parse(event.occurredAt) >= cutoff && allowed.has(event.kind) && (!needle || event.safeSummary.toLocaleLowerCase().includes(needle)))
      .slice(-50);
  }

  selectCapsule(ownerSessionBindingId: string, workspaceId: string, candidates: CapsuleContextCandidateV2[]): CapsuleContextSelectionV2 {
    const active = candidates.filter((item) => Date.parse(item.expiresAt) > Date.now()).sort((a, b) => CAPSULE_RANK[a.kind] - CAPSULE_RANK[b.kind] || Date.parse(b.observedAt) - Date.parse(a.observedAt));
    if (!active[0]) throw new Error('CAPSULE_CANDIDATE_REQUIRED');
    const now = new Date().toISOString();
    return this.put('capsule-selection', {
      contractVersion: 2, amendment: '2.1', ownerSessionBindingId, workspaceId, revision: 1,
      createdAt: now, updatedAt: now, selectionId: `selection:${Date.now()}`, selected: active[0],
      consideredCandidateIds: active.map((item) => item.candidateId), deterministicRank: CAPSULE_RANK[active[0].kind],
    }) as unknown as CapsuleContextSelectionV2;
  }

  invalidateOwner(ownerSessionBindingId: string): void {
    for (const bucket of this.records.values()) for (const [key, value] of bucket) if (value.ownerSessionBindingId === ownerSessionBindingId) bucket.delete(key);
    removeAdvancedPriorityPoliciesForOwner(ownerSessionBindingId);
  }

  emergencyStop(): void {
    for (const kind of ['ghosts', 'watchers', 'scenes', 'orchestration'] as AdvancedResourceKind[]) {
      const bucket = this.records.get(kind);
      if (!bucket) continue;
      for (const [key, value] of bucket) {
        const status = kind === 'watchers' ? 'cancelled' : kind === 'scenes' ? 'reverted' : kind === 'ghosts' ? 'cancelled' : 'failed';
        if (value.status === status) continue;
        const updatedAt = nextTimestamp(value.updatedAt);
        bucket.set(key, { ...value, revision: value.revision + 1, updatedAt, status, ...(kind === 'watchers' ? { cancelledAt: updatedAt } : {}) });
      }
    }
  }

  capabilityStatus() {
    return {
      persistence: 'memory_only', restartRecovery: 'partial', nativeExecution: 'configuration_required',
      scheduler: 'configuration_required', watcherObservation: 'metadata_only', watcherDelivery: 'configuration_required',
      mobileRead: 'available', secretsStored: false,
    } as const;
  }

  private assertEvidence(kind: AdvancedResourceKind, record: AdvancedResource, trust?: AdvancedPublishTrust): void {
    if (kind === 'priority' || kind === 'ghosts' || kind === 'retries') {
      const taskId = String(record.taskId ?? '');
      const task = this.getTask(taskId);
      if (!task) throw new Error('TASK_NOT_FOUND');
      if (kind === 'priority') {
        const dependencies = (record.dependencyTaskIds as string[]).map((id) => this.getTask(id));
        if (dependencies.some((task) => !task)) throw new Error('DEPENDENCY_TASK_NOT_FOUND');
        const blocked = dependencies.some((task) => task?.status !== 'COMPLETED');
        if (record.blockedByDependencies !== blocked) throw new Error('DEPENDENCY_STATE_MISMATCH');
      }
    }
    if (kind === 'mission-memories') {
      const memory = record as unknown as MissionMemoryV2;
      const task = this.getTask(memory.sourceTaskId);
      if (!task || task.verification?.status !== 'PASS') throw new Error('VERIFIED_TASK_EVIDENCE_REQUIRED');
      if (memory.sourceResearchRunId) {
        const run = getPhase4ApiRuntime().persistence.getResearchRun(memory.sourceResearchRunId);
        if (!run || run.status !== 'completed' || !run.provenance || !run.claims?.length) throw new Error('VERIFIED_RESEARCH_EVIDENCE_REQUIRED');
      }
      if (memory.sourcePlaybookRunId) {
        const run = getPhase4ApiRuntime().persistence.getPlaybookRun(memory.sourcePlaybookRunId);
        if (!run || run.status !== 'completed' || !run.stepRuns?.length || run.stepRuns.some((step) => step.status !== 'completed' || step.verificationStatus !== 'PASS')) throw new Error('VERIFIED_PLAYBOOK_EVIDENCE_REQUIRED');
      }
    }
    if (kind === 'restore-plans' || kind === 'scenes') {
      if (record.status !== 'configuration_required' && !(kind === 'scenes' && trust === 'trusted_native')) throw new Error('NATIVE_RUNTIME_CONFIGURATION_REQUIRED');
    }
    if (kind === 'orchestration' && record.status === 'completed' && trust !== 'internal_producer') throw new Error('SERVER_VERIFIED_COMPLETION_REQUIRED');
    if ((kind === 'downloads' || kind === 'power-presence') && !trust) throw new Error('TRUSTED_PRODUCER_REQUIRED');
    if (kind === 'watchers' && record.status === 'active' && trust === 'trusted_native') throw new Error('WATCHER_DELIVERY_CONFIGURATION_REQUIRED');
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [kind, bucket] of this.records) for (const [key, value] of bucket) {
      if (value.expiresAt && Date.parse(value.expiresAt) <= now) {
        if (kind === 'watchers' && value.status !== 'expired') bucket.set(key, { ...value, revision: value.revision + 1, updatedAt: new Date(now).toISOString(), status: 'expired' });
        else if (kind === 'watchers') continue;
        else bucket.delete(key);
      }
    }
  }

  private find(kind: AdvancedResourceKind, owner: string, workspace: string, field: string, id: string): AdvancedResource | undefined {
    return this.list(kind, owner, workspace).find((item) => item[field] === id);
  }

  private ghost(owner: string, workspace: string, id: string): GhostTaskV2 {
    const ghost = this.find('ghosts', owner, workspace, 'ghostTaskId', id) as unknown as GhostTaskV2 | undefined;
    if (!ghost) throw new Error('GHOST_TASK_NOT_FOUND');
    return ghost;
  }

  private mutateGhost(owner: string, workspace: string, id: string, status: GhostTaskV2['status'], action: () => EdithTask | undefined): GhostTaskV2 {
    const ghost = this.ghost(owner, workspace, id);
    if (!action()) throw new Error('TASK_NOT_FOUND');
    return this.put('ghosts', { ...ghost, revision: ghost.revision + 1, updatedAt: nextTimestamp(ghost.updatedAt), status, reasonCode: `owner_${status}` }) as unknown as GhostTaskV2;
  }
}

export const ADVANCED_RESOURCE_KINDS: AdvancedResourceKind[] = ['priority', 'shadow', 'ghosts', 'mission-memories', 'bookmarks', 'recent-context', 'snapshots', 'restore-plans', 'scenes', 'watchers', 'comparisons', 'communication', 'orchestration', 'retries', 'downloads', 'power-presence', 'history-policy', 'capsule-selection'];

let runtime: AdvancedExperienceRuntime | undefined;
export function getAdvancedExperienceRuntime(): AdvancedExperienceRuntime {
  if (!runtime) {
    runtime = new AdvancedExperienceRuntime();
    onOwnerSessionInvalidated((event) => runtime?.invalidateOwner(event.bindingId));
    onKillSwitchActivated(() => runtime?.emergencyStop());
  }
  return runtime;
}
