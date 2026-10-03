# E.D.I.T.H. Chat 4 Phase 7D Advanced Integration Handoff

Date: 2026-09-28

OWNER: Chat 4 Backend Integration

STATUS: COMPLETE for backend publication wiring. Advanced persistence remains process-memory only. Chat 6 still must add the new native enum variants and endpoint mappings. UI consumption remains Chat 2 ownership.

## Scope And Files

Changed:

- `server/advanced/runtime.ts`
- `server/advanced/producerComposition.ts`
- `server/routes/advancedExperience.ts`
- `server/routes/desktopProducer.ts`
- `scripts/test-edith-phase7d-producer-integration.ts`
- `scripts/test-edith-phase7d-native-publication.ts`
- `scripts/test-edith-backend-security.ts`
- `package.json`
- `docs/EDITH_CHAT4_PHASE7D_ADVANCED_INTEGRATION_HANDOFF_2026-09-28.md`

Frozen `src/edith/contracts.ts`, Chat 5 producer implementation, `src-tauri/**`, `mobile/**`, React UI, crypto, and Mark-L were not changed.

## Internal Producer Composition

`AdvancedProducerComposition` creates one `AdvancedExperienceProducerService` per owner/workspace runtime. It injects the canonical local persistence store, Phase 4 persistence, and a server-resolved installed allowlist from the local tool registry plus external skill catalog. This path does not call provider health and therefore does not ping Gemini.

Every `CanonicalPublish` is reparsed with the frozen Phase 7A parser before publication. Owner/workspace lineage is retained, stable records are promoted to exact runtime revision N+1 with stable `createdAt`, and publication uses `AdvancedExperienceRuntime.putTrusted(..., "internal_producer")`.

Protected source-ID endpoint:

`POST /api/edith/advanced/produce/:operation`

Operations:

- `mission-memory`: persisted task ID plus optional persisted research/playbook run IDs.
- `recent-context`: server reads persisted task/audit/research state.
- `outcome`: persisted task/research/playbook/generated-knowledge/installed-skill IDs.
- `workspace`: persisted task IDs and installed skill IDs; no arbitrary workspace item DTO.
- `retry`: persisted task ID plus bounded failure class and attempts.
- `watcher`: safe source ID; actual Obsidian watcher status is read server-side.
- `communication`: bounded policy values.
- `ghost`: persisted task ID.

The endpoint requires owner session, exact trusted origin and CSRF. Unknown fields, including owner-supplied `verified:true`, are rejected. Owners cannot submit canonical producer DTOs through this route.

Completed Outcome Mode is accepted only through the internal producer trust level after the task/research/artifact/skill references are re-read from persistence or the installed registry. Generated Obsidian evidence requires a persisted knowledge node with an `edith_generated` marker. Ordinary notes remain unverified. Transfer references are rejected unless a future adapter supplies trusted cross-device evidence.

Workspace publication writes the snapshot first and the orchestration plan second. A second-stage failure returns `207`, `status: partial`, `restoreReady:false`, and leaves no orchestration record that could imply restore readiness.

## Trusted Native Publication

Eight fixed routes now reuse the exact Phase 6G `authenticate()` boundary:

- `POST /api/edith/mobile/desktop-producer/advanced/power-presence`
- `POST /api/edith/mobile/desktop-producer/advanced/downloads`
- `POST /api/edith/mobile/desktop-producer/advanced/bookmarks`
- `POST /api/edith/mobile/desktop-producer/advanced/snapshots`
- `POST /api/edith/mobile/desktop-producer/advanced/scenes`
- `POST /api/edith/mobile/desktop-producer/advanced/watchers`
- `POST /api/edith/mobile/desktop-producer/advanced/shadow`
- `POST /api/edith/mobile/desktop-producer/advanced/retries`

Success is HTTP `202` only. Each route requires loopback, `Authorization: Bearer <EDITH_DESKTOP_BRIDGE_TOKEN>`, short-lived `X-Edith-Producer-Session`, exact-next `X-Edith-Producer-Sequence`, active owner binding, matching owner/workspace lineage, and its exact frozen parser. Error responses contain only a code and fixed safe message.

The generic owner PUT still rejects power/download truth. Trusted-native scenes may publish actual reversible state. Native watcher publication must remain `configuration_required`; an `active` watcher is rejected until a real approved OS event source exists. Kill switch revokes producer authority and reverts/cancels advanced scene/watcher/ghost/orchestration state. Owner logout/rotation/expiry invalidates the producer session through the existing owner-binding checks.

