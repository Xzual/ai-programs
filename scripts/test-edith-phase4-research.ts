import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  EDITH_CONTRACT_AMENDMENT,
  TASK_CONTRACT_VERSION,
  type PlaybookDefinitionV2,
  type ResearchRunV2,
} from '../src/edith/contracts';
import { LocalSearchService } from '../src/edith/localSearchService';
import { JsonPhase4Persistence, MemoryPhase4Persistence } from '../src/edith/phase4Persistence';
import { PlaybookService, type PlaybookExecutionAdapter } from '../src/edith/playbookService';
import { RESEARCH_JOURNAL_FOLDER, ResearchJournalService, SandboxVaultProvider } from '../src/edith/researchJournalService';
import { ResearchService, type ResearchWorker } from '../src/edith/researchService';
import { ResearchSsrfPolicy, type ResearchHostResolver } from '../src/edith/researchSsrfPolicy';
import type { EdithPersistenceStore } from '../src/edith/persistence/types';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'edith-phase4-'));
process.env.EDITH_TEST_MODE = 'true';
const now = new Date().toISOString();
const old = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
const resolver: ResearchHostResolver = {
  resolverId: 'fixture-resolver',
  async resolve(hostname) {
    if (hostname === 'private.example') return ['10.0.0.2'];
    return ['93.184.216.34'];
  },
};

const v21 = { contractVersion: TASK_CONTRACT_VERSION, amendment: EDITH_CONTRACT_AMENDMENT } as const;

function journalRun(overrides: Partial<ResearchRunV2> = {}): ResearchRunV2 {
  return {
    ...v21,
    runId: 'run',
    query: 'user note',
    mode: 'FAST',
    status: 'completed',
    sourceIds: ['source-1'],
    artifactIds: [],
    sources: [{
      sourceId: 'source-1', url: 'https://example.com/report', title: 'Örnek Kaynak', retrievedAt: now,
      safety: { schemeValidated: true, redirectsValidated: true, resolvedTargetClass: 'public', retrievedByBackend: true, ssrfPolicyVersion: 'fixture', decision: 'allowed' },
    }],
    citations: [{ citationId: 'citation-1', sourceId: 'source-1' }],
    claims: [{ claimId: 'claim-1', statement: 'Doğrulanmış Türkçe bulgu.', citationIds: ['citation-1'], confidence: 0.9 }],
    provenance: { generatedBy: 'fixture', generatedAt: now, sourceIds: ['source-1'], methodology: 'fixture' },
    freshness: { checkedAt: now, status: 'fresh' },
    confidence: 0.9,
    completedAt: now,
    ...overrides,
  };
}

