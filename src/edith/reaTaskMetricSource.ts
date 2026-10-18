import { getEdithPersistenceStore } from './persistence';
import { parseReaExecutionReceipt, parseReaPlannedCall, reaProjectionDigest } from './reaIntegrationContract';
import type { ReaExecutionReceiptV1, ReaReceiptCorrelationV1 } from './reaIntegrationContract';
import type { EdithPersistenceStore } from './persistence/types';
import type { TaskMetricSource } from './taskService';
import { hudSafeId, hudUtc } from './taskHudContracts';
import { snapshotReaJson } from './reaContract';

export interface ReaTaskMetricSourceDependencies {
  readExpected(taskId: string, auditEventId: string): ReaReceiptCorrelationV1 | undefined;
  readCommitment(taskId: string, auditEventId: string): { receiptDigest: string; finishedAt: string; receiptObservedAt: string } | undefined;
  assertAuthority(taskId: string, auditEventId: string, scope?: { stepId?: string; targetRefId?: string }): void;
  store?: EdithPersistenceStore;
}
const fail = (): never => { throw new Error('REA_METRIC_PROVENANCE_INVALID'); };
interface Cursor { taskId: string; auditId: string; receipt: ReaExecutionReceiptV1; commitment: string }

/** Server-only persisted source. The bridge supplies independent admission/current-cap authority.
 * The short synchronous cursor scopes receipt-local ordinals; JSON never becomes a live report or token. */
