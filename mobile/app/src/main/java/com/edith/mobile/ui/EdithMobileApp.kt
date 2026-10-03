package com.edith.mobile.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Computer
import androidx.compose.material.icons.outlined.Devices
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.CloudSync
import androidx.compose.material.icons.outlined.ContentPaste
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.material.icons.outlined.SwapHoriz
import androidx.compose.material.icons.outlined.UploadFile
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Link
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.StopCircle
import androidx.compose.material.icons.outlined.TaskAlt
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationRail
import androidx.compose.material3.NavigationRailItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.platform.LocalContext
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.edith.mobile.BuildConfig
import com.edith.mobile.contracts.MobileTask
import com.edith.mobile.contracts.PcStatusFreshnessPolicy
import com.edith.mobile.contracts.TrustStatus
import com.edith.mobile.domain.Availability
import com.edith.mobile.domain.ConnectionPhase
import com.edith.mobile.domain.DeliveryState
import com.edith.mobile.domain.MobileFeature
import com.edith.mobile.domain.PairingState
import com.edith.mobile.network.EndpointConfig
import com.edith.mobile.network.EndpointDecision
import com.edith.mobile.network.EndpointPolicy
import java.time.Instant

private enum class MobileRoute(val path: String, val label: String, val icon: ImageVector) {
    HOME("home", "Ana Sayfa", Icons.Outlined.Home),
    TASKS("tasks", "Görevler", Icons.Outlined.TaskAlt),
    TRANSFERS("transfers", "Handoff", Icons.Outlined.SwapHoriz),
    DEVICES("devices", "PC'ler", Icons.Outlined.Devices),
    SETTINGS("settings", "Ayarlar", Icons.Outlined.Settings),
}

@Composable
fun EdithMobileApp(viewModel: EdithViewModel = viewModel(), notificationRoute: String? = null, consumeNotificationRoute: () -> Unit = {}) {
    val ui by viewModel.state.collectAsState()
    val navController = rememberNavController()
    LaunchedEffect(notificationRoute) {
        if (notificationRoute in setOf("tasks", "transfers")) { navController.navigate(notificationRoute!!) { launchSingleTop = true }; consumeNotificationRoute() }
    }
    val currentPath = navController.currentBackStackEntryAsState().value?.destination?.route
    val route = if (currentPath?.startsWith("task/") == true) MobileRoute.TASKS else MobileRoute.entries.find { it.path == currentPath } ?: MobileRoute.HOME
    val navigate: (MobileRoute) -> Unit = remember(navController) {{ target ->
        navController.navigate(target.path) { launchSingleTop = true; restoreState = true; popUpTo(MobileRoute.HOME.path) { saveState = true } }
    }}
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val expanded = maxWidth >= 840.dp
        Row(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
            if (expanded) MobileRail(route, onRoute = navigate, Modifier.fillMaxHeight())
            Scaffold(
                topBar = { EdithTopBar(ui.app.realtime.phase, onPair = { navigate(MobileRoute.DEVICES) }) },
                bottomBar = { if (!expanded) MobileBottomBar(route, onRoute = navigate) },
                containerColor = MaterialTheme.colorScheme.background,
            ) { padding ->
                NavHost(navController, startDestination = MobileRoute.HOME.path, modifier = Modifier.padding(padding)) {
                    composable(MobileRoute.HOME.path) { HomeScreen(ui, viewModel::emergencyStop) }
                    composable(MobileRoute.TASKS.path) { TasksScreen(ui.app.tasks, onOpen = { navController.navigate("task/${it.id}") }) }
                    composable(MobileRoute.TRANSFERS.path) { CrossDeviceScreen(ui, viewModel) }
                    composable(MobileRoute.DEVICES.path) { DevicesAndPairingScreen(ui, viewModel::startPairing, viewModel::continuePairing, viewModel::selectComputer) }
                    composable(MobileRoute.SETTINGS.path) { SettingsScreen(ui, viewModel::localWipe) }
                    composable("task/{taskId}", arguments = listOf(navArgument("taskId") { type = NavType.StringType })) { entry ->
                        val task = ui.app.tasks.find { it.id == entry.arguments?.getString("taskId") }
                        if (task == null) EmptyCopy("Görev bulunamadı", "Görev revision değişmiş veya artık listede değil.")
                        else TaskDetailScreen(task, onBack = navController::popBackStack)
                    }
                }
            }
        }
    }
}

