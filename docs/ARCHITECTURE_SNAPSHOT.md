# E.D.I.T.H Architecture Snapshot and Phase 1 Plan

Date: 2026-08-14

This document satisfies the required pre-implementation deliverables from the Phase 1 master prompt:

- A. Repository Architecture Report
- B. Capability Matrix
- C. Data Persistence Plan
- D. Core Architecture Plan
- E. Mark-L Integration Plan
- F. Crypto Integration Plan
- G. Security Gap Analysis
- H. Prioritized Implementation Roadmap

## A. Repository Architecture Report

### Current Systems

The workspace contains three assistant-related systems:

1. Main EDITH application
   - React 19 + TypeScript + Vite frontend
   - Express + Node.js backend
   - Ollama / Gemini / mock AI provider flow
   - Voice input/output
   - Memory panel
   - Knowledge Map
   - Automation/tools UI
   - EDITH Ops
   - Integrations panel
   - Settings
   - Three.js/WebGL particle core
   - Typed task model
   - Audit infrastructure
   - Backend EDITH tool registry

2. `Mark-L-main/`
   - Python Gemini Live voice assistant
   - OS actions
   - browser control
   - screen processing
   - file actions
   - reminders
   - proactive modules
   - PyQt UI
   - FastAPI/dashboard surfaces

3. `crypto/`
   - market data
   - technical analysis
   - risk management
   - paper trading
   - Ollama decision engine
   - SQLite state
   - Flask dashboard

### Architectural Assessment

The current EDITH app is a strong local AI dashboard foundation, but it is not yet a durable AI operating layer. The core gaps are persistence, unified tool metadata, orchestration, verification, memory architecture, permission enforcement depth, and adapter boundaries for legacy systems.

The correct evolution path is incremental migration:

```text
Existing EDITH UI
  -> backend-authoritative registry
  -> persistence interfaces
  -> SQLite-backed operational state
  -> EDITH Core services
  -> durable task engine
  -> planner / executor / verifier
  -> adapter-based Mark-L and crypto integration
```

No greenfield rewrite is recommended.

## B. Capability Matrix

| Capability | Status | Evidence / Notes |
|---|---|---|
| Dashboard UI | COMPLETE | Main React routes exist and render. |
| Theme/persona system | COMPLETE | `assistantProfiles.json` and CSS variables drive active themes. |
| 3D particle core | COMPLETE | Three.js component exists; HOMER rendering bug fixed. |
| Chat UI | COMPLETE | Streaming chat panel and voice bar exist. |
| Code Chat | COMPLETE | Separate code-focused session and renderer exist. |
| Ollama provider | PARTIAL | Works when Ollama is available; health/model endpoints exist. |
| Gemini provider | PARTIAL | Optional fallback via `GEMINI_API_KEY`. |
| Mock fallback | COMPLETE | Local mock engine exists for graceful fallback. |
| Voice STT/TTS | PARTIAL | Browser Web Speech works where supported; richer local pipeline not unified. |
| Memory panel | PARTIAL | localStorage memory exists; not Memory V2. |
| Knowledge Map | PARTIAL | Improved visual graph exists; not yet fully persisted relationship introspection. |
| Automation UI | PARTIAL | Frontend tool metadata exists; backend registry is not sole source yet. |
| Backend tool registry | PARTIAL | Registry, permissions, audit exist; tool coverage incomplete. |
| High-risk gate | PARTIAL | Env-gated high-risk tools exist; needs stronger permission model. |
| Task model | PROTOTYPE | Typed task model and JSON storage exist. |
| Durable task execution engine | MISSING | No planner/executor/verifier loop yet. |
| Planner | MISSING | Intent routing exists, not structured planner. |
| Executor | MISSING | Direct tool execution exists; no durable step executor. |
| Verifier | MISSING | No objective-level verification layer. |
| Replanner/recovery | MISSING | No structured failure recovery loop. |
| Agent architecture | PROTOTYPE | Placeholder agent tools exist; no real agent contracts. |
| Mark-L integration | LEGACY / SECURITY RISK | Rich capabilities exist but not permission-gated adapters. |
| Crypto integration | LEGACY / PARTIAL | Separate paper-trading system exists; not integrated with EDITH core. |
| Persistence | PARTIAL | localStorage, JSON task store, JSONL audit; SQLite only in crypto. |
| Observability | PARTIAL | Audit exists; no full correlation/structured run model. |
| Kill switch | MISSING | No backend-enforced emergency stop. |
| Frontend build | COMPLETE | `npm run build` passes. |
| TypeScript check | COMPLETE | `npm run lint` passes. |
| Crypto tests | PARTIAL | Pass with project venv; fail with system Python due missing deps. |
| Mark-L tests | MISSING | No automated test suite found. |

