import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

type OwnerSession = { cookie: string; csrf: string };
type JsonObject = Record<string, any>;

const projectRoot = process.cwd();
const ownerToken = crypto.randomBytes(32).toString('base64url');
const ttsSecretCanary = `tts-${crypto.randomBytes(24).toString('base64url')}`;
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'edith-backend-security-'));
let server: ChildProcessWithoutNullStreams | undefined;
let capturedOutput = '';

const RETRYABLE_CLEANUP_ERRORS = new Set(['EBUSY', 'EPERM', 'ENOTEMPTY']);

async function removeTempRootWithRetry(
  target: string,
  remove: (path: string) => void = (path) => fs.rmSync(path, { recursive: true, force: true }),
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  attempts = 8,
): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      remove(target);
      return true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!code || !RETRYABLE_CLEANUP_ERRORS.has(code)) return false;
      if (attempt < attempts - 1) await wait(100 * (attempt + 1));
    }
  }
  return false;
}

function unusedPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForServer(base: string, child: ChildProcessWithoutNullStreams): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`EDITH server exited before readiness (code ${child.exitCode}).`);
    try {
      const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(750) });
      if (response.ok) return;
    } catch {
      // Fixture may still be loading.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for EDITH security fixture. Output: ${capturedOutput.slice(-1000)}`);
}

async function stopServer(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise<void>((resolve) => child.once('exit', () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 3_000)),
  ]);
  if (child.exitCode === null) {
    child.kill('SIGKILL');
    await Promise.race([
      new Promise<void>((resolve) => child.once('exit', () => resolve())),
      new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
    ]);
  }
}

async function json(response: Response): Promise<JsonObject> {
  return await response.json() as JsonObject;
}

async function authenticate(base: string): Promise<OwnerSession> {
  const response = await fetch(`${base}/api/security/session`, {
    method: 'POST',
    headers: { authorization: `Bearer ${ownerToken}`, origin: base, 'sec-fetch-site': 'same-origin' },
  });
  assert.equal(response.status, 201);
  const body = await json(response);
  const cookieHeader = response.headers.get('set-cookie') ?? '';
  assert.match(cookieHeader, /HttpOnly/i);
  assert.match(cookieHeader, /SameSite=Strict/i);
  assert.equal(JSON.stringify(body).includes(ownerToken), false);
  assert.equal(typeof body.session?.csrfToken, 'string');
  return { cookie: cookieHeader.split(';')[0], csrf: body.session.csrfToken };
}

function protectedHeaders(base: string, session: OwnerSession): Record<string, string> {
  return {
    'content-type': 'application/json',
    cookie: session.cookie,
    origin: base,
    'sec-fetch-site': 'same-origin',
    'x-edith-csrf-token': session.csrf,
  };
}

async function mutation(base: string, method: string, route: string, body: JsonObject, headers: Record<string, string>): Promise<Response> {
  return fetch(`${base}${route}`, { method, headers, body: JSON.stringify(body) });
}

async function assertProtectedMutationBoundary(
  base: string,
  session: OwnerSession,
  method: string,
  route: string,
  body: JsonObject = {},
): Promise<void> {
  let response = await mutation(base, method, route, body, {
    'content-type': 'application/json', origin: base, 'sec-fetch-site': 'same-origin',
  });
  assert.equal(response.status, 401, `${method} ${route}: missing owner session must fail.`);

  response = await mutation(base, method, route, body, {
    ...protectedHeaders(base, session), cookie: 'edith_owner_session=forged-session',
  });
  assert.equal(response.status, 401, `${method} ${route}: forged owner session must fail.`);

  const noOrigin = protectedHeaders(base, session);
  delete noOrigin.origin;
  response = await mutation(base, method, route, body, noOrigin);
  assert.equal(response.status, 403, `${method} ${route}: missing Origin must fail.`);

  response = await mutation(base, method, route, body, {
    ...protectedHeaders(base, session), origin: 'https://attacker.invalid', 'sec-fetch-site': 'cross-site',
  });
  assert.equal(response.status, 403, `${method} ${route}: cross-origin request must fail.`);

  const noCsrf = protectedHeaders(base, session);
  delete noCsrf['x-edith-csrf-token'];
  response = await mutation(base, method, route, body, noCsrf);
  assert.equal(response.status, 403, `${method} ${route}: missing CSRF must fail.`);

  response = await mutation(base, method, route, body, {
    ...protectedHeaders(base, session), 'x-edith-csrf-token': 'wrong-csrf-token',
  });
  assert.equal(response.status, 403, `${method} ${route}: wrong CSRF must fail.`);
}