@Composable
@OptIn(ExperimentalMaterial3Api::class)
private fun EdithTopBar(phase: ConnectionPhase, onPair: () -> Unit) {
    TopAppBar(
        title = { Column { Text("E.D.I.T.H.", fontWeight = FontWeight.Bold); Text("Secure mobile companion", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurface.copy(alpha = .58f)) } },
        actions = {
            StatusChip(label = "Bağlantı", value = phase.name, available = phase == ConnectionPhase.CONNECTED)
            IconButton(onClick = onPair, modifier = Modifier.semantics { contentDescription = "Cihaz eşleştirme ekranını aç" }) { Icon(Icons.Outlined.Link, null) }
        },
    )
}

@Composable
private fun MobileRail(selected: MobileRoute, onRoute: (MobileRoute) -> Unit, modifier: Modifier = Modifier) {
    NavigationRail(modifier) { Spacer(Modifier.height(12.dp)); MobileRoute.entries.forEach { route -> NavigationRailItem(selected == route, { onRoute(route) }, { Icon(route.icon, route.label) }, label = { Text(route.label) }) } }
}

@Composable
private fun MobileBottomBar(selected: MobileRoute, onRoute: (MobileRoute) -> Unit) {
    NavigationBar { MobileRoute.entries.forEach { route -> NavigationBarItem(selected == route, { onRoute(route) }, { Icon(route.icon, route.label) }, label = { Text(route.label) }) } }
}

@Composable
private fun HomeScreen(ui: MobileUiState, onEmergencyStop: () -> Unit, modifier: Modifier = Modifier) {
    val selected = ui.app.computers.find { it.trust.deviceId == ui.app.selectedPcId }
    LazyColumn(modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item {
            SectionHeader("MOBILE COMMAND", "Gerçek capability ve V2 durumları")
            if (ui.safeMessage != null) HonestBanner(ui.safeMessage, warning = true)
        }
        item {
            CockpitCard("Seçili PC", Icons.Outlined.Computer) {
                if (selected == null) EmptyCopy("Seçili trusted PC yok", "Pairing ve owner approval tamamlanmadan uzaktan komut kullanılamaz.")
                else {
                    Text(selected.displayName, style = MaterialTheme.typography.titleMedium)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        StatusChip("Trust", selected.trust.status.name, selected.trust.status == TrustStatus.TRUSTED)
                        StatusChip("Network", selected.connection.name, selected.connection == ConnectionPhase.CONNECTED)
                    }
                }
            }
        }
        item {
            CockpitCard("Safety channel", Icons.Outlined.Lock) {
                Text("Emergency Stop", fontWeight = FontWeight.SemiBold)
                Text("Yalnız bağlı trusted PC, owner binding ve encrypted envelope ile gönderilir.", style = MaterialTheme.typography.bodySmall, color = muted())
                Button(
                    onClick = onEmergencyStop,
                    enabled = selected?.connection == ConnectionPhase.CONNECTED && ui.app.ownerBindingActive && ui.app.emergencyStop != DeliveryState.PENDING,
                    modifier = Modifier.fillMaxWidth().semantics { contentDescription = "Emergency Stop gönder" },
                ) { Icon(Icons.Outlined.StopCircle, null); Spacer(Modifier.width(8.dp)); Text(if (ui.app.emergencyStop == DeliveryState.PENDING) "Teslim doğrulanıyor" else "Emergency Stop") }
                Text("Durum: ${ui.app.emergencyStop.name}", style = MaterialTheme.typography.labelSmall)
            }
        }
        item { Text("Quick actions", style = MaterialTheme.typography.titleMedium) }
        items(ui.app.features, key = MobileFeature::id) { FeatureRow(it) }
        item {
            CockpitCard("Görev özeti", Icons.Outlined.TaskAlt) {
                if (ui.app.tasks.isEmpty()) EmptyCopy("Görev verisi yok", "Backend V2 task verisi geldiğinde burada görünür. İlerleme simüle edilmez.")
                else Text("${ui.app.tasks.size} canonical görev")
            }
        }
    }
}

