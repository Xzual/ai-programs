import type { EdithAuditEvent, EdithTask } from './core';
import { agentRegistryService } from './agentRegistry';
import { readRecentAuditEvents } from './audit';
import { memoryService } from './memoryService';
import { getEdithPersistenceStore } from './persistence';
import { edithToolRegistry, getEdithToolHealth } from './serverRegistry';
import type { MemoryItem } from '../types';

export type KnowledgeMapNodeType =
  | 'core'
  | 'memory'
  | 'tool'
  | 'task'
  | 'audit'
  | 'agent'
  | 'model';

export interface KnowledgeMapNode {
  id: string;
  label: string;
  type: KnowledgeMapNodeType;
  x: number;
  y: number;
  size: number;
  meta?: string;
  sourceId?: string;
  status?: string;
  riskLevel?: number;
}

export interface KnowledgeMapEdge {
  from: string;
  to: string;
  label: string;
  source?: 'task' | 'memory' | 'tool' | 'audit' | 'agent' | 'system';
}

export interface KnowledgeMapMetric {
  label: string;
  value: number;
  type: KnowledgeMapNodeType;
}

export interface KnowledgeMapSnapshot {
  generatedAt: string;
  nodes: KnowledgeMapNode[];
  edges: KnowledgeMapEdge[];
  metrics: KnowledgeMapMetric[];
  sources: {
    memories: number;
    tools: number;
    tasks: number;
    auditEvents: number;
    toolRuns: number;
    agents: number;
  };
}

function memoryMeta(memory: MemoryItem): string {
  return memory.type ?? memory.category;
}

function taskMeta(task: EdithTask): string {
  return `${task.status}${task.riskLevel >= 3 ? ` / risk ${task.riskLevel}` : ''}`;
}

function auditLabel(event: EdithAuditEvent): string {
  return event.toolId || event.action;
}

