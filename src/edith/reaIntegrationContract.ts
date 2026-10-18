import { createHash } from 'node:crypto';
import { REA_PROFILES, REA_APPLICATION_RELATIONS, REA_SEMANTIC_RELATIONS, parseReaAnalysisInput, snapshotReaJson } from './reaContract';
import type { ReaDeepReadonly, ReaProfile, ReaTechnicalFact, ReaStructuralRelationship } from './reaContract';
import type { EdithExecutionIdentity, EdithReaPlannedCall } from './core';
import type { ReaAnalysisResult } from './reaAnalysisService';
import { hudPositiveInteger, hudSafeId, hudUtc, isTaskObservedMetricsV1 } from './taskHudContracts';
import type { TaskObservedMetricsV1 } from './taskHudContracts';

export interface ReaSelectionProjectionV1 {
  readonly schemaVersion: 1;
  readonly selectionRef: string;
  readonly profile: ReaProfile;
  readonly revision: number;
  readonly expiresAt: number;
}

export type ReaConstraintKind = 'missing_code' | 'missing_engine' | 'qualification_failed'
  | 'unsupported_operation' | 'quota_stop' | 'live_user_constraint';
export interface ReaCompositionStatusV1 {
  readonly schemaVersion: 1;
  readonly runtimeReady: false;
  readonly outcome: 'configuration_required';
  readonly reasons: readonly Readonly<{ kind: ReaConstraintKind; code: string }>[];
}

/** Backend-only TYPE contract. No issuer, mint, runtime brand check or service is implemented here.
 * A future private issuer must authenticate tokens in its own WeakMap, not trust this TS brand.
 * Neither persisted receipts nor these public pure parsers can construct an executable token. */
declare const capabilityBrand: unique symbol;
export interface ReaExecutionCapabilityV1 {
  readonly [capabilityBrand]: true;
  readonly identity: EdithExecutionIdentity;
  readonly call: EdithReaPlannedCall;
  assertTaskCurrent(): void;
  execute(): Promise<ReaAnalysisResult>;
}
export type ReaExecutionIssuerV1 = (admission: Readonly<{
  identity: EdithExecutionIdentity;
  call: EdithReaPlannedCall;
  selection: ReaSelectionProjectionV1;
}>) => ReaExecutionCapabilityV1;
export type ReaExecutionConsumerV1 = (capability: ReaExecutionCapabilityV1) => Promise<ReaAnalysisResult>;

/** Receipt-local refs are evidence_1..evidence_50, never source labels or locator strings. */
export interface ReaSafeEvidencePointerV1 {
  readonly evidenceRef: string;
  readonly originalEvidenceId: string;
  readonly validatedJSONPointer: string;
}
export interface ReaSafeTechnicalFactV1 extends Pick<ReaTechnicalFact,'key'|'label'|'value'|'scope'|'confidence'|'limitation'> {
  readonly provenance: ReaSafeEvidencePointerV1 & Readonly<{observedAt:string;producerVersion:'rea-agents@6.5.0'}>;
}
export interface ReaSafeStructuralRelationshipV1 extends Pick<ReaStructuralRelationship,'id'|'sourceId'|'targetId'|'relation'|'confidence'|'limitation'> {
  readonly scope: 'producer-returned';
  readonly provenance: ReaSafeEvidencePointerV1;
}
export type ReaSafeTechnicalOmissionV1 = 'source_fact_omitted_unsafe_text' | 'source_fact_omitted_unsupported_value'
  | 'source_relationship_omitted_unsafe_text';

/** Read-only rendering made from the original branded report by a future trusted producer.
 * Structural parsing/digests establish integrity and correlation, not origin, sanitization or authority. */
export interface ReaSafeResultProjectionV1 {
  readonly profile: ReaProfile;
  readonly sourceProjectionDigest: string;
  readonly coverage: 'unverified';
  readonly summary: string;
  readonly spokenSummary: string;
  readonly knowledgeMarkdown: string;
  /** Only a future original-branded-report producer may populate these. Parsing does not authenticate origin. */
  readonly technicalFacts?: readonly ReaSafeTechnicalFactV1[];
  readonly structuralRelationships?: readonly ReaSafeStructuralRelationshipV1[];
  readonly technicalLimitations?: readonly ReaSafeTechnicalOmissionV1[];
}
export interface ReaReceiptCorrelationV1 {
  readonly identity: EdithExecutionIdentity;
  readonly toolRunId: string;
  readonly auditEventId: string;
  readonly selectionRef: string;
  readonly selectionRevision: number;
  readonly inputDigest: string;
}
export interface ReaExecutionReceiptV1 extends ReaReceiptCorrelationV1 {
  readonly schemaVersion: 1;
  readonly toolId: 'rea_analysis';
  readonly finishedAt: string;
  readonly receiptObservedAt: string;
  readonly outcome: ReaAnalysisResult['outcome'];
  readonly reasonCode: string;
  readonly cleanup: ReaAnalysisResult['cleanup'];
  readonly evidenceIndex: readonly Readonly<{ ref: string; originalEvidenceId: string }>[];
  readonly report?: ReaSafeResultProjectionV1;
  readonly reportDigest?: string;
  readonly observedMetrics?: ReaDeepReadonly<TaskObservedMetricsV1>;
}

