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

const aroundSample: HierarchyNode = {
  content: 'Root',
  children: [
    { content: 'A', children: [] },
    { content: 'B', children: [] },
    { content: 'C', children: [] },
    { content: 'D', children: [] },
  ],
};

describe('layoutNodeSectionHierarchy', () => {
  it('BELOW places root above children without sibling overlap', () => {
    const section = createNodeSection({
      childrenPlacement: 'below',
      horizontalSpacing: 20,
      verticalSpacing: 30,
    });
    const layout = layoutNodeSectionHierarchy(sample, section);
    expect(layout.nodes).toHaveLength(5);
    expect(layout.edges).toHaveLength(4);
    const root = layout.nodes.find((n) => n.isRoot)!;
    const children = layout.nodes.filter((n) => n.depth === 1);
    expect(children.every((c) => c.y >= root.y + root.height)).toBe(true);
    const sorted = [...children].sort((a, b) => a.x - b.x);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i]!.x).toBeGreaterThanOrEqual(
        sorted[i - 1]!.x + sorted[i - 1]!.width,
      );
    }
  });

  it('SIDEWAYS places root left of children', () => {
    const section = createNodeSection({ childrenPlacement: 'sideways' });
    const layout = layoutNodeSectionHierarchy(sample, section);
    const root = layout.nodes.find((n) => n.isRoot)!;
    const depth1 = layout.nodes.filter((n) => n.depth === 1);
    expect(depth1.every((c) => c.x >= root.x + root.width)).toBe(true);
  });

  it('AROUND distributes children at distinct positions and is deterministic', () => {
    const section = createNodeSection({ childrenPlacement: 'around' });
    const a = layoutNodeSectionHierarchy(aroundSample, section);
    const b = layoutNodeSectionHierarchy(aroundSample, section);
    expect(a.nodes).toHaveLength(5);
    expect(a.edges).toHaveLength(4);
    expect(JSON.stringify(a.nodes)).toBe(JSON.stringify(b.nodes));
    const children = a.nodes.filter((n) => n.depth === 1);
    const keys = new Set(children.map((c) => `${c.x},${c.y}`));
    expect(keys.size).toBe(children.length);
  });
});
