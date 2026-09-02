"""
Safe Markdown export for crypto observer learning notes.
Exports learning summaries only; never secrets or trading instructions.
"""
import os
import re
from datetime import datetime
from pathlib import Path
from typing import Dict, Any

from config import CONFIG

SECRET_PATTERNS = [
    re.compile(r"BINANCE_API_KEY\s*=\s*\S+", re.IGNORECASE),
    re.compile(r"BINANCE_API_SECRET\s*=\s*\S+", re.IGNORECASE),
    re.compile(r"api[_-]?key\s*[:=]\s*\S+", re.IGNORECASE),
    re.compile(r"secret\s*[:=]\s*\S+", re.IGNORECASE),
    re.compile(r"token\s*[:=]\s*\S+", re.IGNORECASE),
]


class ObsidianMarketExporter:
    def __init__(self, vault_path: str = None, folder: str = None, enabled: bool = None):
        self.vault_path = Path(vault_path or CONFIG.EDITH_OBSIDIAN_VAULT_PATH)
        self.folder = (folder or CONFIG.CRYPTO_OBSIDIAN_FOLDER).strip("/\\")
        self.enabled = CONFIG.CRYPTO_OBSIDIAN_ENABLED if enabled is None else bool(enabled)

    def status(self) -> Dict[str, Any]:
        target_path = str((self.vault_path / self.folder).resolve()) if self.vault_path else None
        base_status = {
            "global_vault_config": "EDITH_OBSIDIAN_VAULT_PATH",
            "uses_global_edith_vault": True,
            "vault_path": str(self.vault_path) if self.vault_path else None,
            "relative_folder": self.folder,
            "target_path": target_path,
            "last_export_path": None,
        }
        if not self.enabled:
            return {**base_status, "status": "disabled", "configured": False}
        if not self.vault_path:
            return {**base_status, "status": "configuration_required", "configured": False}
        if not self.vault_path.exists():
            return {**base_status, "status": "configuration_required", "configured": False}
        return {
            **base_status,
            "status": "ready",
            "configured": True,
        }

    def export_observation(self, observation: Dict[str, Any], timestamp: datetime = None) -> Dict[str, Any]:
        timestamp = timestamp or datetime.now()
        status = self.status()
        if status["status"] != "ready":
            return status

        daily_path = self._safe_path("Daily", f"{timestamp.date().isoformat()}.md")
        symbol_path = self._safe_path("Symbols", f"{self._safe_symbol(observation.get('symbol'))}.md")

        self._append_daily(daily_path, observation, timestamp)
        self._append_symbol(symbol_path, observation, timestamp)

        return {
            "status": "exported",
            "configured": True,
            "daily_path": str(daily_path),
            "symbol_path": str(symbol_path),
            "last_export_path": str(daily_path),
        }

    def write_export_test(self) -> Dict[str, Any]:
        status = self.status()
        if status["status"] != "ready":
            return status
        test_path = self._safe_path("", "_EDITH_CRYPTO_EXPORT_TEST.md")
        test_path.write_text(
            "# E.D.I.T.H. Crypto Export Test\n\n"
            "Status: OK\n"
            "Mode: OBSERVER_ONLY\n"
            "Live Trading: Disabled\n"
            "Paper Trading: Disabled\n",
            encoding="utf-8",
        )
        return {
            **status,
            "status": "exported",
            "test_path": str(test_path),
            "last_export_path": str(test_path),
        }

    def _append_daily(self, path: Path, observation: Dict[str, Any], timestamp: datetime):
        if not path.exists():
            path.write_text(
                f"# Crypto Market Learning - {timestamp.date().isoformat()}\n\n"
                "Mode: OBSERVER_ONLY  \n"
                "Live Trading: Disabled  \n"
                "Paper Trading: Disabled by default  \n"
                "Source: E.D.I.T.H. Crypto Observer\n\n",
                encoding="utf-8",
            )
        path.write_text(path.read_text(encoding="utf-8") + self._daily_block(observation, timestamp), encoding="utf-8")

    def _append_symbol(self, path: Path, observation: Dict[str, Any], timestamp: datetime):
        if not path.exists():
            symbol = observation.get("symbol", "UNKNOWN")
            path.write_text(
                f"# {symbol}\n\n"
                "## Latest Observations\n\n"
                "## Repeating Patterns\n\n"
                "## Useful Lessons\n\n"
                "## Risk Warnings\n\n"
                "## Timeline\n\n",
                encoding="utf-8",
            )
        path.write_text(path.read_text(encoding="utf-8") + self._symbol_block(observation, timestamp), encoding="utf-8")

    def _daily_block(self, observation: Dict[str, Any], timestamp: datetime) -> str:
        watch_next = "\n".join(f"- {self._clean(item)}" for item in observation.get("what_to_watch_next", [])) or "- No watch items generated."
        return (
            f"## {self._clean(observation.get('symbol'))} - {timestamp.strftime('%H:%M')}\n\n"
            "### Market State\n"
            f"- Trend: {self._clean(observation.get('trend'))}\n"
            f"- Volatility: {self._clean(observation.get('volatility'))}\n"
            f"- Market Regime: {self._clean(observation.get('market_regime'))}\n"
            f"- Technical Summary: {self._clean(observation.get('technical_summary'))}\n\n"
            "### What Changed\n"
            f"{self._clean(observation.get('what_changed'))}\n\n"
            "### What To Watch Next\n"
            f"{watch_next}\n\n"
            "### Learning Note\n"
            f"{self._clean(observation.get('learning_note'))}\n\n"
            "### Risk Note\n"
            f"{self._clean(observation.get('risk_note'))}\n\n"
            "### Disclaimer\n"
            "This is a learning note generated by E.D.I.T.H. It is not financial advice.\n\n"
        )

    def _symbol_block(self, observation: Dict[str, Any], timestamp: datetime) -> str:
        return (
            f"- {timestamp.isoformat(timespec='minutes')} | "
            f"{self._clean(observation.get('market_regime'))} | "
            f"{self._clean(observation.get('learning_note'))} | "
            "Not financial advice.\n"
        )

    def _safe_path(self, section: str, filename: str) -> Path:
        base = (self.vault_path / self.folder / section).resolve() if section else (self.vault_path / self.folder).resolve()
        base.mkdir(parents=True, exist_ok=True)
        path = (base / filename).resolve()
        vault_root = self.vault_path.resolve()
        if not str(path).lower().startswith(str(vault_root).lower()):
            raise ValueError("Obsidian export path escapes vault.")
        return path

    @staticmethod
    def _safe_symbol(symbol: str) -> str:
        return re.sub(r"[^A-Z0-9-]+", "-", str(symbol or "UNKNOWN").upper().replace("/", "-")).strip("-")

    @staticmethod
    def _clean(value: Any) -> str:
        text = str(value or "").replace("\r", " ").strip()
        for pattern in SECRET_PATTERNS:
            text = pattern.sub("[redacted_secret]", text)
        for env_name in ("BINANCE_API_KEY", "BINANCE_API_SECRET", "EDITH_OBSIDIAN_VAULT_PATH"):
            env_value = os.getenv(env_name)
            if env_value:
                text = text.replace(env_value, "[redacted_secret]")
        return text
