import type {
  EdithTask,
  KnowledgeGraphNode,
  KnowledgeGraphNodeType,
  KnowledgeGraphRelationship,
  KnowledgeGraphRelationshipType,
  KnowledgeGraphSnapshot,
  KnowledgeRecommendation,
} from './core';
import { agentRegistryService } from './agentRegistry';
import { memoryService } from './memoryService';
import { getEdithPersistenceStore } from './persistence';
import { edithToolRegistry, getEdithToolHealth } from './serverRegistry';
import { normalizeKnowledgeTitle, slugifyKnowledgeId } from './obsidianParser';

function now(): string {
  return new Date().toISOString();
}

function nodeId(type: KnowledgeGraphNodeType, titleOrId: string): string {
  return `${type.toLocaleLowerCase('en-US')}:${slugifyKnowledgeId(titleOrId)}`;
}

function relationshipId(from: string, to: string, type: KnowledgeGraphRelationshipType): string {
  return `${from}->${type}->${to}`;
}

export class KnowledgeGraphService {
  snapshot(filters: {
    query?: string;
    nodeType?: KnowledgeGraphNodeType;
    relationshipType?: KnowledgeGraphRelationshipType;
    folder?: string;
    tag?: string;
    source?: string;
    limit?: number;
  } = {}): KnowledgeGraphSnapshot {
    this.ingestEdithRuntime();
    const store = getEdithPersistenceStore();
    const normalizedQuery = filters.query?.trim().toLocaleLowerCase('tr-TR');
    const nodes = (store.listKnowledgeNodes?.() ?? [])
      .filter((node) => !node.deletedAt)
      .filter((node) => !filters.nodeType || node.type === filters.nodeType)
      .filter((node) => !filters.folder || node.folder === filters.folder)
      .filter((node) => !filters.tag || node.tags.includes(filters.tag))
      .filter((node) => !filters.source || node.source === filters.source)
      .filter((node) => !normalizedQuery || this.nodeSearchText(node).includes(normalizedQuery));
    const nodeIds = new Set(nodes.map((node) => node.id));
    const relationships = (store.listKnowledgeRelationships?.() ?? [])
      .filter((relationship) => !relationship.deletedAt)
      .filter((relationship) => !filters.relationshipType || relationship.type === filters.relationshipType)
      .filter((relationship) => nodeIds.has(relationship.from) && nodeIds.has(relationship.to));
    const limitedNodes = nodes.slice(0, filters.limit ?? 500);
    const limitedIds = new Set(limitedNodes.map((node) => node.id));
    const limitedRelationships = relationships.filter((relationship) => limitedIds.has(relationship.from) && limitedIds.has(relationship.to));
    return {
      generatedAt: now(),
      nodes: limitedNodes,
      relationships: limitedRelationships,
      metrics: [
        { label: 'Nodes', value: limitedNodes.length },
        { label: 'Relationships', value: limitedRelationships.length, type: 'Relationship' },
        { label: 'Chunks', value: store.listKnowledgeChunks?.(5000).length ?? 0, type: 'Chunk' },
      ],
      sources: this.countSources(limitedNodes),
      recommendations: this.recommendations(limitedNodes, limitedRelationships),
    };
  }

  upsertNode(input: Partial<KnowledgeGraphNode> & { title: string; type: KnowledgeGraphNodeType }): KnowledgeGraphNode {
    const timestamp = now();
    const id = input.id ?? nodeId(input.type, input.title);
    const existing = (getEdithPersistenceStore().listKnowledgeNodes?.() ?? []).find((node) => node.id === id);
    const node: KnowledgeGraphNode = {
      id,
      title: normalizeKnowledgeTitle(input.title),
      type: input.type,
      aliases: input.aliases ?? existing?.aliases ?? [],
      tags: input.tags ?? existing?.tags ?? [],
      path: input.path ?? existing?.path,
      folder: input.folder ?? existing?.folder,
      source: input.source ?? existing?.source ?? 'edith',
      importance: input.importance ?? existing?.importance ?? 0.5,
      recentActivityAt: input.recentActivityAt ?? timestamp,
      properties: { ...(existing?.properties ?? {}), ...(input.properties ?? {}) },
      deletedAt: input.deletedAt,
    };
    getEdithPersistenceStore().upsertKnowledgeNode?.(node);
    return node;
  }

