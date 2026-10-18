import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createOwnerSessionRouter } from '../server/security/ownerSession';
import { createResearchRouter } from '../server/routes/research';
import { Phase4IdempotencyStore, redactPhase4Payload, type Phase4ApiRuntime } from '../server/routes/phase4Api';
import { DurableStateStore } from '../server/advanced/durableStateStore';
import { BoundedResearchAcquisitionWorker } from '../src/edith/researchAcquisitionAdapter';
import { ResearchService, freshnessForSources } from '../src/edith/researchService';
import { JsonPhase4Persistence } from '../src/edith/phase4Persistence';
import { ResearchJournalService, SandboxVaultProvider } from '../src/edith/researchJournalService';
import { PlaybookService } from '../src/edith/playbookService';
import { LocalSearchService } from '../src/edith/localSearchService';
import { getEdithPersistenceStore } from '../src/edith/persistence';
import { parseResearchRunV2, type ResearchRunV2, type ResearchSourceV2 } from '../src/edith/contracts';
import { executeResearch, getResearch, listResearch, exportResearch } from '../src/edith/researchClient';
import { clearOwnerSessionMemory } from '../src/edith/ownerMutationClient';

const query = 'quoted evidence';
const seedUrl = 'https://fixture.example.com/redirect';
const documentUrl = 'https://fixture.example.com/document';
const requestBody = { query, mode: 'FAST', seedUrls: [seedUrl] };
const idempotencyKey = 'w3-research-producer-binding';
const resolver = { resolverId: 'w3-public-fixture-dns', async resolve() { return ['93.184.216.34']; } };
const networkFetch = globalThis.fetch;
type Bytes = { status: number; headers: Record<string, string | undefined>; bytes: Buffer };

