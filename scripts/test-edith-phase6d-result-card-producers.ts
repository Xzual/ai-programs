import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  EDITH_CONTRACT_AMENDMENT,
  TASK_CONTRACT_VERSION,
  adaptLegacyResultCardToSharedV2,
  adaptSharedResultCardToLegacyV2,
  parseSharedResultCardV2,
  type CrossDeviceTransferV2,
  type DesktopObservationV2,
  type ResearchRunV2,
  type ResultCardV2,
} from '../src/edith/contracts';
import type { EdithTask, KnowledgeGraphNode } from '../src/edith/core';
import { MemoryPhase4Persistence } from '../src/edith/phase4Persistence';
import { ResearchService, type ResearchWorker } from '../src/edith/researchService';
import {
  SharedResultCardProducerService,
  SharedResultCardProducerStore,
  type ResultCardLineage,
} from '../src/edith/sharedResultCardProducer';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const baseTime = Date.parse('2026-09-28T12:00:00.000Z');
let tick = 0;
const producer = new SharedResultCardProducerService(
  new SharedResultCardProducerStore(),
  () => new Date(baseTime + tick++ * 1_000),
);
const lineage: ResultCardLineage = {
  ownerSessionBindingId: 'owner-binding-phase6d',
  workspaceId: 'workspace-phase6d',
  sessionId: 'session-phase6d',
  sourceDeviceId: 'desktop-phase6d',
  targetDeviceId: 'mobile-phase6d',
};

const task: EdithTask = {
  id: 'task-phase6d',
  title: 'Producer task',
  objective: 'Produce a truthful shared result card.',
  originalUserRequest: 'Run producer test.',
  priority: 'normal',
  status: 'COMPLETED',
  createdAt: '2026-09-28T11:00:00.000Z',
  updatedAt: '2026-09-28T11:30:00.000Z',
  dependencies: [], subtasks: [], candidateAgents: [], toolsRequired: [], permissionsRequired: [],
  riskLevel: 1, checkpoints: [], artifacts: ['artifact-safe', 'C:\\Users\\owner\\private-artifact.txt'], observations: [], validationRules: [],
  timeline: [], agentActivity: [], result: 'Task completed at C:\\Users\\owner\\private.txt with api_key=secret-value.',
  memoryReferences: [], auditEvents: [],
};
const taskOptions = {
  cardId: 'card-task-phase6d', lineage,
  artifacts: [{
    artifactId: 'artifact-safe', mediaType: 'text/plain', checksumSha256: sha256('task'), checksumStatus: 'verified' as const,
    retention: 'workspace' as const, downloadHandle: 'artifact-handle-phase6d',
  }],
};
const taskCard = producer.fromTask(task, taskOptions);
assert.equal(taskCard.kind, 'task');
assert.equal(taskCard.artifactRefs[0].checksumStatus, 'verified');
assert.equal(taskCard.artifactRefs[0].retention, 'workspace');
assert.equal(taskCard.artifactRefs[0].downloadHandle, 'artifact-handle-phase6d');
assert.match(taskCard.artifactRefs[1].artifactId, /^artifact-[a-f0-9]{24}$/);
assert.equal(taskCard.artifactRefs[1].checksumStatus, 'unavailable');
assert.equal(taskCard.summary.includes('secret-value'), false);
assert.equal(taskCard.summary.includes('C:\\Users'), false);
assert.equal(taskCard.ownerSessionBindingId, lineage.ownerSessionBindingId);
assert.equal(parseSharedResultCardV2(taskCard).success, true);
const taskRevisionTwo = producer.fromTask({ ...task, result: 'Updated safe result.' }, taskOptions);
assert.equal(taskRevisionTwo.revision, 2);
assert.equal(taskRevisionTwo.createdAt, taskCard.createdAt);
assert.equal(Date.parse(taskRevisionTwo.updatedAt) > Date.parse(taskCard.updatedAt), true);

