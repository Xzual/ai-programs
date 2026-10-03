package com.edith.mobile

import com.edith.mobile.background.QuietHours
import com.edith.mobile.contracts.RealtimeEnvelope
import com.edith.mobile.notifications.DesktopBotNoticeV1
import com.edith.mobile.notifications.SmartNotificationPolicy
import java.time.Instant
import kotlinx.serialization.json.Json
import org.junit.Assert.*
import org.junit.Test

class SmartNotificationPolicyTest {
    private val now = Instant.parse("2026-10-01T12:00:00Z")
    private fun event(type: String = "task.completed.v2", payload: String = "{\"taskId\":\"task-1\"}", timestamp: String = now.toString(), replayed: Boolean = false) =
        RealtimeEnvelope("edith.shared", 2, type, "event-1", timestamp, 1, "stream-1", 1, "corr-1", replayed = replayed, payload = Json.parseToJsonElement(payload))
    @Test fun meaningfulTerminalEventsOnly() {
        assertEquals("tasks", SmartNotificationPolicy.fromAccepted(event(), now)?.route)
        assertNull(SmartNotificationPolicy.fromAccepted(event("task.progress.v2"), now))
        assertNull(SmartNotificationPolicy.fromAccepted(event(payload = "{\"taskId\":{\"bad\":true}}"), now))
        assertEquals("task:task-1:failed", SmartNotificationPolicy.fromAccepted(event("task.event.v2", "{\"taskId\":\"task-1\",\"type\":\"task.failed\",\"payload\":{\"errorCode\":\"SECRET\"}}"), now)?.key)
        assertFalse(SmartNotificationPolicy.fromAccepted(event("task.failed.v2"), now)!!.text.contains("task-1"))
        assertEquals("transfers", SmartNotificationPolicy.fromAccepted(event("file_transfer.status.v2", "{\"transferId\":\"file-1\",\"status\":\"completed\"}"), now)?.route)
        assertEquals("transfers", SmartNotificationPolicy.fromAccepted(event("cross_device.transfer.status.v2", "{\"transferId\":\"file-1\",\"status\":\"completed\"}"), now)?.route)
    }
    @Test fun replayStaleAndFutureDoNotAlert() {
        assertNull(SmartNotificationPolicy.fromAccepted(event(replayed = true), now))
        assertNull(SmartNotificationPolicy.fromAccepted(event(timestamp = now.minusSeconds(301).toString()), now))
        assertNull(SmartNotificationPolicy.fromAccepted(event(timestamp = now.plusSeconds(31).toString()), now))
    }
    @Test fun dedupSurvivesRestoredLedgerAndIsBounded() {
        val key = SmartNotificationPolicy.fromAccepted(event(), now)!!.key
        val ledger = SmartNotificationPolicy.consume(emptyList(), key)!!
        assertNull(SmartNotificationPolicy.consume(ledger.joinToString(",").split(','), key))
        assertEquals(256, SmartNotificationPolicy.consume((1..256).map(Int::toString), "new")!!.size)
        assertEquals(key, SmartNotificationPolicy.fromAccepted(event("task.status_changed.v2", "{\"taskId\":\"task-1\",\"toStatus\":\"COMPLETED\"}"), now)!!.key)
    }
    @Test fun permissionOptInAndQuietHours() {
        val quiet = QuietHours(true, 22, 8)
        assertFalse(SmartNotificationPolicy.allowed(false, true, quiet, 12))
        assertFalse(SmartNotificationPolicy.allowed(true, false, quiet, 12))
        assertFalse(SmartNotificationPolicy.allowed(true, true, quiet, 23))
        assertFalse(SmartNotificationPolicy.allowed(true, true, quiet, 7))
        assertTrue(SmartNotificationPolicy.allowed(true, true, quiet, 12))
    }
    @Test fun futureBotContractIsVersionedAndExpires() {
        val event = DesktopBotNoticeV1(eventId = "e", deviceId = "d", occurredAt = now.toString(), expiresAt = now.plusSeconds(60).toString(), kind = "reminder.due", referenceId = "r")
        assertTrue(event.valid(now)); assertFalse(event.copy(version = 2).valid(now)); assertFalse(event.valid(now.plusSeconds(61)))
    }
}
