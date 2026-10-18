import { ReaContractError, type ReaLocalFlowContext, type ReaLocalFlowResult, type ReaTechnicalFact, type ValidatedReaEvidence } from './reaContract';
import { asRecord, checkedEvidence, checkedSummary, digestCheck, flowResult, invalid, invokeRea, reaFact, schema, type ReaCheck, type ReaRecord } from './reaAppPackageService';

const JAR = '6e5eacf500b64292bfb73c49797c1958f6ee44646e43e868039ae7feb573ff75';
const engine = schema.object({ name: schema.string(1), version: schema.nullable(schema.string()), artifact_sha256: digestCheck, source_revision: schema.nullable(schema.string()), worker_count: schema.number(1), heap_limit_mib: schema.nullable(schema.number(1)) });
const text = schema.object({ status: schema.enum(['complete', 'partial']), text: schema.string(), reported_total_bytes: schema.nullable(schema.number()) });
const method = schema.object({ name: schema.string(), reported_signature: schema.string(), overload_index: schema.number(), is_constructor: schema.boolean, dex_descriptor: schema.pattern(/^\((?:\[*(?:[ZBSCIJFD]|L[^;\x28\x29]+;))*\)(?:V|\[*(?:[ZBSCIJFD]|L[^;\x28\x29]+;))$/u) });
const packageSummary = schema.object({ engine, package_name: schema.nullable(schema.string()), version_name: schema.nullable(schema.string()), version_code: schema.nullable(schema.string()), min_sdk: schema.nullable(schema.string()), target_sdk: schema.nullable(schema.string()), permissions: schema.array(schema.string()), manifest: schema.object({ status: schema.enum(['complete', 'partial']), reported_total_bytes: schema.nullable(schema.number()), text_code_units: schema.number(), text_included: schema.literal(false) }), class_count: schema.number(), resource_count: schema.number(), signature_verification: schema.literal('not_performed') });
const classResult = schema.object({ engine, class_name: schema.string(), methods: schema.array(method), fields: schema.array(schema.object({ name: schema.string(), reported_type: schema.string() })), inner_classes: schema.array(schema.string()) });
const searchResult = schema.object({ engine, query: schema.string(), total_classes: schema.number(), matches: schema.array(schema.string()), duplicate_names: schema.array(schema.object({ name: schema.string(), occurrences: schema.number(2) })), coverage: schema.literal('complete') });
const methodResult = schema.object({ engine, class_name: schema.string(), method, overload_count: schema.number(1), representation: schema.enum(['java', 'smali']), body_status: schema.enum(['available', 'not_available']), fell_back: schema.boolean, markers: schema.array(schema.string()), source: text });
const referenceResult = schema.object({ engine, class_name: schema.string(), method_name: schema.nullable(schema.string()), overload_index: schema.nullable(schema.number()), reported_signature: schema.nullable(schema.string()), dex_descriptor: schema.nullable(schema.pattern(/^\((?:\[*(?:[ZBSCIJFD]|L[^;\x28\x29]+;))*\)(?:V|\[*(?:[ZBSCIJFD]|L[^;\x28\x29]+;))$/u)), total: schema.number(), references: schema.array(schema.object({ kind: schema.string(), name: schema.string(), reported_full_name: schema.string(), containing_class: schema.string(), top_class: schema.string(), source_line: schema.literal(null), dex_offset: schema.literal(null), direct_invokes_exhaustive: schema.nullable(schema.boolean), direct_invokes: schema.nullable(schema.array(schema.object({ dex_entry: schema.string(1), source_raw_method_id: schema.string(1), dex_code_unit_offset: schema.number(), dex_method_index: schema.number(), opcode: schema.pattern(/^INVOKE_/u) }))) })), coverage: schema.literal('complete'), reference_unit: schema.literal('using_node') });

export async function runReaAndroid(ctx: ReaLocalFlowContext): Promise<ReaLocalFlowResult> {
  ctx.assertCurrent(); const config = ctx.configuration.android;
  if (!config?.qualificationRef || config.jadxJarSha256 !== JAR || !Number.isInteger(config.javaMajor) || config.javaMajor < 17 || !config.jdkCompiler || (ctx.configuration.hostPlatform === 'win32' && (ctx.configuration.architecture !== 'x64' || !config.windowsNativeReady))) throw new ReaContractError('REA_CONFIGURATION_REQUIRED');
  if (ctx.input.profile !== 'static-apk') throw new ReaContractError('REA_INPUT_INVALID');
  const options = asRecord(ctx.input.profileOptions ?? {});
  schema.object({}, { query: schema.string(0, 256), className: schema.string(1, 256), methodName: schema.string(1, 256), overloadIndex: schema.number(), traceReferences: schema.boolean })(options);
  if ((options.methodName !== undefined && options.className === undefined) || (options.overloadIndex !== undefined && options.methodName === undefined) || (options.traceReferences === true && options.className === undefined)) throw new ReaContractError('REA_INPUT_INVALID');
  const body = await invokeRea(ctx, 'inspect_android_package', { path: ctx.targetPath, detail: 'summary' });
  const initial = checkedSummary(body, ctx, 'inspect_android_package'); packageSummary(initial.summary);
  const checkEngine = (row: ReaRecord) => { const actual = asRecord(row.engine); if (actual.artifact_sha256 !== config.jadxJarSha256 || actual.worker_count !== 1 || actual.version !== '0.7.1') invalid(); };
  checkEngine(initial.summary);
  const refs = [initial.evidence.originalEvidenceId]; const facts: ReaTechnicalFact[] = [];
  let partial = asRecord(initial.summary.manifest).status !== 'complete';
  facts.push(reaFact(initial.evidence, 'apk_classes', 'Observed APK classes', initial.summary.class_count as number, 'summary/class_count'));
  facts.push(reaFact(initial.evidence, 'apk_resources', 'Observed APK resources', initial.summary.resource_count as number, 'summary/resource_count'));
  facts.push(reaFact(initial.evidence, 'apk_permissions', 'Declared APK permissions', (initial.summary.permissions as unknown[]).length, 'summary/permissions'));
  facts.push(reaFact(initial.evidence, 'apk_signature_verified', 'APK signature verified', false, 'summary/signature_verification'));
  async function operation(name: string, args: ReaRecord, check: ReaCheck): Promise<{ row: ReaRecord; evidence: ValidatedReaEvidence }> {
    const parameters = { path: ctx.targetPath, ...args };
    const reply = await invokeRea(ctx, name, parameters);
    const evidence = checkedEvidence(reply, ctx, name); const row = asRecord(reply.normalized_result); check(row); checkEngine(row);
    // Release 6.5 records the exact parsed request, including its captured absolute path.
    schema.object(Object.fromEntries(Object.entries(parameters).map(([key, value]) => [key, schema.literal(value)])))(reply.parameters);
    const identity = asRecord(reply.provider); if (identity.id !== 'jadx' || identity.version !== '0.7.1') invalid();
    refs.push(evidence.originalEvidenceId); return { row, evidence };
  }
  if (options.query !== undefined) {
    const { row, evidence } = await operation('search_android_classes', { query: options.query }, searchResult);
    if (row.query !== options.query || (row.matches as unknown[]).length > (row.total_classes as number)) invalid();
    facts.push(reaFact(evidence, 'apk_class_matches', 'Matching class rows', (row.matches as unknown[]).length, 'matches'));
    facts.push(reaFact(evidence, 'apk_duplicate_names', 'Ambiguous duplicate class names', (row.duplicate_names as unknown[]).length, 'duplicate_names'));
  }
  if (options.className !== undefined) {
    const { row, evidence } = await operation('inspect_android_class', { class_name: options.className }, classResult);
    if (row.class_name !== options.className) invalid();
    facts.push(reaFact(evidence, 'apk_class_methods', 'Selected class method rows', (row.methods as unknown[]).length, 'methods'));
    facts.push(reaFact(evidence, 'apk_class_fields', 'Selected class field rows', (row.fields as unknown[]).length, 'fields'));
    let chosenMethod: ReaRecord | undefined;
    if (options.methodName !== undefined) {
      const choices = (row.methods as ReaRecord[]).filter(item => item.name === options.methodName);
      if (!choices.length || (choices.length > 1 && options.overloadIndex === undefined) || (options.overloadIndex !== undefined && !choices.some(item => item.overload_index === options.overloadIndex))) throw new ReaContractError('REA_SELECTOR_REQUIRED');
      chosenMethod = options.overloadIndex === undefined ? choices[0] : choices.find(item => item.overload_index === options.overloadIndex);
      const args = { class_name: options.className, method_name: options.methodName, ...(options.overloadIndex === undefined ? {} : { overload_index: options.overloadIndex }) };
      const selected = await operation('inspect_android_method', args, methodResult);
      const selectedMethod = asRecord(selected.row.method);
      if (!chosenMethod || selected.row.class_name !== options.className || selected.row.overload_count !== choices.length
        || ['name', 'reported_signature', 'overload_index', 'is_constructor', 'dex_descriptor'].some(key => selectedMethod[key] !== chosenMethod![key])) invalid();
      partial ||= asRecord(selected.row.source).status !== 'complete' || selected.row.body_status !== 'available';
      facts.push(reaFact(selected.evidence, 'apk_method_representation', 'Selected method representation', selected.row.representation as string, 'representation'));
      facts.push(reaFact(selected.evidence, 'apk_method_fallback', 'Method smali fallback used', selected.row.fell_back as boolean, 'fell_back'));
    }
    if (options.traceReferences === true) {
      const { row: traced, evidence: tracedEvidence } = await operation('trace_android_references', { class_name: options.className, ...(options.methodName === undefined ? {} : { method_name: options.methodName }), ...(options.overloadIndex === undefined ? {} : { overload_index: options.overloadIndex }) }, referenceResult);
      if (traced.class_name !== options.className || traced.method_name !== (options.methodName ?? null)
        || traced.overload_index !== (chosenMethod?.overload_index ?? null)
        || traced.reported_signature !== (chosenMethod?.reported_signature ?? null)
        || traced.dex_descriptor !== (chosenMethod?.dex_descriptor ?? null)
        || (traced.references as unknown[]).length !== traced.total) invalid();
      partial ||= (traced.references as ReaRecord[]).some(item => item.direct_invokes_exhaustive !== true);
      facts.push(reaFact(tracedEvidence, 'apk_reference_nodes', 'Observed static using nodes', traced.total as number, 'total'));
    }
  }
  ctx.assertCurrent(); return flowResult(initial.evidence, facts, partial ? 'partial' : 'complete', 'summary-view', refs);
}