const researchRun: ResearchRunV2 = {
  contractVersion: TASK_CONTRACT_VERSION,
  amendment: EDITH_CONTRACT_AMENDMENT,
  runId: 'research-phase6d', query: 'Verified research?', mode: 'FAST', status: 'completed',
  sourceIds: ['source-phase6d'], artifactIds: ['research-artifact'],
  startedAt: '2026-09-28T10:00:00.000Z', completedAt: '2026-09-28T10:01:00.000Z',
  sources: [{ sourceId: 'source-phase6d', url: 'https://example.com/report', retrievedAt: '2026-09-28T10:00:20.000Z', safety: { schemeValidated: true, redirectsValidated: true, resolvedTargetClass: 'public', retrievedByBackend: true, ssrfPolicyVersion: 'phase6d' } }],
  citations: [{ citationId: 'citation-phase6d', sourceId: 'source-phase6d', locator: 'section-1' }],
  claims: [{ claimId: 'claim-phase6d', statement: 'The cited finding is verified.', citationIds: ['citation-phase6d'], confidence: 0.95 }],
  provenance: { generatedBy: 'phase6d-worker', generatedAt: '2026-09-28T10:01:00.000Z', sourceIds: ['source-phase6d'], methodology: 'source-backed fixture' },
  freshness: { checkedAt: '2026-09-28T10:01:00.000Z', status: 'fresh' }, confidence: 0.95,
};
const originalResearch = JSON.stringify(researchRun);
const researchCard = producer.fromResearchRun(researchRun, {
  cardId: 'card-research-phase6d', lineage,
  artifacts: [{ artifactId: 'research-artifact', mediaType: 'application/json', checksumStatus: 'unavailable', retention: 'workspace' }],
});
assert.equal(researchCard.provenance.sourceType, 'research_run');
assert.equal(researchCard.provenance.sourceId, researchRun.runId);
assert.equal(researchCard.provenance.verified, true);
assert.equal(researchCard.preview.safeText?.includes('citation-phase6d'), true);
assert.equal(researchCard.artifactRefs[0].checksumStatus, 'unavailable');
assert.equal('checksumSha256' in researchCard.artifactRefs[0], false);
assert.equal(JSON.stringify(researchRun), originalResearch, 'Research citations and provenance must remain lossless.');

const worker: ResearchWorker = {
  workerId: 'phase6d-worker', available: true, specializations: ['source_discovery', 'claim_synthesis'],
  async execute() {
    return {
      sources: researchRun.sources!, citations: researchRun.citations!, claims: researchRun.claims!, artifactIds: ['research-artifact'],
    };
  },
};
const resolver = { resolverId: 'phase6d-resolver', async resolve() { return ['93.184.216.34']; } };
const researchResult = await new ResearchService(new MemoryPhase4Persistence(), [worker], resolver).execute(
  { query: 'Producer integration', mode: 'FAST' },
  { producer, options: { cardId: 'card-research-service-phase6d', lineage } },
);
assert.equal(researchResult.outcome, 'completed');
assert.equal(researchResult.resultCard?.provenance.sourceId, researchResult.run.runId);
assert.deepEqual(researchResult.run.citations?.map((citation) => citation.sourceId), ['source-phase6d']);

const transfer: CrossDeviceTransferV2 = {
  contractVersion: TASK_CONTRACT_VERSION, amendment: EDITH_CONTRACT_AMENDMENT, ...lineage,
  transferId: 'download-phase6d', direction: 'pc_to_mobile', category: 'document', fileName: 'report.pdf', mediaType: 'application/pdf',
  sizeBytes: 4, sha256: sha256('file'), status: 'completed',
  progress: { bytesTransferred: 4, totalBytes: 4, percent: 100, integrity: 'verified' },
  destination: { kind: 'mobile_inbox', opaqueHandle: 'download-handle-phase6d', displaySummary: 'Mobile inbox', conflictPolicy: 'collision_safe_rename', collisionDetected: false },
  resume: { contractVersion: TASK_CONTRACT_VERSION, amendment: EDITH_CONTRACT_AMENDMENT, resumable: true, nextChunkIndex: 1, completedChunkIndexes: [0], retryCount: 0, maxRetries: 3, acknowledgedBytes: 4 },
  capabilities: { open: true, export: false, share: true, openLocation: false },
  createdAt: new Date(Date.now() - 2_000).toISOString(), updatedAt: new Date(Date.now() - 1_000).toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(),
};
const downloadCard = producer.fromTransfer(transfer, { cardId: 'card-download-phase6d', lineage, availableActions: { export: true } });
assert.equal(downloadCard.kind, 'download');
assert.equal(downloadCard.expiresAt, transfer.expiresAt);
assert.equal(downloadCard.artifactRefs[0].checksumStatus, 'verified');
assert.equal(downloadCard.artifactRefs[0].downloadHandle, 'download-handle-phase6d');
assert.equal(downloadCard.actions.find((action) => action.action === 'open')?.available, true);
assert.equal(downloadCard.actions.find((action) => action.action === 'export')?.available, false);
assert.equal(downloadCard.actions.find((action) => action.action === 'share')?.available, true);
const fileCard = producer.fromTransfer({
  ...transfer,
  transferId: 'file-phase6d',
  direction: 'mobile_to_pc',
  sourceDeviceId: lineage.targetDeviceId,
  targetDeviceId: lineage.sourceDeviceId,
}, { cardId: 'card-file-phase6d', lineage });
assert.equal(fileCard.kind, 'file');
assert.equal(fileCard.provenance.sourceId, 'file-phase6d');

