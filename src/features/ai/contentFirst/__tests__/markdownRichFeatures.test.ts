import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createEmptyDocument,
  DEFAULT_STYLE,
  type TextElement,
} from '../../../../types/canvas';
import { useCanvasStore } from '../../../../store/canvasStore';
import { ragSync } from '../../../rag/ragSync';
import { createAiTextElement } from '../../canvas/createAiTextElement';
import { parseContentDocument, parseInlineSpans } from '../contentParser';
import { compileContentDocument } from '../compileContentDocument';
import { documentToSingleRichText } from '../compileJsonInstructions';
import { splitContentFirstEnvelope } from '../jsonDirective';
import { handleContentFirstResponse } from '../applyContentFirst';
import { setAiGenerationModeOverride } from '../generationMode';
import {
  CONTENT_FIRST_SYSTEM_PROMPT,
  assertContentFirstPromptFitsLimit,
} from '../contentFirstPrompt';
import { parseRichTextDocument } from '../../../text/richTextValidate';
import {
  isCodeBlock,
  richTextToPlainText,
  type RichTextDocument,
} from '../../../text/richText';
import {
  htmlToRichText,
  measureRichTextHeight,
  richTextToHtml,
} from '../../../text/richTextHtml';
import { highlightCodeToHtml } from '../../../text/syntaxHighlight';

function seedText(id = 'text_12', text = 'Original prose.'): TextElement {
  const el = createAiTextElement(text, { x: 40, y: 40 }, {
    zIndex: 1,
    style: DEFAULT_STYLE,
  });
  return { ...el, id };
}