@Composable
private fun TasksScreen(tasks: List<MobileTask>, onOpen: (MobileTask) -> Unit, modifier: Modifier = Modifier) {
    LazyColumn(modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item { SectionHeader("TASKS", "Canonical V2 progress ve result cards") }
        if (tasks.isEmpty()) item { CockpitCard("Görev geçmişi", Icons.Outlined.TaskAlt) { EmptyCopy("Henüz görev yok", "Bağlı PC gerçek görev geçmişi bildirmedi.") } }
        items(tasks, key = MobileTask::id) { task ->
            Card(onClick = { onOpen(task) }, colors = panelColors(), modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) { Text(task.title, fontWeight = FontWeight.SemiBold); Text(task.status.name, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary) }
                    LinearProgressIndicator(progress = { task.progress.percent / 100f }, modifier = Modifier.fillMaxWidth().semantics { contentDescription = "Görev ilerlemesi yüzde ${task.progress.percent}" })
                    Text("${task.progress.percent}% · rev ${task.revision} · ${task.progress.sources.joinToString()}", style = MaterialTheme.typography.labelSmall, color = muted())
                }
            }
        }
    }
}

@Composable
private fun TaskDetailScreen(task: MobileTask, onBack: () -> Unit, modifier: Modifier = Modifier) {
    Column(modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        OutlinedButton(onClick = onBack) { Text("Görev listesine dön") }
        SectionHeader(task.title, task.status.name)
        CockpitCard("Progress", Icons.Outlined.TaskAlt) {
            LinearProgressIndicator(progress = { task.progress.percent / 100f }, modifier = Modifier.fillMaxWidth())
            Text("${task.progress.completedSteps}/${task.progress.totalSteps} adım · ${task.progress.percent}%")
            Text("Kaynak: ${task.progress.sources.joinToString()}", style = MaterialTheme.typography.bodySmall, color = muted())
        }
        CockpitCard("Result", Icons.Outlined.TaskAlt) { EmptyCopy(task.result ?: "Result card yok", task.failureReason ?: "Backend henüz doğrulanmış result card sağlamadı.") }
        CockpitCard("Timeline", Icons.Outlined.Refresh) { EmptyCopy("Timeline bekleniyor", "Sıralı V2.1 event stream geldiğinde sequence/cursor ile gösterilir.") }
    }
}

