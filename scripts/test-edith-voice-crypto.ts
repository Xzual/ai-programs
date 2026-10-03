import assert from "node:assert/strict";
import { BinanceSpotService, DEFAULT_BINANCE_SPOT_WATCHLIST } from "../server/crypto/binanceSpotService";
import { CRYPTO_VOICE_COMMAND_EXAMPLES, CryptoVoiceCommandService, isCryptoVoiceCommand } from "../server/voice/cryptoVoiceCommands";

const original = { ...process.env };
process.env.BINANCE_API_KEY = "voice-test-key-never-return";
process.env.BINANCE_API_SECRET = "voice-test-secret-never-return";
process.env.BINANCE_SPOT_ENABLED = "true";
process.env.BINANCE_SPOT_LIVE_ENABLED = "true";
process.env.BINANCE_SPOT_BASE_URL = "https://api.binance.com";
delete process.env.BINANCE_SPOT_ALLOWED_SYMBOLS;

const calls: Array<{ method: string; url: URL }> = [];
const prices = DEFAULT_BINANCE_SPOT_WATCHLIST.map((symbol, index) => ({ symbol, price: String([82500, 3600, 980, 2.1, 220, 0.32, 64, 42, 0.25, 0.84][index]) }));
const tickers = DEFAULT_BINANCE_SPOT_WATCHLIST.map((symbol, index) => ({ symbol, priceChangePercent: String(index - 4), quoteVolume: String(1_000_000 - index) }));

const mockFetch = async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const method = (init?.method || "GET").toUpperCase();
  calls.push({ method, url });
  if (url.pathname === "/api/v3/ticker/price") return new Response(JSON.stringify(prices), { status: 200 });
  if (url.pathname === "/api/v3/ticker/24hr") return new Response(JSON.stringify(tickers), { status: 200 });
  if (url.pathname === "/api/v3/exchangeInfo") return new Response(JSON.stringify({ symbols: [{
    symbol: url.searchParams.get("symbol"), status: "TRADING", isSpotTradingAllowed: true,
    filters: [
      { filterType: "PRICE_FILTER", tickSize: "0.01" },
      { filterType: "LOT_SIZE", stepSize: "0.000001", minQty: "0.000001", maxQty: "1000000" },
      { filterType: "MIN_NOTIONAL", minNotional: "5" },
    ],
  }] }), { status: 200 });
  if (url.pathname === "/api/v3/time") return new Response(JSON.stringify({ serverTime: Date.now() }), { status: 200 });
  if (url.pathname === "/api/v3/account") return new Response(JSON.stringify({
    canTrade: true, accountType: "SPOT", permissions: ["SPOT"],
    balances: [{ asset: "USDT", free: "500", locked: "0" }, { asset: "BTC", free: "0.01", locked: "0" }],
  }), { status: 200 });
  if (url.pathname === "/api/v3/openOrders") return new Response(JSON.stringify([{ symbol: "BTCUSDT", side: "BUY", origQty: "0.001", price: "80000" }]), { status: 200 });
  if (url.pathname === "/api/v3/order") return new Response(JSON.stringify({ orderId: 999, status: "NEW" }), { status: 200 });
  return new Response("{}", { status: 404 });
};

