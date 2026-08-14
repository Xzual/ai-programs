import { appendAuditEvent, createAuditEvent } from './audit';
import type { EdithAgentRoute, EdithRiskLevel, EdithToolMetadata } from './core';
import { agentRegistryService } from './agentRegistry';
import { edithToolRegistry, getEdithToolHealth, type EdithToolHealth, type EdithToolHealthState } from './serverRegistry';
import { permissionService, type EdithPermissionDecision } from './permissionService';

export interface CapabilityToolDecision {
  toolId: string;
  name: string;
  category: EdithToolMetadata['category'];
  health: EdithToolHealthState;
  enabled: boolean;
  highRisk: boolean;
  riskLevel: EdithRiskLevel;
  requiredPermissions: string[];
  missingPermissions: string[];
  activeGrantIds: string[];
  dependencies: string[];
  runnable: boolean;
  rationale: string;
}

export interface CapabilityAssessmentInput {
  objective: string;
  actor?: string;
  toolsRequired?: string[];
  permissionsRequired?: string[];
  riskLevel?: EdithRiskLevel;
}

export interface CapabilityAssessment {
  id: string;
  objective: string;
  actor: string;
  createdAt: string;
  status: 'READY' | 'WAITING_PERMISSION' | 'DEGRADED' | 'NO_MATCH';
  summary: string;
  requestedTools: string[];
  runnableTools: string[];
  blockedTools: string[];
  missingPermissions: string[];
  highRiskBlockedTools: string[];
  toolDecisions: CapabilityToolDecision[];
  agentRoutes: EdithAgentRoute[];
}

