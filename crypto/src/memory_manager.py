"""
Memory Manager for the Autonomous Crypto Trading Agent.
Handles SQLite database operations for market data, news, decisions, trades, and portfolio.
"""
import sqlite3
import json
import logging
from datetime import datetime
from typing import List, Dict, Any, Optional

from config import CONFIG

logger = logging.getLogger("memory_manager")

class MemoryManager:
    def __init__(self, db_path: str = CONFIG.DB_PATH):
        self.db_path = db_path
        self._init_db()

    def _init_db(self):
        """Initialize the database tables if they don't exist."""
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()

            # Market Snapshots
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS market_snapshots (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                    symbol TEXT,
                    price REAL,
                    ta_data TEXT
                )
            ''')

            # News Items
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS news_items (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                    source TEXT,
                    title TEXT,
                    summary TEXT,
                    url TEXT UNIQUE,
                    sentiment TEXT
                )
            ''')

            # Decisions
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS decisions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                    symbol TEXT,
                    action TEXT,
                    confidence REAL,
                    reasoning TEXT,
                    market_context TEXT,
                    mode TEXT DEFAULT 'PAPER',
                    risk_status TEXT,
                    risk_reason TEXT
                )
            ''')

            # Trades
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS trades (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                    symbol TEXT,
                    side TEXT,
                    price REAL,
                    amount REAL,
                    cost REAL,
                    status TEXT,
                    pnl REAL,
                    decision_id INTEGER,
                    mode TEXT DEFAULT 'PAPER',
                    FOREIGN KEY (decision_id) REFERENCES decisions(id)
                )
            ''')

            # Portfolio State
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS portfolio_state (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                    balance_usdt REAL,
                    equity REAL,
                    positions TEXT
                )
            ''')

            # Analysis Logs (Self-improvement)
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS analysis_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                    log_type TEXT,
                    content TEXT,
                    meta_data TEXT
                )
            ''')

            cursor.execute('''
                CREATE TABLE IF NOT EXISTS permission_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                    symbol TEXT,
                    category TEXT,
                    event_type TEXT,
                    reason TEXT,
                    profile TEXT
                )
            ''')

            cursor.execute('''
                CREATE TABLE IF NOT EXISTS market_observations (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                    symbol TEXT,
                    mode TEXT,
                    market_regime TEXT,
                    trend TEXT,
                    volatility TEXT,
                    confidence REAL,
                    technical_summary TEXT,
                    news_context TEXT,
                    what_changed TEXT,
                    what_to_watch_next_json TEXT,
                    learning_note TEXT,
                    risk_note TEXT,
                    raw_json TEXT,
                    obsidian_exported INTEGER DEFAULT 0,
                    obsidian_path TEXT
                )
            ''')

            conn.commit()
            self._ensure_column(cursor, "decisions", "mode", "TEXT DEFAULT 'PAPER'")
            self._ensure_column(cursor, "decisions", "risk_status", "TEXT")
            self._ensure_column(cursor, "decisions", "risk_reason", "TEXT")
            self._ensure_column(cursor, "trades", "mode", "TEXT DEFAULT 'PAPER'")
            self._ensure_column(cursor, "market_snapshots", "category", "TEXT")
            self._ensure_column(cursor, "market_snapshots", "permission_status", "TEXT")
            conn.commit()
            conn.close()
            logger.info(f"Database initialized at {self.db_path}")
        except Exception as e:
            logger.error(f"Error initializing database: {e}")

    def _ensure_column(self, cursor, table: str, column: str, definition: str):
        cursor.execute(f"PRAGMA table_info({table})")
        columns = {row[1] for row in cursor.fetchall()}
        if column not in columns:
            cursor.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")

    def save_market_snapshot(self, symbol: str, price: float, ta_data: Dict, permission_profile: Dict = None, permission_status: str = None):
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            cursor.execute(
                "INSERT INTO market_snapshots (symbol, price, ta_data, category, permission_status) VALUES (?, ?, ?, ?, ?)",
                (
                    symbol,
                    price,
                    json.dumps(ta_data),
                    (permission_profile or {}).get("category"),
                    permission_status,
                )
            )
            conn.commit()
            conn.close()
        except Exception as e:
            logger.error(f"Error saving market snapshot: {e}")

    def save_news_item(self, source: str, title: str, summary: str, url: str):
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            cursor.execute(
                "INSERT OR IGNORE INTO news_items (source, title, summary, url) VALUES (?, ?, ?, ?)",
                (source, title, summary, url)
            )
            conn.commit()
            conn.close()
        except Exception as e:
            logger.error(f"Error saving news item: {e}")

    def save_decision(
        self,
        symbol: str,
        action: str,
        confidence: float,
        reasoning: str,
        context: Dict,
        risk_status: str = None,
        risk_reason: str = None,
    ) -> int:
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT INTO decisions
                    (symbol, action, confidence, reasoning, market_context, mode, risk_status, risk_reason)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (symbol, action, confidence, reasoning, json.dumps(context), CONFIG.TRADING_MODE, risk_status, risk_reason)
            )
            decision_id = cursor.lastrowid
            conn.commit()
            conn.close()
            return decision_id
        except Exception as e:
            logger.error(f"Error saving decision: {e}")
            return -1

    def save_trade(self, symbol: str, side: str, price: float, amount: float, cost: float, decision_id: int, status: str = 'OPEN', pnl: float = None):
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            cursor.execute(
                "INSERT INTO trades (symbol, side, price, amount, cost, status, pnl, decision_id, mode) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (symbol, side, price, amount, cost, status, pnl, decision_id, CONFIG.TRADING_MODE)
            )
            
            # If this is a SELL trade, let's also close the corresponding OPEN BUY trade in the DB
            if side == "SELL":
                # Find the latest OPEN BUY trade for this symbol
                cursor.execute(
                    "SELECT id FROM trades WHERE symbol = ? AND side = 'BUY' AND status = 'OPEN' ORDER BY timestamp DESC LIMIT 1",
                    (symbol,)
                )
                buy_trade = cursor.fetchone()
                if buy_trade:
                    buy_id = buy_trade[0]
                    # Update the BUY trade to CLOSED and record the PnL
                    cursor.execute(
                        "UPDATE trades SET status = 'CLOSED', pnl = ? WHERE id = ?",
                        (pnl, buy_id)
                    )
            
            conn.commit()
            conn.close()
        except Exception as e:
            logger.error(f"Error saving trade: {e}")

    def update_portfolio(self, balance: float, equity: float, positions: List[Dict]):
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            cursor.execute(
                "INSERT INTO portfolio_state (balance_usdt, equity, positions) VALUES (?, ?, ?)",
                (balance, equity, json.dumps(positions))
            )
            conn.commit()
            conn.close()
        except Exception as e:
            logger.error(f"Error updating portfolio: {e}")

    def reset_portfolio_balance(self, balance: float = CONFIG.INITIAL_BALANCE, positions: Optional[List[Dict]] = None):
        """Reset only the virtual portfolio balance to the initial amount while keeping all learned history intact."""
        safe_positions = positions if positions is not None else []
        self.update_portfolio(float(balance), float(balance), safe_positions)
        logger.info(f"Portfolio reset to {balance} USDT without deleting learning history.")

    def get_recent_decisions(self, limit: int = 5) -> List[Dict]:
        try:
            conn = sqlite3.connect(self.db_path)
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM decisions ORDER BY timestamp DESC LIMIT ?", (limit,))
            rows = cursor.fetchall()
            conn.close()
            return [dict(row) for row in rows]
        except Exception as e:
            logger.error(f"Error fetching recent decisions: {e}")
            return []

    def get_recent_news(self, limit: int = 10) -> List[Dict]:
        try:
            conn = sqlite3.connect(self.db_path)
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM news_items ORDER BY timestamp DESC LIMIT ?", (limit,))
            rows = cursor.fetchall()
            conn.close()
            return [dict(row) for row in rows]
        except Exception as e:
            logger.error(f"Error fetching recent news: {e}")
            return []
            
    def save_analysis_log(self, log_type: str, content: str, meta_data: Dict = None):
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            cursor.execute(
                "INSERT INTO analysis_logs (log_type, content, meta_data) VALUES (?, ?, ?)",
                (log_type, content, json.dumps(meta_data) if meta_data else None)
            )
            conn.commit()
            conn.close()
        except Exception as e:
            logger.error(f"Error saving analysis log: {e}")

    def save_permission_event(self, symbol: str, profile: Dict, reason: str, event_type: str = "PERMISSION"):
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT INTO permission_events (symbol, category, event_type, reason, profile)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    symbol,
                    (profile or {}).get("category"),
                    event_type,
                    reason,
                    json.dumps(profile or {}),
                ),
            )
            conn.commit()
            conn.close()
        except Exception as e:
            logger.error(f"Error saving permission event: {e}")

    def save_market_observation(self, observation: Dict, obsidian_exported: bool = False, obsidian_path: str = None) -> int:
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT INTO market_observations (
                    symbol, mode, market_regime, trend, volatility, confidence,
                    technical_summary, news_context, what_changed, what_to_watch_next_json,
                    learning_note, risk_note, raw_json, obsidian_exported, obsidian_path
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    observation.get("symbol"),
                    observation.get("mode", CONFIG.TRADING_MODE),
                    observation.get("market_regime"),
                    observation.get("trend"),
                    observation.get("volatility"),
                    observation.get("confidence"),
                    observation.get("technical_summary"),
                    observation.get("news_context"),
                    observation.get("what_changed"),
                    json.dumps(observation.get("what_to_watch_next") or []),
                    observation.get("learning_note"),
                    observation.get("risk_note"),
                    json.dumps(observation),
                    1 if obsidian_exported else 0,
                    obsidian_path,
                ),
            )
            observation_id = cursor.lastrowid
            conn.commit()
            conn.close()
            return observation_id
        except Exception as e:
            logger.error(f"Error saving market observation: {e}")
            return -1

    def get_recent_observations(self, symbol: str = None, limit: int = 20) -> List[Dict]:
        try:
            conn = sqlite3.connect(self.db_path)
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            if symbol:
                cursor.execute(
                    "SELECT * FROM market_observations WHERE symbol=? ORDER BY id DESC LIMIT ?",
                    (symbol, limit),
                )
            else:
                cursor.execute("SELECT * FROM market_observations ORDER BY id DESC LIMIT ?", (limit,))
            rows = [dict(row) for row in cursor.fetchall()]
            conn.close()
            for row in rows:
                try:
                    row["what_to_watch_next"] = json.loads(row.get("what_to_watch_next_json") or "[]")
                    row["raw"] = json.loads(row.get("raw_json") or "{}")
                except Exception:
                    row["what_to_watch_next"] = []
                    row["raw"] = {}
            return rows
        except Exception as e:
            logger.error(f"Error fetching market observations: {e}")
            return []
