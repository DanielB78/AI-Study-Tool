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
import {
  applyTextFeatureOperation,
  isTextFeatureOperationType,
  type TextFeatureOperation,
} from './textFeatureOperations';
import {
  applyTextMathOperation,
  isTextMathOperationType,
  type TextMathOperation,
} from './textMathOperations';
import {
  executeAddEquationInterpretation,
  executeAddEquationSymbolDefinitions,
  executeAddEquationToText,
  executeAddTextToEquation,
  executeSetEquationTitle,
  executeUpdateEquation,
  isEquationComponentOperationType,
  type EquationComponentOperation,
} from './equationComponentOperations';
import {
  executeAddLinkedComment,
  executeCreateTextComponent,
  executeUpdateTextComponent,
  isTextComponentOperationType,
  type AddLinkedCommentOperation,
  type CreateTextComponentOperation,
  type TextComponentOperation,
  type UpdateTextComponentOperation,
} from './textComponentOperations';
import {
  executeAddGraphCaption,
  executeAddGraphComment,
  executeAddGraphObservation,
  executeAddGraphToText,
  executeAddTextToGraph,
  executeAnnotateGraphPoint,
  executeSetGraphTitle,
  isGraphComponentOperationType,
  type GraphComponentOperation,
} from './graphComponentOperations';
import {
  applyGraphAnnotationOperation,
  isGraphAnnotationOperationType,
  type GraphAnnotationOperation,
} from './graphAnnotationOperations';
import {
  getComponentType,
  type TextComponentType,
} from '../../text/textComponents';
import { isGridCreatableOp } from './layout/measure';
import { resolveGridPlan, type ResolveGridPlanResult } from './layout/resolveGridPlan';
import type { LayoutDebugInfo } from './layout/types';
import type { CreateTextOperation } from './operations';
import { CanvasAgentExecuteError } from './parseErrors';

/** Legacy create_text title/notes/comments → sibling textbook components. */
function spawnLegacyCreateTextComponents(
  main: TextElement,
  op: CreateTextOperation,
  target: AgentExecutorTarget,
): string[] {
  const created: string[] = [];
  const ctxBase = {
    getElements: () => target.getElements(),
    getCamera: () => target.getCamera(),
    getViewportSize: target.getViewportSize,
    nextZIndex: () => target.nextZIndex(),
    addElement: (el: CanvasElement, select?: boolean) =>
      target.addElement(el, select),
    updateElement: target.updateElement,
  };

  if (op.title?.trim()) {
    const { createdId } = executeCreateTextComponent(
      {
        type: 'create_text_component',
        component: 'title',
        content: op.title.trim(),
        associated_element_id: main.id,
      },
      ctxBase,
    );
    created.push(createdId);
  }

  for (const note of op.notes ?? []) {
    const component: TextComponentType =
      note.note_type === 'caution'
        ? 'warning'
        : note.note_type === 'important'
          ? 'definition'
          : note.note_type === 'reference'
            ? 'definition'
            : 'example';
    const { createdId } = executeCreateTextComponent(
      {
        type: 'create_text_component',
        component,
        content: note.text,
        associated_element_id: main.id,
        ...(note.note_type === 'caution'
          ? { variant: 'important_caution' as const }
          : {}),
      },
      ctxBase,
    );
    created.push(createdId);
  }

  for (const c of op.comments ?? []) {
    const { createdId } = executeAddLinkedComment(
      {
        type: 'add_linked_comment',
        target_element_id: main.id,
        anchor: c.anchor,
        comment: c.comment,
        comment_type: c.comment_type,
      },
      ctxBase,
    );
    created.push(createdId);
  }

  return created;
}

