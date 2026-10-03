# E.D.I.T.H. Phase 5 Mobile Contract Reconciliation Handoff

Date: 2026-09-28

OWNER: Chat 4 Shared Contracts / Backend Mobile Runtime

SCOPE: Canonical additive mobile wire contracts, Android 13-15 compatible P-256 negotiation, backend contract adapters, directional application encryption, trusted-device lifecycle, authenticated realtime replay, low-risk commands, emergency stop, and bounded encrypted transfer metadata.

STATUS: Backend and canonical contract reconciliation implemented and locally verified. Android transport integration remains intentionally disabled until Chat 2 consumes these exact contracts and reruns interoperability tests.

COMMITS: None. Changes remain in the shared dirty workspace; unrelated owner changes were preserved.

FILES_CHANGED:

- `src/edith/contracts.ts`
- `server/mobile/types.ts`
- `server/mobile/crypto.ts`
- `server/mobile/pairingService.ts`
- `server/mobile/registryStore.ts`
- `server/mobile/middleware.ts`
- `server/mobile/transferService.ts`
- `server/mobile/realtime.ts`
- `server/routes/mobilePairing.ts`
- `server/routes/mobileTasks.ts`
- `server/routes/mobileTransfers.ts`
- `scripts/test-edith-contracts-v2-1.ts`
- `scripts/test-edith-mobile-backend.ts`
- `scripts/test-edith-mobile-contract-reconciliation.ts`
- `scripts/test-edith-backend-security.ts`
- `package.json`
- `docs/EDITH_CHAT4_PHASE5_MOBILE_CONTRACT_RECONCILIATION_HANDOFF_2026-09-28.md`

CONTRACTS_ADDED_OR_CHANGED:

- Protocol: `EDITH_MOBILE_PROTOCOL_VERSION = "edith.mobile/1"`.
- Preferred Android suite: `P256_ECDSA_SHA256_P256_ECDH_HKDF_SHA256_AES256_GCM`.
- Legacy suite remains explicit: `ED25519_X25519_HKDF_SHA256_AES256_GCM`. It is never selected unless offered with matching keys.
- Added strict public key, negotiation, server identity/capability, pairing request/offer/proof/owner-decision/consume, credential metadata, device session, application envelope, remote command/result, emergency-stop event, encrypted chunk, and safe filename contracts/parsers.
- Added canonical realtime event `emergency_stop.activated.v2`.
- `FileTransferDescriptorV2.fileName` now rejects traversal, separators, encoded separators, Windows reserved names, surrounding whitespace, and path-like names.

APIS_ADDED_OR_CHANGED:

- Existing `/api/mobile/*` route set is retained.
- `POST /api/mobile/pairing/request` accepts canonical `MobilePairingRequestV2`; the legacy Ed25519/X25519 request remains an explicit compatibility adapter.
- Pairing response includes canonical `offer`, selected negotiation, server identity, 32-byte challenge, transcript fingerprint, server agreement key, six-digit owner verification code, and expiry.
- `POST /api/mobile/pairing/:pairingId/proof` and `/consume` accept canonical `MobilePairingProofSubmissionV2`; legacy `signature` remains compatibility-only.
- Consume no longer returns token/secret in plaintext JSON. It returns canonical pairing/session metadata plus `credentialEnvelope` encrypted with the new server-to-client session key.
- Session status and rotation results carry canonical session and credential metadata inside authenticated envelopes.
- `/api/mobile/realtime` still requires `Authorization: Device <credential>` over loopback WS or remote WSS and sends canonical realtime events inside encrypted envelopes.
- Transfer chunk purpose is bound to `file.transfer.chunk:<transferId>:<index>` so ciphertext cannot be moved between transfer/index routes.

TESTS_PASS:

- `npm run lint`
- `npm run build`
- `npm run test:edith-contracts-v2-1`
- `npm run test:edith-mobile-backend`
- `npm run test:edith-mobile-contract-reconciliation`
- `npm run test:edith-backend-security`

