import { createHash } from 'node:crypto';
import { ReaContractError, validateReaRemoteEvidence, type ReaRemoteFlowContext, type ReaRemoteFlowResult, type ReaTechnicalFact, type ValidatedReaEvidence } from './reaContract';
import { asRecord, invalid, schema, unwrapRea, type ReaCheck, type ReaRecord } from './reaAppPackageService';

// Source: REA6.5 domain/browserObservationSchemas.js7-13, browserCompleteness.js6-73,
// domain/javascript/electronObservation.js29-143. Unknown fields fail closed here.
export const remoteBrowserCheck = schema.object({ product: schema.string(), protocol_version: schema.string(), revision: schema.string(), user_agent: schema.string(), js_version: schema.string() });
export const remoteFinite = (minimum = 0): ReaCheck => value => { if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum) invalid(); };
export const remoteIso: ReaCheck = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(value)) invalid();
  const date = new Date(value as string);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 19) !== (value as string).slice(0, 19)) invalid();
};
const sections = ['frames', 'dom', 'accessibility', 'scripts', 'script_sources', 'resources', 'network_requests', 'network_initiators', 'console_events', 'console_text', 'websocket_connections', 'websocket_frames', 'websocket_shapes', 'json_body_shapes', 'workers', 'storage', 'storage_keys', 'metadata', 'webmcp_tools', 'screenshot', 'source_maps', 'timeline'];
const statuses = ['complete_within_window', 'policy_filtered', 'attach_limited', 'truncated'];
const sectionArray = schema.array(schema.enum(sections));
const droppedFields = ['scripts', 'network_requests', 'console_events', 'websocket_connections', 'websocket_frames', 'webmcp_tools', 'timeline_events'];
const completenessCheck = schema.object({ status: schema.enum(statuses), conditions: schema.array(schema.enum(statuses), 1, 3), policy_filtered_sections: sectionArray, attach_limited_sections: sectionArray, truncated_sections: sectionArray, unavailable_sections: sectionArray, excluded: schema.array(schema.object({ section: schema.enum(sections), reason: schema.enum(['disallowed_origin', 'unsupported_url', 'unattributed_origin', 'not_approved', 'out_of_target_scope', 'provider_unavailable', 'invalid_protocol_value', 'resource_budget_exhausted']), count: schema.nullable(schema.number()) })), dropped_events: schema.object(Object.fromEntries([...droppedFields, 'total'].map(key => [key, schema.number()]))) });
const electronCheck = schema.object({
  browser: remoteBrowserCheck,
  target: schema.object({ target_id: schema.string(), type: schema.string(), title: schema.string(), file_path: schema.string(), attached: schema.nullable(schema.boolean) }),
  capture_window: schema.object({ started_at: remoteIso, ended_at: remoteIso, observation_ms: schema.number() }),
  completeness: completenessCheck,
  frames: schema.array(schema.object({ frame_id: schema.string(), parent_frame_id: schema.nullable(schema.string()), file_path: schema.string() })),
  dom: schema.object({ total_nodes: schema.number(), nodes: schema.array(schema.object({ index: schema.number(), parent_index: schema.number(-1), node_type: schema.number(), node_name: schema.string(), node_value_length: schema.number(), attribute_names: schema.array(schema.string()) })) }),
  scripts: schema.object({ total: schema.number(), items: schema.array(schema.object({ script_key: schema.pattern(/^electron_script_[a-f0-9]{64}$/), frame_id: schema.nullable(schema.string()), file_path: schema.string(), cdp_hash: schema.nullable(schema.string()), length: schema.nullable(schema.number()), is_module: schema.nullable(schema.boolean), language: schema.nullable(schema.string()), source: schema.object({ included: schema.literal(false), reason: schema.literal('source capture was not selected') }) })) }),
  resources: schema.array(schema.object({ resource_key: schema.pattern(/^electron_resource_[a-f0-9]{64}$/), file_path: schema.string(), type: schema.string(), mime_type: schema.string(), content_size: schema.nullable(remoteFinite()) })),
  workers: schema.array(schema.object({ target_id: schema.string(1), type: schema.string(1), file_path: schema.string(), attached: schema.boolean, opener_target_id: schema.nullable(schema.string(1)), parent_frame_id: schema.nullable(schema.string(1)) })),
  limitations: schema.array(schema.string()),
});
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') { const row = value as ReaRecord; return '{' + Object.keys(row).sort().map(key => JSON.stringify(key) + ':' + canonical(row[key])).join(',') + '}'; }
  return JSON.stringify(value);
}
export const remoteDigest = (value: unknown): string => createHash('sha256').update(canonical(value)).digest('hex');
export async function invokeRemote(ctx: ReaRemoteFlowContext, tool: string, args: ReaRecord): Promise<ReaRecord> {
  ctx.assertCurrent(); await ctx.requireAvailable(tool); ctx.assertCurrent();
  const reply = await ctx.callTool(tool, args); ctx.assertCurrent();
  return unwrapRea(reply);
}
export function remoteWindow(ctx: ReaRemoteFlowContext, start: unknown, end: unknown): { start: number; end: number } {
  remoteIso(start); remoteIso(end);
  const a = Date.parse(start as string), b = Date.parse(end as string), now = Date.now();
  if (!Number.isFinite(ctx.target.admittedAt) || a < ctx.target.admittedAt || b < a || b > now || ctx.target.admittedAt > now) invalid();
  return { start: a, end: b };
}
export function remoteFact(evidence: ValidatedReaEvidence, key: string, label: string, value: number | boolean | string, pointer: string, limitation: string): ReaTechnicalFact {
  return Object.freeze({ key, label, value, jsonPointer: '/normalized_result/' + pointer, evidenceId: evidence.originalEvidenceId, scope: 'producer-returned', confidence: evidence.confidence, limitation });
}
export function remoteResult(ctx: ReaRemoteFlowContext, evidence: ValidatedReaEvidence, facts: readonly ReaTechnicalFact[], coverage: ReaRemoteFlowResult['sourceCoverage'], providerCleanup: ReaRemoteFlowResult['providerCleanup'], observationKind: ReaRemoteFlowResult['observationKind']): ReaRemoteFlowResult {
  ctx.assertCurrent();
  if (!facts.length || facts.length > 20 || facts.some(fact => fact.evidenceId !== evidence.originalEvidenceId)) invalid();
  return Object.freeze({ evidence: Object.freeze(evidence), technicalFacts: Object.freeze([...facts]), sourceCoverage: coverage, evidenceKind: 'analysis', evidenceRefs: Object.freeze([evidence.originalEvidenceId]), providerCleanup, observationKind });
}
/** No network/process work here: only the injected, authority-guarded MCP tool. */
export async function runReaElectronRuntime(ctx: ReaRemoteFlowContext): Promise<ReaRemoteFlowResult> {
  ctx.assertCurrent();
  const binding = ctx.target.binding;
  if (binding.profile !== 'electron-passive-runtime' || binding.target.kind !== 'electron-page' || ctx.input.profile !== binding.profile || Object.keys(ctx.input.profileOptions ?? {}).length || ctx.input.featureQuery !== undefined) throw new ReaContractError('REA_INPUT_INVALID');
  const target = binding.target;
  const args = { cdp_endpoint: target.cdpEndpoint, target_id: target.targetId, observation_ms: target.observationMs, include_script_sources: false };
  const body = await invokeRemote(ctx, 'inspect_electron_page', args);
  const evidence = validateReaRemoteEvidence(body, { operation: 'inspect_electron_page', parameters: args, providerId: 'rea-cdp-electron', providerVersion: '1' });
  const result = asRecord(body.normalized_result); electronCheck(result);
  const browser = asRecord(result.browser), selected = asRecord(result.target), window = asRecord(result.capture_window);
  if (selected.target_id !== target.targetId || selected.type !== 'page' || selected.file_path !== target.expectedFilePath || window.observation_ms !== target.observationMs || asRecord(body.environment).id !== browser.product + '@' + browser.revision) invalid();
  remoteWindow(ctx, window.started_at, window.ended_at);
  const completeness = asRecord(result.completeness), dropped = asRecord(completeness.dropped_events);
  if (dropped.total !== droppedFields.reduce((total, key) => total + (dropped[key] as number), 0)) invalid();
  const conditions = [...((completeness.attach_limited_sections as unknown[]).length || (completeness.unavailable_sections as unknown[]).length ? ['attach_limited'] : []), ...((completeness.policy_filtered_sections as unknown[]).length ? ['policy_filtered'] : []), ...((completeness.truncated_sections as unknown[]).length || (dropped.total as number) > 0 ? ['truncated'] : [])];
  const expectedConditions = conditions.length ? conditions : ['complete_within_window'];
  const expectedStatus = conditions.includes('truncated') ? 'truncated' : conditions.includes('policy_filtered') ? 'policy_filtered' : conditions.includes('attach_limited') ? 'attach_limited' : 'complete_within_window';
  if (completeness.status !== expectedStatus || canonical(completeness.conditions) !== canonical(expectedConditions)) invalid();
  const frames = result.frames as ReaRecord[], frameIds = new Set(frames.map(frame => frame.frame_id));
  if (!frames.length || frames[0]!.file_path !== target.expectedFilePath || frameIds.size !== frames.length) invalid();
  const dom = asRecord(result.dom), nodes = dom.nodes as ReaRecord[];
  if (dom.total_nodes !== nodes.length || nodes.some((node, index) => node.index !== index || (node.parent_index as number) >= nodes.length)) invalid();
  const scripts = asRecord(result.scripts), items = scripts.items as ReaRecord[];
  if (scripts.total !== items.length || new Set(items.map(item => item.script_key)).size !== items.length) invalid();
  for (const item of items) {
    const { script_key, source, ...identity } = item;
    if (script_key !== 'electron_script_' + remoteDigest(identity) || (item.frame_id !== null && !frameIds.has(item.frame_id))) invalid();
  }
  const resources = result.resources as ReaRecord[];
  if (new Set(resources.map(row => row.resource_key)).size !== resources.length) invalid();
  for (const resource of resources) { const { resource_key, ...identity } = resource; if (resource_key !== 'electron_resource_' + remoteDigest(identity)) invalid(); }
  const workers = result.workers as ReaRecord[];
  if (new Set(workers.map(row => row.target_id)).size !== workers.length || workers.some(worker => !(worker.type as string).includes('worker') || (worker.opener_target_id !== target.targetId && !frameIds.has(worker.parent_frame_id)))) invalid();
  const limitation = 'Selected Electron page structural observations within one capture window; script sources excluded. Provider cleanup remains unverified; browser background traffic is not contained.';
  const facts = [
    remoteFact(evidence, 'capture-window-ms', 'Requested observation window (ms)', target.observationMs, 'capture_window/observation_ms', limitation),
    remoteFact(evidence, 'capture-completeness', 'Capture completeness', completeness.status as string, 'completeness/status', limitation),
    remoteFact(evidence, 'captured-frames', 'Retained file frames', frames.length, 'frames', limitation),
    remoteFact(evidence, 'captured-dom-nodes', 'Retained DOM nodes', dom.total_nodes as number, 'dom/total_nodes', limitation),
    remoteFact(evidence, 'captured-scripts', 'Retained script metadata entries', scripts.total as number, 'scripts/total', limitation),
    remoteFact(evidence, 'captured-resources', 'Retained resource metadata entries', resources.length, 'resources', limitation),
    remoteFact(evidence, 'captured-workers', 'Retained worker metadata entries', workers.length, 'workers', limitation),
    remoteFact(evidence, 'capture-dropped-events', 'Producer dropped events', dropped.total as number, 'completeness/dropped_events/total', limitation),
  ];
  // Complete within this window is never complete artifact/application coverage.
  return remoteResult(ctx, evidence, facts, 'partial', 'unverified', 'passive-runtime');
}
