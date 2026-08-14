import React, { useRef, useEffect } from 'react';
import {
  Copy,
  Check,
  Volume2,
  VolumeX,
  Bot,
  User,
  AlertTriangle,
  ExternalLink,
  Terminal,
} from 'lucide-react';
import { ChatMessage, UserSettings } from '../../types';

interface ChatPanelProps {
  messages: ChatMessage[];
  settings: UserSettings;
  ollamaConnected: boolean;
  onSpeakMessage: (text: string) => void;
  onOpenOllamaModal: () => void;
  activeSpeakingId?: string | null;
  className?: string;
}

export const ChatPanel: React.FC<ChatPanelProps> = ({
  messages,
  settings,
  ollamaConnected,
  onSpeakMessage,
  onOpenOllamaModal,
  activeSpeakingId,
  className = '',
}) => {
  const [copiedId, setCopiedId] = React.useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className={`flex flex-col h-full bg-slate-950/60 backdrop-blur-xl border-l border-slate-800/80 ${className}`}>
      {/* Panel Top Header */}
      <div className="p-3 sm:p-4 border-b border-slate-800/80 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bot className="w-4 h-4 text-[var(--edith-accent)]" />
          <h3 className="text-xs font-semibold text-slate-200 tracking-wider font-mono uppercase">
            Sohbet
          </h3>
        </div>
        <span className="text-[10px] text-slate-500 font-mono">
          {messages.length} Mesaj
        </span>
      </div>

      {/* Ollama Offline Banner */}
      {!ollamaConnected && settings.aiProvider === 'ollama' && (
        <div className="m-3 p-3 rounded-xl bg-amber-950/40 border border-amber-500/30 text-amber-200 text-xs flex items-start gap-2.5 shadow-lg">
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
      <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-4 custom-scrollbar">
        {messages.map((msg) => {
          const isUser = msg.sender === 'user';
          const isAssistant = msg.sender === 'assistant';

          return (
            <div
              key={msg.id}
              className={`flex items-start gap-3 ${
                isUser ? 'flex-row-reverse' : 'flex-row'
              } animate-fadeIn`}
            >
              {/* Avatar Icon */}
              <div
                className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 text-xs font-semibold shadow-md ${
                  isUser
                    ? 'text-white'
                    : 'text-white'
                }`}
                style={{
                  background: isUser
                    ? 'linear-gradient(135deg, var(--edith-secondary), var(--edith-primary))'
                    : 'linear-gradient(135deg, var(--edith-primary), var(--edith-accent))',
                }}
              >
                {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
              </div>

              {/* Message Bubble Container */}
              <div
                className={`max-w-[85%] rounded-2xl p-3.5 text-xs sm:text-sm leading-relaxed ${
                  isUser
                    ? 'bg-slate-900 border border-slate-700/80 text-slate-100 rounded-tr-none'
                    : 'bg-slate-900/90 border border-[var(--edith-primary)]/30 text-slate-200 rounded-tl-none shadow-lg'
                }`}
                style={
                  isAssistant
                    ? { boxShadow: '0 18px 36px color-mix(in srgb, var(--edith-primary) 14%, transparent)' }
                    : undefined
                }
              >
                {/* Header Meta */}
                <div className="flex items-center justify-between gap-2 mb-1.5 text-[10px] text-slate-400 font-mono">
                  <span className="font-semibold text-slate-300">
                    {isUser ? settings.userName : 'AURA'}
                  </span>
                  <span>
                    {new Date(msg.timestamp).toLocaleTimeString('tr-TR', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>

                {/* Message Body Content */}
                <div className="whitespace-pre-wrap break-words font-sans">
                  {msg.text}
                  {msg.isStreaming && (
                    <span className="inline-block w-1.5 h-4 ml-1 bg-[var(--edith-accent)] animate-pulse align-middle" />
                  )}
                </div>

                {/* Footer Controls for Assistant Messages */}
                {isAssistant && !msg.isStreaming && (
                  <div className="mt-2.5 pt-2 border-t border-slate-800/80 flex items-center justify-end gap-2">
                    {/* Speak Message Button */}
                    <button
                      onClick={() => onSpeakMessage(msg.text)}
                      className={`p-1 rounded hover:bg-slate-800 transition-colors ${
                        activeSpeakingId === msg.id
                          ? 'text-[var(--edith-accent)] animate-pulse'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                      title="Sesli Okut"
                    >
                      <Volume2 className="w-3.5 h-3.5" />
                    </button>

                    {/* Copy Text Button */}
                    <button
                      onClick={() => copyToClipboard(msg.text, msg.id)}
                      className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
                      title="Kopyala"
                    >
                      {copiedId === msg.id ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>
    </div>
  );
};
