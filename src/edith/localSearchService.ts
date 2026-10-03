import type { EdithPersistenceStore } from './persistence/types';
import type { Phase4Persistence } from './phase4Persistence';
import { redactSensitiveString, sanitizeSensitiveValue } from './securityRedaction';

export type LocalSearchScope = 'task' | 'memory' | 'knowledge' | 'research' | 'playbook';

export interface LocalSearchRequest {
  query: string;
  scopes?: LocalSearchScope[];
  limit?: number;
  includeSensitiveMemory?: boolean;
  taskIds?: string[];
}

export interface LocalSearchResult {
  id: string;
  scope: LocalSearchScope;
  title: string;
  summary: string;
  score: number;
  matchedFields: string[];
  metadata: Record<string, string | number | boolean | string[] | undefined>;
  provenance: {
    source: 'edith_local_store' | 'phase4_store';
    recordType: string;
    recordId: string;
    retrievedAt: string;
  };
}

function redact(value: string): string {
  return redactSensitiveString(value)
    .replace(/(?:[A-Za-z]:[\\/]|\\\\|\/)(?:[^\s`"']+[\\/])+[^\s`"']*/g, '[REDACTED_LOCAL_PATH]')
    .replace(/([?&](?:token|api[_-]?key|secret|password|signature)=)[^&#\s]+/gi, '$1[REDACTED]');
}

function terms(query: string): string[] {
  return [...new Set(query.normalize('NFKC').toLocaleLowerCase('en-US').split(/\s+/).map((item) => item.trim()).filter(Boolean))];
}

function scoreFields(searchTerms: string[], fields: Record<string, string>): { score: number; matchedFields: string[] } {
  const matchedFields: string[] = [];
  let score = 0;
  for (const [field, raw] of Object.entries(fields)) {
    const value = raw.normalize('NFKC').toLocaleLowerCase('en-US');
    const matches = searchTerms.filter((term) => value.includes(term)).length;
    if (matches) {
      matchedFields.push(field);
      score += matches * (field === 'title' || field === 'key' ? 4 : 1);
    }
  }
  return { score, matchedFields };
}

export class LocalSearchService {
  constructor(private readonly local: EdithPersistenceStore, private readonly phase4: Phase4Persistence) {}

  search(request: LocalSearchRequest): LocalSearchResult[] {
    const searchTerms = terms(request.query);
    if (!searchTerms.length) return [];
    const scopes = new Set(request.scopes?.length ? request.scopes : ['task', 'memory', 'knowledge', 'research', 'playbook']);
    const retrievedAt = new Date().toISOString();
    const rows: LocalSearchResult[] = [];
    const add = (
      scope: LocalSearchScope,
      source: LocalSearchResult['provenance']['source'],
      recordType: string,
      recordId: string,
      title: string,
      summary: string,
      fields: Record<string, string>,
      metadata: LocalSearchResult['metadata'],
    ) => {
      const scored = scoreFields(searchTerms, fields);
      if (!scored.score) return;
      rows.push({
        id: `${scope}:${recordId}`,
        scope,
        title: redact(title),
        summary: redact(summary).slice(0, 1_000),
        score: scored.score,
        matchedFields: scored.matchedFields,
        metadata: sanitizeSensitiveValue(metadata),
        provenance: { source, recordType, recordId, retrievedAt },
      });
    };

    if (scopes.has('task')) {
      for (const task of this.local.listTasks()) {
        if (request.taskIds?.length && !request.taskIds.includes(task.id)) continue;
        add('task', 'edith_local_store', 'EdithTask', task.id, task.title, task.objective,
          { title: task.title, objective: task.objective, status: task.status },
          { status: task.status, priority: task.priority, updatedAt: task.updatedAt ?? task.createdAt });
      }
    }
    if (scopes.has('memory')) {
      for (const memory of this.local.listMemories?.() ?? []) {
        const sensitive = memory.isSensitive || memory.sensitivity === 'sensitive';
        if (sensitive && !request.includeSensitiveMemory) continue;
        const content = memory.content ?? memory.value;
        add('memory', 'edith_local_store', 'MemoryItem', memory.id, memory.key, content,
          { key: memory.key, value: content, category: memory.category },
          { category: memory.category, scope: memory.scope, sensitivity: memory.sensitivity ?? (sensitive ? 'sensitive' : 'internal') });
      }
    }
    if (scopes.has('knowledge')) {
      for (const node of this.local.listKnowledgeNodes?.() ?? []) {
        add('knowledge', 'edith_local_store', 'KnowledgeGraphNode', node.id, node.title, `${node.type} · ${node.source}`,
          { title: node.title, type: node.type, tags: node.tags.join(' ') },
          { type: node.type, source: node.source, tags: node.tags });
      }
    }
    if (scopes.has('research')) {
      for (const run of this.phase4.listResearchRuns()) {
        const claimText = (run.claims ?? []).map((claim) => claim.statement).join(' ');
        add('research', 'phase4_store', 'ResearchRunV2', run.runId, run.query, claimText || run.uncertainty || 'No verified claims.',
          { title: run.query, claims: claimText, status: run.status, mode: run.mode ?? '' },
          { status: run.status, mode: run.mode, freshness: run.freshness?.status, confidence: run.confidence });
      }
    }
    if (scopes.has('playbook')) {
      for (const definition of this.phase4.listPlaybookDefinitions()) {
        const stepText = (definition.steps ?? []).map((step) => `${step.title} ${step.objective ?? ''}`).join(' ');
        add('playbook', 'phase4_store', 'PlaybookDefinitionV2', `${definition.playbookId}@${definition.version}`, definition.title, stepText,
          { title: definition.title, steps: stepText, id: definition.playbookId },
          { playbookId: definition.playbookId, version: definition.version, stepCount: definition.stepIds.length });
      }
    }
    return rows
      .sort((left, right) => right.score - left.score || left.scope.localeCompare(right.scope) || left.id.localeCompare(right.id))
      .slice(0, Math.max(1, Math.min(100, request.limit ?? 25)));
  }
}
