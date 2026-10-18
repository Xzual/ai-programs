import { createHash, randomUUID } from 'node:crypto';
import type { Page, CDPSession } from 'playwright';
import type { EdithToolExecutionContext } from './core';
import { BROWSER_OPERATOR_CONTRACT, BROWSER_FAILURE_CODES, parseBrowserOperatorReceipt, parseBrowserWorkflowRequest,
  type ParsedBrowserWorkflowRequest, type BrowserOperatorReceipt, type BrowserPageObservation, type BrowserFailureCode } from './browserOperatorContract';
import { BrowserSessionStore, type OwnedBrowserSession, type OwnedBrowserLaunchCap, type OwnedEngineInventoryCap, type OwnedEngineTransitionCap } from '../../server/browser/browserSessionStore';
import { BrowserEgressProxy } from '../../server/browser/browserEgressProxy';
import { BrowserNativeLeaseBridge } from '../../server/browser/browserNativeLeaseBridge';
import { BrowserNativeSource, type NativeRetainedSourceHost, type NativeSourceNode, type NativeNavigationWatch, type NativeNavigationFacts, type NativeObservedTransitionHost } from '../../server/browser/browserNativeSource';
import type { NativeSourceCaptureArgs, BrowserNativeSourceHandle } from '../../server/browser/browserNativePrivateContract';
import { onKillSwitchActivated } from './killSwitch';

const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
type Guard = () => void;
export interface BrowserOperatorOptions {
  executablePath?: string;
  fixtureOrigins?: string[]; searchUrl?: (query: string) => string;
  beforeEffect?: (phase: 'located' | 'after_input', page: Page) => Promise<void>;
}
interface Lease { nodeId: number; documentId: string; domDocumentId: string; version: number; semantic: string; rect: number[]; viewport: number[]; }
interface Active { context: EdithToolExecutionContext; guard: Guard; deadline: number; network: boolean; operationId: string; admittedOrigins: Set<string>; }
interface TargetAuthority { sessionId: string; pageId: string; documentId: string; observationId: string; selectorHash: string; lease: Lease; }
interface IssuedSource {
  page: Page; realm: TrustedDomRealm; root: TrustedDomHandle; body: TrustedDomHandle;
  lost: boolean; callbacks: Set<() => void>;
  observer?: Readonly<{ isCurrent: () => boolean; dispose: () => Promise<void> }>;
}
interface IssuedRecord { requestHash: string; contextHash: string; receiptHash: string; targets: TargetAuthority[]; consumed: boolean; source: IssuedSource; }
const canonical = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);

/** Backend-only callbacks execute in a private JS world with pristine DOM prototypes. */
type RemoteDomArgument<T> = T extends TrustedDomHandle ? any : T extends Array<infer U> ? Array<RemoteDomArgument<U>> : T extends object ? { [K in keyof T]: RemoteDomArgument<T[K]> } : T;
class TrustedDomRealm {
  active = true;
  private readonly invalidationSubscribers = new Set<() => void>();
  private readonly group = `edith-dom-${randomUUID()}`;
  constructor(private readonly cdp: CDPSession, private readonly executionContextId: number, private readonly nativeScriptDisabled = false) {}
  async initialize(): Promise<void> {
    await this.evaluate(nativeScriptDisabled => {
      const state = { documentId: crypto.randomUUID(), version: 0, nextNode: 1, nodes: new WeakMap<Node, number>() };
      (globalThis as any).__edithBrowser = state;
      new MutationObserver(() => state.version++).observe(document, { subtree: true, attributes: true, childList: true, characterData: true });
      if (!nativeScriptDisabled) document.addEventListener('submit', event => event.preventDefault(), true);
    }, this.nativeScriptDisabled);
  }
  invalidate(): void {
    this.active = false;
    for (const subscriber of this.invalidationSubscribers) subscriber();
    this.invalidationSubscribers.clear();
    void this.cdp.send('Runtime.releaseObjectGroup', { objectGroup: this.group }).catch(() => {});
  }
  async watchRoots(root: TrustedDomHandle, body: TrustedDomHandle, onLost: () => void): Promise<Readonly<{ isCurrent: () => boolean; dispose: () => Promise<void> }>> {
    if (!this.active || root.realm !== this || body.realm !== this || root.disposed || body.disposed) throw new Error('TARGET_CONTEXT_CHANGED');
    const binding = `edith_source_${randomUUID().replaceAll('-', '')}`, nonce = randomUUID(), cleanupKey = `edith_cleanup_${randomUUID().replaceAll('-', '')}`;
    let lost = false, disposed = false;
    const lose = () => { if (!lost && !disposed) { lost = true; try { onLost(); } catch { /* Observer errors cannot restore source authority. */ } void dispose(); } };
    const bindingCalled = (event: { name: string; executionContextId: number; payload: string }) => { if (event.name === binding && event.executionContextId === this.executionContextId && event.payload === nonce) lose(); };
    const contextDestroyed = (event: { executionContextId: number }) => { if (event.executionContextId === this.executionContextId) lose(); };
    const documentUpdated = () => lose();
    const dispose = async () => {
      if (disposed) return; disposed = true;
      this.invalidationSubscribers.delete(lose);
      this.cdp.off('Runtime.bindingCalled', bindingCalled); this.cdp.off('Runtime.executionContextDestroyed', contextDestroyed);
      this.cdp.off('Runtime.executionContextsCleared', lose); this.cdp.off('DOM.documentUpdated', documentUpdated);
      if (this.active) await this.evaluate(key => { const cleanup = (globalThis as any)[key]; if (typeof cleanup === 'function') cleanup(); delete (globalThis as any)[key]; }, cleanupKey).catch(() => {});
      await this.cdp.send('Runtime.removeBinding', { name: binding }).catch(() => {});
    };
    try {
      // Enable domains before subscribing so initialization is not mistaken for source loss.
      await this.cdp.send('Runtime.enable'); await this.cdp.send('DOM.enable'); await this.cdp.send('DOM.getDocument', { depth: 0 });
      if (!this.active) throw new Error('TARGET_CONTEXT_CHANGED');
      this.invalidationSubscribers.add(lose);
      this.cdp.on('Runtime.bindingCalled', bindingCalled); this.cdp.on('Runtime.executionContextDestroyed', contextDestroyed);
      this.cdp.on('Runtime.executionContextsCleared', lose); this.cdp.on('DOM.documentUpdated', documentUpdated);
      await this.cdp.send('Runtime.addBinding', { name: binding, executionContextId: this.executionContextId });
      await this.onHandle(root, (retainedRoot, args) => {
        const originalBody = args.body;
        const current = () => retainedRoot.isConnected && originalBody.isConnected && document.documentElement === retainedRoot && document.body === originalBody;
        if (!current()) throw new Error('TARGET_CONTEXT_CHANGED');
        let reported = false;
        const observer = new MutationObserver(records => {
          const originalRemoved = records.some(record => Array.from(record.removedNodes).some(node => node === retainedRoot || node === originalBody
            || node.contains(retainedRoot) || node.contains(originalBody)));
          if ((originalRemoved || !current()) && !reported) { reported = true; observer.disconnect(); (globalThis as any)[args.binding](args.nonce); }
        });
        observer.observe(document, { subtree: true, childList: true });
        (globalThis as any)[args.cleanupKey] = () => observer.disconnect();
      }, { body, binding, nonce, cleanupKey });
      const retained = await root.evaluate((retainedRoot, retainedBody) => retainedRoot.isConnected && retainedBody.isConnected
        && document.documentElement === retainedRoot && document.body === retainedBody, body);
      if (!retained || lost || !this.active) throw new Error('TARGET_CONTEXT_CHANGED');
      return Object.freeze({ isCurrent: () => !lost && !disposed && this.active && !root.disposed && !body.disposed, dispose });
    } catch (error) { lose(); await dispose(); throw new Error('TARGET_CONTEXT_CHANGED'); }
  }
  async retainedRootsCurrent(root: TrustedDomHandle, body: TrustedDomHandle): Promise<boolean> {
    if (!this.active || root.realm !== this || body.realm !== this || root.disposed || body.disposed) return false;
    return root.evaluate((retainedRoot, retainedBody) => retainedRoot.isConnected && retainedBody.isConnected
      && retainedRoot === document.documentElement && retainedBody === document.body, body).catch(() => false);
  }
  private async call(callback: Function, argument: unknown, target: TrustedDomHandle | undefined, byValue: boolean): Promise<any> {
    if (!this.active || target?.disposed) throw new Error('TARGET_CONTEXT_CHANGED');
    const handles: TrustedDomHandle[] = [];
    const encode = (value: any): any => {
      if (value instanceof TrustedDomHandle) {
        if (value.realm !== this || value.disposed) throw new Error('TARGET_CONTEXT_CHANGED');
        handles.push(value); return { __edithRemoteObject: handles.length-1 };
      }
      if (Array.isArray(value)) return value.map(encode);
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key,item]) => [key, encode(item)]));
      return value;
    };
    const encoded = encode(argument);
    const invoke = target ? `(${callback.toString()})(this, decode(data))` : `(${callback.toString()})(decode(data))`;
    const functionDeclaration = `function(data,...handles) { const __name = target => target; const decode = value => { if (Array.isArray(value)) return value.map(decode); if (value && typeof value === 'object') { if (Object.keys(value).length === 1 && Object.hasOwn(value,'__edithRemoteObject')) return handles[value.__edithRemoteObject]; return Object.fromEntries(Object.entries(value).map(([key,item]) => [key,decode(item)])); } return value; }; return ${invoke}; }`;
    let result: any;
    try {
      result = await this.cdp.send('Runtime.callFunctionOn', { functionDeclaration,
        ...(target ? { objectId: target.objectId } : { executionContextId: this.executionContextId }),
        arguments: [{ value: encoded ?? null }, ...handles.map(handle => ({ objectId: handle.objectId }))],
        awaitPromise: true, returnByValue: byValue, objectGroup: this.group });
    } catch { this.invalidate(); throw new Error('TARGET_CONTEXT_CHANGED'); }
    if (result.exceptionDetails) {
      const raw = String(result.exceptionDetails.exception?.description ?? '');
      throw new Error(BROWSER_FAILURE_CODES.find(code => raw.includes(code)) ?? 'EFFECT_OUTCOME_UNKNOWN');
    }
    return result.result;
  }
  async evaluate<A = unknown, T = unknown>(callback: (argument: A) => T, argument?: A): Promise<Awaited<T>> {
    return (await this.call(callback, argument, undefined, true)).value;
  }
  async evaluateHandle<A = unknown>(callback: (argument: A) => unknown, argument?: A): Promise<TrustedDomHandle> {
    const object = await this.call(callback, argument, undefined, false);
    if (!object.objectId || object.subtype !== 'node') { if (object.objectId) await this.release(object.objectId); throw new Error('TARGET_NOT_FOUND'); }
    return new TrustedDomHandle(this, object.objectId);
  }
  async onHandle<A, T>(handle: TrustedDomHandle, callback: (node: any, argument: RemoteDomArgument<A>) => T, argument?: A): Promise<Awaited<T>> {
    if (handle.realm !== this) throw new Error('TARGET_CONTEXT_CHANGED');
    return (await this.call(callback, argument, handle, true)).value;
  }
  async release(objectId: string): Promise<void> { await this.cdp.send('Runtime.releaseObject', { objectId }).catch(() => {}); }
}
class TrustedDomHandle {
  disposed = false;
  constructor(readonly realm: TrustedDomRealm, readonly objectId: string) {}
  asElement(): TrustedDomHandle { return this; }
  evaluate<A = unknown, T = unknown>(callback: (node: any, argument: RemoteDomArgument<A>) => T, argument?: A): Promise<Awaited<T>> { return this.realm.onHandle(this, callback, argument); }
  async dispose(): Promise<void> { if (!this.disposed) { this.disposed = true; await this.realm.release(this.objectId); } }
}

