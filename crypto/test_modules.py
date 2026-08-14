"""
Module-level integration test for the Crypto Agent project.
Run with: .venv/Scripts/python.exe test_modules.py
"""
import sys
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
os.chdir(BASE_DIR)
sys.path.insert(0, str(BASE_DIR / 'src'))
os.makedirs(BASE_DIR / 'data', exist_ok=True)
os.makedirs(BASE_DIR / 'logs', exist_ok=True)

errors = []

# ── Config ────────────────────────────────────────────────────────────────────
print("=== Testing config ===")
try:
    from config import CONFIG
    print(f"  Model: {CONFIG.LLM_MODEL}, Exchange: {CONFIG.EXCHANGE_ID}  [OK]")
except Exception as e:
    errors.append(f"config: {e}")
    print(f"  ERROR: {e}")

# ── MemoryManager ─────────────────────────────────────────────────────────────
print("=== Testing memory_manager ===")
try:
    from memory_manager import MemoryManager
    mem = MemoryManager()
    mem.save_market_snapshot("TEST/USDT", 1.0, {"test": True})
    decisions = mem.get_recent_decisions(limit=3)
    print(f"  MemoryManager OK, recent decisions: {len(decisions)}  [OK]")
except Exception as e:
    errors.append(f"memory_manager: {e}")
    print(f"  ERROR: {e}")

# ── MarketDataFetcher ─────────────────────────────────────────────────────────
print("=== Testing market_data (live network) ===")
df = None
try:
    from market_data import MarketDataFetcher
    mdf = MarketDataFetcher()
    df = mdf.fetch_ohlcv("BTC/USDT", timeframe="1h", limit=100)
    if df is not None:
        print(f"  fetch_ohlcv OK: {len(df)} rows  [OK]")
    else:
        errors.append("market_data: fetch_ohlcv returned None")
        print("  fetch_ohlcv returned None  [FAIL]")
except Exception as e:
    errors.append(f"market_data: {e}")
    print(f"  ERROR: {e}")

# ── TechnicalAnalyzer ─────────────────────────────────────────────────────────
print("=== Testing technical_analysis ===")
ta_result = None
try:
    from technical_analysis import TechnicalAnalyzer
    ta = TechnicalAnalyzer()
    if df is not None:
        ta_result = ta.analyze(df)
        if ta_result:
            print(f"  TA OK: close={ta_result['close']}, rsi={ta_result['rsi']}  [OK]")
        else:
            errors.append("technical_analysis: analyze returned None")
            print("  analyze returned None  [FAIL]")
    else:
        print("  Skipped (no OHLCV data)")
except Exception as e:
    errors.append(f"technical_analysis: {e}")
    print(f"  ERROR: {e}")
    import traceback; traceback.print_exc()

# ── NewsCollector ─────────────────────────────────────────────────────────────
print("=== Testing news_collector ===")
try:
    from news_collector import NewsCollector
    nc = NewsCollector(mem)
    news = nc.collect_all()
    print(f"  NewsCollector OK: {len(news)} items  [OK]")
except Exception as e:
    errors.append(f"news_collector: {e}")
    print(f"  ERROR: {e}")

# ── RiskManager ───────────────────────────────────────────────────────────────
print("=== Testing risk_manager ===")
try:
    from risk_manager import RiskManager
    rm = RiskManager()
    is_valid, reason, params = rm.validate_trade("BUY", "BTC/USDT", 50000.0, 10000.0, [])
    print(f"  validate_trade BUY -> valid={is_valid}, reason={reason}  [OK]")
    is_valid2, reason2, params2 = rm.validate_trade("SELL", "BTC/USDT", 50000.0, 10000.0, [])
    print(f"  validate_trade SELL no-pos -> valid={is_valid2}, reason={reason2}  [OK]")
    # SL/TP check
    pos = {"symbol": "BTC/USDT", "amount": 0.1, "entry_price": 50000.0, "stop_loss": 48000.0, "take_profit": 53000.0}
    signal = rm.check_sl_tp("BTC/USDT", 47000.0, pos)
    print(f"  check_sl_tp SL-hit -> {signal}  [OK]")
    signal2 = rm.check_sl_tp("BTC/USDT", 54000.0, pos)
    print(f"  check_sl_tp TP-hit -> {signal2}  [OK]")
except Exception as e:
    errors.append(f"risk_manager: {e}")
    print(f"  ERROR: {e}")
    import traceback; traceback.print_exc()

