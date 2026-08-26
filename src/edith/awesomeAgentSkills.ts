import fs from 'node:fs';
import path from 'node:path';
import type {
  EdithRiskLevel,
  EdithToolMetadata,
  EdithToolRegistry,
  EdithToolResult,
} from './core';

export type AwesomeAgentSkillDomain =
  | 'crypto'
  | 'finance'
  | 'news'
  | 'search'
  | 'messaging'
  | 'computer-control';

export interface AwesomeAgentSkillDefinition {
  toolId: string;
  name: string;
  sourceName: string;
  sourceUrl: string;
  domain: AwesomeAgentSkillDomain;
  status: 'adapter-ready' | 'configuration-required' | 'deferred-high-risk';
  summary: string;
  permissions: string[];
  riskLevel: EdithRiskLevel;
  dependencies: string[];
  inputSchema: EdithToolMetadata['inputSchema'];
  handlerKind:
    | 'binance-price'
    | 'binance-24hr'
    | 'coinbase-ticker'
    | 'brave-news'
    | 'brave-web'
    | 'guarded-config';
}

export interface DownloadedAwesomeAgentSkill {
  id: string;
  name: string;
  sourceUrl: string;
  description: string;
  category: string;
  riskLevel: EdithRiskLevel;
  permissions: string[];
  status: 'downloaded' | 'adapter-ready' | 'configuration-required' | 'deferred-high-risk';
}

export interface DownloadedAwesomeAgentSkillCatalog {
  source: string;
  importedAt: string;
  total: number;
  byCategory: Record<string, number>;
  skills: DownloadedAwesomeAgentSkill[];
}

