import { beforeEach, describe, expect, it } from 'vitest';
import { setAiGenerationModeOverride } from '../generationMode';
import { compileContentFirstBatches } from '../applyContentFirst';
import { extractActionSummary } from '../../../interactions/actionSummaryFence';

describe('content-first :::summary stripping', () => {
  beforeEach(() => setAiGenerationModeOverride('content_first'));

  it('strips :::summary before compiling canvas ops', () => {
    const raw = [
      '```markdown',
      '# Title',
      '',
      'A short explanation.',
      '',
      ':::summary',
      'Created a title and short explanation.',
      ':::',
      '```',
    ].join('\n');

    const extracted = extractActionSummary(raw);
    expect(extracted.summary).toBe('Created a title and short explanation.');

    const compiled = compileContentFirstBatches(raw, {
      allowedElementIds: new Set(),
      elementTypes: new Map(),
    });
    expect(compiled.actionSummary).toBe('Created a title and short explanation.');
    expect(compiled.compile.response.operations.length).toBeGreaterThan(0);
    const texts = compiled.compile.response.operations
      .filter((op) => op.type === 'create_text')
      .map((op) => ('text' in op ? op.text : ''));
    expect(texts.join('\n')).not.toContain('Created a title and short explanation');
    expect(texts.join('\n')).not.toContain(':::summary');
  });
});
