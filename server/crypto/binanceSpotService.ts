import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { killSwitchService } from "../../src/edith/killSwitch";
import { workspaceManager } from "../../src/edith/workspaceManager";

export const DEFAULT_BINANCE_SPOT_WATCHLIST = [
  "BTCUSDT", "ETHUSDT", "BNBUSDT", "XRPUSDT", "SOLUSDT",
  "TRXUSDT", "ZECUSDT", "HYPEUSDT", "DOGEUSDT", "ADAUSDT",
] as const;

// Compatibility type only. This module has no proposal execution or private transport.
export interface BinanceSpotProposal {
  id: string; symbol: string; side: "BUY" | "SELL"; type: "LIMIT"; timeInForce: "GTC";
  quantity: string; price: string; notional: string; source: "jev" | "manual";
  rationale?: string; state: "AWAITING_APPROVAL" | "REJECTED" | "SUBMITTED" | "UNKNOWN";
  approvalPhrase: string; createdAt: string; expiresAt: string; consumedAt?: string;
  clientOrderId: string; exchangeOrderId?: string; exchangeStatus?: string;
}

export class BinanceSpotError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}

export class BinanceSpotService {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  private localKillPath(): string {
    const runtimeRoot = process.env.EDITH_CRYPTO_RUNTIME_DATA_DIR
      || path.join(workspaceManager.getPersistenceDataDir(), "crypto");
    return path.join(runtimeRoot, "kill-switch.json");
  }

  private localKillActive(): boolean {
    const file = this.localKillPath();
    try {
      if (!fs.existsSync(file)) return false;
      const state = JSON.parse(fs.readFileSync(file, "utf8"));
      return typeof state?.active === "boolean" ? state.active : true;
    } catch { return true; }
  }

  executionBlocked(): boolean {
    try { return this.localKillActive() || killSwitchService.status().active; }
    catch { return true; }
  }

  private baseUrl(): string {
    const parsed = new URL((process.env.BINANCE_SPOT_BASE_URL || "https://api.binance.com").trim());
    if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && ["127.0.0.1", "localhost"].includes(parsed.hostname))) {
      throw new BinanceSpotError("unsafe_binance_endpoint", "Binance public endpoint must use HTTPS.", 503);
    }
    if (parsed.username || parsed.password) throw new BinanceSpotError("unsafe_binance_endpoint", "Endpoint credentials are not allowed.", 503);
    return parsed.origin;
  }

  watchlist(): string[] {
    const configured = (process.env.BINANCE_SPOT_ALLOWED_SYMBOLS || "").split(",").map(value => value.trim().toUpperCase()).filter(Boolean);
    return [...new Set((configured.length ? configured : [...DEFAULT_BINANCE_SPOT_WATCHLIST]).filter(symbol => /^[A-Z0-9]{5,20}$/.test(symbol)))].slice(0, 20);
  }

  status() {
    return {
      exchange: "BINANCE_GLOBAL", product: "SPOT", mode: "DEMO_ONLY", status: "disabled",
      configured: false, enabled: false, liveEnabled: false, realOrderSent: false,
      privateRequestsEnabled: false, realOrderEndpointsAvailable: false,
      killSwitch: this.executionBlocked(), localKillSwitch: this.localKillActive(),
      requiresExplicitApproval: false, orderTypes: [], withdrawalsEnabled: false,
      futuresEnabled: false, marginEnabled: false, credentialsLocation: "backend_only",
      safeMessage: "Private Binance access is disabled. Use the 10,000 CR demo ledger.", watchlist: this.watchlist(),
    };
  }

  async markets() {
    const symbols = this.watchlist();
    const query = encodeURIComponent(JSON.stringify(symbols));
    const read = async (endpoint: string) => {
      const response = await this.fetchImpl(`${this.baseUrl()}${endpoint}?symbols=${query}`, {
        method: "GET", headers: { Accept: "application/json" }, redirect: "error",
      });
      if (!response.ok) throw new BinanceSpotError("binance_unavailable", "Binance public market data is unavailable.", 503);
      return JSON.parse(await response.text());
    };
    const [prices, tickers] = await Promise.all([read("/api/v3/ticker/price"), read("/api/v3/ticker/24hr")]);
    const tickerMap = new Map((Array.isArray(tickers) ? tickers : []).map((row: any) => [row.symbol, row]));
    return symbols.map((symbol, index) => {
      const priceRow = (Array.isArray(prices) ? prices : []).find((row: any) => row.symbol === symbol);
      const ticker: any = tickerMap.get(symbol) || {};
      return { rank: index + 1, symbol, price: priceRow?.price ?? null, change24h: ticker.priceChangePercent ?? null, quoteVolume24h: ticker.quoteVolume ?? null };
    });
  }

  async account() {
    return { mode: "DEMO_ONLY", status: "disabled", canTrade: false, accountType: "DEMO",
      permissions: [], balances: [], privateRequestsEnabled: false, realOrderSent: false };
  }

  async openOrders(_symbol?: string) { return []; }

  private disabled(): never {
    throw new BinanceSpotError("demo_only", "Private Binance access and real orders are permanently disabled. Use the demo ledger.", 423);
  }

  async createProposal(_input: Record<string, unknown>): Promise<BinanceSpotProposal> { return this.disabled(); }
  getProposal(_id: string): BinanceSpotProposal { return this.disabled(); }
  latestProposal(): BinanceSpotProposal | undefined { return undefined; }
  reject(_id: string): BinanceSpotProposal { return this.disabled(); }
  async approve(_id: string, _phrase: string): Promise<BinanceSpotProposal> { return this.disabled(); }

  setKillSwitch(active: boolean) {
    const file = this.localKillPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temp, JSON.stringify({ active, updatedAt: new Date().toISOString() }), { mode: 0o600 });
      fs.renameSync(temp, file);
    } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
    return this.status();
  }
}

export const binanceSpotService = new BinanceSpotService();
