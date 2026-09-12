import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  Activity,
  AlertTriangle,
  Bot,
  Briefcase,
  Building2,
  CheckSquare,
  Clock,
  Copy,
  Database,
  FileText,
  Focus,
  Home,
  LockKeyhole,
  Maximize2,
  MessageCircle,
  Network,
  RefreshCw,
  Search,
  ShieldCheck,
  Users,
  Zap,
} from 'lucide-react';
import { AutomationTool, MemoryItem, ToolExecutionLog } from '../../types';

interface KnowledgeMapViewProps {
  memories: MemoryItem[];
  tools: AutomationTool[];
  logs: ToolExecutionLog[];
}

type NodeType =
  | 'Vault'
  | 'Folder'
  | 'Tag'
  | 'Person'
  | 'Organization'
  | 'Project'
  | 'Task'
  | 'Note'
  | 'Conversation'
  | 'Website'
  | 'File'
  | 'Agent'
  | 'Memory'
  | 'Tool'
  | 'Event'
  | 'Trade'
  | 'Model'
  | 'Provider'
  | 'Decision'
  | 'System'
  | 'Concept'
  | 'Automation'
  | 'SecurityEvent';

interface GraphNode {
  id: string;
  title: string;
  type: NodeType;
  aliases: string[];
  tags: string[];
  path?: string;
  folder?: string;
  source: string;
  importance: number;
  recentActivityAt: string;
  properties: Record<string, unknown>;
  summary?: string;
  backlinks?: string[];
  outgoingLinks?: string[];
  status?: string;
  riskLevel?: number;
  confidence?: number;
}

interface GraphRelationship {
  id: string;
  from: string;
  to: string;
  type: string;
  strength: number;
  source: string;
  evidence: string;
  updatedAt: string;
}

interface KnowledgeGraphSnapshot {
  generatedAt: string;
  nodes: GraphNode[];
  relationships: GraphRelationship[];
  metrics: Array<{ label: string; value: number }>;
  sources: Record<string, number>;
  recommendations: Array<{ id: string; title: string; rationale: string; confidence: number }>;
}

interface ObsidianStatus {
  vaultExists: boolean;
  obsidianConfigExists: boolean;
  watcherActive: boolean;
  lastSyncAt?: string;
  indexedNotes: number;
  chunks: number;
  settings: { vaultPath: string };
  connectionStatus?: 'connected' | 'synced' | 'syncing' | 'configuration_required' | 'disabled' | 'read_failed' | 'write_failed' | 'partial';
  mode?: string;
  obsidianEnabled?: boolean;
  vaultPathConfigured?: boolean;
  vaultFound?: boolean;
  readable?: boolean;
  writable?: boolean;
  nodeCount?: number;
  edgeCount?: number;
  lastError?: string;
  indexedFolders?: string[];
  recentEvents: Array<{ id: string; action: string; path: string; status: string; createdAt: string }>;
}

interface KnowledgeActivity {
  generatedAt: string;
  mode: 'polling';
  realtime: 'polling';
  auditEvents: Array<{ id: string; action: string; toolId: string; result: string; timestamp: string; message?: string }>;
  syncEvents: Array<{ id: string; action: string; path: string; status: string; createdAt: string }>;
  toolRuns: Array<{ id: string; toolId: string; toolName: string; status: string; timestamp: number; result?: string }>;
  tasks: Array<{ id: string; title: string; status: string; updatedAt: string }>;
}

type PositionedNode = GraphNode & {
  position: THREE.Vector3;
  radius: number;
  color: string;
  degree: number;
  isHub: boolean;
};

type GraphMode = 'SEMANTIC' | 'OPERATIONAL' | 'MEMORY' | 'OBSIDIAN' | 'TIMELINE' | 'LIVE' | 'SECURITY';
type TimeRange = 'all' | '24h' | '7d' | '30d';
const graphModes: GraphMode[] = ['SEMANTIC', 'OPERATIONAL', 'MEMORY', 'OBSIDIAN', 'TIMELINE', 'LIVE', 'SECURITY'];

const nodeTypes: NodeType[] = ['Vault', 'Folder', 'Tag', 'Person', 'Organization', 'Project', 'Task', 'Note', 'Conversation', 'Website', 'File', 'Agent', 'Memory', 'Tool', 'Event', 'Trade', 'Model', 'Provider', 'Decision', 'System', 'Concept', 'Automation', 'SecurityEvent'];

const typeLabels: Record<NodeType, string> = {
  Vault: 'OBSIDIAN VAULT',
  Folder: 'FOLDERS',
  Tag: 'TAGS',
  Person: 'PEOPLE',
  Organization: 'ORGANIZATIONS',
  Project: 'PROJECTS',
  Task: 'TASKS',
  Note: 'NOTES',
  Conversation: 'CONVERSATIONS',
  Website: 'WEBSITES',
  File: 'DOCUMENTS',
  Agent: 'AGENTS',
  Memory: 'MEMORIES',
  Tool: 'TOOLS',
  Event: 'EVENTS',
  Trade: 'TRADING',
  Model: 'MODELS',
  Provider: 'PROVIDERS',
  Decision: 'DECISIONS',
  System: 'SYSTEM',
  Concept: 'CONCEPTS',
  Automation: 'AUTOMATIONS',
  SecurityEvent: 'SECURITY',
};

const glyphFor = (type: NodeType) => {
  switch (type) {
    case 'Vault': return 'V';
    case 'Folder': return 'DIR';
    case 'Tag': return '#';
    case 'Person': return 'P';
    case 'Organization': return 'O';
    case 'Project': return 'W';
    case 'Task': return 'T';
    case 'Conversation': return 'C';
    case 'Website': return 'URL';
    case 'File': return 'F';
    case 'Agent': return 'A';
    case 'Memory': return 'M';
    case 'Tool': return 'X';
    case 'Event': return 'E';
    case 'Trade': return '$';
    case 'Model': return 'AI';
    case 'Provider': return 'P';
    case 'Decision': return 'D';
    case 'System': return 'S';
    case 'Concept': return '*';
    case 'Automation': return 'RUN';
    case 'SecurityEvent': return '!';
    case 'Note':
    default: return 'N';
  }
};

const colorFor = (type: NodeType) => {
  switch (type) {
    case 'Vault': return '#8b5cf6';
    case 'Folder': return '#c4b5fd';
    case 'Tag': return '#a78bfa';
    case 'Person': return '#20c9ff';
    case 'Organization': return '#35e879';
    case 'Project': return '#a855f7';
    case 'Task': return '#f7b733';
    case 'Conversation': return '#2f9bff';
    case 'Website': return '#60a5fa';
    case 'File': return '#2493ff';
    case 'Agent': return '#b368ff';
    case 'Memory': return '#20e0d6';
    case 'Tool': return '#ff4fc3';
    case 'Event': return '#facc15';
    case 'Trade': return '#ff8a3d';
    case 'Model': return '#7dd3fc';
    case 'Provider': return '#5eead4';
    case 'Decision': return '#fb7185';
    case 'System': return '#ffffff';
    case 'Concept': return '#c4b5fd';
    case 'Automation': return '#22d3ee';
    case 'SecurityEvent': return '#fb7185';
    case 'Note':
    default: return '#f05ab2';
  }
};

const formatRelative = (value?: string) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  const seconds = Math.max(1, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};

function computeDegrees(relationships: GraphRelationship[]) {
  const degrees = new Map<string, number>();
  for (const edge of relationships) {
    degrees.set(edge.from, (degrees.get(edge.from) ?? 0) + 1);
    degrees.set(edge.to, (degrees.get(edge.to) ?? 0) + 1);
  }
  return degrees;
}

function positionNodes(nodes: GraphNode[], relationships: GraphRelationship[]): PositionedNode[] {
  if (!nodes.length) return [];
  const degrees = computeDegrees(relationships);
  const ranked = [...nodes].sort((a, b) => {
    const scoreA = (degrees.get(a.id) ?? 0) * 1.8 + a.importance;
    const scoreB = (degrees.get(b.id) ?? 0) * 1.8 + b.importance;
    return scoreB - scoreA;
  });
  const hubId = ranked.find((node) => node.id === 'core:edith')?.id
    ?? ranked.find((node) => node.type === 'Vault')?.id
    ?? ranked[0]?.id;
  const clusterKeys = Array.from(new Set(ranked.filter((node) => node.id !== hubId).map((node) => node.type)));
  const clusterCount = Math.max(clusterKeys.length, 1);
  const clusterCenters = new Map<string, THREE.Vector3>();
  clusterKeys.forEach((key, index) => {
    const angle = -Math.PI / 2 + (Math.PI * 2 * index) / clusterCount;
    const radius = 135 + Math.min(nodes.length, 120) * 1.35;
    clusterCenters.set(key, new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius * 0.62, Math.sin(angle * 1.15) * 46));
  });

  const clusterIndexes = new Map<string, number>();
  const clusterSizes = new Map<string, number>();
  for (const node of ranked) {
    if (node.id === hubId) continue;
    clusterSizes.set(node.type, (clusterSizes.get(node.type) ?? 0) + 1);
  }

  return ranked.map((node) => {
    const degree = degrees.get(node.id) ?? 0;
    const isHub = node.id === hubId;
    if (isHub) {
      return {
        ...node,
        position: new THREE.Vector3(0, 0, 12),
        radius: 18 + Math.min(degree, 12) * 0.8,
        color: colorFor(node.type),
        degree,
        isHub,
      };
    }

    const cluster = node.type;
    const currentIndex = clusterIndexes.get(cluster) ?? 0;
    const size = Math.max(clusterSizes.get(cluster) ?? 1, 1);
    clusterIndexes.set(cluster, currentIndex + 1);
    const center = clusterCenters.get(cluster) ?? new THREE.Vector3(0, 0, 0);
    const angle = (Math.PI * 2 * currentIndex) / size + (size % 2 ? 0.24 : -0.18);
    const ring = 26 + Math.min(size, 12) * 5 + (currentIndex % 3) * 13;
    const jitter = ((currentIndex * 37) % 19) - 9;
    return {
      ...node,
      position: center.clone().add(new THREE.Vector3(
        Math.cos(angle) * ring,
        Math.sin(angle) * ring * 0.72,
        Math.sin(angle * 1.7) * 28 + jitter
      )),
      radius: 8 + Math.min(10, degree) * 0.7 + Math.max(0.2, node.importance) * 4,
      color: colorFor(node.type),
      degree,
      isHub,
    };
  });
}

