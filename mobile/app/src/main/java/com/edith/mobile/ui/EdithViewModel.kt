package com.edith.mobile.ui

import android.app.Application
import android.net.Uri
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.edith.mobile.data.FoundationMobileRepository
import com.edith.mobile.data.MobileRepository
import com.edith.mobile.domain.ConnectionPhase
import com.edith.mobile.domain.DeliveryState
import com.edith.mobile.domain.MobileAppState
import com.edith.mobile.domain.PairingState
import com.edith.mobile.domain.RealtimeEvent
import com.edith.mobile.domain.RealtimeReducer
import com.edith.mobile.domain.contractReadyFeatures
import com.edith.mobile.domain.CrossDeviceReducer
import com.edith.mobile.contracts.CrossDeviceParser
import com.edith.mobile.contracts.CrossDevicePcStatus
import com.edith.mobile.contracts.CrossDeviceWire
import com.edith.mobile.contracts.ParseResult
import com.edith.mobile.contracts.PcStatusFreshnessPolicy
import com.edith.mobile.contracts.RealtimeEnvelope
import com.edith.mobile.contracts.TrustStatus
import com.edith.mobile.network.NetworkResult
import com.edith.mobile.network.RealtimeHandle
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.time.Instant
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive

data class MobileUiState(
    val app: MobileAppState = MobileAppState(),
    val pairing: PairingState = PairingState.Unpaired,
    val busy: Boolean = false,
    val safeMessage: String? = null,
)

class EdithViewModel : AndroidViewModel {
    private val repository: MobileRepository
    private val clock: () -> Instant
    private var realtimeHandle: RealtimeHandle? = null
    private var reconnectJob: Job? = null
    private var realtimeGeneration = 0L
    private var clipboardExpiryJob: Job? = null
    private var pcStatusExpiryJob: Job? = null
    private val smartNotifications = com.edith.mobile.notifications.SmartNotifications(getApplication())

    constructor(application: Application) : super(application) {
        repository = FoundationMobileRepository(application)
        clock = Instant::now
    }

    internal constructor(application: Application, repository: MobileRepository, clock: () -> Instant = Instant::now) : super(application) {
        this.repository = repository
        this.clock = clock
    }

    private val mutableState = MutableStateFlow(MobileUiState())
    val state: StateFlow<MobileUiState> = mutableState.asStateFlow()

    fun startPairing() {
        if (mutableState.value.busy) return
        mutableState.update { it.copy(busy = true, safeMessage = null) }
        viewModelScope.launch {
            val pairing = repository.startPairing()
            mutableState.update { it.copy(pairing = pairing, busy = false) }
        }
    }

    fun continuePairing() {
        if (mutableState.value.busy || mutableState.value.pairing !is PairingState.AwaitingOwner) return
        mutableState.update { it.copy(busy = true, safeMessage = null) }
        viewModelScope.launch {
            val pairing = repository.continuePairing(mutableState.value.pairing)
            val target = repository.activeTarget()
            mutableState.update { state ->
                state.copy(
                    pairing = pairing,
                    busy = false,
                    app = if (pairing is PairingState.Trusted && target != null) state.app.copy(
                        selectedPcId = target.trust.deviceId,
                        computers = listOf(target),
                        ownerBindingActive = repository.ownerBindingActive(),
                        features = contractReadyFeatures(target.capabilities),
                    ) else state.app,
                )
            }
            if (pairing is PairingState.Trusted) {
                connectRealtime()
                refreshCrossDevice()
            }
        }
    }

