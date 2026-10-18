import { createHash } from 'node:crypto';
import { types } from 'node:util';

export const REA_PROFILES = Object.freeze([
  'static-javascript', 'static-managed', 'app-package', 'native-binary',
  'static-apk', 'apk-resources', 'web', 'electron-passive-runtime', 'runtime-observation',
] as const);
export type ReaProfile = typeof REA_PROFILES[number];
export interface ReaAnalysisInput {
  schemaVersion: 1;
  selectionRef: string;
  profile: ReaProfile;
  objective: string;
  exportAuthorizationRef?: string;
  profileOptions?: ReaProfileOptions;
  featureQuery?: ReaFeatureQuery;
}
export type ReaProfileOptions = { procedure?: string; includePseudocode?: boolean; includeLayout?: boolean; query?: string; className?: string; methodName?: string; overloadIndex?: number; traceReferences?: boolean; includeStrings?: boolean; locale?: string };
export type ReaApplicationSeed =
  | { kind: 'node-id'; value: string; match: 'exact'; caseSensitive: true }
  | { kind: 'string' | 'route' | 'channel' | 'module' | 'native-export'; value: string; match: 'exact' | 'contains'; caseSensitive: boolean }
  | { kind: 'api'; value: string; match: 'exact' | 'contains'; caseSensitive: boolean; entryPath?: readonly string[] };
export type ReaSemanticSeed =
  | { kind: 'semantic-node' | 'application-node'; nodeId: string }
  | { kind: 'literal'; value: string | number | boolean | null }
  | { kind: 'function'; fingerprintSha256: string }
  | { kind: 'property' | 'event'; name: string }
  | { kind: 'endpoint'; value: string }
  | { kind: 'boundary-field'; field: string };
export type ReaFeatureQuery =
  | { kind: 'application-feature'; description: string; seed: ReaApplicationSeed; direction: 'outgoing' | 'incoming' | 'both'; managedTypeNames?: readonly string[] }
  | { kind: 'javascript-semantics'; description: string; seed: ReaSemanticSeed; direction: 'backward-provenance' | 'forward-influence' | 'callers' | 'ownership'; allowedRelations?: readonly string[]; includeAmbiguousDynamicEdges: false };
export interface ReaLocalConfiguration {
  readonly hostPlatform: 'win32' | 'linux' | 'darwin'; readonly architecture: string;
  readonly appPackage?: { readonly qualificationRef: string; readonly allowedFormats: readonly string[]; readonly targetKind: 'archive' | 'artifact'; readonly targetFormat: string; readonly targetSha256: string };
  readonly native?: { readonly providerId: 'ghidra' | 'ida' | 'hopper'; readonly qualificationRef: string; readonly headless: boolean; readonly version?: string; readonly windowsNativeReady: boolean; readonly allowNetwork?: boolean; readonly allowUi?: boolean; readonly targetKind: 'executable' | 'database'; readonly targetFormat: string; readonly targetSha256: string; readonly targetArchitecture?: string; readonly managed?: boolean };
  readonly android?: { readonly qualificationRef: string; readonly jadxJarSha256: string; readonly javaMajor: number; readonly jdkCompiler: boolean; readonly windowsNativeReady: boolean };
  readonly apkResources?: { readonly qualificationRef: string; readonly launcherVersion: string; readonly launcherSource: 'environment' | 'path'; readonly javaQualified: boolean };
}
export interface ReaLocalFlowContext {
  readonly targetPath: string; readonly targetSha256: string; readonly workDirectory: string;
  readonly input: Readonly<ReaAnalysisInput>; readonly configuration: Readonly<ReaLocalConfiguration>;
  assertCurrent(): void;
  requireAvailable(name: string): Promise<void>;
  callTool(name: string, args: Readonly<Record<string, unknown>>): Promise<unknown>;
}
export interface ReaStructuralRelationship {
  readonly id: string; readonly sourceId: string; readonly targetId: string; readonly relation: string;
  readonly label?: string; readonly jsonPointer: string; readonly evidenceId: string;
  readonly confidence: 'observed' | 'derived' | 'inferred'; readonly limitation: string;
}
export interface ReaLocalFlowResult {
  readonly evidence: ValidatedReaEvidence; readonly technicalFacts: readonly ReaTechnicalFact[];
  readonly sourceCoverage: 'complete' | 'partial' | 'unavailable' | 'unknown';
  readonly evidenceKind: 'summary-view' | 'analysis' | 'feature-trace'; readonly evidenceRefs: readonly string[];
  readonly relationships?: readonly ReaStructuralRelationship[];
}
export type ReaRemoteProfile = 'web' | 'electron-passive-runtime' | 'runtime-observation';
export type ReaDeepReadonly<T> = T extends object ? { readonly [K in keyof T]: ReaDeepReadonly<T[K]> } : T;
interface ReaRemoteBindingScope {
  readonly ownerId: string; readonly workspaceId: string; readonly taskId: string; readonly runId: string;
  readonly serverBootId: string; readonly sessionId: string; readonly qualificationRef: string; readonly expiresAt: number;
}
export type ReaRemoteSelectionBinding = ReaRemoteBindingScope & (
  | { readonly profile: 'web'; readonly target: { readonly kind: 'retained-har'; readonly workspaceRoot: string; readonly absolutePath: string; readonly sha256: string }; readonly permission: { readonly kind: 'historical-capture'; readonly network: 'none'; readonly actions: readonly [] } }
  | { readonly profile: 'web'; readonly target: { readonly kind: 'web-url'; readonly url: string }; readonly permission: { readonly kind: 'url-selection'; readonly network: 'public-url'; readonly actions: readonly [] } }
  | { readonly profile: 'electron-passive-runtime'; readonly target: { readonly kind: 'electron-page'; readonly cdpEndpoint: string; readonly targetId: string; readonly expectedFilePath: string; readonly observationMs: number }; readonly permission: { readonly kind: 'passive-cdp'; readonly network: 'selected-cdp-only'; readonly endpointTargetMetadata: true; readonly fileMetadata: true; readonly actions: readonly [] } }
  | { readonly profile: 'runtime-observation'; readonly target: { readonly kind: 'web-execution'; readonly cdpEndpoint: string; readonly targetId: string; readonly allowedOrigin: string; readonly observationMs: number }; readonly permission: { readonly kind: 'instrumented-cdp'; readonly network: 'selected-cdp-only'; readonly endpointTargetMetadata: true; readonly resetsExecutionCounters: true; readonly disablesOptimizedExecution: true; readonly actions: readonly [] } }
);
export interface ReaRemoteTarget { readonly binding: ReaDeepReadonly<ReaRemoteSelectionBinding>; readonly admittedAt: number }
export interface ReaRemoteFlowContext {
  readonly target: ReaRemoteTarget; readonly input: Readonly<ReaAnalysisInput>; readonly capturePath?: string;
  assertCurrent(): void;
  requireAvailable(name: string): Promise<void>;
  callTool(name: string, args: Readonly<Record<string, unknown>>): Promise<unknown>;
}
export interface ReaRemoteFlowResult extends ReaLocalFlowResult {
  readonly providerCleanup: 'confirmed' | 'unverified';
  readonly observationKind: 'historical-capture' | 'passive-runtime' | 'instrumented-runtime';
}
export interface ValidatedReaEvidence {
  originalEvidenceId: string;
  providerVersion: string | null;
  confidence: 'observed' | 'derived' | 'inferred';
  limitationsCount: number;
}
export class ReaContractError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'ReaContractError';
  }
}
function fail(code = 'REA_EVIDENCE_INVALID'): never { throw new ReaContractError(code); }
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type RecordValue = { [key: string]: Json };

/** Independent snapshot before inspection/hash: no getters, proxies, hooks or inherited data.
 * EDITH intentionally narrows upstream JSON depth 1000 to 128 and total size to 4 MiB.
 */
