import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

type Json = Record<string, any>;
type Session = { cookie: string; csrf: string };

const root = process.cwd();
const tempParent = fs.realpathSync(os.tmpdir());
const tempRoot = fs.mkdtempSync(path.join(tempParent, 'edith-phase4-api-'));
const createdTempRoot = fs.realpathSync(tempRoot);
const ownerToken = crypto.randomBytes(32).toString('base64url');
let server: ChildProcessWithoutNullStreams | undefined;
let output = '';
let serverClosed: Promise<void> | undefined;
let childClosed = false;
let childSpawnError: Error | undefined;
let forcedKill = false;

async function waitForServerClose(timeoutMs: number): Promise<boolean> {
  if (childClosed) return true;
  if (!serverClosed) throw new Error('PHASE4_SERVER_CLOSE_TRACKING_REQUIRED');
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    serverClosed!.then(() => { clearTimeout(timer); resolve(true); });
  });
}

function removeTemporaryWorkspace(): void {
  const target = path.resolve(tempRoot);
  const relative = path.relative(tempParent, target);
  if (path.dirname(target) !== tempParent || !/^edith-phase4-api-[A-Za-z0-9]+$/.test(relative)
    || fs.lstatSync(target).isSymbolicLink() || path.relative(createdTempRoot, fs.realpathSync(target)) !== '') {
    throw new Error('PHASE4_TEMP_CLEANUP_TARGET_INVALID');
  }
  // Windows can briefly retain cwd/file handles after child close. Retry only this
  // verified, uniquely generated fixture directory; exhausted retries fail the test.
  fs.rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  if (fs.existsSync(target)) throw new Error('PHASE4_TEMP_CLEANUP_INCOMPLETE');
}

async function port(): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = net.createServer();
    socket.once('error', reject);
    socket.listen(0, '127.0.0.1', () => {
      const address = socket.address();
      socket.close((error) => error ? reject(error) : resolve(typeof address === 'object' && address ? address.port : 0));
    });
  });
}

