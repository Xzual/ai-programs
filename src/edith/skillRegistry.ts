import fs from 'node:fs';
import path from 'node:path';
import type { ProviderHealth } from '../../server/providers/types';
import { providerRegistry } from '../../server/providers/registry';
import { voiceSessionManager } from '../../server/voice/voiceSessionManager';
import { computerUseStatus } from '../../server/routes/computerUse';
import { cryptoService, type CryptoAgentStatus } from './cryptoService';
import { edithToolRegistry } from './serverRegistry';
import { obsidianVaultService, type ObsidianStatus } from './obsidianVaultService';
import { workspaceManager, type WorkspaceStatus } from './workspaceManager';

export const EDITH_SKILL_STATUSES = [
  'ready', 'disabled', 'config_required', 'offline', 'broken', 'planned', 'unavailable', 'degraded',
] as const;
export type SkillStatus = typeof EDITH_SKILL_STATUSES[number];

export const EDITH_SKILL_RISKS = ['low', 'medium', 'high', 'critical'] as const;
export type SkillRisk = typeof EDITH_SKILL_RISKS[number];

export type SkillReadinessLevel = 'operational' | 'limited' | 'installed' | 'setup_required' | 'planned' | 'unavailable';

export type EdithSkillId =
  | 'gemini_text_chat'
  | 'voice_room'
  | 'computer_use'
  | 'crypto_demo_exchange'
  | 'jev_decision_model'
  | 'obsidian_memory'
  | 'supabase_registry'
  | 'workspace_manager'
  | 'skill_store'
  | 'file_organizer'
  | 'browser_research'
  | 'system_status'
  | 'control_center'
  | 'release_builder';

export interface SkillReadiness {
  level: SkillReadinessLevel;
  ready: boolean;
  reason: string;
}

export interface EdithSkill {
  id: EdithSkillId;
  name: string;
  category: string;
  description: string;
  status: SkillStatus;
  readiness: SkillReadiness;
  capabilities: string[];
  limitations: string[];
  requiredPermissions: string[];
  requiredConfig: string[];
  relatedEndpoints: string[];
  relatedScreens: string[];
  riskLevel: SkillRisk;
  safetyNotes: string[];
  examples: string[];
  lastChecked: string;
  sourceOfTruth: string[];
  details?: Record<string, string | number | boolean>;
}

export interface SkillRegistrySnapshot {
  checkedAt: string;
  skills: EdithSkill[];
  counts: Record<SkillStatus, number>;
}

export interface CapabilitySummary {
  checkedAt: string;
  ready: EdithSkillId[];
  degraded: EdithSkillId[];
  configRequired: EdithSkillId[];
  offline: EdithSkillId[];
  disabled: EdithSkillId[];
  broken: EdithSkillId[];
  planned: EdithSkillId[];
  unavailable: EdithSkillId[];
  limitations: Partial<Record<EdithSkillId, string[]>>;
}

type JsonRecord = Record<string, unknown>;
type ComputerStatus = ReturnType<typeof computerUseStatus>;

export interface SkillRegistrySources {
  checkedAt: string;
  gemini?: ProviderHealth;
  voice: ReturnType<typeof voiceSessionManager.status>;
  computer: ComputerStatus;
  cryptoAgent: CryptoAgentStatus;
  cryptoStatus?: JsonRecord;
  jevStatus?: JsonRecord;
  obsidian: ObsidianStatus;
  workspace: WorkspaceStatus;
  applicationPath: string;
  toolIds: Set<string>;
  releaseArtifactsPresent: boolean;
}

const CACHE_MS = 5_000;
let cachedSnapshot: { expiresAt: number; value: SkillRegistrySnapshot } | undefined;
let activeRead: Promise<SkillRegistrySnapshot> | undefined;

function record(value: unknown): JsonRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : undefined;
}

function textValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function readiness(status: SkillStatus, reason: string): SkillReadiness {
  const level: SkillReadinessLevel = status === 'ready'
    ? 'operational'
    : status === 'degraded'
      ? 'limited'
      : status === 'offline' || status === 'disabled'
        ? 'installed'
        : status === 'config_required'
          ? 'setup_required'
          : status === 'planned'
            ? 'planned'
            : 'unavailable';
  return { level, ready: status === 'ready', reason };
}

function skill(checkedAt: string, value: Omit<EdithSkill, 'lastChecked' | 'readiness'> & { readinessReason: string }): EdithSkill {
  const { readinessReason, ...rest } = value;
  return { ...rest, readiness: readiness(value.status, readinessReason), lastChecked: checkedAt };
}

