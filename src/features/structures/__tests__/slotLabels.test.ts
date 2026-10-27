import { describe, expect, it } from 'vitest';
import {
  directiveLabelFromDescription,
  matchSlotLabelToId,
  normalizeSlotDescription,
  validateSlotDescriptions,
} from '../slotLabels';

describe('slotLabels', () => {
  it('normalises whitespace but keeps case', () => {
    expect(normalizeSlotDescription('  Give   the  equation  ')).toBe(
      'Give the equation',
    );
    expect(directiveLabelFromDescription('Give the equation')).toBe(
      'Give the equation',
    );
  });

  it('rejects empty, reserved, and duplicate descriptions', () => {
    const issues = validateSlotDescriptions([
      'Describe the concept in one sentence.',
      'graph',
      'Describe the concept in one sentence.',
      '',
    ]);
    expect(issues.some((i) => i.code === 'duplicate')).toBe(true);
    expect(issues.some((i) => i.code === 'reserved')).toBe(true);
    expect(issues.some((i) => i.code === 'empty')).toBe(true);
  });

  it('matches markers to stable slot ids exactly', () => {
    const slots = [
      { id: 'a', description: 'Describe the concept in one sentence.' },
      { id: 'b', description: 'Give the governing equation.' },
    ];
    expect(
      matchSlotLabelToId('Describe the concept in one sentence.', slots),
    ).toBe('a');
    expect(matchSlotLabelToId('  Give the governing equation.  ', slots)).toBe(
      'b',
    );
    expect(() => matchSlotLabelToId('Unknown slot', slots)).toThrow(/Unknown/);
  });
});
