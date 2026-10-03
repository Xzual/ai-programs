import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AdvancedExperienceProducerService } from '../src/edith/advancedExperienceProducers';
import { EDITH_CONTRACT_AMENDMENT, TASK_CONTRACT_VERSION, type HistoryRetentionPolicyV2, type PlaybookDefinitionV2, type PlaybookRunV2, type ResearchRunV2 } from '../src/edith/contracts';
import { createTask, type EdithTask } from '../src/edith/core';
import { JsonPhase4Persistence } from '../src/edith/phase4Persistence';
import { JsonEdithPersistenceStore } from '../src/edith/persistence/jsonStore';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edith-phase7b-'));
const local = new JsonEdithPersistenceStore(path.join(root, 'local'));
local.initialize();
const phase4 = new JsonPhase4Persistence(path.join(root, 'phase4'));
phase4.initialize();
const service = new AdvancedExperienceProducerService(local, phase4);
const now = new Date().toISOString();
const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1_000).toISOString();
const context = { ownerSessionBindingId: 'owner-phase7b', workspaceId: 'workspace-phase7b', now };
const v21 = { contractVersion: TASK_CONTRACT_VERSION, amendment: EDITH_CONTRACT_AMENDMENT } as const;

function task(title: string, verified: boolean): EdithTask {
  const created = createTask({ title, objective: `${title} objective`, originalUserRequest: title });
  created.id = `task-${title.toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/g, '-')}`;
  created.createdAt = now;
  if (verified) {
    created.status = 'COMPLETED';
    created.updatedAt = now;
    created.result = `${title} completed.`;
    created.verification = {
      id: `verification-${created.id}`, taskId: created.id, verifier: 'heuristic-v1', status: 'PASS', checkedAt: now,
      summary: `${title} outcome verified.`, retryable: false,
      checks: [{ id: `check-${created.id}`, label: 'Outcome', status: 'PASS', evidence: 'Persisted fixture evidence.', required: true }],
    };
    created.timeline.push({ id: `timeline-${created.id}`, taskId: created.id, type: 'verification', actor: 'fixture', message: 'Verification persisted.', createdAt: now, status: 'COMPLETED' });
    created.checkpoints.push('Verified checkpoint');
  }
  return local.createTask(created);
}

const verifiedTask = task('Verified', true);
const pendingTask = task('Pending', false);
local.appendAuditEvent({ id: 'audit-safe', actor: 'fixture', taskId: verifiedTask.id, action: 'task.verify', toolId: 'fixture', timestamp: now, authorization: 'allowed', riskLevel: 1, result: 'success', message: 'Verified task.' });
local.appendAuditEvent({ id: 'audit-private', actor: 'fixture', taskId: verifiedTask.id, action: 'credential.read', toolId: 'fixture', timestamp: now, authorization: 'allowed', riskLevel: 1, result: 'success', message: 'password=do-not-index' });
local.upsertKnowledgeNode?.({ id: 'obsidian-unverified', title: 'User-authored claim', type: 'Note', aliases: [], tags: ['claim'], source: 'obsidian', importance: 0.5, recentActivityAt: now, properties: { verified: false } });
local.upsertKnowledgeNode?.({ id: 'obsidian-journal-result', title: 'Generated research journal', type: 'Note', aliases: [], tags: ['research'], source: 'obsidian', importance: 0.7, recentActivityAt: now, properties: { edith_generated: 'research_journal' } });
local.upsertKnowledgeNode?.({ id: 'duplicate-a', title: 'Same Topic', type: 'Note', aliases: [], tags: ['topic'], source: 'edith', importance: 0.5, recentActivityAt: now, properties: {} });
local.upsertKnowledgeNode?.({ id: 'duplicate-b', title: 'Same Topic', type: 'Note', aliases: [], tags: ['topic'], source: 'obsidian', importance: 0.5, recentActivityAt: now, properties: {} });

