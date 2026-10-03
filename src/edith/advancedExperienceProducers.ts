import { createHash } from 'node:crypto';
import type {
  CapsuleContextCandidateV2,
  CommunicationPolicyV2,
  CompareChangeV2,
  CrossDeviceTransferV2,
  DownloadButlerStatusV2,
  GhostTaskV2,
  HistoryRetentionPolicyV2,
  MissionMemoryV2,
  OrchestrationPlanV2,
  RecentContextEventV2,
  WatcherV2,
  WorkspaceSnapshotV2,
} from './contracts';
import {
  EDITH_CONTRACT_AMENDMENT,
  TASK_CONTRACT_VERSION,
  parseCapsuleContextCandidateV2,
  parseCommunicationPolicyV2,
  parseCompareChangeV2,
  parseCrossDeviceTransferV2,
  parseDownloadButlerStatusV2,
  parseGhostTaskV2,
  parseHistoryRetentionPolicyV2,
  parseMissionMemoryV2,
  parseOrchestrationPlanV2,
  parseRecentContextEventV2,
  parseSmartRetryPlanV2,
  parseWatcherV2,
  parseWorkspaceSnapshotV2,
} from './contracts';
import type { EdithTask, KnowledgeRecommendation } from './core';
import type { EdithPersistenceStore } from './persistence/types';
import type { Phase4Persistence } from './phase4Persistence';
import { redactSensitiveString } from './securityRedaction';

export type AdvancedPublishResource =
  | 'ghosts'
  | 'mission-memories'
  | 'recent-context'
  | 'snapshots'
  | 'watchers'
  | 'comparisons'
  | 'communication'
  | 'orchestration'
  | 'retries'
  | 'downloads';

export interface ProducerContext {
  ownerSessionBindingId: string;
  workspaceId: string;
  revision?: number;
  now?: string;
  expiresAt?: string;
}

export interface CanonicalPublish<T> {
  resource: AdvancedPublishResource;
  payload: T;
  sourceEvidenceIds: string[];
}

export type WorkspacePlanResult =
  | {
      status: 'ready';
      snapshot: CanonicalPublish<WorkspaceSnapshotV2>;
      plan: CanonicalPublish<OrchestrationPlanV2>;
    }
  | ProducerUnavailable;

export interface ProducerUnavailable {
  status: 'configuration_required' | 'not_found' | 'unverified' | 'rejected';
  reasonCode: string;
  safeMessage: string;
}

export type ProducerResult<T> =
  | { status: 'ready'; publish: CanonicalPublish<T> }
  | ProducerUnavailable;

export interface SafeTransferHistory {
  transferId: string;
  status: 'pending' | 'transferring' | 'completed' | 'failed' | 'cancelled' | 'configuration_required';
  updatedAt: string;
  verified: boolean;
}

export interface SafeSnapshot {
  ref: string;
  observedAt: string;
  verified: boolean;
  entries?: Array<{ key: string; value: string }>;
}

export interface VerifiedReferenceEvidence {
  kind: 'skill' | 'artifact' | 'transfer';
  id: string;
  verified: boolean;
  source: 'skill_registry' | 'file_generation' | 'obsidian_journal' | 'shared_result_card' | 'cross_device_transfer';
  resultId?: string;
}

export interface DownloadObservation {
  downloadId: string;
  source: DownloadButlerStatusV2['source'];
  displayName: string;
  bytesTransferred: number;
  bytesTotal: number;
  status: DownloadButlerStatusV2['status'];
  observedAt: string;
  verified: boolean;
  speedBytesPerSecond?: number;
  telemetryWindowSeconds?: number;
}

export interface ActualStateBrief {
  briefId: string;
  summary: string;
  voiceSummary: string;
  sourceIds: string[];
  actualStateOnly: true;
  generatedAt: string;
}

export interface PlaybookUpdateSuggestion {
  suggestionId: string;
  playbookRunId: string;
  taskId: string;
  evidenceIds: string[];
  action: 'review_update';
  autoApplied: false;
}

export interface AdvancedProducerOptions {
  knownSkillIds?: Iterable<string>;
  safeTerminalSkillIds?: Iterable<string>;
}

const HOUR = 60 * 60 * 1_000;
const PRIVATE_TEXT = /(?:password|passwd|secret|api[_ -]?key|authorization|bearer|cookie|credential|private key)/i;
const ABSOLUTE_PATH = /(?:[A-Za-z]:[\\/]|\\\\|\/(?:Users|home|tmp|var|etc)\/)/i;

