/**
 * Typed hierarchy payloads for Node Section fields (LLM content only — no geometry).
 */

export interface HierarchyNode {
  content: string;
  children: HierarchyNode[];
}

export interface NodeSectionFieldValue {
  kind: 'node_section';
  root: HierarchyNode;
}

export type RawNodeSectionPayload = {
  root: HierarchyNode;
};

export function countHierarchyNodes(root: HierarchyNode): number {
  let n = 1;
  for (const child of root.children) {
    n += countHierarchyNodes(child);
  }
  return n;
}

export function maxHierarchyDepth(root: HierarchyNode, depth = 0): number {
  if (root.children.length === 0) return depth;
  return Math.max(...root.children.map((c) => maxHierarchyDepth(c, depth + 1)));
}

export function formatHierarchyTreePreview(
  root: HierarchyNode,
  indent = '',
  isLast = true,
): string[] {
  const branch = indent === '' ? '' : isLast ? '└── ' : '├── ';
  const lines = [`${indent}${branch}${root.content.replace(/\s+/g, ' ').trim()}`];
  const childIndent = indent === '' ? '' : `${indent}${isLast ? '    ' : '│   '}`;
  root.children.forEach((child, i) => {
    lines.push(
      ...formatHierarchyTreePreview(
        child,
        childIndent,
        i === root.children.length - 1,
      ),
    );
  });
  return lines;
}
