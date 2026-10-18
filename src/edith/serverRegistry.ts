import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import {
  EdithPermissionError,
  EdithToolTimeoutError,
  EdithToolValidationError,
  EdithToolRegistry,
  type EdithToolRisk,
  type EdithToolExecutionContext,
  type EdithToolResult,
} from './core';
import { appendAuditEvent, createAuditEvent } from './audit';
import { listExternalSkillProjects } from './skills/catalog';
import { createStoredTask } from './taskStore';
import { getEdithPersistenceStore } from './persistence';
import { markLAdapterService } from './markLAdapter';
import { KillSwitchActiveError, killSwitchService } from './killSwitch';
import { DEFAULT_LOCAL_PERMISSIONS, HIGH_RISK_PERMISSIONS, permissionService } from './permissionService';
import { visionObservationService } from './visionService';
import { computerActionService } from './computerActionService';
import { browserWorkflowService } from './browserWorkflowService';
import { BROWSER_TOOL_POLICY, BROWSER_TOOL_IDS, BROWSER_ACTIONS, type BrowserToolId } from './browserOperatorContract';
import { normalizeRegisteredBrowserArgs } from '../../server/browser/browserRegisteredArgs';
import { ownerSessionBindingActive } from '../../server/security/ownerSession';
import { sensitiveIntegrationService } from './sensitiveIntegrationService';
import { registerAwesomeAgentSkillTools } from './awesomeAgentSkills';
import { redactSensitiveString, sanitizeSensitiveValue } from './securityRedaction';
import { isReaSafeReport, type ReaSafeReport } from './reaAnalysisService';
import type { ReaProfile } from './reaContract';
import type { ReaIntegrationService, ReaIntegrationStatus } from './reaIntegrationService';
import { parseReaExecutionReceipt, parseReaPlannedCall, reaProjectionDigest } from './reaIntegrationContract';
import type { ReaExecutionCapabilityV1, ReaExecutionReceiptV1, ReaReceiptCorrelationV1, ReaSafeResultProjectionV1,
  ReaSafeTechnicalFactV1, ReaSafeStructuralRelationshipV1, ReaSafeTechnicalOmissionV1 } from './reaIntegrationContract';
import { createReaReceiptObservedMetrics } from './reaTools';

export const edithToolRegistry = new EdithToolRegistry();

export interface ReaReceiptLocator {
  toolRunId: string; auditEventId: string; finishedAt: string; receiptObservedAt: string; receiptDigest: string;
}
export interface ReaRegistryExecution {
  assertCurrent(cap: ReaExecutionCapabilityV1): void;
  revoke(cap: ReaExecutionCapabilityV1): void;
  status(profile: ReaProfile): ReaIntegrationStatus;
  execute(cap: ReaExecutionCapabilityV1): Promise<{ toolResult: EdithToolResult; receipt: ReaExecutionReceiptV1 }>;
}
const reaPorts = new WeakSet<object>();
let boundReaPort: ReaRegistryExecution | undefined;
export function bindReaRegistryExecution(port: ReaRegistryExecution): void {
  if (!reaPorts.has(port) || boundReaPort) throw new Error('REA_REGISTRY_BINDING_INVALID');
  boundReaPort = port;
}
export function readReaRegistryStatus(profile: ReaProfile): ReaIntegrationStatus {
  return boundReaPort?.status(profile) ?? { schemaVersion: 1, runtimeReady: false, outcome: 'configuration_required',
    reasons: [{ kind: 'missing_code', code: 'REA_REGISTRY_NOT_BOUND' }] };
}
const reaDirectDenied = (): EdithToolResult => ({ success: false, toolId: 'rea_analysis',
  errorCode: 'PERMISSION_DENIED', error: 'REA_PRIVATE_CAPABILITY_REQUIRED' });

/** This port alone owns receipt production. Public tool arguments cannot carry its capability. */
export function createReaRegistryExecution(deps: {
  integration: ReaIntegrationService;
  bindReceipt(cap: ReaExecutionCapabilityV1, locator: ReaReceiptLocator): void;
  readExpected(taskId: string, auditEventId: string): ReaReceiptCorrelationV1 | undefined;
}): ReaRegistryExecution {
  const winners = new WeakMap<object, Promise<{ toolResult: EdithToolResult; receipt: ReaExecutionReceiptV1 }>>();
  const guard = (cap: ReaExecutionCapabilityV1) => deps.integration.assertCapability(cap);
  async function produce(cap: ReaExecutionCapabilityV1) {
    guard(cap);
    const binding = deps.integration.readCapabilityBinding(cap);
    const call = parseReaPlannedCall(cap.call);
    if (reaProjectionDigest(call) !== binding.inputDigest
      || reaProjectionDigest(call) !== reaProjectionDigest(binding.call)) throw new Error('REA_CANONICAL_PLAN_MISMATCH');
    const store = getEdithPersistenceStore();
    if (!store.recordToolRun || !store.listToolRuns) throw new Error('REA_RECEIPT_STORE_UNAVAILABLE');
    guard(cap);
    const toolRunId = normalizeToolRunId('rea_analysis');
    const result = await deps.integration.consume(cap);
    const finishedAt = new Date().toISOString();
    guard(cap);
    const receiptObservedAt = new Date().toISOString();
    const successful = result.outcome === 'completed' && result.cleanup.closed && !result.cleanup.unknownEffect;
    const audit = createAuditEvent({ actor: 'rea-canonical-task', taskId: binding.identity.taskId, toolId: 'rea_analysis',
      action: 'tool.execute', authorization: 'allowed', riskLevel: 4, result: successful ? 'success' : 'error',
      message: 'REA_CANONICAL_RECEIPT' });
    const correlation: ReaReceiptCorrelationV1 = { identity: binding.identity, toolRunId, auditEventId: audit.id,
      selectionRef: binding.selection.selectionRef, selectionRevision: binding.selection.revision, inputDigest: binding.inputDigest };
    const report = result.report;
    if (report && !isReaSafeReport(report)) throw new Error('REA_REPORT_UNTRUSTED');
    if (report && report.profile !== call.args.profile) throw new Error('REA_REPORT_PROFILE_MISMATCH');
    const evidenceIndex = report ? report.evidenceRefs.map((originalEvidenceId, i) => ({ ref: `evidence_${i + 1}`, originalEvidenceId })) : [];
    const envelope = { schemaVersion: 1 as const, toolId: 'rea_analysis' as const, ...correlation,
      finishedAt, receiptObservedAt, outcome: result.outcome, reasonCode: result.reasonCode, cleanup: result.cleanup, evidenceIndex };
    let projected: ReaSafeResultProjectionV1 | undefined;
    if (report) {
      projected = projectReaReceiptReport(report, candidate => parseReaExecutionReceipt({ ...envelope,
        report: candidate, reportDigest: reaProjectionDigest(candidate) }, correlation).report! , evidenceIndex);
    }
    if (result.outcome === 'completed' && projected
      && !projected.technicalFacts?.length && !projected.structuralRelationships?.length) {
      throw new Error('REA_SAFE_TECHNICAL_CONTENT_REQUIRED');
    }
    const observedMetrics = report ? createReaReceiptObservedMetrics(report, {
      attempt: binding.identity.attempt, stepId: binding.identity.stepId, targetRefId: binding.selection.selectionRef,
      finishedAt, receiptObservedAt, evidenceIndex, assertCurrent: () => guard(cap),
    }) : undefined;
    const receipt = parseReaExecutionReceipt({ ...envelope,
      ...(projected ? { report: projected, reportDigest: reaProjectionDigest(projected) } : {}),
      ...(observedMetrics ? { observedMetrics } : {}),
    }, correlation);
    guard(cap);
    const receiptDigest = reaProjectionDigest(receipt);
    deps.bindReceipt(cap, { toolRunId, auditEventId: audit.id, finishedAt, receiptObservedAt, receiptDigest });
    guard(cap);
    const expected = deps.readExpected(binding.identity.taskId, audit.id);
    if (!expected) throw new Error('REA_RECEIPT_CROSSWALK_REQUIRED');
    parseReaExecutionReceipt(receipt, expected);
    guard(cap);
    store.recordToolRun({ id: toolRunId, toolId: 'rea_analysis', toolName: 'REA analysis',
      args: { schemaVersion: 1, toolId: 'rea_analysis' }, result: JSON.stringify(receipt),
      timestamp: Date.parse(finishedAt), status: successful ? 'success' : 'error' });
    guard(cap);
    appendAuditEvent(audit);
    guard(cap);
    const toolResult: EdithToolResult = { success: successful, toolId: 'rea_analysis', toolRunId, auditEventId: audit.id,
      finishedAt, result: result.outcome + ': ' + receipt.reasonCode,
      structuredOutput: { outcome: result.outcome, reasonCode: receipt.reasonCode,
        locator: { toolRunId, auditEventId: audit.id, finishedAt, receiptObservedAt, receiptDigest } },
      ...(successful ? {} : { errorCode: 'TOOL_ERROR' as const }) };
    return Object.freeze({ toolResult, receipt });
  }
  const port: ReaRegistryExecution = Object.freeze({ assertCurrent: guard,
    revoke: (cap: ReaExecutionCapabilityV1) => deps.integration.revokeCapability(cap),
    status: (profile: ReaProfile) => deps.integration.status(profile),
    execute(cap: ReaExecutionCapabilityV1) {
      // Admission is checked before consulting cached receipts, including replays.
      try { guard(cap); } catch (error) { return Promise.reject(error); }
      let promise = winners.get(cap);
      if (!promise) { promise = Promise.resolve().then(() => produce(cap)); winners.set(cap, promise); }
      return promise.then(value => { guard(cap); return value; });
    },
  });
  reaPorts.add(port);
  return port;
}

