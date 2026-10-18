import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
const MAX_BYTES = 8 * 1024 * 1024;
/** SQLite owns the writer lock: a killed writer releases it and rolls back on reopen. */
export class DurableStateStore {
  constructor(readonly filePath: string, private readonly maximumEntries = 512) {}
  private open(readOnly: boolean): DatabaseSync {
    const existing = fs.existsSync(this.filePath) && fs.statSync(this.filePath).size > 0;
    if (fs.existsSync(this.filePath) && fs.statSync(this.filePath).size > MAX_BYTES) throw new Error('DURABLE_STORE_TOO_LARGE');
    const db = new DatabaseSync(this.filePath, { readOnly });
    try {
      db.exec('PRAGMA busy_timeout=1000');
      if (!readOnly) {
        db.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA max_page_count=2048;');
        const version = Number(db.prepare('PRAGMA user_version').get()?.user_version);
        if ((existing && version !== 1) || (version !== 0 && version !== 1)) throw new Error('DURABLE_STORE_INVALID');
        db.exec('CREATE TABLE IF NOT EXISTS entries (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL); PRAGMA user_version=1;');
      }
      if (Number(db.prepare('PRAGMA user_version').get()?.user_version) !== 1 || db.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok') throw new Error('DURABLE_STORE_INVALID');
      return db;
    } catch (error) { db.close(); throw error; }
  }
  private read(db: DatabaseSync): Array<[string, unknown]> {
    const rows = db.prepare('SELECT key, value FROM entries ORDER BY rowid LIMIT ?').all(this.maximumEntries + 1);
    if (rows.length > this.maximumEntries) throw new Error('DURABLE_STORE_FULL');
    return rows.map((row) => {
      if (typeof row.key !== 'string' || typeof row.value !== 'string') throw new Error('DURABLE_STORE_INVALID');
      return [row.key, JSON.parse(row.value)] as [string, unknown];
    });
  }
  entries(): Array<[string, unknown]> {
    if (!fs.existsSync(this.filePath)) return [];
    // Writable reopen is needed for SQLite hot-journal crash recovery; no row mutation.
    const db = this.open(false);
    try { return this.read(db); } finally { db.close(); }
  }
  get(key: string): unknown { return this.entries().find((row) => row[0] === key)?.[1]; }
  update(operation: (entries: Map<string, unknown>) => void): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const db = this.open(false);
    let transaction = false;
    try {
      db.exec('BEGIN IMMEDIATE'); transaction = true;
      const entries = new Map(this.read(db)); operation(entries);
      if (entries.size > this.maximumEntries) throw new Error('DURABLE_STORE_FULL');
      const serialized = [...entries].map(([key, value]) => [key, JSON.stringify(value)] as const);
      if (serialized.some(([key, value]) => typeof key !== 'string' || value === undefined)) throw new Error('DURABLE_STORE_INVALID');
      if (Buffer.byteLength(JSON.stringify(serialized)) > MAX_BYTES - 65536) throw new Error('DURABLE_STORE_TOO_LARGE');
      db.exec('DELETE FROM entries');
      const insert = db.prepare('INSERT INTO entries(key,value) VALUES(?,?)');
      for (const [key, value] of serialized) insert.run(key, value);
      db.exec('COMMIT'); transaction = false;
    } finally { if (transaction) db.exec('ROLLBACK'); db.close(); }
  }
}
