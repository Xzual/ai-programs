package com.edith.mobile.domain

import com.edith.mobile.contracts.CrossDeviceAudioHandoff
import com.edith.mobile.contracts.CrossDeviceCapabilities
import com.edith.mobile.contracts.CrossDeviceClipboardMetadata
import com.edith.mobile.contracts.CrossDeviceHandoff
import com.edith.mobile.contracts.CrossDeviceOfflineQueueItem
import com.edith.mobile.contracts.CrossDeviceQuietHours
import com.edith.mobile.contracts.CrossDevicePcStatus
import com.edith.mobile.contracts.PcStatusFreshnessPolicy
import com.edith.mobile.contracts.CrossDeviceTransfer
import com.edith.mobile.contracts.SharedResultCard
import java.time.Instant

data class EphemeralClipboard(
    val clipboardId: String,
    val content: CharArray,
    val expiresAt: String,
) : AutoCloseable {
    val redactedPreview: String get() = "•".repeat(content.size.coerceIn(4, 24))
    override fun close() = content.fill('\u0000')
}

data class CrossDeviceState(
    val capabilities: CrossDeviceCapabilities? = null,
    val clipboardItems: List<CrossDeviceClipboardMetadata> = emptyList(),
    val ephemeralClipboard: EphemeralClipboard? = null,
    val transfers: List<CrossDeviceTransfer> = emptyList(),
    val queue: List<CrossDeviceOfflineQueueItem> = emptyList(),
    val handoffs: List<CrossDeviceHandoff> = emptyList(),
    val resultCards: List<SharedResultCard> = emptyList(),
    val audioLease: CrossDeviceAudioHandoff? = null,
    val quietHours: CrossDeviceQuietHours? = null,
    val pcStatus: CrossDevicePcStatus? = null,
    val pcStatusRevision: Long? = null,
    val loading: Boolean = false,
    val safeErrorCode: String? = null,
)

object CrossDeviceReducer {
    fun capabilities(current: CrossDeviceState, value: CrossDeviceCapabilities) = current.copy(capabilities = value, safeErrorCode = null)

    fun clipboard(current: CrossDeviceState, value: CrossDeviceClipboardMetadata): CrossDeviceState {
        val prior = current.clipboardItems.firstOrNull { it.clipboardId == value.clipboardId }
        if (prior != null && prior.status == "consumed" && value.status == "available") return current.copy(safeErrorCode = "clipboard_replay_rejected")
        return current.copy(clipboardItems = upsert(current.clipboardItems, value, { it.clipboardId }, { it.issuedAt }), safeErrorCode = null)
    }

    fun consumedClipboard(current: CrossDeviceState, metadata: CrossDeviceClipboardMetadata, content: String): CrossDeviceState {
        current.ephemeralClipboard?.close()
        val updated = clipboard(current, metadata)
        return updated.copy(ephemeralClipboard = EphemeralClipboard(metadata.clipboardId, content.toCharArray(), metadata.expiresAt))
    }

    fun clearClipboard(current: CrossDeviceState): CrossDeviceState {
        current.ephemeralClipboard?.close()
        return current.copy(ephemeralClipboard = null)
    }

    fun transfer(current: CrossDeviceState, value: CrossDeviceTransfer): CrossDeviceState {
        val prior = current.transfers.firstOrNull { it.transferId == value.transferId }
        if (prior != null && (value.progress.bytesTransferred < prior.progress.bytesTransferred || Instant.parse(value.updatedAt) < Instant.parse(prior.updatedAt))) {
            return current.copy(safeErrorCode = "transfer_progress_regression")
        }
        return current.copy(transfers = upsert(current.transfers, value, { it.transferId }, { it.updatedAt }), safeErrorCode = null)
    }

    fun queue(current: CrossDeviceState, value: CrossDeviceOfflineQueueItem): CrossDeviceState {
        val prior = current.queue.firstOrNull { it.queueItemId == value.queueItemId }
        val rank = mapOf("pending" to 0, "dispatching" to 1, "completed" to 2, "failed" to 2, "cancelled" to 2, "expired" to 2)
        if (prior != null && (rank[value.status] ?: -1) < (rank[prior.status] ?: -1)) return current.copy(safeErrorCode = "offline_queue_state_regression")
        if (value.status == "completed" && value.result?.status != "completed") return current.copy(safeErrorCode = "offline_queue_verified_result_required")
        return current.copy(queue = upsert(current.queue, value, { it.queueItemId }, { it.queuedAt }), safeErrorCode = null)
    }

