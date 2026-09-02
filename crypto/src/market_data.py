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
        if CONFIG.BINANCE_TRADING_ENABLED or CONFIG.live_trading_active:
            raise RuntimeError(
                "Binance trading/live mode is locked. This module supports public data and read-only account checks only."
            )
        if (api_key or api_secret) and not (api_key and api_secret and CONFIG.BINANCE_READ_ONLY):
            raise RuntimeError(
                "Binance credentials are incomplete or read-only mode is disabled. "
                "Use both BINANCE_API_KEY and BINANCE_API_SECRET with BINANCE_READ_ONLY=true, or remove credentials."
            )

        exchange_class = getattr(ccxt, CONFIG.EXCHANGE_ID)
        options = {
            "enableRateLimit": True,
            "options": {"defaultType": "spot"},
        }
        self.exchange = exchange_class(options)
        self._account_exchange = None
        if api_key and api_secret and CONFIG.BINANCE_READ_ONLY:
            self._account_exchange = exchange_class({
                "apiKey": api_key,
                "secret": api_secret,
                "enableRateLimit": True,
                "options": {"defaultType": "spot"},
            })
        logger.info(f"Initialized exchange: {CONFIG.EXCHANGE_ID} ({CONFIG.binance_connection_mode})")

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

    def fetch_read_only_balance(self) -> Optional[Dict]:
        """Fetch account balance only when read-only Binance credentials are configured."""
        if self._account_exchange is None:
            return None
        if CONFIG.BINANCE_TRADING_ENABLED or CONFIG.live_trading_active:
            raise RuntimeError("Read-only balance blocked because trading/live flags are enabled.")
        try:
            return self._account_exchange.fetch_balance()
        except Exception as e:
            logger.error(f"Error fetching read-only Binance balance: {e}")
            return None
