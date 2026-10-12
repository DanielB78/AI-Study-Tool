/**
 * AI operations for textbook TextComponents.
 * Content + semantic type only — style and placement are application-owned.
 */

import type { CanvasElement, TextElement } from '../../../types/canvas';
import type { Camera } from '../../../types/canvas';
import type { ViewportSize } from '../canvas/placement';
import { getDefaultViewportSize } from '../canvas/placement';
import {
  createTextComponentElement,
  isTextComponentType,
  TEXT_COMPONENT_TYPES,
  TEXT_COMPONENT_VARIANTS,
  type TextComponentMeta,
  type TextComponentType,
  type TextComponentVariant,
} from '../../text/textComponents';
import {
  describePlacementDecision,
  findAssociatedMain,
  resolveComponentPlacement,
} from '../../text/componentPlacement';
import {
  applyCommentMarkInDocument,
  ensureRichText,
  resolveQuoteAnchor,
  type QuoteAnchorSpec,
} from '../../text/textFeatures';
import { richTextToPlainText } from '../../text/richText';
import { CanvasAgentParseError } from './parseErrors';

export type CreateTextComponentOperation = {
  type: 'create_text_component';
  component: TextComponentType;
  content: string;
  /** Temporary plan ref (layout / association). */
  ref?: string;
  /** Associate with an existing TextElement (or plan ref resolved at execute). */
  associated_element_id?: string;
  /** Semantic warning variant. */
  variant?: TextComponentVariant;
  /** Optional rich_text for main_text only. */
  rich_text?: unknown;
};

export type AddLinkedCommentOperation = {
  type: 'add_linked_comment';
  target_element_id: string;
  anchor: QuoteAnchorSpec;
  comment: string;
  comment_type?: 'explanation' | 'correction' | 'suggestion' | 'question';
};

export type UpdateTextComponentOperation = {
  type: 'update_text_component';
  target_element_id: string;
  content: string;
};

export type TextComponentOperation =
  | CreateTextComponentOperation
  | AddLinkedCommentOperation
  | UpdateTextComponentOperation;

export const TEXT_COMPONENT_OPERATION_TYPES = [
  'create_text_component',
  'add_linked_comment',
  'update_text_component',
] as const;