/** Bridge legacy nested feature ops to textbook components where applicable. */
function bridgeLegacyFeatureOp(
  op: TextFeatureOperation,
  target: AgentExecutorTarget,
  resolveRef: (ref: string) => string | undefined,
): { createdIds: string[]; updatedIds: string[] } {
  const createdIds: string[] = [];
  const updatedIds: string[] = [];
  const ctx = {
    getElements: () => target.getElements(),
    getCamera: () => target.getCamera(),
    getViewportSize: target.getViewportSize,
    nextZIndex: () => target.nextZIndex(),
    addElement: (el: CanvasElement, select?: boolean) =>
      target.addElement(el, select),
    updateElement: target.updateElement,
    resolveRef,
  };

  if (op.type === 'set_text_title') {
    const existing = target.getElements().find(
      (e): e is TextElement =>
        e.type === 'text' &&
        getComponentType(e) === 'title' &&
        e.componentMeta?.associatedElementId === op.target_element_id,
    );
    if (existing) {
      executeUpdateTextComponent(
        {
          type: 'update_text_component',
          target_element_id: existing.id,
          content: op.text,
        },
        ctx,
      );
      updatedIds.push(existing.id);
    } else {
      const { createdId } = executeCreateTextComponent(
        {
          type: 'create_text_component',
          component: 'title',
          content: op.text,
          associated_element_id: op.target_element_id,
        },
        ctx,
      );
      createdIds.push(createdId);
    }
    return { createdIds, updatedIds };
  }

  if (op.type === 'remove_text_title') {
    const titles = target
      .getElements()
      .filter(
        (e): e is TextElement =>
          e.type === 'text' &&
          getComponentType(e) === 'title' &&
          e.componentMeta?.associatedElementId === op.target_element_id,
      );
    if (titles.length > 0) {
      target.deleteElements?.(titles.map((t) => t.id));
      updatedIds.push(...titles.map((t) => t.id));
    }
    return { createdIds, updatedIds };
  }

  if (op.type === 'add_text_comment') {
    const { createdId, updatedTargetId } = executeAddLinkedComment(
      {
        type: 'add_linked_comment',
        target_element_id: op.target_element_id,
        anchor: op.anchor,
        comment: op.comment,
        comment_type: op.comment_type,
      },
      ctx,
    );
    createdIds.push(createdId);
    updatedIds.push(updatedTargetId);
    return { createdIds, updatedIds };
  }

  if (op.type === 'update_text_comment') {
    // comment_id may be a linked_comment TextElement id (new) or nested id (legacy).
    const hit = target.getElements().find((e) => e.id === op.comment_id);
    if (hit && hit.type === 'text' && getComponentType(hit) === 'linked_comment') {
      executeUpdateTextComponent(
        {
          type: 'update_text_component',
          target_element_id: hit.id,
          content: op.comment,
        },
        ctx,
      );
      updatedIds.push(hit.id);
      return { createdIds, updatedIds };
    }
    // Fall through to nested apply
  }

  if (op.type === 'remove_text_comment') {
    const hit = target.getElements().find((e) => e.id === op.comment_id);
    if (hit && hit.type === 'text' && getComponentType(hit) === 'linked_comment') {
      target.deleteElements?.([hit.id]);
      updatedIds.push(hit.id);
      return { createdIds, updatedIds };
    }
  }

  if (op.type === 'add_text_note') {
    const component: TextComponentType =
      op.note_type === 'caution'
        ? 'warning'
        : op.note_type === 'important'
          ? 'definition'
          : 'example';
    const { createdId } = executeCreateTextComponent(
      {
        type: 'create_text_component',
        component,
        content: op.text,
        associated_element_id: op.target_element_id,
        ...(op.note_type === 'caution'
          ? { variant: 'important_caution' as const }
          : {}),
      },
      ctx,
    );
    createdIds.push(createdId);
    return { createdIds, updatedIds };
  }

  return { createdIds, updatedIds };
}