export const EDITH_AWESOME_AGENT_SKILLS: AwesomeAgentSkillDefinition[] = [
  {
    toolId: 'binance_market_price',
    name: 'Binance Market Price',
    sourceName: 'binance/market-data',
    sourceUrl: 'https://officialskills.sh/binance/skills/market-data',
    domain: 'crypto',
    status: 'adapter-ready',
    summary: 'Read-only crypto symbol price lookup through Binance public market data.',
    permissions: ['network:read'],
    riskLevel: 1,
    dependencies: ['internet access'],
    inputSchema: {
      symbol: { type: 'string', required: true, description: 'Trading pair such as BTCUSDT.' },
    },
    handlerKind: 'binance-price',
  },
  {
    toolId: 'binance_market_24hr',
    name: 'Binance 24h Market Snapshot',
    sourceName: 'binance/market-intelligence',
    sourceUrl: 'https://officialskills.sh/binance/skills/market-intelligence',
    domain: 'crypto',
    status: 'adapter-ready',
    summary: 'Read-only 24 hour ticker snapshot for crypto watchlists.',
    permissions: ['network:read'],
    riskLevel: 1,
    dependencies: ['internet access'],
    inputSchema: {
      symbol: { type: 'string', required: true, description: 'Trading pair such as ETHUSDT.' },
    },
    handlerKind: 'binance-24hr',
  },
  {
    toolId: 'coinbase_ticker_lookup',
    name: 'Coinbase Ticker Lookup',
    sourceName: 'coinbase/crypto-data',
    sourceUrl: 'https://github.com/coinbase/agentkit',
    domain: 'crypto',
    status: 'adapter-ready',
    summary: 'Read-only Coinbase Exchange ticker lookup for USD pairs.',
    permissions: ['network:read'],
    riskLevel: 1,
    dependencies: ['internet access'],
    inputSchema: {
      product: { type: 'string', required: true, description: 'Coinbase product such as BTC-USD.' },
    },
    handlerKind: 'coinbase-ticker',
  },
  {
    toolId: 'binance_spot_trade_guard',
    name: 'Binance Spot Trade Guard',
    sourceName: 'binance/spot-trading',
    sourceUrl: 'https://officialskills.sh/binance/skills/spot-trading',
    domain: 'finance',
    status: 'deferred-high-risk',
    summary: 'Permission-gated spot-trading adapter placeholder. It never places orders without a configured exchange adapter.',
    permissions: ['trading:execute'],
    riskLevel: 5,
    dependencies: ['Binance API credentials', 'exchange execution adapter'],
    inputSchema: {
      intent: { type: 'string', required: true, description: 'Trading intent to validate.' },
      symbol: { type: 'string', required: false },
    },
    handlerKind: 'guarded-config',
  },
  {
    toolId: 'binance_trade_signal_guard',
    name: 'Binance Trade Signal Guard',
    sourceName: 'binance/trading-signals',
    sourceUrl: 'https://officialskills.sh/binance/skills/trading-signals',
    domain: 'finance',
    status: 'configuration-required',
    summary: 'Trading-signal planning stub with no financial advice or order execution.',
    permissions: ['network:read'],
    riskLevel: 2,
    dependencies: ['strategy rules', 'risk profile'],
    inputSchema: {
      symbol: { type: 'string', required: true },
      timeframe: { type: 'string', required: false },
    },
    handlerKind: 'guarded-config',
  },
  {
    toolId: 'brave_news_search',
    name: 'Brave News Search',
    sourceName: 'brave/news-search',
    sourceUrl: 'https://officialskills.sh/brave/skills/news-search',
    domain: 'news',
    status: 'configuration-required',
    summary: 'Daily news lookup adapter. Uses Brave Search API only when BRAVE_SEARCH_API_KEY exists.',
    permissions: ['network:read'],
    riskLevel: 1,
    dependencies: ['BRAVE_SEARCH_API_KEY'],
    inputSchema: {
      query: { type: 'string', required: true },
      count: { type: 'number', required: false },
    },
    handlerKind: 'brave-news',
  },
  {
    toolId: 'brave_web_search',
    name: 'Brave Web Search',
    sourceName: 'brave/web-search',
    sourceUrl: 'https://officialskills.sh/brave/skills/web-search',
    domain: 'search',
    status: 'configuration-required',
    summary: 'General web search adapter. Uses Brave Search API only when BRAVE_SEARCH_API_KEY exists.',
    permissions: ['network:read'],
    riskLevel: 1,
    dependencies: ['BRAVE_SEARCH_API_KEY'],
    inputSchema: {
      query: { type: 'string', required: true },
      count: { type: 'number', required: false },
    },
    handlerKind: 'brave-web',
  },
  {
    toolId: 'whatsapp_integrate_guard',
    name: 'WhatsApp Integration Guard',
    sourceName: 'gokapso/integrate-whatsapp',
    sourceUrl: 'https://github.com/gokapso/agent-skills/tree/master/skills/integrate-whatsapp',
    domain: 'messaging',
    status: 'configuration-required',
    summary: 'WhatsApp setup/webhook adapter placeholder. It does not send messages without a configured provider.',
    permissions: ['network:read', 'network:write'],
    riskLevel: 3,
    dependencies: ['WhatsApp Business provider', 'webhook secret'],
    inputSchema: {
      action: { type: 'string', required: true },
      phoneNumberId: { type: 'string', required: false },
    },
    handlerKind: 'guarded-config',
  },
  {
    toolId: 'whatsapp_automation_guard',
    name: 'WhatsApp Automation Guard',
    sourceName: 'gokapso/automate-whatsapp',
    sourceUrl: 'https://github.com/gokapso/agent-skills/tree/master/skills/automate-whatsapp',
    domain: 'messaging',
    status: 'deferred-high-risk',
    summary: 'WhatsApp automation placeholder. Message sending and workflow execution stay disabled until explicitly configured.',
    permissions: ['network:write'],
    riskLevel: 4,
    dependencies: ['WhatsApp Business provider', 'approval policy', 'message templates'],
    inputSchema: {
      workflow: { type: 'string', required: true },
      recipient: { type: 'string', required: false },
    },
    handlerKind: 'guarded-config',
  },
  {
    toolId: 'whatsapp_observe_health',
    name: 'WhatsApp Delivery Health',
    sourceName: 'gokapso/observe-whatsapp',
    sourceUrl: 'https://github.com/gokapso/agent-skills/tree/master/skills/observe-whatsapp',
    domain: 'messaging',
    status: 'configuration-required',
    summary: 'Read-only WhatsApp delivery/debug health adapter placeholder.',
    permissions: ['network:read'],
    riskLevel: 2,
    dependencies: ['WhatsApp Business provider token'],
    inputSchema: {
      messageId: { type: 'string', required: false },
      phoneNumberId: { type: 'string', required: false },
    },
    handlerKind: 'guarded-config',
  },
  {
    toolId: 'computer_use_guard',
    name: 'Computer Use Guard',
    sourceName: 'anthropics/computer-use',
    sourceUrl: 'https://docs.anthropic.com/en/docs/agents-and-tools/computer-use',
    domain: 'computer-control',
    status: 'deferred-high-risk',
    summary: 'Full desktop-control bridge placeholder. It remains permission-gated and unbound by default.',
    permissions: ['computer:control', 'system:exec'],
    riskLevel: 5,
    dependencies: ['computer-use runtime', 'screen adapter', 'input adapter'],
    inputSchema: {
      instruction: { type: 'string', required: true },
    },
    handlerKind: 'guarded-config',
  },
];

