import { ReaContractError, parseReaAnalysisInput, reaFeatureToolQuery, snapshotReaJson, validateReaEvidence, validateReaFeatureEvidence, type ReaLocalFlowContext, type ReaLocalFlowResult } from './reaContract';

const object = (value: unknown): Record<string, any> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ReaContractError('REA_FEATURE_REPLY_INVALID');
  return value as Record<string, any>;
};
/** The parent owns all process/session/target lifecycle. This flow only composes guarded tools. */
export async function runReaFeatureTrace(context: ReaLocalFlowContext): Promise<ReaLocalFlowResult> {
  context.assertCurrent();
  const input = parseReaAnalysisInput(context.input), query = input.featureQuery;
  if (!query) throw new ReaContractError('REA_FEATURE_QUERY_REQUIRED');
  if (!['static-javascript', 'static-managed'].includes(input.profile)) throw new ReaContractError('REA_FEATURE_QUERY_UNSUPPORTED');
  const refs: string[] = [];
  const call = async (name: string, args: Readonly<Record<string, unknown>>) => {
    context.assertCurrent(); await context.requireAvailable(name); context.assertCurrent();
    const wire = await context.callTool(name, args); context.assertCurrent();
    const envelope = object(snapshotReaJson(wire));
    if (envelope.isError === true || !Array.isArray(envelope.content) || !envelope.structuredContent) throw new ReaContractError('REA_FEATURE_REPLY_INVALID');
    return object(envelope.structuredContent);
  };
  const authenticate = (evidence: unknown, operation: string) => {
    const validated = validateReaEvidence(evidence, { sha256: context.targetSha256, operation });
    refs.push(validated.originalEvidenceId); return object(evidence);
  };
  let source: Record<string, any>;
  if (input.profile === 'static-javascript') {
    source = authenticate(await call('analyze_javascript_application', { input_path: context.targetPath, format: 'auto', integrity_policy: 'fail', detail: 'complete' }), 'analyze_javascript_application');
    context.assertCurrent();
    if (object(source.normalized_result).input_path !== context.targetPath || object(source.subject).local_path !== context.targetPath) throw new ReaContractError('REA_FEATURE_SOURCE_INVALID');
  } else {
    if (query.kind !== 'application-feature') throw new ReaContractError('REA_FEATURE_QUERY_UNSUPPORTED');
    const artifact = authenticate(await call('inspect_managed_artifact', { path: context.targetPath, detail: 'complete' }), 'inspect_managed_artifact');
    const members = authenticate(await call('inspect_managed_members', { path: context.targetPath, detail: 'complete', ...(query.managedTypeNames === undefined ? {} : { type_names: [...query.managedTypeNames] }) }), 'inspect_managed_members');
    context.assertCurrent();
    for (const record of [artifact, members]) if (object(record.subject).local_path !== context.targetPath || object(object(record.normalized_result).artifact).sha256 !== context.targetSha256) throw new ReaContractError('REA_FEATURE_SOURCE_INVALID');
    const left = object(artifact.normalized_result).module?.mvid, right = object(members.normalized_result).module?.mvid;
    if (left != null && right != null && (typeof left !== 'string' || typeof right !== 'string' || left.toLowerCase() !== right.toLowerCase())) throw new ReaContractError('REA_FEATURE_SOURCE_INVALID');
    source = authenticate(await call('project_managed_application_graph', { managed_artifact: artifact, managed_members: members }), 'project_managed_application_graph');
    const bindings = object(object(source.normalized_result).source_evidence);
    if (bindings.managed_artifact_evidence_id !== artifact.evidence_id || bindings.managed_members_evidence_id !== members.evidence_id || bindings.managed_native_boundaries_evidence_id !== null) throw new ReaContractError('REA_FEATURE_SOURCE_INVALID');
  }
  context.assertCurrent();
  const name = query.kind === 'application-feature' ? 'trace_application_feature' : 'trace_javascript_semantics';
  const traced = await call(name, { application: source, ...(query.kind === 'application-feature' ? { native_observations: [] } : {}), ...reaFeatureToolQuery(query) });
  context.assertCurrent();
  const projected = validateReaFeatureEvidence(traced, { sha256: context.targetSha256, sourceEvidence: source, featureQuery: query });
  const evidenceRefs = [...new Set([...refs, ...projected.evidenceRefs])];
  if (evidenceRefs.length > 50 || projected.technicalFacts.length + (projected.relationships?.length ?? 0) > 20) throw new ReaContractError('REA_PROJECTION_LIMIT');
  context.assertCurrent();
  return Object.freeze({ ...projected, evidenceRefs: Object.freeze(evidenceRefs) });
}
