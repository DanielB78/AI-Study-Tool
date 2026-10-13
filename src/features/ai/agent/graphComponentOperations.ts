/**
 * Graph textbook-component operations.
 * Content + association only — style and placement are application-owned.
 */

import type {
  CanvasElement,
  GraphElement,
  TextElement,
} from '../../../types/canvas';
import type { Camera } from '../../../types/canvas';
import type { ViewportSize } from '../canvas/placement';
import { getDefaultViewportSize } from '../canvas/placement';
import { createAiGraphElement } from '../canvas/createAiGraphElement';
import type {
  CreateGraphExpressionSpec,
  CreateGraphOperation,
  CreateGraphPointSpec,
  CreateGraphSettingsSpec,
  CreateGraphViewportSpec,
} from './operations';
import { encodeGraphExpression } from '../../graphs/expressionCodec';
import {
  DEFAULT_GRAPH_SETTINGS,
  DEFAULT_GRAPH_VIEWPORT,
} from '../../graphs/types';
import {
  createTextComponentElement,
  graphRoleForComponentType,
  isGraphAttachableComponentType,
  isTextComponentType,
  type GraphAttachableComponentType,
  type TextComponentMeta,
  type TextComponentType,
  type TextComponentVariant,
} from '../../text/textComponents';
import {
  GRAPH_COMPONENT_LAYOUT,
  resolveGraphAttachPlacement,
  resolveGraphChromePlacement,
} from '../../graphs/graphPlacement';
import { CanvasAgentParseError } from './parseErrors';
import { createGraphPoint } from '../../graphs/createGraphElement';
import { parseGraphExpression } from '../../graphs/expressionService';
import { richTextToPlainText, type RichTextDocument } from '../../text/richText';
import { parseRichTextDocument } from '../../text/richTextValidate';

export type AddGraphToTextOperation = {
  type: 'add_graph_to_text';
  target_element_id: string;
  ref?: string;
  expressions: CreateGraphExpressionSpec[];
  points?: CreateGraphPointSpec[];
  viewport?: Partial<CreateGraphViewportSpec>;
  settings?: Partial<CreateGraphSettingsSpec>;
};

export type SetGraphTitleOperation = {
  type: 'set_graph_title';
  /** Real GraphElement id or plan ref. */
  target_element_id?: string;
  target_ref?: string;
  text: string;
};

export type AddGraphCaptionOperation = {
  type: 'add_graph_caption';
  target_element_id?: string;
  target_ref?: string;
  text: string;
};

export type AddGraphObservationOperation = {
  type: 'add_graph_observation';
  target_element_id?: string;
  target_ref?: string;
  text: string;
};

export type GraphCommentAnchorSpec = {
  expression_id?: string;
  point_id?: string;
  /** Mathematical x along a curve. */
  x?: number;
};

export type AddGraphCommentOperation = {
  type: 'add_graph_comment';
  target_element_id?: string;
  target_ref?: string;
  anchor?: GraphCommentAnchorSpec;
  comment: string;
};

export type AnnotateGraphPointOperation = {
  type: 'annotate_graph_point';
  target_element_id?: string;
  target_ref?: string;
  expression_id?: string;
  x: number;
  y?: number;
  label: string;
};

/** Create a textbook TextElement associated with a GraphElement. */
export type AddTextToGraphOperation = {
  type: 'add_text_to_graph';
  target_element_id?: string;
  target_ref?: string;
  graph_id?: string;
  component: GraphAttachableComponentType;
  content: string;
  ref?: string;
  variant?: TextComponentVariant;
  /** Optional rich text for main_text explanations. */
  rich_text?: RichTextDocument;
};

export type GraphComponentOperation =
  | AddGraphToTextOperation
  | SetGraphTitleOperation
  | AddGraphCaptionOperation
  | AddGraphObservationOperation
  | AddGraphCommentOperation
  | AnnotateGraphPointOperation
  | AddTextToGraphOperation;