function snapshot(root: unknown): Json {
  const ancestors = new Set<object>();
  let bytes = 0;
  let nodes = 0;
  const charge = (size: number) => { bytes += size; if (bytes > 4194304) fail('REA_REPLY_TOO_LARGE'); };
  function visit(value: unknown, depth: number): Json {
    if (++nodes > 100000 || depth > 128) fail('REA_JSON_UNSAFE');
    if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
      if (typeof value === 'number' && !Number.isFinite(value)) fail('REA_JSON_UNSAFE');
      if (typeof value === 'string' && value.length > 4194304) fail('REA_REPLY_TOO_LARGE');
      charge(Buffer.byteLength(JSON.stringify(value), 'utf8'));
      return value as null | boolean | number | string;
    }
    if (typeof value !== 'object' || types.isProxy(value)) fail('REA_JSON_UNSAFE');
    if (ancestors.has(value)) fail('REA_JSON_UNSAFE');
    const array = Array.isArray(value);
    if (!array && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) fail('REA_JSON_UNSAFE');
    ancestors.add(value);
    charge(2);
    if (array) {
      if (value.length > 100000 || Reflect.ownKeys(value).length !== value.length + 1) fail('REA_JSON_UNSAFE');
      const out: Json[] = [];
      for (let i = 0; i < value.length; i++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
        if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) fail('REA_JSON_UNSAFE');
        if (i) charge(1);
        out.push(visit(descriptor.value, depth + 1));
      }
      ancestors.delete(value);
      return out;
    }
    const out: RecordValue = Object.create(null);
    let index = 0;
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string' || ['__proto__', 'prototype', 'constructor'].includes(key)) fail('REA_JSON_UNSAFE');
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail('REA_JSON_UNSAFE');
      charge(Buffer.byteLength(JSON.stringify(key), 'utf8') + 1 + (index++ ? 1 : 0));
      out[key] = visit(descriptor.value, depth + 1);
    }
    ancestors.delete(value);
    return out;
  }
  return visit(root, 0);
}
/** Public boundary helper; retains the same byte/depth/descriptor/proxy guards. */
export function snapshotReaJson(value: unknown): unknown { return snapshot(value); }
function record(value: Json): RecordValue {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail();
  return value as RecordValue;
}
function strict(value: Json, required: string[], optional: string[] = []): RecordValue {
  const obj = record(value);
  if (required.some(key => !Object.hasOwn(obj, key)) || Object.keys(obj).some(key => !required.includes(key) && !optional.includes(key))) fail();
  return obj;
}
function str(value: Json, min = 0): asserts value is string {
  if (typeof value !== 'string' || value.length < min) fail();
}
function choice(value: Json, choices: readonly string[]): void {
  if (typeof value !== 'string' || !choices.includes(value)) fail();
}
function strings(value: Json, minLength = 0, minString = 0): void {
  if (!Array.isArray(value) || value.length < minLength) fail();
  for (const item of value as Json[]) str(item, minString);
}
function digest(value: Json, prefix = ''): void {
  if (typeof value !== 'string' || !(new RegExp(`^${prefix}[a-f0-9]{64}$`, 'u')).test(value)) fail();
}
function canonical(value: Json): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key]!)}`).join(',')}}`;
  return JSON.stringify(value);
}
const hash = (value: Json) => createHash('sha256').update(canonical(value)).digest('hex');

export function parseReaAnalysisInput(value: unknown): ReaAnalysisInput {
  try {
    const obj = strict(snapshot(value), ['schemaVersion', 'selectionRef', 'profile', 'objective'], ['exportAuthorizationRef', 'profileOptions', 'featureQuery']);
    if (obj.schemaVersion !== 1) fail();
    choice(obj.profile!, REA_PROFILES);
    const opaque = (ref: Json) => { if (typeof ref !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(ref)) fail(); };
    opaque(obj.selectionRef!);
    if (Object.hasOwn(obj, 'exportAuthorizationRef')) opaque(obj.exportAuthorizationRef!);
    str(obj.objective!, 1);
    const objective = (obj.objective as string).trim();
    if (!objective || objective.length > 2000) fail();
    const profile = obj.profile as ReaProfile;
    const profileOptions = Object.hasOwn(obj, 'profileOptions') ? parseProfileOptions(obj.profileOptions!, profile) : undefined;
    const featureQuery = Object.hasOwn(obj, 'featureQuery') ? parseFeatureQuery(obj.featureQuery!, profile) : undefined;
    return Object.freeze({ schemaVersion: 1, selectionRef: obj.selectionRef as string, profile, objective, ...(obj.exportAuthorizationRef === undefined ? {} : { exportAuthorizationRef: obj.exportAuthorizationRef as string }), ...(profileOptions === undefined ? {} : { profileOptions }), ...(featureQuery === undefined ? {} : { featureQuery }) });
  } catch { throw new ReaContractError('REA_INPUT_INVALID'); }
}
function bounded(value: Json, minimum = 1, maximum = 256): void {
  str(value, minimum); if (value.length > maximum || /[\x00-\x1f\x7f]/.test(value)) fail();
}
function parseProfileOptions(value: Json, profile: ReaProfile): ReaProfileOptions {
  const keys = ['app-package', 'web', 'electron-passive-runtime', 'runtime-observation'].includes(profile) ? [] : profile === 'native-binary' ? ['procedure', 'includePseudocode', 'includeLayout'] : profile === 'static-apk' ? ['query', 'className', 'methodName', 'overloadIndex', 'traceReferences'] : profile === 'apk-resources' ? ['includeStrings', 'locale'] : fail();
  const obj = strict(value, [], keys);
  for (const key of ['includePseudocode', 'includeLayout', 'traceReferences', 'includeStrings']) if (Object.hasOwn(obj, key) && typeof obj[key] !== 'boolean') fail();
  for (const key of ['procedure', 'className', 'methodName']) if (Object.hasOwn(obj, key)) bounded(obj[key]!);
  if (Object.hasOwn(obj, 'query')) bounded(obj.query!, 0);
  if (Object.hasOwn(obj, 'overloadIndex') && (typeof obj.overloadIndex !== 'number' || !Number.isSafeInteger(obj.overloadIndex) || obj.overloadIndex < 0)) fail();
  if ((obj.methodName !== undefined && obj.className === undefined) || (obj.overloadIndex !== undefined && obj.methodName === undefined) || (obj.traceReferences === true && obj.className === undefined) || (obj.includePseudocode === true && obj.procedure === undefined)) fail();
  if (Object.hasOwn(obj, 'locale')) {
    bounded(obj.locale!, 2, 16);
    if (!/^(?:[a-z]{2,3}(?:-(?:r?[A-Z]{2}|r?[0-9]{3}))?|b\+[a-z]{2,3}(?:\+[A-Za-z0-9]{2,8})*)$/.test(obj.locale as string) || ['car', 'desk', 'television', 'appliance', 'watch', 'vrheadset', 'night', 'notnight'].includes(obj.locale as string)) fail();
  }
  return Object.freeze({ ...obj }) as ReaProfileOptions;
}
export const REA_SEMANTIC_RELATIONS = Object.freeze(['acquires','aggregates','aliases','argument-to-parameter','awaits','calls','cancels-timer','captures','chains','coerces','connects-stdio','consumed-by','constructs-request','creates-promise','defaults','defines','destructures','detaches-task','dispatches-candidate','forwards-signal','listens-error','listens-exit','owns','overrides','parses','reads','reads-argv','reads-config','reads-environment','reads-property','registers-listener','releases','removes-listener','returns-task','returns-to-call','schedules-timer','spawns','spreads','supplies-argv','supplies-env','supplies-request-field','validates','writes','writes-property'] as const);
export const REA_APPLICATION_RELATIONS = Object.freeze(['contains','loads','imports','maps_to','exposes','sends','invokes','handles','calls','persists_to','observed_as','changed_from'] as const);
function parseFeatureQuery(value: Json, profile: ReaProfile): ReaFeatureQuery {
  if (!['static-javascript', 'static-managed'].includes(profile)) fail();
  const obj = record(value);
  const semantic = obj.kind === 'javascript-semantics';
  strict(obj, ['kind', 'description', 'seed', 'direction', ...(semantic ? ['includeAmbiguousDynamicEdges'] : [])], semantic ? ['allowedRelations'] : ['managedTypeNames']);
  choice(obj.kind!, ['application-feature', 'javascript-semantics']);
  str(obj.description!, 1); const description = (obj.description as string).trim(); if (!description || description.length > 1000) fail();
  const seed = record(obj.seed!);
  if (!semantic) {
    strict(seed, ['kind', 'value', 'match', 'caseSensitive'], seed.kind === 'api' ? ['entryPath'] : []);
    choice(seed.kind!, ['node-id', 'string', 'route', 'channel', 'module', 'api', 'native-export']); choice(seed.match!, ['exact', 'contains']);
    bounded(seed.value!, seed.match === 'exact' && seed.kind !== 'node-id' ? 0 : 1);
    if (typeof seed.caseSensitive !== 'boolean') fail();
    if (seed.kind === 'node-id') { digest(seed.value!, 'jag_node_'); if (seed.match !== 'exact' || seed.caseSensitive !== true) fail(); }
    if (Object.hasOwn(seed, 'entryPath')) { if (!Array.isArray(seed.entryPath) || !seed.entryPath.length || seed.entryPath.length > 16) fail(); for (const part of seed.entryPath as Json[]) bounded(part, 0); }
    if (profile === 'static-managed' && !['node-id', 'string'].includes(seed.kind as string)) fail();
    if (Object.hasOwn(obj, 'managedTypeNames')) { if (profile !== 'static-managed' || !Array.isArray(obj.managedTypeNames) || !obj.managedTypeNames.length || obj.managedTypeNames.length > 20 || new Set(obj.managedTypeNames).size !== obj.managedTypeNames.length) fail(); for (const name of obj.managedTypeNames as Json[]) bounded(name); }
    choice(obj.direction!, ['outgoing', 'incoming', 'both']);
  } else {
    if (profile !== 'static-javascript' || obj.includeAmbiguousDynamicEdges !== false) fail();
    choice(obj.direction!, ['backward-provenance', 'forward-influence', 'callers', 'ownership']);
    choice(seed.kind!, ['semantic-node', 'application-node', 'literal', 'function', 'property', 'endpoint', 'event', 'boundary-field']);
    const field = ['semantic-node', 'application-node'].includes(seed.kind as string) ? 'nodeId' : seed.kind === 'function' ? 'fingerprintSha256' : ['property', 'event'].includes(seed.kind as string) ? 'name' : seed.kind === 'boundary-field' ? 'field' : 'value';
    strict(seed, ['kind', field]);
    if (field === 'nodeId') digest(seed[field]!, seed.kind === 'semantic-node' ? 'jsrg_node_' : 'jag_node_');
    else if (field === 'fingerprintSha256') digest(seed[field]!);
    else if (seed.kind !== 'literal') bounded(seed[field]!);
    else if (typeof seed.value === 'string') bounded(seed.value, 0);
    else if (seed.value !== null && typeof seed.value !== 'number' && typeof seed.value !== 'boolean') fail();
    if (Object.hasOwn(obj, 'allowedRelations')) { if (!Array.isArray(obj.allowedRelations) || !obj.allowedRelations.length || obj.allowedRelations.length > REA_SEMANTIC_RELATIONS.length || new Set(obj.allowedRelations).size !== obj.allowedRelations.length) fail(); for (const relation of obj.allowedRelations as Json[]) choice(relation, REA_SEMANTIC_RELATIONS); }
  }
  const freeze = (v: Json): void => { if (v && typeof v === 'object') { for (const child of Object.values(v)) freeze(child); Object.freeze(v); } };
  const parsed = { ...obj, seed: { ...seed }, description }; freeze(parsed); return parsed as unknown as ReaFeatureQuery;
}
const formats = ['hopper', 'analysis-database', 'mach-o', 'elf', 'pe', 'dos-mz', 'dos-com', 'raw-binary', 'zip', 'ipa', 'apk', 'msix', 'appx', 'hap', 'hsp', 'app-pack', 'asar', 'dmg', 'pkg', 'plist', 'javascript', 'source-map', 'directory', 'file', 'unknown', 'mach-o-universal', 'javascript-bundle', 'entitlements'];
const architectures = ['x86', 'x86_64', 'arm', 'arm64', 'mips', '6502', 'riscv', 'powerpc'];
function provider(value: Json, committed = false): RecordValue {
  const obj = strict(value, ['id', 'name', 'version']);
  str(obj.id!, 1); str(obj.name!, 1);
  if (committed || obj.version !== null) str(obj.version!, committed ? 1 : 0);
  return obj;
}
function coverage(value: Json): void {
  if (value === null) return;
  const obj = record(value);
  const optional = ['diagnostics', ...(obj.status === 'complete' ? [] : ['limited_directions'])];
  if (obj.status === 'complete') strict(obj, ['status'], optional);
  else if (obj.status === 'partial') { strict(obj, ['status', 'limitations'], optional); strings(obj.limitations!, 1, 1); }
  else if (obj.status === 'unknown') { strict(obj, ['status', 'reason'], optional); str(obj.reason!, 1); }
  else fail();
  if (Object.hasOwn(obj, 'diagnostics')) strings(obj.diagnostics!, 1, 1);
  if (Object.hasOwn(obj, 'limited_directions')) {
    const directions = obj.limited_directions;
    if (!Array.isArray(directions) || !['["callers"]', '["callees"]', '["callers","callees"]'].includes(JSON.stringify(directions))) fail();
  }
}

