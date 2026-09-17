"""
Explicit demo analysis orchestration for E.D.I.T.H. Crypto.

This creates structured demo decisions from real market/news inputs when
available. It never sends real exchange orders.
"""
import json
import logging
import time
from typing import Dict, Any, List

import requests

from asset_modes import AssetModeManager
from config import CONFIG
from crypto_models import CryptoModelManager
from demo_portfolio import DemoPortfolioEngine
from market_data import MarketDataFetcher
from news_intelligence import enrich_news_rows
from technical_analysis import TechnicalAnalyzer

logger = logging.getLogger("demo_analysis")


class DemoAnalysisEngine:
    def __init__(
        self,
        portfolio: DemoPortfolioEngine,
        asset_modes: AssetModeManager,
        model_manager: CryptoModelManager,
    ):
        self.portfolio = portfolio
        self.asset_modes = asset_modes
        self.model_manager = model_manager

    def analyze(self, symbols: List[str] = None, news_rows: List[Dict[str, Any]] = None) -> Dict[str, Any]:
        requested = symbols or ["BTC/USDT"]
        results = []
        for symbol in requested[:8]:
            results.append(self._analyze_one(self.asset_modes.normalize_symbol(symbol), news_rows or []))
        return {
            "ok": True,
            "mode": "DEMO_ANALYSIS",
            "realOrderSent": False,
            "results": results,
            "portfolio": self.portfolio.summary(),
        }

    def _analyze_one(self, symbol: str, news_rows: List[Dict[str, Any]]) -> Dict[str, Any]:
        mode = self.asset_modes.get_mode(symbol)
        if mode == "DISABLED":
            decision = self._base_decision(symbol, "NO_TRADE", 0.0, "Asset is disabled.")
            decision_id = self.portfolio.save_decision(decision, mode, "VETOED", "ASSET_DISABLED")
            return {"decisionId": decision_id, "riskStatus": "VETOED", "riskReason": "ASSET_DISABLED", **decision}

        ta = self._market_context(symbol)
        enriched_news = enrich_news_rows(news_rows)
        asset_news = [
            item for item in enriched_news["items"]
            if not item.get("relatedAssets") or symbol in item.get("relatedAssets", [])
        ][:8]
        decision = self._llm_decision(symbol, ta, asset_news)
        decision = self._normalize_decision(symbol, decision, ta, asset_news)
        risk_status, risk_reason = self._risk_gate(decision, mode, ta, asset_news)
        decision["risk_summary"] = risk_reason
        decision_id = self.portfolio.save_decision(decision, mode, risk_status, risk_reason)
        return {"decisionId": decision_id, "riskStatus": risk_status, "riskReason": risk_reason, **decision}

    def _market_context(self, symbol: str) -> Dict[str, Any]:
        try:
            fetcher = MarketDataFetcher()
            df = fetcher.fetch_ohlcv(symbol, timeframe="1h", limit=CONFIG.OHLCV_LIMIT)
            ta = TechnicalAnalyzer().analyze(df) if df is not None else None
            ticker = fetcher.fetch_ticker(symbol)
            order_book = fetcher.fetch_order_book(symbol, limit=10)
            if ta is None:
                return {"available": False, "summary": "Binance market data unavailable.", "close": None}
            bid = float((ticker or {}).get("bid") or 0)
            ask = float((ticker or {}).get("ask") or 0)
            spread_pct = ((ask - bid) / ask * 100) if ask > 0 and bid > 0 else None
            return {
                **ta,
                "available": True,
                "bid": bid or None,
                "ask": ask or None,
                "spreadPct": round(spread_pct, 4) if spread_pct is not None else None,
                "orderBookDepth": {
                    "bids": len((order_book or {}).get("bids") or []),
                    "asks": len((order_book or {}).get("asks") or []),
                },
            }
        except Exception as exc:
            logger.error("Demo analysis market context failed for %s: %s", symbol, exc)
            return {"available": False, "summary": f"Binance market data unavailable: {exc}", "close": None}

    def _llm_decision(self, symbol: str, ta: Dict[str, Any], news: List[Dict[str, Any]]) -> Dict[str, Any]:
        settings = self.model_manager.settings()
        model = settings["primary"]
        prompt = self._prompt(symbol, ta, news, self.portfolio.summary(), model)
        started = time.time()
        try:
            response = requests.post(
                f"{CONFIG.OLLAMA_HOST}/api/generate",
                json={
                    "model": model,
                    "prompt": prompt,
                    "stream": False,
                    "format": "json",
                    "options": {"temperature": CONFIG.LLM_TEMPERATURE, "num_ctx": CONFIG.LLM_CONTEXT_LENGTH},
                },
                timeout=45,
            )
            response.raise_for_status()
            data = json.loads(response.json().get("response") or "{}")
            latency = int((time.time() - started) * 1000)
            self.model_manager.record_activity("primary", model, f"analyze {symbol}", latency, True, False, True, str(data.get("decision_reason") or data.get("reasoning") or "")[:280])
            return data
        except Exception as exc:
            latency = int((time.time() - started) * 1000)
            summary = "Local Ollama unavailable; fallback NO_TRADE generated without fabricated reasoning."
            self.model_manager.record_activity("primary", model, f"analyze {symbol}", latency, False, False, False, summary, str(exc))
            return self._base_decision(symbol, "NO_TRADE", 0.0, summary, model)

    def _normalize_decision(self, symbol: str, raw: Dict[str, Any], ta: Dict[str, Any], news: List[Dict[str, Any]]) -> Dict[str, Any]:
        decision = str(raw.get("decision") or raw.get("action") or "NO_TRADE").upper().replace(" ", "_")
        if decision not in {"BUY", "SELL", "HOLD", "NO_TRADE"}:
            decision = "NO_TRADE"
        try:
            confidence = max(0.0, min(1.0, float(raw.get("confidence") or 0.0)))
        except Exception:
            confidence = 0.0
        price = raw.get("entry_price") or ta.get("close")
        return {
            "asset": symbol,
            "symbol": symbol,
            "decision": decision,
            "confidence": confidence,
            "market_regime": raw.get("market_regime") or self._market_regime(ta),
            "trend": raw.get("trend") or ta.get("trend") or "uncertain",
            "volatility": raw.get("volatility") or self._volatility(ta),
            "news_sentiment": raw.get("news_sentiment") or self._news_sentiment(news),
            "technical_summary": raw.get("technical_summary") or ta.get("summary") or "Technical data unavailable.",
            "news_summary": raw.get("news_summary") or self._news_summary(news),
            "risk_summary": raw.get("risk_summary") or "Risk engine pending.",
            "decision_reason": raw.get("decision_reason") or raw.get("reasoning") or "No clean edge found.",
            "invalidation_condition": raw.get("invalidation_condition") or "Risk/reward weakens or market data becomes stale.",
            "time_horizon": raw.get("time_horizon") or "short",
            "model_used": raw.get("model_used") or self.model_manager.settings()["primary"],
            "entry_price": float(price) if price else None,
            "position_size": raw.get("position_size"),
            "stop_loss": raw.get("stop_loss"),
            "take_profit": raw.get("take_profit"),
            "risk_amount": raw.get("risk_amount"),
            "risk_reward": raw.get("risk_reward"),
            "exit_condition": raw.get("exit_condition") or "Exit if setup invalidates.",
            "not_financial_advice": True,
        }

    def _risk_gate(self, decision: Dict[str, Any], mode: str, ta: Dict[str, Any], news: List[Dict[str, Any]]):
        action = decision["decision"]
        if action in {"HOLD", "NO_TRADE"}:
            return "APPROVED", "Safe non-execution decision."
        if mode != "DEMO_TRADE_ALLOWED":
            decision["decision"] = "NO_TRADE"
            return "VETOED", f"Asset mode {mode} does not allow demo trades."
        if float(decision.get("confidence") or 0.0) < 0.7:
            decision["decision"] = "NO_TRADE"
            return "VETOED", "Confidence below 0.70 minimum."
        portfolio = self.portfolio.summary()
        if len(portfolio["openPositions"]) >= 3:
            decision["decision"] = "NO_TRADE"
            return "VETOED", "Maximum 3 open demo positions reached."
        if action == "BUY" and any(pos.get("symbol") == decision["symbol"] for pos in portfolio["openPositions"]):
            decision["decision"] = "NO_TRADE"
            return "VETOED", "Duplicate same-symbol demo position blocked."
        if not decision.get("entry_price"):
            decision["decision"] = "NO_TRADE"
            return "VETOED", "Entry price unavailable from public market data."
        price = float(decision["entry_price"])
        position_size = min(float(decision.get("position_size") or 20.0), 20.0, portfolio["currentCash"])
        if position_size <= 0:
            decision["decision"] = "NO_TRADE"
            return "VETOED", "No demo cash available."
        decision["position_size"] = position_size
        if not decision.get("stop_loss"):
            decision["stop_loss"] = round(price * 0.97, 8)
        if not decision.get("take_profit"):
            decision["take_profit"] = round(price * 1.06, 8)
        if action == "BUY" and float(decision["stop_loss"]) >= price:
            decision["decision"] = "NO_TRADE"
            return "VETOED", "Stop loss must be below entry for BUY."
        decision["risk_amount"] = round(position_size * 0.03, 4)
        reward = abs(float(decision["take_profit"]) - price)
        risk = abs(price - float(decision["stop_loss"]))
        decision["risk_reward"] = round(reward / risk, 3) if risk else 0
        if decision["risk_reward"] < 1.2:
            decision["decision"] = "NO_TRADE"
            return "VETOED", "Risk/reward below 1.2."
        spread = ta.get("spreadPct")
        if spread is not None and float(spread) > 0.5:
            decision["decision"] = "NO_TRADE"
            return "VETOED", "Spread too wide for demo trade."
        if any(item.get("importance", 0) > 0.75 and item.get("sentiment") == "negative" for item in news):
            decision["decision"] = "NO_TRADE"
            return "VETOED", "High-importance negative news risk."
        return "APPROVED", "Risk engine approved simulated demo trade only."

    @staticmethod
    def _base_decision(symbol: str, decision: str, confidence: float, reason: str, model: str = None):
        return {
            "asset": symbol,
            "symbol": symbol,
            "decision": decision,
            "confidence": confidence,
            "market_regime": "uncertain",
            "trend": "uncertain",
            "volatility": "uncertain",
            "news_sentiment": "unknown",
            "technical_summary": "No reliable technical conclusion.",
            "news_summary": "No reliable news conclusion.",
            "risk_summary": "No execution.",
            "decision_reason": reason,
            "invalidation_condition": "Data or model dependency unavailable.",
            "time_horizon": "short",
            "model_used": model or CONFIG.LLM_MODEL,
            "not_financial_advice": True,
        }

    @staticmethod
    def _prompt(symbol: str, ta: Dict[str, Any], news: List[Dict[str, Any]], portfolio: Dict[str, Any], model: str) -> str:
        news_text = "\n".join(f"- {item.get('title')} | sentiment={item.get('sentiment')} | importance={item.get('importance')}" for item in news[:6])
        return f"""
You are E.D.I.T.H. Crypto Demo Analyst. This is a 100 USD virtual demo portfolio only.
No real money is used. No live execution exists. Produce concise JSON only.

Asset: {symbol}
Selected model: {model}
Portfolio cash: {portfolio.get('currentCash')} USD
Open positions: {portfolio.get('openPositions')}
Technical data: {json.dumps(ta, ensure_ascii=False)}
News:
{news_text or "No recent relevant news."}

Allowed decisions: BUY, SELL, HOLD, NO_TRADE.
Prefer NO_TRADE when confidence, data quality or risk/reward is weak.

Return JSON with:
asset, decision, confidence, market_regime, trend, volatility, news_sentiment,
technical_summary, news_summary, risk_summary, decision_reason,
invalidation_condition, time_horizon, model_used.
For BUY/SELL include entry_price, position_size, stop_loss, take_profit,
risk_amount, risk_reward, exit_condition.
"""

    @staticmethod
    def _market_regime(ta: Dict[str, Any]) -> str:
        if not ta.get("available"):
            return "unavailable"
        trend = str(ta.get("trend") or "neutral")
        atr = ta.get("atr") or 0
        price = ta.get("close") or 1
        atr_pct = (float(atr) / float(price) * 100) if price else 0
        if atr_pct > 4:
            return "volatile"
        return "trend" if trend in {"bullish", "bearish"} else "range"

    @staticmethod
    def _volatility(ta: Dict[str, Any]) -> str:
        atr = ta.get("atr") or 0
        price = ta.get("close") or 1
        atr_pct = (float(atr) / float(price) * 100) if price else 0
        if atr_pct > 4:
            return "high"
        if atr_pct > 1.5:
            return "medium"
        return "low"

    @staticmethod
    def _news_sentiment(news: List[Dict[str, Any]]) -> str:
        if not news:
            return "unknown"
        score = sum(float(item.get("sentimentScore") or 0) for item in news) / len(news)
        return "positive" if score > 0.2 else "negative" if score < -0.2 else "mixed"

    @staticmethod
    def _news_summary(news: List[Dict[str, Any]]) -> str:
        if not news:
            return "No relevant recent news found."
        return "; ".join(str(item.get("title")) for item in news[:3])
