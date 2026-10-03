import { randomUUID } from "node:crypto";
import { binanceSpotService, BinanceSpotError, type BinanceSpotProposal } from "../crypto/binanceSpotService";
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

const quantityTokens: Record<string, string> = {
  BTCUSDT: "(?:btc|bitcoin)", ETHUSDT: "(?:eth|ethereum|ether)", BNBUSDT: "(?:bnb|binance coin)",
  XRPUSDT: "(?:xrp|ripple)", SOLUSDT: "(?:sol|solana)", TRXUSDT: "(?:trx|tron)",
  ZECUSDT: "(?:zec|zcash)", HYPEUSDT: "(?:hype|hyperliquid)", DOGEUSDT: "(?:doge|dogecoin)",
  ADAUSDT: "(?:ada|cardano)",
};

// Keep the leading boundary but allow Turkish suffixes such as coinleri, emirlerim and bakiyelerim.
const cryptoContext = /\b(?:binance|kripto|crypto|coin|bitcoin|btc|ethereum|ether|eth|bnb|xrp|ripple|solana|tron|trx|zcash|zec|hyperliquid|hype|dogecoin|doge|cardano|ada|usdt|jev|portföy|portfoy|emir|bakiye)/i;
const buyWords = /\b(al|alım|alim|satın al|buy|long)\b/i;
const sellWords = /\b(sat|satış|satis|sell)\b/i;

