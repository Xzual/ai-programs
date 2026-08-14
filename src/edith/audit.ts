import fs from 'fs';
import path from 'path';
import type { EdithAuditEvent } from './core';

const AUDIT_DIR = path.resolve(process.cwd(), '.edith');
const AUDIT_FILE = path.join(AUDIT_DIR, 'audit.log.jsonl');

export function createAuditEvent(params: Omit<EdithAuditEvent, 'id' | 'timestamp'>): EdithAuditEvent {
  return {
    ...params,
    id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
  };
}

export function appendAuditEvent(event: EdithAuditEvent): void {
  fs.mkdirSync(AUDIT_DIR, { recursive: true });
  fs.appendFileSync(AUDIT_FILE, `${JSON.stringify(event)}\n`, 'utf8');
}

export function getAuditLogPath(): string {
  return AUDIT_FILE;
}

export function readRecentAuditEvents(limit = 100): EdithAuditEvent[] {
  if (!fs.existsSync(AUDIT_FILE)) return [];
  return fs
    .readFileSync(AUDIT_FILE, 'utf8')
    .split('\n')
    .filter(Boolean)
    .slice(-limit)
    .reverse()
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as EdithAuditEvent];
      } catch {
        return [];
      }
    });
}
