import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Request } from 'express';
import { EDITH_CONTRACT_AMENDMENT, EDITH_CONTRACT_SCHEMA, EDITH_CONTRACT_VERSION, validateNoSecretMaterial } from '../../src/edith/contracts';
import { getEdithPersistenceStore } from '../../src/edith/persistence';
import { JsonPhase4Persistence, type Phase4Persistence } from '../../src/edith/phase4Persistence';
import { ResearchJournalService } from '../../src/edith/researchJournalService';
import { obsidianProviderConfigService } from '../../src/edith/obsidianProviderService';
import { ResearchService } from '../../src/edith/researchService';
import { PlaybookService } from '../../src/edith/playbookService';
import { LocalSearchService } from '../../src/edith/localSearchService';
import { sanitizeSensitiveValue } from '../../src/edith/securityRedaction';
import { BoundedResearchAcquisitionWorker } from '../../src/edith/researchAcquisitionAdapter';
import { RegistryPlaybookExecutionAdapter } from '../../src/edith/playbookExecutionAdapter';
import { getOwnerSession } from '../security/ownerSession';
import { Phase4IdempotencyStore } from './phase4IdempotencyStore';
export { Phase4IdempotencyStore } from './phase4IdempotencyStore';

export const PHASE4_API_CONTRACT = Object.freeze({
  schema: EDITH_CONTRACT_SCHEMA,
  version: EDITH_CONTRACT_VERSION,
  amendment: EDITH_CONTRACT_AMENDMENT,
});

export interface Phase4ApiRuntime {
  persistence: Phase4Persistence;
  research: ResearchService;
  playbooks: PlaybookService;
  search: LocalSearchService;
  journalConfigured: boolean;
  researchConfigured: boolean;
  playbookExecutionConfigured: boolean;
  idempotency: Phase4IdempotencyStore;
}

export interface Phase4ApiResult {
  status: number;
  body: Record<string, unknown>;
}

let defaultRuntime: Phase4ApiRuntime | undefined;

export function getPhase4ApiRuntime(): Phase4ApiRuntime {
  if (defaultRuntime) return defaultRuntime;
  const local = getEdithPersistenceStore();
  const persistence = new JsonPhase4Persistence(local.getPaths().dataDir);
  persistence.initialize();
  const journal = new ResearchJournalService(() => {
    const status = obsidianProviderConfigService.status();
    return status.state === 'READY' && status.writable ? obsidianProviderConfigService.provider() : undefined;
  });
  const acquisition = new BoundedResearchAcquisitionWorker();
  const execution = new RegistryPlaybookExecutionAdapter();
  defaultRuntime = {
    persistence,
    research: new ResearchService(persistence, [acquisition], acquisition.resolver, journal),
    playbooks: new PlaybookService(persistence, execution, execution),
    search: new LocalSearchService(local, persistence),
    get journalConfigured() {
      const status = obsidianProviderConfigService.status();
      return status.state === 'READY' && status.writable;
    },
    researchConfigured: acquisition.available,
    playbookExecutionConfigured: execution.available,
    idempotency: new Phase4IdempotencyStore(path.join(local.getPaths().dataDir, 'phase4-idempotency.sqlite')),
  };
  return defaultRuntime;
}

export function correlationId(req: Request): string {
  const supplied = req.get('x-correlation-id');
  return supplied && /^[A-Za-z0-9._:-]{1,128}$/.test(supplied) ? supplied : `corr-${randomUUID()}`;
}

export function idempotencyKey(req: Request): string | undefined {
  const value = req.get('x-idempotency-key');
  return value && /^[A-Za-z0-9._:-]{8,160}$/.test(value) ? value : undefined;
}

