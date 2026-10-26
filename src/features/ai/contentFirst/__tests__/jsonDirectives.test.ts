/**
 * Tests A–K (scoped) for :::json edit / add_text in content-first mode.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createEmptyDocument,
  DEFAULT_STYLE,
  type EquationElement,
  type GraphElement,
  type TextElement,
} from '../../../../types/canvas';
import { useCanvasStore } from '../../../../store/canvasStore';
import { ragSync } from '../../../rag/ragSync';
import { createGraphElement, createEmptyGraphExpression } from '../../../graphs/createGraphElement';
import { createAiEquationElement } from '../../canvas/createAiEquationElement';
import { createAiTextElement } from '../../canvas/createAiTextElement';
import {
  handleContentFirstResponse,
  previewContentFirstPlan,
} from '../applyContentFirst';
import { splitContentFirstEnvelope } from '../jsonDirective';
import { looksLikeContentMarkdown, looksLikeOperationsJson } from '../contentParser';
import { ContentParseError } from '../types';
import { setAiGenerationModeOverride } from '../generationMode';
import {
  CONTENT_FIRST_SYSTEM_PROMPT,
  assertContentFirstPromptFitsLimit,
} from '../contentFirstPrompt';

function seedText(id = 'text_12', text = 'Original restoring-force prose.'): TextElement {
  const el = createAiTextElement(text, { x: 40, y: 40 }, {
    zIndex: 1,
    style: DEFAULT_STYLE,
  });
  return { ...el, id };
}

function seedEquation(id = 'equation_5', latex = 'F=-kx'): EquationElement {
  const el = createAiEquationElement(latex, { x: 40, y: 200 }, {
    zIndex: 2,
    style: DEFAULT_STYLE,
  });
  return { ...el, id };
}

function seedGraph(id = 'graph_9'): GraphElement {
  const g = createGraphElement({ x: 40, y: 400, zIndex: 3 });
  const e1 = { ...createEmptyGraphExpression(0, 'sin(x)'), id: 'expr_1' };
  return {
    ...g,
    id,
    expressions: [e1],
    settings: {
      ...g.settings,
      title: 'Old Title',
      xAxisLabel: 'x',
      yAxisLabel: 'y',
    },
  };
}

function reset(elements: Array<TextElement | EquationElement | GraphElement>) {
  useCanvasStore.setState({
    document: { ...createEmptyDocument(), elements },
    style: { ...DEFAULT_STYLE },
    selectedIds: elements.map((e) => e.id),
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

function ctxFor(
  elements: Array<{ id: string; type: string; expressions?: Array<{ id: string }> }>,
) {
  const allowedElementIds = new Set(elements.map((e) => e.id));
  const elementTypes = new Map(elements.map((e) => [e.id, e.type]));
  const graphExpressionIds = new Map<string, Set<string>>();
  for (const e of elements) {
    if (e.type === 'graph' && e.expressions) {
      graphExpressionIds.set(e.id, new Set(e.expressions.map((x) => x.id)));
    }
  }
  return { allowedElementIds, elementTypes, graphExpressionIds };
}

describe(':::json directives', () => {
  beforeEach(() => {
    vi.spyOn(ragSync, 'indexText').mockImplementation(() => {});
    vi.spyOn(ragSync, 'updateGeometry').mockImplementation(() => {});
    vi.spyOn(ragSync, 'scheduleReconcile').mockImplementation(() => {});
    setAiGenerationModeOverride('content_first');
  });
  afterEach(() => {
    setAiGenerationModeOverride(null);
    vi.restoreAllMocks();
  });

  it('prompt fits backend limit and documents :::json', () => {
    assertContentFirstPromptFitsLimit();
    expect(CONTENT_FIRST_SYSTEM_PROMPT).toContain(':::json');
    expect(CONTENT_FIRST_SYSTEM_PROMPT).toContain('"action":"edit"');
    expect(CONTENT_FIRST_SYSTEM_PROMPT).toContain('"action":"add_text"');
    expect(CONTENT_FIRST_SYSTEM_PROMPT.length).toBeLessThan(7500);
  });

  it('A — ordinary Markdown generation still works without JSON', () => {
    reset([]);
    const raw = `# Lesson

Prose with $\\omega$.

$$
F=-kx
$$

:::graph
expression: cos(x)
title: Wave
:::
`;
    const result = handleContentFirstResponse(raw, {
      allowedElementIds: new Set(),
    });
    const els = useCanvasStore.getState().document.elements;
    expect(els.some((e) => e.type === 'text')).toBe(true);
    expect(els.some((e) => e.type === 'equation')).toBe(true);
    expect(els.some((e) => e.type === 'graph')).toBe(true);
    expect(result.envelope.segments).toHaveLength(0);
    expect(result.response.operations.every((o) => o.type.startsWith('create_'))).toBe(
      true,
    );
  });

  it('B — edit TextElement preserves id and replaces content', () => {
    const text = seedText();
    reset([text]);
    const beforeCount = useCanvasStore.getState().document.elements.length;
    const raw = `:::json
{"action":"edit","target_id":"text_12"}
:::

## The Restoring Force

A mass attached to a spring experiences $F=-kx$.
`;
    handleContentFirstResponse(raw, ctxFor([text]));
    const els = useCanvasStore.getState().document.elements;
    expect(els).toHaveLength(beforeCount);
    const updated = els.find((e) => e.id === 'text_12');
    expect(updated?.type).toBe('text');
    if (updated?.type === 'text') {
      expect(updated.text).toContain('Restoring Force');
      expect(updated.text).toContain('F=-kx');
      expect(updated.id).toBe('text_12');
    }
  });

  it('C — edit EquationElement including multiline LaTeX', () => {
    const eq = seedEquation();
    reset([eq]);
    const raw = `:::json
{"action":"edit","target_id":"equation_5"}
:::

$$
\\begin{aligned}
F &= -kx \\\\
m\\ddot{x} &= -kx
\\end{aligned}
$$
`;
    handleContentFirstResponse(raw, ctxFor([eq]));
    const updated = useCanvasStore
      .getState()
      .document.elements.find((e) => e.id === 'equation_5');
    expect(updated?.type).toBe('equation');
    if (updated?.type === 'equation') {
      expect(updated.latex).toContain('aligned');
      expect(updated.latex).toContain('F');
      expect(updated.id).toBe('equation_5');
    }
  });

  it('D — edit GraphElement replaces expressions; keeps omitted settings', () => {
    const graph = seedGraph();
    reset([graph]);
    const raw = `:::json
{"action":"edit","target_id":"graph_9"}
:::

:::graph
expression: cos(x)
expression: -sin(x)
title: Displacement and Velocity
x_label: Phase
:::
`;
    handleContentFirstResponse(raw, ctxFor([graph]));
    const updated = useCanvasStore
      .getState()
      .document.elements.find((e) => e.id === 'graph_9');
    expect(updated?.type).toBe('graph');
    if (updated?.type === 'graph') {
      expect(updated.id).toBe('graph_9');
      expect(updated.expressions.map((e) => e.sourceText)).toEqual([
        'cos(x)',
        '-sin(x)',
      ]);
      expect(updated.settings.title).toBe('Displacement and Velocity');
      expect(updated.settings.xAxisLabel).toBe('Phase');
      // y_label omitted → retain existing
      expect(updated.settings.yAxisLabel).toBe('y');
      expect(updated.x).toBe(graph.x);
      expect(updated.y).toBe(graph.y);
      expect(updated.width).toBe(graph.width);
    }
  });

  it('E — add_text above a GraphElement', () => {
    const graph = seedGraph();
    reset([graph]);
    const raw = `:::json
{"action":"add_text","target_id":"graph_9","position":"above"}
:::

The following graph compares displacement and velocity.
`;
    handleContentFirstResponse(raw, ctxFor([graph]));
    const els = useCanvasStore.getState().document.elements;
    const newText = els.find((e) => e.type === 'text');
    const g = els.find((e) => e.id === 'graph_9');
    expect(newText).toBeTruthy();
    expect(g).toBeTruthy();
    if (newText && g) {
      expect(newText.y + newText.height).toBeLessThanOrEqual(g.y);
      expect(newText.text).toContain('compares displacement');
    }
  });

  it('F — add_text below an EquationElement', () => {
    const eq = seedEquation();
    reset([eq]);
    const raw = `:::json
{"action":"add_text","target_id":"equation_5","position":"below"}
:::

The negative sign indicates restoring acceleration.
`;
    handleContentFirstResponse(raw, ctxFor([eq]));
    const els = useCanvasStore.getState().document.elements;
    const newText = els.find((e) => e.type === 'text');
    const equation = els.find((e) => e.id === 'equation_5');
    expect(newText).toBeTruthy();
    if (newText && equation) {
      expect(newText.y).toBeGreaterThanOrEqual(equation.y + equation.height);
    }
  });

  it('G — add_text above and below a TextElement', () => {
    const text = seedText();
    reset([text]);
    const raw = `:::json
{"action":"add_text","target_id":"text_12","position":"above"}
:::

Intro above.

:::json
{"action":"add_text","target_id":"text_12","position":"below"}
:::

Consequence below.
`;
    handleContentFirstResponse(raw, ctxFor([text]));
    const texts = useCanvasStore
      .getState()
      .document.elements.filter((e) => e.type === 'text');
    expect(texts).toHaveLength(3);
    const original = texts.find((e) => e.id === 'text_12')!;
    const above = texts.find((e) => e.text.includes('Intro above'))!;
    const below = texts.find((e) => e.text.includes('Consequence below'))!;
    expect(above.y + above.height).toBeLessThanOrEqual(original.y);
    expect(below.y).toBeGreaterThanOrEqual(original.y + original.height);
  });

  it('H — multiple instructions pair bodies correctly', () => {
    const text = seedText();
    const eq = seedEquation();
    const graph = seedGraph();
    reset([text, eq, graph]);
    const raw = `:::json
{"action":"edit","target_id":"text_12"}
:::

Updated spring prose.

:::json
{"action":"edit","target_id":"equation_5"}
:::

$$
F=-kx
$$

:::json
{"action":"add_text","target_id":"graph_9","position":"below"}
:::

Periodic displacement caption.
`;
    const preview = previewContentFirstPlan(
      raw,
      ctxFor([text, eq, graph]),
    );
    expect(preview.envelope.segments).toHaveLength(3);
    expect(preview.envelope.segments[0]!.markdown).toContain('Updated spring');
    expect(preview.envelope.segments[1]!.markdown).toContain('F=-kx');
    expect(preview.envelope.segments[2]!.markdown).toContain('Periodic');
    handleContentFirstResponse(raw, ctxFor([text, eq, graph]));
    const els = useCanvasStore.getState().document.elements;
    expect(els.find((e) => e.id === 'text_12')?.type).toBe('text');
    expect(
      els.some((e) => e.type === 'text' && e.text.includes('Periodic')),
    ).toBe(true);
  });

  it('I — marker collisions: graph vs json; json inside code fence ignored', () => {
    const env = splitContentFirstEnvelope(`# Title

\`\`\`
:::json
{"action":"edit","target_id":"nope"}
:::
\`\`\`

:::graph
expression: cos(x)
:::
`);
    expect(env.segments).toHaveLength(0);
    expect(env.preamble).toContain(':::json');
    expect(env.preamble).toContain(':::graph');

    expect(looksLikeContentMarkdown(':::json\n{"action":"edit","target_id":"t"}\n:::')).toBe(
      true,
    );
    expect(looksLikeOperationsJson(':::json\n{"action":"edit","target_id":"t"}\n:::')).toBe(
      false,
    );

    const graph = seedGraph();
    reset([graph]);
    const withGraphEdit = `:::json
{"action":"edit","target_id":"graph_9"}
:::

:::graph
expression: cos(x)
title: Only Graph
:::
`;
    const split = splitContentFirstEnvelope(withGraphEdit);
    expect(split.segments).toHaveLength(1);
    expect(split.segments[0]!.markdown).toContain(':::graph');
    expect(split.segments[0]!.markdown).toContain('expression: cos(x)');
  });

  it('J — invalid targets and content are rejected without mutation', () => {
    const text = seedText();
    const eq = seedEquation();
    reset([text, eq]);
    const snapshot = structuredClone(useCanvasStore.getState().document.elements);
    const baseCtx = ctxFor([text, eq]);

    const cases: Array<{ raw: string; code?: string }> = [
      {
        raw: `:::json
{"action":"edit","target_id":"missing_99"}
:::

Hello
`,
        code: 'missing_target',
      },
      {
        raw: `:::json
{"action":"edit","target_id":"equation_5"}
:::

Not an equation body.
`,
        code: 'invalid_instruction',
      },
      {
        raw: `:::json
{not json}
:::

Body
`,
        code: 'invalid_json',
      },
      {
        raw: `:::json
{"action":"delete","target_id":"text_12"}
:::

Body
`,
        code: 'unsupported_action',
      },
      {
        raw: `:::json
{"action":"edit","target_id":"equation_5"}
:::

$$
\\\\bad{{{{
$$
`,
        code: 'invalid_latex',
      },
      {
        raw: `:::json
{"action":"edit","target_id":"text_12"}
:::

`,
        code: 'empty_body',
      },
      {
        raw: `:::json
{"action":"add_text","target_id":"text_12"}
:::

Missing position
`,
        code: 'invalid_instruction',
      },
      {
        raw: `:::json
{"action":"edit","target_id":"text_12"}
:::

Hello

:::json
{"action":"edit","target_id":"missing_1"}
:::

World
`,
        code: 'missing_target',
      },
    ];

    for (const c of cases) {
      expect(() => handleContentFirstResponse(c.raw, baseCtx)).toThrow(
        ContentParseError,
      );
      try {
        handleContentFirstResponse(c.raw, baseCtx);
      } catch (err) {
        if (err instanceof ContentParseError && c.code) {
          expect(err.code).toBe(c.code);
        }
      }
      expect(useCanvasStore.getState().document.elements).toEqual(snapshot);
    }

    // Wrong target type: edit text id with graph body → wrong_target / invalid
    expect(() =>
      handleContentFirstResponse(
        `:::json
{"action":"edit","target_id":"text_12"}
:::

:::graph
expression: cos(x)
:::
`,
        baseCtx,
      ),
    ).toThrow(ContentParseError);
  });

  it('K — multiple instructions form one undoable transaction', () => {
    const text = seedText();
    const eq = seedEquation();
    reset([text, eq]);
    const raw = `:::json
{"action":"edit","target_id":"text_12"}
:::

Edited once.

:::json
{"action":"add_text","target_id":"equation_5","position":"below"}
:::

Caption under equation.
`;
    handleContentFirstResponse(raw, ctxFor([text, eq]));
    expect(useCanvasStore.getState().document.elements.length).toBe(3);

    useCanvasStore.getState().undo();
    const undone = useCanvasStore.getState().document.elements;
    expect(undone).toHaveLength(2);
    expect(undone.find((e) => e.id === 'text_12')).toMatchObject({
      type: 'text',
      text: 'Original restoring-force prose.',
    });
  });

  it('preamble Markdown before first :::json still generates', () => {
    const text = seedText();
    reset([text]);
    const raw = `# New Section

Fresh intro paragraph.

:::json
{"action":"edit","target_id":"text_12"}
:::

Replaced selected text.
`;
    handleContentFirstResponse(raw, ctxFor([text]));
    const els = useCanvasStore.getState().document.elements;
    expect(els.some((e) => e.type === 'text' && e.text.includes('Fresh intro'))).toBe(
      true,
    );
    expect(
      els.find((e) => e.id === 'text_12')?.type === 'text' &&
        (els.find((e) => e.id === 'text_12') as TextElement).text.includes(
          'Replaced selected',
        ),
    ).toBe(true);
  });
});
