import { invoke as tauriInvoke, isTauri as isTauriRuntime } from '@tauri-apps/api/core';

export interface DesktopShellStatus {
  tauri: boolean;
  version?: string;
  fullscreen?: boolean;
  maximized?: boolean;
  decorations?: boolean;
  trayConfigured?: boolean;
  unsafeComputerControl?: boolean;
}

type TauriGlobal = {
  core?: {
    invoke?: <T = unknown>(command: string, args?: Record<string, unknown>) => Promise<T>;
  };
};

function tauriGlobal(): TauriGlobal | undefined {
  return typeof window !== 'undefined' ? (window as unknown as { __TAURI__?: TauriGlobal }).__TAURI__ : undefined;
}

export function isTauriShell(): boolean {
  return isTauriRuntime() || Boolean(tauriGlobal()?.core?.invoke);
}

export async function invokeDesktopCommand<T = unknown>(command: string, args?: Record<string, unknown>): Promise<T | undefined> {
  if (isTauriRuntime()) return tauriInvoke<T>(command, args);
  const invoke = tauriGlobal()?.core?.invoke;
  if (!invoke) return undefined;
  return invoke<T>(command, args);
}

export async function getDesktopShellStatus(): Promise<DesktopShellStatus> {
  const status = await invokeDesktopCommand<DesktopShellStatus>('desktop_shell_status');
  return status ?? {
    tauri: false,
    trayConfigured: false,
    unsafeComputerControl: false,
  };
}

export interface DesktopOwnerSession {
  actor: 'owner';
  csrfToken: string;
  createdAt: string;
  expiresAt: string;
}

export async function establishDesktopOwnerSession(): Promise<DesktopOwnerSession | null> {
  if (!isTauriShell()) return null;
  const existing = await fetch('/api/security/session', { credentials: 'include' });
  if (existing.ok) {
    const payload = await existing.json() as { session?: DesktopOwnerSession };
    return payload.session ?? null;
  }
  const bootstrap = await invokeDesktopCommand<string>('desktop_owner_bootstrap_token');
  if (!bootstrap) throw new Error('Desktop owner bootstrap is unavailable.');
  const response = await fetch('/api/security/session', {
    method: 'POST',
    credentials: 'include',
    headers: { Authorization: `Bearer ${bootstrap}` },
  });
  if (!response.ok) throw new Error(`Desktop owner session bootstrap failed (${response.status}).`);
  const payload = await response.json() as { session?: DesktopOwnerSession };
  if (!payload.session?.csrfToken) throw new Error('Desktop owner session response is incomplete.');
  return payload.session;
}
