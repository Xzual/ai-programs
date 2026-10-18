import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { workspaceManager } from '../../src/edith/workspaceManager';

export interface PendingSyncItem {
  id: string;
  userId: string;
  entity: string;
  operation: string;
  payload: Record<string, unknown>;
  state: 'pending';
  createdAt: string;
  attempts?: number;
  retryAt?: number;
  errorCode?: string;
}

export interface PendingSyncStore {
  enqueue(input: Omit<PendingSyncItem, 'id' | 'state' | 'createdAt'>): PendingSyncItem;
}

export class FilePendingSyncStore implements PendingSyncStore {
  constructor(readonly filePath = path.join(workspaceManager.getPersistenceDataDir(), 'cloud-pending.jsonl')) {}

  enqueue(input: Omit<PendingSyncItem, 'id' | 'state' | 'createdAt'>): PendingSyncItem {
    const raw = JSON.stringify(input.payload);
    if (raw.length > 65536 || /"[^"\n]*(?:api[_-]?key|secret|password|token|authorization|credential|cookie)[^"\n]*"\s*:/i.test(raw)) throw new Error('QUEUE_SECRET_OR_SIZE_REJECTED');
    const id = createHash('sha256').update(JSON.stringify([input.userId, input.entity, input.operation, input.payload])).digest('hex');
    const existing = this.pending().find(item => item.id === id);
    if (existing) return existing;
    const item: PendingSyncItem = {
      ...input,
      id,
      state: 'pending',
      createdAt: new Date().toISOString(),
    };
    this.append({ type: 'queued', item });
    return item;
  }

  pending(): PendingSyncItem[] {
    if (!fs.existsSync(this.filePath)) return [];
    if (fs.statSync(this.filePath).size > 32 * 1024 * 1024) throw new Error('QUEUE_STORAGE_LIMIT');
    const items = new Map<string, PendingSyncItem>();
    for (const line of fs.readFileSync(this.filePath, 'utf8').split('\n').filter(Boolean)) {
      const record = JSON.parse(line);
      if (record.type === 'queued') { this.validate(record.item); items.set(record.item.id, record.item); }
      else if (record.type === 'ack' || record.type === 'failed') items.delete(record.id);
      else if (record.type === 'retry' && items.has(record.id)) {
        if (!record.update || !Number.isSafeInteger(record.update.attempts) || record.update.attempts < 1 || !Number.isSafeInteger(record.update.retryAt) || record.update.retryAt < 0 || typeof record.update.errorCode !== 'string' || Object.keys(record.update).some(key => !['attempts','retryAt','errorCode'].includes(key))) throw new Error('QUEUE_STORAGE_INVALID');
        Object.assign(items.get(record.id)!, record.update);
      }
      else if (!record.type && record.id && record.state === 'pending') { this.validate(record); items.set(record.id, record); } // Existing queue format.
      else if (!['ack', 'failed', 'retry'].includes(record.type)) throw new Error('QUEUE_STORAGE_INVALID');
    }
    return [...items.values()];
  }

  ack(id: string): void { this.append({ type: 'ack', id }); }
  fail(id: string, errorCode: string): void { this.append({ type: 'failed', id, errorCode }); }
  retry(id: string, attempts: number, retryAt: number, errorCode: string): void { this.append({ type: 'retry', id, update: { attempts, retryAt, errorCode } }); }

  private append(record: unknown): void {
    const file = this.filePath;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 });
  }
  private validate(item: PendingSyncItem): void {
    if (!item || typeof item.id !== 'string' || typeof item.userId !== 'string' || !item.userId || typeof item.entity !== 'string' || typeof item.operation !== 'string' || item.state !== 'pending' || typeof item.createdAt !== 'string' || !Number.isFinite(Date.parse(item.createdAt)) || !item.payload || typeof item.payload !== 'object' || Array.isArray(item.payload)) throw new Error('QUEUE_STORAGE_INVALID');
    const raw = JSON.stringify(item.payload);
    if (raw.length > 65536 || /"[^"\n]*(?:api[_-]?key|secret|password|token|authorization|credential|cookie)[^"\n]*"\s*:/i.test(raw)) throw new Error('QUEUE_SECRET_OR_SIZE_REJECTED');
  }
}

export const pendingSyncStore = new FilePendingSyncStore();
