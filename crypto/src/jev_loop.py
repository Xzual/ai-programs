"""Thread-safe continuous multi-asset Jev loop for the local demo portfolio."""
import threading
import time
import math
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional, Tuple


DecisionRunner = Callable[[List[str]], Tuple[Dict[str, Any], int]]


class JevDemoLoopController:
    def __init__(
        self,
        decision_runner: DecisionRunner,
        default_interval_seconds: float = 60,
        min_interval_seconds: float = 15,
        default_symbols: Optional[List[str]] = None,
    ):
        self._decision_runner = decision_runner
        self._default_interval = max(float(default_interval_seconds), float(min_interval_seconds))
        self._min_interval = max(0.01, float(min_interval_seconds))
        self._lock = threading.RLock()
        self._stop_event = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._state = "STOPPED"
        self._symbols = self._normalize_symbols(default_symbols or ["BTCUSDT"])
        self._interval_seconds = self._default_interval
        self._started_at: Optional[str] = None
        self._started_monotonic: Optional[float] = None
        self._elapsed_at_stop = 0.0
        self._stopped_at: Optional[str] = None
        self._last_run_at: Optional[str] = None
        self._next_run_at: Optional[str] = None
        self._last_action: Optional[str] = None
        self._last_error: Optional[str] = None
        self._last_latency_ms: Optional[int] = None
        self._last_cycle_latency_ms: Optional[int] = None
        self._last_execution: Optional[Dict[str, Any]] = None
        self._last_decisions: List[Dict[str, Any]] = []
        self._cycles = 0
        self._decision_count = 0
        self._executed_trades = 0
        self._blocked = 0
        self._errors = 0
        self._asset_errors = 0
        self._actions = {"BUY": 0, "SELL": 0, "HOLD": 0}

    @staticmethod
    def _now() -> str:
        return datetime.now(timezone.utc).isoformat()

    @staticmethod
    def _normalize_symbols(symbols: List[str]) -> List[str]:
        if isinstance(symbols, str):
            symbols = [symbols]
        normalized = []
        for symbol in symbols:
            value = str(symbol or "").replace("/", "").replace("-", "").upper()
            if value and value not in normalized:
                normalized.append(value)
        return normalized or ["BTCUSDT"]

    def status(self) -> Dict[str, Any]:
        with self._lock:
            thread_alive = bool(self._thread and self._thread.is_alive())
            running = thread_alive and self._state in {"STARTING", "RUNNING", "STOPPING"}
            if running and self._started_monotonic is not None:
                elapsed = time.monotonic() - self._started_monotonic
            else:
                elapsed = self._elapsed_at_stop
            return {
                "state": self._state,
                "running": running,
                "symbol": self._symbols[0] if len(self._symbols) == 1 else "ALL",
                "symbols": list(self._symbols),
                "symbolCount": len(self._symbols),
                "intervalSeconds": self._interval_seconds,
                "minimumIntervalSeconds": self._min_interval,
                "startedAt": self._started_at,
                "stoppedAt": self._stopped_at,
                "elapsedSeconds": max(0, int(elapsed)),
                "lastRunAt": self._last_run_at,
                "nextRunAt": self._next_run_at,
                "lastAction": self._last_action,
                "lastLatencyMs": self._last_latency_ms,
                "lastCycleLatencyMs": self._last_cycle_latency_ms,
                "lastExecution": self._last_execution,
                "lastDecisions": list(self._last_decisions),
                "lastError": self._last_error,
                "cycles": self._cycles,
                "decisionCount": self._decision_count,
                "decisionsThisCycle": len(self._last_decisions),
                "executedTrades": self._executed_trades,
                "blockedDecisions": self._blocked,
                "errors": self._errors,
                "assetErrors": self._asset_errors,
                "actions": dict(self._actions),
                "demoOnly": True,
                "realOrderSent": False,
            }

    def start(self, symbols: Optional[List[str]] = None, interval_seconds: Any = None) -> Dict[str, Any]:
        try:
            interval = self._default_interval if interval_seconds is None else float(interval_seconds)
        except (TypeError, ValueError, OverflowError):
            return {"ok": False, "error": "INVALID_LOOP_INTERVAL", "status": self.status()}
        if isinstance(interval_seconds, bool) or not math.isfinite(interval) or interval > 86400:
            return {"ok": False, "error": "INVALID_LOOP_INTERVAL", "status": self.status()}
        if interval < self._min_interval:
            return {
                "ok": False,
                "error": "LOOP_INTERVAL_TOO_SHORT",
                "minimumIntervalSeconds": self._min_interval,
                "status": self.status(),
            }
        with self._lock:
            if self._thread and self._thread.is_alive():
                return {"ok": False, "error": "JEV_LOOP_ALREADY_RUNNING", "status": self.status()}
            if symbols:
                self._symbols = self._normalize_symbols(symbols)
            self._interval_seconds = interval
            self._state = "STARTING"
            self._started_at = self._now()
            self._started_monotonic = time.monotonic()
            self._elapsed_at_stop = 0.0
            self._stopped_at = None
            self._last_run_at = None
            self._next_run_at = None
            self._last_action = None
            self._last_error = None
            self._last_latency_ms = None
            self._last_cycle_latency_ms = None
            self._last_execution = None
            self._last_decisions = []
            self._cycles = 0
            self._decision_count = 0
            self._executed_trades = 0
            self._blocked = 0
            self._errors = 0
            self._asset_errors = 0
            self._actions = {"BUY": 0, "SELL": 0, "HOLD": 0}
            self._stop_event.clear()
            self._thread = threading.Thread(target=self._run, name="jev-demo-loop", daemon=True)
            self._thread.start()
            return {"ok": True, "message": "Jev multi-asset demo loop started.", "status": self.status()}

    def stop(self, timeout_seconds: float = 3.0) -> Dict[str, Any]:
        with self._lock:
            thread = self._thread
            if not thread or not thread.is_alive():
                self._state = "STOPPED"
                return {"ok": True, "message": "Jev demo loop already stopped.", "status": self.status()}
            self._state = "STOPPING"
            self._stop_event.set()
        thread.join(timeout=max(0.0, float(timeout_seconds)))
        return {
            "ok": True,
            "message": "Jev demo loop stopped." if not thread.is_alive() else "Jev demo loop is stopping after the current request.",
            "status": self.status(),
        }

    def _run(self):
        with self._lock:
            self._state = "RUNNING"
        try:
            while not self._stop_event.is_set():
                self._run_once()
                if self._stop_event.is_set():
                    break
                with self._lock:
                    self._next_run_at = datetime.fromtimestamp(
                        time.time() + self._interval_seconds,
                        tz=timezone.utc,
                    ).isoformat()
                if self._stop_event.wait(self._interval_seconds):
                    break
        finally:
            with self._lock:
                if self._started_monotonic is not None:
                    self._elapsed_at_stop = time.monotonic() - self._started_monotonic
                self._state = "STOPPED"
                self._stopped_at = self._now()
                self._next_run_at = None

    def _run_once(self):
        cycle_started = time.perf_counter()
        try:
            result, http_status = self._decision_runner(list(self._symbols))
            items = result.get("results") if isinstance(result.get("results"), list) else []
            if not items and result.get("decision"):
                items = [{
                    "symbol": self._symbols[0],
                    "ok": result.get("ok"),
                    "decision": result.get("decision"),
                    "execution": result.get("execution"),
                }]
            last_decisions = []
            cycle_actions = []
            executed = 0
            blocked = 0
            asset_errors = 0
            safety_violation = False
            for item in items:
                decision = item.get("decision") or {}
                execution = item.get("execution") or {}
                action = str(decision.get("action") or "").upper()
                item_ok = item.get("ok", True) is True
                valid_action = action in self._actions
                reported_executed = execution.get("executed") is True
                execution_allowed = item_ok and action in {"BUY", "SELL"}
                if valid_action:
                    cycle_actions.append(action)
                if reported_executed and execution_allowed:
                    executed += 1
                elif reported_executed:
                    safety_violation = True
                    blocked += 1
                if execution.get("blocked"):
                    blocked += 1
                if not item_ok or not valid_action or (reported_executed and not execution_allowed):
                    asset_errors += 1
                last_decisions.append({
                    "symbol": item.get("symbol"),
                    "decisionId": decision.get("decisionId"),
                    "tradeId": execution.get("tradeId") or decision.get("tradeId"),
                    "operationId": item.get("operationId"),
                    "marketDataAgeMs": decision.get("marketDataAgeMs"),
                    "riskResult": decision.get("riskResult"),
                    "action": action or None,
                    "confidence": decision.get("confidence"),
                    "executed": reported_executed and execution_allowed,
                    "blocked": bool(execution.get("blocked")) or (reported_executed and not execution_allowed),
                    "reason": (
                        "unsafe_execution_claim_rejected"
                        if reported_executed and not execution_allowed
                        else execution.get("reason") or item.get("errorCode")
                    ),
                    "marketStatus": item.get("marketStatus"),
                })
            cycle_latency_ms = int((time.perf_counter() - cycle_started) * 1000)
            with self._lock:
                self._cycles += 1
                self._last_run_at = self._now()
                self._last_action = cycle_actions[0] if cycle_actions and len(set(cycle_actions)) == 1 else "MIXED" if cycle_actions else None
                self._last_latency_ms = result.get("jevLatencyMs") or result.get("latencyMs")
                self._last_cycle_latency_ms = result.get("cycleLatencyMs") or cycle_latency_ms
                self._last_execution = {
                    "executed": executed,
                    "blocked": blocked,
                    "assetErrors": asset_errors,
                }
                self._last_decisions = last_decisions
                self._decision_count += len(cycle_actions)
                for action in cycle_actions:
                    self._actions[action] += 1
                self._executed_trades += executed
                self._blocked += blocked
                self._asset_errors += asset_errors
                if http_status >= 400 or not result.get("ok"):
                    self._errors += 1
                    self._last_error = str(result.get("errorCode") or result.get("error") or "JEV_LOOP_CYCLE_FAILED")
                elif asset_errors:
                    self._last_error = f"{asset_errors}_ASSET_ERRORS"
                else:
                    self._last_error = None
                if safety_violation:
                    self._last_error = "UNSAFE_EXECUTION_CLAIM_REJECTED"
                    self._errors += 1
                    self._stop_event.set()
        except Exception as exc:
            with self._lock:
                self._cycles += 1
                self._errors += 1
                self._last_run_at = self._now()
                self._last_cycle_latency_ms = int((time.perf_counter() - cycle_started) * 1000)
                self._last_error = type(exc).__name__
