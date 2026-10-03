import {
  parseCommunicationPolicyV2,
  parseCompareChangeV2,
  parseDownloadButlerStatusV2,
  parseGhostTaskV2,
  parseMissionMemoryV2,
  parseOrchestrationPlanV2,
  parseRecentContextEventV2,
  parseSmartRetryPlanV2,
  parseWatcherV2,
  parseWorkspaceSnapshotV2,
  type HistoryRetentionPolicyV2,
  type OrchestrationPlanV2,
} from '../../src/edith/contracts';
import {
  AdvancedExperienceProducerService,
  type AdvancedPublishResource,
  type CanonicalPublish,
  type ProducerContext,
  type ProducerUnavailable,
  type VerifiedReferenceEvidence,
} from '../../src/edith/advancedExperienceProducers';
import { getEdithPersistenceStore, type EdithPersistenceStore } from '../../src/edith/persistence';
import type { Phase4Persistence } from '../../src/edith/phase4Persistence';
import { obsidianVaultService } from '../../src/edith/obsidianVaultService';
import { edithToolRegistry } from '../../src/edith/serverRegistry';
import { listExternalSkillProjects } from '../../src/edith/skills/catalog';
import { getPhase4ApiRuntime } from '../routes/phase4Api';
import { getAdvancedExperienceRuntime, type AdvancedExperienceRuntime, type AdvancedResource } from './runtime';

const SAFE_ID = /^[A-Za-z0-9._:-]{1,256}$/;
const ID_FIELDS = ['ghostTaskId', 'memoryId', 'eventId', 'snapshotId', 'watcherId', 'comparisonId', 'planId', 'retryId', 'downloadId'] as const;

type InternalOperation = 'mission-memory' | 'recent-context' | 'outcome' | 'workspace' | 'retry' | 'watcher' | 'communication' | 'ghost';
type PublishResult = { status: 'published'; records: AdvancedResource[]; restoreReady: boolean } | { status: 'partial'; records: AdvancedResource[]; restoreReady: false; errorCode: string } | ProducerUnavailable;

const parsers: Record<AdvancedPublishResource, (value: unknown) => { success: true; value: unknown } | { success: false; errorCode: string; message: string }> = {
  ghosts: parseGhostTaskV2,
  'mission-memories': parseMissionMemoryV2,
  'recent-context': parseRecentContextEventV2,
  snapshots: parseWorkspaceSnapshotV2,
  watchers: parseWatcherV2,
  comparisons: parseCompareChangeV2,
  communication: parseCommunicationPolicyV2,
  orchestration: parseOrchestrationPlanV2,
  retries: parseSmartRetryPlanV2,
  downloads: parseDownloadButlerStatusV2,
};

function ids(value: unknown, maximum = 64): string[] {
  if (!Array.isArray(value) || value.length > maximum || !value.every((item) => typeof item === 'string' && SAFE_ID.test(item))) throw new Error('SOURCE_IDS_INVALID');
  return [...new Set(value)];
}

function id(value: unknown): string {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) throw new Error('SOURCE_ID_INVALID');
  return value;
}

function keyOf(value: AdvancedResource): string | undefined {
  for (const field of ID_FIELDS) if (typeof value[field] === 'string') return String(value[field]);
  return undefined;
}

function nextTimestamp(previous: string): string {
  return new Date(Math.max(Date.now(), Date.parse(previous) + 1)).toISOString();
}

export class AdvancedProducerComposition {
  private readonly services = new Map<string, { fingerprint: string; service: AdvancedExperienceProducerService }>();

  constructor(
    private readonly local: EdithPersistenceStore = getEdithPersistenceStore(),
    private readonly phase4: Phase4Persistence = getPhase4ApiRuntime().persistence,
    private readonly runtime: AdvancedExperienceRuntime = getAdvancedExperienceRuntime(),
  ) {}