function downloadedCatalogPath(): string {
  const configuredPath = process.env.EDITH_AWESOME_SKILL_CATALOG_PATH?.trim();
  if (configuredPath) return configuredPath;
  return path.join(process.cwd(), 'data', 'external-skills', 'awesome-agent-skills.catalog.json');
}

export function loadDownloadedAwesomeAgentSkillCatalog(): DownloadedAwesomeAgentSkillCatalog {
  const file = downloadedCatalogPath();
  if (!fs.existsSync(file)) {
    return {
      source: 'https://github.com/VoltAgent/awesome-agent-skills',
      importedAt: new Date(0).toISOString(),
      total: 0,
      byCategory: {},
      skills: [],
    };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<DownloadedAwesomeAgentSkillCatalog>;
    const skills = Array.isArray(parsed.skills) ? parsed.skills.filter((skill) =>
      typeof skill?.id === 'string' &&
      typeof skill?.name === 'string' &&
      typeof skill?.sourceUrl === 'string'
    ) as DownloadedAwesomeAgentSkill[] : [];
    return {
      source: typeof parsed.source === 'string' ? parsed.source : 'https://github.com/VoltAgent/awesome-agent-skills',
      importedAt: typeof parsed.importedAt === 'string' ? parsed.importedAt : new Date(0).toISOString(),
      total: typeof parsed.total === 'number' ? parsed.total : skills.length,
      byCategory: parsed.byCategory && typeof parsed.byCategory === 'object' ? parsed.byCategory : {},
      skills,
    };
  } catch {
    return {
      source: 'https://github.com/VoltAgent/awesome-agent-skills',
      importedAt: new Date(0).toISOString(),
      total: 0,
      byCategory: {},
      skills: [],
    };
  }
}

function searchDownloadedSkills(args: Record<string, unknown>): EdithToolResult {
  const query = stringArg(args, 'query')?.toLowerCase() ?? '';
  const category = stringArg(args, 'category')?.toLowerCase();
  const limit = numberArg(args, 'limit', 25);
  const catalog = loadDownloadedAwesomeAgentSkillCatalog();
  const skills = catalog.skills
    .filter((skill) => !category || skill.category.toLowerCase() === category)
    .filter((skill) => !query || `${skill.name} ${skill.description} ${skill.sourceUrl}`.toLowerCase().includes(query))
    .slice(0, limit);

  return {
    success: true,
    toolId: 'awesome_skill_catalog_search',
    result: JSON.stringify({ total: catalog.total, returned: skills.length, byCategory: catalog.byCategory, skills }, null, 2),
    structuredOutput: {
      source: catalog.source,
      importedAt: catalog.importedAt,
      total: catalog.total,
      returned: skills.length,
      byCategory: catalog.byCategory,
      skills,
    },
  };
}

