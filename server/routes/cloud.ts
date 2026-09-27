import { Router, type Request, type Response } from 'express';
import { supabaseRegistry } from '../cloud/supabaseRegistry';
import { CloudRegistryError, type RegistryService, type SupabaseUser } from '../cloud/types';
import { pendingSyncStore, type PendingSyncStore } from '../cloud/pendingSyncStore';

const DEVICE_FIELDS = ['id', 'name', 'platform', 'app_version', 'workspace_id', 'last_seen_at', 'metadata'] as const;
const WORKSPACE_FIELDS = ['id', 'device_id', 'label', 'local_path', 'vault_path', 'portable_mode', 'layout_version', 'sync_mode', 'metadata', 'updated_at'] as const;
const SETTINGS_FIELDS = ['key', 'value', 'updated_at'] as const;
const CONVERSATION_FIELDS = ['id', 'workspace_id', 'title', 'provider_id', 'model_id', 'message_count', 'last_message_at', 'metadata'] as const;
const SKILL_FIELDS = ['skill_id', 'enabled', 'version', 'configuration_state', 'metadata', 'updated_at'] as const;
const SESSION_FIELDS = ['id', 'device_id', 'workspace_id', 'state', 'started_at', 'last_seen_at', 'ended_at', 'metadata'] as const;
const SYNC_FIELDS = ['id', 'device_id', 'workspace_id', 'entity_type', 'entity_id', 'operation', 'state', 'metadata', 'created_at'] as const;
const SECRET_FIELD = /(?:api[_-]?key|secret|password|token|authorization|credential)/i;
const MAX_METADATA_BYTES = 64 * 1024;

function bearerToken(req: Request): string {
  const header = req.header('authorization') ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) throw new CloudRegistryError('Authentication is required.', 'AUTH_REQUIRED', 401);
  return match[1].trim();
}

function requiredString(value: unknown, field: string): string {
  const result = typeof value === 'string' ? value.trim() : '';
  if (!result) throw new CloudRegistryError(`${field} is required.`, 'VALIDATION_ERROR', 400);
  return result;
}

function pick(body: unknown, fields: readonly string[]): Record<string, unknown> {
  const source = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  const selected = Object.fromEntries(fields.filter((field) => source[field] !== undefined).map((field) => [field, source[field]]));
  rejectSecrets(selected);
  if (Buffer.byteLength(JSON.stringify(selected), 'utf8') > MAX_METADATA_BYTES) {
    throw new CloudRegistryError('Registry metadata is too large.', 'PAYLOAD_TOO_LARGE', 413);
  }
  return selected;
}

function rejectSecrets(value: unknown, path = 'metadata'): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectSecrets(entry, `${path}[${index}]`));
    return;
  }
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_FIELD.test(key)) {
      throw new CloudRegistryError(`Secret-like field is not allowed in cloud metadata: ${path}.${key}`, 'SECRET_FIELD_REJECTED', 400);
    }
    rejectSecrets(nested, `${path}.${key}`);
  }
}

function boundedLimit(value: unknown): number {
  const parsed = Number.parseInt(String(value ?? '100'), 10);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(parsed, 250)) : 100;
}

function ownQuery(user: SupabaseUser, req: Request, idField?: string): URLSearchParams {
  const query = new URLSearchParams({ user_id: `eq.${user.id}`, limit: String(boundedLimit(req.query.limit)) });
  if (idField && req.params.id) query.set(idField, `eq.${req.params.id}`);
  return query;
}

function sendError(res: Response, error: unknown): void {
  const mapped = error instanceof CloudRegistryError
    ? error
    : new CloudRegistryError('Cloud registry request failed.', 'INTERNAL_ERROR', 500);
  res.status(mapped.statusCode).json({
    success: false,
    status: mapped.code === 'CONFIGURATION_REQUIRED' ? 'configuration_required' : 'failed',
    errorCode: mapped.code,
    error: mapped.message,
    retryable: mapped.retryable,
  });
}

async function authenticated(req: Request, service: RegistryService): Promise<{ token: string; user: SupabaseUser }> {
  const token = bearerToken(req);
  return { token, user: await service.getUser(token) };
}

function queueRetryable(
  res: Response,
  error: unknown,
  store: PendingSyncStore,
  user: SupabaseUser,
  entity: string,
  operation: string,
  payload: Record<string, unknown>,
): boolean {
  if (!(error instanceof CloudRegistryError) || !error.retryable) return false;
  const pending = store.enqueue({ userId: user.id, entity, operation, payload });
  res.status(202).json({
    success: true,
    synced: false,
    pending: true,
    pendingId: pending.id,
    status: 'pending',
    errorCode: error.code,
    safeMessage: 'Cloud registry is unavailable; metadata remains queued locally.',
  });
  return true;
}