/** Release 6.5.0 Evidence shape + semantic ID; only bounded provenance is returned.
 * Source: dist/domain/evidence.js semanticProjection/computeEvidenceId and referenced schemas.
 */
export function validateReaEvidence(value: unknown, expected: { sha256: string; operation: string }): ValidatedReaEvidence {
  if (typeof expected?.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(expected.sha256)) fail('REA_EVIDENCE_BINDING_MISMATCH');
  return validateEvidenceEnvelope(value, expected);
}
/** Null subjects are admitted only by narrowly scoped wrappers below. */
function validateEvidenceEnvelope(value: unknown, expected: { sha256: string | null; operation: string }): ValidatedReaEvidence {
  const obj = strict(snapshot(value), ['evidence_id', 'subject', 'provider', 'analysis_profile', 'predicate_type', 'operation', 'parameters', 'raw_result', 'normalized_result', 'confidence', 'authority', 'environment', 'limitations', 'locations', 'evidence_links'], ['relationship_coverage']);
  digest(obj.evidence_id!, 'ev_');
  let semanticSubject: Json = null;
  if (expected.sha256 === null) { if (obj.subject !== null) fail('REA_EVIDENCE_BINDING_MISMATCH'); }
  else {
    const subject = strict(obj.subject!, ['name', 'digest', 'local_path', 'format', 'architecture']);
    str(subject.name!, 1); str(subject.local_path!);
    if ((subject.local_path as string).includes('\0')) fail();
    const subjectDigest = strict(subject.digest!, ['sha256']); digest(subjectDigest.sha256!);
    choice(subject.format!, formats);
    if (subject.architecture !== null) choice(subject.architecture!, subject.format === 'raw-binary' ? architectures : architectures.filter(item => item !== '6502'));
    if (subjectDigest.sha256 !== expected.sha256) fail('REA_EVIDENCE_BINDING_MISMATCH');
    semanticSubject = { digest: subjectDigest, format: subject.format!, architecture: subject.architecture! };
  }
  const identity = provider(obj.provider!);
  if (obj.analysis_profile !== null) {
    const profile = strict(obj.analysis_profile!, ['provider', 'parameters', 'digest']);
    const committed = provider(profile.provider!, true); record(profile.parameters!); digest(profile.digest!);
    if (profile.digest !== hash({ provider: committed, parameters: profile.parameters! }) || ['id', 'name', 'version'].some(key => committed[key] !== identity[key])) fail();
  }
  str(obj.predicate_type!, 1); str(obj.operation!, 1); record(obj.parameters!);
  choice(obj.confidence!, ['observed', 'derived', 'inferred']);
  choice(obj.authority!, ['shipped-artifact', 'controlled-replay', 'historical-reference', 'external-service', 'analyst-inference']);
  if (obj.environment !== null) {
    const environment = strict(obj.environment!, ['id', 'platform', 'architecture', 'isolation']);
    str(environment.id!, 1); str(environment.platform!, 1); str(environment.architecture!, 1);
    choice(environment.isolation!, ['none', 'process', 'container', 'virtual-machine']);
  }
  strings(obj.limitations!);
  coverage(obj.relationship_coverage ?? null);
  if (!Array.isArray(obj.locations) || !Array.isArray(obj.evidence_links)) fail();
  for (const location of obj.locations as Json[]) {
    const loc = record(location);
    const kind = loc.kind;
    if (kind === 'address') { strict(loc, ['kind', 'address']); str(loc.address!, 1); }
    else if (kind === 'address-range') { strict(loc, ['kind', 'start', 'end']); str(loc.start!, 1); str(loc.end!, 1); }
    else if (kind === 'artifact-path') { strict(loc, ['kind', 'path']); str(loc.path!, 1); }
    else if (kind === 'file-offset' || kind === 'file-offset-range') {
      const keys = kind === 'file-offset' ? ['offset'] : ['start', 'end'];
      strict(loc, ['kind', ...keys]);
      for (const key of keys) if (typeof loc[key] !== 'number' || !Number.isSafeInteger(loc[key]) || (loc[key] as number) < 0) fail();
    } else fail();
  }
  for (const link of obj.evidence_links as Json[]) digest(link, 'ev_');
  if (typeof expected.operation !== 'string' || !expected.operation || obj.operation !== expected.operation) fail('REA_EVIDENCE_BINDING_MISMATCH');
  const { evidence_id: ignored, relationship_coverage: relationshipCoverage, ...semantic } = obj;
  semantic.subject = semanticSubject;
  if (relationshipCoverage !== undefined && relationshipCoverage !== null) semantic.relationship_coverage = relationshipCoverage;
  if (`ev_${hash(semantic)}` !== obj.evidence_id) fail('REA_EVIDENCE_ID_MISMATCH');
  const version = identity.version;
  return Object.freeze({ originalEvidenceId: obj.evidence_id as string, providerVersion: typeof version === 'string' && /^[0-9]{1,6}\.[0-9]{1,6}\.[0-9]{1,6}(?:-[A-Za-z0-9][A-Za-z0-9.-]{0,31})?$/.test(version) ? version : null, confidence: obj.confidence as ValidatedReaEvidence['confidence'], limitationsCount: (obj.limitations as Json[]).length });
}

