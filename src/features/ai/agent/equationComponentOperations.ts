/**
 * Equation textbook-component operations.
 * Content + association only — style and placement are application-owned.
 */

import type {
  Camera,
  CanvasElement,
  EquationElement,
  TextElement,
} from '../../../types/canvas';
import type { ViewportSize } from '../canvas/placement';
import { getDefaultViewportSize } from '../canvas/placement';
import { createAiEquationElement } from '../canvas/createAiEquationElement';
import {
  createTextComponentElement,
  equationComponentMapping,
  formatSymbolDefinitions,
  isEquationComponentKind,
  type EquationComponentKind,
  type TextComponentMeta,
  type TextComponentVariant,
} from '../../text/textComponents';
import {
  EQUATION_COMPONENT_LAYOUT,
  computeSiblingEquationReflow,
  resolveEquationAttachPlacement,
  resolveEquationChromePlacement,
} from '../../equations/equationPlacement';
import {
  measureEquationSize,
  sanitizeLatexSource,
  validateLatex,
} from '../../equations/latex';
import { CanvasAgentParseError } from './parseErrors';

export type AddEquationToTextOperation = {
  type: 'add_equation_to_text';
  /** Existing TextElement id, or a temporary create_text `ref` resolved at execute time. */
  target_element_id?: string;
  target_ref?: string;
  latex: string;
  ref?: string;
};

export type UpdateEquationOperation = {
  type: 'update_equation';
  target_element_id?: string;
  target_ref?: string;
  latex: string;
};

export type SetEquationTitleOperation = {
  type: 'set_equation_title';
  target_element_id?: string;
  target_ref?: string;
  text: string;
};

export type AddTextToEquationOperation = {
  type: 'add_text_to_equation';
  target_element_id?: string;
  target_ref?: string;
  /** Semantic component: title | lead_in | step_explanation | … */
  component: EquationComponentKind;
  content: string;
  ref?: string;
  variant?: TextComponentVariant;
};

export type SymbolDefinitionSpec = {
  symbol: string;
  definition: string;
  unit?: string;
};

export type AddEquationSymbolDefinitionsOperation = {
  type: 'add_equation_symbol_definitions';
  target_element_id?: string;
  target_ref?: string;
  /** Preferred structured form. */
  symbols?: SymbolDefinitionSpec[];
  /**
   * Free-form "where …" prose. LLMs often emit this instead of `symbols`;
   * accepted as a fallback and rendered with the same symbol-definition style.
   */
  content?: string;
};

export type AddEquationInterpretationOperation = {
  type: 'add_equation_interpretation';
  target_element_id?: string;
  target_ref?: string;
  content: string;
};

export type EquationComponentOperation =
  | AddEquationToTextOperation
  | UpdateEquationOperation
  | SetEquationTitleOperation
  | AddTextToEquationOperation
  | AddEquationSymbolDefinitionsOperation
  | AddEquationInterpretationOperation;

export const EQUATION_COMPONENT_OPERATION_TYPES = [
  'add_equation_to_text',
  'update_equation',
  'set_equation_title',
  'add_text_to_equation',
  'add_equation_symbol_definitions',
  'add_equation_interpretation',
] as const;