function downloadedSkillStatus(args: Record<string, unknown>): EdithToolResult {
  const id = stringArg(args, 'id');
  const catalog = loadDownloadedAwesomeAgentSkillCatalog();
  const skill = catalog.skills.find((candidate) => candidate.id === id || candidate.name.toLowerCase() === id?.toLowerCase());
  if (!skill) {
    return {
      success: false,
      toolId: 'awesome_skill_status',
      error: `Downloaded awesome-agent skill not found: ${id ?? '(empty)'}`,
      errorCode: 'VALIDATION_ERROR',
      structuredOutput: { total: catalog.total, byCategory: catalog.byCategory },
    };
  }
  return {
    success: true,
    toolId: 'awesome_skill_status',
    result: JSON.stringify(skill, null, 2),
    structuredOutput: {
      skill,
      honestStatus: skill.status === 'adapter-ready'
        ? 'Adapter is ready through EDITH.'
        : 'Skill is downloaded/cataloged. Real execution requires a provider adapter, credentials, or runtime binding.',
    },
  };
}

function stringArg(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' ? value.trim() : undefined;
}

function numberArg(args: Record<string, unknown>, key: string, fallback: number): number {
  const value = args[key];
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(1, Math.min(20, Math.floor(value))) : fallback;
}

async function fetchJson(url: string, init?: RequestInit): Promise<Record<string, unknown> | unknown[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status} from ${new URL(url).hostname}`);
    return await response.json() as Record<string, unknown> | unknown[];
  } finally {
    clearTimeout(timeout);
  }
}

function configurationRequired(skill: AwesomeAgentSkillDefinition, args: Record<string, unknown>): EdithToolResult {
  return {
    success: false,
    toolId: skill.toolId,
    error: `CONFIGURATION_REQUIRED: ${skill.name} is installed in EDITH, but the real provider/runtime is not configured yet.`,
    errorCode: 'TOOL_ERROR',
    structuredOutput: {
      skill: skill.sourceName,
      sourceUrl: skill.sourceUrl,
      status: skill.status,
      dependencies: skill.dependencies,
      args,
      honestStatus: 'No message, order, desktop input, or external write action was executed.',
    },
  };
}

async function runSkill(skill: AwesomeAgentSkillDefinition, args: Record<string, unknown>): Promise<EdithToolResult> {
  if (skill.handlerKind === 'guarded-config') return configurationRequired(skill, args);

  if (skill.handlerKind === 'binance-price') {
    const symbol = stringArg(args, 'symbol')?.toUpperCase();
    const data = await fetchJson(`https://api.binance.com/api/v3/ticker/price?symbol=${encodeURIComponent(symbol ?? '')}`);
    return {
      success: true,
      toolId: skill.toolId,
      result: JSON.stringify(data, null, 2),
      structuredOutput: { skill: skill.sourceName, data, readOnly: true },
    };
  }

  if (skill.handlerKind === 'binance-24hr') {
    const symbol = stringArg(args, 'symbol')?.toUpperCase();
    const data = await fetchJson(`https://api.binance.com/api/v3/ticker/24hr?symbol=${encodeURIComponent(symbol ?? '')}`);
    return {
      success: true,
      toolId: skill.toolId,
      result: JSON.stringify(data, null, 2),
      structuredOutput: { skill: skill.sourceName, data, readOnly: true },
    };
  }

  if (skill.handlerKind === 'coinbase-ticker') {
    const product = stringArg(args, 'product')?.toUpperCase();
    const data = await fetchJson(`https://api.exchange.coinbase.com/products/${encodeURIComponent(product ?? '')}/ticker`);
    return {
      success: true,
      toolId: skill.toolId,
      result: JSON.stringify(data, null, 2),
      structuredOutput: { skill: skill.sourceName, data, readOnly: true },
    };
  }

  const apiKey = process.env.BRAVE_SEARCH_API_KEY?.trim();
  if (!apiKey) return configurationRequired(skill, args);
  const query = stringArg(args, 'query') ?? '';
  const count = numberArg(args, 'count', 5);
  const endpoint = skill.handlerKind === 'brave-news'
    ? 'https://api.search.brave.com/res/v1/news/search'
    : 'https://api.search.brave.com/res/v1/web/search';
  const url = `${endpoint}?q=${encodeURIComponent(query)}&count=${count}`;
  const data = await fetchJson(url, {
    headers: {
      Accept: 'application/json',
      'X-Subscription-Token': apiKey,
    },
  });
  return {
    success: true,
    toolId: skill.toolId,
    result: JSON.stringify(data, null, 2),
    structuredOutput: { skill: skill.sourceName, data, readOnly: true },
  };
}

