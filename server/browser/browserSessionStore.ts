import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import type { ChildProcess } from 'node:child_process';
import { chromium, type Browser, type BrowserServer, type BrowserContext, type Page, type CDPSession, type Frame } from 'playwright';
import { onOwnerSessionInvalidated, ownerSessionBindingActive } from '../security/ownerSession';
import type { BrowserProxyCredentials } from './browserEgressProxy';

const IDLE_MS = 60_000;
const HARD_MS = 600_000;
async function boundedClose(operation: Promise<unknown>, milliseconds: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try { await Promise.race([operation, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('EFFECT_OUTCOME_UNKNOWN')), milliseconds); })]); }
  finally { if (timer) clearTimeout(timer); }
}
export interface OwnedBrowserSession {
  id: string; owner: string; createdAt: string; expiresAt: string; hardExpiresAt: string;
  browserServer: BrowserServer; browser: Browser; context: BrowserContext;
  pages: Map<string, Page>; generation: number; artifacts: Map<string, Buffer>;
  activeDocumentIds: Map<string, string>; queue: Promise<unknown>;
}
export interface OwnedBrowserProcessMetadata {
  sessionId: string; pid: number; createdAt: string; expiresAt: string; hardExpiresAt: string; pageIds: string[];
}
export interface BrowserClosureEvidence { sessionId: string; owner: string; pid: number; closedAt: string; processExited: boolean; }
export interface BrowserSessionStoreOptions { fixtureOrigins?: string[]; executablePath?: string; }
export interface NativeOwnedContextView {
  readonly sessionId: string; readonly context: BrowserContext; readonly browser: Browser; readonly process: ChildProcess;
  readonly javaScriptEnabled: false; readonly serviceWorkers: 'block'; readonly acceptDownloads: false;
  readonly acknowledgedAtMs: number;
}
declare const retainedLaunchBrand: unique symbol;
export type OwnedBrowserLaunchCap = Readonly<{ readonly [retainedLaunchBrand]: 'owned-launch' }>;
export type OwnedEngineInventoryCap = Readonly<{ readonly [retainedLaunchBrand]: 'engine-inventory' }>;
export type OwnedEngineTransitionCap = Readonly<{ readonly [retainedLaunchBrand]: 'engine-transition' }>;
export interface RetainedOwnedLaunchView {
  readonly launchEpoch: string; readonly ownerEpoch: number; readonly sessionId: string; readonly pageId: string;
  readonly owner: string; readonly process: ChildProcess; readonly browserServer: BrowserServer;
  readonly browser: Browser; readonly context: BrowserContext; readonly page: Page; readonly mainFrame: Frame;
}
export interface OwnedEngineInventoryView {
  readonly launchEpoch: string; readonly inventoryEpoch: string; readonly observedAt: string;
  readonly contextCount: 1; readonly pageCount: 1; readonly frameCount: 1;
  readonly targetId: string; readonly frameId: string; readonly loaderId: string;
  readonly targetTypes: readonly string[]; readonly dirty: boolean;
  readonly nativeBindingStatus: 'unavailable'; readonly nativePhysicalProof: false;
}
interface RetainedLaunch {
  readonly view: RetainedOwnedLaunchView; readonly session: OwnedBrowserSession;
  inventoryIssued: boolean;
}
interface EngineInventory {
  readonly launch: RetainedLaunch; readonly cap: OwnedEngineInventoryCap;
  readonly inventoryEpoch: string; dirty: boolean; disposed: boolean;
  view?: OwnedEngineInventoryView; readonly channels: CDPSession[]; readonly cleanup: Array<() => void>;
  invalidate: () => void;
  transition?: EngineTransition;
}
interface EngineTransition {
  readonly inventory: EngineInventory; readonly launch: RetainedLaunch;
  readonly expected: Readonly<{ frameId: string; loaderId: string; url: string; reason: 'formSubmissionGet' | 'anchorClick'; deadline: number }>;
  readonly onRetired: () => void;
  state: 'prepared' | 'retired' | 'successor' | 'failed' | 'disposed'; newLoader?: string; successorClaimed: boolean;
  armedDeadline?: number;
  loadingStarted?: boolean;
}

/** Private browser instances only; never attaches to an unrelated browser or user profile. */
export class BrowserSessionStore {
  readonly proxyOptions: Readonly<{ fixtureOrigins: readonly string[] }>;
  private readonly sessions = new Map<string, OwnedBrowserSession>();
  private readonly nativeContexts = new WeakMap<OwnedBrowserSession, NativeOwnedContextView>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly closing = new Map<string, Promise<void>>();
  private readonly closed = new Map<string, BrowserClosureEvidence>();
  private readonly unsubscribe: () => void;
  private readonly executable?: string;
  private creating = 0;
  private readonly creatingOwners = new Map<string, number>();
  private disposed = false;
  private readonly pendingCreates = new Map<Promise<OwnedBrowserSession>, string>();
  private readonly ownerEpochs = new Map<string, number>();
  private readonly issuedLaunches = new WeakMap<OwnedBrowserSession, { process: ChildProcess; server: BrowserServer; browser: Browser; context: BrowserContext; epoch: string; ownerEpoch: number;
    newContext: Browser['newContext']; newPage: Browser['newPage']; originalNewContext: Browser['newContext']; originalNewPage: Browser['newPage'] }>();
  private readonly retainedLaunches = new WeakMap<OwnedBrowserLaunchCap, RetainedLaunch>();
  private readonly engineInventories = new WeakMap<OwnedEngineInventoryCap, EngineInventory>();
  private readonly liveInventories = new Set<EngineInventory>();
  private readonly engineTransitions = new WeakMap<OwnedEngineTransitionCap, EngineTransition>();

