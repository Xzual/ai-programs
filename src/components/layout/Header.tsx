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
  const activeProviderStatus = activeProvider?.status ?? 'unknown';
  const providerOptions = providerProfiles.length ? providerProfiles : [];
  const modelOptions = modelsForProvider(settings.aiProvider, providerProfiles, availableModels);

  const handleProviderChange = (provider: AiProvider) => {
    const nextModels = modelsForProvider(provider, providerProfiles, availableModels);
    const nextProfile = providerProfiles.find((profile) => profile.provider === provider);
    const selectedModel = nextModels.includes(settings.selectedModel)
      ? settings.selectedModel
      : nextProfile?.defaultModel ?? 'auto';
    onUpdateSettings({ aiProvider: provider, selectedModel });
  };

  return (
    <header className="relative top-0 z-20 flex h-16 shrink-0 items-center justify-between gap-3 border-b border-white/10 bg-slate-950/55 px-3 shadow-[inset_0_-1px_0_rgba(255,255,255,0.04)] backdrop-blur-2xl sm:px-5">
      {/* Left Title & Status */}
      <div className="flex min-w-0 items-center gap-3">
        <div className="hidden lg:block">
          <div className="font-mono text-sm font-bold tracking-[0.24em] text-slate-100">E.D.I.T.H.</div>
          <div className="mt-0.5 text-[10px] tracking-[0.18em] text-slate-500">ENHANCED DIGITAL INTELLIGENCE</div>
        </div>
        <div className="relative">
          <button
            onClick={() => setProfileOpen((open) => !open)}
            className="group flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.035] px-3 py-2 text-xs font-semibold tracking-wide text-slate-100 transition-colors duration-300 hover:text-[var(--assistant-primary)]"
          >
            <Bot className="h-4 w-4 text-[var(--assistant-primary)]" />
            <span className="hidden sm:inline">Assistant:</span>
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

        <div className="hidden xl:flex items-center gap-2 rounded-md border border-white/10 bg-slate-950/54 px-2.5 py-1.5 text-[11px] font-mono text-slate-300">
          <Cloud className="h-3.5 w-3.5 text-[var(--assistant-primary)]" />
          <label className="text-slate-500" htmlFor="edith-provider-selector">Provider</label>
          <select
            id="edith-provider-selector"
            value={settings.aiProvider}
            onChange={(event) => handleProviderChange(event.target.value as AiProvider)}
            className="max-w-36 bg-transparent text-slate-100 outline-none"
            title="Select model provider without changing assistant persona"
          >
            {providerOptions.map((profile) => (
              <option key={profile.provider} value={profile.provider} className="bg-slate-950 text-slate-100">
                {profile.displayName}
              </option>
            ))}
          </select>
        </div>

        <div className="hidden xl:flex items-center gap-2 rounded-md border border-white/10 bg-slate-950/54 px-2.5 py-1.5 text-[11px] font-mono text-slate-300">
          <Server className="h-3.5 w-3.5 text-[var(--assistant-primary)]" />
          <label className="text-slate-500" htmlFor="edith-model-selector">Model</label>
          <select
            id="edith-model-selector"
            value={settings.selectedModel || 'auto'}
            onChange={(event) => onUpdateSettings({ selectedModel: event.target.value })}
            className="max-w-44 bg-transparent text-[var(--assistant-primary)] outline-none"
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
          <div className="hidden 2xl:block">
            <StatusPill label="AUTO MODE" value="ROUTED" tone="info" />
          </div>
        )}

        {/* Connection Status Button */}
        <button
          onClick={onTestConnection}
          disabled={isTestingConnection}
          className={`hidden md:flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-mono border transition-all ${
            ollamaConnected
              ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-300 hover:bg-emerald-900/40'
              : 'bg-amber-950/40 border-amber-500/30 text-amber-300 hover:bg-amber-900/40'
          }`}
          title="Ollama bağlantısını test etmek için tıklayın"
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
          className={`hidden lg:flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] font-mono transition-all ${
            providerTone(activeProviderStatus) === 'success'
              ? 'border-emerald-500/30 bg-emerald-950/40 text-emerald-300'
              : providerTone(activeProviderStatus) === 'danger'
              ? 'border-red-500/30 bg-red-950/40 text-red-300'
              : 'border-amber-500/30 bg-amber-950/40 text-amber-300'
          }`}
          title={activeProvider?.requiredEnv.length ? `Required environment: ${activeProvider.requiredEnv.join(', ')}` : 'Provider status'}
        >
          {activeProviderStatus === 'available' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
          <span>{providerDisplayName(settings.aiProvider)}</span>
          <span className="text-current/75">{providerStatusLabel(activeProviderStatus)}</span>
        </button>

        <div className="hidden 2xl:flex items-center gap-2">
          <StatusPill label="Gemini" value={providerHealth.geminiAvailable ? 'CONFIGURED' : 'SET GEMINI_API_KEY'} tone={providerHealth.geminiAvailable ? 'success' : 'warning'} />
          <StatusPill label="Local" value={ollamaConnected ? 'OLLAMA ONLINE' : 'OLLAMA OFFLINE'} tone={ollamaConnected ? 'success' : 'warning'} />
        </div>

        <div className="hidden 2xl:flex items-center gap-2">
          <StatusPill label="Voice" value={settings.autoSpeech ? 'ON' : 'OFF'} tone={settings.autoSpeech ? 'success' : 'muted'} />
          <StatusPill label="Network" value="UI ONLY" tone="muted" />
          <StatusPill label="Computer" value="READ" tone="success" />
          <StatusPill label="Automation" value="GATED" tone="info" />
          <StatusPill label="Security" value="GUARDED" tone="success" />
        </div>

      </div>

      {/* Right Controls */}
      <div className="flex items-center gap-2">
        <div className="hidden lg:flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-slate-950/54 border border-white/10 text-[11px] font-mono text-slate-300">
          <UserRound className="w-3 h-3 text-[var(--assistant-primary)]" />
          <span>{authSession.user.name}</span>
        </div>

        {/* Toggle Auto Speech */}
        <button
          onClick={onToggleAutoSpeech}
          className={`p-2 rounded-xl border text-xs transition-colors ${
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
          className="p-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
          title="Sohbeti Temizle"
        >
          <RotateCcw className="w-4 h-4" />
        </button>

        {/* New Chat Button */}
        <button
          onClick={onNewChat}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-slate-950 text-xs font-semibold shadow-md transition-all"
          style={{ background: 'linear-gradient(135deg, var(--assistant-primary), var(--assistant-accent))' }}
        >
          <PlusCircle className="w-4 h-4" />
          <span className="hidden sm:inline">Yeni Sohbet</span>
        </button>

        <button
          onClick={onEmergencyStop}
          className="hidden sm:flex items-center gap-1.5 px-3 py-2 rounded-lg border border-red-400/40 bg-red-500/12 text-red-100 text-xs font-semibold hover:bg-red-500/20"
          title="Emergency Stop: konuşmayı ve aktif yayın durumunu durdurur"
        >
          <Power className="w-4 h-4" />
          <span className="hidden xl:inline">Emergency Stop</span>
        </button>

        <button
          onClick={onLogout}
          className="p-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
          title="Çıkış Yap"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
};