async function main(): Promise<void> {
  const checks: string[] = [];
  const ssrf = new ResearchSsrfPolicy();
  for (const blocked of [
    'file:///etc/passwd', 'http://localhost/admin', 'http://127.0.0.1/admin', 'http://10.0.0.1/',
    'http://169.254.169.254/latest/meta-data', 'http://192.0.2.1/', 'http://[::1]/',
    'https://user:pass@example.com/', 'https://example.com/?api_key=secret', 'https://metadata.google.internal/',
  ]) assert.equal((await ssrf.validate(blocked, resolver)).decision, 'blocked', blocked);
  assert.equal((await ssrf.validate('https://example.com/report')).decision, 'configuration_required');
  assert.equal((await ssrf.validate('https://example.com/report', resolver)).decision, 'allowed');
  const redirects = await ssrf.validateRedirectChain(['https://example.com', 'http://127.0.0.1/admin'], resolver);
  assert.equal(redirects.at(-1)?.decision, 'blocked');
  assert.equal((await ssrf.validate('https://private.example', resolver)).decision, 'blocked');
  checks.push('ssrf_and_redirect_revalidation');

  assert.throws(() => new SandboxVaultProvider(path.join(os.homedir(), 'edith-not-a-sandbox')));
  const vaultRoot = path.join(tempRoot, 'vault');
  const sandbox = new SandboxVaultProvider(vaultRoot);
  assert.throws(() => sandbox.write('../escape.md', 'no'));
  const userPath = `${RESEARCH_JOURNAL_FOLDER}/run-user-note.md`;
  sandbox.write(userPath, '# User note\nDo not replace.\n');
  const journal = new ResearchJournalService(sandbox);
  const journalResult = journal.write(journalRun({
    claims: [{ claimId: 'claim-1', statement: 'Doğrulanmış Türkçe bulgu api_key=abcdefghijk', citationIds: ['citation-1'], confidence: 0.9 }],
  }));
  assert.equal(journalResult.status, 'written');
  assert.equal(sandbox.read(userPath), '# User note\nDo not replace.\n');
  assert.equal(journalResult.relativePath?.endsWith('-edith.md'), true);
  const journalContent = sandbox.read(journalResult.relativePath ?? '') ?? '';
  assert.equal(journalContent.includes('abcdefghijk'), false);
  assert.equal(journalContent.includes('Doğrulanmış Türkçe bulgu'), true);
  checks.push('sandbox_unicode_secret_redaction_user_note_preservation');

  const phase4 = new MemoryPhase4Persistence();
  let claimStatement = 'The evidence is current.';
  let publishedAt = old;
  let active = 0;
  let maxActive = 0;
  let calls = 0;
  const worker: ResearchWorker = {
    workerId: 'fixture-worker',
    available: true,
    specializations: ['source_discovery', 'browser_acquisition', 'claim_synthesis', 'corroboration', 'citation_verification'],
    async execute({ specialization, attempt }) {
      active += 1;
      maxActive = Math.max(maxActive, active);
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      if (specialization === 'corroboration' && attempt === 1) throw new Error('transient');
      return {
        sources: [{ sourceId: 'source-1', url: 'https://example.com/report', title: 'Report', retrievedAt: now, publishedAt }],
        citations: [{ citationId: 'citation-1', sourceId: 'source-1', locator: 'section-1' }],
        claims: [{ claimId: 'claim-1', statement: claimStatement, citationIds: ['citation-1'], confidence: 0.8 }],
        artifactIds: ['artifact-1'],
      };
    },
  };
  const research = new ResearchService(phase4, [worker], resolver, journal);
  const first = await research.execute({ query: 'What changed?', mode: 'DEEP', maxConcurrency: 2, maxRetries: 1, staleAfterMs: 24 * 60 * 60 * 1000 });
  assert.equal(first.outcome, 'completed');
  assert.equal(first.run.claims?.length, 1);
  assert.equal(first.run.claims?.[0]?.citationIds.length, 1);
  assert.equal(first.run.freshness?.status, 'stale');
  assert.equal(first.run.claims?.[0]?.freshnessStatus, 'stale');
  assert.equal(maxActive <= 2, true);
  assert.equal(calls, first.plan.length + 1);
  claimStatement = 'The evidence is current and changed.';
  publishedAt = now;
  const second = await research.execute({ query: 'What changed?', mode: 'FAST', priorRunId: first.run.runId, maxConcurrency: 2 });
  assert.equal(second.outcome, 'completed');
  assert.deepEqual(second.run.priorRunDelta?.changedClaimIds, ['claim-1']);
  assert.equal(second.run.freshness?.status, 'fresh');
  checks.push('research_workers_citations_freshness_delta_bounded_retry');

  const noWorkers = await new ResearchService(new MemoryPhase4Persistence(), [], resolver).execute({ query: 'No provider', mode: 'BROWSER' });
  assert.equal(noWorkers.outcome, 'configuration_required');
  assert.equal(noWorkers.run.claims, undefined);
  const uncitedWorker: ResearchWorker = {
    ...worker,
    workerId: 'uncited-worker',
    async execute() {
      return {
        sources: [{ sourceId: 'source-u', url: 'https://example.com/u', retrievedAt: now }],
        citations: [],
        claims: [{ claimId: 'claim-u', statement: 'Unsupported claim.', citationIds: [], confidence: 0.2 }],
      };
    },
  };
  const uncited = await new ResearchService(new MemoryPhase4Persistence(), [uncitedWorker], resolver).execute({ query: 'Uncited', mode: 'FAST' });
  assert.equal(uncited.outcome, 'blocked');
  assert.notEqual(uncited.run.status, 'completed');
  checks.push('configuration_required_and_uncited_claim_block');

  const playbookDefinition: PlaybookDefinitionV2 = {
    ...v21,
    playbookId: 'phase4-playbook', version: '1.0.0', title: 'Phase 4 Evidence', skills: [], stepIds: ['collect', 'publish'],
    steps: [
      {
        ...v21, stepId: 'collect', title: 'Collect', dependsOn: [], inputSchema: {}, outputSchema: {}, skills: [], tools: ['fixture-tool'], permissions: ['network:read'],
        riskLevel: 2, approval: 'owner', timeoutMs: 2_000, retry: { maxAttempts: 5, backoffMs: 0, retryableErrorCodes: ['TRANSIENT'] },
        verification: { required: true, criteria: ['verified'] }, undo: { supported: true, instructions: 'Remove generated artifact.' },
      },
      {
        ...v21, stepId: 'publish', title: 'Publish', dependsOn: ['collect'], inputSchema: {}, outputSchema: {}, skills: [], tools: ['fixture-tool'], permissions: [],
        riskLevel: 1, approval: 'none', timeoutMs: 2_000, retry: { maxAttempts: 1, backoffMs: 0, retryableErrorCodes: [] },
        verification: { required: true, criteria: ['verified'] }, undo: { supported: false },
      },
    ],
  };
  const playbookStore = new MemoryPhase4Persistence();
  let playbookCalls = 0;
  let undoCalls = 0;
  const adapter: PlaybookExecutionAdapter = {
    adapterId: 'fixture-playbook', available: true,
    async execute(step, _input, context) {
      playbookCalls += 1;
      if (step.stepId === 'collect' && context.attempt === 1) return { success: false, retryable: true, errorCode: 'TRANSIENT' };
      return { success: true, artifactIds: [`artifact-${step.stepId}`], verificationStatus: 'PASS' };
    },
    async undo() { undoCalls += 1; return { success: true }; },
  };
  const playbooks = new PlaybookService(playbookStore, adapter);
  playbooks.register(playbookDefinition);
  assert.equal(playbooks.dryRun(playbookDefinition).outcome, 'waiting_for_approval');
  assert.equal(new PlaybookService(playbookStore).dryRun(playbookDefinition, new Set(['collect'])).outcome, 'configuration_required');
  const policyDefinition: PlaybookDefinitionV2 = {
    ...playbookDefinition,
    playbookId: 'policy-playbook',
    stepIds: ['collect'],
    steps: [{ ...playbookDefinition.steps![0], approval: 'policy' }],
  };
  assert.equal(new PlaybookService(playbookStore, adapter).dryRun(policyDefinition).outcome, 'configuration_required');
  assert.equal(new PlaybookService(playbookStore, adapter, { evaluate: () => 'approved' }).dryRun(policyDefinition).outcome, 'ready');
  const waiting = await playbooks.run(playbookDefinition.playbookId);
  assert.equal(waiting.outcome, 'waiting_for_approval');
  const played = await playbooks.run(playbookDefinition.playbookId, { approvedStepIds: ['collect'] });
  assert.equal(played.outcome, 'completed');
  assert.equal(played.run.stepRuns?.find((step) => step.stepId === 'collect' && step.status === 'completed')?.attempt, 2);
  assert.equal(played.run.stepRuns?.some((step) => step.stepId === 'collect' && step.attempt === 1 && step.status === 'failed'), true);
  assert.equal(playbookCalls, 3);
  const undone = await playbooks.undo(played.run.runId);
  assert.equal(undone.outcome, 'completed');
  assert.equal(undoCalls, 1);
  assert.equal(playbookStore.listPlaybookRuns().length >= 2, true);
  const cappedStore = new MemoryPhase4Persistence();
  let cappedCalls = 0;
  const capped = new PlaybookService(cappedStore, {
    adapterId: 'always-fail', available: true,
    async execute() { cappedCalls += 1; return { success: false, retryable: true, errorCode: 'TRANSIENT' }; },
  });
  capped.register({ ...playbookDefinition, playbookId: 'bounded-playbook', stepIds: ['collect'], steps: [playbookDefinition.steps![0]] });
  assert.equal((await capped.run('bounded-playbook', { approvedStepIds: ['collect'] })).outcome, 'failed');
  assert.equal(cappedCalls, 3);
  checks.push('playbook_validation_approval_retry_verification_undo_history');

  const localStore = {
    listTasks: () => [{ id: 'task-1', title: 'Research task', objective: 'Find evidence', status: 'RUNNING', priority: 'normal', createdAt: now }],
    listMemories: () => [{ id: 'memory-1', key: 'credential note', value: 'api_key=supersecret C:\\Users\\Owner\\secret.txt', category: 'fact', createdAt: Date.now(), sensitivity: 'sensitive' }],
    listKnowledgeNodes: () => [{ id: 'node-1', title: 'Evidence graph', type: 'Note', source: 'edith', tags: ['research'], importance: 1, recentActivityAt: now, aliases: [], properties: {} }],
  } as unknown as EdithPersistenceStore;
  const search = new LocalSearchService(localStore, playbookStore);
  const redacted = search.search({ query: 'supersecret', scopes: ['memory'], includeSensitiveMemory: true });
  assert.equal(redacted.length, 1);
  assert.equal(redacted[0].summary.includes('supersecret'), false);
  assert.equal(redacted[0].summary.includes('C:\\Users'), false);
  assert.equal(search.search({ query: 'supersecret', scopes: ['memory'] }).length, 0);
  assert.equal(search.search({ query: 'Evidence', scopes: ['task', 'knowledge', 'playbook'] }).every((row) => Boolean(row.provenance.recordId)), true);
  checks.push('unified_search_scope_provenance_redaction');

  const legacyPath = path.join(tempRoot, 'legacy-store');
  fs.mkdirSync(legacyPath, { recursive: true });
  const fileName = 'phase4.json';
  fs.writeFileSync(path.join(legacyPath, fileName), JSON.stringify([journalRun({
    runId: 'legacy-run', status: 'failed', sources: undefined, citations: undefined, claims: undefined,
    sourceIds: [], provenance: undefined, freshness: undefined, confidence: 0,
  })]));
  const migratedStore = new JsonPhase4Persistence(legacyPath, fileName);
  assert.equal(migratedStore.initialize().migrated, true);
  assert.equal(migratedStore.getResearchRun('legacy-run')?.runId, 'legacy-run');
  const migratedDocument = JSON.parse(fs.readFileSync(path.join(legacyPath, fileName), 'utf8')) as { schemaVersion: string };
  assert.equal(migratedDocument.schemaVersion, '2.1');
  checks.push('phase4_persistence_migration');

  console.log(JSON.stringify({ success: true, checks }, null, 2));
}

main().finally(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