function geminiStatus(health?: ProviderHealth): SkillStatus {
  if (!health?.configured || health.status === 'configuration_required') return 'config_required';
  if (health.available && health.healthy && health.modelAvailable) return 'ready';
  if (health.status === 'invalid_api_key' || health.errorCode === 'invalid_api_key') return 'broken';
  if (health.status === 'offline' || health.errorCode === 'network_error') return 'offline';
  return 'degraded';
}

function voiceStatus(value: ReturnType<typeof voiceSessionManager.status>): SkillStatus {
  if (!value.configured || value.runtimeStatus === 'configuration_required') return 'config_required';
  if (value.runtimeStatus === 'connected') return 'ready';
  if (value.runtimeStatus === 'error') return 'broken';
  return 'offline';
}

export function mapComputerUseSkillStatus(value: Pick<ComputerStatus, 'status'>): SkillStatus {
  if (value.status === 'ready') return 'ready';
  if (value.status === 'blocked') return 'disabled';
  return 'config_required';
}

export function mapCryptoDemoSkillStatus(agent: Pick<CryptoAgentStatus, 'healthy' | 'managedProcessRunning' | 'scriptPath'>, value?: JsonRecord): SkillStatus {
  if (!agent.healthy) {
    if (agent.managedProcessRunning) return 'degraded';
    return fs.existsSync(agent.scriptPath) ? 'offline' : 'config_required';
  }
  if (!value) return 'degraded';
  const portfolio = record(value.portfolio);
  const safeDemo = value.demoMode === true
    && value.demoTradingEnabled === true
    && value.realMoneyUsed === false
    && value.liveExecutionEnabled === false
    && value.realOrderEndpointsAvailable === false
    && numberValue(value.demoInitialBalance) === 10_000
    && numberValue(portfolio?.initialBalance) === 10_000;
  return safeDemo ? 'ready' : 'degraded';
}

export function mapJevSkillStatus(value: JsonRecord | undefined, configuredInEnvironment: boolean, cryptoOnline: boolean): SkillStatus {
  if (!configuredInEnvironment && !value?.configured) return 'config_required';
  if (!cryptoOnline && !value) return 'offline';
  if (value?.available === true || value?.status === 'ready') return 'ready';
  if (value?.available === false || value?.status === 'error' || value?.status === 'broken') return 'broken';
  if (value?.configured === true) return 'degraded';
  return 'config_required';
}

function obsidianSkillStatus(value: ObsidianStatus): SkillStatus {
  if (!value.obsidianEnabled) return 'disabled';
  if (!value.vaultExists) return 'config_required';
  if (!value.readable || value.connectionStatus === 'read_failed') return 'broken';
  if (!value.writable || value.connectionStatus === 'write_failed' || value.connectionStatus === 'partial') return 'degraded';
  return 'ready';
}

async function readJson(url: string, timeoutMs = 1_500): Promise<JsonRecord | undefined> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return undefined;
    return record(await response.json());
  } catch {
    return undefined;
  }
}

async function collectSources(): Promise<SkillRegistrySources> {
  const checkedAt = new Date().toISOString();
  const [gemini, cryptoAgent] = await Promise.all([
    providerRegistry.get('gemini')?.healthCheck({ timeoutMs: 2_500 }).catch(() => undefined),
    cryptoService.status(),
  ]);
  const [cryptoStatus, jevStatus] = cryptoAgent.healthy
    ? await Promise.all([
      readJson(`${cryptoAgent.dashboardUrl}/api/crypto/status`),
      readJson(`${cryptoAgent.dashboardUrl}/api/crypto/jev/status`),
    ])
    : [undefined, undefined];
  const applicationPath = process.cwd();
  const releaseArtifactsPresent = ['bundle', 'msi', 'nsis'].some((name) =>
    fs.existsSync(path.join(applicationPath, 'src-tauri', 'target', 'release', name))
  );
  return {
    checkedAt,
    gemini,
    voice: voiceSessionManager.status(),
    computer: computerUseStatus(),
    cryptoAgent,
    cryptoStatus,
    jevStatus,
    obsidian: obsidianVaultService.status(),
    workspace: workspaceManager.status(),
    applicationPath,
    toolIds: new Set(edithToolRegistry.list().map((tool) => tool.id)),
    releaseArtifactsPresent,
  };
}

