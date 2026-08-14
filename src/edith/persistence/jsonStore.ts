import fs from 'fs';
import path from 'path';
import type { EdithAuditEvent, EdithTask, EdithTaskStatus } from '../core';
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

  constructor(dataDir = DEFAULT_DATA_DIR) {
    this.paths = {
      dataDir,
      legacyTaskFile: path.join(dataDir, 'tasks.json'),
      legacyAuditFile: path.join(dataDir, 'audit.log.jsonl'),
    };
    this.toolRunsFile = path.join(dataDir, 'tool-runs.json');
    this.memoriesFile = path.join(dataDir, 'memories.json');
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

  close(): void {
    // JSON store opens files per operation, so there is no persistent handle to close.
  }

  getPaths(): EdithPersistencePaths {
    return this.paths;
  }
}
