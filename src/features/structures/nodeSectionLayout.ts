/**
 * NodeSectionLayoutService — deterministic BELOW / SIDEWAYS / AROUND layout.
 * Returns relative coordinates for TextElements — never images or raster content.
 */

import type { HierarchyNode } from './hierarchy';
import type {
  NodeChildrenPlacement,
  NoteStructureNodeSection,
} from './types';

export interface LaidOutNode {
  /** Stable key within this layout pass (not a canvas id). */
  layoutKey: string;
  content: string;
  depth: number;
  childIndex: number;
  parentLayoutKey: string | null;
  /** Relative to node-section origin. */
  x: number;
  y: number;
  width: number;
  height: number;
  isRoot: boolean;
}

export interface NodeSectionLayoutResult {
  nodes: LaidOutNode[];
  edges: Array<{ parentKey: string; childKey: string }>;
  bounds: { width: number; height: number };
}

interface MeasuredNode {
  layoutKey: string;
  content: string;
  depth: number;
  childIndex: number;
  parentLayoutKey: string | null;
  isRoot: boolean;
  width: number;
  height: number;
  children: MeasuredNode[];
  subtreeSpan: number;
}

function measureTree(
  node: HierarchyNode,
  section: NoteStructureNodeSection,
  depth: number,
  childIndex: number,
  parentKey: string | null,
  keyPrefix: string,
  placement: NodeChildrenPlacement,
): MeasuredNode {
  const isRoot = depth === 0;
  const template = isRoot ? section.rootTemplate : section.childTemplate;
  const layoutKey = keyPrefix;
  const children = node.children.map((child, i) =>
    measureTree(
      child,
      section,
      depth + 1,
      i,
      layoutKey,
      `${layoutKey}.${i}`,
      placement,
    ),
  );

  const measured: MeasuredNode = {
    layoutKey,
    content: node.content,
    depth,
    childIndex,
    parentLayoutKey: parentKey,
    isRoot,
    width: template.width,
    height: template.height,
    children,
    subtreeSpan: 0,
  };

  if (placement === 'below') {
    if (children.length === 0) {
      measured.subtreeSpan = measured.width;
    } else {
      const gaps = (children.length - 1) * section.horizontalSpacing;
      measured.subtreeSpan = Math.max(
        measured.width,
        children.reduce((s, c) => s + c.subtreeSpan, 0) + gaps,
      );
    }
  } else if (placement === 'sideways') {
    if (children.length === 0) {
      measured.subtreeSpan = measured.height;
    } else {
      const gaps = (children.length - 1) * section.verticalSpacing;
      measured.subtreeSpan = Math.max(
        measured.height,
        children.reduce((s, c) => s + c.subtreeSpan, 0) + gaps,
      );
    }
  } else {
    // around: span unused for radial; keep size for bounds later
    measured.subtreeSpan = Math.max(measured.width, measured.height);
  }

  return measured;
}

function placeBelow(
  node: MeasuredNode,
  left: number,
  top: number,
  hGap: number,
  vGap: number,
  out: LaidOutNode[],
  edges: NodeSectionLayoutResult['edges'],
): void {
  const x = left + (node.subtreeSpan - node.width) / 2;
  const y = top;
  out.push({
    layoutKey: node.layoutKey,
    content: node.content,
    depth: node.depth,
    childIndex: node.childIndex,
    parentLayoutKey: node.parentLayoutKey,
    x,
    y,
    width: node.width,
    height: node.height,
    isRoot: node.isRoot,
  });

  if (node.children.length === 0) return;

  const totalChildren = node.children.reduce((s, c) => s + c.subtreeSpan, 0);
  const gaps = (node.children.length - 1) * hGap;
  let cursor = left + (node.subtreeSpan - (totalChildren + gaps)) / 2;
  const childTop = top + node.height + vGap;

  for (const child of node.children) {
    edges.push({ parentKey: node.layoutKey, childKey: child.layoutKey });
    placeBelow(child, cursor, childTop, hGap, vGap, out, edges);
    cursor += child.subtreeSpan + hGap;
  }
}

function placeSideways(
  node: MeasuredNode,
  left: number,
  top: number,
  hGap: number,
  vGap: number,
  out: LaidOutNode[],
  edges: NodeSectionLayoutResult['edges'],
): void {
  const x = left;
  const y = top + (node.subtreeSpan - node.height) / 2;
  out.push({
    layoutKey: node.layoutKey,
    content: node.content,
    depth: node.depth,
    childIndex: node.childIndex,
    parentLayoutKey: node.parentLayoutKey,
    x,
    y,
    width: node.width,
    height: node.height,
    isRoot: node.isRoot,
  });

  if (node.children.length === 0) return;

  const totalChildren = node.children.reduce((s, c) => s + c.subtreeSpan, 0);
  const gaps = (node.children.length - 1) * vGap;
  let cursor = top + (node.subtreeSpan - (totalChildren + gaps)) / 2;
  const childLeft = left + node.width + hGap;

  for (const child of node.children) {
    edges.push({ parentKey: node.layoutKey, childKey: child.layoutKey });
    placeSideways(child, childLeft, cursor, hGap, vGap, out, edges);
    cursor += child.subtreeSpan + vGap;
  }
}