export function isTextComponentOperationType(
  t: string,
): t is TextComponentOperation['type'] {
  return (TEXT_COMPONENT_OPERATION_TYPES as readonly string[]).includes(t);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parseAnchor(raw: unknown, path: string): QuoteAnchorSpec {
  if (!isRecord(raw)) {
    throw new CanvasAgentParseError('schema', `${path} must be an object.`);
  }
  if (typeof raw.quote !== 'string' || !raw.quote.trim()) {
    throw new CanvasAgentParseError('schema', `${path}.quote must be a non-empty string.`);
  }
  const anchor: QuoteAnchorSpec = { quote: raw.quote.trim() };
  if (typeof raw.block_id === 'string' && raw.block_id.trim()) {
    anchor.block_id = raw.block_id.trim();
  }
  if (typeof raw.block_ref === 'string' && raw.block_ref.trim()) {
    anchor.block_ref = raw.block_ref.trim();
  }
  if (raw.occurrence !== undefined) {
    if (
      typeof raw.occurrence !== 'number' ||
      !Number.isInteger(raw.occurrence) ||
      raw.occurrence < 0
    ) {
      throw new CanvasAgentParseError(
        'schema',
        `${path}.occurrence must be a non-negative integer.`,
      );
    }
    anchor.occurrence = raw.occurrence;
  }
  return anchor;
}

export function parseTextComponentOperation(
  raw: Record<string, unknown>,
): TextComponentOperation {
  const type = raw.type;
  if (typeof type !== 'string' || !isTextComponentOperationType(type)) {
    throw new CanvasAgentParseError('schema', 'Unknown text component operation.');
  }

  if (type === 'create_text_component') {
    const component = raw.component ?? raw.component_type;
    if (!isTextComponentType(component)) {
      throw new CanvasAgentParseError(
        'schema',
        `create_text_component.component must be one of: ${TEXT_COMPONENT_TYPES.join(', ')}.`,
      );
    }
    if (component === 'linked_comment') {
      throw new CanvasAgentParseError(
        'schema',
        'Use add_linked_comment for linked comments (requires a text anchor).',
      );
    }
    const content =
      typeof raw.content === 'string'
        ? raw.content
        : typeof raw.text === 'string'
          ? raw.text
          : '';
    if (!content.trim()) {
      throw new CanvasAgentParseError(
        'empty_text',
        'create_text_component needs non-empty content.',
      );
    }
    let variant: TextComponentVariant | undefined;
    if (raw.variant !== undefined) {
      if (
        typeof raw.variant !== 'string' ||
        !(TEXT_COMPONENT_VARIANTS as readonly string[]).includes(raw.variant)
      ) {
        throw new CanvasAgentParseError(
          'schema',
          `variant must be one of: ${TEXT_COMPONENT_VARIANTS.join(', ')}.`,
        );
      }
      variant = raw.variant as TextComponentVariant;
    }
    return {
      type,
      component,
      content: content.trim(),
      ...(typeof raw.ref === 'string' && raw.ref.trim()
        ? { ref: raw.ref.trim() }
        : {}),
      ...(typeof raw.associated_element_id === 'string' &&
      raw.associated_element_id.trim()
        ? { associated_element_id: raw.associated_element_id.trim() }
        : {}),
      ...(variant ? { variant } : {}),
      ...(raw.rich_text !== undefined ? { rich_text: raw.rich_text } : {}),
    };
  }

  if (type === 'add_linked_comment') {
    const target =
      raw.target_element_id ?? raw.target_id ?? raw.associated_element_id;
    if (typeof target !== 'string' || !target.trim()) {
      throw new CanvasAgentParseError(
        'missing_target',
        'add_linked_comment needs target_element_id.',
      );
    }
    const comment =
      typeof raw.comment === 'string'
        ? raw.comment
        : typeof raw.content === 'string'
          ? raw.content
          : typeof raw.text === 'string'
            ? raw.text
            : '';
    if (!comment.trim()) {
      throw new CanvasAgentParseError(
        'empty_text',
        'add_linked_comment needs non-empty comment text.',
      );
    }
    return {
      type,
      target_element_id: target.trim(),
      anchor: parseAnchor(raw.anchor, 'add_linked_comment.anchor'),
      comment: comment.trim(),
      ...(typeof raw.comment_type === 'string'
        ? {
            comment_type: raw.comment_type as AddLinkedCommentOperation['comment_type'],
          }
        : {}),
    };
  }

  // update_text_component
  const target = raw.target_element_id ?? raw.target_id;
  if (typeof target !== 'string' || !target.trim()) {
    throw new CanvasAgentParseError(
      'missing_target',
      'update_text_component needs target_element_id.',
    );
  }
  const content =
    typeof raw.content === 'string'
      ? raw.content
      : typeof raw.text === 'string'
        ? raw.text
        : '';
  if (!content.trim()) {
    throw new CanvasAgentParseError(
      'empty_text',
      'update_text_component needs non-empty content.',
    );
  }
  return {
    type: 'update_text_component',
    target_element_id: target.trim(),
    content: content.trim(),
  };
}

export type ComponentExecuteContext = {
  getElements: () => CanvasElement[];
  getCamera: () => Camera;
  getViewportSize?: () => ViewportSize;
  nextZIndex: () => number;
  addElement: (el: CanvasElement, select?: boolean) => void;
  updateElement: (id: string, updater: (el: CanvasElement) => CanvasElement) => void;
  /** Resolve plan ref → created element id within this transaction. */
  resolveRef?: (ref: string) => string | undefined;
  /** Record debug placement info. */
  onPlacementDebug?: (info: Record<string, unknown>) => void;
};

export function executeCreateTextComponent(
  op: CreateTextComponentOperation,
  ctx: ComponentExecuteContext,
): { createdId: string } {
  const elements = ctx.getElements();
  let associated: TextElement | null = null;
  if (op.associated_element_id) {
    const resolved =
      ctx.resolveRef?.(op.associated_element_id) ?? op.associated_element_id;
    associated = findAssociatedMain(elements, resolved);
  } else if (op.component !== 'main_text' && op.component !== 'title') {
    // Prefer last selected / last main_text
    associated = findAssociatedMain(elements, null);
  }

  // Title associates to main_text; if creating title after main in same plan, ref helps
  if (op.component === 'title' && op.associated_element_id) {
    const resolved =
      ctx.resolveRef?.(op.associated_element_id) ?? op.associated_element_id;
    const hit = elements.find((e) => e.id === resolved && e.type === 'text');
    if (hit && hit.type === 'text') associated = hit;
  }

  const meta: TextComponentMeta = {
    placementMode: 'auto',
    ...(associated ? { associatedElementId: associated.id } : {}),
    ...(op.variant ? { variant: op.variant } : {}),
  };

  const decision = resolveComponentPlacement({
    componentType: op.component,
    text: op.content,
    meta,
    associatedElement: associated,
    elements,
    camera: ctx.getCamera(),
    viewport: ctx.getViewportSize?.() ?? getDefaultViewportSize(),
  });

  ctx.onPlacementDebug?.(
    describePlacementDecision(decision, op.component),
  );

  const element = createTextComponentElement({
    componentType: op.component,
    text: op.content,
    position: { x: decision.x, y: decision.y },
    zIndex: ctx.nextZIndex(),
    width: decision.width,
    meta,
    metadata: {
      createdBy: 'ai',
      source: 'agent',
      operation: 'create_text_component',
      placementDecision: decision.reason,
    },
  });
  element.width = decision.width;
  element.height = decision.height;
  ctx.addElement(element, false);
  return { createdId: element.id };
}

export function executeAddLinkedComment(
  op: AddLinkedCommentOperation,
  ctx: ComponentExecuteContext,
): { createdId: string; updatedTargetId: string } {
  const elements = ctx.getElements();
  const target = elements.find((e) => e.id === op.target_element_id);
  if (!target || target.type !== 'text') {
    throw new Error(
      `add_linked_comment target "${op.target_element_id}" is not a TextElement.`,
    );
  }

  const doc = ensureRichText(target);
  const anchor = resolveQuoteAnchor(doc, op.anchor);
  // Temporary id for mark; real comment element id assigned next
  const tempMarkId = `pending_${Date.now()}`;
  const markedDoc = applyCommentMarkInDocument(doc, anchor, tempMarkId);

  const meta: TextComponentMeta = {
    placementMode: 'auto',
    associatedElementId: target.id,
    label: 'Comment',
    anchor: {
      targetElementId: target.id,
      blockId: anchor.blockId,
      start: anchor.start,
      end: anchor.end,
      quote: anchor.quote,
      status: anchor.status,
    },
  };

  const decision = resolveComponentPlacement({
    componentType: 'linked_comment',
    text: op.comment,
    meta,
    associatedElement: target,
    elements,
    camera: ctx.getCamera(),
    viewport: ctx.getViewportSize?.() ?? getDefaultViewportSize(),
  });

  ctx.onPlacementDebug?.(
    describePlacementDecision(decision, 'linked_comment'),
  );

  const commentEl = createTextComponentElement({
    componentType: 'linked_comment',
    text: op.comment,
    position: { x: decision.x, y: decision.y },
    zIndex: ctx.nextZIndex(),
    width: decision.width,
    meta,
    metadata: {
      createdBy: 'ai',
      source: 'agent',
      operation: 'add_linked_comment',
      placementDecision: decision.reason,
    },
  });
  commentEl.width = decision.width;
  commentEl.height = decision.height;

  // Re-apply mark with real comment id
  const finalDoc = applyCommentMarkInDocument(doc, anchor, commentEl.id);
  ctx.updateElement(target.id, (el) => {
    if (el.type !== 'text') return el;
    return {
      ...el,
      richText: finalDoc,
      text: richTextToPlainText(finalDoc),
    };
  });
  // Fix meta anchor + mark id already set to commentEl.id
  commentEl.componentMeta = {
    ...meta,
    anchor: { ...meta.anchor!, targetElementId: target.id },
  };
  void markedDoc;
  void tempMarkId;

  ctx.addElement(commentEl, false);
  return { createdId: commentEl.id, updatedTargetId: target.id };
}

export function executeUpdateTextComponent(
  op: UpdateTextComponentOperation,
  ctx: ComponentExecuteContext,
): void {
  ctx.updateElement(op.target_element_id, (el) => {
    if (el.type !== 'text') return el;
    const componentType = el.componentType ?? 'main_text';
    const size = resolveComponentPlacement({
      componentType,
      text: op.content,
      meta: el.componentMeta,
      associatedElement: null,
      elements: ctx.getElements().filter((e) => e.id !== el.id),
      camera: ctx.getCamera(),
      viewport: ctx.getViewportSize?.() ?? getDefaultViewportSize(),
    });
    // Keep width if user resized; grow height
    const nextWidth =
      el.metadata?.userResized === true ? el.width : Math.max(el.width, size.width);
    return {
      ...el,
      text: op.content,
      richText: undefined,
      width: nextWidth,
      height: Math.max(el.height, size.height),
      metadata: {
        ...el.metadata,
        lastEditedBy: 'ai',
        operation: 'update_text_component',
      },
    };
  });
}
