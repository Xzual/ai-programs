import assert from "node:assert/strict";
import { BinanceSpotError, BinanceSpotService, DEFAULT_BINANCE_SPOT_WATCHLIST } from "../server/crypto/binanceSpotService";

const original = { ...process.env };
process.env.BINANCE_API_KEY = "test-key-never-return";
process.env.BINANCE_API_SECRET = "test-secret-never-return";
process.env.BINANCE_SPOT_ENABLED = "true";
process.env.BINANCE_SPOT_LIVE_ENABLED = "true";
process.env.BINANCE_SPOT_BASE_URL = "https://api.binance.com";
delete process.env.BINANCE_SPOT_ALLOWED_SYMBOLS;

const calls: Array<{ method: string; url: URL }> = [];
const mockFetch = async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const method = (init?.method || "GET").toUpperCase();
  calls.push({ method, url });
  if (url.pathname === "/api/v3/exchangeInfo") return new Response(JSON.stringify({ symbols: [{
    symbol: url.searchParams.get("symbol"), status: "TRADING", isSpotTradingAllowed: true,
    filters: [
      { filterType: "PRICE_FILTER", tickSize: "0.01" },
      { filterType: "LOT_SIZE", stepSize: "0.001", minQty: "0.001", maxQty: "1000" },
      { filterType: "MIN_NOTIONAL", minNotional: "5" },
    ],
  }] }), { status: 200 });
  if (url.pathname === "/api/v3/time") return new Response(JSON.stringify({ serverTime: Date.now() }), { status: 200 });
  if (url.pathname === "/api/v3/order" && method === "POST") return new Response(JSON.stringify({ orderId: 42, status: "NEW" }), { status: 200 });
  if (url.pathname === "/api/v3/account") return new Response(JSON.stringify({ canTrade: true, accountType: "SPOT", permissions: ["SPOT"], balances: [] }), { status: 200 });
  return new Response(JSON.stringify({ code: -1 }), { status: 404 });
};

try {
  const service = new BinanceSpotService(mockFetch as typeof fetch);
  assert.deepEqual(service.watchlist(), [...DEFAULT_BINANCE_SPOT_WATCHLIST]);
  assert.equal(JSON.stringify(service.status()).includes("test-key-never-return"), false);
  assert.equal(JSON.stringify(service.status()).includes("test-secret-never-return"), false);
  assert.equal(service.status().withdrawalsEnabled, false);
  assert.equal(service.status().futuresEnabled, false);
  assert.equal(service.status().marginEnabled, false);

  await assert.rejects(() => service.createProposal({ symbol: "AVAXUSDT", side: "BUY", price: "100", quantity: "1" }), (error: any) => error instanceof BinanceSpotError && error.code === "symbol_not_allowed");
  await assert.rejects(() => service.createProposal({ symbol: "BTCUSDT", side: "BUY", type: "MARKET", price: "100", quantity: "1" }), (error: any) => error.code === "order_type_not_allowed");

  const proposal = await service.createProposal({ symbol: "BTCUSDT", side: "BUY", type: "LIMIT", price: "100.129", quantity: "0.1234", source: "jev" });
  assert.equal(proposal.price, "100.12");
  assert.equal(proposal.quantity, "0.123");
  assert.equal(proposal.state, "AWAITING_APPROVAL");
  assert.equal(calls.some((call) => call.method === "POST" && call.url.pathname === "/api/v3/order"), false, "proposal must not submit an order");
  await assert.rejects(() => service.approve(proposal.id, "wrong"), (error: any) => error.code === "approval_phrase_invalid");
  const submitted = await service.approve(proposal.id, proposal.approvalPhrase);
  assert.equal(submitted.state, "SUBMITTED");
  assert.equal(submitted.exchangeOrderId, "42");
  await assert.rejects(() => service.approve(proposal.id, proposal.approvalPhrase), (error: any) => error.code === "proposal_already_consumed");
  assert.equal(calls.filter((call) => call.method === "POST" && call.url.pathname === "/api/v3/order").length, 1, "duplicate approval must not resubmit");
  assert.equal(calls.some((call) => call.url.pathname.includes("withdraw")), false);
  assert.equal(calls.some((call) => call.url.pathname.includes("fapi") || call.url.pathname.includes("margin")), false);

  const blocked = await service.createProposal({ symbol: "ETHUSDT", side: "SELL", price: "2000", quantity: "0.01" });
  service.setKillSwitch(true);
  await assert.rejects(() => service.approve(blocked.id, blocked.approvalPhrase), (error: any) => error.code === "kill_switch_active");

  let postAttempts = 0;
  const recoveryFetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method || "GET").toUpperCase();
    if (url.pathname === "/api/v3/exchangeInfo") return mockFetch(input, init);
    if (url.pathname === "/api/v3/time") return mockFetch(input, init);
    if (url.pathname === "/api/v3/account") return new Response(JSON.stringify({ canTrade: true, accountType: "SPOT", permissions: ["SPOT"], balances: [] }), { status: 200 });
    if (url.pathname === "/api/v3/order" && method === "POST") { postAttempts += 1; return new Response(JSON.stringify({ code: -1007 }), { status: 504 }); }
    if (url.pathname === "/api/v3/order" && method === "GET") return new Response(JSON.stringify({ orderId: 77, status: "NEW" }), { status: 200 });
    return new Response("{}", { status: 404 });
  };
  const recovery = new BinanceSpotService(recoveryFetch as typeof fetch);
  const uncertain = await recovery.createProposal({ symbol: "ETHUSDT", side: "BUY", price: "2000", quantity: "0.01" });
  const recovered = await recovery.approve(uncertain.id, uncertain.approvalPhrase);
  assert.equal(recovered.state, "SUBMITTED");
  assert.equal(recovered.exchangeOrderId, "77");
  assert.equal(postAttempts, 1, "unknown execution must be queried, never blindly retried");

  console.log("PASS Binance Global Spot approval boundary, filters, idempotency, recovery, and secret isolation");
} finally {
  process.env = original;
}
