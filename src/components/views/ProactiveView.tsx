import React, { useEffect, useState } from 'react';
import { Bell, CheckCircle2, Eye, Megaphone, RefreshCw, SlidersHorizontal, Trash2 } from 'lucide-react';

type ProactiveCategory = 'calendar' | 'mail' | 'system' | 'logs' | 'iot';

interface ProactiveSettings {
  enabled: boolean;
  intervalMinutes: number;
  categories: Record<ProactiveCategory, boolean>;
  delivery: {
    text: boolean;
    voice: boolean;
  };
}

interface ProactiveSignal {
  id: string;
  createdAt: string;
  dismissedAt?: string;
  severity: 'critical' | 'info' | 'suggestion';
  category: ProactiveCategory;
  title: string;
  message: string;
  requiresApproval: boolean;
  source: string;
}

const CATEGORY_LABELS: Record<ProactiveCategory, string> = {
  calendar: 'Takvim',
  mail: 'E-posta',
  system: 'Sistem',
  logs: 'Loglar',
  iot: 'IoT',
};

export const ProactiveView: React.FC = () => {
  const [settings, setSettings] = useState<ProactiveSettings | null>(null);
  const [signals, setSignals] = useState<ProactiveSignal[]>([]);
  const [status, setStatus] = useState('Hazır');
  const [busy, setBusy] = useState(false);
  const [sentimentText, setSentimentText] = useState('acil kontrol et');
  const [presenceState, setPresenceState] = useState('busy');

  const refresh = async () => {
    setBusy(true);
    try {
      const [settingsRes, signalsRes] = await Promise.all([
        fetch('/api/edith/proactive/settings'),
        fetch('/api/edith/proactive/signals'),
      ]);
      const settingsData = await settingsRes.json();
      const signalsData = await signalsRes.json();
      setSettings(settingsData.settings);
      setSignals(signalsData.signals ?? []);
      setStatus('Güncellendi');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Proaktif veriler alınamadı.');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const patchSettings = async (update: Partial<ProactiveSettings>) => {
    if (!settings) return;
    setBusy(true);
    try {
      const response = await fetch('/api/edith/proactive/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(update),
      });
      const data = await response.json();
      setSettings(data.settings);
      setStatus('Ayarlar kaydedildi');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Ayarlar kaydedilemedi.');
    } finally {
      setBusy(false);
    }
  };

  const runCheck = async () => {
    setBusy(true);
    try {
      const [sentimentRes, presenceRes] = await Promise.all([
        fetch('/api/edith/context/sentiment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: sentimentText }),
        }),
        fetch('/api/edith/context/presence', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ inferredState: presenceState, activeApplication: 'EDITH' }),
        }),
      ]);
      const sentiment = await sentimentRes.json();
      const presence = await presenceRes.json();
      const response = await fetch('/api/edith/proactive/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sentiment: sentiment.context, presence: presence.context }),
      });
      const data = await response.json();
      setSignals(data.activeSignals ?? data.signals ?? []);
      setStatus(`${data.signals?.length ?? 0} sinyal üretildi`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Kontrol çalıştırılamadı.');
    } finally {
      setBusy(false);
    }
  };

  const dismissSignal = async (id: string) => {
    setBusy(true);
    try {
      await fetch(`/api/edith/proactive/signals/${id}/dismiss`, { method: 'POST' });
      await refresh();
      setStatus('Sinyal kapatıldı');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Sinyal kapatılamadı.');
    } finally {
      setBusy(false);
    }
  };

  if (!settings) {
    return (
      <div className="flex-1 bg-slate-950 p-5 text-slate-300">
        <RefreshCw className="w-5 h-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-slate-950 p-5 custom-scrollbar">
      <div className="max-w-7xl mx-auto space-y-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
              <Bell className="w-5 h-5 text-cyan-300" />
              Proaktif EDITH
            </h2>
            <p className="text-xs text-slate-500 mt-1">İzinli izleme, bağlam sinyalleri ve düşük kesinti modu</p>
          </div>
          <button
            onClick={refresh}
            disabled={busy}
            className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-200 hover:border-cyan-500/40 disabled:opacity-45 flex items-center gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${busy ? 'animate-spin' : ''}`} />
            Yenile
          </button>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[24rem_1fr] gap-5">
          <section className="rounded-lg border border-slate-800 bg-slate-900/55 p-4 space-y-4">
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="w-4 h-4 text-cyan-300" />
              <h3 className="text-sm font-semibold text-slate-100">Ayarlar</h3>
            </div>

            <label className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/45 p-3">
              <span className="text-xs text-slate-300">Proaktif izleme</span>
              <input
                type="checkbox"
                checked={settings.enabled}
                onChange={(event) => patchSettings({ enabled: event.target.checked })}
                className="h-4 w-4 accent-cyan-400"
              />
            </label>

            <label className="block">
              <span className="text-[11px] text-slate-500">Aralık dakika</span>
              <input
                type="number"
                min={1}
                max={120}
                value={settings.intervalMinutes}
                onChange={(event) => patchSettings({ intervalMinutes: Number(event.target.value) })}
                className="mt-1 w-full rounded-lg bg-slate-950/70 border border-slate-800 px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-cyan-400/50"
              />
            </label>

            <div>
              <div className="text-[11px] text-slate-500 mb-2">Kategoriler</div>
              <div className="grid grid-cols-2 gap-2">
                {(Object.keys(CATEGORY_LABELS) as ProactiveCategory[]).map((category) => (
                  <label key={category} className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/45 px-3 py-2">
                    <span className="text-xs text-slate-300">{CATEGORY_LABELS[category]}</span>
                    <input
                      type="checkbox"
                      checked={settings.categories[category]}
                      onChange={(event) => patchSettings({ categories: { ...settings.categories, [category]: event.target.checked } })}
                      className="h-4 w-4 accent-cyan-400"
                    />
                  </label>
                ))}
              </div>
            </div>

            <div>
              <div className="text-[11px] text-slate-500 mb-2">Teslimat</div>
              <div className="grid grid-cols-2 gap-2">
                <label className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/45 px-3 py-2">
                  <span className="text-xs text-slate-300">Metin</span>
                  <input
                    type="checkbox"
                    checked={settings.delivery.text}
                    onChange={(event) => patchSettings({ delivery: { ...settings.delivery, text: event.target.checked } })}
                    className="h-4 w-4 accent-cyan-400"
                  />
                </label>
                <label className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/45 px-3 py-2">
                  <span className="text-xs text-slate-300">Ses</span>
                  <input
                    type="checkbox"
                    checked={settings.delivery.voice}
                    onChange={(event) => patchSettings({ delivery: { ...settings.delivery, voice: event.target.checked } })}
                    className="h-4 w-4 accent-cyan-400"
                  />
                </label>
              </div>
            </div>
          </section>

          <section className="rounded-lg border border-slate-800 bg-slate-900/55 p-4">
            <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <Eye className="w-4 h-4 text-cyan-300" />
                  <h3 className="text-sm font-semibold text-slate-100">Bağlam Kontrolü</h3>
                </div>
                <p className="text-xs text-slate-500 mt-1">Sinyaller görev çalıştırmaz; sadece onay gerektiren öneri üretir.</p>
              </div>
              <button
                onClick={runCheck}
                disabled={busy || !settings.enabled}
                className="px-3 py-2 rounded-lg border border-cyan-500/30 bg-cyan-950/20 text-xs text-cyan-100 hover:bg-cyan-900/25 disabled:opacity-45 flex items-center justify-center gap-2"
              >
                <Megaphone className="w-4 h-4" />
                Kontrol Et
              </button>
            </div>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-[1fr_12rem] gap-3">
              <input
                value={sentimentText}
                onChange={(event) => setSentimentText(event.target.value)}
                className="rounded-lg bg-slate-950/70 border border-slate-800 px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-cyan-400/50"
              />
              <select
                value={presenceState}
                onChange={(event) => setPresenceState(event.target.value)}
                className="rounded-lg bg-slate-950/70 border border-slate-800 px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-cyan-400/50"
              >
                <option value="busy">busy</option>
                <option value="available">available</option>
                <option value="away">away</option>
                <option value="unknown">unknown</option>
              </select>
            </div>

            <div className="mt-4 text-[10px] text-slate-500 font-mono">{status}</div>

            <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-3">
              {signals.map((signal) => (
                <div key={signal.id} className="rounded-lg border border-slate-800 bg-slate-950/55 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-slate-100 truncate">{signal.title}</div>
                      <div className="mt-1 text-[10px] text-slate-500 font-mono">
                        {signal.category} · {signal.source} · {new Date(signal.createdAt).toLocaleString('tr-TR')}
                      </div>
                    </div>
                    <SeverityBadge severity={signal.severity} />
                  </div>
                  <p className="mt-2 text-[11px] text-slate-400">{signal.message}</p>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <span className={`px-2 py-0.5 rounded border text-[10px] font-mono ${signal.requiresApproval ? 'border-amber-500/30 bg-amber-950/30 text-amber-200' : 'border-emerald-500/30 bg-emerald-950/25 text-emerald-200'}`}>
                      {signal.requiresApproval ? 'APPROVAL' : 'INFO'}
                    </span>
                    <button
                      onClick={() => dismissSignal(signal.id)}
                      disabled={busy}
                      className="px-2 py-1 rounded-md border border-slate-700 text-[10px] text-slate-300 hover:border-red-400/40 hover:text-red-200 disabled:opacity-40 flex items-center gap-1"
                    >
                      <Trash2 className="w-3 h-3" />
                      kapat
                    </button>
                  </div>
                </div>
              ))}
              {signals.length === 0 && (
                <div className="rounded-lg border border-dashed border-slate-800 p-4 text-xs text-slate-500">
                  Aktif proaktif sinyal yok.
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};

function SeverityBadge({ severity }: { severity: ProactiveSignal['severity'] }) {
  const cls = severity === 'critical'
    ? 'border-red-500/30 bg-red-950/30 text-red-200'
    : severity === 'suggestion'
    ? 'border-cyan-500/30 bg-cyan-950/25 text-cyan-200'
    : 'border-emerald-500/30 bg-emerald-950/25 text-emerald-200';
  return (
    <span className={`px-2 py-0.5 rounded border text-[10px] font-mono ${cls}`}>
      {severity.toUpperCase()}
    </span>
  );
}
