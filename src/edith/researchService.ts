import { createHash, randomUUID } from 'node:crypto';
import {
  EDITH_CONTRACT_AMENDMENT,
  TASK_CONTRACT_VERSION,
  parseResearchRunV2,
  type ResearchCitationV2,
  type ResearchClaimV2,
  type ResearchFreshnessV2,
  type ResearchModeV2,
  type ResearchRunDeltaV2,
  type ResearchRunV2,
  type ResearchSourceV2,
  type SharedResultCardV2,
} from './contracts';
import type { Phase4Persistence } from './phase4Persistence';
import type { ResearchJournalService, ResearchJournalWriteResult } from './researchJournalService';
import { ResearchSsrfPolicy, type ResearchHostResolver } from './researchSsrfPolicy';
import type { ResultCardProductionOptions, SharedResultCardProducerService } from './sharedResultCardProducer';

export type ResearchSpecialization = 'source_discovery' | 'browser_acquisition' | 'claim_synthesis' | 'corroboration' | 'citation_verification';

export type ResearchRequestV2_1 = Required<Pick<ResearchRunV2, 'query' | 'mode'>> & {
  priorRunId?: string;
  seedUrls?: string[];
  maxConcurrency?: number;
  maxRetries?: number;
  workerTimeoutMs?: number;
  staleAfterMs?: number;
};

export interface ResearchSourceCandidate extends Omit<ResearchSourceV2, 'safety'> {
  redirectChain?: string[];
}

export interface ResearchWorkerOutput {
  sources: ResearchSourceCandidate[];
  citations: ResearchCitationV2[];
  claims: ResearchClaimV2[];
  artifactIds?: string[];
  uncertainty?: string[];
}

export interface ResearchWorker {
  readonly workerId: string;
  readonly available: boolean;
  readonly specializations: ResearchSpecialization[];
  execute(input: {
    request: ResearchRequestV2_1;
    specialization: ResearchSpecialization;
    attempt: number;
    ssrf: ResearchSsrfPolicy;
    resolver?: ResearchHostResolver;
  }): Promise<ResearchWorkerOutput>;
}

export interface ResearchWorkerAssignment {
  specialization: ResearchSpecialization;
  workerId?: string;
  status: 'ready' | 'configuration_required';
}

export interface ResearchExecutionResult {
  outcome: 'completed' | 'configuration_required' | 'blocked' | 'failed';
  run: ResearchRunV2;
  plan: ResearchWorkerAssignment[];
  reasonCodes: string[];
  journal?: ResearchJournalWriteResult;
  resultCard?: SharedResultCardV2;
}

export interface ResearchResultCardOutput {
  producer: SharedResultCardProducerService;
  options: ResultCardProductionOptions;
}

const MODE_SPECIALIZATIONS: Record<ResearchModeV2, ResearchSpecialization[]> = {
  FAST: ['source_discovery', 'claim_synthesis'],
  DEEP: ['source_discovery', 'corroboration', 'claim_synthesis', 'citation_verification'],
  BROWSER: ['browser_acquisition', 'claim_synthesis', 'citation_verification'],
};

function fingerprint(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function normalizedText(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
}

function average(values: number[]): number {
  return values.length ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10_000) / 10_000 : 0;
}

function withWorkerTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('RESEARCH_WORKER_TIMEOUT')), timeoutMs);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}

function freshnessForSources(sources: ResearchSourceV2[], checkedAt: Date, staleAfterMs: number): ResearchFreshnessV2 {
  if (!sources.length) return { checkedAt: checkedAt.toISOString(), status: 'unknown' };
  const times = sources.map((source) => Date.parse(source.publishedAt ?? source.retrievedAt)).filter(Number.isFinite).sort((a, b) => a - b);
  if (!times.length) return { checkedAt: checkedAt.toISOString(), status: 'unknown' };
  const statuses = times.map((time) => checkedAt.getTime() - time <= staleAfterMs ? 'fresh' : 'stale');
  return {
    checkedAt: checkedAt.toISOString(),
    oldestSourceAt: new Date(times[0]).toISOString(),
    newestSourceAt: new Date(times[times.length - 1]).toISOString(),
    staleAfter: new Date(checkedAt.getTime() - staleAfterMs).toISOString(),
    status: statuses.every((status) => status === 'fresh') ? 'fresh' : statuses.every((status) => status === 'stale') ? 'stale' : 'mixed',
  };
}

