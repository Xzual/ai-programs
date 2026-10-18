import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { parseReaAnalysisInput, projectReaSummaryFacts, validateReaSummaryEvidence, ReaContractError, type ReaProfile, type ReaTechnicalFact, type ReaSummaryFacts, type ReaLocalConfiguration, type ReaLocalFlowContext, type ReaLocalFlowResult, type ReaStructuralRelationship } from './reaContract';
import { ReaMcpClient, type ReaMcpLaunch } from './reaMcpClient';
import { materializeReaLocalTarget, type ReaLocalTarget } from './reaLocalTarget';
import { runReaAppPackage } from './reaAppPackageService';
import { runReaNativeBinary } from './reaNativeBinaryService';
import { runReaAndroid } from './reaAndroidService';
import { runReaApkResources } from './reaApkResourcesService';
import { runReaFeatureTrace } from './reaFeatureTraceService';
import { createReaRemoteTarget, assertReaRemoteTarget } from './reaRemoteTarget';
import { runReaWeb } from './reaWebService';
import { runReaElectronRuntime } from './reaElectronRuntimeService';
import { runReaRuntimeObservation } from './reaRuntimeObservationService';
import type { ReaRemoteSelectionBinding, ReaRemoteTarget, ReaRemoteFlowResult, ReaRemoteFlowContext } from './reaContract';

/** These capabilities stay in backend composition. Public tool arguments cannot mint them. */
export interface ReaAuthorityContext {
  sessionId?: string;
  ownerId: string;
  workspaceId: string;
  taskId: string;
  runId: string;
  serverBootId: string;
  expiresAt: number;
  signal: AbortSignal;
}
declare const authorityBrand: unique symbol;
export type ReaAuthority = { readonly [authorityBrand]: true };
export interface ReaSelectionBinding {
  kind?: 'file' | 'directory';
  ownerId: string;
  workspaceId: string;
  workspaceRoot: string;
  absolutePath: string;
  sha256: string;
  expiresAt: number;
}
export interface ReaSafeReport {
  readonly schemaVersion: 1;
  readonly profile: ReaProfile;
  readonly originalEvidenceId: string;
  readonly projectionDigest: string;
  readonly confidence: 'observed' | 'derived' | 'inferred';
  readonly limitationsCount: number;
  readonly coverage: 'unverified';
  readonly evidenceKind: 'summary-view' | 'analysis' | 'feature-trace';
  readonly evidenceRefs: readonly string[];
  readonly relationships: readonly ReaStructuralRelationship[];
  readonly sourceCoverage: ReaSummaryFacts['sourceCoverage'];
  readonly technicalFacts: readonly (ReaTechnicalFact & {
    readonly provenance: { readonly evidenceId: string; readonly validatedJSONPointer: string; readonly observedAt: string; readonly producerVersion: string };
  })[];
  readonly summary: string;
  readonly spokenSummary: string;
  readonly observedMetrics: readonly {
    readonly key: 'verified_evidence_records'; readonly value: number; readonly unit: 'records';
    readonly scope: string;
    readonly provenance: { readonly evidenceId: string; readonly validatedJSONPointer: '/evidence_id'; readonly observedAt: string; readonly producerVersion: string | null };
  }[];
}
export interface ReaAnalysisResult {
  readonly outcome: 'completed' | 'partial' | 'blocked' | 'failed' | 'unknown_effect' | 'configuration_required' | 'not_available' | 'clarification_required';
  readonly reasonCode: string;
  readonly cleanup: { readonly closed: boolean; readonly unknownEffect: boolean };
  readonly report?: ReaSafeReport;
  readonly clarification?: string;
}
export interface ReaAnalysisService {
  run(input: unknown, authority: ReaAuthority): Promise<ReaAnalysisResult>;
}
export interface ReaAnalysisOptions {
  readonly remoteQualificationRefs?: readonly string[];
  readonly launch: ReaMcpLaunch;
  readonly expectedCatalogDigest: string;
  readonly expectedServerPath: string;
  readonly serverBootId: string;
  /** Private service-owned directory, outside user-selectable inputs; never caller supplied. */
  readonly stagingRoot: string;
  readonly totalTimeoutMs?: number;
  readonly localConfiguration?: Readonly<ReaLocalConfiguration>;
  readonly isOwnerActive: (context: Readonly<ReaAuthorityContext>) => boolean;
  readonly isKillSwitchActive: () => boolean;
  /** Runtime owner must verify host/helper authority, containment and closure assurance per profile.
   * A direct-child receipt alone cannot establish closure of detached helper processes.
   */
  readonly isProfileReady: (profile: ReaProfile) => boolean;
}
const reports = new WeakSet<object>();
export const isReaSafeReport = (value: unknown): value is ReaSafeReport => typeof value === 'object' && value !== null && reports.has(value);
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(value);
const sha = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const object = (value: unknown): Record<string, any> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new GateError('REA_REPLY_INVALID');
  return value as Record<string, any>;
};
class GateError extends Error { constructor(readonly code: string) { super(code); } }
const result = (outcome: ReaAnalysisResult['outcome'], reasonCode: string, cleanup = { closed: true, unknownEffect: false }, report?: ReaSafeReport): ReaAnalysisResult => Object.freeze({ outcome, reasonCode, cleanup: Object.freeze({ ...cleanup }), ...(report ? { report } : {}) });

