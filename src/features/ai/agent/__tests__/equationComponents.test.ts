import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createEmptyDocument,
  DEFAULT_STYLE,
  type TextElement,
} from '../../../../types/canvas';
import { useCanvasStore } from '../../../../store/canvasStore';
import { ragSync } from '../../../rag/ragSync';
import { executeCanvasOperations } from '../executor';
import { parseCanvasAgentResponse } from '../parser';
import { createLiveAgentExecutorTarget } from '../liveExecutor';
import { measureEquationSize, validateLatex } from '../../../equations/latex';

function seedText(): TextElement {
  return {
    id: 'text_eq_1',
    type: 'text',
    text: 'Consider a mass on a spring.',
    x: 40,
    y: 40,
    width: 360,
    height: 80,
    rotation: 0,
    opacity: 1,
    locked: false,
    zIndex: 1,
    fontSize: 16,
    fontFamily: 'Arial',
    fontWeight: 'normal',
    fontItalic: false,
    underline: false,
    strikethrough: false,
    color: '#1a1a1a',
    alignment: 'left',
    lineHeight: 1.35,
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

function ctx(ids: string[], types?: Map<string, string>) {
  return {
    allowedElementIds: new Set(ids),
    elementTypes:
      types ?? new Map(ids.map((id) => [id, 'text' as const])),
  };
}

describe('equation textbook components', () => {
  beforeEach(() => {
    vi.spyOn(ragSync, 'indexText').mockImplementation(() => {});
    vi.spyOn(ragSync, 'updateGeometry').mockImplementation(() => {});
    vi.spyOn(ragSync, 'scheduleReconcile').mockImplementation(() => {});
    reset();
  });
  afterEach(() => vi.restoreAllMocks());

  it('validates and measures multiline aligned LaTeX', () => {
    const latex =
      '\\begin{aligned}F&=-kx\\\\m\\ddot{x}&=-kx\\\\\\ddot{x}+\\frac{k}{m}x&=0\\end{aligned}';
    expect(validateLatex(latex, true).ok).toBe(true);
    const size = measureEquationSize(latex, { displayMode: true, fontSize: 20 });
    expect(size.width).toBeGreaterThan(40);
    expect(size.height).toBeGreaterThan(40);
  });

  it('parses add_equation_to_text and add_text_to_equation', () => {
    const plan = parseCanvasAgentResponse(
      JSON.stringify({
        operations: [
          {
            type: 'add_equation_to_text',
            target_element_id: 'text_eq_1',
            ref: 'motion',
            latex:
              '\\begin{aligned}F&=-kx\\\\m\\ddot{x}&=-kx\\end{aligned}',
          },
          {
            type: 'add_text_to_equation',
            target_ref: 'motion',
            component: 'lead_in',
            content: "Applying Newton's second law gives:",
          },
        ],
      }),
      ctx(['text_eq_1']),
    );
    expect(plan.operations[0]!.type).toBe('add_equation_to_text');
    expect(plan.operations[1]!.type).toBe('add_text_to_equation');
  });

  it('executes derivation: equation + lead-in + interpretation + symbols', () => {
    const id = 'text_eq_1';
    executeCanvasOperations(
      parseCanvasAgentResponse(
        JSON.stringify({
          operations: [
            {
              type: 'add_equation_to_text',
              target_element_id: id,
              ref: 'eq1',
              latex:
                '\\begin{aligned}F&=-kx\\\\m\\ddot{x}&=-kx\\\\\\ddot{x}+\\omega^2 x&=0\\end{aligned}',
            },
            {
              type: 'add_text_to_equation',
              target_ref: 'eq1',
              component: 'lead_in',
              content: 'Starting from Hooke’s law:',
            },
            {
              type: 'add_text_to_equation',
              target_ref: 'eq1',
              component: 'step_explanation',
              content:
                'Rearranging identifies the angular frequency ω = √(k/m).',
            },
            {
              type: 'add_equation_symbol_definitions',
              target_ref: 'eq1',
              symbols: [
                { symbol: 'm', definition: 'Mass of the object' },
                { symbol: 'k', definition: 'Spring constant' },
                { symbol: 'x', definition: 'Displacement from equilibrium' },
              ],
            },
            {
              type: 'add_equation_interpretation',
              target_ref: 'eq1',
              content:
                'Stiffer springs and lighter masses oscillate more rapidly.',
            },
          ],
        }),
        ctx([id]),
      ),
      createLiveAgentExecutorTarget(),
    );

    const els = useCanvasStore.getState().document.elements;
    const equation = els.find((e) => e.type === 'equation');
    expect(equation).toBeTruthy();
    if (!equation || equation.type !== 'equation') return;
    expect(equation.association?.associatedElementId).toBe(id);
    expect(equation.latex).toContain('aligned');

    const chrome = els.filter(
      (e) =>
        e.type === 'text' &&
        e.componentMeta?.associatedElementId === equation.id,
    );
    const roles = chrome.map((e) =>
      e.type === 'text' ? e.componentMeta?.role : null,
    );
    expect(roles).toContain('equation_lead_in');
    expect(roles).toContain('equation_step_explanation');
    expect(roles).toContain('equation_symbol_definitions');
    expect(roles).toContain('equation_interpretation');

    // No overlap between equation and its auto chrome (rough AABB check).
    for (const c of chrome) {
      if (c.type !== 'text') continue;
      if (c.componentMeta?.placementMode === 'manual') continue;
      const overlapX =
        c.x < equation.x + equation.width && c.x + c.width > equation.x;
      const overlapY =
        c.y < equation.y + equation.height && c.y + c.height > equation.y;
      // Lead-in/title are above; below stack should not overlap equation body.
      if (
        c.componentMeta?.role === 'equation_step_explanation' ||
        c.componentMeta?.role === 'equation_interpretation' ||
        c.componentMeta?.role === 'equation_symbol_definitions'
      ) {
        expect(overlapY && overlapX).toBe(false);
      }
    }
  });

  it('update_equation remeasures latex', () => {
    const id = 'text_eq_1';
    executeCanvasOperations(
      parseCanvasAgentResponse(
        JSON.stringify({
          operations: [
            {
              type: 'add_equation_to_text',
              target_element_id: id,
              ref: 'eq',
              latex: 'F=-kx',
            },
          ],
        }),
        ctx([id]),
      ),
      createLiveAgentExecutorTarget(),
    );
    const before = useCanvasStore
      .getState()
      .document.elements.find((e) => e.type === 'equation');
    expect(before?.type).toBe('equation');
    if (before?.type !== 'equation') return;

    executeCanvasOperations(
      parseCanvasAgentResponse(
        JSON.stringify({
          operations: [
            {
              type: 'update_equation',
              target_element_id: before.id,
              latex:
                '\\begin{aligned}F&=-kx\\\\m\\ddot{x}&=-kx\\end{aligned}',
            },
          ],
        }),
        {
          allowedElementIds: new Set([id, before.id]),
          elementTypes: new Map([
            [id, 'text'],
            [before.id, 'equation'],
          ]),
        },
      ),
      createLiveAgentExecutorTarget(),
    );
    const after = useCanvasStore
      .getState()
      .document.elements.find((e) => e.id === before.id);
    expect(after?.type).toBe('equation');
    if (after?.type !== 'equation') return;
    expect(after.latex).toContain('aligned');
    expect(after.height).toBeGreaterThanOrEqual(before.height);
  });

  it('accepts free-form content on add_equation_symbol_definitions (LLM fallback)', () => {
    executeCanvasOperations(
      parseCanvasAgentResponse(
        JSON.stringify({
          operations: [
            {
              type: 'create_equation',
              ref: 'final_equations',
              latex:
                '\\boxed{\\begin{aligned}x\'&=\\gamma(x-vt)\\\\t\'&=\\gamma\\left(t-\\frac{vx}{c^2}\\right)\\end{aligned}}',
              placement: { mode: 'viewport_default' },
            },
            {
              type: 'add_equation_symbol_definitions',
              target_ref: 'final_equations',
              content:
                'where γ = 1/√(1 − v²/c²) is the Lorentz factor, v is the velocity of S′ relative to S, and c is the speed of light in vacuum.',
            },
          ],
        }),
        { allowedElementIds: new Set() },
      ),
      createLiveAgentExecutorTarget(),
    );

    const els = useCanvasStore.getState().document.elements;
    const eq = els.find((e) => e.type === 'equation');
    const defs = els.find(
      (e) =>
        e.type === 'text' &&
        e.componentMeta?.role === 'equation_symbol_definitions',
    );
    expect(eq).toBeTruthy();
    expect(defs).toBeTruthy();
    if (defs?.type !== 'text') return;
    expect(defs.text).toContain('Lorentz factor');
    // Leading "where" stripped — the component label already provides it.
    expect(defs.text.toLowerCase().startsWith('where')).toBe(false);
    expect(defs.componentMeta?.associatedElementId).toBe(eq!.id);
  });
});
