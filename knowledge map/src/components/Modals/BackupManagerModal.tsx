import React, { useState, useRef } from 'react';
import {
  ShieldCheck,
  Download,
  Upload,
  Clock,
  RotateCcw,
  Trash2,
  Plus,
  FileText,
  CheckCircle2,
  AlertCircle,
  HardDrive,
  RefreshCw,
  X,
  FileJson,
  Calendar,
  Sparkles
} from 'lucide-react';
import { BackupSnapshot, MapData } from '../../types';
import confetti from 'canvas-confetti';

interface BackupManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  isDarkMode: boolean;
  currentData: MapData;
  snapshots: BackupSnapshot[];
  backupInterval: number;
  lastBackupTime: number | null;
  onRestoreSnapshot: (snapshot: BackupSnapshot) => void;
  onManualBackup: (name?: string) => void;
  onDeleteSnapshot: (snapshotId: string) => void;
  onChangeBackupInterval: (seconds: number) => void;
  onExportJSON: () => void;
  onExportMarkdown: () => void;
  onImportJSON: (importedData: MapData) => void;
}

export const BackupManagerModal: React.FC<BackupManagerModalProps> = ({
  isOpen,
  onClose,
  isDarkMode,
  currentData,
  snapshots,
  backupInterval,
  lastBackupTime,
  onRestoreSnapshot,
  onManualBackup,
  onDeleteSnapshot,
  onChangeBackupInterval,
  onExportJSON,
  onExportMarkdown,
  onImportJSON
}) => {
  const [customBackupName, setCustomBackupName] = useState('');
  const [restoreConfirmId, setRestoreConfirmId] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleManualBackup = (e: React.FormEvent) => {
    e.preventDefault();
    onManualBackup(customBackupName.trim() || undefined);
    setCustomBackupName('');
    confetti({ particleCount: 30, spread: 60, origin: { y: 0.8 } });
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const parsed = JSON.parse(text);
        const mapData: MapData = parsed.map || parsed;

        if (!mapData || !Array.isArray(mapData.nodes)) {
          throw new Error('Geçersiz yedek dosyası formatı. Düğümler listesi bulunamadı.');
        }

        onImportJSON(mapData);
        setImportSuccess(`"${mapData.title || 'Harita'}" başarıyla içe aktarıldı!`);
        setImportError(null);
        confetti({ particleCount: 50, spread: 70, origin: { y: 0.6 } });
        setTimeout(() => setImportSuccess(null), 4000);
      } catch (err: any) {
        setImportError(err.message || 'Dosya okunurken hata oluştu.');
        setImportSuccess(null);
      }
    };
    reader.readAsText(file);
  };

  const handleConfirmRestore = (snapshot: BackupSnapshot) => {
    onRestoreSnapshot(snapshot);
    setRestoreConfirmId(null);
    confetti({ particleCount: 40, spread: 60, origin: { y: 0.7 } });
  };

  return (
    <div
      id="backup-manager-modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-in fade-in-50 duration-200"
      onClick={onClose}
    >
      <div
        id="backup-manager-modal"
        onClick={(e) => e.stopPropagation()}
        className={`w-full max-w-3xl max-h-[85vh] flex flex-col rounded-3xl border shadow-2xl overflow-hidden backdrop-blur-2xl transition-all ${
          isDarkMode
            ? 'bg-[#080911]/90 border-white/10 text-slate-100 shadow-indigo-950/30'
            : 'bg-white/90 border-slate-200/80 text-slate-900'
        }`}
      >
        {/* Modal Header */}
        <div className="p-5 border-b border-black/5 dark:border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-500/15 border border-emerald-400/20 text-emerald-400 flex items-center justify-center">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <h2 className="font-bold text-lg tracking-tight flex items-center gap-2">
                Otomatik Veri Yedekleme & Güvenlik Merkezi
                <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-400/20">
                  Güvenli Depolama Aktif
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Tüm değişiklikler anlık yerel belleğe ve periyodik geri yükleme noktalarına kaydedilir.
              </p>
            </div>
          </div>

          <button
            id="btn-close-backup-modal"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-200 hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Status Banners & Actions Grid */}
        <div className="p-5 overflow-y-auto space-y-5 flex-1">
          {/* Top Quick Status Bar */}
          <div
            className={`p-4 rounded-2xl border flex flex-col sm:flex-row items-center justify-between gap-4 backdrop-blur-md ${
              isDarkMode
                ? 'bg-white/[0.04] border-white/10'
                : 'bg-slate-50/80 border-slate-200'
            }`}
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-500/15 border border-indigo-400/20 text-indigo-400 flex items-center justify-center shrink-0">
                <Clock className="w-5 h-5" />
              </div>
              <div>
                <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  Otomatik Yedekleme Aralığı
                </div>
                <div className="text-sm font-bold flex items-center gap-2">
                  <span>Her {Math.round(backupInterval / 60)} dakikada bir</span>
                  {lastBackupTime && (
                    <span className="text-xs font-normal text-slate-400">
                      (Son yedek: {new Date(lastBackupTime).toLocaleTimeString('tr-TR')})
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Interval Selector */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-slate-400">Aralık:</span>
              <select
                id="select-backup-interval"
                value={backupInterval}
                onChange={(e) => onChangeBackupInterval(Number(e.target.value))}
                className={`px-3 py-1.5 rounded-xl border text-xs font-semibold outline-none cursor-pointer transition-all ${
                  isDarkMode
                    ? 'bg-white/5 border-white/10 text-white focus:border-indigo-400/60'
                    : 'bg-white border-slate-300 text-slate-900'
                }`}
              >
                <option value={60} className={isDarkMode ? 'bg-slate-900 text-white' : ''}>1 Dakika (Hızlı)</option>
                <option value={180} className={isDarkMode ? 'bg-slate-900 text-white' : ''}>3 Dakika (Önerilen)</option>
                <option value={300} className={isDarkMode ? 'bg-slate-900 text-white' : ''}>5 Dakika</option>
                <option value={600} className={isDarkMode ? 'bg-slate-900 text-white' : ''}>10 Dakika</option>
              </select>
            </div>
          </div>

          {/* Quick Action Buttons Bar: Manual Backup, Export JSON, Export Markdown, Import */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* 1. Export JSON */}
            <button
              id="btn-export-json"
              onClick={onExportJSON}
              className={`p-3.5 rounded-2xl border flex items-center gap-3 transition-all hover:scale-[1.02] text-left group backdrop-blur-md ${
                isDarkMode
                  ? 'bg-white/[0.04] border-white/10 hover:border-indigo-400/50 hover:bg-white/[0.08] text-slate-200'
                  : 'bg-white border-slate-200 hover:border-indigo-500/50 text-slate-800'
              }`}
            >
              <div className="p-2.5 rounded-xl bg-indigo-500/15 border border-indigo-400/20 text-indigo-400 group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                <FileJson className="w-5 h-5" />
              </div>
              <div>
                <div className="font-semibold text-xs">JSON Dışa Aktar</div>
                <div className="text-[11px] text-slate-400">Yedek dosyasını (.json) indir</div>
              </div>
            </button>

            {/* 2. Export Markdown */}
            <button
              id="btn-export-markdown"
              onClick={onExportMarkdown}
              className={`p-3.5 rounded-2xl border flex items-center gap-3 transition-all hover:scale-[1.02] text-left group backdrop-blur-md ${
                isDarkMode
                  ? 'bg-white/[0.04] border-white/10 hover:border-emerald-400/50 hover:bg-white/[0.08] text-slate-200'
                  : 'bg-white border-slate-200 hover:border-emerald-500/50 text-slate-800'
              }`}
            >
              <div className="p-2.5 rounded-xl bg-emerald-500/15 border border-emerald-400/20 text-emerald-400 group-hover:bg-emerald-600 group-hover:text-white transition-colors">
                <FileText className="w-5 h-5" />
              </div>
              <div>
                <div className="font-semibold text-xs">Markdown Çıktısı</div>
                <div className="text-[11px] text-slate-400">Obsidian & Notion uyumlu</div>
              </div>
            </button>

            {/* 3. Import from file */}
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                onChange={handleFileChange}
                className="hidden"
              />
              <button
                id="btn-import-json-trigger"
                onClick={() => fileInputRef.current?.click()}
                className={`w-full p-3.5 rounded-2xl border flex items-center gap-3 transition-all hover:scale-[1.02] text-left group backdrop-blur-md ${
                  isDarkMode
                    ? 'bg-white/[0.04] border-white/10 hover:border-cyan-400/50 hover:bg-white/[0.08] text-slate-200'
                    : 'bg-white border-slate-200 hover:border-cyan-500/50 text-slate-800'
                }`}
              >
                <div className="p-2.5 rounded-xl bg-cyan-500/15 border border-cyan-400/20 text-cyan-400 group-hover:bg-cyan-600 group-hover:text-white transition-colors">
                  <Upload className="w-5 h-5" />
                </div>
                <div>
                  <div className="font-semibold text-xs">Yedekten İçe Aktar</div>
                  <div className="text-[11px] text-slate-400">JSON dosyasını yükle</div>
                </div>
              </button>
            </div>
          </div>

          {/* Import Feedback Messages */}
          {importSuccess && (
            <div className="p-3 rounded-xl bg-emerald-500/15 border border-emerald-400/30 text-emerald-400 text-xs flex items-center gap-2 backdrop-blur-md">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{importSuccess}</span>
            </div>
          )}

          {importError && (
            <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-400/30 text-rose-400 text-xs flex items-center gap-2 backdrop-blur-md">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{importError}</span>
            </div>
          )}

          {/* Manual Snapshot Creation Form */}
          <form
            onSubmit={handleManualBackup}
            className={`p-4 rounded-2xl border flex flex-col sm:flex-row items-center gap-3 backdrop-blur-md ${
              isDarkMode ? 'bg-white/[0.04] border-white/10' : 'bg-slate-50 border-slate-200'
            }`}
          >
            <div className="flex-1 w-full">
              <input
                id="input-manual-snapshot-name"
                type="text"
                placeholder="Örn: AI Mimarisi Versiyon 2 (İsteğe bağlı isim)..."
                value={customBackupName}
                onChange={(e) => setCustomBackupName(e.target.value)}
                className={`w-full px-3.5 py-2 text-xs rounded-xl border outline-none font-medium transition-all ${
                  isDarkMode
                    ? 'bg-white/5 border-white/10 text-white placeholder-slate-500 focus:border-indigo-400/60 focus:bg-white/10'
                    : 'bg-white border-slate-300 text-slate-900 focus:border-indigo-500'
                }`}
              />
            </div>
            <button
              id="btn-take-manual-backup"
              type="submit"
              className="w-full sm:w-auto px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-xl flex items-center justify-center gap-1.5 shadow-lg shadow-indigo-600/30 transition-all shrink-0 active:scale-95"
            >
              <Plus className="w-4 h-4" />
              <span>Hemen Manuel Yedek Al</span>
            </button>
          </form>

          {/* Snapshots Timeline List */}
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-sm tracking-tight flex items-center gap-2">
                <Calendar className="w-4 h-4 text-indigo-400" />
                Geri Yükleme Noktaları & Zaman Çizelgesi
                <span className="text-xs font-normal text-slate-400">
                  ({snapshots.length} kayıtlı nokta)
                </span>
              </h3>
            </div>

            {snapshots.length === 0 ? (
              <div className="text-center py-8 text-slate-400 text-xs">
                Henüz kayıtlı bir geri yükleme noktası yok. İlk otomatik yedek birkaç dakika içinde oluşturulacaktır.
              </div>
            ) : (
              <div className="space-y-2.5 max-h-64 overflow-y-auto pr-1">
                {snapshots.map((snap) => {
                  const isConfirming = restoreConfirmId === snap.id;
                  return (
                    <div
                      key={snap.id}
                      id={`snapshot-card-${snap.id}`}
                      className={`p-3.5 rounded-2xl border transition-all flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 backdrop-blur-xl ${
                        isDarkMode
                          ? 'bg-white/[0.04] border-white/10 hover:border-white/20 hover:bg-white/[0.07]'
                          : 'bg-white border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-md uppercase tracking-wider ${
                              snap.triggerType === 'manual'
                                ? 'bg-amber-500/15 text-amber-400 border border-amber-400/20'
                                : snap.triggerType === 'import'
                                ? 'bg-cyan-500/15 text-cyan-400 border border-cyan-400/20'
                                : 'bg-indigo-500/15 text-indigo-400 border border-indigo-400/20'
                            }`}
                          >
                            {snap.triggerType === 'manual'
                              ? 'Manuel'
                              : snap.triggerType === 'import'
                              ? 'İçe Aktarma'
                              : 'Otomatik'}
                          </span>
                          <span className="font-semibold text-xs truncate">{snap.name}</span>
                        </div>

                        <div className="text-[11px] text-slate-400 flex items-center gap-3">
                          <span>{new Date(snap.timestamp).toLocaleString('tr-TR')}</span>
                          <span>•</span>
                          <span>
                            {snap.nodeCount} Düğüm, {snap.edgeCount} Bağlantı, {snap.inboxCount} Havuz Notu
                          </span>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                        {isConfirming ? (
                          <div className="flex items-center gap-1.5 animate-in fade-in-50">
                            <button
                              onClick={() => handleConfirmRestore(snap)}
                              className="px-2.5 py-1 bg-rose-600 hover:bg-rose-500 text-white text-[11px] font-bold rounded-lg shadow-md shadow-rose-600/30"
                            >
                              Evet, Geri Yükle
                            </button>
                            <button
                              onClick={() => setRestoreConfirmId(null)}
                              className="px-2 py-1 text-slate-400 hover:text-slate-200 text-[11px]"
                            >
                              İptal
                            </button>
                          </div>
                        ) : (
                          <button
                            id={`btn-restore-snap-${snap.id}`}
                            onClick={() => setRestoreConfirmId(snap.id)}
                            className="px-3 py-1.5 rounded-xl bg-indigo-500/15 hover:bg-indigo-600 hover:text-white text-indigo-400 border border-indigo-400/20 transition-all flex items-center gap-1.5 text-xs font-semibold"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span>Geri Yükle</span>
                          </button>
                        )}

                        <button
                          id={`btn-delete-snap-${snap.id}`}
                          title="Yedek Noktasını Sil"
                          onClick={() => onDeleteSnapshot(snap.id)}
                          className="p-1.5 rounded-xl text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-black/5 dark:border-white/10 flex items-center justify-between text-xs text-slate-400">
          <div className="flex items-center gap-2">
            <HardDrive className="w-4 h-4 text-emerald-400" />
            <span>Aktif Harita: {currentData.nodes.length} Düğüm | {currentData.edges.length} Bağlantı</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium shadow-md shadow-indigo-600/30 transition-all active:scale-95"
          >
            Tamam
          </button>
        </div>
      </div>
    </div>
  );
};
