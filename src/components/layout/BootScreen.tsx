import React, { useEffect, useState } from 'react';
import { Brain, CheckCircle2, CircleDashed, LockKeyhole, Mic2, Server, ShieldCheck, Sparkles } from 'lucide-react';
import { getDesktopShellStatus } from '../../edith/desktopShell';
import { AssistantProfile, UserSettings } from '../../types';

type BootStatus = 'ONLINE' | 'DEGRADED' | 'OFFLINE' | 'CONFIGURATION REQUIRED' | 'BLOCKED' | 'PENDING';

interface BootCheck {
  label: string;
  status: BootStatus;
  detail: string;
}

interface BootScreenProps {
  assistant: AssistantProfile;
  settings: UserSettings;
  onComplete: () => void;
}

function statusTone(status: BootStatus): string {
  if (status === 'ONLINE') return 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200';
  if (status === 'BLOCKED' || status === 'OFFLINE') return 'border-red-400/25 bg-red-400/10 text-red-200';
  if (status === 'CONFIGURATION REQUIRED' || status === 'DEGRADED') return 'border-amber-400/25 bg-amber-400/10 text-amber-200';
  return 'border-white/10 bg-white/[0.035] text-slate-400';
}

export const BootScreen: React.FC<BootScreenProps> = ({ assistant, settings, onComplete }) => {
  const [checks, setChecks] = useState<BootCheck[]>([
    { label: 'Arayüz', status: 'ONLINE', detail: 'React arayüzü başlatıldı.' },
    { label: 'Arka uç', status: 'PENDING', detail: 'Yerel API sağlık kontrolü bekleniyor.' },
    { label: 'Sağlayıcı', status: 'PENDING', detail: 'Sağlayıcı kontrolü tamamlanmadı.' },
    { label: 'Bellek', status: 'PENDING', detail: 'Yerel bellek durumu bekleniyor.' },
    { label: 'Ses', status: 'PENDING', detail: 'Tarayıcı mikrofon desteği bekleniyor.' },
    { label: 'Güvenlik', status: 'PENDING', detail: 'İzin ve acil durdurma politikası bekleniyor.' },
    { label: 'Tauri kabuğu', status: 'PENDING', detail: 'Masaüstü kabuğu algılama bekleniyor.' },
  ]);

  useEffect(() => {
    let cancelled = false;
    const minimumBootMs = window.setTimeout(onComplete, 1800);

    async function runChecks() {
      const nextChecks: BootCheck[] = [
        { label: 'Arayüz', status: 'ONLINE', detail: 'React arayüzü başlatıldı.' },
      ];

      try {
        const health = await fetch(`/api/health?ollamaUrl=${encodeURIComponent(settings.ollamaUrl)}`).then((response) => response.json());
        nextChecks.push({ label: 'Arka uç', status: health?.status === 'ok' ? 'ONLINE' : 'DEGRADED', detail: 'Yerel Express API yanıt verdi.' });
        nextChecks.push({
          label: 'Sağlayıcı',
          status: health?.ollamaConnected || health?.geminiAvailable ? 'ONLINE' : 'CONFIGURATION REQUIRED',
          detail: health?.ollamaConnected ? 'Ollama erişilebilir durumda.' : health?.geminiAvailable ? 'Gemini anahtarı yapılandırıldı.' : 'Çevrimiçi sağlayıcı doğrulanamadı.',
        });
      } catch {
        nextChecks.push({ label: 'Arka uç', status: 'OFFLINE', detail: 'Yerel Express API yanıt vermedi.' });
        nextChecks.push({ label: 'Sağlayıcı', status: 'PENDING', detail: 'Arka uç yanıt verene kadar sağlayıcı kontrolü kullanılamıyor.' });
      }

      try {
        const safety = await fetch('/api/edith/interaction-safety').then((response) => response.json());
        nextChecks.push({ label: 'Güvenlik', status: safety?.snapshot?.computer?.mode === 'BLOCKED' ? 'BLOCKED' : 'ONLINE', detail: 'İzin özeti yüklendi; bilgisayar kullanımı yalnızca okuma modunda.' });
      } catch {
        nextChecks.push({ label: 'Güvenlik', status: 'PENDING', detail: 'İzin özeti kullanılamıyor.' });
      }

      nextChecks.push({
        label: 'Bellek',
        status: settings.memoryEnabled ? 'DEGRADED' : 'OFFLINE',
        detail: settings.memoryEnabled ? 'Bellek arayüzü etkin; arka uç ayrıntıları başlangıçtan sonra yüklenir.' : 'Bellek yerel ayarlarda devre dışı.',
      });

      const speechSupported = typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);
      nextChecks.push({
        label: 'Ses',
        status: speechSupported ? 'DEGRADED' : 'CONFIGURATION REQUIRED',
        detail: speechSupported ? 'Mikrofon izninden sonra tarayıcı ses tanıma kullanılabilir.' : 'Bu çalışma ortamında ses tanıma kullanılamıyor.',
      });

      const shell = await getDesktopShellStatus();
      nextChecks.push({
        label: 'Tauri kabuğu',
        status: shell.tauri ? 'ONLINE' : 'DEGRADED',
        detail: shell.tauri ? `Masaüstü kabuğu v${shell.version ?? 'bilinmiyor'} algılandı.` : 'Tarayıcı/geliştirme önizleme modunda çalışıyor.',
      });

      if (!cancelled) setChecks(nextChecks);
    }

    runChecks();
    return () => {
      cancelled = true;
      window.clearTimeout(minimumBootMs);
    };
  }, [onComplete, settings.memoryEnabled, settings.ollamaUrl]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#020617] text-slate-100">
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(rgba(255,255,255,0.026)_1px,transparent_1px)] bg-[size:36px_36px]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_44%,var(--assistant-glow),transparent_24rem)]" />
      <div className="relative w-full max-w-3xl px-6">
        <div className="mx-auto flex h-24 w-24 items-center justify-center rounded-full border border-[var(--assistant-primary)]/35 bg-[var(--assistant-primary)]/10 shadow-[0_0_54px_var(--assistant-glow)]">
          <div className="flex h-16 w-16 items-center justify-center rounded-full border border-[var(--assistant-accent)]/40 bg-black/50">
            <Brain className="h-8 w-8 animate-pulse text-[var(--assistant-accent)]" />
          </div>
        </div>
        <div className="mt-6 text-center">
          <div className="font-mono text-2xl font-bold tracking-[0.22em] text-[var(--assistant-primary)]">E.D.I.T.H.</div>
          <div className="mt-2 text-sm text-slate-400">Kişisel Yapay Zeka Sistemi</div>
          <div className="mt-1 text-xs text-slate-500">Asistan profili: {assistant.name}</div>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {checks.map((check) => (
            <div key={check.label} className="flex items-center gap-3 rounded-lg border border-white/10 bg-black/32 p-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-md border border-white/10 bg-white/[0.035]">
                {check.status === 'ONLINE' ? <CheckCircle2 className="h-4 w-4 text-emerald-300" /> : <CircleDashed className="h-4 w-4 animate-spin text-slate-400" />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-200">{check.label}</span>
                  <span className={`rounded border px-1.5 py-0.5 font-mono text-[9px] ${statusTone(check.status)}`}>{check.status}</span>
                </div>
                <div className="mt-1 truncate text-[11px] text-slate-500">{check.detail}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-2 text-[10px] font-mono text-slate-500">
          <span className="flex items-center gap-1 rounded border border-emerald-400/20 bg-emerald-400/8 px-2 py-1 text-emerald-200"><ShieldCheck className="h-3 w-3" /> SADECE OKUMA bilgisayar kullanımı</span>
          <span className="flex items-center gap-1 rounded border border-white/10 bg-white/[0.035] px-2 py-1"><Server className="h-3 w-3" /> Önce yerel</span>
          <span className="flex items-center gap-1 rounded border border-white/10 bg-white/[0.035] px-2 py-1"><Mic2 className="h-3 w-3" /> Ses izni gerekli</span>
          <span className="flex items-center gap-1 rounded border border-red-400/20 bg-red-400/8 px-2 py-1 text-red-200"><LockKeyhole className="h-3 w-3" /> Güvensiz kontrol engellendi</span>
          <span className="flex items-center gap-1 rounded border border-white/10 bg-white/[0.035] px-2 py-1"><Sparkles className="h-3 w-3" /> Arayüz kontrolleri açıkça etiketlenir</span>
        </div>
      </div>
    </div>
  );
};