/** Owned DOM operations only. No HWND/native input or caller-issued coordinate authority. */
export class BrowserOperatorAdapter {
  readonly sessions: BrowserSessionStore;
  readonly nativeMetadata: BrowserNativeLeaseBridge;
  readonly nativeSources = new BrowserNativeSource((args, onLost) => this.captureNativeSourceHost(args, onLost));
  private readonly proxy: BrowserEgressProxy;
  private readonly proxyCredentials = Object.freeze({ username: randomUUID(), password: randomUUID() });
  private proxyOrigin?: string;
  private readonly active = new Map<string, Active>();
  private readonly artifactOwners = new Map<string, { sessionId: string; owner: string; mime: string }>();
  private readonly unsubscribe: () => void;
  private readonly monitor: NodeJS.Timeout;
  private readonly sessionGuards = new Map<string, Guard>();
  private readonly targetAuthority = new Map<string, TargetAuthority>();
  private readonly issued = new WeakMap<BrowserOperatorReceipt, IssuedRecord>();
  private readonly currentIssuedSources = new Map<Page, IssuedSource>();
  private readonly responseGuarded = new WeakSet<Page>();
  private readonly documents = new WeakMap<Page, string>();
  private readonly documentRoots = new WeakMap<Page, { root: TrustedDomHandle; body: TrustedDomHandle }>();
  private readonly pageCdps = new WeakMap<Page, { cdp: CDPSession; frameId: string }>();
  private readonly realms = new WeakMap<Page, TrustedDomRealm>();
  private proxyClosing?: Promise<void>;
  private creatingSessions = 0;
  private lifecycleFailures = 0;
  private readonly closureFacts = new Map<string, { pid: number; processExited: boolean }>();
  private readonly nativeOriginalSessions = new Set<string>();
  private readonly nativePages = new WeakSet<Page>();
  private readonly nativeRetainedGuards = new WeakMap<Page, Guard>();
  private readonly nativeNetworkFences = new WeakMap<Page, { guard: Guard; allowedUrl: () => string | undefined; reserve: () => void }>();
  constructor(private readonly options: BrowserOperatorOptions = {}) {
    if ((options.fixtureOrigins?.length || options.searchUrl || options.beforeEffect) && process.env.EDITH_TEST_MODE !== 'true') throw new Error('CONFIGURATION_REQUIRED');
    this.sessions = new BrowserSessionStore({ fixtureOrigins: options.fixtureOrigins, executablePath: options.executablePath });
    this.proxy = new BrowserEgressProxy({ fixtureOrigins: options.fixtureOrigins, credentials: this.proxyCredentials,
      beforeConnect: url => {
        const origin = new URL(url).origin;
        for (const active of this.active.values()) {
          if (!active.network || Date.now() >= active.deadline || !active.admittedOrigins.has(origin)) continue;
          try { active.guard(); return; } catch { /* A different live owned operation may admit this origin. */ }
        }
        throw new Error('NETWORK_TARGET_UNSAFE');
      } });
    this.nativeMetadata = new BrowserNativeLeaseBridge(this.sessions);
    this.unsubscribe = onKillSwitchActivated(() => { void this.closeAll().catch(() => {}); });
    this.monitor = setInterval(() => {
      for (const [sessionId, guard] of this.sessionGuards) try { guard(); } catch {
        const current = this.active.get(sessionId);
        if (current) current.deadline = 0;
        void this.closeSession(sessionId, current?.context.actor ?? this.owners.get(sessionId) ?? '').catch(() => {});
      }
      for (const [sessionId, owner] of this.owners) try { this.sessions.get(sessionId, owner); } catch { void this.closeSession(sessionId, owner).catch(() => {}); }
    }, 100);
    this.monitor.unref();
  }
  private readonly owners = new Map<string, string>();
  availability() { return this.sessions.availability(); }
  verifyIssued(receipt: BrowserOperatorReceipt, request: ParsedBrowserWorkflowRequest, context: Pick<EdithToolExecutionContext, 'actor' | 'taskId'>, consume = false): boolean {
    const issued = this.issued.get(receipt);
    if (!issued || issued.consumed || receipt.status !== 'verified') return false;
    let session: OwnedBrowserSession;
    try { session = this.sessions.get(receipt.sessionId!, context.actor); } catch { return false; }
    const valid = Boolean(this.sourceCurrent(receipt, issued) && parseBrowserOperatorReceipt(receipt).success && issued.requestHash === sha(canonical(request))
      && issued.contextHash === sha(canonical({ actor: context.actor, taskId: context.taskId })) && issued.receiptHash === sha(canonical(receipt))
      && session.generation === receipt.after?.generation && session.activeDocumentIds.get(receipt.pageId!) === receipt.after.documentId
      && session.pages.get(receipt.pageId!)?.url() === receipt.after.url && !session.pages.get(receipt.pageId!)?.isClosed()
      && issued.targets.length === receipt.targetIds.length && issued.targets.every(target => target.sessionId === receipt.sessionId
        && target.pageId === receipt.pageId && target.documentId === receipt.after?.documentId && target.observationId === receipt.after.id));
    if (valid && consume) issued.consumed = true;
    return valid;
  }
  private loseSource(source: IssuedSource): void {
    if (source.lost) return; source.lost = true;
    for (const callback of source.callbacks) try { callback(); } catch { /* Lost authority is irreversible even if the consumer throws. */ }
    source.callbacks.clear();
    if (this.currentIssuedSources.get(source.page) === source) this.currentIssuedSources.delete(source.page);
    void source.observer?.dispose();
  }
  private sourceCurrent(receipt: BrowserOperatorReceipt, issued: IssuedRecord): boolean {
    const source = issued.source;
    if (source.lost || !source.realm.active || source.root.disposed || source.body.disposed || !source.observer?.isCurrent()
      || source.page.isClosed() || this.documents.get(source.page) !== receipt.after?.documentId) return false;
    try {
      const session = this.sessions.get(receipt.sessionId!, this.owners.get(receipt.sessionId!) ?? '');
      return session.pages.get(receipt.pageId!) === source.page && session.activeDocumentIds.get(receipt.pageId!) === receipt.after?.documentId
        && session.generation === receipt.after?.generation && source.page.url() === receipt.after?.url;
    } catch { return false; }
  }
  async watchIssuedSource(receipt: BrowserOperatorReceipt, request: ParsedBrowserWorkflowRequest, context: Pick<EdithToolExecutionContext, 'actor' | 'taskId'>,
    onInvalidated: () => void): Promise<Readonly<{ isCurrent: () => boolean; dispose: () => Promise<void> }>> {
    const issued = this.issued.get(receipt);
    if (!issued || receipt.status !== 'verified' || !parseBrowserOperatorReceipt(receipt).success || typeof onInvalidated !== 'function'
      || issued.requestHash !== sha(canonical(request)) || issued.contextHash !== sha(canonical({ actor: context.actor, taskId: context.taskId }))
      || issued.receiptHash !== sha(canonical(receipt)) || !this.sourceCurrent(receipt, issued)) throw new Error('TARGET_CONTEXT_CHANGED');
    const source = issued.source;
    // Retain exactly the roots at issuance: never reacquire/re-resolve a later document here.
    const retained = await source.realm.retainedRootsCurrent(source.root, source.body);
    if (!retained || !this.sourceCurrent(receipt, issued)) { this.loseSource(source); throw new Error('TARGET_CONTEXT_CHANGED'); }
    if (source.callbacks.size >= 8) throw new Error('CONFIGURATION_REQUIRED');
    let disposed = false;
    source.callbacks.add(onInvalidated);
    return Object.freeze({ isCurrent: () => !disposed && issued.receiptHash === sha(canonical(receipt)) && issued.requestHash === sha(canonical(request))
      && issued.contextHash === sha(canonical({ actor: context.actor, taskId: context.taskId })) && this.sourceCurrent(receipt, issued),
      dispose: async () => { if (!disposed) { disposed = true; source.callbacks.delete(onInvalidated); } } });
  }
  private async issue(receipt: BrowserOperatorReceipt, request: ParsedBrowserWorkflowRequest, context: EdithToolExecutionContext): Promise<BrowserOperatorReceipt> {
    if (receipt.status === 'verified' && parseBrowserOperatorReceipt(receipt).success) {
      const session = this.sessions.get(receipt.sessionId!, context.actor), page = session.pages.get(receipt.pageId!);
      if (!page) throw new Error('TARGET_CONTEXT_CHANGED');
      const roots = this.documentRoots.get(page), realm = this.realms.get(page);
      if (!roots || !realm?.active || roots.root.realm !== realm || roots.body.realm !== realm) throw new Error('TARGET_CONTEXT_CHANGED');
      const old = this.currentIssuedSources.get(page); if (old) this.loseSource(old);
      const source: IssuedSource = { page, realm, root: roots.root, body: roots.body, lost: false, callbacks: new Set() };
      this.currentIssuedSources.set(page, source);
      try {
        source.observer = await realm.watchRoots(source.root, source.body, () => this.loseSource(source));
        const record: IssuedRecord = { requestHash: sha(canonical(request)), contextHash: sha(canonical({ actor: context.actor, taskId: context.taskId })), consumed: false, source,
          receiptHash: sha(canonical(receipt)), targets: receipt.targetIds.map(id => this.targetAuthority.get(id)!).filter(Boolean).map(value => structuredClone(value)) };
        if (!this.sourceCurrent(receipt, record)) throw new Error('TARGET_CONTEXT_CHANGED');
        this.issued.set(receipt, record);
      } catch { this.loseSource(source); throw new Error('TARGET_CONTEXT_CHANGED'); }
    }
    return receipt;
  }
  async closeSession(id: string, owner: string) {
    if (this.owners.has(id) && this.owners.get(id) !== owner) throw new Error('OWNER_SESSION_REQUIRED');
    try { await this.sessions.close(id, owner); } catch (error) { this.lifecycleFailures++; throw error; } finally {
    const closure = this.sessions.closureEvidence(id, owner);
    if (closure) { this.closureFacts.set(id, { pid: closure.pid, processExited: closure.processExited }); while (this.closureFacts.size > 32) this.closureFacts.delete(this.closureFacts.keys().next().value!); }
    this.active.delete(id); this.sessionGuards.delete(id); this.owners.delete(id);
    for (const [artifactId, facts] of this.artifactOwners) if (facts.sessionId === id) this.artifactOwners.delete(artifactId);
    for (const [targetId, facts] of this.targetAuthority) if (facts.sessionId === id) this.targetAuthority.delete(targetId);
    if (!this.owners.size && !this.creatingSessions && !this.proxyClosing) {
      this.proxyClosing = this.proxy.close().finally(() => { this.proxyClosing = undefined; });
      await this.proxyClosing;
    }
    }
  }
  async closeAll() {
    clearInterval(this.monitor); this.unsubscribe();
    try { await this.sessions.closeAll(); } catch (error) { this.lifecycleFailures++; throw error; } finally {
    await this.proxy.close();
    this.active.clear(); this.sessionGuards.clear(); this.owners.clear(); this.artifactOwners.clear();
    this.targetAuthority.clear();
    }
  }
  readArtifact(id: string, owner: string): { bytes: Buffer; mime: string } {
    const facts = this.artifactOwners.get(id);
    if (!facts || facts.owner !== owner) throw new Error('OWNER_SESSION_REQUIRED');
    const bytes = this.sessions.get(facts.sessionId, owner).artifacts.get(id);
    if (!bytes) throw new Error('PAGE_NOT_FOUND');
    return { bytes: Buffer.from(bytes), mime: facts.mime };
  }
  diagnostics() { return { ...this.proxy.diagnostics, lifecycleFailures: this.lifecycleFailures, closedProcesses: [...this.closureFacts].map(([sessionId, facts]) => ({ sessionId, ...facts })) }; }
  async captureNativeRetainedSource(args: NativeSourceCaptureArgs): Promise<BrowserNativeSourceHandle> {
    return this.nativeSources.captureNativeRetainedSource(args);
  }
  supportsNativeObservedStrategy(action: ParsedBrowserWorkflowRequest['action']): boolean {
    return process.env.EDITH_TEST_MODE === 'true' && !!this.options.searchUrl && !!this.options.fixtureOrigins?.length && ['search', 'navigate', 'scroll'].includes(action);
  }
  /** Read-only request selection; native boot presence cannot upgrade an ordinary context. */
  canSelectNativeRequest(request: ParsedBrowserWorkflowRequest, owner: string): boolean {
    const parsed = parseBrowserWorkflowRequest(request); if (!parsed.success || parsed.value.dryRun || !owner) return false;
    const original = parsed.value;
    if (original.sessionId && original.pageId) {
      let session: OwnedBrowserSession;
      try { session = this.sessions.get(original.sessionId, owner); } catch { return false; }
      if (this.nativeOriginalSessions.has(session.id) && this.active.has(session.id)) throw new Error('TARGET_CONTEXT_CHANGED');
      const page = session.pages.get(original.pageId);
      if (!page || page.isClosed() || page.context() !== session.context || !this.nativePages.has(page)) return false;
      if (this.active.has(session.id)) throw new Error('TARGET_CONTEXT_CHANGED');
      try {
        const native = this.sessions.inspectNativeContext(session), contexts = session.browser.contexts(), pages = session.context.pages(), frames = page.frames();
        if (native.context !== session.context || native.browser !== session.browser || native.process !== session.browserServer.process()
          || native.process.exitCode !== null || native.process.signalCode !== null || native.process.killed || !session.browser.isConnected()
          || contexts.length !== 1 || contexts[0] !== session.context || pages.length !== 1 || pages[0] !== page || session.pages.size !== 1
          || frames.length !== 1 || frames[0] !== page.mainFrame()) return false;
      } catch { return false; }
      if (['search', 'navigate'].includes(original.action) && !this.supportsNativeObservedStrategy(original.action)) return false;
      if (original.action === 'scroll') {
        if (!this.nativeOriginalSessions.has(session.id) || !this.supportsNativeObservedStrategy('scroll')) return false;
        try {
          const url = new URL(page.url()), retainedGuard = this.nativeRetainedGuards.get(page);
          if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname) || url.port === '5186'
            || !(this.options.fixtureOrigins ?? []).includes(url.origin) || url.username || url.password || url.hash || !retainedGuard) return false;
          // Selection reuses the current retained scope; it cannot renew or rebaseline a lost source.
          retainedGuard();
        } catch { return false; }
      }
      return ['fill_form', 'search', 'navigate', 'scroll'].includes(original.action);
    }
    if (original.sessionId || original.pageId || original.action !== 'search' || !this.supportsNativeObservedStrategy('search') || !this.options.searchUrl) return false;
    try {
      const destination = this.options.searchUrl(original.query!), url = new URL(destination);
      return url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname) && url.port !== '5186'
        && (this.options.fixtureOrigins ?? []).includes(url.origin) && !url.username && !url.password && !url.hash
        && parseBrowserWorkflowRequest({ action: 'navigate', url: destination, verificationGoal: 'Inspect native acquisition eligibility.' }).success;
    } catch { return false; }
  }
  /** Private original-parent bootstrap. The retained request is never rewritten into a leaf request. */
  async captureNativeOriginalSource(args: Omit<NativeSourceCaptureArgs, 'sessionId' | 'pageId'>): Promise<BrowserNativeSourceHandle> {
    args.guard();
    const parsed = parseBrowserWorkflowRequest(args.request);
    if (!parsed.success || parsed.value.action !== 'search' || parsed.value.sessionId || parsed.value.pageId
      || parsed.value.dryRun || process.env.EDITH_TEST_MODE !== 'true' || !this.options.searchUrl || !args.owner || !args.nativeBootRef || !args.attemptRef
      || !Number.isFinite(args.deadline) || args.deadline <= Date.now() || args.deadline > Date.now() + 30000) throw new Error('UNSUPPORTED_ACTION');
    const destination = this.options.searchUrl(parsed.value.query!);
    let url: URL;
    try { url = new URL(destination); } catch { throw new Error('UNSUPPORTED_ACTION'); }
    if (!['127.0.0.1', '[::1]'].includes(url.hostname) || url.protocol !== 'http:' || url.port === '5186'
      || !(this.options.fixtureOrigins ?? []).includes(url.origin) || url.username || url.password || url.hash
      || !parseBrowserWorkflowRequest({ action: 'navigate', url: destination, verificationGoal: 'Validate private owned source bootstrap.' }).success) throw new Error('UNSUPPORTED_ACTION');
    const request = structuredClone(args.request), context = { ...args.context, authorizedPermissions: [] };
    let session: OwnedBrowserSession | undefined, expired = false, retained = false;
    const operationId = randomUUID();
    const guard = () => { args.guard(); if (expired || Date.now() >= args.deadline) throw new Error('DEADLINE_EXCEEDED'); };
    let timer: NodeJS.Timeout | undefined;
    const deadlineSignal = new Promise<never>((_, reject) => { timer = setTimeout(() => {
      expired = true;
      if (session) void this.closeSession(session.id, session.owner).catch(() => {});
      reject(new Error('DEADLINE_EXCEEDED'));
    }, Math.max(1, args.deadline - Date.now())); });
    const within = <T>(operation: Promise<T>) => Promise.race([operation, deadlineSignal]);
    this.creatingSessions++;
    try {
      if (this.proxyClosing) { await within(this.proxyClosing); guard(); }
      const proxyUrl = await within(this.proxy.start()); guard(); this.proxyOrigin = new URL(proxyUrl).origin;
      const creating = this.sessions.createNative(args.context.actor, proxyUrl, this.proxyCredentials).then(created => {
        try { guard(); return created; } catch (error) { void this.sessions.close(created.id, created.owner).catch(() => {}); throw error; }
      });
      session = await within(creating); guard(); this.sessions.inspectNativeContext(session);
      const owned = session; this.owners.set(owned.id, owned.owner); this.nativeOriginalSessions.add(owned.id);
      this.sessionGuards.set(owned.id, guard);
      this.active.set(owned.id, { context, guard, deadline: args.deadline, network: true, operationId, admittedOrigins: new Set() });
      await within(this.configure(owned)); guard();
      const result = await within(this.sessions.runExclusive(owned, async () => {
        guard(); const created = await this.sessions.newPage(owned); guard(); const page = created.page; this.nativePages.add(page);
        let initialRequestUsed = false;
        this.nativeNetworkFences.set(page, { guard, allowedUrl: () => this.active.get(owned.id)?.network ? url.href : undefined,
          reserve: () => { if (initialRequestUsed) throw new Error('NAVIGATION_BLOCKED'); initialRequestUsed = true; } });
        await owned.context.route('**/*', async route => {
          try {
            const fence = this.nativeNetworkFences.get(page); if (!fence) throw new Error('NETWORK_TARGET_UNSAFE'); fence.guard(); const outgoing = route.request();
            const approved = fence.allowedUrl();
            if (!approved || outgoing.method() !== 'GET' || outgoing.frame() !== page.mainFrame() || outgoing.url() !== approved || outgoing.redirectedFrom()
              || Object.keys(outgoing.headers()).some(name => /^(authorization|cookie|proxy-authorization)$/i.test(name))) throw new Error('NETWORK_TARGET_UNSAFE');
            fence.reserve(); await this.proxy.assertAllowedUrl(outgoing.url()); fence.guard();
            const active = this.active.get(owned.id); if (!active || !active.network || fence.allowedUrl() !== approved) throw new Error('NETWORK_TARGET_UNSAFE');
            active.admittedOrigins.add(new URL(approved).origin); await route.continue();
          } catch { await route.abort('blockedbyclient').catch(() => {}); }
        }); guard();
        await this.guardResponses(owned, page); guard();
        await this.proxy.assertAllowedUrl(url.href); guard();
        const response = await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: Math.max(1, args.deadline - Date.now()) }); guard();
        if (!response || response.status() < 200 || response.status() >= 300 || response.headers()['refresh'] || response.url() !== url.href || page.url() !== url.href
          || response.request().redirectedFrom() || response.request().frame() !== page.mainFrame()) throw new Error('NAVIGATION_BLOCKED');
        await this.ensureDocumentIdentity(page); guard();
        const cap = await this.captureNativeRetainedSource({ ...args, request, guard, sessionId: owned.id, pageId: created.id }); guard();
        try {
          await this.nativeSources.validateNativeSearchProfile(cap); guard();
          this.nativeSources.guardSource(cap); return cap;
        } catch (error) { await this.nativeSources.disposeSource(cap); throw error; }
      })); guard(); retained = true; return result;
    } finally {
      if (timer) clearTimeout(timer);
      if (session) {
        const active = this.active.get(session.id); if (active?.operationId === operationId) { active.network = false; active.admittedOrigins.clear(); this.active.delete(session.id); }
        if (!retained) { this.nativeOriginalSessions.delete(session.id); await this.closeSession(session.id, session.owner).catch(() => {}); }
      }
      this.creatingSessions--;
      if (!this.owners.size && !this.creatingSessions && !this.proxyClosing) {
        this.proxyClosing = this.proxy.close().finally(() => { this.proxyClosing = undefined; }); void this.proxyClosing.catch(() => { this.lifecycleFailures++; });
      }
    }
  }
  /** Retains actual adapter objects; it never dispatches input or manufactures native proof. */
  private async captureNativeSourceHost(args: NativeSourceCaptureArgs, onLost: () => void,
    successor?: { launch: OwnedBrowserLaunchCap; inventory: OwnedEngineInventoryCap; viewport: { width: number; height: number } | null }): Promise<NativeRetainedSourceHost> {
    args.guard();
    const session = this.sessions.get(args.sessionId, args.context.actor), page = session.pages.get(args.pageId);
    if (!page || page.isClosed() || page.context() !== session.context) throw new Error('PAGE_NOT_FOUND');
    const measuredViewport = successor ? successor.viewport : page.viewportSize();
    const retainedViewport = measuredViewport ? Object.freeze({ width: measuredViewport.width, height: measuredViewport.height }) : null;
    const launch = successor?.launch ?? this.sessions.retainOwnedLaunch(session, args.pageId, page);
    let lost = false, disposed = false, retired = false, documentDisposed = false, anchorTransferred = false, viewportLost = false;
    const assertViewport = () => {
      const actual = page.viewportSize();
      if (viewportLost || (actual === null) !== (retainedViewport === null) || actual && retainedViewport
        && (actual.width !== retainedViewport.width || actual.height !== retainedViewport.height)) {
        viewportLost = true; throw new Error('VIEWPORT_BINDING_INVALID');
      }
    };
    let transition: OwnedEngineTransitionCap | undefined;
    let watch: Awaited<ReturnType<TrustedDomRealm['watchRoots']>> | undefined;
    let inventory: Awaited<ReturnType<BrowserSessionStore['captureExclusiveEngineInventory']>> | undefined;
    const nodes = new Set<TrustedDomHandle>();
    const navigationWatches = new Set<NativeNavigationWatch>();
    const retireDocument = async () => {
      if (documentDisposed) return; documentDisposed = true;
      await Promise.allSettled([watch?.dispose(), ...[...nodes].map(node => node.dispose())]); nodes.clear();
    };
    const lose = () => {
      if (!lost) { lost = true; onLost(); }
      if (anchorTransferred) { void retireDocument(); return; }
      if (retired && transition && !viewportLost) { try { this.sessions.assertOwnedEngineTransition(transition); void retireDocument(); return; } catch { /* Unknown inventory loss is terminal. */ } }
      void dispose(true);
    };
    const timer = setTimeout(lose, Math.max(1, args.deadline - Date.now())); timer.unref();
    const dispose = async (terminal = false) => {
      if (anchorTransferred) { await retireDocument(); return; }
      if (retired && !terminal) { await retireDocument(); return; }
      if (disposed) return; disposed = true; lost = true; clearTimeout(timer);
      if (this.nativeRetainedGuards.get(page) === guard) this.nativeRetainedGuards.delete(page);
      await Promise.allSettled([watch?.dispose(), ...[...nodes].map(node => node.dispose()), ...[...navigationWatches].map(item => item.dispose()), inventory ? this.sessions.disposeExclusiveEngineInventory(inventory) : Promise.resolve(), transition ? this.sessions.disposeOwnedEngineTransition(transition) : Promise.resolve()]);
      nodes.clear(); navigationWatches.clear();
      if (this.nativeOriginalSessions.delete(session.id)) await this.closeSession(session.id, session.owner).catch(() => {});
    };
    const guard = () => {
      try { args.guard(); if (lost || disposed || Date.now() >= args.deadline) throw new Error('TARGET_CONTEXT_CHANGED');
        assertViewport();
        this.sessions.assertOwnedLaunch(launch); if (inventory) this.sessions.assertExclusiveEngineInventory(inventory);
        if (page.isClosed() || session.pages.get(args.pageId) !== page || !this.realms.get(page)?.active || watch && !watch.isCurrent()) throw new Error('TARGET_CONTEXT_CHANGED');
      } catch (error) { lose(); throw error; }
    };
    try {
      const roots = await this.ensureDocumentIdentity(page); args.guard(); this.sessions.assertOwnedLaunch(launch);
      const realm = await this.dom(page); args.guard(); this.sessions.assertOwnedLaunch(launch);
      watch = await realm.watchRoots(roots.root, roots.body, lose); guard();
      inventory = successor?.inventory ?? await this.sessions.captureExclusiveEngineInventory(launch, lose); guard();
      const inventoryView = this.sessions.inspectExclusiveEngineInventory(inventory);
      const sourceEpochDigest = sha(canonical({ launch: inventoryView.launchEpoch, inventory: inventoryView.inventoryEpoch,
        target: inventoryView.targetId, frame: inventoryView.frameId, loader: inventoryView.loaderId, document: this.documents.get(page), nonce: randomUUID() }));
      const current = async () => { guard(); const retained = await realm.retainedRootsCurrent(roots.root, roots.body); guard(); if (!retained) { lose(); return false; } return true; };
      const observe = async (): Promise<BrowserPageObservation> => {
        if (!await current()) throw new Error('TARGET_CONTEXT_CHANGED');
        const data = await realm.evaluate(() => { const vv = visualViewport; return { url: location.href, title: document.title.slice(0, 2000),
          viewport: { width: innerWidth, height: innerHeight, scrollX, scrollY, deviceScaleFactor: devicePixelRatio,
            visualOffsetX: vv?.offsetLeft ?? 0, visualOffsetY: vv?.offsetTop ?? 0, visualScale: vv?.scale ?? 1 } }; });
        guard(); if (!await current()) throw new Error('TARGET_CONTEXT_CHANGED');
        const documentId = this.documents.get(page); if (!documentId) throw new Error('TARGET_CONTEXT_CHANGED');
        return { id: randomUUID(), sessionId: session.id, pageId: args.pageId, documentId, generation: ++session.generation, observedAt: new Date().toISOString(), ...data };
      };
      const locate = async (selector: string, approvedHref?: string): Promise<NativeSourceNode> => {
        guard();
        const count = await realm.evaluate(({ selector, approvedHref }) => [...document.querySelectorAll(selector)].filter(node => approvedHref === undefined || node instanceof HTMLAnchorElement && node.href === approvedHref).length, { selector, approvedHref });
        guard(); if (count !== 1) throw new Error(count ? 'TARGET_AMBIGUOUS' : 'TARGET_NOT_FOUND');
        const handle = (await realm.evaluateHandle(({ selector, approvedHref }) => [...document.querySelectorAll(selector)].find(node => approvedHref === undefined || node instanceof HTMLAnchorElement && node.href === approvedHref), { selector, approvedHref })).asElement();
        guard(); if (!handle) throw new Error('TARGET_NOT_FOUND'); nodes.add(handle);
        const targetId = randomUUID();
        return { dispose: async () => { nodes.delete(handle); await handle.dispose(); }, inspect: async () => {
          if (!await current()) throw new Error('TARGET_CONTEXT_CHANGED');
          const facts = await handle.evaluate((node, scope) => {
            const approvedHref = scope.approvedHref;
            if (!node.isConnected || node.ownerDocument !== document) throw new Error('TARGET_CONTEXT_CHANGED');
            const input = node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement;
            const type = node instanceof HTMLInputElement ? node.type : node.tagName.toLowerCase();
            if (scope.searchTarget) {
              const all = [...document.querySelectorAll('*')], form = node instanceof HTMLInputElement ? node.form : null;
              if (!(node instanceof HTMLInputElement) || node.type !== 'search' || node.name !== 'q' || !form || document.forms.length !== 1
                || form.method.toLowerCase() !== 'get' || form.elements.length !== 1 || form.elements[0] !== node || document.querySelectorAll('input,button,select,textarea').length !== 1
                || form.target && form.target !== '_self' || form.enctype !== 'application/x-www-form-urlencoded' || node.disabled || node.readOnly
                || [...node.attributes].some(attr => /^(dirname|minlength|maxlength|pattern|multiple|disabled|readonly|required|list|autofocus|form.*)$/i.test(attr.name))
                || form.hasAttribute('accept-charset') || form.hasAttribute('novalidate') || document.scripts.length || all.length > 4096
                || document.querySelector('base,iframe,frame,object,embed,portal,meta[http-equiv],link[rel="prefetch"],link[rel="prerender"]')
                || all.some(element => element.attributes.length > 64 || [...element.attributes].some(attr => /^on/i.test(attr.name) || /^(ping|download|formaction|formmethod|formtarget|formenctype|formnovalidate)$/i.test(attr.name)))) throw new Error('UNSUPPORTED_ACTION');
            }
            if (approvedHref !== undefined) {
              const all = [...document.querySelectorAll('*')];
              if (!(node instanceof HTMLAnchorElement) || node.href !== approvedHref || node.hasAttribute('ping') || node.hasAttribute('download')
                || node.target && node.target !== '_self' || document.querySelector('base,iframe,frame,object,embed,portal,meta[http-equiv]') || document.scripts.length || all.length > 4096
                || all.some(element => [...element.attributes].some(attr => /^on/i.test(attr.name)))) throw new Error('UNSUPPORTED_ACTION');
            }
            const name = node.getAttribute('name') ?? '', semantic = JSON.stringify({ tag: node.tagName, type, name, role: node.getAttribute('role'), aria: node.getAttribute('aria-label'), form: input ? node.form?.id ?? '' : '', action: input ? node.form?.action ?? '' : '', method: input ? node.form?.method ?? '' : '',
              href: node instanceof HTMLAnchorElement ? node.href : '', target: node.getAttribute('target') ?? '', ping: node.getAttribute('ping') ?? '', download: node.getAttribute('download'), base: document.baseURI,
              attributes: [...node.attributes].map(attr => [attr.name, attr.value]).sort((a, b) => a[0].localeCompare(b[0])),
              formAttributes: input && node.form ? [...node.form.attributes].map(attr => [attr.name, attr.value]).sort((a, b) => a[0].localeCompare(b[0])) : [] });
            const writable = input && !node.disabled && !node.readOnly && (node instanceof HTMLTextAreaElement || ['text', 'search', 'email', 'tel', 'url'].includes(type)) && !/(password|secret|token|credential|authorization|cookie|api.?key)/i.test(semantic);
            const rect = node.getBoundingClientRect(), x = rect.x + rect.width / 2, y = rect.y + rect.height / 2, hit = document.elementFromPoint(x, y), style = getComputedStyle(node);
            if (style.animationName !== 'none' || style.transitionDuration.split(',').some(value => parseFloat(value) !== 0)) throw new Error('UNSUPPORTED_ACTION');
            if (rect.width <= 0 || rect.height <= 0 || x < 0 || y < 0 || x >= innerWidth || y >= innerHeight || style.visibility !== 'visible' || style.display === 'none' || hit !== node) throw new Error('TARGET_OCCLUDED');
            const ancestry: string[] = []; let ancestor: Element | null = node;
            while (ancestor) { if (ancestry.length >= 128 || !ancestor.isConnected) throw new Error('TARGET_CONTEXT_CHANGED');
              const parent: Element | null = ancestor.parentElement;
              ancestry.push(`${ancestor.tagName}:${parent ? [...parent.children].indexOf(ancestor) : 0}`); ancestor = parent; }
            if (!node.getRootNode || node.getRootNode() !== document || !document.documentElement.contains(node)) throw new Error('TARGET_CONTEXT_CHANGED');
            return { tag: node.tagName, type, semantic, rect: [rect.x, rect.y, rect.width, rect.height],
              viewport: [innerWidth, innerHeight, devicePixelRatio, visualViewport?.scale ?? 1, visualViewport?.offsetLeft ?? 0, visualViewport?.offsetTop ?? 0, scrollX, scrollY],
              intendedPoint: [x, y], exactIsolatedHit: true as const, ancestry,
              value: input ? node.value : '', writable, ...(node instanceof HTMLAnchorElement ? { href: node.href } : {}) };
          }, { approvedHref, searchTarget: args.request.action === 'search' });
          guard(); if (!await current()) throw new Error('TARGET_CONTEXT_CHANGED'); return { targetId, ...facts };
        } };
      };
      const retainScrollSurface = async (): Promise<NativeSourceNode> => {
        if (!await current()) throw new Error('TARGET_CONTEXT_CHANGED');
        const handle = (await realm.evaluateHandle(() => document.elementFromPoint(innerWidth / 2, innerHeight / 2))).asElement();
        guard(); if (!handle) throw new Error('TARGET_NOT_FOUND'); nodes.add(handle);
        const targetId = randomUUID();
        return { dispose: async () => { nodes.delete(handle); await handle.dispose(); }, inspect: async () => {
          if (!await current()) throw new Error('TARGET_CONTEXT_CHANGED');
          const facts = await handle.evaluate(node => {
            const scrolling = document.scrollingElement;
            if (!(node instanceof Element) || !scrolling || !scrolling.isConnected || !node.isConnected || node.ownerDocument !== document
              || node.getRootNode() !== document || !document.documentElement.contains(node)) throw new Error('TARGET_CONTEXT_CHANGED');
            const x = innerWidth / 2, y = innerHeight / 2, rect = node.getBoundingClientRect(), style = getComputedStyle(node);
            if (innerWidth <= 0 || innerHeight <= 0 || rect.width <= 0 || rect.height <= 0 || x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom
              || style.visibility !== 'visible' || style.display === 'none' || document.elementFromPoint(x, y) !== node) throw new Error('TARGET_OCCLUDED');
            const ancestry: string[] = []; let ancestor: Element | null = node, reachesScrolling = false;
            while (ancestor) {
              if (ancestry.length >= 128 || !ancestor.isConnected || ancestor.ownerDocument !== document) throw new Error('TARGET_CONTEXT_CHANGED');
              const parent: Element | null = ancestor.parentElement, css = getComputedStyle(ancestor);
              if (ancestor === scrolling) reachesScrolling = true;
              else if ((ancestor.scrollHeight > ancestor.clientHeight && /^(auto|scroll|overlay)$/.test(css.overflowY))
                || (ancestor.scrollWidth > ancestor.clientWidth && /^(auto|scroll|overlay)$/.test(css.overflowX))) throw new Error('UNSUPPORTED_ACTION');
              ancestry.push(`${ancestor.tagName}:${parent ? [...parent.children].indexOf(ancestor) : 0}`); ancestor = parent;
            }
            if (!reachesScrolling || scrolling !== document.documentElement && scrolling !== document.body) throw new Error('UNSUPPORTED_ACTION');
            const semantic = JSON.stringify({ tag: node.tagName, role: node.getAttribute('role'), id: node.id,
              scrollRoot: scrolling.tagName, scrollRootId: scrolling.id, ancestry, documentScroll: true });
            return { tag: node.tagName, type: 'scroll-surface', semantic, rect: [rect.x, rect.y, rect.width, rect.height],
              viewport: [innerWidth, innerHeight, devicePixelRatio, visualViewport?.scale ?? 1, visualViewport?.offsetLeft ?? 0, visualViewport?.offsetTop ?? 0, scrollX, scrollY],
              intendedPoint: [x, y], exactIsolatedHit: true as const, ancestry, value: '', writable: false };
          });
          guard(); if (!await current()) throw new Error('TARGET_CONTEXT_CHANGED'); return { targetId, ...facts };
        } };
      };
      const searchProfile = async () => {
        guard();
        this.sessions.inspectNativeContext(session);
        if (!this.nativePages.has(page) || process.env.EDITH_TEST_MODE !== 'true' || !args.request.query || !(this.options.fixtureOrigins ?? []).includes(new URL(page.url()).origin)) throw new Error('UNSUPPORTED_ACTION');
        const data = await realm.evaluate(() => {
          const nodes = [...document.querySelectorAll('*')];
          if (nodes.length > 4096 || document.scripts.length || document.querySelector('base,iframe,frame,object,embed,portal,meta[http-equiv],link[rel="prefetch"],link[rel="prerender"]')
            || nodes.some(node => node.attributes.length > 64 || [...node.attributes].some(attr => /^on/i.test(attr.name) || /^(ping|download|formaction|formmethod|formtarget|formenctype|formnovalidate)$/i.test(attr.name)))) throw new Error('UNSUPPORTED_ACTION');
          const inputs = document.querySelectorAll('input[type="search"][name="q"]');
          if (inputs.length !== 1) throw new Error('TARGET_AMBIGUOUS');
          const input = inputs[0] as HTMLInputElement, form = input.form;
          if (!form || document.forms.length !== 1 || input.disabled || input.readOnly || input.getAttribute('type')?.toLowerCase() !== 'search' || input.name !== 'q'
            || [...input.attributes].some(attr => /^(dirname|minlength|maxlength|pattern|multiple|disabled|readonly|required|list|autofocus|form.*)$/i.test(attr.name))
            || form.hasAttribute('accept-charset') || form.hasAttribute('novalidate') || document.querySelectorAll('input,button,select,textarea').length !== 1
            || form.method.toLowerCase() !== 'get' || form.elements.length !== 1 || form.elements[0] !== input
            || form.target && form.target !== '_self' || form.enctype !== 'application/x-www-form-urlencoded') throw new Error('UNSUPPORTED_ACTION');
          return { actionUrl: form.action, origin: location.origin };
        });
        guard(); if (!await current()) throw new Error('TARGET_CONTEXT_CHANGED');
        const action = new URL(data.actionUrl);
        if (action.origin !== data.origin || action.search || action.hash || action.username || action.password) throw new Error('UNSUPPORTED_ACTION');
        action.searchParams.set('q', args.request.query);
        return { selector: 'input[type="search"][name="q"]' as const, actionUrl: data.actionUrl, expectedUrl: action.href };
      };
      const watchNavigation = async (expectedUrl: string, reason: 'formSubmissionGet' | 'anchorClick', deadline: number): Promise<NativeNavigationWatch> => {
        guard(); const channel = this.pageCdps.get(page); if (!channel) throw new Error('TARGET_CONTEXT_CHANGED');
        await channel.cdp.send('Page.enable'); guard(); await channel.cdp.send('Network.enable'); guard();
        const initialLoader = inventoryView.loaderId;
        const facts: { -readonly [K in keyof NativeNavigationFacts]: NativeNavigationFacts[K] } = { expectedUrl, reason, requested: false, documentGet: false,
          responseObserved: false, loaderChanged: false, redirected: false, competingEdge: false, nativeKeyCausalProvenance: 'unavailable', terminal: false };
        let edges = 0, requestId: string | undefined, closed = false;
        const reject = () => { facts.competingEdge = true; facts.terminal = true; };
        const requested = (event: { frameId: string; url: string; reason: string }) => {
          if (event.frameId !== inventoryView.frameId) { reject(); return; }
          if (++edges > 1 || event.url !== expectedUrl || event.reason !== reason) reject(); else facts.requested = true;
        };
        const request = (event: { frameId?: string; type?: string; requestId: string; loaderId: string; request: { url: string; method: string }; redirectResponse?: unknown }) => {
          if (event.type !== 'Document') return;
          if (event.frameId !== inventoryView.frameId) { reject(); return; }
          if (event.redirectResponse) { facts.redirected = true; reject(); }
          if (requestId || event.request.url !== expectedUrl || event.request.method !== 'GET' || !facts.requested) reject();
          else if (!event.requestId || !event.loaderId || event.loaderId === initialLoader) reject();
          else { requestId = event.requestId; facts.requestId = event.requestId; facts.requestLoaderId = event.loaderId; facts.documentGet = true; }
        };
        const response = (event: { requestId: string; loaderId: string; type?: string; response: { url: string; status: number; headers?: Record<string, string> } }) => {
          if (event.requestId !== requestId) return;
          if (event.type !== 'Document' || event.loaderId !== facts.requestLoaderId || event.response.url !== expectedUrl || event.response.status < 200 || event.response.status >= 300
            || Object.keys(event.response.headers ?? {}).some(name => /^refresh$/i.test(name))) reject(); else facts.responseObserved = true;
        };
        const navigated = (event: { frame: { id: string; loaderId: string; url: string } }) => {
          if (event.frame.id !== inventoryView.frameId) { reject(); return; }
          if (event.frame.url !== expectedUrl || event.frame.loaderId === initialLoader || event.frame.loaderId !== facts.requestLoaderId || !facts.documentGet || !facts.responseObserved) reject();
          else { facts.frameLoaderId = event.frame.loaderId; facts.loaderChanged = true; facts.terminal = true; }
        };
        channel.cdp.on('Page.frameRequestedNavigation', requested); channel.cdp.on('Network.requestWillBeSent', request);
        channel.cdp.on('Network.responseReceived', response); channel.cdp.on('Page.frameNavigated', navigated);
        const timeout = setTimeout(() => { facts.terminal = true; void observation.dispose(); }, Math.max(1, deadline - Date.now())); timeout.unref();
        const observation: NativeNavigationWatch = { inspect: () => Object.freeze({ ...facts }), dispose: async () => {
          if (closed) return; closed = true; clearTimeout(timeout); facts.terminal = true;
          channel.cdp.off('Page.frameRequestedNavigation', requested); channel.cdp.off('Network.requestWillBeSent', request);
          channel.cdp.off('Network.responseReceived', response); channel.cdp.off('Page.frameNavigated', navigated); navigationWatches.delete(observation);
        } };
        navigationWatches.add(observation);
        try { guard(); return observation; } catch (error) { await observation.dispose(); throw error; }
      };
      const observeGoal = async (expectedUrl: string, action: 'search' | 'navigate', query?: string) => {
        const after = await observe(); guard();
        const goal = await realm.evaluate(({ expectedUrl, action, query }) => {
          if (location.href !== expectedUrl || document.querySelector('base,iframe,frame,object,embed,portal,meta[http-equiv]') || document.scripts.length) return false;
          if (action === 'navigate') return true;
          const url = new URL(location.href);
          return url.searchParams.getAll('q').length === 1 && url.searchParams.get('q') === query && document.querySelectorAll('a[href]').length > 0;
        }, { expectedUrl, action, query });
        guard(); if (!goal || !await current()) throw new Error('READBACK_MISMATCH'); return after;
      };
      const prepareObservedTransition = async (expectedUrl: string, reason: 'formSubmissionGet' | 'anchorClick', deadline: number): Promise<NativeObservedTransitionHost> => {
        guard(); this.sessions.inspectNativeContext(session);
        if (!this.nativePages.has(page) || transition || !inventory || !Number.isFinite(deadline) || deadline > args.deadline || deadline <= Date.now()
          || !parseBrowserWorkflowRequest({ action: 'navigate', url: expectedUrl, verificationGoal: 'Validate expected native transition.' }).success
          || !(this.options.fixtureOrigins ?? []).includes(new URL(expectedUrl).origin)) throw new Error('UNSUPPORTED_ACTION');
        await this.proxy.assertAllowedUrl(expectedUrl); guard();
        const observation = await watchNavigation(expectedUrl, reason, deadline); guard();
        let armed = false, transferred = false, finished = false, transitionDeadline = deadline, navigationRequestUsed = false;
        let armTimer: NodeJS.Timeout | undefined;
        const operationId = randomUUID();
        const guardTransition = () => {
          try { args.guard(); if (disposed || Date.now() >= transitionDeadline || !transition) throw new Error('TARGET_CONTEXT_CHANGED');
            assertViewport();
            this.sessions.assertOwnedLaunch(launch); this.sessions.assertOwnedEngineTransition(transition); this.sessions.inspectNativeContext(session);
          } catch (error) { void dispose(true); throw error; }
        };
        try {
          transition = this.sessions.armExclusiveEngineTransition(launch, inventory, { frameId: inventoryView.frameId, loaderId: inventoryView.loaderId, url: expectedUrl, reason, deadline }, () => {
            retired = true; if (!lost) { lost = true; onLost(); } void retireDocument();
          });
          this.nativeNetworkFences.set(page, { guard: guardTransition, allowedUrl: () => armed && !finished && !observation.inspect().terminal ? expectedUrl : undefined,
            reserve: () => { if (!armed || navigationRequestUsed) throw new Error('NAVIGATION_BLOCKED'); navigationRequestUsed = true; } });
          this.active.set(session.id, { context: { ...args.context, authorizedPermissions: [] }, guard: guardTransition, deadline,
            network: false, operationId, admittedOrigins: new Set() });
          const prepared: NativeObservedTransitionHost = {
            inspect: () => observation.inspect(), guard: guardTransition,
            hasRetirementStarted: () => retired,
            arm: () => { guardTransition(); if (armed || finished || observation.inspect().requested || observation.inspect().terminal) throw new Error('TARGET_CONTEXT_CHANGED');
              transitionDeadline = Math.min(deadline, Date.now() + 1000); this.sessions.activateOwnedEngineTransition(transition!, transitionDeadline);
              armed = true; const active = this.active.get(session.id); if (!active || active.operationId !== operationId) throw new Error('TARGET_CONTEXT_CHANGED'); active.network = true; active.deadline = transitionDeadline;
              armTimer = setTimeout(() => { if (!transferred) void prepared.dispose(); }, Math.max(1, transitionDeadline - Date.now())); armTimer.unref(); return transitionDeadline;
            },
            awaitTerminal: async () => { guardTransition();
              while (!observation.inspect().terminal) { await new Promise(resolve => setTimeout(resolve, 5)); guardTransition(); }
              finished = true; const active = this.active.get(session.id); if (active?.operationId === operationId) { active.network = false; active.admittedOrigins.clear(); }
            },
            captureSuccessor: async (successorLost) => {
              guardTransition(); const observed = observation.inspect();
              if (!armed || !retired || transferred || !observed.terminal || observed.competingEdge || observed.redirected || !observed.loaderChanged
                || observed.requestLoaderId !== observed.frameLoaderId) throw new Error('TARGET_CONTEXT_CHANGED');
              let next: NativeRetainedSourceHost | undefined, pendingLoss = false;
              const nextInventory = await this.sessions.captureSuccessorEngineInventory(transition!, () => { pendingLoss = true; successorLost(); if (next) void next.dispose(); });
              try {
                args.guard(); assertViewport(); this.sessions.assertOwnedLaunch(launch);
                const nextView = this.sessions.inspectExclusiveEngineInventory(nextInventory);
                if (pendingLoss || nextView.frameId !== inventoryView.frameId || nextView.targetId !== inventoryView.targetId || nextView.loaderId !== observed.frameLoaderId) throw new Error('TARGET_CONTEXT_CHANGED');
                next = await this.captureNativeSourceHost(args, successorLost, { launch, inventory: nextInventory, viewport: retainedViewport });
                args.guard(); next.guard(); if (pendingLoss || !await next.current()) throw new Error('TARGET_CONTEXT_CHANGED');
                args.guard(); next.guard(); transferred = true; anchorTransferred = true; clearTimeout(timer); if (armTimer) clearTimeout(armTimer); return next;
              } catch (error) { await this.sessions.disposeExclusiveEngineInventory(nextInventory).catch(() => {}); await next?.dispose(); throw error; }
            },
            dispose: async () => {
              finished = true; if (armTimer) clearTimeout(armTimer); await observation.dispose();
              const active = this.active.get(session.id); if (active?.operationId === operationId) { active.network = false; active.admittedOrigins.clear(); this.active.delete(session.id); }
              if (transition) await this.sessions.disposeOwnedEngineTransition(transition);
              if (!transferred) await dispose(true);
            },
          };
          guardTransition(); return prepared;
        } catch (error) { await observation.dispose(); await dispose(true); throw error; }
      };
      guard();
      if (this.nativePages.has(page)) this.nativeRetainedGuards.set(page, guard);
      return { sourceEpochDigest, guard, guardNativeProfile: () => { guard(); this.sessions.inspectNativeContext(session); if (!this.nativePages.has(page)) throw new Error('UNSUPPORTED_ACTION'); },
        current, observe, locate, retainScrollSurface, dispose, searchProfile, watchNavigation, prepareObservedTransition, observeGoal,
        inspectHeldSource: () => { guard(); const documentId = this.documents.get(page);
          if (!documentId || !inventory) throw new Error('TARGET_CONTEXT_CHANGED');
          return Object.freeze({ launch: this.sessions.inspectRetainedLaunch(launch), inventory: this.sessions.inspectExclusiveEngineInventory(inventory), documentId }); },
        scrollExtent: async () => {
        guard(); const extent = await realm.evaluate(() => Math.max(0, (document.scrollingElement?.scrollHeight ?? 0) - innerHeight)); guard(); return extent;
      } };
    } catch (error) {
      lose(); await dispose();
      // An invalidation callback can run while a resource-producing await is pending.
      // Dispose late results as well; the first cleanup may have seen no capability yet.
      await Promise.allSettled([watch?.dispose(), inventory ? this.sessions.disposeExclusiveEngineInventory(inventory) : Promise.resolve()]);
      throw error;
    }
  }
  private check(session: OwnedBrowserSession) {
    const active = this.active.get(session.id);
    if (!active || Date.now() >= active.deadline) throw new Error('DEADLINE_EXCEEDED');
    this.sessions.get(session.id, session.owner); active.guard();
  }
  private async configure(session: OwnedBrowserSession) {
    await session.context.routeWebSocket('**/*', socket => socket.close());
    session.context.on('page', page => { this.trackDocument(page); page.on('dialog', dialog => { void dialog.dismiss(); }); });
  }
  private trackDocument(page: Page): void {
    if (this.documents.has(page)) return;
    this.documents.set(page, randomUUID());
    page.on('framenavigated', frame => { if (frame === page.mainFrame()) { const source = this.currentIssuedSources.get(page); if (source) this.loseSource(source); this.documents.set(page, randomUUID()); this.realms.get(page)?.invalidate(); this.realms.delete(page); void this.disposeDocumentRoots(page); } });
    page.on('close', () => { const source = this.currentIssuedSources.get(page); if (source) this.loseSource(source); this.realms.get(page)?.invalidate(); this.realms.delete(page); void this.disposeDocumentRoots(page); });
  }
  private async dom(page: Page): Promise<TrustedDomRealm> {
    const current = this.realms.get(page); if (current?.active) return current;
    const owned = this.pageCdps.get(page); if (!owned || page.isClosed()) throw new Error('TARGET_CONTEXT_CHANGED');
    const frameId = (await owned.cdp.send('Page.getFrameTree')).frameTree.frame.id;
    if (frameId !== owned.frameId) throw new Error('TARGET_CONTEXT_CHANGED');
    const world = await owned.cdp.send('Page.createIsolatedWorld', { frameId, worldName: `edith-private-${randomUUID()}` });
    const realm = new TrustedDomRealm(owned.cdp, world.executionContextId, this.nativePages.has(page));
    await realm.initialize(); this.realms.set(page, realm); return realm;
  }
  private async disposeDocumentRoots(page: Page): Promise<void> {
    const roots = this.documentRoots.get(page); this.documentRoots.delete(page);
    if (roots) await Promise.allSettled([roots.root.dispose(), roots.body.dispose()]);
  }
  private async ensureDocumentIdentity(page: Page): Promise<{ root: TrustedDomHandle; body: TrustedDomHandle }> {
    let roots = this.documentRoots.get(page);
    if (!roots) {
      const rootObject = await (await this.dom(page)).evaluateHandle(() => document.documentElement);
      const bodyObject = await (await this.dom(page)).evaluateHandle(() => document.body);
      const root = rootObject.asElement(), body = bodyObject.asElement();
      if (!root || !body) { await Promise.allSettled([rootObject.dispose(), bodyObject.dispose()]); throw new Error('TARGET_CONTEXT_CHANGED'); }
      roots = { root, body }; this.documentRoots.set(page, roots);
    }
    const retained = await roots.root.evaluate((root, body) => root.isConnected && body.isConnected
      && root === document.documentElement && body === document.body && body.ownerDocument === root.ownerDocument, roots.body).catch(() => false);
    if (!retained) {
      // document.open/write/setContent can replace root nodes without a navigation event.
      this.documents.set(page, randomUUID()); await this.disposeDocumentRoots(page);
      throw new Error('TARGET_CONTEXT_CHANGED');
    }
    return roots;
  }
  private async guardResponses(session: OwnedBrowserSession, page: Page): Promise<void> {
    if (this.responseGuarded.has(page)) return;
    this.trackDocument(page);
    const cdp = await session.context.newCDPSession(page);
    const frameId = (await cdp.send('Page.getFrameTree')).frameTree.frame.id;
    this.pageCdps.set(page, { cdp, frameId });
    const challenges = new Set<string>();
    cdp.on('Fetch.authRequired', event => {
      void (async () => {
        try {
          this.check(session);
          const active = this.active.get(session.id)!;
          if (!active.network || event.authChallenge.source !== 'Proxy' || !this.proxyOrigin
            || new URL(event.authChallenge.origin).origin !== this.proxyOrigin
            || !active.admittedOrigins.has(new URL(event.request.url).origin) || challenges.has(event.requestId)) throw new Error('NAVIGATION_BLOCKED');
          challenges.add(event.requestId);
          if (challenges.size > 128) challenges.delete(challenges.values().next().value!);
          await cdp.send('Fetch.continueWithAuth', { requestId: event.requestId, authChallengeResponse: { response: 'ProvideCredentials', ...this.proxyCredentials } });
        } catch { await cdp.send('Fetch.continueWithAuth', { requestId: event.requestId, authChallengeResponse: { response: 'CancelAuth' } }).catch(() => {}); }
      })();
    });
    cdp.on('Fetch.requestPaused', event => {
      void (async () => {
        try {
          this.check(session);
          if (event.responseStatusCode === undefined && !event.responseErrorReason) {
            const active = this.active.get(session.id)!;
            if (!active.network || event.frameId !== frameId || ![...session.pages.values()].includes(page)
              || !['GET', 'HEAD'].includes(event.request.method)
              || !parseBrowserWorkflowRequest({ action: 'navigate', url: event.request.url, verificationGoal: 'Validate owned browser request.' }).success
              || Object.keys(event.request.headers).some(key => /^(authorization|cookie|proxy-authorization)$/i.test(key))) throw new Error('NETWORK_TARGET_UNSAFE');
            await this.proxy.assertAllowedUrl(event.request.url); this.check(session);
            active.admittedOrigins.add(new URL(event.request.url).origin);
            await cdp.send('Fetch.continueRequest', { requestId: event.requestId });
            return;
          }
          if (!this.active.get(session.id)!.network || event.responseStatusCode === undefined || event.responseStatusCode >= 300 && event.responseStatusCode < 400
            || event.responseErrorReason || Object.keys(event.request.headers).some(key => /^(authorization|proxy-authorization)$/i.test(key))) throw new Error('NAVIGATION_BLOCKED');
          if (this.nativePages.has(page) && (event.responseHeaders ?? []).some(header => /^refresh$/i.test(header.name))) throw new Error('NAVIGATION_BLOCKED');
          await this.proxy.assertAllowedUrl(event.request.url); this.check(session);
          await cdp.send('Fetch.continueResponse', { requestId: event.requestId, responseCode: event.responseStatusCode,
            ...(event.responseStatusText ? { responsePhrase: event.responseStatusText } : {}),
            responseHeaders: (event.responseHeaders ?? []).filter(header => !/^set-cookie(?:2)?$/i.test(header.name)) });
        } catch { await cdp.send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'BlockedByClient' }).catch(() => {}); }
      })();
    });
    await cdp.send('Fetch.enable', { handleAuthRequests: true, patterns: [{ urlPattern: '*', requestStage: 'Request' }, { urlPattern: '*', requestStage: 'Response' }] });
    this.responseGuarded.add(page);
  }
  private async observe(session: OwnedBrowserSession, pageId: string, page: Page): Promise<BrowserPageObservation> {
    this.check(session);
    await this.ensureDocumentIdentity(page);
    const documentId = this.documents.get(page); if (!documentId) throw new Error('TARGET_CONTEXT_CHANGED');
    const data = await (await this.dom(page)).evaluate(() => {
      const state = (window as any).__edithBrowser;
      if (!state) throw new Error('TARGET_CONTEXT_CHANGED');
      const vv = visualViewport;
      return { documentId: state.documentId, url: location.href, title: document.title,
        viewport: { width: innerWidth, height: innerHeight, scrollX, scrollY, deviceScaleFactor: devicePixelRatio,
          visualOffsetX: vv?.offsetLeft ?? 0, visualOffsetY: vv?.offsetTop ?? 0, visualScale: vv?.scale ?? 1 } };
    });
    this.check(session);
    await this.ensureDocumentIdentity(page);
    if (this.documents.get(page) !== documentId) throw new Error('TARGET_CONTEXT_CHANGED');
    const result: BrowserPageObservation = { id: randomUUID(), sessionId: session.id, pageId, generation: ++session.generation,
      observedAt: new Date().toISOString(), ...data, documentId };
    session.activeDocumentIds.set(pageId, documentId);
    return result;
  }
  private async locate(page: Page, selector: string, form: boolean): Promise<{ handle: TrustedDomHandle; lease: Lease }> {
    await this.ensureDocumentIdentity(page);
    // querySelectorAll receives data, not executable expressions; top-level DOM only.
    if (/^(?:xpath|text|role)=|>>>|\/\//i.test(selector)) throw new Error('VALIDATION_ERROR');
    const object = await (await this.dom(page)).evaluateHandle(css => {
      let nodes: NodeListOf<Element>;
      try { nodes = document.querySelectorAll(css); } catch { throw new Error('VALIDATION_ERROR'); }
      if (nodes.length !== 1) throw new Error(nodes.length ? 'TARGET_AMBIGUOUS' : 'TARGET_NOT_FOUND');
      return nodes[0];
    }, selector);
    const handle = object.asElement();
    if (!handle) { await object.dispose(); throw new Error('TARGET_NOT_FOUND'); }
    try { return { handle, lease: await this.inspect(handle, form, page) }; }
    catch (error) { await handle.dispose(); throw error; }
  }
  private async inspect(handle: TrustedDomHandle, form: boolean, page: Page): Promise<Lease> {
    await this.ensureDocumentIdentity(page);
    const documentId = this.documents.get(page); if (!documentId) throw new Error('TARGET_CONTEXT_CHANGED');
    const lease = await handle.evaluate((node: any, requireForm) => {
      const state = (window as any).__edithBrowser;
      if (!state || !node.isConnected || node.getRootNode() !== document) throw new Error('TARGET_STALE');
      const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
      if (!rect.width || !rect.height || style.visibility !== 'visible' || style.display === 'none' || Number(style.opacity) === 0
        || node.hidden) throw new Error('TARGET_STALE');
      for (let ancestor = node.parentElement; ancestor; ancestor = ancestor.parentElement) {
        const parentStyle = getComputedStyle(ancestor);
        if (parentStyle.visibility !== 'visible' || parentStyle.display === 'none' || Number(parentStyle.opacity) === 0 || ancestor.hidden || (requireForm && ancestor.inert)) throw new Error('TARGET_STALE');
      }
      if (requireForm) {
        if (rect.left < 0 || rect.top < 0 || rect.right > innerWidth || rect.bottom > innerHeight || style.pointerEvents === 'none' || node.inert || node.getAttribute('aria-disabled') === 'true') throw new Error('TARGET_STALE');
        for (const [x,y] of [[rect.left+rect.width/2,rect.top+rect.height/2], [rect.left+1,rect.top+1], [rect.right-1,rect.bottom-1]]) {
          const hit = document.elementFromPoint(x,y);
          if (!hit || (hit !== node && !node.contains(hit))) throw new Error('TARGET_OCCLUDED');
        }
      }
      const labels = node.labels ? Array.from(node.labels as NodeListOf<HTMLLabelElement>).map(label => label.textContent ?? '').join(' ') : '';
      if (requireForm && (!(node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement)
        || (node instanceof HTMLInputElement && !['text', 'search', 'email', 'tel', 'url'].includes(node.type))
        || node.disabled || node.readOnly || /password|secret|token|credential|authorization|cookie|api[_-]?key/i.test(`${node.name} ${node.id} ${node.autocomplete} ${node.getAttribute('aria-label')} ${labels} ${node.placeholder} ${node.form?.getAttribute('action')}`))) throw new Error('VALIDATION_ERROR');
      let nodeId = state.nodes.get(node); if (!nodeId) { nodeId = state.nextNode++; state.nodes.set(node, nodeId); }
      return { nodeId, documentId: state.documentId, version: state.version,
        semantic: JSON.stringify([node.tagName, node.getAttribute('role'), node.getAttribute('type'), node.name ?? '', node.getAttribute('aria-label') ?? labels,
          node.form?.id ?? '', node.form?.getAttribute('action') ?? '', node.form?.getAttribute('method') ?? '']),
        rect: [rect.left, rect.top, rect.width, rect.height], viewport: [innerWidth, innerHeight, scrollX, scrollY, devicePixelRatio, visualViewport?.scale ?? 1] };
    }, form);
    await this.ensureDocumentIdentity(page);
    if (this.documents.get(page) !== documentId) throw new Error('TARGET_CONTEXT_CHANGED');
    return { ...lease, domDocumentId: lease.documentId, documentId };
  }
  async execute(request: ParsedBrowserWorkflowRequest, context: EdithToolExecutionContext, guard: Guard, idleGuard: Guard): Promise<BrowserOperatorReceipt> {
    const receipt: BrowserOperatorReceipt = { ...BROWSER_OPERATOR_CONTRACT, operationId: randomUUID(), action: request.action,
      status: 'failed', backend: 'owned_headed_playwright', inputProvenance: 'none', nativePhysicalProof: false,
      postconditions: [], artifacts: [], targetIds: [], resolveAttempts: 0, inputDispatches: 0 };
    let session: OwnedBrowserSession | undefined, changed = false, before: BrowserPageObservation | undefined, pageId: string | undefined, page: Page | undefined;
    let timeout: NodeJS.Timeout | undefined;
    const deadline = Date.now() + 30000;
    let expired = false, pendingInput = false;
    const deadlineSignal = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        expired = true;
        if (session) { const active = this.active.get(session.id); if (active) active.deadline = 0; void this.closeSession(session.id, session.owner).catch(() => {}); }
        reject(new Error('DEADLINE_EXCEEDED'));
      }, Math.max(1, deadline - Date.now()));
    });
    const within = <T>(operation: Promise<T>): Promise<T> => Promise.race([operation, deadlineSignal]);
    try {
      guard();
      if (request.sessionId) session = this.sessions.get(request.sessionId, context.actor);
      else {
        this.creatingSessions++;
        try {
        if (this.proxyClosing) await within(this.proxyClosing);
        const proxyUrl = await within(this.proxy.start()); this.proxyOrigin = new URL(proxyUrl).origin; guard();
        const creating = this.sessions.create(context.actor, proxyUrl, this.proxyCredentials).then(created => {
          if (expired) { void this.sessions.close(created.id, created.owner).catch(() => {}); throw new Error('DEADLINE_EXCEEDED'); }
          return created;
        });
        session = await within(creating);
        this.owners.set(session.id, context.actor);
        this.active.set(session.id, { context, guard, deadline, network: true, operationId: receipt.operationId, admittedOrigins: new Set() });
        await within(this.configure(session));
        } finally {
          this.creatingSessions--;
          if (!this.owners.size && !this.creatingSessions && !this.proxyClosing) {
            this.proxyClosing = this.proxy.close().finally(() => { this.proxyClosing = undefined; });
            void this.proxyClosing.catch(() => { this.lifecycleFailures++; });
          }
        }
      }
      const owned = session;
      this.sessionGuards.set(owned.id, idleGuard);
      const operation = this.sessions.runExclusive(owned, async () => {
        if (expired || Date.now() >= deadline) throw new Error('DEADLINE_EXCEEDED');
        guard(); this.active.set(owned.id, { context, guard, deadline, network: true, operationId: receipt.operationId, admittedOrigins: new Set() });
        receipt.sessionId = owned.id;
        const pageIdsBefore = new Set(owned.pages.keys());
        let newlyCreatedPage = false;
        if (request.action === 'new_tab' || !owned.pages.size) {
          const created = await this.sessions.newPage(owned); page = created.page; pageId = created.id;
          newlyCreatedPage = true;
        } else {
          pageId = request.pageId ?? (owned.pages.size === 1 ? [...owned.pages.keys()][0] : undefined);
          if (!pageId) throw new Error('PAGE_SELECTION_REQUIRED'); page = owned.pages.get(pageId);
          if (!page) throw new Error('PAGE_NOT_FOUND');
        }
        receipt.pageId = pageId;
        await this.guardResponses(owned, page); this.check(owned);
        const targetUrl = request.action === 'search' ? (this.options.searchUrl?.(request.query!) ?? `https://www.google.com/search?q=${encodeURIComponent(request.query!)}`) : request.url;
        const navigates = ['search', 'navigate', 'new_tab'].includes(request.action) || page.url() === 'about:blank';
        let navigationEvidence: { requested: string; final: string; response: string; chain: string[] } | undefined;
        if (navigates) {
          if (!targetUrl) throw new Error('VALIDATION_ERROR');
          await this.proxy.assertAllowedUrl(targetUrl); this.check(owned);
          changed = true;
          const response = await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: Math.max(1, deadline - Date.now()) });
          this.check(owned);
          if (!response || response.status() >= 400 || response.request().frame() !== page.mainFrame()) throw new Error('READBACK_MISMATCH');
          const chain: string[] = [];
          let currentRequest = response.request();
          while (currentRequest) { chain.unshift(currentRequest.url()); if (chain.length > 12) throw new Error('NAVIGATION_BLOCKED'); currentRequest = currentRequest.redirectedFrom()!; }
          const final = page.url();
          for (const url of [...chain, response.url(), final]) { if (!parseBrowserWorkflowRequest({ action: 'navigate', url, verificationGoal: 'Validate navigation evidence.' }).success) throw new Error('NETWORK_TARGET_UNSAFE'); await this.proxy.assertAllowedUrl(url); this.check(owned); }
          const normalize = (url: string) => { const value = new URL(url); value.hash = ''; return value.href; };
          if (!chain.length || normalize(chain[0]) !== normalize(targetUrl) || normalize(chain[chain.length-1]) !== normalize(response.url()) || normalize(final) !== normalize(response.url())) throw new Error('READBACK_MISMATCH');
          navigationEvidence = { requested: targetUrl, final, response: response.url(), chain };
        } else if (targetUrl && new URL(targetUrl).href !== new URL(page.url()).href) throw new Error('TARGET_CONTEXT_CHANGED');
        this.check(owned); before = await this.observe(owned, pageId!, page);
        receipt.inputProvenance = 'dom_api';
        if (['scroll', 'fill_form', 'title', 'extract', 'screenshot'].includes(request.action)) receipt.before = before;
        if (request.action === 'fill_form') {
          const filled: Array<{ handle: TrustedDomHandle; value: string; lease: Lease; targetId: string }> = [];
          try {
          for (const key of Object.keys(request.selectors!)) {
            this.check(owned);
            let target = await this.locate(page, request.selectors![key], true);
            const expected = target.lease;
            receipt.resolveAttempts = Math.max(receipt.resolveAttempts, 1);
            try {
              await this.options.beforeEffect?.('located', page); this.check(owned);
              let current: Lease | undefined;
              try { current = await this.inspect(target.handle, true, page); } catch { /* Re-resolve before input only. */ }
              if (!current || JSON.stringify(current) !== JSON.stringify(expected)) {
                if (receipt.inputDispatches) throw new Error('TARGET_STALE');
                await target.handle.dispose(); target = await this.locate(page, request.selectors![key], true);
                receipt.resolveAttempts = 2;
                if (target.lease.documentId !== expected.documentId || target.lease.semantic !== expected.semantic) throw new Error('TARGET_CONTEXT_CHANGED');
              }
              this.check(owned);
              const documentRoots = await this.ensureDocumentIdentity(page);
              // Validate a concurrent navigation before input; prohibit network relay once values can change.
              this.active.get(owned.id)!.network = false;
              pendingInput = true;
              const result = await target.handle.evaluate((node: any, args) => {
                const state = (window as any).__edithBrowser, rect = node.getBoundingClientRect();
                const style = getComputedStyle(node);
                const vp = [innerWidth, innerHeight, scrollX, scrollY, devicePixelRatio, visualViewport?.scale ?? 1];
                const labels = node.labels ? Array.from(node.labels as NodeListOf<HTMLLabelElement>).map(label => label.textContent ?? '').join(' ') : '';
                const semantic = JSON.stringify([node.tagName, node.getAttribute('role'), node.getAttribute('type'), node.name ?? '', node.getAttribute('aria-label') ?? labels,
                  node.form?.id ?? '', node.form?.getAttribute('action') ?? '', node.form?.getAttribute('method') ?? '']);
                if (document.documentElement !== args.root || document.body !== args.body || !args.root.isConnected || !args.body.isConnected
                  || !state || !node.isConnected || node.getRootNode() !== document || state.documentId !== args.lease.domDocumentId || state.nodes.get(node) !== args.lease.nodeId
                  || state.version !== args.lease.version || JSON.stringify([rect.left, rect.top, rect.width, rect.height]) !== JSON.stringify(args.lease.rect)
                  || semantic !== args.lease.semantic || JSON.stringify(vp) !== JSON.stringify(args.lease.viewport)
                  || !rect.width || !rect.height || rect.left < 0 || rect.top < 0 || rect.right > innerWidth || rect.bottom > innerHeight
                  || style.visibility !== 'visible' || style.display === 'none' || Number(style.opacity) === 0 || style.pointerEvents === 'none' || node.hidden || node.inert) throw new Error('TARGET_STALE');
                if (!(node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement)
                  || node instanceof HTMLInputElement && !['text', 'search', 'email', 'tel', 'url'].includes(node.type)
                  || node.disabled || node.readOnly || node.getAttribute('aria-disabled') === 'true'
                  || /password|secret|token|credential|authorization|cookie|api[_-]?key/i.test(`${node.name} ${node.id} ${node.autocomplete} ${node.getAttribute('aria-label')} ${node.placeholder} ${labels} ${node.form?.getAttribute('action')}`)) throw new Error('VALIDATION_ERROR');
                for (let ancestor = node.parentElement; ancestor; ancestor = ancestor.parentElement) {
                  const ancestorStyle = getComputedStyle(ancestor);
                  if (ancestor.inert || ancestor.hidden || ancestorStyle.visibility !== 'visible' || ancestorStyle.display === 'none' || Number(ancestorStyle.opacity) === 0) throw new Error('TARGET_STALE');
                }
                for (const [x,y] of [[rect.left+rect.width/2,rect.top+rect.height/2],[rect.left+1,rect.top+1],[rect.right-1,rect.bottom-1]]) {
                  const hit = document.elementFromPoint(x,y); if (!hit || hit !== node && !node.contains(hit)) throw new Error('TARGET_OCCLUDED');
                }
                const prototype = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
                const setter = Object.getOwnPropertyDescriptor(prototype, 'value')!.set!;
                setter.call(node, args.value); node.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: null }));
                node.dispatchEvent(new Event('change', { bubbles: true })); return true;
              }, { lease: target.lease, value: request.fieldValues![key], root: documentRoots.root, body: documentRoots.body });
              pendingInput = false;
              if (result) {
                changed = true; receipt.inputDispatches++;
                const targetId = randomUUID(); receipt.targetIds.push(targetId);
                this.targetAuthority.set(targetId, { sessionId: owned.id, pageId: pageId!, documentId: target.lease.documentId, observationId: before!.id, selectorHash: sha(request.selectors![key]), lease: structuredClone(target.lease) });
                while (this.targetAuthority.size > 512) this.targetAuthority.delete(this.targetAuthority.keys().next().value!);
                filled.push({ handle: target.handle, value: request.fieldValues![key], lease: target.lease, targetId });
              }
              await this.options.beforeEffect?.('after_input', page); this.check(owned);
              const value = await target.handle.evaluate((node: any) => {
                const prototype = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
                return String(Object.getOwnPropertyDescriptor(prototype, 'value')!.get!.call(node));
              });
              const afterField = await this.observe(owned, pageId!, page); receipt.after = afterField;
              const matched = value === request.fieldValues![key];
              receipt.postconditions.push({ kind: 'field_value_matched', matched, expectedFingerprint: sha(request.fieldValues![key]), observedFingerprint: sha(value), evidenceId: afterField.id });
              for (const condition of receipt.postconditions) condition.evidenceId = afterField.id;
              if (!matched || afterField.documentId !== before!.documentId) throw new Error('READBACK_MISMATCH');
            } finally { if (!filled.some(item => item.handle === target.handle)) await target.handle.dispose().catch(() => {}); }
          }
          // Later field handlers may modify earlier values: independently reread every handle now.
          const values: string[] = [];
          for (const field of filled) {
            this.check(owned); const current = await this.inspect(field.handle, true, page);
            if (current.documentId !== field.lease.documentId || current.nodeId !== field.lease.nodeId || current.semantic !== field.lease.semantic) throw new Error('TARGET_CONTEXT_CHANGED');
            values.push(await field.handle.evaluate((node: any) => {
              const prototype = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
              return String(Object.getOwnPropertyDescriptor(prototype, 'value')!.get!.call(node));
            }));
          }
          receipt.after = await this.observe(owned, pageId!, page);
          receipt.postconditions = filled.map((field,index) => ({ kind: 'field_value_matched', matched: values[index] === field.value,
            expectedFingerprint: sha(field.value), observedFingerprint: sha(values[index]), evidenceId: receipt.after!.id }));
          for (const field of filled) this.targetAuthority.get(field.targetId)!.observationId = receipt.after.id;
          if (receipt.after.documentId !== before!.documentId || receipt.postconditions.some(condition => !condition.matched)) throw new Error('READBACK_MISMATCH');
          } finally { await Promise.allSettled(filled.map(field => field.handle.dispose())); }
        } else if (request.action === 'scroll') {
          await this.options.beforeEffect?.('located', page); this.check(owned);
          const fresh = await this.observe(owned, pageId!, page);
          if (fresh.documentId !== before.documentId) throw new Error('TARGET_CONTEXT_CHANGED');
          if (JSON.stringify(fresh.viewport) !== JSON.stringify(before.viewport)) receipt.resolveAttempts = 2;
          else receipt.resolveAttempts = 1;
          before = fresh; receipt.before = fresh;
          pendingInput = true;
          const offsets = await (await this.dom(page)).evaluate(({ documentId, delta }) => {
            if ((window as any).__edithBrowser?.documentId !== documentId) throw new Error('TARGET_STALE');
            const y = scrollY, desired = Math.max(0, Math.min(y + delta, document.documentElement.scrollHeight - innerHeight));
            window.scrollTo({ top: desired, behavior: 'instant' }); return { desired, y };
          }, { documentId: await (await this.dom(page)).evaluate(() => (window as any).__edithBrowser?.documentId as string), delta: request.scrollDeltaY! });
          pendingInput = false;
          changed = true; receipt.inputDispatches = 1;
          receipt.after = await this.observe(owned, pageId!, page);
          const matched = receipt.after.viewport.scrollY !== offsets.y && Math.abs(receipt.after.viewport.scrollY - offsets.desired) <= 1;
          receipt.postconditions.push({ kind: 'scroll_offset_matched', matched, expectedFingerprint: sha(String(offsets.desired)), observedFingerprint: sha(String(receipt.after.viewport.scrollY)), evidenceId: receipt.after.id });
          if (!matched) throw new Error(receipt.after.viewport.scrollY === offsets.y ? 'SCROLL_BOUNDARY' : 'READBACK_MISMATCH');
        } else {
          if (request.action === 'extract') {
            const selectors = request.selectors ? Object.values(request.selectors) : ['main,body'];
            const pieces: string[] = [];
            for (const selector of selectors) {
              // Default main/body prefers main, rather than matching both ancestors.
              const actual = !request.selectors ? (await (await this.dom(page)).evaluate(() => Boolean(document.querySelector('main'))) ? 'main' : 'body') : selector;
              const target = await this.locate(page, actual, false);
              try { pieces.push(await target.handle.evaluate((node: HTMLElement) => node.innerText)); } finally { await target.handle.dispose(); }
            }
            const bytes = Buffer.from(pieces.join('\n'), 'utf8'); if (!bytes.length || bytes.length > 100000) throw new Error('READBACK_MISMATCH');
            this.artifact(owned, receipt, bytes, 'text');
          } else if (request.action === 'screenshot') this.artifact(owned, receipt, await page.screenshot({ type: 'png', fullPage: false, timeout: Math.max(1, deadline - Date.now()) }), 'screenshot');
          receipt.after = await this.observe(owned, pageId!, page);
          if (request.action === 'search') {
            const u = new URL(page.url());
            const hasResults = await (await this.dom(page)).evaluate(() => Array.from(document.querySelectorAll<HTMLAnchorElement>('main a[href], #search a[href], [data-search-results] a[href]')).filter(anchor => {
              try { if (!['http:', 'https:'].includes(new URL(anchor.href).protocol)) return false; } catch { return false; }
              const rect = anchor.getBoundingClientRect(); if (!rect.width || !rect.height) return false;
              for (let node: Element | null = anchor; node; node = node.parentElement) {
                const style = getComputedStyle(node);
                if (node.hasAttribute('hidden') || style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) === 0) return false;
              }
              return true;
            }).length);
            const matched = u.searchParams.get('q') === request.query && hasResults > 0;
            receipt.postconditions.push({ kind: 'search_results_observed', matched, expectedFingerprint: sha(request.query!), observedFingerprint: sha(u.searchParams.get('q') ?? ''), evidenceId: receipt.after.id });
            if (!matched) throw new Error('READBACK_MISMATCH');
          } else if (request.action === 'navigate' || request.action === 'new_tab') {
            const navigationMatched = Boolean(navigationEvidence && receipt.after.url === navigationEvidence.final && new URL(receipt.after.url).href === new URL(navigationEvidence.response).href);
            const pageCreated = newlyCreatedPage && !pageIdsBefore.has(pageId!) && owned.pages.size === pageIdsBefore.size + 1 && owned.pages.get(pageId!) === page && page.context().pages().includes(page) && !page.isClosed();
            const matched = navigationMatched && (request.action !== 'new_tab' || pageCreated);
            receipt.postconditions.push({ kind: request.action === 'navigate' ? 'url_committed' : 'page_created', matched,
              expectedFingerprint: sha(request.action === 'new_tab' ? String(pageIdsBefore.size+1) : navigationEvidence?.response ?? ''),
              observedFingerprint: sha(request.action === 'new_tab' ? String(owned.pages.size) : receipt.after.url), evidenceId: receipt.after.id });
            if (!matched) throw new Error('READBACK_MISMATCH');
          } else if (request.action === 'title') receipt.postconditions.push({ kind: 'title_observed', matched: true, observedFingerprint: sha(receipt.after.title), evidenceId: receipt.after.id });
          else if (request.action === 'extract' || request.action === 'screenshot') {
            const artifact = receipt.artifacts[0]; receipt.postconditions.push({ kind: request.action === 'extract' ? 'text_artifact_created' : 'screenshot_artifact_created', matched: true, observedFingerprint: artifact.sha256, evidenceId: artifact.id });
          }
        }
        this.check(owned); receipt.status = 'verified'; delete receipt.reasonCode; return receipt;
      });
      return await within(this.issue(await within(operation), request, context));
    } catch (error) {
      const raw = error instanceof Error ? error.message : '';
      const code = BROWSER_FAILURE_CODES.find(item => raw.includes(item)) ?? 'EFFECT_OUTCOME_UNKNOWN';
      receipt.reasonCode = code as BrowserFailureCode;
      receipt.status = changed || receipt.inputDispatches || pendingInput ? 'partial' : 'failed';
      if (!changed && !receipt.inputDispatches && !pendingInput) { receipt.before = undefined; receipt.after = undefined; receipt.postconditions = []; receipt.artifacts = []; receipt.targetIds = []; }
      receipt.inputProvenance = changed || receipt.inputDispatches || pendingInput ? 'dom_api' : 'none';
      // Validation rejects undefined optional fields; omit them rather than invent evidence.
      for (const key of ['before', 'after'] as const) if (!receipt[key]) delete receipt[key];
      if (session && ['OWNER_SESSION_REQUIRED', 'PERMISSION_DENIED', 'KILL_SWITCH_ACTIVE', 'DEADLINE_EXCEEDED'].includes(code)) void this.closeSession(session.id, session.owner).catch(() => {});
      return receipt;
    } finally {
      if (timeout) clearTimeout(timeout);
      if (session && this.active.get(session.id)?.operationId === receipt.operationId) this.active.delete(session.id);
      if (!this.owners.size && !this.creatingSessions && !this.proxyClosing) {
        this.proxyClosing = this.proxy.close().finally(() => { this.proxyClosing = undefined; });
        void this.proxyClosing.catch(() => { this.lifecycleFailures++; });
      }
    }
  }
  private artifact(session: OwnedBrowserSession, receipt: BrowserOperatorReceipt, bytes: Buffer, kind: 'text' | 'screenshot') {
    if (!bytes.length || bytes.length > (kind === 'text' ? 100000 : 8388608)) throw new Error('READBACK_MISMATCH');
    while (session.artifacts.size >= 8 || [...session.artifacts.values()].reduce((total, entry) => total + entry.length, 0) + bytes.length > 16777216) {
      const oldest = session.artifacts.keys().next().value; if (!oldest) throw new Error('READBACK_MISMATCH');
      session.artifacts.delete(oldest); this.artifactOwners.delete(oldest);
    }
    const id = randomUUID(); session.artifacts.set(id, bytes); this.artifactOwners.set(id, { sessionId: session.id, owner: session.owner, mime: kind === 'text' ? 'text/plain; charset=utf-8' : 'image/png' });
    receipt.artifacts.push({ id, kind, sha256: sha(bytes), bytes: bytes.length });
  }
}

