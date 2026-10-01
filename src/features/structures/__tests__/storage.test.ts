import { describe, expect, it } from 'vitest';
import { createConceptSummaryStructure } from '../factory';
import {
  parseStructureLibrary,
  serializeStructureLibrary,
} from '../storage';

describe('note structure persistence', () => {
  it('serialize/parse round-trips Concept Summary geometry', () => {
    const structure = createConceptSummaryStructure();
    const json = serializeStructureLibrary({ version: 1, structures: [structure] });
    const parsed = parseStructureLibrary(json);
    expect(parsed.structures).toHaveLength(1);
    expect(parsed.structures[0]!.id).toBe(structure.id);
    expect(parsed.structures[0]!.fields).toHaveLength(4);
    expect(parsed.structures[0]!.width).toBe(structure.width);
    expect(parsed.structures[0]!.fields.map((f) => f.relativeX)).toEqual(
      structure.fields.map((f) => f.relativeX),
    );
    expect(parsed.structures[0]!.fields[2]!.relativeWidth).toBe(
      structure.fields[2]!.relativeWidth,
    );
  });

  it('invalid JSON yields empty library', () => {
    expect(parseStructureLibrary('not-json').structures).toEqual([]);
  });

  it('rejects malformed structure entries', () => {
    const json = JSON.stringify({
      version: 1,
      structures: [{ id: 1, name: 'bad' }, { id: 'ok', name: 'Good', fields: [] }],
    });
    const parsed = parseStructureLibrary(json);
    expect(parsed.structures).toHaveLength(1);
    expect(parsed.structures[0]!.name).toBe('Good');
  });
});
