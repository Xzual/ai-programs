export type CloudRegistryStatusCode = 'available' | 'configuration_required' | 'unavailable';

export interface CloudRegistryStatus {
  provider: 'supabase';
  configured: boolean;
  available: boolean;
  status: CloudRegistryStatusCode;
  errorCode?: string;
  safeMessage: string;
  checkedAt: string;
}

export interface SupabaseUser {
  id: string;
  email?: string;
  createdAt?: string;
}

export interface SupabaseSession {
  accessToken: string;
  refreshToken: string;
  expiresAt?: number;
  tokenType: string;
  user: SupabaseUser;
}

export interface RegistryService {
  status(): Promise<CloudRegistryStatus>;
  signIn(email: string, password: string): Promise<SupabaseSession>;
  refreshSession(refreshToken: string): Promise<SupabaseSession>;
  signOut(accessToken: string): Promise<void>;
  getUser(accessToken: string): Promise<SupabaseUser>;
  select<T extends Record<string, unknown>>(table: string, accessToken: string, query?: URLSearchParams): Promise<T[]>;
  insert<T extends Record<string, unknown>>(table: string, accessToken: string, value: Record<string, unknown>): Promise<T[]>;
  upsert<T extends Record<string, unknown>>(
    table: string,
    accessToken: string,
    value: Record<string, unknown>,
    onConflict?: string,
  ): Promise<T[]>;
  update<T extends Record<string, unknown>>(
    table: string,
    accessToken: string,
    value: Record<string, unknown>,
    query: URLSearchParams,
  ): Promise<T[]>;
}

export class CloudRegistryError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly statusCode: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'CloudRegistryError';
  }
}
