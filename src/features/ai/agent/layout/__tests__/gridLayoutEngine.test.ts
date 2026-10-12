import { describe, expect, it } from 'vitest';
import { calculateGridLayout } from '../gridLayoutEngine';
import { placeGridOnCanvas } from '../canvasPlacementEngine';
import { intersectsWithMargin } from '../collision';
import { GRID_LAYOUT_CONFIG } from '../gridConfig';
import type { MeasuredLayoutItem } from '../types';
import type { CanvasElement } from '../../../../../types/canvas';
import { collectCanvasObstacles } from '../obstacles';
import { DEFAULT_CAMERA } from '../../../../../types/canvas';

function item(
  ref: string,
  kind: MeasuredLayoutItem['kind'],
  w: number,
  h: number,
): MeasuredLayoutItem {
  return {
    ref,
    kind,
    preferredWidth: w,
    preferredHeight: h,
    minWidth: Math.min(w, 80),
    minHeight: Math.min(h, 40),
    measureHeightAtWidth: (cw) =>
      kind === 'text' ? Math.max(h, Math.ceil((w * h) / Math.max(cw, 1))) : h,
  };
}

describe('GridLayoutEngine', () => {
  it('Test A — basic 2-column arrangement without overlaps', () => {
    const measured = [
      item('a', 'text', 200, 80),
      item('b', 'graph', 400, 300),
      item('c', 'text', 200, 80),
      item('d', 'equation', 250, 60),
    ];
    const result = calculateGridLayout({
      layout: {
        type: 'grid',
        columns: 2,
        placement: { mode: 'viewport_default' },
        items: [
          { ref: 'a', row: 0, column: 0 },
          { ref: 'b', row: 0, column: 1 },
          { ref: 'c', row: 1, column: 0 },
          { ref: 'd', row: 1, column: 1 },
        ],
      },
      items: measured,
    });

    expect(result.items).toHaveLength(4);
    const byRef = Object.fromEntries(result.items.map((i) => [i.ref, i]));
    expect(byRef.a!.column).toBe(0);
    expect(byRef.b!.column).toBe(1);
    expect(byRef.a!.localY).toBe(byRef.b!.localY);
    expect(byRef.c!.localY).toBeGreaterThan(byRef.a!.localY);

    for (let i = 0; i < result.items.length; i++) {
      for (let j = i + 1; j < result.items.length; j++) {
        expect(
          intersectsWithMargin(
            result.items[i]!.content,
            result.items[j]!.content,
            GRID_LAYOUT_CONFIG.collisionMargin,
          ),
        ).toBe(false);
      }
    }
  });

  it('Test B — small equation beside large graph', () => {
    const result = calculateGridLayout({
      layout: {
        type: 'grid',
        columns: 2,
        placement: { mode: 'viewport_default' },
        items: [
          { ref: 'eq', row: 0, column: 0 },
          { ref: 'g', row: 0, column: 1 },
        ],
      },
      items: [item('eq', 'equation', 180, 50), item('g', 'graph', 600, 400)],
    });
    expect(result.columnWidths[1]!).toBeGreaterThan(result.columnWidths[0]!);
    expect(result.rowHeights[0]!).toBeGreaterThanOrEqual(400);
    const eq = result.items.find((i) => i.ref === 'eq')!;
    const g = result.items.find((i) => i.ref === 'g')!;
    expect(eq.content.x + eq.content.width).toBeLessThanOrEqual(g.content.x);
  });

  it('Test C — long textbox increases row height', () => {
    const short = calculateGridLayout({
      layout: {
        type: 'grid',
        columns: 1,
        placement: { mode: 'viewport_default' },
        items: [
          { ref: 't', row: 0, column: 0 },
          { ref: 'b', row: 1, column: 0 },
        ],
      },
      items: [item('t', 'text', 360, 80), item('b', 'equation', 200, 50)],
    });
    const long = calculateGridLayout({
      layout: {
        type: 'grid',
        columns: 1,
        placement: { mode: 'viewport_default' },
        items: [
          { ref: 't', row: 0, column: 0 },
          { ref: 'b', row: 1, column: 0 },
        ],
      },
      items: [
        {
          ...item('t', 'text', 360, 80),
          measureHeightAtWidth: () => 240,
          preferredHeight: 240,
        },
        item('b', 'equation', 200, 50),
      ],
    });
    expect(long.rowHeights[0]!).toBeGreaterThan(short.rowHeights[0]!);
    const shortB = short.items.find((i) => i.ref === 'b')!;
    const longB = long.items.find((i) => i.ref === 'b')!;
    expect(longB.localY).toBeGreaterThan(shortB.localY);
  });

  it('Test D — column spanning title', () => {
    const result = calculateGridLayout({
      layout: {
        type: 'grid',
        columns: 2,
        placement: { mode: 'viewport_default' },
        items: [
          { ref: 'title', row: 0, column: 0, column_span: 2 },
          { ref: 'a', row: 1, column: 0 },
          { ref: 'b', row: 1, column: 1 },
        ],
      },
      items: [
        item('title', 'text', 500, 60),
        item('a', 'text', 200, 80),
        item('b', 'text', 200, 80),
      ],
    });
    const title = result.items.find((i) => i.ref === 'title')!;
    expect(title.columnSpan).toBe(2);
    expect(title.width).toBeGreaterThan(result.columnWidths[0]!);
    expect(title.width).toBeCloseTo(
      result.columnWidths[0]! +
        result.columnWidths[1]! +
        GRID_LAYOUT_CONFIG.columnGap,
      0,
    );
  });

  it('Test L — oversized content expands columns instead of clipping', () => {
    const result = calculateGridLayout({
      layout: {
        type: 'grid',
        columns: 2,
        placement: { mode: 'viewport_default' },
        items: [{ ref: 'wide', row: 0, column: 0, column_span: 2 }],
      },
      items: [item('wide', 'equation', 900, 80)],
    });
    const wide = result.items.find((i) => i.ref === 'wide')!;
    expect(wide.width).toBeGreaterThanOrEqual(900 - 1);
    expect(result.diagnostics.some((d) => d.includes('Expanded'))).toBe(true);
  });
});

