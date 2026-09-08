"""
Canonical Obsidian vault path resolution for EDITH crypto exports.
Preserves Unicode paths and refuses known Windows console mojibake.
"""
import json
import os
from pathlib import Path
from typing import Any, Dict, Optional

EXPECTED_VAULT_PATH = r"D:\EDİTH\EDİTH"
CRYPTO_OBSIDIAN_FOLDER = "Trading/Crypto Market Learning"
MOJIBAKE_MARKERS = ("─", "░", "�", "\ufffd")


def resolve_obsidian_vault_path(config_path: Optional[Path] = None) -> Dict[str, Any]:
    candidates = [
        ("EDITH_OBSIDIAN_VAULT_PATH", os.getenv("EDITH_OBSIDIAN_VAULT_PATH")),
        ("OBSIDIAN_VAULT_PATH", os.getenv("OBSIDIAN_VAULT_PATH")),
    ]
    config_value = _read_config_path(config_path)
    if config_value:
        candidates.append(("config", config_value))
    candidates.append(("default", EXPECTED_VAULT_PATH))

    source, received = next(
        ((name, value.strip()) for name, value in candidates if value and str(value).strip()),
        ("default", EXPECTED_VAULT_PATH),
    )
    if _looks_mojibake(received):
        return {
            "ok": False,
            "source": source,
            "vaultPath": None,
            "receivedPath": received,
            "expectedPath": EXPECTED_VAULT_PATH,
            "errorCode": "OBSIDIAN_PATH_ENCODING_ERROR",
            "message": "Obsidian vault path contains mojibake and was rejected.",
        }

    return {
        "ok": True,
        "source": source,
        "vaultPath": received,
        "receivedPath": received,
        "expectedPath": EXPECTED_VAULT_PATH,
        "errorCode": None,
        "message": "Obsidian vault path resolved.",
    }


def validate_obsidian_vault_path(value: str, source: str = "explicit") -> Dict[str, Any]:
    received = str(value or "").strip()
    if _looks_mojibake(received):
        return {
            "ok": False,
            "source": source,
            "vaultPath": None,
            "receivedPath": received,
            "expectedPath": EXPECTED_VAULT_PATH,
            "errorCode": "OBSIDIAN_PATH_ENCODING_ERROR",
            "message": "Obsidian vault path contains mojibake and was rejected.",
        }
    return {
        "ok": True,
        "source": source,
        "vaultPath": received or EXPECTED_VAULT_PATH,
        "receivedPath": received or EXPECTED_VAULT_PATH,
        "expectedPath": EXPECTED_VAULT_PATH,
        "errorCode": None,
        "message": "Obsidian vault path resolved.",
    }


def build_obsidian_status(
    enabled: bool,
    vault_path: Optional[Path],
    folder: str = CRYPTO_OBSIDIAN_FOLDER,
    resolution: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    resolution = resolution or {}
    received_path = resolution.get("receivedPath") or (str(vault_path) if vault_path else None)
    expected_path = resolution.get("expectedPath", EXPECTED_VAULT_PATH)
    error_code = resolution.get("errorCode")

    base = {
        "enabled": bool(enabled),
        "vaultPath": str(vault_path) if vault_path else None,
        "folder": folder,
        "resolvedPath": str((vault_path / folder).resolve()) if vault_path else None,
        "vaultPathConfigured": False,
        "available": False,
        "writable": False,
        "status": "disabled" if not enabled else "configuration_required",
        "errorCode": error_code,
        "expectedPath": expected_path,
        "receivedPath": received_path,
    }
    if not enabled:
        return base
    if error_code:
        return base
    if not vault_path or not vault_path.exists() or not vault_path.is_dir():
        return base

    target = (vault_path / folder).resolve()
    try:
        target.mkdir(parents=True, exist_ok=True)
        probe = target / ".edith_crypto_write_probe.tmp"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink(missing_ok=True)
    except Exception as exc:
        return {
            **base,
            "vaultPathConfigured": True,
            "available": True,
            "status": "not_writable",
            "errorCode": "OBSIDIAN_PATH_NOT_WRITABLE",
            "error": str(exc),
        }

    return {
        **base,
        "vaultPathConfigured": True,
        "available": True,
        "writable": True,
        "status": "connected",
        "errorCode": None,
    }


def _read_config_path(config_path: Optional[Path]) -> Optional[str]:
    if not config_path or not config_path.exists():
        return None
    try:
        with config_path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
    except Exception:
        return None
    for key in ("edithObsidianVaultPath", "obsidianVaultPath", "vaultPath"):
        value = data.get(key)
        if value:
            return str(value)
    return None


def _looks_mojibake(value: str) -> bool:
    if any(marker in value for marker in MOJIBAKE_MARKERS):
        return True
    normalized = value.upper()
    return "ED" in normalized and "TH" in normalized and "EDİTH" not in value and "D:" in normalized
