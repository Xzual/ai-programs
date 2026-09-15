# EDITH AI Provider System

## Architecture

EDITH uses one backend provider registry for Gemini, Ollama, and Mock. Provider health, model lists, chat routing, and status endpoints all read from the registry and the deterministic provider router in `server/providers/router.ts`.

Providers expose normalized metadata, health, model listing, and generation/streaming methods. Health separates:

- `configured`: required backend config exists.
- `available`: the provider can serve a request.
- `healthy`: the latest health check succeeded.
- `modelAvailable`: the selected/requested model is valid for the provider.

## Environment

```env
GEMINI_API_KEY=
GEMINI_DEFAULT_MODEL=gemini-3.6-flash
GEMINI_HEALTH_TIMEOUT_MS=15000
GEMINI_TIMEOUT_MS=30000

OLLAMA_HOST=http://localhost:11434
OLLAMA_DEFAULT_MODEL=
OLLAMA_HEALTH_TIMEOUT_MS=3000
OLLAMA_FIRST_TOKEN_TIMEOUT_MS=15000
OLLAMA_GENERATION_TIMEOUT_MS=60000

AI_PROVIDER_MODE=auto
AI_FALLBACK_ENABLED=true
AI_DEFAULT_PROVIDER=ollama
```

## Gemini

Gemini reads only `GEMINI_API_KEY` from the backend environment. Missing, empty, placeholder, dummy, or example values return `configuration_required`. Key-shaped synthetic invalid values return `invalid_api_key`.

Invalid keys return:

```json
{
  "configured": true,
  "available": false,
  "status": "invalid_api_key",
  "errorCode": "invalid_api_key"
}
```

Keys are never returned by API responses and are not logged. Repeated invalid-key logs are throttled.

## Ollama

Ollama is detected through `GET /api/tags` on `OLLAMA_HOST`. It is `available` only when the server responds and at least one local model is listed. A requested manual model must exist locally; otherwise routing reports `MODEL_NOT_AVAILABLE` or falls back when fallback is enabled.

## Mock Fallback

Mock is always explicit:

- `resolvedProvider: "mock"`
- `resolvedModel: "edith-mock"`
- `fallbackUsed: true` when another provider was requested
- `providerStatus: "degraded"` in chat fallback metadata

Mock never pretends to be Gemini or Ollama.

## Routing

Manual mode uses the requested provider only when the provider is available and the model is valid. If fallback is enabled, EDITH falls back through the router and reports both requested and resolved provider/model metadata.

Auto mode prefers:

1. Healthy Ollama with local models
2. Available Gemini
3. Mock degraded fallback

Unavailable or invalid Gemini never wins over healthy Ollama.

## API Contract

- `GET /api/providers`: provider metadata plus live health summary.
- `GET /api/providers/health`: live provider health.
- `GET /api/models`: valid provider models with availability metadata.
- `GET /api/ollama/models`: registry-backed local Ollama models.
- `GET /api/health`: backend health plus provider summary.
- `GET /api/status`: full EDITH status with provider summary.
- `POST /api/chat`: registry/router-backed SSE chat.

Every chat request emits a final SSE `done` event:

```json
{
  "type": "done",
  "completed": true,
  "finalState": "completed",
  "requestedProvider": "ollama",
  "resolvedProvider": "ollama",
  "fallbackUsed": false,
  "errorCode": null
}
```

Failure, timeout, and fallback paths also emit `done` before closing the stream.

## Troubleshooting

- `configuration_required`: set `GEMINI_API_KEY` in the backend environment.
- `invalid_api_key`: the backend key was rejected by Gemini; replace it and restart the backend.
- `offline`: Ollama is not reachable at `OLLAMA_HOST`.
- `MODEL_NOT_AVAILABLE`: the requested Ollama model is not installed locally.
- Chat stream stuck: inspect the final `done` event; provider timeout and fallback metadata should identify the path.
- Mock fallback used: all real providers were unavailable or fallback was explicitly selected.

## Security

API keys are backend-only. EDITH does not return key values in `/api/providers`, `/api/providers/health`, `/api/models`, `/api/health`, `/api/status`, or `/api/chat`, and provider logs include only provider/model/status metadata.