try {
  const cleanupProbe = path.join(tempRoot, 'cleanup-ebusy-probe');
  fs.mkdirSync(cleanupProbe);
  let cleanupAttempts = 0;
  const cleanupRecovered = await removeTempRootWithRetry(
    cleanupProbe,
    (target) => {
      cleanupAttempts += 1;
      if (cleanupAttempts === 1) {
        const error = new Error('synthetic Windows directory busy') as NodeJS.ErrnoException;
        error.code = 'EBUSY';
        throw error;
      }
      fs.rmSync(target, { recursive: true, force: true });
    },
    async () => undefined,
  );
  assert.equal(cleanupRecovered, true);
  assert.equal(cleanupAttempts, 2);

  const port = await unusedPort();
  const base = `http://127.0.0.1:${port}`;
  const tsxCli = path.join(projectRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  server = spawn(process.execPath, [tsxCli, path.join(projectRoot, 'server.ts')], {
    cwd: tempRoot,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(port),
      EDITH_HOST: '127.0.0.1',
      EDITH_OWNER_TOKEN: ownerToken,
      EDITH_OWNER_TOKEN_ONE_TIME: 'true',
      EDITH_PERSISTENCE: 'json',
      EDITH_WORKSPACE_ROOT: tempRoot,
      EDITH_WORKSPACE_CONFIG_PATH: path.join(tempRoot, 'workspace.json'),
      EDITH_STATIC_DIR: path.join(projectRoot, 'dist'),
      EDITH_OBSIDIAN_ENABLED: 'false',
      EDITH_CRYPTO_AUTOSTART: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (chunk) => { capturedOutput += chunk.toString(); });
  server.stderr.on('data', (chunk) => { capturedOutput += chunk.toString(); });
  await waitForServer(base, server);

  let response = await mutation(base, 'POST', '/api/tools/execute', { toolId: 'system_monitor', args: {} }, {
    'content-type': 'application/json', origin: base, 'sec-fetch-site': 'same-origin',
  });
  assert.equal(response.status, 401);

  response = await fetch(`${base}/api/security/session`, {
    method: 'POST',
    headers: { authorization: 'Bearer wrong-owner-token', origin: base, 'sec-fetch-site': 'same-origin' },
  });
  assert.equal(response.status, 401);

  response = await fetch(`${base}/api/security/session`, {
    method: 'POST',
    headers: { authorization: `Bearer ${ownerToken}`, origin: 'https://attacker.invalid', 'sec-fetch-site': 'cross-site' },
  });
  assert.equal(response.status, 403);

  const session = await authenticate(base);

  response = await fetch(`${base}/api/security/session`, {
    method: 'POST',
    headers: { authorization: `Bearer ${ownerToken}`, origin: base, 'sec-fetch-site': 'same-origin' },
  });
  assert.equal(response.status, 401);
  assert.equal((await json(response)).errorCode, 'owner_bootstrap_consumed');

  const protectedWorkspaceAndKnowledgeRoutes: Array<[string, string, JsonObject]> = [
    ['POST', '/api/workspace/validate', { workspaceRoot: tempRoot }],
    ['PUT', '/api/workspace/config', { workspaceRoot: tempRoot }],
    ['POST', '/api/workspace/create', { workspaceRoot: tempRoot }],
    ['POST', '/api/knowledge/sync', {}],
    ['POST', '/api/edith/knowledge/reindex', {}],
    ['POST', '/api/edith/obsidian/vault', { vaultPath: tempRoot }],
    ['POST', '/api/edith/obsidian/provider/activate', {}],
    ['POST', '/api/edith/obsidian/provider/change', {}],
    ['POST', '/api/edith/obsidian/provider/revoke', {}],
    ['PATCH', '/api/edith/obsidian/settings', {}],
    ['POST', '/api/edith/obsidian/sync-now', {}],
    ['POST', '/api/edith/obsidian/agent-notes', {}],
    ['POST', '/api/knowledge/write-note', {}],
    ['POST', '/api/edith/tasks', { objective: 'security boundary', originalUserRequest: 'test' }],
    ['PATCH', '/api/edith/tasks/missing/status', { status: 'RUNNING' }],
    ['POST', '/api/edith/tasks/missing/queue', {}],
    ['POST', '/api/edith/tasks/missing/pause', {}],
    ['POST', '/api/edith/tasks/missing/resume', {}],
    ['POST', '/api/edith/tasks/missing/cancel', {}],
    ['POST', '/api/edith/tasks/missing/observations', { observation: 'test' }],
    ['POST', '/api/edith/tasks/missing/checkpoints', { checkpoint: 'test' }],
    ['POST', '/api/edith/tasks/missing/artifacts', { artifact: 'test' }],
    ['POST', '/api/edith/tasks/missing/plan', {}],
    ['POST', '/api/edith/tasks/missing/execute', {}],
    ['POST', '/api/edith/tasks/missing/verify', {}],
    ['POST', '/api/edith/tasks/missing/recover', {}],
    ['POST', '/api/edith/mobile/pairings/missing/approve', { code: '000000' }],
    ['POST', '/api/edith/mobile/pairings/missing/reject', {}],
    ['POST', '/api/edith/mobile/devices/missing/revoke', {}],
    ['POST', '/api/edith/mobile/cross-device/live-view/missing/request', {}],
    ['POST', '/api/edith/mobile/cross-device/live-view/missing/approve', {}],
    ['POST', '/api/edith/mobile/cross-device/live-view/missing/stop', {}],
    ['POST', '/api/edith/mobile/cross-device/wake/missing', {}],
    ['POST', '/api/edith/mobile/cross-device/transfers/missing', {}],
    ['POST', '/api/edith/mobile/cross-device/handoffs/missing', {}],
    ['POST', '/api/edith/mobile/cross-device/result-cards/missing', {}],
    ['PUT', '/api/edith/mobile/cross-device/quiet-hours', {}],
    ['PUT', '/api/edith/advanced/shadow', {}],
    ['POST', '/api/edith/advanced/produce/outcome', { workspaceId: 'workspace-1', taskIds: [] }],
    ['POST', '/api/edith/advanced/ghosts/missing/pause?workspaceId=workspace-1', {}],
    ['POST', '/api/edith/advanced/watchers/missing/cancel?workspaceId=workspace-1', {}],
    ['PATCH', '/api/edith/proactive/settings', {}],
    ['POST', '/api/edith/proactive/signals/missing/dismiss', {}],
    ['POST', '/api/edith/proactive/check', {}],
  ];
  for (const [method, route, body] of protectedWorkspaceAndKnowledgeRoutes) {
    await assertProtectedMutationBoundary(base, session, method, route, body);
  }

  response = await fetch(`${base}/api/edith/tasks`);
  assert.equal(response.status, 200);
  const taskList = await json(response);
  assert.equal(taskList.contract?.version, 2);
  assert.equal(Array.isArray(taskList.data?.tasks), true);

  response = await fetch(`${base}/api/mobile/tasks`);
  assert.equal(response.status, 401);
  assert.equal((await json(response)).errorCode, 'DEVICE_AUTH_REQUIRED');
  response = await fetch(`${base}/api/mobile/cross-device/capabilities`);
  assert.equal(response.status, 401);
  assert.equal((await json(response)).errorCode, 'DEVICE_AUTH_REQUIRED');
  response = await fetch(`${base}/api/mobile/advanced/state`);
  assert.equal(response.status, 401);
  assert.equal((await json(response)).errorCode, 'DEVICE_AUTH_REQUIRED');
  response = await fetch(`${base}/api/edith/advanced/status`);
  assert.equal(response.status, 401);
  response = await fetch(`${base}/api/edith/proactive/settings`);
  assert.equal(response.status, 401);
  response = await fetch(`${base}/api/edith/obsidian/provider/status`, { headers: { origin: base, 'sec-fetch-site': 'same-origin' } });
  assert.equal(response.status, 401);
  response = await fetch(`${base}/api/edith/obsidian/native-selection`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
  });
  assert.equal(response.status, 403);

  response = await mutation(base, 'POST', '/api/edith/advanced/produce/outcome', {
    workspaceId: 'workspace-1', taskIds: [], verified: true,
  }, protectedHeaders(base, session));
  assert.equal(response.status, 400);
  assert.equal((await json(response)).errorCode, 'ADVANCED_PRODUCER_INPUT_INVALID');

  response = await fetch(`${base}/api/knowledge/status`);
  assert.equal(response.status, 200);
  const publicKnowledgeStatus = await json(response);
  assert.equal(JSON.stringify(publicKnowledgeStatus).includes(tempRoot), false);

  response = await fetch(`${base}/api/status`);
  assert.equal(response.status, 200);
  const publicSystemStatus = await json(response);
  assert.equal(JSON.stringify(publicSystemStatus).includes(tempRoot), false);

  response = await mutation(base, 'POST', '/api/edith/tasks', {
    title: 'Security contract task',
    objective: 'Verify activity envelope',
    originalUserRequest: 'verify activity envelope',
  }, protectedHeaders(base, session));
  const createdTaskText = await response.text();
  assert.equal(response.status, 200, `Task creation failed: ${createdTaskText.slice(0, 500)}; server=${capturedOutput.slice(-1000)}`);
  const createdTask = JSON.parse(createdTaskText) as JsonObject;
  assert.equal(typeof createdTask.task?.revision, 'number');

  response = await mutation(base, 'POST', '/api/edith/advanced/produce/ghost', {
    workspaceId: 'workspace-security', taskId: createdTask.task.id,
  }, protectedHeaders(base, session));
  assert.equal(response.status, 201);
  const ghostPublish = await json(response);
  assert.equal(ghostPublish.status, 'published');
  response = await fetch(`${base}/api/edith/advanced/state?workspaceId=workspace-security`, { headers: { cookie: session.cookie } });
  assert.equal(response.status, 200);
  const advancedState = await json(response);
  assert.equal(advancedState.state?.ghosts?.some((entry: JsonObject) => entry.taskId === createdTask.task.id), true);

  response = await fetch(`${base}/api/edith/tasks/${encodeURIComponent(createdTask.task.id)}/activity`);
  assert.equal(response.status, 200);
  const activity = await json(response);
  assert.equal(activity.contract?.version, 2);
  assert.equal(activity.progress?.taskId, createdTask.task.id);
  assert.equal(Array.isArray(activity.events), true);
  assert.equal(activity.events.length, 0);
  assert.equal(activity.eventDiagnostics?.scope, 'task');
  assert.equal(Number(activity.eventDiagnostics?.quarantinedEventCount) >= 2, true);
  assert.equal(JSON.stringify(activity.eventDiagnostics).includes(tempRoot), false);

  response = await mutation(base, 'PATCH', `/api/edith/tasks/${encodeURIComponent(createdTask.task.id)}/status`, { status: 'not-a-real-status' }, protectedHeaders(base, session));
  assert.equal(response.status, 400);
  assert.equal((await json(response)).errorCode, 'INVALID_TASK_STATUS');
  const noCsrf = protectedHeaders(base, session);
  delete noCsrf['x-edith-csrf-token'];
  response = await mutation(base, 'POST', '/api/tools/execute', { toolId: 'system_monitor', args: {} }, noCsrf);
  assert.equal(response.status, 403);

  response = await mutation(base, 'POST', '/api/tools/execute', { toolId: 'system_monitor', args: {} }, {
    ...protectedHeaders(base, session), origin: 'https://attacker.invalid', 'sec-fetch-site': 'cross-site',
  });
  assert.equal(response.status, 403);

  response = await mutation(base, 'POST', '/api/tools/execute', {
    toolId: 'system_monitor', args: {}, authorizedPermissions: ['system:exec', 'computer:control'],
  }, protectedHeaders(base, session));
  assert.equal(response.status, 400);
  assert.equal((await json(response)).errorCode, 'CLIENT_PERMISSIONS_FORBIDDEN');

  response = await mutation(base, 'POST', '/api/tools/execute', { toolId: 'system_monitor', args: {} }, protectedHeaders(base, session));
  assert.equal(response.status, 200);
  assert.equal((await json(response)).success, true);

  response = await mutation(base, 'POST', '/api/voice/tts', {
    text: 'backend-only credential regression', apiKey: ttsSecretCanary,
  }, protectedHeaders(base, session));
  assert.equal(response.status, 400);
  const ttsBody = await json(response);
  assert.equal(ttsBody.errorCode, 'CLIENT_SECRET_FORBIDDEN');
  assert.equal(JSON.stringify(ttsBody).includes(ttsSecretCanary), false);

  response = await mutation(base, 'POST', '/api/edith/permissions/grants', {
    actor: 'forged-client', permissions: ['system:read'], reason: 'backend security regression', ttlMs: 60_000,
  }, protectedHeaders(base, session));
  assert.equal(response.status, 200);
  const grant = await json(response);
  assert.equal(grant.grant?.actor, 'owner');
  assert.equal(grant.grant?.grantedBy, 'owner');

  response = await mutation(base, 'DELETE', `/api/edith/permissions/grants/${encodeURIComponent(grant.grant.id)}`, {}, protectedHeaders(base, session));
  assert.equal(response.status, 200);

  response = await mutation(base, 'POST', '/api/edith/kill-switch/activate', { reason: 'backend security regression' }, protectedHeaders(base, session));
  assert.equal(response.status, 200);
  assert.equal((await json(response)).state?.active, true);

  response = await mutation(base, 'POST', '/api/edith/kill-switch/deactivate', { confirmation: 'DISABLE_KILL_SWITCH' }, protectedHeaders(base, session));
  assert.equal(response.status, 200);
  assert.equal((await json(response)).state?.active, false);

  assert.equal(capturedOutput.includes(ownerToken), false);
  assert.equal(capturedOutput.includes(session.csrf), false);
  assert.equal(capturedOutput.includes(ttsSecretCanary), false);

  response = await fetch(`${base}/api/security/session`, {
    method: 'DELETE',
    headers: protectedHeaders(base, session),
  });
  assert.equal(response.status, 200);
  response = await fetch(`${base}/api/security/session`, { headers: { cookie: session.cookie } });
  assert.equal(response.status, 401);

  console.log(JSON.stringify({
    success: true,
    checks: [
      'owner_auth_required',
      'wrong_owner_token_rejected',
      'cross_origin_session_rejected',
      'one_time_owner_bootstrap_replay_rejected',
      'workspace_and_knowledge_mutations_protected',
      'task_mutations_protected',
      'mobile_owner_mutations_protected',
      'mobile_device_auth_required',
      'advanced_runtime_owner_csrf_origin_required',
      'advanced_producer_arbitrary_verified_flag_rejected',
      'proactive_reads_and_mutations_protected',
      'task_reads_remain_public_and_versioned',
      'task_activity_envelope_and_progress',
      'legacy_task_event_quarantine_diagnostics',
      'persisted_task_internal_publish_owner_state',
      'invalid_task_status_rejected',
      'public_status_paths_redacted',
      'csrf_required',
      'cross_origin_mutation_rejected',
      'client_permission_spoofing_rejected',
      'authenticated_tool_execution',
      'client_tts_secret_rejected',
      'server_owned_grant_actor',
      'kill_switch_protected_and_restored',
      'revoked_session_replay_rejected',
      'secrets_absent_from_server_output',
      'windows_ebusy_cleanup_retry_verified',
    ],
  }, null, 2));
} finally {
  if (server) await stopServer(server).catch(() => undefined);
  const cleaned = await removeTempRootWithRetry(tempRoot);
  if (!cleaned) console.warn(`Security fixture cleanup deferred after retries: ${tempRoot}`);
}
