import { ReaContractError, type ReaLocalFlowContext, type ReaLocalFlowResult, type ReaTechnicalFact, type ValidatedReaEvidence } from './reaContract';
import { asRecord, checkedEvidence, checkedSummary, flowResult, invalid, invokeRea, reaFact, schema as s, withReaBinary, type ReaCheck, type ReaRecord } from './reaAppPackageService';

const str = s.string(), nonempty = s.string(1), num = s.number(), integer = s.number(Number.MIN_SAFE_INTEGER), bool = s.boolean;
const strings = s.array(str), reason = s.object({ available: s.literal(false), reason: str });
const eitherAvailability = (available: ReaCheck, unavailable: ReaCheck = reason): ReaCheck => value => (asRecord(value).available === true ? available : unavailable)(value);
const range = s.object({ start: str, end: str });
const body: ReaCheck = value => {
  const row = asRecord(value);
  if (row.available !== true) { reason(value); return; }
  s.object({ available: s.literal(true), provenance: nonempty, ranges: s.array(range), total_bytes: num, span_bytes: s.nullable(num), non_contiguous: bool, contains_entry: bool })(value);
  const parsed = (row.ranges as ReaRecord[]).map(item => {
    const a = /^(?:(.+):)?0x([0-9a-f]+)$/.exec(item.start as string), b = /^(?:(.+):)?0x([0-9a-f]+)$/.exec(item.end as string);
    if (!a || !b || a[1] !== b[1] || BigInt('0x' + a[2]) > BigInt('0x' + b[2])) invalid();
    return { space: a![1] ?? '', start: BigInt('0x' + a![2]), end: BigInt('0x' + b![2]) };
  });
  let total = 0n, previousSpace: string | undefined;
  const bounds = new Map<string, { start: bigint; end: bigint }>(), closedSpaces = new Set<string>();
  for (const current of parsed) {
    total += current.end - current.start + 1n;
    if (previousSpace !== undefined && previousSpace !== current.space) closedSpaces.add(previousSpace);
    const prior = bounds.get(current.space);
    if (closedSpaces.has(current.space) || (prior && current.start <= prior.end + 1n)) invalid();
    bounds.set(current.space, { start: prior?.start ?? current.start, end: current.end }); previousSpace = current.space;
  }
  const onlyBounds = bounds.size === 1 ? [...bounds.values()][0] : undefined;
  const span = bounds.size === 0 ? 0n : onlyBounds ? onlyBounds.end - onlyBounds.start + 1n : null;
  if (total !== BigInt(row.total_bytes as number) || span !== (row.span_bytes === null ? null : BigInt(row.span_bytes as number)) || row.non_contiguous !== (parsed.length > 1)) invalid();
};
const classification = s.object({ external: bool, thunk: bool, thunk_target: s.nullable(str), provenance: nonempty });
const entryAgrees = (value: unknown) => {
  const row = asRecord(value), observed = asRecord(row.body); if (observed.available !== true) return;
  const entry = /^(?:(.+):)?0x([0-9a-f]+)$/.exec(row.address as string); if (!entry) invalid();
  const space = entry![1] ?? '', offset = BigInt('0x' + entry![2]);
  const contains = (observed.ranges as ReaRecord[]).some(item => {
    const start = /^(?:(.+):)?0x([0-9a-f]+)$/.exec(item.start as string)!, end = /^(?:(.+):)?0x([0-9a-f]+)$/.exec(item.end as string)!;
    return (start[1] ?? '') === space && offset >= BigInt('0x' + start[2]) && offset <= BigInt('0x' + end[2]);
  });
  if (contains !== observed.contains_entry) invalid();
};
const identity: ReaCheck = value => { s.object({ address: str, name: str, classification: s.nullable(classification), body })(value); entryAgrees(value); };
const local = s.object({ description: str, provenance: nonempty }, { name: s.nullable(str), stack_displacement: s.nullable(s.pattern(/^-?\d+$/)) });
const procedure: ReaCheck = value => { s.object({ address: str, name: str, classification: s.nullable(classification), body, signature: s.nullable(str), locals: s.array(local) })(value); entryAgrees(value); };
const kindFields: Record<string, ReaCheck> = { available: s.literal(true), provenance: nonempty, type: str, operand_index: integer };
for (const key of ['flow', 'call', 'jump', 'data', 'read', 'write', 'indirect', 'computed', 'conditional', 'terminal', 'primary', 'external']) kindFields[key] = bool;
const reference = s.object({ source_address: str, target_address: str, source_procedure: s.nullable(identity), target_procedure: s.nullable(identity), kind: eitherAvailability(s.object(kindFields)) }, { call: s.object({ classification: s.enum(['none', 'unknown', 'direct', 'objective_c']), provider_type: integer, provenance: nonempty }) });
const stringItem = s.object({ address: str, value: str, source_address: str }, { provider_value: str, decoding: reason, string: s.object({ encoding: nonempty, termination: s.enum(['missing', 'present_or_not_required']), byte_length: num }, { encoding_status: s.enum(['observed', 'inferred']) }) });
const confidence = s.enum(['low', 'medium', 'high']);
const inference = s.array(s.object({ kind: s.enum(['signature-source', 'decompiler-type', 'type-lock', 'calling-convention', 'jump-table']), source: nonempty, detail: nonempty }), 1);
const boundaryFacts = { ordinal: s.nullable(num), name: s.nullable(nonempty), data_type: nonempty, size_bytes: s.nullable(num), storage: s.nullable(nonempty), confidence, evidence: inference, decompiler_artifacts: s.array(s.enum(['recovered-signature', 'register-or-stack-storage', 'compiler-generated-variable'])) };
const api = eitherAvailability(s.object({ available: s.literal(true), provenance: nonempty, signature_source: nonempty, calling_convention: nonempty, return_type: s.object({ ...boundaryFacts, role: s.literal('return'), ordinal: s.literal(null), name: s.literal(null) }), parameters: s.array(s.object({ ...boundaryFacts, role: s.literal('parameter'), ordinal: num })), jump_tables: s.array(s.object({ dispatch_address: nonempty, data_sources: s.array(s.object({ address: nonempty, provenance: s.enum(['ghidra-decompiler-load-table', 'ghidra-dispatch-block-data-reference', 'ghidra-aarch64-byte-table', 'ghidra-aarch64-halfword-table']), entry_size_bytes: s.nullable(s.number(1)), entry_count: s.nullable(num), confidence, evidence: inference })), mappings: s.array(s.object({ case_value: s.nullable(integer), target_address: nonempty, confidence, evidence: inference })), default_targets: s.array(s.object({ target_address: nonempty, confidence, evidence: inference })), limitations: strings })), pseudocode: s.object({ classification: s.literal('decompiler-generated-non-source'), compilable: s.literal(false) }), decompiler_artifacts: s.array(s.enum(['recovered-signature', 'register-and-stack-variables', 'compiler-generated-control-flow', 'pointer-arithmetic', 'pseudocode'])), limitations: strings }), s.object({ available: s.literal(false), reason: nonempty, residual_unknowns: s.array(nonempty, 1) }));
const varnode = s.object({ kind: s.enum(['constant', 'address', 'register', 'unique', 'other']), size_bytes: num, location: s.nullable(str), constant_hex: s.nullable(s.pattern(/^[0-9a-f]+$/)) });
const pcode = s.object({ id: nonempty, address: nonempty, sequence: num, opcode: nonempty, is_dead: bool, block_membership: s.enum(['member', 'detached', 'unavailable']), inputs: s.array(varnode), output: s.nullable(varnode) });
const valueFlow = eitherAvailability(s.object({ available: s.literal(true), provenance: s.literal('ghidra-high-pcode'), operations: s.array(pcode), def_use: s.array(s.object({ definition: nonempty, use: nonempty, input_index: num })), effects: s.array(s.object({ operation: nonempty, kind: s.enum(['memory_read', 'memory_write', 'conditional_branch', 'indirect_branch', 'direct_call', 'indirect_call']), operand_input: s.nullable(num), value_input: s.nullable(num) })), parameters: s.array(s.object({ ordinal: num, name: str, data_type: str })), parameter_uses: s.array(s.object({ ordinal: num, use: str, input_index: num })), truncated: bool, omitted_operations_lower_bound: num, known_omitted_inputs: num, known_omitted_edges: num, limitations: s.array(nonempty) }), s.object({ available: s.literal(false), reason: nonempty, limitations: s.array(nonempty) }));
const pair: ReaCheck = value => { s.array(str, 2, 2)(value); };
const swift: ReaCheck = value => { const row = asRecord(value); s.object({ source_address: str, value: str, registers: pair, words: pair, representation: s.enum(['small', 'large']), address: row.representation === 'small' ? s.literal(null) : str })(value); };
const swiftOmission: ReaCheck = value => { const row = asRecord(value); s.object({ source_address: str, byte_length: num, reason: s.enum(['capacity', 'unresolved_jump']), registers: pair, words: pair, representation: s.enum(['small', 'large']), address: row.representation === 'small' ? s.literal(null) : str })(value); };
const availableFacet = eitherAvailability(s.object({ available: s.literal(true) }), s.object({ available: s.literal(false), reason: nonempty }));
const facets: Record<string, ReaCheck> = {}; for (const key of ['pseudocode', 'assembly', 'comments', 'callers', 'callees', 'references', 'strings_names', 'cfg']) facets[key] = availableFacet;
const dossier = s.object({ procedure, pseudocode: str, assembly: strings, comments: s.array(s.object({ address: str, kind: s.enum(['comment', 'inline']), text: str })), callers: s.array(identity), callees: s.array(identity), incoming_references: s.array(reference), outgoing_references: s.array(reference), referenced_strings: s.array(stringItem), referenced_names: s.array(s.object({ address: str, value: str, source_address: str })), basic_blocks: s.array(s.object({ start: str, end: str, successors: strings })), native_api: s.nullable(api), native_value_flow: s.nullable(valueFlow), limitations: strings }, { unresolved_calls: s.array(s.object({ address: str, reason: str })), swift_string_literals: s.array(swift), swift_string_literal_omissions: s.array(swiftOmission), facet_availability: s.object({}, facets) });
const layoutSummary = s.object({ bytes: num, format: s.literal('elf'), architecture: s.object({ machine: s.literal('EM_X86_64'), bits: s.literal(64), byte_order: s.literal('little') }), image_type: s.enum(['ET_EXEC', 'ET_DYN', 'ET_REL']), entry: s.object({ reported_value: nonempty, meaning: s.enum(['linked-virtual-address', 'not-applicable', 'absent']), execution_status: s.literal('unknown') }), counts: s.object({ sections: num, segments: num, symbols: num, relocations: num }), limitation_count: num });

