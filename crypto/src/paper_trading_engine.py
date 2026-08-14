"""
Paper Trading Engine for the Autonomous Crypto Trading Agent.
Simulates trades and manages virtual portfolio.
"""
import logging
from typing import List, Dict, Any
from datetime import datetime

from config import CONFIG
from memory_manager import MemoryManager

logger = logging.getLogger("paper_trading")

class PaperTradingEngine:
    def __init__(self, memory: MemoryManager):
        self.memory = memory
        self.balance = CONFIG.INITIAL_BALANCE
        self.positions = [] # List of open position dicts
        self._load_state()

    def _load_state(self):
        """Load latest portfolio state from database."""
        try:
            import sqlite3
            import json
            import math
            conn = sqlite3.connect(self.memory.db_path)
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM portfolio_state ORDER BY id DESC LIMIT 1")
            row = cursor.fetchone()
            conn.close()
            if row:
                balance = float(row['balance_usdt']) if row['balance_usdt'] is not None else CONFIG.INITIAL_BALANCE
                positions_raw = row['positions']
                parsed_positions = []
                if positions_raw:
                    try:
                        parsed_positions = json.loads(positions_raw)
                    except Exception:
                        parsed_positions = []

                if not math.isfinite(balance) or balance <= 0 or balance > 1_000_000_000:
                    logger.warning(f"Invalid saved portfolio balance detected ({balance}). Resetting to initial balance.")
                    self.balance = CONFIG.INITIAL_BALANCE
                    self.positions = []
                else:
                    self.balance = balance
                    self.positions = parsed_positions if isinstance(parsed_positions, list) else []

                logger.info(f"Loaded portfolio state from DB. Balance: {self.balance} USDT, Positions: {len(self.positions)}")
            else:
                self.balance = CONFIG.INITIAL_BALANCE
                self.positions = []
                logger.info(f"No portfolio state in DB. Initializing with {self.balance} USDT")
        except Exception as e:
            self.balance = CONFIG.INITIAL_BALANCE
            self.positions = []
            logger.error(f"Error loading portfolio state: {e}")

    def execute_trade(self, symbol: str, side: str, amount: float, price: float, decision_id: int, sl: float = None, tp: float = None):
        """Execute a virtual trade."""
        cost = amount * price
        
        if side == "BUY":
            if cost > self.balance:
                logger.warning(f"Insufficient balance for {symbol} BUY. Needed: {cost}, Available: {self.balance}")
                return False
            
            self.balance -= cost
            position = {
                "symbol": symbol,
                "amount": amount,
                "entry_price": price,
                "entry_time": datetime.now().isoformat(),
                "stop_loss": sl,
                "take_profit": tp,
                "decision_id": decision_id
            }
            self.positions.append(position)
            logger.info(f"VIRTUAL BUY: {amount} {symbol} at {price}. New Balance: {self.balance}")
            
            # Save trade as OPEN in DB
            self.memory.save_trade(symbol, "BUY", price, amount, cost, decision_id, status='OPEN')
            self.memory.update_portfolio(self.balance, self.get_total_equity({symbol: price}), self.positions)
            return True

        elif side == "SELL":
            position = next((p for p in self.positions if p['symbol'] == symbol), None)
            if not position:
                logger.warning(f"No position to SELL for {symbol}")
                return False
            
            proceeds = amount * price
            pnl = proceeds - (position['entry_price'] * amount)
            self.balance += proceeds
            self.positions.remove(position)
            
            logger.info(f"VIRTUAL SELL: {amount} {symbol} at {price}. PnL: {pnl}. New Balance: {self.balance}")
            
            # Save trade as CLOSED in DB and record PnL (also triggers closing corresponding OPEN BUY)
            self.memory.save_trade(symbol, "SELL", price, amount, proceeds, decision_id, status='CLOSED', pnl=pnl)
            
            self.memory.update_portfolio(self.balance, self.get_total_equity({symbol: price}), self.positions)
            return True

        return False

    def get_total_equity(self, current_prices: Dict[str, float] = None) -> float:
        """Calculate total equity (balance + value of open positions)."""
        equity = self.balance
        if current_prices:
            for pos in self.positions:
                price = current_prices.get(pos['symbol'], pos['entry_price'])
                equity += pos['amount'] * price
        return equity

    def get_open_positions(self) -> List[Dict]:
        return self.positions

    def get_balance(self) -> float:
        return self.balance
