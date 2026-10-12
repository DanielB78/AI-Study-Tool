/**
 * CanvasAgentOperationExecutor — validated ops → editor store mutations.
 * One LLM response = one history transaction (beginInteraction / endInteraction).
 */

import type { Camera, CanvasElement, StyleDefaults, TextElement } from '../../../types/canvas';
import { ragSync } from '../../rag/ragSync';
import { createAiTextElement } from '../canvas/createAiTextElement';
import type { RichTextDocument } from '../../text/richText';
import { richTextToPlainText } from '../../text/richText';
import {
  TextElementAutoSizer,
  textElementAllowsAiAutoWidth,
  textElementIsUserResized,
} from '../../text/textAutoSizer';
import { createAiEquationElement } from '../canvas/createAiEquationElement';
import { createAiGraphElement } from '../canvas/createAiGraphElement';
import {
  getDefaultViewportSize,
  type ViewportSize,
} from '../canvas/placement';
import type {
  AnyLayoutSpec,
  CanvasAgentResponse,
  CanvasOperation,
} from './operations';
import { resolvePlacement } from './placementService';
import type { NoteStructure } from '../../structures/types';
import { isNodeSection, isStructureField } from '../../structures/types';
import {
  computeStructuredNoteBounds,
  instantiateNoteStructure,
} from '../../structures/instantiation';
import type { StructureFieldValue } from '../../structures/fieldValues';
import {
  DEFAULT_GRAPH_HEIGHT,
  DEFAULT_GRAPH_WIDTH,
} from '../../graphs/types';
import {
  applyGraphEditOperation,
  isGraphEditOperationType,
  type GraphEditOperation,
} from './graphOperations';
import { isGridCreatableOp } from './layout/measure';
import { resolveGridPlan, type ResolveGridPlanResult } from './layout/resolveGridPlan';
import type { LayoutDebugInfo } from './layout/types';

export interface AgentExecutorTarget {
  getCamera: () => Camera;
  getElements: () => CanvasElement[];
  getStyle: () => StyleDefaults;
  nextZIndex: () => number;
  getBoardId: () => string;
  beginInteraction: () => void;
  endInteraction: () => void;
  addElement: (element: CanvasElement, select?: boolean) => void;
  updateElement: (id: string, updater: (el: CanvasElement) => CanvasElement) => void;
  setSelection: (ids: string[]) => void;
  persist?: () => void;
  getViewportSize?: () => ViewportSize;
  /** Override RAG hook for tests. */
  indexText?: (boardId: string, element: TextElement) => void;
  /** Resolve a saved note structure by id (required for create_structured_note). */
  getStructureById?: (id: string) => NoteStructure | null;
}

export interface ExecuteAgentOpsResult {
  createdIds: string[];
  updatedIds: string[];
  affectedIds: string[];
  structureInstanceIds: string[];
  layoutDebug?: LayoutDebugInfo;
}

function asPlan(
  operationsOrPlan: readonly CanvasOperation[] | CanvasAgentResponse,
): CanvasAgentResponse {
  if (Array.isArray(operationsOrPlan)) {
    return { operations: [...operationsOrPlan] };
  }
  return operationsOrPlan as CanvasAgentResponse;
}