  upsertRelationship(input: {
    from: string;
    to: string;
    type: KnowledgeGraphRelationshipType;
    strength?: number;
    source?: KnowledgeGraphRelationship['source'];
    evidence: string;
  }): KnowledgeGraphRelationship {
    const relationship: KnowledgeGraphRelationship = {
      id: relationshipId(input.from, input.to, input.type),
      from: input.from,
      to: input.to,
      type: input.type,
      strength: input.strength ?? 0.65,
      source: input.source ?? 'edith',
      evidence: input.evidence,
      updatedAt: now(),
    };
    getEdithPersistenceStore().upsertKnowledgeRelationship?.(relationship);
    return relationship;
  }

  findNode(id: string): KnowledgeGraphNode | undefined {
    this.ingestEdithRuntime();
    return (getEdithPersistenceStore().listKnowledgeNodes?.() ?? []).find((node) => node.id === id && !node.deletedAt);
  }

  search(query: string, limit = 25): KnowledgeGraphNode[] {
    return this.snapshot({ query, limit }).nodes;
  }

  nodeIdForTitle(type: KnowledgeGraphNodeType, title: string): string {
    return nodeId(type, title);
  }

  ingestEdithRuntime(): void {
    const core = this.upsertNode({
      id: 'core:edith',
      title: 'E.D.I.T.H Core',
      type: 'Agent',
      source: 'edith',
      importance: 1,
      properties: { hub: true },
    });
    const memoryHub = this.upsertNode({ id: 'memory:hub', title: 'Memory Engine', type: 'Memory', source: 'memory', importance: 0.9 });
    const ragHub = this.upsertNode({ id: 'note:rag-engine', title: 'RAG Engine', type: 'Note', source: 'rag', importance: 0.85 });
    this.upsertRelationship({ from: core.id, to: memoryHub.id, type: 'references', source: 'edith', evidence: 'EDITH uses Memory Engine.' });
    this.upsertRelationship({ from: core.id, to: ragHub.id, type: 'references', source: 'rag', evidence: 'EDITH uses RAG Engine.' });

    for (const memory of memoryService.list({ includeSensitive: false }).slice(0, 200)) {
      const node = this.upsertNode({
        id: `memory:${memory.id}`,
        title: memory.key,
        type: 'Memory',
        source: 'memory',
        importance: memory.importance ?? 0.55,
        recentActivityAt: new Date(memory.updatedAt ?? memory.createdAt).toISOString(),
        properties: { category: memory.category, scope: memory.scope, type: memory.type },
      });
      this.upsertRelationship({ from: memoryHub.id, to: node.id, type: 'owns', source: 'memory', evidence: 'Memory V2 record.' });
      for (const related of memory.relatedEntityIds ?? []) {
        const relatedId = related.startsWith('task:') ? `task:${related.slice(5)}` : related;
        this.upsertRelationship({ from: node.id, to: relatedId, type: 'relatedTo', source: 'memory', evidence: 'Memory relatedEntityIds.' });
      }
    }

    for (const task of getEdithPersistenceStore().listTasks().slice(0, 200)) {
      this.ingestTask(task, core.id);
    }

    const health = new Map(getEdithToolHealth().map((tool) => [tool.toolId, tool]));
    for (const tool of edithToolRegistry.list()) {
      const node = this.upsertNode({
        id: `tool:${tool.id}`,
        title: tool.metadata.name,
        type: 'Tool',
        source: 'tool',
        importance: tool.metadata.riskLevel >= 3 ? 0.7 : 0.5,
        properties: { category: tool.metadata.category, riskLevel: tool.metadata.riskLevel, health: health.get(tool.id) },
      });
      this.upsertRelationship({ from: core.id, to: node.id, type: 'references', source: 'tool', evidence: 'Registered EDITH tool.' });
    }

    for (const agent of agentRegistryService.listAgents()) {
      const node = this.upsertNode({
        id: `agent:${agent.id}`,
        title: agent.name,
        type: 'Agent',
        source: 'agent',
        importance: agent.health === 'HEALTHY' ? 0.72 : 0.58,
        properties: { health: agent.health, capabilities: agent.capabilities },
      });
      this.upsertRelationship({ from: core.id, to: node.id, type: 'participatesIn', source: 'agent', evidence: 'Agent registry.' });
      for (const toolId of agent.allowedTools) {
        this.upsertRelationship({ from: node.id, to: `tool:${toolId}`, type: 'references', source: 'agent', evidence: 'Agent allowed tool.' });
      }
    }
  }

