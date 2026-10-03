package com.edith.mobile.domain

import com.edith.mobile.contracts.PairingSession
import com.edith.mobile.contracts.PairingStatus
import com.edith.mobile.contracts.TrustStatus
import java.time.Instant

sealed interface PairingState {
    data object Unpaired : PairingState
    data class LocalIdentityReady(val fingerprint: String, val endpointConfigured: Boolean) : PairingState
    data class AwaitingOwner(
        val pairingId: String,
        val fingerprint: String,
        val expiresAt: String,
        val ownerVerificationCode: String? = null,
    ) : PairingState
    data class Trusted(val pairingId: String, val deviceId: String, val fingerprint: String) : PairingState
    data class Rejected(val reasonCode: String) : PairingState
    data object Expired : PairingState
    data object Revoked : PairingState
    data class ConfigurationRequired(val fingerprint: String, val reason: String) : PairingState
    data class Failed(val safeErrorCode: String) : PairingState
}

sealed interface PairingEvent {
    data class IdentityGenerated(val fingerprint: String, val endpointConfigured: Boolean) : PairingEvent
    data class ServerSession(val session: PairingSession) : PairingEvent
    data class Failure(val code: String) : PairingEvent
    data object LocalWipe : PairingEvent
}

object PairingReducer {
    fun reduce(current: PairingState, event: PairingEvent): PairingState = when (event) {
        is PairingEvent.IdentityGenerated -> if (event.endpointConfigured) PairingState.LocalIdentityReady(event.fingerprint, true)
            else PairingState.ConfigurationRequired(event.fingerprint, "pairing_endpoint_not_configured")
        is PairingEvent.ServerSession -> fromSession(current, event.session)
        is PairingEvent.Failure -> PairingState.Failed(event.code)
        PairingEvent.LocalWipe -> PairingState.Unpaired
    }

    private fun fromSession(current: PairingState, session: PairingSession): PairingState = when (session.status) {
        PairingStatus.REQUESTED -> PairingState.AwaitingOwner(
            pairingId = session.pairingId,
            fingerprint = session.device.fingerprint.orEmpty(),
            expiresAt = session.expiresAt,
        )
        PairingStatus.APPROVED -> {
            val trust = session.trust
            val binding = session.ownerBinding
            val pending = current as? PairingState.AwaitingOwner
            val expectedFingerprint = pending?.fingerprint
            when {
                trust == null || trust.status != TrustStatus.TRUSTED -> PairingState.Failed("approved_without_trust_evidence")
                binding == null || binding.status != "active" -> PairingState.Failed("approved_without_owner_binding")
                pending == null -> PairingState.Failed("pending_pairing_evidence_required")
                pending.pairingId != session.pairingId -> PairingState.Failed("pairing_identity_mismatch")
                session.challenge == null || session.challenge.status != "consumed" || session.challenge.consumedAt == null -> PairingState.Failed("pairing_challenge_not_consumed")
                session.device.fingerprint != expectedFingerprint || trust.fingerprint != expectedFingerprint || binding.deviceFingerprint != expectedFingerprint -> PairingState.Failed("device_fingerprint_mismatch")
                trust.deviceId != session.device.deviceId || binding.deviceId != session.device.deviceId -> PairingState.Failed("device_identity_mismatch")
                trust.workspaceId == null || trust.workspaceId != binding.workspaceId -> PairingState.Failed("workspace_binding_mismatch")
                runCatching { Instant.parse(session.expiresAt) <= Instant.now() }.getOrDefault(true) -> PairingState.Expired
                runCatching { Instant.parse(binding.expiresAt) <= Instant.now() }.getOrDefault(true) -> PairingState.Failed("owner_binding_expired")
                trust.expiresAt == null || runCatching { Instant.parse(trust.expiresAt) <= Instant.now() }.getOrDefault(true) -> PairingState.Expired
                else -> PairingState.Trusted(session.pairingId, session.device.deviceId, trust.fingerprint)
            }
        }
        PairingStatus.REJECTED -> PairingState.Rejected("owner_rejected")
        PairingStatus.EXPIRED -> PairingState.Expired
        PairingStatus.REVOKED -> PairingState.Revoked
    }
}
