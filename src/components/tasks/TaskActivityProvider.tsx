import React from 'react';
import {
  fetchTaskHudActivityV1, fetchTaskHudListV1, isNetworkTaskError, TaskContractError,
  type TaskActivityV2View, type TaskSurfaceState, type TaskV2View,
} from '../../edith/taskActivityClient';
import type {TaskHudIntent, TaskHudSelection} from './taskHudProjection';
import {fetchTaskHudWorkspaceId} from './taskHudWorkspaceScope';

export type TaskActivitySnapshot = {
  state: TaskSurfaceState; tasks: TaskV2View[]; activity?: TaskActivityV2View;
  selection: TaskHudSelection; error: string; lastSuccessfulReadAt?: number; now: number;
  workspaceId?: string; scopeGeneration: number;
};
type ReadDependencies = {
  readEnabled: boolean;
  readWorkspace(signal: AbortSignal): Promise<string | undefined>;
  readList(signal: AbortSignal, workspaceId: string): Promise<TaskV2View[]>;
  readActivity(taskId: string, signal: AbortSignal, workspaceId: string): Promise<TaskActivityV2View>;
  onScopeChange?(): void;
  now(): number;
  setInterval(callback: () => void, milliseconds: number): unknown;
  clearInterval(timer: unknown): void;
};