export function createReaTaskMetricSource(deps: ReaTaskMetricSourceDependencies): TaskMetricSource {
  const readExpected = deps.readExpected, readCommitment = deps.readCommitment, authorize = deps.assertAuthority, suppliedStore = deps.store;
  let cursor: Cursor | undefined, reading = false, invalidations = 0;
  function load(taskId: string, auditId: string): ReaExecutionReceiptV1 {
    if (reading) { invalidations++; cursor = undefined; fail(); }
    reading = true;
    const generation = invalidations;
    try {
      if (!hudSafeId(taskId) || !hudSafeId(auditId)) fail();
      authorize(taskId, auditId);
      const expected = readExpected(taskId, auditId);
      if (!expected || expected.identity.taskId !== taskId || expected.auditEventId !== auditId) fail();
      const expectedCommitment = reaProjectionDigest(expected);
      const captured = readCommitment(taskId, auditId);
      if (!captured || !/^[a-f0-9]{64}$/.test(captured.receiptDigest) || !hudUtc(captured.finishedAt)
        || !hudUtc(captured.receiptObservedAt) || Object.keys(captured).length !== 3) fail();
      const capturedCommitment = reaProjectionDigest(captured);
      const store = suppliedStore ?? getEdithPersistenceStore();
      if (!store.listToolRuns) fail();
      const tasks = store.listTasks().filter(task => task.id === taskId);
      if (tasks.length !== 1) fail();
      const task = tasks[0], plan = task.plan;
      if (!plan || plan.id !== expected.identity.planId || plan.taskId !== taskId
        || !task.artifacts.includes(`rea_receipt:${expected.toolRunId}:${auditId}`)) fail();
      const steps = plan.steps.filter(step => step.id === expected.identity.stepId);
      if (steps.length !== 1 || !steps[0].reaCall
        || reaProjectionDigest(parseReaPlannedCall(steps[0].reaCall)) !== expected.inputDigest) fail();
      const logs = store.listToolRuns(256).filter(log => log.id === expected.toolRunId);
      const audits = store.readRecentAuditEvents(256).filter(audit => audit.id === auditId);
      if (logs.length !== 1 || audits.length !== 1) fail();
      const log = logs[0], audit = audits[0];
      const args = snapshotReaJson(log.args);
      if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).length !== 2
        || !('schemaVersion' in args) || args.schemaVersion !== 1 || !('toolId' in args) || args.toolId !== 'rea_analysis') fail();
      if (log.toolId !== 'rea_analysis' || audit.taskId !== taskId || audit.toolId !== 'rea_analysis'
        || audit.action !== 'tool.execute' || audit.authorization !== 'allowed' || !['success','error'].includes(audit.result)
        || log.status !== audit.result || !hudUtc(audit.timestamp) || Date.parse(audit.timestamp) > Date.now()
        || log.timestamp !== Date.parse(captured.finishedAt) || log.timestamp > Date.parse(audit.timestamp)
        || typeof log.result !== 'string' || Buffer.byteLength(log.result, 'utf8') > 98304) fail();
      const receipt = parseReaExecutionReceipt(JSON.parse(log.result), expected);
      if (reaProjectionDigest(receipt) !== captured.receiptDigest || receipt.finishedAt !== captured.finishedAt
        || receipt.receiptObservedAt !== captured.receiptObservedAt || Date.parse(audit.timestamp) < Date.parse(receipt.receiptObservedAt)) fail();
      const success = receipt.outcome === 'completed' && receipt.cleanup.closed && !receipt.cleanup.unknownEffect;
      if (success !== (audit.result === 'success') || Date.parse(receipt.finishedAt) > Date.parse(audit.timestamp)
        || Date.parse(receipt.receiptObservedAt) > Date.now() || !receipt.report || !receipt.observedMetrics
        || receipt.report.profile !== steps[0].reaCall.args.profile
        || receipt.observedMetrics.scope.targetRefId !== receipt.selectionRef
        || receipt.evidenceIndex.some((row, index) => row.ref !== `evidence_${index + 1}`)) fail();
      const reread = readExpected(taskId, auditId);
      if (!reread || reaProjectionDigest(reread) !== expectedCommitment) fail();
      const recaptured = readCommitment(taskId, auditId);
      if (!recaptured || reaProjectionDigest(recaptured) !== capturedCommitment) fail();
      authorize(taskId, auditId, receipt.observedMetrics.scope);
      if (generation !== invalidations) fail();
      return receipt;
    } finally { reading = false; }
  }
  function readReceipt(taskId: string, auditId: string): ReturnType<TaskMetricSource['readReceipt']> {
    cursor = undefined;
    const receipt = load(taskId, auditId);
    cursor = { taskId, auditId, receipt, commitment: reaProjectionDigest(receipt) };
    return Object.freeze({ taskId, runId: auditId, toolId: 'rea_analysis', attempt: receipt.identity.attempt,
      finishedAt: receipt.finishedAt, success: receipt.outcome === 'completed', observedMetrics: receipt.observedMetrics });
  }
  function checkCursor(): Cursor | undefined {
    const pinned = cursor;
    if (!pinned) return undefined;
    try {
      const current = load(pinned.taskId, pinned.auditId);
      if (cursor !== pinned || reaProjectionDigest(current) !== pinned.commitment) fail();
      return pinned;
    } catch (error) { cursor = undefined; throw error; }
  }
  return Object.freeze({
    toolId: 'rea_analysis', rules: Object.freeze([{ name: 'rea.verified_evidence_records', unit: 'count' as const }]),
    assertAuthority(taskId: string, auditId: string, scope?: { stepId?: string; targetRefId?: string }): void {
      if (reading) { invalidations++; cursor = undefined; fail(); }
      try {
        authorize(taskId, auditId, scope);
        if (cursor && (cursor.taskId !== taskId || cursor.auditId !== auditId)) cursor = undefined;
        if (scope) {
          const pinned = checkCursor();
          if (!pinned || scope.stepId !== pinned.receipt.identity.stepId || scope.targetRefId !== pinned.receipt.selectionRef) fail();
        }
      } catch (error) { cursor = undefined; throw error; }
    },
    readReceipt,
    readEvidence(ref: string): ReturnType<TaskMetricSource['readEvidence']> {
      const pinned = checkCursor();
      if (!pinned || !pinned.receipt.evidenceIndex.some(row => row.ref === ref)) return undefined;
      return Object.freeze({ taskId: pinned.taskId, runId: pinned.auditId, toolId: 'rea_analysis', attempt: pinned.receipt.identity.attempt,
        stepId: pinned.receipt.identity.stepId, targetRefId: pinned.receipt.selectionRef });
    },
  });
}
