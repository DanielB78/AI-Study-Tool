import { describe, expect, it } from 'vitest';
import { parseRichTextDocument } from '../richTextValidate';
import { richTextToPlainText, isInlineMathSpan, isDisplayMathBlock } from '../richText';
import { richTextToHtml } from '../richTextHtml';
import {
  convertTextMathInElement,
  insertDisplayMathInElement,
  insertInlineMathInElement,
  listMathNodes,
  removeTextMathFromElement,
  updateTextMathInElement,
} from '../textMath';
import type { TextElement } from '../../../types/canvas';

function makeText(partial?: Partial<TextElement>): TextElement {
  return {
    id: 't1',
    type: 'text',
    text: 'The restoring force is , where k is the spring constant.',
    richText: parseRichTextDocument({
      blocks: [
        {
          type: 'paragraph',
          id: 'block_a',
          spans: [
            { text: 'The restoring force is ' },
            { text: ', where k is the spring constant.' },
          ],
        },
      ],
    }),
    x: 0,
    y: 0,
    width: 360,
    height: 120,
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
    ...partial,
  };
}

describe('text math nodes', () => {
  it('parses inline_math and display_math in rich_text', () => {
    const doc = parseRichTextDocument({
      blocks: [
        {
          type: 'paragraph',
          spans: [
            { text: 'Force ' },
            { type: 'inline_math', latex: 'F=-kx' },
            { text: '.' },
          ],
        },
        { type: 'display_math', latex: 'm\\frac{d^2x}{dt^2}=-kx' },
      ],
    });
    expect(doc.blocks).toHaveLength(2);
    const span = doc.blocks[0]!.spans[1]!;
    expect(isInlineMathSpan(span)).toBe(true);
    if (isInlineMathSpan(span)) {
      expect(span.id).toBeTruthy();
      expect(span.latex).toBe('F=-kx');
    }
    expect(isDisplayMathBlock(doc.blocks[1]!)).toBe(true);
    expect(richTextToPlainText(doc)).toContain('[LaTeX: F=-kx]');
    expect(richTextToPlainText(doc)).toContain('[LaTeX: m\\frac{d^2x}{dt^2}=-kx]');
  });

  it('rejects invalid LaTeX math nodes', () => {
    expect(() =>
      parseRichTextDocument({
        blocks: [
          {
            type: 'paragraph',
            spans: [{ type: 'inline_math', latex: '\\frac{1}{' }],
          },
        ],
      }),
    ).toThrow(/invalid LaTeX/i);
  });

  it('renders KaTeX HTML for inline and display math', () => {
    const doc = parseRichTextDocument({
      blocks: [
        {
          type: 'paragraph',
          spans: [
            { text: 'E = ' },
            { type: 'inline_math', latex: 'F/q' },
          ],
        },
        { type: 'display_math', latex: '\\int_a^b f(x)\\,dx' },
      ],
    });
    const html = richTextToHtml(doc, {
      color: '#1a1a1a',
      fontSize: 16,
      fontFamily: 'Arial',
    });
    expect(html).toContain('data-rt-span="inline_math"');
    expect(html).toContain('data-rt-type="display_math"');
    expect(html).toContain('katex');
    expect(html).not.toContain('create_equation');
  });

  it('inserts inline math after anchor text', () => {
    const el = makeText();
    const next = insertInlineMathInElement(el, 'F=-kx', {
      after_text: 'The restoring force is ',
    });
    expect(next.text).toContain('[LaTeX: F=-kx]');
    const nodes = listMathNodes(next.richText!);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.kind).toBe('inline');
    expect(nodes[0]!.latex).toBe('F=-kx');
  });

  it('inserts display math after a block', () => {
    const el = makeText();
    const next = insertDisplayMathInElement(el, 'm\\frac{d^2x}{dt^2}=-kx', {
      after_block_id: 'block_a',
    });
    expect(next.richText!.blocks.some(isDisplayMathBlock)).toBe(true);
    expect(next.text).toContain('[LaTeX: m\\frac{d^2x}{dt^2}=-kx]');
  });

  it('updates and removes math by id', () => {
    let el = makeText();
    el = insertInlineMathInElement(el, 'F=-kx', {
      after_text: 'The restoring force is ',
    });
    const id = listMathNodes(el.richText!)[0]!.id;
    el = updateTextMathInElement(el, id, 'F=-k x');
    expect(listMathNodes(el.richText!)[0]!.latex).toBe('F=-k x');
    el = removeTextMathFromElement(el, id);
    expect(listMathNodes(el.richText!)).toHaveLength(0);
    expect(el.text).not.toContain('[LaTeX:');
  });

  it('converts inline math to display and back', () => {
    let el = makeText();
    el = insertInlineMathInElement(el, '\\omega=\\sqrt{k/m}', {
      after_text: 'The restoring force is ',
    });
    const id = listMathNodes(el.richText!)[0]!.id;
    el = convertTextMathInElement(el, id, 'display');
    expect(listMathNodes(el.richText!)[0]!.kind).toBe('display');
    el = convertTextMathInElement(el, id, 'inline');
    expect(listMathNodes(el.richText!)[0]!.kind).toBe('inline');
    expect(listMathNodes(el.richText!)[0]!.latex).toBe('\\omega=\\sqrt{k/m}');
  });

  it('refuses ambiguous after_text without occurrence', () => {
    const el = makeText({
      text: 'a and a',
      richText: parseRichTextDocument({
        blocks: [
          {
            type: 'paragraph',
            id: 'b1',
            spans: [{ text: 'a and a' }],
          },
        ],
      }),
    });
    expect(() =>
      insertInlineMathInElement(el, 'x', { after_text: 'a' }),
    ).toThrow(/Ambiguous/);
  });
});
