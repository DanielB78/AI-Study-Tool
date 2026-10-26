import { describe, expect, it } from 'vitest';
import {
  looksLikeContentMarkdown,
  looksLikeOperationsJson,
  parseContentDocument,
  parseInlineSpans,
} from '../contentParser';
import { ContentParseError } from '../types';

describe('contentParser', () => {
  it('parses headings, paragraphs, and inline math', () => {
    const doc = parseContentDocument(`# Title

The angular frequency is $\\omega=\\sqrt{k/m}$.
`);
    expect(doc.nodes[0]).toMatchObject({ type: 'heading', level: 1, text: 'Title' });
    expect(doc.nodes[1]?.type).toBe('paragraph');
    if (doc.nodes[1]?.type === 'paragraph') {
      expect(doc.nodes[1].spans.some((s) => s.type === 'inline_math')).toBe(true);
    }
  });

  it('does not treat currency as inline math', () => {
    const spans = parseInlineSpans('Costs $5 today');
    expect(spans.every((s) => s.type === 'text')).toBe(true);
  });

  it('creates one EquationElement node for multiline aligned display math', () => {
    const doc = parseContentDocument(`$$
\\begin{aligned}
F &= -kx \\\\
m\\ddot{x} &= -kx
\\end{aligned}
$$
`);
    const eqs = doc.nodes.filter((n) => n.type === 'equation');
    expect(eqs).toHaveLength(1);
    if (eqs[0]?.type === 'equation') {
      expect(eqs[0].latex).toContain('aligned');
      expect(eqs[0].latex).toContain('F');
    }
  });

  it('parses graph markers with multiple expressions', () => {
    const doc = parseContentDocument(`:::graph
title: Compare
expression: cos(x)
expression: -sin(x)
expression: -cos(x)
x_min: 0
x_max: 12.57
:::
`);
    expect(doc.nodes).toHaveLength(1);
    expect(doc.nodes[0]).toMatchObject({
      type: 'graph',
      title: 'Compare',
    });
    if (doc.nodes[0]?.type === 'graph') {
      expect(doc.nodes[0].expressions).toEqual(['cos(x)', '-sin(x)', '-cos(x)']);
    }
  });

  it('parses optional component markers', () => {
    const doc = parseContentDocument(`:::definition
SHM is oscillation with $a \\propto -x$.
:::

:::exercise
Explain why $a=0$ at equilibrium.
:::
`);
    expect(doc.nodes.map((n) => n.type)).toEqual(['component', 'component']);
    expect(doc.nodes[0]).toMatchObject({ type: 'component', component: 'definition' });
    expect(doc.nodes[1]).toMatchObject({ type: 'component', component: 'exercise' });
  });

  it('preserves reading order across mixed blocks', () => {
    const doc = parseContentDocument(`## Force

Lead-in.

$$
F=-kx
$$

Follow-up.

:::graph
expression: cos(x)
:::

End.
`);
    expect(doc.nodes.map((n) => n.type)).toEqual([
      'heading',
      'paragraph',
      'equation',
      'paragraph',
      'graph',
      'paragraph',
    ]);
  });

  it('assigns section ids from headings', () => {
    const doc = parseContentDocument(`## A

Text A

$$
1+1=2
$$

## B

Text B
`);
    const a = doc.nodes.filter((n) => n.type !== 'heading' && 'sectionId' in n && n.sectionId === 'sec_1');
    const b = doc.nodes.filter((n) => n.type !== 'heading' && 'sectionId' in n && n.sectionId === 'sec_2');
    expect(a.length).toBeGreaterThan(0);
    expect(b.length).toBeGreaterThan(0);
  });

  it('rejects invalid graph expressions', () => {
    expect(() =>
      parseContentDocument(`:::graph
expression: __import__("os")
:::
`),
    ).toThrow(ContentParseError);
  });

  it('rejects invalid display LaTeX', () => {
    expect(() =>
      parseContentDocument(`$$
\\frac{1}{
$$
`),
    ).toThrow(ContentParseError);
  });

  it('detects JSON ops vs Markdown', () => {
    expect(looksLikeOperationsJson('{"operations":[]}')).toBe(true);
    expect(looksLikeContentMarkdown('# Hello\n\nWorld')).toBe(true);
    expect(looksLikeContentMarkdown('{"operations":[]}')).toBe(false);
  });

  it('unwraps a ```markdown document fence (ChatGPT pasteable wrapper)', () => {
    const doc = parseContentDocument(`\`\`\`markdown
# Title

Hello $\\omega$.

$$
F=-kx
$$
\`\`\`
`);
    expect(doc.nodes.map((n) => n.type)).toEqual([
      'heading',
      'paragraph',
      'equation',
    ]);
  });

  it('unwraps a markdown fence even with a short ChatGPT preamble', () => {
    const doc = parseContentDocument(`Here is the document:

\`\`\`markdown
## Sec

Body text.
\`\`\`
`);
    expect(doc.nodes[0]).toMatchObject({ type: 'heading', text: 'Sec' });
    expect(doc.nodes[1]).toMatchObject({ type: 'paragraph', text: 'Body text.' });
  });

  it('does not let $$ open an inline math span that swallows headings', () => {
    const spans = parseInlineSpans(`total energy.

### Step 1: Angular Frequency

$$
\\omega=1
$$
`);
    expect(spans.every((s) => s.type === 'text' || (s.type === 'inline_math' && !s.latex.includes('###')))).toBe(
      true,
    );
    expect(spans.some((s) => s.type === 'text' && s.text.includes('### Step 1'))).toBe(true);
  });

  it('expands :::example bodies with display math into equation nodes', () => {
    const doc = parseContentDocument(String.raw`:::example
A mass of $0.50\,\mathrm{kg}$ is released.

Calculate total energy.

### Step 1: Angular Frequency

$$
\begin{aligned}
\omega&=\sqrt{\frac{k}{m}}\\
&=20\,\mathrm{rad/s}
\end{aligned}
$$

### Step 2: Period

$$
T=\frac{2\pi}{\omega}
$$
:::
`);
    const types = doc.nodes.map((n) => n.type);
    expect(types[0]).toBe('component');
    expect(types).toContain('equation');
    expect(doc.nodes.filter((n) => n.type === 'equation')).toHaveLength(2);
    for (const n of doc.nodes) {
      if (n.type === 'component' || n.type === 'paragraph') {
        for (const s of n.spans) {
          if (s.type === 'inline_math') {
            expect(s.latex).not.toMatch(/#/);
          }
        }
      }
    }
  });
});
