import type { EdithAgentMetadata, EdithAgentRoute, EdithTask } from './core';
import { getEdithToolHealth } from './serverRegistry';

const DEFAULT_AGENT_METRICS = {
  runs: 0,
  successes: 0,
  failures: 0,
};

export const EDITH_AGENTS: EdithAgentMetadata[] = [
  {
    id: 'orchestrator',
    name: 'Main Orchestrator Agent',
    version: '0.1.0',
    responsibility: 'Owns objective flow, task lifecycle coordination, and handoff decisions.',
    capabilities: ['intent-review', 'task-coordination', 'handoff', 'reporting'],
    allowedTools: ['task_create', 'ai_skill_catalog', 'mark_l_capabilities'],
    requiredPermissions: ['system:read'],
    inputSchema: { objective: { type: 'string', required: true } },
    outputSchema: { decision: { type: 'string' }, handoff: { type: 'object' } },
    timeoutMs: 30000,
    health: 'HEALTHY',
    metrics: { ...DEFAULT_AGENT_METRICS },
  },
  {
    id: 'planning',
    name: 'Planning Agent',
    version: '0.1.0',
    responsibility: 'Decomposes objectives into structured plans, dependencies, validation criteria, and budgets.',
    capabilities: ['planning', 'decomposition', 'dependency-analysis', 'budgeting'],
    allowedTools: ['ai_skill_catalog', 'mark_l_capabilities'],
    requiredPermissions: ['system:read'],
    inputSchema: { task: { type: 'object', required: true } },
    outputSchema: { plan: { type: 'object' } },
    timeoutMs: 45000,
    health: 'HEALTHY',
    metrics: { ...DEFAULT_AGENT_METRICS },
  },
  {
    id: 'research',
    name: 'Research Agent',
    version: '0.1.0',
    responsibility: 'Gathers web and external knowledge using read-only research tools.',
    capabilities: ['web-research', 'source-review', 'summarization', 'obsidian-note-output'],
    allowedTools: ['browser_search', 'browser_open', 'brave_news_search', 'brave_web_search', 'ai_skill_catalog', 'obsidian_save_note'],
    requiredPermissions: ['network:read', 'system:read', 'memory:write'],
    inputSchema: { query: { type: 'string', required: true } },
    outputSchema: { findings: { type: 'array' } },
    timeoutMs: 60000,
    health: 'HEALTHY',
    metrics: { ...DEFAULT_AGENT_METRICS },
  },
  {
    id: 'browser-computer',
    name: 'Browser/Computer Agent',
    version: '0.1.0',
    responsibility: 'Controls high-risk browser or desktop adapters only after explicit backend permission.',
    capabilities: ['browser-control', 'desktop-control', 'screen-operation'],
    allowedTools: ['browser_use_agent', 'playwright_browser_agent', 'computer_control_agent', 'computer_use_guard', 'open_interpreter_agent'],
    requiredPermissions: ['network:read', 'browser:control', 'computer:control', 'system:exec'],
    inputSchema: { instruction: { type: 'string', required: true } },
    outputSchema: { artifact: { type: 'object' }, status: { type: 'string' } },
    timeoutMs: 120000,
    health: 'UNAVAILABLE',
    metrics: { ...DEFAULT_AGENT_METRICS },
  },
  {
    id: 'browser-workflow',
    name: 'Browser Workflow Agent',
    version: '0.1.0',
    responsibility: 'Runs deterministic browser workflows through EDITH browser adapters and verification evidence.',
    capabilities: ['browser-workflow', 'web-navigation', 'pdf-reading', 'form-workflow'],
    allowedTools: ['browser_workflow', 'browser_search', 'browser_open', 'playwright_browser_agent'],
    requiredPermissions: ['network:read'],
    inputSchema: { request: { type: 'object', required: true } },
    outputSchema: { result: { type: 'object' }, verification: { type: 'string' } },
    timeoutMs: 120000,
    health: 'DEGRADED',
    metrics: { ...DEFAULT_AGENT_METRICS },
  },
  {
    id: 'coding',
    name: 'Coding Agent',
    version: '0.1.0',
    responsibility: 'Handles code-oriented planning, local code assistance, and controlled interpreter handoffs.',
    capabilities: ['code-review', 'code-edit-planning', 'local-dev', 'obsidian-technical-notes'],
    allowedTools: ['open_interpreter_agent', 'ai_skill_catalog', 'obsidian_save_note'],
    requiredPermissions: ['system:read', 'system:exec', 'file:read', 'file:write'],
    inputSchema: { request: { type: 'string', required: true } },
    outputSchema: { patchPlan: { type: 'object' } },
    timeoutMs: 120000,
    health: 'DEGRADED',
    metrics: { ...DEFAULT_AGENT_METRICS },
  },
  {
    id: 'vision',
    name: 'Vision Agent',
    version: '0.1.0',
    responsibility: 'Owns future screen/image understanding and visual verification handoffs.',
    capabilities: ['image-analysis', 'screen-analysis', 'visual-verification'],
    allowedTools: ['vision_observe'],
    requiredPermissions: ['system:read'],
    inputSchema: { image: { type: 'object' } },
    outputSchema: { observations: { type: 'array' } },
    timeoutMs: 60000,
    health: 'DEGRADED',
    metrics: { ...DEFAULT_AGENT_METRICS },
  },
  {
    id: 'proactive-monitoring',
    name: 'Proactive Monitoring Agent',
    version: '0.1.0',
    responsibility: 'Evaluates permissioned background signals and emits non-invasive notifications or suggestions.',
    capabilities: ['proactive-monitoring', 'notification-triage', 'presence-aware-delivery'],
    allowedTools: ['system_monitor', 'obsidian_save_note'],
    requiredPermissions: ['system:read', 'system:notify', 'memory:write'],
    inputSchema: { settings: { type: 'object', required: true } },
    outputSchema: { signals: { type: 'array' } },
    timeoutMs: 30000,
    health: 'HEALTHY',
    metrics: { ...DEFAULT_AGENT_METRICS },
  },
  {
    id: 'design3d-orchestrator',
    name: '3D Design Orchestrator',
    version: '0.1.0',
    responsibility: 'Plans natural-language 3D design work and routes CAD, render, simulation, manufacturing, and validation tools honestly.',
    capabilities: ['3d-planning', 'cad-routing', 'render-routing', 'simulation-routing', 'manufacturing-routing'],
    allowedTools: ['design3d_cad_foundation', 'design3d_render_foundation', 'design3d_simulation_foundation'],
    requiredPermissions: ['system:read'],
    inputSchema: { prompt: { type: 'string', required: true } },
    outputSchema: { plan: { type: 'object' }, requiredEngines: { type: 'array' } },
    timeoutMs: 60000,
    health: 'DEGRADED',
    metrics: { ...DEFAULT_AGENT_METRICS },
  },
  {
    id: 'meeting',
    name: 'Meeting Agent',
    version: '0.1.0',
    responsibility: 'Turns meeting notes and summaries into Obsidian-linked knowledge records.',
    capabilities: ['meeting-summary', 'action-item-extraction', 'obsidian-meeting-notes'],
    allowedTools: ['obsidian_save_note'],
    requiredPermissions: ['system:read', 'memory:write'],
    inputSchema: { transcript: { type: 'string', required: true } },
    outputSchema: { summary: { type: 'string' }, tasks: { type: 'array' } },
    timeoutMs: 60000,
    health: 'HEALTHY',
    metrics: { ...DEFAULT_AGENT_METRICS },
  },
  {
    id: 'trading',
    name: 'Trading Agent',
    version: '0.1.0',
    responsibility: 'Writes trading journals and routes any trading action through the finance guard.',
    capabilities: ['trading-journal', 'market-note-capture', 'crypto-market-read', 'finance-guard-routing'],
    allowedTools: [
      'obsidian_save_note',
      'finance_trading_guard',
      'binance_market_price',
      'binance_market_24hr',
      'coinbase_ticker_lookup',
      'binance_spot_trade_guard',
      'binance_trade_signal_guard',
    ],
    requiredPermissions: ['system:read', 'memory:write', 'trading:execute'],
    inputSchema: { journal: { type: 'string', required: true } },
    outputSchema: { notePath: { type: 'string' }, guardDecision: { type: 'object' } },
    timeoutMs: 60000,
    health: 'DEGRADED',
    metrics: { ...DEFAULT_AGENT_METRICS },
  },
  {
    id: 'sensitive-integration-guard',
    name: 'Sensitive Integration Guard',
    version: '0.1.0',
    responsibility: 'Keeps IoT, finance, trading, broker, and device actions permission-gated and honest until real adapters are configured.',
    capabilities: ['iot-guard', 'finance-guard', 'trading-safety', 'configuration-required-reporting'],
    allowedTools: [
      'iot_feedback_stub',
      'finance_trading_guard',
      'binance_spot_trade_guard',
      'binance_trade_signal_guard',
      'whatsapp_integrate_guard',
      'whatsapp_automation_guard',
      'computer_use_guard',
      'obsidian_save_note',
    ],
    requiredPermissions: ['system:read', 'iot:control', 'trading:execute', 'memory:write'],
    inputSchema: { request: { type: 'object', required: true } },
    outputSchema: { decision: { type: 'object' }, honestStatus: { type: 'string' } },
    timeoutMs: 30000,
    health: 'DEGRADED',
    metrics: { ...DEFAULT_AGENT_METRICS },
  },
  {
    id: 'security',
    name: 'Security Agent',
    version: '0.1.0',
    responsibility: 'Reviews high-risk plans, permissions, and external-action safety boundaries.',
    capabilities: ['risk-review', 'permission-review', 'policy-check'],
    allowedTools: ['ai_skill_catalog', 'mark_l_capabilities'],
    requiredPermissions: ['system:read'],
    inputSchema: { plan: { type: 'object' }, riskLevel: { type: 'number' } },
    outputSchema: { riskDecision: { type: 'object' } },
    timeoutMs: 45000,
    health: 'HEALTHY',
    metrics: { ...DEFAULT_AGENT_METRICS },
  },
];

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function healthAwareAgents(): EdithAgentMetadata[] {
  const toolHealth = new Map(getEdithToolHealth().map((tool) => [tool.toolId, tool]));
  return EDITH_AGENTS.map((agent) => {
    const unavailableTools = agent.allowedTools.filter((toolId) => toolHealth.get(toolId)?.enabled === false);
    if (agent.health === 'UNAVAILABLE' || unavailableTools.length === agent.allowedTools.length && agent.allowedTools.length > 0) {
      return { ...agent, health: 'UNAVAILABLE' };
    }
    if (agent.health === 'DEGRADED' || unavailableTools.length > 0) {
      return { ...agent, health: 'DEGRADED' };
    }
    return agent;
  });
}