const research: ResearchRunV2 = {
  ...v21, runId: 'research-verified', query: 'Verified research', status: 'completed', sourceIds: ['source-1'], artifactIds: ['artifact-research'], startedAt: now, completedAt: now,
  sources: [{ sourceId: 'source-1', url: 'https://example.com/report', retrievedAt: now, safety: { schemeValidated: true, redirectsValidated: true, resolvedTargetClass: 'public', retrievedByBackend: true, ssrfPolicyVersion: 'test', decision: 'allowed' } }],
  citations: [{ citationId: 'citation-1', sourceId: 'source-1' }], claims: [{ claimId: 'claim-1', statement: 'Verified claim.', citationIds: ['citation-1'], confidence: 0.9, status: 'supported' }],
  provenance: { generatedBy: 'fixture', generatedAt: now, sourceIds: ['source-1'], methodology: 'persisted fixture' }, freshness: { checkedAt: now, status: 'fresh' }, confidence: 0.9,
};
phase4.saveResearchRun(research);

const definition: PlaybookDefinitionV2 = {
  ...v21, playbookId: 'playbook-verified', version: '1.0.0', title: 'Verified Playbook', skills: [], stepIds: ['step-1'],
  steps: [{ ...v21, stepId: 'step-1', title: 'Produce', dependsOn: [], inputSchema: {}, outputSchema: {}, skills: [], tools: [], permissions: [], riskLevel: 1, approval: 'none', timeoutMs: 1_000, retry: { maxAttempts: 1, backoffMs: 0, retryableErrorCodes: [] }, verification: { required: true, criteria: ['PASS'] }, undo: { supported: false } }],
};
phase4.savePlaybookDefinition(definition);
const playbook: PlaybookRunV2 = {
  ...v21, runId: 'playbook-run-verified', playbook: { playbookId: definition.playbookId, version: definition.version }, taskId: verifiedTask.id, status: 'completed', startedAt: now, completedAt: now,
  stepRuns: [{ stepId: 'step-1', status: 'completed', attempt: 1, startedAt: now, completedAt: now, outputArtifactIds: ['artifact-playbook'], verificationStatus: 'PASS', undoStatus: 'not_required' }],
};
phase4.savePlaybookRun(playbook);
const configuredService = new AdvancedExperienceProducerService(local, phase4, { knownSkillIds: ['safe-terminal-status'], safeTerminalSkillIds: ['safe-terminal-status'] });