  async invoke(ownerSessionBindingId: string, workspaceId: string, operation: InternalOperation, input: Record<string, unknown>): Promise<PublishResult> {
    const context: ProducerContext = { ownerSessionBindingId, workspaceId };
    const service = await this.service(ownerSessionBindingId, workspaceId);

    if (operation === 'mission-memory') {
      const result = service.missionMemory(context, {
        sourceTaskId: id(input.sourceTaskId),
        ...(input.sourcePlaybookRunId ? { sourcePlaybookRunId: id(input.sourcePlaybookRunId) } : {}),
        ...(input.sourceResearchRunId ? { sourceResearchRunId: id(input.sourceResearchRunId) } : {}),
        avoidRouteCodes: input.avoidRouteCodes === undefined ? [] : ids(input.avoidRouteCodes, 32),
      });
      return result.status === 'ready' ? this.publish(result.publish) : result;
    }
    if (operation === 'ghost') {
      const result = service.ghostTask(context, id(input.taskId));
      return result.status === 'ready' ? this.publish(result.publish) : result;
    }
    if (operation === 'retry') {
      const failureClass = String(input.failureClass ?? '');
      if (!['network', 'page_changed', 'app_closed', 'stale_target', 'permission_denied', 'other'].includes(failureClass)) throw new Error('FAILURE_CLASS_INVALID');
      if (!Number.isSafeInteger(input.attempts) || Number(input.attempts) < 0 || Number(input.attempts) > 2) throw new Error('RETRY_ATTEMPTS_INVALID');
      const result = service.smartRetry(context, id(input.taskId), failureClass as Parameters<AdvancedExperienceProducerService['smartRetry']>[2], Number(input.attempts));
      return result.status === 'ready' ? this.publish(result.publish) : result;
    }
    if (operation === 'communication') {
      if (typeof input.autoBrief !== 'boolean' || typeof input.voicePresence !== 'boolean' || input.maxSentences !== undefined && ![1, 2, 3].includes(Number(input.maxSentences))) throw new Error('COMMUNICATION_INPUT_INVALID');
      const result = service.communicationPolicy(context, { autoBrief: input.autoBrief, voicePresence: input.voicePresence, ...(input.maxSentences ? { maxSentences: Number(input.maxSentences) as 1 | 2 | 3 } : {}) });
      return result.status === 'ready' ? this.publish(result.publish) : result;
    }
    if (operation === 'watcher') {
      const status = obsidianVaultService.status();
      const result = service.watcherIntent(context, {
        watcherId: id(input.watcherId), sourceRef: id(input.sourceRef), kind: input.kind === 'folder' ? 'folder' : 'file',
        trigger: input.trigger === 'created' ? 'created' : input.trigger === 'completed' ? 'completed' : 'changed',
        delivery: 'desktop', obsidianWatcherActive: status.watcherActive,
      });
      return result.status === 'ready' ? this.publish(result.publish) : result;
    }
    if (operation === 'recent-context') {
      const now = new Date().toISOString();
      const retentionDays = Number(input.retentionDays ?? 30);
      if (!Number.isSafeInteger(retentionDays) || retentionDays < 1 || retentionDays > 365) throw new Error('RETENTION_DAYS_INVALID');
      const searchableKinds = input.searchableKinds === undefined ? ['task', 'research', 'download'] : ids(input.searchableKinds, 6);
      const policy: HistoryRetentionPolicyV2 = {
        contractVersion: 2, amendment: '2.1', ownerSessionBindingId, workspaceId, revision: 1, createdAt: now, updatedAt: now,
        policyId: `history:${workspaceId}`, retentionDays, includePrivate: false,
        searchableKinds: searchableKinds as HistoryRetentionPolicyV2['searchableKinds'],
      };
      const result = service.recentContext(context, policy);
      if (result.status !== 'ready') return result;
      const records: AdvancedResource[] = [];
      for (const payload of result.publish.payload) records.push(...(await this.publish({ ...result.publish, payload })).records);
      return { status: 'published', records, restoreReady: false };
    }
    if (operation === 'workspace') {
      const taskIds = ids(input.taskIds ?? []);
      const skillIds = ids(input.skillIds ?? []);
      const tasks = taskIds.map((taskId) => this.local.listTasks().find((task) => task.id === taskId));
      if (tasks.some((task) => !task)) return { status: 'not_found', reasonCode: 'WORKSPACE_TASK_NOT_FOUND', safeMessage: 'A referenced task was not found.' };
      const result = service.workspacePlan(context, {
        label: 'Selected E.D.I.T.H. workspace', taskIds, skillIds,
        items: tasks.map((task) => ({ kind: 'task' as const, refId: task!.id, displayLabel: task!.title.slice(0, 500) })),
      });
      if (result.status !== 'ready') return result;
      const snapshot = await this.publish(result.snapshot);
      try {
        const plan = await this.publish(result.plan);
        return { status: 'published', records: [...snapshot.records, ...plan.records], restoreReady: false };
      } catch (error) {
        return { status: 'partial', records: snapshot.records, restoreReady: false, errorCode: error instanceof Error ? error.message : 'WORKSPACE_PLAN_PUBLICATION_FAILED' };
      }
    }
    if (operation === 'outcome') {
      const taskIds = ids(input.taskIds ?? []);
      const researchRunIds = ids(input.researchRunIds ?? []);
      const playbookRunIds = ids(input.playbookRunIds ?? []);
      const generatedKnowledgeNodeIds = ids(input.generatedKnowledgeNodeIds ?? []);
      const skillIds = ids(input.skillIds ?? []);
      const evidence: VerifiedReferenceEvidence[] = [];
      for (const nodeId of generatedKnowledgeNodeIds) {
        const node = this.local.listKnowledgeNodes?.().find((candidate) => candidate.id === nodeId && !candidate.deletedAt);
        if (!node || typeof node.properties.edith_generated !== 'string') return { status: 'unverified', reasonCode: 'GENERATED_OBSIDIAN_EVIDENCE_REQUIRED', safeMessage: 'Generated Obsidian evidence was not verified in persistence.' };
        evidence.push({ kind: 'artifact', id: nodeId, verified: true, source: 'obsidian_journal' });
      }
      for (const skillId of skillIds) evidence.push({ kind: 'skill', id: skillId, verified: true, source: 'skill_registry' });
      const result = service.outcomePlan(context, { objective: 'Complete verified selected sources', taskIds, researchRunIds, playbookRunIds, evidence });
      if (result.status !== 'ready') return result;
      this.assertOutcomeSources(result.publish.payload, result.publish.sourceEvidenceIds);
      return this.publish(result.publish);
    }
    throw new Error('ADVANCED_OPERATION_NOT_FOUND');
  }

