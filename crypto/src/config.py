"""
Central configuration for the autonomous crypto trading agent.
All tunable parameters live here.
"""
import os
from dataclasses import dataclass, field
from typing import List, Dict


@dataclass
class Config:
    # --- LLM ---
    OLLAMA_HOST: str = os.getenv("OLLAMA_HOST", "http://localhost:11434")
    LLM_MODEL: str = os.getenv("LLM_MODEL", "qwen2.5:3b")  # or qwen2, mistral, etc.
    LLM_TEMPERATURE: float = 0.3  # low for deterministic trading decisions
    LLM_CONTEXT_LENGTH: int = 4096

    # --- Market Data ---
    EXCHANGE_ID: str = "binance"  # ccxt exchange id
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
    PAPER_TRADING: bool = True  # True = simulation only

    # --- Paths ---
    DATA_DIR: str = "data"
    LOG_DIR: str = "logs"
    DB_PATH: str = "data/agent_memory.db"


# Singleton
CONFIG = Config()
