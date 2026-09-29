import { describe, expect, it } from 'vitest';
import {
  LATEX_JSON_REPAIR_INDICATOR,
  repairLatexJsonFields,
} from '../latexJsonRepair';
import { parseCanvasAgentResponse } from '../parser';

const ctx = {
  allowedElementIds: new Set<string>(['nvcJ81jsnKNc', 'eq_1', 'textbox_1']),
  elementTypes: new Map<string, string>([
    ['nvcJ81jsnKNc', 'text'],
    ['eq_1', 'equation'],
    ['textbox_1', 'text'],
  ]),
};

/** Build a raw JSON document with intentional single-backslash LaTeX (malformed). */
function rawWithSingleBackslashLatex(latexSource: string, placement = { mode: 'viewport_default' }): string {
  // latexSource uses real single backslashes, e.g. \frac{a}{b}
  const latexJson = JSON.stringify(latexSource); // correctly escaped
  // Strip one level of escaping to simulate LLM mistake: turn \\ into \
  const malformedLatexLiteral = latexJson.slice(1, -1).replace(/\\\\/g, '\\');
  return `{"operations":[{"type":"create_equation","latex":"${malformedLatexLiteral}","placement":${JSON.stringify(placement)}}]}`;
}

describe('repairLatexJsonFields state machine', () => {
  it('doubles single backslashes inside latex only', () => {
    const raw = '{"operations":[{"type":"create_equation","latex":"\\frac{a}{b}","placement":{"mode":"viewport_default"}}]}';
    // In JS source above, \\frac is one backslash + frac in the raw string.
    expect(raw.includes('\\frac')).toBe(true);
    const { repaired, changed, repairCount } = repairLatexJsonFields(raw);
    expect(changed).toBe(true);
    expect(repairCount).toBeGreaterThan(0);
    expect(JSON.parse(repaired).operations[0].latex).toBe('\\frac{a}{b}');
  });

  it('does not double already-correct \\\\ pairs', () => {
    const raw = JSON.stringify({
      operations: [
        {
          type: 'create_equation',
          latex: '\\frac{a}{b}',
          placement: { mode: 'viewport_default' },
        },
      ],
    });
    const { repaired, changed } = repairLatexJsonFields(raw);
    expect(changed).toBe(false);
    expect(repaired).toBe(raw);
    expect(JSON.parse(repaired).operations[0].latex).toBe('\\frac{a}{b}');
  });

  it('does not modify text fields', () => {
    const raw =
      '{"operations":[{"type":"create_text","text":"Line one\\nLine two","placement":{"mode":"viewport_default"}},' +
      '{"type":"create_equation","latex":"\\oint","placement":{"mode":"viewport_default"}}]}';
    const { repaired } = repairLatexJsonFields(raw);
    const parsed = JSON.parse(repaired);
    expect(parsed.operations[0].text).toBe('Line one\nLine two');
    expect(parsed.operations[1].latex).toBe('\\oint');
  });
});

