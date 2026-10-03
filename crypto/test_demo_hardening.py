"""Isolated reliability tests: no network, real funds, or user's demo DB."""
import json
import os
import sqlite3
import sys
import tempfile
import threading
import time
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).parent / 'src'))
os.environ.update(CRYPTO_LIVE_TRADING_ENABLED='false', ENABLE_LIVE_TRADING='false', BINANCE_TRADING_ENABLED='false',
                  CRYPTO_DEMO_TRADING_ENABLED='true', CRYPTO_STARTING_BALANCE='10000',
                  CRYPTO_OBSIDIAN_ENABLED='false', CRYPTO_LEARNING_ENABLED='false', CRYPTO_NEWS_ENABLED='false', CRYPTO_OLLAMA_ENABLED='false')
from config import CONFIG
from demo_portfolio import DemoPortfolioEngine
from price_freshness import utc_now


def market(price=50000, age=0, symbol='BTCUSDT'):
    return {'symbol': symbol, 'ticker': {'last': price}, 'fresh': True, 'status': 'online',
            'marketPriceTimestamp': (datetime.now(timezone.utc) - timedelta(seconds=age)).isoformat()}


class ReliabilityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = str(Path(self.temp.name) / 'ledger.db')
        self.engine = DemoPortfolioEngine(self.path)

    def tearDown(self):
        self.temp.cleanup()

    def jev(self, action, key=None, **kwargs):
        data = {'market': market(), 'assetMode': 'DEMO_TRADE_ALLOWED',
                'jev': {'ok': True, 'valid': True, 'action': action, 'model': 'jev-test', 'confidence': None, 'latencyMs': 7}, **kwargs}
        return self.engine.execute(key or uuid4().hex, 'decision', {'symbol': 'BTCUSDT'}, lambda: data)[0]

    def test_initial_balance_fee_ids_and_recovery_after_restart(self):
        self.assertEqual(self.engine.summary()['currentCash'], 10000)
        key = uuid4().hex
        result = self.engine.buy('BTCUSDT', 100, market(), key)
        self.assertTrue(result['ok'], result)
        self.assertEqual(result['fee'], .1)
        self.assertEqual(result['portfolio']['currentCash'], 9899.9)
        self.assertTrue(result['tradeId'].startswith('demo_trade_'))
        self.assertTrue(result['operationId'].startswith('crypto_op_'))
        self.assertIsNone(result['decisionId'])
        restarted = DemoPortfolioEngine(self.path)
        self.assertEqual(restarted.buy('BTCUSDT', 100, market(90000), key), result)
        self.assertEqual(len(restarted.trades()), 1)
        self.assertEqual(restarted.operation(key)['result'], result)
        self.assertEqual([e['state'] for e in restarted.operation(key)['events']], ['requested', 'validated', 'risk_approved', 'executed'])
        changed = restarted.buy('BTCUSDT', 101, market(), key)
        self.assertEqual(changed['errorCode'], 'duplicate_request')

    def test_concurrent_same_buy_and_sell_execute_once(self):
        key = uuid4().hex
        gate = threading.Barrier(3)
        results = []
        def buy():
            other = DemoPortfolioEngine(self.path)
            gate.wait()
            results.append(other.buy('BTCUSDT', 100, market(), key))
        threads = [threading.Thread(target=buy) for _ in range(2)]
        for t in threads: t.start()
        gate.wait()
        for t in threads: t.join(5)
        self.assertEqual(len(results), 2)
        self.assertEqual(len(self.engine.trades()), 1)
        self.assertTrue(any(r['ok'] for r in results))
        key = uuid4().hex
        one = self.engine.sell('BTCUSDT', 50, market(51000), key)
        self.assertEqual(self.engine.sell('BTCUSDT', 50, market(), key), one)
        self.assertEqual(self.engine.positions()[0]['amount'], .001)
        self.assertEqual(len(self.engine.trades()), 2)

    def test_pending_duplicate_decision_calls_provider_once_reset_blocked(self):
        key, entered, release = uuid4().hex, threading.Event(), threading.Event()
        calls, results = [], []
        def prepare():
            calls.append(1)
            entered.set()
            release.wait(3)
            return {'market': market(), 'assetMode': 'DEMO_TRADE_ALLOWED', 'jev': {'ok': True, 'valid': True, 'action': 'BUY'}}
        def execute():
            results.append(self.engine.execute(key, 'decision', {'symbol': 'BTCUSDT'}, prepare)[0])
        thread = threading.Thread(target=execute)
        thread.start()
        self.assertTrue(entered.wait(2))
        self.assertEqual(self.engine.execute(key, 'decision', {'symbol': 'BTCUSDT'}, prepare)[0]['errorCode'], 'operation_in_progress')
        self.assertEqual(self.engine.operation(key)['status'], 'pending')
        self.assertEqual(self.engine.reset('RESET_DEMO_ACCOUNT')['errorCode'], 'reset_not_allowed')
        release.set()
        thread.join(5)
        self.assertEqual(len(calls), 1)
        self.assertTrue(results[0]['tradeExecuted'], results)
        self.assertEqual(len(self.engine.decisions()), 1)
        self.assertEqual(self.engine.execute(key, 'decision', {'symbol': 'BTCUSDT'}, prepare)[0], results[0])
        self.assertEqual(len(calls), 1)

    def test_jev_buy_sell_hold_links_and_manual_separation(self):
        bought = self.jev('BUY')
        self.assertTrue(bought['tradeExecuted'], bought)
        self.assertTrue(bought['decisionId'].startswith('jev_decision_'))
        trade = self.engine.trades()[0]
        self.assertEqual(trade['decisionId'], bought['decisionId'])
        self.assertEqual(trade['source'], 'jev')
        held = self.jev('HOLD')
        self.assertFalse(held['tradeExecuted'])
        self.assertIsNone(held['tradeId'])
        sold = self.jev('SELL')
        self.assertTrue(sold['tradeExecuted'], sold)
        self.assertEqual(self.engine.positions(), [])
        self.assertEqual(self.engine.latest_decision()['tradeId'], sold['tradeId'])
        self.assertEqual(len(self.engine.decisions()), 3)

    def test_invalid_unavailable_timeout_attempts_persist(self):
        for code in ['invalid_decision_output', 'jev_unavailable', 'jev_timeout']:
            r = self.jev(None, jev={'ok': False, 'valid': False, 'action': None, 'errorCode': code})
            self.assertEqual(r['errorCode'], code)
            self.assertEqual(r['decision']['errorCode'], code)
            self.assertFalse(r['decision']['valid'])
        r = self.jev('WAIT')
        self.assertEqual(r['errorCode'], 'invalid_decision_output')
        self.assertEqual(len(DemoPortfolioEngine(self.path).decisions()), 4)
        self.assertEqual(self.engine.trades(), [])

    def test_stale_post_inference_veto_and_portfolio_freshness(self):
        result = self.jev('BUY', market=market(age=20))
        self.assertFalse(result['tradeExecuted'])
        self.assertEqual(result['decision']['riskResult'], 'stale_market_data')
        self.assertTrue(self.engine.buy('BTCUSDT', 100, market())['ok'])
        summary = self.engine.summary({'BTCUSDT': market(51000)})
        p = summary['openPositions'][0]
        self.assertEqual(p['marketDataStatus'], 'fresh')
        self.assertIsNotNone(p['currentPriceTimestamp'])
        self.assertLess(p['marketDataAgeMs'], 15000)
        self.assertEqual(summary['valuationStatus'], 'fresh')
        self.assertEqual(self.engine.summary({'BTCUSDT': market(age=20)})['valuationStatus'], 'stale')
        self.assertNotEqual(self.engine.summary()['valuationStatus'], 'fresh')
        self.assertEqual(self.engine.sell('BTCUSDT', 100, market(age=20))['errorCode'], 'stale_market_data')

    def test_atomic_rollback_trade_insert_failure(self):
        initial = self.engine.latest_state()
        with patch.object(self.engine, '_record_trade', side_effect=sqlite3.OperationalError('test only')):
            result = self.jev('BUY')
        self.assertEqual(result['errorCode'], 'trade_execution_failed')
        self.assertEqual(self.engine.latest_state(), initial)
        self.assertEqual(self.engine.trades(), [])
        self.assertFalse(self.engine.latest_decision()['executed'])
        self.assertTrue(self.engine.latest_decision()['valid'])
        self.assertEqual(self.engine.latest_decision()['action'], 'BUY')
        self.assertEqual(self.engine.latest_decision()['model'], 'jev-test')
        self.assertEqual(self.engine.latest_decision()['latencyMs'], 7)
        self.assertEqual(self.engine.operation(result['clientRequestId'])['status'], 'failed')

    def test_reset_archives_session_is_idempotent_and_requires_stopped_loop(self):
        bought = self.jev('BUY')
        old_session = self.engine.session()['sessionId']
        self.engine.loop_running = lambda: True
        self.assertEqual(self.engine.reset('RESET_DEMO_ACCOUNT')['errorCode'], 'reset_not_allowed')
        self.engine.loop_running = lambda: False
        key = uuid4().hex
        reset = self.engine.reset('RESET_DEMO_ACCOUNT', key)
        self.assertTrue(reset['ok'], reset)
        self.assertEqual(reset, self.engine.reset('RESET_DEMO_ACCOUNT', key))
        self.assertNotEqual(self.engine.session()['sessionId'], old_session)
        self.assertEqual(self.engine.summary()['currentCash'], 10000)
        self.assertEqual(self.engine.trades(), [])
        self.assertEqual(len(self.engine.trades(session_id='all')), 1)
        self.assertIsNotNone(self.engine.record_by_id('trade', bought['tradeId']))
        self.assertEqual(len(self.engine.decisions()), 1)
        self.assertEqual(len(self.engine.sessions()), 2)

    def test_expired_operation_cannot_commit_late_response(self):
        key = uuid4().hex
        op, _ = self.engine.reserve(key, 'buy', {'symbol': 'BTCUSDT', 'quoteAmount': 100})
        with self.engine._db(True) as conn:
            conn.execute('UPDATE crypto_demo_operations SET expires_at=? WHERE request_id=?', (time.time() - 1, key))
        self.assertEqual(self.engine.operation(key)['status'], 'failed')
        result, _ = self.engine.finish(op, {'symbol': 'BTCUSDT', 'quoteAmount': 100}, {'market': market(), 'assetMode': 'DEMO_TRADE_ALLOWED'})
        self.assertEqual(result['errorCode'], 'operation_expired')
        self.assertEqual(self.engine.summary()['currentCash'], 10000)

    def test_risk_limits_numeric_validation_and_live_lock(self):
        for value in [-1, 0, True, float('nan'), float('inf'), 2001, 10000]:
            self.assertFalse(self.engine.buy('BTCUSDT', value, market())['ok'])
        self.assertFalse(self.engine.sell('BTCUSDT', 100, market())['ok'])
        with patch.object(CONFIG, 'CRYPTO_LIVE_TRADING_ENABLED', True):
            self.assertFalse(self.engine.buy('BTCUSDT', 100, market())['ok'])
        self.assertEqual(self.engine.summary()['currentCash'], 10000)
        a, b = self.engine.hold('BTCUSDT'), self.engine.hold('BTCUSDT')
        self.assertNotEqual(a['operationId'], b['operationId'])
        self.assertEqual(self.engine.trades(), [])

    def test_no_real_order_or_disabled_features_in_ledger(self):
        text = Path(__file__).parent.joinpath('src/demo_portfolio.py').read_text()
        for forbidden in ['.create_order(', '.withdraw(', 'requests.post(', 'ollama', 'obsidian']:
            self.assertNotIn(forbidden, text)

    def test_exposure_position_limits_cooldown_and_independent_requests(self):
        markets = {s: market(symbol=s) for s in ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT']}
        def buy(symbol):
            return self.engine.execute(uuid4().hex, 'buy', {'symbol': symbol, 'quoteAmount': 1900},
                                       lambda: {'market': markets[symbol], 'markets': markets, 'assetMode': 'DEMO_TRADE_ALLOWED'})[0]
        self.assertTrue(buy('BTCUSDT')['ok'])
        self.assertTrue(buy('ETHUSDT')['ok'])
        with patch.object(CONFIG, 'DEMO_MAX_EXPOSURE_PCT', .4):
            result = buy('SOLUSDT')
            self.assertEqual(result['execution']['reason'], 'max_exposure_exceeded')
        self.assertTrue(buy('SOLUSDT')['ok'])
        # A tiny fourth position would fit exposure, but the position-count guard rejects it.
        result, _ = self.engine.execute(uuid4().hex, 'buy', {'symbol': 'BNBUSDT', 'quoteAmount': 1},
                                       lambda: {'market': markets['BNBUSDT'], 'markets': markets, 'assetMode': 'DEMO_TRADE_ALLOWED'})
        self.assertEqual(result['execution']['reason'], 'max_open_positions_reached')
        self.assertTrue(self.engine.sell('BTCUSDT', 100, markets['BTCUSDT'])['ok'])
        self.assertEqual(buy('BTCUSDT')['execution']['reason'], 'symbol_cooldown_active')
        self.assertGreaterEqual(self.engine.summary()['currentCash'], 0)

    def test_additive_migration_preserves_legacy_cash_trades_and_manual_links(self):
        path = str(Path(self.temp.name) / 'legacy.db')
        with sqlite3.connect(path) as c:
            c.execute('CREATE TABLE demo_portfolio_state(id INTEGER PRIMARY KEY, timestamp TEXT, initial_balance REAL, cash REAL, equity REAL, positions_json TEXT, realized_pnl REAL, max_drawdown REAL)')
            c.execute('INSERT INTO demo_portfolio_state VALUES(1,?,10000,9996.2777,9996.2777,?, -3.7223, .04)', (utc_now(), '[]'))
            c.execute('CREATE TABLE demo_decisions(id INTEGER PRIMARY KEY, timestamp TEXT, source TEXT, symbol TEXT, decision TEXT)')
            c.execute('INSERT INTO demo_decisions VALUES(1,?,?,?,?)', (utc_now(), 'manual', 'BTCUSDT', 'BUY'))
            c.execute('CREATE TABLE demo_trades(id INTEGER PRIMARY KEY, timestamp TEXT, source TEXT, symbol TEXT, side TEXT, decision_id INTEGER, pnl REAL)')
            c.execute('INSERT INTO demo_trades VALUES(1,?,?,?,?,1,0)', (utc_now(), 'manual', 'BTCUSDT', 'BUY'))
        c.close()
        engine = DemoPortfolioEngine(path, test_only_import_legacy_fixture=True)
        self.assertEqual(engine.summary()['currentCash'], 9996.2777)
        self.assertIsNone(engine.trades()[0]['decisionId'])
        self.assertTrue(Path(path + '.pre-reliability-v2.bak').exists())
        self.assertEqual(len(DemoPortfolioEngine(path, test_only_import_legacy_fixture=True).trades()), 1)
        with sqlite3.connect(path) as c:
            self.assertEqual(c.execute('SELECT COUNT(*) FROM demo_trades').fetchone()[0], 1)
        c.close()
        self.assertEqual(len(engine.sessions()), 1)

    def test_old_balance_and_cost_position_are_archived_outside_production_ledger(self):
        path = str(Path(self.temp.name) / 'legacy-position.db')
        c = sqlite3.connect(path)
        c.execute('CREATE TABLE demo_portfolio_state(id INTEGER PRIMARY KEY, timestamp TEXT, initial_balance REAL, cash REAL, equity REAL, positions_json TEXT, realized_pnl REAL, max_drawdown REAL)')
        position = {'symbol': 'BTC/USDT', 'amount': .002, 'entryPrice': 50000, 'cost': 100, 'side': 'LONG'}
        c.execute('INSERT INTO demo_portfolio_state VALUES(1,?,5000,4900,5000,?,0,0)', (utc_now(), json.dumps([position])))
        c.commit()
        c.close()
        engine = DemoPortfolioEngine(path)
        self.assertEqual(engine.summary()['initialBalance'], 10000)
        self.assertEqual(engine.summary()['currentCash'], 10000)
        self.assertEqual(engine.positions(), [])
        self.assertTrue(Path(path + '.pre-reliability-v2.bak').exists())
        with sqlite3.connect(path) as c:
            legacy = c.execute('SELECT initial_balance, cash, positions_json FROM demo_portfolio_state').fetchone()
            self.assertEqual(legacy[0], 5000)
            self.assertEqual(legacy[1], 4900)
            self.assertEqual(json.loads(legacy[2])[0]['cost'], 100)
        c.close()

    def test_finish_cannot_change_reserved_payload(self):
        key = uuid4().hex
        payload = {'symbol': 'BTCUSDT', 'quoteAmount': 100}
        op, _ = self.engine.reserve(key, 'buy', payload)
        prepared = {'market': market(), 'assetMode': 'DEMO_TRADE_ALLOWED'}
        wrong, code = self.engine.finish(op, {**payload, 'quoteAmount': 1000}, prepared)
        self.assertEqual(code, 409)
        self.assertEqual(wrong['errorCode'], 'duplicate_request')
        self.assertEqual(self.engine.operation(key)['status'], 'pending')
        correct, _ = self.engine.finish(op, payload, prepared)
        self.assertEqual(correct['portfolio']['currentCash'], 9899.9)

    def test_summary_uses_one_consistent_read_snapshot(self):
        conn = sqlite3.connect(self.path)
        conn.execute('PRAGMA journal_mode=WAL')
        conn.close()
        other = DemoPortfolioEngine(self.path)
        original = self.engine._state
        results = []
        def state_then_commit(conn):
            snapshot = original(conn)
            worker = threading.Thread(target=lambda: results.append(other.buy('BTCUSDT', 100, market())))
            worker.start()
            worker.join(3)
            self.assertFalse(worker.is_alive())
            return snapshot
        with patch.object(self.engine, '_state', side_effect=state_then_commit):
            snapshot = self.engine.summary()
        self.assertTrue(results[0]['ok'])
        self.assertEqual(snapshot['currentCash'], 10000)
        self.assertEqual(snapshot['numberOfTrades'], 0)
        self.assertEqual(self.engine.summary()['currentCash'], 9899.9)


if __name__ == '__main__':
    unittest.main(verbosity=2)