/** Source-pinned remote operations only. HAR alone retains an authenticated file subject.
 * Parameters commit the source service's parsed projection, not tool presentation fields.
 */
export function validateReaRemoteEvidence(value: unknown, expected: {
  operation: 'inspect_web_network_capture' | 'inspect_electron_page' | 'observe_web_execution';
  parameters: Readonly<Record<string, unknown>>; providerId: string; providerVersion: string;
  captureSha256?: string; capturePath?: string;
}): ValidatedReaEvidence {
  const obj = record(snapshot(value));
  const pins = {
    inspect_web_network_capture: ['har-schema/lossless-json', 'REA HAR capture adapter', 'har-schema@2.0.0;jsonc-parser@3.3.1;lossless-json@4.3.1', 'rea.analysis', 'historical-reference'],
    inspect_electron_page: ['rea-cdp-electron', 'REA Electron file-page CDP observation provider', '1', 'rea.electron-page-inspection', 'external-service'],
    observe_web_execution: ['rea-cdp-browser', 'REA Chrome DevTools Protocol observation provider', '2', 'rea.observe-web-execution', 'external-service'],
  } as const;
  if (!expected || !Object.hasOwn(pins, expected.operation)) fail('REA_REMOTE_EVIDENCE_INVALID');
  const pin = pins[expected.operation]; const har = expected.operation === 'inspect_web_network_capture';
  if (expected.providerId !== pin[0] || expected.providerVersion !== pin[2]) fail('REA_REMOTE_EVIDENCE_INVALID');
  if (har && (typeof expected.captureSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(expected.captureSha256) || typeof expected.capturePath !== 'string' || !expected.capturePath || expected.capturePath.includes('\0'))) fail('REA_EVIDENCE_BINDING_MISMATCH');
  if (!har && (expected.captureSha256 !== undefined || expected.capturePath !== undefined)) fail('REA_EVIDENCE_BINDING_MISMATCH');
  const validated = validateEvidenceEnvelope(obj, { sha256: har ? expected.captureSha256! : null, operation: expected.operation });
  const identity = record(obj.provider!);
  if (identity.id !== pin[0] || identity.name !== pin[1] || identity.version !== pin[2] || obj.predicate_type !== pin[3] || obj.authority !== pin[4] || obj.confidence !== 'observed'
    || obj.analysis_profile !== null || obj.raw_result !== null || canonical(record(obj.parameters!)) !== canonical(record(snapshot(expected.parameters)))
    || (obj.evidence_links as Json[]).length) fail('REA_REMOTE_EVIDENCE_INVALID');
  if (har) {
    const subject = record(obj.subject!);
    if (subject.local_path !== expected.capturePath || subject.format !== 'file' || subject.architecture !== null || obj.environment !== null) fail('REA_EVIDENCE_BINDING_MISMATCH');
    const locations = obj.locations as Json[];
    if (locations.length !== 1 || canonical(locations[0]!) !== canonical({ kind: 'artifact-path', path: expected.capturePath! })) fail('REA_EVIDENCE_BINDING_MISMATCH');
  } else {
    if ((obj.locations as Json[]).length) fail('REA_REMOTE_EVIDENCE_INVALID');
    if (expected.operation === 'observe_web_execution' && obj.environment !== null) fail('REA_REMOTE_EVIDENCE_INVALID');
    if (expected.operation === 'inspect_electron_page') {
      const environment = record(obj.environment!);
      if (environment.platform !== 'unknown' || environment.architecture !== 'unknown' || environment.isolation !== 'none') fail('REA_REMOTE_EVIDENCE_INVALID');
    }
  }
  // These exact source-pinned identifiers include composite/non-semver versions.
  return Object.freeze({ ...validated, providerVersion: pin[2] });
}

/** Exact target-free Apktool qualification observation, never arbitrary null-subject Evidence. */
export function validateReaApktoolClientEvidence(value: unknown, expected: { version: string }): ValidatedReaEvidence {
  const obj = record(snapshot(value));
  const result = validateEvidenceEnvelope(obj, { sha256: null, operation: 'inspect_apktool_client' });
  const identity = record(obj.provider!);
  if (typeof expected?.version !== 'string' || !/^\d{1,6}\.\d{1,6}\.\d{1,6}$/.test(expected.version)
    || identity.id !== 'apktool' || identity.name !== 'Apktool' || identity.version !== expected.version
    || obj.predicate_type !== 'rea.analysis' || obj.confidence !== 'observed' || obj.authority !== 'shipped-artifact'
    || obj.analysis_profile !== null || obj.environment !== null || obj.raw_result !== null
    || Object.keys(record(obj.parameters!)).length || (obj.locations as Json[]).length || (obj.evidence_links as Json[]).length) fail('REA_APKTOOL_CLIENT_INVALID');
  return result;
}

/** Authenticate the returned summary view envelope and its self-reported links only.
 * The retained parent Evidence/body is NOT fetched or authenticated. The nested
 * summary remains opaque JSON; no managed/JavaScript result-domain claim is made.
 */