export const GRAPH_COMPONENT_OPERATION_TYPES = [
  'add_graph_to_text',
  'set_graph_title',
  'add_graph_caption',
  'add_graph_observation',
  'add_graph_comment',
  'annotate_graph_point',
  'add_text_to_graph',
] as const;

export function isGraphComponentOperationType(
  t: string,
): t is GraphComponentOperation['type'] {
  return (GRAPH_COMPONENT_OPERATION_TYPES as readonly string[]).includes(t);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parseExpressions(raw: unknown, path: string): CreateGraphExpressionSpec[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new CanvasAgentParseError(
      'schema',
      `${path} must be a non-empty expressions array.`,
    );
  }
  return raw.map((item, i) => {
    if (!isRecord(item)) {
      throw new CanvasAgentParseError('schema', `${path}[${i}] must be an object.`);
    }
    const expression =
      typeof item.expression === 'string' ? item.expression.trim() : '';
    if (!expression) {
      throw new CanvasAgentParseError(
        'empty_text',
        `${path}[${i}].expression must be non-empty.`,
      );
    }
    const encoded = encodeGraphExpression(expression, 'strict');
    if (!encoded.ok) {
      throw new CanvasAgentParseError(
        'invalid_graph_expression',
        encoded.error ?? `Invalid expression: ${expression}`,
      );
    }
    const label =
      typeof item.label === 'string'
        ? item.label.trim()
        : typeof item.name === 'string'
          ? item.name.trim()
          : '';
    return {
      expression: encoded.canonical,
      visible: item.visible !== false,
      domain_min:
        typeof item.domain_min === 'number' && Number.isFinite(item.domain_min)
          ? item.domain_min
          : null,
      domain_max:
        typeof item.domain_max === 'number' && Number.isFinite(item.domain_max)
          ? item.domain_max
          : null,
      ...(label ? { label } : {}),
    };
  });
}

function resolveTargetId(
  raw: Record<string, unknown>,
  path: string,
): { target_element_id?: string; target_ref?: string } {
  const id =
    typeof raw.target_element_id === 'string'
      ? raw.target_element_id.trim()
      : typeof raw.graph_id === 'string'
        ? raw.graph_id.trim()
        : typeof raw.target_id === 'string'
          ? raw.target_id.trim()
          : '';
  // For set_graph_title etc., target_ref is explicit
  const targetRef =
    typeof raw.target_ref === 'string' ? raw.target_ref.trim() : '';
  if (!id && !targetRef) {
    throw new CanvasAgentParseError(
      'missing_target',
      `${path} needs target_element_id or target_ref.`,
    );
  }
  return {
    ...(id ? { target_element_id: id } : {}),
    ...(targetRef ? { target_ref: targetRef } : {}),
  };
}

