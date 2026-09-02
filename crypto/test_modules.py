"""
Module-level integration test for the Crypto Agent project.
Run with: .venv/Scripts/python.exe test_modules.py
"""
import sys
import os
import json
import tempfile
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
os.chdir(BASE_DIR)
sys.path.insert(0, str(BASE_DIR / 'src'))
os.makedirs(BASE_DIR / 'data', exist_ok=True)
os.makedirs(BASE_DIR / 'logs', exist_ok=True)
TEST_DB = BASE_DIR / 'data' / 'test_agent_memory.db'
if TEST_DB.exists():
    TEST_DB.unlink()
os.environ['CRYPTO_DB_PATH'] = str(TEST_DB)

errors = []

# ── Config ────────────────────────────────────────────────────────────────────
print("=== Testing config ===")
try:
    from config import CONFIG
    print(f"  Model: {CONFIG.LLM_MODEL}, Exchange: {CONFIG.EXCHANGE_ID}  [OK]")
    assert CONFIG.TRADING_MODE == "OBSERVER_ONLY"
    assert CONFIG.PAPER_TRADING is False
    assert CONFIG.EDITH_OBSIDIAN_VAULT_PATH == r"D:\EDİTH\EDİTH"
    assert "İ" in CONFIG.EDITH_OBSIDIAN_VAULT_PATH
    print("  Default mode OBSERVER_ONLY with paper trading disabled  [OK]")
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

# ── Coin Permissions ─────────────────────────────────────────────────────────
print("=== Testing coin_permissions ===")
try:
    from coin_permissions import CoinPermissionManager
    from risk_manager import RiskManager

    perms = CoinPermissionManager()
    btc = perms.get_profile("BTC/USDT")
    doge = perms.get_profile("DOGE/USDT")
    assert btc["watchEnabled"] and btc["paperTradingEnabled"] and btc["decisionEnabled"]
    assert doge["watchEnabled"] and not doge["paperTradingEnabled"] and not doge["decisionEnabled"]
    print("  BTC allowed, DOGE watch-only profile  [OK]")

    rm_perms = RiskManager(perms)
    ok, code, profile = rm_perms.validate_symbol_access("BTC/USDT")
    assert ok and code == "WATCH_ENABLED"
    doge_ok, doge_code, _ = rm_perms.validate_trade("BUY", "DOGE/USDT", 0.1, 10000.0, [])
    assert not doge_ok and doge_code == "DECISION_DISABLED"
    live_ok, live_code, _ = rm_perms.validate_trade("BUY", "BTC/USDT", 50000.0, 10000.0, [], execution_mode="LIVE")
    assert not live_ok and live_code == "LIVE_TRADING_DISABLED"
    print("  Permission and live-disabled risk gates  [OK]")

    with tempfile.TemporaryDirectory() as td:
        cfg_path = Path(td) / "coin_permissions.json"
        cfg_path.write_text(json.dumps({
            "defaultPolicy": {
                "watchEnabled": False,
                "paperTradingEnabled": False,
                "liveTradingEnabled": False,
                "decisionEnabled": False,
                "requiresApproval": True
            },
            "categoryRules": {
                "majors": {
                    "watchEnabled": True,
                    "paperTradingEnabled": True,
                    "liveTradingEnabled": False,
                    "decisionEnabled": True,
                    "requiresApproval": False,
                    "maxPositionUSDT": 1000,
                    "maxPortfolioAllocationPct": 10
                },
                "defi": {
                    "watchEnabled": False,
                    "paperTradingEnabled": False,
                    "liveTradingEnabled": False,
                    "decisionEnabled": False,
                    "requiresApproval": True
                }
            },
            "symbolRules": {
                "BTC/USDT": {"category": "majors", "watchEnabled": False},
                "UNI/USDT": {"category": "defi"},
                "LTC/USDT": {
                    "category": "majors",
                    "watchEnabled": True,
                    "paperTradingEnabled": True,
                    "decisionEnabled": True,
                    "requiresApproval": True
                }
            }
        }), encoding="utf-8")
        custom_perms = CoinPermissionManager(str(cfg_path))
        custom_rm = RiskManager(custom_perms)
        btc_ok, btc_code, _ = custom_rm.validate_symbol_access("BTC/USDT")
        uni_ok, uni_code, _ = custom_rm.validate_symbol_access("UNI/USDT")
        ltc_ok, ltc_code, _ = custom_rm.validate_trade("BUY", "LTC/USDT", 100.0, 10000.0, [])
        assert not btc_ok and btc_code == "SYMBOL_BLOCKED"
        assert not uni_ok and uni_code == "CATEGORY_BLOCKED"
        assert not ltc_ok and ltc_code == "APPROVAL_REQUIRED"
    print("  Blocked symbol, disabled category, approval-required gates  [OK]")

    missing_perms = CoinPermissionManager(str(BASE_DIR / "config" / "missing_coin_permissions.json"))
    missing_profile = missing_perms.get_profile("BTC/USDT")
    assert not missing_profile["watchEnabled"] and not missing_profile["paperTradingEnabled"]
    print("  Missing config falls back to safe deny  [OK]")
