/**
 * CanvasAgentOperationExecutor — validated ops → editor store mutations.
 * One LLM response = one history transaction (beginInteraction / endInteraction).
 */

import type {
  Camera,
  CanvasElement,
  EquationElement,
  StyleDefaults,
  TextElement,
} from '../../../types/canvas';
import { ragSync } from '../../rag/ragSync';
import { createAiTextElement, estimateTextHeight } from '../canvas/createAiTextElement';
import { createAiEquationElement } from '../canvas/createAiEquationElement';
import { measureEquationSize } from '../../equations/latex';
import {
  AI_TEXT_DEFAULT_WIDTH,
  getDefaultViewportSize,
  type ViewportSize,
} from '../canvas/placement';
import type { CanvasOperation, Placement, RelativePlacement } from './operations';
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
  /** Delete elements by id (skips locked). Must update RAG for removed text/equations. */
  deleteElements: (ids: string[]) => void;
  setSelection: (ids: string[]) => void;
  persist?: () => void;
  getViewportSize?: () => ViewportSize;
  /** Override RAG hook for tests. */
  indexText?: (boardId: string, element: TextElement) => void;
  indexEquation?: (boardId: string, element: EquationElement) => void;
  updateGeometry?: (
    boardId: string,
    element: TextElement | EquationElement,
  ) => void;
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

type Indexable = TextElement | EquationElement;

/**
 * Resolve relative placement anchors that use same-plan operation indices.
 * Prefer anchor_element_id when both are present.
 */
function materializePlacement(
  placement: Placement,
  createdByOpIndex: ReadonlyMap<number, string>,
): Placement {
  if (placement.mode !== 'relative_to_element') return placement;
  if (placement.anchor_element_id) {
    return {
      mode: 'relative_to_element',
      relation: placement.relation,
      anchor_element_id: placement.anchor_element_id,
    } satisfies RelativePlacement;
  }
  if (placement.anchor_operation_index !== undefined) {
    const id = createdByOpIndex.get(placement.anchor_operation_index);
    if (id) {
      return {
        mode: 'relative_to_element',
        relation: placement.relation,
        anchor_element_id: id,
      } satisfies RelativePlacement;
    }
  }
  return placement;
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
  const indexEquation =
    target.indexEquation ?? ((b, el) => ragSync.indexEquation(b, el));
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
  const contentDirty = new Set<string>();
  /** opIndex → createdElementId for create_text / create_equation */
  const createdByOpIndex = new Map<number, string>();

  const transactionId = target.beginInteraction();
  try {
    for (let opIndex = 0; opIndex < operations.length; opIndex++) {
      const op = operations[opIndex]!;

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
          placement: materializePlacement(op.placement, createdByOpIndex),
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
        createdByOpIndex.set(opIndex, element.id);
      } else if (op.type === 'create_equation') {
        const camera = target.getCamera();
        const elements = target.getElements();
        const probe = createAiEquationElement(op.latex, { x: 0, y: 0 }, {
          zIndex: 0,
          style,
        });
        const placed = resolvePlacement({
          placement: materializePlacement(op.placement, createdByOpIndex),
          width: probe.width,
          height: probe.height,
          camera,
          elements,
          viewport,
        });
        const zIndex = target.nextZIndex();
        const element = createAiEquationElement(
          op.latex,
          { x: placed.x, y: placed.y },
          { zIndex, style },
        );
        target.addElement(element, false);
        createdIds.push(element.id);
        createdByOpIndex.set(opIndex, element.id);
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
        contentDirty.add(id);
      } else if (op.type === 'update_equation') {
        const id = op.target_element_id;
        target.updateElement(id, (el) => {
          if (el.type !== 'equation') return el;
          const size = measureEquationSize(op.latex, {
            fontSize: el.fontSize,
            displayMode: el.displayMode !== 'inline',
          });
          return {
            ...el,
            latex: op.latex,
            width: size.width,
            height: size.height,
            metadata: {
              ...el.metadata,
              lastEditedBy: 'ai',
              source: 'agent',
              operation: 'update_equation',
            },
          };
        });
        updatedIds.push(id);
        contentDirty.add(id);
      } else if (op.type === 'move_text') {
        const id = op.target_element_id;
        const elements = target.getElements();
        const current = elements.find((e) => e.id === id);
        if (!current || current.type !== 'text') continue;
        const others = elements.filter((e) => e.id !== id);
        const placed = resolvePlacement({
          placement: materializePlacement(op.placement, createdByOpIndex),
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
      } else if (op.type === 'move_equation') {
        const id = op.target_element_id;
        const elements = target.getElements();
        const current = elements.find((e) => e.id === id);
        if (!current || current.type !== 'equation') continue;
        const others = elements.filter((e) => e.id !== id);
        const placed = resolvePlacement({
          placement: materializePlacement(op.placement, createdByOpIndex),
          width: current.width,
          height: current.height,
          camera: target.getCamera(),
          elements: others,
          viewport,
        });
        target.updateElement(id, (el) => {
          if (el.type !== 'equation') return el;
          return {
            ...el,
            x: placed.x,
            y: placed.y,
            metadata: {
              ...el.metadata,
              lastEditedBy: 'ai',
              source: 'agent',
              operation: 'move_equation',
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
      } else if (op.type === 'resize_equation') {
        const id = op.target_element_id;
        target.updateElement(id, (el) => {
          if (el.type !== 'equation') return el;
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
              operation: 'resize_equation',
            },
          };
        });
        resizedIds.push(id);
        geometryDirty.add(id);
      } else if (op.type === 'delete_text' || op.type === 'delete_equation') {
        const id = op.target_element_id;
        target.deleteElements([id]);
        deletedIds.push(id);
        geometryDirty.delete(id);
        contentDirty.delete(id);
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
        // Style-only: do NOT re-index or updateGeometry.
      }
    }
  } finally {
    target.endInteraction();
  }

  // Content updates: re-index (addElement already indexes creates).
  const latest = target.getElements();
  for (const id of contentDirty) {
    const el = latest.find((e) => e.id === id);
    if (el?.type === 'text') {
      indexText(boardId, el);
    } else if (el?.type === 'equation') {
      indexEquation(boardId, el);
    }
  }

  // Move / resize: geometry only — no re-embed.
  for (const id of geometryDirty) {
    const el = latest.find((e) => e.id === id);
    if (el?.type === 'text' || el?.type === 'equation') {
      updateGeometry(boardId, el as Indexable);
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