@Composable
private fun CrossDeviceScreen(ui: MobileUiState, viewModel: EdithViewModel, modifier: Modifier = Modifier) {
    val cross = ui.app.crossDevice
    val capabilities = cross.capabilities
    var clipboardDraft by remember(ui.pairing) { mutableStateOf("") }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri -> uri?.let(viewModel::upload) }
    LazyColumn(modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item {
            SectionHeader("CROSS-DEVICE HANDOFF", "Encrypted, owner-bound and fail-closed")
            ui.safeMessage?.let { HonestBanner(it, warning = true) }
        }
        item {
            CockpitCard("Capability truth", Icons.Outlined.CloudSync) {
                if (capabilities == null) EmptyCopy("Capability handshake bekleniyor", "Trusted PC bağlandıktan sonra backend gerçek durumları bildirir.")
                else {
                    CapabilityLine("Clipboard", capabilities.clipboard)
                    CapabilityLine("Offline queue", capabilities.offlineQueue)
                    CapabilityLine("Smart handoff", capabilities.smartHandoff)
                    CapabilityLine("Result cards", capabilities.resultCards)
                    CapabilityLine("Audio handoff", capabilities.audioHandoff)
                    CapabilityLine("Mobile → PC file", capabilities.mobileToPcTransfer)
                    CapabilityLine("PC → mobile file", capabilities.pcToMobileTransfer)
                }
                OutlinedButton(onClick = viewModel::refreshCrossDevice, enabled = !cross.loading, modifier = Modifier.fillMaxWidth()) {
                    Icon(Icons.Outlined.Refresh, null); Spacer(Modifier.width(8.dp)); Text(if (cross.loading) "Durum alınıyor" else "Durumu yenile")
                }
            }
        }
        item {
            CockpitCard("Ephemeral clipboard", Icons.Outlined.ContentPaste) {
                OutlinedTextField(
                    value = clipboardDraft,
                    onValueChange = { clipboardDraft = it.take(65_536) },
                    label = { Text("PC'ye tek kullanımlık metin") },
                    supportingText = { Text("Diske veya geçmişe kaydedilmez. Secret benzeri içerik reddedilir.") },
                    keyboardOptions = KeyboardOptions(autoCorrectEnabled = false),
                    enabled = capabilities?.clipboard == "available",
                    modifier = Modifier.fillMaxWidth(),
                )
                Button(
                    onClick = { viewModel.publishClipboard(clipboardDraft) { clipboardDraft = "" } },
                    enabled = capabilities?.clipboard == "available" && clipboardDraft.isNotBlank(),
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("Açık onayla yayınla") }
                cross.clipboardItems.filter { it.direction == "pc_to_mobile" && it.status == "available" }.forEach { item ->
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                        Text("PC clipboard · ${item.contentBytes} byte", style = MaterialTheme.typography.bodySmall)
                        OutlinedButton(onClick = { viewModel.consumeClipboard(item.clipboardId) }) { Text("Bir kez al") }
                    }
                }
                cross.ephemeralClipboard?.let { value ->
                    HonestBanner("Geçici içerik alındı: ${value.redactedPreview}. En geç 60 saniyede bellekten temizlenir.", warning = false)
                    OutlinedButton(onClick = viewModel::clearClipboard, modifier = Modifier.fillMaxWidth()) { Text("Şimdi temizle") }
                }
            }
        }
        item {
            CockpitCard("Mobile → PC transfer", Icons.Outlined.UploadFile) {
                Text("Android system picker kullanılır. En fazla 25 MiB; hedef opaque handle ile ve overwrite kapalıdır.", style = MaterialTheme.typography.bodySmall, color = muted())
                Button(onClick = { picker.launch(arrayOf("application/pdf", "image/*", "text/*", "application/octet-stream")) }, enabled = capabilities?.mobileToPcTransfer == "available", modifier = Modifier.fillMaxWidth()) {
                    Text("Dosya seç ve doğrulanmış aktarımı başlat")
                }
            }
        }
        if (cross.transfers.isEmpty()) item { CockpitCard("Transfer durumu", Icons.Outlined.Folder) { EmptyCopy("Transfer yok", "Dosya seçilmedi; ilerleme veya başarı simüle edilmez.") } }
        items(cross.transfers, key = { it.transferId }) { transfer ->
            CockpitCard(transfer.fileName, Icons.Outlined.Folder) {
                Text("${transfer.status.uppercase()} · ${transfer.direction.uppercase()}")
                LinearProgressIndicator(progress = { (transfer.progress.percent / 100.0).toFloat() }, modifier = Modifier.fillMaxWidth().semantics { contentDescription = "Transfer ilerlemesi yüzde ${transfer.progress.percent}" })
                Text("${transfer.progress.bytesTransferred}/${transfer.sizeBytes} byte · integrity ${transfer.progress.integrity}", style = MaterialTheme.typography.labelSmall)
                Text("Hedef: ${transfer.destination.displaySummary} · collision policy ${transfer.destination.conflictPolicy}", style = MaterialTheme.typography.bodySmall, color = muted())
            }
        }
        item {
            CockpitCard("Offline command queue", Icons.Outlined.TaskAlt) {
                Text("Emergency Stop bu kuyruğa hiçbir zaman alınmaz. Dispatch ACK, görev başarısı değildir.", style = MaterialTheme.typography.bodySmall, color = muted())
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = viewModel::enqueueTaskRefresh, enabled = capabilities?.offlineQueue == "available") { Text("Task refresh sırala") }
                    OutlinedButton(onClick = viewModel::dispatchQueue, enabled = cross.queue.any { it.status == "pending" }) { Text("Dispatch") }
                }
                cross.queue.forEach { item ->
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) { Text(item.command.command); Text(item.status.uppercase(), style = MaterialTheme.typography.labelSmall, color = muted()) }
                        if (item.status == "pending") OutlinedButton(onClick = { viewModel.cancelQueue(item.queueItemId) }) { Text("İptal") }
                    }
                }
                if (cross.queue.isEmpty()) EmptyCopy("Kuyruk boş", "Düşük riskli komutlar açık onayla sıraya alınabilir.")
            }
        }
        item {
            CockpitCard("Smart handoff", Icons.Outlined.SwapHoriz) {
                ui.app.tasks.firstOrNull()?.let { task ->
                    OutlinedButton(onClick = { viewModel.handoffTask(task.id) }, enabled = capabilities?.smartHandoff == "available", modifier = Modifier.fillMaxWidth()) { Text("${task.title} görevini PC'ye devret") }
                } ?: EmptyCopy("Devredilecek görev yok", "Handoff, task/result/artifact kimliğini korur.")
                cross.handoffs.forEach { handoff ->
                    Column { Text("${handoff.direction} · ${handoff.status}"); Text(handoff.taskId ?: handoff.resultId ?: handoff.artifactIds.joinToString(), style = MaterialTheme.typography.bodySmall, color = muted()) }
                    if (handoff.direction == "desktop_to_mobile" && handoff.status == "requested") OutlinedButton(onClick = { viewModel.acknowledgeHandoff(handoff.handoffId) }) { Text("Kimliği koruyarak kabul et") }
                }
            }
        }
        item {
            CockpitCard("Shared result cards", Icons.Outlined.TaskAlt) {
                if (cross.resultCards.isEmpty()) EmptyCopy("Result card yok", "Backend doğrulanmış paylaşım kartı bildirmedi.")
                cross.resultCards.forEach { card ->
                    Text(card.title, fontWeight = FontWeight.SemiBold)
                    Text(card.summary, style = MaterialTheme.typography.bodySmall)
                    Text("${card.outcome} · rev ${card.revision} · provenance ${if (card.provenance.verified) "verified" else "unverified"}", style = MaterialTheme.typography.labelSmall, color = muted())
                    card.actions.filter { it.available }.forEach { action -> Text("${action.action}${if (action.requiresApproval) " · approval required" else ""}", style = MaterialTheme.typography.labelSmall) }
                }
            }
        }
        item {
            CockpitCard("Audio capture lease", Icons.Outlined.Mic) {
                val lease = cross.audioLease
                if (lease == null) EmptyCopy("Aktif audio lease yok", "Ses byte'ları aktarılmış gibi gösterilmez; yalnız capture ownership lease yönetilir.")
                else Text("${lease.status.uppercase()} · epoch ${lease.epoch} · simultaneous capture OFF")
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = viewModel::requestAudio, enabled = capabilities?.audioHandoff == "available" && lease == null) { Text("Lease iste") }
                    if (lease?.status == "requested" && lease.targetCaptureDeviceId == ui.app.selectedPcId) OutlinedButton(onClick = viewModel::acknowledgeAudio) { Text("Kabul et") }
                    if (lease != null) OutlinedButton(onClick = viewModel::releaseAudio) { Text("Bırak") }
                }
            }
        }
        item {
            CockpitCard("Metadata-only & unavailable surfaces", Icons.Outlined.Lock) {
                CapabilityLine("Quiet hours", capabilities?.quietHours ?: "waiting")
                CapabilityLine("Live view", capabilities?.liveView ?: "waiting")
                CapabilityLine("Wake-on-LAN", capabilities?.wakeOnLan ?: "waiting")
                CapabilityLine("PC status", capabilities?.pcStatus ?: "waiting")
                Text("Quiet hours bu istemcide yalnız revision metadata olarak izlenir. Live view, WOL ve PC status backend configuration_required bildirirse kontrol sunulmaz.", style = MaterialTheme.typography.bodySmall, color = muted())
                val pcStatus = cross.pcStatus
                when {
                    pcStatus != null && PcStatusFreshnessPolicy.isFresh(pcStatus, Instant.now()) -> Text(
                        "PC runtime: ${pcStatus.runtime} · ${pcStatus.observedAt}",
                        style = MaterialTheme.typography.bodySmall,
                    )
                    cross.safeErrorCode in PC_STATUS_FRESHNESS_ERRORS -> HonestBanner(
                        "PC status stale/unavailable · live metrics hidden (${cross.safeErrorCode})",
                        true,
                    )
                    else -> EmptyCopy("PC status unavailable", "Fresh PC telemetry has not been received.")
                }
            }
        }
        item {
            CockpitCard("Advanced status · read only", Icons.Outlined.CloudSync) {
                val advanced = ui.app.advanced
                if (advanced == null) {
                    EmptyCopy("Advanced state unavailable", ui.app.advancedErrorCode ?: "Encrypted device-scoped projection has not been received.")
                } else {
                    StatusChip("Persistence", advanced.status.persistence, false)
                    StatusChip("Restart recovery", advanced.status.restartRecovery, false)
                    StatusChip("Mutation", if (advanced.mutationAvailable) "unexpected" else "read only", !advanced.mutationAvailable)
                    Text("Priority", style = MaterialTheme.typography.labelMedium, color = muted())
                    if (advanced.state.priority.isEmpty()) Text("No priority policy", style = MaterialTheme.typography.bodySmall, color = muted())
                    advanced.state.priority.take(4).forEach { policy ->
                        Text("${policy.taskId} · ${policy.priority} · ${if (policy.blockedByDependencies) "dependency blocked" else "dependency metadata clear"}", style = MaterialTheme.typography.bodySmall)
                    }
                    Text("Ghost tasks", style = MaterialTheme.typography.labelMedium, color = muted())
                    if (advanced.state.ghosts.isEmpty()) Text("No Ghost metadata", style = MaterialTheme.typography.bodySmall, color = muted())
                    advanced.state.ghosts.take(4).forEach { ghost ->
                        Text("${ghost.taskId} · ${if (ghost.status == "configuration_required") "PARTIAL METADATA" else ghost.status.uppercase()} · native ${ghost.nativeExecution}", style = MaterialTheme.typography.bodySmall)
                    }
                    Text("Watchers / downloads", style = MaterialTheme.typography.labelMedium, color = muted())
                    advanced.state.watchers.take(3).forEach { watcher -> Text("${watcher.kind}/${watcher.trigger} · ${watcher.status}", style = MaterialTheme.typography.bodySmall) }
                    advanced.state.downloads.filter { it.expiresAt?.let { expiry -> runCatching { Instant.parse(expiry).isAfter(Instant.now()) }.getOrDefault(false) } != false }.take(3).forEach { download ->
                        Text("${download.displayName} · ${download.bytesTransferred}/${download.bytesTotal} bytes · ETA ${if (download.etaTrustworthy) download.etaSeconds?.let { "$it s" } ?: "unavailable" else "untrusted"}", style = MaterialTheme.typography.bodySmall)
                    }
                    val communication = advanced.state.communication.maxByOrNull { it.revision }
                    Text("Communication · ${communication?.let { if (it.autoBrief.enabled) "brief ${it.autoBrief.maxSentences} sentences" else "brief off" } ?: "not configured"} · actual-state voice only", style = MaterialTheme.typography.bodySmall, color = muted())
                    val capsule = advanced.state.capsuleSelection.filter { runCatching { Instant.parse(it.selected.expiresAt).isAfter(Instant.now()) }.getOrDefault(false) }.maxByOrNull { it.revision }
                    Text("Capsule · ${capsule?.let { "rank ${it.deterministicRank}/5 · ${it.selected.safeLabel}" } ?: "no fresh selection"}", style = MaterialTheme.typography.bodySmall, color = muted())
                    Text("No remote mutation controls are enabled on Android.", style = MaterialTheme.typography.labelSmall, color = muted())
                }
            }
        }
    }
}

