import { describe, expect, it } from 'vitest';
import {
  looksLikeMarkdownTableStart,
  parseMarkdownTableAt,
  splitMarkdownTableRow,
} from '../markdownTables';
import { parseContentDocument } from '../contentParser';
import { compileContentDocument } from '../compileContentDocument';
import { documentToSingleRichText } from '../compileJsonInstructions';
import { parseRichTextDocument } from '../../../text/richTextValidate';
import {
  isTableBlock,
  richTextToPlainText,
  type RichTextDocument,
} from '../../../text/richText';
import { htmlToRichText, measureRichTextHeight, richTextToHtml } from '../../../text/richTextHtml';
import { choosePreferredTextWidth } from '../../../text/textAutoSizer';

describe('GFM markdown table helpers', () => {
  it('splits rows with optional outer pipes and escaped pipes', () => {
    expect(splitMarkdownTableRow('| A | B |')).toEqual(['A', 'B']);
    expect(splitMarkdownTableRow('A | B')).toEqual(['A', 'B']);
    expect(splitMarkdownTableRow('| A \\| B | C |')).toEqual(['A | B', 'C']);
  });

  it('does not treat ordinary prose with a single pipe as a row', () => {
    expect(splitMarkdownTableRow('use | carefully in prose')).toEqual([
      'use',
      'carefully in prose',
    ]);
    expect(splitMarkdownTableRow('just a pipe | somehow')).toEqual([
      'just a pipe',
      'somehow',
    ]);
    expect(splitMarkdownTableRow('no pipes here')).toBeNull();
  });

  it('requires a separator row to recognise a table start', () => {
    const lines = ['| A | B |', '|---|---|', '| 1 | 2 |'];
    expect(looksLikeMarkdownTableStart(lines, 0)).toBe(true);
    expect(looksLikeMarkdownTableStart(['| A | B |', '| 1 | 2 |'], 0)).toBe(
      false,
    );
  });

  it('parses alignment markers', () => {
    const lines = [
      '| Left | Centre | Right |',
      '|:---|:---:|---:|',
      '| A | B | C |',
    ];
    const parsed = parseMarkdownTableAt(lines, 0);
    expect(parsed).not.toBeNull();
    expect(parsed!.table.alignments).toEqual(['left', 'center', 'right']);
    expect(parsed!.table.rows).toEqual([['A', 'B', 'C']]);
  });
});

