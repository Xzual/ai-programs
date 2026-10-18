import { createHash } from 'node:crypto';
import { ReaContractError, validateReaRemoteEvidence, type ReaRemoteFlowContext, type ReaRemoteFlowResult } from './reaContract';
import { asRecord, invalid, schema, type ReaRecord, type ReaCheck } from './reaAppPackageService';
import { invokeRemote, remoteBrowserCheck, remoteFact, remoteFinite, remoteIso, remoteResult, remoteWindow } from './reaElectronRuntimeService';

// Source: REA6.5 domain/webExecution.js20-104 and domain/webRuntime.js25-72.
const jsonObject: ReaCheck = value => { asRecord(value); }; // Guarded finite JSON snapshot already established by unwrapRea.
const location = schema.object({ script_id: schema.string(), url: schema.nullable(schema.string()), line_number: schema.number(), column_number: schema.nullable(schema.number()), function_name: schema.nullable(schema.string()), source_association: schema.enum(['script_id', 'unknown']) });
const capturedSource = schema.object({ state: schema.literal('captured'), text: schema.string(), sha256: schema.pattern(/^[a-f0-9]{64}$/), utf8_bytes: schema.number(), utf16_units: schema.number() });
const sourceState: ReaCheck = value => { const row = asRecord(value); if (row.state === 'captured') capturedSource(row); else schema.object({ state: schema.enum(['unavailable', 'excluded']), reason: schema.string(1) })(row); };
const source = schema.object({ script_id: schema.string(1), url: schema.string(), execution_context_id: schema.nullable(schema.number(Number.MIN_SAFE_INTEGER)), reported_execution_context: schema.nullable(jsonObject), reported_script_context_aux_data: schema.nullable(jsonObject), frame_id: schema.nullable(schema.string()), producer_hash: schema.nullable(schema.string()), source_map_url: schema.nullable(schema.string()), has_source_url: schema.nullable(schema.boolean), language: schema.nullable(schema.string()), resource_start: schema.nullable(schema.object({ line_number: schema.number(), column_number: schema.number() })), source: sourceState });
const range = schema.object({ start_offset: schema.number(), end_offset: schema.number(), count: schema.number(), source_bounds: schema.enum(['verified', 'unknown']) });
const executionCheck = schema.object({
  browser: remoteBrowserCheck,
  target: schema.object({ target_id: schema.string(1), origin: schema.string(1), initial_url: schema.string(), frame_id: schema.string(1), loader_id: schema.nullable(schema.string()) }),
  window: schema.object({ armed_at: remoteIso, ended_at: remoteIso, requested_ms: schema.number(1), end_reason: schema.enum(['window_elapsed', 'document_changed', 'target_terminated']), producer_started_seconds: remoteFinite(), producer_sampled_seconds: schema.nullable(remoteFinite()) }),
  coverage: schema.object({ state: schema.enum(['captured', 'unavailable']), reason: schema.nullable(schema.string()), offset_units: schema.literal('utf16-code-units'), end_offset: schema.literal('exclusive'), scripts: schema.array(schema.object({ script_id: schema.string(1), reported_url: schema.string(), functions: schema.array(schema.object({ name: schema.string(), is_block_coverage: schema.boolean, ranges: schema.array(range) })) })), excluded_scripts: schema.number() }),
  requests: schema.array(schema.object({ request_id: schema.string(1), url: schema.string(), method: schema.string(), timestamp_seconds: remoteFinite(), initiator_type: schema.string(), reported_initiator: jsonObject, callsites: schema.array(location), async_parent_ids: schema.array(schema.object({ id: schema.string(), debugger_id: schema.nullable(schema.string()) })), causal_attribution: schema.literal('unknown') })),
  excluded_requests: schema.number(),
  script_inventory: schema.object({ main_document_scripts: schema.number(), not_reported_script_ids: schema.array(schema.string(1)), coverage_absence: schema.literal('unknown') }),
  sources: schema.array(source),
  instrumentation: schema.object({ resets_execution_counters: schema.literal(true), disables_optimized_execution: schema.literal(true), takes_one_resetting_sample: schema.boolean, executes_selected_code: schema.literal(false), cleanup: schema.literal('confirmed'), page_ownership: schema.literal('external') }),
  limitations: schema.array(schema.string()),
});

