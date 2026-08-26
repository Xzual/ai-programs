import React, { useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ExternalLink,
  Play,
  RefreshCw,
  Square,
  Terminal,
  TrendingUp,
} from 'lucide-react';

interface CryptoStatus {
  dashboardUrl: string;
  projectPath: string;
  healthy: boolean;
  managedProcessRunning?: boolean;
  autoStartEnabled?: boolean;
  pythonPath?: string;
  scriptPath?: string;
  logPath?: string;
  startedAt?: string;
  lastExit?: {
    code: number | null;
    signal: string | null;
    at: string;
  };
  overview?: {
    portfolio?: {
      balance?: number;
      equity?: number;
      positions?: unknown[];
    };
    performance?: {
      total_return_pct?: number;
    };
  };
  error?: string;
}

export const CryptoView: React.FC = () => {
  const [status, setStatus] = useState<CryptoStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<'start' | 'stop' | null>(null);

  const loadStatus = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/edith/crypto/status');
      const data = await response.json();
      if (data.success) setStatus(data.status);
    } catch (error) {
      setStatus({
        dashboardUrl: 'http://localhost:5000',
        projectPath: 'C:\\Users\\arday\\Desktop\\ai programs\\crypto',
        healthy: false,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStatus();
  }, []);

  const runAction = async (action: 'start' | 'stop') => {
    setActionLoading(action);
    try {
      const response = await fetch(`/api/edith/crypto/${action}`, { method: 'POST' });
      const data = await response.json();
      if (data.success) setStatus(data.status);
      setTimeout(loadStatus, 1400);
    } finally {
      setActionLoading(null);
    }
  };

  const dashboardUrl = status?.dashboardUrl ?? 'http://localhost:5000';
  const portfolio = status?.overview?.portfolio;
  const performance = status?.overview?.performance;

  return (
    <div className="flex-1 bg-slate-950/60 overflow-hidden flex flex-col text-slate-100">
      <div className="px-5 py-4 border-b border-slate-800/80 bg-slate-950/75 backdrop-blur-xl flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-lg border border-amber-500/35 bg-amber-500/10 flex items-center justify-center shadow-lg shadow-black/30">
            <TrendingUp className="w-5 h-5 text-amber-300" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold tracking-wide">Crypto Agent</h2>
            <div className="mt-1 flex items-center gap-2 text-[11px] font-mono text-slate-500">
              <span className={status?.healthy ? 'text-emerald-300' : 'text-amber-300'}>
                {status?.healthy ? 'dashboard online' : 'dashboard offline'}
              </span>
              <span className="w-1 h-1 rounded-full bg-slate-700" />
              <span className="truncate">{dashboardUrl}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => runAction('start')}
            disabled={actionLoading !== null || status?.healthy || status?.managedProcessRunning}
            className="px-3 py-2 rounded-lg border border-emerald-500/35 bg-emerald-500/10 text-xs text-emerald-100 hover:border-emerald-400 disabled:opacity-45 disabled:cursor-not-allowed flex items-center gap-2"
          >
            <Play className="w-4 h-4" />
            Başlat
          </button>
          <button
            onClick={() => runAction('stop')}
            disabled={actionLoading !== null || !status?.managedProcessRunning}
            className="px-3 py-2 rounded-lg border border-slate-800 bg-slate-900/80 text-xs text-slate-200 hover:border-rose-500/45 disabled:opacity-45 disabled:cursor-not-allowed flex items-center gap-2"
          >
            <Square className="w-4 h-4" />
            Durdur
          </button>
          <button
            onClick={loadStatus}
            className="px-3 py-2 rounded-lg border border-slate-800 bg-slate-900/80 text-xs text-slate-200 hover:border-amber-500/45 flex items-center gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Yenile
          </button>
          <a
            href={dashboardUrl}
            target="_blank"
            rel="noreferrer"
            className="px-3 py-2 rounded-lg border border-slate-800 bg-slate-900/80 text-xs text-slate-200 hover:border-amber-500/45 flex items-center gap-2"
          >
            <ExternalLink className="w-4 h-4" />
            Dışarı Aç
          </a>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[320px_1fr] min-h-0 flex-1">
        <aside className="border-r border-slate-800/80 bg-slate-950/70 p-4 space-y-4 overflow-y-auto custom-scrollbar">
          <div className="rounded-lg border border-slate-800 bg-slate-900/65 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
              <Activity className="w-4 h-4 text-emerald-300" />
              Durum
            </div>
            <div className="mt-4 space-y-2 text-xs">
              <StatusLine label="Dashboard" value={status?.healthy ? 'Online' : 'Offline'} good={Boolean(status?.healthy)} />
              <StatusLine label="Auto Start" value={status?.autoStartEnabled === false ? 'Kapalı' : 'Açık'} good={status?.autoStartEnabled !== false} />
              <StatusLine label="EDITH Process" value={status?.managedProcessRunning ? 'Çalışıyor' : 'Yok'} good={Boolean(status?.managedProcessRunning)} />
              <StatusLine label="Balance" value={`${Number(portfolio?.balance ?? 0).toFixed(2)} USDT`} />
              <StatusLine label="Equity" value={`${Number(portfolio?.equity ?? 0).toFixed(2)} USDT`} />
              <StatusLine label="Positions" value={String(portfolio?.positions?.length ?? 0)} />
              <StatusLine label="Return" value={`${Number(performance?.total_return_pct ?? 0).toFixed(2)}%`} />
            </div>
          </div>

          {!status?.healthy && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-950/20 p-4 text-xs text-amber-100">
              <div className="flex items-center gap-2 font-semibold">
                <AlertTriangle className="w-4 h-4 text-amber-300" />
                Dashboard çalışmıyor
              </div>
              <p className="mt-2 text-amber-100/80 leading-relaxed">
                EDITH açılırken crypto agent'ı otomatik başlatmayı dener. Çalışmıyorsa yukarıdaki Başlat düğmesini veya aşağıdaki komutu yedek olarak kullan.
              </p>
            </div>
          )}

          <div className="rounded-lg border border-slate-800 bg-slate-900/65 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
              <Terminal className="w-4 h-4 text-amber-300" />
              Başlatma
            </div>
            <pre className="mt-3 whitespace-pre-wrap rounded-lg border border-slate-800 bg-slate-950 p-3 text-[11px] text-slate-300 font-mono">
{`cd "C:\\Users\\arday\\Desktop\\ai programs\\crypto"
.\\.venv\\Scripts\\python.exe run_agent.py`}
            </pre>
            <p className="mt-3 text-[11px] text-slate-500 leading-relaxed">
              Sistem paper trading modundadır; gerçek para işlemi yapmaz. EDITH Ollama server başlatmaz. Dashboard agent çalışınca bu ekranda gömülü görünür.
            </p>
          </div>

          <div className="rounded-lg border border-slate-800 bg-slate-900/65 p-4">
            <div className="text-sm font-semibold text-slate-100">Çalışma Bilgisi</div>
            <div className="mt-4 space-y-2 text-xs">
              <StatusLine label="Started" value={status?.startedAt ? new Date(status.startedAt).toLocaleString() : '-'} />
              <StatusLine label="Last Exit" value={status?.lastExit ? `${status.lastExit.code ?? status.lastExit.signal ?? 'unknown'}` : '-'} />
              <StatusLine label="Log" value={status?.logPath ?? '-'} />
            </div>
          </div>
        </aside>

        <section className="min-w-0 min-h-0 bg-slate-950">
          {status?.healthy ? (
            <iframe
              title="Crypto Agent Dashboard"
              src={dashboardUrl}
              className="w-full h-full border-0 bg-slate-950"
            />
          ) : (
            <div className="h-full flex items-center justify-center p-6">
              <div className="max-w-lg rounded-lg border border-slate-800 bg-slate-900/70 p-6 text-center shadow-xl">
                <TrendingUp className="w-10 h-10 text-amber-300 mx-auto" />
                <h3 className="mt-4 text-lg font-semibold text-slate-100">Crypto dashboard bekleniyor</h3>
                <p className="mt-2 text-sm text-slate-400">
                  EDITH crypto agent'ı başlatınca `http://localhost:5000` online olacak ve dashboard burada açılacak.
                </p>
                {status?.error && <p className="mt-3 text-xs text-amber-300 font-mono">{status.error}</p>}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

function StatusLine({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-slate-800 bg-slate-950/60 px-3 py-2">
      <span className="text-slate-500">{label}</span>
      <span className={`font-mono text-right ${good ? 'text-emerald-300' : 'text-slate-300'}`}>{value}</span>
    </div>
  );
}
