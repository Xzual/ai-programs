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

            conn.commit()
            self._ensure_column(cursor, "decisions", "mode", "TEXT DEFAULT 'PAPER'")
            self._ensure_column(cursor, "decisions", "risk_status", "TEXT")
            self._ensure_column(cursor, "decisions", "risk_reason", "TEXT")
            self._ensure_column(cursor, "trades", "mode", "TEXT DEFAULT 'PAPER'")
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

    def save_market_snapshot(self, symbol: str, price: float, ta_data: Dict):
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            cursor.execute(
                "INSERT INTO market_snapshots (symbol, price, ta_data) VALUES (?, ?, ?)",
                (symbol, price, json.dumps(ta_data))
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
