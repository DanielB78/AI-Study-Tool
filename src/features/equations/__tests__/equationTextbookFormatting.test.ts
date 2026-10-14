/**
 * Textbook-style EquationElement formatting: fixed math size, centred
 * equations, left-aligned prose, smaller symbol defs, ordered reflow.
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
  EQUATION_DEFAULT_FONT_SIZE,
  measureEquationSize,
} from '../latex';
import { equationComponentMapping } from '../../text/textComponents';
import { TEXT_COMPONENT_STYLES } from '../../text/textComponents';
import {
  uiAddTextToEquation,
  uiUpdateEquation,
} from '../equationComponentUi';

function seedText(): TextElement {
  return {
    id: 'text_notes',
    type: 'text',
    text: 'Simple harmonic motion from Hooke’s law.',
    x: 100,
    y: 80,
    width: 400,
    height: 60,
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
  allowedElementIds: new Set(['text_notes']),
  elementTypes: new Map([['text_notes', 'text' as const]]),
};

function rectsOverlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

describe('equation textbook formatting', () => {
  beforeEach(() => {
    vi.spyOn(ragSync, 'indexText').mockImplementation(() => {});
    vi.spyOn(ragSync, 'updateGeometry').mockImplementation(() => {});
    vi.spyOn(ragSync, 'scheduleReconcile').mockImplementation(() => {});
    reset();
  });
  afterEach(() => vi.restoreAllMocks());

  it('uses a fixed default mathematical font size (~20)', () => {
    expect(EQUATION_DEFAULT_FONT_SIZE).toBe(20);
    const size = measureEquationSize('E=mc^2', {
      displayMode: true,
      fontSize: EQUATION_DEFAULT_FONT_SIZE,
    });
    expect(size.width).toBeGreaterThan(40);
    expect(size.height).toBeGreaterThan(30);
  });

  it('maps symbol defs to smaller muted caption style and steps to body text', () => {
    const symbols = equationComponentMapping('symbol_definitions');
    expect(symbols.componentType).toBe('caption');
    expect(TEXT_COMPONENT_STYLES.caption.fontSize).toBeLessThanOrEqual(13);
    expect(TEXT_COMPONENT_STYLES.caption.color).not.toBe('#1a1a1a');
    expect(TEXT_COMPONENT_STYLES.caption.borderWidth).toBe(0);

    const step = equationComponentMapping('step_explanation');
    expect(step.componentType).toBe('main_text');
    expect(TEXT_COMPONENT_STYLES.main_text.fontSize).toBe(15);
    expect(TEXT_COMPONENT_STYLES.main_text.alignment).toBe('left');
    expect(TEXT_COMPONENT_STYLES.main_text.borderWidth).toBe(0);

    const interp = equationComponentMapping('interpretation');
    expect(interp.componentType).toBe('main_text');
    expect(interp.defaultLabel).toBeNull();
  });

  it('builds a full textbook derivation without overlaps or LLM geometry', () => {
    executeCanvasOperations(
      parseCanvasAgentResponse(
        JSON.stringify({
          operations: [
            {
              type: 'add_equation_to_text',
              target_element_id: 'text_notes',
              ref: 'eq1',
              latex:
                '\\begin{aligned}F&=-kx\\\\m\\ddot{x}&=-kx\\\\m\\ddot{x}+kx&=0\\end{aligned}',
            },
            {
              type: 'add_text_to_equation',
              target_ref: 'eq1',
              component: 'lead_in',
              content:
                "Applying Newton’s second law to the restoring force gives:",
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
              type: 'add_text_to_equation',
              target_ref: 'eq1',
              component: 'step_explanation',
              content: 'Dividing through by the mass and rearranging gives:',
            },
            {
              type: 'add_equation_to_text',
              target_element_id: 'text_notes',
              ref: 'eq2',
              latex:
                '\\begin{aligned}\\ddot{x}+\\frac{k}{m}x&=0\\\\\\ddot{x}+\\omega^2 x&=0\\end{aligned}',
            },
            {
              type: 'add_text_to_equation',
              target_ref: 'eq2',
              component: 'interpretation',
              content:
                'Comparing with the standard SHM equation identifies the angular frequency.',
            },
          ],
        }),
        ctx,
      ),
      createLiveAgentExecutorTarget(),
    );

    const els = useCanvasStore.getState().document.elements;
    const eqs = els.filter((e): e is EquationElement => e.type === 'equation');
    expect(eqs).toHaveLength(2);

    // Fixed mathematical font size; agent cannot override.
    for (const eq of eqs) {
      expect(eq.fontSize).toBe(EQUATION_DEFAULT_FONT_SIZE);
      expect(eq.displayMode).toBe('display');
    }

    // Equations centred under parent text column.
    const parent = els.find((e) => e.id === 'text_notes') as TextElement;
    for (const eq of eqs) {
      const centreEq = eq.x + eq.width / 2;
      const centreParent = parent.x + parent.width / 2;
      expect(Math.abs(centreEq - centreParent)).toBeLessThan(8);
    }

    // Chronological stack: eq1 above eq2.
    const [eq1, eq2] = [...eqs].sort((a, b) => a.y - b.y);
    expect(eq1!.y).toBeLessThan(eq2!.y);

    const chromeOf = (eqId: string) =>
      els.filter(
        (e): e is TextElement =>
          e.type === 'text' && e.componentMeta?.associatedElementId === eqId,
      );

    const c1 = chromeOf(eq1!.id);
    const leadIn = c1.find((e) => e.componentMeta?.role === 'equation_lead_in');
    const symbols = c1.find(
      (e) => e.componentMeta?.role === 'equation_symbol_definitions',
    );
    const step = c1.find(
      (e) => e.componentMeta?.role === 'equation_step_explanation',
    );
    const interp = chromeOf(eq2!.id).find(
      (e) => e.componentMeta?.role === 'equation_interpretation',
    );

    expect(leadIn).toBeTruthy();
    expect(symbols).toBeTruthy();
    expect(step).toBeTruthy();
    expect(interp).toBeTruthy();

    // Reading order around eq1: lead-in above; symbols then step below.
    expect(leadIn!.y + leadIn!.height).toBeLessThanOrEqual(eq1!.y + 1);
    expect(symbols!.y).toBeGreaterThanOrEqual(eq1!.y + eq1!.height - 1);
    expect(step!.y).toBeGreaterThan(symbols!.y);
    expect(eq2!.y).toBeGreaterThan(step!.y);
    expect(interp!.y).toBeGreaterThan(eq2!.y + eq2!.height - 1);

    // Styles: body explanations left / no border; symbols smaller muted caption.
    expect(leadIn!.fontSize).toBe(15);
    expect(leadIn!.alignment).toBe('left');
    expect(step!.fontSize).toBe(15);
    expect(symbols!.fontSize).toBe(13);
    expect(symbols!.componentType).toBe('caption');
    expect(interp!.fontSize).toBe(15);

    // Chrome left-aligned to parent content column.
    expect(Math.abs(leadIn!.x - parent.x)).toBeLessThan(2);
    expect(Math.abs(symbols!.x - parent.x)).toBeLessThan(2);
    expect(Math.abs(step!.x - parent.x)).toBeLessThan(2);

    // No overlaps among auto-placed derivation objects.
    const auto = els.filter(
      (e) =>
        e.id === 'text_notes' ||
        e.type === 'equation' ||
        (e.type === 'text' && e.componentMeta?.placementMode !== 'manual'),
    );
    for (let i = 0; i < auto.length; i++) {
      for (let j = i + 1; j < auto.length; j++) {
        const a = auto[i]!;
        const b = auto[j]!;
        // Parent text may sit above lead-in with intentional proximity; skip parent↔lead-in.
        if (
          (a.id === 'text_notes' &&
            b.type === 'text' &&
            b.componentMeta?.role === 'equation_lead_in') ||
          (b.id === 'text_notes' &&
            a.type === 'text' &&
            a.componentMeta?.role === 'equation_lead_in')
        ) {
          continue;
        }
        expect(rectsOverlap(a, b)).toBe(false);
      }
    }
  });

  it('manually inserted step explanation uses identical styling and reflows next equation', () => {
    executeCanvasOperations(
      parseCanvasAgentResponse(
        JSON.stringify({
          operations: [
            {
              type: 'add_equation_to_text',
              target_element_id: 'text_notes',
              ref: 'eq1',
              latex: 'F=-kx',
            },
            {
              type: 'add_equation_to_text',
              target_element_id: 'text_notes',
              ref: 'eq2',
              latex: '\\ddot{x}+\\omega^2 x=0',
            },
          ],
        }),
        ctx,
      ),
      createLiveAgentExecutorTarget(),
    );

    const before = useCanvasStore.getState().document.elements;
    const eqsBefore = before
      .filter((e): e is EquationElement => e.type === 'equation')
      .sort((a, b) => a.y - b.y);
    const eq1 = eqsBefore[0]!;
    const eq2BeforeY = eqsBefore[1]!.y;

    uiAddTextToEquation(
      eq1.id,
      'step_explanation',
      'Substituting into Newton’s second law yields the SHM form:',
    );

    const after = useCanvasStore.getState().document.elements;
    const step = after.find(
      (e) =>
        e.type === 'text' &&
        e.componentMeta?.role === 'equation_step_explanation',
    ) as TextElement;
    const eq2 = after
      .filter((e): e is EquationElement => e.type === 'equation')
      .sort((a, b) => a.y - b.y)[1]!;

    expect(step.fontSize).toBe(15);
    expect(step.alignment).toBe('left');
    expect(step.componentType).toBe('main_text');
    // Second equation moved down to make room.
    expect(eq2.y).toBeGreaterThan(eq2BeforeY);
    expect(eq2.y).toBeGreaterThan(step.y + step.height - 1);
  });

  it('editing latex grows height without changing fontSize and reflows siblings', () => {
    executeCanvasOperations(
      parseCanvasAgentResponse(
        JSON.stringify({
          operations: [
            {
              type: 'add_equation_to_text',
              target_element_id: 'text_notes',
              ref: 'eq1',
              latex: 'F=-kx',
            },
            {
              type: 'add_equation_to_text',
              target_element_id: 'text_notes',
              ref: 'eq2',
              latex: 'E=mc^2',
            },
          ],
        }),
        ctx,
      ),
      createLiveAgentExecutorTarget(),
    );

    const before = useCanvasStore.getState().document.elements;
    const eqs = before
      .filter((e): e is EquationElement => e.type === 'equation')
      .sort((a, b) => a.y - b.y);
    const eq1 = eqs[0]!;
    const eq2Y = eqs[1]!.y;

    uiUpdateEquation(
      eq1.id,
      '\\begin{aligned}F&=-kx\\\\m\\ddot{x}&=-kx\\\\\\ddot{x}+\\omega^2 x&=0\\end{aligned}',
    );

    const after = useCanvasStore.getState().document.elements;
    const updated = after.find((e) => e.id === eq1.id) as EquationElement;
    const eq2 = after.find((e) => e.id === eqs[1]!.id) as EquationElement;
    expect(updated.fontSize).toBe(EQUATION_DEFAULT_FONT_SIZE);
    expect(updated.height).toBeGreaterThan(eq1.height);
    expect(eq2.y).toBeGreaterThan(eq2Y);
  });
});