    private fun connectRealtime() {
        reconnectJob?.cancel()
        val generation = ++realtimeGeneration
        realtimeHandle?.close()
        realtimeHandle = null
        mutableState.update { state -> state.copy(app = state.app.copy(realtime = state.app.realtime.copy(phase = ConnectionPhase.CONNECTING))) }
        val opened = repository.openRealtime(
            afterCursor = mutableState.value.app.realtime.cursor,
            onEnvelope = onEnvelope@{ parsed ->
                if (generation != realtimeGeneration) return@onEnvelope
                if (parsed is ParseResult.Invalid) {
                    invalidateAuthority(PairingState.Failed(parsed.code), "Realtime event reddedildi: ${parsed.code}")
                    return@onEnvelope
                }
                parsed as ParseResult.Valid<RealtimeEnvelope>
                authorityTermination(parsed.value)?.let { terminal ->
                    invalidateAuthority(terminal, "PC güveni uzaktan iptal edildi; yerel oturum kapatıldı.")
                    return@onEnvelope
                }
                val crossPayload = if (parsed.value.event in CrossDeviceWire.events) repository.parseCrossDeviceEvent(parsed.value.event, parsed.value.payload) else null
                if (crossPayload is ParseResult.Invalid) {
                    if (parsed.value.event == CrossDeviceWire.PC_STATUS_EVENT && crossPayload.code in PC_STATUS_FRESHNESS_ERRORS) {
                        mutableState.update { state ->
                            val connected = if (state.app.realtime.phase != ConnectionPhase.CONNECTED || state.app.realtime.streamId != parsed.value.streamId) {
                                RealtimeReducer.reduce(state.app.realtime, RealtimeEvent.Connected(parsed.value.streamId)).state
                            } else state.app.realtime
                            val reduced = RealtimeReducer.reduce(connected, RealtimeEvent.EnvelopeReceived(parsed.value))
                            state.copy(app = state.app.copy(
                                realtime = reduced.state,
                                crossDevice = CrossDeviceReducer.rejectPcStatus(state.app.crossDevice, clock(), crossPayload.code),
                            ))
                        }
                        return@onEnvelope
                    }
                    invalidateAuthority(PairingState.Failed(crossPayload.code), "Cross-device event reddedildi: ${crossPayload.code}")
                    return@onEnvelope
                }
                var envelopeAccepted = false
                mutableState.update { state ->
                    val connected = if (state.app.realtime.phase != ConnectionPhase.CONNECTED || state.app.realtime.streamId != parsed.value.streamId) {
                        RealtimeReducer.reduce(state.app.realtime, RealtimeEvent.Connected(parsed.value.streamId)).state
                    } else state.app.realtime
                    val reduced = RealtimeReducer.reduce(connected, RealtimeEvent.EnvelopeReceived(parsed.value))
                    envelopeAccepted = reduced.accepted
                    val computers = state.app.computers.map { pc ->
                        if (pc.trust.deviceId == state.app.selectedPcId) pc.copy(connection = reduced.state.phase) else pc
                    }
                    val cross = (crossPayload as? ParseResult.Valid<CrossDeviceParser.RealtimePayload>)?.value?.takeIf { reduced.accepted }?.let {
                        applyCrossPayload(state.app.crossDevice, it, parsed.value.cursor, clock())
                    } ?: state.app.crossDevice
                    state.copy(app = state.app.copy(realtime = reduced.state, computers = computers, crossDevice = cross))
                }
                if (envelopeAccepted && mutableState.value.pairing is PairingState.Trusted && mutableState.value.app.ownerBindingActive) {
                    smartNotifications.accepted(parsed.value, clock())
                }
                (crossPayload as? ParseResult.Valid<CrossDeviceParser.RealtimePayload>)?.value
                    ?.let { it as? CrossDeviceParser.RealtimePayload.PcStatus }
                    ?.value
                    ?.takeIf { accepted ->
                        val cross = mutableState.value.app.crossDevice
                        envelopeAccepted && cross.pcStatus == accepted && cross.safeErrorCode == null
                    }
                    ?.let(::schedulePcStatusExpiry)
            },
            onClosed = onClosed@{ code ->
                if (generation != realtimeGeneration) return@onClosed
                if (code.startsWith("realtime_envelope_") || code == "mobile_authority_expired") {
                    val message = if (code == "mobile_authority_expired") "Mobil trust/session süresi doldu; yerel oturum kapatıldı."
                    else "Şifreli realtime kanalı doğrulanamadı; oturum kapatıldı."
                    invalidateAuthority(if (code == "mobile_authority_expired") PairingState.Expired else PairingState.Failed(code), message)
                    return@onClosed
                }
                realtimeHandle = null
                var retryDelay: Long? = null
                mutableState.update { state ->
                    val reduced = RealtimeReducer.reduce(state.app.realtime, RealtimeEvent.TransportClosed(code)).state
                    retryDelay = reduced.nextRetryDelayMs
                    state.copy(
                        app = state.app.copy(
                            realtime = reduced,
                            computers = state.app.computers.map { pc -> if (pc.trust.deviceId == state.app.selectedPcId) pc.copy(connection = reduced.phase) else pc },
                        ),
                    )
                }
                retryDelay?.let { waitMs ->
                    reconnectJob?.cancel()
                    reconnectJob = viewModelScope.launch {
                        delay(waitMs)
                        if (generation == realtimeGeneration && mutableState.value.pairing is PairingState.Trusted) connectRealtime()
                    }
                }
            },
        )
        when (opened) {
            is NetworkResult.Success -> if (generation == realtimeGeneration) realtimeHandle = opened.value else opened.value.close()
            is NetworkResult.Unavailable -> mutableState.update { state -> state.copy(app = state.app.copy(realtime = state.app.realtime.copy(phase = ConnectionPhase.UNCONFIGURED, safeErrorCode = opened.reasonCode))) }
            is NetworkResult.Failure -> mutableState.update { state -> state.copy(app = state.app.copy(realtime = state.app.realtime.copy(phase = ConnectionPhase.ERROR, safeErrorCode = opened.safeErrorCode))) }
        }
    }

