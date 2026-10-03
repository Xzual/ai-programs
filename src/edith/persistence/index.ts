import os from 'node:os';
import path from 'node:path';
import { JsonEdithPersistenceStore } from './jsonStore';
import { SqliteEdithPersistenceStore } from './sqliteStore';
import type { EdithPersistenceStore } from './types';
import { workspaceManager } from '../workspaceManager';

let store: EdithPersistenceStore | undefined;

function isInside(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function resolvePersistenceDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const testMode = env.EDITH_TEST_MODE === 'true' || env.NODE_ENV === 'test';
  if (!testMode) return workspaceManager.getPersistenceDataDir();
  const configured = env.EDITH_TEST_DATA_DIR?.trim();
  if (!configured) throw new Error('EDITH_TEST_DATA_DIR_REQUIRED');
  const resolved = path.resolve(configured);
  const tempRoot = path.resolve(os.tmpdir());
  const projectRuntime = path.resolve(workspaceManager.appRoot, '.edith');
  if (resolved === tempRoot || !isInside(tempRoot, resolved) || resolved === projectRuntime || isInside(projectRuntime, resolved)) {
    throw new Error('EDITH_TEST_DATA_DIR_UNSAFE');
  }
  return resolved;
}

export function getEdithPersistenceStore(): EdithPersistenceStore {
  if (store) return store;

  const dataDir = resolvePersistenceDataDir();

  if (process.env.EDITH_PERSISTENCE === 'json') {
    store = new JsonEdithPersistenceStore(dataDir);
    store.initialize();
    return store;
  }

  try {
    store = new SqliteEdithPersistenceStore(dataDir);
    store.initialize();
    store.migrateLegacyData();
    return store;
  } catch (error) {
    console.warn('[EDITH Persistence] SQLite unavailable, falling back to JSON store:', error);
    store = new JsonEdithPersistenceStore(dataDir);
    store.initialize();
    return store;
  }
}

export type { EdithPersistencePaths, EdithPersistenceStore, PersistenceMigrationResult } from './types';
