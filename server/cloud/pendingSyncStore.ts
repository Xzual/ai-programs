import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { workspaceManager } from '../../src/edith/workspaceManager';

export interface PendingSyncItem {
  id: string;
  userId: string;
  entity: string;
  operation: string;
  payload: Record<string, unknown>;
  state: 'pending';
  createdAt: string;
}

export interface PendingSyncStore {
  enqueue(input: Omit<PendingSyncItem, 'id' | 'state' | 'createdAt'>): PendingSyncItem;
}

export class FilePendingSyncStore implements PendingSyncStore {
  enqueue(input: Omit<PendingSyncItem, 'id' | 'state' | 'createdAt'>): PendingSyncItem {
    const item: PendingSyncItem = {
      ...input,
      id: randomUUID(),
      state: 'pending',
      createdAt: new Date().toISOString(),
    };
    const file = path.join(workspaceManager.getPersistenceDataDir(), 'cloud-pending.jsonl');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify(item)}\n`, { encoding: 'utf8', mode: 0o600 });
    return item;
  }
}

export const pendingSyncStore = new FilePendingSyncStore();
