# E.D.I.T.H. Chat 5 Phase 11A Obsidian First-Run / Provider Contract Handoff

Date: 2026-09-29

OWNER: Chat 5 Registry / Obsidian / Knowledge

STATUS: COMPLETE for provider/config contract foundation. Native picker, protected activation route, and UI consumption remain downstream work and are not claimed as complete.

## Scope Result

Master report sections 6, 7, and 24 plus the Phase 1, Phase 4, and Phase 8B handoffs were reconciled. No UI, native, mobile, crypto, or Mark-L file was edited.

The new foundation makes first-run state explicit and fail-closed:

- Fresh production state is `FIRST_RUN_REQUIRED` with reason `VAULT_SELECTION_REQUIRED`. No workspace, environment, developer, or guessed path becomes a production provider.
- `UserVaultProvider` activates only after a valid `TrustedNativeVaultSelectionV1` passes an injected trusted verifier. The default verifier denies every selection.
- Native selections are exact-key, owner-confirmed device-local records with a maximum five-minute lifetime. Contract parsing does not itself grant authority.
- Test mode is explicit through `EDITH_TEST_MODE=true` or `NODE_ENV=test`, requires `EDITH_TEST_OBSIDIAN_SANDBOX_ROOT`, and permits only `SandboxVaultProvider` below the real OS temp root.
- Test mode rejects `UserVaultProvider`, project/profile roots, traversal, symlink/junction escape, and missing sandbox configuration.
- Production validation accepts Unicode, Turkish characters, spaces, and profile-contained vaults while rejecting filesystem roots, application/project roots, system/program roots, symlink/reparse traversal, and unavailable paths.
- Selection validation performs no probe write and does not create or restructure the selected vault.
- Approved production configuration is local-only, schema-versioned, revisioned, mode `0600`, and replaced atomically with rollback cleanup.
- Restart loads the config once and returns `READY` without reopening the picker.
- A missing previously approved vault returns `DEGRADED / VAULT_UNAVAILABLE` with `selectionAction: none`; this prevents automatic popup loops and does not block unrelated services.
- Change increments config revision. Revoke persists a path-free tombstone and returns `FIRST_RUN_REQUIRED / VAULT_SELECTION_REVOKED`.
- Public status contains no path, fingerprint, token, selection ID, or device ID.
- Every provider and public status fixes `executionAuthority:false` and `knowledgeOnly:true`. Obsidian remains memory/knowledge evidence and cannot grant tool permission or executable authority.

## Additive Contracts

Added to `src/edith/contracts.ts` without renaming or removing frozen fields:

- `OBSIDIAN_PROVIDER_CONFIG_VERSION`
- `TrustedNativeVaultSelectionV1`
- `ObsidianProviderLocalConfigV1`
- `ObsidianProviderPublicStatusV1`
- `parseTrustedNativeVaultSelectionV1()`
- `parseObsidianProviderLocalConfigV1()`
- `parseObsidianProviderPublicStatusV1()`

The local config contract may contain an absolute path because it never leaves the trusted backend/local filesystem boundary. The public status contract cannot contain that field and rejects unknown fields.

## Runtime Foundation

`src/edith/obsidianProviderService.ts` now provides:

- `ObsidianProviderConfigService`
- `UserVaultProvider`
- `SandboxVaultProvider`
- `TrustedNativeVaultSelectionVerifier`
- production and sandbox root validators
- contained read/write resolution with traversal and link escape rejection
- atomic local config persistence, restart, change, revoke, unavailable, and path-free public status behavior

`ObsidianVaultService` consumes provider status/path rather than production environment or workspace fallback. Its legacy direct vault configuration methods are test-only and throw `TRUSTED_NATIVE_PICKER_REQUIRED` in production. The skill registry exposes safe provider state/reason and `executionAuthority:false`, never the selected path.

`ResearchJournalService` retains provider injection. Its sandbox provider now requires explicit test mode and the shared OS-temp guard. A production `UserVaultProvider` is structurally compatible, but default backend composition intentionally remains unbound until Chat 4 installs the trusted activation/provider composition.

## Test Evidence

New `test:edith-obsidian-provider` coverage:

- fresh install / no fallback
- trusted native selection only
- Unicode, Turkish, spaces
- selected user-owned fixture is not mutated
- atomic versioned config
- public path redaction
- restart without picker
- change and revoke
- unavailable vault degrades without popup
- test sandbox only
- traversal, symlink/junction, project and sensitive-root guards
- knowledge-only, no execution authority

All passed:

- `npm run test:edith-obsidian-provider`
- `npm run test:edith-skills`
- `npm run test:edith-registry`
- `npm run test:edith-obsidian-knowledge`
- `npm run test:edith-workspace`
- `npx tsx scripts/test-edith-phase4-research.ts`
- `npx tsx scripts/test-edith-phase4-api.ts`
- `npm run test:edith-knowledge-map`
- `npm run test:edith-memory-v2`
- `npm run test:edith-backend-security`
- `npm run test:edith-contracts-v2-1`
- `npm run lint`
- `npm run build`

The production build retains the existing Vite large-chunk warning. SQLite tests retain the existing Node experimental warning. Two passing Windows tests reported best-effort temp cleanup `EBUSY`; no source or user vault path was touched.

