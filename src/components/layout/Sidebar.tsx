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
  ChevronDown,
} from 'lucide-react';
import { ProviderRuntimeStatus } from '../../types';
import { providerStatusLabel, providerTone } from '../../edith/providerService';
import { fetchSettingsRuntimeSnapshot, type SettingsSkillSnapshot } from '../../edith/settingsRuntimeService';

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
  const [skillStatuses, setSkillStatuses] = React.useState<SettingsSkillSnapshot[]>([]);
  React.useEffect(() => {
    let mounted = true;
    const refresh = () => void fetchSettingsRuntimeSnapshot().then((snapshot) => {
      if (mounted) setSkillStatuses(snapshot.skills);
    });
    refresh();
    const timer = window.setInterval(refresh, 30_000);
    return () => { mounted = false; window.clearInterval(timer); };
  }, []);
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
  const primaryItems = [
    { id: 'voice' as ActiveTab, label: 'Voice Room', icon: BotMessageSquare },
    { id: 'computer' as ActiveTab, label: 'Computer Use', icon: Cpu },
    { id: 'crypto' as ActiveTab, label: 'Crypto Demo', icon: TrendingUp },
  ];
  const advancedItems = [
    { id: 'dashboard' as ActiveTab, label: 'Komuta Merkezi', icon: LayoutDashboard },
    { id: 'chat' as ActiveTab, label: 'Sohbet', icon: MessageSquare },
    { id: 'agents' as ActiveTab, label: 'Ajanlar', icon: Bot },
    { id: 'tasks' as ActiveTab, label: 'Görevler', icon: CalendarClock },
    { id: 'browser' as ActiveTab, label: 'Tarayıcı', icon: Chrome },
    { id: 'memory' as ActiveTab, label: 'Bellek', icon: Brain },
    { id: 'knowledge' as ActiveTab, label: 'Bilgi Grafiği', icon: Network },
    { id: 'automations' as ActiveTab, label: 'Otomasyonlar', icon: Zap },
    { id: 'files' as ActiveTab, label: 'Dosyalar', icon: Files },
    { id: 'code' as ActiveTab, label: 'Kodlama', icon: Code2 },
    { id: 'tools' as ActiveTab, label: 'Araçlar / MCP', icon: Wrench },
    { id: 'integrations' as ActiveTab, label: 'Entegrasyonlar', icon: Boxes },
    { id: 'security' as ActiveTab, label: 'Güvenlik', icon: ShieldCheck },
    { id: 'system' as ActiveTab, label: 'Sistem', icon: Activity },
  ];
  const [advancedOpen, setAdvancedOpen] = React.useState(() => advancedItems.some((item) => item.id === activeTab));
  const skillIdByTab: Partial<Record<ActiveTab, string>> = {
    voice: 'voice_room',
    computer: 'computer_use',
    crypto: 'crypto_demo_exchange',
  };

  React.useEffect(() => {
    if (advancedItems.some((item) => item.id === activeTab)) setAdvancedOpen(true);
  }, [activeTab]);

  const renderItem = (item: (typeof primaryItems)[number]) => {
    const Icon = item.icon;
    const isActive = activeTab === item.id;
    const capability = skillStatuses.find((entry) => entry.id === skillIdByTab[item.id]);
    return (
      <button
        key={item.id}
        onClick={() => setActiveTab(item.id)}
        title={item.label}
        className={`group relative flex w-full items-center gap-3 overflow-hidden rounded-lg px-3 py-2.5 text-xs font-medium transition-all duration-200 ${
          isActive
            ? 'border border-[var(--assistant-primary)]/34 bg-[var(--assistant-primary)]/14 text-slate-100 shadow-[0_0_28px_var(--assistant-glow),inset_0_1px_0_rgba(255,255,255,0.06)]'
            : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-200'
        }`}
      >
        <span className={`relative flex h-7 w-7 items-center justify-center rounded-md transition-all duration-300 ${isActive ? 'bg-[var(--assistant-primary)]/12 shadow-[0_0_22px_var(--assistant-glow)]' : 'bg-white/[0.025] group-hover:bg-[var(--assistant-primary)]/10'}`}>
          <Icon className={`relative z-10 h-5 w-5 transition-transform duration-200 group-hover:scale-110 ${isActive ? 'text-[var(--assistant-accent)]' : 'text-slate-300/86 group-hover:text-[var(--assistant-primary)]'}`} />
        </span>
        <span className="hidden min-w-0 truncate font-sans md:inline">{item.label}</span>
        {capability ? <span className={`ml-auto hidden rounded border px-1.5 py-0.5 font-mono text-[8px] uppercase md:block ${capability.status === 'ready' ? 'border-emerald-400/25 text-emerald-300' : capability.status === 'offline' || capability.status === 'broken' ? 'border-red-400/25 text-red-300' : 'border-amber-300/25 text-amber-200'}`}>{capability.status.replaceAll('_', ' ')}</span> : isActive ? <span className="ml-auto hidden h-1.5 w-1.5 rounded-full bg-[var(--assistant-primary)] shadow-[0_0_10px_var(--assistant-glow)] md:block" /> : null}
      </button>
    );
  };

  return (
    <aside className="relative top-0 z-30 flex h-full w-[var(--edith-sidebar-compact)] shrink-0 flex-col border-r border-white/10 bg-slate-950/58 px-2 py-3 shadow-[inset_-1px_0_0_rgba(255,255,255,0.04),0_0_44px_rgba(0,0,0,0.28)] backdrop-blur-2xl transition-all duration-300 md:w-[var(--edith-sidebar-wide)] md:px-3 md:py-4">
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
          <div className="hidden min-w-0 md:block">
            <h1 className="text-lg font-extrabold tracking-widest text-[var(--assistant-primary)] font-mono">
              E.D.I.T.H.
            </h1>
            <p className="text-[10px] text-slate-500 font-mono tracking-[0.22em]">
              KİŞİSEL YAPAY ZEKA İŞLETİM SİSTEMİ
            </p>
          </div>
        </div>

        {/* Navigation Items */}
        <nav className="space-y-1.5" aria-label="Primary navigation">
          {primaryItems.map(renderItem)}
          <div className="my-3 border-t border-white/8" />
          {renderItem({ id: 'settings', label: 'Ayarlar', icon: Settings })}
          <button
            type="button"
            onClick={() => setAdvancedOpen((open) => !open)}
            className="group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-xs font-medium text-slate-500 transition hover:bg-white/[0.035] hover:text-slate-300"
            aria-expanded={advancedOpen}
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-white/[0.025]"><SlidersHorizontal className="h-4 w-4" /></span>
            <span className="hidden min-w-0 flex-1 text-left md:inline">Gelişmiş / Geliştirici</span>
            <ChevronDown className={`hidden h-4 w-4 transition-transform md:block ${advancedOpen ? 'rotate-180' : ''}`} />
          </button>
          {advancedOpen && <div className="space-y-1 border-l border-white/8 pl-1 md:ml-3">{advancedItems.map(renderItem)}</div>}
        </nav>
      </div>

      {/* Bottom Status Card */}
      <div className="mt-3 rounded-lg border border-white/10 bg-black/45 p-2 text-xs shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] md:p-3">
        <div className="flex items-center gap-2">
          {statusIcon}
          <div className="hidden min-w-0 truncate md:block">
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
