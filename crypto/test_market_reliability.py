"""Offline market-cache and Jev transport regression tests; no portfolio or DB imports."""
import io
import json
import sys
import threading
import unittest
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from contextlib import redirect_stderr, redirect_stdout
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import Mock, patch

import pandas as pd
import requests

sys.path.insert(0, str(Path(__file__).resolve().parent / "src"))

from config import CONFIG
from jev_adapter import HttpJevAdapter, JevDecisionAdapter
from market_data import MarketDataFetcher
from market_service import MAX_CACHE_ENTRIES, MarketDataService


SYMBOLS = ("BTC/USDT", "ETH/USDT", "SOL/USDT", "BNB/USDT", "XRP/USDT", "DOGE/USDT", "ADA/USDT", "AVAX/USDT")
SECRET = "TEST_SECRET_NEVER_RETURN"


class Clock:
    def __init__(self):
        self.elapsed = 0.0
        self.start = datetime(2026, 9, 22, tzinfo=timezone.utc)

    def now(self):
        return self.start + timedelta(seconds=self.elapsed)

    def stamp(self):
        return self.now().isoformat()

    def advance(self, seconds):
        self.elapsed += seconds


class PublicFetcher:
    def __init__(self):
        self.calls = Counter()
        self.ticker = {"last": 100.0, "bid": 99.0, "ask": 101.0, "percentage": 1.0, "quoteVolume": 1000.0}
        self.candles = pd.DataFrame(
            [{"open": 99.0, "high": 102.0, "low": 98.0, "close": 100.0, "volume": 10.0}],
            index=pd.to_datetime(["2026-09-22T00:00:00Z"]),
        )
        self.offline = False
        self.ticker_hook = None
        self.candle_hook = None
        self.depth_hook = None
        self.missing = set()

    def fetch_ticker(self, symbol):
        self.calls["ticker"] += 1
        if self.ticker_hook:
            self.ticker_hook()
        return None if self.offline else deepcopy(self.ticker)

    def fetch_tickers(self, symbols):
        self.calls["tickers"] += 1
        if self.ticker_hook:
            self.ticker_hook()
        return {} if self.offline else {symbol: deepcopy(self.ticker) for symbol in symbols if symbol not in self.missing}

    def fetch_ohlcv(self, symbol, timeframe="1m", limit=40):
        self.calls["candles"] += 1
        if self.candle_hook:
            self.candle_hook()
        return None if self.offline else self.candles.copy()

    def fetch_ohlcv_many(self, symbols, timeframe="1m", limit=40):
        self.calls["candle_batch"] += 1
        if self.candle_hook:
            self.candle_hook()
        return {symbol: None if self.offline else self.candles.copy() for symbol in symbols}

    def fetch_order_book(self, symbol, limit=16):
        self.calls["depth"] += 1
        if self.depth_hook:
            self.depth_hook()
        return None if self.offline else {"bids": [[99.0, 2.0]], "asks": [[101.0, 3.0]]}


class OfflineTest(unittest.TestCase):
    def setUp(self):
        self.enterContext(patch.object(requests.sessions.Session, "request", side_effect=AssertionError("Real HTTP is forbidden in this suite")))