function fail(code = 'REA_INTEGRATION_INVALID'): never { throw new Error(code); }
function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail();
  return value as Record<string, unknown>;
}
function closed(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  const obj = record(value);
  if (required.some(key => !Object.hasOwn(obj, key))
    || Object.keys(obj).some(key => !required.includes(key) && !optional.includes(key))) fail();
  return obj;
}
function choice<T extends string>(value: unknown, values: readonly T[]): T {
  if (typeof value !== 'string' || !values.includes(value as T)) fail();
  return value as T;
}
function id(value: unknown): string { if (!hudSafeId(value)) fail(); return value; }
function positive(value: unknown): number { if (!hudPositiveInteger(value)) fail(); return value; }
function sha(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) fail();
  return value;
}
function utc(value: unknown): string { if (!hudUtc(value)) fail(); return value; }
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length > max || /\x00/.test(value)) fail();
  return value;
}
function code(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Z][A-Z0-9_]{0,95}$/.test(value)) fail();
  return value;
}
function frozen<T>(value: T): ReaDeepReadonly<T> {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) frozen(child);
    Object.freeze(value);
  }
  return value as ReaDeepReadonly<T>;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    const obj = record(value);
    return '{' + Object.keys(obj).sort().map(key => JSON.stringify(key) + ':' + canonical(obj[key])).join(',') + '}';
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) fail();
  return encoded;
}
/** Same sorted-key SHA256 commitment convention as the existing REA validator; never an authentication token. */
export function reaProjectionDigest(value: unknown): string {
  return createHash('sha256').update(canonical(snapshotReaJson(value))).digest('hex');
}

export function parseReaPlannedCall(value: unknown): EdithReaPlannedCall {
  const obj = closed(snapshotReaJson(value), ['toolId', 'args']);
  if (obj.toolId !== 'rea_analysis') fail();
  return frozen({ toolId: 'rea_analysis' as const, args: parseReaAnalysisInput(obj.args) });
}
export function parseReaExecutionIdentity(value: unknown): EdithExecutionIdentity {
  const obj = closed(snapshotReaJson(value), ['taskId', 'planId', 'stepId', 'runId', 'attempt']);
  return Object.freeze({ taskId: id(obj.taskId), planId: id(obj.planId), stepId: id(obj.stepId), runId: id(obj.runId), attempt: positive(obj.attempt) });
}
export function parseReaSelectionProjection(value: unknown): ReaSelectionProjectionV1 {
  const obj = closed(snapshotReaJson(value), ['schemaVersion', 'selectionRef', 'profile', 'revision', 'expiresAt']);
  if (obj.schemaVersion !== 1 || typeof obj.expiresAt !== 'number' || !Number.isSafeInteger(obj.expiresAt) || obj.expiresAt <= 0) fail();
  return Object.freeze({ schemaVersion: 1, selectionRef: id(obj.selectionRef), profile: choice(obj.profile, REA_PROFILES), revision: positive(obj.revision), expiresAt: obj.expiresAt });
}
export function parseReaCompositionStatus(value: unknown): ReaCompositionStatusV1 {
  const obj = closed(snapshotReaJson(value), ['schemaVersion', 'runtimeReady', 'outcome', 'reasons']);
  if (obj.schemaVersion !== 1 || obj.runtimeReady !== false || obj.outcome !== 'configuration_required'
    || !Array.isArray(obj.reasons) || obj.reasons.length < 1 || obj.reasons.length > 32) fail();
  const reasons = obj.reasons.map(value => {
    const reason = closed(value, ['kind', 'code']);
    return { kind: choice(reason.kind, ['missing_code', 'missing_engine', 'qualification_failed', 'unsupported_operation', 'quota_stop', 'live_user_constraint'] as const), code: code(reason.code) };
  });
  return frozen({ schemaVersion: 1, runtimeReady: false, outcome: 'configuration_required', reasons });
}

