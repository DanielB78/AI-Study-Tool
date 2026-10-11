/**
 * Measure preferred sizes for AI create operations used in grid layout.
 */

import type { StyleDefaults } from '../../../../types/canvas';
import { estimateTextHeight } from '../../canvas/createAiTextElement';
import { measureEquationSize } from '../../../equations/latex';
import { EQUATION_DEFAULT_FONT_SIZE } from '../../../equations/latex';
import {
  computeStructuredNoteBounds,
} from '../../../structures/instantiation';
import type { NoteStructure } from '../../../structures/types';
import { isNodeSection, isStructureField } from '../../../structures/types';
import type { StructureFieldValue } from '../../../structures/fieldValues';
import type {
  CanvasOperation,
  CreateEquationOperation,
  CreateGraphOperation,
  CreateStructuredNoteOperation,
  CreateTextOperation,
} from '../operations';
import { GRID_LAYOUT_CONFIG } from './gridConfig';
import type { MeasuredLayoutItem } from './types';

export type MeasureContext = {
  style: StyleDefaults;
  getStructureById?: (id: string) => NoteStructure | null;
};

function measureTextItem(op: CreateTextOperation, style: StyleDefaults): MeasuredLayoutItem {
  const cfg = GRID_LAYOUT_CONFIG;
  const padding = Math.max(style.textPadding, 12);
  const preferredWidth = Math.min(
    Math.max(cfg.defaultTextWidth, cfg.minTextWidth),
    cfg.maxTextWidth,
  );
  const measureHeightAtWidth = (contentWidth: number) =>
    estimateTextHeight(op.text, contentWidth, {
      fontSize: style.fontSize,
      lineHeight: style.lineHeight,
      textPadding: padding,
    });

  return {
    ref: op.ref!,
    kind: 'text',
    preferredWidth,
    preferredHeight: measureHeightAtWidth(preferredWidth),
    minWidth: cfg.minTextWidth,
    minHeight: 56,
    measureHeightAtWidth,
  };
}

function measureEquationItem(op: CreateEquationOperation): MeasuredLayoutItem {
  const cfg = GRID_LAYOUT_CONFIG;
  const size = measureEquationSize(op.latex, {
    fontSize: EQUATION_DEFAULT_FONT_SIZE,
    displayMode: true,
    maxWidth: cfg.maxEquationWidth,
  });
  return {
    ref: op.ref!,
    kind: 'equation',
    preferredWidth: Math.max(size.width, cfg.minEquationWidth),
    preferredHeight: Math.max(size.height, cfg.minEquationHeight),
    minWidth: cfg.minEquationWidth,
    minHeight: cfg.minEquationHeight,
    measureHeightAtWidth: () => Math.max(size.height, cfg.minEquationHeight),
  };
}

function measureGraphItem(_op: CreateGraphOperation): MeasuredLayoutItem {
  const cfg = GRID_LAYOUT_CONFIG;
  return {
    ref: _op.ref!,
    kind: 'graph',
    preferredWidth: cfg.defaultGraphWidth,
    preferredHeight: cfg.defaultGraphHeight,
    minWidth: cfg.minGraphWidth,
    minHeight: cfg.minGraphHeight,
    measureHeightAtWidth: () => cfg.defaultGraphHeight,
  };
}

function fieldValuesFromOp(
  op: CreateStructuredNoteOperation,
  structure: NoteStructure,
): Map<string, StructureFieldValue> {
  const fieldValues = new Map<string, StructureFieldValue>();
  for (const field of structure.fields) {
    const payload = op.fields[field.id];
    if (payload == null) continue;
    if (isNodeSection(field) && 'root' in payload && payload.root) {
      fieldValues.set(field.id, { kind: 'node_section', root: payload.root });
    } else if (
      isStructureField(field) &&
      field.contentType === 'text' &&
      'content' in payload
    ) {
      fieldValues.set(field.id, { kind: 'text', content: payload.content });
    } else if (
      isStructureField(field) &&
      field.contentType === 'equation' &&
      'latex' in payload
    ) {
      fieldValues.set(field.id, { kind: 'equation', latex: payload.latex });
    }
  }
  return fieldValues;
}

function measureStructuredItem(
  op: CreateStructuredNoteOperation,
  ctx: MeasureContext,
): MeasuredLayoutItem {
  const cfg = GRID_LAYOUT_CONFIG;
  const structure = ctx.getStructureById?.(op.structure_id) ?? null;
  let width: number = cfg.minStructuredWidth;
  let height: number = cfg.minStructuredHeight;
  if (structure) {
    const bounds = computeStructuredNoteBounds(
      structure,
      fieldValuesFromOp(op, structure),
    );
    width = Math.max(bounds.width, cfg.minStructuredWidth);
    height = Math.max(bounds.height, cfg.minStructuredHeight);
  }
  return {
    ref: op.ref!,
    kind: 'structured_note',
    preferredWidth: width,
    preferredHeight: height,
    minWidth: cfg.minStructuredWidth,
    minHeight: cfg.minStructuredHeight,
    measureHeightAtWidth: () => height,
  };
}

export function isGridCreatableOp(
  op: CanvasOperation,
): op is
  | CreateTextOperation
  | CreateEquationOperation
  | CreateGraphOperation
  | CreateStructuredNoteOperation {
  return (
    op.type === 'create_text' ||
    op.type === 'create_equation' ||
    op.type === 'create_graph' ||
    op.type === 'create_structured_note'
  );
}

/** Measure all create ops that have refs (layout participants). */
export function measureLayoutItems(
  operations: readonly CanvasOperation[],
  refs: ReadonlySet<string>,
  ctx: MeasureContext,
): MeasuredLayoutItem[] {
  const items: MeasuredLayoutItem[] = [];
  for (const op of operations) {
    if (!isGridCreatableOp(op) || !op.ref || !refs.has(op.ref)) continue;
    if (op.type === 'create_text') {
      items.push(measureTextItem(op, ctx.style));
    } else if (op.type === 'create_equation') {
      items.push(measureEquationItem(op));
    } else if (op.type === 'create_graph') {
      items.push(measureGraphItem(op));
    } else if (op.type === 'create_structured_note') {
      items.push(measureStructuredItem(op, ctx));
    }
  }
  return items;
}
