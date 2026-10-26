/**
 * Manual UI helpers for equation textbook components.
 * Same creation path as AI ops.
 */

import { useCanvasStore } from '../../store/canvasStore';
import {
  executeAddEquationInterpretation,
  executeAddEquationSymbolDefinitions,
  executeAddEquationToText,
  executeAddTextToEquation,
  executeSetEquationTitle,
  executeUpdateEquation,
  type EquationComponentExecuteContext,
  type SymbolDefinitionSpec,
} from '../ai/agent/equationComponentOperations';
import { createAiEquationElement } from '../ai/canvas/createAiEquationElement';
import { getDefaultViewportSize } from '../ai/canvas/placement';
import type { EquationComponentKind } from '../text/textComponents';
import {
  EQUATION_COMPONENT_LAYOUT,
  resolveStandaloneEquationPlacement,
} from './equationPlacement';
import { measureEquationSize, sanitizeLatexSource } from './latex';

function makeCtx(): EquationComponentExecuteContext {
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

export function uiAddEquationToText(
  targetTextId: string,
  latex: string,
): string | null {
  const store = useCanvasStore.getState();
  const target = store.document.elements.find((e) => e.id === targetTextId);
  if (!target || target.type !== 'text') return null;
  let createdId: string | null = null;
  withHistory(() => {
    const result = executeAddEquationToText(
      {
        type: 'add_equation_to_text',
        target_element_id: targetTextId,
        latex,
      },
      makeCtx(),
    );
    createdId = result.createdId;
  });
  return createdId;
}

export function uiUpdateEquation(equationId: string, latex: string): boolean {
  const t = latex.trim();
  if (!t) return false;
  withHistory(() => {
    executeUpdateEquation(
      { type: 'update_equation', target_element_id: equationId, latex: t },
      makeCtx(),
    );
  });
  return true;
}

export function uiSetEquationTitle(equationId: string, text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  withHistory(() => {
    executeSetEquationTitle(
      { type: 'set_equation_title', target_element_id: equationId, text: t },
      makeCtx(),
    );
  });
  return true;
}

export function uiAddTextToEquation(
  equationId: string,
  component: EquationComponentKind,
  content: string,
): string | null {
  const t = content.trim();
  if (!t) return null;
  let createdId: string | null = null;
  withHistory(() => {
    const result = executeAddTextToEquation(
      {
        type: 'add_text_to_equation',
        target_element_id: equationId,
        component,
        content: t,
      },
      makeCtx(),
    );
    createdId = result.createdId;
  });
  return createdId;
}

export function uiAddEquationSymbolDefinitions(
  equationId: string,
  symbols: SymbolDefinitionSpec[],
): string | null {
  if (symbols.length === 0) return null;
  let createdId: string | null = null;
  withHistory(() => {
    const result = executeAddEquationSymbolDefinitions(
      {
        type: 'add_equation_symbol_definitions',
        target_element_id: equationId,
        symbols,
      },
      makeCtx(),
    );
    createdId = result.createdId;
  });
  return createdId;
}

export function uiAddEquationInterpretation(
  equationId: string,
  content: string,
): string | null {
  const t = content.trim();
  if (!t) return null;
  let createdId: string | null = null;
  withHistory(() => {
    const result = executeAddEquationInterpretation(
      {
        type: 'add_equation_interpretation',
        target_element_id: equationId,
        content: t,
      },
      makeCtx(),
    );
    createdId = result.createdId;
  });
  return createdId;
}

/**
 * True when associating `equationId → textId` would form a cycle
 * (e.g. the text is chrome of this equation, or walks back to it).
 */
export function wouldCreateEquationAssociationCycle(
  equationId: string,
  textId: string,
): boolean {
  if (equationId === textId) return true;
  const elements = useCanvasStore.getState().document.elements;
  const byId = new Map(elements.map((e) => [e.id, e]));
  let cursor: string | undefined = textId;
  const seen = new Set<string>();
  while (cursor) {
    if (cursor === equationId) return true;
    if (seen.has(cursor)) return true;
    seen.add(cursor);
    const el = byId.get(cursor);
    if (!el) return false;
    if (el.type === 'text') {
      cursor = el.componentMeta?.associatedElementId;
      continue;
    }
    if (el.type === 'equation' || el.type === 'graph') {
      cursor = el.association?.associatedElementId;
      continue;
    }
    return false;
  }
  return false;
}

/** Attach an existing standalone equation to a text parent (association only). */
export function uiAttachExistingEquationToText(
  equationId: string,
  textId: string,
): boolean {
  const store = useCanvasStore.getState();
  const eq = store.document.elements.find((e) => e.id === equationId);
  const text = store.document.elements.find((e) => e.id === textId);
  if (!eq || eq.type !== 'equation' || !text || text.type !== 'text') return false;
  if (wouldCreateEquationAssociationCycle(equationId, textId)) return false;
  const order = store.document.elements.filter(
    (e) =>
      e.type === 'equation' && e.association?.associatedElementId === textId,
  ).length;
  withHistory(() => {
    store.updateElement(equationId, (el) => {
      if (el.type !== 'equation') return el;
      return {
        ...el,
        association: {
          associatedElementId: textId,
          placementMode: 'manual',
          order: el.association?.order ?? order,
        },
      };
    });
  });
  return true;
}

/** Detach an EquationElement from its parent TextElement without deleting it. */
export function uiDetachEquationFromText(equationId: string): boolean {
  const store = useCanvasStore.getState();
  const eq = store.document.elements.find((e) => e.id === equationId);
  if (!eq || eq.type !== 'equation' || !eq.association?.associatedElementId) {
    return false;
  }
  withHistory(() => {
    store.updateElement(equationId, (el) => {
      if (el.type !== 'equation') return el;
      return {
        ...el,
        association: {
          placementMode: 'manual',
          order: el.association?.order,
        },
      };
    });
  });
  return true;
}

/** Detach explanatory TextElement chrome from an EquationElement (content kept). */
export function uiDetachTextFromEquation(textId: string): boolean {
  const store = useCanvasStore.getState();
  const text = store.document.elements.find((e) => e.id === textId);
  if (!text || text.type !== 'text' || !text.componentMeta?.associatedElementId) {
    return false;
  }
  const parent = store.document.elements.find(
    (e) => e.id === text.componentMeta?.associatedElementId,
  );
  if (!parent || parent.type !== 'equation') return false;
  withHistory(() => {
    store.updateElement(textId, (el) => {
      if (el.type !== 'text') return el;
      const { associatedElementId: _a, role: _r, ...rest } =
        el.componentMeta ?? { placementMode: 'manual' as const };
      return {
        ...el,
        componentMeta: {
          ...rest,
          placementMode: 'manual',
        },
      };
    });
  });
  return true;
}

/**
 * Add another EquationElement in the same derivation column.
 * Prefer the selected equation's parent TextElement; otherwise create standalone
 * stacked below the current equation (collision-aware).
 */
export function uiAddAnotherEquation(
  equationId: string,
  latex: string,
): string | null {
  const t = latex.trim();
  if (!t) return null;
  const store = useCanvasStore.getState();
  const eq = store.document.elements.find((e) => e.id === equationId);
  if (!eq || eq.type !== 'equation') return null;
  const parentId = eq.association?.associatedElementId;
  if (parentId) {
    const parent = store.document.elements.find((e) => e.id === parentId);
    if (parent?.type === 'text') {
      return uiAddEquationToText(parentId, t);
    }
  }

  let createdId: string | null = null;
  withHistory(() => {
    const cleaned = sanitizeLatexSource(t);
    const size = measureEquationSize(cleaned, { displayMode: true });
    const preferred = {
      x: eq.x + (eq.width - size.width) / 2,
      y: eq.y + eq.height + EQUATION_COMPONENT_LAYOUT.equationStackGap,
      width: size.width,
      height: size.height,
    };
    const overlaps = store.document.elements.some(
      (o) =>
        preferred.y < o.y + o.height &&
        preferred.y + preferred.height > o.y &&
        preferred.x < o.x + o.width &&
        preferred.x + preferred.width > o.x,
    );
    const pos = overlaps
      ? resolveStandaloneEquationPlacement({
          elements: store.document.elements,
          camera: store.document.camera,
          viewport: getDefaultViewportSize(),
          width: size.width,
          height: size.height,
        })
      : preferred;
    const el = createAiEquationElement(
      cleaned,
      { x: pos.x, y: pos.y },
      {
        zIndex: store.nextZIndex(),
        metadata: { operation: 'add_another_equation', source: 'manual' },
      },
    );
    el.width = size.width;
    el.height = size.height;
    store.addElement(el, true);
    createdId = el.id;
  });
  return createdId;
}
