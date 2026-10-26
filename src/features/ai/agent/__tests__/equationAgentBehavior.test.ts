/**
 * Agent behavior fixtures for textbook maths routing
 * (inline vs EquationElement vs associated explanations).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createEmptyDocument,
  DEFAULT_STYLE,
  type TextElement,
} from '../../../../types/canvas';
import { useCanvasStore } from '../../../../store/canvasStore';
import { ragSync } from '../../../rag/ragSync';
import { CANVAS_EDITOR_SYSTEM_PROMPT } from '../prompts/loadAgentPrompt';
import { parseCanvasAgentResponse } from '../parser';
import { executeCanvasOperations } from '../executor';
import { createLiveAgentExecutorTarget } from '../liveExecutor';

function reset(els: TextElement[] = []) {
  useCanvasStore.setState({
    document: { ...createEmptyDocument(), elements: els },
    style: { ...DEFAULT_STYLE },
    selectedIds: els.map((e) => e.id),
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

function seedNotes(): TextElement {
  return {
    id: 'notes_1',
    type: 'text',
    text: 'Study notes on springs.',
    x: 40,
    y: 40,
    width: 360,
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

const emptyCtx = { allowedElementIds: new Set<string>() };
const notesCtx = {
  allowedElementIds: new Set(['notes_1']),
  elementTypes: new Map([['notes_1', 'text' as const]]),
};

describe('equation agent behavior routing', () => {
  beforeEach(() => {
    vi.spyOn(ragSync, 'indexText').mockImplementation(() => {});
    vi.spyOn(ragSync, 'updateGeometry').mockImplementation(() => {});
    vi.spyOn(ragSync, 'scheduleReconcile').mockImplementation(() => {});
    reset();
  });
  afterEach(() => vi.restoreAllMocks());

  it('High-mode prompt restricts primary creates to Text / Graph / Equation', () => {
    expect(CANVAS_EDITOR_SYSTEM_PROMPT).toMatch(
      /PRIMARY ELEMENT TYPES[\s\S]*TextElement[\s\S]*GraphElement[\s\S]*EquationElement/i,
    );
    expect(CANVAS_EDITOR_SYSTEM_PROMPT).toMatch(
      /Never shapes, arrows, freehand/i,
    );
    expect(CANVAS_EDITOR_SYSTEM_PROMPT).toMatch(
      /Inline Math[\s\S]*EquationElement/i,
    );
  });

  it('"Explain Hooke’s law in one paragraph" → TextElement with inline math', () => {
    const plan = parseCanvasAgentResponse(
      JSON.stringify({
        operations: [
          {
            type: 'create_text',
            rich_text: {
              blocks: [
                {
                  type: 'paragraph',
                  spans: [
                    { text: 'Hooke’s law states that the restoring force is ' },
                    { type: 'inline_math', latex: 'F=-kx' },
                    {
                      text: ', where k is the spring constant and x is displacement.',
                    },
                  ],
                },
              ],
            },
            placement: { mode: 'viewport_default' },
          },
        ],
      }),
      emptyCtx,
    );
    executeCanvasOperations(plan, createLiveAgentExecutorTarget());
    const els = useCanvasStore.getState().document.elements;
    expect(els).toHaveLength(1);
    expect(els[0]!.type).toBe('text');
    expect(els.every((e) => e.type !== 'equation')).toBe(true);
  });

  it('"Derive equation of motion" → multiline EquationElements + explanations', () => {
    const plan = parseCanvasAgentResponse(
      JSON.stringify({
        operations: [
          {
            type: 'create_text',
            ref: 'intro',
            text: 'Derive the equation of motion for a mass on a spring.',
            placement: { mode: 'viewport_default' },
          },
          {
            type: 'add_equation_to_text',
            target_ref: 'intro',
            ref: 'eq1',
            latex:
              '\\begin{aligned}F&=-kx\\\\m\\ddot{x}&=-kx\\\\\\ddot{x}+\\frac{k}{m}x&=0\\end{aligned}',
          },
          {
            type: 'add_text_to_equation',
            target_ref: 'eq1',
            component: 'lead_in',
            content: 'Applying Newton’s second law to the restoring force gives:',
          },
          {
            type: 'add_equation_interpretation',
            target_ref: 'eq1',
            content:
              'The angular frequency increases with spring stiffness and decreases with mass.',
          },
        ],
      }),
      emptyCtx,
    );
    executeCanvasOperations(plan, createLiveAgentExecutorTarget());
    const els = useCanvasStore.getState().document.elements;
    expect(els.some((e) => e.type === 'equation')).toBe(true);
    expect(els.some((e) => e.type === 'text')).toBe(true);
    const eq = els.find((e) => e.type === 'equation');
    expect(eq && eq.type === 'equation' && eq.latex.includes('aligned')).toBe(
      true,
    );
    expect(
      els.some(
        (e) =>
          e.type === 'text' &&
          e.componentMeta?.role === 'equation_lead_in',
      ),
    ).toBe(true);
  });

  it('"Add a derivation to these notes" → EquationElements associated with TextElement', () => {
    reset([seedNotes()]);
    executeCanvasOperations(
      parseCanvasAgentResponse(
        JSON.stringify({
          operations: [
            {
              type: 'add_equation_to_text',
              target_element_id: 'notes_1',
              ref: 'eq1',
              latex:
                '\\begin{aligned}F&=-kx\\\\m\\ddot{x}&=-kx\\end{aligned}',
            },
            {
              type: 'add_text_to_equation',
              target_ref: 'eq1',
              component: 'step_explanation',
              content: 'Rearranging yields the standard SHM form.',
            },
          ],
        }),
        notesCtx,
      ),
      createLiveAgentExecutorTarget(),
    );
    const eq = useCanvasStore
      .getState()
      .document.elements.find((e) => e.type === 'equation');
    expect(eq?.type === 'equation' && eq.association?.associatedElementId).toBe(
      'notes_1',
    );
  });

  it('"Explain how we get from this equation to the next" → associated explanation', () => {
    reset([seedNotes()]);
    executeCanvasOperations(
      parseCanvasAgentResponse(
        JSON.stringify({
          operations: [
            {
              type: 'add_equation_to_text',
              target_element_id: 'notes_1',
              ref: 'eq1',
              latex: 'F=-kx',
            },
            {
              type: 'add_text_to_equation',
              target_ref: 'eq1',
              component: 'step_explanation',
              content:
                'Substituting into Newton’s second law connects force to acceleration.',
            },
          ],
        }),
        notesCtx,
      ),
      createLiveAgentExecutorTarget(),
    );
    const els = useCanvasStore.getState().document.elements;
    const eq = els.find((e) => e.type === 'equation')!;
    const step = els.find(
      (e) =>
        e.type === 'text' &&
        e.componentMeta?.role === 'equation_step_explanation',
    );
    expect(step?.type === 'text' && step.componentMeta?.associatedElementId).toBe(
      eq.id,
    );
  });

  it('"Continue the derivation" → subsequent EquationElement under same parent', () => {
    reset([seedNotes()]);
    executeCanvasOperations(
      parseCanvasAgentResponse(
        JSON.stringify({
          operations: [
            {
              type: 'add_equation_to_text',
              target_element_id: 'notes_1',
              ref: 'eq1',
              latex: 'F=-kx',
            },
            {
              type: 'add_equation_to_text',
              target_element_id: 'notes_1',
              ref: 'eq2',
              latex: '\\ddot{x}+\\omega^2 x=0',
            },
          ],
        }),
        notesCtx,
      ),
      createLiveAgentExecutorTarget(),
    );
    const eqs = useCanvasStore
      .getState()
      .document.elements.filter((e) => e.type === 'equation');
    expect(eqs).toHaveLength(2);
    expect(
      eqs.every(
        (e) =>
          e.type === 'equation' &&
          e.association?.associatedElementId === 'notes_1',
      ),
    ).toBe(true);
  });

  it('"Create a separate equation on the canvas" → independent EquationElement', () => {
    executeCanvasOperations(
      parseCanvasAgentResponse(
        JSON.stringify({
          operations: [
            {
              type: 'create_equation',
              latex: 'E=mc^2',
              placement: { mode: 'viewport_default' },
            },
          ],
        }),
        emptyCtx,
      ),
      createLiveAgentExecutorTarget(),
    );
    const eq = useCanvasStore
      .getState()
      .document.elements.find((e) => e.type === 'equation');
    expect(eq?.type).toBe('equation');
    if (eq?.type === 'equation') {
      expect(eq.association?.associatedElementId).toBeUndefined();
    }
  });

  it('"Add a definition of angular frequency" → Definition TextElement component', () => {
    reset([seedNotes()]);
    executeCanvasOperations(
      parseCanvasAgentResponse(
        JSON.stringify({
          operations: [
            {
              type: 'create_text_component',
              component: 'definition',
              content:
                'Angular frequency ω is the rate of oscillation in radians per second.',
              associated_element_id: 'notes_1',
            },
          ],
        }),
        notesCtx,
      ),
      createLiveAgentExecutorTarget(),
    );
    const def = useCanvasStore
      .getState()
      .document.elements.find(
        (e) => e.type === 'text' && e.componentType === 'definition',
      );
    expect(def).toBeTruthy();
  });
});
