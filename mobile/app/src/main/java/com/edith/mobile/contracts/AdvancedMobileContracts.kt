package com.edith.mobile.contracts

import java.time.Instant
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement

interface AdvancedMobileLineage {
    val contractVersion: Int
    val amendment: String
    val ownerSessionBindingId: String
    val workspaceId: String
    val revision: Int
    val createdAt: String
    val updatedAt: String
    val expiresAt: String?
}

@Serializable
data class MobileAdvancedStatus(
    val persistence: String,
    val restartRecovery: String,
    val nativeExecution: String,
    val scheduler: String,
    val watcherObservation: String,
    val watcherDelivery: String,
    val mobileRead: String,
    val secretsStored: Boolean,
)

@Serializable
data class MobilePriorityPolicy(
    override val contractVersion: Int, override val amendment: String, override val ownerSessionBindingId: String,
    override val workspaceId: String, override val revision: Int, override val createdAt: String, override val updatedAt: String,
    override val expiresAt: String? = null, val taskId: String, val priority: String, val dependencyTaskIds: List<String>,
    val atomicOperation: Boolean, val securityCritical: Boolean, val derivedFromUrgentLanguage: Boolean, val blockedByDependencies: Boolean,
) : AdvancedMobileLineage

@Serializable
data class MobileGhostTask(
    override val contractVersion: Int, override val amendment: String, override val ownerSessionBindingId: String,
    override val workspaceId: String, override val revision: Int, override val createdAt: String, override val updatedAt: String,
    override val expiresAt: String? = null, val ghostTaskId: String, val taskId: String, val background: Boolean,
    val focusPolicy: String, val status: String, val progressPercent: Double, val completionNotification: String,
    val nativeExecution: String, val reasonCode: String? = null,
) : AdvancedMobileLineage

@Serializable
data class MobileWatcher(
    override val contractVersion: Int, override val amendment: String, override val ownerSessionBindingId: String,
    override val workspaceId: String, override val revision: Int, override val createdAt: String, override val updatedAt: String,
    override val expiresAt: String? = null, val watcherId: String, val kind: String, val sourceRef: String, val trigger: String,
    val delivery: String, val observationPolicy: String, val status: String, val cancelledAt: String? = null, val triggeredAt: String? = null,
) : AdvancedMobileLineage

@Serializable
data class MobileDownloadStatus(
    override val contractVersion: Int, override val amendment: String, override val ownerSessionBindingId: String,
    override val workspaceId: String, override val revision: Int, override val createdAt: String, override val updatedAt: String,
    override val expiresAt: String? = null, val downloadId: String, val source: String, val displayName: String,
    val bytesTransferred: Long, val bytesTotal: Long, val speedBytesPerSecond: Double? = null, val remainingBytes: Long,
    val etaSeconds: Long? = null, val etaTrustworthy: Boolean, val status: String, val observedAt: String,
) : AdvancedMobileLineage

@Serializable data class MobileAutoBrief(val enabled: Boolean, val maxSentences: Int)
@Serializable data class MobileSmartSilence(val routine: String, val milestone: String, val completion: String, val actionRequired: String)
@Serializable data class MobileVoicePresence(val enabled: Boolean, val response: String)
@Serializable data class MobileVoiceSummary(val mode: String, val actualStateOnly: Boolean)

@Serializable
data class MobileCommunicationPolicy(
    override val contractVersion: Int, override val amendment: String, override val ownerSessionBindingId: String,
    override val workspaceId: String, override val revision: Int, override val createdAt: String, override val updatedAt: String,
    override val expiresAt: String? = null, val autoBrief: MobileAutoBrief, val smartSilence: MobileSmartSilence,
    val voicePresence: MobileVoicePresence, val voiceSummary: MobileVoiceSummary, val securityNotificationsImmutable: Boolean,
) : AdvancedMobileLineage

@Serializable
data class MobileCapsuleCandidate(
    val candidateId: String, val kind: String, val sourceId: String, val safeLabel: String, val observedAt: String, val expiresAt: String,
)

@Serializable
data class MobileCapsuleSelection(
    override val contractVersion: Int, override val amendment: String, override val ownerSessionBindingId: String,
    override val workspaceId: String, override val revision: Int, override val createdAt: String, override val updatedAt: String,
    override val expiresAt: String? = null, val selectionId: String, val selected: MobileCapsuleCandidate,
    val consideredCandidateIds: List<String>, val deterministicRank: Int,
) : AdvancedMobileLineage

