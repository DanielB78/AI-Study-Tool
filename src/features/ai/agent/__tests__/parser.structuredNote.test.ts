import { describe, expect, it } from 'vitest';
import { createConceptSummaryStructure } from '../../../structures/factory';
import {
  CanvasAgentParseError,
  describeOperationPlan,
  parseCanvasAgentResponse,
} from '../parser';

const structure = createConceptSummaryStructure();

const ctx = {
  allowedElementIds: new Set(['textbox_18']),
  elementTypes: new Map([['textbox_18', 'text']]),
  selectedStructure: structure,
};

const validResponse = {
  operations: [
    {
      type: 'create_structured_note',
      structure_id: structure.id,
      fields: {
        title: { content: "Gauss's Law" },
        explanation: {
          content:
            "Gauss's law relates the electric flux through a closed surface to the enclosed charge.",
        },
        equation: {
          latex:
            '\\oint_S \\mathbf{E}\\cdot d\\mathbf{A}=\\frac{Q_{\\mathrm{enc}}}{\\varepsilon_0}',
        },
        example: {
          content: 'For a spherical charge distribution the field is radial and constant on the surface.',
        },
      },
      placement: { mode: 'viewport_default' },
    },
  ],
};

describe('create_structured_note parsing', () => {
  it('accepts a valid structured note when structure is selected', () => {
    const parsed = parseCanvasAgentResponse(JSON.stringify(validResponse), ctx);
    expect(parsed.operations).toHaveLength(1);
    expect(parsed.operations[0]!.type).toBe('create_structured_note');
  });

  it('rejects create_structured_note when No Structure is selected', () => {
    expect(() =>
      parseCanvasAgentResponse(JSON.stringify(validResponse), {
        ...ctx,
        selectedStructure: null,
      }),
    ).toThrow(CanvasAgentParseError);
    try {
      parseCanvasAgentResponse(JSON.stringify(validResponse), {
        ...ctx,
        selectedStructure: null,
      });
    } catch (err) {
      expect(err).toBeInstanceOf(CanvasAgentParseError);
      expect((err as CanvasAgentParseError).code).toBe('structure_not_selected');
    }
  });

  it('rejects mismatched structure_id', () => {
    const bad = structuredClone(validResponse);
    bad.operations[0]!.structure_id = 'structure_other';
    expect(() => parseCanvasAgentResponse(JSON.stringify(bad), ctx)).toThrow(
      /does not match/,
    );
  });

  it('rejects unknown fields', () => {
    const bad = structuredClone(validResponse);
    (bad.operations[0]!.fields as Record<string, unknown>).bogus = {
      content: 'nope',
    };
    expect(() => parseCanvasAgentResponse(JSON.stringify(bad), ctx)).toThrow(
      /Unknown structure field/,
    );
  });

  it('rejects missing required fields', () => {
    const bad = structuredClone(validResponse);
    delete (bad.operations[0]!.fields as Record<string, unknown>).title;
    expect(() => parseCanvasAgentResponse(JSON.stringify(bad), ctx)).toThrow(
      /Required field/,
    );
  });

  it('allows omitting optional fields', () => {
    const ok = structuredClone(validResponse);
    delete (ok.operations[0]!.fields as Record<string, unknown>).equation;
    delete (ok.operations[0]!.fields as Record<string, unknown>).example;
    const parsed = parseCanvasAgentResponse(JSON.stringify(ok), ctx);
    expect(parsed.operations[0]!.type).toBe('create_structured_note');
  });

  it('rejects wrong payload type for TEXT / EQUATION', () => {
    const badText = structuredClone(validResponse);
    (badText.operations[0]!.fields as Record<string, unknown>).title = {
      latex: 'E=mc^2',
    };
    expect(() => parseCanvasAgentResponse(JSON.stringify(badText), ctx)).toThrow(
      /TEXT/,
    );

    const badEq = structuredClone(validResponse);
    (badEq.operations[0]!.fields as Record<string, unknown>).equation = {
      content: 'not latex',
    };
    expect(() => parseCanvasAgentResponse(JSON.stringify(badEq), ctx)).toThrow(
      /EQUATION/,
    );
  });

  it('rejects invalid LaTeX', () => {
    const bad = structuredClone(validResponse);
    (bad.operations[0]!.fields as Record<string, unknown>).equation = {
      latex: '\\frac{1}{',
    };
    expect(() => parseCanvasAgentResponse(JSON.stringify(bad), ctx)).toThrow(
      /Invalid LaTeX/,
    );
  });

  it('describeOperationPlan shows CREATE STRUCTURED NOTE with structure name', () => {
    const parsed = parseCanvasAgentResponse(JSON.stringify(validResponse), ctx);
    const lines = describeOperationPlan(parsed.operations, {
      structureNames: new Map([[structure.id, structure.name]]),
      structureFieldLabels: new Map([
        [structure.id, new Map(structure.fields.map((f) => [f.id, f.label]))],
      ]),
    });
    expect(lines[0]).toContain('CREATE STRUCTURED NOTE');
    expect(lines[0]).toContain('Concept Summary');
    expect(lines[0]).toContain('Viewport Default');
    expect(lines[0]).toContain('Concept title');
  });
});
