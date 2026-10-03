package com.edith.mobile.security

import java.nio.charset.StandardCharsets
import java.security.KeyFactory
import java.security.MessageDigest
import java.security.PrivateKey
import java.security.PublicKey
import java.security.SecureRandom
import java.security.interfaces.ECPublicKey
import java.security.spec.X509EncodedKeySpec
import java.time.Instant
import java.util.Base64
import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.KeyAgreement
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

const val MOBILE_P256_SUITE = "P256_ECDSA_SHA256_P256_ECDH_HKDF_SHA256_AES256_GCM"

data class MobilePublicKeyDescriptor(
    val contractVersion: Int = 2,
    val amendment: String = "2.1",
    val algorithm: String,
    val encoding: String = "spki_der_base64",
    val value: String,
    val fingerprint: String,
)

data class MobilePairingTranscript(
    val serverId: String,
    val workspaceId: String,
    val pairingId: String,
    val challengeId: String,
    val deviceId: String,
    val cryptoSuite: String,
    val signingKeyFingerprint: String,
    val agreementKeyFingerprint: String,
    val serverAgreementKeyFingerprint: String,
    val requestedCommandsFingerprint: String,
    val expiresAt: String,
    val challengeBase64url: String,
)

data class MobileSessionBinding(
    val sessionId: String,
    val serverId: String,
    val deviceId: String,
    val workspaceId: String,
    val cryptoSuite: String = MOBILE_P256_SUITE,
)

enum class MobileEnvelopeDirection(val wireValue: String) {
    CLIENT_TO_SERVER("client_to_server"),
    SERVER_TO_CLIENT("server_to_client"),
}

enum class MobileEnvelopeChannel(val wireValue: String) {
    HTTP("http"),
    REALTIME("realtime"),
    TRANSFER("transfer"),
}

data class MobileApplicationEnvelope(
    val contractVersion: Int,
    val amendment: String,
    val protocolVersion: String,
    val aadVersion: String,
    val encryption: String,
    val cryptoSuite: String,
    val sessionId: String,
    val serverId: String,
    val deviceId: String,
    val workspaceId: String,
    val sequence: Long,
    val direction: String,
    val channel: String,
    val purpose: String,
    val nonceBase64url: String,
    val ciphertextBase64url: String,
    val authTagBase64url: String,
)

class MobileCryptoException(val code: String, cause: Throwable? = null) :
    IllegalStateException(code, cause)

class MobileSessionKeys private constructor(
    clientToServerKey: ByteArray,
    serverToClientKey: ByteArray,
) : AutoCloseable {
    private val clientToServer = clientToServerKey.copyOf()
    private val serverToClient = serverToClientKey.copyOf()

    init {
        require(clientToServer.size == AES_KEY_BYTES && serverToClient.size == AES_KEY_BYTES) {
            "SESSION_KEY_LENGTH_INVALID"
        }
    }

    internal fun copyFor(direction: MobileEnvelopeDirection): ByteArray =
        when (direction) {
            MobileEnvelopeDirection.CLIENT_TO_SERVER -> clientToServer.copyOf()
            MobileEnvelopeDirection.SERVER_TO_CLIENT -> serverToClient.copyOf()
        }

    fun fingerprint(): String = MobileCryptoEngine.sha256Hex(clientToServer + serverToClient)

    override fun close() {
        clientToServer.fill(0)
        serverToClient.fill(0)
    }

    companion object {
        private const val AES_KEY_BYTES = 32

        internal fun create(clientToServer: ByteArray, serverToClient: ByteArray) =
            MobileSessionKeys(clientToServer, serverToClient)
    }
}

/**
 * Stateful application-envelope codec for one authenticated mobile session.
 * Receive counters advance only after successful authentication and JSON parsing.
 */
