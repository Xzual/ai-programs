import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import { SupabaseRegistry } from '../server/cloud/supabaseRegistry';
import { CloudRegistryError, type CloudRegistryStatus, type RegistryService, type SupabaseSession, type SupabaseUser } from '../server/cloud/types';
import type { PendingSyncItem, PendingSyncStore } from '../server/cloud/pendingSyncStore';
import { createCloudRouter } from '../server/routes/cloud';

const user: SupabaseUser = { id: '11111111-1111-4111-8111-111111111111', email: 'user@example.test' };

class FakeRegistry implements RegistryService {
  writes: Array<{ table: string; value: Record<string, unknown> }> = [];
  failWrites = false;

  async status(): Promise<CloudRegistryStatus> {
    return { provider: 'supabase', configured: true, available: true, status: 'available', safeMessage: 'ok', checkedAt: new Date().toISOString() };
  }
  async signIn(): Promise<SupabaseSession> {
    return { accessToken: 'access', refreshToken: 'refresh', tokenType: 'bearer', user };
  }
  async refreshSession(): Promise<SupabaseSession> { return this.signIn(); }
  async signOut(): Promise<void> {}
  async getUser(token: string): Promise<SupabaseUser> {
    assert.equal(token, 'valid-token');
    return user;
  }
  async select<T extends Record<string, unknown>>(): Promise<T[]> { return [] as T[]; }
  async insert<T extends Record<string, unknown>>(table: string, _token: string, value: Record<string, unknown>): Promise<T[]> {
    this.writes.push({ table, value });
    return [value as T];
  }
  async upsert<T extends Record<string, unknown>>(table: string, _token: string, value: Record<string, unknown>): Promise<T[]> {
    if (this.failWrites) throw new CloudRegistryError('offline', 'NETWORK_ERROR', 503, true);
    this.writes.push({ table, value });
    return [value as T];
  }
  async update<T extends Record<string, unknown>>(table: string, _token: string, value: Record<string, unknown>): Promise<T[]> {
    this.writes.push({ table, value });
    return [value as T];
  }
}

async function withServer(run: (baseUrl: string, fake: FakeRegistry, pending: PendingSyncItem[]) => Promise<void>): Promise<void> {
  const fake = new FakeRegistry();
  const pending: PendingSyncItem[] = [];
  const pendingStore: PendingSyncStore = {
    enqueue(input) {
      const item: PendingSyncItem = { ...input, id: `pending-${pending.length + 1}`, state: 'pending', createdAt: new Date().toISOString() };
      pending.push(item);
      return item;
    },
  };
  const app = express();
  app.use(express.json());
  app.use(createCloudRouter(fake, pendingStore));
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address === 'object');
  try { await run(`http://127.0.0.1:${address.port}`, fake, pending); }
  finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}

async function main(): Promise<void> {
  const missing = new SupabaseRegistry({ env: {} });
  const missingStatus = await missing.status();
  assert.deepEqual(missingStatus, {
    provider: 'supabase', configured: false, available: false, status: 'configuration_required',
    errorCode: 'CONFIGURATION_REQUIRED', safeMessage: 'Supabase URL and anonymous key are required.',
    checkedAt: missingStatus.checkedAt,
  });

  let capturedHeaders: Headers | undefined;
  const registry = new SupabaseRegistry({
    env: { SUPABASE_URL: 'https://project.example.test', SUPABASE_ANON_KEY: 'anon-secret' },
    fetchImpl: (async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedHeaders = new Headers(init?.headers);
      return new Response(JSON.stringify({ id: user.id, email: user.email }), { status: 200 });
    }) as typeof fetch,
  });
  const fetchedUser = await registry.getUser('user-token');
  assert.equal(fetchedUser.id, user.id);
  assert.equal(fetchedUser.email, user.email);
  assert.equal(capturedHeaders?.get('apikey'), 'anon-secret');
  assert.equal(capturedHeaders?.get('authorization'), 'Bearer user-token');

  await withServer(async (baseUrl, fake, pending) => {
    const unauthorized = await fetch(`${baseUrl}/api/devices`);
    assert.equal(unauthorized.status, 401);
    assert.equal((await unauthorized.json() as { errorCode: string }).errorCode, 'AUTH_REQUIRED');

    const response = await fetch(`${baseUrl}/api/workspace/registry`, {
      method: 'PUT',
      headers: { Authorization: 'Bearer valid-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'workspace-1', user_id: 'attacker-user', label: 'Local workspace',
        local_path: 'D:\\Private\\EDITH', vault_path: 'D:\\Private\\Vault', raw_content: 'must-not-pass',
      }),
    });
    assert.equal(response.status, 200);
    const write = fake.writes.at(-1);
    assert.equal(write?.table, 'workspaces');
    assert.equal(write?.value.user_id, user.id);
    assert.equal(write?.value.sync_mode, 'metadata_only');
    assert.equal('raw_content' in (write?.value ?? {}), false);

    const secretResponse = await fetch(`${baseUrl}/api/settings`, {
      method: 'PUT',
      headers: { Authorization: 'Bearer valid-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'provider', value: { apiKey: 'must-not-sync' } }),
    });
    assert.equal(secretResponse.status, 400);
    assert.equal((await secretResponse.json() as { errorCode: string }).errorCode, 'SECRET_FIELD_REJECTED');

    const sessionResponse = await fetch(`${baseUrl}/api/sessions/metadata`, {
      method: 'POST',
      headers: { Authorization: 'Bearer valid-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'session-1', device_id: 'device-1', state: 'active' }),
    });
    assert.equal(sessionResponse.status, 201);
    assert.equal(fake.writes.at(-1)?.table, 'session_metadata');
    assert.equal(fake.writes.at(-1)?.value.user_id, user.id);

    fake.failWrites = true;
    const pendingResponse = await fetch(`${baseUrl}/api/devices`, {
      method: 'POST',
      headers: { Authorization: 'Bearer valid-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'device-1', name: 'Offline device' }),
    });
    assert.equal(pendingResponse.status, 202);
    const pendingBody = await pendingResponse.json() as { pending: boolean; synced: boolean; errorCode: string };
    assert.equal(pendingBody.pending, true);
    assert.equal(pendingBody.synced, false);
    assert.equal(pendingBody.errorCode, 'NETWORK_ERROR');
    assert.equal(pending.length, 1);
    assert.equal(pending[0].userId, user.id);
  });

  console.log('EDITH Supabase registry contract tests passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
