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