  async publish<T>(canonical: CanonicalPublish<T>): Promise<{ status: 'published'; records: AdvancedResource[]; restoreReady: false }> {
    const payloads = Array.isArray(canonical.payload) ? canonical.payload : [canonical.payload];
    const records: AdvancedResource[] = [];
    for (const source of payloads) {
      const candidate = this.withRuntimeRevision(canonical.resource, source as AdvancedResource);
      const parsed = parsers[canonical.resource](candidate);
      if (parsed.success === false) throw new Error(parsed.errorCode);
      const record = parsed.value as AdvancedResource;
      records.push(this.runtime.putTrusted(canonical.resource, record, 'internal_producer'));
    }
    return { status: 'published', records, restoreReady: false };
  }

  private async service(owner: string, workspace: string): Promise<AdvancedExperienceProducerService> {
    const knownSkillIds = [
      ...edithToolRegistry.list().map((tool) => tool.id),
      ...listExternalSkillProjects().map((skill) => skill.id),
    ];
    const fingerprint = knownSkillIds.sort().join(':');
    const key = `${owner}:${workspace}`;
    const current = this.services.get(key);
    if (current?.fingerprint === fingerprint) return current.service;
    const service = new AdvancedExperienceProducerService(this.local, this.phase4, { knownSkillIds, safeTerminalSkillIds: [] });
    this.services.set(key, { fingerprint, service });
    return service;
  }

  private withRuntimeRevision(resource: AdvancedPublishResource, source: AdvancedResource): AdvancedResource {
    const key = keyOf(source);
    const existing = this.runtime.list(resource, source.ownerSessionBindingId, source.workspaceId)
      .find((item) => key ? keyOf(item) === key : resource === 'communication');
    if (!existing) return source;
    return { ...source, revision: existing.revision + 1, createdAt: existing.createdAt, updatedAt: nextTimestamp(existing.updatedAt) };
  }

  private assertOutcomeSources(plan: OrchestrationPlanV2, sourceEvidenceIds: string[]): void {
    if (plan.status !== 'completed') return;
    const evidence = new Set(sourceEvidenceIds);
    if (!plan.verifiedDownstreamResultIds.length || plan.references.some((reference) => !evidence.has(reference.id) && reference.kind !== 'artifact')) throw new Error('OUTCOME_SOURCE_REREAD_FAILED');
    for (const reference of plan.references) {
      if (reference.kind === 'task') {
        const task = this.local.listTasks().find((candidate) => candidate.id === reference.id);
        if (!task || task.status !== 'COMPLETED' || task.verification?.status !== 'PASS') throw new Error('OUTCOME_TASK_REREAD_UNVERIFIED');
      } else if (reference.kind === 'research') {
        const run = this.phase4.getResearchRun(reference.id);
        if (!run || run.status !== 'completed' || !run.claims?.length || !run.citations?.length) throw new Error('OUTCOME_RESEARCH_REREAD_UNVERIFIED');
      } else if (reference.kind === 'skill') {
        const service = [...this.services.values()].find((entry) => entry.fingerprint.split(':').includes(reference.id));
        if (!service) throw new Error('OUTCOME_SKILL_REREAD_UNVERIFIED');
      } else if (reference.kind === 'transfer') {
        throw new Error('OUTCOME_TRANSFER_TRUSTED_SOURCE_REQUIRED');
      } else if (reference.kind === 'artifact') {
        const generated = this.local.listKnowledgeNodes?.().some((node) => node.id === reference.id && typeof node.properties.edith_generated === 'string');
        const playbookArtifact = this.phase4.listPlaybookRuns().some((run) => run.status === 'completed' && run.stepRuns?.some((step) => step.verificationStatus === 'PASS' && step.outputArtifactIds?.includes(reference.id)));
        if (!generated && !playbookArtifact) throw new Error('OUTCOME_ARTIFACT_REREAD_UNVERIFIED');
      }
    }
  }
}

let composition: AdvancedProducerComposition | undefined;
export function getAdvancedProducerComposition(): AdvancedProducerComposition {
  return composition ??= new AdvancedProducerComposition();
}
