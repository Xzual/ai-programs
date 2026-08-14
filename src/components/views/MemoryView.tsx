import React, { useState } from 'react';
import {
  Brain,
  Plus,
  Trash2,
  Shield,
  Search,
  Tag,
  AlertTriangle,
  User,
  Check,
  RotateCcw,
} from 'lucide-react';
import { MemoryItem, MemoryCategory } from '../../types';

interface MemoryViewProps {
  memories: MemoryItem[];
  onAddMemory: (category: MemoryCategory, key: string, value: string, isSensitive?: boolean) => void;
  onDeleteMemory: (id: string) => void;
  onClearAllMemories: () => void;
}

export const MemoryView: React.FC<MemoryViewProps> = ({
  memories,
  onAddMemory,
  onDeleteMemory,
  onClearAllMemories,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [newCategory, setNewCategory] = useState<MemoryCategory>('user_pref');
  const [isSensitive, setIsSensitive] = useState(false);
  const [showConfirmClear, setShowConfirmClear] = useState(false);

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKey.trim() || !newValue.trim()) return;
    onAddMemory(newCategory, newKey.trim(), newValue.trim(), isSensitive);
    setNewKey('');
    setNewValue('');
    setIsSensitive(false);
  };

  const filteredMemories = memories.filter((m) => {
    const matchesCat = selectedCategory === 'all' || m.category === selectedCategory;
    const matchesSearch =
      m.key.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.value.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCat && matchesSearch;
  });

  const getCategoryBadge = (cat: MemoryCategory) => {
    switch (cat) {
      case 'user_pref':
        return <span className="px-2 py-0.5 rounded bg-blue-950/80 border border-blue-500/30 text-blue-300 text-[10px]">Kullanıcı Tercihi</span>;
      case 'fact':
        return <span className="px-2 py-0.5 rounded bg-purple-950/80 border border-purple-500/30 text-purple-300 text-[10px]">Gerçek / Bilgi</span>;
      case 'summary':
        return <span className="px-2 py-0.5 rounded bg-fuchsia-950/80 border border-fuchsia-500/30 text-fuchsia-300 text-[10px]">Özet</span>;
      case 'custom':
      default:
        return <span className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300 text-[10px]">Özel</span>;
    }
  };

  return (
    <div className="flex-1 p-4 sm:p-6 overflow-y-auto bg-slate-950/60 custom-scrollbar">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6 pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <Brain className="w-6 h-6 text-fuchsia-400" />
            <h1 className="text-xl font-bold text-slate-100">Kişisel Bellek Paneli</h1>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            AURA'nın sizinle ilgili hatırladığı tüm bilgiler ve kişiselleştirilmiş ayarlar.
          </p>
        </div>

        <button
          onClick={() => setShowConfirmClear(true)}
          className="px-3 py-1.5 rounded-xl bg-red-950/40 hover:bg-red-900/60 border border-red-500/30 text-red-300 text-xs font-medium flex items-center gap-1.5 transition-colors"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Tüm Belleği Temizle
        </button>
      </div>

      {/* Main Grid Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Add Memory Form */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 sm:p-5 h-fit shadow-xl">
          <h2 className="text-sm font-semibold text-slate-200 mb-3 flex items-center gap-2">
            <Plus className="w-4 h-4 text-purple-400" />
            Yeni Bellek Ekle ("Bunu Hatırla")
          </h2>

          <form onSubmit={handleAdd} className="space-y-3 text-xs">
            <div>
              <label className="block text-slate-400 mb-1 font-medium">Kategori</label>
              <select
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value as MemoryCategory)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-200 focus:outline-none focus:border-purple-500"
              >
                <option value="user_pref">Kullanıcı Tercihi</option>
                <option value="fact">Gerçek / Kişisel Bilgi</option>
                <option value="summary">Özet Not</option>
                <option value="custom">Özel Kayıt</option>
              </select>
            </div>

            <div>
              <label className="block text-slate-400 mb-1 font-medium">Başlık / Anahtar</label>
              <input
                type="text"
                placeholder="Örn: Sık Kullanılan Programlama Dili"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-200 placeholder-slate-600 focus:outline-none focus:border-purple-500"
              />
            </div>

            <div>
              <label className="block text-slate-400 mb-1 font-medium">İçerik / Değer</label>
              <textarea
                placeholder="Örn: TypeScript ve Python projelerine öncelik verilmesini isterim."
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                rows={3}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-200 placeholder-slate-600 focus:outline-none focus:border-purple-500 resize-none"
              />
            </div>

            <div className="flex items-center gap-2 pt-1">
              <input
                type="checkbox"
                id="sensitiveCheck"
                checked={isSensitive}
                onChange={(e) => setIsSensitive(e.target.checked)}
                className="rounded border-slate-800 bg-slate-950 text-purple-600 focus:ring-purple-500"
              />
              <label htmlFor="sensitiveCheck" className="text-slate-400 text-[11px]">
                Hassas Bilgi (Gizlilik Uyarısı Ekler)
              </label>
            </div>

            <button
              type="submit"
              disabled={!newKey.trim() || !newValue.trim()}
              className="w-full py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-fuchsia-600 hover:from-purple-500 hover:to-fuchsia-500 disabled:opacity-50 text-white font-medium shadow-lg shadow-purple-600/20 transition-all flex items-center justify-center gap-1.5"
            >
              <Check className="w-4 h-4" />
              Belleğe Kaydet
            </button>
          </form>
        </div>

        {/* Right Column: Memory List */}
        <div className="lg:col-span-2 space-y-4">
          {/* Search & Filter Controls */}
          <div className="flex flex-col sm:flex-row items-center gap-3">
            <div className="relative flex-1 w-full">
              <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-500" />
              <input
                type="text"
                placeholder="Bellek içinde ara..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-purple-500"
              />
            </div>

            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="w-full sm:w-auto bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-purple-500"
            >
              <option value="all">Tüm Kategoriler ({memories.length})</option>
              <option value="user_pref">Tercihler</option>
              <option value="fact">Gerçekler</option>
              <option value="summary">Özetler</option>
              <option value="custom">Özel</option>
            </select>
          </div>

          {/* Cards Container */}
          <div className="space-y-3">
            {filteredMemories.length === 0 ? (
              <div className="p-8 rounded-2xl bg-slate-900/50 border border-slate-800/80 text-center text-slate-400">
                <Brain className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                <p className="text-xs">Kayıtlı bellek bulunamadı.</p>
              </div>
            ) : (
              filteredMemories.map((mem) => (
                <div
                  key={mem.id}
                  className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800 hover:border-purple-500/30 transition-all flex items-start justify-between gap-4 group"
                >
                  <div className="space-y-1.5 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-xs text-slate-200">{mem.key}</span>
                      {getCategoryBadge(mem.category)}
                      {mem.isSensitive && (
                        <span className="px-1.5 py-0.5 rounded bg-amber-950 border border-amber-500/40 text-amber-300 text-[9px] flex items-center gap-1 font-mono">
                          <Shield className="w-2.5 h-2.5" /> Hassas
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-300 font-sans leading-relaxed">{mem.value}</p>
                    <p className="text-[10px] text-slate-500 font-mono">
                      Kayıt Tarihi: {new Date(mem.createdAt).toLocaleDateString('tr-TR')}
                    </p>
                  </div>

                  <button
                    onClick={() => onDeleteMemory(mem.id)}
                    className="p-2 rounded-xl text-slate-500 hover:text-red-400 hover:bg-slate-800 transition-colors shrink-0"
                    title="Bunu Unut (Sil)"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Clear All Confirmation Modal */}
      {showConfirmClear && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-red-400">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <h3 className="text-base font-bold text-slate-100">Belleği Temizle</h3>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Tüm kişisel bellek verileri silinecektir. AURA artık terchilerinizi hatırlamayacaktır. Emin misiniz?
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setShowConfirmClear(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium"
              >
                İptal
              </button>
              <button
                onClick={() => {
                  onClearAllMemories();
                  setShowConfirmClear(false);
                }}
                className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-medium shadow-lg shadow-red-600/20"
              >
                Evet, Tümünü Sil
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
