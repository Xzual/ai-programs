import React from 'react';
import {
  Brain,
  StickyNote,
  CheckSquare,
  Link2,
  Pin,
  MoreHorizontal,
  ExternalLink,
  Plus,
  Trash2,
  Edit3,
  Copy,
  Check,
  Circle,
  Share2
} from 'lucide-react';
import { KnowledgeNode, NodeColor } from '../../types';
import { NODE_COLOR_MAP } from '../../utils/themeStyles';
import { getNodeDimensions } from '../../utils/geometry';

interface NodeCardProps {
  node: KnowledgeNode;
  isSelected: boolean;
  isConnectingSource: boolean;
  isConnectingTargetHovered: boolean;
  isDarkMode: boolean;
  onSelect: (node: KnowledgeNode, e: React.MouseEvent) => void;
  onStartConnect: (node: KnowledgeNode, anchor: 'top' | 'bottom' | 'left' | 'right', e: React.MouseEvent) => void;
  onToggleChecklist: (nodeId: string, itemId: string) => void;
  onOpenEdit: (node: KnowledgeNode) => void;
  onDelete: (nodeId: string) => void;
  onDuplicate: (node: KnowledgeNode) => void;
  onTogglePin: (nodeId: string) => void;
  onChangeColor: (nodeId: string, color: NodeColor) => void;
  scale: number;
}