## C. Data Persistence Plan

### Goal

Move operational state from localStorage, `.edith/tasks.json`, and JSONL audit logs into a robust local persistence layer while preserving existing user data.

Preferred default: SQLite.

### Design Principles

- Introduce interfaces before swapping storage.
- Keep compatibility read paths during migration.
- Back up old data before conversion.
- Make migrations repeatable and idempotent.
- Never silently delete user data.
- Keep harmless UI preferences in localStorage temporarily.
- Move sensitive and operational state server-side.

### Initial SQLite Scope

First migration should cover:

- tasks
- task steps
- checkpoints
- audit events
- tool runs
- memories

### Proposed Tables, Iteration 1

| Table | Purpose |
|---|---|
| `tasks` | Durable top-level task records |
| `task_steps` | Planned/executable steps |
| `task_checkpoints` | Restart/recovery checkpoints |
| `task_artifacts` | Files/results produced by tasks |
| `tool_runs` | Normalized tool execution records |
| `audit_events` | Authorization/result trace |
| `memories` | Current user/project memory records |
| `memory_relations` | Links between memories/tasks/artifacts |

### Migration Sources

- `.edith/tasks.json`
- existing audit JSONL file
- localStorage keys:
  - legacy memory key
  - legacy tool-log key
  - legacy chat-session key
  - legacy code-chat-session key

### Compatibility Strategy

1. Add `PersistenceService` interface.
2. Add JSON/localStorage adapters for current behavior.
3. Add SQLite adapter behind same interface.
4. Add migration command/script.
5. Change backend endpoints to read from persistence service.
6. Change frontend to consume backend state for operational entities.

## D. Core Architecture Plan

### Target Loop

```text
User Objective
 -> IntentService
 -> ContextService + MemoryService
 -> TaskService
 -> Planner
 -> PermissionService
 -> AgentRouter / ToolRouter
 -> ExecutionService
 -> Observation Store
 -> VerificationService
 -> Replanner when required
 -> Result
 -> Memory update
 -> User report
```

### Services

| Service | Responsibility |
|---|---|
| `IntentService` | Distinguish conversation, command, task, tool intent. |
| `ContextService` | Gather current user/session/project/system context. |
| `TaskService` | Create, update, pause, resume, cancel, complete tasks. |
| `CapabilityService` | Know available tools/agents and health. |
| `ModelRouter` | Choose Ollama/Gemini/mock or later specialized models. |
| `AgentRouter` | Select agent by capability and risk. |
| `ToolRouter` | Select tools from backend registry. |
| `PermissionService` | Enforce risk, authorization, high-risk gates. |
| `MemoryService` | Retrieve and write scoped memories. |
| `ExecutionService` | Run durable steps and checkpoint state. |
| `VerificationService` | Verify objective completion with evidence. |

### Incremental First Implementation

Start with a minimal actionable scenario:

```text
"Create a local system health report"
 -> creates durable task
 -> planner selects system_monitor
 -> tool executes
 -> observation stored
 -> verifier confirms report artifact/content
 -> task completed
 -> audit exists
```

## E. Mark-L Integration Plan

### Rule

Do not copy/paste or rewrite Mark-L. Treat it as a capability provider.

### Adapter Shape

```text
Mark-L action module
 -> MarkLAdapter
 -> EDITH Tool Registry
 -> PermissionService
 -> ExecutionService
 -> Audit
```

### Candidate Capabilities

| Capability | Suggested Risk | Notes |
|---|---:|---|
| screen capture | 2 | Requires privacy notice and audit. |
| screen processing | 2 | Output must be treated as untrusted model-derived observation. |
| open application | 3 | Must validate app target. |
| keyboard/mouse control | 5 | High-risk disabled by default. |
| browser control | 3-5 | Prefer Playwright where possible. |
| file read/write | 2-4 | Needs path allowlists and size limits. |
| reminders | 1-2 | Safer first adapter candidate. |
| voice-related actions | 2 | Preserve current EDITH voice first. |

### First Safe Adapter Candidate

Use a read-only or low-risk capability first:

1. system monitor or reminder status
2. screenshot metadata only
3. then controlled file read

Do not expose unrestricted desktop control directly to LLM output.

## F. Crypto Integration Plan

### Rule

Do not merge crypto trading logic into EDITH Core. Treat crypto as a separate capability provider.

### Adapter Path

```text
crypto subsystem
 -> CryptoAdapter
 -> Finance/Trading Agent
 -> EDITH Tool Registry
 -> PermissionService
 -> Audit
```

### Integration Sequence

