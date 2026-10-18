"""Fresh file-based global/local kill guards shared with the owner backend."""
import json
import os
from pathlib import Path
from config import CRYPTO_ROOT, RUNTIME_ROOT


def global_kill_path():
    explicit = os.getenv('EDITH_CRYPTO_GLOBAL_KILL_SWITCH_PATH')
    if explicit:
        return Path(explicit)
    # Managed Crypto lives below EDITH's persistence data directory.
    if RUNTIME_ROOT != CRYPTO_ROOT:
        return RUNTIME_ROOT.parent / 'kill-switch.json'
    return CRYPTO_ROOT.parent / '.edith' / 'kill-switch.json'


def _active(file):
    try:
        if not file.exists():
            return False
        value = json.loads(file.read_text(encoding='utf-8'))
        return value.get('active') if isinstance(value, dict) and isinstance(value.get('active'), bool) else True
    except (OSError, ValueError):
        return True


def kill_reason():
    if _active(global_kill_path()):
        return 'global_kill_switch_active'
    if _active(Path(os.getenv('EDITH_CRYPTO_LOCAL_KILL_SWITCH_PATH', str(RUNTIME_ROOT / 'kill-switch.json')))):
        return 'crypto_kill_switch_active'
    return None
