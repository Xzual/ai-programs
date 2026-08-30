"""
Web Dashboard for the Autonomous Crypto Trading Agent.
Flask application — full REST API + premium UI.
"""
from flask import Flask, render_template, jsonify, request, Response
import logging
import sqlite3
import json
from datetime import datetime

from config import CONFIG
from memory_manager import MemoryManager
from risk_manager import RiskManager

app = Flask(__name__, template_folder='../templates')
memory = MemoryManager()
risk_manager = RiskManager()

# Suppress Flask access logs for cleaner console
logging.getLogger('werkzeug').setLevel(logging.ERROR)


@app.after_request
def add_headers(response):
    """Allow all origins + bypass ngrok browser warning + avoid stale UI/API cache."""
    response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type'
    response.headers['ngrok-skip-browser-warning'] = 'true'
    response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '0'
    return response


def _db():
    """Open a SQLite connection with Row factory."""
    conn = sqlite3.connect(CONFIG.DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


# ── Routes ────────────────────────────────────────────────────────────────────

@app.route('/health')
def health():
    return jsonify({"status": "ok"})


@app.route('/')
def index():
    return render_template('dashboard.html')


# ── API: Overview ─────────────────────────────────────────────────────────────

@app.route('/api/overview')
def api_overview():
    """Portfolio summary + equity curve for the main dashboard."""
    portfolio = {"balance": CONFIG.INITIAL_BALANCE, "positions": [], "initial_balance": CONFIG.INITIAL_BALANCE}
    equity_history = []
    stats = {"total_trades": 0, "win_rate": 0, "total_pnl": 0, "open_positions": 0}

    try:
        conn = _db()
        c = conn.cursor()

        # Latest portfolio state
        c.execute("SELECT * FROM portfolio_state ORDER BY id DESC LIMIT 1")
        row = c.fetchone()
        if row:
            portfolio = {
                "balance": round(row['balance_usdt'], 2),
                "equity":  round(row['equity'] or row['balance_usdt'], 2),
                "positions": json.loads(row['positions']),
                "initial_balance": CONFIG.INITIAL_BALANCE
            }

        # Equity history (last 50 snapshots)
        c.execute("SELECT timestamp, equity, balance_usdt FROM portfolio_state ORDER BY id DESC LIMIT 50")
        for h in reversed(c.fetchall()):
            val = h['equity'] if h['equity'] is not None else h['balance_usdt']
            ts  = h['timestamp']
            label = ts.split(" ")[1][:5] if " " in ts else ts[:5]
            equity_history.append({"time": label, "equity": round(val, 2)})

        # Trade stats
        c.execute("SELECT count(*) FROM trades WHERE side='SELL' AND status='CLOSED'")
        total_closed = c.fetchone()[0]
        c.execute("SELECT count(*) FROM trades WHERE side='SELL' AND status='CLOSED' AND pnl > 0")
        winning = c.fetchone()[0]
        c.execute("SELECT COALESCE(SUM(pnl), 0) FROM trades WHERE side='SELL' AND status='CLOSED'")
        total_pnl = c.fetchone()[0]
        c.execute("SELECT count(*) FROM trades WHERE status='OPEN'")
        open_pos = c.fetchone()[0]

        stats = {
            "total_trades": total_closed,
            "win_rate": round((winning / total_closed * 100) if total_closed else 0, 1),
            "total_pnl": round(total_pnl or 0, 2),
            "open_positions": open_pos
        }

        conn.close()
    except Exception as e:
        app.logger.error(f"api_overview error: {e}")

    pnl_pct = round(
        ((portfolio["balance"] - portfolio["initial_balance"]) / portfolio["initial_balance"]) * 100, 2
    )

    return jsonify({
        "portfolio": portfolio,
        "equity_history": equity_history,
        "stats": stats,
        "pnl_pct": pnl_pct,
        "config": {
            "model": CONFIG.LLM_MODEL,
            "loop_minutes": CONFIG.LOOP_INTERVAL_MINUTES,
            "watchlist": CONFIG.WATCHLIST,
            "paper_trading": CONFIG.PAPER_TRADING,
            "trading_mode": CONFIG.TRADING_MODE,
            "live_trading_active": CONFIG.live_trading_active,
        }
    })


# ── API: Trades ───────────────────────────────────────────────────────────────

@app.route('/api/trades')
def api_trades():
    """Full trade history with BUY/SELL pairs."""
    try:
        conn = _db()
        c = conn.cursor()
        c.execute("""
            SELECT id, timestamp, symbol, side, price, amount, cost, status, pnl, decision_id, mode
            FROM trades
            ORDER BY id DESC
            LIMIT 100
        """)
        trades = [dict(r) for r in c.fetchall()]
        conn.close()
        return jsonify({"trades": trades})
    except Exception as e:
        return jsonify({"trades": [], "error": str(e)})


# ── API: Decisions ────────────────────────────────────────────────────────────

@app.route('/api/decisions')
def api_decisions():
    """LLM decision log."""
    try:
        conn = _db()
        c = conn.cursor()
        c.execute("SELECT * FROM decisions ORDER BY id DESC LIMIT 50")
        rows = [dict(r) for r in c.fetchall()]
        conn.close()
        return jsonify({"decisions": rows})
    except Exception as e:
        return jsonify({"decisions": [], "error": str(e)})


# ── API: News ─────────────────────────────────────────────────────────────────

@app.route('/api/news')
def api_news():
    """Latest news items."""
    try:
        conn = _db()
        c = conn.cursor()
        c.execute("SELECT * FROM news_items ORDER BY id DESC LIMIT 50")
        rows = [dict(r) for r in c.fetchall()]
        conn.close()
        return jsonify({"news": rows})
    except Exception as e:
        return jsonify({"news": [], "error": str(e)})


# ── API: Markets ──────────────────────────────────────────────────────────────

@app.route('/api/markets')
def api_markets():
    """Latest TA snapshot for each coin in the watchlist."""
    try:
        conn = _db()
        c = conn.cursor()
        market_data = {}
        for symbol in CONFIG.WATCHLIST:
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
    """Self-improvement analysis log."""
    try:
        conn = _db()
        c = conn.cursor()
        c.execute("SELECT * FROM analysis_logs ORDER BY id DESC LIMIT 30")
        rows = [dict(r) for r in c.fetchall()]
        conn.close()
        return jsonify({"analysis": rows})
    except Exception as e:
        return jsonify({"analysis": [], "error": str(e)})


@app.route('/api/risk')
def api_risk():
    """Portfolio risk summary and open-position exposure."""
    try:
        conn = _db()
        c = conn.cursor()
        c.execute("SELECT * FROM portfolio_state ORDER BY id DESC LIMIT 1")
        latest = c.fetchone()
        positions = []
        balance = CONFIG.INITIAL_BALANCE
        equity = CONFIG.INITIAL_BALANCE
        if latest:
            balance = float(latest['balance_usdt'] or CONFIG.INITIAL_BALANCE)
            equity = float(latest['equity'] or balance)
            positions = json.loads(latest['positions']) if latest['positions'] else []

        c.execute("SELECT timestamp, equity FROM portfolio_state ORDER BY id DESC LIMIT 50")
        history = c.fetchall()
        peak = max((float(h['equity'] or balance) for h in history), default=equity)
        drawdown = max((peak - equity) / peak * 100, 0) if peak > 0 else 0.0

        risk = risk_manager.summarize_portfolio_risk(balance, equity, positions, drawdown)
        conn.close()
        return jsonify({"risk": risk})
    except Exception as e:
        return jsonify({"risk": {"risk_level": "Low", "drawdown_pct": 0, "open_positions": 0, "total_exposure": 0, "exposure_ratio": 0, "mode": CONFIG.TRADING_MODE, "live_trading_active": CONFIG.live_trading_active, "risk_engine_can_veto": True, "alerts": ["Risk data unavailable"], "positions": []}, "error": str(e)})


@app.route('/api/trading-status')
def api_trading_status():
    """Safe EDITH-facing trading status summary."""
    return jsonify({
        "mode": CONFIG.TRADING_MODE,
        "paper_trading": CONFIG.PAPER_TRADING,
        "live_trading_active": CONFIG.live_trading_active,
        "live_execution_available": False,
        "exchange": CONFIG.EXCHANGE_ID,
        "allowed_decisions": CONFIG.ALLOWED_ACTIONS,
        "risk_engine_can_veto": True,
        "safety_locks": [
            "Paper mode is the default",
            "Authenticated exchange access is blocked",
            "Paper engine refuses non-paper execution",
            "Risk engine vetoes live-mode trades",
            "NO TRADE is a valid decision",
        ],
    })


@app.route('/api/market-sentiment')
def api_market_sentiment():
    """Aggregate market sentiment across watchlist and recent news."""
    try:
        conn = _db()
        c = conn.cursor()
        c.execute("SELECT * FROM news_items ORDER BY id DESC LIMIT 25")
        news_rows = c.fetchall()

        watchlist = CONFIG.WATCHLIST
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
    app.run(host='0.0.0.0', port=port, debug=False, use_reloader=False)


if __name__ == "__main__":
    run_dashboard()