  constructor(options: BrowserSessionStoreOptions = {}) {
    const origins = options.fixtureOrigins ?? [];
    if (origins.length && process.env.EDITH_TEST_MODE !== 'true') throw new Error('CONFIGURATION_REQUIRED');
    if (origins.length > 8 || origins.some((origin) => {
      try { const url = new URL(origin); return url.origin !== origin || url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname) || !url.port; } catch { return true; }
    })) throw new Error('VALIDATION_ERROR');
    this.proxyOptions = Object.freeze({ fixtureOrigins: Object.freeze([...origins]) });
    this.executable = this.discoverExecutable(options.executablePath);
    this.unsubscribe = onOwnerSessionInvalidated((event) => {
      for (const inventory of this.liveInventories) if (inventory.launch.view.owner === event.bindingId) inventory.invalidate();
      void this.closeOwner(event.bindingId).catch(() => {});
    });
  }

  private discoverExecutable(configured?: string): string | undefined {
    if (configured !== undefined) {
      if (typeof configured !== 'string' || !path.isAbsolute(configured) || !/^(chrome|chromium)(\.exe)?$/i.test(path.basename(configured))) throw new Error('CONFIGURATION_REQUIRED');
      try { const real = fs.realpathSync(configured); return fs.statSync(real).isFile() ? real : undefined; } catch { return undefined; }
    }
    // Only the actual module's known source/build layouts can locate the app.
    // esbuild CJS leaves import.meta empty; never pass that absent URL to Node.
    let root: string;
    try {
      const moduleUrl = import.meta.url;
      const moduleFile = typeof moduleUrl === 'string' && moduleUrl.startsWith('file:')
        ? fileURLToPath(moduleUrl) : typeof __filename === 'string' ? __filename : undefined;
      if (!moduleFile || !path.isAbsolute(moduleFile)) return undefined;
      const moduleReal = fs.realpathSync(moduleFile);
      const layouts = [
        ['server', 'browser', 'browserSessionStore.ts'],
        ['server', 'browser', 'browserSessionStore.js'],
        ['dist', 'server.cjs'],
        ['.edith-build', 'desktop', 'server.cjs'],
      ];
      const layout = layouts.find(parts => {
        const candidate = path.resolve(moduleReal, ...parts.map(() => '..'));
        return path.join(candidate, ...parts) === moduleReal;
      });
      if (!layout) return undefined;
      const appRoot = fs.realpathSync(path.resolve(moduleReal, ...layout.map(() => '..')));
      const contained = (base: string, target: string) => {
        const relative = path.relative(base, target);
        return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
      };
      if (path.join(appRoot, ...layout) !== moduleReal || !fs.statSync(moduleReal).isFile()) return undefined;
      const marker = fs.realpathSync(path.join(appRoot, 'package.json'));
      if (!contained(appRoot, marker) || !fs.statSync(marker).isFile()
        || JSON.parse(fs.readFileSync(marker, 'utf8')).name !== 'edith') return undefined;
      root = fs.realpathSync(path.join(appRoot, 'runtime', 'Packages', 'Playwright-Browsers'));
      if (!contained(appRoot, root) || !fs.statSync(root).isDirectory()) return undefined;
    } catch { return undefined; }
    if (!fs.existsSync(root)) return undefined;
    let versions: string[];
    try { versions = fs.readdirSync(root).filter((name) => /^chromium-\d+$/.test(name)).sort((a,b) => Number(b.split('-')[1]) - Number(a.split('-')[1])); }
    catch { return undefined; }
    for (const version of versions) for (const binary of ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe', 'chrome-linux/chrome', 'chrome-linux64/chrome']) {
      try {
        const real = fs.realpathSync(path.join(root, version, binary));
        const relative = path.relative(fs.realpathSync(root), real);
        if (relative.startsWith('..') || path.isAbsolute(relative) || !fs.statSync(real).isFile()) continue;
        return real;
      } catch { /* An absent distribution is unavailable, never downloaded here. */ }
    }
    return undefined;
  }

  availability() { const available = Boolean(this.executable) && !this.disposed; return { available, status: available ? 'available' : 'configuration_required', reasonCode: available ? undefined : 'CONFIGURATION_REQUIRED', backend: 'owned_headed_playwright' } as const; }

  create(owner: string, proxyUrl: string, credentials?: BrowserProxyCredentials): Promise<OwnedBrowserSession> {
    const operation = this.createOwned(owner, proxyUrl, credentials);
    this.pendingCreates.set(operation, owner);
    void operation.then(() => this.pendingCreates.delete(operation), () => this.pendingCreates.delete(operation));
    return operation;
  }
  createNative(owner: string, proxyUrl: string, credentials?: BrowserProxyCredentials): Promise<OwnedBrowserSession> {
    const operation = this.createOwned(owner, proxyUrl, credentials, true);
    this.pendingCreates.set(operation, owner);
    void operation.then(() => this.pendingCreates.delete(operation), () => this.pendingCreates.delete(operation));
    return operation;
  }
  inspectNativeContext(session: OwnedBrowserSession): Readonly<NativeOwnedContextView> {
    const record = this.nativeContexts.get(session);
    if (!record || this.get(session.id, session.owner) !== session || session.context !== record.context || session.browser !== record.browser
      || session.browserServer.process() !== record.process) throw new Error('NATIVE_BINDING_UNAVAILABLE');
    return record;
  }

  private async createOwned(owner: string, proxyUrl: string, credentials?: BrowserProxyCredentials, native = false): Promise<OwnedBrowserSession> {
    if (this.disposed) throw new Error('CONFIGURATION_REQUIRED');
    if (!ownerSessionBindingActive(owner)) throw new Error('OWNER_SESSION_REQUIRED');
    if (!this.executable) throw new Error('CONFIGURATION_REQUIRED');
    let proxy: URL;
    try { proxy = new URL(proxyUrl); } catch { throw new Error('VALIDATION_ERROR'); }
    if (proxy.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(proxy.hostname) || !proxy.port || proxy.username || proxy.password || proxy.pathname !== '/' || proxy.search || proxy.hash) throw new Error('VALIDATION_ERROR');
    let contextCredentials: BrowserProxyCredentials | undefined;
    if (credentials !== undefined) {
      if (!credentials || typeof credentials !== 'object' || Array.isArray(credentials)
        || ![Object.prototype, null].includes(Object.getPrototypeOf(credentials))
        || Object.keys(credentials).length !== 2 || !Object.hasOwn(credentials, 'username') || !Object.hasOwn(credentials, 'password')
        || [credentials.username, credentials.password].some(value => typeof value !== 'string' || value.length <= 16 || value.length >= 128 || !/^[\x21-\x7e]+$/.test(value))) throw new Error('VALIDATION_ERROR');
      contextCredentials = { username: credentials.username, password: credentials.password };
    }
    if (this.sessions.size + this.creating >= 8 || [...this.sessions.values()].filter((session) => session.owner === owner).length + (this.creatingOwners.get(owner) ?? 0) >= 3) throw new Error('CONFIGURATION_REQUIRED');
    this.creating += 1;
    this.creatingOwners.set(owner, (this.creatingOwners.get(owner) ?? 0) + 1);
    const epoch = this.ownerEpochs.get(owner) ?? 0;
    let server: BrowserServer | undefined;
    let session: OwnedBrowserSession | undefined;
    try {
      server = await chromium.launchServer({ headless: false, executablePath: this.executable, proxy: { server: proxy.origin, bypass: '<-loopback>' }, args: ['--proxy-bypass-list=<-loopback>', '--disable-quic', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp'], timeout: 15_000 });
      if (this.disposed || epoch !== (this.ownerEpochs.get(owner) ?? 0) || !ownerSessionBindingActive(owner)) throw new Error('OWNER_SESSION_REQUIRED');
      const browser = await chromium.connect(server.wsEndpoint(), { timeout: 10_000 });
      const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false,
        ...(native ? { javaScriptEnabled: false } : {}),
        // Owned-page CDP responds only to this proxy's challenge; never reuse proxy secrets as origin HTTP credentials.
        ...(contextCredentials ? { proxy: { server: proxy.origin, bypass: '<-loopback>' } } : {}) });
      const now = Date.now();
      session = { id: randomUUID(), owner, createdAt: new Date(now).toISOString(), expiresAt: new Date(now + IDLE_MS).toISOString(), hardExpiresAt: new Date(now + HARD_MS).toISOString(), browserServer: server, browser, context, pages: new Map(), generation: 1, artifacts: new Map(), activeDocumentIds: new Map(), queue: Promise.resolve() };
      const owned = session;
      context.on('page', (page) => {
        page.on('download', (download) => { void download.cancel().catch(() => {}); });
        // A popup has an opener; explicit context.newPage() has none.
        void page.opener().then((opener) => { if (opener) return page.close(); }).catch(() => {});
      });
      browser.on('disconnected', () => { void this.close(owned.id, owned.owner).catch(() => {}); });
      if (this.disposed || epoch !== (this.ownerEpochs.get(owner) ?? 0) || !ownerSessionBindingActive(owner)) throw new Error('OWNER_SESSION_REQUIRED');
      this.sessions.set(session.id, session);
      if (native) {
        if (context.pages().length !== 0) throw new Error('TARGET_CONTEXT_CHANGED');
        this.nativeContexts.set(session, Object.freeze({ sessionId: session.id, context, browser, process: server.process(),
          javaScriptEnabled: false, serviceWorkers: 'block', acceptDownloads: false, acknowledgedAtMs: Date.now() }));
      }
      const invalidateInventory = () => {
        for (const inventory of this.liveInventories) if (inventory.launch.session === owned) inventory.invalidate();
      };
      const originalNewContext = browser.newContext, originalNewPage = browser.newPage;
      // Observe owned API context creation before its first await, including contexts with no targets/pages.
      // Calls/results are unchanged; this does not claim visibility into another CDP client's empty contexts.
      browser.newContext = function(this: Browser, ...args: Parameters<Browser['newContext']>) { invalidateInventory(); return originalNewContext.apply(this, args); };
      browser.newPage = function(this: Browser, ...args: Parameters<Browser['newPage']>) { invalidateInventory(); return originalNewPage.apply(this, args); };
      this.issuedLaunches.set(session, { process: server.process(), server, browser, context, epoch: randomUUID(), ownerEpoch: epoch,
        newContext: browser.newContext, newPage: browser.newPage, originalNewContext, originalNewPage });
      this.touch(session);
      return session;
    } catch (error) {
      if (session && this.sessions.has(session.id)) await this.close(session.id, owner).catch(() => {});
      else if (server) { await boundedClose(server.close(), 5000).catch(async () => { await boundedClose(server!.kill(), 5000).catch(() => {}); }); }
      // Playwright diagnostics may include launch/context options. Return fixed codes only.
      const code = error instanceof Error && ['OWNER_SESSION_REQUIRED', 'CONFIGURATION_REQUIRED', 'VALIDATION_ERROR', 'EFFECT_OUTCOME_UNKNOWN'].includes(error.message)
        ? error.message : 'CONFIGURATION_REQUIRED';
      throw new Error(code);
    } finally { this.creating -= 1; const remaining = (this.creatingOwners.get(owner) ?? 1) - 1; if (remaining) this.creatingOwners.set(owner, remaining); else this.creatingOwners.delete(owner); }
  }

  get(id: string, owner: string): OwnedBrowserSession {
    const session = this.sessions.get(id);
    if (!session || session.owner !== owner) throw new Error('SESSION_EXPIRED');
    if (!ownerSessionBindingActive(owner)) { void this.close(id, owner).catch(() => {}); throw new Error('OWNER_SESSION_REQUIRED'); }
    if (Date.now() >= Date.parse(session.expiresAt) || Date.now() >= Date.parse(session.hardExpiresAt)) { void this.close(id, owner).catch(() => {}); throw new Error('SESSION_EXPIRED'); }
    return session;
  }

  private touch(session: OwnedBrowserSession): void {
    session.expiresAt = new Date(Math.min(Date.now() + IDLE_MS, Date.parse(session.hardExpiresAt))).toISOString();
    const old = this.timers.get(session.id); if (old) clearTimeout(old);
    const timer = setTimeout(() => { void this.close(session.id, session.owner).catch(() => {}); }, Math.max(1, Date.parse(session.expiresAt) - Date.now()));
    timer.unref(); this.timers.set(session.id, timer);
  }

  addPage(session: OwnedBrowserSession, page: Page): string {
    if (this.get(session.id, session.owner) !== session || page.context() !== session.context || page.isClosed()) throw new Error('PAGE_NOT_FOUND');
    for (const [id, existing] of session.pages) if (existing === page) return id;
    if (session.pages.size >= 3) { void page.close().catch(() => {}); throw new Error('PAGE_SELECTION_REQUIRED'); }
    const id = randomUUID(); session.pages.set(id, page);
    page.on('close', () => { session.pages.delete(id); session.activeDocumentIds.delete(id); session.generation += 1; });
    return id;
  }
  async newPage(session: OwnedBrowserSession): Promise<{ id: string; page: Page }> {
    this.get(session.id, session.owner);
    if (session.pages.size >= 3) throw new Error('PAGE_SELECTION_REQUIRED');
    const page = await session.context.newPage();
    try { return { id: this.addPage(session, page), page }; } catch (error) { await page.close().catch(() => {}); throw error; }
  }

  runExclusive<T>(session: OwnedBrowserSession, work: () => Promise<T>): Promise<T> {
    const operation = session.queue.catch(() => {}).then(async () => {
      if (this.get(session.id, session.owner) !== session) throw new Error('SESSION_EXPIRED');
      this.touch(session);
      const result = await work();
      this.get(session.id, session.owner); this.touch(session);
      return result;
    });
    session.queue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  inspectOwned(id: string, owner: string): OwnedBrowserProcessMetadata {
    const session = this.get(id, owner); const pid = session.browserServer.process().pid;
    if (!pid) throw new Error('NATIVE_BINDING_UNAVAILABLE');
    return { sessionId: id, pid, createdAt: session.createdAt, expiresAt: session.expiresAt, hardExpiresAt: session.hardExpiresAt, pageIds: [...session.pages.keys()] };
  }
  /** Issuer membership and retained objects establish identity; serializable process metadata never does. */
  retainOwnedLaunch(session: OwnedBrowserSession, pageId: string, page: Page): OwnedBrowserLaunchCap {
    const issued = this.issuedLaunches.get(session);
    if (!issued || this.get(session.id, session.owner) !== session || session.pages.get(pageId) !== page || page.isClosed()
      || session.browserServer !== issued.server || session.browser !== issued.browser || session.context !== issued.context
      || issued.server.process() !== issued.process || page.context() !== issued.context) throw new Error('NATIVE_BINDING_UNAVAILABLE');
    const cap = Object.freeze(Object.create(null)) as OwnedBrowserLaunchCap;
    const view: RetainedOwnedLaunchView = Object.freeze({ launchEpoch: issued.epoch, ownerEpoch: issued.ownerEpoch,
      sessionId: session.id, pageId, owner: session.owner, process: issued.process, browserServer: issued.server,
      browser: issued.browser, context: issued.context, page, mainFrame: page.mainFrame() });
    this.retainedLaunches.set(cap, { session, view, inventoryIssued: false }); this.assertOwnedLaunch(cap); return cap;
  }
  private assertRetainedLaunch(launch: RetainedLaunch): void {
    const { session, view } = launch, issued = this.issuedLaunches.get(session);
    if (!issued || this.get(view.sessionId, view.owner) !== session || issued.epoch !== view.launchEpoch
      || (this.ownerEpochs.get(view.owner) ?? 0) !== view.ownerEpoch || session.owner !== view.owner
      || session.browserServer !== view.browserServer || session.browser !== view.browser || session.context !== view.context
      || view.browser.newContext !== issued.newContext || view.browser.newPage !== issued.newPage
      || view.browserServer.process() !== view.process || issued.process !== view.process || view.process.exitCode !== null
      || view.process.signalCode !== null || view.process.killed || !view.browser.isConnected()
      || session.pages.get(view.pageId) !== view.page || view.page.isClosed() || view.page.context() !== view.context
      || view.page.mainFrame() !== view.mainFrame) throw new Error('NATIVE_BINDING_UNAVAILABLE');
  }
  assertOwnedLaunch(cap: OwnedBrowserLaunchCap): void {
    const launch = this.retainedLaunches.get(cap); if (!launch) throw new Error('NATIVE_BINDING_UNAVAILABLE');
    this.assertRetainedLaunch(launch);
  }
  inspectRetainedLaunch(cap: OwnedBrowserLaunchCap): RetainedOwnedLaunchView {
    this.assertOwnedLaunch(cap); return this.retainedLaunches.get(cap)!.view;
  }
  private assertInventoryObjects(inventory: EngineInventory): void {
    this.assertRetainedLaunch(inventory.launch);
    const { view } = inventory.launch;
    const contexts = view.browser.contexts(), pages = view.context.pages(), frames = view.page.frames();
    if (contexts.length !== 1 || contexts[0] !== view.context || pages.length !== 1 || pages[0] !== view.page
      || inventory.launch.session.pages.size !== 1 || frames.length !== 1 || frames[0] !== view.mainFrame) {
      inventory.invalidate(); throw new Error('NATIVE_BINDING_UNAVAILABLE');
    }
    if (inventory.dirty || inventory.disposed) throw new Error('NATIVE_BINDING_UNAVAILABLE');
  }
  /** Watches are installed before measurement; a changed inventory is terminal, never silently rebaselined. */
  async captureExclusiveEngineInventory(cap: OwnedBrowserLaunchCap, onInvalidated?: () => void): Promise<OwnedEngineInventoryCap> {
    this.assertOwnedLaunch(cap); const launch = this.retainedLaunches.get(cap)!;
    if (launch.inventoryIssued) throw new Error('NATIVE_BINDING_UNAVAILABLE');
    launch.inventoryIssued = true;
    return this.captureInventory(launch, onInvalidated);
  }
  private async captureInventory(launch: RetainedLaunch, onInvalidated?: () => void): Promise<OwnedEngineInventoryCap> {
    const issued = this.issuedLaunches.get(launch.session)!;
    if (issued.newContext === issued.originalNewContext && issued.newPage === issued.originalNewPage) {
      const store = this;
      const invalidate = () => { for (const current of store.liveInventories) if (current.launch.session === launch.session) current.invalidate(); };
      issued.browser.newContext = function(this: Browser, ...args: Parameters<Browser['newContext']>) { invalidate(); return issued.originalNewContext.apply(this, args); };
      issued.browser.newPage = function(this: Browser, ...args: Parameters<Browser['newPage']>) { invalidate(); return issued.originalNewPage.apply(this, args); };
      issued.newContext = issued.browser.newContext; issued.newPage = issued.browser.newPage;
    }
    const inventoryCap = Object.freeze(Object.create(null)) as OwnedEngineInventoryCap;
    const inventory: EngineInventory = { cap: inventoryCap, launch, inventoryEpoch: randomUUID(), dirty: false, disposed: false,
      channels: [], cleanup: [], invalidate: () => {
        if (inventory.disposed) return;
        const transition = inventory.transition;
        if (transition && transition.state !== 'failed' && transition.state !== 'disposed') transition.state = 'failed';
        else if (inventory.dirty) return;
        inventory.dirty = true;
        try { onInvalidated?.(); } catch { /* Callback failure cannot restore source authority. */ }
      } };
    this.engineInventories.set(inventoryCap, inventory); this.liveInventories.add(inventory);
    const { view } = launch;
    const subscribe = (emitter: any, event: string, listener: (...args: any[]) => void) => {
      emitter.on(event, listener); inventory.cleanup.push(() => emitter.removeListener(event, listener));
    };
    // These object events cover pre-CDP acquisition; CDP covers all engine targets, including unknown contexts/workers.
    for (const [emitter, events] of [[view.process, ['exit', 'error', 'disconnect']], [view.browser, ['disconnected']],
      [view.context, ['page', 'close', 'serviceworker']], [view.page, ['close', 'crash', 'popup', 'frameattached', 'framedetached', 'framenavigated']]] as const) {
      for (const event of events) subscribe(emitter, event, event === 'framenavigated' ? (frame: Frame) => {
        const transition = inventory.transition;
        if (transition?.state === 'retired' && Date.now() <= (transition.armedDeadline ?? transition.expected.deadline) && frame === view.mainFrame && frame.url() === transition.expected.url) return;
        inventory.invalidate();
      } : inventory.invalidate);
    }
    try {
      this.assertInventoryObjects(inventory);
      const browserChannel = await view.browser.newBrowserCDPSession(); inventory.channels.push(browserChannel);
      subscribe(browserChannel, 'Disconnected', inventory.invalidate);
      const initialTargets = new Map<string, string>();
      subscribe(browserChannel, 'Target.targetCreated', ({ targetInfo }: any) => {
        // Discovery emits existing targets. Only the exact initial target identities may be replayed once as discovery.
        if (!initialTargets.has(targetInfo.targetId) || initialTargets.get(targetInfo.targetId) !== JSON.stringify(targetInfo)) inventory.invalidate();
      });
      for (const event of ['Target.targetDestroyed', 'Target.attachedToTarget', 'Target.detachedFromTarget']) subscribe(browserChannel, event, inventory.invalidate);
      subscribe(browserChannel, 'Target.targetInfoChanged', ({ targetInfo }: any) => {
        const transition = inventory.transition;
        if (transition?.state === 'retired' && Date.now() <= (transition.armedDeadline ?? transition.expected.deadline) && targetInfo.targetId === inventory.view?.targetId) {
          const original = JSON.parse(initialTargets.get(targetInfo.targetId) ?? 'null');
          if (original && [original.url, transition.expected.url].includes(targetInfo.url)) {
            const normalize = (info: any) => { const { url, title, ...identity } = info; return JSON.stringify(identity); };
            if (normalize(original) === normalize(targetInfo)) return;
          }
        }
        inventory.invalidate();
      });
      const initial = await browserChannel.send('Target.getTargets');
      const initialContexts = await browserChannel.send('Target.getBrowserContexts');
      for (const target of initial.targetInfos) initialTargets.set(target.targetId, JSON.stringify(target));
      await browserChannel.send('Target.setDiscoverTargets', { discover: true });
      this.assertInventoryObjects(inventory);
      const pageChannel = await view.context.newCDPSession(view.page); inventory.channels.push(pageChannel);
      subscribe(pageChannel, 'Disconnected', inventory.invalidate);
      for (const event of ['Page.frameAttached', 'Page.frameDetached', 'Page.navigatedWithinDocument', 'Inspector.targetCrashed', 'Inspector.detached']) subscribe(pageChannel, event, inventory.invalidate);
      subscribe(pageChannel, 'Page.frameRequestedNavigation', (event: any) => {
        const transition = inventory.transition;
        if (transition?.state !== 'prepared' || !transition.armedDeadline || Date.now() > transition.armedDeadline || event.frameId !== transition.expected.frameId
          || event.url !== transition.expected.url || event.reason !== transition.expected.reason || event.disposition !== 'currentTab') { inventory.invalidate(); return; }
        transition.state = 'retired'; inventory.dirty = true;
        try { transition.onRetired(); } catch { inventory.invalidate(); }
      });
      subscribe(pageChannel, 'Page.frameStartedLoading', (event: any) => {
        const transition = inventory.transition;
        if (transition?.state === 'retired' && !transition.loadingStarted && Date.now() <= (transition.armedDeadline ?? transition.expected.deadline) && event.frameId === transition.expected.frameId) {
          transition.loadingStarted = true; return;
        }
        inventory.invalidate();
      });
      subscribe(pageChannel, 'Page.frameNavigated', (event: any) => {
        const transition = inventory.transition, frame = event.frame;
        if (transition?.state === 'retired' && Date.now() <= (transition.armedDeadline ?? transition.expected.deadline) && frame.id === transition.expected.frameId && !frame.parentId
          && frame.url === transition.expected.url && frame.loaderId && frame.loaderId !== transition.expected.loaderId && !transition.newLoader) {
          transition.newLoader = frame.loaderId; return;
        }
        inventory.invalidate();
      });
      await pageChannel.send('Page.enable');
      const target = await pageChannel.send('Target.getTargetInfo');
      const tree = await pageChannel.send('Page.getFrameTree');
      const complete = await browserChannel.send('Target.getTargets');
      const completeContexts = await browserChannel.send('Target.getBrowserContexts');
      const pageTargets = complete.targetInfos.filter((info) => info.type === 'page');
      if (initialContexts.browserContextIds.length !== 1 || completeContexts.browserContextIds.length !== 1
        || initialContexts.browserContextIds[0] !== completeContexts.browserContextIds[0]
        || target.targetInfo.browserContextId !== completeContexts.browserContextIds[0]
        || complete.targetInfos.length !== initial.targetInfos.length || complete.targetInfos.some(info => initialTargets.get(info.targetId) !== JSON.stringify(info))
        || pageTargets.length !== 1 || pageTargets[0].targetId !== target.targetInfo.targetId
        || complete.targetInfos.some(info => !['browser', 'page'].includes(info.type)) || tree.frameTree.childFrames?.length
        || tree.frameTree.frame.parentId || !tree.frameTree.frame.id || !tree.frameTree.frame.loaderId) inventory.invalidate();
      this.assertInventoryObjects(inventory);
      inventory.view = Object.freeze({ launchEpoch: view.launchEpoch, inventoryEpoch: inventory.inventoryEpoch,
        observedAt: new Date().toISOString(), contextCount: 1, pageCount: 1, frameCount: 1, targetId: target.targetInfo.targetId,
        frameId: tree.frameTree.frame.id, loaderId: tree.frameTree.frame.loaderId,
        targetTypes: Object.freeze(complete.targetInfos.map(info => info.type).sort()), dirty: false,
        nativeBindingStatus: 'unavailable', nativePhysicalProof: false });
      return inventoryCap;
    } catch {
      inventory.invalidate(); await this.disposeExclusiveEngineInventory(inventoryCap); throw new Error('NATIVE_BINDING_UNAVAILABLE');
    }
  }
  assertExclusiveEngineInventory(cap: OwnedEngineInventoryCap): void {
    const inventory = this.engineInventories.get(cap); if (!inventory?.view) throw new Error('NATIVE_BINDING_UNAVAILABLE');
    this.assertInventoryObjects(inventory);
  }
  inspectExclusiveEngineInventory(cap: OwnedEngineInventoryCap): OwnedEngineInventoryView {
    this.assertExclusiveEngineInventory(cap); return this.engineInventories.get(cap)!.view!;
  }
  armExclusiveEngineTransition(launchCap: OwnedBrowserLaunchCap, inventoryCap: OwnedEngineInventoryCap,
    expected: Readonly<{ frameId: string; loaderId: string; url: string; reason: 'formSubmissionGet' | 'anchorClick'; deadline: number }>,
    onRetired: () => void): OwnedEngineTransitionCap {
    this.assertOwnedLaunch(launchCap); this.assertExclusiveEngineInventory(inventoryCap);
    const inventory = this.engineInventories.get(inventoryCap)!, launch = this.retainedLaunches.get(launchCap)!;
    this.inspectNativeContext(launch.session);
    if (inventory.launch !== launch || inventory.transition || inventory.view?.frameId !== expected.frameId || inventory.view.loaderId !== expected.loaderId
      || !['formSubmissionGet', 'anchorClick'].includes(expected.reason) || !Number.isFinite(expected.deadline) || expected.deadline <= Date.now()
      || expected.deadline > Date.now() + 30000 || typeof onRetired !== 'function') throw new Error('NATIVE_BINDING_UNAVAILABLE');
    const url = new URL(expected.url); if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('NATIVE_BINDING_UNAVAILABLE');
    const cap = Object.freeze(Object.create(null)) as OwnedEngineTransitionCap;
    const transition: EngineTransition = { inventory, launch, expected: Object.freeze({ ...expected }), onRetired, state: 'prepared', successorClaimed: false };
    inventory.transition = transition; this.engineTransitions.set(cap, transition); return cap;
  }
  activateOwnedEngineTransition(cap: OwnedEngineTransitionCap, deadline: number): void {
    this.assertOwnedEngineTransition(cap); const transition = this.engineTransitions.get(cap)!;
    if (transition.state !== 'prepared' || transition.armedDeadline || !Number.isFinite(deadline) || deadline <= Date.now()
      || deadline > transition.expected.deadline || deadline > Date.now() + 1000) throw new Error('NATIVE_BINDING_UNAVAILABLE');
    transition.armedDeadline = deadline;
  }
  assertOwnedEngineTransition(cap: OwnedEngineTransitionCap): void {
    const transition = this.engineTransitions.get(cap);
    if (!transition || ['failed', 'disposed'].includes(transition.state) || Date.now() > (transition.armedDeadline ?? transition.expected.deadline)) throw new Error('NATIVE_BINDING_UNAVAILABLE');
    this.assertRetainedLaunch(transition.launch); this.inspectNativeContext(transition.launch.session);
    const { view } = transition.launch;
    if (view.browser.contexts().length !== 1 || view.context.pages().length !== 1 || view.context.pages()[0] !== view.page
      || view.page.frames().length !== 1 || view.page.mainFrame() !== view.mainFrame) { transition.inventory.invalidate(); throw new Error('NATIVE_BINDING_UNAVAILABLE'); }
  }
  async captureSuccessorEngineInventory(cap: OwnedEngineTransitionCap, onInvalidated?: () => void): Promise<OwnedEngineInventoryCap> {
    this.assertOwnedEngineTransition(cap); const transition = this.engineTransitions.get(cap)!;
    if (transition.state !== 'retired' || !transition.newLoader || transition.successorClaimed || transition.launch.view.page.url() !== transition.expected.url) throw new Error('NATIVE_BINDING_UNAVAILABLE');
    transition.successorClaimed = true;
    let successor: OwnedEngineInventoryCap | undefined;
    try {
      successor = await this.captureInventory(transition.launch, onInvalidated);
      this.assertOwnedEngineTransition(cap); const view = this.inspectExclusiveEngineInventory(successor);
      if (view.frameId !== transition.expected.frameId || view.targetId !== transition.inventory.view!.targetId || view.loaderId !== transition.newLoader) {
        await this.disposeExclusiveEngineInventory(successor); throw new Error('NATIVE_BINDING_UNAVAILABLE');
      }
      transition.state = 'successor'; await this.releaseInventory(transition.inventory, true); return successor;
    } catch (error) {
      transition.inventory.invalidate();
      if (successor) await this.disposeExclusiveEngineInventory(successor).catch(() => {});
      throw error;
    }
  }
  async disposeOwnedEngineTransition(cap: OwnedEngineTransitionCap): Promise<void> {
    const transition = this.engineTransitions.get(cap); if (!transition) throw new Error('NATIVE_BINDING_UNAVAILABLE');
    if (transition.state === 'disposed') return;
    if (transition.state !== 'successor') transition.inventory.invalidate();
    transition.state = 'disposed'; await this.releaseInventory(transition.inventory, true);
  }
  async disposeExclusiveEngineInventory(cap: OwnedEngineInventoryCap): Promise<void> {
    const inventory = this.engineInventories.get(cap); if (!inventory) throw new Error('NATIVE_BINDING_UNAVAILABLE');
    return this.releaseInventory(inventory, false);
  }
  private async releaseInventory(inventory: EngineInventory, retired: boolean): Promise<void> {
    if (inventory.disposed) return; if (!retired) inventory.invalidate(); inventory.disposed = true; this.liveInventories.delete(inventory);
    for (const cleanup of inventory.cleanup.splice(0)) cleanup();
    if (![...this.liveInventories].some(current => current.launch.session === inventory.launch.session)) {
      const issued = this.issuedLaunches.get(inventory.launch.session);
      if (issued) {
        if (issued.browser.newContext === issued.newContext) { issued.browser.newContext = issued.originalNewContext; issued.newContext = issued.originalNewContext; }
        if (issued.browser.newPage === issued.newPage) { issued.browser.newPage = issued.originalNewPage; issued.newPage = issued.originalNewPage; }
      }
    }
    await Promise.allSettled(inventory.channels.splice(0).map(channel => channel.detach()));
  }
  closureEvidence(id: string, owner: string): BrowserClosureEvidence | undefined { const value = this.closed.get(id); return value?.owner === owner ? { ...value } : undefined; }

  async close(id: string, owner: string): Promise<void> {
    const existing = this.closing.get(id); if (existing) { if (this.closed.get(id)?.owner !== owner) throw new Error('SESSION_EXPIRED'); return existing; }
    const session = this.sessions.get(id);
    if (!session) { if (this.closed.get(id)?.owner === owner) return; throw new Error('SESSION_EXPIRED'); }
    if (session.owner !== owner) throw new Error('SESSION_EXPIRED');
    for (const inventory of this.liveInventories) if (inventory.launch.session === session) {
      inventory.invalidate(); void this.disposeExclusiveEngineInventory(inventory.cap).catch(() => {});
    }
    const issued = this.issuedLaunches.get(session);
    if (issued) {
      if (session.browser.newContext === issued.newContext) session.browser.newContext = issued.originalNewContext;
      if (session.browser.newPage === issued.newPage) session.browser.newPage = issued.originalNewPage;
    }
    this.sessions.delete(id); const timer = this.timers.get(id); if (timer) clearTimeout(timer); this.timers.delete(id);
    const process = session.browserServer.process();
    const evidence: BrowserClosureEvidence = { sessionId: id, owner, pid: process.pid ?? 0, closedAt: new Date().toISOString(), processExited: false };
    this.closed.set(id, evidence); while (this.closed.size > 128) this.closed.delete(this.closed.keys().next().value!);
    const cleanup = (async () => {
      try { await boundedClose(session.context.close(), 3000); } catch { /* Server shutdown below also closes the owned context. */ }
      try { await boundedClose(session.browserServer.close(), 5000); } catch { await boundedClose(session.browserServer.kill(), 5000).catch(() => {}); }
      evidence.processExited = process.exitCode !== null || process.signalCode !== null;
      session.pages.clear(); session.artifacts.clear(); session.activeDocumentIds.clear(); session.generation += 1;
      if (!evidence.processExited) throw new Error('EFFECT_OUTCOME_UNKNOWN');
    })().finally(() => { this.closing.delete(id); });
    this.closing.set(id, cleanup); return cleanup;
  }
  async closeOwner(owner: string): Promise<void> {
    this.ownerEpochs.set(owner, (this.ownerEpochs.get(owner) ?? 0) + 1);
    await Promise.allSettled([...this.pendingCreates].filter(([, binding]) => binding === owner).map(([operation]) => operation));
    const results = await Promise.allSettled([...this.sessions.values()].filter((s) => s.owner === owner).map((s) => this.close(s.id, owner)));
    if (results.some((r) => r.status === 'rejected')) throw new Error('EFFECT_OUTCOME_UNKNOWN');
  }
  async closeAll(): Promise<void> {
    this.disposed = true; this.unsubscribe(); await Promise.allSettled([...this.pendingCreates.keys()]);
    const results = await Promise.allSettled([...this.sessions.values()].map((s) => this.close(s.id, s.owner)));
    if (results.some((r) => r.status === 'rejected')) throw new Error('EFFECT_OUTCOME_UNKNOWN');
  }
}
