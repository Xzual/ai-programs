package com.edith.mobile.domain

import com.edith.mobile.contracts.DeviceCapabilities
import com.edith.mobile.contracts.AdvancedMobileProjection
import com.edith.mobile.contracts.DeviceTrust
import com.edith.mobile.contracts.FileTransferDescriptor
import com.edith.mobile.contracts.MobileTask

enum class Availability { AVAILABLE, OFFLINE, CONFIGURATION_REQUIRED, DISABLED, UNKNOWN }
enum class ConnectionPhase { UNCONFIGURED, DISCONNECTED, CONNECTING, CONNECTED, RECONNECTING, CONFLICT, ERROR }

data class PcTarget(
    val trust: DeviceTrust,
    val displayName: String,
    val connection: ConnectionPhase,
    val capabilities: DeviceCapabilities?,
    val lastSeenAt: String? = null,
)

data class MobileFeature(
    val id: String,
    val label: String,
    val availability: Availability,
    val reason: String,
    val requiresConfirmation: Boolean = false,
)

data class MobileAppState(
    val selectedPcId: String? = null,
    val computers: List<PcTarget> = emptyList(),
    val tasks: List<MobileTask> = emptyList(),
    val transfers: List<FileTransferDescriptor> = emptyList(),
    val realtime: RealtimeState = RealtimeState(),
    val features: List<MobileFeature> = contractReadyFeatures(null),
    val ownerBindingActive: Boolean = false,
    val emergencyStop: DeliveryState = DeliveryState.IDLE,
    val crossDevice: CrossDeviceState = CrossDeviceState(),
    val advanced: AdvancedMobileProjection? = null,
    val advancedErrorCode: String? = null,
)

fun contractReadyFeatures(capabilities: DeviceCapabilities?): List<MobileFeature> = listOf(
    MobileFeature("refresh", "Görevleri yenile", if (capabilities?.taskUpdates == true) Availability.AVAILABLE else Availability.CONFIGURATION_REQUIRED, "Backend taskUpdates capability gerekli"),
    MobileFeature("remote_view", "Remote View", Availability.CONFIGURATION_REQUIRED, "MediaProjection ve backend stream capability advertise edilmedi", true),
    MobileFeature("wake_on_lan", "Wake-on-LAN", Availability.CONFIGURATION_REQUIRED, "Backend güvenli WOL capability advertise edilmedi", true),
    MobileFeature("clipboard", "Clipboard handoff", Availability.CONFIGURATION_REQUIRED, "Cross-device capability handshake gerekli", true),
    MobileFeature("ask_pc", "Ask My Computer", Availability.CONFIGURATION_REQUIRED, "Remote query capability advertise edilmedi", true),
    MobileFeature("voice_note", "Voice note", Availability.CONFIGURATION_REQUIRED, "Voice upload capability advertise edilmedi", true),
    MobileFeature("file_transfer", "Dosya aktarımı", if (capabilities?.fileTransfer == true && capabilities.fileTransferEncryption) Availability.AVAILABLE else Availability.CONFIGURATION_REQUIRED, "Encrypted file-transfer capability gerekli", true),
)

enum class DeliveryState { IDLE, PENDING, DELIVERED, FAILED, CONFLICT }

data class RealtimeState(
    val phase: ConnectionPhase = ConnectionPhase.UNCONFIGURED,
    val streamId: String? = null,
    val cursor: Long = 0,
    val sequence: Long = 0,
    val recentEventIds: List<String> = emptyList(),
    val retryAttempt: Int = 0,
    val nextRetryDelayMs: Long? = null,
    val safeErrorCode: String? = null,
)