private val PC_STATUS_FRESHNESS_ERRORS = setOf(
    PcStatusFreshnessPolicy.STALE_CODE,
    PcStatusFreshnessPolicy.EXPIRED_CODE,
    PcStatusFreshnessPolicy.FUTURE_CODE,
    "pc_status_observed_at_stale",
    "pc_status_revision_stale",
)

@Composable
private fun CapabilityLine(label: String, status: String) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, style = MaterialTheme.typography.bodySmall)
        Text(status.replace('_', ' ').uppercase(), style = MaterialTheme.typography.labelSmall, color = if (status == "available") MaterialTheme.colorScheme.primary else muted())
    }
}

@Composable
private fun DevicesAndPairingScreen(
    ui: MobileUiState,
    onStartPairing: () -> Unit,
    onContinuePairing: () -> Unit,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    LazyColumn(modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { SectionHeader("PAIRING", "One-time challenge ve owner approval") }
        item {
            CockpitCard("Yeni PC eşleştir", Icons.Outlined.Link) {
                Button(
                    onClick = onStartPairing,
                    enabled = !ui.busy && ui.pairing !is PairingState.AwaitingOwner,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    if (ui.busy) CircularProgressIndicator(Modifier.width(18.dp), strokeWidth = 2.dp) else Icon(Icons.Outlined.Link, null)
                    Spacer(Modifier.width(8.dp)); Text("Güvenli eşleştirmeyi başlat")
                }
                PairingStateCopy(ui.pairing)
                if (ui.pairing is PairingState.AwaitingOwner) {
                    OutlinedButton(onClick = onContinuePairing, enabled = !ui.busy, modifier = Modifier.fillMaxWidth()) {
                        Icon(Icons.Outlined.Refresh, null)
                        Spacer(Modifier.width(8.dp))
                        Text("Owner approval durumunu yenile")
                    }
                }
            }
        }
        item { Text("Trusted computers", style = MaterialTheme.typography.titleMedium) }
        if (ui.app.computers.isEmpty()) item { EmptyCopy("Eşlenmiş PC yok", "Owner approval tamamlanan cihazlar burada görünür.") }
        items(ui.app.computers, key = { it.trust.deviceId }) { pc ->
            Card(onClick = { onSelect(pc.trust.deviceId) }, enabled = pc.trust.status == TrustStatus.TRUSTED, colors = panelColors(), modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(14.dp)) { Text(pc.displayName, fontWeight = FontWeight.SemiBold); Text("${pc.trust.status.name} · ${pc.connection.name}", style = MaterialTheme.typography.bodySmall, color = muted()) }
            }
        }
    }
}

