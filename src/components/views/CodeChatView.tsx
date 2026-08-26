import React, { useEffect, useRef, useState } from 'react';
import {
  Bot,
  Check,
  Code2,
  Copy,
  FileCode2,
  GitBranch,
  Loader2,
  Send,
  Sparkles,
  Terminal,
  User,
} from 'lucide-react';
import { AssistantProfile, ChatMessage, UserSettings } from '../../types';

interface CodeChatViewProps {
  messages: ChatMessage[];
  settings: UserSettings;
  assistantProfile: AssistantProfile;
  onSendMessage: (text: string) => void;
  onReset: () => void;
  isStreaming: boolean;
}

function splitCodeBlocks(text: string): Array<{ type: 'text' | 'code'; content: string; language?: string }> {
  const parts: Array<{ type: 'text' | 'code'; content: string; language?: string }> = [];
  const regex = /```(\w+)?\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', content: text.slice(lastIndex, match.index) });
    }
    parts.push({ type: 'code', language: match[1] || 'text', content: match[2].trimEnd() });
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push({ type: 'text', content: text.slice(lastIndex) });
  }

  return parts.length ? parts : [{ type: 'text', content: text }];
}

export const CodeChatView: React.FC<CodeChatViewProps> = ({
  messages,
  settings,
  assistantProfile,
  onSendMessage,
  onReset,
  isStreaming,
}) => {
  const [input, setInput] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = () => {
    const text = input.trim();
    if (!text || isStreaming) return;
    onSendMessage(text);
    setInput('');
  };

  const copy = async (text: string, id: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 1600);
  };

  const quickPrompts = [
    { icon: FileCode2, label: 'Bileşen Yaz', prompt: 'React ve TypeScript ile temiz, erişilebilir bir bileşen yaz.' },
    { icon: Terminal, label: 'Hata Açıkla', prompt: 'Bu hatayı açıkla, kök nedeni bul ve düzeltme öner.' },
    { icon: GitBranch, label: 'Refactor Planı', prompt: 'Bu kod için küçük ve güvenli bir refactor planı çıkar.' },
  ];

  return (
    <div className="flex-1 min-h-0 bg-slate-950 text-slate-100 flex">
      <section className="flex-1 min-w-0 flex flex-col border-r border-slate-800/80">
        <div className="px-5 py-4 border-b border-slate-800/80 bg-slate-950/90 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg border border-[var(--edith-primary)]/30 bg-[var(--edith-primary)]/10 flex items-center justify-center">
              <Code2 className="w-5 h-5 text-[var(--edith-accent)]" />
            </div>
            <div>
              <h2 className="text-sm font-semibold tracking-wide text-slate-100">Kod Chat</h2>
              <p className="text-[11px] text-slate-500 font-mono">{assistantProfile.name} · ayrı geçmiş · kod odaklı sistem prompt’u</p>
            </div>
          </div>
          <button
            onClick={onReset}
            className="px-3 py-1.5 rounded-lg border border-slate-800 bg-slate-900 text-[11px] text-slate-300 hover:text-white hover:border-slate-700 transition-colors"
          >
            Temizle
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4 custom-scrollbar">
          {messages.map((msg) => {
            const isUser = msg.sender === 'user';
            const blocks = splitCodeBlocks(msg.text);
            return (
              <div key={msg.id} className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'} animate-fadeIn`}>
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-white"
                  style={{
                    background: isUser
                      ? 'linear-gradient(135deg, var(--edith-secondary), var(--edith-primary))'
                      : 'linear-gradient(135deg, var(--edith-primary), var(--edith-accent))',
                  }}
                >
                  {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                </div>
                <div className={`max-w-[86%] border rounded-lg ${isUser ? 'bg-slate-900 border-slate-700' : 'bg-slate-900/80 border-[var(--edith-primary)]/25'}`}>
                  <div className="px-3 py-2 border-b border-slate-800/80 flex items-center justify-between gap-3">
                    <span className="text-[11px] font-mono text-slate-400">{isUser ? settings.userName : `${msg.assistantName ?? assistantProfile.name} Code`}</span>
                    <button
                      onClick={() => copy(msg.text, msg.id)}
                      className="p-1 rounded text-slate-500 hover:text-slate-200 hover:bg-slate-800 transition-colors"
                      title="Kopyala"
                    >
                      {copied === msg.id ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                  <div className="p-3 text-sm leading-relaxed">
                    {blocks.map((block, idx) =>
                      block.type === 'code' ? (
                        <div key={idx} className="my-3 overflow-hidden rounded-lg border border-slate-700 bg-slate-950">
                          <div className="px-3 py-1.5 border-b border-slate-800 text-[10px] font-mono text-[var(--edith-accent)] uppercase">
                            {block.language}
                          </div>
                          <pre className="overflow-x-auto p-3 text-xs leading-relaxed text-slate-200 font-mono">
                            <code>{block.content}</code>
                          </pre>
                        </div>
                      ) : (
                        <div key={idx} className="whitespace-pre-wrap break-words text-slate-200">
                          {block.content}
                        </div>
                      )
                    )}
                    {msg.isStreaming && <Loader2 className="inline ml-2 w-3.5 h-3.5 animate-spin text-[var(--edith-accent)]" />}
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={endRef} />
        </div>

        <div className="p-4 border-t border-slate-800/80 bg-slate-950/95">
          <div className="flex items-end gap-2 rounded-lg border border-slate-800 bg-slate-900/90 focus-within:border-[var(--edith-primary)]/50 focus-within:ring-1 focus-within:ring-[var(--edith-primary)]/20">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              rows={3}
              disabled={isStreaming}
              placeholder="Kod isteğini yaz... örn: Bu React bileşenini refactor et, TypeScript tiplerini düzelt, hata mesajını analiz et"
              className="flex-1 resize-none bg-transparent px-4 py-3 text-sm text-slate-100 placeholder-slate-500 focus:outline-none disabled:opacity-50 font-mono"
            />
            <button
              onClick={send}
              disabled={!input.trim() || isStreaming}
              className="m-2 p-3 rounded-lg disabled:opacity-40 text-slate-950 transition-opacity hover:opacity-90"
              style={{ background: 'linear-gradient(135deg, var(--edith-primary), var(--edith-accent))' }}
              title="Gönder"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      </section>

      <aside className="hidden xl:flex w-80 flex-col bg-slate-950/70">
        <div className="p-4 border-b border-slate-800/80">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
            <Sparkles className="w-4 h-4 text-[var(--edith-accent)]" />
            Kod Kısayolları
          </div>
        </div>
        <div className="p-4 space-y-2">
          {quickPrompts.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.label}
                onClick={() => setInput(item.prompt)}
                className="w-full text-left p-3 rounded-lg border border-slate-800 bg-slate-900/60 hover:border-[var(--edith-primary)]/40 hover:bg-slate-900 transition-colors"
              >
                <div className="flex items-center gap-2 text-xs font-medium text-slate-200">
                  <Icon className="w-4 h-4 text-[var(--edith-accent)]" />
                  {item.label}
                </div>
                <p className="mt-1 text-[11px] text-slate-500 line-clamp-2">{item.prompt}</p>
              </button>
            );
          })}
        </div>
      </aside>
    </div>
  );
};