function numberValue(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const compact = raw.replace(/\s/g, "");
  const normalized = compact.includes(",") && compact.includes(".")
    ? compact.lastIndexOf(",") > compact.lastIndexOf(".") ? compact.replace(/\./g, "").replace(",", ".") : compact.replace(/,/g, "")
    : compact.replace(",", ".");
  const value = Number(normalized);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

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

function amountParts(text: string, symbol?: string) {
  const quote = text.match(/([0-9][0-9.,]*)\s*(?:usdt|dolar(?:lık|lik)?)/i);
  const price = text.match(/(?:limit|fiyat(?:ı|i|tan|ten|a|e)?|price)\s*(?:olarak|=|:)?\s*([0-9][0-9.,]*)/i)
    ?? text.match(/([0-9][0-9.,]*)\s*(?:usdt|dolar)\s*(?:fiyat|limit)/i)
    ?? text.match(/([0-9][0-9.,]*)\s*(?:limit\s+fiyat|limit)(?:\s|$)/i);
  let quantity: number | undefined;
  if (symbol) {
    const token = quantityTokens[symbol];
    const quantityMatch = token ? text.match(new RegExp(`([0-9][0-9.,]*)\\s*${token}\\b`, "i")) : undefined;
    quantity = numberValue(quantityMatch?.[1]);
  }
  return { quoteAmount: numberValue(quote?.[1]), price: numberValue(price?.[1]), quantity };
}

export function isCryptoVoiceCommand(text: string): boolean {
  return cryptoContext.test(String(text || ""));
}

export class CryptoVoiceCommandService {
  constructor(private readonly binance = binanceSpotService) {}

  async execute(rawText: string): Promise<CryptoVoiceCommandResult> {
    const text = String(rawText || "").trim();
    if (!text || !isCryptoVoiceCommand(text)) return { matched: false, reply: "" };
    const lower = foldSpeech(text);
    const selected = symbolsIn(text);

    if (/\b(yardim|neler soyleyebilirim|komut|help)/i.test(lower)) {
      return { matched: true, intent: "help", navigateTo: "crypto", reply: "Binance bağlantısını, bakiyeyi, açık emirleri, top 10 piyasayı, coin fiyatını, yükselenleri, düşenleri, portföyü ve işlem geçmişini sorabilirsiniz. Jev analizi çalıştırabilir, alım veya satış taslağı hazırlatabilir, taslağı gösterebilir, reddedebilir ve kill switch'i açabilirsiniz. Gerçek emir sesle onaylanmaz; ekrandaki tek kullanımlık kod gerekir." };
    }

    if (/kill switch|acil dur|tum islemleri durdur|canli islemi kilitle/i.test(lower)) {
      if (/kapat|devre disi|disable/i.test(lower)) {
        return { matched: true, intent: "kill_switch_off_denied", navigateTo: "crypto", reply: "Kill switch sesli komutla kapatılamaz. Güvenlik merkezinde sahip doğrulaması gerekir." };
      }
      const status = this.binance.setKillSwitch(true);
      return { matched: true, intent: "kill_switch_on", navigateTo: "crypto", reply: "Binance Spot kill switch açıldı. Yeni gerçek emir onayları engellendi.", data: { status } };
    }

    if (/\b(baglanti|bagli mi|hazir mi|durum)/i.test(lower) && /binance|spot|api/i.test(lower)) {
      const status = this.binance.status();
      const phrase = status.configured ? status.liveEnabled ? "API bağlı ve canlı Spot işlem açık" : "API yapılandırılmış fakat canlı işlem kilitli" : "API anahtarı henüz bağlı değil";
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

    if (/\b(acik emir|bekleyen emir|open orders)/i.test(lower)) {
      const orders = await this.binance.openOrders(selected[0]?.symbol);
      return { matched: true, intent: "open_orders", navigateTo: "crypto", reply: orders.length ? `${orders.length} açık emir var. ${orders.slice(0, 5).map((order: any) => `${order.symbol} ${order.side} ${order.origQty} adet, ${order.price} USDT`).join("; ")}.` : "Binance Spot hesabında açık emir yok.", data: { orders } };
    }

    if (/\b(bakiye|hesabim|varlik)/i.test(lower)) {
      const account = await this.binance.account();
      const balances = account.balances.filter((row: any) => Number(row.free) > 0 || Number(row.locked) > 0);
      const usdt = balances.find((row: any) => row.asset === "USDT");
      const detail = /hangi coin|varlik|bakiyeler/i.test(lower) ? balances.slice(0, 12).map((row: any) => `${row.asset} ${money(row.free, 8)}`).join("; ") : `Kullanılabilir USDT ${money(usdt?.free ?? 0)}`;
      return { matched: true, intent: /hangi coin|varlik|bakiyeler/i.test(lower) ? "balances" : "account_summary", navigateTo: "crypto", reply: `Spot hesabı ${account.canTrade ? "işleme açık" : "işleme kapalı"}. ${detail}.`, data: { account } };
    }

    if (/\b(portfoy|kar zarar|pozisyon)/i.test(lower)) {
      const value = await dashboard("/api/crypto/portfolio");
      const portfolio = value.portfolio ?? value;
      return { matched: true, intent: "portfolio", navigateTo: "crypto", reply: `Demo portföy özeti: toplam değer ${money(portfolio.currentEquity)} kredi, kullanılabilir ${money(portfolio.currentCash)} kredi, açık kâr zarar ${money(portfolio.unrealizedPnl)} kredi. Bu rakamlar demo ledger verisidir.`, data: { portfolio } };
    }

    if (/\b(ne yaptin|neler yaptin|islem gecmisi|son islemler|trade history)/i.test(lower)) {
      const value = await dashboard("/api/crypto/trades?limit=20");
      const trades = Array.isArray(value.trades) ? value.trades : [];
      const proposal = this.binance.latestProposal();
      return { matched: true, intent: "trade_history", navigateTo: "crypto", reply: `${trades.length ? `Son kayıtlarda ${trades.length} demo işlem var. ${trades.slice(0, 5).map((trade: any) => `${trade.symbol} ${trade.side}`).join("; ")}.` : "Demo işlem geçmişinde kayıt yok."} ${proposal ? `Son Binance taslağı ${proposal.symbol} ${proposal.side}, durum ${proposal.state}.` : "Binance için hazırlanmış taslak yok."}`, data: { trades, proposal } };
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

    if (/\b(taslagi goster|emri goster|ekranda goster)/i.test(lower)) {
      const proposal = this.binance.latestProposal();
      return { matched: true, intent: "show_proposal", navigateTo: "crypto", requiresVisualApproval: proposal?.state === "AWAITING_APPROVAL", reply: proposal ? `Son taslak ${proposal.symbol} ${proposal.side}, ${proposal.quantity} adet, limit fiyat ${proposal.price} USDT. Durum ${proposal.state}. Crypto ekranını açıyorum.` : "Gösterilecek Binance emir taslağı yok.", data: { proposal } };
    }

    if (/\b(taslagi iptal|taslagi reddet|emir taslagini sil)/i.test(lower)) {
      const proposal = this.binance.latestProposal();
      if (!proposal || proposal.state !== "AWAITING_APPROVAL") return { matched: true, intent: "reject_proposal", navigateTo: "crypto", reply: "Reddedilecek bekleyen Binance taslağı yok." };
      const rejected = this.binance.reject(proposal.id);
      return { matched: true, intent: "reject_proposal", navigateTo: "crypto", reply: `${rejected.symbol} ${rejected.side} taslağı reddedildi. Gerçek emir gönderilmedi.`, data: { proposal: rejected } };
    }

    if (/\b(son emir|emir durumu|taslak durumu|gerceklesti mi)/i.test(lower)) {
      const proposal = this.binance.latestProposal();
      return { matched: true, intent: "proposal_status", navigateTo: "crypto", reply: proposal ? `Son Binance taslağı ${proposal.symbol} ${proposal.side}. Yerel durum ${proposal.state}, Binance durumu ${proposal.exchangeStatus || "henüz yok"}.` : "Binance emir taslağı bulunamadı.", data: { proposal } };
    }

    if (/\b(haber ver|bildir|alarm|ulasirsa|gelirse)/i.test(lower)) {
      return { matched: true, intent: "unsupported_alert", navigateTo: "crypto", reply: "Fiyat ve olay alarmı henüz kalıcı görev olarak bağlı değil. Sahte bir alarm oluşturmayacağım; isterseniz mevcut fiyatı veya Jev kararını şimdi kontrol edebilirim." };
    }

    if (/\b(hold|bekle|islem yapma)/i.test(lower)) {
      return { matched: true, intent: "hold", navigateTo: "crypto", reply: "HOLD kaydedildi. Gerçek emir oluşturulmadı." };
    }

    if (buyWords.test(lower) || sellWords.test(lower) || /\b(taslak|isleme basla)/i.test(lower)) {
      const side = sellWords.test(lower) ? "SELL" : buyWords.test(lower) ? "BUY" : undefined;
      const coin = selected[0];
      if (!side || !coin) return { matched: true, intent: "ambiguous_trade", navigateTo: "crypto", reply: "Emir taslağı için coin ve yönü açık söyleyin. Örnek: Bitcoin için 100 USDT'lik alım taslağı hazırla." };
      const amounts = amountParts(text, coin.symbol);
      const current = (await this.binance.markets()).find((row) => row.symbol === coin.symbol);
      const useCurrent = /guncel|simdiki|mevcut fiyat/i.test(lower);
      const price = amounts.price ?? (useCurrent ? Number(current?.price) : undefined);
      if (!price) return { matched: true, intent: "ambiguous_trade", navigateTo: "crypto", reply: `${coin.name} ${side === "BUY" ? "alım" : "satış"} taslağı için limit fiyatı da söyleyin veya güncel fiyatı kullan de.` };
      const quantity = amounts.quantity ?? (amounts.quoteAmount ? amounts.quoteAmount / price : undefined);
      if (!quantity) return { matched: true, intent: "ambiguous_trade", navigateTo: "crypto", reply: `${coin.name} taslağı için coin miktarı veya USDT tutarı eksik. Miktarı açıkça söyleyin.` };
      const proposal = await this.binance.createProposal({ symbol: coin.symbol, side, type: "LIMIT", price: String(price), quantity: quantity.toFixed(12), source: "manual", rationale: `Voice Room: ${text}` });
      return { matched: true, intent: "create_proposal", navigateTo: "crypto", requiresVisualApproval: true, reply: `${coin.name} için ${side === "BUY" ? "alım" : "satış"} taslağı hazırlandı. ${proposal.quantity} adet, limit fiyat ${proposal.price} USDT, yaklaşık toplam ${proposal.notional} USDT. Gerçek emir gönderilmedi. Crypto ekranında ${proposal.approvalPhrase} koduyla açık onay gerekir.`, data: { proposal } };
    }

    return { matched: true, intent: "help", navigateTo: "crypto", reply: "Crypto komutunu anladım ancak yapılacak işlemi netleştiremedim. Bağlantı, bakiye, fiyat, top 10, Jev analizi, işlem geçmişi veya emir taslağı şeklinde söyleyebilirsiniz." };
  }
}

export const cryptoVoiceCommandService = new CryptoVoiceCommandService();

export function safeCryptoVoiceError(error: unknown): string {
  if (error instanceof BinanceSpotError) return error.message;
  if (error instanceof Error && error.name === "AbortError") return "Crypto servisi zaman aşımına uğradı.";
  return "Crypto komutu güvenli biçimde tamamlanamadı. Durumu ekrandan kontrol edin.";
}
