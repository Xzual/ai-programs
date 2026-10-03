import type {
  CapsuleContextSelectionV2,
  CommunicationPolicyV2,
  CompareChangeV2,
  DownloadButlerStatusV2,
  GhostTaskV2,
  HistoryRetentionPolicyV2,
  MissionMemoryV2,
  OrchestrationPlanV2,
  PowerPresenceSnapshotV2,
  PriorityTaskPolicyV2,
  RecentContextEventV2,
  SceneProfileV2,
  ShadowModeV2,
  SmartRetryPlanV2,
  VisualBookmarkV2,
  WatcherV2,
  WorkspaceRestorePlanV2,
  WorkspaceSnapshotV2,
} from './contracts';
import {
  parseCapsuleContextSelectionV2,
  parseCommunicationPolicyV2,
  parseCompareChangeV2,
  parseDownloadButlerStatusV2,
  parseGhostTaskV2,
  parseHistoryRetentionPolicyV2,
  parseMissionMemoryV2,
  parseOrchestrationPlanV2,
  parsePowerPresenceSnapshotV2,
  parsePriorityTaskPolicyV2,
  parseRecentContextEventV2,
  parseSceneProfileV2,
  parseShadowModeV2,
  parseSmartRetryPlanV2,
  parseVisualBookmarkV2,
  parseWatcherV2,
  parseWorkspaceRestorePlanV2,
  parseWorkspaceSnapshotV2,
} from './contracts';
import { ownerMutationFetch } from './ownerMutationClient';

export interface AdvancedCapabilityStatus {
  persistence: 'memory_only';
  restartRecovery: 'partial';
  nativeExecution: string;
  scheduler: string;
  watcherObservation: string;
  watcherDelivery: string;
  mobileRead: string;
  secretsStored: false;
}

export interface AdvancedExperienceState {
  priority: PriorityTaskPolicyV2[];
  shadow: ShadowModeV2[];
  ghosts: GhostTaskV2[];
  'mission-memories': MissionMemoryV2[];
  bookmarks: VisualBookmarkV2[];
  'recent-context': RecentContextEventV2[];
  snapshots: WorkspaceSnapshotV2[];
  'restore-plans': WorkspaceRestorePlanV2[];
  scenes: SceneProfileV2[];
  watchers: WatcherV2[];
  comparisons: CompareChangeV2[];
  communication: CommunicationPolicyV2[];
  orchestration: OrchestrationPlanV2[];
  retries: SmartRetryPlanV2[];
  downloads: DownloadButlerStatusV2[];
  'power-presence': PowerPresenceSnapshotV2[];
  'history-policy': HistoryRetentionPolicyV2[];
  'capsule-selection': CapsuleContextSelectionV2[];
}

export interface AdvancedExperienceSnapshot {
  workspaceId: string;
  status: AdvancedCapabilityStatus;
  state: AdvancedExperienceState;
}

export class AdvancedExperienceClientError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'AdvancedExperienceClientError';
  }
}

type Parser<T> = (value: unknown) => { success: true; value: T } | { success: false; errorCode: string; message: string };

const RESOURCE_PARSERS: { [K in keyof AdvancedExperienceState]: Parser<AdvancedExperienceState[K][number]> } = {
  priority: parsePriorityTaskPolicyV2,
  shadow: parseShadowModeV2,
  ghosts: parseGhostTaskV2,
  'mission-memories': parseMissionMemoryV2,
  bookmarks: parseVisualBookmarkV2,
  'recent-context': parseRecentContextEventV2,
  snapshots: parseWorkspaceSnapshotV2,
  'restore-plans': parseWorkspaceRestorePlanV2,
  scenes: parseSceneProfileV2,
  watchers: parseWatcherV2,
  comparisons: parseCompareChangeV2,
  communication: parseCommunicationPolicyV2,
  orchestration: parseOrchestrationPlanV2,
  retries: parseSmartRetryPlanV2,
  downloads: parseDownloadButlerStatusV2,
  'power-presence': parsePowerPresenceSnapshotV2,
  'history-policy': parseHistoryRetentionPolicyV2,
  'capsule-selection': parseCapsuleContextSelectionV2,
};

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function capabilityStatus(value: unknown): AdvancedCapabilityStatus {
  const row = object(value);
  if (!row || row.persistence !== 'memory_only' || row.restartRecovery !== 'partial' || row.secretsStored !== false) {
    throw new AdvancedExperienceClientError('ADVANCED_STATUS_INVALID', 'Advanced capability truth could not be verified.');
  }
  const required = ['nativeExecution', 'scheduler', 'watcherObservation', 'watcherDelivery', 'mobileRead'] as const;
  if (required.some((key) => typeof row[key] !== 'string')) {
    throw new AdvancedExperienceClientError('ADVANCED_STATUS_INVALID', 'Advanced capability truth is incomplete.');
  }
  return row as unknown as AdvancedCapabilityStatus;
}

