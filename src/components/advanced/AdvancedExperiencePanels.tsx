import React from 'react';
import {
  Activity, AlertTriangle, ArchiveRestore, BatteryCharging, Bookmark, CheckCircle2, Clock3,
  Download, Eye, EyeOff, GitCompareArrows, History, Layers3, Pause, RefreshCw, Search,
  ShieldCheck, Square, Workflow, Zap,
} from 'lucide-react';
import type { PriorityTaskPolicyV2, RecentContextEventV2 } from '../../edith/contracts';
import {
  AdvancedExperienceClientError,
  cancelWatcher,
  fetchAdvancedExperience,
  mutateGhost,
  searchAdvancedHistory,
  setPriority,
  type AdvancedExperienceSnapshot,
} from '../../edith/advancedExperienceClient';
import { invokeDesktopCommand, isTauriShell } from '../../edith/desktopShell';

type SurfaceState = 'loading' | 'ready' | 'empty' | 'error' | 'configuration_required';
type AdvancedContextValue = {
  surface: SurfaceState;
  snapshot?: AdvancedExperienceSnapshot;
  errorCode?: string;
  lastCheckedAt?: string;
  refresh: () => Promise<void>;
};

const AdvancedContext = React.createContext<AdvancedContextValue | undefined>(undefined);

function recordCount(snapshot?: AdvancedExperienceSnapshot) {
  return snapshot ? Object.values(snapshot.state).reduce((sum, records) => sum + records.length, 0) : 0;
}

export function AdvancedExperienceProvider({ children }: { children: React.ReactNode }) {
  const [value, setValue] = React.useState<Omit<AdvancedContextValue, 'refresh'>>({ surface: 'loading' });
  const requestRef = React.useRef<AbortController>();
  const refresh = React.useCallback(async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    try {
      const snapshot = await fetchAdvancedExperience(controller.signal);
      setValue({ surface: recordCount(snapshot) ? 'ready' : 'empty', snapshot, lastCheckedAt: new Date().toISOString() });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      const code = error instanceof AdvancedExperienceClientError ? error.code : 'ADVANCED_STATE_UNAVAILABLE';
      setValue({ surface: code.includes('CONFIGURATION_REQUIRED') || code.includes('OWNER_SESSION') ? 'configuration_required' : 'error', errorCode: code, lastCheckedAt: new Date().toISOString() });
    }
  }, []);

  React.useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15_000);
    const clear = () => {
      requestRef.current?.abort();
      setValue({ surface: 'configuration_required', errorCode: 'OWNER_SESSION_CLEARED', lastCheckedAt: new Date().toISOString() });
    };
    window.addEventListener('edith-owner-logout', clear);
    return () => { window.clearInterval(timer); requestRef.current?.abort(); window.removeEventListener('edith-owner-logout', clear); };
  }, [refresh]);

  return <AdvancedContext.Provider value={{ ...value, refresh }}>{children}</AdvancedContext.Provider>;
}

export function useAdvancedExperience() {
  const context = React.useContext(AdvancedContext);
  if (!context) throw new Error('AdvancedExperienceProvider is required.');
  return context;
}

function badgeTone(value: string) {
  if (['completed', 'verified', 'active', 'runtime_verified'].includes(value)) return 'border-emerald-400/25 bg-emerald-400/8 text-emerald-200';
  if (['failed', 'expired', 'cancelled', 'stopped'].includes(value)) return 'border-red-400/25 bg-red-400/8 text-red-200';
  if (value.includes('configuration_required') || value.includes('partial') || value.includes('memory_only') || value.includes('not_connected')) return 'border-amber-400/25 bg-amber-400/8 text-amber-200';
  return 'border-cyan-400/20 bg-cyan-400/6 text-cyan-100';
}

function Badge({ value }: { value: string }) {
  return <span className={`rounded-md border px-2 py-1 font-mono text-[9px] uppercase ${badgeTone(value)}`}>{value.replaceAll('_', ' ')}</span>;
}

function Panel({ title, icon, children, className = '' }: { title: string; icon: React.ReactNode; children: React.ReactNode; className?: string }) {
  return <section className={`min-w-0 rounded-lg border border-white/10 bg-slate-950/55 p-4 ${className}`}><header className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-100">{icon}{title}</header>{children}</section>;
}

