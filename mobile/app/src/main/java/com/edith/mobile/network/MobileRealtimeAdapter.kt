package com.edith.mobile.network

import com.edith.mobile.contracts.CanonicalContractParser
import com.edith.mobile.contracts.MobileApplicationEnvelopeWire
import com.edith.mobile.contracts.ParseResult
import com.edith.mobile.contracts.RealtimeEnvelope
import com.edith.mobile.security.MobileApplicationEnvelope
import com.edith.mobile.security.MobileCryptoEngine
import com.edith.mobile.security.MobileEnvelopeChannel
import com.edith.mobile.security.MobileEnvelopeDirection
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

class MobileRealtimeAdapter(
    private val transport: MobileHttpTransport,
    private val parser: CanonicalContractParser = CanonicalContractParser(),
    private val json: Json = Json { ignoreUnknownKeys = true; explicitNulls = false },
) {
    fun connect(
        context: TrustedMobileTransportContext,
        crypto: MobileCryptoEngine,
        credentialToken: CharArray,
        afterCursor: Long,
        onEnvelope: (ParseResult<RealtimeEnvelope>) -> Unit,
        onClosed: (String) -> Unit,
    ): NetworkResult<RealtimeHandle> {
        if (!context.transportAuthorized()) {
            credentialToken.fill('\u0000')
            return NetworkResult.Unavailable("trusted_mobile_transport_required")
        }
        if (afterCursor < 0) {
            credentialToken.fill('\u0000')
            return NetworkResult.Failure("realtime_cursor_invalid", false)
        }
        val resume = crypto.encrypt(
            buildJsonObject {
                put("type", "resume")
                put("afterCursor", afterCursor)
            },
            MobileEnvelopeDirection.CLIENT_TO_SERVER,
            MobileEnvelopeChannel.REALTIME,
            "realtime.command",
        )
        return transport.openRealtime(
            credentialToken = credentialToken,
            encryptedResumeEnvelope = json.encodeToString(resume.toWire()),
            onEnvelope = { raw ->
                if (!context.transportAuthorized()) {
                    onClosed("mobile_authority_expired")
                    return@openRealtime false
                }
                val parsed = runCatching { json.decodeFromString<MobileApplicationEnvelopeWire>(raw) }.getOrNull()
                if (parsed == null || !validRealtimeEnvelope(parsed)) {
                    onClosed("realtime_envelope_invalid")
                    return@openRealtime false
                }
                val plaintext = runCatching {
                    crypto.decrypt(
                        parsed.toCrypto(),
                        MobileEnvelopeDirection.SERVER_TO_CLIENT,
                        MobileEnvelopeChannel.REALTIME,
                        "realtime.event",
                    )
                }.getOrElse {
                    onClosed("realtime_envelope_verification_failed")
                    return@openRealtime false
                }
                val canonical = parser.parseRealtime(plaintext.toString())
                onEnvelope(canonical)
                canonical is ParseResult.Valid
            },
            onClosed = onClosed,
        )
    }

    private fun validRealtimeEnvelope(value: MobileApplicationEnvelopeWire): Boolean =
        value.sessionId.isNotBlank() && value.direction == "server_to_client"
            && value.channel == "realtime" && value.purpose == "realtime.event"

    private fun MobileApplicationEnvelope.toWire() = MobileApplicationEnvelopeWire(
        contractVersion, amendment, protocolVersion, aadVersion, encryption, cryptoSuite, sessionId, serverId,
        deviceId, workspaceId, sequence, direction, channel, purpose, nonceBase64url, ciphertextBase64url, authTagBase64url,
    )

    private fun MobileApplicationEnvelopeWire.toCrypto() = MobileApplicationEnvelope(
        contractVersion, amendment, protocolVersion, aadVersion, encryption, cryptoSuite, sessionId, serverId,
        deviceId, workspaceId, sequence, direction, channel, purpose, nonceBase64url, ciphertextBase64url, authTagBase64url,
    )
}
