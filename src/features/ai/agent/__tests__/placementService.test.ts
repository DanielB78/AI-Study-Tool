import { describe, expect, it } from 'vitest';
import type { Camera, CanvasElement } from '../../../../types/canvas';
import { getElementBounds, rectsIntersect } from '../../../../utils/coordinates';
import {
  resolvePlacement,
  resolveRelativePlacement,
  DEFAULT_ELEMENT_GAP,
} from '../placementService';

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

  it('blocked preferred orientation falls back to another around the anchor', () => {
    // Occupies exact below slot.
    const blocker = textEl(
      'blocker',
      100,
      100 + 80 + DEFAULT_ELEMENT_GAP,
      160,
      60,
    );
    const r = resolveRelativePlacement({
      anchor: getElementBounds(anchor),
      ...note,
      relation: 'below',
      elements: [anchor, blocker],
      gap: DEFAULT_ELEMENT_GAP,
    });
    // Should land right_of (first fallback) instead of overlapping blocker.
    expect(r.x).toBeGreaterThanOrEqual(anchor.x + anchor.width + DEFAULT_ELEMENT_GAP - 1);
    expect(r.y).toBe(anchor.y);
    expect(rectsIntersect(r, getElementBounds(blocker))).toBe(false);
  });

  it('when all orientations are blocked, places away without overlapping', () => {
    const blockers = [
      textEl('b_below', 100, 100 + 80 + DEFAULT_ELEMENT_GAP, 160, 60),
      textEl('b_right', 100 + 200 + DEFAULT_ELEMENT_GAP, 100, 160, 60),
      textEl('b_left', 100 - 160 - DEFAULT_ELEMENT_GAP, 100, 160, 60),
      textEl('b_above', 100, 100 - 60 - DEFAULT_ELEMENT_GAP, 160, 60),
    ];
    const r = resolveRelativePlacement({
      anchor: getElementBounds(anchor),
      ...note,
      relation: 'below',
      elements: [anchor, ...blockers],
      gap: DEFAULT_ELEMENT_GAP,
    });
    for (const el of [anchor, ...blockers]) {
      expect(rectsIntersect(r, getElementBounds(el))).toBe(false);
    }
  });

  it('absolute collision relocates the new note, not the blocker', () => {
    const blocker = textEl('blocker', 500, 800, 160, 60);
    const r = resolvePlacement({
      placement: { mode: 'absolute', x: 500, y: 800 },
      ...note,
      camera,
      elements: [blocker],
      viewport,
    });
    expect(rectsIntersect(r, getElementBounds(blocker))).toBe(false);
    expect(r.x !== 500 || r.y !== 800).toBe(true);
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
    expect(r1.x).toBeGreaterThan(anchor.x + anchor.width);
    expect(r2.x).toBeGreaterThan(anchor.x + anchor.width);
    expect(r1.x).toBe(r2.x);
    expect(r1.y).toBe(r2.y);
  });
});
