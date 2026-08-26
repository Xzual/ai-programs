import fs from 'node:fs';
import path from 'node:path';
import type { InterruptSignal } from './core';
import { appendAuditEvent, createAuditEvent } from './audit';
import { getEdithPersistenceStore } from './persistence';
import { taskService } from './taskService';

function signalId(): string {
  return `interrupt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeCommand(command: string): string {
  return command.trim().toLocaleLowerCase('tr-TR');
}

export class InterruptService {
  request(input: { taskId?: string; reason?: string; requestedBy?: string }): InterruptSignal {
    const signal: InterruptSignal = {
      id: signalId(),
      taskId: input.taskId,
      reason: input.reason?.trim() || 'Manual interrupt requested.',
      requestedBy: input.requestedBy?.trim() || 'local-user',
      requestedAt: new Date().toISOString(),
      active: true,
    };
    this.writeSignal(signal);
    if (signal.taskId) {
      taskService.updateStatus(signal.taskId, 'CANCELLED', signal.reason);
    }
    appendAuditEvent(createAuditEvent({
      actor: signal.requestedBy,
      taskId: signal.taskId,
      action: 'interrupt.request',
      toolId: 'interrupt_service',
      authorization: 'allowed',
      riskLevel: 2,
      result: 'success',
      message: signal.reason,
    }));
    return signal;
  }

  detectCommand(command: string, taskId?: string): InterruptSignal | undefined {
    const normalized = normalizeCommand(command);
    if (!/\b(dur|iptal|cancel|stop|abort)\b/i.test(normalized)) return undefined;
    return this.request({ taskId, reason: `Interrupt command detected: ${command}`, requestedBy: 'edith-chat' });
  }

  current(taskId?: string): InterruptSignal | undefined {
    const signals = this.readSignals().filter((signal) => signal.active);
    return signals.find((signal) => !taskId || signal.taskId === taskId || !signal.taskId);
  }

  clear(id: string, actor = 'local-user'): boolean {
    const signals = this.readSignals();
    const found = signals.some((signal) => signal.id === id);
    if (!found) return false;
    this.writeSignals(signals.map((signal) => signal.id === id ? { ...signal, active: false } : signal));
    appendAuditEvent(createAuditEvent({
      actor,
      action: 'interrupt.clear',
      toolId: 'interrupt_service',
      authorization: 'allowed',
      riskLevel: 1,
      result: 'success',
      message: `Interrupt cleared: ${id}`,
    }));
    return true;
  }

  private file(): string {
    return path.join(getEdithPersistenceStore().getPaths().dataDir, 'interrupts.json');
  }

  private readSignals(): InterruptSignal[] {
    const file = this.file();
    if (!fs.existsSync(file)) return [];
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private writeSignal(signal: InterruptSignal): void {
    this.writeSignals([signal, ...this.readSignals()]);
  }

  private writeSignals(signals: InterruptSignal[]): void {
    const file = this.file();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(signals, null, 2), 'utf8');
  }
}

export const interruptService = new InterruptService();
