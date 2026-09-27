import {
  CloudRegistryError,
  type CloudRegistryStatus,
  type RegistryService,
  type SupabaseSession,
  type SupabaseUser,
} from './types';

type FetchLike = typeof fetch;

interface SupabaseRegistryOptions {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

const ALLOWED_TABLES = new Set([
  'profiles',
  'devices',
  'workspaces',
  'user_settings',
  'conversation_metadata',
  'skill_metadata',
  'session_metadata',
  'sync_events',
]);

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function toUser(value: unknown): SupabaseUser {
  const user = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const id = text(user.id);
  if (!id) throw new CloudRegistryError('Supabase returned a malformed user response.', 'MALFORMED_RESPONSE', 502);
  return {
    id,
    email: text(user.email) || undefined,
    createdAt: text(user.created_at) || undefined,
  };
}

function toSession(value: unknown): SupabaseSession {
  const data = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const accessToken = text(data.access_token);
  const refreshToken = text(data.refresh_token);
  if (!accessToken || !refreshToken || !data.user) {
    throw new CloudRegistryError('Supabase returned a malformed session response.', 'MALFORMED_RESPONSE', 502);
  }
  return {
    accessToken,
    refreshToken,
    expiresAt: typeof data.expires_at === 'number' ? data.expires_at : undefined,
    tokenType: text(data.token_type) || 'bearer',
    user: toUser(data.user),
  };
}

function mapResponseError(status: number, payload: unknown): CloudRegistryError {
  const body = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const providerCode = text(body.error_code) || text(body.code);
  const providerMessage = text(body.msg) || text(body.message) || text(body.error_description);
  if (status === 400 && /invalid.*credential|invalid.*login/i.test(providerMessage)) {
    return new CloudRegistryError('Email or password is incorrect.', 'INVALID_CREDENTIALS', 401);
  }
  if (status === 401 || status === 403) {
    return new CloudRegistryError('The Supabase session is invalid or expired.', 'AUTH_REQUIRED', 401);
  }
  if (status === 409) return new CloudRegistryError('The registry record conflicts with an existing record.', 'CONFLICT', 409);
  if (status === 429) return new CloudRegistryError('Supabase rate limit reached.', 'RATE_LIMITED', 429, true);
  const code = providerCode ? `SUPABASE_${providerCode.toUpperCase()}` : 'SUPABASE_REQUEST_FAILED';
  return new CloudRegistryError(providerMessage || `Supabase request failed with status ${status}.`, code, status >= 500 ? 503 : 400, status >= 500);
}

export class SupabaseRegistry implements RegistryService {
  private readonly baseUrl: string;
  private readonly anonKey: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(options: SupabaseRegistryOptions = {}) {
    const env = options.env ?? process.env;
    this.baseUrl = text(env.SUPABASE_URL).replace(/\/$/, '');
    this.anonKey = text(env.SUPABASE_ANON_KEY);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? Number.parseInt(env.SUPABASE_TIMEOUT_MS || '6000', 10);
  }

  configured(): boolean {
    return Boolean(this.baseUrl && this.anonKey);
  }

  async status(): Promise<CloudRegistryStatus> {
    const checkedAt = new Date().toISOString();
    if (!this.configured()) {
      return {
        provider: 'supabase', configured: false, available: false, status: 'configuration_required',
        errorCode: 'CONFIGURATION_REQUIRED', safeMessage: 'Supabase URL and anonymous key are required.', checkedAt,
      };
    }
    try {
      await this.request('/auth/v1/health', { method: 'GET' }, undefined, true);
      return { provider: 'supabase', configured: true, available: true, status: 'available', safeMessage: 'Supabase is reachable.', checkedAt };
    } catch (error) {
      const mapped = this.normalizeError(error);
      return {
        provider: 'supabase', configured: true, available: false, status: 'unavailable',
        errorCode: mapped.code, safeMessage: mapped.message, checkedAt,
      };
    }
  }

