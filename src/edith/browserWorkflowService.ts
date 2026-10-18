import type { BrowserWorkflowRequest, EdithRiskLevel, EdithToolResult, EdithToolExecutionContext } from './core';
import { createHash, randomUUID } from 'node:crypto';
import { BROWSER_ACTIONS, BROWSER_TOOL_IDS, BROWSER_TOOL_POLICY, BROWSER_OPERATOR_CONTRACT, parseBrowserWorkflowRequest, parseBrowserOperatorReceipt, getBrowserActionSupport, type BrowserToolId, type BrowserOperatorReceipt } from './browserOperatorContract';
import { getBrowserOperatorAdapter } from './browserOperatorAdapter';
import { permissionService } from './permissionService';
import { ownerSessionBindingActive } from '../../server/security/ownerSession';
import { killSwitchService } from './killSwitch';
import { taskService, isNativeBoundTask } from './taskService';
import { executeEdithTool, edithToolRegistry } from './serverRegistry';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Request } from 'express';
import type { EdithTask } from './core';
import { projectTaskEventsV2 } from './contracts';
import { getOwnerSession, onOwnerSessionInvalidated } from '../../server/security/ownerSession';
import { normalizeRegisteredBrowserArgs } from '../../server/browser/browserRegisteredArgs';
import type { BrowserOwnerCap, BrowserParentExecutionCap, BrowserParentStepCap, BrowserParentAggregateCap, BrowserParentEvidenceCap,
  BrowserParentClosedReason, BrowserParentStepResult, BrowserParentAggregateView, BrowserParentRequiredCheck, BrowserParentOccurrence } from '../../server/browser/browserPrivateContract';
import type { RetainedBrowserRequestRef, AttemptRef, NativeBootRef, BackendBootRef, BindingRef, NativeAuthorityPort,
  NativeAuthorityIdentityPort, NativeWorkflowPendingV1, NativeParentPendingV1, NativeWorkflowResult, OriginalAttemptLookupRef,
  NativeDomPairCap, NativeParentStrategySetCap, NativeParentEvidenceCap, NativeParentAggregateCap, NativeParentAggregateView,
  NativeParentStepResult, BrowserNativeSourceHandle, NativeSourceTargetCap, NativeSourceSnapshotCap, NativeSourceInputCap,
  NativeSourcePostconditionCap, PlannedNativeBatchRef, SnapshotRef, DispatchRef, NativeLedgerView,
  BackendConsumedCommandRef, BackendConsumedEnterCommandRef, DormantSearchSubmitAdmissionRef, SearchCausalSuccessorRef, HrefCausalSuccessorRef,
  NativeObservedAuthorityInspectionPort } from '../../server/browser/browserNativePrivateContract';
import type { NativeSourceCausalCap } from '../../server/browser/browserNativeSource';

const parentCanonical = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const parentDigest = (value: unknown) => createHash('sha256').update(parentCanonical(value)).digest('hex');
const sealed = <T>(metadata: Record<string, string> = {}): T => Object.freeze(Object.assign(Object.create(null), metadata)) as T;
interface ParentOwner { bindingId: string; expiresAt: number; generation: number; }
interface ParentExecution {
  cap: BrowserParentExecutionCap; owner: ParentOwner; taskId: string; taskFingerprint: string; planId: string; planFingerprint: string;
  occurrences: BrowserParentOccurrence[]; steps: Map<string, ParentStep>; generation: number; deadline: number;
  policyFingerprint: string; openedAt: number; revoked: boolean; reason?: BrowserParentClosedReason;
  aggregate?: BrowserParentAggregateCap; reserved: boolean; reservedDigest?: string;
  reservedView?: BrowserParentAggregateView; lastCompletedStep?: ParentStep;
}
interface ParentStep {
  cap: BrowserParentStepCap; execution: ParentExecution; stepId: string;
  request: import('./browserOperatorContract').ParsedBrowserWorkflowRequest; requestHash: string;
  claimed: boolean; leafClaimed: boolean; completed: boolean; uncertain: boolean;
  receipt?: BrowserOperatorReceipt; evidence?: BrowserParentEvidenceCap; evidenceDigest?: string; auditEventId?: string;
  sourceFence?: Readonly<{ isCurrent: () => boolean; dispose: () => Promise<void> }>;
}

interface NativeRetained {
  cap: RetainedBrowserRequestRef; owner: ParentOwner; ownerCap: BrowserOwnerCap; request: import('./browserOperatorContract').ParsedBrowserWorkflowRequest;
  requestHash: string; toolId: BrowserToolId; policyFingerprint: string; openedAt: number; claimed: boolean;
}
interface NativeAttempt {
  cap: AttemptRef; retained: NativeRetained; taskId: string; taskFingerprint: string; planFingerprint: string; nativeBoot: NativeBootRef;
  admittedAt: number; deadline: number; resultDeadline: number; attemptAlias: string; operationAlias: string;
  phase: 'admitted' | 'running' | 'settled' | 'revoked'; started: boolean; leafClaimed: boolean;
  source?: BrowserNativeSourceHandle; binding?: BindingRef; sourceEpochDigest?: string;
  parent?: ParentStep; pair?: NativeDomPairCap; result?: EdithToolResult; work?: Promise<EdithToolResult>;
  timer?: NodeJS.Timeout; poll?: NodeJS.Timeout; resolveBinding?: () => void; rejectBinding?: (error: Error) => void;
  bindingWaiter: Promise<void>; pairWaiter: Promise<NativeDomPairCap>; resolvePair: (pair: NativeDomPairCap) => void;
  rejectPair: (error: Error) => void; auditEventId?: string; reason?: string;
  batches: NativeBatch[]; possibleEffect: boolean;
  captureClaimed?: boolean; batchesClaimed?: boolean;
  operationLookup?: import('../../server/browser/browserNativePrivateContract').OriginalOperationLookupRef;
  resultLookup?: OriginalAttemptLookupRef;
  budget?: Readonly<{ logicalBatches: number; primaryEventCount: number; cleanupEventBudget: number; utf16Units: number; recordSlots: number; wholeResolutionLimit: 2;
    batches: readonly Readonly<{ batchRef: string; sequence: number; kind: 'replace-field' | 'fixed-return' | 'click-approved-href' | 'scroll-profile-wheel'; primaryEventCount: number; cleanupEventBudget: number; utf16Units: number }>[] }>;
  observed?: { edge: NativeSourceCausalCap; origin: BrowserNativeSourceHandle; batch: NativeBatch;
    command?: BackendConsumedCommandRef | BackendConsumedEnterCommandRef;
    association?: Readonly<{ admission?: DormantSearchSubmitAdmissionRef; successor: SearchCausalSuccessorRef | HrefCausalSuccessorRef; expiresAtMs: number }>;
    capture?: Promise<Readonly<{ source: BrowserNativeSourceHandle; postcondition: NativeSourcePostconditionCap }>>;
    successor?: BrowserNativeSourceHandle; postcondition?: NativeSourcePostconditionCap; verified: boolean };
}
interface NativeBatch {
  cap: PlannedNativeBatchRef; attempt: NativeAttempt; sourceTarget: NativeSourceTargetCap; sourceInput: NativeSourceInputCap;
  snapshot?: SnapshotRef; sourceSnapshot?: NativeSourceSnapshotCap; deadline: number;
  expectedPrimary: number; permit?: import('../../server/browser/browserNativePrivateContract').PermitRef;
  dispatch?: DispatchRef; postcondition?: NativeSourcePostconditionCap;
}
interface NativePair {
  cap: NativeDomPairCap; attempt: NativeAttempt; ledgers: readonly Readonly<NativeLedgerView>[];
  postconditions: readonly NativeSourcePostconditionCap[]; sourceDigest: string; pairDigest: string;
  consumed: boolean; nativeReceipt?: BrowserOperatorReceipt; domReceipt?: BrowserOperatorReceipt;
  facts: readonly Readonly<import('../../server/browser/browserNativeSource').NativeSourcePostconditionView>[];
}
interface NativeParentStrategies {
  cap: NativeParentStrategySetCap; execution: ParentExecution; boot: NativeBootRef; policy: string;
  fingerprint: string; pairs: Map<string, NativePair>; reserved: boolean;
  aggregate?: NativeParentAggregateCap; reservedView?: NativeParentAggregateView;
}

export interface BrowserWorkflowCapability {
  action: BrowserWorkflowRequest['action'];
  toolPath: string[];
  sideEffects: 'none' | 'browser_navigation' | 'file_read' | 'file_write' | 'form_input';
  requiresUrl: boolean;
  requiresQuery: boolean;
  requiresFilePath: boolean;
  verification: string;
  runtimeStatus: 'AVAILABLE' | 'CONFIGURATION_REQUIRED' | 'BLOCKED';
  riskLevel: EdithRiskLevel;
  requiredPermissions: string[];
  requiresApproval: boolean;
}

