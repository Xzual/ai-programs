import type { EdithPlan, EdithPlanStep, EdithRiskLevel, EdithTask } from './core';
import { agentRegistryService } from './agentRegistry';
import { getEdithToolHealth } from './serverRegistry';
import { taskService } from './taskService';

export interface PlanTaskResult {
  success: boolean;
  plan?: EdithPlan;
  task?: EdithTask;
  error?: string;
}

function planId(taskId: string): string {
  return `plan-${taskId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function stepId(index: number, slug: string): string {
  return `step-${index + 1}-${slug}`;
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
  if (/\b(skill|araç|tool|katalog|yetenek)\b/i.test(lower)) {
    tools.push('ai_skill_catalog');
  }

  return unique(tools);
}

function permissionsForTools(tools: string[]): string[] {
  const registry = new Map(getEdithToolHealth().map((health) => [health.toolId, health]));
  const permissions: string[] = [];

  for (const tool of tools) {
    const health = registry.get(tool);
    if (!health) continue;
    permissions.push(...health.missingPermissions);
    if (tool === 'system_monitor') permissions.push('system:read');
    if (tool === 'browser_search') permissions.push('network:read');
    if (tool === 'ai_skill_catalog') permissions.push('system:read');
  }

  return unique(permissions);
}

export class PlannerService {
  planTask(taskId: string): PlanTaskResult {
    const task = taskService.getTask(taskId);
    if (!task) return { success: false, error: 'Task not found.' };

    const plan = this.createPlan(task);
    const updatedTask = taskService.attachPlan(task.id, plan);
    return { success: true, plan, task: updatedTask };
  }

  createPlan(task: EdithTask): EdithPlan {
    const inferredTools = inferTools(`${task.objective} ${task.originalUserRequest}`);
    const requiredTools = unique([...task.toolsRequired, ...inferredTools]);
    const requiredPermissions = unique([...task.permissionsRequired, ...permissionsForTools(requiredTools)]);
    const requiredAgents = agentRegistryService.routeTask({
      ...task,
      toolsRequired: requiredTools,
      permissionsRequired: requiredPermissions,
    }).map((route) => route.agentId);
    const baseRisk = Math.max(task.riskLevel, requiredPermissions.some((permission) => permission.includes(':control')) ? 3 : 1) as EdithRiskLevel;
    const steps = this.createSteps(task, requiredTools, requiredPermissions, baseRisk);

    return {
      id: planId(task.id),
      taskId: task.id,
      objective: task.objective,
      createdAt: new Date().toISOString(),
      planner: 'heuristic-v1',
      status: steps.length > 0 ? 'READY' : 'INVALID',
      steps,
      requiredTools,
      requiredPermissions,
      requiredAgents,
      validationCriteria: unique([
        ...task.validationRules,
        'All planned steps have completed or been explicitly skipped.',
        'Task result addresses the original objective.',
        'Audit events exist for tool-backed execution.',
      ]),
      stopConditions: [
        'Stop when validation criteria pass.',
        'Stop when max retries are exhausted.',
        'Stop when a required permission is denied.',
        'Stop when task timeout is reached.',
      ],
      maxIterations: 8,
      maxRetries: 2,
      maxToolCalls: Math.max(3, requiredTools.length * 2),
      taskTimeoutMs: 10 * 60 * 1000,
    };
  }

  private createSteps(
    task: EdithTask,
    requiredTools: string[],
    requiredPermissions: string[],
    riskLevel: EdithRiskLevel
  ): EdithPlanStep[] {
    const steps: EdithPlanStep[] = [
      {
        id: stepId(0, 'context'),
        title: 'Gather context',
        objective: `Review objective and known task context for: ${task.objective}`,
        status: 'READY',
        dependsOn: [],
        suggestedTools: [],
        requiredPermissions: [],
        validationCriteria: ['Objective and constraints are understood.'],
        riskLevel: 0,
      },
    ];

    if (requiredTools.length > 0) {
      steps.push({
        id: stepId(1, 'tools'),
        title: 'Run selected tools',
        objective: 'Execute selected low-risk tools and store observations.',
        status: 'PENDING',
        dependsOn: [steps[0].id],
        suggestedTools: requiredTools,
        requiredPermissions,
        validationCriteria: requiredTools.map((tool) => `Tool ${tool} returns a normalized result.`),
        riskLevel,
        parallelGroup: requiredTools.length > 1 ? 'tool-discovery' : undefined,
      });
    }

    steps.push({
      id: stepId(steps.length, 'verify'),
      title: 'Verify result',
      objective: 'Check whether the task objective has been satisfied before completion.',
      status: 'PENDING',
      dependsOn: [steps[steps.length - 1].id],
      suggestedTools: [],
      requiredPermissions: [],
      validationCriteria: [
        'Result is non-empty.',
        'Result explicitly addresses the original user request.',
        'Failure reason is recorded if objective cannot be completed.',
      ],
      riskLevel: 0,
    });

    return steps;
  }
}

export const plannerService = new PlannerService();