async function listen(server: http.Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address === 'object');
  return `http://127.0.0.1:${address.port}`;
}
async function close(server: http.Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
async function mount(root: string, transport: (url: string) => Promise<Bytes>) {
  const persistence = new JsonPhase4Persistence(root); persistence.initialize();
  const worker = new BoundedResearchAcquisitionWorker({ resolver, fixtureTransport: transport });
  const runtime: Phase4ApiRuntime = {
    persistence, research: new ResearchService(persistence, [worker], resolver, new ResearchJournalService(new SandboxVaultProvider(path.join(root, 'vault')))),
    playbooks: new PlaybookService(persistence), search: new LocalSearchService(getEdithPersistenceStore(), persistence),
    journalConfigured: true, researchConfigured: true, playbookExecutionConfigured: false,
    idempotency: new Phase4IdempotencyStore(path.join(root, 'idempotency.sqlite')),
  };
  const token = randomBytes(32).toString('base64url');
  process.env.EDITH_OWNER_TOKEN = token; process.env.EDITH_OWNER_TOKEN_ONE_TIME = 'true';
  const app = express(); app.use(express.json()); app.use(createOwnerSessionRouter()); app.use(createResearchRouter({ runtime }));
  const server = http.createServer(app); const base = await listen(server);
  const auth = await networkFetch(`${base}/api/security/session`, { method: 'POST', headers: { authorization: `Bearer ${token}`, origin: base, 'sec-fetch-site': 'same-origin' } });
  assert.equal(auth.status, 201); const authBody = await auth.json() as any;
  const headers = { cookie: (auth.headers.get('set-cookie') ?? '').split(';')[0], origin: base, 'sec-fetch-site': 'same-origin', 'x-edith-csrf-token': authBody.session.csrfToken, 'content-type': 'application/json', 'x-idempotency-key': idempotencyKey };
  return { server, base, headers, runtime };
}
function validateRun(value: unknown): ResearchRunV2 {
  const parsed = parseResearchRunV2(value); assert.ok(parsed.success, JSON.stringify(parsed));
  const source = parsed.value.sources![0] as ResearchSourceV2 & { redirectChain: string[] };
  assert.equal(source.url, documentUrl); assert.equal(source.canonicalUrl, documentUrl);
  assert.deepEqual(source.redirectChain, [seedUrl, documentUrl]);
  assert.equal(source.safety.decision, 'allowed'); assert.equal(source.safety.resolvedTargetClass, 'public');
  assert.ok(source.contentSha256); assert.ok(parsed.value.citations![0].excerptSha256);
  return parsed.value;
}
function redactionChecks(): number {
  const urls = [documentUrl, 'http://fixture.example.com/home/news?q=topic&sort=asc', 'https://fixture.example.com/Users/profile?next=https%3A%2F%2Fpublic.example.com%2Ftmp%2Farticle#section'];
  for (const url of urls) assert.equal(redactPhase4Payload(url), url);
  const paths = ['C:\\private.txt', 'C:/Users/owner/private.txt', '\\\\server\\share\\private.txt', '/home/owner/private.txt', '/tmp/private.txt', '/opt/project/private.txt'];
  for (const local of paths) assert.equal(redactPhase4Payload(local), '[REDACTED_LOCAL_PATH]');
  assert.equal(redactPhase4Payload('/api/edith/research'), '/api/edith/research');
  const mixed = redactPhase4Payload(`Source ${documentUrl} local C:\\Users\\owner\\private.txt and /home/owner/private.txt`);
  assert(mixed.includes(documentUrl)); assert(!mixed.includes('private.txt'));
  const canary = 'w3-fixture-sensitive-value';
  for (const sensitive of [`https://owner:${canary}@fixture.example.com/document`, `https://fixture.example.com/?token=${canary}`, `https://fixture.example.com/?%74oken=${canary}`, `https://fixture.example.com/?access_token=${canary}`, 'https://fixture.example.com/?file=C%3A%5CUsers%5Cowner%5Cprivate.txt', `api_key=${canary}`, `Bearer ${canary}`]) {
    const safe = redactPhase4Payload(sensitive); assert.notEqual(safe, sensitive); assert(!safe.includes(canary)); assert(!safe.includes('private.txt'));
    assert.equal(redactPhase4Payload(safe), safe);
  }
  const nested = { urls, local: paths, token: canary, metadata: { note: `password=${canary}` } };
  const safe = redactPhase4Payload(nested);
  assert.deepEqual(safe.urls, urls); assert(!JSON.stringify(safe).includes(canary));
  assert.deepEqual(redactPhase4Payload(safe), safe);
  return urls.length + paths.length + 10;
}
function freshnessChecks(source: ResearchSourceV2): void {
  const checked = new Date(); const now = checked.getTime(); const ttl = 60_000;
  const at = (age: number, extra: Partial<ResearchSourceV2> = {}) => ({ ...source, retrievedAt: new Date(now - age).toISOString(), ...extra });
  for (const [age, status] of [[ttl - 1, 'fresh'], [ttl, 'stale'], [ttl + 1, 'stale']] as const) {
    const fresh = freshnessForSources([at(age)], checked, ttl);
    assert.equal(fresh.status, status); assert.equal(fresh.staleAfter, new Date(now - age + ttl).toISOString());
  }
  const published = freshnessForSources([at(0, { publishedAt: new Date(now - 2 * ttl).toISOString() })], checked, ttl);
  assert.equal(published.status, 'stale'); assert.equal(published.staleAfter, new Date(now - ttl).toISOString());
  const mixed = freshnessForSources([at(2 * ttl), at(0)], checked, ttl);
  assert.equal(mixed.status, 'mixed'); assert.equal(mixed.staleAfter, new Date(now - ttl).toISOString());
  for (const sources of [[], [at(-1)], [at(0, { publishedAt: 'invalid' })], [at(0), at(0, { retrievedAt: 'invalid' })]]) {
    const unknown = freshnessForSources(sources, checked, ttl); assert.equal(unknown.status, 'unknown'); assert.equal(unknown.staleAfter, undefined);
  }
  assert.equal(freshnessForSources([at(0)], checked, 0).status, 'unknown');
}

if (process.argv[2] === '--restart-reader') {
  const root = process.argv[3]; const runId = process.argv[4];
  const mounted = await mount(root, async () => { throw new Error('RESTART_MUST_NOT_REACQUIRE'); });
  try {
    const response = await networkFetch(`${mounted.base}/api/edith/research/run`, { method: 'POST', headers: mounted.headers, body: JSON.stringify(requestBody) });
    assert.equal(response.status, 201); const body = await response.json() as any;
    assert.equal(body.idempotentReplay, true); assert.equal(validateRun(body.data.run).runId, runId);
    const read = await networkFetch(`${mounted.base}/api/edith/research/${runId}`, { headers: mounted.headers });
    assert.equal(read.status, 200); validateRun((await read.json() as any).data.run);
    console.log(JSON.stringify({ restartReplay: 'PASS', strictParser: 'PASS', runId, acquisitionCalls: 0, modelCalls: 0 }));
  } finally { await close(mounted.server); }
} else {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edith-research-binding-'));
  const bytes = Buffer.from('Quoted evidence comes from actual local HTTP bytes and retains public provenance in the mounted API.');
  let calls = 0;
  const fixture = http.createServer((req, res) => {
    calls++;
    if (req.url === '/redirect') { res.writeHead(302, { location: documentUrl }); res.end(); }
    else { assert.equal(req.url, '/document'); res.writeHead(200, { 'content-type': 'text/plain' }); res.end(bytes); }
  });
  const fixtureBase = await listen(fixture);
  const mounted = await mount(root, async (url) => {
    const target = new URL(url); assert.equal(target.hostname, 'fixture.example.com');
    const response = await networkFetch(`${fixtureBase}${target.pathname}`, { redirect: 'manual' });
    return { status: response.status, headers: { location: response.headers.get('location') ?? undefined, contentType: response.headers.get('content-type') ?? undefined }, bytes: Buffer.from(await response.arrayBuffer()) };
  });
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const wire: any[] = [];
  try {
    redactionChecks();
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { origin: mounted.base } } });
    clearOwnerSessionMemory();
    // Browser transport bridge only: actual protected routers/client/parser all execute.
    globalThis.fetch = async (input, init: RequestInit = {}) => {
      const url = new URL(input instanceof Request ? input.url : String(input), mounted.base);
      assert.equal(url.origin, mounted.base);
      const headers = new Headers(init.headers); headers.set('cookie', mounted.headers.cookie); headers.set('origin', mounted.base); headers.set('sec-fetch-site', 'same-origin');
      if (url.pathname === '/api/edith/research/run' && init.method === 'POST') headers.set('x-idempotency-key', idempotencyKey);
      const response = await networkFetch(url, { ...init, headers });
      if (url.pathname === '/api/edith/research/run') wire.push(await response.clone().json());
      return response;
    };
    const first = await executeResearch(query, 'FAST', [seedUrl]);
    const actual = validateRun(first.run);
    assert.equal(wire[0].idempotentReplay, false); assert.equal(calls, 2);
    assert.equal(first.measurements?.retrievedBytes, bytes.length); assert.equal(first.measurements?.modelCalls, 0);
    assert.equal(actual.sources![0].contentSha256, createHash('sha256').update(bytes).digest('hex'));
    assert.equal(actual.freshness?.status, 'fresh');
    assert(Date.parse(actual.freshness!.staleAfter!) > Date.parse(actual.freshness!.checkedAt));
    assert.equal(Date.parse(actual.freshness!.staleAfter!) - Date.parse(actual.sources![0].retrievedAt), 30 * 24 * 60 * 60 * 1000);
    freshnessChecks(actual.sources![0]);
    validateRun(await getResearch(actual.runId)); validateRun((await listResearch())[0]);
    const exported = await exportResearch(actual.runId); assert(exported.includes(documentUrl)); assert(exported.includes(actual.sources![0].contentSha256!));
    const replay = await executeResearch(query, 'FAST', [seedUrl]); validateRun(replay.run);
    assert.equal(wire[1].idempotentReplay, true); assert.equal(calls, 2);
    const persisted = new DurableStateStore(path.join(root, 'idempotency.sqlite')).entries();
    const result = (persisted[0][1] as any).result; validateRun(result.body.data.run);
    assert.deepEqual(redactPhase4Payload(result.body), result.body);
    const journalPath = actual.artifactIds.find((id) => id.startsWith('journal:'))!;
    assert(fs.readFileSync(path.join(root, 'vault', journalPath.slice('journal:'.length)), 'utf8').includes(documentUrl));
    globalThis.fetch = networkFetch; clearOwnerSessionMemory();
    await close(mounted.server); await close(fixture);
    const restart = spawnSync(process.execPath, ['--import', 'tsx', fileURLToPath(import.meta.url), '--restart-reader', root, actual.runId], { env: process.env, encoding: 'utf8', timeout: 15_000 });
    assert.equal(restart.status, 0, restart.stderr); const restartProof = JSON.parse(restart.stdout.trim()); assert.equal(restartProof.restartReplay, 'PASS');
    console.log(JSON.stringify({ success: true, mountedProducerToActualResearchClient: 'PASS', strictFrozenParser: 'PASS', localPathAndSecretRedaction: 'PASS', freshnessExpiryBoundaries: 'PASS', acquisitionCalls: calls, bytes: bytes.length, sha256: actual.sources![0].contentSha256, modelCalls: 0, restart: restartProof, response: wire[0] }));
  } finally {
    globalThis.fetch = networkFetch; clearOwnerSessionMemory();
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow); else Reflect.deleteProperty(globalThis, 'window');
    await close(mounted.server); await close(fixture);
    const target = fs.realpathSync(root); const relative = path.relative(fs.realpathSync(os.tmpdir()), target);
    assert(/^edith-research-binding-[A-Za-z0-9]+$/.test(relative));
    fs.rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