1. Read-only health/status
2. Market data read
3. Technical analysis read
4. Portfolio/paper dashboard visibility
5. Paper-trading action with explicit permission
6. Live trading only much later, if ever, behind critical-risk policy

### Non-Negotiable Live Trading Rule

An LLM must never directly call real-money execution. Any future live execution must follow:

```text
Market Data
 -> Analysis
 -> Strategy
 -> Risk
 -> Trade Proposal
 -> Explicit Authorization / Policy
 -> Execution Adapter
 -> Post-trade Verification
 -> Audit
```

## G. Security Gap Analysis

### Current Strengths

- High-risk tool env gate exists.
- Backend registry has required permissions and risk levels.
- URL normalization exists for `browser_open`.
- Audit events are emitted for registry executions.
- Secret files are now ignored by `.gitignore`.

### Current Gaps

| Gap | Severity | Required Fix |
|---|---:|---|
| Frontend and backend tool definitions can drift | High | Backend registry becomes authoritative. |
| localStorage stores sensitive/operational state | High | Move operational/sensitive state server-side. |
| No SQLite persistence for EDITH tasks/audit/memory | High | Add persistence layer and migrations. |
| Mark-L has broad subprocess/OS/file capabilities | High | Adapter with permission/risk/schema/timeout. |
| Some shell/subprocess paths exist | High | Validate commands, avoid shell where possible. |
| No backend kill switch | High | Add emergency stop state enforced by server. |
| No verifier | High | Do not mark task complete by tool success alone. |
| No structured plan validation | High | Add schema-validated planner output. |
| No prompt-injection isolation | Medium/High | Treat external content as untrusted observations. |
| Tokens/API keys in legacy JSON patterns | High | Migrate secrets to safer local storage strategy. |

### Security Priorities

1. Backend-authoritative permission policy.
2. Tool input schema validation.
3. Path allowlists for file tools.
4. High-risk gate preservation.
5. Kill switch.
6. Structured audit and correlation IDs.
7. Prompt-injection isolation for web/browser/screen content.

## H. Prioritized Implementation Roadmap

### Phase 0: Safety and Baseline

Status: in progress.

Completed:

- Git absence confirmed.
- Git initialized.
- `.gitignore` strengthened.
- Build/lint baseline run.
- Crypto baseline run with system Python and project venv.
- Baseline document created.

Remaining:

- Review Git scope.
- Create baseline commit if safe.

### Phase 1: Persistence Foundation

1. Add `src/edith/persistence/` interfaces.
2. Add SQLite dependency after evaluating simplest compatible library.
3. Implement SQLite connection and migrations.
4. Migrate `.edith/tasks.json`.
5. Migrate audit JSONL.
6. Add tool run persistence.
7. Add memory persistence bridge.

### Phase 2: Single Source Tool Registry

1. Extend backend `/api/edith/tools` metadata to include frontend-ready fields.
2. Add registry health endpoint.
3. Replace frontend `DEFAULT_TOOLS` rendering with backend registry data.
4. Keep local fallback metadata during transition.
5. Enforce input validation and normalized errors.

### Phase 3: EDITH Core

1. Create service interfaces.
2. Move current chat tool intent routing into `IntentService`.
3. Add `TaskService` wrapper around current task store.
4. Add `PermissionService` around registry checks.

### Phase 4: Durable Task Engine

1. Add task steps and attempts.
2. Add status transitions.
3. Add pause/resume/cancel.
4. Add checkpoints and observations.

### Phase 5: Planner

1. Create structured plan schema.
2. Implement deterministic simple planners for known tasks first.
3. Add LLM planner only behind schema validation.

### Phase 6: Executor

1. Load runnable steps.
2. Enforce dependencies and permissions.
3. Run tools with timeout/retry.
4. Persist observations and tool runs.

### Phase 7: Verifier

1. Add verification result schema: PASS / FAIL / PARTIAL / RETRYABLE.
2. Implement file/report/system-health verifiers.
3. Block false completion if verification fails.

### Phase 8: Recovery / Replanner

1. Classify failures.
2. Retry with budgets.
3. Select fallback tools where available.
4. Stop with clear failure report when budget exceeded.

### Phase 9: Compact Agent Layer

Start with:

- Main / Orchestrator
- Planner
- Research
- Browser/Computer
- Coding
- Vision
- Security

Do not create many agents prematurely.

### Phase 10+: Adapters and Memory V2

- Mark-L adapter
- Crypto read-only adapter
- Memory V2
- Model router
- Knowledge Map backed by real persisted relationships

## Definition of Done for Future Capabilities

A capability is complete only when:

- implementation exists
- integration exists
- permissions exist
- errors are handled
- state persists
- logs exist
- tests pass
- documentation exists
- actual workflow is verified
