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
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'edith-backend-security-'));
let server: ChildProcessWithoutNullStreams | undefined;
let capturedOutput = '';

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
  if (child.exitCode === null) child.kill('SIGKILL');
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

try {
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

  console.log(JSON.stringify({
    success: true,
    checks: [
      'owner_auth_required',
      'wrong_owner_token_rejected',
      'cross_origin_session_rejected',
      'csrf_required',
      'cross_origin_mutation_rejected',
      'client_permission_spoofing_rejected',
      'authenticated_tool_execution',
      'server_owned_grant_actor',
      'kill_switch_protected_and_restored',
      'secrets_absent_from_server_output',
    ],
  }, null, 2));
} finally {
  if (server) await stopServer(server).catch(() => undefined);
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

