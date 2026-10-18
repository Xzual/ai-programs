import { isReaSafeReport, type ReaAnalysisService, type ReaAuthority, type ReaSafeReport } from './reaAnalysisService';
import { hudPositiveInteger, hudSafeId, hudUtc, isTaskObservedMetricsV1, type TaskObservedMetricsV1 } from './taskHudContracts';

/** Trusted task composition supplies the real attempt and a live publication guard.
 * Registry owners must approve this exact producer mapping before storing the event.
 */
export function createReaTaskObservedMetrics(report: ReaSafeReport, context: {
  attempt: number; stepId?: string; targetRefId?: string; assertCurrent(): void;
}): TaskObservedMetricsV1 {
  context.assertCurrent();
  if (!isReaSafeReport(report)) throw new Error('REA_REPORT_UNTRUSTED');
  const value: TaskObservedMetricsV1 = {
    schemaVersion: 1, attempt: context.attempt, observedAt: report.observedMetrics[0].provenance.observedAt,
    clock: 'adapter_receipt', source: 'tool_result', coverage: 'partial',
    scope: { kind: 'tool_run', ...(context.stepId === undefined ? {} : { stepId: context.stepId }), ...(context.targetRefId === undefined ? {} : { targetRefId: context.targetRefId }) },
    evidenceRefs: [...report.evidenceRefs.slice(0, 8)],
    values: [{ name: 'rea.verified_evidence_records', unit: 'count', value: report.observedMetrics[0].value }],
  };
  if (!isTaskObservedMetricsV1(value, [{ name: 'rea.verified_evidence_records', unit: 'count' }])) throw new Error('REA_METRICS_INVALID');
  context.assertCurrent();
  return value;
}

/** Original live report only. Receipt clocks are captured after actual completion by trusted composition. */
export function createReaReceiptObservedMetrics(report: ReaSafeReport, context: {
  attempt: number; stepId: string; targetRefId: string; finishedAt: string; receiptObservedAt: string;
  evidenceIndex: readonly { ref: string; originalEvidenceId: string }[]; assertCurrent(): void;
}): TaskObservedMetricsV1 {
  context.assertCurrent();
  if (!isReaSafeReport(report)) throw new Error('REA_REPORT_UNTRUSTED');
  if (!hudPositiveInteger(context.attempt) || !hudSafeId(context.stepId) || !hudSafeId(context.targetRefId)
    || !hudUtc(context.finishedAt) || !hudUtc(context.receiptObservedAt)
    || Date.parse(context.receiptObservedAt) < Date.parse(context.finishedAt)
    || Date.parse(context.receiptObservedAt) > Date.now()) throw new Error('REA_METRICS_CLOCK_OR_SCOPE_INVALID');
  const originals = report.evidenceRefs;
  if (!originals.length || originals.length > 50 || new Set(originals).size !== originals.length
    || report.observedMetrics.length !== 1 || report.observedMetrics[0].key !== 'verified_evidence_records'
    || report.observedMetrics[0].value !== originals.length || context.evidenceIndex.length !== originals.length)
    throw new Error('REA_METRICS_EVIDENCE_INVALID');
  const refs = new Map<string, string>();
  const ordinals = new Set<string>();
  for (const [index, row] of context.evidenceIndex.entries()) {
    if (row.ref !== `evidence_${index + 1}` || !/^ev_[a-f0-9]{64}$/.test(row.originalEvidenceId)
      || !originals.includes(row.originalEvidenceId) || refs.has(row.originalEvidenceId) || ordinals.has(row.ref))
      throw new Error('REA_METRICS_EVIDENCE_INVALID');
    refs.set(row.originalEvidenceId, row.ref); ordinals.add(row.ref);
  }
  const value: TaskObservedMetricsV1 = {
    schemaVersion: 1, attempt: context.attempt, observedAt: context.receiptObservedAt,
    clock: 'adapter_receipt', source: 'tool_result', coverage: 'partial',
    scope: { kind: 'tool_run', stepId: context.stepId, targetRefId: context.targetRefId },
    evidenceRefs: originals.slice(0, 8).map(original => refs.get(original)!),
    values: [{ name: 'rea.verified_evidence_records', unit: 'count', value: report.observedMetrics[0].value }],
  };
  if (!isTaskObservedMetricsV1(value, [{ name: 'rea.verified_evidence_records', unit: 'count' }])) throw new Error('REA_METRICS_INVALID');
  context.assertCurrent();
  return value;
}

/** Registry/executor owners receive this adapter, never the separate admission issuer. */
export function createReaAnalysisTool(service: ReaAnalysisService) {
  return Object.freeze({
    id: 'rea_analysis' as const,
    execute: (input: unknown, authority: ReaAuthority) => service.run(input, authority),
  });
}

/** Knowledge-only report. The caller must separately authorize and map any persistence destination. */
export function renderReaKnowledgeReport(report: ReaSafeReport): string {
  if (!isReaSafeReport(report)) throw new Error('REA_REPORT_UNTRUSTED');
  return [
    '# REA analysis evidence', '', report.summary, '',
    `Profile: ${report.profile}`,
    `Original Evidence ID: ${report.originalEvidenceId}`,
    `Safe projection SHA-256: ${report.projectionDigest}`,
    `Confidence: ${report.confidence}`,
    `Reported limitations: ${report.limitationsCount}`,
    `Producer-reported source coverage: ${report.sourceCoverage}`,
    'Whole-target coverage: unverified', '',
    ...report.technicalFacts.flatMap(fact => [
      `${fact.label}: ${fact.value}`,
      `Evidence: ${fact.provenance.evidenceId} ${fact.provenance.validatedJSONPointer}; confidence: ${fact.confidence}; scope: ${fact.scope}.`,
      fact.limitation, '',
    ]),
    ...report.relationships.flatMap(row => [
      `${row.sourceId} ${row.relation} ${row.targetId}`,
      `Evidence: ${row.evidenceId} ${row.jsonPointer}; confidence: ${row.confidence}.`, row.limitation, '',
    ]),
    `Verified Evidence records: ${report.observedMetrics[0].value}. This count describes validated returned records, not target coverage.`,
    ...(report.evidenceKind === 'summary-view' ? ['The primary Evidence ID identifies a returned summary view. Linked parent bodies are not authenticated unless separately included among verified records.'] : ['The primary Evidence ID identifies the validated analysis or feature trace. Static relationships do not prove runtime execution.']),
    'Only allowlisted facts from the selected evidence are included. Target text, raw results, code, paths and credentials are excluded. This report grants no execution authority.', '',
  ].join('\n');
}
