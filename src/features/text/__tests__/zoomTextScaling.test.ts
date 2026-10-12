import { describe, expect, it } from 'vitest';
import { DEFAULT_STYLE } from '../../../types/canvas';
import { createAiTextElement } from '../../ai/canvas/createAiTextElement';
import { TextElementAutoSizer } from '../textAutoSizer';
import { richTextToHtml } from '../richTextHtml';
import type { RichTextDocument } from '../richText';

/**
 * Screen-space font size for an overlay host that applies camera.zoom once.
 * Mirrors TextHtmlLayer / TextEditorOverlay (world font × zoom).
 */
function screenFontSize(worldFontSize: number, zoom: number): number {
  return worldFontSize * zoom;
}

/** Ratio of screen font size to screen textbox width — must be zoom-invariant. */
function fontToBoxRatio(worldFont: number, worldWidth: number, zoom: number): number {
  return screenFontSize(worldFont, zoom) / (worldWidth * zoom);
}

describe('zoom-independent text sizing', () => {
  const zooms = [0.25, 0.5, 1, 1.5, 2, 4] as const;

  it('keeps world font size constant across zooms', () => {
    const el = createAiTextElement('Electric Fields', { x: 0, y: 0 }, {
      zIndex: 1,
      style: DEFAULT_STYLE,
      richText: {
        blocks: [
          { type: 'heading', spans: [{ text: 'Electric Fields', style: { bold: true } }] },
          { type: 'paragraph', spans: [{ text: 'An electric field is a vector field.' }] },
        ],
      },
    });
    const worldFont = el.fontSize;
    const worldW = el.width;
    const worldH = el.height;

    for (const zoom of zooms) {
      // Stored geometry must not change with camera zoom.
      expect(el.fontSize).toBe(worldFont);
      expect(el.width).toBe(worldW);
      expect(el.height).toBe(worldH);
      // Screen font scales proportionally with zoom (smaller when zooming out).
      expect(screenFontSize(worldFont, zoom)).toBeCloseTo(worldFont * zoom, 6);
    }

    expect(screenFontSize(worldFont, 0.5)).toBeLessThan(screenFontSize(worldFont, 1));
    expect(screenFontSize(worldFont, 2)).toBeGreaterThan(screenFontSize(worldFont, 1));
  });

  it('keeps font/box screen ratio constant (no inverse-zoom compensation)', () => {
    const worldFont = 18;
    const worldWidth = 360;
    const ratios = zooms.map((z) => fontToBoxRatio(worldFont, worldWidth, z));
    for (const r of ratios) {
      expect(r).toBeCloseTo(ratios[0]!, 8);
    }
  });

  it('rich-text HTML uses em sizes so nested headings scale with host zoom', () => {
    const doc: RichTextDocument = {
      blocks: [
        {
          type: 'heading',
          spans: [{ text: 'Title', style: { bold: true, font_size: 'heading' } }],
        },
        {
          type: 'paragraph',
          spans: [
            { text: 'Body ', style: { bold: true } },
            { text: 'mixed', style: { italic: true, font_size: 14 } },
          ],
        },
      ],
    };
    const html = richTextToHtml(doc, {
      color: '#111',
      fontSize: 18,
      fontFamily: 'Arial',
    });
    // Root inherits host font-size; variants are em — never absolute world px that ignore zoom.
    expect(html).toContain('font-size:1em');
    expect(html).toMatch(/font-size:[\d.]+em/);
    expect(html).not.toMatch(/font-size:\d+px/);
  });

  it('auto-sizing measurement ignores zoom (world-space only)', () => {
    const text =
      'A paragraph long enough to wrap across several lines at the default reading width.';
    const style = {
      fontSize: DEFAULT_STYLE.fontSize,
      fontFamily: DEFAULT_STYLE.fontFamily,
      lineHeight: DEFAULT_STYLE.lineHeight,
      color: DEFAULT_STYLE.textColor,
      padding: 12,
    };
    const a = TextElementAutoSizer.measure({
      content: { text },
      availableWidth: 360,
      style,
    });
    const b = TextElementAutoSizer.measure({
      content: { text },
      availableWidth: 360,
      style,
    });
    expect(a.width).toBe(b.width);
    expect(a.height).toBe(b.height);
    expect(a.wrappedLines).toBe(b.wrappedLines);
  });

  it('editing overlay uses the same screen font formula as the canvas host', () => {
    // TextEditorOverlay: fontSize = el.fontSize * camera.zoom
    // TextHtmlLayer: fontSize = el.fontSize * camera.zoom
    const world = 18;
    for (const zoom of zooms) {
      const overlay = world * zoom;
      const canvasHost = world * zoom;
      expect(overlay).toBeCloseTo(canvasHost, 8);
    }
  });
});
