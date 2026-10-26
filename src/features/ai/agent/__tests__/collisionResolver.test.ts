import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  createEmptyDocument,
  DEFAULT_STYLE,
  type CanvasElement,
  type TextElement,
} from '../../../../types/canvas';
import { useCanvasStore } from '../../../../store/canvasStore';
import { ragSync } from '../../../rag/ragSync';
import { createAiTextElement } from '../../canvas/createAiTextElement';
import {
  dominantCollisionPush,
  resolveCascadeCollisions,
} from '../collisionResolver';
import { executeCanvasOperations } from '../executor';
import { createLiveAgentExecutorTarget } from '../liveExecutor';
import { handleContentFirstResponse } from '../../contentFirst/applyContentFirst';
import { setAiGenerationModeOverride } from '../../contentFirst/generationMode';
import { getElementBounds, rectsIntersect } from '../../../../utils/coordinates';
import { DEFAULT_ELEMENT_GAP } from '../placementService';

function textAt(
  id: string,
  x: number,
  y: number,
  w = 200,
  h = 80,
  text = 'Note',
): TextElement {
  const el = createAiTextElement(text, { x, y }, {
    zIndex: 1,
    style: DEFAULT_STYLE,
    width: w,
  });
  return { ...el, id, width: w, height: h };
}

function reset(elements: CanvasElement[]) {
  useCanvasStore.setState({
    document: { ...createEmptyDocument(), elements },
    style: { ...DEFAULT_STYLE },
    selectedIds: [],
    activeTool: 'select',
    editingTextId: null,
    editingShapeLabelId: null,
    past: [],
    future: [],
    historySuspended: false,
    marquee: null,
    draftPoints: null,
    draftShape: null,
    clipboard: [],
    snapGuides: [],
  });
}

describe('dominantCollisionPush', () => {
  it('pushes below when overlap is mostly horizontal (stacked)', () => {
    const fixed = { x: 0, y: 0, width: 200, height: 100 };
    const movable = { x: 20, y: 60, width: 200, height: 100 };
    const push = dominantCollisionPush(fixed, movable, 10);
    expect(push?.side).toBe('below');
    expect(push?.dy).toBeGreaterThan(0);
    expect(push?.dx).toBe(0);
    expect(movable.y + (push?.dy ?? 0)).toBeGreaterThanOrEqual(
      fixed.y + fixed.height + 10 - 0.1,
    );
  });

  it('pushes above when movable centre is above fixed', () => {
    const fixed = { x: 0, y: 80, width: 200, height: 100 };
    const movable = { x: 20, y: 0, width: 200, height: 100 };
    const push = dominantCollisionPush(fixed, movable, 10);
    expect(push?.side).toBe('above');
    expect(push?.dy).toBeLessThan(0);
  });

  it('pushes right when overlap is mostly vertical (side-by-side)', () => {
    const fixed = { x: 0, y: 0, width: 100, height: 200 };
    const movable = { x: 60, y: 20, width: 100, height: 200 };
    const push = dominantCollisionPush(fixed, movable, 10);
    expect(push?.side).toBe('right');
    expect(push?.dx).toBeGreaterThan(0);
    expect(push?.dy).toBe(0);
  });

  it('pushes left when movable is on the left', () => {
    const fixed = { x: 80, y: 0, width: 100, height: 200 };
    const movable = { x: 0, y: 20, width: 100, height: 200 };
    const push = dominantCollisionPush(fixed, movable, 10);
    expect(push?.side).toBe('left');
    expect(push?.dx).toBeLessThan(0);
  });

  it('returns null when rects do not overlap', () => {
    const push = dominantCollisionPush(
      { x: 0, y: 0, width: 50, height: 50 },
      { x: 100, y: 100, width: 50, height: 50 },
      10,
    );
    expect(push).toBeNull();
  });
});

