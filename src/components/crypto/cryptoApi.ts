import { ownerMutationFetch } from '../../edith/ownerMutationClient';

export type Json = Record<string, any>;
export const record = (value: unknown): value is Json => value !== null && typeof value === 'object' && !Array.isArray(value);
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Keep the legacy aliases available while treating the new data envelope as canonical.
export function cryptoData(body: Json): Json {
  return record(body.data) ? { ...body, ...body.data, ok: body.ok, meta: body.meta } : body;
}

export class CryptoApiError extends Error {
  constructor(public body: Json, public status: number) {
    super(typeof body.safeMessage === 'string' ? body.safeMessage : 'Crypto yanıtı doğrulanamadı.');
  }
}

export async function api(path: string, init?: RequestInit): Promise<Json> {
  const signal = init?.signal
    ? AbortSignal.any([init.signal, AbortSignal.timeout(20000)])
    : AbortSignal.timeout(20000);
  const method = (init?.method ?? 'GET').toUpperCase();
  const request = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) ? ownerMutationFetch : fetch;
  const response = await request(path, { ...init, signal, cache: 'no-store' });
  const raw = await response.json().catch(() => { throw new Error('INVALID_RESPONSE'); });
  if (!record(raw)) throw new Error('INVALID_RESPONSE');
  const body = cryptoData(raw);
  if (!response.ok || body.ok === false || body.success === false) throw new CryptoApiError(body, response.status);
  return response.status === 202 ? { ...body, status: 'pending' } : body;
}

export function freshness(value: Json, now: number, maxAgeMs = 15000) {
  const timestamp = value.currentPriceTimestamp ?? value.portfolioValuationTimestamp ?? value.marketPriceTimestamp ?? value.updatedAt;
  const parsed = typeof timestamp === 'string' ? Date.parse(timestamp) : NaN;
  const reportedAge = typeof value.marketDataAgeMs === 'number' ? value.marketDataAgeMs : value.oldestPriceAgeMs;
  const age = Number.isFinite(parsed) ? Math.max(0, now - parsed, Number.isFinite(reportedAge) ? reportedAge : 0) : null;
  const declared = value.marketDataStatus ?? value.valuationStatus;
  const status = declared === 'unavailable' ? 'unavailable'
    : declared === 'stale' || value.stale === true || (age !== null && age > maxAgeMs) ? 'stale'
      : age !== null && (declared === 'fresh' || value.fresh === true) ? 'fresh' : 'unavailable';
  return { status, age, timestamp };
}
