import assert from "node:assert/strict";
import path from "node:path";
import { BinanceSpotService, DEFAULT_BINANCE_SPOT_WATCHLIST } from "../server/crypto/binanceSpotService";
import { CRYPTO_VOICE_COMMAND_EXAMPLES, CryptoVoiceCommandService, isCryptoVoiceCommand } from "../server/voice/cryptoVoiceCommands";

assert.equal(process.env.EDITH_TEST_MODE, "true", "voice crypto tests require isolated workspace");
const original = { ...process.env };
const originalFetch = globalThis.fetch;
process.env.EDITH_CRYPTO_RUNTIME_DATA_DIR = path.join(process.env.EDITH_TEST_DATA_DIR!, "crypto");
process.env.BINANCE_API_KEY = "voice-fixture-key-canary";
process.env.BINANCE_API_SECRET = "voice-fixture-secret-canary";
process.env.BINANCE_SPOT_ENABLED = "true";
process.env.BINANCE_SPOT_LIVE_ENABLED = "true";
process.env.EDITH_CRYPTO_SERVICE_URL = "http://127.0.0.1:13337";
delete process.env.BINANCE_SPOT_ALLOWED_SYMBOLS;
const calls: Array<{ method: string; url: URL }> = [];
const prices = DEFAULT_BINANCE_SPOT_WATCHLIST.map((symbol, index) => ({ symbol, price: String([82500, 3600, 980, 2.1, 220, 0.32, 64, 42, 0.25, 0.84][index]) }));
const tickers = DEFAULT_BINANCE_SPOT_WATCHLIST.map((symbol, index) => ({ symbol, priceChangePercent: String(index - 4), quoteVolume: "1000000" }));
const mockFetch = async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(String(input));
  const method = (init?.method || "GET").toUpperCase();
  calls.push({ method, url });
  assert.equal(method, "GET");
  assert.equal(new Headers(init?.headers).has("X-MBX-APIKEY"), false);
  assert.equal(url.searchParams.has("signature"), false);
  if (url.pathname === "/api/v3/ticker/price") return new Response(JSON.stringify(prices));
  if (url.pathname === "/api/v3/ticker/24hr") return new Response(JSON.stringify(tickers));
  throw Error("Private/nonpublic provider request forbidden");
};
let privateMethodAttempts = 0;
try {
  const binance = new BinanceSpotService(mockFetch as typeof fetch);
  for (const name of ["account", "openOrders", "createProposal", "approve", "latestProposal", "getProposal", "reject"]) {
    (binance as any)[name] = () => { privateMethodAttempts += 1; throw Error("Removed private feature must not be queried by voice"); };
  }
  const voice = new CryptoVoiceCommandService(binance);
  assert.equal(isCryptoVoiceCommand("yarın hava nasıl"), false);
  assert.equal((await voice.execute("yarın hava nasıl")).matched, false);
  assert.ok(CRYPTO_VOICE_COMMAND_EXAMPLES.length >= 20);
  const help = await voice.execute("crypto komutları neler");
  assert.equal(help.intent, "help");
  assert.match(help.reply, /DEMO_ONLY.*kalıcı kapalı/);
  assert.doesNotMatch(help.reply, /tek kullanımlık kod gerekir/);
  const status = await voice.execute("Binance bağlantısı çalışıyor mu?");
  assert.equal(status.intent, "connection_status");
  assert.match(status.reply, /DEMO_ONLY.*kalıcı kapalı/);
  assert.equal((status.data?.status as ReturnType<BinanceSpotService['status']>).liveEnabled, false);
  const privateCases: Array<[string, string]> = [
    ["Binance bakiyelerimi ve hangi coinlerden olduğunu söyle", "balances"],
    ["Binance bakiyemi söyle", "account_summary"],
    ["Hangi coinlerden var?", "balances"],
    ["Binance açık emirleri söyle", "open_orders"],
    ["Bitcoin alım taslağı hazırla", "create_proposal"],
    ["100 USDT'lik Bitcoin alım taslağı hazırla, güncel fiyatı kullan", "create_proposal"],
    ["0,01 BTC için 82500 limit satış taslağı hazırla", "create_proposal"],
    ["Binance ONAYLA ABCDEF", "proposal_status"],
    ["Binance emri onayla ve gönder", "proposal_status"],
    ["Binance taslağı ekranda göster", "show_proposal"],
    ["Binance taslağı reddet", "reject_proposal"],
    ["Son Binance emir ne durumda?", "proposal_status"],
  ];
  for (const [text, intent] of privateCases) {
    const result = await voice.execute(text);
    assert.equal(result.matched, true, text);
    assert.equal(result.intent, intent, text);
    assert.equal(result.requiresVisualApproval, false, text);
    assert.equal(result.data?.mode, "DEMO_ONLY");
    assert.equal(result.data?.status, "disabled");
    assert.equal(result.data?.privateRequestsEnabled, false);
    assert.equal(result.data?.realOrderSent, false);
    assert.match(result.reply, /kalıcı olarak kapalı/);
    assert.doesNotMatch(result.reply, /hesabında açık emir yok|Kullanılabilir USDT 0|taslağı hazırlandı|koduyla açık onay gerekir/);
    assert.equal(JSON.stringify(result).includes("voice-fixture-key-canary"), false);
    assert.equal(JSON.stringify(result).includes("voice-fixture-secret-canary"), false);
  }
  assert.equal(privateMethodAttempts, 0);
  assert.equal(calls.length, 0, "disabled voice account/proposal commands must not even fetch public prices as a side effect");
  const market = await voice.execute("Top 10 coinleri sırala");
  assert.equal(market.intent, "market_summary");
  assert.match(market.reply, /BTC/); assert.match(market.reply, /ADA/);
  const price = await voice.execute("Bitcoin şu anda kaç dolar?");
  assert.equal(price.intent, "price"); assert.match(price.reply, /82\.500/);
  const compare = await voice.execute("BTC, ETH ve BNB'yi karşılaştır");
  assert.equal(compare.intent, "compare"); assert.match(compare.reply, /ETH/);
  const movers = await voice.execute("Binance en çok yükselen üç coini söyle");
  assert.equal(movers.intent, "movers"); assert.equal((movers.data?.markets as any[]).length, 3);
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    assert.equal(url.hostname, "127.0.0.1");
    if (url.pathname === "/api/crypto/portfolio") return new Response(JSON.stringify({ portfolio: { currentEquity: 10000, currentCash: 10000, unrealizedPnl: 0 } }));
    if (url.pathname === "/api/crypto/trades") return new Response(JSON.stringify({ trades: [] }));
    throw Error("Unexpected demo dashboard fixture request");
  }) as typeof fetch;
  const portfolio = await voice.execute("Demo portföyümü özetle");
  assert.equal(portfolio.intent, "portfolio"); assert.match(portfolio.reply, /10\.000.*kredi/);
  const history = await voice.execute("Bugün Binance'da neler yaptın?");
  assert.equal(history.intent, "trade_history"); assert.match(history.reply, /Demo işlem geçmişinde kayıt yok/);
  assert.equal(privateMethodAttempts, 0);
  const killOn = await voice.execute("Crypto kill switch'i aç");
  assert.equal(killOn.intent, "kill_switch_on"); assert.equal(binance.status().killSwitch, true);
  const killOff = await voice.execute("Crypto kill switch'i kapat");
  assert.equal(killOff.intent, "kill_switch_off_denied"); assert.equal(binance.status().killSwitch, true);
  const held = await voice.execute("Crypto HOLD bekle");
  assert.equal(held.intent, "hold"); assert.doesNotMatch(held.reply, /kaydedildi/);
  const alert = await voice.execute("Bitcoin 90000 olursa haber ver");
  assert.equal(alert.intent, "unsupported_alert"); assert.match(alert.reply, /henüz kalıcı görev olarak bağlı değil/);
  assert.ok(calls.length > 0);
  assert.equal(calls.filter(call => call.method !== "GET" || /account|order|exchangeInfo/.test(call.url.pathname)).length, 0);
  console.log(JSON.stringify({ success: true, privateDisabledTruthScenarios: privateCases.length, privateMethodAttempts, binanceOrderPosts: 0, envFlagsCannotEnablePrivateVoice: true, canaryAbsent: true, publicPricesMarketsCompareMoversPreserved: true, demoPortfolioHistoryPreserved: true, voiceKillEnableOnly: true }));
} finally { process.env = original; globalThis.fetch = originalFetch; }
