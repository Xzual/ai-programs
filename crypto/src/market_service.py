"""Public-only Binance market snapshots for the demo exchange terminal."""
from collections import OrderedDict
from copy import deepcopy
from datetime import datetime, timezone
from threading import Lock
from time import monotonic
from typing import Any, Dict, Iterable

from config import CONFIG
from market_data import MarketDataFetcher
from price_freshness import number, price_status, utc_now


SUPPORTED_TIMEFRAMES = {"1m", "5m", "15m", "1h", "4h"}
CACHE_TTL_SECONDS = 5.0
MAX_CACHE_ENTRIES = 64


class MarketDataService:
    def __init__(self, fetcher: MarketDataFetcher = None):
        self.fetcher = fetcher or MarketDataFetcher()
        self._cache = OrderedDict()
        self._cache_lock = Lock()
        self._fetch_lock = Lock()
        configured_ttl = number(getattr(CONFIG, "MARKET_CACHE_SECONDS", CACHE_TTL_SECONDS))
        self._cache_seconds = (
            min(CACHE_TTL_SECONDS, max(0.0, configured_ttl))
            if configured_ttl is not None else CACHE_TTL_SECONDS
        )

    @staticmethod
    def normalize_symbol(symbol: str) -> str:
        value = str(symbol or "BTCUSDT").strip().upper().replace("-", "/")
        if "/" not in value and value.endswith("USDT"):
            value = f"{value[:-4]}/USDT"
        if value not in CONFIG.WATCHLIST:
            raise ValueError("UNSUPPORTED_SYMBOL")
        return value

    def snapshot(self, symbol: str, timeframe: str = "1m", candle_limit: int = 180) -> Dict[str, Any]:
        normalized = self.normalize_symbol(symbol)
        selected_timeframe = timeframe if timeframe in SUPPORTED_TIMEFRAMES else "1m"
        return self._snapshots(
            [normalized], selected_timeframe, min(max(candle_limit, 20), 300), True,
        )[normalized.replace("/", "")]

    def decision_snapshot(self, symbol: str, timeframe: str = "1m", candle_limit: int = 40) -> Dict[str, Any]:
        """Fetch only the real market fields Jev consumes, omitting depth latency."""
        normalized = self.normalize_symbol(symbol)
        selected_timeframe = timeframe if timeframe in SUPPORTED_TIMEFRAMES else "1m"
        return self._snapshots(
            [normalized], selected_timeframe, min(max(candle_limit, 20), 80), False,
        )[normalized.replace("/", "")]

    def decision_snapshots(self, symbols: Iterable[str], timeframe: str = "1m", candle_limit: int = 40) -> Dict[str, Dict[str, Any]]:
        """Fetch one shared ticker batch plus compact candles for a multi-asset Jev cycle."""
        normalized_symbols = []
        for symbol in symbols:
            normalized = self.normalize_symbol(symbol)
            if normalized not in normalized_symbols:
                normalized_symbols.append(normalized)
        selected_timeframe = timeframe if timeframe in SUPPORTED_TIMEFRAMES else "1m"
        return self._snapshots(
            normalized_symbols, selected_timeframe, min(max(candle_limit, 20), 80), False, batch=True,
        )

    def _snapshots(self, symbols, timeframe, candle_limit, require_order_book, batch=False):
        keys = [(symbol, timeframe, candle_limit, require_order_book) for symbol in symbols]
        snapshots = self._cached_snapshots(keys)
        if len(snapshots) != len(keys):
            # Share concurrent misses, including overlapping batches. One loader at a
            # time also preserves the fetcher's existing four-worker candle bound.
            with self._fetch_lock:
                snapshots = self._cached_snapshots(keys)
                missing = [key for key in keys if key not in snapshots]
                if missing:
                    loaded = self._fetch_snapshots(
                        [key[0] for key in missing], timeframe, candle_limit, require_order_book, batch,
                    )
                    with self._cache_lock:
                        expires_at = monotonic() + self._cache_seconds
                        for key in missing:
                            snapshot = loaded[key[0]]
                            previous = self._cache.get(key)
                            if snapshot["status"] == "offline" and previous and previous[1].get("realData"):
                                snapshot = deepcopy(previous[1])
                                snapshot.update(
                                    status="degraded", fresh=False, stale=True,
                                    error="BINANCE_PUBLIC_DATA_UNAVAILABLE",
                                )
                            self._cache[key] = (expires_at, snapshot)
                            self._cache.move_to_end(key)
                            snapshots[key] = snapshot
                        while len(self._cache) > MAX_CACHE_ENTRIES:
                            self._cache.popitem(last=False)
        return {
            key[0].replace("/", ""): self._with_freshness(snapshots[key])
            for key in keys
        }

    def _cached_snapshots(self, keys):
        snapshots = {}
        with self._cache_lock:
            now = monotonic()
            for key in keys:
                entry = self._cache.get(key)
                if entry and entry[0] > now:
                    snapshots[key] = entry[1]
                    self._cache.move_to_end(key)
        return snapshots

    def _fetch_snapshots(self, symbols, timeframe, candle_limit, require_order_book, batch):
        tickers, timestamps = {}, {}
        if batch:
            fetched_at = utc_now()
            tickers = self._fetch(self.fetcher.fetch_tickers, symbols) or {}
            if not isinstance(tickers, dict):
                tickers = {}
            timestamps = {symbol: fetched_at for symbol in symbols}
        for symbol in symbols:
            if not tickers.get(symbol):
                timestamps[symbol] = utc_now()
                tickers[symbol] = self._fetch(self.fetcher.fetch_ticker, symbol)
        if batch:
            frames = self._fetch(self.fetcher.fetch_ohlcv_many, symbols, timeframe=timeframe, limit=candle_limit) or {}
        else:
            frames = {symbols[0]: self._fetch(self.fetcher.fetch_ohlcv, symbols[0], timeframe=timeframe, limit=candle_limit)}
        snapshots = {}
        for symbol in symbols:
            order_book = self._fetch(self.fetcher.fetch_order_book, symbol, limit=16) if require_order_book else None
            snapshots[symbol] = self._build_snapshot(
                symbol, timeframe, timestamps[symbol], tickers.get(symbol),
                frames.get(symbol) if isinstance(frames, dict) else None, order_book, require_order_book,
            )
        return snapshots

    @staticmethod
    def _fetch(method, *args, **kwargs):
        try:
            return method(*args, **kwargs)
        except Exception:
            # Public errors must never contain transport details or credentials.
            return None

    @staticmethod
    def _with_freshness(snapshot):
        result = deepcopy(snapshot)
        result.update(price_status(result))
        result["fresh"] = result["marketDataStatus"] == "fresh"
        result["stale"] = not result["fresh"]
        return result

    @staticmethod
    def _price_timestamp(ticker, fetched_at):
        # A slow ticker/candle/depth call must not advance the quote's timestamp.
        source_ms = number(ticker.get("timestamp"))
        if source_ms is not None and source_ms > 0:
            try:
                source_time = datetime.fromtimestamp(source_ms / 1000, timezone.utc)
                return min(source_time, datetime.fromisoformat(fetched_at)).isoformat()
            except (OverflowError, OSError, ValueError):
                pass
        return fetched_at

    def _build_snapshot(self, normalized, selected_timeframe, fetched_at, ticker, candles_df, order_book, require_order_book):

        last = None
        if isinstance(ticker, dict):
            last = self._number(ticker.get("last") if ticker.get("last") is not None else ticker.get("close"))
        if last is None or last <= 0 or candles_df is None or candles_df.empty:
            return {
                "status": "offline",
                "symbol": normalized.replace("/", ""),
                "exchangeSymbol": normalized,
                "timeframe": selected_timeframe,
                "fresh": False,
                "stale": True,
                "updatedAt": None,
                "marketPriceTimestamp": None,
                "ticker": None,
                "candles": [],
                "orderBook": {"bids": [], "asks": []},
                "error": "BINANCE_PUBLIC_DATA_UNAVAILABLE",
                "realData": False,
            }

        price_timestamp = self._price_timestamp(ticker, fetched_at)
        bid = self._number(ticker.get("bid"))
        ask = self._number(ticker.get("ask"))
        spread = self._number(ask - bid) if ask is not None and bid is not None else None
        spread_pct = self._number(spread / ask * 100) if spread is not None and ask else None
        candles = []
        for timestamp, row in candles_df.iterrows():
            candles.append({
                "time": int(timestamp.timestamp()),
                "open": self._number(row.get("open")),
                "high": self._number(row.get("high")),
                "low": self._number(row.get("low")),
                "close": self._number(row.get("close")),
                "volume": self._number(row.get("volume")),
            })

        return {
            "status": "online" if order_book or not require_order_book else "degraded",
            "symbol": normalized.replace("/", ""),
            "exchangeSymbol": normalized,
            "timeframe": selected_timeframe,
            "fresh": True,
            "stale": False,
            "updatedAt": price_timestamp,
            "marketPriceTimestamp": price_timestamp,
            "ticker": {
                "last": last,
                "bid": bid,
                "ask": ask,
                "spread": spread,
                "spreadPct": round(spread_pct, 6) if spread_pct is not None else None,
                "change24h": self._number(ticker.get("percentage")),
                "volume24h": self._number(ticker.get("quoteVolume") or ticker.get("baseVolume")),
                "high24h": self._number(ticker.get("high")),
                "low24h": self._number(ticker.get("low")),
            },
            "candles": candles,
            "orderBook": {
                "bids": self._levels((order_book or {}).get("bids")),
                "asks": self._levels((order_book or {}).get("asks")),
            },
            "decisionOptimized": not require_order_book,
            "realData": True,
        }

    @staticmethod
    def _number(value: Any):
        return number(value)

    @classmethod
    def _levels(cls, rows):
        result = []
        for row in (rows or [])[:16]:
            if len(row) >= 2:
                result.append({"price": cls._number(row[0]), "amount": cls._number(row[1])})
        return result
