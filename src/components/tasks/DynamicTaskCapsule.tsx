import React from 'react';
import { createPortal } from 'react-dom';
import {
  Activity, AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, CircleDot,
  ExternalLink, Focus, LoaderCircle, Maximize2, Pause, Play, RefreshCw, RotateCcw,
  ShieldCheck, Square, X,
} from 'lucide-react';
import type { EdithPlanStep } from '../../edith/core';
import type { CanonicalTaskStatus, TaskProgressSnapshot, TypedTaskEventV2 } from '../../edith/contracts';
import {
  fetchTaskActivityV2,
  fetchTaskListV2,
  isNetworkTaskError,
  latestTaskEvent,
  taskErrorMessage,
  type TaskActivityV2View,
  type TaskSurfaceState,
  type TaskV2View,
} from '../../edith/taskActivityClient';
import { AdvancedCapsuleContext } from '../advanced/AdvancedExperiencePanels';

const ACTIVE_STATUSES = new Set<CanonicalTaskStatus>([
  'ANALYZING', 'QUEUED', 'PLANNING', 'WAITING_DEPENDENCY', 'RUNNING', 'PAUSED', 'RETRYING',
  'VERIFYING', 'WAITING_PERMISSION', 'WAITING_FOR_APPROVAL', 'BLOCKED', 'RECOVERING', 'ROLLING_BACK',
]);

const statusTone: Record<CanonicalTaskStatus, string> = {
  CREATED: 'border-slate-500/30 bg-slate-500/10 text-slate-300', ANALYZING: 'border-cyan-400/30 bg-cyan-400/10 text-cyan-200',
  QUEUED: 'border-sky-400/30 bg-sky-400/10 text-sky-200', PLANNING: 'border-violet-400/30 bg-violet-400/10 text-violet-200',
  WAITING_DEPENDENCY: 'border-amber-400/30 bg-amber-400/10 text-amber-200', RUNNING: 'border-cyan-400/40 bg-cyan-400/12 text-cyan-100',
  PAUSED: 'border-amber-400/30 bg-amber-400/10 text-amber-200', RETRYING: 'border-violet-400/30 bg-violet-400/10 text-violet-200',
  VERIFYING: 'border-blue-400/30 bg-blue-400/10 text-blue-200', WAITING_PERMISSION: 'border-amber-400/30 bg-amber-400/10 text-amber-200',
  WAITING_FOR_APPROVAL: 'border-amber-400/30 bg-amber-400/10 text-amber-200', BLOCKED: 'border-red-400/30 bg-red-400/10 text-red-200',
  RECOVERING: 'border-violet-400/30 bg-violet-400/10 text-violet-200', COMPLETED: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200',
  FAILED: 'border-red-400/30 bg-red-400/10 text-red-200', CANCELLED: 'border-slate-500/30 bg-slate-500/10 text-slate-300',
  ROLLING_BACK: 'border-orange-400/30 bg-orange-400/10 text-orange-200', ROLLED_BACK: 'border-slate-500/30 bg-slate-500/10 text-slate-300',
};

function chooseDisplayedTask(tasks: TaskV2View[]): TaskV2View | undefined {
  return tasks.find((task) => ACTIVE_STATUSES.has(task.status)) ?? tasks[0];
}

function useTaskActivitySurface() {
  const [state, setState] = React.useState<TaskSurfaceState>('loading');
  const [tasks, setTasks] = React.useState<TaskV2View[]>([]);
  const [activity, setActivity] = React.useState<TaskActivityV2View>();
  const [error, setError] = React.useState('');
  const [lastCheckedAt, setLastCheckedAt] = React.useState<Date>();
  const requestRef = React.useRef<AbortController>();

  const refresh = React.useCallback(async (background = false) => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setState((current) => background && (current === 'ready' || current === 'empty') ? 'reconnecting' : 'loading');
    try {
      const nextTasks = await fetchTaskListV2(controller.signal);
      const current = chooseDisplayedTask(nextTasks);
      const nextActivity = current ? await fetchTaskActivityV2(current.id, controller.signal) : undefined;
      setTasks(nextTasks);
      setActivity(nextActivity);
      setError('');
      setState(nextTasks.length ? 'ready' : 'empty');
      setLastCheckedAt(new Date());
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      setError(taskErrorMessage(cause));
      setState(isNetworkTaskError(cause) ? 'offline' : 'error');
      setLastCheckedAt(new Date());
    }
  }, []);

  React.useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(true), 12_000);
    return () => { window.clearInterval(interval); requestRef.current?.abort(); };
  }, [refresh]);

  return { state, tasks, activity, error, lastCheckedAt, refresh };
}

