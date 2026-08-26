import React, { useState, useEffect } from 'react';
import {
  KnowledgeNode,
  KnowledgeEdge,
  NodeType,
  NodeColor,
  ChecklistItem,
  ResourceLink
} from '../../types';
import { NODE_COLOR_MAP, NODE_TYPE_LABELS } from '../../utils/themeStyles';
import {
  X,
  Plus,
  Trash2,
  Check,
  Circle,
  ExternalLink,
  Pin,
  Link2,
  Sparkles,
  ArrowRight,
  Brain,
  StickyNote,
  CheckSquare
} from 'lucide-react';

interface NodeEditorDrawerProps {
  node: KnowledgeNode | null;
  edges: KnowledgeEdge[];
  allNodes: KnowledgeNode[];
  isOpen: boolean;
  onClose: () => void;
  isDarkMode: boolean;
  onUpdateNode: (updated: KnowledgeNode) => void;
  onDeleteNode: (nodeId: string) => void;
  onFocusNode: (targetNodeId: string) => void;
}

export const NodeEditorDrawer: React.FC<NodeEditorDrawerProps> = ({
  node,
  edges,
  allNodes,
  isOpen,
  onClose,
  isDarkMode,
  onUpdateNode,
  onDeleteNode,
  onFocusNode
}) => {
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [content, setContent] = useState('');
  const [type, setType] = useState<NodeType>('concept');
  const [color, setColor] = useState<NodeColor>('indigo');
  const [tagsInput, setTagsInput] = useState('');
  const [pinned, setPinned] = useState(false);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [resources, setResources] = useState<ResourceLink[]>([]);

  // New item inputs
  const [newChecklistText, setNewChecklistText] = useState('');
  const [newResourceTitle, setNewResourceTitle] = useState('');
  const [newResourceUrl, setNewResourceUrl] = useState('');
  const [newResourceType, setNewResourceType] = useState<ResourceLink['type']>('article');

  useEffect(() => {
    if (node) {
      setTitle(node.title || '');
      setSummary(node.summary || '');
      setContent(node.content || '');
      setType(node.type || 'concept');
      setColor(node.color || 'indigo');
      setTagsInput(node.tags?.join(', ') || '');
      setPinned(!!node.pinned);
      setChecklist(node.checklist || []);
      setResources(node.resources || []);
    }
  }, [node]);

  if (!isOpen || !node) return null;

  const handleSave = () => {
    const parsedTags = tagsInput
      .split(',')
      .map((t) => t.trim().replace(/^#/, ''))
      .filter(Boolean);

    onUpdateNode({
      ...node,
      title: title.trim() || 'İsimsiz Düğüm',
      summary: summary.trim(),
      content: content.trim(),
      type,
      color,
      tags: parsedTags,
      pinned,
      checklist,
      resources,
      updatedAt: Date.now()
    });
  };

  const handleAddChecklist = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newChecklistText.trim()) return;
    const newItem: ChecklistItem = {
      id: `item-${Date.now()}`,
      text: newChecklistText.trim(),
      done: false
    };
    const updated = [...checklist, newItem];
    setChecklist(updated);
    setNewChecklistText('');
    onUpdateNode({ ...node, checklist: updated, updatedAt: Date.now() });
  };

  const handleToggleChecklist = (itemId: string) => {
    const updated = checklist.map((i) => (i.id === itemId ? { ...i, done: !i.done } : i));
    setChecklist(updated);
    onUpdateNode({ ...node, checklist: updated, updatedAt: Date.now() });
  };

  const handleDeleteChecklist = (itemId: string) => {
    const updated = checklist.filter((i) => i.id !== itemId);
    setChecklist(updated);
    onUpdateNode({ ...node, checklist: updated, updatedAt: Date.now() });
  };

  const handleAddResource = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newResourceTitle.trim() || !newResourceUrl.trim()) return;
    let url = newResourceUrl.trim();
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }
    const newRes: ResourceLink = {
      id: `res-${Date.now()}`,
      title: newResourceTitle.trim(),
      url,
      type: newResourceType
    };
    const updated = [...resources, newRes];
    setResources(updated);
    setNewResourceTitle('');
    setNewResourceUrl('');
    onUpdateNode({ ...node, resources: updated, updatedAt: Date.now() });
  };

  const handleDeleteResource = (resId: string) => {
    const updated = resources.filter((r) => r.id !== resId);
    setResources(updated);
    onUpdateNode({ ...node, resources: updated, updatedAt: Date.now() });
  };

  // Connected edges
  const connectedEdges = edges.filter(
    (e) => e.fromNodeId === node.id || e.toNodeId === node.id
  );

  return (
    <div
      id="node-editor-drawer"
      className={`fixed inset-y-0 right-0 w-full sm:w-[460px] z-50 flex flex-col shadow-2xl animate-in slide-in-from-right duration-200 border-l backdrop-blur-2xl transition-all ${
        isDarkMode
          ? 'bg-[#080911]/90 border-white/10 text-slate-100'
          : 'bg-white/90 border-slate-200/80 text-slate-900'
      }`}
    >
      {/* Header */}
      <div className="p-4 border-b border-black/5 dark:border-white/10 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div
            style={{ backgroundColor: NODE_COLOR_MAP[color].accent }}
            className="w-3.5 h-3.5 rounded-full ring-2 ring-offset-2 ring-white/60"
          />
          <h2 className="font-bold text-sm">Düğüm Detay & Düzenleme</h2>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            title={pinned ? 'Sabitlemeyi Kaldır' : 'Tuvale Sabitle'}
            onClick={() => {
              const newPinned = !pinned;
              setPinned(newPinned);
              onUpdateNode({ ...node, pinned: newPinned, updatedAt: Date.now() });
            }}
            className={`p-1.5 rounded-xl transition-all ${
              pinned
                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-white/10'
            }`}
          >
            <Pin className="w-4 h-4" />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-200 hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Body / Form */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
        {/* Node Type Selector */}
        <div>
          <label className="font-semibold text-slate-400 uppercase tracking-wider text-[10px] block mb-1.5">
            Düğüm Türü
          </label>
          <div className="grid grid-cols-2 gap-2">
            {(['concept', 'sticky', 'task', 'resource'] as NodeType[]).map((t) => {
              const isSelected = type === t;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    setType(t);
                    onUpdateNode({ ...node, type: t, updatedAt: Date.now() });
                  }}
                  className={`p-2.5 rounded-xl border flex items-center gap-2 transition-all text-left backdrop-blur-md ${
                    isSelected
                      ? 'border-indigo-400/80 bg-indigo-500/15 text-indigo-400 font-semibold shadow-md shadow-indigo-500/20'
                      : isDarkMode
                      ? 'border-white/10 bg-white/5 text-slate-400 hover:border-white/20 hover:text-slate-200'
                      : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300'
                  }`}
                >
                  <span className="shrink-0">{NODE_TYPE_LABELS[t].name.split(' ')[0]}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Color Palette */}
        <div>
          <label className="font-semibold text-slate-400 uppercase tracking-wider text-[10px] block mb-1.5">
            Tema Rengi
          </label>
          <div className="flex items-center gap-2">
            {(['indigo', 'cyan', 'emerald', 'amber', 'rose', 'violet', 'fuchsia', 'slate'] as NodeColor[]).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => {
                  setColor(c);
                  onUpdateNode({ ...node, color: c, updatedAt: Date.now() });
                }}
                style={{ backgroundColor: NODE_COLOR_MAP[c].accent }}
                className={`w-6 h-6 rounded-full transition-transform hover:scale-110 ${
                  color === c ? 'ring-2 ring-offset-2 ring-white scale-110' : 'opacity-80'
                }`}
              />
            ))}
          </div>
        </div>

        {/* Title */}
        <div>
          <label className="font-semibold text-slate-400 uppercase tracking-wider text-[10px] block mb-1">
            Başlık
          </label>
          <input
            id="input-edit-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={handleSave}
            placeholder="Düğüm Başlığı..."
            className={`w-full px-3.5 py-2 rounded-xl border text-sm font-semibold outline-none transition-all ${
              isDarkMode
                ? 'bg-white/5 border-white/10 text-white placeholder-slate-500 focus:border-indigo-400/60 focus:bg-white/10'
                : 'bg-white border-slate-300 text-slate-900 focus:border-indigo-500'
            }`}
          />
        </div>

        {/* Summary */}
        <div>
          <label className="font-semibold text-slate-400 uppercase tracking-wider text-[10px] block mb-1">
            Kısa Özet
          </label>
          <input
            id="input-edit-summary"
            type="text"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            onBlur={handleSave}
            placeholder="Özet veya 1 cümlelik açıklama..."
            className={`w-full px-3.5 py-2 rounded-xl border text-xs outline-none transition-all ${
              isDarkMode
                ? 'bg-white/5 border-white/10 text-white placeholder-slate-500 focus:border-indigo-400/60 focus:bg-white/10'
                : 'bg-white border-slate-300 text-slate-900 focus:border-indigo-500'
            }`}
          />
        </div>

        {/* Detailed Notes / Content */}
        <div>
          <label className="font-semibold text-slate-400 uppercase tracking-wider text-[10px] block mb-1">
            Detaylı Notlar & İçerik (Markdown)
          </label>
          <textarea
            id="input-edit-content"
            rows={4}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onBlur={handleSave}
            placeholder="Kavram açıklaması, formüller, araştırma notları..."
            className={`w-full px-3.5 py-2.5 rounded-xl border font-mono text-xs outline-none resize-none leading-relaxed transition-all ${
              isDarkMode
                ? 'bg-white/5 border-white/10 text-white placeholder-slate-500 focus:border-indigo-400/60 focus:bg-white/10'
                : 'bg-white border-slate-300 text-slate-900 focus:border-indigo-500'
            }`}
          />
        </div>

        {/* Tags */}
        <div>
          <label className="font-semibold text-slate-400 uppercase tracking-wider text-[10px] block mb-1">
            Etiketler (Virgülle ayırın)
          </label>
          <input
            id="input-edit-tags"
            type="text"
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
            onBlur={handleSave}
            placeholder="AI, Transformer, Araştırma..."
            className={`w-full px-3.5 py-2 rounded-xl border text-xs outline-none transition-all ${
              isDarkMode
                ? 'bg-white/5 border-white/10 text-white placeholder-slate-500 focus:border-indigo-400/60'
                : 'bg-white border-slate-300 text-slate-900 focus:border-indigo-500'
            }`}
          />
        </div>

        {/* Checklist Section */}
        <div className="pt-2 border-t border-black/5 dark:border-white/10 space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-slate-400 uppercase tracking-wider text-[10px]">
              Kontrol Listesi ({checklist.length})
            </span>
          </div>

          <form onSubmit={handleAddChecklist} className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Yeni görev/madde ekle..."
              value={newChecklistText}
              onChange={(e) => setNewChecklistText(e.target.value)}
              className={`flex-1 px-3 py-1.5 rounded-xl border text-xs outline-none transition-all ${
                isDarkMode
                  ? 'bg-white/5 border-white/10 text-white placeholder-slate-500 focus:border-indigo-400/60'
                  : 'bg-white border-slate-300 text-slate-900 focus:border-indigo-500'
              }`}
            />
            <button
              type="submit"
              className="p-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
            >
              <Plus className="w-4 h-4" />
            </button>
          </form>

          <div className="space-y-1.5 max-h-36 overflow-y-auto">
            {checklist.map((item) => (
              <div
                key={item.id}
                className={`p-2 rounded-xl border flex items-center justify-between gap-2 backdrop-blur-md ${
                  isDarkMode ? 'bg-white/[0.04] border-white/10 text-slate-200' : 'bg-slate-50 border-slate-200'
                }`}
              >
                <div
                  onClick={() => handleToggleChecklist(item.id)}
                  className="flex items-center gap-2 cursor-pointer flex-1 min-w-0"
                >
                  {item.done ? (
                    <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                  ) : (
                    <Circle className="w-4 h-4 text-slate-400 shrink-0" />
                  )}
                  <span className={`truncate ${item.done ? 'line-through text-slate-400' : ''}`}>
                    {item.text}
                  </span>
                </div>
                <button
                  onClick={() => handleDeleteChecklist(item.id)}
                  className="text-slate-400 hover:text-rose-400 p-1"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Resources Section */}
        <div className="pt-2 border-t border-black/5 dark:border-white/10 space-y-2">
          <span className="font-semibold text-slate-400 uppercase tracking-wider text-[10px] block">
            Kaynaklar & Dokümanlar ({resources.length})
          </span>

          <form onSubmit={handleAddResource} className="space-y-2">
            <input
              type="text"
              placeholder="Kaynak Başlığı (Örn: Makale / Dokümantasyon)..."
              value={newResourceTitle}
              onChange={(e) => setNewResourceTitle(e.target.value)}
              className={`w-full px-3 py-1.5 rounded-xl border text-xs outline-none transition-all ${
                isDarkMode
                  ? 'bg-white/5 border-white/10 text-white placeholder-slate-500 focus:border-indigo-400/60'
                  : 'bg-white border-slate-300 text-slate-900 focus:border-indigo-500'
              }`}
            />
            <div className="flex items-center gap-2">
              <input
                type="text"
                placeholder="https://..."
                value={newResourceUrl}
                onChange={(e) => setNewResourceUrl(e.target.value)}
                className={`flex-1 px-3 py-1.5 rounded-xl border text-xs outline-none transition-all ${
                  isDarkMode
                    ? 'bg-white/5 border-white/10 text-white placeholder-slate-500 focus:border-indigo-400/60'
                    : 'bg-white border-slate-300 text-slate-900 focus:border-indigo-500'
                }`}
              />
              <button
                type="submit"
                className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-xl text-xs flex items-center gap-1 shadow-md shadow-indigo-600/30"
              >
                <Plus className="w-3.5 h-3.5" />
                Ekle
              </button>
            </div>
          </form>

          <div className="space-y-1.5 max-h-36 overflow-y-auto">
            {resources.map((res) => (
              <div
                key={res.id}
                className={`p-2 rounded-xl border flex items-center justify-between gap-2 backdrop-blur-md ${
                  isDarkMode ? 'bg-white/[0.04] border-white/10' : 'bg-slate-50 border-slate-200'
                }`}
              >
                <a
                  href={res.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 text-indigo-400 hover:underline truncate flex-1 min-w-0"
                >
                  <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate font-medium">{res.title}</span>
                </a>
                <button
                  onClick={() => handleDeleteResource(res.id)}
                  className="text-slate-400 hover:text-rose-400 p-1"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Connected Nodes List */}
        <div className="pt-2 border-t border-black/5 dark:border-white/10 space-y-2">
          <span className="font-semibold text-slate-400 uppercase tracking-wider text-[10px] block">
            Bağlantılı Düğümler ({connectedEdges.length})
          </span>

          <div className="space-y-1.5">
            {connectedEdges.map((edge) => {
              const isTarget = edge.fromNodeId === node.id;
              const otherNodeId = isTarget ? edge.toNodeId : edge.fromNodeId;
              const otherNode = allNodes.find((n) => n.id === otherNodeId);
              if (!otherNode) return null;

              return (
                <button
                  key={edge.id}
                  onClick={() => onFocusNode(otherNode.id)}
                  className={`w-full p-2 rounded-xl border flex items-center justify-between gap-2 text-left transition-all backdrop-blur-md ${
                    isDarkMode
                      ? 'bg-white/[0.04] border-white/10 text-slate-200 hover:border-indigo-400/50 hover:bg-white/10'
                      : 'bg-white border-slate-200 hover:border-indigo-500/50'
                  }`}
                >
                  <div className="flex items-center gap-2 truncate">
                    <span className="text-[10px] text-slate-400">
                      {isTarget ? '➔' : '🠔'} {edge.label || 'ilişki'}:
                    </span>
                    <span className="font-semibold truncate">{otherNode.title}</span>
                  </div>
                  <ArrowRight className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-black/5 dark:border-white/10 flex items-center justify-between">
        <button
          id="btn-delete-node-drawer"
          onClick={() => {
            onDeleteNode(node.id);
            onClose();
          }}
          className="px-3 py-2 text-rose-400 hover:bg-rose-500/15 rounded-xl font-semibold flex items-center gap-1.5 transition-colors"
        >
          <Trash2 className="w-4 h-4" />
          <span>Düğümü Sil</span>
        </button>

        <button
          onClick={() => {
            handleSave();
            onClose();
          }}
          className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-xl shadow-lg shadow-indigo-600/30 transition-all active:scale-95"
        >
          Kaydet & Kapat
        </button>
      </div>
    </div>
  );
};
