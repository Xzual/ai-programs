package com.edith.mobile.contracts

import java.security.MessageDigest
import java.time.Instant
import java.util.Base64
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonPrimitive

const val EDITH_MOBILE_PROTOCOL = "edith.mobile/1"
const val EDITH_P256_SUITE = "P256_ECDSA_SHA256_P256_ECDH_HKDF_SHA256_AES256_GCM"
const val EDITH_AAD_VERSION = "edith-mobile-aad-v1"

val MOBILE_COMMAND_ALLOWLIST = setOf(
    "task.list", "task.detail", "task.activity", "task.create_low_risk", "task.pause",
    "task.resume", "task.cancel", "emergency_stop", "file.upload", "clipboard.publish", "clipboard.consume",
    "offline_queue.manage", "handoff.manage", "result_card.read", "audio_handoff.manage",
)

@Serializable
data class MobilePublicKeyWire(
    val contractVersion: Int,
    val amendment: String,
    val algorithm: String,
    val encoding: String,
    val value: JsonElement,
    val fingerprint: String,
)

@Serializable
data class MobileCryptoNegotiationWire(
    val contractVersion: Int,
    val amendment: String,
    val protocolVersion: String,
    val offeredSuites: List<String>,
    val selectedSuite: String? = null,
    val status: String,
    val reasonCode: String? = null,
)

@Serializable
data class MobileServerCapabilitiesWire(
    val realtime: Boolean,
    val encryptedEnvelope: Boolean,
    val resumableFileTransfer: Boolean,
    val remoteTaskControl: String,
    val remoteView: String,
    val wakeOnLan: String,
    val pushNotifications: String,
    val destructiveDeviceControl: String,
    val tlsRequiredForRemoteTransport: Boolean,
)

@Serializable
data class MobileServerIdentityWire(
    val contractVersion: Int,
    val amendment: String,
    val protocolVersion: String,
    val serverId: String,
    val workspaceId: String,
    val supportedSuites: List<String>,
    val capabilities: MobileServerCapabilitiesWire,
)

@Serializable
data class MobilePairingRequestWire(
    val contractVersion: Int = EDITH_VERSION,
    val amendment: String = EDITH_AMENDMENT,
    val protocolVersion: String = EDITH_MOBILE_PROTOCOL,
    val device: DeviceIdentity,
    val supportedSuites: List<String> = listOf(EDITH_P256_SUITE),
    val signingKey: MobilePublicKeyWire,
    val agreementKey: MobilePublicKeyWire,
    val requestedCommands: List<String>,
)

@Serializable
data class MobilePairingOfferWire(
    val contractVersion: Int,
    val amendment: String,
    val protocolVersion: String,
    val pairing: PairingSession,
    val server: MobileServerIdentityWire,
    val negotiation: MobileCryptoNegotiationWire,
    val challengeBase64url: String,
    val serverAgreementKey: MobilePublicKeyWire,
    val signingKeyFingerprint: String,
    val agreementKeyFingerprint: String,
    val requestedCommandsFingerprint: String,
    val transcriptBase64url: String,
    val transcriptFingerprint: String,
    val ownerVerificationCode: String,
    val expiresAt: String,
)

@Serializable data class PairingRequestResponse(val success: Boolean, val data: PairingRequestData? = null, val errorCode: String? = null)
@Serializable data class PairingRequestData(val offer: MobilePairingOfferWire)

@Serializable
data class MobilePairingProofWire(
    val contractVersion: Int = EDITH_VERSION,
    val amendment: String = EDITH_AMENDMENT,
    val protocolVersion: String = EDITH_MOBILE_PROTOCOL,
    val pairingId: String,
    val assertionType: String,
    val assertionBase64url: String,
    val payloadFingerprint: String,
    val submittedAt: String,
)

@Serializable data class PairingProofResponse(val success: Boolean, val data: PairingProofData? = null, val errorCode: String? = null)
@Serializable data class PairingProofData(val pairing: PairingSession)

@Serializable
data class PairingStatusResponse(val success: Boolean, val data: PairingStatusData? = null, val errorCode: String? = null)

@Serializable
data class PairingStatusData(
    val pairingId: String,
    val device: DeviceIdentity,
    val challenge: PairingChallenge,
    val ownerApproved: Boolean,
    val ownerRejected: Boolean,
    val requestedCommands: List<String>,
    val approvedCommands: List<String>,
    val createdAt: String,
    val expiresAt: String,
)

@Serializable
data class MobileCredentialMetadataWire(
    val contractVersion: Int,
    val amendment: String,
    val credentialId: String,
    val credentialFingerprint: String,
    val deviceId: String,
    val sessionId: String,
    val workspaceId: String,
    val issuedAt: String,
    val expiresAt: String,
    val rotatedFromId: String? = null,
    val revokedAt: String? = null,
)