function createNodeTexture(node: PositionedNode, active: boolean): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d')!;
  const size = 256;
  canvas.width = size;
  canvas.height = size;
  const center = size / 2;
  const gradient = context.createRadialGradient(center, center, 16, center, center, 118);
  gradient.addColorStop(0, active ? '#ffffff' : node.color);
  gradient.addColorStop(0.32, node.color);
  gradient.addColorStop(0.68, `${node.color}66`);
  gradient.addColorStop(1, 'rgba(2, 6, 23, 0)');
  context.fillStyle = gradient;
  context.beginPath();
  context.arc(center, center, 120, 0, Math.PI * 2);
  context.fill();

  context.lineWidth = active ? 10 : 6;
  context.strokeStyle = active ? '#ffffff' : node.color;
  context.shadowColor = node.color;
  context.shadowBlur = active ? 26 : 18;
  context.beginPath();
  context.arc(center, center, 74, 0, Math.PI * 2);
  context.stroke();

  context.shadowBlur = 0;
  context.fillStyle = active ? '#f8fbff' : '#dff8ff';
  context.font = node.type === 'Website' ? '700 36px Inter, Arial, sans-serif' : '800 54px Inter, Arial, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(glyphFor(node.type), center, center + 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createLabelSprite(text: string, color: string, active = false): THREE.Sprite {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d')!;
  const label = text.length > 26 ? `${text.slice(0, 25)}...` : text;
  canvas.width = 512;
  canvas.height = 136;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.font = `${active ? 760 : 650} 34px Inter, Arial, sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.lineJoin = 'round';
  context.strokeStyle = 'rgba(1,6,18,0.96)';
  context.lineWidth = 12;
  context.strokeText(label, canvas.width / 2, 48);
  context.fillStyle = active ? '#ffffff' : color;
  context.fillText(label, canvas.width / 2, 48);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  sprite.scale.set(active ? 72 : 58, active ? 19 : 15, 1);
  return sprite;
}

function makeLine(points: THREE.Vector3[], color: string, opacity: number) {
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity });
  return new THREE.Line(geometry, material);
}

function propertyText(properties: Record<string, unknown>, key: string): string | undefined {
  const value = properties[key];
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(String).join(', ');
  if (value === undefined || value === null) return undefined;
  return String(value);
}

function withinTimeRange(value: string | undefined, range: TimeRange): boolean {
  if (range === 'all') return true;
  if (!value) return false;
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return false;
  const ageMs = Date.now() - time;
  const limit = range === '24h' ? 24 * 60 * 60 * 1000 : range === '7d' ? 7 * 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000;
  return ageMs <= limit;
}

function neighborhoodIds(seedId: string, relationships: GraphRelationship[], depth: number): Set<string> {
  const ids = new Set<string>(seedId ? [seedId] : []);
  let frontier = new Set(ids);
  for (let layer = 0; layer < depth; layer += 1) {
    const next = new Set<string>();
    for (const edge of relationships) {
      if (frontier.has(edge.from) && !ids.has(edge.to)) next.add(edge.to);
      if (frontier.has(edge.to) && !ids.has(edge.from)) next.add(edge.from);
    }
    for (const id of next) ids.add(id);
    frontier = next;
    if (!frontier.size) break;
  }
  return ids;
}

function shortestPathEdges(startId: string, endId: string, relationships: GraphRelationship[]): Set<string> {
  if (!startId || !endId || startId === endId) return new Set();
  const adjacency = new Map<string, Array<{ nodeId: string; edgeId: string }>>();
  for (const edge of relationships) {
    adjacency.set(edge.from, [...(adjacency.get(edge.from) ?? []), { nodeId: edge.to, edgeId: edge.id }]);
    adjacency.set(edge.to, [...(adjacency.get(edge.to) ?? []), { nodeId: edge.from, edgeId: edge.id }]);
  }
  const queue = [startId];
  const visited = new Set([startId]);
  const previous = new Map<string, { nodeId: string; edgeId: string }>();
  while (queue.length) {
    const current = queue.shift()!;
    if (current === endId) break;
    for (const next of adjacency.get(current) ?? []) {
      if (visited.has(next.nodeId)) continue;
      visited.add(next.nodeId);
      previous.set(next.nodeId, { nodeId: current, edgeId: next.edgeId });
      queue.push(next.nodeId);
    }
  }
  if (!previous.has(endId)) return new Set();
  const edgeIds = new Set<string>();
  let cursor = endId;
  while (cursor !== startId) {
    const step = previous.get(cursor);
    if (!step) break;
    edgeIds.add(step.edgeId);
    cursor = step.nodeId;
  }
  return edgeIds;
}

const iconForType = (type: NodeType) => {
  const className = 'w-4 h-4';
  switch (type) {
    case 'Person': return <Users className={className} />;
    case 'Vault': return <Database className={className} />;
    case 'Folder': return <FileText className={className} />;
    case 'Tag': return <Network className={className} />;
    case 'Organization': return <Building2 className={className} />;
    case 'Project': return <Briefcase className={className} />;
    case 'Task': return <CheckSquare className={className} />;
    case 'Conversation': return <MessageCircle className={className} />;
    case 'File': return <FileText className={className} />;
    case 'Agent': return <Bot className={className} />;
    case 'Memory': return <Database className={className} />;
    case 'Event': return <Clock className={className} />;
    case 'Model':
    case 'Provider':
    case 'System':
      return <ShieldCheck className={className} />;
    case 'Decision':
      return <Zap className={className} />;
    case 'Automation':
      return <Activity className={className} />;
    case 'SecurityEvent':
      return <ShieldCheck className={className} />;
    default: return <Network className={className} />;
  }
};

function connectionTone(status?: ObsidianStatus['connectionStatus']): string {
  if (status === 'connected' || status === 'synced') return 'text-emerald-300';
  if (status === 'partial' || status === 'syncing') return 'text-amber-300';
  return 'text-red-300';
}

function connectionLabel(status?: ObsidianStatus['connectionStatus']): string {
  if (!status) return 'UNKNOWN';
  return status.replace(/_/g, ' ').toUpperCase();
}

async function readJsonResponse(response: Response): Promise<Record<string, any>> {
  const text = await response.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as Record<string, any>;
  } catch {
    throw new Error(`Expected JSON from Knowledge API, received ${response.status}.`);
  }
}

export const KnowledgeMapView: React.FC<KnowledgeMapViewProps> = ({ memories, tools, logs }) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const selectableRef = useRef<THREE.Object3D[]>([]);
  const graphSignatureRef = useRef('');
  const cameraStateRef = useRef({
    position: new THREE.Vector3(0, 45, 470),
    target: new THREE.Vector3(0, 0, 0),
  });
  const groupRotationYRef = useRef(0);
  const selectedIdRef = useRef('');
  const autoLayoutRef = useRef(true);
  const renderGraphRef = useRef<() => void>(() => undefined);
  const scheduleGraphRenderRef = useRef<() => void>(() => undefined);
  const renderPendingRef = useRef(false);
  const renderFrameRef = useRef<number | null>(null);
  const renderTimerRef = useRef<number | null>(null);
  const positionedNodesRef = useRef<PositionedNode[]>([]);
  const relationshipsRef = useRef<GraphRelationship[]>([]);
  const nodeByIdRef = useRef(new Map<string, PositionedNode>());
  const clustersRef = useRef<Array<[NodeType, number]>>([]);
  const activeNodeIdsRef = useRef(new Set<string>());
  const highlightedEdgeIdsRef = useRef(new Set<string>());
  const selectedEdgeIdRef = useRef('');
  const [graph, setGraph] = useState<KnowledgeGraphSnapshot | null>(null);
  const [status, setStatus] = useState<ObsidianStatus | null>(null);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string>('');
  const [selectedEdgeId, setSelectedEdgeId] = useState<string>('');
  const [pinnedId, setPinnedId] = useState<string>('');
  const [isolateSelected, setIsolateSelected] = useState(false);
  const [expandedDepth, setExpandedDepth] = useState(1);
  const [collapsedTypes, setCollapsedTypes] = useState<NodeType[]>([]);
  const [timeRange, setTimeRange] = useState<TimeRange>('all');
  const [nodeType, setNodeType] = useState('');
  const [relationshipType, setRelationshipType] = useState('');
  const [folder, setFolder] = useState('');
  const [tag, setTag] = useState('');
  const [source, setSource] = useState('');
  const [graphMode, setGraphMode] = useState<GraphMode>('SEMANTIC');
  const [autoLayout, setAutoLayout] = useState(true);
  const [loading, setLoading] = useState(false);
  const [graphError, setGraphError] = useState('');
  const [activity, setActivity] = useState<KnowledgeActivity | null>(null);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    selectedEdgeIdRef.current = selectedEdgeId;
    scheduleGraphRenderRef.current();
  }, [selectedEdgeId]);

  useEffect(() => {
    autoLayoutRef.current = autoLayout;
  }, [autoLayout]);

  const loadGraph = useCallback(async () => {
    const params = new URLSearchParams();
    if (query) params.set('query', query);
    if (nodeType) params.set('nodeType', nodeType);
    if (relationshipType) params.set('relationshipType', relationshipType);
    if (folder) params.set('folder', folder);
    if (tag) params.set('tag', tag);
    if (source) params.set('source', source);
    if (graphMode === 'SECURITY') params.set('query', query || 'security audit permission denied');
    params.set('limit', '1000');
    const [graphResponse, statusResponse] = await Promise.all([
      fetch(`/api/knowledge/graph?${params.toString()}`),
      fetch('/api/knowledge/status'),
    ]);
    const graphData = await readJsonResponse(graphResponse);
    const statusData = await readJsonResponse(statusResponse);
    if (!graphResponse.ok || !statusResponse.ok) {
      throw new Error(String(graphData.error ?? statusData.error ?? 'Knowledge API unavailable.'));
    }
    if (graphData.success) {
      const signature = JSON.stringify({
        nodes: graphData.graph.nodes.map((node: GraphNode) => [node.id, node.title, node.type, node.path, node.recentActivityAt, node.importance, node.tags]),
        relationships: graphData.graph.relationships.map((edge: GraphRelationship) => [edge.id, edge.from, edge.to, edge.type, edge.strength]),
      });
      if (signature !== graphSignatureRef.current) {
        graphSignatureRef.current = signature;
        setGraph(graphData.graph);
        setSelectedId((current) => current && graphData.graph.nodes.some((node: GraphNode) => node.id === current)
          ? current
          : graphData.graph.nodes[0]?.id ?? '');
      }
    }
    if (statusData.success) setStatus(statusData.status);
    setGraphError('');
  }, [folder, graphMode, nodeType, query, relationshipType, source, tag]);

  const reindex = useCallback(async () => {
    setLoading(true);
    try {
      await fetch('/api/knowledge/sync', { method: 'POST' });
      await loadGraph();
    } catch (error) {
      setGraphError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, [loadGraph]);

  const loadActivity = useCallback(async () => {
    const response = await fetch('/api/knowledge-graph/activity');
    const payload = await readJsonResponse(response);
    if (payload.success) setActivity(payload.activity as KnowledgeActivity);
  }, []);

  useEffect(() => {
    reindex().catch((error) => {
      setGraph(null);
      setGraphError(error instanceof Error ? error.message : String(error));
    });
  }, []);

  useEffect(() => {
    const id = window.setTimeout(() => {
      loadGraph().catch((error) => {
        setGraph(null);
        setGraphError(error instanceof Error ? error.message : String(error));
      });
    }, 220);
    return () => window.clearTimeout(id);
  }, [loadGraph]);

  useEffect(() => {
    const id = window.setInterval(() => {
      loadGraph().catch(() => undefined);
      loadActivity().catch(() => undefined);
    }, 10000);
    return () => window.clearInterval(id);
  }, [loadActivity, loadGraph]);

  useEffect(() => {
    loadActivity().catch(() => undefined);
  }, [loadActivity]);

  const baseNodes = graph?.nodes ?? [];
  const baseRelationships = graph?.relationships ?? [];
  const activeNodeIds = useMemo(() => {
    const ids = new Set<string>();
    for (const event of activity?.auditEvents ?? []) {
      if (event.toolId) ids.add(`tool:${event.toolId}`);
      if (event.action.includes('memory')) ids.add('memory:hub');
      if (event.action.includes('task')) ids.add('core:edith');
    }
    for (const run of activity?.toolRuns ?? []) ids.add(`tool:${run.toolId}`);
    for (const event of activity?.syncEvents ?? []) {
      ids.add('vault:obsidian');
      const folder = event.path.includes('/') ? event.path.split('/').slice(0, -1).join('/') : '';
      if (folder) ids.add(`folder:${folder.toLocaleLowerCase('tr-TR').replace(/[^a-z0-9ğüşıöçİĞÜŞÖÇ]+/gi, '-')}`);
    }
    return ids;
  }, [activity]);
  const visibleGraph = useMemo(() => {
    let nodes = baseNodes
      .filter((node) => withinTimeRange(node.recentActivityAt, timeRange))
      .filter((node) => !collapsedTypes.includes(node.type));
    let relationships = baseRelationships.filter((edge) => withinTimeRange(edge.updatedAt, timeRange));
    if (graphMode === 'OPERATIONAL') {
      const types = new Set<NodeType>(['Agent', 'Tool', 'Task', 'Model', 'Provider', 'Automation', 'Event', 'System', 'SecurityEvent']);
      nodes = nodes.filter((node) => types.has(node.type));
    } else if (graphMode === 'MEMORY') {
      const types = new Set<NodeType>(['Memory', 'Conversation', 'Note', 'Project', 'Task']);
      nodes = nodes.filter((node) => types.has(node.type) || node.source === 'memory');
    } else if (graphMode === 'OBSIDIAN') {
      nodes = nodes.filter((node) => node.source === 'obsidian' || node.type === 'Vault' || node.type === 'Folder' || node.type === 'Tag');
    } else if (graphMode === 'LIVE' && activeNodeIds.size > 0) {
      const liveIds = new Set<string>();
      for (const id of activeNodeIds) for (const nodeId of neighborhoodIds(id, relationships, 1)) liveIds.add(nodeId);
      nodes = nodes.filter((node) => liveIds.has(node.id));
    }
    if (isolateSelected && selectedId) {
      const allowedIds = neighborhoodIds(selectedId, relationships, expandedDepth);
      nodes = nodes.filter((node) => allowedIds.has(node.id));
    }
    const nodeIds = new Set(nodes.map((node) => node.id));
    relationships = relationships.filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to));
    return { nodes, relationships };
  }, [activeNodeIds, baseNodes, baseRelationships, collapsedTypes, expandedDepth, graphMode, isolateSelected, selectedId, timeRange]);
  const positionedNodes = useMemo(() => positionNodes(visibleGraph.nodes, visibleGraph.relationships), [visibleGraph]);
  const nodeById = useMemo(() => new Map(positionedNodes.map((node) => [node.id, node])), [positionedNodes]);
  const relationships = visibleGraph.relationships;
  const selectedNode = nodeById.get(selectedId) ?? positionedNodes[0];
  const selectedRelationships = selectedNode ? relationships.filter((edge) => edge.from === selectedNode.id || edge.to === selectedNode.id) : [];
  const selectedEdge = relationships.find((edge) => edge.id === selectedEdgeId);
  const selectedEdgeSource = selectedEdge ? nodeById.get(selectedEdge.from) : undefined;
  const selectedEdgeTarget = selectedEdge ? nodeById.get(selectedEdge.to) : undefined;
  const inboundRelationships = selectedNode ? relationships.filter((edge) => edge.to === selectedNode.id) : [];
  const outboundRelationships = selectedNode ? relationships.filter((edge) => edge.from === selectedNode.id) : [];
  const folders = Array.from(new Set((graph?.nodes ?? []).map((node) => node.folder).filter(Boolean) as string[])).sort();
  const tags = Array.from(new Set((graph?.nodes ?? []).flatMap((node) => node.tags))).sort();
  const sources = Array.from(new Set(['obsidian', ...Object.keys(graph?.sources ?? {})])).sort();
  const relationshipTypes = Array.from(new Set(baseRelationships.map((edge) => edge.type))).sort();
  const highlightedEdgeIds = useMemo(() => shortestPathEdges(pinnedId, selectedNode?.id ?? '', relationships), [pinnedId, relationships, selectedNode?.id]);
  const clusters = useMemo(() => {
    const counts = new Map<NodeType, number>();
    for (const node of positionedNodes) counts.set(node.type, (counts.get(node.type) ?? 0) + 1);
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [positionedNodes]);

  useEffect(() => {
    positionedNodesRef.current = positionedNodes;
    relationshipsRef.current = relationships;
    nodeByIdRef.current = nodeById;
    clustersRef.current = clusters;
    activeNodeIdsRef.current = activeNodeIds;
    highlightedEdgeIdsRef.current = highlightedEdgeIds;
    scheduleGraphRenderRef.current();
  }, [activeNodeIds, clusters, highlightedEdgeIds, nodeById, positionedNodes, relationships]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#00030b');
    scene.fog = new THREE.FogExp2('#00030b', 0.00115);

    const camera = new THREE.PerspectiveCamera(52, mount.clientWidth / Math.max(mount.clientHeight, 1), 0.1, 2100);
    camera.position.copy(cameraStateRef.current.position);

    const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.075;
    controls.rotateSpeed = 0.46;
    controls.zoomSpeed = 0.68;
    controls.panSpeed = 0.52;
    controls.minDistance = 110;
    controls.maxDistance = 760;
    controls.target.copy(cameraStateRef.current.target);
    controls.update();
    controlsRef.current = controls;

    const ambient = new THREE.AmbientLight('#b7e6ff', 0.42);
    const key = new THREE.DirectionalLight('#ffffff', 1.65);
    key.position.set(160, 220, 180);
    const rim = new THREE.PointLight('#8b5cf6', 3.2, 920);
    rim.position.set(-180, 130, 220);
    const cyanBeacon = new THREE.PointLight('#22d3ee', 2.4, 760);
    cyanBeacon.position.set(230, -90, 180);
    scene.add(ambient, key, rim, cyanBeacon);

    const group = new THREE.Group();
    group.rotation.y = groupRotationYRef.current;
    scene.add(group);

    const environmentGroup = new THREE.Group();
    scene.add(environmentGroup);

    const grid = new THREE.GridHelper(980, 46, '#123a52', '#07172a');
    grid.position.y = -165;
    grid.position.z = -80;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.18;
    environmentGroup.add(grid);

    for (let index = 0; index < 3; index += 1) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(205 + index * 92, 0.42, 8, 160),
        new THREE.MeshBasicMaterial({
          color: index === 1 ? '#7c3aed' : '#06b6d4',
          transparent: true,
          opacity: 0.16 - index * 0.025,
          depthWrite: false,
        })
      );
      ring.rotation.x = Math.PI / 2.1;
      ring.rotation.z = index * 0.22;
      ring.userData.spin = 0.00018 + index * 0.00008;
      environmentGroup.add(ring);
    }

    const cognitionShell = new THREE.Mesh(
      new THREE.IcosahedronGeometry(285, 3),
      new THREE.MeshBasicMaterial({
        color: '#1dd3ff',
        wireframe: true,
        transparent: true,
        opacity: 0.065,
        depthWrite: false,
      })
    );
    cognitionShell.scale.set(1.18, 0.72, 0.92);
    cognitionShell.userData.spin = -0.00016;
    environmentGroup.add(cognitionShell);

    const starGeometry = new THREE.BufferGeometry();
    const stars = new Float32Array(1020);
    for (let i = 0; i < stars.length; i += 3) {
      stars[i] = (Math.random() - 0.5) * 1280;
      stars[i + 1] = (Math.random() - 0.5) * 740;
      stars[i + 2] = (Math.random() - 0.5) * 720 - 160;
    }
    starGeometry.setAttribute('position', new THREE.BufferAttribute(stars, 3));
    const starField = new THREE.Points(
      starGeometry,
      new THREE.PointsMaterial({ color: '#38bdf8', size: 1.45, transparent: true, opacity: 0.34, depthWrite: false })
    );
    scene.add(starField);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const edgeFlowDots: Array<{ dot: THREE.Mesh; curve: THREE.CatmullRomCurve3; offset: number; speed: number }> = [];
    const pulseObjects: THREE.Object3D[] = [];

    let renderGraph = () => undefined;

    const handlePointerDown = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(selectableRef.current, false)[0];
      if (!hit) return;
      const nodeId = String(hit.object.userData.nodeId ?? '');
      const edgeId = String(hit.object.userData.edgeId ?? '');
      if (nodeId) {
        selectedIdRef.current = nodeId;
        selectedEdgeIdRef.current = '';
        setSelectedId(nodeId);
        setSelectedEdgeId('');
        scheduleGraphRenderRef.current();
      } else if (edgeId) {
        selectedEdgeIdRef.current = edgeId;
        setSelectedEdgeId(edgeId);
        scheduleGraphRenderRef.current();
      }
    };
    renderer.domElement.addEventListener('pointerdown', handlePointerDown);

    const disposeObject = (object: THREE.Object3D) => {
      object.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(material)) material.forEach((item) => item.dispose());
        else {
          const withMap = material as THREE.SpriteMaterial & { map?: THREE.Texture };
          withMap?.map?.dispose?.();
          material?.dispose();
        }
      });
    };

    renderGraph = () => {
      renderPendingRef.current = false;
      while (group.children.length) {
        const child = group.children.pop()!;
        disposeObject(child);
      }
      selectableRef.current = [];
      edgeFlowDots.length = 0;
      pulseObjects.length = 0;
      const currentPositionedNodes = positionedNodesRef.current;
      const currentRelationships = relationshipsRef.current;
      const currentNodeById = nodeByIdRef.current;
      const currentClusters = clustersRef.current;
      const currentActiveNodeIds = activeNodeIdsRef.current;
      const currentHighlightedEdgeIds = highlightedEdgeIdsRef.current;
      const activeNode = currentNodeById.get(selectedIdRef.current) ?? currentPositionedNodes[0];
      const coreNode = currentNodeById.get('core:edith') ?? currentPositionedNodes.find((node) => node.isHub);

      if (coreNode) {
        const coreGroup = new THREE.Group();
        coreGroup.position.copy(coreNode.position);
        coreGroup.userData.baseScale = 1;
        const brainShell = new THREE.Mesh(
          new THREE.IcosahedronGeometry(Math.max(76, coreNode.radius * 3.7), 2),
          new THREE.MeshBasicMaterial({ color: '#e0f2fe', wireframe: true, transparent: true, opacity: 0.2, depthWrite: false })
        );
        const inner = new THREE.Mesh(
          new THREE.SphereGeometry(Math.max(42, coreNode.radius * 2.05), 42, 22),
          new THREE.MeshBasicMaterial({ color: '#7dd3fc', transparent: true, opacity: 0.32, depthWrite: false, blending: THREE.AdditiveBlending })
        );
        const aura = new THREE.Mesh(
          new THREE.SphereGeometry(Math.max(98, coreNode.radius * 4.4), 42, 22),
          new THREE.MeshBasicMaterial({ color: '#38bdf8', transparent: true, opacity: 0.105, depthWrite: false, blending: THREE.AdditiveBlending })
        );
        coreGroup.add(aura, brainShell, inner);
        pulseObjects.push(brainShell);
        for (let ringIndex = 0; ringIndex < 5; ringIndex += 1) {
          const ring = new THREE.Mesh(
            new THREE.TorusGeometry(72 + ringIndex * 19, 0.75, 8, 128),
            new THREE.MeshBasicMaterial({ color: ringIndex % 2 ? '#a78bfa' : '#67e8f9', transparent: true, opacity: 0.42 - ringIndex * 0.045, depthWrite: false })
          );
          ring.rotation.x = Math.PI / (2.25 + ringIndex * 0.3);
          ring.rotation.y = ringIndex * 0.65;
          ring.userData.baseScale = 1 + ringIndex * 0.03;
          coreGroup.add(ring);
          pulseObjects.push(ring);
        }
        for (let filament = 0; filament < 42; filament += 1) {
          const angle = (Math.PI * 2 * filament) / 42;
          const start = new THREE.Vector3(Math.cos(angle) * 24, Math.sin(angle * 1.7) * 18, Math.sin(angle) * 24);
          const end = new THREE.Vector3(Math.cos(angle) * 128, Math.sin(angle * 1.7) * 56, Math.sin(angle) * 128);
          coreGroup.add(makeLine([start, start.clone().lerp(end, 0.55).add(new THREE.Vector3(0, 14, 0)), end], filament % 3 === 0 ? '#c4b5fd' : '#67e8f9', 0.28));
        }
        group.add(coreGroup);
        pulseObjects.push(coreGroup);
      }

      for (const [type] of currentClusters) {
        const nodes = currentPositionedNodes.filter((node) => node.type === type && !node.isHub);
        if (!nodes.length) continue;
        const center = nodes.reduce((acc, node) => acc.add(node.position), new THREE.Vector3()).multiplyScalar(1 / nodes.length);
        const ringRadius = Math.max(46, Math.min(138, 30 + nodes.length * 12));
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(ringRadius, 0.62, 8, 72),
          new THREE.MeshBasicMaterial({ color: colorFor(type), transparent: true, opacity: 0.28, depthWrite: false, blending: THREE.AdditiveBlending })
        );
        ring.position.copy(center);
        ring.rotation.x = Math.PI / 2.35;
        ring.userData.baseScale = 1;
        group.add(ring);
        pulseObjects.push(ring);

        const label = createLabelSprite(typeLabels[type], colorFor(type), false);
        label.position.copy(center).add(new THREE.Vector3(0, ringRadius * 0.86 + 24, 10));
        label.scale.set(62, 16, 1);
        group.add(label);
      }

      for (const edge of currentRelationships) {
        const from = currentNodeById.get(edge.from);
        const to = currentNodeById.get(edge.to);
        if (!from || !to) continue;
        const edgeActive = currentActiveNodeIds.has(edge.from) || currentActiveNodeIds.has(edge.to);
        const selectedEdgeActive = edge.id === selectedEdgeIdRef.current;
        const pathActive = currentHighlightedEdgeIds.has(edge.id);
        const focused = Boolean(activeNode && (edge.from === activeNode.id || edge.to === activeNode.id)) || edgeActive || selectedEdgeActive || pathActive;
        const edgeColor = selectedEdgeActive ? '#ffffff' : pathActive ? '#f0abfc' : focused ? '#a5f3fc' : from.color;
        const midpoint = from.position.clone().lerp(to.position, 0.5);
        midpoint.z += 28 + edge.strength * 22;
        midpoint.y += focused ? 20 : 6;
        const curve = new THREE.CatmullRomCurve3([from.position, midpoint, to.position]);
        const points = curve.getPoints(18);
        group.add(makeLine(points, edgeColor, selectedEdgeActive || pathActive ? 0.96 : focused ? 0.78 : 0.22));
        group.add(makeLine(points, focused ? '#ffffff' : to.color, selectedEdgeActive || pathActive ? 0.42 : focused ? 0.25 : 0.07));

        const edgeHit = new THREE.Mesh(
          new THREE.SphereGeometry(focused ? 6 : 4, 8, 6),
          new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0 })
        );
        edgeHit.position.copy(midpoint);
        edgeHit.userData.edgeId = edge.id;
        group.add(edgeHit);
        selectableRef.current.push(edgeHit);

        if (focused || edge.strength > 0.45) {
          const dot = new THREE.Mesh(
            new THREE.SphereGeometry(focused ? 1.9 : 1.25, 8, 6),
            new THREE.MeshBasicMaterial({ color: focused ? '#ffffff' : edgeColor, transparent: true, opacity: focused ? 0.95 : 0.7 })
          );
          group.add(dot);
          edgeFlowDots.push({ dot, curve, offset: Math.random(), speed: 0.0015 + edge.strength * 0.0014 });
        }
      }

      for (const node of currentPositionedNodes) {
        const liveActive = currentActiveNodeIds.has(node.id);
        const active = node.id === activeNode?.id || liveActive;
        const scale = node.radius * (active ? 4.45 : node.isHub ? 4.1 : 3.15);
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
          map: createNodeTexture(node, active),
          transparent: true,
          depthWrite: false,
        }));
        sprite.position.copy(node.position);
        sprite.scale.set(scale, scale, 1);
        sprite.userData.nodeId = node.id;
        group.add(sprite);
        selectableRef.current.push(sprite);

        const hitArea = new THREE.Sprite(new THREE.SpriteMaterial({ color: '#ffffff', transparent: true, opacity: 0 }));
        hitArea.position.copy(node.position);
        hitArea.scale.set(scale * 1.18, scale * 1.18, 1);
        hitArea.userData.nodeId = node.id;
        group.add(hitArea);
        selectableRef.current.push(hitArea);

        const showLabel = active || node.isHub || currentPositionedNodes.length <= 90 || node.degree > 2;
        if (showLabel) {
          const label = createLabelSprite(node.title, active ? '#ffffff' : '#dbeafe', active);
          label.position.copy(node.position).add(new THREE.Vector3(0, scale * 0.58, 4));
          group.add(label);
        }

        if (active || node.isHub) {
          const ring = new THREE.Mesh(
            new THREE.TorusGeometry(node.radius * (active ? 2.05 : 1.55), 0.74, 6, 48),
            new THREE.MeshBasicMaterial({ color: active ? '#ffffff' : node.color, transparent: true, opacity: active ? 0.76 : 0.4, depthWrite: false })
          );
          ring.position.copy(node.position);
          ring.userData.baseScale = active ? 1.08 : 0.96;
          group.add(ring);
          pulseObjects.push(ring);
        }
      }
    };
    renderGraphRef.current = renderGraph;
    scheduleGraphRenderRef.current = () => {
      if (renderPendingRef.current) return;
      renderPendingRef.current = true;
      renderFrameRef.current = window.requestAnimationFrame(() => {
        renderTimerRef.current = window.setTimeout(() => {
          renderGraphRef.current();
          renderTimerRef.current = null;
        }, 0);
        renderFrameRef.current = null;
      });
    };

    scheduleGraphRenderRef.current();

    const handleResize = () => {
      camera.aspect = mount.clientWidth / Math.max(mount.clientHeight, 1);
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    };
    window.addEventListener('resize', handleResize);

    const clock = new THREE.Clock();
    let frame = 0;
    const animate = () => {
      frame = requestAnimationFrame(animate);
      const elapsed = clock.getElapsedTime();
      starField.rotation.z += 0.00024;
      environmentGroup.children.forEach((object) => {
        const spin = Number(object.userData.spin ?? 0);
        object.rotation.z += spin;
        object.rotation.y += spin * 0.45;
      });
      group.rotation.y += autoLayoutRef.current ? 0.00045 : 0;
      groupRotationYRef.current = group.rotation.y;
      pulseObjects.forEach((object, index) => {
        const pulse = 1 + Math.sin(elapsed * 1.6 + index * 0.9) * 0.045;
        const base = Number(object.userData.baseScale ?? 1);
        object.scale.setScalar(base * pulse);
        object.lookAt(camera.position);
      });
      edgeFlowDots.forEach((item) => {
        const t = (elapsed * item.speed * 62 + item.offset) % 1;
        item.dot.position.copy(item.curve.getPointAt(t));
      });
      controls.update();
      cameraStateRef.current.position.copy(camera.position);
      cameraStateRef.current.target.copy(controls.target);
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(frame);
      groupRotationYRef.current = group.rotation.y;
      cameraStateRef.current.position.copy(camera.position);
      cameraStateRef.current.target.copy(controls.target);
      window.removeEventListener('resize', handleResize);
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown);
      renderGraphRef.current = () => undefined;
      scheduleGraphRenderRef.current = () => undefined;
      if (renderFrameRef.current !== null) {
        window.cancelAnimationFrame(renderFrameRef.current);
        renderFrameRef.current = null;
      }
      if (renderTimerRef.current !== null) {
        window.clearTimeout(renderTimerRef.current);
        renderTimerRef.current = null;
      }
      renderPendingRef.current = false;
      controls.dispose();
      disposeObject(group);
      disposeObject(environmentGroup);
      starGeometry.dispose();
      (starField.material as THREE.PointsMaterial).dispose();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, []);

  const resetCamera = () => {
    const controls = controlsRef.current;
    if (!controls) return;
    controls.object.position.set(0, 45, 470);
    controls.target.set(0, 0, 0);
    controls.update();
  };

  const focusSelectedNode = () => {
    const controls = controlsRef.current;
    if (!controls || !selectedNode) return;
    const target = selectedNode.position.clone();
    controls.target.copy(target);
    controls.object.position.copy(target.clone().add(new THREE.Vector3(0, 34, 185)));
    controls.update();
  };

  const clearGraphControls = () => {
    setQuery('');
    setNodeType('');
    setRelationshipType('');
    setFolder('');
    setTag('');
    setSource('');
    setIsolateSelected(false);
    setExpandedDepth(1);
    setCollapsedTypes([]);
    setTimeRange('all');
    setSelectedEdgeId('');
  };

  const toggleCollapsedType = (type: NodeType) => {
    setCollapsedTypes((current) => current.includes(type)
      ? current.filter((item) => item !== type)
      : [...current, type]);
  };

  const selectedWhy = selectedNode
    ? selectedRelationships.slice(0, 3).map((edge) => {
      const peer = nodeById.get(edge.from === selectedNode.id ? edge.to : edge.from);
      const fallback = edge.from === selectedNode.id ? edge.to : edge.from;
      return `${edge.type} ${peer?.title ?? fallback}`;
    })
    : [];

  return (
    <div className="flex-1 overflow-hidden bg-[#020713] text-slate-100">
      <div className="flex h-full min-h-0 gap-3 p-3 bg-[radial-gradient(circle_at_50%_42%,rgba(14,165,233,0.26),transparent_34%),linear-gradient(135deg,#020713,#04131f_48%,#020617)]">
        <aside className="hidden h-full w-64 shrink-0 rounded-2xl border border-cyan-300/18 bg-[#03101c]/86 backdrop-blur-2xl shadow-[0_0_44px_rgba(8,145,178,0.18)] xl:flex xl:flex-col">
          <div className="p-5 border-b border-cyan-300/12">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-full border border-cyan-300/40 bg-cyan-300/10 shadow-[0_0_32px_rgba(34,211,238,0.42)] flex items-center justify-center">
                <span className="h-3 w-3 rounded-full bg-cyan-200 shadow-[0_0_20px_rgba(34,211,238,1)]" />
              </div>
              <div>
                <div className="text-xl font-semibold text-cyan-50">E.D.I.T.H.</div>
                <div className="text-[10px] text-slate-500">PERSONAL AI OS</div>
              </div>
            </div>
          </div>
          <nav className="flex-1 overflow-y-auto p-3 space-y-1 text-sm">
            {[
              ['Command Center', Home],
              ['Knowledge Map', Network],
              ['Agents', Bot],
              ['Tasks', CheckSquare],
              ['Conversations', MessageCircle],
              ['Memory', Database],
              ['Research', Search],
              ['Browser', Network],
              ['Model Router', Zap],
              ['Tools', Briefcase],
              ['Obsidian', FileText],
              ['Automation', Activity],
            ].map(([label, Icon]) => {
              const ActiveIcon = Icon as typeof Network;
              const active = label === 'Knowledge Map';
              return (
                <button key={String(label)} className={`w-full flex items-center gap-3 rounded-xl border px-3 py-3 text-left transition ${active ? 'border-cyan-300/42 bg-cyan-400/14 text-cyan-100 shadow-[0_0_24px_rgba(34,211,238,0.18)]' : 'border-transparent text-slate-400 hover:border-cyan-300/18 hover:bg-cyan-300/5 hover:text-slate-100'}`}>
                  <ActiveIcon className="h-4 w-4" />
                  <span>{String(label)}</span>
                </button>
              );
            })}
          </nav>
          <div className="m-3 rounded-2xl border border-cyan-300/18 bg-black/35 p-4">
            <div className="flex items-center gap-2 text-[11px] text-cyan-100">
              <Zap className="h-3.5 w-3.5" />
              E.D.I.T.H.
            </div>
            <div className="mt-2 h-8 rounded-lg bg-[repeating-linear-gradient(90deg,rgba(34,211,238,0.12)_0_4px,transparent_4px_9px)] shadow-[0_0_24px_rgba(34,211,238,0.15)]" />
            <p className="mt-4 text-[11px] italic leading-relaxed text-slate-400">“A more capable you, for a more meaningful tomorrow.”</p>
          </div>
        </aside>

        <main className="min-w-0 flex-1 grid grid-rows-[64px_minmax(0,1fr)_128px] gap-3">
          <header className="rounded-2xl border border-cyan-300/18 bg-[#041421]/82 backdrop-blur-2xl px-5 flex items-center justify-between shadow-[0_0_42px_rgba(8,145,178,0.15)]">
            <div>
              <h2 className="text-lg font-semibold text-cyan-50">KNOWLEDGE MAP</h2>
              <div className="text-xs text-slate-400">Everything connected. Greater together.</div>
            </div>
            <div className="flex items-center gap-3">
              <div className={`hidden md:flex items-center gap-2 rounded-full border px-4 py-2 text-[11px] font-mono ${status?.connectionStatus === 'synced' || status?.connectionStatus === 'connected' ? 'border-emerald-300/25 bg-emerald-400/8 text-emerald-200' : 'border-amber-300/25 bg-amber-400/8 text-amber-200'}`}>
                <span className="h-2 w-2 rounded-full bg-current shadow-[0_0_12px_currentColor]" />
                {connectionLabel(status?.connectionStatus)}
              </div>
              <div className="relative hidden lg:block w-72">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search anything..." className="w-full rounded-xl border border-cyan-300/14 bg-black/34 py-2.5 pl-9 pr-3 text-xs text-slate-100 outline-none placeholder:text-slate-500 focus:border-cyan-300/45" />
              </div>
              <button onClick={reindex} className="h-10 w-10 rounded-xl border border-cyan-300/14 bg-black/34 text-cyan-100 hover:border-cyan-300/45 flex items-center justify-center" title="Live sync">
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
              <button onClick={resetCamera} className="h-10 w-10 rounded-xl border border-cyan-300/14 bg-black/34 text-slate-200 hover:border-cyan-300/45 flex items-center justify-center" title="Reset camera">
                <Maximize2 className="h-4 w-4" />
              </button>
            </div>
          </header>

          <section className="min-h-0 grid grid-cols-[220px_minmax(0,1fr)_360px] gap-3">
            <aside className="rounded-2xl border border-cyan-300/18 bg-[#041421]/78 backdrop-blur-2xl p-4 shadow-[0_0_42px_rgba(8,145,178,0.14)]">
              <div className="flex items-center gap-2 text-[11px] font-semibold text-cyan-100">
                <Database className="h-4 w-4" />
                KNOWLEDGE LAYERS
              </div>
              <div className="mt-4 space-y-2">
                <LayerButton active={!source && !nodeType} label="All Layers" count={baseNodes.length} onClick={() => { setSource(''); setNodeType(''); }} />
                <LayerButton active={nodeType === 'Memory'} label="Memory" count={baseNodes.filter((node) => node.type === 'Memory').length} onClick={() => setNodeType('Memory')} />
                <LayerButton active={nodeType === 'Agent'} label="Agents" count={baseNodes.filter((node) => node.type === 'Agent').length} onClick={() => setNodeType('Agent')} />
                <LayerButton active={nodeType === 'Task'} label="Tasks" count={baseNodes.filter((node) => node.type === 'Task').length} onClick={() => setNodeType('Task')} />
                <LayerButton active={nodeType === 'Project'} label="Projects" count={baseNodes.filter((node) => node.type === 'Project').length} onClick={() => setNodeType('Project')} />
                <LayerButton active={source === 'obsidian'} label="Knowledge / Research" count={baseNodes.filter((node) => node.source === 'obsidian').length} onClick={() => setSource('obsidian')} />
              </div>
              <div className="mt-5 border-t border-cyan-300/12 pt-4">
                <div className="text-[11px] font-semibold text-slate-300">FILTERS</div>
                <div className="mt-3 space-y-2">
                  <SelectFilter value={nodeType} onChange={setNodeType} options={nodeTypes} placeholder="Node Type" />
                  <SelectFilter value={relationshipType} onChange={setRelationshipType} options={relationshipTypes} placeholder="Relation" />
                  <SelectFilter value={source} onChange={setSource} options={sources} placeholder="Source" labels={{ obsidian: 'Obsidian' }} />
                  <SelectFilter value={timeRange} onChange={(value) => setTimeRange((value || 'all') as TimeRange)} options={['all', '24h', '7d', '30d']} placeholder="Time Range" labels={{ all: 'All', '24h': '24 Hours', '7d': '7 Days', '30d': '30 Days' }} />
                  <SelectFilter value={folder} onChange={setFolder} options={folders} placeholder="Folder" />
                  <SelectFilter value={tag} onChange={setTag} options={tags} placeholder="Tag" />
                </div>
              </div>
            </aside>

            <div className="relative overflow-hidden rounded-2xl border border-cyan-300/18 bg-black/30 shadow-[0_0_60px_rgba(14,165,233,0.16)]">
              <div ref={mountRef} className="absolute inset-0" />
              <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(34,211,238,0.07)_1px,transparent_1px),linear-gradient(0deg,rgba(34,211,238,0.05)_1px,transparent_1px)] bg-[size:78px_78px] opacity-40" />
              <div className="pointer-events-none absolute inset-0 shadow-[inset_0_0_160px_rgba(0,0,0,0.72)]" />

              <div className="absolute left-4 top-4 z-10 flex rounded-xl border border-cyan-300/18 bg-black/42 p-1 backdrop-blur-xl">
                {graphModes.map((mode) => (
                  <button key={mode} onClick={() => setGraphMode(mode)} className={`rounded-lg px-3 py-2 text-[10px] font-mono transition ${graphMode === mode ? 'bg-cyan-300/16 text-cyan-50 shadow-[0_0_18px_rgba(34,211,238,0.22)]' : 'text-slate-500 hover:text-slate-200'}`}>{mode}</button>
                ))}
              </div>
              <div className="absolute right-4 top-4 z-10 flex items-center gap-2">
                <button onClick={() => setAutoLayout((current) => !current)} className={`rounded-xl border px-3 py-2 text-[11px] ${autoLayout ? 'border-emerald-300/25 bg-emerald-400/10 text-emerald-100' : 'border-cyan-300/14 bg-black/42 text-slate-400'}`}>Live Sync</button>
                <button onClick={focusSelectedNode} disabled={!selectedNode} className="rounded-xl border border-cyan-300/14 bg-black/42 px-3 py-2 text-[11px] text-slate-200 disabled:opacity-40">Focus</button>
                <button onClick={() => selectedNode && setPinnedId(selectedNode.id)} disabled={!selectedNode} className="rounded-xl border border-cyan-300/14 bg-black/42 px-3 py-2 text-[11px] text-slate-200 disabled:opacity-40">Pin</button>
              </div>

              {(graphError || status?.connectionStatus === 'configuration_required' || status?.connectionStatus === 'read_failed' || status?.connectionStatus === 'write_failed' || status?.connectionStatus === 'disabled') && (
                <div className="absolute left-4 right-4 top-20 z-20 rounded-xl border border-red-300/20 bg-black/82 p-4 shadow-[0_0_44px_rgba(248,113,113,0.14)] backdrop-blur-xl">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="mt-0.5 h-5 w-5 text-red-200" />
                    <div>
                      <div className="text-sm font-semibold text-slate-100">{status?.connectionStatus === 'configuration_required' ? 'Obsidian Vault Not Connected' : 'Knowledge Graph Needs Attention'}</div>
                      <p className="mt-1 text-xs leading-relaxed text-slate-400">{graphError || status?.lastError || 'E.D.I.T.H. could not fully read or sync the configured Obsidian vault.'}</p>
                    </div>
                  </div>
                </div>
              )}

              {positionedNodes.length === 0 && (
                <div className="absolute inset-0 z-10 flex items-center justify-center p-6 pointer-events-none">
                  <div className="max-w-md rounded-2xl border border-cyan-300/18 bg-black/80 p-5 text-center shadow-xl">
                    <Network className="w-9 h-9 text-cyan-200 mx-auto" />
                    <h3 className="mt-3 text-sm font-semibold text-slate-100">Graph is empty</h3>
                    <p className="mt-2 text-xs leading-relaxed text-slate-400">No demo nodes are shown. Add Markdown, Canvas, memories, tasks, or Obsidian links and the map will sync from real EDITH data.</p>
                  </div>
                </div>
              )}

              <div className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-2xl border border-cyan-300/18 bg-black/48 px-5 py-3 backdrop-blur-xl text-[11px] text-slate-300 shadow-[0_0_36px_rgba(34,211,238,0.12)]">
                <span className="text-emerald-300">●</span> {clusters.length} domains <span className="mx-2 text-slate-600">•</span> {positionedNodes.length} total nodes <span className="mx-2 text-slate-600">•</span> {activity?.realtime ?? 'polling'} synchronization
              </div>
            </div>

            <aside className="rounded-2xl border border-cyan-300/18 bg-[#041421]/82 backdrop-blur-2xl shadow-[0_0_42px_rgba(8,145,178,0.14)] overflow-y-auto custom-scrollbar">
              <div className="flex items-center justify-between border-b border-cyan-300/12 px-4 py-4">
                <div className="text-[11px] font-semibold text-cyan-100">NODE DETAILS</div>
                <button onClick={() => selectedNode && setPinnedId(selectedNode.id)} className="rounded-lg border border-cyan-300/15 bg-black/30 px-3 py-1.5 text-[11px] text-slate-300">Pin</button>
              </div>

              {selectedNode ? (
                <section className="p-4 border-b border-cyan-300/12">
                  <div className="flex items-start gap-3">
                    <div className="h-16 w-16 rounded-full border flex items-center justify-center text-lg font-black shadow-[0_0_34px_rgba(125,211,252,0.32)]" style={{ color: selectedNode.color, borderColor: selectedNode.color, backgroundColor: `${selectedNode.color}22` }}>{glyphFor(selectedNode.type)}</div>
                    <div className="min-w-0">
                      <div className="text-lg font-semibold text-slate-50 break-words">{selectedNode.title}</div>
                      <div className="mt-1 text-xs text-slate-400">{selectedNode.type} · {selectedNode.source}</div>
                      <div className={`mt-2 inline-flex rounded-full border px-2 py-1 text-[10px] ${activeNodeIds.has(selectedNode.id) ? 'border-emerald-300/25 bg-emerald-400/10 text-emerald-200' : 'border-cyan-300/14 bg-cyan-300/5 text-cyan-100'}`}>{activeNodeIds.has(selectedNode.id) ? 'ACTIVE' : 'ONLINE'}</div>
                    </div>
                  </div>

                  {(selectedNode.summary || typeof selectedNode.properties?.summary === 'string') && (
                    <div className="mt-4 rounded-xl border border-cyan-300/12 bg-black/28 p-3 text-xs leading-relaxed text-slate-300">{selectedNode.summary ?? String(selectedNode.properties.summary)}</div>
                  )}

                  <div className="mt-4 grid grid-cols-4 rounded-xl border border-cyan-300/12 bg-black/28 text-center text-xs">
                    <MiniMetric label="Notes" value={status?.indexedNotes ?? 0} />
                    <MiniMetric label="Recent" value={status?.recentEvents?.length ?? 0} />
                    <MiniMetric label="Linked" value={selectedRelationships.length} />
                    <MiniMetric label="Backlinks" value={selectedNode.backlinks?.length ?? inboundRelationships.length} />
                  </div>

                  <div className="mt-4 rounded-xl border border-emerald-300/16 bg-emerald-400/7 p-3">
                    <div className="flex items-center gap-2 text-xs font-semibold text-emerald-100"><span className="h-3 w-3 rounded-full bg-emerald-300 shadow-[0_0_14px_rgba(52,211,153,1)]" /> Vault Connected</div>
                    <div className="mt-3 grid grid-cols-[84px_1fr] gap-y-2 text-[11px]">
                      <span className="text-slate-500">Path</span><span className="truncate text-right text-slate-300">{selectedNode.path ?? status?.settings.vaultPath ?? '-'}</span>
                      <span className="text-slate-500">Folder</span><span className="text-right text-slate-300">{selectedNode.folder || '-'}</span>
                      <span className="text-slate-500">Last Sync</span><span className="text-right text-slate-300">{formatRelative(status?.lastSyncAt)}</span>
                      <span className="text-slate-500">Status</span><span className={connectionTone(status?.connectionStatus) + ' text-right'}>{connectionLabel(status?.connectionStatus)}</span>
                    </div>
                  </div>

                  {selectedNode.properties?.edith_secret_redacted === true && (
                    <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-300/20 bg-amber-300/10 p-3 text-[11px] leading-relaxed text-amber-100">
                      <LockKeyhole className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      Secret-like content was redacted before this node entered the graph.
                    </div>
                  )}

                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <button disabled={!selectedNode.path} onClick={() => selectedNode.path && navigator.clipboard?.writeText(`${status?.settings.vaultPath ?? 'D:\\EDİTH\\EDİTH'}\\${selectedNode.path.replace(/\//g, '\\')}`)} className="flex items-center justify-center gap-2 rounded-xl border border-cyan-300/12 bg-black/28 px-3 py-2 text-[11px] text-slate-200 disabled:opacity-40"><Copy className="h-3.5 w-3.5" /> Copy Path</button>
                    <button onClick={reindex} className="flex items-center justify-center gap-2 rounded-xl border border-cyan-300/22 bg-cyan-300/10 px-3 py-2 text-[11px] text-cyan-100"><RefreshCw className="h-3.5 w-3.5" /> Refresh</button>
                    <button onClick={() => setIsolateSelected((current) => !current)} className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-[11px] ${isolateSelected ? 'border-cyan-300/45 bg-cyan-300/14 text-cyan-100' : 'border-cyan-300/12 bg-black/28 text-slate-200'}`}><Network className="h-3.5 w-3.5" /> Isolate</button>
                    <button onClick={() => setPinnedId((current) => current === selectedNode.id ? '' : selectedNode.id)} className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-[11px] ${pinnedId === selectedNode.id ? 'border-violet-300/45 bg-violet-300/14 text-violet-100' : 'border-cyan-300/12 bg-black/28 text-slate-200'}`}><LockKeyhole className="h-3.5 w-3.5" /> {pinnedId === selectedNode.id ? 'Pinned' : 'Pin'}</button>
                  </div>
                </section>
              ) : (
                <section className="p-4 border-b border-cyan-300/12 text-xs text-slate-500">Node seçilmedi.</section>
              )}

        {selectedEdge && (
          <section className="p-4 border-b border-sky-300/10">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
              <span>EDGE PROVENANCE</span>
              <button onClick={() => setSelectedEdgeId('')} className="text-[11px] text-slate-500 hover:text-slate-200">Clear</button>
            </div>
            <div className="mt-3 rounded-lg border border-cyan-300/15 bg-cyan-300/5 p-3">
              <div className="text-[11px] text-cyan-100">{selectedEdgeSource?.title ?? selectedEdge.from}</div>
              <div className="my-2 text-[10px] font-mono text-cyan-300">{selectedEdge.type}</div>
              <div className="text-[11px] text-cyan-100">{selectedEdgeTarget?.title ?? selectedEdge.to}</div>
            </div>
            <div className="mt-3 grid grid-cols-[86px_1fr] gap-y-2 text-[11px]">
              <span className="text-slate-500">Source</span>
              <span className="text-right text-slate-300">{selectedEdge.source}</span>
              <span className="text-slate-500">Strength</span>
              <span className="text-right text-slate-300">{selectedEdge.strength.toFixed(2)}</span>
              <span className="text-slate-500">Updated</span>
              <span className="text-right text-slate-300">{formatRelative(selectedEdge.updatedAt)}</span>
            </div>
            <div className="mt-3 rounded-lg border border-sky-300/10 bg-slate-950/45 p-3 text-[11px] leading-relaxed text-slate-300">
              {selectedEdge.evidence || 'No evidence text was recorded for this relationship.'}
            </div>
          </section>
        )}

        <section className="p-4 border-b border-sky-300/10">
          <div className="text-xs font-semibold text-slate-300">CONNECTED NODES</div>
          <div className="mt-3 space-y-2">
            {selectedNode && selectedRelationships.slice(0, 10).map((edge) => {
              const peer = nodeById.get(edge.from === selectedNode.id ? edge.to : edge.from);
              return (
                <button key={edge.id} onClick={() => {
                  if (peer) setSelectedId(peer.id);
                  setSelectedEdgeId(edge.id);
                }} className={`w-full flex items-center justify-between gap-3 px-3 py-2 rounded-lg border transition-colors ${selectedEdgeId === edge.id ? 'border-cyan-300/45 bg-cyan-300/10' : 'bg-slate-950/45 border-sky-300/10 hover:border-cyan-400/40'}`}>
                  <span className="min-w-0 flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full flex items-center justify-center text-[9px]" style={{ backgroundColor: `${colorFor(peer?.type ?? 'Note')}22`, color: colorFor(peer?.type ?? 'Note') }}>
                      {peer ? glyphFor(peer.type) : '?'}
                    </span>
                    <span className="truncate text-xs text-slate-300">{peer?.title ?? edge.to}</span>
                  </span>
                  <span className="text-[10px] text-slate-500 font-mono shrink-0">{edge.type}</span>
                </button>
              );
            })}
            {(!selectedNode || selectedRelationships.length === 0) && <div className="text-[11px] text-slate-600">Bu notta henüz wikilink/canvas bağlantısı yok.</div>}
          </div>
        </section>

        <section className="p-4 border-b border-sky-300/10">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
            <span>CLUSTERS</span>
            <button onClick={clearGraphControls} className="text-[11px] font-normal text-slate-500 hover:text-slate-200">Reset</button>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {clusters.slice(0, 8).map(([type, count]) => (
              <button key={type} onClick={() => toggleCollapsedType(type)} onDoubleClick={() => setNodeType(type)} className={`rounded-lg border p-3 text-left hover:border-cyan-400/35 ${collapsedTypes.includes(type) ? 'border-red-300/20 bg-red-950/20 opacity-50' : 'border-sky-300/10 bg-slate-950/45'}`}>
                <div className="flex items-center justify-between">
                  <span style={{ color: colorFor(type) }}>{iconForType(type)}</span>
                  <span className="text-sm font-semibold text-slate-100">{count}</span>
                </div>
                <div className="mt-2 text-[10px] text-slate-500">{typeLabels[type]}</div>
              </button>
            ))}
            {clusters.length === 0 && <div className="col-span-2 text-[11px] text-slate-600">Cluster yok.</div>}
          </div>
        </section>

        <section className="p-4 border-b border-sky-300/10">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
            <span className="flex items-center gap-2"><Activity className="w-4 h-4 text-cyan-200" /> ACTIVITY</span>
            <span className={status?.watcherActive ? 'text-emerald-300' : 'text-amber-300'}>{activity?.realtime ?? 'polling'}</span>
          </div>
          <div className="mt-3 space-y-2">
            {(activity?.auditEvents ?? []).slice(0, 4).map((event) => (
              <div key={event.id} className="rounded-lg border border-sky-300/10 bg-slate-950/45 p-2 text-[11px]">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-slate-300">{event.action}</span>
                  <span className={event.result === 'success' ? 'text-emerald-300' : event.result === 'denied' ? 'text-red-300' : 'text-amber-300'}>{event.result}</span>
                </div>
                <div className="mt-1 truncate font-mono text-[10px] text-slate-500">{event.toolId}</div>
              </div>
            ))}
            {(activity?.toolRuns ?? []).slice(0, 3).map((run) => (
              <div key={run.id} className="flex items-center justify-between gap-3 text-[11px]">
                <span className="truncate text-cyan-100/80">Tool: {run.toolName}</span>
                <span className={run.status === 'success' ? 'text-emerald-300' : 'text-amber-300'}>{run.status}</span>
              </div>
            ))}
            {(status?.recentEvents ?? []).slice(0, 6).map((event) => (
              <div key={event.id} className="flex items-center justify-between gap-3 text-[11px]">
                <span className="truncate text-slate-400">{event.action}: {event.path}</span>
                <span className={event.status === 'success' ? 'text-emerald-300' : event.status === 'ignored' ? 'text-slate-500' : 'text-amber-300'}>{event.status}</span>
              </div>
            ))}
            {!status?.recentEvents?.length && <div className="text-[11px] text-slate-600">Henüz sync olayı yok.</div>}
          </div>
        </section>

        <section className="p-4">
          <button className="w-full px-3 py-3 rounded-xl border border-sky-300/10 bg-slate-950/70 text-xs text-slate-300 flex items-center justify-center gap-2">
            <Home className="w-4 h-4" />
            {status?.settings.vaultPath ?? 'D:\\EDİTH\\EDİTH'}
          </button>
          <p className="mt-3 text-[11px] leading-relaxed text-slate-600">
            Ekran varsayılan olarak sadece Obsidian vault verisini gösterir. EDITH runtime node'ları için kaynak filtresini tüm kaynaklara alabilirsin.
          </p>
          <p className="mt-2 text-[11px] text-slate-700">
            Runtime: {memories.length} memory, {tools.length} tool, {logs.length} log.
          </p>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <button onClick={() => setExpandedDepth(1)} className={`rounded-lg border px-2 py-2 text-[10px] ${expandedDepth === 1 ? 'border-cyan-300/40 text-cyan-100' : 'border-sky-300/10 text-slate-500'}`}>1-hop</button>
            <button onClick={() => setExpandedDepth(2)} className={`rounded-lg border px-2 py-2 text-[10px] ${expandedDepth === 2 ? 'border-cyan-300/40 text-cyan-100' : 'border-sky-300/10 text-slate-500'}`}>2-hop</button>
            <button onClick={() => setExpandedDepth(3)} className={`rounded-lg border px-2 py-2 text-[10px] ${expandedDepth === 3 ? 'border-cyan-300/40 text-cyan-100' : 'border-sky-300/10 text-slate-500'}`}>3-hop</button>
          </div>
        </section>
            </aside>
          </section>

          <section className="hidden min-h-0 grid-cols-[1.1fr_1fr_0.9fr] gap-3 lg:grid">
            <div className="rounded-2xl border border-cyan-300/18 bg-[#041421]/82 p-4 backdrop-blur-2xl shadow-[0_0_32px_rgba(8,145,178,0.1)]">
              <div className="flex items-center justify-between text-[11px] text-cyan-100">
                <span>SYSTEM ACTIVITY</span>
                <span className="text-emerald-300">Live</span>
              </div>
              <div className="mt-3 grid grid-cols-[130px_1fr] gap-3">
                <div className="h-14 rounded-xl border border-cyan-300/12 bg-[repeating-linear-gradient(90deg,rgba(34,211,238,0.12)_0_3px,transparent_3px_8px)] shadow-[0_0_22px_rgba(34,211,238,0.12)]" />
                <div className="space-y-1.5 text-[10px] text-slate-400">
                  {(activity?.syncEvents ?? status?.recentEvents ?? []).slice(0, 4).map((event) => (
                    <div key={event.id} className="flex justify-between gap-3">
                      <span className="truncate">{event.action} · {event.path}</span>
                      <span className={event.status === 'success' ? 'text-emerald-300' : 'text-amber-300'}>{event.status}</span>
                    </div>
                  ))}
                  {!(activity?.syncEvents ?? status?.recentEvents ?? []).length && <div>No recent sync events.</div>}
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-cyan-300/18 bg-[#041421]/82 p-4 backdrop-blur-2xl shadow-[0_0_32px_rgba(8,145,178,0.1)]">
              <div className="text-[11px] text-cyan-100">KNOWLEDGE FLOW</div>
              <div className="mt-3 h-16 rounded-xl border border-cyan-300/12 bg-[radial-gradient(circle_at_18%_44%,rgba(34,211,238,0.25),transparent_18%),radial-gradient(circle_at_58%_58%,rgba(139,92,246,0.25),transparent_20%),linear-gradient(90deg,rgba(14,165,233,0.08),rgba(168,85,247,0.08))]" />
              <div className="mt-2 grid grid-cols-3 gap-2 text-[10px] text-slate-400">
                <span><b className="text-cyan-100">{status?.chunks ?? 0}</b> chunks</span>
                <span><b className="text-cyan-100">{relationships.length}</b> links</span>
                <span><b className="text-cyan-100">{highlightedEdgeIds.size}</b> traced</span>
              </div>
            </div>

            <div className="rounded-2xl border border-cyan-300/18 bg-[#041421]/82 p-4 backdrop-blur-2xl shadow-[0_0_32px_rgba(8,145,178,0.1)]">
              <div className="text-[11px] text-cyan-100">TOP CONNECTED NODES</div>
              <div className="mt-3 space-y-1.5 text-[10px]">
                {[...positionedNodes].sort((a, b) => b.degree - a.degree).slice(0, 5).map((node, index) => (
                  <button key={node.id} onClick={() => setSelectedId(node.id)} className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-cyan-300/7">
                    <span className="truncate text-slate-300">{index + 1}. {node.title}</span>
                    <span className="text-cyan-200">{node.degree} links</span>
                  </button>
                ))}
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
};

