export const LOCAL_SEARCH_SCOPES = ['task', 'memory', 'knowledge', 'research', 'playbook'] as const;
export type LocalSearchScope = typeof LOCAL_SEARCH_SCOPES[number];
export interface LocalSearchResult {
  id: string;
  scope: LocalSearchScope;
  title: string;
  summary: string;
  score: number;
  matchedFields: string[];
  metadata: Record<string, string | number | boolean | string[]>;
  provenance: {
    source: 'edith_local_store' | 'phase4_store';
    recordType: 'EdithTask' | 'MemoryItem' | 'KnowledgeGraphNode' | 'ResearchRunV2' | 'PlaybookDefinitionV2';
    recordId: string;
    retrievedAt: string;
  };
}
export interface LocalSearchData {
  results: LocalSearchResult[];
  limit: number;
  scopes: LocalSearchScope[];
  correlationId: string;
}
export class LocalSearchClientError extends Error {
  constructor(readonly code: string) { super(`Yerel arama tamamlanamadı (${code}).`); this.name = 'LocalSearchClientError'; }
}
const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(v);
const id = (v: unknown): v is string => text(v, 4096) && !!v.trim() && !/[\r\n\t]/.test(v);
const scope = (v: unknown): v is LocalSearchScope => typeof v === 'string' && LOCAL_SEARCH_SCOPES.includes(v as LocalSearchScope);
const correlation = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(v);
const mappings = {
  task: { source: 'edith_local_store', recordType: 'EdithTask', fields: ['title', 'objective', 'status'] },
  memory: { source: 'edith_local_store', recordType: 'MemoryItem', fields: ['key', 'value', 'category'] },
  knowledge: { source: 'edith_local_store', recordType: 'KnowledgeGraphNode', fields: ['title', 'type', 'tags'] },
  research: { source: 'phase4_store', recordType: 'ResearchRunV2', fields: ['title', 'claims', 'status', 'mode'] },
  playbook: { source: 'phase4_store', recordType: 'PlaybookDefinitionV2', fields: ['title', 'steps', 'id'] },
} as const;
function scopesInput(scopes: readonly LocalSearchScope[]): LocalSearchScope[] {
  if (!Array.isArray(scopes) || !scopes.length || scopes.length > 5 || !scopes.every(scope)) throw new LocalSearchClientError('INVALID_SEARCH_SCOPES');
  return [...new Set(scopes)];
}
function row(value: unknown, scopes: readonly LocalSearchScope[]): LocalSearchResult {
  const fail = (): never => { throw new LocalSearchClientError('LOCAL_SEARCH_RESULT_INVALID'); };
  if (!record(value) || !exact(value, ['id', 'scope', 'title', 'summary', 'score', 'matchedFields', 'metadata', 'provenance'])
    || !scope(value.scope) || !scopes.includes(value.scope) || !id(value.id)
    || !text(value.title, 10000) || !text(value.summary, 1000)
    || typeof value.score !== 'number' || !Number.isSafeInteger(value.score) || value.score < 1
    || !Array.isArray(value.matchedFields) || !value.matchedFields.length || value.matchedFields.length > 4
    || !value.matchedFields.every(f => typeof f === 'string' && (mappings[value.scope as LocalSearchScope].fields as readonly string[]).includes(f))
    || new Set(value.matchedFields).size !== value.matchedFields.length || !record(value.metadata) || !record(value.provenance)) return fail();
  const provenance = value.provenance;
  const expected = mappings[value.scope];
  if (!exact(provenance, ['source', 'recordType', 'recordId', 'retrievedAt']) || provenance.source !== expected.source
    || provenance.recordType !== expected.recordType || !id(provenance.recordId) || value.id !== `${value.scope}:${provenance.recordId}`
    || typeof provenance.retrievedAt !== 'string' || !Number.isFinite(Date.parse(provenance.retrievedAt))
    || new Date(provenance.retrievedAt).toISOString() !== provenance.retrievedAt) return fail();
  if (Object.keys(value.metadata).length > 32 || !Object.entries(value.metadata).every(([key, item]) =>
    /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key) && !/(?:__proto__|prototype|constructor|api[_-]?key|token|secret|password|authorization|credential|private[_-]?key|cookie|webhook[_-]?url)/i.test(key)
    && (text(item, 10000) || typeof item === 'boolean' || typeof item === 'number' && Number.isFinite(item)
      || Array.isArray(item) && item.length <= 256 && item.every(s => text(s, 10000))))) return fail();
  if (value.scope === 'memory' && value.metadata.sensitivity === 'sensitive') return fail();
  // IDs/provenance are display association only. No URL, command or completion authority is inferred.
  return value as unknown as LocalSearchResult;
}
export function parseLocalSearchResponse(value: unknown, requestedScopes: readonly LocalSearchScope[] = LOCAL_SEARCH_SCOPES): LocalSearchData {
  const requested = scopesInput(requestedScopes);
  if (!record(value) || value.success !== true || !record(value.contract) || value.contract.schema !== 'edith.shared'
    || value.contract.version !== 2 || value.contract.amendment !== '2.1' || !correlation(value.correlationId)
    || !record(value.data) || !exact(value.data, ['results', 'limit', 'scopes'])) throw new LocalSearchClientError('LOCAL_SEARCH_ENVELOPE_INVALID');
  const data = value.data;
  if (data.limit !== 25 || !Array.isArray(data.scopes) || data.scopes.length !== requested.length
    || !data.scopes.every((s, i) => s === requested[i]) || !Array.isArray(data.results) || data.results.length > 25) throw new LocalSearchClientError('LOCAL_SEARCH_RESPONSE_INVALID');
  const results = data.results.map(v => row(v, requested));
  if (new Set(results.map(r => r.id)).size !== results.length) throw new LocalSearchClientError('LOCAL_SEARCH_RESULT_INVALID');
  return { results, limit: 25, scopes: requested, correlationId: value.correlationId };
}
export async function fetchLocalSearch(query: string, scopes: readonly LocalSearchScope[] = LOCAL_SEARCH_SCOPES, signal?: AbortSignal): Promise<LocalSearchData> {
  if (typeof query !== 'string') throw new LocalSearchClientError('INVALID_SEARCH_QUERY');
  const normalized = query.normalize('NFKC').trim();
  if (!normalized || normalized.length > 500 || normalized.split(/\s+/).length > 32) throw new LocalSearchClientError('INVALID_SEARCH_QUERY');
  const requested = scopesInput(scopes);
  signal?.throwIfAborted();
  const requestCorrelation = `search-${crypto.randomUUID()}`;
  const params = new URLSearchParams({ query: normalized, scopes: requested.join(','), limit: '25' });
  const response = await fetch(`/api/edith/search?${params}`, { method: 'GET', credentials: 'include', signal,
    headers: { Accept: 'application/json', 'x-correlation-id': requestCorrelation } });
  signal?.throwIfAborted();
  // Authentication/runtime errors are not guaranteed to carry a phase4 JSON envelope.
  if (!response.ok) throw new LocalSearchClientError(`LOCAL_SEARCH_HTTP_${response.status}`);
  let value: unknown;
  try { value = await response.json(); } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new LocalSearchClientError('LOCAL_SEARCH_RESPONSE_MALFORMED');
  }
  signal?.throwIfAborted();
  const parsed = parseLocalSearchResponse(value, requested);
  if (parsed.correlationId !== requestCorrelation) throw new LocalSearchClientError('LOCAL_SEARCH_REQUEST_MISMATCH');
  return parsed;
}
