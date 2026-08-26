import React, { useEffect, useState } from 'react';
import {
  Settings,
  Cpu,
  Activity,
  Mic,
  Volume2,
  Brain,
  Sliders,
  RotateCcw,
  Globe,
  Zap,
  Terminal,
  Bot,
  ShieldCheck,
  Network,
} from 'lucide-react';
import { UserSettings, AiProvider } from '../../types';

interface ProviderProfile {
  provider: AiProvider;
  displayName: string;
  privacy: 'local' | 'cloud' | 'offline';
  defaultModel: string;
  modelExamples: string[];
  tasks: string[];
  capabilities: string[];
  requiredEnv: string[];
  status: 'available' | 'unavailable' | 'configuration_required';
  notes: string;
}

interface SettingsViewProps {
  settings: UserSettings;
  availableModels: string[];
  ollamaConnected: boolean;
  onSaveSettings: (newSettings: UserSettings) => void;
  onTestConnection: () => Promise<void>;
  onResetAllData: () => void;
  isTestingConnection: boolean;
}

interface ObsidianStatus {
  vaultExists: boolean;
  obsidianConfigExists: boolean;
  watcherActive: boolean;
  lastSyncAt?: string;
  indexedNotes: number;
  chunks: number;
  settings: { vaultPath: string };
}

type PermissionMode = 'deny' | 'ask' | 'full_access';

