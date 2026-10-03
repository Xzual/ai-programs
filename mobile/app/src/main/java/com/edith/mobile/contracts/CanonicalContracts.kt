package com.edith.mobile.contracts

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

const val EDITH_SCHEMA = "edith.shared"
const val EDITH_VERSION = 2
const val EDITH_AMENDMENT = "2.1"

@Serializable
enum class TaskStatus {
    CREATED, ANALYZING, QUEUED, PLANNING, WAITING_DEPENDENCY, RUNNING, PAUSED, RETRYING,
    VERIFYING, WAITING_PERMISSION, WAITING_FOR_APPROVAL, BLOCKED, RECOVERING, COMPLETED,
    FAILED, CANCELLED, ROLLING_BACK, ROLLED_BACK
}

@Serializable
data class TaskProgressSnapshot(
    val contractVersion: Int,
    val taskId: String,
    val revision: Int,
    val status: TaskStatus,
    val percent: Int,
    val completedSteps: Int,
    val totalSteps: Int,
    val failedSteps: Int,
    val recoveryAttempts: Int,
    val verificationStatus: String? = null,
    val terminal: Boolean,
    val sources: List<String>,
)

@Serializable
data class MobileTask(
    val id: String,
    val title: String,
    val objective: String,
    val priority: String,
    val status: TaskStatus,
    val revision: Int,
    val eventSequence: Int,
    val contractVersion: Int,
    val progress: TaskProgressSnapshot,
    val result: String? = null,
    val failureReason: String? = null,
    val artifacts: List<String> = emptyList(),
)

@Serializable data class ContractDescriptor(val schema: String, val version: Int)
@Serializable data class TaskListData(val tasks: List<MobileTask>)
@Serializable data class TaskListEnvelope(val contract: ContractDescriptor, val data: TaskListData)

@Serializable
data class RealtimeReplayMetadata(
    val requestedAfterCursor: Long? = null,
    val windowStartCursor: Long,
    val windowEndCursor: Long,
    val truncated: Boolean,
)

@Serializable
data class RealtimeEnvelope(
    val schema: String,
    val version: Int,
    val event: String,
    val eventId: String,
    val occurredAt: String,
    val sequence: Long,
    val streamId: String,
    val cursor: Long,
    val correlationId: String,
    val causationId: String? = null,
    val replayed: Boolean,
    val replay: RealtimeReplayMetadata? = null,
    val payload: JsonElement,
)

@Serializable
data class DeviceCapabilities(
    val contractVersion: Int,
    val amendment: String,
    val protocolVersion: String? = null,
    val realtime: Boolean,
    val taskUpdates: Boolean = false,
    val capsulePresentation: Boolean = false,
    val missionPresentation: Boolean = false,
    val fileTransfer: Boolean,
    val fileTransferEncryption: Boolean = false,
    val maxChunkSizeBytes: Long? = null,
    val notifications: Boolean,
    val camera: Boolean,
    val microphone: Boolean,
    val computerControl: Boolean,
    val browserControl: Boolean,
)

@Serializable
enum class TrustStatus { @SerialName("pending") PENDING, @SerialName("trusted") TRUSTED, @SerialName("revoked") REVOKED, @SerialName("expired") EXPIRED }

@Serializable
data class DeviceTrust(
    val contractVersion: Int,
    val amendment: String,
    val deviceId: String,
    val workspaceId: String? = null,
    val fingerprint: String,
    val status: TrustStatus,
    val trustedAt: String? = null,
    val revokedAt: String? = null,
    val expiresAt: String? = null,
    val reconnectCredentialId: String? = null,
    val reconnectCredentialFingerprint: String? = null,
    val capabilities: DeviceCapabilities? = null,
)

@Serializable
data class OwnerSessionBinding(
    val contractVersion: Int,
    val amendment: String,
    val bindingId: String,
    val ownerSessionId: String,
    val deviceId: String,
    val workspaceId: String,
    val deviceFingerprint: String,
    val createdAt: String,
    val expiresAt: String,
    val status: String? = null,
    val revokedAt: String? = null,
)

@Serializable
enum class PairingStatus { @SerialName("requested") REQUESTED, @SerialName("approved") APPROVED, @SerialName("rejected") REJECTED, @SerialName("expired") EXPIRED, @SerialName("revoked") REVOKED }

@Serializable
data class PairingChallenge(
    val contractVersion: Int,
    val amendment: String,
    val protocolVersion: String? = null,
    val cryptoSuite: String? = null,
    val requestedCommandsFingerprint: String? = null,
    val challengeId: String,
    val pairingId: String,
    val deviceId: String,
    val workspaceId: String? = null,
    val algorithm: String,
    val challengeFingerprint: String,
    val proofFingerprint: String? = null,
    val issuedAt: String,
    val expiresAt: String,
    val consumedAt: String? = null,
    val oneTime: Boolean,
    val status: String? = null,
    val attempt: Int? = null,
    val maxAttempts: Int? = null,
    val verifiedAt: String? = null,
)

@Serializable
data class DeviceIdentity(
    val deviceId: String,
    val displayName: String,
    val platform: String,
    val publicKey: String? = null,
    val fingerprint: String? = null,
    val capabilities: DeviceCapabilities? = null,
)

@Serializable
data class PairingSession(
    val pairingId: String,
    val device: DeviceIdentity,
    val status: PairingStatus,
    val createdAt: String,
    val expiresAt: String,
    val challenge: PairingChallenge? = null,
    val trust: DeviceTrust? = null,
    val ownerBinding: OwnerSessionBinding? = null,
)

@Serializable
data class FileChunk(
    val index: Int,
    val offsetBytes: Long,
    val sizeBytes: Long,
    val sha256: String,
)

@Serializable
data class FileChunkManifest(
    val contractVersion: Int,
    val amendment: String,
    val transferId: String? = null,
    val sizeBytes: Long? = null,
    val chunkSizeBytes: Long,
    val totalChunks: Int,
    val fileSha256: String,
    val chunks: List<FileChunk>,
    val createdAt: String? = null,
)

@Serializable
data class SafeDestination(
    val contractVersion: Int,
    val amendment: String,
    val handle: String,
    val scope: String,
    val displayName: String? = null,
    val overwritePolicy: String? = null,
    val createdAt: String? = null,
    val expiresAt: String? = null,
)

@Serializable
data class TransferResume(
    val contractVersion: Int,
    val amendment: String,
    val resumable: Boolean,
    val nextChunkIndex: Int,
    val completedChunkIndexes: List<Int>,
    val retryCount: Int,
    val maxRetries: Int,
    val acknowledgedBytes: Long? = null,
    val errorCode: String? = null,
)

@Serializable
data class TransferEncryption(
    val contractVersion: Int,
    val amendment: String,
    val algorithm: String,
    val keyId: String,
    val keyFingerprint: String,
    val nonceStrategy: String,
    val authenticated: Boolean,
    val aadContext: String? = null,
)

@Serializable
data class FileTransferDescriptor(
    val transferId: String,
    val fileName: String,
    val mediaType: String,
    val sizeBytes: Long,
    val sha256: String,
    val direction: String,
    val status: String,
    val sourceDeviceId: String? = null,
    val targetDeviceId: String? = null,
    val chunkManifest: FileChunkManifest? = null,
    val encryption: TransferEncryption? = null,
    val resume: TransferResume? = null,
    val destination: SafeDestination? = null,
    val createdAt: String? = null,
    val updatedAt: String? = null,
    val contractVersion: Int? = null,
    val amendment: String? = null,
)
