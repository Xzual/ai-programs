import { Router, type RequestHandler } from 'express';
import { requireOwnerSession, requireProtectedMutation } from '../security/ownerSession';
import { appendSecurityAudit } from '../security/auditLog';
import type { ResearchModeV2 } from '../../src/edith/contracts';
import type { ResearchRequestV2_1 } from '../../src/edith/researchService';
import {
  errorEnvelope,
  executeIdempotent,
  getPhase4ApiRuntime,
  successEnvelope,
  validatePublicPayload,
  type Phase4ApiRuntime,
} from './phase4Api';

const MODES: ResearchModeV2[] = ['FAST', 'DEEP', 'BROWSER'];

function boundedLimit(value: unknown, fallback = 25): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? Math.min(100, Math.max(1, parsed)) : fallback;
}

function parseRequest(value: unknown, runtime: Phase4ApiRuntime): { success: true; value: ResearchRequestV2_1 } | { success: false; errorCode: string; safeMessage: string } {
  const publicPayload = validatePublicPayload(value);
  if (publicPayload.success === false) return publicPayload;
  const body = value as Record<string, unknown>;
  const query = typeof body.query === 'string' ? body.query.normalize('NFKC').trim() : '';
  if (!query || query.length > 2_000) return { success: false, errorCode: 'INVALID_RESEARCH_QUERY', safeMessage: 'query must contain between 1 and 2000 characters.' };
  if (!MODES.includes(body.mode as ResearchModeV2)) return { success: false, errorCode: 'INVALID_RESEARCH_MODE', safeMessage: 'mode must be FAST, DEEP, or BROWSER.' };
  if (body.priorRunId !== undefined && (typeof body.priorRunId !== 'string' || !runtime.persistence.getResearchRun(body.priorRunId))) {
    return { success: false, errorCode: 'PRIOR_RUN_NOT_FOUND', safeMessage: 'The requested prior research run was not found.' };
  }
  if (body.seedUrls !== undefined && (!Array.isArray(body.seedUrls) || body.seedUrls.length > 20 || !body.seedUrls.every((url) => typeof url === 'string' && url.length > 0 && url.length <= 2_048))) {
    return { success: false, errorCode: 'INVALID_RESEARCH_SEED_URLS', safeMessage: 'seedUrls must contain at most 20 bounded URL strings.' };
  }
  const boundedInteger = (key: string, minimum: number, maximum: number): number | undefined | false => {
    if (body[key] === undefined) return undefined;
    const parsed = Number(body[key]);
    return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : false;
  };
  const maxConcurrency = boundedInteger('maxConcurrency', 1, 4);
  const maxRetries = boundedInteger('maxRetries', 0, 2);
  const workerTimeoutMs = boundedInteger('workerTimeoutMs', 1_000, 120_000);
  const staleAfterMs = boundedInteger('staleAfterMs', 60_000, 365 * 24 * 60 * 60 * 1_000);
  if ([maxConcurrency, maxRetries, workerTimeoutMs, staleAfterMs].includes(false)) {
    return { success: false, errorCode: 'INVALID_RESEARCH_LIMITS', safeMessage: 'Research concurrency, retry, timeout, or freshness limits are out of range.' };
  }
  return {
    success: true,
    value: {
      query,
      mode: body.mode as ResearchModeV2,
      priorRunId: body.priorRunId as string | undefined,
      seedUrls: body.seedUrls as string[] | undefined,
      maxConcurrency: maxConcurrency as number | undefined,
      maxRetries: maxRetries as number | undefined,
      workerTimeoutMs: workerTimeoutMs as number | undefined,
      staleAfterMs: staleAfterMs as number | undefined,
    },
  };
}

function outcomeStatus(outcome: string): number {
  if (outcome === 'completed') return 201;
  if (outcome === 'configuration_required') return 503;
  if (outcome === 'blocked') return 422;
  return 500;
}

