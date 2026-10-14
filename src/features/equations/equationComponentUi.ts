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
import { getDefaultViewportSize } from '../ai/canvas/placement';
import type { EquationComponentKind } from '../text/textComponents';

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

/** Attach an existing standalone equation to a text parent (association only). */
export function uiAttachExistingEquationToText(
  equationId: string,
  textId: string,
): boolean {
  const store = useCanvasStore.getState();
  const eq = store.document.elements.find((e) => e.id === equationId);
  const text = store.document.elements.find((e) => e.id === textId);
  if (!eq || eq.type !== 'equation' || !text || text.type !== 'text') return false;
  withHistory(() => {
    store.updateElement(equationId, (el) => {
      if (el.type !== 'equation') return el;
      return {
        ...el,
        association: {
          associatedElementId: textId,
          placementMode: 'manual',
          order: el.association?.order,
        },
      };
    });
  });
  return true;
}