function stableId(prefix: string, value: string): string {
  return `${prefix}-${createHash('sha256').update(value).digest('hex').slice(0, 20)}`;
}

function safeText(value: string, maximum = 500): string {
  const redacted = redactSensitiveString(value).replace(ABSOLUTE_PATH, '[REDACTED_LOCAL_PATH]').replace(/[\u0000-\u001f\u007f]/g, ' ');
  return redacted.trim().slice(0, maximum) || 'State available without a safe textual summary.';
}

function lineage(context: ProducerContext, defaultTtlMs?: number) {
  const createdAt = context.now ?? new Date().toISOString();
  return {
    contractVersion: TASK_CONTRACT_VERSION,
    amendment: EDITH_CONTRACT_AMENDMENT,
    ownerSessionBindingId: context.ownerSessionBindingId,
    workspaceId: context.workspaceId,
    revision: context.revision ?? 1,
    createdAt,
    updatedAt: createdAt,
    ...((context.expiresAt || defaultTtlMs) ? { expiresAt: context.expiresAt ?? new Date(Date.parse(createdAt) + defaultTtlMs!).toISOString() } : {}),
  };
}

function publish<T>(resource: AdvancedPublishResource, payload: T, sourceEvidenceIds: string[]): ProducerResult<T> {
  return { status: 'ready', publish: { resource, payload, sourceEvidenceIds: [...new Set(sourceEvidenceIds)] } };
}

function unavailable(status: ProducerUnavailable['status'], reasonCode: string, safeMessage: string): ProducerUnavailable {
  return { status, reasonCode, safeMessage };
}

function researchVerified(run: ReturnType<Phase4Persistence['getResearchRun']>): boolean {
  if (!run || run.status !== 'completed' || !run.completedAt || !run.claims?.length || !run.citations?.length) return false;
  const citations = new Set(run.citations.map((citation) => citation.citationId));
  return run.claims.every((claim) => claim.status !== 'contradicted' && claim.citationIds.length > 0 && claim.citationIds.every((id) => citations.has(id)));
}

function playbookVerified(run: ReturnType<Phase4Persistence['getPlaybookRun']>): boolean {
  if (!run || run.status !== 'completed' || !run.completedAt || !run.stepRuns?.length) return false;
  return run.stepRuns.every((step) => step.status === 'skipped' || (step.status === 'completed' && step.verificationStatus === 'PASS'));
}

function taskProgress(task: EdithTask): number {
  const steps = task.plan?.steps ?? [];
  if (task.status === 'COMPLETED' && task.verification?.status === 'PASS') return 100;
  if (!steps.length) return task.status === 'RUNNING' ? 10 : 0;
  const complete = steps.filter((step) => step.status === 'COMPLETED' || step.status === 'SKIPPED').length;
  return Math.round((complete / steps.length) * 100);
}

export class AdvancedExperienceProducerService {
  private readonly downloadRevisions = new Map<string, { revision: number; fingerprint: string }>();
  private readonly knownSkillIds: Set<string>;
  private readonly safeTerminalSkillIds: Set<string>;

  constructor(
    private readonly local: EdithPersistenceStore,
    private readonly phase4: Phase4Persistence,
    options: AdvancedProducerOptions = {},
  ) {
    this.knownSkillIds = new Set(options.knownSkillIds ?? []);
    this.safeTerminalSkillIds = new Set(options.safeTerminalSkillIds ?? []);
  }

