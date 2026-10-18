import http from 'node:http';
import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { createHash } from 'node:crypto';
import { ResearchSsrfPolicy, type ResearchHostResolver, type ResearchUrlPolicyResult } from './researchSsrfPolicy';
import type { ResearchWorker, ResearchWorkerOutput, ResearchRequestV2_1 } from './researchService';
import { redactSensitiveString } from './securityRedaction';
import { killSwitchService } from './killSwitch';
import { ownerSessionBindingActive } from '../../server/security/ownerSession';

export const publicResearchResolver: ResearchHostResolver = {
  resolverId: 'node-dns-public-pinned-v1',
  async resolve(hostname) { return (await lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address); },
};
type DocumentBytes = { status: number; headers: Record<string, string | undefined>; bytes: Buffer };
export interface ResearchAcquisitionOptions {
  resolver?: ResearchHostResolver;
  searchUrl?: string;
  /** Test-only byte transport; production always pins validated DNS addresses. */
  fixtureTransport?: (url: string, policy: ResearchUrlPolicyResult) => Promise<DocumentBytes>;
}
const sha = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');

function requestBytes(url: string, policy: ResearchUrlPolicyResult): Promise<DocumentBytes> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const address = policy.resolvedAddresses[0];
    if (!address || policy.decision !== 'allowed') return reject(new Error('SSRF_TARGET_NOT_VALIDATED'));
    const request = (parsed.protocol === 'https:' ? https : http).request(parsed, {
      method: 'GET', headers: { accept: 'text/html,text/plain,application/json', 'user-agent': 'EDITH-Research/2.1' },
      lookup: (_host, options, callback) => {
        const family = address.includes(':') ? 6 : 4;
        if (options.all) callback(null, [{ address, family }] as never);
        else callback(null, address, family);
      },
    }, (response) => {
      let size = 0;
      const parts: Buffer[] = [];
      response.on('data', (part: Buffer) => {
        size += part.length;
        if (size > 128 * 1024) { request.destroy(new Error('RESEARCH_DOCUMENT_TOO_LARGE')); return; }
        parts.push(part);
      });
      response.on('end', () => resolve({ status: response.statusCode ?? 0, headers: {
        location: response.headers.location, contentType: response.headers['content-type'],
      }, bytes: Buffer.concat(parts) }));
      response.on('error', reject);
    });
    request.setTimeout(10_000, () => request.destroy(new Error('RESEARCH_ACQUISITION_TIMEOUT')));
    request.on('error', reject);
    request.end();
  });
}