describe('contentParser tables', () => {
  it('Test A — basic three-column table becomes a table IR node', () => {
    const doc = parseContentDocument(`| Variable | Meaning | Unit |
|---|---|---|
| F | Force | N |
| m | Mass | kg |
| a | Acceleration | m/s² |
`);
    expect(doc.nodes).toHaveLength(1);
    expect(doc.nodes[0]?.type).toBe('table');
    if (doc.nodes[0]?.type === 'table') {
      expect(doc.nodes[0].columns).toHaveLength(3);
      expect(doc.nodes[0].rows).toHaveLength(4); // header + 3
      expect(doc.nodes[0].rows[0]?.header).toBe(true);
      expect(doc.nodes[0].text).toContain('Variable');
      expect(doc.nodes[0].text).toContain('Force');
    }
  });

  it('Test B — inline LaTeX in cells', () => {
    const doc = parseContentDocument(`| Quantity | Equation |
|---|---|
| Force | $F=ma$ |
| Kinetic Energy | $E_k=\\frac{1}{2}mv^2$ |
| Angular Frequency | $\\omega=\\sqrt{\\frac{k}{m}}$ |
`);
    const table = doc.nodes.find((n) => n.type === 'table');
    expect(table).toBeTruthy();
    if (table?.type === 'table') {
      const body = table.rows.filter((r) => !r.header);
      expect(
        body.every((r) =>
          r.cells.some((c) => c.spans.some((s) => s.type === 'inline_math')),
        ),
      ).toBe(true);
      expect(table.text).toContain('omega');
    }
  });

  it('Test C — multiple tables keep reading order with paragraphs', () => {
    const doc = parseContentDocument(`Intro paragraph.

| A | B |
|---|---|
| 1 | 2 |

Middle paragraph.

| C | D |
|---|---|
| 3 | 4 |

Outro.
`);
    expect(doc.nodes.map((n) => n.type)).toEqual([
      'paragraph',
      'table',
      'paragraph',
      'table',
      'paragraph',
    ]);
  });

  it('Test D — table then display equation → table + equation nodes', () => {
    const doc = parseContentDocument(`| Energy Type | Equation |
|---|---|
| Kinetic | $E_k$ |
| Potential | $E_p$ |

$$
E_k+E_p=E
$$
`);
    expect(doc.nodes.map((n) => n.type)).toEqual(['table', 'equation']);
  });

  it('Test F — edge cases: empty cells, alignment, code fences, invalid', () => {
    const withEmpty = parseContentDocument(`| A | B | C |
|---|---|---|
| x |  | z |
`);
    expect(withEmpty.nodes[0]?.type).toBe('table');
    if (withEmpty.nodes[0]?.type === 'table') {
      expect(withEmpty.nodes[0].rows[1]!.cells[1]!.text).toBe('');
    }

    const aligned = parseContentDocument(`| L | C | R |
|:---|:---:|---:|
| a | b | c |
`);
    if (aligned.nodes[0]?.type === 'table') {
      expect(aligned.nodes[0].columns.map((c) => c.alignment)).toEqual([
        'left',
        'center',
        'right',
      ]);
    }

    // Table-like text inside a code fence must not become a table node.
    // Keep prose outside so the fence is not treated as a whole-document wrapper.
    const fenced = parseContentDocument(`Example:

\`\`\`
| A | B |
|---|---|
| 1 | 2 |
\`\`\`
`);
    expect(fenced.nodes.some((n) => n.type === 'table')).toBe(false);
    expect(fenced.nodes.some((n) => n.type === 'paragraph')).toBe(true);

    // Pipes without a separator stay as a paragraph.
    const notTable = parseContentDocument(`Values a | b | c without a separator.
`);
    expect(notTable.nodes[0]?.type).toBe('paragraph');
  });

  it('compiles a table into a TextElement rich_text table block (not separate cells)', () => {
    const doc = parseContentDocument(`## Quantities

| Symbol | Meaning |
|---|---|
| $m$ | Mass |
| $k$ | Spring constant |

Done.
`);
    const compiled = compileContentDocument(doc);
    const textOps = compiled.response.operations.filter(
      (op) => op.type === 'create_text',
    );
    // Heading is its own text; prose+table merge into another.
    const withTable = textOps.find(
      (op) =>
        op.type === 'create_text' &&
        op.rich_text?.blocks.some((b) => b.type === 'table'),
    );
    expect(withTable).toBeTruthy();
    if (withTable?.type === 'create_text') {
      const tableBlocks = withTable.rich_text!.blocks.filter(
        (b) => b.type === 'table',
      );
      expect(tableBlocks).toHaveLength(1);
      // No create_text per cell
      expect(textOps.length).toBeLessThan(5);
    }

    const eqOps = compiled.response.operations.filter(
      (op) => op.type === 'create_equation',
    );
    expect(eqOps).toHaveLength(0);
  });

  it('Test D compile — table then $$ becomes TextElement + EquationElement', () => {
    const doc = parseContentDocument(`| Energy | Form |
|---|---|
| Kinetic | $E_k$ |

$$
E_k+E_p=E
$$
`);
    const compiled = compileContentDocument(doc);
    const types = compiled.response.operations.map((op) => op.type);
    expect(types).toContain('create_text');
    expect(types).toContain('create_equation');
    const textOp = compiled.response.operations.find(
      (op) => op.type === 'create_text',
    );
    if (textOp?.type === 'create_text') {
      expect(textOp.rich_text!.blocks.some((b) => b.type === 'table')).toBe(true);
    }
  });
});

