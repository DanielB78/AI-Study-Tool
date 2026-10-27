import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { packCellsChronologically } from '../chronologicalFlowPacker';
import {
  DEFAULT_USER_LAYOUT_SETTINGS,
  normalizeUserLayoutSettings,
  setUserLayoutSettingsForTests,
} from '../userLayoutSettings';
import { calculateChronologicalCellGrid } from '../chronologicalCellLayout';
import { getOutputLayoutConfig } from '../outputLayoutConfig';
import type { MeasuredLayoutItem } from '../types';
import type { CanvasOperation } from '../../operations';

const gaps = { columnGap: 28, rowGap: 18, outerPadding: 12 };

function cells(n: number, w = 100, h = 80) {
  return Array.from({ length: n }, (_, i) => ({
    id: `c${i + 1}`,
    width: w,
    height: h,
  }));
}

describe('packCellsChronologically', () => {
  it('Test A — default down unlimited is a single column', () => {
    const r = packCellsChronologically(
      cells(5),
      DEFAULT_USER_LAYOUT_SETTINGS,
      gaps,
    );
    expect(r.groupCount).toBe(1);
    expect(r.wrapped).toBe(false);
    const xs = new Set(r.cells.map((c) => c.x));
    expect(xs.size).toBe(1);
    for (let i = 1; i < r.cells.length; i++) {
      expect(r.cells[i]!.y).toBeGreaterThan(r.cells[i - 1]!.y);
    }
  });

  it('Test B — downwards limited column height wraps to new columns', () => {
    // Each cell 80 tall + 18 gap → 2 fit in 180, third wraps.
    const r = packCellsChronologically(
      cells(5, 100, 80),
      { chronologicalDirection: 'down', maxColumnHeight: 180, maxRowWidth: null },
      gaps,
    );
    expect(r.wrapped).toBe(true);
    expect(r.wrapReason).toBe('column_height');
    const cols = new Set(r.cells.map((c) => c.column));
    expect(cols.size).toBeGreaterThan(1);
    // Reading order: first items share lower column indices when filled.
    expect(r.cells[0]!.column).toBe(0);
    expect(r.cells[2]!.column).toBeGreaterThan(0);
  });

  it('Test C — downwards both limits create a new group below', () => {
    // Height fits 1 cell (80); width fits 2 columns (100+28+100=228 < 250).
    const r = packCellsChronologically(
      cells(5, 100, 80),
      {
        chronologicalDirection: 'down',
        maxColumnHeight: 90,
        maxRowWidth: 250,
      },
      gaps,
    );
    expect(r.groupCount).toBeGreaterThan(1);
    expect(r.wrapReason).toBe('group_wrap_width');
    const g0 = r.cells.filter((c) => c.groupIndex === 0);
    const g1 = r.cells.filter((c) => c.groupIndex === 1);
    expect(g0.length).toBeGreaterThan(0);
    expect(g1.length).toBeGreaterThan(0);
    expect(Math.min(...g1.map((c) => c.y))).toBeGreaterThan(
      Math.max(...g0.map((c) => c.y + c.height)),
    );
  });

  it('Test D — sideways limited row width wraps to new rows', () => {
    const r = packCellsChronologically(
      cells(5, 100, 80),
      {
        chronologicalDirection: 'sideways',
        maxColumnHeight: null,
        maxRowWidth: 240,
      },
      gaps,
    );
    expect(r.wrapped).toBe(true);
    expect(r.wrapReason).toBe('row_width');
    const rows = new Set(r.cells.map((c) => c.row));
    expect(rows.size).toBeGreaterThan(1);
  });

  it('Test E — sideways both limits create a new group to the right', () => {
    // Width fits 1 cell; height fits 2 rows (80+18+80=178 < 200).
    const r = packCellsChronologically(
      cells(5, 100, 80),
      {
        chronologicalDirection: 'sideways',
        maxRowWidth: 120,
        maxColumnHeight: 200,
      },
      gaps,
    );
    expect(r.groupCount).toBeGreaterThan(1);
    expect(r.wrapReason).toBe('group_wrap_height');
    const g0 = r.cells.filter((c) => c.groupIndex === 0);
    const g1 = r.cells.filter((c) => c.groupIndex === 1);
    expect(Math.min(...g1.map((c) => c.x))).toBeGreaterThan(
      Math.max(...g0.map((c) => c.x + c.width)),
    );
  });

  it('Test F — both limits disabled, both directions', () => {
    const down = packCellsChronologically(
      cells(4),
      { chronologicalDirection: 'down', maxColumnHeight: null, maxRowWidth: null },
      gaps,
    );
    expect(new Set(down.cells.map((c) => c.x)).size).toBe(1);

    const side = packCellsChronologically(
      cells(4),
      {
        chronologicalDirection: 'sideways',
        maxColumnHeight: null,
        maxRowWidth: null,
      },
      gaps,
    );
    expect(new Set(side.cells.map((c) => c.y)).size).toBe(1);
  });

  it('Test G — inactive primary limit does not force wrapping', () => {
    // Downwards + only width limit → still one column.
    const down = packCellsChronologically(
      cells(6, 100, 80),
      {
        chronologicalDirection: 'down',
        maxColumnHeight: null,
        maxRowWidth: 150,
      },
      gaps,
    );
    expect(new Set(down.cells.map((c) => c.column)).size).toBe(1);
    expect(down.wrapped).toBe(false);

    // Sideways + only height limit → still one row.
    const side = packCellsChronologically(
      cells(6, 100, 80),
      {
        chronologicalDirection: 'sideways',
        maxRowWidth: null,
        maxColumnHeight: 100,
      },
      gaps,
    );
    expect(new Set(side.cells.map((c) => c.row)).size).toBe(1);
    expect(side.wrapped).toBe(false);
  });

  it('Test I — oversized item is not clipped', () => {
    const items = [
      { id: 'a', width: 100, height: 50 },
      { id: 'big', width: 100, height: 400 },
      { id: 'c', width: 100, height: 50 },
    ];
    const r = packCellsChronologically(
      items,
      {
        chronologicalDirection: 'down',
        maxColumnHeight: 120,
        maxRowWidth: null,
      },
      gaps,
    );
    const big = r.cells.find((c) => c.id === 'big')!;
    expect(big.height).toBe(400);
  });
});

