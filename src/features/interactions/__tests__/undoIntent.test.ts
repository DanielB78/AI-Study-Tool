import { describe, expect, it } from 'vitest';
import { detectUndoIntent } from '../undoIntent';

describe('detectUndoIntent', () => {
  it('detects exact undo phrases', () => {
    expect(detectUndoIntent('undo that')).toBe('undo');
    expect(detectUndoIntent('Undo what you just did!')).toBe('undo');
    expect(detectUndoIntent('  undo your last change.  ')).toBe('undo');
  });

  it('detects exact redo phrases', () => {
    expect(detectUndoIntent('redo that')).toBe('redo');
    expect(detectUndoIntent('Redo what you just undid.')).toBe('redo');
  });

  it('returns null for ambiguous or unrelated prompts', () => {
    expect(detectUndoIntent('undo the Gauss note')).toBeNull();
    expect(detectUndoIntent('please undo if possible')).toBeNull();
    expect(detectUndoIntent('create a note about undo')).toBeNull();
    expect(detectUndoIntent('')).toBeNull();
  });
});
