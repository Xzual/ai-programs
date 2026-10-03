package com.edith.mobile.domain

import java.util.UUID

enum class RemoteCommandKind { REFRESH_TASKS, DEVICE_PING, REQUEST_FILE, EMERGENCY_STOP }
enum class QueueState { PENDING, SENDING, DELIVERED, FAILED, CONFLICT, CANCELLED }

data class QueuedCommand(
    val id: String,
    val kind: RemoteCommandKind,
    val targetDeviceId: String,
    val state: QueueState,
    val requiresConfirmation: Boolean,
    val confirmed: Boolean,
    val ownerBindingId: String,
    val createdAtEpochMs: Long,
    val safeErrorCode: String? = null,
)

data class CommandAuthorization(
    val trustedDevice: Boolean,
    val ownerBindingActive: Boolean,
    val capabilityAdvertised: Boolean,
    val ownerBindingId: String,
)

class VerifiedDeliveryReceipt internal constructor(
    val receiptId: String,
    val commandId: String,
    val targetDeviceId: String,
    val ownerBindingId: String,
    val deliveredAt: String,
)

class OfflineCommandQueue {
    private val items = mutableListOf<QueuedCommand>()

    fun snapshot(): List<QueuedCommand> = items.sortedWith(compareBy<QueuedCommand> { if (it.kind == RemoteCommandKind.EMERGENCY_STOP) 0 else 1 }.thenBy { it.createdAtEpochMs })

    fun enqueue(
        kind: RemoteCommandKind,
        targetDeviceId: String,
        confirmed: Boolean,
        online: Boolean,
        authorization: CommandAuthorization,
        now: Long,
    ): QueuedCommand {
        require(targetDeviceId.isNotBlank())
        val requiresConfirmation = kind in setOf(RemoteCommandKind.REQUEST_FILE)
        val state: QueueState
        val error: String?
        if (!authorization.trustedDevice) {
            state = QueueState.FAILED
            error = "trusted_device_required"
        } else if (!authorization.ownerBindingActive) {
            state = QueueState.FAILED
            error = "owner_binding_required"
        } else if (!authorization.capabilityAdvertised) {
            state = QueueState.FAILED
            error = "capability_not_advertised"
        } else if (requiresConfirmation && !confirmed) {
            state = QueueState.FAILED
            error = "confirmation_required"
        } else if (kind == RemoteCommandKind.EMERGENCY_STOP && !online) {
            state = QueueState.FAILED
            error = "emergency_stop_not_delivered_offline"
        } else {
            state = QueueState.PENDING
            error = null
        }
        return QueuedCommand(
            UUID.randomUUID().toString(),
            kind,
            targetDeviceId,
            state,
            requiresConfirmation,
            confirmed,
            authorization.ownerBindingId,
            now,
            error,
        ).also(items::add)
    }

    fun transition(
        id: String,
        next: QueueState,
        authorization: CommandAuthorization? = null,
        receipt: VerifiedDeliveryReceipt? = null,
        safeErrorCode: String? = null,
    ): QueuedCommand {
        val index = items.indexOfFirst { it.id == id }
        require(index >= 0)
        val current = items[index]
        require(next in allowed[current.state].orEmpty())
        if (next in setOf(QueueState.SENDING, QueueState.DELIVERED)) {
            require(authorization?.isCurrentFor(current) == true)
        }
        if (next == QueueState.DELIVERED) {
            require(receipt != null && receipt.receiptId.isNotBlank() && receipt.deliveredAt.isNotBlank())
            require(receipt.commandId == current.id && receipt.targetDeviceId == current.targetDeviceId && receipt.ownerBindingId == current.ownerBindingId)
        }
        return current.copy(state = next, safeErrorCode = safeErrorCode).also { items[index] = it }
    }

    private fun CommandAuthorization.isCurrentFor(command: QueuedCommand): Boolean =
        trustedDevice && ownerBindingActive && capabilityAdvertised
            && ownerBindingId.isNotBlank() && ownerBindingId == command.ownerBindingId

    private val allowed = mapOf(
        QueueState.PENDING to setOf(QueueState.SENDING, QueueState.CANCELLED, QueueState.FAILED, QueueState.CONFLICT),
        QueueState.SENDING to setOf(QueueState.DELIVERED, QueueState.FAILED, QueueState.CONFLICT),
        QueueState.CONFLICT to setOf(QueueState.CANCELLED),
        QueueState.FAILED to setOf(QueueState.CANCELLED),
    )
}
