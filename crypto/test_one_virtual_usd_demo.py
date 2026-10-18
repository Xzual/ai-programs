"""Bounded stdlib-only tests, requiring the explicitly staged public module tree."""
import json
import os
from pathlib import Path
import sqlite3
import sys
import unittest
from unittest.mock import patch
from uuid import uuid4

ARTIFACT = Path(__file__).resolve().parents[1] / 'artifacts/ngrok-demo-20261018/chat7/one-virtual-usd-test'
STAGED = Path(os.environ['EDITH_VUSD_STAGED_SRC']).resolve()
ROOT = ARTIFACT / 'runtime'
if STAGED != (ARTIFACT / 'resource/src').resolve():
    raise RuntimeError('Only the exact owned staged source tree is permitted')
ROOT.mkdir(parents=True, exist_ok=True)
NETWORK_EVENTS = []


def audit(event, args):
    if event.startswith('socket.') or event in ('subprocess.Popen', 'os.system'):
        NETWORK_EVENTS.append(event)
        raise RuntimeError('Network and child processes forbidden in isolated test')


sys.addaudithook(audit)
sys.path.insert(0, str(STAGED))
from config import CONFIG, Config
from demo_portfolio import DemoPortfolioEngine, IsolatedDemoProfile
from price_freshness import utc_now


def market(fresh=True):
    return {'symbol': 'BTCVUSD', 'ticker': {'last': 50000.0}, 'status': 'online',
            'fresh': fresh, 'marketPriceTimestamp': utc_now()}


