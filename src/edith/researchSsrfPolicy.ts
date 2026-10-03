import net from 'node:net';

export type ResearchTargetClass = 'public' | 'private' | 'loopback' | 'link_local' | 'local' | 'reserved' | 'unknown';
export type ResearchUrlDecision = 'allowed' | 'blocked' | 'configuration_required';

export interface ResearchHostResolver {
  readonly resolverId: string;
  resolve(hostname: string): Promise<string[]>;
}

export interface ResearchRedirectValidator {
  validateRedirect(nextUrl: string, redirectChain: readonly string[]): Promise<ResearchUrlPolicyResult>;
}

export interface ResearchAcquisitionAdapter<TDocument = unknown> {
  readonly adapterId: string;
  readonly available: boolean;
  readonly resolver: ResearchHostResolver;
  acquire(input: {
    url: string;
    redirectValidator: ResearchRedirectValidator;
  }): Promise<{ document: TDocument; redirectChain: string[] }>;
}

export interface ResearchUrlPolicyResult {
  decision: ResearchUrlDecision;
  normalizedUrl?: string;
  targetClass: ResearchTargetClass;
  reasonCodes: string[];
  resolvedAddresses: string[];
  validatedAt: string;
  policyVersion: string;
}

const SECRET_QUERY_KEYS = /^(?:token|access_token|refresh_token|api[_-]?key|apikey|key|signature|secret|password|credential)$/i;
const LOCAL_HOST = /(?:^|\.)(?:localhost|local|internal|home|lan)$/i;
const METADATA_HOSTS = new Set(['metadata.google.internal', 'metadata.azure.internal', 'instance-data.ec2.internal']);

function classifyIpv4(address: string): ResearchTargetClass {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return 'unknown';
  const [a, b] = parts;
  if (a === 127) return 'loopback';
  if (a === 169 && b === 254) return 'link_local';
  if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return 'private';
  if (a === 0 || (a === 100 && b >= 64 && b <= 127) || a >= 224
    || (a === 192 && b === 0) || (a === 192 && b === 2)
    || (a === 198 && (b === 18 || b === 19 || b === 51)) || (a === 203 && b === 0)) return 'reserved';
  return 'public';
}

export function classifyResearchAddress(address: string): ResearchTargetClass {
  const normalized = address.toLocaleLowerCase('en-US').replace(/^\[|\]$/g, '');
  if (net.isIP(normalized) === 4) return classifyIpv4(normalized);
  if (net.isIP(normalized) !== 6) return 'unknown';
  if (normalized === '::1') return 'loopback';
  if (normalized === '::') return 'reserved';
  if (normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) return 'link_local';
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return 'private';
  if (normalized.startsWith('ff') || normalized.startsWith('2001:db8:')) return 'reserved';
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return mapped ? classifyIpv4(mapped[1]) : 'public';
}

export class ResearchSsrfPolicy {
  readonly version = 'edith-research-ssrf-v1';

  async validate(rawUrl: string, resolver?: ResearchHostResolver): Promise<ResearchUrlPolicyResult> {
    const validatedAt = new Date().toISOString();
    let url: URL;
    try { url = new URL(rawUrl); } catch {
      return this.result('blocked', 'unknown', ['MALFORMED_URL'], [], validatedAt);
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return this.result('blocked', 'unknown', ['SCHEME_BLOCKED'], [], validatedAt);
    if (url.username || url.password) return this.result('blocked', 'unknown', ['CREDENTIALS_IN_URL'], [], validatedAt);
    if ([...url.searchParams.keys()].some((key) => SECRET_QUERY_KEYS.test(key))) {
      return this.result('blocked', 'unknown', ['SECRET_QUERY_PARAMETER'], [], validatedAt);
    }
    const hostname = url.hostname.toLocaleLowerCase('en-US').replace(/^\[|\]$/g, '');
    if (hostname === 'localhost' || LOCAL_HOST.test(hostname) || METADATA_HOSTS.has(hostname)) {
      return this.result('blocked', hostname.includes('metadata') ? 'reserved' : 'local', ['LOCAL_OR_METADATA_HOST'], [], validatedAt);
    }
    if (net.isIP(hostname)) {
      const targetClass = classifyResearchAddress(hostname);
      return targetClass === 'public'
        ? this.result('allowed', targetClass, [], [hostname], validatedAt, url.toString())
        : this.result('blocked', targetClass, ['NON_PUBLIC_ADDRESS'], [hostname], validatedAt);
    }
    if (!resolver) return this.result('configuration_required', 'unknown', ['DNS_RESOLVER_REQUIRED'], [], validatedAt);
    let addresses: string[];
    try { addresses = [...new Set(await resolver.resolve(hostname))]; } catch {
      return this.result('blocked', 'unknown', ['DNS_RESOLUTION_FAILED'], [], validatedAt);
    }
    if (!addresses.length) return this.result('blocked', 'unknown', ['DNS_NO_ADDRESSES'], [], validatedAt);
    const classes = addresses.map(classifyResearchAddress);
    const blocked = classes.find((item) => item !== 'public');
    return blocked
      ? this.result('blocked', blocked, ['DNS_NON_PUBLIC_ADDRESS'], addresses, validatedAt)
      : this.result('allowed', 'public', [], addresses, validatedAt, url.toString());
  }

  async validateRedirectChain(urls: readonly string[], resolver?: ResearchHostResolver): Promise<ResearchUrlPolicyResult[]> {
    if (!urls.length) return [this.result('blocked', 'unknown', ['EMPTY_REDIRECT_CHAIN'], [], new Date().toISOString())];
    const results: ResearchUrlPolicyResult[] = [];
    for (const url of urls) {
      const result = await this.validate(url, resolver);
      results.push(result);
      if (result.decision !== 'allowed') break;
    }
    return results;
  }

  redirectValidator(resolver?: ResearchHostResolver): ResearchRedirectValidator {
    return {
      validateRedirect: async (nextUrl, redirectChain) => {
        const results = await this.validateRedirectChain([...redirectChain, nextUrl], resolver);
        return results[results.length - 1];
      },
    };
  }

  private result(decision: ResearchUrlDecision, targetClass: ResearchTargetClass, reasonCodes: string[], resolvedAddresses: string[], validatedAt: string, normalizedUrl?: string): ResearchUrlPolicyResult {
    return { decision, targetClass, reasonCodes, resolvedAddresses, validatedAt, normalizedUrl, policyVersion: this.version };
  }
}
