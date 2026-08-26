import {
  ChatSession,
  MemoryItem,
  UserSettings,
  AutomationTool,
  ToolInputField,
  ToolExecutionLog,
  IntegrationConfig,
  EdithAuthSession,
  EdithUserAccount,
} from '../types';

const STORAGE_KEYS = {
  SETTINGS: 'edith_settings_v1',
  SESSIONS: 'edith_chat_sessions_v1',
  ACTIVE_SESSION: 'edith_active_session_id_v1',
  CODE_SESSION: 'edith_code_chat_session_v1',
  MEMORIES: 'edith_memories_v1',
  TOOL_LOGS: 'edith_tool_logs_v1',
  INTEGRATIONS: 'edith_integrations_v1',
  AUTH_SESSION: 'edith_auth_session_v1',
};

const legacyPrefix = ['au', 'ra'].join('');
const LEGACY_STORAGE_KEYS = {
  SETTINGS: `${legacyPrefix}_settings_v1`,
  SESSIONS: `${legacyPrefix}_chat_sessions_v1`,
  ACTIVE_SESSION: `${legacyPrefix}_active_session_id_v1`,
  CODE_SESSION: `${legacyPrefix}_code_chat_session_v1`,
  MEMORIES: `${legacyPrefix}_memories_v1`,
  TOOL_LOGS: `${legacyPrefix}_tool_logs_v1`,
  INTEGRATIONS: `${legacyPrefix}_integrations_v1`,
};

export const EDITH_ADMIN_USERS: EdithUserAccount[] = [
  {
    id: 'admin-can-ipkin',
    name: 'CAN İPKİN',
    role: 'admin',
    permissions: ['admin', 'system:read', 'system:notify', 'network:read'],
    voiceProfile: { enrolled: false, label: 'Name-only voice activation' },
    preferences: {},
    securitySettings: { authenticationMode: 'typed_name', biometricVerified: false },
  },
  {
    id: 'admin-arda-yorulmazel',
    name: 'ARDA YORULMAZEL',
    role: 'admin',
    permissions: ['admin', 'system:read', 'system:notify', 'network:read'],
    voiceProfile: { enrolled: false, label: 'Name-only voice activation' },
    preferences: {},
    securitySettings: { authenticationMode: 'typed_name', biometricVerified: false },
  },
];

function normalizeUserName(value: string): string {
  return value
    .trim()
    .toLocaleUpperCase('tr-TR')
    .replace(/\s+/g, ' ');
}

export function authenticateEdithUser(name: string, method: EdithAuthSession['method']): EdithAuthSession | undefined {
  const normalized = normalizeUserName(name);
  const user = EDITH_ADMIN_USERS.find((candidate) => candidate.name === normalized);
  if (!user) return undefined;
  return {
    authenticated: true,
    user: {
      ...user,
      lastLogin: Date.now(),
      securitySettings: {
        authenticationMode: method,
        biometricVerified: false,
      },
    },
    authenticatedAt: Date.now(),
    method,
    assurance: 'admin_name_match',
  };
}

export const DEFAULT_SETTINGS: UserSettings = {
  aiProvider: 'ollama',
  ollamaUrl: 'http://localhost:11434',
  selectedModel: 'llama3.2',
  sttEngine: 'webspeech',
  ttsEngine: 'webspeech',
  assistantPersona: 'jarvis',
  language: 'tr',
  userName: 'Kullanıcı',
  autoSpeech: false,
  voiceHandsFree: false,
  claudeVoiceApiKey: '',
  claudeVoiceId: 'pNInz6obpgDQGcFmaJgB',
  temperature: 0.7,
  memoryEnabled: true,
  animationQuality: 'high',
  systemPrompt:
    'Sen EDITH içinde çalışan seçili AI asistan personasısın. Türkçe konuş, yardımsever, net ve kibar ol. Kullanıcıya doğru ve yerel kaynaklara saygılı yanıtlar ver.',
};

export const DEFAULT_INITIAL_MESSAGE = {
  id: 'msg-welcome',
  sender: 'assistant' as const,
  text: 'Merhaba. EDITH kişisel AI sistemi hazır. Yazabilir veya mikrofon düğmesine basarak konuşabilirsiniz.',
  timestamp: Date.now(),
};

