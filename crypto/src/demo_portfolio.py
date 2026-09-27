"""Idempotent local demo ledger. No exchange client or real execution capability."""
import hashlib
import json
import logging
import re
import sqlite3
import threading
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from uuid import uuid4

from config import CONFIG
from demo_migration import migrate
from price_freshness import number, price_status, utc_now

DEMO_INITIAL_BALANCE = float(CONFIG.DEMO_INITIAL_BALANCE)
LOG = logging.getLogger(__name__)
MESSAGES = {
    'duplicate_request': 'Request ID belongs to a different operation.',
    'operation_in_progress': 'Operation result is being confirmed.',
    'operation_not_found': 'Operation not recorded. Reuse the original request ID.',
    'stale_market_data': 'Market price is too old for demo execution.',
    'market_unavailable': 'A timestamped Binance public price is required.',
    'insufficient_balance': 'Insufficient demo credits including fees.',
    'position_not_found': 'No long demo position to sell.',
    'risk_rejected': 'Demo risk guard rejected the action.',
    'invalid_decision_output': 'Jev did not return a valid BUY, SELL or HOLD.',
    'jev_unavailable': 'Jev unavailable or not configured. No trade executed.',
    'jev_timeout': 'Jev timed out. No trade executed.',
    'trade_execution_failed': 'Demo operation did not commit. Inspect the operation record.',
    'portfolio_locked': 'Portfolio has a pending reset or operation.',
    'reset_not_allowed': 'Reset requires confirmation, a stopped loop and no pending operations.',
    'invalid_request': 'Invalid demo request. A unique clientRequestId is required.',
    'operation_expired': 'Operation expired before commit. It cannot execute later.',
}


def envelope(data, request_id=None, code=None):
    result = {'ok': code is None, 'data': data, **data,
              'meta': {'requestId': request_id or uuid4().hex, 'timestamp': utc_now()}}
    if code:
        message = MESSAGES.get(code, MESSAGES['trade_execution_failed'])
        result.update(error={'code': code, 'message': message}, errorCode=code, safeMessage=message)
    return result


class Rejected(Exception):
    def __init__(self, code, reason=None):
        self.code, self.reason = code, reason or code