  async signIn(email: string, password: string): Promise<SupabaseSession> {
    return toSession(await this.request('/auth/v1/token?grant_type=password', {
      method: 'POST', body: JSON.stringify({ email, password }),
    }));
  }

  async refreshSession(refreshToken: string): Promise<SupabaseSession> {
    return toSession(await this.request('/auth/v1/token?grant_type=refresh_token', {
      method: 'POST', body: JSON.stringify({ refresh_token: refreshToken }),
    }));
  }

  async signOut(accessToken: string): Promise<void> {
    await this.request('/auth/v1/logout', { method: 'POST' }, accessToken, true);
  }

  async getUser(accessToken: string): Promise<SupabaseUser> {
    return toUser(await this.request('/auth/v1/user', { method: 'GET' }, accessToken));
  }

  select<T extends Record<string, unknown>>(table: string, accessToken: string, query = new URLSearchParams()): Promise<T[]> {
    query.set('select', query.get('select') || '*');
    return this.rest<T>(table, accessToken, `?${query.toString()}`, { method: 'GET' });
  }

  insert<T extends Record<string, unknown>>(table: string, accessToken: string, value: Record<string, unknown>): Promise<T[]> {
    return this.rest<T>(table, accessToken, '', { method: 'POST', body: JSON.stringify(value) }, 'return=representation');
  }

  upsert<T extends Record<string, unknown>>(
    table: string,
    accessToken: string,
    value: Record<string, unknown>,
    onConflict?: string,
  ): Promise<T[]> {
    const suffix = onConflict ? `?on_conflict=${encodeURIComponent(onConflict)}` : '';
    return this.rest<T>(table, accessToken, suffix, { method: 'POST', body: JSON.stringify(value) }, 'resolution=merge-duplicates,return=representation');
  }

  update<T extends Record<string, unknown>>(
    table: string,
    accessToken: string,
    value: Record<string, unknown>,
    query: URLSearchParams,
  ): Promise<T[]> {
    return this.rest<T>(table, accessToken, `?${query.toString()}`, { method: 'PATCH', body: JSON.stringify(value) }, 'return=representation');
  }

  private rest<T extends Record<string, unknown>>(
    table: string,
    accessToken: string,
    suffix: string,
    init: RequestInit,
    prefer?: string,
  ): Promise<T[]> {
    if (!ALLOWED_TABLES.has(table)) throw new CloudRegistryError('Registry table is not allowed.', 'INVALID_TABLE', 400);
    return this.request(`/rest/v1/${table}${suffix}`, init, accessToken, false, prefer) as Promise<T[]>;
  }

  private async request(
    path: string,
    init: RequestInit,
    accessToken?: string,
    allowEmpty = false,
    prefer?: string,
  ): Promise<unknown> {
    if (!this.configured()) throw new CloudRegistryError('Supabase is not configured.', 'CONFIGURATION_REQUIRED', 503);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Number.isFinite(this.timeoutMs) ? this.timeoutMs : 6000);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          apikey: this.anonKey,
          Authorization: `Bearer ${accessToken || this.anonKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(prefer ? { Prefer: prefer } : {}),
          ...init.headers,
        },
      });
      const raw = await response.text();
      let payload: unknown = undefined;
      if (raw) {
        try { payload = JSON.parse(raw); } catch { throw new CloudRegistryError('Supabase returned malformed JSON.', 'MALFORMED_RESPONSE', 502); }
      }
      if (!response.ok) throw mapResponseError(response.status, payload);
      return payload ?? (allowEmpty ? {} : []);
    } catch (error) {
      throw this.normalizeError(error);
    } finally {
      clearTimeout(timer);
    }
  }

  private normalizeError(error: unknown): CloudRegistryError {
    if (error instanceof CloudRegistryError) return error;
    if (error instanceof Error && error.name === 'AbortError') {
      return new CloudRegistryError('Supabase request timed out.', 'PROVIDER_TIMEOUT', 503, true);
    }
    return new CloudRegistryError('Supabase is unreachable.', 'NETWORK_ERROR', 503, true);
  }
}

export const supabaseRegistry = new SupabaseRegistry();
