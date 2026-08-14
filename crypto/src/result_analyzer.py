"""
Result Analyzer for the Autonomous Crypto Trading Agent.
Analyzes closed trades and provides feedback for self-improvement.
"""
import logging
import json
from typing import Dict, Any, List

from memory_manager import MemoryManager
from llm_decision_engine import LLMDecisionEngine

logger = logging.getLogger("result_analyzer")

class ResultAnalyzer:
    def __init__(self, memory: MemoryManager, llm: LLMDecisionEngine):
        self.memory = memory
        self.llm = llm

    def analyze_trade_outcome(self, trade_data: Dict[str, Any]):
        """
        Analyze a closed trade and store findings in memory.
        This is called when a position is closed.
        """
        symbol = trade_data.get('symbol')
        pnl = trade_data.get('pnl', 0)
        
        prompt = f"""
Bir sanal işlem sonuçlandı. Bu işlemin performansını analiz et ve gelecekteki kararları iyileştirmek için dersler çıkar.

IŞLEM DETAYLARI:
Sembol: {symbol}
Kâr/Zarar: {pnl} USDT
Giriş Nedeni: {trade_data.get('reasoning', 'Bilinmiyor')}

GÖREV:
Bu işlemin neden başarılı veya başarısız olduğunu analiz et. Piyasa koşullarını ve LLM'in önceki mantığını değerlendir.
Yanıtını SADECE şu JSON formatında ver:
{{
    "analysis": "İşlem sonucu hakkında detaylı analiz",
    "lesson_learned": "Bu işlemden çıkarılan temel ders",
    "strategy_adjustment": "Gelecekte neyin farklı yapılması gerektiği"
}}
"""
        try:
            # Reusing LLM engine's capability to call Ollama
            payload = {
                "model": self.llm.model,
                "prompt": prompt,
                "stream": False,
                "format": "json"
            }
            import requests
            from config import CONFIG
            
            response = requests.post(f"{CONFIG.OLLAMA_HOST}/api/generate", json=payload, timeout=60)
            analysis = json.loads(response.json().get("response", "{}"))
            
            # Save to memory
            self.memory.save_analysis_log(
                log_type="TRADE_ANALYSIS",
                content=analysis.get("analysis", ""),
                meta_data={
                    "symbol": symbol,
                    "pnl": pnl,
                    "lesson": analysis.get("lesson_learned", ""),
                    "adjustment": analysis.get("strategy_adjustment", "")
                }
            )
            logger.info(f"Trade analysis completed for {symbol}. Lesson: {analysis.get('lesson_learned')}")
            
        except Exception as e:
            logger.error(f"Error analyzing trade outcome: {e}")
