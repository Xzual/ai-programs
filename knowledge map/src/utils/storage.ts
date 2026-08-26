import { BackupSnapshot, MapData, KnowledgeNode, KnowledgeEdge, ClusterGroup, InboxNote } from '../types';
import { TEMPLATES } from '../data/templates';

const MAP_DATA_KEY = 'knowledge_map_studio_data_v1';
const SNAPSHOTS_KEY = 'knowledge_map_studio_snapshots_v1';
const THEME_KEY = 'knowledge_map_studio_theme_v1';
const BACKUP_INTERVAL_KEY = 'knowledge_map_studio_backup_interval_v1';

export function getInitialMapData(): MapData {
  try {
    const saved = localStorage.getItem(MAP_DATA_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed && Array.isArray(parsed.nodes)) {
        return parsed;
      }
    }
  } catch (err) {
    console.error('Failed to parse saved map data:', err);
  }
  // Default to AI & Deep Learning template
  return TEMPLATES[0].data;
}

export function saveMapData(data: MapData): void {
  try {
    const updatedData = { ...data, updatedAt: Date.now() };
    localStorage.setItem(MAP_DATA_KEY, JSON.stringify(updatedData));
  } catch (err) {
    console.error('Failed to save map data:', err);
  }
}

export function getStoredSnapshots(): BackupSnapshot[] {
  try {
    const saved = localStorage.getItem(SNAPSHOTS_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    }
  } catch (err) {
    console.error('Failed to load snapshots:', err);
  }
  return [];
}

export function saveSnapshot(
  data: MapData,
  theme: 'dark' | 'light',
  triggerType: 'auto' | 'manual' | 'import' | 'template',
  customName?: string
): BackupSnapshot {
  const snapshots = getStoredSnapshots();
  const timestamp = Date.now();
  const dateStr = new Date(timestamp).toLocaleTimeString('tr-TR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  const defaultName =
    triggerType === 'auto'
      ? `Otomatik Yedek (${dateStr})`
      : triggerType === 'manual'
      ? customName || `Manuel Yedek (${dateStr})`
      : triggerType === 'import'
      ? `İçe Aktarma Noktası (${dateStr})`
      : `Şablon Başlangıcı (${dateStr})`;

  const snapshot: BackupSnapshot = {
    id: `snap-${timestamp}-${Math.random().toString(36).substr(2, 6)}`,
    name: defaultName,
    timestamp,
    nodeCount: data.nodes.length,
    edgeCount: data.edges.length,
    inboxCount: data.inboxNotes?.length || 0,
    nodes: JSON.parse(JSON.stringify(data.nodes)),
    edges: JSON.parse(JSON.stringify(data.edges)),
    inboxNotes: JSON.parse(JSON.stringify(data.inboxNotes || [])),
    clusters: JSON.parse(JSON.stringify(data.clusters || [])),
    theme,
    triggerType,
    description: `${data.nodes.length} düğüm, ${data.edges.length} bağlantı, ${data.inboxNotes?.length || 0} havuz notu`
  };

  // Prepend to top and limit to 30 snapshots
  const updated = [snapshot, ...snapshots].slice(0, 30);
  try {
    localStorage.setItem(SNAPSHOTS_KEY, JSON.stringify(updated));
  } catch (err) {
    console.error('Failed to save snapshot:', err);
  }
  return snapshot;
}

export function deleteSnapshot(snapshotId: string): BackupSnapshot[] {
  const snapshots = getStoredSnapshots().filter((s) => s.id !== snapshotId);
  try {
    localStorage.setItem(SNAPSHOTS_KEY, JSON.stringify(snapshots));
  } catch (err) {
    console.error('Failed to delete snapshot:', err);
  }
  return snapshots;
}

export function clearAllSnapshots(): void {
  try {
    localStorage.removeItem(SNAPSHOTS_KEY);
  } catch (err) {
    console.error('Failed to clear snapshots:', err);
  }
}

export function getStoredTheme(): 'dark' | 'light' {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
  } catch (e) {
    // fallback
  }
  return 'dark';
}

export function saveTheme(theme: 'dark' | 'light'): void {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch (e) {}
}

