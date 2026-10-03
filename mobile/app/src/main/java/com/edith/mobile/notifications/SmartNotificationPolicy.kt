package com.edith.mobile.notifications

import com.edith.mobile.background.QuietHours
import com.edith.mobile.contracts.RealtimeEnvelope
import java.time.Duration
import java.time.Instant
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

data class SmartNotice(val key: String, val title: String, val text: String, val route: String)

/** Called only after the authenticated envelope parser and ordering reducer accept an event. */
object SmartNotificationPolicy {
    private fun JsonObject.text(name: String) = (this[name] as? JsonPrimitive)?.contentOrNull
    fun consume(seen: List<String>, key: String): List<String>? =
        if (key in seen) null else (seen + key).takeLast(256)
    fun fromAccepted(envelope: RealtimeEnvelope, now: Instant): SmartNotice? {
        if (envelope.replayed) { return null }
        val age = runCatching { Duration.between(Instant.parse(envelope.occurredAt), now).seconds }.getOrNull() ?: return null
        if (age !in -30..300) return null
        val outer = envelope.payload as? JsonObject ?: return null
        val type = if (envelope.event == "task.event.v2") outer.text("type") else envelope.event.removeSuffix(".v2")
        val row = if (envelope.event == "task.event.v2") outer["payload"] as? JsonObject ?: return null else outer
        val id = outer.text("taskId") ?: row.text("transferId") ?: return null
        if (id.isBlank() || id.length > 200) return null
        val transfer = type in setOf("file_transfer.status", "cross_device.transfer.status")
        val outcome = when {
            type == "task.completed" || type == "task.status_changed" && row.text("toStatus") == "COMPLETED" -> "completed"
            type == "task.failed" || type == "task.status_changed" && row.text("toStatus") == "FAILED" -> "failed"
            transfer && row.text("status") in setOf("completed", "failed") -> row.text("status")!!
            else -> return null
        }
        return SmartNotice("${if (transfer) "transfer" else "task"}:$id:$outcome", "E.D.I.T.H.",
            if (outcome == "failed") "${if (transfer) "Dosya aktarımı" else "Görev"} tamamlanamadı. Ayrıntılar uygulamada."
            else "${if (transfer) "Dosya aktarımı" else "Görev"} tamamlandı.", if (transfer) "transfers" else "tasks")
    }

    fun allowed(enabled: Boolean, permission: Boolean, quiet: QuietHours, hour: Int) = enabled && permission && !quiet.contains(hour)
}

/** Future wire contract only: it is deliberately NOT enabled on the current EDITH stream. */
@Serializable
data class DesktopBotNoticeV1(
    val schema: String = "edith.desktop-bot.notice", val version: Int = 1,
    val eventId: String, val deviceId: String, val occurredAt: String, val expiresAt: String,
    val kind: String, val referenceId: String,
) {
    fun valid(now: Instant): Boolean = schema == "edith.desktop-bot.notice" && version == 1 &&
        listOf(eventId, deviceId, referenceId).all { it.isNotBlank() && it.length <= 200 } &&
        kind in setOf("download.completed", "download.failed", "reminder.due") &&
        runCatching { val occurred = Instant.parse(occurredAt); val expires = Instant.parse(expiresAt)
            occurred <= now.plusSeconds(30) && occurred >= now.minusSeconds(300) && expires > now && expires > occurred
        }.getOrDefault(false)
}
