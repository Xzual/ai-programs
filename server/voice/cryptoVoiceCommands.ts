import { randomUUID } from "node:crypto";
import { binanceSpotService, BinanceSpotError } from "../crypto/binanceSpotService";
import { cryptoService } from "../../src/edith/cryptoService";

export type CryptoVoiceIntent =
  | "help" | "connection_status" | "market_summary" | "price" | "movers" | "compare"
  | "account_summary" | "balances" | "open_orders" | "portfolio" | "trade_history"
  | "jev_status" | "jev_analyze" | "jev_loop_start" | "jev_loop_stop"
  | "create_proposal" | "show_proposal" | "reject_proposal" | "proposal_status"
  | "kill_switch_on" | "kill_switch_off_denied" | "hold" | "ambiguous_trade" | "unsupported_alert";

export interface CryptoVoiceCommandResult {
  matched: boolean;
  intent?: CryptoVoiceIntent;
  reply: string;
  navigateTo?: "crypto";
  requiresVisualApproval?: boolean;
  data?: Record<string, unknown>;
}

export const CRYPTO_VOICE_COMMAND_EXAMPLES = [
  "Binance bağlantısı çalışıyor mu?", "Bakiyemi söyle", "Hangi coinlerden var?", "Açık emirleri söyle",
  "Top 10 coinleri sırala", "Bitcoin şu anda kaç dolar?", "En çok yükselen üç coini söyle",
  "BTC, ETH ve BNB'yi karşılaştır", "Portföyümü özetle", "Bugün Binance'da neler yaptın?",
  "Jev hazır mı?", "Bitcoin için Jev kararı üret", "Jev top 10 analizi başlat", "Jev'i durdur",
  "100 USDT'lik Bitcoin alım taslağı hazırla, güncel fiyatı kullan", "0,01 BTC için 82500 limit satış taslağı hazırla",
  "Son emir ne durumda?", "Taslağı ekranda göster", "Taslağı reddet", "Crypto kill switch'i aç",
] as const;

const aliases: Array<[RegExp, string, string]> = [
  [/\b(bitcoin|btc)\b/i, "BTCUSDT", "Bitcoin"], [/\b(ethereum|ether|eth)\b/i, "ETHUSDT", "Ethereum"],
  [/\b(bnb|binance coin)\b/i, "BNBUSDT", "BNB"], [/\b(xrp|ripple)\b/i, "XRPUSDT", "XRP"],
  [/\b(solana|sol)\b/i, "SOLUSDT", "Solana"], [/\b(tron|trx)\b/i, "TRXUSDT", "TRON"],
  [/\b(zcash|zec)\b/i, "ZECUSDT", "Zcash"], [/\b(hyperliquid|hype)\b/i, "HYPEUSDT", "Hyperliquid"],
  [/\b(dogecoin|doge)\b/i, "DOGEUSDT", "Dogecoin"], [/\b(cardano|ada)\b/i, "ADAUSDT", "Cardano"],
];

// Keep the leading boundary but allow Turkish suffixes such as coinleri, emirlerim and bakiyelerim.
const cryptoContext = /\b(?:binance|kripto|crypto|coin|bitcoin|btc|ethereum|ether|eth|bnb|xrp|ripple|solana|tron|trx|zcash|zec|hyperliquid|hype|dogecoin|doge|cardano|ada|usdt|jev|portföy|portfoy|emir|bakiye)/i;
const buyWords = /\b(al|alım|alim|satın al|buy|long)\b/i;
const sellWords = /\b(sat|satış|satis|sell)\b/i;

function foldSpeech(input: string): string {
  return input.toLocaleLowerCase("tr-TR").normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i").replace(/ş/g, "s").replace(/ç/g, "c").replace(/ğ/g, "g")
    .replace(/ö/g, "o").replace(/ü/g, "u");
}

function symbolsIn(text: string): Array<{ symbol: string; name: string }> {
  const found = aliases.filter(([pattern]) => pattern.test(text)).map(([, symbol, name]) => ({ symbol, name }));
  return [...new Map(found.map((item) => [item.symbol, item])).values()];
}

