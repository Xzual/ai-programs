package com.edith.mobile.background

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context

data class QuietHours(val enabled: Boolean, val startHour: Int, val endHour: Int) {
    fun contains(hour: Int): Boolean = enabled && if (startHour <= endHour) hour in startHour until endHour else hour >= startHour || hour < endHour
}

data class BackgroundDecision(val schedulePolling: Boolean, val allowNotification: Boolean, val reasonCode: String)

object MobileBackgroundPolicy {
    fun decide(pushConfigured: Boolean, notificationsEnabled: Boolean, quietHours: QuietHours, currentHour: Int): BackgroundDecision {
        if (!pushConfigured) return BackgroundDecision(false, false, "push_provider_not_configured_no_polling_fallback")
        if (!notificationsEnabled) return BackgroundDecision(false, false, "notifications_disabled")
        if (quietHours.contains(currentHour)) return BackgroundDecision(false, false, "quiet_hours_active")
        return BackgroundDecision(false, true, "push_only")
    }

    fun createPrivacyChannel(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(CHANNEL_ID, "E.D.I.T.H. privacy events", NotificationManager.IMPORTANCE_DEFAULT).apply {
            description = "Pairing, trust, transfer and emergency-stop delivery status"
            setShowBadge(false)
        })
    }

    const val CHANNEL_ID = "edith_privacy_events"
}