export const DEFAULT_CODE_INITIAL_MESSAGE = {
  id: 'msg-code-welcome',
  sender: 'assistant' as const,
  text: 'Kod chat hazır. Burada kod yazdırabilir, dosya mimarisi tasarlatabilir, hata açıklatabilir veya refactor isteyebilirsiniz. Normal sohbet geçmişinden ayrı tutulur.',
  timestamp: Date.now(),
};

export const DEFAULT_TOOLS: AutomationTool[] = [
  // ── Mevcut araçlar ────────────────────────────────────────────────────────
  {
    id: 'list_dir',
    name: 'Yerel Klasör Listeleme',
    description: 'Seçili güvenli almaç dizinindeki dosya ve klasörleri listeler.',
    permissions: ['file:read'],
    status: 'idle',
    requiresConfirmation: false,
    category: 'file',
    inputFields: [
      { key: 'path', label: 'Klasör Yolu', type: 'text', placeholder: '/workspace/documents', defaultValue: '/workspace/documents' },
    ],
  },
  {
    id: 'read_file',
    name: 'Metin Dosyası Okuma',
    description: 'Belirtilen metin veya Markdown dosyasının içeriğini güvenli okur.',
    permissions: ['file:read'],
    status: 'idle',
    requiresConfirmation: true,
    category: 'file',
    inputFields: [
      { key: 'fileName', label: 'Dosya Adı', type: 'text', placeholder: 'notlar.txt', defaultValue: 'notlar.txt', required: true },
    ],
  },
  {
    id: 'export_markdown',
    name: 'Sohbet Özeti Dışa Aktarma',
    description: 'Mevcut sohbet oturumunu düzenli Markdown dosyasına dönüştürür.',
    permissions: ['file:write'],
    status: 'idle',
    requiresConfirmation: false,
    category: 'file',
  },
  {
    id: 'schedule_reminder',
    name: 'Zamanlanmış Hatırlatıcı',
    description: 'Belirlenen zaman dilimi için yerel masaüstü bildirimi oluşturur.',
    permissions: ['system:notify'],
    status: 'idle',
    requiresConfirmation: false,
    category: 'reminder',
    inputFields: [
      { key: 'reminderText', label: 'Hatırlatıcı Metni', type: 'text', placeholder: 'Toplantı var', defaultValue: 'EDITH Görev Takibi', required: true },
      { key: 'time', label: 'Zaman', type: 'text', placeholder: '10 dakika sonra', defaultValue: '10 dakika sonra' },
    ],
  },
  {
    id: 'summarize_analytics',
    name: 'Sistem Analitik Özeti',
    description: 'EDITH yerel sistem performans ve sohbet verilerini özetler.',
    permissions: ['system:read'],
    status: 'idle',
    requiresConfirmation: false,
    category: 'analytics',
  },

  // ── Mark-L'den alınan yeni skill'ler ─────────────────────────────────────

  // WEB
  {
    id: 'web_search',
    name: 'Web Araması',
    description: 'Gemini Grounded Search ve DuckDuckGo ile güncel web araması yapar. Haber, araştırma, fiyat ve karşılaştırma modları desteklenir.',
    permissions: ['network:read'],
    status: 'idle',
    requiresConfirmation: false,
    category: 'web',
    inputFields: [
      { key: 'query', label: 'Arama Sorgusu', type: 'text', placeholder: 'yapay zeka gelişmeleri', required: true },
      {
        key: 'mode',
        label: 'Arama Modu',
        type: 'select',
        options: ['search', 'news', 'research', 'price', 'compare'],
        defaultValue: 'search',
      },
    ],
  },

  // SYSTEM
  {
    id: 'system_monitor',
    name: 'Sistem Durumu İzleme',
    description: 'Gerçek zamanlı CPU, RAM, disk kullanımı, işletim sistemi bilgisi ve çalışma süresi metriklerini gösterir.',
    permissions: ['system:read'],
    status: 'idle',
    requiresConfirmation: false,
    category: 'system',
  },
  {
    id: 'browser_open',
    name: 'Tarayıcı Aç',
    description: 'EDITH registry üzerinden doğrulanmış http/https URL adresini varsayılan tarayıcıda açar.',
    permissions: ['network:read'],
    status: 'idle',
    requiresConfirmation: false,
    category: 'web',
    inputFields: [
      { key: 'url', label: 'URL', type: 'text', placeholder: 'https://example.com', required: true },
    ],
  },
  {
    id: 'browser_search',
    name: 'Tarayıcıda Ara',
    description: 'EDITH registry üzerinden web araması başlatır.',
    permissions: ['network:read'],
    status: 'idle',
    requiresConfirmation: false,
    category: 'web',
    inputFields: [
      { key: 'query', label: 'Arama Sorgusu', type: 'text', placeholder: 'local ai agents github', required: true },
    ],
  },
  {
    id: 'ai_skill_catalog',
    name: 'AI Skill Kataloğu',
    description: 'EDITH için seçilmiş popüler açık kaynak AI agent, browser-use, computer-use ve memory projelerini listeler.',
    permissions: ['system:read'],
    status: 'idle',
    requiresConfirmation: false,
    category: 'analytics',
  },
  {
    id: 'browser_use_agent',
    name: 'Browser Use Agent',
    description: 'Browser-use tarzı otonom tarayıcı görevleri için high-risk EDITH adapter iskeleti. High-risk mod açılmadan çalışmaz.',
    permissions: ['network:read', 'browser:control'],
    status: 'idle',
    requiresConfirmation: true,
    category: 'web',
    inputFields: [
      { key: 'task', label: 'Tarayıcı Görevi', type: 'textarea', placeholder: 'GitHub’da browser-use projesini aç ve README özetle', required: true },
    ],
  },
  {
    id: 'playwright_browser_agent',
    name: 'Playwright Browser Agent',
    description: 'Deterministik tarayıcı otomasyonu için Playwright adapterı. High-risk mod ve Playwright kurulumu gerektirir.',
    permissions: ['network:read', 'browser:control'],
    status: 'idle',
    requiresConfirmation: true,
    category: 'web',
    inputFields: [
      { key: 'url', label: 'URL', type: 'text', placeholder: 'https://example.com', required: true },
      { key: 'action', label: 'İşlem', type: 'select', options: ['open', 'title', 'screenshot'], defaultValue: 'title' },
    ],
  },
  {
    id: 'task_create',
    name: 'EDITH Görev Oluştur',
    description: 'Kalıcı EDITH görev kaydı oluşturur ve Ops panelinde gösterir.',
    permissions: ['system:read'],
    status: 'idle',
    requiresConfirmation: false,
    category: 'analytics',
    inputFields: [
      { key: 'title', label: 'Başlık', type: 'text', placeholder: 'Araştırma görevi', required: true },
      { key: 'objective', label: 'Amaç', type: 'textarea', placeholder: 'Ne yapılacak?', required: true },
      { key: 'originalUserRequest', label: 'Orijinal İstek', type: 'textarea', placeholder: 'Kullanıcının isteği', required: true },
    ],
  },
  {
    id: 'open_interpreter_agent',
    name: 'Open Interpreter Agent',
    description: 'Yerel bilgisayarda kod/komut çalıştırabilen Open Interpreter adapterı. High-risk mod ve kurulum gerektirir.',
    permissions: ['system:exec', 'file:read', 'file:write'],
    status: 'idle',
    requiresConfirmation: true,
    category: 'code',
    inputFields: [
      { key: 'prompt', label: 'Görev', type: 'textarea', placeholder: 'Bu projeyi analiz et ve testleri çalıştır', required: true },
    ],
  },
  {
    id: 'computer_control_agent',
    name: 'Full Computer Control',
    description: 'Masaüstü kontrol runtime adapterı için EDITH high-risk skill kaydı. Bilgisayar kontrolü için ayrıca runtime bağlanmalıdır.',
    permissions: ['computer:control', 'system:exec'],
    status: 'idle',
    requiresConfirmation: true,
    category: 'system',
    inputFields: [
      { key: 'instruction', label: 'Bilgisayar Kontrol Talimatı', type: 'textarea', placeholder: 'Chrome’u aç, şu siteye git, sayfadaki başlığı oku', required: true },
    ],
  },
  {
    id: 'weather_report',
    name: 'Hava Durumu',
    description: 'Belirtilen şehir için güncel hava durumu raporunu getirir. wttr.in servisini kullanır.',
    permissions: ['network:read'],
    status: 'idle',
    requiresConfirmation: false,
    category: 'web',
    inputFields: [
      { key: 'city', label: 'Şehir', type: 'text', placeholder: 'Istanbul', defaultValue: 'Istanbul', required: true },
      { key: 'lang', label: 'Dil', type: 'select', options: ['tr', 'en'], defaultValue: 'tr' },
    ],
  },

  // FILE PROCESSING
  {
    id: 'file_processor',
    name: 'Dosya İşleme Motoru',
    description: 'Resim (OCR/açıklama), PDF özet, Word, CSV/Excel analiz, ses transkripsiyonu, video kırpma ve arşiv işlemleri yapar.',
    permissions: ['file:read', 'file:write'],
    status: 'idle',
    requiresConfirmation: true,
    category: 'file',
    inputFields: [
      { key: 'file_path', label: 'Dosya Yolu', type: 'text', placeholder: 'C:/Users/.../belge.pdf', required: true },
      {
        key: 'action',
        label: 'İşlem',
        type: 'select',
        options: ['describe', 'ocr', 'summarize', 'extract_text', 'analyze', 'word_count', 'stats', 'validate', 'explain', 'review', 'transcribe', 'info', 'list'],
        defaultValue: 'summarize',
      },
      { key: 'instruction', label: 'Ek Talimat (opsiyonel)', type: 'text', placeholder: 'Türkçeye çevir' },
    ],
  },

  // CODE
  {
    id: 'code_helper',
    name: 'Kod Yardımcısı',
    description: 'Gemini ile kod yazar, düzenler, açıklar, çalıştırır ve hataları otomatik düzeltir (build döngüsü).',
    permissions: ['file:read', 'file:write', 'system:exec'],
    status: 'idle',
    requiresConfirmation: true,
    category: 'code',
    inputFields: [
      {
        key: 'action',
        label: 'İşlem',
        type: 'select',
        options: ['write', 'edit', 'explain', 'review', 'fix', 'optimize', 'run', 'build'],
        defaultValue: 'write',
      },
      { key: 'description', label: 'Açıklama / Talimat', type: 'textarea', placeholder: 'Flask ile basit bir REST API yaz', required: true },
      { key: 'language', label: 'Dil', type: 'select', options: ['python', 'javascript', 'typescript', 'bash', 'html', 'other'], defaultValue: 'python' },
      { key: 'file_path', label: 'Dosya Yolu (düzenleme/çalıştırma için)', type: 'text', placeholder: 'C:/Users/.../script.py' },
    ],
  },
  {
    id: 'dev_agent',
    name: 'Geliştirici Ajansı',
    description: 'Çok dosyalı yazılım projeleri planlar, yazar, bağımlılıkları kurar, VS Code\'da açar ve hataları otomatik düzeltir (max 5 deneme).',
    permissions: ['file:write', 'system:exec', 'network:read'],
    status: 'idle',
    requiresConfirmation: true,
    category: 'code',
    inputFields: [
      { key: 'description', label: 'Proje Açıklaması', type: 'textarea', placeholder: 'Kullanıcı girişi olan bir todo uygulaması', required: true },
      { key: 'language', label: 'Programlama Dili', type: 'select', options: ['python', 'javascript', 'typescript', 'other'], defaultValue: 'python' },
      { key: 'project_name', label: 'Proje Adı (opsiyonel)', type: 'text', placeholder: 'my_project' },
    ],
  },

  // MEDIA
  {
    id: 'youtube_control',
    name: 'YouTube Kontrolü',
    description: 'YouTube videosu arar ve oynatır, video özetler, transcript alır veya trend videoları listeler.',
    permissions: ['network:read'],
    status: 'idle',
    requiresConfirmation: false,
    category: 'media',
    inputFields: [
      {
        key: 'action',
        label: 'İşlem',
        type: 'select',
        options: ['play', 'summarize', 'trending', 'get_info'],
        defaultValue: 'play',
      },
      { key: 'query', label: 'Video / Konu', type: 'text', placeholder: 'Lo-fi çalışma müziği', required: true },
    ],
  },

  // MONITOR
  {
    id: 'background_monitor',
    name: 'Konu Takip İzleyici',
    description: 'Belirlediğiniz konuları (haber, gelişme vb.) günlük olarak DDG ile izler ve yeni başlık gelince sizi bilgilendirir.',
    permissions: ['network:read', 'system:read'],
    status: 'idle',
    requiresConfirmation: false,
    category: 'monitor',
    inputFields: [
      {
        key: 'action',
        label: 'İşlem',
        type: 'select',
        options: ['add', 'remove', 'list', 'check'],
        defaultValue: 'list',
      },
      { key: 'topic', label: 'Konu (ekle/kaldır için)', type: 'text', placeholder: 'yapay zeka haberleri' },
    ],
  },
  {
    id: 'screen_processor',
    name: 'Ekran / Kamera Analizi',
    description: 'Ekran görüntüsü alır veya webcam görüntüsünü yakalar ve Gemini Vision ile analiz eder, açıklar.',
    permissions: ['system:read', 'camera:read'],
    status: 'idle',
    requiresConfirmation: true,
    category: 'system',
    inputFields: [
      {
        key: 'source',
        label: 'Kaynak',
        type: 'select',
        options: ['screen', 'camera'],
        defaultValue: 'screen',
      },
      { key: 'question', label: 'Soru / Talimat', type: 'text', placeholder: 'Ekranda ne var?', defaultValue: 'Ekranda ne görüyorsun?' },
    ],
  },

  // TRAVEL
  {
    id: 'flight_finder',
    name: 'Uçuş Arama',
    description: 'Belirtilen rota ve tarih için Google Flights üzerinden uçuş fiyatlarını ve müsaitliğini arar.',
    permissions: ['network:read'],
    status: 'idle',
    requiresConfirmation: false,
    category: 'web',
    inputFields: [
      { key: 'origin', label: 'Kalkış Havalimanı', type: 'text', placeholder: 'IST', required: true },
      { key: 'destination', label: 'Varış Havalimanı', type: 'text', placeholder: 'LHR', required: true },
      { key: 'date', label: 'Gidiş Tarihi', type: 'text', placeholder: '2026-09-15', required: true },
      { key: 'return_date', label: 'Dönüş Tarihi (opsiyonel)', type: 'text', placeholder: '2026-09-22' },
      { key: 'cabin', label: 'Kabin', type: 'select', options: ['economy', 'business', 'first'], defaultValue: 'economy' },
      { key: 'passengers', label: 'Yolcu Sayısı', type: 'number', defaultValue: '1' },
    ],
  },

  // BROWSER
  {
    id: 'browser_control',
    name: 'Tarayıcı Kontrolü',
    description: 'Belirtilen URL\'yi varsayılan tarayıcıda açar veya web sayfasında arama yapar.',
    permissions: ['system:exec', 'network:read'],
    status: 'idle',
    requiresConfirmation: false,
    category: 'system',
    inputFields: [
      {
        key: 'action',
        label: 'İşlem',
        type: 'select',
        options: ['open', 'search', 'screenshot'],
        defaultValue: 'open',
      },
      { key: 'url', label: 'URL', type: 'text', placeholder: 'https://example.com' },
      { key: 'query', label: 'Arama Sorgusu', type: 'text', placeholder: 'TypeScript tutorial' },
    ],
  },
];

