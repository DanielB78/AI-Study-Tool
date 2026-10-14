/**
 * Policy tests: agent primary creates must be TextElement / GraphElement /
 * EquationElement via the canonical ops (create_text / create_graph /
 * create_equation). create_equation is retained as the EquationElement
 * constructor — not a competing legacy pathway.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createEmptyDocument,
  DEFAULT_STYLE,
  type TextElement,
} from '../../../../types/canvas';
import { useCanvasStore } from '../../../../store/canvasStore';
import { ragSync } from '../../../rag/ragSync';
import {
  CANONICAL_PRIMARY_CREATE_OPS,
  CANVAS_AGENT_JSON_SCHEMA,
  CANVAS_AGENT_OUTPUT_CONTRACT,
} from '../operations';
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

function seedText(): TextElement {
  return {
    id: 'textbox_12',
    type: 'text',
    text: 'Study notes on energy.',
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

const emptyCtx = { allowedElementIds: new Set<string>() };
const textCtx = {
  allowedElementIds: new Set(['textbox_12']),
  elementTypes: new Map([['textbox_12', 'text' as const]]),
};

function schemaCreateConsts(): string[] {
  const ops = CANVAS_AGENT_JSON_SCHEMA.properties.operations.items as {
    oneOf: Array<{ properties: { type: { const: string } } }>;
  };
  return ops.oneOf.map((b) => b.properties.type.const);
}

describe('canonical three-type agent creation', () => {
  beforeEach(() => {
    vi.spyOn(ragSync, 'indexText').mockImplementation(() => {});
    vi.spyOn(ragSync, 'updateGeometry').mockImplementation(() => {});
    vi.spyOn(ragSync, 'scheduleReconcile').mockImplementation(() => {});
    reset();
  });
  afterEach(() => vi.restoreAllMocks());

  it('exposes exactly three primary create ops in the schema (incl. create_equation)', () => {
    const types = schemaCreateConsts();
    for (const op of CANONICAL_PRIMARY_CREATE_OPS) {
      expect(types).toContain(op);
    }
    expect(types).not.toContain('create_shape');
    expect(types).not.toContain('create_connector');
    expect(types).not.toContain('create_freehand');
    expect(types).not.toContain('create_element');
  });

  it('documents create_equation as the canonical EquationElement constructor', () => {
    expect(CANVAS_EDITOR_SYSTEM_PROMPT).toContain(
      'ALL AI-GENERATED CONTENT MUST USE TEXT ELEMENTS, GRAPH ELEMENTS OR EQUATION ELEMENTS',
    );
    expect(CANVAS_EDITOR_SYSTEM_PROMPT).toMatch(
      /create_equation[\s\S]*canonical/i,
    );
    expect(CANVAS_EDITOR_SYSTEM_PROMPT).toMatch(/not a legacy pathway/i);
    expect(CANVAS_AGENT_OUTPUT_CONTRACT).toMatch(
      /create_equation — CANONICAL EquationElement constructor/i,
    );
  });

  it('paragraph request → TextElement via create_text', () => {
    const plan = parseCanvasAgentResponse(
      JSON.stringify({
        operations: [
          {
            type: 'create_text',
            text: "Newton's second law states that net force equals mass times acceleration.",
            placement: { mode: 'viewport_default' },
          },
        ],
      }),
      emptyCtx,
    );
    expect(plan.operations).toHaveLength(1);
    expect(plan.operations[0]!.type).toBe('create_text');
    executeCanvasOperations(plan, createLiveAgentExecutorTarget());
    const els = useCanvasStore.getState().document.elements;
    expect(els).toHaveLength(1);
    expect(els[0]!.type).toBe('text');
  });

  it('inline math in prose → TextElement with rich_text inline_math', () => {
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
                    { text: 'Hooke’s law gives the restoring force ' },
                    { type: 'inline_math', latex: 'F=-kx' },
                    { text: '.' },
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
    expect(plan.operations[0]!.type).toBe('create_text');
    executeCanvasOperations(plan, createLiveAgentExecutorTarget());
    const el = useCanvasStore.getState().document.elements[0]!;
    expect(el.type).toBe('text');
    if (el.type !== 'text') return;
    expect(el.richText?.blocks.some((b) => b.type === 'paragraph')).toBe(true);
    const spans =
      el.richText?.blocks.find((b) => b.type === 'paragraph') &&
      'spans' in (el.richText!.blocks[0] as { spans?: unknown[] })
        ? (el.richText!.blocks[0] as { spans: Array<{ type?: string }> }).spans
        : [];
    expect(spans.some((s) => s.type === 'inline_math')).toBe(true);
  });

  it('centred equation → EquationElement via create_equation (not TextElement)', () => {
    const plan = parseCanvasAgentResponse(
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
    );
    expect(plan.operations[0]!.type).toBe('create_equation');
    executeCanvasOperations(plan, createLiveAgentExecutorTarget());
    const els = useCanvasStore.getState().document.elements;
    expect(els).toHaveLength(1);
    expect(els[0]!.type).toBe('equation');
    if (els[0]!.type === 'equation') {
      expect(els[0].latex).toBe('E=mc^2');
    }
  });

  it('SHM derivation → TextElement explanations + multiline EquationElements', () => {
    const plan = parseCanvasAgentResponse(
      JSON.stringify({
        output_type: 'step_by_step',
        layout: {
          type: 'chronological_grid',
          placement: { mode: 'viewport_default' },
        },
        operations: [
          {
            type: 'create_text',
            ref: 's1e',
            layout_cell: 'step_1',
            layout_role: 'explanation',
            text: 'The restoring force obeys Hooke’s law.',
          },
          {
            type: 'create_equation',
            ref: 's1m',
            layout_cell: 'step_1',
            layout_role: 'mathematical_step',
            latex: 'F=-kx',
          },
          {
            type: 'create_text',
            ref: 's2e',
            layout_cell: 'step_2',
            layout_role: 'explanation',
            text: 'Apply Newton’s second law.',
          },
          {
            type: 'create_equation',
            ref: 's2m',
            layout_cell: 'step_2',
            layout_role: 'mathematical_step',
            latex:
              '\\begin{aligned}m\\frac{d^2x}{dt^2}&=-kx\\\\\\frac{d^2x}{dt^2}+\\omega^2 x&=0\\end{aligned}',
          },
        ],
      }),
      emptyCtx,
    );
    const types = plan.operations.map((o) => o.type);
    expect(types.filter((t) => t === 'create_text')).toHaveLength(2);
    expect(types.filter((t) => t === 'create_equation')).toHaveLength(2);
    executeCanvasOperations(plan, createLiveAgentExecutorTarget());
    const els = useCanvasStore.getState().document.elements;
    expect(els.filter((e) => e.type === 'text').length).toBeGreaterThanOrEqual(2);
    expect(els.filter((e) => e.type === 'equation').length).toBe(2);
    expect(els.every((e) => e.type === 'text' || e.type === 'equation')).toBe(
      true,
    );
  });

  it('add centred equation to notes → EquationElement associated with TextElement', () => {
    reset([seedText()]);
    const plan = parseCanvasAgentResponse(
      JSON.stringify({
        operations: [
          {
            type: 'add_equation_to_text',
            target_element_id: 'textbox_12',
            ref: 'eq1',
            latex: 'E=mc^2',
          },
        ],
      }),
      textCtx,
    );
    expect(plan.operations[0]!.type).toBe('add_equation_to_text');
    executeCanvasOperations(plan, createLiveAgentExecutorTarget());
    const eq = useCanvasStore
      .getState()
      .document.elements.find((e) => e.type === 'equation');
    expect(eq).toBeTruthy();
    if (eq?.type === 'equation') {
      expect(eq.association?.associatedElementId).toBe('textbox_12');
    }
  });

  it('plot sin/cos → GraphElement via create_graph', () => {
    const plan = parseCanvasAgentResponse(
      JSON.stringify({
        operations: [
          {
            type: 'create_graph',
            expressions: [
              { expression: 'sin(x)', visible: true },
              { expression: 'cos(x)', visible: true },
            ],
            points: [],
            viewport: { x_min: -10, x_max: 10, y_min: -2, y_max: 2 },
            settings: {
              title: null,
              x_axis_label: null,
              y_axis_label: null,
              show_grid: true,
              show_x_axis: true,
              show_y_axis: true,
            },
            placement: { mode: 'viewport_default' },
          },
        ],
      }),
      emptyCtx,
    );
    expect(plan.operations[0]!.type).toBe('create_graph');
    executeCanvasOperations(plan, createLiveAgentExecutorTarget());
    const els = useCanvasStore.getState().document.elements;
    expect(els).toHaveLength(1);
    expect(els[0]!.type).toBe('graph');
    if (els[0]!.type === 'graph') {
      expect(els[0].expressions).toHaveLength(2);
    }
  });

  it('explain graph → TextElement associated with GraphElement', () => {
    const plan = parseCanvasAgentResponse(
      JSON.stringify({
        operations: [
          {
            type: 'create_graph',
            ref: 'g1',
            expressions: [{ expression: 'sin(x)', visible: true }],
            points: [],
            viewport: { x_min: -10, x_max: 10, y_min: -2, y_max: 2 },
            settings: {
              title: null,
              x_axis_label: null,
              y_axis_label: null,
              show_grid: true,
              show_x_axis: true,
              show_y_axis: true,
            },
            placement: { mode: 'viewport_default' },
          },
          {
            type: 'add_text_to_graph',
            target_ref: 'g1',
            component: 'main_text',
            content:
              'The sine curve oscillates between −1 and 1 with period 2π.',
          },
        ],
      }),
      emptyCtx,
    );
    executeCanvasOperations(plan, createLiveAgentExecutorTarget());
    const els = useCanvasStore.getState().document.elements;
    const graph = els.find((e) => e.type === 'graph');
    const text = els.find(
      (e) => e.type === 'text' && e.componentMeta?.associatedElementId,
    );
    expect(graph).toBeTruthy();
    expect(text).toBeTruthy();
    if (graph && text?.type === 'text') {
      expect(text.componentMeta?.associatedElementId).toBe(graph.id);
    }
  });

  it('explain equation step → equation-associated TextElement component', () => {
    reset([seedText()]);
    const plan = parseCanvasAgentResponse(
      JSON.stringify({
        operations: [
          {
            type: 'add_equation_to_text',
            target_element_id: 'textbox_12',
            ref: 'eq1',
            latex: 'F=-kx',
          },
          {
            type: 'add_text_to_equation',
            target_ref: 'eq1',
            component: 'step_explanation',
            content:
              'Divide by m and set ω² = k/m to reach the standard SHM form.',
          },
        ],
      }),
      textCtx,
    );
    executeCanvasOperations(plan, createLiveAgentExecutorTarget());
    const els = useCanvasStore.getState().document.elements;
    const eq = els.find((e) => e.type === 'equation');
    const step = els.find(
      (e) =>
        e.type === 'text' &&
        e.componentMeta?.role === 'equation_step_explanation',
    );
    expect(eq).toBeTruthy();
    expect(step).toBeTruthy();
    if (eq && step?.type === 'text') {
      expect(step.componentMeta?.associatedElementId).toBe(eq.id);
    }
  });
});
