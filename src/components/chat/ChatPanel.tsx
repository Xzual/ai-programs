import React, { useRef, useEffect } from 'react';
import {
  Bot,
  AlertTriangle,
  Terminal,
} from 'lucide-react';
import { AssistantProfile, ChatMessage, UserSettings } from '../../types';
import { TransmissionCard } from '../ui/edithOS';

interface ChatPanelProps {
  messages: ChatMessage[];
  settings: UserSettings;
  ollamaConnected: boolean;
  onSpeakMessage: (text: string) => void;
  onOpenOllamaModal: () => void;
  activeSpeakingId?: string | null;
  assistantProfile: AssistantProfile;
  className?: string;
}

export const ChatPanel: React.FC<ChatPanelProps> = ({
  messages,
  settings,
  ollamaConnected,
  onSpeakMessage,
  onOpenOllamaModal,
  activeSpeakingId,
  assistantProfile,
  className = '',
}) => {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className={`relative flex flex-col overflow-hidden bg-black/28 backdrop-blur-[34px] border border-white/10 shadow-[inset_1px_1px_0_rgba(255,255,255,0.07),0_24px_70px_rgba(0,0,0,0.32)] ${className}`}>
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(142deg,var(--assistant-glow),transparent_18%,transparent_68%,rgba(255,255,255,0.04)),radial-gradient(circle_at_18%_12%,var(--assistant-glow),transparent_24%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(255,255,255,0.045),transparent_8%,transparent_92%,rgba(255,255,255,0.03))]" />
      <div className="pointer-events-none absolute inset-x-3 top-0 h-px bg-gradient-to-r from-transparent via-[var(--assistant-primary)]/50 to-transparent" />

      <div className="relative p-3 sm:p-4 border-b border-white/10 flex items-center justify-between bg-white/[0.025]">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-[var(--assistant-primary)]/10 border border-[var(--assistant-primary)]/20 flex items-center justify-center">
            <Bot className="w-4 h-4 text-[var(--assistant-primary)]" />
          </div>
          <h3 className="text-xs font-semibold text-slate-200 tracking-wider font-mono uppercase">
            Transmission Console
          </h3>
        </div>
        <span className="text-[10px] text-slate-500 font-mono">
          {messages.length} Mesaj
        </span>
      </div>

      {/* Ollama Offline Banner */}
      {!ollamaConnected && settings.aiProvider === 'ollama' && (
        <div className="relative m-3 p-3 rounded-xl bg-amber-500/13 backdrop-blur-xl border border-amber-300/35 text-amber-200 text-xs flex items-start gap-2.5 shadow-[0_14px_36px_rgba(245,158,11,0.16),inset_0_1px_0_rgba(255,255,255,0.08)]">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-medium text-amber-300">Ollama Yerel Sunucu Bağlantısı Yok</p>
            <p className="text-[11px] text-amber-200/80 mt-0.5">
              Varsayılan <code className="bg-amber-900/60 px-1 py-0.5 rounded font-mono">http://localhost:11434</code> adresi bulunamadı.
            </p>
            <div className="mt-2 flex items-center gap-2">
              <button
                onClick={onOpenOllamaModal}
                className="px-2.5 py-1 rounded bg-amber-600 hover:bg-amber-500 text-slate-950 font-semibold text-[11px] flex items-center gap-1 transition-colors"
              >
                <Terminal className="w-3 h-3" />
                Kurulum Yönergesini Aç
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Messages List Container */}
      <div className="relative flex-1 overflow-y-auto p-3 sm:p-4 space-y-4 custom-scrollbar bg-[radial-gradient(circle_at_80%_20%,var(--assistant-glow),transparent_28%),radial-gradient(circle_at_20%_90%,rgba(255,255,255,0.04),transparent_28%)]">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={activeSpeakingId === msg.id ? 'rounded-lg ring-1 ring-[var(--assistant-primary)]/60 shadow-[0_0_26px_var(--assistant-glow)]' : ''}
          >
            <TransmissionCard
              message={msg}
              settings={settings}
              assistantName={msg.assistantName ?? assistantProfile.name}
              onSpeak={msg.sender === 'assistant' ? onSpeakMessage : undefined}
            />
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>
    </div>
  );
};