function Empty({ text }: { text: string }) {
  return <p className="rounded-md border border-dashed border-white/10 p-3 text-xs leading-5 text-slate-500">{text}</p>;
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="flex items-start justify-between gap-3 border-b border-white/5 py-2 text-xs last:border-0"><span className="text-slate-500">{label}</span><span className="max-w-[65%] text-right text-slate-200">{value}</span></div>;
}

function formatBytes(value: number) {
  if (!Number.isFinite(value)) return 'unavailable';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let next = Math.max(0, value); let unit = 0;
  while (next >= 1024 && unit < units.length - 1) { next /= 1024; unit += 1; }
  return `${next.toFixed(unit ? 1 : 0)} ${units[unit]}`;
}

function formatTime(value?: string) {
  if (!value) return 'unavailable';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'unavailable' : date.toLocaleString('tr-TR');
}

function isFresh(expiresAt?: string) {
  return !expiresAt || Date.parse(expiresAt) > Date.now();
}

export function AdvancedCapsuleContext() {
  const { snapshot, surface } = useAdvancedExperience();
  const selection = snapshot?.state['capsule-selection'].filter((item) => isFresh(item.selected.expiresAt)).sort((a, b) => b.revision - a.revision)[0];
  if (!selection) return <span className="text-[10px] text-slate-600">Auto-context: {surface === 'loading' ? 'checking' : 'no current candidate'}</span>;
  return <span className="truncate text-[10px] text-cyan-200" title="Deterministic server-selected capsule context">Context {selection.deterministicRank}/5 · {selection.selected.safeLabel}</span>;
}

export function AdvancedStatusSummary() {
  const { surface, snapshot, errorCode, lastCheckedAt, refresh } = useAdvancedExperience();
  return <Panel title="Advanced Experience Truth" icon={<Layers3 className="h-4 w-4 text-cyan-300" />}>
    <div className="mb-3 flex flex-wrap gap-2">
      <Badge value={snapshot?.status.persistence ?? surface} />
      <Badge value={`restart_${snapshot?.status.restartRecovery ?? 'unknown'}`} />
      <Badge value={`native_${snapshot?.status.nativeExecution ?? 'unavailable'}`} />
      <Badge value={`watcher_${snapshot?.status.watcherDelivery ?? 'unavailable'}`} />
    </div>
    <Metric label="Records" value={recordCount(snapshot)} />
    <Metric label="Last checked" value={formatTime(lastCheckedAt)} />
    <Metric label="Error" value={errorCode ?? 'none'} />
    <button type="button" onClick={() => void refresh()} className="mt-3 flex items-center gap-2 rounded-md border border-white/10 px-3 py-2 text-xs text-slate-300 hover:bg-white/5"><RefreshCw className="h-3.5 w-3.5" />Refresh</button>
  </Panel>;
}

