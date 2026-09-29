/**
 * CanvasAgentOperationExecutor — validated ops → editor store mutations.
 * One LLM response = one history transaction (beginInteraction / endInteraction).
 */

import type { Camera, CanvasElement, StyleDefaults, TextElement } from '../../../types/canvas';
import { ragSync } from '../../rag/ragSync';
import { createAiTextElement, estimateTextHeight } from '../canvas/createAiTextElement';
import {
  AI_TEXT_DEFAULT_WIDTH,
  getDefaultViewportSize,
  type ViewportSize,
} from '../canvas/placement';
import type { CanvasOperation } from './operations';
import { resolvePlacement } from './placementService';
import { applyTextStylePatch } from './textStyle';

export interface AgentExecutorTarget {
  getCamera: () => Camera;
  getElements: () => CanvasElement[];
  getStyle: () => StyleDefaults;
  nextZIndex: () => number;
  getBoardId: () => string;
  beginInteraction: () => string;
  endInteraction: () => void;
  addElement: (element: CanvasElement, select?: boolean) => void;
  updateElement: (id: string, updater: (el: CanvasElement) => CanvasElement) => void;
  /** Delete elements by id (skips locked). Must update RAG for removed text. */
  deleteElements: (ids: string[]) => void;
  setSelection: (ids: string[]) => void;
  persist?: () => void;
  getViewportSize?: () => ViewportSize;
  /** Override RAG hook for tests. */
  indexText?: (boardId: string, element: TextElement) => void;
  updateGeometry?: (boardId: string, element: TextElement) => void;
  deleteIndexed?: (boardId: string, elementIds: string[]) => void;
}

export interface ExecuteAgentOpsResult {
  createdIds: string[];
  updatedIds: string[];
  movedIds: string[];
  resizedIds: string[];
  deletedIds: string[];
  /** Style-only updates — do NOT re-index or update geometry. */
  styledIds: string[];
  affectedIds: string[];
  transactionId: string | null;
}

/**
 * Execute ALL operations atomically after prior validation.
 * Call only with a fully validated operation list.
 * Order is preserved.
 */
