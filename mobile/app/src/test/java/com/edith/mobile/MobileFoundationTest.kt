package com.edith.mobile

import com.edith.mobile.contracts.CanonicalContractParser
import com.edith.mobile.contracts.DeviceIdentity
import com.edith.mobile.contracts.DeviceTrust
import com.edith.mobile.contracts.FileTransferDescriptor
import com.edith.mobile.contracts.PairingSession
import com.edith.mobile.contracts.PairingStatus
import com.edith.mobile.contracts.PairingChallenge
import com.edith.mobile.contracts.OwnerSessionBinding
import com.edith.mobile.contracts.ParseResult
import com.edith.mobile.contracts.RealtimeEnvelope
import com.edith.mobile.contracts.RealtimeReplayMetadata
import com.edith.mobile.contracts.TrustStatus
import com.edith.mobile.domain.ChecksumState
import com.edith.mobile.domain.CommandAuthorization
import com.edith.mobile.domain.ConnectionPhase
import com.edith.mobile.domain.OfflineCommandQueue
import com.edith.mobile.domain.PairingEvent
import com.edith.mobile.domain.PairingReducer
import com.edith.mobile.domain.PairingState
import com.edith.mobile.domain.QueueState
import com.edith.mobile.domain.RealtimeEvent
import com.edith.mobile.domain.RealtimeReducer
import com.edith.mobile.domain.RealtimeState
import com.edith.mobile.domain.RemoteCommandKind
import com.edith.mobile.domain.TransferEvent
import com.edith.mobile.domain.TransferReducer
import com.edith.mobile.domain.TransferUiState
import com.edith.mobile.domain.VerifiedDeliveryReceipt
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MobileFoundationTest {
    private val parser = CanonicalContractParser()
    private val now = "2099-09-28T12:00:00Z"
    private val authorized = CommandAuthorization(trustedDevice = true, ownerBindingActive = true, capabilityAdvertised = true, ownerBindingId = "binding-1")

    @Test fun `strict V2 realtime parser accepts ordered public payload`() {
        val result = parser.parseRealtime(realtimeJson("pairing.status.v2", "{\"pairingId\":\"pair-1\",\"status\":\"requested\"}"))
        assertTrue(result is ParseResult.Valid)
    }

    @Test fun `secret material is rejected recursively`() {
        val raw = realtimeJson("device.status.v2", "{\"deviceId\":\"pc-1\",\"status\":\"trusted\",\"nested\":{\"session_token\":\"do-not-store\"}}")
        val result = parser.parseRealtime(raw)
        assertEquals("FORBIDDEN_CONTRACT_FIELD", (result as ParseResult.Invalid).code)
    }

    @Test fun `replayed envelope requires replay metadata`() {
        val raw = realtimeJson("device.status.v2", "{\"deviceId\":\"pc-1\",\"status\":\"trusted\"}", replayed = true, replay = "null")
        assertEquals("REALTIME_REPLAY_METADATA_REQUIRED", (parser.parseRealtime(raw) as ParseResult.Invalid).code)
    }

    @Test fun `typed task realtime payload rejects missing required evidence`() {
        val raw = realtimeJson("task.failed.v2", "{\"errorCode\":\"tool_failed\"}")
        assertEquals("REALTIME_PAYLOAD_INVALID", (parser.parseRealtime(raw) as ParseResult.Invalid).code)
    }

    @Test fun `task parser rejects status progress contradiction`() {
        val raw = """{"contract":{"schema":"edith.shared","version":2},"data":{"tasks":[{"id":"task-1","title":"Mobile","objective":"Observe","priority":"high","status":"RUNNING","revision":2,"eventSequence":3,"contractVersion":2,"progress":{"contractVersion":2,"taskId":"task-1","revision":2,"status":"COMPLETED","percent":100,"completedSteps":1,"totalSteps":1,"failedSteps":0,"recoveryAttempts":0,"terminal":true,"sources":["task_status"]}}]}}"""
        assertEquals("TASK_RECORD_INVALID", (parser.parseTaskList(raw) as ParseResult.Invalid).code)
    }

    @Test fun `pairing approval without trust evidence fails closed`() {
        val session = PairingSession("pair-1", DeviceIdentity("phone-1", "Phone", "android", fingerprint = "a".repeat(64)), PairingStatus.APPROVED, now, "2099-09-28T13:00:00Z")
        val state = PairingReducer.reduce(PairingState.Unpaired, PairingEvent.ServerSession(session))
        assertEquals(PairingState.Failed("approved_without_trust_evidence"), state)
    }

    @Test fun `pairing trusted state requires canonical trust`() {
        val trust = DeviceTrust(2, "2.1", "phone-1", workspaceId = "workspace-1", fingerprint = "a".repeat(64), status = TrustStatus.TRUSTED, trustedAt = now, expiresAt = "2099-09-28T13:00:00Z")
        val binding = OwnerSessionBinding(2, "2.1", "binding-1", "owner-session-1", "phone-1", "workspace-1", trust.fingerprint, now, "2099-09-28T13:00:00Z", "active")
        val session = PairingSession("pair-1", DeviceIdentity("phone-1", "Phone", "android", fingerprint = trust.fingerprint), PairingStatus.APPROVED, now, "2099-09-28T13:00:00Z", challenge = consumedChallenge(), trust = trust, ownerBinding = binding)
        val current = PairingState.AwaitingOwner("pair-1", trust.fingerprint, "2099-09-28T13:00:00Z")
        assertTrue(PairingReducer.reduce(current, PairingEvent.ServerSession(session)) is PairingState.Trusted)
    }

    @Test fun `pairing rejects mismatched owner binding fingerprint`() {
        val trust = DeviceTrust(2, "2.1", "phone-1", workspaceId = "workspace-1", fingerprint = "a".repeat(64), status = TrustStatus.TRUSTED, trustedAt = now, expiresAt = "2099-09-28T13:00:00Z")
        val binding = OwnerSessionBinding(2, "2.1", "binding-1", "owner-session-1", "phone-1", "workspace-1", "b".repeat(64), now, "2099-09-28T13:00:00Z", "active")
        val session = PairingSession("pair-1", DeviceIdentity("phone-1", "Phone", "android", fingerprint = trust.fingerprint), PairingStatus.APPROVED, now, "2099-09-28T13:00:00Z", challenge = consumedChallenge(), trust = trust, ownerBinding = binding)
        val current = PairingState.AwaitingOwner("pair-1", trust.fingerprint, "2099-09-28T13:00:00Z")
        assertEquals(PairingState.Failed("device_fingerprint_mismatch"), PairingReducer.reduce(current, PairingEvent.ServerSession(session)))
    }

    @Test fun `realtime reducer rejects duplicate and cursor gaps`() {
        val base = RealtimeState(ConnectionPhase.CONNECTED, streamId = "stream-1", cursor = 4)
        val duplicate = RealtimeReducer.reduce(base, RealtimeEvent.EnvelopeReceived(envelope(cursor = 4)))
        assertFalse(duplicate.accepted)
        assertEquals(ConnectionPhase.CONFLICT, duplicate.state.phase)
        val gap = RealtimeReducer.reduce(base, RealtimeEvent.EnvelopeReceived(envelope(cursor = 7)))
        assertEquals("cursor_gap", gap.reasonCode)
    }

    @Test fun `replay window cannot skip missing envelopes`() {
        val base = RealtimeState(ConnectionPhase.CONNECTED, streamId = "stream-1", cursor = 4)
        val replay = envelope(cursor = 7, replayed = true, replay = RealtimeReplayMetadata(4, 5, 7, false))
        val result = RealtimeReducer.reduce(base, RealtimeEvent.EnvelopeReceived(replay))
        assertFalse(result.accepted)
        assertEquals("cursor_gap", result.reasonCode)
    }

    @Test fun `replay events are accepted one cursor at a time`() {
        val base = RealtimeState(ConnectionPhase.CONNECTED, streamId = "stream-1", cursor = 4)
        val replay = envelope(cursor = 5, replayed = true, replay = RealtimeReplayMetadata(4, 5, 7, false))
        val result = RealtimeReducer.reduce(base, RealtimeEvent.EnvelopeReceived(replay))
        assertTrue(result.accepted)
        assertEquals(5, result.state.cursor)
    }

    @Test fun `reconnect backoff is bounded`() {
        assertEquals(1_000L, RealtimeReducer.backoff(1))
        assertEquals(30_000L, RealtimeReducer.backoff(20))
    }

    @Test fun `offline emergency stop is first and never marked delivered`() {
        val queue = OfflineCommandQueue()
        queue.enqueue(RemoteCommandKind.REFRESH_TASKS, "pc-1", false, online = false, authorization = authorized, now = 1)
        val stop = queue.enqueue(RemoteCommandKind.EMERGENCY_STOP, "pc-1", true, online = false, authorization = authorized, now = 2)
        assertEquals(QueueState.FAILED, stop.state)
        assertEquals("emergency_stop_not_delivered_offline", stop.safeErrorCode)
        assertEquals(RemoteCommandKind.EMERGENCY_STOP, queue.snapshot().first().kind)
    }

    @Test fun `confirmation gated command cannot enter pending queue`() {
        val item = OfflineCommandQueue().enqueue(RemoteCommandKind.REQUEST_FILE, "pc-1", confirmed = false, online = true, authorization = authorized, now = 1)
        assertEquals(QueueState.FAILED, item.state)
        assertEquals("confirmation_required", item.safeErrorCode)
    }

    @Test fun `queue requires current trust binding capability and verified delivery receipt`() {
        val queue = OfflineCommandQueue()
        val denied = queue.enqueue(
            RemoteCommandKind.REFRESH_TASKS,
            "pc-1",
            confirmed = true,
            online = true,
            authorization = authorized.copy(ownerBindingActive = false),
            now = 1,
        )
        assertEquals("owner_binding_required", denied.safeErrorCode)
        val pending = queue.enqueue(RemoteCommandKind.REFRESH_TASKS, "pc-1", true, true, authorized, 2)
        val sending = queue.transition(pending.id, QueueState.SENDING, authorization = authorized)
        assertTrue(runCatching { queue.transition(sending.id, QueueState.DELIVERED, authorization = authorized) }.isFailure)
        val receipt = VerifiedDeliveryReceipt("receipt-1", sending.id, "pc-1", "binding-1", now)
        assertEquals(QueueState.DELIVERED, queue.transition(sending.id, QueueState.DELIVERED, authorization = authorized, receipt = receipt).state)
    }

    @Test fun `transfer progress is monotonic and checksum mismatch is explicit`() {
        val descriptor = FileTransferDescriptor("tx-1", "report.pdf", "application/pdf", 100, "a".repeat(64), "download", "transferring")
        val start = TransferUiState(descriptor, 10, ChecksumState.PENDING, true)
        val progressed = TransferReducer.reduce(start, TransferEvent.Progress(50))
        assertEquals(50, progressed.percent)
        val failed = TransferReducer.reduce(progressed, TransferEvent.Checksum(false))
        assertEquals(ChecksumState.FAILED, failed.checksum)
        assertEquals("checksum_mismatch", failed.safeErrorCode)
        assertTrue(runCatching { TransferReducer.reduce(progressed, TransferEvent.Progress(20)) }.isFailure)
    }

    @Test fun `transfer parser rejects zero chunk and completed next index`() {
        val raw = """{
          "transferId":"tx-1","fileName":"report.pdf","mediaType":"application/pdf","sizeBytes":10,
          "sha256":"${"a".repeat(64)}","direction":"download","status":"transferring",
          "chunkManifest":{"contractVersion":2,"amendment":"2.1","transferId":"tx-1","sizeBytes":10,
            "chunkSizeBytes":10,"totalChunks":1,"fileSha256":"${"a".repeat(64)}",
            "chunks":[{"index":0,"offsetBytes":0,"sizeBytes":0,"sha256":"${"b".repeat(64)}"}]},
          "resume":{"contractVersion":2,"amendment":"2.1","resumable":true,"nextChunkIndex":0,
            "completedChunkIndexes":[0],"retryCount":0,"maxRetries":2,"acknowledgedBytes":0}
        }"""
        assertEquals("TRANSFER_MANIFEST_INVALID", (parser.parseTransfer(raw) as ParseResult.Invalid).code)
    }

    private fun envelope(cursor: Long, replayed: Boolean = false, replay: RealtimeReplayMetadata? = null) = RealtimeEnvelope(
        schema = "edith.shared", version = 2, event = "device.status.v2", eventId = "event-$cursor", occurredAt = now,
        sequence = cursor, streamId = "stream-1", cursor = cursor, correlationId = "corr-$cursor", replayed = replayed, replay = replay,
        payload = buildJsonObject { put("deviceId", "pc-1"); put("status", "trusted") },
    )

    private fun realtimeJson(event: String, payload: String, replayed: Boolean = false, replay: String = "null") =
        """{"schema":"edith.shared","version":2,"event":"$event","eventId":"event-1","occurredAt":"$now","sequence":1,"streamId":"stream-1","cursor":1,"correlationId":"corr-1","replayed":$replayed,"replay":$replay,"payload":$payload}"""

    private fun consumedChallenge() = PairingChallenge(
        contractVersion = 2,
        amendment = "2.1",
        challengeId = "challenge-1",
        pairingId = "pair-1",
        deviceId = "phone-1",
        workspaceId = "workspace-1",
        algorithm = "ECDSA-P256-SHA256",
        challengeFingerprint = "c".repeat(64),
        issuedAt = now,
        expiresAt = "2099-09-28T13:00:00Z",
        consumedAt = "2099-09-28T12:01:00Z",
        oneTime = true,
        status = "consumed",
    )
}
