import { describe, expect, it } from 'vitest';
import {
  plainTextToRichText,
  richTextToPlainText,
  resolveRichTextColor,
  resolveRichTextFontSize,
} from '../richText';
import { parseRichTextDocument, RichTextParseError } from '../richTextValidate';
import { measureRichTextHeight, richTextToHtml } from '../richTextHtml';

describe('rich text', () => {
  it('parses formatted document with mixed spans and lists', () => {
    const doc = parseRichTextDocument({
      blocks: [
        {
          type: 'heading',
          spans: [{ text: "Gauss's Law", style: { bold: true, font_size: 'heading', color: 'blue' } }],
        },
        {
          type: 'paragraph',
          spans: [
            { text: "Gauss's law", style: { bold: true, highlight_color: 'default' } },
            { text: ' relates flux.' },
          ],
        },
        { type: 'bullet', spans: [{ text: 'Closed surface' }] },
        { type: 'numbered', spans: [{ text: 'Step one' }] },
      ],
    });
    expect(doc.blocks).toHaveLength(4);
    expect(richTextToPlainText(doc)).toContain("Gauss's Law");
    expect(richTextToPlainText(doc)).toContain('Closed surface');
    expect(richTextToPlainText(doc)).not.toContain('#2563EB');
  });

  it('rejects unsupported block types', () => {
    expect(() =>
      parseRichTextDocument({
        blocks: [{ type: 'widget', spans: [{ text: 'x' }] }],
      }),
    ).toThrow(RichTextParseError);
  });

  it('accepts display_math blocks and inline_math spans', () => {
    const doc = parseRichTextDocument({
      blocks: [
        {
          type: 'paragraph',
          spans: [
            { text: 'Field ' },
            { type: 'inline_math', latex: 'E=F/q' },
          ],
        },
        { type: 'display_math', latex: '\\nabla\\cdot\\mathbf{E}' },
      ],
    });
    expect(doc.blocks[1]!.type).toBe('display_math');
    expect(richTextToPlainText(doc)).toContain('[LaTeX: E=F/q]');
  });

  it('legacy plain text round-trips', () => {
    const doc = plainTextToRichText('Hello\nWorld');
    expect(richTextToPlainText(doc)).toBe('Hello\nWorld');
  });

  it('resolves palette and hex colours safely', () => {
    expect(resolveRichTextColor('blue', 'text', '#000')).toBe('#2563EB');
    expect(resolveRichTextColor('#abc', 'text', '#000')).toBe('#AABBCC');
    expect(resolveRichTextColor('not-a-color', 'text', '#111')).toBe('#111');
  });

  it('caps font sizes', () => {
    expect(resolveRichTextFontSize('heading', 16)).toBe(22);
    expect(resolveRichTextFontSize(999, 16)).toBe(48);
    expect(resolveRichTextFontSize(2, 16)).toBe(10);
  });

  it('renders HTML with bold/highlight without injecting raw JSON', () => {
    const doc = parseRichTextDocument({
      blocks: [
        {
          type: 'paragraph',
          spans: [{ text: 'Key', style: { bold: true, highlight_color: 'default' } }],
        },
      ],
    });
    const html = richTextToHtml(doc, {
      color: '#1a1a1a',
      fontSize: 16,
      fontFamily: 'Arial',
    });
    expect(html).toContain('font-weight:700');
    expect(html).toContain('background-color');
    expect(html).toContain('Key');
    expect(html).not.toContain('rich_text');
  });

  it('measures rich text taller than short plain equivalent for headings', () => {
    const heading = parseRichTextDocument({
      blocks: [
        {
          type: 'heading',
          spans: [{ text: 'Title', style: { font_size: 'heading_large' } }],
        },
        {
          type: 'paragraph',
          spans: [
            {
              text: 'A reasonably long explanation that will wrap across a few lines when constrained.',
            },
          ],
        },
        { type: 'bullet', spans: [{ text: 'Point A' }] },
        { type: 'bullet', spans: [{ text: 'Point B' }] },
      ],
    });
    const h = measureRichTextHeight(heading, 360, {
      color: '#111',
      fontSize: 16,
      fontFamily: 'Arial',
      padding: 12,
    });
    expect(h).toBeGreaterThan(80);
  });
});