function deltaFrom(previous: ResearchRunV2, current: ResearchClaimV2[]): ResearchRunDeltaV2 {
  const before = new Map((previous.claims ?? []).map((claim) => [claim.claimId, claim]));
  const after = new Map(current.map((claim) => [claim.claimId, claim]));
  const addedClaimIds = [...after.keys()].filter((id) => !before.has(id)).sort();
  const removedClaimIds = [...before.keys()].filter((id) => !after.has(id)).sort();
  const changedClaimIds = [...after.keys()].filter((id) => {
    const prior = before.get(id);
    const next = after.get(id);
    return prior && next && (normalizedText(prior.statement) !== normalizedText(next.statement)
      || prior.confidence !== next.confidence
      || [...prior.citationIds].sort().join('|') !== [...next.citationIds].sort().join('|'));
  }).sort();
  return {
    previousRunId: previous.runId,
    addedClaimIds,
    changedClaimIds,
    removedClaimIds,
    summary: `${addedClaimIds.length} added, ${changedClaimIds.length} changed, ${removedClaimIds.length} removed claim(s).`,
  };
}

export class ResearchService {
  private readonly ssrf = new ResearchSsrfPolicy();

  constructor(
    private readonly persistence: Phase4Persistence,
    private readonly workers: ResearchWorker[],
    private readonly resolver?: ResearchHostResolver,
    private readonly journal?: ResearchJournalService,
  ) {}

  plan(request: ResearchRequestV2_1): ResearchWorkerAssignment[] {
    return MODE_SPECIALIZATIONS[request.mode].map((specialization) => {
      const worker = [...this.workers]
        .filter((candidate) => candidate.available && candidate.specializations.includes(specialization))
        .sort((left, right) => left.workerId.localeCompare(right.workerId))[0];
      return { specialization, workerId: worker?.workerId, status: worker ? 'ready' : 'configuration_required' };
    });
  }

  async execute(request: ResearchRequestV2_1, resultOutput?: ResearchResultCardOutput): Promise<ResearchExecutionResult> {
    const startedAt = new Date().toISOString();
    const runId = `research-${randomUUID()}`;
    const plan = this.plan(request);
    const initial: ResearchRunV2 = {
      contractVersion: TASK_CONTRACT_VERSION,
      amendment: EDITH_CONTRACT_AMENDMENT,
      runId,
      query: request.query,
      mode: request.mode,
      status: 'running',
      sourceIds: [],
      artifactIds: [],
      startedAt,
    };
    this.persistence.saveResearchRun(initial);

    const seedFailure = await this.validateSeedUrls(request.seedUrls ?? []);
    if (seedFailure) return this.finishFailure(initial, plan, seedFailure.outcome, seedFailure.reasonCodes, resultOutput);
    if (plan.some((assignment) => assignment.status === 'configuration_required')) {
      return this.finishFailure(initial, plan, 'configuration_required', ['RESEARCH_WORKER_CONFIGURATION_REQUIRED'], resultOutput);
    }

    const maxConcurrency = Math.max(1, Math.min(4, request.maxConcurrency ?? 2));
    const maxRetries = Math.max(0, Math.min(2, request.maxRetries ?? 1));
    const outputs: ResearchWorkerOutput[] = [];
    const failures: string[] = [];
    for (let index = 0; index < plan.length; index += maxConcurrency) {
      const batch = plan.slice(index, index + maxConcurrency);
      const settled = await Promise.all(batch.map(async (assignment) => {
        const worker = this.workers.find((candidate) => candidate.workerId === assignment.workerId);
        if (!worker) throw new Error(`Worker unavailable: ${assignment.specialization}`);
        return this.executeWorker(worker, assignment.specialization, request, maxRetries);
      }).map((promise) => promise.then((value) => ({ value })).catch((error: unknown) => ({ error }))));
      for (const item of settled) {
        if ('value' in item) outputs.push(item.value);
        else failures.push(item.error instanceof Error ? item.error.message : String(item.error));
      }
    }
    if (failures.length) return this.finishFailure(initial, plan, 'failed', failures.map(() => 'RESEARCH_WORKER_FAILED'), resultOutput);

    const merged = await this.merge(outputs);
    if (merged.blockedReasons.length) return this.finishFailure(initial, plan, 'blocked', merged.blockedReasons, resultOutput);
    const uncitedClaims = merged.claims.filter((claim) => claim.citationIds.length === 0);
    if (!merged.claims.length || uncitedClaims.length) {
      return this.finishFailure(initial, plan, 'blocked', [!merged.claims.length ? 'NO_VERIFIABLE_CLAIMS' : 'UNCITED_CLAIMS'], resultOutput);
    }

    const now = new Date();
    const staleAfterMs = Math.max(60_000, request.staleAfterMs ?? 30 * 24 * 60 * 60 * 1000);
    const freshness = freshnessForSources(merged.sources, now, staleAfterMs);
    const sourceById = new Map(merged.sources.map((source) => [source.sourceId, source]));
    const citationById = new Map(merged.citations.map((citation) => [citation.citationId, citation]));
    const claims = merged.claims.map((claim) => {
      const citedSources = claim.citationIds.flatMap((id) => {
        const citation = citationById.get(id);
        const source = citation ? sourceById.get(citation.sourceId) : undefined;
        return source ? [source] : [];
      });
      return { ...claim, freshnessStatus: freshnessForSources(citedSources, now, staleAfterMs).status };
    });
    const prior = request.priorRunId ? this.persistence.getResearchRun(request.priorRunId) : undefined;
    const run: ResearchRunV2 = {
      ...initial,
      status: 'completed',
      sourceIds: merged.sources.map((source) => source.sourceId),
      artifactIds: [...new Set(outputs.flatMap((output) => output.artifactIds ?? []))].sort(),
      sources: merged.sources,
      citations: merged.citations,
      claims,
      provenance: {
        generatedBy: 'edith-research-orchestrator-v2.1',
        generatedAt: now.toISOString(),
        sourceIds: merged.sources.map((source) => source.sourceId),
        methodology: `${request.mode} deterministic specialized-worker merge with citation validation.`,
      },
      freshness,
      confidence: average(claims.map((claim) => claim.confidence)),
      uncertainty: [...new Set(outputs.flatMap((output) => output.uncertainty ?? []))].sort().join(' ') || undefined,
      priorRunDelta: prior ? deltaFrom(prior, claims) : undefined,
      completedAt: now.toISOString(),
    };
    const parsed = parseResearchRunV2(run);
    if (parsed.success === false) return this.finishFailure(initial, plan, 'failed', [parsed.errorCode], resultOutput);
    const journal = this.journal?.write(parsed.value);
    if (journal?.status === 'written' && journal.relativePath) parsed.value.artifactIds.push(`journal:${journal.relativePath}`);
    this.persistence.saveResearchRun(parsed.value);
    const resultCard = resultOutput?.producer.fromResearchRun(parsed.value, resultOutput.options);
    return { outcome: 'completed', run: parsed.value, plan, reasonCodes: [], journal, resultCard };
  }

