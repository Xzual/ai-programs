import {
  isVerifiedTaskSuccess,
  type TaskActivityV2View,
  type TaskSurfaceState,
  type TaskV2View,
} from '../../edith/taskActivityClient';

export type TaskHudSelection =
  | { kind: 'automatic' }
  | { kind: 'explicit'; taskId: string }
  | { kind: 'awaiting-task-link' };

export type TaskHudIntent =
  | { kind: 'show'; selection?: TaskHudSelection; origin: 'button' | 'voice' }
  | { kind: 'hide'; origin: 'close-button' | 'keyboard' | 'voice' };

export type TaskHudInput = {
  state: TaskSurfaceState;
  tasks: readonly TaskV2View[];
  activity?: TaskActivityV2View;
  selection: TaskHudSelection;
  lastSuccessfulReadAt?: number;
  now: number;
};

export type TaskHudModel = {
  surface: TaskSurfaceState;
  selectionState: 'unselected' | 'awaiting-link' | 'selected' | 'unavailable';
  freshness: 'unchecked' | 'snapshot' | 'refreshing' | 'stale';
  lastSuccessfulReadAt?: number;
  fetchedListCounts?: { nonterminal: number; running: number; scope: 'fetched-list' };
  choices: readonly { taskId: string; safeTitle: string; status: TaskV2View['status'] }[];
  selected?: {
    taskId: string; revision: number; eventSequence: number;
    safeTitle: string; status: TaskV2View['status']; historical: boolean;
    verification: 'verified-success' | 'unverified';
    steps: readonly {
      id: string; safeTitle: string;
      status: 'PENDING' | 'READY' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'SKIPPED';
    }[];
    omittedStepCount: number;
    stepCounts?: { completed: number; skipped: number; failed: number; total: number };
    integrity: 'empty' | 'contiguous' | 'gap' | 'snapshot-conflict';
  };
  metrics: readonly [];
};

const TERMINAL = new Set<TaskV2View['status']>(['COMPLETED', 'FAILED', 'CANCELLED', 'ROLLED_BACK']);
const FALLBACK_TITLE = 'Görev ayrıntıları';

/** A compact label is never a place to disclose a locator or credential. Inspect
 * the entire original before truncating so a hidden suffix cannot bypass policy. */
export function safeTaskHudTitle(title: string): string {
  if (typeof title !== 'string' || !title.trim()
    || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(title)
    || /[\\/<>@]|\b[a-z]:|\b[a-z][a-z0-9+.-]*:\/\//iu.test(title)
    || /\b(?:[a-z0-9-]+\.)+[a-z]{2,63}(?:\b|:)/iu.test(title)
    || /\b(?:token|secret|password|passwd|credential|api[_ -]?key|access[_ -]?key|bearer|authorization|parola|şifre)\b/iu.test(title)
    || /\b(?:(?:access|refresh|id|session)[_ -]?token|client[_ -]?secret|private[_ -]?key)\b/iu.test(title)
    || /\b(?:sk-[a-z0-9_-]+|AKIA[A-Z0-9]{16}|[a-z0-9_+=-]{32,})\b/iu.test(title)) {
    return FALLBACK_TITLE;
  }
  const normalized = title.trim().replace(/\s+/gu, ' ');
  const characters = Array.from(normalized);
  return characters.length > 120 ? `${characters.slice(0, 119).join('')}…` : normalized;
}

function freshness(input: TaskHudInput): TaskHudModel['freshness'] {
  const receipt = input.lastSuccessfulReadAt;
  if (receipt === undefined || !Number.isFinite(receipt)) return 'unchecked';
  if (!Number.isFinite(input.now) || input.now < receipt || input.now - receipt >= 24_000
    || input.state === 'offline' || input.state === 'error') return 'stale';
  return input.state === 'loading' || input.state === 'reconnecting' ? 'refreshing' : 'snapshot';
}

/** Projects already validated canonical snapshots. Authority, sticky automatic
 * selection and async revision fences belong to the shared observer. */