function reset(elements: TextElement[]) {
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

describe('markdown rich features — code / quotes / nested lists', () => {
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

  it('prompt documents code/quotes/lists and fits limit', () => {
    assertContentFirstPromptFitsLimit();
    expect(CONTENT_FIRST_SYSTEM_PROMPT).toMatch(/code/i);
    expect(CONTENT_FIRST_SYSTEM_PROMPT).toMatch(/blockquote|quotes/i);
    expect(CONTENT_FIRST_SYSTEM_PROMPT).toMatch(/nested list/i);
  });

  it('Test A — Python code block preserves indentation', () => {
    const doc = parseContentDocument(`\`\`\`python
import numpy as np

def displacement(t, amplitude, omega):
    return amplitude * np.cos(omega * t)
\`\`\`
`);
    expect(doc.nodes).toHaveLength(1);
    expect(doc.nodes[0]?.type).toBe('code_block');
    if (doc.nodes[0]?.type === 'code_block') {
      expect(doc.nodes[0].language).toBe('python');
      expect(doc.nodes[0].code).toContain('    return amplitude');
      expect(doc.nodes[0].code).toContain('import numpy');
    }
  });

  it('Test B — multiple languages + plain text fallback', () => {
    for (const [lang, sample] of [
      ['javascript', 'const x = 1;'],
      ['typescript', 'const x: number = 1;'],
      ['json', '{"a":1}'],
      ['text', ':::json\n{"action":"edit"}\n:::'],
    ] as const) {
      const doc = parseContentDocument(`\`\`\`${lang}\n${sample}\n\`\`\`\n`);
      expect(doc.nodes[0]?.type).toBe('code_block');
      if (doc.nodes[0]?.type === 'code_block') {
        expect(doc.nodes[0].code).toContain(sample.split('\n')[0]!);
      }
      const hl = highlightCodeToHtml(sample, lang);
      expect(hl.html.length).toBeGreaterThan(0);
      expect(hl.html).not.toContain('<script');
    }
  });

  it('Test C — inline code in paragraphs, headings, lists', () => {
    const spans = parseInlineSpans(
      'Use `numpy.linspace()` and `$x^2$` literally.',
    );
    expect(spans.some((s) => s.type === 'inline_code' && s.text === 'numpy.linspace()')).toBe(
      true,
    );
    expect(spans.some((s) => s.type === 'inline_code' && s.text === '$x^2$')).toBe(
      true,
    );
    expect(spans.every((s) => s.type !== 'inline_math')).toBe(true);

    const doc = parseContentDocument(`## Using \`omega\`

- Call \`solve()\`
1. Set \`dt\`
`);
    expect(doc.nodes.some((n) => n.type === 'heading')).toBe(true);
    expect(doc.nodes.some((n) => n.type === 'list')).toBe(true);
  });

  it('Test D — fenced :::json / :::graph stay literal (no ops)', () => {
    const raw = `# Title

\`\`\`text
:::json
{"action":"edit","target_id":"text_1"}
:::

:::graph
expression: sin(x)
:::
\`\`\`
`;
    const env = splitContentFirstEnvelope(raw);
    expect(env.segments).toHaveLength(0);

    const doc = parseContentDocument(raw);
    expect(doc.nodes.some((n) => n.type === 'graph')).toBe(false);
    expect(doc.nodes.some((n) => n.type === 'code_block')).toBe(true);
    const compiled = compileContentDocument(doc);
    expect(
      compiled.response.operations.every((o) => o.type.startsWith('create_text')),
    ).toBe(true);
    expect(
      compiled.response.operations.every((o) => o.type !== 'create_graph'),
    ).toBe(true);
  });

  it('Test E/F — blockquotes single, multi-paragraph, nested', () => {
    const doc = parseContentDocument(`> Outer quote with $F=-kx$.

> First paragraph of a multi-paragraph quote.
>
> Second paragraph.

> Outer
>
> > Nested detail
`);
    const quotes = doc.nodes.filter((n) => n.type === 'blockquote');
    expect(quotes.length).toBeGreaterThanOrEqual(3);
    expect(quotes.some((q) => q.type === 'blockquote' && q.depth >= 2)).toBe(
      true,
    );
    expect(
      quotes.some(
        (q) =>
          q.type === 'blockquote' &&
          q.spans.some((s) => s.type === 'inline_math'),
      ),
    ).toBe(true);
  });

  it('Test G/H/I — nested unordered, ordered, and mixed lists', () => {
    const unordered = parseContentDocument(`- Classical Mechanics
  - Newton's Laws
    - First Law
    - Second Law
  - Conservation Laws
    - Energy
- Electromagnetism
`);
    expect(unordered.nodes[0]?.type).toBe('list');
    if (unordered.nodes[0]?.type === 'list') {
      const depths = unordered.nodes[0].items.map((i) => i.depth);
      expect(Math.max(...depths)).toBeGreaterThanOrEqual(2);
      expect(unordered.nodes[0].items.every((i) => !i.ordered)).toBe(true);
    }

    const ordered = parseContentDocument(`1. Start with Hooke's law.
2. Apply Newton's second law.
   1. Substitute acceleration.
   2. Rearrange the equation.
3. Solve the differential equation.
`);
    expect(ordered.nodes[0]?.type).toBe('list');
    if (ordered.nodes[0]?.type === 'list') {
      expect(ordered.nodes[0].items.some((i) => i.depth === 1)).toBe(true);
      expect(ordered.nodes[0].items.every((i) => i.ordered)).toBe(true);
    }

    const mixed = parseContentDocument(`1. Identify the restoring force.
2. Apply Newton's second law.
   - Substitute acceleration.
   - Rearrange the terms.
3. Compare with standard SHM.
`);
    if (mixed.nodes[0]?.type === 'list') {
      expect(mixed.nodes[0].items.some((i) => i.ordered)).toBe(true);
      expect(mixed.nodes[0].items.some((i) => !i.ordered)).toBe(true);
    }
  });

  it('Test J — inline math inside quotes and nested list items', () => {
    const doc = parseContentDocument(`> Energy $E=\\frac12kA^2$.

1. Use $\\omega=\\sqrt{k/m}$.
   - Amplitude $A$
`);
    expect(
      doc.nodes.some(
        (n) =>
          n.type === 'blockquote' &&
          n.spans.some((s) => s.type === 'inline_math'),
      ),
    ).toBe(true);
    expect(
      doc.nodes.some(
        (n) =>
          n.type === 'list' &&
          n.items.some((i) => i.spans.some((s) => s.type === 'inline_math')),
      ),
    ).toBe(true);
  });

  it('Test K — code escaping of special characters', () => {
    const doc = parseContentDocument(`\`\`\`text
\`backticks\` $dollars$ |pipes| <tags> **bold**
\`\`\`
`);
    if (doc.nodes[0]?.type === 'code_block') {
      expect(doc.nodes[0].code).toContain('`backticks`');
      expect(doc.nodes[0].code).toContain('$dollars$');
      expect(doc.nodes[0].code).toContain('<tags>');
    }
    const rich = documentToSingleRichText(doc);
    const html = richTextToHtml(parseRichTextDocument(rich), {
      color: '#111',
      fontSize: 16,
      fontFamily: 'Arial',
    });
    expect(html).toContain('&lt;tags&gt;');
    expect(html).not.toContain('<tags>');
  });

  it('Test L — mixed Markdown keeps reading order; eq/graph separate', () => {
    const md = `## Simulating Simple Harmonic Motion

We can numerically model displacement using:

$$
x(t)=A\\cos(\\omega t)
$$

The simulation requires:

1. Defining the parameters:
   - Amplitude \`$A$\`
   - Angular frequency \`$\\omega$\`
2. Generating time values.
3. Calculating displacement.

The following Python code implements the model:

\`\`\`python
import numpy as np

t = np.linspace(0, 10, 100)
x = np.cos(t)
\`\`\`

> The angular frequency controls how quickly the system oscillates.

| Symbol | Meaning |
|---|---|
| $A$ | Amplitude |

:::graph
expression: cos(x)
title: SHM Displacement
:::
`;
    const doc = parseContentDocument(md);
    const types = doc.nodes.map((n) => n.type);
    expect(types).toContain('heading');
    expect(types).toContain('equation');
    expect(types).toContain('list');
    expect(types).toContain('code_block');
    expect(types).toContain('blockquote');
    expect(types).toContain('table');
    expect(types).toContain('graph');
    // Chronological: equation before code before graph
    expect(types.indexOf('equation')).toBeLessThan(types.indexOf('code_block'));
    expect(types.indexOf('code_block')).toBeLessThan(types.indexOf('graph'));

    const compiled = compileContentDocument(doc);
    const opTypes = compiled.response.operations.map((o) => o.type);
    expect(opTypes).toContain('create_equation');
    expect(opTypes).toContain('create_graph');
    expect(opTypes).toContain('create_text');
    const textWithCode = compiled.response.operations.find(
      (o) =>
        o.type === 'create_text' &&
        o.rich_text?.blocks.some((b) => b.type === 'code_block'),
    );
    expect(textWithCode).toBeTruthy();
  });

  it('Test M — sizing grows for long code and nested lists', () => {
    const longCode = Array.from({ length: 25 }, (_, i) => `    line_${i} = ${i}`).join(
      '\n',
    );
    const doc = parseContentDocument(`\`\`\`python
${longCode}
\`\`\`

- L0
  - L1
    - L2
      - L3
`);
    const rich = parseRichTextDocument(documentToSingleRichText(doc));
    const h = measureRichTextHeight(rich, 360, {
      color: '#111',
      fontSize: 16,
      fontFamily: 'Arial',
      padding: 12,
    });
    expect(h).toBeGreaterThan(300);
  });

  it('Test N/P — HTML round-trip / save shape preserves structures', () => {
    const md = `> Quote with \`code\` and $x$.

\`\`\`js
const n = 1;
\`\`\`

1. One
   - nested
`;
    const rich = parseRichTextDocument(
      documentToSingleRichText(parseContentDocument(md)),
    );
    const json = JSON.parse(JSON.stringify(rich)) as RichTextDocument;
    const reloaded = parseRichTextDocument(json);
    expect(richTextToPlainText(reloaded)).toContain('const n = 1');
    expect(reloaded.blocks.some(isCodeBlock)).toBe(true);
    expect(reloaded.blocks.some((b) => b.type === 'blockquote')).toBe(true);

    if (typeof document !== 'undefined') {
      const html = richTextToHtml(rich, {
        color: '#111',
        fontSize: 16,
        fontFamily: 'Arial',
      });
      const host = document.createElement('div');
      host.innerHTML = html;
      const back = htmlToRichText(host.firstElementChild as HTMLElement, {
        baseFontSize: 16,
      });
      expect(back.blocks.some((b) => b.type === 'code_block')).toBe(true);
      expect(back.blocks.some((b) => b.type === 'blockquote')).toBe(true);
    }
  });

  it('Test O — :::json edit with code + nested lists preserves id', () => {
    const text = seedText();
    reset([text]);
    const raw = `:::json
{"action":"edit","target_id":"text_12"}
:::

## Numerical Simulation

The following program calculates displacement.

\`\`\`python
import numpy as np
x = np.cos(t)
\`\`\`

1. Identify the restoring force.
2. Apply Newton's second law.
   - Substitute acceleration.
   - Rearrange the terms.
3. Compare with standard SHM.
`;
    handleContentFirstResponse(raw, {
      allowedElementIds: new Set(['text_12']),
      elementTypes: new Map([['text_12', 'text']]),
    });
    const updated = useCanvasStore
      .getState()
      .document.elements.find((e) => e.id === 'text_12');
    expect(updated?.type).toBe('text');
    if (updated?.type === 'text') {
      expect(updated.id).toBe('text_12');
      expect(updated.richText?.blocks.some((b) => b.type === 'code_block')).toBe(
        true,
      );
      expect(
        updated.richText?.blocks.some(
          (b) => b.type === 'bullet' || b.type === 'numbered',
        ),
      ).toBe(true);
      expect(updated.text).toContain('numpy');
    }
  });

  it('Test Q — RAG plain extract includes code and list hierarchy', () => {
    const rich = parseRichTextDocument(
      documentToSingleRichText(
        parseContentDocument(`\`\`\`python
print(1)
\`\`\`

- Parent
  - Child
`),
      ),
    );
    const plain = richTextToPlainText(rich);
    expect(plain).toContain('```python');
    expect(plain).toContain('print(1)');
    expect(plain).toMatch(/-\s+Parent/);
    expect(plain).toMatch(/\s+-\s+Child/);
  });

  it('Test R — tilde fences and longer backtick fences', () => {
    const tilde = parseContentDocument(`~~~bash
echo hello
~~~
`);
    expect(tilde.nodes[0]?.type).toBe('code_block');

    const nested = parseContentDocument(`\`\`\`\`markdown
\`\`\`
inner
\`\`\`
\`\`\`\`
`);
    expect(nested.nodes[0]?.type).toBe('code_block');
    if (nested.nodes[0]?.type === 'code_block') {
      expect(nested.nodes[0].code).toContain('```');
      expect(nested.nodes[0].code).toContain('inner');
    }
  });
});