  private async validateSeedUrls(urls: string[]): Promise<{ outcome: 'blocked' | 'configuration_required'; reasonCodes: string[] } | undefined> {
    for (const url of urls) {
      const result = await this.ssrf.validate(url, this.resolver);
      if (result.decision !== 'allowed') return { outcome: result.decision, reasonCodes: result.reasonCodes };
    }
    return undefined;
  }

  private async executeWorker(worker: ResearchWorker, specialization: ResearchSpecialization, request: ResearchRequestV2_1, maxRetries: number): Promise<ResearchWorkerOutput> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
      try {
        const timeoutMs = Math.max(1_000, Math.min(120_000, request.workerTimeoutMs ?? 30_000));
        return await withWorkerTimeout(
          worker.execute({ request, specialization, attempt, ssrf: this.ssrf, resolver: this.resolver }),
          timeoutMs,
        );
      }
      catch (error) { lastError = error; }
    }
    throw lastError instanceof Error ? lastError : new Error('Research worker failed.');
  }

  private async merge(outputs: ResearchWorkerOutput[]): Promise<{ sources: ResearchSourceV2[]; citations: ResearchCitationV2[]; claims: ResearchClaimV2[]; blockedReasons: string[] }> {
    const sourceByUrl = new Map<string, ResearchSourceV2>();
    const sourceIdMap = new Map<string, string>();
    const blockedReasons: string[] = [];
    for (const candidate of outputs.flatMap((output) => output.sources).sort((a, b) => a.url.localeCompare(b.url))) {
      const chain = candidate.redirectChain?.length ? candidate.redirectChain : [candidate.url];
      const results = await this.ssrf.validateRedirectChain(chain, this.resolver);
      const last = results[results.length - 1];
      if (!last || last.decision !== 'allowed') {
        blockedReasons.push(...(last?.reasonCodes ?? ['SSRF_VALIDATION_FAILED']));
        continue;
      }
      const canonicalUrl = last.normalizedUrl ?? candidate.canonicalUrl ?? candidate.url;
      const key = canonicalUrl.toLocaleLowerCase('en-US');
      const existing = sourceByUrl.get(key);
      const sourceId = existing?.sourceId ?? (candidate.sourceId || `source-${fingerprint(key).slice(0, 16)}`);
      sourceIdMap.set(candidate.sourceId, sourceId);
      if (!existing) sourceByUrl.set(key, {
        ...candidate,
        sourceId,
        url: canonicalUrl,
        canonicalUrl,
        safety: {
          schemeValidated: true,
          redirectsValidated: results.every((result) => result.decision === 'allowed'),
          resolvedTargetClass: 'public',
          retrievedByBackend: true,
          ssrfPolicyVersion: this.ssrf.version,
          decision: 'allowed',
          reasonCodes: [],
          validatedAt: last.validatedAt,
          validatorId: this.resolver?.resolverId ?? 'literal-ip-validator',
          redirectCount: Math.max(0, chain.length - 1),
        },
      });
    }
    const citationByKey = new Map<string, ResearchCitationV2>();
    const citationIdMap = new Map<string, string>();
    for (const citation of outputs.flatMap((output) => output.citations).sort((a, b) => a.citationId.localeCompare(b.citationId))) {
      const sourceId = sourceIdMap.get(citation.sourceId);
      if (!sourceId) { blockedReasons.push('CITATION_SOURCE_BLOCKED_OR_MISSING'); continue; }
      const key = `${sourceId}|${citation.locator ?? ''}|${citation.excerptSha256 ?? ''}`;
      const existing = citationByKey.get(key);
      const citationId = existing?.citationId ?? (citation.citationId || `citation-${fingerprint(key).slice(0, 16)}`);
      citationIdMap.set(citation.citationId, citationId);
      if (!existing) citationByKey.set(key, { ...citation, citationId, sourceId });
    }
    const claimById = new Map<string, ResearchClaimV2>();
    const claimIdByStatement = new Map<string, string>();
    for (const claim of outputs.flatMap((output) => output.claims).sort((a, b) => a.claimId.localeCompare(b.claimId))) {
      const citationIds = [...new Set(claim.citationIds.map((id) => citationIdMap.get(id)).filter((id): id is string => Boolean(id)))].sort();
      const key = normalizedText(claim.statement);
      const priorId = claimById.has(claim.claimId) ? claim.claimId : claimIdByStatement.get(key);
      const prior = priorId ? claimById.get(priorId) : undefined;
      if (prior) {
        prior.citationIds = [...new Set([...prior.citationIds, ...citationIds])].sort();
        if (claim.confidence > prior.confidence || (claim.confidence === prior.confidence && claim.statement.localeCompare(prior.statement) < 0)) {
          prior.statement = claim.statement;
          prior.confidence = claim.confidence;
          prior.uncertainty = claim.uncertainty;
          prior.status = claim.status;
        }
      } else {
        claimById.set(claim.claimId, { ...claim, citationIds });
        claimIdByStatement.set(key, claim.claimId);
      }
    }
    return {
      sources: [...sourceByUrl.values()].sort((a, b) => a.sourceId.localeCompare(b.sourceId)),
      citations: [...citationByKey.values()].sort((a, b) => a.citationId.localeCompare(b.citationId)),
      claims: [...claimById.values()].sort((a, b) => a.claimId.localeCompare(b.claimId)),
      blockedReasons: [...new Set(blockedReasons)].sort(),
    };
  }

  private finishFailure(
    initial: ResearchRunV2,
    plan: ResearchWorkerAssignment[],
    outcome: 'configuration_required' | 'blocked' | 'failed',
    reasonCodes: string[],
    resultOutput?: ResearchResultCardOutput,
  ): ResearchExecutionResult {
    const run: ResearchRunV2 = {
      ...initial,
      status: 'failed',
      completedAt: new Date().toISOString(),
      uncertainty: reasonCodes.join('; '),
      provenance: { generatedBy: 'edith-research-orchestrator-v2.1', generatedAt: new Date().toISOString(), sourceIds: [], methodology: 'No claims were generated.' },
      freshness: { checkedAt: new Date().toISOString(), status: 'unknown' },
      confidence: 0,
    };
    this.persistence.saveResearchRun(run);
    const resultCard = resultOutput?.producer.fromResearchRun(run, resultOutput.options);
    return { outcome, run, plan, reasonCodes: [...new Set(reasonCodes)], resultCard };
  }
}
