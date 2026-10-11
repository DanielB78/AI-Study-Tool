import { describe, expect, it } from 'vitest';
import { maxColumnsForObjectCount, reflowGridToMaxColumns } from '../gridReflow';
import type { GridLayoutSpec } from '../../operations';

describe('maxColumnsForObjectCount', () => {
  it.each([
    [1, 1],
    [2, 2],
    [3, 2],
    [4, 2],
    [5, 3],
    [7, 3],
    [9, 3],
    [10, 4],
    [20, 4],
  ] as const)('N=%i → max columns %i', (n, expected) => {
    expect(maxColumnsForObjectCount(n)).toBe(expected);
  });
});

describe('reflowGridToMaxColumns', () => {
  it('wraps a single-row seven-item layout into 3 columns', () => {
    const layout: GridLayoutSpec = {
      type: 'grid',
      columns: 7,
      placement: { mode: 'viewport_default' },
      items: Array.from({ length: 7 }, (_, i) => ({
        ref: `i${i}`,
        row: 0,
        column: i,
      })),
    };
    const result = reflowGridToMaxColumns(layout, 3);
    expect(result.wrapped).toBe(true);
    expect(result.finalColumns).toBe(3);
    expect(result.layout.items).toHaveLength(7);
    expect(result.layout.items.every((it) => it.column + (it.column_span ?? 1) <= 3)).toBe(
      true,
    );
    // Reading order preserved: first three on row 0
    expect(result.layout.items[0]).toMatchObject({ ref: 'i0', row: 0, column: 0 });
    expect(result.layout.items[2]).toMatchObject({ ref: 'i2', row: 0, column: 2 });
    expect(result.layout.items[3]).toMatchObject({ ref: 'i3', row: 1, column: 0 });
    expect(result.layout.items[6]).toMatchObject({ ref: 'i6', row: 2, column: 0 });
  });

  it('preserves full-width title spans after reflow', () => {
    const layout: GridLayoutSpec = {
      type: 'grid',
      columns: 4,
      placement: { mode: 'viewport_default' },
      items: [
        { ref: 'title', row: 0, column: 0, column_span: 4 },
        { ref: 'a', row: 1, column: 0 },
        { ref: 'b', row: 1, column: 1 },
        { ref: 'c', row: 1, column: 2 },
        { ref: 'd', row: 1, column: 3 },
      ],
    };
    const result = reflowGridToMaxColumns(layout, 2);
    expect(result.finalColumns).toBe(2);
    const title = result.layout.items.find((i) => i.ref === 'title')!;
    expect(title.column_span).toBe(2);
    expect(title.column).toBe(0);
  });

  it('does not wrap when already within max', () => {
    const layout: GridLayoutSpec = {
      type: 'grid',
      columns: 2,
      placement: { mode: 'viewport_default' },
      items: [
        { ref: 'a', row: 0, column: 0 },
        { ref: 'b', row: 0, column: 1 },
      ],
    };
    const result = reflowGridToMaxColumns(layout, 2);
    expect(result.wrapped).toBe(false);
    expect(result.layout).toEqual(layout);
  });
});
