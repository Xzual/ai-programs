# E.D.I.T.H. Wave 1 Chat 4 Backend Security Report

## A. Authoritative Root and Verdict

- Authoritative workspace: `C:\Users\arday\Desktop\ai programs`
- Branch: `master`
- Chat 4 scoped backend P0 controls: **PASS**
- Overall release / production readiness: **FAIL**
- Frontend and packaged desktop auth wiring: **INTERNAL_DEPENDENCY_HANDOFF**
- `crypto/`, `Mark-L-main/`, and `src-tauri/` were not edited by Chat 4.

## B. Concrete Files Changed This Run

- `.env.example`
- `server.ts`
- `server/security/ownerSession.ts`
- `server/routes/computerUse.ts`
- `scripts/test-edith-backend-security.ts`
- `scripts/test-edith-computer-use.ts`
- `docs/EDITH_WAVE1_CHAT4_BACKEND_SECURITY_REPORT_2026-09-27.md`

The authoritative checkout also contains and was verified against the already-landed P0 implementation in:

- `server/routes/permissions.ts`
- `server/routes/killSwitch.ts`
- `server/security/auditLog.ts`
- `server/security/networkPolicy.ts`
- `server/security/redaction.ts`
- `src/lib/storage.ts`
- `src/edith/permissionService.ts`
- `src/edith/markLAdapter.ts`
- `src/edith/serverRegistry.ts`
- `src/edith/sensitiveIntegrationService.ts`
- `src/edith/securityRedaction.ts`
- `scripts/test-edith-sensitive-integrations.ts`
- `scripts/test-edith-mark-l.ts`

## C. Owner, CSRF, Permission, and Kill-Switch Boundary

- `/api/tools/execute` requires a server-owned owner session, same-origin request, and session-bound CSRF token.
- Client `authorizedPermissions` is rejected with `CLIENT_PERMISSIONS_FORBIDDEN`; permission decisions are server-derived.
- Permission policy/grant and kill-switch mutations use the authenticated owner actor and sanitized audit events.
- Missing, wrong, revoked, cross-origin, and replayed credentials fail closed.
- Computer Use `POST /runtime`, `POST /events`, and `POST /stop` require owner session, exact same-origin, and CSRF. The desktop runtime header is only an additional Tauri signal and cannot authenticate a request by itself.
- HTTP `/observe` and `/action` keep their existing native-required behavior; this change does not add browser-side device control.
- Workspace and knowledge mutation routes are covered by the same missing/forged session, origin, and CSRF regression matrix.
- The server binds to `127.0.0.1` by default; remote binding requires explicit `EDITH_ALLOW_REMOTE_BIND=true`.

## D. Packaged Owner Bootstrap Contract

- `EDITH_OWNER_TOKEN_ONE_TIME=true` makes the bootstrap credential single-use.
- After the first successful exchange, the backend marks it consumed and removes `EDITH_OWNER_TOKEN` from `process.env`.
- Reusing the bootstrap secret returns `owner_bootstrap_consumed`; revoked session cookies cannot be replayed.
- Dev/browser mode may use an explicitly configured backend token with one-time mode disabled, but the token must never enter `VITE_*`, browser storage, response metadata, or logs.

## E. Browser and Provider Secret Handling

- Integration and legacy integration records are recursively stripped of API key, token, secret, credential, cookie, private-key, and webhook fields before browser persistence.
- No IndexedDB secret persistence implementation was found under `src/`; the verified leak path was localStorage.
- `/api/voice/tts` no longer accepts a client API key. It requires backend-only `ELEVENLABS_API_KEY` and rejects body `apiKey` with `CLIENT_SECRET_FORBIDDEN`.
- Provider failures return redacted safe messages; credential values are absent from response, audit, and server output regression evidence.
- A final search found no direct `req.body` API key/token/webhook or permission override path in backend routes.

## F. Mark-L Isolation

- Mark-L discovery is metadata-only and reports `CONFIGURATION_REQUIRED`, `configured:false`, and `executionEnabled:false`.
- Steam/Mark-L tools remain blocked until a sandboxed adapter exists.
- Direct `steam-game-manager.py` and `Mark-L-main/actions/game_updater.py` references are absent from source registry and the final production bundle.

## G. Exact Verification Results

All commands ran from the authoritative root and returned exit code `0`:

- `npm run test:edith-permission-service` — **PASS**
- `npm run test:edith-capabilities` — **PASS**
- `npm run test:edith-kill-switch` — **PASS**
- `npm run test:edith-sensitive-integrations` — **PASS**
- `npm run test:edith-legacy-tool-policy` — **PASS**
- `npm run test:edith-mark-l` — **PASS**
- `npm run test:edith-computer-use` — **PASS**
- `npm run test:edith-backend-security` — **PASS**
- `npm run test:edith-interaction-safety` — **PASS**
- `npm run lint` — **PASS**
- `npm run build` — **PASS**
- Production bundle unsandboxed Mark-L bridge scan — **PASS**
- Scoped `git diff --check` — **PASS** (only Windows LF/CRLF conversion warnings)

The Vite build emitted a non-blocking chunk-size warning for the main frontend bundle.
The backend security fixture also exercised a Windows `EBUSY` cleanup retry and keeps cleanup failure from masking security assertion failures.

## H. Required Handoffs and Remaining Risk

**Chat 6 packaged desktop handoff — INTERNAL_DEPENDENCY_HANDOFF**

1. Chat 6 has implemented an initial native one-time bootstrap in the authoritative root; packaged verification remains required.
2. Generate a new high-entropy owner bootstrap secret for every sidecar process start.
3. Pass it only through the child process environment as `EDITH_OWNER_TOKEN`; also set `EDITH_OWNER_TOKEN_ONE_TIME=true`.
4. Never pass the secret through command-line arguments, logs, status APIs, files, frontend environment, or browser storage.
5. The trusted native bridge performs the single exchange with `POST /api/security/session` and then discards its copy.
6. Tauri CSP, capability, signing, and sidecar lifecycle remain Chat 6 responsibilities. Chat 4 made no `src-tauri` edit.

**Chat 2 frontend handoff — INTERNAL_DEPENDENCY_HANDOFF**

1. Establish the owner session through the trusted native/backend bootstrap flow before protected calls.
2. Let the browser retain only the HttpOnly cookie automatically.
3. Keep the returned CSRF token in memory only and send it as `X-EDITH-CSRF-Token` on protected mutations.
4. Never store owner bootstrap tokens or CSRF tokens in localStorage, IndexedDB, settings, logs, or persisted application state.
5. Remove client `apiKey` from the voice TTS request contract; Settings may show configuration status only.
6. Send Computer Use `POST /runtime`, `POST /events`, and `POST /stop` through `ownerMutationFetch`; retain CSRF only in memory and preserve the Tauri runtime header only for runtime/event reports.

Until these two handoffs are implemented and packaged acceptance-tested, the overall release verdict remains **FAIL**. This report does not claim production readiness.
