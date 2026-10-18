import { ReaContractError, snapshotReaJson, validateReaEvidence, validateReaSummaryEvidence, type ReaLocalFlowContext, type ReaLocalFlowResult, type ReaTechnicalFact, type ValidatedReaEvidence } from './reaContract';

export type ReaRecord = Record<string, unknown>;
export type ReaCheck = (value: unknown) => void;
export const invalid = (): never => { throw new ReaContractError('REA_REPLY_INVALID'); };
export const asRecord = (value: unknown): ReaRecord => { if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(); return value as ReaRecord; };
export const schema = {
  string: (min = 0, max = 1048576): ReaCheck => value => { if (typeof value !== 'string' || value.length < min || value.length > max) invalid(); },
  number: (min = 0): ReaCheck => value => { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min) invalid(); },
  boolean: ((value: unknown) => { if (typeof value !== 'boolean') invalid(); }) as ReaCheck,
  literal: (expected: unknown): ReaCheck => value => { if (value !== expected) invalid(); },
  enum: (choices: readonly unknown[]): ReaCheck => value => { if (!choices.includes(value)) invalid(); },
  nullable: (check: ReaCheck): ReaCheck => value => { if (value !== null) check(value); },
  array: (check: ReaCheck, min = 0, max = 20000): ReaCheck => value => { if (!Array.isArray(value) || value.length < min || value.length > max) invalid(); for (const item of value as unknown[]) check(item); },
  object: (required: Record<string, ReaCheck>, optional: Record<string, ReaCheck> = {}): ReaCheck => value => {
    const row = asRecord(value);
    if (Object.keys(required).some(key => !Object.hasOwn(row, key)) || Object.keys(row).some(key => !Object.hasOwn(required, key) && !Object.hasOwn(optional, key))) invalid();
    for (const [key, check] of Object.entries(required)) check(row[key]);
    for (const [key, check] of Object.entries(optional)) if (Object.hasOwn(row, key)) check(row[key]);
  },
  pattern: (pattern: RegExp): ReaCheck => value => { if (typeof value !== 'string' || !pattern.test(value)) invalid(); },
};
export const digestCheck = schema.pattern(/^[a-f0-9]{64}$/);
export const evidenceIdCheck = schema.pattern(/^ev_[a-f0-9]{64}$/);
const prefixed = (prefix: string) => schema.pattern(new RegExp('^' + prefix + '_[a-f0-9]{64}$'));
export function unwrapRea(value: unknown): ReaRecord {
  const envelope = asRecord(snapshotReaJson(value));
  schema.object({ content: schema.array(value => { const block = asRecord(value); schema.string(1, 80)(block.type); }, 0, 1024), structuredContent: asRecord }, { isError: schema.boolean, _meta: asRecord })(envelope);
  if (envelope.isError === true) throw new ReaContractError('REA_NOT_AVAILABLE');
  return asRecord(envelope.structuredContent);
}
export async function invokeRea(ctx: ReaLocalFlowContext, name: string, args: ReaRecord): Promise<ReaRecord> {
  ctx.assertCurrent(); await ctx.requireAvailable(name); ctx.assertCurrent();
  const reply = await ctx.callTool(name, args); ctx.assertCurrent(); return unwrapRea(reply);
}
export function checkedEvidence(body: ReaRecord, ctx: ReaLocalFlowContext, operation: string): ValidatedReaEvidence {
  return validateReaEvidence(body, { sha256: ctx.targetSha256, operation });
}
export function checkedSummary(body: ReaRecord, ctx: ReaLocalFlowContext, parentOperation: string): { evidence: ValidatedReaEvidence; summary: ReaRecord } {
  const evidence = validateReaSummaryEvidence(body, { sha256: ctx.targetSha256, parentOperation });
  return { evidence, summary: asRecord(asRecord(body.normalized_result).summary) };
}
export function reaFact(evidence: ValidatedReaEvidence, key: string, label: string, value: number | boolean | string, pointer: string): ReaTechnicalFact {
  return Object.freeze({ key, label, value, jsonPointer: '/normalized_result' + (pointer ? '/' + pointer : ''), evidenceId: evidence.originalEvidenceId, scope: 'producer-returned', confidence: evidence.confidence, limitation: 'Static producer observations only; runtime behavior remains unverified.' });
}
export function flowResult(evidence: ValidatedReaEvidence, facts: ReaTechnicalFact[], coverage: ReaLocalFlowResult['sourceCoverage'], kind: ReaLocalFlowResult['evidenceKind'], refs: string[] = [evidence.originalEvidenceId]): ReaLocalFlowResult {
  if (facts.length > 20 || refs.length > 50 || facts.some(fact => !fact.evidenceId || !refs.includes(fact.evidenceId))) invalid();
  return Object.freeze({ evidence, technicalFacts: Object.freeze(facts), sourceCoverage: coverage, evidenceKind: kind, evidenceRefs: Object.freeze([...new Set(refs)]) });
}
export async function withReaBinary(ctx: ReaLocalFlowContext, args: ReaRecord, expected: { kind: string; format: string }, work: () => Promise<ReaLocalFlowResult>): Promise<ReaLocalFlowResult> {
  let opened = false;
  try {
    ctx.assertCurrent(); await ctx.requireAvailable('open_binary'); ctx.assertCurrent();
    // Dispatch may complete before the post-await owner guard rejects. Retain cleanup responsibility.
    opened = true;
    const reply = await ctx.callTool('open_binary', args); ctx.assertCurrent();
    const response = unwrapRea(reply);
    schema.object({ result: schema.object({ path: schema.string(1), kind: schema.literal(expected.kind), sha256: schema.literal(ctx.targetSha256), format: schema.literal(expected.format), architecture: schema.nullable(schema.enum(['x86', 'x86_64', 'arm', 'arm64', 'mips', 'riscv', 'powerpc'])) }) })(response);
    if (asRecord(response.result).path !== ctx.targetPath) invalid();
    return await work();
  } finally {
    if (opened) {
      // Always attempt producer cleanup; failure/owner revocation cannot be reported as a clean result.
      try { const close = await invokeRea(ctx, 'close_binary', {}); schema.object({ result: schema.literal(null) })(close); }
      catch { throw new ReaContractError('REA_CLEANUP_UNKNOWN'); }
    }
  }
}

