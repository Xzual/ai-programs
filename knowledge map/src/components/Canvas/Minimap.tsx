import React from 'react';
import { KnowledgeNode, CanvasTransform, ClusterGroup } from '../../types';
import { computeBoundingBox, getNodeDimensions } from '../../utils/geometry';
import { NODE_COLOR_MAP } from '../../utils/themeStyles';

interface MinimapProps {
  nodes: KnowledgeNode[];
  clusters?: ClusterGroup[];
  transform: CanvasTransform;
  canvasWidth: number;
  canvasHeight: number;
  isDarkMode: boolean;
  onNavigate: (newX: number, newY: number) => void;
}

export const Minimap: React.FC<MinimapProps> = ({
  nodes,
  clusters = [],
  transform,
  canvasWidth,
  canvasHeight,
  isDarkMode,
  onNavigate
}) => {
  const mapWidth = 200;
  const mapHeight = 140;
  const padding = 200;

  // Compute world bounds
  const bounds = computeBoundingBox(nodes);
  const minX = Math.min(bounds.minX - padding, -transform.x / transform.zoom);
  const minY = Math.min(bounds.minY - padding, -transform.y / transform.zoom);
  const maxX = Math.max(bounds.maxX + padding, (-transform.x + canvasWidth) / transform.zoom);
  const maxY = Math.max(bounds.maxY + padding, (-transform.y + canvasHeight) / transform.zoom);

  const worldWidth = Math.max(maxX - minX, 1000);
  const worldHeight = Math.max(maxY - minY, 700);

  const scaleX = mapWidth / worldWidth;
  const scaleY = mapHeight / worldHeight;
  const scale = Math.min(scaleX, scaleY);

  const toMinimapX = (worldX: number) => (worldX - minX) * scale;
  const toMinimapY = (worldY: number) => (worldY - minY) * scale;

  // Current Viewport in minimap coords
  const viewWorldLeft = -transform.x / transform.zoom;
  const viewWorldTop = -transform.y / transform.zoom;
  const viewWorldWidth = canvasWidth / transform.zoom;
  const viewWorldHeight = canvasHeight / transform.zoom;

  const viewMiniX = toMinimapX(viewWorldLeft);
  const viewMiniY = toMinimapY(viewWorldTop);
  const viewMiniW = viewWorldWidth * scale;
  const viewMiniH = viewWorldHeight * scale;

  const handleMinimapClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    // Convert click position to world position
    const worldClickX = clickX / scale + minX;
    const worldClickY = clickY / scale + minY;

    // Center viewport around clicked point
    const targetX = -(worldClickX * transform.zoom - canvasWidth / 2);
    const targetY = -(worldClickY * transform.zoom - canvasHeight / 2);

    onNavigate(targetX, targetY);
  };

  return (
    <div
      id="canvas-minimap"
      onClick={handleMinimapClick}
      style={{ width: mapWidth, height: mapHeight }}
      className={`relative rounded-xl overflow-hidden border shadow-lg cursor-crosshair transition-all ${
        isDarkMode
          ? 'bg-slate-900/90 border-slate-800 backdrop-blur-md shadow-black/50'
          : 'bg-white/90 border-slate-200 backdrop-blur-md shadow-slate-300/40'
      }`}
      title="Mini Harita: Haritada hızlı gezinmek için tıklayın"
    >
      {/* Clusters */}
      {clusters.map((cl) => {
        const x = toMinimapX(cl.x);
        const y = toMinimapY(cl.y);
        const w = cl.width * scale;
        const h = cl.height * scale;
        return (
          <div
            key={cl.id}
            style={{
              left: Math.max(0, x),
              top: Math.max(0, y),
              width: Math.max(10, w),
              height: Math.max(10, h)
            }}
            className="absolute border border-dashed border-indigo-500/30 bg-indigo-500/5 rounded pointer-events-none"
          />
        );
      })}

      {/* Nodes */}
      {nodes.map((node) => {
        const dim = getNodeDimensions(node);
        const x = toMinimapX(node.x);
        const y = toMinimapY(node.y);
        const w = Math.max(dim.width * scale, 4);
        const h = Math.max(dim.height * scale, 3);
        const color = NODE_COLOR_MAP[node.color]?.accent || '#6366f1';

        return (
          <div
            key={node.id}
            style={{
              left: x,
              top: y,
              width: w,
              height: h,
              backgroundColor: color
            }}
            className="absolute rounded-xs pointer-events-none shadow-xs"
          />
        );
      })}

      {/* Viewport Frame */}
      <div
        style={{
          left: Math.max(0, viewMiniX),
          top: Math.max(0, viewMiniY),
          width: Math.min(viewMiniW, mapWidth),
          height: Math.min(viewMiniH, mapHeight)
        }}
        className={`absolute border-2 rounded pointer-events-none transition-all ${
          isDarkMode
            ? 'border-indigo-400 bg-indigo-500/15 ring-1 ring-indigo-400/30'
            : 'border-indigo-600 bg-indigo-500/10 ring-1 ring-indigo-600/30'
        }`}
      />

      <div className="absolute bottom-1 right-1.5 text-[9px] font-mono tracking-wider font-semibold opacity-40 uppercase pointer-events-none">
        Radarkart
      </div>
    </div>
  );
};