function redactLocalPaths(value: string): string {
  // Consume complete HTTP URLs before considering a drive-letter path: the s:/
  // inside https:// is not a local path. Preserve safe URI spelling/provenance.
  return value.replace(/https?:\/\/[^\s`"'<>]+|(?:[A-Za-z]:[\\/]|\\\\)[^\s`"'<>)]+|\/(?:Users|home|var|tmp|etc|opt|usr|srv|mnt|media|root|run|private|Volumes|workspace|data)\/(?:[^\s`"'<>)]+)?/gi, (match) => {
    if (!/^https?:\/\//i.test(match)) return '[REDACTED_LOCAL_PATH]';
    let url: URL;
    try { url = new URL(match); } catch { return '[REDACTED_INVALID_URL]'; }
    const sensitiveKey = /^(?:token|access_token|refresh_token|api[_-]?key|apikey|key|signature|secret|password|credential|authorization|cookie)$/i;
    const localValue = /(?:^|[\s("'=])(?:[A-Za-z]:[\\/]|\\\\)|^\/(?:Users|home|var|tmp|etc|opt|usr|srv|mnt|media|root|run|private|Volumes|workspace|data)(?:\/|$)/i;
    if (url.username || url.password || [...url.searchParams].some(([key, item]) => sensitiveKey.test(key) || localValue.test(item)
      || sanitizeSensitiveValue(item) !== item || /https?:\/\/[^\s/]*@/i.test(item))) return '[REDACTED_SENSITIVE_URL]';
    let fragment: string;
    try { fragment = decodeURIComponent(url.hash.slice(1)); } catch { return '[REDACTED_INVALID_URL]'; }
    if (localValue.test(fragment) || sanitizeSensitiveValue(fragment) !== fragment) return '[REDACTED_SENSITIVE_URL]';
    return match;
  });
}

export function redactPhase4Payload<T>(value: T): T {
  const sanitized = sanitizeSensitiveValue(value);
  const visit = (item: unknown): unknown => {
    if (typeof item === 'string') return redactLocalPaths(item);
    if (Array.isArray(item)) return item.map(visit);
    if (!item || typeof item !== 'object') return item;
    return Object.fromEntries(Object.entries(item as Record<string, unknown>).map(([key, entry]) => [key, visit(entry)]));
  };
  return visit(sanitized) as T;
}

function containsSensitiveMutationValue(value: unknown): boolean {
  if (typeof value === 'string') {
    try {
      const url = new URL(value);
      if (url.protocol === 'http:' || url.protocol === 'https:') return false;
    } catch { /* not a URL */ }
    return redactPhase4Payload(value) !== value;
  }
  if (Array.isArray(value)) return value.some(containsSensitiveMutationValue);
  if (!value || typeof value !== 'object') return false;
  return Object.values(value as Record<string, unknown>).some(containsSensitiveMutationValue);
}

export function successEnvelope(req: Request, data: unknown, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return redactPhase4Payload({ success: true, contract: PHASE4_API_CONTRACT, correlationId: correlationId(req), data, ...extra });
}

export function errorEnvelope(req: Request, errorCode: string, safeMessage: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return redactPhase4Payload({ success: false, contract: PHASE4_API_CONTRACT, correlationId: correlationId(req), errorCode, safeMessage, ...extra });
}

export function validatePublicPayload(value: unknown): { success: true } | { success: false; errorCode: string; safeMessage: string } {
  const secretCheck = validateNoSecretMaterial(value);
  if (secretCheck.success === false) return { success: false, errorCode: secretCheck.errorCode, safeMessage: 'Secret-bearing fields are not accepted by this API.' };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { success: false, errorCode: 'INVALID_PAYLOAD', safeMessage: 'A JSON object payload is required.' };
  if (containsSensitiveMutationValue(value)) {
    return { success: false, errorCode: 'SENSITIVE_PAYLOAD_FORBIDDEN', safeMessage: 'Secret-bearing values and local filesystem paths are not accepted by this API.' };
  }
  return { success: true };
}

export async function executeIdempotent(
  req: Request,
  runtime: Phase4ApiRuntime,
  scope: string,
  operation: () => Promise<Phase4ApiResult>,
): Promise<{ replayed: boolean; result: Phase4ApiResult } | { errorCode: 'IDEMPOTENCY_KEY_REQUIRED' | 'IDEMPOTENCY_KEY_REUSED' }> {
  const key = idempotencyKey(req);
  if (!key) return { errorCode: 'IDEMPOTENCY_KEY_REQUIRED' };
  const owner = getOwnerSession(req);
  if (!owner) return { errorCode: 'IDEMPOTENCY_KEY_REQUIRED' };
  // The local application has one authenticated owner. A fresh authenticated session
  // may read a prior result after restart; it never inherits authority to rerun it.
  let pending: ReturnType<Phase4IdempotencyStore['execute']>;
  try { pending = runtime.idempotency.execute(`${owner.actor}:${scope}`, key, req.body, async () => {
    try { return await operation(); }
    catch (error) {
      const message = error instanceof Error ? error.message : '';
      const code = message.includes('kill switch') ? 'KILL_SWITCH_ACTIVE' : message.includes('OWNER_SESSION_REQUIRED') ? 'OWNER_SESSION_REQUIRED' : 'PRODUCER_EXECUTION_FAILED';
      return { status: code === 'OWNER_SESSION_REQUIRED' ? 401 : code === 'KILL_SWITCH_ACTIVE' ? 423 : 500,
        body: errorEnvelope(req, code, 'Execution stopped. Review persisted task and artifact evidence before another attempt.') };
    }
  }); } catch {
    return { replayed: false, result: { status: 503, body: errorEnvelope(req, 'DURABLE_STORE_UNAVAILABLE', 'The durable request store could not reserve execution. No new operation was started.') } };
  }
  if (!pending) return { errorCode: 'IDEMPOTENCY_KEY_REUSED' };
  try { return { replayed: pending.replayed, result: await pending.result }; }
  catch { return { replayed: pending.replayed, result: { status: 409, body: errorEnvelope(req, 'IDEMPOTENCY_OUTCOME_UNKNOWN', 'Execution evidence must be reconciled before another attempt.') } }; }
}
