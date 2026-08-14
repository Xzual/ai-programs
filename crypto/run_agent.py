"""
Main entry point for the Autonomous Crypto Trading Agent.
Starts both the Agent loop and the Web Dashboard.
"""
import sys
import os
import threading
import time
import logging

# Add src to path
sys.path.append(os.path.join(os.path.dirname(__file__), 'src'))

def setup_directories():
    """Create necessary directories if they don't exist."""
    import os as _os
    from pathlib import Path
    # Read config without triggering imports that use LOG_DIR
    _os.makedirs('data', exist_ok=True)
    _os.makedirs('logs', exist_ok=True)

# Ensure dirs exist BEFORE any module-level FileHandler is created
setup_directories()

from agent import CryptoAgent
from dashboard import run_dashboard
from config import CONFIG

def main():
    print("="*52)
    print(">>  OTONOM KRIPTO TRADING AGENT BASLATILIYOR")
    print("="*52)
    print(f"Model        : {CONFIG.LLM_MODEL}")
    print(f"Dongü Suresi : {CONFIG.LOOP_INTERVAL_MINUTES} dakika")
    print(f"Izleme Lst.  : {', '.join(CONFIG.WATCHLIST)}")
    print(f"Dashboard    : http://localhost:5000")
    print("="*52)

    # Initialize Agent
    agent = CryptoAgent()

    # Start Dashboard in a separate thread
    dashboard_thread = threading.Thread(
        target=run_dashboard, 
        kwargs={"port": 5000}, 
        daemon=True
    )
    dashboard_thread.start()

    # Start Agent loop in the main thread
    try:
        agent.start()
    except KeyboardInterrupt:
        print("\nKapatılıyor...")
        agent.stop()
        sys.exit(0)

if __name__ == "__main__":
    main()
