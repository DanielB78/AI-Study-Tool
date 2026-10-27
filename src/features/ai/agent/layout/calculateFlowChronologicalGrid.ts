/**
 * Chronological grid calculation driven by user layout settings.
 * Sizes each layout_cell, packs with the flow packer, emits PlacedLayoutItems.
 */

import type { Rect } from '../../canvas/placement';
import type { LayoutRole } from '../operations';
import { expandRect } from './collision';
import { GRID_LAYOUT_CONFIG, type GridLayoutConfig } from './gridConfig';
import {
  getOutputLayoutConfig,
  type OutputLayoutConfig,
} from './outputLayoutConfig';
import { packCellsChronologically } from './chronologicalFlowPacker';
import {
  DEFAULT_USER_LAYOUT_SETTINGS,
  type UserLayoutSettings,
} from './userLayoutSettings';
import type {
  CellMember,
  ChronologicalGridCalcResult,
  GroupCellsResult,
  LayoutCell,
} from './chronologicalCellLayout';
import type {
  ChronologicalCellDebug,
  GridLayoutResult,
  MeasuredLayoutItem,
  PlacedLayoutItem,
} from './types';

export class FlowChronologicalLayoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FlowChronologicalLayoutError';
  }
}

type SizedMember = {
  ref: string;
  width: number;
  height: number;
  measureWidth: number;
  initialHeight: number;
  kind: MeasuredLayoutItem['kind'];
  layoutRole?: LayoutRole;
  textAutoSize?: MeasuredLayoutItem['textAutoSize'];
};

type CellInnerArrangement =
  | 'vertical_stack'
  | 'horizontal_pair'
  | 'single'
  | 'vertical_fallback';

function sizeVerticalStack(
  members: readonly CellMember[],
  measuredByRef: Map<string, MeasuredLayoutItem>,
  innerW: number,
  cellStackGap: number,
  cellPadding: number,
): { sized: SizedMember[]; contentHeight: number; contentWidth: number } {
  const sized: SizedMember[] = [];
  let sumH = 0;
  let maxW = 0;
  for (let i = 0; i < members.length; i++) {
    const ref = members[i]!.ref;
    const m = measuredByRef.get(ref)!;
    const width = Math.min(Math.max(m.preferredWidth, m.minWidth), innerW);
    const measureWidth = m.kind === 'text' ? innerW : width;
    const height = Math.max(m.measureHeightAtWidth(measureWidth), m.minHeight);
    const finalWidth = m.kind === 'text' ? innerW : width;
    sized.push({
      ref,
      width: finalWidth,
      height,
      measureWidth,
      initialHeight: m.preferredHeight,
      kind: m.kind,
      layoutRole: members[i]!.layoutRole,
      textAutoSize: m.textAutoSize,
    });
    maxW = Math.max(maxW, finalWidth);
    sumH += height;
    if (i > 0) sumH += cellStackGap;
  }
  return {
    sized,
    contentHeight: sumH + cellPadding * 2,
    contentWidth: maxW + cellPadding * 2,
  };
}

function sizeCellPreferred(
  cell: LayoutCell,
  measuredByRef: Map<string, MeasuredLayoutItem>,
  contentWidthBudget: number,
  outputConfig: OutputLayoutConfig,
  config: GridLayoutConfig,
  direction: UserLayoutSettings['chronologicalDirection'],
): {
  sized: SizedMember[];
  contentWidth: number;
  contentHeight: number;
  arrangement: CellInnerArrangement;
} {
  const innerW = Math.max(40, contentWidthBudget - config.cellPadding * 2);

  if (direction === 'sideways' && cell.members.length === 1) {
    const m = measuredByRef.get(cell.members[0]!.ref)!;
    const width = Math.min(
      Math.max(m.preferredWidth, m.minWidth),
      outputConfig.maxPairWidth,
    );
    const height = Math.max(m.measureHeightAtWidth(width), m.minHeight);
    return {
      sized: [
        {
          ref: cell.members[0]!.ref,
          width,
          height,
          measureWidth: width,
          initialHeight: m.preferredHeight,
          kind: m.kind,
          layoutRole: cell.members[0]!.layoutRole,
          textAutoSize: m.textAutoSize,
        },
      ],
      contentWidth: width + config.cellPadding * 2,
      contentHeight: height + config.cellPadding * 2,
      arrangement: 'single',
    };
  }

  const stack = sizeVerticalStack(
    cell.members,
    measuredByRef,
    innerW,
    config.cellStackGap,
    config.cellPadding,
  );
  return {
    sized: stack.sized,
    contentWidth: Math.max(stack.contentWidth, config.minTextWidth),
    contentHeight: stack.contentHeight,
    arrangement: cell.members.length === 1 ? 'single' : 'vertical_stack',
  };
}