export function AdvancedExperienceWorkspace() {
  const { surface, snapshot, errorCode, refresh } = useAdvancedExperience();
  const [busy, setBusy] = React.useState<string>();
  const [actionError, setActionError] = React.useState<string>();
  const [query, setQuery] = React.useState('');
  const [history, setHistory] = React.useState<RecentContextEventV2[]>([]);
  const [nativeStatus, setNativeStatus] = React.useState<Record<string, unknown>>();
  const [shadowNativeState, setShadowNativeState] = React.useState<string>();
  const state = snapshot?.state;
  const shadow = state?.shadow.sort((a, b) => b.revision - a.revision)[0];

  React.useEffect(() => {
    if (!isTauriShell()) { setNativeStatus({ runtime: 'browser', advancedProducer: 'configuration_required' }); return; }
    void invokeDesktopCommand<Record<string, unknown>>('advanced_native_status').then((status) => setNativeStatus(status ?? { runtime: 'unavailable' })).catch(() => setNativeStatus({ runtime: 'unavailable' }));
  }, []);

  const action = async (id: string, operation: () => Promise<void>) => {
    setBusy(id); setActionError(undefined);
    try { await operation(); await refresh(); } catch (error) { setActionError(error instanceof AdvancedExperienceClientError ? error.code : 'ADVANCED_MUTATION_FAILED'); }
    finally { setBusy(undefined); }
  };

  const changePriority = (policy: PriorityTaskPolicyV2, priority: PriorityTaskPolicyV2['priority']) => snapshot && action(`priority:${policy.taskId}`, () => setPriority(snapshot.workspaceId, policy, priority));
  const search = async () => {
    if (!snapshot) return;
    setBusy('history'); setActionError(undefined);
    try { setHistory(await searchAdvancedHistory(snapshot.workspaceId, query)); } catch (error) { setActionError(error instanceof AdvancedExperienceClientError ? error.code : 'ADVANCED_HISTORY_FAILED'); }
    finally { setBusy(undefined); }
  };

  const setNativeShadow = async () => {
    if (!shadow || !isTauriShell()) return;
    const enabling = !shadow.enabled;
    setBusy('shadow-native'); setActionError(undefined);
    try {
      const result = await invokeDesktopCommand<Record<string, unknown>>('advanced_shadow_set', {
        request: {
          lineage: {
            contractVersion: shadow.contractVersion,
            amendment: shadow.amendment,
            ownerSessionBindingId: shadow.ownerSessionBindingId,
            workspaceId: shadow.workspaceId,
            revision: shadow.revision + 1,
            createdAt: shadow.createdAt,
            updatedAt: new Date().toISOString(),
            expiresAt: shadow.expiresAt,
          },
          enabled: enabling,
          explicitConsent: enabling,
        },
      });
      setShadowNativeState(result?.enabled === true ? 'metadata_only_active' : result?.cleared === true ? 'disabled_and_cleared' : 'unverified');
    } catch (error) { setActionError(error instanceof Error ? error.message : 'SHADOW_NATIVE_ACTION_FAILED'); }
    finally { setBusy(undefined); }
  };

  if (surface === 'loading') return <Panel title="Advanced Experience" icon={<Activity className="h-4 w-4 animate-pulse" />}><Empty text="Authoritative advanced state is loading." /></Panel>;
  if (!snapshot) return <Panel title="Advanced Experience" icon={<AlertTriangle className="h-4 w-4 text-amber-300" />}><Empty text={`Advanced state unavailable. ${errorCode ?? 'Owner session or workspace configuration is required.'}`} /><button onClick={() => void refresh()} className="mt-3 rounded-md border border-white/10 px-3 py-2 text-xs text-slate-300">Retry</button></Panel>;

  const power = state?.['power-presence'].filter((item) => isFresh(item.expiresAt)).sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt))[0];
  const communication = state?.communication.sort((a, b) => b.revision - a.revision)[0];
  const historyPolicy = state?.['history-policy'].sort((a, b) => b.revision - a.revision)[0];

  return <div className="space-y-4" data-testid="advanced-experience-workspace">
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-cyan-400/15 bg-cyan-400/[0.04] p-3">
      <Badge value={snapshot.status.persistence} /><Badge value={`restart_${snapshot.status.restartRecovery}`} /><Badge value={`native_${snapshot.status.nativeExecution}`} /><Badge value={`scheduler_${snapshot.status.scheduler}`} />
      <span className="ml-auto text-[10px] text-slate-500">No client-authored completion or verification</span>
    </div>
    {actionError && <div className="rounded-md border border-red-400/25 bg-red-400/8 p-3 text-xs text-red-200">Action not completed: {actionError}</div>}

    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 2xl:grid-cols-3">
      <Panel title="Priority & Ghost Tasks" icon={<Zap className="h-4 w-4 text-cyan-300" />}>
        {!state?.priority.length && !state?.ghosts.length && <Empty text="No priority policy or Ghost metadata is available." />}
        {state?.priority.map((policy) => <div key={policy.taskId} className="mb-3 rounded-md border border-white/8 p-3">
          <div className="flex items-center justify-between gap-2"><span className="truncate text-xs text-slate-200">{policy.taskId}</span><Badge value={policy.blockedByDependencies ? 'dependency_blocked' : policy.priority} /></div>
          <p className="mt-2 text-[10px] text-slate-500">Dependencies {policy.dependencyTaskIds.length} · atomic {String(policy.atomicOperation)} · security critical {String(policy.securityCritical)}</p>
          <div className="mt-3 grid grid-cols-3 gap-1">{(['LOW', 'NORMAL', 'HIGH'] as const).map((priority) => <button key={priority} disabled={busy === `priority:${policy.taskId}` || policy.priority === priority} onClick={() => void changePriority(policy, priority)} className="rounded border border-white/10 px-2 py-1.5 text-[10px] text-slate-300 disabled:opacity-40">{priority}</button>)}</div>
        </div>)}
        {state?.ghosts.map((ghost) => <div key={ghost.ghostTaskId} className="mb-2 rounded-md border border-white/8 p-3">
          <div className="flex items-center justify-between gap-2"><span className="text-xs text-slate-200">Task {ghost.taskId}</span><Badge value={ghost.status === 'configuration_required' ? 'partial_metadata' : ghost.status} /></div>
          <p className="mt-2 text-[10px] text-slate-500">{ghost.progressPercent}% reported · native executor {ghost.nativeExecution} · {ghost.reasonCode ?? 'no reason code'}</p>
          <div className="mt-3 flex gap-2"><button disabled={ghost.status !== 'active' || busy === ghost.ghostTaskId} onClick={() => void action(ghost.ghostTaskId, () => mutateGhost(snapshot.workspaceId, ghost.ghostTaskId, 'pause'))} className="flex items-center gap-1 rounded border border-white/10 px-2 py-1.5 text-[10px] disabled:opacity-35"><Pause className="h-3 w-3" />Pause</button><button disabled={['cancelled', 'completed', 'expired'].includes(ghost.status) || busy === ghost.ghostTaskId} onClick={() => void action(ghost.ghostTaskId, () => mutateGhost(snapshot.workspaceId, ghost.ghostTaskId, 'cancel'))} className="flex items-center gap-1 rounded border border-red-400/20 px-2 py-1.5 text-[10px] text-red-200 disabled:opacity-35"><Square className="h-3 w-3" />Cancel</button></div>
        </div>)}
      </Panel>

      <Panel title="Mission Memory & Outcomes" icon={<Workflow className="h-4 w-4 text-cyan-300" />}>
        {!state?.['mission-memories'].length && !state?.orchestration.length && <Empty text="No verified mission memory or orchestration evidence is retained." />}
        {state?.['mission-memories'].map((memory) => <div key={memory.memoryId} className="mb-3 rounded-md border border-white/8 p-3"><div className="flex justify-between gap-2"><span className="text-xs text-slate-200">Task {memory.sourceTaskId}</span><Badge value={memory.verificationStatus} /></div><p className="mt-2 text-xs leading-5 text-slate-400">{memory.routeSummary}</p><p className="mt-2 text-[10px] text-amber-200">Current state must be reverified before reuse.</p></div>)}
        {state?.orchestration.map((plan) => <div key={plan.planId} className="mb-3 rounded-md border border-white/8 p-3"><div className="flex justify-between gap-2"><span className="text-xs text-slate-200">{plan.objective}</span><Badge value={plan.status} /></div><ol className="mt-2 space-y-1">{plan.steps.map((step) => <li key={step.stepId} className="flex justify-between gap-2 text-[10px] text-slate-500"><span>{step.referenceId}</span><span>{step.status}</span></li>)}</ol><p className="mt-2 text-[10px] text-slate-600">Verified downstream results: {plan.verifiedDownstreamResultIds.length}</p></div>)}
      </Panel>

      <Panel title="Workspace, Bookmarks & Scenes" icon={<ArchiveRestore className="h-4 w-4 text-cyan-300" />}>
        {!state?.snapshots.length && !state?.bookmarks.length && !state?.scenes.length && <Empty text="No metadata snapshot, visual bookmark, or scene record is available." />}
        {state?.bookmarks.map((bookmark) => <React.Fragment key={bookmark.bookmarkId}><Metric label={`Bookmark · ${bookmark.appId}`} value={<><Badge value={bookmark.sensitiveAppBlocked ? 'sensitive_denied' : bookmark.screenshotPolicy} /><span className="mt-1 block text-[9px] text-slate-600">{formatTime(bookmark.capturedAt)}</span></>} /></React.Fragment>)}
        {state?.snapshots.map((snapshotRecord) => <React.Fragment key={snapshotRecord.snapshotId}><Metric label={snapshotRecord.label} value={`${snapshotRecord.items.length} metadata refs`} /></React.Fragment>)}
        {state?.['restore-plans'].map((plan) => <div key={plan.planId} className="mt-2 rounded-md border border-white/8 p-3"><div className="flex items-center justify-between gap-2"><span className="truncate text-xs text-slate-200">Restore {plan.snapshotId}</span><Badge value={plan.status} /></div><button type="button" disabled title="Restore requires a capability-ready native plan and owner approval." className="mt-2 rounded border border-white/10 px-2 py-1.5 text-[10px] text-slate-400 disabled:cursor-not-allowed disabled:opacity-35">Restore unavailable</button></div>)}
        {state?.scenes.map((scene) => <div key={scene.sceneId} className="mt-2 rounded-md border border-white/8 p-3"><div className="flex justify-between gap-2"><span className="text-xs text-slate-200">{scene.profile}</span><Badge value={scene.status} /></div><p className="mt-2 text-[10px] text-slate-500">{scene.changes.length} reversible changes · security notifications immutable</p></div>)}
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" disabled title="Game scene requires native capability and owner approval." className="rounded border border-white/10 px-2 py-1.5 text-[10px] text-slate-400 disabled:cursor-not-allowed disabled:opacity-35">Game unavailable</button>
          <button type="button" disabled title="Presentation scene requires native capability and owner approval." className="rounded border border-white/10 px-2 py-1.5 text-[10px] text-slate-400 disabled:cursor-not-allowed disabled:opacity-35">Presentation unavailable</button>
        </div>
        <p className="mt-2 text-[10px] text-amber-200">Scene controls remain disabled until native capability and owner approval are both available.</p>
      </Panel>

      <Panel title="Watchers & Downloads" icon={<Download className="h-4 w-4 text-cyan-300" />}>
        {!state?.watchers.length && !state?.downloads.length && <Empty text="No watcher metadata or trusted download telemetry is available." />}
        {state?.watchers.map((watcher) => <div key={watcher.watcherId} className="mb-3 rounded-md border border-white/8 p-3"><div className="flex justify-between gap-2"><span className="text-xs text-slate-200">{watcher.kind} · {watcher.trigger}</span><Badge value={watcher.status} /></div><p className="mt-2 text-[10px] text-slate-500">Delivery {watcher.delivery} · event based · expires {formatTime(watcher.expiresAt)}</p><button disabled={['cancelled', 'expired'].includes(watcher.status) || busy === watcher.watcherId} onClick={() => void action(watcher.watcherId, () => cancelWatcher(snapshot.workspaceId, watcher.watcherId))} className="mt-2 rounded border border-white/10 px-2 py-1.5 text-[10px] disabled:opacity-35">Cancel watcher</button></div>)}
        {state?.downloads.map((download) => <div key={download.downloadId} className="mb-3 rounded-md border border-white/8 p-3"><div className="flex justify-between gap-2"><span className="truncate text-xs text-slate-200">{download.displayName}</span><Badge value={download.status} /></div><p className="mt-2 text-[10px] text-slate-500">{formatBytes(download.bytesTransferred)} / {formatBytes(download.bytesTotal)} · remaining {formatBytes(download.remainingBytes)}</p><p className="mt-1 text-[10px] text-slate-600">Speed {download.speedBytesPerSecond ? `${formatBytes(download.speedBytesPerSecond)}/s` : 'unavailable'} · ETA {download.etaTrustworthy && download.etaSeconds !== undefined ? `${download.etaSeconds}s` : 'untrusted/unavailable'}</p></div>)}
      </Panel>

      <Panel title="Power, Presence & Communication" icon={<BatteryCharging className="h-4 w-4 text-cyan-300" />}>
        {power ? <><Metric label="Source" value={power.source} /><Metric label="Power" value={`${power.powerSource}${power.batteryPercent !== undefined ? ` · ${power.batteryPercent}%` : ''}`} /><Metric label="Presence" value={`${power.userPresence} · no camera`} /><Metric label="Observed" value={formatTime(power.observedAt)} /></> : <Empty text="Fresh trusted-native power/presence telemetry is unavailable. No camera presence is used." />}
        {communication ? <div className="mt-3 border-t border-white/8 pt-3"><Metric label="Brief" value={communication.autoBrief.enabled ? `${communication.autoBrief.maxSentences} sentence max` : 'off'} /><Metric label="Voice presence" value={communication.voicePresence.enabled ? communication.voicePresence.response : 'off'} /><Metric label="Voice summary" value="on demand · actual state only" /><Metric label="Smart silence" value="security alerts immutable" /></div> : <Empty text="Communication policy is not configured." />}
      </Panel>

      <Panel title="Compare, Retry, History & Shadow" icon={<GitCompareArrows className="h-4 w-4 text-cyan-300" />}>
        {state?.comparisons.map((comparison) => <div key={comparison.comparisonId} className="mb-3 rounded-md border border-white/8 p-3"><div className="flex justify-between"><span className="text-xs text-slate-200">{comparison.sourceType}</span><Badge value={comparison.provenance.verified ? 'verified_provenance' : 'unverified_provenance'} /></div><p className="mt-2 text-[10px] text-slate-500">+{comparison.added.length} · -{comparison.removed.length} · ~{comparison.changed.length}</p><p className="mt-1 text-[9px] text-slate-600">{formatTime(comparison.provenance.previousObservedAt)} → {formatTime(comparison.provenance.currentObservedAt)}</p></div>)}
        {state?.retries.map((retry) => <React.Fragment key={retry.retryId}><Metric label={`${retry.failureClass} · ${retry.attempts}/${retry.maxAttempts}`} value={<Badge value={`${retry.strategy}_${retry.status}`} />} /></React.Fragment>)}
        <div className="mt-3 rounded-md border border-white/8 p-3"><div className="flex justify-between gap-2"><span className="text-xs text-slate-200">Shadow Mode</span><Badge value={shadowNativeState ?? (shadow?.enabled ? 'metadata_only_opt_in' : 'disabled')} /></div><p className="mt-2 text-[10px] text-slate-500">No raw screen archive · suggestion only · disable clears native retained events.</p><button type="button" onClick={() => void setNativeShadow()} disabled={!isTauriShell() || !shadow || nativeStatus?.shadowMode !== 'metadata_only_opt_in' || busy === 'shadow-native'} title={!isTauriShell() ? 'Native Shadow controls are disabled in browser mode.' : !shadow ? 'A server-bound Shadow record is required.' : undefined} className="mt-2 flex items-center gap-1 rounded border border-white/10 px-2 py-1.5 text-[10px] disabled:opacity-35">{shadow?.enabled ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}{shadow?.enabled ? 'Disable & clear' : 'Enable with explicit consent'}</button></div>
        <div className="mt-3 flex gap-2"><div className="relative min-w-0 flex-1"><Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-slate-600" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Private history excluded" className="w-full rounded-md border border-white/10 bg-black/20 py-2 pl-8 pr-2 text-xs text-slate-200 outline-none" /></div><button onClick={() => void search()} disabled={busy === 'history'} className="rounded-md border border-white/10 px-3 text-xs">Search</button></div>
        <p className="mt-2 text-[10px] text-slate-600">Retention {historyPolicy?.retentionDays ?? 'unavailable'} days · private false · purged before {formatTime(historyPolicy?.purgedBefore)}</p>
        {history.length ? <div className="mt-2 space-y-1">{history.map((event) => <p key={event.eventId} className="rounded border border-white/8 p-2 text-[10px] text-slate-400">{event.kind} · {event.safeSummary} · {formatTime(event.occurredAt)}</p>)}</div> : <Empty text="No retained matching history. Empty does not imply hidden success." />}
      </Panel>
    </div>
    <div className="flex flex-wrap gap-3 text-[10px] text-slate-600"><span className="flex items-center gap-1"><ShieldCheck className="h-3 w-3" />Secrets, private paths, pixels and audio are not rendered.</span><span className="flex items-center gap-1"><Clock3 className="h-3 w-3" />Process-memory state may disappear on restart.</span><span className="flex items-center gap-1"><Eye className="h-3 w-3" />Native actions require Tauri capability and owner approval.</span><span className="flex items-center gap-1"><History className="h-3 w-3" />Private and purged history remain excluded.</span><span className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3" />Completion is displayed only from canonical records.</span><span className="flex items-center gap-1"><Bookmark className="h-3 w-3" />Screenshot handles remain opaque.</span></div>
  </div>;
}
