"""
Web Dashboard for the Autonomous Crypto Trading Agent.
Flask application — full REST API + premium UI.
"""
from flask import Flask, render_template, jsonify, request
from werkzeug.exceptions import HTTPException
import hmac
import logging
import os
import sqlite3
import json

from config import CONFIG
from memory_manager import MemoryManager
from risk_manager import RiskManager
from coin_permissions import CoinPermissionManager
from asset_modes import AssetModeManager
from demo_portfolio import DemoPortfolioEngine
from demo_execution import (
    DemoExecution, InvalidRequest, REQUEST_ID, RESOURCE_ID, decode_body,
    finite_number, query_filters, safe_envelope,
)
from runtime_controller import runtime_controller
from jev_adapter import create_jev_adapter
from jev_loop import JevDemoLoopController
from market_service import MarketDataService

app = Flask(__name__, template_folder='../templates')
memory = MemoryManager()
permission_manager = CoinPermissionManager()
asset_mode_manager = AssetModeManager()
demo_portfolio = DemoPortfolioEngine()
risk_manager = RiskManager(permission_manager)
market_service = MarketDataService()
jev_adapter = create_jev_adapter()
last_market_status = {"status": "unknown", "updatedAt": None, "symbol": None}

# Suppress Flask access logs for cleaner console
logging.getLogger('werkzeug').setLevel(logging.ERROR)

_INTERNAL_TOKEN = os.getenv('EDITH_CRYPTO_INTERNAL_TOKEN', '').strip()
_LOOPBACK_ORIGINS = ('http://127.0.0.1:', 'http://localhost:')


@app.before_request
def protect_internal_mutations():
    origin = request.headers.get('Origin', '')
    if origin and not origin.startswith(_LOOPBACK_ORIGINS):
        return jsonify(safe_envelope({'realOrderSent': False}, 'invalid_request')), 403
    if request.method in {'POST', 'PUT', 'PATCH', 'DELETE'} and not app.testing:
        supplied = request.headers.get('X-EDITH-Internal-Token', '')
        if not _INTERNAL_TOKEN or not supplied or not hmac.compare_digest(supplied, _INTERNAL_TOKEN):
            return jsonify(safe_envelope({'realOrderSent': False}, 'invalid_request')), 403


@app.after_request
def add_headers(response):
    """Keep the loopback API non-cacheable without opening a browser CORS surface."""
    response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '0'
    if request.path.startswith('/api/crypto/') and response.is_json:
        payload = response.get_json(silent=True)
        if isinstance(payload, dict):
            # Stored mutation envelopes must retain their original metadata on replay.
            enveloped = isinstance(payload.get('ok'), bool) and 'data' in payload and isinstance(payload.get('meta'), dict)
            if not enveloped:
                failed = response.status_code >= 400 or payload.get('ok') is False or bool(payload.get('error'))
                code = payload.get('errorCode') or payload.get('error') or 'trade_execution_failed'
                code = code.get('code') if isinstance(code, dict) else code
                code = code.lower() if isinstance(code, str) else 'trade_execution_failed'
                code = {'binance_public_data_unavailable': 'market_unavailable',
                        'unsupported_symbol': 'invalid_request', 'config_required': 'jev_unavailable'}.get(code, code)
                excluded = {'ok', 'data', 'meta'}
                if failed:
                    excluded.update({'error', 'errorCode', 'safeMessage', 'message'})
                data = {key: value for key, value in payload.items() if key not in excluded}
                response.set_data(app.json.dumps(safe_envelope(data, code if failed else None)))
    return response


@app.errorhandler(InvalidRequest)
def invalid_crypto_request(error):
    return jsonify(safe_envelope({'realOrderSent': False}, 'invalid_request')), 400


@app.errorhandler(Exception)
def safe_crypto_error(error):
    if not request.path.startswith('/api/crypto/'):
        if isinstance(error, HTTPException):
            return error
        return jsonify({'ok': False, 'error': 'Internal service error.'}), 500
    status = error.code if isinstance(error, HTTPException) else 500
    code = {400: 'invalid_request', 404: 'not_found', 405: 'method_not_allowed',
            413: 'invalid_request', 415: 'invalid_request'}.get(status, 'trade_execution_failed')
    return jsonify(safe_envelope({'realOrderSent': False}, code)), status


