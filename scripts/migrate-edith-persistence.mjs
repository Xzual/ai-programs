import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const dataDir = path.resolve(process.cwd(), '.edith');
const dbPath = path.join(dataDir, 'edith.db');
const taskFile = path.join(dataDir, 'tasks.json');
const auditFile = path.join(dataDir, 'audit.log.jsonl');

function readTasks() {
  if (!fs.existsSync(taskFile)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(taskFile, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function readAuditEvents() {
  if (!fs.existsSync(auditFile)) return [];
  return fs
    .readFileSync(auditFile, 'utf8')
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(dbPath);
db.exec(`
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

const insertTask = db.prepare(`
  INSERT OR IGNORE INTO tasks (id, status, created_at, updated_at, json)
  VALUES (?, ?, ?, ?, ?)
`);
const insertAudit = db.prepare(`
  INSERT OR IGNORE INTO audit_events
    (id, task_id, tool_id, authorization, result, risk_level, timestamp, json)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

let tasksImported = 0;
for (const task of readTasks()) {
  const result = insertTask.run(
    task.id,
    task.status || 'CREATED',
    task.createdAt || new Date().toISOString(),
    new Date().toISOString(),
    JSON.stringify(task)
  );
  if (result.changes > 0) tasksImported += 1;
}

let auditEventsImported = 0;
for (const event of readAuditEvents()) {
  const result = insertAudit.run(
    event.id,
    event.taskId ?? null,
    event.toolId || 'unknown',
    event.authorization || 'allowed',
    event.result || 'success',
    Number(event.riskLevel ?? 0),
    event.timestamp || new Date().toISOString(),
    JSON.stringify(event)
  );
  if (result.changes > 0) auditEventsImported += 1;
}

console.log(JSON.stringify({
  success: true,
  database: dbPath,
  tasksImported,
  auditEventsImported,
}, null, 2));
