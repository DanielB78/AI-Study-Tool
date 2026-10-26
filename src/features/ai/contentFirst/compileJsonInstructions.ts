/**
 * Compile :::json instructions + Markdown bodies into existing CanvasOperations.
 *
 * edit → update_text / update_equation / graph edit ops
 * add_text → normal lesson compile (text / equation / graph creates), placed as a
 *            chronological group relative to the target (above|below)
 */

import type {
  AgentRichTextDocument,
  AgentRichTextSpan,
  CanvasAgentResponse,
  CanvasOperation,
  UpdateTextOperation,
} from '../agent/operations';
import type { ParseContext } from '../agent/parser';
import { useCanvasStore } from '../../../store/canvasStore';
import { parseContentDocument } from './contentParser';
import { compileContentDocument } from './compileContentDocument';
import type {
  ContentDocument,
  ContentDocumentNode,
  ContentInlineSpan,
  ContentJsonAddTextAction,
  ContentJsonSegment,
} from './types';
import { ContentParseError } from './types';

type PrimaryElementType = 'text' | 'equation' | 'graph';

function spansToAgent(spans: ContentInlineSpan[]): AgentRichTextSpan[] {
  return spans.map((s) => {
    if (s.type === 'inline_math') {
      return { type: 'inline_math' as const, latex: s.latex };
    }
    const style =
      s.style?.bold || s.style?.italic
        ? {
            ...(s.style.bold ? { bold: true as const } : {}),
            ...(s.style.italic ? { italic: true as const } : {}),
          }
        : undefined;
    return style ? { text: s.text, style } : { text: s.text };
  });
}

/**
 * Fold a ContentDocument into a single rich-text document (one TextElement).
 * Display math becomes rich-text display_math blocks — not EquationElements.
 * Graphs are not allowed inside a text body.
 */
export function documentToSingleRichText(
  doc: ContentDocument,
): AgentRichTextDocument {
  const blocks: AgentRichTextDocument['blocks'] = [];

  for (const node of doc.nodes) {
    switch (node.type) {
      case 'heading': {
        const size =
          node.level === 1
            ? 'heading_large'
            : node.level === 2
              ? 'heading'
              : 'subheading';
        blocks.push({
          type: 'heading',
          spans: spansToAgent(node.spans).map((s) => {
            if ('type' in s && s.type === 'inline_math') return s;
            return {
              text: 'text' in s ? s.text : '',
              style: { bold: true, font_size: size },
            };
          }),
        });
        break;
      }
      case 'paragraph':
      case 'component': {
        if (!node.text.trim()) break;
        blocks.push({
          type: 'paragraph',
          spans: spansToAgent(node.spans),
        });
        break;
      }
      case 'list': {
        for (const item of node.items) {
          blocks.push({
            type: node.ordered ? 'numbered' : 'bullet',
            spans: spansToAgent(item.spans),
          });
        }
        break;
      }
      case 'equation': {
        blocks.push({ type: 'display_math', latex: node.latex });
        break;
      }
      case 'graph': {
        throw new ContentParseError(
          'invalid_instruction',
          'Graph markers are not allowed inside a TextElement edit or add_text body. Use action "edit" on a GraphElement with a :::graph body instead.',
        );
      }
    }
  }

  if (blocks.length === 0) {
    throw new ContentParseError(
      'empty_body',
      'Markdown body produced no text content.',
    );
  }

  return { blocks };
}

function richTextPlain(doc: AgentRichTextDocument): string {
  return doc.blocks
    .map((b) => {
      if (b.type === 'display_math') return b.latex;
      return b.spans
        .map((s) => ('type' in s && s.type === 'inline_math' ? s.latex : 'text' in s ? s.text : ''))
        .join('');
    })
    .join('\n\n')
    .trim();
}

function resolveElementType(
  targetId: string,
  ctx: ParseContext,
): PrimaryElementType {
  const fromCtx = ctx.elementTypes?.get(targetId);
  if (fromCtx === 'text' || fromCtx === 'equation' || fromCtx === 'graph') {
    return fromCtx;
  }

  const live = useCanvasStore
    .getState()
    .document.elements.find((el) => el.id === targetId);
  if (live?.type === 'text' || live?.type === 'equation' || live?.type === 'graph') {
    return live.type;
  }

  if (!ctx.allowedElementIds.has(targetId) && !live) {
    throw new ContentParseError(
      'missing_target',
      `target_id "${targetId}" was not in the supplied canvas context.`,
    );
  }

  throw new ContentParseError(
    'wrong_target_type',
    `target_id "${targetId}" is not a TextElement, EquationElement, or GraphElement.`,
  );
}