export function parseGraphComponentOperation(
  raw: Record<string, unknown>,
): GraphComponentOperation {
  const type = raw.type;
  if (typeof type !== 'string' || !isGraphComponentOperationType(type)) {
    throw new CanvasAgentParseError('schema', 'Unknown graph component operation.');
  }

  if (type === 'add_graph_to_text') {
    const target =
      typeof raw.target_element_id === 'string'
        ? raw.target_element_id.trim()
        : typeof raw.target_id === 'string'
          ? raw.target_id.trim()
          : '';
    if (!target) {
      throw new CanvasAgentParseError(
        'missing_target',
        'add_graph_to_text needs target_element_id.',
      );
    }
    const graphPayload = isRecord(raw.graph) ? raw.graph : raw;
    const expressions = parseExpressions(
      graphPayload.expressions ?? raw.expressions,
      'add_graph_to_text.expressions',
    );
    return {
      type,
      target_element_id: target,
      expressions,
      ...(typeof raw.ref === 'string' && raw.ref.trim()
        ? { ref: raw.ref.trim() }
        : {}),
      ...(Array.isArray(graphPayload.points)
        ? {
            points: graphPayload.points.filter(isRecord).map((p) => ({
              x: Number(p.x),
              y: Number(p.y),
              label: typeof p.label === 'string' ? p.label : '',
              visible: p.visible !== false,
            })),
          }
        : {}),
      ...(isRecord(graphPayload.viewport)
        ? {
            viewport: {
              x_min:
                typeof graphPayload.viewport.x_min === 'number'
                  ? graphPayload.viewport.x_min
                  : DEFAULT_GRAPH_VIEWPORT.xMin,
              x_max:
                typeof graphPayload.viewport.x_max === 'number'
                  ? graphPayload.viewport.x_max
                  : DEFAULT_GRAPH_VIEWPORT.xMax,
              y_min:
                typeof graphPayload.viewport.y_min === 'number'
                  ? graphPayload.viewport.y_min
                  : DEFAULT_GRAPH_VIEWPORT.yMin,
              y_max:
                typeof graphPayload.viewport.y_max === 'number'
                  ? graphPayload.viewport.y_max
                  : DEFAULT_GRAPH_VIEWPORT.yMax,
            },
          }
        : {}),
      ...(isRecord(graphPayload.settings)
        ? {
            settings: {
              title:
                typeof graphPayload.settings.title === 'string'
                  ? graphPayload.settings.title
                  : null,
              x_axis_label:
                typeof graphPayload.settings.x_axis_label === 'string'
                  ? graphPayload.settings.x_axis_label
                  : null,
              y_axis_label:
                typeof graphPayload.settings.y_axis_label === 'string'
                  ? graphPayload.settings.y_axis_label
                  : null,
              show_grid: graphPayload.settings.show_grid !== false,
              show_x_axis: graphPayload.settings.show_x_axis !== false,
              show_y_axis: graphPayload.settings.show_y_axis !== false,
            },
          }
        : {}),
    };
  }

  if (type === 'set_graph_title' || type === 'add_graph_caption' || type === 'add_graph_observation') {
    const targets = resolveTargetId(raw, type);
    const text =
      typeof raw.text === 'string'
        ? raw.text.trim()
        : typeof raw.content === 'string'
          ? raw.content.trim()
          : '';
    if (!text) {
      throw new CanvasAgentParseError('empty_text', `${type} needs non-empty text.`);
    }
    return { type, ...targets, text } as GraphComponentOperation;
  }

  if (type === 'add_graph_comment') {
    const targets = resolveTargetId(raw, type);
    const comment =
      typeof raw.comment === 'string'
        ? raw.comment.trim()
        : typeof raw.content === 'string'
          ? raw.content.trim()
          : typeof raw.text === 'string'
            ? raw.text.trim()
            : '';
    if (!comment) {
      throw new CanvasAgentParseError(
        'empty_text',
        'add_graph_comment needs non-empty comment.',
      );
    }
    let anchor: GraphCommentAnchorSpec | undefined;
    if (isRecord(raw.anchor)) {
      anchor = {};
      if (typeof raw.anchor.expression_id === 'string') {
        anchor.expression_id = raw.anchor.expression_id.trim();
      }
      if (typeof raw.anchor.point_id === 'string') {
        anchor.point_id = raw.anchor.point_id.trim();
      }
      if (typeof raw.anchor.x === 'number' && Number.isFinite(raw.anchor.x)) {
        anchor.x = raw.anchor.x;
      }
    }
    return { type, ...targets, comment, ...(anchor ? { anchor } : {}) };
  }

  if (type === 'add_text_to_graph') {
    const targets = resolveTargetId(raw, type);
    const componentRaw =
      typeof raw.component === 'string'
        ? raw.component.trim()
        : typeof raw.component_type === 'string'
          ? raw.component_type.trim()
          : '';
    if (!isGraphAttachableComponentType(componentRaw)) {
      throw new CanvasAgentParseError(
        'schema',
        'add_text_to_graph.component must be main_text|definition|example|warning|exercise.',
      );
    }
    const content =
      typeof raw.content === 'string'
        ? raw.content.trim()
        : typeof raw.text === 'string'
          ? raw.text.trim()
          : '';
    if (!content) {
      throw new CanvasAgentParseError(
        'empty_text',
        'add_text_to_graph needs non-empty content.',
      );
    }
    let rich_text: RichTextDocument | undefined;
    if (raw.rich_text != null && componentRaw === 'main_text') {
      try {
        rich_text = parseRichTextDocument(raw.rich_text);
      } catch {
        throw new CanvasAgentParseError(
          'schema',
          'add_text_to_graph.rich_text is invalid.',
        );
      }
    }
    const variant =
      typeof raw.variant === 'string' ? raw.variant.trim() : undefined;
    return {
      type,
      ...targets,
      component: componentRaw,
      content: rich_text ? richTextToPlainText(rich_text) : content,
      ...(typeof raw.ref === 'string' && raw.ref.trim()
        ? { ref: raw.ref.trim() }
        : {}),
      ...(variant &&
      (variant === 'warning' ||
        variant === 'common_mistake' ||
        variant === 'important_caution')
        ? { variant }
        : {}),
      ...(rich_text ? { rich_text } : {}),
    };
  }

  // annotate_graph_point
  const targets = resolveTargetId(raw, type);
  if (typeof raw.x !== 'number' || !Number.isFinite(raw.x)) {
    throw new CanvasAgentParseError('schema', 'annotate_graph_point needs numeric x.');
  }
  const label =
    typeof raw.label === 'string'
      ? raw.label.trim()
      : typeof raw.text === 'string'
        ? raw.text.trim()
        : '';
  if (!label) {
    throw new CanvasAgentParseError(
      'empty_text',
      'annotate_graph_point needs a label.',
    );
  }
  return {
    type,
    ...targets,
    x: raw.x,
    ...(typeof raw.y === 'number' && Number.isFinite(raw.y) ? { y: raw.y } : {}),
    ...(typeof raw.expression_id === 'string'
      ? { expression_id: raw.expression_id.trim() }
      : {}),
    label,
  };
}

