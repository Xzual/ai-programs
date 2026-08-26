import React, { useMemo, useRef, useState } from 'react';
import { AudioWaveform, LockKeyhole, ShieldCheck, Terminal, UserCheck } from 'lucide-react';
import { authenticateEdithUser } from '../../lib/storage';
import type { EdithAuthSession } from '../../types';

interface LoginScreenProps {
  onAuthenticated: (session: EdithAuthSession) => void;
}

function supportsSpeechRecognition(): boolean {
  return typeof window !== 'undefined' &&
    ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onAuthenticated }) => {
  const [typedName, setTypedName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<any>(null);
  const speechSupported = useMemo(() => supportsSpeechRecognition(), []);

  const submitName = (name: string, method: EdithAuthSession['method']) => {
    const session = authenticateEdithUser(name, method);
    if (!session) {
      setError('Yönetici adı doğrulanamadı.');
      return;
    }
    setError(null);
    onAuthenticated(session);
  };

  const startVoice = () => {
    if (!speechSupported) {
      setError('Sesli doğrulama bu tarayıcıda desteklenmiyor. Yazılı etkinleştirme kullanın.');
      return;
    }
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = recognitionRef.current ?? new SpeechRecognition();
    recognitionRef.current = recognition;
    recognition.lang = 'tr-TR';
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onstart = () => {
      setListening(true);
      setError(null);
    };
    recognition.onerror = () => {
      setListening(false);
      setError('Ses alınamadı. Yazılı etkinleştirme kullanabilirsiniz.');
    };
    recognition.onend = () => setListening(false);
    recognition.onresult = (event: any) => {
      const transcript = event.results?.[0]?.[0]?.transcript ?? '';
      submitName(transcript, 'spoken_name');
    };
    try {
      recognition.start();
    } catch {
      setListening(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 overflow-hidden relative flex items-center justify-center px-4">
      <div className="absolute inset-0 opacity-70">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_35%,color-mix(in_srgb,var(--edith-primary)_18%,transparent),transparent_32%),linear-gradient(135deg,#020617,#08111f_46%,#020617)]" />
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--edith-primary)] to-transparent" />
      </div>

      <section className="relative w-full max-w-md border border-slate-800 bg-slate-950/82 backdrop-blur-xl shadow-2xl shadow-black/50">
        <div className="p-6 sm:p-8">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-11 h-11 border border-[var(--edith-primary)]/50 bg-[var(--edith-primary)]/10 flex items-center justify-center">
              <Terminal className="w-5 h-5 text-[var(--edith-accent)]" />
            </div>
            <div>
              <h1 className="font-mono text-2xl font-bold tracking-[0.18em] text-[var(--edith-primary)]">E.D.I.T.H.</h1>
              <p className="text-xs font-mono text-slate-400 tracking-[0.22em]">PERSONAL AI SYSTEM</p>
            </div>
          </div>

          <div className="space-y-3">
            <button
              onClick={startVoice}
              className="w-full h-12 border border-[var(--edith-primary)]/40 bg-[var(--edith-primary)]/12 hover:bg-[var(--edith-primary)]/18 text-slate-100 flex items-center justify-center gap-2 text-sm font-mono transition-colors"
            >
              <AudioWaveform className={`w-4 h-4 ${listening ? 'animate-pulse text-[var(--edith-accent)]' : 'text-[var(--edith-primary)]'}`} />
              {listening ? 'DİNLENİYOR' : 'SESLİ DOĞRULAMA'}
            </button>

            <div className="border border-slate-800 bg-slate-900/60 p-3">
              <label className="block text-[11px] font-mono text-slate-400 mb-2">YAZILI ETKİNLEŞTİRME</label>
              <div className="flex gap-2">
                <input
                  value={typedName}
                  onChange={(event) => setTypedName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') submitName(typedName, 'typed_name');
                  }}
                  placeholder="Can İpkin veya Arda Yorulmazel"
                  className="min-w-0 flex-1 bg-slate-950 border border-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-[var(--edith-primary)]"
                />
                <button
                  onClick={() => submitName(typedName, 'typed_name')}
                  className="px-3 bg-[var(--edith-primary)] text-slate-950 font-semibold"
                  title="Etkinleştir"
                >
                  <UserCheck className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          {error && (
            <p className="mt-4 text-xs text-rose-300 border border-rose-500/30 bg-rose-950/30 px-3 py-2">
              {error}
            </p>
          )}

          <div className="mt-6 grid grid-cols-2 gap-2 text-[11px] font-mono text-slate-400">
            <div className="border border-slate-800 p-2 flex items-center gap-2">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              ADMIN MODE
            </div>
            <div className="border border-slate-800 p-2 flex items-center gap-2">
              <LockKeyhole className="w-3.5 h-3.5 text-amber-400" />
              NAME CHECK
            </div>
          </div>
        </div>
      </section>
    </main>
  );
};
