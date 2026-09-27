"""Focused Jev provider-health and decision-loop safety tests."""
import os
import sys
import time
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "src"))

from jev_adapter import HttpJevAdapter, JevDecisionAdapter, create_jev_adapter
from jev_loop import JevDemoLoopController


SECRET = "test-only-jev-secret"


def assert_secret_absent(value):
    assert SECRET not in repr(value)


def test_current_health_is_distinct_from_last_provider_contact():
    adapter = HttpJevAdapter(
        SECRET,
        "https://api.typesafe.ai",
        "jev-test",
        health_ttl_seconds=1,
    )
    initial = adapter.status()
    assert initial["health"]["state"] == "unverified"
    assert initial["lastProviderContact"]["checkedAt"] is None

    adapter._record_health("available", None, 17, "jev-runtime")
    current = adapter.status()
    assert current["health"]["state"] == "ready"
    assert current["health"]["fresh"] is True
    assert current["lastProviderContact"]["state"] == "available"

    with patch("jev_adapter.time.monotonic", return_value=adapter._last_checked_monotonic + 2):
        stale = adapter.status()
    assert stale["available"] is None
    assert stale["status"] == "stale"
    assert stale["providerStatus"] == "stale"
    assert stale["health"]["state"] == "stale"
    assert stale["health"]["errorCode"] == "health_stale"
    assert stale["lastProviderContact"]["state"] == "available"
    assert stale["lastProviderContact"]["available"] is True
    assert_secret_absent(stale)


def test_secret_stays_backend_only_and_invalid_outputs_fail_closed():
    with patch.dict(os.environ, {
        "JEV_API_KEY": SECRET,
        "JEV_API_URL": "https://api.typesafe.ai",
        "JEV_MODEL": "jev-test",
    }, clear=False):
        adapter = create_jev_adapter()
        assert adapter.status()["configured"] is True
        assert_secret_absent(adapter.status())

    for output in (
        None,
        {},
        "NO_TRADE",
        {"action": "BUY NOW"},
        {"action": "BUY", "decision": "SELL"},
        {"action": "HOLD", "confidence": float("nan")},
    ):
        result = JevDecisionAdapter.validate_output(output)
        assert result["valid"] is False
        assert result["action"] is None
        assert result["errorCode"] == "invalid_decision_output"

    hold = JevDecisionAdapter.validate_output({"action": "HOLD", "confidence": 0.5})
    assert hold["valid"] is True
    assert hold["action"] == "HOLD"


def test_hold_or_invalid_execution_claim_stops_loop_without_counting_trade():
    calls = []

    def unsafe_runner(symbols):
        calls.append(symbols)
        return {
            "ok": True,
            "results": [{
                "ok": True,
                "symbol": symbols[0],
                "decision": {"action": "HOLD"},
                "execution": {"executed": True, "blocked": False},
            }],
            "realOrderSent": False,
        }, 200

    controller = JevDemoLoopController(
        unsafe_runner,
        default_interval_seconds=0.02,
        min_interval_seconds=0.01,
    )
    assert controller.start(["BTCUSDT"], 0.02)["ok"] is True
    deadline = time.time() + 1
    while controller.status()["running"] and time.time() < deadline:
        time.sleep(0.01)

    status = controller.status()
    assert len(calls) == 1
    assert status["executedTrades"] == 0
    assert status["blockedDecisions"] == 1
    assert status["lastError"] == "UNSAFE_EXECUTION_CLAIM_REJECTED"
    assert status["lastDecisions"][0]["executed"] is False
    assert status["lastDecisions"][0]["blocked"] is True
    assert status["lastDecisions"][0]["reason"] == "unsafe_execution_claim_rejected"
    assert status["realOrderSent"] is False


if __name__ == "__main__":
    test_current_health_is_distinct_from_last_provider_contact()
    test_secret_stays_backend_only_and_invalid_outputs_fail_closed()
    test_hold_or_invalid_execution_claim_stops_loop_without_counting_trade()
    print("Jev runtime safety tests passed")
