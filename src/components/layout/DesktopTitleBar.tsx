import React, { useEffect, useState } from 'react';
import { Maximize2, Minus, Monitor, Power, Square, X } from 'lucide-react';
import { getDesktopShellStatus, invokeDesktopCommand, type DesktopShellStatus } from '../../edith/desktopShell';
import { AssistantProfile } from '../../types';

interface DesktopTitleBarProps {
  activeAssistant: AssistantProfile;
  onEmergencyStop: () => void;
}

export const DesktopTitleBar: React.FC<DesktopTitleBarProps> = ({ activeAssistant, onEmergencyStop }) => {
  const [status, setStatus] = useState<DesktopShellStatus>({ tauri: false, trayConfigured: false, unsafeComputerControl: false });

  useEffect(() => {
    let cancelled = false;
    getDesktopShellStatus().then((nextStatus) => {
      if (!cancelled) setStatus(nextStatus);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const runWindowCommand = async (command: string) => {
    await invokeDesktopCommand(command);
    if (command !== 'close_window') {
      const nextStatus = await getDesktopShellStatus();
      setStatus(nextStatus);
    }
  };

  return (
    <div className="edith-desktop-titlebar flex h-9 shrink-0 items-center justify-between border-b border-white/10 bg-black/34 px-2 text-[11px] text-slate-400">
      <button
        type="button"
        onMouseDown={() => void runWindowCommand('start_window_drag')}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1 text-left"
        title={status.tauri ? 'Drag E.D.I.T.H. window' : 'Browser preview mode'}
      >
        <span className="flex h-5 w-5 items-center justify-center rounded-md border border-[var(--assistant-primary)]/30 bg-[var(--assistant-primary)]/10">
          <Monitor className="h-3.5 w-3.5 text-[var(--assistant-primary)]" />
        </span>
        <span className="font-mono font-semibold tracking-[0.18em] text-slate-200">E.D.I.T.H.</span>
        <span className="hidden sm:inline text-slate-500">Personal AI System</span>
        <span className="hidden md:inline text-slate-600">/</span>
        <span className="hidden md:inline text-[var(--assistant-primary)]">{activeAssistant.name}</span>
        <span className="ml-2 rounded border border-emerald-400/25 bg-emerald-400/10 px-1.5 py-0.5 font-mono text-[10px] text-emerald-200">
          Computer READ ONLY
        </span>
        <span className="hidden lg:inline rounded border border-white/10 bg-white/[0.035] px-1.5 py-0.5 font-mono text-[10px]">
          {status.tauri ? `Desktop ${status.version ?? ''}` : 'Browser Mode'}
        </span>
      </button>

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onEmergencyStop}
          className="mr-1 hidden items-center gap-1 rounded-md border border-red-400/35 bg-red-500/10 px-2 py-1 font-mono text-[10px] text-red-100 hover:bg-red-500/18 sm:flex"
          title="Emergency stop: stops speech/streaming state only"
        >
          <Power className="h-3.5 w-3.5" />
          Stop
        </button>
        <button type="button" onClick={() => void runWindowCommand('minimize_window')} disabled={!status.tauri} className="rounded-md p-1.5 text-slate-400 hover:bg-white/10 hover:text-slate-100 disabled:opacity-35" title="Minimize">
          <Minus className="h-3.5 w-3.5" />
        </button>
        <button type="button" onClick={() => void runWindowCommand('toggle_maximize')} disabled={!status.tauri} className="rounded-md p-1.5 text-slate-400 hover:bg-white/10 hover:text-slate-100 disabled:opacity-35" title="Maximize">
          <Square className="h-3.5 w-3.5" />
        </button>
        <button type="button" onClick={() => void runWindowCommand('toggle_fullscreen')} disabled={!status.tauri} className="rounded-md p-1.5 text-slate-400 hover:bg-white/10 hover:text-slate-100 disabled:opacity-35" title="Toggle fullscreen">
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
        <button type="button" onClick={() => void runWindowCommand('close_window')} disabled={!status.tauri} className="rounded-md p-1.5 text-slate-400 hover:bg-red-500/20 hover:text-red-100 disabled:opacity-35" title="Close">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
};
