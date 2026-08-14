import fs from 'fs';
import path from 'path';
import type { EdithAuditEvent, EdithTask, EdithTaskStatus } from '../core';
import type { MemoryItem, ToolExecutionLog } from '../../types';
import type { EdithPersistencePaths, EdithPersistenceStore, PersistenceMigrationResult } from './types';

const DEFAULT_DATA_DIR = path.resolve(process.cwd(), '.edith');

type DatabaseLike = {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): unknown;
    get(...params: unknown[]): Record<string, unknown> | undefined;
    all(...params: unknown[]): Array<Record<string, unknown>>;
  };
};

function readLegacyTasks(filePath: string): EdithTask[] {
  if (!fs.existsSync(filePath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(parsed) ? parsed as EdithTask[] : [];
  } catch {
    return [];
  }
}

function readLegacyAudit(filePath: string): EdithAuditEvent[] {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as EdithAuditEvent];
      } catch {
        return [];
      }
    });
}

function parseJsonColumn<T>(row: Record<string, unknown> | undefined): T | undefined {
  if (!row || typeof row.json !== 'string') return undefined;
  try {
    return JSON.parse(row.json) as T;
  } catch {
    return undefined;
  }
}

export class SqliteEdithPersistenceStore implements EdithPersistenceStore {
  readonly kind = 'sqlite' as const;

  private readonly paths: EdithPersistencePaths;
  private db?: DatabaseLike;

  constructor(dataDir = DEFAULT_DATA_DIR) {
    this.paths = {
      dataDir,
      sqliteFile: path.join(dataDir, 'edith.db'),
      legacyTaskFile: path.join(dataDir, 'tasks.json'),
      legacyAuditFile: path.join(dataDir, 'audit.log.jsonl'),
    };
  }

