import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  KnowledgeNode,
  KnowledgeEdge,
  MapData,
  NodeType,
  NodeColor,
  BackupSnapshot,
  CanvasTransform,
  InboxNote
} from './types';
import {
  getInitialMapData,
  saveMapData,
  getStoredSnapshots,
  saveSnapshot,
  deleteSnapshot,
  getStoredTheme,
  saveTheme,
  getStoredBackupInterval,
  saveBackupInterval,
  exportMapToJSON,
  exportMapToMarkdown
} from './utils/storage';
import { TemplateDefinition } from './data/templates';
import { KnowledgeCanvas } from './components/Canvas/KnowledgeCanvas';
import { Minimap } from './components/Canvas/Minimap';
import { InboxTray } from './components/Sidebar/InboxTray';
import { HeaderNavbar } from './components/Navbar/HeaderNavbar';
import { BackupManagerModal } from './components/Modals/BackupManagerModal';
import { NodeEditorDrawer } from './components/Modals/NodeEditorDrawer';
import confetti from 'canvas-confetti';

export default function App() {
  // 1. Core Map Data State
  const [mapData, setMapData] = useState<MapData>(() => getInitialMapData());
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => getStoredTheme() === 'dark');
  const [backupInterval, setBackupInterval] = useState<number>(() => getStoredBackupInterval());
  const [snapshots, setSnapshots] = useState<BackupSnapshot[]>(() => getStoredSnapshots());
  const [lastBackupTime, setLastBackupTime] = useState<number | null>(() => {
    const snaps = getStoredSnapshots();
    return snaps.length > 0 ? snaps[0].timestamp : Date.now();
  });
  const [lastSavedText, setLastSavedText] = useState<string>('Kaydedildi');

  // 2. UI & Canvas States
  const [transform, setTransform] = useState<CanvasTransform>({ x: 100, y: 80, zoom: 0.95 });
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [editingNode, setEditingNode] = useState<KnowledgeNode | null>(null);
  const [isInboxOpen, setIsInboxOpen] = useState<boolean>(false);
  const [isBackupModalOpen, setIsBackupModalOpen] = useState<boolean>(false);
  const [showMinimap, setShowMinimap] = useState<boolean>(true);

  // Auto-save debouncer
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Sync dark mode class on <html> document
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    saveTheme(isDarkMode ? 'dark' : 'light');
  }, [isDarkMode]);

  // Save map data whenever it changes
  useEffect(() => {
    setLastSavedText('Kaydediliyor...');
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);

    saveTimeoutRef.current = setTimeout(() => {
      saveMapData(mapData);
      setLastSavedText('Tüm değişiklikler kaydedildi');
    }, 400);

    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, [mapData]);

  // Auto-Backup Timer Loop
  useEffect(() => {
    if (backupInterval <= 0) return;

    const intervalMs = backupInterval * 1000;
    const intervalTimer = setInterval(() => {
      // Create auto snapshot
      const snap = saveSnapshot(mapData, isDarkMode ? 'dark' : 'light', 'auto');
      setSnapshots(getStoredSnapshots());
      setLastBackupTime(snap.timestamp);
    }, intervalMs);

    return () => clearInterval(intervalTimer);
  }, [mapData, isDarkMode, backupInterval]);

  // Handlers for Map Data Mutation
  const updateMap = useCallback((updater: (prev: MapData) => MapData) => {
    setMapData((prev) => updater(prev));
  }, []);

  const handleUpdateNodePosition = (nodeId: string, x: number, y: number) => {
    updateMap((prev) => ({
      ...prev,
      nodes: prev.nodes.map((n) => (n.id === nodeId ? { ...n, x, y } : n))
    }));
  };

  const handleAddNode = (type: NodeType) => {
    const id = `node-${Date.now()}`;
    const screenCenterCanvasX = Math.round((-transform.x + window.innerWidth / 2) / transform.zoom - 140);
    const screenCenterCanvasY = Math.round((-transform.y + window.innerHeight / 2) / transform.zoom - 100);

    const colors: NodeColor[] = ['indigo', 'cyan', 'emerald', 'amber', 'rose', 'violet'];
    const randomColor = colors[Math.floor(Math.random() * colors.length)];

    let title = 'Yeni Kavram Düğümü';
    let summary = 'Açıklama veya özet eklemek için çift tıklayın.';
    if (type === 'sticky') {
      title = 'Hızlı Fikir';
      summary = '';
    } else if (type === 'task') {
      title = 'Yeni Görev Dizisi';
      summary = 'Adımları ve kontrol maddelerini tanımlayın.';
    } else if (type === 'resource') {
      title = 'Yeni Kaynak Düğümü';
      summary = 'Referans link ve dokümanları bağlayın.';
    }

    const newNode: KnowledgeNode = {
      id,
      type,
      title,
      summary,
      content: '',
      tags: ['Yeni'],
      x: screenCenterCanvasX,
      y: screenCenterCanvasY,
      color: randomColor,
      checklist:
        type === 'task'
          ? [
              { id: 'c1', text: 'İlk aşama araştırması', done: false },
              { id: 'c2', text: 'Detaylı planlama', done: false }
            ]
          : undefined,
      resources:
        type === 'resource'
          ? [{ id: 'r1', title: 'Resmi Dokümantasyon', url: 'https://google.com', type: 'doc' }]
          : undefined,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    updateMap((prev) => ({
      ...prev,
      nodes: [...prev.nodes, newNode]
    }));

    setSelectedNodeId(newNode.id);
  };

  const handleDuplicateNode = (node: KnowledgeNode) => {
    const dup: KnowledgeNode = {
      ...JSON.parse(JSON.stringify(node)),
      id: `node-${Date.now()}`,
      title: `${node.title} (Kopya)`,
      x: node.x + 40,
      y: node.y + 40,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    updateMap((prev) => ({
      ...prev,
      nodes: [...prev.nodes, dup]
    }));
    setSelectedNodeId(dup.id);
  };

  const handleDeleteNode = (nodeId: string) => {
    updateMap((prev) => ({
      ...prev,
      nodes: prev.nodes.filter((n) => n.id !== nodeId),
      edges: prev.edges.filter((e) => e.fromNodeId !== nodeId && e.toNodeId !== nodeId)
    }));
    if (selectedNodeId === nodeId) setSelectedNodeId(null);
    if (editingNode?.id === nodeId) setEditingNode(null);
  };

  const handleTogglePin = (nodeId: string) => {
    updateMap((prev) => ({
      ...prev,
      nodes: prev.nodes.map((n) => (n.id === nodeId ? { ...n, pinned: !n.pinned } : n))
    }));
  };

  const handleChangeColor = (nodeId: string, color: NodeColor) => {
    updateMap((prev) => ({
      ...prev,
      nodes: prev.nodes.map((n) => (n.id === nodeId ? { ...n, color } : n))
    }));
  };

  const handleToggleChecklist = (nodeId: string, itemId: string) => {
    updateMap((prev) => ({
      ...prev,
      nodes: prev.nodes.map((n) => {
        if (n.id !== nodeId || !n.checklist) return n;
        return {
          ...n,
          checklist: n.checklist.map((item) =>
            item.id === itemId ? { ...item, done: !item.done } : item
          )
        };
      })
    }));
  };

  const handleConnectNodes = (fromId: string, toId: string) => {
    if (fromId === toId) return;

    // Check if edge already exists
    const exists = mapData.edges.some(
      (e) => (e.fromNodeId === fromId && e.toNodeId === toId) || (e.fromNodeId === toId && e.toNodeId === fromId)
    );
    if (exists) return;

    const fromNode = mapData.nodes.find((n) => n.id === fromId);
    const newEdge: KnowledgeEdge = {
      id: `edge-${Date.now()}`,
      fromNodeId: fromId,
      toNodeId: toId,
      label: 'ilişki',
      style: 'curved',
      color: fromNode?.color || 'indigo',
      animated: true,
      arrow: true
    };

    updateMap((prev) => ({
      ...prev,
      edges: [...prev.edges, newEdge]
    }));
  };

  const handleDeleteEdge = (edgeId: string) => {
    updateMap((prev) => ({
      ...prev,
      edges: prev.edges.filter((e) => e.id !== edgeId)
    }));
  };

  // Inbox & Workspace Actions
  const handleAddInboxNote = (note: Omit<InboxNote, 'id' | 'createdAt'>) => {
    const newNote: InboxNote = {
      ...note,
      id: `inbox-${Date.now()}`,
      createdAt: Date.now()
    };
    updateMap((prev) => ({
      ...prev,
      inboxNotes: [newNote, ...(prev.inboxNotes || [])]
    }));
  };

  const handleDeleteInboxNote = (noteId: string) => {
    updateMap((prev) => ({
      ...prev,
      inboxNotes: (prev.inboxNotes || []).filter((n) => n.id !== noteId)
    }));
  };

  const handleDropInboxNoteOnCanvas = (noteId: string, canvasX: number, canvasY: number) => {
    const note = mapData.inboxNotes?.find((n) => n.id === noteId);
    if (!note) return;

    const newNode: KnowledgeNode = {
      id: `node-${Date.now()}`,
      type: 'sticky',
      title: note.title,
      summary: '',
      content: note.content,
      tags: note.tags || [],
      x: canvasX,
      y: canvasY,
      color: note.color || 'amber',
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    updateMap((prev) => ({
      ...prev,
      nodes: [...prev.nodes, newNode],
      inboxNotes: (prev.inboxNotes || []).filter((n) => n.id !== noteId)
    }));
    setSelectedNodeId(newNode.id);
  };

  const handleSendInboxNoteToCanvas = (note: InboxNote) => {
    const canvasX = Math.round((-transform.x + window.innerWidth / 2) / transform.zoom - 110);
    const canvasY = Math.round((-transform.y + window.innerHeight / 2) / transform.zoom - 90);
    handleDropInboxNoteOnCanvas(note.id, canvasX, canvasY);
  };

  // Auto Layout / Organize
  const handleAutoOrganize = () => {
    if (mapData.nodes.length === 0) return;

    const cols = Math.ceil(Math.sqrt(mapData.nodes.length));
    const spacingX = 340;
    const spacingY = 260;
    const startX = 80;
    const startY = 80;

    const rearranged = mapData.nodes.map((node, index) => {
      const col = index % cols;
      const row = Math.floor(index / cols);
      return {
        ...node,
        x: startX + col * spacingX,
        y: startY + row * spacingY
      };
    });

    updateMap((prev) => ({
      ...prev,
      nodes: rearranged
    }));

    confetti({ particleCount: 35, spread: 60, origin: { y: 0.9 } });
  };

  // Template Switcher
  const handleSelectTemplate = (template: TemplateDefinition) => {
    // Save current state to snapshot first
    saveSnapshot(mapData, isDarkMode ? 'dark' : 'light', 'template', `Eski: ${mapData.title}`);
    setMapData(JSON.parse(JSON.stringify(template.data)));
    setSnapshots(getStoredSnapshots());
    setTransform({ x: 60, y: 60, zoom: 0.9 });
    confetti({ particleCount: 60, spread: 80, origin: { y: 0.6 } });
  };

  // Backup System Handlers
  const handleRestoreSnapshot = (snap: BackupSnapshot) => {
    setMapData({
      title: snap.name || 'Geri Yüklenen Harita',
      description: snap.description || '',
      nodes: JSON.parse(JSON.stringify(snap.nodes)),
      edges: JSON.parse(JSON.stringify(snap.edges)),
      inboxNotes: JSON.parse(JSON.stringify(snap.inboxNotes || [])),
      clusters: JSON.parse(JSON.stringify(snap.clusters || [])),
      updatedAt: Date.now()
    });
    setIsBackupModalOpen(false);
  };

  const handleManualBackup = (name?: string) => {
    const snap = saveSnapshot(mapData, isDarkMode ? 'dark' : 'light', 'manual', name);
    setSnapshots(getStoredSnapshots());
    setLastBackupTime(snap.timestamp);
  };

  const handleDeleteSnapshot = (id: string) => {
    const updated = deleteSnapshot(id);
    setSnapshots(updated);
  };

  const handleChangeBackupInterval = (seconds: number) => {
    setBackupInterval(seconds);
    saveBackupInterval(seconds);
  };

  const handleImportJSON = (imported: MapData) => {
    saveSnapshot(mapData, isDarkMode ? 'dark' : 'light', 'import', `İçe aktarma öncesi: ${mapData.title}`);
    setMapData(imported);
    setSnapshots(getStoredSnapshots());
    setTransform({ x: 60, y: 60, zoom: 0.9 });
  };

  // Keyboard events (Delete node, Escape, etc.)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'TEXTAREA'
      ) {
        return;
      }

      if (e.key === 'Escape') {
        setSelectedNodeId(null);
        setEditingNode(null);
        setIsBackupModalOpen(false);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedNodeId) {
        handleDeleteNode(selectedNodeId);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedNodeId]);

  return (
    <div
      id="knowledge-map-app-root"
      className={`w-screen h-screen flex flex-col overflow-hidden select-none transition-colors duration-300 relative ${
        isDarkMode ? 'dark bg-[#050508] text-slate-100' : 'bg-[#f4f6fb] text-slate-900'
      }`}
    >
      {/* Frosted Glass Ambient Glowing Orbs */}
      <div
        className={`absolute -top-40 -left-40 w-[600px] h-[600px] rounded-full blur-[120px] pointer-events-none transition-opacity duration-700 ${
          isDarkMode ? 'bg-indigo-600/20 opacity-100' : 'bg-indigo-400/15 opacity-80'
        }`}
      />
      <div
        className={`absolute -bottom-40 -right-20 w-[550px] h-[550px] rounded-full blur-[110px] pointer-events-none transition-opacity duration-700 ${
          isDarkMode ? 'bg-purple-600/15 opacity-100' : 'bg-purple-400/10 opacity-70'
        }`}
      />
      <div
        className={`absolute top-1/3 right-1/4 w-[450px] h-[450px] rounded-full blur-[130px] pointer-events-none transition-opacity duration-700 ${
          isDarkMode ? 'bg-cyan-500/10 opacity-100' : 'bg-cyan-400/10 opacity-60'
        }`}
      />

      {/* 1. Header Navigation Bar */}
      <HeaderNavbar
        data={mapData}
        isDarkMode={isDarkMode}
        onToggleTheme={() => setIsDarkMode(!isDarkMode)}
        onOpenBackupModal={() => setIsBackupModalOpen(true)}
        onSelectTemplate={handleSelectTemplate}
        onAddNode={handleAddNode}
        onSearchSelect={(nodeId) => {
          setSelectedNodeId(nodeId);
          const target = mapData.nodes.find((n) => n.id === nodeId);
          if (target) {
            setTransform({
              x: window.innerWidth / 2 - target.x * transform.zoom - 140,
              y: window.innerHeight / 2 - target.y * transform.zoom - 100,
              zoom: Math.max(transform.zoom, 0.9)
            });
          }
        }}
        onAutoOrganize={handleAutoOrganize}
        onUpdateTitle={(title) => updateMap((prev) => ({ ...prev, title }))}
        lastSavedText={lastSavedText}
      />

      {/* 2. Main Infinite Knowledge Canvas */}
      <main className="flex-1 relative overflow-hidden">
        <KnowledgeCanvas
          nodes={mapData.nodes}
          edges={mapData.edges}
          clusters={mapData.clusters || []}
          isDarkMode={isDarkMode}
          selectedNodeId={selectedNodeId}
          onSelectNode={(node) => setSelectedNodeId(node ? node.id : null)}
          onUpdateNodePosition={handleUpdateNodePosition}
          onConnectNodes={handleConnectNodes}
          onToggleChecklist={handleToggleChecklist}
          onOpenEdit={(node) => setEditingNode(node)}
          onDeleteNode={handleDeleteNode}
          onDuplicateNode={handleDuplicateNode}
          onTogglePin={handleTogglePin}
          onChangeColor={handleChangeColor}
          onDeleteEdge={handleDeleteEdge}
          onDropInboxNoteOnCanvas={handleDropInboxNoteOnCanvas}
          transform={transform}
          onTransformChange={setTransform}
        />

        {/* 3. Interactive Radar Minimap (Bottom-Right) */}
        {showMinimap && (
          <div className="absolute bottom-5 right-5 z-30 hidden md:block">
            <Minimap
              nodes={mapData.nodes}
              clusters={mapData.clusters || []}
              transform={transform}
              canvasWidth={window.innerWidth}
              canvasHeight={window.innerHeight - 64}
              isDarkMode={isDarkMode}
              onNavigate={(newX, newY) => setTransform((prev) => ({ ...prev, x: newX, y: newY }))}
            />
          </div>
        )}

        {/* 4. Sliding Workspace Inbox & Note Pool */}
        <InboxTray
          notes={mapData.inboxNotes || []}
          isOpen={isInboxOpen}
          onToggle={() => setIsInboxOpen(!isInboxOpen)}
          isDarkMode={isDarkMode}
          onAddNote={handleAddInboxNote}
          onDeleteNote={handleDeleteInboxNote}
          onSendToCanvas={handleSendInboxNoteToCanvas}
        />

        {/* 5. Node Detailed Editor Drawer */}
        <NodeEditorDrawer
          node={editingNode}
          edges={mapData.edges}
          allNodes={mapData.nodes}
          isOpen={!!editingNode}
          onClose={() => setEditingNode(null)}
          isDarkMode={isDarkMode}
          onUpdateNode={(updated) => {
            updateMap((prev) => ({
              ...prev,
              nodes: prev.nodes.map((n) => (n.id === updated.id ? updated : n))
            }));
            setEditingNode(updated);
          }}
          onDeleteNode={handleDeleteNode}
          onFocusNode={(otherNodeId) => {
            setSelectedNodeId(otherNodeId);
            const target = mapData.nodes.find((n) => n.id === otherNodeId);
            if (target) {
              setTransform({
                x: window.innerWidth / 2 - target.x * transform.zoom - 140,
                y: window.innerHeight / 2 - target.y * transform.zoom - 100,
                zoom: Math.max(transform.zoom, 0.9)
              });
              setEditingNode(target);
            }
          }}
        />

        {/* 6. Automatic Backup & Data Safety Center Modal */}
        <BackupManagerModal
          isOpen={isBackupModalOpen}
          onClose={() => setIsBackupModalOpen(false)}
          isDarkMode={isDarkMode}
          currentData={mapData}
          snapshots={snapshots}
          backupInterval={backupInterval}
          lastBackupTime={lastBackupTime}
          onRestoreSnapshot={handleRestoreSnapshot}
          onManualBackup={handleManualBackup}
          onDeleteSnapshot={handleDeleteSnapshot}
          onChangeBackupInterval={handleChangeBackupInterval}
          onExportJSON={() => exportMapToJSON(mapData)}
          onExportMarkdown={() => exportMapToMarkdown(mapData)}
          onImportJSON={handleImportJSON}
        />
      </main>
    </div>
  );
}
