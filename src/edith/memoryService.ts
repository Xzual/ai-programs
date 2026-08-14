import type { MemoryItem, MemoryScope, MemorySensitivity, MemoryType } from '../types';
import { appendAuditEvent, createAuditEvent } from './audit';
import { getEdithPersistenceStore } from './persistence';

export interface UpsertMemoryInput {
  id?: string;
  type?: MemoryType;
  scope?: MemoryScope;
  category?: MemoryItem['category'];
  key: string;
  value?: string;
  content?: string;
  source?: string;
  provenance?: string;
  confidence?: number;
  importance?: number;
  sensitivity?: MemorySensitivity;
  ttlMs?: number;
  relatedEntityIds?: string[];
  mergeOf?: string[];
}

export interface MemorySearchOptions {
  query?: string;
  type?: MemoryType;
  scope?: MemoryScope;
  includeSensitive?: boolean;
  limit?: number;
}

export interface MemoryConflict {
  key: string;
  existingIds: string[];
  candidateValue: string;
  existingValues: string[];
}

function memoryId(): string {
  return `mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function clamp01(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(1, Math.max(0, Number(value)));
}

function categoryForType(type: MemoryType): MemoryItem['category'] {
  if (type === 'preference') return 'user_pref';
  if (type === 'episodic' || type === 'project') return 'summary';
  return 'fact';
}

function isExpired(memory: MemoryItem, now = Date.now()): boolean {
  return Boolean(memory.ttlMs && memory.createdAt + memory.ttlMs < now);
}

function textFor(memory: MemoryItem): string {
  return `${memory.key}\n${memory.value}\n${memory.content ?? ''}\n${memory.source ?? ''}`.toLocaleLowerCase('tr-TR');
}

function scoreMemory(memory: MemoryItem, query: string): number {
  const haystack = textFor(memory);
  const terms = query.toLocaleLowerCase('tr-TR').split(/\s+/).filter(Boolean);
  const matches = terms.filter((term) => haystack.includes(term)).length;
  return matches + (memory.importance ?? 0.5) + (memory.confidence ?? 0.5);
}

export class MemoryService {
  list(options: MemorySearchOptions = {}): MemoryItem[] {
    const store = getEdithPersistenceStore();
    const memories = store.listMemories?.() ?? [];
    return memories
      .filter((memory) => !memory.deletedAt)
      .filter((memory) => !isExpired(memory))
      .filter((memory) => options.includeSensitive || !memory.isSensitive)
      .filter((memory) => !options.type || memory.type === options.type)
      .filter((memory) => !options.scope || memory.scope === options.scope)
      .sort((a, b) => (b.importance ?? 0.5) - (a.importance ?? 0.5) || (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt));
  }

  upsert(input: UpsertMemoryInput): MemoryItem {
    const now = Date.now();
    const type = input.type ?? 'semantic';
    const content = String(input.content ?? input.value ?? '').trim();
    if (!input.key?.trim() || !content) {
      throw new Error('key and content/value are required.');
    }
    const memory: MemoryItem = {
      id: input.id ?? memoryId(),
      category: input.category ?? categoryForType(type),
      key: input.key.trim(),
      value: content,
      createdAt: input.id ? this.find(input.id)?.createdAt ?? now : now,
      isSensitive: input.sensitivity === 'sensitive',
      type,
      scope: input.scope ?? 'user',
      content,
      source: input.source ?? 'edith-memory-service',
      provenance: input.provenance ?? 'manual_or_service_input',
      confidence: clamp01(input.confidence, 0.75),
      importance: clamp01(input.importance, 0.5),
      sensitivity: input.sensitivity ?? 'internal',
      updatedAt: now,
      ttlMs: input.ttlMs,
      relatedEntityIds: input.relatedEntityIds ?? [],
      mergeOf: input.mergeOf ?? [],
    };
    getEdithPersistenceStore().upsertMemory?.(memory);
    this.audit('memory.upsert', memory, `Memory upserted: ${memory.key}`);
    return memory;
  }

  find(id: string): MemoryItem | undefined {
    return (getEdithPersistenceStore().listMemories?.() ?? []).find((memory) => memory.id === id && !memory.deletedAt);
  }

  search(options: MemorySearchOptions): MemoryItem[] {
    const query = options.query?.trim() ?? '';
    const base = this.list(options);
    if (!query) return base.slice(0, options.limit ?? 20);
    return base
      .map((memory) => ({ memory, score: scoreMemory(memory, query) }))
      .filter((candidate) => candidate.score > 1)
      .sort((a, b) => b.score - a.score)
      .slice(0, options.limit ?? 20)
      .map((candidate) => {
        const touched = { ...candidate.memory, lastAccessed: Date.now() };
        getEdithPersistenceStore().upsertMemory?.(touched);
        return touched;
      });
  }

  context(query: string, limit = 8): MemoryItem[] {
    return this.search({ query, limit, includeSensitive: false })
      .filter((memory) => memory.sensitivity !== 'sensitive');
  }

  conflicts(input: UpsertMemoryInput): MemoryConflict[] {
    const candidateValue = String(input.content ?? input.value ?? '').trim();
    const existing = this.list({ includeSensitive: true })
      .filter((memory) => memory.key.toLocaleLowerCase('tr-TR') === input.key.toLocaleLowerCase('tr-TR'))
      .filter((memory) => memory.value !== candidateValue);
    if (existing.length === 0) return [];
    return [{
      key: input.key,
      existingIds: existing.map((memory) => memory.id),
      candidateValue,
      existingValues: existing.map((memory) => memory.value),
    }];
  }

  merge(targetId: string, sourceIds: string[]): MemoryItem | undefined {
    const target = this.find(targetId);
    if (!target) return undefined;
    const sources = sourceIds.flatMap((id) => {
      const memory = this.find(id);
      return memory ? [memory] : [];
    });
    const merged = this.upsert({
      ...target,
      id: target.id,
      content: [target.value, ...sources.map((memory) => memory.value)].filter(Boolean).join('\n'),
      importance: Math.max(target.importance ?? 0.5, ...sources.map((memory) => memory.importance ?? 0.5)),
      confidence: Math.max(target.confidence ?? 0.75, ...sources.map((memory) => memory.confidence ?? 0.75)),
      mergeOf: Array.from(new Set([...(target.mergeOf ?? []), ...sourceIds])),
      relatedEntityIds: Array.from(new Set([...(target.relatedEntityIds ?? []), ...sources.flatMap((memory) => memory.relatedEntityIds ?? [])])),
    });
    for (const source of sources) this.delete(source.id);
    this.audit('memory.merge', merged, `Memory merged into ${targetId}: ${sourceIds.join(', ')}`);
    return merged;
  }

  delete(id: string): boolean {
    const deleted = getEdithPersistenceStore().deleteMemory?.(id) ?? false;
    if (deleted) {
      this.audit('memory.delete', { id, key: id }, `Memory deleted: ${id}`);
    }
    return deleted;
  }

  exportSnapshot(): { exportedAt: string; memories: MemoryItem[] } {
    return {
      exportedAt: new Date().toISOString(),
      memories: this.list({ includeSensitive: true }),
    };
  }

  private audit(action: string, memory: Pick<MemoryItem, 'id' | 'key' | 'isSensitive'>, message: string): void {
    appendAuditEvent(createAuditEvent({
      actor: 'edith-memory-service',
      action,
      toolId: 'memory_service',
      target: memory.id,
      authorization: 'allowed',
      riskLevel: memory.isSensitive ? 2 : 1,
      result: 'success',
      message,
    }));
  }
}

export const memoryService = new MemoryService();
