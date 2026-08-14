import fs from 'node:fs';
import path from 'node:path';
import { appendAuditEvent, createAuditEvent } from './audit';
import { getEdithPersistenceStore } from './persistence';

export type KillSwitchCapability =
  | 'task_creation'
  | 'tool_execution'
  | 'browser_control'
  | 'computer_control'
  | 'trading_execution'
  | 'proactive_tasks';

export interface KillSwitchState {
  active: boolean;
  reason: string;
  activatedAt?: string;
  activatedBy?: string;
  deactivatedAt?: string;
  deactivatedBy?: string;
  disabledCapabilities: KillSwitchCapability[];
}

export class KillSwitchActiveError extends Error {
  constructor(
    message: string,
    public readonly state: KillSwitchState,
    public readonly capability: KillSwitchCapability
  ) {
    super(message);
    this.name = 'KillSwitchActiveError';
  }
}

const DEFAULT_DISABLED_CAPABILITIES: KillSwitchCapability[] = [
  'task_creation',
  'tool_execution',
  'browser_control',
  'computer_control',
  'trading_execution',
  'proactive_tasks',
];

const DEFAULT_STATE: KillSwitchState = {
  active: false,
  reason: '',
  disabledCapabilities: DEFAULT_DISABLED_CAPABILITIES,
};

export class KillSwitchService {
  status(): KillSwitchState {
    return this.readState();
  }

  activate(reason: string, actor = 'local-user'): KillSwitchState {
    const state: KillSwitchState = {
      active: true,
      reason: reason.trim() || 'Manual emergency stop.',
      activatedAt: new Date().toISOString(),
      activatedBy: actor,
      disabledCapabilities: DEFAULT_DISABLED_CAPABILITIES,
    };
    this.writeState(state);
    this.audit('kill_switch.activate', actor, state, 'Kill switch activated.');
    return state;
  }

  deactivate(actor = 'local-user'): KillSwitchState {
    const previous = this.readState();
    const state: KillSwitchState = {
      ...previous,
      active: false,
      deactivatedAt: new Date().toISOString(),
      deactivatedBy: actor,
      disabledCapabilities: DEFAULT_DISABLED_CAPABILITIES,
    };
    this.writeState(state);
    this.audit('kill_switch.deactivate', actor, state, 'Kill switch deactivated.');
    return state;
  }

  assertAllowed(capability: KillSwitchCapability, actor = 'local-user'): void {
    const state = this.readState();
    if (!state.active || !state.disabledCapabilities.includes(capability)) return;
    const message = `EDITH kill switch is active; ${capability} is disabled. Reason: ${state.reason}`;
    this.audit('kill_switch.block', actor, state, message);
    throw new KillSwitchActiveError(message, state, capability);
  }

  private readState(): KillSwitchState {
    const file = this.stateFile();
    if (!fs.existsSync(file)) return DEFAULT_STATE;
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<KillSwitchState>;
      return {
        active: Boolean(parsed.active),
        reason: String(parsed.reason ?? ''),
        activatedAt: parsed.activatedAt,
        activatedBy: parsed.activatedBy,
        deactivatedAt: parsed.deactivatedAt,
        deactivatedBy: parsed.deactivatedBy,
        disabledCapabilities: Array.isArray(parsed.disabledCapabilities) && parsed.disabledCapabilities.length > 0
          ? parsed.disabledCapabilities
          : DEFAULT_DISABLED_CAPABILITIES,
      };
    } catch {
      return DEFAULT_STATE;
    }
  }

  private writeState(state: KillSwitchState): void {
    const file = this.stateFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(state, null, 2), 'utf8');
  }

  private stateFile(): string {
    return path.join(getEdithPersistenceStore().getPaths().dataDir, 'kill-switch.json');
  }

  private audit(action: string, actor: string, state: KillSwitchState, message: string): void {
    appendAuditEvent(createAuditEvent({
      actor,
      action,
      toolId: 'kill_switch',
      authorization: action === 'kill_switch.block' ? 'denied' : 'allowed',
      riskLevel: 5,
      result: action === 'kill_switch.block' ? 'denied' : 'success',
      message,
    }));
  }
}

export const killSwitchService = new KillSwitchService();