class MobileCryptoEngine(
    private val binding: MobileSessionBinding,
    sessionKeys: MobileSessionKeys,
    private val secureRandom: SecureRandom = SecureRandom(),
) : AutoCloseable {
    private val keys = sessionKeys
    private val sendSequences = sequenceMap()
    private val receiveSequences = sequenceMap()
    private val receivedNonces = LinkedHashSet<String>()

    init {
        require(binding.cryptoSuite == MOBILE_P256_SUITE) { "MOBILE_CRYPTO_SUITE_UNSUPPORTED" }
        validateIdentifier(binding.sessionId)
        validateIdentifier(binding.serverId)
        validateIdentifier(binding.deviceId)
        validateIdentifier(binding.workspaceId)
    }

    @Synchronized
    fun encrypt(
        payload: JsonElement,
        direction: MobileEnvelopeDirection,
        channel: MobileEnvelopeChannel,
        purpose: String,
    ): MobileApplicationEnvelope {
        validateIdentifier(purpose)
        val keyId = SequenceKey(direction, channel)
        val sequence = (sendSequences[keyId] ?: 0L) + 1L
        val nonce = ByteArray(NONCE_BYTES).also(secureRandom::nextBytes)
        val header = header(sequence, direction, channel, purpose)
        val key = keys.copyFor(direction)
        return try {
            val encrypted = aesGcmEncrypt(
                key = key,
                nonce = nonce,
                aad = canonicalJson(header).toByteArray(StandardCharsets.UTF_8),
                plaintext = payload.toString().toByteArray(StandardCharsets.UTF_8),
            )
            sendSequences[keyId] = sequence
            MobileApplicationEnvelope(
                contractVersion = CONTRACT_VERSION,
                amendment = CONTRACT_AMENDMENT,
                protocolVersion = PROTOCOL_VERSION,
                aadVersion = AAD_VERSION,
                encryption = ENCRYPTION,
                cryptoSuite = binding.cryptoSuite,
                sessionId = binding.sessionId,
                serverId = binding.serverId,
                deviceId = binding.deviceId,
                workspaceId = binding.workspaceId,
                sequence = sequence,
                direction = direction.wireValue,
                channel = channel.wireValue,
                purpose = purpose,
                nonceBase64url = base64Url(nonce),
                ciphertextBase64url = base64Url(encrypted.ciphertext),
                authTagBase64url = base64Url(encrypted.tag),
            )
        } finally {
            key.fill(0)
            nonce.fill(0)
        }
    }

    @Synchronized
    fun decrypt(
        envelope: MobileApplicationEnvelope,
        expectedDirection: MobileEnvelopeDirection,
        expectedChannel: MobileEnvelopeChannel,
        expectedPurpose: String,
    ): JsonElement {
        validateEnvelopeShape(envelope)
        if (
            envelope.sessionId != binding.sessionId ||
            envelope.serverId != binding.serverId ||
            envelope.deviceId != binding.deviceId ||
            envelope.workspaceId != binding.workspaceId ||
            envelope.cryptoSuite != binding.cryptoSuite ||
            envelope.direction != expectedDirection.wireValue ||
            envelope.channel != expectedChannel.wireValue ||
            envelope.purpose != expectedPurpose
        ) {
            throw MobileCryptoException("ENVELOPE_BINDING_INVALID")
        }

        val keyId = SequenceKey(expectedDirection, expectedChannel)
        val previous = receiveSequences[keyId] ?: 0L
        if (envelope.sequence <= previous) throw MobileCryptoException("ENVELOPE_SEQUENCE_REPLAYED")
        if (envelope.sequence != previous + 1L) throw MobileCryptoException("ENVELOPE_SEQUENCE_GAP")
        val nonceIdentity = "${expectedDirection.wireValue}:${envelope.nonceBase64url}"
        if (receivedNonces.contains(nonceIdentity)) throw MobileCryptoException("ENVELOPE_NONCE_REPLAYED")

        val nonce = decodeBase64Url(envelope.nonceBase64url, "ENVELOPE_NONCE_INVALID")
        val ciphertext = decodeBase64Url(envelope.ciphertextBase64url, "MOBILE_APPLICATION_ENVELOPE_INVALID")
        val tag = decodeBase64Url(envelope.authTagBase64url, "MOBILE_APPLICATION_ENVELOPE_INVALID")
        if (nonce.size != NONCE_BYTES) throw MobileCryptoException("ENVELOPE_NONCE_INVALID")
        if (tag.size != TAG_BYTES) throw MobileCryptoException("MOBILE_APPLICATION_ENVELOPE_INVALID")
        val key = keys.copyFor(expectedDirection)
        val plaintext = try {
            aesGcmDecrypt(
                key = key,
                nonce = nonce,
                aad = canonicalJson(envelope.headerJson()).toByteArray(StandardCharsets.UTF_8),
                ciphertext = ciphertext,
                tag = tag,
            )
        } catch (error: AEADBadTagException) {
            throw MobileCryptoException("ENVELOPE_AUTHENTICATION_FAILED", error)
        } catch (error: MobileCryptoException) {
            throw error
        } catch (error: Exception) {
            throw MobileCryptoException("ENVELOPE_AUTHENTICATION_FAILED", error)
        } finally {
            key.fill(0)
            nonce.fill(0)
            ciphertext.fill(0)
            tag.fill(0)
        }

        val parsed = try {
            Json.parseToJsonElement(plaintext.toString(StandardCharsets.UTF_8))
        } catch (error: Exception) {
            throw MobileCryptoException("ENVELOPE_PAYLOAD_INVALID", error)
        } finally {
            plaintext.fill(0)
        }

        receiveSequences[keyId] = envelope.sequence
        receivedNonces.add(nonceIdentity)
        if (receivedNonces.size > MAX_RECEIVED_NONCES) {
            val oldest = receivedNonces.iterator()
            if (oldest.hasNext()) {
                oldest.next()
                oldest.remove()
            }
        }
        return parsed
    }

    override fun close() {
        keys.close()
        sendSequences.clear()
        receiveSequences.clear()
        receivedNonces.clear()
    }

    private fun header(
        sequence: Long,
        direction: MobileEnvelopeDirection,
        channel: MobileEnvelopeChannel,
        purpose: String,
    ): JsonObject = buildJsonObject {
        put("contractVersion", CONTRACT_VERSION)
        put("amendment", CONTRACT_AMENDMENT)
        put("protocolVersion", PROTOCOL_VERSION)
        put("aadVersion", AAD_VERSION)
        put("encryption", ENCRYPTION)
        put("cryptoSuite", binding.cryptoSuite)
        put("sessionId", binding.sessionId)
        put("serverId", binding.serverId)
        put("deviceId", binding.deviceId)
        put("workspaceId", binding.workspaceId)
        put("sequence", sequence)
        put("direction", direction.wireValue)
        put("channel", channel.wireValue)
        put("purpose", purpose)
    }

    private fun validateEnvelopeShape(envelope: MobileApplicationEnvelope) {
        if (
            envelope.contractVersion != CONTRACT_VERSION ||
            envelope.amendment != CONTRACT_AMENDMENT ||
            envelope.protocolVersion != PROTOCOL_VERSION ||
            envelope.aadVersion != AAD_VERSION ||
            envelope.encryption != ENCRYPTION ||
            envelope.cryptoSuite != MOBILE_P256_SUITE ||
            !isSafeIdentifier(envelope.sessionId) ||
            !isSafeIdentifier(envelope.serverId) ||
            !isSafeIdentifier(envelope.deviceId) ||
            !isSafeIdentifier(envelope.workspaceId) ||
            envelope.sequence !in 1L..MAX_SAFE_JSON_INTEGER ||
            envelope.direction !in MobileEnvelopeDirection.entries.map { it.wireValue } ||
            envelope.channel !in MobileEnvelopeChannel.entries.map { it.wireValue } ||
            !isSafeIdentifier(envelope.purpose) ||
            !isUnpaddedBase64Url(envelope.nonceBase64url) || envelope.nonceBase64url.length != 16 ||
            !isUnpaddedBase64Url(envelope.ciphertextBase64url) ||
            !isUnpaddedBase64Url(envelope.authTagBase64url) || envelope.authTagBase64url.length != 22
        ) {
            throw MobileCryptoException("MOBILE_APPLICATION_ENVELOPE_INVALID")
        }
    }

    companion object {
        const val CONTRACT_VERSION = 2
        const val CONTRACT_AMENDMENT = "2.1"
        const val PROTOCOL_VERSION = "edith.mobile/1"
        const val AAD_VERSION = "edith-mobile-aad-v1"
        const val ENCRYPTION = "AES-256-GCM"
        private const val NONCE_BYTES = 12
        private const val TAG_BYTES = 16
        private const val MAX_RECEIVED_NONCES = 2_000
        private const val MAX_SAFE_JSON_INTEGER = 9_007_199_254_740_991L
        private val BASE64_URL_PATTERN = Regex("^[A-Za-z0-9_-]*$")
        private val LOWER_SHA256_PATTERN = Regex("^[a-f0-9]{64}$")
        private val PRIME256V1_OID = byteArrayOf(
            0x06, 0x08, 0x2a, 0x86.toByte(), 0x48, 0xce.toByte(), 0x3d, 0x03, 0x01, 0x07,
        )

        fun transcript(value: MobilePairingTranscript): String {
            val lines = listOf(
                "edith.mobile.pair.v1",
                value.serverId,
                value.workspaceId,
                value.pairingId,
                value.challengeId,
                value.deviceId,
                value.cryptoSuite,
                value.signingKeyFingerprint,
                value.agreementKeyFingerprint,
                value.serverAgreementKeyFingerprint,
                value.requestedCommandsFingerprint,
                value.expiresAt,
                value.challengeBase64url,
            )
            if (lines.any { it.isBlank() || it.contains('\n') || it.contains('\r') }) {
                throw MobileCryptoException("PAIRING_TRANSCRIPT_BINDING_INVALID")
            }
            if (value.cryptoSuite != MOBILE_P256_SUITE) {
                throw MobileCryptoException("MOBILE_CRYPTO_SUITE_UNSUPPORTED")
            }
            if (
                !LOWER_SHA256_PATTERN.matches(value.signingKeyFingerprint) ||
                !LOWER_SHA256_PATTERN.matches(value.agreementKeyFingerprint) ||
                !LOWER_SHA256_PATTERN.matches(value.serverAgreementKeyFingerprint) ||
                !LOWER_SHA256_PATTERN.matches(value.requestedCommandsFingerprint)
            ) {
                throw MobileCryptoException("PAIRING_TRANSCRIPT_BINDING_INVALID")
            }
            try {
                Instant.parse(value.expiresAt)
            } catch (error: Exception) {
                throw MobileCryptoException("PAIRING_TRANSCRIPT_BINDING_INVALID", error)
            }
            val challenge = decodeBase64Url(value.challengeBase64url, "PAIRING_CHALLENGE_INVALID")
            if (value.challengeBase64url.length != 43 || challenge.size != 32) {
                throw MobileCryptoException("PAIRING_CHALLENGE_INVALID")
            }
            challenge.fill(0)
            return lines.joinToString("\n")
        }

        fun consumeTranscript(transcript: String): String {
            parseTranscript(transcript)
            return "$transcript\nconsume"
        }

        fun parseTranscript(value: String): MobilePairingTranscript {
            val lines = value.split('\n')
            if (lines.size != 13 || lines[0] != "edith.mobile.pair.v1") {
                throw MobileCryptoException("PAIRING_TRANSCRIPT_BINDING_INVALID")
            }
            val parsed = MobilePairingTranscript(
                serverId = lines[1],
                workspaceId = lines[2],
                pairingId = lines[3],
                challengeId = lines[4],
                deviceId = lines[5],
                cryptoSuite = lines[6],
                signingKeyFingerprint = lines[7],
                agreementKeyFingerprint = lines[8],
                serverAgreementKeyFingerprint = lines[9],
                requestedCommandsFingerprint = lines[10],
                expiresAt = lines[11],
                challengeBase64url = lines[12],
            )
            if (transcript(parsed) != value) {
                throw MobileCryptoException("PAIRING_TRANSCRIPT_BINDING_INVALID")
            }
            return parsed
        }

        fun canonicalJson(value: JsonElement): String = when (value) {
            JsonNull -> "null"
            is JsonArray -> value.joinToString(separator = ",", prefix = "[", postfix = "]") { canonicalJson(it) }
            is JsonObject -> value.entries.sortedBy { it.key }.joinToString(separator = ",", prefix = "{", postfix = "}") {
                "${jsonString(it.key)}:${canonicalJson(it.value)}"
            }
            is JsonPrimitive -> if (value.isString) jsonString(value.content) else value.content
        }

        fun sha256Hex(value: ByteArray): String =
            MessageDigest.getInstance("SHA-256").digest(value)
                .joinToString("") { "%02x".format(it.toInt() and 0xff) }

        fun sha256Hex(value: String): String = sha256Hex(value.toByteArray(StandardCharsets.UTF_8))

        fun publicKeyDescriptor(publicKey: PublicKey, algorithm: String): MobilePublicKeyDescriptor {
            if (algorithm !in setOf("ECDSA-P256-SHA256", "ECDH-P256")) {
                throw MobileCryptoException("MOBILE_PUBLIC_KEY_ALGORITHM_MISMATCH")
            }
            validateP256PublicKey(publicKey)
            val encoded = publicKey.encoded ?: throw MobileCryptoException("MOBILE_PUBLIC_KEY_INVALID")
            return MobilePublicKeyDescriptor(
                algorithm = algorithm,
                value = Base64.getEncoder().encodeToString(encoded),
                fingerprint = sha256Hex(encoded),
            )
        }

        fun decodeP256PublicKey(spkiBase64: String): PublicKey {
            val bytes = try {
                Base64.getDecoder().decode(spkiBase64)
            } catch (error: IllegalArgumentException) {
                throw MobileCryptoException("MOBILE_PUBLIC_KEY_INVALID", error)
            }
            return try {
                if (Base64.getEncoder().encodeToString(bytes) != spkiBase64) {
                    throw MobileCryptoException("MOBILE_PUBLIC_KEY_INVALID")
                }
                if (!contains(bytes, PRIME256V1_OID)) {
                    throw MobileCryptoException("MOBILE_PUBLIC_KEY_ALGORITHM_MISMATCH")
                }
                KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(bytes)).also(::validateP256PublicKey)
            } catch (error: MobileCryptoException) {
                throw error
            } catch (error: Exception) {
                throw MobileCryptoException("MOBILE_PUBLIC_KEY_INVALID", error)
            } finally {
                bytes.fill(0)
            }
        }

        fun deriveSharedSecret(
            privateKey: PrivateKey,
            peerPublicKey: PublicKey,
            provider: String? = null,
        ): ByteArray {
            validateP256PublicKey(peerPublicKey)
            return try {
                val agreement = if (provider == null) {
                    KeyAgreement.getInstance("ECDH")
                } else {
                    KeyAgreement.getInstance("ECDH", provider)
                }
                agreement.run {
                    init(privateKey)
                    doPhase(peerPublicKey, true)
                    generateSecret()
                }
            } catch (error: Exception) {
                throw MobileCryptoException("PAIRING_KEY_AGREEMENT_FAILED", error)
            }
        }

        fun deriveSessionKeys(
            sharedSecret: ByteArray,
            challengeBytes: ByteArray,
            transcript: String,
        ): MobileSessionKeys {
            if (sharedSecret.isEmpty() || challengeBytes.size != 32) {
                throw MobileCryptoException("PAIRING_KEY_DERIVATION_INVALID")
            }
            val root = hkdfSha256(
                inputKeyMaterial = sharedSecret,
                salt = challengeBytes,
                info = "edith.mobile.session.v1|${sha256Hex(transcript)}".toByteArray(StandardCharsets.UTF_8),
                length = 32,
            )
            return try {
                val c2s = hkdfSha256(
                    inputKeyMaterial = root,
                    salt = ByteArray(0),
                    info = "edith.mobile.c2s.v1".toByteArray(StandardCharsets.UTF_8),
                    length = 32,
                )
                val s2c = try {
                    hkdfSha256(
                        inputKeyMaterial = root,
                        salt = ByteArray(0),
                        info = "edith.mobile.s2c.v1".toByteArray(StandardCharsets.UTF_8),
                        length = 32,
                    )
                } catch (error: Exception) {
                    c2s.fill(0)
                    throw error
                }
                MobileSessionKeys.create(c2s, s2c).also {
                    c2s.fill(0)
                    s2c.fill(0)
                }
            } finally {
                root.fill(0)
            }
        }

        fun base64Url(value: ByteArray): String = Base64.getUrlEncoder().withoutPadding().encodeToString(value)

        fun decodeBase64Url(value: String, errorCode: String): ByteArray {
            if (!isUnpaddedBase64Url(value)) throw MobileCryptoException(errorCode)
            return try {
                Base64.getUrlDecoder().decode(value).also {
                    if (base64Url(it) != value) throw MobileCryptoException(errorCode)
                }
            } catch (error: IllegalArgumentException) {
                throw MobileCryptoException(errorCode, error)
            }
        }

        internal fun hkdfSha256(
            inputKeyMaterial: ByteArray,
            salt: ByteArray,
            info: ByteArray,
            length: Int,
        ): ByteArray {
            require(length in 1..(255 * 32)) { "HKDF_LENGTH_INVALID" }
            val effectiveSalt = if (salt.isEmpty()) ByteArray(32) else salt
            val extract = Mac.getInstance("HmacSHA256")
            extract.init(SecretKeySpec(effectiveSalt, "HmacSHA256"))
            val pseudoRandomKey = extract.doFinal(inputKeyMaterial)
            val result = ByteArray(length)
            var previous = ByteArray(0)
            var offset = 0
            var counter = 1
            try {
                while (offset < length) {
                    val expand = Mac.getInstance("HmacSHA256")
                    expand.init(SecretKeySpec(pseudoRandomKey, "HmacSHA256"))
                    expand.update(previous)
                    expand.update(info)
                    expand.update(counter.toByte())
                    val block = expand.doFinal()
                    previous.fill(0)
                    previous = block
                    val copied = minOf(block.size, length - offset)
                    block.copyInto(result, offset, 0, copied)
                    offset += copied
                    counter += 1
                }
                return result
            } finally {
                if (salt.isEmpty()) effectiveSalt.fill(0)
                pseudoRandomKey.fill(0)
                previous.fill(0)
            }
        }

        private fun jsonString(value: String): String = Json.encodeToString(JsonPrimitive.serializer(), JsonPrimitive(value))

        private fun validateP256PublicKey(publicKey: PublicKey) {
            val ec = publicKey as? ECPublicKey
                ?: throw MobileCryptoException("MOBILE_PUBLIC_KEY_ALGORITHM_MISMATCH")
            if (ec.params.curve.field.fieldSize != 256 || !contains(publicKey.encoded, PRIME256V1_OID)) {
                throw MobileCryptoException("MOBILE_PUBLIC_KEY_ALGORITHM_MISMATCH")
            }
        }

        private fun contains(haystack: ByteArray, needle: ByteArray): Boolean =
            haystack.indices.any { start ->
                start + needle.size <= haystack.size && needle.indices.all { offset ->
                    haystack[start + offset] == needle[offset]
                }
            }

        private fun isUnpaddedBase64Url(value: String): Boolean =
            value.isNotEmpty() && value.length % 4 != 1 && BASE64_URL_PATTERN.matches(value)

        private fun validateIdentifier(value: String) {
            if (!isSafeIdentifier(value)) {
                throw MobileCryptoException("ENVELOPE_BINDING_INVALID")
            }
        }

        private fun isSafeIdentifier(value: String): Boolean =
            value.trim().isNotEmpty() && value.length <= 256 && value.none { it.isISOControl() }

        private fun sequenceMap(): MutableMap<SequenceKey, Long> = mutableMapOf()

        private fun aesGcmEncrypt(
            key: ByteArray,
            nonce: ByteArray,
            aad: ByteArray,
            plaintext: ByteArray,
        ): CiphertextAndTag {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(TAG_BYTES * 8, nonce))
            cipher.updateAAD(aad)
            val combined = cipher.doFinal(plaintext)
            if (combined.size < TAG_BYTES) throw MobileCryptoException("ENVELOPE_ENCRYPTION_FAILED")
            return CiphertextAndTag(
                ciphertext = combined.copyOfRange(0, combined.size - TAG_BYTES),
                tag = combined.copyOfRange(combined.size - TAG_BYTES, combined.size),
            ).also { combined.fill(0) }
        }

        private fun aesGcmDecrypt(
            key: ByteArray,
            nonce: ByteArray,
            aad: ByteArray,
            ciphertext: ByteArray,
            tag: ByteArray,
        ): ByteArray {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(TAG_BYTES * 8, nonce))
            cipher.updateAAD(aad)
            return cipher.doFinal(ciphertext + tag)
        }
    }
}

private data class SequenceKey(
    val direction: MobileEnvelopeDirection,
    val channel: MobileEnvelopeChannel,
)

private data class CiphertextAndTag(val ciphertext: ByteArray, val tag: ByteArray)

private fun MobileApplicationEnvelope.headerJson(): JsonObject = buildJsonObject {
    put("contractVersion", contractVersion)
    put("amendment", amendment)
    put("protocolVersion", protocolVersion)
    put("aadVersion", aadVersion)
    put("encryption", encryption)
    put("cryptoSuite", cryptoSuite)
    put("sessionId", sessionId)
    put("serverId", serverId)
    put("deviceId", deviceId)
    put("workspaceId", workspaceId)
    put("sequence", sequence)
    put("direction", direction)
    put("channel", channel)
    put("purpose", purpose)
}
