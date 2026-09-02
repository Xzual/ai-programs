"""
Coin/category permission profiles for safe crypto monitoring and paper trading.
No secrets belong in this module or its JSON config.
"""
import copy
import json
import logging
from pathlib import Path
from typing import Any, Dict, List

from config import CONFIG

logger = logging.getLogger("coin_permissions")

DEFAULT_POLICY = {
    "category": "custom",
    "watchEnabled": False,
    "paperTradingEnabled": False,
    "liveTradingEnabled": False,
    "decisionEnabled": False,
    "maxPositionUSDT": 0.0,
    "maxPortfolioAllocationPct": 0.0,
    "riskLevel": "high",
    "requiresApproval": True,
    "notes": "Default deny fallback.",
}


class CoinPermissionManager:
    def __init__(self, config_path: str = None):
        self.config_path = Path(config_path or CONFIG.PERMISSIONS_CONFIG_PATH)
        self._raw = self._load_config()
        self.observer_config_path = Path(CONFIG.OBSERVER_CONFIG_PATH)
        self._observer = self._load_observer_config()

    def _load_config(self) -> Dict[str, Any]:
        if not self.config_path.exists():
            logger.warning("Coin permission config missing at %s; using safe default deny.", self.config_path)
            return {
                "mode": "paper",
                "defaultPolicy": copy.deepcopy(DEFAULT_POLICY),
                "categoryRules": {},
                "symbolRules": {},
            }

        try:
            with self.config_path.open("r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception as exc:
            logger.error("Could not load coin permission config: %s", exc)
            return {
                "mode": "paper",
                "defaultPolicy": copy.deepcopy(DEFAULT_POLICY),
                "categoryRules": {},
                "symbolRules": {},
            }

        data.setdefault("defaultPolicy", copy.deepcopy(DEFAULT_POLICY))
        data.setdefault("categoryRules", {})
        data.setdefault("symbolRules", {})
        return data

    def reload(self):
        self._raw = self._load_config()
        self._observer = self._load_observer_config()

    def _load_observer_config(self) -> Dict[str, Any]:
        safe = {
            "mode": "OBSERVER_ONLY",
            "watchlist": list(CONFIG.WATCHLIST),
            "ignoredSymbols": [],
            "analysisEnabled": True,
            "tradingEnabled": False,
            "paperTradingEnabled": False,
            "liveTradingEnabled": False,
            "obsidianExportEnabled": False,
        }
        if not self.observer_config_path.exists():
            return safe
        try:
            with self.observer_config_path.open("r", encoding="utf-8") as f:
                data = json.load(f)
            safe.update(data or {})
        except Exception as exc:
            logger.error("Could not load observer config: %s", exc)
        return safe

    def get_default_policy(self) -> Dict[str, Any]:
        policy = copy.deepcopy(DEFAULT_POLICY)
        policy.update(self._raw.get("defaultPolicy") or {})
        return self._normalize_policy(policy)

    def get_category_rules(self) -> Dict[str, Dict[str, Any]]:
        return {
            category: self._normalize_policy({**self.get_default_policy(), **(rule or {}), "category": category})
            for category, rule in (self._raw.get("categoryRules") or {}).items()
        }

    def get_symbol_rules(self) -> Dict[str, Dict[str, Any]]:
        return self._raw.get("symbolRules") or {}

    def get_profile(self, symbol: str) -> Dict[str, Any]:
        symbol = self.normalize_symbol(symbol)
        symbol_rule = copy.deepcopy(self.get_symbol_rules().get(symbol) or {})
        category = symbol_rule.get("category") or self.get_default_policy().get("category", "custom")

        profile = self.get_default_policy()
        category_rule = copy.deepcopy((self._raw.get("categoryRules") or {}).get(category) or {})
        profile.update(category_rule)
        profile.update(symbol_rule)
        profile["symbol"] = symbol
        profile["category"] = profile.get("category") or category
        ignored = symbol in self.get_ignored_symbols()
        if ignored:
            profile["watchEnabled"] = False
            profile["decisionEnabled"] = False
            profile["paperTradingEnabled"] = False
            profile["liveTradingEnabled"] = False
            profile["notes"] = "Ignored by observer config."
        profile["_blockedByCategory"] = (
            category_rule.get("watchEnabled") is False
            and "watchEnabled" not in symbol_rule
        )
        profile["_hasSymbolRule"] = bool(symbol_rule)
        profile["_ignoredByObserver"] = ignored
        return self._normalize_policy(profile)

    def get_watchlist(self) -> List[str]:
        symbols = [self.normalize_symbol(sym) for sym in (self._observer.get("watchlist") or [])]
        if not symbols:
            symbols = list((self._raw.get("symbolRules") or {}).keys()) or list(CONFIG.WATCHLIST)
        watched = [self.normalize_symbol(sym) for sym in symbols if self.get_profile(sym).get("watchEnabled")]
        return list(dict.fromkeys(watched))

    def get_ignored_symbols(self) -> List[str]:
        return [self.normalize_symbol(sym) for sym in (self._observer.get("ignoredSymbols") or [])]

    def get_observer_config(self) -> Dict[str, Any]:
        cfg = copy.deepcopy(self._observer)
        cfg["watchlist"] = [self.normalize_symbol(sym) for sym in (cfg.get("watchlist") or [])]
        cfg["ignoredSymbols"] = self.get_ignored_symbols()
        cfg["tradingEnabled"] = False
        cfg["paperTradingEnabled"] = bool(cfg.get("paperTradingEnabled", False)) and CONFIG.TRADING_MODE == "PAPER_TRADING"
        cfg["liveTradingEnabled"] = False
        return cfg

    def get_profiles(self) -> List[Dict[str, Any]]:
        symbols = set(CONFIG.WATCHLIST)
        symbols.update((self._raw.get("symbolRules") or {}).keys())
        return [self.get_profile(symbol) for symbol in sorted(symbols)]

    def is_watch_enabled(self, symbol: str) -> bool:
        return bool(self.get_profile(symbol).get("watchEnabled"))

    def public_summary(self) -> Dict[str, Any]:
        profiles = self.get_profiles()
        categories = self.get_category_rules()
        return {
            "mode": (self._raw.get("mode") or "paper").upper(),
            "observerConfig": self.get_observer_config(),
            "config_path": str(self.config_path),
            "defaultPolicy": self.get_default_policy(),
            "categoryRules": categories,
            "symbols": profiles,
            "watchlist": [p["symbol"] for p in profiles if p.get("watchEnabled")],
            "blockedSymbols": [p["symbol"] for p in profiles if not p.get("watchEnabled")],
            "watchOnlySymbols": [
                p["symbol"]
                for p in profiles
                if p.get("watchEnabled") and (not p.get("decisionEnabled") or not p.get("paperTradingEnabled"))
            ],
            "paperTradingAllowedSymbols": [
                p["symbol"]
                for p in profiles
                if p.get("watchEnabled") and p.get("decisionEnabled") and p.get("paperTradingEnabled")
            ],
            "liveTradingAllowedSymbols": [],
        }

    @staticmethod
    def normalize_symbol(symbol: str) -> str:
        return (symbol or "").strip().upper()

    @staticmethod
    def _normalize_policy(policy: Dict[str, Any]) -> Dict[str, Any]:
        normalized = copy.deepcopy(policy)
        for key in ("watchEnabled", "paperTradingEnabled", "liveTradingEnabled", "decisionEnabled", "requiresApproval"):
            normalized[key] = bool(normalized.get(key, False))
        for key in ("maxPositionUSDT", "maxPortfolioAllocationPct"):
            try:
                normalized[key] = float(normalized.get(key, 0) or 0)
            except (TypeError, ValueError):
                normalized[key] = 0.0
        normalized["riskLevel"] = str(normalized.get("riskLevel") or "high").lower()
        normalized["category"] = str(normalized.get("category") or "custom").lower()
        return normalized
