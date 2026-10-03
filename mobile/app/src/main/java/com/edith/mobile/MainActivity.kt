package com.edith.mobile

import android.os.Bundle
import android.content.Intent
import androidx.compose.runtime.mutableStateOf
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import com.edith.mobile.background.MobileBackgroundPolicy
import com.edith.mobile.ui.EdithMobileApp
import com.edith.mobile.ui.EdithTheme

class MainActivity : ComponentActivity() {
    private val notificationRoute = mutableStateOf<String?>(null)
    private fun acceptNotificationIntent(intent: Intent?) {
        notificationRoute.value = intent?.getStringExtra(com.edith.mobile.notifications.SmartNotifications.EXTRA_ROUTE)
            ?.takeIf { it in setOf("tasks", "transfers") }
    }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        enableEdgeToEdge()
        MobileBackgroundPolicy.createPrivacyChannel(this)
        acceptNotificationIntent(intent)
        setContent { EdithTheme { EdithMobileApp(notificationRoute = notificationRoute.value, consumeNotificationRoute = { notificationRoute.value = null }) } }
    }
    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); setIntent(intent); acceptNotificationIntent(intent) }
}
