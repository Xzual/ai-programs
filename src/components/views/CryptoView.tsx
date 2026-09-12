import React, { useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
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
  health?: Record<string, any>;
  obsidian?: Record<string, any>;
  runtime?: {
    state?: string;
    observerRunning?: boolean;
    runtimeMode?: string;
    ollamaAvailable?: boolean;
    marketDataAvailable?: boolean | null;
    obsidianAvailable?: boolean;
    lastStartedAt?: string;
    lastStoppedAt?: string;
    lastObservationAt?: string;
    currentSymbol?: string | null;
    watchedSymbols?: string[];
    safetyStatus?: {
      status?: string;
      message?: string;
    };
    tradingEnabled?: boolean;
    paperTradingEnabled?: boolean;
    liveTradingEnabled?: boolean;
  };
  error?: string;
}

interface CryptoProxyData {
  overview?: Record<string, any>;
  observations?: Record<string, any>;
  markets?: Record<string, any>;
  risk?: Record<string, any>;
  learningNotes?: Record<string, any>;
  obsidianStatus?: Record<string, any>;
}

export const CryptoView: React.FC = () => {
  const [status, setStatus] = useState<CryptoStatus | null>(null);
  const [proxyData, setProxyData] = useState<CryptoProxyData>({});
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<'start' | 'stop' | null>(null);

  const readOptionalEndpoint = async (path: string): Promise<Record<string, any> | undefined> => {
    try {
      const response = await fetch(path);
      if (!response.ok) return undefined;
      return await response.json();
    } catch {
      return undefined;
    }
  };

  const loadStatus = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/edith/crypto/status');
      const data = await response.json();
      if (data.success) setStatus(data.status);
      const [obsidianStatus, learningNotes, overview, observations, markets, risk] = await Promise.all([
        readOptionalEndpoint('/api/obsidian-status'),
        readOptionalEndpoint('/api/learning-notes'),
        readOptionalEndpoint('/api/overview'),
        readOptionalEndpoint('/api/observations'),
        readOptionalEndpoint('/api/markets'),
        readOptionalEndpoint('/api/risk'),
      ]);
      setProxyData({ obsidianStatus, learningNotes, overview, observations, markets, risk });
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
  const runtime = status?.runtime;
  const obsidian = status?.obsidian ?? status?.health?.obsidian;
  const obsidianDetails = proxyData.obsidianStatus ?? obsidian ?? {};
  const obsidianReady = obsidian?.status === 'connected' && Boolean(obsidian.writable ?? obsidian.available);
  const observerRunning = Boolean(runtime?.observerRunning);
  const overview = proxyData.overview ?? status?.overview ?? {};
  const portfolio = overview?.portfolio;
  const performance = overview?.performance;
  const learningNotes = Array.isArray(proxyData.learningNotes?.notes)
    ? proxyData.learningNotes?.notes
    : Array.isArray(proxyData.learningNotes?.recentNotes)
    ? proxyData.learningNotes?.recentNotes
    : [];
  const observations = Array.isArray(proxyData.observations?.observations) ? proxyData.observations.observations : [];
  const markets = Array.isArray(proxyData.markets?.markets) ? proxyData.markets.markets : [];
  const runtimeMode = String(runtime?.runtimeMode ?? 'OBSERVER_ONLY').replaceAll('_', ' ').toUpperCase();
  const aiDependencyOffline = status?.healthy && runtime?.ollamaAvailable === false;

  return (
    <div className="flex-1 bg-slate-950/60 overflow-hidden flex flex-col text-slate-100">
      <div className="px-5 py-4 border-b border-slate-800/80 bg-slate-950/75 backdrop-blur-xl flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-lg border border-amber-500/35 bg-amber-500/10 flex items-center justify-center shadow-lg shadow-black/30">
            <TrendingUp className="w-5 h-5 text-amber-300" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold tracking-wide">Crypto Market Observer</h2>
            <div className="mt-1 flex items-center gap-2 text-[11px] font-mono text-slate-500">
              <span className={status?.healthy ? 'text-emerald-300' : 'text-amber-300'}>
                {status?.healthy ? `service ${runtime?.state ?? 'online'}` : 'service offline'}
              </span>
              <span className="w-1 h-1 rounded-full bg-slate-700" />
              <span className="truncate">backend proxy: /api/edith/crypto/status</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => runAction('start')}
            disabled={actionLoading !== null || observerRunning}
            className="px-3 py-2 rounded-lg border border-emerald-500/35 bg-emerald-500/10 text-xs text-emerald-100 hover:border-emerald-400 disabled:opacity-45 disabled:cursor-not-allowed flex items-center gap-2"
          >
            <Play className="w-4 h-4" />
            Start Market Observer
          </button>
          <button
            onClick={() => runAction('stop')}
            disabled={actionLoading !== null || !observerRunning}
            className="px-3 py-2 rounded-lg border border-slate-800 bg-slate-900/80 text-xs text-slate-200 hover:border-rose-500/45 disabled:opacity-45 disabled:cursor-not-allowed flex items-center gap-2"
          >
            <Square className="w-4 h-4" />
            Stop Market Observer
          </button>
          <button
            onClick={loadStatus}
            className="px-3 py-2 rounded-lg border border-slate-800 bg-slate-900/80 text-xs text-slate-200 hover:border-amber-500/45 flex items-center gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Yenile
          </button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[clamp(18rem,20vw,24rem)_minmax(0,1fr)]">
        <aside className="border-r border-slate-800/80 bg-slate-950/70 p-4 space-y-4 overflow-y-auto custom-scrollbar">
          <div className="rounded-lg border border-slate-800 bg-slate-900/65 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
              <Activity className="w-4 h-4 text-emerald-300" />
              Durum
            </div>
            <div className="mt-4 space-y-2 text-xs">
              <StatusLine label="Crypto Service" value={status?.healthy ? 'Online' : 'Offline'} good={Boolean(status?.healthy)} />
              <StatusLine label="Auto Start" value={status?.autoStartEnabled ? 'Açık' : 'Kapalı'} good={!status?.autoStartEnabled} />
              <StatusLine label="Observer" value={runtime?.state ?? 'STOPPED'} good={observerRunning} />
              <StatusLine label="AI Dependency" value={runtime?.ollamaAvailable ? 'Online' : 'Offline'} good={Boolean(runtime?.ollamaAvailable)} />
              <StatusLine label="Obsidian" value={obsidianReady ? 'Connected' : 'Unavailable'} good={obsidianReady} />
              <StatusLine label="Runtime" value={runtimeMode} />
              <StatusLine label="Paper Trading" value="Disabled" />
              <StatusLine label="Live Trading" value="Locked" />
              <StatusLine label="Current" value={runtime?.currentSymbol ?? '-'} />
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
                Crypto service çalışmıyor
              </div>
              <p className="mt-2 text-amber-100/80 leading-relaxed">
                Start Market Observer düğmesi önce güvenli Python servisini açar, sonra observer döngüsünü başlatır. Trading kilitli kalır.
              </p>
            </div>
          )}

          {aiDependencyOffline && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-950/20 p-4 text-xs text-amber-100">
              <div className="flex items-center gap-2 font-semibold">
                <AlertTriangle className="w-4 h-4 text-amber-300" />
                AI dependency offline
              </div>
              <p className="mt-2 text-amber-100/80 leading-relaxed">
                Crypto service is online; Ollama/local AI is offline, so AI analysis may be paused without marking crypto offline.
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
              Sistem OBSERVER_ONLY modundadır; gerçek veya sanal al/sat işlemi yapmaz. Paper trading disabled, live trading locked. EDITH Ollama server başlatmaz.
            </p>
          </div>

          <div className="rounded-lg border border-slate-800 bg-slate-900/65 p-4">
            <div className="text-sm font-semibold text-slate-100">Çalışma Bilgisi</div>
            <div className="mt-4 space-y-2 text-xs">
              <StatusLine label="Started" value={runtime?.lastStartedAt ? new Date(runtime.lastStartedAt).toLocaleString() : status?.startedAt ? new Date(status.startedAt).toLocaleString() : '-'} />
              <StatusLine label="Stopped" value={runtime?.lastStoppedAt ? new Date(runtime.lastStoppedAt).toLocaleString() : '-'} />
              <StatusLine label="Observed" value={runtime?.lastObservationAt ? new Date(runtime.lastObservationAt).toLocaleString() : '-'} />
              <StatusLine label="Last Exit" value={status?.lastExit ? `${status.lastExit.code ?? status.lastExit.signal ?? 'unknown'}` : '-'} />
              <StatusLine label="Log" value={status?.logPath ?? '-'} />
            </div>
          </div>
        </aside>

        <section className="min-w-0 min-h-0 bg-slate-950">
          {status?.healthy ? (
            <div className="h-full overflow-y-auto custom-scrollbar p-5">
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <InfoPanel title="Overview" rows={[
                  ['Mode', runtimeMode],
                  ['Backend proxy', '/api/overview'],
                  ['Dashboard source', dashboardUrl],
                  ['Market rows', String(markets.length)],
                ]} />
                <InfoPanel title="Risk" rows={[
                  ['Endpoint', '/api/risk'],
                  ['Max open positions', String(proxyData.risk?.maxOpenPositions ?? proxyData.risk?.max_open_positions ?? 'not connected')],
                  ['Last rejection', String(proxyData.risk?.lastRejectionReason ?? proxyData.risk?.last_rejection_reason ?? 'none reported')],
                  ['Execution', 'blocked'],
                ]} />
                <ListPanel title="Observations" emptyText="No recent observations yet." items={observations.map((item: any) => item.title ?? item.symbol ?? item.summary ?? 'Market observation')} />
                <ListPanel
                  title="Learning Notes"
                  emptyText={obsidianReady ? 'Vault connected, no recent notes yet.' : 'Obsidian vault is not connected/writable.'}
                  items={learningNotes.map((item: any) => item.title ?? item.path ?? item.summary ?? 'Learning note')}
                />
                <InfoPanel title="Obsidian" rows={[
                  ['Status', obsidianReady ? 'connected' : String(obsidianDetails.status ?? 'not connected')],
                  ['Vault path', String(obsidianDetails.vaultPath ?? 'D:\\EDİTH\\EDİTH')],
                  ['Learning folder', String(obsidianDetails.folder ?? 'Trading/Crypto Market Learning')],
                  ['Writable', obsidianReady ? 'yes' : 'no'],
                ]} />
                <InfoPanel title="Safety" rows={[
                  ['Mode', 'OBSERVER_ONLY'],
                  ['Paper trading', 'disabled'],
                  ['Live trading', 'locked'],
                  ['BUY/SELL/order buttons', 'not exposed'],
                ]} />
              </div>
            </div>
          ) : (
            <div className="h-full flex items-center justify-center p-6">
              <div className="max-w-lg rounded-lg border border-slate-800 bg-slate-900/70 p-6 text-center shadow-xl">
                <TrendingUp className="w-10 h-10 text-amber-300 mx-auto" />
                <h3 className="mt-4 text-lg font-semibold text-slate-100">Crypto observer bekleniyor</h3>
                <p className="mt-2 text-sm text-slate-400">
                  Start Market Observer seçildiğinde güvenli servis açılır, OBSERVER_ONLY izleme başlar ve dashboard burada görünür.
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

function InfoPanel({ title, rows }: { title: string; rows: Array<[string, string]> }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/65 p-4">
      <div className="text-sm font-semibold text-slate-100">{title}</div>
      <div className="mt-3 space-y-2 text-xs">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-3 rounded-md border border-slate-800 bg-slate-950/60 px-3 py-2">
            <span className="text-slate-500">{label}</span>
            <span className="font-mono text-right text-slate-300">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ListPanel({ title, items, emptyText }: { title: string; items: string[]; emptyText: string }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/65 p-4">
      <div className="text-sm font-semibold text-slate-100">{title}</div>
      <div className="mt-3 space-y-2 text-xs">
        {(items.length ? items : [emptyText]).slice(0, 6).map((item, index) => (
          <div key={`${item}-${index}`} className="rounded-md border border-slate-800 bg-slate-950/60 px-3 py-2 text-slate-300">
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusLine({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-slate-800 bg-slate-950/60 px-3 py-2">
      <span className="text-slate-500">{label}</span>
      <span className={`font-mono text-right ${good ? 'text-emerald-300' : 'text-slate-300'}`}>{value}</span>
    </div>
  );
}
