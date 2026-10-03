package com.edith.mobile.contracts

import java.time.Instant
import kotlinx.serialization.SerializationException
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

sealed interface ParseResult<out T> {
    data class Valid<T>(val value: T) : ParseResult<T>
    data class Invalid(val code: String, val safeMessage: String) : ParseResult<Nothing>
}

class CanonicalContractParser(
    private val json: Json = Json { ignoreUnknownKeys = true; explicitNulls = false },
    now: () -> Instant = Instant::now,
) {
    private val crossDeviceParser = CrossDeviceParser(Json { ignoreUnknownKeys = false; explicitNulls = false }, now)
    private val forbiddenKeys = setOf(
        "secret", "token", "accesstoken", "refreshtoken", "sessiontoken", "apikey", "password",
        "privatekey", "plaintextkey", "encryptionkey", "rawkey", "keymaterial", "rawproof",
        "proof", "signature", "credentialsecret", "__proto__", "prototype", "constructor",
    )
    private val knownEvents = setOf(
        "task.event.v2", "task.progress.v2", "task.created.v2", "task.status_changed.v2",
        "task.step_updated.v2", "task.tool_started.v2", "task.tool_completed.v2",
        "task.verification_completed.v2", "task.recovery_started.v2", "task.completed.v2",
        "task.failed.v2", "task.cancelled.v2", "pairing.status.v2", "device.status.v2",
        "file_transfer.status.v2", "emergency_stop.activated.v2", "capsule.updated.v2", "mission.updated.v2",
        *CrossDeviceWire.events.toTypedArray(),
    )

    fun parseRealtime(raw: String): ParseResult<RealtimeEnvelope> = parse(raw) { envelope ->
        if (envelope.schema != EDITH_SCHEMA || envelope.version != EDITH_VERSION) invalid("CONTRACT_VERSION_UNSUPPORTED")
        else if (envelope.event !in knownEvents) invalid("REALTIME_EVENT_UNSUPPORTED")
        else if (envelope.streamId.isBlank() || envelope.correlationId.isBlank() || envelope.eventId.isBlank()) invalid("REALTIME_IDENTITY_INVALID")
        else if (envelope.cursor < 1 || envelope.sequence < 1 || !isIso(envelope.occurredAt)) invalid("REALTIME_ORDER_INVALID")
        else if (envelope.causationId == envelope.eventId) invalid("REALTIME_CAUSATION_INVALID")
        else if (envelope.replayed && envelope.replay == null) invalid("REALTIME_REPLAY_METADATA_REQUIRED")
        else if (!envelope.replayed && envelope.replay != null) invalid("REALTIME_REPLAY_METADATA_UNEXPECTED")
        else if (envelope.replayed && envelope.replay?.let {
            it.windowStartCursor < 1 || it.windowStartCursor > it.windowEndCursor
                || envelope.cursor !in it.windowStartCursor..it.windowEndCursor
        } == true) invalid("REALTIME_REPLAY_WINDOW_INVALID")
        else realtimePayloadError(envelope.event, envelope.payload)?.let(::invalid) ?: ParseResult.Valid(envelope)
    }

    fun parseTaskList(raw: String): ParseResult<List<MobileTask>> {
        val result = parse<TaskListEnvelope>(raw) { envelope ->
        if (envelope.contract.schema != EDITH_SCHEMA || envelope.contract.version != EDITH_VERSION) invalid("TASK_ENVELOPE_INVALID")
        else if (envelope.data.tasks.any { task ->
            task.contractVersion != 2 || task.id.isBlank() || task.title.isBlank() || task.revision < 1 || task.eventSequence < 0
                || task.priority !in setOf("low", "normal", "high", "urgent")
                || task.progress.taskId != task.id || task.progress.revision != task.revision || task.progress.status != task.status
                || task.progress.percent !in 0..100 || task.progress.completedSteps < 0 || task.progress.totalSteps < 0
                || task.progress.sources.any { it !in setOf("task_status", "plan_steps", "verification", "recovery") }
                || task.progress.terminal != (task.status in setOf(TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELLED, TaskStatus.ROLLED_BACK))
        }) invalid("TASK_RECORD_INVALID")
        else ParseResult.Valid(envelope)
        }
        return when (result) {
            is ParseResult.Valid -> ParseResult.Valid(result.value.data.tasks)
            is ParseResult.Invalid -> result
        }
    }

    fun parsePairing(raw: String): ParseResult<PairingSession> = parse(raw) { session ->
        val challenge = session.challenge
        if (session.pairingId.isBlank() || session.device.deviceId.isBlank() || session.device.platform != "android") invalid("PAIRING_IDENTITY_INVALID")
        else if (!isIso(session.createdAt) || !isIso(session.expiresAt) || Instant.parse(session.expiresAt) <= Instant.parse(session.createdAt)) invalid("PAIRING_EXPIRY_INVALID")
        else if (challenge != null && (
            challenge.contractVersion != 2 || challenge.amendment != EDITH_AMENDMENT || !challenge.oneTime
                || challenge.pairingId != session.pairingId || challenge.deviceId != session.device.deviceId
                || challenge.algorithm !in setOf("SHA-256", "HMAC-SHA-256", "Ed25519", "ECDSA-P256-SHA256")
                || !isSha256(challenge.challengeFingerprint) || !isIso(challenge.issuedAt) || !isIso(challenge.expiresAt)
                || challenge.consumedAt?.let(::isIso) == false
        )) invalid("PAIRING_CHALLENGE_INVALID")
        else if (session.trust?.let { !validTrust(it) || it.deviceId != session.device.deviceId || it.fingerprint != session.device.fingerprint } == true) invalid("PAIRING_TRUST_INVALID")
        else if (session.ownerBinding?.let { !validOwnerBinding(it) || it.deviceId != session.device.deviceId || it.deviceFingerprint != session.device.fingerprint } == true) invalid("PAIRING_OWNER_BINDING_INVALID")
        else ParseResult.Valid(session)
    }

    fun parseDeviceTrust(raw: String): ParseResult<DeviceTrust> = parse(raw) { trust ->
        if (validTrust(trust)) ParseResult.Valid(trust) else invalid("DEVICE_TRUST_INVALID")
    }

    fun parseTransfer(raw: String): ParseResult<FileTransferDescriptor> = parse(raw) { transfer ->
        val resume = transfer.resume
        val encryption = transfer.encryption
        val manifest = transfer.chunkManifest
        val destination = transfer.destination
        if (transfer.transferId.isBlank() || !isSafeFileName(transfer.fileName) || transfer.sizeBytes < 0 || !isSha256(transfer.sha256)) invalid("TRANSFER_IDENTITY_INVALID")
        else if (transfer.direction !in setOf("upload", "download") || transfer.status !in setOf("pending", "transferring", "completed", "failed", "cancelled")) invalid("TRANSFER_STATE_INVALID")
        else if (encryption != null && (encryption.contractVersion != 2 || encryption.amendment != EDITH_AMENDMENT || !encryption.authenticated || !isSha256(encryption.keyFingerprint))) invalid("TRANSFER_ENCRYPTION_INVALID")
        else if (manifest != null && !validManifest(transfer, manifest)) invalid("TRANSFER_MANIFEST_INVALID")
        else if (resume != null && (
            resume.contractVersion != 2 || resume.amendment != EDITH_AMENDMENT || resume.nextChunkIndex < 0
                || resume.retryCount < 0 || resume.maxRetries < resume.retryCount
                || resume.completedChunkIndexes != resume.completedChunkIndexes.sorted().distinct()
                || resume.acknowledgedBytes?.let { it !in 0..transfer.sizeBytes } == true
                || resume.nextChunkIndex in resume.completedChunkIndexes
                || manifest?.let { row ->
                    resume.nextChunkIndex > row.totalChunks || resume.completedChunkIndexes.any { it !in 0 until row.totalChunks }
                } == true
        )) invalid("TRANSFER_RESUME_INVALID")
        else if (destination != null && !validDestination(destination)) invalid("TRANSFER_DESTINATION_INVALID")
        else ParseResult.Valid(transfer)
    }

    private inline fun <reified T> parse(raw: String, validate: (T) -> ParseResult<T>): ParseResult<T> {
        return try {
            val element = json.parseToJsonElement(raw)
            val unsafe = findForbidden(element)
            if (unsafe != null) invalid("FORBIDDEN_CONTRACT_FIELD") else validate(json.decodeFromString<T>(raw))
        } catch (_: SerializationException) {
            invalid("MALFORMED_CONTRACT")
        } catch (_: IllegalArgumentException) {
            invalid("MALFORMED_CONTRACT")
        }
    }

    private fun findForbidden(value: JsonElement): String? = when (value) {
        is JsonObject -> value.entries.firstNotNullOfOrNull { (key, child) ->
            val normalized = key.replace("_", "").replace("-", "").lowercase()
            if (normalized in forbiddenKeys) key else findForbidden(child)
        }
        is JsonArray -> value.firstNotNullOfOrNull(::findForbidden)
        else -> null
    }

    private fun realtimePayloadError(event: String, payload: JsonElement): String? {
        val row = payload as? JsonObject ?: return "REALTIME_PAYLOAD_INVALID"
        fun string(name: String) = row[name]?.toString()?.trim('"')?.takeIf(String::isNotBlank)
        fun integer(name: String) = row[name]?.toString()?.toLongOrNull()
        val valid = when (event) {
            "task.event.v2" -> {
                val type = string("type")
                val context = row["context"] as? JsonObject
                type != null && context != null && string("taskId") != null && string("eventId") != null && integer("sequence")?.let { it >= 1 } == true
                    && integer("revision")?.let { it >= 1 } == true && string("occurredAt")?.let(::isIso) == true
                    && context["correlationId"]?.toString()?.trim('"')?.isNotBlank() == true
                    && context["idempotencyKey"]?.toString()?.trim('"')?.isNotBlank() == true
                    && validTaskEventPayload(type, row["payload"])
            }
            "pairing.status.v2" -> string("pairingId") != null && string("status") in setOf("requested", "approved", "rejected", "expired", "revoked")
            "device.status.v2" -> string("deviceId") != null && string("status") in setOf("pending", "trusted", "revoked", "expired")
            "file_transfer.status.v2" -> string("transferId") != null && string("status") in setOf("pending", "transferring", "completed", "failed", "cancelled")
            "emergency_stop.activated.v2" -> string("eventId") != null && string("deviceId") != null && string("workspaceId") != null
                && string("sessionId") != null && string("activatedAt")?.let(::isIso) == true && row["killSwitchActive"]?.toString() == "true"
            "task.progress.v2" -> string("taskId") != null && row["percent"]?.toString()?.toIntOrNull()?.let { it in 0..100 } == true
            "task.created.v2" -> validTaskEventPayload("task.created", row)
            "task.status_changed.v2" -> validTaskEventPayload("task.status_changed", row)
            "task.step_updated.v2" -> validTaskEventPayload("task.step_updated", row)
            "task.tool_started.v2" -> validTaskEventPayload("task.tool_started", row)
            "task.tool_completed.v2" -> validTaskEventPayload("task.tool_completed", row)
            "task.verification_completed.v2" -> validTaskEventPayload("task.verification_completed", row)
            "task.recovery_started.v2" -> validTaskEventPayload("task.recovery_started", row)
            "task.completed.v2" -> validTaskEventPayload("task.completed", row)
            "task.failed.v2" -> validTaskEventPayload("task.failed", row)
            "task.cancelled.v2" -> validTaskEventPayload("task.cancelled", row)
            "capsule.updated.v2", "mission.updated.v2" -> row.isNotEmpty()
            in CrossDeviceWire.events -> return when (val parsed = crossDeviceParser.realtime(event, payload, enforcePcFreshness = false)) {
                is ParseResult.Valid -> null
                is ParseResult.Invalid -> parsed.code
            }
            else -> false
        }
        return if (valid) null else "REALTIME_PAYLOAD_INVALID"
    }

    private fun validTaskEventPayload(type: String, payload: JsonElement?): Boolean {
        val row = payload as? JsonObject ?: return false
        fun string(name: String) = row[name]?.toString()?.trim('"')?.takeIf(String::isNotBlank)
        fun integer(name: String) = row[name]?.toString()?.toIntOrNull()
        fun bool(name: String) = row[name]?.toString()?.toBooleanStrictOrNull()
        fun status(name: String) = string(name) in TaskStatus.entries.map { it.name }
        return when (type) {
            "task.created" -> status("status")
            "task.status_changed" -> status("fromStatus") && status("toStatus")
            "task.step_updated" -> string("stepId") != null && string("status") != null
            "task.tool_started" -> string("toolId") != null && string("runId") != null
            "task.tool_completed" -> string("toolId") != null && string("runId") != null && string("outcome") in setOf("success", "failure", "cancelled")
            "task.verification_completed" -> string("verificationId") != null && string("status") in setOf("PASS", "FAIL", "PARTIAL", "RETRYABLE")
            "task.recovery_started" -> string("recoveryId") != null && integer("attempt")?.let { it >= 1 } == true && string("classification") != null
            "task.failed" -> string("errorCode") != null && bool("retryable") != null
            "task.completed" -> (row["resultArtifactIds"] as? JsonArray)?.all { it.toString().trim('"').isNotBlank() } != false
            "task.cancelled" -> row["reasonCode"] == null || string("reasonCode") != null
            else -> false
        }
    }

    private fun validTrust(trust: DeviceTrust): Boolean =
        trust.contractVersion == 2 && trust.amendment == EDITH_AMENDMENT && trust.deviceId.isNotBlank()
            && isSha256(trust.fingerprint)
            && (trust.status != TrustStatus.TRUSTED || trust.trustedAt?.let(::isIso) == true)
            && (trust.status != TrustStatus.REVOKED || trust.revokedAt?.let(::isIso) == true)
            && trust.expiresAt?.let(::isIso) != false

    private fun validOwnerBinding(binding: OwnerSessionBinding): Boolean =
        binding.contractVersion == 2 && binding.amendment == EDITH_AMENDMENT
            && listOf(binding.bindingId, binding.ownerSessionId, binding.deviceId, binding.workspaceId).all(String::isNotBlank)
            && isSha256(binding.deviceFingerprint) && isIso(binding.createdAt) && isIso(binding.expiresAt)
            && Instant.parse(binding.expiresAt) > Instant.parse(binding.createdAt)
            && binding.status in setOf(null, "active", "revoked", "expired")
            && (binding.status != "revoked" || binding.revokedAt?.let(::isIso) == true)

    private fun validManifest(transfer: FileTransferDescriptor, manifest: FileChunkManifest): Boolean {
        if (manifest.contractVersion != 2 || manifest.amendment != EDITH_AMENDMENT || manifest.chunkSizeBytes < 1
            || manifest.totalChunks != manifest.chunks.size || manifest.fileSha256 != transfer.sha256
            || manifest.transferId?.let { it != transfer.transferId } == true || manifest.sizeBytes?.let { it != transfer.sizeBytes } == true
        ) return false
        var offset = 0L
        for ((expectedIndex, chunk) in manifest.chunks.withIndex()) {
            if (chunk.index != expectedIndex || chunk.offsetBytes != offset || chunk.sizeBytes < 1 || !isSha256(chunk.sha256)) return false
            if (expectedIndex < manifest.chunks.lastIndex && chunk.sizeBytes > manifest.chunkSizeBytes) return false
            offset += chunk.sizeBytes
        }
        return offset == transfer.sizeBytes
    }

    private fun validDestination(destination: SafeDestination): Boolean =
        destination.contractVersion == 2 && destination.amendment == EDITH_AMENDMENT
            && destination.handle.matches(Regex("^[A-Za-z0-9._-]{1,128}$"))
            && destination.scope in setOf("workspace", "downloads", "vault_inbox", "temporary")
            && destination.overwritePolicy in setOf(null, "reject", "rename", "replace_with_approval")
            && destination.createdAt?.let(::isIso) != false && destination.expiresAt?.let(::isIso) != false

    private fun isSafeFileName(value: String): Boolean = value.isNotBlank() && value.length <= 128 && value.trim() == value
        && !value.contains(Regex("[\\\\/:*?\"<>|]")) && value != "." && value != ".." && !value.contains("..")
        && !value.matches(Regex("^(?i)(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\\.|$).*"))

    private fun isIso(value: String) = runCatching { Instant.parse(value) }.isSuccess
    private fun isSha256(value: String) = value.matches(Regex("^[a-fA-F0-9]{64}$"))
    private fun invalid(code: String) = ParseResult.Invalid(code, "Canonical mobile contract validation failed.")
}
