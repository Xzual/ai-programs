import React, { useEffect, useState } from 'react';
import {
  Boxes,
  Slack,
  Github,
  BarChart3,
  Webhook,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Key,
  Globe,
  Info,
  RadioTower,
  Landmark,
} from 'lucide-react';
import { IntegrationConfig } from '../../types';

interface IntegrationsViewProps {
  integrations: IntegrationConfig[];
  onSaveIntegration: (id: string, updates: Partial<IntegrationConfig>) => void;
}

interface SensitiveCapabilityStatus {
  id: string;
  domain: 'iot' | 'finance';
  name: string;
  status: 'configuration_required';
  riskLevel: number;
  requiredPermissions: string[];
  supportedActions: string[];
  safetyBoundary: string;
}

export const IntegrationsView: React.FC<IntegrationsViewProps> = ({
  integrations,
  onSaveIntegration,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [tempKey, setTempKey] = useState('');
  const [tempUrl, setTempUrl] = useState('');
  const [sensitiveCapabilities, setSensitiveCapabilities] = useState<SensitiveCapabilityStatus[]>([]);

  useEffect(() => {
    fetch('/api/edith/integrations/capabilities')
      .then((response) => response.json())
      .then((data) => {
        if (data?.success && Array.isArray(data.capabilities)) {
          setSensitiveCapabilities(data.capabilities);
        }
      })
      .catch(() => setSensitiveCapabilities([]));
  }, []);

  const getIntegrationIcon = (iconName: string) => {
    switch (iconName) {
      case 'Slack':
        return <Slack className="w-6 h-6 text-emerald-400" />;
      case 'Github':
        return <Github className="w-6 h-6 text-slate-200" />;
      case 'BarChart3':
        return <BarChart3 className="w-6 h-6 text-yellow-400" />;
      case 'RadioTower':
        return <RadioTower className="w-6 h-6 text-cyan-300" />;
      case 'Landmark':
        return <Landmark className="w-6 h-6 text-amber-300" />;
      case 'Webhook':
      default:
        return <Webhook className="w-6 h-6 text-cyan-400" />;
    }
  };

  const startEditing = (item: IntegrationConfig) => {
    setEditingId(item.id);
    setTempKey(item.apiKey || '');
    setTempUrl(item.webhookUrl || '');
  };

  const handleSave = (id: string) => {
    onSaveIntegration(id, {
      apiKey: tempKey,
      webhookUrl: tempUrl,
      status: tempKey || tempUrl ? 'connected' : 'disconnected',
      enabled: !!(tempKey || tempUrl),
    });
    setEditingId(null);
  };

  const getCapabilityStatus = (item: IntegrationConfig): SensitiveCapabilityStatus | undefined => {
    if (item.id === 'iot_feedback') return sensitiveCapabilities.find((capability) => capability.domain === 'iot');
    if (item.id === 'finance_trading_guard') return sensitiveCapabilities.find((capability) => capability.domain === 'finance');
    return undefined;
  };

  return (
    <div className="flex-1 p-4 sm:p-6 overflow-y-auto bg-slate-950/60 custom-scrollbar">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6 pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <Boxes className="w-6 h-6 text-fuchsia-400" />
            <h1 className="text-xl font-bold text-slate-100">Dış Servis Entegrasyonları</h1>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Slack, GitHub ve Webhook bağlantılarınızı yerel olarak yapılandırın.
          </p>
        </div>
      </div>

      {/* Info Notice */}
      <div className="mb-6 p-4 rounded-2xl bg-slate-900/90 border border-purple-500/30 text-xs text-slate-300 flex items-start gap-3 shadow-xl">
        <Info className="w-5 h-5 text-fuchsia-400 shrink-0 mt-0.5" />
        <div className="space-y-1 leading-relaxed">
          <p className="font-semibold text-slate-100">Güvenlik ve Yapılandırma Uyarısı</p>
          <p className="text-slate-400">
            EDITH ön uç kodunda hassas API anahtarı barındırmaz. Aşağıdaki entegrasyonlar kullanıcı tarafından girilen webhook ve token bilgilerini sadece yerel makinenizdeki IndexedDB/LocalStorage hafızasında tutar.
          </p>
        </div>
      </div>

      {/* Integrations Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {integrations.map((item) => (
          <div
            key={item.id}
            className="p-5 rounded-lg bg-slate-900/80 border border-slate-800 hover:border-purple-500/30 transition-all flex flex-col justify-between space-y-4 shadow-xl"
          >
            {(() => {
              const capability = getCapabilityStatus(item);
              return (
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                  {getIntegrationIcon(item.iconName)}
                </div>
                <span
                  className={`px-2.5 py-1 rounded-full text-[10px] font-mono border flex items-center gap-1 ${
                    item.enabled
                      ? 'bg-emerald-950/80 border-emerald-500/40 text-emerald-300'
                      : 'bg-slate-950 border-slate-800 text-slate-500'
                  }`}
                >
                  {item.enabled ? (
                    <>
                      <CheckCircle2 className="w-3 h-3 text-emerald-400" /> Yapılandırıldı
                    </>
                  ) : (
                    <>
                      <XCircle className="w-3 h-3 text-slate-500" /> Devre Dışı
                    </>
                  )}
                </span>
              </div>

              <h3 className="text-sm font-semibold text-slate-100 mb-1">{item.name}</h3>
              <p className="text-xs text-slate-400 leading-relaxed mb-4">{item.description}</p>

              {capability && (
                <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-950/20 p-3 text-xs text-amber-100">
                  <div className="flex items-center gap-2 font-semibold">
                    <AlertTriangle className="h-4 w-4 text-amber-300" />
                    Yapılandırma Gerekli
                  </div>
                  <p className="mt-2 leading-relaxed text-amber-100/80">{capability.safetyBoundary}</p>
                  <p className="mt-2 font-mono text-[10px] uppercase tracking-wide text-amber-200/70">
                    İzinler: {capability.requiredPermissions.join(', ')}
                  </p>
                </div>
              )}

              {/* Edit Mode vs Display Mode */}
              {editingId === item.id ? (
                <div className="space-y-3 bg-slate-950 p-3 rounded-xl border border-slate-800 text-xs">
                  {item.webhookUrl !== undefined && (
                    <div>
                      <label className="block text-slate-400 mb-1 font-mono">Webhook URL:</label>
                      <input
                        type="text"
                        value={tempUrl}
                        onChange={(e) => setTempUrl(e.target.value)}
                        placeholder="https://hooks.slack.com/services/..."
                        className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-slate-200 text-xs focus:outline-none focus:border-purple-500 font-mono"
                      />
                    </div>
                  )}

                  {item.apiKey !== undefined && (
                    <div>
                      <label className="block text-slate-400 mb-1 font-mono">API Token / Key:</label>
                      <input
                        type="password"
                        value={tempKey}
                        onChange={(e) => setTempKey(e.target.value)}
                        placeholder="ghp_xxxxxxxxxxxx"
                        className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-slate-200 text-xs focus:outline-none focus:border-purple-500 font-mono"
                      />
                    </div>
                  )}

                  <div className="flex items-center justify-end gap-2 pt-1">
                    <button
                      onClick={() => setEditingId(null)}
                      className="px-3 py-1 rounded bg-slate-800 text-slate-300 text-xs"
                    >
                      İptal
                    </button>
                    <button
                      onClick={() => handleSave(item.id)}
                      className="px-3 py-1 rounded bg-purple-600 text-white text-xs font-medium shadow"
                    >
                      Kaydet
                    </button>
                  </div>
                </div>
              ) : (
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800/80 text-[11px] font-mono text-slate-400 flex items-center justify-between">
                  <span className="truncate">
                    {item.webhookUrl || item.apiKey ? '••••••••••••••••' : 'Bağlantı Yapılandırılmadı'}
                  </span>
                  <button
                    onClick={() => startEditing(item)}
                    className="text-purple-400 hover:text-purple-300 font-sans text-xs underline font-medium shrink-0 ml-2"
                  >
                    Düzenle
                  </button>
                </div>
              )}
            </div>
              );
            })()}
          </div>
        ))}
      </div>
    </div>
  );
};
