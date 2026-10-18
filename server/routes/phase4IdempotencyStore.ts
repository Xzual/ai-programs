import { createHash } from 'node:crypto';
import { DurableStateStore } from '../advanced/durableStateStore';
import { sanitizeSensitiveValue } from '../../src/edith/securityRedaction';

export interface IdempotentResult { status: number; body: Record<string, unknown> }
type Stored = { fingerprint: string; state: 'pending' | 'completed'; result?: IdempotentResult };

export class Phase4IdempotencyStore {
  private readonly active = new Map<string, { fingerprint: string; result: Promise<IdempotentResult> }>();
  private readonly memory = new Map<string, Stored>();
  private readonly durable?: DurableStateStore;
  constructor(filePath?: string) { if (filePath) this.durable = new DurableStateStore(filePath); }

  execute(scope: string, key: string, body: unknown, operation: () => Promise<IdempotentResult>): { replayed: boolean; result: Promise<IdempotentResult> } | undefined {
    const fingerprint = createHash('sha256').update(JSON.stringify(body ?? null)).digest('hex');
    const compound = createHash('sha256').update(`${scope}:${key}`).digest('hex');
    const running = this.active.get(compound);
    if (running) return running.fingerprint === fingerprint ? { replayed: true, result: running.result } : undefined;
    const old = (this.durable?.get(compound) ?? this.memory.get(compound)) as Stored | undefined;
    if (old) {
      if (old.fingerprint !== fingerprint) return undefined;
      const result = old.state === 'completed' && old.result ? old.result : {
        status: 409, body: { success: false, errorCode: 'IDEMPOTENCY_OUTCOME_UNKNOWN', safeMessage: 'A prior execution was interrupted. Reconcile its task/artifact evidence before requesting another execution.' },
      };
      return { replayed: true, result: Promise.resolve(structuredClone(result)) };
    }
    const save = (value: Stored, reserve = false) => {
      if (this.durable) this.durable.update((entries) => {
        if (reserve && entries.has(compound)) throw new Error('IDEMPOTENCY_CONCURRENT_RESERVATION');
        entries.set(compound, value);
      });
      else { if (this.memory.size >= 512 && !this.memory.has(compound)) throw new Error('IDEMPOTENCY_STORE_FULL'); this.memory.set(compound, value); }
    };
    save({ fingerprint, state: 'pending' }, true);
    const result = Promise.resolve().then(operation).then((result) => {
      save({ fingerprint, state: 'completed', result: sanitizeSensitiveValue(result) });
      return result;
    }).finally(() => this.active.delete(compound));
    this.active.set(compound, { fingerprint, result });
    return { replayed: false, result };
  }
}
