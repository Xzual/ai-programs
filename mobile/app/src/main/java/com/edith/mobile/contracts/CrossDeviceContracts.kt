package com.edith.mobile.contracts

import java.time.Duration
import java.time.Instant
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

object CrossDeviceWire {
    const val TRANSFER_EVENT = "cross_device.transfer.status.v2"
    const val CLIPBOARD_EVENT = "cross_device.clipboard.status.v2"
    const val OFFLINE_QUEUE_EVENT = "cross_device.offline_queue.status.v2"
    const val HANDOFF_EVENT = "cross_device.handoff.status.v2"
    const val RESULT_CARD_EVENT = "cross_device.result_card.updated.v2"
    const val AUDIO_EVENT = "cross_device.audio_handoff.status.v2"
    const val PC_STATUS_EVENT = "cross_device.pc_status.updated.v2"
    const val LIVE_VIEW_EVENT = "cross_device.live_view.status.v2"
    const val LIVE_VIEW_FRAME_EVENT = "cross_device.live_view.frame_metadata.v2"
    const val WAKE_EVENT = "cross_device.wake_ready.status.v2"

    val events = setOf(TRANSFER_EVENT, CLIPBOARD_EVENT, OFFLINE_QUEUE_EVENT, HANDOFF_EVENT, RESULT_CARD_EVENT, AUDIO_EVENT, PC_STATUS_EVENT, LIVE_VIEW_EVENT, LIVE_VIEW_FRAME_EVENT, WAKE_EVENT)
    val commands = setOf("clipboard.publish", "clipboard.consume", "offline_queue.manage", "handoff.manage", "result_card.read", "audio_handoff.manage")
}

@Serializable
data class CrossDeviceCapabilities(
    val clipboard: String,
    val offlineQueue: String,
    val smartHandoff: String,
    val resultCards: String,
    val audioHandoff: String,
    val mobileToPcTransfer: String,
    val pcToMobileTransfer: String,
    val liveView: String,
    val wakeOnLan: String,
    val pcStatus: String,
    val quietHours: String,
    val persistence: String,
)

@Serializable
data class CrossDeviceClipboardRequest(
    val contractVersion: Int = EDITH_VERSION,
    val amendment: String = EDITH_AMENDMENT,
    val ownerSessionBindingId: String,
    val workspaceId: String,
    val sessionId: String,
    val sourceDeviceId: String,
    val targetDeviceId: String,
    val clipboardId: String,
    val direction: String,
    val mimeType: String,
    val content: String,
    val explicitConsent: Boolean = true,
    val persistHistory: Boolean = false,
    val issuedAt: String,
    val expiresAt: String,
)

@Serializable
data class CrossDeviceClipboardMetadata(
    val contractVersion: Int,
    val amendment: String,
    val ownerSessionBindingId: String,
    val workspaceId: String,
    val sessionId: String,
    val sourceDeviceId: String,
    val targetDeviceId: String,
    val clipboardId: String,
    val direction: String,
    val mimeType: String,
    val explicitConsent: Boolean,
    val persistHistory: Boolean,
    val issuedAt: String,
    val expiresAt: String,
    val contentBytes: Int,
    val contentFingerprint: String,
    val status: String,
    val sensitive: Boolean,
)

@Serializable data class ClipboardPublishedPayload(val metadata: CrossDeviceClipboardMetadata)
@Serializable data class ClipboardConsumedPayload(val metadata: CrossDeviceClipboardMetadata, val content: String)

@Serializable
data class CrossDeviceProgress(val bytesTransferred: Long, val totalBytes: Long, val percent: Double, val integrity: String)

@Serializable
data class CrossDeviceDestination(
    val kind: String,
    val opaqueHandle: String,
    val displaySummary: String,
    val conflictPolicy: String,
    val collisionDetected: Boolean,
)

@Serializable data class CrossDeviceTransferCapabilities(val open: Boolean, val export: Boolean, val share: Boolean, val openLocation: Boolean)
@Serializable data class CrossDeviceCandidateEvidence(val candidateId: String, val source: String, val verified: Boolean, val evidenceSummary: String)

@Serializable
data class CrossDeviceTransfer(
    val contractVersion: Int,
    val amendment: String,
    val ownerSessionBindingId: String,
    val workspaceId: String,
    val sessionId: String,
    val sourceDeviceId: String,
    val targetDeviceId: String,
    val transferId: String,
    val direction: String,
    val category: String,
    val fileName: String,
    val mediaType: String,
    val sourceComputerLabel: String? = null,
    val sizeBytes: Long,
    val sha256: String,
    val status: String,
    val progress: CrossDeviceProgress,
    val destination: CrossDeviceDestination,
    val resume: TransferResume,
    val capabilities: CrossDeviceTransferCapabilities,
    val candidateEvidence: CrossDeviceCandidateEvidence? = null,
    val createdAt: String,
    val updatedAt: String,
    val expiresAt: String,
    val errorCode: String? = null,
)

