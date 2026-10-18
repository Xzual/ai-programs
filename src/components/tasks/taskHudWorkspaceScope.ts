import {TaskContractError} from '../../edith/taskActivityClient';
import {hudSafeId} from '../../edith/taskHudContracts';

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const ownValue = (value: Record<string, unknown>, key: string): unknown => Object.getOwnPropertyDescriptor(value, key)?.value;

/** Context correlation only, never authorization. Retain the ID alone; no raw
 * configuration, paths or cloud/vault metadata escape this projection. */
export function parseTaskHudWorkspaceId(value: unknown): string | undefined {
  const invalid = () => new TaskContractError('Çalışma alanı bağlamı doğrulanamadı.', 'TASK_HUD_WORKSPACE_INVALID');
  if (!record(value) || ownValue(value, 'success') !== true || typeof ownValue(value, 'configured') !== 'boolean') throw invalid();
  if (ownValue(value, 'configured') === false) return undefined;
  const config = ownValue(value, 'config');
  if (!record(config)) throw invalid();
  const id = ownValue(config, 'workspaceId');
  if (!hudSafeId(id)) throw invalid();
  return id;
}

export async function fetchTaskHudWorkspaceId(signal?: AbortSignal): Promise<string | undefined> {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const response = await fetch('/api/workspace/status', {credentials: 'include', signal, cache: 'no-store', headers: {Accept: 'application/json'}});
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  if (!response.ok) throw new TaskContractError('Çalışma alanı bağlamı alınamadı.', `TASK_HTTP_${response.status}`);
  let body: unknown;
  try {body = await response.json();}
  catch {if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');throw new TaskContractError('Çalışma alanı bağlamı doğrulanamadı.', 'TASK_HUD_WORKSPACE_INVALID');}
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  return parseTaskHudWorkspaceId(body);
}
