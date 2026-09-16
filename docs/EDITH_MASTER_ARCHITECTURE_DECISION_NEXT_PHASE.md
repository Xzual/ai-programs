# E.D.I.T.H. Master Architecture Decision - Next Phase

Date: 2026-09-16

## 1. Executive Decision

E.D.I.T.H. remains a local-first Personal AI Operating System, but the next phase shifts the product direction to voice-first operation, backend-only AI provider secrets, Gemini Live for realtime voice, Gemini 3.6 Flash for normal text/fallback work, real Obsidian-backed knowledge, visible and protected Computer Use, responsive desktop UI, and crypto observer-only behavior.

No team may rewrite the whole project. No team may fake feature completion. A phase is complete only after runtime verification by Chat 8.

## 2. Architecture Decisions

### A. Model Architecture

- Text, written chat, coding, and non-realtime fallback default: `gemini-3.6-flash`.
- Live voice default: `gemini-3.1-flash-live-preview`.
- `gemini-2.5-flash` must not be the default because the bare API test proved it fails for this account with `MODEL_NOT_FOUND` while `gemini-3.6-flash` works.
- Gemini remains one provider inside the provider registry, not the whole assistant.
- Ollama/local AI flow must keep working.
- EDITH Mock remains a degraded local fallback and must report itself honestly.

### B. Voice-First Interaction

- The primary EDITH interaction mode is spoken conversation.
- `gemini-3.1-flash-live-preview` must use Gemini Live API / realtime session architecture.
- The live model must not be called through normal text `generateContent` paths.
- Voice state must be explicit: idle, listening, connecting, speaking, interrupted, failed, degraded fallback.
- Written chat remains available as fallback and for coding/task traces.

### C. Text/Fallback Model

- The backend provider registry owns text model routing.
- Chat 4 owns the API contract and model defaults.
- Chat 2 may show provider/model status, but must not own secret handling or route decisions.
- The assistant persona and provider/model selection remain separate concepts.

### D. Computer Use

- Computer Use becomes a main capability, but must run through observe-plan-act-verify flow.
- Expected actions: observe screen, move mouse, click, type, scroll, verify result.
- Dangerous actions require security policy gates.
- All high-risk action attempts must be auditable.

### E. Computer Use Visual Overlay

- Chat 6 owns desktop/Tauri integration and runtime control state.
- Chat 2 owns visual components after Chat 6 defines the state contract.
- Required overlay states:
  - soft blue/cyan screen overlay
  - four-corner HUD glow
  - EDITH-controlled cursor
  - click pulses
  - target highlight boxes
  - labels for observing, planning, moving, clicking, typing, verifying
  - visible emergency stop / kill switch

### F. Obsidian External Brain

- Obsidian is EDITH's external brain.
- Vault path: `D:\EDİTH\EDİTH`
- The Turkish uppercase `İ` must be preserved exactly.
- Generated notes must be graph-friendly, not isolated.
- Every EDITH-created note should include frontmatter, parent index link, meaningful wikilinks, standardized tags, source/origin/status, and relation to project/task/memory/research/trading when possible.

### G. Knowledge Map

- Knowledge Map must use real EDITH memory and Obsidian data.
- Fake nodes, demo-only nodes, and hardcoded success graphs are not acceptable.
- The target direction is a responsive 3D connected graph / brain-like map that scales to real data.

### H. Responsive UI

- The desktop UI must use fullscreen and large monitors well.
- Dashboard, Knowledge Map, Crypto, Browser, and Computer Use screens should expand intelligently.
- Empty dead space on large screens is a defect.

### I. Crypto Observer-Only

- Crypto remains observer-only.
- No live trading.
- No BUY/SELL execution.
- Crypto learning notes may be saved to Obsidian and linked into the graph.

### J. Owner Command Mode

- EDITH may avoid repeated permission prompts for normal local-safe tasks: Spotify, browser research, desktop organization, Obsidian note writing, and local safe actions.
- Critical actions still require protection: payments, live trading, permanent delete, credentials/passwords, sending messages externally, uploading private data, and disabling the kill switch.

### K. Security Boundaries

- API keys are backend-only.
- No frontend API key input.
- No API keys in localStorage.
- No API keys in frontend responses, logs, screenshots, status cards, or diagnostics.
- Kill switch must remain visible and enforceable for Computer Use and other high-risk adapters.
- Computer control and destructive operations require explicit safety boundaries.