function layoutLabels(settings: UserLayoutSettings): {
  layout: string;
  cellArrangement: string;
} {
  const dir =
    settings.chronologicalDirection === 'sideways' ? 'Sideways' : 'Downwards';
  const h =
    settings.maxColumnHeight == null
      ? '∞ height'
      : `H≤${Math.round(settings.maxColumnHeight)}`;
  const w =
    settings.maxRowWidth == null
      ? '∞ width'
      : `W≤${Math.round(settings.maxRowWidth)}`;
  return {
    layout: `${dir} (${h}, ${w})`,
    cellArrangement: 'Vertical stack (associated cells)',
  };
}

/**
 * Pack already-grouped cells using user layout settings.
 */
export function calculateFlowChronologicalGrid(input: {
  grouped: GroupCellsResult;
  measured: MeasuredLayoutItem[];
  config?: GridLayoutConfig;
  outputConfig?: OutputLayoutConfig;
  userLayoutSettings?: UserLayoutSettings;
}): ChronologicalGridCalcResult {
  const config = input.config ?? GRID_LAYOUT_CONFIG;
  const outputConfig = input.outputConfig ?? getOutputLayoutConfig('lesson');
  const settings = input.userLayoutSettings ?? DEFAULT_USER_LAYOUT_SETTINGS;
  const diagnostics: string[] = [];
  const labels = layoutLabels(settings);
  const grouped = input.grouped;

  diagnostics.push(...grouped.diagnostics);
  diagnostics.push(
    `Output preset: ${outputConfig.labels.outputType} — ${labels.layout}; user packing; max ${outputConfig.maxObjectsPerCell}/cell.`,
  );

  const measuredByRef = new Map(input.measured.map((m) => [m.ref, m]));
  for (const ref of grouped.objectOrder) {
    if (!measuredByRef.has(ref)) {
      throw new FlowChronologicalLayoutError(
        `Missing measurement for layout ref "${ref}".`,
      );
    }
  }

  // Downwards stacks share one content column. Prefer the default text width
  // (not the soft maxPairWidth cap) so equations centred in the column stay
  // near the reading column; still respect an explicit maxRowWidth limit.
  let contentBudget =
    settings.chronologicalDirection === 'down'
      ? Math.min(config.defaultTextWidth, outputConfig.maxPairWidth)
      : outputConfig.maxPairWidth;
  if (
    settings.chronologicalDirection === 'down' &&
    settings.maxRowWidth != null
  ) {
    contentBudget = Math.min(contentBudget, settings.maxRowWidth);
  }
  contentBudget = Math.max(config.minTextWidth, contentBudget);

  type Prepared = {
    cell: LayoutCell;
    sized: SizedMember[];
    contentWidth: number;
    contentHeight: number;
    arrangement: CellInnerArrangement;
    stepIndex: number | null;
  };

  let stepCounter = 0;
  const prepared: Prepared[] = [];
  for (const cell of grouped.cells) {
    const sized = sizeCellPreferred(
      cell,
      measuredByRef,
      contentBudget,
      outputConfig,
      config,
      settings.chronologicalDirection,
    );

    const roles = cell.members.map((m) => m.layoutRole);
    let stepIndex: number | null = null;
    if (outputConfig.outputType === 'step_by_step') {
      const skipNumber =
        roles.every(
          (r) =>
            r === 'introduction' ||
            r === 'final_result' ||
            r === 'verification' ||
            r === undefined,
        ) &&
        (roles.includes('introduction') ||
          roles.includes('final_result') ||
          roles.includes('verification'));
      const looksLikeStep =
        roles.includes('mathematical_step') ||
        roles.includes('explanation') ||
        roles.includes('given_information') ||
        roles.includes('visualisation') ||
        (roles.every((r) => r === undefined) && cell.members.length >= 1);
      if (
        !skipNumber &&
        looksLikeStep &&
        !roles.includes('introduction') &&
        !roles.includes('final_result')
      ) {
        stepCounter += 1;
        stepIndex = stepCounter;
      }
    }

    prepared.push({
      cell,
      sized: sized.sized,
      contentWidth: sized.contentWidth,
      contentHeight: sized.contentHeight,
      arrangement: sized.arrangement,
      stepIndex,
    });
  }

  const pack = packCellsChronologically(
    prepared.map((p) => ({
      id: p.cell.cellId,
      width: p.contentWidth,
      height: p.contentHeight,
    })),
    settings,
    {
      columnGap: config.columnGap,
      rowGap: Math.max(config.rowGap, 18),
      outerPadding: config.outerPadding,
    },
  );
  diagnostics.push(...pack.diagnostics);

  const byId = new Map(prepared.map((p) => [p.cell.cellId, p]));
  const placedItems: PlacedLayoutItem[] = [];
  const cellDebugEntries: ChronologicalCellDebug['cells'] = [];

  for (const packed of pack.cells) {
    const prep = byId.get(packed.id);
    if (!prep) continue;
    const cellX = packed.x;
    const cellY = packed.y;
    const cellW = packed.width;
    const cellH = packed.height;
    const cellRect: Rect = { x: cellX, y: cellY, width: cellW, height: cellH };

    cellDebugEntries.push({
      cellId: prep.cell.cellId,
      originalCellId: prep.cell.originalCellId,
      refs: prep.cell.members.map((m) => m.ref),
      objectTypes: prep.sized.map((m) => m.kind),
      layoutRoles: prep.sized.map((m) => m.layoutRole ?? null),
      arrangement: prep.arrangement,
      stepIndex: prep.stepIndex,
      row: packed.row,
      column: packed.column,
      columnSpan: 1,
      width: cellW,
      height: cellH,
      autoSplit: prep.cell.autoSplit,
    });

    const innerContentW = Math.max(40, cellW - config.cellPadding * 2);
    let cursorY = cellY + config.cellPadding;
    for (const mem of prep.sized) {
      const localX =
        mem.kind === 'equation'
          ? cellX +
            config.cellPadding +
            Math.max(0, (innerContentW - mem.width) / 2)
          : cellX + config.cellPadding;
      const localY = cursorY;
      const content: Rect = {
        x: localX,
        y: localY,
        width: mem.width,
        height: mem.height,
      };
      const collision = expandRect(content, config.collisionMargin);
      let textAutoSize = mem.textAutoSize;
      if (mem.kind === 'text' && textAutoSize) {
        const tpad = textAutoSize.padding;
        textAutoSize = {
          ...textAutoSize,
          contentWidth: Math.max(mem.measureWidth - tpad * 2, 40),
          contentHeight: Math.max(0, mem.height - tpad * 2),
          finalWidth: mem.width,
          finalHeight: mem.height,
          rowExpanded: cellH > prep.contentHeight - 0.5,
          reflowChanged:
            Math.abs(mem.height - mem.initialHeight) > 0.5 ||
            Math.abs(
              mem.width -
                (measuredByRef.get(mem.ref)?.preferredWidth ?? mem.width),
            ) > 0.5,
        };
      }
      placedItems.push({
        ref: mem.ref,
        row: packed.row,
        column: packed.column,
        columnSpan: 1,
        localX,
        localY,
        width: mem.width,
        height: mem.height,
        cell: cellRect,
        content,
        collision,
        textAutoSize,
      });
      cursorY += mem.height + config.cellStackGap;
    }
  }

  for (let i = 0; i < placedItems.length; i++) {
    for (let j = i + 1; j < placedItems.length; j++) {
      const a = placedItems[i]!;
      const b = placedItems[j]!;
      const overlap =
        a.collision.x < b.collision.x + b.collision.width &&
        a.collision.x + a.collision.width > b.collision.x &&
        a.collision.y < b.collision.y + b.collision.height &&
        a.collision.y + a.collision.height > b.collision.y;
      if (overlap) {
        throw new FlowChronologicalLayoutError(
          `Chronological cell layout collision between "${a.ref}" and "${b.ref}".`,
        );
      }
    }
  }

  const columns = Math.max(1, pack.columnWidths.length);
  const grid: GridLayoutResult = {
    items: placedItems,
    columnWidths:
      pack.columnWidths.length > 0 ? pack.columnWidths : [contentBudget],
    rowHeights:
      pack.rowHeights.length > 0
        ? pack.rowHeights
        : [config.minEquationHeight],
    bounds: {
      x: 0,
      y: 0,
      width: pack.bounds.width,
      height: pack.bounds.height,
    },
    diagnostics,
  };

  const isLegacySingleColumn =
    settings.chronologicalDirection === 'down' &&
    settings.maxColumnHeight == null &&
    settings.maxRowWidth == null;

  return {
    grid,
    cellDebug: {
      cellCount: grouped.cells.length,
      objectCount: grouped.objectCount,
      maxObjectsPerCell: outputConfig.maxObjectsPerCell,
      chronologicalOrderingValid: grouped.chronologicalOrderingValid,
      cells: cellDebugEntries,
      objectOrder: grouped.objectOrder,
      splits: grouped.splits,
      wrapped: pack.wrapped,
      wrapReason: pack.wrapReason,
      outputType: outputConfig.outputType,
      cellArrangement: 'vertical_stack',
      gridArrangement: isLegacySingleColumn
        ? 'vertical_sequence'
        : 'chronological_grid',
      labels: {
        outputType: outputConfig.labels.outputType,
        layout: labels.layout,
        cellArrangement: labels.cellArrangement,
      },
    },
    effectiveCellLayout: {
      columns,
      items: cellDebugEntries.map((c) => ({
        ref: c.cellId,
        row: c.row,
        column: c.column,
      })),
    },
  };
}