type RegistryToolSchemaField = {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  required?: boolean;
  description?: string;
};

export type RegistryToolDefinition = {
  id: string;
  metadata: {
    name: string;
    description: string;
    category: AutomationTool['category'];
    inputSchema: Record<string, RegistryToolSchemaField>;
    requiredPermissions: string[];
    riskLevel: 0 | 1 | 2 | 3 | 4 | 5;
  };
};

function labelFromKey(key: string): string {
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function inputTypeFromSchema(field: RegistryToolSchemaField): ToolInputField['type'] {
  if (field.type === 'number') return 'number';
  if (field.type === 'object' || field.type === 'array') return 'textarea';
  return 'text';
}

function registryToolToAutomationTool(
  registryTool: RegistryToolDefinition,
  fallback?: AutomationTool
): AutomationTool {
  const metadata = registryTool.metadata;
  const highRisk = metadata.riskLevel >= 3 ||
    metadata.requiredPermissions.some((permission) =>
      permission.includes(':write') ||
      permission.includes(':exec') ||
      permission.includes(':control')
    );

  return {
    id: registryTool.id,
    name: fallback?.name ?? metadata.name,
    description: fallback?.description ?? metadata.description,
    permissions: metadata.requiredPermissions,
    lastRun: fallback?.lastRun,
    status: fallback?.status ?? 'idle',
    requiresConfirmation: fallback?.requiresConfirmation ?? highRisk,
    category: metadata.category,
    inputFields: Object.entries(metadata.inputSchema).map(([key, field]) => ({
      key,
      label: fallback?.inputFields?.find((existing) => existing.key === key)?.label ?? labelFromKey(key),
      type: inputTypeFromSchema(field),
      placeholder: field.description,
      required: field.required,
    })),
  };
}

export function mergeRegistryTools(
  localTools: AutomationTool[],
  registryTools: RegistryToolDefinition[]
): AutomationTool[] {
  const localById = new Map(localTools.map((tool) => [tool.id, tool]));
  const registryById = new Map(registryTools.map((tool) => [tool.id, tool]));

  const merged = localTools.map((localTool) => {
    const registryTool = registryById.get(localTool.id);
    return registryTool ? registryToolToAutomationTool(registryTool, localTool) : localTool;
  });

  for (const registryTool of registryTools) {
    if (!localById.has(registryTool.id)) {
      merged.push(registryToolToAutomationTool(registryTool));
    }
  }

  return merged;
}

export const DEFAULT_INTEGRATIONS: IntegrationConfig[] = [
  {
    id: 'slack',
    name: 'Slack Webhook',
    description: 'Özet mesajları belirlenen Slack kanalına iletir (Yerel ayar gerektirir).',
    status: 'disconnected',
    iconName: 'Slack',
    webhookUrl: '',
    enabled: false,
  },
  {
    id: 'github',
    name: 'GitHub API',
    description: 'Yerel reponuz için bildirim ve issue kontrolü sağlar.',
    status: 'disconnected',
    iconName: 'Github',
    apiKey: '',
    enabled: false,
  },
  {
    id: 'google_analytics',
    name: 'Google Analytics',
    description: 'Anonimleştirilmiş kullanım istatistikleri entegrasyonu.',
    status: 'disconnected',
    iconName: 'BarChart3',
    apiKey: '',
    enabled: false,
  },
  {
    id: 'custom_webhook',
    name: 'Özel Webhook Entegrasyonu',
    description: 'Tüm EDITH etkinliklerini istediğiniz yerel veya uzak HTTP sunucusuna gönderir.',
    status: 'disconnected',
    iconName: 'Webhook',
    webhookUrl: '',
    enabled: false,
  },
  {
    id: 'iot_feedback',
    name: 'IoT Feedback',
    description: 'Akıllı ev / cihaz geri bildirimi için izinli adapter slotu. Gerçek sağlayıcı bağlanmadan cihaz aksiyonu çalıştırmaz.',
    status: 'needs_auth',
    iconName: 'RadioTower',
    webhookUrl: '',
    enabled: false,
  },
  {
    id: 'finance_trading_guard',
    name: 'Finance Trading Guard',
    description: 'Broker/exchange entegrasyonları için güvenlik kapısı. Live veya paper order üretimi gerçek adapter ve açık izin olmadan devre dışıdır.',
    status: 'needs_auth',
    iconName: 'Landmark',
    apiKey: '',
    enabled: false,
  },
];

export const DEFAULT_MEMORIES: MemoryItem[] = [
  {
    id: 'mem-1',
    category: 'user_pref',
    key: 'Kullanıcı Adı',
    value: 'Kullanıcı',
    createdAt: Date.now() - 86400000 * 2,
  },
  {
    id: 'mem-2',
    category: 'user_pref',
    key: 'Varsayılan Dil',
    value: 'Türkçe',
    createdAt: Date.now() - 86400000,
  },
  {
    id: 'mem-3',
    category: 'fact',
    key: 'Çalışma Modu',
    value: 'Tamamen Yerel / Gizlilik Odaklı',
    createdAt: Date.now() - 3600000,
  },
];

// Load / Save Helpers
export function loadSettings(): UserSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.SETTINGS) ?? localStorage.getItem(LEGACY_STORAGE_KEYS.SETTINGS);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch (e) {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: UserSettings): void {
  try {
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
  } catch (e) {
    console.error('Settings save failed:', e);
  }
}

