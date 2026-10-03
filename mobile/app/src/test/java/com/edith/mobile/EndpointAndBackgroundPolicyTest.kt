package com.edith.mobile

import com.edith.mobile.background.MobileBackgroundPolicy
import com.edith.mobile.background.QuietHours
import com.edith.mobile.network.EndpointConfig
import com.edith.mobile.network.EndpointDecision
import com.edith.mobile.network.EndpointPolicy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class EndpointAndBackgroundPolicyTest {
    @Test fun `release transport requires tls and certificate pin`() {
        assertTrue(EndpointPolicy.validate(EndpointConfig("http://example.com", "ws://example.com", emptyList(), false)) is EndpointDecision.Blocked)
        assertEquals("certificate_pin_required", (EndpointPolicy.validate(EndpointConfig("https://example.com", "wss://example.com/ws", emptyList(), false)) as EndpointDecision.Blocked).reasonCode)
        assertTrue(EndpointPolicy.validate(EndpointConfig("https://example.com", "wss://example.com/ws", listOf("sha256/${"A".repeat(43)}="), false)) is EndpointDecision.Allowed)
    }

    @Test fun `debug cleartext is loopback only`() {
        assertTrue(EndpointPolicy.validate(EndpointConfig("http://10.0.2.2:3000", "ws://10.0.2.2:3000/ws", emptyList(), true)) is EndpointDecision.Allowed)
        assertTrue(EndpointPolicy.validate(EndpointConfig("http://192.168.1.3", "ws://192.168.1.3/ws", emptyList(), true)) is EndpointDecision.Blocked)
    }

    @Test fun `api and realtime must share pinned host`() {
        val result = EndpointPolicy.validate(EndpointConfig("https://api.example.com", "wss://stream.example.com/ws", listOf("sha256/${"A".repeat(43)}="), false))
        assertEquals("endpoint_host_mismatch", (result as EndpointDecision.Blocked).reasonCode)
    }

    @Test fun `missing push does not schedule polling fallback`() {
        val decision = MobileBackgroundPolicy.decide(false, true, QuietHours(false, 23, 7), 12)
        assertFalse(decision.schedulePolling)
        assertFalse(decision.allowNotification)
        assertEquals("push_provider_not_configured_no_polling_fallback", decision.reasonCode)
    }

    @Test fun `quiet hours suppress notification`() {
        val decision = MobileBackgroundPolicy.decide(true, true, QuietHours(true, 23, 7), 2)
        assertFalse(decision.allowNotification)
        assertEquals("quiet_hours_active", decision.reasonCode)
    }

    @Test fun `release websocket also requires tls`() {
        val result = EndpointPolicy.validate(
            EndpointConfig("https://example.com", "ws://example.com/api/mobile/realtime", listOf("sha256/${"A".repeat(43)}="), false),
        )
        assertEquals("wss_required", (result as EndpointDecision.Blocked).reasonCode)
    }
}
