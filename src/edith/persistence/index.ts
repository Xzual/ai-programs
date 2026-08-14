import { JsonEdithPersistenceStore } from './jsonStore';
import { SqliteEdithPersistenceStore } from './sqliteStore';
import type { EdithPersistenceStore } from './types';

let store: EdithPersistenceStore | undefined;

export function getEdithPersistenceStore(): EdithPersistenceStore {
  if (store) return store;

  if (process.env.EDITH_PERSISTENCE === 'json') {
    store = new JsonEdithPersistenceStore();
    store.initialize();
    return store;
  }

  try {
    store = new SqliteEdithPersistenceStore();
    store.initialize();
    store.migrateLegacyData();
    return store;
  } catch (error) {
    console.warn('[EDITH Persistence] SQLite unavailable, falling back to JSON store:', error);
    store = new JsonEdithPersistenceStore();
    store.initialize();
    return store;
  }
}

export type { EdithPersistencePaths, EdithPersistenceStore, PersistenceMigrationResult } from './types';