function assessmentId(): string {
  return `cap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function inferTools(objective: string): string[] {
  const lower = objective.toLocaleLowerCase('tr-TR');
  const tools: string[] = [];

  if (/\b(sistem|cpu|ram|bellek|performans|health|durum|rapor)\b/i.test(lower)) {
    tools.push('system_monitor');
  }
  if (/\b(web|internet|araştır|haber|site|url|tarayıcı|browser)\b/i.test(lower)) {
    tools.push('browser_search');
  }
  if (/\b(skill|araç|tool|katalog|yetenek|capability)\b/i.test(lower)) {
    tools.push('ai_skill_catalog');
  }
  if (/\b(mark-l|mark l|markl|adapter|yetenek sağlayıcı)\b/i.test(lower)) {
    tools.push('mark_l_capabilities');
  }
  if (/\b(kontrol|control|masaüstü|desktop|ekranı yönet|bilgisayarı yönet)\b/i.test(lower)) {
    tools.push('computer_control_agent');
  }

  return unique(tools);
}

function statusFor(params: {
  decisions: CapabilityToolDecision[];
  agentRoutes: EdithAgentRoute[];
  missingPermissions: string[];
}): CapabilityAssessment['status'] {
  if (params.decisions.length === 0 && params.agentRoutes.length === 0) return 'NO_MATCH';
  if (params.missingPermissions.length > 0) return 'WAITING_PERMISSION';
  if (params.decisions.some((decision) => decision.health === 'DEGRADED')) return 'DEGRADED';
  return 'READY';
}

export class CapabilityService {
  assess(input: CapabilityAssessmentInput): CapabilityAssessment {
    const objective = input.objective.trim();
    if (!objective) throw new Error('objective is required for capability assessment.');

    const actor = input.actor?.trim() || 'edith-capability-service';
    const requestedTools = unique([...(input.toolsRequired ?? []), ...inferTools(objective)]);
    const toolDecisions = requestedTools.flatMap((toolId) => {
      const decision = this.assessTool(toolId, actor);
      return decision ? [decision] : [];
    });
    const missingPermissions = unique([
      ...(input.permissionsRequired ?? []),
      ...toolDecisions.flatMap((decision) => decision.missingPermissions),
    ]);
    const agentRoutes = agentRegistryService.routeTask({
      objective,
      riskLevel: input.riskLevel ?? this.maxRisk(toolDecisions),
      toolsRequired: requestedTools,
      permissionsRequired: unique([...(input.permissionsRequired ?? []), ...toolDecisions.flatMap((decision) => decision.requiredPermissions)]),
    });
    const highRiskBlockedTools = toolDecisions
      .filter((decision) => decision.highRisk && !decision.runnable)
      .map((decision) => decision.toolId);
    const assessment: CapabilityAssessment = {
      id: assessmentId(),
      objective,
      actor,
      createdAt: new Date().toISOString(),
      status: statusFor({ decisions: toolDecisions, agentRoutes, missingPermissions }),
      summary: '',
      requestedTools,
      runnableTools: toolDecisions.filter((decision) => decision.runnable).map((decision) => decision.toolId),
      blockedTools: toolDecisions.filter((decision) => !decision.runnable).map((decision) => decision.toolId),
      missingPermissions,
      highRiskBlockedTools,
      toolDecisions,
      agentRoutes,
    };
    assessment.summary = this.summarize(assessment);
    this.audit(assessment);
    return assessment;
  }

  assessTool(toolId: string, actor = 'edith-capability-service'): CapabilityToolDecision | undefined {
    const tool = edithToolRegistry.get(toolId);
    if (!tool) return undefined;
    const health = getEdithToolHealth().find((candidate) => candidate.toolId === toolId) ?? this.syntheticHealth(toolId);
    const permissionDecision = permissionService.decideToolExecution({ tool, actor });
    return this.toToolDecision(tool.id, tool.metadata, health, permissionDecision);
  }

  private toToolDecision(
    toolId: string,
    metadata: EdithToolMetadata,
    health: EdithToolHealth,
    permissionDecision: EdithPermissionDecision
  ): CapabilityToolDecision {
    const permissionAllowed = permissionDecision.status === 'ALLOW';
    const effectiveHealth: EdithToolHealthState = permissionAllowed && !health.enabled
      ? metadata.dependencies.length > 0
        ? 'DEGRADED'
        : 'HEALTHY'
      : health.state;
    const runnable = permissionAllowed;
    return {
      toolId,
      name: metadata.name,
      category: metadata.category,
      health: effectiveHealth,
      enabled: permissionAllowed,
      highRisk: permissionDecision.highRisk,
      riskLevel: metadata.riskLevel,
      requiredPermissions: permissionDecision.requiredPermissions,
      missingPermissions: permissionDecision.missingPermissions,
      activeGrantIds: permissionDecision.activeGrantIds,
      dependencies: health.dependencies,
      runnable,
      rationale: runnable
        ? `Tool ${toolId} is authorized for ${permissionDecision.actor}; dependency health is ${effectiveHealth}.`
        : permissionDecision.rationale,
    };
  }

  private maxRisk(decisions: CapabilityToolDecision[]): EdithRiskLevel {
    return Math.max(0, ...decisions.map((decision) => decision.riskLevel)) as EdithRiskLevel;
  }

  private syntheticHealth(toolId: string): EdithToolHealth {
    return {
      toolId,
      state: 'UNAVAILABLE',
      enabled: false,
      highRisk: false,
      missingPermissions: [],
      dependencies: [],
      message: `Tool is not registered: ${toolId}`,
    };
  }

  private summarize(assessment: CapabilityAssessment): string {
    return [
      `Capability assessment ${assessment.id} is ${assessment.status}.`,
      `Runnable tools: ${assessment.runnableTools.length ? assessment.runnableTools.join(', ') : 'none'}.`,
      assessment.blockedTools.length ? `Blocked tools: ${assessment.blockedTools.join(', ')}.` : '',
      assessment.missingPermissions.length ? `Missing permissions: ${assessment.missingPermissions.join(', ')}.` : '',
      `Agent routes: ${assessment.agentRoutes.map((route) => route.agentId).join(', ') || 'none'}.`,
    ].filter(Boolean).join(' ');
  }

  private audit(assessment: CapabilityAssessment): void {
    appendAuditEvent(createAuditEvent({
      actor: assessment.actor,
      action: 'capability.assess',
      toolId: 'capability_service',
      authorization: assessment.status === 'WAITING_PERMISSION' ? 'denied' : 'allowed',
      riskLevel: this.maxRisk(assessment.toolDecisions),
      result: assessment.status === 'WAITING_PERMISSION' ? 'denied' : 'success',
      message: assessment.summary.slice(0, 500),
    }));
  }
}

export const capabilityService = new CapabilityService();