describe('parseCanvasAgentResponse latex repair recovery', () => {
  it('TEST 15 — single backslash frac recovers to \\frac{a}{b}', () => {
    const raw = rawWithSingleBackslashLatex('\\frac{a}{b}');
    const { response, repair } = parseCanvasAgentResponse(raw, ctx);
    expect(repair.applied).toBe(true);
    expect(repair.message).toBe(LATEX_JSON_REPAIR_INDICATOR);
    expect(response.operations[0]).toMatchObject({
      type: 'create_equation',
      latex: '\\frac{a}{b}',
    });
    expect(response.operations[0]!.type === 'create_equation' && !response.operations[0].latex.includes('\f')).toBe(true);
  });

  it('TEST 16 — mathbf must not contain backspace', () => {
    const raw = rawWithSingleBackslashLatex('\\mathbf{E}');
    const { response, repair } = parseCanvasAgentResponse(raw, ctx);
    expect(repair.applied).toBe(true);
    const latex = (response.operations[0] as { latex: string }).latex;
    expect(latex).toBe('\\mathbf{E}');
    expect(latex.includes('\b')).toBe(false);
  });

  it('TEST 17 — nabla must not contain newline', () => {
    const raw = rawWithSingleBackslashLatex('\\nabla\\cdot\\mathbf{E}');
    const { response, repair } = parseCanvasAgentResponse(raw, ctx);
    expect(repair.applied).toBe(true);
    const latex = (response.operations[0] as { latex: string }).latex;
    expect(latex).toBe('\\nabla\\cdot\\mathbf{E}');
    expect(latex.includes('\n')).toBe(false);
    expect(latex.includes('\b')).toBe(false);
  });

  it('TEST 18 — theta must not contain tab', () => {
    const raw = rawWithSingleBackslashLatex('EA\\cos\\theta');
    const { response, repair } = parseCanvasAgentResponse(raw, ctx);
    expect(repair.applied).toBe(true);
    const latex = (response.operations[0] as { latex: string }).latex;
    expect(latex).toBe('EA\\cos\\theta');
    expect(latex.includes('\t')).toBe(false);
  });

  it('TEST 19 — already correct JSON is preserved (no double escape)', () => {
    const raw = JSON.stringify({
      operations: [
        {
          type: 'create_equation',
          latex: '\\frac{a}{b}',
          placement: { mode: 'viewport_default' },
        },
      ],
    });
    const { response, repair } = parseCanvasAgentResponse(raw, ctx);
    expect(repair.applied).toBe(false);
    expect(repair.repairedResponse).toBeNull();
    expect(response.operations[0]).toMatchObject({ latex: '\\frac{a}{b}' });
  });

  it('TEST 20 — mixed ops repair only latex, leave text untouched', () => {
    // text keeps a real JSON newline escape; latex is malformed single-backslash.
    const textPart = JSON.stringify({
      type: 'create_text',
      text: "Gauss's law",
      placement: { mode: 'viewport_default' },
    });
    const eqLatex = '\\oint \\mathbf{E}\\cdot d\\mathbf{A}=\\frac{Q_{\\mathrm{enc}}}{\\varepsilon_0}';
    const malformedLatex = JSON.stringify(eqLatex).slice(1, -1).replace(/\\\\/g, '\\');
    const raw =
      `{"operations":[${textPart},` +
      `{"type":"create_equation","latex":"${malformedLatex}","placement":{"mode":"viewport_default"}}]}`;

    const { response, repair } = parseCanvasAgentResponse(raw, ctx);
    expect(repair.applied).toBe(true);
    expect(response.operations[0]).toMatchObject({
      type: 'create_text',
      text: "Gauss's law",
    });
    expect(response.operations[1]).toMatchObject({
      type: 'create_equation',
      latex: eqLatex,
    });
  });

  it('TEST 21 — actual failure fixture with mathbf/frac/nabla/theta', () => {
    const equations = [
      '\\mathbf{E}=\\frac{\\mathbf{F}}{q}',
      '\\mathbf{E}=-\\nabla V',
      '\\Phi_E=EA\\cos\\theta',
    ];
    const ops = equations.map((latex, i) => {
      const malformed = JSON.stringify(latex).slice(1, -1).replace(/\\\\/g, '\\');
      const placement =
        i === 0
          ? {
              mode: 'relative_to_element',
              relation: 'below',
              anchor_element_id: 'nvcJ81jsnKNc',
            }
          : {
              mode: 'relative_to_element',
              relation: 'below',
              anchor_operation_index: i - 1,
            };
      return `{"type":"create_equation","latex":"${malformed}","placement":${JSON.stringify(placement)}}`;
    });
    const raw = `{"operations":[${ops.join(',')}]}`;

    const { response, repair } = parseCanvasAgentResponse(raw, ctx);
    expect(repair.applied).toBe(true);
    expect(repair.message).toBe(LATEX_JSON_REPAIR_INDICATOR);
    const latexes = response.operations.map((op) => (op as { latex: string }).latex);
    expect(latexes).toEqual(equations);
    for (const latex of latexes) {
      expect(/[\u0000-\u001f]/.test(latex)).toBe(false);
    }
  });

  it('malformed and correctly escaped inputs produce the same latex', () => {
    const good = JSON.stringify({
      operations: [
        {
          type: 'create_equation',
          latex: '\\nabla\\cdot\\mathbf{E}',
          placement: { mode: 'viewport_default' },
        },
      ],
    });
    const bad = rawWithSingleBackslashLatex('\\nabla\\cdot\\mathbf{E}');
    const a = parseCanvasAgentResponse(good, ctx).response.operations[0] as { latex: string };
    const b = parseCanvasAgentResponse(bad, ctx).response.operations[0] as { latex: string };
    expect(a.latex).toBe(b.latex);
    expect(a.latex).toBe('\\nabla\\cdot\\mathbf{E}');
  });
});
