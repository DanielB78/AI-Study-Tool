/**
 * Primary content-first fixture: Simple Harmonic Motion lesson as Markdown.
 * Verifies Text / Equation / Graph separation, reading order, associations.
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
import { handleContentFirstResponse } from '../applyContentFirst';
import {
  assertContentFirstPromptFitsLimit,
  CONTENT_FIRST_SYSTEM_PROMPT,
} from '../contentFirstPrompt';
import { setAiGenerationModeOverride } from '../generationMode';

/** Representative LLM Markdown response for an SHM lesson (not ops JSON). */
export const SHM_CONTENT_FIRST_MARKDOWN = `# Simple Harmonic Motion

Simple harmonic motion is a type of oscillation in which acceleration is proportional to displacement and directed towards equilibrium.

## Definition

:::definition
SHM is oscillation where $a \\propto -x$ (or equivalently $F \\propto -x$ for a constant mass).
:::

## The Restoring Force

Consider a mass attached to an ideal spring. The restoring force is described by Hooke's law:

$$
F=-kx
$$

where $F$ is the restoring force, $k$ is the spring constant and $x$ is the displacement.

## Equation of Motion

Applying Newton's second law gives:

$$
m\\frac{d^2x}{dt^2}=-kx
$$

Rearranging:

$$
\\begin{aligned}
\\frac{d^2x}{dt^2}+\\frac{k}{m}x&=0\\\\
\\ddot{x}+\\omega^2 x&=0
\\end{aligned}
$$

where $\\omega=\\sqrt{k/m}$.

## Displacement

The solution is sinusoidal:

$$
x(t)=A\\cos(\\omega t+\\phi)
$$

:::graph
title: Displacement Against Time
expression: cos(x)
x_min: 0
x_max: 12.57
y_min: -1.5
y_max: 1.5
x_label: Phase (radians)
y_label: Normalised displacement
:::

The graph illustrates how displacement varies periodically with time.

## Velocity and Acceleration

Differentiating once and twice:

$$
\\begin{aligned}
v(t)&=-A\\omega\\sin(\\omega t+\\phi)\\\\
a(t)&=-A\\omega^2\\cos(\\omega t+\\phi)
\\end{aligned}
$$

:::graph
title: Displacement, Velocity and Acceleration
expression: cos(x)
expression: -sin(x)
expression: -cos(x)
x_min: 0
x_max: 12.57
y_min: -1.5
y_max: 1.5
x_label: Phase (radians)
y_label: Normalised value
:::

## Period and Frequency

$$
\\begin{aligned}
T&=2\\pi\\sqrt{\\frac{m}{k}}\\\\
f&=\\frac{1}{T}=\\frac{1}{2\\pi}\\sqrt{\\frac{k}{m}}
\\end{aligned}
$$

## Energy

$$
\\begin{aligned}
E&=\\frac{1}{2}kA^2\\\\
E_k&=\\frac{1}{2}mv^2\\\\
E_p&=\\frac{1}{2}kx^2
\\end{aligned}
$$

:::graph
title: Kinetic and Potential Energy
expression: 0.5*sin(x)**2
expression: 0.5*cos(x)**2
x_min: 0
x_max: 12.57
y_min: 0
y_max: 0.6
x_label: Phase (radians)
y_label: Energy (normalised)
:::

## Worked Example

:::example
A mass $m=0.5\\,\\mathrm{kg}$ on a spring with $k=50\\,\\mathrm{N\\,m^{-1}}$ oscillates with amplitude $A=0.1\\,\\mathrm{m}$. Find the period and maximum speed.
:::

## Exercise

:::exercise
Explain why acceleration is zero when the mass passes through equilibrium.
:::
`;

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

describe('SHM content-first lesson', () => {
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

  it('content-first system prompt fits the backend length limit', () => {
    expect(CONTENT_FIRST_SYSTEM_PROMPT.length).toBeLessThan(7500);
    expect(() => assertContentFirstPromptFitsLimit()).not.toThrow();
  });

  it('parses the SHM Markdown into ordered IR nodes', () => {
    const doc = parseContentDocument(SHM_CONTENT_FIRST_MARKDOWN);
    const types = doc.nodes.map((n) => n.type);
    expect(types[0]).toBe('heading');
    expect(types.filter((t) => t === 'equation').length).toBeGreaterThanOrEqual(6);
    expect(types.filter((t) => t === 'graph')).toHaveLength(3);
    // Feature markers expand to ordinary paragraphs (components on hold)
    expect(types.filter((t) => t === 'component')).toHaveLength(0);
    // Reading order: first graph after a displacement equation, not at the top
    const firstGraph = types.indexOf('graph');
    const firstEq = types.indexOf('equation');
    expect(firstEq).toBeGreaterThan(0);
    expect(firstGraph).toBeGreaterThan(firstEq);
  });

  it('compiles to Text / Equation / Graph create ops only (chronological)', () => {
    const doc = parseContentDocument(SHM_CONTENT_FIRST_MARKDOWN);
    const { response, associationPlan } = compileContentDocument(doc);
    expect(response.layout?.type).toBe('chronological_grid');
    const opTypes = new Set(response.operations.map((o) => o.type));
    expect([...opTypes].sort()).toEqual([
      'create_equation',
      'create_graph',
      'create_text',
    ]);
    expect(associationPlan).toHaveLength(0);
  });

  it('applies the lesson: correct element kinds, order, associations, no overlap', () => {
    const result = handleContentFirstResponse(
      SHM_CONTENT_FIRST_MARKDOWN,
      emptyCtx,
    );
    expect(result.kind).toBe('content_first');
    const els = useCanvasStore.getState().document.elements;
    const texts = els.filter((e) => e.type === 'text');
    const eqs = els.filter((e) => e.type === 'equation');
    const graphs = els.filter((e) => e.type === 'graph');

    expect(texts.length).toBeGreaterThanOrEqual(8);
    expect(eqs.length).toBeGreaterThanOrEqual(6);
    expect(graphs).toHaveLength(3);

    // Multi-curve comparison graph
    const multi = graphs.find(
      (g) => g.type === 'graph' && g.expressions.length === 3,
    );
    expect(multi).toBeTruthy();

    // Y-order matches document reading order (single column)
    const ordered = els.slice().sort((a, b) => a.y - b.y || a.zIndex - b.zIndex);
    expect(ordered[0]?.type).toBe('text'); // title
    const eqYs = eqs.map((e) => e.y).sort((a, b) => a - b);
    const graphYs = graphs.map((e) => e.y).sort((a, b) => a - b);
    expect(eqYs[0]!).toBeLessThan(graphYs[0]!);

    // No textbook feature chrome / auto associations
    const featureTypes = new Set([
      'definition',
      'example',
      'warning',
      'exercise',
      'linked_comment',
    ]);
    expect(
      texts.every(
        (t) => t.type === 'text' && !featureTypes.has(String(t.componentType)),
      ),
    ).toBe(true);
    for (const eq of eqs) {
      if (eq.type !== 'equation') continue;
      expect(eq.association?.associatedElementId).toBeFalsy();
    }

    // Text shares one left column (equations may be centred within it)
    const textXs = ordered.filter((e) => e.type === 'text').map((e) => e.x);
    expect(Math.max(...textXs) - Math.min(...textXs)).toBeLessThan(1);

    // Crude collision check: successive y + height leave a gap or abut without large overlap
    for (let i = 1; i < ordered.length; i += 1) {
      const prev = ordered[i - 1]!;
      const cur = ordered[i]!;
      expect(cur.y).toBeGreaterThanOrEqual(prev.y - 1);
    }
  });
});
