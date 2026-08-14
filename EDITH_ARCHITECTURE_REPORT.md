# E.D.I.T.H. Repository Architecture Report

Date: 2026-08-13

## A. Current Architecture

The workspace currently contains three assistant-related systems rather than one unified E.D.I.T.H. application.

- `src/`, `server.ts`, `src-tauri/`: AURA, a React + Vite dashboard with an Express backend and optional Tauri packaging. It supports chat through Ollama, Gemini, or a mock fallback, browser Web Speech STT/TTS, local browser storage for sessions/memory/settings, and an automation panel.
- `Mark-L-main/`: a Python Gemini Live voice assistant with many OS, browser, screen, file, reminder, and proactive action modules. It has its own PyQt UI, dashboard server, JSON memory/config, and API-key handling.
- `crypto/`: an autonomous paper-trading agent with SQLite state, market data, technical analysis, risk management, Ollama decisioning, and Flask dashboard.

There is no Git repository initialized in this workspace. `node_modules/` and generated/runtime files are committed or copied into the project folder, which makes discovery noisy.

## B. Capability Matrix

| Capability | Current status | Main locations |
|---|---|---|
| Chat UI | PARTIAL | `src/App.tsx`, `src/components/chat/ChatPanel.tsx` |
| LLM provider abstraction | PARTIAL | `server.ts`, `Mark-L-main/core/llm_client.py` |
| Local Ollama chat | PARTIAL | `server.ts` |
| Gemini integration | PARTIAL | `server.ts`, `Mark-L-main/` actions |
| Structured task model | MISSING | No durable task entity found |
| Planning engine | PROTOTYPE | `Mark-L-main/main.py`, `Mark-L-main/actions/dev_agent.py` |
| Execution engine | PROTOTYPE | `server.ts` tool switch, Mark-L action modules |
| Tool registry | PARTIAL | `src/lib/storage.ts` frontend metadata only |
| Permission/risk model | PARTIAL | Tool permissions and confirmation flags in UI; no backend enforcement layer |
| Audit log | PARTIAL | Frontend `ToolExecutionLog` in localStorage only |
| Persistent memory | PARTIAL | Browser localStorage, Mark-L JSON memory, crypto SQLite |
| Context engine | PROTOTYPE | Prompt assembly in `server.ts`; Mark-L prompt files |
| Voice | PARTIAL | Browser Web Speech in AURA, richer Mark-L audio pipeline |
| Vision/screen analysis | PARTIAL | `Mark-L-main/actions/screen_processor.py`; AURA exposes a tool wrapper |
| Browser/computer control | PARTIAL/SECURITY RISK | Mark-L actions and `server.ts` wrappers |
| Trading | PARTIAL | `crypto/`, paper trading only |
| Dashboard | PARTIAL | AURA UI, Mark-L dashboard, crypto dashboard |
| Scheduler/reminders | PARTIAL | AURA tool, `Mark-L-main/actions/reminder.py` |
| Proactive behavior | PROTOTYPE | Mark-L proactive/background monitor |
| Security controls | PARTIAL/SECURITY RISK | scattered confirmations; broad subprocess usage |
| Tests | BROKEN/PARTIAL | `npm run lint` failed before fixes; `crypto/test_modules.py` had path/exit-code issues |

## C. Gap Analysis

The largest gap is not a missing flashy feature; it is the absence of a central durable core. The current systems duplicate concepts such as memory, tools, dashboards, providers, and execution without a shared task state, permission gate, audit trail, or typed tool contract.

Key gaps:

- No persisted `Task` model for long-running work, dependencies, checkpoints, or restart recovery.
- No backend-enforced permission/risk layer; frontend confirmation can be bypassed by direct API calls.
- No central tool registry with schemas, risk levels, timeouts, health checks, dry-run, and rollback metadata.
- No unified event/audit store across AURA, Mark-L, and crypto.
- Secrets are handled inconsistently: environment variables in AURA, JSON config in Mark-L, and local files.
- Dangerous operations exist in Mark-L modules and some `server.ts` paths through broad `subprocess`/`exec` usage.
- Tests and type checks were not clean at baseline.