# ── PaperTradingEngine ────────────────────────────────────────────────────────
print("=== Testing paper_trading_engine ===")
try:
    from paper_trading_engine import PaperTradingEngine
    pt = PaperTradingEngine(mem)
    print(f"  Initial balance: {pt.get_balance()}  [OK]")
    # BUY
    ok = pt.execute_trade("BTC/USDT", "BUY", 0.001, 50000.0, decision_id=1, sl=49000.0, tp=52000.0)
    print(f"  execute_trade BUY -> {ok}, balance={pt.get_balance()}  [OK]")
    positions = pt.get_open_positions()
    print(f"  get_open_positions -> {len(positions)} positions  [OK]")
    # SELL
    if positions:
        ok2 = pt.execute_trade("BTC/USDT", "SELL", positions[0]['amount'], 51000.0, decision_id=1)
        print(f"  execute_trade SELL -> {ok2}, balance={pt.get_balance()}  [OK]")
    equity = pt.get_total_equity({"BTC/USDT": 50000.0})
    print(f"  get_total_equity -> {equity}  [OK]")
except Exception as e:
    errors.append(f"paper_trading_engine: {e}")
    print(f"  ERROR: {e}")
    import traceback; traceback.print_exc()

# ── LLMDecisionEngine ─────────────────────────────────────────────────────────
print("=== Testing llm_decision_engine (Ollama connection) ===")
try:
    from llm_decision_engine import LLMDecisionEngine
    llm = LLMDecisionEngine()
    print(f"  LLMDecisionEngine initialized, URL: {llm.url}  [OK]")
    if ta_result:
        decision = llm.get_decision(
            "BTC/USDT", ta_result, [],
            {"balance": 10000.0, "positions": []}, []
        )
        if decision:
            print(f"  get_decision -> action={decision.get('action')}, confidence={decision.get('confidence')}  [OK]")
        else:
            print("  get_decision returned None  [WARN]")
    else:
        print("  Skipped (no TA result)")
except Exception as e:
    errors.append(f"llm_decision_engine: {e}")
    print(f"  ERROR: {e}")

# ── ResultAnalyzer ────────────────────────────────────────────────────────────
print("=== Testing result_analyzer ===")
try:
    from result_analyzer import ResultAnalyzer
    from llm_decision_engine import LLMDecisionEngine
    llm2 = LLMDecisionEngine()
    ra = ResultAnalyzer(mem, llm2)
    print("  ResultAnalyzer initialized  [OK]")
except Exception as e:
    errors.append(f"result_analyzer: {e}")
    print(f"  ERROR: {e}")

# ── Dashboard import ──────────────────────────────────────────────────────────
print("=== Testing dashboard import ===")
try:
    from dashboard import app
    with app.test_client() as client:
        r = client.get('/health')
        print(f"  /health -> {r.status_code}  [OK]")
        r2 = client.get('/')
        print(f"  / (dashboard) -> {r2.status_code}  [OK]")
        r3 = client.get('/api/overview')
        print(f"  /api/overview -> {r3.status_code}  [OK]")
        r4 = client.get('/api/trades')
        print(f"  /api/trades -> {r4.status_code}  [OK]")
        r5 = client.get('/api/decisions')
        print(f"  /api/decisions -> {r5.status_code}  [OK]")
        r6 = client.get('/api/news')
        print(f"  /api/news -> {r6.status_code}  [OK]")
        r7 = client.get('/api/markets')
        print(f"  /api/markets -> {r7.status_code}  [OK]")
        r8 = client.get('/api/analysis')
        print(f"  /api/analysis -> {r8.status_code}  [OK]")
        r9 = client.get('/api/risk')
        print(f"  /api/risk -> {r9.status_code}  [OK]")
        r10 = client.get('/api/market-sentiment')
        print(f"  /api/market-sentiment -> {r10.status_code}  [OK]")
        r11 = client.get('/api/decision-timeline')
        print(f"  /api/decision-timeline -> {r11.status_code}  [OK]")
        r12 = client.get('/api/strategy-comparison')
        print(f"  /api/strategy-comparison -> {r12.status_code}  [OK]")
except Exception as e:
    errors.append(f"dashboard: {e}")
    print(f"  ERROR: {e}")
    import traceback; traceback.print_exc()

# ── Summary ───────────────────────────────────────────────────────────────────
print()
print("=" * 60)
if errors:
    print(f"FAILED: {len(errors)} error(s) found:")
    for err in errors:
        print(f"  - {err}")
else:
    print("ALL TESTS PASSED!")
print("=" * 60)
sys.exit(1 if errors else 0)