class OneVirtualUsdTests(unittest.TestCase):
    def setUp(self):
        self.root = ROOT / uuid4().hex
        self.root.mkdir()
        self.db = self.root / 'demo.sqlite3'
        self.profile = IsolatedDemoProfile(self.root)
        self.engine = DemoPortfolioEngine(str(self.db), isolated_test_profile=self.profile)
        self.settings = patch.object(CONFIG, 'WATCHLIST', ['BTC/VUSD'])
        self.settings.start()
        self.addCleanup(self.settings.stop)
        for name in ('global-kill.json', 'local-kill.json'):
            (ROOT / name).write_text('{"active":false}', encoding='utf-8')

    def buy(self, amount=.1, request=None, fresh=True):
        snap = market(fresh)
        return self.engine.execute(request or uuid4().hex, 'buy', {'symbol': 'BTCVUSD', 'quoteAmount': amount},
            lambda: {'market': snap, 'markets': {'BTCVUSD': snap}, 'assetMode': 'DEMO_TRADE_ALLOWED'})

    def test_initial_and_same_capability_restart(self):
        s = self.engine.summary()
        self.assertEqual((s['initialBalance'], s['currentCash'], s['currency']), (1., 1., 'VIRTUAL_USD'))
        self.buy()
        second = DemoPortfolioEngine(str(self.db), isolated_test_profile=self.profile)
        self.assertEqual(second.summary()['portfolioSessionId'], s['portfolioSessionId'])
        self.assertAlmostEqual(second.summary()['currentCash'], .8999)
        self.assertEqual(second.summary()['initialBalance'], 1.)

    def test_production_guards_and_existing_path_reject(self):
        with self.assertRaises(ValueError): Config(DEMO_INITIAL_BALANCE=1)
        from demo_migration import migrate
        with self.assertRaises(ValueError): migrate(str(self.root / 'not-created.sqlite3'), 1)
        self.assertFalse((self.root / 'not-created.sqlite3').exists())
        with self.assertRaises(ValueError): IsolatedDemoProfile(self.root)
        with self.assertRaises(ValueError): DemoPortfolioEngine(str(self.root / 'other.sqlite3'), isolated_test_profile=self.profile)
        normal = DemoPortfolioEngine(str(self.root / 'production-synthetic.sqlite3'))
        self.assertEqual((normal.summary()['initialBalance'], normal.summary()['currency']), (10000., 'CREDITS'))
        reset, status = normal.execute(uuid4().hex, 'reset', {'confirmation': 'RESET_DEMO_ACCOUNT'})
        self.assertEqual(status, 200)
        self.assertEqual(reset['portfolio']['initialBalance'], 10000.)

    def test_late_file_claim_refused_before_migration(self):
        root = self.root / 'late-claim'
        root.mkdir()
        profile = IsolatedDemoProfile(root)
        target = root / 'demo.sqlite3'
        target.write_bytes(b'owned-synthetic-sentinel')
        with patch('demo_portfolio.migrate') as migration:
            with self.assertRaises(ValueError):
                DemoPortfolioEngine(str(target), isolated_test_profile=profile)
            migration.assert_not_called()
        self.assertEqual(target.read_bytes(), b'owned-synthetic-sentinel')

    def test_profile_type_and_no_reset_before_reservation(self):
        with self.assertRaises(ValueError): DemoPortfolioEngine(str(self.root / 'bad.sqlite3'), isolated_test_profile={'balance': 1})
        before = self.engine.latest_state()
        body, code = self.engine.execute(uuid4().hex, 'reset', {'confirmation': 'RESET_DEMO_ACCOUNT'})
        self.assertEqual(code, 409)
        self.assertEqual(body['errorCode'], 'reset_not_allowed')
        self.assertEqual(self.engine.latest_state(), before)
        with sqlite3.connect(self.db) as c:
            self.assertEqual(c.execute('SELECT COUNT(*) FROM crypto_demo_operations').fetchone()[0], 0)

    def test_fee_roundtrip_and_idempotency(self):
        key = uuid4().hex
        bought, code = self.buy(request=key)
        self.assertEqual(code, 200)
        replay, replay_code = self.buy(request=key)
        self.assertEqual((replay, replay_code), (bought, code))
        self.assertAlmostEqual(bought['fee'], .0001)
        self.assertAlmostEqual(self.engine.summary()['currentCash'], .8999)
        snap = market()
        sold, code = self.engine.execute(uuid4().hex, 'sell', {'symbol': 'BTCVUSD', 'positionPercent': 100},
            lambda: {'market': snap, 'markets': {'BTCVUSD': snap}, 'assetMode': 'DEMO_TRADE_ALLOWED'})
        self.assertEqual(code, 200)
        self.assertAlmostEqual(self.engine.summary()['currentCash'], .9998)
        self.assertEqual(self.engine.summary()['numberOfTrades'], 2)
        self.assertFalse(sold['portfolio']['realOrderSent'])

    def test_small_balance_risk_and_fee_limits(self):
        self.assertEqual(self.buy(.2)[0]['execution']['reason'], 'max_position_size_exceeded')
        self.assertEqual(self.buy(1)[0]['errorCode'], 'insufficient_balance')
        self.assertEqual(self.engine.summary()['currentCash'], 1)
        self.assertEqual(self.buy(.1)[1], 200)
        self.assertEqual(self.buy(.1)[0]['execution']['reason'], 'duplicate_symbol_position')

    def test_stale_and_live_flag_deny_without_money_mutation(self):
        self.assertEqual(self.buy(fresh=False)[0]['errorCode'], 'stale_market_data')
        with patch.object(CONFIG, 'ENABLE_LIVE_TRADING', True):
            self.assertEqual(self.buy()[0]['execution']['reason'], 'live_trading_locked')
        self.assertEqual(self.engine.summary()['currentCash'], 1)

    def test_kill_at_start_and_before_commit(self):
        (ROOT / 'global-kill.json').write_text('{"active":true}', encoding='utf-8')
        self.assertEqual(self.buy()[0]['execution']['reason'], 'global_kill_switch_active')
        (ROOT / 'global-kill.json').write_text('{"active":false}', encoding='utf-8')
        with patch('demo_portfolio.kill_reason', side_effect=[None, 'crypto_kill_switch_active']):
            self.assertEqual(self.buy()[0]['execution']['reason'], 'crypto_kill_switch_active')
        self.assertEqual(self.engine.summary()['currentCash'], 1)
        self.assertEqual(self.engine.summary()['numberOfTrades'], 0)

    def test_no_network_and_public_import_closure(self):
        self.assertEqual(NETWORK_EVENTS, [])
        for name in ('config', 'demo_migration', 'demo_portfolio', 'demo_safety', 'obsidian_path', 'price_freshness'):
            self.assertEqual(Path(sys.modules[name].__file__).resolve().parent, STAGED)


if __name__ == '__main__':
    unittest.main(verbosity=2)
