import { describe, expect, it } from 'vitest';
import type { TextElement } from '../../../../types/canvas';
import {
  applyTextStylePatch,
  ColorNormalizeFailure,
  normalizeCssColor,
  normalizeTextStylePatch,
  summarizeStylePatch,
} from '../textStyle';

function baseText(overrides: Partial<TextElement> = {}): TextElement {
  return {
    id: 'textbox_1',
    type: 'text',
    x: 0,
    y: 0,
    width: 200,
    height: 80,
    rotation: 0,
    zIndex: 1,
    opacity: 1,
    locked: false,
    createdAt: 1,
    updatedAt: 1,
    metadata: {},
    text: 'Hello',
    fontSize: 16,
    fontFamily: 'sans',
    fontWeight: 'normal',
    fontItalic: false,
    underline: false,
    strikethrough: true,
    color: '#111111',
    alignment: 'left',
    lineHeight: 1.3,
    backgroundColor: '#FFFFFF',
    padding: 12,
    cornerRadius: 8,
    ...overrides,
  };
}

describe('normalizeCssColor', () => {
  it('normalizes hex with and without #', () => {
    expect(normalizeCssColor('#00ff00')).toBe('#00FF00');
    expect(normalizeCssColor('00ff00')).toBe('#00FF00');
  });

  it('expands short hex', () => {
    expect(normalizeCssColor('#0f8')).toBe('#00FF88');
  });

  it('maps named colours', () => {
    expect(normalizeCssColor('blue')).toBe('#0000FF');
    expect(normalizeCssColor('Yellow')).toBe('#FFFF00');
  });

  it('rejects unsupported names', () => {
    expect(() => normalizeCssColor('chartreuse')).toThrow(ColorNormalizeFailure);
  });

  it('rejects empty', () => {
    expect(() => normalizeCssColor('  ')).toThrow(ColorNormalizeFailure);
  });
});

describe('normalizeTextStylePatch', () => {
  it('normalizes partial colour patches', () => {
    expect(normalizeTextStylePatch({ text_color: 'red' })).toEqual({
      text_color: '#FF0000',
    });
    expect(normalizeTextStylePatch({ background_color: 'transparent' })).toEqual({
      background_color: null,
    });
    expect(normalizeTextStylePatch({ background_color: null })).toEqual({
      background_color: null,
    });
  });

  it('rejects transparent text_color', () => {
    expect(() => normalizeTextStylePatch({ text_color: 'transparent' })).toThrow(
      ColorNormalizeFailure,
    );
  });
});

describe('applyTextStylePatch', () => {
  it('applies partial patches and preserves strikethrough', () => {
    const el = baseText({ strikethrough: true, underline: false });
    const next = applyTextStylePatch(el, {
      text_color: '#0000FF',
      bold: true,
      underline: true,
    });
    expect(next.color).toBe('#0000FF');
    expect(next.fontWeight).toBe('bold');
    expect(next.underline).toBe(true);
    expect(next.strikethrough).toBe(true);
    expect(next.backgroundColor).toBe('#FFFFFF');
    expect(next.fontItalic).toBe(false);
    expect(next.text).toBe('Hello');
  });

  it('clears background with null and can turn bold off', () => {
    const el = baseText({ fontWeight: 'bold', backgroundColor: '#FFFF00' });
    const next = applyTextStylePatch(el, {
      background_color: null,
      bold: false,
      italic: true,
    });
    expect(next.backgroundColor).toBeNull();
    expect(next.fontWeight).toBe('normal');
    expect(next.fontItalic).toBe(true);
    expect(next.strikethrough).toBe(true);
  });
});

describe('summarizeStylePatch', () => {
  it('joins colour and flags', () => {
    expect(summarizeStylePatch({ text_color: '#0000FF', bold: true })).toBe(
      '#0000FF text and bold',
    );
  });
});
