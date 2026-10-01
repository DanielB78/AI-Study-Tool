import { describe, expect, it } from 'vitest';
import { createConceptSummaryStructure } from '../factory';
import {
  formatNoStructureSelected,
  formatNoteStructureForPrompt,
} from '../formatForPrompt';

describe('formatNoteStructureForPrompt', () => {
  it('includes structure id, field instructions, and geometry disclaimer', () => {
    const s = createConceptSummaryStructure();
    const text = formatNoteStructureForPrompt(s);
    expect(text).toContain('SELECTED NOTE STRUCTURE');
    expect(text).toContain(s.id);
    expect(text).toContain('Concept Summary');
    expect(text).toContain('FIELD ID: title');
    expect(text).toContain('TYPE: text');
    expect(text).toContain('TYPE: equation');
    expect(text).toContain('REQUIRED: false');
    expect(text).toContain('Give a short title naming the concept.');
    expect(text).toContain('GEOMETRY (application-owned — do not change)');
    expect(text).toContain('NOT canvas knowledge');
  });

  it('formats No Structure mode', () => {
    const text = formatNoStructureSelected();
    expect(text).toContain('No Structure');
    expect(text).toContain('Do not emit create_structured_note');
  });
});
