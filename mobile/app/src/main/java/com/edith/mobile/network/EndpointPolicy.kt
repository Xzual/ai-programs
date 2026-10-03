package com.edith.mobile.network

import java.net.URI

data class EndpointConfig(
    val apiBaseUrl: String,
    val realtimeUrl: String,
    val certificatePins: List<String>,
    val debugBuild: Boolean,
)

sealed interface EndpointDecision {
    data class Allowed(val api: URI, val realtime: URI, val pins: List<String>) : EndpointDecision
    data class Blocked(val reasonCode: String) : EndpointDecision
}

object EndpointPolicy {
    fun validate(config: EndpointConfig): EndpointDecision {
        if (config.apiBaseUrl.isBlank() || config.realtimeUrl.isBlank()) return EndpointDecision.Blocked("endpoint_configuration_required")
        val api = runCatching { URI(config.apiBaseUrl) }.getOrNull() ?: return EndpointDecision.Blocked("api_url_invalid")
        val realtime = runCatching { URI(config.realtimeUrl) }.getOrNull() ?: return EndpointDecision.Blocked("realtime_url_invalid")
        if (api.userInfo != null || realtime.userInfo != null) return EndpointDecision.Blocked("credentials_in_url_forbidden")
        if (api.query != null || realtime.query != null) return EndpointDecision.Blocked("endpoint_query_forbidden")
        if (!api.host.equals(realtime.host, ignoreCase = true)) return EndpointDecision.Blocked("endpoint_host_mismatch")
        val loopbackDebug = config.debugBuild && api.host in setOf("127.0.0.1", "10.0.2.2", "localhost")
        if (api.scheme != "https" && !(loopbackDebug && api.scheme == "http")) return EndpointDecision.Blocked("https_required")
        if (realtime.scheme != "wss" && !(loopbackDebug && realtime.scheme == "ws")) return EndpointDecision.Blocked("wss_required")
        if (!loopbackDebug && config.certificatePins.none(::validPin)) return EndpointDecision.Blocked("certificate_pin_required")
        return EndpointDecision.Allowed(api, realtime, config.certificatePins.filter(::validPin))
    }

    private fun validPin(pin: String) = pin.matches(Regex("^sha256/[A-Za-z0-9+/]{43}=$"))
}