export function validateReaSummaryEvidence(value: unknown, expected: { sha256: string; parentOperation: string }): ValidatedReaEvidence {
  // Snapshot before any caller-controlled property access, including kind/provider.
  const obj = record(snapshot(value));
  const validated = validateReaEvidence(obj, { sha256: expected.sha256, operation: 'inspect_analysis_view' });
  const identity = record(obj.provider!);
  if (identity.id !== 'rea-analysis-view' || identity.name !== 'REA analysis view projection' || identity.version !== '1'
    || obj.predicate_type !== 'rea.analysis-view' || obj.raw_result !== null || obj.analysis_profile !== null
    || obj.confidence !== 'derived') fail('REA_SUMMARY_BINDING_MISMATCH');
  if (!['inspect_managed_artifact', 'analyze_javascript_application', 'inspect_artifact', 'inspect_android_package', 'inspect_binary_layout'].includes(expected.parentOperation)) fail('REA_SUMMARY_BINDING_MISMATCH');
  const parameters = strict(obj.parameters!, ['parent_evidence_id', 'view']);
  const requestedView = strict(parameters.view!, ['kind']);
  if (requestedView.kind !== 'summary') fail('REA_SUMMARY_BINDING_MISMATCH');
  digest(parameters.parent_evidence_id!, 'ev_');
  const result = strict(obj.normalized_result!, ['kind', 'view', 'parent_evidence_id', 'parent_operation', 'parent_digest', 'view_digest', 'artifact', 'coverage', 'limitations', 'unknowns', 'summary']);
  const resultView = strict(result.view!, ['kind']);
  const artifact = strict(result.artifact!, ['path', 'sha256']);
  str(artifact.path!); digest(artifact.sha256!); digest(result.parent_digest!); digest(result.view_digest!);
  if (result.kind !== 'summary' || resultView.kind !== 'summary' || result.parent_operation !== expected.parentOperation
    || result.parent_evidence_id !== parameters.parent_evidence_id
    || result.parent_digest !== (parameters.parent_evidence_id as string).slice(3)
    || artifact.sha256 !== expected.sha256) fail('REA_SUMMARY_BINDING_MISMATCH');
  const links = obj.evidence_links as Json[];
  if (links.length !== 1 || links[0] !== parameters.parent_evidence_id) fail('REA_SUMMARY_BINDING_MISMATCH');
  const viewCoverage = strict(result.coverage!, ['status', 'examined', 'total', 'next_offset', 'exhausted']);
  choice(viewCoverage.status!, ['complete-within-view', 'page', 'empty']);
  for (const key of ['examined', 'total', 'next_offset']) {
    if (key === 'next_offset' && viewCoverage[key] === null) continue;
    if (typeof viewCoverage[key] !== 'number' || !Number.isSafeInteger(viewCoverage[key]) || (viewCoverage[key] as number) < 0) fail();
  }
  if (typeof viewCoverage.exhausted !== 'boolean') fail();
  strings(result.limitations!); strings(result.unknowns!); record(result.summary!);
  const { view_digest: ignored, ...projection } = result;
  if (hash(projection) !== result.view_digest) fail('REA_SUMMARY_VIEW_DIGEST_MISMATCH');
  return validated;
}

export interface ReaTechnicalFact {
  readonly evidenceId?: string;
  readonly key: string;
  readonly label: string;
  readonly value: string | number | boolean;
  readonly jsonPointer: string;
  readonly scope: 'selected-artifact' | 'producer-returned';
  readonly confidence: 'observed' | 'derived' | 'inferred';
  readonly limitation: string;
}
export interface ReaSummaryFacts {
  readonly technicalFacts: readonly ReaTechnicalFact[];
  /** The producer's explicit source coverage; never the summary view's coverage. */
  readonly sourceCoverage: 'complete' | 'partial' | 'unavailable' | 'unknown';
}

/** Extract only allowlisted static classifications and producer-returned counts.
 * Omitted fields are unknown; malformed present allowlisted fields fail closed.
 * The rest of the nested summary is opaque, bounded JSON and is never displayed.
 */
export function projectReaSummaryFacts(value: unknown, expected: { sha256: string; parentOperation: string }): ReaSummaryFacts {
  const obj = record(snapshot(value));
  const validated = validateReaSummaryEvidence(obj, expected);
  const summary = record(record(obj.normalized_result!).summary!);
  const facts: ReaTechnicalFact[] = [];
  let sourceCoverage: ReaSummaryFacts['sourceCoverage'] = 'unknown';
  const enumLimitation = 'Producer-reported static classification; runtime behavior is unverified.';
  const countLimitation = 'Count covers producer-returned observations only; total target coverage is unverified.';
  function group(parent: RecordValue, key: string): RecordValue | undefined {
    return Object.hasOwn(parent, key) ? record(parent[key]!) : undefined;
  }
  function add(parent: RecordValue | undefined, field: string, key: string, label: string, pointer: string, values?: readonly string[]) {
    if (!parent || !Object.hasOwn(parent, field)) return;
    const factValue = parent[field]!;
    if (values) choice(factValue, values);
    else if (typeof factValue !== 'number' || !Number.isSafeInteger(factValue) || factValue < 0) fail('REA_SUMMARY_FACT_INVALID');
    if (facts.length >= 20) fail('REA_SUMMARY_FACT_LIMIT');
    facts.push(Object.freeze({ key, label, value: factValue as string | number, jsonPointer: `/normalized_result/summary/${pointer}`, scope: values ? 'selected-artifact' : 'producer-returned', confidence: validated.confidence, limitation: values ? enumLimitation : countLimitation }));
  }
  if (expected.parentOperation === 'inspect_managed_artifact') {
    add(group(summary, 'pe'), 'architecture', 'pe_architecture', 'PE architecture', 'pe/architecture', ['x86', 'x86_64', 'arm', 'arm64']);
    const classification = group(summary, 'classification');
    add(classification, 'status', 'managed_status', 'Managed classification', 'classification/status', ['managed', 'not-managed', 'malformed']);
    add(classification, 'runtime_family', 'runtime_family', 'Runtime family', 'classification/runtime_family', ['dotnet-framework', 'modern-dotnet', 'unity-mono', 'mixed-clr-native', 'unknown']);
    add(classification, 'implementation', 'implementation', 'Implementation format', 'classification/implementation', ['cil', 'cil-and-ready-to-run', 'cpp-cli-mixed', 'metadata-only', 'not-managed', 'unknown']);
    add(classification, 'managed_architecture', 'managed_architecture', 'Managed architecture', 'classification/managed_architecture', ['anycpu', 'anycpu-prefer-32', 'x86', 'x86_64', 'arm', 'arm64', 'unknown']);
    add(group(summary, 'metadata'), 'status', 'metadata_status', 'Metadata status', 'metadata/status', ['absent', 'complete', 'partial', 'malformed']);
    const source = group(summary, 'coverage');
    if (source && Object.hasOwn(source, 'state')) {
      choice(source.state!, ['complete', 'partial', 'unavailable']);
      sourceCoverage = source.state as ReaSummaryFacts['sourceCoverage'];
    }
    const counts = group(summary, 'reported_counts');
    add(counts, 'references', 'references', 'Returned assembly references', 'reported_counts/references');
    add(counts, 'resources', 'resources', 'Returned managed resources', 'reported_counts/resources');
    add(counts, 'attributes', 'attributes', 'Returned custom attributes', 'reported_counts/attributes');
  } else {
    const statistics = group(summary, 'statistics');
    add(statistics, 'relevant_files', 'relevant_files', 'Relevant files observed', 'statistics/relevant_files');
    add(statistics, 'parsed_javascript_files', 'parsed_javascript_files', 'JavaScript files parsed', 'statistics/parsed_javascript_files');
    add(statistics, 'parse_failures', 'parse_failures', 'JavaScript parse failures', 'statistics/parse_failures');
    add(statistics, 'modules', 'modules', 'Modules observed', 'statistics/modules');
    add(statistics, 'findings', 'findings', 'Static findings returned', 'statistics/findings');
    const electron = group(summary, 'electron');
    add(electron, 'browser_windows', 'browser_windows', 'Browser windows observed', 'electron/browser_windows');
    add(electron, 'preload_entrypoints', 'preload_entrypoints', 'Preload entrypoints observed', 'electron/preload_entrypoints');
    add(electron, 'context_bridge_apis', 'context_bridge_apis', 'Context bridge APIs observed', 'electron/context_bridge_apis');
    add(electron, 'native_addon_bindings', 'native_addon_bindings', 'Native addon bindings observed', 'electron/native_addon_bindings');
    const ipc = electron ? group(electron, 'ipc') : undefined;
    add(ipc, 'operations', 'ipc_operations', 'IPC operations observed', 'electron/ipc/operations');
    add(ipc, 'paired_renderer_transmissions', 'paired_renderer_transmissions', 'Paired renderer transmissions', 'electron/ipc/paired_renderer_transmissions');
    add(ipc, 'unpaired_literal_renderer_transmissions', 'unpaired_literal_renderer_transmissions', 'Unpaired literal renderer transmissions', 'electron/ipc/unpaired_literal_renderer_transmissions');
    // The nested application/semantic coverage schemas are not certified here.
    // A complete summary view cannot establish complete JavaScript source coverage.
  }
  return Object.freeze({ technicalFacts: Object.freeze(facts), sourceCoverage });
}