/** Read-request ownership only. No execution, presentation or native authority. */
export function createTaskActivityObserver(deps: ReadDependencies) {
  const listeners = new Set<() => void>();
  let started = false, epoch = 0, request: AbortController | undefined, timer: unknown;
  let automaticId: string | undefined;
  let workspaceId: string | undefined, scopeKnown = false, scopeGeneration = 0;
  type Locator = {target?: {taskId: string; revision: number; eventSequence: number}; valid(): boolean; pending: boolean; scope: number};
  let locator: Locator | undefined;
  let selectionEpoch = 0;
  let fences = new Map<string, {revision: number; sequence: number; fingerprint: string}>();
  const initial = (): TaskActivitySnapshot => ({state: deps.readEnabled ? 'loading' : 'error', tasks: [], selection: {kind: 'automatic'},
    error: deps.readEnabled ? '' : 'Görev okuma yetkisi henüz doğrulanmadı.', now: deps.now(), scopeGeneration});
  let snapshot = initial();
  const publish = (next: TaskActivitySnapshot) => {snapshot = next; for (const listener of listeners) listener();};
  const invalidate = () => {epoch++; request?.abort(); request = undefined;};
  const replaceScope = (id: string | undefined) => {
    if (scopeKnown && workspaceId === id) return;
    const first = !scopeKnown, selection = snapshot.selection;
    scopeKnown = true; workspaceId = id; scopeGeneration++; fences.clear(); automaticId = undefined;
    publish({...initial(), workspaceId, selection: first && id ? selection : {kind: 'automatic'},
      state: id ? 'loading' : 'error', error: id ? '' : 'Çalışma alanı yapılandırılmadı.'});
    if (!first || !id) deps.onScopeChange?.();
  };
  const fingerprint = (task: TaskV2View) => JSON.stringify({id: task.id, title: task.title, status: task.status,
    plan: task.plan?.steps.map(step => ({id: step.id, title: step.title, status: step.status})),
    progress: task.progress, verification: task.verification});
  const checkVersion = (task: TaskV2View, next: typeof fences) => {
    const value = {revision: task.revision, sequence: task.eventSequence, fingerprint: fingerprint(task)}, prior = next.get(task.id);
    if (prior && (value.revision < prior.revision || value.sequence < prior.sequence
      || value.revision === prior.revision && (value.sequence !== prior.sequence || value.fingerprint !== prior.fingerprint))) {
      throw new TaskContractError('Görev anlık görüntüleri çelişiyor; durum yeniden doğrulanmalı.', 'TASK_SNAPSHOT_CONFLICT');
    }
    next.set(task.id, value);
  };
  const refresh = async (background = true): Promise<void> => {
    if (!started || !deps.readEnabled) return;
    invalidate(); const token = epoch, controller = new AbortController(); request = controller;
    const ownedLocator = locator;
    const current = () => started && token === epoch && request === controller && !controller.signal.aborted
      && (!ownedLocator || locator === ownedLocator && ownedLocator.valid());
    const recovering = snapshot.state === 'offline';
    if (recovering) {publish({...initial(), workspaceId, scopeGeneration});deps.onScopeChange?.();}
    publish({...snapshot, state: background && snapshot.lastSuccessfulReadAt !== undefined ? 'reconnecting' : 'loading', error: '', now: deps.now()});
    try {
      const expectedWorkspace = await deps.readWorkspace(controller.signal);
      if (!current()) return;
      replaceScope(expectedWorkspace);
      if (!current()) return;
      if (!expectedWorkspace) throw new TaskContractError('Çalışma alanı yapılandırılmadı.', 'TASK_HUD_WORKSPACE_REQUIRED');
      const expectedGeneration = scopeGeneration, selection = snapshot.selection;
      const tasks = await deps.readList(controller.signal, expectedWorkspace);
      if (!current()) return;
      if (tasks.length > 512 || new Set(tasks.map(task => task.id)).size !== tasks.length) throw new TaskContractError('Görev listesi görüntüleme sınırlarıyla eşleşmiyor.', 'TASK_LIST_INVALID');
      const nextFences = new Map(fences);
      for (const task of tasks) checkVersion(task, nextFences);
      const sticky = tasks.find(task => task.id === automaticId && !task.progress.terminal);
      const selected = ownedLocator?.target ? tasks.find(task => task.id === ownedLocator.target!.taskId)
        : selection.kind === 'explicit' ? tasks.find(task => task.id === selection.taskId)
        : selection.kind === 'awaiting-task-link' ? undefined : sticky ?? tasks.find(task => !task.progress.terminal) ?? tasks[0];
      if ((selection.kind === 'explicit' || ownedLocator?.target) && !selected) throw new TaskContractError('Seçilen görev kullanılamıyor.', 'TASK_SELECTION_UNAVAILABLE');
      const activity = selected ? await deps.readActivity(selected.id, controller.signal, expectedWorkspace) : undefined;
      if (!current()) return;
      if (activity && activity.task.id !== selected?.id) throw new TaskContractError('Görev yanıtı istenen kayıtla eşleşmiyor.', 'TASK_ACTIVITY_REQUEST_MISMATCH');
      if (activity) checkVersion(activity.task, nextFences);
      if (ownedLocator?.target && (!activity || activity.task.revision < ownedLocator.target.revision || activity.task.eventSequence < ownedLocator.target.eventSequence)) {
        throw new TaskContractError('Görev bağlantısı kanonik kayıtta doğrulanamadı.', 'TASK_LOCATOR_UNCONFIRMED');
      }
      // Recheck context after delayed list/activity bodies. This is still only
      // correlation: every task GET independently enforces server authority.
      const confirmedWorkspace = await deps.readWorkspace(controller.signal);
      if (!current()) return;
      if (confirmedWorkspace !== expectedWorkspace || expectedGeneration !== scopeGeneration) {replaceScope(confirmedWorkspace);return;}
      // Never evict a known version within an authority epoch: doing so would
      // permit an old row to be accepted when it reappears. Fail closed at cap.
      if (nextFences.size > 512) throw new TaskContractError('Görev sürüm sınırı aşıldı; okuma kapsamı yeniden doğrulanmalı.', 'TASK_VERSION_FENCE_LIMIT');
      fences = nextFences;
      if (selection.kind === 'automatic') automaticId = selected?.id;
      const now = deps.now();
      if (ownedLocator) ownedLocator.pending = false;
      publish({state: tasks.length ? 'ready' : 'empty', tasks, activity,
        selection: ownedLocator?.target && activity ? {kind: 'explicit', taskId: activity.task.id} : selection,
        error: '', lastSuccessfulReadAt: now, now, workspaceId, scopeGeneration});
    } catch (cause) {
      if (!current()) return;
      const code = cause instanceof TaskContractError ? cause.code : '';
      if (['TASK_HTTP_401', 'TASK_HTTP_403', 'TASK_HUD_FORBIDDEN'].includes(code)) {
        locator = undefined;
        scopeGeneration++; workspaceId = undefined; scopeKnown = false; fences.clear(); automaticId = undefined;
        publish({...initial(), state: 'error', error: 'Görev okuma yetkisi doğrulanamadı.'});deps.onScopeChange?.();return;
      }
      if (isNetworkTaskError(cause)) {publish({...snapshot, state: 'offline', error: 'Bağlantı yok; gösterilen bilgiler önceki kontrolden.', now: deps.now()});return;}
      const error = cause instanceof TaskContractError && cause.code === 'TASK_SELECTION_UNAVAILABLE' ? 'Seçilen görev kullanılamıyor.'
        : cause instanceof TaskContractError && cause.code === 'TASK_SNAPSHOT_CONFLICT' ? 'Görev verisi çelişkili; durum doğrulanamadı.'
        : code === 'TASK_HUD_WORKSPACE_REQUIRED' ? 'Çalışma alanı yapılandırılmadı.'
        : code === 'TASK_HUD_WORKSPACE_INVALID' ? 'Çalışma alanı bağlamı doğrulanamadı.'
        : 'Görev durumu doğrulanamadı. Durumu yeniden kontrol edin.';
      publish({...snapshot, state: 'error', tasks: [], activity: undefined, error, now: deps.now(),
        ...(code === 'TASK_HUD_WORKSPACE_INVALID' ? {workspaceId: undefined, lastSuccessfulReadAt: undefined} : {})});
    }
  };
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {listeners.add(listener); return () => {listeners.delete(listener);};},
    refresh,
    /** A voice hint locates a canonical record; it never supplies task facts or
     * grants read authority. Cancellation owns only this selection/read epoch. */
    readCanonical: (target: Locator['target'], valid: () => boolean) => {
      const owned: Locator = {target, valid, pending: true, scope: scopeGeneration};
      let selectionToken = -1;
      const cancel = (clearSelection = true) => {
        if (locator !== owned && (!clearSelection || selectionToken !== selectionEpoch)) return;
        locator = undefined;
        if (scopeGeneration !== owned.scope) return;
        invalidate();
        if (clearSelection || owned.pending) {selectionEpoch++;publish({...initial(), workspaceId, scopeGeneration});}
      };
      if (!started || !deps.readEnabled || !workspaceId || !valid()) return {cancel};
      const retainedSelection = !target && snapshot.selection.kind === 'explicit' ? snapshot.selection : {kind: 'automatic' as const};
      invalidate(); locator = owned; selectionToken = ++selectionEpoch;
      publish({...initial(), workspaceId, scopeGeneration, selection: target ? {kind: 'awaiting-task-link'} : retainedSelection});
      void refresh(false);
      return {cancel};
    },
    reconnect: async () => {
      if (!started || !deps.readEnabled) return;
      invalidate(); locator = undefined; selectionEpoch++; automaticId = undefined;
      publish({...initial(), workspaceId, scopeGeneration});deps.onScopeChange?.();
      await refresh(false);
    },
    select: async (selection: TaskHudSelection) => {
      selectionEpoch++;
      if (locator) {locator = undefined;invalidate();}
      if (JSON.stringify(selection) === JSON.stringify(snapshot.selection)) return;
      invalidate(); publish({...snapshot, state: deps.readEnabled ? 'loading' : 'error', tasks: [], activity: undefined, selection,
        lastSuccessfulReadAt: undefined, now: deps.now()});
      await refresh(false);
    },
    start: () => {
      if (started) return; started = true;
      if (!deps.readEnabled) {publish(initial()); return;}
      void refresh(false); timer = deps.setInterval(() => {void refresh(true);}, 12_000);
    },
    stop: () => {started = false; invalidate(); locator = undefined; selectionEpoch++; if (timer !== undefined) deps.clearInterval(timer); timer = undefined;
      fences.clear(); automaticId = undefined; workspaceId = undefined; scopeKnown = false; scopeGeneration++; publish(initial());},
  };
}

