import React, { useState } from 'react';
import {
  Zap,
  Folder,
  FileText,
  Bell,
  BarChart3,
  CheckCircle2,
  AlertCircle,
  Clock,
  ShieldAlert,
  Play,
  Terminal,
  Download,
  Globe,
  Cpu,
  CloudSun,
  FileCode2,
  Bot,
  Youtube,
  Eye,
  Plane,
  MonitorCheck,
  Chrome,
  Search,
  Filter,
  X,
} from 'lucide-react';
import { AutomationTool, ToolExecutionLog, ToolInputField } from '../../types';

interface AutomationsViewProps {
  tools: AutomationTool[];
  logs: ToolExecutionLog[];
  onExecuteTool: (toolId: string, args?: Record<string, any>) => Promise<void>;
  onToggleToolConfirmation: (toolId: string) => void;
}

// ── Kategori meta ─────────────────────────────────────────────────────────────
const CATEGORY_META: Record<string, { label: string; color: string; bg: string; border: string }> = {
  file:    { label: 'Dosya',       color: 'text-cyan-400',    bg: 'bg-cyan-950/60',    border: 'border-cyan-500/30' },
  system:  { label: 'Sistem',      color: 'text-violet-400',  bg: 'bg-violet-950/60',  border: 'border-violet-500/30' },
  reminder:{ label: 'Hatırlatıcı', color: 'text-amber-400',   bg: 'bg-amber-950/60',   border: 'border-amber-500/30' },
  analytics:{ label: 'Analitik',   color: 'text-emerald-400', bg: 'bg-emerald-950/60', border: 'border-emerald-500/30' },
  web:     { label: 'Web',         color: 'text-blue-400',    bg: 'bg-blue-950/60',    border: 'border-blue-500/30' },
  media:   { label: 'Medya',       color: 'text-rose-400',    bg: 'bg-rose-950/60',    border: 'border-rose-500/30' },
  code:    { label: 'Kod',         color: 'text-fuchsia-400', bg: 'bg-fuchsia-950/60', border: 'border-fuchsia-500/30' },
  monitor: { label: 'İzleme',      color: 'text-teal-400',    bg: 'bg-teal-950/60',    border: 'border-teal-500/30' },
};

// ── Araç ikonu ────────────────────────────────────────────────────────────────
function ToolIcon({ id, className = 'w-5 h-5' }: { id: string; className?: string }) {
  const map: Record<string, React.ReactNode> = {
    list_dir:           <Folder      className={`${className} text-cyan-400`} />,
    read_file:          <FileText    className={`${className} text-purple-400`} />,
    export_markdown:    <Download    className={`${className} text-fuchsia-400`} />,
    schedule_reminder:  <Bell        className={`${className} text-amber-400`} />,
    summarize_analytics:<BarChart3   className={`${className} text-emerald-400`} />,
    web_search:         <Search      className={`${className} text-blue-400`} />,
    system_monitor:     <Cpu         className={`${className} text-violet-400`} />,
    browser_open:       <Chrome      className={`${className} text-yellow-400`} />,
    browser_search:     <Search      className={`${className} text-blue-400`} />,
    browser_use_agent:  <Chrome      className={`${className} text-orange-400`} />,
    playwright_browser_agent:<Chrome className={`${className} text-cyan-400`} />,
    open_interpreter_agent:<Terminal className={`${className} text-red-400`} />,
    computer_control_agent:<MonitorCheck className={`${className} text-red-400`} />,
    task_create:        <Bot         className={`${className} text-cyan-400`} />,
    ai_skill_catalog:   <Bot         className={`${className} text-emerald-400`} />,
    weather_report:     <CloudSun    className={`${className} text-sky-400`} />,
    file_processor:     <FileCode2   className={`${className} text-orange-400`} />,
    code_helper:        <Terminal    className={`${className} text-fuchsia-400`} />,
    dev_agent:          <Bot         className={`${className} text-pink-400`} />,
    youtube_control:    <Youtube     className={`${className} text-red-400`} />,
    background_monitor: <Eye         className={`${className} text-teal-400`} />,
    screen_processor:   <MonitorCheck className={`${className} text-indigo-400`} />,
    flight_finder:      <Plane       className={`${className} text-blue-300`} />,
    browser_control:    <Chrome      className={`${className} text-yellow-400`} />,
  };
  return <>{map[id] ?? <Zap className={`${className} text-purple-400`} />}</>;
}