export class BrowserWorkflowService {
  private nativeAuthority?: NativeAuthorityPort & NativeAuthorityIdentityPort;
  private readonly nativeBackendBoot = sealed<BackendBootRef>();
  private readonly nativeBackendBootAlias = randomUUID();
  private readonly nativeOwnerAliases = new WeakMap<ParentOwner, string>();
  private readonly nativeOperationLookups = new WeakMap<object, NativeAttempt>();
  private readonly nativeRetained = new WeakMap<object, NativeRetained>();
  private readonly nativeAttempts = new WeakMap<object, NativeAttempt>();
  private readonly nativeAttemptAliases = new Map<string, NativeAttempt>();
  private readonly nativeOperationAliases = new Map<string, NativeAttempt>();
  private readonly nativeLookupCaps = new WeakMap<object, NativeAttempt>();
  private readonly nativePairs = new WeakMap<object, NativePair>();
  private readonly nativeBatchCaps = new WeakMap<object, NativeBatch>();
  private readonly nativeSnapshotCaps = new WeakMap<object, NativeBatch>();
  private readonly nativeParentStrategies = new WeakMap<object, NativeParentStrategies>();
  private readonly nativeStrategiesByExecution = new WeakMap<object, NativeParentStrategies>();
  private readonly nativeAggregateCaps = new WeakMap<object, NativeParentStrategies>();
  private readonly nativeDispatch = new AsyncLocalStorage<NativeAttempt>();
  private readonly parentOwners = new WeakMap<object, ParentOwner>();
  private readonly parentOwnerGenerations = new Map<string, number>();
  private readonly parentExecutions = new Map<string, ParentExecution>();
  private readonly parentExecutionCaps = new WeakMap<object, ParentExecution>();
  private readonly parentStepCaps = new WeakMap<object, ParentStep>();
  private readonly parentAggregateCaps = new WeakMap<object, ParentExecution>();
  private readonly parentDispatch = new AsyncLocalStorage<ParentStep>();
  private parentGeneration = 0;
  constructor() {
    onOwnerSessionInvalidated(event => {
      for (const execution of this.parentExecutions.values()) if (execution.owner.bindingId === event.bindingId) this.revokeParentExecution(execution.taskId, 'owner_lost');
      for (const attempt of this.nativeAttemptAliases.values()) if (attempt.retained.owner.bindingId === event.bindingId) this.stopNativeAttempt(attempt, 'OWNER_SESSION_REQUIRED');
    });
  }
  captureOwner(req: Request): BrowserOwnerCap {
    const actual = getOwnerSession(req);
    if (!actual || !ownerSessionBindingActive(actual.bindingId)) throw new Error('OWNER_SESSION_REQUIRED');
    let generation = this.parentOwnerGenerations.get(actual.bindingId);
    if (!generation) {
      if (this.parentOwnerGenerations.size >= 512) throw new Error('CONFIGURATION_REQUIRED');
      generation = ++this.parentGeneration; this.parentOwnerGenerations.set(actual.bindingId, generation);
    }
    const cap = sealed<BrowserOwnerCap>();
    this.parentOwners.set(cap, { bindingId: actual.bindingId, expiresAt: actual.expiresAt, generation });
    return cap;
  }
  private parentTaskFingerprint(task: EdithTask): string {
    return parentDigest({ id: task.id, createdAt: task.createdAt, objective: task.objective, originalUserRequest: task.originalUserRequest,
      normalizedIntent: task.normalizedIntent, toolsRequired: task.toolsRequired, permissionsRequired: task.permissionsRequired, validationRules: task.validationRules,
      riskLevel: task.riskLevel, dependencies: task.dependencies, deadline: task.deadline });
  }
  private parentPlanFingerprint(task: EdithTask): string {
    if (!task.plan) throw new Error('VALIDATION_ERROR');
    return parentDigest({ ...task.plan, steps: task.plan.steps.map(({ status: _status, ...definition }) => definition) });
  }
  private parentPolicy(actor: string): string {
    this.authorize(actor, 'browser_search');
    const tool = edithToolRegistry.get('browser_search')!;
    const decision = permissionService.decideToolExecution({ tool, actor: 'owner' });
    return parentDigest({ policy: permissionService.getPolicy(), grants: permissionService.listGrants().filter(grant => decision.activeGrantIds.includes(grant.id))
      .map(grant => ({ id: grant.id, expiresAt: grant.expiresAt, permissions: grant.permissions, toolIds: grant.toolIds })).sort((a, b) => a.id.localeCompare(b.id)) });
  }
  openParentExecution(owner: BrowserOwnerCap, taskId: string): BrowserParentExecutionCap {
    const actual = this.parentOwners.get(owner);
    if (!actual || Date.now() >= actual.expiresAt || !ownerSessionBindingActive(actual.bindingId)) throw new Error('OWNER_SESSION_REQUIRED');
    if (this.parentExecutions.has(taskId)) throw new Error('PARENT_EXECUTION_ALREADY_ISSUED');
    if (this.parentExecutions.size >= 256) throw new Error('CONFIGURATION_REQUIRED');
    const task = taskService.getTask(taskId);
    if (!task || isNativeBoundTask(task) || !['QUEUED', 'PLANNING'].includes(task.status) || task.plan?.status !== 'READY') throw new Error('PARENT_PRE_RUNNING_REQUIRED');
    const occurrences: BrowserParentOccurrence[] = [];
    const history = projectTaskEventsV2(task);
    if (history.diagnostics.quarantinedEventCount) throw new Error('PARENT_BUDGET_OR_HISTORY_INVALID');
    for (const step of task.plan.steps) {
      const browser = step.suggestedTools.filter(tool => (BROWSER_TOOL_IDS as readonly string[]).includes(tool));
      if (!browser.length) continue;
      if (browser.length !== 1 || browser[0] !== 'browser_search') throw new Error('UNSUPPORTED_EXISTING_PLAN_PATH');
      if (!['READY', 'PENDING'].includes(step.status)) throw new Error('PARENT_PRE_RUNNING_REQUIRED');
      occurrences.push({ stepId: step.id, toolId: 'browser_search', ordinal: occurrences.length });
    }
    if (!occurrences.length || occurrences.length > 32 || new Set(task.plan.steps.map(step => step.id)).size !== task.plan.steps.length
      || !Number.isInteger(task.plan.maxToolCalls) || task.plan.maxToolCalls < task.plan.steps.reduce((sum, step) => sum + step.suggestedTools.length, 0)
      || !Number.isInteger(task.plan.maxIterations) || task.plan.maxIterations < task.plan.steps.length
      || !Number.isFinite(task.plan.taskTimeoutMs) || task.plan.taskTimeoutMs <= 0
      || task.verification || task.recoveryEvents?.length || history.events.some(event => event.type === 'task.tool_completed'
        && (BROWSER_TOOL_IDS as readonly string[]).includes(event.payload.toolId))) throw new Error('PARENT_BUDGET_OR_HISTORY_INVALID');
    const normalized = normalizeRegisteredBrowserArgs('browser_search', { query: task.objective }, false);
    if (!normalized.success) throw new Error('VALIDATION_ERROR');
    const taskDeadline = task.deadline === undefined ? Infinity : Date.parse(task.deadline);
    if (Number.isNaN(taskDeadline) || taskDeadline <= Date.now() || task.queue?.state === 'interrupted' || task.queue?.state === 'resumable') throw new Error('PARENT_BUDGET_OR_HISTORY_INVALID');
    const policyFingerprint = this.parentPolicy(actual.bindingId), cap = sealed<BrowserParentExecutionCap>({ taskId, planId: task.plan.id });
    const now = Date.now();
    const execution: ParentExecution = { cap, owner: actual, taskId, taskFingerprint: this.parentTaskFingerprint(task), planId: task.plan.id,
      planFingerprint: this.parentPlanFingerprint(task), occurrences, steps: new Map(), generation: ++this.parentGeneration,
      deadline: Math.min(actual.expiresAt, taskDeadline, now + task.plan.taskTimeoutMs), policyFingerprint, openedAt: now, revoked: false, reserved: false };
    this.parentExecutions.set(taskId, execution); this.parentExecutionCaps.set(cap, execution);
    return cap;
  }
  private guardParent(execution: ParentExecution, running = true, committed = false): EdithTask {
    if (execution.reserved && !committed) throw new Error('PARENT_AGGREGATE_ALREADY_RESERVED');
    try {
      if (execution.revoked || Date.now() >= execution.deadline || !ownerSessionBindingActive(execution.owner.bindingId)) throw new Error('PERMISSION_DENIED');
      if (this.parentPolicy(execution.owner.bindingId) !== execution.policyFingerprint) throw new Error('PERMISSION_DENIED');
      const task = taskService.getTask(execution.taskId);
      if (!task || isNativeBoundTask(task) || (running ? task.status !== (committed ? 'COMPLETED' : 'RUNNING') : !['QUEUED', 'PLANNING', 'RUNNING'].includes(task.status))
        || task.plan?.status !== 'READY' || task.plan.id !== execution.planId || this.parentPlanFingerprint(task) !== execution.planFingerprint
        || this.parentTaskFingerprint(task) !== execution.taskFingerprint) throw new Error('TARGET_CONTEXT_CHANGED');
      const browserSteps = task.plan.steps.filter(step => execution.occurrences.some(occurrence => occurrence.stepId === step.id));
      if (projectTaskEventsV2(task).diagnostics.quarantinedEventCount) throw new Error('PARENT_BUDGET_OR_HISTORY_INVALID');
      if (browserSteps.some(step => ['FAILED', 'SKIPPED'].includes(step.status)) || task.plan.steps.some(step => step.status === 'FAILED')) throw new Error('PERMISSION_DENIED');
      const usedToolAudits = new Set(projectTaskEventsV2(task).events.filter(event => event.type === 'task.tool_completed').map(event => event.payload.runId));
      for (const step of execution.steps.values()) if (step.auditEventId) usedToolAudits.add(step.auditEventId);
      const pendingClaims = [...execution.steps.values()].filter(step => step.claimed && !step.auditEventId).length;
      if (usedToolAudits.size + pendingClaims > task.plan.maxToolCalls || task.plan.steps.filter(step => ['RUNNING', 'COMPLETED', 'FAILED', 'SKIPPED'].includes(step.status)).length > task.plan.maxIterations) throw new Error('PERMISSION_DENIED');
      return task;
    } catch (error) { this.revokeParentExecution(execution.taskId, 'task_stopped'); throw error; }
  }
  assertParentExecution(cap: BrowserParentExecutionCap, phase: 'before-running' | 'running'): void {
    const execution = this.parentExecutionCaps.get(cap);
    if (!execution || (phase !== 'before-running' && phase !== 'running')) throw new Error('VALIDATION_ERROR');
    if (phase === 'before-running' && !['QUEUED', 'PLANNING'].includes(taskService.getTask(execution.taskId)?.status ?? '')) throw new Error('PARENT_PRE_RUNNING_REQUIRED');
    this.guardParent(execution, phase === 'running');
  }
  associatePlannedSearch(cap: BrowserParentExecutionCap, stepId: string): BrowserParentStepCap {
    const execution = this.parentExecutionCaps.get(cap); if (!execution) throw new Error('VALIDATION_ERROR');
    const task = this.guardParent(execution, false);
    const source = task.plan!.steps.find(step => step.id === stepId);
    if (!source || !execution.occurrences.some(occurrence => occurrence.stepId === stepId) || !['READY', 'PENDING'].includes(source.status)) throw new Error('VALIDATION_ERROR');
    const existing = execution.steps.get(stepId); if (existing) return existing.cap;
    const normalized = normalizeRegisteredBrowserArgs('browser_search', { query: task.objective }, false);
    if (!normalized.success) throw new Error('VALIDATION_ERROR');
    const stepCap = sealed<BrowserParentStepCap>({ taskId: execution.taskId, stepId });
    const step: ParentStep = { cap: stepCap, execution, stepId, request: normalized.value, requestHash: this.requestHash(normalized.value), claimed: false, leafClaimed: false, completed: false, uncertain: false };
    execution.steps.set(stepId, step); this.parentStepCaps.set(stepCap, step); return stepCap;
  }
  private guardParentStep(step: ParentStep, requireUnclaimed = false): EdithTask {
    const task = this.guardParent(step.execution);
    const current = task.plan!.steps.find(item => item.id === step.stepId);
    if (!current || current.status !== 'RUNNING' || current.dependsOn.some(id => task.plan!.steps.find(item => item.id === id)?.status !== 'COMPLETED')
      || (requireUnclaimed && step.claimed) || step.uncertain) throw new Error('PERMISSION_DENIED');
    const ordinal = step.execution.occurrences.findIndex(occurrence => occurrence.stepId === step.stepId);
    if (step.execution.occurrences.slice(0, ordinal).some(occurrence => !step.execution.steps.get(occurrence.stepId)?.completed)) throw new Error('PARENT_SEQUENCE_INCOMPLETE');
    const normalized = normalizeRegisteredBrowserArgs('browser_search', { query: task.objective }, false);
    if (!normalized.success || this.requestHash(normalized.value) !== step.requestHash) throw new Error('TARGET_CONTEXT_CHANGED');
    return task;
  }
  resolveParentStep(cap: BrowserParentExecutionCap, stepId: string): BrowserParentStepCap {
    const execution = this.parentExecutionCaps.get(cap); if (!execution) throw new Error('VALIDATION_ERROR');
    const step = execution.steps.get(stepId); if (!step) throw new Error('VALIDATION_ERROR');
    this.guardParentStep(step, true); return step.cap;
  }
  async executeParentDom(cap: BrowserParentStepCap): Promise<BrowserParentStepResult> {
    const step = this.parentStepCaps.get(cap); if (!step) throw new Error('VALIDATION_ERROR');
    this.guardParentStep(step, true); step.claimed = true;
    const execution = step.execution;
    try {
      const result = await this.parentDispatch.run(step, () => executeEdithTool('browser_search', step.request as unknown as Record<string, unknown>,
        { actor: execution.owner.bindingId, taskId: execution.taskId, dryRun: false, authorizedPermissions: this.authorize(execution.owner.bindingId, 'browser_search') }));
      step.auditEventId = result.auditEventId;
      this.guardParentStep(step);
      const receipt = result.structuredOutput?.browser as BrowserOperatorReceipt | undefined;
      if (!result.success || !receipt || !parseBrowserOperatorReceipt(receipt).success || receipt.status !== 'verified' || receipt.nativePhysicalProof || !result.auditEventId
        || !getBrowserOperatorAdapter().verifyIssued(receipt, step.request, { actor: execution.owner.bindingId, taskId: execution.taskId }, true)) {
        step.uncertain = true; this.revokeParentExecution(execution.taskId, 'unknown_effect');
        return { taskId: execution.taskId, stepId: step.stepId, scope: 'parent-step', success: false,
          outcome: receipt?.status === 'partial' ? 'partial' : 'failed', receipt, operationId: receipt?.operationId, auditEventId: result.auditEventId, reasonCode: receipt?.reasonCode ?? 'READBACK_MISMATCH' };
      }
      const revokeSource = () => {
        if (execution.lastCompletedStep === step && ![...execution.steps.values()].some(candidate => candidate !== step && candidate.claimed && !candidate.completed)) this.revokeParentExecution(execution.taskId, 'session_closed');
      };
      step.sourceFence = await getBrowserOperatorAdapter().watchIssuedSource(receipt, step.request,
        { actor: execution.owner.bindingId, taskId: execution.taskId }, revokeSource);
      this.guardParentStep(step);
      if (!step.sourceFence.isCurrent()) throw new Error('TARGET_CONTEXT_CHANGED');
      const predecessor = execution.lastCompletedStep;
      step.receipt = receipt; step.completed = true; step.evidence = sealed<BrowserParentEvidenceCap>();
      execution.lastCompletedStep = step;
      // Prior approved steps keep historical evidence; only the latest source is current authority.
      if (predecessor?.sourceFence) void predecessor.sourceFence.dispose().catch(() => {});
      step.evidenceDigest = parentDigest({ taskId: execution.taskId, plan: execution.planFingerprint, stepId: step.stepId, requestHash: step.requestHash,
        receipt, auditEventId: result.auditEventId });
      return { taskId: execution.taskId, operationId: receipt.operationId, stepId: step.stepId, scope: 'parent-step', outcome: 'verified', success: true,
        receipt: JSON.parse(JSON.stringify(receipt)), evidence: step.evidence, auditEventId: result.auditEventId };
    } catch {
      step.uncertain = true; this.revokeParentExecution(execution.taskId, 'unknown_effect');
      const partial = step.receipt && { ...JSON.parse(JSON.stringify(step.receipt)), status: 'partial', reasonCode: 'PERMISSION_DENIED', nativePhysicalProof: false };
      return { taskId: execution.taskId, operationId: step.receipt?.operationId, stepId: step.stepId, scope: 'parent-step', outcome: 'partial', success: false,
        ...(partial && parseBrowserOperatorReceipt(partial).success ? { receipt: partial } : {}), auditEventId: step.auditEventId, reasonCode: 'PERMISSION_DENIED' };
    }
  }
  private async executeParentRegistered(step: ParentStep, request: unknown, context: EdithToolExecutionContext, toolId: BrowserToolId): Promise<EdithToolResult> {
    try {
      this.guardParentStep(step);
      if (!step.claimed || step.leafClaimed || context.actor !== step.execution.owner.bindingId || context.taskId !== step.execution.taskId
        || toolId !== 'browser_search' || this.requestHash(request) !== step.requestHash) throw new Error('PERMISSION_DENIED');
      step.leafClaimed = true;
      const receipt = await getBrowserOperatorAdapter().execute(step.request, context, () => { this.guardParentStep(step); }, () => { this.guardParent(step.execution); });
      step.receipt = receipt;
      this.guardParentStep(step);
      const parsed = parseBrowserOperatorReceipt(receipt);
      if (!parsed.success || (receipt.status === 'verified' && !getBrowserOperatorAdapter().verifyIssued(receipt, step.request, context))) throw new Error('READBACK_MISMATCH');
      return { success: receipt.status === 'verified', toolId, ...(receipt.status === 'verified' ? { result: 'Actual owned DOM postcondition verified.' } : { errorCode: 'TOOL_ERROR' as const, error: receipt.reasonCode }), structuredOutput: { browser: receipt } };
    } catch { return { success: false, toolId, errorCode: 'PERMISSION_DENIED', error: 'PERMISSION_DENIED' }; }
  }
  private parentAggregateView(execution: ParentExecution): BrowserParentAggregateView {
    const task = this.guardParent(execution);
    const steps = execution.occurrences.map(occurrence => {
      const step = execution.steps.get(occurrence.stepId), current = task.plan!.steps.find(item => item.id === occurrence.stepId);
      if (!step?.completed || step.uncertain || !step.evidence || !step.receipt || !step.evidenceDigest || !step.auditEventId
        || current?.status !== 'COMPLETED' || current.dependsOn.some(id => task.plan!.steps.find(item => item.id === id)?.status !== 'COMPLETED')) throw new Error('PARENT_EVIDENCE_INCOMPLETE');
      return { stepId: step.stepId, operationId: step.receipt.operationId, requestHash: step.requestHash, evidenceDigest: step.evidenceDigest, auditEventId: step.auditEventId };
    });
    if (task.plan!.steps.some(step => step.status === 'FAILED') || [...execution.steps.values()].some(step => step.claimed && !step.completed)) throw new Error('PARENT_EVIDENCE_INCOMPLETE');
    const last = execution.lastCompletedStep!.receipt!;
    if (!execution.lastCompletedStep!.sourceFence?.isCurrent()) throw new Error('TARGET_CONTEXT_CHANGED');
    const session = getBrowserOperatorAdapter().sessions.get(last.sessionId!, execution.owner.bindingId);
    if (session.activeDocumentIds.get(last.pageId!) !== last.after?.documentId || session.pages.get(last.pageId!)?.url() !== last.after?.url
      || session.pages.get(last.pageId!)?.isClosed() || session.generation !== last.after?.generation) throw new Error('TARGET_CONTEXT_CHANGED');
    const requiredChecks: BrowserParentRequiredCheck[] = steps.flatMap(step => [
      { id: `browser-step:${step.stepId}:postcondition`, label: 'Actual planned search predicate', required: true as const, status: 'PASS' as const, evidence: step.evidenceDigest },
      { id: `browser-step:${step.stepId}:no-native-proof`, label: 'DOM does not claim native proof', required: true as const, status: 'PASS' as const, evidence: step.operationId },
    ]);
    const base = { taskId: execution.taskId, planId: execution.planId, planFingerprint: execution.planFingerprint,
      ownerGeneration: execution.owner.generation, executionGeneration: execution.generation, expectedOccurrences: execution.occurrences,
      originalRequiredCheckSet: { taskRulesFingerprint: parentDigest(task.validationRules), planCriteriaFingerprint: parentDigest(task.plan!.validationCriteria),
        stepCriteria: task.plan!.steps.map(step => ({ stepId: step.id, criteriaFingerprint: parentDigest(step.validationCriteria) })) },
      steps, requiredChecks, commitState: 'available' as const };
    const view: BrowserParentAggregateView = { ...base, verificationDigest: parentDigest(base) };
    const copy = JSON.parse(JSON.stringify(view));
    for (const key of ['expectedOccurrences', 'steps', 'requiredChecks']) { copy[key].forEach(Object.freeze); Object.freeze(copy[key]); }
    copy.originalRequiredCheckSet.stepCriteria.forEach(Object.freeze); Object.freeze(copy.originalRequiredCheckSet.stepCriteria);
    Object.freeze(copy.originalRequiredCheckSet);
    return Object.freeze(copy);
  }
  readParentAggregate(taskId: string): BrowserParentAggregateCap | undefined {
    const execution = this.parentExecutions.get(taskId); if (!execution) return undefined;
    try {
      if (execution.reserved) this.committedParentAggregate(execution); else this.parentAggregateView(execution);
      if (!execution.aggregate) { execution.aggregate = sealed<BrowserParentAggregateCap>(); this.parentAggregateCaps.set(execution.aggregate, execution); }
      return execution.aggregate;
    } catch { return undefined; }
  }
  inspectParentAggregate(cap: BrowserParentAggregateCap): Readonly<BrowserParentAggregateView> {
    const execution = this.parentAggregateCaps.get(cap); if (!execution) throw new Error('VALIDATION_ERROR');
    return execution.reserved ? this.committedParentAggregate(execution) : this.parentAggregateView(execution);
  }
  private committedParentAggregate(execution: ParentExecution): BrowserParentAggregateView {
    // A writer failure leaves the reservation sealed. Only the matching private committed result is readable.
    const current = taskService.getTask(execution.taskId), view = execution.reservedView;
    if (current?.status !== 'COMPLETED' || !view || current.verification?.status !== 'PASS'
      || !current.verification.checks.filter(check => check.required).every(check => check.status === 'PASS')
      || !view.requiredChecks.every(expected => current.verification!.checks.some(check => check.id === expected.id && check.required && check.status === 'PASS' && check.evidence === expected.evidence))) throw new Error('PARENT_AGGREGATE_ALREADY_RESERVED');
    this.guardParent(execution, true, true);
    return Object.freeze({ ...view, commitState: 'reserved' });
  }
  consumeParentAggregate(cap: BrowserParentAggregateCap, verificationDigest: string): void {
    const execution = this.parentAggregateCaps.get(cap); if (!execution) throw new Error('VALIDATION_ERROR');
    const view = this.parentAggregateView(execution);
    if (view.verificationDigest !== verificationDigest) throw new Error('VALIDATION_ERROR');
    execution.reserved = true; execution.reservedDigest = verificationDigest; execution.reservedView = view;
  }
  revokeParentExecution(taskId: string, reason: BrowserParentClosedReason): void {
    const execution = this.parentExecutions.get(taskId); if (!execution) return;
    execution.revoked = true; execution.reason = reason;
    for (const step of execution.steps.values()) if (step.sourceFence) void step.sourceFence.dispose().catch(() => {});
  }
  private readonly attempts = new Map<string, { owner: string; toolId: BrowserToolId; requestHash: string; claimed: boolean; completed: boolean }>();
  private requestHash(request: unknown) { return createHash('sha256').update(JSON.stringify(request)).digest('hex'); }
  capabilities(): BrowserWorkflowCapability[] {
    return BROWSER_ACTIONS.map(action => ({ action, toolPath: [action === 'search' ? 'browser_search' : 'playwright_browser_agent'],
      sideEffects: action === 'fill_form' || action === 'upload_file' ? 'form_input' : action === 'download_pdf' ? 'file_write' : action === 'read_pdf' ? 'file_read' : ['title', 'extract', 'screenshot'].includes(action) ? 'none' : 'browser_navigation',
      requiresUrl: ['navigate', 'new_tab', 'download_pdf', 'read_pdf', 'upload_file'].includes(action), requiresQuery: action === 'search', requiresFilePath: action === 'upload_file',
      verification: getBrowserActionSupport(action) === 'unsupported' ? 'UNSUPPORTED_ACTION: no browser/file/input effect.' : 'Actual owned DOM action and independent readback; no native physical proof.',
      runtimeStatus: getBrowserActionSupport(action) === 'unsupported' ? 'BLOCKED' : getBrowserOperatorAdapter().availability().available ? 'AVAILABLE' : 'CONFIGURATION_REQUIRED',
      riskLevel: BROWSER_TOOL_POLICY.riskLevel, requiredPermissions: [...BROWSER_TOOL_POLICY.requiredPermissions], requiresApproval: BROWSER_TOOL_POLICY.requiresApproval,
    }));
  }
  private authorize(actor: string, toolId: BrowserToolId) {
    if (!ownerSessionBindingActive(actor)) throw new Error('OWNER_SESSION_REQUIRED');
    killSwitchService.assertAllowed('browser_control', actor); killSwitchService.assertAllowed('tool_execution', actor);
    const tool = edithToolRegistry.get(toolId); if (!tool) throw new Error('CONFIGURATION_REQUIRED');
    // Protected grants belong to the authenticated single owner; bindingId is lifecycle identity.
    const decision = permissionService.decideToolExecution({ tool, actor: 'owner' });
    if (decision.status !== 'ALLOW') throw new Error('PERMISSION_DENIED');
    return decision.authorizedPermissions;
  }
  private taskGuard(actor: string, toolId: BrowserToolId, taskId: string) {
    this.authorize(actor, toolId);
    const attempt = this.attempts.get(taskId);
    if (!attempt || attempt.owner !== actor || attempt.toolId !== toolId || attempt.completed) throw new Error('PERMISSION_DENIED');
    const task = taskService.getTask(taskId);
    if (!task || isNativeBoundTask(task) || task.status !== 'RUNNING') throw new Error('PERMISSION_DENIED');
  }
  private noEffect(request: BrowserWorkflowRequest, status: 'schema_only' | 'unsupported'): EdithToolResult {
    const browser: BrowserOperatorReceipt = { ...BROWSER_OPERATOR_CONTRACT, operationId: randomUUID(), action: request.action,
      status, ...(status === 'unsupported' ? { reasonCode: 'UNSUPPORTED_ACTION' as const } : {}), backend: 'owned_headed_playwright',
      inputProvenance: 'none', nativePhysicalProof: false, postconditions: [], artifacts: [], targetIds: [], resolveAttempts: 0, inputDispatches: 0 };
    return { success: status === 'schema_only', toolId: 'browser_workflow', ...(status === 'unsupported' ? { errorCode: 'TOOL_ERROR' as const, error: 'UNSUPPORTED_ACTION' } : { result: 'SCHEMA_ONLY' }),
      structuredOutput: { browser, verification: status === 'schema_only' ? 'SCHEMA_ONLY' : 'UNSUPPORTED_ACTION', capability: this.capabilities().find(c => c.action === request.action) } };
  }
  async run(request: unknown, actor = 'edith-browser-workflow', context: Partial<EdithToolExecutionContext> = {}): Promise<EdithToolResult> {
    return this.runWithTool(request, actor, context);
  }
  runRegistered(request: unknown, actor: string, toolId: BrowserToolId): Promise<EdithToolResult> {
    return this.runWithTool(request, actor, {}, toolId);
  }
  private async runWithTool(request: unknown, actor: string, context: Partial<EdithToolExecutionContext>, registeredToolId?: BrowserToolId): Promise<EdithToolResult> {
    const parsed = parseBrowserWorkflowRequest(request);
    if (parsed.success === false) return { success: false, toolId: 'browser_workflow', errorCode: 'VALIDATION_ERROR', error: parsed.reason };
    if (registeredToolId && (!(BROWSER_TOOL_IDS as readonly string[]).includes(registeredToolId)
      || registeredToolId === 'browser_search' && parsed.value.action !== 'search'
      || registeredToolId === 'browser_open' && parsed.value.action !== 'navigate')) return { success: false, toolId: 'browser_workflow', errorCode: 'VALIDATION_ERROR', error: 'VALIDATION_ERROR' };
    if (parsed.value.dryRun || context.dryRun) return this.noEffect(parsed.value, 'schema_only');
    if (getBrowserActionSupport(parsed.value.action) === 'unsupported') return this.noEffect(parsed.value, 'unsupported');
    const toolId: BrowserToolId = registeredToolId ?? (parsed.value.action === 'search' ? 'browser_search' : 'playwright_browser_agent');
    let taskId: string | undefined;
    try {
      const authorizedPermissions = this.authorize(actor, toolId);
      if (context.taskId) {
        const task = taskService.getTask(context.taskId);
        const attempt = this.attempts.get(context.taskId);
        if (!task || isNativeBoundTask(task) || !['QUEUED', 'PLANNING', 'RUNNING'].includes(task.status)
          || !attempt || attempt.owner !== actor || attempt.toolId !== toolId || attempt.claimed || attempt.completed || attempt.requestHash !== this.requestHash(parsed.value)) throw new Error('VALIDATION_ERROR'); taskId = task.id;
      } else taskId = taskService.createTask({ title: `Browser ${parsed.value.action}`, objective: `Verify the actual ${parsed.value.action} DOM action predicate; native physical proof is absent.`,
        originalUserRequest: parsed.value.verificationGoal, toolsRequired: [toolId], permissionsRequired: [...BROWSER_TOOL_POLICY.requiredPermissions], riskLevel: 4,
        validationRules: ['actual-owned-browser-postcondition', 'no-native-proof'] }).id;
      if (!this.attempts.has(taskId)) this.attempts.set(taskId, { owner: actor, toolId, requestHash: this.requestHash(parsed.value), claimed: false, completed: false });
      taskService.updateStatus(taskId, 'RUNNING');
      const result = await executeEdithTool(toolId, parsed.value as unknown as Record<string, unknown>, { ...context, actor, taskId, dryRun: false, authorizedPermissions });
      try { this.taskGuard(actor, toolId, taskId); }
      catch { return { ...result, success: false, errorCode: 'PERMISSION_DENIED', error: 'PERMISSION_DENIED', structuredOutput: { ...result.structuredOutput, taskId } }; }
      if (result.auditEventId) taskService.recordTimeline({ taskId, type: 'tool', actor, toolId, auditEventId: result.auditEventId, message: 'Owned browser operation returned.' });
      const browser = result.structuredOutput?.browser as BrowserOperatorReceipt | undefined;
      const receipt = parseBrowserOperatorReceipt(browser);
      const verified = result.success && receipt.success && receipt.value.status === 'verified'
        && getBrowserOperatorAdapter().verifyIssued(browser!, parsed.value, { actor, taskId }, true);
      taskService.recordVerification(taskId, { id: randomUUID(), taskId, verifier: 'heuristic-v1', checkedAt: new Date().toISOString(),
        status: verified ? 'PASS' : browser?.status === 'partial' ? 'PARTIAL' : 'FAIL', summary: verified ? 'Owned DOM postcondition verified; native physical proof is absent.' : 'Browser effect did not satisfy required verification.', retryable: false,
        checks: [{ id: 'actual-owned-browser-postcondition', label: 'Actual owned DOM readback', required: true, status: verified ? 'PASS' : 'FAIL', evidence: browser?.operationId ?? 'No verified receipt.' },
          { id: 'no-native-proof', label: 'DOM does not claim native proof', required: true, status: browser && !browser.nativePhysicalProof ? 'PASS' : 'FAIL', evidence: 'DOM API only.' }] });
      this.attempts.get(taskId)!.completed = true;
      return { ...result, structuredOutput: { ...result.structuredOutput, taskId } };
    } catch (error) {
      const code = error instanceof Error && error.message === 'VALIDATION_ERROR' ? 'VALIDATION_ERROR' : 'PERMISSION_DENIED';
      if (taskId) {
        // A late operation cannot revive or rewrite a cancelled/paused task or lost owner.
        try { this.taskGuard(actor, toolId, taskId); taskService.updateStatus(taskId, 'FAILED', 'Browser execution stopped before verified completion.'); } catch { /* Preserve current authority state. */ }
        const attempt = this.attempts.get(taskId); if (attempt) attempt.completed = true;
      }
      return { success: false, toolId: 'browser_workflow', errorCode: code, error: code, structuredOutput: taskId ? { taskId } : {} };
    } finally { if (taskId) this.attempts.delete(taskId); }
  }
  async executeRegistered(request: unknown, context: EdithToolExecutionContext, toolId: BrowserToolId): Promise<EdithToolResult> {
    const native = this.nativeDispatch.getStore();
    if (native) return this.executeNativeRegistered(native, request, context, toolId);
    const parsed = parseBrowserWorkflowRequest(request);
    if (parsed.success === false) return { success: false, toolId, errorCode: 'VALIDATION_ERROR', error: parsed.reason };
    const parent = this.parentDispatch.getStore();
    if (parent) return this.executeParentRegistered(parent, parsed.value, context, toolId);
    if (parsed.value.dryRun || context.dryRun) return { ...this.noEffect(parsed.value, 'schema_only'), toolId };
    if (getBrowserActionSupport(parsed.value.action) === 'unsupported') return { ...this.noEffect(parsed.value, 'unsupported'), toolId };
    if (!context.taskId) return this.runWithTool(parsed.value, context.actor, context, toolId);
    const taskGuard = () => {
      this.authorize(context.actor, toolId);
      this.taskGuard(context.actor, toolId, context.taskId!);
    };
    try {
      taskGuard();
      const attempt = this.attempts.get(context.taskId)!;
      if (attempt.claimed || attempt.requestHash !== this.requestHash(parsed.value)) throw new Error('PERMISSION_DENIED');
      attempt.claimed = true;
      const receipt = await getBrowserOperatorAdapter().execute(parsed.value, context, taskGuard, () => { this.authorize(context.actor, toolId); });
      try { taskGuard(); }
      catch {
        if (receipt.status === 'verified') { receipt.status = 'partial'; receipt.reasonCode = 'PERMISSION_DENIED'; }
        const checked = parseBrowserOperatorReceipt(receipt);
        return { success: false, toolId, errorCode: 'PERMISSION_DENIED', error: 'PERMISSION_DENIED', ...(checked.success ? { structuredOutput: { browser: receipt } } : {}) };
      }
      const checked = parseBrowserOperatorReceipt(receipt);
      if (checked.success === false || (receipt.status === 'verified' && !getBrowserOperatorAdapter().verifyIssued(receipt, parsed.value, context))) return { success: false, toolId, errorCode: 'TOOL_ERROR', error: 'READBACK_MISMATCH' };
      return { success: receipt.status === 'verified', toolId, ...(receipt.status === 'verified' ? { result: 'Actual owned DOM postcondition verified.' } : { errorCode: 'TOOL_ERROR' as const, error: receipt.reasonCode }), structuredOutput: { browser: receipt } };
    } catch { return { success: false, toolId, errorCode: 'PERMISSION_DENIED', error: 'PERMISSION_DENIED' }; }
  }
  /** Trusted Node composition only; no HTTP/invoke DTO may install an authority issuer. */
  configureNativeAuthority(authority: NativeAuthorityPort & NativeAuthorityIdentityPort): void {
    if (this.nativeAuthority || !authority || typeof authority.currentBoot !== 'function'
      || typeof authority.inspectIssuedDispatch !== 'function' || typeof authority.verifyIssuedBinding !== 'function'
      || typeof authority.awaitCompletion !== 'function' || typeof authority.verifyIssuedDispatch !== 'function'
      || !['genuine-native', 'simulated-native-producer'].includes(authority.evidenceKind)
      || authority.evidenceKind === 'simulated-native-producer' && process.env.EDITH_TEST_MODE !== 'true') throw new Error('CONFIGURATION_REQUIRED');
    this.nativeAuthority = authority;
  }
  private nativePolicy(owner: ParentOwner, toolId: BrowserToolId, requireNative = true): string {
    if (Date.now() >= owner.expiresAt || !ownerSessionBindingActive(owner.bindingId)) throw new Error('OWNER_SESSION_REQUIRED');
    this.authorize(owner.bindingId, toolId);
    if (requireNative) killSwitchService.assertAllowed('computer_control', owner.bindingId);
    const tools = [edithToolRegistry.get(toolId), edithToolRegistry.get('computer_action')];
    if (tools.some(tool => !tool)) throw new Error('CONFIGURATION_REQUIRED');
    const decisions = tools.map(tool => permissionService.decideToolExecution({ tool: tool!, actor: 'owner' }));
    if (requireNative && decisions.some(decision => decision.status !== 'ALLOW')) throw new Error('PERMISSION_DENIED');
    const ids = new Set(decisions.flatMap(decision => decision.activeGrantIds));
    return parentDigest({ policy: permissionService.getPolicy(), tools: tools.map(tool => ({ id: tool!.id, metadata: tool!.metadata })),
      grants: permissionService.listGrants().filter(grant => ids.has(grant.id)).sort((a, b) => a.id.localeCompare(b.id)),
      decisions: decisions.map(decision => ({ status: decision.status, authorizedPermissions: decision.authorizedPermissions })) });
  }
  retainNativeWorkflowRequest(req: Request, owner: BrowserOwnerCap): RetainedBrowserRequestRef {
    const actual = this.parentOwners.get(owner), session = getOwnerSession(req);
    if (!actual || !session || session.bindingId !== actual.bindingId || session.expiresAt !== actual.expiresAt) throw new Error('OWNER_SESSION_REQUIRED');
    const parsed = parseBrowserWorkflowRequest(req.body);
    if (!parsed.success) throw new Error('VALIDATION_ERROR');
    const request = JSON.parse(JSON.stringify(parsed.value)) as import('./browserOperatorContract').ParsedBrowserWorkflowRequest;
    if (request.fieldValues) Object.freeze(request.fieldValues); if (request.selectors) Object.freeze(request.selectors); Object.freeze(request);
    const toolId: BrowserToolId = request.action === 'search' ? 'browser_search' : 'playwright_browser_agent';
    const cap = sealed<RetainedBrowserRequestRef>();
    this.nativeRetained.set(cap, { cap, owner: actual, ownerCap: owner, request, requestHash: this.requestHash(request), toolId,
      policyFingerprint: this.nativePolicy(actual, toolId, false), openedAt: Date.now(), claimed: false });
    return cap;
  }
  private guardNativeRetained(retained: NativeRetained, native = true): void {
    if (this.requestHash(retained.request) !== retained.requestHash || this.nativePolicy(retained.owner, retained.toolId, native) !== retained.policyFingerprint) throw new Error('PERMISSION_DENIED');
  }
  selectOriginalBrowserExecution(request: RetainedBrowserRequestRef): 'existing-dom' | 'native-candidate' | 'unsupported' {
    const retained = this.nativeRetained.get(request); if (!retained) throw new Error('VALIDATION_ERROR');
    this.guardNativeRetained(retained, false);
    if (getBrowserActionSupport(retained.request.action) === 'unsupported') return 'unsupported';
    if (retained.request.dryRun || !['search', 'navigate', 'fill_form', 'scroll'].includes(retained.request.action)) return 'existing-dom';
    const authority = this.nativeAuthority;
    if (!authority?.currentBoot() || !authority.supportsStrategy(retained.request.action)
      || !getBrowserOperatorAdapter().availability().available
      || !getBrowserOperatorAdapter().canSelectNativeRequest(retained.request, retained.owner.bindingId)) return 'existing-dom';
    try { this.nativePolicy(retained.owner, retained.toolId); } catch { return 'existing-dom'; }
    return 'native-candidate';
  }
  private issueNativeAttempt(retained: NativeRetained, task: EdithTask, parent?: ParentStep): AttemptRef {
    this.guardNativeRetained(retained);
    const authority = this.nativeAuthority, boot = authority?.currentBoot();
    if (!authority || !boot || !authority.supportsStrategy(retained.request.action)
      || !getBrowserOperatorAdapter().availability().available
      || !getBrowserOperatorAdapter().canSelectNativeRequest(retained.request, retained.owner.bindingId)) throw new Error('CONFIGURATION_REQUIRED');
    if (this.nativeAttemptAliases.size >= 256) throw new Error('CONFIGURATION_REQUIRED');
    const admittedAt = Date.now(), taskDeadline = task.deadline ? Date.parse(task.deadline) : Infinity;
    if (Number.isNaN(taskDeadline)) throw new Error('VALIDATION_ERROR');
    const deadline = Math.min(admittedAt + 30000, retained.owner.expiresAt, taskDeadline, parent?.execution.deadline ?? Infinity);
    if (deadline <= admittedAt) throw new Error('DEADLINE_EXCEEDED');
    const cap = sealed<AttemptRef>();
    let resolveBinding!: () => void, rejectBinding!: (error: Error) => void;
    let resolvePair!: (pair: NativeDomPairCap) => void, rejectPair!: (error: Error) => void;
    const bindingWaiter = new Promise<void>((resolve, reject) => { resolveBinding = resolve; rejectBinding = reject; });
    const pairWaiter = new Promise<NativeDomPairCap>((resolve, reject) => { resolvePair = resolve; rejectPair = reject; });
    // Revocation may precede a waiter; retain failure without unhandled rejection.
    void bindingWaiter.catch(() => {}); void pairWaiter.catch(() => {});
    const attempt: NativeAttempt = { cap, retained, taskId: task.id, taskFingerprint: this.parentTaskFingerprint(task),
      planFingerprint: task.plan ? this.parentPlanFingerprint(task) : 'none', nativeBoot: boot,
      admittedAt, deadline, resultDeadline: Math.min(admittedAt + 300000, retained.owner.expiresAt),
      attemptAlias: randomUUID(), operationAlias: randomUUID(), phase: 'admitted', started: false, leafClaimed: false,
      parent, bindingWaiter, resolveBinding, rejectBinding, pairWaiter, resolvePair, rejectPair, batches: [], possibleEffect: false };
    this.nativeAttempts.set(cap, attempt); this.nativeAttemptAliases.set(attempt.attemptAlias, attempt); this.nativeOperationAliases.set(attempt.operationAlias, attempt);
    attempt.operationLookup = sealed<import('../../server/browser/browserNativePrivateContract').OriginalOperationLookupRef>();
    this.nativeOperationLookups.set(attempt.operationLookup, attempt);
    attempt.resultLookup = sealed<OriginalAttemptLookupRef>(); this.nativeLookupCaps.set(attempt.resultLookup, attempt);
    return cap;
  }
  openNativeOriginal(owner: BrowserOwnerCap, strictRequest: RetainedBrowserRequestRef): AttemptRef {
    const retained = this.nativeRetained.get(strictRequest), actual = this.parentOwners.get(owner);
    if (!retained || retained.claimed || !actual || actual.bindingId !== retained.owner.bindingId || actual.generation !== retained.owner.generation
      || this.selectOriginalBrowserExecution(strictRequest) !== 'native-candidate') throw new Error('VALIDATION_ERROR');
    this.guardNativeRetained(retained);
    if (this.nativeAttemptAliases.size >= 256) throw new Error('CONFIGURATION_REQUIRED');
    retained.claimed = true; // Irreversible before the sole Task writer, including writer failure.
    const task = taskService.createTask({ title: `Native browser ${retained.request.action}`, objective: retained.request.verificationGoal,
      originalUserRequest: retained.request.verificationGoal, toolsRequired: [retained.toolId],
      permissionsRequired: [...new Set([...BROWSER_TOOL_POLICY.requiredPermissions, ...edithToolRegistry.get('computer_action')!.metadata.requiredPermissions])], riskLevel: 4,
      validationRules: ['actual-owned-browser-postcondition', 'no-native-proof', 'native-counted-ledger', 'native-dom-pair'] });
    try { return this.issueNativeAttempt(retained, task); }
    catch (error) { taskService.updateStatus(task.id, 'FAILED', 'Native admission stopped before effects.'); throw error; }
  }
  private guardNativeAttempt(attempt: NativeAttempt, allowSettled = false, checkSource = true): EdithTask {
    try {
      if (attempt.phase === 'revoked' || !allowSettled && attempt.phase === 'settled' || Date.now() >= (allowSettled ? attempt.resultDeadline : attempt.deadline)) throw new Error('DEADLINE_EXCEEDED');
      this.guardNativeRetained(attempt.retained);
      if (this.nativeAuthority?.currentBoot() !== attempt.nativeBoot) throw new Error('CONFIGURATION_REQUIRED');
      const task = taskService.getTask(attempt.taskId);
      if (!task || this.parentTaskFingerprint(task) !== attempt.taskFingerprint || (task.plan ? this.parentPlanFingerprint(task) : 'none') !== attempt.planFingerprint
        || ['CANCELLED', 'WAITING_FOR_APPROVAL', 'FAILED', 'BLOCKED'].includes(task.status)) throw new Error('PERMISSION_DENIED');
      if (attempt.parent) this.guardParent(attempt.parent.execution, task.status === 'RUNNING', task.status === 'COMPLETED');
      else if (attempt.phase === 'admitted' ? !['QUEUED', 'PLANNING'].includes(task.status) : !['RUNNING', ...(allowSettled ? ['COMPLETED'] : [])].includes(task.status)) throw new Error('PERMISSION_DENIED');
      if (!allowSettled && checkSource && attempt.source) {
        const source = getBrowserOperatorAdapter().nativeSources;
        if (attempt.observed?.command && !attempt.observed.successor) source.guardObservedScope(attempt.observed.edge);
        else source.guardSource(attempt.source);
      }
      return task;
    } catch (error) { if (!allowSettled) this.stopNativeAttempt(attempt, error instanceof Error ? error.message : 'PERMISSION_DENIED'); throw error; }
  }
  private stopNativeAttempt(attempt: NativeAttempt, reason: string): void {
    if (attempt.phase === 'revoked') return;
    attempt.phase = 'revoked'; attempt.reason = reason;
    if (attempt.timer) clearTimeout(attempt.timer); if (attempt.poll) clearInterval(attempt.poll);
    attempt.rejectBinding?.(new Error(reason)); attempt.rejectPair(new Error(reason));
    if (attempt.binding) { try { this.nativeAuthority?.revoke(attempt.binding, 'explicit_revoke'); } catch { /* Never restore authority on cleanup failure. */ } }
    if (attempt.parent) { attempt.parent.uncertain = true; this.revokeParentExecution(attempt.taskId, 'unknown_effect'); }
    const task = taskService.getTask(attempt.taskId);
    if (!attempt.parent && task && ['QUEUED', 'PLANNING', 'RUNNING'].includes(task.status)) taskService.updateStatus(task.id, attempt.possibleEffect ? 'BLOCKED' : 'FAILED', 'Native operation did not establish paired verification.');
  }
  inspectNativeAttempt(cap: AttemptRef) {
    const attempt = this.nativeAttempts.get(cap); if (!attempt) throw new Error('VALIDATION_ERROR'); this.guardNativeAttempt(attempt);
    let ownerAlias = this.nativeOwnerAliases.get(attempt.retained.owner);
    if (!ownerAlias) { ownerAlias = randomUUID(); this.nativeOwnerAliases.set(attempt.retained.owner, ownerAlias); }
    return Object.freeze({ attempt: cap, backendBoot: this.nativeBackendBoot, backendBootLookupRef: this.nativeBackendBootAlias, nativeBoot: attempt.nativeBoot,
      taskId: attempt.taskId, ...(attempt.parent && { stepId: attempt.parent.stepId }), originalOwnerBinding: attempt.retained.owner.bindingId,
      originalOwnerRef: ownerAlias, originalTaskRef: attempt.taskId,
      request: attempt.retained.request, requestHash: attempt.retained.requestHash, toolId: attempt.retained.toolId,
      admittedAtMs: attempt.admittedAt, operationDeadlineMs: attempt.deadline, phase: attempt.phase,
      attemptLookupRef: attempt.attemptAlias, operationLookupRef: attempt.operationAlias });
  }
  readNativeAttemptTicket(cap: AttemptRef): NativeWorkflowPendingV1 {
    const attempt = this.nativeAttempts.get(cap); if (!attempt) throw new Error('VALIDATION_ERROR'); this.guardNativeAttempt(attempt);
    if (!attempt.started) throw new Error('VALIDATION_ERROR');
    return Object.freeze({ success: true, pending: true, version: 1, taskId: attempt.taskId, attemptLookupRef: attempt.attemptAlias,
      operationLookupRef: attempt.operationAlias, status: 'awaiting-native-confirmation', ...(attempt.parent && { stepId: attempt.parent.stepId }) });
  }
  startNativeOriginal(cap: AttemptRef): NativeWorkflowPendingV1 {
    const attempt = this.nativeAttempts.get(cap); if (!attempt || attempt.parent || attempt.started) throw new Error('VALIDATION_ERROR');
    this.guardNativeAttempt(attempt); taskService.updateStatus(attempt.taskId, 'RUNNING'); attempt.phase = 'running';
    this.startNativeWaiter(attempt); return this.readNativeAttemptTicket(cap);
  }
  private startNativeWaiter(attempt: NativeAttempt): void {
    this.guardNativeAttempt(attempt); attempt.started = true;
    attempt.timer = setTimeout(() => this.stopNativeAttempt(attempt, 'DEADLINE_EXCEEDED'), Math.max(1, attempt.deadline - Date.now())); attempt.timer.unref();
    attempt.poll = setInterval(() => { try { this.guardNativeAttempt(attempt); } catch { /* guard already terminally invalidates. */ } }, 25); attempt.poll.unref();
    attempt.work = this.runOriginalNativeLeaf(attempt.cap);
    void attempt.work.catch(() => this.stopNativeAttempt(attempt, 'EFFECT_OUTCOME_UNKNOWN'));
  }
  async runOriginalNativeLeaf(cap: AttemptRef): Promise<EdithToolResult> {
    const attempt = this.nativeAttempts.get(cap); if (!attempt || !attempt.started || attempt.work || attempt.leafClaimed) throw new Error('VALIDATION_ERROR');
    this.guardNativeAttempt(attempt);
    const result = await this.nativeDispatch.run(attempt, () => executeEdithTool(attempt.retained.toolId, attempt.retained.request as unknown as Record<string, unknown>,
      { actor: attempt.retained.owner.bindingId, taskId: attempt.taskId, dryRun: false, authorizedPermissions: this.authorize(attempt.retained.owner.bindingId, attempt.retained.toolId) }));
    attempt.auditEventId = result.auditEventId;
    if (attempt.phase === 'revoked') { attempt.result = { ...result, success: false, errorCode: 'PERMISSION_DENIED', error: 'NATIVE_ATTEMPT_REVOKED', structuredOutput: { taskId: attempt.taskId } }; return attempt.result; }
    this.guardNativeAttempt(attempt);
    if (!result.success || !result.auditEventId || !attempt.pair) { this.stopNativeAttempt(attempt, 'READBACK_MISMATCH'); return { ...result, success: false }; }
    const pair = this.nativePairs.get(attempt.pair)!;
    if (attempt.parent) return result; // Parent executor remains the sole final Task writer.
    const checks = [
      { id: 'actual-owned-browser-postcondition', label: 'Independent original DOM predicate', required: true, status: 'PASS' as const, evidence: pair.sourceDigest },
      { id: 'no-native-proof', label: 'DOM observation does not claim native proof', required: true, status: 'PASS' as const, evidence: parentDigest(pair.domReceipt) },
      { id: 'native-counted-ledger', label: 'Genuine counted native ledger', required: true, status: 'PASS' as const, evidence: parentDigest(pair.ledgers) },
      { id: 'native-dom-pair', label: 'Same-original native and DOM pair', required: true, status: 'PASS' as const, evidence: pair.pairDigest },
    ];
    this.guardNativeAttempt(attempt); pair.consumed = true;
    taskService.recordTimeline({ taskId: attempt.taskId, type: 'tool', actor: attempt.retained.owner.bindingId, toolId: attempt.retained.toolId,
      auditEventId: result.auditEventId, message: 'Original native browser leaf returned genuine paired evidence.' });
    this.guardNativeAttempt(attempt);
    taskService.recordVerification(attempt.taskId, { id: randomUUID(), taskId: attempt.taskId, verifier: 'heuristic-v1', checkedAt: new Date().toISOString(),
      status: 'PASS', summary: 'Original native ledger and independent DOM predicate verified.', retryable: false, checks });
    attempt.phase = 'settled'; attempt.result = Object.freeze({ ...result, structuredOutput: { ...result.structuredOutput, taskId: attempt.taskId } });
    if (attempt.timer) clearTimeout(attempt.timer); if (attempt.poll) clearInterval(attempt.poll);
    this.guardNativeAttempt(attempt, true, false);
    getBrowserOperatorAdapter().nativeSources.guardSource(attempt.source!);
    return attempt.result;
  }
  /** Private authority joins only its genuine binding and a genuine same-attempt source. */
  attachNativeBinding(cap: AttemptRef, authority: NativeAuthorityPort & NativeAuthorityIdentityPort, binding: BindingRef, source: BrowserNativeSourceHandle): void {
    const attempt = this.nativeAttempts.get(cap);
    if (!attempt || authority !== this.nativeAuthority || attempt.binding || !attempt.started) throw new Error('VALIDATION_ERROR');
    this.guardNativeAttempt(attempt);
    if (!authority.verifyIssuedBinding(binding, cap, this.nativeBackendBoot, attempt.nativeBoot)) throw new Error('PERMISSION_DENIED');
    const facts = getBrowserOperatorAdapter().nativeSources.inspectSource(source);
    const identity = getBrowserOperatorAdapter().nativeSources.inspectSourceIdentity(source);
    if (identity.attemptRef !== cap || identity.nativeBootRef !== attempt.nativeBoot || identity.owner !== attempt.retained.ownerCap) throw new Error('TARGET_CONTEXT_CHANGED');
    if (facts.context.actor !== attempt.retained.owner.bindingId || facts.context.taskId !== attempt.taskId
      || facts.requestHash !== this.requestHash(attempt.retained.request) || facts.deadline > attempt.deadline) throw new Error('TARGET_CONTEXT_CHANGED');
    if (authority.evidenceKind === 'genuine-native') getBrowserOperatorAdapter().nativeSources.guardNativeObservedProfile(source);
    attempt.source = source; attempt.binding = binding; attempt.sourceEpochDigest = facts.sourceEpochDigest;
    this.guardNativeAttempt(attempt); attempt.resolveBinding?.();
  }
  async captureNativeAttemptSource(cap: AttemptRef): Promise<BrowserNativeSourceHandle> {
    const attempt = this.nativeAttempts.get(cap); if (!attempt || attempt.source || attempt.captureClaimed) throw new Error('VALIDATION_ERROR'); this.guardNativeAttempt(attempt);
    const request = attempt.retained.request;
    const originalQuerySearch = request.action === 'search' && !request.sessionId && !request.pageId;
    if ((!request.sessionId || !request.pageId) && !originalQuerySearch) throw new Error('PAGE_SELECTION_REQUIRED');
    attempt.captureClaimed = true;
    const adapter = getBrowserOperatorAdapter(), scope = { owner: attempt.retained.ownerCap,
      context: { actor: attempt.retained.owner.bindingId, taskId: attempt.taskId }, request, deadline: attempt.deadline,
      nativeBootRef: attempt.nativeBoot, attemptRef: cap, guard: () => { this.guardNativeAttempt(attempt, attempt.phase === 'settled', false); } };
    try {
      const source = originalQuerySearch ? await adapter.captureNativeOriginalSource(scope)
        : await adapter.captureNativeRetainedSource({ ...scope, sessionId: request.sessionId!, pageId: request.pageId! });
      adapter.nativeSources.guardSource(source); this.guardNativeAttempt(attempt); return source;
    } catch (error) {
      this.stopNativeAttempt(attempt, error instanceof Error ? error.message : 'EFFECT_OUTCOME_UNKNOWN'); throw error;
    }
  }
  async prepareNativeAttemptBatches(cap: AttemptRef): Promise<readonly PlannedNativeBatchRef[]> {
    const attempt = this.nativeAttempts.get(cap); if (!attempt || !attempt.source || !attempt.binding || attempt.batchesClaimed) throw new Error('VALIDATION_ERROR');
    this.guardNativeAttempt(attempt);
    const source = getBrowserOperatorAdapter().nativeSources, request = attempt.retained.request;
    const count = request.action === 'fill_form' ? Object.keys(request.fieldValues!).length : 1;
    const texts = request.action === 'fill_form' ? Object.values(request.fieldValues!) : request.action === 'search' ? [request.query!] : [];
    if (count < 1 || count + (request.action === 'search' ? 1 : 0) > 10 || texts.some(text => /[\u0000-\u001f\u007f\ud800-\udfff]/.test(text))) throw new Error('UNSUPPORTED_ACTION');
    const budgetRows: NonNullable<NativeAttempt['budget']>['batches'][number][] = Array.from({ length: count }, (_, index) => ({
      batchRef: randomUUID(), sequence: index + 1, kind: texts.length ? 'replace-field' : request.action === 'navigate' ? 'click-approved-href' : 'scroll-profile-wheel',
      primaryEventCount: texts.length ? 8 + texts[index].length * 2 : request.action === 'navigate' ? 2 : 1, cleanupEventBudget: 40, utf16Units: texts[index]?.length ?? 0 }));
    if (request.action === 'search') budgetRows.push({ batchRef: randomUUID(), sequence: 2, kind: 'fixed-return', primaryEventCount: 2, cleanupEventBudget: 40, utf16Units: 0 });
    const budget = { logicalBatches: budgetRows.length, primaryEventCount: budgetRows.reduce((sum, row) => sum + row.primaryEventCount, 0),
      cleanupEventBudget: budgetRows.reduce((sum, row) => sum + row.cleanupEventBudget, 0), utf16Units: texts.reduce((sum, text) => sum + text.length, 0),
      recordSlots: budgetRows.length * 3, wholeResolutionLimit: 2 as const, batches: Object.freeze(budgetRows.map(row => Object.freeze(row))) };
    if (budget.utf16Units > 10000 || budget.primaryEventCount + budget.cleanupEventBudget > 20400 || budget.recordSlots > 32) throw new Error('VALIDATION_ERROR');
    attempt.batchesClaimed = true; attempt.budget = Object.freeze(budget);
    if (request.action === 'search' || request.action === 'navigate') this.guardNativeObservedProfile(cap);
    for (let index = 0; index < count; index++) {
      const target = await source.prepareTarget(attempt.source, request.action, index); this.guardNativeAttempt(attempt);
      const input = await source.planInput(attempt.source, target); this.guardNativeAttempt(attempt);
      const facts = source.inspectInput(input);
      if (facts.expectedPrimaryEventCount !== budgetRows[index].primaryEventCount || (facts.text?.length ?? 0) !== budgetRows[index].utf16Units) throw new Error('VALIDATION_ERROR');
      const batch: NativeBatch = { cap: sealed<PlannedNativeBatchRef>(), attempt, sourceTarget: target, sourceInput: input,
        deadline: attempt.deadline, expectedPrimary: facts.expectedPrimaryEventCount };
      this.nativeBatchCaps.set(batch.cap, batch); attempt.batches.push(batch);
    }
    if (request.action === 'search') {
      const first = attempt.batches[0], input = source.planFixedReturnInput(attempt.source, first.sourceTarget);
      const batch: NativeBatch = { cap: sealed<PlannedNativeBatchRef>(), attempt, sourceTarget: first.sourceTarget, sourceInput: input, deadline: attempt.deadline, expectedPrimary: 2 };
      this.nativeBatchCaps.set(batch.cap, batch); attempt.batches.push(batch);
      const edge = await source.prepareSearchSubmitSuccessor(attempt.source, first.sourceTarget);
      this.guardNativeAttempt(attempt); attempt.observed = { edge, origin: attempt.source, batch, verified: false };
    } else if (request.action === 'navigate') {
      const batch = attempt.batches[0], edge = await source.prepareHrefSuccessor(attempt.source, batch.sourceTarget);
      this.guardNativeAttempt(attempt); attempt.observed = { edge, origin: attempt.source, batch, verified: false };
    }
    this.guardNativeAttempt(attempt); return Object.freeze(attempt.batches.map(batch => batch.cap));
  }
  supportsNativeObservedStrategy(action: import('./core').BrowserWorkflowAction): boolean {
    const adapter = getBrowserOperatorAdapter(); return adapter.availability().available && adapter.supportsNativeObservedStrategy(action);
  }
  guardNativeObservedProfile(cap: AttemptRef): void {
    const attempt = this.nativeAttempts.get(cap); if (!attempt?.source) throw new Error('VALIDATION_ERROR');
    this.guardNativeAttempt(attempt);
    if (!this.supportsNativeObservedStrategy(attempt.retained.request.action)) throw new Error('UNSUPPORTED_ACTION');
    getBrowserOperatorAdapter().nativeSources.guardNativeObservedProfile(attempt.source);
  }
  private observedAuthority(): NativeAuthorityPort & NativeAuthorityIdentityPort & NativeObservedAuthorityInspectionPort {
    const authority = this.nativeAuthority as NativeAuthorityPort & NativeAuthorityIdentityPort & Partial<NativeObservedAuthorityInspectionPort> | undefined;
    if (!authority || authority.evidenceKind !== 'genuine-native' || typeof authority.assertIssuedObservedCommand !== 'function') throw new Error('CONFIGURATION_REQUIRED');
    return authority as NativeAuthorityPort & NativeAuthorityIdentityPort & NativeObservedAuthorityInspectionPort;
  }
  armNativeObservedCommand(scope: Readonly<{ attempt: AttemptRef; batch: PlannedNativeBatchRef;
    command: BackendConsumedCommandRef | BackendConsumedEnterCommandRef;
    replacement?: Readonly<{ dispatch: DispatchRef; postcondition: NativeSourcePostconditionCap }> }>) {
    const attempt = this.nativeAttempts.get(scope.attempt), batch = this.nativeBatchCaps.get(scope.batch), observed = attempt?.observed;
    if (!attempt || !batch || batch.attempt !== attempt || !observed || observed.batch !== batch || !batch.snapshot || !batch.permit) throw new Error('VALIDATION_ERROR');
    this.guardNativeAttempt(attempt); const authority = this.observedAuthority(); authority.assertIssuedObservedCommand(scope);
    const source = getBrowserOperatorAdapter().nativeSources;
    if (observed.association) {
      if (observed.command !== scope.command) throw new Error('TARGET_CONTEXT_CHANGED');
      if (attempt.retained.request.action === 'search'
        ? scope.replacement?.dispatch !== attempt.batches[0].dispatch || scope.replacement?.postcondition !== attempt.batches[0].postcondition
        : scope.replacement !== undefined) throw new Error('TARGET_CONTEXT_CHANGED');
      source.guardObservedScope(observed.edge); return observed.association;
    }
    this.guardNativeObservedProfile(scope.attempt);
    if (attempt.retained.request.action === 'search') {
      const first = attempt.batches[0], replacement = scope.replacement;
      if (attempt.batches.length !== 2 || first === batch || !replacement || !first.snapshot || !first.permit
        || first.sourceTarget !== batch.sourceTarget || !authority.verifyIssuedDispatch(replacement.dispatch, { attempt: attempt.cap,
          binding: attempt.binding!, backendBoot: this.nativeBackendBoot, nativeBoot: attempt.nativeBoot, snapshot: first.snapshot, batch: first.cap, permit: first.permit })
        || !source.verifyIssuedPostcondition(replacement.postcondition, observed.origin, first.sourceTarget)) throw new Error('READBACK_MISMATCH');
      this.assertNativeBatchLedger(attempt, first, replacement.dispatch);
      const facts = source.inspectPostcondition(replacement.postcondition);
      if (facts.postconditions.length !== 1 || facts.postconditions[0].kind !== 'field_value_matched' || !facts.postconditions[0].matched) throw new Error('READBACK_MISMATCH');
      first.dispatch = replacement.dispatch; first.postcondition = replacement.postcondition;
    } else if (scope.replacement || attempt.retained.request.action !== 'navigate' || attempt.batches.length !== 1) throw new Error('VALIDATION_ERROR');
    source.armPreparedObservedTransition(observed.edge, scope.command as BackendConsumedCommandRef, command => {
      if (command !== scope.command) throw new Error('TARGET_CONTEXT_CHANGED'); authority.assertIssuedObservedCommand(scope);
    });
    observed.command = scope.command;
    const expiresAtMs = source.inspectDormantArm(observed.edge).expiresAtMs;
    observed.association = Object.freeze({ ...(attempt.retained.request.action === 'search' && { admission: sealed<DormantSearchSubmitAdmissionRef>() }),
      successor: observed.edge as unknown as SearchCausalSuccessorRef | HrefCausalSuccessorRef, expiresAtMs });
    return observed.association;
  }
  async captureNativeObservedSuccessor(cap: AttemptRef): Promise<Readonly<{ source: BrowserNativeSourceHandle; postcondition: NativeSourcePostconditionCap }>> {
    const attempt = this.nativeAttempts.get(cap), observed = attempt?.observed;
    if (!attempt || !observed?.command || !observed.association) throw new Error('VALIDATION_ERROR');
    this.guardNativeAttempt(attempt);
    this.observedAuthority().assertIssuedObservedCommand({ attempt: cap, batch: observed.batch.cap, command: observed.command });
    if (!observed.capture) {
      await getBrowserOperatorAdapter().nativeSources.assertObservedSuccessorStarted(observed.edge);
      this.guardNativeAttempt(attempt);
    }
    if (!observed.capture) observed.capture = (async () => {
      const source = getBrowserOperatorAdapter().nativeSources, successor = await source.captureObservedSuccessor(observed.edge);
      this.guardNativeAttempt(attempt, false, false);
      const facts = source.inspectObservedSuccessor(observed.edge);
      if (facts.source !== successor || facts.originSourceEpochDigest !== attempt.sourceEpochDigest
        || !source.verifyIssuedPostcondition(facts.postcondition, successor, observed.batch.sourceTarget)) throw new Error('READBACK_MISMATCH');
      observed.successor = successor; observed.postcondition = facts.postcondition; attempt.source = successor;
      this.guardNativeAttempt(attempt); return Object.freeze({ source: successor, postcondition: facts.postcondition });
    })();
    const result = await observed.capture; this.guardNativeAttempt(attempt); return result;
  }
  async verifyNativeObservedOutcome(scope: Readonly<{ attempt: AttemptRef; batch: PlannedNativeBatchRef;
    command: BackendConsumedCommandRef | BackendConsumedEnterCommandRef; dispatch: DispatchRef;
    admission?: DormantSearchSubmitAdmissionRef; successor: SearchCausalSuccessorRef | HrefCausalSuccessorRef }>): Promise<NativeSourcePostconditionCap> {
    const attempt = this.nativeAttempts.get(scope.attempt), observed = attempt?.observed;
    if (!attempt || !observed?.association || observed.verified || observed.command !== scope.command || observed.batch.cap !== scope.batch
      || observed.association.admission !== scope.admission || observed.association.successor !== scope.successor || !observed.successor || !observed.postcondition) throw new Error('VALIDATION_ERROR');
    this.guardNativeAttempt(attempt); const authority = this.observedAuthority(); authority.assertIssuedObservedCommand(scope);
    const batch = observed.batch;
    if (!batch.snapshot || !batch.permit || !authority.verifyIssuedDispatch(scope.dispatch, { attempt: attempt.cap, binding: attempt.binding!,
      backendBoot: this.nativeBackendBoot, nativeBoot: attempt.nativeBoot, snapshot: batch.snapshot, batch: batch.cap, permit: batch.permit })) throw new Error('PERMISSION_DENIED');
    this.assertNativeBatchLedger(attempt, batch, scope.dispatch);
    observed.verified = true;
    const source = getBrowserOperatorAdapter().nativeSources;
    const successor = await source.sealObservedSuccessor(observed.edge, scope.dispatch, (dispatch, _args, epoch, command) => {
      if (dispatch !== scope.dispatch || command !== scope.command || epoch !== attempt.sourceEpochDigest) throw new Error('TARGET_CONTEXT_CHANGED');
      authority.assertIssuedObservedCommand(scope); this.assertNativeBatchLedger(attempt, batch, dispatch);
    });
    this.guardNativeAttempt(attempt);
    if (successor !== observed.successor || !source.verifyIssuedPostcondition(observed.postcondition, successor, batch.sourceTarget)) throw new Error('READBACK_MISMATCH');
    batch.dispatch = scope.dispatch; batch.postcondition = observed.postcondition; return observed.postcondition;
  }
  private assertNativeBatchLedger(attempt: NativeAttempt, batch: NativeBatch, dispatch: DispatchRef): Readonly<NativeLedgerView> {
    if (!batch.snapshot) throw new Error('READBACK_MISMATCH');
    const ledger = this.nativeAuthority!.inspectIssuedDispatch(dispatch, { attempt: attempt.cap, batch: batch.cap, snapshot: batch.snapshot, sourceEpochDigest: attempt.sourceEpochDigest! });
    if (!ledger) throw new Error('READBACK_MISMATCH');
    attempt.possibleEffect ||= ledger.possibleEffect || ledger.cursorEffect || ledger.focusEffect || ledger.sentEventCount > 0;
    if (ledger.result !== 'sent' || ledger.requestedEventCount !== batch.expectedPrimary || ledger.sentEventCount !== ledger.requestedEventCount
      || ledger.cleanupRequestedCount !== ledger.cleanupSentCount || ledger.claimedAtMs < attempt.admittedAt || ledger.completedAtMs > attempt.deadline
      || ledger.completedAtMs < ledger.claimedAtMs || !Number.isSafeInteger(ledger.requestedEventCount) || !Number.isSafeInteger(ledger.sentEventCount)
      || !Number.isSafeInteger(ledger.cleanupRequestedCount) || ledger.cleanupRequestedCount < 0 || ledger.cleanupRequestedCount > 40
      || !Number.isSafeInteger(ledger.cleanupSentCount) || ledger.cleanupSentCount < 0) throw new Error('EFFECT_OUTCOME_UNKNOWN');
    return ledger;
  }
  inspectNativeOperationBudget(cap: AttemptRef) {
    const attempt = this.nativeAttempts.get(cap); if (!attempt?.budget) throw new Error('VALIDATION_ERROR'); this.guardNativeAttempt(attempt);
    return attempt.budget;
  }
  inspectNativeLaunchDescriptor(source: BrowserNativeSourceHandle) { return getBrowserOperatorAdapter().nativeSources.inspectNativeLaunchDescriptor(source); }
  inspectNativeTargetDescriptor(source: BrowserNativeSourceHandle, target: NativeSourceTargetCap, snapshot: NativeSourceSnapshotCap) {
    return getBrowserOperatorAdapter().nativeSources.inspectNativeTargetDescriptor(source, target, snapshot);
  }
  async prepareFreshNativeStep(binding: BindingRef, cap: AttemptRef, batchCap: PlannedNativeBatchRef): Promise<SnapshotRef> {
    const attempt = this.nativeAttempts.get(cap), batch = this.nativeBatchCaps.get(batchCap);
    if (!attempt || !batch || batch.attempt !== attempt || !attempt.source || binding !== attempt.binding || batch.snapshot) throw new Error('VALIDATION_ERROR');
    this.guardNativeAttempt(attempt);
    const snapshot = await getBrowserOperatorAdapter().nativeSources.snapshot(attempt.source, batch.sourceTarget); this.guardNativeAttempt(attempt);
    batch.sourceSnapshot = snapshot; batch.deadline = Math.min(attempt.deadline, Date.now() + 1000); batch.snapshot = sealed<SnapshotRef>();
    this.nativeSnapshotCaps.set(batch.snapshot, batch); return batch.snapshot;
  }
  inspectNativePlannedBatch(cap: PlannedNativeBatchRef) {
    const batch = this.nativeBatchCaps.get(cap); if (!batch) throw new Error('VALIDATION_ERROR'); this.guardNativeAttempt(batch.attempt);
    if (Date.now() >= batch.deadline) throw new Error('DEADLINE_EXCEEDED');
    return Object.freeze({ attempt: batch.attempt.cap, binding: batch.attempt.binding!, nativeBoot: batch.attempt.nativeBoot,
      operationLookupRef: batch.attempt.operationAlias, sourceEpochDigest: batch.attempt.sourceEpochDigest!,
      sourceTarget: batch.sourceTarget, sourceInput: batch.sourceInput, ...(batch.snapshot && { snapshot: batch.snapshot }),
      ...(batch.sourceSnapshot && { sourceSnapshot: batch.sourceSnapshot }), expectedPrimaryEventCount: batch.expectedPrimary, expiresAtMs: batch.deadline });
  }
  registerNativeDispatchScope(cap: AttemptRef, authority: NativeAuthorityPort & NativeAuthorityIdentityPort,
    batchCap: PlannedNativeBatchRef, snapshot: SnapshotRef, permit: import('../../server/browser/browserNativePrivateContract').PermitRef): void {
    const attempt = this.nativeAttempts.get(cap), batch = this.nativeBatchCaps.get(batchCap);
    if (!attempt || authority !== this.nativeAuthority || !batch || batch.attempt !== attempt || batch.snapshot !== snapshot || batch.permit
      || !attempt.binding || !permit || Date.now() >= batch.deadline) throw new Error('VALIDATION_ERROR');
    this.guardNativeAttempt(attempt);
    if (!authority.verifyIssuedBinding(attempt.binding, cap, this.nativeBackendBoot, attempt.nativeBoot)) throw new Error('PERMISSION_DENIED');
    batch.permit = permit;
    // A consume/dispatch acknowledgement may be lost; pending genuine dispatch cannot
    // subsequently be reported as known zero effect merely because no ledger arrived.
    if (authority.evidenceKind === 'genuine-native') attempt.possibleEffect = true;
  }
  private async executeNativeRegistered(attempt: NativeAttempt, request: unknown, context: EdithToolExecutionContext, toolId: BrowserToolId): Promise<EdithToolResult> {
    try {
      this.guardNativeAttempt(attempt);
      if (!attempt.started || attempt.leafClaimed || toolId !== attempt.retained.toolId || context.taskId !== attempt.taskId
        || context.actor !== attempt.retained.owner.bindingId || this.requestHash(request) !== attempt.retained.requestHash) throw new Error('PERMISSION_DENIED');
      attempt.leafClaimed = true;
      await attempt.bindingWaiter; this.guardNativeAttempt(attempt);
      const authority = this.nativeAuthority!;
      const completion = await authority.awaitCompletion(attempt.cap, { binding: attempt.binding!, nativeBoot: attempt.nativeBoot,
        sourceEpochDigest: attempt.sourceEpochDigest!, deadline: attempt.deadline });
      this.guardNativeAttempt(attempt);
      if (authority.evidenceKind !== 'genuine-native') throw new Error('CONFIGURATION_REQUIRED');
      if (!completion || completion.dispatches.length !== attempt.batches.length || !attempt.batches.length) throw new Error('READBACK_MISMATCH');
      for (let index = 0; index < attempt.batches.length; index++) attempt.batches[index].dispatch = completion.dispatches[index];
      const pair = await this.verifyNativeAttemptPair(attempt.cap); this.guardNativeAttempt(attempt);
      const record = this.nativePairs.get(pair)!;
      // A native record and an independent DOM record are constructed separately from
      // genuine source observations; no DOM receipt is cloned with a flipped flag.
      record.nativeReceipt = this.buildNativePairReceipt(record, true); record.domReceipt = this.buildNativePairReceipt(record, false);
      attempt.pair = pair; attempt.resolvePair(pair);
      return { success: true, toolId, result: 'Original genuine native counts and independent DOM predicate verified.', structuredOutput: { browser: record.nativeReceipt } };
    } catch (error) {
      this.stopNativeAttempt(attempt, error instanceof Error ? error.message : 'EFFECT_OUTCOME_UNKNOWN');
      return { success: false, toolId, errorCode: 'TOOL_ERROR', error: 'NATIVE_PAIR_NOT_VERIFIED', structuredOutput: { taskId: attempt.taskId } };
    }
  }
  async verifyNativeAttemptPair(cap: AttemptRef): Promise<NativeDomPairCap> {
    const attempt = this.nativeAttempts.get(cap); if (!attempt || !attempt.source || !attempt.binding || !attempt.batches.length || attempt.pair || !attempt.budget || attempt.budget.logicalBatches !== attempt.batches.length) throw new Error('VALIDATION_ERROR');
    this.guardNativeAttempt(attempt);
    const authority = this.nativeAuthority!;
    if (authority.evidenceKind !== 'genuine-native' || !authority.verifyIssuedBinding(attempt.binding, cap, this.nativeBackendBoot, attempt.nativeBoot)) throw new Error('CONFIGURATION_REQUIRED');
    if (attempt.observed && !attempt.observed.verified) throw new Error('READBACK_MISMATCH');
    const source = getBrowserOperatorAdapter().nativeSources, ledgers: Readonly<NativeLedgerView>[] = [], postconditions: NativeSourcePostconditionCap[] = [];
    for (const batch of attempt.batches) {
      if (!batch.dispatch || !batch.snapshot || !batch.permit || !batch.sourceSnapshot) throw new Error('READBACK_MISMATCH');
      if (!authority.verifyIssuedDispatch(batch.dispatch, { attempt: cap, binding: attempt.binding, backendBoot: this.nativeBackendBoot,
        nativeBoot: attempt.nativeBoot, snapshot: batch.snapshot, batch: batch.cap, permit: batch.permit })) throw new Error('PERMISSION_DENIED');
      const ledger = this.assertNativeBatchLedger(attempt, batch, batch.dispatch);
      ledgers.push(Object.freeze(JSON.parse(JSON.stringify(ledger))));
      const postcondition = attempt.observed ? batch.postcondition : await source.verifyPostcondition(attempt.source, batch.sourceTarget, attempt.retained.request); this.guardNativeAttempt(attempt);
      if (!postcondition || !(attempt.observed && batch !== attempt.observed.batch
        ? source.verifyHistoricalPostcondition(postcondition, attempt.source, batch.sourceTarget)
        : source.verifyIssuedPostcondition(postcondition, attempt.source, batch.sourceTarget))) throw new Error('READBACK_MISMATCH');
      batch.postcondition = postcondition; postconditions.push(postcondition);
    }
    if (ledgers.reduce((sum, ledger) => sum + ledger.requestedEventCount + ledger.cleanupRequestedCount, 0) > 20400
      || ledgers.reduce((sum, ledger) => sum + ledger.cleanupRequestedCount, 0) > attempt.budget.cleanupEventBudget) throw new Error('EFFECT_OUTCOME_UNKNOWN');
    const facts = postconditions.map((postcondition, index) => attempt.observed && attempt.batches[index] !== attempt.observed.batch
      ? source.inspectHistoricalPostcondition(postcondition, attempt.source!) : source.inspectPostcondition(postcondition));
    this.guardNativeAttempt(attempt);
    const pairCap = sealed<NativeDomPairCap>();
    const record: NativePair = { cap: pairCap, attempt, ledgers: Object.freeze(ledgers), postconditions: Object.freeze(postconditions),
      sourceDigest: parentDigest(facts), pairDigest: parentDigest({ request: attempt.retained.requestHash, task: attempt.taskId, step: attempt.parent?.stepId,
        source: attempt.sourceEpochDigest, ledgers, facts }), consumed: false, facts: Object.freeze(facts) };
    this.nativePairs.set(pairCap, record); return pairCap;
  }
  private buildNativePairReceipt(pair: NativePair, physical: boolean): BrowserOperatorReceipt {
    const attempt = pair.attempt, source = getBrowserOperatorAdapter().nativeSources;
    this.guardNativeAttempt(attempt);
    if (this.nativeAuthority?.evidenceKind !== 'genuine-native') throw new Error('CONFIGURATION_REQUIRED');
    source.guardSource(attempt.source!); const facts = pair.facts;
    const receipt: BrowserOperatorReceipt = { schema: BROWSER_OPERATOR_CONTRACT.schema, version: BROWSER_OPERATOR_CONTRACT.version,
      operationId: attempt.operationAlias, action: attempt.retained.request.action, status: 'verified', backend: 'owned_headed_playwright',
      sessionId: facts[0].sessionId, pageId: facts[0].pageId, inputProvenance: 'native_input', nativePhysicalProof: physical,
      before: JSON.parse(JSON.stringify(facts[0].before)), after: JSON.parse(JSON.stringify(facts[facts.length - 1].after)),
      postconditions: facts.flatMap(fact => JSON.parse(JSON.stringify(fact.postconditions))), artifacts: [],
      targetIds: [...new Set(facts.map(fact => fact.targetId))], resolveAttempts: 1, inputDispatches: pair.ledgers.length };
    if (!parseBrowserOperatorReceipt(receipt).success) throw new Error('READBACK_MISMATCH'); return Object.freeze(receipt);
  }
  freezeNativeParentStrategies(cap: BrowserParentExecutionCap): NativeParentStrategySetCap {
    const execution = this.parentExecutionCaps.get(cap), boot = this.nativeAuthority?.currentBoot();
    if (!execution || !boot || !this.nativeAuthority?.supportsStrategy('search') || this.nativeStrategiesByExecution.has(cap)) throw new Error('CONFIGURATION_REQUIRED');
    if (!this.supportsNativeObservedStrategy('search')) throw new Error('CONFIGURATION_REQUIRED');
    this.assertParentExecution(cap, 'before-running');
    const originalTask = taskService.getTask(execution.taskId)!;
    const originalRequest = normalizeRegisteredBrowserArgs('browser_search', { query: originalTask.objective }, false);
    if (!originalRequest.success || !getBrowserOperatorAdapter().canSelectNativeRequest(originalRequest.value, execution.owner.bindingId)) throw new Error('CONFIGURATION_REQUIRED');
    const policy = this.nativePolicy(execution.owner, 'browser_search');
    const strategies: NativeParentStrategies = { cap: sealed<NativeParentStrategySetCap>(), execution, boot, policy,
      fingerprint: parentDigest({ plan: execution.planFingerprint, occurrences: execution.occurrences, policy }), pairs: new Map(), reserved: false };
    this.nativeParentStrategies.set(strategies.cap, strategies); this.nativeStrategiesByExecution.set(cap, strategies); return strategies.cap;
  }
  openNativeParentStep(executionCap: BrowserParentExecutionCap, stepCap: BrowserParentStepCap): AttemptRef {
    const execution = this.parentExecutionCaps.get(executionCap), step = this.parentStepCaps.get(stepCap), strategies = this.nativeStrategiesByExecution.get(executionCap);
    if (!execution || !step || step.execution !== execution || !strategies || strategies.reserved
      || this.nativeAuthority?.currentBoot() !== strategies.boot || this.nativePolicy(execution.owner, 'browser_search') !== strategies.policy) throw new Error('VALIDATION_ERROR');
    this.guardParentStep(step, true);
    const ownerCap = sealed<BrowserOwnerCap>(); this.parentOwners.set(ownerCap, execution.owner);
    const retained: NativeRetained = { cap: sealed<RetainedBrowserRequestRef>(), owner: execution.owner, ownerCap, request: step.request,
      requestHash: this.requestHash(step.request), toolId: 'browser_search', policyFingerprint: strategies.policy, openedAt: Date.now(), claimed: true };
    this.nativeRetained.set(retained.cap, retained);
    // Reserve the exact original P1 leaf before any native source/consent/effect.
    step.claimed = true;
    try { return this.issueNativeAttempt(retained, this.guardParentStep(step), step); }
    catch (error) { step.uncertain = true; this.revokeParentExecution(execution.taskId, 'unknown_effect'); throw error; }
  }
  async startNativeParentLeaf(cap: AttemptRef): Promise<NativeParentStepResult> {
    const attempt = this.nativeAttempts.get(cap); if (!attempt?.parent || attempt.started) throw new Error('VALIDATION_ERROR');
    this.guardNativeAttempt(attempt); attempt.phase = 'running'; this.startNativeWaiter(attempt);
    const result = await attempt.work!;
    if (!result.success || !attempt.pair) return { taskId: attempt.taskId, stepId: attempt.parent.stepId, scope: 'parent-step', success: false,
      outcome: attempt.possibleEffect ? 'partial' : 'failed', reasonCode: 'READBACK_MISMATCH' };
    this.guardNativeAttempt(attempt);
    return this.publishNativeParentPair(attempt.parent.execution.cap, attempt.parent.cap, attempt.pair);
  }
  publishNativeParentPair(executionCap: BrowserParentExecutionCap, stepCap: BrowserParentStepCap, pairCap: NativeDomPairCap): NativeParentStepResult {
    const execution = this.parentExecutionCaps.get(executionCap), step = this.parentStepCaps.get(stepCap), pair = this.nativePairs.get(pairCap), strategies = this.nativeStrategiesByExecution.get(executionCap);
    if (!execution || !step || !pair || !strategies || step.execution !== execution || pair.attempt.parent !== step || pair.consumed
      || strategies.reserved || !pair.nativeReceipt || !pair.domReceipt || pair.domReceipt.nativePhysicalProof || !pair.nativeReceipt.nativePhysicalProof
      || !pair.attempt.auditEventId || strategies.pairs.has(step.stepId)) throw new Error('VALIDATION_ERROR');
    this.guardParentStep(step); this.guardNativeAttempt(pair.attempt);
    pair.consumed = true; strategies.pairs.set(step.stepId, pair);
    step.completed = true; step.auditEventId = pair.attempt.auditEventId;
    // No P1 evidence cap is fabricated; existing DOM aggregate remains unable to
    // publish a native step. Separate aggregate authenticates this pair issuer.
    pair.attempt.phase = 'settled';
    if (pair.attempt.timer) clearTimeout(pair.attempt.timer); if (pair.attempt.poll) clearInterval(pair.attempt.poll);
    const evidence = sealed<NativeParentEvidenceCap>();
    pair.attempt.result = Object.freeze({ success: true, toolId: 'browser_search', auditEventId: step.auditEventId,
      structuredOutput: { taskId: execution.taskId, browser: pair.nativeReceipt, scope: 'parent-step', stepId: step.stepId } });
    return Object.freeze({ taskId: execution.taskId, stepId: step.stepId, scope: 'parent-step', success: true, outcome: 'verified',
      operationId: pair.nativeReceipt.operationId, receipt: JSON.parse(JSON.stringify(pair.nativeReceipt)), evidence, auditEventId: step.auditEventId });
  }
  readNativeParentContinuation(cap: BrowserParentExecutionCap): NativeParentPendingV1 | import('./executor').ExecuteTaskResult {
    const execution = this.parentExecutionCaps.get(cap), strategies = this.nativeStrategiesByExecution.get(cap);
    if (!execution || !strategies) throw new Error('VALIDATION_ERROR');
    const task = taskService.getTask(execution.taskId);
    this.guardParent(execution, task?.status === 'RUNNING', task?.status === 'COMPLETED');
    const pending = [...this.nativeAttemptAliases.values()].find(attempt => attempt.parent?.execution === execution && attempt.started && attempt.phase === 'running');
    if (pending) return this.readNativeAttemptTicket(pending.cap) as NativeParentPendingV1;
    if (task?.status !== 'COMPLETED' || task.verification?.status !== 'PASS' || !task.verification.checks.filter(check => check.required).every(check => check.status === 'PASS')) throw new Error('PARENT_EVIDENCE_INCOMPLETE');
    if (!strategies.reserved || this.nativeAuthority?.currentBoot() !== strategies.boot
      || this.nativePolicy(execution.owner, 'browser_search') !== strategies.policy) throw new Error('PARENT_EVIDENCE_INCOMPLETE');
    const finalOccurrence = execution.occurrences[execution.occurrences.length - 1];
    const finalPair = finalOccurrence && strategies.pairs.get(finalOccurrence.stepId);
    if (!finalPair?.consumed || !finalPair.attempt.source) throw new Error('PARENT_EVIDENCE_INCOMPLETE');
    this.guardNativeAttempt(finalPair.attempt, true, false);
    getBrowserOperatorAdapter().nativeSources.guardSource(finalPair.attempt.source);
    return { success: true, taskId: task.id, status: task.status, iterations: task.plan!.steps.length, toolCalls: task.auditEvents.length,
      reports: [], task };
  }
  private nativeAggregateView(strategies: NativeParentStrategies): NativeParentAggregateView {
    const execution = strategies.execution;
    if (strategies.reserved || this.nativeAuthority?.currentBoot() !== strategies.boot || this.nativePolicy(execution.owner, 'browser_search') !== strategies.policy) throw new Error('PARENT_AGGREGATE_ALREADY_RESERVED');
    const task = this.guardParent(execution);
    if (!task.plan?.steps.every(step => step.status === 'COMPLETED' || step.status === 'SKIPPED') || task.plan.steps.some(step => step.status === 'FAILED')) throw new Error('PARENT_EVIDENCE_INCOMPLETE');
    const requiredChecks: BrowserParentRequiredCheck[] = [], nativePairs: NativeParentAggregateView['nativePairs'][number][] = [];
    const steps = execution.occurrences.map(occurrence => {
      const step = execution.steps.get(occurrence.stepId), current = task.plan!.steps.find(item => item.id === occurrence.stepId), pair = strategies.pairs.get(occurrence.stepId);
      if (!step?.completed || step.uncertain || !step.auditEventId || current?.status !== 'COMPLETED'
        || current.dependsOn.some(id => task.plan!.steps.find(item => item.id === id)?.status !== 'COMPLETED')) throw new Error('PARENT_EVIDENCE_INCOMPLETE');
      if (!pair) throw new Error('PARENT_EVIDENCE_INCOMPLETE'); // This frozen selection is native for every original occurrence.
      if (!pair.consumed || !pair.nativeReceipt || !pair.domReceipt || pair.domReceipt.nativePhysicalProof || !pair.attempt.auditEventId) throw new Error('PARENT_EVIDENCE_INCOMPLETE');
      if (occurrence.ordinal === execution.occurrences.length - 1) getBrowserOperatorAdapter().nativeSources.guardSource(pair.attempt.source!);
      const operationId = pair.nativeReceipt.operationId;
      requiredChecks.push({ id: `browser-step:${step.stepId}:postcondition`, label: 'Actual planned search predicate', required: true, status: 'PASS', evidence: pair.sourceDigest },
        { id: `browser-step:${step.stepId}:no-native-proof`, label: 'DOM does not claim native proof', required: true, status: 'PASS', evidence: parentDigest(pair.domReceipt) },
        { id: `browser-step:${step.stepId}:native-ledger`, label: 'Genuine counted native ledger', required: true, status: 'PASS', evidence: parentDigest(pair.ledgers) },
        { id: `browser-step:${step.stepId}:native-dom-pair`, label: 'Same-original native and DOM pair', required: true, status: 'PASS', evidence: pair.pairDigest });
      nativePairs.push({ stepId: step.stepId, operationId, strategyDigest: strategies.fingerprint, pairDigest: pair.pairDigest,
        nativeLedgerDigest: parentDigest(pair.ledgers), domObservationDigest: pair.sourceDigest, auditEventId: step.auditEventId });
      return { stepId: step.stepId, operationId, requestHash: step.requestHash, evidenceDigest: pair.pairDigest, auditEventId: step.auditEventId };
    });
    const base = { taskId: execution.taskId, planId: execution.planId, planFingerprint: execution.planFingerprint,
      ownerGeneration: execution.owner.generation, executionGeneration: execution.generation, expectedOccurrences: execution.occurrences,
      originalRequiredCheckSet: { taskRulesFingerprint: parentDigest(task.validationRules), planCriteriaFingerprint: parentDigest(task.plan.validationCriteria),
        stepCriteria: task.plan.steps.map(step => ({ stepId: step.id, criteriaFingerprint: parentDigest(step.validationCriteria) })) },
      steps, requiredChecks, nativePairs, commitState: 'available' as const };
    return Object.freeze(JSON.parse(JSON.stringify({ ...base, verificationDigest: parentDigest(base) })));
  }
  readNativeParentAggregate(cap: BrowserParentExecutionCap): NativeParentAggregateCap | undefined {
    const strategies = this.nativeStrategiesByExecution.get(cap); if (!strategies) return undefined;
    try { this.nativeAggregateView(strategies); if (!strategies.aggregate) { strategies.aggregate = sealed<NativeParentAggregateCap>(); this.nativeAggregateCaps.set(strategies.aggregate, strategies); } return strategies.aggregate; }
    catch { return undefined; }
  }
  inspectNativeParentAggregate(cap: NativeParentAggregateCap): Readonly<NativeParentAggregateView> {
    const strategies = this.nativeAggregateCaps.get(cap); if (!strategies) throw new Error('VALIDATION_ERROR'); return this.nativeAggregateView(strategies);
  }
  consumeNativeParentAggregate(cap: NativeParentAggregateCap, verificationDigest: string): void {
    const strategies = this.nativeAggregateCaps.get(cap); if (!strategies) throw new Error('VALIDATION_ERROR');
    const view = this.nativeAggregateView(strategies); if (verificationDigest !== view.verificationDigest) throw new Error('VALIDATION_ERROR');
    strategies.reserved = true; strategies.reservedView = view;
    strategies.execution.reserved = true; // Existing sole writer path cannot reserve a second aggregate.
  }
  /** Private Bearer middleware authenticates its caller; these resolve, never register. */
  resolveIssuedAttemptLookup(alias: string): AttemptRef {
    const attempt = typeof alias === 'string' && this.nativeAttemptAliases.get(alias);
    if (!attempt) throw new Error('VALIDATION_ERROR'); this.guardNativeAttempt(attempt); return attempt.cap;
  }
  inspectNativeBackendBoot(): Readonly<{ backendBoot: BackendBootRef; backendBootLookupRef: string }> {
    return Object.freeze({ backendBoot: this.nativeBackendBoot, backendBootLookupRef: this.nativeBackendBootAlias });
  }
  resolveIssuedOperationLookup(alias: string): import('../../server/browser/browserNativePrivateContract').OriginalOperationLookupRef {
    const attempt = typeof alias === 'string' && this.nativeOperationAliases.get(alias);
    if (!attempt) throw new Error('VALIDATION_ERROR'); this.guardNativeAttempt(attempt);
    if (!attempt.operationLookup) throw new Error('VALIDATION_ERROR'); return attempt.operationLookup;
  }
  resolveIssuedOperationAttempt(cap: import('../../server/browser/browserNativePrivateContract').OriginalOperationLookupRef): AttemptRef {
    const attempt = this.nativeOperationLookups.get(cap); if (!attempt) throw new Error('VALIDATION_ERROR'); this.guardNativeAttempt(attempt); return attempt.cap;
  }
  guardOriginalAttempt(cap: AttemptRef): void {
    const attempt = this.nativeAttempts.get(cap); if (!attempt) throw new Error('VALIDATION_ERROR'); this.guardNativeAttempt(attempt);
  }
  guardPreparedSnapshot(snapshot: SnapshotRef, binding: BindingRef, cap: AttemptRef, batchCap: PlannedNativeBatchRef): void {
    const batch = this.nativeSnapshotCaps.get(snapshot), attempt = this.nativeAttempts.get(cap);
    if (!attempt || !batch || batch.cap !== batchCap || batch.attempt !== attempt || binding !== attempt.binding || Date.now() >= batch.deadline) throw new Error('VALIDATION_ERROR');
    this.guardNativeAttempt(attempt); getBrowserOperatorAdapter().nativeSources.inspectSnapshot(batch.sourceSnapshot!);
  }
  inspectNativeOperationState(cap: AttemptRef) {
    const attempt = this.nativeAttempts.get(cap); if (!attempt) throw new Error('VALIDATION_ERROR');
    // Terminal status remains observable without reviving expired/cancelled authority.
    const task = taskService.getTask(attempt.taskId);
    return Object.freeze({ phase: attempt.phase, started: attempt.started, taskId: attempt.taskId,
      ...(attempt.parent && { stepId: attempt.parent.stepId }), taskStatus: task?.status, paired: Boolean(attempt.pair),
      canonicalLeafSettled: Boolean(attempt.result), possibleEffect: attempt.possibleEffect, reasonCode: attempt.reason ?? 'CONFIGURATION_REQUIRED',
      operationLookupRef: attempt.operationAlias, attemptLookupRef: attempt.attemptAlias, operationDeadlineMs: attempt.deadline,
      ...(attempt.binding && { binding: attempt.binding }), ...(attempt.source && { source: attempt.source }) });
  }
  resolveNativeAttemptLookup(owner: BrowserOwnerCap, wireAlias: string): OriginalAttemptLookupRef {
    const actual = this.parentOwners.get(owner), attempt = typeof wireAlias === 'string' && this.nativeAttemptAliases.get(wireAlias);
    if (!actual || !attempt || actual.bindingId !== attempt.retained.owner.bindingId || actual.generation !== attempt.retained.owner.generation) throw new Error('VALIDATION_ERROR');
    this.guardNativeResultOwner(actual, attempt); if (!attempt.resultLookup) throw new Error('VALIDATION_ERROR'); return attempt.resultLookup;
  }
  readNativeWorkflowResult(owner: BrowserOwnerCap, lookup: OriginalAttemptLookupRef): NativeWorkflowResult {
    const actual = this.parentOwners.get(owner), attempt = this.nativeLookupCaps.get(lookup);
    if (!actual || !attempt || actual.bindingId !== attempt.retained.owner.bindingId || actual.generation !== attempt.retained.owner.generation) throw new Error('VALIDATION_ERROR');
    this.guardNativeResultOwner(actual, attempt);
    return attempt.result ? JSON.parse(JSON.stringify(attempt.result)) as EdithToolResult : this.readNativeAttemptTicket(attempt.cap);
  }
  private guardNativeResultOwner(owner: ParentOwner, attempt: NativeAttempt): void {
    if (Date.now() >= attempt.resultDeadline || Date.now() >= owner.expiresAt || !ownerSessionBindingActive(owner.bindingId)) throw new Error('PERMISSION_DENIED');
    if (!attempt.result) this.guardNativeAttempt(attempt);
    else if (attempt.result.success) {
      this.guardNativeAttempt(attempt, true);
      if (!attempt.source) throw new Error('READBACK_MISMATCH');
      getBrowserOperatorAdapter().nativeSources.guardSource(attempt.source);
    }
  }
  closeSession(id: string, actor: string) { return getBrowserOperatorAdapter().closeSession(id, actor); }
  readArtifact(id: string, actor: string) { return getBrowserOperatorAdapter().readArtifact(id, actor); }
}
export const browserWorkflowService = new BrowserWorkflowService();