interface SafeFactRule { readonly profiles: readonly ReaProfile[]; readonly label: string; readonly pointer: string; readonly kind: 'count'|'boolean'|'enum'|'version'; readonly values?: readonly (string|boolean)[]; readonly scope: ReaTechnicalFact['scope']; readonly limitation: string; }
// Finite schema metadata copied from the current approved producers; no source text is loaded at runtime.
const safeFactRules = new Map<string, SafeFactRule>();
function addSafeFactRules(profiles: readonly ReaProfile[], scope: ReaTechnicalFact['scope'], limitation: string,
  rows: readonly (readonly [string,string,string,SafeFactRule['kind'],(readonly (string|boolean)[])?])[]): void {
  for (const [key,label,pointer,kind,values] of rows) {
    if (safeFactRules.has(key)) throw new Error('REA_SAFE_FACT_RULE_DUPLICATE');
    safeFactRules.set(key, Object.freeze({profiles,scope,limitation,label,pointer,kind,...(values ? {values} : {})}));
  }
}
addSafeFactRules(["static-apk"],"producer-returned","Static producer observations only; runtime behavior remains unverified.", [
  ["apk_class_fields","Selected class field rows","/normalized_result/fields","count"],
  ["apk_class_matches","Matching class rows","/normalized_result/matches","count"],
  ["apk_class_methods","Selected class method rows","/normalized_result/methods","count"],
  ["apk_classes","Observed APK classes","/normalized_result/summary/class_count","count"],
  ["apk_duplicate_names","Ambiguous duplicate class names","/normalized_result/duplicate_names","count"],
  ["apk_method_fallback","Method smali fallback used","/normalized_result/fell_back","boolean"],
  ["apk_method_representation","Selected method representation","/normalized_result/representation","enum",["java","smali"]],
  ["apk_permissions","Declared APK permissions","/normalized_result/summary/permissions","count"],
  ["apk_reference_nodes","Observed static using nodes","/normalized_result/total","count"],
  ["apk_resources","Observed APK resources","/normalized_result/summary/resource_count","count"],
  ["apk_signature_verified","APK signature verified","/normalized_result/summary/signature_verification","boolean",[false]],
]);
addSafeFactRules(["apk-resources"],"producer-returned","Static producer observations only; runtime behavior remains unverified.", [
  ["apk_decoded_files","Decoded resource files","/normalized_result/decoded_file_count","count"],
  ["apk_manifest_available","Decoded manifest available","/normalized_result/manifest","boolean"],
  ["apk_string_entries","Decoded selected string entries","/normalized_result/strings","count"],
  ["apk_string_locales","Observed string locales","/normalized_result/locales","count"],
  ["apktool_version","Qualified Apktool version","/normalized_result/client/apktool_version","version"],
]);
addSafeFactRules(["static-managed"],"producer-returned","Count covers producer-returned observations only; total target coverage is unverified.", [
  ["attributes","Returned custom attributes","/normalized_result/summary/reported_counts/attributes","count"],
  ["references","Returned assembly references","/normalized_result/summary/reported_counts/references","count"],
  ["resources","Returned managed resources","/normalized_result/summary/reported_counts/resources","count"],
]);
addSafeFactRules(["static-javascript"],"producer-returned","Count covers producer-returned observations only; total target coverage is unverified.", [
  ["browser_windows","Browser windows observed","/normalized_result/summary/electron/browser_windows","count"],
  ["context_bridge_apis","Context bridge APIs observed","/normalized_result/summary/electron/context_bridge_apis","count"],
  ["findings","Static findings returned","/normalized_result/summary/statistics/findings","count"],
  ["ipc_operations","IPC operations observed","/normalized_result/summary/electron/ipc/operations","count"],
  ["modules","Modules observed","/normalized_result/summary/statistics/modules","count"],
  ["native_addon_bindings","Native addon bindings observed","/normalized_result/summary/electron/native_addon_bindings","count"],
  ["paired_renderer_transmissions","Paired renderer transmissions","/normalized_result/summary/electron/ipc/paired_renderer_transmissions","count"],
  ["parse_failures","JavaScript parse failures","/normalized_result/summary/statistics/parse_failures","count"],
  ["parsed_javascript_files","JavaScript files parsed","/normalized_result/summary/statistics/parsed_javascript_files","count"],
  ["preload_entrypoints","Preload entrypoints observed","/normalized_result/summary/electron/preload_entrypoints","count"],
  ["relevant_files","Relevant files observed","/normalized_result/summary/statistics/relevant_files","count"],
  ["unpaired_literal_renderer_transmissions","Unpaired literal renderer transmissions","/normalized_result/summary/electron/ipc/unpaired_literal_renderer_transmissions","count"],
]);
addSafeFactRules(["web"],"producer-returned","Historical capture only; counts cover returned producer records and sidecars, not current network activity or authenticated server behavior.", [
  ["capture_binary_fields","Returned binary fields","/normalized_result/records","count"],
  ["capture_bytes","Selected capture bytes","/normalized_result/artifact/bytes","count"],
  ["capture_numeric_literals","Preserved numeric literals","/normalized_result","count"],
  ["capture_records","Retained historical records","/normalized_result/total_records","count"],
  ["capture_redactions","Reported redactions","/normalized_result","count"],
  ["capture_retained_binary_bytes","Retained decoded binary bytes","/normalized_result/records","count"],
]);
addSafeFactRules(["electron-passive-runtime"],"producer-returned","Selected Electron page structural observations within one capture window; script sources excluded. Provider cleanup remains unverified; browser background traffic is not contained.", [
  ["capture-completeness","Capture completeness","/normalized_result/completeness/status","enum",["complete_within_window","policy_filtered","attach_limited","truncated"]],
  ["capture-dropped-events","Producer dropped events","/normalized_result/completeness/dropped_events/total","count"],
  ["capture-window-ms","Requested observation window (ms)","/normalized_result/capture_window/observation_ms","count"],
  ["captured-dom-nodes","Retained DOM nodes","/normalized_result/dom/total_nodes","count"],
  ["captured-frames","Retained file frames","/normalized_result/frames","count"],
  ["captured-resources","Retained resource metadata entries","/normalized_result/resources","count"],
  ["captured-scripts","Retained script metadata entries","/normalized_result/scripts/total","count"],
  ["captured-workers","Retained worker metadata entries","/normalized_result/workers","count"],
]);
addSafeFactRules(["runtime-observation"],"producer-returned","One instrumented selected-document window; counters reset and optimization disabled. Nested range counts are not event totals; request initiators do not establish causality. Browser background traffic is not contained.", [
  ["captured-source-count","Sources with verified retained text","/normalized_result/sources","count"],
  ["coverage-range-count","Retained nested coverage ranges","/normalized_result/coverage/scripts","count"],
  ["coverage-script-count","Scripts in precise coverage sample","/normalized_result/coverage/scripts","count"],
  ["execution-counters-reset","Execution counters reset","/normalized_result/instrumentation/resets_execution_counters","boolean",[true]],
  ["execution-coverage-state","Precise coverage sample state","/normalized_result/coverage/state","enum",["captured","unavailable"]],
  ["observation-end-reason","Observation end reason","/normalized_result/window/end_reason","enum",["window_elapsed","document_changed","target_terminated"]],
  ["observation-window-ms","Requested observation window (ms)","/normalized_result/window/requested_ms","count"],
  ["optimized-execution-disabled","Optimized execution disabled during observation","/normalized_result/instrumentation/disables_optimized_execution","boolean",[true]],
  ["runtime-excluded-requests","Excluded request records","/normalized_result/excluded_requests","count"],
  ["runtime-excluded-scripts","Excluded coverage scripts","/normalized_result/coverage/excluded_scripts","count"],
  ["runtime-main-document-scripts","Inventoried main document scripts","/normalized_result/script_inventory/main_document_scripts","count"],
  ["runtime-request-count","Retained request records","/normalized_result/requests","count"],
  ["runtime-source-count","Retained source records","/normalized_result/sources","count"],
  ["runtime-unsampled-script-count","Inventoried scripts absent from sample","/normalized_result/script_inventory/not_reported_script_ids","count"],
]);
addSafeFactRules(["static-managed"],"selected-artifact","Producer-reported static classification; runtime behavior is unverified.", [
  ["implementation","Implementation format","/normalized_result/summary/classification/implementation","enum",["cil","cil-and-ready-to-run","cpp-cli-mixed","metadata-only","not-managed","unknown"]],
  ["managed_architecture","Managed architecture","/normalized_result/summary/classification/managed_architecture","enum",["anycpu","anycpu-prefer-32","x86","x86_64","arm","arm64","unknown"]],
  ["managed_status","Managed classification","/normalized_result/summary/classification/status","enum",["managed","not-managed","malformed"]],
  ["metadata_status","Metadata status","/normalized_result/summary/metadata/status","enum",["absent","complete","partial","malformed"]],
  ["pe_architecture","PE architecture","/normalized_result/summary/pe/architecture","enum",["x86","x86_64","arm","arm64"]],
  ["runtime_family","Runtime family","/normalized_result/summary/classification/runtime_family","enum",["dotnet-framework","modern-dotnet","unity-mono","mixed-clr-native","unknown"]],
]);
addSafeFactRules(["static-javascript","static-managed"],"producer-returned","Static trace observations within the supplied source graph; runtime behavior and whole-target coverage are unverified.", [
  ["inferred_facts","Source inferred facts","/normalized_result/summary/inferred_facts","count"],
  ["matched_seeds","Matched feature seeds","/normalized_result/summary/matched_seeds","count"],
  ["native_handoffs","Native handoffs requiring separate analysis","/normalized_result/summary/native_handoffs","count"],
  ["observed_facts","Source observed facts","/normalized_result/summary/observed_facts","count"],
  ["terminal_paths","Returned terminal paths","/normalized_result/summary/terminal_paths","count"],
  ["traced_edges","Traced graph relationships","/normalized_result/summary/traced_edges","count"],
  ["traced_nodes","Traced graph nodes","/normalized_result/summary/traced_nodes","count"],
  ["unavailable_facts","Source unavailable facts","/normalized_result/summary/unavailable_facts","count"],
  ["unknown_facts","Source unknown facts","/normalized_result/summary/unknown_facts","count"],
]);
addSafeFactRules(["native-binary"],"producer-returned","Static producer observations only; runtime behavior remains unverified.", [
  ["native_assembly","Observed native assembly","/normalized_result/assembly","count"],
  ["native_basic_blocks","Observed native basic blocks","/normalized_result/basic_blocks","count"],
  ["native_body_available","Native body range available","/normalized_result/procedure/body/available","boolean"],
  ["native_callees","Observed native callees","/normalized_result/callees","count"],
  ["native_callers","Observed native callers","/normalized_result/callers","count"],
  ["native_explicit_pseudocode_available","Explicit decompiler output available","/normalized_result","boolean"],
  ["native_incoming_references","Observed native incoming references","/normalized_result/incoming_references","count"],
  ["native_layout_relocations","Observed ELF relocations","/normalized_result/summary/counts/relocations","count"],
  ["native_layout_sections","Observed ELF sections","/normalized_result/summary/counts/sections","count"],
  ["native_layout_segments","Observed ELF segments","/normalized_result/summary/counts/segments","count"],
  ["native_layout_symbols","Observed ELF symbols","/normalized_result/summary/counts/symbols","count"],
  ["native_outgoing_references","Observed native outgoing references","/normalized_result/outgoing_references","count"],
  ["native_pseudocode_units","Decompiler text code units","/normalized_result/pseudocode","count"],
]);
addSafeFactRules(["app-package"],"producer-returned","Static producer observations only; runtime behavior remains unverified.", [
  ["package_edges","Package edges","/normalized_result/summary/available_counts/edges","count"],
  ["package_files","Observed regular files","/normalized_result/summary/observed_entry_kind_counts/file","count"],
  ["package_integrity_contradictions","Package integrity contradictions","/normalized_result/summary/available_counts/integrity_contradictions","count"],
  ["package_nodes","Package nodes","/normalized_result/summary/available_counts/nodes","count"],
  ["package_occurrences","Package occurrences","/normalized_result/summary/available_counts/occurrences","count"],
  ["package_source_complete","Inventory source complete","/normalized_result/summary/source_complete","boolean"],
]);
addSafeFactRules(["static-javascript"],"producer-returned","Static trace observations within the supplied source graph; runtime behavior and whole-target coverage are unverified.", [
  ["relevant_unknowns","Relevant unknown frontiers","/normalized_result/summary/relevant_unknowns","count"],
  ["total_seed_matches","Matched semantic seeds","/normalized_result/summary/total_seed_matches","count"],
  ["traversed_functions","Traversed function owners","/normalized_result/summary/traversed_functions","count"],
  ["traversed_modules","Traversed source modules","/normalized_result/summary/traversed_modules","count"],
  ["traversed_nodes","Traversed semantic nodes","/normalized_result/summary/traversed_nodes","count"],
  ["traversed_relations","Traversed semantic relationships","/normalized_result/summary/traversed_relations","count"],
]);

