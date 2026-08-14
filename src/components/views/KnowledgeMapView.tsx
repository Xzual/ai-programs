import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Brain,
  CircleDot,
  Database,
  Focus,
  Network,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Wrench,
} from 'lucide-react';
import { AutomationTool, MemoryItem, ToolExecutionLog } from '../../types';

interface KnowledgeMapViewProps {
  memories: MemoryItem[];
  tools: AutomationTool[];
  logs: ToolExecutionLog[];
}

interface GraphNode {
  id: string;
  label: string;
  type: 'core' | 'memory' | 'tool' | 'task' | 'audit' | 'agent' | 'model';
  x: number;
  y: number;
  size: number;
  meta?: string;
  status?: string;
  riskLevel?: number;
}

interface GraphEdge {
  from: string;
  to: string;
  label: string;
  source?: string;
}

interface KnowledgeMapSnapshot {
  generatedAt: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  metrics: Array<{ label: string; value: number; type: GraphNode['type'] }>;
  sources: Record<string, number>;
}

type StoredTask = {
  id: string;
  title: string;
  status?: string;
  riskLevel?: number;
};

const typeLabel: Record<GraphNode['type'], string> = {
  core: 'Core',
  memory: 'Memory',
  tool: 'Tool',
  task: 'Task',
  audit: 'Audit',
  agent: 'Agent',
  model: 'Model',
};

const colorFor = (type: GraphNode['type']) => {
  switch (type) {
    case 'core':
      return 'var(--edith-primary)';
    case 'memory':
      return '#22c55e';
    case 'tool':
      return '#38bdf8';
    case 'task':
      return '#f59e0b';
    case 'audit':
      return '#fb7185';
    case 'agent':
      return '#a78bfa';
    case 'model':
      return '#14b8a6';
  }
};

const edgePath = (from: GraphNode, to: GraphNode) => {
  const midX = (from.x + to.x) / 2;
  const midY = (from.y + to.y) / 2;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const curve = Math.min(9, Math.max(3, Math.hypot(dx, dy) * 0.12));
  const controlX = midX - dy * 0.04;
  const controlY = midY + dx * 0.04 - curve;
  return `M ${from.x} ${from.y} Q ${controlX} ${controlY} ${to.x} ${to.y}`;
};

