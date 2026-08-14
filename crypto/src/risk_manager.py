"""
Risk Manager for the Autonomous Crypto Trading Agent.
Evaluates if a trade decision complies with risk management rules.
"""
import logging
from typing import Dict, List, Any, Tuple, Optional

from config import CONFIG

logger = logging.getLogger("risk_manager")

class RiskManager:
    def __init__(self):
        self.max_pos_pct = CONFIG.MAX_POSITION_PCT
        self.max_open_positions = CONFIG.MAX_OPEN_POSITIONS
        self.stop_loss_pct = CONFIG.STOP_LOSS_PCT
        self.take_profit_pct = CONFIG.TAKE_PROFIT_PCT

    def validate_trade(
        self, 
        action: str, 
        symbol: str, 
        current_price: float, 
        balance: float, 
        open_positions: List[Dict]
    ) -> Tuple[bool, str, Dict[str, Any]]:
        """
        Validates if a trade should be executed based on risk rules.
        Returns (is_valid, reason, trade_params).
        """
        if action == "HOLD":
            return True, "No action required", {}

        # 1. Check max open positions
        if action == "BUY":
            # Check if already holding this symbol
            if any(p['symbol'] == symbol for p in open_positions):
                return False, f"Already holding {symbol}", {}
            
            if len(open_positions) >= self.max_open_positions:
                return False, f"Max open positions ({self.max_open_positions}) reached", {}

            # 2. Calculate position size
            max_cost = balance * self.max_pos_pct
            amount = max_cost / current_price
            
            # 3. Calculate SL and TP
            stop_loss = current_price * (1 - self.stop_loss_pct)
            take_profit = current_price * (1 + self.take_profit_pct)
            
            trade_params = {
                "amount": amount,
                "cost": max_cost,
                "stop_loss": stop_loss,
                "take_profit": take_profit
            }
            
            return True, "Risk validation passed", trade_params

        elif action == "SELL":
            # Check if holding this symbol
            position = next((p for p in open_positions if p['symbol'] == symbol), None)
            if not position:
                return False, f"No open position for {symbol} to sell", {}
            
            trade_params = {
                "amount": position['amount'],
                "cost": position['amount'] * current_price
            }
            return True, "Risk validation passed", trade_params

        return False, f"Unknown action: {action}", {}

    def check_sl_tp(self, symbol: str, current_price: float, position: Dict) -> Optional[str]:
        """
        Checks if a position should be closed due to Stop-Loss or Take-Profit.
        Returns "SELL" if trigger hit, else None.
        """
        sl = position.get('stop_loss')
        tp = position.get('take_profit')
        
        if sl and current_price <= sl:
            logger.info(f"Stop-Loss hit for {symbol} at {current_price} (SL: {sl})")
            return "SELL"
            
        if tp and current_price >= tp:
            logger.info(f"Take-Profit hit for {symbol} at {current_price} (TP: {tp})")
            return "SELL"
            
        return None
