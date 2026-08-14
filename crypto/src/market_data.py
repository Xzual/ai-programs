"""
Market data fetcher using CCXT (Binance by default).
Collects OHLCV + real-time ticker data.
"""
import ccxt
import pandas as pd
from typing import Optional, Dict, List
import logging

from config import CONFIG

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("market_data")


class MarketDataFetcher:
    def __init__(self):
        exchange_class = getattr(ccxt, CONFIG.EXCHANGE_ID)
        self.exchange = exchange_class({
            "enableRateLimit": True,
            "options": {"defaultType": "spot"},
        })
        logger.info(f"Initialized exchange: {CONFIG.EXCHANGE_ID}")

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

    def fetch_order_book(self, symbol: str, limit: int = 20) -> Optional[Dict]:
        """Fetch order book for liquidity analysis."""
        try:
            return self.exchange.fetch_order_book(symbol, limit=limit)
        except Exception as e:
            logger.error(f"Error fetching order book for {symbol}: {e}")
            return None
