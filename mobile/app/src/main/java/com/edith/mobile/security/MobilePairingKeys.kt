package com.edith.mobile.security

import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.Signature
import java.security.spec.ECGenParameterSpec

/**
 * Production pairing identity backed exclusively by Android Keystore.
 * Signing and ECDH agreement use separate, non-exportable P-256 private keys.
 */
class MobilePairingKeys(
    aliasPrefix: String = "edith.mobile.pairing.v1",
) {
    private val signingAlias = "$aliasPrefix.signing"
    private val agreementAlias = "$aliasPrefix.agreement"
    private val keyStore: KeyStore
        get() = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }

    fun ensureKeys(): PairingPublicKeys {
        requireAgreementSupport()
        val store = keyStore
        if (!store.containsAlias(signingAlias)) generateSigningKey()
        if (!store.containsAlias(agreementAlias)) generateAgreementKey()
        return publicKeys()
    }

    fun publicKeys(): PairingPublicKeys {
        requireAgreementSupport()
        val store = keyStore
        val signing = store.getCertificate(signingAlias)?.publicKey
            ?: throw MobileCryptoException("PAIRING_SIGNING_KEY_CONFIGURATION_REQUIRED")
        val agreement = store.getCertificate(agreementAlias)?.publicKey
            ?: throw MobileCryptoException("PAIRING_AGREEMENT_KEY_CONFIGURATION_REQUIRED")
        return PairingPublicKeys(
            signing = MobileCryptoEngine.publicKeyDescriptor(signing, "ECDSA-P256-SHA256"),
            agreement = MobileCryptoEngine.publicKeyDescriptor(agreement, "ECDH-P256"),
        )
    }

    fun signChallenge(
        transcript: MobilePairingTranscript,
        serverAgreementKey: MobilePublicKeyDescriptor,
    ): String = sign(boundTranscript(transcript, serverAgreementKey))

    fun signChallenge(transcript: String): String =
        sign(boundLocalTranscript(MobileCryptoEngine.parseTranscript(transcript)))

    fun signConsume(
        transcript: MobilePairingTranscript,
        serverAgreementKey: MobilePublicKeyDescriptor,
    ): String = sign(
        MobileCryptoEngine.consumeTranscript(boundTranscript(transcript, serverAgreementKey)),
    )

    fun signConsume(transcript: String): String = sign(
        MobileCryptoEngine.consumeTranscript(
            boundLocalTranscript(MobileCryptoEngine.parseTranscript(transcript)),
        ),
    )

    fun deriveSessionKeys(
        serverAgreementKey: MobilePublicKeyDescriptor,
        transcript: MobilePairingTranscript,
    ): MobileSessionKeys {
        requireAgreementSupport()
        if (
            serverAgreementKey.algorithm != "ECDH-P256" ||
            serverAgreementKey.encoding != "spki_der_base64"
        ) {
            throw MobileCryptoException("MOBILE_PUBLIC_KEY_ALGORITHM_MISMATCH")
        }
        val peer = MobileCryptoEngine.decodeP256PublicKey(serverAgreementKey.value)
        val computedFingerprint = MobileCryptoEngine.sha256Hex(peer.encoded)
        if (!constantTimeEquals(computedFingerprint, serverAgreementKey.fingerprint)) {
            throw MobileCryptoException("MOBILE_PUBLIC_KEY_FINGERPRINT_MISMATCH")
        }
        val canonicalTranscript = boundTranscript(transcript, serverAgreementKey)
        val privateKey = privateKey(agreementAlias, "PAIRING_AGREEMENT_KEY_CONFIGURATION_REQUIRED")
        val shared = MobileCryptoEngine.deriveSharedSecret(privateKey, peer, ANDROID_KEYSTORE)
        val challenge = MobileCryptoEngine.decodeBase64Url(
            transcript.challengeBase64url,
            "PAIRING_CHALLENGE_INVALID",
        )
        return try {
            MobileCryptoEngine.deriveSessionKeys(shared, challenge, canonicalTranscript)
        } finally {
            shared.fill(0)
            challenge.fill(0)
        }
    }

    fun deriveSessionKeys(
        serverAgreementKey: MobilePublicKeyDescriptor,
        challengeBase64url: String,
        transcript: String,
    ): MobileSessionKeys {
        val parsed = MobileCryptoEngine.parseTranscript(transcript)
        if (parsed.challengeBase64url != challengeBase64url) {
            throw MobileCryptoException("PAIRING_PROOF_BINDING_INVALID")
        }
        return deriveSessionKeys(serverAgreementKey, parsed)
    }

    fun delete() {
        val store = keyStore
        if (store.containsAlias(signingAlias)) store.deleteEntry(signingAlias)
        if (store.containsAlias(agreementAlias)) store.deleteEntry(agreementAlias)
    }

    private fun sign(payload: String): String {
        requireAgreementSupport()
        if (!payload.startsWith("edith.mobile.pair.v1\n")) {
            throw MobileCryptoException("PAIRING_TRANSCRIPT_BINDING_INVALID")
        }
        return try {
            val signature = Signature.getInstance("SHA256withECDSA")
            signature.initSign(privateKey(signingAlias, "PAIRING_SIGNING_KEY_CONFIGURATION_REQUIRED"))
            signature.update(payload.toByteArray(Charsets.UTF_8))
            MobileCryptoEngine.base64Url(signature.sign())
        } catch (error: MobileCryptoException) {
            throw error
        } catch (error: Exception) {
            throw MobileCryptoException("PAIRING_PROOF_SIGNING_FAILED", error)
        }
    }

    private fun boundTranscript(
        transcript: MobilePairingTranscript,
        serverAgreementKey: MobilePublicKeyDescriptor,
    ): String {
        if (
            serverAgreementKey.algorithm != "ECDH-P256" ||
            serverAgreementKey.encoding != "spki_der_base64" ||
            !constantTimeEquals(
                transcript.serverAgreementKeyFingerprint,
                serverAgreementKey.fingerprint,
            )
        ) {
            throw MobileCryptoException("PAIRING_PROOF_BINDING_INVALID")
        }
        boundLocalTranscript(transcript)
        return MobileCryptoEngine.transcript(transcript)
    }

    private fun boundLocalTranscript(transcript: MobilePairingTranscript): String {
        val local = publicKeys()
        if (
            !constantTimeEquals(transcript.signingKeyFingerprint, local.signing.fingerprint) ||
            !constantTimeEquals(transcript.agreementKeyFingerprint, local.agreement.fingerprint)
        ) {
            throw MobileCryptoException("PAIRING_PROOF_BINDING_INVALID")
        }
        return MobileCryptoEngine.transcript(transcript)
    }

    private fun privateKey(alias: String, errorCode: String): PrivateKey =
        keyStore.getKey(alias, null) as? PrivateKey ?: throw MobileCryptoException(errorCode)

    private fun generateSigningKey() {
        try {
            KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, ANDROID_KEYSTORE).run {
                initialize(
                    KeyGenParameterSpec.Builder(signingAlias, KeyProperties.PURPOSE_SIGN)
                        .setAlgorithmParameterSpec(ECGenParameterSpec(P256_CURVE))
                        .setDigests(KeyProperties.DIGEST_SHA256)
                        .setUserAuthenticationRequired(false)
                        .build(),
                )
                generateKeyPair()
            }
        } catch (error: Exception) {
            throw MobileCryptoException("PAIRING_SIGNING_KEY_CONFIGURATION_REQUIRED", error)
        }
    }

    private fun generateAgreementKey() {
        try {
            KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, ANDROID_KEYSTORE).run {
                initialize(
                    KeyGenParameterSpec.Builder(agreementAlias, KeyProperties.PURPOSE_AGREE_KEY)
                        .setAlgorithmParameterSpec(ECGenParameterSpec(P256_CURVE))
                        .setUserAuthenticationRequired(false)
                        .build(),
                )
                generateKeyPair()
            }
        } catch (error: Exception) {
            throw MobileCryptoException("PAIRING_AGREEMENT_KEY_CONFIGURATION_REQUIRED", error)
        }
    }

    private fun requireAgreementSupport() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            throw MobileCryptoException("PAIRING_AGREEMENT_KEY_CONFIGURATION_REQUIRED")
        }
    }

    private fun constantTimeEquals(left: String, right: String): Boolean {
        val leftBytes = left.toByteArray(Charsets.US_ASCII)
        val rightBytes = right.toByteArray(Charsets.US_ASCII)
        return leftBytes.size == rightBytes.size &&
            java.security.MessageDigest.isEqual(leftBytes, rightBytes)
    }

    companion object {
        private const val ANDROID_KEYSTORE = "AndroidKeyStore"
        private const val P256_CURVE = "secp256r1"
    }
}

data class PairingPublicKeys(
    val signing: MobilePublicKeyDescriptor,
    val agreement: MobilePublicKeyDescriptor,
)
