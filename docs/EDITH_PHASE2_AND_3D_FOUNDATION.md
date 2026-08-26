# EDITH Phase 2 and 3D Foundation

## Summary
This implementation keeps EDITH's existing task, tool, permission, audit, verifier, recovery, memory, and model-router architecture. Phase 2 adds safe foundations for read-only vision, policy-gated computer interaction, browser workflows, autonomous task interruption, proactive/context signals, and a 3D Design Orchestrator layer.

No local Ollama server is started by these modules. Existing health checks may still query the configured Ollama URL.

## Phase 2 Foundations
- Phase 2A read-only vision is exposed through `vision_observe`. It returns structured observations and never moves the mouse, types keys, clicks, or performs autonomous actions.
- Phase 2B computer actions are represented by `computer_action`. Forbidden actions are denied before permission checks; allowed requests still require `computer:control`, kill-switch clearance, audit, and a bound runtime adapter.
- Phase 2C browser workflows are exposed through `browser_workflow`. Dry-run mode validates the request without browser side effects. Search uses existing low-risk browser search; controlled Playwright actions remain permission-gated.
- Phase 2D autonomous execution now has a persistent task queue, resume checkpoints, and interrupt support. “dur / iptal / stop / cancel / abort” can create an interrupt signal, and the executor checks for it before continuing task/tool execution.

## Proactive and Context Layer
- `ProactiveService` stores user-controlled monitoring settings and returns heartbeat signals only when enabled.
- `SentimentContext`, `PresenceContext`, `PatternMemory`, and `ConfidenceCheck` are implemented as lightweight, non-clinical, permission-aware foundations.
- High-risk or low-confidence decisions require approval through `ConfidenceCheck`.
- IoT feedback and finance/trading are represented by permission-gated sensitive integration stubs. They report `CONFIGURATION_REQUIRED` until real providers are configured.

## 3D Tool Research and Selection
- Blender is selected for future rendering, animation, organic modeling, materials, and visualization because it has Python automation and supports background command-line execution.
- FreeCAD is selected as a candidate for precise CAD because it is Python-scriptable and oriented around parametric modeling.
- CadQuery/OpenCascade is selected for code-driven parametric CAD because CadQuery is a Python framework built on OpenCascade/OCP and supports parametric models and CAD exports.
- Playwright is already in the project and is used for deterministic browser automation, screenshots, and browser workflow verification.

## Honest Runtime Status
Read-only probes report whether local helper tools appear to be installed:
- Blender executable
- FreeCAD executable
- CadQuery Python environment hint
- Tesseract executable
- OpenFOAM executable
- Playwright Node dependency
- Ollama executable

These probes do not start services or execute long-running tool processes.

The 3D tools registered in EDITH are foundation adapters:
- `design3d_cad_foundation`
- `design3d_render_foundation`
- `design3d_simulation_foundation`

They do not claim to generate CAD, render scenes, or run simulation until local engines are installed and explicitly bound. Each currently returns `CONFIGURATION_REQUIRED` with an honest status payload.

Sensitive integration tools follow the same rule:
- `iot_feedback_stub`
- `finance_trading_guard`

They do not control smart-home devices, brokers, exchanges, banks, or trading accounts.

## Security Notes
- High-risk execution stays disabled unless `EDITH_ENABLE_HIGH_RISK_TOOLS=true` and/or scoped permission grants are present.
- Computer control blocks deletion, registry/system configuration changes, financial actions, and broad mass operations.
- Every service that changes operational state records audit events.
- Legacy `/api/tools/execute` browser/computer/system tools are also mapped through the EDITH permission policy instead of bypassing the high-risk guard.

## Verification Coverage
- `scripts/test-edith-phase2-foundation.ts`
- `scripts/test-edith-auth-persona.ts`
- `scripts/test-edith-design3d-service.ts`
- `scripts/test-edith-proactive-service.ts`
- `scripts/test-edith-task-queue.ts`
- `scripts/test-edith-legacy-tool-policy.ts`
- `scripts/test-edith-local-tool-probes.ts`
- `scripts/test-edith-sensitive-integrations.ts`
