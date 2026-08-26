import React, { useState } from 'react';
import {
  Plus,
  StickyNote,
  Tag,
  Trash2,
  MoveRight,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Inbox,
  Filter,
  Layers
} from 'lucide-react';
import { InboxNote, NodeColor } from '../../types';
import { NODE_COLOR_MAP } from '../../utils/themeStyles';

interface InboxTrayProps {
  notes: InboxNote[];
  isOpen: boolean;
  onToggle: () => void;
  isDarkMode: boolean;
  onAddNote: (note: Omit<InboxNote, 'id' | 'createdAt'>) => void;
  onDeleteNote: (noteId: string) => void;
  onSendToCanvas: (note: InboxNote) => void;
}

export const InboxTray: React.FC<InboxTrayProps> = ({
  notes,
  isOpen,
  onToggle,
  isDarkMode,
  onAddNote,
  onDeleteNote,
  onSendToCanvas
}) => {
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newTags, setNewTags] = useState('');
  const [newColor, setNewColor] = useState<NodeColor>('indigo');
  const [activeTagFilter, setActiveTagFilter] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  // Extract unique tags
  const allTags = Array.from(
    new Set(notes.flatMap((n) => n.tags || []))
  ).filter(Boolean);

  const filteredNotes = activeTagFilter
    ? notes.filter((n) => n.tags?.includes(activeTagFilter))
    : notes;

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() && !newContent.trim()) return;

    const parsedTags = newTags
      .split(',')
      .map((t) => t.trim().replace(/^#/, ''))
      .filter(Boolean);

    onAddNote({
      title: newTitle.trim() || 'Hızlı Fikir',
      content: newContent.trim(),
      tags: parsedTags,
      color: newColor
    });

    setNewTitle('');
    setNewContent('');
    setNewTags('');
    setIsCreating(false);
  };

  const handleDragStart = (e: React.DragEvent, noteId: string) => {
    e.dataTransfer.setData('text/plain', noteId);
    e.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <div
      id="inbox-tray-sidebar"
      className={`fixed top-16 right-0 bottom-0 z-40 flex transition-transform duration-300 ${
        isOpen ? 'translate-x-0' : 'translate-x-full'
      }`}
    >
      {/* Toggle Tab Button attached to left edge */}
      <button
        id="btn-toggle-inbox"
        onClick={onToggle}
        title={isOpen ? 'Not Havuzunu Kapat' : 'Not Havuzunu Aç'}
        className={`absolute -left-11 top-6 h-12 w-11 rounded-l-2xl border-l border-t border-b flex items-center justify-center shadow-xl backdrop-blur-xl transition-all ${
          isDarkMode
            ? 'bg-white/[0.08] border-white/15 text-slate-200 hover:bg-white/15'
            : 'bg-white/85 border-slate-200 text-slate-700 hover:bg-white'
        }`}
      >
        {isOpen ? (
          <ChevronRight className="w-5 h-5" />
        ) : (
          <div className="relative">
            <Inbox className="w-5 h-5 text-indigo-400" />
            {notes.length > 0 && (
              <span className="absolute -top-2 -right-2.5 bg-indigo-600 text-white text-[10px] w-4 h-4 rounded-full flex items-center justify-center font-bold shadow-md shadow-indigo-500/50">
                {notes.length}
              </span>
            )}
          </div>
        )}
      </button>

      {/* Main Drawer Container */}
      <div
        className={`w-80 sm:w-96 h-full flex flex-col border-l shadow-2xl backdrop-blur-2xl transition-colors ${
          isDarkMode
            ? 'bg-[#080911]/90 border-white/10 text-slate-100'
            : 'bg-white/90 border-slate-200/80 text-slate-900'
        }`}
      >
        {/* Header */}
        <div className="p-4 border-b border-black/5 dark:border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-indigo-500/15 border border-indigo-400/20 text-indigo-400 flex items-center justify-center">
              <Inbox className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-semibold text-sm tracking-tight flex items-center gap-2">
                Not & Fikir Havuzu
                <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-400 font-bold border border-indigo-400/20">
                  {notes.length}
                </span>
              </h2>
              <p className="text-[11px] text-slate-400">
                Tuvale sürükleyip bırakarak haritaya dönüştürün
              </p>
            </div>
          </div>

          <button
            id="btn-inbox-new-note"
            onClick={() => setIsCreating(!isCreating)}
            className="p-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white transition-all flex items-center gap-1 text-xs font-semibold px-2.5 shadow-lg shadow-indigo-600/30 active:scale-95"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Yeni Not</span>
          </button>
        </div>

        {/* Create Note Inline Form */}
        {isCreating && (
          <form
            onSubmit={handleCreate}
            className={`p-3.5 border-b space-y-3 animate-in fade-in-50 duration-200 backdrop-blur-md ${
              isDarkMode ? 'bg-white/[0.04] border-white/10' : 'bg-slate-50/80 border-slate-200'
            }`}
          >
            <input
              id="input-inbox-title"
              type="text"
              placeholder="Not Başlığı..."
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              className={`w-full px-3 py-1.5 text-xs rounded-xl border outline-none font-medium transition-all ${
                isDarkMode
                  ? 'bg-white/5 border-white/10 text-white placeholder-slate-500 focus:border-indigo-400/60 focus:bg-white/10'
                  : 'bg-white border-slate-300 text-slate-900 focus:border-indigo-500'
              }`}
            />

            <textarea
              id="input-inbox-content"
              placeholder="Düşünce, fikir veya detaylar..."
              rows={2}
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              className={`w-full px-3 py-1.5 text-xs rounded-xl border outline-none resize-none transition-all ${
                isDarkMode
                  ? 'bg-white/5 border-white/10 text-white placeholder-slate-500 focus:border-indigo-400/60 focus:bg-white/10'
                  : 'bg-white border-slate-300 text-slate-900 focus:border-indigo-500'
              }`}
            />

            <div className="flex items-center justify-between gap-2">
              <input
                id="input-inbox-tags"
                type="text"
                placeholder="Etiketler (virgülle ayırın)..."
                value={newTags}
                onChange={(e) => setNewTags(e.target.value)}
                className={`flex-1 px-2.5 py-1 text-[11px] rounded-lg border outline-none ${
                  isDarkMode
                    ? 'bg-white/5 border-white/10 text-white placeholder-slate-500 focus:border-indigo-400/60'
                    : 'bg-white border-slate-300 text-slate-900 focus:border-indigo-500'
                }`}
              />

              <div className="flex items-center gap-1.5">
                {(['indigo', 'cyan', 'emerald', 'amber', 'rose', 'violet'] as NodeColor[]).map(
                  (c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setNewColor(c)}
                      style={{ backgroundColor: NODE_COLOR_MAP[c].accent }}
                      className={`w-3.5 h-3.5 rounded-full transition-transform hover:scale-125 ${
                        newColor === c ? 'scale-125 ring-2 ring-white/60' : 'opacity-70'
                      }`}
                    />
                  )
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setIsCreating(false)}
                className="px-2.5 py-1 text-xs text-slate-400 hover:text-slate-200"
              >
                Vazgeç
              </button>
              <button
                type="submit"
                className="px-3.5 py-1 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-xl shadow-md shadow-indigo-600/30"
              >
                Havuzuna Ekle
              </button>
            </div>
          </form>
        )}

        {/* Tag Filters */}
        {allTags.length > 0 && (
          <div className="px-4 py-2 border-b border-black/5 dark:border-white/10 flex items-center gap-1.5 overflow-x-auto text-xs">
            <span className="text-[11px] text-slate-400 font-medium">Filtre:</span>
            <button
              onClick={() => setActiveTagFilter(null)}
              className={`px-2.5 py-0.5 rounded-lg text-[11px] font-medium transition-colors ${
                activeTagFilter === null
                  ? 'bg-indigo-600 text-white'
                  : isDarkMode
                  ? 'bg-white/5 text-slate-400 hover:text-slate-200'
                  : 'bg-slate-100 text-slate-600 hover:text-slate-900'
              }`}
            >
              Tümü
            </button>
            {allTags.map((tag) => (
              <button
                key={tag}
                onClick={() => setActiveTagFilter(activeTagFilter === tag ? null : tag)}
                className={`px-2.5 py-0.5 rounded-lg text-[11px] font-medium transition-colors whitespace-nowrap ${
                  activeTagFilter === tag
                    ? 'bg-indigo-600 text-white'
                    : isDarkMode
                    ? 'bg-white/5 text-slate-400 hover:text-slate-200'
                    : 'bg-slate-100 text-slate-600 hover:text-slate-900'
                }`}
              >
                #{tag}
              </button>
            ))}
          </div>
        )}

        {/* Notes List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {filteredNotes.length === 0 ? (
            <div className="text-center py-12 px-4 space-y-2">
              <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center mx-auto border border-indigo-400/20">
                <StickyNote className="w-6 h-6" />
              </div>
              <h3 className="font-semibold text-sm">Henüz Havuzda Not Yok</h3>
              <p className="text-xs text-slate-400 max-w-xs mx-auto leading-relaxed">
                Aklınıza gelen fikirleri hızlıca buraya yazın veya doğrudan tuvale sürükleyin.
              </p>
            </div>
          ) : (
            filteredNotes.map((note) => {
              const colorScheme = NODE_COLOR_MAP[note.color] || NODE_COLOR_MAP.indigo;
              return (
                <div
                  key={note.id}
                  id={`inbox-item-${note.id}`}
                  draggable
                  onDragStart={(e) => handleDragStart(e, note.id)}
                  className={`group p-3.5 rounded-2xl border transition-all cursor-grab active:cursor-grabbing hover:shadow-xl backdrop-blur-xl ${
                    isDarkMode
                      ? `${colorScheme.bgDark} ${colorScheme.borderDark} text-slate-200 hover:border-white/20`
                      : `${colorScheme.bgLight} ${colorScheme.borderLight} text-slate-800 hover:border-indigo-300`
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <h4 className="font-semibold text-xs leading-snug tracking-tight">
                      {note.title}
                    </h4>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        title="Doğrudan Haritaya Gönder"
                        onClick={() => onSendToCanvas(note)}
                        className="p-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs shadow-md shadow-indigo-600/30"
                      >
                        <MoveRight className="w-3 h-3" />
                      </button>
                      <button
                        title="Notu Sil"
                        onClick={() => onDeleteNote(note.id)}
                        className="p-1 rounded-lg hover:bg-rose-500/20 text-rose-400 text-xs"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>

                  {note.content && (
                    <p className="text-xs leading-relaxed opacity-85 line-clamp-3 mb-2 font-mono">
                      {note.content}
                    </p>
                  )}

                  <div className="flex items-center justify-between pt-1 text-[10px] text-slate-400">
                    <div className="flex items-center gap-1 flex-wrap">
                      {note.tags?.map((tag, idx) => (
                        <span
                          key={idx}
                          className={`px-2 py-0.5 rounded-md font-medium ${
                            isDarkMode ? colorScheme.badgeBgDark : colorScheme.badgeBgLight
                          }`}
                        >
                          #{tag}
                        </span>
                      ))}
                    </div>
                    <span className="text-[9px] opacity-75">Sürükle ➜ Tuval</span>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer tip */}
        <div
          className={`p-3 border-t text-center text-[11px] font-medium flex items-center justify-center gap-1.5 ${
            isDarkMode ? 'border-white/10 text-slate-400' : 'border-slate-200 text-slate-500'
          }`}
        >
          <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
          <span>İpucu: Kartı doğrudan tuvale fırlatın</span>
        </div>
      </div>
    </div>
  );
};