@Composable
private fun SettingsScreen(ui: MobileUiState, onWipe: () -> Unit, modifier: Modifier = Modifier) {
    val endpointDecision = remember {
        EndpointPolicy.validate(
            EndpointConfig(
                apiBaseUrl = BuildConfig.API_BASE_URL,
                realtimeUrl = BuildConfig.REALTIME_URL,
                certificatePins = BuildConfig.CERTIFICATE_PINS.split(',').map(String::trim).filter(String::isNotEmpty),
                debugBuild = BuildConfig.DEBUG,
            ),
        )
    }
    val transportReady = endpointDecision is EndpointDecision.Allowed
    val transportDetail = (endpointDecision as? EndpointDecision.Blocked)?.reasonCode ?: "POLICY VALID"
    Column(modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        SectionHeader("SECURITY & PRIVACY", "Minimum permission, no plaintext secrets")
        CockpitCard("Endpoint configuration", Icons.Outlined.Lock) {
            StatusChip("Transport policy", if (transportReady) "VALID" else "CONFIGURATION REQUIRED", transportReady)
            Text("Policy: $transportDetail", style = MaterialTheme.typography.bodySmall, color = muted())
            Text("Endpoint ve pin değerleri build config üzerinden sağlanır; secret/token gösterilmez.", style = MaterialTheme.typography.bodySmall, color = muted())
        }
        SmartNotificationSettings()
        CockpitCard("Local cryptographic credentials", Icons.Outlined.Devices) {
            Text("Pairing: ${ui.pairing::class.simpleName}")
            OutlinedButton(onClick = onWipe, enabled = !ui.busy, modifier = Modifier.fillMaxWidth()) { Text("Kriptografik anahtarları ve credential kayıtlarını sil") }
            Text("Public cihaz kimliği bu yerel güvenlik temizliğinde korunur.", style = MaterialTheme.typography.bodySmall, color = muted())
        }
    }
}

