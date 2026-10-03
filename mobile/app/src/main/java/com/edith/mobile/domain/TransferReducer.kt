package com.edith.mobile.domain

import com.edith.mobile.contracts.FileTransferDescriptor

data class TransferUiState(
    val descriptor: FileTransferDescriptor,
    val acknowledgedBytes: Long,
    val checksum: ChecksumState,
    val localDestinationReady: Boolean,
    val safeErrorCode: String? = null,
) {
    val percent: Int get() = if (descriptor.sizeBytes == 0L) 0 else ((acknowledgedBytes * 100) / descriptor.sizeBytes).coerceIn(0, 100).toInt()
}

enum class ChecksumState { PENDING, VERIFIED, FAILED }

sealed interface TransferEvent {
    data class Progress(val acknowledgedBytes: Long) : TransferEvent
    data class Checksum(val matched: Boolean) : TransferEvent
    data class Failure(val code: String) : TransferEvent
    data object Cancel : TransferEvent
}

object TransferReducer {
    fun reduce(current: TransferUiState, event: TransferEvent): TransferUiState = when (event) {
        is TransferEvent.Progress -> {
            require(event.acknowledgedBytes in current.acknowledgedBytes..current.descriptor.sizeBytes)
            current.copy(acknowledgedBytes = event.acknowledgedBytes)
        }
        is TransferEvent.Checksum -> current.copy(checksum = if (event.matched) ChecksumState.VERIFIED else ChecksumState.FAILED, safeErrorCode = if (event.matched) null else "checksum_mismatch")
        is TransferEvent.Failure -> current.copy(safeErrorCode = event.code)
        TransferEvent.Cancel -> current.copy(safeErrorCode = "cancelled_by_owner")
    }
}
