/**
 * Manual association helpers: attach / detach / cycle prevention /
 * Add Another Equation — shared with Equation Features UI.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createEmptyDocument,
  DEFAULT_STYLE,
  type EquationElement,
  type TextElement,
} from '../../../types/canvas';
import { useCanvasStore } from '../../../store/canvasStore';
import { ragSync } from '../../rag/ragSync';
import { executeCanvasOperations } from '../../ai/agent/executor';
import { parseCanvasAgentResponse } from '../../ai/agent/parser';
import { createLiveAgentExecutorTarget } from '../../ai/agent/liveExecutor';
import {
  uiAddAnotherEquation,
  uiAddTextToEquation,
  uiAttachExistingEquationToText,
  uiDetachEquationFromText,
  uiDetachTextFromEquation,
  wouldCreateEquationAssociationCycle,
} from '../equationComponentUi';

function seedText(): TextElement {
  return {
    id: 'text_parent',
    type: 'text',
    text: 'Notes on oscillations.',
    x: 80,
    y: 60,
    width: 380,
    height: 70,
    rotation: 0,
    opacity: 1,
    locked: false,
    zIndex: 1,
    fontSize: 15,
    fontFamily: 'Georgia, "Times New Roman", serif',
    fontWeight: 'normal',
    fontItalic: false,
    underline: false,
    strikethrough: false,
    color: '#1a1a1a',
    alignment: 'left',
    lineHeight: 1.45,
    padding: 12,
    backgroundColor: null,
    cornerRadius: 0,
  };
}

function reset(els: TextElement[] = [seedText()]) {
  useCanvasStore.setState({
    document: { ...createEmptyDocument(), elements: els },
    style: { ...DEFAULT_STYLE },
    selectedIds: [els[0]!.id],
    activeTool: 'select',
    editingTextId: null,
    editingShapeLabelId: null,
    past: [],
    future: [],
    historySuspended: false,
    marquee: null,
    draftPoints: null,
    draftShape: null,
    clipboard: [],
    snapGuides: [],
  });
}

const ctx = {
  allowedElementIds: new Set(['text_parent']),
  elementTypes: new Map([['text_parent', 'text' as const]]),
};

describe('equation associations (manual + AI shared path)', () => {
  beforeEach(() => {
    vi.spyOn(ragSync, 'indexText').mockImplementation(() => {});
    vi.spyOn(ragSync, 'updateGeometry').mockImplementation(() => {});
    vi.spyOn(ragSync, 'scheduleReconcile').mockImplementation(() => {});
    reset();
  });
  afterEach(() => vi.restoreAllMocks());

  function createAttachedEquation(latex = 'F=-kx'): EquationElement {
    executeCanvasOperations(
      parseCanvasAgentResponse(
        JSON.stringify({
          operations: [
            {
              type: 'add_equation_to_text',
              target_element_id: 'text_parent',
              ref: 'eq1',
              latex,
            },
          ],
        }),
        ctx,
      ),
      createLiveAgentExecutorTarget(),
    );
    const eq = useCanvasStore
      .getState()
      .document.elements.find((e): e is EquationElement => e.type === 'equation');
    expect(eq).toBeTruthy();
    return eq!;
  }

  it('prevents associating an equation to its own chrome text (cycle)', () => {
    const eq = createAttachedEquation();
    uiAddTextToEquation(eq.id, 'lead_in', 'Starting from Hooke’s law:');
    const leadIn = useCanvasStore
      .getState()
      .document.elements.find(
        (e) =>
          e.type === 'text' &&
          e.componentMeta?.role === 'equation_lead_in' &&
          e.componentMeta.associatedElementId === eq.id,
      ) as TextElement;
    expect(leadIn).toBeTruthy();
    expect(wouldCreateEquationAssociationCycle(eq.id, leadIn.id)).toBe(true);
    expect(uiAttachExistingEquationToText(eq.id, leadIn.id)).toBe(false);
  });

  it('detaches equation from parent text without deleting content', () => {
    const eq = createAttachedEquation('E=mc^2');
    expect(eq.association?.associatedElementId).toBe('text_parent');
    expect(uiDetachEquationFromText(eq.id)).toBe(true);
    const after = useCanvasStore
      .getState()
      .document.elements.find((e) => e.id === eq.id) as EquationElement;
    expect(after.latex).toBe('E=mc^2');
    expect(after.association?.associatedElementId).toBeUndefined();
    expect(after.association?.placementMode).toBe('manual');
    expect(
      useCanvasStore.getState().document.elements.some((e) => e.id === 'text_parent'),
    ).toBe(true);
  });

  it('detaches explanatory text from equation without deleting either', () => {
    const eq = createAttachedEquation();
    const chromeId = uiAddTextToEquation(
      eq.id,
      'step_explanation',
      'This isolates the angular frequency.',
    );
    expect(chromeId).toBeTruthy();
    expect(uiDetachTextFromEquation(chromeId!)).toBe(true);
    const chrome = useCanvasStore
      .getState()
      .document.elements.find((e) => e.id === chromeId) as TextElement;
    expect(chrome.text).toContain('angular frequency');
    expect(chrome.componentMeta?.associatedElementId).toBeUndefined();
    expect(chrome.componentMeta?.placementMode).toBe('manual');
    expect(
      useCanvasStore.getState().document.elements.some((e) => e.id === eq.id),
    ).toBe(true);
  });

  it('Add Another Equation stacks under the same parent TextElement', () => {
    const eq1 = createAttachedEquation('F=-kx');
    const id2 = uiAddAnotherEquation(
      eq1.id,
      '\\begin{aligned}\\ddot{x}+\\omega^2 x&=0\\end{aligned}',
    );
    expect(id2).toBeTruthy();
    const eqs = useCanvasStore
      .getState()
      .document.elements.filter((e): e is EquationElement => e.type === 'equation')
      .sort((a, b) => a.y - b.y);
    expect(eqs).toHaveLength(2);
    expect(eqs[0]!.id).toBe(eq1.id);
    expect(eqs[1]!.id).toBe(id2);
    expect(eqs[1]!.association?.associatedElementId).toBe('text_parent');
    expect(eqs[1]!.y).toBeGreaterThan(eqs[0]!.y);
  });

  it('Add Another Equation creates standalone when equation has no parent', () => {
    executeCanvasOperations(
      parseCanvasAgentResponse(
        JSON.stringify({
          operations: [
            {
              type: 'create_equation',
              latex: 'F=-kx',
              placement: { mode: 'viewport_default' },
            },
          ],
        }),
        { allowedElementIds: new Set() },
      ),
      createLiveAgentExecutorTarget(),
    );
    const eq = useCanvasStore
      .getState()
      .document.elements.find((e): e is EquationElement => e.type === 'equation')!;
    const id2 = uiAddAnotherEquation(eq.id, 'E=mc^2');
    expect(id2).toBeTruthy();
    const eqs = useCanvasStore
      .getState()
      .document.elements.filter((e) => e.type === 'equation');
    expect(eqs).toHaveLength(2);
    const second = eqs.find((e) => e.id === id2) as EquationElement;
    expect(second.association?.associatedElementId).toBeUndefined();
    expect(second.latex).toBe('E=mc^2');
  });
});
