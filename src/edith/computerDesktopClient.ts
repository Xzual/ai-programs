import { invokeDesktopCommand, isTauriShell } from './desktopShell';
import type { ComputerOperatorEvent } from './computerOperatorEvents';
import type { SafeDesktopApp } from './computerCommandService';

export interface ComputerDesktopStatus {
  runtime: 'tauri' | 'unbound';
  mode: 'read_only' | 'owner_command' | 'disabled' | 'error';
  available: boolean;
  screenCapture: 'ready' | 'missing' | 'permission_required' | 'error';
  mouseControl: 'ready' | 'missing' | 'permission_required' | 'error';
  keyboardControl: 'ready' | 'missing' | 'permission_required' | 'error';
  ownerCommandMode: boolean;
  killSwitch: 'active' | 'inactive' | 'unknown';
  overlay: 'in_app' | 'missing';
  sessionExpiresAt?: number;
  safeMessage: string;
  lastError?: string | null;
}

export interface ComputerObservation {
  imageDataUrl: string;
  width: number;
  height: number;
  cursorX: number;
  cursorY: number;
  capturedAt: number;
  source: string;
}

export type ComputerDesktopAction =
  | { action: 'moveMouse' | 'clickMouse'; x: number; y: number; button?: 'left' | 'right' }
  | { action: 'typeText'; text: string }
  | { action: 'pressKey'; key: string }
  | { action: 'hotkey'; keys: string[] }
  | { action: 'scroll'; delta: number }
  | { action: 'launchApp'; app: SafeDesktopApp };

export interface ComputerActionResult {
  action: string;
  injected: boolean;
  cursorX: number;
  cursorY: number;
  verification: 'cursor_position_confirmed' | 'input_injected_outcome_unverified' | 'process_started';
}

const browserStatus: ComputerDesktopStatus = {
  runtime: 'unbound', mode: 'read_only', available: false,
  screenCapture: 'missing', mouseControl: 'missing', keyboardControl: 'missing',
  ownerCommandMode: false, overlay: 'in_app',
  killSwitch: 'unknown',
  safeMessage: 'Desktop Computer Use requires the Tauri application.',
};

async function invokeRequired<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauriShell()) throw new Error(browserStatus.safeMessage);
  const result = await invokeDesktopCommand<T>(command, args);
  if (result === undefined) throw new Error(`Desktop command ${command} returned no result.`);
  return result;
}

export async function getComputerDesktopStatus(): Promise<ComputerDesktopStatus> {
  return isTauriShell() ? invokeRequired('computer_status') : browserStatus;
}

export async function beginComputerSession(): Promise<string> {
  return invokeRequired('computer_begin');
}

export async function observeComputer(sessionId: string): Promise<ComputerObservation> {
  return invokeRequired('computer_observe', { sessionId });
}

export async function getComputerScreenshot(sessionId: string): Promise<ComputerObservation> {
  return invokeRequired('computer_screenshot', { sessionId });
}

export async function actOnComputer(sessionId: string, request: ComputerDesktopAction): Promise<ComputerActionResult> {
  return invokeRequired('computer_action', { sessionId, request });
}

export async function stopComputer(): Promise<void> {
  if (isTauriShell()) await invokeDesktopCommand('computer_stop');
}

export async function reportComputerRuntimeStatus(status: ComputerDesktopStatus): Promise<void> {
  if (!isTauriShell()) return;
  const response = await fetch('/api/computer-use/runtime', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-EDITH-Desktop-Runtime': 'tauri-v1' },
    body: JSON.stringify(status),
  });
  if (!response.ok) throw new Error(`Computer Use runtime report failed (${response.status}).`);
}

export async function reportComputerOperatorEvent(event: ComputerOperatorEvent): Promise<void> {
  if (!isTauriShell()) return;
  const response = await fetch('/api/computer-use/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-EDITH-Desktop-Runtime': 'tauri-v1' },
    body: JSON.stringify(event),
  });
  if (!response.ok) throw new Error(`Computer Use event report failed (${response.status}).`);
}

export function startComputerRuntimeHeartbeat(intervalMs = 5_000): () => void {
  if (!isTauriShell()) return () => undefined;
  let cancelled = false;
  const report = async () => {
    try {
      const status = await getComputerDesktopStatus();
      if (!cancelled) await reportComputerRuntimeStatus(status);
    } catch (error) {
      console.warn('Computer Use runtime heartbeat failed:', error);
    }
  };
  void report();
  const timer = window.setInterval(() => void report(), Math.max(2_000, intervalMs));
  return () => {
    cancelled = true;
    window.clearInterval(timer);
  };
}
