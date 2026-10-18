import { FilePendingSyncStore, type PendingSyncItem, pendingSyncStore } from './pendingSyncStore';
import { CloudRegistryError, type RegistryService } from './types';
import { supabaseRegistry } from './supabaseRegistry';
import { ownerSessionBindingActive, onOwnerSessionInvalidated } from '../security/ownerSession';

type Authorization = { token: string; bindingId: string; expiresAt: number };
const destinations: Record<string, [string, string]> = {
  device: ['devices','id'], workspace: ['workspaces','id'], setting: ['user_settings','user_id,key'], settings: ['user_settings','user_id,key'],
  conversation: ['conversation_metadata','id'], conversation_metadata: ['conversation_metadata','id'], skill_metadata: ['skill_metadata','user_id,skill_id'],
  session_metadata: ['session_metadata','id'], sync_event: ['sync_events','id'],
};

export class CloudSyncWorker {
  private readonly sessions = new Map<string, Authorization>();
  private timer?: ReturnType<typeof setTimeout>;
  private running?: Promise<void>;
  private stopped = true;
  private readonly unsubscribe: () => void;
  private state: 'CONFIGURATION_REQUIRED' | 'IDLE' | 'DRAINING' | 'RETRY_WAIT' | 'STOPPED' = 'STOPPED';
  constructor(readonly store: FilePendingSyncStore, private readonly service: RegistryService,
    private readonly bindingActive = ownerSessionBindingActive, private readonly now = Date.now) {
    this.unsubscribe = onOwnerSessionInvalidated(({bindingId}) => { for (const [id, session] of this.sessions) if (session.bindingId === bindingId) this.sessions.delete(id); });
  }
  restore(userId: string, token: string, bindingId: string, expiresAt: number): void {
    if (!this.bindingActive(bindingId) || expiresAt <= this.now()) throw new Error('OWNER_SESSION_REQUIRED');
    this.sessions.set(userId, {token,bindingId,expiresAt});
  }
  forget(userId: string): void { this.sessions.delete(userId); }
  status() { return { state: this.state, pending: this.store.pending().length, credentialsPersisted: false }; }
  start(): void { if (!this.stopped) return; this.stopped = false; this.schedule(0); }
  async shutdown(): Promise<void> { this.stopped = true; if (this.timer) clearTimeout(this.timer); this.unsubscribe(); await this.running; this.sessions.clear(); this.state = 'STOPPED'; }
  drain(): Promise<void> {
    if (this.running) return this.running;
    const work = this.run(); this.running = work;
    const clear = () => { if (this.running === work) this.running = undefined; };
    void work.then(clear, clear);
    return work;
  }
  private schedule(delay: number): void { this.timer = setTimeout(() => { void this.drain().catch(() => { this.state = 'RETRY_WAIT'; }).finally(() => { if (!this.stopped) this.schedule(1000); }); },delay); this.timer.unref(); }
  private valid(userId: string, session: Authorization): boolean { return this.sessions.get(userId) === session && session.expiresAt > this.now() && this.bindingActive(session.bindingId); }
  private async run(): Promise<void> {
    this.state = 'IDLE';
    for (const item of this.store.pending()) {
      if (this.stopped) return;
      const session = this.sessions.get(item.userId);
      if (!session || !this.valid(item.userId,session)) { this.sessions.delete(item.userId); this.state = 'CONFIGURATION_REQUIRED'; continue; }
      if ((item.retryAt ?? 0) > this.now()) { this.state = 'RETRY_WAIT'; continue; }
      try {
        this.state = 'DRAINING';
        const user = await this.service.getUser(session.token);
        if (!this.valid(item.userId,session) || user.id !== item.userId) { this.forget(item.userId); this.state = 'CONFIGURATION_REQUIRED'; continue; }
        await this.write(item, session.token);
        if (!this.valid(item.userId,session)) { this.state = 'CONFIGURATION_REQUIRED'; continue; }
        this.store.ack(item.id); this.state = 'IDLE';
      } catch (error) {
        const mapped = error instanceof CloudRegistryError ? error : new CloudRegistryError('Queue request failed.', 'NETWORK_ERROR',503,true);
        if (mapped.code === 'CONFIGURATION_REQUIRED' || mapped.statusCode === 401 || mapped.statusCode === 403) { this.forget(item.userId); this.state = 'CONFIGURATION_REQUIRED'; continue; }
        if (!mapped.retryable) { this.store.fail(item.id,mapped.code); continue; }
        const attempts=(item.attempts ?? 0)+1;
        this.store.retry(item.id,attempts,this.now()+Math.min(60000,1000*2**Math.min(attempts-1,6)),mapped.code); this.state='RETRY_WAIT';
      }
    }
  }
  private async write(item: PendingSyncItem, token: string): Promise<void> {
    const target=destinations[item.entity];
    if (!target || !['insert','upsert','update'].includes(item.operation)) throw new CloudRegistryError('Unsupported queue operation.','QUEUE_OPERATION_INVALID',400);
    const payload: Record<string, unknown>={...item.payload,user_id:item.userId};
    if (item.operation === 'update') {
      const id=String(payload.id ?? ''); if (!id) throw new CloudRegistryError('Update id required.','QUEUE_OPERATION_INVALID',400);
      await this.service.update(target[0],token,payload,new URLSearchParams({user_id:`eq.${item.userId}`,id:`eq.${id}`}));
    } else {
      // Insert retries use a stable item id; a network-ambiguous success cannot create duplicates.
      if (item.entity === 'sync_event' && !payload.id) payload.id = item.id.slice(0,8)+'-'+item.id.slice(8,12)+'-4'+item.id.slice(13,16)+'-a'+item.id.slice(17,20)+'-'+item.id.slice(20,32);
      await this.service.upsert(target[0],token,payload,target[1]);
    }
  }
}
export const cloudSyncWorker = new CloudSyncWorker(pendingSyncStore, supabaseRegistry);