  ingestTask(task: EdithTask, coreId = 'core:edith'): KnowledgeGraphNode {
    const node = this.upsertNode({
      id: `task:${task.id}`,
      title: task.title,
      type: 'Task',
      source: 'task',
      importance: task.riskLevel >= 3 ? 0.76 : 0.55,
      recentActivityAt: task.updatedAt ?? task.createdAt,
      properties: {
        status: task.status,
        objective: task.objective,
        riskLevel: task.riskLevel,
        timelineEvents: task.timeline?.length ?? 0,
        agentActivity: task.agentActivity?.map((activity) => ({
          agentId: activity.agentId,
          status: activity.status,
          planningOnly: activity.planningOnly,
        })) ?? [],
      },
    });
    this.upsertRelationship({ from: coreId, to: node.id, type: 'created', source: 'task', evidence: 'EDITH task service.' });
    for (const toolId of task.toolsRequired ?? []) {
      this.upsertRelationship({ from: node.id, to: `tool:${toolId}`, type: 'dependsOn', source: 'task', evidence: 'Task required tool.' });
    }
    for (const agentId of task.candidateAgents ?? []) {
      this.upsertRelationship({ from: node.id, to: `agent:${agentId}`, type: 'generatedBy', source: 'agent', evidence: 'Task candidate agent.' });
    }
    return node;
  }

  private nodeSearchText(node: KnowledgeGraphNode): string {
    return `${node.title} ${node.type} ${node.tags.join(' ')} ${node.aliases.join(' ')} ${node.folder ?? ''}`
      .toLocaleLowerCase('tr-TR');
  }

  private countSources(nodes: KnowledgeGraphNode[]): Record<string, number> {
    return nodes.reduce<Record<string, number>>((acc, node) => {
      acc[node.source] = (acc[node.source] ?? 0) + 1;
      return acc;
    }, {});
  }

  private recommendations(nodes: KnowledgeGraphNode[], relationships: KnowledgeGraphRelationship[]): KnowledgeRecommendation[] {
    const byTitle = new Map<string, KnowledgeGraphNode[]>();
    for (const node of nodes) {
      const key = slugifyKnowledgeId(node.title);
      byTitle.set(key, [...(byTitle.get(key) ?? []), node]);
    }
    const duplicates = Array.from(byTitle.values()).filter((items) => items.length > 1).slice(0, 5);
    const relationshipKeys = new Set(relationships.map((relationship) => `${relationship.from}:${relationship.to}`));
    return [
      ...duplicates.map((items) => ({
        id: `rec-duplicate-${slugifyKnowledgeId(items[0].title)}`,
        type: 'duplicate' as const,
        title: `Possible duplicate: ${items[0].title}`,
        rationale: 'Multiple nodes normalize to the same title.',
        nodeIds: items.map((item) => item.id),
        confidence: 0.78,
        actionRequired: true as const,
      })),
      ...nodes
        .filter((node) => node.tags.length > 0)
        .filter((node) => !relationships.some((relationship) => relationship.from === node.id || relationship.to === node.id))
        .slice(0, 5)
        .map((node) => ({
          id: `rec-link-${node.id}`,
          type: 'missing_relationship' as const,
          title: `Review isolated tagged note: ${node.title}`,
          rationale: 'Tagged node has no graph relationship yet.',
          nodeIds: [node.id],
          confidence: relationshipKeys.has(node.id) ? 0.3 : 0.62,
          actionRequired: true as const,
        })),
    ];
  }
}

export const knowledgeGraphService = new KnowledgeGraphService();
