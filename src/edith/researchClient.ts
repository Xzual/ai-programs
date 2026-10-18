import { parseResearchRunV2, type ResearchRunV2 } from './contracts';
import { ownerMutationFetch } from './ownerMutationClient';
export class ResearchClientError extends Error { constructor(readonly code: string, readonly run?: ResearchRunV2) { super(`Araştırma işlemi tamamlanamadı (${code}).`); } }
const run = (value: unknown): ResearchRunV2 => { const parsed = parseResearchRunV2(value); if (!parsed.success) throw new ResearchClientError('RESEARCH_RESPONSE_INVALID'); return parsed.value; };
async function json(response: Response): Promise<Record<string, any>> {
  const row = await response.json().catch(() => null);
  if (!row || row.contract?.schema !== 'edith.shared' || row.contract?.version !== 2 || row.contract?.amendment !== '2.1') throw new ResearchClientError('RESEARCH_ENVELOPE_INVALID');
  if (!response.ok || row.success !== true) throw new ResearchClientError(/^[A-Z0-9_]+$/.test(row.errorCode ?? '') ? row.errorCode : `RESEARCH_HTTP_${response.status}`, row.data?.run ? run(row.data.run) : undefined);
  if (!row.data || typeof row.data !== 'object' || Array.isArray(row.data)) throw new ResearchClientError('RESEARCH_ENVELOPE_INVALID');
  return row.data;
}
export async function listResearch(signal?: AbortSignal): Promise<ResearchRunV2[]> {
  const data = await json(await fetch('/api/edith/research?limit=25', { credentials: 'include', signal }));
  if (!Array.isArray(data?.runs) || data.runs.length > 25) throw new ResearchClientError('RESEARCH_RESPONSE_INVALID'); return data.runs.map(run);
}
export async function getResearch(runId: string, signal?: AbortSignal): Promise<ResearchRunV2> {
  try {
    const data = await json(await fetch(`/api/edith/research/${encodeURIComponent(runId)}`, { credentials: 'include', signal }));
    const result = run(data?.run);
    if (result.runId !== runId) throw new ResearchClientError('RESEARCH_REQUEST_MISMATCH');
    return result;
  } catch (error) {
    // Error envelopes may also contain a run; never expose another requested record through that path.
    if (error instanceof ResearchClientError && error.run && error.run.runId !== runId) throw new ResearchClientError('RESEARCH_REQUEST_MISMATCH');
    throw error;
  }
}
export async function executeResearch(query: string, mode: 'FAST' | 'DEEP' | 'BROWSER', seedUrls: string[], priorRunId?: string) {
  if (!query.trim() || query.length > 2000 || seedUrls.length > 3) throw new ResearchClientError('INVALID_RESEARCH_QUERY');
  const data = await json(await ownerMutationFetch(priorRunId ? `/api/edith/research/${encodeURIComponent(priorRunId)}/run` : '/api/edith/research/run', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-idempotency-key': `research.${crypto.randomUUID()}` }, body: JSON.stringify({ query: query.trim(), mode, seedUrls }),
  }));
  const measurement = data?.measurements;
  return { run: run(data?.run), measurements: measurement && ['acquisitionCalls', 'retrievedBytes', 'modelCalls'].every(k => Number.isSafeInteger(measurement[k]) && measurement[k] >= 0) && typeof measurement.fixture === 'boolean' ? measurement as { acquisitionCalls: number; retrievedBytes: number; modelCalls: number; fixture: boolean } : undefined };
}
export async function exportResearch(runId: string): Promise<string> {
  const response = await fetch(`/api/edith/research/${encodeURIComponent(runId)}/export.txt`, { credentials: 'include' });
  if (!response.ok || !response.headers.get('content-type')?.startsWith('text/plain')) throw new ResearchClientError(`RESEARCH_EXPORT_HTTP_${response.status}`); return response.text();
}
