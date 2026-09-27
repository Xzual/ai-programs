"""Strict HTTP inputs and reserve/prepare/finish orchestration for the demo ledger."""
import json
import math
import re
import time
from uuid import uuid4

from requests.exceptions import Timeout

from demo_portfolio import MESSAGES, envelope
from jev_adapter import JevDecisionAdapter
from price_freshness import price_status


REQUEST_ID = re.compile(r"[A-Za-z0-9_-]{8,128}")
RESOURCE_ID = re.compile(r"[A-Za-z0-9_-]{1,160}")
ERROR_MESSAGES = {
    **MESSAGES,
    "trade_not_found": "Demo trade was not found.",
    "decision_not_found": "Demo decision was not found.",
    "not_found": "Crypto endpoint was not found.",
    "method_not_allowed": "This method is not allowed.",
    "feature_disabled": "This feature is disabled for the demo phase.",
    "legacy_endpoint_disabled": "This legacy endpoint is disabled.",
    "legacy_observer_disabled": "The legacy observer is disabled.",
    "demo_trading_disabled": "Demo trading is disabled.",
    "live_trading_locked": "Live trading is locked.",
    "jev_adapter_not_configured": "Jev is not configured.",
    "invalid_loop_interval": "A finite positive loop interval is required.",
    "loop_interval_too_short": "The loop interval is below the minimum.",
    "jev_loop_already_running": "The Jev demo loop is already running.",
}


class InvalidRequest(ValueError):
    pass


def safe_envelope(data, code=None, request_id=None):
    code = code if code in ERROR_MESSAGES else "trade_execution_failed" if code else None
    result = envelope(data, request_id, code)
    if code:
        result.update(error={"code": code, "message": ERROR_MESSAGES[code]},
                      errorCode=code, safeMessage=ERROR_MESSAGES[code])
    return result


