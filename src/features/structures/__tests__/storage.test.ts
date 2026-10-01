import { describe, expect, it } from 'vitest';
import {
  createConceptSummaryStructure,
  createKnowledgeTreeStructure,
} from '../factory';
import {
  parseStructureLibrary,
  serializeStructureLibrary,
} from '../storage';
import { NOTE_STRUCTURE_VERSION } from '../types';

describe('note structure persistence', () => {
  it('serialize/parse round-trips Concept Summary geometry', () => {
    const structure = createConceptSummaryStructure();
    const json = serializeStructureLibrary({
      version: NOTE_STRUCTURE_VERSION,
      structures: [structure],
    });
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

  it('round-trips Node Section configuration', () => {
    const structure = createKnowledgeTreeStructure();
    const json = serializeStructureLibrary({
      version: NOTE_STRUCTURE_VERSION,
      structures: [structure],
    });
    const parsed = parseStructureLibrary(json);
    const ns = parsed.structures[0]!.fields[0]!;
    expect(ns.componentKind).toBe('node_section');
    if (ns.componentKind === 'node_section') {
      expect(ns.layoutMode).toBe('tree_vertical');
      expect(ns.rootTemplate.instruction).toContain('Main subject');
      expect(ns.maxTotalNodes).toBe(30);
      expect(ns.connectorConfig.connectorType).toBe('arrow');
    }
  });

  it('migrates v1 fields without componentKind', () => {
    const json = JSON.stringify({
      version: 1,
      structures: [
        {
          id: 'structure_old',
          name: 'Legacy',
          width: 400,
          height: 300,
          fields: [
            {
              id: 'title',
              label: 'Title',
              instruction: 'Short title',
              contentType: 'text',
              required: true,
              relativeX: 0,
              relativeY: 0,
              relativeWidth: 400,
              relativeHeight: 40,
              zIndex: 0,
            },
          ],
        },
      ],
    });
    const parsed = parseStructureLibrary(json);
    expect(parsed.structures[0]!.fields[0]!.componentKind).toBe('field');
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
