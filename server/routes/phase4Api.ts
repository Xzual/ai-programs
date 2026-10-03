import { createHash, randomUUID } from 'node:crypto';
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

interface IdempotencyEntry {
  fingerprint: string;
  result: Promise<Phase4ApiResult>;
}

export class Phase4IdempotencyStore {
  private readonly entries = new Map<string, IdempotencyEntry>();

  execute(scope: string, key: string, body: unknown, operation: () => Promise<Phase4ApiResult>): { replayed: boolean; result: Promise<Phase4ApiResult> } | undefined {
    const fingerprint = createHash('sha256').update(JSON.stringify(body ?? null)).digest('hex');
    const compound = `${scope}:${key}`;
    const existing = this.entries.get(compound);
    if (existing) {
      if (existing.fingerprint !== fingerprint) return undefined;
      return { replayed: true, result: existing.result };
    }
    const result = operation().catch((error) => {
      this.entries.delete(compound);
      throw error;
    });
    this.entries.set(compound, { fingerprint, result });
    return { replayed: false, result };
  }
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
  defaultRuntime = {
    persistence,
    research: new ResearchService(persistence, [], undefined, journal),
    playbooks: new PlaybookService(persistence),
    search: new LocalSearchService(local, persistence),
    get journalConfigured() {
      const status = obsidianProviderConfigService.status();
      return status.state === 'READY' && status.writable;
    },
    researchConfigured: false,
    playbookExecutionConfigured: false,
    idempotency: new Phase4IdempotencyStore(),
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
  return value
    .replace(/(?:[A-Za-z]:[\\/]|\\\\)(?:[^\s`"']+[\\/])+[^\s`"']*/g, '[REDACTED_LOCAL_PATH]')
    .replace(/\/(?:Users|home|var|tmp|etc)\/(?:[^\s`"']+\/)*[^\s`"']*/g, '[REDACTED_LOCAL_PATH]');
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
  const pending = runtime.idempotency.execute(scope, key, req.body, operation);
  if (!pending) return { errorCode: 'IDEMPOTENCY_KEY_REUSED' };
  return { replayed: pending.replayed, result: await pending.result };
}
