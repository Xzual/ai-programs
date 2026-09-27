"""
Central configuration for the autonomous crypto trading agent.
All tunable parameters live here.
"""
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import List
from obsidian_path import CRYPTO_OBSIDIAN_FOLDER as DEFAULT_CRYPTO_OBSIDIAN_FOLDER, resolve_obsidian_vault_path

_MODULE_CRYPTO_ROOT = Path(__file__).resolve().parents[1]
CRYPTO_ROOT = Path(os.getenv("EDITH_CRYPTO_RESOURCE_DIR", str(_MODULE_CRYPTO_ROOT))).expanduser().resolve()
if CRYPTO_ROOT != _MODULE_CRYPTO_ROOT:
    raise RuntimeError("EDITH_CRYPTO_RESOURCE_DIR does not match the loaded crypto module tree")
RUNTIME_ROOT = Path(os.getenv("EDITH_CRYPTO_RUNTIME_DATA_DIR", str(CRYPTO_ROOT))).expanduser().resolve()
DEFAULT_DATA_DIR = RUNTIME_ROOT / "data"
DEFAULT_LOG_DIR = RUNTIME_ROOT / "logs"
OBSIDIAN_RESOLUTION = resolve_obsidian_vault_path(CRYPTO_ROOT / "config" / "observer_config.json")

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
    LOOP_INTERVAL_MINUTES: float = float(os.getenv("CRYPTO_LOOP_INTERVAL_MINUTES", "0"))
    CONTINUOUS_LOOP_DELAY_SECONDS: int = int(os.getenv("CRYPTO_CONTINUOUS_LOOP_DELAY_SECONDS", "5"))
    TRADING_MODE: str = os.getenv("TRADING_MODE", os.getenv("CRYPTO_MODE", "OBSERVER_ONLY")).strip().upper()
    ENABLE_LIVE_TRADING: bool = os.getenv("ENABLE_LIVE_TRADING", "false").strip().lower() == "true"
    CRYPTO_TRADING_ENABLED: bool = os.getenv("CRYPTO_TRADING_ENABLED", "false").strip().lower() == "true"
    CRYPTO_PAPER_TRADING_ENABLED: bool = os.getenv("CRYPTO_PAPER_TRADING_ENABLED", "false").strip().lower() == "true"
    CRYPTO_LIVE_TRADING_ENABLED: bool = os.getenv("CRYPTO_LIVE_TRADING_ENABLED", "false").strip().lower() == "true"
    CRYPTO_DEMO_TRADING_ENABLED: bool = os.getenv("CRYPTO_DEMO_TRADING_ENABLED", "true").strip().lower() == "true"
    DEMO_INITIAL_BALANCE: float = float(
        os.getenv("CRYPTO_STARTING_BALANCE", os.getenv("CRYPTO_DEMO_INITIAL_BALANCE", "10000"))
    )
    CRYPTO_DECISION_MODEL: str = os.getenv("CRYPTO_DECISION_MODEL", "jev").strip().lower()
    CRYPTO_LEARNING_ENABLED: bool = os.getenv("CRYPTO_LEARNING_ENABLED", "false").strip().lower() == "true"
    CRYPTO_NEWS_ENABLED: bool = os.getenv("CRYPTO_NEWS_ENABLED", "false").strip().lower() == "true"
    CRYPTO_OLLAMA_ENABLED: bool = os.getenv("CRYPTO_OLLAMA_ENABLED", "false").strip().lower() == "true"
    DEMO_FEE_RATE: float = float(os.getenv("CRYPTO_DEMO_FEE_RATE", "0.001"))
    DEMO_MAX_POSITION_PCT: float = float(os.getenv("CRYPTO_DEMO_MAX_POSITION_PCT", "0.20"))
    DEMO_MAX_EXPOSURE_PCT: float = float(os.getenv("CRYPTO_DEMO_MAX_EXPOSURE_PCT", "0.60"))
    DEMO_DEFAULT_JEV_POSITION_PCT: float = float(os.getenv("CRYPTO_DEMO_JEV_POSITION_PCT", "0.10"))
    DEMO_COOLDOWN_MINUTES: int = int(os.getenv("CRYPTO_DEMO_COOLDOWN_MINUTES", "15"))
    JEV_LOOP_DEFAULT_INTERVAL_SECONDS: int = int(os.getenv("CRYPTO_JEV_LOOP_INTERVAL_SECONDS", "60"))
    JEV_LOOP_MIN_INTERVAL_SECONDS: int = int(os.getenv("CRYPTO_JEV_LOOP_MIN_INTERVAL_SECONDS", "10"))
    MARKET_STALE_SECONDS: int = int(os.getenv("CRYPTO_MARKET_STALE_SECONDS", "30"))
    MAX_MARKET_DATA_AGE_MS: int = int(os.getenv("CRYPTO_MAX_MARKET_DATA_AGE_MS", "15000"))
    MARKET_CACHE_SECONDS: float = float(os.getenv("CRYPTO_MARKET_CACHE_SECONDS", "5"))
    OPERATION_LEASE_SECONDS: int = int(os.getenv("CRYPTO_OPERATION_LEASE_SECONDS", "120"))
    ALLOWED_ACTIONS: List[str] = field(default_factory=lambda: ["BUY", "SELL", "HOLD"])
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
    EDITH_OBSIDIAN_VAULT_PATH: str = OBSIDIAN_RESOLUTION.get("vaultPath") if OBSIDIAN_RESOLUTION.get("ok") else ""
    OBSIDIAN_PATH_ERROR_CODE: str = OBSIDIAN_RESOLUTION.get("errorCode")
    OBSIDIAN_PATH_RECEIVED: str = OBSIDIAN_RESOLUTION.get("receivedPath")
    OBSIDIAN_PATH_EXPECTED: str = OBSIDIAN_RESOLUTION.get("expectedPath") or ""
    CRYPTO_OBSIDIAN_ENABLED: bool = os.getenv("CRYPTO_OBSIDIAN_ENABLED", "false").strip().lower() == "true"
    CRYPTO_OBSIDIAN_FOLDER: str = DEFAULT_CRYPTO_OBSIDIAN_FOLDER
    CRYPTO_ALLOW_MARKET_DATA_ONLY_WHEN_OLLAMA_OFFLINE: bool = (
        os.getenv("CRYPTO_ALLOW_MARKET_DATA_ONLY_WHEN_OLLAMA_OFFLINE", "true").strip().lower() == "true"
    )

    # --- Paths ---
    DATA_DIR: str = str(Path(os.getenv("CRYPTO_DATA_DIR", str(DEFAULT_DATA_DIR))).expanduser().resolve())
    LOG_DIR: str = str(Path(os.getenv("CRYPTO_LOG_DIR", str(DEFAULT_LOG_DIR))).expanduser().resolve())
    DB_PATH: str = str(
        Path(os.getenv("CRYPTO_DB_PATH", str(DEFAULT_DATA_DIR / "agent_memory.db"))).expanduser().resolve()
    )

    def __post_init__(self):
        if self.DEMO_INITIAL_BALANCE != 10_000.0:
            raise ValueError("CRYPTO_STARTING_BALANCE must be exactly 10000 for the isolated demo ledger")
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
