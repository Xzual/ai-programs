package com.edith.mobile.network

import com.edith.mobile.contracts.EDITH_P256_SUITE
import com.edith.mobile.contracts.EncryptedFileChunkWire
import com.edith.mobile.contracts.MOBILE_COMMAND_ALLOWLIST
import com.edith.mobile.contracts.MobileDeviceSessionWire
import com.edith.mobile.contracts.MobileRemoteCommandResultWire
import com.edith.mobile.contracts.MobileRemoteCommandWire
import com.edith.mobile.contracts.MobileWireParser
import com.edith.mobile.contracts.ParseResult
import com.edith.mobile.contracts.sha256Hex
import com.edith.mobile.domain.CommandAuthorization
import com.edith.mobile.domain.VerifiedDeliveryReceipt
import java.time.Instant
import java.util.UUID
import kotlinx.serialization.json.JsonObject

data class CommandConfirmation(val ownerConfirmed: Boolean, val confirmedAt: Instant)

data class TrustedMobileTransportContext(
    val session: MobileDeviceSessionWire,
    val trusted: Boolean,
    val trustExpiresAt: String,
    val ownerBindingId: String,
    val ownerBindingActive: Boolean,
    val ownerBindingExpiresAt: String,
    val allowedCommands: Set<String>,
    val endpointDecision: EndpointDecision,
) {
    fun transportAuthorized(now: Instant = Instant.now()): Boolean {
        val sessionValid = session.status == "active" && session.cryptoSuite == EDITH_P256_SUITE
            && runCatching { Instant.parse(session.expiresAt) > now }.getOrDefault(false)
        val trustValid = trusted && runCatching { Instant.parse(trustExpiresAt) > now }.getOrDefault(false)
        val bindingValid = ownerBindingActive && ownerBindingId.isNotBlank()
            && runCatching { Instant.parse(ownerBindingExpiresAt) > now }.getOrDefault(false)
        return sessionValid && trustValid && bindingValid && endpointDecision is EndpointDecision.Allowed
    }

    fun authorization(command: String, now: Instant = Instant.now()): CommandAuthorization {
        return CommandAuthorization(
            trustedDevice = transportAuthorized(now),
            ownerBindingActive = transportAuthorized(now),
            capabilityAdvertised = command in allowedCommands && command in MOBILE_COMMAND_ALLOWLIST && endpointDecision is EndpointDecision.Allowed,
            ownerBindingId = ownerBindingId,
        )
    }
}