class MarketReliabilityTests(OfflineTest):
    def setUp(self):
        super().setUp()
        self.clock = Clock()
        self.enterContext(patch("market_service.utc_now", side_effect=self.clock.stamp))
        self.enterContext(patch("market_service.monotonic", side_effect=lambda: self.clock.elapsed))
        dates = self.enterContext(patch("price_freshness.datetime", wraps=datetime))
        dates.now.side_effect = lambda *_: self.clock.now()
        self.enterContext(patch.object(CONFIG, "MAX_MARKET_DATA_AGE_MS", 15000))
        self.enterContext(patch.object(CONFIG, "MARKET_CACHE_SECONDS", 5.0))
        self.fetcher = PublicFetcher()
        self.service = MarketDataService(self.fetcher)

    def test_cache_expires_at_five_seconds_without_renewing_quote_timestamp(self):
        first = self.service.snapshot("BTCUSDT")
        self.clock.advance(4.999)
        cached = self.service.snapshot("btc/usdt")
        self.assertEqual(self.fetcher.calls, {"ticker": 1, "candles": 1, "depth": 1})
        self.assertEqual(cached["marketPriceTimestamp"], first["marketPriceTimestamp"])
        self.assertEqual(cached["marketDataAgeMs"], 4999)
        self.assertEqual(cached["marketDataStatus"], "fresh")
        self.clock.advance(0.001)
        self.fetcher.ticker["last"] = 101.0
        refreshed = self.service.snapshot("BTC-USDT")
        self.assertEqual(self.fetcher.calls["ticker"], 2)
        self.assertEqual(refreshed["ticker"]["last"], 101.0)
        self.assertNotEqual(refreshed["marketPriceTimestamp"], first["marketPriceTimestamp"])

    def test_cache_ttl_cannot_be_configured_above_five_seconds(self):
        with patch.object(CONFIG, "MARKET_CACHE_SECONDS", 999):
            service = MarketDataService(self.fetcher)
        service.decision_snapshot("BTCUSDT")
        self.clock.advance(5)
        service.decision_snapshot("BTCUSDT")
        self.assertEqual(self.fetcher.calls["ticker"], 2)

    def test_cache_returns_independent_nested_values(self):
        first = self.service.snapshot("BTCUSDT")
        first["ticker"]["last"] = 0
        first["candles"][0]["close"] = 0
        first["orderBook"]["bids"].clear()
        second = self.service.snapshot("BTCUSDT")
        self.assertEqual(second["ticker"]["last"], 100.0)
        self.assertEqual(second["candles"][0]["close"], 100.0)
        self.assertTrue(second["orderBook"]["bids"])

    def test_cache_keys_preserve_timeframe_limit_and_depth(self):
        self.service.snapshot("BTCUSDT", "5m", 30)
        self.service.snapshot("BTCUSDT", "1m", 30)
        self.service.snapshot("BTCUSDT", "1m", 31)
        self.service.decision_snapshot("BTCUSDT", "1m", 31)
        self.assertEqual(self.fetcher.calls["ticker"], 4)
        self.assertEqual(self.fetcher.calls["depth"], 3)
        self.service.snapshot("BTCUSDT", "unsupported", 30)
        self.assertEqual(self.fetcher.calls["ticker"], 4)

    def test_lru_cache_is_bounded_and_keeps_recent_entries(self):
        for limit in range(20, 20 + MAX_CACHE_ENTRIES):
            self.service.snapshot("BTCUSDT", candle_limit=limit)
        self.service.snapshot("BTCUSDT", candle_limit=20)
        self.service.snapshot("BTCUSDT", candle_limit=20 + MAX_CACHE_ENTRIES)
        self.assertEqual(len(self.service._cache), MAX_CACHE_ENTRIES)
        before = self.fetcher.calls["ticker"]
        self.service.snapshot("BTCUSDT", candle_limit=20)
        self.assertEqual(self.fetcher.calls["ticker"], before)
        self.service.snapshot("BTCUSDT", candle_limit=21)
        self.assertEqual(self.fetcher.calls["ticker"], before + 1)

    def test_slow_full_snapshot_uses_ticker_request_start(self):
        stamp = self.clock.stamp()
        self.fetcher.ticker_hook = lambda: self.clock.advance(3)
        self.fetcher.candle_hook = lambda: self.clock.advance(8)
        self.fetcher.depth_hook = lambda: self.clock.advance(5)
        market = self.service.snapshot("BTCUSDT")
        self.assertEqual(market["updatedAt"], stamp)
        self.assertEqual(market["marketPriceTimestamp"], stamp)
        self.assertEqual(market["marketDataAgeMs"], 16000)
        self.assertEqual(market["marketDataStatus"], "stale")
        self.assertFalse(market["fresh"])

    def test_slow_batch_uses_shared_ticker_request_start(self):
        stamp = self.clock.stamp()
        self.fetcher.ticker_hook = lambda: self.clock.advance(2)
        self.fetcher.candle_hook = lambda: self.clock.advance(14)
        markets = self.service.decision_snapshots(SYMBOLS)
        self.assertEqual(len(markets), 8)
        self.assertEqual(self.fetcher.calls, {"tickers": 1, "candle_batch": 1})
        for market in markets.values():
            self.assertEqual(market["marketPriceTimestamp"], stamp)
            self.assertEqual(market["marketDataAgeMs"], 16000)
            self.assertEqual(market["marketDataStatus"], "stale")

    def test_missing_batch_ticker_has_its_own_conservative_fetch_time(self):
        self.fetcher.missing = {"ETH/USDT"}
        self.fetcher.ticker_hook = lambda: self.clock.advance(2)
        markets = self.service.decision_snapshots(SYMBOLS[:2])
        self.assertEqual(markets["BTCUSDT"]["marketDataAgeMs"], 4000)
        self.assertEqual(markets["ETHUSDT"]["marketDataAgeMs"], 2000)
        self.assertEqual(self.fetcher.calls["ticker"], 1)

    def test_old_exchange_timestamp_is_not_replaced_with_local_now(self):
        self.fetcher.ticker["timestamp"] = (self.clock.now() - timedelta(seconds=30)).timestamp() * 1000
        market = self.service.decision_snapshot("BTCUSDT")
        self.assertEqual(market["marketDataAgeMs"], 30000)
        self.assertEqual(market["marketDataStatus"], "stale")

    def test_future_exchange_timestamp_does_not_advance_fetch_time(self):
        self.fetcher.ticker["timestamp"] = (self.clock.now() + timedelta(seconds=30)).timestamp() * 1000
        market = self.service.decision_snapshot("BTCUSDT")
        self.assertEqual(market["marketPriceTimestamp"], self.clock.stamp())
        self.assertEqual(market["marketDataAgeMs"], 0)

    def test_cache_hit_rechecks_freshness_at_configured_boundary(self):
        self.fetcher.candle_hook = lambda: self.clock.advance(14)
        self.service.decision_snapshot("BTCUSDT")
        self.clock.advance(1)
        self.assertTrue(self.service.decision_snapshot("BTCUSDT")["fresh"])
        self.clock.advance(0.001)
        stale = self.service.decision_snapshot("BTCUSDT")
        self.assertEqual(stale["marketDataAgeMs"], 15001)
        self.assertEqual(stale["marketDataStatus"], "stale")
        self.assertEqual(self.fetcher.calls["ticker"], 1)

    def test_freshness_threshold_comes_from_existing_config(self):
        self.service.decision_snapshot("BTCUSDT")
        self.clock.advance(2)
        with patch.object(CONFIG, "MAX_MARKET_DATA_AGE_MS", 1000):
            self.assertEqual(self.service.decision_snapshot("BTCUSDT")["marketDataStatus"], "stale")

    def test_cold_offline_returns_no_quote_or_price_timestamp(self):
        self.fetcher.offline = True
        market = self.service.snapshot("BTCUSDT")
        self.assertEqual(market["status"], "offline")
        self.assertEqual(market["marketDataStatus"], "unavailable")
        self.assertIsNone(market["ticker"])
        self.assertIsNone(market["currentPrice"])
        self.assertIsNone(market["marketPriceTimestamp"])
        self.assertIsNone(market["marketDataAgeMs"])
        self.assertFalse(market["realData"])
        self.service.snapshot("BTCUSDT")
        self.assertEqual(self.fetcher.calls["ticker"], 1)

    def test_failed_refresh_keeps_real_quote_but_marks_it_stale_and_recovers(self):
        first = self.service.snapshot("BTCUSDT")
        self.clock.advance(5)
        self.fetcher.offline = True
        stale = self.service.snapshot("BTCUSDT")
        self.assertEqual(stale["status"], "degraded")
        self.assertEqual(stale["marketDataStatus"], "stale")
        self.assertEqual(stale["marketPriceTimestamp"], first["marketPriceTimestamp"])
        self.assertEqual(stale["marketDataAgeMs"], 5000)
        self.assertEqual(stale["ticker"]["last"], 100)
        self.assertTrue(stale["realData"])
        self.assertFalse(stale["fresh"])
        self.clock.advance(1)
        self.assertEqual(self.service.snapshot("BTCUSDT")["marketDataAgeMs"], 6000)
        self.clock.advance(4)
        self.fetcher.offline = False
        self.fetcher.ticker["last"] = 105.0
        recovered = self.service.snapshot("BTCUSDT")
        self.assertEqual(recovered["marketDataStatus"], "fresh")
        self.assertEqual(recovered["ticker"]["last"], 105)
        self.assertNotIn("error", recovered)

    def test_partial_batch_failure_keeps_only_the_previous_real_quote(self):
        first = self.service.decision_snapshots(SYMBOLS[:2])
        self.clock.advance(5)
        self.fetcher.missing = {"ETH/USDT"}
        with patch.object(self.fetcher, "fetch_ticker", return_value=None):
            second = self.service.decision_snapshots(SYMBOLS[:3])
        self.assertEqual(second["BTCUSDT"]["marketDataStatus"], "fresh")
        self.assertEqual(second["ETHUSDT"]["marketDataStatus"], "stale")
        self.assertEqual(second["ETHUSDT"]["marketPriceTimestamp"], first["ETHUSDT"]["marketPriceTimestamp"])
        self.assertEqual(second["SOLUSDT"]["marketDataStatus"], "fresh")

    def test_transport_exceptions_do_not_expose_details_and_failure_is_cached(self):
        with patch.object(self.fetcher, "fetch_ticker", side_effect=RuntimeError(SECRET)) as request:
            market = self.service.snapshot("BTCUSDT")
            self.service.snapshot("BTCUSDT")
        self.assertEqual(request.call_count, 1)
        self.assertEqual(market["marketDataStatus"], "unavailable")
        self.assertNotIn(SECRET, json.dumps(market, allow_nan=False))

    def test_invalid_prices_never_look_fresh(self):
        for value in (True, False, float("nan"), float("inf"), float("-inf"), "NaN", "no-price", 0, -1):
            with self.subTest(price=repr(value)):
                fetcher = PublicFetcher()
                fetcher.ticker.update(last=value, close=100)
                market = MarketDataService(fetcher).decision_snapshot("BTCUSDT")
                self.assertEqual(market["marketDataStatus"], "unavailable")
                self.assertIsNone(market["ticker"])
                json.dumps(market, allow_nan=False)

    def test_batch_and_single_reads_share_cache_and_deduplicate_symbols(self):
        self.service.decision_snapshots([*SYMBOLS, "BTCUSDT"])
        self.service.decision_snapshots(reversed(SYMBOLS))
        self.service.decision_snapshot("BTCUSDT")
        self.assertEqual(self.fetcher.calls, {"tickers": 1, "candle_batch": 1})
        self.assertEqual(self.service.decision_snapshots([]), {})

    def test_nonfinite_fields_and_overflowed_spread_remain_json_safe(self):
        for bid, ask in ((float("nan"), float("inf")), (-1e308, 1e308), (-1e308, 1e-308)):
            with self.subTest(bid=bid, ask=ask):
                fetcher = PublicFetcher()
                fetcher.ticker.update(bid=bid, ask=ask, percentage=float("nan"), high=float("inf"))
                market = MarketDataService(fetcher).snapshot("BTCUSDT")
                self.assertEqual(market["marketDataStatus"], "fresh")
                self.assertIsNone(market["ticker"]["spreadPct"])
                json.dumps(market, allow_nan=False)

    def test_cached_reads_do_not_wait_on_an_unrelated_slow_fetch(self):
        self.service.decision_snapshot("BTCUSDT")
        entered, release = threading.Event(), threading.Event()

        def block():
            entered.set()
            if not release.wait(3):
                raise AssertionError("Fetch did not get released")

        self.fetcher.ticker_hook = block
        with ThreadPoolExecutor(max_workers=2) as pool:
            slow = pool.submit(self.service.decision_snapshot, "ETHUSDT")
            try:
                self.assertTrue(entered.wait(3))
                cached = pool.submit(self.service.decision_snapshot, "BTCUSDT")
                self.assertTrue(cached.result(timeout=1)["fresh"])
            finally:
                release.set()
            self.assertTrue(slow.result(timeout=3)["fresh"])

    def test_invalid_symbol_does_not_contact_provider(self):
        with self.assertRaisesRegex(ValueError, "UNSUPPORTED_SYMBOL"):
            self.service.decision_snapshots(["BTCUSDT", "UNKNOWNUSDT"])
        self.assertFalse(self.fetcher.calls)

    def test_concurrent_identical_requests_share_one_slow_fetch(self):
        entered, release = threading.Event(), threading.Event()
        gate = threading.Barrier(13)

        def block():
            entered.set()
            if not release.wait(3):
                raise AssertionError("Fetch did not get released")

        def read():
            gate.wait(timeout=3)
            return self.service.snapshot("BTCUSDT")

        self.fetcher.ticker_hook = block
        with ThreadPoolExecutor(max_workers=12) as pool:
            futures = [pool.submit(read) for _ in range(12)]
            try:
                gate.wait(timeout=3)
                self.assertTrue(entered.wait(3))
            finally:
                release.set()
            markets = [future.result(timeout=3) for future in futures]
        self.assertEqual(self.fetcher.calls, {"ticker": 1, "candles": 1, "depth": 1})
        self.assertTrue(all(market["fresh"] for market in markets))

    def test_overlapping_requests_keep_existing_four_worker_market_bound(self):
        entered, release = threading.Event(), threading.Event()
        lock = threading.Lock()
        active, peak = 0, 0

        def candles(symbol, timeframe="1m", limit=40):
            nonlocal active, peak
            with lock:
                active += 1
                peak = max(peak, active)
                if active == 4:
                    entered.set()
            try:
                if not release.wait(3):
                    raise AssertionError("Candle fetch did not get released")
                return self.fetcher.candles.copy()
            finally:
                with lock:
                    active -= 1

        self.fetcher.fetch_ohlcv = candles
        self.fetcher.fetch_ohlcv_many = lambda symbols, **kwargs: MarketDataFetcher.fetch_ohlcv_many(self.fetcher, symbols, **kwargs)
        with ThreadPoolExecutor(max_workers=10) as pool:
            batch = pool.submit(self.service.decision_snapshots, SYMBOLS)
            try:
                self.assertTrue(entered.wait(3))
                singles = [pool.submit(self.service.decision_snapshot, symbol) for symbol in SYMBOLS]
                other = pool.submit(self.service.snapshot, "BTCUSDT", "5m")
            finally:
                release.set()
            self.assertEqual(len(batch.result(timeout=3)), 8)
            for result in singles + [other]:
                self.assertTrue(result.result(timeout=3)["fresh"])
        self.assertEqual(peak, 4)
        self.assertEqual(self.fetcher.calls["tickers"], 1)
        self.assertEqual(self.fetcher.calls["ticker"], 1)