  missionMemory(context: ProducerContext, input: {
    sourceTaskId: string;
    sourcePlaybookRunId?: string;
    sourceResearchRunId?: string;
    avoidRouteCodes?: string[];
  }): ProducerResult<MissionMemoryV2> {
    const task = this.local.listTasks().find((candidate) => candidate.id === input.sourceTaskId);
    if (!task) return unavailable('not_found', 'TASK_EVIDENCE_NOT_FOUND', 'The source task was not found.');
    if (task.status !== 'COMPLETED' || task.verification?.status !== 'PASS') {
      return unavailable('unverified', 'TASK_VERIFICATION_PASS_REQUIRED', 'Mission Memory requires a completed task with persisted PASS verification.');
    }
    if (input.sourcePlaybookRunId && !playbookVerified(this.phase4.getPlaybookRun(input.sourcePlaybookRunId))) {
      return unavailable('unverified', 'PLAYBOOK_EVIDENCE_UNVERIFIED', 'The referenced playbook run does not have verified completed steps.');
    }
    if (input.sourceResearchRunId && !researchVerified(this.phase4.getResearchRun(input.sourceResearchRunId))) {
      return unavailable('unverified', 'RESEARCH_EVIDENCE_UNVERIFIED', 'The referenced research run does not contain completed cited evidence.');
    }
    const payload: MissionMemoryV2 = {
      ...lineage(context),
      memoryId: stableId('mission-memory', [task.id, input.sourcePlaybookRunId, input.sourceResearchRunId].filter(Boolean).join(':')),
      sourceTaskId: task.id,
      ...(input.sourcePlaybookRunId ? { sourcePlaybookRunId: input.sourcePlaybookRunId } : {}),
      ...(input.sourceResearchRunId ? { sourceResearchRunId: input.sourceResearchRunId } : {}),
      verificationStatus: 'verified',
      routeSummary: safeText(task.verification.summary, 2_000),
      avoidRouteCodes: [...new Set(input.avoidRouteCodes ?? [])].slice(0, 32),
      currentStateReverificationRequired: true,
    };
    const parsed = parseMissionMemoryV2(payload);
    if (parsed.success === false) return unavailable('rejected', parsed.errorCode, parsed.message);
    this.audit('advanced.mission_memory.produced', task.id, `Mission Memory produced from verified task ${task.id}.`);
    return publish('mission-memories', parsed.value, [task.id, input.sourcePlaybookRunId, input.sourceResearchRunId].filter((id): id is string => Boolean(id)));
  }

