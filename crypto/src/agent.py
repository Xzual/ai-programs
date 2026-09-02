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
from coin_permissions import CoinPermissionManager
from obsidian_exporter import ObsidianMarketExporter

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
        if CONFIG.TRADING_MODE in ("READ_ONLY_ACCOUNT", "LIVE_TRADING_LOCKED"):
            raise RuntimeError("CryptoAgent does not execute account or live trading modes. Live trading is blocked.")
        
        self.memory = MemoryManager()
        self.permissions = CoinPermissionManager()
        self.market_data = MarketDataFetcher()
        self.ta = TechnicalAnalyzer()
        self.news = NewsCollector(self.memory)
        self.risk = RiskManager(self.permissions)
        self.paper_trading = PaperTradingEngine(self.memory)
        self.llm = LLMDecisionEngine()
        self.analyzer = ResultAnalyzer(self.memory, self.llm)
        self.obsidian = ObsidianMarketExporter(enabled=self.permissions.get_observer_config().get("obsidianExportEnabled"))
        
        self.is_running = False
        self.llm_available = True

    def _fallback_market_observation(self, symbol, ta_results, reason):
        return {
            "symbol": symbol,
            "mode": "OBSERVER_ONLY",
            "market_regime": "uncertain",
            "trend": ta_results.get("trend", "neutral"),
            "volatility": "uncertain",
            "volume_context": "Market data was collected without LLM synthesis.",
            "technical_summary": ta_results.get("summary", ""),
            "news_context": "LLM analysis skipped.",
            "what_changed": "No model-based comparison was produced.",
            "what_to_watch_next": ["fresh candles", "volume expansion", "news catalysts"],
            "learning_note": f"Market-data-only observer note. Reason: {reason}",
            "risk_note": "Learning note only; no trading action is authorized.",
            "confidence": 0.0,
            "not_financial_advice": True,
        }

    def run_cycle(self):
        """A single execution cycle of the agent."""
        logger.info("--- Starting Agent Cycle ---")
        
        try:
            # 1. Collect News
            recent_news = self.news.collect_all()
            
            # 2. Process each symbol in watchlist
            current_prices = {}
            watchlist = self.permissions.get_watchlist()
            
            for symbol in watchlist:
                if getattr(self, "_stop_requested", None) and self._stop_requested():
                    logger.info("Stop requested; ending cycle at safe checkpoint before next symbol.")
                    break
                if getattr(self, "_pause_wait", None):
                    self._pause_wait()
                    if getattr(self, "_stop_requested", None) and self._stop_requested():
                        logger.info("Stop requested while paused; ending cycle.")
                        break
                if getattr(self, "_set_current_symbol", None):
                    self._set_current_symbol(symbol)

                can_watch, watch_reason, permission_profile = self.risk.validate_symbol_access(symbol)
                if not can_watch:
                    logger.info(f"Skipping {symbol}: {watch_reason}")
                    self.memory.save_permission_event(symbol, permission_profile, watch_reason)
                    continue

                logger.info(f"Processing {symbol}...")
                
                # A. Fetch Market Data & TA
                df = self.market_data.fetch_ohlcv(symbol, timeframe="1h", limit=100)
                if df is None: continue
                
                ta_results = self.ta.analyze(df)
                if not ta_results: continue
                
                price = ta_results['close']
                current_prices[symbol] = price
                
                # B. Save snapshot
                self.memory.save_market_snapshot(
                    symbol,
                    price,
                    ta_results,
                    permission_profile=permission_profile,
                    permission_status="WATCH_ENABLED",
                )

                if CONFIG.TRADING_MODE == "OBSERVER_ONLY":
                    observer_config = self.permissions.get_observer_config()
                    if not observer_config.get("analysisEnabled", True):
                        self.memory.save_permission_event(
                            symbol,
                            permission_profile,
                            "ANALYSIS_DISABLED",
                            event_type="OBSERVER_SKIPPED_ANALYSIS",
                        )
                        logger.info(f"Observer analysis disabled for {symbol}; market snapshot saved only.")
                        continue
                    if not getattr(self, "llm_available", True):
                        observation = self._fallback_market_observation(symbol, ta_results, "OLLAMA_OFFLINE")
                    else:
                        previous = self.memory.get_recent_observations(symbol=symbol, limit=3)
                        observation = self.llm.get_market_observation(symbol, ta_results, recent_news, previous)
                    export_result = self.obsidian.export_observation(observation)
                    self.memory.save_market_observation(
                        observation,
                        obsidian_exported=export_result.get("status") == "exported",
                        obsidian_path=export_result.get("last_export_path"),
                    )
                    self.memory.save_analysis_log(
                        "MARKET_OBSERVATION",
                        observation.get("learning_note", ""),
                        {
                            "symbol": symbol,
                            "mode": "OBSERVER_ONLY",
                            "obsidian_status": export_result.get("status"),
                            "not_financial_advice": True,
                        },
                    )
                    logger.info(f"Observer-only analysis saved for {symbol}; no trading execution.")
                    if getattr(self, "_mark_observation", None):
                        self._mark_observation(symbol)
                    continue

                if not permission_profile.get("decisionEnabled"):
                    logger.info(f"Watch-only symbol {symbol}; skipping LLM and execution.")
                    self.memory.save_decision(
                        symbol,
                        "WATCH_ONLY",
                        0,
                        "Decision disabled by coin permission profile.",
                        {**ta_results, "permission_profile": permission_profile},
                        risk_status="WATCH_ONLY",
                        risk_reason="DECISION_DISABLED",
                    )
                    continue
                
                # C. Check for SL/TP on open positions
                open_positions = self.paper_trading.get_open_positions()
                pos = next((p for p in open_positions if p['symbol'] == symbol), None)
                
                if pos:
                    exit_signal = self.risk.check_sl_tp(symbol, price, pos)
                    if exit_signal == "SELL":
                        is_valid_exit, exit_reason, exit_params = self.risk.validate_trade(
                            "SELL", symbol, price, self.paper_trading.get_balance(),
                            open_positions, permission_profile=permission_profile, execution_mode="PAPER_TRADING"
                        )
                        if is_valid_exit:
                            logger.info(f"SL/TP triggered for {symbol}. Executing paper SELL.")
                            self.paper_trading.execute_trade(symbol, "SELL", pos['amount'], price, pos['decision_id'])
                            self.analyzer.analyze_trade_outcome({
                                "symbol": symbol,
                                "pnl": (price - pos['entry_price']) * pos['amount'],
                                "reasoning": "SL/TP Triggered"
                            })
                        else:
                            logger.info(f"SL/TP exit vetoed for {symbol}: {exit_reason}")
                            self.memory.save_decision(
                                symbol,
                                "SELL (REJECTED)",
                                0,
                                "SL/TP exit blocked by permission or risk policy.",
                                {**ta_results, "permission_profile": permission_profile},
                                risk_status="REJECTED",
                                risk_reason=exit_reason,
                            )
                        continue

                # D. Get LLM Decision
                history = self.memory.get_recent_decisions(limit=5)
                portfolio = {
                    "balance": self.paper_trading.get_balance(),
                    "positions": self.paper_trading.get_open_positions()
                }
                
                decision = self.llm.get_decision(symbol, ta_results, recent_news, portfolio, history)
                if not decision: continue
                
                action = decision.get("action", "HOLD").strip().upper().replace("_", " ")
                if action not in CONFIG.ALLOWED_ACTIONS:
                    logger.warning(f"Unsupported LLM action for {symbol}: {action}. Falling back to NO TRADE.")
                    action = "NO TRADE"
                reasoning = decision.get("reasoning", "")
                confidence = decision.get("confidence", 0)
                
                # E. Risk Validation & Execution
                is_valid, risk_reason, trade_params = self.risk.validate_trade(
                    action, symbol, price, portfolio['balance'], open_positions,
                    permission_profile=permission_profile,
                    execution_mode="PAPER_TRADING",
                )
                
                if is_valid and action not in ("HOLD", "NO TRADE"):
                    decision_id = self.memory.save_decision(
                        symbol, action, confidence, reasoning,
                        {**ta_results, "permission_profile": permission_profile},
                        risk_status="APPROVED",
                        risk_reason=risk_reason,
                    )
                    
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
                    if action not in ("HOLD", "NO TRADE"):
                        logger.info(f"Trade rejected by Risk Manager: {risk_reason}")
                    saved_action = "NO TRADE" if action == "NO TRADE" else "HOLD"
                    if action not in ("HOLD", "NO TRADE"):
                        saved_action = f"{action} (REJECTED)"
                    self.memory.save_decision(
                        symbol, saved_action, confidence, reasoning,
                        {**ta_results, "permission_profile": permission_profile},
                        risk_status="REJECTED" if action not in ("HOLD", "NO TRADE") else "NO_ACTION",
                        risk_reason=risk_reason,
                    )
                    if action not in ("HOLD", "NO TRADE"):
                        self.memory.save_permission_event(symbol, permission_profile, risk_reason, event_type="RISK_VETO")

            # F. Save portfolio state only in explicit paper mode.
            if CONFIG.TRADING_MODE == "PAPER_TRADING":
                balance  = self.paper_trading.get_balance()
                equity   = self.paper_trading.get_total_equity(current_prices)
                positions = self.paper_trading.get_open_positions()
                self.memory.update_portfolio(balance, equity, positions)
            
            logger.info("--- Cycle Finished ---")
            
        except Exception as e:
            logger.error(f"Error in agent cycle: {e}", exc_info=True)

    def start(self, stop_event=None, pause_event=None, runtime=None):
        """Start the continuous loop."""
        self.is_running = True
        self._stop_requested = stop_event.is_set if stop_event else (lambda: not self.is_running)
        self._set_current_symbol = runtime.set_current_symbol if runtime else None
        self._mark_observation = runtime.mark_observation if runtime else None

        def _pause_wait():
            if not pause_event:
                return
            while pause_event.is_set() and not self._stop_requested():
                if runtime:
                    runtime.set_state("PAUSED")
                time.sleep(0.5)
            if runtime and not self._stop_requested():
                runtime.set_state("OBSERVING")

        self._pause_wait = _pause_wait
        logger.info(f"Agent started. Loop interval: {CONFIG.LOOP_INTERVAL_MINUTES} minutes.")
        
        while self.is_running and not self._stop_requested():
            _pause_wait()
            if self._stop_requested():
                break
            self.run_cycle()
            logger.info(f"Sleeping for {CONFIG.LOOP_INTERVAL_MINUTES} minutes...")
            total_seconds = int(CONFIG.LOOP_INTERVAL_MINUTES * 60)
            for _ in range(max(total_seconds, 1)):
                if self._stop_requested():
                    break
                _pause_wait()
                time.sleep(1)

    def stop(self):
        self.is_running = False
        logger.info("Agent stopping...")

if __name__ == "__main__":
    agent = CryptoAgent()
    agent.start()
