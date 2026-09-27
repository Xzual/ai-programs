import React from 'react';
import { CandlestickSeries, HistogramSeries, ColorType, createChart, type CandlestickData, type IChartApi, type ISeriesApi, type UTCTimestamp } from 'lightweight-charts';
import './crypto-terminal.css';
import { AnimatedNumber, TickPrice, DepthRows, DecisionBadge, EmptyState, finiteNumber } from './TerminalPrimitives';
import { api, record, freshness, type Json } from './cryptoApi';
import { useCryptoOperation } from './useCryptoOperation';
import {
  AlertTriangle, ArrowDownToLine, ArrowUpFromLine, BarChart3,
  Bot, CheckCircle2, CircleDollarSign, Clock3, Database, Pause, Play,
  RefreshCw, RotateCcw, ShieldCheck, Square, Wifi, WifiOff,
} from 'lucide-react';

const rows = (value: unknown): value is Json[] => Array.isArray(value) && value.every(record);

const SYMBOL_FALLBACK = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT',
  'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT',
];
const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h'];

function credits(value: unknown): string {
  const number = finiteNumber(value);
  return number !== null
    ? `${number.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} CR`
    : '-';
}

function price(value: unknown): string {
  const number = finiteNumber(value);
  if (number === null) return '-';
  return number.toLocaleString('en-US', { minimumFractionDigits: number < 1 ? 4 : 2, maximumFractionDigits: number < 1 ? 6 : 2 });
}

function percent(value: unknown, digits = 2): string {
  const number = finiteNumber(value);
  return number === null ? '-' : `${number.toFixed(digits)}%`;
}