function plainText(html: string): string {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&(?:nbsp|amp|lt|gt|quot|#39);/g, (entity) => ({ '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" })[entity] ?? entity)
    .replace(/\s+/g, ' ').trim();
}

/** Extracts cited source text; it never manufactures a synthesized factual claim. */
export class BoundedResearchAcquisitionWorker implements ResearchWorker {
  readonly workerId = 'bounded-public-text-acquisition-v1';
  readonly available = true;
  readonly specializations = ['source_discovery', 'browser_acquisition', 'claim_synthesis', 'corroboration', 'citation_verification'] as ResearchWorker['specializations'];
  readonly resolver: ResearchHostResolver;
  private readonly cache = new WeakMap<ResearchRequestV2_1, Promise<ResearchWorkerOutput>>();
  private readonly metrics = new WeakMap<ResearchRequestV2_1, { acquisitionCalls: number; retrievedBytes: number; modelCalls: number; fixture: boolean }>();

  constructor(private readonly options: ResearchAcquisitionOptions = {}) {
    if (options.fixtureTransport && process.env.EDITH_TEST_MODE !== 'true') throw new Error('RESEARCH_FIXTURE_TEST_MODE_REQUIRED');
    this.resolver = options.resolver ?? publicResearchResolver;
  }
  measurements(request: ResearchRequestV2_1) { return { ...(this.metrics.get(request) ?? { acquisitionCalls: 0, retrievedBytes: 0, modelCalls: 0, fixture: Boolean(this.options.fixtureTransport) }) }; }
  async execute(input: Parameters<ResearchWorker['execute']>[0]): Promise<ResearchWorkerOutput> {
    let pending = this.cache.get(input.request);
    if (!pending) { pending = this.collect(input.request); this.cache.set(input.request, pending); }
    try { return structuredClone(await pending); } catch (error) { this.cache.delete(input.request); throw error; }
  }

  private async collect(request: ResearchRequestV2_1): Promise<ResearchWorkerOutput> {
    const ssrf = new ResearchSsrfPolicy();
    const metrics = this.metrics.get(request) ?? { acquisitionCalls: 0, retrievedBytes: 0, modelCalls: 0, fixture: Boolean(this.options.fixtureTransport) };
    this.metrics.set(request, metrics);
    const acquire = async (initialUrl: string) => {
      const assertActive = () => {
        killSwitchService.assertAllowed('tool_execution', 'owner');
        if (request.ownerSessionBindingId && !ownerSessionBindingActive(request.ownerSessionBindingId)) throw new Error('OWNER_SESSION_REQUIRED');
      };
      const chain: string[] = [];
      let url = initialUrl;
      for (let redirect = 0; redirect <= 3; redirect++) {
        assertActive();
        const policy = await ssrf.validate(url, this.resolver);
        assertActive();
        if (policy.decision !== 'allowed') throw new Error(`RESEARCH_SSRF_BLOCKED:${policy.reasonCodes.join(',')}`);
        chain.push(policy.normalizedUrl!);
        metrics.acquisitionCalls++;
        const document = await (this.options.fixtureTransport ?? requestBytes)(policy.normalizedUrl!, policy);
        assertActive();
        metrics.retrievedBytes += document.bytes.length;
        if (document.bytes.length > 128 * 1024) throw new Error('RESEARCH_DOCUMENT_TOO_LARGE');
        if ([301, 302, 303, 307, 308].includes(document.status)) {
          if (!document.headers.location) throw new Error('RESEARCH_REDIRECT_LOCATION_REQUIRED');
          url = new URL(document.headers.location, url).toString();
          continue;
        }
        if (document.status < 200 || document.status >= 300) throw new Error('RESEARCH_HTTP_ERROR');
        if (!/^(?:text\/(?:html|plain)|application\/json)\b/i.test(document.headers.contentType ?? '')) throw new Error('RESEARCH_CONTENT_TYPE_UNSUPPORTED');
        return { url: policy.normalizedUrl!, chain, raw: document.bytes.toString('utf8'), hash: sha(document.bytes) };
      }
      throw new Error('RESEARCH_REDIRECT_LIMIT');
    };
    let urls = (request.seedUrls ?? []).slice(0, 3);
    if (!urls.length) {
      const search = new URL(this.options.searchUrl ?? 'https://html.duckduckgo.com/html/');
      search.searchParams.set('q', request.query);
      const page = await acquire(search.toString());
      urls = [...page.raw.matchAll(/href=["']([^"']+)["']/gi)].flatMap((match) => {
        try {
          const target = new URL(match[1].replace(/&amp;/g, '&'), page.url);
          const unwrapped = target.searchParams.get('uddg');
          const url = unwrapped ? new URL(unwrapped) : target;
          return url.hostname !== new URL(page.url).hostname && ['http:', 'https:'].includes(url.protocol) ? [url.toString()] : [];
        } catch { return []; }
      });
      urls = [...new Set(urls)].slice(0, 3);
      if (!urls.length) throw new Error('RESEARCH_SEARCH_NO_SOURCE_URLS');
    }
    const output: ResearchWorkerOutput = { sources: [], citations: [], claims: [], uncertainty: ['Source quotations are not independent corroboration. No language model was called.', ...(metrics.fixture ? ['TEST_FIXTURE_BYTES_ONLY'] : [])] };
    if (request.mode === 'BROWSER') output.uncertainty!.push('HTTP text acquisition only; browser rendering is not configured.');
    for (const url of urls) {
      const document = await acquire(url);
      const text = redactSensitiveString(plainText(document.raw));
      const terms = request.query.toLocaleLowerCase().split(/\s+/).filter((term) => term.length >= 3);
      const excerpt = text.split(/(?<=[.!?])\s+/).filter((sentence) => sentence.length >= 30 && sentence.length <= 600)
        .find((sentence) => terms.some((term) => sentence.toLocaleLowerCase().includes(term)));
      if (!excerpt) continue;
      const sourceId = `source-${sha(document.url).slice(0, 16)}`;
      const citationId = `citation-${sha(document.url + excerpt).slice(0, 16)}`;
      output.sources.push({ sourceId, url: document.url, title: redactSensitiveString(plainText(document.raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? new URL(document.url).hostname)).slice(0, 200),
        retrievedAt: new Date().toISOString(), contentSha256: document.hash, redirectChain: document.chain, acquisition: 'direct_fetch', retriever: { id: this.workerId, version: '1', source: 'builtin' } });
      output.citations.push({ citationId, sourceId, locator: 'verbatim text excerpt', excerptSha256: sha(excerpt) });
      output.claims.push({ claimId: `claim-${sha(excerpt).slice(0, 16)}`, statement: excerpt, citationIds: [citationId], confidence: 0.5, uncertainty: 'Verbatim source excerpt; independent truth not established.', status: 'uncertain' });
    }
    return output;
  }
}