except Exception as e:
    errors.append(f"coin_permissions: {e}")
    print(f"  ERROR: {e}")
    import traceback; traceback.print_exc()

# ── Observer Mode ────────────────────────────────────────────────────────────
print("=== Testing observer mode ===")
try:
    from agent import CryptoAgent
    from risk_manager import RiskManager
    from llm_decision_engine import LLMDecisionEngine

    class FakePermissions:
        def get_watchlist(self):
            return ["BTC/USDT"]
        def get_observer_config(self):
            return {"analysisEnabled": True, "obsidianExportEnabled": False}
        def get_profile(self, symbol):
            return {"symbol": symbol, "category": "majors", "watchEnabled": True, "decisionEnabled": True, "paperTradingEnabled": False, "liveTradingEnabled": False, "requiresApproval": False}
        @staticmethod
        def normalize_symbol(symbol):
            return symbol

    class FakeMemory:
        def __init__(self):
            self.observations = []
            self.portfolio_updates = 0
        def save_permission_event(self, *args, **kwargs): pass
        def save_market_snapshot(self, *args, **kwargs): pass
        def get_recent_observations(self, *args, **kwargs): return []
        def save_market_observation(self, observation, **kwargs):
            self.observations.append(observation)
            return 1
        def save_analysis_log(self, *args, **kwargs): pass
        def update_portfolio(self, *args, **kwargs):
            self.portfolio_updates += 1

    class FakeMarketData:
        def fetch_ohlcv(self, *args, **kwargs): return object()

    class FakeTA:
        def analyze(self, df):
            return {"close": 50000.0, "summary": "neutral observer snapshot", "trend": "neutral", "rsi": 50, "macd_signal": "neutral", "bb_position": "middle", "atr": 1, "vwap": 50000}

    class FakeNews:
        def collect_all(self): return []

    class FakeLLM:
        def get_market_observation(self, symbol, ta, news, previous):
            return {"symbol": symbol, "mode": "OBSERVER_ONLY", "market_regime": "neutral", "trend": "neutral", "volatility": "medium", "technical_summary": ta["summary"], "learning_note": "Observe first.", "risk_note": "No advice.", "confidence": 0.5, "not_financial_advice": True}
        def get_decision(self, *args, **kwargs):
            raise AssertionError("Observer mode must not ask for trading decisions")

    class FakeObsidian:
        def export_observation(self, observation):
            return {"status": "disabled", "last_export_path": None}

    class FakePaper:
        def execute_trade(self, *args, **kwargs):
            raise AssertionError("Observer mode must not execute paper trades")
        def get_balance(self): return 10000.0
        def get_total_equity(self, prices): return 10000.0
        def get_open_positions(self): return []

    fake_memory = FakeMemory()
    agent = CryptoAgent.__new__(CryptoAgent)
    agent.memory = fake_memory
    agent.permissions = FakePermissions()
    agent.market_data = FakeMarketData()
    agent.ta = FakeTA()
    agent.news = FakeNews()
    agent.risk = RiskManager(agent.permissions)
    agent.paper_trading = FakePaper()
    agent.llm = FakeLLM()
    agent.analyzer = None
    agent.obsidian = FakeObsidian()
    agent.is_running = False
    agent.run_cycle()
    assert len(fake_memory.observations) == 1
    assert fake_memory.portfolio_updates == 0
    prompt = LLMDecisionEngine()._build_observer_prompt("BTC/USDT", {"summary": "x"}, [], [])
    assert "Should we BUY" not in prompt and "Should we SELL" not in prompt
    assert "BUY_NOW" in prompt and "Forbidden execution labels" in prompt
    print("  OBSERVER_ONLY saves observation without execution or portfolio mutation  [OK]")
except Exception as e:
    errors.append(f"observer_mode: {e}")
    print(f"  ERROR: {e}")
    import traceback; traceback.print_exc()

