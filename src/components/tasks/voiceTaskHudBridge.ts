import {VoiceHudEventReceiver} from '../../edith/voiceLiveClient';
import {hudPositiveInteger, hudSafeId} from '../../edith/taskHudContracts';
import type {createTaskActivityObserver} from './TaskActivityProvider';
import type {TaskHudIntent} from './taskHudProjection';

/** A local presentation consumer, with no task execution or voice/audio authority. */
export function createVoiceTaskHudBridge(deps: {
  observer: ReturnType<typeof createTaskActivityObserver>;
  present(intent: TaskHudIntent): void;
  isCurrent?(): boolean;
}) {
  type Binding = {session: string; generation: number; scope: number; workspace: string; current(): boolean};
  let binding: Binding | undefined, unsubscribe: (() => void) | undefined;
  let pendingReady: {session: string; generation: number; current(): boolean} | undefined;
  let read: {cancel(clearSelection?: boolean): void} | undefined, command = 0;
  const current = () => {
    const snapshot = deps.observer.getSnapshot();
    return !!binding && (deps.isCurrent?.() ?? true) && binding.current()
      && snapshot.scopeGeneration === binding.scope && snapshot.workspaceId === binding.workspace;
  };
  const clear = () => {
    const hadBinding = !!binding;
    binding = undefined; pendingReady = undefined; command++; receiver.clear();
    unsubscribe?.(); unsubscribe = undefined;
    read?.cancel(); read = undefined;
    if (hadBinding && (deps.isCurrent?.() ?? true)) deps.present({kind: 'hide', origin: 'voice'});
  };
  const canonical = (target?: {taskId: string; revision: number; eventSequence: number}) => {
    const captured = binding, token = ++command;
    read?.cancel(!!target); read = undefined;
    const valid = () => binding === captured && command === token && current();
    if (!valid()) return;
    read = deps.observer.readCanonical(target, valid);
    if (valid()) deps.present({kind: 'show', origin: 'voice'});
    else {read.cancel();read = undefined;}
  };
  const receiver = new VoiceHudEventReceiver({
    onTaskAdmitted: event => canonical({taskId: event.taskId, revision: event.revision, eventSequence: event.eventSequence}),
    onPresentation: event => {
      if (event.action === 'show_current') canonical();
      else {command++;read?.cancel(false);if (current()) deps.present({kind: 'hide', origin: 'voice'});}
    },
  });
  const activate = (session: string, generation: number, ownsReady: () => boolean): boolean => {
    const snapshot = deps.observer.getSnapshot();
    if (!(deps.isCurrent?.() ?? true) || !ownsReady() || !hudSafeId(snapshot.workspaceId) || !receiver.bindSession(session, generation)) return false;
    binding = {session, generation, current: ownsReady, workspace: snapshot.workspaceId, scope: snapshot.scopeGeneration};
    unsubscribe = deps.observer.subscribe(() => {if (!current()) clear();});
    return true;
  };
  return {
    /** Caller must first accept the actual ready through its local session gate.
     * Workspace is correlation only; scoped canonical reads still authorize. */
    bindReady: (session: string, generation: number, ownsReady: () => boolean): boolean => {
      if (binding?.session === session && binding.generation === generation && current()) return true;
      clear();
      const snapshot = deps.observer.getSnapshot();
      if (!(deps.isCurrent?.() ?? true) || !ownsReady() || !hudSafeId(session) || !hudPositiveInteger(generation)) return false;
      // A genuine ready can precede the first workspace bootstrap. Retain only
      // that gated candidate, never a binding invalidated by a known scope.
      if (!snapshot.workspaceId && snapshot.scopeGeneration === 0 && snapshot.state === 'loading') {
        pendingReady = {session, generation, current: ownsReady};
        unsubscribe = deps.observer.subscribe(() => {
          const candidate = pendingReady;
          if (!candidate) return;
          if (!(deps.isCurrent?.() ?? true) || !candidate.current()) {clear();return;}
          const next = deps.observer.getSnapshot();
          if (hudSafeId(next.workspaceId)) {
            pendingReady = undefined;unsubscribe?.();unsubscribe = undefined;
            activate(candidate.session, candidate.generation, candidate.current);
          } else if (next.scopeGeneration !== 0 || next.state === 'error') clear();
        });
        return false;
      }
      return activate(session, generation, ownsReady);
    },
    receive: (value: unknown): boolean => {
      if (pendingReady && (deps.isCurrent?.() ?? true) && pendingReady.current()) return false;
      if (!current()) {clear();return false;}
      return receiver.receive(value);
    },
    clear,
  };
}