export function createCloudRouter(service: RegistryService = supabaseRegistry, pendingStore: PendingSyncStore = pendingSyncStore): Router {
  const router = Router();

  router.get('/api/cloud/status', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, ...(await service.status()), mode: 'metadata_only' });
  });

  router.post('/api/account/sign-in', async (req, res) => {
    try {
      const email = requiredString(req.body?.email, 'email');
      const password = requiredString(req.body?.password, 'password');
      const session = await service.signIn(email, password);
      let metadataSynced = true;
      try {
        await service.upsert('profiles', session.accessToken, {
          user_id: session.user.id,
          email: session.user.email,
          last_login_at: new Date().toISOString(),
        }, 'user_id');
      } catch {
        metadataSynced = false;
      }
      res.setHeader('Cache-Control', 'no-store');
      res.json({ success: true, session, metadataSynced });
    } catch (error) { sendError(res, error); }
  });

  router.post('/api/account/refresh', async (req, res) => {
    try {
      const session = await service.refreshSession(requiredString(req.body?.refreshToken, 'refreshToken'));
      res.setHeader('Cache-Control', 'no-store');
      res.json({ success: true, session });
    } catch (error) { sendError(res, error); }
  });

  router.post('/api/account/sign-out', async (req, res) => {
    try {
      const { token, user } = await authenticated(req, service);
      const sessionId = typeof req.body?.sessionId === 'string' ? req.body.sessionId.trim() : '';
      if (sessionId) {
        const query = new URLSearchParams({ user_id: `eq.${user.id}`, id: `eq.${sessionId}` });
        await service.update('session_metadata', token, { state: 'ended', ended_at: new Date().toISOString() }, query).catch(() => undefined);
      }
      await service.signOut(token);
      res.json({ success: true });
    } catch (error) { sendError(res, error); }
  });

  router.get('/api/account/me', async (req, res) => {
    try {
      const { token, user } = await authenticated(req, service);
      const profile = await service.select('profiles', token, new URLSearchParams({ user_id: `eq.${user.id}`, limit: '1' }));
      res.setHeader('Cache-Control', 'no-store');
      res.json({ success: true, user, profile: profile[0] ?? null });
    } catch (error) { sendError(res, error); }
  });

  router.get('/api/devices', async (req, res) => {
    try {
      const { token, user } = await authenticated(req, service);
      res.json({ success: true, devices: await service.select('devices', token, ownQuery(user, req)) });
    } catch (error) { sendError(res, error); }
  });

  router.post('/api/devices', async (req, res) => {
    try {
      const { token, user } = await authenticated(req, service);
      const value: Record<string, unknown> = { ...pick(req.body, DEVICE_FIELDS), user_id: user.id, last_seen_at: new Date().toISOString() };
      let devices;
      try { devices = await service.upsert('devices', token, value, 'id'); }
      catch (error) { if (queueRetryable(res, error, pendingStore, user, 'device', 'upsert', value)) return; throw error; }
      res.status(201).json({ success: true, device: devices[0] ?? value });
    } catch (error) { sendError(res, error); }
  });

  router.patch('/api/devices/:id', async (req, res) => {
    try {
      const { token, user } = await authenticated(req, service);
      const query = ownQuery(user, req, 'id');
      query.delete('limit');
      const value: Record<string, unknown> = { ...pick(req.body, DEVICE_FIELDS.filter((field) => field !== 'id')), last_seen_at: new Date().toISOString() };
      let devices;
      try { devices = await service.update('devices', token, value, query); }
      catch (error) { if (queueRetryable(res, error, pendingStore, user, 'device', 'update', { id: req.params.id, ...value })) return; throw error; }
      res.json({ success: true, device: devices[0] ?? null });
    } catch (error) { sendError(res, error); }
  });

  router.get('/api/workspace/registry', async (req, res) => {
    try {
      const { token, user } = await authenticated(req, service);
      res.json({ success: true, workspaces: await service.select('workspaces', token, ownQuery(user, req)), syncMode: 'metadata_only' });
    } catch (error) { sendError(res, error); }
  });

  router.put('/api/workspace/registry', async (req, res) => {
    try {
      const { token, user } = await authenticated(req, service);
      const value: Record<string, unknown> = { ...pick(req.body, WORKSPACE_FIELDS), user_id: user.id, sync_mode: 'metadata_only', updated_at: new Date().toISOString() };
      requiredString(value.id, 'id');
      let workspaces;
      try { workspaces = await service.upsert('workspaces', token, value, 'id'); }
      catch (error) { if (queueRetryable(res, error, pendingStore, user, 'workspace', 'upsert', value)) return; throw error; }
      res.json({ success: true, workspace: workspaces[0] ?? value, syncMode: 'metadata_only' });
    } catch (error) { sendError(res, error); }
  });

  router.get('/api/settings', async (req, res) => {
    try {
      const { token, user } = await authenticated(req, service);
      res.json({ success: true, settings: await service.select('user_settings', token, ownQuery(user, req)) });
    } catch (error) { sendError(res, error); }
  });

  router.put('/api/settings', async (req, res) => {
    try {
      const { token, user } = await authenticated(req, service);
      const value: Record<string, unknown> = { ...pick(req.body, SETTINGS_FIELDS), user_id: user.id, updated_at: new Date().toISOString() };
      requiredString(value.key, 'key');
      let settings;
      try { settings = await service.upsert('user_settings', token, value, 'user_id,key'); }
      catch (error) { if (queueRetryable(res, error, pendingStore, user, 'setting', 'upsert', value)) return; throw error; }
      res.json({ success: true, setting: settings[0] ?? value });
    } catch (error) { sendError(res, error); }
  });

  router.get('/api/conversations/metadata', async (req, res) => {
    try {
      const { token, user } = await authenticated(req, service);
      res.json({ success: true, conversations: await service.select('conversation_metadata', token, ownQuery(user, req)) });
    } catch (error) { sendError(res, error); }
  });

  router.post('/api/conversations/metadata', async (req, res) => {
    try {
      const { token, user } = await authenticated(req, service);
      const value: Record<string, unknown> = { ...pick(req.body, CONVERSATION_FIELDS), user_id: user.id };
      requiredString(value.id, 'id');
      let rows;
      try { rows = await service.upsert('conversation_metadata', token, value, 'id'); }
      catch (error) { if (queueRetryable(res, error, pendingStore, user, 'conversation_metadata', 'upsert', value)) return; throw error; }
      res.status(201).json({ success: true, conversation: rows[0] ?? value, contentStored: false });
    } catch (error) { sendError(res, error); }
  });

  router.get('/api/skills/metadata', async (req, res) => {
    try {
      const { token, user } = await authenticated(req, service);
      res.json({ success: true, skills: await service.select('skill_metadata', token, ownQuery(user, req)) });
    } catch (error) { sendError(res, error); }
  });

  router.put('/api/skills/metadata', async (req, res) => {
    try {
      const { token, user } = await authenticated(req, service);
      const value: Record<string, unknown> = { ...pick(req.body, SKILL_FIELDS), user_id: user.id, updated_at: new Date().toISOString() };
      requiredString(value.skill_id, 'skill_id');
      let rows;
      try { rows = await service.upsert('skill_metadata', token, value, 'user_id,skill_id'); }
      catch (error) { if (queueRetryable(res, error, pendingStore, user, 'skill_metadata', 'upsert', value)) return; throw error; }
      res.json({ success: true, skill: rows[0] ?? value });
    } catch (error) { sendError(res, error); }
  });

  router.get('/api/sessions/metadata', async (req, res) => {
    try {
      const { token, user } = await authenticated(req, service);
      res.json({ success: true, sessions: await service.select('session_metadata', token, ownQuery(user, req)) });
    } catch (error) { sendError(res, error); }
  });

  router.post('/api/sessions/metadata', async (req, res) => {
    try {
      const { token, user } = await authenticated(req, service);
      const value: Record<string, unknown> = {
        ...pick(req.body, SESSION_FIELDS),
        user_id: user.id,
        state: typeof req.body?.state === 'string' ? req.body.state : 'active',
        last_seen_at: new Date().toISOString(),
      };
      requiredString(value.id, 'id');
      let rows;
      try { rows = await service.upsert('session_metadata', token, value, 'id'); }
      catch (error) { if (queueRetryable(res, error, pendingStore, user, 'session_metadata', 'upsert', value)) return; throw error; }
      res.status(201).json({ success: true, session: rows[0] ?? value });
    } catch (error) { sendError(res, error); }
  });

  router.get('/api/sync/events', async (req, res) => {
    try {
      const { token, user } = await authenticated(req, service);
      res.json({ success: true, events: await service.select('sync_events', token, ownQuery(user, req)) });
    } catch (error) { sendError(res, error); }
  });

  router.post('/api/sync/events', async (req, res) => {
    try {
      const { token, user } = await authenticated(req, service);
      const value: Record<string, unknown> = { ...pick(req.body, SYNC_FIELDS), user_id: user.id };
      requiredString(value.entity_type, 'entity_type');
      requiredString(value.operation, 'operation');
      let rows;
      try { rows = await service.insert('sync_events', token, value); }
      catch (error) { if (queueRetryable(res, error, pendingStore, user, 'sync_event', 'insert', value)) return; throw error; }
      res.status(201).json({ success: true, event: rows[0] ?? value });
    } catch (error) { sendError(res, error); }
  });

  return router;
}
