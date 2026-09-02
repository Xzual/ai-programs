"""
Manual lifecycle controller for the EDITH crypto observer.
Keeps the Flask service online while market observation remains user-started.
"""
import threading
from datetime import datetime
from typing import Dict, Any

import requests

from config import CONFIG
from agent import CryptoAgent
from memory_manager import MemoryManager
from market_data import MarketDataFetcher
from obsidian_exporter import ObsidianMarketExporter
from coin_permissions import CoinPermissionManager


class CryptoRuntimeController:
    STATES = {"STOPPED", "STARTING", "OBSERVING", "PAUSED", "STOPPING", "ERROR"}

    def __init__(self):
        self._lock = threading.RLock()
        self._thread = None
        self._agent = None
        self._stop_event = threading.Event()
        self._pause_event = threading.Event()
        self._state = "STOPPED"
        self._last_started_at = None
        self._last_stopped_at = None
        self._last_observation_at = None
        self._current_symbol = None
        self._last_error = None
        self._mode = "MARKET_DATA_AND_LLM"
        self._last_market_data_available = None
        self.memory = MemoryManager()
        self.permissions = CoinPermissionManager()
        self.obsidian = ObsidianMarketExporter(
            enabled=self.permissions.get_observer_config().get("obsidianExportEnabled")
        )

    def status(self) -> Dict[str, Any]:
        with self._lock:
            thread_alive = bool(self._thread and self._thread.is_alive())
            state = self._state
            if state in ("OBSERVING", "STARTING", "PAUSED", "STOPPING") and not thread_alive:
                state = "ERROR" if self._last_error else "STOPPED"
            return {
                "serviceRunning": True,
                "observerRunning": thread_alive and state in ("STARTING", "OBSERVING", "PAUSED", "STOPPING"),
                "state": state,
                "mode": "OBSERVER_ONLY" if CONFIG.TRADING_MODE == "OBSERVER_ONLY" else f"{CONFIG.TRADING_MODE}_LOCKED",
                "runtimeMode": self._mode,
                "tradingEnabled": False,
                "paperTradingEnabled": False,
                "liveTradingEnabled": False,
                "ollamaAvailable": self.ollama_status().get("available", False),
                "marketDataAvailable": self._last_market_data_available,
                "obsidianAvailable": self.obsidian.status().get("status") == "ready",
                "lastStartedAt": self._last_started_at,
                "lastStoppedAt": self._last_stopped_at,
                "lastObservationAt": self._last_observation_at or self._last_observation_from_db(),
                "watchedSymbols": self.permissions.get_watchlist(),
                "currentSymbol": self._current_symbol,
                "lastError": self._last_error,
                "safetyStatus": self._safety_status(),
            }

    def start_observer(self) -> Dict[str, Any]:
        with self._lock:
            if self._thread and self._thread.is_alive():
                return {"ok": True, "message": "Observer already running", "status": self.status()}
            safety = self._safety_status()
            if safety["status"] != "LOCKED":
                return {"ok": False, "code": "SAFETY_CHECK_FAILED", "status": self.status()}
            ollama = self.ollama_status()
            if not ollama.get("available") and not CONFIG.CRYPTO_ALLOW_MARKET_DATA_ONLY_WHEN_OLLAMA_OFFLINE:
                self._state = "ERROR"
                self._last_error = "OLLAMA_OFFLINE"
                return {"ok": False, "code": "OLLAMA_OFFLINE", "status": self.status()}

            self._state = "STARTING"
            self._last_error = None
            self._current_symbol = None
            self._last_started_at = datetime.now().isoformat(timespec="seconds")
            self._stop_event.clear()
            self._pause_event.clear()
            self._mode = "MARKET_DATA_AND_LLM" if ollama.get("available") else "MARKET_DATA_ONLY"

            self._thread = threading.Thread(target=self._run_observer, daemon=True)
            self._thread.start()
            return {"ok": True, "message": "Observer starting", "status": self.status()}

    def stop_observer(self) -> Dict[str, Any]:
        with self._lock:
            if not self._thread or not self._thread.is_alive():
                self._state = "STOPPED"
                self._current_symbol = None
                self._last_stopped_at = self._last_stopped_at or datetime.now().isoformat(timespec="seconds")
                return {"ok": True, "message": "Observer already stopped", "status": self.status()}
            self._state = "STOPPING"
            self._stop_event.set()
            if self._agent:
                self._agent.stop()
        self._thread.join(timeout=8)
        with self._lock:
            if self._thread and self._thread.is_alive():
                return {"ok": True, "message": "Observer stopping at next safe checkpoint", "status": self.status()}
            self._state = "STOPPED"
            self._current_symbol = None
            self._last_stopped_at = datetime.now().isoformat(timespec="seconds")
            return {"ok": True, "message": "Observer stopped", "status": self.status()}

    def pause_observer(self) -> Dict[str, Any]:
        with self._lock:
            if not self._thread or not self._thread.is_alive():
                return {"ok": False, "code": "OBSERVER_NOT_RUNNING", "status": self.status()}
            self._pause_event.set()
            self._state = "PAUSED"
            return {"ok": True, "message": "Observer paused", "status": self.status()}

    def resume_observer(self) -> Dict[str, Any]:
        with self._lock:
            if not self._thread or not self._thread.is_alive():
                return {"ok": False, "code": "OBSERVER_NOT_RUNNING", "status": self.status()}
            self._pause_event.clear()
            self._state = "OBSERVING"
            return {"ok": True, "message": "Observer resumed", "status": self.status()}

    def set_state(self, state: str):
        if state not in self.STATES:
            return
        with self._lock:
            self._state = state

    def set_current_symbol(self, symbol: str):
        with self._lock:
            self._current_symbol = symbol

    def mark_observation(self, symbol: str):
        with self._lock:
            self._current_symbol = symbol
            self._last_observation_at = datetime.now().isoformat(timespec="seconds")
            self._last_market_data_available = True

    def ollama_status(self) -> Dict[str, Any]:
        try:
            response = requests.get(f"{CONFIG.OLLAMA_HOST}/api/tags", timeout=2)
            return {
                "available": response.ok,
                "host": CONFIG.OLLAMA_HOST,
                "model": CONFIG.LLM_MODEL,
                "status": "online" if response.ok else f"http_{response.status_code}",
            }
        except Exception as exc:
            return {
                "available": False,
                "host": CONFIG.OLLAMA_HOST,
                "model": CONFIG.LLM_MODEL,
                "status": "offline",
                "error": str(exc),
            }

    def market_data_status(self) -> Dict[str, Any]:
        try:
            fetcher = MarketDataFetcher()
            ticker = fetcher.fetch_ticker("BTC/USDT")
            available = bool(ticker)
            with self._lock:
                self._last_market_data_available = available
            return {
                "available": available,
                "exchange": CONFIG.EXCHANGE_ID,
                "connectionMode": CONFIG.binance_connection_mode,
            }
        except Exception as exc:
            with self._lock:
                self._last_market_data_available = False
            return {
                "available": False,
                "exchange": CONFIG.EXCHANGE_ID,
                "connectionMode": CONFIG.binance_connection_mode,
                "error": str(exc),
            }

    def latest_observations(self, limit: int = 20) -> Dict[str, Any]:
        return {"observations": self.memory.get_recent_observations(limit=min(max(limit, 1), 100))}

    def _run_observer(self):
        try:
            self.set_state("OBSERVING")
            agent = CryptoAgent()
            agent.llm_available = self._mode == "MARKET_DATA_AND_LLM"
            with self._lock:
                self._agent = agent
            agent.start(stop_event=self._stop_event, pause_event=self._pause_event, runtime=self)
            with self._lock:
                self._state = "STOPPED"
                self._current_symbol = None
                self._last_stopped_at = datetime.now().isoformat(timespec="seconds")
        except Exception as exc:
            with self._lock:
                self._state = "ERROR"
                self._last_error = str(exc)
                self._current_symbol = None
        finally:
            with self._lock:
                self._agent = None

    def _last_observation_from_db(self):
        rows = self.memory.get_recent_observations(limit=1)
        return rows[0].get("timestamp") if rows else None

    def _safety_status(self) -> Dict[str, Any]:
        checks = {
            "observerOnlyMode": CONFIG.TRADING_MODE == "OBSERVER_ONLY",
            "tradingDisabled": not CONFIG.CRYPTO_TRADING_ENABLED,
            "paperTradingDisabled": not CONFIG.PAPER_TRADING,
            "liveTradingDisabled": not CONFIG.live_trading_active,
            "binanceTradingDisabled": not CONFIG.BINANCE_TRADING_ENABLED,
        }
        locked = all(checks.values())
        return {
            "status": "LOCKED" if locked else "UNSAFE",
            "checks": checks,
            "message": "Trading locked; observer may collect public market data."
            if locked
            else "Observer start blocked because a trading flag is enabled.",
        }


runtime_controller = CryptoRuntimeController()