type TaskActivityContextValue = {
  snapshot: TaskActivitySnapshot;
  observer: ReturnType<typeof createTaskActivityObserver>;
  presentation?: {sequence: number; intent: TaskHudIntent};
  presentTaskHud(intent: TaskHudIntent): void;
};
const TaskActivityContext = React.createContext<TaskActivityContextValue | undefined>(undefined);

/** A retained search selection is presentation state from its originating
 * authority. It must not be replayed into a newly created observer. */
export function taskSearchSelectionForAuthority<T extends {scope: string}>(selection: T | undefined, selectedAuthority: string | undefined, currentAuthority: string): T | undefined {
  return selection?.scope === 'task' && selectedAuthority === currentAuthority ? selection : undefined;
}

/** Authentication gates bootstrap; actual scoped task GETs authorize each read.
 * Workspace metadata and credentialed fetch alone grant no read permission. */
export function TaskActivityProvider({children, authorityKey, readEnabled = false, onWorkspaceChange}: {children: React.ReactNode; authorityKey: string; readEnabled?: boolean; onWorkspaceChange?: () => void}) {
  const observer = React.useMemo(() => createTaskActivityObserver({readEnabled, readWorkspace: fetchTaskHudWorkspaceId,
    readList: (signal, workspace) => fetchTaskHudListV1(workspace, signal),
    readActivity: (id, signal, workspace) => fetchTaskHudActivityV1(id, workspace, signal), onScopeChange: onWorkspaceChange,
    now: Date.now, setInterval: (callback, milliseconds) => window.setInterval(callback, milliseconds), clearInterval: timer => window.clearInterval(timer as number)}), [authorityKey, readEnabled, onWorkspaceChange]);
  const snapshot = React.useSyncExternalStore(observer.subscribe, observer.getSnapshot, observer.getSnapshot);
  const [presentationState, setPresentation] = React.useState<{observer: typeof observer; scopeGeneration: number; value: NonNullable<TaskActivityContextValue['presentation']>}>();
  const presentation = presentationState?.observer === observer && presentationState.scopeGeneration === snapshot.scopeGeneration ? presentationState.value : undefined;
  const presentTaskHud = React.useCallback((intent: TaskHudIntent) => {
    if (observer.getSnapshot().scopeGeneration !== snapshot.scopeGeneration) return;
    setPresentation(current => ({observer, scopeGeneration: snapshot.scopeGeneration,
      value: {sequence: current?.observer === observer ? current.value.sequence + 1 : 1, intent}}));
  }, [observer, snapshot.scopeGeneration]);
  React.useEffect(() => {
    setPresentation(current => ({observer, scopeGeneration: snapshot.scopeGeneration,
      value: {sequence: current?.observer === observer ? current.value.sequence + 1 : 1, intent: {kind: 'hide', origin: 'voice'}}}));
  }, [observer, snapshot.scopeGeneration]);
  React.useEffect(() => {
    observer.start(); setPresentation(undefined);
    const logout = () => {observer.stop(); setPresentation(undefined);};
    const reconnect = () => {void observer.reconnect();};
    const resume = () => {if (document.visibilityState === 'visible') reconnect();};
    window.addEventListener('edith-owner-logout', logout); window.addEventListener('online', reconnect); document.addEventListener('visibilitychange', resume);
    return () => {window.removeEventListener('edith-owner-logout', logout); window.removeEventListener('online', reconnect); document.removeEventListener('visibilitychange', resume); observer.stop();};
  }, [observer]);
  return <TaskActivityContext.Provider value={{snapshot, observer, presentation, presentTaskHud}}>{children}</TaskActivityContext.Provider>;
}