describe('CanvasPlacementEngine', () => {
  function makeGrid() {
    return calculateGridLayout({
      layout: {
        type: 'grid',
        columns: 2,
        placement: { mode: 'viewport_default' },
        items: [
          { ref: 'a', row: 0, column: 0 },
          { ref: 'b', row: 0, column: 1 },
        ],
      },
      items: [item('a', 'text', 200, 80), item('b', 'text', 200, 80)],
    });
  }

  it('Test E — whole grid moves when preferred origin is blocked', () => {
    const grid = makeGrid();
    const blocker = {
      id: 'block',
      type: 'text',
      x: 0,
      y: 0,
      width: 2000,
      height: 2000,
      rotation: 0,
      opacity: 1,
      locked: false,
      zIndex: 1,
      createdAt: 0,
      updatedAt: 0,
      metadata: {},
      text: 'block',
      fontSize: 16,
      fontFamily: 'Arial',
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
    } as unknown as CanvasElement;

    // Force preferred origin near blocker by using absolute placement of the group.
    const obstacles = collectCanvasObstacles([blocker], {
      includeHandwriting: false,
    });
    const placed = placeGridOnCanvas({
      grid,
      placement: { mode: 'absolute', x: 100, y: 100 },
      camera: DEFAULT_CAMERA,
      elements: [blocker],
      obstacles,
      viewport: { width: 1280, height: 720 },
    });

    expect(placed.collidedAtPreferred).toBe(true);
    expect(placed.origin.x !== 100 || placed.origin.y !== 100).toBe(true);

    // Internal arrangement preserved
    const a = placed.worldItems.find((i) => i.ref === 'a')!;
    const b = placed.worldItems.find((i) => i.ref === 'b')!;
    expect(b.worldX - a.worldX).toBeCloseTo(b.localX - a.localX, 5);
    expect(b.worldY - a.worldY).toBeCloseTo(b.localY - a.localY, 5);

    for (const wi of placed.worldItems) {
      expect(
        intersectsWithMargin(
          wi.worldCollision,
          { x: blocker.x, y: blocker.y, width: blocker.width, height: blocker.height },
          0,
        ),
      ).toBe(false);
    }
  });

  it('Test F — multiple obstacles still finds a free spot or fails safely', () => {
    const grid = makeGrid();
    const blockers: CanvasElement[] = [];
    for (let i = 0; i < 8; i++) {
      blockers.push({
        id: `b${i}`,
        type: 'text',
        x: (i % 4) * 300,
        y: Math.floor(i / 4) * 300,
        width: 280,
        height: 280,
        rotation: 0,
        opacity: 1,
        locked: false,
        zIndex: i,
        createdAt: 0,
        updatedAt: 0,
        metadata: {},
        text: 'x',
        fontSize: 16,
        fontFamily: 'Arial',
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
      } as unknown as CanvasElement);
    }
    const obstacles = collectCanvasObstacles(blockers, { includeHandwriting: false });
    const placed = placeGridOnCanvas({
      grid,
      placement: { mode: 'absolute', x: 0, y: 0 },
      camera: DEFAULT_CAMERA,
      elements: blockers,
      obstacles,
      viewport: { width: 1280, height: 720 },
    });
    expect(placed.candidatesTested).toBeGreaterThan(1);
    expect(placed.worldItems).toHaveLength(2);
  });

  it('Test G — handwriting obstacle blocks preferred origin', () => {
    const grid = makeGrid();
    const hwObstacle = {
      id: 'hw_1',
      x: 50,
      y: 50,
      width: 400,
      height: 300,
      source: 'handwriting' as const,
      elementType: 'handwriting_region',
    };
    const placed = placeGridOnCanvas({
      grid,
      placement: { mode: 'absolute', x: 80, y: 80 },
      camera: DEFAULT_CAMERA,
      elements: [],
      obstacles: [hwObstacle],
      viewport: { width: 1280, height: 720 },
    });
    expect(placed.collidedAtPreferred).toBe(true);
    for (const wi of placed.worldItems) {
      expect(intersectsWithMargin(wi.worldCollision, hwObstacle, 0)).toBe(false);
    }
  });

  it('Test J — camera zoom/pan does not change relative world layout', () => {
    const grid = makeGrid();
    const cam1 = { ...DEFAULT_CAMERA, zoom: 1, x: 0, y: 0 };
    const cam2 = { ...DEFAULT_CAMERA, zoom: 2, x: 200, y: -50 };
    const p1 = placeGridOnCanvas({
      grid,
      placement: { mode: 'absolute', x: 100, y: 100 },
      camera: cam1,
      elements: [],
      obstacles: [],
      viewport: { width: 1280, height: 720 },
    });
    const p2 = placeGridOnCanvas({
      grid,
      placement: { mode: 'absolute', x: 100, y: 100 },
      camera: cam2,
      elements: [],
      obstacles: [],
      viewport: { width: 1280, height: 720 },
    });
    expect(p1.origin).toEqual(p2.origin);
    expect(p1.worldItems[0]!.width).toBe(p2.worldItems[0]!.width);
  });

  it('Test P — connectors are not treated as blocking obstacles', () => {
    const connector = {
      id: 'c1',
      type: 'connector',
      x: 0,
      y: 0,
      width: 5000,
      height: 5000,
      rotation: 0,
      opacity: 1,
      locked: false,
      zIndex: 1,
      createdAt: 0,
      updatedAt: 0,
      metadata: {},
      connectorType: 'arrow',
      points: [0, 0, 5000, 5000],
      stroke: '#000',
      strokeWidth: 2,
      startArrow: false,
      endArrow: true,
    } as unknown as CanvasElement;
    const obstacles = collectCanvasObstacles([connector], {
      includeHandwriting: false,
    });
    expect(obstacles).toHaveLength(0);
  });
});
