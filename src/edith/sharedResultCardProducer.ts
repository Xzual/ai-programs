import { createHash } from 'node:crypto';
import {
  EDITH_CONTRACT_AMENDMENT,
  TASK_CONTRACT_VERSION,
  adaptSharedResultCardToLegacyV2,
  parseCrossDeviceTransferV2,
  parseSharedResultCardV2,
  type CrossDeviceLineageV2,
  type CrossDeviceTransferV2,
  type DesktopObservationV2,
  type ResultCardV2,
  type ResearchRunV2,
  type SharedArtifactRefV2,
  type SharedResultCardKindV2,
  type SharedResultCardV2,
} from './contracts';
import type { EdithTask, KnowledgeGraphNode } from './core';
import { redactSensitiveString } from './securityRedaction';

export type SharedResultAction = SharedResultCardV2['actions'][number]['action'];
export type ResultCardLineage = Omit<CrossDeviceLineageV2, 'contractVersion' | 'amendment'>;

export interface ArtifactEvidenceV2 {
  artifactId: string;
  mediaType: string;
  checksumSha256?: string;
  checksumStatus?: SharedArtifactRefV2['checksumStatus'];
  provenance?: SharedArtifactRefV2['provenance'];
  retention?: SharedArtifactRefV2['retention'];
  downloadHandle?: string;
}

export interface ResultCardProductionOptions {
  cardId: string;
  lineage: ResultCardLineage;
  observedAt?: string;
  expiresAt?: string;
  artifacts?: ArtifactEvidenceV2[];
  availableActions?: Partial<Record<SharedResultAction, boolean>>;
}

export interface ErrorAttentionEvidenceV2 {
  errorCode: string;
  safeMessage: string;
  sourceType: string;
  sourceId: string;
  observedAt: string;
  retryAvailable: boolean;
}

