import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type { ObsidianProviderPublicStatusV1 } from '../src/edith/contracts';
import {
  fetchObsidianProviderStatus,
  obsidianProviderErrorMessage,
  requestObsidianProviderSelection,
  revokeObsidianProvider,
  type ObsidianProviderClientDependencies,
} from '../src/edith/obsidianProviderClient';

const checkedAt = '2026-09-29T12:00:00.000Z';
const firstRun: ObsidianProviderPublicStatusV1 = {
  contractVersion: 2,
  amendment: '2.1',
  state: 'FIRST_RUN_REQUIRED',
  reasonCode: 'VAULT_SELECTION_REQUIRED',
  provider: 'none',
  configured: false,
  available: false,
  readable: false,
  writable: false,
  selectionAction: 'show_first_run',
  promptPolicy: 'user_initiated_only',
  configRevision: 0,
  executionAuthority: false,
  knowledgeOnly: true,
  checkedAt,
};
const ready: ObsidianProviderPublicStatusV1 = {
  ...firstRun,
  state: 'READY',
  reasonCode: 'VAULT_READY',
  provider: 'user_vault',
  configured: true,
  available: true,
  readable: true,
  writable: true,
  selectionAction: 'none',
  configRevision: 1,
};
const revoked: ObsidianProviderPublicStatusV1 = {
  ...firstRun,
  reasonCode: 'VAULT_SELECTION_REVOKED',
  configRevision: 2,
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
});

function harness(options: {
  mutation?: Response;
  statuses?: ObsidianProviderPublicStatusV1[];
  nativeAvailable?: boolean;
  nativeResult?: unknown;
}) {
  const calls: Array<{ kind: string; input?: string; init?: RequestInit; command?: string; args?: unknown }> = [];
  const statuses = [...(options.statuses ?? [firstRun])];
  let uuidIndex = 0;
  const deps: ObsidianProviderClientDependencies = {
    primeSession: async () => ({ actor: 'owner', csrfToken: 'test-csrf', createdAt: checkedAt, expiresAt: checkedAt }),
    readFetch: async (input, init) => {
      calls.push({ kind: 'read', input: String(input), init });
      return json({ success: true, status: statuses.shift() ?? firstRun });
    },
    mutationFetch: async (input, init) => {
      calls.push({ kind: 'mutation', input: String(input), init });
      return options.mutation?.clone() ?? json({ code: 'NATIVE_SELECTION_REQUIRED' }, 428);
    },
    nativeAvailable: () => options.nativeAvailable ?? true,
    nativeInvoke: async (command, args) => {
      calls.push({ kind: 'native', command, args });
      return options.nativeResult as never;
    },
    uuid: () => `00000000-0000-4000-8000-${String(++uuidIndex).padStart(12, '0')}`,
  };
  return { calls, deps };
}

{
  const { calls, deps } = harness({ statuses: [firstRun] });
  assert.deepEqual(await fetchObsidianProviderStatus(undefined, deps), firstRun);
  assert.equal(calls[0]?.input, '/api/edith/obsidian/provider/status');
  assert.equal(calls[0]?.init?.credentials, 'include');
}

{
  const { calls, deps } = harness({ statuses: [ready], nativeResult: { status: 'selected', publication: 'submitted', selectionHandle: 'SECRET_HANDLE', absolutePath: 'C:\\secret\\vault' } });
  const result = await requestObsidianProviderSelection('activate', deps);
  assert.equal(result.result, 'submitted');
  assert.deepEqual(result.status, ready);
  const mutation = calls.find((call) => call.kind === 'mutation');
  assert.equal(mutation?.input, '/api/edith/obsidian/provider/activate');
  assert.equal(mutation?.init?.body, '{}');
  assert.match(new Headers(mutation?.init?.headers).get('x-idempotency-key') ?? '', /^obsidian\.activate\.[a-f0-9-]+$/i);
  const native = calls.find((call) => call.kind === 'native');
  assert.equal(native?.command, 'obsidian_request_vault_folder');
  assert.equal(native?.args, undefined);
  assert.equal(calls.filter((call) => call.kind === 'read').length, 1);
  assert.doesNotMatch(JSON.stringify(result), /SECRET_HANDLE|secret\\vault/);
}