export async function runReaRuntimeObservation(ctx: ReaRemoteFlowContext): Promise<ReaRemoteFlowResult> {
  ctx.assertCurrent(); const binding = ctx.target.binding;
  if (binding.profile !== 'runtime-observation' || binding.target.kind !== 'web-execution' || ctx.input.profile !== binding.profile || Object.keys(ctx.input.profileOptions ?? {}).length || ctx.input.featureQuery !== undefined) throw new ReaContractError('REA_INPUT_INVALID');
  const target = binding.target;
  const args = { cdp_endpoint: target.cdpEndpoint, target_id: target.targetId, allowed_origins: [target.allowedOrigin], observation_ms: target.observationMs };
  const body = await invokeRemote(ctx, 'observe_web_execution', args);
  const evidence = validateReaRemoteEvidence(body, { operation: 'observe_web_execution', parameters: args, providerId: 'rea-cdp-browser', providerVersion: '2' });
  const result = asRecord(body.normalized_result); executionCheck(result);
  const selected = asRecord(result.target), window = asRecord(result.window), coverage = asRecord(result.coverage), instrumentation = asRecord(result.instrumentation);
  if (selected.target_id !== target.targetId || selected.origin !== target.allowedOrigin || window.requested_ms !== target.observationMs) invalid();
  try { const url = new URL(selected.initial_url as string); if (!['http:', 'https:'].includes(url.protocol) || url.origin !== target.allowedOrigin || url.username || url.password) invalid(); } catch { invalid(); }
  remoteWindow(ctx, window.armed_at, window.ended_at);
  const scripts = coverage.scripts as ReaRecord[], sources = result.sources as ReaRecord[], requests = result.requests as ReaRecord[];
  const sourceById = new Map(sources.map(row => [row.script_id, row]));
  if (sourceById.size !== sources.length || new Set(scripts.map(row => row.script_id)).size !== scripts.length || new Set(requests.map(row => row.request_id)).size !== requests.length) invalid();
  let capturedSources = 0, rangeCount = 0;
  for (const item of sources) {
    const text = asRecord(item.source);
    if (text.state === 'captured') {
      schema.number()(item.execution_context_id);
      // CdpRuntimeSources.belongsToDocument/read: a retained text digest alone
      // does not bind that text to the selected document's default world.
      const context = item.reported_execution_context === null ? undefined : asRecord(item.reported_execution_context);
      if (context) {
        schema.number()(context.id);
        if (context.id !== item.execution_context_id) invalid();
        for (const key of ['origin', 'name', 'uniqueId']) if (Object.hasOwn(context, key)) schema.string()(context[key]);
      }
      const world = (value: unknown): ReaRecord | undefined => {
        if (value === undefined || value === null) return undefined;
        const row = asRecord(value);
        if (Object.hasOwn(row, 'frameId')) schema.string()(row.frameId);
        if (Object.hasOwn(row, 'isDefault')) schema.boolean(row.isDefault);
        if (Object.hasOwn(row, 'type')) schema.string()(row.type);
        return row;
      };
      const scriptWorld = world(item.reported_script_context_aux_data), contextWorld = world(context?.auxData), worlds = [scriptWorld, contextWorld];
      if (item.frame_id !== selected.frame_id || item.language === 'WebAssembly' || item.execution_context_id === null
        || worlds.some(row => row?.isDefault === false || (row?.type !== undefined && row.type !== 'default'))
        || !worlds.some(row => row?.isDefault === true || row?.type === 'default')
        || (scriptWorld?.frameId !== undefined && contextWorld?.frameId !== undefined && scriptWorld.frameId !== contextWorld.frameId)
        || (scriptWorld?.frameId ?? contextWorld?.frameId) !== selected.frame_id) invalid();
      const value = text.text as string;
      if (text.sha256 !== createHash('sha256').update(value, 'utf8').digest('hex') || text.utf8_bytes !== Buffer.byteLength(value, 'utf8') || text.utf16_units !== value.length) invalid();
      capturedSources++;
    }
  }
  for (const script of scripts) {
    const item = sourceById.get(script.script_id), text = item ? asRecord(item.source) : undefined;
    for (const fn of script.functions as ReaRecord[]) for (const entry of fn.ranges as ReaRecord[]) {
      rangeCount++;
      if ((entry.end_offset as number) < (entry.start_offset as number) || entry.source_bounds !== (text?.state === 'captured' ? 'verified' : 'unknown') || (text?.state === 'captured' && (entry.end_offset as number) > (text.utf16_units as number))) invalid();
    }
  }
  const captured = coverage.state === 'captured';
  if (captured) {
    if (window.end_reason !== 'window_elapsed' || coverage.reason !== null || window.producer_sampled_seconds === null || (window.producer_sampled_seconds as number) < (window.producer_started_seconds as number) || instrumentation.takes_one_resetting_sample !== true) invalid();
  } else if (window.end_reason === 'window_elapsed' || typeof coverage.reason !== 'string' || !coverage.reason || scripts.length || coverage.excluded_scripts !== 0 || window.producer_sampled_seconds !== null || instrumentation.takes_one_resetting_sample !== false) invalid();
  const inventory = asRecord(result.script_inventory), missing = inventory.not_reported_script_ids as string[];
  if (new Set(missing).size !== missing.length || missing.length > (inventory.main_document_scripts as number) || missing.some(id => scripts.some(script => script.script_id === id))) invalid();
  for (const request of requests) for (const site of request.callsites as ReaRecord[]) {
    // CDP may retain unresolved associations. Never join arbitrary URL equality.
    if (site.source_association === 'script_id' && !(site.script_id as string).length) invalid();
  }
  const limitation = 'One instrumented selected-document window; counters reset and optimization disabled. Nested range counts are not event totals; request initiators do not establish causality. Browser background traffic is not contained.';
  const facts = [
    remoteFact(evidence, 'observation-window-ms', 'Requested observation window (ms)', target.observationMs, 'window/requested_ms', limitation),
    remoteFact(evidence, 'observation-end-reason', 'Observation end reason', window.end_reason as string, 'window/end_reason', limitation),
    remoteFact(evidence, 'execution-coverage-state', 'Precise coverage sample state', coverage.state as string, 'coverage/state', limitation),
    remoteFact(evidence, 'coverage-script-count', 'Scripts in precise coverage sample', scripts.length, 'coverage/scripts', limitation),
    remoteFact(evidence, 'coverage-range-count', 'Retained nested coverage ranges', rangeCount, 'coverage/scripts', limitation),
    remoteFact(evidence, 'runtime-source-count', 'Retained source records', sources.length, 'sources', limitation),
    remoteFact(evidence, 'captured-source-count', 'Sources with verified retained text', capturedSources, 'sources', limitation),
    remoteFact(evidence, 'runtime-request-count', 'Retained request records', requests.length, 'requests', limitation),
    remoteFact(evidence, 'runtime-excluded-requests', 'Excluded request records', result.excluded_requests as number, 'excluded_requests', limitation),
    remoteFact(evidence, 'runtime-excluded-scripts', 'Excluded coverage scripts', coverage.excluded_scripts as number, 'coverage/excluded_scripts', limitation),
    remoteFact(evidence, 'runtime-main-document-scripts', 'Inventoried main document scripts', inventory.main_document_scripts as number, 'script_inventory/main_document_scripts', limitation),
    remoteFact(evidence, 'runtime-unsampled-script-count', 'Inventoried scripts absent from sample', missing.length, 'script_inventory/not_reported_script_ids', limitation),
    remoteFact(evidence, 'execution-counters-reset', 'Execution counters reset', true, 'instrumentation/resets_execution_counters', limitation),
    remoteFact(evidence, 'optimized-execution-disabled', 'Optimized execution disabled during observation', true, 'instrumentation/disables_optimized_execution', limitation),
  ];
  return remoteResult(ctx, evidence, facts, captured ? 'partial' : 'unavailable', 'confirmed', 'instrumented-runtime');
}
