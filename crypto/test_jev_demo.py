"""Focused safety and behavior tests for the Jev demo exchange phase."""
import os
import sqlite3
import sys
import tempfile
import json
import threading
import io
import time
from contextlib import closing, redirect_stderr, redirect_stdout
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from uuid import uuid4
from unittest.mock import patch


ROOT = Path(__file__).resolve().parent
SRC = ROOT / "src"
sys.path.insert(0, str(SRC))

temp_dir = tempfile.TemporaryDirectory()
db_path = Path(temp_dir.name) / "crypto-demo-test.db"
os.environ.update({
    "CRYPTO_DB_PATH": str(db_path),
    "CRYPTO_STARTING_BALANCE": "10000",
    "CRYPTO_DEMO_TRADING_ENABLED": "true",
    "CRYPTO_OBSIDIAN_ENABLED": "false",
    "CRYPTO_LEARNING_ENABLED": "false",
    "CRYPTO_NEWS_ENABLED": "false",
    "CRYPTO_OLLAMA_ENABLED": "false",
    "CRYPTO_LIVE_TRADING_ENABLED": "false",
    "BINANCE_TRADING_ENABLED": "false",
    "ENABLE_LIVE_TRADING": "false",
    "CRYPTO_DATA_DIR": temp_dir.name,
    "CRYPTO_LOG_DIR": temp_dir.name,
})

from config import CONFIG
from demo_portfolio import DemoPortfolioEngine
from jev_adapter import JevDecisionAdapter, HttpJevAdapter, UnconfiguredJevAdapter, create_jev_adapter
from jev_loop import JevDemoLoopController
from price_freshness import utc_now


def market(price=50000.0, fresh=True):
    return {
        "status": "online" if fresh else "degraded",
        "symbol": "BTCUSDT",
        "fresh": fresh,
        "stale": not fresh,
        "marketPriceTimestamp": utc_now(),
        "ticker": {"last": price},
        "realData": True,
    }


assert CONFIG.DEMO_INITIAL_BALANCE == 10000.0
assert CONFIG.CRYPTO_OBSIDIAN_ENABLED is False
assert CONFIG.CRYPTO_LEARNING_ENABLED is False
assert CONFIG.CRYPTO_NEWS_ENABLED is False
assert CONFIG.CRYPTO_OLLAMA_ENABLED is False
assert CONFIG.live_trading_active is False

# Migration preserves the existing account, including a legacy starting balance.
conn = sqlite3.connect(db_path)
conn.execute("""
    CREATE TABLE demo_portfolio_state (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT, initial_balance REAL, cash REAL, equity REAL,
        positions_json TEXT, realized_pnl REAL, unrealized_pnl REAL,
        no_trade_count INTEGER, max_drawdown REAL
    )
""")
conn.execute("INSERT INTO demo_portfolio_state VALUES (NULL, 'old', 100, 75, 75, '[]', 0, 0, 0, 0)")
conn.commit()
conn.close()

portfolio = DemoPortfolioEngine(str(db_path), test_only_import_legacy_fixture=True)
initial = portfolio.summary()
assert initial["initialBalance"] == 100.0
assert initial["currentCash"] == 75.0
assert initial["numberOfTrades"] == 0
assert initial["realMoneyUsed"] is False
legacy_session = initial['portfolioSessionId']
explicit_reset = portfolio.reset('RESET_DEMO_ACCOUNT')
assert explicit_reset['ok'] is True
assert explicit_reset['previousSessionId'] == legacy_session
assert explicit_reset['portfolio']['initialBalance'] == 10000.0
assert explicit_reset['portfolio']['currentCash'] == 10000.0

stale = portfolio.buy("BTCUSDT", 1000, market(fresh=False))
assert stale["ok"] is False and stale["errorCode"] == "stale_market_data"

bought = portfolio.buy("BTCUSDT", 1000, market())
assert bought["ok"] is True
assert round(bought["fee"], 4) == 1.0
assert round(bought["portfolio"]["currentCash"], 4) == 8999.0
assert len(bought["portfolio"]["openPositions"]) == 1

duplicate = portfolio.buy("BTCUSDT", 100, market())
assert duplicate["ok"] is False and duplicate["errorCode"] == "risk_rejected"
assert duplicate["execution"]["reason"] == "duplicate_symbol_position"

trade_count = len(portfolio.trades())
held = portfolio.hold("ETHUSDT")
assert held["ok"] is True and held["tradeExecuted"] is False
assert len(portfolio.trades()) == trade_count

sold = portfolio.sell("BTCUSDT", 100, market(51000.0))
assert sold["ok"] is True
assert sold["pnl"] > 0
assert sold["portfolio"]["openPositions"] == []