function assertTargetAllowed(targetId: string, ctx: ParseContext): void {
  if (ctx.allowedElementIds.size === 0) {
    // Empty allow-list is used in generation-only tests; still try live store.
    const live = useCanvasStore
      .getState()
      .document.elements.find((el) => el.id === targetId);
    if (live) return;
    throw new ContentParseError(
      'missing_target',
      `target_id "${targetId}" was not in the supplied canvas context.`,
    );
  }
  if (!ctx.allowedElementIds.has(targetId)) {
    throw new ContentParseError(
      'missing_target',
      `target_id "${targetId}" was not in the supplied canvas context.`,
    );
  }
}

function parseBodyDocument(markdown: string): ContentDocument {
  try {
    return parseContentDocument(markdown);
  } catch (err) {
    if (err instanceof ContentParseError) throw err;
    throw new ContentParseError(
      'invalid_instruction',
      err instanceof Error ? err.message : 'Failed to parse Markdown body.',
    );
  }
}

function compileEditText(
  targetId: string,
  markdown: string,
): UpdateTextOperation {
  const doc = parseBodyDocument(markdown);
  // Reject standalone graph-only bodies for text edits.
  if (doc.nodes.some((n) => n.type === 'graph')) {
    throw new ContentParseError(
      'wrong_target_type',
      `Cannot edit TextElement "${targetId}" with a :::graph body.`,
    );
  }
  const rich_text = documentToSingleRichText(doc);
  return {
    type: 'update_text',
    target_element_id: targetId,
    text: richTextPlain(rich_text),
    rich_text,
  };
}

function compileEditEquation(
  targetId: string,
  markdown: string,
): CanvasOperation {
  const doc = parseBodyDocument(markdown);
  const equations = doc.nodes.filter(
    (n): n is Extract<ContentDocumentNode, { type: 'equation' }> =>
      n.type === 'equation',
  );
  const others = doc.nodes.filter((n) => n.type !== 'equation');

  if (equations.length === 0) {
    throw new ContentParseError(
      'invalid_instruction',
      `EquationElement edit for "${targetId}" requires exactly one display-math ($$) block.`,
    );
  }
  if (equations.length > 1) {
    throw new ContentParseError(
      'invalid_instruction',
      `EquationElement edit for "${targetId}" has ${equations.length} display-math blocks; provide exactly one.`,
    );
  }
  const nonEmptyOther = others.some((n) => {
    if (n.type === 'paragraph' || n.type === 'heading' || n.type === 'component') {
      return Boolean(n.text.trim());
    }
    if (n.type === 'list') return n.items.length > 0;
    if (n.type === 'graph') return true;
    return false;
  });
  if (nonEmptyOther) {
    throw new ContentParseError(
      'invalid_instruction',
      `EquationElement edit for "${targetId}" must contain only one display-math block (no extra prose or graphs).`,
    );
  }

  return {
    type: 'update_equation',
    target_element_id: targetId,
    latex: equations[0]!.latex,
  };
}

function getGraphExpressionIds(
  graphId: string,
  ctx: ParseContext,
): string[] {
  const fromCtx = ctx.graphExpressionIds?.get(graphId);
  if (fromCtx && fromCtx.size > 0) return [...fromCtx];
  const live = useCanvasStore
    .getState()
    .document.elements.find((el) => el.id === graphId);
  if (live?.type === 'graph') {
    return live.expressions.map((e) => e.id);
  }
  return fromCtx ? [...fromCtx] : [];
}