export function buildSkillRegistry(sources: SkillRegistrySources): SkillRegistrySnapshot {
  const { checkedAt, gemini, voice, computer, cryptoAgent, cryptoStatus, jevStatus, obsidian, workspace, toolIds } = sources;
  const geminiState = geminiStatus(gemini);
  const voiceState = voiceStatus(voice);
  const computerState = mapComputerUseSkillStatus(computer);
  const cryptoState = mapCryptoDemoSkillStatus(cryptoAgent, cryptoStatus);
  const jevConfigured = Boolean(process.env.JEV_API_KEY?.trim());
  const jevState = mapJevSkillStatus(jevStatus, jevConfigured, cryptoAgent.healthy);
  const obsidianState = obsidianSkillStatus(obsidian);
  const browserRegistered = toolIds.has('browser_search');
  const systemRegistered = toolIds.has('system_monitor');
  const cryptoFeatures = record(cryptoStatus?.features);
  const cryptoBinance = record(cryptoStatus?.binance);
  const portfolio = record(cryptoStatus?.portfolio);

  const skills: EdithSkill[] = [
    skill(checkedAt, {
      id: 'gemini_text_chat', name: 'Gemini Text Chat', category: 'assistant',
      description: 'Gemini üzerinden akışlı metin sohbeti.', status: geminiState, riskLevel: 'low',
      readinessReason: geminiState === 'ready' ? 'Provider and requested model passed health checks.' : `Provider state is ${gemini?.status ?? 'not configured'}.`,
      capabilities: ['text chat', 'streaming responses', 'model selection'],
      limitations: geminiState === 'ready' ? [] : [`Canlı sağlayıcı durumu: ${gemini?.status ?? 'configuration_required'}.`],
      requiredPermissions: ['network:read'], requiredConfig: gemini?.configured ? [] : ['GEMINI_API_KEY'],
      relatedEndpoints: ['/api/chat', '/api/providers/health', '/api/models'], relatedScreens: ['chat', 'settings/models'],
      safetyNotes: ['API anahtarı yalnızca backend ortamından okunur ve registry çıktısına eklenmez.'],
      examples: ['Gemini ile sohbet et', 'Bu metni Gemini ile özetle'],
      sourceOfTruth: ['/api/providers/health', '/api/models', 'server/providers/gemini.ts'],
      details: { model: gemini?.defaultModel ?? 'gemini-3.6-flash', providerStatus: gemini?.status ?? 'configuration_required' },
    }),
    skill(checkedAt, {
      id: 'voice_room', name: 'Voice Room / Gemini Live', category: 'voice',
      description: 'Gemini Live tabanlı gerçek zamanlı ses odası.', status: voiceState, riskLevel: 'medium',
      readinessReason: voiceState === 'ready' ? 'A Gemini Live session completed setup.' : voice.safeMessage,
      capabilities: ['start live session', 'send audio', 'receive audio', 'user transcript events', 'assistant transcript events', 'interrupt', 'stop session'],
      limitations: ['Wake word etkin değil.', ...(voice.connected ? [] : ['Aktif Gemini Live oturumu yok.'])],
      requiredPermissions: ['microphone:read'], requiredConfig: voice.configured ? [] : ['GEMINI_API_KEY'],
      relatedEndpoints: ['/api/voice/live/status', '/api/voice/live/ws'], relatedScreens: ['voice'],
      safetyNotes: ['Mikrofon tarayıcı/Tauri kullanıcı iznine bağlıdır.', 'Açık WebSocket tek başına hazır Gemini Live oturumu sayılmaz.'],
      examples: ['Voice Room aç', 'Ses sistemi hazır mı?'],
      sourceOfTruth: ['/api/voice/live/status', 'server/voice/voiceSessionManager.ts'],
      details: { model: voice.model, connected: voice.connected, connectorBound: voice.liveConnectorBound },
    }),
    skill(checkedAt, {
      id: 'computer_use', name: 'Computer Use / Desktop Operator', category: 'computer',
      description: 'Owner onaylı Tauri/Windows ekran, fare ve klavye köprüsü.', status: computerState, riskLevel: 'high',
      readinessReason: computer.safeMessage,
      capabilities: ['screen observe', 'screenshot', 'mouse move', 'click', 'typing', 'approved hotkey', 'scroll', 'approved app launch', 'stop'],
      limitations: [...computer.limitations, 'OCR semantic targeting henüz yok.', 'Native tam ekran şeffaf overlay henüz yok.', 'Arbitrary shell desteklenmez.'],
      requiredPermissions: [...computer.requiredPermissions],
      requiredConfig: computer.runtime === 'tauri' ? (computer.ownerCommandMode ? [] : ['owner-approved session']) : ['Tauri desktop runtime', 'owner-approved session'],
      relatedEndpoints: [...computer.endpoints], relatedScreens: ['computer-use'],
      safetyNotes: ['Kalıcı silme, ödeme, gizli veri yazma ve keyfi shell engellenir.', 'Stop ve kill switch her zaman önceliklidir.'],
      examples: ['Computer Use çalışıyor mu?', 'Ekrana bak', 'Not Defteri aç'],
      sourceOfTruth: ['/api/computer-use/status', 'src-tauri/src/computer.rs', 'Tauri runtime heartbeat'],
      details: {
        runtime: computer.runtime, mode: computer.mode, screenCapture: computer.screenCapture,
        mouseControl: computer.mouseControl, keyboardControl: computer.keyboardControl,
        ownerCommandMode: computer.ownerCommandMode, killSwitch: computer.killSwitch,
        overlay: computer.overlay,
      },
    }),
    skill(checkedAt, {
      id: 'crypto_demo_exchange', name: 'Crypto Demo Exchange', category: 'finance',
      description: 'Binance public market verisiyle 10.000 demo kredi kullanan simülasyon terminali.', status: cryptoState, riskLevel: 'medium',
      readinessReason: cryptoState === 'ready' ? 'Demo engine reports the expected safe balance and no real-order path.' : cryptoAgent.error ?? 'Crypto service is not ready.',
      capabilities: ['Binance public data', '10,000 demo credits', 'demo buy', 'demo sell', 'portfolio', 'positions', 'trade history'],
      limitations: ['Gerçek alım satım yok.', 'Gerçek para veya gerçek emir endpoint’i yok.', `Obsidian: ${textValue(cryptoFeatures?.obsidian) ?? 'disabled'}, news: ${textValue(cryptoFeatures?.news) ?? 'disabled'}, learning: ${textValue(cryptoFeatures?.learning) ?? 'disabled'}.`],
      requiredPermissions: ['network:read'], requiredConfig: fs.existsSync(cryptoAgent.scriptPath) ? [] : ['EDITH_CRYPTO_PROJECT_PATH'],
      relatedEndpoints: ['/api/crypto/status', '/api/crypto/market', '/api/crypto/portfolio', '/api/crypto/positions', '/api/crypto/trades', '/api/crypto/demo/buy', '/api/crypto/demo/sell', '/api/crypto/demo/reset'],
      relatedScreens: ['crypto'], safetyNotes: ['Demo işlemleri gerçek para kullanmaz.', 'Live trading ve Binance emir yolları kapalıdır.'],
      examples: ['Crypto ne durumda?', 'Demo portföyümü göster', 'Crypto gerçek işlem yapıyor mu?'],
      sourceOfTruth: ['/api/crypto/status', 'crypto/src/demo_portfolio.py', 'crypto/src/dashboard.py'],
      details: {
        runtimeVerified: Boolean(cryptoStatus),
        demoMode: booleanValue(cryptoStatus?.demoMode) ?? true,
        demoInitialBalance: numberValue(cryptoStatus?.demoInitialBalance) ?? 10_000,
        realMoneyUsed: booleanValue(cryptoStatus?.realMoneyUsed) ?? false,
        realTrading: booleanValue(cryptoStatus?.liveExecutionEnabled) ?? false,
        binanceMode: textValue(cryptoBinance?.connectionMode) ?? 'PUBLIC_MARKET_DATA',
        currentCash: numberValue(portfolio?.currentCash) ?? 10_000,
      },
    }),
    skill(checkedAt, {
      id: 'jev_decision_model', name: 'Jev Decision Model', category: 'finance',
      description: 'Crypto demo kararları için backend-only Jev adaptörü.', status: jevState, riskLevel: 'medium',
      readinessReason: textValue(jevStatus?.safeMessage) ?? (jevState === 'config_required' ? 'Jev backend configuration is missing.' : `Jev state is ${jevState}.`),
      capabilities: ['validated BUY/SELL/HOLD decision', 'confidence', 'demo-loop decisions'],
      limitations: ['Yalnızca demo emir motorunu besler.', 'Jev kararı gerçek emir yetkisi vermez.'],
      requiredPermissions: ['network:read'], requiredConfig: jevState === 'config_required' ? ['JEV_API_KEY', 'JEV_API_URL'] : [],
      relatedEndpoints: ['/api/crypto/jev/status', '/api/crypto/decision/run', '/api/crypto/jev/loop'], relatedScreens: ['crypto'],
      safetyNotes: ['JEV_API_KEY frontend veya registry çıktısına eklenmez.', 'Model çıktısı doğrulanmadan demo emir oluşturulmaz.'],
      examples: ['Jev hazır mı?', 'Jev son kararını göster'],
      sourceOfTruth: ['/api/crypto/jev/status', 'crypto/src/jev_adapter.py'],
      details: { configured: booleanValue(jevStatus?.configured) ?? jevConfigured, available: booleanValue(jevStatus?.available) ?? false, model: textValue(jevStatus?.model) ?? process.env.JEV_MODEL ?? 'jev-1.13.0' },
    }),
    skill(checkedAt, {
      id: 'obsidian_memory', name: 'Obsidian Memory / Knowledge Vault', category: 'memory',
      description: 'Yerel Obsidian vault okuma, yazma, arama ve bilgi grafiği indeksi.', status: obsidianState, riskLevel: 'medium',
      readinessReason: `Vault is ${obsidian.connectionStatus}; read=${obsidian.readable}, write=${obsidian.writable}.`,
      capabilities: ['read notes', 'write generated notes', 'search vault', 'graph/index', 'linked skill notes'],
      limitations: ['Mevcut vault seçildiğinde notlar taşınmaz veya yeniden düzenlenmez.', 'Yalnızca E.D.I.T.H. tarafından üretilen notlar otomatik güncellenir.', ...(obsidian.watcherActive ? [] : ['Vault watcher etkin değil.'])],
      requiredPermissions: ['file:read', 'file:write'], requiredConfig: obsidian.vaultExists ? [] : ['Workspace Manager: obsidianVaultPath'],
      relatedEndpoints: ['/api/workspace/status', '/api/knowledge/status', '/api/knowledge/graph'], relatedScreens: ['memory', 'knowledge', 'settings'],
      safetyNotes: ['Vault dışına yol kaçışı engellenir.', 'Olası secret içeriği yazılmadan önce redakte edilir.'],
      examples: ['Obsidian bağlı mı?', 'Vault içinde ara'],
      sourceOfTruth: ['/api/workspace/status', '/api/knowledge/status', 'src/edith/obsidianVaultService.ts'],
      details: { vaultPath: obsidian.settings.vaultPath, readable: obsidian.readable, writable: obsidian.writable, watcherActive: obsidian.watcherActive, indexedNotes: obsidian.indexedNotes, graphNodes: obsidian.nodeCount, graphEdges: obsidian.edgeCount },
    }),
    skill(checkedAt, {
      id: 'supabase_registry', name: 'Supabase Registry', category: 'integration',
      description: 'Kullanıcı, cihaz, workspace, ayar ve metadata registry katmanı.',
      status: process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY ? 'degraded' : 'config_required', riskLevel: 'medium',
      readinessReason: process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY
        ? 'Supabase is configured; use the explicit cloud status endpoint to verify reachability.'
        : 'SUPABASE_URL and SUPABASE_ANON_KEY are required.',
      capabilities: ['account auth', 'device registry', 'workspace metadata', 'settings metadata', 'conversation metadata', 'skill metadata'],
      limitations: ['Yalnızca metadata senkronize edilir; Obsidian ve yerel dosya içeriği buluta yüklenmez.', 'Ağ erişilebilirliği sürekli arka plan pingleriyle ölçülmez.'],
      requiredPermissions: ['network:read', 'network:write'],
      requiredConfig: process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY ? [] : ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'Supabase RLS migration'],
      relatedEndpoints: ['/api/cloud/status', '/api/account/me', '/api/devices', '/api/workspace/registry'], relatedScreens: ['integrations'],
      safetyNotes: ['Anon key ve oturum tokenları registry çıktısına eklenmez.', 'RLS tüm kayıtları auth.uid() ile sınırlar.'],
      examples: ['Supabase hazır mı?'], sourceOfTruth: ['/api/cloud/status', 'server/cloud/supabaseRegistry.ts', 'supabase/migrations'],
    }),
    skill(checkedAt, {
      id: 'workspace_manager', name: 'Workspace Manager', category: 'workspace',
      description: 'Yerel ve portable workspace yolları, mevcut Obsidian vault eşlemesi ve güvenli metadata yönetimi.',
      status: workspace.state === 'ready' ? 'ready' : workspace.state === 'configuration_required' ? 'config_required' : workspace.state === 'invalid' ? 'broken' : 'degraded',
      riskLevel: 'medium',
      readinessReason: workspace.safeMessage,
      capabilities: ['workspace path validation', 'portable relative paths', 'managed data/log/backup/export directories', 'existing Obsidian vault selection', 'metadata-only cloud contract'],
      limitations: [...workspace.limitations, 'Yapılandırma değişikliği mevcut dosyaları otomatik taşımaz veya silmez.'],
      requiredPermissions: ['file:read', 'file:write'], requiredConfig: workspace.configured ? [] : ['workspaceRoot'], relatedEndpoints: ['/api/workspace/status', '/api/workspace/config', '/api/workspace/validate', '/api/workspace/create'],
      relatedScreens: ['files', 'settings'], safetyNotes: ['Kullanıcı seçimi olmadan klasör taşınmaz veya silinmez.'],
      examples: ['Workspace nerede?', 'Vault konumunu göster'], sourceOfTruth: ['/api/workspace/status', 'src/edith/workspaceManager.ts'],
      details: {
        configured: workspace.configured,
        state: workspace.state,
        portableMode: workspace.portableMode,
        workspacePath: workspace.resolvedPaths?.workspaceRoot ?? '',
        persistencePath: workspace.resolvedPaths?.dataPath ?? '',
        logsPath: workspace.resolvedPaths?.logsPath ?? '',
        backupPath: workspace.resolvedPaths?.backupPath ?? '',
        exportsPath: workspace.resolvedPaths?.exportsPath ?? '',
        vaultPath: workspace.resolvedPaths?.obsidianVaultPath ?? '',
        persistenceRestartRequired: workspace.persistenceRestartRequired,
      },
    }),
    skill(checkedAt, {
      id: 'skill_store', name: 'Skill Store', category: 'registry', description: 'Built-in, community ve private skill yönetimi planı.',
      status: 'planned', riskLevel: 'high', readinessReason: 'Typed built-in/private/community metadata exists; installation and third-party execution remain intentionally unavailable.',
      capabilities: ['read-only external catalog', 'typed package metadata', 'execution eligibility policy'], limitations: ['Community skill kurulumu ve çalıştırması yok.', 'Community execution metadata durumundan bağımsız olarak bloklanır.', 'Sandbox ve imza doğrulama akışı henüz yok.'],
      requiredPermissions: ['network:read'], requiredConfig: ['sandboxed install workflow', 'trust verification'],
      relatedEndpoints: ['/api/edith/skill-catalog'], relatedScreens: ['tools'], safetyNotes: ['Topluluk skilleri sandbox olmadan çalıştırılmaz.'],
      examples: ['Skill kataloğunu göster'], sourceOfTruth: ['/api/edith/skill-catalog', 'src/edith/skills/catalog.ts', 'src/edith/skillStoreMetadata.ts'],
    }),
    skill(checkedAt, {
      id: 'file_organizer', name: 'File Organizer', category: 'workspace', description: 'Kullanıcı tetiklemeli dosya düzenleme planı.',
      status: 'planned', riskLevel: 'high', readinessReason: 'No approved organizer adapter or undo journal is implemented.', capabilities: [],
      limitations: ['Otomatik temizlik yok.', 'Undo günlüğü olmadan dosya taşıma yok.', 'Kalıcı silme yok.'],
      requiredPermissions: ['file:read', 'file:write'], requiredConfig: ['approved organizer adapter', 'undo journal'],
      relatedEndpoints: [], relatedScreens: ['files'], safetyNotes: ['Yalnızca açık kullanıcı komutuyla çalışmalıdır.', 'Kalıcı silme engellidir.'],
      examples: ['İndirilenleri düzenle'], sourceOfTruth: ['registry implementation audit'],
    }),
    skill(checkedAt, {
      id: 'browser_research', name: 'Browser Research', category: 'research', description: 'Web araması ve tarayıcı araştırma temeli.',
      status: browserRegistered ? 'degraded' : 'config_required', riskLevel: 'medium',
      readinessReason: browserRegistered ? 'Search/open tools exist; page extraction and operator runtime are not bound.' : 'Browser search tool is not registered.',
      capabilities: browserRegistered ? ['open validated URL', 'open web search'] : [],
      limitations: ['Sonuç sayfasını okuyup kaynaklı araştırma yapan browser operator bağlı değil.', 'Form, upload ve download akışları hazır değil.'],
      requiredPermissions: ['network:read'], requiredConfig: browserRegistered ? ['browser operator adapter for extraction'] : ['browser search adapter'],
      relatedEndpoints: ['/api/edith/tools', '/api/edith/browser/workflows/capabilities'], relatedScreens: ['browser'],
      safetyNotes: ['Form gönderimi ve dosya yükleme ayrıca onay gerektirir.'], examples: ['Webde ara: E.D.I.T.H.'],
      sourceOfTruth: ['browser_search tool registration', '/api/edith/browser/workflows/capabilities'],
    }),
    skill(checkedAt, {
      id: 'system_status', name: 'System Status', category: 'system', description: 'CPU, RAM, işletim sistemi ve performans ölçümleri.',
      status: systemRegistered ? 'ready' : 'unavailable', riskLevel: 'low',
      readinessReason: systemRegistered ? 'Read-only system monitor tool is registered.' : 'System monitor tool is absent.',
      capabilities: systemRegistered ? ['CPU', 'RAM', 'OS', 'uptime', 'Node runtime'] : [], limitations: ['GPU ölçümü henüz uygulanmadı.'],
      requiredPermissions: ['system:read'], requiredConfig: [], relatedEndpoints: ['/api/edith/tools', '/api/edith/tools/health'],
      relatedScreens: ['system'], safetyNotes: ['Salt okunur sistem metriği toplar.'], examples: ['Sistem durumunu göster'],
      sourceOfTruth: ['system_monitor tool registration', '/api/edith/tools/health'],
    }),
    skill(checkedAt, {
      id: 'control_center', name: 'EDITH Control Center', category: 'system', description: 'Ayar, health check ve kurulum görünümü.',
      status: 'ready', riskLevel: 'low', readinessReason: 'The Tools/Capabilities and Settings screens consume live backend status endpoints.',
      capabilities: ['skill status overview', 'tool registry', 'permissions', 'health checks', 'settings'],
      limitations: ['Eksik modülleri otomatik kurmaz veya onarmaz.'], requiredPermissions: ['system:read'], requiredConfig: [],
      relatedEndpoints: ['/api/edith/skills', '/api/edith/capabilities/summary', '/api/edith/interaction-safety'], relatedScreens: ['tools', 'settings', 'command-center'],
      safetyNotes: ['Durum görünümü eylem izni vermez.'], examples: ['Aktif özelliklerini göster'],
      sourceOfTruth: ['/api/edith/skills', 'src/components/ui/edithOS.tsx'],
    }),
    skill(checkedAt, {
      id: 'release_builder', name: 'Release / Full EXE Mode', category: 'release', description: 'Production Tauri desktop build, installer ve portable release planı.',
      status: 'planned', riskLevel: 'high', readinessReason: sources.releaseArtifactsPresent ? 'Release artifacts exist, but no verified release pipeline is registered.' : 'No verified installer or portable release artifact is present.',
      capabilities: [], limitations: ['Production installer/portable pipeline doğrulanmadı.', 'Kod imzalama ve release QA yok.'],
      requiredPermissions: ['system:exec', 'file:write'], requiredConfig: ['release pipeline', 'installer configuration', 'release QA'],
      relatedEndpoints: [], relatedScreens: ['settings'], safetyNotes: ['Build çıktısı test ve imza olmadan production-ready sayılmaz.'],
      examples: ['Full EXE sürümü hazır mı?'], sourceOfTruth: ['package.json#tauri:build', 'src-tauri/target/release artifact audit'],
      details: { artifactsDetected: sources.releaseArtifactsPresent },
    }),
  ];

  const counts = Object.fromEntries(EDITH_SKILL_STATUSES.map((status) => [status, 0])) as Record<SkillStatus, number>;
  for (const entry of skills) counts[entry.status] += 1;
  return { checkedAt, skills, counts };
}