export function isEquationComponentOperationType(
  t: string,
): t is EquationComponentOperation['type'] {
  return (EQUATION_COMPONENT_OPERATION_TYPES as readonly string[]).includes(t);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function requireLatex(raw: Record<string, unknown>, path: string): string {
  if (typeof raw.latex !== 'string' || !raw.latex.trim()) {
    throw new CanvasAgentParseError('empty_text', `${path} needs non-empty latex.`);
  }
  const cleaned = sanitizeLatexSource(raw.latex);
  const check = validateLatex(cleaned, true);
  if (!check.ok) {
    throw new CanvasAgentParseError(
      'schema',
      `${path} invalid LaTeX: ${check.error ?? 'unknown error'}`,
    );
  }
  return cleaned;
}

function resolveTargetIds(raw: Record<string, unknown>): {
  target_element_id?: string;
  target_ref?: string;
} {
  const id =
    typeof raw.target_element_id === 'string' && raw.target_element_id.trim()
      ? raw.target_element_id.trim()
      : typeof raw.target_id === 'string' && raw.target_id.trim()
        ? raw.target_id.trim()
        : undefined;
  const ref =
    typeof raw.target_ref === 'string' && raw.target_ref.trim()
      ? raw.target_ref.trim()
      : undefined;
  return {
    ...(id ? { target_element_id: id } : {}),
    ...(ref ? { target_ref: ref } : {}),
  };
}

export function parseEquationComponentOperation(
  raw: Record<string, unknown>,
): EquationComponentOperation {
  if (
    !isRecord(raw) ||
    typeof raw.type !== 'string' ||
    !isEquationComponentOperationType(raw.type)
  ) {
    throw new CanvasAgentParseError('schema', 'Unknown equation component operation.');
  }

  switch (raw.type) {
    case 'add_equation_to_text': {
      const ids = resolveTargetIds(raw);
      if (!ids.target_element_id && !ids.target_ref) {
        throw new CanvasAgentParseError(
          'missing_target',
          'add_equation_to_text needs target_element_id or target_ref.',
        );
      }
      const ref =
        typeof raw.ref === 'string' && raw.ref.trim() ? raw.ref.trim() : undefined;
      return {
        type: 'add_equation_to_text',
        ...ids,
        latex: requireLatex(raw, 'add_equation_to_text'),
        ...(ref ? { ref } : {}),
      };
    }
    case 'update_equation': {
      const ids = resolveTargetIds(raw);
      if (!ids.target_element_id && !ids.target_ref) {
        throw new CanvasAgentParseError(
          'missing_target',
          'update_equation needs target_element_id or target_ref.',
        );
      }
      return {
        type: 'update_equation',
        ...ids,
        latex: requireLatex(raw, 'update_equation'),
      };
    }
    case 'set_equation_title': {
      const ids = resolveTargetIds(raw);
      if (!ids.target_element_id && !ids.target_ref) {
        throw new CanvasAgentParseError(
          'missing_target',
          'set_equation_title needs target_element_id or target_ref.',
        );
      }
      if (typeof raw.text !== 'string' || !raw.text.trim()) {
        throw new CanvasAgentParseError(
          'empty_text',
          'set_equation_title needs non-empty text.',
        );
      }
      return { type: 'set_equation_title', ...ids, text: raw.text.trim() };
    }
    case 'add_text_to_equation': {
      const ids = resolveTargetIds(raw);
      if (!ids.target_element_id && !ids.target_ref) {
        throw new CanvasAgentParseError(
          'missing_target',
          'add_text_to_equation needs target_element_id or target_ref.',
        );
      }
      const component =
        typeof raw.component === 'string' ? raw.component.trim() : '';
      if (!isEquationComponentKind(component)) {
        throw new CanvasAgentParseError(
          'schema',
          `add_text_to_equation.component must be one of: title, lead_in, step_explanation, symbol_definitions, interpretation, warning.`,
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
          'add_text_to_equation needs non-empty content.',
        );
      }
      const ref =
        typeof raw.ref === 'string' && raw.ref.trim() ? raw.ref.trim() : undefined;
      let variant: TextComponentVariant | undefined;
      if (raw.variant !== undefined) {
        if (
          raw.variant !== 'warning' &&
          raw.variant !== 'common_mistake' &&
          raw.variant !== 'important_caution'
        ) {
          throw new CanvasAgentParseError(
            'schema',
            'add_text_to_equation.variant must be warning|common_mistake|important_caution.',
          );
        }
        variant = raw.variant;
      }
      return {
        type: 'add_text_to_equation',
        ...ids,
        component,
        content: content.trim(),
        ...(ref ? { ref } : {}),
        ...(variant ? { variant } : {}),
      };
    }
    case 'add_equation_symbol_definitions': {
      const ids = resolveTargetIds(raw);
      if (!ids.target_element_id && !ids.target_ref) {
        throw new CanvasAgentParseError(
          'missing_target',
          'add_equation_symbol_definitions needs target_element_id or target_ref.',
        );
      }
      const content =
        typeof raw.content === 'string' && raw.content.trim()
          ? raw.content.trim()
          : undefined;
      if (Array.isArray(raw.symbols) && raw.symbols.length > 0) {
        const symbols: SymbolDefinitionSpec[] = raw.symbols.map((item, i) => {
          if (!isRecord(item)) {
            throw new CanvasAgentParseError(
              'schema',
              `symbols[${i}] must be an object.`,
            );
          }
          const symbol =
            typeof item.symbol === 'string' ? item.symbol.trim() : '';
          const definition =
            typeof item.definition === 'string' ? item.definition.trim() : '';
          if (!symbol || !definition) {
            throw new CanvasAgentParseError(
              'empty_text',
              `symbols[${i}] needs symbol and definition.`,
            );
          }
          const unit =
            typeof item.unit === 'string' && item.unit.trim()
              ? item.unit.trim()
              : undefined;
          return { symbol, definition, ...(unit ? { unit } : {}) };
        });
        return {
          type: 'add_equation_symbol_definitions',
          ...ids,
          symbols,
          ...(content ? { content } : {}),
        };
      }
      // LLM fallback: free-form "where …" prose instead of a symbols array.
      if (content) {
        return {
          type: 'add_equation_symbol_definitions',
          ...ids,
          content,
        };
      }
      throw new CanvasAgentParseError(
        'schema',
        'add_equation_symbol_definitions needs a non-empty symbols array or content string.',
      );
    }
    case 'add_equation_interpretation': {
      const ids = resolveTargetIds(raw);
      if (!ids.target_element_id && !ids.target_ref) {
        throw new CanvasAgentParseError(
          'missing_target',
          'add_equation_interpretation needs target_element_id or target_ref.',
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
          'add_equation_interpretation needs non-empty content.',
        );
      }
      return {
        type: 'add_equation_interpretation',
        ...ids,
        content: content.trim(),
      };
    }
  }
}

export type EquationComponentExecuteContext = {
  getElements: () => CanvasElement[];
  getCamera: () => Camera;
  getViewportSize?: () => ViewportSize;
  nextZIndex: () => number;
  addElement: (el: CanvasElement, select?: boolean) => void;
  updateElement: (id: string, updater: (el: CanvasElement) => CanvasElement) => void;
  resolveRef?: (ref: string) => string | undefined;
  onPlacementDebug?: (info: Record<string, unknown>) => void;
};

function resolveEquationId(
  op: { target_element_id?: string; target_ref?: string },
  ctx: EquationComponentExecuteContext,
): string {
  if (op.target_ref) {
    const resolved = ctx.resolveRef?.(op.target_ref);
    if (!resolved) {
      throw new Error(`Unknown target_ref "${op.target_ref}".`);
    }
    return resolved;
  }
  if (op.target_element_id) {
    return ctx.resolveRef?.(op.target_element_id) ?? op.target_element_id;
  }
  throw new Error('Missing equation target.');
}

function requireEquation(
  id: string,
  elements: CanvasElement[],
): EquationElement {
  const el = elements.find((e) => e.id === id);
  if (!el || el.type !== 'equation') {
    throw new Error(`Target "${id}" is not an EquationElement.`);
  }
  return el;
}

function findChrome(
  elements: CanvasElement[],
  equationId: string,
  role: string,
): TextElement | undefined {
  return elements.find(
    (e): e is TextElement =>
      e.type === 'text' &&
      e.componentMeta?.associatedElementId === equationId &&
      e.componentMeta.role === role,
  );
}

function createChromeComponent(
  opts: {
    kind: EquationComponentKind;
    text: string;
    equation: EquationElement;
    metaExtra?: Partial<TextComponentMeta>;
    operation?: string;
  },
  ctx: EquationComponentExecuteContext,
): string {
  const mapping = equationComponentMapping(opts.kind);
  const meta: TextComponentMeta = {
    placementMode: 'auto',
    associatedElementId: opts.equation.id,
    role: mapping.role,
    ...(mapping.defaultLabel ? { label: mapping.defaultLabel } : {}),
    ...opts.metaExtra,
  };
  const decision = resolveEquationChromePlacement({
    componentType: mapping.componentType,
    role: mapping.role,
    text: opts.text,
    meta,
    equation: opts.equation,
    elements: ctx.getElements(),
    camera: ctx.getCamera(),
    viewport: ctx.getViewportSize?.() ?? getDefaultViewportSize(),
  });
  ctx.onPlacementDebug?.({
    component: opts.kind,
    role: mapping.role,
    reason: decision.reason,
    associatedEquationId: opts.equation.id,
    resolvedPosition: { x: decision.x, y: decision.y },
    measuredBounds: { width: decision.width, height: decision.height },
    reflow: decision.reflow,
  });

  if (decision.reflow) {
    const applied = new Set<string>();
    if (decision.reflow.shifts?.length) {
      for (const { id, dy } of decision.reflow.shifts) {
        if (dy === 0 || applied.has(id)) continue;
        applied.add(id);
        ctx.updateElement(id, (el) => {
          if (el.type !== 'text' && el.type !== 'equation') return el;
          return { ...el, y: el.y + dy };
        });
      }
    }
    if (decision.reflow.elementIds?.length && decision.reflow.dy) {
      const dy = decision.reflow.dy;
      for (const id of decision.reflow.elementIds) {
        if (applied.has(id)) continue;
        applied.add(id);
        ctx.updateElement(id, (el) => {
          if (el.type !== 'text' && el.type !== 'equation') return el;
          return { ...el, y: el.y + dy };
        });
      }
    }
  }

  const el = createTextComponentElement({
    componentType: mapping.componentType,
    text: opts.text,
    position: { x: decision.x, y: decision.y },
    zIndex: ctx.nextZIndex(),
    width: decision.width,
    meta,
    metadata: {
      createdBy: 'ai',
      source: 'agent',
      operation: opts.operation ?? opts.kind,
      placementDecision: decision.reason,
    },
  });
  el.width = decision.width;
  el.height = decision.height;
  ctx.addElement(el, false);
  return el.id;
}

export function executeAddEquationToText(
  op: AddEquationToTextOperation,
  ctx: EquationComponentExecuteContext,
): { createdId: string } {
  const elements = ctx.getElements();
  const targetId = resolveEquationId(
    {
      target_element_id: op.target_element_id,
      target_ref: op.target_ref,
    },
    ctx,
  );
  const target = elements.find((e) => e.id === targetId);
  if (!target || target.type !== 'text') {
    throw new Error(
      `add_equation_to_text target "${op.target_element_id ?? op.target_ref}" is not a TextElement.`,
    );
  }

  const decision = resolveEquationAttachPlacement({
    targetText: target,
    elements,
    camera: ctx.getCamera(),
    viewport: ctx.getViewportSize?.() ?? getDefaultViewportSize(),
    latex: op.latex,
  });

  ctx.onPlacementDebug?.({
    operation: 'add_equation_to_text',
    reason: decision.reason,
    associatedElementId: decision.associatedElementId,
    order: decision.order,
    resolvedPosition: { x: decision.x, y: decision.y },
    measuredBounds: { width: decision.width, height: decision.height },
  });

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

  const equation = createAiEquationElement(op.latex, {
    x: decision.x,
    y: decision.y,
  }, {
    zIndex: ctx.nextZIndex(),
    metadata: {
      operation: 'add_equation_to_text',
      placementDecision: decision.reason,
    },
  });
  equation.width = decision.width;
  equation.height = decision.height;
  equation.association = {
    associatedElementId: target.id,
    placementMode: 'auto',
    order: decision.order,
  };
  ctx.addElement(equation, false);
  return { createdId: equation.id };
}

export function executeUpdateEquation(
  op: UpdateEquationOperation,
  ctx: EquationComponentExecuteContext,
): { updatedId: string } {
  const id = resolveEquationId(op, ctx);
  const prev = requireEquation(id, ctx.getElements());
  const size = measureEquationSize(op.latex, {
    fontSize: prev.fontSize,
    displayMode: prev.displayMode !== 'inline',
    maxWidth: Math.max(prev.width, EQUATION_COMPONENT_LAYOUT.attachedMaxWidth),
  });
  const heightDelta = size.height - prev.height;
  ctx.updateElement(id, (el) => {
    if (el.type !== 'equation') return el;
    return {
      ...el,
      latex: op.latex,
      width: size.width,
      height: size.height,
      // fontSize is intentionally unchanged — resize/edit must not rescale maths.
    };
  });
  // Grow/shrink pushes later sibling equations in the same derivation.
  if (heightDelta !== 0) {
    const updated = requireEquation(id, ctx.getElements());
    const siblingReflow = computeSiblingEquationReflow(
      updated,
      ctx.getElements(),
      heightDelta,
    );
    if (siblingReflow) {
      for (const shiftId of siblingReflow.elementIds) {
        ctx.updateElement(shiftId, (el) => {
          if (el.type !== 'text' && el.type !== 'equation') return el;
          return { ...el, y: el.y + siblingReflow.dy };
        });
      }
    }
    // Shift below-chrome on this equation when height changes.
    for (const el of ctx.getElements()) {
      if (el.type !== 'text') continue;
      if (el.componentMeta?.associatedElementId !== id) continue;
      if (el.componentMeta.placementMode === 'manual') continue;
      const role = el.componentMeta.role;
      if (
        role === 'equation_symbol_definitions' ||
        role === 'equation_step_explanation' ||
        role === 'equation_interpretation' ||
        role === 'equation_warning'
      ) {
        ctx.updateElement(el.id, (prevEl) => ({
          ...prevEl,
          y: prevEl.y + heightDelta,
        }));
      }
    }
  }
  return { updatedId: id };
}

export function executeSetEquationTitle(
  op: SetEquationTitleOperation,
  ctx: EquationComponentExecuteContext,
): { createdId?: string; updatedId?: string } {
  const equationId = resolveEquationId(op, ctx);
  const equation = requireEquation(equationId, ctx.getElements());
  const existing = findChrome(ctx.getElements(), equation.id, 'equation_title');
  if (existing) {
    ctx.updateElement(existing.id, (el) => {
      if (el.type !== 'text') return el;
      return { ...el, text: op.text, richText: undefined };
    });
    return { updatedId: existing.id };
  }
  const createdId = createChromeComponent(
    { kind: 'title', text: op.text, equation, operation: 'set_equation_title' },
    ctx,
  );
  return { createdId };
}

export function executeAddTextToEquation(
  op: AddTextToEquationOperation,
  ctx: EquationComponentExecuteContext,
): { createdId: string } {
  const equationId = resolveEquationId(op, ctx);
  const equation = requireEquation(equationId, ctx.getElements());
  const createdId = createChromeComponent(
    {
      kind: op.component,
      text: op.content,
      equation,
      metaExtra: op.variant ? { variant: op.variant } : undefined,
      operation: 'add_text_to_equation',
    },
    ctx,
  );
  return { createdId };
}

export function executeAddEquationSymbolDefinitions(
  op: AddEquationSymbolDefinitionsOperation,
  ctx: EquationComponentExecuteContext,
): { createdId: string; updatedId?: string } {
  const equationId = resolveEquationId(op, ctx);
  const equation = requireEquation(equationId, ctx.getElements());
  const fromSymbols =
    op.symbols && op.symbols.length > 0
      ? formatSymbolDefinitions(op.symbols)
      : '';
  // Prefer structured symbols; fall back to free-form content (strip a leading
  // "where" so it does not duplicate the component label).
  let content = fromSymbols || (op.content ?? '').trim();
  if (!fromSymbols && content) {
    content = content.replace(/^where[:\s]+/i, '').trim();
  }
  if (!content) {
    throw new Error(
      'add_equation_symbol_definitions produced empty definition text.',
    );
  }
  const existing = findChrome(
    ctx.getElements(),
    equation.id,
    'equation_symbol_definitions',
  );
  if (existing) {
    ctx.updateElement(existing.id, (el) => {
      if (el.type !== 'text') return el;
      return { ...el, text: content, richText: undefined };
    });
    return { createdId: existing.id, updatedId: existing.id };
  }
  const createdId = createChromeComponent(
    {
      kind: 'symbol_definitions',
      text: content,
      equation,
      operation: 'add_equation_symbol_definitions',
    },
    ctx,
  );
  return { createdId };
}

export function executeAddEquationInterpretation(
  op: AddEquationInterpretationOperation,
  ctx: EquationComponentExecuteContext,
): { createdId: string } {
  const equationId = resolveEquationId(op, ctx);
  const equation = requireEquation(equationId, ctx.getElements());
  const createdId = createChromeComponent(
    {
      kind: 'interpretation',
      text: op.content,
      equation,
      operation: 'add_equation_interpretation',
    },
    ctx,
  );
  return { createdId };
}