export interface AgentExecutorTarget {
  getCamera: () => Camera;
  getElements: () => CanvasElement[];
  getStyle: () => StyleDefaults;
  nextZIndex: () => number;
  getBoardId: () => string;
  beginInteraction: () => void;
  endInteraction: () => void;
  /** Abort the open interaction and restore the pre-transaction snapshot. */
  rollbackInteraction: () => void;
  addElement: (element: CanvasElement, select?: boolean) => void;
  updateElement: (id: string, updater: (el: CanvasElement) => CanvasElement) => void;
  /** Remove elements by id (used when deleting title/comment components). */
  deleteElements?: (ids: string[]) => void;
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
    // Final-result presentation: emphasize plain text when no rich_text provided.
    let richText = op.rich_text as RichTextDocument | undefined;
    if (!richText && op.layout_role === 'final_result') {
      richText = {
        blocks: [
          {
            type: 'heading',
            role: 'heading',
            spans: [
              {
                text: 'Final result',
                style: { bold: true, font_size: 'subheading' },
              },
            ],
          },
          {
            type: 'paragraph',
            role: 'body',
            spans: [{ text: op.text, style: { bold: true, font_size: 'heading' } }],
          },
        ],
      };
    }
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
    let element = createAiTextElement(op.text, { x: placed.x, y: placed.y }, {
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
        ...(op.layout_role ? { layoutRole: op.layout_role } : {}),
      },
    });
    element.height = height;
    if (forced) {
      element.width = width;
      element.height = height;
    }
    // Mark as main_text textbook component when created by the agent.
    element = {
      ...element,
      componentType: element.componentType ?? 'main_text',
      componentMeta: element.componentMeta ?? { placementMode: 'auto' },
    };
    target.addElement(element, false);
    createdIds.push(element.id);
    // Legacy nested title/notes/comments → sibling components after main exists.
    if (op.title || op.notes?.length || op.comments?.length) {
      createdIds.push(...spawnLegacyCreateTextComponents(element, op, target));
    }
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
      metadata: {
        ...(op.layout_role ? { layoutRole: op.layout_role } : {}),
        ...(op.layout_role === 'final_result' ? { emphasize: true } : {}),
      },
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
      outputType: plan.output_type,
    });
    layoutDebug = gridResolved.debug;
  }

  const planRefMap = new Map<string, string>();
  let lastMainTextId: string | undefined;
  const resolveRef = (ref: string): string | undefined =>
    planRefMap.get(ref) ?? undefined;

  target.beginInteraction();
  let committed = false;
  try {
    for (let opIndex = 0; opIndex < operations.length; opIndex++) {
      const op = operations[opIndex]!;
      try {
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

        if (isGraphComponentOperationType(op.type)) {
          const gOp = op as GraphComponentOperation;
          const gCtx = {
            getElements: () => target.getElements(),
            getCamera: () => target.getCamera(),
            getViewportSize: target.getViewportSize,
            nextZIndex: () => target.nextZIndex(),
            addElement: (el: CanvasElement, select?: boolean) =>
              target.addElement(el, select),
            updateElement: target.updateElement,
            resolveRef,
          };

          if (gOp.type === 'add_graph_to_text') {
            const { createdId } = executeAddGraphToText(gOp, gCtx);
            createdIds.push(createdId);
            if (gOp.ref) planRefMap.set(gOp.ref, createdId);
            continue;
          }
          if (gOp.type === 'set_graph_title') {
            const result = executeSetGraphTitle(gOp, gCtx);
            if (result.createdId) createdIds.push(result.createdId);
            if (result.updatedId) updatedIds.push(result.updatedId);
            const gid = gOp.target_element_id
              ? resolveRef(gOp.target_element_id) ?? gOp.target_element_id
              : gOp.target_ref
                ? resolveRef(gOp.target_ref)
                : undefined;
            if (gid) updatedIds.push(gid);
            continue;
          }
          if (gOp.type === 'add_graph_caption') {
            const result = executeAddGraphCaption(gOp, gCtx);
            if (result.createdId) createdIds.push(result.createdId);
            if (result.updatedId) updatedIds.push(result.updatedId);
            continue;
          }
          if (gOp.type === 'add_graph_observation') {
            const { createdId } = executeAddGraphObservation(gOp, gCtx);
            createdIds.push(createdId);
            continue;
          }
          if (gOp.type === 'add_graph_comment') {
            const { createdId } = executeAddGraphComment(gOp, gCtx);
            createdIds.push(createdId);
            continue;
          }
          if (gOp.type === 'add_text_to_graph') {
            const { createdId } = executeAddTextToGraph(gOp, gCtx);
            createdIds.push(createdId);
            if (gOp.ref) planRefMap.set(gOp.ref, createdId);
            const gid =
              (gOp.target_element_id &&
                (resolveRef(gOp.target_element_id) ?? gOp.target_element_id)) ||
              (gOp.graph_id && (resolveRef(gOp.graph_id) ?? gOp.graph_id)) ||
              (gOp.target_ref && resolveRef(gOp.target_ref));
            if (gid) updatedIds.push(gid);
            continue;
          }
          const { pointId } = executeAnnotateGraphPoint(gOp, gCtx);
          const gid =
            (gOp.target_element_id &&
              (resolveRef(gOp.target_element_id) ?? gOp.target_element_id)) ||
            (gOp.target_ref && resolveRef(gOp.target_ref));
          if (gid) updatedIds.push(gid);
          void pointId;
          continue;
        }

        if (isGraphAnnotationOperationType(op.type)) {
          const aOp = op as GraphAnnotationOperation;
          const rawId =
            aOp.target_element_id ??
            aOp.graph_id ??
            (aOp.target_ref ? resolveRef(aOp.target_ref) : undefined);
          const graphId = rawId
            ? (resolveRef(rawId) ?? rawId)
            : undefined;
          if (!graphId) {
            throw new Error('Graph annotation op missing target graph id.');
          }
          target.updateElement(graphId, (el) => {
            if (el.type !== 'graph') return el;
            const next = applyGraphAnnotationOperation(el, aOp);
            return {
              ...next,
              metadata: {
                ...next.metadata,
                lastEditedBy: 'ai',
                source: 'agent',
                operation: aOp.type,
              },
            };
          });
          updatedIds.push(graphId);
          continue;
        }

        if (isTextComponentOperationType(op.type)) {
          const compOp = op as TextComponentOperation;
          const ctx = {
            getElements: () => target.getElements(),
            getCamera: () => target.getCamera(),
            getViewportSize: target.getViewportSize,
            nextZIndex: () => target.nextZIndex(),
            addElement: (el: CanvasElement, select?: boolean) =>
              target.addElement(el, select),
            updateElement: target.updateElement,
            resolveRef,
          };

          if (compOp.type === 'create_text_component') {
            let associated = compOp.associated_element_id;
            if (!associated && compOp.component !== 'main_text') {
              associated = lastMainTextId;
            }
            const enriched: CreateTextComponentOperation = {
              ...compOp,
              ...(associated ? { associated_element_id: associated } : {}),
            };
            // Title upsert: update existing associated title instead of duplicating.
            if (enriched.component === 'title' && enriched.associated_element_id) {
              const assocId =
                resolveRef(enriched.associated_element_id) ??
                enriched.associated_element_id;
              const existingTitle = target.getElements().find(
                (e): e is TextElement =>
                  e.type === 'text' &&
                  getComponentType(e) === 'title' &&
                  e.componentMeta?.associatedElementId === assocId,
              );
              if (existingTitle) {
                executeUpdateTextComponent(
                  {
                    type: 'update_text_component',
                    target_element_id: existingTitle.id,
                    content: enriched.content,
                  },
                  ctx,
                );
                updatedIds.push(existingTitle.id);
                if (enriched.ref) planRefMap.set(enriched.ref, existingTitle.id);
                continue;
              }
            }
            const { createdId } = executeCreateTextComponent(enriched, ctx);
            createdIds.push(createdId);
            if (enriched.ref) planRefMap.set(enriched.ref, createdId);
            if (enriched.component === 'main_text') {
              lastMainTextId = createdId;
              // Link orphan auto-titles from this batch to the new main text.
              for (const el of target.getElements()) {
                if (
                  el.type === 'text' &&
                  getComponentType(el) === 'title' &&
                  el.componentMeta?.placementMode === 'auto' &&
                  !el.componentMeta.associatedElementId &&
                  createdIds.includes(el.id)
                ) {
                  target.updateElement(el.id, (prev) => {
                    if (prev.type !== 'text') return prev;
                    return {
                      ...prev,
                      componentMeta: {
                        ...(prev.componentMeta ?? { placementMode: 'auto' }),
                        associatedElementId: createdId,
                        placementMode: 'auto',
                      },
                      x: (target.getElements().find((e) => e.id === createdId)
                        ?.x ?? prev.x),
                      y:
                        (target.getElements().find((e) => e.id === createdId)
                          ?.y ?? prev.y) -
                        prev.height -
                        14,
                    };
                  });
                }
              }
            }
            continue;
          }

          if (compOp.type === 'add_linked_comment') {
            const { createdId, updatedTargetId } = executeAddLinkedComment(
              compOp as AddLinkedCommentOperation,
              ctx,
            );
            createdIds.push(createdId);
            updatedIds.push(updatedTargetId);
            continue;
          }

          executeUpdateTextComponent(
            compOp as UpdateTextComponentOperation,
            ctx,
          );
          updatedIds.push(compOp.target_element_id);
          continue;
        }

        if (isTextFeatureOperationType(op.type)) {
          const featureOp = op as TextFeatureOperation;
          const id = featureOp.target_element_id;
          const before = target.getElements().find((e) => e.id === id);
          if (!before || before.type !== 'text') {
            throw new Error(`Target "${id}" is not a TextElement.`);
          }

          // Bridge nested title/comment/note ops to textbook components.
          const bridged = bridgeLegacyFeatureOp(featureOp, target, resolveRef);
          if (
            featureOp.type === 'set_text_title' ||
            featureOp.type === 'remove_text_title' ||
            featureOp.type === 'add_text_comment' ||
            featureOp.type === 'add_text_note' ||
            (featureOp.type === 'update_text_comment' && bridged.updatedIds.length > 0) ||
            (featureOp.type === 'remove_text_comment' && bridged.updatedIds.length > 0)
          ) {
            createdIds.push(...bridged.createdIds);
            updatedIds.push(...bridged.updatedIds);
            continue;
          }

          // Headings + ordinary highlights remain in-document rich-text ops.
          target.updateElement(id, (el) => {
            if (el.type !== 'text') return el;
            return applyTextFeatureOperation(el, featureOp);
          });
          updatedIds.push(id);
          continue;
        }

        if (isTextMathOperationType(op.type)) {
          const mathOp = op as TextMathOperation;
          const id = mathOp.target_element_id;
          const before = target.getElements().find((e) => e.id === id);
          if (!before || before.type !== 'text') {
            throw new Error(`Target "${id}" is not a TextElement.`);
          }
          target.updateElement(id, (el) => {
            if (el.type !== 'text') return el;
            return applyTextMathOperation(el, mathOp);
          });
          updatedIds.push(id);
          continue;
        }

        if (isEquationComponentOperationType(op.type)) {
          const eOp = op as EquationComponentOperation;
          const eCtx = {
            getElements: () => target.getElements(),
            getCamera: () => target.getCamera(),
            getViewportSize: target.getViewportSize,
            nextZIndex: () => target.nextZIndex(),
            addElement: (el: CanvasElement, select?: boolean) =>
              target.addElement(el, select),
            updateElement: target.updateElement,
            resolveRef,
          };

          if (eOp.type === 'add_equation_to_text') {
            const { createdId } = executeAddEquationToText(eOp, eCtx);
            createdIds.push(createdId);
            if (eOp.ref) planRefMap.set(eOp.ref, createdId);
            continue;
          }
          if (eOp.type === 'update_equation') {
            const { updatedId } = executeUpdateEquation(eOp, eCtx);
            updatedIds.push(updatedId);
            continue;
          }
          if (eOp.type === 'set_equation_title') {
            const result = executeSetEquationTitle(eOp, eCtx);
            if (result.createdId) createdIds.push(result.createdId);
            if (result.updatedId) updatedIds.push(result.updatedId);
            continue;
          }
          if (eOp.type === 'add_text_to_equation') {
            const { createdId } = executeAddTextToEquation(eOp, eCtx);
            createdIds.push(createdId);
            if (eOp.ref) planRefMap.set(eOp.ref, createdId);
            continue;
          }
          if (eOp.type === 'add_equation_symbol_definitions') {
            const result = executeAddEquationSymbolDefinitions(eOp, eCtx);
            createdIds.push(result.createdId);
            if (result.updatedId) updatedIds.push(result.updatedId);
            continue;
          }
          if (eOp.type === 'add_equation_interpretation') {
            const { createdId } = executeAddEquationInterpretation(eOp, eCtx);
            createdIds.push(createdId);
            continue;
          }
        }

        if (isGridCreatableOp(op)) {
          const forced =
            gridResolved && op.ref ? gridResolved.byRef.get(op.ref) : undefined;
          const result = createOne(op, target, style, viewport, forced);
          createdIds.push(...result.createdIds);
          structureInstanceIds.push(...result.structureInstanceIds);
          // Register plan refs for ALL create ops so later ops can target them
          // via target_ref (e.g. create_graph → add_graph_caption).
          if (op.ref && result.createdIds[0]) {
            planRefMap.set(op.ref, result.createdIds[0]);
            if (op.type === 'create_text') {
              lastMainTextId = result.createdIds[0];
            }
          }
        }
      } catch (cause) {
        if (cause instanceof CanvasAgentExecuteError) throw cause;
        const targetId =
          'target_element_id' in op
            ? String((op as { target_element_id?: string }).target_element_id ?? '')
            : 'graph_id' in op
              ? String((op as { graph_id?: string }).graph_id ?? '')
              : undefined;
        throw new CanvasAgentExecuteError({
          opIndex,
          opType: op.type,
          targetId: targetId || undefined,
          stage: isGraphComponentOperationType(op.type) ||
            isGraphAnnotationOperationType(op.type)
            ? 'text_component'
            : isTextComponentOperationType(op.type)
              ? 'text_component'
              : isTextFeatureOperationType(op.type) ||
                  isTextMathOperationType(op.type)
                ? 'text_feature'
                : isEquationComponentOperationType(op.type)
                  ? 'text_component'
                  : op.type.startsWith('create_')
                    ? 'create'
                    : 'apply',
          message: 'Canvas operation failed',
          cause,
        });
      }
    }
    committed = true;
  } finally {
    if (committed) {
      target.endInteraction();
    } else {
      target.rollbackInteraction();
    }
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