## D. Proposed Target Architecture

E.D.I.T.H. should evolve by adding a thin durable core around the existing systems:

1. `edith-core`: typed task, tool, permission, audit, provider, and event contracts.
2. `edith-server`: Express API that enforces schemas and permissions before invoking adapters.
3. `tool-adapters`: wrappers for AURA built-ins, selected Mark-L actions, and crypto agent operations.
4. `persistence`: SQLite for task state, audit events, tool runs, provider telemetry, and memory indexes.
5. `ui`: existing AURA dashboard extended to show tasks, tool health, audit logs, and kill switch state.

The existing Mark-L and crypto systems should be integrated behind adapters first, not rewritten.

## E. Dependency Recommendations

- Use TypeScript interfaces and a runtime validator such as Zod for core API and tool schemas.
- Use SQLite for the first durable task/audit store because the project already uses SQLite in `crypto` and the system is local-first.
- Keep Ollama for local privacy-preserving models; keep Gemini as optional cloud fallback behind a provider interface.
- Use existing OS-native scheduler modules from Mark-L only through a permission-gated adapter.
- For future browser automation, prefer Playwright over raw browser subprocess calls when actual page interaction is needed.
- For observability, start with structured JSON logs and persisted audit events before adding heavier tracing.

## F. Risk Analysis

- Security: raw command execution and desktop automation are high risk without backend validation, path allowlists, and explicit authorization.
- Privacy: localStorage memories and integration tokens are easy to inspect; sensitive data needs classification and better storage.
- Reliability: no durable task engine means long tasks cannot resume safely after restart.
- Financial: trading is paper-only now, which is good; any live trading must stay blocked behind a separate critical-risk policy.
- Dependency: Mark-L license is CC BY-NC 4.0, while AURA README says Apache-2.0; this must be resolved before redistribution.
- Architecture: three separate assistants can drift unless a shared contract layer is introduced.

## G. Development Roadmap

1. Phase 0: stabilize repo hygiene, tests, type checks, and documentation.
2. Phase 1: add typed E.D.I.T.H. core contracts for tasks, tools, permissions, audit events, and providers.
3. Phase 2: implement backend tool registry and permission enforcement; migrate AURA tool execution to it.
4. Phase 3: add SQLite persistence for tasks, audit logs, tool runs, and memory metadata.
5. Phase 4: wrap selected Mark-L capabilities as permission-gated adapters.
6. Phase 5: integrate crypto dashboard/status as read-only first; keep trading paper-only.
7. Phase 6: extend UI with task dashboard, kill switch, tool health, and audit views.
8. Phase 7: add recovery, checkpointing, and long-running task execution.

## H. Immediate Safe Improvements

Completed in this first pass:

- Fixed TypeScript promise response typing in async tool paths.
- Typed automation category filtering to satisfy `tsc`.
- Typed Vite config return value.
- Fixed `crypto/test_modules.py` to run from its own directory, import `crypto/src`, and return a failing exit code when tests fail.
- Added the first E.D.I.T.H. core contracts, backend tool registry, permission check, and JSONL audit log.
- Migrated the read-only `system_monitor` tool through the E.D.I.T.H. registry while leaving legacy tools intact.
- Added an external AI skill catalog covering browser-use, Playwright MCP, Open Interpreter, OpenHands, Stagehand, Firecrawl, Crawl4AI, Skyvern, Mem0, and Langfuse with risk-aware integration plans.
- Added first registry-native browser skills: `browser_open`, `browser_search`, and `ai_skill_catalog`.
- Added high-risk EDITH skill registrations for `browser_use_agent`, `open_interpreter_agent`, and `computer_control_agent`. They are visible in the UI and registry, require confirmation, and are blocked unless the server is started with `EDITH_ENABLE_HIGH_RISK_TOOLS=true`.

Recommended next safe step:

- Add SQLite persistence for tasks/audit/tool runs, then migrate one file-read tool behind path validation and the same permission gate.
