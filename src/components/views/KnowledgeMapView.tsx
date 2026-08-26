import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  Activity,
  Bot,
  Briefcase,
  Building2,
  CheckSquare,
  Clock,
  Database,
  FileText,
  Focus,
  Home,
  Maximize2,
  MessageCircle,
  Network,
  RefreshCw,
  Search,
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
  | 'Trade';

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
  recentEvents: Array<{ id: string; action: string; path: string; status: string; createdAt: string }>;
}

type PositionedNode = GraphNode & {
  position: THREE.Vector3;
  radius: number;
  color: string;
  degree: number;
  isHub: boolean;
};

const nodeTypes: NodeType[] = ['Person', 'Organization', 'Project', 'Task', 'Note', 'Conversation', 'Website', 'File', 'Agent', 'Memory', 'Tool', 'Event', 'Trade'];

const typeLabels: Record<NodeType, string> = {
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
};

const glyphFor = (type: NodeType) => {
  switch (type) {
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
    case 'Note':
    default: return 'N';
  }
};

const colorFor = (type: NodeType) => {
  switch (type) {
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
  const hubId = ranked[0]?.id;
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

const iconForType = (type: NodeType) => {
  const className = 'w-4 h-4';
  switch (type) {
    case 'Person': return <Users className={className} />;
    case 'Organization': return <Building2 className={className} />;
    case 'Project': return <Briefcase className={className} />;
    case 'Task': return <CheckSquare className={className} />;
    case 'Conversation': return <MessageCircle className={className} />;
    case 'File': return <FileText className={className} />;
    case 'Agent': return <Bot className={className} />;
    case 'Memory': return <Database className={className} />;
    case 'Event': return <Clock className={className} />;
    default: return <Network className={className} />;
  }
};

export const KnowledgeMapView: React.FC<KnowledgeMapViewProps> = ({ memories, tools, logs }) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const selectableRef = useRef<THREE.Sprite[]>([]);
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
  const [graph, setGraph] = useState<KnowledgeGraphSnapshot | null>(null);
  const [status, setStatus] = useState<ObsidianStatus | null>(null);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string>('');
  const [nodeType, setNodeType] = useState('');
  const [relationshipType, setRelationshipType] = useState('');
  const [folder, setFolder] = useState('');
  const [tag, setTag] = useState('');
  const [source, setSource] = useState('obsidian');
  const [autoLayout, setAutoLayout] = useState(true);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

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
    params.set('limit', '1000');
    const [graphResponse, statusResponse] = await Promise.all([
      fetch(`/api/edith/knowledge/graph?${params.toString()}`),
      fetch('/api/edith/obsidian/status'),
    ]);
    const graphData = await graphResponse.json();
    const statusData = await statusResponse.json();
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
  }, [folder, nodeType, query, relationshipType, source, tag]);

  const reindex = useCallback(async () => {
    setLoading(true);
    try {
      await fetch('/api/edith/obsidian/sync-now', { method: 'POST' });
      await loadGraph();
    } finally {
      setLoading(false);
    }
  }, [loadGraph]);

  useEffect(() => {
    reindex().catch(() => setGraph(null));
  }, []);

  useEffect(() => {
    const id = window.setTimeout(() => {
      loadGraph().catch(() => setGraph(null));
    }, 220);
    return () => window.clearTimeout(id);
  }, [loadGraph]);

  useEffect(() => {
    const id = window.setInterval(() => {
      loadGraph().catch(() => undefined);
    }, 10000);
    return () => window.clearInterval(id);
  }, [loadGraph]);

  const positionedNodes = useMemo(() => positionNodes(graph?.nodes ?? [], graph?.relationships ?? []), [graph]);
  const nodeById = useMemo(() => new Map(positionedNodes.map((node) => [node.id, node])), [positionedNodes]);
  const relationships = graph?.relationships ?? [];
  const selectedNode = nodeById.get(selectedId) ?? positionedNodes[0];
  const selectedRelationships = selectedNode ? relationships.filter((edge) => edge.from === selectedNode.id || edge.to === selectedNode.id) : [];
  const folders = Array.from(new Set((graph?.nodes ?? []).map((node) => node.folder).filter(Boolean) as string[])).sort();
  const tags = Array.from(new Set((graph?.nodes ?? []).flatMap((node) => node.tags))).sort();
  const sources = Array.from(new Set(['obsidian', ...Object.keys(graph?.sources ?? {})])).sort();
  const relationshipTypes = Array.from(new Set(relationships.map((edge) => edge.type))).sort();
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
    scheduleGraphRenderRef.current();
  }, [clusters, nodeById, positionedNodes, relationships]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#020817');
    scene.fog = new THREE.Fog('#020817', 440, 1180);

    const camera = new THREE.PerspectiveCamera(47, mount.clientWidth / Math.max(mount.clientHeight, 1), 0.1, 1900);
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

    const ambient = new THREE.AmbientLight('#b7e6ff', 0.55);
    const key = new THREE.DirectionalLight('#ffffff', 1.35);
    key.position.set(160, 220, 180);
    const rim = new THREE.PointLight('#8b5cf6', 2.2, 820);
    rim.position.set(-180, 130, 220);
    scene.add(ambient, key, rim);

    const group = new THREE.Group();
    group.rotation.y = groupRotationYRef.current;
    scene.add(group);

    const starGeometry = new THREE.BufferGeometry();
    const stars = new Float32Array(420);
    for (let i = 0; i < stars.length; i += 3) {
      stars[i] = (Math.random() - 0.5) * 980;
      stars[i + 1] = (Math.random() - 0.5) * 560;
      stars[i + 2] = (Math.random() - 0.5) * 460 - 120;
    }
    starGeometry.setAttribute('position', new THREE.BufferAttribute(stars, 3));
    const starField = new THREE.Points(
      starGeometry,
      new THREE.PointsMaterial({ color: '#38bdf8', size: 1.25, transparent: true, opacity: 0.26, depthWrite: false })
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
      const id = String(hit.object.userData.nodeId ?? '');
      if (id) {
        selectedIdRef.current = id;
        setSelectedId(id);
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
      const activeNode = currentNodeById.get(selectedIdRef.current) ?? currentPositionedNodes[0];

      for (const [type] of currentClusters) {
        const nodes = currentPositionedNodes.filter((node) => node.type === type && !node.isHub);
        if (!nodes.length) continue;
        const center = nodes.reduce((acc, node) => acc.add(node.position), new THREE.Vector3()).multiplyScalar(1 / nodes.length);
        const ringRadius = Math.max(34, Math.min(108, 24 + nodes.length * 10));
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(ringRadius, 0.36, 6, 48),
          new THREE.MeshBasicMaterial({ color: colorFor(type), transparent: true, opacity: 0.2, depthWrite: false })
        );
        ring.position.copy(center);
        ring.rotation.x = Math.PI / 2.35;
        ring.userData.baseScale = 1;
        group.add(ring);
        pulseObjects.push(ring);

        const label = createLabelSprite(typeLabels[type], colorFor(type), false);
        label.position.copy(center).add(new THREE.Vector3(0, ringRadius * 0.86 + 24, 10));
        label.scale.set(46, 12, 1);
        group.add(label);
      }

      for (const edge of currentRelationships) {
        const from = currentNodeById.get(edge.from);
        const to = currentNodeById.get(edge.to);
        if (!from || !to) continue;
        const focused = activeNode && (edge.from === activeNode.id || edge.to === activeNode.id);
        const edgeColor = focused ? '#a5f3fc' : from.color;
        const midpoint = from.position.clone().lerp(to.position, 0.5);
        midpoint.z += 28 + edge.strength * 22;
        midpoint.y += focused ? 20 : 6;
        const curve = new THREE.CatmullRomCurve3([from.position, midpoint, to.position]);
        const points = curve.getPoints(18);
        group.add(makeLine(points, edgeColor, focused ? 0.78 : 0.24));
        group.add(makeLine(points, focused ? '#ffffff' : to.color, focused ? 0.25 : 0.08));

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
        const active = node.id === activeNode?.id;
        const scale = node.radius * (active ? 3.55 : node.isHub ? 3.25 : 2.75);
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

  return (
    <div className="flex-1 bg-[#020817] overflow-hidden flex text-slate-100">
      <section className="flex-1 min-w-0 flex flex-col relative">
        <div className="px-5 py-3 border-b border-sky-500/10 bg-[#06101f]/90 backdrop-blur-xl flex items-center justify-between gap-4 shadow-[0_10px_40px_rgba(0,0,0,0.28)]">
          <div className="min-w-0 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl border border-violet-400/35 bg-violet-500/15 flex items-center justify-center shadow-[0_0_26px_rgba(139,92,246,0.28)]">
              <Network className="w-5 h-5 text-violet-100" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-semibold">Knowledge Map</h2>
              <div className="mt-1 flex items-center gap-2 text-[11px] font-mono text-slate-500">
                <span>Real-time knowledge graph powered by Obsidian</span>
                <span className="w-1 h-1 rounded-full bg-slate-700" />
                <span className={status?.watcherActive ? 'text-emerald-300' : 'text-amber-300'}>
                  {status?.watcherActive ? 'Live' : 'Watcher idle'}
                </span>
              </div>
            </div>
          </div>

          <div className="hidden lg:flex items-center gap-2 min-w-0">
            <div className="relative w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Ara..." className="w-full pl-9 pr-10 py-2 rounded-xl bg-slate-950/70 border border-sky-300/10 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-sky-400/55" />
            </div>
            <button onClick={reindex} className="w-10 h-10 rounded-xl border border-sky-300/10 bg-slate-950/65 text-slate-200 hover:border-cyan-400/45 flex items-center justify-center" title="Sync now">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button onClick={resetCamera} className="w-10 h-10 rounded-xl border border-sky-300/10 bg-slate-950/65 text-slate-200 hover:border-cyan-400/45 flex items-center justify-center" title="Reset camera">
              <Maximize2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 relative">
          <div ref={mountRef} className="absolute inset-0" />

          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(88,28,135,0.22),transparent_34%),radial-gradient(circle_at_18%_22%,rgba(14,165,233,0.13),transparent_24%),radial-gradient(circle_at_80%_76%,rgba(16,185,129,0.1),transparent_25%)]" />
          <div className="absolute left-5 top-5 max-w-xs rounded-xl border border-sky-300/10 bg-slate-950/58 backdrop-blur-xl p-4 shadow-[0_0_32px_rgba(15,23,42,0.42)]">
            <div className="text-xs font-semibold text-slate-100">KNOWLEDGE MAP</div>
            <div className="mt-1 text-[11px] text-slate-500">Obsidian ile eşitlenen canlı bilgi ağı</div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <MiniStat label="Nodes" value={positionedNodes.length} />
              <MiniStat label="Connections" value={relationships.length} />
              <MiniStat label="Notes" value={status?.indexedNotes ?? 0} />
              <MiniStat label="Chunks" value={status?.chunks ?? 0} />
            </div>
          </div>

          <div className="absolute right-5 top-5 hidden xl:flex items-center gap-2 rounded-xl border border-sky-300/10 bg-slate-950/62 backdrop-blur-xl p-2">
            <span className="pl-2 text-[11px] text-slate-300">Auto Layout</span>
            <button onClick={() => setAutoLayout((current) => !current)} className={`w-11 h-6 rounded-full p-1 transition-colors ${autoLayout ? 'bg-blue-500' : 'bg-slate-700'}`} title="Auto layout animation">
              <span className={`block w-4 h-4 rounded-full bg-white transition-transform ${autoLayout ? 'translate-x-5' : ''}`} />
            </button>
            <button onClick={resetCamera} className="w-9 h-9 rounded-lg border border-sky-300/10 bg-slate-900/70 text-slate-200 hover:border-cyan-400/45 flex items-center justify-center" title="Focus">
              <Focus className="w-4 h-4" />
            </button>
            <button onClick={reindex} className="w-9 h-9 rounded-lg border border-sky-300/10 bg-slate-900/70 text-slate-200 hover:border-cyan-400/45 flex items-center justify-center" title="Reindex">
              <Zap className="w-4 h-4" />
            </button>
          </div>

          <div className="absolute left-5 bottom-5 right-5 flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between pointer-events-none">
            <div className="pointer-events-auto rounded-xl border border-sky-300/10 bg-slate-950/72 backdrop-blur-xl px-4 py-3 flex flex-wrap items-center gap-3 text-[11px] text-slate-400 shadow-[0_0_30px_rgba(0,0,0,0.35)]">
              <span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.9)]" /> Live</span>
              <span>{positionedNodes.length} Nodes</span>
              <span>{relationships.length} Connections</span>
              <span>Last sync: {formatRelative(status?.lastSyncAt)}</span>
              <span className="hidden md:inline">Sol tuş döndürür, wheel zoom yapar, node seçilebilir.</span>
            </div>
            <div className="pointer-events-auto rounded-xl border border-sky-300/10 bg-slate-950/72 backdrop-blur-xl p-2 grid grid-cols-2 md:grid-cols-6 gap-2 xl:w-[740px]">
              <FilterInput value={query} onChange={setQuery} placeholder="Arama" />
              <SelectFilter value={nodeType} onChange={setNodeType} options={nodeTypes} placeholder="Node" />
              <SelectFilter value={relationshipType} onChange={setRelationshipType} options={relationshipTypes} placeholder="İlişki" />
              <SelectFilter value={folder} onChange={setFolder} options={folders} placeholder="Klasör" />
              <SelectFilter value={tag} onChange={setTag} options={tags} placeholder="Tag" />
              <SelectFilter value={source} onChange={setSource} options={sources} placeholder="Kaynak" labels={{ obsidian: 'Obsidian' }} />
            </div>
          </div>

          {positionedNodes.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center p-6 pointer-events-none">
              <div className="max-w-md rounded-xl border border-sky-300/10 bg-slate-950/82 p-5 text-center shadow-xl">
                <Network className="w-9 h-9 text-cyan-200 mx-auto" />
                <h3 className="mt-3 text-sm font-semibold text-slate-100">Obsidian graph boş</h3>
                <p className="mt-2 text-xs leading-relaxed text-slate-400">
                  Demo veri gösterilmiyor. `D:\EDİTH\EDİTH` vault içine Markdown, Canvas veya bağlantılı not ekleyince burası canlı olarak güncellenecek.
                </p>
              </div>
            </div>
          )}
        </div>
      </section>

      <aside className="w-80 xl:w-[360px] border-l border-sky-300/10 bg-[#06101f]/92 backdrop-blur-xl hidden lg:flex flex-col overflow-y-auto custom-scrollbar">
        <div className="px-4 py-4 border-b border-sky-300/10">
          <div className="text-xs font-semibold text-slate-300">NODE DETAILS</div>
        </div>

        {selectedNode ? (
          <section className="p-4 border-b border-sky-300/10">
            <div className="flex items-start gap-3">
              <div className="w-12 h-12 rounded-full border flex items-center justify-center text-sm font-black shadow-[0_0_28px_rgba(125,211,252,0.22)]" style={{ color: selectedNode.color, borderColor: selectedNode.color, backgroundColor: `${selectedNode.color}18` }}>
                {glyphFor(selectedNode.type)}
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-100 break-words">{selectedNode.title}</div>
                <div className="mt-1 inline-flex px-2 py-0.5 rounded-md text-[10px] font-mono" style={{ color: selectedNode.color, backgroundColor: `${selectedNode.color}18` }}>
                  {selectedNode.type}
                </div>
              </div>
            </div>

            <div className="mt-4 text-xs leading-relaxed text-slate-400 break-words">
              {selectedNode.path ?? 'Obsidian node'}
            </div>

            <div className="mt-5 grid grid-cols-[90px_1fr] gap-y-2 text-[11px]">
              <span className="text-slate-500">Source</span>
              <span className="text-right text-slate-300">{selectedNode.source}</span>
              <span className="text-slate-500">Folder</span>
              <span className="text-right text-slate-300">{selectedNode.folder || '-'}</span>
              <span className="text-slate-500">Importance</span>
              <span className="text-right text-slate-300">{selectedNode.importance.toFixed(2)}</span>
              <span className="text-slate-500">Connections</span>
              <span className="text-right text-slate-300">{selectedRelationships.length}</span>
              <span className="text-slate-500">Activity</span>
              <span className="text-right text-slate-300">{formatRelative(selectedNode.recentActivityAt)}</span>
            </div>

            {selectedNode.tags.length > 0 && (
              <div className="mt-5">
                <div className="text-[11px] font-semibold text-slate-400">TAGS</div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {selectedNode.tags.slice(0, 10).map((item) => (
                    <span key={item} className="px-2 py-1 rounded-md border border-sky-300/10 bg-slate-950/60 text-[10px] text-slate-300">#{item}</span>
                  ))}
                </div>
              </div>
            )}
          </section>
        ) : (
          <section className="p-4 border-b border-sky-300/10 text-xs text-slate-500">Node seçilmedi.</section>
        )}

        <section className="p-4 border-b border-sky-300/10">
          <div className="text-xs font-semibold text-slate-300">CONNECTED NODES</div>
          <div className="mt-3 space-y-2">
            {selectedNode && selectedRelationships.slice(0, 10).map((edge) => {
              const peer = nodeById.get(edge.from === selectedNode.id ? edge.to : edge.from);
              return (
                <button key={edge.id} onClick={() => peer && setSelectedId(peer.id)} className="w-full flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-slate-950/45 border border-sky-300/10 hover:border-cyan-400/40 transition-colors">
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
          <div className="text-xs font-semibold text-slate-300">CLUSTERS</div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {clusters.slice(0, 8).map(([type, count]) => (
              <button key={type} onClick={() => setNodeType(type)} className="rounded-lg border border-sky-300/10 bg-slate-950/45 p-3 text-left hover:border-cyan-400/35">
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
            <span className={status?.watcherActive ? 'text-emerald-300' : 'text-amber-300'}>{status?.watcherActive ? 'Live' : 'Idle'}</span>
          </div>
          <div className="mt-3 space-y-2">
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
        </section>
      </aside>
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

const MiniStat: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <div className="rounded-lg border border-sky-300/10 bg-slate-950/50 px-3 py-2">
    <div className="text-base font-semibold text-slate-100">{value}</div>
    <div className="text-[10px] text-slate-500">{label}</div>
  </div>
);
