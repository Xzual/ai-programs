import crypto from "node:crypto";

export const DEFAULT_BINANCE_SPOT_WATCHLIST = [
  "BTCUSDT", "ETHUSDT", "BNBUSDT", "XRPUSDT", "SOLUSDT",
  "TRXUSDT", "ZECUSDT", "HYPEUSDT", "DOGEUSDT", "ADAUSDT",
] as const;

type Side = "BUY" | "SELL";
type ProposalState = "AWAITING_APPROVAL" | "REJECTED" | "SUBMITTED" | "UNKNOWN";

export interface BinanceSpotProposal {
  id: string;
  symbol: string;
  side: Side;
  type: "LIMIT";
  timeInForce: "GTC";
  quantity: string;
  price: string;
  notional: string;
  source: "jev" | "manual";
  rationale?: string;
  state: ProposalState;
  approvalPhrase: string;
  createdAt: string;
  expiresAt: string;
  consumedAt?: string;
  clientOrderId: string;
  exchangeOrderId?: string;
  exchangeStatus?: string;
}

interface BinanceFilter {
  filterType: string;
  tickSize?: string;
  stepSize?: string;
  minQty?: string;
  maxQty?: string;
  minNotional?: string;
  maxNotional?: string;
}

interface BinanceSymbolInfo {
  symbol: string;
  status: string;
  isSpotTradingAllowed?: boolean;
  filters?: BinanceFilter[];
}

export class BinanceSpotError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
  }
}

const truthy = (value: string | undefined) => value?.trim().toLowerCase() === "true";
const decimalPattern = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

function decimalPlaces(value: string): number {
  return value.includes(".") ? value.replace(/0+$/, "").split(".")[1]?.length ?? 0 : 0;
}

