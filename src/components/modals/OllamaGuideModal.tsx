import React from 'react';
import { Terminal, Copy, Check, X, Sparkles, AlertCircle, ExternalLink } from 'lucide-react';

interface OllamaGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSwitchToGemini: () => void;
}

export const OllamaGuideModal: React.FC<OllamaGuideModalProps> = ({
  isOpen,
  onClose,
  onSwitchToGemini,
}) => {
  const [copiedCmd, setCopiedCmd] = React.useState<string | null>(null);

  if (!isOpen) return null;

  const copyCmd = (cmd: string) => {
    navigator.clipboard.writeText(cmd);
    setCopiedCmd(cmd);
    setTimeout(() => setCopiedCmd(null), 2000);
  };

  const steps = [
    {
      title: '1. Ollama\'yı Bilgisayarınıza Kurun',
      desc: 'macOS, Windows veya Linux sisteminiz için Ollama resmi istemcisini indirin.',
      cmd: 'curl -fsSL https://ollama.com/install.sh',
    },
    {
      title: '2. Yerel LLM Modelini İndirin',
      desc: 'Terminalde EDITH için önerilen hafif Llama 3.2 veya Qwen 2.5 modelini çalıştırın.',
      cmd: 'ollama run llama3.2',
    },
    {
      title: '3. Durumu EDITH İçinden Kontrol Edin',
      desc: 'EDITH Ollama servisini başlatmaz; yalnızca zaten çalışan yerel servisi algılar.',
      cmd: 'GET /api/health?ollamaUrl=http://localhost:11434',
    },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 max-w-xl w-full shadow-2xl space-y-5 relative animate-fadeIn">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 rounded-xl text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Modal Header */}
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-2xl bg-purple-950 border border-purple-800 text-fuchsia-400">
            <Terminal className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-100">Ollama Yerel Kurulum Yönergesi</h2>
            <p className="text-xs text-slate-400">
              EDITH'i tamamen çevrimdışı ve %100 yerel çalıştırmak için 3 kolay adım.
            </p>
          </div>
        </div>

        {/* Steps */}
        <div className="space-y-3">
          {steps.map((step, idx) => (
            <div key={idx} className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800 space-y-1.5">
              <div className="text-xs font-semibold text-slate-200">{step.title}</div>
              <p className="text-[11px] text-slate-400">{step.desc}</p>
              <div className="flex items-center justify-between p-2 rounded-xl bg-slate-900 border border-slate-800/80 text-xs font-mono text-purple-300">
                <code>{step.cmd}</code>
                <button
                  onClick={() => copyCmd(step.cmd)}
                  className="p-1 text-slate-400 hover:text-slate-200 transition-colors"
                  title="Komutu Kopyala"
                >
                  {copiedCmd === step.cmd ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Cloud / Gemini Fallback Alternative */}
        <div className="p-4 rounded-2xl bg-gradient-to-r from-purple-950/60 to-fuchsia-950/60 border border-purple-500/40 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
          <div className="space-y-0.5">
            <div className="font-semibold text-purple-200 flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-fuchsia-400" />
              Ollama Yerelde Kurulu Değil mi?
            </div>
            <p className="text-[11px] text-slate-300">
              Tarayıcı önizlemesinde hemen sohbet etmek için bulut / Gemini yedek moduna geçebilirsiniz.
            </p>
          </div>

          <button
            onClick={() => {
              onSwitchToGemini();
              onClose();
            }}
            className="px-3.5 py-2 rounded-xl bg-fuchsia-600 hover:bg-fuchsia-500 text-white font-medium text-xs shadow-lg shadow-fuchsia-600/20 shrink-0 transition-all"
          >
            Bulut Moduna Geç
          </button>
        </div>
      </div>
    </div>
  );
};
