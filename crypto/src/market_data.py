"""
Market data fetcher using CCXT (Binance by default).
Collects OHLCV + real-time ticker data.
"""
import ccxt
import pandas as pd
from concurrent.futures import ThreadPoolExecutor
from typing import Optional, Dict, List
import logging

from config import CONFIG

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("market_data")


class MarketDataFetcher:
    def __init__(self):
        if CONFIG.BINANCE_TRADING_ENABLED or CONFIG.live_trading_active:
            raise RuntimeError(
                "Binance trading/live mode is locked. This phase supports public market data only."
            )

        exchange_class = getattr(ccxt, CONFIG.EXCHANGE_ID)
        options = {
            "enableRateLimit": True,
            "options": {"defaultType": "spot"},
        }
        self.exchange = exchange_class(options)
        logger.info("Initialized exchange: %s (PUBLIC_MARKET_DATA)", CONFIG.EXCHANGE_ID)

    def fetch_ohlcv(
        self,
        symbol: str,
        timeframe: str = "1h",
        limit: int = 200,
    ) -> Optional[pd.DataFrame]:
        """Fetch OHLCV candles and return a DataFrame."""
        try:
            raw = self.exchange.fetch_ohlcv(symbol, timeframe=timeframe, limit=limit)
            df = pd.DataFrame(
                raw, columns=["timestamp", "open", "high", "low", "close", "volume"]
            )
            df["datetime"] = pd.to_datetime(df["timestamp"], unit="ms")
            df.set_index("datetime", inplace=True)
            return df
        except Exception as e:
            logger.error(f"Error fetching OHLCV for {symbol}: {e}")
            return None

    def fetch_all_watchlist(self, timeframe: str = "1h") -> Dict[str, pd.DataFrame]:
        """Fetch OHLCV for every symbol in the watchlist."""
        results = {}
        for sym in CONFIG.WATCHLIST:
            df = self.fetch_ohlcv(sym, timeframe=timeframe, limit=CONFIG.OHLCV_LIMIT)
            if df is not None:
                results[sym] = df
        return results

    def fetch_ticker(self, symbol: str) -> Optional[Dict]:
        """Fetch latest ticker (bid, ask, last, volume, change%)."""
        try:
            return self.exchange.fetch_ticker(symbol)
        except Exception as e:
            logger.error(f"Error fetching ticker for {symbol}: {e}")
            return None

    def fetch_tickers(self, symbols: List[str]) -> Dict[str, Dict]:
        """Fetch watchlist tickers in one public Binance request when supported."""
        try:
            return self.exchange.fetch_tickers(symbols)
        except Exception as e:
            logger.error("Error fetching watchlist tickers: %s", e)
            return {}

    def fetch_ohlcv_many(self, symbols: List[str], timeframe: str = "1m", limit: int = 40) -> Dict[str, Optional[pd.DataFrame]]:
        """Fetch public candles with bounded concurrency for low-latency batch decisions."""
        workers = min(4, max(1, len(symbols)))
        with ThreadPoolExecutor(max_workers=workers, thread_name_prefix="binance-public") as pool:
            frames = pool.map(lambda symbol: self.fetch_ohlcv(symbol, timeframe, limit), symbols)
            return dict(zip(symbols, frames))

    def fetch_order_book(self, symbol: str, limit: int = 20) -> Optional[Dict]:
        """Fetch order book for liquidity analysis."""
        try:
            return self.exchange.fetch_order_book(symbol, limit=limit)
        except Exception as e:
            logger.error(f"Error fetching order book for {symbol}: {e}")
            return None

    def fetch_read_only_balance(self) -> Optional[Dict]:
        """Private account access is intentionally unavailable in this phase."""
        return None