const featureCountKeys = new Set(['matched_seeds','traced_nodes','traced_edges','terminal_paths','native_handoffs','observed_facts',
  'inferred_facts','unknown_facts','unavailable_facts','total_seed_matches','traversed_nodes','traversed_relations','traversed_functions','traversed_modules','relevant_unknowns']);
const relationshipLimitation = 'Bounded sample of static returned relationships; additional relationships may be omitted and runtime execution is unverified.';
const technicalOmissions = ['source_fact_omitted_unsafe_text','source_fact_omitted_unsupported_value','source_relationship_omitted_unsafe_text'] as const;
function evidencePointer(value: unknown, crosswalk: ReadonlyMap<string,string>, factual: boolean): ReaSafeEvidencePointerV1 {
  const obj = closed(value, ['evidenceRef','originalEvidenceId','validatedJSONPointer'], factual ? ['observedAt','producerVersion'] : []);
  // New typed rows use a finite local ordinal scheme; the old receipt envelope is unchanged.
  if (typeof obj.evidenceRef !== 'string' || !/^evidence_(?:[1-9]|[1-4][0-9]|50)$/.test(obj.evidenceRef)
    || typeof obj.originalEvidenceId !== 'string' || !/^ev_[a-f0-9]{64}$/.test(obj.originalEvidenceId)
    || crosswalk.get(obj.evidenceRef) !== obj.originalEvidenceId || typeof obj.validatedJSONPointer !== 'string'
    || obj.validatedJSONPointer.length > 256) fail('REA_TECHNICAL_PROVENANCE_INVALID');
  return Object.freeze({ evidenceRef: obj.evidenceRef, originalEvidenceId: obj.originalEvidenceId, validatedJSONPointer: obj.validatedJSONPointer });
}
function factValue(value: unknown, key: string, rule: SafeFactRule): ReaTechnicalFact['value'] {
  if (rule.kind === 'count') {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) fail('REA_TECHNICAL_VALUE_INVALID');
    if ((key === 'capture-window-ms' || key === 'observation-window-ms') && value > 1000
      || key === 'observation-window-ms' && value < 1 || key === 'capture_bytes' && value > 33554432) fail('REA_TECHNICAL_VALUE_INVALID');
    return value;
  }
  if (rule.kind === 'boolean') {
    if (typeof value !== 'boolean' || rule.values && !rule.values.includes(value)) fail('REA_TECHNICAL_VALUE_INVALID');
    return value;
  }
  if (rule.kind === 'enum') {
    if (typeof value !== 'string' || value.length > 64 || !rule.values?.includes(value)) fail('REA_TECHNICAL_VALUE_INVALID');
    return value;
  }
  // Qualified version suffixes are not copied/stripped. A future producer omits just this
  // field with a typed omission notice when its actual value cannot use this narrow grammar.
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]{0,3})\.(?:0|[1-9][0-9]{0,3})\.(?:0|[1-9][0-9]{0,3})$/.test(value)) fail('REA_TECHNICAL_VALUE_INVALID');
  return value;
}
function parseTechnicalFact(value: unknown, profile: ReaProfile, crosswalk: ReadonlyMap<string,string>, receiptTime: string): ReaSafeTechnicalFactV1 {
  const obj = closed(value, ['key','label','value','scope','confidence','limitation','provenance']);
  if (typeof obj.key !== 'string' || obj.key.length > 80) fail('REA_TECHNICAL_FACT_INVALID');
  const rule = safeFactRules.get(obj.key);
  if (!rule || !rule.profiles.includes(profile) || obj.label !== rule.label || obj.scope !== rule.scope
    || obj.limitation !== rule.limitation) fail('REA_TECHNICAL_FACT_INVALID');
  const confidence = choice(obj.confidence, ['observed','derived','inferred'] as const);
  // Preserve confidence fixed by the original evidence family; projection cannot upgrade it.
  const fixedConfidence = featureCountKeys.has(obj.key) ? 'inferred'
    : ['web','electron-passive-runtime','runtime-observation'].includes(profile) || obj.key === 'apktool_version' ? 'observed'
    : ['static-managed','static-javascript','app-package'].includes(profile) || obj.key.startsWith('native_layout_')
      || ['apk_classes','apk_resources','apk_permissions','apk_signature_verified'].includes(obj.key) ? 'derived' : undefined;
  if (fixedConfidence !== undefined && confidence !== fixedConfidence) fail('REA_TECHNICAL_CONFIDENCE_INVALID');
  const base = evidencePointer(obj.provenance, crosswalk, true), provenance = record(obj.provenance);
  if (base.validatedJSONPointer !== rule.pointer || provenance.producerVersion !== 'rea-agents@6.5.0') fail('REA_TECHNICAL_PROVENANCE_INVALID');
  const observedAt = utc(provenance.observedAt);
  if (Date.parse(observedAt) > Date.parse(receiptTime)) fail('REA_TECHNICAL_PROVENANCE_INVALID');
  return frozen({key:obj.key,label:rule.label,value:factValue(obj.value,obj.key,rule),scope:rule.scope,confidence,limitation:rule.limitation,
    provenance:{...base,observedAt,producerVersion:'rea-agents@6.5.0' as const}});
}
function parseStructuralRelationship(value: unknown, profile: ReaProfile, crosswalk: ReadonlyMap<string,string>): ReaSafeStructuralRelationshipV1 {
  const obj = closed(value, ['id','sourceId','targetId','relation','scope','confidence','limitation','provenance']);
  if (!['static-javascript','static-managed'].includes(profile) || typeof obj.id !== 'string'
    || obj.scope !== 'producer-returned' || obj.confidence !== 'inferred' || obj.limitation !== relationshipLimitation) fail('REA_TECHNICAL_RELATION_INVALID');
  const semantic = /^jsrg_relation_[a-f0-9]{64}$/.test(obj.id);
  if (!semantic && !/^jag_edge_[a-f0-9]{64}$/.test(obj.id) || semantic && profile !== 'static-javascript') fail('REA_TECHNICAL_RELATION_INVALID');
  const nodePattern = semantic ? /^jsrg_node_[a-f0-9]{64}$/ : /^jag_node_[a-f0-9]{64}$/;
  if (typeof obj.sourceId !== 'string' || typeof obj.targetId !== 'string' || !nodePattern.test(obj.sourceId) || !nodePattern.test(obj.targetId)) fail('REA_TECHNICAL_RELATION_INVALID');
  const relation = semantic ? choice(obj.relation, REA_SEMANTIC_RELATIONS) : choice(obj.relation, REA_APPLICATION_RELATIONS);
  const provenance = evidencePointer(obj.provenance,crosswalk,false);
  const pointerPattern = semantic ? /^\/normalized_result\/relations\/(0|[1-9][0-9]{0,3})$/ : /^\/normalized_result\/graph\/edges\/(0|[1-9][0-9]{0,3})$/;
  if (!pointerPattern.test(provenance.validatedJSONPointer)) fail('REA_TECHNICAL_PROVENANCE_INVALID');
  return frozen({id:obj.id,sourceId:obj.sourceId,targetId:obj.targetId,relation,scope:'producer-returned' as const,
    confidence:'inferred' as const,limitation:relationshipLimitation,provenance});
}
function parseReport(value: unknown, crosswalk: ReadonlyMap<string,string>, receiptTime: string): ReaSafeResultProjectionV1 {
  const obj = closed(value, ['profile', 'sourceProjectionDigest', 'coverage', 'summary', 'spokenSummary', 'knowledgeMarkdown'],
    ['technicalFacts','structuralRelationships','technicalLimitations']);
  if (obj.coverage !== 'unverified' || Buffer.byteLength(JSON.stringify(obj), 'utf8') > 65536) fail();
  const profile = choice(obj.profile, REA_PROFILES);
  for (const field of ['technicalFacts','structuralRelationships','technicalLimitations']) {
    if (Object.hasOwn(obj,field) && (!Array.isArray(obj[field]) || (obj[field] as unknown[]).length > 20)) fail('REA_TECHNICAL_PROJECTION_LIMIT');
  }
  const facts = Object.hasOwn(obj,'technicalFacts') ? (obj.technicalFacts as unknown[]).map(row=>parseTechnicalFact(row,profile,crosswalk,receiptTime)) : undefined;
  const relationships = Object.hasOwn(obj,'structuralRelationships') ? (obj.structuralRelationships as unknown[]).map(row=>parseStructuralRelationship(row,profile,crosswalk)) : undefined;
  if ((facts?.length ?? 0) + (relationships?.length ?? 0) > 20
    || facts && new Set(facts.map(f=>f.key)).size !== facts.length || relationships && new Set(relationships.map(r=>r.id)).size !== relationships.length) fail('REA_TECHNICAL_PROJECTION_LIMIT');
  const omissions = Object.hasOwn(obj,'technicalLimitations') ? (obj.technicalLimitations as unknown[]).map(value=>choice(value,technicalOmissions)) : undefined;
  if (omissions && new Set(omissions).size !== omissions.length) fail('REA_TECHNICAL_PROJECTION_LIMIT');
  return frozen({ profile, sourceProjectionDigest: sha(obj.sourceProjectionDigest), coverage:'unverified' as const,
    summary:text(obj.summary,1200),spokenSummary:text(obj.spokenSummary,300),knowledgeMarkdown:text(obj.knowledgeMarkdown,65536),
    ...(facts?{technicalFacts:facts}:{}),...(relationships?{structuralRelationships:relationships}:{}),...(omissions?{technicalLimitations:omissions}:{}) });
}
function correlation(value: unknown): ReaReceiptCorrelationV1 {
  const obj = closed(snapshotReaJson(value), ['identity', 'toolRunId', 'auditEventId', 'selectionRef', 'selectionRevision', 'inputDigest']);
  return { identity: parseReaExecutionIdentity(obj.identity), toolRunId: id(obj.toolRunId), auditEventId: id(obj.auditEventId),
    selectionRef: id(obj.selectionRef), selectionRevision: positive(obj.selectionRevision), inputDigest: sha(obj.inputDigest) };
}
/** Read only from an authorized persisted source. expected must come from its actual audit/tool/task crosswalk.
 * This validates data, not execution authority. It neither calls isReaSafeReport nor restores its WeakSet brand.
 * Timestamps must be captured by the producer; ordering cannot prove a clock was genuinely observed. */
