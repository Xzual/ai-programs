import React from 'react';
import {Activity} from 'lucide-react';
import {TaskHud} from './TaskHud';
import {projectTaskHud} from './taskHudProjection';
import {useSharedTaskActivity} from './TaskActivityProvider';
import './task-hud.css';

type HudVisibility = {visible: boolean; present: boolean; phase: 'hidden' | 'enter' | 'open' | 'exit'};

/** A presentation timer can remove a panel; it can never advance a task. */
export function createTaskHudPresentation(deps: {reducedMotion(): boolean; setTimeout(callback: () => void, milliseconds: number): unknown; clearTimeout(timer: unknown): void}) {
  const listeners = new Set<() => void>();
  let state: HudVisibility = {visible: false, present: false, phase: 'hidden'}, generation = 0, timer: unknown;
  const publish = (next: HudVisibility) => {state = next; for (const listener of listeners) listener();};
  const clear = () => {generation++; if (timer !== undefined) deps.clearTimeout(timer); timer = undefined;};
  const show = () => {
    if (state.visible) return;
    clear(); const token = generation;
    publish({visible: true, present: true, phase: deps.reducedMotion() ? 'open' : 'enter'});
    if (!deps.reducedMotion()) timer = deps.setTimeout(() => {if (token === generation && state.visible) {timer = undefined;publish({...state, phase: 'open'});}}, 180);
  };
  const hide = () => {
    if (!state.visible) return;
    clear(); const token = generation;
    if (deps.reducedMotion()) {publish({visible: false, present: false, phase: 'hidden'});return;}
    publish({visible: false, present: true, phase: 'exit'});
    timer = deps.setTimeout(() => {if (token === generation && !state.visible) {timer = undefined;publish({visible: false, present: false, phase: 'hidden'});}}, 140);
  };
  return {show, hide, getSnapshot: () => state,
    subscribe: (listener: () => void) => {listeners.add(listener);return () => {listeners.delete(listener);};},
    finishTransition: () => {clear();publish(state.visible ? {visible: true, present: true, phase: 'open'} : {visible: false, present: false, phase: 'hidden'});},
    dispose: () => {clear();state = {visible: false, present: false, phase: 'hidden'};listeners.clear();},
  };
}

export function restoreTaskHudFocus(panel: Pick<HTMLElement, 'contains'> | null, active: Node | null, target?: Pick<HTMLElement, 'isConnected' | 'focus'> | null) {
  if (panel && active && panel.contains(active) && target?.isConnected) target.focus();
}

export function shouldDismissTaskHud(event: {key: string; defaultPrevented: boolean; target: EventTarget | null}, panel: Pick<HTMLElement, 'contains'> | null, trigger?: Pick<HTMLElement, 'contains'> | null) {
  const target = event.target as Element | null;
  return event.key === 'Escape' && !event.defaultPrevented && !!target && !!(panel?.contains(target) || trigger?.contains(target))
    && !target.closest?.('[role="dialog"], dialog, [aria-modal="true"]');
}

/** Normal-flow placement is deliberate: no overlay can cover stop/mic/titlebar
 * controls before a separately leased surface-specific anchor exists. */
export function TaskHudHost({onOpenTasks}: {onOpenTasks(): void}) {
  const {snapshot, observer, presentation, presentTaskHud} = useSharedTaskActivity();
  const panelRef = React.useRef<HTMLDivElement>(null), triggerRef = React.useRef<HTMLButtonElement>(null);
  const reduced = React.useRef(false);
  const controller = React.useMemo(() => createTaskHudPresentation({reducedMotion: () => reduced.current,
    setTimeout: (callback, milliseconds) => window.setTimeout(callback, milliseconds), clearTimeout: timer => window.clearTimeout(timer as number)}), []);
  const visibility = React.useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const panelId = React.useId();
  const hide = React.useCallback(() => {restoreTaskHudFocus(panelRef.current, document.activeElement, triggerRef.current);controller.hide();}, [controller]);
  React.useEffect(() => {
    controller.hide();
    lastAnnouncement.current = '';
  }, [observer, controller]);
  React.useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => {reduced.current = media.matches; if (media.matches) controller.finishTransition();};
    update(); media.addEventListener('change', update);
    return () => {media.removeEventListener('change', update);controller.dispose();};
  }, [controller]);
  React.useEffect(() => {
    if (!presentation) return;
    const intent = presentation.intent;
    if (intent.kind === 'hide') hide();
    else {if (intent.selection) void observer.select(intent.selection);controller.show();}
  }, [presentation, observer, controller, hide]);
  // Automatic stickiness is resolved by the shared observer, not a second UI selector.
  const selection = snapshot.selection.kind === 'automatic' && snapshot.activity
    ? {kind: 'explicit' as const, taskId: snapshot.activity.task.id} : snapshot.selection;
  const model = projectTaskHud({...snapshot, selection});
  const selected = model.selected;
  const announcementKey = selected ? JSON.stringify([selected.taskId, selected.status, selected.verification,
    selected.steps.filter(step => step.status === 'RUNNING').map(step => step.id)]) : '';
  const lastAnnouncement = React.useRef('');
  const [announcement, setAnnouncement] = React.useState('');
  React.useEffect(() => {
    if (!visibility.visible || !selected || model.freshness !== 'snapshot') {setAnnouncement('');return;}
    if (announcementKey !== lastAnnouncement.current) {
      lastAnnouncement.current = announcementKey;
      setAnnouncement(`Görev durumu güncellendi: ${selected.safeTitle}.`);
    }
  }, [announcementKey, visibility.visible, model.freshness, selected?.safeTitle]);
  return <div className="edith-task-hud-slot shrink-0" onKeyDown={event => {
    if (visibility.visible && shouldDismissTaskHud(event, panelRef.current, triggerRef.current)) hide();
    // Do not suppress the existing ComputerUse Escape emergency handler.
  }}>
    <button ref={triggerRef} type="button" className="edith-task-hud-trigger" aria-expanded={visibility.visible} aria-controls={visibility.present ? panelId : undefined}
      onClick={() => presentTaskHud({kind: 'show', origin: 'button'})}><Activity size={15} aria-hidden="true" />Görev durumu</button>
    {visibility.present && <div id={panelId} ref={panelRef} className="edith-task-hud-host" data-phase={visibility.phase} inert={!visibility.visible} aria-hidden={!visibility.visible}>
      <TaskHud visible model={model} onHide={() => hide()} onSelectTask={id => {void observer.select({kind: 'explicit', taskId: id});}} onOpenTasks={onOpenTasks} />
    </div>}
    <span className="sr-only" aria-live="polite" aria-atomic="true">{visibility.visible ? announcement : ''}</span>
  </div>;
}