export type GraphComponentExecuteContext = {
  getElements: () => CanvasElement[];
  getCamera: () => Camera;
  getViewportSize?: () => ViewportSize;
  nextZIndex: () => number;
  addElement: (el: CanvasElement, select?: boolean) => void;
  updateElement: (id: string, updater: (el: CanvasElement) => CanvasElement) => void;
  resolveRef?: (ref: string) => string | undefined;
  onPlacementDebug?: (info: Record<string, unknown>) => void;
};

function resolveGraphId(
  op: {
    target_element_id?: string;
    target_ref?: string;
    graph_id?: string;
  },
  ctx: GraphComponentExecuteContext,
): string {
  if (op.target_ref) {
    const resolved = ctx.resolveRef?.(op.target_ref);
    if (!resolved) {
      throw new Error(`Unknown target_ref "${op.target_ref}".`);
    }
    return resolved;
  }
  const id = op.target_element_id ?? op.graph_id;
  if (id) {
    return ctx.resolveRef?.(id) ?? id;
  }
  throw new Error('Missing graph target.');
}

function requireGraph(
  id: string,
  elements: CanvasElement[],
): GraphElement {
  const el = elements.find((e) => e.id === id);
  if (!el || el.type !== 'graph') {
    throw new Error(`Target "${id}" is not a GraphElement.`);
  }
  return el;
}

function findChrome(
  elements: CanvasElement[],
  graphId: string,
  role: string,
): TextElement | undefined {
  return elements.find(
    (e): e is TextElement =>
      e.type === 'text' &&
      e.componentMeta?.associatedElementId === graphId &&
      e.componentMeta.role === role,
  );
}

