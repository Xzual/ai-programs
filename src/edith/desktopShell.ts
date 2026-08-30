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
  return Boolean(tauriGlobal()?.core?.invoke);
}

export async function invokeDesktopCommand<T = unknown>(command: string, args?: Record<string, unknown>): Promise<T | undefined> {
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