function currentStep(task?: TaskV2View): EdithPlanStep | undefined {
  return task?.plan?.steps.find((step) => step.status === 'RUNNING')
    ?? task?.plan?.steps.find((step) => step.status === 'READY' || step.status === 'PENDING');
}

function formatTime(value?: string | Date) {
  if (!value) return 'Henüz yok';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? 'Geçersiz zaman' : date.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
}

function ProgressBar({ progress }: { progress: TaskProgressSnapshot }) {
  return (
    <div className="space-y-1.5" aria-label={`Görev ilerlemesi yüzde ${progress.percent}`}>
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
        <div className="h-full rounded-full bg-[var(--assistant-primary)] transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${progress.percent}%` }} />
      </div>
      <div className="flex items-center justify-between font-mono text-[10px] text-slate-500">
        <span>{progress.completedSteps}/{progress.totalSteps} adım</span>
        <span>{progress.percent}% · rev {progress.revision}</span>
      </div>
    </div>
  );
}

function SurfaceMessage({ state, error, onRetry }: { state: TaskSurfaceState; error: string; onRetry: () => void }) {
  const loading = state === 'loading' || state === 'reconnecting';
  return (
    <div className="flex min-h-20 items-center gap-3 px-4 py-3 text-sm text-slate-300">
      {loading ? <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <AlertTriangle className="h-4 w-4 text-amber-300" />}
      <div className="min-w-0 flex-1">
        <p className="font-medium">{loading ? (state === 'reconnecting' ? 'Görev durumu yenileniyor' : 'V2 görev verisi yükleniyor') : state === 'empty' ? 'Aktif görev yok' : state === 'offline' ? 'Görev servisi çevrimdışı' : 'Görev sözleşmesi okunamadı'}</p>
        {(error || state === 'empty') && <p className="mt-1 text-xs text-slate-500">{error || 'Yeni görevler geldiğinde kapsül gerçek V2 durumu gösterecek.'}</p>}
      </div>
      {!loading && state !== 'empty' && <button onClick={onRetry} className="rounded-md border border-white/10 p-2 hover:bg-white/5" aria-label="Görev durumunu yeniden dene"><RefreshCw className="h-4 w-4" /></button>}
    </div>
  );
}

function CapabilityActions() {
  const actions = [
    { label: 'Duraklat', icon: Pause }, { label: 'Sürdür', icon: Play }, { label: 'Yeniden dene', icon: RotateCcw }, { label: 'İptal', icon: Square },
  ];
  return (
    <div className="flex flex-wrap gap-2" aria-label="Backend görev eylemleri">
      {actions.map(({ label, icon: Icon }) => (
        <button key={label} disabled title="Backend bu eylem için V2 capability advertise etmedi." className="flex items-center gap-1.5 rounded-md border border-white/8 bg-white/[0.025] px-2.5 py-1.5 text-[11px] text-slate-600 disabled:cursor-not-allowed">
          <Icon className="h-3 w-3" />{label}
        </button>
      ))}
      <span className="self-center text-[10px] text-slate-600">Eylemler capability bekliyor</span>
    </div>
  );
}

function EventList({ events }: { events: TypedTaskEventV2[] }) {
  if (!events.length) return <p className="rounded-md border border-dashed border-white/10 p-3 text-xs text-slate-500">Bu görev için V2 activity event’i yok.</p>;
  return (
    <ol className="space-y-2">
      {[...events].sort((a, b) => b.sequence - a.sequence).slice(0, 8).map((event) => (
        <li key={event.eventId} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2 rounded-md border border-white/8 bg-slate-950/45 px-3 py-2">
          <CircleDot className="mt-0.5 h-3.5 w-3.5 text-[var(--assistant-primary)]" />
          <div className="min-w-0"><p className="truncate font-mono text-[11px] text-slate-300">{event.type}</p><p className="mt-0.5 text-[10px] text-slate-600">sequence {event.sequence} · revision {event.revision}</p></div>
          <time className="text-[10px] text-slate-500">{formatTime(event.occurredAt)}</time>
        </li>
      ))}
    </ol>
  );
}

