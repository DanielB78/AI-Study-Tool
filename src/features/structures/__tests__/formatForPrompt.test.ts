import { describe, expect, it } from 'vitest';
import {
  createConceptSummaryStructure,
  createKnowledgeTreeStructure,
  createPhysicsConceptTemplate,
} from '../factory';
import {
  formatNoStructureSelected,
  formatNoteStructureForPrompt,
} from '../formatForPrompt';

describe('formatNoteStructureForPrompt', () => {
  it('emits :::structure contract without geometry or colours', () => {
    const s = createPhysicsConceptTemplate();
    const text = formatNoteStructureForPrompt(s);
    expect(text).toContain('SELECTED STRUCTURE TEMPLATE');
    expect(text).toContain('Physics Concept Template');
    expect(text).toContain(`:::structure ${s.name}`);
    expect(text).toContain(':::endstructure');
    expect(text).toContain(':::Describe the concept in one sentence.');
    expect(text).toContain(':::Give the governing equation.');
    expect(text).toContain('TYPE: EQUATION');
    expect(text).toContain('TYPE: GRAPH');
    expect(text).not.toContain('GEOMETRY');
    expect(text).not.toContain(s.id);
    expect(text).toContain('never invent');
  });

  it('lists Concept Summary generative slots in reading order', () => {
    const s = createConceptSummaryStructure();
    const text = formatNoteStructureForPrompt(s);
    expect(text).toContain('Give a short title naming the concept.');
    expect(text).toContain(':::structure Concept Summary');
  });

  it('notes legacy node sections without requiring :::structure fill', () => {
    const s = createKnowledgeTreeStructure();
    const text = formatNoteStructureForPrompt(s);
    expect(text).toContain('legacy node-section');
    expect(text).toContain(`:::structure ${s.name}`);
  });

  it('formats No Structure mode', () => {
    const text = formatNoStructureSelected();
    expect(text).toContain('No Structure');
    expect(text).toContain('Do not emit :::structure');
  });
});
