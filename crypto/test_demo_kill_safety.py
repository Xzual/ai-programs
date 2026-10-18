"""Isolated demo commit safety: real execution is never part of these fixtures."""
import os
import sys
import tempfile
import threading
import json
import unittest
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

TEMP = tempfile.TemporaryDirectory(prefix='edith-demo-kill-')
ROOT = Path(TEMP.name)
os.environ.update(EDITH_CRYPTO_RUNTIME_DATA_DIR=str(ROOT), CRYPTO_DATA_DIR=str(ROOT),
                  CRYPTO_LOG_DIR=str(ROOT), CRYPTO_DB_PATH=str(ROOT / 'bootstrap.db'),
                  EDITH_CRYPTO_GLOBAL_KILL_SWITCH_PATH=str(ROOT / 'global-kill.json'),
                  EDITH_CRYPTO_LOCAL_KILL_SWITCH_PATH=str(ROOT / 'kill-switch.json'),
                  CRYPTO_STARTING_BALANCE='10000', CRYPTO_DEMO_TRADING_ENABLED='true',
                  CRYPTO_LIVE_TRADING_ENABLED='false', ENABLE_LIVE_TRADING='false', BINANCE_TRADING_ENABLED='false',
                  CRYPTO_OBSIDIAN_ENABLED='false', CRYPTO_LEARNING_ENABLED='false', CRYPTO_NEWS_ENABLED='false', CRYPTO_OLLAMA_ENABLED='false')
sys.path.insert(0, str(Path(__file__).parent / 'src'))
from demo_portfolio import DemoPortfolioEngine
from price_freshness import utc_now
from demo_safety import kill_reason


def market():
    return {'symbol': 'BTCUSDT', 'ticker': {'last': 50000}, 'status': 'online', 'fresh': True, 'marketPriceTimestamp': utc_now()}


class KillSafetyTests(unittest.TestCase):
    def setUp(self):
        self.global_file = ROOT / 'global-kill.json'
        self.local_file = ROOT / 'kill-switch.json'
        self.global_file.write_text('{"active":false}')
        self.local_file.write_text('{"active":false}')
        self.engine = DemoPortfolioEngine(str(ROOT / (uuid4().hex + '.db')))

    def test_global_and_local_stop_after_await_no_commit_and_replay(self):
        for target, reason in [(self.global_file, 'global_kill_switch_active'), (self.local_file, 'crypto_kill_switch_active')]:
            self.global_file.write_text('{"active":false}')
            self.local_file.write_text('{"active":false}')
            entered, release = threading.Event(), threading.Event()
            results, calls = [], []
            key = uuid4().hex
            def prepare():
                calls.append(1)
                entered.set()
                self.assertTrue(release.wait(3))
                return {'market': market(), 'assetMode': 'DEMO_TRADE_ALLOWED'}
            worker = threading.Thread(target=lambda: results.append(self.engine.execute(key, 'buy', {'symbol': 'BTCUSDT', 'quoteAmount': 100}, prepare)))
            worker.start()
            self.assertTrue(entered.wait(3))
            target.write_text(json.dumps({'active': True}))
            release.set()
            worker.join(5)
            self.assertFalse(worker.is_alive())
            result = results[0][0]
            self.assertFalse(result['tradeExecuted'])
            self.assertEqual(result['execution']['reason'], reason)
            self.assertEqual(self.engine.summary()['currentCash'], 10000)
            self.assertEqual(self.engine.trades(), [])
            target.write_text('{"active":false}')
            self.assertEqual(self.engine.execute(key, 'buy', {'symbol': 'BTCUSDT', 'quoteAmount': 100}, prepare), results[0])
            self.assertEqual(len(calls), 1)

    def test_recheck_immediately_before_ledger_write(self):
        with patch('demo_portfolio.kill_reason', side_effect=[None, 'global_kill_switch_active']):
            result = self.engine.buy('BTCUSDT', 100, market())
        self.assertFalse(result['tradeExecuted'])
        self.assertEqual(self.engine.trades(), [])
        self.assertEqual(self.engine.summary()['currentCash'], 10000)
        self.assertEqual(self.engine.positions(), [])

    def test_local_resume_does_not_override_global_and_corrupt_state_blocks(self):
        self.global_file.write_text('{"active":true}')
        self.local_file.write_text('{"active":false}')
        self.assertEqual(kill_reason(), 'global_kill_switch_active')
        self.global_file.write_text('bad-state')
        self.assertFalse(self.engine.buy('BTCUSDT', 100, market())['tradeExecuted'])

    def test_hold_under_stop_and_invalid_decision_never_trade(self):
        self.local_file.write_text('{"active":true}')
        held = self.engine.hold('BTCUSDT')
        self.assertTrue(held['ok'])
        self.assertFalse(held['tradeExecuted'])
        result, _ = self.engine.execute(uuid4().hex, 'decision', {'symbol': 'BTCUSDT'}, lambda: {'market': market(), 'jev': {'ok': True, 'valid': True, 'action': 'INVALID'}})
        self.assertFalse(result['tradeExecuted'])
        self.assertEqual(self.engine.trades(), [])

    def test_concurrent_demo_request_single_consume(self):
        key = uuid4().hex
        entered, release = threading.Event(), threading.Event()
        calls, results = [], []
        def prepare():
            calls.append(1)
            entered.set()
            release.wait(3)
            return {'market': market(), 'assetMode': 'DEMO_TRADE_ALLOWED'}
        worker = threading.Thread(target=lambda: results.append(self.engine.execute(key, 'buy', {'symbol': 'BTCUSDT', 'quoteAmount': 100}, prepare)))
        worker.start()
        self.assertTrue(entered.wait(3))
        duplicate, _ = self.engine.execute(key, 'buy', {'symbol': 'BTCUSDT', 'quoteAmount': 100}, prepare)
        self.assertEqual(duplicate['errorCode'], 'operation_in_progress')
        release.set()
        worker.join(5)
        self.assertFalse(worker.is_alive())
        self.assertTrue(results[0][0]['tradeExecuted'])
        self.assertEqual(len(self.engine.trades()), 1)
        self.assertEqual(len(calls), 1)
        self.assertEqual(self.engine.execute(key, 'buy', {'symbol': 'BTCUSDT', 'quoteAmount': 100}, prepare), results[0])


if __name__ == '__main__':
    unittest.main(verbosity=2)