    private fun authorityTermination(envelope: RealtimeEnvelope): PairingState? {
        val payload = envelope.payload as? JsonObject ?: return null
        val status = payload["status"]?.jsonPrimitive?.content
        val selectedDevice = mutableState.value.app.selectedPcId
        val activePairingId = (mutableState.value.pairing as? PairingState.Trusted)?.pairingId
        return when {
            envelope.event == "device.status.v2" && payload["deviceId"]?.jsonPrimitive?.content == selectedDevice && status == "revoked" -> PairingState.Revoked
            envelope.event == "device.status.v2" && payload["deviceId"]?.jsonPrimitive?.content == selectedDevice && status == "expired" -> PairingState.Expired
            envelope.event == "pairing.status.v2" && payload["pairingId"]?.jsonPrimitive?.content == activePairingId && status == "revoked" -> PairingState.Revoked
            envelope.event == "pairing.status.v2" && payload["pairingId"]?.jsonPrimitive?.content == activePairingId && status == "expired" -> PairingState.Expired
            else -> null
        }
    }

    private fun invalidateAuthority(pairing: PairingState, message: String) {
        smartNotifications.clearDelivered()
        ++realtimeGeneration
        reconnectJob?.cancel()
        reconnectJob = null
        pcStatusExpiryJob?.cancel()
        pcStatusExpiryJob = null
        realtimeHandle?.close()
        realtimeHandle = null
        repository.invalidateActiveSession()
        mutableState.update { state ->
            val trustStatus = if (pairing is PairingState.Revoked) TrustStatus.REVOKED else TrustStatus.EXPIRED
            state.copy(
                pairing = pairing,
                safeMessage = message,
                app = state.app.copy(
                    ownerBindingActive = false,
                    realtime = state.app.realtime.copy(phase = ConnectionPhase.DISCONNECTED),
                    computers = state.app.computers.map { it.copy(trust = it.trust.copy(status = trustStatus), connection = ConnectionPhase.DISCONNECTED) },
                    features = contractReadyFeatures(null),
                    crossDevice = CrossDeviceReducer.clearAuthority(state.app.crossDevice),
                    advanced = null,
                    advancedErrorCode = "authority_cleared",
                ),
            )
        }
    }

