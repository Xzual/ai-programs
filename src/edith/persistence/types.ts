import type { EdithAuditEvent, EdithTask, EdithTaskStatus } from '../core';
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
  updateTaskStatus(id: string, status: EdithTaskStatus, result?: string): EdithTask | undefined;
  appendAuditEvent(event: EdithAuditEvent): void;
  readRecentAuditEvents(limit?: number): EdithAuditEvent[];
  recordToolRun?(log: ToolExecutionLog): void;
  listToolRuns?(limit?: number): ToolExecutionLog[];
  upsertMemory?(memory: MemoryItem): void;
  listMemories?(): MemoryItem[];
  close?(): void;
  getPaths(): EdithPersistencePaths;
}