export const KnowledgeMapView: React.FC<KnowledgeMapViewProps> = ({ memories, tools, logs }) => {
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string>('edith-core');
  const [tasks, setTasks] = useState<StoredTask[]>([]);
  const [snapshot, setSnapshot] = useState<KnowledgeMapSnapshot | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const loadTasks = async () => {
    try {
      const response = await fetch('/api/edith/tasks');
      const data = await response.json();
      setTasks(data.tasks ?? []);
    } catch {
      setTasks([]);
    }
  };

  const loadKnowledgeMap = async () => {
    try {
      const response = await fetch('/api/edith/knowledge-map');
      const data = await response.json();
      if (data.success && data.map?.nodes && data.map?.edges) {
        setSnapshot(data.map);
        return;
      }
      setSnapshot(null);
      await loadTasks();
    } catch {
      setSnapshot(null);
      await loadTasks();
    }
  };

  useEffect(() => {
    loadKnowledgeMap();
  }, []);

  const { nodes, edges } = useMemo(() => {
    if (snapshot) {
      return { nodes: snapshot.nodes, edges: snapshot.edges };
    }

    const builtNodes: GraphNode[] = [
      { id: 'edith-core', label: 'E.D.I.T.H Core', type: 'core', x: 50, y: 50, size: 34, meta: 'routing kernel' },
      { id: 'memory-hub', label: 'Memory', type: 'memory', x: 23, y: 28, size: 22, meta: `${memories.length} kayıt` },
      { id: 'tool-hub', label: 'Tools', type: 'tool', x: 77, y: 28, size: 22, meta: `${tools.length} araç` },
      { id: 'task-hub', label: 'Tasks', type: 'task', x: 27, y: 74, size: 22, meta: `${tasks.length} görev` },
      { id: 'audit-hub', label: 'Audit', type: 'audit', x: 73, y: 74, size: 22, meta: `${logs.length} log` },
    ];

    const builtEdges: GraphEdge[] = [
      { from: 'edith-core', to: 'memory-hub', label: 'retrieves' },
      { from: 'edith-core', to: 'tool-hub', label: 'routes' },
      { from: 'edith-core', to: 'task-hub', label: 'plans' },
      { from: 'edith-core', to: 'audit-hub', label: 'records' },
    ];

    memories.slice(0, 8).forEach((memory, index) => {
      const angle = (Math.PI * 2 * index) / Math.max(8, memories.length || 1) - Math.PI / 8;
      builtNodes.push({
        id: `memory-${memory.id}`,
        label: memory.key,
        type: 'memory',
        x: 23 + Math.cos(angle) * 15,
        y: 28 + Math.sin(angle) * 16,
        size: memory.isSensitive ? 11 : 9,
        meta: memory.category,
      });
      builtEdges.push({ from: 'memory-hub', to: `memory-${memory.id}`, label: memory.category });
    });

    tools.slice(0, 12).forEach((tool, index) => {
      const angle = (Math.PI * 2 * index) / Math.max(12, tools.length || 1) + Math.PI / 10;
      builtNodes.push({
        id: `tool-${tool.id}`,
        label: tool.name,
        type: 'tool',
        x: 77 + Math.cos(angle) * 15,
        y: 28 + Math.sin(angle) * 17,
        size: tool.requiresConfirmation ? 11 : 9,
        meta: tool.category,
      });
      builtEdges.push({ from: 'tool-hub', to: `tool-${tool.id}`, label: tool.category });
    });

    tasks.slice(0, 8).forEach((task, index) => {
      builtNodes.push({
        id: `task-${task.id}`,
        label: task.title,
        type: 'task',
        x: 14 + (index % 4) * 9,
        y: 84 + Math.floor(index / 4) * 8,
        size: task.riskLevel && task.riskLevel >= 3 ? 11 : 9,
        meta: task.status ?? 'queued',
      });
      builtEdges.push({ from: 'task-hub', to: `task-${task.id}`, label: task.status ?? 'queued' });
    });

    logs.slice(0, 8).forEach((log, index) => {
      builtNodes.push({
        id: `audit-${log.id}`,
        label: log.toolName,
        type: 'audit',
        x: 63 + (index % 4) * 8,
        y: 84 + Math.floor(index / 4) * 8,
        size: log.status === 'success' ? 9 : 11,
        meta: log.status,
      });
      builtEdges.push({ from: 'audit-hub', to: `audit-${log.id}`, label: log.status });
    });

    return { nodes: builtNodes, edges: builtEdges };
  }, [memories, tools, logs, tasks, snapshot]);

  const filteredNodes = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return nodes;
    return nodes.filter((node) => {
      return (
        node.label.toLowerCase().includes(normalized) ||
        node.type.toLowerCase().includes(normalized) ||
        node.meta?.toLowerCase().includes(normalized)
      );
    });
  }, [nodes, query]);

  const selectedNode = nodes.find((node) => node.id === selectedId) ?? nodes[0];
  const selectedEdgeIds = new Set(
    edges
      .filter((edge) => edge.from === selectedNode.id || edge.to === selectedNode.id)
      .flatMap((edge) => [edge.from, edge.to])
  );
  const selectedEdges = edges.filter((edge) => edge.from === selectedNode.id || edge.to === selectedNode.id);
  const filteredIds = new Set(filteredNodes.map((node) => node.id));
  const latestLog = logs[0];

  const metrics = (snapshot?.metrics ?? [
    { label: 'Memory', value: memories.length, type: 'memory' as const },
    { label: 'Tools', value: tools.length, type: 'tool' as const },
    { label: 'Tasks', value: tasks.length, type: 'task' as const },
    { label: 'Logs', value: logs.length, type: 'audit' as const },
  ]).map((metric) => ({
    ...metric,
    icon:
      metric.type === 'memory' ? <Brain className="w-4 h-4" /> :
      metric.type === 'tool' ? <Wrench className="w-4 h-4" /> :
      metric.type === 'task' ? <Database className="w-4 h-4" /> :
      metric.type === 'agent' ? <Network className="w-4 h-4" /> :
      <CircleDot className="w-4 h-4" />,
  }));

  return (
    <div className="flex-1 bg-[var(--edith-bg)] overflow-hidden flex text-slate-100">
      <section className="flex-1 min-w-0 flex flex-col">
        <div className="px-5 py-4 border-b border-slate-800/80 bg-slate-950/70 backdrop-blur-xl flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg border border-[var(--edith-primary)]/35 bg-[var(--edith-primary)]/10 flex items-center justify-center shadow-lg shadow-black/30">
                <Network className="w-5 h-5 text-[var(--edith-accent)]" />
              </div>
              <div>
                <h2 className="text-base font-semibold tracking-wide">Knowledge Map</h2>
                <div className="mt-1 flex items-center gap-2 text-[11px] font-mono text-slate-500">
                  <span>{nodes.length} nodes</span>
                  <span className="w-1 h-1 rounded-full bg-slate-700" />
                  <span>{edges.length} links</span>
                  {latestLog && (
                    <>
                      <span className="w-1 h-1 rounded-full bg-slate-700" />
                      <span className={latestLog.status === 'success' ? 'text-emerald-300' : 'text-amber-300'}>
                        {latestLog.status}
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="hidden md:flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-800 bg-slate-900/70 text-[11px] font-mono text-slate-400">
              <ShieldCheck className="w-4 h-4 text-emerald-300" />
              {snapshot ? 'backend synced' : 'local view'}
            </div>
            <button
              onClick={loadKnowledgeMap}
              className="px-3 py-2 rounded-lg border border-slate-800 bg-slate-900/80 text-xs text-slate-200 hover:border-[var(--edith-primary)]/45 hover:text-white flex items-center gap-2 transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              Yenile
            </button>
          </div>
        </div>

        <div className="flex-1 relative overflow-hidden bg-slate-950/35">
          <div
            className="absolute inset-0 opacity-70"
            style={{
              background:
                'radial-gradient(circle at 50% 48%, color-mix(in srgb, var(--edith-primary) 18%, transparent), transparent 34%), radial-gradient(circle at 78% 20%, color-mix(in srgb, var(--edith-accent) 9%, transparent), transparent 28%)',
            }}
          />
          <div
            className="absolute inset-0 opacity-[0.18]"
            style={{
              backgroundImage:
                'linear-gradient(rgba(148,163,184,0.22) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.22) 1px, transparent 1px)',
              backgroundSize: '48px 48px',
              maskImage: 'radial-gradient(circle at center, black 0 58%, transparent 82%)',
            }}
          />

          <svg ref={svgRef} viewBox="0 0 100 100" className="relative z-10 w-full h-full">
            <defs>
              <filter id="knowledgeNodeGlow">
                <feGaussianBlur stdDeviation="1.5" result="coloredBlur" />
                <feMerge>
                  <feMergeNode in="coloredBlur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              <filter id="knowledgeCoreGlow">
                <feGaussianBlur stdDeviation="2.8" result="coloredBlur" />
                <feMerge>
                  <feMergeNode in="coloredBlur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            {edges.map((edge) => {
              const from = nodes.find((node) => node.id === edge.from);
              const to = nodes.find((node) => node.id === edge.to);
              if (!from || !to) return null;
              const focused = edge.from === selectedNode.id || edge.to === selectedNode.id;
              const hiddenBySearch = query && (!filteredIds.has(edge.from) || !filteredIds.has(edge.to));
              return (
                <path
                  key={`${edge.from}-${edge.to}`}
                  d={edgePath(from, to)}
                  fill="none"
                  stroke={focused ? colorFor(to.type) : 'rgba(148, 163, 184, 0.24)'}
                  strokeWidth={focused ? 0.42 : 0.18}
                  strokeLinecap="round"
                  opacity={hiddenBySearch ? 0.1 : focused ? 0.86 : 0.5}
                />
              );
            })}

            {nodes.map((node) => {
              const active = node.id === selectedNode.id;
              const searchedOut = query && !filteredIds.has(node.id);
              const related = selectedEdgeIds.has(node.id);
              const showLabel = node.size >= 20 || active || related || (!!query && !searchedOut);
              const fill = colorFor(node.type);
              return (
                <g
                  key={node.id}
                  onClick={() => setSelectedId(node.id)}
                  className="cursor-pointer transition-opacity"
                  opacity={searchedOut ? 0.14 : selectedEdgeIds.size && !related && !active ? 0.44 : 1}
                >
                  {active && (
                    <>
                      <circle cx={node.x} cy={node.y} r={node.size / 5.2} fill={fill} opacity="0.08" />
                      <circle
                        cx={node.x}
                        cy={node.y}
                        r={node.size / 6}
                        fill="none"
                        stroke="var(--edith-accent)"
                        strokeWidth="0.28"
                        strokeDasharray="1.3 1"
                      />
                    </>
                  )}
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={node.size / 9}
                    fill={fill}
                    filter={node.type === 'core' ? 'url(#knowledgeCoreGlow)' : 'url(#knowledgeNodeGlow)'}
                    opacity={active ? 1 : 0.9}
                  />
                  <circle cx={node.x - node.size / 36} cy={node.y - node.size / 36} r={node.size / 28} fill="white" opacity="0.42" />
                  {showLabel && (
                    <>
                      <text
                        x={node.x}
                        y={node.y + node.size / 9 + 2.6}
                        textAnchor="middle"
                        fontSize={node.type === 'core' ? 2.35 : node.size >= 20 ? 1.48 : 1.28}
                        fill={active ? 'rgba(248,250,252,0.98)' : 'rgba(203,213,225,0.86)'}
                        className="select-none"
                        style={{ paintOrder: 'stroke', stroke: 'rgba(2,6,23,0.86)', strokeWidth: 0.46 }}
                      >
                        {node.label.slice(0, node.type === 'core' ? 20 : 16)}
                      </text>
                      {node.meta && node.size >= 20 && (
                        <text
                          x={node.x}
                          y={node.y + node.size / 9 + 5.1}
                          textAnchor="middle"
                          fontSize="1.12"
                          fill="rgba(148,163,184,0.72)"
                          className="select-none"
                        >
                          {node.meta.slice(0, 16)}
                        </text>
                      )}
                    </>
                  )}
                </g>
              );
            })}
          </svg>
        </div>
      </section>

      <aside className="w-80 xl:w-96 border-l border-slate-800/80 bg-slate-950/78 backdrop-blur-xl p-4 hidden lg:flex flex-col gap-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Node ara..."
            className="w-full pl-9 pr-3 py-2.5 rounded-lg bg-slate-900/90 border border-slate-800 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-[var(--edith-primary)]/55 focus:ring-1 focus:ring-[var(--edith-primary)]/20"
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          {metrics.map((metric) => (
            <Stat
              key={metric.label}
              icon={metric.icon}
              label={metric.label}
              value={metric.value}
              color={colorFor(metric.type)}
            />
          ))}
        </div>

        <section className="rounded-lg border border-slate-800 bg-slate-900/65 p-4 shadow-xl shadow-black/20">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
              <Focus className="w-4 h-4 text-[var(--edith-primary)]" />
              Seçili Node
            </div>
            <span
              className="px-2 py-0.5 rounded-md border text-[10px] font-mono"
              style={{
                color: colorFor(selectedNode.type),
                borderColor: `color-mix(in srgb, ${colorFor(selectedNode.type)} 38%, transparent)`,
                background: `color-mix(in srgb, ${colorFor(selectedNode.type)} 12%, transparent)`,
              }}
            >
              {typeLabel[selectedNode.type]}
            </span>
          </div>

          <div className="mt-4 flex items-start gap-3">
            <span
              className="mt-1 w-3 h-3 rounded-full shrink-0 shadow-lg"
              style={{ background: colorFor(selectedNode.type), boxShadow: `0 0 18px ${colorFor(selectedNode.type)}` }}
            />
            <div className="min-w-0">
              <div className="text-sm text-slate-100 break-words">{selectedNode.label}</div>
              <div className="mt-1 text-[11px] text-slate-500 font-mono">{selectedNode.meta ?? selectedNode.id}</div>
            </div>
          </div>

          <div className="mt-4 pt-4 border-t border-slate-800/80 space-y-2">
            <div className="flex items-center justify-between text-[11px] text-slate-500 font-mono">
              <span>linked edges</span>
              <span>{selectedEdges.length}</span>
            </div>
            {selectedEdges.slice(0, 4).map((edge) => {
              const peer = nodes.find((node) => node.id === (edge.from === selectedNode.id ? edge.to : edge.from));
              return (
                <button
                  key={`${edge.from}-${edge.to}`}
                  onClick={() => peer && setSelectedId(peer.id)}
                  className="w-full flex items-center justify-between gap-3 px-3 py-2 rounded-md bg-slate-950/50 border border-slate-800 hover:border-[var(--edith-primary)]/40 transition-colors"
                >
                  <span className="truncate text-xs text-slate-300">{peer?.label ?? edge.to}</span>
                  <span className="text-[10px] text-slate-500 font-mono shrink-0">{edge.label}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="rounded-lg border border-slate-800 bg-slate-900/55 p-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
            <Sparkles className="w-4 h-4 text-[var(--edith-accent)]" />
            Node Tipleri
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {(['core', 'memory', 'tool', 'task', 'audit', 'agent', 'model'] as GraphNode['type'][]).map((type) => (
              <div key={type} className="flex items-center gap-2 text-[11px] text-slate-400 font-mono">
                <span className="w-2 h-2 rounded-full" style={{ background: colorFor(type) }} />
                {typeLabel[type]}
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-lg border border-slate-800 bg-slate-900/55 p-4">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
            <span className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-[var(--edith-primary)]" />
              Son Aktivite
            </span>
            <span className="text-[10px] text-slate-500 font-mono">{logs.length}</span>
          </div>
          <div className="mt-3 space-y-2">
            {logs.slice(0, 3).map((log) => (
              <div key={log.id} className="flex items-center justify-between gap-3 text-[11px]">
                <span className="truncate text-slate-400">{log.toolName}</span>
                <span className={log.status === 'success' ? 'text-emerald-300' : 'text-amber-300'}>{log.status}</span>
              </div>
            ))}
            {logs.length === 0 && <div className="text-[11px] text-slate-600">Henüz log yok.</div>}
          </div>
        </section>
      </aside>
    </div>
  );
};

interface StatProps {
  icon: React.ReactNode;
  label: string;
  value: number;
  color: string;
}

const Stat: React.FC<StatProps> = ({
  icon,
  label,
  value,
  color,
}) => {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/65 p-3 shadow-lg shadow-black/15">
      <div className="flex items-center justify-between text-slate-500">
        <span style={{ color }}>{icon}</span>
        <span className="text-[10px] font-mono">{label}</span>
      </div>
      <div className="mt-2 text-xl font-semibold text-slate-100">{value}</div>
    </div>
  );
};
