import React, { useState } from 'react';
import { Activity, AlertTriangle, Bot, CheckCircle2, ChevronDown, Cloud, LogOut, PlusCircle, Power, RotateCcw, Server, UserRound, Volume2, VolumeX } from 'lucide-react';
import { AiProvider, AssistantProfile, EdithAuthSession, ProviderHealthSnapshot, ProviderProfile, UserSettings } from '../../types';
import { StatusPill } from '../ui/edithOS';
import { modelsForProvider, providerDisplayName, providerStatusLabel, providerTone } from '../../edith/providerService';

interface HeaderProps {
  settings: UserSettings;
  activeAssistant: AssistantProfile;
  assistantProfiles: AssistantProfile[];
  authSession: EdithAuthSession;
  ollamaConnected: boolean;
  providerProfiles: ProviderProfile[];
  providerHealth: ProviderHealthSnapshot;
  availableModels: string[];
  onNewChat: () => void;
  onResetChat: () => void;
  onTestConnection: () => void;
  onToggleAutoSpeech: () => void;
  onUpdateSettings: (updates: Partial<UserSettings>) => void;
  onEmergencyStop: () => void;
  onLogout: () => void;
  isTestingConnection: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  settings,
  activeAssistant,
  assistantProfiles,
  authSession,
  ollamaConnected,
  providerProfiles,
  providerHealth,
  availableModels,
  onNewChat,
  onResetChat,
  onTestConnection,
  onToggleAutoSpeech,
  onUpdateSettings,
  onEmergencyStop,
  onLogout,
  isTestingConnection,
}) => {
  const [profileOpen, setProfileOpen] = useState(false);
  const activeProvider = providerProfiles.find((profile) => profile.provider === settings.aiProvider);
  const geminiProvider = providerProfiles.find((profile) => profile.provider === 'gemini');
  const ollamaProvider = providerProfiles.find((profile) => profile.provider === 'ollama');
  const activeProviderStatus = activeProvider?.status ?? 'unknown';
  const providerOptions = providerProfiles.length ? providerProfiles : [];
  const modelOptions = modelsForProvider(settings.aiProvider, providerProfiles, availableModels, settings.selectedModel);

  const handleProviderChange = (provider: AiProvider) => {
    const nextModels = modelsForProvider(provider, providerProfiles, availableModels, settings.selectedModel);
    const nextProfile = providerProfiles.find((profile) => profile.provider === provider);
    const selectedModel = nextModels.includes(settings.selectedModel)
      ? settings.selectedModel
      : nextProfile?.defaultModel ?? 'auto';
    onUpdateSettings({ aiProvider: provider, selectedModel });
  };

  return (
    <header className="relative top-0 z-20 flex min-h-16 shrink-0 items-center justify-between gap-3 border-b border-white/10 bg-slate-950/55 px-3 py-2 shadow-[inset_0_-1px_0_rgba(255,255,255,0.04)] backdrop-blur-2xl sm:px-5">
      {/* Left Title & Status */}
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
        <div className="hidden 2xl:block shrink-0">
          <div className="font-mono text-sm font-bold tracking-[0.24em] text-slate-100">E.D.I.T.H.</div>
          <div className="mt-0.5 text-[10px] tracking-[0.18em] text-slate-500">ENHANCED DIGITAL INTELLIGENCE</div>
        </div>
        <div className="relative shrink-0">
          <button
            onClick={() => setProfileOpen((open) => !open)}
            className="group flex h-9 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.035] px-3 text-xs font-semibold tracking-wide text-slate-100 transition-colors duration-300 hover:text-[var(--assistant-primary)]"
          >
            <Bot className="h-4 w-4 text-[var(--assistant-primary)]" />
            <span className="hidden lg:inline">Assistant:</span>
            <span>{activeAssistant.name}</span>
            <ChevronDown
              className={`w-4 h-4 text-[var(--assistant-primary)] transition-transform duration-300 ${profileOpen ? 'rotate-180' : ''}`}
            />
          </button>

          {profileOpen && (
            <div className="edith-profile-menu absolute left-0 top-12 w-60 rounded-lg border border-slate-700/70 bg-slate-950/95 backdrop-blur-2xl shadow-2xl shadow-black/50 p-1.5 z-50">
              {assistantProfiles.map((profile) => {
                const active = profile.id === activeAssistant.id;
                return (
                  <button
                    key={profile.id}
                    onClick={() => {
                      onUpdateSettings({ assistantPersona: profile.id as UserSettings['assistantPersona'] });
                      setProfileOpen(false);
                    }}
                    className={`edith-profile-option relative overflow-hidden w-full flex items-center justify-between gap-3 rounded-md px-3 py-2.5 text-left text-xs transition-all duration-300 ${
                      active ? 'text-slate-950' : 'text-slate-300 hover:text-slate-950'
                    }`}
                    style={{
                      background: active
                        ? `linear-gradient(90deg, ${profile.primary}, ${profile.secondary}, ${profile.accent})`
                        : 'transparent',
                    }}
                  >
                    <span
                      className="edith-profile-option__glow absolute inset-0 opacity-0 transition-opacity duration-300"
                      style={{ background: `linear-gradient(90deg, ${profile.primary}, ${profile.secondary}, ${profile.accent})` }}
                    />
                    <span className="relative z-10 font-mono font-semibold">{profile.name}</span>
                    <span
                      className="relative z-10 w-8 h-2 rounded-full border border-white/20"
                      style={{ background: `linear-gradient(90deg, ${profile.primary}, ${profile.accent})` }}
                    />
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="hidden min-w-0 max-w-[15rem] flex-1 items-center gap-2 rounded-md border border-white/10 bg-slate-950/54 px-2.5 py-1.5 text-[11px] font-mono text-slate-300 xl:flex">
          <Cloud className="h-3.5 w-3.5 text-[var(--assistant-primary)]" />
          <label className="hidden text-slate-500 2xl:inline" htmlFor="edith-provider-selector">Provider</label>
          <select
            id="edith-provider-selector"
            value={settings.aiProvider}
            onChange={(event) => handleProviderChange(event.target.value as AiProvider)}
            className="min-w-0 flex-1 bg-transparent text-slate-100 outline-none"
            title="Select model provider without changing assistant persona"
          >
            {providerOptions.map((profile) => (
              <option key={profile.provider} value={profile.provider} className="bg-slate-950 text-slate-100">
                {profile.displayName}
              </option>
            ))}
          </select>
        </div>

        <div className="hidden min-w-0 max-w-[16rem] flex-1 items-center gap-2 rounded-md border border-white/10 bg-slate-950/54 px-2.5 py-1.5 text-[11px] font-mono text-slate-300 xl:flex">
          <Server className="h-3.5 w-3.5 text-[var(--assistant-primary)]" />
          <label className="hidden text-slate-500 2xl:inline" htmlFor="edith-model-selector">Model</label>
          <select
            id="edith-model-selector"
            value={settings.selectedModel || 'auto'}
            onChange={(event) => onUpdateSettings({ selectedModel: event.target.value })}
            className="min-w-0 flex-1 bg-transparent text-[var(--assistant-primary)] outline-none"
            title="Select model without changing assistant persona"
          >
            {modelOptions.map((model) => (
              <option key={model} value={model} className="bg-slate-950 text-slate-100">
                {model === 'auto' ? 'AUTO' : model}
              </option>
            ))}
          </select>
        </div>

        {settings.selectedModel === 'auto' && (
          <div className="hidden min-[2100px]:block">
            <StatusPill label="AUTO MODE" value="ROUTED" tone="info" />
          </div>
        )}

        {/* Connection Status Button */}
        <button
          onClick={onTestConnection}
          disabled={isTestingConnection}
          className={`hidden min-[1700px]:flex shrink-0 items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-mono border transition-all ${
            ollamaConnected
              ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-300 hover:bg-emerald-900/40'
              : 'bg-amber-950/40 border-amber-500/30 text-amber-300 hover:bg-amber-900/40'
          }`}
          title="Provider bağlantılarını test etmek için tıklayın"
        >
          <Activity
            className={`w-3 h-3 ${
              isTestingConnection ? 'animate-spin text-[var(--edith-accent)]' : ''
            }`}
          />
          <span className="hidden sm:inline">
            {isTestingConnection
              ? 'Testing...'
              : ollamaConnected
              ? 'Ollama Online'
              : 'Ollama Offline'}
          </span>
        </button>

        <button
          onClick={onTestConnection}
          disabled={isTestingConnection}
          className={`hidden xl:flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] font-mono transition-all ${
            providerTone(activeProviderStatus) === 'success'
              ? 'border-emerald-500/30 bg-emerald-950/40 text-emerald-300'
              : providerTone(activeProviderStatus) === 'danger'
              ? 'border-red-500/30 bg-red-950/40 text-red-300'
              : 'border-amber-500/30 bg-amber-950/40 text-amber-300'
          }`}
          title={activeProvider?.requiredEnv.length ? `Required environment: ${activeProvider.requiredEnv.join(', ')}` : 'Provider status'}
        >
          {activeProviderStatus === 'available' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
          <span className="max-w-24 truncate">{providerDisplayName(settings.aiProvider)}</span>
          <span className="text-current/75">{providerStatusLabel(activeProviderStatus)}</span>
        </button>

        <div className="hidden min-[2100px]:flex items-center gap-2">
          <StatusPill
            label="Gemini"
            value={providerStatusLabel(geminiProvider?.status ?? (providerHealth.geminiAvailable ? 'available' : 'configuration_required'))}
            tone={providerTone(geminiProvider?.status ?? (providerHealth.geminiAvailable ? 'available' : 'configuration_required'))}
          />
          <StatusPill
            label="Local"
            value={providerStatusLabel(ollamaProvider?.status ?? (ollamaConnected ? 'available' : 'offline'))}
            tone={providerTone(ollamaProvider?.status ?? (ollamaConnected ? 'available' : 'offline'))}
          />
        </div>

        <div className="hidden min-[2300px]:flex items-center gap-2">
          <StatusPill label="Voice" value={settings.autoSpeech ? 'ON' : 'OFF'} tone={settings.autoSpeech ? 'success' : 'muted'} />
          <StatusPill label="Network" value="UI ONLY" tone="muted" />
          <StatusPill label="Computer" value="READ" tone="success" />
          <StatusPill label="Automation" value="GATED" tone="info" />
          <StatusPill label="Security" value="GUARDED" tone="success" />
        </div>

      </div>

      {/* Right Controls */}
      <div className="flex shrink-0 items-center gap-1.5">
        <div className="hidden max-w-28 items-center gap-2 rounded-md border border-white/10 bg-slate-950/54 px-2.5 py-1.5 text-[11px] font-mono text-slate-300 min-[1800px]:flex">
          <UserRound className="w-3 h-3 text-[var(--assistant-primary)]" />
          <span className="truncate">{authSession.user.name}</span>
        </div>

        {/* Toggle Auto Speech */}
        <button
          onClick={onToggleAutoSpeech}
          className={`rounded-lg border p-2 text-xs transition-colors ${
            settings.autoSpeech
              ? 'bg-[var(--assistant-primary)]/20 border-[var(--assistant-primary)]/40 text-[var(--assistant-accent)]'
              : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
          }`}
          title={
            settings.autoSpeech
              ? 'Otomatik Seslendirme Açık'
              : 'Otomatik Seslendirme Kapalı'
          }
        >
          {settings.autoSpeech ? (
            <Volume2 className="w-4 h-4 text-[var(--assistant-primary)]" />
          ) : (
            <VolumeX className="w-4 h-4 text-slate-400" />
          )}
        </button>

        {/* Reset Active Chat */}
        <button
          onClick={onResetChat}
          className="rounded-lg border border-slate-800 bg-slate-900 p-2 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
          title="Sohbeti Temizle"
        >
          <RotateCcw className="w-4 h-4" />
        </button>

        {/* New Chat Button */}
        <button
          onClick={onNewChat}
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-semibold text-slate-950 shadow-md transition-all sm:px-3"
          style={{ background: 'linear-gradient(135deg, var(--assistant-primary), var(--assistant-accent))' }}
        >
          <PlusCircle className="w-4 h-4" />
          <span className="hidden md:inline">Yeni Sohbet</span>
        </button>

        <button
          onClick={onEmergencyStop}
          className="flex items-center justify-center rounded-lg border border-red-400/40 bg-red-500/12 p-2 text-xs font-semibold text-red-100 hover:bg-red-500/20"
          title="Emergency Stop: konuşmayı ve aktif yayın durumunu durdurur"
        >
          <Power className="w-4 h-4" />
        </button>

        <button
          onClick={onLogout}
          className="rounded-lg border border-slate-800 bg-slate-900 p-2 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
          title="Çıkış Yap"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
};
