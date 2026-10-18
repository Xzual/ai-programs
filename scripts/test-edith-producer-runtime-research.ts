import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { BoundedResearchAcquisitionWorker } from '../src/edith/researchAcquisitionAdapter';
import { ResearchService, type ResearchRequestV2_1 } from '../src/edith/researchService';
import { ResearchSsrfPolicy } from '../src/edith/researchSsrfPolicy';
import { MemoryPhase4Persistence } from '../src/edith/phase4Persistence';
import { ResearchJournalService, SandboxVaultProvider } from '../src/edith/researchJournalService';

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edith-research-bytes-'));
  const document = Buffer.from('<title>Measured research fixture</title><p>Research evidence comes from actual fixture response bytes and retains an uncertain quotation.</p>');
  let requests = 0;
  const contacted: string[] = [];
  const server = http.createServer((req, res) => {
    requests++;
    if (req.url === '/redirect') { res.writeHead(302, { location: 'http://127.0.0.1/private' }); res.end(); }
    else if (req.url === '/loop') { res.writeHead(302, { location: '/loop' }); res.end(); }
    else if (req.url === '/large') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end(Buffer.alloc(128 * 1024 + 1, 'x')); }
    else if (req.url === '/binary') { res.writeHead(200, { 'content-type': 'application/octet-stream' }); res.end(document); }
    else { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(document); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  const resolver = { resolverId: 'reviewed-fixture-public-dns', async resolve(host: string) { return host === 'mixed.example.com' ? ['93.184.216.34', '10.0.0.2'] : ['93.184.216.34']; } };
  const worker = new BoundedResearchAcquisitionWorker({ resolver, async fixtureTransport(url) {
    const parsed = new URL(url);
    assert.equal(parsed.hostname, 'fixture.example.com');
    contacted.push(url);
    const response = await fetch(`${base}${parsed.pathname}`, { redirect: 'manual' });
    return { status: response.status, headers: { location: response.headers.get('location') ?? undefined, contentType: response.headers.get('content-type') ?? undefined }, bytes: Buffer.from(await response.arrayBuffer()) };
  } });
  try {
    const persistence = new MemoryPhase4Persistence();
    const journal = new ResearchJournalService(new SandboxVaultProvider(path.join(root, 'vault')));
    const service = new ResearchService(persistence, [worker], resolver, journal);
    const result = await service.execute({ query: 'research evidence', mode: 'DEEP', seedUrls: ['https://fixture.example.com/document'], maxRetries: 0 });
    assert.equal(result.outcome, 'completed', JSON.stringify(result.reasonCodes));
    assert.equal(requests, 1, 'Concurrent specializations share one bounded byte acquisition');
    assert.equal(result.run.sources?.[0].contentSha256, createHash('sha256').update(document).digest('hex'));
    assert.equal(result.run.sources?.[0].safety?.retrievedByBackend, true);
    assert.equal(result.run.sources?.[0].acquisition, 'direct_fetch');
    assert.equal(result.run.claims?.[0].status, 'uncertain');
    assert.equal(result.run.citations?.[0].excerptSha256, createHash('sha256').update(result.run.claims![0].statement).digest('hex'));
    assert.equal(result.measurements?.modelCalls, 0);
    assert.equal(result.measurements?.fixture, true);
    assert.equal(result.measurements?.retrievedBytes, document.length);
    assert.equal(result.journal?.status, 'written');
    const note = fs.readFileSync(path.join(root, 'vault', result.journal!.relativePath!), 'utf8');
    assert(note.includes(result.run.claims![0].statement));
    assert(note.includes(result.run.sources![0].url), 'Journal retains usable public source citations');
    const ssrf = new ResearchSsrfPolicy();
    for (const url of ['http://[::ffff:7f00:1]/', 'http://[::ffff:a00:1]/', 'http://[0:0:0:0:0:ffff:c0a8:1]/', 'http://[2002:7f00:1::]/']) assert.equal((await ssrf.validate(url, resolver)).decision, 'blocked');
    const request: ResearchRequestV2_1 = { query: 'research evidence', mode: 'FAST', seedUrls: ['https://fixture.example.com/document'] };
    const input = { request, specialization: 'source_discovery' as const, attempt: 0, ssrf: new ResearchSsrfPolicy(), resolver };
    await worker.execute(input);
    const beforeReplay = requests;
    await worker.execute(input);
    assert.equal(requests, beforeReplay);
    assert.equal(worker.measurements(request).modelCalls, 0);
    for (const [pathname, expected, maxCalls] of [['redirect', 'RESEARCH_SSRF_BLOCKED', 1], ['large', 'RESEARCH_DOCUMENT_TOO_LARGE', 1], ['binary', 'RESEARCH_CONTENT_TYPE_UNSUPPORTED', 1], ['loop', 'RESEARCH_REDIRECT_LIMIT', 4]] as const) {
      const before = requests;
      await assert.rejects(worker.execute({ ...input, request: { ...request, seedUrls: [`https://fixture.example.com/${pathname}`] } }), new RegExp(expected));
      assert.equal(requests - before, maxCalls);
    }
    const beforeMixed = requests;
    await assert.rejects(worker.execute({ ...input, request: { ...request, seedUrls: ['https://mixed.example.com/document'] } }), /RESEARCH_SSRF_BLOCKED/);
    assert.equal(requests, beforeMixed);
    assert(contacted.every(url => new URL(url).hostname === 'fixture.example.com'));
    console.log(JSON.stringify({ status: 'PASS', checks: ['real_local_http_bytes_hash_citation', 'uncertain_quote_no_llm', 'temporary_journal', 'single_acquisition_specializations', 'memo_replay_zero_calls', 'private_redirect_never_contacted', 'mixed_dns_blocked_before_transport', 'byte_mime_redirect_bounds'], firstModelCalls: 0, replayModelCalls: 0, requests, productionTransportVerified: false }));
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
