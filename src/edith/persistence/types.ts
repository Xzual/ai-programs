import type {
  EdithAuditEvent,
  EdithTask,
  EdithTaskStatus,
  KnowledgeChunk,
  KnowledgeGraphNode,
  KnowledgeGraphRelationship,
  KnowledgeSyncEvent,
  ObsidianNoteIndexRecord,
} from '../core';
import type { MemoryItem, ToolExecutionLog } from '../../types';

export interface EdithPersistencePaths {
  dataDir: string;
  sqliteFile?: string;
  legacyTaskFile: string;
  legacyAuditFile: string;
}

export interface PersistenceMigrationResult {
  tasksImported: number;
  auditEventsImported: number;
}

export interface EdithPersistenceStore {
  readonly kind: 'sqlite' | 'json';
  initialize(): void;
  migrateLegacyData(): PersistenceMigrationResult;
  listTasks(): EdithTask[];
  createTask(task: EdithTask): EdithTask;
  updateTask(task: EdithTask): EdithTask;
  updateTaskStatus(id: string, status: EdithTaskStatus, result?: string): EdithTask | undefined;
  appendAuditEvent(event: EdithAuditEvent): void;
  readRecentAuditEvents(limit?: number): EdithAuditEvent[];
  recordToolRun?(log: ToolExecutionLog): void;
  listToolRuns?(limit?: number): ToolExecutionLog[];
  upsertMemory?(memory: MemoryItem): void;
  listMemories?(): MemoryItem[];
  deleteMemory?(id: string): boolean;
  upsertKnowledgeNode?(node: KnowledgeGraphNode): void;
  listKnowledgeNodes?(): KnowledgeGraphNode[];
  upsertKnowledgeRelationship?(relationship: KnowledgeGraphRelationship): void;
  listKnowledgeRelationships?(): KnowledgeGraphRelationship[];
  upsertObsidianNoteIndex?(record: ObsidianNoteIndexRecord): void;
  listObsidianNoteIndex?(): ObsidianNoteIndexRecord[];
  deleteObsidianNoteIndex?(path: string, deletedAt: string): void;
  replaceKnowledgeChunksForNote?(notePath: string, chunks: KnowledgeChunk[]): void;
  listKnowledgeChunks?(limit?: number): KnowledgeChunk[];
  appendKnowledgeSyncEvent?(event: KnowledgeSyncEvent): void;
  listKnowledgeSyncEvents?(limit?: number): KnowledgeSyncEvent[];
  close?(): void;
  getPaths(): EdithPersistencePaths;
}