reset_rejected = portfolio.reset("wrong")
assert reset_rejected["ok"] is False
reset = portfolio.reset("RESET_DEMO_ACCOUNT")
assert reset["ok"] is True
assert reset["portfolio"]["currentCash"] == 10000.0
assert portfolio.trades() == []
assert len(portfolio.trades(session_id='all')) == 2
assert portfolio.decisions()[0]['source'] == 'manual'
assert reset['previousSessionId'] != reset['portfolioSessionId']

concurrent_results = []
start_gate = threading.Barrier(3)


def concurrent_buy():
    start_gate.wait()
    concurrent_results.append(portfolio.buy("BTCUSDT", 1000, market()))


buyers = [threading.Thread(target=concurrent_buy) for _ in range(2)]
for buyer in buyers:
    buyer.start()
start_gate.wait()
for buyer in buyers:
    buyer.join(timeout=2)
assert sum(1 for result in concurrent_results if result["ok"]) == 1
assert sum(1 for result in concurrent_results if result.get("errorCode") == "risk_rejected"
           and result['execution']['reason'] == 'duplicate_symbol_position') == 1
assert portfolio.reset("RESET_DEMO_ACCOUNT")["ok"] is True

jev = UnconfiguredJevAdapter()
assert jev.status()["status"] == "config_required"
assert jev.status()["mock"] is False
assert jev.status()["configuration"] == {
    "configured": False, "model": "jev-1.13.0", "apiStyle": None, "decisionOnly": True,
}
assert jev.status()["health"]["state"] == "not_configured"
assert jev.status()["health"]["checkedAt"] is None
assert jev.decide({})["action"] is None
assert JevDecisionAdapter.validate_output({"action": "BUY"})["valid"] is True
assert JevDecisionAdapter.validate_output({"decision": "SELL", "confidence": 0.71})["action"] == "SELL"
assert JevDecisionAdapter.validate_output({"label": "HOLD"})["action"] == "HOLD"
assert JevDecisionAdapter.validate_output("BUY")["action"] == "BUY"
assert JevDecisionAdapter.validate_output({"action": "NO_TRADE"})["valid"] is False
assert HttpJevAdapter._extract_decision_payload("SELL")["action"] == "SELL"
assert HttpJevAdapter._extract_decision_payload('"HOLD"')["action"] == "HOLD"

loop_calls = []


def loop_runner(symbols):
    loop_calls.append(list(symbols))
    return {
        "ok": True,
        "results": [
            {
                "ok": True,
                "symbol": symbol,
                "decision": {"action": "HOLD", "latencyMs": 3},
                "execution": {"executed": False, "blocked": False, "reason": None},
            }
            for symbol in symbols
        ],
        "jevLatencyMs": 3,
        "cycleLatencyMs": 4,
        "realOrderSent": False,
    }, 200


loop_controller = JevDemoLoopController(loop_runner, default_interval_seconds=0.03, min_interval_seconds=0.01)
loop_symbols = ["BTCUSDT", "ETHUSDT"]
assert loop_controller.start(loop_symbols, 0.001)["error"] == "LOOP_INTERVAL_TOO_SHORT"
assert loop_controller.start(loop_symbols, 0.03)["ok"] is True
assert loop_controller.start(loop_symbols, 0.03)["error"] == "JEV_LOOP_ALREADY_RUNNING"
deadline = time.time() + 1
while len(loop_calls) < 3 and time.time() < deadline:
    time.sleep(0.01)
loop_running = loop_controller.status()
assert loop_running["running"] is True
assert loop_running["cycles"] >= 3
assert loop_running["symbolCount"] == 2
assert loop_running["actions"]["HOLD"] >= 6
assert len(loop_running["lastDecisions"]) == 2
assert loop_running["executedTrades"] == 0
assert loop_running["realOrderSent"] is False
assert loop_controller.stop(timeout_seconds=1)["status"]["running"] is False


class JevTestHandler(BaseHTTPRequestHandler):
    response_decision = {"action": "BUY", "confidence": 0.8}
    raw_response = None
    last_authorization = None
    last_payload = None
    request_count = 0

    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0"))
        assert self.path == "/v1/systemone"
        JevTestHandler.last_authorization = self.headers.get("Authorization")
        JevTestHandler.last_payload = json.loads(self.rfile.read(length).decode("utf-8"))
        JevTestHandler.request_count += 1
        decision = JevTestHandler.response_decision
        answers = {
            key: {
                "type": "choice",
                "choice": decision.get("action"),
                "confidence": decision.get("confidence"),
            }
            for key in JevTestHandler.last_payload.get("questions", {})
        }
        if JevTestHandler.raw_response is not None:
            body = str(JevTestHandler.raw_response).encode("utf-8")
            content_type = "text/plain"
        else:
            body = json.dumps({
                "model": "jev-test-resolved",
                "answers": answers,
            }).encode("utf-8")
            content_type = "application/json"
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_args):
        return


