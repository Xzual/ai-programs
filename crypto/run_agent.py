"""
Main entry point for the EDITH Crypto Observer service.
Starts the API/dashboard only; market observation is controlled manually.
"""
import sys
import os
import threading
import time
import logging
import signal
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
os.chdir(BASE_DIR)
os.environ.setdefault("PYTHONUTF8", "1")
os.environ.setdefault("PYTHONIOENCODING", "utf-8")
os.environ.setdefault("CRYPTO_MODE", "OBSERVER_ONLY")
os.environ.setdefault("CRYPTO_TRADING_ENABLED", "false")
os.environ.setdefault("CRYPTO_PAPER_TRADING_ENABLED", "false")
os.environ.setdefault("CRYPTO_LIVE_TRADING_ENABLED", "false")
os.environ.setdefault("CRYPTO_OBSIDIAN_ENABLED", "true")
os.environ.setdefault("EDITH_OBSIDIAN_VAULT_PATH", r"D:\EDİTH\EDİTH")
os.environ.setdefault("OBSIDIAN_VAULT_PATH", os.environ["EDITH_OBSIDIAN_VAULT_PATH"])

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

# Add src to path
sys.path.append(str(BASE_DIR / 'src'))

def setup_directories():
    """Create necessary directories if they don't exist."""
    import os as _os
    from pathlib import Path
    # Read config without triggering imports that use LOG_DIR
    _os.makedirs('data', exist_ok=True)
    _os.makedirs('logs', exist_ok=True)

# Ensure dirs exist BEFORE any module-level FileHandler is created
setup_directories()

from dashboard import run_dashboard
from config import CONFIG
from runtime_controller import runtime_controller

def main():
    shutdown_requested = threading.Event()

    def request_shutdown(signum=None, _frame=None):
        signal_name = signal.Signals(signum).name if signum else "KeyboardInterrupt"
        print(f"\nKapatiliyor... ({signal_name})")
        try:
            runtime_controller.stop_observer()
        except Exception:
            logging.exception("Crypto observer shutdown failed.")
        shutdown_requested.set()

    signal.signal(signal.SIGINT, request_shutdown)
    signal.signal(signal.SIGTERM, request_shutdown)

    print("="*52)
    print(">>  EDITH CRYPTO OBSERVER SERVICE BASLATILIYOR")
    print("="*52)
    print(f"Model        : {CONFIG.LLM_MODEL}")
    print(f"Mode         : {CONFIG.TRADING_MODE}")
    print(f"Trading      : {'ENABLED' if CONFIG.CRYPTO_TRADING_ENABLED else 'DISABLED'}")
    print(f"Paper        : {'ENABLED' if CONFIG.PAPER_TRADING else 'DISABLED'}")
    print(f"Live         : {'ENABLED' if CONFIG.live_trading_active else 'DISABLED'}")
    print(f"Dongu Suresi : {CONFIG.LOOP_INTERVAL_MINUTES} dakika")
    print(f"Izleme Lst.  : {', '.join(CONFIG.WATCHLIST)}")
    print(f"Dashboard    : http://localhost:5000")
    if CONFIG.OBSIDIAN_PATH_ERROR_CODE:
        print(f"Obsidian     : ERROR {CONFIG.OBSIDIAN_PATH_ERROR_CODE}")
        print(f"Received     : {CONFIG.OBSIDIAN_PATH_RECEIVED}")
        print(f"Expected     : {CONFIG.OBSIDIAN_PATH_EXPECTED}")
    else:
        print(f"Obsidian     : {CONFIG.EDITH_OBSIDIAN_VAULT_PATH}\\Trading\\Crypto Market Learning")
    print("Observer     : STOPPED (manual UI/API start required)")
    print("="*52)

    # Start Dashboard/API; observer lifecycle is handled by safe runtime endpoints.
    dashboard_thread = threading.Thread(
        target=run_dashboard, 
        kwargs={"port": 5000}, 
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