## Exact Chat 6 Mapping

Add these `ProducerIngestKind` variants in `src-tauri/src/cross_device.rs` using `serde(rename_all = "snake_case")`:

| Native enum variant | Wire kind | Fixed endpoint |
|---|---|---|
| `AdvancedPowerPresence` | `advanced_power_presence` | `/api/edith/mobile/desktop-producer/advanced/power-presence` |
| `AdvancedDownloads` | `advanced_downloads` | `/api/edith/mobile/desktop-producer/advanced/downloads` |
| `AdvancedBookmarks` | `advanced_bookmarks` | `/api/edith/mobile/desktop-producer/advanced/bookmarks` |
| `AdvancedSnapshots` | `advanced_snapshots` | `/api/edith/mobile/desktop-producer/advanced/snapshots` |
| `AdvancedScenes` | `advanced_scenes` | `/api/edith/mobile/desktop-producer/advanced/scenes` |
| `AdvancedWatchers` | `advanced_watchers` | `/api/edith/mobile/desktop-producer/advanced/watchers` |
| `AdvancedShadow` | `advanced_shadow` | `/api/edith/mobile/desktop-producer/advanced/shadow` |
| `AdvancedRetries` | `advanced_retries` | `/api/edith/mobile/desktop-producer/advanced/retries` |

Each variant must receive an exact-key validator in `validate_producer_payload`. Preserve the existing forbidden-data scan for pixels, audio, clipboard, paths, URLs, authorization, cookies, CSRF, producer tokens, and body/transport fields. Do not expose bridge/session token or sequence to WebView code. Treat only HTTP 202 plus `success:true` as accepted publication.

## Chat 2 API And UI Fields

Owner reads:

- `GET /api/edith/advanced/status`
- `GET /api/edith/advanced/state?workspaceId=<id>`
- `GET /api/edith/advanced/history/search?workspaceId=<id>&q=<query>`

Device read:

- `GET /api/mobile/advanced/state` using device auth and encrypted response.

Always display these capability fields literally:

- `status.persistence`: `memory_only`
- `status.restartRecovery`: `partial`
- `status.nativeExecution`: `configuration_required` until the relevant native publication is observed
- `status.scheduler`: `configuration_required`
- `status.watcherDelivery`: `configuration_required`
- `state.*[].revision`, `createdAt`, `updatedAt`, optional `expiresAt`

Feature fields:

- Mission Memory: `sourceTaskId`, optional research/playbook IDs, `verificationStatus`, `routeSummary`, `currentStateReverificationRequired`.
- Outcome/workspace: `kind`, `objective`, `references`, `steps`, `verifiedDownstreamResultIds`, `status`; restore controls stay disabled for `configuration_required` or partial publication.
- Native status: power/presence source, battery, lowPower, userPresence, observed/expiry; downloads byte counts and ETA only when `etaTrustworthy`; bookmark screenshot policy and opaque handle only; scene reversible changes and status; watcher literal status; Shadow metadata-only captured fields; retry attempts/strategy/status.
- Mobile projection is read-only and exposes priority, ghosts, watchers, downloads, communication and capsule selection. `mutationAvailable:false` must not be overridden in UI.

Never infer durable recovery, delivered notification, native execution, restore readiness, hidden progress, screenshot bytes, or secret values.

## Tests

New aliases:

- `npm run test:edith-phase7d-producers`
- `npm run test:edith-phase7d-native`

Coverage includes persisted producer fixtures, canonical reparse, owner state, completed outcome source reread, forged completion rejection, generated Obsidian marker reread, snapshot-first partial publication, restart truth, Phase6G dual auth positives/negatives, eight fixed native kinds, strict secret/path/pixel/audio rejection, sequence replay, owner mismatch, device credential denial, encrypted device-scoped mobile projection, watcher configuration truth, and kill-switch revocation.

## Remaining Risks

- Advanced state is bounded process memory and is lost on restart by design.
- No event-based OS watcher delivery or push scheduler is connected.
- Cross-device transfer evidence is accepted by existing cross-device services and native download publication, but Outcome transfer references are not promoted to completed evidence until a dedicated server-side resolver is added.
- Existing global Task compare-and-swap and mid-tool abort limitations remain outside Phase 7D.