jev_server = ThreadingHTTPServer(("127.0.0.1", 0), JevTestHandler)
jev_thread = threading.Thread(target=jev_server.serve_forever, daemon=True)
jev_thread.start()
test_key = "TEST_JEV_SECRET_DO_NOT_EXPOSE"
http_jev = HttpJevAdapter(test_key, f"http://127.0.0.1:{jev_server.server_port}", "jev-test")
http_status = http_jev.status()
assert http_status["configured"] is True
assert http_status["available"] is None
assert http_status["providerStatus"] == "unverified"
assert http_status["configuration"]["configured"] is True
assert http_status["health"] == {
    "state": "unverified", "available": None, "checkedAt": None, "latencyMs": None, "errorCode": None,
}
assert http_status["secretExposed"] is False
assert test_key not in json.dumps(http_status)
captured_output = io.StringIO()
with redirect_stdout(captured_output), redirect_stderr(captured_output):
    jev_buy = http_jev.decide({"symbol": "BTCUSDT", "price": 50000, "allowedActions": ["BUY", "SELL", "HOLD"]})
assert jev_buy["ok"] is True and jev_buy["action"] == "BUY"
assert jev_buy["model"] == "jev-test-resolved"
assert http_jev.status()["available"] is True
assert http_jev.status()["model"] == "jev-test-resolved"
assert http_jev.status()["health"]["state"] == "ready"
assert http_jev.status()["health"]["checkedAt"]
assert JevTestHandler.last_authorization == f"Bearer {test_key}"
assert test_key not in json.dumps(JevTestHandler.last_payload)
assert test_key not in captured_output.getvalue()
assert JevTestHandler.last_payload["state"]["symbol"] == "BTCUSDT"
assert JevTestHandler.last_payload["questions"]["decision"]["type"] == "choice"
assert set(JevTestHandler.last_payload["questions"]["decision"]["criteria"]) == {"BUY", "SELL", "HOLD"}
JevTestHandler.raw_response = "SELL"
plain_jev = http_jev.decide({"symbol": "BTCUSDT", "price": 50000})
assert plain_jev["ok"] is True and plain_jev["action"] == "SELL" and plain_jev["confidence"] is None
JevTestHandler.raw_response = None
JevTestHandler.response_decision = {"action": "HOLD", "confidence": 0.65}
batch_contexts = [
    {"symbol": symbol, "price": 100, "cash": 10000, "equity": 10000, "riskAllowed": True, "allowedActions": ["BUY", "SELL", "HOLD"]}
    for symbol in ("BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT", "ADAUSDT", "AVAXUSDT")
]
request_count_before_batch = JevTestHandler.request_count
jev_batch = http_jev.decide_many(batch_contexts)
assert jev_batch["ok"] is True
assert len(jev_batch["decisions"]) == 8
assert {item["symbol"] for item in jev_batch["decisions"]} == {item["symbol"] for item in batch_contexts}
assert all(item["action"] == "HOLD" for item in jev_batch["decisions"])
assert JevTestHandler.request_count == request_count_before_batch + 1
assert len(JevTestHandler.last_payload["questions"]) == 8
assert len(JevTestHandler.last_payload["state"]["assets"]) == 8
JevTestHandler.response_decision = {"action": "WAIT"}
invalid_jev = http_jev.decide({"symbol": "BTCUSDT", "price": 50000})
assert invalid_jev["ok"] is False
assert invalid_jev["errorCode"] == "invalid_decision_output"
assert http_jev.status()["available"] is False
assert http_jev.status()["health"]["state"] == "error"
assert test_key not in json.dumps(invalid_jev)

saved_jev_env = {name: os.environ.get(name) for name in ("JEV_API_KEY", "JEV_API_URL", "JEV_MODEL")}
for name in saved_jev_env:
    os.environ.pop(name, None)
assert create_jev_adapter().status()["status"] == "config_required"
os.environ.update({"JEV_API_KEY": test_key})
configured_with_defaults = create_jev_adapter()
assert configured_with_defaults.status()["model"] == "jev-1.13.0"
assert configured_with_defaults.api_url == "https://api.typesafe.ai"
os.environ.update({"JEV_API_URL": f"http://127.0.0.1:{jev_server.server_port}", "JEV_MODEL": "jev-test"})
configured_from_env = create_jev_adapter().status()
assert configured_from_env["configured"] is True
assert test_key not in json.dumps(configured_from_env)
for name, value in saved_jev_env.items():
    if value is None:
        os.environ.pop(name, None)
    else:
        os.environ[name] = value

# Importing the dashboard is isolated to the temporary ledger; no public fetch may run.
from market_data import MarketDataFetcher


def no_public_provider(*_args, **_kwargs):
    raise AssertionError('Real provider calls are forbidden in this test.')


