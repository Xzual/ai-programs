# E.D.I.T.H Mark-L Adapter Foundation

Date: 2026-08-14

## Purpose

This document records the first Mark-L adapter foundation. EDITH now treats `Mark-L-main/` as a capability provider without copying, rewriting, or directly exposing unrestricted OS control.

The first integration is intentionally metadata-only. It inventories Mark-L modules, maps them to EDITH permissions and risk levels, and exposes that snapshot through the backend tool registry.

## Added Component

| File | Role |
|---|---|
| `src/edith/markLAdapter.ts` | Mark-L capability manifest and snapshot service |
| `scripts/test-edith-mark-l.ts` | Regression coverage for capability inventory, risk mapping, registry execution, and planner selection |

## New Registry Tool

```text
mark_l_capabilities
```

This tool:

- checks whether `Mark-L-main/` exists
- checks whether `readme.md` and `requirements.txt` exist
- lists capability modules
- reports permissions and risk levels
- reports adapter mode
- records tool run and audit through the existing registry execution path

It does not execute Mark-L actions.

## Current Capability Mapping

| Capability | Module | Risk | Adapter Mode |
|---|---|---:|---|
| `mark_l_system_monitor` | `actions/system_monitor.py` | 1 | `read_only_candidate` |
| `mark_l_screen_processor` | `actions/screen_processor.py` | 3 | `high_risk_blocked` |
| `mark_l_browser_control` | `actions/browser_control.py` | 4 | `high_risk_blocked` |
| `mark_l_computer_control` | `actions/computer_control.py` | 5 | `high_risk_blocked` |
| `mark_l_open_app` | `actions/open_app.py` | 4 | `high_risk_blocked` |
| `mark_l_file_controller` | `actions/file_controller.py` | 5 | `high_risk_blocked` |
| `mark_l_file_processor` | `actions/file_processor.py` | 2 | `metadata_only` |
| `mark_l_reminder` | `actions/reminder.py` | 3 | `high_risk_blocked` |
| `mark_l_web_search` | `actions/web_search.py` | 2 | `metadata_only` |
| `mark_l_proactive` | `actions/proactive.py` | 3 | `high_risk_blocked` |

Every capability is `enabledByDefault: false`.

## Planner Integration

Planner now selects:

```text
mark_l_capabilities
```

for Mark-L adapter/capability-provider objectives. This lets EDITH inspect capability inventory before any future adapter execution is considered.

## Safety Boundary

This foundation deliberately avoids:

- importing Mark-L Python modules into the Node process
- launching Python subprocesses for Mark-L actions
- controlling browser/desktop/file actions
- reading Mark-L secrets
- enabling camera/microphone/screen actions

Future executable adapters must go through backend registry validation, explicit permissions, risk gates, timeout, normalized result handling, audit, and task execution.

## Verification

Commands:

```bash
npm run test:edith-mark-l
npm run test:edith-agents
npm run test:edith-planner
npm run test:edith-recovery
npm run test:edith-verifier
npm run test:edith-executor
npm run test:edith-task-service
npm run test:edith-intent
npm run test:edith-registry
npm run test:edith-persistence
npm run lint
npm run build
```

Regression scenarios:

- Mark-L root/readme/requirements are detected
- capability manifest includes high-risk OS/browser/file modules
- all Mark-L capabilities are disabled by default
- `mark_l_capabilities` executes through backend registry safely
- tool run persistence records the snapshot call
- Planner selects `mark_l_capabilities` for Mark-L adapter objectives

Runtime smoke:

| Check | Result |
|---|---|
| Production server on `PORT=3108` | Started successfully |
| `POST /api/tools/execute` with `mark_l_capabilities` | Returned `success: true`, 10 capabilities, 7 high-risk capabilities |
| `POST /api/edith/tasks` + `POST /api/edith/tasks/:id/plan` | Mark-L objective produced a `READY` plan with `mark_l_capabilities` |
| Planned agents | `orchestrator`, `planning`, and `security` |

## Remaining Mark-L Adapter Work

1. Add dependency health checks for Python and required packages.
2. Add a safe read-only adapter for `actions/system_monitor.py` only after subprocess and environment policy review.
3. Add permission request workflow for screen/browser/computer capabilities.
4. Add path allowlists before file adapters are exposed.
5. Add screen/camera privacy prompts and hard backend gates.
6. Add Mark-L capability nodes to Knowledge Map from persisted registry data.
