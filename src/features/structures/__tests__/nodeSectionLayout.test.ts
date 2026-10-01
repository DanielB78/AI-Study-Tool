import { describe, expect, it } from 'vitest';
import { createNodeSection } from '../factory';
import type { HierarchyNode } from '../hierarchy';
import { layoutNodeSectionHierarchy } from '../nodeSectionLayout';

const sample: HierarchyNode = {
  content: 'Root',
  children: [
    {
      content: 'A',
      children: [
        { content: 'A1', children: [] },
        { content: 'A2', children: [] },
      ],
    },
    { content: 'B', children: [] },
  ],
};

describe('layoutNodeSectionHierarchy', () => {
  it('TREE_VERTICAL places root above children without sibling overlap', () => {
    const section = createNodeSection({
      layoutMode: 'tree_vertical',
      horizontalSpacing: 20,
      verticalSpacing: 30,
      rootTemplate: {
        label: 'R',
        instruction: 'r',
        width: 100,
        height: 40,
        style: createNodeSection().rootTemplate.style,
      },
      childTemplate: {
        label: 'C',
        instruction: 'c',
        width: 80,
        height: 40,
        style: createNodeSection().childTemplate.style,
      },
    });
    const layout = layoutNodeSectionHierarchy(sample, section);
    expect(layout.nodes).toHaveLength(5);
    expect(layout.edges).toHaveLength(4);
    const root = layout.nodes.find((n) => n.isRoot)!;
    const children = layout.nodes.filter((n) => n.depth === 1);
    expect(children.every((c) => c.y >= root.y + root.height)).toBe(true);
    // siblings at same depth should not overlap horizontally
    const sorted = [...children].sort((a, b) => a.x - b.x);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i]!.x).toBeGreaterThanOrEqual(
        sorted[i - 1]!.x + sorted[i - 1]!.width,
      );
    }
  });

  it('TREE_HORIZONTAL places root left of children', () => {
    const section = createNodeSection({ layoutMode: 'tree_horizontal' });
    const layout = layoutNodeSectionHierarchy(sample, section);
    const root = layout.nodes.find((n) => n.isRoot)!;
    const depth1 = layout.nodes.filter((n) => n.depth === 1);
    expect(depth1.every((c) => c.x >= root.x + root.width)).toBe(true);
  });
});