const applicationKinds = ['package','installer','artifact','asar-entry','electron-main','electron-preload','electron-renderer','electron-utility','javascript-asset','javascript-chunk','javascript-module','javascript-expression','source-map','source-module','browser-window','frame','target','context-bridge-api','ipc-channel','ipc-handler','worker','service-worker','endpoint','storage','native-addon','native-export','managed-assembly','managed-module','managed-type','managed-method','managed-field','managed-pinvoke-import','managed-native-implementation','runtime-script-instance','unknown'];
const semanticKinds = ['module','function','parameter','binding','expression','literal','property-slot','call-site','return-site','closure-capture','promise','task','event','listener','timer','child-process','stdio','signal','config-source','request','response','boundary','resource','unknown-frontier'];
function array(value: Json, maximum = 10000): Json[] { if (!Array.isArray(value) || value.length > maximum) fail('REA_FEATURE_SCHEMA_INVALID'); return value; }
function count(value: Json): number { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) fail('REA_FEATURE_SCHEMA_INVALID'); return value; }
function same(left: Json, right: Json): boolean { return canonical(left) === canonical(right); }
function commitment(obj: RecordValue, field: string, prefix: string): void { digest(obj[field]!, prefix); const { [field]: ignored, ...semantic } = obj; if (obj[field] !== `${prefix}${hash(semantic)}`) fail('REA_FEATURE_ID_MISMATCH'); }
function graphCoverage(value: Json, semantic = false): string {
  const obj = strict(value, semantic ? ['status','truncated','omitted_nodes','omitted_relations','limits','families'] : ['status','truncated','omitted_count','limits']);
  choice(obj.status!, ['complete','partial','unknown','unavailable']); if (typeof obj.truncated !== 'boolean') fail();
  for (const key of semantic ? ['omitted_nodes','omitted_relations'] : ['omitted_count']) if (obj[key] !== null) count(obj[key]!);
  for (const item of array(obj.limits!)) { const limit = strict(item,['name','value','unit']); str(limit.name!,1); count(limit.value!); choice(limit.unit!,semantic?['items','bytes','milliseconds','depth','other']:['items','bytes','milliseconds','depth','characters','instructions','other']); }
  if (!semantic && obj.status === 'complete' && (obj.truncated !== false || obj.omitted_count !== 0)) fail();
  if (semantic) {
    const families = array(obj.families!,12); if (families.length !== 12) fail(); const seen = new Set<Json>();
    for (const item of families) { const family = strict(item,['family','status','retained_relations','omitted_relations','unknown_ids']); choice(family.family!,['boundary','call-flow','child-process','closure','configuration','data-flow','event','object-flow','promise-ownership','request','resource-lifecycle','timer']); if (seen.has(family.family!)) fail(); seen.add(family.family!); choice(family.status!,['complete','partial','unknown','unsupported']); count(family.retained_relations!); if(family.omitted_relations!==null)count(family.omitted_relations!); for(const id of array(family.unknown_ids!))digest(id,'jsrg_unknown_'); }
  }
  return obj.status as string;
}
function graphProof(value: Json): void {
  const proof = strict(value,['authority','state','confidence','artifact','location','extractor','coverage','limitations','evidence_ids']);
  choice(proof.authority!,['artifact-bytes','ast-static-analysis','static-relationship-inference','passive-cdp-runtime','cross-layer-reconciliation','cross-version-comparison','controlled-replay','native-analysis-provider','managed-static-analysis','historical-reference','user-assertion','unknown']);
  choice(proof.state!,['observed','inferred','unknown','unavailable']); choice(proof.confidence!,['exact','high','medium','low','unknown']);
  const artifact = record(proof.artifact!); if(artifact.available===true){strict(artifact,['available','artifact_id','sha256']);digest(artifact.sha256!);if(artifact.artifact_id!==`art_${artifact.sha256 as string}`)fail();}else{strict(artifact,['available','reason','detail']);if(artifact.available!==false)fail();str(artifact.reason!,1);str(artifact.detail!,1);}
  const location = record(proof.location!); if(location.available===true){strict(location,['available','value']);record(location.value!);}else{strict(location,['available','reason','detail']);if(location.available!==false)fail();str(location.reason!,1);str(location.detail!,1);}
  const extractor=strict(proof.extractor!,['name','version','operation','executable_sha256']);str(extractor.name!,1);str(extractor.version!,1);str(extractor.operation!,1);if(extractor.executable_sha256!==null)digest(extractor.executable_sha256!);
  graphCoverage(proof.coverage!);strings(proof.limitations!);for(const id of array(proof.evidence_ids!))digest(id,'ev_');
  if(proof.state==='observed'&&(proof.confidence==='unknown'||location.available!==true))fail();
  if(['unknown','unavailable'].includes(proof.state as string)&&(proof.confidence!=='unknown'||!(proof.limitations as Json[]).length))fail();
  if(proof.state==='inferred'&&(!['high','medium','low'].includes(proof.confidence as string)||!(proof.limitations as Json[]).length))fail();
  if(['static-relationship-inference','cross-layer-reconciliation','cross-version-comparison'].includes(proof.authority as string)&&proof.state!=='inferred')fail();
}
function validateApplicationGraph(value: Json): RecordValue {
  const graph=strict(value,['schema','root_node_ids','nodes','edges','coverage','limitations','graph_id']);if(graph.schema!=='JavaScriptApplicationGraph')fail();commitment(graph,'graph_id','jag_');graphCoverage(graph.coverage!);strings(graph.limitations!);
  const nodes=array(graph.nodes!);if(!nodes.length)fail();const ids=new Set<string>();
  for(const value of nodes){const node=strict(value,['node_id','kind','identity','observations']);digest(node.node_id!,'jag_node_');choice(node.kind!,applicationKinds);record(node.identity!);if(node.node_id!==`jag_node_${hash({kind:node.kind!,identity:node.identity!})}`||ids.has(node.node_id as string))fail();ids.add(node.node_id as string);
    const observations=array(node.observations!);if(!observations.length)fail();for(const value of observations){const obs=strict(value,['label','source_map_reference','properties','evidence','observation_id','identifier_strategy']);if(obs.label!==null)str(obs.label!,1);if(obs.source_map_reference!==null)record(obs.source_map_reference!);record(obs.properties!);graphProof(obs.evidence!);const strategy=strict(obs.identifier_strategy!,['strategy','stability']);if(strategy.strategy!=='semantic-content-sha256'||strategy.stability!=='observation-exact')fail();const {observation_id,identifier_strategy,...semantic}=obs;if(observation_id!==`jag_observation_${hash({node_id:node.node_id!,...semantic})}`)fail();}
  }
  for(const id of array(graph.root_node_ids!)){digest(id,'jag_node_');if(!ids.has(id as string))fail();}if(!(graph.root_node_ids as Json[]).length)fail();const edgeIds=new Set<Json>();
  for(const value of array(graph.edges!)){const edge=strict(value,['source_node_id','target_node_id','relation','properties','evidence','edge_id','identifier_strategy']);if(!ids.has(edge.source_node_id as string)||!ids.has(edge.target_node_id as string)||edgeIds.has(edge.edge_id!))fail();edgeIds.add(edge.edge_id!);choice(edge.relation!,REA_APPLICATION_RELATIONS);record(edge.properties!);graphProof(edge.evidence!);const strategy=strict(edge.identifier_strategy!,['strategy','stability']);if(strategy.strategy!=='semantic-content-sha256'||strategy.stability!=='relationship-exact')fail();const {edge_id,identifier_strategy,...semantic}=edge;if(edge_id!==`jag_edge_${hash(semantic)}`)fail();}
  return graph;
}
function validateSemanticGraph(value: Json, targetSha256: string, applicationGraphId: Json): RecordValue {
  const graph=strict(value,['schema','root_artifact_sha256','application_graph_id','root_node_ids','evidence_contexts','nodes','relations','fingerprints','unknowns','coverage','limitations','graph_id']);
  if(graph.schema!=='JavaScriptSemanticRelationGraph'||graph.root_artifact_sha256!==targetSha256||graph.application_graph_id!==applicationGraphId)fail();commitment(graph,'graph_id','jsrg_');graphCoverage(graph.coverage!,true);strings(graph.limitations!);
  const contexts=new Map<Json,RecordValue>();for(const value of array(graph.evidence_contexts!)){const context=record(value);const {context_id,...body}=context;if(context_id!==`jsrg_evidence_${hash(body)}`||contexts.has(context_id!))fail();contexts.set(context_id!,body);}
  const proof=(value:Json)=>{const ref=strict(value,['context_id','location']);const context=contexts.get(ref.context_id!);if(!context)fail();graphProof({...context,location:ref.location!});};
  const ids=new Set<Json>();for(const value of array(graph.nodes!)){const node=strict(value,['kind','identity','function_node_id','application_node_ids','label','properties','evidence','node_id']);choice(node.kind!,semanticKinds);const identity=strict(node.identity!,['artifact_sha256','module_path','source_range','role_key']);digest(identity.artifact_sha256!);str(identity.module_path!,1);str(identity.role_key!,1);if(node.node_id!==`jsrg_node_${hash({kind:node.kind!,identity})}`||ids.has(node.node_id!))fail();ids.add(node.node_id!);if(node.function_node_id!==null)digest(node.function_node_id!,'jsrg_node_');for(const id of array(node.application_node_ids!))digest(id,'jag_node_');if(node.label!==null)str(node.label!,1);record(node.properties!);proof(node.evidence!);}
  if(!ids.size)fail();for(const id of array(graph.root_node_ids!))if(!ids.has(id))fail();
  for(const value of array(graph.relations!)){const relation=strict(value,['source_node_id','target_node_id','relation','resolution','properties','evidence','relation_id']);if(!ids.has(relation.source_node_id!)||!ids.has(relation.target_node_id!))fail();choice(relation.relation!,REA_SEMANTIC_RELATIONS);choice(relation.resolution!,['resolved','candidate']);record(relation.properties!);proof(relation.evidence!);commitment(relation,'relation_id','jsrg_relation_');}
  // Fingerprints/unknown frontiers are retained privately; only source-backed structural fields are used.
  for(const value of array(graph.fingerprints!)){const fp=record(value);digest(fp.fingerprint_id!,'jsrg_fingerprint_');digest(fp.fingerprint_sha256!);if(!ids.has(fp.function_node_id!))fail();proof(fp.evidence!);}
  for(const value of array(graph.unknowns!)){const unknown=record(value);digest(unknown.unknown_id!,'jsrg_unknown_');proof(unknown.evidence!);}
  return graph;
}
/** Translate only explicit typed public selectors; never infer a symbol from objective. */
export function reaFeatureToolQuery(query: ReaFeatureQuery): Record<string, unknown> {
  if(query.kind==='application-feature'){const seed=query.seed;return {seed:{kind:seed.kind,value:seed.value,match:seed.match,case_sensitive:seed.caseSensitive,...(seed.kind==='api'&&seed.entryPath!==undefined?{entry_path:[...seed.entryPath]}:{})},direction:query.direction};}
  const {kind,...rest}=query.seed;const seed={kind,...rest} as Record<string,unknown>;if('nodeId'in seed){seed.node_id=seed.nodeId;delete seed.nodeId;}if('fingerprintSha256'in seed){seed.fingerprint_sha256=seed.fingerprintSha256;delete seed.fingerprintSha256;}
  return {query:{seed,direction:query.direction,...(query.allowedRelations===undefined?{}:{allowed_relations:[...query.allowedRelations]}),include_ambiguous_dynamic_edges:false,expected:null}};
}