## 3. Phase Roadmap

### Phase 1 - Model Architecture Finalization

1. Chat 4 updates provider/model defaults and backend contracts.
2. Chat 6 defines Gemini Live voice provider boundary without wiring UI first.
3. Chat 8 verifies text and live paths separately.

Reason for first position: model defaults and secret boundaries must be fixed before UI and voice features build on them.

### Phase 2 - Voice-First Mode

1. Chat 6 implements Gemini Live realtime session architecture.
2. Chat 2 implements voice-first UI states against Chat 6's contract.
3. Chat 8 runs live voice smoke and degraded-mode testing.

### Phase 3 - Computer Use Foundation

1. Chat 6 implements observe-plan-act-verify runtime and Owner Command safety gates.
2. Chat 2 implements the Computer Use screen and premium overlay UI.
3. Chat 8 validates safe desktop/browser tasks and kill-switch interruption.

### Phase 4 - Obsidian Graph-Friendly Brain

1. Chat 5 updates note rules, index structure, wikilinks, frontmatter, and graph relations.
2. Chat 8 validates generated notes in `D:\EDİTH\EDİTH`.

### Phase 5 - Knowledge Map

1. Chat 5 provides real graph data from Obsidian, memory, tasks, and events.
2. Chat 2 builds the responsive 3D Knowledge Map using only real data.
3. Chat 8 verifies there are no fake graph nodes and that graph size scales.

### Phase 6 - Responsive UI

1. Chat 2 updates large-screen and responsive layouts across major screens.
2. Chat 8 tests viewport sizes and desktop fullscreen behavior.

### Phase 7 - Crypto Observer Polish

1. Chat 7 links observer-only market learning to Obsidian.
2. Chat 2 may polish Crypto cockpit UI if needed.
3. Chat 8 verifies no trading execution exists or is reachable.

### Phase 8 - Final Integration QA

1. Chat 8 runs full regression.
2. Chat 0 reviews reports and gives final readiness decision.

## 4. Team Ownership Table

| Team | Owns | Must Report Back |
|---|---|---|
| Chat 0 | Architecture review, sequencing, conflict control, final readiness | Phase decisions, blocked conflicts, readiness verdict |
| Chat 2 | React UI, responsive layout, voice UI, Computer Use overlay, Knowledge Map visual frontend | Files changed, screenshots, viewport checks, state contract assumptions |
| Chat 4 | Express backend, provider registry, Gemini text provider, model routing, API contracts, SSE, health/status | Provider defaults, API contract, fallback behavior, secret-handling proof |
| Chat 5 | Agent OS, memory, Obsidian, graph data model, note writing rules | Vault path handling, note schema, graph sources, no-fake-data proof |
| Chat 6 | Gemini Live voice, microphone/audio streaming, Computer Use runtime, browser/desktop control, Tauri overlay integration, Owner Command runtime | Live API boundary, safety gates, kill-switch binding, runtime smoke evidence |
| Chat 7 | Crypto observer-only system and market learning notes | Proof no trading is enabled, Obsidian note output, observer status |
| Chat 8 | QA, regression, runtime smoke, UI testing, responsive testing, provider/voice/computer-use/Obsidian/crypto verification | Exact commands, pass/fail output, screenshots when UI changed, residual risk |

## 5. File/Area Conflict Warnings

### Provider and Model Files

Primary owner: Chat 4.

Likely areas:

- `server/providers/**`
- `server/routes/**`
- `server.ts`
- `src/edith/providerService.ts`
- `src/types.ts`
- `docs/EDITH_AI_PROVIDER_SYSTEM.md`
- provider/model test scripts in `scripts/`

Do not let Chat 2 or Chat 6 change provider routing logic while Chat 4 is working. Chat 2 may consume the API after the contract is stable.

### Voice and Desktop Runtime Files

Primary owner: Chat 6.

Likely areas:

- `src-tauri/**`
- voice runtime services under `src/edith/**`
- browser/computer-use adapters under `src/edith/**`
- Tauri configuration and permissions
- microphone/audio/session bridge code

Do not let Chat 2 invent live model calls in UI code. The UI must call Chat 6/Chat 4 contracts.

### Frontend UI Files

Primary owner: Chat 2.

Likely areas:

- `src/App.tsx`
- `src/components/**`
- `src/components/views/**`
- `src/components/ui/**`
- frontend styles and visual state components

Do not let Chat 2 store API keys, call Gemini directly from the browser, or bypass backend safety contracts.

### Memory, Obsidian, and Knowledge Data

Primary owner: Chat 5.

Likely areas:

- `src/edith/obsidianVaultService.ts`
- `src/edith/knowledgeMapService.ts`
- memory and persistence services under `src/edith/**`
- Obsidian-related docs and tests

Do not let Chat 2 hardcode graph nodes while Chat 5 is defining real graph data.

### Crypto

Primary owner: Chat 7.

Likely areas:

- `crypto/**`
- crypto views only when UI polish is explicitly assigned

For the main voice/provider/desktop work, no other chat should touch `crypto/**`. Trading execution remains prohibited.

### External Assistant

Do not touch unless explicitly assigned:

- `Mark-L-main/**`

## 6. Acceptance Criteria

### Phase 1

- `gemini-3.6-flash` is the text/fallback Gemini default.
- `gemini-2.5-flash` is not the default.
- Gemini text path works through backend provider registry.
- Ollama/local flow still works or degrades honestly.
- API keys are backend-only and never exposed to frontend responses.
- Chat 8 verifies provider health, chat fallback, lint, build, and relevant provider tests.

### Phase 2

- Gemini Live voice uses realtime session architecture.
- `gemini-3.1-flash-live-preview` is not called through normal text generation.
- Voice UI shows truthful state and failure/degraded modes.
- User can start, interrupt, and stop voice mode.
- Chat 8 verifies microphone/session flow where available and confirms fallback behavior when unavailable.

### Phase 3

- Computer Use follows observe-plan-act-verify.
- Overlay shows active state and kill switch.
- Safe tasks can complete with verification.
- Dangerous tasks are blocked or require explicit protection.
- Kill switch interrupts runtime control.

### Phase 4

- Notes written to `D:\EDİTH\EDİTH` preserve the Turkish `İ`.
- Generated notes include frontmatter, parent index, wikilinks, tags, source/origin/status, and relationship fields.
- Obsidian-created graph nodes are not isolated when a relationship can be inferred.

### Phase 5

- Knowledge Map renders real backend graph data.
- No fake/demo nodes are used in normal runtime mode.
- 3D visualization handles realistic graph size without unreadable layout collapse.

### Phase 6

- Major screens are usable on laptop, 1080p, 1440p, and fullscreen large monitor sizes.
- No major empty dead-space panels on desktop.
- Text does not overlap or overflow controls.

### Phase 7

- Crypto remains observer-only.
- No BUY/SELL execution path exists in EDITH UI/runtime.
- Market learning notes save to Obsidian and link into the graph.

### Phase 8

- `npm run lint` passes.
- `npm run build` passes.
- Relevant targeted tests pass.
- Tauri dev smoke is checked when desktop/runtime changed.
- Chat 8 reports exact command results and unresolved risks.

## 7. First 3 Prompts To Send Next

### Chat 4 Prompt Summary

Finalize backend model architecture. Make `gemini-3.6-flash` the Gemini text/fallback default, ensure `gemini-2.5-flash` is not selected by default, preserve Ollama/local routing, keep Gemini as one provider among many, and prove API keys remain backend-only with no frontend exposure. Do not touch UI beyond API contract types if unavoidable. Report files changed, provider contract, tests run, and fallback behavior.

### Chat 6 Prompt Summary

Design the Gemini Live and Computer Use runtime boundaries. Define how `gemini-3.1-flash-live-preview` will run through Gemini Live realtime sessions, not normal text generation. Define observe-plan-act-verify Computer Use states, Owner Command safety gates, Tauri overlay/runtime integration points, and kill-switch binding. Do not implement broad UI polish. Report contracts, files likely needed, safety boundaries, and runtime test plan.

### Chat 8 Validation Prompt Summary

Prepare validation for Phase 1 and Phase 2 readiness. Verify provider defaults, no frontend key exposure, Ollama/local degraded flow, Gemini text path with `gemini-3.6-flash`, and the planned Gemini Live separation. Run lint/build and targeted provider tests. Do not mark success unless runtime/API evidence supports it. Report exact commands, exact results, screenshots if UI is involved, and residual risks.
