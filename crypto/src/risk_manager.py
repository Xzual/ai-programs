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
        action = (action or "HOLD").strip().upper().replace("_", " ")
        if action in ("HOLD", "NO TRADE"):
            return True, "No action required", {}

        if action not in CONFIG.ALLOWED_ACTIONS:
            return False, f"Unknown action: {action}", {}

        if CONFIG.TRADING_MODE == "LIVE":
            return False, "LIVE mode is disabled: no reviewed live execution path exists", {}

        if not current_price or current_price <= 0:
            return False, f"Invalid current price for {symbol}: {current_price}", {}

        if balance < 0:
            return False, f"Invalid negative balance: {balance}", {}

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

    def summarize_portfolio_risk(
        self,
        balance: float,
        equity: float,
        open_positions: List[Dict],
        drawdown_pct: float = 0.0,
    ) -> Dict[str, Any]:
        """Return a UI-safe portfolio risk summary without making trade decisions."""
        equity = float(equity or 0)
        total_exposure = 0.0
        positions = []
        for pos in open_positions or []:
            amount = float(pos.get("amount", 0) or 0)
            entry = float(pos.get("entry_price", 0) or 0)
            value = amount * entry
            total_exposure += value
            positions.append({
                "symbol": pos.get("symbol"),
                "amount": amount,
                "entry_price": entry,
                "value": round(value, 2),
                "stop_loss": pos.get("stop_loss"),
                "take_profit": pos.get("take_profit"),
            })

        exposure_ratio = (total_exposure / equity * 100) if equity > 0 else 0.0
        alerts = []
        if CONFIG.TRADING_MODE != "PAPER":
            alerts.append("LIVE mode requested but execution is blocked")
        if drawdown_pct >= 20:
            alerts.append("Portfolio drawdown is above safety threshold")
        if len(positions) >= self.max_open_positions:
            alerts.append("Maximum open-position limit reached")
        if exposure_ratio >= 60:
            alerts.append("Open-position exposure is elevated")
        if not alerts:
            alerts.append("Risk controls are within normal paper-trading limits")

        if exposure_ratio >= 75 or drawdown_pct >= 30:
            risk_level = "High"
        elif exposure_ratio >= 45 or drawdown_pct >= 15:
            risk_level = "Medium"
        else:
            risk_level = "Low"

        return {
            "risk_level": risk_level,
            "drawdown_pct": round(drawdown_pct, 2),
            "open_positions": len(positions),
            "max_open_positions": self.max_open_positions,
            "total_exposure": round(total_exposure, 2),
            "exposure_ratio": round(exposure_ratio, 2),
            "balance": round(float(balance or 0), 2),
            "equity": round(equity, 2),
            "mode": CONFIG.TRADING_MODE,
            "live_trading_active": CONFIG.live_trading_active,
            "risk_engine_can_veto": True,
            "alerts": alerts,
            "positions": positions,
        }

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