export async function getSkillRegistry(options: { forceRefresh?: boolean } = {}): Promise<SkillRegistrySnapshot> {
  const now = Date.now();
  if (!options.forceRefresh && cachedSnapshot && cachedSnapshot.expiresAt > now) return cachedSnapshot.value;
  if (activeRead) return activeRead;
  activeRead = collectSources().then(buildSkillRegistry);
  try {
    const value = await activeRead;
    cachedSnapshot = { value, expiresAt: Date.now() + CACHE_MS };
    return value;
  } catch (error) {
    // A transient provider, vault, or SQLite failure must not erase the last
    // verified capability truth. Callers can still see its original checkedAt.
    if (cachedSnapshot) return cachedSnapshot.value;
    throw error;
  } finally {
    activeRead = undefined;
  }
}

export function buildCapabilitySummary(snapshot: SkillRegistrySnapshot): CapabilitySummary {
  const ids = (status: SkillStatus) => snapshot.skills.filter((entry) => entry.status === status).map((entry) => entry.id);
  const limitations = Object.fromEntries(snapshot.skills
    .filter((entry) => entry.limitations.length > 0)
    .map((entry) => [entry.id, entry.limitations.slice(0, 3)])) as Partial<Record<EdithSkillId, string[]>>;
  return {
    checkedAt: snapshot.checkedAt,
    ready: ids('ready'), degraded: ids('degraded'), configRequired: ids('config_required'), offline: ids('offline'),
    disabled: ids('disabled'), broken: ids('broken'), planned: ids('planned'), unavailable: ids('unavailable'), limitations,
  };
}