export function createReaAnalysisService(options: ReaAnalysisOptions): {
  service: ReaAnalysisService;
  admission: {
    issueAuthority(context: ReaAuthorityContext): ReaAuthority;
    registerSelection(binding: ReaSelectionBinding): string;
    revokeSelection(selectionRef: string): void;
    registerRemoteSelection(binding: ReaRemoteSelectionBinding): string;
    revokeRemoteSelection(selectionRef: string): void;
  };
} {
  if (!sha(options.expectedCatalogDigest) || !path.isAbsolute(options.expectedServerPath) || !path.isAbsolute(options.stagingRoot) || !id(options.serverBootId)) throw new GateError('REA_CONFIGURATION_INVALID');
  // Snapshot trusted launch arguments before an asynchronous caller can mutate them.
  const launch: ReaMcpLaunch = Object.freeze({ ...options.launch, args: Object.freeze([...options.launch.args]), env: Object.freeze({ ...options.launch.env }) });
  const expectedPath = path.resolve(options.expectedServerPath);
  const expectedCatalogDigest = options.expectedCatalogDigest;
  const serverBootId = options.serverBootId;
  const stagingRoot = path.resolve(options.stagingRoot);
  const totalTimeoutMs = options.totalTimeoutMs ?? 120000;
  if (!Number.isSafeInteger(totalTimeoutMs) || totalTimeoutMs < 1 || totalTimeoutMs > 120000) throw new GateError('REA_CONFIGURATION_INVALID');
  const ownerActive = options.isOwnerActive;
  const killed = options.isKillSwitchActive;
  const profileReady = options.isProfileReady;
  const configuration: Readonly<ReaLocalConfiguration> = Object.freeze(structuredClone(options.localConfiguration ?? {
    hostPlatform: process.platform as ReaLocalConfiguration['hostPlatform'], architecture: process.arch,
  }));
  const authorities = new WeakMap<object, Readonly<ReaAuthorityContext>>();
  const selections = new Map<string, Readonly<ReaSelectionBinding>>();
  const remoteSelections = new Map<string, ReaRemoteTarget>();
  const remoteQualificationRefs = Object.freeze([...(options.remoteQualificationRefs ?? [])]);
  if (remoteQualificationRefs.length > 256 || remoteQualificationRefs.some(ref => !id(ref))) throw new GateError('REA_CONFIGURATION_INVALID');
  type Selection = Readonly<ReaSelectionBinding> | ReaRemoteTarget;
  const remote = (binding: Selection): binding is ReaRemoteTarget => Object.hasOwn(binding, 'binding');
  const runs = new Map<string, { requestDigest: string; promise: Promise<ReaAnalysisResult> }>();
  let activeRuns = 0;
  function check(context: Readonly<ReaAuthorityContext>, selectionRef?: string, binding?: Selection) {
    if (context.serverBootId !== serverBootId || context.expiresAt <= Date.now() || !ownerActive(context)) throw new GateError('REA_AUTHORITY_REVOKED');
    if (killed()) throw new GateError('REA_KILL_SWITCH');
    if (context.signal.aborted) throw new GateError('REA_CANCELLED');
    if (binding && remote(binding)) {
      if (remoteSelections.get(selectionRef!) !== binding) throw new GateError('REA_REMOTE_SELECTION_REVOKED');
      assertReaRemoteTarget(binding, context);
    } else if (binding && (selections.get(selectionRef!) !== binding || binding.expiresAt <= Date.now())) throw new GateError('REA_SELECTION_REVOKED');
  }
  function status(value: unknown, operation: string | undefined, toolsCount: number): string {
    const reply = object(value);
    if (reply.isError === true) throw new GateError('REA_SESSION_FAILED');
    const body = object(object(reply.structuredContent).result), identity = object(body.server_identity);
    const pkg = object(identity.package), server = object(identity.server), sdk = object(identity.sdk);
    const catalog = object(identity.catalog), alignment = object(identity.alignment);
    if (pkg.name !== 'rea-agents' || pkg.version !== '6.5.0' || server.name !== 'rea' || server.version !== '6.5.0' || sdk.server !== '2.3.1' || sdk.core !== '2.3.1' || sdk.client_test !== '2.3.1') throw new GateError('REA_IDENTITY_MISMATCH');
    if (object(catalog.digests).combined_sha256 !== expectedCatalogDigest || object(catalog.counts).mcp_tools !== 207 || toolsCount !== 207) throw new GateError('REA_CATALOG_MISMATCH');
    if (typeof server.command_path !== 'string' || path.resolve(server.command_path) !== expectedPath || alignment.state !== 'aligned' || !Array.isArray(alignment.reasons) || alignment.reasons.length) throw new GateError('REA_IDENTITY_MISMATCH');
    if (typeof server.started_at !== 'string' || server.started_at.length > 64 || !Number.isFinite(Date.parse(server.started_at))) throw new GateError('REA_IDENTITY_MISMATCH');
    const groups = object(body.tool_availability).groups;
    if (!Array.isArray(groups) || groups.length > 207) throw new GateError('REA_AVAILABILITY_INVALID');
    const seen = new Set<string>(); let available = false, unavailableReason = '';
    for (const group of groups) {
      const g = object(group);
      if (!Array.isArray(g.names) || g.names.length > 207 || typeof g.available !== 'boolean' || typeof g.reason !== 'string') throw new GateError('REA_AVAILABILITY_INVALID');
      for (const name of g.names) {
        if (typeof name !== 'string' || seen.has(name) || seen.size >= 207) throw new GateError('REA_AVAILABILITY_INVALID');
        seen.add(name);
        if (name === operation) { available = g.available === true && g.reason === 'available'; unavailableReason = g.reason; }
      }
    }
    if (operation && !available) throw new ReaContractError(['provider_missing', 'not_configured', 'client_capability_missing'].includes(unavailableReason) ? 'REA_CONFIGURATION_REQUIRED' : 'REA_NOT_AVAILABLE');
    return server.started_at;
  }
  async function execute(input: ReturnType<typeof parseReaAnalysisInput>, context: Readonly<ReaAuthorityContext>, binding: Selection): Promise<ReaAnalysisResult> {
    let client: ReaMcpClient | undefined, target: ReaLocalTarget | undefined;
    let interrupted = false, dispatched = false, failure: unknown, report: ReaSafeReport | undefined;
    let cleanup = { closed: true, unknownEffect: false }, closing: Promise<unknown> | undefined;
    let remoteCleanupUnverified = false;
    const remoteTarget = remote(binding) ? binding : undefined;
    const controller = new AbortController(), deadlineAt = Date.now() + totalTimeoutMs;
    const guard = () => {
      if (controller.signal.aborted || Date.now() >= deadlineAt) { interrupted = true; throw new GateError('REA_CANCELLED'); }
      check(context, input.selectionRef, binding);
      if (!profileReady(input.profile)) throw new GateError('REA_PROFILE_NOT_READY');
    };
    const interrupt = () => {
      interrupted = true; controller.abort();
      if (client && !closing) closing = client.close().then(receipt => { cleanup = receipt; }, () => { cleanup = { closed: false, unknownEffect: true }; });
    };
    context.signal.addEventListener('abort', interrupt, { once: true });
    const monitor = setInterval(() => { try { guard(); } catch { interrupt(); } }, 25);
    const deadline = setTimeout(interrupt, totalTimeoutMs);
    try {
      guard();
      const extensions: Record<string, readonly string[]> = {
        'static-javascript': ['.asar'], 'static-managed': ['.dll', '.exe'],
        'app-package': ['.zip', '.ipa', '.apk', '.msix', '.appx', '.hap', '.hsp', '.app-pack', '.asar', '.dmg', '.pkg'],
        'native-binary': ['.exe', '.dll', '.elf', '.so', '.dylib', '.macho', '.bin'],
        'static-apk': ['.apk'], 'apk-resources': ['.apk'],
      };
      if (remoteTarget?.binding.target.kind === 'web-url') throw new ReaContractError('REA_REMOTE_NETWORK_UNSUPPORTED');
      const localBinding = remoteTarget ? remoteTarget.binding.target.kind === 'retained-har' ? { ...remoteTarget.binding.target, kind: 'file' as const } : undefined : binding as Readonly<ReaSelectionBinding>;
      if (localBinding) {
        if (localBinding.kind === 'directory' && input.profile !== 'static-javascript') throw new ReaContractError('REA_NOT_AVAILABLE');
        target = await materializeReaLocalTarget({ ...localBinding, kind: localBinding.kind ?? 'file' }, { stagingRoot, guard, allowedFileExtensions: remoteTarget ? ['.har'] : extensions[input.profile] }); guard();
      }
      client = new ReaMcpClient(launch); guard();
      const connection = await client.connect(); guard();
      const sessionArgs = Object.freeze({ expected_package_version: '6.5.0', expected_catalog_digest: expectedCatalogDigest, expected_server_path: expectedPath });
      const initialStatus = await client.callTool('binary_session', sessionArgs, { signal: controller.signal }); guard();
      const boot = status(initialStatus, undefined, connection.tools.length);
      const allowed: Record<string, readonly string[]> = {
        'static-javascript': ['analyze_javascript_application', 'trace_application_feature', 'trace_javascript_semantics'],
        'static-managed': ['inspect_managed_artifact', 'inspect_managed_members', 'project_managed_application_graph', 'trace_application_feature'],
        'app-package': ['open_binary', 'inspect_artifact', 'inspect_analysis_view', 'close_binary'],
        'native-binary': ['open_binary', 'analyze_function', 'procedure_pseudo_code', 'inspect_binary_layout', 'close_binary'],
        'static-apk': ['inspect_android_package', 'search_android_classes', 'inspect_android_class', 'inspect_android_method', 'trace_android_references'],
        'apk-resources': ['inspect_apktool_client', 'decode_android_resources'],
        'web': ['inspect_web_network_capture'],
        'electron-passive-runtime': ['inspect_electron_page'],
        'runtime-observation': ['observe_web_execution'],
      };
      const requireAvailable = async (name: string) => {
        guard();
        if (!allowed[input.profile].includes(name) || !connection.tools.some(tool => tool.name === name)) throw new GateError('REA_CATALOG_MISMATCH');
        const current = await client!.callTool('binary_session', sessionArgs, { signal: controller.signal }); guard();
        if (status(current, name, connection.tools.length) !== boot) throw new GateError('REA_SERVER_BOOT_CHANGED');
      };
      const callTool = async (name: string, args: Readonly<Record<string, unknown>>) => {
        await requireAvailable(name); guard(); dispatched = true;
        const reply = object(await client!.callTool(name, args, { signal: controller.signal })); guard();
        if (reply.isError === true) throw new ReaContractError('REA_OPERATION_NOT_AVAILABLE');
        return reply;
      };
      if (target) await target.verify(); guard();
      let flow: ReaLocalFlowResult;
      if (remoteTarget) {
        const context: ReaRemoteFlowContext = { target: remoteTarget, input, ...(target ? { capturePath: target.stagedPath } : {}), assertCurrent: guard, requireAvailable, callTool };
        const remoteFlow: ReaRemoteFlowResult = input.profile === 'web' ? await runReaWeb(context) : input.profile === 'electron-passive-runtime' ? await runReaElectronRuntime(context) : await runReaRuntimeObservation(context);
        flow = remoteFlow; remoteCleanupUnverified = remoteFlow.providerCleanup !== 'confirmed';
      } else {
      const local = binding as Readonly<ReaSelectionBinding>;
      const flowContext: ReaLocalFlowContext = { targetPath: target!.stagedPath, targetSha256: local.sha256, workDirectory: target!.workDirectory, input, configuration, assertCurrent: guard, callTool, requireAvailable };
      if (input.featureQuery) flow = await runReaFeatureTrace(flowContext);
      else if (input.profile === 'app-package') flow = await runReaAppPackage(flowContext);
      else if (input.profile === 'native-binary') flow = await runReaNativeBinary(flowContext);
      else if (input.profile === 'static-apk') flow = await runReaAndroid(flowContext);
      else if (input.profile === 'apk-resources') flow = await runReaApkResources(flowContext);
      else {
        const operation = input.profile === 'static-javascript' ? 'analyze_javascript_application' : 'inspect_managed_artifact';
        const args = Object.freeze(input.profile === 'static-javascript'
          ? { input_path: target!.stagedPath, format: 'auto', integrity_policy: 'fail', detail: 'summary' }
          : { path: target!.stagedPath, detail: 'summary' });
        const call = object(await callTool(operation, args)); guard();
        const expected = { sha256: local.sha256, parentOperation: operation };
        const evidence = validateReaSummaryEvidence(call.structuredContent, expected);
        flow = { evidence, ...projectReaSummaryFacts(call.structuredContent, expected), evidenceKind: 'summary-view', evidenceRefs: [evidence.originalEvidenceId] };
      }
      }
      guard();
      const finalStatus = await client.callTool('binary_session', sessionArgs, { signal: controller.signal }); guard();
      if (status(finalStatus, undefined, connection.tools.length) !== boot) throw new GateError('REA_SERVER_BOOT_CHANGED');
      if (target) await target.verify(); guard();
      const evidenceRefs = Object.freeze([...new Set(flow.evidenceRefs)]);
      if (!evidenceRefs.length || evidenceRefs.length > 50 || !evidenceRefs.includes(flow.evidence.originalEvidenceId) || evidenceRefs.some(ref => !/^ev_[a-f0-9]{64}$/.test(ref))) throw new GateError('REA_PROJECTION_INVALID');
      if (flow.technicalFacts.length + (flow.relationships?.length ?? 0) > 20) throw new GateError('REA_PROJECTION_LIMIT');
      const observedAt = new Date().toISOString();
      const technicalFacts = Object.freeze(flow.technicalFacts.map(fact => {
        const evidenceId = fact.evidenceId ?? flow.evidence.originalEvidenceId;
        if (!evidenceRefs.includes(evidenceId)) throw new GateError('REA_PROJECTION_INVALID');
        return Object.freeze({ ...fact, provenance: Object.freeze({ evidenceId, validatedJSONPointer: fact.jsonPointer, observedAt, producerVersion: 'rea-agents@6.5.0' }) });
      }));
      const relationships = Object.freeze((flow.relationships ?? []).map(row => {
        if (!evidenceRefs.includes(row.evidenceId)) throw new GateError('REA_PROJECTION_INVALID');
        return Object.freeze({ ...row });
      }));
      const metric = Object.freeze({ key: 'verified_evidence_records' as const, value: evidenceRefs.length, unit: 'records' as const, scope: 'run:' + digest(context.runId).slice(0, 32),
        provenance: Object.freeze({ evidenceId: flow.evidence.originalEvidenceId, validatedJSONPointer: '/evidence_id' as const, observedAt, producerVersion: flow.evidence.providerVersion }) });
      const excerpt = technicalFacts.slice(0, 3).map(fact => fact.label + ': ' + fact.value).join('; ');
      const projection = { schemaVersion: 1 as const, profile: input.profile, originalEvidenceId: flow.evidence.originalEvidenceId, confidence: flow.evidence.confidence,
        limitationsCount: flow.evidence.limitationsCount, coverage: 'unverified' as const, evidenceKind: flow.evidenceKind, evidenceRefs, relationships,
        sourceCoverage: flow.sourceCoverage, technicalFacts,
        summary: excerpt ? excerpt + (remoteTarget ? '. Selected capture facts do not establish whole-target coverage, current state outside this window, or complete external-effect cleanup.' : '. These static observations do not establish runtime behavior or whole-target coverage.') : 'Evidence was verified, but supported technical reporting is incomplete.',
        spokenSummary: excerpt ? technicalFacts[0].label + ': ' + technicalFacts[0].value + (remoteTarget ? '. Only the selected capture is described.' : '. Runtime behavior remains unverified.') : 'Technical reporting is incomplete.',
        observedMetrics: Object.freeze([metric]),
      };
      report = Object.freeze({ ...projection, projectionDigest: digest(JSON.stringify(projection)) });
      if (report.summary.length > 1200 || report.spokenSummary.length > 300 || Buffer.byteLength(JSON.stringify(report), 'utf8') > 65536) throw new GateError('REA_PROJECTION_LIMIT');
    } catch (error) { failure = error; }
    finally {
      if (closing) await closing;
      else if (client) { try { cleanup = await client.close(); } catch { cleanup = { closed: false, unknownEffect: true }; } }
      if (target) { try { if (!(await target.dispose()).removed) cleanup = { closed: cleanup.closed, unknownEffect: true }; } catch { cleanup = { closed: cleanup.closed, unknownEffect: true }; } }
      clearInterval(monitor); clearTimeout(deadline); context.signal.removeEventListener('abort', interrupt);
    }
    try { guard(); } catch (error) { failure = error; }
    const code = failure instanceof GateError || failure instanceof ReaContractError ? failure.code
      : failure instanceof Error && failure.name === 'ReaLocalTargetError' && /^REA_[A-Z_]+$/.test(String((failure as any).code)) ? String((failure as any).code) : 'REA_ANALYSIS_REJECTED';
    // A malformed/foreign/error CDP reply cannot authenticate provider teardown.
    if (remoteTarget && input.profile !== 'web' && dispatched && failure) cleanup = { closed: cleanup.closed, unknownEffect: true };
    if (!cleanup.closed || cleanup.unknownEffect || (interrupted && dispatched) || /CLEANUP|UNKNOWN_EFFECT/.test(code)) return result('unknown_effect', 'REA_UNKNOWN_EFFECT', { closed: cleanup.closed, unknownEffect: true });
    if (interrupted) return result('blocked', 'REA_CANCELLED', cleanup);
    if (failure && ['REA_SELECTOR_REQUIRED', 'REA_FEATURE_QUERY_REQUIRED'].includes(code)) return Object.freeze({ ...result('clarification_required', code, cleanup), clarification: 'Specify the exact selected procedure, class, method or feature seed. No symbol or overload will be guessed.' });
    if (failure || !report) return result(code === 'REA_CONFIGURATION_REQUIRED' ? 'configuration_required' : ['REA_NOT_AVAILABLE', 'REA_OPERATION_NOT_AVAILABLE'].includes(code) ? 'not_available' : 'failed', code, cleanup);
    reports.add(report);
    if (remoteCleanupUnverified) return result('unknown_effect', 'REA_PROVIDER_CLEANUP_UNVERIFIED', { closed: cleanup.closed, unknownEffect: true }, report);
    if (!report.technicalFacts.length && !report.relationships.length) return result('partial', 'REA_INTERNAL_REPORTING_GAP', cleanup, report);
    return result(report.sourceCoverage === 'complete' ? 'completed' : 'partial', 'REA_EVIDENCE_VERIFIED', cleanup, report);
  }
  const admission = Object.freeze({
    issueAuthority(context: ReaAuthorityContext): ReaAuthority {
      for (const value of [context.ownerId, context.workspaceId, context.taskId, context.runId, context.serverBootId]) if (!id(value)) throw new GateError('REA_AUTHORITY_INVALID');
      if (context.sessionId !== undefined && !id(context.sessionId)) throw new GateError('REA_AUTHORITY_INVALID');
      if (!(context.signal instanceof AbortSignal) || !Number.isFinite(context.expiresAt) || context.expiresAt <= Date.now()) throw new GateError('REA_AUTHORITY_INVALID');
      const snapshot = Object.freeze({ ...context }); check(snapshot);
      const token = Object.freeze({}) as ReaAuthority; authorities.set(token, snapshot); return token;
    },
    registerSelection(binding: ReaSelectionBinding): string {
      if (!id(binding.ownerId) || !id(binding.workspaceId) || !sha(binding.sha256) || (binding.kind !== undefined && !['file', 'directory'].includes(binding.kind)) || !path.isAbsolute(binding.workspaceRoot) || !path.isAbsolute(binding.absolutePath) || !Number.isFinite(binding.expiresAt) || binding.expiresAt <= Date.now()) throw new GateError('REA_SELECTION_INVALID');
      for (const [ref, saved] of selections) if (saved.expiresAt <= Date.now()) selections.delete(ref);
      if (selections.size >= 256) throw new GateError('REA_ADMISSION_LIMIT');
      const ref = `selection_${randomUUID()}`; selections.set(ref, Object.freeze({ ...binding })); return ref;
    },
    revokeSelection(selectionRef: string) { selections.delete(selectionRef); },
    registerRemoteSelection(binding: ReaRemoteSelectionBinding): string {
      const target = createReaRemoteTarget(binding);
      for (const [ref, saved] of remoteSelections) if (saved.binding.expiresAt <= Date.now()) remoteSelections.delete(ref);
      if (remoteSelections.size >= 256) throw new GateError('REA_ADMISSION_LIMIT');
      const ref = `remote_${randomUUID()}`; remoteSelections.set(ref, target); return ref;
    },
    revokeRemoteSelection(selectionRef: string) { remoteSelections.delete(selectionRef); },
  });
  const service: ReaAnalysisService = Object.freeze({
    async run(value: unknown, authority: ReaAuthority): Promise<ReaAnalysisResult> {
      const context = authority && typeof authority === 'object' ? authorities.get(authority) : undefined;
      if (!context) return result('blocked', 'REA_AUTHORITY_INVALID');
      let input: ReturnType<typeof parseReaAnalysisInput>;
      try { check(context); input = parseReaAnalysisInput(value); }
      catch (error) { return result('blocked', error instanceof GateError ? error.code : 'REA_INPUT_INVALID'); }
      if (input.exportAuthorizationRef !== undefined) return result('blocked', 'REA_EXPORT_NOT_CONFIGURED');
      const isRemote = ['web', 'electron-passive-runtime', 'runtime-observation'].includes(input.profile);
      const binding: Selection | undefined = isRemote ? remoteSelections.get(input.selectionRef) : selections.get(input.selectionRef);
      if (!binding) return result('blocked', isRemote ? 'REA_REMOTE_SELECTION_FORBIDDEN' : 'REA_SELECTION_FORBIDDEN');
      if (remote(binding)) {
        try { if (binding.binding.profile !== input.profile) throw new ReaContractError('REA_REMOTE_SELECTION_FORBIDDEN'); assertReaRemoteTarget(binding, context); }
        catch (error) { return result('blocked', error instanceof ReaContractError ? error.code : 'REA_REMOTE_SELECTION_FORBIDDEN'); }
        if (binding.binding.target.kind === 'web-url') return result('not_available', 'REA_REMOTE_NETWORK_UNSUPPORTED');
        if (!remoteQualificationRefs.includes(binding.binding.qualificationRef)) return result('configuration_required', 'REA_CONFIGURATION_REQUIRED');
      } else if (binding.ownerId !== context.ownerId || binding.workspaceId !== context.workspaceId) return result('blocked', 'REA_SELECTION_FORBIDDEN');
      try { check(context, input.selectionRef, binding); if (!profileReady(input.profile)) throw new GateError('REA_PROFILE_NOT_READY'); }
      catch (error) { return result('blocked', error instanceof GateError || error instanceof ReaContractError ? error.code : 'REA_AUTHORITY_REVOKED'); }
      if (['static-javascript', 'static-managed'].includes(input.profile) && !input.featureQuery && /(?:nasıl|özellik|\bhow\b|\bfeature\b|\btrace\b|\bflow\b|akış)/iu.test(input.objective)) {
        return Object.freeze({ ...result('clarification_required', 'REA_FEATURE_QUERY_REQUIRED'), clarification: 'Specify the feature description and an exact node, literal, route, channel or semantic selector. No target symbol will be guessed.' });
      }
      const configurationKeys: Partial<Record<ReaProfile, 'appPackage' | 'native' | 'android' | 'apkResources'>> = { 'app-package': 'appPackage', 'native-binary': 'native', 'static-apk': 'android', 'apk-resources': 'apkResources' };
      const configurationKey = configurationKeys[input.profile];
      if (configurationKey && !configuration[configurationKey]) return result('configuration_required', 'REA_CONFIGURATION_REQUIRED');
      const key = digest(JSON.stringify([context.ownerId, context.workspaceId, context.taskId, context.runId]));
      const requestDigest = digest(JSON.stringify(input));
      const existing = runs.get(key);
      if (existing) {
        if (existing.requestDigest !== requestDigest) return result('blocked', 'REA_IDEMPOTENCY_CONFLICT');
        const replay = await existing.promise;
        try { check(context, input.selectionRef, binding); if (!profileReady(input.profile)) throw new GateError('REA_PROFILE_NOT_READY'); }
        catch (error) { return result('blocked', error instanceof GateError || error instanceof ReaContractError ? error.code : 'REA_AUTHORITY_REVOKED'); }
        return replay;
      }
      if (activeRuns >= 1) return result('blocked', 'REA_BUSY');
      if (runs.size >= 256) return result('blocked', 'REA_ADMISSION_LIMIT');
      activeRuns++;
      const promise = execute(input, context, binding).finally(() => { activeRuns--; });
      runs.set(key, { requestDigest, promise }); return promise;
    },
  });
  return Object.freeze({ service, admission });
}
