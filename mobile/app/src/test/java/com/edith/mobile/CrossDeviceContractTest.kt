package com.edith.mobile

import com.edith.mobile.contracts.CrossDeviceAudioHandoff
import com.edith.mobile.contracts.AdvancedMobileParser
import com.edith.mobile.contracts.AdvancedMobileProjection
import com.edith.mobile.contracts.MobileAdvancedState
import com.edith.mobile.contracts.MobileAdvancedStatus
import com.edith.mobile.contracts.CrossDeviceCapabilities
import com.edith.mobile.contracts.CrossDeviceClipboardMetadata
import com.edith.mobile.contracts.CrossDeviceDestination
import com.edith.mobile.contracts.CrossDeviceOfflineQueueItem
import com.edith.mobile.contracts.CrossDeviceParser
import com.edith.mobile.contracts.CrossDevicePcStatus
import com.edith.mobile.contracts.CrossDeviceProgress
import com.edith.mobile.contracts.CrossDeviceQuietHours
import com.edith.mobile.contracts.CrossDeviceTransfer
import com.edith.mobile.contracts.CrossDeviceTransferCapabilities
import com.edith.mobile.contracts.CanonicalContractParser
import com.edith.mobile.contracts.CrossDeviceWire
import com.edith.mobile.contracts.ParseResult
import com.edith.mobile.contracts.QueuedCommandMetadata
import com.edith.mobile.contracts.MobileRemoteCommandResultWire
import com.edith.mobile.contracts.PcMetrics
import com.edith.mobile.contracts.PcStatusFreshnessPolicy
import com.edith.mobile.contracts.TransferResume
import com.edith.mobile.contracts.sha256Hex
import com.edith.mobile.domain.CrossDeviceReducer
import com.edith.mobile.domain.CrossDeviceState
import java.time.Instant
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.encodeToJsonElement
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CrossDeviceContractTest {
    private val json = Json { ignoreUnknownKeys = false; explicitNulls = false }
    private val parser = CrossDeviceParser(json)
    private val now = Instant.now().minusSeconds(1)
    private val hash = "a".repeat(64)

    @Test fun capabilitiesRemainTruthfulAndStrict() {
        val capabilities = CrossDeviceCapabilities("available", "available", "available", "available", "available", "available", "configuration_required", "configuration_required", "configuration_required", "configuration_required", "metadata_only", "memory_only")
        assertTrue(parser.capabilities(json.encodeToJsonElement(capabilities)) is ParseResult.Valid)
        assertTrue(parser.capabilities(json.encodeToJsonElement(capabilities.copy(persistence = "available"))) is ParseResult.Invalid)
        val unknown = json.parseToJsonElement(json.encodeToString(capabilities).dropLast(1) + ",\"fakeOnline\":true}")
        assertTrue(parser.capabilities(unknown) is ParseResult.Invalid)
    }

    @Test fun consumedClipboardRejectsSecretsAndReplayRegresses() {
        val content = "access_token=do-not-display"
        val metadata = clipboard("consumed", content)
        val payload = json.parseToJsonElement("{\"metadata\":${json.encodeToString(metadata)},\"content\":${json.encodeToString(content)}}")
        assertEquals("CROSS_DEVICE_CLIPBOARD_SENSITIVE_CONTENT", (parser.consumedClipboard(payload) as ParseResult.Invalid).code)
        val current = CrossDeviceReducer.clipboard(CrossDeviceState(), metadata)
        assertEquals("clipboard_replay_rejected", CrossDeviceReducer.clipboard(current, metadata.copy(status = "available")).safeErrorCode)
    }

    @Test fun transferRequiresByteBackedVerifiedCompletionAndRejectsCollision() {
        val incomplete = transfer().copy(status = "completed")
        assertEquals("CROSS_DEVICE_TRANSFER_PROGRESS_INVALID", (parser.transfer(json.encodeToJsonElement(incomplete)) as ParseResult.Invalid).code)
        val collision = transfer().copy(destination = transfer().destination.copy(collisionDetected = true), status = "transferring")
        assertEquals("CROSS_DEVICE_TRANSFER_COLLISION_UNRESOLVED", (parser.transfer(json.encodeToJsonElement(collision)) as ParseResult.Invalid).code)
    }

    @Test fun queueForbidsEmergencyAndCompletionWithoutVerifiedResult() {
        val item = queue("pending")
        val emergency = item.copy(command = item.command.copy(command = "emergency_stop"))
        assertEquals("EMERGENCY_STOP_QUEUE_FORBIDDEN", (parser.queueItem(json.encodeToJsonElement(emergency)) as ParseResult.Invalid).code)
        val completed = item.copy(status = "completed")
        assertEquals("CROSS_DEVICE_OFFLINE_QUEUE_RESULT_INVALID", (parser.queueItem(json.encodeToJsonElement(completed)) as ParseResult.Invalid).code)
        val mismatched = item.copy(status = "completed", result = MobileRemoteCommandResultWire(2, "2.1", "other-command", "mobile", "workspace", "session", "completed", now.plusSeconds(2).toString()))
        assertEquals("CROSS_DEVICE_OFFLINE_QUEUE_RESULT_INVALID", (parser.queueItem(json.encodeToJsonElement(mismatched)) as ParseResult.Invalid).code)
    }

    @Test fun reducerRejectsProgressRegressionAndConcurrentAudioLease() {
        val first = transfer().copy(progress = CrossDeviceProgress(50, 100, 50.0, "pending"), updatedAt = now.plusSeconds(2).toString())
        val state = CrossDeviceReducer.transfer(CrossDeviceState(), first)
        val regressed = transfer().copy(progress = CrossDeviceProgress(20, 100, 20.0, "pending"), updatedAt = now.plusSeconds(3).toString())
        assertEquals("transfer_progress_regression", CrossDeviceReducer.transfer(state, regressed).safeErrorCode)
        val lease = audio("lease-a", 2, "active")
        val audioState = CrossDeviceReducer.audio(CrossDeviceState(), lease)
        assertEquals("simultaneous_audio_capture_forbidden", CrossDeviceReducer.audio(audioState, audio("lease-b", 2, "active")).safeErrorCode)
        assertEquals("simultaneous_audio_capture_forbidden", CrossDeviceReducer.audio(audioState, audio("lease-b", 3, "requested")).safeErrorCode)
        assertNull(CrossDeviceReducer.audio(audioState, lease.copy(status = "released")).audioLease)
    }

    @Test fun quietHoursMetadataRevisionIsMonotonic() {
        val first = CrossDeviceQuietHours(2, "2.1", "workspace", "owner", 2, true, "22:00", "07:00", "Europe/Istanbul", true, true, now.toString())
        val state = CrossDeviceReducer.quietHours(CrossDeviceState(), first)
        assertEquals("quiet_hours_revision_stale", CrossDeviceReducer.quietHours(state, first.copy(revision = 1)).safeErrorCode)
    }

    @Test fun pcStatusRejectsStaleFirstSnapshotAgainstInjectedClock() {
        val fixedNow = Instant.parse("2026-09-28T12:00:00Z")
        val fixedParser = CrossDeviceParser(json) { fixedNow }
        val stale = pcStatus(fixedNow.minusSeconds(60).minusNanos(1), fixedNow.minusNanos(1), "stale-first")

        val result = fixedParser.pcStatus(json.encodeToJsonElement(stale))

        assertEquals(PcStatusFreshnessPolicy.STALE_CODE, (result as ParseResult.Invalid).code)
    }

    @Test fun pcStatusRejectsExpiredSnapshotAgainstInjectedClock() {
        val fixedNow = Instant.parse("2026-09-28T12:00:00Z")
        val fixedParser = CrossDeviceParser(json) { fixedNow }
        val expired = pcStatus(fixedNow.minusSeconds(30), fixedNow, "expired")

        val result = fixedParser.pcStatus(json.encodeToJsonElement(expired))

        assertEquals(PcStatusFreshnessPolicy.EXPIRED_CODE, (result as ParseResult.Invalid).code)
    }

    @Test fun pcStatusRejectsExcessiveFutureSkewAgainstInjectedClock() {
        val fixedNow = Instant.parse("2026-09-28T12:00:00Z")
        val fixedParser = CrossDeviceParser(json) { fixedNow }
        val future = pcStatus(fixedNow.plusSeconds(5).plusNanos(1), fixedNow.plusSeconds(30), "future")

        val result = fixedParser.pcStatus(json.encodeToJsonElement(future))

        assertEquals(PcStatusFreshnessPolicy.FUTURE_CODE, (result as ParseResult.Invalid).code)
    }

    @Test fun pcStatusRejectsOlderOrEqualRevisionAndObservedAt() {
        val fixedNow = Instant.parse("2026-09-28T12:00:00Z")
        val accepted = pcStatus(fixedNow.minusSeconds(10), fixedNow.plusSeconds(20), "accepted")
        val current = CrossDeviceReducer.pcStatus(CrossDeviceState(), accepted, fixedNow, revision = 10)

        val equalRevision = pcStatus(fixedNow.minusSeconds(5), fixedNow.plusSeconds(25), "equal-revision")
        val revisionRejected = CrossDeviceReducer.pcStatus(current, equalRevision, fixedNow, revision = 10)
        assertEquals("pc_status_revision_stale", revisionRejected.safeErrorCode)
        assertEquals("accepted", revisionRejected.pcStatus?.snapshotId)

        val equalObservedAt = pcStatus(fixedNow.minusSeconds(10), fixedNow.plusSeconds(25), "equal-observed")
        val observedRejected = CrossDeviceReducer.pcStatus(current, equalObservedAt, fixedNow, revision = 11)
        assertEquals("pc_status_observed_at_stale", observedRejected.safeErrorCode)
        assertEquals("accepted", observedRejected.pcStatus?.snapshotId)
    }

    @Test fun reconnectReplayCannotReplaceFreshStatusWithStaleSnapshot() {
        val fixedNow = Instant.parse("2026-09-28T12:00:00Z")
        val accepted = pcStatus(fixedNow.minusSeconds(5), fixedNow.plusSeconds(30), "connected")
        val connected = CrossDeviceReducer.pcStatus(CrossDeviceState(), accepted, fixedNow, revision = 20)
        val delayedReplay = pcStatus(fixedNow.minusSeconds(60).minusNanos(1), fixedNow.plusNanos(1), "reconnect-replay")

        val afterReconnect = CrossDeviceReducer.pcStatus(connected, delayedReplay, fixedNow, revision = 21)

        assertEquals(PcStatusFreshnessPolicy.STALE_CODE, afterReconnect.safeErrorCode)
        assertEquals("connected", afterReconnect.pcStatus?.snapshotId)
        assertEquals(20L, afterReconnect.pcStatusRevision)
    }

    @Test fun reconnectEnvelopeKeepsFreshnessDecisionInCrossDeviceLayer() {
        val fixedNow = Instant.parse("2026-09-28T12:00:00Z")
        val stale = pcStatus(fixedNow.minusSeconds(60).minusNanos(1), fixedNow.minusNanos(1), "replayed")
        val payload = json.encodeToString(stale)
        val raw = """{"schema":"edith.shared","version":2,"event":"${CrossDeviceWire.PC_STATUS_EVENT}","eventId":"event-41","occurredAt":"$fixedNow","sequence":41,"streamId":"stream-1","cursor":41,"correlationId":"corr-41","replayed":true,"replay":{"requestedAfterCursor":40,"windowStartCursor":41,"windowEndCursor":41,"truncated":false},"payload":$payload}"""

        val envelope = CanonicalContractParser(json) { fixedNow }.parseRealtime(raw)

        assertTrue(envelope is ParseResult.Valid)
        val parsedPayload = (envelope as ParseResult.Valid).value.payload
        val crossResult = CrossDeviceParser(json) { fixedNow }.realtime(CrossDeviceWire.PC_STATUS_EVENT, parsedPayload)
        assertEquals(PcStatusFreshnessPolicy.STALE_CODE, (crossResult as ParseResult.Invalid).code)
    }

    @Test fun pcStatusFreshnessBoundariesRemainValid() {
        val fixedNow = Instant.parse("2026-09-28T12:00:00Z")
        val fixedParser = CrossDeviceParser(json) { fixedNow }
        val oldestValid = pcStatus(fixedNow.minusSeconds(60).plusNanos(1), fixedNow.plusNanos(1), "oldest-valid")
        val furthestFutureValid = pcStatus(fixedNow.plusSeconds(5), fixedNow.plusSeconds(30), "future-valid")

        assertTrue(fixedParser.pcStatus(json.encodeToJsonElement(oldestValid)) is ParseResult.Valid)
        assertTrue(fixedParser.pcStatus(json.encodeToJsonElement(furthestFutureValid)) is ParseResult.Valid)
    }

    @Test fun statusExpiryKeepsReplayWatermarkUntilAuthorityClears() {
        val fixedNow = Instant.parse("2026-09-28T12:00:00Z")
        val accepted = pcStatus(fixedNow.minusSeconds(5), fixedNow.plusSeconds(1), "accepted")
        val current = CrossDeviceReducer.pcStatus(CrossDeviceState(), accepted, fixedNow, revision = 12)

        val expired = CrossDeviceReducer.clearExpiredPcStatus(current, fixedNow.plusSeconds(1))
        assertNull(expired.pcStatus)
        assertEquals(12L, expired.pcStatusRevision)

        val cleared = CrossDeviceReducer.clearAuthority(expired)
        assertNull(cleared.pcStatus)
        assertNull(cleared.pcStatusRevision)
    }

    @Test fun httpSnapshotPreservesRealtimeReplayWatermark() {
        val fixedNow = Instant.parse("2026-09-28T12:00:00Z")
        val realtime = pcStatus(fixedNow.minusSeconds(10), fixedNow.plusSeconds(20), "realtime")
        val current = CrossDeviceReducer.pcStatus(CrossDeviceState(), realtime, fixedNow, revision = 30)
        val refreshed = pcStatus(fixedNow.minusSeconds(5), fixedNow.plusSeconds(25), "http-refresh")

        val afterRefresh = CrossDeviceReducer.pcStatus(current, refreshed, fixedNow)

        assertEquals("http-refresh", afterRefresh.pcStatus?.snapshotId)
        assertEquals(30L, afterRefresh.pcStatusRevision)
    }

    @Test fun advancedMobileProjectionRemainsEncryptedReadOnlyAndTruthful() {
        val advancedParser = AdvancedMobileParser(json)
        val projection = advancedProjection()

        val parsed = advancedParser.state(json.encodeToJsonElement(projection))

        assertTrue(parsed is ParseResult.Valid)
        assertTrue(advancedParser.lineageMatches((parsed as ParseResult.Valid).value, "binding", "workspace"))
        assertTrue(!projection.mutationAvailable)
        assertEquals("memory_only", projection.status.persistence)
        assertEquals("partial", projection.status.restartRecovery)
    }

    @Test fun advancedMobileProjectionRejectsMutationAvailabilityAndUnknownSecretFields() {
        val advancedParser = AdvancedMobileParser(json)
        val writable = advancedProjection().copy(mutationAvailable = true)
        assertEquals("ADVANCED_MOBILE_READ_ONLY_REQUIRED", (advancedParser.state(json.encodeToJsonElement(writable)) as ParseResult.Invalid).code)

        val raw = json.encodeToString(advancedProjection()).dropLast(1) + ",\"apiKey\":\"must-not-parse\"}"
        assertEquals("MALFORMED_ADVANCED_MOBILE_STATE", (advancedParser.state(json.parseToJsonElement(raw)) as ParseResult.Invalid).code)
    }

    private fun clipboard(status: String, content: String) = CrossDeviceClipboardMetadata(
        2, "2.1", "binding", "workspace", "session", "mobile", "server", "clipboard", "pc_to_mobile", "text/plain",
        true, false, now.toString(), now.plusSeconds(120).toString(), content.encodeToByteArray().size, sha256Hex(content.encodeToByteArray()), status, false,
    )

    private fun transfer() = CrossDeviceTransfer(
        2, "2.1", "binding", "workspace", "session", "mobile", "server", "transfer", "mobile_to_pc", "document", "note.txt", "text/plain",
        sizeBytes = 100, sha256 = hash, status = "transferring", progress = CrossDeviceProgress(0, 100, 0.0, "pending"),
        destination = CrossDeviceDestination("desktop", "opaque-handle", "Approved desktop inbox", "reject", false),
        resume = TransferResume(2, "2.1", true, 0, emptyList(), 0, 3, 0), capabilities = CrossDeviceTransferCapabilities(false, false, false, false),
        createdAt = now.toString(), updatedAt = now.toString(), expiresAt = now.plusSeconds(600).toString(),
    )

    private fun queue(status: String) = CrossDeviceOfflineQueueItem(
        2, "2.1", "binding", "workspace", "session", "mobile", "server", "queue",
        QueuedCommandMetadata("command", "task.list", "mobile", "workspace", "session", "idem", 1, now.toString(), now.plusSeconds(600).toString(), hash),
        status, true, now.toString(), now.plusSeconds(600).toString(),
    )

    private fun audio(lease: String, epoch: Int, status: String) = CrossDeviceAudioHandoff(
        ownerSessionBindingId = "binding", workspaceId = "workspace", sessionId = "session", sourceDeviceId = "mobile", targetDeviceId = "server",
        handoffId = "handoff", leaseId = lease, epoch = epoch, sourceCaptureDeviceId = "mobile", targetCaptureDeviceId = "server", status = status,
        requestedAt = now.toString(), expiresAt = now.plusSeconds(300).toString(),
    )

    private fun pcStatus(observedAt: Instant, expiresAt: Instant, snapshotId: String) = CrossDevicePcStatus(
        contractVersion = 2,
        amendment = "2.1",
        ownerSessionBindingId = "binding",
        workspaceId = "workspace",
        sessionId = "session",
        sourceDeviceId = "server",
        targetDeviceId = "mobile",
        snapshotId = snapshotId,
        runtime = "ready",
        observedAt = observedAt.toString(),
        expiresAt = expiresAt.toString(),
        metrics = PcMetrics(cpuPercent = 20.0, ramPercent = 40.0, networkState = "online"),
        source = "backend_runtime",
    )

    private fun advancedProjection() = AdvancedMobileProjection(
        status = MobileAdvancedStatus(
            persistence = "memory_only",
            restartRecovery = "partial",
            nativeExecution = "configuration_required",
            scheduler = "configuration_required",
            watcherObservation = "metadata_only",
            watcherDelivery = "configuration_required",
            mobileRead = "available",
            secretsStored = false,
        ),
        state = MobileAdvancedState(
            priority = emptyList(),
            ghosts = emptyList(),
            watchers = emptyList(),
            downloads = emptyList(),
            communication = emptyList(),
            capsuleSelection = emptyList(),
        ),
        deviceScoped = true,
        mutationAvailable = false,
    )
}