provider_guard = patch.multiple(MarketDataFetcher, fetch_ticker=no_public_provider,
    fetch_tickers=no_public_provider, fetch_ohlcv=no_public_provider,
    fetch_ohlcv_many=no_public_provider, fetch_order_book=no_public_provider)
provider_guard.start()
import dashboard as dashboard_module

app = dashboard_module.app
assert Path(dashboard_module.demo_portfolio.db_path).resolve() == db_path.resolve()


class StaticJevAdapter:
    def __init__(self, result):
        self.result = result

    def status(self):
        return {
            "configured": True,
            "available": self.result.get("ok", False),
            "model": "jev-test",
            "status": "available" if self.result.get("ok") else "error",
            "lastLatencyMs": self.result.get("latencyMs"),
            "lastError": self.result.get("errorCode"),
            "safeMessage": self.result.get("safeMessage") or "Test adapter.",
            "secretExposed": False,
        }

    def decide(self, _context):
        return dict(self.result)

    def decide_many(self, contexts):
        decisions = [{"symbol": context["symbol"], **dict(self.result)} for context in contexts]
        valid = all(item.get("ok") and item.get("valid") for item in decisions)
        return {
            "ok": valid,
            "valid": valid,
            "decisions": decisions if valid else [],
            "latencyMs": self.result.get("latencyMs"),
            "model": "jev-test",
            "errorCode": None if valid else self.result.get("errorCode"),
            "safeMessage": self.result.get("safeMessage") or "Test batch adapter.",
            "realOrderSent": False,
        }


def fake_market(price=50000.0, symbol="BTCUSDT"):
    return {
        "status": "online",
        "symbol": symbol,
        "exchangeSymbol": f"{symbol[:-4]}/USDT",
        "fresh": True,
        "stale": False,
        "updatedAt": utc_now(),
        "ticker": {"last": price, "change24h": 1.2, "volume24h": 1000000, "bid": price - 1, "ask": price + 1, "spreadPct": 0.004},
        "candles": [{"close": price - 100 + index * 5} for index in range(30)],
        "orderBook": {"bids": [], "asks": []},
        "realData": True,
    }


def fake_decision_market(symbol="BTCUSDT", *_args, **_kwargs):
    normalized = str(symbol).replace("/", "").replace("-", "").upper()
    return fake_market(symbol=normalized)


def mutation_payload(symbol="BTCUSDT", **fields):
    return {"clientRequestId": str(uuid4()), "symbol": symbol, **fields}


dashboard_module.market_service.snapshot = fake_decision_market
dashboard_module.market_service.decision_snapshot = fake_decision_market
dashboard_module.market_service.decision_snapshots = lambda symbols, *_args, **_kwargs: {
    str(symbol).replace("/", "").replace("-", "").upper(): fake_decision_market(symbol)
    for symbol in symbols
}