function createChromeComponent(
  opts: {
    componentType: TextComponentType;
    text: string;
    graph: GraphElement;
    role: NonNullable<TextComponentMeta['role']>;
    metaExtra?: Partial<TextComponentMeta>;
    richText?: RichTextDocument;
    operation?: string;
  },
  ctx: GraphComponentExecuteContext,
): string {
  const meta: TextComponentMeta = {
    placementMode: 'auto',
    associatedElementId: opts.graph.id,
    role: opts.role,
    ...opts.metaExtra,
  };
  const decision = resolveGraphChromePlacement({
    componentType: opts.componentType,
    text: opts.text,
    meta,
    graph: opts.graph,
    elements: ctx.getElements(),
    camera: ctx.getCamera(),
    viewport: ctx.getViewportSize?.() ?? getDefaultViewportSize(),
  });
  ctx.onPlacementDebug?.({
    componentType: opts.componentType,
    role: opts.role,
    reason: decision.reason,
    associatedGraphId: opts.graph.id,
    resolvedPosition: { x: decision.x, y: decision.y },
    measuredBounds: { width: decision.width, height: decision.height },
    reflow: decision.reflow,
  });

  if (decision.reflow) {
    const { elementIds, dy } = decision.reflow;
    for (const id of elementIds) {
      ctx.updateElement(id, (el) => {
        if (el.type !== 'text') return el;
        return { ...el, y: el.y + dy };
      });
    }
  }

  const el = createTextComponentElement({
    componentType: opts.componentType,
    text: opts.text,
    richText: opts.richText,
    position: { x: decision.x, y: decision.y },
    zIndex: ctx.nextZIndex(),
    width: decision.width,
    meta,
    metadata: {
      createdBy: 'ai',
      source: 'agent',
      operation: opts.operation ?? opts.role,
      placementDecision: decision.reason,
    },
  });
  el.width = decision.width;
  el.height = decision.height;
  ctx.addElement(el, false);
  return el.id;
}

export function executeAddTextToGraph(
  op: AddTextToGraphOperation,
  ctx: GraphComponentExecuteContext,
): { createdId: string } {
  const graphId = resolveGraphId(op, ctx);
  const graph = requireGraph(graphId, ctx.getElements());
  if (!isTextComponentType(op.component) || !isGraphAttachableComponentType(op.component)) {
    throw new Error(`Unsupported add_text_to_graph component "${op.component}".`);
  }
  const role = graphRoleForComponentType(op.component);
  if (!role) {
    throw new Error(`No graph role for component "${op.component}".`);
  }
  const createdId = createChromeComponent(
    {
      componentType: op.component,
      text: op.content,
      richText: op.rich_text,
      graph,
      role,
      metaExtra: op.variant ? { variant: op.variant } : undefined,
      operation: 'add_text_to_graph',
    },
    ctx,
  );
  return { createdId };
}