export function parseReaExecutionReceipt(value: unknown, expected: ReaReceiptCorrelationV1): ReaExecutionReceiptV1 {
  const obj = closed(snapshotReaJson(value), ['schemaVersion', 'toolId', 'identity', 'toolRunId', 'auditEventId', 'selectionRef',
    'selectionRevision', 'inputDigest', 'finishedAt', 'receiptObservedAt', 'outcome', 'reasonCode', 'cleanup', 'evidenceIndex'],
  ['report', 'reportDigest', 'observedMetrics']);
  if (obj.schemaVersion !== 1 || obj.toolId !== 'rea_analysis' || Buffer.byteLength(JSON.stringify(obj), 'utf8') > 98304) fail();
  const actual = correlation({ identity: obj.identity, toolRunId: obj.toolRunId, auditEventId: obj.auditEventId,
    selectionRef: obj.selectionRef, selectionRevision: obj.selectionRevision, inputDigest: obj.inputDigest });
  if (reaProjectionDigest(actual) !== reaProjectionDigest(correlation(expected))) fail('REA_RECEIPT_CROSSWALK_MISMATCH');
  const finishedAt = utc(obj.finishedAt), receiptObservedAt = utc(obj.receiptObservedAt);
  if (Date.parse(receiptObservedAt) < Date.parse(finishedAt)) fail('REA_RECEIPT_TIME_INVALID');
  const outcome = choice(obj.outcome, ['completed', 'partial', 'blocked', 'failed', 'unknown_effect', 'configuration_required', 'not_available', 'clarification_required'] as const);
  const cleanupObj = closed(obj.cleanup, ['closed', 'unknownEffect']);
  if (typeof cleanupObj.closed !== 'boolean' || typeof cleanupObj.unknownEffect !== 'boolean') fail();
  const cleanup = { closed: cleanupObj.closed, unknownEffect: cleanupObj.unknownEffect };
  if ((outcome === 'completed' || outcome === 'partial') && (!cleanup.closed || cleanup.unknownEffect)) fail();
  if (!Array.isArray(obj.evidenceIndex) || obj.evidenceIndex.length > 50) fail();
  const refs = new Set<string>(), originals = new Set<string>();
  const evidenceIndex = obj.evidenceIndex.map(value => {
    const row = closed(value, ['ref', 'originalEvidenceId']);
    const ref = id(row.ref);
    if (typeof row.originalEvidenceId !== 'string' || !/^ev_[a-f0-9]{64}$/.test(row.originalEvidenceId)
      || refs.has(ref) || originals.has(row.originalEvidenceId)) fail();
    refs.add(ref); originals.add(row.originalEvidenceId);
    return { ref, originalEvidenceId: row.originalEvidenceId };
  });
  const hasReport = Object.hasOwn(obj, 'report');
  if ((outcome === 'completed' || outcome === 'partial') && !hasReport) fail('REA_RECEIPT_REPORT_REQUIRED');
  if (hasReport !== Object.hasOwn(obj, 'reportDigest')) fail();
  const report = hasReport ? parseReport(obj.report,new Map(evidenceIndex.map(row=>[row.ref,row.originalEvidenceId])),receiptObservedAt) : undefined;
  const reportDigest = hasReport ? sha(obj.reportDigest) : undefined;
  if (report && (reaProjectionDigest(report) !== reportDigest || evidenceIndex.length === 0)) fail('REA_REPORT_DIGEST_INVALID');
  let observedMetrics: TaskObservedMetricsV1 | undefined;
  if (Object.hasOwn(obj, 'observedMetrics')) {
    const metrics = obj.observedMetrics;
    if (!report || !isTaskObservedMetricsV1(metrics, [{ name: 'rea.verified_evidence_records', unit: 'count' }])
      || metrics.attempt !== actual.identity.attempt || metrics.clock !== 'adapter_receipt' || metrics.observedAt !== receiptObservedAt
      || metrics.coverage !== 'partial' || metrics.scope.stepId !== actual.identity.stepId
      || metrics.scope.targetRefId !== undefined && metrics.scope.targetRefId !== actual.selectionRef
      || metrics.values.length !== 1 || metrics.values[0].value !== evidenceIndex.length
      || metrics.evidenceRefs.some(ref => !refs.has(ref))) fail('REA_RECEIPT_METRICS_INVALID');
    observedMetrics = metrics;
  }
  return frozen({ schemaVersion: 1, toolId: 'rea_analysis', ...actual, finishedAt, receiptObservedAt, outcome,
    reasonCode: code(obj.reasonCode), cleanup, evidenceIndex, ...(report ? { report, reportDigest } : {}),
    ...(observedMetrics ? { observedMetrics } : {}) });
}