# ── Obsidian Exporter ────────────────────────────────────────────────────────
print("=== Testing obsidian_exporter ===")
try:
    from obsidian_exporter import ObsidianMarketExporter
    missing_exporter = ObsidianMarketExporter(vault_path=str(BASE_DIR / "missing-global-vault"), enabled=True)
    assert missing_exporter.export_observation({"symbol": "BTC/USDT"}).get("status") == "configuration_required"
    with tempfile.TemporaryDirectory() as td:
        os.environ["BINANCE_API_KEY"] = "SECRET_FOR_REDACTION_TEST"
        exporter = ObsidianMarketExporter(vault_path=td, enabled=True)
        status = exporter.status()
        assert status["uses_global_edith_vault"] is True
        assert status["relative_folder"] == "Trading/Crypto Market Learning"
        assert status["target_path"].endswith("Trading\\Crypto Market Learning") or status["target_path"].endswith("Trading/Crypto Market Learning")
        obs = {
            "symbol": "BTC/USDT",
            "mode": "OBSERVER_ONLY",
            "market_regime": "neutral",
            "trend": "neutral",
            "volatility": "medium",
            "technical_summary": "RSI neutral",
            "what_changed": "No major change",
            "what_to_watch_next": ["volume expansion"],
            "learning_note": "api_key=SECRET_FOR_REDACTION_TEST should not persist",
            "risk_note": "Learning note only.",
            "confidence": 0.5,
            "not_financial_advice": True,
        }
        result = exporter.export_observation(obs)
        assert result["status"] == "exported"
        assert "Trading" in result["daily_path"] and "Crypto Market Learning" in result["daily_path"]
        daily_text = Path(result["daily_path"]).read_text(encoding="utf-8")
        assert "SECRET_FOR_REDACTION_TEST" not in daily_text
        assert "not financial advice" in daily_text.lower()
        test_result = exporter.write_export_test()
        assert test_result["status"] == "exported"
        test_path = Path(test_result["test_path"])
        assert test_path.name == "_EDITH_CRYPTO_EXPORT_TEST.md"
        assert test_path.parent.name == "Crypto Market Learning"
        assert test_path.parent.parent.name == "Trading"
        assert "Status: OK" in test_path.read_text(encoding="utf-8")
        os.environ.pop("BINANCE_API_KEY", None)
    print("  Missing path fallback and configured Markdown export  [OK]")
except Exception as e:
    errors.append(f"obsidian_exporter: {e}")
    print(f"  ERROR: {e}")
    import traceback; traceback.print_exc()

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
    is_valid, reason, params = rm.validate_trade("BUY", "BTC/USDT", 50000.0, 10000.0, [], execution_mode="PAPER_TRADING")
    print(f"  validate_trade BUY -> valid={is_valid}, reason={reason}  [OK]")
    is_valid2, reason2, params2 = rm.validate_trade("SELL", "BTC/USDT", 50000.0, 10000.0, [], execution_mode="PAPER_TRADING")
    print(f"  validate_trade SELL no-pos -> valid={is_valid2}, reason={reason2}  [OK]")
    is_valid3, reason3, params3 = rm.validate_trade("NO TRADE", "BTC/USDT", 50000.0, 10000.0, [])
    print(f"  validate_trade NO TRADE -> valid={is_valid3}, reason={reason3}  [OK]")
    is_valid4, reason4, params4 = rm.validate_trade(
        "BUY", "BTC/USDT", 50000.0, 10000.0,
        [{"symbol": "ETH/USDT"}, {"symbol": "SOL/USDT"}, {"symbol": "BNB/USDT"}],
        execution_mode="PAPER_TRADING",
    )
    print(f"  validate_trade max-open-positions -> valid={is_valid4}, reason={reason4}  [OK]")
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
    old_mode = CONFIG.TRADING_MODE
    old_paper = CONFIG.PAPER_TRADING
    CONFIG.TRADING_MODE = "PAPER_TRADING"
    CONFIG.PAPER_TRADING = True
    pt = PaperTradingEngine(mem)
    print(f"  Initial balance: {pt.get_balance()}  [OK]")
    # BUY
    ok = pt.execute_trade("BTC/USDT", "BUY", 0.001, 50000.0, decision_id=1, sl=49000.0, tp=52000.0)
    print(f"  execute_trade BUY -> {ok}, balance={pt.get_balance()}  [OK]")
    doge_blocked = pt.execute_trade("DOGE/USDT", "BUY", 1.0, 0.1, decision_id=1)
    assert doge_blocked is False
    print(f"  execute_trade DOGE watch-only -> {doge_blocked}  [OK]")
    positions = pt.get_open_positions()
    print(f"  get_open_positions -> {len(positions)} positions  [OK]")
    # SELL
    if positions:
        ok2 = pt.execute_trade("BTC/USDT", "SELL", positions[0]['amount'], 51000.0, decision_id=1)
        print(f"  execute_trade SELL -> {ok2}, balance={pt.get_balance()}  [OK]")
    equity = pt.get_total_equity({"BTC/USDT": 50000.0})
    print(f"  get_total_equity -> {equity}  [OK]")
    CONFIG.TRADING_MODE = old_mode
    CONFIG.PAPER_TRADING = old_paper