  initialize(): void {
    fs.mkdirSync(this.paths.dataDir, { recursive: true });
    const sqliteModule = require('node:sqlite') as { DatabaseSync: new (file: string) => DatabaseLike };
    this.db = new sqliteModule.DatabaseSync(this.paths.sqliteFile);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS task_steps (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        status TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        json TEXT NOT NULL,
        FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS task_checkpoints (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        json TEXT NOT NULL,
        FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY,
        task_id TEXT,
        tool_id TEXT NOT NULL,
        authorization TEXT NOT NULL,
        result TEXT NOT NULL,
        risk_level INTEGER NOT NULL,
        timestamp TEXT NOT NULL,
        json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        category TEXT NOT NULL,
        key TEXT NOT NULL,
        is_sensitive INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tool_runs (
        id TEXT PRIMARY KEY,
        tool_id TEXT NOT NULL,
        status TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at);
      CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_events(timestamp);
      CREATE INDEX IF NOT EXISTS idx_tool_runs_timestamp ON tool_runs(timestamp);
      CREATE INDEX IF NOT EXISTS idx_memories_category ON memories(category);
    `);
  }

  migrateLegacyData(): PersistenceMigrationResult {
    const db = this.getDb();
    let tasksImported = 0;
    let auditEventsImported = 0;

    const taskExists = db.prepare('SELECT id FROM tasks WHERE id = ?');
    const insertTask = db.prepare(`
      INSERT OR IGNORE INTO tasks (id, status, created_at, updated_at, json)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const task of readLegacyTasks(this.paths.legacyTaskFile)) {
      if (!taskExists.get(task.id)) {
        insertTask.run(task.id, task.status, task.createdAt, new Date().toISOString(), JSON.stringify(task));
        tasksImported += 1;
      }
    }

    const auditExists = db.prepare('SELECT id FROM audit_events WHERE id = ?');
    const insertAudit = db.prepare(`
      INSERT OR IGNORE INTO audit_events
        (id, task_id, tool_id, authorization, result, risk_level, timestamp, json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const event of readLegacyAudit(this.paths.legacyAuditFile)) {
      if (!auditExists.get(event.id)) {
        insertAudit.run(
          event.id,
          event.taskId ?? null,
          event.toolId,
          event.authorization,
          event.result,
          event.riskLevel,
          event.timestamp,
          JSON.stringify(event)
        );
        auditEventsImported += 1;
      }
    }

    return { tasksImported, auditEventsImported };
  }

  listTasks(): EdithTask[] {
    return this.getDb()
      .prepare('SELECT json FROM tasks ORDER BY created_at DESC')
      .all()
      .flatMap((row) => {
        const task = parseJsonColumn<EdithTask>(row);
        return task ? [task] : [];
      });
  }

  createTask(task: EdithTask): EdithTask {
    this.getDb()
      .prepare(`
        INSERT OR REPLACE INTO tasks (id, status, created_at, updated_at, json)
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(task.id, task.status, task.createdAt, new Date().toISOString(), JSON.stringify(task));
    return task;
  }

  updateTaskStatus(id: string, status: EdithTaskStatus, result?: string): EdithTask | undefined {
    const row = this.getDb().prepare('SELECT json FROM tasks WHERE id = ?').get(id);
    const task = parseJsonColumn<EdithTask>(row);
    if (!task) return undefined;

    const updated: EdithTask = {
      ...task,
      status,
      result: result ?? task.result,
      observations: [
        ...task.observations,
        `Status changed to ${status} at ${new Date().toISOString()}`,
      ],
    };
    this.getDb()
      .prepare('UPDATE tasks SET status = ?, updated_at = ?, json = ? WHERE id = ?')
      .run(updated.status, new Date().toISOString(), JSON.stringify(updated), id);
    return updated;
  }

  appendAuditEvent(event: EdithAuditEvent): void {
    this.getDb()
      .prepare(`
        INSERT OR REPLACE INTO audit_events
          (id, task_id, tool_id, authorization, result, risk_level, timestamp, json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        event.id,
        event.taskId ?? null,
        event.toolId,
        event.authorization,
        event.result,
        event.riskLevel,
        event.timestamp,
        JSON.stringify(event)
      );
  }

  readRecentAuditEvents(limit = 100): EdithAuditEvent[] {
    return this.getDb()
      .prepare('SELECT json FROM audit_events ORDER BY timestamp DESC LIMIT ?')
      .all(limit)
      .flatMap((row) => {
        const event = parseJsonColumn<EdithAuditEvent>(row);
        return event ? [event] : [];
      });
  }

  recordToolRun(log: ToolExecutionLog): void {
    this.getDb()
      .prepare(`
        INSERT OR REPLACE INTO tool_runs (id, tool_id, status, timestamp, json)
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(log.id, log.toolId, log.status, log.timestamp, JSON.stringify(log));
  }

  listToolRuns(limit = 100): ToolExecutionLog[] {
    return this.getDb()
      .prepare('SELECT json FROM tool_runs ORDER BY timestamp DESC LIMIT ?')
      .all(limit)
      .flatMap((row) => {
        const run = parseJsonColumn<ToolExecutionLog>(row);
        return run ? [run] : [];
      });
  }

  upsertMemory(memory: MemoryItem): void {
    const now = Date.now();
    this.getDb()
      .prepare(`
        INSERT OR REPLACE INTO memories
          (id, category, key, is_sensitive, created_at, updated_at, json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        memory.id,
        memory.category,
        memory.key,
        memory.isSensitive ? 1 : 0,
        memory.createdAt,
        now,
        JSON.stringify(memory)
      );
  }

  listMemories(): MemoryItem[] {
    return this.getDb()
      .prepare('SELECT json FROM memories ORDER BY created_at DESC')
      .all()
      .flatMap((row) => {
        const memory = parseJsonColumn<MemoryItem>(row);
        return memory ? [memory] : [];
      });
  }

  getPaths(): EdithPersistencePaths {
    return this.paths;
  }

  private getDb(): DatabaseLike {
    if (!this.db) this.initialize();
    return this.db as DatabaseLike;
  }
}
