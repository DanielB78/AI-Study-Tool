import { describe, expect, it } from 'vitest';
import { DEFAULT_STYLE } from '../../../types/canvas';
import { createConceptSummaryStructure } from '../factory';
import { instantiateNoteStructure } from '../instantiation';
import type { StructureFieldValue } from '../fieldValues';

describe('instantiateNoteStructure', () => {
  it('places fields relative to origin and sets instance metadata', () => {
    const structure = createConceptSummaryStructure();
    const values = new Map<string, StructureFieldValue>([
      ['title', { kind: 'text', content: "Gauss's Law" }],
      [
        'explanation',
        { kind: 'text', content: 'Relates flux through a closed surface to enclosed charge.' },
      ],
      [
        'equation',
        {
          kind: 'equation',
          latex: '\\oint_S \\mathbf{E}\\cdot d\\mathbf{A}=\\frac{Q_{\\mathrm{enc}}}{\\varepsilon_0}',
        },
      ],
      ['example', { kind: 'text', content: 'Spherical charge distribution.' }],
    ]);
    let z = 10;
    const result = instantiateNoteStructure({
      structure,
      fieldValues: values,
      origin: { x: 500, y: 200 },
      style: DEFAULT_STYLE,
      nextZIndex: () => z++,
    });
    expect(result.elements).toHaveLength(4);
    expect(result.structureInstanceId).toMatch(/^instance_/);
    const title = result.elements.find(
      (el) => el.metadata?.structureFieldId === 'title',
    );
    expect(title?.type).toBe('text');
    expect(title?.x).toBe(500 + structure.fields[0]!.relativeX);
    expect(title?.y).toBe(200 + structure.fields[0]!.relativeY);
    expect(title?.metadata?.structureId).toBe(structure.id);
    expect(title?.metadata?.structureInstanceId).toBe(result.structureInstanceId);
    expect(title?.metadata?.structureVersion).toBe(structure.version);

    const eq = result.elements.find(
      (el) => el.metadata?.structureFieldId === 'equation',
    );
    expect(eq?.type).toBe('equation');
    if (eq?.type === 'equation') {
      expect(eq.latex).toContain('oint');
      expect(eq.width).toBe(structure.fields.find((f) => f.id === 'equation')!.relativeWidth);
    }
  });

  it('omits optional fields that have no value (no empty elements)', () => {
    const structure = createConceptSummaryStructure();
    const values = new Map<string, StructureFieldValue>([
      ['title', { kind: 'text', content: 'Title' }],
      ['explanation', { kind: 'text', content: 'Body' }],
    ]);
    let z = 1;
    const result = instantiateNoteStructure({
      structure,
      fieldValues: values,
      origin: { x: 0, y: 0 },
      style: DEFAULT_STYLE,
      nextZIndex: () => z++,
    });
    expect(result.elements).toHaveLength(2);
    expect(result.createdFieldIds).toEqual(['title', 'explanation']);
  });
});
