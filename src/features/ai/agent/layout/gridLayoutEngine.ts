/**
 * GridLayoutEngine — pure local layout from measured items + cell assignments.
 * Does not mutate CanvasDocument.
 */

import type { Rect } from '../../canvas/placement';
import { expandRect } from './collision';
import { GRID_LAYOUT_CONFIG, type GridLayoutConfig } from './gridConfig';
import type {
  GridLayoutResult,
  GridLayoutSpec,
  MeasuredLayoutItem,
  PlacedLayoutItem,
} from './types';

function cellContentWidth(
  column: number,
  columnSpan: number,
  columnWidths: number[],
  gap: number,
): number {
  let w = 0;
  for (let c = column; c < column + columnSpan; c++) {
    w += columnWidths[c] ?? 0;
  }
  w += gap * Math.max(0, columnSpan - 1);
  return w;
}

/**
 * Deterministic sizing:
 * 1. Seed column widths from single-span preferred sizes.
 * 2. Grow columns for spanning items that need more width.
 * 3. Remeasure heights at allocated widths; set row heights to tallest.
 * 4. Assign top-left positions with gaps + outer padding.
 */
export function calculateGridLayout(input: {
  layout: GridLayoutSpec;
  items: MeasuredLayoutItem[];
  config?: GridLayoutConfig;
}): GridLayoutResult {
  const config = input.config ?? GRID_LAYOUT_CONFIG;
  const diagnostics: string[] = [];
  const columns = input.layout.columns;
  const measuredByRef = new Map(input.items.map((i) => [i.ref, i]));

  const placements = input.layout.items.map((item) => ({
    ref: item.ref,
    row: item.row,
    column: item.column,
    columnSpan: item.column_span ?? 1,
  }));

  const columnWidths = Array.from({ length: columns }, () => 0);

  // Pass 1 — single-span preferred widths
  for (const p of placements) {
    const m = measuredByRef.get(p.ref);
    if (!m) continue;
    if (p.columnSpan === 1) {
      columnWidths[p.column] = Math.max(
        columnWidths[p.column]!,
        Math.max(m.preferredWidth, m.minWidth),
      );
    }
  }

  // Ensure every column has a floor even if empty
  for (let c = 0; c < columns; c++) {
    if (columnWidths[c]! < config.minTextWidth) {
      columnWidths[c] = Math.max(columnWidths[c]!, config.minTextWidth);
    }
  }

  // Pass 2 — spanning items expand columns proportionally
  for (const p of placements) {
    const m = measuredByRef.get(p.ref);
    if (!m || p.columnSpan <= 1) continue;
    const needed = Math.max(m.preferredWidth, m.minWidth);
    const current = cellContentWidth(
      p.column,
      p.columnSpan,
      columnWidths,
      config.columnGap,
    );
    if (needed <= current) continue;
    const deficit = needed - current;
    const share = deficit / p.columnSpan;
    for (let c = p.column; c < p.column + p.columnSpan; c++) {
      columnWidths[c] = (columnWidths[c] ?? 0) + share;
    }
    diagnostics.push(
      `Expanded columns ${p.column}–${p.column + p.columnSpan - 1} by ${deficit.toFixed(1)} for "${p.ref}"`,
    );
  }

  // Pass 3 — heights at allocated widths (reflow: width known → remasure height)
  const maxRow = Math.max(0, ...placements.map((p) => p.row));
  const rowHeights = Array.from({ length: maxRow + 1 }, () => 0);
  const sized = new Map<
    string,
    {
      width: number;
      height: number;
      cellW: number;
      initialHeight: number;
      measureWidth: number;
    }
  >();

  // Bounded iterative reflow: column widths are fixed after pass 2; remasure
  // heights once at final widths, then optionally once more if a text column
  // grew from a spanning pass (already reflected in columnWidths).
  const MAX_HEIGHT_PASSES = 2;
  for (let pass = 0; pass < MAX_HEIGHT_PASSES; pass++) {
    for (let r = 0; r < rowHeights.length; r++) rowHeights[r] = 0;
    sized.clear();

    for (const p of placements) {
      const m = measuredByRef.get(p.ref);
      if (!m) continue;
      const cellW = cellContentWidth(
        p.column,
        p.columnSpan,
        columnWidths,
        config.columnGap,
      );
      const width = Math.min(Math.max(m.preferredWidth, m.minWidth), cellW);
      // Text uses full cell width for wrapping so height matches the renderer.
      const measureWidth = m.kind === 'text' ? cellW : width;
      const height = Math.max(m.measureHeightAtWidth(measureWidth), m.minHeight);
      const finalWidth = m.kind === 'text' ? cellW : width;
      sized.set(p.ref, {
        width: finalWidth,
        height,
        cellW,
        initialHeight: m.preferredHeight,
        measureWidth,
      });
      rowHeights[p.row] = Math.max(rowHeights[p.row]!, height);
    }

    // Second pass only needed if any text height changed vs preferred (logged).
    if (pass === 0) {
      let anyChange = false;
      for (const p of placements) {
        const m = measuredByRef.get(p.ref);
        const s = sized.get(p.ref);
        if (!m || !s || m.kind !== 'text') continue;
        if (Math.abs(s.height - m.preferredHeight) > 0.5 || Math.abs(s.width - m.preferredWidth) > 0.5) {
          anyChange = true;
          break;
        }
      }
      if (!anyChange) break;
    }
  }

  // Floors for empty rows
  for (let r = 0; r < rowHeights.length; r++) {
    if (rowHeights[r]! <= 0) rowHeights[r] = config.minEquationHeight;
  }

  // Pass 4 — positions
  const pad = config.outerPadding;
  const colStarts: number[] = [];
  let x = pad;
  for (let c = 0; c < columns; c++) {
    colStarts[c] = x;
    x += columnWidths[c]! + (c < columns - 1 ? config.columnGap : 0);
  }
  const rowStarts: number[] = [];
  let y = pad;
  for (let r = 0; r < rowHeights.length; r++) {
    rowStarts[r] = y;
    y += rowHeights[r]! + (r < rowHeights.length - 1 ? config.rowGap : 0);
  }

  const placed: PlacedLayoutItem[] = [];
  for (const p of placements) {
    const size = sized.get(p.ref);
    const m = measuredByRef.get(p.ref);
    if (!size) continue;
    const cellX = colStarts[p.column]!;
    const cellY = rowStarts[p.row]!;
    const cellW = size.cellW;
    const cellH = rowHeights[p.row]!;
    const localX = cellX + config.cellPadding;
    const localY = cellY + config.cellPadding;
    const content: Rect = {
      x: localX,
      y: localY,
      width: size.width,
      height: size.height,
    };
    const cell: Rect = { x: cellX, y: cellY, width: cellW, height: cellH };
    const collision = expandRect(content, config.collisionMargin);

    let textAutoSize = m?.textAutoSize;
    if (m?.kind === 'text' && textAutoSize) {
      const pad = textAutoSize.padding;
      const rowExpanded = cellH > size.initialHeight + 0.5;
      const reflowChanged =
        Math.abs(size.height - size.initialHeight) > 0.5 ||
        Math.abs(size.width - m.preferredWidth) > 0.5;
      textAutoSize = {
        ...textAutoSize,
        contentWidth: Math.max(size.measureWidth - pad * 2, 40),
        contentHeight: Math.max(0, size.height - pad * 2),
        finalWidth: size.width,
        finalHeight: size.height,
        rowExpanded,
        reflowChanged,
      };
      if (reflowChanged) {
        diagnostics.push(
          `Text "${p.ref}" reflow: ${m.preferredWidth.toFixed(0)}×${size.initialHeight.toFixed(0)} → ${size.width.toFixed(0)}×${size.height.toFixed(0)}`,
        );
      }
      if (rowExpanded) {
        diagnostics.push(
          `Text "${p.ref}" expanded row ${p.row} to ${cellH.toFixed(0)}`,
        );
      }
    }

    placed.push({
      ref: p.ref,
      row: p.row,
      column: p.column,
      columnSpan: p.columnSpan,
      localX,
      localY,
      width: size.width,
      height: size.height,
      cell,
      content,
      collision,
      textAutoSize,
    });
  }

  // Intra-grid collision check (content + margin)
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i]!;
      const b = placed[j]!;
      const overlap =
        a.collision.x < b.collision.x + b.collision.width &&
        a.collision.x + a.collision.width > b.collision.x &&
        a.collision.y < b.collision.y + b.collision.height &&
        a.collision.y + a.collision.height > b.collision.y;
      if (overlap) {
        throw new Error(
          `Grid internal collision between "${a.ref}" and "${b.ref}" — increase gaps or reduce content.`,
        );
      }
    }
  }

  const totalWidth =
    pad * 2 +
    columnWidths.reduce((s, w) => s + w, 0) +
    config.columnGap * Math.max(0, columns - 1);
  const totalHeight =
    pad * 2 +
    rowHeights.reduce((s, h) => s + h, 0) +
    config.rowGap * Math.max(0, rowHeights.length - 1);

  return {
    items: placed,
    columnWidths,
    rowHeights,
    bounds: { x: 0, y: 0, width: totalWidth, height: totalHeight },
    diagnostics,
  };
}
