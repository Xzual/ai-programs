"""
100 USD demo portfolio engine.

This is intentionally separate from the legacy paper-trading engine and never
calls exchange order APIs.
"""
import json
import logging
import sqlite3
from datetime import datetime
from typing import Dict, Any, List, Optional

from config import CONFIG

logger = logging.getLogger("demo_portfolio")

DEMO_INITIAL_BALANCE = float(CONFIG.DEMO_INITIAL_BALANCE)


class DemoPortfolioEngine:
    def __init__(self, db_path: str = CONFIG.DB_PATH):
        self.db_path = db_path
        self._init_db()
        self._ensure_initial_state()

    def _connect(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self):
        conn = self._connect()
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS demo_portfolio_state (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                initial_balance REAL NOT NULL,
                cash REAL NOT NULL,
                equity REAL NOT NULL,
                positions_json TEXT NOT NULL,
                realized_pnl REAL DEFAULT 0,
                unrealized_pnl REAL DEFAULT 0,
                no_trade_count INTEGER DEFAULT 0,
                max_drawdown REAL DEFAULT 0
            )
        """)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS demo_decisions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                symbol TEXT,
                decision TEXT,
                confidence REAL,
                market_regime TEXT,
                trend TEXT,
                volatility TEXT,
                news_sentiment TEXT,
                technical_summary TEXT,
                news_summary TEXT,
                risk_summary TEXT,
                decision_reason TEXT,
                invalidation_condition TEXT,
                time_horizon TEXT,
                model_used TEXT,
                entry_price REAL,
                position_size REAL,
                stop_loss REAL,
                take_profit REAL,
                risk_amount REAL,
                risk_reward REAL,
                exit_condition TEXT,
                risk_status TEXT,
                risk_reason TEXT,
                asset_mode TEXT,
                raw_json TEXT
            )
        """)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS demo_trades (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                decision_id INTEGER,
                symbol TEXT,
                side TEXT,
                price REAL,
                amount REAL,
                cost REAL,
                status TEXT,
                pnl REAL DEFAULT 0,
                reason TEXT,
                mode TEXT DEFAULT 'DEMO'
            )
        """)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS crypto_lessons (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                lesson_type TEXT,
                symbol TEXT,
                title TEXT,
                summary TEXT,
                evidence_json TEXT,
                model_used TEXT
            )
        """)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS demo_loop_settings (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                interval_minutes REAL DEFAULT 0,
                auto_execute_demo_trades INTEGER DEFAULT 0,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)
        cursor.execute(
            """
            INSERT OR IGNORE INTO demo_loop_settings (id, interval_minutes, auto_execute_demo_trades)
            VALUES (1, ?, 0)
            """,
            (CONFIG.LOOP_INTERVAL_MINUTES,),
        )
        conn.commit()
        conn.close()

    def _ensure_initial_state(self):
        if not self.latest_state(raw=True):
            self._save_state(DEMO_INITIAL_BALANCE, DEMO_INITIAL_BALANCE, [], 0.0, 0.0, 0, 0.0)

    def _save_state(self, cash: float, equity: float, positions: List[Dict[str, Any]], realized_pnl: float, unrealized_pnl: float, no_trade_count: int, max_drawdown: float):
        conn = self._connect()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO demo_portfolio_state
                (initial_balance, cash, equity, positions_json, realized_pnl, unrealized_pnl, no_trade_count, max_drawdown)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (DEMO_INITIAL_BALANCE, cash, equity, json.dumps(positions), realized_pnl, unrealized_pnl, no_trade_count, max_drawdown),
        )
        conn.commit()
        conn.close()

    def latest_state(self, raw: bool = False) -> Optional[Dict[str, Any]]:
        conn = self._connect()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM demo_portfolio_state ORDER BY id DESC LIMIT 1")
        row = cursor.fetchone()
        conn.close()
        if not row:
            return None
        data = dict(row)
        data["positions"] = json.loads(data.pop("positions_json") or "[]")
        return data if raw else self.summary()

    def summary(self) -> Dict[str, Any]:
        state = self.latest_state(raw=True) or {}
        positions = state.get("positions", [])
        conn = self._connect()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM demo_trades WHERE status='CLOSED' ORDER BY id DESC")
        closed = [dict(row) for row in cursor.fetchall()]
        cursor.execute("SELECT * FROM demo_trades WHERE status='OPEN' ORDER BY id DESC")
        open_trades = [dict(row) for row in cursor.fetchall()]
        cursor.execute("SELECT COUNT(*) FROM demo_decisions WHERE decision='NO_TRADE'")
        no_trade_count = int(cursor.fetchone()[0] or 0)
        conn.close()
        pnls = [float(trade.get("pnl") or 0.0) for trade in closed]
        wins = [pnl for pnl in pnls if pnl > 0]
        equity = float(state.get("equity") or DEMO_INITIAL_BALANCE)
        exposure = sum(float(pos.get("cost") or 0.0) for pos in positions)
        return {
            "mode": "DEMO",
            "notFinancialAdvice": True,
            "realMoneyUsed": False,
            "liveExecutionEnabled": False,
            "paperTradingEnabled": False,
            "initialBalance": DEMO_INITIAL_BALANCE,
            "currentCash": round(float(state.get("cash") or DEMO_INITIAL_BALANCE), 4),
            "currentEquity": round(equity, 4),
            "openPositions": positions,
            "closedTrades": closed[:50],
            "unrealizedPnl": round(float(state.get("unrealized_pnl") or 0.0), 4),
            "realizedPnl": round(float(state.get("realized_pnl") or sum(pnls)), 4),
            "dailyPnl": round(sum(pnls[-10:]), 4),
            "weeklyPnl": round(sum(pnls[-50:]), 4),
            "winRate": round((len(wins) / len(closed) * 100) if closed else 0.0, 2),
            "numberOfTrades": len(open_trades) + len(closed),
            "numberOfNoTradeDecisions": no_trade_count,
            "maxDrawdown": round(float(state.get("max_drawdown") or 0.0), 4),
            "bestTrade": max(pnls) if pnls else 0.0,
            "worstTrade": min(pnls) if pnls else 0.0,
            "averageTrade": round((sum(pnls) / len(pnls)) if pnls else 0.0, 4),
            "currentExposure": round(exposure, 4),
            "currentExposurePct": round((exposure / equity * 100) if equity > 0 else 0.0, 2),
            "updatedAt": state.get("timestamp"),
        }

    def loop_settings(self) -> Dict[str, Any]:
        conn = self._connect()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM demo_loop_settings WHERE id=1")
        row = cursor.fetchone()
        conn.close()
        interval = float((dict(row) if row else {}).get("interval_minutes") or 0.0)
        return {
            "intervalMinutes": interval,
            "label": "SUREKLI" if interval <= 0 else f"{interval:g} dakika",
            "continuous": interval <= 0,
            "autoExecuteDemoTrades": bool((dict(row) if row else {}).get("auto_execute_demo_trades") or 0),
            "realOrderSent": False,
            "liveExecutionEnabled": False,
            "updatedAt": (dict(row) if row else {}).get("updated_at"),
        }

    def update_loop_settings(self, interval_minutes: Any = None, auto_execute_demo_trades: Any = None) -> Dict[str, Any]:
        current = self.loop_settings()
        try:
            next_interval = float(interval_minutes if interval_minutes is not None else current["intervalMinutes"])
        except (TypeError, ValueError):
            return {"ok": False, "error": "INVALID_INTERVAL"}
        next_interval = max(0.0, min(next_interval, 1440.0))
        next_auto = bool(auto_execute_demo_trades) if auto_execute_demo_trades is not None else current["autoExecuteDemoTrades"]
        conn = self._connect()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO demo_loop_settings (id, interval_minutes, auto_execute_demo_trades, updated_at)
            VALUES (1, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(id) DO UPDATE SET
                interval_minutes=excluded.interval_minutes,
                auto_execute_demo_trades=excluded.auto_execute_demo_trades,
                updated_at=CURRENT_TIMESTAMP
            """,
            (next_interval, int(next_auto)),
        )
        conn.commit()
        conn.close()
        return {"ok": True, "settings": self.loop_settings()}

    def save_decision(self, decision: Dict[str, Any], asset_mode: str, risk_status: str, risk_reason: str) -> int:
        clean_decision = str(decision.get("decision") or decision.get("action") or "NO_TRADE").upper().replace(" ", "_")
        if clean_decision not in {"BUY", "SELL", "HOLD", "NO_TRADE"}:
            clean_decision = "NO_TRADE"
        conn = self._connect()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO demo_decisions (
                symbol, decision, confidence, market_regime, trend, volatility, news_sentiment,
                technical_summary, news_summary, risk_summary, decision_reason, invalidation_condition,
                time_horizon, model_used, entry_price, position_size, stop_loss, take_profit,
                risk_amount, risk_reward, exit_condition, risk_status, risk_reason, asset_mode, raw_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                decision.get("asset") or decision.get("symbol"),
                clean_decision,
                float(decision.get("confidence") or 0.0),
                self._scalar(decision.get("market_regime")),
                self._scalar(decision.get("trend")),
                self._scalar(decision.get("volatility")),
                self._scalar(decision.get("news_sentiment")),
                self._scalar(decision.get("technical_summary")),
                self._scalar(decision.get("news_summary")),
                self._scalar(decision.get("risk_summary")),
                self._scalar(decision.get("decision_reason") or decision.get("reasoning")),
                self._scalar(decision.get("invalidation_condition")),
                self._scalar(decision.get("time_horizon")),
                self._scalar(decision.get("model_used")),
                decision.get("entry_price"),
                decision.get("position_size"),
                decision.get("stop_loss"),
                decision.get("take_profit"),
                decision.get("risk_amount"),
                decision.get("risk_reward"),
                self._scalar(decision.get("exit_condition")),
                self._scalar(risk_status),
                self._scalar(risk_reason),
                self._scalar(asset_mode),
                json.dumps(decision),
            ),
        )
        decision_id = cursor.lastrowid
        conn.commit()
        conn.close()
        if clean_decision == "NO_TRADE":
            state = self.latest_state(raw=True) or {}
            self._save_state(
                float(state.get("cash") or DEMO_INITIAL_BALANCE),
                float(state.get("equity") or DEMO_INITIAL_BALANCE),
                state.get("positions", []),
                float(state.get("realized_pnl") or 0.0),
                float(state.get("unrealized_pnl") or 0.0),
                int(state.get("no_trade_count") or 0) + 1,
                float(state.get("max_drawdown") or 0.0),
            )
        return decision_id

    @staticmethod
    def _scalar(value: Any) -> Any:
        if isinstance(value, (list, dict)):
            return json.dumps(value, ensure_ascii=False)
        return value

    def decisions(self, limit: int = 50) -> List[Dict[str, Any]]:
        conn = self._connect()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM demo_decisions ORDER BY id DESC LIMIT ?", (limit,))
        rows = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return rows

    def trades(self, limit: int = 100) -> List[Dict[str, Any]]:
        conn = self._connect()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM demo_trades ORDER BY id DESC LIMIT ?", (limit,))
        rows = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return rows

    def execute_decision(self, decision_id: int) -> Dict[str, Any]:
        conn = self._connect()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM demo_decisions WHERE id=?", (decision_id,))
        row = cursor.fetchone()
        conn.close()
        if not row:
            return {"ok": False, "error": "DECISION_NOT_FOUND"}
        decision = dict(row)
        side = str(decision.get("decision") or "").upper()
        if side not in {"BUY", "SELL"}:
            return {"ok": False, "error": "DECISION_NOT_EXECUTABLE", "decision": side}
        if decision.get("asset_mode") != "DEMO_TRADE_ALLOWED":
            return {"ok": False, "error": "ASSET_MODE_BLOCKED", "assetMode": decision.get("asset_mode")}
        if decision.get("risk_status") != "APPROVED":
            return {"ok": False, "error": "RISK_VETO", "riskReason": decision.get("risk_reason")}

        state = self.latest_state(raw=True) or {}
        cash = float(state.get("cash") or DEMO_INITIAL_BALANCE)
        positions = state.get("positions", [])
        symbol = decision.get("symbol")
        price = float(decision.get("entry_price") or 0.0)
        cost = min(float(decision.get("position_size") or 0.0), 20.0, cash)
        if price <= 0 or cost <= 0:
            return {"ok": False, "error": "INVALID_DEMO_TRADE_PRICE_OR_SIZE"}
        if side == "BUY":
            amount = cost / price
            position = {
                "symbol": symbol,
                "side": "LONG",
                "entryPrice": price,
                "amount": amount,
                "cost": cost,
                "stopLoss": decision.get("stop_loss"),
                "takeProfit": decision.get("take_profit"),
                "openedAt": datetime.now().isoformat(timespec="seconds"),
                "decisionId": decision_id,
            }
            positions.append(position)
            cash -= cost
            pnl = 0.0
            status = "OPEN"
        else:
            match = next((pos for pos in positions if pos.get("symbol") == symbol), None)
            if not match:
                return {"ok": False, "error": "NO_OPEN_POSITION"}
            amount = float(match.get("amount") or 0.0)
            cost = amount * price
            entry_cost = float(match.get("cost") or 0.0)
            pnl = cost - entry_cost
            cash += cost
            positions = [pos for pos in positions if pos is not match]
            status = "CLOSED"

        realized = float(state.get("realized_pnl") or 0.0) + (pnl if status == "CLOSED" else 0.0)
        equity = cash + sum(float(pos.get("cost") or 0.0) for pos in positions)
        peak = max(DEMO_INITIAL_BALANCE, equity - min(realized, 0.0))
        drawdown = max(0.0, (peak - equity) / peak * 100) if peak > 0 else 0.0
        self._save_state(cash, equity, positions, realized, 0.0, int(state.get("no_trade_count") or 0), drawdown)

        conn = self._connect()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO demo_trades (decision_id, symbol, side, price, amount, cost, status, pnl, reason, mode)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'DEMO')
            """,
            (decision_id, symbol, side, price, amount, cost, status, pnl, decision.get("decision_reason")),
        )
        trade_id = cursor.lastrowid
        conn.commit()
        conn.close()
        self.save_lesson(
            "DEMO_TRADE_OPENED" if status == "OPEN" else "DEMO_TRADE_CLOSED",
            symbol,
            f"{symbol} demo {side} {status}",
            (
                f"Demo trade {side} {status}. Entry/price={price}, cost={round(cost, 4)}, "
                f"PnL={round(pnl, 4)}. Reason: {decision.get('decision_reason') or 'not reported'}"
            ),
            {"decisionId": decision_id, "tradeId": trade_id, "decision": decision, "status": status, "pnl": pnl},
            decision.get("model_used"),
        )
        return {"ok": True, "tradeId": trade_id, "mode": "DEMO", "realOrderSent": False, "portfolio": self.summary()}

    def save_lesson(self, lesson_type: str, symbol: str, title: str, summary: str, evidence: Dict[str, Any], model_used: str = None):
        conn = self._connect()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO crypto_lessons (lesson_type, symbol, title, summary, evidence_json, model_used)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (lesson_type, symbol, title, summary, json.dumps(evidence or {}), model_used),
        )
        conn.commit()
        conn.close()

    def lessons(self, limit: int = 50) -> List[Dict[str, Any]]:
        conn = self._connect()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM crypto_lessons WHERE lesson_type LIKE 'DEMO_TRADE%' ORDER BY id DESC LIMIT ?", (limit,))
        rows = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return rows
