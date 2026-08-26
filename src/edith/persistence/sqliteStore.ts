import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
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
const require = createRequire(path.join(process.cwd(), 'package.json'));

type DatabaseLike = {
  exec(sql: string): void;
  close(): void;
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

      CREATE TABLE IF NOT EXISTS knowledge_nodes (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        source TEXT NOT NULL,
        importance REAL NOT NULL,
        recent_activity_at TEXT NOT NULL,
        path TEXT,
        deleted_at TEXT,
        json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS knowledge_relationships (
        id TEXT PRIMARY KEY,
        from_id TEXT NOT NULL,
        to_id TEXT NOT NULL,
        type TEXT NOT NULL,
        strength REAL NOT NULL,
        source TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS obsidian_note_index (
        path TEXT PRIMARY KEY,
        entity_id TEXT NOT NULL,
        folder TEXT NOT NULL,
        extension TEXT NOT NULL,
        mtime_ms REAL NOT NULL,
        size INTEGER NOT NULL,
        hash TEXT NOT NULL,
        deleted_at TEXT,
        json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS knowledge_chunks (
        id TEXT PRIMARY KEY,
        node_id TEXT NOT NULL,
        note_path TEXT NOT NULL,
        ordinal INTEGER NOT NULL,
        hash TEXT NOT NULL,
        embedding_status TEXT NOT NULL,
        indexed_at TEXT NOT NULL,
        json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS knowledge_sync_events (
        id TEXT PRIMARY KEY,
        action TEXT NOT NULL,
        path TEXT NOT NULL,
        source TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at);
      CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_events(timestamp);
      CREATE INDEX IF NOT EXISTS idx_tool_runs_timestamp ON tool_runs(timestamp);
      CREATE INDEX IF NOT EXISTS idx_memories_category ON memories(category);
      CREATE INDEX IF NOT EXISTS idx_knowledge_nodes_type ON knowledge_nodes(type);
      CREATE INDEX IF NOT EXISTS idx_knowledge_nodes_path ON knowledge_nodes(path);
      CREATE INDEX IF NOT EXISTS idx_knowledge_relationships_from ON knowledge_relationships(from_id);
      CREATE INDEX IF NOT EXISTS idx_knowledge_relationships_to ON knowledge_relationships(to_id);
      CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_note_path ON knowledge_chunks(note_path);
      CREATE INDEX IF NOT EXISTS idx_knowledge_sync_events_created ON knowledge_sync_events(created_at);
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

  updateTask(task: EdithTask): EdithTask {
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
    return this.updateTask(updated);
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

  deleteMemory(id: string): boolean {
    const existing = this.getDb().prepare('SELECT id FROM memories WHERE id = ?').get(id);
    this.getDb().prepare('DELETE FROM memories WHERE id = ?').run(id);
    return Boolean(existing);
  }

  upsertKnowledgeNode(node: KnowledgeGraphNode): void {
    this.getDb()
      .prepare(`
        INSERT OR REPLACE INTO knowledge_nodes
          (id, type, title, source, importance, recent_activity_at, path, deleted_at, json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        node.id,
        node.type,
        node.title,
        node.source,
        node.importance,
        node.recentActivityAt,
        node.path ?? null,
        node.deletedAt ?? null,
        JSON.stringify(node)
      );
  }

  listKnowledgeNodes(): KnowledgeGraphNode[] {
    return this.getDb()
      .prepare('SELECT json FROM knowledge_nodes ORDER BY recent_activity_at DESC')
      .all()
      .flatMap((row) => {
        const node = parseJsonColumn<KnowledgeGraphNode>(row);
        return node ? [node] : [];
      });
  }

  upsertKnowledgeRelationship(relationship: KnowledgeGraphRelationship): void {
    this.getDb()
      .prepare(`
        INSERT OR REPLACE INTO knowledge_relationships
          (id, from_id, to_id, type, strength, source, updated_at, deleted_at, json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        relationship.id,
        relationship.from,
        relationship.to,
        relationship.type,
        relationship.strength,
        relationship.source,
        relationship.updatedAt,
        relationship.deletedAt ?? null,
        JSON.stringify(relationship)
      );
  }

  listKnowledgeRelationships(): KnowledgeGraphRelationship[] {
    return this.getDb()
      .prepare('SELECT json FROM knowledge_relationships ORDER BY updated_at DESC')
      .all()
      .flatMap((row) => {
        const relationship = parseJsonColumn<KnowledgeGraphRelationship>(row);
        return relationship ? [relationship] : [];
      });
  }

  upsertObsidianNoteIndex(record: ObsidianNoteIndexRecord): void {
    this.getDb()
      .prepare(`
        INSERT OR REPLACE INTO obsidian_note_index
          (path, entity_id, folder, extension, mtime_ms, size, hash, deleted_at, json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        record.path,
        record.entityId,
        record.folder,
        record.extension,
        record.mtimeMs,
        record.size,
        record.hash,
        record.deletedAt ?? null,
        JSON.stringify(record)
      );
  }

  listObsidianNoteIndex(): ObsidianNoteIndexRecord[] {
    return this.getDb()
      .prepare('SELECT json FROM obsidian_note_index ORDER BY mtime_ms DESC')
      .all()
      .flatMap((row) => {
        const record = parseJsonColumn<ObsidianNoteIndexRecord>(row);
        return record ? [record] : [];
      });
  }

  deleteObsidianNoteIndex(notePath: string, deletedAt: string): void {
    const row = this.getDb().prepare('SELECT json FROM obsidian_note_index WHERE path = ?').get(notePath);
    const record = parseJsonColumn<ObsidianNoteIndexRecord>(row);
    if (!record) return;
    const updated = { ...record, deletedAt, indexedAt: deletedAt };
    this.upsertObsidianNoteIndex(updated);
  }

  replaceKnowledgeChunksForNote(notePath: string, chunks: KnowledgeChunk[]): void {
    const db = this.getDb();
    db.prepare('DELETE FROM knowledge_chunks WHERE note_path = ?').run(notePath);
    const insert = db.prepare(`
      INSERT OR REPLACE INTO knowledge_chunks
        (id, node_id, note_path, ordinal, hash, embedding_status, indexed_at, json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const chunk of chunks) {
      insert.run(
        chunk.id,
        chunk.nodeId,
        chunk.notePath,
        chunk.ordinal,
        chunk.hash,
        chunk.embeddingStatus,
        chunk.indexedAt,
        JSON.stringify(chunk)
      );
    }
  }

  listKnowledgeChunks(limit = 100): KnowledgeChunk[] {
    return this.getDb()
      .prepare('SELECT json FROM knowledge_chunks ORDER BY indexed_at DESC LIMIT ?')
      .all(limit)
      .flatMap((row) => {
        const chunk = parseJsonColumn<KnowledgeChunk>(row);
        return chunk ? [chunk] : [];
      });
  }

  appendKnowledgeSyncEvent(event: KnowledgeSyncEvent): void {
    this.getDb()
      .prepare(`
        INSERT OR REPLACE INTO knowledge_sync_events
          (id, action, path, source, status, created_at, json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(event.id, event.action, event.path, event.source, event.status, event.createdAt, JSON.stringify(event));
  }

  listKnowledgeSyncEvents(limit = 100): KnowledgeSyncEvent[] {
    return this.getDb()
      .prepare('SELECT json FROM knowledge_sync_events ORDER BY created_at DESC LIMIT ?')
      .all(limit)
      .flatMap((row) => {
        const event = parseJsonColumn<KnowledgeSyncEvent>(row);
        return event ? [event] : [];
      });
  }

  close(): void {
    this.db?.close();
    this.db = undefined;
  }

  getPaths(): EdithPersistencePaths {
    return this.paths;
  }

  private getDb(): DatabaseLike {
    if (!this.db) this.initialize();
    return this.db as DatabaseLike;
  }
}