function compileEditGraph(
  targetId: string,
  markdown: string,
  ctx: ParseContext,
): CanvasOperation[] {
  const doc = parseBodyDocument(markdown);
  const graphs = doc.nodes.filter((n) => n.type === 'graph');
  const others = doc.nodes.filter((n) => n.type !== 'graph');

  if (graphs.length === 0) {
    throw new ContentParseError(
      'invalid_instruction',
      `GraphElement edit for "${targetId}" requires a :::graph marker body.`,
    );
  }
  if (graphs.length > 1) {
    throw new ContentParseError(
      'invalid_instruction',
      `GraphElement edit for "${targetId}" has multiple :::graph markers; provide exactly one.`,
    );
  }
  const nonEmptyOther = others.some((n) => {
    if (n.type === 'paragraph' || n.type === 'heading' || n.type === 'component') {
      return Boolean(n.text.trim());
    }
    if (n.type === 'list') return n.items.length > 0;
    if (n.type === 'equation') return true;
    return false;
  });
  if (nonEmptyOther) {
    throw new ContentParseError(
      'invalid_instruction',
      `GraphElement edit for "${targetId}" must contain only a :::graph marker (no extra prose or equations).`,
    );
  }

  const g = graphs[0]!;
  if (g.type !== 'graph') {
    throw new ContentParseError('invalid_graph', 'Expected graph node.');
  }

  const ops: CanvasOperation[] = [];
  const existingExprIds = getGraphExpressionIds(targetId, ctx);

  // Replacement semantics: supplied expressions replace the existing set.
  for (const exprId of existingExprIds) {
    ops.push({
      type: 'remove_graph_expression',
      graph_id: targetId,
      expression_id: exprId,
    });
  }
  for (const expression of g.expressions) {
    ops.push({
      type: 'add_graph_expression',
      graph_id: targetId,
      expression: {
        expression,
        visible: true,
        domain_min: null,
        domain_max: null,
      },
    });
  }

  // PATCH settings — only fields explicitly supplied in the marker.
  const settingsPatch: {
    type: 'update_graph_settings';
    graph_id: string;
    title?: string | null;
    x_axis_label?: string | null;
    y_axis_label?: string | null;
  } = { type: 'update_graph_settings', graph_id: targetId };
  let hasSettings = false;
  if (g.title != null) {
    settingsPatch.title = g.title;
    hasSettings = true;
  }
  if (g.xLabel != null) {
    settingsPatch.x_axis_label = g.xLabel;
    hasSettings = true;
  }
  if (g.yLabel != null) {
    settingsPatch.y_axis_label = g.yLabel;
    hasSettings = true;
  }
  if (hasSettings) ops.push(settingsPatch);

  const hasViewport =
    g.xMin != null || g.xMax != null || g.yMin != null || g.yMax != null;
  if (hasViewport) {
    ops.push({
      type: 'update_graph_viewport',
      graph_id: targetId,
      ...(g.xMin != null ? { x_min: g.xMin } : {}),
      ...(g.xMax != null ? { x_max: g.xMax } : {}),
      ...(g.yMin != null ? { y_min: g.yMin } : {}),
      ...(g.yMax != null ? { y_max: g.yMax } : {}),
    });
  }

  return ops;
}

/**
 * Compile add_text Markdown like ordinary lesson generation (separate text /
 * equation / graph creates). The caller wraps these in chronological_grid with
 * relative_to_element placement on the target.
 */
export function compileAddTextBatch(
  instruction: ContentJsonAddTextAction,
  markdown: string,
  ctx: ParseContext,
): CanvasAgentResponse {
  assertTargetAllowed(instruction.target_id, ctx);
  const elType = resolveElementType(instruction.target_id, ctx);
  if (elType !== 'text' && elType !== 'equation' && elType !== 'graph') {
    throw new ContentParseError(
      'wrong_target_type',
      `add_text target "${instruction.target_id}" must be a TextElement, EquationElement, or GraphElement.`,
    );
  }
  const doc = parseBodyDocument(markdown);
  if (doc.nodes.length === 0) {
    throw new ContentParseError(
      'empty_body',
      `add_text on "${instruction.target_id}" produced no content nodes.`,
    );
  }
  const compiled = compileContentDocument(doc);
  if (compiled.response.operations.length === 0) {
    throw new ContentParseError(
      'empty_body',
      `add_text on "${instruction.target_id}" produced no canvas operations.`,
    );
  }
  return {
    output_type: 'lesson',
    layout: {
      type: 'chronological_grid',
      placement: {
        mode: 'relative_to_element',
        anchor_element_id: instruction.target_id,
        relation: instruction.position,
      },
    },
    operations: compiled.response.operations,
  };
}

/**
 * Compile one :::json edit segment into canvas operations.
 * Validates target against context / live canvas before emitting ops.
 */
export function compileJsonEditSegment(
  segment: ContentJsonSegment,
  ctx: ParseContext,
): CanvasOperation[] {
  const { instruction, markdown } = segment;
  if (instruction.action !== 'edit') {
    throw new ContentParseError(
      'invalid_instruction',
      'compileJsonEditSegment only accepts action "edit".',
    );
  }
  assertTargetAllowed(instruction.target_id, ctx);
  const elType = resolveElementType(instruction.target_id, ctx);

  switch (elType) {
    case 'text':
      return [compileEditText(instruction.target_id, markdown)];
    case 'equation':
      return [compileEditEquation(instruction.target_id, markdown)];
    case 'graph':
      return compileEditGraph(instruction.target_id, markdown, ctx);
    default: {
      const _exhaustive: never = elType;
      return _exhaustive;
    }
  }
}

/** @deprecated Use compileJsonEditSegment / compileAddTextBatch. */
export function compileJsonSegment(
  segment: ContentJsonSegment,
  ctx: ParseContext,
): CanvasOperation[] {
  if (segment.instruction.action === 'add_text') {
    return compileAddTextBatch(segment.instruction, segment.markdown, ctx)
      .operations;
  }
  return compileJsonEditSegment(segment, ctx);
}

/** Compile all edit segments (validate-all semantics via throwing). */
export function compileJsonSegments(
  segments: readonly ContentJsonSegment[],
  ctx: ParseContext,
): CanvasOperation[] {
  const ops: CanvasOperation[] = [];
  for (const segment of segments) {
    ops.push(...compileJsonSegment(segment, ctx));
  }
  return ops;
}