export function formatCapabilityContext(summary: CapabilitySummary): string {
  return `E.D.I.T.H. capability registry (authoritative, compact): ${JSON.stringify(summary)}\nDo not claim capabilities outside this registry. Distinguish ready, degraded, offline, disabled, config_required, and planned.`;
}

const CAPABILITY_TERMS = /(?:skill|yetenek|capabilit|ne yapabiliyor|neler yapabiliyor|aktif özellik|özelliklerini say|modül)/i;
const BROAD_CAPABILITY_TERMS = /(?:hangi skill|ne tür skill|skill(?:lerin|lerin neler)|yeteneklerin|capabilit(?:y|ies)|ne yapabiliyorsun|neler yapabiliyorsun|aktif özelliklerini say|özelliklerini say)/i;
const SPECIFIC_TERMS = /(?:computer use|bilgisayar kullan|desktop operator|obsidian|voice|\bses\b|crypto|kripto|jev|supabase|gemini|browser research|tarayıcı araştır|workspace|skill store|file organizer|dosya düzen|system status|sistem durumu|control center|release|full exe)/i;

export function isCapabilityQuestion(message: string): boolean {
  const value = message.toLocaleLowerCase('tr-TR').trim();
  return /what can you do|neler yapabiliyorsun|ne yapabiliyorsun/i.test(value)
    || CAPABILITY_TERMS.test(value)
    || (SPECIFIC_TERMS.test(value) && /(?:çalışıyor|bağlı|hazır|durum|available|working|connected|gerçek işlem|ne durumda)/i.test(value));
}

