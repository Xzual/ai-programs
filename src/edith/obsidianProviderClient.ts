import {
  parseObsidianProviderPublicStatusV1,
  type ObsidianProviderPublicStatusV1,
} from './contracts';
import { invokeDesktopCommand, isTauriShell } from './desktopShell';
import { ownerMutationFetch, primeOwnerSession } from './ownerMutationClient';

export type ObsidianProviderAction = 'activate' | 'change';
export type ObsidianProviderActionResult =
  | 'already_ready'
  | 'cancelled'
  | 'submitted'
  | 'configuration_required';

export class ObsidianProviderClientError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'ObsidianProviderClientError';
  }
}

export interface ObsidianProviderClientDependencies {
  readFetch: typeof fetch;
  mutationFetch: typeof ownerMutationFetch;
  primeSession: typeof primeOwnerSession;
  nativeAvailable: typeof isTauriShell;
  nativeInvoke: typeof invokeDesktopCommand;
  uuid: () => string;
}

const defaultDependencies: ObsidianProviderClientDependencies = {
  readFetch: (input, init) => fetch(input, init),
  mutationFetch: ownerMutationFetch,
  primeSession: primeOwnerSession,
  nativeAvailable: isTauriShell,
  nativeInvoke: invokeDesktopCommand,
  uuid: () => crypto.randomUUID(),
};

const SAFE_CODE = /^[A-Z][A-Z0-9_]{2,95}$/;
const STATUS_ENDPOINT = '/api/edith/obsidian/provider/status';

const safeMessages: Record<string, string> = {
  OWNER_SESSION_REQUIRED: 'Owner session is required to read Obsidian provider status.',
  OWNER_SESSION_EXPIRED: 'Owner session expired. Re-open the desktop application and retry.',
  CSRF_REJECTED: 'The protected desktop session could not validate this action.',
  DESKTOP_NATIVE_PICKER_REQUIRED: 'Desktop native picker required. Open E.D.I.T.H. in the desktop application.',
  NATIVE_SELECTION_REQUIRED: 'An explicit native folder selection is required.',
  OBSIDIAN_NATIVE_PICKER_CANCELLED: 'Folder selection was cancelled. No vault configuration changed.',
  OBSIDIAN_NATIVE_VERIFIER_UNAVAILABLE: 'The native selection was not verified. Obsidian remains unavailable.',
  OBSIDIAN_NATIVE_PICKER_RESPONSE_INVALID: 'The desktop picker returned an unreadable status. No connection is assumed.',
  OBSIDIAN_PROVIDER_STATUS_INVALID: 'Obsidian provider returned an unsafe or unsupported status.',
  OBSIDIAN_PROVIDER_STATUS_INCONSISTENT: 'Obsidian provider status is inconsistent and cannot be shown as ready.',
  OBSIDIAN_PROVIDER_STATUS_SENSITIVE: 'Obsidian provider status was rejected because it contained sensitive fields.',
  OBSIDIAN_PROVIDER_STATUS_UNAVAILABLE: 'Obsidian provider status is unavailable.',
  OBSIDIAN_PROVIDER_REQUEST_FAILED: 'Obsidian provider request failed safely.',
  OBSIDIAN_PROVIDER_NOT_ACTIVE: 'No active Obsidian provider can be changed.',
  OBSIDIAN_PROVIDER_PERMISSION_DENIED: 'Obsidian provider access is blocked by the current safety policy.',
  KILL_SWITCH_ACTIVE: 'Obsidian provider changes are blocked while Emergency Stop is active.',
  IDEMPOTENCY_KEY_REQUIRED: 'The protected request could not create a valid operation identity.',
  IDEMPOTENCY_KEY_REUSED: 'This operation identity was already used. Retry the action explicitly.',
};

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;

function dependencies(overrides?: Partial<ObsidianProviderClientDependencies>): ObsidianProviderClientDependencies {
  return { ...defaultDependencies, ...overrides };
}

function safeCode(value: unknown, fallback: string): string {
  return typeof value === 'string' && SAFE_CODE.test(value) ? value : fallback;
}

async function responseCode(response: Response, fallback: string): Promise<string> {
  const payload = record(await response.clone().json().catch(() => undefined));
  return safeCode(payload?.errorCode ?? payload?.code, fallback);
}