@Serializable data class TransferCreatePayload(val descriptor: FileTransferDescriptor, val crossDeviceTransfer: CrossDeviceTransfer, val idempotentReplay: Boolean, val commandResult: MobileRemoteCommandResultWire)
@Serializable data class TransferChunkPayload(val descriptor: FileTransferDescriptor, val crossDeviceTransfer: CrossDeviceTransfer, val commandResult: MobileRemoteCommandResultWire)

@Serializable
data class QueuedCommandMetadata(
    val commandId: String,
    val command: String,
    val deviceId: String,
    val workspaceId: String,
    val sessionId: String,
    val idempotencyKey: String,
    val riskLevel: Int,
    val issuedAt: String,
    val expiresAt: String,
    val payloadFingerprint: String,
)

@Serializable
data class CrossDeviceOfflineQueueItem(
    val contractVersion: Int,
    val amendment: String,
    val ownerSessionBindingId: String,
    val workspaceId: String,
    val sessionId: String,
    val sourceDeviceId: String,
    val targetDeviceId: String,
    val queueItemId: String,
    val command: QueuedCommandMetadata,
    val status: String,
    val encryptedAtRest: Boolean,
    val queuedAt: String,
    val expiresAt: String,
    val cancelledAt: String? = null,
    val dispatchedAt: String? = null,
    val completedAt: String? = null,
    val result: MobileRemoteCommandResultWire? = null,
    val errorCode: String? = null,
)

@Serializable data class QueueItemPayload(val item: CrossDeviceOfflineQueueItem)
@Serializable data class QueueDispatchEntry(val item: CrossDeviceOfflineQueueItem, val command: MobileRemoteCommandWire)
@Serializable data class QueueDispatchPayload(val items: List<QueueDispatchEntry>)

@Serializable
data class CrossDeviceHandoff(
    val contractVersion: Int = EDITH_VERSION,
    val amendment: String = EDITH_AMENDMENT,
    val ownerSessionBindingId: String,
    val workspaceId: String,
    val sessionId: String,
    val sourceDeviceId: String,
    val targetDeviceId: String,
    val handoffId: String,
    val direction: String,
    val intent: String,
    val taskId: String? = null,
    val resultId: String? = null,
    val artifactIds: List<String>,
    val status: String,
    val requestedAt: String,
    val expiresAt: String,
    val acknowledgedAt: String? = null,
)

@Serializable data class HandoffPayload(val handoff: CrossDeviceHandoff)

@Serializable data class SharedProvenance(val sourceType: String, val sourceId: String, val observedAt: String, val verified: Boolean)
@Serializable data class SharedPreview(val safeText: String? = null, val mediaType: String? = null, val artifactRef: String? = null, val redacted: Boolean)
@Serializable data class SharedArtifactRef(val artifactId: String, val mediaType: String, val checksumSha256: String? = null, val checksumStatus: String, val provenance: SharedProvenance, val retention: String, val ownerSessionBindingId: String, val downloadHandle: String? = null)
@Serializable data class SharedResultAction(val action: String, val available: Boolean, val requiresApproval: Boolean)

@Serializable
data class SharedResultCard(
    val contractVersion: Int,
    val amendment: String,
    val ownerSessionBindingId: String,
    val workspaceId: String,
    val sessionId: String,
    val sourceDeviceId: String,
    val targetDeviceId: String,
    val cardId: String,
    val kind: String,
    val title: String,
    val summary: String,
    val outcome: String,
    val provenance: SharedProvenance,
    val preview: SharedPreview,
    val artifactRefs: List<SharedArtifactRef>,
    val actions: List<SharedResultAction>,
    val revision: Int,
    val createdAt: String,
    val updatedAt: String,
    val expiresAt: String? = null,
)

@Serializable data class ResultCardsPayload(val cards: List<SharedResultCard>)
@Serializable data class PcStatusPayload(val status: CrossDevicePcStatus)

@Serializable
data class CrossDeviceAudioHandoff(
    val contractVersion: Int = EDITH_VERSION,
    val amendment: String = EDITH_AMENDMENT,
    val ownerSessionBindingId: String,
    val workspaceId: String,
    val sessionId: String,
    val sourceDeviceId: String,
    val targetDeviceId: String,
    val handoffId: String,
    val leaseId: String,
    val epoch: Int,
    val sourceCaptureDeviceId: String,
    val targetCaptureDeviceId: String,
    val status: String,
    val simultaneousCaptureAllowed: Boolean = false,
    val quietHoursRevision: Int? = null,
    val requestedAt: String,
    val acknowledgedAt: String? = null,
    val expiresAt: String,
)