function projectReaReceiptReport(report: ReaSafeReport,
  validate: (candidate: ReaSafeResultProjectionV1) => ReaSafeResultProjectionV1,
  index: readonly { ref: string; originalEvidenceId: string }[]): ReaSafeResultProjectionV1 {
  if (!isReaSafeReport(report)) throw new Error('REA_REPORT_UNTRUSTED');
  const refs = new Map(index.map(row => [row.originalEvidenceId, row.ref]));
  const base: ReaSafeResultProjectionV1 = { profile: report.profile, sourceProjectionDigest: report.projectionDigest,
    coverage: 'unverified', summary: 'Selected evidence only; whole-target coverage unverified.',
    spokenSummary: 'Selected evidence only. Coverage unverified.', knowledgeMarkdown: 'Selected evidence only; coverage unverified.' };
  const facts: ReaSafeTechnicalFactV1[] = [], relationships: ReaSafeStructuralRelationshipV1[] = [];
  const omissions = new Set<ReaSafeTechnicalOmissionV1>();
  for (const fact of report.technicalFacts) {
    const candidate = { key: fact.key, label: fact.label, value: fact.value, scope: fact.scope,
      confidence: fact.confidence, limitation: fact.limitation,
      provenance: { evidenceRef: refs.get(fact.provenance.evidenceId)!, originalEvidenceId: fact.provenance.evidenceId,
        validatedJSONPointer: fact.provenance.validatedJSONPointer, observedAt: fact.provenance.observedAt,
        producerVersion: fact.provenance.producerVersion as 'rea-agents@6.5.0' } };
    try { facts.push(validate({ ...base, technicalFacts: [candidate] }).technicalFacts![0]); }
    catch { omissions.add(typeof fact.value === 'string' ? 'source_fact_omitted_unsafe_text' : 'source_fact_omitted_unsupported_value'); }
  }
  for (const row of report.relationships) {
    const candidate = { id: row.id, sourceId: row.sourceId, targetId: row.targetId, relation: row.relation,
      scope: 'producer-returned' as const, confidence: row.confidence, limitation: row.limitation,
      provenance: { evidenceRef: refs.get(row.evidenceId)!, originalEvidenceId: row.evidenceId, validatedJSONPointer: row.jsonPointer } };
    try { relationships.push(validate({ ...base, structuralRelationships: [candidate] }).structuralRelationships![0]); }
    catch { omissions.add('source_relationship_omitted_unsafe_text'); }
  }
  const excerpt = facts.slice(0, 3).map(fact => `${fact.label}: ${fact.value}`).join('; ');
  return validate({ ...base, summary: excerpt ? `${excerpt}. Whole-target coverage remains unverified.` : base.summary,
    spokenSummary: facts.length ? `${facts[0].label}: ${facts[0].value}. Selected evidence only.` : base.spokenSummary,
    knowledgeMarkdown: ['# REA selected evidence', base.summary,
      ...facts.map(fact => `${fact.label}: ${fact.value}. ${fact.limitation} Evidence: ${fact.provenance.evidenceRef} ${fact.provenance.validatedJSONPointer}`),
      ...relationships.map(row => `${row.sourceId} ${row.relation} ${row.targetId}. ${row.limitation}`),
      ...omissions].join('\n\n'), technicalFacts: facts, structuralRelationships: relationships, technicalLimitations: [...omissions] });
}

edithToolRegistry.register({ id: 'rea_analysis', metadata: {
  name: 'REA analysis', version: '1.0.0', description: 'Private canonical task capability only; runtime qualification required.',
  category: 'code', inputSchema: {
    schemaVersion: { type: 'number', required: true }, selectionRef: { type: 'string', required: true },
    profile: { type: 'string', required: true }, objective: { type: 'string', required: true },
    profileOptions: { type: 'object' }, featureQuery: { type: 'object' },
  }, outputSchema: {}, requiredPermissions: ['rea:analyze'], riskLevel: 4,
  timeoutMs: 120000, retryLimit: 0, supportsDryRun: false, supportsRollback: false,
  platforms: ['win32', 'darwin', 'linux'], dependencies: ['rea-agents@6.5.0', 'canonical-task-authority', 'qualified-profile'],
}, handler: reaDirectDenied });

export { DEFAULT_LOCAL_PERMISSIONS, HIGH_RISK_PERMISSIONS };

export type EdithToolHealthState = 'HEALTHY' | 'DEGRADED' | 'UNAVAILABLE';

export interface EdithToolHealth {
  toolId: string;
  state: EdithToolHealthState;
  enabled: boolean;
  highRisk: boolean;
  risk: EdithToolRisk;
  riskLevel: number;
  missingPermissions: string[];
  dependencies: string[];
  message: string;
}

export interface EdithToolRegistrySnapshot {
  schemaVersion: 1;
  authority: 'edithToolRegistry';
  checkedAt: string;
  tools: ReturnType<EdithToolRegistry['list']>;
  health: EdithToolHealth[];
  counts: {
    total: number;
    enabled: number;
    blocked: number;
    approvalRequired: number;
    byRisk: Record<EdithToolRisk, number>;
    byState: Record<EdithToolHealthState, number>;
  };
}