except Exception as e:
    CONFIG.TRADING_MODE = "OBSERVER_ONLY"
    CONFIG.PAPER_TRADING = False
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
        health = r.get_json()
        assert health["service"] == "edith-crypto"
        assert health["mode"] == "OBSERVER_ONLY"
        assert health["tradingEnabled"] is False
        assert health["paperTradingEnabled"] is False
        assert health["liveTradingEnabled"] is False
        assert health["runtime"]["state"] == "STOPPED"
        assert health["runtime"]["observerRunning"] is False
        assert health["runtime"]["safetyStatus"]["status"] == "LOCKED"
        assert health["obsidianTargetPath"].endswith("Trading\\Crypto Market Learning") or health["obsidianTargetPath"].endswith("Trading/Crypto Market Learning")
        r0 = client.get('/api/health')
        print(f"  /api/health -> {r0.status_code}  [OK]")
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
        r13 = client.get('/api/trading-status')
        print(f"  /api/trading-status -> {r13.status_code}  [OK]")
        r14 = client.get('/api/permissions')
        print(f"  /api/permissions -> {r14.status_code}  [OK]")
        r15 = client.get('/api/symbols')
        print(f"  /api/symbols -> {r15.status_code}  [OK]")
        r16 = client.get('/api/categories')
        print(f"  /api/categories -> {r16.status_code}  [OK]")
        r17 = client.get('/api/watchlist')
        print(f"  /api/watchlist -> {r17.status_code}  [OK]")
        r18 = client.get('/api/mode')
        print(f"  /api/mode -> {r18.status_code}  [OK]")
        r19 = client.get('/api/permission-events')
        print(f"  /api/permission-events -> {r19.status_code}  [OK]")
        r20 = client.get('/api/observations')
        print(f"  /api/observations -> {r20.status_code}  [OK]")
        r21 = client.get('/api/learning-notes')
        print(f"  /api/learning-notes -> {r21.status_code}  [OK]")
        r22 = client.get('/api/obsidian-status')
        print(f"  /api/obsidian-status -> {r22.status_code}  [OK]")
        r23 = client.get('/api/crypto/status')
        print(f"  /api/crypto/status -> {r23.status_code}  [OK]")
        runtime = r23.get_json()
        assert runtime["state"] == "STOPPED"
        assert runtime["observerRunning"] is False
        assert runtime["mode"] == "OBSERVER_ONLY"
        assert runtime["tradingEnabled"] is False
        assert runtime["paperTradingEnabled"] is False
        assert runtime["liveTradingEnabled"] is False
        r24 = client.post('/api/crypto/stop-observer')
        print(f"  /api/crypto/stop-observer -> {r24.status_code}  [OK]")
        assert r24.get_json()["status"]["state"] == "STOPPED"
        r25 = client.post('/api/crypto/pause-observer')
        print(f"  /api/crypto/pause-observer -> {r25.status_code}  [OK/LOCKED]")
        assert r25.status_code == 409
        r26 = client.get('/api/crypto/ollama-status')
        print(f"  /api/crypto/ollama-status -> {r26.status_code}  [OK]")
        r27 = client.get('/api/crypto/latest-observations')
        print(f"  /api/crypto/latest-observations -> {r27.status_code}  [OK]")
        assert client.get('/api/mode').get_json()["trading_mode"] == "OBSERVER_ONLY"
        os.environ['BINANCE_API_KEY'] = 'TEST_SECRET_SHOULD_NOT_APPEAR'
        body = client.get('/api/mode').get_data(as_text=True) + client.get('/api/trading-status').get_data(as_text=True)
        assert 'TEST_SECRET_SHOULD_NOT_APPEAR' not in body
        os.environ.pop('BINANCE_API_KEY', None)
        print("  API responses do not expose Binance env secret values  [OK]")
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
