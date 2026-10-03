import { Router, type RequestHandler } from 'express';
import type { LocalSearchRequest, LocalSearchScope } from '../../src/edith/localSearchService';
import { requireOwnerSession, requireProtectedMutation } from '../security/ownerSession';
import { errorEnvelope, getPhase4ApiRuntime, successEnvelope, validatePublicPayload, type Phase4ApiRuntime } from './phase4Api';

const SCOPES: LocalSearchScope[] = ['task', 'memory', 'knowledge', 'research', 'playbook'];

function parseSearch(value: Record<string, unknown>): { success: true; value: LocalSearchRequest } | { success: false; errorCode: string; safeMessage: string } {
  const query = typeof value.query === 'string' ? value.query.normalize('NFKC').trim() : '';
  if (!query || query.length > 500 || query.split(/\s+/).length > 32) return { success: false, errorCode: 'INVALID_SEARCH_QUERY', safeMessage: 'query must contain 1 to 500 characters and at most 32 terms.' };
  const rawScopes = Array.isArray(value.scopes) ? value.scopes : typeof value.scopes === 'string' ? value.scopes.split(',') : undefined;
  if (rawScopes && (rawScopes.length === 0 || rawScopes.length > SCOPES.length || !rawScopes.every((scope) => SCOPES.includes(scope as LocalSearchScope)))) {
    return { success: false, errorCode: 'INVALID_SEARCH_SCOPES', safeMessage: 'Search scopes are invalid.' };
  }
  const parsedLimit = value.limit === undefined ? 25 : Number(value.limit);
  if (!Number.isSafeInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) return { success: false, errorCode: 'INVALID_SEARCH_LIMIT', safeMessage: 'limit must be an integer from 1 to 100.' };
  if (value.includeSensitiveMemory === true || value.includeSensitiveMemory === 'true') return { success: false, errorCode: 'SENSITIVE_SEARCH_FORBIDDEN', safeMessage: 'Sensitive memory search is not exposed by this API.' };
  const taskIds = Array.isArray(value.taskIds) ? value.taskIds : typeof value.taskIds === 'string' ? value.taskIds.split(',') : undefined;
  if (taskIds && (taskIds.length > 50 || !taskIds.every((id) => typeof id === 'string' && id.length > 0 && id.length <= 256))) {
    return { success: false, errorCode: 'INVALID_SEARCH_TASK_IDS', safeMessage: 'taskIds must contain at most 50 bounded identifiers.' };
  }
  return { success: true, value: { query, scopes: rawScopes as LocalSearchScope[] | undefined, limit: parsedLimit, includeSensitiveMemory: false, taskIds: taskIds as string[] | undefined } };
}

export function createLocalSearchRouter(options: { runtime?: Phase4ApiRuntime; protectedMutation?: RequestHandler[] } = {}): Router {
  const router = Router();
  const runtime = options.runtime ?? getPhase4ApiRuntime();
  const protectedMutation = options.protectedMutation ?? requireProtectedMutation;

  router.get('/api/edith/search', requireOwnerSession, (req, res) => {
    const parsed = parseSearch(req.query as Record<string, unknown>);
    if (parsed.success === false) return res.status(400).json(errorEnvelope(req, parsed.errorCode, parsed.safeMessage));
    const results = runtime.search.search(parsed.value);
    res.json(successEnvelope(req, { results, limit: parsed.value.limit, scopes: parsed.value.scopes ?? SCOPES }));
  });

  router.post('/api/edith/search', ...protectedMutation, (req, res) => {
    const payloadCheck = validatePublicPayload(req.body);
    if (payloadCheck.success === false) return res.status(400).json(errorEnvelope(req, payloadCheck.errorCode, payloadCheck.safeMessage));
    const parsed = parseSearch(req.body as Record<string, unknown>);
    if (parsed.success === false) return res.status(400).json(errorEnvelope(req, parsed.errorCode, parsed.safeMessage));
    const results = runtime.search.search(parsed.value);
    res.json(successEnvelope(req, { results, limit: parsed.value.limit, scopes: parsed.value.scopes ?? SCOPES }));
  });

  return router;
}