function floorToIncrement(value: string, increment: string): string {
  if (!decimalPattern.test(value) || !decimalPattern.test(increment) || Number(increment) <= 0) {
    throw new BinanceSpotError("invalid_order", "Price and quantity must be positive decimals.");
  }
  const scale = Math.max(decimalPlaces(value), decimalPlaces(increment));
  const factor = 10n ** BigInt(scale);
  const integer = (input: string) => {
    const [whole, fraction = ""] = input.split(".");
    return BigInt(whole) * factor + BigInt((fraction + "0".repeat(scale)).slice(0, scale));
  };
  const step = integer(increment);
  const normalized = (integer(value) / step) * step;
  const whole = normalized / factor;
  const fraction = (normalized % factor).toString().padStart(scale, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function safeJson(text: string): Record<string, any> {
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}

function safeJsonValue(text: string): any {
  try { return JSON.parse(text); } catch { return {}; }
}

export class BinanceSpotService {
  private readonly proposals = new Map<string, BinanceSpotProposal>();
  private killSwitch = false;
  private serverOffsetMs = 0;

  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  private baseUrl(): string {
    const configured = (process.env.BINANCE_SPOT_BASE_URL || "https://api.binance.com").trim();
    const parsed = new URL(configured);
    if (parsed.protocol !== "https:" && !(parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost")) {
      throw new BinanceSpotError("unsafe_binance_endpoint", "Binance endpoint must use HTTPS.", 503);
    }
    return parsed.origin;
  }

  watchlist(): string[] {
    const configured = (process.env.BINANCE_SPOT_ALLOWED_SYMBOLS || "")
      .split(",").map((value) => value.trim().toUpperCase()).filter(Boolean);
    const list = configured.length ? configured : [...DEFAULT_BINANCE_SPOT_WATCHLIST];
    return [...new Set(list.filter((symbol) => /^[A-Z0-9]{5,20}$/.test(symbol)))].slice(0, 20);
  }

  status() {
    const apiKey = Boolean(process.env.BINANCE_API_KEY?.trim());
    const secret = Boolean(process.env.BINANCE_API_SECRET?.trim());
    const enabled = truthy(process.env.BINANCE_SPOT_ENABLED);
    const liveEnabled = enabled && truthy(process.env.BINANCE_SPOT_LIVE_ENABLED);
    return {
      exchange: "BINANCE_GLOBAL",
      product: "SPOT",
      configured: apiKey && secret,
      enabled,
      liveEnabled,
      killSwitch: this.killSwitch,
      requiresExplicitApproval: true,
      orderTypes: ["LIMIT"],
      withdrawalsEnabled: false,
      futuresEnabled: false,
      marginEnabled: false,
      credentialsLocation: "backend_only",
      watchlist: this.watchlist(),
    };
  }

  private credentials() {
    const apiKey = process.env.BINANCE_API_KEY?.trim();
    const secret = process.env.BINANCE_API_SECRET?.trim();
    if (!apiKey || !secret) throw new BinanceSpotError("binance_configuration_required", "Binance API credentials are not configured.", 503);
    return { apiKey, secret };
  }

  private async publicRequest(path: string): Promise<Record<string, any>> {
    const response = await this.fetchImpl(`${this.baseUrl()}${path}`, { headers: { Accept: "application/json" } });
    const body = safeJson(await response.text());
    if (!response.ok) throw new BinanceSpotError("binance_unavailable", "Binance market data is unavailable.", 503);
    return body;
  }

  private async syncTime(): Promise<void> {
    const body = await this.publicRequest("/api/v3/time");
    if (!Number.isFinite(Number(body.serverTime))) throw new BinanceSpotError("binance_time_unavailable", "Binance server time could not be verified.", 503);
    this.serverOffsetMs = Number(body.serverTime) - Date.now();
  }

  private async signedRequest(method: "GET" | "POST", path: string, params: URLSearchParams): Promise<any> {
    const { apiKey, secret } = this.credentials();
    if (!this.serverOffsetMs) await this.syncTime();
    params.set("timestamp", String(Date.now() + this.serverOffsetMs));
    params.set("recvWindow", "5000");
    const signature = crypto.createHmac("sha256", secret).update(params.toString()).digest("hex");
    params.set("signature", signature);
    const url = `${this.baseUrl()}${path}?${params.toString()}`;
    const response = await this.fetchImpl(url, { method, headers: { "X-MBX-APIKEY": apiKey, Accept: "application/json" } });
    const body = safeJsonValue(await response.text());
    if (!response.ok) {
      const exchangeCode = typeof body.code === "number" ? body.code : undefined;
      if (response.status >= 500) throw new BinanceSpotError("binance_execution_unknown", "Binance did not confirm the order result.", 502);
      throw new BinanceSpotError("binance_rejected", exchangeCode ? `Binance rejected the request (${exchangeCode}).` : "Binance rejected the request.", 400);
    }
    return body;
  }

  async markets() {
    const symbols = this.watchlist();
    const query = encodeURIComponent(JSON.stringify(symbols));
    const [prices, tickers] = await Promise.all([
      this.fetchImpl(`${this.baseUrl()}/api/v3/ticker/price?symbols=${query}`).then(async (r) => r.ok ? JSON.parse(await r.text()) : Promise.reject(new Error("PRICE"))),
      this.fetchImpl(`${this.baseUrl()}/api/v3/ticker/24hr?symbols=${query}`).then(async (r) => r.ok ? JSON.parse(await r.text()) : Promise.reject(new Error("TICKER"))),
    ]);
    const tickerMap = new Map((Array.isArray(tickers) ? tickers : []).map((row: any) => [row.symbol, row]));
    return symbols.map((symbol, index) => {
      const priceRow = (Array.isArray(prices) ? prices : []).find((row: any) => row.symbol === symbol);
      const ticker: any = tickerMap.get(symbol) || {};
      return { rank: index + 1, symbol, price: priceRow?.price ?? null, change24h: ticker.priceChangePercent ?? null, quoteVolume24h: ticker.quoteVolume ?? null };
    });
  }

  async account() {
    const body = await this.signedRequest("GET", "/api/v3/account", new URLSearchParams({ omitZeroBalances: "true" }));
    return {
      canTrade: body.canTrade === true,
      accountType: body.accountType || "SPOT",
      permissions: Array.isArray(body.permissions) ? body.permissions.filter((value: unknown) => value === "SPOT") : [],
      balances: Array.isArray(body.balances) ? body.balances.map((row: any) => ({ asset: row.asset, free: row.free, locked: row.locked })) : [],
      updatedAt: new Date().toISOString(),
    };
  }

  async openOrders(symbol?: string) {
    if (symbol && !this.watchlist().includes(symbol)) throw new BinanceSpotError("symbol_not_allowed", "Symbol is outside the approved Spot watchlist.");
    const params = new URLSearchParams();
    if (symbol) params.set("symbol", symbol);
    const body = await this.signedRequest("GET", "/api/v3/openOrders", params);
    return Array.isArray(body) ? body : [];
  }

  private async symbolInfo(symbol: string): Promise<BinanceSymbolInfo> {
    const body = await this.publicRequest(`/api/v3/exchangeInfo?symbol=${encodeURIComponent(symbol)}`);
    const info = Array.isArray(body.symbols) ? body.symbols[0] : undefined;
    if (!info || info.status !== "TRADING" || info.isSpotTradingAllowed === false) {
      throw new BinanceSpotError("symbol_not_tradable", "Symbol is not currently available for Binance Spot trading.");
    }
    return info;
  }

  async createProposal(input: Record<string, unknown>): Promise<BinanceSpotProposal> {
    const symbol = String(input.symbol || "").toUpperCase();
    const side = String(input.side || "").toUpperCase() as Side;
    const source = input.source === "jev" ? "jev" : "manual";
    if (!this.watchlist().includes(symbol)) throw new BinanceSpotError("symbol_not_allowed", "Symbol is outside the approved Spot watchlist.");
    if (side !== "BUY" && side !== "SELL") throw new BinanceSpotError("invalid_order", "Side must be BUY or SELL.");
    if (input.type != null && input.type !== "LIMIT") throw new BinanceSpotError("order_type_not_allowed", "Only LIMIT Spot orders are supported.");
    const info = await this.symbolInfo(symbol);
    const lot = info.filters?.find((filter) => filter.filterType === "LOT_SIZE");
    const priceFilter = info.filters?.find((filter) => filter.filterType === "PRICE_FILTER");
    const notionalFilter = info.filters?.find((filter) => filter.filterType === "NOTIONAL") ?? info.filters?.find((filter) => filter.filterType === "MIN_NOTIONAL");
    const quantity = floorToIncrement(String(input.quantity || ""), lot?.stepSize || "0.00000001");
    const price = floorToIncrement(String(input.price || ""), priceFilter?.tickSize || "0.00000001");
    if (Number(quantity) <= 0 || Number(price) <= 0) throw new BinanceSpotError("invalid_order", "Normalized price and quantity must be positive.");
    if (lot?.minQty && Number(quantity) < Number(lot.minQty)) throw new BinanceSpotError("quantity_below_minimum", "Quantity is below the Binance minimum.");
    if (lot?.maxQty && Number(quantity) > Number(lot.maxQty)) throw new BinanceSpotError("quantity_above_maximum", "Quantity is above the Binance maximum.");
    const notional = (Number(quantity) * Number(price)).toFixed(8).replace(/0+$/, "").replace(/\.$/, "");
    if (notionalFilter?.minNotional && Number(notional) < Number(notionalFilter.minNotional)) throw new BinanceSpotError("notional_below_minimum", "Order value is below the Binance minimum notional.");
    if (notionalFilter?.maxNotional && Number(notional) > Number(notionalFilter.maxNotional)) throw new BinanceSpotError("notional_above_maximum", "Order value is above the Binance maximum notional.");
    const id = crypto.randomUUID();
    const now = Date.now();
    const proposal: BinanceSpotProposal = {
      id, symbol, side, type: "LIMIT", timeInForce: "GTC", quantity, price, notional, source,
      rationale: typeof input.rationale === "string" ? input.rationale.slice(0, 500) : undefined,
      state: "AWAITING_APPROVAL", approvalPhrase: `ONAYLA ${id.slice(-6).toUpperCase()}`,
      createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 5 * 60_000).toISOString(),
      clientOrderId: `edith_${id.replace(/-/g, "").slice(0, 26)}`,
    };
    this.proposals.set(id, proposal);
    return { ...proposal };
  }

  getProposal(id: string): BinanceSpotProposal {
    const proposal = this.proposals.get(id);
    if (!proposal) throw new BinanceSpotError("proposal_not_found", "Order proposal was not found.", 404);
    return proposal;
  }

  latestProposal(): BinanceSpotProposal | undefined {
    const values = [...this.proposals.values()];
    const proposal = values[values.length - 1];
    return proposal ? { ...proposal } : undefined;
  }

  reject(id: string): BinanceSpotProposal {
    const proposal = this.getProposal(id);
    if (proposal.state !== "AWAITING_APPROVAL") throw new BinanceSpotError("proposal_already_consumed", "Order proposal is no longer awaiting approval.", 409);
    proposal.state = "REJECTED";
    proposal.consumedAt = new Date().toISOString();
    return { ...proposal };
  }

  setKillSwitch(active: boolean) {
    this.killSwitch = active;
    return this.status();
  }

  async approve(id: string, phrase: string): Promise<BinanceSpotProposal> {
    const proposal = this.getProposal(id);
    if (this.killSwitch) throw new BinanceSpotError("kill_switch_active", "Binance Spot kill switch is active.", 423);
    if (!this.status().liveEnabled) throw new BinanceSpotError("live_trading_disabled", "Live Binance Spot trading is disabled in backend configuration.", 423);
    if (proposal.state !== "AWAITING_APPROVAL") throw new BinanceSpotError("proposal_already_consumed", "Order proposal is no longer awaiting approval.", 409);
    if (Date.parse(proposal.expiresAt) <= Date.now()) throw new BinanceSpotError("proposal_expired", "Order proposal approval window expired.", 410);
    if (phrase !== proposal.approvalPhrase) throw new BinanceSpotError("approval_phrase_invalid", "The exact one-time approval phrase is required.", 403);
    const account = await this.account();
    if (!account.canTrade || !account.permissions.includes("SPOT")) {
      throw new BinanceSpotError("spot_trade_permission_required", "The Binance account did not confirm Spot trading permission.", 403);
    }
    // Consume before network I/O so duplicate clicks cannot submit twice.
    proposal.state = "UNKNOWN";
    proposal.consumedAt = new Date().toISOString();
    const params = new URLSearchParams({
      symbol: proposal.symbol, side: proposal.side, type: proposal.type,
      timeInForce: proposal.timeInForce, quantity: proposal.quantity, price: proposal.price,
      newClientOrderId: proposal.clientOrderId, newOrderRespType: "RESULT",
    });
    try {
      const result = await this.signedRequest("POST", "/api/v3/order", params);
      proposal.state = "SUBMITTED";
      proposal.exchangeOrderId = result.orderId != null ? String(result.orderId) : undefined;
      proposal.exchangeStatus = result.status || "NEW";
    } catch (error) {
      if (!(error instanceof BinanceSpotError) || error.code !== "binance_execution_unknown") throw error;
      try {
        const found = await this.signedRequest("GET", "/api/v3/order", new URLSearchParams({ symbol: proposal.symbol, origClientOrderId: proposal.clientOrderId }));
        proposal.state = "SUBMITTED";
        proposal.exchangeOrderId = found.orderId != null ? String(found.orderId) : undefined;
        proposal.exchangeStatus = found.status || "UNKNOWN";
      } catch {
        proposal.state = "UNKNOWN";
        proposal.exchangeStatus = "UNKNOWN";
      }
    }
    return { ...proposal };
  }
}

export const binanceSpotService = new BinanceSpotService();