@Serializable
data class MobileAdvancedState(
    val priority: List<MobilePriorityPolicy>,
    val ghosts: List<MobileGhostTask>,
    val watchers: List<MobileWatcher>,
    val downloads: List<MobileDownloadStatus>,
    val communication: List<MobileCommunicationPolicy>,
    val capsuleSelection: List<MobileCapsuleSelection>,
)

@Serializable
data class AdvancedMobileProjection(
    val status: MobileAdvancedStatus,
    val state: MobileAdvancedState,
    val deviceScoped: Boolean,
    val mutationAvailable: Boolean,
) {
    fun records(): List<AdvancedMobileLineage> = state.priority + state.ghosts + state.watchers + state.downloads + state.communication + state.capsuleSelection
}

class AdvancedMobileParser(private val json: Json = Json { ignoreUnknownKeys = false; explicitNulls = false }) {
    fun state(raw: JsonElement): ParseResult<AdvancedMobileProjection> = try {
        val value = json.decodeFromString<AdvancedMobileProjection>(raw.toString())
        when {
            !value.deviceScoped || value.mutationAvailable -> invalid("ADVANCED_MOBILE_READ_ONLY_REQUIRED")
            value.status.persistence != "memory_only" || value.status.restartRecovery != "partial" || value.status.secretsStored -> invalid("ADVANCED_MOBILE_STATUS_INVALID")
            value.status.nativeExecution.isBlank() || value.status.scheduler.isBlank() || value.status.watcherDelivery.isBlank() -> invalid("ADVANCED_MOBILE_STATUS_INVALID")
            value.records().size > 1_536 || value.records().any { !lineage(it) } -> invalid("ADVANCED_MOBILE_LINEAGE_INVALID")
            value.state.priority.any { it.priority !in setOf("LOW", "NORMAL", "HIGH") || it.derivedFromUrgentLanguage || it.dependencyTaskIds.size > 64 } -> invalid("ADVANCED_MOBILE_PRIORITY_INVALID")
            value.state.ghosts.any { !it.background || it.nativeExecution != "not_connected" || it.progressPercent !in 0.0..100.0 } -> invalid("ADVANCED_MOBILE_GHOST_INVALID")
            value.state.watchers.any { it.observationPolicy != "event_based" || it.status !in setOf("active", "cancelled", "expired", "triggered", "configuration_required") } -> invalid("ADVANCED_MOBILE_WATCHER_INVALID")
            value.state.downloads.any { it.bytesTotal <= 0 || it.bytesTransferred !in 0..it.bytesTotal || it.remainingBytes != it.bytesTotal - it.bytesTransferred || it.etaTrustworthy != (it.etaSeconds != null) || !timestamp(it.observedAt) } -> invalid("ADVANCED_MOBILE_DOWNLOAD_INVALID")
            value.state.communication.any { !it.voiceSummary.actualStateOnly || !it.securityNotificationsImmutable || it.autoBrief.maxSentences !in 1..3 } -> invalid("ADVANCED_MOBILE_COMMUNICATION_INVALID")
            value.state.capsuleSelection.any { it.deterministicRank !in 1..5 || !timestamp(it.selected.observedAt) || !timestamp(it.selected.expiresAt) } -> invalid("ADVANCED_MOBILE_CAPSULE_INVALID")
            else -> ParseResult.Valid(value)
        }
    } catch (_: SerializationException) { invalid("MALFORMED_ADVANCED_MOBILE_STATE") }
      catch (_: IllegalArgumentException) { invalid("MALFORMED_ADVANCED_MOBILE_STATE") }

    fun lineageMatches(value: AdvancedMobileProjection, ownerBindingId: String, workspaceId: String): Boolean =
        value.records().all { it.ownerSessionBindingId == ownerBindingId && it.workspaceId == workspaceId }

    private fun lineage(value: AdvancedMobileLineage): Boolean = value.contractVersion == 2 && value.amendment == "2.1" &&
        value.ownerSessionBindingId.isNotBlank() && value.workspaceId.isNotBlank() && value.revision >= 1 &&
        timestamp(value.createdAt) && timestamp(value.updatedAt) && Instant.parse(value.updatedAt) >= Instant.parse(value.createdAt) &&
        value.expiresAt?.let(::timestamp) != false

    private fun timestamp(value: String): Boolean = runCatching { Instant.parse(value) }.isSuccess
    private fun invalid(code: String) = ParseResult.Invalid(code, "Advanced mobile state was rejected.")
}