@Composable
private fun SmartNotificationSettings() {
    val context = LocalContext.current
    val notifications = remember(context) { com.edith.mobile.notifications.SmartNotifications(context) }
    var enabled by remember { mutableStateOf(notifications.enabled) }
    var granted by remember { mutableStateOf(notifications.permissionGranted) }
    var quiet by remember { mutableStateOf(notifications.quietEnabled) }
    var privacy by remember { mutableStateOf(notifications.privatePreview) }
    val request = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { allowed ->
        granted = allowed && notifications.permissionGranted; enabled = granted; notifications.enabled = granted
    }
    CockpitCard("Akıllı bildirimler", Icons.Outlined.Settings) {
        Text("Bağlı oturumdaki görev ve dosya aktarımı sonuçları", style = MaterialTheme.typography.titleSmall)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text("Telefon bildirimleri")
            Switch(enabled && granted, onCheckedChange = { value ->
                if (!value) { enabled = false; notifications.enabled = false }
                else if (notifications.permissionGranted) { granted = true; enabled = true; notifications.enabled = true }
                else request.launch(android.Manifest.permission.POST_NOTIFICATIONS)
            })
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text("Sessiz saatler · 22:00–08:00")
            Switch(quiet, { quiet = it; notifications.quietEnabled = it })
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text("Bildirim önizlemesini gizle")
            Switch(privacy, { privacy = it; notifications.privatePreview = it })
        }
        Text("Yalnız doğrulanmış yeni sonuçlar bildirilir; tekrarlar ve eski olaylar sessizce atlanır. Bildirim açıldığında ilgili bölüme götürür.", style = MaterialTheme.typography.bodySmall, color = muted())
        Text("Arka plan push sağlayıcısı henüz bağlı değil. Uygulama kapalıyken teslim garanti edilmez; polling veya sahte başarı yok. Minik bot bağlantısı sonraki aşamada.", style = MaterialTheme.typography.bodySmall, color = muted())
    }
}

