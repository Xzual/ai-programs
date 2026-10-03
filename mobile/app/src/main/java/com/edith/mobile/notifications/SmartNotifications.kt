package com.edith.mobile.notifications

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import com.edith.mobile.MainActivity
import com.edith.mobile.R
import com.edith.mobile.background.QuietHours
import com.edith.mobile.contracts.RealtimeEnvelope
import java.security.MessageDigest
import java.time.Instant
import java.time.LocalTime

class SmartNotifications(private val context: Context) {
    private val prefs = context.getSharedPreferences("smart_notifications", Context.MODE_PRIVATE)
    private val manager = context.getSystemService(NotificationManager::class.java)
    var enabled: Boolean
        get() = prefs.getBoolean("enabled", false)
        set(value) { prefs.edit().putBoolean("enabled", value).apply(); if (!value) clearDelivered() }
    var quietEnabled: Boolean
        get() = prefs.getBoolean("quiet", true)
        set(value) { prefs.edit().putBoolean("quiet", value).apply() }
    var privatePreview: Boolean
        get() = prefs.getBoolean("private_preview", true)
        set(value) { prefs.edit().putBoolean("private_preview", value).apply() }
    val permissionGranted get() = context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED && manager.areNotificationsEnabled()

    @Synchronized fun accepted(envelope: RealtimeEnvelope, now: Instant) {
        val notice = SmartNotificationPolicy.fromAccepted(envelope, now) ?: return
        val key = MessageDigest.getInstance("SHA-256").digest(notice.key.toByteArray()).joinToString("") { "%02x".format(it) }
        val seen = prefs.getString("seen", "").orEmpty().split(',').filter(String::isNotEmpty)
        val consumed = SmartNotificationPolicy.consume(seen, key) ?: return
        // Suppressed events are consumed too: no old alert burst after consent/quiet hours.
        prefs.edit().putString("seen", consumed.joinToString(",")).apply()
        if (!SmartNotificationPolicy.allowed(enabled, permissionGranted, QuietHours(quietEnabled, 22, 8), LocalTime.now().hour)) return
        manager.createNotificationChannel(NotificationChannel(CHANNEL, "Akıllı bildirimler", NotificationManager.IMPORTANCE_DEFAULT).apply {
            description = "Doğrulanmış görev ve aktarım sonuçları"; lockscreenVisibility = Notification.VISIBILITY_PRIVATE
        })
        val intent = Intent(context, MainActivity::class.java).setAction("com.edith.mobile.SMART_NOTICE")
            .putExtra(EXTRA_ROUTE, notice.route).putExtra("notice_id", key)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val pending = PendingIntent.getActivity(context, key.hashCode(), intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = Notification.Builder(context, CHANNEL).setSmallIcon(R.drawable.ic_edith)
            .setContentTitle(notice.title).setContentText(if (privatePreview) "Yeni bir görev güncellemesi var." else notice.text)
            .setVisibility(Notification.VISIBILITY_PRIVATE).setContentIntent(pending).setAutoCancel(true).setOnlyAlertOnce(true).build()
        try { manager.notify(TAG, key.hashCode(), notification) } catch (_: SecurityException) { /* Permission can be revoked between check and post. */ }
    }

    fun clearDelivered() { manager.activeNotifications.filter { it.tag == TAG }.forEach { manager.cancel(TAG, it.id) } }
    companion object { const val CHANNEL = "edith_smart_notices_v1"; const val TAG = "edith_smart"; const val EXTRA_ROUTE = "smart_notice_route" }
}