@Serializable data class AudioHandoffPayload(val handoff: CrossDeviceAudioHandoff)

@Serializable data class LiveViewFramePolicy(val maxFramesPerSecond: Int, val maxWidth: Int, val maxHeight: Int)
@Serializable data class LiveViewOverlayCapabilities(val cursor: Boolean, val click: Boolean, val target: Boolean, val operatorState: Boolean)
@Serializable
data class CrossDeviceLiveView(
    val contractVersion: Int, val amendment: String, val ownerSessionBindingId: String, val workspaceId: String, val sessionId: String,
    val sourceDeviceId: String, val targetDeviceId: String, val liveViewId: String, val status: String, val ownerApproved: Boolean,
    val continuousAutoStream: Boolean, val controlAuthority: Boolean, val framePolicy: LiveViewFramePolicy,
    val overlayCapabilities: LiveViewOverlayCapabilities, val startedAt: String? = null, val stoppedAt: String? = null,
    val expiresAt: String, val errorCode: String? = null,
)

@Serializable data class NormalizedPoint(val x: Double, val y: Double)
@Serializable data class LiveViewClick(val x: Double, val y: Double, val button: String)
@Serializable data class LiveViewTarget(val targetId: String, val label: String, val x: Double, val y: Double, val width: Double, val height: Double)
@Serializable
data class CrossDeviceLiveViewFrameMetadata(
    val contractVersion: Int, val amendment: String, val ownerSessionBindingId: String, val workspaceId: String, val sessionId: String,
    val sourceDeviceId: String, val targetDeviceId: String, val liveViewId: String, val frameId: String, val sequence: Int,
    val observedAt: String, val width: Int, val height: Int, val cursor: NormalizedPoint? = null, val click: LiveViewClick? = null,
    val target: LiveViewTarget? = null, val operatorState: String, val containsPixels: Boolean,
)

@Serializable
data class CrossDeviceWakeReady(
    val contractVersion: Int, val amendment: String, val ownerSessionBindingId: String, val workspaceId: String, val sessionId: String,
    val sourceDeviceId: String, val targetDeviceId: String, val requestId: String, val capability: String, val capabilityStatus: String,
    val status: String, val attempted: Boolean, val runtimeReady: Boolean, val requestedAt: String, val completedAt: String? = null,
    val errorCode: String? = null,
)

@Serializable data class PcMetrics(val cpuPercent: Double? = null, val gpuPercent: Double? = null, val ramPercent: Double? = null, val networkState: String? = null, val activeDownloads: Int? = null, val voiceActive: Boolean? = null, val computerUseActive: Boolean? = null)
@Serializable
data class CrossDevicePcStatus(
    val contractVersion: Int, val amendment: String, val ownerSessionBindingId: String, val workspaceId: String, val sessionId: String,
    val sourceDeviceId: String, val targetDeviceId: String, val snapshotId: String, val runtime: String, val observedAt: String,
    val expiresAt: String, val metrics: PcMetrics, val source: String,
)

object PcStatusFreshnessPolicy {
    const val STALE_CODE = "CROSS_DEVICE_PC_STATUS_STALE"
    const val EXPIRED_CODE = "CROSS_DEVICE_PC_STATUS_EXPIRED"
    const val FUTURE_CODE = "CROSS_DEVICE_PC_STATUS_FUTURE"

    fun rejectionCode(value: CrossDevicePcStatus, now: Instant): String? {
        val observedAt = runCatching { Instant.parse(value.observedAt) }.getOrNull() ?: return "CROSS_DEVICE_PC_STATUS_INVALID"
        val expiresAt = runCatching { Instant.parse(value.expiresAt) }.getOrNull() ?: return "CROSS_DEVICE_PC_STATUS_INVALID"
        return when {
            observedAt.isAfter(now.plus(FUTURE_SKEW)) -> FUTURE_CODE
            observedAt.isBefore(now.minus(FRESHNESS_BUDGET)) -> STALE_CODE
            !expiresAt.isAfter(now) -> EXPIRED_CODE
            else -> null
        }
    }

    fun isFresh(value: CrossDevicePcStatus, now: Instant): Boolean = rejectionCode(value, now) == null

    private val FRESHNESS_BUDGET = Duration.ofSeconds(60)
    private val FUTURE_SKEW = Duration.ofSeconds(5)
}

@Serializable
data class CrossDeviceQuietHours(
    val contractVersion: Int,
    val amendment: String,
    val workspaceId: String,
    val ownerSessionBindingId: String,
    val revision: Int,
    val enabled: Boolean,
    val startLocal: String,
    val endLocal: String,
    val timezone: String,
    val suppressAudio: Boolean,
    val suppressNotifications: Boolean,
    val updatedAt: String,
)