KNOWN_LIMITATIONS:

- Android `ApplicationEnvelopeCodec` and live network pairing remain fail-closed until Chat 2 implements the consumer adapter and validates these vectors.
- Android must create a second, separate P-256 Keystore key with `PURPOSE_AGREE_KEY`; the existing signing key must not be reused for ECDH.
- Session keys and realtime history are memory-only. Backend restart produces `DEVICE_REPAIR_REQUIRED`; it does not silently restore authority.
- Device authority is bound to the approving owner session identifier and expiry. The current owner-session module does not publish logout/revocation events to the mobile runtime, so an explicit owner logout does not revoke an already issued device credential until that binding expires or the device credential is revoked separately.
- Remote view and destructive computer/browser control remain disabled. Wake-on-LAN and push notifications remain `configuration_required`.
- Realtime replay remains bounded to the current process and 500 retained events.

EXTERNAL_BLOCKERS: Chat 2 must implement the P-256 agreement key, canonical transcript serialization, directional HKDF/AES-GCM codec, device-authenticated WebSocket, encrypted credential bootstrap, and route adapters. Android API 33 and 35 runtime verification plus adverse-network QA remain pending.

DOWNSTREAM_DEPENDENCIES: Chat 2 Mobile Client, then Mobile Security Auditor, then Chat 8 independent QA.

NEXT_OWNER: Chat 2 Android Mobile Client.

DO_NOT_TOUCH: Crypto trading, Mark-L-main, desktop UI/native safety defaults, real computer/browser control, provider secrets, or unrelated routes. Do not enable Android transport before positive and negative interoperability vectors pass.

NOTES_FOR_NEXT_AGENT: No private key, session key, raw credential secret, owner token, API key, or filesystem path is persisted or emitted as public metadata. Legacy registry rows are explicitly marked as the legacy Ed25519/X25519 suite and are never interpreted as P-256.

## Exact Android Contract

### Keys and encodings

- Signing key: EC P-256 (`secp256r1`), Android Keystore `PURPOSE_SIGN`, `SHA-256`, public encoding `SPKI DER` standard Base64, proof encoding ECDSA ASN.1 DER Base64URL without padding.
- Agreement key: separate EC P-256 key, Android Keystore `PURPOSE_AGREE_KEY`, public encoding `SPKI DER` standard Base64.
- `MobilePublicKeyV2.algorithm`: `ECDSA-P256-SHA256` or `ECDH-P256`.
- `MobilePublicKeyV2.encoding`: `spki_der_base64`.
- Fingerprint: lowercase hex `SHA-256(SPKI DER bytes)`.

### Transcript order

UTF-8 lines, terminated only by the separators shown:

```text
edith.mobile.pair.v1
serverId
workspaceId
pairingId
challengeId
deviceId
cryptoSuite
signingKeyFingerprint
agreementKeyFingerprint
serverAgreementKeyFingerprint
requestedCommandsFingerprint
expiresAt
challengeBase64url
```

The consume assertion signs the exact same transcript followed by `\nconsume`.

### Key derivation

```text
shared = ECDH-P256(clientAgreementPrivate, serverAgreementPublic)
root = HKDF-SHA256(shared, challengeBytes, "edith.mobile.session.v1|" + SHA256_HEX(transcript), 32)
clientToServerKey = HKDF-SHA256(root, emptySalt, "edith.mobile.c2s.v1", 32)
serverToClientKey = HKDF-SHA256(root, emptySalt, "edith.mobile.s2c.v1", 32)
```

No software-private-key fallback is allowed when Android Keystore P-256 agreement is unavailable.

### Envelope fields

`contractVersion`, `amendment`, `protocolVersion`, `aadVersion`, `encryption`, `cryptoSuite`, `sessionId`, `serverId`, `deviceId`, `workspaceId`, `sequence`, `direction`, `channel`, `purpose`, `nonceBase64url`, `ciphertextBase64url`, `authTagBase64url`.