function MissionDialog({ tasks, activity, onClose }: { tasks: TaskV2View[]; activity?: TaskActivityV2View; onClose: () => void }) {
  const closeRef = React.useRef<HTMLButtonElement>(null);
  const dialogRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const appRoot = document.getElementById('root');
    const previousAriaHidden = appRoot?.getAttribute('aria-hidden');
    const previouslyInert = appRoot?.hasAttribute('inert') ?? false;
    closeRef.current?.focus();
    appRoot?.setAttribute('aria-hidden', 'true');
    appRoot?.setAttribute('inert', '');
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab') return;
      const nodes = dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])');
      const focusable: HTMLElement[] = nodes ? Array.from(nodes) : [];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      if (appRoot) {
        if (previousAriaHidden === null) appRoot.removeAttribute('aria-hidden'); else appRoot.setAttribute('aria-hidden', previousAriaHidden);
        if (!previouslyInert) appRoot.removeAttribute('inert');
      }
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [onClose]);
  const task = activity?.task ?? chooseDisplayedTask(tasks);
  return createPortal(
    <div ref={dialogRef} className="fixed inset-0 z-[80] flex bg-slate-950/88 p-2 backdrop-blur-xl sm:p-4" role="dialog" aria-modal="true" aria-labelledby="edith-mission-title">
      <section className="edith-mission-surface mx-auto flex h-full w-full max-w-[150rem] flex-col overflow-hidden rounded-lg border border-cyan-300/18 bg-[#030914] shadow-2xl shadow-black/70">
        <header className="flex items-center gap-3 border-b border-white/10 px-4 py-3 sm:px-5">
          <div className={`${task && ACTIVE_STATUSES.has(task.status) ? 'edith-task-signal' : ''} h-2.5 w-2.5 rounded-full bg-[var(--assistant-primary)]`} />
          <div className="min-w-0 flex-1"><p className="font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-300">Mission View · In-app</p><h2 id="edith-mission-title" className="truncate text-base font-semibold text-slate-100">{task?.title ?? 'Görev çalışma alanı'}</h2></div>
          <span className="hidden rounded-md border border-amber-400/20 bg-amber-400/8 px-2 py-1 text-[10px] text-amber-200 sm:inline">NATIVE OVERLAY YOK</span>
          <button ref={closeRef} onClick={onClose} className="rounded-md border border-white/10 p-2 text-slate-300 hover:bg-white/5" aria-label="Mission View kapat"><X className="h-4 w-4" /></button>
        </header>
        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[minmax(16rem,22rem)_minmax(0,1fr)_minmax(17rem,23rem)] lg:overflow-hidden">
          <aside className="border-b border-white/10 p-4 lg:overflow-y-auto lg:border-b-0 lg:border-r">
            <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.16em] text-slate-500">API görev sırası</p>
            <p className="mb-3 text-[10px] text-slate-600">Authoritative focus ve queue position advertise edilmedi.</p>
            <div className="space-y-2">{tasks.map((item) => <div key={item.id} className={`rounded-md border p-3 ${item.id === task?.id ? 'border-cyan-400/30 bg-cyan-400/8' : 'border-white/8 bg-white/[0.02]'}`}><div className="flex gap-2"><span className={`rounded border px-1.5 py-0.5 font-mono text-[9px] ${statusTone[item.status]}`}>{item.status}</span><span className="font-mono text-[9px] uppercase text-slate-500">{item.priority}</span></div><p className="mt-2 text-xs font-medium text-slate-200">{item.title}</p><p className="mt-1 text-[10px] text-slate-500">{item.progress.percent}% · rev {item.revision}</p></div>)}</div>
          </aside>
          <main className="min-w-0 p-4 lg:overflow-y-auto sm:p-5">
            {task ? <div className="space-y-5"><div><div className="flex flex-wrap items-center gap-2"><span className={`rounded-md border px-2 py-1 font-mono text-[10px] ${statusTone[task.status]}`}>{task.status}</span><span className="rounded-md border border-white/10 px-2 py-1 font-mono text-[10px] text-slate-400">PRIORITY {task.priority.toUpperCase()}</span></div><h3 className="mt-3 text-lg font-semibold text-slate-100">{task.objective || task.title}</h3></div><ProgressBar progress={task.progress} /><section><h4 className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Plan</h4>{task.plan?.steps.length ? <div className="space-y-2">{task.plan.steps.map((step) => <div key={step.id} className="flex items-start gap-3 rounded-md border border-white/8 bg-white/[0.02] p-3"><CheckCircle2 className={`mt-0.5 h-4 w-4 ${step.status === 'COMPLETED' ? 'text-emerald-300' : step.status === 'FAILED' ? 'text-red-300' : 'text-slate-600'}`} /><div><p className="text-xs font-medium text-slate-200">{step.title}</p><p className="mt-1 font-mono text-[10px] text-slate-500">{step.status} · risk {step.riskLevel}</p></div></div>)}</div> : <p className="rounded-md border border-dashed border-white/10 p-3 text-xs text-slate-500">Backend henüz yapılandırılmış plan adımı sağlamadı.</p>}</section><section><h4 className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Activity</h4><EventList events={activity?.events ?? []} /></section></div> : <SurfaceMessage state="empty" error="" onRetry={() => undefined} />}
          </main>
          <aside className="border-t border-white/10 p-4 lg:overflow-y-auto lg:border-l lg:border-t-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-slate-500">Runtime truth</p>
            <div className="mt-3 space-y-2 text-xs"><div className="rounded-md border border-emerald-400/15 bg-emerald-400/5 p-3 text-emerald-100"><ShieldCheck className="mb-2 h-4 w-4" />V2 task/activity endpoint doğrulandı.</div><div className="rounded-md border border-amber-400/15 bg-amber-400/5 p-3 text-amber-100">Native always-on-top overlay mevcut değil. Bu görünüm E.D.I.T.H. penceresi içindedir.</div><div className="rounded-md border border-white/8 bg-white/[0.02] p-3 text-slate-400">Ses, browser, computer-use, research ve transfer runtime kanalları bu task response içinde advertise edilmedi.</div></div>
            <div className="mt-5"><p className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-slate-500">Controls</p><CapabilityActions /></div>
          </aside>
        </div>
      </section>
    </div>,
    document.body,
  );
}