export function executeAddGraphToText(
  op: AddGraphToTextOperation,
  ctx: GraphComponentExecuteContext,
): { createdId: string } {
  const elements = ctx.getElements();
  const target = elements.find((e) => e.id === op.target_element_id);
  if (!target || target.type !== 'text') {
    throw new Error(
      `add_graph_to_text target "${op.target_element_id}" is not a TextElement.`,
    );
  }

  const decision = resolveGraphAttachPlacement({
    targetText: target,
    elements,
    camera: ctx.getCamera(),
    viewport: ctx.getViewportSize?.() ?? getDefaultViewportSize(),
    width: GRAPH_COMPONENT_LAYOUT.attachedWidth,
    height: GRAPH_COMPONENT_LAYOUT.attachedHeight,
  });

  ctx.onPlacementDebug?.({
    operation: 'add_graph_to_text',
    reason: decision.reason,
    associatedElementId: decision.associatedElementId,
    order: decision.order,
    resolvedPosition: { x: decision.x, y: decision.y },
    measuredBounds: { width: decision.width, height: decision.height },
  });

  // Shift auto exercises down when inserting before them
  if (decision.exerciseShift && decision.exerciseShift > 0) {
    for (const el of elements) {
      if (
        el.type === 'text' &&
        el.componentMeta?.associatedElementId === target.id &&
        el.componentMeta.placementMode !== 'manual' &&
        el.componentType === 'exercise'
      ) {
        const shift = decision.exerciseShift;
        ctx.updateElement(el.id, (prev) => ({
          ...prev,
          y: prev.y + shift,
        }));
      }
    }
  }

  const createOp: CreateGraphOperation = {
    type: 'create_graph',
    expressions: op.expressions,
    points: op.points ?? [],
    viewport: {
      x_min: op.viewport?.x_min ?? DEFAULT_GRAPH_VIEWPORT.xMin,
      x_max: op.viewport?.x_max ?? DEFAULT_GRAPH_VIEWPORT.xMax,
      y_min: op.viewport?.y_min ?? DEFAULT_GRAPH_VIEWPORT.yMin,
      y_max: op.viewport?.y_max ?? DEFAULT_GRAPH_VIEWPORT.yMax,
    },
    settings: {
      title: op.settings?.title ?? null,
      x_axis_label: op.settings?.x_axis_label ?? null,
      y_axis_label: op.settings?.y_axis_label ?? null,
      show_grid: op.settings?.show_grid ?? DEFAULT_GRAPH_SETTINGS.showGrid,
      show_x_axis: op.settings?.show_x_axis ?? DEFAULT_GRAPH_SETTINGS.showXAxis,
      show_y_axis: op.settings?.show_y_axis ?? DEFAULT_GRAPH_SETTINGS.showYAxis,
    },
    placement: { mode: 'viewport_default' },
  };

  const canonical = op.expressions.map((e) => e.expression);
  const graph = createAiGraphElement(createOp, canonical, {
    x: decision.x,
    y: decision.y,
    zIndex: ctx.nextZIndex(),
    width: decision.width,
    height: decision.height,
    metadata: {
      operation: 'add_graph_to_text',
      placementDecision: decision.reason,
    },
  });
  graph.association = {
    associatedElementId: target.id,
    placementMode: 'auto',
    order: decision.order,
  };
  ctx.addElement(graph, false);
  return { createdId: graph.id };
}

export function executeSetGraphTitle(
  op: SetGraphTitleOperation,
  ctx: GraphComponentExecuteContext,
): { createdId?: string; updatedId?: string } {
  const graphId = resolveGraphId(op, ctx);
  const graph = requireGraph(graphId, ctx.getElements());

  // Sync native settings title for widget header
  ctx.updateElement(graph.id, (el) => {
    if (el.type !== 'graph') return el;
    return {
      ...el,
      settings: { ...el.settings, title: op.text },
    };
  });

  const existing = findChrome(ctx.getElements(), graph.id, 'graph_title');
  if (existing) {
    ctx.updateElement(existing.id, (el) => {
      if (el.type !== 'text') return el;
      return { ...el, text: op.text, richText: undefined };
    });
    return { updatedId: existing.id };
  }

  const createdId = createChromeComponent(
    {
      componentType: 'title',
      text: op.text,
      graph: requireGraph(graphId, ctx.getElements()),
      role: 'graph_title',
    },
    ctx,
  );
  return { createdId };
}

export function executeAddGraphCaption(
  op: AddGraphCaptionOperation,
  ctx: GraphComponentExecuteContext,
): { createdId?: string; updatedId?: string } {
  const graphId = resolveGraphId(op, ctx);
  const graph = requireGraph(graphId, ctx.getElements());
  const existing = findChrome(ctx.getElements(), graph.id, 'graph_caption');
  if (existing) {
    ctx.updateElement(existing.id, (el) => {
      if (el.type !== 'text') return el;
      return { ...el, text: op.text, richText: undefined };
    });
    return { updatedId: existing.id };
  }
  const createdId = createChromeComponent(
    {
      componentType: 'caption',
      text: op.text,
      graph,
      role: 'graph_caption',
    },
    ctx,
  );
  return { createdId };
}

