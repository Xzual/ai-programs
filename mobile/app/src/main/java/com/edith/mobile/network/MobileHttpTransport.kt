package com.edith.mobile.network

import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import okhttp3.CertificatePinner
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener

class MobileHttpTransport(
    decision: EndpointDecision,
    private val json: Json = Json { ignoreUnknownKeys = true; explicitNulls = false },
) {
    private val allowed = decision as? EndpointDecision.Allowed
    private val client = allowed?.let { endpoint ->
        OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(20, TimeUnit.SECONDS)
            .writeTimeout(20, TimeUnit.SECONDS)
            .retryOnConnectionFailure(false)
            .apply {
                if (endpoint.pins.isNotEmpty()) {
                    certificatePinner(CertificatePinner.Builder().apply { endpoint.pins.forEach { add(endpoint.api.host, it) } }.build())
                }
            }
            .build()
    }

    suspend fun postPublic(path: String, body: String): NetworkResult<String> = request(path, "POST", body, null)
    suspend fun getPublic(path: String): NetworkResult<String> = request(path, "GET", null, null)

    suspend fun getAuthenticated(path: String, credentialToken: CharArray): NetworkResult<String> {
        val token = credentialToken.concatToString()
        return try {
            request(path, "GET", null, "Device $token")
        } finally {
            credentialToken.fill('\u0000')
        }
    }

    suspend fun postAuthenticated(path: String, credentialToken: CharArray, envelopeJson: String): NetworkResult<String> {
        val token = credentialToken.concatToString()
        return try {
            request(path, "POST", "{\"envelope\":$envelopeJson}", "Device $token")
        } finally {
            credentialToken.fill('\u0000')
        }
    }

    suspend fun putAuthenticated(path: String, credentialToken: CharArray, envelopeJson: String): NetworkResult<String> {
        val token = credentialToken.concatToString()
        return try {
            request(path, "PUT", "{\"envelope\":$envelopeJson}", "Device $token")
        } finally {
            credentialToken.fill('\u0000')
        }
    }

    fun openRealtime(
        credentialToken: CharArray,
        encryptedResumeEnvelope: String,
        onEnvelope: (String) -> Boolean,
        onClosed: (String) -> Unit,
    ): NetworkResult<RealtimeHandle> {
        val endpoint = allowed ?: return unavailableAndWipe(credentialToken, "endpoint_configuration_required")
        val http = client ?: return unavailableAndWipe(credentialToken, "network_client_unavailable")
        val token = credentialToken.concatToString()
        credentialToken.fill('\u0000')
        val request = Request.Builder().url(endpoint.realtime.toString()).header("Authorization", "Device $token").build()
        val listener = object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                webSocket.send(encryptedResumeEnvelope)
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                if (text.length <= MAX_RESPONSE_CHARS) {
                    if (!onEnvelope(text)) webSocket.close(1008, null)
                } else {
                    webSocket.close(1009, null)
                    onClosed("realtime_message_too_large")
                }
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) = onClosed("socket_closed_$code")
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) = onClosed("socket_transport_failed")
        }
        val socket = http.newWebSocket(request, listener)
        return NetworkResult.Success(object : RealtimeHandle { override fun close() { socket.close(1000, null) } })
    }

    fun envelopeFromResponse(raw: String): NetworkResult<String> = runCatching {
        val root = json.parseToJsonElement(raw).jsonObject
        if (root["success"]?.toString() != "true") return NetworkResult.Failure(safeError(root), false)
        val envelope = root["envelope"] as? JsonObject ?: return NetworkResult.Failure("encrypted_envelope_required", false)
        NetworkResult.Success(envelope.toString())
    }.getOrElse { NetworkResult.Failure("malformed_mobile_response", false) }

    private suspend fun request(path: String, method: String, body: String?, authorization: String?): NetworkResult<String> = withContext(Dispatchers.IO) {
        val endpoint = allowed ?: return@withContext NetworkResult.Unavailable("endpoint_configuration_required")
        val http = client ?: return@withContext NetworkResult.Unavailable("network_client_unavailable")
        val url = endpoint.api.resolve(if (path.startsWith('/')) path else "/$path").toString()
        val request = Request.Builder().url(url).apply {
            if (authorization != null) header("Authorization", authorization)
            header("Accept", "application/json")
            when (method) {
                "GET" -> get()
                "POST" -> post((body ?: "{}").toRequestBody(JSON_MEDIA_TYPE))
                "PUT" -> put((body ?: "{}").toRequestBody(JSON_MEDIA_TYPE))
                else -> error("Unsupported method")
            }
        }.build()
        runCatching {
            http.newCall(request).execute().use { response ->
                val body = response.body
                if (body != null && body.contentLength() > MAX_RESPONSE_BYTES) {
                    return@use NetworkResult.Failure("mobile_response_too_large", false)
                }
                val text = body?.source()?.readUtf8(MAX_RESPONSE_BYTES + 1).orEmpty()
                if (text.length > MAX_RESPONSE_CHARS) return@use NetworkResult.Failure("mobile_response_too_large", false)
                if (response.isSuccessful) NetworkResult.Success(text) else mapFailure(response.code, text)
            }
        }.getOrElse { NetworkResult.Failure("network_request_failed", true) }
    }

    private fun mapFailure(status: Int, raw: String): NetworkResult.Failure {
        val root = runCatching { json.parseToJsonElement(raw).jsonObject }.getOrNull()
        val code = root?.let(::safeError) ?: when (status) {
            401, 403 -> "device_auth_required"
            409 -> "remote_conflict"
            410 -> "pairing_expired"
            426 -> "tls_required"
            428 -> "configuration_required"
            429 -> "rate_limited"
            in 500..599 -> "remote_service_unavailable"
            else -> "remote_request_rejected"
        }
        return NetworkResult.Failure(code, status == 429 || status >= 500)
    }

    private fun safeError(root: JsonObject): String = root["errorCode"]?.toString()?.trim('"')
        ?.takeIf { it.matches(Regex("^[A-Za-z0-9._-]{1,128}$")) } ?: "mobile_request_rejected"

    private fun unavailableAndWipe(token: CharArray, code: String): NetworkResult.Unavailable {
        token.fill('\u0000')
        return NetworkResult.Unavailable(code)
    }

    private companion object {
        val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaType()
        const val MAX_RESPONSE_CHARS = 1_000_000
        const val MAX_RESPONSE_BYTES = 1_000_000L
    }
}