    fun selectComputer(deviceId: String) {
        val pc = mutableState.value.app.computers.find { it.trust.deviceId == deviceId && it.trust.status.name == "TRUSTED" }
        mutableState.update { state ->
            if (pc == null) state.copy(safeMessage = "Yalnız trusted cihaz seçilebilir.")
            else state.copy(app = state.app.copy(selectedPcId = deviceId, features = contractReadyFeatures(pc.capabilities)), safeMessage = null)
        }
    }

    fun emergencyStop() {
        val snapshot = mutableState.value.app
        val pc = snapshot.computers.find { it.trust.deviceId == snapshot.selectedPcId }
        if (pc == null || pc.connection != ConnectionPhase.CONNECTED || !snapshot.ownerBindingActive) {
            mutableState.update { it.copy(app = it.app.copy(emergencyStop = DeliveryState.FAILED), safeMessage = "Emergency Stop gönderilmedi: bağlı trusted PC ve owner binding gerekli.") }
            return
        }
        mutableState.update { it.copy(app = it.app.copy(emergencyStop = DeliveryState.PENDING), safeMessage = "Emergency Stop gönderiliyor; teslim henüz doğrulanmadı.") }
        viewModelScope.launch {
            when (repository.sendEmergencyStop(pc.trust.deviceId, Instant.now())) {
                is NetworkResult.Success -> mutableState.update { it.copy(app = it.app.copy(emergencyStop = DeliveryState.DELIVERED), safeMessage = "Doğrulanmış Emergency Stop teslim alındısı alındı.") }
                is NetworkResult.Unavailable -> mutableState.update { it.copy(app = it.app.copy(emergencyStop = DeliveryState.FAILED), safeMessage = "Emergency Stop gönderilmedi: backend/encryption configuration required.") }
                is NetworkResult.Failure -> mutableState.update { it.copy(app = it.app.copy(emergencyStop = DeliveryState.FAILED), safeMessage = "Emergency Stop teslim edilemedi.") }
            }
        }
    }

    fun refreshCrossDevice() {
        if (mutableState.value.pairing !is PairingState.Trusted) {
            mutableState.update { it.copy(safeMessage = "Cross-device özellikleri için trusted PC gerekli.") }
            return
        }
        mutableState.update { it.copy(app = it.app.copy(crossDevice = it.app.crossDevice.copy(loading = true, safeErrorCode = null))) }
        viewModelScope.launch {
            when (val capabilities = repository.crossDeviceCapabilities()) {
                is NetworkResult.Success -> mutableState.update { state -> state.copy(app = state.app.copy(crossDevice = CrossDeviceReducer.capabilities(state.app.crossDevice, capabilities.value).copy(loading = false))) }
                is NetworkResult.Unavailable -> crossFailure(capabilities.reasonCode)
                is NetworkResult.Failure -> crossFailure(capabilities.safeErrorCode)
            }
            if (mutableState.value.app.crossDevice.capabilities?.resultCards == "available") {
                when (val cards = repository.resultCards()) {
                    is NetworkResult.Success -> cards.value.forEach { card -> mutableState.update { state -> state.copy(app = state.app.copy(crossDevice = CrossDeviceReducer.resultCard(state.app.crossDevice, card))) } }
                    else -> Unit
                }
            }
            if (mutableState.value.app.crossDevice.capabilities?.pcStatus == "available") {
                when (val status = repository.pcStatus()) {
                    is NetworkResult.Success -> acceptPcStatus(status.value)
                    is NetworkResult.Unavailable -> rejectPcStatus(status.reasonCode)
                    is NetworkResult.Failure -> rejectPcStatus(status.safeErrorCode)
                }
            }
            when (val advanced = repository.advancedState()) {
                is NetworkResult.Success -> mutableState.update { state ->
                    state.copy(app = state.app.copy(advanced = advanced.value, advancedErrorCode = null))
                }
                is NetworkResult.Unavailable -> mutableState.update { state ->
                    state.copy(app = state.app.copy(advanced = null, advancedErrorCode = advanced.reasonCode))
                }
                is NetworkResult.Failure -> {
                    if (advanced.safeErrorCode in ADVANCED_AUTHORITY_ERRORS) {
                        invalidateAuthority(PairingState.Failed(advanced.safeErrorCode), "Advanced mobile projection doğrulanamadı; yerel oturum kapatıldı.")
                        return@launch
                    }
                    mutableState.update { state ->
                        state.copy(app = state.app.copy(advanced = null, advancedErrorCode = advanced.safeErrorCode))
                    }
                }
            }
        }
    }