/** Trusted backend callbacks must read these from actual task state each time; JSON booleans are not grants.
 * Volatile voice generation/utterance/panel state is intentionally absent after canonical admission. */
export interface ReaTaskCurrentStateV1 {
  readonly ownerActive: boolean;
  readonly workspaceCurrent: boolean;
  readonly targetCurrent: boolean;
  readonly killSwitchActive: boolean;
  readonly runtimeQualified: boolean;
  readonly aborted: boolean;
  readonly bootCurrent: boolean;
  readonly expiresAt: number;
}
export function assertReaTaskCurrent(state: ReaTaskCurrentStateV1, now: number): void {
  if (state.ownerActive !== true || state.workspaceCurrent !== true || state.targetCurrent !== true
    || state.killSwitchActive !== false || state.runtimeQualified !== true || state.aborted !== false || state.bootCurrent !== true
    || !Number.isSafeInteger(now) || !Number.isSafeInteger(state.expiresAt) || now < 0 || state.expiresAt <= now) fail('REA_TASK_NOT_CURRENT');
}
/** Delivery adds current voice/mute checks; failure here is never a task revoke/cancel operation. */
export function assertReaVoiceDeliveryCurrent(state: ReaTaskCurrentStateV1,
  voice: Readonly<{ sessionCurrent: boolean; commandCurrent: boolean; muted: boolean }>, now: number): void {
  assertReaTaskCurrent(state, now);
  if (voice.sessionCurrent !== true || voice.commandCurrent !== true || voice.muted !== false) fail('REA_VOICE_DELIVERY_NOT_CURRENT');
}