{
  const { calls, deps } = harness({ statuses: [firstRun], nativeResult: { status: 'cancelled', publication: 'none', selectionHandle: 'MUST_NOT_SURFACE' } });
  const result = await requestObsidianProviderSelection('activate', deps);
  assert.equal(result.result, 'cancelled');
  assert.equal(result.status.state, 'FIRST_RUN_REQUIRED');
  assert.equal(calls.filter((call) => call.kind === 'read').length, 1);
  assert.doesNotMatch(JSON.stringify(result), /MUST_NOT_SURFACE/);
}

{
  const { calls, deps } = harness({ statuses: [firstRun], nativeAvailable: false });
  await assert.rejects(() => requestObsidianProviderSelection('activate', deps), /DESKTOP_NATIVE_PICKER_REQUIRED/);
  assert.equal(calls.some((call) => call.kind === 'native'), false);
}

{
  const { calls, deps } = harness({ mutation: json({ code: 'VAULT_UNAVAILABLE' }, 503), statuses: [firstRun] });
  await assert.rejects(() => requestObsidianProviderSelection('change', deps), /VAULT_UNAVAILABLE/);
  assert.equal(calls.some((call) => call.kind === 'native'), false);
}

{
  const { calls, deps } = harness({ mutation: json({ success: true }, 200), statuses: [revoked] });
  const result = await revokeObsidianProvider(deps);
  assert.equal(result.reasonCode, 'VAULT_SELECTION_REVOKED');
  const mutation = calls.find((call) => call.kind === 'mutation');
  assert.equal(mutation?.input, '/api/edith/obsidian/provider/revoke');
  assert.equal(mutation?.init?.body, '{}');
  assert.match(new Headers(mutation?.init?.headers).get('x-idempotency-key') ?? '', /^obsidian\.revoke\.[a-f0-9-]+$/i);
  assert.equal(calls.filter((call) => call.kind === 'read').length, 1);
}

{
  const { deps } = harness({ statuses: [{ ...firstRun, absolutePath: 'C:\\canary\\vault' } as ObsidianProviderPublicStatusV1] });
  await assert.rejects(() => fetchObsidianProviderStatus(undefined, deps), /OBSIDIAN_PROVIDER_STATUS_INVALID/);
  assert.doesNotMatch(obsidianProviderErrorMessage(new Error('C:\\canary\\vault TOKEN_CANARY')), /canary|TOKEN/i);
  assert.equal(
    obsidianProviderErrorMessage({ code: 'csrf_rejected', message: 'C:\\canary\\vault' }),
    'The protected desktop session could not validate this action.',
  );
}

const [panel, client, settingsRuntime, picker] = await Promise.all([
  readFile(new URL('../src/components/settings/ObsidianProviderPanel.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/edith/obsidianProviderClient.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/edith/settingsRuntimeService.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src-tauri/src/obsidian_picker.rs', import.meta.url), 'utf8'),
]);
assert.match(panel, /Obsidian klasörü seç/);
assert.match(panel, /reasonCode/);
assert.doesNotMatch(panel, /type=["']file["']|localStorage|sessionStorage/);
assert.doesNotMatch(client, /localStorage|sessionStorage/);
assert.doesNotMatch(settingsRuntime, /obsidianVaultPath|workspaceRoot/);
const signatureStart = picker.indexOf('pub fn obsidian_request_vault_folder(');
const signatureEnd = picker.indexOf(') -> Result<VaultPickerResult, String>', signatureStart);
assert.ok(signatureStart >= 0 && signatureEnd > signatureStart);
assert.doesNotMatch(picker.slice(signatureStart, signatureEnd), /path|handle|selection_id|device_id/i);

console.log(JSON.stringify({
  success: true,
  checks: [
    'status_contract_only',
    'explicit_428_native_picker_gate',
    'argument_free_native_invoke',
    'cancel_refetch_without_success',
    'browser_fail_closed',
    'non_428_never_opens_picker',
    'empty_protected_mutations',
    'unique_idempotency_keys',
    'revoke_refetch',
    'sensitive_status_rejected',
    'safe_error_copy',
    'no_path_storage_or_file_input',
  ],
}, null, 2));
