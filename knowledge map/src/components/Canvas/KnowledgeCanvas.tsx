import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  KnowledgeNode,
  KnowledgeEdge,
  ClusterGroup,
  CanvasTransform,
  GridStyle,
  NodeColor
} from '../../types';
import { NodeCard } from './NodeCard';
import {
  getBestConnectionPoints,
  createBezierPath,
  computeBoundingBox,
  getNodeDimensions,
  Point
} from '../../utils/geometry';
import { NODE_COLOR_MAP } from '../../utils/themeStyles';
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  RotateCcw,
  Grid,
  Sparkles,
  Layers,
  ArrowRight,
  Plus
} from 'lucide-react';

interface KnowledgeCanvasProps {
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
  clusters: ClusterGroup[];
  isDarkMode: boolean;
  selectedNodeId: string | null;
  onSelectNode: (node: KnowledgeNode | null) => void;
  onUpdateNodePosition: (nodeId: string, x: number, y: number) => void;
  onNodesMoved?: (nodes: { id: string; x: number; y: number }[]) => void;
  onConnectNodes: (fromId: string, toId: string, anchorFrom?: string, anchorTo?: string) => void;
  onToggleChecklist: (nodeId: string, itemId: string) => void;
  onOpenEdit: (node: KnowledgeNode) => void;
  onDeleteNode: (nodeId: string) => void;
  onDuplicateNode: (node: KnowledgeNode) => void;
  onTogglePin: (nodeId: string) => void;
  onChangeColor: (nodeId: string, color: NodeColor) => void;
  onDeleteEdge: (edgeId: string) => void;
  onDropInboxNoteOnCanvas: (noteId: string, canvasX: number, canvasY: number) => void;
  transform: CanvasTransform;
  onTransformChange: (newTransform: CanvasTransform) => void;
}