class MobileCommandAdapter(
    private val parser: MobileWireParser = MobileWireParser(),
) {
    private var commandSequence = 0L

    @Synchronized
    fun create(
        context: TrustedMobileTransportContext,
        command: String,
        riskLevel: Int,
        payload: JsonObject? = null,
        now: Instant = Instant.now(),
        ttlSeconds: Long = 60,
        confirmation: CommandConfirmation? = null,
    ): ParseResult<MobileRemoteCommandWire> {
        val authorization = context.authorization(command, now)
        if (!authorization.trustedDevice) return invalid("TRUSTED_DEVICE_REQUIRED")
        if (!authorization.ownerBindingActive) return invalid("OWNER_BINDING_REQUIRED")
        if (!authorization.capabilityAdvertised) return invalid("MOBILE_COMMAND_NOT_ALLOWED")
        if (command in CONFIRMATION_REQUIRED && !validConfirmation(confirmation, now)) return invalid("OWNER_CONFIRMATION_REQUIRED")
        val commandId = "mobile-command-${UUID.randomUUID()}"
        val wire = MobileRemoteCommandWire(
            commandId = commandId,
            command = command,
            deviceId = context.session.deviceId,
            workspaceId = context.session.workspaceId,
            sessionId = context.session.sessionId,
            sequence = ++commandSequence,
            idempotencyKey = "mobile-idempotency-${UUID.randomUUID()}",
            riskLevel = riskLevel,
            issuedAt = now.toString(),
            expiresAt = now.plusSeconds(ttlSeconds.coerceIn(1, 300)).toString(),
            payload = payload,
        )
        return parser.validateCommand(wire, context.session)
    }

    fun verifiedReceipt(
        context: TrustedMobileTransportContext,
        command: MobileRemoteCommandWire,
        result: MobileRemoteCommandResultWire,
    ): ParseResult<VerifiedDeliveryReceipt> {
        val parsed = parser.commandResult(kotlinx.serialization.json.Json.encodeToString(MobileRemoteCommandResultWire.serializer(), result), command)
        if (parsed is ParseResult.Invalid) return parsed
        val authorization = context.authorization(command.command)
        if (!authorization.trustedDevice || !authorization.ownerBindingActive || !authorization.capabilityAdvertised) return invalid("COMMAND_AUTHORIZATION_STALE")
        if (result.status != "completed") return invalid(result.errorCode ?: "MOBILE_COMMAND_NOT_COMPLETED")
        return ParseResult.Valid(
            VerifiedDeliveryReceipt(
                receiptId = "${result.commandId}:${result.completedAt}",
                commandId = result.commandId,
                targetDeviceId = result.deviceId,
                ownerBindingId = context.ownerBindingId,
                deliveredAt = result.completedAt,
            ),
        )
    }

    fun draftForOffline(
        context: TrustedMobileTransportContext,
        command: String,
        riskLevel: Int,
        payload: JsonObject? = null,
        now: Instant = Instant.now(),
        ttlSeconds: Long = 300,
        confirmation: CommandConfirmation? = null,
    ): ParseResult<MobileRemoteCommandWire> {
        if (command == "emergency_stop") return invalid("EMERGENCY_STOP_QUEUE_FORBIDDEN")
        val authorization = context.authorization(command, now)
        if (!authorization.trustedDevice) return invalid("TRUSTED_DEVICE_REQUIRED")
        if (!authorization.ownerBindingActive) return invalid("OWNER_BINDING_REQUIRED")
        if (!authorization.capabilityAdvertised) return invalid("MOBILE_COMMAND_NOT_ALLOWED")
        if (command in CONFIRMATION_REQUIRED && !validConfirmation(confirmation, now)) return invalid("OWNER_CONFIRMATION_REQUIRED")
        return parser.validateCommand(
            MobileRemoteCommandWire(
                commandId = "mobile-command-${UUID.randomUUID()}",
                command = command,
                deviceId = context.session.deviceId,
                workspaceId = context.session.workspaceId,
                sessionId = context.session.sessionId,
                sequence = 1,
                idempotencyKey = "mobile-idempotency-${UUID.randomUUID()}",
                riskLevel = riskLevel,
                issuedAt = now.toString(),
                expiresAt = now.plusSeconds(ttlSeconds.coerceIn(1, 1_800)).toString(),
                payload = payload,
            ),
            context.session,
        )
    }

    fun chunkMetadata(
        context: TrustedMobileTransportContext,
        transferId: String,
        index: Int,
        plaintext: ByteArray,
        confirmation: CommandConfirmation? = null,
        now: Instant = Instant.now(),
    ): ParseResult<EncryptedFileChunkWire> {
        if (!context.transportAuthorized()) return invalid("TRUSTED_DEVICE_REQUIRED")
        if ("file.upload" !in context.allowedCommands) return invalid("MOBILE_COMMAND_NOT_ALLOWED")
        if (!validConfirmation(confirmation, now)) return invalid("OWNER_CONFIRMATION_REQUIRED")
        val purpose = "file.transfer.chunk:$transferId:$index"
        val chunk = EncryptedFileChunkWire(
            transferId = transferId,
            deviceId = context.session.deviceId,
            sessionId = context.session.sessionId,
            index = index,
            plaintextSizeBytes = plaintext.size.toLong(),
            plaintextSha256 = sha256Hex(plaintext),
            aadPurpose = purpose,
        )
        return parser.validateChunk(chunk, transferId, index, context.session)
    }

    private fun invalid(code: String) = ParseResult.Invalid(code, "Mobile command adapter rejected the operation.")

    private fun validConfirmation(value: CommandConfirmation?, now: Instant): Boolean = value?.ownerConfirmed == true
        && !value.confirmedAt.isAfter(now) && value.confirmedAt.plusSeconds(CONFIRMATION_TTL_SECONDS).isAfter(now)

    private companion object {
        val CONFIRMATION_REQUIRED = setOf(
            "task.create_low_risk", "task.pause", "task.resume", "task.cancel", "emergency_stop", "file.upload",
            "clipboard.publish", "clipboard.consume", "offline_queue.manage", "handoff.manage", "audio_handoff.manage",
        )
        const val CONFIRMATION_TTL_SECONDS = 120L
    }
}