describe('resolveCascadeCollisions', () => {
  beforeEach(() => {
    vi.spyOn(ragSync, 'indexText').mockImplementation(() => {});
    vi.spyOn(ragSync, 'updateGeometry').mockImplementation(() => {});
    vi.spyOn(ragSync, 'scheduleReconcile').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('moves an existing element down when a generated anchor overlaps from above', () => {
    const generated = textAt('gen', 40, 40, 220, 120);
    const existing = textAt('old', 50, 100, 220, 100);
    reset([generated, existing]);

    const result = resolveCascadeCollisions(
      createLiveAgentExecutorTarget(),
      new Set(['gen']),
      { gap: DEFAULT_ELEMENT_GAP, margin: 0 },
    );

    expect(result.movedIds).toContain('old');
    expect(result.deltas.get('old')?.dy).toBeGreaterThan(0);
    const els = useCanvasStore.getState().document.elements;
    const g = els.find((e) => e.id === 'gen')!;
    const o = els.find((e) => e.id === 'old')!;
    expect(g.y).toBe(40); // anchor stays
    expect(o.y).toBeGreaterThanOrEqual(g.y + g.height + DEFAULT_ELEMENT_GAP - 1);
    expect(rectsIntersect(getElementBounds(g), getElementBounds(o))).toBe(false);
  });

  it('moves an existing element right when collision is mostly from the left', () => {
    const generated = textAt('gen', 40, 40, 100, 200);
    const existing = textAt('old', 100, 60, 100, 200);
    reset([generated, existing]);

    const result = resolveCascadeCollisions(
      createLiveAgentExecutorTarget(),
      new Set(['gen']),
      { gap: 12, margin: 0 },
    );

    expect(result.movedIds).toContain('old');
    expect(result.deltas.get('old')?.dx).toBeGreaterThan(0);
    const els = useCanvasStore.getState().document.elements;
    const g = els.find((e) => e.id === 'gen')!;
    const o = els.find((e) => e.id === 'old')!;
    expect(o.x).toBeGreaterThanOrEqual(g.x + g.width + 12 - 1);
    expect(rectsIntersect(getElementBounds(g), getElementBounds(o))).toBe(false);
  });

  it('cascades: moving B into C also moves C', () => {
    // gen overlaps B; pushing B down overlaps C
    const gen = textAt('gen', 0, 0, 200, 100);
    const b = textAt('B', 10, 50, 200, 80);
    const c = textAt('C', 10, 140, 200, 80);
    reset([gen, b, c]);

    const result = resolveCascadeCollisions(
      createLiveAgentExecutorTarget(),
      new Set(['gen']),
      { gap: 16, margin: 0 },
    );

    expect(result.movedIds).toEqual(expect.arrayContaining(['B', 'C']));
    const els = useCanvasStore.getState().document.elements;
    const G = els.find((e) => e.id === 'gen')!;
    const B = els.find((e) => e.id === 'B')!;
    const C = els.find((e) => e.id === 'C')!;
    expect(rectsIntersect(getElementBounds(G), getElementBounds(B))).toBe(false);
    expect(rectsIntersect(getElementBounds(B), getElementBounds(C))).toBe(false);
    expect(B.y).toBeGreaterThan(G.y);
    expect(C.y).toBeGreaterThan(B.y);
  });

  it('does not move locked elements', () => {
    const gen = textAt('gen', 0, 0, 200, 100);
    const locked = { ...textAt('locked', 10, 50, 200, 80), locked: true };
    reset([gen, locked]);

    const result = resolveCascadeCollisions(
      createLiveAgentExecutorTarget(),
      new Set(['gen']),
      { gap: 10, margin: 0 },
    );

    expect(result.movedIds).not.toContain('locked');
    expect(useCanvasStore.getState().document.elements.find((e) => e.id === 'locked')?.y).toBe(
      50,
    );
  });

  it('does not move anchor elements', () => {
    const a = textAt('a', 0, 0, 150, 80);
    const b = textAt('b', 40, 40, 150, 80);
    reset([a, b]);

    resolveCascadeCollisions(createLiveAgentExecutorTarget(), new Set(['a', 'b']), {
      gap: 10,
      margin: 0,
    });

    const els = useCanvasStore.getState().document.elements;
    expect(els.find((e) => e.id === 'a')).toMatchObject({ x: 0, y: 0 });
    expect(els.find((e) => e.id === 'b')).toMatchObject({ x: 40, y: 40 });
  });

  it('executor create path resolves collisions against existing content', () => {
    const existing = textAt('old', 100, 100, 300, 120);
    reset([existing]);

    executeCanvasOperations(
      {
        output_type: 'lesson',
        operations: [
          {
            type: 'create_text',
            ref: 'n1',
            text: 'Brand new note that lands on the existing box.',
            placement: { mode: 'absolute', x: 110, y: 110 },
          },
        ],
      },
      createLiveAgentExecutorTarget(),
    );

    const els = useCanvasStore.getState().document.elements;
    expect(els).toHaveLength(2);
    const created = els.find((e) => e.id !== 'old')!;
    const old = els.find((e) => e.id === 'old')!;
    expect(rectsIntersect(getElementBounds(created), getElementBounds(old))).toBe(
      false,
    );
  });
});

describe('content-first collision integration', () => {
  beforeEach(() => {
    vi.spyOn(ragSync, 'indexText').mockImplementation(() => {});
    vi.spyOn(ragSync, 'updateGeometry').mockImplementation(() => {});
    vi.spyOn(ragSync, 'scheduleReconcile').mockImplementation(() => {});
    setAiGenerationModeOverride('content_first');
  });
  afterEach(() => {
    setAiGenerationModeOverride(null);
    vi.restoreAllMocks();
  });

  it('add_text below a target does not leave overlaps with neighbours', () => {
    const target = textAt('text_12', 40, 40, 320, 60, 'Target');
    const neighbour = textAt('neigh', 40, 130, 320, 80, 'Neighbour');
    reset([target, neighbour]);

    handleContentFirstResponse(
      `:::json
{"action":"add_text","target_id":"text_12","position":"below"}
:::

## Extra section

A new block of generated content that needs space below the target.
`,
      {
        allowedElementIds: new Set(['text_12', 'neigh']),
        elementTypes: new Map([
          ['text_12', 'text'],
          ['neigh', 'text'],
        ]),
      },
    );

    const els = useCanvasStore.getState().document.elements;
    for (let i = 0; i < els.length; i++) {
      for (let j = i + 1; j < els.length; j++) {
        expect(
          rectsIntersect(getElementBounds(els[i]!), getElementBounds(els[j]!)),
        ).toBe(false);
      }
    }
  });
});
