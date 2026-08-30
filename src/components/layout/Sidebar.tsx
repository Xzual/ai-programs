import React from 'react';
import {
  Archive,
  Bot,
  BotMessageSquare,
  CalendarClock,
  Chrome,
  CircleStop,
  Code2,
  Cpu,
  Files,
  Globe2,
  LayoutDashboard,
  MessageSquare,
  Brain,
  Zap,
  Boxes,
  Settings,
  Activity,
  Network,
  ShieldCheck,
  ShieldAlert,
  SlidersHorizontal,
  TrendingUp,
  Wrench,
} from 'lucide-react';
import { ProviderRuntimeStatus } from '../../types';
import { providerStatusLabel, providerTone } from '../../edith/providerService';

export type ActiveTab =
  | 'dashboard'
  | 'chat'
  | 'agents'
  | 'tasks'
  | 'computer'
  | 'browser'
  | 'code'
  | 'memory'
  | 'knowledge'
  | 'automations'
  | 'files'
  | 'tools'
  | 'voice'
  | 'crypto'
  | 'security'
  | 'system'
  | 'integrations'
  | 'settings';

interface SidebarProps {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  ollamaConnected: boolean;
  selectedModel: string;
  providerName?: string;
  providerStatus?: ProviderRuntimeStatus;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  setActiveTab,
  ollamaConnected,
  selectedModel,
  providerName = 'Ollama',
  providerStatus,
}) => {
  const status = providerStatus ?? (ollamaConnected ? 'available' : 'offline');
  const tone = providerTone(status);
  const statusDotClass =
    tone === 'success'
      ? 'bg-emerald-400'
      : tone === 'danger'
      ? 'bg-red-400'
      : tone === 'warning'
      ? 'bg-amber-400'
      : 'bg-slate-500';
  const statusIcon = tone === 'success' ? (
    <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
  ) : tone === 'danger' ? (
    <ShieldAlert className="w-4 h-4 text-red-400 shrink-0" />
  ) : (
    <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
  );
  const menuItems = [
    { id: 'dashboard' as ActiveTab, label: 'Command Center', icon: LayoutDashboard },
    { id: 'chat' as ActiveTab, label: 'Chat', icon: MessageSquare },
    { id: 'agents' as ActiveTab, label: 'Agents', icon: Bot },
    { id: 'tasks' as ActiveTab, label: 'Tasks', icon: CalendarClock },
    { id: 'computer' as ActiveTab, label: 'Computer Use', icon: Cpu },
    { id: 'browser' as ActiveTab, label: 'Browser', icon: Chrome },
    { id: 'memory' as ActiveTab, label: 'Memory', icon: Brain },
    { id: 'knowledge' as ActiveTab, label: 'Knowledge Graph', icon: Network },
    { id: 'automations' as ActiveTab, label: 'Automations', icon: Zap },
    { id: 'files' as ActiveTab, label: 'Files', icon: Files },
    { id: 'code' as ActiveTab, label: 'Coding', icon: Code2 },
    { id: 'crypto' as ActiveTab, label: 'Trading', icon: TrendingUp },
    { id: 'tools' as ActiveTab, label: 'Tools / MCP', icon: Wrench },
    { id: 'voice' as ActiveTab, label: 'Voice', icon: BotMessageSquare },
    { id: 'integrations' as ActiveTab, label: 'Integrations', icon: Boxes },
    { id: 'security' as ActiveTab, label: 'Security', icon: ShieldCheck },
    { id: 'system' as ActiveTab, label: 'System', icon: Activity },
    { id: 'settings' as ActiveTab, label: 'Settings', icon: Settings },
  ];

  return (
    <aside className="relative top-0 z-30 flex h-full w-16 flex-col border-r border-white/10 bg-slate-950/58 px-2 py-4 shadow-[inset_-1px_0_0_rgba(255,255,255,0.04),0_0_44px_rgba(0,0,0,0.28)] backdrop-blur-2xl transition-all duration-300 sm:w-64 sm:px-3">
      {/* Top Brand Logo */}
      <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar pr-1">
        <div className="flex items-center gap-3 px-2 py-3 mb-6">
          <div
            className="relative flex items-center justify-center w-10 h-10 rounded-xl p-[1px] shadow-lg"
            style={{ background: 'linear-gradient(135deg, var(--assistant-primary), var(--assistant-secondary), var(--assistant-accent))', boxShadow: '0 0 26px var(--assistant-glow)' }}
          >
            <div className="w-full h-full bg-black rounded-[11px] flex items-center justify-center">
              <Cpu className="w-5 h-5 text-[var(--assistant-accent)] animate-pulse" />
            </div>
          </div>
          <div className="hidden sm:block">
            <h1 className="text-lg font-extrabold tracking-widest text-[var(--assistant-primary)] font-mono">
              E.D.I.T.H.
            </h1>
            <p className="text-[10px] text-slate-500 font-mono tracking-[0.22em]">
              PERSONAL AI OS
            </p>
          </div>
        </div>

        {/* Navigation Items */}
        <nav className="space-y-1.5">
          {menuItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                title={item.label}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-medium transition-all duration-200 group relative overflow-hidden ${
                  isActive
                    ? 'bg-[var(--assistant-primary)]/14 text-slate-100 border border-[var(--assistant-primary)]/34 shadow-[0_0_28px_var(--assistant-glow),inset_0_1px_0_rgba(255,255,255,0.06)]'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
                }`}
              >
                <span
                  className={`relative flex h-7 w-7 items-center justify-center rounded-md transition-all duration-300 ${
                    isActive
                      ? 'bg-[var(--assistant-primary)]/12 shadow-[0_0_22px_var(--assistant-glow),inset_0_0_12px_rgba(255,255,255,0.08)]'
                      : 'bg-white/[0.025] group-hover:bg-[var(--assistant-primary)]/10'
                  }`}
                >
                  <span className={`absolute inset-0 rounded-md blur-md transition-opacity ${isActive ? 'bg-[var(--assistant-primary)]/26 opacity-100' : 'bg-[var(--assistant-primary)]/16 opacity-0 group-hover:opacity-100'}`} />
                  <Icon
                    className={`relative z-10 w-5 h-5 transition-transform duration-200 group-hover:scale-110 ${
                      isActive ? 'text-[var(--assistant-accent)]' : 'text-slate-300/86 group-hover:text-[var(--assistant-primary)]'
                    }`}
                  />
                </span>
                <span className="hidden sm:inline font-sans">{item.label}</span>
                {isActive && (
                  <span className="hidden sm:block ml-auto w-1.5 h-1.5 rounded-full bg-[var(--assistant-primary)] shadow-[0_0_10px_var(--assistant-glow)]" />
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Bottom Status Card */}
      <div className="mt-3 p-2 sm:p-3 rounded-lg bg-black/45 border border-white/10 text-xs shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
        <div className="flex items-center gap-2">
          {statusIcon}
          <div className="hidden sm:block truncate">
            <div className="text-[11px] font-medium text-slate-300 flex items-center gap-1.5">
              <span className="truncate">{providerName}</span>
              <span className={`w-1.5 h-1.5 rounded-full ${statusDotClass}`} />
            </div>
            <p className="text-[10px] text-slate-400 truncate font-mono">
              {selectedModel === 'auto' ? 'AUTO' : selectedModel} / {providerStatusLabel(status)}
            </p>
          </div>
        </div>
      </div>
    </aside>
  );
};
