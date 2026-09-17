"""
Safe asset modes for the 100 USD crypto demo module.

These modes are separate from the legacy paper-trading permission flags.
"""
import json
import logging
from pathlib import Path
from typing import Dict, Any, List

from config import CONFIG, CRYPTO_ROOT

logger = logging.getLogger("asset_modes")

ASSET_MODES = {"WATCH_ONLY", "ANALYZE_ONLY", "DEMO_TRADE_ALLOWED", "DISABLED"}
DEFAULT_MODE_PATH = CRYPTO_ROOT / "config" / "demo_asset_modes.json"


class AssetModeManager:
    def __init__(self, config_path: str = None):
        self.config_path = Path(config_path or DEFAULT_MODE_PATH)
        self._config = self._load()

    def _load(self) -> Dict[str, Any]:
        try:
            if self.config_path.exists():
                data = json.loads(self.config_path.read_text(encoding="utf-8"))
            else:
                data = {}
        except Exception as exc:
            logger.error("Could not read demo asset modes: %s", exc)
            data = {}

        symbols = data.get("symbols") if isinstance(data.get("symbols"), dict) else {}
        normalized = {}
        for symbol in CONFIG.WATCHLIST:
            mode = str(symbols.get(symbol, "")).upper()
            normalized[symbol] = mode if mode in ASSET_MODES else ("WATCH_ONLY" if symbol == "DOGE/USDT" else "ANALYZE_ONLY")

        return {
            "defaultMode": str(data.get("defaultMode") or "WATCH_ONLY").upper()
            if str(data.get("defaultMode") or "WATCH_ONLY").upper() in ASSET_MODES
            else "WATCH_ONLY",
            "symbols": normalized,
        }

    @staticmethod
    def normalize_symbol(symbol: str) -> str:
        text = str(symbol or "").strip().upper().replace("-", "/")
        if text and "/" not in text and text.endswith("USDT"):
            text = f"{text[:-4]}/USDT"
        return text

    def get_mode(self, symbol: str) -> str:
        normalized = self.normalize_symbol(symbol)
        return self._config["symbols"].get(normalized, self._config["defaultMode"])

    def list_modes(self) -> List[Dict[str, Any]]:
        rows = []
        for symbol in CONFIG.WATCHLIST:
            mode = self.get_mode(symbol)
            rows.append({
                "symbol": symbol,
                "mode": mode,
                "watchEnabled": mode != "DISABLED",
                "analysisEnabled": mode in ("ANALYZE_ONLY", "DEMO_TRADE_ALLOWED"),
                "demoTradingEnabled": mode == "DEMO_TRADE_ALLOWED",
                "liveTradingEnabled": False,
            })
        return rows

    def update_mode(self, symbol: str, mode: str) -> Dict[str, Any]:
        normalized = self.normalize_symbol(symbol)
        next_mode = str(mode or "").strip().upper()
        if normalized not in CONFIG.WATCHLIST:
            return {"ok": False, "error": "SYMBOL_NOT_IN_WATCHLIST", "symbol": normalized}
        if next_mode not in ASSET_MODES:
            return {"ok": False, "error": "INVALID_ASSET_MODE", "allowedModes": sorted(ASSET_MODES)}
        self._config["symbols"][normalized] = next_mode
        self.config_path.parent.mkdir(parents=True, exist_ok=True)
        self.config_path.write_text(json.dumps(self._config, indent=2), encoding="utf-8")
        return {"ok": True, "symbol": normalized, "mode": next_mode, "liveTradingEnabled": False}

    def public_summary(self) -> Dict[str, Any]:
        return {
            "defaultMode": self._config["defaultMode"],
            "allowedModes": sorted(ASSET_MODES),
            "symbols": self.list_modes(),
            "demoTradeAllowedSymbols": [row["symbol"] for row in self.list_modes() if row["demoTradingEnabled"]],
            "liveTradingAllowedSymbols": [],
        }