function relevantSkills(snapshot: SkillRegistrySnapshot, question: string): EdithSkill[] {
  const value = question.toLocaleLowerCase('tr-TR');
  const terms: Array<[EdithSkillId, RegExp]> = [
    ['computer_use', /computer use|bilgisayar kullan|desktop operator/], ['voice_room', /voice|\bses\b|ses odası/],
    ['crypto_demo_exchange', /crypto|kripto|gerçek işlem|demo exchange/], ['jev_decision_model', /\bjev\b/],
    ['obsidian_memory', /obsidian|vault/], ['supabase_registry', /supabase/], ['gemini_text_chat', /gemini|metin sohbet/],
    ['browser_research', /browser research|tarayıcı araştır/], ['workspace_manager', /workspace/], ['skill_store', /skill store/],
    ['file_organizer', /file organizer|dosya düzen/], ['system_status', /system status|sistem durumu|cpu|ram|gpu/],
    ['control_center', /control center/], ['release_builder', /release|full exe|installer|portable/],
  ];
  const ids = terms.filter(([, pattern]) => pattern.test(value)).map(([id]) => id);
  return snapshot.skills.filter((entry) => ids.includes(entry.id));
}

export function formatCapabilityAnswer(snapshot: SkillRegistrySnapshot, question: string): string {
  const broad = BROAD_CAPABILITY_TERMS.test(question) || /what can you do/i.test(question);
  const matches = relevantSkills(snapshot, question);
  if (!broad && matches.length > 0) {
    return matches.map((entry) => {
      const scopeLabel = entry.status === 'ready'
        ? 'Çalışan kapsam'
        : entry.status === 'degraded'
          ? 'Kısıtlı kapsam'
          : 'Kayıtlı kapsam (şu an çalışmıyor)';
      const directSafetyAnswer = entry.id === 'crypto_demo_exchange' && /gerçek işlem|real trad/i.test(question)
        ? 'Hayır. Bu modül yalnızca demo kredi ve demo emirlerle çalışır; gerçek para veya gerçek emir yolu yoktur.'
        : '';
      return [
        `${entry.name}: ${entry.status}.`, directSafetyAnswer, entry.readiness.reason,
        entry.capabilities.length ? `${scopeLabel}: ${entry.capabilities.join(', ')}.` : `${scopeLabel} henüz yok.`,
        entry.limitations.length ? `Kısıtlar: ${entry.limitations.join(' ')}` : '',
        entry.requiredConfig.length ? `Gereken kurulum: ${entry.requiredConfig.join(', ')}.` : '',
      ].filter(Boolean).join(' ');
    }).join('\n');
  }
  const groups: Array<[string, SkillStatus[]]> = [
    ['Hazır', ['ready']], ['Kısıtlı', ['degraded']], ['Kurulum isteyen', ['config_required']],
    ['Çevrimdışı', ['offline']], ['Kapalı veya sorunlu', ['disabled', 'broken', 'unavailable']], ['Planlanan', ['planned']],
  ];
  return groups.map(([label, states]) => {
    const entries = snapshot.skills.filter((entry) => states.includes(entry.status));
    return `${label}: ${entries.length ? entries.map((entry) => `${entry.name} (${entry.status})`).join(', ') : 'yok'}.`;
  }).join('\n') + '\nBu yanıt canlı skill registry kaynaklarından üretildi; listelenmek, özelliğin hazır olduğu anlamına gelmez.';
}
