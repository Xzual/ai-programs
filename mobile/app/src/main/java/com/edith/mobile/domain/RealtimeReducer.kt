package com.edith.mobile.domain

import com.edith.mobile.contracts.RealtimeEnvelope

sealed interface RealtimeEvent {
    data class ConnectRequested(val configured: Boolean) : RealtimeEvent
    data class Connected(val streamId: String) : RealtimeEvent
    data class EnvelopeReceived(val envelope: RealtimeEnvelope) : RealtimeEvent
    data class TransportClosed(val safeCode: String) : RealtimeEvent
    data object Reset : RealtimeEvent
}

data class RealtimeReduction(val state: RealtimeState, val accepted: Boolean, val reasonCode: String? = null)

object RealtimeReducer {
    fun reduce(current: RealtimeState, event: RealtimeEvent): RealtimeReduction = when (event) {
        is RealtimeEvent.ConnectRequested -> if (event.configured) accepted(current.copy(phase = ConnectionPhase.CONNECTING))
            else rejected(current.copy(phase = ConnectionPhase.UNCONFIGURED), "realtime_not_configured")
        is RealtimeEvent.Connected -> accepted(current.copy(phase = ConnectionPhase.CONNECTED, streamId = event.streamId, retryAttempt = 0, nextRetryDelayMs = null, safeErrorCode = null))
        is RealtimeEvent.TransportClosed -> {
            val attempt = (current.retryAttempt + 1).coerceAtMost(MAX_RETRIES)
            val delay = backoff(attempt)
            accepted(current.copy(phase = ConnectionPhase.RECONNECTING, retryAttempt = attempt, nextRetryDelayMs = delay, safeErrorCode = event.safeCode))
        }
        is RealtimeEvent.EnvelopeReceived -> receive(current, event.envelope)
        RealtimeEvent.Reset -> accepted(RealtimeState())
    }

    private fun receive(current: RealtimeState, envelope: RealtimeEnvelope): RealtimeReduction {
        if (current.phase != ConnectionPhase.CONNECTED || current.streamId != envelope.streamId) return rejected(current, "stream_mismatch")
        if (envelope.eventId in current.recentEventIds) return rejected(current.copy(phase = ConnectionPhase.CONFLICT, safeErrorCode = "duplicate_event_id"), "duplicate_event_id")
        if (envelope.sequence <= current.sequence) return rejected(current.copy(phase = ConnectionPhase.CONFLICT, safeErrorCode = "duplicate_or_reordered_sequence"), "duplicate_or_reordered_sequence")
        if (envelope.cursor <= current.cursor) return rejected(current.copy(phase = ConnectionPhase.CONFLICT, safeErrorCode = "duplicate_or_reordered_cursor"), "duplicate_or_reordered_cursor")
        val expected = current.cursor + 1
        if (envelope.cursor != expected) {
            return rejected(current.copy(phase = ConnectionPhase.CONFLICT, safeErrorCode = "cursor_gap"), "cursor_gap")
        }
        return accepted(
            current.copy(
                cursor = envelope.cursor,
                sequence = envelope.sequence,
                recentEventIds = (current.recentEventIds + envelope.eventId).takeLast(MAX_EVENT_IDS),
                safeErrorCode = null,
            ),
        )
    }

    fun backoff(attempt: Int): Long = (BASE_BACKOFF_MS * (1L shl (attempt.coerceIn(1, MAX_RETRIES) - 1))).coerceAtMost(MAX_BACKOFF_MS)
    private fun accepted(state: RealtimeState) = RealtimeReduction(state, true)
    private fun rejected(state: RealtimeState, reason: String) = RealtimeReduction(state, false, reason)

    private const val BASE_BACKOFF_MS = 1_000L
    private const val MAX_BACKOFF_MS = 30_000L
    private const val MAX_RETRIES = 6
    private const val MAX_EVENT_IDS = 256
}