try {
  const binance = new BinanceSpotService(mockFetch as typeof fetch);
  const voice = new CryptoVoiceCommandService(binance);

  assert.equal(isCryptoVoiceCommand("yarın hava nasıl"), false);
  assert.equal((await voice.execute("yarın hava nasıl")).matched, false);
  assert.ok(CRYPTO_VOICE_COMMAND_EXAMPLES.length >= 20);

  const help = await voice.execute("crypto komutları neler");
  assert.equal(help.intent, "help");
  assert.match(help.reply, /gerçek emir sesle onaylanmaz/i);

  const status = await voice.execute("Binance bağlantısı çalışıyor mu?");
  assert.equal(status.intent, "connection_status");
  assert.equal(status.reply.includes("voice-test-key"), false);
  assert.equal(status.reply.includes("voice-test-secret"), false);

  const market = await voice.execute("Top 10 coinleri sırala");
  assert.equal(market.intent, "market_summary");
  assert.match(market.reply, /BTC/);
  assert.match(market.reply, /ADA/);

  const price = await voice.execute("Bitcoin şu anda kaç dolar?");
  assert.equal(price.intent, "price");
  assert.match(price.reply, /82\.500/);

  const compare = await voice.execute("BTC, ETH ve BNB'yi karşılaştır");
  assert.equal(compare.intent, "compare");
  assert.match(compare.reply, /ETH/);

  const balance = await voice.execute("Binance bakiyelerimi ve hangi coinlerden olduğunu söyle");
  assert.equal(balance.intent, "balances");
  assert.match(balance.reply, /USDT/);

  const openOrders = await voice.execute("Binance açık emirleri söyle");
  assert.equal(openOrders.intent, "open_orders");
  assert.match(openOrders.reply, /1 açık emir/);

  const incomplete = await voice.execute("Bitcoin alım taslağı hazırla");
  assert.equal(incomplete.intent, "ambiguous_trade");
  assert.equal(binance.latestProposal(), undefined);

  const proposal = await voice.execute("100 USDT'lik Bitcoin alım taslağı hazırla, güncel fiyatı kullan");
  assert.equal(proposal.intent, "create_proposal");
  assert.equal(proposal.requiresVisualApproval, true);
  assert.match(proposal.reply, /Gerçek emir gönderilmedi/i);
  assert.equal(binance.latestProposal()?.state, "AWAITING_APPROVAL");
  assert.equal(calls.some((call) => call.method === "POST" && call.url.pathname === "/api/v3/order"), false, "voice must never submit a Binance order");

  const attemptedVoiceApproval = await voice.execute(`Binance ${binance.latestProposal()?.approvalPhrase}`);
  assert.notEqual(attemptedVoiceApproval.intent, "create_proposal");
  assert.equal(calls.some((call) => call.method === "POST" && call.url.pathname === "/api/v3/order"), false, "spoken approval must never submit");

  const shown = await voice.execute("Binance taslağı ekranda göster");
  assert.equal(shown.intent, "show_proposal");
  assert.equal(shown.requiresVisualApproval, true);

  const rejected = await voice.execute("Binance taslağı reddet");
  assert.equal(rejected.intent, "reject_proposal");
  assert.equal(binance.latestProposal()?.state, "REJECTED");

  const explicitLimit = await voice.execute("0,01 BTC için 82500 limit satış taslağı hazırla");
  assert.equal(explicitLimit.intent, "create_proposal");
  assert.equal(binance.latestProposal()?.side, "SELL");
  assert.equal(binance.latestProposal()?.price, "82500");
  assert.equal(binance.latestProposal()?.quantity, "0.01");
  assert.equal(calls.some((call) => call.method === "POST" && call.url.pathname === "/api/v3/order"), false);

  const killOn = await voice.execute("Crypto kill switch'i aç");
  assert.equal(killOn.intent, "kill_switch_on");
  assert.equal(binance.status().killSwitch, true);
  const killOff = await voice.execute("Crypto kill switch'i kapat");
  assert.equal(killOff.intent, "kill_switch_off_denied");
  assert.equal(binance.status().killSwitch, true);

  const alert = await voice.execute("Bitcoin 90000 olursa haber ver");
  assert.equal(alert.intent, "unsupported_alert");
  assert.match(alert.reply, /henüz kalıcı görev olarak bağlı değil/i);

  console.log(JSON.stringify({
    success: true,
    scenarios: [
      "crypto_intent_detection", "command_catalog", "secret_free_connection_status", "top_10_market_summary",
      "coin_price_and_compare", "signed_balance_and_open_orders", "incomplete_trade_fails_closed",
      "voice_creates_proposal_without_submission", "spoken_approval_cannot_submit", "proposal_show_reject_and_explicit_limit",
      "voice_kill_switch_enable_only", "unsupported_alert_is_honest",
    ],
    binanceOrderPosts: calls.filter((call) => call.method === "POST" && call.url.pathname === "/api/v3/order").length,
  }, null, 2));
} finally {
  process.env = original;
}