@Composable
private fun PairingStateCopy(state: PairingState) {
    when (state) {
        PairingState.Unpaired -> EmptyCopy("Eşleştirme başlatılmadı", "P-256 cihaz anahtarları Android Keystore içinde üretilir.")
        is PairingState.ConfigurationRequired -> { HonestBanner("Pairing gönderilmedi: ${state.reason}", true); Text("Public fingerprint: ${state.fingerprint.chunked(8).joinToString(":")}", style = MaterialTheme.typography.labelSmall) }
        is PairingState.LocalIdentityReady -> Text("Public fingerprint hazır: ${state.fingerprint}")
        is PairingState.AwaitingOwner -> {
            HonestBanner("Owner approval bekleniyor · ${state.expiresAt}", true)
            state.ownerVerificationCode?.let { code ->
                Text("PC doğrulama kodu", style = MaterialTheme.typography.labelMedium, color = muted())
                Text(code, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
                Text("Bu kodu yalnız E.D.I.T.H. owner approval ekranında doğrulayın.", style = MaterialTheme.typography.bodySmall, color = muted())
            }
        }
        is PairingState.Trusted -> HonestBanner("Trusted · ${state.deviceId}", false)
        is PairingState.Rejected -> HonestBanner("Rejected · ${state.reasonCode}", true)
        PairingState.Expired -> HonestBanner("Pairing expired", true)
        PairingState.Revoked -> HonestBanner("Device revoked", true)
        is PairingState.Failed -> HonestBanner("Pairing failed · ${state.safeErrorCode}", true)
    }
}

@Composable
private fun FeatureRow(feature: MobileFeature) {
    Card(colors = panelColors(), modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Icon(Icons.Outlined.Lock, null, tint = if (feature.availability == Availability.AVAILABLE) MaterialTheme.colorScheme.primary else muted())
            Column(Modifier.weight(1f)) { Text(feature.label, fontWeight = FontWeight.Medium); Text(feature.reason, style = MaterialTheme.typography.bodySmall, color = muted()) }
            Text(feature.availability.name.replace('_', ' '), style = MaterialTheme.typography.labelSmall, color = if (feature.availability == Availability.AVAILABLE) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error)
        }
    }
}

@Composable
private fun CockpitCard(title: String, icon: ImageVector, content: @Composable ColumnScope.() -> Unit) {
    Card(colors = panelColors(), modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) { Icon(icon, null, tint = MaterialTheme.colorScheme.primary); Spacer(Modifier.width(8.dp)); Text(title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold) }
            HorizontalDivider(color = MaterialTheme.colorScheme.onSurface.copy(alpha = .08f))
            content()
        }
    }
}

@Composable private fun SectionHeader(title: String, subtitle: String) { Column { Text(title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold); Text(subtitle, style = MaterialTheme.typography.bodySmall, color = muted()) } }
@Composable private fun EmptyCopy(title: String, detail: String) { Column(Modifier.fillMaxWidth().padding(vertical = 8.dp), horizontalAlignment = Alignment.CenterHorizontally) { Text(title, fontWeight = FontWeight.Medium); Text(detail, style = MaterialTheme.typography.bodySmall, color = muted()) } }
@Composable private fun HonestBanner(text: String, warning: Boolean) { Surface(color = (if (warning) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary).copy(alpha = .1f), modifier = Modifier.fillMaxWidth()) { Text(text, Modifier.padding(10.dp), style = MaterialTheme.typography.bodySmall) } }
@Composable private fun StatusChip(label: String, value: String, available: Boolean) { AssistChip(onClick = {}, enabled = false, label = { Text("$label · $value") }, leadingIcon = { Box(Modifier.width(6.dp).height(6.dp).background(if (available) Color(0xFF34D399) else Color(0xFFFBBF24))) }) }
@Composable private fun muted() = MaterialTheme.colorScheme.onSurface.copy(alpha = .58f)
@Composable private fun panelColors() = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = .72f))