interface PermissionPolicyStatus {
  mode: PermissionMode;
  highRiskEnabled: boolean;
  authorizedPermissions: string[];
  activeGrants: number;
  policy?: {
    updatedAt: string;
    updatedBy: string;
  };
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  settings,
  availableModels,
  ollamaConnected,
  onSaveSettings,
  onTestConnection,
  onResetAllData,
  isTestingConnection,
}) => {
  const [form, setForm] = useState<UserSettings>(settings);
  const [showConfirmReset, setShowConfirmReset] = useState(false);
  const [providerProfiles, setProviderProfiles] = useState<ProviderProfile[]>([]);
  const [obsidianStatus, setObsidianStatus] = useState<ObsidianStatus | null>(null);
  const [permissionPolicy, setPermissionPolicy] = useState<PermissionPolicyStatus | null>(null);

  useEffect(() => {
    setForm(settings);
  }, [settings]);

  useEffect(() => {
    let cancelled = false;
    async function loadCapabilities() {
      try {
        const response = await fetch(`/api/edith/models/capabilities?ollamaAvailable=${ollamaConnected}`);
        const data = await response.json();
        if (!cancelled) setProviderProfiles(data.providers ?? []);
      } catch {
        if (!cancelled) setProviderProfiles([]);
      }
    }
    loadCapabilities();
    return () => {
      cancelled = true;
    };
  }, [ollamaConnected]);

  useEffect(() => {
    loadObsidianStatus();
    loadPermissionPolicy();
  }, []);

  const handleChange = (key: keyof UserSettings, value: any) => {
    const updated = { ...form, [key]: value };
    setForm(updated);
    onSaveSettings(updated);
  };

  const handleProviderChange = (provider: AiProvider) => {
    const profile = providerProfiles.find((candidate) => candidate.provider === provider);
    const updated = {
      ...form,
      aiProvider: provider,
      selectedModel: profile?.defaultModel ?? form.selectedModel,
    };
    setForm(updated);
    onSaveSettings(updated);
  };

  const activeProviderProfile = providerProfiles.find((profile) => profile.provider === form.aiProvider);

  async function loadObsidianStatus() {
    try {
      const response = await fetch('/api/edith/obsidian/status');
      const data = await response.json();
      if (data.success) setObsidianStatus(data.status);
    } catch {
      setObsidianStatus(null);
    }
  }

  async function syncObsidianNow() {
    await fetch('/api/edith/obsidian/sync-now', { method: 'POST' });
    await loadObsidianStatus();
  }

  async function loadPermissionPolicy() {
    try {
      const response = await fetch('/api/edith/permissions/policy');
      const data = await response.json();
      if (data.success) setPermissionPolicy(data.policy);
    } catch {
      setPermissionPolicy(null);
    }
  }

  async function updatePermissionMode(mode: PermissionMode) {
    const response = await fetch('/api/edith/permissions/policy', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
    });
    const data = await response.json();
    if (data.success) setPermissionPolicy(data.policy);
  }

  return (
    <div className="flex-1 p-4 sm:p-6 overflow-y-auto bg-slate-950/60 custom-scrollbar">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6 pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <Settings className="w-6 h-6 text-fuchsia-400" />
          <h1 className="text-xl font-bold text-slate-100">E.D.I.T.H Sistem Ayarları</h1>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Yerel LLM, ses motoru, bellek ve 3D parçacık performans parametreleri.
          </p>
        </div>
        <div className="px-3 py-1.5 rounded-xl border border-emerald-500/30 bg-emerald-950/20 text-emerald-300 text-[11px] font-mono">
          Otomatik kaydetme aktif
        </div>
      </div>

      <div className="space-y-6 max-w-4xl">
        {/* 1. LLM & Provider Settings */}
        <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-4 shadow-xl">
          <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
            <Cpu className="w-4 h-4 text-purple-400" />
            LLM Sağlayıcı ve Model Ayarları
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            {/* Provider Selection */}
            <div>
              <label className="block text-slate-400 mb-1.5 font-medium">Yapay Zekâ Sağlayıcısı</label>
              <select
                value={form.aiProvider}
                onChange={(e) => handleProviderChange(e.target.value as AiProvider)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-slate-200 focus:outline-none focus:border-purple-500 font-sans"
              >
                <option value="ollama">Yerel Ollama API (Önerilen - %100 Yerel)</option>
                <option value="gemini">Google Gemini API (Bulut / Dev Preview)</option>
                <option value="openai">OpenAI API (Adapter Hazırlık)</option>
                <option value="anthropic">Anthropic Claude API (Adapter Hazırlık)</option>
                <option value="openrouter">OpenRouter Gateway (Adapter Hazırlık)</option>
                <option value="local">Yerel Provider Slotu (Gelecek Runtime)</option>
                <option value="mock">EDITH Yerel Mock Motoru (Çevrimdışı Test)</option>
              </select>
            </div>

            {/* Ollama URL */}
            <div>
              <label className="block text-slate-400 mb-1.5 font-medium">Ollama Sunucu Adresi</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={form.ollamaUrl}
                  onChange={(e) => handleChange('ollamaUrl', e.target.value)}
                  className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-slate-200 font-mono text-xs focus:outline-none focus:border-purple-500"
                />
                <button
                  type="button"
                  onClick={onTestConnection}
                  disabled={isTestingConnection}
                  className="px-3 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-mono shrink-0 flex items-center gap-1"
                >
                  <Activity className={`w-3.5 h-3.5 ${isTestingConnection ? 'animate-spin' : ''}`} />
                  Test Et
                </button>
              </div>
            </div>

            {/* Model Selection */}
            <div>
              <label className="block text-slate-400 mb-1.5 font-medium">Model Seçimi</label>
              <select
                value={form.selectedModel}
                onChange={(e) => handleChange('selectedModel', e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-slate-200 focus:outline-none focus:border-purple-500 font-mono"
              >
                {form.aiProvider === 'ollama' && availableModels.length > 0 ? (
                  availableModels.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))
                ) : activeProviderProfile ? (
                  activeProviderProfile.modelExamples.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))
                ) : (
                  <>
                    <option value="llama3.2">llama3.2 (Varsayılan)</option>
                    <option value="qwen2.5">qwen2.5</option>
                    <option value="mistral">mistral</option>
                    <option value="gemma2">gemma2</option>
                  </>
                )}
              </select>
            </div>

            {/* Temperature Slider */}
            <div>
              <div className="flex justify-between text-slate-400 mb-1.5 font-medium">
                <span>Cevap Yaratıcılığı (Temperature)</span>
                <span className="font-mono text-fuchsia-400">{form.temperature}</span>
              </div>
              <input
                type="range"
                min="0.1"
                max="1.0"
                step="0.05"
                value={form.temperature}
                onChange={(e) => handleChange('temperature', parseFloat(e.target.value))}
                className="w-full accent-fuchsia-500 bg-slate-950 cursor-pointer"
              />
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div className="flex items-center gap-2">
                <Bot className="w-4 h-4 text-cyan-300" />
                <h3 className="text-xs font-semibold text-slate-200">Assistant Persona ≠ Model Provider</h3>
              </div>
              <span className="text-[10px] font-mono text-slate-500">
                Assistant: {form.assistantPersona.toUpperCase()} · Provider: {form.aiProvider}
              </span>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
              {providerProfiles.map((profile) => (
                <div
                  key={profile.provider}
                  className={`border p-3 ${
                    profile.provider === form.aiProvider
                      ? 'border-[var(--edith-primary)] bg-[var(--edith-primary)]/10'
                      : 'border-slate-800 bg-slate-900/50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-xs font-semibold text-slate-100">{profile.displayName}</div>
                      <div className="text-[10px] text-slate-500 font-mono">{profile.defaultModel} · {profile.privacy}</div>
                    </div>
                    <ProviderStatus status={profile.status} />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {profile.capabilities.map((capability) => (
                      <span key={capability} className="px-1.5 py-0.5 rounded border border-slate-700 bg-slate-950 text-[9px] text-slate-400 font-mono">
                        {capability}
                      </span>
                    ))}
                  </div>
                  <p className="mt-2 text-[11px] text-slate-500 leading-relaxed">{profile.notes}</p>
                  {profile.requiredEnv.length > 0 && (
                    <p className="mt-1 text-[10px] text-amber-300 font-mono">
                      env: {profile.requiredEnv.join(', ')}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 2. Audio STT & TTS Settings */}
        <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-4 shadow-xl">
          <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
            <Mic className="w-4 h-4 text-cyan-400" />
            Ses Motorları (STT & TTS)
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="block text-slate-400 mb-1.5 font-medium">STT (Konuşmayı Metne Çevirme)</label>
              <select
                value={form.sttEngine}
                onChange={(e) => handleChange('sttEngine', e.target.value as any)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-slate-200 focus:outline-none focus:border-purple-500"
              >
                <option value="webspeech">Tarayıcı Web Speech API (Hızlı & Doğal)</option>
                <option value="whisper">Yerel Whisper.cpp Entegrasyonu (Yapılandırılmadı)</option>
              </select>
            </div>

            <div>
              <label className="block text-slate-400 mb-1.5 font-medium">TTS (Metni Seslendirme Motoru)</label>
              <select
                value={form.ttsEngine}
                onChange={(e) => handleChange('ttsEngine', e.target.value as any)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-slate-200 focus:outline-none focus:border-purple-500"
              >
                <option value="webspeech">Tarayıcı / İşletim Sistemi Yerel TTS</option>
                <option value="claude_voice">Claude Voice Connector (ElevenLabs + Claude uyumlu API)</option>
                <option value="piper">Yerel Piper TTS Motoru (Yapılandırılmadı)</option>
              </select>
            </div>

            {form.ttsEngine === 'claude_voice' && (
              <>
                <div>
                  <label className="block text-slate-400 mb-1.5 font-medium">Claude Voice API Key</label>
                  <input
                    type="password"
                    value={form.claudeVoiceApiKey || ''}
                    onChange={(e) => handleChange('claudeVoiceApiKey', e.target.value)}
                    placeholder="ElevenLabs / Claude voice uyumlu API anahtarı"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-slate-200 focus:outline-none focus:border-purple-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1.5 font-medium">Voice ID</label>
                  <input
                    type="text"
                    value={form.claudeVoiceId || ''}
                    onChange={(e) => handleChange('claudeVoiceId', e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-slate-200 focus:outline-none focus:border-purple-500 font-mono"
                  />
                </div>
              </>
            )}

            <div className="flex items-center gap-2 pt-2">
              <input
                type="checkbox"
                id="autoSpeechCheck"
                checked={form.autoSpeech}
                onChange={(e) => handleChange('autoSpeech', e.target.checked)}
                className="rounded border-slate-800 bg-slate-950 text-purple-600 focus:ring-purple-500"
              />
              <label htmlFor="autoSpeechCheck" className="text-slate-300 font-medium">
                Yanıtları Otomatik Sesli Okut
              </label>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <input
                type="checkbox"
                id="voiceHandsFreeCheck"
                checked={form.voiceHandsFree}
                onChange={(e) => handleChange('voiceHandsFree', e.target.checked)}
                className="rounded border-slate-800 bg-slate-950 text-cyan-600 focus:ring-cyan-500"
              />
              <label htmlFor="voiceHandsFreeCheck" className="text-slate-300 font-medium">
                Jarvis Modu: Sürekli Dinle ve Otomatik Gönder
              </label>
            </div>
          </div>
        </div>

        {/* 3. Memory & Data */}
        <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-4 shadow-xl">
          <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
            <Brain className="w-4 h-4 text-emerald-400" />
            Bellek ve Veri
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="block text-slate-400 mb-1.5 font-medium">Kullanıcı Adınız</label>
              <input
                type="text"
                value={form.userName}
                onChange={(e) => handleChange('userName', e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-slate-200 focus:outline-none focus:border-purple-500"
              />
            </div>

            <div>
              <label className="block text-slate-400 mb-1.5 font-medium">3D Çekirdek Kalite Seviyesi</label>
              <select
                value={form.animationQuality}
                onChange={(e) => handleChange('animationQuality', e.target.value as any)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-slate-200 focus:outline-none focus:border-purple-500"
              >
                <option value="high">Yüksek (6.000 Parçacık + Yüksek FPS)</option>
                <option value="medium">Orta (3.500 Parçacık)</option>
                <option value="low">Düşük (1.800 Parçacık - Düşük Donanım)</option>
              </select>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <input
                type="checkbox"
                id="memoryEnableCheck"
                checked={form.memoryEnabled}
                onChange={(e) => handleChange('memoryEnabled', e.target.checked)}
                className="rounded border-slate-800 bg-slate-950 text-purple-600 focus:ring-purple-500"
              />
              <label htmlFor="memoryEnableCheck" className="text-slate-300 font-medium">
                Kişisel Bellek Sistemini Etkinleştir
              </label>
            </div>
          </div>
        </div>

        <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-4 shadow-xl">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              Agent İzin Modu
            </h2>
            <span className="text-[10px] font-mono text-slate-500">
              {permissionPolicy?.authorizedPermissions.length ?? 0} izin · {permissionPolicy?.activeGrants ?? 0} aktif grant
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <PermissionModeCard
              mode="deny"
              active={permissionPolicy?.mode === 'deny'}
              title="İzin Verme"
              description="Yazma, kontrol, exec ve yüksek riskli işlemleri kapatır; sadece güvenli okuma katmanı kalır."
              tone="warn"
              onClick={updatePermissionMode}
            />
            <PermissionModeCard
              mode="ask"
              active={!permissionPolicy || permissionPolicy.mode === 'ask'}
              title="Onay İste"
              description="Varsayılan güvenli mod. Riskli araçlar grant/izin ister, düşük riskli işler akmaya devam eder."
              tone="neutral"
              onClick={updatePermissionMode}
            />
            <PermissionModeCard
              mode="full_access"
              active={permissionPolicy?.mode === 'full_access'}
              title="Tam Erişim"
              description="Yüksek risk izinlerini varsayılan yetkili sayar; kill switch ve yasak aksiyon korumaları yine çalışır."
              tone="good"
              onClick={updatePermissionMode}
            />
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4 text-xs">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <StatusRow label="Aktif Mod" value={permissionModeLabel(permissionPolicy?.mode ?? 'ask')} tone={permissionPolicy?.mode === 'full_access' ? 'good' : permissionPolicy?.mode === 'deny' ? 'warn' : 'neutral'} />
              <StatusRow label="High Risk" value={permissionPolicy?.highRiskEnabled ? 'enabled' : 'restricted'} tone={permissionPolicy?.highRiskEnabled ? 'good' : 'warn'} />
              <StatusRow label="Son Güncelleyen" value={permissionPolicy?.policy?.updatedBy ?? '-'} />
              <StatusRow label="Son Güncelleme" value={permissionPolicy?.policy?.updatedAt ? new Date(permissionPolicy.policy.updatedAt).toLocaleString() : '-'} />
            </div>
          </div>
        </div>

        <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-4 shadow-xl">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
              <Network className="w-4 h-4 text-cyan-400" />
              Obsidian Knowledge Sync
            </h2>
            <button
              type="button"
              onClick={syncObsidianNow}
              className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-mono flex items-center gap-1"
            >
              <Activity className="w-3.5 h-3.5" />
              Reindex
            </button>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4 text-xs">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <StatusRow label="Vault" value={obsidianStatus?.settings.vaultPath ?? 'D:\\EDİTH\\EDİTH'} />
              <StatusRow label="Watcher" value={obsidianStatus?.watcherActive ? 'active' : 'idle'} tone={obsidianStatus?.watcherActive ? 'good' : 'warn'} />
              <StatusRow label="Obsidian Config" value={obsidianStatus?.obsidianConfigExists ? 'found' : 'missing'} tone={obsidianStatus?.obsidianConfigExists ? 'good' : 'warn'} />
              <StatusRow label="Indexed Notes" value={String(obsidianStatus?.indexedNotes ?? 0)} />
              <StatusRow label="RAG Chunks" value={String(obsidianStatus?.chunks ?? 0)} />
              <StatusRow label="Last Sync" value={obsidianStatus?.lastSyncAt ? new Date(obsidianStatus.lastSyncAt).toLocaleString() : 'not yet'} />
            </div>
          </div>
        </div>

        {/* Danger Zone */}
        <div className="p-5 rounded-2xl bg-red-950/20 border border-red-500/30 space-y-3">
          <h2 className="text-sm font-semibold text-red-300 flex items-center gap-2">
            <RotateCcw className="w-4 h-4 text-red-400" />
            Tüm Sistem Verilerini Sıfırla
          </h2>
          <p className="text-xs text-slate-400">
            Kayıtlı sohbet geçmişi, bellek verileri, araç günlükleri ve tüm kişisel ayarlar kalıcı olarak silinecektir.
          </p>
          <button
            type="button"
            onClick={() => setShowConfirmReset(true)}
            className="px-4 py-2 rounded-xl bg-red-600/30 hover:bg-red-600/50 border border-red-500/50 text-red-200 text-xs font-semibold transition-colors"
          >
            Tüm Verileri Temizle
          </button>
        </div>
      </div>

      {/* Confirmation Reset Modal */}
      {showConfirmReset && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <h3 className="text-base font-bold text-slate-100">Verileri Sıfırla</h3>
            <p className="text-xs text-slate-300">
              Bu işlem geri alınamaz. EDITH fabrika ayarlarına döndürülecektir.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setShowConfirmReset(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-medium"
              >
                İptal
              </button>
              <button
                onClick={() => {
                  onResetAllData();
                  setShowConfirmReset(false);
                }}
                className="px-4 py-2 rounded-xl bg-red-600 text-white text-xs font-medium"
              >
                Sıfırla
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

function StatusRow({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'neutral' | 'good' | 'warn' }) {
  const color = tone === 'good' ? 'text-emerald-300' : tone === 'warn' ? 'text-amber-300' : 'text-slate-300';
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-2">
      <span className="text-slate-500">{label}</span>
      <span className={`font-mono text-right break-all ${color}`}>{value}</span>
    </div>
  );
}

function permissionModeLabel(mode: PermissionMode): string {
  if (mode === 'deny') return 'İzin Verme';
  if (mode === 'full_access') return 'Tam Erişim';
  return 'Onay İste';
}

function PermissionModeCard({
  mode,
  active,
  title,
  description,
  tone,
  onClick,
}: {
  mode: PermissionMode;
  active: boolean;
  title: string;
  description: string;
  tone: 'neutral' | 'good' | 'warn';
  onClick: (mode: PermissionMode) => void;
}) {
  const activeClass = tone === 'good'
    ? 'border-emerald-400/60 bg-emerald-500/10'
    : tone === 'warn'
      ? 'border-amber-400/60 bg-amber-500/10'
      : 'border-cyan-400/60 bg-cyan-500/10';
  const idleClass = 'border-slate-800 bg-slate-950/65 hover:border-slate-600';
  const dotClass = tone === 'good'
    ? 'bg-emerald-300'
    : tone === 'warn'
      ? 'bg-amber-300'
      : 'bg-cyan-300';

  return (
    <button
      type="button"
      onClick={() => onClick(mode)}
      className={`text-left rounded-xl border p-4 transition-colors ${active ? activeClass : idleClass}`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold text-slate-100">{title}</span>
        <span className={`w-2.5 h-2.5 rounded-full ${active ? dotClass : 'bg-slate-700'}`} />
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-slate-400">{description}</p>
    </button>
  );
}

function ProviderStatus({ status }: { status: ProviderProfile['status'] }) {
  if (status === 'available') {
    return (
      <span className="px-2 py-0.5 rounded border border-emerald-500/30 bg-emerald-950/30 text-[10px] text-emerald-300 font-mono flex items-center gap-1">
        <ShieldCheck className="w-3 h-3" />
        AVAILABLE
      </span>
    );
  }
  if (status === 'unavailable') {
    return (
      <span className="px-2 py-0.5 rounded border border-red-500/30 bg-red-950/30 text-[10px] text-red-300 font-mono">
        OFFLINE
      </span>
    );
  }
  return (
    <span className="px-2 py-0.5 rounded border border-amber-500/30 bg-amber-950/30 text-[10px] text-amber-300 font-mono">
      SETUP
    </span>
  );
}