def decode_body(body):
    def unique_object(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise InvalidRequest()
            result[key] = value
        return result

    def reject_constant(value):
        raise InvalidRequest()

    if len(body) > 16384:
        raise InvalidRequest()
    try:
        result = json.loads(body, object_pairs_hook=unique_object, parse_constant=reject_constant)
    except (ValueError, UnicodeError, RecursionError):
        raise InvalidRequest() from None
    if not isinstance(result, dict):
        raise InvalidRequest()
    return result


def canonical_symbol(value, market_service):
    if not isinstance(value, str) or not value.strip() or len(value) > 32:
        raise InvalidRequest()
    try:
        return market_service.normalize_symbol(value).replace("/", "")
    except (ValueError, TypeError):
        raise InvalidRequest() from None


def finite_number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise InvalidRequest()
    try:
        result = float(value)
        if math.isfinite(result):
            return result
    except (ValueError, OverflowError):
        pass
    raise InvalidRequest()


def normalize_request(operation, raw, market_service):
    fields = {
        "buy": {"symbol", "quoteAmount", "amountCredits"},
        "sell": {"symbol", "positionPercent"},
        "hold": {"symbol"},
        "reset": {"confirmation"},
        "decision": {"symbol"},
    }
    common = {"clientRequestId", "idempotencyKey", "source"}
    if operation not in fields or not isinstance(raw, dict) or set(raw) - fields[operation] - common:
        raise InvalidRequest()
    ids = [raw[key] for key in ("clientRequestId", "idempotencyKey") if key in raw]
    if not ids or any(not isinstance(value, str) or not REQUEST_ID.fullmatch(value) for value in ids):
        raise InvalidRequest()
    if len(set(ids)) != 1:
        raise InvalidRequest()
    source = "jev" if operation == "decision" else "manual"
    if "source" in raw and raw["source"] != source:
        raise InvalidRequest()
    payload = {"source": source}
    if operation == "reset":
        if raw.get("confirmation") != "RESET_DEMO_ACCOUNT":
            raise InvalidRequest()
        payload["confirmation"] = "RESET_DEMO_ACCOUNT"
    else:
        payload["symbol"] = canonical_symbol(raw.get("symbol"), market_service)
    if operation == "buy":
        amounts = [finite_number(raw[key]) for key in ("quoteAmount", "amountCredits") if key in raw]
        if not amounts or len(set(amounts)) != 1 or amounts[0] <= 0:
            raise InvalidRequest()
        payload["quoteAmount"] = amounts[0]
    if operation == "sell":
        percent = finite_number(raw.get("positionPercent"))
        if percent not in (25, 50, 75, 100):
            raise InvalidRequest()
        payload["positionPercent"] = int(percent)
    return ids[0], payload


def query_filters(args, market_service, allowed=("symbol", "source", "limit"), default_limit=50):
    if set(args) - set(allowed) or any(len(args.getlist(key)) != 1 for key in args):
        raise InvalidRequest()
    result = {}
    if "limit" in allowed:
        value = args.get("limit", str(default_limit))
        if not re.fullmatch(r"[0-9]{1,4}", value) or not 1 <= int(value) <= 5000:
            raise InvalidRequest()
        result["limit"] = int(value)
    if "symbol" in args:
        result["symbol"] = canonical_symbol(args["symbol"], market_service)
    if "source" in args:
        if args["source"] not in ("manual", "jev"):
            raise InvalidRequest()
        result["source"] = args["source"]
    if "sessionId" in args:
        if not RESOURCE_ID.fullmatch(args["sessionId"]):
            raise InvalidRequest()
        result["session_id"] = args["sessionId"]
    return result


def _jev_failure(code):
    return {"ok": False, "valid": False, "errorCode": code}


def _jev_result(result):
    if not isinstance(result, dict):
        return _jev_failure("invalid_decision_output")
    valid = JevDecisionAdapter.validate_output(result)
    code = result.get("errorCode")
    if result.get("ok") is True:
        code = None if result.get("valid") is True and valid["valid"] else "invalid_decision_output"
    elif code not in ("jev_timeout", "invalid_decision_output"):
        code = "jev_unavailable"
    model = result.get("model")
    if not isinstance(model, str) or not re.fullmatch(r"[A-Za-z0-9_.:/-]{1,120}", model):
        model = None
    latency = result.get("latencyMs")
    try:
        latency = finite_number(latency) if latency is not None else None
    except InvalidRequest:
        latency = None
    return {"ok": code is None, "valid": code is None, "action": valid.get("action"),
            "confidence": valid.get("confidence"), "model": model,
            "latencyMs": latency if latency is None or latency >= 0 else None, "errorCode": code}


class DemoExecution:
    def __init__(self, ledger, market_service, asset_modes, adapter, context_builder):
        self.ledger = ledger
        self.market_service = market_service
        self.asset_modes = asset_modes
        self.adapter = adapter
        self.context_builder = context_builder

    def snapshots(self, symbols=()):
        requested = list(symbols)
        for position in self.ledger.latest_state()["positions"]:
            try:
                requested.append(canonical_symbol(position.get("symbol"), self.market_service))
            except InvalidRequest:
                # Legacy holdings without a supported market retain unavailable valuations.
                continue
        requested = list(dict.fromkeys(requested))
        if not requested:
            return {}
        try:
            return self.market_service.decision_snapshots(requested, "1m", 40)
        except Exception:
            return {}

    def portfolio(self):
        return self.ledger.summary(self.snapshots())

    def _prepared(self, symbol, markets):
        return {"market": markets.get(symbol) or {}, "markets": markets,
                "assetMode": self.asset_modes.get_mode(symbol) if symbol else None,
                "jev": None, "context": {}}

    def _context(self, prepared, portfolio):
        status = price_status(prepared["market"])["marketDataStatus"]
        if status != "fresh":
            prepared["errorCode"] = "stale_market_data" if status == "stale" else "market_unavailable"
            return
        prepared["context"] = self.context_builder(prepared["market"], portfolio)

    def prepare(self, operation, payload):
        symbol = payload.get("symbol")
        markets = self.snapshots([symbol] if symbol else [])
        prepared = self._prepared(symbol, markets)
        if operation == "decision":
            self._context(prepared, self.ledger.summary(markets))
            if "errorCode" not in prepared:
                try:
                    prepared["jev"] = _jev_result(self.adapter.decide(prepared["context"]))
                except (TimeoutError, Timeout):
                    prepared["jev"] = _jev_failure("jev_timeout")
                except Exception:
                    prepared["jev"] = _jev_failure("jev_unavailable")
        return prepared

    def execute(self, operation, raw):
        request_id, payload = normalize_request(operation, raw, self.market_service)
        # The ledger closes its reservation transaction before invoking prepare.
        return self.ledger.execute(request_id, operation, payload, lambda: self.prepare(operation, payload))

    def _batch_outputs(self, contexts):
        try:
            result = self.adapter.decide_many(contexts)
        except (TimeoutError, Timeout):
            result = _jev_failure("jev_timeout")
        except Exception:
            result = _jev_failure("jev_unavailable")
        symbols = [context["symbol"] for context in contexts]
        if not isinstance(result, dict) or result.get("ok") is not True or result.get("valid") is not True:
            return {symbol: _jev_result(result) for symbol in symbols}
        invalid = _jev_result({**result, "ok": False, "valid": False, "errorCode": "invalid_decision_output"})
        decisions = result.get("decisions")
        outputs = {}
        try:
            if not isinstance(decisions, list):
                raise InvalidRequest()
            for item in decisions:
                if not isinstance(item, dict):
                    raise InvalidRequest()
                symbol = canonical_symbol(item.get("symbol"), self.market_service)
                if symbol not in symbols or symbol in outputs:
                    raise InvalidRequest()
                outputs[symbol] = _jev_result(item)
        except InvalidRequest:
            return {symbol: invalid for symbol in symbols}
        if set(outputs) != set(symbols) or any(not item["ok"] or not item["valid"] for item in outputs.values()):
            return {symbol: invalid for symbol in symbols}
        return outputs

    def execute_batch(self, symbols):
        started = time.perf_counter()
        requested = list(dict.fromkeys(canonical_symbol(symbol, self.market_service) for symbol in symbols))
        reserved, results, prepared = {}, {}, {}
        markets = {}
        preparation_failed = False
        try:
            # All attempts exist durably before any market or adapter calls.
            for symbol in requested:
                payload = {"symbol": symbol, "source": "jev"}
                op, reused = self.ledger.reserve(str(uuid4()), "decision", payload)
                if reused is not None:
                    results[symbol] = reused
                else:
                    reserved[symbol] = (op, payload)
            if reserved:
                markets = self.snapshots(reserved)
                portfolio = self.ledger.summary(markets)
                contexts = []
                for symbol in reserved:
                    try:
                        item = self._prepared(symbol, markets)
                        prepared[symbol] = item
                        self._context(item, portfolio)
                        if "errorCode" not in item:
                            contexts.append(item["context"])
                    except Exception:
                        prepared[symbol] = {"errorCode": "market_unavailable", "markets": markets}
                if contexts:
                    outputs = self._batch_outputs(contexts)
                    for context in contexts:
                        prepared[context["symbol"]]["jev"] = outputs[context["symbol"]]
        except Exception:
            preparation_failed = True
            for symbol in reserved:
                prepared[symbol] = {"errorCode": "trade_execution_failed", "markets": markets}
        finally:
            # Also finalize market failures and preparation exceptions; never drop a reserved attempt.
            priority = {"SELL": 0, "HOLD": 1, "BUY": 2}
            ordered = sorted(reserved, key=lambda symbol: priority.get(
                (prepared.get(symbol, {}).get("jev") or {}).get("action"), 3))
            for symbol in ordered:
                op, payload = reserved[symbol]
                item = prepared.get(symbol, {"errorCode": "trade_execution_failed", "markets": markets})
                try:
                    results[symbol] = self.ledger.finish(op, payload, item)
                except Exception:
                    # A storage outage leaves the durable reservation recoverable by request ID.
                    results[symbol] = (safe_envelope({"symbol": symbol, "clientRequestId": op["request_id"],
                        "operationId": op["operation_id"], "status": "pending", "realOrderSent": False},
                        "trade_execution_failed", op["request_id"]), 503)
        items = [results[symbol][0] for symbol in requested if symbol in results]
        success = not preparation_failed and any(item.get("ok") for item in items)
        latencies = [(item.get("jev") or {}).get("latencyMs") for item in prepared.values()]
        data = {"status": "completed" if success else "failed", "symbols": requested,
                "decisionCount": sum(bool(item.get("decision")) for item in items), "results": items,
                "cycleLatencyMs": int((time.perf_counter() - started) * 1000),
                "jevLatencyMs": max((value for value in latencies if value is not None), default=None),
                "realOrderSent": False}
        code = None if success else 'trade_execution_failed' if preparation_failed else next(
            (item.get("errorCode") for item in items if item.get("errorCode")), "invalid_request")
        status = 503 if preparation_failed else 200 if success else max((status for _, status in results.values()), default=400)
        return safe_envelope(data, code), status