export function loadSessions(): ChatSession[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.SESSIONS) ?? localStorage.getItem(LEGACY_STORAGE_KEYS.SESSIONS);
    if (!raw) {
      const initialSession: ChatSession = {
        id: 'session-default',
        title: 'İlk Karşılama Sohbeti',
        messages: [DEFAULT_INITIAL_MESSAGE],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      saveSessions([initialSession]);
      return [initialSession];
    }
    return JSON.parse(raw);
  } catch (e) {
    return [];
  }
}

export function saveSessions(sessions: ChatSession[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS.SESSIONS, JSON.stringify(sessions));
  } catch (e) {
    console.error('Sessions save failed:', e);
  }
}

export function loadCodeSession(): ChatSession {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.CODE_SESSION) ?? localStorage.getItem(LEGACY_STORAGE_KEYS.CODE_SESSION);
    if (!raw) {
      const initialSession: ChatSession = {
        id: 'code-session-default',
        title: 'Kod Chat',
        messages: [DEFAULT_CODE_INITIAL_MESSAGE],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      saveCodeSession(initialSession);
      return initialSession;
    }
    return JSON.parse(raw);
  } catch (e) {
    return {
      id: 'code-session-default',
      title: 'Kod Chat',
      messages: [DEFAULT_CODE_INITIAL_MESSAGE],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }
}

