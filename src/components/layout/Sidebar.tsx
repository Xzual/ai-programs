import React from 'react';
import {
  LayoutDashboard,
  MessageSquare,
  Code2,
  Brain,
  Zap,
  Boxes,
  Settings,
  Activity,
  Network,
  Cpu,
  ShieldCheck,
  ShieldAlert,
} from 'lucide-react';

export type ActiveTab =
  | 'dashboard'
  | 'chat'
  | 'code'
  | 'memory'
  | 'knowledge'
  | 'automations'
  | 'ops'
  | 'integrations'
  | 'settings';

interface SidebarProps {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  ollamaConnected: boolean;
  selectedModel: string;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  setActiveTab,
  ollamaConnected,
  selectedModel,
}) => {
  const menuItems = [
    { id: 'dashboard' as ActiveTab, label: 'Dashboard', icon: LayoutDashboard },
    { id: 'chat' as ActiveTab, label: 'Sohbet', icon: MessageSquare },
    { id: 'code' as ActiveTab, label: 'Kod Chat', icon: Code2 },
    { id: 'memory' as ActiveTab, label: 'Bellek', icon: Brain },
    { id: 'knowledge' as ActiveTab, label: 'Knowledge Map', icon: Network },
    { id: 'automations' as ActiveTab, label: 'Otomasyonlar', icon: Zap },
    { id: 'ops' as ActiveTab, label: 'EDITH Ops', icon: Activity },
    { id: 'integrations' as ActiveTab, label: 'Entegrasyonlar', icon: Boxes },
    { id: 'settings' as ActiveTab, label: 'Ayarlar', icon: Settings },
  ];

  return (
    <aside className="w-16 sm:w-64 bg-slate-950/80 backdrop-blur-xl border-r border-slate-800/60 flex flex-col justify-between py-4 px-2 sm:px-3 z-30 transition-all duration-300">
      {/* Top Brand Logo */}
      <div>
        <div className="flex items-center gap-3 px-2 py-3 mb-6">
          <div
            className="relative flex items-center justify-center w-10 h-10 rounded-xl p-[1px] shadow-lg"
            style={{
              background: 'linear-gradient(135deg, var(--edith-primary), var(--edith-accent), var(--edith-secondary))',
              boxShadow: '0 0 24px color-mix(in srgb, var(--edith-primary) 26%, transparent)',
            }}
          >
            <div className="w-full h-full bg-slate-950 rounded-[11px] flex items-center justify-center">
              <Cpu className="w-5 h-5 text-[var(--edith-accent)] animate-pulse" />
            </div>
          </div>
          <div className="hidden sm:block">
            <h1 className="text-lg font-extrabold tracking-widest text-[var(--edith-primary)] font-mono">
              E.D.I.T.H
            </h1>
            <p className="text-[10px] text-slate-400 font-mono tracking-tight">
              LOCAL AI OS
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
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-medium transition-all duration-200 group ${
                  isActive
                    ? 'bg-[var(--edith-primary)]/15 text-[var(--edith-text)] border border-[var(--edith-primary)]/40 shadow-lg'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
                }`}
              >
                <Icon
                  className={`w-5 h-5 transition-transform duration-200 group-hover:scale-110 ${
                    isActive ? 'text-[var(--edith-primary)]' : 'text-slate-400 group-hover:text-[var(--edith-accent)]'
                  }`}
                />
                <span className="hidden sm:inline font-sans">{item.label}</span>
                {isActive && (
                  <span className="hidden sm:block ml-auto w-1.5 h-1.5 rounded-full bg-[var(--edith-primary)] shadow-glow" />
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Bottom Status Card */}
      <div className="p-2 sm:p-3 rounded-xl bg-slate-900/50 border border-slate-800/80 text-xs">
        <div className="flex items-center gap-2">
          {ollamaConnected ? (
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : (
            <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
          )}
          <div className="hidden sm:block truncate">
            <div className="text-[11px] font-medium text-slate-300 flex items-center gap-1.5">
              <span>Ollama</span>
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  ollamaConnected ? 'bg-emerald-400' : 'bg-amber-400'
                }`}
              />
            </div>
            <p className="text-[10px] text-slate-400 truncate font-mono">
              {ollamaConnected ? selectedModel : 'Ayrık / Yedek Mod'}
            </p>
          </div>
        </div>
      </div>
    </aside>
  );
};