export function projectTaskHud(input: TaskHudInput): TaskHudModel {
  const hasReceipt = input.lastSuccessfulReadAt !== undefined && Number.isFinite(input.lastSuccessfulReadAt);
  const usableList = input.state === 'ready' || input.state === 'empty'
    || (input.state === 'reconnecting' && hasReceipt && input.tasks.length > 0);
  const model: TaskHudModel = {
    surface: input.state,
    selectionState: 'unselected',
    freshness: freshness(input),
    ...(hasReceipt ? { lastSuccessfulReadAt: input.lastSuccessfulReadAt } : {}),
    ...(usableList ? {
      fetchedListCounts: {
        nonterminal: input.tasks.filter(task => !TERMINAL.has(task.status)).length,
        running: input.tasks.filter(task => task.status === 'RUNNING').length,
        scope: 'fetched-list' as const,
      },
    } : {}),
    choices: input.tasks.map(task => ({ taskId: task.id, safeTitle: safeTaskHudTitle(task.title), status: task.status })),
    metrics: [],
  };
  if (input.selection.kind === 'awaiting-task-link') {
    model.selectionState = 'awaiting-link';
    return model;
  }
  const requestedId = input.selection.kind === 'explicit' ? input.selection.taskId
    : (input.tasks.find(task => !TERMINAL.has(task.status)) ?? input.tasks[0])?.id;
  const activity = input.activity;
  if (!requestedId || !activity || activity.task.id !== requestedId) {
    model.selectionState = requestedId ? 'unavailable' : 'unselected';
    return model;
  }
  const task = activity.task;
  const steps = task.plan?.steps ?? [];
  const uniqueStepIds = new Set(steps.map(step => step.id)).size === steps.length;
  const completed = steps.filter(step => step.status === 'COMPLETED');
  const running = steps.filter(step => step.status === 'RUNNING').slice(0, 5);
  const skipped = steps.filter(step => step.status === 'SKIPPED').length;
  const failed = steps.filter(step => step.status === 'FAILED').length;
  // Parallel execution takes precedence over historical context within five rows.
  const completedSlots = Math.min(2, 5 - running.length);
  const visibleCompleted = completedSlots > 0 ? completed.slice(-completedSlots) : [];
  const visible = new Set(uniqueStepIds ? [...visibleCompleted, ...running] : []);
  const progress = task.progress;
  const countsCoherent = uniqueStepIds && progress.completedSteps === completed.length + skipped
    && progress.totalSteps === steps.length && progress.failedSteps === failed;
  const progressMatches = activity.progress.taskId === task.id && activity.progress.revision === task.revision
    && activity.progress.status === task.status && progress.taskId === task.id
    && progress.revision === task.revision && progress.status === task.status
    && activity.progress.completedSteps === progress.completedSteps
    && activity.progress.totalSteps === progress.totalSteps
    && activity.progress.failedSteps === progress.failedSteps;
  const conflict = !progressMatches || !countsCoherent;
  model.selectionState = 'selected';
  model.selected = {
    taskId: task.id, revision: task.revision, eventSequence: task.eventSequence,
    safeTitle: safeTaskHudTitle(task.title), status: task.status,
    historical: TERMINAL.has(task.status),
    verification: isVerifiedTaskSuccess(task) ? 'verified-success' : 'unverified',
    steps: steps.filter(step => visible.has(step)).map(step => ({ id: step.id, safeTitle: safeTaskHudTitle(step.title), status: step.status })),
    omittedStepCount: steps.length - visible.size,
    ...(task.plan && steps.length && !conflict ? { stepCounts: { completed: completed.length, skipped, failed, total: steps.length } } : {}),
    integrity: conflict ? 'snapshot-conflict'
      : activity.history.state === 'gap' || activity.history.missingSequences.length || activity.history.quarantinedEvents > 0 ? 'gap'
      : activity.history.state,
  };
  return model;
}
