import { describe, expect, it } from 'vitest';
import {
  findElementsNearAnchors,
  findElementsWithinRadius,
  type SpatialElementLike,
} from '../spatialContext';

const els: SpatialElementLike[] = [
  { id: 'A', type: 'text', x: 0, y: 0, width: 100, height: 40, text: 'Gauss' },
  { id: 'B', type: 'text', x: 120, y: 0, width: 100, height: 40, text: 'near A' }, // gap 20
  { id: 'C', type: 'text', x: 50, y: 60, width: 80, height: 30, text: 'below A' }, // gap 20
  { id: 'D', type: 'text', x: 800, y: 800, width: 100, height: 40, text: 'far' },
  { id: 'shape-empty', type: 'shape', x: 10, y: 10, width: 20, height: 20, label: '' },
  { id: 'shape-label', type: 'shape', x: 200, y: 0, width: 40, height: 40, label: 'note' },
];

describe('findElementsWithinRadius', () => {
  it('includes neighbours inside radius and excludes far ones', () => {
    const hits = findElementsWithinRadius(els[0]!, els, 50);
    const ids = hits.map((h) => h.element_id);
    expect(ids).toContain('B');
    expect(ids).toContain('C');
    expect(ids).not.toContain('D');
    expect(ids).not.toContain('A');
  });

  it('radius 0 returns no spatial elements', () => {
    expect(findElementsWithinRadius(els[0]!, els, 0)).toEqual([]);
  });

  it('records distance and anchor id', () => {
    const hits = findElementsWithinRadius(els[0]!, els, 50);
    const b = hits.find((h) => h.element_id === 'B');
    expect(b?.anchor_element_id).toBe('A');
    expect(b?.distance).toBe(20);
  });

  it('includes shape with label but not empty label', () => {
    const hits = findElementsWithinRadius(els[0]!, els, 120);
    const ids = hits.map((h) => h.element_id);
    expect(ids).toContain('shape-label');
    expect(ids).not.toContain('shape-empty');
  });
});

describe('findElementsNearAnchors', () => {
  it('unions hits from multiple anchors', () => {
    const hits = findElementsNearAnchors([els[0]!, els[3]!], els, 50);
    const ids = new Set(hits.map((h) => h.element_id));
    expect(ids.has('B')).toBe(true);
    expect(ids.has('C')).toBe(true);
    // D is an anchor — not returned as spatial of itself; nothing near D within 50
  });

  it('returns empty when no anchors', () => {
    expect(findElementsNearAnchors([], els, 500)).toEqual([]);
  });
});
