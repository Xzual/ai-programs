import { appendAuditEvent, createAuditEvent } from './audit';
import type { EdithTask } from './core';
import { interruptService } from './interruptService';
import { killSwitchService } from './killSwitch';
import { getEdithPersistenceStore } from './persistence';

export interface TaskQueueSnapshot {
  queued: EdithTask[];
  running: EdithTask[];
  resumable: EdithTask[];
  interrupted: EdithTask[];
  done: EdithTask[];
}

function now(): string {
  return new Date().toISOString();
}

export class TaskQueueService {
  snapshot(): TaskQueueSnapshot {
    const tasks = getEdithPersistenceStore().listTasks();
    return {
      queued: tasks.filter((task) => task.queue?.state === 'queued' || task.status === 'QUEUED'),
      running: tasks.filter((task) => task.queue?.state === 'running' || task.status === 'RUNNING'),
      resumable: tasks.filter((task) => task.queue?.state === 'resumable' || task.status === 'BLOCKED'),
      interrupted: tasks.filter((task) => task.queue?.state === 'interrupted' || task.status === 'CANCELLED'),
      done: tasks.filter((task) => task.queue?.state === 'done' || task.status === 'COMPLETED'),
    };
  }

  enqueue(taskId: string): EdithTask | undefined {
    killSwitchService.assertAllowed('task_creation', 'edith-task-queue');
    return this.update(taskId, 'task.queue.enqueue', (task) => ({
      ...task,
      status: 'QUEUED',
      queue: {
        ...task.queue,
        state: 'queued',
        queuedAt: task.queue?.queuedAt ?? now(),
        resumeFromStepId: this.nextPendingStepId(task),
      },
      checkpoints: [...task.checkpoints, `Queued for autonomous execution at ${now()}`],
    }));
  }

  markRunning(taskId: string): EdithTask | undefined {
    killSwitchService.assertAllowed('tool_execution', 'edith-task-queue');
    return this.update(taskId, 'task.queue.running', (task) => ({
      ...task,
      status: 'RUNNING',
      queue: {
        ...task.queue,
        state: 'running',
        startedAt: task.queue?.startedAt ?? now(),
        resumeFromStepId: this.nextPendingStepId(task),
      },
      checkpoints: [...task.checkpoints, `Queue execution started at ${now()}`],
    }));
  }

  pause(taskId: string, reason: string): EdithTask | undefined {
    return this.update(taskId, 'task.queue.pause', (task) => ({
      ...task,
      status: 'BLOCKED',
      result: reason,
      queue: {
        ...task.queue,
        state: 'resumable',
        interruptedAt: now(),
        resumeFromStepId: this.nextPendingStepId(task),
      },
      checkpoints: [...task.checkpoints, `Paused at ${now()}: ${reason}`],
      timeline: [
        ...(task.timeline ?? []),
        {
          id: `timeline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          taskId,
          type: 'status',
          actor: 'edith-task-queue',
          message: reason,
          createdAt: now(),
          status: 'BLOCKED',
          riskLevel: task.riskLevel,
        },
      ],
    }));
  }

  resume(taskId: string): EdithTask | undefined {
    killSwitchService.assertAllowed('task_creation', 'edith-task-queue');
    return this.update(taskId, 'task.queue.resume', (task) => ({
      ...task,
      status: 'QUEUED',
      queue: {
        ...task.queue,
        state: 'queued',
        queuedAt: now(),
        resumeFromStepId: this.nextPendingStepId(task),
      },
      checkpoints: [...task.checkpoints, `Resumed from checkpoint at ${now()}`],
    }));
  }

  cancel(taskId: string, reason: string, requestedBy = 'edith-task-queue'): EdithTask | undefined {
    interruptService.request({ taskId, reason, requestedBy });
    return this.update(taskId, 'task.queue.cancel', (task) => ({
      ...task,
      status: 'CANCELLED',
      result: reason,
      queue: {
        ...task.queue,
        state: 'interrupted',
        interruptedAt: now(),
        resumeFromStepId: this.nextPendingStepId(task),
      },
      checkpoints: [...task.checkpoints, `Cancelled at ${now()}: ${reason}`],
    }));
  }

  complete(taskId: string, result: string): EdithTask | undefined {
    return this.update(taskId, 'task.queue.complete', (task) => ({
      ...task,
      status: 'COMPLETED',
      result,
      queue: {
        ...task.queue,
        state: 'done',
      },
      checkpoints: [...task.checkpoints, `Queue completed at ${now()}`],
    }));
  }

  next(): EdithTask | undefined {
    const queued = this.snapshot().queued;
    return queued.sort((a, b) => Date.parse(a.queue?.queuedAt ?? a.createdAt) - Date.parse(b.queue?.queuedAt ?? b.createdAt))[0];
  }

  private nextPendingStepId(task: EdithTask): string | undefined {
    return task.plan?.steps.find((step) => step.status !== 'COMPLETED' && step.status !== 'SKIPPED')?.id;
  }

  private update(taskId: string, action: string, mutator: (task: EdithTask) => EdithTask): EdithTask | undefined {
    const store = getEdithPersistenceStore();
    const task = store.listTasks().find((candidate) => candidate.id === taskId);
    if (!task) return undefined;
    const updated = store.updateTask(mutator(task));
    appendAuditEvent(createAuditEvent({
      actor: 'edith-task-queue',
      taskId,
      action,
      toolId: 'task_queue_service',
      authorization: 'allowed',
      riskLevel: updated.riskLevel,
      result: 'success',
      message: `Task queue state is ${updated.queue?.state ?? 'unset'}.`,
    }));
    return updated;
  }
}

export const taskQueueService = new TaskQueueService();
