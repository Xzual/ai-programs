import type { EdithAuditEvent } from './core';
import { getEdithPersistenceStore } from './persistence';

export function createAuditEvent(params: Omit<EdithAuditEvent, 'id' | 'timestamp'>): EdithAuditEvent {
  return {
    ...params,
    id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
  };
}

export function appendAuditEvent(event: EdithAuditEvent): void {
  getEdithPersistenceStore().appendAuditEvent(event);
}

export function getAuditLogPath(): string {
  const paths = getEdithPersistenceStore().getPaths();
  return paths.sqliteFile ?? paths.legacyAuditFile;
}

export function readRecentAuditEvents(limit = 100): EdithAuditEvent[] {
  return getEdithPersistenceStore().readRecentAuditEvents(limit);
}
