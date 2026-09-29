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

  it('parseCanvasAgentResponse recovers unescaped \\hbar via repair', () => {
    const raw = `{"operations":[{"type":"create_equation","latex":"i\\hbar\\psi","placement":{"mode":"viewport_default"}}]}`;
    const { response, repair } = parseCanvasAgentResponse(raw, ctx);
    expect(repair.applied).toBe(true);
    expect(response.operations[0]).toMatchObject({
      type: 'create_equation',
      latex: 'i\\hbar\\psi',
    });
  });

  it('accepts correctly double-escaped LaTeX JSON without repair', () => {
    const raw = JSON.stringify({
      operations: [
        {
          type: 'create_equation',
          latex: 'E=\\frac{1}{2}mv^2',
          placement: { mode: 'viewport_default' },
        },
      ],
    });
    const { response, repair } = parseCanvasAgentResponse(raw, ctx);
    expect(repair.applied).toBe(false);
    expect(response.operations[0]).toMatchObject({
      type: 'create_equation',
      latex: 'E=\\frac{1}{2}mv^2',
    });
  });

  it('detects silent \\frac → form-feed corruption after JSON.parse', () => {
    const corrupted = JSON.parse('"\\frac{a}{b}"') as string;
    expect(corrupted.charCodeAt(0)).toBe(0x0c); // form feed
    const msg = detectSilentLatexJsonCorruption(corrupted);
    expect(msg).toBeTruthy();
    expect(msg!).toMatch(/\\\\frac|form-feed|JSON/i);
  });

  it('detects silent \\nabla → newline corruption', () => {
    const corrupted = JSON.parse('"\\nabla E"') as string;
    expect(corrupted.startsWith('\n')).toBe(true);
    expect(detectSilentLatexJsonCorruption(corrupted)).toMatch(/nabla|newline|JSON/i);
  });

  it('detects silent \\times → tab corruption', () => {
    const corrupted = JSON.parse('"\\times"') as string;
    expect(corrupted.charCodeAt(0)).toBe(0x09);
    expect(detectSilentLatexJsonCorruption(corrupted)).toMatch(/times|tab|JSON/i);
  });

  it('fails closed when latex already contains literal control chars (unrecoverable)', () => {
    // Literal form-feed inside the JSON string (not the two-char sequence \ f).
    // JSON.parse rejects this; repair cannot invent missing backslashes.
    const raw =
      '{"operations":[{"type":"update_equation","target_element_id":"eq_1","latex":"' +
      '\f' +
      'rac{a}{b}"}]}';
    expect(() => parseCanvasAgentResponse(raw, ctx)).toThrow(CanvasAgentParseError);
    try {
      parseCanvasAgentResponse(raw, ctx);
    } catch (err) {
      const e = err as CanvasAgentParseError;
      expect(e.code).toBe('invalid_json');
      expect(e.message).toMatch(/Could not parse the LLM response as structured JSON/i);
      expect(e.detail).toMatch(/RAW RESPONSE|REPAIRED/i);
    }
  });

  it('recovers when JSON.stringify re-encoded silent corruption as \\f', () => {
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
    const { response, repair } = parseCanvasAgentResponse(raw, ctx);
    expect(repair.applied).toBe(true);
    expect(response.operations[0]).toMatchObject({ latex: '\\frac{a}{b}' });
  });

  it('does not flag unrelated JSON errors as latex escapes', () => {
    const raw = '{ not json';
    expect(isLikelyLatexJsonEscapeIssue(raw, 'Unexpected token')).toBe(false);
  });
});
