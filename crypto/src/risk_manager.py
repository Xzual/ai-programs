"""
Risk Manager for the Autonomous Crypto Trading Agent.
Evaluates if a trade decision complies with risk management rules.
"""
import logging
from typing import Dict, List, Any, Tuple, Optional

from config import CONFIG
from coin_permissions import CoinPermissionManager

logger = logging.getLogger("risk_manager")

class RiskManager:
    def __init__(self, permission_manager: CoinPermissionManager = None):
        self.max_pos_pct = CONFIG.MAX_POSITION_PCT
        self.max_open_positions = CONFIG.MAX_OPEN_POSITIONS
        self.stop_loss_pct = CONFIG.STOP_LOSS_PCT
        self.take_profit_pct = CONFIG.TAKE_PROFIT_PCT
        self.permissions = permission_manager or CoinPermissionManager()

    def validate_trade(
        self, 
        action: str, 
        symbol: str, 
        current_price: float, 
        balance: float, 
        open_positions: List[Dict],
        permission_profile: Dict[str, Any] = None,
        execution_mode: str = None,
    ) -> Tuple[bool, str, Dict[str, Any]]:
        """
        Validates if a trade should be executed based on risk rules.
        Returns (is_valid, reason, trade_params).
        """
        action = (action or "HOLD").strip().upper().replace("_", " ")
        symbol = self.permissions.normalize_symbol(symbol)
        execution_mode = (execution_mode or CONFIG.TRADING_MODE).strip().upper()
        if execution_mode == "PAPER":
            execution_mode = "PAPER_TRADING"
        permission_profile = permission_profile or self.permissions.get_profile(symbol)

        if action in ("HOLD", "NO TRADE"):
            return True, "No action required", {}

        if action not in CONFIG.ALLOWED_ACTIONS:
            return False, "RISK_REJECTED", {"details": f"Unknown action: {action}"}

        permission_ok, permission_code = self._validate_permission(action, permission_profile, execution_mode)
        if not permission_ok:
            return False, permission_code, {"permission_profile": permission_profile}

        if not current_price or current_price <= 0:
            return False, "RISK_REJECTED", {"details": f"Invalid current price for {symbol}: {current_price}"}

        if balance < 0:
            return False, "RISK_REJECTED", {"details": f"Invalid negative balance: {balance}"}

        # 1. Check max open positions
        if action == "BUY":
            # Check if already holding this symbol
            if any(p['symbol'] == symbol for p in open_positions):
                return False, "RISK_REJECTED", {"details": f"Already holding {symbol}"}
            
            if len(open_positions) >= self.max_open_positions:
                return False, "RISK_REJECTED", {"details": f"Max open positions ({self.max_open_positions}) reached"}

            # 2. Calculate position size
            max_cost = balance * self.max_pos_pct
            profile_max_position = float(permission_profile.get("maxPositionUSDT", 0) or 0)
            if profile_max_position > 0:
                max_cost = min(max_cost, profile_max_position)

            portfolio_value = balance + sum(
                float(p.get("amount", 0) or 0) * float(p.get("entry_price", 0) or 0)
                for p in open_positions
            )
            allocation_pct = float(permission_profile.get("maxPortfolioAllocationPct", 0) or 0)
            if allocation_pct > 0 and portfolio_value > 0:
                max_cost = min(max_cost, portfolio_value * (allocation_pct / 100.0))

            if max_cost <= 0:
                return False, "MAX_POSITION_EXCEEDED", {"permission_profile": permission_profile}

            if max_cost > balance:
                return False, "MAX_PORTFOLIO_ALLOCATION_EXCEEDED", {"permission_profile": permission_profile}

            amount = max_cost / current_price
            
            # 3. Calculate SL and TP
            stop_loss = current_price * (1 - self.stop_loss_pct)
            take_profit = current_price * (1 + self.take_profit_pct)
            
            trade_params = {
                "amount": amount,
                "cost": max_cost,
                "stop_loss": stop_loss,
                "take_profit": take_profit,
                "permission_profile": permission_profile,
            }
            
            return True, "Risk validation passed", trade_params

        elif action == "SELL":
            # Check if holding this symbol
            position = next((p for p in open_positions if p['symbol'] == symbol), None)
            if not position:
                return False, "RISK_REJECTED", {"details": f"No open position for {symbol} to sell"}
            
            trade_params = {
                "amount": position['amount'],
                "cost": position['amount'] * current_price,
                "permission_profile": permission_profile,
            }
            return True, "Risk validation passed", trade_params

        return False, "RISK_REJECTED", {"details": f"Unknown action: {action}"}

    def validate_symbol_access(self, symbol: str) -> Tuple[bool, str, Dict[str, Any]]:
        profile = self.permissions.get_profile(symbol)
        if not profile.get("watchEnabled"):
            reason = "CATEGORY_BLOCKED" if profile.get("_blockedByCategory") else "SYMBOL_BLOCKED"
            return False, reason, profile
        return True, "WATCH_ENABLED", profile

    def _validate_permission(self, action: str, profile: Dict[str, Any], execution_mode: str) -> Tuple[bool, str]:
        if not profile.get("watchEnabled"):
            return False, "CATEGORY_BLOCKED" if profile.get("_blockedByCategory") else "SYMBOL_BLOCKED"
        if not profile.get("decisionEnabled"):
            return False, "DECISION_DISABLED"
        if profile.get("requiresApproval"):
            return False, "APPROVAL_REQUIRED"
        if execution_mode == "PAPER_TRADING":
            if not profile.get("paperTradingEnabled"):
                return False, "PAPER_TRADING_DISABLED"
        elif execution_mode in ("LIVE", "LIVE_TRADING_LOCKED"):
            if not profile.get("liveTradingEnabled"):
                return False, "LIVE_TRADING_DISABLED"
            return False, "LIVE_TRADING_DISABLED"
        else:
            return False, "RISK_REJECTED"
        return True, "APPROVED"

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
        if CONFIG.live_trading_active:
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
