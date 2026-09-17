"""
Ollama model role selection and honest availability reporting for crypto analysis.
"""
import json
import logging
import sqlite3
import time
from datetime import datetime
from typing import Dict, Any, List

import requests

from config import CONFIG

logger = logging.getLogger("crypto_models")

MODEL_ROLES = {"primary", "fallback", "news", "explanation"}


class CryptoModelManager:
    def __init__(self, db_path: str = CONFIG.DB_PATH):
        self.db_path = db_path
        self._init_db()

    def _init_db(self):
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS crypto_model_settings (
                role TEXT PRIMARY KEY,
                model TEXT,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS crypto_model_activity (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                role TEXT,
                model TEXT,
                task TEXT,
                latency_ms INTEGER,
                available INTEGER,
                fallback_used INTEGER,
                accepted INTEGER,
                summary TEXT,
                error TEXT
            )
        """)
        conn.commit()
        conn.close()

    def settings(self) -> Dict[str, str]:
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute("SELECT role, model FROM crypto_model_settings")
        rows = dict(cursor.fetchall())
        conn.close()
        default = CONFIG.LLM_MODEL
        return {
            "primary": rows.get("primary") or default,
            "fallback": rows.get("fallback") or default,
            "news": rows.get("news") or rows.get("primary") or default,
            "explanation": rows.get("explanation") or rows.get("primary") or default,
        }

    def select_model(self, role: str, model: str) -> Dict[str, Any]:
        clean_role = str(role or "").strip().lower()
        clean_model = str(model or "").strip()
        if clean_role not in MODEL_ROLES:
            return {"ok": False, "error": "INVALID_MODEL_ROLE", "allowedRoles": sorted(MODEL_ROLES)}
        if not clean_model:
            return {"ok": False, "error": "MODEL_REQUIRED"}
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO crypto_model_settings (role, model, updated_at)
            VALUES (?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(role) DO UPDATE SET model=excluded.model, updated_at=CURRENT_TIMESTAMP
            """,
            (clean_role, clean_model),
        )
        conn.commit()
        conn.close()
        return {"ok": True, "role": clean_role, "model": clean_model}

    def ollama_models(self) -> Dict[str, Any]:
        started = time.time()
        try:
            response = requests.get(f"{CONFIG.OLLAMA_HOST}/api/tags", timeout=2)
            response.raise_for_status()
            payload = response.json()
            models = [item.get("name") or item.get("model") for item in payload.get("models", [])]
            models = [model for model in models if model]
            return {
                "available": True,
                "status": "available",
                "models": models,
                "latencyMs": int((time.time() - started) * 1000),
                "error": None,
            }
        except Exception as exc:
            return {
                "available": False,
                "status": "unavailable",
                "models": [],
                "latencyMs": int((time.time() - started) * 1000),
                "error": str(exc),
            }

    def record_activity(self, role: str, model: str, task: str, latency_ms: int, available: bool, fallback_used: bool, accepted: bool, summary: str, error: str = None):
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO crypto_model_activity
                (role, model, task, latency_ms, available, fallback_used, accepted, summary, error)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (role, model, task, latency_ms, int(available), int(fallback_used), int(accepted), summary, error),
        )
        conn.commit()
        conn.close()

    def activity(self, limit: int = 10) -> List[Dict[str, Any]]:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM crypto_model_activity ORDER BY id DESC LIMIT ?", (limit,))
        rows = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return rows

    def public_status(self) -> Dict[str, Any]:
        availability = self.ollama_models()
        return {
            **availability,
            "host": CONFIG.OLLAMA_HOST,
            "selected": self.settings(),
            "lastActivity": self.activity(8),
            "updatedAt": datetime.now().isoformat(timespec="seconds"),
        }
