/**
 * Shared text style patch for update_text_style / create_text.
 * Agent field names → TextElement domain fields.
 */

import type { TextElement } from '../../../types/canvas';

/** Agent-facing style patch — all fields optional (PATCH semantics). */
export interface TextStylePatch {
  text_color?: string;
  /** Hex colour, or null / "transparent" for no fill. */
  background_color?: string | null;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
}

const NAMED_COLORS: Record<string, string> = {
  red: '#FF0000',
  green: '#008000',
  blue: '#0000FF',
  black: '#000000',
  white: '#FFFFFF',
  yellow: '#FFFF00',
  orange: '#FFA500',
  purple: '#800080',
  pink: '#FFC0CB',
  gray: '#808080',
  grey: '#808080',
  cyan: '#00FFFF',
  magenta: '#FF00FF',
  navy: '#000080',
  teal: '#008080',
  maroon: '#800000',
  olive: '#808000',
  lime: '#00FF00',
  aqua: '#00FFFF',
  silver: '#C0C0C0',
  lightblue: '#ADD8E6',
  lightyellow: '#FFFFE0',
  lightgreen: '#90EE90',
  darkblue: '#00008B',
  darkgreen: '#006400',
  darkred: '#8B0000',
};

export type ColorNormalizeError =
  | 'empty'
  | 'unsupported_name'
  | 'invalid_hex'
  | 'invalid_format';

export class ColorNormalizeFailure extends Error {
  readonly code: ColorNormalizeError;
  constructor(code: ColorNormalizeError, message: string) {
    super(message);
    this.name = 'ColorNormalizeFailure';
    this.code = code;
  }
}

/**
 * Normalize a colour to `#RRGGBB` or `#RRGGBBAA`.
 * Accepts hex (with/without #) and a controlled set of CSS colour names.
 */
export function normalizeCssColor(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new ColorNormalizeFailure('empty', 'Colour value cannot be empty.');
  }

  const lower = trimmed.toLowerCase();
  if (lower === 'transparent') {
    // Caller decides transparent handling for backgrounds.
    return 'transparent';
  }

  if (NAMED_COLORS[lower]) {
    return NAMED_COLORS[lower]!;
  }

  let hex = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;
  if (!/^[0-9a-fA-F]+$/.test(hex)) {
    throw new ColorNormalizeFailure(
      'unsupported_name',
      `Unsupported colour "${raw}". Use #RRGGBB or a known name (red, blue, …).`,
    );
  }

  if (hex.length === 3 || hex.length === 4) {
    hex = hex
      .split('')
      .map((c) => c + c)
      .join('');
  }

  if (hex.length !== 6 && hex.length !== 8) {
    throw new ColorNormalizeFailure(
      'invalid_hex',
      `Invalid hex colour "${raw}". Expected #RGB, #RRGGBB, or #RRGGBBAA.`,
    );
  }

  return `#${hex.toUpperCase()}`;
}

/** Normalize background: null / transparent → null; else #RRGGBB(AA). */
export function normalizeBackgroundColor(
  raw: string | null | undefined,
): string | null {
  if (raw === null || raw === undefined) return null;
  const n = normalizeCssColor(String(raw));
  if (n === 'transparent') return null;
  return n;
}

export function isEmptyStylePatch(style: TextStylePatch): boolean {
  return (
    style.text_color === undefined &&
    style.background_color === undefined &&
    style.bold === undefined &&
    style.italic === undefined &&
    style.underline === undefined
  );
}

/** Normalize all supplied fields; throw on invalid values. */
export function normalizeTextStylePatch(raw: TextStylePatch): TextStylePatch {
  const out: TextStylePatch = {};
  if (raw.text_color !== undefined) {
    const c = normalizeCssColor(raw.text_color);
    if (c === 'transparent') {
      throw new ColorNormalizeFailure(
        'invalid_format',
        'text_color cannot be transparent.',
      );
    }
    out.text_color = c;
  }
  if (raw.background_color !== undefined) {
    out.background_color = normalizeBackgroundColor(raw.background_color);
  }
  if (raw.bold !== undefined) {
    if (typeof raw.bold !== 'boolean') {
      throw new ColorNormalizeFailure('invalid_format', 'bold must be a boolean.');
    }
    out.bold = raw.bold;
  }
  if (raw.italic !== undefined) {
    if (typeof raw.italic !== 'boolean') {
      throw new ColorNormalizeFailure('invalid_format', 'italic must be a boolean.');
    }
    out.italic = raw.italic;
  }
  if (raw.underline !== undefined) {
    if (typeof raw.underline !== 'boolean') {
      throw new ColorNormalizeFailure(
        'invalid_format',
        'underline must be a boolean.',
      );
    }
    out.underline = raw.underline;
  }
  return out;
}

/**
 * Apply a normalized patch onto a TextElement.
 * Unspecified fields are preserved. strikethrough is never touched.
 */
export function applyTextStylePatch(
  el: TextElement,
  patch: TextStylePatch,
): TextElement {
  const next: TextElement = { ...el };
  if (patch.text_color !== undefined) {
    next.color = patch.text_color;
  }
  if (patch.background_color !== undefined) {
    next.backgroundColor = patch.background_color;
  }
  if (patch.bold !== undefined) {
    next.fontWeight = patch.bold ? 'bold' : 'normal';
  }
  if (patch.italic !== undefined) {
    next.fontItalic = patch.italic;
  }
  if (patch.underline !== undefined) {
    next.underline = patch.underline;
  }
  return next;
}

/** Human-readable change lines for plan preview / summaries. */
export function describeStylePatch(patch: TextStylePatch): string[] {
  const lines: string[] = [];
  if (patch.text_color !== undefined) {
    lines.push(`Text colour: ${patch.text_color}`);
  }
  if (patch.background_color !== undefined) {
    lines.push(
      `Background: ${patch.background_color === null ? 'transparent' : patch.background_color}`,
    );
  }
  if (patch.bold !== undefined) {
    lines.push(`Bold: ${patch.bold ? 'yes' : 'no'}`);
  }
  if (patch.italic !== undefined) {
    lines.push(`Italic: ${patch.italic ? 'yes' : 'no'}`);
  }
  if (patch.underline !== undefined) {
    lines.push(`Underline: ${patch.underline ? 'yes' : 'no'}`);
  }
  return lines;
}

export function summarizeStylePatch(patch: TextStylePatch): string {
  const parts: string[] = [];
  if (patch.text_color !== undefined) {
    parts.push(`${patch.text_color} text`);
  }
  if (patch.background_color !== undefined) {
    parts.push(
      patch.background_color === null
        ? 'transparent background'
        : `${patch.background_color} background`,
    );
  }
  const flags: string[] = [];
  if (patch.bold === true) flags.push('bold');
  if (patch.bold === false) flags.push('not bold');
  if (patch.italic === true) flags.push('italic');
  if (patch.italic === false) flags.push('not italic');
  if (patch.underline === true) flags.push('underlined');
  if (patch.underline === false) flags.push('not underlined');
  if (flags.length) parts.push(flags.join(', '));

  if (parts.length === 0) return 'style unchanged';
  if (parts.length === 1) return parts[0]!;
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
}
