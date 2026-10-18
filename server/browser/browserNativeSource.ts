import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { BrowserWorkflowAction } from '../../src/edith/core';
import type { OwnedEngineInventoryView, RetainedOwnedLaunchView } from './browserSessionStore';
import type { ParsedBrowserWorkflowRequest, BrowserPageObservation, BrowserOperatorReceipt } from '../../src/edith/browserOperatorContract';
import type { BackendConsumedCommandRef, BackendConsumedEnterCommandRef, DispatchRef, BrowserNativeSourceHandle, NativeSourceCaptureArgs, NativeSourceEnginePort, NativeSourceTargetCap,
  NativeSourceSnapshotCap, NativeSourceInputCap, NativeSourcePostconditionCap } from './browserNativePrivateContract';

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const frozen = <T>(value: T): T => {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) frozen(child); Object.freeze(value); }
  return value;
};
const view = <T>(value: T): T => frozen(structuredClone(value));
const token = <T>() => Object.freeze(Object.create(null)) as T;
/** A server-owned isolated-world node. No node ID from a caller becomes this reference. */
export interface NativeSourceNode {
  inspect(): Promise<NativeSourceTargetView>;
  dispose(): Promise<void>;
}
export interface NativeSourceTargetView {
  readonly targetId: string; readonly tag: string; readonly type: string; readonly semantic: string;
  readonly rect: readonly number[]; readonly viewport: readonly number[];
  readonly value: string; readonly writable: boolean; readonly href?: string;
  readonly intendedPoint?: readonly number[]; readonly exactIsolatedHit?: true; readonly ancestry?: readonly string[];
}
/** Adapter-created host only. Effects are deliberately absent from this interface. */
export interface NativeRetainedSourceHost {
  readonly sourceEpochDigest: string;
  guard(): void;
  guardNativeProfile(): void;
  inspectHeldSource(): Readonly<{ launch: RetainedOwnedLaunchView; inventory: OwnedEngineInventoryView; documentId: string }>;
  current(): Promise<boolean>;
  observe(): Promise<BrowserPageObservation>;
  locate(selector: string, approvedHref?: string): Promise<NativeSourceNode>;
  retainScrollSurface(): Promise<NativeSourceNode>;
  scrollExtent(): Promise<number>;
  searchProfile(): Promise<NativeSearchProfile>;
  watchNavigation(expectedUrl: string, reason: 'formSubmissionGet' | 'anchorClick', deadline: number): Promise<NativeNavigationWatch>;
  prepareObservedTransition(expectedUrl: string, reason: 'formSubmissionGet' | 'anchorClick', deadline: number): Promise<NativeObservedTransitionHost>;
  observeGoal(expectedUrl: string, action: 'search' | 'navigate', query?: string): Promise<BrowserPageObservation>;
  dispose(): Promise<void>;
}
export interface NativeSearchProfile { readonly selector: 'input[type="search"][name="q"]'; readonly actionUrl: string; readonly expectedUrl: string; }
export interface NativeNavigationFacts {
  readonly expectedUrl: string; readonly reason: 'formSubmissionGet' | 'anchorClick';
  readonly requested: boolean; readonly documentGet: boolean; readonly responseObserved: boolean;
  readonly loaderChanged: boolean; readonly redirected: boolean; readonly competingEdge: boolean;
  readonly nativeKeyCausalProvenance: 'unavailable'; readonly terminal: boolean;
  readonly requestId?: string; readonly requestLoaderId?: string; readonly frameLoaderId?: string;
}
export interface NativeNavigationWatch { inspect(): Readonly<NativeNavigationFacts>; dispose(): Promise<void>; }
export interface NativeObservedTransitionHost extends NativeNavigationWatch {
  arm(): number;
  guard(): void;
  captureSuccessor(onLost: () => void): Promise<NativeRetainedSourceHost>;
  awaitTerminal(): Promise<void>;
  hasRetirementStarted(): boolean;
}
declare const sourceCausalBrand: unique symbol;
export type NativeSourceCausalCap = Readonly<{ readonly [sourceCausalBrand]: 'finite-causal-edge' }>;
export interface NativeDormantArmFacts { readonly state: 'dormant' | 'denied'; readonly expiresAtMs: number; readonly sourceEpochDigest: string; readonly causalProvenance: 'unavailable'; }
export interface NativeSourceView {
  readonly requestHash: string; readonly context: Readonly<{ actor: string; taskId: string }>;
  readonly deadline: number; readonly sourceEpochDigest: string; readonly sessionId: string; readonly pageId: string;
  readonly request: Readonly<ParsedBrowserWorkflowRequest>;
}
export interface NativeSourceInputView {
  readonly kind: 'replace-text' | 'fixed-return' | 'href-click' | 'scroll-profile-wheel'; readonly text?: string;
  readonly expectedPrimaryEventCount: number; readonly targetId: string; readonly sourceEpochDigest: string;
  readonly clearPlan?: 'ctrl-a-backspace';
}
export interface NativeSourceSnapshotView {
  readonly before: BrowserPageObservation; readonly target: NativeSourceTargetView; readonly sourceEpochDigest: string;
}
export interface NativeSourcePostconditionView {
  readonly before: BrowserPageObservation; readonly after: BrowserPageObservation;
  readonly postconditions: BrowserOperatorReceipt['postconditions']; readonly sessionId: string; readonly pageId: string;
  readonly targetId: string; readonly requestHash: string; readonly sourceEpochDigest: string;
}
interface Source { args: NativeSourceCaptureArgs; host: NativeRetainedSourceHost; facts: NativeSourceView; lost: boolean; targets: number; }
interface Target { source: Source; node?: NativeSourceNode; action: BrowserWorkflowAction; key?: string; facts: NativeSourceTargetView; before: BrowserPageObservation; expectedY?: number; causalPrepared?: boolean; }
/** Private issuer: its exact WeakMaps, never structural flags, authenticate every capability. */
export class BrowserNativeSource implements NativeSourceEnginePort {
  private readonly sources = new WeakMap<BrowserNativeSourceHandle, Source>();
  private readonly targets = new WeakMap<NativeSourceTargetCap, Target>();
  private readonly snapshots = new WeakMap<NativeSourceSnapshotCap, { source: Source; facts: NativeSourceSnapshotView }>();
  private readonly inputs = new WeakMap<NativeSourceInputCap, { source: Source; facts: NativeSourceInputView }>();
  private readonly postconditions = new WeakMap<NativeSourcePostconditionCap, { source: Source; target: Target; facts: NativeSourcePostconditionView }>();
  private readonly causalEdges = new WeakMap<NativeSourceCausalCap, { source: Source; target: Target; watch: NativeObservedTransitionHost; expiresAtMs: number; sealed: boolean; command?: BackendConsumedCommandRef; commandVerifier?: (command: BackendConsumedCommandRef, args: NativeSourceCaptureArgs) => void; armed: boolean; captureClaimed?: boolean; }>();
  private readonly armedCommands = new WeakMap<BackendConsumedEnterCommandRef, NativeSourceCausalCap>();
  private readonly executableFacts = new WeakMap<object, Readonly<{ canonicalExecutablePath: string; executableSha256: string }>>();
  private readonly successors = new WeakMap<NativeSourceCausalCap, Readonly<{ source: BrowserNativeSourceHandle; postcondition: NativeSourcePostconditionCap; originSourceEpochDigest: string }>>();
  private readonly successorLineage = new WeakMap<Source, Target>();
  constructor(private readonly capture: (args: NativeSourceCaptureArgs, onLost: () => void) => Promise<NativeRetainedSourceHost>) {}
  async captureNativeRetainedSource(args: NativeSourceCaptureArgs): Promise<BrowserNativeSourceHandle> {
    args.guard();
    if (!args.nativeBootRef || typeof args.nativeBootRef !== 'object' || !args.attemptRef || !args.owner
      || !Number.isFinite(args.deadline) || args.deadline <= Date.now() || args.deadline > Date.now() + 30000) throw new Error('NATIVE_BINDING_UNAVAILABLE');
    const retained = Object.freeze({ ...args, context: view(args.context), request: view(args.request) });
    let lost = false;
    const host = await this.capture(retained, () => { lost = true; });
    try {
      args.guard(); host.guard();
      if (lost || !await host.current()) throw new Error('TARGET_CONTEXT_CHANGED');
      args.guard(); host.guard();
      const facts: NativeSourceView = view({ requestHash: digest(retained.request), context: retained.context, deadline: retained.deadline,
        sourceEpochDigest: host.sourceEpochDigest, sessionId: args.sessionId, pageId: args.pageId, request: retained.request });
      const cap = token<BrowserNativeSourceHandle>();
      const source: Source = { args: retained, host, facts, lost: false, targets: 0 };
      // Closure captures the permanent loss state; a later healthy DOM never reacquires authority.
      Object.defineProperty(source, 'lost', { get: () => lost, set: value => { if (value) lost = true; } });
      this.sources.set(cap, source); return cap;
    } catch (error) { await host.dispose(); throw error; }
  }
  private checked(source: Source): Source {
    try { if (source.lost || Date.now() >= source.args.deadline) throw new Error('TARGET_CONTEXT_CHANGED'); source.args.guard(); source.host.guard(); return source; }
    catch (error) { source.lost = true; void source.host.dispose(); throw error; }
  }
  private source(cap: BrowserNativeSourceHandle): Source { const source = this.sources.get(cap); if (!source) throw new Error('TARGET_CONTEXT_CHANGED'); return this.checked(source); }
  private target(source: Source, cap: NativeSourceTargetCap): Target { const target = this.targets.get(cap); if (!target || target.source !== source) throw new Error('TARGET_CONTEXT_CHANGED'); this.checked(source); return target; }
  private async fresh(source: Source): Promise<void> {
    this.checked(source);
    try { if (!await source.host.current()) throw new Error('TARGET_CONTEXT_CHANGED'); this.checked(source); }
    catch (error) { source.lost = true; void source.host.dispose(); throw error; }
  }
  guardSource(cap: BrowserNativeSourceHandle): void { this.source(cap); }
  guardNativeObservedProfile(cap: BrowserNativeSourceHandle): void { const source = this.source(cap); source.host.guardNativeProfile(); this.checked(source); }
  guardObservedScope(cap: NativeSourceCausalCap): void {
    const edge = this.causalEdges.get(cap); if (!edge) throw new Error('TARGET_CONTEXT_CHANGED');
    const successor = this.successors.get(cap);
    if (successor) { this.source(successor.source); return; }
    if (edge.sealed || Date.now() >= edge.expiresAtMs) throw new Error('TARGET_CONTEXT_CHANGED');
    if (!edge.armed) this.checked(edge.source);
    edge.source.args.guard(); edge.watch.guard();
  }
  inspectSource(cap: BrowserNativeSourceHandle): Readonly<NativeSourceView> { return view(this.source(cap).facts); }
  inspectSourceIdentity(cap: BrowserNativeSourceHandle) {
    const source = this.source(cap);
    return Object.freeze({ attemptRef: source.args.attemptRef, nativeBootRef: source.args.nativeBootRef, owner: source.args.owner });
  }
  inspectHeldSource(cap: BrowserNativeSourceHandle) {
    const source = this.source(cap); return source.host.inspectHeldSource();
  }
  inspectNativeLaunchDescriptor(cap: BrowserNativeSourceHandle) {
    const source = this.source(cap), held = source.host.inspectHeldSource(), child = held.launch.process;
    if (!Number.isSafeInteger(child.pid) || child.pid! <= 0 || child.pid! > 0xffffffff || child.exitCode !== null || child.signalCode !== null || !child.spawnfile || !path.isAbsolute(child.spawnfile)) throw new Error('TARGET_CONTEXT_CHANGED');
    let executable = this.executableFacts.get(child);
    if (!executable) {
      const canonicalExecutablePath = fs.realpathSync.native(child.spawnfile);
      if (canonicalExecutablePath.length > 4096 || !fs.statSync(canonicalExecutablePath).isFile()) throw new Error('TARGET_CONTEXT_CHANGED');
      const executableSha256 = createHash('sha256').update(fs.readFileSync(canonicalExecutablePath)).digest('hex');
      executable = Object.freeze({ canonicalExecutablePath, executableSha256 }); this.executableFacts.set(child, executable);
    }
    this.checked(source); if (source.host.inspectHeldSource().launch.process !== child) throw new Error('TARGET_CONTEXT_CHANGED');
    return view({ processLaunchRef: held.launch.launchEpoch, pid: child.pid!, ...executable, launchEpoch: held.launch.launchEpoch, childProcessAlive: true as const });
  }
  inspectNativeTargetDescriptor(cap: BrowserNativeSourceHandle, targetCap: NativeSourceTargetCap, snapshotCap: NativeSourceSnapshotCap) {
    const source = this.source(cap), target = this.target(source, targetCap), row = this.snapshots.get(snapshotCap);
    if (!row || row.source !== source || row.facts.target.targetId !== target.facts.targetId) throw new Error('TARGET_CONTEXT_CHANGED');
    const facts = row.facts.target, held = source.host.inspectHeldSource();
    if (facts.exactIsolatedHit !== true || !facts.ancestry?.length || facts.intendedPoint?.length !== 2 || facts.rect.length !== 4
      || facts.viewport[2] !== 1 || facts.viewport[3] !== 1 || facts.viewport[4] !== 0 || facts.viewport[5] !== 0) throw new Error('UNSUPPORTED_ACTION');
    const logicalRootRef = digest({ document: held.documentId, source: source.facts.sourceEpochDigest, root: 'retained-document-element' });
    return view({ targetRef: facts.targetId, semanticDigest: digest(facts.semantic), tag: facts.tag, type: facts.type, writable: facts.writable,
      rectCss: { x: facts.rect[0], y: facts.rect[1], width: facts.rect[2], height: facts.rect[3] }, intendedPointCss: { x: facts.intendedPoint[0], y: facts.intendedPoint[1] },
      isolatedHitTargetRef: facts.targetId, isolatedHitProofDigest: digest({ target: facts.targetId, point: facts.intendedPoint, rect: facts.rect, source: source.facts.sourceEpochDigest, hit: 'same-retained-node' }),
      logicalDocumentRef: held.documentId, logicalRootRef, logicalAncestryDigest: digest(facts.ancestry),
      engineTargetIdentityDigest: digest({ target: held.inventory.targetId, frame: held.inventory.frameId, loader: held.inventory.loaderId, document: held.documentId, node: facts.targetId }) });
  }
  async prepareTarget(cap: BrowserNativeSourceHandle, action: BrowserWorkflowAction, index = 0): Promise<NativeSourceTargetCap> {
    const source = this.source(cap), request = source.args.request;
    if (action !== request.action || !Number.isSafeInteger(index) || index < 0 || source.targets >= 10) throw new Error('UNSUPPORTED_ACTION');
    // Native Return admission requires independently proved engine causal provenance. It is not inferred from isTrusted.
    if (!['fill_form', 'navigate', 'scroll', 'search'].includes(action)) throw new Error('UNSUPPORTED_ACTION');
    await this.fresh(source);
    const before = await source.host.observe(); await this.fresh(source);
    let node: NativeSourceNode | undefined, key: string | undefined, expectedY: number | undefined;
    let facts: NativeSourceTargetView;
    if (action === 'scroll') {
      if (index !== 0) throw new Error('UNSUPPORTED_ACTION');
      const extent = await source.host.scrollExtent(); await this.fresh(source);
      expectedY = Math.max(0, Math.min(extent, before.viewport.scrollY + request.scrollDeltaY!));
      if (expectedY === before.viewport.scrollY) throw new Error('SCROLL_BOUNDARY');
      node = await source.host.retainScrollSurface();
      try { await this.fresh(source); facts = await node.inspect(); await this.fresh(source); }
      catch (error) { await node.dispose(); throw error; }
    } else {
      const keys = Object.keys(request.selectors ?? {});
      key = action === 'fill_form' ? keys[index] : undefined;
      if (action === 'fill_form' && key === undefined || ['navigate', 'search'].includes(action) && index !== 0) throw new Error('TARGET_NOT_FOUND');
      const profile = action === 'search' ? await source.host.searchProfile() : undefined; await this.fresh(source);
      node = await source.host.locate(action === 'navigate' ? 'a[href]' : profile?.selector ?? request.selectors![key!], action === 'navigate' ? request.url : undefined);
      try { await this.fresh(source); facts = await node.inspect(); await this.fresh(source);
        if (['fill_form', 'search'].includes(action) && !facts.writable || action === 'navigate' && facts.href !== request.url) throw new Error('TARGET_CONTEXT_CHANGED');
      } catch (error) { await node.dispose(); throw error; }
    }
    const target = token<NativeSourceTargetCap>(); this.targets.set(target, { source, node, action, key, facts: view(facts), before: view(before), expectedY }); source.targets++; return target;
  }
  async snapshot(cap: BrowserNativeSourceHandle, targetCap: NativeSourceTargetCap): Promise<NativeSourceSnapshotCap> {
    const source = this.source(cap), target = this.target(source, targetCap); await this.fresh(source);
    const facts = target.node ? await target.node.inspect() : target.facts; await this.fresh(source);
    if (facts.semantic !== target.facts.semantic || digest(facts.rect) !== digest(target.facts.rect) || digest(facts.viewport) !== digest(target.facts.viewport)
      || ['fill_form', 'search'].includes(target.action) && !facts.writable || target.action === 'navigate' && facts.href !== source.args.request.url) throw new Error('TARGET_STALE');
    const before = await source.host.observe(); await this.fresh(source);
    if (target.action === 'scroll' && (before.viewport.scrollY !== target.before.viewport.scrollY || before.viewport.scrollX !== target.before.viewport.scrollX)) throw new Error('TARGET_STALE');
    const snapshot = token<NativeSourceSnapshotCap>(); this.snapshots.set(snapshot, { source, facts: view({ before, target: facts, sourceEpochDigest: source.facts.sourceEpochDigest }) }); return snapshot;
  }
  inspectSnapshot(cap: NativeSourceSnapshotCap): Readonly<NativeSourceSnapshotView> { const row = this.snapshots.get(cap); if (!row) throw new Error('TARGET_CONTEXT_CHANGED'); this.checked(row.source); return view(row.facts); }
  async planInput(cap: BrowserNativeSourceHandle, targetCap: NativeSourceTargetCap): Promise<NativeSourceInputCap> {
    const source = this.source(cap), target = this.target(source, targetCap); await this.snapshot(cap, targetCap); await this.fresh(source);
    const text = target.action === 'fill_form' ? source.args.request.fieldValues![target.key!] : target.action === 'search' ? source.args.request.query! : undefined;
    const facts: NativeSourceInputView = { kind: text !== undefined ? 'replace-text' : target.action === 'navigate' ? 'href-click' : 'scroll-profile-wheel',
      ...(text === undefined ? {} : { text, clearPlan: 'ctrl-a-backspace' as const }), expectedPrimaryEventCount: text !== undefined ? 2 + 6 + text.length * 2 : target.action === 'navigate' ? 2 : 1,
      targetId: target.facts.targetId, sourceEpochDigest: source.facts.sourceEpochDigest };
    const input = token<NativeSourceInputCap>(); this.inputs.set(input, { source, facts: view(facts) }); return input;
  }
  inspectInput(cap: NativeSourceInputCap): Readonly<NativeSourceInputView> { const row = this.inputs.get(cap); if (!row) throw new Error('TARGET_CONTEXT_CHANGED'); this.checked(row.source); return view(row.facts); }
  planFixedReturnInput(cap: BrowserNativeSourceHandle, targetCap: NativeSourceTargetCap): NativeSourceInputCap {
    const source = this.source(cap), target = this.target(source, targetCap);
    if (target.action !== 'search') throw new Error('UNSUPPORTED_ACTION');
    const input = token<NativeSourceInputCap>(); this.inputs.set(input, { source, facts: view({ kind: 'fixed-return', expectedPrimaryEventCount: 2,
      targetId: target.facts.targetId, sourceEpochDigest: source.facts.sourceEpochDigest }) }); return input;
  }
  async prepareNativeSearchTarget(cap: BrowserNativeSourceHandle): Promise<NativeSourceTargetCap> { return this.prepareTarget(cap, 'search'); }
  async validateNativeSearchProfile(cap: BrowserNativeSourceHandle): Promise<void> {
    const source = this.source(cap); await source.host.searchProfile(); await this.fresh(source);
  }
  async verifyReplacement(cap: BrowserNativeSourceHandle, targetCap: NativeSourceTargetCap): Promise<NativeSourcePostconditionCap> {
    const source = this.source(cap), target = this.target(source, targetCap);
    if (target.action !== 'search') throw new Error('UNSUPPORTED_ACTION');
    await this.fresh(source); const actual = await target.node!.inspect(); await this.fresh(source);
    if (!actual.writable || actual.semantic !== target.facts.semantic || actual.value !== source.args.request.query) throw new Error('READBACK_MISMATCH');
    const after = await source.host.observe(); await this.fresh(source);
    const fingerprint = createHash('sha256').update(actual.value).digest('hex');
    const facts: NativeSourcePostconditionView = { before: target.before, after, postconditions: [{ kind: 'field_value_matched', matched: true, expectedFingerprint: fingerprint, observedFingerprint: fingerprint, evidenceId: after.id }],
      sessionId: source.facts.sessionId, pageId: source.facts.pageId, targetId: target.facts.targetId, requestHash: source.facts.requestHash, sourceEpochDigest: source.facts.sourceEpochDigest };
    const result = token<NativeSourcePostconditionCap>(); this.postconditions.set(result, { source, target, facts: view(facts) }); return result;
  }
  async armExactSearchSubmit(cap: BrowserNativeSourceHandle, targetCap: NativeSourceTargetCap, replacement: NativeSourcePostconditionCap,
    command: BackendConsumedEnterCommandRef, verifyConsumedCommand: (command: BackendConsumedEnterCommandRef, args: NativeSourceCaptureArgs) => void): Promise<NativeSourceCausalCap> {
    const source = this.source(cap), target = this.target(source, targetCap);
    if (target.action !== 'search' || !this.verifyIssuedPostcondition(replacement, cap, targetCap)) throw new Error('TARGET_CONTEXT_CHANGED');
    if (!command || typeof command !== 'object') throw new Error('TARGET_CONTEXT_CHANGED');
    const existing = this.armedCommands.get(command);
    if (existing) {
      const edge = this.causalEdges.get(existing)!; verifyConsumedCommand(command, source.args);
      if (edge.source !== source || edge.target !== target || edge.sealed || Date.now() >= edge.expiresAtMs) throw new Error('TARGET_CONTEXT_CHANGED');
      return existing;
    }
    if (target.causalPrepared) throw new Error('TARGET_CONTEXT_CHANGED');
    target.causalPrepared = true;
    verifyConsumedCommand(command, source.args); await this.fresh(source);
    const profile = await source.host.searchProfile(); await this.fresh(source); verifyConsumedCommand(command, source.args);
    const expiresAtMs = source.args.deadline;
    const watch = await source.host.prepareObservedTransition(profile.expectedUrl, 'formSubmissionGet', expiresAtMs);
    try { await this.fresh(source); verifyConsumedCommand(command, source.args);
      const edge = token<NativeSourceCausalCap>(); this.causalEdges.set(edge, { source, target, watch, expiresAtMs, sealed: false, armed: false });
      this.armPreparedObservedTransition(edge, command as unknown as BackendConsumedCommandRef, (held, args) => verifyConsumedCommand(held as unknown as BackendConsumedEnterCommandRef, args));
      this.armedCommands.set(command, edge); return edge;
    } catch (error) { await watch.dispose(); throw error; }
  }
  async prepareHrefSuccessor(cap: BrowserNativeSourceHandle, targetCap: NativeSourceTargetCap): Promise<NativeSourceCausalCap> {
    const source = this.source(cap), target = this.target(source, targetCap);
    if (target.action !== 'navigate') throw new Error('UNSUPPORTED_ACTION');
    if (target.causalPrepared) throw new Error('TARGET_CONTEXT_CHANGED'); target.causalPrepared = true;
    await this.snapshot(cap, targetCap);
    const expiresAtMs = source.args.deadline;
    const watch = await source.host.prepareObservedTransition(source.args.request.url!, 'anchorClick', expiresAtMs);
    try { await this.fresh(source); const edge = token<NativeSourceCausalCap>(); this.causalEdges.set(edge, { source, target, watch, expiresAtMs, sealed: false, armed: false }); return edge; }
    catch (error) { await watch.dispose(); throw error; }
  }
  async prepareSearchSubmitSuccessor(cap: BrowserNativeSourceHandle, targetCap: NativeSourceTargetCap, replacement?: NativeSourcePostconditionCap): Promise<NativeSourceCausalCap> {
    const source = this.source(cap), target = this.target(source, targetCap);
    if (target.action !== 'search' || target.causalPrepared || replacement !== undefined && !this.verifyIssuedPostcondition(replacement, cap, targetCap)) throw new Error('TARGET_CONTEXT_CHANGED');
    target.causalPrepared = true; const profile = await source.host.searchProfile(); await this.fresh(source);
    const expiresAtMs = source.args.deadline;
    const watch = await source.host.prepareObservedTransition(profile.expectedUrl, 'formSubmissionGet', expiresAtMs);
    try { await this.fresh(source); const edge = token<NativeSourceCausalCap>(); this.causalEdges.set(edge, { source, target, watch, expiresAtMs, sealed: false, armed: false }); return edge; }
    catch (error) { await watch.dispose(); throw error; }
  }
  /** All awaited preparation precedes this actual consumed-command association. */
  armPreparedObservedTransition(cap: NativeSourceCausalCap, command: BackendConsumedCommandRef,
    verifyConsumedCommand: (command: BackendConsumedCommandRef, args: NativeSourceCaptureArgs) => void): void {
    const edge = this.causalEdges.get(cap); if (!edge || edge.armed || edge.sealed || Date.now() >= edge.expiresAtMs || !command || typeof command !== 'object') throw new Error('TARGET_CONTEXT_CHANGED');
    this.checked(edge.source); verifyConsumedCommand(command, edge.source.args); edge.watch.guard();
    edge.command = command; edge.commandVerifier = verifyConsumedCommand; edge.armed = true;
    try { edge.expiresAtMs = edge.watch.arm(); } catch (error) { edge.sealed = true; void edge.watch.dispose(); throw error; }
  }
  /** Pure pre-input discriminator. It neither claims capture nor waits, renews, or issues a capability. */
  async assertObservedSuccessorStarted(cap: NativeSourceCausalCap): Promise<void> {
    const edge = this.causalEdges.get(cap); if (!edge || !edge.armed || !edge.command || !edge.commandVerifier) throw new Error('TARGET_CONTEXT_CHANGED');
    edge.source.args.guard(); edge.commandVerifier(edge.command, edge.source.args);
    const existing = this.successors.get(cap); if (existing) { this.source(existing.source); return; }
    if (edge.sealed || Date.now() >= edge.expiresAtMs) throw new Error('TARGET_CONTEXT_CHANGED');
    const started = () => {
      const facts = edge.watch.inspect();
      return edge.watch.hasRetirementStarted() || facts.requested || facts.documentGet || facts.responseObserved || facts.loaderChanged;
    };
    const guardPending = () => {
      edge.source.args.guard(); edge.commandVerifier!(edge.command!, edge.source.args); edge.watch.guard();
      const facts = edge.watch.inspect();
      if (facts.competingEdge || facts.redirected || facts.terminal && !started()) throw new Error('READBACK_MISMATCH');
    };
    guardPending(); if (started()) return;
    try {
      await this.fresh(edge.source); guardPending(); if (started()) return;
      if (!edge.target.node) throw new Error('TARGET_CONTEXT_CHANGED');
      const current = await edge.target.node.inspect();
      guardPending();
      if (current.semantic !== edge.target.facts.semantic || digest(current.rect) !== digest(edge.target.facts.rect)
        || digest(current.viewport) !== digest(edge.target.facts.viewport) || current.targetId !== edge.target.facts.targetId
        || edge.target.action === 'search' && (!current.writable || current.value !== edge.source.args.request.query)
        || edge.target.action === 'navigate' && current.href !== edge.source.args.request.url) throw new Error('TARGET_STALE');
      if (started()) return;
      await this.fresh(edge.source); guardPending();
    } catch (error) {
      // Only actual admitted retirement can explain an old-document current check racing this read.
      // All other errors, including command/owner/boot/geometry loss, remain terminal.
      if (error instanceof Error && error.message === 'TARGET_CONTEXT_CHANGED' && edge.watch.hasRetirementStarted()) {
        guardPending(); return;
      }
      throw error;
    }
    if (started()) return;
    this.checked(edge.source); guardPending();
    if (started()) return;
    throw new Error('NATIVE_SUCCESSOR_NOT_STARTED');
  }
  async captureObservedSuccessor(cap: NativeSourceCausalCap): Promise<BrowserNativeSourceHandle> {
    const edge = this.causalEdges.get(cap); if (!edge) throw new Error('TARGET_CONTEXT_CHANGED');
    const existing = this.successors.get(cap); if (existing) { this.source(existing.source); return existing.source; }
    if (edge.sealed || !edge.armed || !edge.command || Date.now() >= edge.expiresAtMs) throw new Error('TARGET_CONTEXT_CHANGED');
    await this.assertObservedSuccessorStarted(cap);
    edge.commandVerifier!(edge.command, edge.source.args);
    if (edge.captureClaimed) throw new Error('TARGET_CONTEXT_CHANGED'); edge.captureClaimed = true;
    try { edge.source.args.guard(); edge.watch.guard(); await edge.watch.awaitTerminal(); edge.source.args.guard(); edge.commandVerifier!(edge.command, edge.source.args); edge.watch.guard(); }
    catch (error) { edge.sealed = true; await edge.watch.dispose(); throw error; }
    const observed = edge.watch.inspect();
    if (!observed.terminal || !observed.requested || !observed.documentGet || !observed.responseObserved || !observed.loaderChanged
      || observed.competingEdge || observed.redirected || !observed.requestId || !observed.requestLoaderId || observed.requestLoaderId !== observed.frameLoaderId) {
      edge.sealed = true; await edge.watch.dispose(); throw new Error('READBACK_MISMATCH');
    }
    let lost = false, host: NativeRetainedSourceHost;
    try { host = await edge.watch.captureSuccessor(() => { lost = true; }); }
    catch (error) { edge.sealed = true; await edge.watch.dispose(); throw error; }
    try {
      edge.source.args.guard(); edge.commandVerifier!(edge.command, edge.source.args); host.guard();
      const after = await host.observeGoal(observed.expectedUrl, edge.target.action === 'search' ? 'search' : 'navigate', edge.source.args.request.query);
      edge.source.args.guard(); edge.commandVerifier!(edge.command, edge.source.args); host.guard(); if (lost || !await host.current() || after.documentId === edge.target.before.documentId) throw new Error('TARGET_CONTEXT_CHANGED');
      edge.source.args.guard(); edge.commandVerifier!(edge.command, edge.source.args); host.guard();
      const facts: NativeSourceView = view({ ...edge.source.facts, sourceEpochDigest: host.sourceEpochDigest });
      const successor: Source = { args: edge.source.args, host, facts, targets: 0, lost: false };
      Object.defineProperty(successor, 'lost', { get: () => lost, set: value => { if (value) lost = true; } });
      const sourceCap = token<BrowserNativeSourceHandle>(); this.sources.set(sourceCap, successor); this.successorLineage.set(successor, edge.target);
      const postcondition = token<NativeSourcePostconditionCap>();
      const expected = edge.target.action === 'search' ? edge.source.args.request.query! : observed.expectedUrl;
      const post: NativeSourcePostconditionView = { before: edge.target.before, after, postconditions: [{ kind: edge.target.action === 'search' ? 'search_results_observed' : 'url_committed', matched: true,
        expectedFingerprint: createHash('sha256').update(expected).digest('hex'), observedFingerprint: createHash('sha256').update(expected).digest('hex'), evidenceId: after.id }],
        sessionId: facts.sessionId, pageId: facts.pageId, targetId: edge.target.facts.targetId, requestHash: facts.requestHash, sourceEpochDigest: facts.sourceEpochDigest };
      this.postconditions.set(postcondition, { source: successor, target: edge.target, facts: view(post) });
      this.successors.set(cap, Object.freeze({ source: sourceCap, postcondition, originSourceEpochDigest: edge.source.facts.sourceEpochDigest }));
      return sourceCap;
    } catch (error) { edge.sealed = true; await host.dispose(); throw error; }
    finally { await edge.watch.dispose(); }
  }
  async sealObservedSuccessor(cap: NativeSourceCausalCap, dispatch: DispatchRef,
    verifyLedger: (dispatch: DispatchRef, args: NativeSourceCaptureArgs, sourceEpochDigest: string, command: BackendConsumedCommandRef) => void): Promise<BrowserNativeSourceHandle> {
    const edge = this.causalEdges.get(cap), successor = this.successors.get(cap);
    if (!edge || edge.sealed || !edge.armed || !edge.command || !successor) throw new Error('TARGET_CONTEXT_CHANGED');
    edge.sealed = true; edge.source.args.guard(); this.source(successor.source);
    verifyLedger(dispatch, edge.source.args, edge.source.facts.sourceEpochDigest, edge.command);
    edge.source.args.guard(); this.source(successor.source); return successor.source;
  }
  inspectObservedSuccessor(cap: NativeSourceCausalCap) {
    const successor = this.successors.get(cap); if (!successor) throw new Error('TARGET_CONTEXT_CHANGED'); this.source(successor.source); return successor;
  }
  inspectHistoricalPostcondition(cap: NativeSourcePostconditionCap, successorCap: BrowserNativeSourceHandle): Readonly<NativeSourcePostconditionView> {
    const successor = this.source(successorCap), target = this.successorLineage.get(successor), row = this.postconditions.get(cap);
    if (!target || !row || row.target !== target || row.source !== target.source || row.facts.requestHash !== successor.facts.requestHash
      || row.facts.sourceEpochDigest !== target.source.facts.sourceEpochDigest || row.facts.after.documentId !== target.before.documentId
      || row.facts.postconditions.length !== 1 || !row.facts.postconditions.every(item => item.kind === 'field_value_matched' && item.matched)) throw new Error('TARGET_CONTEXT_CHANGED');
    return view(row.facts);
  }
  verifyHistoricalPostcondition(cap: NativeSourcePostconditionCap, successorCap: BrowserNativeSourceHandle, targetCap: NativeSourceTargetCap): boolean {
    try { const successor = this.source(successorCap), target = this.targets.get(targetCap);
      if (!target || this.successorLineage.get(successor) !== target) return false;
      this.inspectHistoricalPostcondition(cap, successorCap); return true;
    } catch { return false; }
  }
  inspectDormantArm(cap: NativeSourceCausalCap): Readonly<NativeDormantArmFacts> {
    const edge = this.causalEdges.get(cap); if (!edge) throw new Error('TARGET_CONTEXT_CHANGED');
    this.checked(edge.source);
    const observation = edge.watch.inspect();
    return view({ state: edge.sealed || Date.now() >= edge.expiresAtMs || observation.competingEdge || observation.terminal ? 'denied' : 'dormant', expiresAtMs: edge.expiresAtMs, sourceEpochDigest: edge.source.facts.sourceEpochDigest, causalProvenance: 'unavailable' });
  }
  inspectCausalSuccessor(cap: NativeSourceCausalCap): Readonly<NativeNavigationFacts> {
    const edge = this.causalEdges.get(cap); if (!edge) throw new Error('TARGET_CONTEXT_CHANGED'); edge.source.args.guard(); return view(edge.watch.inspect());
  }
  async sealCausalSuccessor(cap: NativeSourceCausalCap): Promise<never> {
    const edge = this.causalEdges.get(cap); if (!edge || edge.sealed) throw new Error('TARGET_CONTEXT_CHANGED');
    edge.sealed = true;
    try { edge.source.args.guard(); edge.watch.inspect();
      // CDP reports engine navigation, not the native-key/default-action causal identity.
      // Observations and a native dispatch ledger cannot safely invent that missing link.
      throw new Error('UNSUPPORTED_ACTION');
    } finally { await edge.watch.dispose(); }
  }
  async verifyPostcondition(cap: BrowserNativeSourceHandle, targetCap: NativeSourceTargetCap, request: Readonly<ParsedBrowserWorkflowRequest>): Promise<NativeSourcePostconditionCap> {
    const source = this.source(cap), target = this.target(source, targetCap);
    if (digest(request) !== source.facts.requestHash) throw new Error('TARGET_CONTEXT_CHANGED');
    await this.fresh(source);
    // Navigation replaces the retained root/inventory. A causal successor issuer is required; never accept URL coincidence.
    if (target.action === 'navigate') throw new Error('UNSUPPORTED_ACTION');
    const after = await source.host.observe(); await this.fresh(source);
    let expected: string, observed: string, matched: boolean;
    if (target.action === 'fill_form' || target.action === 'search') {
      const facts = await target.node!.inspect(); await this.fresh(source);
      if (facts.semantic !== target.facts.semantic || !facts.writable) throw new Error('TARGET_CONTEXT_CHANGED');
      expected = target.action === 'search' ? source.args.request.query! : source.args.request.fieldValues![target.key!]; observed = facts.value; matched = expected === observed;
    } else { expected = String(target.expectedY); observed = String(after.viewport.scrollY);
      matched = after.viewport.scrollX === target.before.viewport.scrollX && after.viewport.scrollY !== target.before.viewport.scrollY && Math.abs(after.viewport.scrollY - target.expectedY!) <= 1; }
    if (!matched) throw new Error('READBACK_MISMATCH');
    const facts: NativeSourcePostconditionView = { before: target.before, after,
      postconditions: [{ kind: target.action === 'fill_form' || target.action === 'search' ? 'field_value_matched' : 'scroll_offset_matched', matched, expectedFingerprint: createHash('sha256').update(expected).digest('hex'), observedFingerprint: createHash('sha256').update(observed).digest('hex'), evidenceId: after.id }],
      sessionId: source.facts.sessionId, pageId: source.facts.pageId, targetId: target.facts.targetId, requestHash: source.facts.requestHash, sourceEpochDigest: source.facts.sourceEpochDigest };
    const postcondition = token<NativeSourcePostconditionCap>(); this.postconditions.set(postcondition, { source, target, facts: view(facts) }); return postcondition;
  }
  inspectPostcondition(cap: NativeSourcePostconditionCap): Readonly<NativeSourcePostconditionView> { const row = this.postconditions.get(cap); if (!row) throw new Error('TARGET_CONTEXT_CHANGED'); this.checked(row.source); return view(row.facts); }
  verifyIssuedPostcondition(cap: NativeSourcePostconditionCap, sourceCap: BrowserNativeSourceHandle, targetCap: NativeSourceTargetCap): boolean {
    try { const source = this.source(sourceCap), row = this.postconditions.get(cap), target = this.targets.get(targetCap);
      return !!row && !!target && row.source === source && row.target === target && (target.source === source || this.successorLineage.get(source) === target); } catch { return false; }
  }
  async disposeSource(cap: BrowserNativeSourceHandle): Promise<void> { const source = this.sources.get(cap); if (!source) return; source.lost = true; await source.host.dispose(); }
}
