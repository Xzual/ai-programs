import type { Page } from 'playwright';
import { BrowserSessionStore, type OwnedBrowserProcessMetadata, type OwnedBrowserSession,
  type OwnedBrowserLaunchCap, type OwnedEngineInventoryCap } from './browserSessionStore';

export interface OwnedBrowserDomSnapshot<T> {
  ownedProcess: OwnedBrowserProcessMetadata;
  pageId: string;
  observedAt: string;
  dom: T;
  inputProvenance: 'dom_api';
  nativePhysicalProof: false;
  nativeBindingStatus: 'unavailable';
}

/** Read-only ownership/DOM metadata, with no HWND/UIA/physical-coordinate claims. */
export class BrowserNativeLeaseBridge {
  constructor(private readonly sessions: BrowserSessionStore) {}
  // Private source integration only. These methods require store-issued object membership;
  // no structural DTO, PID, DOM snapshot or native claim is an authority constructor.
  retainOwnedLaunch(session: OwnedBrowserSession, pageId: string, page: Page): OwnedBrowserLaunchCap {
    return this.sessions.retainOwnedLaunch(session, pageId, page);
  }
  inspectRetainedLaunch(cap: OwnedBrowserLaunchCap) { return this.sessions.inspectRetainedLaunch(cap); }
  assertOwnedLaunch(cap: OwnedBrowserLaunchCap): void { this.sessions.assertOwnedLaunch(cap); }
  captureExclusiveEngineInventory(cap: OwnedBrowserLaunchCap, onInvalidated?: () => void): Promise<OwnedEngineInventoryCap> {
    return this.sessions.captureExclusiveEngineInventory(cap, onInvalidated);
  }
  inspectExclusiveEngineInventory(cap: OwnedEngineInventoryCap) { return this.sessions.inspectExclusiveEngineInventory(cap); }
  assertExclusiveEngineInventory(cap: OwnedEngineInventoryCap): void { this.sessions.assertExclusiveEngineInventory(cap); }
  disposeExclusiveEngineInventory(cap: OwnedEngineInventoryCap): Promise<void> { return this.sessions.disposeExclusiveEngineInventory(cap); }
  inspectOwned(sessionId: string, owner: string) {
    return { ...this.sessions.inspectOwned(sessionId, owner), nativeBindingStatus: 'unavailable', nativePhysicalProof: false } as const;
  }
  async snapshot<T>(sessionId: string, owner: string, pageId: string, readDom: (page: Page) => Promise<T>): Promise<OwnedBrowserDomSnapshot<T>> {
    const session = this.sessions.get(sessionId, owner);
    const page = session.pages.get(pageId);
    if (!page || page.isClosed()) throw new Error('PAGE_NOT_FOUND');
    const dom = await readDom(page);
    if (this.sessions.get(sessionId, owner) !== session || session.pages.get(pageId) !== page || page.isClosed()) throw new Error('TARGET_CONTEXT_CHANGED');
    return { ownedProcess: this.sessions.inspectOwned(sessionId, owner), pageId, observedAt: new Date().toISOString(), dom, inputProvenance: 'dom_api', nativePhysicalProof: false, nativeBindingStatus: 'unavailable' };
  }
}
