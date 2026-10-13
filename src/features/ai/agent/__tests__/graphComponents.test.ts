/**
 * Graph textbook components — attach to text, titles, captions, comments.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createEmptyDocument,
  DEFAULT_STYLE,
  DOCUMENT_VERSION,
  type GraphElement,
  type TextElement,
} from '../../../../types/canvas';
import { useCanvasStore } from '../../../../store/canvasStore';
import { migrateDocument } from '../../../../persistence/migrate';
import { ragSync } from '../../../rag/ragSync';
import { executeCanvasOperations } from '../executor';
import { createLiveAgentExecutorTarget } from '../liveExecutor';
import { parseCanvasAgentResponse } from '../parser';
import { createGraphElement } from '../../../graphs/createGraphElement';
import { getElementBounds, rectsIntersect } from '../../../../utils/coordinates';
import { plainTextToRichText } from '../../../text/richText';
import { ensureBlockIds } from '../../../text/textFeatures';

function seedText(): TextElement {
  const text = 'Simple harmonic motion describes oscillators.';
  return {
    id: 'text_12',
    type: 'text',
    text,
    richText: ensureBlockIds(plainTextToRichText(text)),
    componentType: 'main_text',
    componentMeta: { placementMode: 'auto' },
    x: 100,
    y: 100,
    width: 360,
    height: 100,
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

function ctx(ids = ['text_12']) {
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

describe('graph textbook components', () => {
  beforeEach(() => {
    reset();
    vi.spyOn(ragSync, 'indexText').mockImplementation(() => {});
    vi.spyOn(ragSync, 'updateGeometry').mockImplementation(() => {});
    vi.spyOn(ragSync, 'scheduleReconcile').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('add_graph_to_text creates an associated GraphElement without coordinates', () => {
    const plan = parseCanvasAgentResponse(
      JSON.stringify({
        operations: [
          {
            type: 'add_graph_to_text',
            target_element_id: 'text_12',
            ref: 'g1',
            expressions: [
              {
                expression: 'sin(x)',
                visible: true,
                domain_min: null,
                domain_max: null,
              },
            ],
          },
        ],
      }),
      ctx(),
    );
    const result = executeCanvasOperations(plan, createLiveAgentExecutorTarget());
    expect(result.createdIds).toHaveLength(1);
    const graph = useCanvasStore
      .getState()
      .document.elements.find((e) => e.id === result.createdIds[0]);
    expect(graph?.type).toBe('graph');
    if (graph?.type === 'graph') {
      expect(graph.association?.associatedElementId).toBe('text_12');
      expect(graph.association?.placementMode).toBe('auto');
      expect(graph.y).toBeGreaterThanOrEqual(100);
      expect(graph.expressions[0]?.sourceText).toBe('sin(x)');
    }
  });

  it('set_graph_title creates a Title TextElement above the graph', () => {
    const plan = parseCanvasAgentResponse(
      JSON.stringify({
        operations: [
          {
            type: 'add_graph_to_text',
            target_element_id: 'text_12',
            ref: 'disp',
            expressions: [{ expression: 'cos(x)', visible: true }],
          },
          {
            type: 'set_graph_title',
            target_ref: 'disp',
            text: 'Displacement vs Time',
          },
        ],
      }),
      ctx(),
    );
    executeCanvasOperations(plan, createLiveAgentExecutorTarget());
    const els = useCanvasStore.getState().document.elements;
    const graph = els.find((e) => e.type === 'graph') as GraphElement;
    const title = els.find(
      (e): e is TextElement =>
        e.type === 'text' && e.componentMeta?.role === 'graph_title',
    );
    expect(title).toBeTruthy();
    expect(title!.text).toBe('Displacement vs Time');
    expect(title!.componentMeta?.associatedElementId).toBe(graph.id);
    expect(title!.y + title!.height).toBeLessThanOrEqual(graph.y + 1);
    expect(graph.settings.title).toBe('Displacement vs Time');
  });

  it('caption and observation place below the graph without overlap', () => {
    executeCanvasOperations(
      parseCanvasAgentResponse(
        JSON.stringify({
          operations: [
            {
              type: 'add_graph_to_text',
              target_element_id: 'text_12',
              ref: 'g',
              expressions: [{ expression: 'sin(x)', visible: true }],
            },
            {
              type: 'add_graph_caption',
              target_ref: 'g',
              text: 'Displacement oscillates sinusoidally.',
            },
            {
              type: 'add_graph_observation',
              target_ref: 'g',
              text: 'Maximum speed occurs at equilibrium.',
            },
          ],
        }),
        ctx(),
      ),
      createLiveAgentExecutorTarget(),
    );
    const els = useCanvasStore.getState().document.elements;
    const graph = els.find((e) => e.type === 'graph') as GraphElement;
    const caption = els.find(
      (e) => e.type === 'text' && e.componentType === 'caption',
    ) as TextElement;
    const obs = els.find(
      (e) => e.type === 'text' && e.componentType === 'key_observation',
    ) as TextElement;
    expect(caption.y).toBeGreaterThanOrEqual(graph.y + graph.height - 1);
    expect(obs.y).toBeGreaterThanOrEqual(caption.y + caption.height - 1);
    expect(rectsIntersect(getElementBounds(caption), getElementBounds(obs))).toBe(
      false,
    );
  });

  it('multiple graphs attach independently to the same text', () => {
    executeCanvasOperations(
      parseCanvasAgentResponse(
        JSON.stringify({
          operations: [
            {
              type: 'add_graph_to_text',
              target_element_id: 'text_12',
              ref: 'g1',
              expressions: [{ expression: 'cos(x)', visible: true }],
            },
            {
              type: 'add_graph_to_text',
              target_element_id: 'text_12',
              ref: 'g2',
              expressions: [{ expression: '-sin(x)', visible: true }],
            },
            {
              type: 'set_graph_title',
              target_ref: 'g1',
              text: 'Displacement',
            },
            {
              type: 'set_graph_title',
              target_ref: 'g2',
              text: 'Velocity',
            },
          ],
        }),
        ctx(),
      ),
      createLiveAgentExecutorTarget(),
    );
    const graphs = useCanvasStore
      .getState()
      .document.elements.filter((e): e is GraphElement => e.type === 'graph');
    expect(graphs).toHaveLength(2);
    expect(
      graphs.every((g) => g.association?.associatedElementId === 'text_12'),
    ).toBe(true);
    expect(graphs[0]!.id).not.toBe(graphs[1]!.id);
    // Editing one graph's settings does not wipe the other
    expect(graphs.filter((g) => g.settings.title)).toHaveLength(2);
  });

  it('places graph before an associated exercise', () => {
    executeCanvasOperations(
      parseCanvasAgentResponse(
        JSON.stringify({
          operations: [
            {
              type: 'create_text_component',
              component: 'exercise',
              content: 'Calculate the period.',
              associated_element_id: 'text_12',
            },
          ],
        }),
        ctx(),
      ),
      createLiveAgentExecutorTarget(),
    );
    const exercise = useCanvasStore
      .getState()
      .document.elements.find(
        (e) => e.type === 'text' && e.componentType === 'exercise',
      ) as TextElement;
    const exerciseYBefore = exercise.y;

    executeCanvasOperations(
      parseCanvasAgentResponse(
        JSON.stringify({
          operations: [
            {
              type: 'add_graph_to_text',
              target_element_id: 'text_12',
              expressions: [{ expression: 'sin(x)', visible: true }],
            },
          ],
        }),
        ctx(),
      ),
      createLiveAgentExecutorTarget(),
    );
    const graph = useCanvasStore
      .getState()
      .document.elements.find((e) => e.type === 'graph') as GraphElement;
    const exerciseAfter = useCanvasStore
      .getState()
      .document.elements.find((e) => e.id === exercise.id) as TextElement;
    expect(graph.y).toBeLessThanOrEqual(exerciseAfter.y + 1);
    // Exercise may have been shifted down
    expect(exerciseAfter.y).toBeGreaterThanOrEqual(exerciseYBefore);
  });

  it('annotate_graph_point reuses GraphPoint model', () => {
    executeCanvasOperations(
      parseCanvasAgentResponse(
        JSON.stringify({
          operations: [
            {
              type: 'add_graph_to_text',
              target_element_id: 'text_12',
              ref: 'g',
              expressions: [{ expression: 'sin(x)', visible: true }],
            },
          ],
        }),
        ctx(),
      ),
      createLiveAgentExecutorTarget(),
    );
    const graph = useCanvasStore
      .getState()
      .document.elements.find((e) => e.type === 'graph') as GraphElement;
    const exprId = graph.expressions[0]!.id;
    executeCanvasOperations(
      parseCanvasAgentResponse(
        JSON.stringify({
          operations: [
            {
              type: 'annotate_graph_point',
              target_element_id: graph.id,
              expression_id: exprId,
              x: 1.5708,
              label: 'Maximum',
            },
          ],
        }),
        {
          allowedElementIds: new Set([graph.id, 'text_12']),
          elementTypes: new Map([
            [graph.id, 'graph'],
            ['text_12', 'text'],
          ]),
        },
      ),
      createLiveAgentExecutorTarget(),
    );
    const updated = useCanvasStore
      .getState()
      .document.elements.find((e) => e.id === graph.id) as GraphElement;
    expect(updated.points).toHaveLength(1);
    expect(updated.points[0]!.label).toBe('Maximum');
    expect(updated.points[0]!.y).toBeCloseTo(1, 1);
  });

  it('add_graph_comment anchors to an expression', () => {
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
          ],
        }),
        ctx(),
      ),
      createLiveAgentExecutorTarget(),
    );
    const graph = useCanvasStore
      .getState()
      .document.elements.find((e) => e.type === 'graph') as GraphElement;
    executeCanvasOperations(
      parseCanvasAgentResponse(
        JSON.stringify({
          operations: [
            {
              type: 'add_graph_comment',
              target_element_id: graph.id,
              anchor: { expression_id: graph.expressions[0]!.id },
              comment: 'Undamped oscillator displacement.',
            },
          ],
        }),
        {
          allowedElementIds: new Set([graph.id, 'text_12']),
          elementTypes: new Map([
            [graph.id, 'graph'],
            ['text_12', 'text'],
          ]),
        },
      ),
      createLiveAgentExecutorTarget(),
    );
    const comment = useCanvasStore
      .getState()
      .document.elements.find(
        (e) => e.type === 'text' && e.componentMeta?.role === 'graph_comment',
      ) as TextElement;
    expect(comment).toBeTruthy();
    expect(comment.componentMeta?.graphAnchor?.expressionId).toBe(
      graph.expressions[0]!.id,
    );
  });

  it('persists graph association through migrateDocument', () => {
    const graph = createGraphElement({ x: 10, y: 20, zIndex: 2 });
    graph.association = {
      associatedElementId: 'text_12',
      placementMode: 'auto',
      order: 0,
    };
    const raw = {
      version: 7,
      id: 'board_g',
      camera: { x: 0, y: 0, zoom: 1 },
      elements: [seedText(), graph],
    };
    const doc = migrateDocument(raw);
    expect(doc?.version).toBe(DOCUMENT_VERSION);
    const g = doc!.elements.find((e) => e.type === 'graph') as GraphElement;
    expect(g.association?.associatedElementId).toBe('text_12');
  });

  it('existing create_graph still works (regression)', () => {
    const plan = parseCanvasAgentResponse(
      JSON.stringify({
        operations: [
          {
            type: 'create_graph',
            expressions: [
              {
                expression: 'x**2',
                visible: true,
                domain_min: null,
                domain_max: null,
              },
            ],
            points: [],
            viewport: { x_min: -10, x_max: 10, y_min: -10, y_max: 10 },
            settings: {
              title: null,
              x_axis_label: 'x',
              y_axis_label: 'y',
              show_grid: true,
              show_x_axis: true,
              show_y_axis: true,
            },
            placement: { mode: 'viewport_default' },
          },
        ],
      }),
      ctx(),
    );
    const result = executeCanvasOperations(plan, createLiveAgentExecutorTarget());
    const graph = useCanvasStore
      .getState()
      .document.elements.find((e) => e.id === result.createdIds[0]) as GraphElement;
    expect(graph.expressions[0]?.sourceText).toBe('x**2');
    expect(graph.settings.xAxisLabel).toBe('x');
    expect(graph.association).toBeUndefined();
  });
});
