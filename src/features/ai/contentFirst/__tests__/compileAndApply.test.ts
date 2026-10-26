/**
 * Content-first compile → execute → canvas element checks.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createEmptyDocument,
  DEFAULT_STYLE,
} from '../../../../types/canvas';
import { useCanvasStore } from '../../../../store/canvasStore';
import { ragSync } from '../../../rag/ragSync';
import { parseContentDocument } from '../contentParser';
import { compileContentDocument } from '../compileContentDocument';
import {
  handleContentFirstResponse,
  previewContentFirstPlan,
} from '../applyContentFirst';
import { setAiGenerationModeOverride } from '../generationMode';
import { parseAgentResponsePlan } from '../../llm/handleLlmResponse';
import { executeCanvasOperations } from '../../agent/executor';
import { createLiveAgentExecutorTarget } from '../../agent/liveExecutor';
import { parseCanvasAgentResponse } from '../../agent/parser';

function reset() {
  useCanvasStore.setState({
    document: createEmptyDocument(),
    style: { ...DEFAULT_STYLE },
    selectedIds: [],
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

const emptyCtx = { allowedElementIds: new Set<string>() };

describe('content-first compile + apply', () => {
  beforeEach(() => {
    vi.spyOn(ragSync, 'indexText').mockImplementation(() => {});
    vi.spyOn(ragSync, 'updateGeometry').mockImplementation(() => {});
    vi.spyOn(ragSync, 'scheduleReconcile').mockImplementation(() => {});
    reset();
    setAiGenerationModeOverride('content_first');
  });
  afterEach(() => {
    setAiGenerationModeOverride(null);
    vi.restoreAllMocks();
  });

  it('A — text-only explanation → TextElements only', () => {
    const raw = `# Waves

Sound travels through air.

The speed depends on $T$.
`;
    const result = handleContentFirstResponse(raw, emptyCtx);
    const els = useCanvasStore.getState().document.elements;
    expect(els.every((e) => e.type === 'text')).toBe(true);
    expect(els.some((e) => e.type === 'equation')).toBe(false);
    expect(result.response.operations.every((o) => o.type === 'create_text')).toBe(
      true,
    );
  });

  it('B — alternating prose and display equations preserve order', () => {
    const raw = `Intro.

$$
F=-kx
$$

Middle.

$$
m\\ddot{x}=-kx
$$

End.
`;
    handleContentFirstResponse(raw, emptyCtx);
    const els = useCanvasStore.getState().document.elements;
    const types = els
      .slice()
      .sort((a, b) => a.y - b.y || a.zIndex - b.zIndex)
      .map((e) => e.type);
    expect(types.filter((t) => t === 'equation')).toHaveLength(2);
    expect(types.filter((t) => t === 'text').length).toBeGreaterThanOrEqual(3);
    // Equations sit between texts in y-order
    const firstEq = types.indexOf('equation');
    const lastEq = types.lastIndexOf('equation');
    expect(firstEq).toBeGreaterThan(0);
    expect(lastEq).toBeGreaterThan(firstEq);
  });

  it('C — multiline aligned → one EquationElement', () => {
    const raw = `$$
\\begin{aligned}
F &= -kx \\\\
m\\ddot{x} &= -kx \\\\
\\ddot{x}+\\omega^2 x &= 0
\\end{aligned}
$$
`;
    handleContentFirstResponse(raw, emptyCtx);
    const eqs = useCanvasStore
      .getState()
      .document.elements.filter((e) => e.type === 'equation');
    expect(eqs).toHaveLength(1);
    if (eqs[0]?.type === 'equation') {
      expect(eqs[0].latex).toContain('aligned');
    }
  });

  it('D — paragraph → graph → paragraph', () => {
    const raw = `Before the plot.

:::graph
expression: cos(x)
:::

After the plot.
`;
    handleContentFirstResponse(raw, emptyCtx);
    const ordered = useCanvasStore
      .getState()
      .document.elements.slice()
      .sort((a, b) => a.y - b.y);
    expect(ordered.map((e) => e.type)).toEqual(['text', 'graph', 'text']);
  });

  it('E — one graph marker with three expressions → one GraphElement', () => {
    const raw = `:::graph
expression: cos(x)
expression: -sin(x)
expression: -cos(x)
:::
`;
    handleContentFirstResponse(raw, emptyCtx);
    const graphs = useCanvasStore
      .getState()
      .document.elements.filter((e) => e.type === 'graph');
    expect(graphs).toHaveLength(1);
    if (graphs[0]?.type === 'graph') {
      expect(graphs[0].expressions).toHaveLength(3);
    }
  });

  it('F — optional components get textbook component types', () => {
    const raw = `:::definition
Angular frequency $\\omega$.
:::

:::warning
Assumes no damping.
:::

:::exercise
Find $T$.
:::
`;
    handleContentFirstResponse(raw, emptyCtx);
    const texts = useCanvasStore
      .getState()
      .document.elements.filter((e) => e.type === 'text');
    const types = texts.map((e) =>
      e.type === 'text' ? e.componentType : null,
    );
    expect(types).toContain('definition');
    expect(types).toContain('warning');
    expect(types).toContain('exercise');
  });

  it('G — multiple sections associate equations to heading text', () => {
    const raw = `## Restoring Force

Hooke's law:

$$
F=-kx
$$

## Displacement

Solution:

$$
x(t)=A\\cos(\\omega t)
$$
`;
    const result = handleContentFirstResponse(raw, emptyCtx);
    expect(result.compile.associationPlan.length).toBeGreaterThan(0);
    const els = useCanvasStore.getState().document.elements;
    const eqs = els.filter((e) => e.type === 'equation');
    expect(eqs).toHaveLength(2);
    for (const eq of eqs) {
      if (eq.type !== 'equation') continue;
      expect(eq.association?.associatedElementId).toBeTruthy();
      const parent = els.find((e) => e.id === eq.association?.associatedElementId);
      expect(parent?.type).toBe('text');
    }
  });

  it('H — save/reload persists latex and associations', () => {
    handleContentFirstResponse(
      `## Sec

$$
E=mc^2
$$
`,
      emptyCtx,
    );
    const before = structuredClone(useCanvasStore.getState().document);
    useCanvasStore.setState({
      document: createEmptyDocument(),
    });
    useCanvasStore.setState({ document: before });
    const eqs = useCanvasStore
      .getState()
      .document.elements.filter((e) => e.type === 'equation');
    expect(eqs).toHaveLength(1);
    if (eqs[0]?.type === 'equation') {
      expect(eqs[0].latex).toContain('E=mc');
      expect(eqs[0].association?.associatedElementId).toBeTruthy();
    }
  });

  it('I — undo removes the generated lesson as one history step', () => {
    // Push history before apply (same as UI withHistory)
    useCanvasStore.getState().pushHistory();
    handleContentFirstResponse(
      `# Title

$$
a=b
$$
`,
      emptyCtx,
    );
    expect(useCanvasStore.getState().document.elements.length).toBeGreaterThan(0);
    useCanvasStore.getState().undo();
    expect(useCanvasStore.getState().document.elements).toHaveLength(0);
    useCanvasStore.getState().redo();
    expect(useCanvasStore.getState().document.elements.length).toBeGreaterThan(0);
  });

  it('J — operations JSON mode still works when mode is operations', () => {
    setAiGenerationModeOverride('operations');
    const plan = parseAgentResponsePlan(
      JSON.stringify({
        operations: [
          {
            type: 'create_text',
            text: 'Legacy ops path',
            placement: { mode: 'viewport_default' },
          },
        ],
      }),
      emptyCtx,
    );
    expect(plan.response.operations[0]?.type).toBe('create_text');
    executeCanvasOperations(plan.response, createLiveAgentExecutorTarget());
    expect(
      useCanvasStore.getState().document.elements.some((e) => e.type === 'text'),
    ).toBe(true);
  });

  it('preview compiles without mutating the canvas', () => {
    const preview = previewContentFirstPlan(
      `# Only preview

$$
1+1=2
$$
`,
      emptyCtx,
    );
    expect(preview.response.operations.length).toBeGreaterThan(0);
    expect(useCanvasStore.getState().document.elements).toHaveLength(0);
  });

  it('compiler output validates through the agent parser', () => {
    const doc = parseContentDocument(`# A

$$
F=-kx
$$

:::graph
expression: sin(x)
:::
`);
    const { response } = compileContentDocument(doc);
    const parsed = parseCanvasAgentResponse(JSON.stringify(response), emptyCtx);
    expect(parsed.operations).toHaveLength(3);
  });
});
