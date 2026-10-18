import type { EdithPlan, EdithPlanStep, EdithRiskLevel, EdithTask, EdithReaPlannedCall } from './core';
import {randomUUID} from 'node:crypto';
import {parseReaPlannedCall} from './reaIntegrationContract';
import { capabilityService } from './capabilityService';
import { contextService } from './contextService';
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
  if (/\b(web|internet|araştır|site|url|tarayıcı|browser)\b/i.test(lower)) {
    tools.push('browser_search');
  }
  if (/(haber|news|gündem|daily news|son dakika)/i.test(lower)) {
    tools.push('brave_news_search');
  }
  if (/\b(ekran|screen|screenshot|görüntü|ocr|pdf|pencere|uygulama|bildirim)\b/i.test(lower)) {
    tools.push('vision_observe');
  }
  if (/\b(tarayıcı görevi|browser workflow|form|upload|download|pdf indir|siteyi aç)\b/i.test(lower)) {
    tools.push('browser_workflow');
  }
  if (/\b(skill|araç|tool|katalog|yetenek)\b/i.test(lower)) {
    tools.push('ai_skill_catalog');
  }
  if (/\b(mark-l|mark l|markl|adapter|capability|yetenek sağlayıcı)\b/i.test(lower)) {
    tools.push('mark_l_capabilities');
  }
  if (/\b(kontrol|control|masaüstü|desktop|ekranı yönet|bilgisayarı yönet|computer use)\b/i.test(lower)) {
    tools.push('computer_control_agent', 'computer_use_guard');
  }
  if (/\b(tıkla|click|yaz|hotkey|uygulama aç|notepad|masaüstü kontrol)\b/i.test(lower)) {
    tools.push('computer_action');
  }
  if (/\b(3d|cad|blender|freecad|step|stl|render|simulation|fea|fem|cfd|assembly)\b/i.test(lower)) {
    tools.push('design3d_cad_foundation', 'design3d_render_foundation', 'design3d_simulation_foundation');
  }
  if (/\b(iot|akıllı ev|smart home|ışık|lamba|cihaz|device feedback)\b/i.test(lower)) {
    tools.push('iot_feedback_stub');
  }
  if (/(binance|btc|eth|usdt|crypto|kripto)/i.test(lower)) {
    tools.push('binance_market_price', 'binance_market_24hr');
  }
  if (/(coinbase)/i.test(lower)) {
    tools.push('coinbase_ticker_lookup');
  }
  if (/\b(finans|finance|trading|trade|borsa|hisse|forex|order|broker|alpaca|ibkr)\b/i.test(lower)) {
    tools.push('finance_trading_guard', 'binance_trade_signal_guard');
  }
  if (/(whatsapp|wp|mesaj|message|webhook)/i.test(lower)) {
    tools.push('whatsapp_observe_health', 'whatsapp_integrate_guard');
  }

  return unique(tools);
}

export class PlannerService {
  /** Finite canonical REA plan. No objective inference or unrelated discovery tools. */
  createReaPlan(task:EdithTask,existing?:EdithPlan,call?:EdithReaPlannedCall):EdithPlan {
    if(existing&&(existing.taskId!==task.id||existing.steps.length!==1||existing.requiredTools.join(',')!=='rea_analysis'))throw Error('REA_PLAN_MISMATCH');
    const captured=call===undefined?undefined:parseReaPlannedCall(call);
    return {id:existing?.id??'rea_plan_'+randomUUID(),taskId:task.id,objective:'Inspect the explicitly selected artifact',
      createdAt:existing?.createdAt??new Date().toISOString(),planner:'heuristic-v1',status:captured?'READY':'DRAFT',
      steps:[{id:existing?.steps[0].id??'rea_step_'+randomUUID(),title:'Analyze selected artifact',objective:'Retain validated scoped REA evidence',
        status:'READY',dependsOn:[],suggestedTools:['rea_analysis'],requiredPermissions:['file:read','rea:analyze'],validationCriteria:['Original branded report and persisted receipt match canonical execution.'],riskLevel:4,
        ...(captured?{reaCall:captured}:{})}],requiredTools:['rea_analysis'],requiredPermissions:['file:read','rea:analyze'],requiredAgents:[],
      validationCriteria:['Actual outcome and cleanup govern completion.'],stopConditions:['Authority changed','Unknown effect','Unqualified runtime'],
      maxIterations:1,maxRetries:0,maxToolCalls:1,taskTimeoutMs:120000};
  }
  planTask(taskId: string): PlanTaskResult {
    const task = taskService.getTask(taskId);
    if (!task) return { success: false, error: 'Task not found.' };

    const plan = this.createPlan(task);
    const updatedTask = taskService.attachPlan(task.id, plan);
    return { success: true, plan, task: updatedTask };
  }

  createPlan(task: EdithTask): EdithPlan {
    if(task.toolsRequired.includes('rea_analysis')||task.plan?.steps.some(s=>s.reaCall))throw Error('REA_CANONICAL_BRIDGE_REQUIRED');
    const contextSnapshot = contextService.build({
      query: `${task.objective} ${task.originalUserRequest}`,
      taskId: task.id,
      actor: 'edith-planner',
    });
    const inferredTools = inferTools(`${task.objective} ${task.originalUserRequest}`);
    const requiredTools = unique([...task.toolsRequired, ...inferredTools]);
    const capabilityAssessment = capabilityService.assess({
      objective: task.objective,
      actor: 'edith-planner',
      toolsRequired: requiredTools,
      permissionsRequired: task.permissionsRequired,
      riskLevel: task.riskLevel,
    });
    const requiredPermissions = unique([
      ...task.permissionsRequired,
      ...capabilityAssessment.toolDecisions.flatMap((decision) => decision.requiredPermissions),
    ]);
    const requiredAgents = capabilityAssessment.agentRoutes.map((route) => route.agentId);
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
      contextSnapshot,
      validationCriteria: unique([
        ...task.validationRules,
        `Context snapshot ${contextSnapshot.id} was built before planning.`,
        `Capability assessment ${capabilityAssessment.id} produced ${capabilityAssessment.status}.`,
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
        objective: `Review objective, memory references, related tasks, tools, and audit context for: ${task.objective}`,
        status: 'READY',
        dependsOn: [],
        suggestedTools: [],
        requiredPermissions: [],
        validationCriteria: [
          'Objective and constraints are understood.',
          'Relevant safe memory and operational context has been selected.',
        ],
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
