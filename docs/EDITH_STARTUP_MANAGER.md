# E.D.I.T.H. Startup Manager

## Commands

Normal browser development:

```bash
npm run dev
```

Full local stack:

```bash
npm run edith:dev:full
```

Safe development without crypto autostart:

```bash
npm run edith:dev:safe
```

Crypto service only:

```bash
npm run crypto:observer
```

Service status check:

```bash
npm run services:status
```

## What Full Startup Starts

`npm run edith:dev:full` starts the main E.D.I.T.H. Express/Vite dev server on `http://localhost:3000`, checks provider health, checks Ollama at `http://localhost:11434`, checks the Obsidian vault, and starts the local crypto service if it is not already responding at `http://localhost:5000`.

The startup manager waits for real health responses before reporting a service as online. If a service does not respond, it prints an offline or degraded status and keeps E.D.I.T.H. running.

## Crypto Safety Guarantees

The full startup manager and EDITH-managed crypto startup force:

```bash
CRYPTO_MODE=OBSERVER_ONLY
TRADING_MODE=OBSERVER_ONLY
CRYPTO_TRADING_ENABLED=false
CRYPTO_PAPER_TRADING_ENABLED=false
CRYPTO_LIVE_TRADING_ENABLED=false
ENABLE_LIVE_TRADING=false
BINANCE_TRADING_ENABLED=false
```

Full startup does not enable live trading, does not place Binance orders, does not execute BUY/SELL actions, does not enable paper trading by default, does not run arbitrary shell commands, and does not expose secrets.

## Crypto Duplicate Handling

Before spawning Python, the startup manager checks:

```text
http://localhost:5000/api/health
http://localhost:5000/health
```

If either endpoint is healthy, it marks crypto as `already_running`, does not spawn another process, and will not stop that external process on shutdown.

## Python Detection

Startup uses this fixed fallback order:

1. `crypto/.venv/Scripts/python.exe`
2. `.venv/Scripts/python.exe`
3. `python`
4. `py`

The selected executable is printed in the terminal. No frontend input can change the command.

## Obsidian

Default vault path:

```text
D:\EDİTH\EDİTH
```

The uppercase Turkish `İ` is intentional and must be preserved. The crypto learning folder is:

```text
D:\EDİTH\EDİTH\Trading\Crypto Market Learning
```

The backend status endpoints report whether the vault path is configured, readable, and writable. They do not dump vault contents.

## Status APIs

Unified status:

```text
GET /api/status
```

Crypto wrappers:

```text
GET  /api/crypto/status
GET  /api/crypto/health
POST /api/crypto/start-service
POST /api/crypto/stop-service
POST /api/crypto/start-observer
POST /api/crypto/stop-observer
```

Existing compatibility endpoints under `/api/edith/crypto/*` remain available.

## Shutdown

Press `Ctrl+C` in the startup manager terminal. It stops only child processes that the startup manager created:

- main E.D.I.T.H. dev child
- crypto child, only if the manager spawned it

If crypto was already running before startup, the manager leaves it running.

## Troubleshooting

Crypto service not running:
Run `npm run services:status`. If Python is missing, create or repair `crypto/.venv`, then retry `npm run edith:dev:full`.

Port `5000` busy:
If `/api/health` responds, the manager treats the service as already running. If another process owns the port without serving crypto health, stop that process manually.

Ollama offline:
Start Ollama separately and verify `http://localhost:11434/api/tags`. E.D.I.T.H. reports Ollama as offline instead of crashing.

Obsidian not found:
Confirm the vault path is exactly `D:\EDİTH\EDİTH`, including the Turkish `İ`, or set `OBSIDIAN_VAULT_PATH`.

Windows path issue:
Quote paths in `.env` when they contain backslashes. Do not replace `EDİTH` with `EDITH` unless your actual folder name uses ASCII.

Secrets:
Do not commit real Gemini keys, Binance keys, API secrets, or tokens. Status output and API responses are designed not to include secret values.