function parseState(value: unknown, workspaceId: string): AdvancedExperienceState {
  const row = object(value);
  if (!row) throw new AdvancedExperienceClientError('ADVANCED_STATE_INVALID', 'Advanced state is malformed.');
  const output = {} as AdvancedExperienceState;
  for (const key of Object.keys(RESOURCE_PARSERS) as Array<keyof AdvancedExperienceState>) {
    const records = row[key];
    if (!Array.isArray(records)) throw new AdvancedExperienceClientError('ADVANCED_STATE_INVALID', `Advanced resource ${key} is missing.`);
    const parser = RESOURCE_PARSERS[key] as Parser<AdvancedExperienceState[typeof key][number]>;
    const parsed = records.map((record) => parser(record));
    const invalid = parsed.find((result) => !result.success);
    if (invalid && 'errorCode' in invalid) throw new AdvancedExperienceClientError(invalid.errorCode, invalid.message);
    const values = parsed.filter((result): result is { success: true; value: AdvancedExperienceState[typeof key][number] } => result.success).map((result) => result.value);
    if (values.some((record) => record.workspaceId !== workspaceId)) {
      throw new AdvancedExperienceClientError('ADVANCED_WORKSPACE_MISMATCH', 'Advanced state crossed the active workspace boundary.');
    }
    (output[key] as AdvancedExperienceState[typeof key]) = values as AdvancedExperienceState[typeof key];
  }
  return output;
}

async function json(response: Response): Promise<Record<string, unknown>> {
  const payload = await response.json().catch(() => null);
  const row = object(payload);
  if (!row) throw new AdvancedExperienceClientError('ADVANCED_RESPONSE_INVALID', 'Advanced response is malformed.');
  if (!response.ok || row.success !== true) {
    const reportedCode = String(row.errorCode ?? row.code ?? row.error ?? `HTTP_${response.status}`).toUpperCase();
    const code = response.status === 401 || reportedCode === 'OWNER_SESSION_REQUIRED' ? 'OWNER_SESSION_REQUIRED' : reportedCode;
    throw new AdvancedExperienceClientError(code, String(row.safeMessage ?? 'Advanced request was rejected.'));
  }
  return row;
}

export async function resolveAdvancedWorkspace(signal?: AbortSignal): Promise<string> {
  const response = await fetch('/api/workspace/status', { credentials: 'include', signal, headers: { Accept: 'application/json' } });
  const payload = await json(response);
  const config = object(payload.config);
  const workspaceId = typeof config?.workspaceId === 'string' ? config.workspaceId : undefined;
  if (!workspaceId) throw new AdvancedExperienceClientError('WORKSPACE_CONFIGURATION_REQUIRED', 'Configure a local workspace before loading advanced state.');
  return workspaceId;
}

export async function fetchAdvancedExperience(signal?: AbortSignal): Promise<AdvancedExperienceSnapshot> {
  const workspaceId = await resolveAdvancedWorkspace(signal);
  const response = await fetch(`/api/edith/advanced/state?workspaceId=${encodeURIComponent(workspaceId)}`, {
    credentials: 'include', signal, headers: { Accept: 'application/json' },
  });
  const payload = await json(response);
  return { workspaceId, status: capabilityStatus(payload.status), state: parseState(payload.state, workspaceId) };
}

async function mutate(path: string, workspaceId: string, init: RequestInit): Promise<Record<string, unknown>> {
  const separator = path.includes('?') ? '&' : '?';
  const response = await ownerMutationFetch(`${path}${separator}workspaceId=${encodeURIComponent(workspaceId)}`, {
    ...init,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...init.headers },
  });
  return json(response);
}

export async function setPriority(workspaceId: string, policy: PriorityTaskPolicyV2, priority: PriorityTaskPolicyV2['priority']): Promise<void> {
  await mutate('/api/edith/advanced/priority', workspaceId, {
    method: 'PUT',
    body: JSON.stringify({ ...policy, priority, revision: policy.revision + 1, updatedAt: new Date().toISOString() }),
  });
}

export async function mutateGhost(workspaceId: string, ghostTaskId: string, action: 'pause' | 'cancel'): Promise<void> {
  await mutate(`/api/edith/advanced/ghosts/${encodeURIComponent(ghostTaskId)}/${action}`, workspaceId, { method: 'POST', body: '{}' });
}

export async function cancelWatcher(workspaceId: string, watcherId: string): Promise<void> {
  await mutate(`/api/edith/advanced/watchers/${encodeURIComponent(watcherId)}/cancel`, workspaceId, { method: 'POST', body: '{}' });
}

export async function searchAdvancedHistory(workspaceId: string, query: string, signal?: AbortSignal): Promise<RecentContextEventV2[]> {
  const response = await fetch(`/api/edith/advanced/history/search?workspaceId=${encodeURIComponent(workspaceId)}&q=${encodeURIComponent(query.slice(0, 200))}`, { credentials: 'include', signal });
  const payload = await json(response);
  if (payload.privateHistoryIncluded !== false || !Array.isArray(payload.results)) {
    throw new AdvancedExperienceClientError('ADVANCED_HISTORY_INVALID', 'History privacy boundary could not be verified.');
  }
  return payload.results.map((record) => {
    const parsed = parseRecentContextEventV2(record);
    if ('errorCode' in parsed) throw new AdvancedExperienceClientError(parsed.errorCode, parsed.message);
    return parsed.value;
  });
}