class JevReliabilityTests(OfflineTest):
    def setUp(self):
        super().setUp()
        self.adapter = HttpJevAdapter(SECRET, "https://jev.invalid", "jev-test")
        self.addCleanup(self.adapter._session.close)
        self.post = self.enterContext(patch.object(self.adapter._session, "post"))
        self.contexts = [{"symbol": symbol.replace("/", ""), "price": 100, "riskAllowed": True} for symbol in SYMBOLS]

    def response(self, payload=None, status=200, text=""):
        response = Mock(status_code=status, text=text)
        response.json.return_value = payload
        self.post.return_value = response
        return response

    def batch_payload(self):
        return {"model": "jev-resolved", "answers": {
            f"decision_{context['symbol']}": {"type": "choice", "choice": "HOLD", "confidence": 0.7}
            for context in self.contexts
        }}

    def test_confidence_rejects_bool_nonfinite_overflow_and_out_of_range(self):
        for confidence in (True, False, float("nan"), float("inf"), float("-inf"), "NaN", "Infinity", "1e999", 10 ** 400, -0.01, 1.01, [], {}):
            with self.subTest(confidence=repr(confidence)):
                decision = JevDecisionAdapter.validate_output({"action": "BUY", "confidence": confidence})
                self.assertFalse(decision["valid"])
                self.assertIsNone(decision["action"])
                self.assertIsNone(decision["confidence"])
                self.assertEqual(decision["errorCode"], "invalid_decision_output")
                json.dumps(decision, allow_nan=False)

    def test_valid_confidence_and_supported_actions_remain_compatible(self):
        for action in ("BUY", "SELL", "HOLD", " hold "):
            for confidence in (None, 0, 0.5, 1, "0.75"):
                with self.subTest(action=action, confidence=confidence):
                    decision = JevDecisionAdapter.validate_output({"action": action, "confidence": confidence})
                    self.assertTrue(decision["valid"])
                    self.assertEqual(decision["action"], action.strip().upper())

    def test_invalid_or_conflicting_actions_cannot_fall_through_to_valid_alias(self):
        outputs = [None, [], {}, True, {"action": True}, {"action": ["BUY"]}, {"action": "WAIT"},
                   {"action": "BUY SELL"}, {"action": "BUY", "decision": "SELL"},
                   {"action": False, "decision": "BUY"}, {"action": None, "label": "HOLD"},
                   {"action": "", "decision": "BUY"}]
        for output in outputs:
            with self.subTest(output=output):
                self.assertFalse(JevDecisionAdapter.validate_output(output)["valid"])
        self.assertTrue(JevDecisionAdapter.validate_output({"label": "HOLD"})["valid"])
        self.assertTrue(JevDecisionAdapter.validate_output({"action": "BUY", "decision": "buy"})["valid"])

    def test_native_batch_of_eight_stays_one_real_transport_request(self):
        self.response(self.batch_payload())
        result = self.adapter.decide_many(self.contexts)
        self.assertTrue(result["ok"])
        self.assertEqual(len(result["decisions"]), 8)
        self.post.assert_called_once()
        args, kwargs = self.post.call_args
        self.assertEqual(args[0], "https://jev.invalid/v1/systemone")
        self.assertEqual(len(kwargs["json"]["questions"]), 8)
        self.assertEqual(len(kwargs["json"]["state"]["assets"]), 8)
        self.assertFalse(kwargs["json"]["state"]["realOrdersAllowed"])
        self.assertEqual({item["symbol"] for item in result["decisions"]}, {item["symbol"] for item in self.contexts})
        self.assertTrue(all(item["action"] == "HOLD" and not item["realOrderSent"] for item in result["decisions"]))
        self.assertNotIn(SECRET, json.dumps(kwargs["json"]))
        self.assertEqual(self.adapter._session.headers["Authorization"], f"Bearer {SECRET}")

    def test_one_bad_batch_answer_rejects_entire_batch_without_retry(self):
        for bad in (None, {"choice": "WAIT"}, {"choice": "BUY", "confidence": True}, {"choice": "SELL", "confidence": "NaN"}):
            with self.subTest(answer=bad):
                payload = self.batch_payload()
                payload["answers"]["decision_ETHUSDT"] = bad
                self.response(payload)
                self.post.reset_mock()
                result = self.adapter.decide_many(self.contexts)
                self.assertFalse(result["valid"])
                self.assertEqual(result["decisions"], [])
                self.assertEqual(result["errorCode"], "invalid_decision_output")
                self.post.assert_called_once()

    def test_missing_batch_answer_is_rejected(self):
        payload = self.batch_payload()
        del payload["answers"]["decision_AVAXUSDT"]
        self.response(payload)
        result = self.adapter.decide_many(self.contexts)
        self.assertFalse(result["ok"])
        self.assertEqual(result["decisions"], [])

    def test_invalid_batch_context_does_not_send_request(self):
        for contexts in ([], [{"symbol": ""}], [self.contexts[0], self.contexts[0]]):
            self.assertFalse(self.adapter.decide_many(contexts)["ok"])
        self.post.assert_not_called()

    def test_single_plain_text_and_native_structured_decisions_remain_supported(self):
        self.response({"model": "jev-resolved", "answers": {"decision": {"choice": "BUY", "confidence": 0.8}}})
        self.assertEqual(self.adapter.decide(self.contexts[0])["action"], "BUY")
        response = self.response(text="SELL")
        response.json.side_effect = ValueError("Not JSON")
        self.assertEqual(self.adapter.decide(self.contexts[0])["action"], "SELL")

    def test_single_transport_rejects_invalid_confidence(self):
        self.response({"action": "BUY", "confidence": float("nan")})
        result = self.adapter.decide(self.contexts[0])
        self.assertFalse(result["ok"])
        self.assertEqual(result["errorCode"], "invalid_decision_output")

    def test_freshness_fields_pass_through_without_retimestamping(self):
        context = {**self.contexts[0], "marketPriceTimestamp": "2026-09-22T00:00:00+00:00",
                   "inputMarketTimestamp": "2026-09-22T00:00:00+00:00", "marketDataAgeMs": 4000,
                   "marketDataStatus": "fresh", "apiKey": SECRET, "headers": {"Authorization": SECRET}}
        self.response({"action": "HOLD"})
        self.adapter.decide(context)
        state = self.post.call_args.kwargs["json"]["state"]
        for field in ("marketPriceTimestamp", "inputMarketTimestamp", "marketDataAgeMs", "marketDataStatus"):
            self.assertEqual(state[field], context[field])
        self.assertNotIn(SECRET, json.dumps(state))

    def test_errors_are_safe_for_single_and_batch_without_retry(self):
        cases = [(requests.Timeout(SECRET), "jev_timeout"), (requests.ConnectionError(SECRET), "jev_unavailable")]
        for exception, code in cases:
            for batch in (False, True):
                with self.subTest(code=code, batch=batch):
                    self.post.reset_mock()
                    self.post.side_effect = exception
                    captured = io.StringIO()
                    with redirect_stdout(captured), redirect_stderr(captured):
                        result = self.adapter.decide_many(self.contexts) if batch else self.adapter.decide(self.contexts[0])
                    self.assertEqual(result["errorCode"], code)
                    self.assertFalse(result["realOrderSent"])
                    self.assertNotIn(SECRET, json.dumps(result) + json.dumps(self.adapter.status()) + captured.getvalue())
                    self.post.assert_called_once()

    def test_http_error_bodies_and_malformed_outputs_are_never_exposed(self):
        for status, code in ((401, "jev_auth_failed"), (403, "jev_auth_failed"), (429, "jev_rate_limited"), (500, "jev_upstream_error"), (400, "jev_request_rejected")):
            self.response({"error": SECRET}, status=status, text=SECRET)
            for batch in (False, True):
                result = self.adapter.decide_many(self.contexts) if batch else self.adapter.decide(self.contexts[0])
                self.assertEqual(result["errorCode"], code)
                self.assertNotIn(SECRET, json.dumps(result))
        response = self.response(text=SECRET)
        response.json.side_effect = ValueError(SECRET)
        for batch in (False, True):
            result = self.adapter.decide_many(self.contexts) if batch else self.adapter.decide(self.contexts[0])
            self.assertEqual(result["errorCode"], "invalid_decision_output")
            self.assertNotIn(SECRET, json.dumps(result))

    def test_provider_model_cannot_echo_credentials_into_status_or_results(self):
        for model in (SECRET, f"jev-{SECRET}", {"token": SECRET}, f"Bearer {SECRET}"):
            for batch in (False, True):
                with self.subTest(model=model, batch=batch):
                    payload = self.batch_payload() if batch else {"action": "HOLD"}
                    payload["model"] = model
                    self.response(payload)
                    result = self.adapter.decide_many(self.contexts) if batch else self.adapter.decide(self.contexts[0])
                    self.assertTrue(result["ok"])
                    self.assertEqual(result["model"], "jev-test")
                    self.assertNotIn(SECRET, json.dumps(result) + json.dumps(self.adapter.status()))


if __name__ == "__main__":
    unittest.main(verbosity=2)
