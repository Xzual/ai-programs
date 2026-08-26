import { KnowledgeNode } from '../types';

export interface Point {
  x: number;
  y: number;
}

export interface NodeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function getNodeDimensions(node: KnowledgeNode): { width: number; height: number } {
  if (node.width && node.height) {
    return { width: node.width, height: node.height };
  }
  switch (node.type) {
    case 'sticky':
      return { width: 220, height: 180 };
    case 'task':
      return { width: 280, height: 220 };
    case 'resource':
      return { width: 280, height: 200 };
    case 'concept':
    default:
      return { width: 290, height: 210 };
  }
}

export function getBestConnectionPoints(
  fromNode: KnowledgeNode,
  toNode: KnowledgeNode
): {
  from: Point;
  to: Point;
  fromAnchor: 'top' | 'bottom' | 'left' | 'right';
  toAnchor: 'top' | 'bottom' | 'left' | 'right';
} {
  const fromDim = getNodeDimensions(fromNode);
  const toDim = getNodeDimensions(toNode);

  const fromCenter: Point = {
    x: fromNode.x + fromDim.width / 2,
    y: fromNode.y + fromDim.height / 2
  };
  const toCenter: Point = {
    x: toNode.x + toDim.width / 2,
    y: toNode.y + toDim.height / 2
  };

  const dx = toCenter.x - fromCenter.x;
  const dy = toCenter.y - fromCenter.y;

  let fromAnchor: 'top' | 'bottom' | 'left' | 'right';
  let toAnchor: 'top' | 'bottom' | 'left' | 'right';

  if (Math.abs(dx) > Math.abs(dy)) {
    if (dx > 0) {
      fromAnchor = 'right';
      toAnchor = 'left';
    } else {
      fromAnchor = 'left';
      toAnchor = 'right';
    }
  } else {
    if (dy > 0) {
      fromAnchor = 'bottom';
      toAnchor = 'top';
    } else {
      fromAnchor = 'top';
      toAnchor = 'bottom';
    }
  }

  const getAnchorPos = (
    node: KnowledgeNode,
    dim: { width: number; height: number },
    anchor: 'top' | 'bottom' | 'left' | 'right'
  ): Point => {
    switch (anchor) {
      case 'top':
        return { x: node.x + dim.width / 2, y: node.y };
      case 'bottom':
        return { x: node.x + dim.width / 2, y: node.y + dim.height };
      case 'left':
        return { x: node.x, y: node.y + dim.height / 2 };
      case 'right':
        return { x: node.x + dim.width, y: node.y + dim.height / 2 };
    }
  };

  return {
    from: getAnchorPos(fromNode, fromDim, fromAnchor),
    to: getAnchorPos(toNode, toDim, toAnchor),
    fromAnchor,
    toAnchor
  };
}

export function createBezierPath(
  from: Point,
  to: Point,
  fromAnchor: 'top' | 'bottom' | 'left' | 'right',
  toAnchor: 'top' | 'bottom' | 'left' | 'right'
): { pathString: string; midPoint: Point } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  const curvature = Math.min(Math.max(distance * 0.4, 40), 180);

  let cp1: Point = { ...from };
  let cp2: Point = { ...to };

  switch (fromAnchor) {
    case 'right':
      cp1.x += curvature;
      break;
    case 'left':
      cp1.x -= curvature;
      break;
    case 'bottom':
      cp1.y += curvature;
      break;
    case 'top':
      cp1.y -= curvature;
      break;
  }

  switch (toAnchor) {
    case 'right':
      cp2.x += curvature;
      break;
    case 'left':
      cp2.x -= curvature;
      break;
    case 'bottom':
      cp2.y += curvature;
      break;
    case 'top':
      cp2.y -= curvature;
      break;
  }

  const pathString = `M ${from.x} ${from.y} C ${cp1.x} ${cp1.y}, ${cp2.x} ${cp2.y}, ${to.x} ${to.y}`;

  // Approximate mid-point at t = 0.5 for cubic bezier
  const t = 0.5;
  const midX =
    Math.pow(1 - t, 3) * from.x +
    3 * Math.pow(1 - t, 2) * t * cp1.x +
    3 * (1 - t) * Math.pow(t, 2) * cp2.x +
    Math.pow(t, 3) * to.x;
  const midY =
    Math.pow(1 - t, 3) * from.y +
    3 * Math.pow(1 - t, 2) * t * cp1.y +
    3 * (1 - t) * Math.pow(t, 2) * cp2.y +
    Math.pow(t, 3) * to.y;

  return {
    pathString,
    midPoint: { x: midX, y: midY }
  };
}

export function computeBoundingBox(nodes: KnowledgeNode[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
} {
  if (nodes.length === 0) {
    return { minX: 0, minY: 0, maxX: 800, maxY: 600, width: 800, height: 600 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  nodes.forEach((n) => {
    const dim = getNodeDimensions(n);
    if (n.x < minX) minX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.x + dim.width > maxX) maxX = n.x + dim.width;
    if (n.y + dim.height > maxY) maxY = n.y + dim.height;
  });

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(maxX - minX, 100),
    height: Math.max(maxY - minY, 100)
  };
}
