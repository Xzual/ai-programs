"""
Main Agent Orchestrator for the Autonomous Crypto Trading Agent.
Coordinates all modules and runs the main loop.
"""
import time
import logging
import threading
from datetime import datetime

from config import CONFIG
from market_data import MarketDataFetcher
from technical_analysis import TechnicalAnalyzer
from memory_manager import MemoryManager
from news_collector import NewsCollector
from risk_manager import RiskManager
from paper_trading_engine import PaperTradingEngine
from llm_decision_engine import LLMDecisionEngine
from result_analyzer import ResultAnalyzer

# Setup logging — ensure log dir exists before FileHandler
import os as _os
_os.makedirs(CONFIG.LOG_DIR, exist_ok=True)
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(f"{CONFIG.LOG_DIR}/agent.log", encoding='utf-8'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger("agent_orchestrator")

class CryptoAgent:
    def __init__(self):
        logger.info("Initializing Autonomous Crypto Trading Agent...")
        
        self.memory = MemoryManager()
        self.market_data = MarketDataFetcher()
        self.ta = TechnicalAnalyzer()
        self.news = NewsCollector(self.memory)
        self.risk = RiskManager()
        self.paper_trading = PaperTradingEngine(self.memory)
        self.llm = LLMDecisionEngine()
        self.analyzer = ResultAnalyzer(self.memory, self.llm)
        
        self.is_running = False

    def run_cycle(self):
        """A single execution cycle of the agent."""
        logger.info("--- Starting Agent Cycle ---")
        
        try:
            # 1. Collect News
            recent_news = self.news.collect_all()
            
            # 2. Process each symbol in watchlist
            current_prices = {}
            watchlist = CONFIG.WATCHLIST
            
            for symbol in watchlist:
                logger.info(f"Processing {symbol}...")
                
                # A. Fetch Market Data & TA
                df = self.market_data.fetch_ohlcv(symbol, timeframe="1h", limit=100)
                if df is None: continue
                
                ta_results = self.ta.analyze(df)
                if not ta_results: continue
                
                price = ta_results['close']
                current_prices[symbol] = price
                
                # B. Save snapshot
                self.memory.save_market_snapshot(symbol, price, ta_results)
                
                # C. Check for SL/TP on open positions
                open_positions = self.paper_trading.get_open_positions()
                pos = next((p for p in open_positions if p['symbol'] == symbol), None)
                
                if pos:
                    exit_signal = self.risk.check_sl_tp(symbol, price, pos)
                    if exit_signal == "SELL":
                        logger.info(f"SL/TP triggered for {symbol}. Executing SELL.")
                        self.paper_trading.execute_trade(symbol, "SELL", pos['amount'], price, pos['decision_id'])
                        # Analyze outcome
                        self.analyzer.analyze_trade_outcome({
                            "symbol": symbol,
                            "pnl": (price - pos['entry_price']) * pos['amount'],
                            "reasoning": "SL/TP Triggered"
                        })
                        continue

                # D. Get LLM Decision
                history = self.memory.get_recent_decisions(limit=5)
                portfolio = {
                    "balance": self.paper_trading.get_balance(),
                    "positions": self.paper_trading.get_open_positions()
                }
                
                decision = self.llm.get_decision(symbol, ta_results, recent_news, portfolio, history)
                if not decision: continue
                
                action = decision.get("action", "HOLD").strip().upper()
                reasoning = decision.get("reasoning", "")
                confidence = decision.get("confidence", 0)
                
                # E. Risk Validation & Execution
                is_valid, risk_reason, trade_params = self.risk.validate_trade(
                    action, symbol, price, portfolio['balance'], open_positions
                )
                
                if is_valid and action != "HOLD":
                    decision_id = self.memory.save_decision(symbol, action, confidence, reasoning, ta_results)
                    
                    pos_to_close = None
                    if action == "SELL":
                        pos_to_close = next((p for p in open_positions if p['symbol'] == symbol), None)
                        
                    success = self.paper_trading.execute_trade(
                        symbol, action, trade_params['amount'], price, decision_id,
                        sl=trade_params.get('stop_loss'),
                        tp=trade_params.get('take_profit')
                    )
                    
                    if success and action == "SELL" and pos_to_close:
                        pnl = (price - pos_to_close['entry_price']) * pos_to_close['amount']
                        self.analyzer.analyze_trade_outcome({
                            "symbol": symbol,
                            "pnl": pnl,
                            "reasoning": f"LLM Decision SELL: {reasoning}"
                        })
                else:
                    if action != "HOLD":
                        logger.info(f"Trade rejected by Risk Manager: {risk_reason}")
                    self.memory.save_decision(symbol, "HOLD (REJECTED)" if action != "HOLD" else "HOLD", confidence, reasoning, ta_results)

            # F. Save portfolio state every cycle (feeds dashboard equity chart)
            balance  = self.paper_trading.get_balance()
            equity   = self.paper_trading.get_total_equity(current_prices)
            positions = self.paper_trading.get_open_positions()
            self.memory.update_portfolio(balance, equity, positions)
            
            logger.info("--- Cycle Finished ---")
            
        except Exception as e:
            logger.error(f"Error in agent cycle: {e}", exc_info=True)

    def start(self):
        """Start the continuous loop."""
        self.is_running = True
        logger.info(f"Agent started. Loop interval: {CONFIG.LOOP_INTERVAL_MINUTES} minutes.")
        
        while self.is_running:
            self.run_cycle()
            logger.info(f"Sleeping for {CONFIG.LOOP_INTERVAL_MINUTES} minutes...")
            time.sleep(CONFIG.LOOP_INTERVAL_MINUTES * 60)

    def stop(self):
        self.is_running = False
        logger.info("Agent stopping...")

if __name__ == "__main__":
    agent = CryptoAgent()
    agent.start()
