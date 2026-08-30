"""
Market data fetcher using CCXT (Binance by default).
Collects OHLCV + real-time ticker data.
"""
import ccxt
import pandas as pd
from typing import Optional, Dict, List
import logging
import os

from config import CONFIG

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("market_data")


class MarketDataFetcher:
    def __init__(self):
        api_key = os.getenv(CONFIG.EXCHANGE_API_KEY_ENV)
        api_secret = os.getenv(CONFIG.EXCHANGE_API_SECRET_ENV)
        if (api_key or api_secret) and not CONFIG.live_trading_active:
            raise RuntimeError(
                "Exchange API credentials are present, but live trading is not explicitly enabled. "
                "Remove credentials for paper mode or set TRADING_MODE=LIVE and ENABLE_LIVE_TRADING=true."
            )

        exchange_class = getattr(ccxt, CONFIG.EXCHANGE_ID)
        options = {
            "enableRateLimit": True,
            "options": {"defaultType": "spot"},
        }
        if CONFIG.live_trading_active:
            raise RuntimeError(
                "LIVE mode is recognized but no live execution client is implemented. "
                "Refusing to initialize authenticated exchange access."
            )
        self.exchange = exchange_class(options)
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