    fun publishClipboard(content: String, onAccepted: () -> Unit = {}) {
        if (content.isBlank()) return
        viewModelScope.launch {
            when (val result = repository.publishClipboard(content, Instant.now())) {
                is NetworkResult.Success -> {
                    onAccepted()
                    mutableState.update { state -> state.copy(safeMessage = "Clipboard metadata yayımlandı; içerik geçmişe kaydedilmedi.", app = state.app.copy(crossDevice = CrossDeviceReducer.clipboard(state.app.crossDevice, result.value))) }
                }
                is NetworkResult.Unavailable -> crossFailure(result.reasonCode)
                is NetworkResult.Failure -> crossFailure(result.safeErrorCode)
            }
        }
    }

    fun consumeClipboard(clipboardId: String) {
        viewModelScope.launch {
            when (val result = repository.consumeClipboard(clipboardId, Instant.now())) {
                is NetworkResult.Success -> {
                    mutableState.update { state -> state.copy(app = state.app.copy(crossDevice = CrossDeviceReducer.consumedClipboard(state.app.crossDevice, result.value.metadata, result.value.content))) }
                    clipboardExpiryJob?.cancel()
                    val remainingMs = runCatching { java.time.Duration.between(Instant.now(), Instant.parse(result.value.metadata.expiresAt)).toMillis() }.getOrDefault(0L)
                    clipboardExpiryJob = viewModelScope.launch { delay(remainingMs.coerceIn(0L, 60_000L)); clearClipboard() }
                }
                is NetworkResult.Unavailable -> crossFailure(result.reasonCode)
                is NetworkResult.Failure -> crossFailure(result.safeErrorCode)
            }
        }
    }

    fun clearClipboard() {
        clipboardExpiryJob?.cancel()
        clipboardExpiryJob = null
        mutableState.update { state -> state.copy(app = state.app.copy(crossDevice = CrossDeviceReducer.clearClipboard(state.app.crossDevice))) }
    }

    fun upload(uri: Uri) {
        viewModelScope.launch {
            when (val result = repository.uploadUri(uri, Instant.now()) { transfer ->
                mutableState.update { state -> state.copy(app = state.app.copy(crossDevice = CrossDeviceReducer.transfer(state.app.crossDevice, transfer))) }
            }) {
                is NetworkResult.Success -> mutableState.update { it.copy(safeMessage = "Dosya aktarımı byte ve checksum doğrulamasıyla tamamlandı.") }
                is NetworkResult.Unavailable -> crossFailure(result.reasonCode)
                is NetworkResult.Failure -> crossFailure(result.safeErrorCode)
            }
        }
    }

    fun enqueueTaskRefresh() = crossMutation { repository.enqueueTaskList(Instant.now()) }
    fun cancelQueue(id: String) = crossMutation { repository.cancelQueue(id, Instant.now()) }
    fun dispatchQueue() = viewModelScope.launch {
        when (val result = repository.dispatchQueue(Instant.now())) {
            is NetworkResult.Success -> result.value.forEach { item -> mutableState.update { state -> state.copy(app = state.app.copy(crossDevice = CrossDeviceReducer.queue(state.app.crossDevice, item)), safeMessage = "Komutlar dispatching durumunda; sonuç henüz tamamlanmadı.") } }
            is NetworkResult.Unavailable -> crossFailure(result.reasonCode)
            is NetworkResult.Failure -> crossFailure(result.safeErrorCode)
        }
    }

