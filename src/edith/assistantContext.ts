import path from 'path';
import { buildCapabilitySummary, getSkillRegistry, type SkillRegistrySnapshot } from './skillRegistry';
import { memoryService } from './memoryService';
import { taskService } from './taskService';
import { workspaceManager } from './workspaceManager';
import type { EdithAssistantChannel } from './coreBehaviorProtocol';

export interface AssistantRuntimeContextInput {
  channel: EdithAssistantChannel;
  userName?: string;
  assistantPersona?: string;
  query?: string;
  maxChars?: number;
}

function safeText(value: unknown, maxChars: number): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length <= maxChars ? text : `${text.slice(0, maxChars - 1)}...`;
}

function labels(snapshot: SkillRegistrySnapshot, ids: string[], limit = 8): string {
  const names = ids.flatMap((id) => {
    const skill = snapshot.skills.find((entry) => entry.id === id);
    return skill ? [skill.name] : [];
  });
  return names.slice(0, limit).join(', ') || 'none';
}

function compactLimitations(snapshot: SkillRegistrySnapshot, limit = 6): string[] {
  return snapshot.skills
    .filter((skill) => skill.status !== 'ready')
    .slice(0, limit)
    .map((skill) => `${skill.name}: ${safeText(skill.readiness.reason, 150)}`);
}

function relevantProjectContext(query: string): string[] {
  const memories = query
    ? memoryService.search({ query, type: 'project', includeSensitive: false, limit: 3 })
    : memoryService.list({ type: 'project', includeSensitive: false }).slice(0, 3);
  return memories.map((memory) => `${safeText(memory.key, 80)}: ${safeText(memory.content ?? memory.value, 180)}`);
}

function relevantTasks(query: string): string[] {
  const terms = query.toLocaleLowerCase('tr-TR').split(/\s+/).filter((term) => term.length > 2);
  return taskService.listTasks()
    .filter((task) => !['COMPLETED', 'FAILED', 'CANCELLED'].includes(task.status))
    .map((task) => ({
      task,
      score: terms.filter((term) => `${task.title} ${task.objective}`.toLocaleLowerCase('tr-TR').includes(term)).length,
    }))
    .sort((a, b) => b.score - a.score || Date.parse(b.task.updatedAt) - Date.parse(a.task.updatedAt))
    .slice(0, 3)
    .map(({ task }) => `${task.status}: ${safeText(task.title, 100)}`);
}

export function formatAssistantRuntimeContext(
  snapshot: SkillRegistrySnapshot,
  input: AssistantRuntimeContextInput,
): string {
  const summary = buildCapabilitySummary(snapshot);
  const workspace = workspaceManager.status();
  const config = workspaceManager.getConfig();
  const workspaceLabel = workspace.workspaceRoot ? path.basename(workspace.workspaceRoot) : 'not configured';
  const projectContext = relevantProjectContext(input.query?.trim() ?? '');
  const tasks = relevantTasks(input.query?.trim() ?? '');
  const lines = [
    'E.D.I.T.H. COMPACT RUNTIME CONTEXT',
    `- Identity: E.D.I.T.H. platform; active persona=${safeText(input.assistantPersona, 50) || 'default'}; channel=${input.channel}.`,
    `- User: ${safeText(input.userName, 80) || 'not provided'}.`,
    `- Device/workspace: device=${safeText(config?.deviceId, 80) || 'not configured'}; workspace=${safeText(workspaceLabel, 100)}; state=${workspace.state}; portable=${workspace.portableMode}.`,
    `- Obsidian: ${workspace.obsidianVaultPath ? 'configured' : 'configuration_required'}; workspace readable=${workspace.readable}; writable=${workspace.writable}.`,
    `- Ready skills: ${labels(snapshot, summary.ready)}.`,
    `- Degraded skills: ${labels(snapshot, summary.degraded)}.`,
    `- Configuration required: ${labels(snapshot, summary.configRequired)}.`,
    `- Offline/disabled/unavailable: ${labels(snapshot, [...summary.offline, ...summary.disabled, ...summary.unavailable, ...summary.broken])}.`,
    ...compactLimitations(snapshot).map((value) => `- Limitation: ${value}`),
    ...projectContext.map((value) => `- Relevant project: ${value}`),
    ...tasks.map((value) => `- Active task: ${value}`),
    '- Authority: registry status is executable truth; Obsidian is documentation and local knowledge, not an execution authority.',
  ];
  const output = lines.join('\n');
  const maxChars = Math.max(1_200, Math.min(input.maxChars ?? 4_200, 5_000));
  return output.length <= maxChars ? output : `${output.slice(0, maxChars - 1)}...`;
}

export async function buildAssistantRuntimeContext(input: AssistantRuntimeContextInput): Promise<string> {
  const snapshot = await getSkillRegistry();
  return formatAssistantRuntimeContext(snapshot, input);
}
