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
    allowedTools: ['task_create', 'ai_skill_catalog'],
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
    allowedTools: ['ai_skill_catalog'],
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
    capabilities: ['web-research', 'source-review', 'summarization'],
    allowedTools: ['browser_search', 'browser_open', 'ai_skill_catalog'],
    requiredPermissions: ['network:read', 'system:read'],
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
    allowedTools: ['browser_use_agent', 'playwright_browser_agent', 'computer_control_agent', 'open_interpreter_agent'],
    requiredPermissions: ['network:read', 'browser:control', 'computer:control', 'system:exec'],
    inputSchema: { instruction: { type: 'string', required: true } },
    outputSchema: { artifact: { type: 'object' }, status: { type: 'string' } },
    timeoutMs: 120000,
    health: 'UNAVAILABLE',
    metrics: { ...DEFAULT_AGENT_METRICS },
  },
  {
    id: 'coding',
    name: 'Coding Agent',
    version: '0.1.0',
    responsibility: 'Handles code-oriented planning, local code assistance, and controlled interpreter handoffs.',
    capabilities: ['code-review', 'code-edit-planning', 'local-dev'],
    allowedTools: ['open_interpreter_agent', 'ai_skill_catalog'],
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
    allowedTools: [],
    requiredPermissions: ['system:read'],
    inputSchema: { image: { type: 'object' } },
    outputSchema: { observations: { type: 'array' } },
    timeoutMs: 60000,
    health: 'DEGRADED',
    metrics: { ...DEFAULT_AGENT_METRICS },
  },
  {
    id: 'security',
    name: 'Security Agent',
    version: '0.1.0',
    responsibility: 'Reviews high-risk plans, permissions, and external-action safety boundaries.',
    capabilities: ['risk-review', 'permission-review', 'policy-check'],
    allowedTools: ['ai_skill_catalog'],
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

    if (/\b(web|internet|araştır|haber|site|url|browser|tarayıcı)\b/i.test(objective)) {
      addRoute('research', 'Objective requires web or research capability.');
    }
    if (/\b(kod|code|script|typescript|python|bug|build|test)\b/i.test(objective)) {
      addRoute('coding', 'Objective appears code-oriented.');
    }
    if (/\b(görüntü|image|screen|ekran|vision|screenshot)\b/i.test(objective)) {
      addRoute('vision', 'Objective includes visual or screen-analysis signals.');
    }
    if (task.riskLevel >= 3 || task.permissionsRequired.some((permission) => permission.includes(':control') || permission === 'system:exec')) {
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