// ── Durum badge ───────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: AutomationTool['status'] }) {
  const map = {
    success: { cls: 'bg-emerald-950/80 border-emerald-500/30 text-emerald-300', label: 'Başarılı', icon: <CheckCircle2 className="w-3 h-3" /> },
    error:   { cls: 'bg-red-950/80 border-red-500/30 text-red-300',             label: 'Hatalı',   icon: <AlertCircle  className="w-3 h-3" /> },
    running: { cls: 'bg-blue-950/80 border-blue-500/30 text-blue-300',          label: 'Çalışıyor',icon: <Clock        className="w-3 h-3 animate-spin" /> },
    idle:    { cls: 'bg-slate-950 border-slate-800 text-slate-400',             label: 'Hazır',    icon: null },
  };
  const m = map[status] ?? map.idle;
  return (
    <span className={`px-2 py-0.5 rounded text-[10px] font-mono border flex items-center gap-1 ${m.cls}`}>
      {m.icon}{m.label}
    </span>
  );
}

// ── Dinamik input alanı ───────────────────────────────────────────────────────
function DynamicField({
  field, value, onChange,
}: {
  field: ToolInputField;
  value: string;
  onChange: (v: string) => void;
}) {
  const base =
    'w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-purple-500/60 transition-colors';

  if (field.type === 'select') {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)} className={base}>
        {(field.options ?? []).map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    );
  }
  if (field.type === 'textarea') {
    return (
      <textarea
        rows={3}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={field.placeholder}
        className={`${base} resize-none`}
      />
    );
  }
  return (
    <input
      type={field.type === 'number' ? 'number' : 'text'}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={field.placeholder}
      className={base}
    />
  );
}

