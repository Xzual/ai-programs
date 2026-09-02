"""
Central configuration for the autonomous crypto trading agent.
All tunable parameters live here.
"""
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Dict

CRYPTO_ROOT = Path(__file__).resolve().parents[1]

@dataclass
class Config:
    # --- LLM ---
    OLLAMA_HOST: str = os.getenv("OLLAMA_HOST", "http://localhost:11434")
    LLM_MODEL: str = os.getenv("LLM_MODEL", "qwen2.5:3b")  # or qwen2, mistral, etc.
    LLM_TEMPERATURE: float = 0.3  # low for deterministic trading decisions
    LLM_CONTEXT_LENGTH: int = 4096

    # --- Market Data ---
    EXCHANGE_ID: str = "binance"  # ccxt exchange id
    EXCHANGE_API_KEY_ENV: str = "BINANCE_API_KEY"
    EXCHANGE_API_SECRET_ENV: str = "BINANCE_API_SECRET"
    TIMEFRAMES: List[str] = field(default_factory=lambda: ["15m", "1h", "4h"])
    WATCHLIST: List[str] = field(
        default_factory=lambda: [
            "BTC/USDT",
            "ETH/USDT",
            "SOL/USDT",
            "BNB/USDT",
            "XRP/USDT",
            "DOGE/USDT",
            "ADA/USDT",
            "AVAX/USDT",
        ]
    )
    OHLCV_LIMIT: int = 200  # candles per request

    # --- Technical Analysis ---
    RSI_PERIOD: int = 14
    RSI_OVERBOUGHT: float = 70.0
    RSI_OVERSOLD: float = 30.0
    MACD_FAST: int = 12
    MACD_SLOW: int = 26
    MACD_SIGNAL: int = 9
    EMA_SHORT: int = 9
    EMA_LONG: int = 21
    BOLLINGER_PERIOD: int = 20
    BOLLINGER_STDDEV: float = 2.0
    ATR_PERIOD: int = 14

    # --- Risk Management ---
    INITIAL_BALANCE: float = 10_000.0  # USDT
    MAX_POSITION_PCT: float = 0.20  # max 20% of balance per trade
    STOP_LOSS_PCT: float = 0.03  # 3% stop loss
    TAKE_PROFIT_PCT: float = 0.06  # 6% take profit
    MAX_OPEN_POSITIONS: int = 3
    COOLDOWN_MINUTES: int = 15  # minutes between trades on same pair

    # --- News / Research ---
    NEWS_SOURCES: List[str] = field(
        default_factory=lambda: [
            "https://www.coindesk.com",
            "https://cointelegraph.com",
            "https://cryptonews.com/news",
        ]
    )
    NEWS_CHECK_INTERVAL_MINUTES: int = 30

    # --- Agent Loop ---
    LOOP_INTERVAL_MINUTES: int = 1  # how often the full cycle runs
    TRADING_MODE: str = os.getenv("TRADING_MODE", os.getenv("CRYPTO_MODE", "OBSERVER_ONLY")).strip().upper()
    ENABLE_LIVE_TRADING: bool = os.getenv("ENABLE_LIVE_TRADING", "false").strip().lower() == "true"
    CRYPTO_TRADING_ENABLED: bool = os.getenv("CRYPTO_TRADING_ENABLED", "false").strip().lower() == "true"
    CRYPTO_PAPER_TRADING_ENABLED: bool = os.getenv("CRYPTO_PAPER_TRADING_ENABLED", "false").strip().lower() == "true"
    CRYPTO_LIVE_TRADING_ENABLED: bool = os.getenv("CRYPTO_LIVE_TRADING_ENABLED", "false").strip().lower() == "true"
    ALLOWED_ACTIONS: List[str] = field(default_factory=lambda: ["BUY", "SELL", "HOLD", "NO TRADE"])
    BINANCE_READ_ONLY: bool = os.getenv("BINANCE_READ_ONLY", "true").strip().lower() == "true"
    BINANCE_TRADING_ENABLED: bool = os.getenv("BINANCE_TRADING_ENABLED", "false").strip().lower() == "true"
    PERMISSIONS_CONFIG_PATH: str = os.getenv(
        "CRYPTO_PERMISSIONS_CONFIG",
        str(CRYPTO_ROOT / "config" / "coin_permissions.json"),
    )
    OBSERVER_CONFIG_PATH: str = os.getenv(
        "CRYPTO_OBSERVER_CONFIG",
        str(CRYPTO_ROOT / "config" / "observer_config.json"),
    )
    EDITH_OBSIDIAN_VAULT_PATH: str = os.getenv("EDITH_OBSIDIAN_VAULT_PATH", r"D:\EDİTH\EDİTH").strip()
    CRYPTO_OBSIDIAN_ENABLED: bool = os.getenv("CRYPTO_OBSIDIAN_ENABLED", "false").strip().lower() == "true"
    CRYPTO_OBSIDIAN_FOLDER: str = "Trading/Crypto Market Learning"
    CRYPTO_ALLOW_MARKET_DATA_ONLY_WHEN_OLLAMA_OFFLINE: bool = (
        os.getenv("CRYPTO_ALLOW_MARKET_DATA_ONLY_WHEN_OLLAMA_OFFLINE", "true").strip().lower() == "true"
    )

    # --- Paths ---
    DATA_DIR: str = os.getenv("CRYPTO_DATA_DIR", "data")
    LOG_DIR: str = os.getenv("CRYPTO_LOG_DIR", "logs")
    DB_PATH: str = os.getenv("CRYPTO_DB_PATH", "data/agent_memory.db")

    def __post_init__(self):
        aliases = {"PAPER": "PAPER_TRADING", "LIVE": "LIVE_TRADING_LOCKED"}
        self.TRADING_MODE = aliases.get(self.TRADING_MODE, self.TRADING_MODE)
        if self.TRADING_MODE not in ("OBSERVER_ONLY", "PAPER_TRADING", "READ_ONLY_ACCOUNT", "LIVE_TRADING_LOCKED"):
            self.TRADING_MODE = "OBSERVER_ONLY"
        if not self.CRYPTO_TRADING_ENABLED:
            self.TRADING_MODE = "OBSERVER_ONLY"
        self.PAPER_TRADING = (
            self.TRADING_MODE == "PAPER_TRADING"
            and self.CRYPTO_TRADING_ENABLED
            and self.CRYPTO_PAPER_TRADING_ENABLED
        )

    @property
    def live_trading_active(self) -> bool:
        return (
            self.TRADING_MODE == "LIVE_TRADING_LOCKED"
            and self.ENABLE_LIVE_TRADING
            and self.CRYPTO_TRADING_ENABLED
            and self.CRYPTO_LIVE_TRADING_ENABLED
        )

    @property
    def binance_connection_mode(self) -> str:
        has_key = bool(os.getenv(self.EXCHANGE_API_KEY_ENV))
        has_secret = bool(os.getenv(self.EXCHANGE_API_SECRET_ENV))
        if self.BINANCE_TRADING_ENABLED or self.live_trading_active:
            return "LIVE_LOCKED"
        if has_key or has_secret:
            if has_key and has_secret and self.BINANCE_READ_ONLY:
                return "READ_ONLY_ACCOUNT"
            return "CREDENTIALS_INCOMPLETE"
        return "PUBLIC_MARKET_DATA"


# Singleton
CONFIG = Config()
