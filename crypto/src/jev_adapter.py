"""Backend-only, decision-only Jev API transport.

The API key is read from the process environment and is never included in
status payloads, errors, logs, database records, or model input.
"""
import json
import math
import os
import re
import time
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from threading import Lock
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

import requests


ALLOWED_JEV_ACTIONS = {"BUY", "SELL", "HOLD"}
DEFAULT_JEV_API_URL = "https://api.typesafe.ai"
DEFAULT_JEV_MODEL = "jev-1.13.0"
REQUIRED_ENV = ("JEV_API_KEY",)


class JevDecisionAdapter(ABC):
    @abstractmethod
    def status(self) -> Dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def decide(self, context: Dict[str, Any]) -> Dict[str, Any]:
        raise NotImplementedError

    def decide_many(self, contexts: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Safe compatibility fallback for providers without native batch questions."""
        started = time.perf_counter()
        decisions = []
        for context in contexts:
            result = self.decide(context)
            decisions.append({"symbol": context.get("symbol"), **result})
        latency_ms = int((time.perf_counter() - started) * 1000)
        valid = bool(decisions) and all(item.get("ok") and item.get("valid") for item in decisions)
        return {
            "ok": valid,
            "valid": valid,
            "decisions": decisions,
            "latencyMs": latency_ms,
            "model": decisions[0].get("model") if decisions else None,
            "status": "ok" if valid else "error",
            "errorCode": None if valid else "batch_decision_failed",
            "safeMessage": "Jev returned structured decisions." if valid else "One or more Jev decisions failed validation.",
            "realOrderSent": False,
        }

    @staticmethod
    def validate_output(output: Any, model: str = "jev", latency_ms: Optional[int] = None) -> Dict[str, Any]:
        if isinstance(output, str):
            output = {"action": output}
        if not isinstance(output, dict):
            output = {}
        actions = [output[key] for key in ("action", "decision", "label") if key in output]
        action = actions[0].strip().upper() if actions and isinstance(actions[0], str) else None
        if action not in ALLOWED_JEV_ACTIONS or any(
            not isinstance(value, str) or value.strip().upper() != action for value in actions
        ):
            return {
                "valid": False,
                "action": None,
                "confidence": None,
                "model": model,
                "latencyMs": latency_ms,
                "status": "error",
                "errorCode": "invalid_decision_output",
                "safeMessage": "Jev returned an invalid decision. No demo trade was executed.",
            }
        confidence = None
        if output.get("confidence") is not None:
            try:
                if isinstance(output["confidence"], bool):
                    raise ValueError("INVALID_CONFIDENCE")
                confidence = float(output["confidence"])
            except (TypeError, ValueError, OverflowError):
                return {
                    "valid": False,
                    "action": None,
                    "confidence": None,
                    "model": model,
                    "latencyMs": latency_ms,
                    "status": "error",
                    "errorCode": "invalid_decision_output",
                    "safeMessage": "Jev returned an invalid confidence value. No demo trade was executed.",
                }
            if not math.isfinite(confidence) or confidence < 0 or confidence > 1:
                return {
                    "valid": False,
                    "action": None,
                    "confidence": None,
                    "model": model,
                    "latencyMs": latency_ms,
                    "status": "error",
                    "errorCode": "invalid_decision_output",
                    "safeMessage": "Jev confidence must be between 0 and 1. No demo trade was executed.",
                }
        return {
            "valid": True,
            "action": action,
            "confidence": confidence,
            "model": model,
            "latencyMs": latency_ms,
            "status": "ok",
            "errorCode": None,
            "safeMessage": "Jev returned a valid structured decision.",
        }


class UnconfiguredJevAdapter(JevDecisionAdapter):
    def __init__(self, missing: Optional[list] = None):
        self.missing = list(missing or REQUIRED_ENV)

    def status(self) -> Dict[str, Any]:
        model = os.getenv("JEV_MODEL") or DEFAULT_JEV_MODEL
        health = {
            "state": "not_configured",
            "available": False,
            "checkedAt": None,
            "latencyMs": None,
            "errorCode": "config_required",
        }
        configuration = {
            "configured": False,
            "model": model,
            "apiStyle": None,
            "decisionOnly": True,
        }
        return {
            "configured": False,
            "available": False,
            "model": model,
            "status": "config_required",
            "providerStatus": "not_configured",
            "lastLatencyMs": None,
            "lastError": "missing_configuration",
            "errorCode": "config_required",
            "safeMessage": "Jev API is not configured. Add JEV_API_KEY to the backend environment. JEV_API_URL and JEV_MODEL may override the TypeSafe defaults.",
            "missingConfiguration": self.missing,
            "mock": False,
            "decisionOnly": True,
            "allowedActions": sorted(ALLOWED_JEV_ACTIONS),
            "secretExposed": False,
            "configuration": configuration,
            "health": health,
        }

    def decide(self, context: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "ok": False,
            "valid": False,
            "action": None,
            "confidence": None,
            "latencyMs": None,
            "model": os.getenv("JEV_MODEL") or DEFAULT_JEV_MODEL,
            "status": "config_required",
            "errorCode": "config_required",
            "safeMessage": self.status()["safeMessage"],
            "tradeExecuted": False,
            "realOrderSent": False,
        }


class HttpJevAdapter(JevDecisionAdapter):
    """Jev transport supporting native System One and optional gateway formats."""

    def __init__(
        self,
        api_key: str,
        api_url: str,
        model: str,
        api_style: str = "typesafe",
        timeout_seconds: float = 20.0,
        health_ttl_seconds: float = 120.0,
    ):
        self._api_key = api_key
        self.api_url = self._validate_url(api_url)
        self.model = self._safe_model(model, DEFAULT_JEV_MODEL)
        self.api_style = (api_style or "typesafe").strip().lower()
        if self.api_style not in {"typesafe", "openai_chat", "direct"}:
            raise ValueError("UNSUPPORTED_JEV_API_STYLE")
        self.timeout_seconds = max(2.0, min(float(timeout_seconds), 60.0))
        self.health_ttl_seconds = max(1.0, min(float(health_ttl_seconds), 3600.0))
        self._lock = Lock()
        self._request_lock = Lock()
        self._session = requests.Session()
        self._session.headers.update({
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        })
        self._last_latency_ms = None
        self._last_error = None
        self._last_status = "configured"
        self._active_model = self.model
        self._last_checked_at = None
        self._last_checked_monotonic = None

    def _safe_model(self, value: Any, fallback: str) -> str:
        if not isinstance(value, str):
            return fallback
        candidate = value.strip()
        if (self._api_key and self._api_key in candidate) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}", candidate):
            return fallback
        return candidate

    @staticmethod
    def _validate_url(value: str) -> str:
        url = str(value or "").strip().rstrip("/")
        parsed = urlparse(url)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ValueError("INVALID_JEV_API_URL")
        return url

    def _endpoint(self) -> str:
        if self.api_style == "direct":
            return self.api_url
        if self.api_style == "typesafe":
            if self.api_url.endswith(("/systemone", "/decide")):
                return self.api_url
            if self.api_url.endswith("/v1"):
                return f"{self.api_url}/systemone"
            return f"{self.api_url}/v1/systemone"
        if self.api_url.endswith("/chat/completions"):
            return self.api_url
        if self.api_url.endswith("/v1"):
            return f"{self.api_url}/chat/completions"
        return f"{self.api_url}/v1/chat/completions"

    def status(self) -> Dict[str, Any]:
        with self._lock:
            last_latency = self._last_latency_ms
            last_error = self._last_error
            last_status = self._last_status
            active_model = self._active_model
            last_checked_at = self._last_checked_at
            last_checked_monotonic = self._last_checked_monotonic
        age_seconds = None if last_checked_monotonic is None else max(0.0, time.monotonic() - last_checked_monotonic)
        health_fresh = age_seconds is not None and age_seconds <= self.health_ttl_seconds
        if not health_fresh and last_checked_monotonic is not None:
            available = None
            provider_status = "stale"
        else:
            available = True if last_status == "available" else False if last_status == "error" else None
            provider_status = "ready" if available is True else "error" if available is False else "unverified"
        configuration = {
            "configured": True,
            "model": active_model,
            "apiStyle": self.api_style,
            "decisionOnly": True,
        }
        health = {
            "state": provider_status,
            "available": available,
            "checkedAt": last_checked_at,
            "latencyMs": last_latency,
            "errorCode": "health_stale" if provider_status == "stale" else last_error,
        }
        if age_seconds is not None:
            health.update({"ageMs": int(age_seconds * 1000), "fresh": health_fresh})
        last_provider_contact = {
            "state": last_status,
            "available": True if last_status == "available" else False if last_status == "error" else None,
            "checkedAt": last_checked_at,
            "latencyMs": last_latency,
            "errorCode": last_error,
        }
        return {
            "configured": True,
            "available": available,
            "model": active_model,
            "status": provider_status,
            "providerStatus": provider_status,
            "lastLatencyMs": last_latency,
            "lastError": last_error,
            "errorCode": last_error,
            "safeMessage": (
                "Jev API is available."
                if available is True
                else "Jev API is temporarily unavailable."
                if available is False
                else "Jev provider health is stale and must be verified by a new backend request."
                if provider_status == "stale"
                else "Jev adapter is configured but has not been contacted yet."
            ),
            "mock": False,
            "decisionOnly": True,
            "allowedActions": sorted(ALLOWED_JEV_ACTIONS),
            "secretExposed": False,
            "configuration": configuration,
            "health": health,
            "lastProviderContact": last_provider_contact,
        }

    def decide(self, context: Dict[str, Any]) -> Dict[str, Any]:
        compact_context = self._compact_context(context)
        started = time.perf_counter()
        try:
            with self._request_lock:
                response = self._session.post(
                    self._endpoint(),
                    json=self._request_payload(compact_context),
                    timeout=self.timeout_seconds,
                )
            latency_ms = int((time.perf_counter() - started) * 1000)
            if response.status_code < 200 or response.status_code >= 300:
                error_code = self._http_error_code(response.status_code)
                return self._failure(error_code, self._http_safe_message(response.status_code), latency_ms)
            try:
                try:
                    payload = response.json()
                except (ValueError, TypeError, json.JSONDecodeError):
                    payload = response.text
                decision_payload = self._extract_decision_payload(payload)
            except (ValueError, TypeError, json.JSONDecodeError):
                return self._failure("invalid_decision_output", "Jev returned non-JSON or unsupported output. No demo trade was executed.", latency_ms)
            resolved_model = self._safe_model(payload.get("model"), self.model) if isinstance(payload, dict) else self.model
            normalized = self.validate_output(decision_payload, resolved_model, latency_ms)
            if not normalized["valid"]:
                return self._failure(normalized["errorCode"], normalized["safeMessage"], latency_ms)
            self._record_health("available", None, latency_ms, resolved_model)
            return {"ok": True, **normalized, "realOrderSent": False}
        except requests.Timeout:
            latency_ms = int((time.perf_counter() - started) * 1000)
            return self._failure("jev_timeout", "Jev API request timed out. No demo trade was executed.", latency_ms)
        except requests.RequestException:
            latency_ms = int((time.perf_counter() - started) * 1000)
            return self._failure("jev_unavailable", "Jev API is unavailable. No demo trade was executed.", latency_ms)

    def decide_many(self, contexts: List[Dict[str, Any]]) -> Dict[str, Any]:
        if self.api_style != "typesafe":
            return super().decide_many(contexts)

        compact_contexts = [self._compact_context(context) for context in contexts]
        symbols = [str(context.get("symbol") or "").replace("/", "").upper() for context in compact_contexts]
        if not compact_contexts or any(not symbol for symbol in symbols) or len(set(symbols)) != len(symbols):
            return self._batch_failure("invalid_batch_context", "Jev batch context must contain unique symbols.", 0)

        started = time.perf_counter()
        try:
            with self._request_lock:
                response = self._session.post(
                    self._endpoint(),
                    json=self._batch_request_payload(compact_contexts),
                    timeout=self.timeout_seconds,
                )
            latency_ms = int((time.perf_counter() - started) * 1000)
            if response.status_code < 200 or response.status_code >= 300:
                error_code = self._http_error_code(response.status_code)
                return self._batch_failure(error_code, self._http_safe_message(response.status_code), latency_ms)
            try:
                payload = response.json()
                answers = payload.get("answers") if isinstance(payload, dict) else None
                if not isinstance(answers, dict):
                    raise ValueError("INVALID_JEV_BATCH_RESPONSE")
            except (ValueError, TypeError, json.JSONDecodeError):
                return self._batch_failure(
                    "invalid_decision_output",
                    "Jev returned non-JSON or unsupported batch output. No demo trade was executed.",
                    latency_ms,
                )

            resolved_model = self._safe_model(payload.get("model"), self.model)
            decisions = []
            for symbol in symbols:
                answer = answers.get(f"decision_{symbol}")
                if isinstance(answer, str):
                    answer = {"choice": answer}
                if not isinstance(answer, dict):
                    return self._batch_failure(
                        "invalid_decision_output",
                        "Jev omitted a valid batch decision. No demo trade was executed.",
                        latency_ms,
                    )
                normalized = self.validate_output(
                    {"action": answer.get("choice"), "confidence": answer.get("confidence")},
                    resolved_model,
                    latency_ms,
                )
                if not normalized.get("valid"):
                    return self._batch_failure(normalized["errorCode"], normalized["safeMessage"], latency_ms)
                decisions.append({"symbol": symbol, "ok": True, **normalized, "realOrderSent": False})

            self._record_health("available", None, latency_ms, resolved_model)
            return {
                "ok": True,
                "valid": True,
                "decisions": decisions,
                "latencyMs": latency_ms,
                "model": resolved_model,
                "status": "ok",
                "errorCode": None,
                "safeMessage": f"Jev returned {len(decisions)} structured decisions in one request.",
                "realOrderSent": False,
            }
        except requests.Timeout:
            latency_ms = int((time.perf_counter() - started) * 1000)
            return self._batch_failure("jev_timeout", "Jev API request timed out. No demo trade was executed.", latency_ms)
        except requests.RequestException:
            latency_ms = int((time.perf_counter() - started) * 1000)
            return self._batch_failure("jev_unavailable", "Jev API is unavailable. No demo trade was executed.", latency_ms)

    def _request_payload(self, context: Dict[str, Any]) -> Dict[str, Any]:
        if self.api_style == "typesafe":
            return {
                "model": self.model,
                "state": context,
                "questions": {
                    "decision": {
                        "type": "choice",
                        "instructions": "Choose the safest allowed action for this crypto demo portfolio state.",
                        "criteria": {
                            "BUY": "Open one unleveraged spot demo long only when riskAllowed is true and the state supports an entry.",
                            "SELL": "Close the existing demo long when position is long and exiting is preferable.",
                            "HOLD": "Do not change the demo portfolio when evidence is weak, risk is blocked, or no position should change.",
                        },
                    }
                },
            }
        if self.api_style == "direct":
            return {
                "model": self.model,
                "input": context,
                "allowedActions": ["BUY", "SELL", "HOLD"],
                "responseFormat": "json",
            }
        return {
            "model": self.model,
            "temperature": 0,
            "response_format": {"type": "json_object"},
            "messages": [
                {
                    "role": "system",
                    "content": "Return JSON only. Choose exactly one action: BUY, SELL, or HOLD. Optional confidence must be 0..1. No prose.",
                },
                {"role": "user", "content": json.dumps(context, separators=(",", ":"))},
            ],
        }

    def _batch_request_payload(self, contexts: List[Dict[str, Any]]) -> Dict[str, Any]:
        questions = {}
        for context in contexts:
            symbol = str(context["symbol"]).replace("/", "").upper()
            questions[f"decision_{symbol}"] = {
                "type": "choice",
                "instructions": f"Choose the safest allowed action for {symbol} using only its entry in state.assets and the demo portfolio state.",
                "criteria": {
                    "BUY": f"Open one unleveraged spot demo long in {symbol} only when riskAllowed is true and its market state supports an entry.",
                    "SELL": f"Close the existing {symbol} demo long when position is long and exiting is preferable.",
                    "HOLD": f"Do not change the {symbol} demo position when evidence is weak, risk is blocked, or no position should change.",
                },
            }
        return {
            "model": self.model,
            "state": {"assets": contexts, "mode": "DEMO_ONLY", "realOrdersAllowed": False},
            "questions": questions,
        }

    @staticmethod
    def _compact_context(context: Dict[str, Any]) -> Dict[str, Any]:
        allowed_fields = (
            "symbol", "price", "change24h", "volume24h", "bid", "ask", "spread",
            "trendShort", "trendMedium", "volatility", "position", "cash", "equity",
            "riskAllowed", "allowedActions",
            "marketPriceTimestamp", "inputMarketTimestamp", "marketDataAgeMs", "marketDataStatus",
        )
        return {key: context.get(key) for key in allowed_fields if key in context}

    @classmethod
    def _extract_decision_payload(cls, payload: Any) -> Dict[str, Any]:
        if isinstance(payload, str):
            action = payload.strip().upper()
            if action in ALLOWED_JEV_ACTIONS:
                return {"action": action}
            return cls._parse_json_text(payload)
        if not isinstance(payload, dict):
            raise ValueError("INVALID_JEV_RESPONSE")
        if any(key in payload for key in ("action", "decision", "label")):
            return payload
        answers = payload.get("answers")
        if isinstance(answers, dict):
            decision = answers.get("decision")
            if isinstance(decision, dict) and "choice" in decision:
                return {
                    "action": decision.get("choice"),
                    "confidence": decision.get("confidence"),
                }
        output = payload.get("output")
        if isinstance(output, dict):
            return output
        if isinstance(output, str):
            return cls._parse_json_text(output)
        output_text = payload.get("output_text")
        if isinstance(output_text, str):
            return cls._parse_json_text(output_text)
        choices = payload.get("choices")
        if isinstance(choices, list) and choices:
            message = choices[0].get("message") if isinstance(choices[0], dict) else None
            content = message.get("content") if isinstance(message, dict) else None
            if isinstance(content, dict):
                return content
            if isinstance(content, str):
                return cls._parse_json_text(content)
        raise ValueError("INVALID_JEV_RESPONSE")

    @staticmethod
    def _parse_json_text(value: str) -> Dict[str, Any]:
        text = value.strip()
        if text.startswith("```"):
            lines = text.splitlines()
            text = "\n".join(lines[1:-1]).strip()
            if text.lower().startswith("json"):
                text = text[4:].strip()
        parsed = json.loads(text)
        if isinstance(parsed, str) and parsed.strip().upper() in ALLOWED_JEV_ACTIONS:
            return {"action": parsed.strip().upper()}
        if not isinstance(parsed, dict):
            raise ValueError("INVALID_JEV_RESPONSE")
        return parsed

    def _failure(self, error_code: str, safe_message: str, latency_ms: int) -> Dict[str, Any]:
        self._record_health("error", error_code, latency_ms)
        return {
            "ok": False,
            "valid": False,
            "action": None,
            "confidence": None,
            "latencyMs": latency_ms,
            "model": self.model,
            "status": "error",
            "errorCode": error_code,
            "safeMessage": safe_message,
            "tradeExecuted": False,
            "realOrderSent": False,
        }

    def _batch_failure(self, error_code: str, safe_message: str, latency_ms: int) -> Dict[str, Any]:
        self._record_health("error", error_code, latency_ms)
        return {
            "ok": False,
            "valid": False,
            "decisions": [],
            "latencyMs": latency_ms,
            "model": self.model,
            "status": "error",
            "errorCode": error_code,
            "safeMessage": safe_message,
            "tradeExecuted": False,
            "realOrderSent": False,
        }

    def _record_health(self, status: str, error: Optional[str], latency_ms: int, model: Optional[str] = None):
        with self._lock:
            self._last_status = status
            self._last_error = error
            self._last_latency_ms = latency_ms
            self._last_checked_at = datetime.now(timezone.utc).isoformat()
            self._last_checked_monotonic = time.monotonic()
            if model:
                self._active_model = model

    @staticmethod
    def _http_error_code(status_code: int) -> str:
        if status_code in {401, 403}:
            return "jev_auth_failed"
        if status_code == 429:
            return "jev_rate_limited"
        if status_code >= 500:
            return "jev_upstream_error"
        return "jev_request_rejected"

    @staticmethod
    def _http_safe_message(status_code: int) -> str:
        if status_code in {401, 403}:
            return "Jev authentication failed. Check the backend environment configuration."
        if status_code == 429:
            return "Jev rate limit reached. No demo trade was executed."
        return "Jev rejected the request. No demo trade was executed."


def create_jev_adapter() -> JevDecisionAdapter:
    values = {
        "JEV_API_KEY": str(os.getenv("JEV_API_KEY") or "").strip(),
        "JEV_API_URL": str(os.getenv("JEV_API_URL") or DEFAULT_JEV_API_URL).strip(),
        "JEV_MODEL": str(os.getenv("JEV_MODEL") or DEFAULT_JEV_MODEL).strip(),
    }
    missing = [name for name in REQUIRED_ENV if not values[name]]
    if missing:
        return UnconfiguredJevAdapter(missing)
    try:
        return HttpJevAdapter(
            values["JEV_API_KEY"],
            values["JEV_API_URL"],
            values["JEV_MODEL"],
            os.getenv("JEV_API_STYLE", "typesafe"),
            float(os.getenv("JEV_TIMEOUT_SECONDS", "20")),
            float(os.getenv("JEV_HEALTH_TTL_SECONDS", "120")),
        )
    except (TypeError, ValueError):
        return UnconfiguredJevAdapter(["JEV_API_URL_OR_STYLE_INVALID"])
