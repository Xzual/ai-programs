package com.edith.mobile

import com.edith.mobile.security.MOBILE_P256_SUITE
import com.edith.mobile.security.MobileApplicationEnvelope
import com.edith.mobile.security.MobileCryptoEngine
import com.edith.mobile.security.MobileCryptoException
import com.edith.mobile.security.MobileEnvelopeChannel
import com.edith.mobile.security.MobileEnvelopeDirection
import com.edith.mobile.security.MobilePairingTranscript
import com.edith.mobile.security.MobileSessionBinding
import com.edith.mobile.security.MobileSessionKeys
import java.nio.charset.StandardCharsets
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.MessageDigest
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.KeyAgreement
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MobileCryptoInteropTest {
    @Test
    fun `canonical JSON and transcript match reconciled wire format`() {
        val canonical = MobileCryptoEngine.canonicalJson(
            buildJsonObject {
                put("z", buildJsonArray { add(buildJsonObject { put("b", 2); put("a", 1) }) })
                put("escaped", "line\n\"quoted\"")
                put("a", true)
            },
        )
        assertEquals("{\"a\":true,\"escaped\":\"line\\n\\\"quoted\\\"\",\"z\":[{\"a\":1,\"b\":2}]}", canonical)

        val fixture = fixture()
        val expected = listOf(
            "edith.mobile.pair.v1",
            "server-1",
            "workspace-1",
            "pairing-1",
            "challenge-1",
            "android-1",
            MOBILE_P256_SUITE,
            fixture.signingFingerprint,
            fixture.agreementFingerprint,
            fixture.serverFingerprint,
            "d".repeat(64),
            "2099-09-28T13:00:00.000Z",
            MobileCryptoEngine.base64Url(fixture.challenge),
        ).joinToString("\n")
        assertEquals(expected, fixture.transcript)
        assertEquals(64, MobileCryptoEngine.sha256Hex(fixture.transcript).length)
        assertFalse(fixture.transcript.endsWith("\n"))
    }

    @Test
    fun `P256 descriptors proofs ECDH and directional HKDF interoperate`() {
        val fixture = fixture()
        val descriptor = MobileCryptoEngine.publicKeyDescriptor(fixture.signing.public, "ECDSA-P256-SHA256")
        assertEquals("spki_der_base64", descriptor.encoding)
        assertEquals(descriptor.fingerprint, descriptor.fingerprint.lowercase())
        assertEquals(hex(sha256(fixture.signing.public.encoded)), descriptor.fingerprint)

        val proofSigner = Signature.getInstance("SHA256withECDSA")
        proofSigner.initSign(fixture.signing.private)
        proofSigner.update(fixture.transcript.toByteArray(StandardCharsets.UTF_8))
        val derProof = proofSigner.sign()
        assertEquals(0x30, derProof.first().toInt() and 0xff)
        val proofBase64url = MobileCryptoEngine.base64Url(derProof)
        assertFalse(proofBase64url.contains('='))
        val verifier = Signature.getInstance("SHA256withECDSA")
        verifier.initVerify(fixture.signing.public)
        verifier.update(fixture.transcript.toByteArray(StandardCharsets.UTF_8))
        assertTrue(verifier.verify(Base64.getUrlDecoder().decode(proofBase64url)))

        val clientShared = ecdh(fixture.agreement, fixture.serverAgreement.public)
        val serverShared = ecdh(fixture.serverAgreement, fixture.agreement.public)
        assertArrayEquals(clientShared, serverShared)
        val clientKeys = MobileCryptoEngine.deriveSessionKeys(clientShared, fixture.challenge, fixture.transcript)
        val referenceKeys = referenceSessionKeys(serverShared, fixture.challenge, fixture.transcript)
        assertEquals(referenceKeys.fingerprint(), clientKeys.fingerprint())
        clientShared.fill(0)
        serverShared.fill(0)
        clientKeys.close()
        referenceKeys.close()
    }

    @Test
    fun `independent server vector and mobile roundtrip use exact AAD bindings`() {
        val fixture = fixture()
        val binding = binding()
        val serverShared = ecdh(fixture.serverAgreement, fixture.agreement.public)
        val referenceKeys = referenceSessionKeys(serverShared, fixture.challenge, fixture.transcript)
        val mobileShared = ecdh(fixture.agreement, fixture.serverAgreement.public)
        val mobileKeys = MobileCryptoEngine.deriveSessionKeys(mobileShared, fixture.challenge, fixture.transcript)
        val recipient = MobileCryptoEngine(binding, mobileKeys)
        val payload = buildJsonObject { put("credential", buildJsonObject { put("credentialId", "credential-1") }) }

        val serverEnvelope = independentEncrypt(
            binding = binding,
            keys = referenceKeys,
            sequence = 1,
            direction = MobileEnvelopeDirection.SERVER_TO_CLIENT,
            channel = MobileEnvelopeChannel.HTTP,
            purpose = "pairing.credential",
            payload = payload,
            nonce = ByteArray(12) { it.toByte() },
        )
        assertEquals(
            payload,
            recipient.decrypt(
                serverEnvelope,
                MobileEnvelopeDirection.SERVER_TO_CLIENT,
                MobileEnvelopeChannel.HTTP,
                "pairing.credential",
            ),
        )

        val senderKeys = MobileCryptoEngine.deriveSessionKeys(
            ecdh(fixture.agreement, fixture.serverAgreement.public),
            fixture.challenge,
            fixture.transcript,
        )
        val sender = MobileCryptoEngine(binding, senderKeys)
        val request = buildJsonObject { put("command", "task.list") }
        val mobileEnvelope = sender.encrypt(
            request,
            MobileEnvelopeDirection.CLIENT_TO_SERVER,
            MobileEnvelopeChannel.HTTP,
            "task.list",
        )
        assertEquals(request, independentDecrypt(mobileEnvelope, referenceKeys))

        sender.close()
        recipient.close()
        referenceKeys.close()
        serverShared.fill(0)
        mobileShared.fill(0)
    }

    @Test
    fun `tamper direction channel and purpose bindings are rejected without advancing sequence`() {
        val fixture = fixture()
        val binding = binding()
        val keys = deriveFixtureKeys(fixture)
        val payload = buildJsonObject { put("value", 1) }
        val baseline = independentEncrypt(
            binding,
            keys,
            1,
            MobileEnvelopeDirection.SERVER_TO_CLIENT,
            MobileEnvelopeChannel.HTTP,
            "session.status",
            payload,
            ByteArray(12) { (it + 20).toByte() },
        )

        expectCode("ENVELOPE_BINDING_INVALID") {
            freshEngine(fixture).decrypt(
                baseline.copy(direction = "client_to_server"),
                MobileEnvelopeDirection.SERVER_TO_CLIENT,
                MobileEnvelopeChannel.HTTP,
                "session.status",
            )
        }
        expectCode("ENVELOPE_BINDING_INVALID") {
            freshEngine(fixture).decrypt(
                baseline.copy(channel = "realtime"),
                MobileEnvelopeDirection.SERVER_TO_CLIENT,
                MobileEnvelopeChannel.HTTP,
                "session.status",
            )
        }
        expectCode("ENVELOPE_BINDING_INVALID") {
            freshEngine(fixture).decrypt(
                baseline.copy(purpose = "session.rotated"),
                MobileEnvelopeDirection.SERVER_TO_CLIENT,
                MobileEnvelopeChannel.HTTP,
                "session.status",
            )
        }
        val changedCiphertext = baseline.ciphertextBase64url.toCharArray().also {
            it[0] = if (it[0] == 'A') 'B' else 'A'
        }.concatToString()
        expectCode("ENVELOPE_AUTHENTICATION_FAILED") {
            freshEngine(fixture).decrypt(
                baseline.copy(ciphertextBase64url = changedCiphertext),
                MobileEnvelopeDirection.SERVER_TO_CLIENT,
                MobileEnvelopeChannel.HTTP,
                "session.status",
            )
        }
        keys.close()
    }

    @Test
    fun `exact next sequence rejects replay and gaps independently per channel`() {
        val fixture = fixture()
        val binding = binding()
        val referenceKeys = deriveFixtureKeys(fixture)
        val payload = buildJsonObject { put("event", "ok") }
        val first = independentEncrypt(
            binding,
            referenceKeys,
            1,
            MobileEnvelopeDirection.SERVER_TO_CLIENT,
            MobileEnvelopeChannel.REALTIME,
            "realtime.event",
            payload,
            ByteArray(12) { (it + 40).toByte() },
        )
        val recipient = freshEngine(fixture)
        assertEquals(
            payload,
            recipient.decrypt(
                first,
                MobileEnvelopeDirection.SERVER_TO_CLIENT,
                MobileEnvelopeChannel.REALTIME,
                "realtime.event",
            ),
        )
        expectCode("ENVELOPE_SEQUENCE_REPLAYED") {
            recipient.decrypt(
                first,
                MobileEnvelopeDirection.SERVER_TO_CLIENT,
                MobileEnvelopeChannel.REALTIME,
                "realtime.event",
            )
        }

        val nonceReplay = independentEncrypt(
            binding,
            referenceKeys,
            2,
            MobileEnvelopeDirection.SERVER_TO_CLIENT,
            MobileEnvelopeChannel.REALTIME,
            "realtime.event",
            payload,
            Base64.getUrlDecoder().decode(first.nonceBase64url),
        )
        expectCode("ENVELOPE_NONCE_REPLAYED") {
            recipient.decrypt(
                nonceReplay,
                MobileEnvelopeDirection.SERVER_TO_CLIENT,
                MobileEnvelopeChannel.REALTIME,
                "realtime.event",
            )
        }

        val gap = independentEncrypt(
            binding,
            referenceKeys,
            3,
            MobileEnvelopeDirection.SERVER_TO_CLIENT,
            MobileEnvelopeChannel.REALTIME,
            "realtime.event",
            payload,
            ByteArray(12) { (it + 60).toByte() },
        )
        expectCode("ENVELOPE_SEQUENCE_GAP") {
            recipient.decrypt(
                gap,
                MobileEnvelopeDirection.SERVER_TO_CLIENT,
                MobileEnvelopeChannel.REALTIME,
                "realtime.event",
            )
        }

        val independentHttp = independentEncrypt(
            binding,
            referenceKeys,
            1,
            MobileEnvelopeDirection.SERVER_TO_CLIENT,
            MobileEnvelopeChannel.HTTP,
            "session.status",
            payload,
            ByteArray(12) { (it + 80).toByte() },
        )
        assertEquals(
            payload,
            recipient.decrypt(
                independentHttp,
                MobileEnvelopeDirection.SERVER_TO_CLIENT,
                MobileEnvelopeChannel.HTTP,
                "session.status",
            ),
        )
        recipient.close()
        referenceKeys.close()
    }

    private fun fixture(): Fixture {
        val signing = p256()
        val agreement = p256()
        val serverAgreement = p256()
        val challenge = ByteArray(32) { (it + 1).toByte() }
        val signingFingerprint = hex(sha256(signing.public.encoded))
        val agreementFingerprint = hex(sha256(agreement.public.encoded))
        val serverFingerprint = hex(sha256(serverAgreement.public.encoded))
        val transcript = MobileCryptoEngine.transcript(
            MobilePairingTranscript(
                serverId = "server-1",
                workspaceId = "workspace-1",
                pairingId = "pairing-1",
                challengeId = "challenge-1",
                deviceId = "android-1",
                cryptoSuite = MOBILE_P256_SUITE,
                signingKeyFingerprint = signingFingerprint,
                agreementKeyFingerprint = agreementFingerprint,
                serverAgreementKeyFingerprint = serverFingerprint,
                requestedCommandsFingerprint = "d".repeat(64),
                expiresAt = "2099-09-28T13:00:00.000Z",
                challengeBase64url = MobileCryptoEngine.base64Url(challenge),
            ),
        )
        return Fixture(
            signing,
            agreement,
            serverAgreement,
            challenge,
            signingFingerprint,
            agreementFingerprint,
            serverFingerprint,
            transcript,
        )
    }

    private fun binding() = MobileSessionBinding(
        sessionId = "session-1",
        serverId = "server-1",
        deviceId = "android-1",
        workspaceId = "workspace-1",
    )

    private fun freshEngine(fixture: Fixture): MobileCryptoEngine =
        MobileCryptoEngine(binding(), deriveFixtureKeys(fixture))

    private fun deriveFixtureKeys(fixture: Fixture): MobileSessionKeys {
        val shared = ecdh(fixture.agreement, fixture.serverAgreement.public)
        return try {
            MobileCryptoEngine.deriveSessionKeys(shared, fixture.challenge, fixture.transcript)
        } finally {
            shared.fill(0)
        }
    }

    /** Independent test-side implementation of Node's two-stage HKDF schedule. */
    private fun referenceSessionKeys(
        shared: ByteArray,
        challenge: ByteArray,
        transcript: String,
    ): MobileSessionKeys {
        val root = referenceHkdf(
            shared,
            challenge,
            "edith.mobile.session.v1|${hex(sha256(transcript.toByteArray(StandardCharsets.UTF_8)))}"
                .toByteArray(StandardCharsets.UTF_8),
        )
        val c2s = referenceHkdf(root, ByteArray(0), "edith.mobile.c2s.v1".toByteArray())
        val s2c = referenceHkdf(root, ByteArray(0), "edith.mobile.s2c.v1".toByteArray())
        root.fill(0)
        return MobileSessionKeys.create(c2s, s2c).also {
            c2s.fill(0)
            s2c.fill(0)
        }
    }

    private fun independentEncrypt(
        binding: MobileSessionBinding,
        keys: MobileSessionKeys,
        sequence: Long,
        direction: MobileEnvelopeDirection,
        channel: MobileEnvelopeChannel,
        purpose: String,
        payload: JsonElement,
        nonce: ByteArray,
    ): MobileApplicationEnvelope {
        val header = buildJsonObject {
            put("contractVersion", 2)
            put("amendment", "2.1")
            put("protocolVersion", "edith.mobile/1")
            put("aadVersion", "edith-mobile-aad-v1")
            put("encryption", "AES-256-GCM")
            put("cryptoSuite", MOBILE_P256_SUITE)
            put("sessionId", binding.sessionId)
            put("serverId", binding.serverId)
            put("deviceId", binding.deviceId)
            put("workspaceId", binding.workspaceId)
            put("sequence", sequence)
            put("direction", direction.wireValue)
            put("channel", channel.wireValue)
            put("purpose", purpose)
        }
        val key = copyKey(keys, direction)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, nonce))
        cipher.updateAAD(MobileCryptoEngine.canonicalJson(header).toByteArray(StandardCharsets.UTF_8))
        val combined = cipher.doFinal(payload.toString().toByteArray(StandardCharsets.UTF_8))
        val ciphertext = combined.copyOfRange(0, combined.size - 16)
        val tag = combined.copyOfRange(combined.size - 16, combined.size)
        key.fill(0)
        combined.fill(0)
        return MobileApplicationEnvelope(
            2,
            "2.1",
            "edith.mobile/1",
            "edith-mobile-aad-v1",
            "AES-256-GCM",
            MOBILE_P256_SUITE,
            binding.sessionId,
            binding.serverId,
            binding.deviceId,
            binding.workspaceId,
            sequence,
            direction.wireValue,
            channel.wireValue,
            purpose,
            MobileCryptoEngine.base64Url(nonce),
            MobileCryptoEngine.base64Url(ciphertext),
            MobileCryptoEngine.base64Url(tag),
        )
    }

    private fun independentDecrypt(
        envelope: MobileApplicationEnvelope,
        keys: MobileSessionKeys,
    ): JsonElement {
        val header = buildJsonObject {
            put("contractVersion", envelope.contractVersion)
            put("amendment", envelope.amendment)
            put("protocolVersion", envelope.protocolVersion)
            put("aadVersion", envelope.aadVersion)
            put("encryption", envelope.encryption)
            put("cryptoSuite", envelope.cryptoSuite)
            put("sessionId", envelope.sessionId)
            put("serverId", envelope.serverId)
            put("deviceId", envelope.deviceId)
            put("workspaceId", envelope.workspaceId)
            put("sequence", envelope.sequence)
            put("direction", envelope.direction)
            put("channel", envelope.channel)
            put("purpose", envelope.purpose)
        }
        val direction = MobileEnvelopeDirection.entries.first { it.wireValue == envelope.direction }
        val key = copyKey(keys, direction)
        val nonce = Base64.getUrlDecoder().decode(envelope.nonceBase64url)
        val combined = Base64.getUrlDecoder().decode(envelope.ciphertextBase64url) +
            Base64.getUrlDecoder().decode(envelope.authTagBase64url)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, nonce))
        cipher.updateAAD(MobileCryptoEngine.canonicalJson(header).toByteArray(StandardCharsets.UTF_8))
        val plaintext = cipher.doFinal(combined)
        key.fill(0)
        combined.fill(0)
        return Json.parseToJsonElement(plaintext.toString(StandardCharsets.UTF_8)).also { plaintext.fill(0) }
    }

    private fun copyKey(keys: MobileSessionKeys, direction: MobileEnvelopeDirection): ByteArray {
        return keys.copyFor(direction)
    }

    private fun referenceHkdf(ikm: ByteArray, salt: ByteArray, info: ByteArray): ByteArray {
        val effectiveSalt = if (salt.isEmpty()) ByteArray(32) else salt
        val extract = Mac.getInstance("HmacSHA256")
        extract.init(SecretKeySpec(effectiveSalt, "HmacSHA256"))
        val prk = extract.doFinal(ikm)
        val expand = Mac.getInstance("HmacSHA256")
        expand.init(SecretKeySpec(prk, "HmacSHA256"))
        expand.update(info)
        expand.update(1.toByte())
        return expand.doFinal().also {
            prk.fill(0)
            if (salt.isEmpty()) effectiveSalt.fill(0)
        }
    }

    private fun ecdh(own: KeyPair, peer: java.security.PublicKey): ByteArray =
        KeyAgreement.getInstance("ECDH").run {
            init(own.private)
            doPhase(peer, true)
            generateSecret()
        }

    private fun p256(): KeyPair = KeyPairGenerator.getInstance("EC").run {
        initialize(ECGenParameterSpec("secp256r1"))
        generateKeyPair()
    }

    private fun sha256(value: ByteArray): ByteArray = MessageDigest.getInstance("SHA-256").digest(value)

    private fun hex(value: ByteArray): String =
        value.joinToString("") { "%02x".format(it.toInt() and 0xff) }

    private fun expectCode(code: String, operation: () -> Unit) {
        try {
            operation()
            throw AssertionError("Expected $code")
        } catch (error: MobileCryptoException) {
            assertEquals(code, error.code)
        }
    }

    private data class Fixture(
        val signing: KeyPair,
        val agreement: KeyPair,
        val serverAgreement: KeyPair,
        val challenge: ByteArray,
        val signingFingerprint: String,
        val agreementFingerprint: String,
        val serverFingerprint: String,
        val transcript: String,
    )
}
