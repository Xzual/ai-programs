# E.D.I.T.H Model Router Foundation

Date: 2026-08-14

## Purpose

This document records the first ModelRouter foundation. EDITH now has a small routing service that decides provider fallback order without taking over model execution.

The existing chat behavior is preserved:

```text
ollama -> gemini -> mock
gemini -> mock
mock -> mock
```

## Added Component

| File | Role |
|---|---|
| `src/edith/modelRouter.ts` | Capability-aware provider route planning |
| `scripts/test-edith-model-router.ts` | Regression coverage for fallback order and privacy routing |

## Backend Endpoint

```text
GET /api/edith/models/route
```

The endpoint returns the selected provider, candidate providers, fallback order, provider health hints, privacy mode, capabilities, and rationale.

## Current Behavior

ModelRouter supports:

- requested provider normalization
- Ollama/Gemini/mock fallback ordering
- local-first routing
- offline-only routing that excludes cloud providers
- provider health hints
- modality and task-type capability hints
- selected provider rationale

It does not yet execute LLM calls. The existing chat endpoint still owns execution, streaming, and provider-specific request formatting.

## Verification

Commands:

```bash
npm run test:edith-model-router
npm run test:edith-intent
npm run lint
npm run build
```

Regression scenarios:

- Ollama keeps `ollama -> gemini -> mock`
- Gemini keeps `gemini -> mock`
- Mock stays mock-only
- Offline-only excludes Gemini
- Unavailable Gemini falls back to mock

Runtime smoke:

| Check | Result |
|---|---|
| Production server on `PORT=3111` | Started successfully |
| `GET /api/edith/models/route?provider=ollama&model=llama3.2` | Returned `ollama -> gemini -> mock` |
| `GET /api/edith/models/route?provider=gemini&privacy=offline_only` | Returned `ollama -> mock` and excluded Gemini |

## Remaining Work

1. Replace chat inline provider execution with provider adapters.
2. Add real provider health cache instead of request-local hints.
3. Add routing by task type for Planner, Verifier, Coding, Vision, and Voice.
4. Track latency, failures, and selected route in audit/metrics.
5. Respect user privacy settings from persisted server-side settings.