    fun handoffTask(taskId: String) = viewModelScope.launch {
        when (val result = repository.createHandoff(taskId, null, emptyList(), Instant.now())) {
            is NetworkResult.Success -> mutableState.update { state -> state.copy(app = state.app.copy(crossDevice = CrossDeviceReducer.handoff(state.app.crossDevice, result.value)), safeMessage = "Handoff istendi; masaüstü onayı bekleniyor.") }
            is NetworkResult.Unavailable -> crossFailure(result.reasonCode)
            is NetworkResult.Failure -> crossFailure(result.safeErrorCode)
        }
    }

    fun acknowledgeHandoff(handoffId: String) {
        val handoff = mutableState.value.app.crossDevice.handoffs.firstOrNull { it.handoffId == handoffId } ?: return
        viewModelScope.launch {
            when (val result = repository.acknowledgeHandoff(handoff, Instant.now())) {
                is NetworkResult.Success -> mutableState.update { state -> state.copy(app = state.app.copy(crossDevice = CrossDeviceReducer.handoff(state.app.crossDevice, result.value))) }
                is NetworkResult.Unavailable -> crossFailure(result.reasonCode)
                is NetworkResult.Failure -> crossFailure(result.safeErrorCode)
            }
        }
    }

    fun requestAudio() = audioMutation { repository.requestAudio(Instant.now()) }
    fun acknowledgeAudio() = mutableState.value.app.crossDevice.audioLease?.let { lease -> audioMutation { repository.acknowledgeAudio(lease, Instant.now()) } }
    fun releaseAudio() = mutableState.value.app.crossDevice.audioLease?.let { lease -> audioMutation { repository.releaseAudio(lease, Instant.now()) } }

    private fun crossMutation(block: suspend () -> NetworkResult<com.edith.mobile.contracts.CrossDeviceOfflineQueueItem>) = viewModelScope.launch {
        when (val result = block()) {
            is NetworkResult.Success -> mutableState.update { state -> state.copy(app = state.app.copy(crossDevice = CrossDeviceReducer.queue(state.app.crossDevice, result.value))) }
            is NetworkResult.Unavailable -> crossFailure(result.reasonCode)
            is NetworkResult.Failure -> crossFailure(result.safeErrorCode)
        }
    }

    private fun audioMutation(block: suspend () -> NetworkResult<com.edith.mobile.contracts.CrossDeviceAudioHandoff>) = viewModelScope.launch {
        when (val result = block()) {
            is NetworkResult.Success -> mutableState.update { state -> state.copy(app = state.app.copy(crossDevice = CrossDeviceReducer.audio(state.app.crossDevice, result.value))) }
            is NetworkResult.Unavailable -> crossFailure(result.reasonCode)
            is NetworkResult.Failure -> crossFailure(result.safeErrorCode)
        }
    }

    private fun crossFailure(code: String) = mutableState.update { state -> state.copy(safeMessage = "Cross-device işlemi tamamlanmadı: $code", app = state.app.copy(crossDevice = state.app.crossDevice.copy(loading = false, safeErrorCode = code))) }