const probe = schema.object({ operation: schema.string(1), rationale: schema.string(1), authority: schema.enum(['artifact-bytes', 'managed-static-analysis', 'native-analysis-provider', 'ast-static-analysis']) });
const branch = schema.object({ branch_id: prefixed('aib'), reason: schema.enum(['format-specific-analysis-required', 'unknown-format']), detail: schema.string(1), next_probe: schema.nullable(probe), evidence_id: evidenceIdCheck });
const inspectionCoverage = schema.object({ status: schema.enum(['complete-within-substeps', 'partial', 'truncated']), substeps_completed: schema.literal(1), observations_retained: schema.number(), observations_omitted: schema.number(), hypotheses_retained: schema.number(), hypotheses_omitted: schema.number(), unexplored_branches_retained: schema.number(), unexplored_branches_omitted: schema.number(), next_probes_retained: schema.number(), next_probes_omitted: schema.number() });
const manifest = schema.object({ manifest_id: prefixed('agm'), root_artifact_id: prefixed('art'), root_sha256: digestCheck, root_format: schema.enum(['zip', 'ipa', 'apk', 'msix', 'appx', 'hap', 'hsp', 'app-pack', 'asar', 'dmg', 'pkg', 'directory']), graph_sha256: digestCheck, node_count: schema.number(1), occurrence_count: schema.number(1), edge_count: schema.number() });
const inventorySummary = schema.object({ manifest, available_counts: schema.object({ nodes: schema.number(), occurrences: schema.number(), edges: schema.number(), integrity_contradictions: schema.number() }), observed_entry_kind_counts: schema.object({ file: schema.number(), directory: schema.number(), symlink: schema.number(), slice: schema.number() }), source_complete: schema.boolean, inventory_evidence_ids: schema.array(evidenceIdCheck, 1), inspection: schema.nullable(schema.object({ coverage: inspectionCoverage, unexplored_branches: schema.array(branch) })), limitation_count: schema.number() });

export async function runReaAppPackage(ctx: ReaLocalFlowContext): Promise<ReaLocalFlowResult> {
  ctx.assertCurrent();
  const config = ctx.configuration.appPackage;
  if (!config?.qualificationRef || config.targetSha256 !== ctx.targetSha256 || !['archive', 'artifact'].includes(config.targetKind) || !config.allowedFormats.includes(config.targetFormat)) throw new ReaContractError('REA_CONFIGURATION_REQUIRED');
  if (ctx.configuration.hostPlatform === 'win32' && ['dmg', 'pkg'].includes(config.targetFormat)) throw new ReaContractError('REA_NOT_AVAILABLE');
  if (ctx.input.profile !== 'app-package' || Object.keys(ctx.input.profileOptions ?? {}).length) throw new ReaContractError('REA_INPUT_INVALID');
  return withReaBinary(ctx, { path: ctx.targetPath }, { kind: config.targetKind, format: config.targetFormat }, async () => {
    const body = await invokeRea(ctx, 'inspect_artifact', { integrity_policy: 'fail', detail: 'summary' });
    const { evidence, summary } = checkedSummary(body, ctx, 'inspect_artifact'); inventorySummary(summary);
    const root = asRecord(summary.manifest), counts = asRecord(summary.available_counts), kinds = asRecord(summary.observed_entry_kind_counts);
    if (root.root_sha256 !== ctx.targetSha256 || root.root_format !== config.targetFormat) invalid();
    for (const [available, declared] of [['nodes', 'node_count'], ['occurrences', 'occurrence_count'], ['edges', 'edge_count']]) {
      if ((counts[available!] as number) > (root[declared!] as number) || (summary.source_complete === true && counts[available!] !== root[declared!])) invalid();
    }
    const facts = ['nodes', 'occurrences', 'edges', 'integrity_contradictions'].map(key => reaFact(evidence, 'package_' + key, 'Package ' + key.replaceAll('_', ' '), counts[key] as number, 'summary/available_counts/' + key));
    facts.push(reaFact(evidence, 'package_files', 'Observed regular files', kinds.file as number, 'summary/observed_entry_kind_counts/file'));
    facts.push(reaFact(evidence, 'package_source_complete', 'Inventory source complete', summary.source_complete as boolean, 'summary/source_complete'));
    const partial = !summary.source_complete || (summary.inspection !== null && asRecord(asRecord(summary.inspection).coverage).status !== 'complete-within-substeps');
    return flowResult(evidence, facts, partial ? 'partial' : 'complete', 'summary-view');
  });
}