async function ready(base: string): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (server?.exitCode !== null) throw new Error(`Server exited early: ${output.slice(-1000)}`);
    try {
      const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(750) });
      if (response.ok) return;
    } catch { /* startup */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Server readiness timeout: ${output.slice(-1000)}`);
}

async function body(response: Response): Promise<Json> {
  return await response.json() as Json;
}

async function authenticate(base: string): Promise<Session> {
  const response = await fetch(`${base}/api/security/session`, { method: 'POST', headers: { authorization: `Bearer ${ownerToken}`, origin: base, 'sec-fetch-site': 'same-origin' } });
  assert.equal(response.status, 201);
  const payload = await body(response);
  return { cookie: (response.headers.get('set-cookie') ?? '').split(';')[0], csrf: payload.session.csrfToken };
}

function headers(base: string, session: Session, idempotency?: string): Record<string, string> {
  return {
    'content-type': 'application/json', cookie: session.cookie, origin: base, 'sec-fetch-site': 'same-origin',
    'x-edith-csrf-token': session.csrf,
    ...(idempotency ? { 'x-idempotency-key': idempotency } : {}),
  };
}

async function mutate(base: string, route: string, payload: unknown, requestHeaders: Record<string, string>, method = 'POST'): Promise<Response> {
  return fetch(`${base}${route}`, { method, headers: requestHeaders, body: JSON.stringify(payload) });
}

async function stop(): Promise<void> {
  if (!server) return;
  if (!childClosed && server.exitCode === null && server.signalCode === null) server.kill('SIGTERM');
  if (!await waitForServerClose(3_000)) {
    forcedKill = true;
    server.kill('SIGKILL');
    if (!await waitForServerClose(2_000)) throw new Error('PHASE4_SERVER_SHUTDOWN_TIMEOUT');
  }
  if (childSpawnError) throw new Error('PHASE4_SERVER_SPAWN_FAILED', { cause: childSpawnError });
  if (server.pid) {
    let alive = false;
    try { process.kill(server.pid, 0); alive = true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
    if (alive) throw new Error('PHASE4_SERVER_ORPHAN_DETECTED');
  }
}

const playbook = {
  contractVersion: 2,
  amendment: '2.1',
  playbookId: 'phase4-safe-playbook',
  version: '1.0.0',
  title: 'Phase 4 safe fixture',
  skills: [],
  stepIds: ['inspect'],
  steps: [{
    contractVersion: 2,
    amendment: '2.1',
    stepId: 'inspect',
    title: 'Inspect metadata',
    dependsOn: [],
    inputSchema: {},
    outputSchema: {},
    skills: [],
    tools: [],
    permissions: [],
    riskLevel: 0,
    approval: 'none',
    timeoutMs: 5_000,
    retry: { maxAttempts: 1, backoffMs: 0, retryableErrorCodes: [] },
    verification: { required: false, criteria: [] },
    undo: { supported: false },
  }],
};

try {
  const selectedPort = await port();
  const base = `http://127.0.0.1:${selectedPort}`;
  // Direct child, rather than a tsx CLI wrapper with a second server process:
  // stopping this PID stops the actual fixture server.
  const tsxLoader = pathToFileURL(path.join(root, 'node_modules', 'tsx', 'dist', 'loader.mjs')).href;
  server = spawn(process.execPath, ['--import', tsxLoader, path.join(root, 'server.ts')], {
    cwd: tempRoot,
    env: {
      ...process.env,
      NODE_ENV: 'production', PORT: String(selectedPort), EDITH_HOST: '127.0.0.1', EDITH_OWNER_TOKEN: ownerToken,
      EDITH_OWNER_TOKEN_ONE_TIME: 'true', EDITH_PERSISTENCE: 'json', EDITH_WORKSPACE_ROOT: tempRoot,
      EDITH_WORKSPACE_CONFIG_PATH: path.join(tempRoot, 'workspace.json'), EDITH_STATIC_DIR: path.join(root, 'dist'),
      EDITH_OBSIDIAN_ENABLED: 'false', EDITH_CRYPTO_AUTOSTART: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverClosed = new Promise<void>((resolve) => server!.once('close', () => { childClosed = true; resolve(); }));
  server.once('error', (error) => { childSpawnError = error; });
  server.stdout.on('data', (chunk) => { output += chunk.toString(); });
  server.stderr.on('data', (chunk) => { output += chunk.toString(); });
  await ready(base);

  for (const route of ['/api/edith/research', '/api/edith/playbooks', '/api/edith/search?query=test']) {
    assert.equal((await fetch(`${base}${route}`)).status, 401, route);
  }

  const session = await authenticate(base);
  let response = await mutate(base, '/api/edith/research/run', { query: 'security test', mode: 'FAST' }, { 'content-type': 'application/json', origin: base, 'sec-fetch-site': 'same-origin' });
  assert.equal(response.status, 401);
  const noCsrf = headers(base, session, 'phase4-no-csrf');
  delete noCsrf['x-edith-csrf-token'];
  response = await mutate(base, '/api/edith/research/run', { query: 'security test', mode: 'FAST' }, noCsrf);
  assert.equal(response.status, 403);
  response = await mutate(base, '/api/edith/research/run', { query: 'security test', mode: 'FAST' }, { ...headers(base, session, 'phase4-wrong-origin'), origin: 'https://attacker.invalid', 'sec-fetch-site': 'cross-site' });
  assert.equal(response.status, 403);

  response = await mutate(base, '/api/edith/research/run', { query: '', mode: 'UNSAFE' }, headers(base, session, 'phase4-invalid'));
  assert.equal(response.status, 400);
  assert.equal((await body(response)).errorCode, 'INVALID_RESEARCH_QUERY');
  response = await mutate(base, '/api/edith/research/run', { query: 'apiKey=must-not-persist', mode: 'FAST' }, headers(base, session, 'phase4-secret-value'));
  assert.equal(response.status, 400);
  assert.equal((await body(response)).errorCode, 'SENSITIVE_PAYLOAD_FORBIDDEN');
  response = await mutate(base, '/api/edith/research/run', { query: 'missing idempotency', mode: 'FAST' }, headers(base, session));
  assert.equal(response.status, 400);
  assert.equal((await body(response)).errorCode, 'IDEMPOTENCY_KEY_REQUIRED');

  const blockedUrls = [
    ['http://user:password@example.com/', 'CREDENTIALS_IN_URL'],
    ['http://127.0.0.1/private', 'NON_PUBLIC_ADDRESS'],
    ['http://192.0.2.1/reserved', 'NON_PUBLIC_ADDRESS'],
    ['http://metadata.google.internal/latest', 'LOCAL_OR_METADATA_HOST'],
  ];
  for (const [url, reason] of blockedUrls) {
    response = await mutate(base, '/api/edith/research/run', { query: 'SSRF regression', mode: 'FAST', seedUrls: [url] }, headers(base, session, `phase4-ssrf-${reason}-${crypto.randomUUID()}`));
    assert.equal(response.status, 422, url);
    const payload = await body(response);
    assert.equal(payload.outcome, 'blocked');
    assert.equal(payload.data.reasonCodes.includes(reason), true);
  }

  const researchHeaders = headers(base, session, 'phase4-research-replay');
  const unavailableRequest = { query: 'Blocked local source', mode: 'DEEP', seedUrls: ['http://127.0.0.1/unavailable'] };
  response = await mutate(base, '/api/edith/research/run', unavailableRequest, researchHeaders);
  assert.equal(response.status, 422);
  const firstResearch = await body(response);
  assert.equal(firstResearch.errorCode, 'BLOCKED');
  assert.equal(firstResearch.data.reasonCodes.includes('NON_PUBLIC_ADDRESS'), true);
  assert.equal(firstResearch.data.run.status, 'failed');
  assert.equal(firstResearch.data.run.claims, undefined);
  response = await mutate(base, '/api/edith/research/run', unavailableRequest, researchHeaders);
  assert.equal(response.status, 422);
  const replay = await body(response);
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.data.run.runId, firstResearch.data.run.runId);
  response = await mutate(base, '/api/edith/research/run', { query: 'Different payload', mode: 'FAST' }, researchHeaders);
  assert.equal(response.status, 409);
  assert.equal((await body(response)).errorCode, 'IDEMPOTENCY_KEY_REUSED');

  response = await fetch(`${base}/api/edith/research?limit=1`, { headers: { cookie: session.cookie } });
  assert.equal(response.status, 200);
  const researchList = await body(response);
  assert.equal(researchList.contract.amendment, '2.1');
  assert.equal(researchList.data.runs.length, 1);
  const runId = firstResearch.data.run.runId;
  response = await fetch(`${base}/api/edith/research/${encodeURIComponent(runId)}/journal-status`, { headers: { cookie: session.cookie } });
  assert.equal((await body(response)).data.status, 'configuration_required');
  response = await mutate(base, `/api/edith/research/${encodeURIComponent(runId)}/cancel`, {}, headers(base, session, 'phase4-research-cancel'));
  assert.equal(response.status, 501);
  assert.equal((await body(response)).errorCode, 'RESEARCH_CANCELLATION_NOT_SUPPORTED');

  response = await mutate(base, '/api/edith/playbooks', playbook, headers(base, session, 'phase4-playbook-create'));
  assert.equal(response.status, 201, JSON.stringify(await response.clone().json().catch(() => ({}))));
  const created = await body(response);
  assert.equal(created.data.definition.playbookId, playbook.playbookId);
  response = await mutate(base, '/api/edith/playbooks', playbook, headers(base, session, 'phase4-playbook-create'));
  assert.equal((await body(response)).idempotentReplay, true);
  response = await mutate(base, `/api/edith/playbooks/${playbook.playbookId}/dry-run`, { version: playbook.version, approvedStepIds: ['inspect'] }, headers(base, session, 'phase4-dry-approval'));
  assert.equal(response.status, 400);
  assert.equal((await body(response)).errorCode, 'CLIENT_APPROVAL_EVIDENCE_FORBIDDEN');
  response = await mutate(base, `/api/edith/playbooks/${playbook.playbookId}/run`, { version: playbook.version, input: {} }, headers(base, session, 'phase4-playbook-run'));
  assert.equal(response.status, 503);
  const playbookRun = await body(response);
  assert.equal(playbookRun.errorCode, 'CONFIGURATION_REQUIRED');
  const playbookRunId = playbookRun.data.run.runId;
  response = await mutate(base, `/api/edith/playbooks/runs/${encodeURIComponent(playbookRunId)}/undo`, {}, headers(base, session, 'phase4-playbook-undo'));
  assert.equal(response.status, 503);
  assert.equal((await body(response)).errorCode, 'CONFIGURATION_REQUIRED');
  response = await mutate(base, `/api/edith/playbooks/runs/${encodeURIComponent(playbookRunId)}/cancel`, {}, headers(base, session, 'phase4-playbook-cancel'));
  assert.equal(response.status, 501);
  assert.equal((await body(response)).errorCode, 'PLAYBOOK_CANCELLATION_NOT_SUPPORTED');

  const secretCanary = `secret-${crypto.randomBytes(12).toString('hex')}`;
  response = await mutate(base, '/api/edith/tasks', {
    title: 'Phase4 redaction fixture',
    objective: `redaction apiKey=${secretCanary} C:\\Users\\owner\\private.txt`,
    originalUserRequest: 'redaction fixture',
  }, headers(base, session));
  assert.equal(response.status, 200);
  response = await fetch(`${base}/api/edith/search?query=redaction&limit=5`, { headers: { cookie: session.cookie } });
  assert.equal(response.status, 200);
  const search = await body(response);
  assert.equal(search.data.results.length > 0, true);
  const serialized = JSON.stringify(search);
  assert.equal(serialized.includes(secretCanary), false);
  assert.equal(serialized.includes('C:\\Users\\owner'), false);
  response = await fetch(`${base}/api/edith/search?query=test&limit=101`, { headers: { cookie: session.cookie } });
  assert.equal(response.status, 400);
  assert.equal((await body(response)).errorCode, 'INVALID_SEARCH_LIMIT');
  response = await fetch(`${base}/api/edith/search?query=test&includeSensitiveMemory=true`, { headers: { cookie: session.cookie } });
  assert.equal(response.status, 400);
  assert.equal((await body(response)).errorCode, 'SENSITIVE_SEARCH_FORBIDDEN');

  assert.equal(output.includes(ownerToken), false);
  assert.equal(output.includes(session.csrf), false);
  assert.equal(output.includes(secretCanary), false);
  console.log(JSON.stringify({
    success: true,
    checks: [
      'owner_read_boundary', 'owner_origin_csrf_mutation_boundary', 'invalid_payload', 'idempotency_required_replay_conflict',
      'ssrf_credentials_private_reserved_metadata', 'research_blocked_no_fake_claims', 'bounded_research_list',
      'journal_configuration_status', 'honest_research_cancellation', 'playbook_definition_idempotency',
      'client_approval_evidence_rejected', 'playbook_execution_configuration_required', 'undo_configuration_required',
      'honest_playbook_cancellation', 'scoped_search_redaction', 'search_limits_sensitive_memory_denied', 'secret_free_logs',
    ],
  }, null, 2));
} finally {
  await stop();
  removeTemporaryWorkspace();
  console.log(JSON.stringify({ phase4Cleanup: { serverPid: server?.pid, childClosed, exitCode: server?.exitCode, signal: server?.signalCode, forcedKill, orphanDetected: false, ownedTempRemoved: true, maxRetries: 5, retryDelayMs: 100 } }));
}
