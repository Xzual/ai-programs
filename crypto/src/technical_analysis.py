"""
Technical Analysis module.
Computes RSI, MACD, EMA, Bollinger Bands, ATR, VWAP, and trend signals.
"""
import pandas as pd
import pandas_ta as ta
import numpy as np
from typing import Dict, Any, Optional
import logging

from config import CONFIG

logger = logging.getLogger("technical_analysis")


class TechnicalAnalyzer:
    def analyze(self, df: pd.DataFrame) -> Optional[Dict[str, Any]]:
        """
        Run the full TA pipeline on an OHLCV DataFrame.
        Returns a dictionary of indicators + a summary string.
        """
        if df is None or len(df) < 50:
            logger.warning("Not enough data for TA.")
            return None

        # Ensure numeric
        for col in ["open", "high", "low", "close", "volume"]:
            df[col] = pd.to_numeric(df[col], errors="coerce")

        # --- Indicators ---
        # RSI
        df["rsi"] = ta.rsi(df["close"], length=CONFIG.RSI_PERIOD)

        # MACD
        macd = ta.macd(
            df["close"],
            fast=CONFIG.MACD_FAST,
            slow=CONFIG.MACD_SLOW,
            signal=CONFIG.MACD_SIGNAL,
        )
        if macd is not None:
            df = pd.concat([df, macd], axis=1)

        # EMAs
        df["ema_short"] = ta.ema(df["close"], length=CONFIG.EMA_SHORT)
        df["ema_long"] = ta.ema(df["close"], length=CONFIG.EMA_LONG)

        # Bollinger Bands
        bb = ta.bbands(
            df["close"], length=CONFIG.BOLLINGER_PERIOD, std=CONFIG.BOLLINGER_STDDEV
        )
        if bb is not None:
            df = pd.concat([df, bb], axis=1)

        # ATR (volatility)
        df["atr"] = ta.atr(df["high"], df["low"], df["close"], length=CONFIG.ATR_PERIOD)

        # VWAP
        df["vwap"] = ta.vwap(df["high"], df["low"], df["close"], df["volume"])

        # --- Latest values ---
        latest = df.iloc[-1]
        prev = df.iloc[-2]

        # Determine trend
        trend = "neutral"
        if latest["ema_short"] > latest["ema_long"]:
            trend = "bullish"
        elif latest["ema_short"] < latest["ema_long"]:
            trend = "bearish"

        # Determine RSI signal
        rsi_signal = "neutral"
        if latest["rsi"] > CONFIG.RSI_OVERBOUGHT:
            rsi_signal = "overbought"
        elif latest["rsi"] < CONFIG.RSI_OVERSOLD:
            rsi_signal = "oversold"

        # MACD signal
        macd_signal = "neutral"
        macd_col = f"MACD_{CONFIG.MACD_FAST}_{CONFIG.MACD_SLOW}_{CONFIG.MACD_SIGNAL}"
        signal_col = f"MACDs_{CONFIG.MACD_FAST}_{CONFIG.MACD_SLOW}_{CONFIG.MACD_SIGNAL}"
        if macd_col in df.columns and signal_col in df.columns:
            if latest[macd_col] > latest[signal_col] and prev[macd_col] <= prev[signal_col]:
                macd_signal = "bullish_crossover"
            elif latest[macd_col] < latest[signal_col] and prev[macd_col] >= prev[signal_col]:
                macd_signal = "bearish_crossover"
            elif latest[macd_col] > latest[signal_col]:
                macd_signal = "bullish"
            else:
                macd_signal = "bearish"

        # Bollinger position
        bb_position = "middle"
        bb_lower_col = next((c for c in df.columns if c.startswith(f"BBL_{CONFIG.BOLLINGER_PERIOD}_")), None)
        bb_upper_col = next((c for c in df.columns if c.startswith(f"BBU_{CONFIG.BOLLINGER_PERIOD}_")), None)
        if bb_lower_col and bb_upper_col:
            if latest["close"] <= latest[bb_lower_col]:
                bb_position = "lower_band"
            elif latest["close"] >= latest[bb_upper_col]:
                bb_position = "upper_band"

        result = {
            "timestamp": str(df.index[-1]),
            "close": round(float(latest["close"]), 4),
            "rsi": round(float(latest["rsi"]), 2) if not pd.isna(latest["rsi"]) else None,
            "macd_signal": macd_signal,
            "trend": trend,
            "ema_short": round(float(latest["ema_short"]), 4) if not pd.isna(latest["ema_short"]) else None,
            "ema_long": round(float(latest["ema_long"]), 4) if not pd.isna(latest["ema_long"]) else None,
            "bb_position": bb_position,
            "atr": round(float(latest["atr"]), 4) if not pd.isna(latest["atr"]) else None,
            "vwap": round(float(latest["vwap"]), 4) if "vwap" in latest and not pd.isna(latest["vwap"]) else None,
            "volume": round(float(latest["volume"]), 2),
        }

        # Human-readable summary
        result["summary"] = (
            f"Price: {result['close']} | Trend: {trend.upper()} | "
            f"RSI: {result['rsi']} ({rsi_signal}) | MACD: {macd_signal} | "
            f"BB: {bb_position} | ATR: {result['atr']} | Vol: {result['volume']}"
        )

        logger.info(f"TA result: {result['summary']}")
        return result
