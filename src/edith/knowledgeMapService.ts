import type { KnowledgeGraphNode, KnowledgeGraphRelationship } from './core';
import { knowledgeGraphService } from './knowledgeGraphService';
import { readRecentAuditEvents } from './audit';

export type KnowledgeMapNodeType =
  | 'core'
  | 'memory'
  | 'tool'
  | 'task'
  | 'audit'
  | 'agent'
  | 'model'
  | 'note'
  | 'project'
  | 'person'
  | 'organization'
  | 'file'
  | 'event'
  | 'trade'
  | 'conversation'
  | 'vault'
  | 'folder'
  | 'tag'
  | 'provider'
  | 'decision'
  | 'system'
  | 'concept'
  | 'automation'
  | 'security';

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
  importance?: number;
  recentActivityAt?: string;
  tags?: string[];
  folder?: string;
}

export interface KnowledgeMapEdge {
  from: string;
  to: string;
  label: string;
  source?: string;
  strength?: number;
}

export interface KnowledgeMapMetric {
  label: string;
  value: number;
  type: KnowledgeMapNodeType | 'relationship' | 'chunk';
}

export interface KnowledgeMapSnapshot {
  generatedAt: string;
  nodes: KnowledgeMapNode[];
  edges: KnowledgeMapEdge[];
  metrics: KnowledgeMapMetric[];
  sources: Record<string, number>;
}

const legacyType = (node: KnowledgeGraphNode): KnowledgeMapNodeType => {
  if (node.id === 'core:edith') return 'core';
  if (node.type === 'Vault') return 'vault';
  if (node.type === 'Folder') return 'folder';
  if (node.type === 'Tag') return 'tag';
  if (node.type === 'Memory') return 'memory';
  if (node.type === 'Tool') return 'tool';
  if (node.type === 'Task') return 'task';
  if (node.type === 'Agent') return 'agent';
  if (node.type === 'Model') return 'model';
  if (node.type === 'Provider') return 'provider';
  if (node.type === 'Decision') return 'decision';
  if (node.type === 'System') return 'system';
  if (node.type === 'Concept') return 'concept';
  if (node.type === 'Automation') return 'automation';
  if (node.type === 'SecurityEvent') return 'security';
  if (node.type === 'Project') return 'project';
  if (node.type === 'Person') return 'person';
  if (node.type === 'Organization') return 'organization';
  if (node.type === 'File') return 'file';
  if (node.type === 'Event') return 'event';
  if (node.type === 'Trade') return 'trade';
  if (node.type === 'Conversation') return 'conversation';
  return 'note';
};

function layout(nodes: KnowledgeGraphNode[]): KnowledgeMapNode[] {
  const mapped = nodes.map((node, index) => {
    const radius = node.id === 'core:edith' ? 0 : 28 + (index % 4) * 5;
    const angle = (Math.PI * 2 * index) / Math.max(nodes.length, 1);
    return {
      id: legacyNodeId(node.id),
      label: node.title,
      type: legacyType(node),
      x: node.id === 'core:edith' ? 50 : 50 + Math.cos(angle) * radius,
      y: node.id === 'core:edith' ? 50 : 50 + Math.sin(angle) * radius * 0.72,
      size: Math.max(8, Math.round(8 + node.importance * 22)),
      meta: node.folder || node.source,
      sourceId: node.id,
      status: String(node.properties.status ?? ''),
      riskLevel: typeof node.properties.riskLevel === 'number' ? node.properties.riskLevel : undefined,
      importance: node.importance,
      recentActivityAt: node.recentActivityAt,
      tags: node.tags,
      folder: node.folder,
    };
  });
  const hubNodes: KnowledgeMapNode[] = [
    { id: 'agent-hub', label: 'Agents', type: 'agent', x: 50, y: 18, size: 20, meta: 'registry' },
    { id: 'model-router', label: 'ModelRouter', type: 'model', x: 50, y: 82, size: 18, meta: 'provider routing' },
  ];
  const existingIds = new Set(mapped.map((node) => node.id));
  return [...mapped, ...hubNodes.filter((node) => !existingIds.has(node.id))];
}

function edgeFor(relationship: KnowledgeGraphRelationship): KnowledgeMapEdge {
  return {
    from: legacyNodeId(relationship.from),
    to: legacyNodeId(relationship.to),
    label: relationship.type === 'relatedTo' ? 'related' : relationship.type,
    source: relationship.source,
    strength: relationship.strength,
  };
}

function legacyNodeId(id: string): string {
  if (id === 'core:edith') return 'edith-core';
  return id.replace(':', '-');
}

export class KnowledgeMapService {
  snapshot(): KnowledgeMapSnapshot {
    const graph = knowledgeGraphService.snapshot({ limit: 500 });
    const nodes = layout(graph.nodes);
    const edges: KnowledgeMapEdge[] = [
      ...graph.relationships.map(edgeFor),
      { from: 'edith-core', to: 'agent-hub', label: 'delegates', source: 'system' },
      { from: 'edith-core', to: 'model-router', label: 'selects model', source: 'system' },
      ...readRecentAuditEvents(12).map((event) => ({
        from: 'edith-core',
        to: `audit-${event.id}`,
        label: event.action,
        source: 'audit',
        strength: event.result === 'success' ? 0.6 : 0.8,
      })),
    ];
    const auditNodes: KnowledgeMapNode[] = readRecentAuditEvents(12).map((event, index) => ({
      id: `audit-${event.id}`,
      label: event.toolId || event.action,
      type: 'audit',
      x: 70 + (index % 4) * 6,
      y: 78 + Math.floor(index / 4) * 6,
      size: event.result === 'success' ? 9 : 11,
      meta: event.result,
      sourceId: event.id,
      status: event.result,
      riskLevel: event.riskLevel,
    }));
    return {
      generatedAt: graph.generatedAt,
      nodes: [...nodes, ...auditNodes],
      edges,
      metrics: [
        ...graph.metrics.map((metric): KnowledgeMapMetric => ({
        label: metric.label,
        value: metric.value,
        type: metric.type === 'Relationship' ? 'relationship' : metric.type === 'Chunk' ? 'chunk' : 'note' as const,
        })),
        { label: 'Agents', value: graph.nodes.filter((node) => node.type === 'Agent').length, type: 'agent' as const },
      ],
      sources: graph.sources,
    };
  }
}

export const knowledgeMapService = new KnowledgeMapService();
