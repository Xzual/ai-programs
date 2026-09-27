export type SettingsSkillStatus =
  | 'ready'
  | 'disabled'
  | 'config_required'
  | 'offline'
  | 'broken'
  | 'planned'
  | 'unavailable'
  | 'degraded';

export interface SettingsSkillReadiness {
  level: 'operational' | 'limited' | 'installed' | 'setup_required' | 'planned' | 'unavailable';
  ready: boolean;
  reason: string;
}

export interface SettingsSkillSnapshot {
  id: string;
  name: string;
  status: SettingsSkillStatus;
  readiness: SettingsSkillReadiness;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  lastChecked: string;
  limitations: string[];
}

export interface SettingsWorkspaceSnapshot {
  configured: boolean;
  state: 'ready' | 'degraded' | 'configuration_required' | 'invalid';
  safeMessage: string;
  workspaceRoot?: string;
  obsidianVaultPath?: string;
  readable: boolean;
  writable: boolean;
  lastValidated?: string;
  portableMode: boolean;
  persistenceRestartRequired: boolean;
  limitations: string[];
}

export interface SettingsRuntimeSnapshot {
  checkedAt?: string;
  skills: SettingsSkillSnapshot[];
  workspace?: SettingsWorkspaceSnapshot;
  registryError?: string;
  workspaceError?: string;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

async function readJson(url: string): Promise<Record<string, unknown>> {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  const payload = record(await response.json().catch(() => undefined));
  if (!response.ok || !payload || payload.success === false) {
    throw new Error(typeof payload?.error === 'string' ? payload.error : `${url} returned ${response.status}.`);
  }
  return payload;
}

function skillList(payload: Record<string, unknown>): SettingsSkillSnapshot[] {
  if (!Array.isArray(payload.statuses)) return [];
  return payload.statuses.filter((entry): entry is SettingsSkillSnapshot => {
    const item = record(entry);
    return Boolean(item && typeof item.id === 'string' && typeof item.status === 'string');
  });
}

function workspaceStatus(payload: Record<string, unknown>): SettingsWorkspaceSnapshot | undefined {
  const status = record(payload.status);
  if (!status || typeof status.configured !== 'boolean' || typeof status.state !== 'string') return undefined;
  return status as unknown as SettingsWorkspaceSnapshot;
}

export async function fetchSettingsRuntimeSnapshot(): Promise<SettingsRuntimeSnapshot> {
  const [registryResult, workspaceResult] = await Promise.allSettled([
    readJson('/api/edith/skills/status'),
    readJson('/api/workspace/status'),
  ]);

  return {
    checkedAt: registryResult.status === 'fulfilled' && typeof registryResult.value.checkedAt === 'string'
      ? registryResult.value.checkedAt
      : undefined,
    skills: registryResult.status === 'fulfilled' ? skillList(registryResult.value) : [],
    workspace: workspaceResult.status === 'fulfilled' ? workspaceStatus(workspaceResult.value) : undefined,
    registryError: registryResult.status === 'rejected'
      ? registryResult.reason instanceof Error ? registryResult.reason.message : 'Capability registry unavailable.'
      : undefined,
    workspaceError: workspaceResult.status === 'rejected'
      ? workspaceResult.reason instanceof Error ? workspaceResult.reason.message : 'Workspace status unavailable.'
      : undefined,
  };
}