export function saveCodeSession(session: ChatSession): void {
  try {
    localStorage.setItem(STORAGE_KEYS.CODE_SESSION, JSON.stringify(session));
  } catch (e) {
    console.error('Code session save failed:', e);
  }
}

export function loadMemories(): MemoryItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.MEMORIES) ?? localStorage.getItem(LEGACY_STORAGE_KEYS.MEMORIES);
    if (!raw) {
      saveMemories(DEFAULT_MEMORIES);
      return DEFAULT_MEMORIES;
    }
    return JSON.parse(raw);
  } catch (e) {
    return DEFAULT_MEMORIES;
  }
}

export function saveMemories(memories: MemoryItem[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS.MEMORIES, JSON.stringify(memories));
  } catch (e) {
    console.error('Memories save failed:', e);
  }
}

export function loadToolLogs(): ToolExecutionLog[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.TOOL_LOGS) ?? localStorage.getItem(LEGACY_STORAGE_KEYS.TOOL_LOGS);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

export function saveToolLogs(logs: ToolExecutionLog[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS.TOOL_LOGS, JSON.stringify(logs));
  } catch (e) {
    console.error('Tool logs save failed:', e);
  }
}

export function loadIntegrations(): IntegrationConfig[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.INTEGRATIONS) ?? localStorage.getItem(LEGACY_STORAGE_KEYS.INTEGRATIONS);
    if (!raw) {
      saveIntegrations(DEFAULT_INTEGRATIONS);
      return DEFAULT_INTEGRATIONS;
    }
    const parsed = JSON.parse(raw) as IntegrationConfig[];
    const parsedById = new Map(parsed.map((integration) => [integration.id, integration]));
    return DEFAULT_INTEGRATIONS.map((integration) => ({
      ...integration,
      ...parsedById.get(integration.id),
    }));
  } catch (e) {
    return DEFAULT_INTEGRATIONS;
  }
}

export function saveIntegrations(integrations: IntegrationConfig[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS.INTEGRATIONS, JSON.stringify(integrations));
  } catch (e) {
    console.error('Integrations save failed:', e);
  }
}

export function loadAuthSession(): EdithAuthSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.AUTH_SESSION);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as EdithAuthSession;
    return parsed?.authenticated && parsed.user?.role === 'admin' ? parsed : null;
  } catch {
    return null;
  }
}

export function saveAuthSession(session: EdithAuthSession): void {
  try {
    localStorage.setItem(STORAGE_KEYS.AUTH_SESSION, JSON.stringify(session));
  } catch (e) {
    console.error('Auth session save failed:', e);
  }
}

export function clearAuthSession(): void {
  try {
    localStorage.removeItem(STORAGE_KEYS.AUTH_SESSION);
  } catch (e) {
    console.error('Auth session clear failed:', e);
  }
}
