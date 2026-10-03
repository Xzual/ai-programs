import { establishDesktopOwnerSession, isTauriShell, type DesktopOwnerSession } from './desktopShell';

const CSRF_HEADER = 'X-EDITH-CSRF-Token';
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

let ownerSession: DesktopOwnerSession | null = null;
let sessionRequest: Promise<DesktopOwnerSession | null> | null = null;

export class OwnerSessionError extends Error {
  constructor(public readonly code: 'owner_session_required' | 'owner_session_expired' | 'csrf_rejected', message: string) {
    super(message);
    this.name = 'OwnerSessionError';
  }
}

function sameOriginApi(input: RequestInfo | URL): boolean {
  if (typeof window === 'undefined') return false;
  const raw = input instanceof Request ? input.url : String(input);
  const url = new URL(raw, window.location.origin);
  return url.origin === window.location.origin && url.pathname.startsWith('/api/');
}

async function readCurrentSession(): Promise<DesktopOwnerSession | null> {
  const response = await fetch('/api/security/session', {
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) return null;
  const payload = await response.json().catch(() => null) as { session?: DesktopOwnerSession } | null;
  return payload?.session?.csrfToken ? payload.session : null;
}

async function acquireOwnerSession(): Promise<DesktopOwnerSession | null> {
  const existing = await readCurrentSession();
  if (existing) return existing;
  return isTauriShell() ? establishDesktopOwnerSession() : null;
}

export function clearOwnerSessionMemory(): void {
  ownerSession = null;
  sessionRequest = null;
}

export async function primeOwnerSession(): Promise<DesktopOwnerSession | null> {
  if (ownerSession?.csrfToken) return ownerSession;
  if (!sessionRequest) {
    sessionRequest = acquireOwnerSession()
      .then((session) => {
        ownerSession = session;
        return session;
      })
      .finally(() => {
        sessionRequest = null;
      });
  }
  return sessionRequest;
}

async function responseCode(response: Response): Promise<string | undefined> {
  const body = await response.clone().json().catch(() => null) as { code?: unknown; errorCode?: unknown } | null;
  return typeof body?.code === 'string'
    ? body.code
    : typeof body?.errorCode === 'string'
      ? body.errorCode
      : undefined;
}

function requestWithSession(input: RequestInfo | URL, init: RequestInit, session: DesktopOwnerSession): Promise<Response> {
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  headers.set(CSRF_HEADER, session.csrfToken);
  return fetch(input, { ...init, method: (init.method ?? 'POST').toUpperCase(), credentials: 'include', headers });
}

export async function ownerMutationFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  if (!UNSAFE_METHODS.has(method)) return fetch(input, { ...init, credentials: init.credentials ?? 'include' });
  if (!sameOriginApi(input)) {
    throw new OwnerSessionError('owner_session_required', 'Owner mutations are restricted to same-origin API routes.');
  }

  let session: DesktopOwnerSession | null;
  try {
    session = await primeOwnerSession();
  } catch {
    clearOwnerSessionMemory();
    throw new OwnerSessionError('owner_session_required', 'Owner session could not be established.');
  }
  if (!session) {
    throw new OwnerSessionError('owner_session_required', 'Owner session is required for this action.');
  }

  let response = await requestWithSession(input, init, session);
  const firstCode = response.status === 401 || response.status === 403 ? await responseCode(response) : undefined;
  const csrfRejected = response.status === 403 && firstCode?.toLowerCase().includes('csrf');
  if (response.status !== 401 && firstCode !== 'owner_session_required' && firstCode !== 'owner_session_expired' && !csrfRejected) {
    return response;
  }

  clearOwnerSessionMemory();
  try {
    session = await primeOwnerSession();
  } catch {
    throw new OwnerSessionError(csrfRejected ? 'csrf_rejected' : 'owner_session_expired', 'Owner session could not be restored.');
  }
  if (!session) throw new OwnerSessionError('owner_session_expired', 'Owner session expired and could not be restored.');
  response = await requestWithSession(input, init, session);
  if (response.status === 401 || response.status === 403) {
    clearOwnerSessionMemory();
    const code = await responseCode(response);
    throw new OwnerSessionError(code?.toLowerCase().includes('csrf') ? 'csrf_rejected' : 'owner_session_expired', 'Owner session validation failed.');
  }
  return response;
}