export function useSharedTaskActivity() {
  const context = React.useContext(TaskActivityContext);
  if (!context) throw new Error('TaskActivityProvider is required.');
  return context;
}

/** Compatibility surface for capsule/mission/timeline: all read one observer. */
export function useTaskActivitySurface(requestedTaskId?: string, onClearRequestedSelection?: () => void, requestedSelectionKey?: string) {
  const {snapshot, observer} = useSharedTaskActivity();
  React.useEffect(() => {if (requestedTaskId) void observer.select({kind: 'explicit', taskId: requestedTaskId});}, [observer, requestedTaskId, requestedSelectionKey]);
  const selectTask = React.useCallback((taskId: string) => {onClearRequestedSelection?.();void observer.select({kind: 'explicit', taskId});}, [observer, onClearRequestedSelection]);
  const matches = !requestedTaskId || snapshot.activity?.task.id === requestedTaskId;
  return {...snapshot, state: matches ? snapshot.state : snapshot.state === 'error' ? 'error' : 'loading' as TaskSurfaceState,
    activity: matches ? snapshot.activity : undefined, lastCheckedAt: snapshot.lastSuccessfulReadAt === undefined ? undefined : new Date(snapshot.lastSuccessfulReadAt), refresh: observer.refresh, selectTask};
}
