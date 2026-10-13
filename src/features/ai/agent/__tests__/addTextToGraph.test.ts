/**
 * add_text_to_graph — TextElements associated with GraphElements.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createEmptyDocument,
  DEFAULT_STYLE,
  type GraphElement,
  type TextElement,
} from '../../../../types/canvas';
import { useCanvasStore } from '../../../../store/canvasStore';
import { ragSync } from '../../../rag/ragSync';
import { executeCanvasOperations } from '../executor';
import { createLiveAgentExecutorTarget } from '../liveExecutor';
import { parseCanvasAgentResponse } from '../parser';
import { getElementBounds, rectsIntersect } from '../../../../utils/coordinates';
import { plainTextToRichText } from '../../../text/richText';
import { ensureBlockIds } from '../../../text/textFeatures';
import { createGraphElement } from '../../../graphs/createGraphElement';
import { resolveExplicitSelection } from '../../../rag/explicitSelection';

function seedText(): TextElement {
  const text = 'Simple harmonic motion.';
  return {
    id: 'text_12',
    type: 'text',
    text,
    richText: ensureBlockIds(plainTextToRichText(text)),
    componentType: 'main_text',
    componentMeta: { placementMode: 'auto' },
    x: 40,
    y: 40,
    width: 320,
    height: 80,
    rotation: 0,
    opacity: 1,
    locked: false,
    zIndex: 1,
    createdAt: 1,
    updatedAt: 1,
    metadata: {},
    fontSize: 15,
    fontFamily: DEFAULT_STYLE.fontFamily,
    fontWeight: 'normal',
    fontItalic: false,
    underline: false,
    strikethrough: false,
    color: '#1a1a1a',
    alignment: 'left',
    lineHeight: 1.45,
    backgroundColor: null,
    padding: 12,
    cornerRadius: 0,
  };
}

function ctx(ids: string[]) {
  return {
    allowedElementIds: new Set(ids),
    elementTypes: new Map(
      ids.map((id) => {
        const el = useCanvasStore
          .getState()
          .document.elements.find((e) => e.id === id);
        return [id, el?.type ?? 'text'] as const;
      }),
    ),
  };
}

function reset(els: Array<TextElement | GraphElement> = [seedText()]) {
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

beforeEach(() => {
  vi.spyOn(ragSync, 'indexText').mockImplementation(() => {});
  reset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('add_text_to_graph', () => {
  it('attaches explanation/definition/exercise to a graph with styles and roles', () => {
    executeCanvasOperations(
      parseCanvasAgentResponse(
        JSON.stringify({
          operations: [
            {
              type: 'create_graph',
              ref: 'g',
              expressions: [{ expression: 'sin(x)', visible: true }],
              points: [],
              viewport: { x_min: -3, x_max: 10, y_min: -1.5, y_max: 1.5 },
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
              target_ref: 'g',
              component: 'main_text',
              content:
                'Displacement varies sinusoidally with time about equilibrium.',
            },
            {
              type: 'add_text_to_graph',
              target_ref: 'g',
              component: 'definition',
              content:
                'Amplitude is the maximum displacement from equilibrium.',
            },
            {
              type: 'add_text_to_graph',
              target_ref: 'g',
              component: 'exercise',
              content: 'Determine the period from the graph.',
            },
          ],
        }),
        { allowedElementIds: new Set() },
      ),
      createLiveAgentExecutorTarget(),
    );

    const els = useCanvasStore.getState().document.elements;
    const graph = els.find((e) => e.type === 'graph') as GraphElement;
    const explanation = els.find(
      (e) =>
        e.type === 'text' && e.componentMeta?.role === 'graph_explanation',
    ) as TextElement;
    const definition = els.find(
      (e) =>
        e.type === 'text' && e.componentMeta?.role === 'graph_definition',
    ) as TextElement;
    const exercise = els.find(
      (e) => e.type === 'text' && e.componentMeta?.role === 'graph_exercise',
    ) as TextElement;

    expect(graph).toBeTruthy();
    expect(explanation.componentType).toBe('main_text');
    expect(definition.componentType).toBe('definition');
    expect(exercise.componentType).toBe('exercise');
    expect(explanation.componentMeta?.associatedElementId).toBe(graph.id);
    expect(definition.componentMeta?.associatedElementId).toBe(graph.id);
    expect(exercise.componentMeta?.associatedElementId).toBe(graph.id);

    // No pairwise overlap among attached texts / graph
    for (const a of [explanation, definition, exercise]) {
      expect(rectsIntersect(getElementBounds(a), getElementBounds(graph))).toBe(
        false,
      );
    }
    expect(
      rectsIntersect(getElementBounds(explanation), getElementBounds(definition)),
    ).toBe(false);
  });

  it('inserts explanation before an existing exercise', () => {
    const g = {
      ...createGraphElement({ x: 100, y: 100, zIndex: 2 }),
      id: 'graph_12',
    };
    const exercise: TextElement = {
      ...seedText(),
      id: 'ex_1',
      text: 'Find the amplitude.',
      componentType: 'exercise',
      componentMeta: {
        placementMode: 'auto',
        associatedElementId: 'graph_12',
        role: 'graph_exercise',
      },
      x: 100,
      y: 100 + g.height + 20,
      width: 400,
      height: 60,
      zIndex: 3,
    };
    reset([seedText(), g, exercise]);

    executeCanvasOperations(
      parseCanvasAgentResponse(
        JSON.stringify({
          operations: [
            {
              type: 'add_text_to_graph',
              target_element_id: 'graph_12',
              component: 'main_text',
              content: 'This graph shows undamped SHM.',
            },
          ],
        }),
        ctx(['text_12', 'graph_12', 'ex_1']),
      ),
      createLiveAgentExecutorTarget(),
    );

    const els = useCanvasStore.getState().document.elements;
    const explanation = els.find(
      (e) =>
        e.type === 'text' && e.componentMeta?.role === 'graph_explanation',
    ) as TextElement;
    const ex = els.find((e) => e.id === 'ex_1') as TextElement;
    expect(explanation.y).toBeLessThan(ex.y);
  });

  it('keeps graph→parent text association when attaching children to the graph', () => {
    executeCanvasOperations(
      parseCanvasAgentResponse(
        JSON.stringify({
          operations: [
            {
              type: 'add_graph_to_text',
              target_element_id: 'text_12',
              ref: 'g',
              expressions: [{ expression: 'cos(x)', visible: true }],
            },
            {
              type: 'add_text_to_graph',
              target_ref: 'g',
              component: 'definition',
              content: 'Phase is the argument of the sinusoid.',
            },
          ],
        }),
        ctx(['text_12']),
      ),
      createLiveAgentExecutorTarget(),
    );
    const els = useCanvasStore.getState().document.elements;
    const graph = els.find((e) => e.type === 'graph') as GraphElement;
    const def = els.find(
      (e) => e.type === 'text' && e.componentType === 'definition',
    ) as TextElement;
    expect(graph.association?.associatedElementId).toBe('text_12');
    expect(def.componentMeta?.associatedElementId).toBe(graph.id);
    expect(def.componentMeta?.associatedElementId).not.toBe('text_12');
  });

  it('preserves caption/title chrome alongside new attached text', () => {
    executeCanvasOperations(
      parseCanvasAgentResponse(
        JSON.stringify({
          operations: [
            {
              type: 'create_graph',
              ref: 'g',
              expressions: [{ expression: 'x', visible: true }],
              points: [],
              viewport: { x_min: -1, x_max: 5, y_min: -1, y_max: 5 },
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
              type: 'add_graph_caption',
              target_ref: 'g',
              text: 'Linear relationship.',
            },
            {
              type: 'add_text_to_graph',
              target_ref: 'g',
              component: 'warning',
              content: 'Do not extrapolate beyond the plotted domain.',
            },
          ],
        }),
        { allowedElementIds: new Set() },
      ),
      createLiveAgentExecutorTarget(),
    );
    const els = useCanvasStore.getState().document.elements;
    const graph = els.find((e) => e.type === 'graph') as GraphElement;
    const caption = els.find(
      (e) => e.type === 'text' && e.componentType === 'caption',
    ) as TextElement;
    const warning = els.find(
      (e) => e.type === 'text' && e.componentType === 'warning',
    ) as TextElement;
    expect(caption.componentMeta?.associatedElementId).toBe(graph.id);
    expect(warning.componentMeta?.associatedElementId).toBe(graph.id);
    expect(warning.y).toBeGreaterThan(caption.y);
  });

  it('includes attached texts when a graph is explicitly selected', () => {
    const g = {
      ...createGraphElement({ x: 0, y: 0, zIndex: 1 }),
      id: 'graph_9',
    };
    const explanation: TextElement = {
      ...seedText(),
      id: 'exp_1',
      text: 'Attached explanation about the graph.',
      componentType: 'main_text',
      componentMeta: {
        placementMode: 'auto',
        associatedElementId: 'graph_9',
        role: 'graph_explanation',
      },
      x: 500,
      y: 0,
      zIndex: 2,
    };
    const sels = resolveExplicitSelection([g.id], [g, explanation]);
    expect(sels.map((s) => s.element_id)).toContain('graph_9');
    expect(sels.map((s) => s.element_id)).toContain('exp_1');
  });

  it('supports example and multiple exercises on one graph', () => {
    executeCanvasOperations(
      parseCanvasAgentResponse(
        JSON.stringify({
          operations: [
            {
              type: 'create_graph',
              ref: 'g',
              expressions: [{ expression: 'sin(x)', visible: true }],
              points: [],
              viewport: { x_min: 0, x_max: 6, y_min: -1, y_max: 1 },
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
              target_ref: 'g',
              component: 'example',
              content: 'A 2 cm amplitude reaches extremes twice per cycle.',
            },
            {
              type: 'add_text_to_graph',
              target_ref: 'g',
              component: 'exercise',
              content: 'Question 1: find the period.',
            },
            {
              type: 'add_text_to_graph',
              target_ref: 'g',
              component: 'exercise',
              content: 'Question 2: find the amplitude.',
            },
          ],
        }),
        { allowedElementIds: new Set() },
      ),
      createLiveAgentExecutorTarget(),
    );
    const els = useCanvasStore.getState().document.elements;
    const graph = els.find((e) => e.type === 'graph') as GraphElement;
    const attached = els.filter(
      (e): e is TextElement =>
        e.type === 'text' && e.componentMeta?.associatedElementId === graph.id,
    );
    expect(attached.filter((e) => e.componentType === 'example')).toHaveLength(1);
    expect(attached.filter((e) => e.componentType === 'exercise')).toHaveLength(2);
  });
});
