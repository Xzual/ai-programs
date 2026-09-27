"""Flask contract/concurrency checks with isolated storage and offline fixtures."""
import os
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

TEMP = tempfile.TemporaryDirectory()
os.environ.update(CRYPTO_DB_PATH=str(Path(TEMP.name) / 'bootstrap.db'), CRYPTO_LOG_DIR=TEMP.name,
                  CRYPTO_STARTING_BALANCE='10000', CRYPTO_DEMO_TRADING_ENABLED='true',
                  CRYPTO_TRADING_ENABLED='false', CRYPTO_LIVE_TRADING_ENABLED='false', ENABLE_LIVE_TRADING='false',
                  BINANCE_TRADING_ENABLED='false', CRYPTO_OBSIDIAN_ENABLED='false', CRYPTO_LEARNING_ENABLED='false',
                  CRYPTO_NEWS_ENABLED='false', CRYPTO_OLLAMA_ENABLED='false')
sys.path.insert(0, str(Path(__file__).parent / 'src'))
import dashboard as d
from demo_portfolio import DemoPortfolioEngine
from price_freshness import utc_now


def snapshots(symbols, *args, **kwargs):
    return {s.replace('/', ''): {'symbol': s.replace('/', ''), 'ticker': {'last': 50000},
                                 'marketPriceTimestamp': utc_now(), 'updatedAt': utc_now(), 'fresh': True,
                                 'status': 'online', 'candles': []} for s in symbols}


class ApiTests(unittest.TestCase):
    def setUp(self):
        d.app.testing = True
        self.engine = DemoPortfolioEngine(str(Path(TEMP.name) / (uuid4().hex + '.db')))
        self.patches = [patch.object(d, 'demo_portfolio', self.engine),
                        patch.object(d.market_service, 'decision_snapshots', side_effect=snapshots),
                        patch.object(d.asset_mode_manager, 'get_mode', return_value='DEMO_TRADE_ALLOWED')]
        for p in self.patches: p.start()
        self.client = d.app.test_client()

    def tearDown(self):
        for p in reversed(self.patches): p.stop()

    def post(self, endpoint, **payload):
        payload.setdefault('clientRequestId', str(uuid4()))
        return self.client.post('/api/crypto/' + endpoint, json=payload)

    def test_http_buy_hold_sell_reset_replays_and_archived_lookup(self):
        key = str(uuid4())
        first = self.post('demo/buy', clientRequestId=key, symbol='BTC-USDT', amountCredits=100).get_json()
        self.assertTrue(first['ok'], first)
        second = self.post('demo/buy', clientRequestId=key, symbol='BTCUSDT', quoteAmount=100).get_json()
        self.assertEqual(first, second)
        self.assertEqual(self.client.get('/api/crypto/operations/' + key).get_json()['result'], first)
        self.assertEqual(self.client.get('/api/crypto/trades/' + first['tradeId']).get_json()['trade']['decisionId'], None)
        held = self.post('demo/hold', symbol='BTCUSDT').get_json()
        self.assertFalse(held['tradeExecuted'])
        decision = self.client.get('/api/crypto/decisions/' + held['decisionId']).get_json()['decision']
        self.assertEqual(decision['source'], 'manual')
        key = str(uuid4())
        sold = self.post('demo/sell', clientRequestId=key, symbol='BTCUSDT', positionPercent=50).get_json()
        self.assertTrue(sold['ok'], sold)
        self.assertEqual(sold, self.post('demo/sell', clientRequestId=key, symbol='BTCUSDT', positionPercent=50).get_json())
        old_session = self.engine.session()['sessionId']
        key = str(uuid4())
        reset = self.post('demo/reset', clientRequestId=key, confirmation='RESET_DEMO_ACCOUNT').get_json()
        self.assertEqual(reset, self.post('demo/reset', clientRequestId=key, confirmation='RESET_DEMO_ACCOUNT').get_json())
        self.assertEqual(len(self.client.get('/api/crypto/trades?sessionId=' + old_session).get_json()['trades']), 2)
        self.assertEqual(self.client.get('/api/crypto/session').get_json()['session']['initialBalance'], 10000)

    def test_invalid_private_secret_like_requests_blocked(self):
        for endpoint, payload in [('demo/buy', {'symbol': 'BTCUSDT', 'quoteAmount': 100, 'source': 'jev'}),
                                  ('demo/buy', {'symbol': 'BTCUSDT', 'quoteAmount': 100, 'leverage': 2}),
                                  ('demo/sell', {'symbol': 'BTCUSDT', 'positionPercent': 200}),
                                  ('decision/run', {'symbol': 'BTCUSDT', 'apiKey': 'PRIVATE_TEST_VALUE'})]:
            response = self.post(endpoint, **payload)
            self.assertEqual(response.status_code, 400)
            self.assertNotIn('PRIVATE_TEST_VALUE', response.get_data(as_text=True))
            self.assertEqual(response.get_json()['error']['code'], 'invalid_request')
        self.assertEqual(self.client.post('/api/crypto/demo/buy', json={'symbol': 'BTCUSDT', 'quoteAmount': 100}).status_code, 400)
        for path in ['order', 'live/buy', 'withdraw', 'futures/order']:
            self.assertEqual(self.post(path).status_code, 404)
        for feature in ['news', 'lessons', 'models', 'obsidian/status']:
            self.assertEqual(self.client.get('/api/crypto/' + feature).get_json()['status'], 'disabled')
        self.assertEqual(self.engine.summary()['currentCash'], 10000)

    def test_concurrent_http_decision_and_recovery(self):
        started, release = threading.Event(), threading.Event()
        calls, results = [], []
        def decide(context):
            calls.append(context)
            started.set()
            release.wait(3)
            return {'ok': True, 'valid': True, 'action': 'BUY', 'model': 'jev-test', 'latencyMs': 1}
        key = str(uuid4())
        def worker():
            with d.app.test_client() as c:
                results.append(c.post('/api/crypto/decision/run', json={'clientRequestId': key, 'symbol': 'BTCUSDT'}).get_json())
        with patch.object(d.jev_adapter, 'decide', side_effect=decide):
            thread = threading.Thread(target=worker)
            thread.start()
            self.assertTrue(started.wait(2))
            duplicate = self.post('decision/run', clientRequestId=key, symbol='BTCUSDT')
            self.assertEqual(duplicate.status_code, 409)
            self.assertEqual(duplicate.get_json()['errorCode'], 'operation_in_progress')
            self.assertEqual(self.post('demo/reset', confirmation='RESET_DEMO_ACCOUNT').status_code, 409)
            release.set()
            thread.join(5)
            self.assertTrue(results[0]['tradeExecuted'], results)
            self.assertEqual(self.post('decision/run', clientRequestId=key, symbol='BTCUSDT').get_json(), results[0])
        self.assertEqual(len(calls), 1)
        decisions = self.client.get('/api/crypto/decisions?source=jev&symbol=BTCUSDT&limit=50').get_json()['decisions']
        self.assertEqual(len(decisions), 1)
        self.assertEqual(decisions[0]['tradeId'], self.engine.trades()[0]['tradeId'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