const checks: string[] = [];
try {
  const rejectedMemory = service.missionMemory(context, { sourceTaskId: pendingTask.id });
  assert.equal(rejectedMemory.status, 'unverified');
  const mission = service.missionMemory(context, { sourceTaskId: verifiedTask.id, sourcePlaybookRunId: playbook.runId, sourceResearchRunId: research.runId });
  assert.equal(mission.status, 'ready');
  if (mission.status === 'ready') assert.equal(mission.publish.payload.verificationStatus, 'verified');
  assert.equal(service.missionMemory(context, { sourceTaskId: 'obsidian-unverified' }).status, 'not_found');
  checks.push('mission_memory_requires_persisted_verified_evidence');

  const policy: HistoryRetentionPolicyV2 = { ...v21, ownerSessionBindingId: context.ownerSessionBindingId, workspaceId: context.workspaceId, revision: 1, createdAt: now, updatedAt: now, policyId: 'history-policy', retentionDays: 30, includePrivate: false, purgedBefore: new Date(Date.now() - 7 * 24 * 60 * 60 * 1_000).toISOString(), searchableKinds: ['task', 'research', 'download'] };
  phase4.saveResearchRun({ ...research, runId: 'research-old', startedAt: old, completedAt: old });
  const recent = service.recentContext(context, policy, [
    { transferId: 'transfer-verified', status: 'completed', updatedAt: now, verified: true },
    { transferId: 'transfer-unverified', status: 'completed', updatedAt: now, verified: false },
  ]);
  assert.equal(recent.status, 'ready');
  if (recent.status === 'ready') {
    assert.equal(recent.publish.payload.some((event) => event.sourceId === 'transfer-verified'), true);
    assert.equal(recent.publish.payload.some((event) => event.sourceId === 'transfer-unverified'), false);
    assert.equal(recent.publish.payload.some((event) => event.safeSummary.includes('do-not-index')), false);
    assert.equal(recent.publish.payload.some((event) => event.sourceId === 'research-old'), false);
    assert.equal(service.searchHistory(recent.publish.payload, 'Research completed', policy, now).length >= 1, true);
    assert.equal(service.searchHistory(recent.publish.payload.map((event) => ({ ...event, workspaceId: 'other-workspace' })), 'Research completed', policy, now).length, 0);
  }
  checks.push('recent_context_retention_private_purge_and_search');

  assert.equal(service.compare(context, 'research', { ref: 'prior', observedAt: old, verified: true }, { ref: 'current', observedAt: now, verified: true }).status, 'configuration_required');
  const comparison = service.compare(context, 'research', { ref: 'prior', observedAt: old, verified: true, entries: [{ key: 'old', value: '1' }, { key: 'same', value: '1' }] }, { ref: 'current', observedAt: now, verified: true, entries: [{ key: 'new', value: '1' }, { key: 'same', value: '2' }] });
  assert.equal(comparison.status, 'ready');
  if (comparison.status === 'ready') assert.deepEqual(comparison.publish.payload.changed, ['same']);
  checks.push('compare_safe_snapshots_or_honest_unavailable');

  const outcome = configuredService.outcomePlan(context, { objective: 'Deliver verified outcome', taskIds: [verifiedTask.id], researchRunIds: [research.runId], playbookRunIds: [playbook.runId], evidence: [{ kind: 'artifact', id: 'file-generation-result', verified: true, source: 'file_generation' }, { kind: 'artifact', id: 'obsidian-journal-result', verified: true, source: 'obsidian_journal' }, { kind: 'transfer', id: 'transfer-verified', verified: true, source: 'cross_device_transfer' }] });
  assert.equal(outcome.status, 'ready');
  if (outcome.status === 'ready') {
    assert.equal(outcome.publish.payload.status, 'completed');
    assert.equal(outcome.publish.payload.arbitraryShell, false);
    assert.equal(outcome.publish.payload.verifiedDownstreamResultIds.length > 0, true);
  }
  const pendingOutcome = service.outcomePlan(context, { objective: 'Pending outcome', taskIds: [pendingTask.id] });
  assert.equal(pendingOutcome.status, 'ready');
  if (pendingOutcome.status === 'ready') assert.equal(pendingOutcome.publish.payload.status, 'planned');
  checks.push('outcome_uses_existing_ids_and_verified_completion');

  assert.equal(service.workspacePlan(context, { label: 'Checkout session', items: [{ kind: 'tab', refId: 'checkout', displayLabel: 'Payment transaction' }] }).status, 'rejected');
  assert.equal(service.workspacePlan(context, { label: 'Unknown skill', items: [], skillIds: ['not-installed'] }).status, 'configuration_required');
  assert.equal(configuredService.workspacePlan(context, { label: 'Missing task', items: [], taskIds: ['missing-task'] }).status, 'not_found');
  const workspace = configuredService.workspacePlan(context, { label: 'Research workspace', items: [{ kind: 'project', refId: 'project-edith', displayLabel: 'E.D.I.T.H.' }], taskIds: [verifiedTask.id], explicitSafeTerminalSkillId: 'safe-terminal-status' });
  assert.equal(workspace.status, 'ready');
  if (workspace.status === 'ready') {
    assert.equal(workspace.plan.payload.status, 'configuration_required');
    assert.equal(workspace.plan.payload.arbitraryShell, false);
  }
  checks.push('workspace_metadata_only_forbidden_state_and_no_shell');

  const staleRetry = service.smartRetry(context, pendingTask.id, 'stale_target', 1);
  assert.equal(staleRetry.status, 'ready');
  if (staleRetry.status === 'ready') assert.equal(staleRetry.publish.payload.strategy, 'reobserve');
  const deniedRetry = service.smartRetry(context, pendingTask.id, 'permission_denied', 0);
  assert.equal(deniedRetry.status, 'ready');
  if (deniedRetry.status === 'ready') assert.equal(deniedRetry.publish.payload.status, 'stopped');
  assert.equal('autoApplied' in service.playbookUpdateSuggestion(verifiedTask.id, playbook.runId), true);
  const rejectedUpdate = service.playbookUpdateSuggestion(pendingTask.id, playbook.runId);
  assert.equal('status' in rejectedUpdate ? rejectedUpdate.status : '', 'unverified');
  checks.push('bounded_retry_permission_stop_and_reviewed_playbook_update');

  const localWatcher = service.watcherIntent(context, { watcherId: 'watch-local', kind: 'file', sourceRef: 'obsidian-note', trigger: 'changed', delivery: 'desktop', obsidianWatcherActive: true });
  const mobileWatcher = service.watcherIntent(context, { watcherId: 'watch-mobile', kind: 'file', sourceRef: 'obsidian-note', trigger: 'changed', delivery: 'mobile', obsidianWatcherActive: true });
  assert.equal(localWatcher.status === 'ready' && localWatcher.publish.payload.status, 'active');
  assert.equal(mobileWatcher.status === 'ready' && mobileWatcher.publish.payload.status, 'configuration_required');
  checks.push('watcher_reuses_obsidian_and_never_fakes_push');

  assert.equal(service.downloadStatus(context, { downloadId: 'browser-download', source: 'browser', displayName: 'Report.pdf', bytesTransferred: 50, bytesTotal: 100, status: 'downloading', observedAt: now, verified: false }).status, 'unverified');
  const download = service.downloadStatus(context, { downloadId: 'browser-download', source: 'browser', displayName: 'Report.pdf', bytesTransferred: 50, bytesTotal: 100, status: 'downloading', observedAt: now, verified: true, speedBytesPerSecond: 10, telemetryWindowSeconds: 5 });
  assert.equal(download.status, 'ready');
  if (download.status === 'ready') assert.equal(download.publish.payload.etaSeconds, 5);
  assert.equal(service.downloadStatus({ ...context, revision: 1 }, { downloadId: 'browser-download', source: 'browser', displayName: 'Changed.pdf', bytesTransferred: 60, bytesTotal: 100, status: 'downloading', observedAt: now, verified: true }).status, 'rejected');
  checks.push('verified_download_eta_and_revision_conflict');

  assert.equal(service.communicationPolicy(context, { autoBrief: true, voicePresence: true }).status, 'ready');
  const brief = service.actualStateBrief([verifiedTask.id, pendingTask.id], now);
  assert.equal('actualStateOnly' in brief && brief.actualStateOnly, true);
  assert.equal(service.capsuleCandidates([verifiedTask.id, pendingTask.id], now).length, 2);
  checks.push('brief_voice_silence_and_capsule_use_actual_state');

  const relationshipCount = local.listKnowledgeRelationships?.().length ?? 0;
  const suggestions = service.knowledgeSuggestions();
  assert.equal(suggestions.every((suggestion) => suggestion.actionRequired), true);
  assert.equal(suggestions.some((suggestion) => suggestion.type === 'duplicate'), true);
  assert.equal(local.listKnowledgeRelationships?.().length ?? 0, relationshipCount);
  checks.push('kg_suggestions_review_only');

  const ghostPending = service.ghostTask(context, pendingTask.id);
  assert.equal(ghostPending.status, 'ready');
  if (ghostPending.status === 'ready') {
    assert.equal(ghostPending.publish.payload.status, 'configuration_required');
    assert.equal(ghostPending.publish.payload.nativeExecution, 'not_connected');
  }
  const ghostComplete = service.ghostTask(context, verifiedTask.id);
  assert.equal(ghostComplete.status === 'ready' && ghostComplete.publish.payload.progressPercent, 100);
  checks.push('ghost_metadata_uses_task_checkpoint_without_fake_executor');

  assert.equal(local.readRecentAuditEvents(100).some((event) => event.toolId === 'advanced_experience_producers'), true);
  checks.push('producer_audit_events');

  console.log(JSON.stringify({ success: true, checks }, null, 2));
} finally {
  local.close?.();
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try { fs.rmSync(root, { recursive: true, force: true }); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EBUSY' || attempt === 5) { console.warn(`Phase 7B temp cleanup deferred: ${root}`); break; }
      await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
    }
  }
}