const observation: DesktopObservationV2 = {
  contractVersion: TASK_CONTRACT_VERSION, amendment: EDITH_CONTRACT_AMENDMENT,
  observationId: 'observation-phase6d', sessionId: 'desktop-session-phase6d', generation: 1,
  capturedAt: '2026-09-28T08:00:00.000Z', expiresAt: '2026-09-28T08:01:00.000Z',
  foreground: {
    hwndFingerprint: 'window-phase6d', processId: 42, processName: 'edith.exe', titlePreview: 'E.D.I.T.H.',
    logicalBounds: { x: 0, y: 0, width: 800, height: 600, coordinateSpace: 'logical' },
    physicalBounds: { x: 0, y: 0, width: 800, height: 600, coordinateSpace: 'physical_virtual_desktop' },
  },
  virtualDesktop: {
    origin: { x: 0, y: 0 },
    logicalBounds: { x: 0, y: 0, width: 1920, height: 1080, coordinateSpace: 'logical' },
    physicalBounds: { x: 0, y: 0, width: 1920, height: 1080, coordinateSpace: 'physical_virtual_desktop' },
  },
  monitor: {
    monitorId: 'monitor-phase6d', origin: { x: 0, y: 0 },
    logicalBounds: { x: 0, y: 0, width: 1920, height: 1080, coordinateSpace: 'logical' },
    physicalBounds: { x: 0, y: 0, width: 1920, height: 1080, coordinateSpace: 'physical_virtual_desktop' }, dpiScale: 1,
  },
  source: 'windows_gdi_virtual_desktop', confidence: 1,
  capabilities: { screenshot: true, uia: false, accessibility: false, ocr: false, multiMonitor: false },
};
const screenshotCard = producer.fromScreenshot(observation, {
  artifactId: 'screenshot-phase6d', mediaType: 'image/png', checksumStatus: 'unavailable', retention: 'temporary',
}, { cardId: 'card-screenshot-phase6d', lineage, expiresAt: observation.expiresAt });
assert.equal(screenshotCard.kind, 'screenshot');
assert.equal(screenshotCard.artifactRefs[0].checksumStatus, 'unavailable');
assert.equal(screenshotCard.actions.find((action) => action.action === 'open')?.available, false);

const knowledge: KnowledgeGraphNode = {
  id: 'note:phase6d', title: 'Knowledge result', type: 'Note', aliases: [], tags: ['phase6d'], source: 'rag',
  importance: 0.8, recentActivityAt: '2026-09-28T07:00:00.000Z', properties: { citations: ['citation-phase6d'] },
};
const knowledgeCard = producer.fromKnowledgeNode(knowledge, { cardId: 'card-knowledge-phase6d', lineage });
assert.equal(knowledgeCard.provenance.sourceType, 'knowledge_graph_node');
assert.equal(knowledgeCard.artifactRefs.length, 0, 'Knowledge paths must not be invented as artifacts.');