class CrossDeviceParser(
    private val json: Json = Json { ignoreUnknownKeys = false; explicitNulls = false },
    private val now: () -> Instant = Instant::now,
) {
    sealed interface RealtimePayload {
        data class Transfer(val value: CrossDeviceTransfer) : RealtimePayload
        data class Clipboard(val value: CrossDeviceClipboardMetadata) : RealtimePayload
        data class Queue(val value: CrossDeviceOfflineQueueItem) : RealtimePayload
        data class Handoff(val value: CrossDeviceHandoff) : RealtimePayload
        data class ResultCard(val value: SharedResultCard) : RealtimePayload
        data class Audio(val value: CrossDeviceAudioHandoff) : RealtimePayload
        data class LiveView(val value: CrossDeviceLiveView) : RealtimePayload
        data class LiveViewFrame(val value: CrossDeviceLiveViewFrameMetadata) : RealtimePayload
        data class Wake(val value: CrossDeviceWakeReady) : RealtimePayload
        data class PcStatus(val value: CrossDevicePcStatus) : RealtimePayload
    }

    fun realtime(
        event: String,
        payload: JsonElement,
        enforcePcFreshness: Boolean = true,
    ): ParseResult<RealtimePayload> = when (event) {
        CrossDeviceWire.TRANSFER_EVENT -> transfer(payload).map { RealtimePayload.Transfer(it) }
        CrossDeviceWire.CLIPBOARD_EVENT -> clipboardMetadata(payload).map { RealtimePayload.Clipboard(it) }
        CrossDeviceWire.OFFLINE_QUEUE_EVENT -> queueItem(payload).map { RealtimePayload.Queue(it) }
        CrossDeviceWire.HANDOFF_EVENT -> handoff(payload).map { RealtimePayload.Handoff(it) }
        CrossDeviceWire.RESULT_CARD_EVENT -> resultCard(payload).map { RealtimePayload.ResultCard(it) }
        CrossDeviceWire.AUDIO_EVENT -> audio(payload).map { RealtimePayload.Audio(it) }
        CrossDeviceWire.LIVE_VIEW_EVENT -> liveView(payload).map { RealtimePayload.LiveView(it) }
        CrossDeviceWire.LIVE_VIEW_FRAME_EVENT -> liveViewFrame(payload).map { RealtimePayload.LiveViewFrame(it) }
        CrossDeviceWire.WAKE_EVENT -> wake(payload).map { RealtimePayload.Wake(it) }
        CrossDeviceWire.PC_STATUS_EVENT -> pcStatus(payload, enforcePcFreshness).map { RealtimePayload.PcStatus(it) }
        else -> invalid("CROSS_DEVICE_REALTIME_EVENT_UNSUPPORTED")
    }
    fun capabilities(raw: JsonElement): ParseResult<CrossDeviceCapabilities> = decode(raw) { value ->
        val operational = setOf("available", "configuration_required")
        if (listOf(value.clipboard, value.offlineQueue, value.smartHandoff, value.resultCards, value.audioHandoff, value.mobileToPcTransfer).all { it in operational }
            && listOf(value.pcToMobileTransfer, value.liveView, value.wakeOnLan, value.pcStatus).all { it in operational }
            && value.quietHours == "metadata_only" && value.persistence == "memory_only") valid(value)
        else invalid("CROSS_DEVICE_CAPABILITIES_INVALID")
    }

    fun clipboardMetadata(raw: JsonElement): ParseResult<CrossDeviceClipboardMetadata> = decode(raw) { value ->
        when {
            !lineage(value.contractVersion, value.amendment, value.ownerSessionBindingId, value.workspaceId, value.sessionId, value.sourceDeviceId, value.targetDeviceId) -> invalid("CROSS_DEVICE_CLIPBOARD_BINDING_INVALID")
            value.direction !in setOf("mobile_to_pc", "pc_to_mobile") || value.mimeType !in setOf("text/plain", "text/uri-list") -> invalid("CROSS_DEVICE_CLIPBOARD_INVALID")
            !value.explicitConsent || value.persistHistory || value.sensitive || value.contentBytes !in 1..65_536 || !sha(value.contentFingerprint) -> invalid("CROSS_DEVICE_CLIPBOARD_METADATA_INVALID")
            value.status !in setOf("available", "consumed", "expired", "rejected") || !window(value.issuedAt, value.expiresAt, 300) -> invalid("CROSS_DEVICE_CLIPBOARD_METADATA_INVALID")
            value.status == "available" && Instant.parse(value.expiresAt) <= Instant.now() -> invalid("CROSS_DEVICE_CLIPBOARD_EXPIRED")
            else -> valid(value)
        }
    }

    fun consumedClipboard(raw: JsonElement): ParseResult<ClipboardConsumedPayload> = decode(raw) { value ->
        val metadata = clipboardMetadata(json.encodeToJsonElement(CrossDeviceClipboardMetadata.serializer(), value.metadata))
        when {
            metadata is ParseResult.Invalid -> metadata
            value.metadata.status != "consumed" -> invalid("CROSS_DEVICE_CLIPBOARD_NOT_CONSUMED")
            sensitive(value.content) -> invalid("CROSS_DEVICE_CLIPBOARD_SENSITIVE_CONTENT")
            value.content.encodeToByteArray().size != value.metadata.contentBytes || sha256Hex(value.content.encodeToByteArray()) != value.metadata.contentFingerprint -> invalid("CROSS_DEVICE_CLIPBOARD_CONTENT_MISMATCH")
            else -> valid(value)
        }
    }

    fun transfer(raw: JsonElement): ParseResult<CrossDeviceTransfer> = decode(raw) { value ->
        val expected = ((value.progress.bytesTransferred.toDouble() / value.sizeBytes.toDouble()) * 100.0)
        when {
            !lineage(value.contractVersion, value.amendment, value.ownerSessionBindingId, value.workspaceId, value.sessionId, value.sourceDeviceId, value.targetDeviceId) -> invalid("CROSS_DEVICE_TRANSFER_BINDING_INVALID")
            value.direction !in setOf("mobile_to_pc", "pc_to_mobile") || value.sizeBytes !in 1..(25L * 1024 * 1024) || !sha(value.sha256) -> invalid("CROSS_DEVICE_TRANSFER_INVALID")
            value.status !in setOf("pending", "transferring", "completed", "failed", "cancelled", "configuration_required") -> invalid("CROSS_DEVICE_TRANSFER_INVALID")
            value.progress.totalBytes != value.sizeBytes || value.progress.bytesTransferred !in 0..value.sizeBytes || kotlin.math.abs(value.progress.percent - expected) > .02 -> invalid("CROSS_DEVICE_TRANSFER_PROGRESS_INVALID")
            value.status == "completed" && (value.progress.bytesTransferred != value.sizeBytes || value.progress.integrity != "verified") -> invalid("CROSS_DEVICE_TRANSFER_PROGRESS_INVALID")
            value.destination.conflictPolicy == "reject" && value.destination.collisionDetected && value.status != "failed" -> invalid("CROSS_DEVICE_TRANSFER_COLLISION_UNRESOLVED")
            value.destination.opaqueHandle.contains(Regex("[\\/:]|\\.\\.|%2f|%5c", RegexOption.IGNORE_CASE)) -> invalid("CROSS_DEVICE_TRANSFER_DESTINATION_INVALID")
            value.candidateEvidence?.let { it.candidateId.isBlank() || it.evidenceSummary.isBlank() || it.source !in setOf("explicit_selection", "semantic_fetch", "drop_request") } == true -> invalid("CROSS_DEVICE_TRANSFER_EVIDENCE_INVALID")
            value.resume.acknowledgedBytes != null && value.resume.acknowledgedBytes != value.progress.bytesTransferred -> invalid("CROSS_DEVICE_TRANSFER_PROGRESS_INVALID")
            value.resume.contractVersion != EDITH_VERSION || value.resume.amendment != EDITH_AMENDMENT || !value.resume.resumable || value.resume.nextChunkIndex < 0 || value.resume.retryCount !in 0..value.resume.maxRetries || value.resume.completedChunkIndexes != value.resume.completedChunkIndexes.sorted().distinct() || value.resume.nextChunkIndex in value.resume.completedChunkIndexes -> invalid("CROSS_DEVICE_TRANSFER_RESUME_INVALID")
            !window(value.createdAt, value.expiresAt, 86_400) -> invalid("CROSS_DEVICE_TRANSFER_TIME_INVALID")
            else -> valid(value)
        }
    }

    fun queueItem(raw: JsonElement): ParseResult<CrossDeviceOfflineQueueItem> = decode(raw) { value ->
        when {
            !lineage(value.contractVersion, value.amendment, value.ownerSessionBindingId, value.workspaceId, value.sessionId, value.sourceDeviceId, value.targetDeviceId) -> invalid("CROSS_DEVICE_OFFLINE_QUEUE_BINDING_INVALID")
            value.command.command == "emergency_stop" || value.command.deviceId != value.sourceDeviceId || value.command.workspaceId != value.workspaceId || value.command.sessionId != value.sessionId -> invalid("EMERGENCY_STOP_QUEUE_FORBIDDEN")
            !value.encryptedAtRest || value.command.riskLevel !in 0..1 || !sha(value.command.payloadFingerprint) -> invalid("CROSS_DEVICE_OFFLINE_QUEUE_INVALID")
            value.status !in setOf("pending", "cancelled", "dispatching", "completed", "failed", "expired") || !window(value.queuedAt, value.expiresAt, 86_400) -> invalid("CROSS_DEVICE_OFFLINE_QUEUE_INVALID")
            value.result != null && (value.result.commandId != value.command.commandId || value.result.deviceId != value.command.deviceId || value.result.workspaceId != value.workspaceId || value.result.sessionId != value.sessionId) -> invalid("CROSS_DEVICE_OFFLINE_QUEUE_RESULT_INVALID")
            value.status == "completed" && value.result?.status != "completed" -> invalid("CROSS_DEVICE_OFFLINE_QUEUE_RESULT_INVALID")
            value.status == "failed" && value.result?.status !in setOf(null, "failed", "rejected", "expired") -> invalid("CROSS_DEVICE_OFFLINE_QUEUE_RESULT_INVALID")
            else -> valid(value)
        }
    }

    fun handoff(raw: JsonElement): ParseResult<CrossDeviceHandoff> = decode(raw) { value ->
        when {
            !lineage(value.contractVersion, value.amendment, value.ownerSessionBindingId, value.workspaceId, value.sessionId, value.sourceDeviceId, value.targetDeviceId) -> invalid("CROSS_DEVICE_HANDOFF_BINDING_INVALID")
            value.direction !in setOf("desktop_to_mobile", "mobile_to_desktop") || value.intent !in setOf("open", "continue") -> invalid("CROSS_DEVICE_HANDOFF_INVALID")
            value.status !in setOf("requested", "acknowledged", "rejected", "expired") || value.artifactIds.size > 100 || value.artifactIds.distinct().size != value.artifactIds.size -> invalid("CROSS_DEVICE_HANDOFF_INVALID")
            value.taskId == null && value.resultId == null && value.artifactIds.isEmpty() -> invalid("CROSS_DEVICE_HANDOFF_IDENTITY_REQUIRED")
            !window(value.requestedAt, value.expiresAt, 86_400) -> invalid("CROSS_DEVICE_HANDOFF_INVALID")
            else -> valid(value)
        }
    }

    fun resultCard(raw: JsonElement): ParseResult<SharedResultCard> = decode(raw) { value ->
        when {
            !lineage(value.contractVersion, value.amendment, value.ownerSessionBindingId, value.workspaceId, value.sessionId, value.sourceDeviceId, value.targetDeviceId) -> invalid("SHARED_RESULT_CARD_BINDING_INVALID")
            value.revision < 1 || value.kind !in setOf("research", "file", "screenshot", "download", "task", "error_attention") || value.outcome !in setOf("success", "partial", "failure", "cancelled") -> invalid("SHARED_RESULT_CARD_INVALID")
            sensitive(value.title) || sensitive(value.summary) || sensitive(value.preview.safeText.orEmpty()) -> invalid("SHARED_RESULT_CARD_SENSITIVE_PREVIEW")
            value.preview.safeText != null && !value.preview.redacted -> invalid("SHARED_RESULT_CARD_PREVIEW_INVALID")
            value.artifactRefs.any { it.ownerSessionBindingId != value.ownerSessionBindingId || it.downloadHandle?.contains(Regex("[\\/:]|\\.\\.|%2f|%5c", RegexOption.IGNORE_CASE)) == true } -> invalid("SHARED_RESULT_CARD_PREVIEW_INVALID")
            value.actions.size > 12 || value.actions.any { it.action !in setOf("open", "export", "share", "open_location", "retry", "dismiss") } -> invalid("SHARED_RESULT_CARD_ACTIONS_INVALID")
            !iso(value.createdAt) || !iso(value.updatedAt) || Instant.parse(value.updatedAt) < Instant.parse(value.createdAt) || value.expiresAt?.let { !iso(it) || Instant.parse(it) <= Instant.now() } == true -> invalid("SHARED_RESULT_CARD_TIME_INVALID")
            value.provenance.sourceType.isBlank() || value.provenance.sourceId.isBlank() || !iso(value.provenance.observedAt) -> invalid("SHARED_RESULT_CARD_PROVENANCE_INVALID")
            value.artifactRefs.any { it.checksumStatus !in setOf("verified", "failed", "unavailable") || it.retention !in setOf("session", "temporary", "workspace") || it.checksumSha256?.let(::sha) == false || !iso(it.provenance.observedAt) } -> invalid("SHARED_RESULT_CARD_PREVIEW_INVALID")
            else -> valid(value)
        }
    }

    fun audio(raw: JsonElement): ParseResult<CrossDeviceAudioHandoff> = decode(raw) { value ->
        when {
            !lineage(value.contractVersion, value.amendment, value.ownerSessionBindingId, value.workspaceId, value.sessionId, value.sourceDeviceId, value.targetDeviceId) -> invalid("CROSS_DEVICE_AUDIO_HANDOFF_BINDING_INVALID")
            value.sourceCaptureDeviceId != value.sourceDeviceId || value.targetCaptureDeviceId != value.targetDeviceId || value.sourceCaptureDeviceId == value.targetCaptureDeviceId -> invalid("CROSS_DEVICE_AUDIO_HANDOFF_BINDING_INVALID")
            value.epoch < 1 || value.simultaneousCaptureAllowed || value.status !in setOf("requested", "acknowledged", "active", "released", "expired", "rejected") -> invalid("CROSS_DEVICE_AUDIO_HANDOFF_INVALID")
            value.quietHoursRevision != null && value.quietHoursRevision < 1 || !window(value.requestedAt, value.expiresAt, 1_800) -> invalid("CROSS_DEVICE_AUDIO_HANDOFF_INVALID")
            else -> valid(value)
        }
    }

    fun quietHours(raw: JsonElement): ParseResult<CrossDeviceQuietHours> = decode(raw) { value ->
        if (value.contractVersion == EDITH_VERSION && value.amendment == EDITH_AMENDMENT && value.revision >= 1
            && value.startLocal.matches(Regex("^([01]\\d|2[0-3]):[0-5]\\d$")) && value.endLocal.matches(Regex("^([01]\\d|2[0-3]):[0-5]\\d$"))
            && value.workspaceId.isNotBlank() && value.ownerSessionBindingId.isNotBlank() && iso(value.updatedAt)) valid(value)
        else invalid("CROSS_DEVICE_QUIET_HOURS_INVALID")
    }

    fun liveView(raw: JsonElement): ParseResult<CrossDeviceLiveView> = decode(raw) { value ->
        when {
            !lineage(value.contractVersion, value.amendment, value.ownerSessionBindingId, value.workspaceId, value.sessionId, value.sourceDeviceId, value.targetDeviceId) -> invalid("CROSS_DEVICE_LIVE_VIEW_BINDING_INVALID")
            value.status !in setOf("requested", "approved", "configuration_required", "streaming", "stopped", "expired") || value.continuousAutoStream || value.controlAuthority -> invalid("CROSS_DEVICE_LIVE_VIEW_INVALID")
            value.status in setOf("approved", "streaming") && !value.ownerApproved -> invalid("CROSS_DEVICE_LIVE_VIEW_APPROVAL_REQUIRED")
            value.framePolicy.maxFramesPerSecond !in 1..5 || value.framePolicy.maxWidth !in 1..1920 || value.framePolicy.maxHeight !in 1..1080 || !iso(value.expiresAt) -> invalid("CROSS_DEVICE_LIVE_VIEW_POLICY_INVALID")
            else -> valid(value)
        }
    }

    fun liveViewFrame(raw: JsonElement): ParseResult<CrossDeviceLiveViewFrameMetadata> = decode(raw) { value ->
        val pointOk: (Double, Double) -> Boolean = { x, y -> x in 0.0..1.0 && y in 0.0..1.0 }
        val states = setOf("observing", "planning", "moving", "clicking", "typing", "scrolling", "verifying", "success", "error", "stopped")
        when {
            !lineage(value.contractVersion, value.amendment, value.ownerSessionBindingId, value.workspaceId, value.sessionId, value.sourceDeviceId, value.targetDeviceId) -> invalid("CROSS_DEVICE_LIVE_VIEW_FRAME_BINDING_INVALID")
            value.liveViewId.isBlank() || value.frameId.isBlank() || value.sequence < 1 || !iso(value.observedAt) || value.width !in 1..1920 || value.height !in 1..1080 || value.operatorState !in states || value.containsPixels -> invalid("CROSS_DEVICE_LIVE_VIEW_FRAME_INVALID")
            value.cursor?.let { !pointOk(it.x, it.y) } == true || value.click?.let { !pointOk(it.x, it.y) || it.button !in setOf("left", "right", "middle") } == true -> invalid("CROSS_DEVICE_LIVE_VIEW_FRAME_INVALID")
            value.target?.let { !pointOk(it.x, it.y) || it.width <= 0.0 || it.width > 1.0 || it.height <= 0.0 || it.height > 1.0 || it.targetId.isBlank() || it.label.isBlank() } == true -> invalid("CROSS_DEVICE_LIVE_VIEW_FRAME_INVALID")
            else -> valid(value)
        }
    }

    fun wake(raw: JsonElement): ParseResult<CrossDeviceWakeReady> = decode(raw) { value ->
        when {
            !lineage(value.contractVersion, value.amendment, value.ownerSessionBindingId, value.workspaceId, value.sessionId, value.sourceDeviceId, value.targetDeviceId) -> invalid("CROSS_DEVICE_WAKE_BINDING_INVALID")
            value.capability != "wake_on_lan" || value.capabilityStatus !in setOf("available", "unsupported", "configuration_required") -> invalid("CROSS_DEVICE_WAKE_READY_INVALID")
            value.status in setOf("unsupported", "configuration_required") && (value.attempted || value.runtimeReady) -> invalid("CROSS_DEVICE_WAKE_READY_INCONSISTENT")
            value.status == "ready" && (!value.attempted || !value.runtimeReady) -> invalid("CROSS_DEVICE_WAKE_READY_INCONSISTENT")
            else -> valid(value)
        }
    }

    fun pcStatus(raw: JsonElement, enforceFreshness: Boolean = true): ParseResult<CrossDevicePcStatus> = decode(raw) { value ->
        val percentages = listOfNotNull(value.metrics.cpuPercent, value.metrics.gpuPercent, value.metrics.ramPercent)
        val freshnessError = if (enforceFreshness) PcStatusFreshnessPolicy.rejectionCode(value, now()) else null
        when {
            !lineage(value.contractVersion, value.amendment, value.ownerSessionBindingId, value.workspaceId, value.sessionId, value.sourceDeviceId, value.targetDeviceId) -> invalid("CROSS_DEVICE_PC_STATUS_BINDING_INVALID")
            value.runtime !in setOf("ready", "busy", "offline", "unknown") || value.source !in setOf("native_adapter", "backend_runtime") || !window(value.observedAt, value.expiresAt, 60) -> invalid("CROSS_DEVICE_PC_STATUS_INVALID")
            freshnessError != null -> invalid(freshnessError)
            percentages.any { it !in 0.0..100.0 } || value.metrics.activeDownloads?.let { it < 0 } == true || value.metrics.networkState !in setOf(null, "online", "offline", "unknown") -> invalid("CROSS_DEVICE_PC_STATUS_METRIC_INVALID")
            else -> valid(value)
        }
    }

    private inline fun <reified T> decode(raw: JsonElement, validate: (T) -> ParseResult<T>): ParseResult<T> = try {
        val unsafe = forbidden(raw)
        if (unsafe != null) invalid("FORBIDDEN_CONTRACT_FIELD") else validate(json.decodeFromString(raw.toString()))
    } catch (_: SerializationException) { invalid("MALFORMED_CROSS_DEVICE_CONTRACT") }
      catch (_: IllegalArgumentException) { invalid("MALFORMED_CROSS_DEVICE_CONTRACT") }

    private fun lineage(version: Int, amendment: String, binding: String, workspace: String, session: String, source: String, target: String) =
        version == EDITH_VERSION && amendment == EDITH_AMENDMENT && listOf(binding, workspace, session, source, target).all { it.isNotBlank() && it.length <= 256 }

    private fun window(start: String, end: String, maxSeconds: Long): Boolean = runCatching {
        val first = Instant.parse(start); val last = Instant.parse(end)
        last.isAfter(first) && Duration.between(first, last) <= Duration.ofSeconds(maxSeconds)
    }.getOrDefault(false)

    private fun iso(value: String) = runCatching { Instant.parse(value) }.isSuccess
    private fun sha(value: String) = value.matches(Regex("^[a-f0-9]{64}$"))
    private fun sensitive(value: String) = value.contains(Regex("(?i)(api[_-]?key|access[_-]?token|refresh[_-]?token|password|private[_-]?key|bearer\\s+[A-Za-z0-9._-]+)"))
    private fun <T> valid(value: T) = ParseResult.Valid(value)
    private fun invalid(code: String) = ParseResult.Invalid(code, "Canonical cross-device contract validation failed.")

    private fun forbidden(value: JsonElement): String? = when (value) {
        is JsonObject -> value.entries.firstNotNullOfOrNull { (key, child) ->
            val normalized = key.replace("_", "").replace("-", "").lowercase()
            if (normalized in setOf("secret", "token", "apikey", "password", "privatekey", "rawkey", "keymaterial", "ownerkey")) key else forbidden(child)
        }
        is JsonArray -> value.firstNotNullOfOrNull(::forbidden)
        else -> null
    }
}

private inline fun <T, R> ParseResult<T>.map(transform: (T) -> R): ParseResult<R> = when (this) {
    is ParseResult.Valid -> ParseResult.Valid(transform(value))
    is ParseResult.Invalid -> this
}
