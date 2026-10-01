import { describe, expect, it } from 'vitest';
import { createKnowledgeTreeStructure } from '../../../structures/factory';
import {
  CanvasAgentParseError,
  describeOperationPlan,
  parseCanvasAgentResponse,
} from '../parser';

const structure = createKnowledgeTreeStructure();
const sectionId = structure.fields[0]!.id;

const ctx = {
  allowedElementIds: new Set<string>(),
  elementTypes: new Map<string, string>(),
  selectedStructure: structure,
};

const validTree = {
  operations: [
    {
      type: 'create_structured_note',
      structure_id: structure.id,
      fields: {
        [sectionId]: {
          root: {
            content: 'Electromagnetism',
            children: [
              {
                content: 'Electrostatics',
                children: [
                  { content: "Gauss's Law", children: [] },
                  { content: "Coulomb's Law", children: [] },
                ],
              },
              {
                content: 'Induction',
                children: [{ content: "Faraday's Law", children: [] }],
              },
            ],
          },
        },
      },
      placement: { mode: 'viewport_default' },
    },
  ],
};

describe('create_structured_note NODE_SECTION parsing', () => {
  it('accepts a valid hierarchy', () => {
    const parsed = parseCanvasAgentResponse(JSON.stringify(validTree), ctx);
    expect(parsed.operations[0]!.type).toBe('create_structured_note');
  });

  it('rejects depth > maxDepth', () => {
    const deep = structuredClone(validTree);
    let node = deep.operations[0]!.fields[sectionId]!.root;
    for (let i = 0; i < 6; i++) {
      node.children = [{ content: `D${i}`, children: [] }];
      node = node.children[0]!;
    }
    expect(() => parseCanvasAgentResponse(JSON.stringify(deep), ctx)).toThrow(
      CanvasAgentParseError,
    );
    try {
      parseCanvasAgentResponse(JSON.stringify(deep), ctx);
    } catch (err) {
      expect((err as CanvasAgentParseError).code).toBe('hierarchy_too_deep');
    }
  });

  it('rejects total nodes > maxTotalNodes without mutating canvas', () => {
    const fat = structuredClone(validTree);
    fat.operations[0]!.fields[sectionId]!.root.children = Array.from(
      { length: 40 },
      (_, i) => ({ content: `N${i}`, children: [] }),
    );
    expect(() => parseCanvasAgentResponse(JSON.stringify(fat), ctx)).toThrow(
      /maxTotalNodes/,
    );
  });

  it('rejects coordinates on hierarchy nodes', () => {
    const bad = structuredClone(validTree);
    (bad.operations[0]!.fields[sectionId]!.root as Record<string, unknown>).x = 10;
    expect(() => parseCanvasAgentResponse(JSON.stringify(bad), ctx)).toThrow(
      /coordinates/,
    );
  });

  it('describeOperationPlan shows readable tree', () => {
    const parsed = parseCanvasAgentResponse(JSON.stringify(validTree), ctx);
    const lines = describeOperationPlan(parsed.operations, {
      structureNames: new Map([[structure.id, structure.name]]),
      structureFieldLabels: new Map([
        [structure.id, new Map([[sectionId, 'Knowledge Tree']])],
      ]),
    });
    expect(lines[0]).toContain('KNOWLEDGE TREE');
    expect(lines[0]).toContain('Electromagnetism');
    expect(lines[0]).toContain("Gauss's Law");
    expect(lines[0]).toContain('Nodes:');
    expect(lines[0]).toContain('Connectors:');
  });
});
