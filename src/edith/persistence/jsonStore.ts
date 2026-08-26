import fs from 'fs';
import path from 'path';
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
import type { EdithPersistencePaths, EdithPersistenceStore, PersistenceMigrationResult } from './types';

const DEFAULT_DATA_DIR = path.resolve(process.cwd(), '.edith');

function readJsonArray<T>(filePath: string): T[] {
  if (!fs.existsSync(filePath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

function writeJsonArray<T>(filePath: string, rows: T[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(rows, null, 2), 'utf8');
}

function readJsonl<T>(filePath: string): T[] {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as T];
      } catch {
        return [];
      }
    });
}

export class JsonEdithPersistenceStore implements EdithPersistenceStore {
  readonly kind = 'json' as const;

  private readonly paths: EdithPersistencePaths;
  private readonly toolRunsFile: string;
  private readonly memoriesFile: string;
  private readonly knowledgeNodesFile: string;
  private readonly knowledgeRelationshipsFile: string;
  private readonly obsidianIndexFile: string;
  private readonly knowledgeChunksFile: string;
  private readonly knowledgeSyncEventsFile: string;

  constructor(dataDir = DEFAULT_DATA_DIR) {
    this.paths = {
      dataDir,
      legacyTaskFile: path.join(dataDir, 'tasks.json'),
      legacyAuditFile: path.join(dataDir, 'audit.log.jsonl'),
    };
    this.toolRunsFile = path.join(dataDir, 'tool-runs.json');
    this.memoriesFile = path.join(dataDir, 'memories.json');
    this.knowledgeNodesFile = path.join(dataDir, 'knowledge-nodes.json');
    this.knowledgeRelationshipsFile = path.join(dataDir, 'knowledge-relationships.json');
    this.obsidianIndexFile = path.join(dataDir, 'obsidian-index.json');
    this.knowledgeChunksFile = path.join(dataDir, 'knowledge-chunks.json');
    this.knowledgeSyncEventsFile = path.join(dataDir, 'knowledge-sync-events.json');
  }

  initialize(): void {
    fs.mkdirSync(this.paths.dataDir, { recursive: true });
  }

  migrateLegacyData(): PersistenceMigrationResult {
    this.initialize();
    return { tasksImported: 0, auditEventsImported: 0 };
  }

  listTasks(): EdithTask[] {
    return readJsonArray<EdithTask>(this.paths.legacyTaskFile)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }

  createTask(task: EdithTask): EdithTask {
    writeJsonArray(this.paths.legacyTaskFile, [task, ...this.listTasks()]);
    return task;
  }

  updateTask(task: EdithTask): EdithTask {
    const tasks = this.listTasks();
    const exists = tasks.some((existing) => existing.id === task.id);
    const updated = exists
      ? tasks.map((existing) => existing.id === task.id ? task : existing)
      : [task, ...tasks];
    writeJsonArray(this.paths.legacyTaskFile, updated);
    return task;
  }

  updateTaskStatus(id: string, status: EdithTaskStatus, result?: string): EdithTask | undefined {
    const updated = this.listTasks().map((task) =>
      task.id === id
        ? {
            ...task,
            status,
            result: result ?? task.result,
            observations: [
              ...task.observations,
              `Status changed to ${status} at ${new Date().toISOString()}`,
            ],
          }
        : task
    );
    const task = updated.find((item) => item.id === id);
    if (task) this.updateTask(task);
    return task;
  }

  appendAuditEvent(event: EdithAuditEvent): void {
    this.initialize();
    fs.appendFileSync(this.paths.legacyAuditFile, `${JSON.stringify(event)}\n`, 'utf8');
  }

  readRecentAuditEvents(limit = 100): EdithAuditEvent[] {
    return readJsonl<EdithAuditEvent>(this.paths.legacyAuditFile).slice(-limit).reverse();
  }

  recordToolRun(log: ToolExecutionLog): void {
    writeJsonArray(this.toolRunsFile, [log, ...this.listToolRuns()]);
  }

  listToolRuns(limit = 100): ToolExecutionLog[] {
    return readJsonArray<ToolExecutionLog>(this.toolRunsFile).slice(0, limit);
  }

  upsertMemory(memory: MemoryItem): void {
    const memories = this.listMemories();
    const next = [memory, ...memories.filter((item) => item.id !== memory.id)];
    writeJsonArray(this.memoriesFile, next);
  }

  listMemories(): MemoryItem[] {
    return readJsonArray<MemoryItem>(this.memoriesFile);
  }

  deleteMemory(id: string): boolean {
    const memories = this.listMemories();
    const next = memories.filter((memory) => memory.id !== id);
    writeJsonArray(this.memoriesFile, next);
    return next.length !== memories.length;
  }

  upsertKnowledgeNode(node: KnowledgeGraphNode): void {
    const nodes = this.listKnowledgeNodes();
    writeJsonArray(this.knowledgeNodesFile, [node, ...nodes.filter((item) => item.id !== node.id)]);
  }

  listKnowledgeNodes(): KnowledgeGraphNode[] {
    return readJsonArray<KnowledgeGraphNode>(this.knowledgeNodesFile);
  }

  upsertKnowledgeRelationship(relationship: KnowledgeGraphRelationship): void {
    const relationships = this.listKnowledgeRelationships();
    writeJsonArray(this.knowledgeRelationshipsFile, [
      relationship,
      ...relationships.filter((item) => item.id !== relationship.id),
    ]);
  }

  listKnowledgeRelationships(): KnowledgeGraphRelationship[] {
    return readJsonArray<KnowledgeGraphRelationship>(this.knowledgeRelationshipsFile);
  }

  upsertObsidianNoteIndex(record: ObsidianNoteIndexRecord): void {
    const records = this.listObsidianNoteIndex();
    writeJsonArray(this.obsidianIndexFile, [record, ...records.filter((item) => item.path !== record.path)]);
  }

  listObsidianNoteIndex(): ObsidianNoteIndexRecord[] {
    return readJsonArray<ObsidianNoteIndexRecord>(this.obsidianIndexFile);
  }

  deleteObsidianNoteIndex(notePath: string, deletedAt: string): void {
    const records = this.listObsidianNoteIndex();
    writeJsonArray(this.obsidianIndexFile, records.map((record) =>
      record.path === notePath ? { ...record, deletedAt, indexedAt: deletedAt } : record
    ));
  }

  replaceKnowledgeChunksForNote(notePath: string, chunks: KnowledgeChunk[]): void {
    const existing = this.listKnowledgeChunks(Number.MAX_SAFE_INTEGER);
    writeJsonArray(this.knowledgeChunksFile, [
      ...chunks,
      ...existing.filter((chunk) => chunk.notePath !== notePath),
    ]);
  }

  listKnowledgeChunks(limit = 100): KnowledgeChunk[] {
    return readJsonArray<KnowledgeChunk>(this.knowledgeChunksFile).slice(0, limit);
  }

  appendKnowledgeSyncEvent(event: KnowledgeSyncEvent): void {
    writeJsonArray(this.knowledgeSyncEventsFile, [event, ...this.listKnowledgeSyncEvents(Number.MAX_SAFE_INTEGER)]);
  }

  listKnowledgeSyncEvents(limit = 100): KnowledgeSyncEvent[] {
    return readJsonArray<KnowledgeSyncEvent>(this.knowledgeSyncEventsFile).slice(0, limit);
  }

  close(): void {
    // JSON store opens files per operation, so there is no persistent handle to close.
  }

  getPaths(): EdithPersistencePaths {
    return this.paths;
  }
}