/** Authenticate a subjectless feature workflow through its selected complete source.
 * Nested graph validation covers committed structural identities and references; opaque
 * property/label bodies remain private and are never promoted into safe facts.
 */
export function validateReaFeatureEvidence(value: unknown, expected: { sha256: string; sourceEvidence: unknown; featureQuery: ReaFeatureQuery }): ReaLocalFlowResult {
  const source=record(snapshot(expected.sourceEvidence));const sourceOperation=source.operation;
  if(!['analyze_javascript_application','project_managed_application_graph'].includes(sourceOperation as string))fail('REA_FEATURE_SOURCE_INVALID');
  const authenticatedSource=validateReaEvidence(source,{sha256:expected.sha256,operation:sourceOperation as string});const sourceResult=record(source.normalized_result!);const sourceProvider=record(source.provider!);
  if(source.raw_result!==null||sourceResult.root_artifact_sha256!==expected.sha256)fail('REA_FEATURE_SOURCE_INVALID');
  if(sourceOperation==='analyze_javascript_application'){
    if(source.predicate_type!=='rea.javascript-application-analysis'||sourceProvider.id!=='rea-javascript-application'||sourceProvider.name!=='REA JavaScript application analyzer'||sourceProvider.version!=='1'||source.confidence!=='derived'||source.authority!=='shipped-artifact')fail('REA_FEATURE_SOURCE_INVALID');
    const subject=record(source.subject!);if(sourceResult.input_path!==subject.local_path||sourceResult.format!==subject.format)fail('REA_FEATURE_SOURCE_INVALID');
  }else{
    if(source.predicate_type!=='rea.managed-application-graph'||sourceProvider.id!=='rea-dotnet-workflows'||sourceProvider.name!=='REA managed-code workflows'||sourceProvider.version!=='1'||source.confidence!=='inferred'||source.authority!=='analyst-inference')fail('REA_FEATURE_SOURCE_INVALID');
    commitment(sourceResult,'projection_id','magp_');
  }
  const sourceGraph=validateApplicationGraph(sourceResult.graph!);
  const query=parseFeatureQuery(snapshot(expected.featureQuery),sourceOperation==='analyze_javascript_application'?'static-javascript':'static-managed');
  const semantic=query.kind==='javascript-semantics';const operation=semantic?'trace_javascript_semantics':'trace_application_feature';
  const mapped=record(snapshot(reaFeatureToolQuery(query)));const obj=record(snapshot(value));const evidence=validateEvidenceEnvelope(obj,{sha256:null,operation});const identity=record(obj.provider!);
  if(identity.id!=='rea-javascript-application-workflows'||identity.name!=='REA JavaScript application workflows'||identity.version!=='1'||obj.predicate_type!==(semantic?'rea.javascript-semantic-trace':'rea.application-feature-trace')||obj.confidence!=='inferred'||obj.authority!=='analyst-inference'||obj.raw_result!==null||obj.environment!==null||obj.analysis_profile!==null)fail('REA_FEATURE_BINDING_MISMATCH');
  const parameters=semantic?strict(obj.parameters!,['application_evidence_id','query']):strict(obj.parameters!,['application_evidence_id','native_evidence_ids','seed','direction']);
  if(parameters.application_evidence_id!==source.evidence_id||(!semantic&&array(parameters.native_evidence_ids!).length)||!same(semantic?parameters.query!:parameters.seed!,semantic?mapped.query!:mapped.seed!)||(!semantic&&parameters.direction!==mapped.direction))fail('REA_FEATURE_BINDING_MISMATCH');
  const result=strict(obj.normalized_result!,semantic?['query_id','source_graph_id','seed','direction','status','seed_node_ids','evidence_contexts','nodes','relations','unknowns','expected_match_node_ids','summary','coverage','limitations','source_evidence_id','evidence_links']:['trace_id','source_evidence_id','source_graph_id','seed','direction','seed_matches','graph','paths','native_handoffs','summary','coverage','evidence_links','limitations']);
  const sourceId=source.evidence_id as string;for(const links of [obj.evidence_links!,result.evidence_links!]){const ids=array(links);if(ids.length!==1||ids[0]!==sourceId)fail('REA_FEATURE_BINDING_MISMATCH');}
  if(result.source_evidence_id!==sourceId)fail('REA_FEATURE_BINDING_MISMATCH');strings(result.limitations!);
  const facts:ReaTechnicalFact[]=[];const relationships:ReaStructuralRelationship[]=[];const summary=record(result.summary!);let sourceCoverage:ReaLocalFlowResult['sourceCoverage']='unknown';
  const add=(key:string,label:string)=>{facts.push(Object.freeze({key,label,value:count(summary[key]!),jsonPointer:`/normalized_result/summary/${key}`,scope:'producer-returned',confidence:'inferred',evidenceId:evidence.originalEvidenceId,limitation:'Static trace observations within the supplied source graph; runtime behavior and whole-target coverage are unverified.'}));};
  const relationRows=(rows:Json[],semantic:boolean)=>{for(const [index,value]of rows.entries()){const row=record(value);relationships.push(Object.freeze({id:row[semantic?'relation_id':'edge_id'] as string,sourceId:row.source_node_id as string,targetId:row.target_node_id as string,relation:row.relation as string,jsonPointer:`/normalized_result/${semantic?'relations':'graph/edges'}/${index}`,evidenceId:evidence.originalEvidenceId,confidence:'inferred',limitation:'Bounded sample of static returned relationships; additional relationships may be omitted and runtime execution is unverified.'}));}};
  if(!semantic){
    commitment(result,'trace_id','jatr_');if(result.source_graph_id!==sourceGraph.graph_id||!same(result.seed!,mapped.seed!)||result.direction!==mapped.direction)fail('REA_FEATURE_BINDING_MISMATCH');
    const matches=array(result.seed_matches!);for(const value of matches){const match=strict(value,['node_id','kind','basis','field']);digest(match.node_id!,'jag_node_');choice(match.kind!,applicationKinds);choice(match.basis!,['node-id','label','identity','property']);str(match.field!,1);if(!(sourceGraph.nodes as Json[]).some(node=>record(node).node_id===match.node_id))fail();}
    const coverage=strict(result.coverage!,['status','source_graph_status','total_seed_matches']);choice(coverage.status!,['complete-within-source','partial','no-match']);choice(coverage.source_graph_status!,['complete','partial','unknown','unavailable']);if(coverage.source_graph_status!==record(sourceGraph.coverage!).status||count(coverage.total_seed_matches!)!==matches.length)fail();sourceCoverage=coverage.source_graph_status as ReaLocalFlowResult['sourceCoverage'];
    let nodes:Json[]=[],edges:Json[]=[];if(result.graph!==null){const graph=validateApplicationGraph(result.graph!);nodes=graph.nodes as Json[];edges=graph.edges as Json[];for(const field of ['nodes','edges'])for(const member of graph[field] as Json[]){const row=record(member);const key=field==='nodes'?'node_id':'edge_id';const original=(sourceGraph[field] as Json[]).find(item=>record(item)[key]===row[key]);if(!original||!same(member,original))fail('REA_FEATURE_SOURCE_INVALID');}}
    if(count(summary.matched_seeds!)!==matches.length||count(summary.traced_nodes!)!==nodes.length||count(summary.traced_edges!)!==edges.length||count(summary.terminal_paths!)!==array(result.paths!).length||count(summary.native_handoffs!)!==array(result.native_handoffs!).length)fail();
    if((coverage.status==='no-match')!==(matches.length===0)||(!matches.length&&result.graph!==null))fail();
    for(const value of array(result.paths!)){const path=strict(value,['start_node_id','end_node_id','end_kind','node_ids','edge_ids','authorities','contains_inference','path_id']);commitment(path,'path_id','jatp_');for(const id of array(path.node_ids!))if(!nodes.some(node=>record(node).node_id===id))fail();for(const id of array(path.edge_ids!))if(!edges.some(edge=>record(edge).edge_id===id))fail();strings(path.authorities!,0,1);if(typeof path.contains_inference!=='boolean')fail();}
    for(const value of array(result.native_handoffs!)){const handoff=strict(value,['native_node_id','artifact_sha256','artifact_path','export_node_ids','requested_exports','status','providers','evidence_ids','recommended_tools']);digest(handoff.native_node_id!,'jag_node_');digest(handoff.artifact_sha256!);if(handoff.artifact_path!==null)str(handoff.artifact_path!,1);choice(handoff.status!,['evidence-linked','requires-provider-analysis']);strings(handoff.requested_exports!,0,1);for(const id of array(handoff.export_node_ids!))digest(id,'jag_node_');if(array(handoff.providers!).length||array(handoff.evidence_ids!).length)fail();for(const tool of array(handoff.recommended_tools!))choice(tool,['open_binary','binary_overview','search_procedures','analyze_function','xrefs']);}
    strict(summary,['matched_seeds','traced_nodes','traced_edges','terminal_paths','native_handoffs','observed_facts','inferred_facts','unknown_facts','unavailable_facts']);
    const states=[...nodes.flatMap(value=>(record(value).observations as Json[]).map(obs=>record(record(obs).evidence!).state)),...edges.map(value=>record(record(value).evidence!).state)];
    for(const [key,state]of [['observed_facts','observed'],['inferred_facts','inferred'],['unknown_facts','unknown'],['unavailable_facts','unavailable']])if(count(summary[key!]!)!==states.filter(value=>value===state).length)fail('REA_FEATURE_FACT_COUNT_MISMATCH');
    for(const [key,label]of [['matched_seeds','Matched feature seeds'],['traced_nodes','Traced graph nodes'],['traced_edges','Traced graph relationships'],['terminal_paths','Returned terminal paths'],['native_handoffs','Native handoffs requiring separate analysis'],['observed_facts','Source observed facts'],['inferred_facts','Source inferred facts'],['unknown_facts','Source unknown facts'],['unavailable_facts','Source unavailable facts']])add(key!,label!);relationRows(edges,false);
  }else{
    const graph=validateSemanticGraph(sourceResult.semantic_graph!,expected.sha256,sourceGraph.graph_id!);const mappedQuery=record(mapped.query!);
    const sortedQuery={...mappedQuery,...(mappedQuery.allowed_relations===undefined?{}:{allowed_relations:[...(mappedQuery.allowed_relations as Json[])].sort()})};
    if(result.source_graph_id!==graph.graph_id||result.query_id!==`jsrq_${hash({source_graph_id:graph.graph_id!,...sortedQuery})}`||!same(result.seed!,mappedQuery.seed!)||result.direction!==mappedQuery.direction)fail('REA_FEATURE_BINDING_MISMATCH');
    choice(result.status!,['found','no-match','ambiguous','partial','unsupported']);const coverage=strict(result.coverage!,['status']);choice(coverage.status!,['complete','partial','unavailable']);sourceCoverage=coverage.status as ReaLocalFlowResult['sourceCoverage'];
    for(const field of ['nodes','relations','evidence_contexts','unknowns'])for(const value of array(result[field]!)){const key=field==='nodes'?'node_id':field==='relations'?'relation_id':field==='evidence_contexts'?'context_id':'unknown_id';const row=record(value);const original=(graph[field] as Json[]).find(item=>record(item)[key]===row[key]);if(!original||!same(value,original))fail('REA_FEATURE_SOURCE_INVALID');}
    for(const field of ['seed_node_ids','expected_match_node_ids'])for(const id of array(result[field]!))if(!(graph.nodes as Json[]).some(node=>record(node).node_id===id))fail();
    strict(summary,['total_seed_matches','traversed_nodes','traversed_relations','traversed_functions','traversed_modules','relevant_unknowns']);if(count(summary.total_seed_matches!)!==array(result.seed_node_ids!).length||count(summary.traversed_nodes!)!==array(result.nodes!).length||count(summary.traversed_relations!)!==array(result.relations!).length||count(summary.relevant_unknowns!)!==array(result.unknowns!).length)fail();
    for(const [key,label]of [['total_seed_matches','Matched semantic seeds'],['traversed_nodes','Traversed semantic nodes'],['traversed_relations','Traversed semantic relationships'],['traversed_functions','Traversed function owners'],['traversed_modules','Traversed source modules'],['relevant_unknowns','Relevant unknown frontiers']])add(key!,label!);relationRows(result.relations as Json[],true);
  }
  return Object.freeze({evidence,technicalFacts:Object.freeze(facts),sourceCoverage,evidenceKind:'feature-trace',evidenceRefs:Object.freeze([authenticatedSource.originalEvidenceId,evidence.originalEvidenceId]),relationships:Object.freeze(relationships.slice(0,20-facts.length))});
}