export function DynamicTaskCapsule({ onOpenTasks }: { onOpenTasks: () => void }) {
  const surface = useTaskActivitySurface();
  const [expanded, setExpanded] = React.useState(false);
  const [missionOpen, setMissionOpen] = React.useState(false);
  const task = surface.activity?.task ?? chooseDisplayedTask(surface.tasks);
  const step = currentStep(task);
  const event = latestTaskEvent(surface.activity?.events ?? []);
  const usable = surface.state === 'ready' || surface.state === 'reconnecting';
  return (
    <div className="relative z-30 shrink-0 border-b border-white/[0.06] bg-slate-950/36 px-2 py-1.5 backdrop-blur-xl" data-testid="dynamic-task-capsule">
      <section className="edith-task-capsule mx-auto w-full max-w-4xl overflow-hidden rounded-lg border border-cyan-300/15 bg-slate-950/78 shadow-lg shadow-black/25" aria-label="Dinamik görev kapsülü">
        {usable && task ? (
          <>
            <div className="flex min-h-10 items-center gap-2 px-2.5 sm:px-3">
              <span className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.14em] text-cyan-300"><Activity className="h-3.5 w-3.5" />In-app</span>
              <span className={`hidden rounded border px-1.5 py-0.5 font-mono text-[9px] sm:inline ${statusTone[task.status]}`}>{task.status}</span>
              <div className="min-w-0 flex-1"><p className="truncate text-xs font-medium text-slate-200">{task.title}</p><p className="truncate text-[10px] text-slate-500">{step ? `Adım: ${step.title}` : event ? `Son event: ${event.type}` : 'Yapılandırılmış activity bekleniyor'}</p></div>
              <span className="font-mono text-[10px] text-slate-400">{task.progress.percent}%</span>
              {surface.state === 'reconnecting' && <RefreshCw className="h-3.5 w-3.5 animate-spin text-slate-500 motion-reduce:animate-none" aria-label="Yenileniyor" />}
              <button onClick={() => setMissionOpen(true)} className="rounded-md border border-white/10 p-1.5 text-slate-300 hover:bg-white/5" aria-label="Mission View aç" title="Mission View"><Maximize2 className="h-3.5 w-3.5" /></button>
              <button onClick={() => setExpanded((value) => !value)} className="rounded-md border border-white/10 p-1.5 text-slate-300 hover:bg-white/5" aria-expanded={expanded} aria-label={expanded ? 'Görev kapsülünü daralt' : 'Görev kapsülünü genişlet'}>{expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}</button>
            </div>
            {expanded && <div className="grid gap-3 border-t border-white/8 p-3 md:grid-cols-[minmax(0,1fr)_auto]"><div className="space-y-2"><ProgressBar progress={task.progress} /><div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-slate-500"><span>Öncelik: <b className="text-slate-300">{task.priority}</b></span><span>Doğrulama: <b className="text-slate-300">{task.progress.verificationStatus ?? 'bekleniyor'}</b></span><span>Kontrol: <b className="text-slate-300">{formatTime(surface.lastCheckedAt)}</b></span></div><AdvancedCapsuleContext /><CapabilityActions /></div><button onClick={onOpenTasks} className="flex h-9 items-center justify-center gap-2 self-center rounded-md border border-cyan-300/20 bg-cyan-300/8 px-3 text-xs text-cyan-100 hover:bg-cyan-300/12"><ExternalLink className="h-3.5 w-3.5" />Görevleri aç</button></div>}
          </>
        ) : <SurfaceMessage state={surface.state} error={surface.error} onRetry={() => void surface.refresh()} />}
      </section>
      {missionOpen && <MissionDialog tasks={surface.tasks} activity={surface.activity} onClose={() => setMissionOpen(false)} />}
    </div>
  );
}

