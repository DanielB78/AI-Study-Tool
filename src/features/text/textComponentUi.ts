/**
 * Manual UI helpers for textbook TextComponents.
 * Same creation path as AI ops (style + auto placement).
 */

import { useCanvasStore } from '../../store/canvasStore';
import type { TextElement } from '../../types/canvas';
import { touch } from '../../utils/ids';
import {
  createTextComponentElement,
  getComponentType,
  measureTextComponent,
  type TextComponentMeta,
  type TextComponentType,
  type TextComponentVariant,
} from './textComponents';
import {
  findAssociatedMain,
  resolveComponentPlacement,
} from './componentPlacement';
import {
  applyCommentMarkInDocument,
  ensureRichText,
  resolveQuoteAnchor,
  type QuoteAnchorSpec,
} from './textFeatures';
import { richTextToPlainText } from './richText';
import { getDefaultViewportSize } from '../ai/canvas/placement';

function resolveAssociatedId(elementId?: string): string | null {
  const store = useCanvasStore.getState();
  if (elementId) {
    const el = store.document.elements.find((e) => e.id === elementId);
    if (el?.type === 'text') return elementId;
  }
  const id = store.selectedIds[0];
  if (!id) return null;
  const el = store.document.elements.find((e) => e.id === id);
  return el?.type === 'text' ? id : null;
}

/** Create a textbook component via the shared placement/style path. */
export function uiCreateTextComponent(
  component: TextComponentType,
  content: string,
  opts?: {
    associatedElementId?: string;
    variant?: TextComponentVariant;
  },
): string | null {
  const text = content.trim();
  if (!text) return null;
  if (component === 'linked_comment') {
    throw new Error('Use uiAddLinkedComment for linked comments.');
  }

  const store = useCanvasStore.getState();
  const elements = store.document.elements;
  const assocId = opts?.associatedElementId ?? resolveAssociatedId() ?? undefined;
  const associated =
    component === 'main_text'
      ? null
      : findAssociatedMain(elements, assocId ?? null);

  const meta: TextComponentMeta = {
    placementMode: 'auto',
    ...(associated ? { associatedElementId: associated.id } : {}),
    ...(opts?.variant ? { variant: opts.variant } : {}),
  };

  const decision = resolveComponentPlacement({
    componentType: component,
    text,
    meta,
    associatedElement: associated,
    elements,
    camera: store.document.camera,
    viewport: getDefaultViewportSize(),
  });

  const zIndex =
    elements.reduce((m, e) => Math.max(m, e.zIndex), 0) + 1;

  const element = createTextComponentElement({
    componentType: component,
    text,
    position: { x: decision.x, y: decision.y },
    zIndex,
    width: decision.width,
    meta,
    metadata: {
      createdBy: 'user',
      source: 'ui',
      operation: 'create_text_component',
      placementDecision: decision.reason,
    },
  });
  element.width = decision.width;
  element.height = decision.height;

  store.pushHistory();
  store.addElement(element, true);
  store.persist();
  return element.id;
}

/** Add a permanently visible linked comment anchored to a quote. */
export function uiAddLinkedComment(
  anchor: QuoteAnchorSpec,
  comment: string,
  targetElementId?: string,
): string | null {
  const text = comment.trim();
  if (!text || !anchor.quote?.trim()) return null;

  const store = useCanvasStore.getState();
  const targetId = targetElementId ?? resolveAssociatedId();
  if (!targetId) return null;
  const target = store.document.elements.find((e) => e.id === targetId);
  if (!target || target.type !== 'text') return null;

  const doc = ensureRichText(target);
  const resolved = resolveQuoteAnchor(doc, anchor);

  const meta: TextComponentMeta = {
    placementMode: 'auto',
    associatedElementId: target.id,
    label: 'Comment',
    anchor: {
      targetElementId: target.id,
      blockId: resolved.blockId,
      start: resolved.start,
      end: resolved.end,
      quote: resolved.quote,
      status: resolved.status,
    },
  };

  const decision = resolveComponentPlacement({
    componentType: 'linked_comment',
    text,
    meta,
    associatedElement: target,
    elements: store.document.elements,
    camera: store.document.camera,
    viewport: getDefaultViewportSize(),
  });

  const zIndex =
    store.document.elements.reduce((m, e) => Math.max(m, e.zIndex), 0) + 1;

  const commentEl = createTextComponentElement({
    componentType: 'linked_comment',
    text,
    position: { x: decision.x, y: decision.y },
    zIndex,
    width: decision.width,
    meta,
    metadata: {
      createdBy: 'user',
      source: 'ui',
      operation: 'add_linked_comment',
      placementDecision: decision.reason,
    },
  });
  commentEl.width = decision.width;
  commentEl.height = decision.height;

  const finalDoc = applyCommentMarkInDocument(doc, resolved, commentEl.id);

  store.pushHistory();
  store.updateElement(target.id, (el) => {
    if (el.type !== 'text') return el;
    return touch({
      ...el,
      richText: finalDoc,
      text: richTextToPlainText(finalDoc),
    });
  });
  store.addElement(commentEl, true);
  store.persist();
  return commentEl.id;
}

/** Create or update the Title component associated with a main text. */
export function uiSetAssociatedTitle(
  titleText: string,
  mainElementId?: string,
): string | null {
  const text = titleText.trim();
  if (!text) return null;
  const store = useCanvasStore.getState();
  const mainId = mainElementId ?? resolveAssociatedId();
  if (!mainId) return null;
  const main = store.document.elements.find((e) => e.id === mainId);
  if (!main || main.type !== 'text') return null;

  const existing = store.document.elements.find(
    (e): e is TextElement =>
      e.type === 'text' &&
      getComponentType(e) === 'title' &&
      e.componentMeta?.associatedElementId === mainId,
  );

  if (existing) {
    const size = measureTextComponent({
      componentType: 'title',
      text,
      meta: existing.componentMeta,
      availableWidth: existing.width,
    });
    store.pushHistory();
    store.updateElement(existing.id, (el) => {
      if (el.type !== 'text') return el;
      return touch({
        ...el,
        text,
        richText: undefined,
        height: size.height,
        width:
          el.componentMeta?.placementMode === 'manual'
            ? el.width
            : Math.max(el.width, size.width),
      });
    });
    store.persist();
    return existing.id;
  }

  return uiCreateTextComponent('title', text, { associatedElementId: mainId });
}

export function uiCreateDefinition(
  content: string,
  associatedElementId?: string,
): string | null {
  return uiCreateTextComponent('definition', content, { associatedElementId });
}

export function uiCreateExample(
  content: string,
  associatedElementId?: string,
): string | null {
  return uiCreateTextComponent('example', content, { associatedElementId });
}

export function uiCreateWarning(
  content: string,
  associatedElementId?: string,
  variant?: TextComponentVariant,
): string | null {
  return uiCreateTextComponent('warning', content, {
    associatedElementId,
    variant,
  });
}

export function uiCreateExercise(
  content: string,
  associatedElementId?: string,
): string | null {
  return uiCreateTextComponent('exercise', content, { associatedElementId });
}