/**
 * Deterministic radial layout: children evenly spaced around parent.
 * Deeper levels expand outward along the same angular bias.
 */
function placeAround(
  node: MeasuredNode,
  cx: number,
  cy: number,
  section: NoteStructureNodeSection,
  out: LaidOutNode[],
  edges: NodeSectionLayoutResult['edges'],
  parentAngle: number | null,
): void {
  const x = cx - node.width / 2;
  const y = cy - node.height / 2;
  out.push({
    layoutKey: node.layoutKey,
    content: node.content,
    depth: node.depth,
    childIndex: node.childIndex,
    parentLayoutKey: node.parentLayoutKey,
    x,
    y,
    width: node.width,
    height: node.height,
    isRoot: node.isRoot,
  });

  if (node.children.length === 0) return;

  const n = node.children.length;
  const baseRadius =
    Math.max(node.width, node.height) / 2 +
    Math.max(section.childTemplate.width, section.childTemplate.height) / 2 +
    Math.max(section.horizontalSpacing, section.verticalSpacing);

  // Evenly distribute; if parent has an angle, bias the fan outward from that direction.
  const spread = n === 1 ? 0 : (Math.PI * 2) / n;
  const startAngle =
    parentAngle != null ? parentAngle - ((n - 1) * spread) / 2 : -Math.PI / 2;

  for (let i = 0; i < n; i++) {
    const child = node.children[i]!;
    const angle = startAngle + i * spread;
    const childCx = cx + Math.cos(angle) * baseRadius;
    const childCy = cy + Math.sin(angle) * baseRadius;
    edges.push({ parentKey: node.layoutKey, childKey: child.layoutKey });
    placeAround(child, childCx, childCy, section, out, edges, angle);
  }
}

function normalizeAroundPositions(nodes: LaidOutNode[]): void {
  if (nodes.length === 0) return;
  let minX = Infinity;
  let minY = Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
  }
  const pad = 8;
  for (const n of nodes) {
    n.x = Math.round(n.x - minX + pad);
    n.y = Math.round(n.y - minY + pad);
  }
}

/**
 * Layout a validated hierarchy relative to the Node Section origin (0,0).
 */
export function layoutNodeSectionHierarchy(
  root: HierarchyNode,
  section: NoteStructureNodeSection,
): NodeSectionLayoutResult {
  const placement = section.childrenPlacement;
  const measured = measureTree(root, section, 0, 0, null, 'n0', placement);
  const nodes: LaidOutNode[] = [];
  const edges: NodeSectionLayoutResult['edges'] = [];

  if (placement === 'below') {
    placeBelow(
      measured,
      0,
      0,
      section.horizontalSpacing,
      section.verticalSpacing,
      nodes,
      edges,
    );
  } else if (placement === 'sideways') {
    placeSideways(
      measured,
      0,
      0,
      section.horizontalSpacing,
      section.verticalSpacing,
      nodes,
      edges,
    );
  } else {
    placeAround(measured, 0, 0, section, nodes, edges, null);
    normalizeAroundPositions(nodes);
  }

  let maxX = 0;
  let maxY = 0;
  for (const n of nodes) {
    maxX = Math.max(maxX, n.x + n.width);
    maxY = Math.max(maxY, n.y + n.height);
  }

  return {
    nodes,
    edges,
    bounds: {
      width: Math.max(section.relativeWidth, Math.ceil(maxX)),
      height: Math.max(section.relativeHeight, Math.ceil(maxY)),
    },
  };
}

/** Dummy hierarchy for structure-editor preview (no LLM). Placement-aware fan-out. */
export function previewHierarchyForSection(
  placement: NodeChildrenPlacement,
): HierarchyNode {
  if (placement === 'around') {
    return {
      content: 'Main Topic',
      children: [
        { content: 'Child A', children: [] },
        { content: 'Child B', children: [] },
        { content: 'Child C', children: [] },
        { content: 'Child D', children: [] },
      ],
    };
  }
  if (placement === 'sideways') {
    return {
      content: 'Main Topic',
      children: [
        {
          content: 'Child A',
          children: [{ content: 'Child A1', children: [] }],
        },
        { content: 'Child B', children: [] },
      ],
    };
  }
  return {
    content: 'Main Topic',
    children: [
      {
        content: 'Child A',
        children: [{ content: 'Child A1', children: [] }],
      },
      { content: 'Child B', children: [] },
    ],
  };
}