export function TaskMissionWorkspace({ assistantName, reportIdentity }: { assistantName?: string; reportIdentity?: string }) {
  const surface = useTaskActivitySurface();
  const task = surface.activity?.task ?? chooseDisplayedTask(surface.tasks);
  const [missionOpen, setMissionOpen] = React.useState(false);
  if (surface.state !== 'ready' && surface.state !== 'reconnecting') return <div className="rounded-lg border border-white/10 bg-slate-950/55"><SurfaceMessage state={surface.state} error={surface.error} onRetry={() => void surface.refresh()} /></div>;
  if (!task) return <div className="rounded-lg border border-white/10 bg-slate-950/55"><SurfaceMessage state="empty" error="" onRetry={() => void surface.refresh()} /></div>;
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(18rem,24rem)_minmax(0,1fr)]">
      <section className="rounded-lg border border-white/10 bg-slate-950/55 p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-mono text-[10px] uppercase tracking-[0.16em] text-cyan-300">API sırasından görüntülenen görev</p><h2 className="mt-2 text-base font-semibold text-slate-100">{task.title}</h2></div><span className={`rounded-md border px-2 py-1 font-mono text-[10px] ${statusTone[task.status]}`}>{task.status}</span></div><p className="mt-3 text-xs leading-5 text-slate-400">{task.objective || 'Yapılandırılmış objective sağlanmadı.'}</p><p className="mt-2 text-[10px] text-slate-600">Backend authoritative focus veya queue position advertise etmedi.</p><div className="mt-4"><ProgressBar progress={task.progress} /></div><div className="mt-4 grid grid-cols-2 gap-2 text-[10px]"><div className="rounded-md border border-white/8 p-2 text-slate-500">Asistan<br/><b className="text-slate-300">{assistantName ?? 'Atanmadı'}</b></div><div className="rounded-md border border-white/8 p-2 text-slate-500">Rapor kimliği<br/><b className="text-slate-300">{reportIdentity ?? 'Yok'}</b></div><div className="rounded-md border border-white/8 p-2 text-slate-500">Öncelik<br/><b className="text-slate-300">{task.priority}</b></div><div className="rounded-md border border-white/8 p-2 text-slate-500">Kaynaklar<br/><b className="text-slate-300">{task.progress.sources.join(', ')}</b></div></div><button onClick={() => setMissionOpen(true)} className="mt-4 flex w-full items-center justify-center gap-2 rounded-md border border-cyan-300/20 bg-cyan-300/8 px-3 py-2 text-xs text-cyan-100 hover:bg-cyan-300/12"><Focus className="h-4 w-4" />Mission View</button></section>
      <section className="min-w-0 rounded-lg border border-white/10 bg-slate-950/55 p-4"><div className="mb-3 flex items-center justify-between gap-3"><div><p className="font-mono text-[10px] uppercase tracking-[0.16em] text-cyan-300">Canonical activity</p><h2 className="mt-1 text-sm font-semibold text-slate-100">Yapılandırılmış görev olayları</h2></div><button onClick={() => void surface.refresh()} className="rounded-md border border-white/10 p-2 text-slate-300 hover:bg-white/5" aria-label="Görevleri yenile"><RefreshCw className={`h-4 w-4 ${surface.state === 'reconnecting' ? 'animate-spin motion-reduce:animate-none' : ''}`} /></button></div><EventList events={surface.activity?.events ?? []} /><div className="mt-4 border-t border-white/8 pt-4"><CapabilityActions /></div></section>
      {missionOpen && <MissionDialog tasks={surface.tasks} activity={surface.activity} onClose={() => setMissionOpen(false)} />}
    </div>
  );
}