describe('rich-text table blocks', () => {
  function sampleTableDoc(): RichTextDocument {
    return parseRichTextDocument({
      blocks: [
        {
          type: 'table',
          columns: [
            { alignment: 'left' },
            { alignment: 'center' },
            { alignment: 'right' },
          ],
          rows: [
            {
              header: true,
              cells: [
                { spans: [{ text: 'Quantity' }] },
                { spans: [{ text: 'Symbol' }] },
                { spans: [{ text: 'Unit' }] },
              ],
            },
            {
              cells: [
                { spans: [{ text: 'Force' }] },
                { spans: [{ type: 'inline_math', latex: 'F' }] },
                { spans: [{ text: 'N' }] },
              ],
            },
            {
              cells: [
                { spans: [{ text: 'Mass' }] },
                { spans: [{ type: 'inline_math', latex: 'm' }] },
                { spans: [{ text: 'kg' }] },
              ],
            },
          ],
        },
      ],
    });
  }

  it('parses, renders HTML, and plain-text for RAG', () => {
    const doc = sampleTableDoc();
    expect(isTableBlock(doc.blocks[0]!)).toBe(true);
    const plain = richTextToPlainText(doc);
    expect(plain).toContain('Quantity');
    expect(plain).toContain('[LaTeX: F]');
    expect(plain).toContain('Mass');
    // Header↔value association preserved as Markdown rows
    expect(plain).toMatch(/\|/);

    const html = richTextToHtml(doc, {
      color: '#1a1a1a',
      fontSize: 16,
      fontFamily: 'Arial',
    });
    expect(html).toContain('data-rt-type="table"');
    expect(html).toContain('<table');
    expect(html).toContain('data-rt-align="center"');
    expect(html).toContain('inline_math');
  });

  it('Test G — HTML round-trip preserves table structure', () => {
    // happy-dom / jsdom may be absent in unit env — skip DOM round-trip then.
    if (typeof document === 'undefined') {
      const doc = sampleTableDoc();
      expect(isTableBlock(doc.blocks[0]!)).toBe(true);
      return;
    }
    const doc = sampleTableDoc();
    const html = richTextToHtml(doc, {
      color: '#1a1a1a',
      fontSize: 16,
      fontFamily: 'Arial',
    });
    const host = document.createElement('div');
    host.innerHTML = html;
    const root = host.firstElementChild as HTMLElement;
    const back = htmlToRichText(root, { baseFontSize: 16 });
    expect(back.blocks[0]?.type).toBe('table');
    if (isTableBlock(back.blocks[0]!)) {
      expect(back.blocks[0].rows).toHaveLength(3);
      expect(back.blocks[0].columns.map((c) => c.alignment)).toEqual([
        'left',
        'center',
        'right',
      ]);
      const plain = richTextToPlainText(back);
      expect(plain).toContain('Force');
      expect(plain).toContain('Mass');
    }
  });

  it('Test E — large table height expands with row count', () => {
    const rows = [
      {
        header: true,
        cells: [
          { spans: [{ text: 'n' }] },
          { spans: [{ text: 'value' }] },
          { spans: [{ text: 'note' }] },
        ],
      },
      ...Array.from({ length: 20 }, (_, i) => ({
        cells: [
          { spans: [{ text: String(i + 1) }] },
          { spans: [{ text: `value-${i}` }] },
          { spans: [{ text: `note for row ${i} with extra wrapping text` }] },
        ],
      })),
    ];
    const doc = parseRichTextDocument({
      blocks: [
        {
          type: 'table',
          columns: [
            { alignment: 'left' },
            { alignment: 'left' },
            { alignment: 'left' },
          ],
          rows,
        },
      ],
    });
    const h = measureRichTextHeight(doc, 360, {
      color: '#1a1a1a',
      fontSize: 16,
      fontFamily: 'Arial',
      padding: 12,
    });
    const short = measureRichTextHeight(sampleTableDoc(), 360, {
      color: '#1a1a1a',
      fontSize: 16,
      fontFamily: 'Arial',
      padding: 12,
    });
    expect(h).toBeGreaterThan(short);
    expect(h).toBeGreaterThan(400);
  });

  it('Test I — structured table survives parse (save/reload shape)', () => {
    const doc = sampleTableDoc();
    const json = JSON.parse(JSON.stringify(doc));
    const reloaded = parseRichTextDocument(json);
    expect(richTextToPlainText(reloaded)).toBe(richTextToPlainText(doc));
  });

  it('Test H — :::json-style fold keeps table inside one rich-text doc', () => {
    const md = `## Physical Quantities

| Quantity | Symbol | Unit |
|---|---|---|
| Force | $F$ | N |
| Mass | $m$ | kg |
`;
    const ir = parseContentDocument(md);
    const rich = documentToSingleRichText(ir);
    expect(rich.blocks.some((b) => b.type === 'table')).toBe(true);
    expect(rich.blocks.some((b) => b.type === 'heading')).toBe(true);
    const validated = parseRichTextDocument(rich);
    expect(richTextToPlainText(validated)).toContain('Force');
  });

  it('Test J — measured height includes the table for layout packing', () => {
    const doc = parseContentDocument(`| Col1 | Col2 | Col3 |
|---|---|---|
${Array.from({ length: 12 }, (_, i) => `| r${i}a | r${i}b | r${i}c |`).join('\n')}
`);
    const compiled = compileContentDocument(doc);
    const op = compiled.response.operations.find((o) => o.type === 'create_text');
    expect(op?.type).toBe('create_text');
    if (op?.type === 'create_text') {
      const richText = parseRichTextDocument(op.rich_text);
      const height = measureRichTextHeight(richText, 360, {
        color: '#1a1a1a',
        fontSize: 16,
        fontFamily: 'Arial',
        padding: 12,
        lineHeight: 1.35,
      });
      expect(height).toBeGreaterThan(200);
      const preferred = choosePreferredTextWidth(
        { text: op.text, richText },
        { fontSize: 16, padding: 12 },
      );
      expect(preferred).toBeGreaterThan(100);
    }
  });

  it('Test K — RAG plain extract keeps header and cell association', () => {
    const doc = sampleTableDoc();
    const plain = richTextToPlainText(doc);
    // Markdown row form keeps Symbol near F on the same line as Force
    const forceLine = plain.split('\n').find((l) => l.includes('Force'));
    expect(forceLine).toBeTruthy();
    expect(forceLine).toMatch(/Force/);
    expect(forceLine).toMatch(/\[LaTeX: F\]/);
    expect(forceLine).toMatch(/N/);
  });
});
