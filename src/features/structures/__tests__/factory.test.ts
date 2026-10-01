import { describe, expect, it } from 'vitest';
import {
  createConceptSummaryStructure,
  createEmptyStructure,
  createKnowledgeTreeStructure,
  createNodeSection,
  createStructureField,
  duplicateStructure,
} from '../factory';
import { isNodeSection, isStructureField } from '../types';

describe('note structure factory', () => {
  it('creates empty structure with relative bounds', () => {
    const s = createEmptyStructure('Test');
    expect(s.id).toMatch(/^structure_/);
    expect(s.name).toBe('Test');
    expect(s.fields).toEqual([]);
    expect(s.width).toBeGreaterThan(0);
    expect(s.height).toBeGreaterThan(0);
  });

  it('creates Concept Summary with TEXT + EQUATION layout', () => {
    const s = createConceptSummaryStructure();
    expect(s.name).toBe('Concept Summary');
    expect(s.fields).toHaveLength(4);
    const byId = Object.fromEntries(s.fields.map((f) => [f.id, f]));
    expect(isStructureField(byId.title!)).toBe(true);
    if (isStructureField(byId.title!)) {
      expect(byId.title.contentType).toBe('text');
      expect(byId.title.required).toBe(true);
    }
    if (isStructureField(byId.equation!)) {
      expect(byId.equation.contentType).toBe('equation');
      expect(byId.equation.required).toBe(false);
    }
    // Geometry is relative (within structure bounds), not world coords.
    for (const f of s.fields) {
      expect(f.relativeX).toBeGreaterThanOrEqual(0);
      expect(f.relativeY).toBeGreaterThanOrEqual(0);
      expect(f.relativeX + f.relativeWidth).toBeLessThanOrEqual(s.width + 1);
      expect(f.relativeY + f.relativeHeight).toBeLessThanOrEqual(s.height + 1);
    }
  });

  it('creates Knowledge Tree with Node Section defaults', () => {
    const s = createKnowledgeTreeStructure();
    expect(s.fields).toHaveLength(1);
    expect(isNodeSection(s.fields[0]!)).toBe(true);
    const ns = createNodeSection();
    expect(ns.componentKind).toBe('node_section');
    expect(ns.maxDepth).toBeGreaterThan(0);
    expect(ns.rootTemplate.width).toBeGreaterThan(0);
    expect(ns.childTemplate.height).toBeGreaterThan(0);
  });

  it('duplicateStructure gets a new id but keeps layout', () => {
    const a = createConceptSummaryStructure();
    const b = duplicateStructure(a);
    expect(b.id).not.toBe(a.id);
    expect(b.name).toContain('copy');
    expect(b.fields).toHaveLength(a.fields.length);
    expect(b.fields[0]!.relativeWidth).toBe(a.fields[0]!.relativeWidth);
  });

  it('createStructureField defaults to TEXT required', () => {
    const f = createStructureField({
      label: 'Definition',
      instruction: 'Give a concise definition.',
    });
    expect(f.contentType).toBe('text');
    expect(f.required).toBe(true);
    expect(f.instruction).toContain('definition');
  });
});
