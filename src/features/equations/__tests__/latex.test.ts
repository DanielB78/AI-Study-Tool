import { describe, expect, it } from 'vitest';
import {
  repairLatexForKatex,
  sanitizeLatexSource,
  validateLatex,
} from '../latex';

/** User-reported Lorentz interval equation that previously failed KaTeX. */
const LORENTZ_INTERVAL = String.raw`\begin{aligned}c^2t'^2-x'^2&=\gamma^2\left[\left(ct-\frac{vx}{c}\right)^2-(x-vt)^2\right]\\&=\gamma^2\left(1-\frac{v^2}{c^2}\right)(c^2t^2-x^2)\\&=c^2t^2-x^2\\[5pt]\boxed{c^2t'^2-x'^2-y'^2-z'^2&=c^2t^2-x^2-y^2-z^2}\end{aligned}`;

describe('repairLatexForKatex', () => {
  it('strips alignment & inside \\boxed without nested aligned', () => {
    const repaired = repairLatexForKatex(
      String.raw`\boxed{c^2t'^2-x'^2-y'^2-z'^2&=c^2t^2-x^2-y^2-z^2}`,
    );
    expect(repaired).toBe(
      String.raw`\boxed{c^2t'^2-x'^2-y'^2-z'^2=c^2t^2-x^2-y^2-z^2}`,
    );
  });

  it('preserves & inside \\boxed{\\begin{aligned}…}', () => {
    const src = String.raw`\boxed{\begin{aligned}x'&=\gamma(x-vt)\\t'&=\gamma\left(t-\frac{vx}{c^2}\right)\end{aligned}}`;
    expect(repairLatexForKatex(src)).toBe(src);
  });

  it('preserves literal \\& inside boxed', () => {
    expect(repairLatexForKatex(String.raw`\boxed{A\&B=C}`)).toBe(
      String.raw`\boxed{A\&B=C}`,
    );
  });

  it('repairs nested boxed inside outer aligned', () => {
    const repaired = repairLatexForKatex(LORENTZ_INTERVAL);
    expect(repaired).toContain(
      String.raw`\boxed{c^2t'^2-x'^2-y'^2-z'^2=c^2t^2-x^2-y^2-z^2}`,
    );
    expect(repaired).toContain(String.raw`c^2t'^2-x'^2&=\gamma^2`);
  });
});

describe('sanitizeLatexSource + validateLatex', () => {
  it('accepts the Lorentz interval create_equation latex after repair', () => {
    const cleaned = sanitizeLatexSource(LORENTZ_INTERVAL);
    expect(cleaned).not.toContain(
      String.raw`\boxed{c^2t'^2-x'^2-y'^2-z'^2&=`,
    );
    const check = validateLatex(LORENTZ_INTERVAL, true);
    expect(check.ok).toBe(true);
    expect(check.error).toBeNull();
  });

  it('still validates normal aligned equations', () => {
    const latex =
      '\\begin{aligned}F&=-kx\\\\m\\ddot{x}&=-kx\\\\\\ddot{x}+\\frac{k}{m}x&=0\\end{aligned}';
    expect(validateLatex(latex, true).ok).toBe(true);
  });

  it('strips $$ fences then repairs boxed &', () => {
    const raw =
      '$$\\boxed{E&=mc^2}$$';
    expect(sanitizeLatexSource(raw)).toBe('\\boxed{E=mc^2}');
    expect(validateLatex(raw, true).ok).toBe(true);
  });
});
