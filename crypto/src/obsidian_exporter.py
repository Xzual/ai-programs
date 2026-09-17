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
from obsidian_path import build_obsidian_status, resolve_obsidian_vault_path, validate_obsidian_vault_path

SECRET_PATTERNS = [
    re.compile(r"BINANCE_API_KEY\s*=\s*\S+", re.IGNORECASE),
    re.compile(r"BINANCE_API_SECRET\s*=\s*\S+", re.IGNORECASE),
    re.compile(r"api[_-]?key\s*[:=]\s*\S+", re.IGNORECASE),
    re.compile(r"secret\s*[:=]\s*\S+", re.IGNORECASE),
    re.compile(r"token\s*[:=]\s*\S+", re.IGNORECASE),
]


class ObsidianMarketExporter:
    def __init__(self, vault_path: str = None, folder: str = None, enabled: bool = None):
        self.resolution = (
            validate_obsidian_vault_path(vault_path, "explicit")
            if vault_path is not None
            else resolve_obsidian_vault_path(Path(CONFIG.OBSERVER_CONFIG_PATH))
        )
        raw_vault_path = self.resolution.get("vaultPath") if self.resolution.get("ok") else None
        self.vault_path = Path(raw_vault_path) if raw_vault_path else None
        self.folder = (folder or CONFIG.CRYPTO_OBSIDIAN_FOLDER).strip("/\\")
        self.enabled = CONFIG.CRYPTO_OBSIDIAN_ENABLED if enabled is None else bool(enabled)

    def status(self) -> Dict[str, Any]:
        structured = build_obsidian_status(self.enabled, self.vault_path, self.folder, self.resolution)
        target_path = structured.get("resolvedPath")
        base_status = {
            "global_vault_config": "EDITH_OBSIDIAN_VAULT_PATH",
            "uses_global_edith_vault": True,
            "vault_path": structured.get("vaultPath"),
            "relative_folder": self.folder,
            "target_path": target_path,
            "last_export_path": None,
            "enabled": structured.get("enabled"),
            "vaultPath": structured.get("vaultPath"),
            "folder": structured.get("folder"),
            "resolvedPath": structured.get("resolvedPath"),
            "vaultPathConfigured": structured.get("vaultPathConfigured"),
            "available": structured.get("available"),
            "writable": structured.get("writable"),
            "errorCode": structured.get("errorCode"),
            "expectedPath": structured.get("expectedPath"),
            "receivedPath": structured.get("receivedPath"),
            "obsidian": structured,
        }
        return {
            **base_status,
            "status": structured.get("status"),
            "configured": structured.get("vaultPathConfigured"),
        }

    def export_observation(self, observation: Dict[str, Any], timestamp: datetime = None) -> Dict[str, Any]:
        timestamp = timestamp or datetime.now()
        status = self.status()
        if status["status"] != "connected":
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
        if status["status"] != "connected":
            return status
        test_path = self._safe_path("", "_EDITH_CRYPTO_EXPORT_TEST.md")
        test_path.write_text(
            "# E.D.I.T.H. Crypto Export Test\n\n"
            "Status: OK\n"
            "Mode: OBSERVER_ONLY\n"
            "Live Trading: Disabled\n"
            "Paper Trading: Disabled\n"
            "Path Encoding: OK\n",
            encoding="utf-8",
        )
        return {
            **status,
            "status": "exported",
            "test_path": str(test_path),
            "last_export_path": str(test_path),
        }

    def export_demo_decision(self, decision: Dict[str, Any], portfolio: Dict[str, Any], timestamp: datetime = None) -> Dict[str, Any]:
        """Write graph-friendly demo decision notes under the global vault."""
        timestamp = timestamp or datetime.now()
        status = self.status()
        if status["status"] != "connected":
            return status

        root = self._safe_path("..", "Crypto Index.md").parent / "Crypto"
        self._ensure_crypto_graph(root)
        symbol = self._safe_symbol(decision.get("symbol") or decision.get("asset"))
        decision_slug = f"{timestamp.strftime('%Y-%m-%d_%H%M%S')}_{symbol}_{self._safe_symbol(decision.get('decision'))}.md"
        journal_path = self._safe_graph_path(root, "Trade Journal", decision_slug)
        asset_path = self._safe_graph_path(root, "Assets", f"{symbol}.md")
        performance_path = self._safe_graph_path(root, "Performance", "Demo Portfolio.md")
        model_path = self._safe_graph_path(root, "Models", f"Ollama Model - {self._safe_symbol(decision.get('model_used'))}.md")

        journal_path.write_text(self._demo_decision_note(decision, portfolio, timestamp), encoding="utf-8")
        self._append_graph(asset_path, self._asset_block(decision, timestamp))
        self._append_graph(performance_path, self._performance_block(portfolio, timestamp))
        self._append_graph(model_path, self._model_block(decision, timestamp))

        return {
            "status": "exported",
            "last_export_path": str(journal_path),
            "journal_path": str(journal_path),
            "asset_path": str(asset_path),
            "performance_path": str(performance_path),
            "model_path": str(model_path),
            "graphLinks": ["[[Crypto Index]]", f"[[{symbol}]]", "[[Trade Journal]]", "[[Demo Portfolio]]"],
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

    def _safe_graph_path(self, root: Path, section: str, filename: str) -> Path:
        base = (root / section).resolve()
        base.mkdir(parents=True, exist_ok=True)
        path = (base / filename).resolve()
        vault_root = self.vault_path.resolve()
        if not str(path).lower().startswith(str(vault_root).lower()):
            raise ValueError("Obsidian graph export path escapes vault.")
        return path

    def _ensure_crypto_graph(self, root: Path):
        root.mkdir(parents=True, exist_ok=True)
        index = root / "Crypto Index.md"
        if not index.exists():
            index.write_text(
                "# Crypto Index\n\n"
                "Tags: #edith/crypto #demo-trading #not-financial-advice\n\n"
                "- [[Trade Journal]]\n"
                "- [[Demo Portfolio]]\n"
                "- [[Risk Management]]\n"
                "- [[Market Regime]]\n"
                "- [[News Digest]]\n"
                "- [[BTC-USDT]]\n"
                "- [[ETH-USDT]]\n\n"
                "This vault section is managed by E.D.I.T.H. Crypto and uses demo/simulation data only.\n",
                encoding="utf-8",
            )
        for section in ("Market Logs", "Trade Journal", "Lessons", "Assets", "News", "Performance", "Models"):
            (root / section).mkdir(parents=True, exist_ok=True)
        trade_index = root / "Trade Journal" / "Trade Journal.md"
        if not trade_index.exists():
            trade_index.write_text("# Trade Journal\n\nUp: [[Crypto Index]]\n\n", encoding="utf-8")
        news_index = root / "News" / "News Digest.md"
        if not news_index.exists():
            news_index.write_text("# News Digest\n\nUp: [[Crypto Index]]\n\n", encoding="utf-8")

    def _append_graph(self, path: Path, block: str):
        if not path.exists():
            title = path.stem
            path.write_text(f"# {title}\n\nUp: [[Crypto Index]]\n\n", encoding="utf-8")
        path.write_text(path.read_text(encoding="utf-8") + block, encoding="utf-8")

    def _demo_decision_note(self, decision: Dict[str, Any], portfolio: Dict[str, Any], timestamp: datetime) -> str:
        symbol = self._safe_symbol(decision.get("symbol") or decision.get("asset"))
        model = self._safe_symbol(decision.get("model_used"))
        return (
            f"# {symbol} {self._clean(decision.get('decision'))} - {timestamp.isoformat(timespec='minutes')}\n\n"
            "Tags: #edith/crypto #demo-trading #not-financial-advice\n\n"
            "Up: [[Crypto Index]]  \n"
            f"Asset: [[{symbol}]]  \n"
            "Journal: [[Trade Journal]]  \n"
            "Portfolio: [[Demo Portfolio]]  \n"
            f"Model: [[Ollama Model - {model}]]\n\n"
            "## Safety\n"
            "- Mode: DEMO\n"
            "- Real Money Used: No\n"
            "- Live Execution: Disabled\n"
            "- Binance Order Sent: No\n\n"
            "## Decision\n"
            f"- Decision: {self._clean(decision.get('decision'))}\n"
            f"- Confidence: {self._clean(decision.get('confidence'))}\n"
            f"- Market Regime: {self._clean(decision.get('market_regime'))}\n"
            f"- Trend: {self._clean(decision.get('trend'))}\n"
            f"- Volatility: {self._clean(decision.get('volatility'))}\n"
            f"- News Sentiment: {self._clean(decision.get('news_sentiment'))}\n\n"
            "## Reasoning Summary\n"
            f"- Technical: {self._clean(decision.get('technical_summary'))}\n"
            f"- News: {self._clean(decision.get('news_summary'))}\n"
            f"- Risk: {self._clean(decision.get('risk_summary'))}\n"
            f"- Reason: {self._clean(decision.get('decision_reason'))}\n"
            f"- Invalidation: {self._clean(decision.get('invalidation_condition'))}\n\n"
            "## Demo Portfolio Snapshot\n"
            f"- Initial Balance: {self._clean(portfolio.get('initialBalance'))} USD\n"
            f"- Cash: {self._clean(portfolio.get('currentCash'))} USD\n"
            f"- Equity: {self._clean(portfolio.get('currentEquity'))} USD\n"
            f"- Exposure: {self._clean(portfolio.get('currentExposurePct'))}%\n\n"
            "This is a learning note generated by E.D.I.T.H. It is not financial advice.\n"
        )

    def _asset_block(self, decision: Dict[str, Any], timestamp: datetime) -> str:
        return (
            f"- {timestamp.isoformat(timespec='minutes')} | [[Trade Journal]] | "
            f"{self._clean(decision.get('decision'))} | {self._clean(decision.get('decision_reason'))}\n"
        )

    def _performance_block(self, portfolio: Dict[str, Any], timestamp: datetime) -> str:
        return (
            f"- {timestamp.isoformat(timespec='minutes')} | Equity {self._clean(portfolio.get('currentEquity'))} | "
            f"Cash {self._clean(portfolio.get('currentCash'))} | Exposure {self._clean(portfolio.get('currentExposurePct'))}% | "
            "Demo only, no real money.\n"
        )

    def _model_block(self, decision: Dict[str, Any], timestamp: datetime) -> str:
        return (
            f"- {timestamp.isoformat(timespec='minutes')} | {self._clean(decision.get('symbol'))} | "
            f"{self._clean(decision.get('decision'))} | accepted summary only, hidden chain-of-thought not stored.\n"
        )

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