export class KnowledgeMapService {
  snapshot(): KnowledgeMapSnapshot {
    const store = getEdithPersistenceStore();
    const memories = memoryService.list({ includeSensitive: false }).slice(0, 12);
    const tasks = store.listTasks().slice(0, 12);
    const tools = edithToolRegistry.list();
    const toolHealth = new Map(getEdithToolHealth().map((tool) => [tool.toolId, tool]));
    const auditEvents = readRecentAuditEvents(12);
    const toolRuns = store.listToolRuns?.(12) ?? [];
    const agents = agentRegistryService.listAgents();

    const nodes: KnowledgeMapNode[] = [
      { id: 'edith-core', label: 'E.D.I.T.H Core', type: 'core', x: 50, y: 50, size: 34, meta: 'operating layer' },
      { id: 'memory-hub', label: 'Memory', type: 'memory', x: 20, y: 26, size: 22, meta: `${memories.length} visible` },
      { id: 'tool-hub', label: 'Tools', type: 'tool', x: 80, y: 26, size: 22, meta: `${tools.length} registered` },
      { id: 'task-hub', label: 'Tasks', type: 'task', x: 24, y: 76, size: 22, meta: `${tasks.length} persisted` },
      { id: 'audit-hub', label: 'Audit', type: 'audit', x: 76, y: 76, size: 22, meta: `${auditEvents.length} events` },
      { id: 'agent-hub', label: 'Agents', type: 'agent', x: 50, y: 18, size: 20, meta: `${agents.length} agents` },
      { id: 'model-router', label: 'ModelRouter', type: 'model', x: 50, y: 82, size: 18, meta: 'ollama/gemini/mock' },
    ];

    const edges: KnowledgeMapEdge[] = [
      { from: 'edith-core', to: 'memory-hub', label: 'retrieves', source: 'system' },
      { from: 'edith-core', to: 'tool-hub', label: 'routes', source: 'system' },
      { from: 'edith-core', to: 'task-hub', label: 'plans', source: 'system' },
      { from: 'edith-core', to: 'audit-hub', label: 'records', source: 'system' },
      { from: 'edith-core', to: 'agent-hub', label: 'delegates', source: 'system' },
      { from: 'edith-core', to: 'model-router', label: 'selects model', source: 'system' },
    ];

    memories.forEach((memory, index) => {
      const angle = (Math.PI * 2 * index) / Math.max(12, memories.length || 1) - Math.PI / 7;
      const nodeId = `memory-${memory.id}`;
      nodes.push({
        id: nodeId,
        label: memory.key,
        type: 'memory',
        x: 20 + Math.cos(angle) * 16,
        y: 26 + Math.sin(angle) * 15,
        size: memory.importance ? 8 + memory.importance * 4 : 9,
        meta: memoryMeta(memory),
        sourceId: memory.id,
      });
      edges.push({ from: 'memory-hub', to: nodeId, label: memoryMeta(memory), source: 'memory' });
      for (const entityId of memory.relatedEntityIds ?? []) {
        if (entityId.startsWith('task:')) {
          edges.push({ from: nodeId, to: `task-${entityId.slice(5)}`, label: 'related', source: 'memory' });
        }
      }
    });

    tools.slice(0, 16).forEach((tool, index) => {
      const angle = (Math.PI * 2 * index) / Math.max(16, tools.length || 1) + Math.PI / 10;
      const health = toolHealth.get(tool.id);
      const nodeId = `tool-${tool.id}`;
      nodes.push({
        id: nodeId,
        label: tool.metadata.name,
        type: 'tool',
        x: 80 + Math.cos(angle) * 16,
        y: 26 + Math.sin(angle) * 15,
        size: tool.metadata.riskLevel >= 3 ? 12 : 9,
        meta: health?.enabled === false ? 'disabled' : tool.metadata.category,
        sourceId: tool.id,
        status: health?.enabled === false ? 'disabled' : 'enabled',
        riskLevel: tool.metadata.riskLevel,
      });
      edges.push({ from: 'tool-hub', to: nodeId, label: tool.metadata.category, source: 'tool' });
    });

    tasks.forEach((task, index) => {
      const nodeId = `task-${task.id}`;
      nodes.push({
        id: nodeId,
        label: task.title,
        type: 'task',
        x: 11 + (index % 4) * 9,
        y: 84 + Math.floor(index / 4) * 6,
        size: task.riskLevel >= 3 ? 12 : 9,
        meta: taskMeta(task),
        sourceId: task.id,
        status: task.status,
        riskLevel: task.riskLevel,
      });
      edges.push({ from: 'task-hub', to: nodeId, label: task.status, source: 'task' });
      for (const toolId of task.toolsRequired ?? []) {
        edges.push({ from: nodeId, to: `tool-${toolId}`, label: 'requires', source: 'task' });
      }
      for (const agentId of task.candidateAgents ?? []) {
        edges.push({ from: nodeId, to: `agent-${agentId}`, label: 'candidate', source: 'agent' });
      }
      if (task.plan) {
        edges.push({ from: nodeId, to: 'agent-planning', label: 'planned by', source: 'task' });
      }
    });

    auditEvents.forEach((event, index) => {
      const nodeId = `audit-${event.id}`;
      nodes.push({
        id: nodeId,
        label: auditLabel(event),
        type: 'audit',
        x: 64 + (index % 4) * 8,
        y: 84 + Math.floor(index / 4) * 6,
        size: event.result === 'success' ? 9 : 11,
        meta: event.result,
        sourceId: event.id,
        status: event.result,
        riskLevel: event.riskLevel,
      });
      edges.push({ from: 'audit-hub', to: nodeId, label: event.action, source: 'audit' });
      if (event.toolId) edges.push({ from: nodeId, to: `tool-${event.toolId}`, label: 'tool', source: 'audit' });
      if (event.taskId) edges.push({ from: nodeId, to: `task-${event.taskId}`, label: 'task', source: 'audit' });
    });

    agents.forEach((agent, index) => {
      const angle = (Math.PI * 2 * index) / Math.max(agents.length, 1) - Math.PI / 2;
      const nodeId = `agent-${agent.id}`;
      nodes.push({
        id: nodeId,
        label: agent.name,
        type: 'agent',
        x: 50 + Math.cos(angle) * 22,
        y: 18 + Math.sin(angle) * 11,
        size: agent.health === 'HEALTHY' ? 10 : 12,
        meta: agent.health,
        sourceId: agent.id,
        status: agent.health,
      });
      edges.push({ from: 'agent-hub', to: nodeId, label: agent.health, source: 'agent' });
      for (const toolId of agent.allowedTools) {
        edges.push({ from: nodeId, to: `tool-${toolId}`, label: 'allowed', source: 'agent' });
      }
    });

    for (const run of toolRuns) {
      edges.push({ from: 'audit-hub', to: `tool-${run.toolId}`, label: run.status, source: 'tool' });
    }

    const graph = this.keepEdgesWithExistingNodes(nodes, edges);

    return {
      generatedAt: new Date().toISOString(),
      nodes: graph.nodes,
      edges: graph.edges,
      metrics: [
        { label: 'Memory', value: memories.length, type: 'memory' },
        { label: 'Tools', value: tools.length, type: 'tool' },
        { label: 'Tasks', value: tasks.length, type: 'task' },
        { label: 'Audit', value: auditEvents.length, type: 'audit' },
        { label: 'Agents', value: agents.length, type: 'agent' },
      ],
      sources: {
        memories: memories.length,
        tools: tools.length,
        tasks: tasks.length,
        auditEvents: auditEvents.length,
        toolRuns: toolRuns.length,
        agents: agents.length,
      },
    };
  }

  private keepEdgesWithExistingNodes(
    nodes: KnowledgeMapNode[],
    edges: KnowledgeMapEdge[]
  ): { nodes: KnowledgeMapNode[]; edges: KnowledgeMapEdge[] } {
    const ids = new Set(nodes.map((node) => node.id));
    return {
      nodes,
      edges: edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to)),
    };
  }
}

export const knowledgeMapService = new KnowledgeMapService();