Before and after the final test/build pass, every file under the real project `.edith` directory was hashed with SHA-256. The complete path/hash/length inventory was identical (`EDITH_RUNTIME_HASH_UNCHANGED`), including `edith.db`, `audit.log.jsonl`, `tasks.json`, WAL/SHM, knowledge stores, and workspace config.

## Files Changed

- `.cursor/agents/edith-obsidian-provider-auditor.md`
- `src/edith/contracts.ts`
- `src/edith/obsidianProviderService.ts`
- `src/edith/obsidianVaultService.ts`
- `src/edith/researchJournalService.ts`
- `src/edith/skillRegistry.ts`
- `scripts/test-edith-obsidian-provider.ts`
- `scripts/test-edith-obsidian-knowledge.ts`
- `scripts/test-edith-skills.ts`
- `scripts/test-edith-workspace.ts`
- `scripts/test-edith-phase4-research.ts`
- `package.json`
- `docs/EDITH_CHAT5_PHASE11A_OBSIDIAN_FIRST_RUN_CONTRACT_HANDOFF_2026-09-29.md`

## Chat 6 Native Request

CROSS_CHAT_REQUEST:

- REQUEST_ID: `edith-phase11a-native-vault-picker-2026-09-29`
- FROM_OWNER: Chat 5 Registry / Obsidian / Knowledge
- TO_OWNER: Chat 6 Native Desktop
- REQUEST: Add a user-initiated local folder picker that returns a `TrustedNativeVaultSelectionV1` through a native-only authenticated bridge. Bind `selectionId` and `deviceId` to the current local owner/device session, set `source: trusted_native_picker`, require explicit confirmation, and expire the record within five minutes. Do not expose an arbitrary path-authoring API to WebView JavaScript. Do not create, restructure, probe-write, or index the selected vault in the picker.
- CONTRACT_SOURCE: `src/edith/contracts.ts`
- ACCEPTANCE: forged/browser-authored selection denied; expired/replayed selection denied; Unicode/space path preserved; cancel produces no config; selected fixture tree and contents unchanged; no token/path in public response or audit log.
- MIGRATION_ORDER: native picker -> native attestation verifier -> protected backend activation route -> provider status -> UI.
- ACK_REQUIRED: exact wire mapping, attestation verification, replay/expiry behavior, cancel behavior, and zero-mutation evidence.

## Chat 4 Backend Request

CROSS_CHAT_REQUEST:

- REQUEST_ID: `edith-phase11a-provider-composition-2026-09-29`
- FROM_OWNER: Chat 5 Registry / Obsidian / Knowledge
- TO_OWNER: Chat 4 Backend / Security
- REQUEST: Compose `ObsidianProviderConfigService` with a verifier backed by Chat 6 native attestation. Add owner-session, exact-origin, CSRF, loopback, idempotency, and audit protected activate/change/revoke endpoints. Accept the typed native selection envelope, never a raw owner-body path. Return only `ObsidianProviderPublicStatusV1`. Bind `UserVaultProvider` to `ObsidianVaultService` and production `ResearchJournalService` only after status is `READY`. Retire or keep fail-closed the legacy direct path endpoints.
- ACCEPTANCE: public responses/logs/audits contain no absolute path; default verifier denies; restart reuses config once; unavailable vault is non-blocking `DEGRADED`; revoke removes stored path; kill switch/permission services are not bypassed; Obsidian content never becomes executable authority.
- MIGRATION_ORDER: verifier -> protected mutation route -> provider composition -> public status read -> journal binding -> integration/security QA.
- ACK_REQUIRED: route schema, authorization boundary, local config location, audit fields, redaction, and restart behavior.

## Chat 2 UI Request

CROSS_CHAT_REQUEST:

- REQUEST_ID: `edith-phase11a-obsidian-first-run-ui-2026-09-29`
- FROM_OWNER: Chat 5 Registry / Obsidian / Knowledge
- TO_OWNER: Chat 2 Desktop UI
- REQUEST: Consume only `ObsidianProviderPublicStatusV1`. Show first-run selection only for `FIRST_RUN_REQUIRED` after explicit user interaction. Show connected state only for `READY`. Show a passive reconnect/change action for `DEGRADED`; never auto-open the picker. Settings must provide explicit Change and Revoke commands through the protected Chat 4 API. Never accept, store, render, or log an absolute path from a public status response.
- ACCEPTANCE: fresh/ready/degraded/revoked states render literally; cancel is harmless; unavailable state does not popup-loop or block chat/tasks; no fake connected/synced claim; no UI/native implementation may infer execution authority from Obsidian.
- MIGRATION_ORDER: generated client types -> read-only status -> first-run action -> change/revoke -> browser/Tauri visual QA.
- ACK_REQUIRED: state mapping, user-initiation behavior, cancel handling, no-path UI evidence, and degraded non-blocking behavior.

## Remaining Limits

- No native picker or native attestation verifier is implemented in this scope.
- No protected activation/change/revoke HTTP route is implemented in this scope.
- Production research journal binding remains `configuration_required` until Chat 4 composes the verified `UserVaultProvider`.
- No real user vault was accessed. Acceptance used only isolated OS-temp fixtures representing user-owned content.
- Full packaged Tauri first-run/restart visual E2E remains downstream acceptance work.

COMMITS: None

GIT_OPERATIONS: No commit, reset, checkout, cleanup, or unrelated revert.

NEXT_OWNER: Chat 6 Native, then Chat 4 Backend/Security, then Chat 2 UI, then Chat 8 independent acceptance.