function fieldValuesForStructure(
  op: Extract<CanvasOperation, { type: 'create_structured_note' }>,
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

function createOne(
  op: CanvasOperation,
  target: AgentExecutorTarget,
  style: StyleDefaults,
  viewport: ViewportSize,
  forced?: { x: number; y: number; width: number; height: number },
): { createdIds: string[]; structureInstanceIds: string[] } {
  const createdIds: string[] = [];
  const structureInstanceIds: string[] = [];

  if (op.type === 'create_text') {
    const camera = target.getCamera();
    const elements = target.getElements();
    const richText = op.rich_text as RichTextDocument | undefined;
    const padding = Math.max(style.textPadding, 12);
    const measured = TextElementAutoSizer.measure({
      content: { text: op.text, richText },
      availableWidth: forced?.width,
      style: {
        fontSize: style.fontSize,
        fontFamily: style.fontFamily,
        fontWeight: style.fontWeight,
        fontItalic: style.fontItalic,
        underline: style.underline,
        lineHeight: style.lineHeight,
        color: style.textColor,
        padding,
      },
      autoSized: true,
    });
    const width = forced?.width ?? measured.width;
    const height = forced?.height ?? measured.height;
    const placed = forced
      ? { x: forced.x, y: forced.y, width, height }
      : resolvePlacement({
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
      richText,
      autoSize: true,
      metadata: {
        createdBy: 'ai',
        source: 'agent',
        operation: 'create_text',
        autoSize: true,
      },
    });
    element.height = height;
    target.addElement(element, false);
    createdIds.push(element.id);
  } else if (op.type === 'create_equation') {
    const camera = target.getCamera();
    const elements = target.getElements();
    const probe = createAiEquationElement(op.latex, { x: 0, y: 0 }, {
      zIndex: 0,
      style,
    });
    const width = forced?.width ?? probe.width;
    const height = forced?.height ?? probe.height;
    const placed = forced
      ? { x: forced.x, y: forced.y, width, height }
      : resolvePlacement({
          placement: op.placement,
          width,
          height,
          camera,
          elements,
          viewport,
        });
    const zIndex = target.nextZIndex();
    const element = createAiEquationElement(op.latex, { x: placed.x, y: placed.y }, {
      zIndex,
      style,
    });
    if (forced) {
      element.width = width;
      element.height = height;
    }
    target.addElement(element, false);
    createdIds.push(element.id);
  } else if (op.type === 'create_structured_note') {
    const structure = target.getStructureById?.(op.structure_id) ?? null;
    if (!structure) {
      throw new Error(`Unknown structure "${op.structure_id}" at execution time.`);
    }
    const fieldValues = fieldValuesForStructure(op, structure);
    const bounds = computeStructuredNoteBounds(structure, fieldValues);
    const camera = target.getCamera();
    const elements = target.getElements();
    const width = forced?.width ?? bounds.width;
    const height = forced?.height ?? bounds.height;
    const placed = forced
      ? { x: forced.x, y: forced.y, width, height }
      : resolvePlacement({
          placement: op.placement,
          width,
          height,
          camera,
          elements,
          viewport,
        });

    const instantiated = instantiateNoteStructure({
      structure,
      fieldValues,
      origin: { x: placed.x, y: placed.y },
      style,
      nextZIndex: () => target.nextZIndex(),
    });
    structureInstanceIds.push(instantiated.structureInstanceId);
    for (const el of instantiated.elements) {
      target.addElement(el, false);
      createdIds.push(el.id);
    }
  } else if (op.type === 'create_graph') {
    const camera = target.getCamera();
    const elements = target.getElements();
    const width = forced?.width ?? DEFAULT_GRAPH_WIDTH;
    const height = forced?.height ?? DEFAULT_GRAPH_HEIGHT;
    const placed = forced
      ? { x: forced.x, y: forced.y, width, height }
      : resolvePlacement({
          placement: op.placement,
          width,
          height,
          camera,
          elements,
          viewport,
        });
    const zIndex = target.nextZIndex();
    const canonical = op.expressions.map((e) => e.expression);
    const element = createAiGraphElement(op, canonical, {
      x: placed.x,
      y: placed.y,
      zIndex,
      width,
      height,
    });
    target.addElement(element, false);
    createdIds.push(element.id);
  }

  return { createdIds, structureInstanceIds };
}

/**
 * Execute ALL operations atomically after prior validation.
 * Accepts a bare operations list (legacy) or a full CanvasAgentResponse with layout.
 */
export function executeCanvasOperations(
  operationsOrPlan: readonly CanvasOperation[] | CanvasAgentResponse,
  target: AgentExecutorTarget,
): ExecuteAgentOpsResult {
  const plan = asPlan(operationsOrPlan);
  const operations = plan.operations;
  if (operations.length === 0) {
    return {
      createdIds: [],
      updatedIds: [],
      affectedIds: [],
      structureInstanceIds: [],
    };
  }

  const style = target.getStyle();
  const viewport = target.getViewportSize?.() ?? getDefaultViewportSize();
  const boardId = target.getBoardId();
  const indexText = target.indexText ?? ((b, el) => ragSync.indexText(b, el));

  const createdIds: string[] = [];
  const updatedIds: string[] = [];
  const structureInstanceIds: string[] = [];
  let layoutDebug: LayoutDebugInfo | undefined;

  // Resolve grid BEFORE mutating — failure commits nothing.
  let gridResolved: ResolveGridPlanResult | null = null;
  const layout: AnyLayoutSpec | undefined = plan.layout;
  if (layout) {
    gridResolved = resolveGridPlan({
      layout,
      operations,
      camera: target.getCamera(),
      elements: target.getElements(),
      style,
      viewport,
      getStructureById: target.getStructureById,
    });
    layoutDebug = gridResolved.debug;
  }

  target.beginInteraction();
  try {
    for (const op of operations) {
      if (op.type === 'update_text') {
        const id = op.target_element_id;
        target.updateElement(id, (el) => {
          if (el.type !== 'text') return el;
          const richText = op.rich_text as RichTextDocument | undefined;
          const plain = richText ? richTextToPlainText(richText) : op.text;
          const padding = el.padding;
          const styleCfg = {
            fontSize: el.fontSize,
            fontFamily: el.fontFamily,
            fontWeight: el.fontWeight,
            fontItalic: el.fontItalic,
            underline: el.underline,
            lineHeight: el.lineHeight,
            color: el.color,
            padding,
          };
          const allowsAutoWidth = textElementAllowsAiAutoWidth(el.metadata);
          const userResized = textElementIsUserResized(el.metadata);
          const measured = TextElementAutoSizer.measure({
            content: { text: plain, richText },
            availableWidth: allowsAutoWidth ? undefined : el.width,
            style: styleCfg,
            autoSized: allowsAutoWidth,
          });
          // Auto-sized AI boxes: take content-preferred width + height.
          // Otherwise keep width; expand height so content never clips.
          const nextWidth = allowsAutoWidth ? measured.width : el.width;
          const nextHeight = allowsAutoWidth
            ? measured.height
            : Math.max(el.height, measured.height);
          return {
            ...el,
            text: plain,
            richText: richText ?? undefined,
            width: nextWidth,
            height: nextHeight,
            metadata: {
              ...el.metadata,
              lastEditedBy: 'ai',
              source: 'agent',
              ...(allowsAutoWidth ? { autoSize: true } : {}),
              ...(userResized ? { userResized: true } : {}),
            },
          };
        });
        updatedIds.push(id);
        continue;
      }

      if (isGraphEditOperationType(op.type)) {
        const editOp = op as GraphEditOperation;
        const graphId = editOp.graph_id;
        target.updateElement(graphId, (el) => {
          if (el.type !== 'graph') return el;
          const next = applyGraphEditOperation(el, editOp);
          return {
            ...next,
            metadata: {
              ...next.metadata,
              lastEditedBy: 'ai',
              source: 'agent',
              operation: editOp.type,
            },
          };
        });
        updatedIds.push(graphId);
        continue;
      }

      if (isGridCreatableOp(op)) {
        const forced =
          gridResolved && op.ref ? gridResolved.byRef.get(op.ref) : undefined;
        const result = createOne(op, target, style, viewport, forced);
        createdIds.push(...result.createdIds);
        structureInstanceIds.push(...result.structureInstanceIds);
      }
    }
  } finally {
    target.endInteraction();
  }

  const latest = target.getElements();
  for (const id of [...createdIds, ...updatedIds]) {
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

  return {
    createdIds,
    updatedIds,
    affectedIds,
    structureInstanceIds,
    layoutDebug,
  };
}
