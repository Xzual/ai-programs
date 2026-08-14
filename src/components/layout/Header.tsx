import React, { useState } from 'react';
import { Activity, ChevronDown, PlusCircle, RotateCcw, Volume2, VolumeX } from 'lucide-react';
import { UserSettings } from '../../types';
import assistantProfiles from '../../config/assistantProfiles.json';

interface HeaderProps {
  settings: UserSettings;
  ollamaConnected: boolean;
  onNewChat: () => void;
  onResetChat: () => void;
  onTestConnection: () => void;
  onToggleAutoSpeech: () => void;
  onUpdateSettings: (updates: Partial<UserSettings>) => void;
  isTestingConnection: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  settings,
  ollamaConnected,
  onNewChat,
  onResetChat,
  onTestConnection,
  onToggleAutoSpeech,
  onUpdateSettings,
  isTestingConnection,
}) => {
  const [profileOpen, setProfileOpen] = useState(false);
  const activeProfile =
    assistantProfiles.find((profile) => profile.id === settings.assistantPersona) ||
    assistantProfiles[0];

  return (
    <header className="h-16 border-b border-slate-800/80 bg-slate-950/60 backdrop-blur-xl px-4 sm:px-6 flex items-center justify-between z-20">
      {/* Left Title & Status */}
      <div className="flex items-center gap-3">
        <div className="relative">
          <button
            onClick={() => setProfileOpen((open) => !open)}
            className="group flex items-center gap-2 rounded-lg px-1 py-1 text-sm sm:text-base font-semibold tracking-wide text-slate-100 hover:text-[var(--edith-primary)] transition-colors duration-300"
          >
            <span>{activeProfile.name}</span>
            <ChevronDown
              className={`w-4 h-4 text-[var(--edith-primary)] transition-transform duration-300 ${profileOpen ? 'rotate-180' : ''}`}
            />
          </button>

          {profileOpen && (
            <div className="edith-profile-menu absolute left-0 top-10 w-56 rounded-lg border border-slate-700/70 bg-slate-950/92 backdrop-blur-2xl shadow-2xl shadow-black/50 p-1.5 z-50">
              {assistantProfiles.map((profile) => {
                const active = profile.id === activeProfile.id;
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

        {/* Model Badge */}
        <div className="hidden md:flex items-center gap-2 px-2.5 py-1 rounded-full bg-slate-900 border border-slate-800 text-[11px] font-mono text-slate-300">
          <span className="text-slate-500">Model:</span>
          <span className="text-[var(--edith-primary)] font-medium">
            {settings.aiProvider === 'ollama'
              ? settings.selectedModel
              : settings.aiProvider === 'gemini'
              ? 'Gemini 2.5 Flash'
              : 'EDITH Yerel Mock Motoru'}
          </span>
        </div>

        {/* Connection Status Button */}
        <button
          onClick={onTestConnection}
          disabled={isTestingConnection}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono border transition-all ${
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
              ? 'Test ediliyor...'
              : ollamaConnected
              ? 'Ollama Aktif'
              : 'Ollama Çevrimdışı'}
          </span>
        </button>

      </div>

      {/* Right Controls */}
      <div className="flex items-center gap-2">
        {/* Toggle Auto Speech */}
        <button
          onClick={onToggleAutoSpeech}
          className={`p-2 rounded-xl border text-xs transition-colors ${
            settings.autoSpeech
              ? 'bg-[var(--edith-primary)]/20 border-[var(--edith-primary)]/40 text-[var(--edith-accent)]'
              : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
          }`}
          title={
            settings.autoSpeech
              ? 'Otomatik Seslendirme Açık'
              : 'Otomatik Seslendirme Kapalı'
          }
        >
          {settings.autoSpeech ? (
            <Volume2 className="w-4 h-4 text-[var(--edith-primary)]" />
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
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-slate-950 text-xs font-medium shadow-md transition-all"
          style={{ background: 'linear-gradient(135deg, var(--edith-primary), var(--edith-accent))' }}
        >
          <PlusCircle className="w-4 h-4" />
          <span className="hidden sm:inline">Yeni Sohbet</span>
        </button>
      </div>
    </header>
  );
};