export function executeCanvasOperations(
  operations: readonly CanvasOperation[],
  target: AgentExecutorTarget,
): ExecuteAgentOpsResult {
  if (operations.length === 0) {
    return {
      createdIds: [],
      updatedIds: [],
      movedIds: [],
      resizedIds: [],
      deletedIds: [],
      styledIds: [],
      affectedIds: [],
      transactionId: null,
    };
  }

  const style = target.getStyle();
  const viewport = target.getViewportSize?.() ?? getDefaultViewportSize();
  const boardId = target.getBoardId();
  const indexText = target.indexText ?? ((b, el) => ragSync.indexText(b, el));
  const updateGeometry =
    target.updateGeometry ?? ((b, el) => ragSync.updateGeometry(b, el));
  const deleteIndexed =
    target.deleteIndexed ?? ((b, ids) => ragSync.deleteMany(b, ids));

  const createdIds: string[] = [];
  const updatedIds: string[] = [];
  const movedIds: string[] = [];
  const resizedIds: string[] = [];
  const deletedIds: string[] = [];
  const styledIds: string[] = [];
  const geometryDirty = new Set<string>();

  const transactionId = target.beginInteraction();
  try {
    for (const op of operations) {
      if (op.type === 'create_text') {
        const camera = target.getCamera();
        const elements = target.getElements();
        const width = AI_TEXT_DEFAULT_WIDTH;
        const height = estimateTextHeight(op.text, width, {
          fontSize: style.fontSize,
          lineHeight: style.lineHeight,
          textPadding: Math.max(style.textPadding, 12),
        });
        const placed = resolvePlacement({
          placement: op.placement,
          width,
          height,
          camera,
          elements,
          viewport,
        });
        const zIndex = target.nextZIndex();
        let element = createAiTextElement(op.text, { x: placed.x, y: placed.y }, {
          zIndex,
          style,
          width,
          metadata: { createdBy: 'ai', source: 'agent', operation: 'create_text' },
        });
        element.height = height;
        if (op.style) {
          element = applyTextStylePatch(element, op.style);
        }
        target.addElement(element, false);
        createdIds.push(element.id);
      } else if (op.type === 'update_text') {
        const id = op.target_element_id;
        target.updateElement(id, (el) => {
          if (el.type !== 'text') return el;
          const width = el.width;
          const padding = el.padding;
          const height = estimateTextHeight(op.text, width, {
            fontSize: el.fontSize,
            lineHeight: el.lineHeight,
            textPadding: padding,
          });
          return {
            ...el,
            text: op.text,
            height,
            metadata: {
              ...el.metadata,
              lastEditedBy: 'ai',
              source: 'agent',
            },
          };
        });
        updatedIds.push(id);
      } else if (op.type === 'move_text') {
        const id = op.target_element_id;
        const elements = target.getElements();
        const current = elements.find((e) => e.id === id);
        if (!current || current.type !== 'text') continue;
        const others = elements.filter((e) => e.id !== id);
        const placed = resolvePlacement({
          placement: op.placement,
          width: current.width,
          height: current.height,
          camera: target.getCamera(),
          elements: others,
          viewport,
        });
        target.updateElement(id, (el) => {
          if (el.type !== 'text') return el;
          return {
            ...el,
            x: placed.x,
            y: placed.y,
            metadata: {
              ...el.metadata,
              lastEditedBy: 'ai',
              source: 'agent',
              operation: 'move_text',
            },
          };
        });
        movedIds.push(id);
        geometryDirty.add(id);
      } else if (op.type === 'resize_text') {
        const id = op.target_element_id;
        target.updateElement(id, (el) => {
          if (el.type !== 'text') return el;
          const width = op.width ?? el.width;
          const height = op.height ?? el.height;
          return {
            ...el,
            width,
            height,
            metadata: {
              ...el.metadata,
              lastEditedBy: 'ai',
              source: 'agent',
              operation: 'resize_text',
            },
          };
        });
        resizedIds.push(id);
        geometryDirty.add(id);
      } else if (op.type === 'delete_text') {
        const id = op.target_element_id;
        target.deleteElements([id]);
        deletedIds.push(id);
        geometryDirty.delete(id);
      } else if (op.type === 'update_text_style') {
        const id = op.target_element_id;
        target.updateElement(id, (el) => {
          if (el.type !== 'text') return el;
          const styled = applyTextStylePatch(el, op.style);
          return {
            ...styled,
            metadata: {
              ...styled.metadata,
              lastEditedBy: 'ai',
              source: 'agent',
              operation: 'update_text_style',
            },
          };
        });
        styledIds.push(id);
        // Style-only: do NOT re-index (indexText) or updateGeometry.
      }
    }
  } finally {
    target.endInteraction();
  }

  // Content updates: re-index (addElement already indexes creates).
  const latest = target.getElements();
  for (const id of updatedIds) {
    const el = latest.find((e) => e.id === id);
    if (el?.type === 'text') {
      indexText(boardId, el);
    }
  }

  // Move / resize: geometry only — no re-embed.
  for (const id of geometryDirty) {
    const el = latest.find((e) => e.id === id);
    if (el?.type === 'text') {
      updateGeometry(boardId, el);
    }
  }

  // Delete: ensure index removed (store deleteElements should also call RAG;
  // call again for test overrides / safety).
  if (deletedIds.length > 0) {
    deleteIndexed(boardId, deletedIds);
  }

  const affectedIds = [
    ...new Set([
      ...createdIds,
      ...updatedIds,
      ...movedIds,
      ...resizedIds,
      ...deletedIds,
      ...styledIds,
    ]),
  ];
  const remaining = affectedIds.filter((id) => !deletedIds.includes(id));
  if (remaining.length > 0) {
    target.setSelection(remaining);
  } else {
    target.setSelection([]);
  }
  target.persist?.();

  return {
    createdIds,
    updatedIds,
    movedIds,
    resizedIds,
    deletedIds,
    styledIds,
    affectedIds,
    transactionId,
  };
}