// ═════════════════════════════════════════════════════════════════════════════
export const AutomationsView: React.FC<AutomationsViewProps> = ({
  tools,
  logs,
  onExecuteTool,
  onToggleToolConfirmation,
}) => {
  const [selectedTool, setSelectedTool] = useState<AutomationTool | null>(null);
  const [fieldValues, setFieldValues]   = useState<Record<string, string>>({});
  const [isExecuting, setIsExecuting]   = useState(false);
  const [activeTab, setActiveTab]       = useState<'tools' | 'logs'>('tools');
  const [filterCat, setFilterCat]       = useState<string>('all');
  const [searchTerm, setSearchTerm]     = useState('');

  // Mevcut kategoriler
  const toolCategories = Array.from(
    new Set<AutomationTool['category']>(tools.map((t) => t.category))
  );
  const categories: Array<'all' | AutomationTool['category']> = ['all', ...toolCategories];

  // Filtreli araç listesi
  const filteredTools = tools.filter((t) => {
    const catMatch  = filterCat === 'all' || t.category === filterCat;
    const termMatch = !searchTerm || t.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      t.description.toLowerCase().includes(searchTerm.toLowerCase());
    return catMatch && termMatch;
  });

  const handleToolClick = (tool: AutomationTool) => {
    setSelectedTool(tool);
    // Varsayılan değerleri set et
    const defaults: Record<string, string> = {};
    for (const f of tool.inputFields ?? []) {
      defaults[f.key] = f.defaultValue ?? '';
    }
    setFieldValues(defaults);
  };

  const handleConfirmRun = async () => {
    if (!selectedTool) return;
    setIsExecuting(true);
    // Sayısal alanları dönüştür
    const args: Record<string, any> = {};
    for (const [k, v] of Object.entries(fieldValues)) {
      const field = selectedTool.inputFields?.find((f) => f.key === k);
      args[k] = field?.type === 'number' ? Number(v) : v;
    }
    await onExecuteTool(selectedTool.id, args);
    setIsExecuting(false);
    setSelectedTool(null);
  };

  const catMeta = (cat: string) => CATEGORY_META[cat] ?? CATEGORY_META['file'];

  return (
    <div className="flex-1 p-4 sm:p-6 overflow-y-auto bg-slate-950/60 custom-scrollbar">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6 pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <Zap className="w-6 h-6 text-fuchsia-400" />
            <h1 className="text-xl font-bold text-slate-100">Otomasyon & Araçlar</h1>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Mark-L skill'leriyle güçlendirilmiş — {tools.length} araç mevcut
          </p>
        </div>

        {/* Tab Toggle */}
        <div className="flex bg-slate-900 border border-slate-800 p-1 rounded-xl text-xs">
          <button
            onClick={() => setActiveTab('tools')}
            className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
              activeTab === 'tools' ? 'bg-purple-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Araçlar ({tools.length})
          </button>
          <button
            onClick={() => setActiveTab('logs')}
            className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
              activeTab === 'logs' ? 'bg-purple-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Günlük ({logs.length})
          </button>
        </div>
      </div>

      {activeTab === 'tools' ? (
        <>
          {/* ── Filtreler ──────────────────────────────────────────────────── */}
          <div className="flex flex-col sm:flex-row gap-3 mb-5">
            {/* Arama */}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Araç ara..."
                className="w-full pl-9 pr-4 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-purple-500/50"
              />
              {searchTerm && (
                <button onClick={() => setSearchTerm('')} className="absolute right-3 top-1/2 -translate-y-1/2">
                  <X className="w-3.5 h-3.5 text-slate-500 hover:text-slate-300" />
                </button>
              )}
            </div>

            {/* Kategori filtreleri */}
            <div className="flex flex-wrap gap-1.5">
              {categories.map((cat) => {
                const m = cat === 'all'
                  ? { label: 'Tümü', color: 'text-slate-300', bg: 'bg-slate-800', border: 'border-slate-700' }
                  : catMeta(cat);
                return (
                  <button
                    key={cat}
                    onClick={() => setFilterCat(cat)}
                    className={`px-3 py-1.5 rounded-lg text-[11px] font-medium border transition-all ${
                      filterCat === cat
                        ? `${m.bg} ${m.border} ${m.color} shadow-sm`
                        : 'bg-slate-900/60 border-slate-800 text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    {cat === 'all' ? 'Tümü' : m.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── Araç Grid ──────────────────────────────────────────────────── */}
          {filteredTools.length === 0 ? (
            <div className="text-center py-16 text-slate-500 text-sm">
              <Filter className="w-8 h-8 mx-auto mb-3 opacity-40" />
              Araç bulunamadı.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {filteredTools.map((tool) => {
                const meta = catMeta(tool.category);
                return (
                  <div
                    key={tool.id}
                    className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 hover:border-purple-500/40 transition-all flex flex-col justify-between space-y-4 group shadow-lg"
                  >
                    <div>
                      {/* Header */}
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2.5">
                          <div className={`p-2 rounded-xl ${meta.bg} border ${meta.border} group-hover:scale-105 transition-transform`}>
                            <ToolIcon id={tool.id} />
                          </div>
                          <span className={`px-2 py-0.5 rounded-md text-[10px] font-semibold border ${meta.bg} ${meta.border} ${meta.color}`}>
                            {meta.label}
                          </span>
                        </div>
                        <StatusBadge status={tool.status} />
                      </div>

                      <h3 className="text-sm font-semibold text-slate-100 mb-1">{tool.name}</h3>
                      <p className="text-xs text-slate-400 leading-relaxed mb-3">{tool.description}</p>

                      {/* Meta info */}
                      <div className="space-y-1 text-[11px] font-mono text-slate-500 border-t border-slate-800/80 pt-2.5">
                        <div className="flex items-center justify-between">
                          <span>İzinler:</span>
                          <span className="text-slate-400 text-right max-w-[60%] truncate">{tool.permissions.join(', ')}</span>
                        </div>
                        {tool.lastRun && (
                          <div className="flex items-center justify-between">
                            <span>Son Çalıştırma:</span>
                            <span className="text-slate-400">{new Date(tool.lastRun).toLocaleTimeString('tr-TR')}</span>
                          </div>
                        )}
                        <div className="flex items-center justify-between">
                          <span>Onay:</span>
                          <button
                            onClick={() => onToggleToolConfirmation(tool.id)}
                            className={`px-2 py-0.5 rounded text-[10px] font-mono transition-colors ${
                              tool.requiresConfirmation
                                ? 'bg-amber-950 text-amber-300 border border-amber-500/40'
                                : 'bg-slate-950 text-slate-500 border border-slate-800'
                            }`}
                          >
                            {tool.requiresConfirmation ? 'Manuel' : 'Otomatik'}
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Run Button */}
                    <button
                      onClick={() => handleToolClick(tool)}
                      className="w-full py-2.5 rounded-xl bg-purple-600/20 hover:bg-purple-600/30 border border-purple-500/40 text-purple-200 text-xs font-semibold flex items-center justify-center gap-1.5 transition-all group-hover:border-purple-400 group-hover:shadow-lg group-hover:shadow-purple-900/20"
                    >
                      <Play className="w-3.5 h-3.5 fill-current" />
                      Çalıştır
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </>
      ) : (
        /* ── Logs ──────────────────────────────────────────────────────────── */
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
          <div className="p-4 border-b border-slate-800 font-semibold text-xs text-slate-200 flex items-center gap-2">
            <Terminal className="w-4 h-4 text-fuchsia-400" />
            Tüm Araç Çağrı Kayıtları
            {logs.length > 0 && (
              <span className="ml-auto text-slate-500 font-mono">{logs.length} kayıt</span>
            )}
          </div>
          {logs.length === 0 ? (
            <div className="p-10 text-center text-xs text-slate-500 font-mono">
              Henüz araç çağrısı yapılmadı.
            </div>
          ) : (
            <div className="divide-y divide-slate-800/80 text-xs font-mono">
              {logs.map((log) => (
                <div key={log.id} className="p-4 space-y-2 hover:bg-slate-800/30 transition-colors">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      <ToolIcon id={log.toolId} className="w-4 h-4" />
                      <span className="font-bold text-slate-200">{log.toolName}</span>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] border ${
                        log.status === 'success'
                          ? 'bg-emerald-950 border-emerald-500/30 text-emerald-300'
                          : log.status === 'error'
                          ? 'bg-red-950 border-red-500/30 text-red-300'
                          : 'bg-slate-950 border-slate-700 text-slate-400'
                      }`}>
                        {log.status === 'success' ? '✓' : log.status === 'error' ? '✕' : '—'}
                      </span>
                    </div>
                    <span className="text-[10px] text-slate-500">
                      {new Date(log.timestamp).toLocaleString('tr-TR')}
                    </span>
                  </div>
                  <pre className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-slate-300 text-[11px] overflow-x-auto whitespace-pre-wrap max-h-48">
                    {log.result}
                  </pre>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Çalıştır / Onay Modalı ─────────────────────────────────────────── */}
      {selectedTool && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 max-w-lg w-full shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto custom-scrollbar">

            {/* Modal Header */}
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className={`p-2.5 rounded-xl border ${catMeta(selectedTool.category).bg} ${catMeta(selectedTool.category).border}`}>
                  <ToolIcon id={selectedTool.id} className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-100">{selectedTool.name}</h3>
                  <p className="text-[11px] text-slate-400">{selectedTool.permissions.join(' · ')}</p>
                </div>
              </div>
              <button onClick={() => setSelectedTool(null)} className="text-slate-500 hover:text-slate-300 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Açıklama */}
            <p className="text-xs text-slate-300 leading-relaxed bg-slate-950/60 p-3 rounded-xl border border-slate-800/80">
              {selectedTool.description}
            </p>

            {/* Dinamik Input Alanları */}
            {(selectedTool.inputFields ?? []).length > 0 && (
              <div className="space-y-3">
                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Parametreler</p>
                {selectedTool.inputFields!.map((field) => (
                  <div key={field.key} className="space-y-1">
                    <label className="text-[11px] text-slate-400 flex items-center gap-1">
                      {field.label}
                      {field.required && <span className="text-red-400">*</span>}
                    </label>
                    <DynamicField
                      field={field}
                      value={fieldValues[field.key] ?? field.defaultValue ?? ''}
                      onChange={(v) => setFieldValues((prev) => ({ ...prev, [field.key]: v }))}
                    />
                  </div>
                ))}
              </div>
            )}

            {/* Onay Uyarısı */}
            {selectedTool.requiresConfirmation && (
              <div className="p-2.5 rounded-xl bg-amber-950/40 border border-amber-500/30 text-amber-200 text-xs flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
                <span>Bu işlem için açık kullanıcı onayı gereklidir.</span>
              </div>
            )}

            {/* Aksiyonlar */}
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                onClick={() => setSelectedTool(null)}
                disabled={isExecuting}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors disabled:opacity-50"
              >
                İptal
              </button>
              <button
                onClick={handleConfirmRun}
                disabled={isExecuting}
                className="px-5 py-2 rounded-xl bg-gradient-to-r from-purple-600 to-fuchsia-600 hover:from-purple-500 hover:to-fuchsia-500 text-white text-xs font-semibold shadow-lg shadow-purple-600/20 flex items-center gap-1.5 transition-all disabled:opacity-60"
              >
                {isExecuting ? (
                  <>
                    <Clock className="w-3.5 h-3.5 animate-spin" />
                    Çalıştırılıyor...
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5 fill-current" />
                    Çalıştır
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
