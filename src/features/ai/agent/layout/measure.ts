/**
 * Measure preferred sizes for AI create operations used in grid layout.
 */

import type { StyleDefaults } from '../../../../types/canvas';
import type { RichTextDocument } from '../../../text/richText';
import {
  TextElementAutoSizer,
  TEXT_AUTO_SIZE_WIDTH_DEFAULTS,
  measureTextElementWithFeatures,
  type TextMeasureResult,
} from '../../../text/textAutoSizer';
import type { TextElement } from '../../../../types/canvas';
import {
  addCommentToElement,
  addNoteToElement,
  setTitleOnElement,
} from '../../../text/textFeatures';
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
import type { MeasuredLayoutItem, TextAutoSizeDebug } from './types';

export type MeasureContext = {
  style: StyleDefaults;
  getStructureById?: (id: string) => NoteStructure | null;
};

export type MeasuredTextLayoutItem = MeasuredLayoutItem & {
  textAutoSize?: TextAutoSizeDebug;
  /** Last measure snapshot at preferred width (for debug). */
  initialMeasure?: TextMeasureResult;
};

function textStyle(style: StyleDefaults, padding: number) {
  return {
    fontSize: style.fontSize,
    fontFamily: style.fontFamily,
    fontWeight: style.fontWeight,
    fontItalic: style.fontItalic,
    underline: style.underline,
    lineHeight: style.lineHeight,
    color: style.textColor,
    padding,
  };
}

/** Build a throwaway TextElement so feature measurement matches runtime. */
function probeTextElementForFeatures(
  op: CreateTextOperation,
  style: StyleDefaults,
  width: number,
  height: number,
): TextElement {
  const padding = Math.max(style.textPadding, 12);
  let el = {
    id: 'probe',
    type: 'text' as const,
    text: op.text,
    richText: op.rich_text as RichTextDocument | undefined,
    x: 0,
    y: 0,
    width,
    height,
    rotation: 0,
    opacity: 1,
    locked: false,
    zIndex: 0,
    createdAt: 0,
    updatedAt: 0,
    metadata: {},
    fontSize: style.fontSize,
    fontFamily: style.fontFamily,
    fontWeight: style.fontWeight,
    fontItalic: style.fontItalic,
    underline: style.underline,
    strikethrough: style.strikethrough,
    color: style.textColor,
    alignment: style.textAlignment,
    lineHeight: style.lineHeight,
    backgroundColor: null,
    padding,
    cornerRadius: 0,
  } satisfies TextElement;
  if (op.title?.trim()) el = setTitleOnElement(el, op.title);
  for (const note of op.notes ?? []) {
    el = addNoteToElement(el, note.text, note.note_type).element;
  }
  // Comments are overlays — skip for preferred height (highlights don't grow much).
  void op.comments;
  return el;
}

function measureTextItem(op: CreateTextOperation, style: StyleDefaults): MeasuredTextLayoutItem {
  const cfg = GRID_LAYOUT_CONFIG;
  const padding = Math.max(style.textPadding, 12);
  const richText = op.rich_text as RichTextDocument | undefined;
  const content = { text: op.text, richText };
  const styleCfg = textStyle(style, padding);
  const limits = {
    minWidth: cfg.minTextWidth,
    maxWidth: cfg.maxTextWidth,
    defaultWidth: cfg.defaultTextWidth,
    compactMinWidth: TEXT_AUTO_SIZE_WIDTH_DEFAULTS.compactMinWidth,
  };

  const initial = TextElementAutoSizer.measure({
    content,
    style: styleCfg,
    limits,
    autoSized: true,
  });

  const withFeatures = measureTextElementWithFeatures(
    probeTextElementForFeatures(op, style, initial.width, initial.height),
    { availableWidth: initial.width },
  );

  const measureHeightAtWidth = (contentWidth: number) => {
    const bodyH = TextElementAutoSizer.measureHeightAtWidth(
      content,
      contentWidth,
      styleCfg,
    );
    const probe = probeTextElementForFeatures(op, style, contentWidth + padding * 2, bodyH);
    return measureTextElementWithFeatures(probe, {
      availableWidth: contentWidth + padding * 2,
    }).height;
  };

  return {
    ref: op.ref!,
    kind: 'text',
    preferredWidth: initial.preferredWidth,
    preferredHeight: withFeatures.height,
    minWidth: cfg.minTextWidth,
    minHeight: 56,
    measureHeightAtWidth,
    initialMeasure: { ...initial, height: withFeatures.height },
    textAutoSize: {
      preferredWidth: initial.preferredWidth,
      contentWidth: initial.contentWidth,
      contentHeight: withFeatures.contentHeight,
      finalWidth: initial.width,
      finalHeight: withFeatures.height,
      wrappedLines: initial.wrappedLines,
      padding: initial.padding,
      autoSized: true,
      measuredWithDom: initial.measuredWithDom,
      rowExpanded: false,
      reflowChanged: false,
    },
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