function money(value: unknown, digits = 2): string {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toLocaleString("tr-TR", { maximumFractionDigits: digits }) : "doğrulanamadı";
}

async function dashboard(path: string, init?: RequestInit, timeoutMs = 12000): Promise<Record<string, any>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const base = process.env.EDITH_CRYPTO_SERVICE_URL || process.env.EDITH_CRYPTO_DASHBOARD_URL || "http://localhost:5000";
  try {
    const headers = new Headers(init?.headers);
    if (init?.method && init.method !== "GET") {
      Object.entries(cryptoService.internalRequestHeaders()).forEach(([key, value]) => headers.set(key, value));
    }
    const response = await fetch(`${base}${path}`, { ...init, headers, signal: controller.signal, redirect: "error" });
    const value = await response.json();
    if (!response.ok || !value || typeof value !== "object") throw new Error("DASHBOARD_UNAVAILABLE");
    return value as Record<string, any>;
  } finally { clearTimeout(timeout); }
}

export function isCryptoVoiceCommand(text: string): boolean {
  return cryptoContext.test(String(text || ""));
}

function disabledPrivate(intent: CryptoVoiceIntent): CryptoVoiceCommandResult {
  return {
    matched: true, intent, navigateTo: "crypto", requiresVisualApproval: false,
    reply: "DEMO_ONLY: Binance private hesap, bakiye, açık emir ve gerçek emir taslağı erişimi kalıcı olarak kapalı. Gerçek emir veya görsel onay oluşturulmaz. 10.000 CR demo portföyünü ve public piyasa verisini kullanabilirsiniz.",
    data: { mode: "DEMO_ONLY", status: "disabled", errorCode: "demo_only", privateRequestsEnabled: false, realOrderSent: false },
  };
}

export class CryptoVoiceCommandService {
  constructor(private readonly binance = binanceSpotService) {}