const ACTIONS: SharedResultAction[] = ['open', 'export', 'share', 'open_location', 'retry', 'dismiss'];
const PRIVATE_PATH = /(?:[A-Za-z]:[\\/]|\\\\|\/(?:Users|home|tmp|var)\/)[^\s`"']+/gi;
const PATH_LIKE_ID = /(?:^[A-Za-z]:[\\/]|^\\\\|^\/(?:Users|home|tmp|var)\/)/i;
const OPAQUE_HANDLE = /^[A-Za-z0-9._-]{1,256}$/;
const SHA256 = /^[a-f0-9]{64}$/i;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function fingerprint(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function redactPortableSecrets(value: string): string {
  const withoutAssignments = value.replace(
    /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|authorization|cookie|credential|client[_-]?secret|private[_-]?key|webhook[_-]?url)\b\s*[:=]\s*([^\s,;]+)/gi,
    '[REDACTED_SECRET]',
  );
  return redactSensitiveString(withoutAssignments)
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gi, '[REDACTED_PRIVATE_KEY]')
    .replace(/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, '[REDACTED_TOKEN]')
    .replace(/\bAIza[0-9A-Za-z_-]{30,}\b/g, '[REDACTED_API_KEY]')
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[REDACTED_TOKEN]');
}

function safeDisplayText(value: unknown, fallback: string, maximum = 10_000): string {
  const redacted = redactPortableSecrets(String(value ?? ''))
    .replace(PRIVATE_PATH, '[REDACTED_LOCAL_PATH]')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, maximum);
  return redacted || fallback;
}

function safeIdentifier(value: string, prefix: string): string {
  if (PATH_LIKE_ID.test(value) || redactPortableSecrets(value) !== value) return `${prefix}-${fingerprint(value).slice(0, 24)}`;
  const normalized = value.normalize('NFKC').trim().slice(0, 256);
  return normalized || `${prefix}-${fingerprint(value).slice(0, 24)}`;
}

function canonicalArtifact(
  input: ArtifactEvidenceV2,
  fallback: SharedArtifactRefV2['provenance'],
  ownerSessionBindingId: string,
): SharedArtifactRefV2 {
  const checksumPresent = typeof input.checksumSha256 === 'string' && SHA256.test(input.checksumSha256);
  const checksumStatus = input.checksumStatus === 'verified' && checksumPresent
    ? 'verified'
    : input.checksumStatus === 'failed' && checksumPresent
      ? 'failed'
      : 'unavailable';
  const provenance = input.provenance ?? fallback;
  const downloadHandle = input.downloadHandle && OPAQUE_HANDLE.test(input.downloadHandle)
    ? input.downloadHandle
    : undefined;
  return {
    artifactId: safeIdentifier(input.artifactId, 'artifact'),
    mediaType: safeDisplayText(input.mediaType, 'application/octet-stream', 256),
    ...(checksumPresent ? { checksumSha256: input.checksumSha256!.toLowerCase() } : {}),
    checksumStatus,
    provenance: {
      sourceType: safeIdentifier(provenance.sourceType, 'source'),
      sourceId: safeIdentifier(provenance.sourceId, 'source'),
      observedAt: provenance.observedAt,
      verified: provenance.verified,
    },
    retention: input.retention ?? 'session',
    ownerSessionBindingId,
    ...(downloadHandle ? { downloadHandle } : {}),
  };
}

function legacyArtifacts(
  artifactIds: string[],
  explicit: ArtifactEvidenceV2[] | undefined,
  fallback: SharedArtifactRefV2['provenance'],
  ownerSessionBindingId: string,
): SharedArtifactRefV2[] {
  const evidence = new Map((explicit ?? []).map((item) => [item.artifactId, item]));
  return [...new Set(artifactIds)].map((artifactId) => canonicalArtifact(
    evidence.get(artifactId) ?? { artifactId, mediaType: 'application/octet-stream', checksumStatus: 'unavailable' },
    fallback,
    ownerSessionBindingId,
  ));
}

function taskOutcome(task: EdithTask): ResultCardV2['outcome'] {
  if (task.status === 'COMPLETED') return 'success';
  if (task.status === 'FAILED') return 'failure';
  if (task.status === 'CANCELLED') return 'cancelled';
  return 'partial';
}

function researchOutcome(run: ResearchRunV2): ResultCardV2['outcome'] {
  if (run.status === 'completed') return 'success';
  if (run.status === 'failed') return 'failure';
  if (run.status === 'cancelled') return 'cancelled';
  return 'partial';
}

export class SharedResultCardProducerStore {
  private readonly cards = new Map<string, SharedResultCardV2>();

  get(cardId: string): SharedResultCardV2 | undefined {
    const value = this.cards.get(cardId);
    return value ? clone(value) : undefined;
  }

  list(): SharedResultCardV2[] {
    return [...this.cards.values()].map(clone);
  }

  nextRevision(cardId: string): number {
    return (this.cards.get(cardId)?.revision ?? 0) + 1;
  }

  put(card: SharedResultCardV2): SharedResultCardV2 {
    const parsed = parseSharedResultCardV2(card);
    if (parsed.success === false) throw new Error(`${parsed.errorCode}: ${parsed.message}`);
    const prior = this.cards.get(card.cardId);
    const expected = (prior?.revision ?? 0) + 1;
    if (card.revision !== expected) throw new Error('RESULT_CARD_PRODUCER_REVISION_CONFLICT');
    if (prior && card.createdAt !== prior.createdAt) throw new Error('RESULT_CARD_PRODUCER_CREATED_AT_CONFLICT');
    if (prior && Date.parse(card.updatedAt) <= Date.parse(prior.updatedAt)) throw new Error('RESULT_CARD_PRODUCER_TIMESTAMP_CONFLICT');
    this.cards.set(card.cardId, clone(parsed.value));
    return clone(parsed.value);
  }
}

export class SharedResultCardProducerService {
  constructor(
    private readonly store = new SharedResultCardProducerStore(),
    private readonly clock: () => Date = () => new Date(),
  ) {}

  fromResearchRun(run: ResearchRunV2, options: ResultCardProductionOptions): SharedResultCardV2 {
    const observedAt = options.observedAt ?? run.completedAt ?? run.startedAt ?? this.clock().toISOString();
    const citationIds = new Set((run.citations ?? []).map((citation) => citation.citationId));
    const verified = run.status === 'completed'
      && Boolean(run.provenance)
      && (run.claims ?? []).every((claim) => claim.citationIds.length > 0 && claim.citationIds.every((id) => citationIds.has(id)));
    const provenance = { sourceType: 'research_run', sourceId: run.runId, observedAt, verified };
    const findings = (run.claims ?? []).map((claim) => `${claim.statement} [${claim.citationIds.join(', ') || 'uncited'}]`);
    const summary = findings.length ? findings.join(' ') : run.uncertainty ?? 'No verified research claims were produced.';
    return this.create({
      kind: 'research',
      title: `Research: ${run.query}`,
      summary,
      outcome: researchOutcome(run),
      provenance,
      artifactRefs: legacyArtifacts(run.artifactIds, options.artifacts, provenance, options.lineage.ownerSessionBindingId),
      options,
      defaultActions: { open: true, retry: run.status === 'failed', dismiss: true },
    });
  }

  fromKnowledgeNode(node: KnowledgeGraphNode, options: ResultCardProductionOptions): SharedResultCardV2 {
    const observedAt = options.observedAt ?? node.recentActivityAt;
    const provenance = { sourceType: 'knowledge_graph_node', sourceId: node.id, observedAt, verified: !node.deletedAt };
    return this.create({
      kind: 'file',
      title: node.title,
      summary: `${node.type} from ${node.source}${node.tags.length ? `; tags: ${node.tags.join(', ')}` : ''}`,
      outcome: node.deletedAt ? 'failure' : 'success',
      provenance,
      artifactRefs: (options.artifacts ?? []).map((artifact) => canonicalArtifact(artifact, provenance, options.lineage.ownerSessionBindingId)),
      options,
      defaultActions: { open: true, dismiss: true },
    });
  }

  fromTask(task: EdithTask, options: ResultCardProductionOptions): SharedResultCardV2 {
    const observedAt = options.observedAt ?? task.updatedAt ?? task.createdAt;
    const provenance = {
      sourceType: 'edith_task',
      sourceId: task.id,
      observedAt,
      verified: task.verification?.status === 'PASS',
    };
    return this.create({
      kind: 'task',
      title: task.title,
      summary: task.result ?? task.failureReason ?? task.objective,
      outcome: taskOutcome(task),
      provenance,
      artifactRefs: legacyArtifacts(task.artifacts, options.artifacts, provenance, options.lineage.ownerSessionBindingId),
      options,
      defaultActions: { open: true, retry: task.status === 'FAILED', dismiss: true },
    });
  }

  fromTransfer(transfer: CrossDeviceTransferV2, options: ResultCardProductionOptions): SharedResultCardV2 {
    const parsed = parseCrossDeviceTransferV2(transfer);
    if (parsed.success === false) throw new Error(`${parsed.errorCode}: ${parsed.message}`);
    const sameDevices = new Set([transfer.sourceDeviceId, transfer.targetDeviceId]);
    if (transfer.ownerSessionBindingId !== options.lineage.ownerSessionBindingId
      || transfer.workspaceId !== options.lineage.workspaceId
      || transfer.sessionId !== options.lineage.sessionId
      || !sameDevices.has(options.lineage.sourceDeviceId)
      || !sameDevices.has(options.lineage.targetDeviceId)) {
      throw new Error('RESULT_CARD_PRODUCER_LINEAGE_MISMATCH');
    }
    const observedAt = options.observedAt ?? transfer.updatedAt;
    const verified = transfer.status === 'completed' && transfer.progress.integrity === 'verified';
    const provenance = { sourceType: 'cross_device_transfer', sourceId: transfer.transferId, observedAt, verified };
    const artifact = canonicalArtifact({
      artifactId: `artifact-${transfer.transferId}`,
      mediaType: transfer.mediaType,
      checksumSha256: transfer.sha256,
      checksumStatus: transfer.progress.integrity === 'verified' ? 'verified' : transfer.progress.integrity === 'failed' ? 'failed' : 'unavailable',
      provenance,
      retention: 'temporary',
      downloadHandle: transfer.destination.opaqueHandle,
    }, provenance, options.lineage.ownerSessionBindingId);
    return this.create({
      kind: transfer.direction === 'pc_to_mobile' ? 'download' : 'file',
      title: transfer.fileName,
      summary: transfer.status === 'completed' ? 'Transfer completed.' : `Transfer status: ${transfer.status}.`,
      outcome: transfer.status === 'completed' ? 'success' : transfer.status === 'failed' ? 'failure' : transfer.status === 'cancelled' ? 'cancelled' : 'partial',
      provenance,
      artifactRefs: [artifact],
      options: { ...options, expiresAt: options.expiresAt ?? transfer.expiresAt },
      defaultActions: {
        open: transfer.capabilities.open,
        export: transfer.capabilities.export,
        share: transfer.capabilities.share,
        open_location: transfer.capabilities.openLocation,
        retry: transfer.status === 'failed',
        dismiss: true,
      },
    });
  }

  fromScreenshot(observation: DesktopObservationV2, artifact: ArtifactEvidenceV2, options: ResultCardProductionOptions): SharedResultCardV2 {
    const provenance = {
      sourceType: 'desktop_observation',
      sourceId: observation.observationId,
      observedAt: observation.capturedAt,
      verified: artifact.provenance?.verified ?? false,
    };
    const artifactRef = canonicalArtifact(artifact, provenance, options.lineage.ownerSessionBindingId);
    return this.create({
      kind: 'screenshot',
      title: `Screenshot: ${observation.foreground.titlePreview ?? observation.foreground.processName ?? 'Desktop'}`,
      summary: `Captured from ${observation.source}; generation ${observation.generation}.`,
      outcome: 'success',
      provenance,
      artifactRefs: [artifactRef],
      options,
      defaultActions: { open: Boolean(artifactRef.downloadHandle), export: Boolean(artifactRef.downloadHandle), share: Boolean(artifactRef.downloadHandle), dismiss: true },
    });
  }

  fromError(evidence: ErrorAttentionEvidenceV2, options: ResultCardProductionOptions): SharedResultCardV2 {
    const provenance = { sourceType: evidence.sourceType, sourceId: evidence.sourceId, observedAt: evidence.observedAt, verified: true };
    return this.create({
      kind: 'error_attention',
      title: `Attention required: ${evidence.errorCode}`,
      summary: evidence.safeMessage,
      outcome: 'failure',
      provenance,
      artifactRefs: [],
      options,
      defaultActions: { retry: evidence.retryAvailable, dismiss: true },
    });
  }

  toLegacy(card: SharedResultCardV2): ResultCardV2 {
    return adaptSharedResultCardToLegacyV2(card);
  }

  private create(input: {
    kind: SharedResultCardKindV2;
    title: string;
    summary: string;
    outcome: ResultCardV2['outcome'];
    provenance: SharedResultCardV2['provenance'];
    artifactRefs: SharedArtifactRefV2[];
    options: ResultCardProductionOptions;
    defaultActions: Partial<Record<SharedResultAction, boolean>>;
  }): SharedResultCardV2 {
    const cardId = safeIdentifier(input.options.cardId, 'card');
    const prior = this.store.get(cardId);
    const clockNow = this.clock().getTime();
    const updatedAtMs = prior ? Math.max(clockNow, Date.parse(prior.updatedAt) + 1) : clockNow;
    const now = new Date(updatedAtMs).toISOString();
    const actions = ACTIONS.map((action) => ({
      action,
      available: Boolean(input.defaultActions[action]) && input.options.availableActions?.[action] !== false,
      requiresApproval: action === 'export' || action === 'share' || action === 'open_location' || action === 'retry',
    }));
    const card: SharedResultCardV2 = {
      contractVersion: TASK_CONTRACT_VERSION,
      amendment: EDITH_CONTRACT_AMENDMENT,
      ...input.options.lineage,
      cardId,
      kind: input.kind,
      title: safeDisplayText(input.title, 'Result'),
      summary: safeDisplayText(input.summary, 'No safe result summary is available.'),
      outcome: input.outcome,
      provenance: {
        sourceType: safeIdentifier(input.provenance.sourceType, 'source'),
        sourceId: safeIdentifier(input.provenance.sourceId, 'source'),
        observedAt: input.provenance.observedAt,
        verified: input.provenance.verified,
      },
      preview: { safeText: safeDisplayText(input.summary, 'No safe preview is available.'), redacted: true },
      artifactRefs: input.artifactRefs,
      actions,
      revision: this.store.nextRevision(cardId),
      createdAt: prior?.createdAt ?? now,
      updatedAt: now,
      ...(input.options.expiresAt ? { expiresAt: input.options.expiresAt } : {}),
    };
    return this.store.put(card);
  }
}
