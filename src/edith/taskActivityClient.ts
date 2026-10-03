import type { EdithTask } from './core';
import {
  EDITH_CONTRACT_SCHEMA,
  EDITH_CONTRACT_VERSION,
  parseTaskEventV2,
  parseTaskStatus,
  validateNoSecretMaterial,
  type TaskEventV2,
  type TaskProgressSnapshot,
  type TaskV2Metadata,
  type TypedTaskEventV2,
} from './contracts';

export type TaskSurfaceState = 'loading' | 'ready' | 'empty' | 'offline' | 'error' | 'reconnecting';

export type TaskV2View = EdithTask & TaskV2Metadata & { progress: TaskProgressSnapshot };

export interface TaskActivityV2View {
  task: TaskV2View;
  events: TypedTaskEventV2[];
  progress: TaskProgressSnapshot;
}

export class TaskContractError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'TaskContractError';
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const finiteInteger = (value: unknown, minimum = 0) =>
  typeof value === 'number' && Number.isInteger(value) && Number.isFinite(value) && value >= minimum;

const TERMINAL_STATUSES = new Set(['COMPLETED', 'FAILED', 'CANCELLED', 'ROLLED_BACK']);
const TASK_PRIORITIES = new Set(['low', 'normal', 'high', 'urgent']);
const PLAN_STEP_STATUSES = new Set(['PENDING', 'READY', 'RUNNING', 'COMPLETED', 'FAILED', 'SKIPPED']);

function requireV2Envelope(value: unknown): Record<string, unknown> {
  if (!isRecord(value) || !isRecord(value.contract) || !isRecord(value.data)) {
    throw new TaskContractError('Görev servisi geçerli bir V2 zarfı döndürmedi.', 'TASK_V2_ENVELOPE_REQUIRED');
  }
  if (value.contract.schema !== EDITH_CONTRACT_SCHEMA || value.contract.version !== EDITH_CONTRACT_VERSION) {
    throw new TaskContractError('Görev servisi desteklenmeyen bir sözleşme sürümü döndürdü.', 'TASK_V2_VERSION_UNSUPPORTED');
  }
  return value.data;
}

function parseProgress(value: unknown, taskId: string, revision: number, taskStatus: string): TaskProgressSnapshot {
  if (!isRecord(value)) throw new TaskContractError('Görev ilerleme anlık görüntüsü eksik.', 'TASK_PROGRESS_REQUIRED');
  const status = parseTaskStatus(value.status);
  const validSources = new Set(['task_status', 'plan_steps', 'verification', 'recovery']);
  const verification = value.verificationStatus;
  if (
    value.contractVersion !== 2 || value.taskId !== taskId || value.revision !== revision || !status.success
    || status.value !== taskStatus || value.terminal !== TERMINAL_STATUSES.has(status.value)
    || !finiteInteger(value.percent) || Number(value.percent) > 100
    || !finiteInteger(value.completedSteps) || !finiteInteger(value.totalSteps)
    || !finiteInteger(value.failedSteps) || !finiteInteger(value.recoveryAttempts)
    || typeof value.terminal !== 'boolean' || !Array.isArray(value.sources)
    || !value.sources.every((source) => typeof source === 'string' && validSources.has(source))
    || (verification !== undefined && !['PASS', 'FAIL', 'PARTIAL', 'RETRYABLE'].includes(String(verification)))
  ) {
    throw new TaskContractError('Görev ilerleme verisi V2 sözleşmesiyle eşleşmiyor.', 'TASK_PROGRESS_INVALID');
  }
  return value as unknown as TaskProgressSnapshot;
}