- Encryption: `AES-256-GCM`.
- Nonce: random 12 bytes, Base64URL without padding.
- Tag: 16 bytes, Base64URL without padding.
- AAD: canonical JSON of every header field above except nonce/ciphertext/tag, with object keys lexicographically sorted.
- Sequence: exact-next, independently monotonic for each `direction + channel` pair. Replay and gaps are rejected.
- Directions: `client_to_server`, `server_to_client`.
- Channels: `http`, `realtime`, `transfer`.

### Endpoint purpose matrix

- Pairing consume credential: server-to-client, HTTP, `pairing.credential`.
- Session rotate request/result: HTTP, `session.rotate` / `session.rotated`.
- Session status result: server-to-client, HTTP, `session.status`.
- Task create: HTTP, `task.create` / `task.create.result`.
- Pause/resume/cancel: HTTP, command name / `<command>.result`.
- Emergency stop: HTTP, `emergency_stop.activate` / `emergency_stop.result`.
- Realtime resume/events: realtime, `realtime.command` / `realtime.event`.
- Transfer create: transfer, `file.transfer.create` / `file.transfer.created`.
- Transfer chunk: transfer, `file.transfer.chunk:<transferId>:<index>` and matching `.result`.
- Transfer status: server-to-client, transfer, `file.transfer.status`.

### Fail-closed errors

- Unsupported or mismatched suite/key: `MOBILE_CRYPTO_SUITE_UNSUPPORTED`, `MOBILE_CRYPTO_SUITE_KEY_MISMATCH`.
- Bad curve/key/fingerprint: `PAIRING_PUBLIC_KEY_INVALID`, `PAIRING_PUBLIC_KEY_FINGERPRINT_MISMATCH`.
- Transcript/proof mismatch: `PAIRING_PROOF_BINDING_INVALID`, `PAIRING_PROOF_INVALID`, `PAIRING_CONSUME_BINDING_INVALID`.
- Missing in-memory key after restart: `DEVICE_REPAIR_REQUIRED`.
- Envelope mismatch/replay/gap/tamper: `ENVELOPE_BINDING_INVALID`, `ENVELOPE_SEQUENCE_REPLAYED`, `ENVELOPE_SEQUENCE_GAP`, `ENVELOPE_AUTHENTICATION_FAILED`.
- Kill switch: `KILL_SWITCH_ACTIVE`.
- Idempotency conflict: `DEVICE_IDEMPOTENCY_CONFLICT`.

## Chat 2 Handoff

CROSS_CHAT_REQUEST:

FROM_OWNER: Chat 4 Shared Contracts / Backend Mobile Runtime

TO_OWNER: Chat 2 Android Mobile Client

REASON: The pending Android Keystore pairing/envelope contract request is now resolved canonically and implemented in the backend.

REQUESTED_CHANGE: Consume the new canonical mobile contracts without copying enums. Add a separate Keystore ECDH-P256 agreement key, implement the exact transcript, directional HKDF/AES-GCM codec, encrypted credential bootstrap, device-authenticated WSS replay, and canonical command/receipt adapters. Keep all transport surfaces `configuration_required` until positive/negative interoperability tests pass.

FILES_OR_CONTRACTS: `src/edith/contracts.ts`, `/api/mobile/*`, `/api/mobile/realtime`, and the exact algorithms/fields in this handoff.

BLOCKING: Yes for real Android pairing, encrypted commands, credential rotation, realtime, and transfer execution. No backend blocker remains for implementing the Android adapter.

ACCEPTANCE_EVIDENCE: Android API 33/34/35 tests; P-256 positive vector; unsupported Ed/X and P-384 negatives; transcript tamper; workspace/device/server/session/direction/channel/AAD mismatch; nonce/sequence replay and gap; encrypted credential consume; rotated/revoked credential; WSS reconnect/replay; emergency-stop receipt; transfer checksum/idempotency/path tests.