    private fun applyCrossPayload(
        state: com.edith.mobile.domain.CrossDeviceState,
        payload: CrossDeviceParser.RealtimePayload,
        revision: Long? = null,
        now: Instant = clock(),
    ) = when (payload) {
        is CrossDeviceParser.RealtimePayload.Transfer -> CrossDeviceReducer.transfer(state, payload.value)
        is CrossDeviceParser.RealtimePayload.Clipboard -> CrossDeviceReducer.clipboard(state, payload.value)
        is CrossDeviceParser.RealtimePayload.Queue -> CrossDeviceReducer.queue(state, payload.value)
        is CrossDeviceParser.RealtimePayload.Handoff -> CrossDeviceReducer.handoff(state, payload.value)
        is CrossDeviceParser.RealtimePayload.ResultCard -> CrossDeviceReducer.resultCard(state, payload.value)
        is CrossDeviceParser.RealtimePayload.Audio -> CrossDeviceReducer.audio(state, payload.value)
        is CrossDeviceParser.RealtimePayload.PcStatus -> CrossDeviceReducer.pcStatus(state, payload.value, now, revision)
        is CrossDeviceParser.RealtimePayload.LiveView, is CrossDeviceParser.RealtimePayload.LiveViewFrame, is CrossDeviceParser.RealtimePayload.Wake -> state
    }

    private fun acceptPcStatus(value: CrossDevicePcStatus, revision: Long? = null) {
        mutableState.update { state ->
            state.copy(app = state.app.copy(crossDevice = CrossDeviceReducer.pcStatus(state.app.crossDevice, value, clock(), revision)))
        }
        val cross = mutableState.value.app.crossDevice
        if (cross.pcStatus == value && cross.safeErrorCode == null) schedulePcStatusExpiry(value)
    }

    private fun rejectPcStatus(code: String) {
        pcStatusExpiryJob?.cancel()
        mutableState.update { state ->
            state.copy(app = state.app.copy(crossDevice = CrossDeviceReducer.rejectPcStatus(state.app.crossDevice, clock(), code)))
        }
    }

    private fun schedulePcStatusExpiry(value: CrossDevicePcStatus) {
        pcStatusExpiryJob?.cancel()
        val remainingMs = runCatching { java.time.Duration.between(clock(), Instant.parse(value.expiresAt)).toMillis() }.getOrDefault(0L)
        pcStatusExpiryJob = viewModelScope.launch {
            delay(remainingMs.coerceAtLeast(0L))
            mutableState.update { state ->
                if (state.app.crossDevice.pcStatus?.snapshotId != value.snapshotId) state
                else state.copy(app = state.app.copy(crossDevice = CrossDeviceReducer.rejectPcStatus(
                    state.app.crossDevice,
                    clock(),
                    PcStatusFreshnessPolicy.EXPIRED_CODE,
                )))
            }
        }
    }

    fun localWipe() {
        smartNotifications.clearDelivered()
        ++realtimeGeneration
        reconnectJob?.cancel()
        clipboardExpiryJob?.cancel()
        pcStatusExpiryJob?.cancel()
        mutableState.value.app.crossDevice.ephemeralClipboard?.close()
        realtimeHandle?.close()
        realtimeHandle = null
        mutableState.update { it.copy(busy = true, safeMessage = null) }
        viewModelScope.launch {
            val wiped = repository.localWipe()
            mutableState.value = if (wiped) MobileUiState(safeMessage = "Yerel kriptografik anahtarlar ve şifreli credential kayıtları silindi; public cihaz kimliği korundu.")
            else mutableState.value.copy(busy = false, safeMessage = "Yerel secret wipe tamamlanamadı.")
        }
    }

    override fun onCleared() {
        ++realtimeGeneration
        reconnectJob?.cancel()
        pcStatusExpiryJob?.cancel()
        realtimeHandle?.close()
        repository.close()
        super.onCleared()
    }

    private companion object {
        val PC_STATUS_FRESHNESS_ERRORS = setOf(
            PcStatusFreshnessPolicy.STALE_CODE,
            PcStatusFreshnessPolicy.EXPIRED_CODE,
            PcStatusFreshnessPolicy.FUTURE_CODE,
        )
        val ADVANCED_AUTHORITY_ERRORS = setOf(
            "cross_device_envelope_verification_failed",
            "cross_device_lineage_mismatch",
            "mobile_envelope_invalid",
            "advanced_mobile_lineage_mismatch",
        )
    }
}
