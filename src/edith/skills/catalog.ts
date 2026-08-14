import type { EdithRiskLevel } from '../core';

export interface EdithExternalSkillProject {
  id: string;
  name: string;
  sourceUrl: string;
  category:
    | 'browser-control'
    | 'computer-control'
    | 'coding-agent'
    | 'agent-framework'
    | 'web-data'
    | 'memory'
    | 'observability';
  status: 'cataloged' | 'adapter-ready' | 'requires-install' | 'deferred-high-risk';
  recommendedUse: string;
  integrationPlan: string;
  permissions: string[];
  maxRiskLevel: EdithRiskLevel;
  notes: string;
}

export const EDITH_EXTERNAL_SKILL_CATALOG: EdithExternalSkillProject[] = [
  {
    id: 'browser-use',
    name: 'Browser Use',
    sourceUrl: 'https://github.com/browser-use/browser-use',
    category: 'browser-control',
    status: 'requires-install',
    recommendedUse: 'LLM-driven browser navigation, clicking, typing, and form workflows.',
    integrationPlan: 'Wrap as a Python adapter behind EDITH browser permissions and per-domain approval.',
    permissions: ['network:read', 'browser:control'],
    maxRiskLevel: 3,
    notes: 'Strong fit for web task execution, but form submission and logged-in sessions need explicit approval.',
  },
  {
    id: 'playwright-mcp',
    name: 'Playwright MCP',
    sourceUrl: 'https://github.com/microsoft/playwright-mcp',
    category: 'browser-control',
    status: 'requires-install',
    recommendedUse: 'Deterministic browser automation and inspection through a maintained Playwright stack.',
    integrationPlan: 'Use for reproducible browser tools before adding fully autonomous browser agents.',
    permissions: ['network:read', 'browser:control'],
    maxRiskLevel: 3,
    notes: 'Best first dependency for reliable browser automation because it is explicit and testable.',
  },
  {
    id: 'openinterpreter',
    name: 'Open Interpreter',
    sourceUrl: 'https://github.com/openinterpreter/openinterpreter',
    category: 'computer-control',
    status: 'deferred-high-risk',
    recommendedUse: 'Local code execution and computer-use style automation.',
    integrationPlan: 'Only expose through a sandboxed adapter after command allowlists and human confirmation exist.',
    permissions: ['system:exec', 'file:read', 'file:write', 'browser:control'],
    maxRiskLevel: 5,
    notes: 'Powerful but too broad to enable before EDITH has stronger sandboxing and approval UX.',
  },
  {
    id: 'openhands',
    name: 'OpenHands',
    sourceUrl: 'https://github.com/All-Hands-AI/OpenHands',
    category: 'coding-agent',
    status: 'requires-install',
    recommendedUse: 'Autonomous software-development tasks in an isolated workspace.',
    integrationPlan: 'Integrate as a project-specific coding adapter, not as a global computer controller.',
    permissions: ['file:read', 'file:write', 'system:exec', 'network:read'],
    maxRiskLevel: 4,
    notes: 'Good candidate for coding workflows once task checkpoints and repo sandbox boundaries are enforced.',
  },
  {
    id: 'stagehand',
    name: 'Stagehand',
    sourceUrl: 'https://github.com/browserbase/stagehand',
    category: 'browser-control',
    status: 'requires-install',
    recommendedUse: 'AI-assisted browser automation with Playwright-style ergonomics.',
    integrationPlan: 'Evaluate after Playwright MCP/basic browser adapters are stable.',
    permissions: ['network:read', 'browser:control'],
    maxRiskLevel: 3,
    notes: 'Useful for higher-level browser actions, but may depend on external Browserbase services for some setups.',
  },
  {
    id: 'firecrawl',
    name: 'Firecrawl',
    sourceUrl: 'https://github.com/mendableai/firecrawl',
    category: 'web-data',
    status: 'requires-install',
    recommendedUse: 'Web scraping, crawling, and markdown extraction for research tasks.',
    integrationPlan: 'Add as a research/data extraction adapter with rate limits and robots/privacy policy checks.',
    permissions: ['network:read'],
    maxRiskLevel: 1,
    notes: 'Better for reading websites than controlling logged-in browser sessions.',
  },
  {
    id: 'crawl4ai',
    name: 'Crawl4AI',
    sourceUrl: 'https://github.com/unclecode/crawl4ai',
    category: 'web-data',
    status: 'requires-install',
    recommendedUse: 'Local-first web crawling and extraction for RAG/research workflows.',
    integrationPlan: 'Wrap as a read-only research skill before any browser-control expansion.',
    permissions: ['network:read'],
    maxRiskLevel: 1,
    notes: 'Good local-model companion for content extraction without giving full desktop control.',
  },
  {
    id: 'skyvern',
    name: 'Skyvern',
    sourceUrl: 'https://github.com/Skyvern-AI/skyvern',
    category: 'browser-control',
    status: 'deferred-high-risk',
    recommendedUse: 'Complex browser workflows such as multi-step web app tasks.',
    integrationPlan: 'Evaluate only after EDITH has domain allowlists, credential policy, and form-submit approvals.',
    permissions: ['network:read', 'browser:control'],
    maxRiskLevel: 4,
    notes: 'Too capable to enable broadly without strong policy boundaries.',
  },
  {
    id: 'mem0',
    name: 'Mem0',
    sourceUrl: 'https://github.com/mem0ai/mem0',
    category: 'memory',
    status: 'requires-install',
    recommendedUse: 'Long-term AI memory layer for user, project, and semantic memories.',
    integrationPlan: 'Compare with EDITH native SQLite/vector plan before adding another memory dependency.',
    permissions: ['memory:read', 'memory:write'],
    maxRiskLevel: 2,
    notes: 'Promising, but memory privacy/deletion rules must be settled first.',
  },
  {
    id: 'langfuse',
    name: 'Langfuse',
    sourceUrl: 'https://github.com/langfuse/langfuse',
    category: 'observability',
    status: 'requires-install',
    recommendedUse: 'LLM tracing, evals, and observability.',
    integrationPlan: 'Optional later; start with EDITH local JSONL/SQLite audit first.',
    permissions: ['network:write', 'telemetry:write'],
    maxRiskLevel: 2,
    notes: 'Useful once provider routing and task execution generate enough telemetry.',
  },
];

export function listExternalSkillProjects(): EdithExternalSkillProject[] {
  return EDITH_EXTERNAL_SKILL_CATALOG;
}
