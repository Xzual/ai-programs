import { EDITH_CONTRACT_VERSION } from './contracts';

export type ComputerOperatorState =
  | 'observing'
  | 'planning'
  | 'moving'
  | 'clicking'
  | 'typing'
  | 'scrolling'
  | 'verifying'
  | 'success'
  | 'error'
  | 'stopped';

export interface ComputerOperatorEvent {
  contractVersion: typeof EDITH_CONTRACT_VERSION;
  id: string;
  sequence: number;
  type: ComputerOperatorState;
  createdAt: string;
  message?: string;
  safeMessage?: string;
  x?: number;
  y?: number;
  textPreview?: string;
  sessionId?: string;
  planId?: string;
  stepId?: string;
  observationId?: string;
  actionId?: string;
  verificationStatus?: 'verified' | 'partial' | 'pending_post_observation';
}

interface EventDetails {
  x?: number;
  y?: number;
  text?: string;
  sessionId?: string;
  planId?: string;
  stepId?: string;
  observationId?: string;
  actionId?: string;
  verificationStatus?: ComputerOperatorEvent['verificationStatus'];
}

let eventSequence = 0;

function cleanMessage(value: string, maximum: number): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, maximum);
}

export function operatorStateForAction(action: string): ComputerOperatorState {
  if (action === 'moveMouse') return 'moving';
  if (action === 'clickMouse') return 'clicking';
  if (action === 'scroll') return 'scrolling';
  if (action === 'typeText' || action === 'pressKey' || action === 'hotkey') return 'typing';
  return 'planning';
}

export function createComputerOperatorEvent(
  type: ComputerOperatorState,
  message = '',
  details: EventDetails = {},
): ComputerOperatorEvent {
  const event: ComputerOperatorEvent = {
    contractVersion: EDITH_CONTRACT_VERSION,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    sequence: ++eventSequence,
    type,
    createdAt: new Date().toISOString(),
  };
  const safeMessage = cleanMessage(message, 240);
  if (safeMessage) {
    event.message = safeMessage;
    if (type === 'error') event.safeMessage = safeMessage;
  }
  if (Number.isInteger(details.x) && Number.isInteger(details.y)) {
    event.x = details.x;
    event.y = details.y;
  }
  if (details.text) {
    const safeText = cleanMessage(details.text, 200);
    event.textPreview = safeText === 'EDITH_COMPUTER_USE_OK'
      ? safeText
      : `[redacted ${Array.from(safeText).length} chars]`;
  }
  for (const key of ['sessionId', 'planId', 'stepId', 'observationId', 'actionId'] as const) {
    const value = details[key];
    if (typeof value === 'string' && value.trim()) event[key] = cleanMessage(value, 120);
  }
  if (details.verificationStatus) event.verificationStatus = details.verificationStatus;
  return event;
}

export function isComputerOperatorEvent(value: unknown): value is ComputerOperatorEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as Partial<ComputerOperatorEvent>;
  return event.contractVersion === EDITH_CONTRACT_VERSION
    && Number.isSafeInteger(event.sequence) && Number(event.sequence) > 0
    && typeof event.id === 'string'
    && typeof event.createdAt === 'string'
    && ['observing', 'planning', 'moving', 'clicking', 'typing', 'scrolling', 'verifying', 'success', 'error', 'stopped'].includes(String(event.type));
}
