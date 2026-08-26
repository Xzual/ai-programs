export type NodeType = 'concept' | 'sticky' | 'task' | 'resource';

export type NodeColor =
  | 'indigo'
  | 'emerald'
  | 'amber'
  | 'rose'
  | 'cyan'
  | 'violet'
  | 'slate'
  | 'fuchsia';

export type EdgeStyle = 'curved' | 'solid' | 'dashed' | 'dotted' | 'glow';

export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

export interface ResourceLink {
  id: string;
  title: string;
  url: string;
  type: 'article' | 'video' | 'paper' | 'tool' | 'doc';
}

export interface KnowledgeNode {
  id: string;
  type: NodeType;
  title: string;
  summary: string;
  content: string;
  tags: string[];
  x: number;
  y: number;
  width?: number;
  height?: number;
  color: NodeColor;
  icon?: string;
  pinned?: boolean;
  checklist?: ChecklistItem[];
  resources?: ResourceLink[];
  createdAt: number;
  updatedAt: number;
  clusterId?: string;
}

export interface KnowledgeEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  label?: string;
  style: EdgeStyle;
  color?: NodeColor;
  animated?: boolean;
  arrow?: boolean;
}

export interface ClusterGroup {
  id: string;
  title: string;
  color: NodeColor;
  x: number;
  y: number;
  width: number;
  height: number;
  description?: string;
}

export interface InboxNote {
  id: string;
  title: string;
  content: string;
  color: NodeColor;
  tags: string[];
  createdAt: number;
}

export interface CanvasTransform {
  x: number;
  y: number;
  zoom: number;
}

export interface BackupSnapshot {
  id: string;
  name: string;
  timestamp: number;
  nodeCount: number;
  edgeCount: number;
  inboxCount: number;
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
  inboxNotes: InboxNote[];
  clusters: ClusterGroup[];
  theme: 'dark' | 'light';
  triggerType: 'auto' | 'manual' | 'import' | 'template';
  description?: string;
}

export interface MapData {
  title: string;
  description: string;
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
  inboxNotes: InboxNote[];
  clusters: ClusterGroup[];
  updatedAt: number;
}

export type GridStyle = 'dots' | 'grid' | 'isometric' | 'blank';