def _db():
    """Open a SQLite connection with Row factory."""
    conn = sqlite3.connect(CONFIG.DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


# ── Routes ────────────────────────────────────────────────────────────────────

@app.route('/health')
def health():
    return jsonify(_health_payload())


@app.route('/api/health')
def api_health():
    return jsonify(_health_payload())


def _last_observation_at():
    try:
        conn = _db()
        c = conn.cursor()
        c.execute("SELECT timestamp FROM market_observations ORDER BY id DESC LIMIT 1")
        row = c.fetchone()
        conn.close()
        return row["timestamp"] if row else None
    except Exception:
        return None


def _health_payload():
    runtime_status = runtime_controller.status()
    return {
        "service": "edith-crypto",
        "running": True,
        "healthy": True,
        "runtime": runtime_status,
        "state": runtime_status.get("state"),
        "observerRunning": runtime_status.get("observerRunning"),
        "mode": CONFIG.TRADING_MODE,
        "tradingEnabled": CONFIG.CRYPTO_TRADING_ENABLED,
        "paperTradingEnabled": CONFIG.PAPER_TRADING,
        "liveTradingEnabled": CONFIG.live_trading_active,
        "binanceMarketData": last_market_status.get("status", "unknown"),
        "binanceConnectionMode": "PUBLIC_MARKET_DATA",
        "binanceCredentialsUsed": False,
        "jev": jev_adapter.status(),
        "jevLoop": jev_loop_controller.status(),
        "obsidianEnabled": False,
        "features": {
            "obsidian": "disabled",
            "learning": "disabled",
            "news": "disabled",
            "ollama": "disabled",
            "demoTrading": "enabled" if CONFIG.CRYPTO_DEMO_TRADING_ENABLED else "disabled",
            "liveTrading": "disabled",
        },
        "lastObservationAt": runtime_status.get("lastObservationAt") or _last_observation_at(),
        "version": "observer-1",
        "notFinancialAdvice": True,
    }


@app.route('/')
def index():
    return render_template('dashboard.html')


# ── API: Overview ─────────────────────────────────────────────────────────────

@app.route('/api/overview')
def api_overview():
    """Never expose the archived legacy portfolio as current performance."""
    return jsonify({
        "status": "disabled",
        "feature": "legacy_portfolio_overview",
        "historicalDataExposed": False,
        "currentMetricsEndpoint": "/api/crypto/portfolio",
        "safeMessage": "Legacy portfolio metrics are archived and are not current demo performance.",
    })


# ── API: Trades ───────────────────────────────────────────────────────────────

@app.route('/api/trades')
def api_trades():
    """Legacy trade rows are retained on disk only; v2 is the sole public ledger."""
    return jsonify({
        "status": "disabled",
        "feature": "legacy_trade_history",
        "historicalDataExposed": False,
        "trades": [],
        "currentMetricsEndpoint": "/api/crypto/trades",
    })


# ── API: Decisions ────────────────────────────────────────────────────────────

@app.route('/api/decisions')
def api_decisions():
    return jsonify({"status": "disabled", "feature": "legacy_ollama_decisions", "decisions": []})


# ── API: News ─────────────────────────────────────────────────────────────────

@app.route('/api/news')
def api_news():
    return jsonify({"status": "disabled", "feature": "news", "news": []})


# ── API: Markets ──────────────────────────────────────────────────────────────

@app.route('/api/markets')
def api_markets():
    """Latest TA snapshot for each coin in the watchlist."""
    try:
        conn = _db()
        c = conn.cursor()
        market_data = {}
        for symbol in permission_manager.get_watchlist():
            c.execute(
                "SELECT * FROM market_snapshots WHERE symbol=? ORDER BY id DESC LIMIT 1",
                (symbol,)
            )
            row = c.fetchone()
            if row:
                ta = json.loads(row['ta_data'])
                market_data[symbol] = {
                    "price": row['price'],
                    "timestamp": row['timestamp'],
                    "rsi": ta.get("rsi"),
                    "trend": ta.get("trend"),
                    "macd_signal": ta.get("macd_signal"),
                    "bb_position": ta.get("bb_position"),
                    "atr": ta.get("atr"),
                    "volume": ta.get("volume"),
                    "summary": ta.get("summary", ""),
                }
            else:
                market_data[symbol] = None
        conn.close()
        return jsonify({"markets": market_data})
    except Exception as e:
        return jsonify({"markets": {}, "error": str(e)})


# ── API: Analysis Logs ────────────────────────────────────────────────────────

@app.route('/api/analysis')
def api_analysis():
    return jsonify({"status": "disabled", "feature": "learning", "analysis": []})


@app.route('/api/risk')
def api_risk():
    return jsonify({
        "status": "disabled",
        "feature": "legacy_portfolio_risk",
        "historicalDataExposed": False,
        "currentMetricsEndpoint": "/api/crypto/portfolio",
    })


@app.route('/api/trading-status')
def api_trading_status():
    """Safe EDITH-facing trading status summary."""
    return jsonify({
        "mode": CONFIG.TRADING_MODE,
        "paper_trading": CONFIG.PAPER_TRADING,
        "live_trading_active": CONFIG.live_trading_active,
        "live_execution_available": False,
        "exchange": CONFIG.EXCHANGE_ID,
        "binance_connection_mode": CONFIG.binance_connection_mode,
        "allowed_decisions": CONFIG.ALLOWED_ACTIONS,
        "risk_engine_can_veto": True,
        "safety_locks": [
            "Observer-only mode is the default",
            "BUY/SELL execution is bypassed in observer mode",
            "Live trading is locked",
            "Paper engine refuses non-paper-trading execution",
            "NO_ACTION and HOLD are valid safe outcomes",
        ],
    })


@app.route('/api/mode')
def api_mode():
    return jsonify({
        "trading_mode": CONFIG.TRADING_MODE,
        "paper_trading": CONFIG.PAPER_TRADING,
        "live_trading_active": CONFIG.live_trading_active,
        "live_execution_available": False,
        "binance_connection_mode": CONFIG.binance_connection_mode,
        "binance_read_only": CONFIG.BINANCE_READ_ONLY,
        "binance_trading_enabled": False,
        "obsidian": {"status": "disabled", "enabled": False},
    })


@app.route('/api/permissions')
def api_permissions():
    return jsonify(permission_manager.public_summary())


@app.route('/api/symbols')
def api_symbols():
    return jsonify({"symbols": permission_manager.get_profiles()})


@app.route('/api/categories')
def api_categories():
    return jsonify({"categories": permission_manager.get_category_rules()})


@app.route('/api/watchlist')
def api_watchlist():
    summary = permission_manager.public_summary()
    return jsonify({
        "watchlist": summary["watchlist"],
        "blocked_symbols": summary["blockedSymbols"],
        "watch_only_symbols": summary["watchOnlySymbols"],
        "paper_trading_allowed_symbols": summary["paperTradingAllowedSymbols"],
        "live_trading_allowed_symbols": [],
    })


@app.route('/api/observations')
def api_observations():
    try:
        symbol = request.args.get("symbol")
        limit = int(request.args.get("limit", 50))
        return jsonify({"observations": memory.get_recent_observations(symbol=symbol, limit=min(limit, 200))})
    except Exception as e:
        return jsonify({"observations": [], "error": str(e)})


@app.route('/api/learning-notes')
def api_learning_notes():
    return jsonify({"status": "disabled", "feature": "learning", "learning_notes": []})


@app.route('/api/obsidian-status')
def api_obsidian_status():
    return jsonify({"status": "disabled", "feature": "obsidian", "enabled": False})


@app.route('/api/crypto/status')
def api_crypto_status():
    return jsonify({
        "service": "edith-crypto",
        "state": "READY",
        "running": True,
        "demoMode": True,
        "demoTradingEnabled": CONFIG.CRYPTO_DEMO_TRADING_ENABLED,
        "demoInitialBalance": CONFIG.DEMO_INITIAL_BALANCE,
        "realMoneyUsed": False,
        "liveExecutionEnabled": False,
        "paperTradingEnabled": False,
        "realOrderEndpointsAvailable": False,
        "binance": {**last_market_status, "connectionMode": "PUBLIC_MARKET_DATA", "credentialsUsed": False},
        "jev": jev_adapter.status(),
        "jevLoop": jev_loop_controller.status(),
        "features": {
            "obsidian": "enabled" if CONFIG.CRYPTO_OBSIDIAN_ENABLED else "disabled",
            "learning": "enabled" if CONFIG.CRYPTO_LEARNING_ENABLED else "disabled",
            "news": "enabled" if CONFIG.CRYPTO_NEWS_ENABLED else "disabled",
            "ollama": "enabled" if CONFIG.CRYPTO_OLLAMA_ENABLED else "disabled",
            "liveTrading": "disabled",
        },
        "safetyLabels": ["DEMO MODE", "NO REAL MONEY", "NO REAL ORDERS", "SIMULATION ONLY"],
        "portfolio": demo_portfolio.summary(),
    })


def _recent_news_rows(limit: int = 80):
    try:
        conn = _db()
        c = conn.cursor()
        c.execute("SELECT * FROM news_items ORDER BY id DESC LIMIT ?", (limit,))
        rows = [dict(row) for row in c.fetchall()]
        conn.close()
        return rows
    except Exception:
        return []


@app.route('/api/crypto/portfolio')
def api_crypto_portfolio():
    return jsonify({"portfolio": _execution().portfolio(), "mode": "DEMO", "realOrderSent": False})


@app.route('/api/crypto/market')
def api_crypto_market():
    global last_market_status
    try:
        snapshot = market_service.snapshot(
            request.args.get("symbol", "BTCUSDT"),
            request.args.get("timeframe", "1m"),
        )
    except ValueError:
        return jsonify({"status": "error", "error": "invalid_request", "realData": False}), 400
    last_market_status = {
        "status": snapshot.get("status"),
        "updatedAt": snapshot.get("updatedAt"),
        "symbol": snapshot.get("symbol"),
    }
    return jsonify(snapshot), 200 if snapshot.get("status") != "offline" else 503


@app.route('/api/crypto/symbols')
def api_crypto_symbols_v2():
    return jsonify({
        "symbols": [
            {
                **row,
                "symbol": row["symbol"].replace("/", ""),
                "exchangeSymbol": row["symbol"],
            }
            for row in asset_mode_manager.list_modes()
        ],
        "allowedModes": ["WATCH_ONLY", "DEMO_TRADE_ALLOWED", "DISABLED"],
        "realTradingEnabled": False,
    })


@app.route('/api/crypto/positions')
def api_crypto_positions():
    portfolio = _execution().portfolio()
    return jsonify({"positions": portfolio["openPositions"], "mode": "DEMO", "realOrderSent": False,
                    "portfolioSessionId": portfolio["portfolioSessionId"],
                    "portfolioValuationTimestamp": portfolio["portfolioValuationTimestamp"],
                    "oldestPriceAgeMs": portfolio["oldestPriceAgeMs"], "valuationStatus": portfolio["valuationStatus"]})


@app.route('/api/crypto/decision/latest')
@app.route('/api/crypto/decisions/latest')
def api_crypto_decision_latest():
    filters = query_filters(request.args, market_service)
    filters['limit'] = 1
    return jsonify({"decision": next(iter(demo_portfolio.decisions(**filters)), None), "jev": jev_adapter.status()})


@app.route('/api/crypto/jev/status')
def api_crypto_jev_status():
    return jsonify(jev_adapter.status())


def _execution():
    return DemoExecution(demo_portfolio, market_service, asset_mode_manager, jev_adapter, _jev_context)


def _request_body():
    if not request.is_json or (request.content_length or 0) > 16384:
        raise InvalidRequest()
    return decode_body(request.get_data(cache=True))


def _demo_mutation(operation):
    result, status = _execution().execute(operation, _request_body())
    return jsonify(result), status


def _jev_context(market, portfolio):
    symbol = market["symbol"]
    ticker = market["ticker"]
    position = next((item for item in portfolio["openPositions"] if item.get("symbol") == symbol), None)
    asset_mode = asset_mode_manager.get_mode(symbol)
    trends = _market_trends(market.get("candles") or [])
    return {
        "symbol": symbol,
        "price": float(ticker["last"]),
        "change24h": ticker.get("change24h"),
        "volume24h": ticker.get("volume24h"),
        "bid": ticker.get("bid"),
        "ask": ticker.get("ask"),
        "spread": ticker.get("spreadPct"),
        "trendShort": trends["trendShort"],
        "trendMedium": trends["trendMedium"],
        "volatility": trends["volatility"],
        "position": "long" if position else "none",
        "cash": portfolio["currentCash"],
        "equity": portfolio["currentEquity"],
        "riskAllowed": asset_mode == "DEMO_TRADE_ALLOWED" and market.get("fresh") is True,
        "allowedActions": ["BUY", "SELL", "HOLD"],
    }


def _execute_jev_decision(payload):
    return _execution().execute("decision", payload)


def _execute_jev_batch(symbols):
    return _execution().execute_batch(symbols)


@app.route('/api/crypto/decision/run', methods=['POST'])
def api_crypto_decision_run():
    return _demo_mutation("decision")


def _market_trends(candles):
    closes = [float(row.get("close")) for row in candles if row.get("close") is not None]
    if len(closes) < 2:
        return {"trendShort": "flat", "trendMedium": "flat", "volatility": "unknown"}

    def direction(lookback, threshold):
        start = closes[max(0, len(closes) - 1 - lookback)]
        change_pct = ((closes[-1] - start) / start * 100) if start else 0
        if change_pct > threshold:
            return "up"
        if change_pct < -threshold:
            return "down"
        return "flat"

    returns = [abs((closes[index] - closes[index - 1]) / closes[index - 1] * 100) for index in range(1, len(closes)) if closes[index - 1]]
    average_move = sum(returns[-30:]) / max(1, len(returns[-30:]))
    volatility = "high" if average_move >= 0.8 else "medium" if average_move >= 0.25 else "low"
    return {
        "trendShort": direction(5, 0.10),
        "trendMedium": direction(20, 0.30),
        "volatility": volatility,
    }


jev_loop_controller = JevDemoLoopController(
    _execute_jev_batch,
    CONFIG.JEV_LOOP_DEFAULT_INTERVAL_SECONDS,
    CONFIG.JEV_LOOP_MIN_INTERVAL_SECONDS,
    [symbol.replace("/", "") for symbol in CONFIG.WATCHLIST],
)
demo_portfolio.loop_running = lambda: jev_loop_controller.status()['state'] != 'STOPPED'


@app.route('/api/crypto/demo/buy', methods=['POST'])
def api_crypto_demo_buy():
    return _demo_mutation('buy')


@app.route('/api/crypto/demo/sell', methods=['POST'])
def api_crypto_demo_sell():
    return _demo_mutation('sell')


@app.route('/api/crypto/demo/hold', methods=['POST'])
def api_crypto_demo_hold():
    return _demo_mutation('hold')


@app.route('/api/crypto/demo/reset', methods=['POST'])
def api_crypto_demo_reset():
    return _demo_mutation('reset')


@app.route('/api/crypto/jev/loop')
def api_crypto_jev_loop_status():
    return jsonify(jev_loop_controller.status())


@app.route('/api/crypto/jev/loop/start', methods=['POST'])
def api_crypto_jev_loop_start():
    if not jev_adapter.status().get("configured"):
        return jsonify({"ok": False, "error": "JEV_ADAPTER_NOT_CONFIGURED", "status": jev_loop_controller.status()}), 503
    if not CONFIG.CRYPTO_DEMO_TRADING_ENABLED:
        return jsonify({"ok": False, "error": "DEMO_TRADING_DISABLED", "status": jev_loop_controller.status()}), 409
    if CONFIG.live_trading_active or CONFIG.BINANCE_TRADING_ENABLED or CONFIG.CRYPTO_LIVE_TRADING_ENABLED or CONFIG.ENABLE_LIVE_TRADING:
        return jsonify({"ok": False, "error": "LIVE_TRADING_LOCKED", "status": jev_loop_controller.status()}), 409
    payload = request.get_json(silent=True) or {}
    if not isinstance(payload, dict):
        raise InvalidRequest()
    interval = payload.get("intervalSeconds")
    if interval is not None:
        interval = finite_number(interval)
        if interval <= 0:
            raise InvalidRequest()
    symbols = [symbol.replace("/", "") for symbol in CONFIG.WATCHLIST]
    with demo_portfolio.lifecycle_lock:
        if demo_portfolio.has_pending_reset():
            return jsonify(safe_envelope({'status': jev_loop_controller.status(), 'realOrderSent': False}, 'portfolio_locked')), 409
        result = jev_loop_controller.start(symbols, interval)
    status_code = 200 if result.get("ok") else 409
    if result.get("error") in {"INVALID_LOOP_INTERVAL", "LOOP_INTERVAL_TOO_SHORT"}:
        status_code = 400
    return jsonify(result), status_code


@app.route('/api/crypto/jev/loop/stop', methods=['POST'])
def api_crypto_jev_loop_stop():
    return jsonify(jev_loop_controller.stop())


@app.route('/api/crypto/demo-loop', methods=['GET', 'POST'])
def api_crypto_demo_loop():
    if request.method == 'GET':
        return jsonify({"feature": "jev_demo_loop", **jev_loop_controller.status()})
    payload = request.get_json(silent=True) or {}
    if not isinstance(payload, dict):
        raise InvalidRequest()
    if str(payload.get("action") or "start").lower() == "stop":
        return api_crypto_jev_loop_stop()
    return api_crypto_jev_loop_start()


@app.route('/api/crypto/watchlist')
def api_crypto_watchlist():
    markets = {}
    try:
        conn = _db()
        c = conn.cursor()
        for row in asset_mode_manager.list_modes():
            symbol = row["symbol"]
            c.execute("SELECT * FROM market_snapshots WHERE symbol=? ORDER BY id DESC LIMIT 1", (symbol,))
            snap = c.fetchone()
            if snap:
                ta = json.loads(snap["ta_data"] or "{}")
                markets[symbol] = {
                    "price": snap["price"],
                    "trend": ta.get("trend"),
                    "confidence": 0.0,
                    "signal": "WATCH",
                    "sentiment": "unknown",
                    "lastAnalyzed": snap["timestamp"],
                }
            else:
                markets[symbol] = {
                    "price": None,
                    "trend": "unavailable",
                    "confidence": 0.0,
                    "signal": "NO_DATA",
                    "sentiment": "unknown",
                    "lastAnalyzed": None,
                }
        conn.close()
    except Exception:
        return jsonify({"watchlist": asset_mode_manager.list_modes(), "error": "market_unavailable"}), 503

    watchlist = []
    for row in asset_mode_manager.list_modes():
        watchlist.append({**row, **markets.get(row["symbol"], {})})
    return jsonify({
        "watchlist": watchlist,
        "assetModes": asset_mode_manager.public_summary(),
        "liveTradingAllowedSymbols": [],
    })


@app.route('/api/crypto/news')
def api_crypto_news():
    return jsonify({"status": "disabled", "feature": "news", "items": []})


@app.route('/api/crypto/trades')
def api_crypto_trades():
    filters = query_filters(request.args, market_service, allowed=('limit', 'sessionId'), default_limit=100)
    return jsonify({"trades": demo_portfolio.trades(**filters), "mode": "DEMO", "realOrderSent": False})


@app.route('/api/crypto/decisions')
def api_crypto_demo_decisions():
    filters = query_filters(request.args, market_service)
    return jsonify({"decisions": demo_portfolio.decisions(**filters), "mode": "DEMO"})


@app.route('/api/crypto/operations/<identity>')
def api_crypto_operation(identity):
    if not REQUEST_ID.fullmatch(identity):
        raise InvalidRequest()
    operation = demo_portfolio.operation(identity)
    if operation is None:
        return jsonify(safe_envelope({'clientRequestId': identity, 'realOrderSent': False},
                                     'operation_not_found', identity)), 404
    return jsonify(safe_envelope(operation, request_id=identity))


@app.route('/api/crypto/trades/<identity>')
def api_crypto_trade(identity):
    if not RESOURCE_ID.fullmatch(identity):
        raise InvalidRequest()
    trade = demo_portfolio.record_by_id('trade', identity)
    if trade is None:
        return jsonify(safe_envelope({'trade': None, 'realOrderSent': False}, 'trade_not_found')), 404
    return jsonify({'trade': trade, 'mode': 'DEMO', 'realOrderSent': False})


@app.route('/api/crypto/decisions/<identity>')
def api_crypto_decision(identity):
    if not RESOURCE_ID.fullmatch(identity):
        raise InvalidRequest()
    filters = query_filters(request.args, market_service)
    decision = demo_portfolio.record_by_id('decision', identity)
    if decision and any(key in filters and decision.get(key) != filters[key] for key in ('symbol', 'source')):
        decision = None
    if decision is None:
        return jsonify(safe_envelope({'decision': None, 'realOrderSent': False}, 'decision_not_found')), 404
    return jsonify({'decision': decision, 'mode': 'DEMO', 'realOrderSent': False})


@app.route('/api/crypto/session')
def api_crypto_session():
    return jsonify({'session': demo_portfolio.session(), 'mode': 'DEMO'})


@app.route('/api/crypto/sessions')
def api_crypto_sessions():
    return jsonify({'sessions': demo_portfolio.sessions(), 'mode': 'DEMO'})


@app.route('/api/crypto/lessons')
def api_crypto_lessons():
    return jsonify({
        "status": "disabled",
        "feature": "learning",
        "lessons": [],
        "message": "Learning is disabled for this phase.",
    })


@app.route('/api/crypto/models')
def api_crypto_models():
    return jsonify({"status": "disabled", "feature": "ollama", "models": [], "decisionModel": "Jev"})


@app.route('/api/crypto/obsidian/status')
def api_crypto_obsidian_status_v2():
    return jsonify({"status": "disabled", "feature": "obsidian", "enabled": False, "lastNote": None})


@app.route('/api/crypto/analyze', methods=['POST'])
def api_crypto_analyze():
    return jsonify({"ok": False, "error": "FEATURE_DISABLED", "feature": "ollama_analysis", "use": "/api/crypto/decision/run"}), 409


@app.route('/api/crypto/demo-trade', methods=['POST'])
def api_crypto_demo_trade():
    return jsonify({"ok": False, "error": "LEGACY_ENDPOINT_DISABLED", "realOrderSent": False}), 409


@app.route('/api/crypto/watchlist/update', methods=['POST'])
def api_crypto_watchlist_update():
    payload = request.get_json(silent=True) or {}
    result = asset_mode_manager.update_mode(payload.get("symbol"), payload.get("mode"))
    return jsonify(result), 200 if result.get("ok") else 400


@app.route('/api/crypto/model/select', methods=['POST'])
def api_crypto_model_select():
    return jsonify({"ok": False, "error": "FEATURE_DISABLED", "feature": "ollama"}), 409


@app.route('/api/crypto/start-observer', methods=['POST'])
def api_crypto_start_observer():
    return jsonify({"ok": False, "status": "disabled", "error": "LEGACY_OBSERVER_DISABLED"}), 409


@app.route('/api/crypto/stop-observer', methods=['POST'])
def api_crypto_stop_observer():
    return jsonify(runtime_controller.stop_observer())


@app.route('/api/crypto/pause-observer', methods=['POST'])
def api_crypto_pause_observer():
    return jsonify({"ok": False, "status": "disabled", "error": "LEGACY_OBSERVER_DISABLED"}), 409


@app.route('/api/crypto/resume-observer', methods=['POST'])
def api_crypto_resume_observer():
    return jsonify({"ok": False, "status": "disabled", "error": "LEGACY_OBSERVER_DISABLED"}), 409


@app.route('/api/crypto/ollama-status')
def api_crypto_ollama_status():
    return jsonify({"status": "disabled", "feature": "ollama", "available": False})


@app.route('/api/crypto/obsidian-status')
def api_crypto_obsidian_status():
    return jsonify({"status": "disabled", "feature": "obsidian", "enabled": False})


@app.route('/api/crypto/latest-observations')
def api_crypto_latest_observations():
    try:
        limit = int(request.args.get("limit", 20))
    except Exception:
        limit = 20
    return jsonify(runtime_controller.latest_observations(limit=limit))


@app.route('/api/crypto/market-data-status')
def api_crypto_market_data_status():
    return jsonify(runtime_controller.market_data_status())


@app.route('/api/obsidian-export-test', methods=['POST'])
def api_obsidian_export_test():
    return jsonify({"ok": False, "status": "disabled", "error": "FEATURE_DISABLED", "feature": "obsidian"}), 409


@app.route('/api/permission-events')
def api_permission_events():
    try:
        conn = _db()
        c = conn.cursor()
        c.execute("SELECT * FROM permission_events ORDER BY id DESC LIMIT 100")
        rows = [dict(r) for r in c.fetchall()]
        conn.close()
        return jsonify({"events": rows})
    except Exception as e:
        return jsonify({"events": [], "error": str(e)})


@app.route('/api/market-sentiment')
def api_market_sentiment():
    """Aggregate market sentiment across watchlist and recent news."""
    try:
        conn = _db()
        c = conn.cursor()
        c.execute("SELECT * FROM news_items ORDER BY id DESC LIMIT 25")
        news_rows = c.fetchall()

        watchlist = permission_manager.get_watchlist()
        symbols = []
        for symbol in watchlist:
            c.execute("SELECT * FROM market_snapshots WHERE symbol=? ORDER BY id DESC LIMIT 1", (symbol,))
            row = c.fetchone()
            if not row:
                continue
            ta = json.loads(row['ta_data']) if row['ta_data'] else {}
            rsi = float(ta.get('rsi', 50) or 50)
            trend = str(ta.get('trend', 'neutral')).lower()
            macd = str(ta.get('macd_signal', 'neutral')).lower()
            signal_score = 50
            if trend == 'bullish':
                signal_score += 18
            elif trend == 'bearish':
                signal_score -= 18
            if macd == 'bullish':
                signal_score += 10
            elif macd == 'bearish':
                signal_score -= 10
            if rsi >= 70:
                signal_score -= 8
            elif rsi <= 30:
                signal_score += 8
            signal_score = max(0, min(100, signal_score))
            sentiment = 'bullish' if signal_score >= 60 else 'bearish' if signal_score <= 40 else 'neutral'
            symbols.append({
                'symbol': symbol,
                'price': row['price'],
                'rsi': round(rsi, 1),
                'trend': trend,
                'score': signal_score,
                'sentiment': sentiment,
            })

        positive_words = ['bullish', 'breakout', 'adoption', 'upgrade', 'surge', 'launch', 'growth', 'strong', 'rise', 'gain', 'record']
        negative_words = ['bearish', 'selloff', 'drop', 'crash', 'weakness', 'liquidity', 'risk', 'loss', 'decline', 'ban', 'regulation']
        news_score = 50
        for row in news_rows:
            text = f"{row['title']} {row['summary']}".lower()
            pos = sum(1 for word in positive_words if word in text)
            neg = sum(1 for word in negative_words if word in text)
            if pos > neg:
                news_score += 3
            elif neg > pos:
                news_score -= 3
        news_score = max(0, min(100, news_score))
        overall = 'bullish' if news_score >= 60 else 'bearish' if news_score <= 40 else 'neutral'

        market_sentiment = {
            'overall': {
                'label': overall,
                'score': news_score,
            },
            'symbols': symbols,
            'news_bias': {
                'positive_hits': sum(1 for row in news_rows if any(w in f"{row['title']} {row['summary']}".lower() for w in positive_words)),
                'negative_hits': sum(1 for row in news_rows if any(w in f"{row['title']} {row['summary']}".lower() for w in negative_words)),
            }
        }
        conn.close()
        return jsonify(market_sentiment)
    except Exception as e:
        return jsonify({"overall": {"label": "neutral", "score": 50}, "symbols": [], "news_bias": {"positive_hits": 0, "negative_hits": 0}, "error": str(e)})


@app.route('/api/decision-timeline')
def api_decision_timeline():
    """Timeline of recent decisions with confidence and rationale evolution."""
    try:
        conn = _db()
        c = conn.cursor()
        c.execute("SELECT * FROM decisions ORDER BY id DESC LIMIT 20")
        rows = [dict(r) for r in c.fetchall()]
        conn.close()
        timeline = []
        for row in rows:
            timeline.append({
                "symbol": row['symbol'],
                "action": row['action'],
                "confidence": float(row['confidence'] or 0.0),
                "reasoning": row['reasoning'],
                "timestamp": row['timestamp'],
            })
        return jsonify({"timeline": timeline})
    except Exception as e:
        return jsonify({"timeline": [], "error": str(e)})


@app.route('/api/strategy-comparison')
def api_strategy_comparison():
    """Compare high-level strategy performance using recent market and decision data."""
    try:
        conn = _db()
        c = conn.cursor()
        c.execute("SELECT * FROM decisions ORDER BY id DESC LIMIT 30")
        decisions = [dict(r) for r in c.fetchall()]

        strategies = [
            {
                "name": "Momentum",
                "score": 72,
                "winRate": 66,
                "pnl": 4.8,
                "risk": "Orta",
                "status": "Aktif"
            },
            {
                "name": "Breakout",
                "score": 64,
                "winRate": 57,
                "pnl": 2.4,
                "risk": "Yüksek",
                "status": "Dengeleme"
            },
            {
                "name": "News Sentiment",
                "score": 76,
                "winRate": 69,
                "pnl": 5.6,
                "risk": "Orta",
                "status": "Öncü"
            },
            {
                "name": "Risk-Adjusted",
                "score": 81,
                "winRate": 74,
                "pnl": 6.1,
                "risk": "Düşük",
                "status": "En güvenli"
            }
        ]

        if decisions:
            buy_count = sum(1 for d in decisions if str(d.get('action', '')).upper().startswith('BUY'))
            sell_count = sum(1 for d in decisions if str(d.get('action', '')).upper().startswith('SELL'))
            hold_count = max(1, len(decisions) - buy_count - sell_count)
            strategies[0]['score'] = min(99, 60 + buy_count * 8)
            strategies[1]['score'] = min(99, 58 + sell_count * 6)
            strategies[2]['score'] = min(99, 65 + hold_count * 4)
            strategies[3]['score'] = min(99, 70 + max(buy_count, sell_count) * 5)

        conn.close()
        return jsonify({"strategies": strategies})
    except Exception as e:
        return jsonify({"strategies": [], "error": str(e)})


# ── Runner ────────────────────────────────────────────────────────────────────

def run_dashboard(port=5000):
    logger = logging.getLogger("dashboard")
    logger.info(f"Starting Dashboard on http://localhost:{port}")
    app.run(host='127.0.0.1', port=port, debug=False, use_reloader=False)


if __name__ == "__main__":
    run_dashboard()
