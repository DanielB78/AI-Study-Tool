import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleContentFirstResponse } from '../../ai/contentFirst/applyContentFirst';
import type { ParseContext } from '../../ai/agent/parser';
import { useCanvasStore } from '../../../store/canvasStore';
import { createEmptyDocument, DEFAULT_STYLE } from '../../../types/canvas';
import { ragSync } from '../../rag/ragSync';
import { setAiGenerationModeOverride } from '../../ai/contentFirst/generationMode';
import { useStructureStore } from '../structureStore';
import {
  compileStructureMarkdown,
  structureInstancesToAgentResponse,
} from '../compileStructureInstances';
import { createPhysicsConceptTemplate, createStructureField } from '../factory';
import { createEmptyStructure } from '../factory';
import { instantiateNoteStructure } from '../instantiation';
import { parseCanvasAgentResponse } from '../../ai/agent/parser';
import {
  packCellsChronologically,
} from '../../ai/agent/layout/chronologicalFlowPacker';
import { DEFAULT_USER_LAYOUT_SETTINGS } from '../../ai/agent/layout/userLayoutSettings';
import { computeStructuredNoteBounds } from '../instantiation';
import type { StructureFieldValue } from '../fieldValues';

const PHYSICS_MD = `\`\`\`markdown
:::structure Physics Concept Template

:::Describe the concept in one sentence.
Simple harmonic motion is periodic motion caused by a restoring force.
:::

:::Give the governing equation.
$$
F=-kx
$$
:::

:::Explain the physical meaning.
The force points towards equilibrium.
:::

:::Show the displacement graph.
:::graph
expression: cos(x)
title: Displacement
:::
:::

:::endstructure

:::structure Physics Concept Template

:::Describe the concept in one sentence.
Uniform circular motion is motion at constant speed around a circular path.
:::

:::Give the governing equation.
$$
a_c=\\frac{v^2}{r}
$$
:::

:::Explain the physical meaning.
The acceleration is directed towards the centre of the circle.
:::

:::endstructure
\`\`\``;

function ctxFor(template: ReturnType<typeof createPhysicsConceptTemplate>): ParseContext {
  return {
    allowedElementIds: new Set(),
    selectedStructure: template,
  };
}