export function executeAddGraphObservation(
  op: AddGraphObservationOperation,
  ctx: GraphComponentExecuteContext,
): { createdId: string } {
  const graphId = resolveGraphId(op, ctx);
  const graph = requireGraph(graphId, ctx.getElements());
  const createdId = createChromeComponent(
    {
      componentType: 'key_observation',
      text: op.text,
      graph,
      role: 'graph_observation',
    },
    ctx,
  );
  return { createdId };
}

export function executeAddGraphComment(
  op: AddGraphCommentOperation,
  ctx: GraphComponentExecuteContext,
): { createdId: string } {
  const graphId = resolveGraphId(op, ctx);
  const graph = requireGraph(graphId, ctx.getElements());
  const anchor = op.anchor;

  if (anchor?.expression_id) {
    const expr = graph.expressions.find((e) => e.id === anchor.expression_id);
    if (!expr) {
      throw new Error(
        `Unknown expression_id "${anchor.expression_id}" on graph "${graph.id}".`,
      );
    }
  }
  if (anchor?.point_id) {
    const pt = graph.points.find((p) => p.id === anchor.point_id);
    if (!pt) {
      throw new Error(
        `Unknown point_id "${anchor.point_id}" on graph "${graph.id}".`,
      );
    }
  }

  const createdId = createChromeComponent(
    {
      componentType: 'linked_comment',
      text: op.comment,
      graph,
      role: 'graph_comment',
      metaExtra: {
        graphAnchor: {
          targetGraphId: graph.id,
          ...(anchor?.expression_id
            ? { expressionId: anchor.expression_id }
            : {}),
          ...(anchor?.point_id ? { pointId: anchor.point_id } : {}),
          ...(anchor?.x != null ? { x: anchor.x } : {}),
          status: 'resolved',
        },
      },
    },
    ctx,
  );
  return { createdId };
}

export function executeAnnotateGraphPoint(
  op: AnnotateGraphPointOperation,
  ctx: GraphComponentExecuteContext,
): { pointId: string } {
  const graphId = resolveGraphId(op, ctx);
  const graph = requireGraph(graphId, ctx.getElements());

  let y = op.y;
  if (y == null && op.expression_id) {
    const expr = graph.expressions.find((e) => e.id === op.expression_id);
    if (!expr) {
      throw new Error(
        `Unknown expression_id "${op.expression_id}" on graph "${graph.id}".`,
      );
    }
    const parsed = parseGraphExpression(expr.sourceText, 'strict');
    if (!parsed.ok) {
      throw new Error(
        `Could not parse expression "${expr.sourceText}": ${parsed.error}`,
      );
    }
    const evaluated = parsed.evaluate(op.x);
    if (!Number.isFinite(evaluated)) {
      throw new Error(
        `Could not evaluate expression "${expr.sourceText}" at x=${op.x}.`,
      );
    }
    y = evaluated;
  }
  if (y == null) {
    throw new Error('annotate_graph_point needs y or a evaluable expression_id.');
  }

  const EPS = 1e-6;
  const existing = graph.points.find(
    (p) => Math.abs(p.x - op.x) < EPS && Math.abs(p.y - y) < EPS,
  );
  if (existing) {
    ctx.updateElement(graph.id, (el) => {
      if (el.type !== 'graph') return el;
      return {
        ...el,
        points: el.points.map((p) =>
          p.id === existing.id
            ? { ...p, label: op.label, visible: true }
            : p,
        ),
      };
    });
    return { pointId: existing.id };
  }

  const point = createGraphPoint(op.x, y, op.label, '#111827');
  ctx.updateElement(graph.id, (el) => {
    if (el.type !== 'graph') return el;
    return { ...el, points: [...el.points, point] };
  });
  return { pointId: point.id };
}
