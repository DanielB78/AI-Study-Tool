import { describe, expect, it } from 'vitest';
import type { Camera, CanvasElement } from '../../../../types/canvas';
import { resolvePlacement, DEFAULT_ELEMENT_GAP } from '../placementService';

const camera: Camera = { x: 0, y: 0, zoom: 1 };
const viewport = { width: 1000, height: 800 };

function textEl(id: string, x: number, y: number, w = 100, h = 50): CanvasElement {
  return {
    id,
    type: 'text',
    x,
    y,
    width: w,
    height: h,
    rotation: 0,
    zIndex: 1,
    opacity: 1,
    locked: false,
    createdAt: 1,
    updatedAt: 1,
    metadata: {},
    text: id,
    fontSize: 16,
    fontFamily: 'sans',
    fontWeight: 'normal',
    fontItalic: false,
    underline: false,
    strikethrough: false,
    color: '#000',
    alignment: 'left',
    lineHeight: 1.3,
    backgroundColor: null,
    padding: 8,
    cornerRadius: 0,
  };
}

describe('resolvePlacement', () => {
  const anchor = textEl('a', 100, 100, 200, 80);
  const note = { width: 160, height: 60 };

  it('viewport_default returns a visible rect', () => {
    const r = resolvePlacement({
      placement: { mode: 'viewport_default' },
      ...note,
      camera,
      elements: [anchor],
      viewport,
    });
    expect(r.width).toBe(160);
    expect(r.height).toBe(60);
    expect(Number.isFinite(r.x)).toBe(true);
  });

  it('right_of places to the right of the anchor', () => {
    const r = resolvePlacement({
      placement: {
        mode: 'relative_to_element',
        anchor_element_id: 'a',
        relation: 'right_of',
      },
      ...note,
      camera,
      elements: [anchor],
      viewport,
    });
    expect(r.x).toBeGreaterThanOrEqual(anchor.x + anchor.width + DEFAULT_ELEMENT_GAP - 1);
  });

  it('left_of places to the left', () => {
    const r = resolvePlacement({
      placement: {
        mode: 'relative_to_element',
        anchor_element_id: 'a',
        relation: 'left_of',
      },
      ...note,
      camera,
      elements: [anchor],
      viewport,
    });
    expect(r.x + r.width).toBeLessThanOrEqual(anchor.x - DEFAULT_ELEMENT_GAP + 1);
  });

  it('below places under the anchor', () => {
    const r = resolvePlacement({
      placement: {
        mode: 'relative_to_element',
        anchor_element_id: 'a',
        relation: 'below',
      },
      ...note,
      camera,
      elements: [anchor],
      viewport,
    });
    expect(r.y).toBeGreaterThanOrEqual(anchor.y + anchor.height + DEFAULT_ELEMENT_GAP - 1);
  });

  it('above places above the anchor', () => {
    const r = resolvePlacement({
      placement: {
        mode: 'relative_to_element',
        anchor_element_id: 'a',
        relation: 'above',
      },
      ...note,
      camera,
      elements: [anchor],
      viewport,
    });
    expect(r.y + r.height).toBeLessThanOrEqual(anchor.y - DEFAULT_ELEMENT_GAP + 1);
  });

  it('near prefers a free location beside the anchor', () => {
    const r = resolvePlacement({
      placement: {
        mode: 'relative_to_element',
        anchor_element_id: 'a',
        relation: 'near',
      },
      ...note,
      camera,
      elements: [anchor],
      viewport,
    });
    expect(r.x).not.toBe(anchor.x);
  });

  it('absolute uses requested coordinates exactly when free', () => {
    const r = resolvePlacement({
      placement: { mode: 'absolute', x: 500, y: 800 },
      ...note,
      camera,
      elements: [],
      viewport,
    });
    expect(r.x).toBe(500);
    expect(r.y).toBe(800);
  });

  it('collision avoidance nudges when preferred overlaps', () => {
    const blocker = textEl('blocker', 348, 100, 160, 60); // sits at right_of preferred
    const r = resolvePlacement({
      placement: {
        mode: 'relative_to_element',
        anchor_element_id: 'a',
        relation: 'right_of',
      },
      ...note,
      camera,
      elements: [anchor, blocker],
      viewport,
    });
    const overlaps =
      r.x < blocker.x + blocker.width &&
      r.x + r.width > blocker.x &&
      r.y < blocker.y + blocker.height &&
      r.y + r.height > blocker.y;
    expect(overlaps).toBe(false);
    expect(r.x).toBeGreaterThan(anchor.x + anchor.width);
  });

  it('camera pan/zoom does not change relative world relationship', () => {
    const zoomed: Camera = { x: -200, y: -100, zoom: 2 };
    const r1 = resolvePlacement({
      placement: {
        mode: 'relative_to_element',
        anchor_element_id: 'a',
        relation: 'right_of',
      },
      ...note,
      camera,
      elements: [anchor],
      viewport,
    });
    const r2 = resolvePlacement({
      placement: {
        mode: 'relative_to_element',
        anchor_element_id: 'a',
        relation: 'right_of',
      },
      ...note,
      camera: zoomed,
      elements: [anchor],
      viewport,
    });
    // Preferred relative offset is world-based; collision clamp may differ slightly
    // with zoom, but base right_of x should still be past the anchor.
    expect(r1.x).toBeGreaterThan(anchor.x + anchor.width);
    expect(r2.x).toBeGreaterThan(anchor.x + anchor.width);
  });
});