@Serializable
data class MobileDeviceSessionWire(
    val contractVersion: Int,
    val amendment: String,
    val protocolVersion: String,
    val sessionId: String,
    val serverId: String,
    val deviceId: String,
    val workspaceId: String,
    val cryptoSuite: String,
    val keyFingerprint: String,
    val status: String,
    val establishedAt: String,
    val expiresAt: String,
    val errorCode: String? = null,
)

@Serializable
data class MobileApplicationEnvelopeWire(
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

@Serializable
data class MobilePairingConsumeResultWire(
    val contractVersion: Int,
    val amendment: String,
    val pairing: PairingSession,
    val session: MobileDeviceSessionWire,
    val credentialEnvelope: MobileApplicationEnvelopeWire,
)

@Serializable data class PairingConsumeResponse(val success: Boolean, val data: MobilePairingConsumeResultWire? = null, val errorCode: String? = null)

@Serializable
data class MobileCredentialSecretWire(
    val token: String,
    val secret: String,
    val credentialId: String,
    val deviceId: String,
    val sessionId: String,
    val workspaceId: String,
    val expiresAt: String,
)

@Serializable data class CredentialEnvelopePayload(val credential: MobileCredentialSecretWire)

@Serializable
data class MobileRemoteCommandWire(
    val contractVersion: Int = EDITH_VERSION,
    val amendment: String = EDITH_AMENDMENT,
    val commandId: String,
    val command: String,
    val deviceId: String,
    val workspaceId: String,
    val sessionId: String,
    val sequence: Long,
    val idempotencyKey: String,
    val riskLevel: Int,
    val issuedAt: String,
    val expiresAt: String,
    val payload: JsonObject? = null,
)

@Serializable
data class MobileRemoteCommandResultWire(
    val contractVersion: Int,
    val amendment: String,
    val commandId: String,
    val deviceId: String,
    val workspaceId: String,
    val sessionId: String,
    val status: String,
    val completedAt: String,
    val errorCode: String? = null,
    val result: JsonObject? = null,
)

@Serializable
data class EncryptedFileChunkWire(
    val contractVersion: Int = EDITH_VERSION,
    val amendment: String = EDITH_AMENDMENT,
    val transferId: String,
    val deviceId: String,
    val sessionId: String,
    val index: Int,
    val plaintextSizeBytes: Long,
    val plaintextSha256: String,
    val encryption: String = "application_envelope_aes_256_gcm",
    val aadPurpose: String,
)

class MobileWireParser(
    private val json: Json = Json { ignoreUnknownKeys = true; explicitNulls = false },
) {
    fun pairingOffer(raw: String): ParseResult<MobilePairingOfferWire> = decode(raw) { offer ->
        val challenge = offer.pairing.challenge
        val expected = challenge?.let {
            listOf(
                "edith.mobile.pair.v1", offer.server.serverId, offer.server.workspaceId, offer.pairing.pairingId,
                it.challengeId, offer.pairing.device.deviceId, EDITH_P256_SUITE, offer.signingKeyFingerprint,
                offer.agreementKeyFingerprint, offer.serverAgreementKey.fingerprint, offer.requestedCommandsFingerprint,
                offer.pairing.expiresAt, offer.challengeBase64url,
            ).joinToString("\n")
        }
        when {
            !isV21(offer.contractVersion, offer.amendment) || offer.protocolVersion != EDITH_MOBILE_PROTOCOL -> invalid("MOBILE_PAIRING_OFFER_VERSION_INVALID")
            offer.negotiation.status != "selected" || offer.negotiation.selectedSuite != EDITH_P256_SUITE -> invalid("MOBILE_CRYPTO_SUITE_UNSUPPORTED")
            EDITH_P256_SUITE !in offer.server.supportedSuites || !validServerCapabilities(offer.server.capabilities) -> invalid("MOBILE_SERVER_CAPABILITIES_INVALID")
            !validPublicKey(offer.serverAgreementKey, "ECDH-P256") -> invalid("PAIRING_PUBLIC_KEY_INVALID")
            !sha256(offer.signingKeyFingerprint) || !sha256(offer.agreementKeyFingerprint) || !sha256(offer.requestedCommandsFingerprint) -> invalid("MOBILE_PAIRING_OFFER_FINGERPRINT_INVALID")
            offer.pairing.device.platform != "android" || challenge?.pairingId != offer.pairing.pairingId
                || challenge.deviceId != offer.pairing.device.deviceId || challenge.workspaceId != offer.server.workspaceId
                || challenge.algorithm != "ECDSA-P256-SHA256" || challenge.cryptoSuite != EDITH_P256_SUITE
                || decodeBase64Url(offer.challengeBase64url)?.let(::sha256Hex) != challenge.challengeFingerprint -> invalid("MOBILE_PAIRING_OFFER_IDENTITY_INVALID")
            offer.pairing.device.fingerprint != offer.signingKeyFingerprint || challenge?.requestedCommandsFingerprint != offer.requestedCommandsFingerprint -> invalid("MOBILE_PAIRING_TRANSCRIPT_BINDING_INVALID")
            expected == null || decodeBase64UrlText(offer.transcriptBase64url) != expected || sha256Hex(expected.encodeToByteArray()) != offer.transcriptFingerprint -> invalid("MOBILE_PAIRING_TRANSCRIPT_BINDING_INVALID")
            !offer.ownerVerificationCode.matches(Regex("^\\d{6}$")) || offer.expiresAt != offer.pairing.expiresAt || !futureIso(offer.expiresAt) -> invalid("MOBILE_PAIRING_OFFER_EXPIRY_INVALID")
            else -> ParseResult.Valid(offer)
        }
    }

    fun consume(raw: String): ParseResult<MobilePairingConsumeResultWire> = decode(raw) { result ->
        val session = result.session
        val envelope = result.credentialEnvelope
        val pairing = result.pairing
        val trust = pairing.trust
        val binding = pairing.ownerBinding
        val challenge = pairing.challenge
        when {
            !isV21(result.contractVersion, result.amendment) || !validSession(session) -> invalid("MOBILE_PAIRING_CONSUME_RESULT_INVALID")
            pairing.status != PairingStatus.APPROVED || trust?.status != TrustStatus.TRUSTED || binding?.status != "active"
                || challenge?.status != "consumed" || challenge.consumedAt == null -> invalid("MOBILE_PAIRING_CONSUME_TRUST_INVALID")
            pairing.device.deviceId != session.deviceId || trust.deviceId != session.deviceId || binding.deviceId != session.deviceId
                || trust.workspaceId != session.workspaceId || binding.workspaceId != session.workspaceId
                || pairing.device.fingerprint != trust.fingerprint || pairing.device.fingerprint != binding.deviceFingerprint
                || !futureIso(session.expiresAt) || !futureIso(trust.expiresAt ?: "") || !futureIso(binding.expiresAt) -> invalid("MOBILE_PAIRING_CONSUME_BINDING_INVALID")
            !validEnvelope(envelope) || envelope.sessionId != session.sessionId || envelope.serverId != session.serverId
                || envelope.deviceId != session.deviceId || envelope.workspaceId != session.workspaceId
                || envelope.cryptoSuite != session.cryptoSuite || envelope.direction != "server_to_client"
                || envelope.channel != "http" || envelope.purpose != "pairing.credential" -> invalid("MOBILE_PAIRING_CONSUME_BINDING_INVALID")
            else -> ParseResult.Valid(result)
        }
    }

    fun commandResult(raw: String, command: MobileRemoteCommandWire): ParseResult<MobileRemoteCommandResultWire> = decode(raw) { result ->
        when {
            !isV21(result.contractVersion, result.amendment) || result.status !in setOf("completed", "rejected", "failed") || !iso(result.completedAt) -> invalid("MOBILE_REMOTE_COMMAND_RESULT_INVALID")
            result.commandId != command.commandId || result.deviceId != command.deviceId || result.workspaceId != command.workspaceId || result.sessionId != command.sessionId -> invalid("MOBILE_REMOTE_COMMAND_RESULT_BINDING_INVALID")
            result.status != "completed" && result.errorCode.isNullOrBlank() -> invalid("MOBILE_REMOTE_COMMAND_RESULT_ERROR_REQUIRED")
            else -> ParseResult.Valid(result)
        }
    }

    fun validateCommand(command: MobileRemoteCommandWire, session: MobileDeviceSessionWire): ParseResult<MobileRemoteCommandWire> = when {
        command.command !in MOBILE_COMMAND_ALLOWLIST || command.riskLevel !in 0..1 || command.sequence < 1 -> invalid("MOBILE_REMOTE_COMMAND_INVALID")
        command.deviceId != session.deviceId || command.workspaceId != session.workspaceId || command.sessionId != session.sessionId -> invalid("MOBILE_REMOTE_COMMAND_BINDING_INVALID")
        !iso(command.issuedAt) || !futureIso(command.expiresAt) || Instant.parse(command.expiresAt) <= Instant.parse(command.issuedAt) -> invalid("MOBILE_REMOTE_COMMAND_EXPIRED")
        else -> ParseResult.Valid(command)
    }

    fun validateChunk(chunk: EncryptedFileChunkWire, transferId: String, index: Int, session: MobileDeviceSessionWire): ParseResult<EncryptedFileChunkWire> = when {
        !isV21(chunk.contractVersion, chunk.amendment) || chunk.index < 0 || chunk.plaintextSizeBytes < 1 || !sha256(chunk.plaintextSha256) -> invalid("ENCRYPTED_FILE_CHUNK_INVALID")
        chunk.transferId != transferId || chunk.index != index || chunk.deviceId != session.deviceId || chunk.sessionId != session.sessionId -> invalid("MOBILE_REMOTE_COMMAND_BINDING_INVALID")
        chunk.encryption != "application_envelope_aes_256_gcm" || chunk.aadPurpose != "file.transfer.chunk:$transferId:$index" -> invalid("ENCRYPTED_FILE_CHUNK_INVALID")
        else -> ParseResult.Valid(chunk)
    }

    fun validEnvelope(value: MobileApplicationEnvelopeWire): Boolean =
        isV21(value.contractVersion, value.amendment) && value.protocolVersion == EDITH_MOBILE_PROTOCOL
            && value.aadVersion == EDITH_AAD_VERSION && value.encryption == "AES-256-GCM"
            && value.cryptoSuite == EDITH_P256_SUITE && value.sequence >= 1
            && value.direction in setOf("client_to_server", "server_to_client")
            && value.channel in setOf("http", "realtime", "transfer")
            && listOf(value.sessionId, value.serverId, value.deviceId, value.workspaceId, value.purpose).all(String::isNotBlank)
            && decodeBase64Url(value.nonceBase64url)?.size == 12 && decodeBase64Url(value.authTagBase64url)?.size == 16
            && decodeBase64Url(value.ciphertextBase64url) != null

    private fun validSession(value: MobileDeviceSessionWire): Boolean =
        isV21(value.contractVersion, value.amendment) && value.protocolVersion == EDITH_MOBILE_PROTOCOL
            && value.cryptoSuite == EDITH_P256_SUITE && value.status == "active" && sha256(value.keyFingerprint)
            && listOf(value.sessionId, value.serverId, value.deviceId, value.workspaceId).all(String::isNotBlank)
            && iso(value.establishedAt) && futureIso(value.expiresAt) && Instant.parse(value.expiresAt) > Instant.parse(value.establishedAt)

    private fun validServerCapabilities(value: MobileServerCapabilitiesWire) =
        value.realtime && value.encryptedEnvelope && value.resumableFileTransfer
            && value.remoteTaskControl == "low_risk_allowlist" && value.remoteView == "disabled"
            && value.wakeOnLan == "configuration_required" && value.pushNotifications == "configuration_required"
            && value.destructiveDeviceControl == "disabled" && value.tlsRequiredForRemoteTransport

    private fun validPublicKey(value: MobilePublicKeyWire, algorithm: String): Boolean {
        if (!isV21(value.contractVersion, value.amendment) || value.algorithm != algorithm || value.encoding != "spki_der_base64" || !sha256(value.fingerprint)) return false
        val der = runCatching { Base64.getDecoder().decode(value.value.jsonPrimitive.content) }.getOrNull() ?: return false
        return sha256Hex(der) == value.fingerprint
    }

    private inline fun <reified T> decode(raw: String, validate: (T) -> ParseResult<T>): ParseResult<T> = try {
        validate(json.decodeFromString(raw))
    } catch (_: SerializationException) {
        invalid("MALFORMED_MOBILE_WIRE_CONTRACT")
    } catch (_: IllegalArgumentException) {
        invalid("MALFORMED_MOBILE_WIRE_CONTRACT")
    }

    private fun isV21(version: Int, amendment: String) = version == EDITH_VERSION && amendment == EDITH_AMENDMENT
    private fun iso(value: String) = runCatching { Instant.parse(value) }.isSuccess
    private fun futureIso(value: String) = runCatching { Instant.parse(value) > Instant.now() }.getOrDefault(false)
    private fun sha256(value: String) = value.matches(Regex("^[a-f0-9]{64}$"))
    private fun invalid(code: String) = ParseResult.Invalid(code, "Canonical mobile wire validation failed.")
}

fun sha256Hex(value: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(value).joinToString("") { "%02x".format(it) }
fun encodeBase64Url(value: ByteArray): String = Base64.getUrlEncoder().withoutPadding().encodeToString(value)
fun decodeBase64Url(value: String): ByteArray? = runCatching { Base64.getUrlDecoder().decode(value) }.getOrNull()
fun decodeBase64UrlText(value: String): String? = decodeBase64Url(value)?.decodeToString()
fun spkiPublicKey(algorithm: String, der: ByteArray) = MobilePublicKeyWire(
    contractVersion = EDITH_VERSION,
    amendment = EDITH_AMENDMENT,
    algorithm = algorithm,
    encoding = "spki_der_base64",
    value = JsonPrimitive(Base64.getEncoder().encodeToString(der)),
    fingerprint = sha256Hex(der),
)