function time(value: unknown): string {
  if (!value) return '-';
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function duration(value: unknown): string {
  const total = Math.max(0, Math.floor(Number(value) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':');
}

function RecordIds({ value }: { value: Json }) {
  return <div className="mt-1 space-y-1 break-all font-mono text-[10px] text-zinc-400">
    {['clientRequestId', 'operationId', 'tradeId', 'decisionId'].map((key) => value[key] != null &&
      <div key={key}>{key}: {String(value[key])}</div>)}
  </div>;
}

function FreshnessLabel({ value, now, maxAgeMs }: { value: Json; now: number; maxAgeMs: number }) {
  const data = freshness(value, now, maxAgeMs);
  return <span className={data.status === 'fresh' ? 'text-zinc-400' : 'text-amber-300'}>
    {data.status === 'fresh' ? 'Güncel' : data.status === 'stale' ? 'Eski fiyat' : 'Güncellik doğrulanamadı'}
    {' · '}{time(data.timestamp)}{data.age !== null ? ` · ${(data.age / 1000).toFixed(1)} sn` : ''}
  </span>;
}

function StatusDot({ active, label }: { active: boolean; label: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase text-zinc-300">
      <span key={String(active)} className={`h-2 w-2 rounded-full ${active ? 'crypto-terminal-connected bg-emerald-400' : 'bg-amber-400'}`} />
      {label}
    </span>
  );
}

function Metric({ label, value, tone = 'neutral' }: { label: string; value: React.ReactNode; tone?: 'neutral' | 'green' | 'red' | 'amber' }) {
  const tones = { neutral: 'text-zinc-100', green: 'text-emerald-400', red: 'text-rose-400', amber: 'text-amber-300' };
  return (
    <div className="min-w-0 border-r border-white/8 px-3 last:border-r-0">
      <div className="truncate text-[9px] font-semibold uppercase text-zinc-500">{label}</div>
      <div className={`mt-1 truncate font-mono text-sm font-semibold tabular-nums ${tones[tone]}`}>{value}</div>
    </div>
  );
}

function Panel({ title, meta, children, className = '' }: { title: string; meta?: string; children: React.ReactNode; className?: string }) {
  return (
    <section data-panel={title} className={`crypto-terminal-panel min-w-0 overflow-hidden border border-white/10 ${className}`}>
      <header className="flex h-10 items-center justify-between border-b border-white/8 bg-[#151815] px-3">
        <h2 className="text-[11px] font-bold uppercase text-zinc-200">{title}</h2>
        {meta && <span className="text-[9px] uppercase text-zinc-600">{meta}</span>}
      </header>
      {children}
    </section>
  );
}

function MarketChart({ candles, symbol, timeframe }: { candles: Json[]; symbol: string; timeframe: string }) {
  const hostRef = React.useRef<HTMLDivElement>(null);
  const chartRef = React.useRef<IChartApi | null>(null);
  const seriesRef = React.useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeRef = React.useRef<ISeriesApi<'Histogram'> | null>(null);
  const fittedRef = React.useRef('');

  React.useEffect(() => {
    if (!hostRef.current) return;
    const chart = createChart(hostRef.current, {
      layout: { background: { type: ColorType.Solid, color: '#0d1015' }, textColor: '#9ba4b4', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
      grid: { vertLines: { color: 'rgba(255,255,255,.035)' }, horzLines: { color: 'rgba(255,255,255,.035)' } },
      rightPriceScale: { borderColor: 'rgba(255,255,255,.1)' },
      timeScale: { borderColor: 'rgba(255,255,255,.1)', timeVisible: true, secondsVisible: false },
      crosshair: { vertLine: { color: '#38bdf855' }, horzLine: { color: '#38bdf855' } },
      width: hostRef.current.clientWidth,
      height: hostRef.current.clientHeight,
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e', downColor: '#f43f5e', borderVisible: false,
      wickUpColor: '#22c55e', wickDownColor: '#f43f5e',
    });
    chartRef.current = chart;
    seriesRef.current = series;
    series.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.23 } });
    const volume = chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: 'volume' });
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    volumeRef.current = volume;
    const observer = new ResizeObserver(([entry]) => chart.applyOptions({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(hostRef.current);
    return () => { observer.disconnect(); chart.remove(); };
  }, []);

  React.useEffect(() => {
    const rows: CandlestickData[] = candles
      .filter((row) => [row.time, row.open, row.high, row.low, row.close].every((value) => value != null && Number.isFinite(Number(value))))
      .map((row) => ({ time: Number(row.time) as UTCTimestamp, open: Number(row.open), high: Number(row.high), low: Number(row.low), close: Number(row.close) }));
    const sorted = [...new Map(rows.map((row) => [Number(row.time), row])).values()].sort((a, b) => Number(a.time) - Number(b.time));
    seriesRef.current?.setData(sorted);
    const volumes = new Map(candles.filter((row) => row.volume != null && Number.isFinite(Number(row.volume))).map((row) => [Number(row.time), Number(row.volume)]));
    volumeRef.current?.setData(sorted.filter((row) => volumes.has(Number(row.time))).map((row) => ({ time: row.time, value: volumes.get(Number(row.time))!, color: row.close >= row.open ? '#34d39944' : '#fb718544' })));
    if (rows.length && fittedRef.current !== `${symbol}:${timeframe}`) {
      chartRef.current?.timeScale().fitContent();
      fittedRef.current = `${symbol}:${timeframe}`;
    }
  }, [candles, symbol, timeframe]);

  return <div ref={hostRef} className="crypto-terminal-chart" aria-label={`${symbol} ${timeframe} mum grafiği`} />;
}

export function CryptoExchangeTerminal() {
  const [status, setStatus] = React.useState<Json>({});
  const [symbols, setSymbols] = React.useState<Json[]>([]);
  const [market, setMarket] = React.useState<Json>({ candles: [], orderBook: { bids: [], asks: [] } });
  const [portfolio, setPortfolio] = React.useState<Json>({});
  const [trades, setTrades] = React.useState<Json[]>([]);
  const [decision, setDecision] = React.useState<Json | null>(null);
  const [jev, setJev] = React.useState<Json>({ status: 'checking', available: null });
  const [jevLoop, setJevLoop] = React.useState<Json>({ state: 'UNKNOWN', running: false });
  const [loopInterval, setLoopInterval] = React.useState(60);
  const [clock, setClock] = React.useState(Date.now());
  const [symbol, setSymbol] = React.useState('BTCUSDT');
  const [timeframe, setTimeframe] = React.useState('1m');
  const [quoteAmount, setQuoteAmount] = React.useState('1000');
  const [sellPercent, setSellPercent] = React.useState(100);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<{ text: string; error?: boolean } | null>(null);
  const [serviceOffline, setServiceOffline] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [failedFeeds, setFailedFeeds] = React.useState<string[]>([]);
  const [checkedAt, setCheckedAt] = React.useState<string | null>(null);
  const [watchQuotes, setWatchQuotes] = React.useState<Record<string, Json>>({});
  const requestVersion = React.useRef(0);
  const refreshInFlight = React.useRef(false);
  const selection = React.useRef({ symbol, timeframe });
  selection.current = { symbol, timeframe };

  const refresh = React.useCallback(async (quiet = false) => {
    if (quiet && refreshInFlight.current) return;
    const version = ++requestVersion.current;
    const currentSelection = selection.current;
    refreshInFlight.current = true;
    if (!quiet) setLoading(true);
    try {
      const results = await Promise.allSettled([
        api('/api/crypto/status'),
        api('/api/crypto/symbols'),
        api(`/api/crypto/market?symbol=${encodeURIComponent(currentSelection.symbol)}&timeframe=${encodeURIComponent(currentSelection.timeframe)}`),
        api('/api/crypto/portfolio'),
        api('/api/crypto/trades'),
        api('/api/crypto/decision/latest'),
        api('/api/crypto/jev/status'),
        api('/api/crypto/jev/loop'),
      ]);
      if (version !== requestVersion.current || currentSelection.symbol !== selection.current.symbol || currentSelection.timeframe !== selection.current.timeframe) return;
      const validators = [
        (value: Json) => typeof value.running === 'boolean',
        (value: Json) => rows(value.symbols) && value.symbols.every((row: Json) => typeof row.symbol === 'string'),
        (value: Json) => value.symbol === currentSelection.symbol && value.timeframe === currentSelection.timeframe && rows(value.candles) && rows(value.orderBook?.bids ?? []) && rows(value.orderBook?.asks ?? []),
        (value: Json) => record(value.portfolio) && rows(value.portfolio.openPositions) && value.portfolio.openPositions.every((row: Json) => typeof row.symbol === 'string'),
        (value: Json) => rows(value.trades) && value.trades.every((row: Json) => typeof row.symbol === 'string'),
        (value: Json) => value.decision === null || record(value.decision),
        (value: Json) => typeof value.configured === 'boolean',
        (value: Json) => typeof value.running === 'boolean' && typeof value.state === 'string' && rows(value.lastDecisions ?? []),
      ];
      results.forEach((result, index) => {
        if (result.status === 'fulfilled' && !validators[index](result.value)) results[index] = { status: 'rejected', reason: 'INVALID_RESPONSE' };
      });
      const names = ['Servis', 'Pariteler', 'Binance', 'Portföy', 'İşlemler', 'Karar', 'Jev', 'Jev döngüsü'];
      setFailedFeeds(results.flatMap((result, index) => result.status === 'rejected' ? [names[index]] : []));
      const value = (index: number): Json | null => results[index].status === 'fulfilled' ? (results[index] as PromiseFulfilledResult<Json>).value : null;
      setStatus(value(0) || {});
      setSymbols(Array.isArray(value(1)?.symbols) ? value(1)!.symbols : []);
      setMarket(value(2) || { status: 'offline', fresh: false, candles: [], orderBook: { bids: [], asks: [] } });
      setPortfolio(value(3)?.portfolio || {});
      setTrades(Array.isArray(value(4)?.trades) ? value(4)!.trades : []);
      setDecision(value(5)?.decision || null);
      setJev(value(6) || { status: 'offline', available: false });
      setJevLoop(value(7) || { state: 'UNKNOWN', running: false });
      setServiceOffline(!value(0)?.running);
      setCheckedAt(new Date().toISOString());
    } finally {
      if (version === requestVersion.current) { setLoading(false); refreshInFlight.current = false; }
    }
  }, []);

  const operation = useCryptoOperation((result) => {
    if (record(result.portfolio)) setPortfolio(result.portfolio);
    if (record(result.decision)) setDecision(result.decision);
    setMessage(null);
    void refresh();
  });
  const mutationsLocked = Boolean(busy) || operation.locked;

  React.useEffect(() => {
    setMarket({ candles: [], orderBook: { bids: [], asks: [] } });
    void refresh();
    const timer = window.setInterval(() => void refresh(true), jevLoop.running ? 5000 : 10000);
    return () => { window.clearInterval(timer); requestVersion.current += 1; refreshInFlight.current = false; };
  }, [refresh, symbol, timeframe, jevLoop.running]);

  React.useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const symbolList = symbols.map((item) => item.symbol).join(',');
  React.useEffect(() => {
    if (!symbolList || serviceOffline) return;
    const controller = new AbortController();
    let polling = false;
    const updateQuotes = async () => {
      if (polling) return;
      polling = true;
      const list = symbolList.split(',');
      // Limit concurrent public snapshots; the chart has its own faster polling cycle.
      for (let index = 0; index < list.length && !controller.signal.aborted; index += 2) {
        await Promise.allSettled(list.slice(index, index + 2).map(async (asset) => {
          let snapshot: Json = {};
          try { snapshot = await api(`/api/crypto/market?symbol=${encodeURIComponent(asset)}&timeframe=1m`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]) }); } catch { /* Each row exposes unavailable data independently. */ }
          if (!controller.signal.aborted) setWatchQuotes((current) => ({ ...current, [asset]: snapshot }));
        }));
      }
      polling = false;
    };
    void updateQuotes();
    const timer = window.setInterval(() => void updateQuotes(), 60000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [symbolList, serviceOffline]);

  const startService = async () => {
    setBusy('service'); setMessage(null);
    try {
      await api('/api/edith/crypto/start-service', { method: 'POST' });
      await refresh();
      setBusy(null);
    } catch {
      setMessage({ text: 'Crypto servisinin durumu doğrulanamadı.', error: true });
      setBusy(null);
    }
  };

  const runDecision = async () => {
    if (mutationsLocked || !safeDemo || !marketFresh || !loopStopped || !jev.configured) return;
    setMessage(null);
    await operation.submit('decision', { symbol });
  };

  const act = async (action: 'buy' | 'sell' | 'hold') => {
    if (mutationsLocked || !safeDemo || (action === 'buy' && !canBuy) || (action === 'sell' && (!marketFresh || !hasPosition))) return;
    setMessage(null);
    const bodies: Record<string, Json> = {
      buy: { symbol, quoteAmount: Number(quoteAmount), source: 'manual' },
      sell: { symbol, positionPercent: sellPercent, source: 'manual' },
      hold: { symbol, source: 'manual' },
    };
    await operation.submit(action, bodies[action]);
  };

  const startJevLoop = async () => {
    if (mutationsLocked) return;
    setBusy('jev-start'); setMessage(null);
    try {
      const result = await api('/api/crypto/jev/loop/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ intervalSeconds: loopInterval }),
      });
      if (result.ok !== true || typeof result.status?.running !== 'boolean') throw new Error('INVALID_RESPONSE');
      setJevLoop(result.status || jevLoop);
      setMessage({ text: 'Jev demo döngüsü 8 parite için başlatıldı. Her tur tek batch isteğiyle AL / SAT / BEKLE kararı verecek.' });
      window.setTimeout(() => void refresh(true), 1200);
    } catch (error: any) {
      setJevLoop({ state: 'UNKNOWN', running: false });
      setMessage({ text: 'Jev döngüsünün durumu doğrulanamadı. Durum yenileniyor; gerekirse Durdur kullanın.', error: true });
      await refresh();
    } finally { setBusy(null); }
  };

  const stopJevLoop = async () => {
    setBusy('jev-stop'); setMessage(null);
    try {
      const result = await api('/api/crypto/jev/loop/stop', { method: 'POST' });
      if (result.ok !== true || typeof result.status?.running !== 'boolean') throw new Error('INVALID_RESPONSE');
      setJevLoop(result.status || jevLoop);
      setMessage({ text: result.status?.running ? 'Jev mevcut isteği bitirip duruyor.' : 'Jev demo döngüsü durduruldu.' });
      window.setTimeout(() => void refresh(true), 500);
    } catch (error: any) {
      setJevLoop({ state: 'UNKNOWN', running: false });
      setMessage({ text: 'Jev durdurma sonucu doğrulanamadı. Durum yenileniyor.', error: true });
      await refresh();
    } finally { setBusy(null); }
  };

  const resetDemo = async () => {
    if (mutationsLocked || !safeDemo || !loopStopped) return;
    if (!window.confirm('Mevcut demo oturumu kapatılıp işlem ve karar geçmişi arşivlenerek 10.000 kredilik yeni oturum başlatılsın mı?')) return;
    setMessage(null);
    await operation.submit('reset', { confirmation: 'RESET_DEMO_ACCOUNT' });
  };

  const ticker = market.symbol === symbol && market.timeframe === timeframe ? market.ticker || {} : {};
  const change = finiteNumber(ticker.change24h);
  const selectedMode = symbols.find((item) => item.symbol === symbol)?.mode || 'UNKNOWN';
  const configuredAge = finiteNumber(status.maxMarketDataAgeMs ?? market.maxMarketDataAgeMs ?? portfolio.maxMarketDataAgeMs);
  const maxMarketDataAgeMs = configuredAge !== null && configuredAge > 0 ? configuredAge : 15000;
  const marketFresh = market.symbol === symbol && market.timeframe === timeframe && market.fresh === true && freshness(market, clock, maxMarketDataAgeMs).status === 'fresh';
  const safeDemo = !serviceOffline && status.demoMode === true && status.demoTradingEnabled === true && status.liveExecutionEnabled === false && status.realMoneyUsed === false;
  const amount = Number(quoteAmount);
  const estimatedFee = finiteNumber(portfolio.feeRate) === null || !Number.isFinite(amount) ? null : amount * Number(portfolio.feeRate);
  const canBuy = safeDemo && selectedMode === 'DEMO_TRADE_ALLOWED' && marketFresh && !mutationsLocked && amount > 0 && estimatedFee != null && amount + estimatedFee <= Number(portfolio.currentCash);
  const hasPosition = (portfolio.openPositions || []).some((position: Json) => position.symbol === symbol);
  const loopElapsed = jevLoop.running && jevLoop.startedAt
    ? Math.max(0, Math.floor((clock - new Date(String(jevLoop.startedAt)).getTime()) / 1000))
    : Number(jevLoop.elapsedSeconds || 0);
  const loopStopped = jevLoop.state === 'STOPPED' && jevLoop.running === false;
  const loopUnknown = failedFeeds.includes('Jev döngüsü') || jevLoop.state === 'UNKNOWN';
  const decisionExecuted = decision?.executed ?? decision?.execution?.executed ?? decision?.trade_executed ?? decision?.tradeExecuted;
  const blockedReason = decision?.blockedReason ?? decision?.execution?.reason ?? decision?.execution_error ?? decision?.risk_reason;
  const decisionBlocked = decision?.execution?.blocked || decision?.execution_error || decision?.blockedReason || decision?.risk_status === 'VETOED';
  const outcome = operation.outcome;
  const outcomeRejected = outcome && (outcome.operationStatus !== 'completed' || outcome.execution?.blocked === true);

  return (
    <div className="crypto-terminal min-h-full w-full min-w-0 flex-1 overflow-auto font-sans text-zinc-200" data-testid="crypto-terminal">
      <div className="crypto-terminal-workspace">
        <header className="crypto-terminal-header border-b border-white/10">
          <div className="flex min-h-14 flex-wrap items-center justify-between gap-3 px-4 py-2">
            <div className="flex items-center gap-3">
              <div className="crypto-terminal-brand flex h-9 w-9 items-center justify-center"><BarChart3 className="h-5 w-5" /></div>
              <div>
                <div className="text-sm font-black tracking-wide text-white">E.D.I.T.H. CRYPTO</div>
                <div className="text-[9px] font-semibold uppercase text-zinc-600">Jev Demo Exchange Terminali</div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="crypto-terminal-demo">DEMO MODE</span>
              <span className="border border-rose-400/30 bg-rose-400/10 px-2 py-1 text-[10px] font-bold text-rose-300">GERÇEK PARA YOK</span>
              <span className="border border-white/10 px-2 py-1 text-[10px] font-bold text-zinc-400">SİMÜLASYON</span>
              <StatusDot active={market.status === 'online' && marketFresh} label={`BINANCE ${marketFresh ? String(market.status) : 'VERİ YOK / ESKİ'}`} />
              <StatusDot active={!serviceOffline && jev.available === true} label={`JEV ${jev.status === 'checking' ? 'kontrol ediliyor' : serviceOffline || jev.status === 'offline' ? 'offline' : !jev.configured ? 'yapılandırılmalı' : jev.available === true ? 'hazır' : jev.available === false ? 'hata' : 'doğrulanmadı'}`} />
              <button onClick={() => void refresh()} disabled={loading || Boolean(busy)} aria-label="Verileri yenile" title="Verileri yenile" className="flex h-8 w-8 items-center justify-center border border-white/10 text-zinc-400 hover:bg-white/5 disabled:opacity-40">
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 border-t border-white/8 py-2 sm:grid-cols-4 xl:grid-cols-8">
            <Metric label="Aktif Parite" value={symbol} tone="amber" />
            <Metric label="Son Fiyat" value={<TickPrice key={symbol} value={ticker.last} format={price} />} />
            <Metric label="24s Değişim" value={change == null ? '-' : `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`} tone={change == null ? 'neutral' : change >= 0 ? 'green' : 'red'} />
            <Metric label="Demo Equity" value={<AnimatedNumber value={portfolio.currentEquity} format={credits} />} />
            <Metric label="Kullanılabilir" value={<AnimatedNumber value={portfolio.currentCash} format={credits} />} />
            <Metric label="Açık K/Z" value={<AnimatedNumber value={portfolio.unrealizedPnl} format={credits} />} tone={Number(portfolio.unrealizedPnl) >= 0 ? 'green' : 'red'} />
            <Metric label="Gerçekleşen K/Z" value={<AnimatedNumber value={portfolio.realizedPnl} format={credits} />} tone={Number(portfolio.realizedPnl) >= 0 ? 'green' : 'red'} />
            <Metric label="Exposure" value={percent(portfolio.currentExposurePct)} />
          </div>
        </header>

        <div className="crypto-terminal-safety" role="note">
          <ShieldCheck size={15} /><strong>DEMO ONLY</strong><span>NO REAL MONEY</span><span>NO REAL ORDERS</span><span>SIMULATION ONLY</span><span>LIVE TRADING DISABLED</span><span>Başlangıç: 10,000 CR</span>
        </div>
        {serviceOffline && <div className="crypto-terminal-notice" role="status"><WifiOff size={18} /><div><strong>Crypto servisi çevrimdışı</strong><p>Demo kontrolleri beklemede. Son kontrol: {time(checkedAt)}</p></div><button onClick={startService} disabled={mutationsLocked}> <Play size={14} /> Servisi Başlat</button><button onClick={() => void refresh()} disabled={loading}><RefreshCw size={14} /> Tekrar dene</button></div>}
        {!!failedFeeds.length && !serviceOffline && <div className="crypto-terminal-notice" role="status">Veri alınamadı: {failedFeeds.join(', ')}. Bu panellerde güncel değer gösterilemiyor.</div>}

        {operation.pending && <div className="crypto-terminal-notice" role="status" data-testid="crypto-pending-operation">
          <Clock3 size={18} className="shrink-0" /><div className="min-w-0 flex-1"><strong>İşlem sonucu doğrulanıyor.</strong><RecordIds value={operation.pending} /></div>
          <button onClick={() => void operation.recheck()} disabled={operation.checking} aria-label="İşlem durumunu tekrar kontrol et" title="İşlem durumunu tekrar kontrol et"><RefreshCw size={14} /> Tekrar kontrol et</button>
          {operation.notFound && operation.pending.body && <button onClick={() => void operation.resend()} disabled={operation.checking || operation.posting} title="İlk gönderimdeki kimlik ve işlem bilgileri korunur"><RefreshCw size={14} /> Aynı isteği yeniden gönder</button>}
          {operation.notFound && !operation.pending.body && <span>İstek bulunamadı. Eski kayıtta yeniden gönderim bilgisi yok.</span>}
        </div>}
        {operation.storageError && <div className="crypto-terminal-notice" role="status">{operation.storageError}</div>}
        {outcome && <div role="status" data-testid="crypto-operation-result" className={`crypto-terminal-message border-b px-4 py-2 text-xs ${outcomeRejected ? 'border-rose-400/20 bg-rose-400/10 text-rose-300' : 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300'}`}>
          {outcomeRejected ? `İşlem ${outcome.operationStatus === 'failed' ? 'başarısız' : 'reddedildi'}.` : outcome.action === 'reset' ? 'Yeni demo oturumu doğrulandı. Önceki geçmiş arşivlendi.' : 'İşlem sonucu doğrulandı.'}
          {outcome.execution?.executed === true ? ' Demo işlem uygulandı.' : outcome.execution?.executed === false ? ' Demo işlem uygulanmadı.' : ''}
          <RecordIds value={outcome} />
          {(outcome.errorCode || outcome.error?.code || outcome.execution?.reason) && <div className="mt-1 break-all">Neden: {String(outcome.errorCode || outcome.error?.code || outcome.execution?.reason)}</div>}
        </div>}

        {message && (
          <div role="status" className={`crypto-terminal-message flex items-center gap-2 border-b px-4 py-2 text-xs ${message.error ? 'border-rose-400/20 bg-rose-400/10 text-rose-300' : 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300'}`}>
            {message.error ? <AlertTriangle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}{message.text}
          </div>
        )}

        <div className="crypto-terminal-primary">
          <Panel title="Piyasalar" meta="USDT Spot" className="border-l-0 border-t-0 xl:border-b-0">
            <div className="divide-y divide-white/5">
              {(symbols.length ? symbols : SYMBOL_FALLBACK.map((item) => ({ symbol: item }))).map((item) => {
                const quote = item.symbol === market.symbol ? market : watchQuotes[item.symbol];
                const quoteFresh = !serviceOffline && quote?.fresh === true && freshness(quote, clock, maxMarketDataAgeMs).status === 'fresh';
                const quoteChange = quote?.ticker?.change24h;
                return (
                <button key={item.symbol} aria-pressed={symbol === item.symbol} onClick={() => setSymbol(item.symbol)} className={`crypto-terminal-market-row flex w-full items-center justify-between px-3 py-3 text-left transition ${symbol === item.symbol ? 'is-selected' : 'text-zinc-400 hover:bg-white/[0.03]'}`}>
                  <span className="font-mono text-xs font-bold">{String(item.symbol).replace('USDT', '')}<span className="text-zinc-600">/USDT</span></span>
                  <span className="crypto-terminal-market-detail"><TickPrice value={quoteFresh ? quote?.ticker?.last : null} format={price} /><small>{quoteFresh && quoteChange != null ? `${Number(quoteChange) > 0 ? '+' : ''}${Number(quoteChange).toFixed(2)}%` : 'Veri yok / eski'}</small><small>{item.mode === 'DEMO_TRADE_ALLOWED' ? 'DEMO' : item.mode || 'UNKNOWN'}{jevLoop.lastDecisions?.find((row: Json) => row.symbol === item.symbol)?.action ? ` / ${jevLoop.lastDecisions.find((row: Json) => row.symbol === item.symbol).action}` : ''}</small></span>
                </button>
              ); })}
            </div>
            <div className="border-t border-white/8 p-3 text-[10px] leading-relaxed text-zinc-600">
              Binance public data only. Fiyatlar yalnızca alınan piyasa verisinden gösterilir.
            </div>
          </Panel>

          <main className="crypto-terminal-chart-panel min-w-0 border-x border-white/8">
            <div className="flex min-h-14 flex-wrap items-center justify-between gap-3 border-b border-white/8 px-4 py-2">
              <div className="flex items-baseline gap-3">
                <select aria-label="Aktif parite" value={symbol} onChange={(event) => setSymbol(event.target.value)} className="crypto-terminal-symbol-select font-mono text-sm font-bold text-white">{(symbols.length ? symbols : SYMBOL_FALLBACK.map((item) => ({ symbol: item }))).map((item) => <option key={item.symbol} value={item.symbol}>{item.symbol}</option>)}</select>
                <span className="font-mono text-xl font-semibold tabular-nums"><TickPrice key={symbol} value={ticker.last} format={price} /></span>
              </div>
              <div className="flex items-center border border-white/10 bg-black/20">
                {TIMEFRAMES.map((item) => <button key={item} aria-pressed={timeframe === item} onClick={() => setTimeframe(item)} className={`h-8 px-3 text-[10px] font-bold ${timeframe === item ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-zinc-200'}`}>{item}</button>)}
              </div>
            </div>
            {market.candles?.length ? <MarketChart candles={market.candles} symbol={symbol} timeframe={timeframe} /> : (
              <div className={`crypto-terminal-chart crypto-terminal-chart-empty ${loading ? 'crypto-terminal-loading' : ''}`}><WifiOff size={24} /><span>{loading ? 'Binance piyasa verisi bekleniyor' : 'Binance mum verisi kullanılamıyor'}</span></div>
            )}
            <div className="grid grid-cols-2 border-t border-white/8 sm:grid-cols-4">
              <Metric label="24s En Yüksek" value={price(ticker.high24h)} />
              <Metric label="24s En Düşük" value={price(ticker.low24h)} />
              <Metric label="24s Hacim" value={price(ticker.volume24h)} />
              <Metric label="Spread" value={percent(ticker.spreadPct, 4)} />
            </div>
          </main>

          <div className="crypto-terminal-execution">
            <Panel title="Emir Defteri" meta={market.realData ? 'Binance public' : 'Veri yok'} className="border-r-0 border-t-0">
              <div className="grid grid-cols-3 border-b border-white/5 px-3 py-2 text-[9px] uppercase text-zinc-600"><span>Fiyat</span><span className="text-right">Miktar</span><span className="text-right">Toplam</span></div>
              <DepthRows rows={(market.orderBook?.asks || []).slice(0, 9)} side="asks" limit={9} marketKey={symbol} emptyLabel="Satış derinliği verisi yok" />
              <div className="crypto-terminal-spread"><TickPrice key={symbol} value={ticker.last} format={price} /><span>Spread {percent(ticker.spreadPct, 4)}</span></div>
              <DepthRows rows={(market.orderBook?.bids || []).slice(0, 9)} side="bids" limit={9} marketKey={symbol} emptyLabel="Alış derinliği verisi yok" />
            </Panel>

            <Panel title="Demo Emir" meta="Spot / kaldıraç yok" className="border-r-0 border-t-0">
              <div className="space-y-3 p-3">
                <div className="flex justify-between text-[10px] text-zinc-500"><span>Parite modu</span><span className={selectedMode === 'DEMO_TRADE_ALLOWED' ? 'text-emerald-400' : 'text-amber-300'}>{selectedMode}</span></div>
                <div className="crypto-terminal-ticket-safety"><ShieldCheck size={14} /> DEMO ONLY / NO REAL ORDERS</div>
                <label htmlFor="crypto-buy-amount" className="block text-[10px] font-semibold uppercase text-zinc-500">Alım tutarı</label>
                <div className="flex h-10 border border-white/10 bg-black/30">
                  <input id="crypto-buy-amount" value={quoteAmount} onChange={(event) => setQuoteAmount(event.target.value)} type="number" min="1" step="10" className="min-w-0 flex-1 bg-transparent px-3 font-mono text-sm text-white outline-none" />
                  <span className="flex items-center px-3 text-[10px] text-zinc-500">CR</span>
                </div>
                <div className="flex justify-between text-xs"><span>Kullanılabilir</span><span>{credits(portfolio.currentCash)}</span></div>
                <div className="text-xs text-zinc-400">Satılacak pozisyon oranı</div>
                <div className="grid grid-cols-4 gap-1" role="group" aria-label="Satılacak pozisyon oranı">
                  {[25, 50, 75, 100].map((value) => <button key={value} aria-pressed={sellPercent === value} onClick={() => setSellPercent(value)} className={`h-7 text-[10px] font-bold ${sellPercent === value ? 'bg-zinc-700 text-white' : 'border border-white/8 text-zinc-500'}`}>%{value}</button>)}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => void act('buy')} disabled={!canBuy} className="flex h-10 items-center justify-center gap-2 bg-emerald-500 text-xs font-black text-black disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-600"><ArrowDownToLine className="h-4 w-4" /> DEMO AL</button>
                  <button onClick={() => void act('sell')} disabled={!safeDemo || !marketFresh || !hasPosition || mutationsLocked} className="flex h-10 items-center justify-center gap-2 bg-rose-500 text-xs font-black text-white disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-600"><ArrowUpFromLine className="h-4 w-4" /> DEMO SAT</button>
                </div>
                <button onClick={() => void act('hold')} disabled={!safeDemo || mutationsLocked} className="flex h-9 w-full items-center justify-center gap-2 border border-white/10 text-xs font-bold text-zinc-300 hover:bg-white/5 disabled:opacity-40"><Pause className="h-4 w-4" /> DEMO BEKLE / HOLD</button>
                <div className="space-y-1 border-t border-white/8 pt-3 text-[10px] text-zinc-500">
                  <div className="flex justify-between"><span>Tahmini alım ücreti</span><span>{credits(estimatedFee)}</span></div>
                  <div className="flex justify-between"><span>Simüle fee</span><span>{finiteNumber(portfolio.feeRate) === null ? '-' : percent(Number(portfolio.feeRate) * 100)}</span></div>
                  <p>Pozisyon ve toplam risk limitleri demo risk kontrolüyle doğrulanır.</p>
                  {!marketFresh && <p className="text-amber-300">Güncel piyasa verisi bekleniyor. Eski fiyatla demo işlem engellendi.</p>}
                  <div><FreshnessLabel value={market} now={clock} maxAgeMs={maxMarketDataAgeMs} /></div>
                  {amount > Number(portfolio.currentCash) && <p className="text-amber-300">Tutar kullanılabilir demo bakiyesini aşıyor.</p>}
                </div>
              </div>
            </Panel>
          </div>
        </div>

        <div className="crypto-terminal-secondary">
          <Panel title="Demo Portföy" meta="SIMULATION ONLY">
            <div className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-400"><span>Toplam demo varlık</span><span>Başlangıç {portfolio.initialBalance == null ? '10,000 CR / hesap bekleniyor' : credits(portfolio.initialBalance)}</span></div>
              <div className="crypto-terminal-portfolio-value"><AnimatedNumber value={portfolio.currentEquity} format={credits} /></div>
              <div className="crypto-terminal-portfolio-grid">
                <Metric label="Nakit" value={<AnimatedNumber value={portfolio.currentCash} format={credits} />} />
                <Metric label="Toplam K/Z" value={<AnimatedNumber value={portfolio.totalPnl} format={credits} />} />
                <Metric label="Exposure" value={percent(portfolio.currentExposurePct)} />
                <Metric label="Demo işlem sayısı" value={finiteNumber(portfolio.numberOfTrades) ?? '-'} />
                <Metric label="Kazanma oranı" value={percent(portfolio.winRate)} />
                <Metric label="Maksimum düşüş" value={percent(portfolio.maxDrawdown)} />
              </div>
              <div className="text-xs text-zinc-400">Defter güncellemesi: {time(portfolio.updatedAt)} · Değerleme: <FreshnessLabel value={portfolio} now={clock} maxAgeMs={maxMarketDataAgeMs} /></div>
              {portfolio.portfolioSessionId && <div className="mt-1 break-all font-mono text-[10px] text-zinc-400">Oturum: {portfolio.portfolioSessionId}</div>}
              {portfolio.currentEquity == null && <EmptyState title="Demo hesap verisi bekleniyor" />}
            </div>
          </Panel>
          <Panel title="Açık Pozisyonlar" meta={`${(portfolio.openPositions || []).length} pozisyon`} className="border-0 border-r border-white/8">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-left font-mono text-[10px]">
                <thead className="text-zinc-600"><tr className="border-b border-white/5"><th className="px-3 py-2">PARİTE</th><th>YÖN</th><th>GİRİŞ</th><th>MARK</th><th>MİKTAR</th><th>K/Z</th><th>KAYNAK</th></tr></thead>
                <tbody>{(portfolio.openPositions || []).map((position: Json) => <tr key={position.symbol} className="border-b border-white/[.04] text-zinc-300"><td className="px-3 py-3 font-bold text-white">{position.symbol}</td><td className="text-emerald-400">LONG</td><td>{price(position.entryPrice)}</td><td>{price(position.currentPrice ?? position.markPrice)}<div className="text-[9px]"><FreshnessLabel value={position} now={clock} maxAgeMs={maxMarketDataAgeMs} /></div></td><td>{price(position.amount)}</td><td className={Number(position.unrealizedPnl) >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{credits(position.unrealizedPnl)}</td><td>{position.source}</td></tr>)}</tbody>
              </table>
              {!(portfolio.openPositions || []).length && <div className="flex h-24 items-center justify-center text-xs text-zinc-600">Açık demo pozisyon yok</div>}
            </div>
          </Panel>

          <Panel title="Demo İşlem Geçmişi" meta={`${trades.length} kayıt`} className="border-0 border-r border-white/8">
            <div className="max-h-52 overflow-auto">
              <table className="w-full min-w-[620px] text-left font-mono text-[10px]">
                <thead className="sticky top-0 bg-[#151815] text-zinc-600"><tr><th className="px-3 py-2">ZAMAN</th><th>PARİTE</th><th>YÖN</th><th>FİYAT</th><th>MİKTAR</th><th>TUTAR</th><th>FEE</th><th>K/Z</th><th>KAYNAK</th><th>DURUM</th></tr></thead>
                <tbody>{trades.map((trade) => <tr key={trade.tradeId ?? trade.id} data-trade-id={trade.tradeId ?? trade.id} className="border-t border-white/[.04] text-zinc-400"><td className="min-w-40 max-w-56 px-3 py-3">{time(trade.executedAt ?? trade.timestamp)}<RecordIds value={{ ...trade, tradeId: trade.tradeId ?? trade.id }} /></td><td className="font-bold text-zinc-200">{trade.symbol}</td><td className={trade.side === 'BUY' ? 'text-emerald-400' : 'text-rose-400'}>{trade.side}</td><td>{price(trade.executionPrice ?? trade.price)}</td><td>{price(trade.executedQuantity ?? trade.amount)}</td><td>{credits(trade.requestedCredits ?? trade.cost)}</td><td>{credits(trade.fee)}</td><td>{credits(trade.realizedPnl ?? trade.pnl)}</td><td>{trade.source}</td><td>DEMO / {trade.status || '-'}</td></tr>)}</tbody>
              </table>
              {!trades.length && <div className="flex h-24 items-center justify-center text-xs text-zinc-600">Henüz demo işlem yok</div>}
            </div>
          </Panel>

          <div className="crypto-terminal-inspector">
            <Panel title="Jev Kararı" meta="Decision-only" className="border-0 border-b border-white/8">
              <div className="p-3">
                <div className="flex items-center justify-between"><div className="flex items-center gap-2"><Bot className="h-4 w-4 text-amber-300" /><span className="text-sm font-bold">Jev</span></div><span className="bg-amber-400/10 px-2 py-1 text-[9px] font-bold text-amber-300">{String(jev.status || 'config_required').toUpperCase()}</span></div>
                <div className="crypto-terminal-jev-controls">
                  <button className="crypto-terminal-primary-button" onClick={runDecision} disabled={!safeDemo || !marketFresh || !jev.configured || mutationsLocked || !loopStopped}><Bot size={16} />Run Jev Decision</button>
                  <div className="crypto-terminal-ticket-safety"><ShieldCheck size={14} /> DEMO ONLY / {symbol}</div>
                  <span className="text-xs text-zinc-400">Girdi: {marketFresh ? 'Son alınan Binance verisi' : 'Veri yok / eski'} · {time(market.updatedAt)}</span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-[10px]">
                  <div className="bg-black/20 p-2 text-zinc-500">Jev modeli<div className="mt-1 truncate font-mono text-xs text-zinc-100">{jev.model || '-'}</div></div>
                  <div className="bg-black/20 p-2 text-zinc-500">Son karar / {decision?.symbol || '-'}<div className="mt-1 font-mono text-sm text-zinc-100"><DecisionBadge decision={decision?.action || decision?.decision} decisionId={decision?.decisionId ?? decision?.id} timestamp={decision?.timestamp} /></div></div>
                  <div className="bg-black/20 p-2 text-zinc-500">Güven<div className="mt-1 font-mono text-xs text-zinc-100">{decision?.confidence == null ? '-' : `${(Number(decision.confidence) * 100).toFixed(1)}%`}</div></div>
                  <div className="bg-black/20 p-2 text-zinc-500">Karar gecikmesi<div className="mt-1 font-mono text-xs text-zinc-100">{decision?.latency_ms ?? decision?.latencyMs ?? '-'}{(decision?.latency_ms ?? decision?.latencyMs) != null ? ' ms' : ''}</div></div>
                  <div className="bg-black/20 p-2 text-zinc-500">Kaynak<div className="mt-1 font-mono text-xs text-zinc-100">{decision?.source || '-'}</div></div>
                  <div className="bg-black/20 p-2 text-zinc-500">Zaman<div className="mt-1 font-mono text-xs text-zinc-100">{time(decision?.timestamp)}</div></div>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-px border border-white/8 bg-white/8 text-[10px]">
                  <div className="bg-[#101210] p-2 text-zinc-500">Döngü<div className={`mt-1 font-mono font-bold ${jevLoop.running ? 'text-emerald-400' : 'text-zinc-300'}`}>{String(jevLoop.state || 'UNKNOWN')}</div></div>
                  <div className="bg-[#101210] p-2 text-zinc-500">Geçen süre<div className="mt-1 font-mono font-bold tabular-nums text-zinc-100">{duration(loopElapsed)}</div></div>
                  <div className="bg-[#101210] p-2 text-zinc-500">Tur / karar<div className="mt-1 font-mono text-zinc-100">{Number(jevLoop.cycles || 0)} / {Number(jevLoop.decisionCount || 0)}</div></div>
                  <div className="bg-[#101210] p-2 text-zinc-500">Kapsam<div className="mt-1 font-mono text-zinc-100">{jevLoop.symbolCount ?? '-'} PARİTE</div></div>
                  <div className="bg-[#101210] p-2 text-zinc-500">Jev API<div className="mt-1 font-mono text-zinc-100">{jevLoop.lastLatencyMs == null ? '-' : `${jevLoop.lastLatencyMs} ms`}</div></div>
                  <div className="bg-[#101210] p-2 text-zinc-500">Toplam tur<div className="mt-1 font-mono text-zinc-100">{jevLoop.lastCycleLatencyMs == null ? '-' : `${jevLoop.lastCycleLatencyMs} ms`}</div></div>
                </div>
                {!!jevLoop.lastDecisions?.length && (
                  <div className="mt-2 grid grid-cols-2 gap-px overflow-hidden border border-white/8 bg-white/8 font-mono text-[9px]">
                    {jevLoop.lastDecisions.map((item: Json) => (
                      <div key={item.symbol} className="flex min-w-0 items-center justify-between gap-2 bg-[#101210] px-2 py-1.5">
                        <span className="truncate text-zinc-500">{item.symbol}</span>
                        <span title={item.reason || ''} className={item.blocked ? 'text-rose-300' : item.action === 'BUY' ? 'text-emerald-400' : item.action === 'SELL' ? 'text-rose-400' : 'text-amber-300'}>
                          {item.action || 'VERİ YOK'}{item.blocked ? ' · VETO' : item.executed ? ' · DEMO' : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {decision && (
                  <div className={`mt-2 break-words border px-2 py-2 text-[10px] ${decisionExecuted ? 'border-emerald-400/20 bg-emerald-400/5 text-emerald-300' : decisionBlocked ? 'border-rose-400/20 bg-rose-400/5 text-rose-300' : 'border-white/8 text-zinc-500'}`}>
                    {decision.valid === 0 || decision.valid === false ? 'Geçersiz model çıktısı / INVALID OUTPUT' : decisionExecuted
                      ? 'Karar demo portföyde uygulandı.'
                      : decisionBlocked
                        ? `Risk engeli: ${blockedReason || '-'}`
                        : (decision.action || decision.decision) === 'HOLD' ? 'HOLD / İşlem açılmadı. Geçerli bekleme kararı.' : 'Karar kaydedildi; demo işlem uygulanmadı.'}
                    <div className="mt-1">Risk kontrolü: {typeof decision.riskResult === 'string' ? decision.riskResult : decision.riskResult?.reason || decision.riskResult?.status || decision.risk_status || '-'} · Kaynak: {decision.source || '-'}</div>
                    <div className="mt-1">Demo uygulandı: {decisionExecuted === true || decisionExecuted === 1 ? 'Evet' : decisionExecuted === false || decisionExecuted === 0 ? 'Hayır' : '-'}</div>
                    <div className="mt-1">Girdi fiyat zamanı: {time(decision.inputMarketTimestamp)} · Veri yaşı: {finiteNumber(decision.marketDataAgeMs) === null ? '-' : `${decision.marketDataAgeMs} ms`}</div>
                    {(decision.model || decision.model_used) && <div className="mt-1 break-all">Karar modeli: {decision.model || decision.model_used}</div>}
                    <RecordIds value={{ ...decision, decisionId: decision.decisionId ?? decision.id }} />
                    {decision.source !== 'jev' && <div className="mt-1">Son kayıt {decision.source || 'bilinmeyen kaynak'} tarafından oluşturuldu; Jev çıktısı değil.</div>}
                  </div>
                )}
                <div className="mt-3 flex h-9 border border-white/10 bg-black/30">
                  <label className="flex items-center px-2 text-[9px] font-semibold uppercase text-zinc-500" htmlFor="jev-loop-interval">Karar aralığı</label>
                  <select id="jev-loop-interval" value={loopInterval} onChange={(event) => setLoopInterval(Number(event.target.value))} disabled={jevLoop.running} className="min-w-0 flex-1 bg-transparent px-2 text-right font-mono text-xs text-zinc-200 outline-none disabled:text-zinc-600">
                    <option value={10}>10 sn</option>
                    <option value={15}>15 sn</option>
                    <option value={30}>30 sn</option>
                    <option value={60}>1 dk</option>
                    <option value={300}>5 dk</option>
                  </select>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button onClick={startJevLoop} disabled={!safeDemo || mutationsLocked || jevLoop.running || !jev.configured || failedFeeds.includes('Jev döngüsü')} className="flex h-9 items-center justify-center gap-2 bg-amber-400 text-xs font-black text-black disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-600"><Play className="h-4 w-4" /> Jev'i Çalıştır</button>
                  <button onClick={stopJevLoop} disabled={Boolean(busy) || serviceOffline || (!jevLoop.running && !loopUnknown)} className="flex h-9 items-center justify-center gap-2 border border-rose-400/30 text-xs font-black text-rose-300 hover:bg-rose-400/10 disabled:cursor-not-allowed disabled:border-white/8 disabled:text-zinc-700"><Square className="h-3.5 w-3.5" /> Durdur</button>
                </div>
                <div className="mt-2 flex items-center justify-between font-mono text-[9px] text-zinc-600"><span>AL {jevLoop.actions?.BUY || 0}</span><span>BEKLE {jevLoop.actions?.HOLD || 0}</span><span>SAT {jevLoop.actions?.SELL || 0}</span></div>
                {jevLoop.lastError && <p className="mt-2 text-[10px] text-rose-300">Son döngü hatası: {jevLoop.lastError}</p>}
                {jev.configured === false && <p className="mt-2 text-[10px] leading-relaxed text-zinc-600">Jev API is not configured. Add JEV_API_KEY and JEV_API_URL to backend environment.</p>}
                {jev.configured && jev.available == null && <p className="mt-2 text-[10px] leading-relaxed text-amber-300">{jev.safeMessage || 'Jev yapılandırıldı; ilk bağlantı henüz doğrulanmadı.'}</p>}
                {jev.configured && jev.available === false && <p className="mt-2 text-[10px] leading-relaxed text-rose-300">{jev.safeMessage || 'Jev API kullanılamıyor.'}</p>}
              </div>
            </Panel>

            <Panel title="Güvenlik / Faz" meta="Kilitli" className="border-0">
              <div className="space-y-2 p-3 text-[10px]">
                <div className="flex items-center gap-2 text-emerald-400"><ShieldCheck className="h-4 w-4" /> Gerçek emir yolu yok</div>
                <div className="flex items-center justify-between text-zinc-500"><span>Obsidian logging</span><span>KAPALI</span></div>
                <div className="flex items-center justify-between text-zinc-500"><span>Öğrenme sistemi</span><span>KAPALI</span></div>
                <div className="flex items-center justify-between text-zinc-500"><span>Haber analizi</span><span>KAPALI</span></div>
                <div className="flex items-center justify-between text-zinc-500"><span>Ollama crypto</span><span>KAPALI</span></div>
                <div className="flex items-center justify-between text-zinc-500"><span>Canlı Binance işlem</span><span className="text-rose-400">KİLİTLİ</span></div>
                <button onClick={resetDemo} title={!loopStopped ? 'Sıfırlamadan önce Jev döngüsünün durduğunu doğrulayın.' : 'Geçmişi arşivle ve yeni demo oturumu başlat'} disabled={!safeDemo || mutationsLocked || !loopStopped} className="mt-2 flex h-8 w-full items-center justify-center gap-2 border border-rose-400/20 text-rose-300 hover:bg-rose-400/10 disabled:opacity-40"><RotateCcw className="h-3.5 w-3.5" /> Demo Hesabı Sıfırla</button>
              </div>
            </Panel>
          </div>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-white/8 px-4 py-2 text-[9px] uppercase text-zinc-600">
          <span className="flex items-center gap-2"><Database className="h-3 w-3" /> Yerel demo ledger / gerçek para kullanılmaz</span>
          <span className="flex items-center gap-2"><Clock3 className="h-3 w-3" /> Son veri {time(market.updatedAt)}</span>
          <span className="flex items-center gap-2">{marketFresh ? <Wifi className="h-3 w-3 text-emerald-400" /> : <WifiOff className="h-3 w-3 text-amber-400" />} {marketFresh ? 'Son sorgu güncel' : 'Veri yok veya eski'}</span>
          <span className="flex items-center gap-2"><CircleDollarSign className="h-3 w-3" /> Başlangıç 10.000 demo kredi</span>
        </footer>
      </div>
    </div>
  );
}