export const KnowledgeCanvas: React.FC<KnowledgeCanvasProps> = ({
  nodes,
  edges,
  clusters,
  isDarkMode,
  selectedNodeId,
  onSelectNode,
  onUpdateNodePosition,
  onConnectNodes,
  onToggleChecklist,
  onOpenEdit,
  onDeleteNode,
  onDuplicateNode,
  onTogglePin,
  onChangeColor,
  onDeleteEdge,
  onDropInboxNoteOnCanvas,
  transform,
  onTransformChange
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState<Point>({ x: 0, y: 0 });
  const [gridStyle, setGridStyle] = useState<GridStyle>('dots');

  // Dragging Node state
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState<Point>({ x: 0, y: 0 });

  // Connecting line state
  const [connectingState, setConnectingState] = useState<{
    sourceNode: KnowledgeNode;
    anchor: 'top' | 'bottom' | 'left' | 'right';
    currentPos: Point;
    hoverTargetId: string | null;
  } | null>(null);

  // Active hover edge
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);

  // Canvas size
  const [dimensions, setDimensions] = useState({ width: 1200, height: 800 });

  useEffect(() => {
    const updateDims = () => {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight
        });
      }
    };
    updateDims();
    window.addEventListener('resize', updateDims);
    return () => window.removeEventListener('resize', updateDims);
  }, []);

  // Screen to Canvas coordinate conversion
  const screenToCanvas = useCallback(
    (screenX: number, screenY: number): Point => {
      if (!containerRef.current) return { x: 0, y: 0 };
      const rect = containerRef.current.getBoundingClientRect();
      return {
        x: (screenX - rect.left - transform.x) / transform.zoom,
        y: (screenY - rect.top - transform.y) / transform.zoom
      };
    },
    [transform]
  );

  // Zoom handlers
  const handleZoom = (factor: number, clientX?: number, clientY?: number) => {
    let focusX = dimensions.width / 2;
    let focusY = dimensions.height / 2;

    if (clientX !== undefined && clientY !== undefined && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      focusX = clientX - rect.left;
      focusY = clientY - rect.top;
    }

    const newZoom = Math.min(Math.max(transform.zoom * factor, 0.25), 2.5);
    const zoomRatio = newZoom / transform.zoom;

    const newX = focusX - (focusX - transform.x) * zoomRatio;
    const newY = focusY - (focusY - transform.y) * zoomRatio;

    onTransformChange({ x: newX, y: newY, zoom: newZoom });
  };

  const handleFitToView = () => {
    if (nodes.length === 0) return;
    const bounds = computeBoundingBox(nodes);
    const padding = 100;
    const availW = dimensions.width - padding * 2;
    const availH = dimensions.height - padding * 2;

    const zoomX = availW / bounds.width;
    const zoomY = availH / bounds.height;
    const targetZoom = Math.min(Math.max(Math.min(zoomX, zoomY), 0.35), 1.2);

    const centerX = bounds.minX + bounds.width / 2;
    const centerY = bounds.minY + bounds.height / 2;

    const newX = dimensions.width / 2 - centerX * targetZoom;
    const newY = dimensions.height / 2 - centerY * targetZoom;

    onTransformChange({ x: newX, y: newY, zoom: targetZoom });
  };

  const handleResetZoom = () => {
    onTransformChange({ x: 50, y: 50, zoom: 1 });
  };

  // Wheel handling for zooming
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const zoomFactor = e.deltaY < 0 ? 1.08 : 0.92;
      handleZoom(zoomFactor, e.clientX, e.clientY);
    } else {
      // Pan on wheel
      onTransformChange({
        x: transform.x - e.deltaX,
        y: transform.y - e.deltaY,
        zoom: transform.zoom
      });
    }
  };

  // Background Pan Start
  const handleMouseDown = (e: React.MouseEvent) => {
    // Only pan if clicking canvas background directly
    if (e.target === containerRef.current || (e.target as HTMLElement).id === 'canvas-bg-svg') {
      setIsPanning(true);
      setPanStart({ x: e.clientX - transform.x, y: e.clientY - transform.y });
      onSelectNode(null);
    }
  };

  // Start Node Dragging
  const handleNodeMouseDown = (node: KnowledgeNode, e: React.MouseEvent) => {
    e.stopPropagation();
    onSelectNode(node);
    const canvasPt = screenToCanvas(e.clientX, e.clientY);
    setDraggingNodeId(node.id);
    setDragOffset({
      x: canvasPt.x - node.x,
      y: canvasPt.y - node.y
    });
  };

  // Start Connecting Nodes
  const handleStartConnect = (
    node: KnowledgeNode,
    anchor: 'top' | 'bottom' | 'left' | 'right',
    e: React.MouseEvent
  ) => {
    e.stopPropagation();
    const canvasPt = screenToCanvas(e.clientX, e.clientY);
    setConnectingState({
      sourceNode: node,
      anchor,
      currentPos: canvasPt,
      hoverTargetId: null
    });
  };

  // Mouse Move on Container
  const handleMouseMove = (e: React.MouseEvent) => {
    if (isPanning) {
      onTransformChange({
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y,
        zoom: transform.zoom
      });
      return;
    }

    if (draggingNodeId) {
      const canvasPt = screenToCanvas(e.clientX, e.clientY);
      const newX = Math.round(canvasPt.x - dragOffset.x);
      const newY = Math.round(canvasPt.y - dragOffset.y);
      onUpdateNodePosition(draggingNodeId, newX, newY);
      return;
    }

    if (connectingState) {
      const canvasPt = screenToCanvas(e.clientX, e.clientY);
      // Check if hovering over any other node
      const hovered = nodes.find((n) => {
        if (n.id === connectingState.sourceNode.id) return false;
        const dim = getNodeDimensions(n);
        return (
          canvasPt.x >= n.x &&
          canvasPt.x <= n.x + dim.width &&
          canvasPt.y >= n.y &&
          canvasPt.y <= n.y + dim.height
        );
      });

      setConnectingState({
        ...connectingState,
        currentPos: canvasPt,
        hoverTargetId: hovered ? hovered.id : null
      });
    }
  };

  // Mouse Up
  const handleMouseUp = () => {
    if (isPanning) {
      setIsPanning(false);
    }
    if (draggingNodeId) {
      setDraggingNodeId(null);
    }
    if (connectingState) {
      if (connectingState.hoverTargetId) {
        onConnectNodes(connectingState.sourceNode.id, connectingState.hoverTargetId);
      }
      setConnectingState(null);
    }
  };

  // Drag & Drop from Inbox Tray
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const noteId = e.dataTransfer.getData('text/plain');
    if (noteId) {
      const canvasPt = screenToCanvas(e.clientX, e.clientY);
      onDropInboxNoteOnCanvas(noteId, Math.round(canvasPt.x), Math.round(canvasPt.y));
    }
  };

  return (
    <div
      ref={containerRef}
      id="knowledge-canvas-container"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onWheel={handleWheel}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className={`relative w-full h-full overflow-hidden select-none cursor-default ${
        isDarkMode ? 'bg-[#0b0f19]' : 'bg-[#f8fafc]'
      }`}
    >
      {/* Background Grid Patterns */}
      <svg
        id="canvas-bg-svg"
        className="absolute inset-0 w-full h-full pointer-events-none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          {/* Dot Grid */}
          <pattern
            id="pattern-dots"
            x={transform.x % (28 * transform.zoom)}
            y={transform.y % (28 * transform.zoom)}
            width={28 * transform.zoom}
            height={28 * transform.zoom}
            patternUnits="userSpaceOnUse"
          >
            <circle
              cx={2}
              cy={2}
              r={1.2 * Math.min(transform.zoom, 1.4)}
              fill={isDarkMode ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.15)'}
            />
          </pattern>

          {/* Grid Lines */}
          <pattern
            id="pattern-grid"
            x={transform.x % (40 * transform.zoom)}
            y={transform.y % (40 * transform.zoom)}
            width={40 * transform.zoom}
            height={40 * transform.zoom}
            patternUnits="userSpaceOnUse"
          >
            <path
              d={`M ${40 * transform.zoom} 0 L 0 0 0 ${40 * transform.zoom}`}
              fill="none"
              stroke={isDarkMode ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.06)'}
              strokeWidth="1"
            />
          </pattern>

          {/* Isometric Pattern */}
          <pattern
            id="pattern-isometric"
            x={transform.x % (60 * transform.zoom)}
            y={transform.y % (34.64 * transform.zoom)}
            width={60 * transform.zoom}
            height={34.64 * transform.zoom}
            patternUnits="userSpaceOnUse"
          >
            <path
              d={`M 0 0 L ${30 * transform.zoom} ${17.32 * transform.zoom} L 0 ${34.64 * transform.zoom} M ${60 * transform.zoom} 0 L ${30 * transform.zoom} ${17.32 * transform.zoom} L ${60 * transform.zoom} ${34.64 * transform.zoom}`}
              fill="none"
              stroke={isDarkMode ? 'rgba(99, 102, 241, 0.07)' : 'rgba(99, 102, 241, 0.08)'}
              strokeWidth="1"
            />
          </pattern>

          {/* Arrowhead Markers for Edge types */}
          <marker
            id="arrow-default"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill={isDarkMode ? '#94a3b8' : '#64748b'} />
          </marker>

          <marker
            id="arrow-indigo"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#6366f1" />
          </marker>

          <marker
            id="arrow-cyan"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#06b6d4" />
          </marker>

          <marker
            id="arrow-emerald"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#10b981" />
          </marker>

          <marker
            id="arrow-rose"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#f43f5e" />
          </marker>

          <marker
            id="arrow-amber"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#f59e0b" />
          </marker>
        </defs>

        {gridStyle !== 'blank' && (
          <rect
            width="100%"
            height="100%"
            fill={
              gridStyle === 'dots'
                ? 'url(#pattern-dots)'
                : gridStyle === 'grid'
                ? 'url(#pattern-grid)'
                : 'url(#pattern-isometric)'
            }
          />
        )}
      </svg>

      {/* Transformable Canvas Content */}
      <div
        id="canvas-world"
        style={{
          transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.zoom})`,
          transformOrigin: '0 0'
        }}
        className="absolute inset-0 pointer-events-none"
      >
        {/* 1. Cluster Areas Layer */}
        {clusters.map((cluster) => {
          const colorTheme = NODE_COLOR_MAP[cluster.color] || NODE_COLOR_MAP.indigo;
          return (
            <div
              key={cluster.id}
              style={{
                transform: `translate3d(${cluster.x}px, ${cluster.y}px, 0px)`,
                width: cluster.width,
                height: cluster.height
              }}
              className={`absolute rounded-3xl border-2 border-dashed p-4 transition-colors pointer-events-auto select-none backdrop-blur-sm ${
                isDarkMode
                  ? 'bg-white/[0.02] border-white/15 shadow-inner'
                  : 'bg-white/40 border-indigo-200/60 shadow-inner'
              }`}
            >
              <div className="flex items-center justify-between">
                <span
                  className={`text-xs font-semibold uppercase tracking-wider px-3 py-1 rounded-xl backdrop-blur-md ${
                    isDarkMode ? colorTheme.badgeBgDark : colorTheme.badgeBgLight
                  }`}
                >
                  {cluster.title}
                </span>
                {cluster.description && (
                  <span className="text-[11px] text-slate-400 font-medium">
                    {cluster.description}
                  </span>
                )}
              </div>
            </div>
          );
        })}

        {/* 2. SVG Connections & Edges Layer */}
        <svg
          id="canvas-edges-layer"
          className="absolute inset-0 w-[50000px] h-[50000px] -translate-x-[25000px] -translate-y-[25000px] pointer-events-none overflow-visible"
        >
          <g transform="translate(25000, 25000)">
            {edges.map((edge) => {
              const fromNode = nodes.find((n) => n.id === edge.fromNodeId);
              const toNode = nodes.find((n) => n.id === edge.toNodeId);
              if (!fromNode || !toNode) return null;

              const conn = getBestConnectionPoints(fromNode, toNode);
              const { pathString, midPoint } = createBezierPath(
                conn.from,
                conn.to,
                conn.fromAnchor,
                conn.toAnchor
              );

              const strokeColor =
                edge.color && NODE_COLOR_MAP[edge.color]
                  ? NODE_COLOR_MAP[edge.color].accent
                  : isDarkMode
                  ? '#64748b'
                  : '#94a3b8';

              const isHovered = hoveredEdgeId === edge.id;
              const markerId =
                edge.color && edge.color !== 'slate'
                  ? `url(#arrow-${edge.color})`
                  : 'url(#arrow-default)';

              return (
                <g key={edge.id} className="pointer-events-auto">
                  {/* Invisible wide hit area for hover and click */}
                  <path
                    d={pathString}
                    fill="none"
                    stroke="transparent"
                    strokeWidth="20"
                    className="cursor-pointer"
                    onMouseEnter={() => setHoveredEdgeId(edge.id)}
                    onMouseLeave={() => setHoveredEdgeId(null)}
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteEdge(edge.id);
                    }}
                  />

                  {/* Outer Glow if style === 'glow' */}
                  {edge.style === 'glow' && (
                    <path
                      d={pathString}
                      fill="none"
                      stroke={strokeColor}
                      strokeWidth="6"
                      strokeOpacity="0.3"
                      className="transition-all"
                    />
                  )}

                  {/* Main Stroke */}
                  <path
                    d={pathString}
                    fill="none"
                    stroke={isHovered ? '#ef4444' : strokeColor}
                    strokeWidth={isHovered ? '3' : edge.style === 'glow' ? '2.5' : '2'}
                    strokeDasharray={
                      edge.style === 'dashed'
                        ? '6,6'
                        : edge.style === 'dotted'
                        ? '3,3'
                        : undefined
                    }
                    markerEnd={edge.arrow !== false ? markerId : undefined}
                    className="transition-all duration-150"
                  />

                  {/* Animated traveling particle if animated */}
                  {edge.animated && (
                    <circle r="3.5" fill={strokeColor}>
                      <animateMotion path={pathString} dur="3s" repeatCount="indefinite" />
                    </circle>
                  )}

                  {/* Edge Label Badge */}
                  {edge.label && (
                    <g transform={`translate(${midPoint.x}, ${midPoint.y})`}>
                      <rect
                        x="-45"
                        y="-11"
                        width="90"
                        height="22"
                        rx="6"
                        fill={isDarkMode ? '#0f172a' : '#ffffff'}
                        stroke={isHovered ? '#ef4444' : isDarkMode ? '#334155' : '#cbd5e1'}
                        strokeWidth="1"
                        className="shadow-sm"
                      />
                      <text
                        x="0"
                        y="3.5"
                        textAnchor="middle"
                        fill={isDarkMode ? '#cbd5e1' : '#475569'}
                        fontSize="10"
                        fontWeight="500"
                        className="select-none pointer-events-none"
                      >
                        {isHovered ? 'Silmek için tıkla' : edge.label}
                      </text>
                    </g>
                  )}
                </g>
              );
            })}

            {/* Active Connecting Drag Line Preview */}
            {connectingState && (
              <g className="pointer-events-none">
                {(() => {
                  const sourceDim = getNodeDimensions(connectingState.sourceNode);
                  let startPt: Point = {
                    x: connectingState.sourceNode.x + sourceDim.width / 2,
                    y: connectingState.sourceNode.y + sourceDim.height / 2
                  };

                  switch (connectingState.anchor) {
                    case 'top':
                      startPt = {
                        x: connectingState.sourceNode.x + sourceDim.width / 2,
                        y: connectingState.sourceNode.y
                      };
                      break;
                    case 'bottom':
                      startPt = {
                        x: connectingState.sourceNode.x + sourceDim.width / 2,
                        y: connectingState.sourceNode.y + sourceDim.height
                      };
                      break;
                    case 'left':
                      startPt = {
                        x: connectingState.sourceNode.x,
                        y: connectingState.sourceNode.y + sourceDim.height / 2
                      };
                      break;
                    case 'right':
                      startPt = {
                        x: connectingState.sourceNode.x + sourceDim.width,
                        y: connectingState.sourceNode.y + sourceDim.height / 2
                      };
                      break;
                  }

                  const endPt = connectingState.currentPos;
                  const dx = endPt.x - startPt.x;
                  const dy = endPt.y - startPt.y;
                  const cp1 = { x: startPt.x + dx * 0.4, y: startPt.y + dy * 0.1 };
                  const cp2 = { x: startPt.x + dx * 0.6, y: startPt.y + dy * 0.9 };
                  const previewPath = `M ${startPt.x} ${startPt.y} C ${cp1.x} ${cp1.y}, ${cp2.x} ${cp2.y}, ${endPt.x} ${endPt.y}`;

                  return (
                    <>
                      <path
                        d={previewPath}
                        fill="none"
                        stroke="#f59e0b"
                        strokeWidth="2.5"
                        strokeDasharray="6,4"
                        markerEnd="url(#arrow-amber)"
                      />
                      <circle cx={endPt.x} cy={endPt.y} r="5" fill="#f59e0b" />
                    </>
                  );
                })()}
              </g>
            )}
          </g>
        </svg>

        {/* 3. Draggable Nodes Layer */}
        <div className="absolute inset-0 pointer-events-auto">
          {nodes.map((node) => (
            <div
              key={node.id}
              onMouseDown={(e) => handleNodeMouseDown(node, e)}
              className="contents"
            >
              <NodeCard
                node={node}
                isSelected={selectedNodeId === node.id}
                isConnectingSource={connectingState?.sourceNode.id === node.id}
                isConnectingTargetHovered={connectingState?.hoverTargetId === node.id}
                isDarkMode={isDarkMode}
                onSelect={(n, e) => {
                  e.stopPropagation();
                  onSelectNode(n);
                }}
                onStartConnect={handleStartConnect}
                onToggleChecklist={onToggleChecklist}
                onOpenEdit={onOpenEdit}
                onDelete={onDeleteNode}
                onDuplicate={onDuplicateNode}
                onTogglePin={onTogglePin}
                onChangeColor={onChangeColor}
                scale={transform.zoom}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Floating Canvas Controls (Bottom-Left) */}
      <div
        id="canvas-controls-toolbar"
        className={`absolute bottom-5 left-5 flex items-center gap-1.5 p-1.5 rounded-2xl border shadow-2xl z-30 backdrop-blur-xl transition-all ${
          isDarkMode
            ? 'bg-white/[0.06] border-white/15 text-slate-200 shadow-black/40'
            : 'bg-white/80 border-slate-200/80 text-slate-700 shadow-slate-200/50'
        }`}
      >
        <button
          id="btn-zoom-in"
          title="Yakınlaştır (+)"
          onClick={() => handleZoom(1.2)}
          className={`p-2 rounded-xl transition-colors ${
            isDarkMode ? 'hover:bg-white/10 text-slate-200' : 'hover:bg-slate-100 text-slate-700'
          }`}
        >
          <ZoomIn className="w-4 h-4" />
        </button>

        <span className="text-xs font-mono font-semibold px-1 min-w-10 text-center text-indigo-400">
          {Math.round(transform.zoom * 100)}%
        </span>

        <button
          id="btn-zoom-out"
          title="Uzaklaştır (-)"
          onClick={() => handleZoom(0.83)}
          className={`p-2 rounded-xl transition-colors ${
            isDarkMode ? 'hover:bg-white/10 text-slate-200' : 'hover:bg-slate-100 text-slate-700'
          }`}
        >
          <ZoomOut className="w-4 h-4" />
        </button>

        <div className="w-[1px] h-4 bg-slate-300 dark:bg-white/15 mx-0.5" />

        <button
          id="btn-fit-view"
          title="Tüm Haritayı Sığdır"
          onClick={handleFitToView}
          className={`p-2 rounded-xl transition-colors flex items-center gap-1 text-xs font-medium ${
            isDarkMode ? 'hover:bg-white/10 text-slate-200' : 'hover:bg-slate-100 text-slate-700'
          }`}
        >
          <Maximize2 className="w-4 h-4" />
          <span className="hidden sm:inline">Sığdır</span>
        </button>

        <button
          id="btn-reset-view"
          title="Görünümü Sıfırla (100%)"
          onClick={handleResetZoom}
          className={`p-2 rounded-xl transition-colors ${
            isDarkMode ? 'hover:bg-white/10 text-slate-200' : 'hover:bg-slate-100 text-slate-700'
          }`}
        >
          <RotateCcw className="w-4 h-4" />
        </button>

        <div className="w-[1px] h-4 bg-slate-300 dark:bg-white/15 mx-0.5" />

        {/* Grid Selector */}
        <button
          id="btn-grid-toggle"
          title={`Izgara Stili: ${gridStyle}`}
          onClick={() => {
            const styles: GridStyle[] = ['dots', 'grid', 'isometric', 'blank'];
            const nextIdx = (styles.indexOf(gridStyle) + 1) % styles.length;
            setGridStyle(styles[nextIdx]);
          }}
          className={`p-2 rounded-xl transition-colors flex items-center gap-1 text-xs capitalize ${
            isDarkMode ? 'hover:bg-white/10 text-slate-200' : 'hover:bg-slate-100 text-slate-700'
          }`}
        >
          <Grid className="w-4 h-4" />
          <span className="hidden sm:inline">{gridStyle}</span>
        </button>
      </div>

      {/* Frosted Bottom Interaction Hints Pill */}
      <div
        className={`hidden lg:flex absolute bottom-5 left-1/2 -translate-x-1/2 px-5 py-2.5 rounded-full items-center gap-6 text-[11px] uppercase tracking-widest font-semibold z-20 backdrop-blur-xl border transition-all pointer-events-none ${
          isDarkMode
            ? 'bg-black/40 border-white/10 text-slate-400 shadow-xl'
            : 'bg-white/70 border-slate-200 text-slate-600 shadow-sm'
        }`}
      >
        <span className="flex items-center gap-1.5 text-indigo-400">
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
          Bağlamak İçin Çek
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />
          Düzenlemek İçin Çift Tıkla
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />
          Kaydırmak İçin Sürükle
        </span>
      </div>
    </div>
  );
};