    fun handoff(current: CrossDeviceState, value: CrossDeviceHandoff): CrossDeviceState {
        val prior = current.handoffs.firstOrNull { it.handoffId == value.handoffId }
        if (prior != null && (prior.taskId != value.taskId || prior.resultId != value.resultId || prior.artifactIds != value.artifactIds)) {
            return current.copy(safeErrorCode = "handoff_identity_changed")
        }
        return current.copy(handoffs = upsert(current.handoffs, value, { it.handoffId }, { it.requestedAt }), safeErrorCode = null)
    }

    fun resultCard(current: CrossDeviceState, value: SharedResultCard): CrossDeviceState {
        val prior = current.resultCards.firstOrNull { it.cardId == value.cardId }
        if (prior != null && value.revision <= prior.revision) return current.copy(safeErrorCode = "result_card_revision_stale")
        return current.copy(resultCards = upsert(current.resultCards, value, { it.cardId }, { it.updatedAt }), safeErrorCode = null)
    }

    fun audio(current: CrossDeviceState, value: CrossDeviceAudioHandoff): CrossDeviceState {
        val prior = current.audioLease
        if (prior != null && value.epoch < prior.epoch) return current.copy(safeErrorCode = "audio_lease_epoch_stale")
        if (prior?.status == "active" && prior.leaseId != value.leaseId) return current.copy(safeErrorCode = "simultaneous_audio_capture_forbidden")
        return current.copy(audioLease = value.takeUnless { it.status in setOf("released", "expired", "rejected") }, safeErrorCode = null)
    }

    fun quietHours(current: CrossDeviceState, value: CrossDeviceQuietHours): CrossDeviceState {
        val prior = current.quietHours
        if (prior != null && value.revision <= prior.revision) return current.copy(safeErrorCode = "quiet_hours_revision_stale")
        return current.copy(quietHours = value, safeErrorCode = null)
    }

    fun pcStatus(
        current: CrossDeviceState,
        value: CrossDevicePcStatus,
        now: Instant = Instant.now(),
        revision: Long? = null,
    ): CrossDeviceState {
        val freshCurrent = clearExpiredPcStatus(current, now)
        val freshnessError = PcStatusFreshnessPolicy.rejectionCode(value, now)
        if (freshnessError != null) return freshCurrent.copy(safeErrorCode = freshnessError)
        val prior = freshCurrent.pcStatus
        if (prior != null && !Instant.parse(value.observedAt).isAfter(Instant.parse(prior.observedAt))) {
            return freshCurrent.copy(safeErrorCode = "pc_status_observed_at_stale")
        }
        if (revision != null && freshCurrent.pcStatusRevision != null && revision <= freshCurrent.pcStatusRevision) {
            return freshCurrent.copy(safeErrorCode = "pc_status_revision_stale")
        }
        return freshCurrent.copy(
            pcStatus = value,
            pcStatusRevision = revision ?: freshCurrent.pcStatusRevision,
            safeErrorCode = null,
        )
    }

    fun rejectPcStatus(current: CrossDeviceState, now: Instant = Instant.now(), code: String): CrossDeviceState =
        clearExpiredPcStatus(current, now).copy(safeErrorCode = code)

    fun clearExpiredPcStatus(current: CrossDeviceState, now: Instant = Instant.now()): CrossDeviceState {
        val status = current.pcStatus ?: return current
        return if (PcStatusFreshnessPolicy.isFresh(status, now)) current
        else current.copy(pcStatus = null)
    }

    fun clearAuthority(current: CrossDeviceState): CrossDeviceState {
        current.ephemeralClipboard?.close()
        return CrossDeviceState()
    }

    private fun <T> upsert(values: List<T>, value: T, id: (T) -> String, timestamp: (T) -> String): List<T> =
        (values.filterNot { id(it) == id(value) } + value).sortedByDescending(timestamp)
}