function clientCode(error: unknown): string {
  if (error instanceof ObsidianProviderClientError) return error.code;
  const structuredCode = record(error)?.code;
  if (typeof structuredCode === 'string') {
    return safeCode(structuredCode.toUpperCase(), 'OBSIDIAN_PROVIDER_REQUEST_FAILED');
  }
  if (error instanceof Error) return safeCode(error.message.toUpperCase(), 'OBSIDIAN_PROVIDER_REQUEST_FAILED');
  return safeCode(error, 'OBSIDIAN_PROVIDER_REQUEST_FAILED');
}

export function obsidianProviderErrorMessage(error: unknown): string {
  const code = clientCode(error);
  return safeMessages[code] ?? safeMessages.OBSIDIAN_PROVIDER_REQUEST_FAILED;
}

export function isObsidianProviderReady(status?: ObsidianProviderPublicStatusV1): boolean {
  return Boolean(status && status.state === 'READY' && status.writable === true);
}

export async function fetchObsidianProviderStatus(
  signal?: AbortSignal,
  overrides?: Partial<ObsidianProviderClientDependencies>,
): Promise<ObsidianProviderPublicStatusV1> {
  const deps = dependencies(overrides);
  const session = await deps.primeSession();
  if (!session) throw new ObsidianProviderClientError('OWNER_SESSION_REQUIRED');
  const response = await deps.readFetch(STATUS_ENDPOINT, {
    signal,
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new ObsidianProviderClientError(await responseCode(response, 'OBSIDIAN_PROVIDER_STATUS_UNAVAILABLE'));
  }
  const payload = record(await response.json().catch(() => undefined));
  const parsed = parseObsidianProviderPublicStatusV1(payload?.status);
  if (parsed.success === false) throw new ObsidianProviderClientError(parsed.errorCode);
  return parsed.value;
}

function idempotencyKey(action: string, deps: ObsidianProviderClientDependencies): string {
  return `obsidian.${action}.${deps.uuid()}`;
}

async function protectedEmptyMutation(
  action: ObsidianProviderAction | 'revoke',
  deps: ObsidianProviderClientDependencies,
): Promise<Response> {
  return deps.mutationFetch(`/api/edith/obsidian/provider/${action}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'x-idempotency-key': idempotencyKey(action, deps),
    },
    body: '{}',
  });
}

function nativeOutcome(value: unknown): { status: string; publication: string } {
  const row = record(value);
  const status = typeof row?.status === 'string' ? row.status : '';
  const publication = typeof row?.publication === 'string' ? row.publication : '';
  if (
    (status === 'cancelled' && publication === 'none')
    || (status === 'selected' && publication === 'submitted')
    || (status === 'selected_pending_verifier' && publication === 'configuration_required')
  ) return { status, publication };
  throw new ObsidianProviderClientError('OBSIDIAN_NATIVE_PICKER_RESPONSE_INVALID');
}

export async function requestObsidianProviderSelection(
  action: ObsidianProviderAction,
  overrides?: Partial<ObsidianProviderClientDependencies>,
): Promise<{ result: ObsidianProviderActionResult; status: ObsidianProviderPublicStatusV1 }> {
  const deps = dependencies(overrides);
  const mutation = await protectedEmptyMutation(action, deps);
  if (mutation.ok) {
    return { result: 'already_ready', status: await fetchObsidianProviderStatus(undefined, deps) };
  }
  const code = await responseCode(mutation, 'OBSIDIAN_PROVIDER_REQUEST_FAILED');
  if (mutation.status !== 428 || code !== 'NATIVE_SELECTION_REQUIRED') {
    throw new ObsidianProviderClientError(code);
  }
  if (!deps.nativeAvailable()) throw new ObsidianProviderClientError('DESKTOP_NATIVE_PICKER_REQUIRED');

  let outcome: { status: string; publication: string };
  try {
    outcome = nativeOutcome(await deps.nativeInvoke<unknown>('obsidian_request_vault_folder'));
  } catch (error) {
    throw new ObsidianProviderClientError(clientCode(error));
  }
  const status = await fetchObsidianProviderStatus(undefined, deps);
  if (outcome.status === 'cancelled') return { result: 'cancelled', status };
  if (outcome.publication === 'configuration_required') return { result: 'configuration_required', status };
  return { result: 'submitted', status };
}

export async function revokeObsidianProvider(
  overrides?: Partial<ObsidianProviderClientDependencies>,
): Promise<ObsidianProviderPublicStatusV1> {
  const deps = dependencies(overrides);
  const response = await protectedEmptyMutation('revoke', deps);
  if (!response.ok) {
    throw new ObsidianProviderClientError(await responseCode(response, 'OBSIDIAN_PROVIDER_REQUEST_FAILED'));
  }
  return fetchObsidianProviderStatus(undefined, deps);
}