export async function runReaNativeBinary(ctx: ReaLocalFlowContext): Promise<ReaLocalFlowResult> {
  ctx.assertCurrent(); const config = ctx.configuration.native;
  if (!config?.qualificationRef || config.targetSha256 !== ctx.targetSha256 || !['ghidra', 'ida', 'hopper'].includes(config.providerId)) throw new ReaContractError('REA_CONFIGURATION_REQUIRED');
  if (ctx.input.profile !== 'native-binary') throw new ReaContractError('REA_INPUT_INVALID');
  const options = asRecord(ctx.input.profileOptions ?? {});
  s.object({}, { procedure: s.string(1, 256), includePseudocode: bool, includeLayout: bool })(options);
  if ((options.includePseudocode === true && options.procedure === undefined) || (options.procedure === undefined && options.includeLayout !== true)) throw new ReaContractError('REA_SELECTOR_REQUIRED');
  if (options.includeLayout === true && (ctx.configuration.hostPlatform !== 'linux' || ctx.configuration.architecture !== 'x64' || config.targetFormat !== 'elf' || config.targetArchitecture !== 'x86_64')) throw new ReaContractError('REA_NOT_AVAILABLE');
  if (config.providerId === 'hopper' && (ctx.configuration.hostPlatform === 'win32' || config.allowUi !== true)) throw new ReaContractError('REA_NOT_AVAILABLE');
  if (config.providerId === 'ida' && (config.allowNetwork !== true || (!config.headless && config.allowUi !== true))) throw new ReaContractError('REA_CONFIGURATION_REQUIRED');
  if (config.providerId === 'ghidra' && (!config.headless || !/^12\.1\.\d+(?:[-+].*)?$/.test(config.version ?? '') || config.targetKind !== 'executable' || (ctx.configuration.hostPlatform === 'win32' && (ctx.configuration.architecture !== 'x64' || !config.windowsNativeReady || config.targetFormat !== 'pe' || !['x86', 'x86_64'].includes(config.targetArchitecture ?? '') || config.managed !== false)))) throw new ReaContractError('REA_CONFIGURATION_REQUIRED');
  // Raw images need explicit architecture+entry admission not present in this public profile.
  if (['raw-binary', 'dos-com'].includes(config.targetFormat)) throw new ReaContractError('REA_NOT_AVAILABLE');
  return withReaBinary(ctx, { path: ctx.targetPath, provider_id: config.providerId }, { kind: config.targetKind, format: config.targetFormat }, async () => {
    let primary: ValidatedReaEvidence | undefined; const refs: string[] = [], facts: ReaTechnicalFact[] = []; let partial = true;
    if (options.procedure !== undefined) {
      const reply = await invokeRea(ctx, 'analyze_function', { procedure: options.procedure });
      const evidence = checkedEvidence(reply, ctx, 'analyze_function'); const row = asRecord(reply.normalized_result); dossier(row);
      const identity = asRecord(reply.provider);
      if (identity.id !== config.providerId || (config.version !== undefined && identity.version !== config.version)) invalid();
      s.object({ procedure: s.literal(options.procedure) })(reply.parameters);
      primary = evidence; refs.push(evidence.originalEvidenceId);
      for (const key of ['assembly', 'callers', 'callees', 'basic_blocks', 'incoming_references', 'outgoing_references']) facts.push(reaFact(evidence, 'native_' + key, 'Observed native ' + key.replaceAll('_', ' '), (row[key] as unknown[]).length, key));
      facts.push(reaFact(evidence, 'native_body_available', 'Native body range available', asRecord(asRecord(row.procedure).body).available === true, 'procedure/body/available'));
      facts.push(reaFact(evidence, 'native_pseudocode_units', 'Decompiler text code units', (row.pseudocode as string).length, 'pseudocode'));
      const flow = row.native_value_flow === null ? null : asRecord(row.native_value_flow);
      const availability = row.facet_availability === undefined ? {} : asRecord(row.facet_availability);
      partial = asRecord(asRecord(row.procedure).body).available !== true || flow?.available !== true || flow.truncated !== false || ['pseudocode', 'assembly', 'callers', 'callees', 'references', 'strings_names', 'cfg'].some(key => !availability[key] || asRecord(availability[key]).available !== true);
      if (options.includePseudocode === true) {
        const pseudoBody = await invokeRea(ctx, 'procedure_pseudo_code', { procedure: options.procedure }); const pseudo = checkedEvidence(pseudoBody, ctx, 'procedure_pseudo_code');
        s.nullable(str)(pseudoBody.normalized_result);
        const pseudoProvider = asRecord(pseudoBody.provider);
        if (pseudoProvider.id !== config.providerId || (config.version !== undefined && pseudoProvider.version !== config.version)) invalid();
        s.object({ procedure: s.literal(options.procedure) })(pseudoBody.parameters);
        refs.push(pseudo.originalEvidenceId); partial ||= pseudoBody.normalized_result === null;
        facts.push(reaFact(pseudo, 'native_explicit_pseudocode_available', 'Explicit decompiler output available', pseudoBody.normalized_result !== null, ''));
      }
    }
    if (options.includeLayout === true) {
      const reply = await invokeRea(ctx, 'inspect_binary_layout', { path: ctx.targetPath, detail: 'summary' }); const selected = checkedSummary(reply, ctx, 'inspect_binary_layout'); layoutSummary(selected.summary);
      primary ??= selected.evidence; refs.push(selected.evidence.originalEvidenceId);
      const counts = asRecord(selected.summary.counts);
      for (const key of ['sections', 'segments', 'symbols', 'relocations']) facts.push(reaFact(selected.evidence, 'native_layout_' + key, 'Observed ELF ' + key, counts[key] as number, 'summary/counts/' + key));
      partial = true; // Source explicitly leaves relocation/library/runtime completeness unknown.
    }
    if (!primary) throw new ReaContractError('REA_SELECTOR_REQUIRED');
    ctx.assertCurrent(); return flowResult(primary, facts, partial ? 'partial' : 'complete', options.procedure === undefined ? 'summary-view' : 'analysis', refs);
  });
}
