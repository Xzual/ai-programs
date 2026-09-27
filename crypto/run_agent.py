"""
Main entry point for the EDITH Crypto Observer service.
Starts the API/dashboard only; market observation is controlled manually.
"""
import os
import sys
import threading
import logging
import signal
import secrets
from pathlib import Path
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent


def _resolved_directory(environment_name, fallback):
    value = os.getenv(environment_name, "").strip()
    candidate = Path(value).expanduser() if value else Path(fallback)
    return candidate.resolve()


configured_resource_dir = os.getenv("EDITH_CRYPTO_RESOURCE_DIR", "").strip()
if configured_resource_dir and _resolved_directory("EDITH_CRYPTO_RESOURCE_DIR", BASE_DIR) != BASE_DIR:
    raise RuntimeError("EDITH_CRYPTO_RESOURCE_DIR must identify the directory containing run_agent.py")
os.environ["EDITH_CRYPTO_RESOURCE_DIR"] = str(BASE_DIR)

runtime_root = _resolved_directory("EDITH_CRYPTO_RUNTIME_DATA_DIR", BASE_DIR)
os.environ.setdefault("CRYPTO_DATA_DIR", str(runtime_root / "data" if runtime_root != BASE_DIR else BASE_DIR / "data"))
os.environ.setdefault("CRYPTO_LOG_DIR", str(runtime_root / "logs" if runtime_root != BASE_DIR else BASE_DIR / "logs"))
os.environ.setdefault("CRYPTO_DB_PATH", str(Path(os.environ["CRYPTO_DATA_DIR"]) / "agent_memory.db"))

if os.getenv("EDITH_PACKAGED", "").strip().lower() not in {"1", "true", "yes"}:
    load_dotenv(BASE_DIR.parent / ".env", override=False)
os.environ.setdefault("PYTHONUTF8", "1")
os.environ.setdefault("PYTHONIOENCODING", "utf-8")
os.environ.setdefault("CRYPTO_MODE", "OBSERVER_ONLY")
os.environ.setdefault("CRYPTO_TRADING_ENABLED", "false")
os.environ.setdefault("CRYPTO_PAPER_TRADING_ENABLED", "false")
os.environ.setdefault("CRYPTO_LIVE_TRADING_ENABLED", "false")
os.environ.setdefault("CRYPTO_DEMO_TRADING_ENABLED", "true")
os.environ.setdefault("CRYPTO_STARTING_BALANCE", "10000")
os.environ.setdefault("CRYPTO_DECISION_MODEL", "jev")
os.environ.setdefault("CRYPTO_OBSIDIAN_ENABLED", "false")
os.environ.setdefault("CRYPTO_LEARNING_ENABLED", "false")
os.environ.setdefault("CRYPTO_NEWS_ENABLED", "false")
os.environ.setdefault("CRYPTO_OLLAMA_ENABLED", "false")
os.environ.setdefault("BINANCE_TRADING_ENABLED", "false")
os.environ.setdefault("ENABLE_LIVE_TRADING", "false")
os.environ.setdefault("EDITH_CRYPTO_INTERNAL_TOKEN", secrets.token_urlsafe(32))
if os.getenv("EDITH_OBSIDIAN_VAULT_PATH") and not os.getenv("OBSIDIAN_VAULT_PATH"):
    os.environ["OBSIDIAN_VAULT_PATH"] = os.environ["EDITH_OBSIDIAN_VAULT_PATH"]

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

# Import only from the resource tree that contains this entry point.
sys.path.insert(0, str(BASE_DIR / "src"))

def setup_directories():
    """Create writable state directories before importing modules with handlers."""
    Path(os.environ["CRYPTO_DATA_DIR"]).mkdir(parents=True, exist_ok=True)
    Path(os.environ["CRYPTO_LOG_DIR"]).mkdir(parents=True, exist_ok=True)
    Path(os.environ["CRYPTO_DB_PATH"]).parent.mkdir(parents=True, exist_ok=True)

# Ensure dirs exist BEFORE any module-level FileHandler is created
setup_directories()

from dashboard import run_dashboard, jev_loop_controller
from config import CONFIG
from runtime_controller import runtime_controller

def main():
    shutdown_requested = threading.Event()
    port = int(os.getenv("CRYPTO_PORT", "5000"))
    if not 1024 <= port <= 65535:
        raise ValueError("CRYPTO_PORT must be between 1024 and 65535")

    def request_shutdown(signum=None, _frame=None):
        signal_name = signal.Signals(signum).name if signum else "KeyboardInterrupt"
        print(f"\nKapatiliyor... ({signal_name})")
        try:
            runtime_controller.stop_observer()
        except Exception:
            logging.exception("Crypto observer shutdown failed.")
        try:
            jev_loop_controller.stop(timeout_seconds=25)
        except Exception:
            logging.exception("Jev demo loop shutdown failed.")
        shutdown_requested.set()

    signal.signal(signal.SIGINT, request_shutdown)
    signal.signal(signal.SIGTERM, request_shutdown)

    print("="*52)
    print(">>  EDITH CRYPTO OBSERVER SERVICE BASLATILIYOR")
    print("="*52)
    jev_required = ("JEV_API_KEY",)
    jev_missing = [name for name in jev_required if not os.getenv(name, "").strip()]
    jev_state = "CONFIGURED" if not jev_missing else f"CONFIG_REQUIRED: {', '.join(jev_missing)}"
    print(f"Decision     : Jev ({jev_state})")
    print(f"Mode         : {CONFIG.TRADING_MODE}")
    print(f"Trading      : {'ENABLED' if CONFIG.CRYPTO_TRADING_ENABLED else 'DISABLED'}")
    print(f"Paper        : {'ENABLED' if CONFIG.PAPER_TRADING else 'DISABLED'}")
    print(f"Live         : {'ENABLED' if CONFIG.live_trading_active else 'DISABLED'}")
    print("Demo Hesap   : 10,000 kredi / manuel + Jev demo karar")
    print(f"Izleme Lst.  : {', '.join(CONFIG.WATCHLIST)}")
    print(f"Dashboard    : http://localhost:{port}")
    print("Obsidian     : DISABLED FOR THIS PHASE")
    print("News/Learning: DISABLED FOR THIS PHASE")
    print("Ollama       : DISABLED FOR THIS PHASE")
    print(f"Jev Loop     : MANUAL START / {CONFIG.JEV_LOOP_DEFAULT_INTERVAL_SECONDS}s interval")
    print("="*52)

    # Start Dashboard/API; observer lifecycle is handled by safe runtime endpoints.
    dashboard_thread = threading.Thread(
        target=run_dashboard, 
        kwargs={"port": port},
        daemon=True
    )
    dashboard_thread.start()
    try:
        while dashboard_thread.is_alive() and not shutdown_requested.is_set():
            shutdown_requested.wait(1)
    except KeyboardInterrupt:
        request_shutdown()
    sys.exit(0)

if __name__ == "__main__":
    main()