export const NodeCard: React.FC<NodeCardProps> = ({
  node,
  isSelected,
  isConnectingSource,
  isConnectingTargetHovered,
  isDarkMode,
  onSelect,
  onStartConnect,
  onToggleChecklist,
  onOpenEdit,
  onDelete,
  onDuplicate,
  onTogglePin,
  onChangeColor,
  scale
}) => {
  const [showMenu, setShowMenu] = React.useState(false);
  const colorScheme = NODE_COLOR_MAP[node.color] || NODE_COLOR_MAP.indigo;
  const dim = getNodeDimensions(node);

  const completedCount = node.checklist?.filter((c) => c.done).length || 0;
  const totalChecklist = node.checklist?.length || 0;
  const progressPercent = totalChecklist > 0 ? Math.round((completedCount / totalChecklist) * 100) : 0;

  const renderIcon = () => {
    switch (node.type) {
      case 'concept':
        return <Brain className="w-4 h-4" />;
      case 'sticky':
        return <StickyNote className="w-4 h-4" />;
      case 'task':
        return <CheckSquare className="w-4 h-4" />;
      case 'resource':
        return <Link2 className="w-4 h-4" />;
      default:
        return <Brain className="w-4 h-4" />;
    }
  };

  const handleAnchorClick = (anchor: 'top' | 'bottom' | 'left' | 'right', e: React.MouseEvent) => {
    e.stopPropagation();
    onStartConnect(node, anchor, e);
  };

  return (
    <div
      id={`node-${node.id}`}
      style={{
        transform: `translate3d(${node.x}px, ${node.y}px, 0px)`,
        width: dim.width,
        zIndex: isSelected ? 30 : node.pinned ? 20 : 10
      }}
      className={`absolute group select-none transition-all duration-200 cursor-grab active:cursor-grabbing rounded-2xl border ${
        isDarkMode
          ? `${colorScheme.bgDark} ${colorScheme.borderDark} text-slate-100 shadow-xl shadow-black/50 backdrop-blur-2xl`
          : `${colorScheme.bgLight} ${colorScheme.borderLight} text-slate-900 shadow-lg shadow-slate-200/50 backdrop-blur-2xl`
      } ${
        isSelected
          ? isDarkMode
            ? 'ring-2 ring-indigo-400/90 border-indigo-400/80 shadow-[0_0_45px_-8px_rgba(99,102,241,0.55)] scale-[1.015]'
            : 'ring-2 ring-indigo-500 border-indigo-400 shadow-[0_0_30px_-5px_rgba(99,102,241,0.35)] scale-[1.015]'
          : 'hover:border-white/30 hover:shadow-2xl'
      } ${
        isConnectingSource
          ? 'ring-2 ring-amber-400 animate-pulse shadow-[0_0_30px_-5px_rgba(245,158,11,0.4)]'
          : isConnectingTargetHovered
          ? 'ring-2 ring-emerald-400 scale-[1.03] shadow-[0_0_30px_-5px_rgba(16,185,129,0.4)]'
          : ''
      }`}
      onClick={(e) => onSelect(node, e)}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onOpenEdit(node);
      }}
    >
      {/* Anchors for Linking */}
      <button
        id={`anchor-top-${node.id}`}
        title="Bağlantı Çek (Üst)"
        onClick={(e) => handleAnchorClick('top', e)}
        className={`absolute -top-3 left-1/2 -translate-x-1/2 w-6 h-6 rounded-full border flex items-center justify-center transition-all ${
          isDarkMode
            ? 'bg-[#080911]/90 border-white/20 text-slate-300 hover:bg-indigo-600 hover:border-indigo-400 hover:text-white backdrop-blur-md'
            : 'bg-white border-slate-300 text-slate-700 hover:bg-indigo-600 hover:border-indigo-600 hover:text-white'
        } opacity-0 group-hover:opacity-100 scale-75 group-hover:scale-100 shadow-lg z-40`}
      >
        <Plus className="w-3.5 h-3.5" />
      </button>

      <button
        id={`anchor-bottom-${node.id}`}
        title="Bağlantı Çek (Alt)"
        onClick={(e) => handleAnchorClick('bottom', e)}
        className={`absolute -bottom-3 left-1/2 -translate-x-1/2 w-6 h-6 rounded-full border flex items-center justify-center transition-all ${
          isDarkMode
            ? 'bg-[#080911]/90 border-white/20 text-slate-300 hover:bg-indigo-600 hover:border-indigo-400 hover:text-white backdrop-blur-md'
            : 'bg-white border-slate-300 text-slate-700 hover:bg-indigo-600 hover:border-indigo-600 hover:text-white'
        } opacity-0 group-hover:opacity-100 scale-75 group-hover:scale-100 shadow-lg z-40`}
      >
        <Plus className="w-3.5 h-3.5" />
      </button>

      <button
        id={`anchor-left-${node.id}`}
        title="Bağlantı Çek (Sol)"
        onClick={(e) => handleAnchorClick('left', e)}
        className={`absolute top-1/2 -left-3 -translate-y-1/2 w-6 h-6 rounded-full border flex items-center justify-center transition-all ${
          isDarkMode
            ? 'bg-[#080911]/90 border-white/20 text-slate-300 hover:bg-indigo-600 hover:border-indigo-400 hover:text-white backdrop-blur-md'
            : 'bg-white border-slate-300 text-slate-700 hover:bg-indigo-600 hover:border-indigo-600 hover:text-white'
        } opacity-0 group-hover:opacity-100 scale-75 group-hover:scale-100 shadow-lg z-40`}
      >
        <Plus className="w-3.5 h-3.5" />
      </button>

      <button
        id={`anchor-right-${node.id}`}
        title="Bağlantı Çek (Sağ)"
        onClick={(e) => handleAnchorClick('right', e)}
        className={`absolute top-1/2 -right-3 -translate-y-1/2 w-6 h-6 rounded-full border flex items-center justify-center transition-all ${
          isDarkMode
            ? 'bg-[#080911]/90 border-white/20 text-slate-300 hover:bg-indigo-600 hover:border-indigo-400 hover:text-white backdrop-blur-md'
            : 'bg-white border-slate-300 text-slate-700 hover:bg-indigo-600 hover:border-indigo-600 hover:text-white'
        } opacity-0 group-hover:opacity-100 scale-75 group-hover:scale-100 shadow-lg z-40`}
      >
        <Plus className="w-3.5 h-3.5" />
      </button>

      {/* Header */}
      <div className="p-3.5 pb-2.5 border-b border-black/5 dark:border-white/10 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className={`w-7 h-7 rounded-xl flex items-center justify-center shrink-0 border ${
              isDarkMode ? `${colorScheme.badgeBgDark} border-white/10` : `${colorScheme.badgeBgLight} border-slate-200`
            }`}
          >
            {renderIcon()}
          </div>
          <h3 className="font-semibold text-sm truncate leading-snug tracking-tight">
            {node.title || 'İsimsiz Düğüm'}
          </h3>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {node.pinned && (
            <span
              title="Sabitlendi"
              className="text-amber-400 hover:text-amber-300 cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                onTogglePin(node.id);
              }}
            >
              <Pin className="w-3.5 h-3.5 fill-amber-400" />
            </span>
          )}

          {/* More Action Menu Trigger */}
          <div className="relative">
            <button
              id={`node-menu-btn-${node.id}`}
              title="Seçenekler"
              onClick={(e) => {
                e.stopPropagation();
                setShowMenu(!showMenu);
              }}
              className={`p-1 rounded-lg transition-colors ${
                isDarkMode ? 'hover:bg-white/10 text-slate-400 hover:text-slate-200' : 'hover:bg-slate-100 text-slate-500 hover:text-slate-800'
              }`}
            >
              <MoreHorizontal className="w-3.5 h-3.5" />
            </button>

            {showMenu && (
              <div
                className={`absolute right-0 top-full mt-2 w-52 rounded-2xl shadow-2xl border p-1.5 z-50 animate-in fade-in-50 zoom-in-95 backdrop-blur-2xl ${
                  isDarkMode ? 'bg-[#080911]/90 border-white/15 text-slate-200' : 'bg-white/95 border-slate-200 text-slate-800'
                }`}
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  id={`node-menu-edit-${node.id}`}
                  onClick={() => {
                    setShowMenu(false);
                    onOpenEdit(node);
                  }}
                  className="w-full px-3 py-1.5 text-xs text-left rounded-xl flex items-center gap-2 hover:bg-indigo-500/15 hover:text-indigo-400 transition-colors"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  Düzenle (Çift Tıkla)
                </button>
                <button
                  id={`node-menu-dup-${node.id}`}
                  onClick={() => {
                    setShowMenu(false);
                    onDuplicate(node);
                  }}
                  className="w-full px-3 py-1.5 text-xs text-left rounded-xl flex items-center gap-2 hover:bg-indigo-500/15 hover:text-indigo-400 transition-colors"
                >
                  <Copy className="w-3.5 h-3.5" />
                  Kopyasını Oluştur
                </button>
                <button
                  id={`node-menu-pin-${node.id}`}
                  onClick={() => {
                    setShowMenu(false);
                    onTogglePin(node.id);
                  }}
                  className="w-full px-3 py-1.5 text-xs text-left rounded-xl flex items-center gap-2 hover:bg-indigo-500/15 hover:text-indigo-400 transition-colors"
                >
                  <Pin className="w-3.5 h-3.5" />
                  {node.pinned ? 'Sabitlemeyi Kaldır' : 'Tuvale Sabitle'}
                </button>

                {/* Color choices */}
                <div className="px-3 py-2 border-t border-b border-black/5 dark:border-white/10 my-1">
                  <div className="text-[10px] font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">Renk Paleti:</div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {(['indigo', 'cyan', 'emerald', 'amber', 'rose', 'violet', 'fuchsia', 'slate'] as NodeColor[]).map((c) => (
                      <button
                        key={c}
                        onClick={() => {
                          onChangeColor(node.id, c);
                          setShowMenu(false);
                        }}
                        style={{ backgroundColor: NODE_COLOR_MAP[c].accent }}
                        className={`w-4 h-4 rounded-full transition-transform hover:scale-125 ${
                          node.color === c ? 'ring-2 ring-offset-2 ring-white/60 scale-110' : ''
                        }`}
                      />
                    ))}
                  </div>
                </div>

                <button
                  id={`node-menu-del-${node.id}`}
                  onClick={() => {
                    setShowMenu(false);
                    onDelete(node.id);
                  }}
                  className="w-full px-3 py-1.5 text-xs text-left rounded-xl flex items-center gap-2 text-rose-400 hover:bg-rose-500/15 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Düğümü Sil
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Body Content */}
      <div className="p-3.5 pt-2.5 space-y-2.5">
        {/* Summary or Content */}
        {node.summary && (
          <p className="text-xs line-clamp-2 leading-relaxed opacity-85">{node.summary}</p>
        )}

        {!node.summary && node.content && node.type === 'sticky' && (
          <p className="text-xs line-clamp-4 leading-relaxed font-mono opacity-90">{node.content}</p>
        )}

        {/* Task Checklist Items (if type === 'task' or has checklist) */}
        {node.checklist && node.checklist.length > 0 && (
          <div className="space-y-1.5 pt-1">
            {/* Progress Bar */}
            <div className="flex items-center justify-between text-[11px] font-medium text-slate-400 mb-1">
              <span>İlerleme</span>
              <span>
                {completedCount}/{totalChecklist} (%{progressPercent})
              </span>
            </div>
            <div className="w-full h-1.5 bg-black/10 dark:bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 transition-all duration-300 rounded-full"
                style={{ width: `${progressPercent}%` }}
              />
            </div>

            <div className="space-y-1 max-h-24 overflow-y-auto pr-1">
              {node.checklist.slice(0, 3).map((item) => (
                <div
                  key={item.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleChecklist(node.id, item.id);
                  }}
                  className="flex items-start gap-1.5 text-xs cursor-pointer group/item hover:opacity-100 opacity-80"
                >
                  {item.done ? (
                    <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                  ) : (
                    <Circle className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5 group-hover/item:text-slate-200" />
                  )}
                  <span className={`leading-snug truncate ${item.done ? 'line-through text-slate-400' : ''}`}>
                    {item.text}
                  </span>
                </div>
              ))}
              {node.checklist.length > 3 && (
                <div className="text-[10px] text-slate-400 font-medium pl-5">
                  +{node.checklist.length - 3} daha fazla madde...
                </div>
              )}
            </div>
          </div>
        )}

        {/* Resources Preview (if type === 'resource' or has resources) */}
        {node.resources && node.resources.length > 0 && (
          <div className="space-y-1 pt-1">
            <div className="text-[10px] uppercase tracking-wider font-semibold text-slate-400">Kaynaklar</div>
            {node.resources.slice(0, 2).map((res) => (
              <a
                key={res.id}
                href={res.url}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className={`flex items-center justify-between text-xs p-1.5 rounded-lg border transition-colors ${
                  isDarkMode
                    ? 'bg-slate-900/60 border-slate-800 hover:bg-slate-800 text-slate-200'
                    : 'bg-white/80 border-slate-200 hover:bg-white text-slate-800'
                }`}
              >
                <span className="truncate pr-2 font-medium">{res.title}</span>
                <ExternalLink className="w-3 h-3 shrink-0 opacity-60" />
              </a>
            ))}
          </div>
        )}

        {/* Tags */}
        {node.tags && node.tags.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap pt-1">
            {node.tags.slice(0, 3).map((tag, idx) => (
              <span
                key={idx}
                className={`text-[10px] px-2 py-0.5 rounded-md font-medium ${
                  isDarkMode ? colorScheme.badgeBgDark : colorScheme.badgeBgLight
                }`}
              >
                #{tag}
              </span>
            ))}
            {node.tags.length > 3 && (
              <span className="text-[10px] text-slate-400">+{node.tags.length - 3}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