export class AgentRegistryService {
  listAgents(): EdithAgentMetadata[] {
    return healthAwareAgents();
  }

  getAgent(agentId: string): EdithAgentMetadata | undefined {
    return this.listAgents().find((agent) => agent.id === agentId);
  }

  routeTask(task: Pick<EdithTask, 'objective' | 'riskLevel' | 'toolsRequired' | 'permissionsRequired'>): EdithAgentRoute[] {
    const agents = this.listAgents();
    const objective = task.objective.toLocaleLowerCase('tr-TR');
    const routes: EdithAgentRoute[] = [
      {
        agentId: 'orchestrator',
        reason: 'Every durable task starts with orchestration ownership.',
        matchedTools: [],
        missingPermissions: [],
      },
      {
        agentId: 'planning',
        reason: 'Structured task plans require a planning owner.',
        matchedTools: [],
        missingPermissions: [],
      },
    ];

    const addRoute = (agentId: string, reason: string, matchedTools: string[] = []) => {
      const agent = agents.find((candidate) => candidate.id === agentId);
      if (!agent || routes.some((route) => route.agentId === agentId)) return;
      const missingPermissions = agent.requiredPermissions.filter(
        (permission) => !task.permissionsRequired.includes(permission)
      );
      routes.push({ agentId, reason, matchedTools, missingPermissions });
    };

    for (const agent of agents) {
      const matchedTools = task.toolsRequired.filter((tool) => agent.allowedTools.includes(tool));
      if (matchedTools.length > 0) {
        addRoute(agent.id, `Agent allows selected tools: ${matchedTools.join(', ')}.`, matchedTools);
      }
    }

    if (/\b(web|internet|araştır|haber|news|site|url|browser|tarayıcı|brave|arama)\b/i.test(objective)) {
      addRoute('research', 'Objective requires web or research capability.');
    }
    if (/\b(kod|code|script|typescript|python|bug|build|test)\b/i.test(objective)) {
      addRoute('coding', 'Objective appears code-oriented.');
    }
    if (/\b(görüntü|image|screen|ekran|vision|screenshot)\b/i.test(objective)) {
      addRoute('vision', 'Objective includes visual or screen-analysis signals.');
    }
    if (/\b(browser workflow|form|pdf|download|upload|tarayıcı görevi)\b/i.test(objective)) {
      addRoute('browser-workflow', 'Objective requires a structured browser workflow.');
    }
    if (/\b(proaktif|monitor|izle|bildirim|notification|presence)\b/i.test(objective)) {
      addRoute('proactive-monitoring', 'Objective involves proactive monitoring or notification behavior.');
    }
    if (/\b(3d|cad|blender|freecad|step|stl|render|simulation|fea|fem|cfd|robot|assembly)\b/i.test(objective)) {
      addRoute('design3d-orchestrator', 'Objective requires 3D design orchestration.');
    }
    if (/\b(meeting|toplantı|özet|summary|transcript|minutes)\b/i.test(objective)) {
      addRoute('meeting', 'Objective involves meeting summary or action-item knowledge capture.');
    }
    if (/\b(trading|trade|borsa|hisse|crypto|kripto|binance|coinbase|journal|günlük)\b/i.test(objective)) {
      addRoute('trading', 'Objective involves trading journal or finance guard routing.');
    }
    if (/\b(iot|akıllı ev|smart home|ışık|lamba|cihaz|finance|finans|trading|trade|borsa|hisse|crypto|kripto|forex|broker|order|whatsapp|wp|mesaj|bilgisayar|computer use)\b/i.test(objective)) {
      addRoute('sensitive-integration-guard', 'Objective touches IoT, finance, or trading sensitive integrations.');
    }
    if (task.riskLevel >= 3 || task.permissionsRequired.some((permission) => permission.includes(':control') || permission === 'system:exec' || permission === 'trading:execute')) {
      addRoute('security', 'High-risk permissions require security review.');
    }

    return routes.map((route) => ({
      ...route,
      matchedTools: unique(route.matchedTools),
      missingPermissions: unique(route.missingPermissions),
    }));
  }
}

export const agentRegistryService = new AgentRegistryService();