export function registerAwesomeAgentSkillTools(registry: EdithToolRegistry): void {
  registry.register({
    id: 'awesome_skill_catalog_search',
    metadata: {
      name: 'Awesome Agent Skills Catalog Search',
      version: '0.1.0',
      description: 'Searches the locally downloaded VoltAgent awesome-agent-skills catalog imported into EDITH.',
      category: 'analytics',
      inputSchema: {
        query: { type: 'string', required: false, description: 'Search text such as finance, whatsapp, pdf, news, browser, or security.' },
        category: { type: 'string', required: false, description: 'Optional normalized category.' },
        limit: { type: 'number', required: false },
      },
      outputSchema: {
        total: { type: 'number' },
        byCategory: { type: 'object' },
        skills: { type: 'array' },
      },
      requiredPermissions: ['system:read'],
      riskLevel: 0,
      timeoutMs: 2000,
      retryLimit: 0,
      supportsDryRun: true,
      supportsRollback: false,
      platforms: ['win32', 'darwin', 'linux'],
      dependencies: ['data/external-skills/awesome-agent-skills.catalog.json'],
    },
    handler: (args): EdithToolResult => searchDownloadedSkills(args),
  });

  registry.register({
    id: 'awesome_skill_status',
    metadata: {
      name: 'Awesome Agent Skill Status',
      version: '0.1.0',
      description: 'Reports whether a downloaded awesome-agent skill is only cataloged or has an EDITH adapter/runtime binding.',
      category: 'analytics',
      inputSchema: {
        id: { type: 'string', required: true, description: 'Downloaded skill id or exact skill name.' },
      },
      outputSchema: {
        skill: { type: 'object' },
        honestStatus: { type: 'string' },
      },
      requiredPermissions: ['system:read'],
      riskLevel: 0,
      timeoutMs: 2000,
      retryLimit: 0,
      supportsDryRun: true,
      supportsRollback: false,
      platforms: ['win32', 'darwin', 'linux'],
      dependencies: ['data/external-skills/awesome-agent-skills.catalog.json'],
    },
    handler: (args): EdithToolResult => downloadedSkillStatus(args),
  });

  for (const skill of EDITH_AWESOME_AGENT_SKILLS) {
    registry.register({
      id: skill.toolId,
      metadata: {
        name: skill.name,
        version: '0.1.0',
        description: `${skill.summary} Source: ${skill.sourceName}.`,
        category: skill.domain === 'crypto' || skill.domain === 'finance'
          ? 'finance'
          : skill.domain === 'messaging'
          ? 'web'
          : skill.domain === 'computer-control'
          ? 'computer'
          : 'web',
        inputSchema: skill.inputSchema,
        outputSchema: {
          skill: { type: 'string' },
          data: { type: 'object' },
          readOnly: { type: 'boolean' },
          honestStatus: { type: 'string' },
        },
        requiredPermissions: skill.permissions,
        riskLevel: skill.riskLevel,
        timeoutMs: 15000,
        retryLimit: 0,
        supportsDryRun: true,
        supportsRollback: false,
        platforms: ['win32', 'darwin', 'linux'],
        dependencies: skill.dependencies,
      },
      handler: (args): Promise<EdithToolResult> => runSkill(skill, args),
    });
  }
}
