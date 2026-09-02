"""
LLM Decision Engine for the Autonomous Crypto Trading Agent.
Connects to local Ollama and generates trading decisions.
"""
import json
import logging
import requests
from typing import Dict, Any, List, Optional

from config import CONFIG

logger = logging.getLogger("llm_engine")

FORBIDDEN_OBSERVER_LABELS = {"BUY_NOW", "SELL_NOW", "EXECUTE_TRADE", "OPEN_POSITION", "CLOSE_POSITION"}
ALLOWED_OBSERVER_LABELS = {
    "bullish_bias",
    "bearish_bias",
    "neutral",
    "range",
    "volatile",
    "uncertain",
    "accumulation_possible",
    "distribution_possible",
    "breakout_watch",
    "breakdown_watch",
}

class LLMDecisionEngine:
    def __init__(self):
        self.url = f"{CONFIG.OLLAMA_HOST}/api/generate"
        self.model = CONFIG.LLM_MODEL

    def get_decision(
        self, 
        symbol: str, 
        ta_data: Dict, 
        news: List[Dict], 
        portfolio: Dict, 
        history: List[Dict]
    ) -> Optional[Dict[str, Any]]:
        """
        Send context to Ollama and get a trading decision in JSON format.
        """
        prompt = self._build_prompt(symbol, ta_data, news, portfolio, history)
        
        try:
            payload = {
                "model": self.model,
                "prompt": prompt,
                "stream": False,
                "format": "json",
                "options": {
                    "temperature": CONFIG.LLM_TEMPERATURE,
                    "num_ctx": CONFIG.LLM_CONTEXT_LENGTH
                }
            }
            
            response = requests.post(self.url, json=payload, timeout=60)
            response.raise_for_status()
            
            result_raw = response.json().get("response", "")
            decision = json.loads(result_raw)
            
            logger.info(f"LLM Decision for {symbol}: {decision.get('action')} - {decision.get('reasoning')[:100]}...")
            return decision
            
        except Exception as e:
            logger.error(f"Error calling Ollama: {e}")
            # Fallback to HOLD if LLM fails
            return {
                "action": "NO TRADE",
                "reasoning": f"LLM error: {str(e)}",
                "confidence": 0
            }

    def get_market_observation(
        self,
        symbol: str,
        ta_data: Dict,
        news: List[Dict],
        previous_observations: List[Dict],
    ) -> Dict[str, Any]:
        prompt = self._build_observer_prompt(symbol, ta_data, news, previous_observations)

        try:
            payload = {
                "model": self.model,
                "prompt": prompt,
                "stream": False,
                "format": "json",
                "options": {
                    "temperature": CONFIG.LLM_TEMPERATURE,
                    "num_ctx": CONFIG.LLM_CONTEXT_LENGTH
                }
            }
            response = requests.post(self.url, json=payload, timeout=60)
            response.raise_for_status()
            observation = json.loads(response.json().get("response", "{}"))
        except Exception as e:
            logger.error(f"Error calling Ollama for market observation: {e}")
            observation = {
                "symbol": symbol,
                "mode": "OBSERVER_ONLY",
                "market_regime": "uncertain",
                "trend": ta_data.get("trend", "neutral"),
                "volatility": "uncertain",
                "volume_context": "Observer fallback because local LLM was unavailable.",
                "technical_summary": ta_data.get("summary", ""),
                "news_context": "No LLM news synthesis available.",
                "what_changed": "Unknown; observer fallback was used.",
                "what_to_watch_next": ["fresh candles", "volume expansion", "news catalysts"],
                "learning_note": "When model context is unavailable, keep observations descriptive and avoid directional conclusions.",
                "risk_note": "No trade action should be inferred from fallback analysis.",
                "confidence": 0.0,
                "not_financial_advice": True,
            }
        return self._sanitize_observation(symbol, ta_data, observation)

    def _build_prompt(self, symbol: str, ta: Dict, news: List[Dict], portfolio: Dict, history: List[Dict]) -> str:
        """Construct the analysis prompt."""
        news_text = "\n".join([f"- {n['title']} ({n['source']})" for n in news[:5]])
        history_text = "\n".join([f"- {h['timestamp']}: {h['action']} {h['symbol']} - {h['reasoning'][:50]}" for h in history[:3]])
        
        prompt = f"""
Sen profesyonel bir kripto para alım-satım uzmanısın. Aşağıdaki verileri analiz et ve {symbol} için bir karar ver.

### PIYASA VERILERI ({symbol}):
{ta['summary']}
Detaylar: RSI={ta['rsi']}, Trend={ta['trend']}, MACD={ta['macd_signal']}, BB={ta['bb_position']}

### SON HABERLER:
{news_text if news_text else "Yeni haber yok."}

### PORTFÖY DURUMU:
Bakiye: {portfolio['balance']} USDT
Açık Pozisyonlar: {portfolio['positions']}

### GEÇMIŞ KARARLAR:
{history_text if history_text else "Geçmiş kayıt yok."}

### GÖREV:
Bu verileri değerlendirerek bir karar ver (BUY, SELL, HOLD veya NO TRADE).
Kararın rasyonel, teknik verilere ve haber duyarlılığına dayalı olmalıdır.
Sinyal zayıfsa, veri eksikse veya risk/ödül net değilse NO TRADE geçerli ve tercih edilen karardır.
Risk yöneticisi bu kararı veto edebilir; kâr garantisi yoktur.
Yanıtını SADECE aşağıdaki JSON formatında ver:

{{
    "action": "BUY" | "SELL" | "HOLD" | "NO TRADE",
    "symbol": "{symbol}",
    "confidence": 0.0 ile 1.0 arası skor,
    "reasoning": "Kararının detaylı teknik ve temel gerekçesi",
    "expected_move": "Kısa vadeli beklenen hareket açıklaması"
}}
"""
        return prompt

    def _build_observer_prompt(self, symbol: str, ta: Dict, news: List[Dict], previous_observations: List[Dict]) -> str:
        news_text = "\n".join([f"- {n.get('title')} ({n.get('source')})" for n in news[:5]])
        previous_text = "\n".join([
            f"- {o.get('timestamp', '')}: {o.get('market_regime', '')}, {o.get('trend', '')}, {str(o.get('learning_note', ''))[:80]}"
            for o in previous_observations[:3]
        ])
        return f"""
Sen E.D.I.T.H. Crypto Market Observer modundasın. Görevin işlem kararı üretmek değil, piyasada ne olduğunu öğrenme amacıyla açıklamaktır.

Kesin kurallar:
- BUY/SELL/HOLD kararı verme.
- Emir, pozisyon açma/kapama veya işlem talimatı yazma.
- Kâr vaadi veya piyasa tahmini iddiası üretme.
- Çıktı öğrenme notudur, finansal tavsiye değildir.

### PIYASA VERILERI ({symbol}):
{ta.get('summary', '')}
Detaylar: RSI={ta.get('rsi')}, Trend={ta.get('trend')}, MACD={ta.get('macd_signal')}, BB={ta.get('bb_position')}, ATR={ta.get('atr')}, VWAP={ta.get('vwap')}

### SON HABERLER:
{news_text if news_text else "Yeni haber yok."}

### ÖNCEKI GÖZLEMLER:
{previous_text if previous_text else "Önceki gözlem yok."}

### GÖREV:
Bu piyasada ne olduğunu ve ne öğrenilebileceğini analiz et. Şunları değerlendir:
trend direction, volatility, volume behavior, RSI/MACD/EMA/Bollinger/ATR/VWAP context, news context, market regime, uncertainty, what changed since last snapshot, possible scenarios, what to watch next, what was learned.

Allowed analysis labels:
bullish_bias, bearish_bias, neutral, range, volatile, uncertain, accumulation_possible, distribution_possible, breakout_watch, breakdown_watch

Forbidden execution labels:
BUY_NOW, SELL_NOW, EXECUTE_TRADE, OPEN_POSITION, CLOSE_POSITION

Yanıtını SADECE şu JSON formatında ver:
{{
  "symbol": "{symbol}",
  "mode": "OBSERVER_ONLY",
  "market_regime": "range | volatile | uncertain | breakout_watch | breakdown_watch | neutral",
  "trend": "bullish_bias | bearish_bias | neutral | uncertain",
  "volatility": "low | medium | high | uncertain",
  "volume_context": "hacim davranışı",
  "technical_summary": "teknik özet",
  "news_context": "haber bağlamı",
  "what_changed": "önceki gözleme göre değişim",
  "what_to_watch_next": ["izlenecek unsur"],
  "learning_note": "öğrenme notu",
  "risk_note": "risk/Belirsizlik notu",
  "confidence": 0.0,
  "not_financial_advice": true
}}
"""

    def _sanitize_observation(self, symbol: str, ta_data: Dict, observation: Dict[str, Any]) -> Dict[str, Any]:
        safe = dict(observation or {})
        safe["symbol"] = symbol
        safe["mode"] = "OBSERVER_ONLY"
        for key in ("market_regime", "trend"):
            value = str(safe.get(key) or "uncertain")
            if value.upper() in FORBIDDEN_OBSERVER_LABELS or value not in ALLOWED_OBSERVER_LABELS:
                safe[key] = "uncertain" if key == "market_regime" else ta_data.get("trend", "neutral")
        text_fields = ["volume_context", "technical_summary", "news_context", "what_changed", "learning_note", "risk_note"]
        for key in text_fields:
            value = str(safe.get(key) or "")
            for forbidden in FORBIDDEN_OBSERVER_LABELS:
                value = value.replace(forbidden, "[redacted_execution_label]")
            safe[key] = value
        watch = safe.get("what_to_watch_next")
        if not isinstance(watch, list):
            watch = [str(watch)] if watch else []
        safe["what_to_watch_next"] = [str(item) for item in watch][:8]
        try:
            safe["confidence"] = max(0.0, min(1.0, float(safe.get("confidence", 0.0) or 0.0)))
        except (TypeError, ValueError):
            safe["confidence"] = 0.0
        safe["not_financial_advice"] = True
        safe.setdefault("technical_summary", ta_data.get("summary", ""))
        safe.setdefault("risk_note", "Learning note only; no trading action is authorized.")
        return safe