class DemoPortfolioEngine:
    def __init__(self, db_path=CONFIG.DB_PATH, *, test_only_import_legacy_fixture=False):
        self.db_path = db_path
        self.lifecycle_lock = threading.RLock()
        self.loop_running = lambda: False
        migrate(
            db_path,
            DEMO_INITIAL_BALANCE,
            test_only_import_legacy_fixture=test_only_import_legacy_fixture,
        )

    @contextmanager
    def _db(self, write=False):
        conn = sqlite3.connect(self.db_path, timeout=30)
        conn.row_factory = sqlite3.Row
        try:
            conn.execute('BEGIN IMMEDIATE' if write else 'BEGIN')
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    @staticmethod
    def _state(conn):
        row = dict(conn.execute('SELECT * FROM crypto_demo_sessions WHERE ended_at IS NULL').fetchone())
        row['positions'] = json.loads(row.pop('positions_json'))
        row['timestamp'] = row['updated_at']
        return row

    def latest_state(self):
        with self._db() as conn:
            return self._state(conn)

    @staticmethod
    def _records(conn, table, limit=100, session=None, symbol=None, source=None):
        where, args = [], []
        for key, value in [('session_id', session), ('symbol', symbol), ('source', source)]:
            if value:
                where.append(key + '=?')
                args.append(value)
        query = 'SELECT record_json FROM ' + table
        if where:
            query += ' WHERE ' + ' AND '.join(where)
        query += ' ORDER BY timestamp DESC, rowid DESC LIMIT ?'
        return [json.loads(r[0]) for r in conn.execute(query, (*args, max(1, min(int(limit), 5000))))]

    def trades(self, limit=100, session_id=None):
        with self._db() as conn:
            session = None if session_id == 'all' else session_id or self._state(conn)['session_id']
            return self._records(conn, 'crypto_demo_trades_v2', limit, session)

    def decisions(self, limit=50, symbol=None, source=None):
        with self._db() as conn:
            return self._records(conn, 'crypto_demo_decisions_v2', limit, symbol=symbol, source=source)

    def latest_decision(self):
        return next(iter(self.decisions(1)), None)

    def record_by_id(self, kind, identity):
        table, col = ('crypto_demo_decisions_v2', 'decision_id') if kind == 'decision' else ('crypto_demo_trades_v2', 'trade_id')
        with self._db() as conn:
            row = conn.execute(f'SELECT record_json FROM {table} WHERE {col}=?', (identity,)).fetchone()
            return json.loads(row[0]) if row else None

    def sessions(self):
        with self._db() as conn:
            return [{'sessionId': r['session_id'], 'startedAt': r['started_at'], 'initialBalance': r['initial_balance'],
                     'endedAt': r['ended_at'], 'resetReason': r['reset_reason'], 'realizedPnl': r['realized_pnl'],
                     'endingEquity': r['ending_equity'], 'tradeCount': r['trade_count']}
                    for r in conn.execute('''SELECT s.*, (SELECT COUNT(*) FROM crypto_demo_trades_v2 t
                        WHERE t.session_id=s.session_id) trade_count FROM crypto_demo_sessions s ORDER BY started_at DESC''')]

    def session(self):
        return next(r for r in self.sessions() if r['endedAt'] is None)

    @staticmethod
    def _marked_positions(positions, markets):
        marked = []
        for original in positions:
            p = dict(original)
            market = markets.get(p['symbol'])
            fallback = {'currentPrice': p.get('markPrice', p.get('entryPrice')),
                        'currentPriceTimestamp': p.get('marketPriceTimestamp'), 'fresh': False}
            fresh = price_status(market if isinstance(market, dict) else fallback)
            mark = fresh['currentPrice']
            value = p['amount'] * mark if mark is not None else None
            p.update(fresh, markPrice=mark, marketValue=value, unrealizedPnl=value - p['costBasis'] if value is not None else None)
            marked.append(p)
        return marked

    def _summary(self, conn, markets=None):
        s = self._state(conn)
        positions = self._marked_positions(s['positions'], markets or {})
        known = all(p['marketValue'] is not None for p in positions)
        exposure = sum(p['marketValue'] or 0 for p in positions) if known else None
        equity = s['cash'] + exposure if known else None
        closed = [t for t in self._records(conn, 'crypto_demo_trades_v2', 5000, s['session_id']) if t['side'] == 'SELL']
        count = conn.execute('SELECT COUNT(*) FROM crypto_demo_trades_v2 WHERE session_id=?', (s['session_id'],)).fetchone()[0]
        statuses = [p['marketDataStatus'] for p in positions]
        valuation = 'unavailable' if 'unavailable' in statuses else 'stale' if 'stale' in statuses else 'fresh'
        return {'mode': 'DEMO', 'currency': 'CREDITS', 'portfolioSessionId': s['session_id'],
                'initialBalance': s['initial_balance'], 'currentCash': round(s['cash'], 8),
                'currentEquity': round(equity, 8) if equity is not None else None, 'openPositions': positions,
                'unrealizedPnl': sum(p['unrealizedPnl'] or 0 for p in positions) if known else None,
                'realizedPnl': s['realized_pnl'], 'totalPnl': equity - s['initial_balance'] if known else None,
                'numberOfTrades': count, 'winRate': sum(t['pnl'] > 0 for t in closed) / len(closed) * 100 if closed else 0,
                'currentExposure': exposure, 'currentExposurePct': exposure / equity * 100 if known and equity else 0,
                'maxDrawdown': s['max_drawdown'], 'feeRate': CONFIG.DEMO_FEE_RATE,
                'portfolioValuationTimestamp': utc_now(), 'oldestPriceAgeMs': max((p['marketDataAgeMs'] or 0 for p in positions), default=0) if valuation != 'unavailable' else None,
                'valuationStatus': valuation, 'maxMarketDataAgeMs': CONFIG.MAX_MARKET_DATA_AGE_MS,
                'realMoneyUsed': False, 'realOrderSent': False, 'liveExecutionEnabled': False, 'updatedAt': s['timestamp']}

    def summary(self, price_map=None):
        with self._db() as conn:
            return self._summary(conn, price_map)

    def positions(self, price_map=None):
        return self.summary(price_map)['openPositions']

    def _decision(self, conn, request_id):
        row = conn.execute('SELECT record_json FROM crypto_demo_decisions_v2 WHERE request_id=?', (request_id,)).fetchone()
        return json.loads(row[0]) if row else None

    @staticmethod
    def _put_decision(conn, record):
        conn.execute('''INSERT INTO crypto_demo_decisions_v2 VALUES(?,?,?,?,?,?,?)
            ON CONFLICT(decision_id) DO UPDATE SET record_json=excluded.record_json''',
                     (record['decisionId'], record['clientRequestId'], record['portfolioSessionId'], record['timestamp'],
                      record['symbol'], record['source'], json.dumps(record, allow_nan=False)))

    @staticmethod
    def _new_decision(op, symbol, source):
        did = ('jev_decision_' if source == 'jev' else 'demo_decision_') + uuid4().hex
        return {'id': did, 'decisionId': did, 'clientRequestId': op['request_id'], 'operationId': op['operation_id'],
                'portfolioSessionId': op['session_id'], 'timestamp': utc_now(), 'symbol': symbol,
                'source': source, 'model': None, 'model_used': None, 'action': None, 'decision': None,
                'confidence': None, 'latencyMs': None, 'latency_ms': None, 'valid': False, 'riskResult': 'pending',
                'executed': False, 'trade_executed': False, 'tradeId': None, 'blockedReason': None,
                'inputMarketTimestamp': None, 'marketDataAgeMs': None, 'errorCode': None, 'safeMessage': None}

    def _complete(self, conn, op, data, code=None, status='completed', http=200, events=None):
        if data.get('decision'):
            data.setdefault('decisionId', data['decision']['decisionId'])
        result = envelope({'operationId': op['operation_id'], 'clientRequestId': op['request_id'],
                           'status': status, 'realOrderSent': False, **data}, op['request_id'], code)
        history = events or json.loads(op['events_json'])
        final_state = 'executed' if status == 'completed' else status
        history.append({'state': final_state, 'timestamp': utc_now()})
        conn.execute('''UPDATE crypto_demo_operations SET status=?, state=?, completed_at=?, http_status=?,
            result_json=?, error_code=?, events_json=? WHERE request_id=?''',
                     (status, final_state, utc_now(), http, json.dumps(result, allow_nan=False), code, json.dumps(history), op['request_id']))
        return result, http

    def _expire(self, conn):
        for op in conn.execute("SELECT * FROM crypto_demo_operations WHERE status='pending' AND expires_at<=?", (time.time(),)).fetchall():
            decision = self._decision(conn, op['request_id'])
            if decision:
                decision.update(errorCode='operation_expired', safeMessage=MESSAGES['operation_expired'], riskResult='not_evaluated')
                self._put_decision(conn, decision)
            self._complete(conn, op, {'decision': decision, 'tradeExecuted': False}, 'operation_expired', 'failed', 409)

    def reserve(self, request_id, operation, payload):
        if not isinstance(request_id, str) or not re.fullmatch(r'[A-Za-z0-9_-]{8,128}', request_id):
            return None, (envelope({}, code='invalid_request'), 400)
        try:
            fingerprint = hashlib.sha256(json.dumps(payload, sort_keys=True, allow_nan=False).encode()).hexdigest()
        except (TypeError, ValueError):
            return None, (envelope({}, request_id, 'invalid_request'), 400)
        with self.lifecycle_lock, self._db(True) as conn:
            self._expire(conn)
            old = conn.execute('SELECT * FROM crypto_demo_operations WHERE request_id=?', (request_id,)).fetchone()
            if old:
                if old['operation'] != operation or old['fingerprint'] != fingerprint:
                    return None, (envelope({}, request_id, 'duplicate_request'), 409)
                if old['status'] == 'pending':
                    return None, (envelope({'operationId': old['operation_id'], 'status': 'pending'}, request_id, 'operation_in_progress'), 409)
                LOG.info('[crypto] duplicate request reused requestId=%s', request_id)
                return None, (json.loads(old['result_json']), old['http_status'])
            now = utc_now()
            s = self._state(conn)
            op = {'request_id': request_id, 'operation_id': 'crypto_op_' + uuid4().hex,
                  'operation': operation, 'fingerprint': fingerprint, 'session_id': s['session_id'],
                  'status': 'pending', 'state': 'requested', 'created_at': now, 'completed_at': None,
                  'expires_at': time.time() + CONFIG.OPERATION_LEASE_SECONDS, 'http_status': None,
                  'result_json': None, 'error_code': None, 'events_json': json.dumps([{'state': 'requested', 'timestamp': now}])}
            conn.execute('INSERT INTO crypto_demo_operations VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)', tuple(op.values()))
            if operation == 'decision':
                self._put_decision(conn, self._new_decision(op, payload.get('symbol'), 'jev'))
            pending = conn.execute("SELECT operation FROM crypto_demo_operations WHERE status='pending' AND request_id!=?", (request_id,)).fetchall()
            code = 'reset_not_allowed' if operation == 'reset' and (pending or self.loop_running()) else 'portfolio_locked' if any(r[0] == 'reset' for r in pending) else None
            if code:
                d = self._decision(conn, request_id)
                if d:
                    d.update(errorCode=code, riskResult=code, blockedReason=code, safeMessage=MESSAGES[code])
                    self._put_decision(conn, d)
                return None, self._complete(conn, op, {'decision': d}, code, 'rejected', 409)
            return dict(op), None

    def operation(self, request_id):
        with self._db(True) as conn:
            self._expire(conn)
            row = conn.execute('SELECT * FROM crypto_demo_operations WHERE request_id=?', (request_id,)).fetchone()
            if not row:
                return None
            result = json.loads(row['result_json']) if row['result_json'] else None
            return {'clientRequestId': row['request_id'], 'operationId': row['operation_id'], 'operation': row['operation'],
                    'portfolioSessionId': row['session_id'], 'status': row['status'], 'state': row['state'],
                    'createdAt': row['created_at'], 'completedAt': row['completed_at'], 'httpStatus': row['http_status'],
                    'tradeId': (result or {}).get('tradeId'), 'decisionId': (result or {}).get('decisionId'),
                    'events': json.loads(row['events_json']), 'result': result}

    def has_pending_reset(self):
        with self._db(True) as conn:
            self._expire(conn)
            return bool(conn.execute("SELECT 1 FROM crypto_demo_operations WHERE status='pending' AND operation='reset'").fetchone())

    def execute(self, request_id, operation, payload, prepare=lambda: {}):
        op, reused = self.reserve(request_id, operation, payload)
        if reused:
            return reused
        try:
            prepared = prepare()
        except Exception:
            prepared = {'errorCode': 'jev_unavailable' if operation == 'decision' else 'market_unavailable'}
        return self.finish(op, payload, prepared)

    def finish(self, reserved, payload, prepared):
        try:
            with self._db(True) as conn:
                self._expire(conn)
                op = conn.execute('SELECT * FROM crypto_demo_operations WHERE request_id=?', (reserved['request_id'],)).fetchone()
                fingerprint = hashlib.sha256(json.dumps(payload, sort_keys=True, allow_nan=False).encode()).hexdigest()
                if op['fingerprint'] != fingerprint:
                    return envelope({}, reserved['request_id'], 'duplicate_request'), 409
                if op['status'] != 'pending':
                    return json.loads(op['result_json']), op['http_status']
                return self._apply(conn, op, payload, prepared)
        except Exception:
            # Ledger writes rolled back; persist a safe terminal failure separately.
            with self._db(True) as conn:
                op = conn.execute('SELECT * FROM crypto_demo_operations WHERE request_id=?', (reserved['request_id'],)).fetchone()
                if op['status'] != 'pending':
                    return json.loads(op['result_json']), op['http_status']
                d = self._decision(conn, op['request_id'])
                if d:
                    self._decision_fields(d, prepared)
                    d.update(errorCode='trade_execution_failed', safeMessage=MESSAGES['trade_execution_failed'], riskResult='failed')
                    self._put_decision(conn, d)
                return self._complete(conn, op, {'decision': d, 'tradeExecuted': False}, 'trade_execution_failed', 'failed', 500)

    @staticmethod
    def _decision_fields(decision, prepared):
        from jev_adapter import JevDecisionAdapter
        result = prepared.get('jev') or {}
        valid = JevDecisionAdapter.validate_output(result)
        accepted = result.get('ok') is True and result.get('valid') is True and valid.get('valid') is True
        freshness = price_status(prepared.get('market'))
        model = result.get('model')
        model = model if isinstance(model, str) and re.fullmatch(r'[A-Za-z0-9_.:/-]{1,120}', model) else None
        decision.update(model=model, model_used=model, latencyMs=number(result.get('latencyMs')),
                        latency_ms=number(result.get('latencyMs')), inputMarketTimestamp=freshness['marketPriceTimestamp'],
                        marketDataAgeMs=freshness['marketDataAgeMs'], valid=accepted,
                        action=valid.get('action') if accepted else None, decision=valid.get('action') if accepted else None,
                        confidence=valid.get('confidence') if accepted else None)
        context = prepared.get('context') or {}
        decision['inputSummary'] = {k: context.get(k) for k in ('symbol', 'price', 'change24h', 'volume24h', 'spread', 'trendShort', 'trendMedium', 'volatility', 'position', 'cash', 'equity', 'riskAllowed', 'allowedActions')}
        return accepted

    def _apply(self, conn, op, payload, prepared):
        state = self._state(conn)
        symbol = payload.get('symbol')
        source = 'jev' if op['operation'] == 'decision' else 'manual'
        action = op['operation'].upper()
        decision = self._decision(conn, op['request_id'])
        market = prepared.get('market') or {}
        freshness = price_status(market)
        markets = {**prepared.get('markets', {}), symbol: market}
        events = json.loads(op['events_json'])
        try:
            if prepared.get('errorCode'):
                raise Rejected(prepared['errorCode'])
            if op['session_id'] != state['session_id']:
                raise Rejected('portfolio_locked')
            if not CONFIG.CRYPTO_DEMO_TRADING_ENABLED or CONFIG.live_trading_active or CONFIG.BINANCE_TRADING_ENABLED or CONFIG.CRYPTO_LIVE_TRADING_ENABLED or CONFIG.ENABLE_LIVE_TRADING:
                raise Rejected('risk_rejected', 'live_trading_locked')
            if op['operation'] == 'reset':
                if payload.get('confirmation') != 'RESET_DEMO_ACCOUNT' or self.loop_running():
                    raise Rejected('reset_not_allowed')
                if conn.execute("SELECT 1 FROM crypto_demo_operations WHERE status='pending' AND request_id!=?", (op['request_id'],)).fetchone():
                    raise Rejected('reset_not_allowed')
                previous = self._summary(conn, markets)
                now, new_id = utc_now(), 'demo_session_' + uuid4().hex
                conn.execute('UPDATE crypto_demo_sessions SET ended_at=?, reset_reason=?, ending_equity=? WHERE session_id=?',
                             (now, 'user_confirmed_reset', previous['currentEquity'] if previous['valuationStatus'] == 'fresh' else None, state['session_id']))
                conn.execute('INSERT INTO crypto_demo_sessions VALUES(?,?,?,?,?,?,?,?,?,?,?)',
                             (new_id, now, DEMO_INITIAL_BALANCE, None, None, DEMO_INITIAL_BALANCE, '[]', 0, 0, now, None))
                events.extend({'state': s, 'timestamp': utc_now()} for s in ['validated', 'risk_approved'])
                return self._complete(conn, op, {'reset': True, 'portfolioSessionId': new_id, 'previousSessionId': state['session_id'], 'portfolio': self._summary(conn)}, events=events)
            if symbol not in {s.replace('/', '') for s in CONFIG.WATCHLIST}:
                raise Rejected('invalid_request')
            if source == 'jev':
                result = prepared.get('jev') or {}
                if not self._decision_fields(decision, prepared):
                    code = result.get('errorCode')
                    raise Rejected(code if code in ('jev_timeout', 'invalid_decision_output') else 'jev_unavailable' if not result.get('ok') else 'invalid_decision_output')
                action = decision['action']
            if action not in ('BUY', 'SELL', 'HOLD'):
                raise Rejected('invalid_request')
            events.append({'state': 'validated', 'timestamp': utc_now()})
            if action != 'HOLD':
                if market.get('symbol') != symbol:
                    raise Rejected('market_unavailable')
                if freshness['marketDataStatus'] != 'fresh':
                    raise Rejected('stale_market_data' if freshness['marketDataStatus'] == 'stale' else 'market_unavailable')
                if action == 'BUY' and prepared.get('assetMode') != 'DEMO_TRADE_ALLOWED':
                    raise Rejected('risk_rejected', 'asset_mode_blocked')
                trade = self._trade(conn, op, state, symbol, action, source, decision, payload, markets, freshness)
            else:
                trade = None
                if decision is None:
                    decision = self._new_decision(op, symbol, 'manual')
                    decision.update(action='HOLD', decision='HOLD', valid=True)
            events.append({'state': 'risk_approved', 'timestamp': utc_now()})
        except Rejected as exc:
            code = exc.code if exc.code in MESSAGES else 'risk_rejected'
            if decision:
                decision.update(riskResult=code, risk_status='VETOED', blockedReason=exc.reason,
                                errorCode=code, safeMessage=MESSAGES[code], inputMarketTimestamp=freshness['marketPriceTimestamp'], marketDataAgeMs=freshness['marketDataAgeMs'])
                self._put_decision(conn, decision)
            veto = bool(decision and decision['valid'])
            failed = code in ('jev_unavailable', 'jev_timeout', 'market_unavailable')
            data = {'symbol': symbol, 'decision': decision, 'decisionId': decision['decisionId'] if decision else None,
                    'tradeId': None, 'tradeExecuted': False, 'execution': {'executed': False, 'blocked': True, 'reason': exc.reason}, 'portfolio': self._summary(conn, markets)}
            return self._complete(conn, op, data, None if veto else code, 'failed' if failed else 'rejected',
                                  200 if veto else 503 if failed else 502 if code == 'invalid_decision_output' else 409, events)
        if decision:
            decision.update(riskResult='approved', risk_status='APPROVED', executed=bool(trade), trade_executed=bool(trade), tradeId=trade['tradeId'] if trade else None)
            self._put_decision(conn, decision)
        data = {'symbol': symbol, 'action': action, 'tradeId': trade['tradeId'] if trade else None,
                'decisionId': decision['decisionId'] if decision else None, 'decision': decision,
                'tradeExecuted': bool(trade), 'execution': {'executed': bool(trade), 'blocked': False, 'reason': None, 'tradeId': trade['tradeId'] if trade else None},
                'fee': trade['fee'] if trade else 0, 'pnl': trade['pnl'] if trade else 0, 'portfolio': self._summary(conn, markets)}
        LOG.info('[crypto] demo %s completed operationId=%s', action, op['operation_id'])
        return self._complete(conn, op, data, events=events)

    def _trade(self, conn, op, state, symbol, action, source, decision, payload, markets, freshness):
        positions = state['positions']
        index = next((i for i, p in enumerate(positions) if p['symbol'] == symbol), None)
        price = freshness['currentPrice']
        fee_rate = number(CONFIG.DEMO_FEE_RATE)
        if fee_rate is None or not 0 <= fee_rate < 1:
            raise Rejected('risk_rejected', 'invalid_fee_config')
        if action == 'BUY':
            summary = self._summary(conn, markets)
            if positions and summary['valuationStatus'] != 'fresh':
                raise Rejected('stale_market_data')
            equity = summary['currentEquity']
            limits = [number(CONFIG.DEMO_MAX_POSITION_PCT), number(CONFIG.DEMO_MAX_EXPOSURE_PCT), number(CONFIG.DEMO_DEFAULT_JEV_POSITION_PCT)]
            if any(value is None or not 0 < value <= 1 for value in limits):
                raise Rejected('risk_rejected', 'invalid_risk_config')
            quote = number(payload.get('quoteAmount')) if source == 'manual' else equity * CONFIG.DEMO_DEFAULT_JEV_POSITION_PCT
            if quote is None or quote <= 0:
                raise Rejected('invalid_request')
            fee = quote * fee_rate
            if quote + fee > state['cash']:
                raise Rejected('insufficient_balance')
            if quote > (equity - fee) * min(CONFIG.DEMO_MAX_POSITION_PCT, 0.20):
                raise Rejected('risk_rejected', 'max_position_size_exceeded')
            if summary['currentExposure'] + quote > (equity - fee) * min(CONFIG.DEMO_MAX_EXPOSURE_PCT, 0.60):
                raise Rejected('risk_rejected', 'max_exposure_exceeded')
            if index is not None:
                raise Rejected('risk_rejected', 'duplicate_symbol_position')
            if len(positions) >= min(CONFIG.MAX_OPEN_POSITIONS, 3):
                raise Rejected('risk_rejected', 'max_open_positions_reached')
            last = conn.execute('SELECT timestamp FROM crypto_demo_trades_v2 WHERE session_id=? AND symbol=? ORDER BY timestamp DESC LIMIT 1', (state['session_id'], symbol)).fetchone()
            if last:
                try:
                    stamp = datetime.fromisoformat(last[0].replace('Z', '+00:00'))
                    if (datetime.now(timezone.utc) - stamp).total_seconds() < CONFIG.DEMO_COOLDOWN_MINUTES * 60:
                        raise Rejected('risk_rejected', 'symbol_cooldown_active')
                except (ValueError, TypeError):
                    raise Rejected('risk_rejected', 'invalid_legacy_timestamp')
            quantity, pnl = quote / price, 0
            positions.append({'symbol': symbol, 'side': 'LONG', 'amount': quantity, 'entryPrice': price,
                              'markPrice': price, 'marketPriceTimestamp': freshness['marketPriceTimestamp'],
                              'costBasis': quote + fee, 'marketValue': quote, 'openedAt': utc_now(), 'source': source})
            cash, realized = state['cash'] - quote - fee, state['realized_pnl']
        else:
            percent = number(payload.get('positionPercent')) if source == 'manual' else 100
            if percent not in (25, 50, 75, 100):
                raise Rejected('invalid_request')
            if index is None:
                raise Rejected('position_not_found')
            p = positions[index]
            fraction = percent / 100
            quantity, basis = p['amount'] * fraction, p['costBasis'] * fraction
            quote = quantity * price
            fee = quote * fee_rate
            pnl = quote - fee - basis
            if percent == 100:
                positions.pop(index)
            else:
                p.update(amount=p['amount'] - quantity, costBasis=p['costBasis'] - basis, markPrice=price, marketPriceTimestamp=freshness['marketPriceTimestamp'])
            cash, realized = state['cash'] + quote - fee, state['realized_pnl'] + pnl
        if number(cash) is None or cash < 0 or number(quantity) is None or quantity <= 0:
            raise Rejected('risk_rejected')
        now, tid = utc_now(), 'demo_trade_' + uuid4().hex
        did = decision['decisionId'] if decision else None
        trade = {'id': tid, 'tradeId': tid, 'clientRequestId': op['request_id'], 'operationId': op['operation_id'],
                 'portfolioSessionId': state['session_id'], 'source': source, 'decisionId': did, 'decision_id': did,
                 'symbol': symbol, 'side': action, 'requestedCredits': quote, 'executedQuantity': quantity,
                 'executionPrice': price, 'fee': fee, 'realizedPnl': pnl, 'status': 'executed',
                 'createdAt': op['created_at'], 'executedAt': now, 'timestamp': now,
                 'marketPriceTimestamp': freshness['marketPriceTimestamp'], 'marketDataAgeMs': freshness['marketDataAgeMs'],
                 'riskResult': 'approved', 'price': price, 'amount': quantity, 'cost': quote, 'pnl': pnl, 'mode': 'DEMO'}
        conn.execute('UPDATE crypto_demo_sessions SET cash=?, positions_json=?, realized_pnl=?, updated_at=? WHERE session_id=?',
                     (cash, json.dumps(positions, allow_nan=False), realized, now, state['session_id']))
        self._record_trade(conn, trade)
        valuation = self._summary(conn, markets)
        if valuation['valuationStatus'] == 'fresh':
            drawdown = max(state['max_drawdown'], max(0, (state['initial_balance'] - valuation['currentEquity']) / state['initial_balance'] * 100))
            conn.execute('UPDATE crypto_demo_sessions SET max_drawdown=? WHERE session_id=?', (drawdown, state['session_id']))
        return trade

    @staticmethod
    def _record_trade(conn, trade):
        conn.execute('INSERT INTO crypto_demo_trades_v2 VALUES(?,?,?,?,?,?,?,?,?)',
                     (trade['tradeId'], trade['clientRequestId'], trade['operationId'], trade['decisionId'], trade['portfolioSessionId'],
                      trade['timestamp'], trade['symbol'], trade['source'], json.dumps(trade, allow_nan=False)))

    # Direct Python callers receive internal IDs; HTTP callers must supply their own.
    def buy(self, symbol, quote_amount, market, client_request_id=None):
        return self.execute(client_request_id or uuid4().hex, 'buy', {'symbol': symbol, 'quoteAmount': quote_amount}, lambda: {'market': market, 'assetMode': 'DEMO_TRADE_ALLOWED'})[0]

    def sell(self, symbol, position_percent, market, client_request_id=None):
        return self.execute(client_request_id or uuid4().hex, 'sell', {'symbol': symbol, 'positionPercent': position_percent}, lambda: {'market': market})[0]

    def hold(self, symbol, client_request_id=None):
        return self.execute(client_request_id or uuid4().hex, 'hold', {'symbol': symbol})[0]

    def reset(self, confirmation, client_request_id=None):
        return self.execute(client_request_id or uuid4().hex, 'reset', {'confirmation': confirmation})[0]

    def loop_settings(self):
        return {'intervalMinutes': None, 'continuous': False, 'autoExecuteDemoTrades': False, 'status': 'disabled'}

    def update_loop_settings(self, *args, **kwargs):
        return {'ok': False, 'error': 'FEATURE_DISABLED', 'feature': 'legacy_demo_loop'}

    def lessons(self, limit=50):
        return []

    def save_decision(self, *args, **kwargs):
        return None

    def execute_decision(self, *args, **kwargs):
        return {'ok': False, 'error': 'LEGACY_DECISION_EXECUTION_DISABLED'}