export function getStoredBackupInterval(): number {
  try {
    const saved = localStorage.getItem(BACKUP_INTERVAL_KEY);
    if (saved) {
      const num = parseInt(saved, 10);
      if (!isNaN(num) && num > 0) return num;
    }
  } catch (e) {}
  return 180; // 3 minutes in seconds
}

export function saveBackupInterval(seconds: number): void {
  try {
    localStorage.setItem(BACKUP_INTERVAL_KEY, seconds.toString());
  } catch (e) {}
}

export function exportMapToJSON(data: MapData): void {
  const exportPayload = {
    app: 'Knowledge Map Studio',
    version: '1.0.0',
    exportedAt: new Date().toISOString(),
    map: data
  };

  const blob = new Blob([JSON.stringify(exportPayload, null, 2)], {
    type: 'application/json'
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const safeTitle = (data.title || 'knowledge-map')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-');
  a.href = url;
  a.download = `${safeTitle}-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function exportMapToMarkdown(data: MapData): void {
  let md = `# ${data.title || 'Bilgi Haritası'}\n\n`;
  if (data.description) {
    md += `> ${data.description}\n\n`;
  }
  md += `_Son Güncelleme: ${new Date(data.updatedAt).toLocaleString('tr-TR')}_\n\n`;

  // Clusters
  if (data.clusters && data.clusters.length > 0) {
    md += `## Kümeler & Kategoriler\n\n`;
    data.clusters.forEach((cl) => {
      md += `### 📁 ${cl.title}\n`;
      if (cl.description) md += `${cl.description}\n\n`;
      const clusterNodes = data.nodes.filter((n) => n.clusterId === cl.id);
      clusterNodes.forEach((n) => {
        md += `- **${n.title}** (${n.type})\n  ${n.summary || n.content}\n`;
      });
      md += `\n`;
    });
  }

  // All Nodes
  md += `## Tüm Düğümler (${data.nodes.length})\n\n`;
  data.nodes.forEach((node) => {
    md += `### ✦ ${node.title}\n`;
    md += `- **Tür**: \`${node.type}\` | **Renk**: \`${node.color}\`\n`;
    if (node.tags && node.tags.length > 0) {
      md += `- **Etiketler**: ${node.tags.map((t) => `#${t}`).join(', ')}\n`;
    }
    if (node.summary) {
      md += `\n**Özet:**\n${node.summary}\n`;
    }
    if (node.content) {
      md += `\n**İçerik & Notlar:**\n${node.content}\n`;
    }
    if (node.checklist && node.checklist.length > 0) {
      md += `\n**Kontrol Listesi:**\n`;
      node.checklist.forEach((item) => {
        md += `- [${item.done ? 'x' : ' '}] ${item.text}\n`;
      });
    }
    if (node.resources && node.resources.length > 0) {
      md += `\n**Kaynaklar & Bağlantılar:**\n`;
      node.resources.forEach((r) => {
        md += `- [${r.title}](${r.url}) (${r.type})\n`;
      });
    }
    md += `\n---\n\n`;
  });

  // Connections
  if (data.edges && data.edges.length > 0) {
    md += `## İlişkiler & Bağlantılar (${data.edges.length})\n\n`;
    data.edges.forEach((edge) => {
      const from = data.nodes.find((n) => n.id === edge.fromNodeId)?.title || edge.fromNodeId;
      const to = data.nodes.find((n) => n.id === edge.toNodeId)?.title || edge.toNodeId;
      md += `- **${from}** ──(${edge.label || 'bağlantılı'})──> **${to}**\n`;
    });
    md += `\n`;
  }

  // Inbox Notes
  if (data.inboxNotes && data.inboxNotes.length > 0) {
    md += `## Havuzdaki Notlar (${data.inboxNotes.length})\n\n`;
    data.inboxNotes.forEach((note) => {
      md += `### 📝 ${note.title}\n`;
      md += `${note.content}\n`;
      if (note.tags?.length) {
        md += `_Etiketler: ${note.tags.join(', ')}_\n`;
      }
      md += `\n`;
    });
  }

  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const safeTitle = (data.title || 'knowledge-map')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-');
  a.href = url;
  a.download = `${safeTitle}-notlar-${new Date().toISOString().slice(0, 10)}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
