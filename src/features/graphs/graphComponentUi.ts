/**
 * Manual UI helpers for graph textbook components.
 * Same creation path as AI ops.
 */

import { useCanvasStore } from '../../store/canvasStore';
import type { GraphElement, TextElement } from '../../types/canvas';
import {
  executeAddGraphCaption,
  executeAddGraphComment,
  executeAddGraphObservation,
  executeAddGraphToText,
  executeAnnotateGraphPoint,
  executeSetGraphTitle,
  type GraphComponentExecuteContext,
} from '../ai/agent/graphComponentOperations';
import { getDefaultViewportSize } from '../ai/canvas/placement';
import { DEFAULT_GRAPH_VIEWPORT } from './types';

function makeCtx(): GraphComponentExecuteContext {
  const store = useCanvasStore.getState();
  return {
    getElements: () => useCanvasStore.getState().document.elements,
    getCamera: () => useCanvasStore.getState().document.camera,
    getViewportSize: getDefaultViewportSize,
    nextZIndex: () => useCanvasStore.getState().nextZIndex(),
    addElement: (el, select) =>
      useCanvasStore.getState().addElement(el, select),
    updateElement: (id, updater) =>
      useCanvasStore.getState().updateElement(id, updater),
  };
}

function withHistory(fn: () => void): void {
  const store = useCanvasStore.getState();
  store.pushHistory();
  fn();
  store.persist();
}

export function uiAddGraphToText(
  targetTextId: string,
  expression = 'sin(x)',
): string | null {
  const store = useCanvasStore.getState();
  const target = store.document.elements.find((e) => e.id === targetTextId);
  if (!target || target.type !== 'text') return null;
  let createdId: string | null = null;
  withHistory(() => {
    const result = executeAddGraphToText(
      {
        type: 'add_graph_to_text',
        target_element_id: targetTextId,
        expressions: [
          {
            expression,
            visible: true,
            domain_min: null,
            domain_max: null,
          },
        ],
        viewport: {
          x_min: DEFAULT_GRAPH_VIEWPORT.xMin,
          x_max: DEFAULT_GRAPH_VIEWPORT.xMax,
          y_min: DEFAULT_GRAPH_VIEWPORT.yMin,
          y_max: DEFAULT_GRAPH_VIEWPORT.yMax,
        },
      },
      makeCtx(),
    );
    createdId = result.createdId;
  });
  return createdId;
}

export function uiSetGraphTitle(graphId: string, text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  withHistory(() => {
    executeSetGraphTitle(
      { type: 'set_graph_title', target_element_id: graphId, text: t },
      makeCtx(),
    );
  });
  return true;
}

export function uiAddGraphCaption(graphId: string, text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  withHistory(() => {
    executeAddGraphCaption(
      { type: 'add_graph_caption', target_element_id: graphId, text: t },
      makeCtx(),
    );
  });
  return true;
}

export function uiAddGraphObservation(graphId: string, text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  withHistory(() => {
    executeAddGraphObservation(
      { type: 'add_graph_observation', target_element_id: graphId, text: t },
      makeCtx(),
    );
  });
  return true;
}

export function uiAddGraphComment(
  graphId: string,
  comment: string,
  expressionId?: string,
): boolean {
  const t = comment.trim();
  if (!t) return false;
  withHistory(() => {
    executeAddGraphComment(
      {
        type: 'add_graph_comment',
        target_element_id: graphId,
        comment: t,
        ...(expressionId ? { anchor: { expression_id: expressionId } } : {}),
      },
      makeCtx(),
    );
  });
  return true;
}

export function uiAnnotateGraphPoint(
  graphId: string,
  x: number,
  label: string,
  expressionId?: string,
): boolean {
  const t = label.trim();
  if (!t) return false;
  withHistory(() => {
    executeAnnotateGraphPoint(
      {
        type: 'annotate_graph_point',
        target_element_id: graphId,
        x,
        label: t,
        ...(expressionId ? { expression_id: expressionId } : {}),
      },
      makeCtx(),
    );
  });
  return true;
}

export function uiAttachExistingGraphToText(
  graphId: string,
  textId: string,
): boolean {
  const store = useCanvasStore.getState();
  const graph = store.document.elements.find((e) => e.id === graphId);
  const text = store.document.elements.find((e) => e.id === textId);
  if (!graph || graph.type !== 'graph' || !text || text.type !== 'text') {
    return false;
  }
  const order = store.document.elements.filter(
    (e): e is GraphElement =>
      e.type === 'graph' && e.association?.associatedElementId === textId,
  ).length;
  withHistory(() => {
    store.updateElement(graphId, (el) => {
      if (el.type !== 'graph') return el;
      return {
        ...el,
        association: {
          associatedElementId: textId,
          placementMode: el.association?.placementMode ?? 'manual',
          order,
        },
      };
    });
  });
  return true;
}

/** Resolve selected graph id. */
export function selectedGraphId(): string | null {
  const store = useCanvasStore.getState();
  const id = store.selectedIds[0];
  if (!id) return null;
  const el = store.document.elements.find((e) => e.id === id);
  return el?.type === 'graph' ? id : null;
}

export function selectedTextId(): string | null {
  const store = useCanvasStore.getState();
  const id = store.selectedIds[0];
  if (!id) return null;
  const el = store.document.elements.find((e) => e.id === id);
  return el?.type === 'text' ? id : null;
}

export type { TextElement };
