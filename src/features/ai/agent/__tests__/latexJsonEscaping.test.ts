import { describe, expect, it } from 'vitest';
import {
  detectSilentLatexJsonCorruption,
  explainJsonParseFailure,
  isLikelyLatexJsonEscapeIssue,
  LATEX_JSON_ESCAPE_HINT,
} from '../latexJsonEscaping';
import { parseCanvasAgentResponse, CanvasAgentParseError } from '../parser';

const ctx = {
  allowedElementIds: new Set<string>(['eq_1']),
  elementTypes: new Map<string, string>([['eq_1', 'equation']]),
};

describe('latex JSON escaping diagnostics', () => {
  it('flags hard-fail escapes like \\hbar in raw paste', () => {
    const raw = `{"operations":[{"type":"create_equation","latex":"i\\hbar\\psi","placement":{"mode":"viewport_default"}}]}`;
    expect(() => JSON.parse(raw)).toThrow();
    let caught: unknown;
    try {
      JSON.parse(raw);
    } catch (e) {
      caught = e;
    }
    const explained = explainJsonParseFailure(raw, caught);
    expect(explained.likelyLatexEscape).toBe(true);
    expect(explained.message).toBe(LATEX_JSON_ESCAPE_HINT);
    expect(explained.detail.length).toBeGreaterThan(0);
  });

  it('parseCanvasAgentResponse surfaces LaTeX escape hint for \\hbar', () => {
    const raw = `{"operations":[{"type":"create_equation","latex":"i\\hbar\\psi","placement":{"mode":"viewport_default"}}]}`;
    try {
      parseCanvasAgentResponse(raw, ctx);
      expect.unreachable('should throw');
    } catch (err) {
      expect(err).toBeInstanceOf(CanvasAgentParseError);
      const e = err as CanvasAgentParseError;
      expect(e.code).toBe('invalid_json');
      expect(e.message).toContain('unescaped backslash');
      expect(e.message).toContain('\\\\frac');
      expect(e.detail).toBeTruthy();
    }
  });

  it('accepts correctly double-escaped LaTeX JSON', () => {
    const raw = JSON.stringify({
      operations: [
        {
          type: 'create_equation',
          latex: 'E=\\frac{1}{2}mv^2',
          placement: { mode: 'viewport_default' },
        },
      ],
    });
    const parsed = parseCanvasAgentResponse(raw, ctx);
    expect(parsed.operations[0]).toMatchObject({
      type: 'create_equation',
      latex: 'E=\\frac{1}{2}mv^2',
    });
  });

  it('detects silent \\frac → form-feed corruption after JSON.parse', () => {
    // Simulate what JSON.parse does to an unescaped \frac in a JSON string.
    const corrupted = JSON.parse('"\\frac{a}{b}"') as string;
    expect(corrupted.charCodeAt(0)).toBe(0x0c); // form feed
    const msg = detectSilentLatexJsonCorruption(corrupted);
    expect(msg).toBeTruthy();
    expect(msg!).toMatch(/\\\\frac|form-feed|JSON/i);
  });

  it('detects silent \\nabla → newline corruption', () => {
    // Only \\nabla (\\n → newline); avoid \\cdot which is a hard JSON failure.
    const corrupted = JSON.parse('"\\nabla E"') as string;
    expect(corrupted.startsWith('\n')).toBe(true);
    expect(detectSilentLatexJsonCorruption(corrupted)).toMatch(/nabla|newline|JSON/i);
  });

  it('detects silent \\times → tab corruption', () => {
    const corrupted = JSON.parse('"\\times"') as string;
    expect(corrupted.charCodeAt(0)).toBe(0x09);
    expect(detectSilentLatexJsonCorruption(corrupted)).toMatch(/times|tab|JSON/i);
  });

  it('rejects corrupted latex via requireValidLatex path', () => {
    // Build ops object as if JSON.parse already succeeded with corruption.
    const corruptedLatex = JSON.parse('"\\frac{a}{b}"') as string;
    const raw = JSON.stringify({
      operations: [
        {
          type: 'update_equation',
          target_element_id: 'eq_1',
          latex: corruptedLatex,
        },
      ],
    });
    expect(() => parseCanvasAgentResponse(raw, ctx)).toThrow(CanvasAgentParseError);
    try {
      parseCanvasAgentResponse(raw, ctx);
    } catch (err) {
      const e = err as CanvasAgentParseError;
      expect(e.code).toBe('invalid_latex');
      expect(e.message).toMatch(/\\\\frac|JSON|corrupted/i);
    }
  });

  it('does not flag unrelated JSON errors as latex escapes', () => {
    const raw = '{ not json';
    expect(isLikelyLatexJsonEscapeIssue(raw, 'Unexpected token')).toBe(false);
  });
});