let current: BrowserOperatorAdapter | undefined;
let initializationAttempted = false;
let testReplacementPending = false;
/** Trusted backend startup only; first attempt fixes this process's adapter. */
export function initializeBrowserOperatorAdapter(options: Readonly<{executablePath?: string}> = {}): BrowserOperatorAdapter {
  if (initializationAttempted || testReplacementPending) throw new Error('CONFIGURATION_REQUIRED');
  initializationAttempted = true;
  current = new BrowserOperatorAdapter({ executablePath: options.executablePath });
  return current;
}
export function getBrowserOperatorAdapter(): BrowserOperatorAdapter {
  if (testReplacementPending) throw new Error('CONFIGURATION_REQUIRED');
  if (current) return current;
  if (initializationAttempted) throw new Error('CONFIGURATION_REQUIRED');
  return initializeBrowserOperatorAdapter();
}
export async function setBrowserOperatorTestOptions(options: BrowserOperatorOptions) {
  if (process.env.EDITH_TEST_MODE !== 'true' || testReplacementPending) throw new Error('CONFIGURATION_REQUIRED');
  testReplacementPending = true;
  initializationAttempted = true;
  const previous = current; current = undefined;
  try {
    if (previous) await previous.closeAll();
    current = new BrowserOperatorAdapter(options);
  } finally { testReplacementPending = false; }
}