  async execute(rawText: string): Promise<CryptoVoiceCommandResult> {
    const text = String(rawText || "").trim();
    if (!text || !isCryptoVoiceCommand(text)) return { matched: false, reply: "" };
    const lower = foldSpeech(text);
    const selected = symbolsIn(text);

    if (/\b(yardim|neler soyleyebilirim|komut|help)/i.test(lower)) {
      return { matched: true, intent: "help", navigateTo: "crypto", reply: "Public coin fiyatı, top 10 piyasa, karşılaştırma, 10.000 CR demo portföyü ve demo işlem geçmişini sorabilirsiniz. Jev demo kararlarını kontrol edebilir ve kill switch açabilirsiniz. DEMO_ONLY: Binance private hesap ve gerçek emir erişimi kalıcı kapalı; sesli veya görsel onay ile açılamaz." };
    }

    if (/kill switch|acil dur|tum islemleri durdur|canli islemi kilitle/i.test(lower)) {
      if (/kapat|devre disi|disable/i.test(lower)) {
        return { matched: true, intent: "kill_switch_off_denied", navigateTo: "crypto", reply: "Kill switch sesli komutla kapatılamaz. Güvenlik merkezinde sahip doğrulaması gerekir." };
      }
      const status = this.binance.setKillSwitch(true);
      return { matched: true, intent: "kill_switch_on", navigateTo: "crypto", reply: "Crypto kill switch açıldı. Demo BUY/SELL işlemleri durduruldu. Gerçek emir erişimi zaten kalıcı olarak kapalı.", data: { status } };
    }

    if (/\b(son.*emir|emir.*durum|taslak.*durum|gerceklesti mi|onayla|approve|emri gonder)/i.test(lower)) return disabledPrivate("proposal_status");

    if (/\b(baglanti|bagli mi|hazir mi|durum)/i.test(lower) && /binance|spot|api/i.test(lower)) {
      const status = this.binance.status();
      const phrase = "DEMO_ONLY; private hesap ve gerçek emir erişimi kalıcı kapalı, public piyasa verisi kullanılabilir";
      return { matched: true, intent: "connection_status", navigateTo: "crypto", reply: `Binance Global Spot durumu: ${phrase}. Kill switch ${status.killSwitch ? "açık" : "kapalı"}. Para çekme, futures ve margin bu sistemde yok.`, data: { status } };
    }

    if (/\b(top\s*10|piyasa ozeti|coinleri sirala|izleme listesi)/i.test(lower)) {
      const markets = await this.binance.markets();
      const spoken = markets.map((row) => `${row.rank}. ${row.symbol.replace("USDT", "")}, ${money(row.price, Number(row.price) < 1 ? 6 : 2)} dolar`).join("; ");
      return { matched: true, intent: "market_summary", navigateTo: "crypto", reply: `Binance Spot top 10 listesi: ${spoken}.`, data: { markets } };
    }

    if (/\b(en cok yukselen|yukselenler|en cok dusen|dusenler)/i.test(lower)) {
      const markets = await this.binance.markets();
      const descending = !/dusen/i.test(lower);
      const ranked = [...markets].filter((row) => Number.isFinite(Number(row.change24h))).sort((a, b) => (Number(b.change24h) - Number(a.change24h)) * (descending ? 1 : -1)).slice(0, 3);
      return { matched: true, intent: "movers", navigateTo: "crypto", reply: `${descending ? "En çok yükselen" : "En çok düşen"} üç coin: ${ranked.map((row) => `${row.symbol.replace("USDT", "")} yüzde ${money(row.change24h)}`).join("; ")}.`, data: { markets: ranked } };
    }

    if (/\b(karsilastir|compare)/i.test(lower) && selected.length >= 2) {
      const markets = await this.binance.markets();
      const chosen = markets.filter((row) => selected.some((coin) => coin.symbol === row.symbol));
      return { matched: true, intent: "compare", navigateTo: "crypto", reply: chosen.map((row) => `${row.symbol.replace("USDT", "")}: ${money(row.price, Number(row.price) < 1 ? 6 : 2)} dolar, 24 saat yüzde ${money(row.change24h)}`).join("; "), data: { markets: chosen } };
    }

    if (selected.length && /\b(kac|fiyat|price|ne kadar|degeri)/i.test(lower) && !buyWords.test(lower) && !sellWords.test(lower)) {
      const markets = await this.binance.markets();
      const row = markets.find((item) => item.symbol === selected[0].symbol);
      return { matched: true, intent: "price", navigateTo: "crypto", reply: row ? `${selected[0].name} fiyatı ${money(row.price, Number(row.price) < 1 ? 6 : 2)} USDT. Son 24 saat değişimi yüzde ${money(row.change24h)}.` : `${selected[0].name} fiyatı doğrulanamadı.`, data: { market: row } };
    }

    if (/\b(acik emir|bekleyen emir|open orders)/i.test(lower)) return disabledPrivate("open_orders");

    if (/\b(bakiye|hesabim|varlik)|hangi coin.*var|hesap/i.test(lower)) {
      return disabledPrivate(/hangi coin|varlik|bakiyeler/i.test(lower) ? "balances" : "account_summary");
    }

    if (/\b(portfoy|kar zarar|pozisyon)/i.test(lower)) {
      const value = await dashboard("/api/crypto/portfolio");
      const portfolio = value.portfolio ?? value;
      return { matched: true, intent: "portfolio", navigateTo: "crypto", reply: `Demo portföy özeti: toplam değer ${money(portfolio.currentEquity)} kredi, kullanılabilir ${money(portfolio.currentCash)} kredi, açık kâr zarar ${money(portfolio.unrealizedPnl)} kredi. Bu rakamlar demo ledger verisidir.`, data: { portfolio } };
    }

    if (/\b(ne yaptin|neler yaptin|islem gecmisi|son islemler|trade history)/i.test(lower)) {
      const value = await dashboard("/api/crypto/trades?limit=20");
      const trades = Array.isArray(value.trades) ? value.trades : [];
      return { matched: true, intent: "trade_history", navigateTo: "crypto", reply: trades.length ? `Son kayıtlarda ${trades.length} demo işlem var. ${trades.slice(0, 5).map((trade: any) => `${trade.symbol} ${trade.side}`).join("; ")}.` : "Demo işlem geçmişinde kayıt yok.", data: { trades, mode: "DEMO_ONLY" } };
    }

    if (/\b(jev.*durum|jev hazir|jev baglanti)/i.test(lower)) {
      const value = await dashboard("/api/crypto/jev/status");
      return { matched: true, intent: "jev_status", navigateTo: "crypto", reply: `Jev ${value.available === true ? "hazır" : value.configured ? "yapılandırılmış fakat kullanılamıyor" : "yapılandırılmamış"}. Model ${value.model || "bildirilmedi"}.`, data: { jev: value } };
    }

    if (/\b(jev.*durdur|analizi durdur|donguyu durdur)/i.test(lower)) {
      const value = await dashboard("/api/crypto/jev/loop/stop", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      return { matched: true, intent: "jev_loop_stop", navigateTo: "crypto", reply: "Jev demo karar döngüsü durdurma isteği gönderildi. Yeni gerçek emir gönderilmedi.", data: { status: value.status ?? value } };
    }

    if (/\b(jev.*calistir|top 10.*analiz|analizi baslat)/i.test(lower) && !selected.length) {
      const value = await dashboard("/api/crypto/jev/loop/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ intervalSeconds: 60 }) });
      return { matched: true, intent: "jev_loop_start", navigateTo: "crypto", reply: "Jev demo karar döngüsü başlatıldı. Bu döngü gerçek emir göndermez; kararları Crypto ekranında görebilirsiniz.", data: { status: value.status ?? value } };
    }

    if (/\b(jev|analiz|karar uret|karar ver)/i.test(lower) && selected.length) {
      const value = await dashboard("/api/crypto/decision/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientRequestId: `voice-${randomUUID()}`, symbol: selected[0].symbol }) }, 20000);
      const decision = value.decision ?? value.data?.decision ?? value;
      return { matched: true, intent: "jev_analyze", navigateTo: "crypto", reply: `${selected[0].name} için Jev kararı ${decision.action || decision.decision || "doğrulanamadı"}. Güven ${decision.confidence != null ? `yüzde ${money(Number(decision.confidence) * 100)}` : "bildirilmedi"}. Bu karar tek başına gerçek emir göndermez.`, data: { decision } };
    }

    if (/\b(taslagi goster|emri goster|ekranda goster)/i.test(lower)) return disabledPrivate("show_proposal");
    if (/\b(taslagi iptal|taslagi reddet|emir taslagini sil)/i.test(lower)) return disabledPrivate("reject_proposal");
    if (/\b(son emir|emir durumu|taslak durumu|gerceklesti mi|onayla|approve|emri gonder)/i.test(lower)) return disabledPrivate("proposal_status");

    if (/\b(haber ver|bildir|alarm|ulasirsa|gelirse)/i.test(lower)) {
      return { matched: true, intent: "unsupported_alert", navigateTo: "crypto", reply: "Fiyat ve olay alarmı henüz kalıcı görev olarak bağlı değil. Sahte bir alarm oluşturmayacağım; isterseniz mevcut fiyatı veya Jev kararını şimdi kontrol edebilirim." };
    }

    if (/\b(hold|bekle|islem yapma)/i.test(lower)) {
      return { matched: true, intent: "hold", navigateTo: "crypto", reply: "HOLD. Yeni işlem talep edilmedi." };
    }

    if (buyWords.test(lower) || sellWords.test(lower) || /\b(taslak|isleme basla)/i.test(lower)) return disabledPrivate("create_proposal");

    return { matched: true, intent: "help", navigateTo: "crypto", reply: "Crypto komutunu anladım ancak yapılacak işlemi netleştiremedim. Public fiyat, top 10, Jev demo kararı, demo portföyü veya demo işlem geçmişi şeklinde söyleyebilirsiniz. Private Binance erişimi kalıcı kapalı." };
  }
}

export const cryptoVoiceCommandService = new CryptoVoiceCommandService();

export function safeCryptoVoiceError(error: unknown): string {
  if (error instanceof BinanceSpotError) return error.message;
  if (error instanceof Error && error.name === "AbortError") return "Crypto servisi zaman aşımına uğradı.";
  return "Crypto komutu güvenli biçimde tamamlanamadı. Durumu ekrandan kontrol edin.";
}