function parseTask(value: unknown): TaskV2View {
  if (!isRecord(value) || validateNoSecretMaterial(value).success === false) {
    throw new TaskContractError('Görev kaydı güvenli veya geçerli değil.', 'TASK_RECORD_INVALID');
  }
  const status = parseTaskStatus(value.status);
  if (
    !status.success || typeof value.id !== 'string' || !value.id.trim()
    || typeof value.title !== 'string' || !value.title.trim()
    || typeof value.objective !== 'string' || !TASK_PRIORITIES.has(String(value.priority))
    || value.contractVersion !== 2 || !finiteInteger(value.revision, 1)
    || !finiteInteger(value.eventSequence)
  ) {
    throw new TaskContractError('Görev kaydı zorunlu V2 alanlarını taşımıyor.', 'TASK_RECORD_INVALID');
  }
  if (value.plan !== undefined) {
    if (!isRecord(value.plan) || !Array.isArray(value.plan.steps) || !value.plan.steps.every((step) =>
      isRecord(step) && typeof step.id === 'string' && Boolean(step.id.trim())
      && typeof step.title === 'string' && Boolean(step.title.trim())
      && PLAN_STEP_STATUSES.has(String(step.status))
      && typeof step.riskLevel === 'number' && Number.isFinite(step.riskLevel)
    )) {
      throw new TaskContractError('Görev planı görüntüleme için geçerli yapılandırılmış adımlar taşımıyor.', 'TASK_PLAN_INVALID');
    }
  }
  const progress = parseProgress(value.progress, value.id, value.revision as number, status.value);
  return { ...(value as unknown as EdithTask & TaskV2Metadata), status: status.value, progress };
}

export function parseTaskListV2(value: unknown): TaskV2View[] {
  const data = requireV2Envelope(value);
  if (!Array.isArray(data.tasks)) {
    throw new TaskContractError('V2 görev listesi eksik.', 'TASK_LIST_REQUIRED');
  }
  return data.tasks.map(parseTask);
}

export function parseTaskActivityV2(value: unknown): TaskActivityV2View {
  const data = requireV2Envelope(value);
  const task = parseTask({ ...(isRecord(data.task) ? data.task : {}), progress: data.progress });
  if (!Array.isArray(data.events)) {
    throw new TaskContractError('V2 activity event listesi eksik.', 'TASK_EVENTS_REQUIRED');
  }
  const events = data.events.map((event): TypedTaskEventV2 => {
    const parsed = parseTaskEventV2(event);
    if (parsed.success === false) throw new TaskContractError(parsed.message, parsed.errorCode);
    if (parsed.value.taskId !== task.id) {
      throw new TaskContractError('Activity event farklı bir göreve ait.', 'TASK_EVENT_TASK_MISMATCH');
    }
    if (parsed.value.sequence > task.eventSequence || parsed.value.revision > task.revision) {
      throw new TaskContractError('Activity event görev anlık görüntüsünden daha ileri bir revision taşıyor.', 'TASK_EVENT_AHEAD_OF_SNAPSHOT');
    }
    return parsed.value;
  });
  return { task, progress: task.progress, events };
}

async function readJson(response: Response): Promise<unknown> {
  if (!response.ok) {
    throw new TaskContractError(`Görev servisi HTTP ${response.status} döndürdü.`, `TASK_HTTP_${response.status}`);
  }
  try {
    return await response.json();
  } catch {
    throw new TaskContractError('Görev servisi okunabilir JSON döndürmedi.', 'TASK_RESPONSE_MALFORMED');
  }
}

export async function fetchTaskListV2(signal?: AbortSignal): Promise<TaskV2View[]> {
  const response = await fetch('/api/edith/tasks', { signal, headers: { Accept: 'application/json' } });
  return parseTaskListV2(await readJson(response));
}

export async function fetchTaskActivityV2(taskId: string, signal?: AbortSignal): Promise<TaskActivityV2View> {
  const response = await fetch(`/api/edith/tasks/${encodeURIComponent(taskId)}/activity`, {
    signal,
    headers: { Accept: 'application/json' },
  });
  return parseTaskActivityV2(await readJson(response));
}

export function isNetworkTaskError(error: unknown): boolean {
  return error instanceof TypeError
    || (error instanceof DOMException && error.name !== 'AbortError')
    || (error instanceof TaskContractError && ['TASK_HTTP_502', 'TASK_HTTP_503', 'TASK_HTTP_504'].includes(error.code));
}

export function taskErrorMessage(error: unknown): string {
  if (error instanceof TaskContractError) return `${error.message} (${error.code})`;
  return isNetworkTaskError(error)
    ? 'Görev servisine ulaşılamıyor. Mevcut veriler canlı durum olarak gösterilmiyor.'
    : 'Görev görünümü beklenmeyen bir hata nedeniyle güncellenemedi.';
}

export function latestTaskEvent(events: TaskEventV2[]): TaskEventV2 | undefined {
  return [...events].sort((left, right) => right.sequence - left.sequence)[0];
}