describe('normalizeUserLayoutSettings', () => {
  it('rejects zero/negative limits as No limit', () => {
    expect(
      normalizeUserLayoutSettings({
        chronologicalDirection: 'sideways',
        maxColumnHeight: 0,
        maxRowWidth: -5,
      }),
    ).toEqual({
      chronologicalDirection: 'sideways',
      maxColumnHeight: null,
      maxRowWidth: null,
    });
  });
});

describe('calculateChronologicalCellGrid with user settings', () => {
  beforeEach(() => {
    setUserLayoutSettingsForTests({ ...DEFAULT_USER_LAYOUT_SETTINGS });
  });
  afterEach(() => {
    setUserLayoutSettingsForTests(null);
  });

  function measured(refs: string[]): MeasuredLayoutItem[] {
    return refs.map((ref) => ({
      ref,
      kind: 'text' as const,
      preferredWidth: 200,
      preferredHeight: 60,
      minWidth: 120,
      minHeight: 40,
      measureHeightAtWidth: () => 60,
    }));
  }

  function ops(refs: string[]): CanvasOperation[] {
    return refs.map((ref) => ({
      type: 'create_text' as const,
      ref,
      text: `Note ${ref}`,
      placement: { mode: 'viewport_default' as const },
    }));
  }

  it('Test H — mixed sizes use measured heights for wrapping', () => {
    const refs = ['a', 'b', 'c'];
    const items: MeasuredLayoutItem[] = [
      {
        ref: 'a',
        kind: 'text',
        preferredWidth: 200,
        preferredHeight: 50,
        minWidth: 100,
        minHeight: 40,
        measureHeightAtWidth: () => 50,
      },
      {
        ref: 'b',
        kind: 'graph',
        preferredWidth: 400,
        preferredHeight: 300,
        minWidth: 360,
        minHeight: 240,
        measureHeightAtWidth: () => 300,
      },
      {
        ref: 'c',
        kind: 'equation',
        preferredWidth: 180,
        preferredHeight: 60,
        minWidth: 100,
        minHeight: 40,
        measureHeightAtWidth: () => 60,
      },
    ];
    const result = calculateChronologicalCellGrid({
      layout: { type: 'chronological_grid', placement: { mode: 'viewport_default' } },
      operations: ops(refs),
      measured: items,
      outputConfig: getOutputLayoutConfig('lesson'),
      userLayoutSettings: {
        chronologicalDirection: 'down',
        maxColumnHeight: 200,
        maxRowWidth: null,
      },
    });
    // graph alone exceeds 200 → forces column wrap after a, then c after graph.
    expect(result.effectiveCellLayout.columns).toBeGreaterThan(1);
    expect(result.grid.items.find((i) => i.ref === 'b')!.height).toBe(300);
  });

  it('default settings keep a single vertical sequence', () => {
    const refs = ['t1', 't2', 't3'];
    const result = calculateChronologicalCellGrid({
      layout: { type: 'chronological_grid', placement: { mode: 'viewport_default' } },
      operations: ops(refs),
      measured: measured(refs),
      outputConfig: getOutputLayoutConfig('lesson'),
      userLayoutSettings: { ...DEFAULT_USER_LAYOUT_SETTINGS },
    });
    expect(result.cellDebug.gridArrangement).toBe('vertical_sequence');
    expect(result.effectiveCellLayout.columns).toBe(1);
    const ys = result.grid.items.map((i) => i.localY);
    expect(ys[1]!).toBeGreaterThan(ys[0]!);
    expect(ys[2]!).toBeGreaterThan(ys[1]!);
  });
});
