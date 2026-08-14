# E.D.I.T.H Phase 0 Baseline

Date: 2026-08-14

## Purpose

This document records the current repository safety and verification baseline before deeper E.D.I.T.H core, persistence, task-engine, planner, executor, verifier, and adapter work begins.

The guiding rule is preservation: existing working AURA / E.D.I.T.H UI, chat, voice, 3D core, tools, tasks, audit records, Mark-L functionality, crypto functionality, settings, memory, and integrations must not be destroyed or broadly rewritten.

## Repository State

- Workspace path: `C:\Users\arday\Desktop\ai programs`
- Git state before Phase 0: no Git repository was present.
- Phase 0 action taken: `git init` was run safely.
- Baseline commit: created after ignore/secret-scope review.
- Baseline commit: current `HEAD` (`chore: establish edith phase 0 baseline`).
- Git identity used for this repository only: `Codex <codex@local>`.

## Source Roots Identified

| Root | Role | Status |
|---|---|---|
| `src/` | React + TypeScript frontend for AURA / E.D.I.T.H | Active |
| `server.ts` | Express backend and API/tool execution layer | Active |
| `src-tauri/` | Tauri desktop packaging | Active / packaging layer |
| `Mark-L-main/` | Python Gemini Live voice assistant and OS/browser/file/screen actions | Legacy capability provider |
| `crypto/` | Crypto paper-trading agent with Flask dashboard and SQLite state | Separate subsystem |
| `.edith/` | Runtime task/audit state | Runtime data, ignored |
| `dist/` | Generated frontend/backend build output | Generated, ignored |
| `node_modules/` | Installed Node dependencies | Generated, ignored |
| `crypto/.venv/` | Python virtual environment for crypto tests/runtime | Local environment, ignored |

## Package Managers and Environments

| Area | Evidence | Notes |
|---|---|---|
| Node app | `package.json`, `package-lock.json`, `bun.lock` | npm scripts are authoritative for current build/lint. Bun lock exists but npm is used. |
| Tauri/Rust | `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json` | Tauri 2 package target exists. |
| Crypto Python | `crypto/requirements.txt`, `crypto/.venv/` | Tests pass with `crypto/.venv/Scripts/python.exe`. |
| Mark-L Python | `Mark-L-main/requirements.txt` | No dedicated automated test was found. |

## Frontend / Backend Boundary

- Frontend is under `src/`.
- Backend is `server.ts`.
- Frontend calls backend endpoints such as `/api/chat`, `/api/health`, `/api/tools/execute`, `/api/edith/tasks`, `/api/edith/tools`, and `/api/ollama/models`.
- Frontend still stores UI and user state in localStorage.
- Backend owns the EDITH tool registry, task endpoints, audit reading, Ollama/Gemini/mock chat routing, and selected tool execution.

## Ignore Policy Updated

`.gitignore` was expanded to ignore:

- Node generated output: `node_modules/`, `dist/`, `coverage/`
- Runtime data: `data/`, `logs/`, `.edith/`, `.aura_monitors.json`
- Local DBs: `*.db`, `*.sqlite`, `*.sqlite3`
- Python generated/local env: `__pycache__/`, `*.pyc`, `.venv/`, `venv/`, `crypto/.venv/`, pytest/mypy/ruff caches
- Secrets and generated credentials: `.env*` except `.env.example`, `Mark-L-main/config/api_keys.json`, `Mark-L-main/memory/api_keys.json`, `Mark-L-main/config/certs/*.key`, `Mark-L-main/config/certs/*.crt`
- Tauri generated output: `src-tauri/target/`, `src-tauri/gen/`

Ignored scope was checked with `git status --ignored --short`. Important source roots remain visible as untracked source.

## Verification Commands

### Frontend / Backend Build

Command:

```bash
npm run build
```

Result: PASS

Notes:

- Vite build completed.
- Express backend bundled to `dist/server.cjs`.
- Existing Rollup chunk-size warning remains: JS chunk is larger than 500 kB after minification. This is a warning, not a failing baseline condition.

### TypeScript Check

Command:

```bash
npm run lint
```

Result: PASS

Notes:

- This script runs `tsc --noEmit`.
- No current TypeScript errors.

### Crypto Test with System Python

Command:

```bash
python crypto/test_modules.py
```

Result: FAIL

Reason:

- System Python is missing crypto dependencies:
  - `ccxt`
  - `pandas`
  - `feedparser`
  - `flask`

This is an environment failure, not evidence that the crypto code itself is broken.

### Crypto Test with Project Virtual Environment

Command:

```bash
crypto/.venv/Scripts/python.exe crypto/test_modules.py
```

Result: PASS

Notes:

- Market data fetch succeeded.
- Technical analysis succeeded.
- News collection succeeded.
- Risk manager checks succeeded.
- Paper trading engine checks succeeded.
- LLM decision engine initialized; Ollama call was unavailable but the test still returned a HOLD decision and passed.
- Flask dashboard endpoint checks passed.

Important side effect:

- The crypto integration test mutates local paper-trading SQLite/runtime state under ignored `crypto/data/`.

## Current Test Coverage Gaps

- No frontend unit test runner is configured.
- No Playwright config is committed, although Playwright is installed and was used manually for screenshots earlier.
- No Mark-L automated test suite was found.
- Tauri/Rust build was not run in this baseline pass.
- No security regression tests exist yet for tool permissions, path validation, prompt injection, or high-risk gates.

## Forensics Highlights

### localStorage Usage

Frontend localStorage remains heavily used for:

- settings
- sessions
- code chat session
- memories
- tool logs
- integrations
- tool UI state

Relevant source: `src/lib/storage.ts`, `src/App.tsx`.

### Backend Runtime File I/O

Backend reads/writes local runtime files in:

- `server.ts`
- `src/edith/taskStore.ts`
- `src/edith/audit.ts`

This should be migrated behind a persistence interface and later SQLite.

### Unsafe / High-Risk Patterns Found

The following categories exist and need careful adapter/gate treatment:

- `server.ts` uses `exec` in some browser/open paths.
- `src/edith/serverRegistry.ts` uses `spawn` for URL opening and Python module execution.
- `src/edith/serverRegistry.ts` uses dynamic import via `new Function`.
- Mark-L contains many `subprocess` calls, some `shell=True`, OS shutdown/reboot actions, desktop control, file deletion/move/copy paths, and token/API-key JSON config handling.
- Mark-L desktop action module contains generated code execution paths guarded by prompts but still security-sensitive.
- Crypto tests use live network and mutate local paper-trading state.

## Environment Variables and Secrets

Known current environment/config surfaces:

- `.env.example` exists and is allowed.
- `.env*` files are ignored except `.env.example`.
- `GEMINI_API_KEY` is read by AURA backend when present.
- Mark-L uses `config/api_keys.json`; this is ignored.
- TTS endpoint accepts API keys from request body and does not persist them server-side in `server.ts`.
- Integration settings in frontend mention local IndexedDB/LocalStorage token storage; this should be moved to safer storage later.

## Baseline Risk Summary

| Risk | Severity | Current Mitigation | Needed Next |
|---|---:|---|---|
| Baseline commit freshness | Low | Baseline commit exists at current `HEAD` | Keep future work in small reviewable commits |
| localStorage operational state | Medium/High | Works today | SQLite persistence layer |
| Frontend/backend tool metadata drift | High | Backend registry exists | Make backend authoritative |
| Mark-L unrestricted OS capabilities | High | Not directly unified yet | Permission-gated adapters only |
| High-risk tools | High | Disabled by default using `EDITH_ENABLE_HIGH_RISK_TOOLS=true` gate | Stronger backend permission model |
| Crypto live-network tests | Medium | Separate subsystem, venv required | Mark as integration tests and isolate state |
| Secrets in legacy Mark-L config pattern | High | Secret files ignored | Move to safer secrets management |

## Immediate Safe Next Steps

1. Create `docs/ARCHITECTURE_SNAPSHOT.md` with the required A-H deliverables.
2. Introduce persistence interfaces before adding SQLite implementation.
3. Add a backend registry metadata endpoint that can replace frontend `DEFAULT_TOOLS`.
4. Add tests around permission denial and high-risk gate behavior before expanding autonomy.
