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
  setSelection: (ids: string[]) => void;
  persist?: () => void;
  getViewportSize?: () => ViewportSize;
  /** Override RAG hook for tests. */
  indexText?: (boardId: string, element: TextElement) => void;
}

export interface ExecuteAgentOpsResult {
  createdIds: string[];
  updatedIds: string[];
  affectedIds: string[];
  transactionId: string | null;
}

/**
 * Execute ALL operations atomically after prior validation.
 * Call only with a fully validated operation list.
 */
export function executeCanvasOperations(
  operations: readonly CanvasOperation[],
  target: AgentExecutorTarget,
): ExecuteAgentOpsResult {
  if (operations.length === 0) {
    return { createdIds: [], updatedIds: [], affectedIds: [], transactionId: null };
  }

  const style = target.getStyle();
  const viewport = target.getViewportSize?.() ?? getDefaultViewportSize();
  const boardId = target.getBoardId();
  const indexText = target.indexText ?? ((b, el) => ragSync.indexText(b, el));

  const createdIds: string[] = [];
  const updatedIds: string[] = [];

  const transactionId = target.beginInteraction();
  try {
    for (const op of operations) {
      if (op.type === 'create_text') {
        const camera = target.getCamera();
        // Include elements created earlier in this same batch for collision.
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
        const element = createAiTextElement(op.text, { x: placed.x, y: placed.y }, {
          zIndex,
          style,
          width,
          metadata: { createdBy: 'ai', source: 'agent', operation: 'create_text' },
        });
        element.height = height;
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

  const affectedIds = [...createdIds, ...updatedIds];
  if (affectedIds.length > 0) {
    target.setSelection(affectedIds);
  }
  target.persist?.();

  return { createdIds, updatedIds, affectedIds, transactionId };
}