function normalizeToolRunId(toolId: string): string {
  return `toolrun-${toolId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function recordToolRun(params: {
  id: string;
  toolId: string;
  toolName: string;
  args: Record<string, unknown>;
  result: string;
  timestamp: number;
  status: 'success' | 'error' | 'denied';
}): void {
  if ((BROWSER_TOOL_IDS as readonly string[]).includes(params.toolId)) {
    const action = typeof params.args.action === 'string' && (BROWSER_ACTIONS as readonly string[]).includes(params.args.action) ? params.args.action : 'unknown';
    getEdithPersistenceStore().recordToolRun?.({ ...params,
      args: { schema: 'edith.browser.operator', action },
      result: JSON.stringify({ schema: 'edith.browser.operator', status: params.status }),
    });
    return;
  }
  getEdithPersistenceStore().recordToolRun?.({
    ...params,
    args: sanitizeSensitiveValue(params.args),
    result: redactSensitiveString(params.result),
  });
}

function safeResultText(result: EdithToolResult): string {
  return redactSensitiveString(
    result.error ?? result.result ?? JSON.stringify(sanitizeSensitiveValue(result.structuredOutput ?? {})),
  ).slice(0, 4000);
}

export function riskLabelForLevel(level: number): EdithToolRisk {
  if (level <= 0) return 'READ';
  if (level <= 1) return 'LOW';
  if (level <= 2) return 'MEDIUM';
  if (level <= 4) return 'HIGH';
  return 'CRITICAL';
}

export function getEdithToolHealth(): EdithToolHealth[] {
  return edithToolRegistry.list().map(({ id, metadata }) => {
    if (id === 'rea_analysis') {
      const status = readReaRegistryStatus('static-managed');
      return { toolId: id, state: status.runtimeReady ? 'DEGRADED' : 'UNAVAILABLE', enabled: false,
        highRisk: true, risk: 'HIGH', riskLevel: metadata.riskLevel, missingPermissions: [],
        dependencies: metadata.dependencies, message: status.runtimeReady === false
          ? status.reasons.map(reason => reason.code).join(', ')
          : 'REA_PRIVATE_CAPABILITY_REQUIRED; readiness applies only to the qualified selected profile.' } as EdithToolHealth;
    }
    const registeredTool = edithToolRegistry.get(id);
    const decision = registeredTool
      ? permissionService.decideToolExecution({ tool: registeredTool, actor: 'edith-tool-health' })
      : undefined;
    const missingPermissions = decision?.missingPermissions ?? metadata.requiredPermissions;
    const highRisk = decision?.highRisk ?? permissionService.isHighRisk({ metadata });
    const enabled = missingPermissions.length === 0;
    const state: EdithToolHealthState = enabled
      ? metadata.dependencies.length > 0
        ? 'DEGRADED'
        : 'HEALTHY'
      : 'UNAVAILABLE';
    const message = enabled
      ? metadata.dependencies.length > 0
        ? `Tool is enabled but depends on: ${metadata.dependencies.join(', ')}`
        : 'Tool is enabled and has no declared external dependencies.'
      : `Tool is blocked by missing permissions: ${missingPermissions.join(', ')}`;

    return {
      toolId: id,
      state,
      enabled,
      highRisk,
      risk: riskLabelForLevel(metadata.riskLevel),
      riskLevel: metadata.riskLevel,
      missingPermissions,
      dependencies: metadata.dependencies,
      message,
    };
  });
}

export function getEdithToolRegistrySnapshot(): EdithToolRegistrySnapshot {
  const tools = edithToolRegistry.list();
  const health = getEdithToolHealth();
  const byRisk: Record<EdithToolRisk, number> = { READ: 0, LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
  const byState: Record<EdithToolHealthState, number> = { HEALTHY: 0, DEGRADED: 0, UNAVAILABLE: 0 };
  for (const item of health) {
    byRisk[item.risk] += 1;
    byState[item.state] += 1;
  }
  return {
    schemaVersion: 1,
    authority: 'edithToolRegistry',
    checkedAt: new Date().toISOString(),
    tools,
    health,
    counts: {
      total: tools.length,
      enabled: health.filter((item) => item.enabled).length,
      blocked: health.filter((item) => !item.enabled).length,
      approvalRequired: health.filter((item) => item.highRisk).length,
      byRisk,
      byState,
    },
  };
}

function getStringArg(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' ? value.trim() : undefined;
}

function normalizeHttpUrl(rawUrl: string): string {
  const withProtocol = /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
  const parsed = new URL(withProtocol);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`Only http/https URLs are allowed: ${rawUrl}`);
  }
  return parsed.toString();
}

function openUrl(url: string): void {
  const platform = os.platform();
  if (platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', url], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    }).unref();
    return;
  }

  const command = platform === 'darwin' ? 'open' : 'xdg-open';
  spawn(command, [url], {
    detached: true,
    stdio: 'ignore',
  }).unref();
}

function highRiskUnavailable(toolId: string, context: EdithToolExecutionContext): EdithToolResult | null {
  if (permissionService.highRiskEnabled()) return null;
  const tool = edithToolRegistry.get(toolId);
  if (tool) {
    const decision = permissionService.decideToolExecution({
      tool,
      actor: context.actor,
      authorizedPermissions: context.authorizedPermissions,
    });
    if (decision.status === 'ALLOW') return null;
  }
  return {
    success: false,
    toolId,
    error:
      'AUTHORIZATION_REQUIRED: High-risk tools are installed but disabled. Start the server with EDITH_ENABLE_HIGH_RISK_TOOLS=true after reviewing the requested action.',
    structuredOutput: {
      capability: 'AUTHORIZATION_REQUIRED',
      requiredEnv: 'EDITH_ENABLE_HIGH_RISK_TOOLS=true',
    },
  };
}

function runPythonModule(moduleName: string, args: string[]): Promise<EdithToolResult> {
  return new Promise((resolve) => {
    const child = spawn('python', ['-m', moduleName, ...args], {
      cwd: process.cwd(),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      resolve({
        success: false,
        toolId: moduleName,
        error: `Timed out while running ${moduleName}.`,
        structuredOutput: { timeout: true },
      });
    }, 120000);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        success: code === 0,
        toolId: moduleName,
        result: (stdout || stderr || `Process exited with code ${code}`).slice(0, 8000),
        error: code === 0 ? undefined : (stderr || stdout || `Process exited with code ${code}`).slice(0, 4000),
        structuredOutput: { exitCode: code },
      });
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({
        success: false,
        toolId: moduleName,
        error: error.message,
        structuredOutput: { capability: 'CONFIGURATION_REQUIRED' },
      });
    });
  });
}

function markLAdapterRequired(toolId: string): EdithToolResult {
  return {
    success: false,
    toolId,
    errorCode: 'TOOL_ERROR',
    error: 'CONFIGURATION_REQUIRED: A sandboxed Mark-L adapter is not configured.',
    structuredOutput: {
      capability: 'CONFIGURATION_REQUIRED',
      executionEnabled: false,
      adapterOnly: true,
    },
  };
}

function systemMetrics(): Record<string, unknown> {
  const cpus = os.cpus();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const uptime = os.uptime();
  const hours = Math.floor(uptime / 3600);
  const minutes = Math.floor((uptime % 3600) / 60);

  return {
    platform: os.platform(),
    arch: os.arch(),
    hostname: os.hostname(),
    cpu: { model: cpus[0]?.model ?? 'N/A', cores: cpus.length },
    memory: {
      total: `${(totalMem / 1024 ** 3).toFixed(1)} GB`,
      used: `${(usedMem / 1024 ** 3).toFixed(1)} GB`,
      free: `${(freeMem / 1024 ** 3).toFixed(1)} GB`,
      usagePercent: `${((usedMem / totalMem) * 100).toFixed(1)}%`,
    },
    uptime: `${hours}s ${minutes}d`,
    nodeVersion: process.version,
  };
}

edithToolRegistry.register({
  id: 'system_monitor',
  metadata: {
    name: 'System Monitor',
    version: '1.0.0',
    description: 'Reads local operating system, CPU, memory, uptime, and Node.js runtime metrics.',
    category: 'system',
    inputSchema: {},
    outputSchema: {
      platform: { type: 'string' },
      arch: { type: 'string' },
      hostname: { type: 'string' },
      cpu: { type: 'object' },
      memory: { type: 'object' },
      uptime: { type: 'string' },
      nodeVersion: { type: 'string' },
    },
    requiredPermissions: ['system:read'],
    riskLevel: 0,
    timeoutMs: 2000,
    retryLimit: 0,
    supportsDryRun: true,
    supportsRollback: false,
    platforms: ['win32', 'darwin', 'linux'],
    dependencies: [],
  },
  handler: (_args, _context): EdithToolResult => {
    const metrics = systemMetrics();
    return {
      success: true,
      toolId: 'system_monitor',
      result: JSON.stringify(metrics, null, 2),
      structuredOutput: metrics,
    };
  },
});

edithToolRegistry.register({
  id: 'vision_observe',
  metadata: {
    name: 'Read-only Vision Observation',
    version: '0.1.0',
    description: 'Creates a structured read-only screen/window/browser/PDF observation without mouse, keyboard, or autonomous action.',
    category: 'vision',
    inputSchema: {
      source: { type: 'string', required: false, description: 'screen, window, application, dialog, notification, browser_page, pdf, or screenshot_diff.' },
      question: { type: 'string', required: false, description: 'Question to answer from the observation.' },
      text: { type: 'string', required: false, description: 'Optional text already extracted by an adapter.' },
      application: { type: 'string', required: false },
      windowTitle: { type: 'string', required: false },
      monitorIndex: { type: 'number', required: false },
    },
    outputSchema: {
      observation: { type: 'object' },
    },
    requiredPermissions: ['system:read'],
    riskLevel: 0,
    timeoutMs: 2000,
    retryLimit: 0,
    supportsDryRun: true,
    supportsRollback: false,
    platforms: ['win32', 'darwin', 'linux'],
    dependencies: ['optional screenshot/OCR/window-detection adapter'],
  },
  handler: (args): EdithToolResult => {
    const observation = visionObservationService.createObservation({
      source: typeof args.source === 'string' ? args.source as any : undefined,
      question: getStringArg(args, 'question'),
      text: getStringArg(args, 'text'),
      application: getStringArg(args, 'application'),
      windowTitle: getStringArg(args, 'windowTitle'),
      monitorIndex: typeof args.monitorIndex === 'number' ? args.monitorIndex : undefined,
    });
    return {
      success: true,
      toolId: 'vision_observe',
      result: observation.summary,
      structuredOutput: { observation },
    };
  },
});

edithToolRegistry.register({
  id: 'computer_action',
  metadata: {
    name: 'Safe Computer Action',
    version: '0.1.0',
    description: 'Policy-gated desktop action adapter. It validates permissions, kill switch, forbidden intents, and audit before any runtime action.',
    category: 'computer',
    inputSchema: {
      action: { type: 'string', required: true, description: 'mouse_move, click, double_click, right_click, type_text, hotkey, focus_window, switch_window, launch_app, close_app.' },
      target: { type: 'string', required: false },
      text: { type: 'string', required: false },
      x: { type: 'number', required: false },
      y: { type: 'number', required: false },
      keys: { type: 'array', required: false },
      reason: { type: 'string', required: true },
      dryRun: { type: 'boolean', required: false },
    },
    outputSchema: {
      request: { type: 'object' },
      verification: { type: 'string' },
    },
    requiredPermissions: ['computer:control'],
    riskLevel: 4,
    timeoutMs: 5000,
    retryLimit: 0,
    supportsDryRun: true,
    supportsRollback: false,
    platforms: ['win32', 'darwin', 'linux'],
    dependencies: ['computer-use runtime adapter'],
  },
  handler: (args, context): EdithToolResult => {
    const action = getStringArg(args, 'action') as any;
    return computerActionService.execute({
      action,
      target: getStringArg(args, 'target'),
      text: getStringArg(args, 'text'),
      x: typeof args.x === 'number' ? args.x : undefined,
      y: typeof args.y === 'number' ? args.y : undefined,
      keys: Array.isArray(args.keys) ? args.keys.map(String) : undefined,
      reason: getStringArg(args, 'reason') ?? 'No reason supplied.',
      dryRun: Boolean(args.dryRun),
    }, context.actor);
  },
});

edithToolRegistry.register({
  id: 'browser_workflow',
  metadata: { name: 'browser_workflow', version: '1.0.0', description: 'Owned headed browser with exact action readback; no native physical proof.', category: 'browser',
    inputSchema: {
      action: { type: 'string', required: false }, query: { type: 'string', required: false }, url: { type: 'string', required: false },
      selectors: { type: 'object', required: false }, fieldValues: { type: 'object', required: false }, filePath: { type: 'string', required: false },
      verificationGoal: { type: 'string', required: false }, sessionId: { type: 'string', required: false }, pageId: { type: 'string', required: false },
      scrollDeltaY: { type: 'number', required: false }, dryRun: { type: 'boolean', required: false }, approvalGranted: { type: 'boolean', required: false },
    },
    outputSchema: { browser: { type: 'object' }, taskId: { type: 'string' } },
    requiredPermissions: [...BROWSER_TOOL_POLICY.requiredPermissions], riskLevel: BROWSER_TOOL_POLICY.riskLevel,
    timeoutMs: 31000, retryLimit: 0, supportsDryRun: true, supportsRollback: false,
    platforms: ['win32', 'darwin', 'linux'], dependencies: ['playwright', 'owned browser pinned egress'],
  },
  handler: (args, context) => browserWorkflowService.executeRegistered(args, context, 'browser_workflow'),
});

edithToolRegistry.register({
  id: 'iot_feedback_stub',
  metadata: {
    name: 'IoT Feedback Stub',
    version: '0.1.0',
    description: 'Permission-gated smart-home/IoT feedback architecture stub. No device action is executed without a real configured integration.',
    category: 'iot',
    inputSchema: {
      action: { type: 'string', required: true, description: 'status, notify, light_feedback, or device_feedback.' },
      target: { type: 'string', required: false },
      payload: { type: 'object', required: false },
      reason: { type: 'string', required: false },
      dryRun: { type: 'boolean', required: false },
    },
    outputSchema: {
      capability: { type: 'object' },
      honestStatus: { type: 'string' },
    },
    requiredPermissions: ['iot:control'],
    riskLevel: 4,
    timeoutMs: 5000,
    retryLimit: 0,
    supportsDryRun: true,
    supportsRollback: false,
    platforms: ['win32', 'darwin', 'linux'],
    dependencies: ['smart-home provider adapter'],
  },
  handler: (args, context): EdithToolResult => sensitiveIntegrationService.run('iot', {
    action: getStringArg(args, 'action') ?? '',
    target: getStringArg(args, 'target'),
    payload: typeof args.payload === 'object' && args.payload !== null && !Array.isArray(args.payload) ? args.payload as Record<string, unknown> : undefined,
    reason: getStringArg(args, 'reason'),
    dryRun: Boolean(args.dryRun),
  }, context.actor),
});

edithToolRegistry.register({
  id: 'finance_trading_guard',
  metadata: {
    name: 'Finance Trading Guard',
    version: '0.1.0',
    description: 'Permission-gated finance/trading guard. No broker, exchange, bank, or live order action is executed without a real configured adapter.',
    category: 'finance',
    inputSchema: {
      action: { type: 'string', required: true, description: 'quote, portfolio_read, paper_order, or live_order.' },
      target: { type: 'string', required: false },
      payload: { type: 'object', required: false },
      reason: { type: 'string', required: false },
      dryRun: { type: 'boolean', required: false },
    },
    outputSchema: {
      capability: { type: 'object' },
      honestStatus: { type: 'string' },
    },
    requiredPermissions: ['trading:execute'],
    riskLevel: 5,
    timeoutMs: 5000,
    retryLimit: 0,
    supportsDryRun: true,
    supportsRollback: false,
    platforms: ['win32', 'darwin', 'linux'],
    dependencies: ['broker/exchange adapter'],
  },
  handler: (args, context): EdithToolResult => sensitiveIntegrationService.run('finance', {
    action: getStringArg(args, 'action') ?? '',
    target: getStringArg(args, 'target'),
    payload: typeof args.payload === 'object' && args.payload !== null && !Array.isArray(args.payload) ? args.payload as Record<string, unknown> : undefined,
    reason: getStringArg(args, 'reason'),
    dryRun: Boolean(args.dryRun),
  }, context.actor),
});

edithToolRegistry.register({
  id: 'obsidian_save_note',
  metadata: {
    name: 'Obsidian Save Note',
    version: '0.1.0',
    description: 'Saves research, coding, meeting, or trading agent notes into the configured Obsidian vault and reindexes them into the knowledge graph.',
    category: 'knowledge',
    inputSchema: {
      agentId: { type: 'string', required: true, description: 'Agent identifier that produced the note.' },
      kind: { type: 'string', required: true, description: 'research, coding, meeting, or trading.' },
      title: { type: 'string', required: true },
      body: { type: 'string', required: true },
    },
    outputSchema: {
      path: { type: 'string' },
    },
    requiredPermissions: ['memory:write'],
    riskLevel: 2,
    timeoutMs: 5000,
    retryLimit: 0,
    supportsDryRun: true,
    supportsRollback: false,
    platforms: ['win32'],
    dependencies: [],
  },
  handler: async (args): Promise<EdithToolResult> => {
    const kind = getStringArg(args, 'kind');
    if (kind !== 'research' && kind !== 'coding' && kind !== 'meeting' && kind !== 'trading') {
      return { success: false, toolId: 'obsidian_save_note', error: 'kind must be research, coding, meeting, or trading.', errorCode: 'VALIDATION_ERROR' };
    }
    const { obsidianVaultService } = await import('./obsidianVaultService');
    const path = obsidianVaultService.writeAgentNote({
      agentId: getStringArg(args, 'agentId') ?? 'agent',
      kind,
      title: getStringArg(args, 'title') ?? 'Untitled Agent Note',
      body: getStringArg(args, 'body') ?? '',
    });
    return {
      success: true,
      toolId: 'obsidian_save_note',
      result: `Saved Obsidian note: ${path}`,
      structuredOutput: { path },
    };
  },
});

edithToolRegistry.register({
  id: 'open_interpreter_agent',
  metadata: {
    name: 'Open Interpreter Agent',
    version: '0.1.0',
    description: 'Runs a local Open Interpreter task when explicitly enabled for high-risk execution.',
    category: 'code',
    inputSchema: {
      prompt: { type: 'string', required: true, description: 'The local computer/code task to attempt.' },
    },
    outputSchema: {
      stdout: { type: 'string' },
      exitCode: { type: 'number' },
    },
    requiredPermissions: ['system:exec', 'file:read', 'file:write'],
    riskLevel: 5,
    timeoutMs: 120000,
    retryLimit: 0,
    supportsDryRun: true,
    supportsRollback: false,
    platforms: ['win32', 'darwin', 'linux'],
    dependencies: ['open-interpreter'],
  },
  handler: async (args, context): Promise<EdithToolResult> => {
    const unavailable = highRiskUnavailable('open_interpreter_agent', context);
    if (unavailable) return unavailable;
    const prompt = getStringArg(args, 'prompt');
    if (!prompt) {
      return { success: false, toolId: 'open_interpreter_agent', error: 'prompt is required.' };
    }
    const result = await runPythonModule('interpreter', ['--message', prompt]);
    return { ...result, toolId: 'open_interpreter_agent' };
  },
});

function configurationRequired3dTool(toolId: string, engine: string, capability: string): EdithToolResult {
  return {
    success: false,
    toolId,
    error: `CONFIGURATION_REQUIRED: ${engine} is not bound to EDITH yet. ${capability} is registered as a safe foundation only.`,
    errorCode: 'TOOL_ERROR',
    structuredOutput: {
      capability: 'CONFIGURATION_REQUIRED',
      engine,
      honestStatus: 'No CAD/render/simulation operation was executed.',
    },
  };
}

edithToolRegistry.register({
  id: 'design3d_cad_foundation',
  metadata: {
    name: '3D CAD Foundation',
    version: '0.1.0',
    description: 'Registers the EDITH 3D CAD foundation for future FreeCAD/CadQuery/OpenCascade parametric generation.',
    category: 'design3d',
    inputSchema: {
      prompt: { type: 'string', required: true },
      engine: { type: 'string', required: false, description: 'cadquery, freecad, or opencascade.' },
    },
    outputSchema: {
      capability: { type: 'string' },
      engine: { type: 'string' },
    },
    requiredPermissions: ['system:read'],
    riskLevel: 1,
    timeoutMs: 5000,
    retryLimit: 0,
    supportsDryRun: true,
    supportsRollback: false,
    platforms: ['win32', 'darwin', 'linux'],
    dependencies: ['FreeCAD or CadQuery/OCP'],
  },
  handler: (args): EdithToolResult => configurationRequired3dTool(
    'design3d_cad_foundation',
    getStringArg(args, 'engine') ?? 'CadQuery/OpenCascade',
    'Parametric CAD generation'
  ),
});

edithToolRegistry.register({
  id: 'design3d_render_foundation',
  metadata: {
    name: '3D Render Foundation',
    version: '0.1.0',
    description: 'Registers the EDITH 3D render foundation for future Blender Python/background rendering.',
    category: 'design3d',
    inputSchema: {
      scenePath: { type: 'string', required: false },
      prompt: { type: 'string', required: true },
    },
    outputSchema: {
      capability: { type: 'string' },
      engine: { type: 'string' },
    },
    requiredPermissions: ['system:read'],
    riskLevel: 1,
    timeoutMs: 5000,
    retryLimit: 0,
    supportsDryRun: true,
    supportsRollback: false,
    platforms: ['win32', 'darwin', 'linux'],
    dependencies: ['Blender'],
  },
  handler: (): EdithToolResult => configurationRequired3dTool(
    'design3d_render_foundation',
    'Blender Python/background mode',
    'Rendering and animation'
  ),
});

edithToolRegistry.register({
  id: 'design3d_simulation_foundation',
  metadata: {
    name: '3D Simulation Foundation',
    version: '0.1.0',
    description: 'Registers the EDITH simulation foundation for future physics, FEA/FEM, CFD, robotics, and manufacturing checks.',
    category: 'design3d',
    inputSchema: {
      prompt: { type: 'string', required: true },
      simulationType: { type: 'string', required: false, description: 'physics, fea, cfd, robotics, manufacturing, or printing.' },
    },
    outputSchema: {
      capability: { type: 'string' },
      engine: { type: 'string' },
    },
    requiredPermissions: ['system:read'],
    riskLevel: 1,
    timeoutMs: 5000,
    retryLimit: 0,
    supportsDryRun: true,
    supportsRollback: false,
    platforms: ['win32', 'darwin', 'linux'],
    dependencies: ['selected simulation/manufacturing engine'],
  },
  handler: (args): EdithToolResult => configurationRequired3dTool(
    'design3d_simulation_foundation',
    getStringArg(args, 'simulationType') ?? 'Simulation engine',
    'Engineering simulation'
  ),
});

edithToolRegistry.register({
  id: 'steam_game_search',
  metadata: {
    name: 'Steam Oyun Kütüphanesi',
    version: '1.0.0',
    description: 'Yerel Steam kütüphanesini okur ve oyun adına göre arama yapar.',
    category: 'system',
    inputSchema: {
      gameName: { type: 'string', required: false, description: 'Aranacak oyun adı veya parçası.' },
    },
    outputSchema: { games: { type: 'array' } },
    requiredPermissions: ['system:read'],
    riskLevel: 1,
    timeoutMs: 30000,
    retryLimit: 0,
    supportsDryRun: true,
    supportsRollback: false,
    platforms: ['win32', 'darwin', 'linux'],
    dependencies: ['sandboxed Mark-L adapter'],
  },
  handler: (): EdithToolResult => markLAdapterRequired('steam_game_search'),
});

edithToolRegistry.register({
  id: 'steam_game_install',
  metadata: {
    name: 'Steam Oyunu Kur',
    version: '1.0.0',
    description: 'Steam oyununu bulur, Steam kurulum penceresini açar ve istenen diski seçer.',
    category: 'system',
    inputSchema: {
      gameName: { type: 'string', required: true, description: 'Kurulacak Steam oyununun adı.' },
      targetDrive: { type: 'string', required: false, description: 'Hedef disk harfi; örneğin D veya D:.' },
      appId: { type: 'string', required: false, description: 'Biliniyorsa Steam AppID.' },
    },
    outputSchema: { result: { type: 'string' } },
    requiredPermissions: ['computer:control', 'system:exec'],
    riskLevel: 5,
    timeoutMs: 120000,
    retryLimit: 0,
    supportsDryRun: true,
    supportsRollback: false,
    platforms: ['win32', 'darwin', 'linux'],
    dependencies: ['sandboxed Mark-L adapter', 'Steam'],
  },
  handler: async (args, context): Promise<EdithToolResult> => {
    const unavailable = highRiskUnavailable('steam_game_install', context);
    if (unavailable) return unavailable;
    const gameName = getStringArg(args, 'gameName');
    if (!gameName) {
      return { success: false, toolId: 'steam_game_install', error: 'Kurulacak oyun adı gerekli.' };
    }
    return markLAdapterRequired('steam_game_install');
  },
});

edithToolRegistry.register({
  id: 'computer_control_agent',
  metadata: {
    name: 'Computer Control Agent',
    version: '0.1.0',
    description: 'High-risk placeholder for full desktop control adapters such as Computer Use, Open Interpreter, or Mark-L actions.',
    category: 'system',
    inputSchema: {
      instruction: { type: 'string', required: true, description: 'Desktop-control instruction.' },
    },
    outputSchema: {
      capability: { type: 'string' },
    },
    requiredPermissions: ['computer:control', 'system:exec'],
    riskLevel: 5,
    timeoutMs: 120000,
    retryLimit: 0,
    supportsDryRun: true,
    supportsRollback: false,
    platforms: ['win32'],
    dependencies: ['computer-use plugin or Mark-L computer_control adapter'],
  },
  handler: (args, context): EdithToolResult => {
    const unavailable = highRiskUnavailable('computer_control_agent', context);
    if (unavailable) return unavailable;
    const instruction = getStringArg(args, 'instruction');
    if (!instruction) {
      return { success: false, toolId: 'computer_control_agent', error: 'instruction is required.' };
    }
    return {
      success: false,
      toolId: 'computer_control_agent',
      error: 'CONFIGURATION_REQUIRED: Desktop-control runtime adapter is registered but not yet bound to a local controller.',
      structuredOutput: {
        capability: 'CONFIGURATION_REQUIRED',
        instruction,
        nextAdapterOptions: ['Computer Use plugin runtime', 'Mark-L computer_control.py adapter'],
      },
    };
  },
});

edithToolRegistry.register({
  id: 'browser_use_agent',
  metadata: {
    name: 'Browser Use Agent',
    version: '0.1.0',
    description: 'Runs a browser-use style autonomous browser task when the package and high-risk mode are enabled.',
    category: 'web',
    inputSchema: {
      task: { type: 'string', required: true, description: 'Browser task to perform.' },
    },
    outputSchema: {
      stdout: { type: 'string' },
      exitCode: { type: 'number' },
    },
    requiredPermissions: ['network:read', 'browser:control'],
    riskLevel: 3,
    timeoutMs: 120000,
    retryLimit: 0,
    supportsDryRun: true,
    supportsRollback: false,
    platforms: ['win32', 'darwin', 'linux'],
    dependencies: ['browser-use'],
  },
  handler: async (args, context): Promise<EdithToolResult> => {
    const unavailable = highRiskUnavailable('browser_use_agent', context);
    if (unavailable) return unavailable;
    const task = getStringArg(args, 'task');
    if (!task) {
      return { success: false, toolId: 'browser_use_agent', error: 'task is required.' };
    }
    return {
      success: false,
      toolId: 'browser_use_agent',
      error: 'CONFIGURATION_REQUIRED: browser-use is cataloged, but the Python adapter package is not installed/configured yet.',
      structuredOutput: {
        capability: 'CONFIGURATION_REQUIRED',
        package: 'browser-use',
        task,
      },
    };
  },
});

edithToolRegistry.register({
  id: 'playwright_browser_agent',
  metadata: { name: 'playwright_browser_agent', version: '1.0.0', description: 'Owned headed browser with exact action readback; no native physical proof.', category: 'browser',
    inputSchema: {
      action: { type: 'string', required: false }, query: { type: 'string', required: false }, url: { type: 'string', required: false },
      selectors: { type: 'object', required: false }, fieldValues: { type: 'object', required: false }, filePath: { type: 'string', required: false },
      verificationGoal: { type: 'string', required: false }, sessionId: { type: 'string', required: false }, pageId: { type: 'string', required: false },
      scrollDeltaY: { type: 'number', required: false }, dryRun: { type: 'boolean', required: false }, approvalGranted: { type: 'boolean', required: false },
    },
    outputSchema: { browser: { type: 'object' }, taskId: { type: 'string' } },
    requiredPermissions: [...BROWSER_TOOL_POLICY.requiredPermissions], riskLevel: BROWSER_TOOL_POLICY.riskLevel,
    timeoutMs: 31000, retryLimit: 0, supportsDryRun: true, supportsRollback: false,
    platforms: ['win32', 'darwin', 'linux'], dependencies: ['playwright', 'owned browser pinned egress'],
  },
  handler: (args, context) => browserWorkflowService.executeRegistered({ ...args, action: args.action === 'open' ? 'navigate' : args.action ?? 'title', verificationGoal: args.verificationGoal ?? 'Verify requested browser action.' }, context, 'playwright_browser_agent'),
});

edithToolRegistry.register({
  id: 'task_create',
  metadata: {
    name: 'Create EDITH Task',
    version: '1.0.0',
    description: 'Creates a durable EDITH task record for planning and follow-up.',
    category: 'analytics',
    inputSchema: {
      title: { type: 'string', required: true },
      objective: { type: 'string', required: true },
      originalUserRequest: { type: 'string', required: true },
    },
    outputSchema: {
      task: { type: 'object' },
    },
    requiredPermissions: ['system:read'],
    riskLevel: 1,
    timeoutMs: 1000,
    retryLimit: 0,
    supportsDryRun: true,
    supportsRollback: false,
    platforms: ['win32', 'darwin', 'linux'],
    dependencies: [],
  },
  handler: (args): EdithToolResult => {
    const title = getStringArg(args, 'title') || 'EDITH Task';
    const objective = getStringArg(args, 'objective');
    const originalUserRequest = getStringArg(args, 'originalUserRequest') || objective;
    if (!objective || !originalUserRequest) {
      return { success: false, toolId: 'task_create', error: 'objective and originalUserRequest are required.' };
    }
    const task = createStoredTask({
      title,
      objective,
      originalUserRequest,
      riskLevel: 1,
    });
    return {
      success: true,
      toolId: 'task_create',
      result: `Görev oluşturuldu: ${task.title}\nID: ${task.id}`,
      structuredOutput: { task },
    };
  },
});

edithToolRegistry.register({
  id: 'browser_open',
  metadata: { name: 'browser_open', version: '1.0.0', description: 'Owned headed browser with exact action readback; no native physical proof.', category: 'browser',
    inputSchema: {
      action: { type: 'string', required: false }, query: { type: 'string', required: false }, url: { type: 'string', required: false },
      selectors: { type: 'object', required: false }, fieldValues: { type: 'object', required: false }, filePath: { type: 'string', required: false },
      verificationGoal: { type: 'string', required: false }, sessionId: { type: 'string', required: false }, pageId: { type: 'string', required: false },
      scrollDeltaY: { type: 'number', required: false }, dryRun: { type: 'boolean', required: false }, approvalGranted: { type: 'boolean', required: false },
    },
    outputSchema: { browser: { type: 'object' }, taskId: { type: 'string' } },
    requiredPermissions: [...BROWSER_TOOL_POLICY.requiredPermissions], riskLevel: BROWSER_TOOL_POLICY.riskLevel,
    timeoutMs: 31000, retryLimit: 0, supportsDryRun: true, supportsRollback: false,
    platforms: ['win32', 'darwin', 'linux'], dependencies: ['playwright', 'owned browser pinned egress'],
  },
  handler: (args, context) => browserWorkflowService.executeRegistered({ ...args, action: 'navigate', verificationGoal: args.verificationGoal ?? 'Verify actual page navigation.' }, context, 'browser_open'),
});

edithToolRegistry.register({
  id: 'browser_search',
  metadata: { name: 'browser_search', version: '1.0.0', description: 'Owned headed browser with exact action readback; no native physical proof.', category: 'browser',
    inputSchema: {
      action: { type: 'string', required: false }, query: { type: 'string', required: false }, url: { type: 'string', required: false },
      selectors: { type: 'object', required: false }, fieldValues: { type: 'object', required: false }, filePath: { type: 'string', required: false },
      verificationGoal: { type: 'string', required: false }, sessionId: { type: 'string', required: false }, pageId: { type: 'string', required: false },
      scrollDeltaY: { type: 'number', required: false }, dryRun: { type: 'boolean', required: false }, approvalGranted: { type: 'boolean', required: false },
    },
    outputSchema: { browser: { type: 'object' }, taskId: { type: 'string' } },
    requiredPermissions: [...BROWSER_TOOL_POLICY.requiredPermissions], riskLevel: BROWSER_TOOL_POLICY.riskLevel,
    timeoutMs: 31000, retryLimit: 0, supportsDryRun: true, supportsRollback: false,
    platforms: ['win32', 'darwin', 'linux'], dependencies: ['playwright', 'owned browser pinned egress'],
  },
  handler: (args, context) => browserWorkflowService.executeRegistered({ ...args, action: 'search', verificationGoal: args.verificationGoal ?? 'Observe actual search results.' }, context, 'browser_search'),
});

edithToolRegistry.register({
  id: 'ai_skill_catalog',
  metadata: {
    name: 'AI Skill Catalog',
    version: '1.0.0',
    description: 'Lists curated external AI skill projects and their safe EDITH integration plans.',
    category: 'analytics',
    inputSchema: {},
    outputSchema: {
      projects: { type: 'array' },
    },
    requiredPermissions: ['system:read'],
    riskLevel: 0,
    timeoutMs: 1000,
    retryLimit: 0,
    supportsDryRun: true,
    supportsRollback: false,
    platforms: ['win32', 'darwin', 'linux'],
    dependencies: [],
  },
  handler: (): EdithToolResult => {
    const projects = listExternalSkillProjects();
    return {
      success: true,
      toolId: 'ai_skill_catalog',
      result: JSON.stringify(projects, null, 2),
      structuredOutput: { projects },
    };
  },
});

edithToolRegistry.register({
  id: 'mark_l_capabilities',
  metadata: {
    name: 'Mark-L Capability Snapshot',
    version: '0.1.0',
    description: 'Lists Mark-L capability-provider modules, risk levels, permissions, and adapter status without executing OS actions.',
    category: 'analytics',
    inputSchema: {},
    outputSchema: {
      root: { type: 'string' },
      capabilities: { type: 'array' },
      capabilityCount: { type: 'number' },
      highRiskCount: { type: 'number' },
    },
    requiredPermissions: ['system:read'],
    riskLevel: 1,
    timeoutMs: 1000,
    retryLimit: 0,
    supportsDryRun: true,
    supportsRollback: false,
    platforms: ['win32', 'darwin', 'linux'],
    dependencies: ['Mark-L-main'],
  },
  handler: (): EdithToolResult => {
    const snapshot = markLAdapterService.snapshot();
    return {
      success: true,
      toolId: 'mark_l_capabilities',
      result: JSON.stringify(snapshot, null, 2),
      structuredOutput: snapshot as unknown as Record<string, unknown>,
    };
  },
});

registerAwesomeAgentSkillTools(edithToolRegistry);

export async function executeEdithTool(
  toolId: string,
  args: Record<string, unknown>,
  context: Partial<EdithToolExecutionContext> = {}
): Promise<EdithToolResult> {
  if (toolId === 'rea_analysis') return reaDirectDenied();
  const tool = edithToolRegistry.get(toolId);
  const executionContext: EdithToolExecutionContext = {
    actor: context.actor ?? 'local-user',
    taskId: context.taskId,
    dryRun: context.dryRun,
    authorizedPermissions:
      context.authorizedPermissions ??
      permissionService.defaultAuthorizedPermissions(),
  };

  if (!tool) {
    return { success: false, toolId, error: `Unknown EDITH tool: ${toolId}`, errorCode: 'UNKNOWN_TOOL' };
  }

  const browserTool = (BROWSER_TOOL_IDS as readonly string[]).includes(toolId);
  if (browserTool) {
    const parsed = normalizeRegisteredBrowserArgs(toolId as BrowserToolId, args, Boolean(executionContext.dryRun));
    if (parsed.success === false) {
      const audit = createAuditEvent({ actor: executionContext.actor, taskId: executionContext.taskId,
        action: 'tool.browser_schema_denied', toolId, authorization: 'denied', riskLevel: 4, result: 'denied', message: 'BROWSER_VALIDATION_ERROR' });
      appendAuditEvent(audit);
      recordToolRun({ id: normalizeToolRunId(toolId), toolId, toolName: tool.metadata.name, args: {}, result: '', timestamp: Date.now(), status: 'denied' });
      return { success: false, toolId, errorCode: 'VALIDATION_ERROR', error: 'BROWSER_VALIDATION_ERROR', auditEventId: audit.id };
    }
    args = parsed.value as unknown as Record<string, unknown>;
    executionContext.dryRun = false;
    if (parsed.value.dryRun || ['download_pdf', 'read_pdf', 'upload_file'].includes(parsed.value.action)) {
      const result = await browserWorkflowService.run(parsed.value, executionContext.actor);
      const audit = createAuditEvent({ actor: executionContext.actor, action: parsed.value.dryRun ? 'tool.dry_run' : 'tool.execute',
        toolId, authorization: 'allowed', riskLevel: BROWSER_TOOL_POLICY.riskLevel, result: result.success ? 'success' : 'error',
        message: parsed.value.dryRun ? 'BROWSER_SCHEMA_ONLY' : 'BROWSER_UNSUPPORTED_ACTION' });
      appendAuditEvent(audit);
      recordToolRun({ id: normalizeToolRunId(toolId), toolId, toolName: tool.metadata.name, args, result: '', timestamp: Date.now(), status: result.success ? 'success' : 'error' });
      return { ...result, toolId, auditEventId: audit.id };
    }
    if (ownerSessionBindingActive(executionContext.actor)) {
      const permission = permissionService.decideToolExecution({ tool, actor: 'owner' });
      executionContext.authorizedPermissions = permission.authorizedPermissions;
    }
    if (!executionContext.taskId && !parsed.value.dryRun) {
      // The service owns the sole Task lifecycle and audits its single leaf dispatch.
      const result = await browserWorkflowService.runRegistered(parsed.value, executionContext.actor, toolId as BrowserToolId);
      if (result.auditEventId) return result;
      const audit = createAuditEvent({ actor: executionContext.actor, toolId, action: 'tool.execute', authorization: 'denied',
        riskLevel: BROWSER_TOOL_POLICY.riskLevel, result: 'denied', message: 'BROWSER_PERMISSION_DENIED' });
      appendAuditEvent(audit);
      recordToolRun({ id: normalizeToolRunId(toolId), toolId, toolName: tool.metadata.name, args, result: '', timestamp: Date.now(), status: 'denied' });
      return { ...result, auditEventId: audit.id };
    }
  }
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const toolRunId = normalizeToolRunId(toolId);

  try {
    killSwitchService.assertAllowed('tool_execution', executionContext.actor);
  } catch (error) {
    if (!(error instanceof KillSwitchActiveError)) throw error;
    const finishedAtMs = Date.now();
    const finishedAt = new Date(finishedAtMs).toISOString();
    const audit = createAuditEvent({
      actor: executionContext.actor,
      taskId: executionContext.taskId,
      action: 'tool.blocked_by_kill_switch',
      toolId,
      authorization: 'denied',
      riskLevel: tool.metadata.riskLevel,
      result: 'denied',
      message: browserTool ? 'BROWSER_KILL_SWITCH_ACTIVE' : error.message,
    });
    appendAuditEvent(audit);
    const result: EdithToolResult = {
      success: false,
      toolId,
      error: browserTool ? 'BROWSER_KILL_SWITCH_ACTIVE' : error.message,
      auditEventId: audit.id,
      startedAt,
      finishedAt,
      durationMs: finishedAtMs - startedAtMs,
      errorCode: 'PERMISSION_DENIED',
      structuredOutput: {
        killSwitch: error.state,
        disabledCapability: error.capability,
      },
    };
    recordToolRun({
      id: toolRunId,
      toolId,
      toolName: tool.metadata.name,
      args,
      result: safeResultText(result),
      timestamp: startedAtMs,
      status: 'denied',
    });
    return result;
  }

  try {
    const result = await edithToolRegistry.execute(toolId, args, executionContext);
    const finishedAtMs = Date.now();
    const finishedAt = new Date(finishedAtMs).toISOString();
    const normalizedResult: EdithToolResult = {
      ...result,
      startedAt,
      finishedAt,
      durationMs: finishedAtMs - startedAtMs,
      errorCode: result.success ? undefined : result.errorCode ?? 'TOOL_ERROR',
    };
    const audit = createAuditEvent({
      actor: executionContext.actor,
      taskId: executionContext.taskId,
      action: executionContext.dryRun ? 'tool.dry_run' : 'tool.execute',
      toolId,
      authorization: 'allowed',
      riskLevel: tool.metadata.riskLevel,
      result: normalizedResult.success ? 'success' : 'error',
      message: browserTool ? (normalizedResult.success ? 'BROWSER_SUCCESS' : 'BROWSER_FAILED') : safeResultText(normalizedResult).slice(0, 500),
    });
    appendAuditEvent(audit);
    const withAudit = { ...normalizedResult, auditEventId: audit.id };
    recordToolRun({
      id: toolRunId,
      toolId,
      toolName: tool.metadata.name,
      args,
      result: safeResultText(withAudit),
      timestamp: startedAtMs,
      status: withAudit.success ? 'success' : 'error',
    });
    return withAudit;
  } catch (error) {
    const denied = error instanceof EdithPermissionError;
    const invalid = error instanceof EdithToolValidationError;
    const timedOut = error instanceof EdithToolTimeoutError;
    const permissionDecision = denied
      ? permissionService.decideToolExecution({
          tool,
          actor: executionContext.actor,
          authorizedPermissions: executionContext.authorizedPermissions,
        })
      : undefined;
    const finishedAtMs = Date.now();
    const finishedAt = new Date(finishedAtMs).toISOString();
    const audit = createAuditEvent({
      actor: executionContext.actor,
      taskId: executionContext.taskId,
      action: executionContext.dryRun ? 'tool.dry_run' : 'tool.execute',
      toolId,
      authorization: denied ? 'denied' : 'allowed',
      riskLevel: denied ? error.riskLevel : tool.metadata.riskLevel,
      result: denied ? 'denied' : 'error',
      message: browserTool ? (denied ? 'BROWSER_PERMISSION_DENIED' : invalid ? 'BROWSER_VALIDATION_ERROR' : timedOut ? 'BROWSER_TIMEOUT' : 'BROWSER_FAILED') : error instanceof Error ? error.message : String(error),
    });
    appendAuditEvent(audit);
    const result: EdithToolResult = {
      success: false,
      toolId,
      error: audit.message,
      auditEventId: audit.id,
      startedAt,
      finishedAt,
      durationMs: finishedAtMs - startedAtMs,
      errorCode: denied
        ? 'PERMISSION_DENIED'
        : invalid
        ? 'VALIDATION_ERROR'
        : timedOut
        ? 'TIMEOUT'
        : 'TOOL_ERROR',
      structuredOutput: browserTool
        ? undefined
        : denied
        ? { missingPermissions: error.missingPermissions, permissionDecision }
        : invalid
        ? { validationErrors: error.validationErrors }
        : timedOut
        ? { timeoutMs: error.timeoutMs }
        : undefined,
    };
    recordToolRun({
      id: toolRunId,
      toolId,
      toolName: tool.metadata.name,
      args,
      result: safeResultText(result),
      timestamp: startedAtMs,
      status: denied ? 'denied' : 'error',
    });
    return result;
  }
}
