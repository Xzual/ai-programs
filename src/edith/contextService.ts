import { appendAuditEvent, createAuditEvent, readRecentAuditEvents } from './audit';
import type { EdithAuditEvent, EdithContextReference, EdithContextSnapshot, EdithTask } from './core';
import { getEdithPersistenceStore } from './persistence';
import { getEdithToolHealth, type EdithToolHealth } from './serverRegistry';
import { taskService } from './taskService';
import { memoryService } from './memoryService';
import type { MemoryItem, ToolExecutionLog } from '../types';

export interface BuildContextInput {
  query: string;
  taskId?: string;
  actor?: string;
  memoryLimit?: number;
  taskLimit?: number;
  toolLimit?: number;
  auditLimit?: number;
  toolRunLimit?: number;
  includeSensitive?: boolean;
}

function contextId(): string {
  return `ctx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function clampLimit(value: number | undefined, fallback: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(max, Math.floor(Number(value))));
}

function termsFor(query: string): string[] {
  return query
    .toLocaleLowerCase('tr-TR')
    .split(/\s+/)
    .map((term) => term.replace(/[^\p{L}\p{N}:_-]/gu, ''))
    .filter((term) => term.length > 2);
}

function scoreText(text: string, query: string, base = 0): number {
  const haystack = text.toLocaleLowerCase('tr-TR');
  const matches = termsFor(query).filter((term) => haystack.includes(term)).length;
  return Math.min(1, base + matches / Math.max(termsFor(query).length, 1));
}

function memoryReference(memory: MemoryItem, query: string): EdithContextReference {
  return {
    type: 'memory',
    id: memory.id,
    label: memory.key,
    relevance: scoreText(`${memory.key} ${memory.value} ${memory.content ?? ''}`, query, memory.importance ?? 0.4),
    sensitivity: memory.sensitivity ?? (memory.isSensitive ? 'sensitive' : 'internal'),
    source: memory.source,
  };
}

function taskReference(task: EdithTask, query: string): EdithContextReference {
  return {
    type: 'task',
    id: task.id,
    label: `${task.status}: ${task.title}`,
    relevance: scoreText(`${task.title} ${task.objective} ${task.originalUserRequest}`, query, 0.25),
    sensitivity: 'internal',
    source: 'edith-task-service',
  };
}

function toolReference(tool: EdithToolHealth, query: string): EdithContextReference {
  return {
    type: 'tool',
    id: tool.toolId,
    label: `${tool.enabled ? 'enabled' : 'blocked'}: ${tool.toolId}`,
    relevance: scoreText(`${tool.toolId} ${tool.message} ${tool.dependencies.join(' ')}`, query, tool.enabled ? 0.25 : 0.1),
    sensitivity: 'internal',
    source: 'edith-tool-registry',
  };
}

function toolRunReference(log: ToolExecutionLog, query: string): EdithContextReference {
  return {
    type: 'tool_run',
    id: log.id,
    label: `${log.status}: ${log.toolName}`,
    relevance: scoreText(`${log.toolName} ${log.toolId} ${log.result}`, query, log.status === 'success' ? 0.2 : 0.35),
    sensitivity: 'internal',
    source: 'edith-persistence',
  };
}

function auditReference(event: EdithAuditEvent, query: string): EdithContextReference {
  return {
    type: 'audit',
    id: event.id,
    label: `${event.result}: ${event.action}`,
    relevance: scoreText(`${event.action} ${event.toolId} ${event.message ?? ''}`, query, event.result === 'denied' ? 0.35 : 0.2),
    sensitivity: 'internal',
    source: 'edith-audit',
  };
}

function topReferences<T>(
  values: T[],
  mapper: (value: T) => EdithContextReference,
  limit: number
): EdithContextReference[] {
  return values
    .map(mapper)
    .filter((reference) => reference.relevance > 0)
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, limit);
}

export class ContextService {
  build(input: BuildContextInput): EdithContextSnapshot {
    const query = input.query.trim();
    if (!query) throw new Error('query is required for context building.');

    const memoryLimit = clampLimit(input.memoryLimit, 6, 20);
    const taskLimit = clampLimit(input.taskLimit, 5, 20);
    const toolLimit = clampLimit(input.toolLimit, 8, 30);
    const auditLimit = clampLimit(input.auditLimit, 5, 20);
    const toolRunLimit = clampLimit(input.toolRunLimit, 5, 20);
    const memories = input.includeSensitive
      ? memoryService.search({ query, limit: memoryLimit, includeSensitive: true })
      : memoryService.context(query, memoryLimit);
    const redactions = input.includeSensitive ? [] : ['sensitive memories excluded from default context'];
    const tasks = taskService.listTasks().filter((task) => task.id !== input.taskId);
    const tools = getEdithToolHealth();
    const store = getEdithPersistenceStore();
    const toolRuns = store.listToolRuns?.(Math.max(toolRunLimit * 3, toolRunLimit)) ?? [];
    const auditEvents = readRecentAuditEvents(Math.max(auditLimit * 3, auditLimit));

    const snapshot: EdithContextSnapshot = {
      id: contextId(),
      query,
      taskId: input.taskId,
      createdAt: new Date().toISOString(),
      memoryReferences: memories.map((memory) => memoryReference(memory, query)),
      taskReferences: topReferences(tasks, (task) => taskReference(task, query), taskLimit),
      toolReferences: topReferences(tools, (tool) => toolReference(tool, query), toolLimit),
      toolRunReferences: topReferences(toolRuns, (log) => toolRunReference(log, query), toolRunLimit),
      auditReferences: topReferences(auditEvents, (event) => auditReference(event, query), auditLimit),
      redactions,
      summary: '',
    };

    snapshot.summary = this.summarize(snapshot);
    this.audit(input.actor ?? 'edith-context-service', snapshot);
    return snapshot;
  }

  private summarize(snapshot: EdithContextSnapshot): string {
    const counts = [
      `${snapshot.memoryReferences.length} memory`,
      `${snapshot.taskReferences.length} task`,
      `${snapshot.toolReferences.length} tool`,
      `${snapshot.toolRunReferences.length} tool-run`,
      `${snapshot.auditReferences.length} audit`,
    ].join(', ');
    const memoryLabels = snapshot.memoryReferences.map((memory) => memory.label).slice(0, 3).join(', ');
    const toolLabels = snapshot.toolReferences.map((tool) => tool.id).slice(0, 3).join(', ');
    return [
      `Context ${snapshot.id} built for "${snapshot.query}" with ${counts}.`,
      memoryLabels ? `Relevant memories: ${memoryLabels}.` : '',
      toolLabels ? `Relevant tools: ${toolLabels}.` : '',
      snapshot.redactions.length > 0 ? `Redactions: ${snapshot.redactions.join('; ')}.` : '',
    ].filter(Boolean).join(' ');
  }

  private audit(actor: string, snapshot: EdithContextSnapshot): void {
    appendAuditEvent(createAuditEvent({
      actor,
      taskId: snapshot.taskId,
      action: 'context.build',
      toolId: 'context_service',
      authorization: 'allowed',
      riskLevel: 0,
      result: 'success',
      message: snapshot.summary.slice(0, 500),
    }));
  }
}

export const contextService = new ContextService();