describe('visual structure compile + instantiate', () => {
  beforeEach(() => {
    vi.spyOn(ragSync, 'indexText').mockImplementation(() => {});
    vi.spyOn(ragSync, 'updateGeometry').mockImplementation(() => {});
    vi.spyOn(ragSync, 'scheduleReconcile').mockImplementation(() => {});
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
    setAiGenerationModeOverride('content_first');
  });

  it('compiles two physics instances with text, equation, and graph slots', () => {
    const template = createPhysicsConceptTemplate();
    const compiled = compileStructureMarkdown(PHYSICS_MD, template);
    expect(compiled.operations).toHaveLength(2);
    expect(compiled.operations[0]!.type).toBe('create_structured_note');
    expect(compiled.operations[0]!.fields.governing_equation).toMatchObject({
      latex: expect.stringContaining('F=-kx'),
    });
    expect(compiled.operations[0]!.fields.displacement_graph).toMatchObject({
      expressions: ['cos(x)'],
    });
    // Second instance omitted optional graph
    expect(compiled.operations[1]!.fields.displacement_graph).toBeNull();
  });

  it('preserves template fonts/colours and relative geometry on instantiate', () => {
    const template = createPhysicsConceptTemplate();
    const compiled = compileStructureMarkdown(PHYSICS_MD, template);
    const op = compiled.operations[0]!;
    const fieldValues = new Map<string, StructureFieldValue>();
    for (const [id, payload] of Object.entries(op.fields)) {
      if (!payload) continue;
      if ('content' in payload) {
        fieldValues.set(id, {
          kind: 'text',
          content: payload.content,
          richText: payload.rich_text,
        });
      } else if ('latex' in payload) {
        fieldValues.set(id, { kind: 'equation', latex: payload.latex });
      } else if ('expressions' in payload) {
        fieldValues.set(id, {
          kind: 'graph',
          title: payload.title ?? null,
          expressions: payload.expressions,
          xMin: payload.x_min ?? null,
          xMax: payload.x_max ?? null,
          yMin: payload.y_min ?? null,
          yMax: payload.y_max ?? null,
          xLabel: payload.x_label ?? null,
          yLabel: payload.y_label ?? null,
        });
      }
    }

    const result = instantiateNoteStructure({
      structure: template,
      fieldValues,
      origin: { x: 100, y: 200 },
      style: DEFAULT_STYLE,
      nextZIndex: (() => {
        let z = 1;
        return () => z++;
      })(),
    });

    expect(result.elements.length).toBeGreaterThanOrEqual(4);
    const title = result.elements.find(
      (e) => e.metadata?.structureFieldId === 'concept_sentence',
    );
    expect(title?.type).toBe('text');
    if (title?.type === 'text') {
      expect(title.fontWeight).toBe('bold');
      expect(title.fontSize).toBe(20);
      expect(title.x).toBe(100 + 16);
      expect(title.y).toBe(200 + 16);
      expect(title.backgroundColor).toBe('#f1f5f9');
    }
    const eq = result.elements.find(
      (e) => e.metadata?.structureFieldId === 'governing_equation',
    );
    expect(eq?.type).toBe('equation');
    const graph = result.elements.find(
      (e) => e.metadata?.structureFieldId === 'displacement_graph',
    );
    expect(graph?.type).toBe('graph');
    // All share instance id
    const instanceId = result.structureInstanceId;
    for (const el of result.elements) {
      expect(el.metadata?.structureInstanceId).toBe(instanceId);
    }
  });

  it('grows tall text and pushes lower slots down without overlap', () => {
    const structure = createEmptyStructure('Grow Test');
    structure.width = 400;
    structure.height = 300;
    structure.fields = [
      createStructureField({
        id: 'top',
        label: 'Top',
        instruction: 'Top slot',
        contentType: 'text',
        relativeX: 0,
        relativeY: 0,
        relativeWidth: 400,
        relativeHeight: 40,
        readingOrder: 0,
      }),
      createStructureField({
        id: 'bottom',
        label: 'Bottom',
        instruction: 'Bottom slot',
        contentType: 'text',
        relativeX: 0,
        relativeY: 60,
        relativeWidth: 400,
        relativeHeight: 40,
        readingOrder: 1,
      }),
    ];
    const long =
      'Line one of a long explanation. '.repeat(40) +
      'This should force the top slot taller than 40px.';
    const fieldValues = new Map<string, StructureFieldValue>([
      ['top', { kind: 'text', content: long }],
      ['bottom', { kind: 'text', content: 'Short bottom.' }],
    ]);
    const result = instantiateNoteStructure({
      structure,
      fieldValues,
      origin: { x: 0, y: 0 },
      style: DEFAULT_STYLE,
      nextZIndex: (() => {
        let z = 1;
        return () => z++;
      })(),
    });
    const top = result.elements.find((e) => e.metadata?.structureFieldId === 'top')!;
    const bottom = result.elements.find(
      (e) => e.metadata?.structureFieldId === 'bottom',
    )!;
    expect(top.height).toBeGreaterThan(40);
    expect(bottom.y).toBeGreaterThanOrEqual(top.y + top.height);
  });

  it('copies decorative elements without LLM content', () => {
    const structure = createEmptyStructure('Decor');
    structure.fields = [
      createStructureField({
        id: 'badge',
        label: 'Badge',
        instruction: '',
        generative: false,
        staticContent: 'PHYSICS',
        contentType: 'text',
        relativeX: 0,
        relativeY: 0,
        relativeWidth: 120,
        relativeHeight: 32,
      }),
      createStructureField({
        id: 'body',
        label: 'Body',
        instruction: 'Explain the idea.',
        contentType: 'text',
        relativeX: 0,
        relativeY: 48,
        relativeWidth: 300,
        relativeHeight: 80,
      }),
    ];
    const fieldValues = new Map<string, StructureFieldValue>([
      ['body', { kind: 'text', content: 'Hello world.' }],
    ]);
    const result = instantiateNoteStructure({
      structure,
      fieldValues,
      origin: { x: 0, y: 0 },
      style: DEFAULT_STYLE,
      nextZIndex: (() => {
        let z = 1;
        return () => z++;
      })(),
    });
    const badge = result.elements.find(
      (e) => e.metadata?.structureFieldId === 'badge',
    );
    expect(badge?.type).toBe('text');
    if (badge?.type === 'text') {
      expect(badge.text).toContain('PHYSICS');
      expect(badge.metadata?.structureDecorative).toBe(true);
    }
  });

  it('packs multiple instances as separate chronological units (downwards)', () => {
    const template = createPhysicsConceptTemplate();
    const compiled = compileStructureMarkdown(PHYSICS_MD, template);
    const sizes = compiled.operations.map((op, i) => {
      const fieldValues = new Map<string, StructureFieldValue>();
      for (const [id, payload] of Object.entries(op.fields)) {
        if (!payload) continue;
        if ('content' in payload) {
          fieldValues.set(id, { kind: 'text', content: payload.content });
        } else if ('latex' in payload) {
          fieldValues.set(id, { kind: 'equation', latex: payload.latex });
        } else if ('expressions' in payload) {
          fieldValues.set(id, {
            kind: 'graph',
            title: null,
            expressions: payload.expressions,
            xMin: null,
            xMax: null,
            yMin: null,
            yMax: null,
            xLabel: null,
            yLabel: null,
          });
        }
      }
      const bounds = computeStructuredNoteBounds(template, fieldValues);
      return { id: `inst_${i}`, width: bounds.width, height: bounds.height };
    });

    const packed = packCellsChronologically(sizes, {
      ...DEFAULT_USER_LAYOUT_SETTINGS,
      chronologicalDirection: 'down',
      maxColumnHeight: null,
      maxRowWidth: null,
    }, { columnGap: 24, rowGap: 24, outerPadding: 0 });

    expect(packed.cells).toHaveLength(2);
    expect(packed.cells[1]!.y).toBeGreaterThan(packed.cells[0]!.y);
    expect(packed.cells[0]!.x).toBe(packed.cells[1]!.x);
  });

  it('packs sideways and respects max row width', () => {
    const sizes = [
      { id: 'a', width: 200, height: 100 },
      { id: 'b', width: 200, height: 100 },
      { id: 'c', width: 200, height: 100 },
    ];
    const packed = packCellsChronologically(
      sizes,
      {
        chronologicalDirection: 'sideways',
        maxColumnHeight: null,
        maxRowWidth: 450,
        columnRowRatio: null,
      },
      { columnGap: 20, rowGap: 20, outerPadding: 0 },
    );
    expect(packed.cells[0]!.y).toBe(packed.cells[1]!.y);
    expect(packed.cells[2]!.y).toBeGreaterThan(packed.cells[0]!.y);
  });

  it('applies structure instances through content-first handle path', () => {
    const template = createPhysicsConceptTemplate();
    // Live executor resolves templates from the structure library store.
    useStructureStore.setState({ structures: [template] });
    const result = handleContentFirstResponse(PHYSICS_MD, ctxFor(template));
    expect(result.kind).toBe('content_first');
    expect(result.execution?.structureInstanceIds.length).toBe(2);
    const elements = useCanvasStore.getState().document.elements;
    const instances = new Set(
      elements
        .map((e) => e.metadata?.structureInstanceId)
        .filter((id): id is string => typeof id === 'string'),
    );
    expect(instances.size).toBe(2);
  });

  it('continues ordinary Markdown when no structure is selected', () => {
    const md = '```markdown\n# Hello\n\nA paragraph about SHM.\n```';
    const result = handleContentFirstResponse(md, {
      allowedElementIds: new Set(),
      selectedStructure: null,
    });
    expect(result.execution?.createdIds.length).toBeGreaterThan(0);
    expect(result.execution?.structureInstanceIds ?? []).toHaveLength(0);
  });

  it('validates create_structured_note batches via agent parser', () => {
    const template = createPhysicsConceptTemplate();
    const compiled = compileStructureMarkdown(PHYSICS_MD, template);
    const batch = structureInstancesToAgentResponse(compiled.operations);
    const parsed = parseCanvasAgentResponse(JSON.stringify(batch), ctxFor(template));
    expect(parsed.operations).toHaveLength(2);
  });
});