app.testing = True
with app.test_client() as client:
    status = client.get("/api/crypto/status")
    assert status.status_code == 200
    body = status.get_json()
    assert body["demoInitialBalance"] == 10000.0
    assert body["features"] == {
        "obsidian": "disabled",
        "learning": "disabled",
        "news": "disabled",
        "ollama": "disabled",
        "liveTrading": "disabled",
    }
    assert body["realOrderEndpointsAvailable"] is False
    dashboard_module.jev_adapter = UnconfiguredJevAdapter()
    assert client.get("/api/crypto/jev/status").get_json()["status"] == "config_required"
    decision = client.post("/api/crypto/decision/run", json=mutation_payload())
    assert decision.status_code == 503
    assert decision.get_json()["errorCode"] == "jev_unavailable"
    assert decision.get_json()["decision"]["action"] is None
    assert decision.get_json()["decision"]["decisionId"]
    assert decision.get_json()["decision"]["executed"] is False
    assert decision.get_json()["status"] == "failed"

    dashboard_module.jev_adapter = StaticJevAdapter({
        "ok": False, "valid": False, "action": None, "confidence": None,
        "latencyMs": 4, "model": "jev-test", "status": "error",
        "errorCode": "invalid_decision_output", "safeMessage": "Invalid test output.",
    })
    invalid = client.post("/api/crypto/decision/run", json=mutation_payload())
    assert invalid.status_code == 502
    assert invalid.get_json()["tradeExecuted"] is False
    assert dashboard_module.demo_portfolio.trades() == []

    dashboard_module.jev_adapter = StaticJevAdapter({
        "ok": True, "valid": True, "action": "BUY", "confidence": 0.82,
        "latencyMs": 7, "model": "jev-test", "status": "ok", "errorCode": None,
        "safeMessage": "Valid test output.",
    })
    bought_by_jev = client.post("/api/crypto/decision/run", json=mutation_payload())
    assert bought_by_jev.status_code == 200
    assert bought_by_jev.get_json()["execution"]["executed"] is True
    assert bought_by_jev.get_json()["realOrderSent"] is False
    assert dashboard_module.demo_portfolio.trades()[0]["source"] == "jev"

    dashboard_module.market_service.decision_snapshots = lambda symbols, *_args, **_kwargs: {
        str(symbol).replace("/", ""): fake_market(51000.0, str(symbol).replace("/", "")) for symbol in symbols
    }
    dashboard_module.jev_adapter = StaticJevAdapter({
        "ok": True, "valid": True, "action": "SELL", "confidence": None,
        "latencyMs": 6, "model": "jev-test", "status": "ok", "errorCode": None,
        "safeMessage": "Valid test output.",
    })
    sold_by_jev = client.post("/api/crypto/decision/run", json=mutation_payload())
    assert sold_by_jev.status_code == 200
    assert sold_by_jev.get_json()["execution"]["executed"] is True
    assert sold_by_jev.get_json()["pnl"] > 0
    assert dashboard_module.demo_portfolio.summary()["openPositions"] == []

    dashboard_module.demo_portfolio.reset("RESET_DEMO_ACCOUNT")
    sell_without_position = client.post("/api/crypto/decision/run", json=mutation_payload())
    assert sell_without_position.status_code == 200
    assert sell_without_position.get_json()["execution"]["blocked"] is True
    assert sell_without_position.get_json()["execution"]["reason"] == "position_not_found"

    dashboard_module.jev_adapter = StaticJevAdapter({
        "ok": True, "valid": True, "action": "HOLD", "confidence": 0.55,
        "latencyMs": 5, "model": "jev-test", "status": "ok", "errorCode": None,
        "safeMessage": "Valid test output.",
    })
    trades_before_hold = len(dashboard_module.demo_portfolio.trades())
    held_by_jev = client.post("/api/crypto/decision/run", json=mutation_payload())
    assert held_by_jev.status_code == 200
    assert held_by_jev.get_json()["execution"]["executed"] is False
    assert len(dashboard_module.demo_portfolio.trades()) == trades_before_hold
    latest = client.get("/api/crypto/decision/latest").get_json()["decision"]
    assert latest["source"] == "jev" and latest["decision"] == "HOLD"
    assert latest["latency_ms"] == 5
    too_fast_loop = client.post("/api/crypto/jev/loop/start", json={"symbol": "BTCUSDT", "intervalSeconds": 1})
    assert too_fast_loop.status_code == 400
    trades_before_loop = len(dashboard_module.demo_portfolio.trades())
    loop_started = client.post("/api/crypto/jev/loop/start", json={"symbol": "BTCUSDT", "intervalSeconds": 15})
    assert loop_started.status_code == 200
    assert client.post("/api/crypto/jev/loop/start", json={"symbol": "BTCUSDT", "intervalSeconds": 15}).status_code == 409
    # Windows CI can take longer than one second to persist all eight isolated
    # HOLD decisions; this remains bounded and does not wait for another cycle.
    deadline = time.time() + 5
    loop_status = client.get("/api/crypto/jev/loop").get_json()
    while loop_status["cycles"] < 1 and time.time() < deadline:
        time.sleep(0.01)
        loop_status = client.get("/api/crypto/jev/loop").get_json()
    assert loop_status["running"] is True and loop_status["cycles"] >= 1
    assert loop_status["symbolCount"] == 8
    assert len(loop_status["lastDecisions"]) == 8
    assert loop_status["actions"]["HOLD"] >= 8
    assert len(dashboard_module.demo_portfolio.trades()) == trades_before_loop
    reset_while_running = {"clientRequestId": str(uuid4()), "confirmation": "RESET_DEMO_ACCOUNT"}
    blocked_reset = client.post('/api/crypto/demo/reset', json=reset_while_running)
    assert blocked_reset.status_code == 409
    assert blocked_reset.get_json()['errorCode'] == 'reset_not_allowed'
    loop_stopped = client.post("/api/crypto/jev/loop/stop")
    assert loop_stopped.status_code == 200
    assert loop_stopped.get_json()["status"]["running"] is False
    assert client.post('/api/crypto/demo/reset', json=reset_while_running).data == blocked_reset.data
    assert client.get("/api/crypto/news").get_json()["status"] == "disabled"
    assert client.get("/api/crypto/lessons").get_json()["status"] == "disabled"
    assert client.get("/api/crypto/models").get_json()["status"] == "disabled"
    combined_api = (
        client.get("/api/crypto/status").get_data(as_text=True)
        + client.get("/api/crypto/jev/status").get_data(as_text=True)
        + client.get("/api/crypto/decision/latest").get_data(as_text=True)
    )
    assert test_key not in combined_api

    # Strict payload validation must run before market access or ledger reservation.
    valid_payloads = {
        'buy': mutation_payload(amountCredits=100),
        'sell': mutation_payload(positionPercent=100),
        'hold': mutation_payload(),
        'reset': {'clientRequestId': str(uuid4()), 'confirmation': 'RESET_DEMO_ACCOUNT'},
        'decision': mutation_payload(),
    }
    paths = {name: '/api/crypto/decision/run' if name == 'decision' else f'/api/crypto/demo/{name}'
             for name in valid_payloads}
    for name, payload in valid_payloads.items():
        invalid_payloads = [
            {key: value for key, value in payload.items() if key != 'clientRequestId'},
            {**payload, 'idempotencyKey': str(uuid4())},
            {**payload, 'clientRequestId': True},
            {**payload, 'source': 'manual' if name == 'decision' else 'jev'},
            {**payload, 'leverage': 2},
            {**payload, 'secret': test_key},
        ]
        with patch.object(dashboard_module.market_service, 'decision_snapshots') as fetch:
            for invalid_payload in invalid_payloads:
                rejected = client.post(paths[name], json=invalid_payload)
                assert rejected.status_code == 400
                assert rejected.get_json()['errorCode'] == 'invalid_request'
                assert test_key not in rejected.get_data(as_text=True)
            fetch.assert_not_called()
        assert dashboard_module.demo_portfolio.operation(payload['clientRequestId']) is None
    for body in ('[]', 'null', '{', '{"symbol":"BTCUSDT","symbol":"ETHUSDT"}',
                 '{"quoteAmount":NaN}', '{"quoteAmount":Infinity}'):
        assert client.post(paths['buy'], data=body, content_type='application/json').status_code == 400
    for amount in (True, '100', None, [], -1, 0, float('inf')):
        assert client.post(paths['buy'], json=mutation_payload(quoteAmount=amount)).status_code == 400
    for symbol in ('', None, [], 'BTCUSDT;secret', 'NOTLISTEDUSDT'):
        assert client.post(paths['hold'], json=mutation_payload(symbol)).status_code == 400

    # Equivalent IDs, amount aliases and symbol spellings replay the exact stored response.
    manual_reset = client.post(paths['reset'], json=valid_payloads['reset'])
    assert manual_reset.status_code == 200
    assert client.post(paths['reset'], json=valid_payloads['reset']).data == manual_reset.data
    manual_id = str(uuid4())
    with patch.object(dashboard_module.market_service, 'decision_snapshots',
                      wraps=dashboard_module.market_service.decision_snapshots) as fetch:
        manual_buy = client.post(paths['buy'], json={
            'idempotencyKey': manual_id, 'symbol': ' btc/usdt ', 'amountCredits': 100,
        })
        assert manual_buy.status_code == 200
        manual_replay = client.post(paths['buy'], json={
            'clientRequestId': manual_id, 'symbol': 'BTC-USDT', 'quoteAmount': 100.0, 'source': 'manual',
        })
        assert manual_replay.data == manual_buy.data
        assert fetch.call_count == 1
    manual = manual_buy.get_json()
    assert manual['data']['tradeId'] == manual['tradeId']
    assert manual['meta']['requestId'] == manual_id
    assert manual['decisionId'] is None
    assert client.post(paths['buy'], json=mutation_payload(clientRequestId=manual_id, quoteAmount=101)).status_code == 409
    operation = client.get(f'/api/crypto/operations/{manual_id}').get_json()
    assert operation['status'] == 'completed' and operation['result'] == manual
    trade = client.get(f'/api/crypto/trades/{manual["tradeId"]}').get_json()['trade']
    assert trade['source'] == 'manual' and trade['decisionId'] is None
    valued = client.get('/api/crypto/portfolio').get_json()['portfolio']
    assert valued['valuationStatus'] == 'fresh' and valued['oldestPriceAgeMs'] is not None
    assert valued['openPositions'][0]['currentPriceTimestamp']
    assert client.get('/api/crypto/positions').get_json()['valuationStatus'] == 'fresh'
    manual_sell_payload = mutation_payload(positionPercent=100)
    manual_sell = client.post(paths['sell'], json=manual_sell_payload)
    assert manual_sell.status_code == 200
    assert client.post(paths['sell'], json=manual_sell_payload).data == manual_sell.data
    manual_hold_payload = mutation_payload()
    manual_hold = client.post(paths['hold'], json=manual_hold_payload)
    assert client.post(paths['hold'], json=manual_hold_payload).data == manual_hold.data
    held_decision = manual_hold.get_json()['decision']
    assert held_decision['source'] == 'manual' and held_decision['tradeId'] is None
    assert client.get('/api/crypto/decisions/latest?source=manual&symbol=btc-usdt').get_json()['decision'] == held_decision
    assert client.get(f'/api/crypto/decisions/{held_decision["decisionId"]}').get_json()['decision'] == held_decision
    assert client.get(f'/api/crypto/decisions/{held_decision["decisionId"]}?source=jev').status_code == 404
    filtered = client.get('/api/crypto/decisions?symbol=btc%2Fusdt&source=manual&limit=1').get_json()['decisions']
    assert filtered == [held_decision]
    for query in ('limit=-1', 'limit=no', 'limit=0', 'limit=2&limit=3', 'source=spoof', 'symbol=unknown'):
        assert client.get('/api/crypto/decisions?' + query).status_code == 400
    assert client.get('/api/crypto/session').get_json()['session']['endedAt'] is None
    assert len(client.get('/api/crypto/sessions').get_json()['sessions']) >= 2
    for path in ('operations/' + str(uuid4()), 'trades/missing', 'decisions/missing'):
        missing = client.get('/api/crypto/' + path)
        assert missing.status_code == 404 and missing.get_json()['ok'] is False

    decision_payload = mutation_payload()
    with patch.object(dashboard_module.jev_adapter, 'decide', wraps=dashboard_module.jev_adapter.decide) as decide:
        original_decision = client.post(paths['decision'], json=decision_payload)
        assert original_decision.status_code == 200
        assert client.post(paths['decision'], json=decision_payload).data == original_decision.data
        assert decide.call_count == 1

    # A reserved reset and loop start share the same lifecycle lock.
    reset_id = str(uuid4())
    reset_payload = {'confirmation': 'RESET_DEMO_ACCOUNT', 'source': 'manual'}
    reset_op, reused = dashboard_module.demo_portfolio.reserve(reset_id, 'reset', reset_payload)
    assert reused is None
    with patch.object(dashboard_module.jev_loop_controller, 'start') as start:
        blocked_start = client.post('/api/crypto/jev/loop/start', json={'intervalSeconds': 15})
        assert blocked_start.status_code == 409
        assert blocked_start.get_json()['errorCode'] == 'portfolio_locked'
        start.assert_not_called()
    assert dashboard_module.demo_portfolio.finish(reset_op, reset_payload, {})[0]['reset'] is True

    # Exercise the native HTTP mock through the full dashboard eight-symbol batch.
    dashboard_module.jev_adapter = http_jev
    JevTestHandler.response_decision = {'action': 'HOLD', 'confidence': 0.6}
    batch_symbols = [item['symbol'] for item in batch_contexts]
    snapshots = dashboard_module.market_service.decision_snapshots

    def reserved_snapshots(symbols, *args):
        with closing(sqlite3.connect(db_path)) as connection:
            pending = connection.execute("SELECT COUNT(*) FROM crypto_demo_operations WHERE status='pending'").fetchone()[0]
        assert pending == 8
        return snapshots(symbols, *args)

    requests_before = JevTestHandler.request_count
    decisions_before = len(dashboard_module.demo_portfolio.decisions(limit=5000))
    with patch.object(dashboard_module.market_service, 'decision_snapshots', side_effect=reserved_snapshots) as fetch:
        native_batch, native_status = dashboard_module._execute_jev_batch(batch_symbols)
        assert fetch.call_count == 1
    assert native_status == 200 and native_batch['decisionCount'] == 8
    assert JevTestHandler.request_count == requests_before + 1
    assert len(dashboard_module.demo_portfolio.decisions(limit=5000)) == decisions_before + 8
    assert len({item['clientRequestId'] for item in native_batch['results']}) == 8
    for item in native_batch['results']:
        assert item['decision']['source'] == 'jev' and item['decision']['action'] == 'HOLD'
        assert dashboard_module.demo_portfolio.operation(item['clientRequestId'])['result'] == item

    # A malformed batch must veto every member, including otherwise valid BUY outputs.
    buy_output = {'symbol': 'BTCUSDT', 'ok': True, 'valid': True, 'action': 'BUY', 'confidence': 0.8}
    eth_output = {**buy_output, 'symbol': 'ETHUSDT'}
    malformed_batches = [
        [buy_output],
        [buy_output, {**eth_output, 'action': 'WAIT'}],
        [buy_output, {**eth_output, 'valid': False}],
        [buy_output, {**eth_output, 'confidence': 9}],
        [buy_output, {**eth_output, 'decision': 'SELL'}],
        [buy_output, eth_output, buy_output],
        [buy_output, {**eth_output, 'symbol': 'SOLUSDT'}],
    ]
    trades_before = len(dashboard_module.demo_portfolio.trades())
    for outputs in malformed_batches:
        with patch.object(http_jev, 'decide_many', return_value={'ok': True, 'valid': True, 'decisions': outputs}):
            rejected_batch, rejected_status = dashboard_module._execute_jev_batch(['BTCUSDT', 'ETHUSDT'])
        assert rejected_status == 502
        assert rejected_batch['jevLatencyMs'] is None
        assert len(rejected_batch['results']) == 2
        assert all(item['errorCode'] == 'invalid_decision_output' for item in rejected_batch['results'])
        assert all(item['decision']['executed'] is False for item in rejected_batch['results'])
        assert len(dashboard_module.demo_portfolio.trades()) == trades_before
    with patch.object(http_jev, 'decide_many', side_effect=TimeoutError(test_key)):
        failed_batch, failed_status = dashboard_module._execute_jev_batch(['BTCUSDT', 'ETHUSDT'])
    assert failed_status == 503 and failed_batch['jevLatencyMs'] is None
    assert all(item['errorCode'] == 'jev_timeout' for item in failed_batch['results'])
    assert test_key not in json.dumps(failed_batch)
    with patch.object(dashboard_module.market_service, 'decision_snapshots', side_effect=RuntimeError(test_key)), \
            patch.object(http_jev, 'decide_many') as decide:
        offline_batch, offline_status = dashboard_module._execute_jev_batch(['BTCUSDT', 'ETHUSDT'])
        decide.assert_not_called()
    assert offline_status == 503 and len(offline_batch['results']) == 2
    assert all(item['errorCode'] == 'market_unavailable' for item in offline_batch['results'])
    assert all(item['decision']['action'] is None for item in offline_batch['results'])
    assert test_key not in json.dumps(offline_batch)

    # A retry while the first HTTP call is preparing must never invoke Jev twice.
    entered, release = threading.Event(), threading.Event()
    in_flight = mutation_payload()
    completed = []

    def waiting_snapshots(symbols, *args):
        entered.set()
        assert release.wait(3)
        return snapshots(symbols, *args)

    def first_request():
        with app.test_client() as concurrent_client:
            completed.append(concurrent_client.post(paths['decision'], json=in_flight))

    with patch.object(dashboard_module.market_service, 'decision_snapshots', side_effect=waiting_snapshots), \
            patch.object(http_jev, 'decide', return_value={'ok': True, 'valid': True, 'action': 'HOLD'}) as decide:
        worker = threading.Thread(target=first_request, daemon=True)
        worker.start()
        try:
            assert entered.wait(3)
            concurrent_retry = client.post(paths['decision'], json=in_flight)
            assert concurrent_retry.status_code == 409
            assert concurrent_retry.get_json()['errorCode'] == 'operation_in_progress'
            pending = client.get('/api/crypto/operations/' + in_flight['clientRequestId']).get_json()
            assert pending['status'] == 'pending'
            pending_reset = client.post(paths['reset'], json={'clientRequestId': str(uuid4()), 'confirmation': 'RESET_DEMO_ACCOUNT'})
            assert pending_reset.status_code == 409
            assert pending_reset.get_json()['errorCode'] == 'reset_not_allowed'
        finally:
            release.set()
            worker.join(timeout=3)
        assert not worker.is_alive() and completed[0].status_code == 200
        assert client.post(paths['decision'], json=in_flight).data == completed[0].data
        assert decide.call_count == 1

    # Mixed decisions commit SELL, HOLD, BUY even when the provider returns another order.
    with patch.object(dashboard_module.asset_mode_manager, 'get_mode', return_value='DEMO_TRADE_ALLOWED'):
        assert client.post(paths['buy'], json=mutation_payload(quoteAmount=100)).status_code == 200
        mixed_outputs = [
            {**buy_output, 'symbol': 'ETHUSDT'},
            {**buy_output, 'symbol': 'BTCUSDT', 'action': 'SELL'},
            {**buy_output, 'symbol': 'SOLUSDT', 'action': 'HOLD'},
        ]
        with patch.object(http_jev, 'decide_many', return_value={'ok': True, 'valid': True, 'decisions': mixed_outputs}), \
                patch.object(dashboard_module.demo_portfolio, 'finish', wraps=dashboard_module.demo_portfolio.finish) as finish:
            mixed, mixed_status = dashboard_module._execute_jev_batch(['ETHUSDT', 'BTCUSDT', 'SOLUSDT'])
            assert [call.args[1]['symbol'] for call in finish.call_args_list] == ['BTCUSDT', 'SOLUSDT', 'ETHUSDT']
        assert mixed_status == 200
        assert sum(item['tradeExecuted'] for item in mixed['results']) == 2
        for item in mixed['results']:
            if item['tradeExecuted']:
                trade = dashboard_module.demo_portfolio.record_by_id('trade', item['tradeId'])
                assert trade['source'] == 'jev' and trade['decisionId'] == item['decisionId']
                assert item['decision']['tradeId'] == trade['tradeId']
    with closing(sqlite3.connect(db_path)) as connection:
        assert connection.execute("SELECT COUNT(*) FROM crypto_demo_operations WHERE status='pending'").fetchone()[0] == 0

source_text = "\n".join(path.read_text(encoding="utf-8") for path in SRC.glob("*.py"))
assert ".create_order(" not in source_text
assert ".withdraw(" not in source_text

print("EDITH crypto Jev demo tests passed")
jev_server.shutdown()
jev_server.server_close()
provider_guard.stop()
temp_dir.cleanup()
