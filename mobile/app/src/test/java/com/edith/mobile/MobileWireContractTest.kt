package com.edith.mobile

import com.edith.mobile.contracts.DeviceIdentity
import com.edith.mobile.contracts.DeviceTrust
import com.edith.mobile.contracts.EDITH_AMENDMENT
import com.edith.mobile.contracts.EDITH_MOBILE_PROTOCOL
import com.edith.mobile.contracts.EDITH_P256_SUITE
import com.edith.mobile.contracts.EDITH_VERSION
import com.edith.mobile.contracts.MobileCryptoNegotiationWire
import com.edith.mobile.contracts.MobileDeviceSessionWire
import com.edith.mobile.contracts.MobileApplicationEnvelopeWire
import com.edith.mobile.contracts.MobilePairingConsumeResultWire
import com.edith.mobile.contracts.MobilePairingOfferWire
import com.edith.mobile.contracts.MobileRemoteCommandResultWire
import com.edith.mobile.contracts.MobileServerCapabilitiesWire
import com.edith.mobile.contracts.MobileServerIdentityWire
import com.edith.mobile.contracts.MobileWireParser
import com.edith.mobile.contracts.PairingChallenge
import com.edith.mobile.contracts.PairingSession
import com.edith.mobile.contracts.PairingStatus
import com.edith.mobile.contracts.OwnerSessionBinding
import com.edith.mobile.contracts.ParseResult
import com.edith.mobile.contracts.encodeBase64Url
import com.edith.mobile.contracts.sha256Hex
import com.edith.mobile.contracts.spkiPublicKey
import com.edith.mobile.network.EndpointDecision
import com.edith.mobile.network.CommandConfirmation
import com.edith.mobile.network.MobileCommandAdapter
import com.edith.mobile.network.TrustedMobileTransportContext
import java.net.URI
import java.security.KeyPairGenerator
import java.time.Instant
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MobileWireContractTest {
    private val json = Json { explicitNulls = false }
    private val parser = MobileWireParser()

    @Test fun `pairing offer validates canonical transcript and fingerprints`() {
        val offer = offer()
        assertTrue(parser.pairingOffer(json.encodeToString(offer)) is ParseResult.Valid)
        val tampered = offer.copy(transcriptBase64url = encodeBase64Url("tampered".encodeToByteArray()))
        assertEquals("MOBILE_PAIRING_TRANSCRIPT_BINDING_INVALID", (parser.pairingOffer(json.encodeToString(tampered)) as ParseResult.Invalid).code)
    }

    @Test fun `command adapter gates trust and binds verified result`() {
        val adapter = MobileCommandAdapter(parser)
        val active = context()
        val now = Instant.parse("2099-09-28T12:00:00Z")
        val command = (adapter.create(active, "emergency_stop", 1, buildJsonObject { put("reason", "owner_requested") }, now, confirmation = CommandConfirmation(true, now)) as ParseResult.Valid).value
        val result = MobileRemoteCommandResultWire(2, "2.1", command.commandId, command.deviceId, command.workspaceId, command.sessionId, "completed", "2099-09-28T12:00:01Z", result = buildJsonObject { put("accepted", true) })
        assertTrue(adapter.verifiedReceipt(active, command, result) is ParseResult.Valid)
        val mismatched = result.copy(sessionId = "session-other")
        assertEquals("MOBILE_REMOTE_COMMAND_RESULT_BINDING_INVALID", (adapter.verifiedReceipt(active, command, mismatched) as ParseResult.Invalid).code)
        assertEquals("TRUSTED_DEVICE_REQUIRED", (adapter.create(active.copy(trusted = false), "emergency_stop", 1) as ParseResult.Invalid).code)
        assertEquals("OWNER_CONFIRMATION_REQUIRED", (adapter.create(active, "emergency_stop", 1, now = now) as ParseResult.Invalid).code)
    }

    @Test fun `encrypted chunk metadata binds transfer index and checksum`() {
        val bytes = "fixture".encodeToByteArray()
        val now = Instant.parse("2099-09-28T12:00:00Z")
        val result = MobileCommandAdapter(parser).chunkMetadata(context(), "transfer-1", 3, bytes, CommandConfirmation(true, now), now)
        val chunk = (result as ParseResult.Valid).value
        assertEquals("file.transfer.chunk:transfer-1:3", chunk.aadPurpose)
        assertEquals(sha256Hex(bytes), chunk.plaintextSha256)
        val rejected = MobileCommandAdapter(parser).chunkMetadata(context().copy(trusted = false), "transfer-1", 3, bytes, CommandConfirmation(true, now), now)
        assertEquals("TRUSTED_DEVICE_REQUIRED", (rejected as ParseResult.Invalid).code)
    }

    @Test fun `consume requires complete trusted owner and session binding before credential decrypt`() {
        val fingerprint = "a".repeat(64)
        val expires = "2099-09-28T13:00:00Z"
        val challenge = PairingChallenge(
            2, "2.1", EDITH_MOBILE_PROTOCOL, EDITH_P256_SUITE, "b".repeat(64),
            "challenge-1", "pair-1", "android-1", "workspace-1", "ECDSA-P256-SHA256", "c".repeat(64),
            issuedAt = "2099-09-28T12:00:00Z", expiresAt = expires, consumedAt = "2099-09-28T12:00:02Z",
            oneTime = true, status = "consumed",
        )
        val trust = DeviceTrust(2, "2.1", "android-1", "workspace-1", fingerprint, com.edith.mobile.contracts.TrustStatus.TRUSTED, "2099-09-28T12:00:01Z", expiresAt = expires)
        val binding = OwnerSessionBinding(2, "2.1", "binding-1", "owner-1", "android-1", "workspace-1", fingerprint, "2099-09-28T12:00:01Z", expires, "active")
        val pairing = PairingSession("pair-1", DeviceIdentity("android-1", "Android", "android", fingerprint = fingerprint), PairingStatus.APPROVED, "2099-09-28T12:00:00Z", expires, challenge, trust, binding)
        val session = MobileDeviceSessionWire(2, "2.1", EDITH_MOBILE_PROTOCOL, "session-1", "server-1", "android-1", "workspace-1", EDITH_P256_SUITE, "d".repeat(64), "active", "2099-09-28T12:00:02Z", expires)
        val envelope = MobileApplicationEnvelopeWire(2, "2.1", EDITH_MOBILE_PROTOCOL, "edith-mobile-aad-v1", "AES-256-GCM", EDITH_P256_SUITE, "session-1", "server-1", "android-1", "workspace-1", 1, "server_to_client", "http", "pairing.credential", encodeBase64Url(ByteArray(12)), encodeBase64Url(byteArrayOf(1)), encodeBase64Url(ByteArray(16)))
        val consume = MobilePairingConsumeResultWire(2, "2.1", pairing, session, envelope)
        assertTrue(parser.consume(json.encodeToString(consume)) is ParseResult.Valid)
        val tampered = consume.copy(pairing = pairing.copy(ownerBinding = binding.copy(workspaceId = "other-workspace")))
        assertEquals("MOBILE_PAIRING_CONSUME_BINDING_INVALID", (parser.consume(json.encodeToString(tampered)) as ParseResult.Invalid).code)
    }

    private fun offer(): MobilePairingOfferWire {
        val serverAgreement = KeyPairGenerator.getInstance("EC").apply { initialize(256) }.generateKeyPair().public.encoded
        val serverKey = spkiPublicKey("ECDH-P256", serverAgreement)
        val signingFingerprint = "a".repeat(64)
        val agreementFingerprint = "b".repeat(64)
        val commandsFingerprint = sha256Hex("emergency_stop\ntask.list".encodeToByteArray())
        val challengeText = encodeBase64Url(ByteArray(32) { it.toByte() })
        val expires = "2099-09-28T13:00:00Z"
        val challenge = PairingChallenge(
            2, "2.1", EDITH_MOBILE_PROTOCOL, EDITH_P256_SUITE, commandsFingerprint,
            "challenge-1", "pair-1", "android-1", "workspace-1", "ECDSA-P256-SHA256",
            sha256Hex(ByteArray(32) { it.toByte() }), issuedAt = "2099-09-28T12:00:00Z", expiresAt = expires,
            oneTime = true, status = "issued",
        )
        val pairing = PairingSession("pair-1", DeviceIdentity("android-1", "Android", "android", fingerprint = signingFingerprint), PairingStatus.REQUESTED, "2099-09-28T12:00:00Z", expires, challenge)
        val server = MobileServerIdentityWire(2, "2.1", EDITH_MOBILE_PROTOCOL, "server-1", "workspace-1", listOf(EDITH_P256_SUITE), capabilities())
        val transcript = listOf(
            "edith.mobile.pair.v1", "server-1", "workspace-1", "pair-1", "challenge-1", "android-1",
            EDITH_P256_SUITE, signingFingerprint, agreementFingerprint, serverKey.fingerprint,
            commandsFingerprint, expires, challengeText,
        ).joinToString("\n")
        return MobilePairingOfferWire(
            2, "2.1", EDITH_MOBILE_PROTOCOL, pairing, server,
            MobileCryptoNegotiationWire(2, "2.1", EDITH_MOBILE_PROTOCOL, listOf(EDITH_P256_SUITE), EDITH_P256_SUITE, "selected"),
            challengeText, serverKey, signingFingerprint, agreementFingerprint, commandsFingerprint,
            encodeBase64Url(transcript.encodeToByteArray()), sha256Hex(transcript.encodeToByteArray()), "123456", expires,
        )
    }

    private fun context() = TrustedMobileTransportContext(
        session = MobileDeviceSessionWire(2, "2.1", EDITH_MOBILE_PROTOCOL, "session-1", "server-1", "android-1", "workspace-1", EDITH_P256_SUITE, "c".repeat(64), "active", "2099-09-28T11:00:00Z", "2099-09-28T13:00:00Z"),
        trusted = true,
        trustExpiresAt = "2099-09-28T13:00:00Z",
        ownerBindingId = "binding-1",
        ownerBindingActive = true,
        ownerBindingExpiresAt = "2099-09-28T13:00:00Z",
        allowedCommands = setOf("emergency_stop", "file.upload"),
        endpointDecision = EndpointDecision.Allowed(URI("https://example.com"), URI("wss://example.com/api/mobile/realtime"), listOf("sha256/${"A".repeat(43)}=")),
    )

    private fun capabilities() = MobileServerCapabilitiesWire(
        realtime = true,
        encryptedEnvelope = true,
        resumableFileTransfer = true,
        remoteTaskControl = "low_risk_allowlist",
        remoteView = "disabled",
        wakeOnLan = "configuration_required",
        pushNotifications = "configuration_required",
        destructiveDeviceControl = "disabled",
        tlsRequiredForRemoteTransport = true,
    )
}