export function createResearchRouter(options: { runtime?: Phase4ApiRuntime; protectedMutation?: RequestHandler[] } = {}): Router {
  const router = Router();
  const runtime = options.runtime ?? getPhase4ApiRuntime();
  const protectedMutation = options.protectedMutation ?? requireProtectedMutation;

  router.get('/api/edith/research', requireOwnerSession, (req, res) => {
    const limit = boundedLimit(req.query.limit);
    const mode = typeof req.query.mode === 'string' && MODES.includes(req.query.mode as ResearchModeV2) ? req.query.mode : undefined;
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const runs = runtime.persistence.listResearchRuns().filter((run) => (!mode || run.mode === mode) && (!status || run.status === status)).slice(0, limit);
    res.json(successEnvelope(req, { runs, limit }));
  });

  router.post('/api/edith/research/run', ...protectedMutation, async (req, res) => {
    const parsed = parseRequest(req.body, runtime);
    if (parsed.success === false) return res.status(400).json(errorEnvelope(req, parsed.errorCode, parsed.safeMessage));
    const executed = await executeIdempotent(req, runtime, 'research.run', async () => {
      const result = await runtime.research.execute(parsed.value);
      appendSecurityAudit(req, {
        action: 'phase4.research.run', authorization: 'allowed', result: result.outcome === 'completed' ? 'success' : 'error',
        message: `Research run finished with ${result.outcome}.`, riskLevel: parsed.value.mode === 'BROWSER' ? 3 : 2,
      });
      const status = outcomeStatus(result.outcome);
      return {
        status,
        body: result.outcome === 'completed'
          ? successEnvelope(req, result, { outcome: result.outcome })
          : errorEnvelope(req, result.outcome.toUpperCase(), 'Research could not complete with the configured backend capabilities.', { outcome: result.outcome, data: result }),
      };
    });
    if ('errorCode' in executed) {
      const status = executed.errorCode === 'IDEMPOTENCY_KEY_REUSED' ? 409 : 400;
      return res.status(status).json(errorEnvelope(req, executed.errorCode, executed.errorCode === 'IDEMPOTENCY_KEY_REUSED' ? 'The idempotency key was already used with another payload.' : 'A valid x-idempotency-key header is required.'));
    }
    res.status(executed.result.status).json({ ...executed.result.body, idempotentReplay: executed.replayed });
  });

  router.post('/api/edith/research', ...protectedMutation, async (req, res) => {
    const parsed = parseRequest(req.body, runtime);
    if (parsed.success === false) return res.status(400).json(errorEnvelope(req, parsed.errorCode, parsed.safeMessage));
    const executed = await executeIdempotent(req, runtime, 'research.create', async () => {
      const result = await runtime.research.execute(parsed.value);
      const status = outcomeStatus(result.outcome);
      return {
        status,
        body: result.outcome === 'completed'
          ? successEnvelope(req, result, { outcome: result.outcome })
          : errorEnvelope(req, result.outcome.toUpperCase(), 'Research could not complete with the configured backend capabilities.', { outcome: result.outcome, data: result }),
      };
    });
    if ('errorCode' in executed) return res.status(executed.errorCode === 'IDEMPOTENCY_KEY_REUSED' ? 409 : 400).json(errorEnvelope(req, executed.errorCode, 'A unique valid x-idempotency-key header is required.'));
    res.status(executed.result.status).json({ ...executed.result.body, idempotentReplay: executed.replayed });
  });

  router.post('/api/edith/research/:runId/run', ...protectedMutation, async (req, res) => {
    const prior = runtime.persistence.getResearchRun(req.params.runId);
    if (!prior) return res.status(404).json(errorEnvelope(req, 'RESEARCH_RUN_NOT_FOUND', 'Research run not found.'));
    req.body = { ...(req.body ?? {}), query: prior.query, mode: prior.mode ?? 'FAST', priorRunId: prior.runId };
    const parsed = parseRequest(req.body, runtime);
    if (parsed.success === false) return res.status(400).json(errorEnvelope(req, parsed.errorCode, parsed.safeMessage));
    const executed = await executeIdempotent(req, runtime, `research.rerun:${prior.runId}`, async () => {
      const result = await runtime.research.execute(parsed.value);
      const status = outcomeStatus(result.outcome);
      return { status, body: result.outcome === 'completed' ? successEnvelope(req, result, { outcome: result.outcome }) : errorEnvelope(req, result.outcome.toUpperCase(), 'Research rerun could not complete.', { outcome: result.outcome, data: result }) };
    });
    if ('errorCode' in executed) return res.status(executed.errorCode === 'IDEMPOTENCY_KEY_REUSED' ? 409 : 400).json(errorEnvelope(req, executed.errorCode, 'A unique valid x-idempotency-key header is required.'));
    res.status(executed.result.status).json({ ...executed.result.body, idempotentReplay: executed.replayed });
  });

  router.post('/api/edith/research/:runId/cancel', ...protectedMutation, (req, res) => {
    const run = runtime.persistence.getResearchRun(req.params.runId);
    if (!run) return res.status(404).json(errorEnvelope(req, 'RESEARCH_RUN_NOT_FOUND', 'Research run not found.'));
    res.status(501).json(errorEnvelope(req, 'RESEARCH_CANCELLATION_NOT_SUPPORTED', 'The current research service does not expose cooperative cancellation; no state was changed.', { data: { run } }));
  });

  router.get('/api/edith/research/:runId/delta', requireOwnerSession, (req, res) => {
    const run = runtime.persistence.getResearchRun(req.params.runId);
    if (!run) return res.status(404).json(errorEnvelope(req, 'RESEARCH_RUN_NOT_FOUND', 'Research run not found.'));
    res.json(successEnvelope(req, { runId: run.runId, priorRunDelta: run.priorRunDelta ?? null }));
  });

  router.get('/api/edith/research/:runId/journal-status', requireOwnerSession, (req, res) => {
    const run = runtime.persistence.getResearchRun(req.params.runId);
    if (!run) return res.status(404).json(errorEnvelope(req, 'RESEARCH_RUN_NOT_FOUND', 'Research run not found.'));
    const artifact = run.artifactIds.find((id) => id.startsWith('journal:'));
    const status = artifact ? 'written' : runtime.journalConfigured ? 'not_written' : 'configuration_required';
    res.json(successEnvelope(req, { runId: run.runId, status, artifactId: artifact }));
  });

  router.get('/api/edith/research/:runId', requireOwnerSession, (req, res) => {
    const run = runtime.persistence.getResearchRun(req.params.runId);
    if (!run) return res.status(404).json(errorEnvelope(req, 'RESEARCH_RUN_NOT_FOUND', 'Research run not found.'));
    res.json(successEnvelope(req, { run }));
  });

  return router;
}