const errorCard = producer.fromError({
  errorCode: 'DOWNLOAD_FAILED', safeMessage: 'Failed at C:\\Users\\owner\\secret.txt api_key=top-secret AIzaabcdefghijklmnopqrstuvwxyz1234567890',
  sourceType: 'download_executor', sourceId: 'download-phase6d', observedAt: '2026-09-28T06:00:00.000Z', retryAvailable: true,
}, { cardId: 'card-error-phase6d', lineage });
assert.equal(errorCard.kind, 'error_attention');
assert.equal(errorCard.preview.redacted, true);
assert.equal(errorCard.preview.safeText?.includes('top-secret'), false);
assert.equal(errorCard.preview.safeText?.includes('AIza'), false);
assert.equal(errorCard.preview.safeText?.includes('C:\\Users'), false);
assert.equal(errorCard.actions.find((action) => action.action === 'retry')?.available, true);

const legacy: ResultCardV2 = { title: 'Legacy', summary: 'Legacy summary', outcome: 'success', artifactIds: ['artifact-one'], completedAt: '2026-09-28T05:00:00.000Z' };
const sharedLegacy = adaptLegacyResultCardToSharedV2(legacy, { ...lineage, cardId: 'card-legacy-phase6d', kind: 'task', now: legacy.completedAt! });
assert.deepEqual(adaptSharedResultCardToLegacyV2(sharedLegacy), legacy);
assert.deepEqual(producer.toLegacy(taskCard), {
  title: taskCard.title, summary: taskCard.summary, outcome: taskCard.outcome,
  artifactIds: taskCard.artifactRefs.map((artifact) => artifact.artifactId), completedAt: taskCard.updatedAt,
});

const integrationRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'edith-phase6d-producers-'));
const originalCwd = process.cwd();
try {
  process.chdir(integrationRoot);
  process.env.EDITH_PERSISTENCE = 'sqlite';
  const { TaskService } = await import('../src/edith/taskService');
  const { KnowledgeGraphService } = await import('../src/edith/knowledgeGraphService');
  const { getEdithPersistenceStore } = await import('../src/edith/persistence');
  const taskService = new TaskService();
  const storedTask = taskService.createTask({ title: 'Stored producer task', objective: 'Exercise the task producer integration.', originalUserRequest: 'Produce result.', riskLevel: 1 });
  taskService.updateStatus(storedTask.id, 'COMPLETED', 'Stored result.');
  const storedTaskCard = taskService.createSharedResultCard(storedTask.id, producer, { cardId: 'card-stored-task-phase6d', lineage });
  assert.equal(storedTaskCard?.provenance.sourceId, storedTask.id);
  const knowledgeService = new KnowledgeGraphService();
  const storedNode = knowledgeService.upsertNode({ id: 'note:stored-phase6d', title: 'Stored knowledge', type: 'Note', source: 'rag' });
  const storedKnowledgeCard = knowledgeService.createSharedResultCard(storedNode.id, producer, { cardId: 'card-stored-knowledge-phase6d', lineage });
  assert.equal(storedKnowledgeCard?.provenance.sourceId, storedNode.id);
  getEdithPersistenceStore().close?.();
} finally {
  process.chdir(originalCwd);
  fs.rmSync(integrationRoot, { recursive: true, force: true });
}

for (const card of [taskCard, taskRevisionTwo, researchCard, researchResult.resultCard!, downloadCard, fileCard, screenshotCard, knowledgeCard, errorCard]) {
  assert.equal(parseSharedResultCardV2(card).success, true, card.cardId);
  assert.equal(card.workspaceId, lineage.workspaceId);
  assert.equal(card.ownerSessionBindingId, lineage.ownerSessionBindingId);
  assert.equal(JSON.stringify(card).includes('C:\\\\Users'), false);
  assert.equal(JSON.stringify(card).includes('top-secret'), false);
}

console.log(JSON.stringify({ success: true, checks: [
  'real_task_research_knowledge_transfer_screenshot_error_producers',
  'task_and_knowledge_service_integration',
  'verified_and_unavailable_checksum_truth',
  'research_citations_and_provenance_preserved',
  'preview_secret_and_private_path_redaction',
  'monotonic_revision_and_stable_creation_time',
  'owner_workspace_device_lineage',
  'retention_expiry_and_opaque_download_handle',
  'truthful_action_availability',
  'lossless_legacy_phase3_adapter',
  'owner_publish_route_payload_contract_ready',
] }, null, 2));