  recentContext(context: ProducerContext, policy: HistoryRetentionPolicyV2, transfers: SafeTransferHistory[] = []): ProducerResult<RecentContextEventV2[]> {
    const checked = parseHistoryRetentionPolicyV2(policy);
    if (checked.success === false) return unavailable('rejected', checked.errorCode, checked.message);
    if (policy.ownerSessionBindingId !== context.ownerSessionBindingId || policy.workspaceId !== context.workspaceId) {
      return unavailable('rejected', 'HISTORY_POLICY_LINEAGE_MISMATCH', 'History policy does not match the producer context.');
    }
    const now = Date.parse(context.now ?? new Date().toISOString());
    const lowerBound = Math.max(now - policy.retentionDays * 24 * HOUR, policy.purgedBefore ? Date.parse(policy.purgedBefore) : 0);
    const events: RecentContextEventV2[] = [];
    const add = (kind: RecentContextEventV2['kind'], sourceId: string, summary: string, occurredAt: string) => {
      if (!policy.searchableKinds.includes(kind) || Date.parse(occurredAt) < lowerBound || PRIVATE_TEXT.test(summary)) return;
      const candidate: RecentContextEventV2 = {
        ...lineage({ ...context, now: occurredAt }, policy.retentionDays * 24 * HOUR),
        eventId: stableId('context', `${kind}:${sourceId}:${occurredAt}:${summary}`),
        kind,
        sourceId,
        safeSummary: safeText(summary, 2_000),
        occurredAt,
      };
      const parsed = parseRecentContextEventV2(candidate);
      if (parsed.success) events.push(parsed.value);
    };
    for (const task of this.local.listTasks()) {
      for (const event of task.timeline ?? []) add('task', task.id, `${task.title}: ${event.type} ${event.status ?? task.status}.`, event.createdAt);
    }
    for (const event of this.local.readRecentAuditEvents(500)) {
      if (!event.taskId || event.authorization !== 'allowed') continue;
      add('task', event.taskId, `Audit ${event.action}: ${event.result}.`, event.timestamp);
    }
    for (const run of this.phase4.listResearchRuns()) {
      const occurredAt = run.completedAt ?? run.startedAt;
      if (occurredAt) add('research', run.runId, `Research ${run.status}: ${safeText(run.query, 300)}`, occurredAt);
    }
    for (const transfer of transfers.filter((item) => item.verified)) {
      add('download', transfer.transferId, `Transfer status: ${transfer.status}.`, transfer.updatedAt);
    }
    const deduped = [...new Map(events.map((event) => [event.eventId, event])).values()]
      .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt))
      .slice(0, 256);
    return publish('recent-context', deduped, deduped.map((event) => event.sourceId));
  }

  searchHistory(events: RecentContextEventV2[], query: string, policy: HistoryRetentionPolicyV2, now = new Date().toISOString()): RecentContextEventV2[] {
    const parsedPolicy = parseHistoryRetentionPolicyV2(policy);
    if (!parsedPolicy.success || !query.trim()) return [];
    const cutoff = Math.max(Date.parse(now) - policy.retentionDays * 24 * HOUR, policy.purgedBefore ? Date.parse(policy.purgedBefore) : 0);
    const terms = query.toLocaleLowerCase('en-US').split(/\s+/).filter(Boolean);
    return events.filter((event) => {
      const parsed = parseRecentContextEventV2(event);
      if (!parsed.success || event.ownerSessionBindingId !== policy.ownerSessionBindingId || event.workspaceId !== policy.workspaceId
        || !policy.searchableKinds.includes(event.kind) || Date.parse(event.occurredAt) < cutoff) return false;
      const text = `${event.safeSummary} ${event.kind}`.toLocaleLowerCase('en-US');
      return terms.every((term) => text.includes(term));
    }).slice(0, 100);
  }

  compare(context: ProducerContext, sourceType: CompareChangeV2['sourceType'], previous: SafeSnapshot, current: SafeSnapshot): ProducerResult<CompareChangeV2> {
    if (!previous.entries || !current.entries) return unavailable('configuration_required', 'COMPARISON_CONTENT_UNAVAILABLE', 'Both safe snapshots are required to compare changes.');
    const before = new Map(previous.entries.map((entry) => [entry.key, entry.value]));
    const after = new Map(current.entries.map((entry) => [entry.key, entry.value]));
    const added = [...after.keys()].filter((key) => !before.has(key)).map((key) => safeText(key));
    const removed = [...before.keys()].filter((key) => !after.has(key)).map((key) => safeText(key));
    const changed = [...after.keys()].filter((key) => before.has(key) && before.get(key) !== after.get(key)).map((key) => safeText(key));
    const payload: CompareChangeV2 = {
      ...lineage(context),
      comparisonId: stableId('comparison', `${previous.ref}:${current.ref}`),
      sourceType,
      previousRef: previous.ref,
      currentRef: current.ref,
      provenance: { sourceId: current.ref, previousObservedAt: previous.observedAt, currentObservedAt: current.observedAt, verified: previous.verified && current.verified },
      added: added.slice(0, 64), removed: removed.slice(0, 64), changed: changed.slice(0, 64),
    };
    const parsed = parseCompareChangeV2(payload);
    return parsed.success === true ? publish('comparisons', parsed.value, [previous.ref, current.ref]) : unavailable('rejected', parsed.errorCode, parsed.message);
  }

  outcomePlan(context: ProducerContext, input: {
    objective: string;
    taskIds?: string[];
    researchRunIds?: string[];
    playbookRunIds?: string[];
    evidence?: VerifiedReferenceEvidence[];
  }): ProducerResult<OrchestrationPlanV2> {
    const references: OrchestrationPlanV2['references'] = [];
    const steps: OrchestrationPlanV2['steps'] = [];
    const verifiedResults: string[] = [];
    const add = (kind: OrchestrationPlanV2['references'][number]['kind'], id: string, verified: boolean, resultId?: string) => {
      references.push({ kind, id });
      steps.push({ stepId: stableId('step', `${kind}:${id}`), referenceId: id, status: verified ? 'verified' : 'planned' });
      if (verified && resultId) verifiedResults.push(resultId);
    };
    for (const id of input.taskIds ?? []) {
      const task = this.local.listTasks().find((candidate) => candidate.id === id);
      if (!task) return unavailable('not_found', 'OUTCOME_TASK_NOT_FOUND', `Referenced task ${id} was not found.`);
      const verified = task.status === 'COMPLETED' && task.verification?.status === 'PASS';
      add('task', id, verified, verified ? task.verification!.id : undefined);
    }
    for (const id of input.researchRunIds ?? []) {
      const run = this.phase4.getResearchRun(id);
      if (!run) return unavailable('not_found', 'OUTCOME_RESEARCH_NOT_FOUND', `Referenced research run ${id} was not found.`);
      add('research', id, researchVerified(run), researchVerified(run) ? `research-result-${id}` : undefined);
    }
    for (const id of input.playbookRunIds ?? []) {
      const run = this.phase4.getPlaybookRun(id);
      if (!run) return unavailable('not_found', 'OUTCOME_PLAYBOOK_NOT_FOUND', `Referenced playbook run ${id} was not found.`);
      const verified = playbookVerified(run);
      const artifacts = [...new Set((run.stepRuns ?? []).flatMap((step) => step.outputArtifactIds ?? []))];
      if (!artifacts.length) add('artifact', `playbook-run-${id}`, false);
      else for (const artifactId of artifacts) add('artifact', artifactId, verified, verified ? artifactId : undefined);
    }
    for (const evidence of input.evidence ?? []) {
      const verified = this.referenceEvidenceVerified(evidence);
      add(evidence.kind, evidence.id, verified, verified ? evidence.resultId ?? evidence.id : undefined);
    }
    const uniqueReferences = [...new Map(references.map((reference) => [`${reference.kind}:${reference.id}`, reference])).values()];
    const uniqueSteps = [...new Map(steps.map((step) => [step.referenceId, step])).values()];
    const completed = uniqueSteps.length > 0 && uniqueSteps.every((step) => step.status === 'verified') && verifiedResults.length > 0;
    const payload: OrchestrationPlanV2 = {
      ...lineage(context), planId: stableId('outcome', `${input.objective}:${uniqueReferences.map((ref) => ref.id).join(':')}`), kind: 'outcome_mode',
      objective: safeText(input.objective, 2_000), references: uniqueReferences, steps: uniqueSteps, arbitraryShell: false,
      status: completed ? 'completed' : 'planned', verifiedDownstreamResultIds: [...new Set(verifiedResults)],
    };
    const parsed = parseOrchestrationPlanV2(payload);
    return parsed.success === true ? publish('orchestration', parsed.value, uniqueReferences.map((reference) => reference.id)) : unavailable('rejected', parsed.errorCode, parsed.message);
  }

  workspacePlan(context: ProducerContext, input: {
    label: string;
    items: WorkspaceSnapshotV2['items'];
    taskIds?: string[];
    skillIds?: string[];
    explicitSafeTerminalSkillId?: string;
  }): WorkspacePlanResult {
    if (input.items.some((item) => /password|payment|checkout|transaction/i.test(`${item.displayLabel} ${item.refId}`))) {
      return unavailable('rejected', 'WORKSPACE_FORBIDDEN_STATE', 'Password, payment, and transaction state cannot be captured or restored.');
    }
    if ((input.skillIds ?? []).some((id) => !this.knownSkillIds.has(id))) {
      return unavailable('configuration_required', 'WORKSPACE_SKILL_REGISTRY_EVIDENCE_REQUIRED', 'Workspace plans may reference only installed skill registry identities.');
    }
    if (input.explicitSafeTerminalSkillId && (!this.knownSkillIds.has(input.explicitSafeTerminalSkillId) || !this.safeTerminalSkillIds.has(input.explicitSafeTerminalSkillId))) {
      return unavailable('rejected', 'WORKSPACE_TERMINAL_SKILL_NOT_ALLOWLISTED', 'Terminal steps require an explicit installed safe terminal skill.');
    }
    const missingTaskId = (input.taskIds ?? []).find((id) => !this.local.listTasks().some((task) => task.id === id));
    if (missingTaskId) return unavailable('not_found', 'WORKSPACE_TASK_NOT_FOUND', `Referenced task ${missingTaskId} was not found.`);
    const snapshot: WorkspaceSnapshotV2 = {
      ...lineage(context), snapshotId: stableId('snapshot', `${input.label}:${input.items.map((item) => item.refId).join(':')}`), label: safeText(input.label),
      items: input.items, forbiddenStateExcluded: true, dangerousTransactionsExcluded: true, captureStatus: 'metadata_only',
    };
    const checkedSnapshot = parseWorkspaceSnapshotV2(snapshot);
    if (checkedSnapshot.success === false) return unavailable('rejected', checkedSnapshot.errorCode, checkedSnapshot.message);
    const taskRefs = (input.taskIds ?? []).map((id) => ({ kind: 'task' as const, id }));
    const skillIds = [...new Set([...(input.skillIds ?? []), ...(input.explicitSafeTerminalSkillId ? [input.explicitSafeTerminalSkillId] : [])])];
    const refs: OrchestrationPlanV2['references'] = [...taskRefs, ...skillIds.map((id) => ({ kind: 'skill' as const, id }))];
    const plan: OrchestrationPlanV2 = {
      ...lineage(context), planId: stableId('workspace-plan', checkedSnapshot.value.snapshotId), kind: 'one_command_workspace', objective: `Restore workspace metadata: ${safeText(input.label)}`,
      references: refs, steps: refs.map((ref) => ({ stepId: stableId('workspace-step', `${ref.kind}:${ref.id}`), referenceId: ref.id, status: 'configuration_required' })),
      arbitraryShell: false, status: 'configuration_required', verifiedDownstreamResultIds: [],
    };
    const checkedPlan = parseOrchestrationPlanV2(plan);
    if (checkedPlan.success === false) return unavailable('rejected', checkedPlan.errorCode, checkedPlan.message);
    return {
      status: 'ready',
      snapshot: { resource: 'snapshots', payload: checkedSnapshot.value, sourceEvidenceIds: input.items.map((item) => item.refId) },
      plan: { resource: 'orchestration', payload: checkedPlan.value, sourceEvidenceIds: refs.map((ref) => ref.id) },
    };
  }

  smartRetry(context: ProducerContext, taskId: string, failureClass: 'network' | 'page_changed' | 'app_closed' | 'stale_target' | 'permission_denied' | 'other', attempts: number): ProducerResult<import('./contracts').SmartRetryPlanV2> {
    const task = this.local.listTasks().find((candidate) => candidate.id === taskId);
    if (!task) return unavailable('not_found', 'RETRY_TASK_NOT_FOUND', 'The retry task was not found.');
    const stopped = failureClass === 'permission_denied' || attempts >= 2;
    const strategy = failureClass === 'permission_denied' ? 'stop_report' : failureClass === 'stale_target' || failureClass === 'page_changed' ? 'reobserve' : failureClass === 'app_closed' ? 'reopen_if_allowed' : failureClass === 'network' ? 'reconnect_backoff' : 'stop_report';
    const payload: import('./contracts').SmartRetryPlanV2 = {
      ...lineage(context), retryId: stableId('retry', `${taskId}:${failureClass}:${attempts}`), taskId, failureClass, strategy,
      attempts: Math.min(2, Math.max(0, attempts)), maxAttempts: 2, staleTargetReobserve: failureClass === 'stale_target' || failureClass === 'page_changed',
      permissionDeniedStop: failureClass === 'permission_denied', status: stopped ? 'stopped' : 'planned',
    };
    const parsed = parseSmartRetryPlanV2(payload);
    if (parsed.success === false) return unavailable('rejected', parsed.errorCode, parsed.message);
    this.audit('advanced.retry.produced', taskId, `Bounded retry policy produced for task ${taskId}.`);
    return publish('retries', parsed.value, [taskId]);
  }

  playbookUpdateSuggestion(taskId: string, playbookRunId: string): PlaybookUpdateSuggestion | ProducerUnavailable {
    const task = this.local.listTasks().find((candidate) => candidate.id === taskId);
    const run = this.phase4.getPlaybookRun(playbookRunId);
    if (!task || task.verification?.status !== 'PASS' || !playbookVerified(run)) {
      return unavailable('unverified', 'PLAYBOOK_UPDATE_SUCCESS_UNPROVEN', 'Playbook updates require a verified task and verified playbook run.');
    }
    return { suggestionId: stableId('playbook-update', `${taskId}:${playbookRunId}`), playbookRunId, taskId, evidenceIds: [task.verification.id, playbookRunId], action: 'review_update', autoApplied: false };
  }

  watcherIntent(context: ProducerContext, input: { watcherId: string; kind: WatcherV2['kind']; sourceRef: string; trigger: WatcherV2['trigger']; delivery: WatcherV2['delivery']; obsidianWatcherActive: boolean }): ProducerResult<WatcherV2> {
    const localObsidianSource = ['file', 'folder'].includes(input.kind) && input.obsidianWatcherActive;
    const deliverable = input.delivery === 'desktop' && localObsidianSource;
    const payload: WatcherV2 = {
      ...lineage(context, 24 * HOUR), watcherId: input.watcherId, kind: input.kind, sourceRef: input.sourceRef, trigger: input.trigger,
      delivery: input.delivery, observationPolicy: 'event_based', status: deliverable ? 'active' : 'configuration_required',
    };
    const parsed = parseWatcherV2(payload);
    if (parsed.success === false) return unavailable('rejected', parsed.errorCode, parsed.message);
    this.audit('advanced.watcher_intent.produced', undefined, `Watcher intent ${input.watcherId} produced with status ${parsed.value.status}.`);
    return publish('watchers', parsed.value, [input.sourceRef]);
  }

  downloadStatus(context: ProducerContext, observation: DownloadObservation | CrossDeviceTransferV2): ProducerResult<DownloadButlerStatusV2> {
    const transfer = parseCrossDeviceTransferV2(observation);
    const source: DownloadObservation | undefined = transfer.success ? {
      downloadId: transfer.value.transferId, source: 'file_transfer', displayName: transfer.value.fileName,
      bytesTransferred: transfer.value.progress.bytesTransferred, bytesTotal: transfer.value.sizeBytes,
      status: transfer.value.status === 'completed' ? 'completed' : transfer.value.status === 'failed' || transfer.value.status === 'cancelled' ? 'failed' : 'downloading',
      observedAt: transfer.value.updatedAt, verified: transfer.value.progress.integrity === 'verified',
    } : 'verified' in observation && observation.verified ? observation : undefined;
    if (!source) return unavailable('unverified', 'DOWNLOAD_EVIDENCE_UNVERIFIED', 'Download status requires a verified producer record.');
    const remainingBytes = source.bytesTotal - source.bytesTransferred;
    const etaTrustworthy = Boolean(source.verified && source.speedBytesPerSecond && source.speedBytesPerSecond > 0 && (source.telemetryWindowSeconds ?? 0) >= 5 && source.status === 'downloading');
    const payload: DownloadButlerStatusV2 = {
      ...lineage(context), downloadId: source.downloadId, source: source.source, displayName: safeText(source.displayName),
      bytesTransferred: source.bytesTransferred, bytesTotal: source.bytesTotal, remainingBytes, status: source.status, observedAt: source.observedAt,
      ...(source.speedBytesPerSecond !== undefined ? { speedBytesPerSecond: source.speedBytesPerSecond } : {}),
      etaTrustworthy, ...(etaTrustworthy ? { etaSeconds: Math.ceil(remainingBytes / source.speedBytesPerSecond!) } : {}),
    };
    const parsed = parseDownloadButlerStatusV2(payload);
    if (parsed.success === false) return unavailable('rejected', parsed.errorCode, parsed.message);
    const fingerprint = JSON.stringify(parsed.value);
    const prior = this.downloadRevisions.get(payload.downloadId);
    if (prior && payload.revision < prior.revision) return unavailable('rejected', 'DOWNLOAD_REVISION_ROLLBACK', 'Download revision is older than the last observed revision.');
    if (prior && payload.revision === prior.revision && prior.fingerprint !== fingerprint) return unavailable('rejected', 'DOWNLOAD_REVISION_CONFLICT', 'Download identity and revision conflict with prior evidence.');
    this.downloadRevisions.set(payload.downloadId, { revision: payload.revision, fingerprint });
    this.audit('advanced.download_status.produced', undefined, `Verified download status produced for ${source.downloadId}.`);
    return publish('downloads', parsed.value, [source.downloadId]);
  }

  communicationPolicy(context: ProducerContext, input: { autoBrief: boolean; maxSentences?: 1 | 2 | 3; voicePresence: boolean }): ProducerResult<CommunicationPolicyV2> {
    const payload: CommunicationPolicyV2 = {
      ...lineage(context), autoBrief: { enabled: input.autoBrief, maxSentences: input.maxSentences ?? 2 },
      smartSilence: { routine: 'capsule', milestone: 'concise_notification', completion: 'short_brief', actionRequired: 'clear_alert' },
      voicePresence: { enabled: input.voicePresence, response: 'short_acknowledgement' }, voiceSummary: { mode: 'on_demand', actualStateOnly: true }, securityNotificationsImmutable: true,
    };
    const parsed = parseCommunicationPolicyV2(payload);
    return parsed.success === true ? publish('communication', parsed.value, []) : unavailable('rejected', parsed.errorCode, parsed.message);
  }

  actualStateBrief(taskIds: string[], now = new Date().toISOString()): ActualStateBrief | ProducerUnavailable {
    const tasks = taskIds.map((id) => this.local.listTasks().find((task) => task.id === id)).filter((task): task is EdithTask => Boolean(task));
    if (!tasks.length) return unavailable('not_found', 'BRIEF_SOURCE_NOT_FOUND', 'No persisted task state was found for the brief.');
    const summary = tasks.slice(0, 3).map((task) => `${task.title}: ${task.status}${task.verification ? `, verification ${task.verification.status}` : ''}.`).join(' ');
    return { briefId: stableId('brief', `${now}:${taskIds.join(':')}`), summary: safeText(summary, 1_000), voiceSummary: safeText(summary, 500), sourceIds: tasks.map((task) => task.id), actualStateOnly: true, generatedAt: now };
  }

  capsuleCandidates(taskIds: string[], now = new Date().toISOString()): CapsuleContextCandidateV2[] {
    const expiresAt = new Date(Date.parse(now) + HOUR).toISOString();
    return taskIds.flatMap((id) => {
      const task = this.local.listTasks().find((candidate) => candidate.id === id);
      if (!task) return [];
      const kind: CapsuleContextCandidateV2['kind'] = task.status === 'WAITING_FOR_APPROVAL' || task.status === 'FAILED' ? 'attention_required' : task.status === 'COMPLETED' ? 'critical_milestone' : 'progress';
      const candidate: CapsuleContextCandidateV2 = { candidateId: stableId('capsule', `${task.id}:${task.status}:${task.updatedAt ?? task.createdAt}`), kind, sourceId: task.id, safeLabel: safeText(`${task.title}: ${task.status}`), observedAt: task.updatedAt ?? task.createdAt, expiresAt };
      return parseCapsuleContextCandidateV2(candidate).success ? [candidate] : [];
    });
  }

  knowledgeSuggestions(): KnowledgeRecommendation[] {
    const nodes = (this.local.listKnowledgeNodes?.() ?? []).filter((node) => !node.deletedAt);
    const relationships = (this.local.listKnowledgeRelationships?.() ?? []).filter((relationship) => !relationship.deletedAt);
    const connected = new Set(relationships.flatMap((relationship) => [relationship.from, relationship.to]));
    const byTitle = new Map<string, typeof nodes>();
    for (const node of nodes) {
      const key = node.title.normalize('NFKC').toLocaleLowerCase('en-US').trim();
      byTitle.set(key, [...(byTitle.get(key) ?? []), node]);
    }
    return [
      ...[...byTitle.entries()].filter(([, items]) => items.length > 1).slice(0, 10).map(([key, items]) => ({ id: stableId('kg-duplicate', key), type: 'duplicate' as const, title: `Review possible duplicate: ${safeText(items[0].title)}`, rationale: 'Multiple nodes share the same normalized title. No relationship was changed.', nodeIds: items.map((item) => item.id), confidence: 0.78, actionRequired: true as const })),
      ...nodes.filter((node) => node.tags.length > 0 && !connected.has(node.id)).slice(0, 10).map((node) => ({ id: stableId('kg-link', node.id), type: 'missing_relationship' as const, title: `Review isolated node: ${safeText(node.title)}`, rationale: 'Tagged node has no stored relationship. User review is required.', nodeIds: [node.id], confidence: 0.62, actionRequired: true as const })),
    ];
  }

  ghostTask(context: ProducerContext, taskId: string): ProducerResult<GhostTaskV2> {
    const task = this.local.listTasks().find((candidate) => candidate.id === taskId);
    if (!task) return unavailable('not_found', 'GHOST_TASK_NOT_FOUND', 'The backing task was not found.');
    const status: GhostTaskV2['status'] = task.status === 'COMPLETED' && task.verification?.status === 'PASS' ? 'completed' : task.status === 'FAILED' ? 'failed' : task.status === 'CANCELLED' ? 'cancelled' : task.status === 'BLOCKED' || task.status === 'WAITING_FOR_APPROVAL' ? 'paused' : 'configuration_required';
    const payload: GhostTaskV2 = {
      ...lineage(context), ghostTaskId: stableId('ghost', task.id), taskId: task.id, background: true, focusPolicy: 'never_steal', status,
      progressPercent: taskProgress(task), completionNotification: 'meaningful_only', nativeExecution: 'not_connected', reasonCode: status === 'configuration_required' ? 'background_executor_not_connected' : `task_${task.status.toLocaleLowerCase('en-US')}`,
    };
    const parsed = parseGhostTaskV2(payload);
    if (parsed.success === false) return unavailable('rejected', parsed.errorCode, parsed.message);
    this.audit('advanced.ghost_metadata.produced', task.id, `Ghost metadata produced for task ${task.id}; native background execution remains disconnected.`);
    return publish('ghosts', parsed.value, [task.id, ...(task.checkpoints ?? []).map((_, index) => `checkpoint-${index + 1}`)]);
  }

  private referenceEvidenceVerified(evidence: VerifiedReferenceEvidence): boolean {
    if (!evidence.verified) return false;
    if (evidence.source === 'skill_registry') return evidence.kind === 'skill' && this.knownSkillIds.has(evidence.id);
    if (evidence.source === 'obsidian_journal') {
      const node = (this.local.listKnowledgeNodes?.() ?? []).find((candidate) => candidate.id === evidence.id);
      return Boolean(node && typeof node.properties.edith_generated === 'string');
    }
    return evidence.kind !== 'skill';
  }

  private audit(action: string, taskId: string | undefined, message: string): void {
    this.local.appendAuditEvent({ id: stableId('audit', `${action}:${taskId}:${Date.now()}`), actor: 'edith-phase7b-producer', taskId, action, toolId: 'advanced_experience_producers', timestamp: new Date().toISOString(), authorization: 'allowed', riskLevel: 1, result: 'success', message: safeText(message, 500) });
  }
}