const FilterInput: React.FC<{ value: string; onChange: (value: string) => void; placeholder: string }> = ({ value, onChange, placeholder }) => (
  <div className="relative">
    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
    <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="w-full pl-9 pr-3 py-2 rounded-lg bg-slate-900/90 border border-sky-300/10 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-400/55" />
  </div>
);

const SelectFilter: React.FC<{ value: string; onChange: (value: string) => void; options: string[]; placeholder: string; labels?: Record<string, string> }> = ({ value, onChange, options, placeholder, labels = {} }) => (
  <select value={value} onChange={(event) => onChange(event.target.value)} className="w-full px-3 py-2 rounded-lg bg-slate-900/90 border border-sky-300/10 text-xs text-slate-100 focus:outline-none focus:border-cyan-400/55">
    <option value="">{placeholder}</option>
    {options.map((option) => <option key={option} value={option}>{labels[option] ?? option}</option>)}
  </select>
);

const LayerButton: React.FC<{ active: boolean; label: string; count: number; onClick: () => void }> = ({ active, label, count, onClick }) => (
  <button onClick={onClick} className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-xs transition ${active ? 'border-cyan-300/35 bg-cyan-300/12 text-cyan-50' : 'border-cyan-300/10 bg-black/18 text-slate-400 hover:border-cyan-300/25 hover:text-slate-100'}`}>
    <span className="flex min-w-0 items-center gap-2">
      <span className={`h-3 w-3 rounded ${active ? 'bg-cyan-300 shadow-[0_0_12px_rgba(34,211,238,0.85)]' : 'bg-slate-700'}`} />
      <span className="truncate">{label}</span>
    </span>
    <span className="text-slate-500">{count}</span>
  </button>
);

const MiniMetric: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <div className="border-r border-cyan-300/10 px-2 py-3 last:border-r-0">
    <div className="text-sm font-semibold text-slate-100">{value}</div>
    <div className="mt-0.5 text-[10px] text-slate-500">{label}</div>
  </div>
);

const MiniStat: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <div className="rounded-lg border border-sky-300/10 bg-slate-950/50 px-3 py-2">
    <div className="text-base font-semibold text-slate-100">{value}</div>
    <div className="text-[10px] text-slate-500">{label}</div>
  </div>
);

const StatusChip: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="max-w-[18rem] rounded-lg border border-sky-300/10 bg-slate-950/55 px-3 py-2">
    <div className="text-[9px] uppercase text-slate-500">{label}</div>
    <div className="truncate text-[11px] text-slate-200">{value}</div>
  </div>
);
