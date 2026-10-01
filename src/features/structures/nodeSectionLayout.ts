/**
 * NodeSectionLayoutService — deterministic tree layout (no LLM coordinates).
 */

import type { HierarchyNode } from './hierarchy';
import type {
  NodeSectionLayoutMode,
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
  /** Parent layoutKey → child layoutKeys */
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
  /** Subtree span along the secondary axis (width for vertical, height for horizontal). */
  subtreeSpan: number;
}

function measureTree(
  node: HierarchyNode,
  section: NoteStructureNodeSection,
  depth: number,
  childIndex: number,
  parentKey: string | null,
  keyPrefix: string,
): MeasuredNode {
  const isRoot = depth === 0;
  const template = isRoot ? section.rootTemplate : section.childTemplate;
  const layoutKey = keyPrefix;
  const children = node.children.map((child, i) =>
    measureTree(child, section, depth + 1, i, layoutKey, `${layoutKey}.${i}`),
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

  if (section.layoutMode === 'tree_vertical') {
    if (children.length === 0) {
      measured.subtreeSpan = measured.width;
    } else {
      const gaps = (children.length - 1) * section.horizontalSpacing;
      measured.subtreeSpan = Math.max(
        measured.width,
        children.reduce((s, c) => s + c.subtreeSpan, 0) + gaps,
      );
    }
  } else {
    if (children.length === 0) {
      measured.subtreeSpan = measured.height;
    } else {
      const gaps = (children.length - 1) * section.verticalSpacing;
      measured.subtreeSpan = Math.max(
        measured.height,
        children.reduce((s, c) => s + c.subtreeSpan, 0) + gaps,
      );
    }
  }

  return measured;
}

function placeVertical(
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
    placeVertical(child, cursor, childTop, hGap, vGap, out, edges);
    cursor += child.subtreeSpan + hGap;
  }
}

function placeHorizontal(
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
    placeHorizontal(child, childLeft, cursor, hGap, vGap, out, edges);
    cursor += child.subtreeSpan + vGap;
  }
}

/**
 * Layout a validated hierarchy relative to the Node Section origin (0,0).
 */
export function layoutNodeSectionHierarchy(
  root: HierarchyNode,
  section: NoteStructureNodeSection,
): NodeSectionLayoutResult {
  const measured = measureTree(root, section, 0, 0, null, 'n0');
  const nodes: LaidOutNode[] = [];
  const edges: NodeSectionLayoutResult['edges'] = [];

  if (section.layoutMode === 'tree_vertical') {
    placeVertical(
      measured,
      0,
      0,
      section.horizontalSpacing,
      section.verticalSpacing,
      nodes,
      edges,
    );
  } else {
    placeHorizontal(
      measured,
      0,
      0,
      section.horizontalSpacing,
      section.verticalSpacing,
      nodes,
      edges,
    );
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

/** Dummy hierarchy for structure-editor preview (no LLM). */
export function previewHierarchyForSection(
  _layoutMode: NodeSectionLayoutMode,
): HierarchyNode {
  return {
    content: 'Root Example',
    children: [
      {
        content: 'Child Example',
        children: [{ content: 'Child Example', children: [] }],
      },
      { content: 'Child Example', children: [] },
    ],
  };
}
