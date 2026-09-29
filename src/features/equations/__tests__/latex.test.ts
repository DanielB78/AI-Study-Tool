import { describe, expect, it } from 'vitest';
import {
  measureEquationSize,
  sanitizeLatexSource,
  validateLatex,
} from '../latex';

describe('sanitizeLatexSource', () => {
  it('strips $…$ fences', () => {
    expect(sanitizeLatexSource('$E=mc^2$')).toBe('E=mc^2');
  });

  it('strips $$…$$ fences', () => {
    expect(sanitizeLatexSource('$$\\frac{a}{b}$$')).toBe('\\frac{a}{b}');
  });

  it('strips \\[…\\] and \\(…\\)', () => {
    expect(sanitizeLatexSource('\\[x^2\\]')).toBe('x^2');
    expect(sanitizeLatexSource('\\(a+b\\)')).toBe('a+b');
  });

  it('strips markdown latex fences', () => {
    expect(sanitizeLatexSource('```latex\nE=mc^2\n```')).toBe('E=mc^2');
  });

  it('leaves bare latex unchanged', () => {
    expect(sanitizeLatexSource('E=mc^2')).toBe('E=mc^2');
  });
});

describe('validateLatex', () => {
  it('accepts standard equations', () => {
    expect(validateLatex('E=mc^2').ok).toBe(true);
    expect(validateLatex('\\nabla \\cdot \\mathbf{E} = \\frac{\\rho}{\\varepsilon_0}').ok).toBe(
      true,
    );
    expect(
      validateLatex('i\\hbar\\frac{\\partial}{\\partial t}\\Psi=\\hat{H}\\Psi').ok,
    ).toBe(true);
    expect(
      validateLatex(
        '\\oint_S \\mathbf{E}\\cdot d\\mathbf{A} = \\frac{Q_{\\mathrm{enc}}}{\\varepsilon_0}',
      ).ok,
    ).toBe(true);
  });

  it('rejects empty latex', () => {
    const r = validateLatex('   ');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/empty/i);
  });

  it('rejects invalid latex', () => {
    const r = validateLatex('\\frac{1{2}');
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
  });

  it('sanitizes fences before validating', () => {
    expect(validateLatex('$E=mc^2$').ok).toBe(true);
  });
});

describe('measureEquationSize', () => {
  it('returns positive dimensions (node heuristic)', () => {
    const size = measureEquationSize('E=mc^2', { fontSize: 28 });
    expect(size.width).toBeGreaterThan(0);
    expect(size.height).toBeGreaterThan(0);
  });
});
