import React, { useState } from 'react';
import {
  BrainCircuit,
  Search,
  Plus,
  ShieldCheck,
  Moon,
  Sun,
  Layers,
  Sparkles,
  Download,
  FolderOpen,
  Share2,
  Maximize2,
  CheckCircle2,
  Brain,
  StickyNote,
  CheckSquare,
  Link2,
  ChevronDown
} from 'lucide-react';
import { KnowledgeNode, MapData, NodeType } from '../../types';
import { TEMPLATES, TemplateDefinition } from '../../data/templates';

interface HeaderNavbarProps {
  data: MapData;
  isDarkMode: boolean;
  onToggleTheme: () => void;
  onOpenBackupModal: () => void;
  onSelectTemplate: (template: TemplateDefinition) => void;
  onAddNode: (type: NodeType) => void;
  onSearchSelect: (nodeId: string) => void;
  onAutoOrganize: () => void;
  onUpdateTitle: (newTitle: string) => void;
  lastSavedText: string;
}

export const HeaderNavbar: React.FC<HeaderNavbarProps> = ({
  data,
  isDarkMode,
  onToggleTheme,
  onOpenBackupModal,
  onSelectTemplate,
  onAddNode,
  onSearchSelect,
  onAutoOrganize,
  onUpdateTitle,
  lastSavedText
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState(data.title);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [showTemplateMenu, setShowTemplateMenu] = useState(false);

  const filteredNodes = searchQuery.trim()
    ? data.nodes.filter(
        (n) =>
          n.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          n.summary?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          n.tags?.some((t) => t.toLowerCase().includes(searchQuery.toLowerCase()))
      )
    : [];

  const handleTitleSubmit = () => {
    setIsEditingTitle(false);
    if (titleInput.trim()) {
      onUpdateTitle(titleInput.trim());
    } else {
      setTitleInput(data.title);
    }
  };

  return (
    <header
      id="main-app-header"
      className={`h-16 border-b px-4 sm:px-6 flex items-center justify-between gap-3 z-30 select-none relative transition-all duration-300 ${
        isDarkMode
          ? 'bg-white/[0.04] border-white/10 text-slate-100 backdrop-blur-xl shadow-lg shadow-black/20'
          : 'bg-white/70 border-slate-200/80 text-slate-900 backdrop-blur-xl shadow-sm'
      }`}
    >
      {/* Left: Logo & Editable Map Title */}
      <div className="flex items-center gap-3.5 min-w-0">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-500 via-indigo-600 to-purple-500 flex items-center justify-center text-white shadow-lg shadow-indigo-500/25 shrink-0 border border-white/20">
          <BrainCircuit className="w-5 h-5" />
        </div>

        <div className="min-w-0 flex flex-col justify-center">
          <div className="flex items-center gap-2">
            {isEditingTitle ? (
              <input
                id="input-map-title"
                type="text"
                autoFocus
                value={titleInput}
                onChange={(e) => setTitleInput(e.target.value)}
                onBlur={handleTitleSubmit}
                onKeyDown={(e) => e.key === 'Enter' && handleTitleSubmit()}
                className="font-bold text-sm bg-white/10 backdrop-blur-md rounded-lg border border-indigo-400/50 outline-none px-2 py-0.5"
              />
            ) : (
              <h1
                id="map-title-display"
                onClick={() => {
                  setTitleInput(data.title);
                  setIsEditingTitle(true);
                }}
                title="Başlığı değiştirmek için tıklayın"
                className="font-bold text-sm tracking-tight truncate cursor-pointer hover:text-indigo-400 transition-colors"
              >
                {data.title || 'Knowledge Map Studio'}
              </h1>
            )}

            <span
              className={`hidden sm:inline-flex items-center gap-1 text-[10px] px-2.5 py-0.5 rounded-full font-semibold border ${
                isDarkMode
                  ? 'bg-indigo-500/10 text-indigo-300 border-indigo-400/20'
                  : 'bg-indigo-50 text-indigo-700 border-indigo-200'
              }`}
            >
              Frosted Pro
            </span>
          </div>

          {/* Subtitle / live save status */}
          <div className="flex items-center gap-2 text-[11px] text-slate-400">
            <span className="flex items-center gap-1.5 text-emerald-400 font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              {lastSavedText || 'Otomatik Kaydedildi'}
            </span>
            <span className="hidden md:inline text-slate-600">•</span>
            <span className="hidden md:inline text-slate-400">
              {data.nodes.length} Düğüm, {data.edges.length} Bağlantı
            </span>
          </div>
        </div>
      </div>

      {/* Middle: Search Bar */}
      <div className="relative max-w-xs w-full hidden md:block">
        <div className="relative flex items-center">
          <Search className="w-3.5 h-3.5 absolute left-3 text-slate-400" />
          <input
            id="input-nav-search"
            type="text"
            placeholder="Düğüm, etiket veya kavram ara..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={`w-full pl-8 pr-3 py-1.5 text-xs rounded-xl border outline-none transition-all ${
              isDarkMode
                ? 'bg-white/5 border-white/10 text-white placeholder-slate-500 focus:border-indigo-400/60 focus:bg-white/10 backdrop-blur-md'
                : 'bg-slate-100/80 border-slate-200 text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:bg-white'
            }`}
          />
        </div>

        {/* Search Results Dropdown */}
        {searchQuery.trim() && (
          <div
            className={`absolute top-full mt-2 left-0 right-0 rounded-2xl border shadow-2xl p-1.5 z-50 max-h-60 overflow-y-auto animate-in fade-in-50 ${
              isDarkMode
                ? 'bg-[#080911]/90 border-white/15 backdrop-blur-2xl'
                : 'bg-white/95 border-slate-200 backdrop-blur-xl'
            }`}
          >
            {filteredNodes.length === 0 ? (
              <div className="p-3 text-center text-xs text-slate-400">Eşleşen düğüm bulunamadı</div>
            ) : (
              filteredNodes.map((n) => (
                <button
                  key={n.id}
                  onClick={() => {
                    onSearchSelect(n.id);
                    setSearchQuery('');
                  }}
                  className={`w-full p-2 rounded-xl text-left flex items-center justify-between transition-colors ${
                    isDarkMode ? 'hover:bg-white/10 text-slate-200' : 'hover:bg-slate-100 text-slate-800'
                  }`}
                >
                  <div className="truncate pr-2">
                    <div className="font-semibold text-xs truncate">{n.title}</div>
                    {n.summary && (
                      <div className="text-[11px] text-slate-400 truncate">{n.summary}</div>
                    )}
                  </div>
                  <span className="text-[10px] uppercase font-bold text-indigo-400 shrink-0">
                    Git ➔
                  </span>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-2.5 shrink-0">
        {/* Templates Picker Dropdown */}
        <div className="relative">
          <button
            id="btn-templates-menu"
            onClick={() => {
              setShowTemplateMenu(!showTemplateMenu);
              setShowAddMenu(false);
            }}
            className={`px-3 py-1.5 rounded-xl border flex items-center gap-1.5 text-xs font-semibold transition-all ${
              isDarkMode
                ? 'bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20 text-slate-200 backdrop-blur-md'
                : 'bg-white/80 border-slate-200 hover:bg-slate-50 text-slate-700'
            }`}
          >
            <FolderOpen className="w-3.5 h-3.5 text-indigo-400" />
            <span className="hidden sm:inline">Şablonlar</span>
            <ChevronDown className="w-3 h-3 text-slate-400" />
          </button>

          {showTemplateMenu && (
            <div
              className={`absolute right-0 top-full mt-2 w-64 rounded-2xl border shadow-2xl p-2 z-50 animate-in fade-in-50 zoom-in-95 ${
                isDarkMode
                  ? 'bg-[#080911]/90 border-white/15 backdrop-blur-2xl'
                  : 'bg-white/95 border-slate-200 backdrop-blur-xl'
              }`}
            >
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-2 py-1">
                Örnek Bilgi Haritaları
              </div>
              {TEMPLATES.map((tmpl) => (
                <button
                  key={tmpl.id}
                  onClick={() => {
                    onSelectTemplate(tmpl);
                    setShowTemplateMenu(false);
                  }}
                  className={`w-full p-2 rounded-xl text-left flex flex-col gap-0.5 transition-colors ${
                    isDarkMode ? 'hover:bg-white/10 text-slate-200' : 'hover:bg-slate-100 text-slate-800'
                  }`}
                >
                  <div className="font-semibold text-xs">{tmpl.name}</div>
                  <div className="text-[10px] text-slate-400 line-clamp-1">{tmpl.category}</div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Add Node Dropdown */}
        <div className="relative">
          <button
            id="btn-add-node-menu"
            onClick={() => {
              setShowAddMenu(!showAddMenu);
              setShowTemplateMenu(false);
            }}
            className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-600 text-white flex items-center gap-1.5 text-xs font-semibold shadow-lg shadow-indigo-500/25 border border-indigo-400/30 transition-all active:scale-95"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">Düğüm Ekle</span>
          </button>

          {showAddMenu && (
            <div
              className={`absolute right-0 top-full mt-2 w-56 rounded-2xl border shadow-2xl p-2 z-50 animate-in fade-in-50 zoom-in-95 ${
                isDarkMode
                  ? 'bg-[#080911]/90 border-white/15 text-slate-200 backdrop-blur-2xl'
                  : 'bg-white/95 border-slate-200 text-slate-800 backdrop-blur-xl'
              }`}
            >
              <button
                id="btn-add-concept"
                onClick={() => {
                  onAddNode('concept');
                  setShowAddMenu(false);
                }}
                className="w-full p-2 text-xs text-left rounded-xl flex items-center gap-2.5 hover:bg-indigo-500/15 hover:text-indigo-300 transition-colors"
              >
                <Brain className="w-4 h-4 text-indigo-400" />
                <div>
                  <div className="font-semibold">Kavram Düğümü</div>
                  <div className="text-[10px] text-slate-400">Temel başlık & açıklama</div>
                </div>
              </button>

              <button
                id="btn-add-sticky"
                onClick={() => {
                  onAddNode('sticky');
                  setShowAddMenu(false);
                }}
                className="w-full p-2 text-xs text-left rounded-xl flex items-center gap-2.5 hover:bg-amber-500/15 hover:text-amber-300 transition-colors"
              >
                <StickyNote className="w-4 h-4 text-amber-400" />
                <div>
                  <div className="font-semibold">Yapışkan Not (Sticky)</div>
                  <div className="text-[10px] text-slate-400">Hızlı fikir & düşünce</div>
                </div>
              </button>

              <button
                id="btn-add-task"
                onClick={() => {
                  onAddNode('task');
                  setShowAddMenu(false);
                }}
                className="w-full p-2 text-xs text-left rounded-xl flex items-center gap-2.5 hover:bg-emerald-500/15 hover:text-emerald-300 transition-colors"
              >
                <CheckSquare className="w-4 h-4 text-emerald-400" />
                <div>
                  <div className="font-semibold">Görev Listesi</div>
                  <div className="text-[10px] text-slate-400">Kontrol maddeleri</div>
                </div>
              </button>

              <button
                id="btn-add-resource"
                onClick={() => {
                  onAddNode('resource');
                  setShowAddMenu(false);
                }}
                className="w-full p-2 text-xs text-left rounded-xl flex items-center gap-2.5 hover:bg-rose-500/15 hover:text-rose-300 transition-colors"
              >
                <Link2 className="w-4 h-4 text-rose-400" />
                <div>
                  <div className="font-semibold">Kaynak Düğümü</div>
                  <div className="text-[10px] text-slate-400">Bağlantılar & doküman</div>
                </div>
              </button>
            </div>
          )}
        </div>

        {/* Auto Organize Layout */}
        <button
          id="btn-auto-organize"
          title="Düğümleri Otomatik Düzenle"
          onClick={onAutoOrganize}
          className={`p-2 rounded-xl border transition-all ${
            isDarkMode
              ? 'bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20 text-slate-300 backdrop-blur-md'
              : 'bg-white/80 border-slate-200 hover:bg-slate-50 text-slate-700'
          }`}
        >
          <Sparkles className="w-4 h-4 text-amber-400" />
        </button>

        {/* Auto-Backup / Data Security Center Button */}
        <button
          id="btn-open-backup-modal"
          onClick={onOpenBackupModal}
          title="Otomatik Yedekleme & Güvenlik Merkezi"
          className={`px-3 py-1.5 rounded-xl border flex items-center gap-1.5 text-xs font-semibold transition-all ${
            isDarkMode
              ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20 backdrop-blur-md'
              : 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100'
          }`}
        >
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          <span className="hidden md:inline">Yedekleme</span>
        </button>

        {/* Dark/Light Mode Switcher */}
        <button
          id="btn-theme-toggle"
          title={isDarkMode ? 'Aydınlık Moda Geç' : 'Karanlık Moda Geç'}
          onClick={onToggleTheme}
          className={`p-2 rounded-xl border transition-all ${
            isDarkMode
              ? 'bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20 text-amber-400 backdrop-blur-md'
              : 'bg-white/80 border-slate-200 hover:bg-slate-50 text-slate-700'
          }`}
        >
          {isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>
      </div>
    </header>
  );
};
