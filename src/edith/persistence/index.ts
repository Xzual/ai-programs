import { JsonEdithPersistenceStore } from './jsonStore';
import { SqliteEdithPersistenceStore } from './sqliteStore';
import type { EdithPersistenceStore } from './types';
import { workspaceManager } from '../workspaceManager';

let store: EdithPersistenceStore | undefined;

export function getEdithPersistenceStore(): EdithPersistenceStore {
  if (store) return store;

  const dataDir = workspaceManager.getPersistenceDataDir();

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
